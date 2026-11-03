// Walk 5: selling a team, all through the screens, three people.
//   seller: creates a company, an agent, gives it a persona (Identity), makes a team with it, starts selling, publishes the team
//   reviewer (XENO staff): reads it in the Review queue and approves it
//   buyer: finds it in the store, gets it (free), places it, and the agent they get is the same agent: same persona
import { browser, page, go, text, clickText, shot, ok, failures, wait, sql, newPerson, fill, submit, dialog } from './lib.mjs';
const flat = (s, n = 300) => String(s).slice(0, n).replace(/\n/g, ' | ');
const click = async (p, sel) => { await p.waitForSelector(sel, { timeout: 15000 }); await p.click(sel); await wait(1200); };
const RUN = Date.now().toString(36);
const CO = `Sela Studio ${RUN}`, AG = `Release Reviewer ${RUN}`, TEAM = `Release crew ${RUN}`;
const PERSONA_ROLE = 'a careful release reviewer';
const VOICE = 'Plain and short. Says what is blocking a release first.';
const b = await browser();
const seller = await page(b);
let listingSlug = null;
try {
  // ---------------- seller ----------------
  const s = await newPerson(seller, 'Sela');
  await go(seller, '/workspace/corpo/spaces/company', 2500);
  ok(!!(await clickText(seller, 'Create a company')), 'a person can start a company'); await wait(800);
  await fill(seller, 'name', CO); await submit(seller); await wait(3000);
  const ws = sql(`SELECT w.id FROM workspaces w WHERE w.name='${CO}'`);
  ok(/^[0-9a-f-]{36}$/.test(ws), 'the company exists', ws);
  console.log('after company at', seller.url(), '::', flat(await text(seller, '#main'), 200));

  await go(seller, `/workspace/workspace/Agents?ws=${ws}`, 2500);
  console.log('agents page:', flat(await text(seller, '#main'), 200));
  ok(!!(await seller.$('[data-xag=new]')), 'the Agents page offers to create one'); await click(seller, '[data-xag=new]');
  await fill(seller, 'name', AG); await submit(seller); await wait(1500);
  if (/Where will/.test(await dialog(seller))) { await seller.keyboard.press('Escape'); await wait(800); }
  const agentId = sql(`SELECT a.agent_id FROM platform_agents a WHERE a.name='${AG}' LIMIT 1`).trim() || sql(`SELECT id FROM workforce_resources WHERE kind='agent' AND name='${AG}' LIMIT 1`);
  console.log('agent id:', agentId, 'url:', seller.url());
  const agentUrl = (seller.url().match(/agt_[A-Za-z0-9]+/) || [])[0] || null;
  const agt = agentUrl || (await seller.evaluate(() => (location.pathname.match(/agt_[A-Za-z0-9]+/) || [])[0]));
  ok(!!agt, 'the new agent has its own page', seller.url());
  await go(seller, `/workspace/workspace/Agents/${agt}/Identity?ws=${ws}`, 2500);
  await seller.type('form[data-xag-form=identity] input[name=role]', PERSONA_ROLE, { delay: 3 });
  await seller.type('form[data-xag-form=identity] textarea[name="s_Voice"]', VOICE, { delay: 2 });
  await click(seller, 'form[data-xag-form=identity] button[type=submit]'); await wait(1500);
  const saved = sql(`SELECT v.content->'persona'->>'role' FROM workforce_agent_versions v JOIN workforce_resources r ON r.id=v.resource_id WHERE r.name='${AG}' ORDER BY v.version DESC LIMIT 1`);
  ok(saved === PERSONA_ROLE, 'the persona is saved as a new version of the agent', saved);

  await go(seller, `/workspace/workspace/Teams?ws=${ws}`, 4500);
  await seller.waitForSelector('[data-xteam=new]', { timeout: 20000 }).catch(() => {});
  ok(!!(await seller.$('[data-xteam=new]')), 'New team can be pressed', flat(await text(seller, '#main'), 300)); await click(seller, '[data-xteam=new]');
  await fill(seller, 'name', TEAM);
  const box = await seller.$$('.xd .xd-checks button[role=checkbox]'); for (const c of box) await c.click();
  ok(box.length >= 1, 'the team form offers the company’s agents', box.length);
  await submit(seller); await wait(2000);
  ok(sql(`SELECT count(*) FROM workforce_team_memberships m JOIN workforce_resources t ON t.id=m.team_id WHERE t.name='${TEAM}' `) === '1', 'the team has the agent in it');

  await go(seller, `/workspace/market/Seller console?ws=${ws}`, 2500);
  console.log('seller console:', flat(await text(seller, '#main'), 200));
  if (await seller.$('[data-xmk=register]')) { await click(seller, '[data-xmk=register]'); await fill(seller, 'name', CO); await submit(seller); await wait(3000); console.log('after register:', flat(await text(seller, '#main'), 300)); }
  ok(!!(await seller.$('[data-xmk=publishTeam]')), 'the seller console offers Publish a team');
  await click(seller, '[data-xmk=publishTeam]');
  console.log('publish dialog:', flat(await dialog(seller), 250));
  await fill(seller, 'summary', 'Reviews every release before it ships.'); await submit(seller); await wait(2500);
  const after = await text(seller);
  console.log('after publish:', flat(after.match(/Sent to review[^\n]*/)?.[0] || after.slice(0, 200)));
  const lst = sql(`SELECT id||'|'||slug||'|'||status FROM marketplace_listings WHERE kind='team' ORDER BY created_at DESC LIMIT 1`);
  ok(!!lst, 'a team listing exists', lst); listingSlug = lst.split('|')[1];
  const pkgPersona = sql(`SELECT team_package->'members'->0->'persona'->>'role' FROM marketplace_listing_versions v JOIN marketplace_listings l ON l.id=v.listing_id WHERE l.kind='team' ORDER BY v.created_at DESC LIMIT 1`);
  ok(pkgPersona === PERSONA_ROLE, 'the package carries the agent’s persona (this morning’s fix)', pkgPersona);
  await shot(seller, 'market-seller');

  // ---------------- reviewer ----------------
  const rp = await page(b);
  const r = await newPerson(rp, 'Rev');
  sql(`UPDATE users SET role='admin' WHERE id='${r.id}'`);   // XENO staff, on this throwaway database only
  await go(rp, '/workspace/market/Review', 3000);
  const q = await text(rp, '#main'); console.log('review queue:', flat(q, 400));
  ok(new RegExp(TEAM).test(q), 'the reviewer sees the team in the queue');
  ok(q.includes(PERSONA_ROLE) && q.includes('Says what is blocking a release first') && /Its instructions/.test(q), 'the reviewer reads who each agent is and its instructions', flat(q, 500));
  await rp.click('[data-xmk=review]').catch(() => {}); await wait(1200);
  console.log('review open:', flat(await dialog(rp) || await text(rp, '#main'), 400));
  const approve = await rp.$('[data-xmk=approve]');
  ok(!!approve, 'Approve is offered'); if (approve) { await approve.click(); await wait(1500); if (await rp.$('.xd')) { await submit(rp); await wait(1500); } }
  ok(sql(`SELECT count(*) FROM marketplace_listing_versions v JOIN marketplace_listings l ON l.id=v.listing_id WHERE l.slug='${listingSlug}' AND v.published_at IS NOT NULL`) === '1', 'approving publishes the version');

  // ---------------- buyer ----------------
  const bp = await page(b);
  const buyer = await newPerson(bp, 'Bea');
  await go(bp, '/workspace/market', 3000);
  const store = await text(bp, '#main'); ok(new RegExp(TEAM).test(store), 'the buyer finds the team in the store', flat(store, 300));
  await go(bp, `/workspace/market/l/${listingSlug}`, 3000);
  const lp = await text(bp, '#main'); console.log('listing page:', flat(lp, 500));
  ok(new RegExp(AG).test(lp) && /Who comes with it/.test(lp), 'the listing says which agents come with it');
  ok(!/careful release reviewer|Plain and short/.test(lp), 'the persona text is not shown before buying');
  const buy = await bp.$('[data-xmk=buy]'); ok(!!buy, 'Get / Buy is offered');
  if (buy) { await buy.click(); await wait(1500); if (await bp.$('.xd')) { console.log('buy dialog:', flat(await dialog(bp), 200)); await submit(bp); await wait(2000); } }
  const imp = await bp.$('[data-xmk=import]'); ok(!!imp, 'after getting it, the buyer can place the team');
  if (imp) { await imp.click(); await wait(1500); console.log('import dialog:', flat(await dialog(bp), 300)); if (await bp.$('.xd')) { await submit(bp); await wait(2500); } }
  const got = sql(`SELECT v.content->'persona'->>'role' FROM marketplace_team_imports i JOIN LATERAL unnest(i.member_agent_ids) a(id) ON true JOIN workforce_agent_versions v ON v.resource_id=a.id WHERE i.imported_by_user_id='${buyer.id}' LIMIT 1`);
  ok(got === PERSONA_ROLE, 'the buyer’s copy of the agent is the same agent: its persona arrived', got);
  await shot(bp, 'market-buyer');
  for (const pg of [seller, rp, bp]) if (pg.bad.length) console.log('5xx on a page:', pg.bad.filter((x) => !x.includes('/api/automate/catalogue')));
} catch (e) { ok(false, 'walk crashed', e.stack); await shot(seller, 'market-crash'); }
finally { await b.close(); process.exitCode = failures() ? 1 : 0; }
