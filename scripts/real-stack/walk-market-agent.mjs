// Walk 10: selling one agent, all through the screens, four people.
//   seller: creates a company and an agent, gives it instructions, publishes it to rent or to copy
//   reviewer (XENO staff): reads what's being sold, and approves it
//   buyer: reads the listing, which doesn't show the instructions, gets a copy and adds it
//   renter: rents it and asks it something
// Not exercised: a rental's answer. This stack has no xeno-agents-api, so the walk holds it to saying that honestly and charging nothing.
import { browser, page, go, text, clickText, shot, ok, failures, wait, sql, newPerson, fill, submit, dialog } from './lib.mjs';
const flat = (s, n = 300) => String(s).slice(0, n).replace(/\n/g, ' | ');
const click = async (p, sel) => { await p.waitForSelector(sel, { timeout: 15000 }); await p.click(sel); await wait(1200); };
const RUN = Date.now().toString(36), CO = `Lexa Studio ${RUN}`, AG = `Contract Reader ${RUN}`;
const ROLE = 'a careful contract reader', VOICE = 'Names the clause first, then the risk.';
// What this stack doesn't have: no runner for Automate, no XENO API key for the model list, and no agents-api, which the walk asserts above.
const unexpected = (x) => !['/api/automate/catalogue', '/api/models', '503 POST /api/marketplace/invoke/'].some((known) => x.includes(known));
const b = await browser(), seller = await page(b);
try {
  await newPerson(seller, 'Lexa');
  await go(seller, '/workspace/corpo/spaces/company', 2500);
  ok(!!(await clickText(seller, 'Create a company')), 'a person can start a company'); await wait(800);
  await fill(seller, 'name', CO); await submit(seller); await wait(3000);
  const ws = sql(`SELECT id FROM workspaces WHERE name='${CO}'`);
  await go(seller, `/workspace/workspace/Agents?ws=${ws}`, 2500);
  await click(seller, '[data-xag=new]');
  await fill(seller, 'name', AG); await submit(seller); await wait(1500);
  if (/Where will/.test(await dialog(seller))) { await seller.keyboard.press('Escape'); await wait(800); }
  const agt = (seller.url().match(/agt_[A-Za-z0-9]+/) || [])[0];
  ok(!!agt, 'the agent has its own page', seller.url());
  await go(seller, `/workspace/workspace/Agents/${agt}/Identity?ws=${ws}`, 2500);
  await seller.type('form[data-xag-form=identity] input[name=role]', ROLE, { delay: 3 });
  await seller.type('form[data-xag-form=identity] textarea[name="s_Voice"]', VOICE, { delay: 2 });
  await click(seller, 'form[data-xag-form=identity] button[type=submit]'); await wait(1500);

  await go(seller, `/workspace/market/Seller console?ws=${ws}`, 2500);
  if (await seller.$('[data-xmk=register]')) { await click(seller, '[data-xmk=register]'); await fill(seller, 'name', CO); await submit(seller); await wait(3000); }
  ok(!!(await seller.$('[data-xmk=publishAgent]')), 'the seller console offers Publish an agent', flat(await text(seller, '#main')));
  await click(seller, '[data-xmk=publishAgent]');
  await fill(seller, 'summary', 'Reads contracts and flags risk.');
  await seller.select('#xdf-how', 'both');
  await submit(seller); await wait(3000);
  ok(/Sent to review/.test(await text(seller)), 'it goes to review, and says so', flat(await dialog(seller) || await text(seller), 400));
  const listing = sql(`SELECT id||'|'||slug FROM marketplace_listings WHERE kind='mind' ORDER BY created_at DESC LIMIT 1`), [listingId, slug] = listing.split('|');
  ok(!!slug, 'a listing exists', listing);
  const stored = sql(`SELECT v.agent_definition::text FROM marketplace_listing_versions v WHERE v.listing_id='${listingId}' ORDER BY v.created_at DESC LIMIT 1`);
  ok(stored.includes(ROLE) && stored.includes(VOICE), 'the version carries who the agent is', flat(stored));
  ok(!/memory|credential|soul/i.test(Object.keys(JSON.parse(stored)).join()), 'and nothing it isn’t allowed to carry', flat(stored));
  await shot(seller, 'agent-seller');

  const rp = await page(b), r = await newPerson(rp, 'Rev');
  sql(`UPDATE users SET role='admin' WHERE id='${r.id}'`);   // XENO staff, on this throwaway database only
  await go(rp, '/workspace/market/Review', 3000);
  const q = await text(rp, '#main');
  ok(q.includes(AG) && q.includes(ROLE) && q.includes(VOICE), 'the reviewer reads the agent and its instructions', flat(q, 500));
  await click(rp, '[data-xmk=approve]');
  if (await rp.$('.xd')) { await submit(rp); await wait(2000); }
  ok(sql(`SELECT count(*) FROM marketplace_listing_versions WHERE listing_id='${listingId}' AND published_at IS NOT NULL`) === '1', 'approving publishes it');

  const bp = await page(b); await newPerson(bp, 'Bea');
  await go(bp, '/workspace/market', 3000);
  ok((await text(bp, '#main')).includes(AG), 'a buyer finds it in the store');
  await go(bp, `/workspace/market/l/${slug}`, 3000);
  const lp = await text(bp, '#main');
  ok(/What this agent is/.test(lp) && !lp.includes(VOICE), 'the listing says what it is, without its instructions', flat(lp, 500));
  await shot(bp, 'agent-listing');
  const free = await bp.$$eval('[data-xmk=buy]', (x) => x.findIndex((n) => !/Rent/.test(n.innerText)));
  ok(free >= 0, 'a copy is offered', flat(lp, 500));
  await bp.evaluate((i) => document.querySelectorAll('[data-xmk=buy]')[i].click(), free); await wait(1500);
  if (await bp.$('.xd')) { await submit(bp); await wait(2500); }
  await click(bp, '[data-xmk=importAgent]');
  ok(/terms/.test(await dialog(bp)), 'adding it names the terms first', flat(await dialog(bp)));
  await submit(bp); await wait(3000);
  const copy = (bp.url().match(/agt_[A-Za-z0-9]+/) || [])[0];
  ok(!!copy && copy !== agt, 'the buyer gets their own agent, at its own address', bp.url());
  const held = sql(`SELECT v.content->'persona'->>'role' FROM workforce_agent_versions v JOIN agent_identities a ON a.workforce_resource_id=v.resource_id WHERE a.public_id='${copy}' ORDER BY v.version DESC LIMIT 1`);
  ok(held === ROLE, 'and the copy is the same agent', held);

  const tp = await page(b); const t = await newPerson(tp, 'Tom');
  await go(tp, `/workspace/market/l/${slug}`, 3000);
  const rent = await tp.$$eval('[data-xmk=buy]', (x) => x.findIndex((n) => /Rent/.test(n.innerText)));
  ok(rent >= 0, 'renting is offered');
  await tp.evaluate((i) => document.querySelectorAll('[data-xmk=buy]')[i].click(), rent); await wait(1500);
  if (await tp.$('.xd')) { await submit(tp); await wait(2500); }
  await go(tp, '/workspace/market/Rentals', 3000);
  ok((await text(tp, '#main')).includes(AG), 'the rental is on Rentals', flat(await text(tp, '#main'), 400));
  const before = sql(`SELECT COALESCE(sum(amount),0) FROM credit_transactions t JOIN credit_accounts a ON a.id=t.account_id WHERE a.user_id='${t.id}'`);
  await click(tp, '[data-xmk=ask]');
  await fill(tp, 'prompt', 'Read clause 4'); await submit(tp); await wait(3500);
  const answer = await text(tp, '#main');
  ok(/can’t run hosted agents right now\. Nothing was charged/.test(answer), 'with nothing to run it, it says so', flat(answer, 500));
  ok(sql(`SELECT COALESCE(sum(amount),0) FROM credit_transactions t JOIN credit_accounts a ON a.id=t.account_id WHERE a.user_id='${t.id}'`) === before, 'and really charges nothing');
  await shot(tp, 'agent-rentals');
  for (const pg of [seller, rp, bp, tp]) ok(!pg.bad.filter(unexpected).length, 'no server errors on the way', pg.bad.filter(unexpected).join(' '));
} catch (e) { ok(false, 'walk crashed', e.stack); await shot(seller, 'agent-crash'); }
finally { await b.close(); process.exitCode = failures() ? 1 : 0; }
