// GENERATED from xeno-agent-interface/acpTextRedaction.ts; regenerate with scripts/sync-report-redaction.mjs.

// ../xeno-agent-interface/packages/host/src/acp/acpTextRedaction.ts
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
export {
  redactAcpText
};
