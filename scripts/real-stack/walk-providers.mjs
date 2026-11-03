// Walk 4: Settings › Provider keys & inference. A person adds a key: confirm it's you, then the provider checks it.
//   a made-up OpenAI key is refused by OpenAI itself, with words a person understands; nothing is stored
//   an "OpenAI-compatible" endpoint on this machine or a private network is refused before any request (SSRF)
//   the products list and "where each product's AI comes from" render
// Not exercised: a key that works. That needs a real paid key, which a test should not hold.
import { browser, page, go, text, clickText, shot, ok, failures, wait, sql, newPerson, fill, submit, dialog, dialogWarn } from './lib.mjs';
const flat = (s, n = 300) => String(s).slice(0, n).replace(/\n/g, ' | ');
const b = await browser(); const p = await page(b);
const errOf = () => dialogWarn(p);
let offered = [];
async function tryKey(who, { provider, secret, baseUrl }) {
  ok(!!(await clickText(p, 'Add a key')), 'Add a key can be pressed'); await wait(1000);
  let d = await dialog(p);
  if (/Confirm it/.test(d)) { await fill(p, 'password', who.password); await submit(p); d = await dialog(p); }
  ok(/Add a provider key/.test(d), 'after confirming, the key form opens', flat(d));
  offered = await p.$$eval('#xdf-provider option', (o) => o.map((x) => x.value));
  await p.select('#xdf-provider', provider); await wait(200);
  await fill(p, 'label', `Test ${provider}`); await fill(p, 'secret', secret);
  if (baseUrl) await fill(p, 'baseUrl', baseUrl);
  await submit(p); await wait(6000);
  const said = await errOf(); await shot(p, `providers-${provider}-${baseUrl ? "endpoint" : "key"}`);
  await p.keyboard.press('Escape'); await wait(500); await p.keyboard.press('Escape'); await wait(400);
  return said;
}
try {
  const who = await newPerson(p, 'Kai');
  await go(p, '/workspace/settings/providers', 3000);
  const page0 = await text(p, '#main'); console.log('providers page:', flat(page0, 500));
  ok(/Your provider keys/.test(page0), 'the provider keys card renders');
  ok(/Where each product/.test(page0), 'the routing card renders');
  const providers = await p.$$eval('#xdf-provider option', (o) => o.map((x) => x.value)).catch(() => []);
  console.log('providers offered:', providers);
  await shot(p, 'providers');

  const bad = await tryKey(who, { provider: 'openai', secret: 'sk-proj-' + 'x'.repeat(48) });
  console.log('made-up OpenAI key says:', flat(bad));
  ok(!/Add a provider key[\s\S]*Add key\s*$/.test(bad) && /reject|isn.t valid|invalid|didn.t work|not accepted|couldn.t be added|check/i.test(bad), 'a made-up key is refused with a reason', flat(bad));

  console.log('providers offered:', offered);
  const compat = offered.find((x) => /compatible/i.test(x));
  if (compat) {
    for (const u of ['https://127.0.0.1:8091/v1', 'https://localhost/v1', 'https://192.168.2.1/v1', 'https://169.254.169.254/latest', 'https://10.0.0.5/v1']) {
      const said = await tryKey(who, { provider: compat, secret: 'anything-at-all-123', baseUrl: u });
      console.log(`endpoint ${u} says:`, flat(said));
      ok(/not allowed|private|local|isn.t allowed|public|refus|https/i.test(said), `an endpoint at ${u} is refused`, flat(said));
    }
  } else ok(false, 'an OpenAI-compatible provider is offered', offered.join(','));
  ok(sql(`SELECT count(*) FROM user_provider_credentials WHERE user_id='${who.id}'`) === '0', 'nothing refused was stored');
} catch (e) { ok(false, 'walk crashed', e.stack); await shot(p, 'providers-crash'); console.log('dialog:', flat(await dialog(p))); }
finally { console.log('5xx:', p.bad.filter((x) => !x.includes('/api/automate/catalogue')), 'errors:', p.errs.slice(0, 3)); await b.close(); process.exitCode = failures() ? 1 : 0; }
