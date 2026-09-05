// A local UI preview uses real authentication and migrations, but must not
// execute copied schedules, notifications or filesystem cleanup jobs.
export function isLocalPreview(env = process.env) {
  if (env.XENO_LOCAL_PREVIEW !== 'true') return false;
  if (env.NODE_ENV !== 'development' || env.DB_HOST !== '127.0.0.1' || env.BACKEND_HOST !== '127.0.0.1') {
    throw new Error('Local preview requires development mode and loopback database/API bindings');
  }
  return true;
}

export function matchesPreviewReadiness(body, instance) {
  return Boolean(instance) && body?.status === 'ready' && body.preview?.instance === instance && body.preview?.backgroundWork === false;
}

export function hasOnlyLoopbackListeners(addresses) {
  return Array.isArray(addresses) && addresses.length > 0 && addresses.every(address => address === '127.0.0.1' || address === '::1');
}
