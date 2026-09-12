import express from 'express';
import { randomUUID } from 'crypto';
import { getOrCreateBillingRuntimeContext, resolveRequestedBillingRuntimeContext } from '../utils/billingRuntime.js';
import { getCreditSnapshot, grantCredits } from '../utils/creditTransactions.js';

const router = express.Router();

const CREDIT_ROUTE_RUNTIME_OPTIONS = {
  projectSlug: 'default-platform-project',
  projectName: 'Default Platform Project',
  source: 'xeno-platform-desktop-credits',
};

function normalizeText(value, maxLength = 255) {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim().slice(0, maxLength);
}

function normalizeOptionalText(value, maxLength = 255) {
  const normalized = normalizeText(value, maxLength);
  return normalized || null;
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function isLuhnValid(number) {
  let sum = 0;
  let shouldDouble = false;

  for (let index = number.length - 1; index >= 0; index -= 1) {
    let digit = Number(number[index]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) {
        digit -= 9;
      }
    }

    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

function deriveCardBrand(number) {
  if (/^4/.test(number)) return 'visa';
  if (/^(5[1-5]|2(2[2-9]|[3-6][0-9]|7[01]|720))/.test(number)) return 'mastercard';
  if (/^3[47]/.test(number)) return 'amex';
  if (/^(6011|65|64[4-9])/.test(number)) return 'discover';
  if (/^(30[0-5]|36|38|39)/.test(number)) return 'diners';
  if (/^(2131|1800|35)/.test(number)) return 'jcb';
  return 'card';
}

function parseExpiry(value) {
  const digits = digitsOnly(value);
  if (![4, 6].includes(digits.length)) {
    return { error: 'Expiration date must be in MM/YY or MM/YYYY format' };
  }

  const expMonth = Number(digits.slice(0, 2));
  const expYear = digits.length === 4
    ? 2000 + Number(digits.slice(2, 4))
    : Number(digits.slice(2, 6));

  if (!Number.isInteger(expMonth) || expMonth < 1 || expMonth > 12) {
    return { error: 'Expiration month must be between 1 and 12' };
  }

  if (!Number.isInteger(expYear) || expYear < 2000) {
    return { error: 'Expiration year is invalid' };
  }

  const now = new Date();
  const currentMonth = now.getUTCMonth() + 1;
  const currentYear = now.getUTCFullYear();
  if (expYear < currentYear || (expYear === currentYear && expMonth < currentMonth)) {
    return { error: 'Card expiration date is in the past' };
  }

  return { expMonth, expYear };
}

function validatePaymentMethodPayload(payload = {}) {
  const fieldErrors = {};

  const cardholderName = normalizeText(
    payload.cardholderName ?? payload.cardholder_name ?? payload.name,
    255
  );
  const country = normalizeText(payload.country, 64).toUpperCase();
  const addressLine1 = normalizeOptionalText(payload.addressLine1 ?? payload.address_line1, 255);
  const addressLine2 = normalizeOptionalText(payload.addressLine2 ?? payload.address_line2, 255);
  const city = normalizeOptionalText(payload.city, 128);
  const state = normalizeOptionalText(payload.state, 128);
  const postalCode = normalizeOptionalText(payload.postalCode ?? payload.postal_code, 64);
  const taxId = normalizeOptionalText(payload.taxId ?? payload.tax_id, 128);

  const cardNumber = digitsOnly(payload.cardNumber ?? payload.card_number);
  const cvc = digitsOnly(payload.cvc);
  const expiry = parseExpiry(payload.expDate ?? payload.expiry ?? payload.exp_date ?? payload.exp);

  if (!cardholderName) {
    fieldErrors.cardholderName = 'Cardholder name is required';
  }

  if (!country) {
    fieldErrors.country = 'Country is required';
  }

  if (cardNumber.length < 12 || cardNumber.length > 19 || !isLuhnValid(cardNumber)) {
    fieldErrors.cardNumber = 'Card number is invalid';
  }

  if (cvc.length < 3 || cvc.length > 4) {
    fieldErrors.cvc = 'CVC must be 3 or 4 digits';
  }

  if (expiry.error) {
    fieldErrors.expDate = expiry.error;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { fieldErrors };
  }

  return {
    fieldErrors,
    paymentMethod: {
      brand: deriveCardBrand(cardNumber),
      last4: cardNumber.slice(-4),
      expMonth: expiry.expMonth,
      expYear: expiry.expYear,
      cardholderName,
      country,
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      taxId,
    },
  };
}

function normalizePurchaseAmount(amount) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) {
    return { error: 'Amount must be a valid number' };
  }

  const normalized = Math.round(numeric * 100) / 100;
  if (normalized < 1) {
    return { error: 'Amount must be at least $1.00' };
  }

  if (normalized > 10000) {
    return { error: 'Amount exceeds the allowed maximum' };
  }

  return { amountUsd: normalized };
}

async function resolveBillingContext(req) {
  const workspaceId = typeof req.body?.workspaceId === 'string'
    ? req.body.workspaceId
    : typeof req.query.workspaceId === 'string'
      ? req.query.workspaceId
      : typeof req.query.workspace_id === 'string'
        ? req.query.workspace_id
        : null;

  const projectId = typeof req.body?.projectId === 'string'
    ? req.body.projectId
    : typeof req.query.projectId === 'string'
      ? req.query.projectId
      : typeof req.query.project_id === 'string'
        ? req.query.project_id
        : null;

  if (workspaceId || projectId) {
    return resolveRequestedBillingRuntimeContext(
      req.db,
      req.user.id,
      { workspaceId, projectId },
      CREDIT_ROUTE_RUNTIME_OPTIONS
    );
  }

  return getOrCreateBillingRuntimeContext(req.db, req.user.id, CREDIT_ROUTE_RUNTIME_OPTIONS);
}

async function getPaymentMethodSnapshot(db, workspaceId) {
  const result = await db.query(
    `SELECT
       id::text AS id,
       workspace_id::text AS "workspaceId",
       user_id::text AS "userId",
       brand,
       last4,
       exp_month AS "expMonth",
       exp_year AS "expYear",
       cardholder_name AS "cardholderName",
       country,
       address_line1 AS "addressLine1",
       address_line2 AS "addressLine2",
       city,
       state,
       postal_code AS "postalCode",
       tax_id AS "taxId",
       created_at AS "createdAt",
       updated_at AS "updatedAt"
     FROM billing_payment_method_snapshots
     WHERE workspace_id = $1::uuid
     LIMIT 1`,
    [workspaceId]
  );

  return result.rows[0] || null;
}

router.get('/payment-method', async (req, res) => {
  try {
    const runtime = await resolveBillingContext(req);
    if (!runtime?.workspace?.id) {
      return res.status(404).json({
        success: false,
        error: 'Active workspace not found',
      });
    }

    const paymentMethod = await getPaymentMethodSnapshot(req.db, runtime.workspace.id);

    res.json({
      success: true,
      hasMethod: Boolean(paymentMethod),
      workspace: runtime.workspace,
      paymentMethod,
    });
  } catch (error) {
    const status = /not found/i.test(error.message) ? 404 : 500;
    console.error('Credits payment method fetch error:', error);
    res.status(status).json({
      success: false,
      error: error.message || 'Failed to fetch payment method',
    });
  }
});

router.put('/payment-method', async (req, res) => {
  try {
    const { fieldErrors, paymentMethod } = validatePaymentMethodPayload(req.body || {});
    if (Object.keys(fieldErrors).length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        fieldErrors,
      });
    }

    const runtime = await resolveBillingContext(req);
    if (!runtime?.workspace?.id) {
      return res.status(404).json({
        success: false,
        error: 'Active workspace not found',
      });
    }

    const result = await req.db.query(
      `INSERT INTO billing_payment_method_snapshots (
         id,
         workspace_id,
         user_id,
         brand,
         last4,
         exp_month,
         exp_year,
         cardholder_name,
         country,
         address_line1,
         address_line2,
         city,
         state,
         postal_code,
         tax_id,
         created_at,
         updated_at
       )
       VALUES (
         $1::uuid,
         $2::uuid,
         $3::uuid,
         $4::varchar,
         $5::varchar,
         $6::integer,
         $7::integer,
         $8::varchar,
         $9::varchar,
         $10::varchar,
         $11::varchar,
         $12::varchar,
         $13::varchar,
         $14::varchar,
         $15::varchar,
         NOW(),
         NOW()
       )
       ON CONFLICT (workspace_id)
       DO UPDATE SET
         user_id = EXCLUDED.user_id,
         brand = EXCLUDED.brand,
         last4 = EXCLUDED.last4,
         exp_month = EXCLUDED.exp_month,
         exp_year = EXCLUDED.exp_year,
         cardholder_name = EXCLUDED.cardholder_name,
         country = EXCLUDED.country,
         address_line1 = EXCLUDED.address_line1,
         address_line2 = EXCLUDED.address_line2,
         city = EXCLUDED.city,
         state = EXCLUDED.state,
         postal_code = EXCLUDED.postal_code,
         tax_id = EXCLUDED.tax_id,
         updated_at = NOW()
       RETURNING
         id::text AS id,
         workspace_id::text AS "workspaceId",
         user_id::text AS "userId",
         brand,
         last4,
         exp_month AS "expMonth",
         exp_year AS "expYear",
         cardholder_name AS "cardholderName",
         country,
         address_line1 AS "addressLine1",
         address_line2 AS "addressLine2",
         city,
         state,
         postal_code AS "postalCode",
         tax_id AS "taxId",
         created_at AS "createdAt",
         updated_at AS "updatedAt"`,
      [
        randomUUID(),
        runtime.workspace.id,
        req.user.id,
        paymentMethod.brand,
        paymentMethod.last4,
        paymentMethod.expMonth,
        paymentMethod.expYear,
        paymentMethod.cardholderName,
        paymentMethod.country,
        paymentMethod.addressLine1,
        paymentMethod.addressLine2,
        paymentMethod.city,
        paymentMethod.state,
        paymentMethod.postalCode,
        paymentMethod.taxId,
      ]
    );

    res.json({
      success: true,
      hasMethod: true,
      workspace: runtime.workspace,
      paymentMethod: result.rows[0],
    });
  } catch (error) {
    const status = /not found/i.test(error.message) ? 404 : 500;
    console.error('Credits payment method save error:', error);
    res.status(status).json({
      success: false,
      error: error.message || 'Failed to save payment method',
    });
  }
});

router.delete('/payment-method', async (req, res) => {
  try {
    const runtime = await resolveBillingContext(req);
    if (!runtime?.workspace?.id) {
      return res.status(404).json({
        success: false,
        error: 'Active workspace not found',
      });
    }

    await req.db.query(
      'DELETE FROM billing_payment_method_snapshots WHERE workspace_id = $1::uuid',
      [runtime.workspace.id]
    );

    res.json({
      success: true,
      hasMethod: false,
      workspace: runtime.workspace,
    });
  } catch (error) {
    const status = /not found/i.test(error.message) ? 404 : 500;
    console.error('Credits payment method delete error:', error);
    res.status(status).json({
      success: false,
      error: error.message || 'Failed to delete payment method',
    });
  }
});

router.post('/purchase', async (req, res) => {
  try {
    const normalizedAmount = normalizePurchaseAmount(req.body?.amount);
    if (normalizedAmount.error) {
      return res.status(400).json({
        success: false,
        error: normalizedAmount.error,
        fieldErrors: {
          amount: normalizedAmount.error,
        },
      });
    }

    const runtime = await resolveBillingContext(req);
    if (!runtime?.workspace?.id) {
      return res.status(404).json({
        success: false,
        error: 'Active workspace not found',
      });
    }

    const paymentMethod = await getPaymentMethodSnapshot(req.db, runtime.workspace.id);
    if (!paymentMethod) {
      return res.status(400).json({
        success: false,
        error: 'A saved payment method is required before purchasing credits',
      });
    }

    const amountUsd = normalizedAmount.amountUsd;
    const creditsAdded = Math.round(amountUsd * 1000);
    const purchaseToken = randomUUID();

    const grant = await grantCredits(req.db, req.user.id, creditsAdded, {
      referenceType: 'simulated_purchase',
      description: `Simulated credit purchase for $${amountUsd.toFixed(2)}`,
      metadata: {
        source: 'desktop_simulated_purchase',
        surface: 'xeno_desktop',
        purchase_token: purchaseToken,
        amount_usd: amountUsd,
        credits_added: creditsAdded,
        workspace_id: runtime.workspace.id,
        project_id: runtime.project?.id ?? null,
        payment_method_snapshot_id: paymentMethod.id,
        payment_method_brand: paymentMethod.brand,
        payment_method_last4: paymentMethod.last4,
      },
    });

    if (!grant.success) {
      return res.status(400).json({
        success: false,
        error: grant.error || 'Failed to add credits',
      });
    }

    const [snapshot, transactionResult] = await Promise.all([
      getCreditSnapshot(req.db, req.user.id),
      req.db.query(
        `SELECT id::text AS id
         FROM credit_transactions
         WHERE user_id = $1::uuid
           AND metadata ->> 'purchase_token' = $2::text
         ORDER BY created_at DESC
         LIMIT 1`,
        [req.user.id, purchaseToken]
      ),
    ]);

    res.json({
      success: true,
      amountUsd,
      creditsAdded,
      balance: snapshot?.currentCredits ?? grant.newBalance,
      currency: 'credits',
      transactionId: transactionResult.rows[0]?.id ?? null,
      workspace: runtime.workspace,
      project: runtime.project ?? null,
    });
  } catch (error) {
    const status = /not found/i.test(error.message) ? 404 : 500;
    console.error('Credits purchase error:', error);
    res.status(status).json({
      success: false,
      error: error.message || 'Failed to complete purchase',
    });
  }
});

export default router;
