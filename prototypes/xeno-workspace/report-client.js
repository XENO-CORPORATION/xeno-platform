// GENERATED shared @xenosystem/report-client browser distribution.
"use strict";
var XenoReportClient = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // packages/report-client/src/index.ts
  var index_exports = {};
  __export(index_exports, {
    ReportAuthRequired: () => ReportAuthRequired,
    ReportError: () => ReportError,
    ReportSubmissionUncertain: () => ReportSubmissionUncertain,
    createReportClient: () => createReportClient,
    newReportSubmissionId: () => newReportSubmissionId,
    redact: () => redact,
    serializeReport: () => serializeReport
  });

  // packages/report-client/vendor/acp-text-redaction.js
  var SECRET_PATTERNS = [
    /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
    /\bsk-[A-Za-z0-9_-]{12,}/gi,
    /\bxai-[A-Za-z0-9_-]{12,}/gi,
    /\bghp_[A-Za-z0-9_]{12,}/gi,
    /\bxeno-[A-Za-z0-9_-]{24,}/gi,
    /\bAKIA[0-9A-Z]{16}\b/g,
    /\b(access[-_]?token|refresh[-_]?token|token|secret|password|cookie|authorization|api[-_]?key|credential)\b["']?\s*[:=]\s*(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi,
    /\b[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/][^\\/\r\n"'<>]+/gi,
    /\/(?:home|Users)\/[^/\s"'<>]+/g,
    /\/root(?=\/|\s|$)/g
  ];
  function redactAcpText(value, maxLength = 4e3) {
    let result = value;
    for (const pattern of SECRET_PATTERNS) result = result.replace(pattern, "[redacted]");
    if (result.length > maxLength) result = `${result.slice(0, maxLength)}...[truncated]`;
    return result;
  }

  // packages/report-client/src/redaction.ts
  function redact(text, maxLength = 4e3) {
    return redactAcpText(text, maxLength);
  }

  // packages/report-client/src/index.ts
  var ReportError = class extends Error {
    constructor(message, code, status = 0) {
      super(message);
      this.code = code;
      this.status = status;
      this.name = "ReportError";
    }
  };
  var ReportAuthRequired = class extends ReportError {
    constructor() {
      super("Sign in to send or read your reports", "report_auth_required", 401);
      this.name = "ReportAuthRequired";
    }
  };
  var ReportSubmissionUncertain = class extends ReportError {
    constructor(submissionId) {
      super("The submission response was lost. Recover or retry this same submission ID.", "report_submission_uncertain");
      this.submissionId = submissionId;
      this.name = "ReportSubmissionUncertain";
    }
  };
  var uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  var keys = ["schema", "kind", "visibility", "product", "version", "buildId", "os", "title", "body", "joinShortId", "context"];
  function invalid(message) {
    throw new ReportError(message, "invalid_report", 400);
  }
  function validate(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).some((k) => !keys.includes(k))) invalid("Invalid report fields");
    if (!["xeno.report/1", "xeno.report/2"].includes(payload.schema) || !["bug", "feature", "feedback"].includes(payload.kind) || !["public", "private"].includes(payload.visibility)) invalid("Invalid report destination or kind");
    if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(payload.product)) invalid("Invalid product");
    for (const [key, max] of [["title", 200], ["body", 16e3], ["version", 32], ["buildId", 120], ["os", 120]]) {
      const value = payload[key];
      if (value !== void 0 && (typeof value !== "string" || value.length > max)) invalid(`Invalid ${key}`);
      if (typeof value === "string" && redact(value, Number.MAX_SAFE_INTEGER) !== value) invalid("Compose and review the redacted payload before sending");
    }
    if (typeof payload.title !== "string" || payload.title.trim().length < 8 || typeof payload.body !== "string" || !payload.body.trim()) invalid("A title and description are required");
    if (payload.joinShortId !== void 0 && (payload.visibility !== "public" || !/^[a-z0-9]{4,32}$/.test(payload.joinShortId))) invalid("Only public reports can join an existing report");
    const c = payload.context;
    if (!c || typeof c !== "object" || Array.isArray(c) || Object.keys(c).some((k) => !["recentLog", "repro", "attachments"].includes(k))) invalid("Invalid context");
    if (c.recentLog !== void 0 && (!Array.isArray(c.recentLog) || c.recentLog.length > 200 || c.recentLog.some((s) => typeof s !== "string" || s.length > 4e3))) invalid("Invalid recent log");
    if (c.repro !== void 0 && (typeof c.repro !== "string" || c.repro.length > 1e4)) invalid("Invalid reproduction steps");
    if (c.attachments !== void 0) {
      if (!Array.isArray(c.attachments) || c.attachments.length > 3 || payload.schema === "xeno.report/1" && c.attachments.length) invalid("Invalid attachments");
      let total = 0;
      for (const a of c.attachments) {
        if (!a || !uuid.test(a.id) || !/^[a-f0-9]{64}$/.test(a.sha256) || typeof a.name !== "string" || a.name.length > 120 || !["image/png", "image/jpeg", "image/webp", "video/webm", "video/mp4"].includes(a.type) || !Number.isSafeInteger(a.bytes) || a.bytes < 1 || a.bytes > 8 * 1024 * 1024 || typeof a.data !== "string" || a.data.length !== 4 * Math.ceil(a.bytes / 3) || !/^[A-Za-z0-9+/]*={0,2}$/.test(a.data)) invalid("Invalid attachment");
        total += a.bytes;
      }
      if (total > 12 * 1024 * 1024) invalid("Attachments exceed 12 MiB");
    }
    if ([...c.recentLog ?? [], c.repro ?? ""].some((s) => redact(s, Number.MAX_SAFE_INTEGER) !== s)) invalid("Review redacted context before sending");
    if (JSON.stringify({ ...c, attachments: void 0 }).length > 12e3) invalid("Context is too large");
    const env = [`- product: ${payload.product}`, payload.version ? `- version: ${payload.version}` : null, payload.os ? `- os: ${payload.os}` : null, payload.buildId ? `- build: ${payload.buildId}` : null].filter(Boolean).join("\n");
    const contextText = JSON.stringify({ ...c, attachments: void 0 });
    if (`${payload.body.trim()}

---
${env}${contextText}`.length > 19e3) invalid("Report and context are too large");
  }
  function serializeReport(payload) {
    validate(payload);
    return JSON.stringify(payload, null, 2);
  }
  function newReportSubmissionId() {
    return globalThis.crypto.randomUUID();
  }
  function createReportClient(options) {
    const origin = new URL(options.baseUrl);
    if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(options.product)) invalid("Invalid product");
    if (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)))
      throw new ReportError("Report credentials require HTTPS", "invalid_report_origin");
    if (origin.username || origin.password || origin.search || origin.hash) throw new ReportError("Invalid report origin", "invalid_report_origin");
    const base = origin.href.replace(/\/$/, "") + "/api/forum";
    if (options.session && (typeof location === "undefined" || origin.origin !== location.origin || origin.pathname !== "/")) invalid("Session reports require the current origin");
    const send = options.fetch ?? globalThis.fetch;
    const submissions = /* @__PURE__ */ new WeakMap();
    async function request(path, init = {}, submissionId) {
      const token = await options.getAccessToken();
      if (!token && !options.session?.getUserId()) throw new ReportAuthRequired();
      const csrf = options.session?.getCsrfToken();
      const actor = options.session?.getUserId();
      let response;
      try {
        response = await send(base + path, { ...init, redirect: "error", ...options.session ? { credentials: "same-origin" } : {}, headers: { "Content-Type": "application/json", ...token ? { Authorization: `Bearer ${token}` } : { "x-xeno-surface": "xeno-web", ...csrf ? { "x-xeno-csrf": csrf } : {}, ...actor ? { "x-xeno-report-actor": actor } : {} }, ...submissionId ? { "Idempotency-Key": submissionId } : {} } });
      } catch {
        if (submissionId) throw new ReportSubmissionUncertain(submissionId);
        throw new ReportError("Report service could not be reached", "report_service_unreachable");
      }
      if (response.status === 401) throw new ReportAuthRequired();
      let body;
      try {
        body = await response.json();
      } catch {
        if (submissionId) throw new ReportSubmissionUncertain(submissionId);
        throw new ReportError("Invalid report service response", "report_invalid_response", response.status);
      }
      if (!response.ok || body?.success === false) {
        if (submissionId && response.status >= 500) throw new ReportSubmissionUncertain(submissionId);
        throw new ReportError(body?.error ?? "Report request failed", body?.code ?? "report_request_failed", response.status);
      }
      return body;
    }
    return {
      collectContext: async () => options.collectContext ? options.collectContext() : {},
      compose(draft) {
        const redactions = [];
        const clean = (text, field) => {
          if (typeof text !== "string") invalid(`Invalid ${field}`);
          const result = redact(text, Number.MAX_SAFE_INTEGER);
          if (result !== text) redactions.push({ field });
          return result;
        };
        const context = {};
        if (draft.context?.recentLog !== void 0) context.recentLog = draft.context.recentLog.map((s, i) => clean(s, `context.recentLog.${i}`));
        if (draft.context?.repro !== void 0) context.repro = clean(draft.context.repro, "context.repro");
        if (draft.context?.attachments !== void 0) context.attachments = draft.context.attachments.map((a) => Object.freeze({ ...a, name: clean(a.name, "attachment.name") }));
        if (draft.context && Object.keys(draft.context).some((k) => !["recentLog", "repro", "attachments"].includes(k))) invalid("Unknown context field");
        const payload = {
          schema: "xeno.report/2",
          product: options.product,
          kind: draft.kind,
          visibility: draft.visibility,
          title: clean(draft.title, "title").trim(),
          body: clean(draft.body, "body").trim(),
          context,
          ...options.version !== void 0 ? { version: clean(options.version, "version") } : {},
          ...options.buildId !== void 0 ? { buildId: clean(options.buildId, "buildId") } : {},
          ...draft.os !== void 0 ? { os: clean(draft.os, "os") } : {},
          ...draft.joinShortId !== void 0 ? { joinShortId: draft.joinShortId } : {}
        };
        validate(payload);
        if (context.recentLog) Object.freeze(context.recentLog);
        if (context.attachments) Object.freeze(context.attachments);
        Object.freeze(context);
        Object.freeze(payload);
        return { payload, redactions };
      },
      async preflight(title) {
        const clean = redact(title, 240).trim();
        if (clean.length < 8) return [];
        const result = await request("/report/preflight", { method: "POST", body: JSON.stringify({ title: clean, product: options.product }) });
        return result.candidates ?? [];
      },
      async submit(payload, { submissionId } = {}) {
        const body = serializeReport(payload);
        const id = submissionId ?? submissions.get(payload) ?? newReportSubmissionId();
        if (!uuid.test(id)) invalid("Invalid submission ID");
        submissions.set(payload, id);
        const result = await request("/report", { method: "POST", body }, id);
        if (typeof result?.shortId !== "string" || !/^[a-z0-9]{4,32}$/.test(result.shortId) || result.private !== (payload.visibility === "private")) throw new ReportSubmissionUncertain(id);
        return { ...result, private: payload.visibility === "private", ...payload.visibility === "public" ? { url: `${origin.origin}/forum/t/${result.shortId}` } : {} };
      },
      async recover(submissionId) {
        if (!uuid.test(submissionId)) invalid("Invalid submission ID");
        return request(`/report/submissions/${encodeURIComponent(submissionId)}`);
      },
      async mine() {
        return request("/report/mine");
      },
      async notifications() {
        return request("/notifications?unread=true");
      }
    };
  }
  return __toCommonJS(index_exports);
})();
