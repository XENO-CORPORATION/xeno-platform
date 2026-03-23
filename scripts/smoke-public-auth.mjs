const BASE_URL = process.env.SMOKE_BASE_URL || 'https://xenostudio.ai';
const RETURN_URL = process.env.SMOKE_RETURN_URL || 'xeno://auth/callback';

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

async function fetchJson(path) {
  const res = await fetch(`${BASE_URL}${path}`, { redirect: 'manual' });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  return { res, data };
}

async function fetchHead(path) {
  return fetch(`${BASE_URL}${path}`, { method: 'GET', redirect: 'manual' });
}

async function main() {
  console.log(`Smoke target: ${BASE_URL}`);

  const statusCheck = await fetchJson('/api/status');
  if (statusCheck.res.status !== 200) {
    fail(`/api/status returned ${statusCheck.res.status}`);
  }
  if (!statusCheck.data || statusCheck.data.status !== 'ok') {
    fail('/api/status body did not contain status=ok');
  }
  pass('/api/status returned 200 with status=ok');

  const authPath = `/api/auth/google?returnUrl=${encodeURIComponent(RETURN_URL)}`;
  const authCheck = await fetchHead(authPath);
  const location = authCheck.headers.get('location') || '';

  if (authCheck.status !== 302) {
    fail(`${authPath} returned ${authCheck.status}, expected 302`);
  }
  if (!location.startsWith('https://accounts.google.com/o/oauth2/')) {
    fail(`${authPath} redirected to unexpected location: ${location || '<empty>'}`);
  }
  if (!location.includes(encodeURIComponent('https://xenostudio.ai/api/auth/google/callback'))) {
    fail('Google OAuth redirect is missing the expected callback URL');
  }
  pass('/api/auth/google returned a valid Google OAuth redirect');

  console.log('Smoke checks passed.');
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
