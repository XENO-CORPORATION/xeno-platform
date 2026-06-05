const API_BASE_URL = process.env.SMOKE_API_BASE_URL || 'https://api.xenostudio.ai';

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

async function fetchManual(path, init = {}) {
  return fetch(`${API_BASE_URL}${path}`, {
    redirect: 'manual',
    ...init,
  });
}

async function main() {
  console.log(`Smoke target: ${API_BASE_URL}`);

  const pricingCheck = await fetchManual('/v1/pricing');
  if (pricingCheck.status !== 200) {
    fail(`/v1/pricing returned ${pricingCheck.status}`);
  }
  pass('/v1/pricing returned 200');

  const modelsCheck = await fetchManual('/v1/models');
  if (modelsCheck.status !== 200 && modelsCheck.status !== 401 && modelsCheck.status !== 403) {
    fail(`/v1/models returned ${modelsCheck.status}, expected 200/401/403`);
  }
  pass(`/v1/models returned ${modelsCheck.status}`);

  const chatCheck = await fetchManual('/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'smoke test' }],
      stream: false,
    }),
  });
  if (chatCheck.status !== 401 && chatCheck.status !== 403) {
    fail(`/v1/chat/completions returned ${chatCheck.status}, expected 401/403 without auth`);
  }
  pass(`/v1/chat/completions returned ${chatCheck.status} without auth`);

  console.log('Public API smoke checks passed.');
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
