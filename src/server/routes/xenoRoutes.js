/**
 * Xeno AI proxy routes — all generation requests flow through here
 * so we can check/deduct per-user credits on the server side.
 */

import { Router } from 'express';
import Xeno from 'xeno-ai';
import { getCreditCost } from '../utils/creditCosts.js';
import { deductCredits, refundCredits, logUsage } from '../utils/creditTransactions.js';

const router = Router();
const XENO_API_KEY = process.env.XENO_API_KEY || '';

const xenoClient = XENO_API_KEY
  ? new Xeno({
      apiKey: XENO_API_KEY,
      baseURL: 'https://api.xenostudio.ai/v1',
    })
  : null;

function getUserId(req, res) {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Not authenticated' });
    return null;
  }
  return userId;
}

function ensureXenoConfigured(res) {
  if (!XENO_API_KEY || !xenoClient) {
    res.status(500).json({ error: 'XENO_API_KEY is not configured on the server' });
    return false;
  }
  return true;
}

function missingPrompt(prompt) {
  return typeof prompt !== 'string' || !prompt.trim();
}

function getApiErrorStatus(apiError) {
  const rawStatus = Number(
    apiError?.statusCode ||
    apiError?.status ||
    apiError?.response?.status
  );

  if (Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599) {
    return rawStatus;
  }

  return 500;
}

function normalizeErrorText(value) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

function getApiErrorDetail(apiError) {
  const responseData = apiError?.response?.data;
  const structuredError = responseData?.error;

  const candidates = [
    typeof structuredError === 'string' ? structuredError : '',
    structuredError?.message,
    responseData?.message,
    responseData?.detail,
    responseData?.reason,
    responseData?.error_description,
    apiError?.error?.message,
    apiError?.message,
  ];

  for (const candidate of candidates) {
    const text = normalizeErrorText(candidate);
    if (text) {
      return text;
    }
  }

  return 'Xeno API error';
}

function getApiErrorMessage(apiError, context = {}) {
  const normalizedMessage = getApiErrorDetail(apiError);
  const status = getApiErrorStatus(apiError);

  // Some Xeno SDK errors lose response body and return only this generic message.
  if (/^image generation failed$/i.test(normalizedMessage) && context?.model) {
    return `Xeno image generation failed for model "${context.model}" (status ${status}). Try again later or use another model.`;
  }

  return normalizedMessage;
}

function insufficientCreditsResponse(res, required, currentCredits) {
  return res.status(402).json({
    error: 'Insufficient credits',
    required,
    current: currentCredits,
  });
}

// ---------- POST /api/xeno/images/generate ----------
router.post('/images/generate', async (req, res) => {
  if (!ensureXenoConfigured(res)) {
    return;
  }

  const userId = getUserId(req, res);
  if (!userId) {
    return;
  }

  try {
    const { model = 'auto', prompt, width, height, seed, n, ...rest } = req.body || {};

    if (missingPrompt(prompt)) {
      return res.status(400).json({ error: 'Missing prompt' });
    }

    const cost = getCreditCost('image', model);
    const debit = await deductCredits(req.db, userId, cost);

    if (!debit.success) {
      return insufficientCreditsResponse(res, cost, debit.currentCredits ?? 0);
    }

    try {
      const result = await xenoClient.image.generate({
        model,
        prompt: prompt.trim(),
        width: width || 1024,
        height: height || 1024,
        seed,
        n: n || 1,
        ...rest,
      });

      await logUsage(req.db, userId, `image:${model}`, cost, {
        route: '/api/xeno/images/generate',
        model,
        prompt_length: prompt.trim().length,
      });

      return res.json({
        data: result?.data || [],
        model: result?.model || model,
        credits_used: cost,
        remaining_credits: debit.newBalance,
      });
    } catch (apiError) {
      await refundCredits(req.db, userId, cost);
      console.error('[XenoRoutes] Image generate API error:', apiError);
      const status = getApiErrorStatus(apiError);
      return res.status(status).json({
        error: getApiErrorMessage(apiError, { model }),
        model,
        status,
        credits_refunded: true,
      });
    }
  } catch (error) {
    console.error('[XenoRoutes] Image generate error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- POST /api/xeno/images/edit ----------
router.post('/images/edit', async (req, res) => {
  if (!ensureXenoConfigured(res)) {
    return;
  }

  const userId = getUserId(req, res);
  if (!userId) {
    return;
  }

  try {
    const { image, prompt, model = 'auto', ...rest } = req.body || {};

    if (!image) {
      return res.status(400).json({ error: 'Missing image' });
    }

    if (missingPrompt(prompt)) {
      return res.status(400).json({ error: 'Missing prompt' });
    }

    const cost = getCreditCost('edit', model);
    const debit = await deductCredits(req.db, userId, cost);

    if (!debit.success) {
      return insufficientCreditsResponse(res, cost, debit.currentCredits ?? 0);
    }

    try {
      const result = await xenoClient.image.edit({
        image,
        prompt: prompt.trim(),
        model,
        ...rest,
      });

      await logUsage(req.db, userId, `edit:${model}`, cost, {
        route: '/api/xeno/images/edit',
        model,
        prompt_length: prompt.trim().length,
      });

      return res.json({
        data: result?.data || [],
        model: result?.model || model,
        credits_used: cost,
        remaining_credits: debit.newBalance,
      });
    } catch (apiError) {
      await refundCredits(req.db, userId, cost);
      console.error('[XenoRoutes] Image edit API error:', apiError);
      return res.status(500).json({
        error: getApiErrorMessage(apiError),
        credits_refunded: true,
      });
    }
  } catch (error) {
    console.error('[XenoRoutes] Image edit error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- POST /api/xeno/videos/generate ----------
router.post('/videos/generate', async (req, res) => {
  if (!ensureXenoConfigured(res)) {
    return;
  }

  const userId = getUserId(req, res);
  if (!userId) {
    return;
  }

  try {
    const { model = 'auto', prompt, image, duration, aspect_ratio, resolution, fps, seed, ...rest } = req.body || {};

    if (missingPrompt(prompt)) {
      return res.status(400).json({ error: 'Missing prompt' });
    }

    const cost = getCreditCost('video', model);
    const debit = await deductCredits(req.db, userId, cost);

    if (!debit.success) {
      return insufficientCreditsResponse(res, cost, debit.currentCredits ?? 0);
    }

    try {
      const result = await xenoClient.video.generate({
        model,
        prompt: prompt.trim(),
        image,
        duration,
        aspect_ratio,
        resolution,
        fps,
        seed,
        wait: true,
        ...rest,
      });

      await logUsage(req.db, userId, `video:${model}`, cost, {
        route: '/api/xeno/videos/generate',
        model,
        prompt_length: prompt.trim().length,
      });

      return res.json({
        data: result?.data || [],
        model: result?.model || model,
        credits_used: cost,
        remaining_credits: debit.newBalance,
      });
    } catch (apiError) {
      await refundCredits(req.db, userId, cost);
      console.error('[XenoRoutes] Video generate API error:', apiError);
      return res.status(500).json({
        error: getApiErrorMessage(apiError),
        credits_refunded: true,
      });
    }
  } catch (error) {
    console.error('[XenoRoutes] Video generate error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------- POST /api/xeno/audio/generate ----------
router.post('/audio/generate', async (req, res) => {
  if (!ensureXenoConfigured(res)) {
    return;
  }

  const userId = getUserId(req, res);
  if (!userId) {
    return;
  }

  try {
    const { model = 'auto', prompt, duration, seed, ...rest } = req.body || {};

    if (missingPrompt(prompt)) {
      return res.status(400).json({ error: 'Missing prompt' });
    }

    const cost = getCreditCost('audio', model);
    const debit = await deductCredits(req.db, userId, cost);

    if (!debit.success) {
      return insufficientCreditsResponse(res, cost, debit.currentCredits ?? 0);
    }

    try {
      const result = await xenoClient.music.generate({
        model,
        prompt: prompt.trim(),
        duration,
        seed,
        wait: true,
        ...rest,
      });

      await logUsage(req.db, userId, `audio:${model}`, cost, {
        route: '/api/xeno/audio/generate',
        model,
        prompt_length: prompt.trim().length,
      });

      return res.json({
        data: result?.data || [],
        model: result?.model || model,
        credits_used: cost,
        remaining_credits: debit.newBalance,
      });
    } catch (apiError) {
      await refundCredits(req.db, userId, cost);
      console.error('[XenoRoutes] Audio generate API error:', apiError);
      return res.status(500).json({
        error: getApiErrorMessage(apiError),
        credits_refunded: true,
      });
    }
  } catch (error) {
    console.error('[XenoRoutes] Audio generate error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
