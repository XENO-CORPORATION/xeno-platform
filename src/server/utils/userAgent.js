/**
 * userAgent — a deliberately small User-Agent classifier for the session list.
 *
 * WHY NOT A LIBRARY: the only consumer is the "your devices" list and session
 * review. That needs "Chrome on Windows, desktop" — not a 2 MB regex database that
 * distinguishes phone models. A small parser we can read beats a dependency we
 * cannot audit for a cosmetic field.
 *
 * WHY THIS EXISTS AT ALL: `user_sessions` has device_type, browser and os columns
 * and NOTHING has ever written them, so every session row in production is blank in
 * all three. A device list that cannot name the device is not a device list.
 *
 * ⚠️ HONEST LIMITS. A User-Agent is self-reported and freely spoofed, so this is a
 * display convenience and NEVER a security signal. Do not gate anything on it. Modern
 * browsers also freeze and lie in the UA string by design (Chrome reports a frozen
 * platform version), so treat the output as approximate.
 */

/** Browser name, or null when it cannot be told apart with confidence. */
export function parseBrowser(ua) {
  const s = String(ua || '');
  if (!s) return null;
  // ORDER MATTERS and is the whole difficulty of UA parsing: Edge and Opera both
  // contain "Chrome", and Chrome contains "Safari". Most specific first, always.
  if (/\bEdgA?\/|\bEdge\//i.test(s)) return 'Edge';
  if (/\bOPR\/|\bOpera\//i.test(s)) return 'Opera';
  if (/\bBrave\//i.test(s)) return 'Brave';
  if (/\bFirefox\/|\bFxiOS\//i.test(s)) return 'Firefox';
  if (/\bChrome\/|\bCriOS\//i.test(s)) return 'Chrome';
  if (/\bSafari\//i.test(s)) return 'Safari';
  if (/\bElectron\//i.test(s)) return 'Electron';
  if (/\bcurl\/|\bwget\//i.test(s)) return 'curl';
  if (/\bnode\b|axios|got\/|undici/i.test(s)) return 'HTTP client';
  return null;
}

/** Operating system, or null. */
export function parseOs(ua) {
  const s = String(ua || '');
  if (!s) return null;
  // iPadOS reports as Macintosh in desktop mode, so check touch markers before mac.
  if (/\biPhone\b|\biPod\b/i.test(s)) return 'iOS';
  if (/\biPad\b/i.test(s)) return 'iPadOS';
  if (/\bAndroid\b/i.test(s)) return 'Android';
  if (/\bWindows NT\b/i.test(s)) return 'Windows';
  if (/\bMac OS X\b|\bMacintosh\b/i.test(s)) return 'macOS';
  if (/\bCrOS\b/i.test(s)) return 'ChromeOS';
  if (/\bLinux\b/i.test(s)) return 'Linux';
  return null;
}

/** 'mobile' | 'tablet' | 'desktop' | null. */
export function parseDeviceType(ua) {
  const s = String(ua || '');
  if (!s) return null;
  if (/\biPad\b/i.test(s) || (/\bAndroid\b/i.test(s) && !/\bMobile\b/i.test(s))) return 'tablet';
  if (/\bMobi\b|\bMobile\b|\biPhone\b|\biPod\b/i.test(s)) return 'mobile';
  if (/\bWindows NT\b|\bMacintosh\b|\bLinux\b|\bCrOS\b/i.test(s)) return 'desktop';
  return null;
}

/** All three at once, for a session row. Every field may be null. */
export function describeClient(ua) {
  return { browser: parseBrowser(ua), os: parseOs(ua), deviceType: parseDeviceType(ua) };
}

export default describeClient;
