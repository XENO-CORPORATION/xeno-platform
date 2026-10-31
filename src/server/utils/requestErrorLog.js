// The global error handler logs every error by its stack. A body-parser rejection is the one
// case where that stack carries the request body: a JSON syntax error quotes the text it could
// not parse, so a malformed refresh token would reach the log in fragments. Those rejections
// are logged by kind and status only. Every other error keeps its stack, as before.
//
// The response is unchanged: index.js already answers these with a generic body in production.
const BODY_REJECTION_TYPES = new Set([
  'entity.parse.failed',
  'entity.verify.failed',
  'entity.too.large',
  'charset.unsupported',
  'encoding.unsupported',
  'request.aborted',
  'request.size.invalid',
  'stream.encoding.set',
]);

export function describeRequestError(err) {
  if (BODY_REJECTION_TYPES.has(err?.type)) {
    return `request body rejected (${err.type}, status ${err.status ?? 'unknown'})`;
  }
  return err?.stack || err?.message || err;
}
