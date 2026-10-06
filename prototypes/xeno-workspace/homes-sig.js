/* Home signature sections v5 — each mode demonstrates itself with the real thing, never a box about it.
   Studio: a render filmstrip that fills as frames finish + a masonry wall at true aspect ratios.
   Dev: a run board whose running card streams its log + a 24-hour automation timeline with a now line.
   Social: a week calendar with posts placed at their hour, reach per day. Office: today's agenda on a time
   axis, documents as pages that carry their titles, a mail triage list. Corpo: a revenue chart you can
   read point by point, a pipeline funnel, presence, SLA timers. Tools: a drop zone that reads the file.
   Live parts are simulated by one ticker (prototype); in the product they are the run/render streams. */
(() => {
  const X = () => window.XW, D = () => window.XENO_HOME;
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ic = (k) => X().ic(k), PR = () => window.XENO_PRODUCTS;
  const ago = (min) => (min < 60 ? `${min} min` : min < 1440 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} d`);
  const k = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k' : String(n));
  const sec = (title, sub, inner, link = '') => `<section class="hm2-sec"><div class="hm2-h"><h2>${esc(title)}</h2>${sub ? `<span class="hm2-sub">${sub}</span>` : ''}${link}</div>${inner}</section>`;
  const dayNames = (n) => Array.from({ length: n }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - (n - 1 - i)); return i === n - 1 ? 'Today' : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' }); });
  const nowH = () => { const d = new Date(); return d.getHours() + d.getMinutes() / 60; };

  // ---------- a chart you can read point by point (hover or arrow keys) ----------
  let uid = 0;
  function chart(series, { labels = dayNames(series.length), fmt = (v) => String(v), h = 36, focus = false, label = '' } = {}) {
    const W = 200, mn = Math.min(...series), mx = Math.max(...series), r = mx - mn || 1, id = 'hcg' + uid++;
    const pts = series.map((v, i) => [(i / (series.length - 1)) * W, h - 3 - ((v - mn) / r) * (h - 8)]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const last = pts[pts.length - 1];
    return `<div class="hc" data-series="${series.join(',')}" data-labels="${esc(labels.join('|'))}" data-fmt="${esc(fmt(0).replace(/0/, '#'))}" style="--h:${h}px"${focus ? ` tabindex="0" role="img" aria-label="${esc(label)}: ${esc(labels[0])} ${esc(fmt(series[0]))} to ${esc(labels[labels.length - 1])} ${esc(fmt(series[series.length - 1]))}. Use the arrow keys to read each point."` : ' aria-hidden="true"'}>
      <svg viewBox="0 0 ${W} ${h}" preserveAspectRatio="none"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fafafa" stop-opacity=".16"/><stop offset="1" stop-color="#fafafa" stop-opacity="0"/></linearGradient></defs><path d="${line} L${W} ${h} L0 ${h} Z" fill="url(#${id})"/><path class="hc-line" d="${line}" vector-effect="non-scaling-stroke"/></svg>
      <i class="hc-dot" style="left:${(last[0] / W) * 100}%;top:${(last[1] / h) * 100}%"></i><i class="hc-x"></i><span class="hc-tip"></span></div>`;
  }
  function readPoint(el, i) {
    const s = el.dataset.series.split(',').map(Number), L = el.dataset.labels.split('|'), fmt = el.dataset.fmt; i = Math.max(0, Math.min(s.length - 1, i)); el._i = i;
    const mn = Math.min(...s), mx = Math.max(...s), r = mx - mn || 1, h = el.clientHeight, x = (i / (s.length - 1)) * 100, y = ((h - 3 - ((s[i] - mn) / r) * (h - 8)) / h) * 100;
    el.classList.add('on'); el.querySelector('.hc-x').style.left = x + '%'; const d = el.querySelector('.hc-dot'); d.style.left = x + '%'; d.style.top = y + '%';
    const t = el.querySelector('.hc-tip'); t.textContent = `${L[i]} · ${fmt.replace('#', s[i].toLocaleString('en'))}`; t.style.left = Math.min(Math.max(x, 12), 88) + '%';
  }
  function releasePoint(el) { el.classList.remove('on'); const s = el.dataset.series.split(',').map(Number); readPoint(el, s.length - 1); el.classList.remove('on'); }
  document.addEventListener('mousemove', (e) => { const el = e.target.closest('.hc'); if (!el) return; const r = el.getBoundingClientRect(), n = el.dataset.series.split(',').length; readPoint(el, Math.round(((e.clientX - r.left) / r.width) * (n - 1))); });
  document.addEventListener('mouseout', (e) => { const el = e.target.closest?.('.hc'); if (el && !el.contains(e.relatedTarget)) releasePoint(el); });
  document.addEventListener('keydown', (e) => { const el = document.activeElement?.closest?.('.hc[tabindex]'); if (!el || !/^Arrow(Left|Right)$/.test(e.key)) return; e.preventDefault(); const n = el.dataset.series.split(',').length; readPoint(el, (el._i ?? n - 1) + (e.key === 'ArrowRight' ? 1 : -1)); });
  document.addEventListener('focusout', (e) => { if (e.target.classList?.contains('hc')) releasePoint(e.target); });

  // ---------- work wall: tiles at the file's real proportions, actions on hover ----------
  const ASPECT = { video: 16 / 9, image: 4 / 3, design: 16 / 10, audio: 3 / 1, document: 3 / 4, sheet: 4 / 3, deck: 16 / 9, code: 4 / 3, chat: 4 / 3, post: 1 };
  function wall(items) {
    return `<div class="hw">${items.map((f) => { const p = PR()[f.product]; const ar = f.media ? f.media.width / f.media.height : ASPECT[f.kind] || 4 / 3;
      return `<button class="hw-t" data-item-p="${f.product}" data-item="${esc(f.name)}" style="--ar:${ar.toFixed(3)}"><span class="hw-pv">${X().mini(f.product)}${f.duration ? `<em>${esc(f.duration)}</em>` : ''}</span><span class="hw-cap"><b>${esc(f.name)}</b><small>${p ? X().pIconFull(p, 12) : ''}${esc(p ? p.name : '')} · ${esc(f.when)}</small></span><span class="hw-go">Open in ${esc(p ? p.name : '')} ${ic('right')}</span></button>`; }).join('')}</div>`;
  }
  const libFor = (mode, n) => window.XENO_PG_LIBRARY.items.filter((f) => !f.trashedAt && (!mode || f.source.mode === mode)).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, n)
    .map((f) => ({ name: f.name, product: f.source.product === 'image' ? 'image' : f.source.product, kind: f.kind, media: f.media, duration: f.duration, when: ago(Math.round((Date.now() - Date.parse(f.updatedAt)) / 60000)) }));

  // =============================== STUDIO ===============================
  const LIVE = { pct: null, started: Date.now(), elapsed0: {}, log: {} };
  const STAGES = ['Prepare', 'Render', 'Encode', 'Upload'];
  function studio() {
    const S = D().studio, j = S.jobs[0], pct = LIVE.pct ?? (LIVE.pct = j.pct), done = Math.round((pct / 100) * j.frames), p = PR()[j.product];
    const tiles = Array.from({ length: 14 }, (_, i) => `<i class="fs-f${(i + 1) / 14 <= pct / 100 ? ' done' : ''}" style="--i:${i}"></i>`).join('');
    const job = `<div class="fs" data-live-job="${esc(j.name)}">
      <button class="fs-strip" data-item-p="${j.product}" data-item="${esc(j.name)}" aria-label="${esc(j.name)} — ${pct}% rendered">${tiles}<b class="fs-head" style="left:${pct}%"></b></button>
      <div class="fs-meta"><div class="fs-t"><b>${esc(j.name)}</b><small>${p ? X().pIconFull(p, 12) : ''}${esc(p ? p.name : '')} · ${esc(j.res)} · ${j.fps} fps · ${esc(j.codec)}</small></div>
        <div class="fs-num"><b data-live-pct>${pct}%</b><small data-live-eta>about ${Math.max(1, Math.round((100 - pct) / 12))} min left</small></div></div>
      <ol class="fs-steps">${STAGES.map((s, i) => `<li class="${i < j.stage ? 'done' : i === j.stage ? 'now' : ''}"><i>${i < j.stage ? ic('check') : ''}</i><span>${s}</span>${i === j.stage ? `<small data-live-frames>frame ${done.toLocaleString('en')} of ${j.frames.toLocaleString('en')}</small>` : ''}</li>`).join('')}</ol>
      <div class="fs-q">${S.queued.map(([t, pid, why]) => `<span>${PR()[pid] ? X().pIconFull(PR()[pid], 12) : ''}<b>${esc(t)}</b><small>${esc(why)}</small></span>`).join('')}</div></div>`;
    return sec('In production', `<span class="hs-live"><i></i>Rendering now</span>`, job) + sec('Your work', 'newest first, at their real proportions', wall(libFor('studio', 9)), `<button class="hm2-link" data-go="library">Library ${ic('right')}</button>`);
  }

  // =============================== DEV ===============================
  function dev() {
    const A = window.XENO_PG_AREAS['dev.agents'], logs = D().dev.logs, avatar = (n) => `<span class="pg-av agent" title="${esc(n)}">${ic('bot')}</span>`;
    const card = (r) => { const [name, ws, agent, status, dur, cost] = r;
      if (status === 'Running') { const L = logs[name] || []; LIVE.log[name] ??= Math.min(4, L.length);
        return `<div class="rb-c live" data-live-run="${esc(name)}"><button class="rb-h" data-item-p="agent" data-item="${esc(name)}">${avatar(agent)}<b>${esc(name)}</b><small data-live-elapsed>${esc(dur)}</small></button><ol class="rb-log" aria-live="off">${L.slice(0, LIVE.log[name]).map((l) => `<li>${esc(l)}</li>`).join('')}</ol><div class="rb-f"><span>${esc(ws)} · ${esc(agent)}</span><b data-live-cost>${esc(cost)}</b></div></div>`; }
      if (status === 'Waiting on you') { const q = (logs[name] || []).find((l) => l.startsWith('?')) || 'Needs your answer';
        return `<div class="rb-c wait"><button class="rb-h" data-item-p="agent" data-item="${esc(name)}">${avatar(agent)}<b>${esc(name)}</b><small>${esc(dur)}</small></button><p class="rb-q">“${esc(q.replace(/^\?\s*/, ''))}”</p><div class="rb-acts"><button class="us-primary" data-xa="allowRun" data-arg="${esc(name)}">Allow</button><button class="us-ghost" data-item-p="agent" data-item="${esc(name)}">Answer</button></div></div>`; }
      return `<button class="rb-c ${status === 'Failed' ? 'bad' : 'done'}" data-item-p="agent" data-item="${esc(name)}"><span class="rb-h">${avatar(agent)}<b>${esc(name)}</b><small>${esc(dur)}</small></span><span class="rb-sum">${status === 'Failed' ? `${ic('x')}Tests failed · ${esc(ws)}` : `${ic('check')}Finished · ${esc(ws)} · ${esc(cost)}`}</span></button>`; };
    const col = (title, f) => { const rows = A.rows.filter((r) => f(r[3])); return `<div class="rb-col"><span class="rb-ch">${title}<em>${rows.length}</em></span>${rows.map(card).join('') || '<span class="rb-empty">Nothing here</span>'}</div>`; };
    const board = `<div class="rb">${col('Running', (s) => s === 'Running')}${col('Waiting on you', (s) => s === 'Waiting on you')}${col('Finished', (s) => s === 'Done' || s === 'Failed')}</div>`;
    const sch = D().dev.schedule, nh = nowH();
    const tl = `<div class="tl24"><div class="tl24-ruler">${[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => `<span style="left:${(h / 24) * 100}%">${String(h).padStart(2, '0')}</span>`).join('')}</div>
      ${sch.map(([name, cad, runs]) => { const failed = runs.some((r) => r[1] === 'failed'); return `<button class="tl24-row${failed ? ' bad' : ''}" data-item-p="workflow" data-item="${esc(name)}"><span class="tl24-n"><b>${esc(name)}</b><small>${esc(cad)}</small></span><span class="tl24-track">${runs.map(([h, st0]) => { const st = st0 === 'failed' ? 'failed' : h > nh ? 'next' : nh - h < 0.25 ? 'run' : 'ok'; return `<i class="tl24-m ${st}" style="left:${(h / 24) * 100}%" title="${String(h).padStart(2, '0')}:00 · ${st === 'ok' ? 'ran fine' : st === 'failed' ? 'failed' : st === 'run' ? 'running now' : 'next run'}"></i>`; }).join('')}</span></button>`; }).join('')}
      <i class="tl24-now" data-live-now style="left:calc(var(--lab) + (100% - var(--lab)) * ${(nh / 24).toFixed(4)})"><span>now</span></i></div>`;
    return sec('Agent runs', `<span class="hs-live"><i></i>live</span>`, board) + sec('Automations today', 'every run on one 24-hour line', tl, `<button class="hm2-link" data-zone="automate">All runs ${ic('right')}</button>`);
  }

  // =============================== SOCIAL ===============================
  function social() {
    const S = D().social, mx = Math.max(...S.reach), days = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d; });
    const top = (h) => ((h - 8) / 14) * 100, nh = nowH();
    const cal = `<div class="wk">${days.map((d, i) => { const posts = S.posts.filter((p) => p[1] === i);
      return `<div class="wk-d${i === 0 ? ' today' : ''}"><div class="wk-h"><b>${i === 0 ? 'Today' : d.toLocaleDateString('en-GB', { weekday: 'short' })}</b><small>${d.getDate()}</small><span class="wk-dots" aria-label="${posts.length} planned">${posts.map((p) => `<i class="${p[4]}"></i>`).join('')}</span><em>${posts.length ? posts.length + ' planned' : 'Nothing planned'}</em></div>
        <div class="wk-body">${[10, 14, 18].map((h) => `<span class="wk-hr" style="top:${top(h)}%"></span>`).join('')}${i === 0 && nh > 8 && nh < 22 ? `<span class="wk-now" style="top:${top(nh)}%"></span>` : ''}
        ${posts.map(([t, , h, ch, st]) => `<button class="wk-p ${st}" style="top:${top(h)}%" data-item-p="post" data-item="${esc(t)}"><small>${String(h).padStart(2, '0')}:00${st === 'approval' ? ' · needs approval' : st === 'draft' ? ' · draft' : ''}</small><b>${esc(t)}</b><span>${ch.map((c) => `<i>${esc(c)}</i>`).join('')}</span></button>`).join('')}</div></div>`; }).join('')}<div class="wk-axis">${[10, 14, 18].map((h) => `<span style="top:${top(h)}%">${h}:00</span>`).join('')}</div></div>`;
    const conv = `<div class="cv">${S.conv.map(([n, ch, txt, min, unread]) => `<button class="cv-r${unread ? ' unread' : ''}" data-item-p="comms" data-item="${esc(n)}"><span class="pg-av">${esc(n.replace('@', '')[0].toUpperCase())}</span><span class="cv-t"><b>${esc(n)}<em>${esc(ch)}</em></b><small>${esc(txt)}</small></span><small class="cv-w">${ago(min)}</small>${unread ? '<i class="cv-u" aria-label="Unread"></i>' : ''}</button>`).join('')}</div>`;
    return sec('The week ahead', `${S.posts.length} posts planned · ${S.posts.filter((p) => p[4] === 'approval').length} waiting for approval`, cal, `<button class="hm2-link" data-zone="publish">Queue ${ic('right')}</button>`) + sec('Conversations', `${S.conv.filter((c) => c[4]).length} unread`, conv);
  }

  // =============================== OFFICE ===============================
  function office() {
    const O = D().office, nh = nowH(), y = (h) => ((h - 9) / 9) * 100;
    const agenda = `<div class="ag"><div class="ag-axis">${[9, 11, 13, 15, 17].map((h) => `<span style="top:${y(h)}%">${h}:00</span>`).join('')}</div><div class="ag-body">${[9, 11, 13, 15, 17].map((h) => `<i class="ag-hr" style="top:${y(h)}%"></i>`).join('')}
      ${O.agenda.map(([a, b, t, who]) => `<button class="ag-e${b - a <= 0.5 ? ' short' : ''}${nh >= a && nh < b ? ' now' : nh >= b ? ' past' : ''}" style="top:${y(a)}%;height:${((b - a) / 9) * 100}%" data-xa="openEvent" data-arg="${esc(t)}"><b>${esc(t)}</b><small>${String(Math.floor(a)).padStart(2, '0')}:${a % 1 ? '30' : '00'} · ${esc(who)}</small></button>`).join('')}
      ${nh > 9 && nh < 18 ? `<i class="ag-now" style="top:${y(nh)}%"><span>${new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span></i>` : ''}</div></div>`;
    const docs = window.XENO_PG_LIBRARY.items.filter((f) => !f.trashedAt && f.source.mode === 'office' && ['document', 'sheet', 'deck'].includes(f.kind)).slice(0, 4);
    const pages = `<div class="pp">${docs.map((f) => { const p = PR()[f.source.product]; return `<button class="pp-d ${f.kind}" data-item-p="${f.source.product}" data-item="${esc(f.name)}"><span class="pp-page"><b>${esc(f.name.replace(/\.\w+$/, ''))}</b>${f.kind === 'sheet' ? `<span class="pp-grid">${'<i></i>'.repeat(15)}</span>` : f.kind === 'deck' ? '<span class="pp-slide"><i></i><i></i></span>' : `<span class="pp-lines">${[92, 80, 96, 64, 88, 72].map((w) => `<i style="width:${w}%"></i>`).join('')}</span>`}</span><small>${p ? X().pIconFull(p, 12) : ''}${esc(p ? p.name : '')} · ${ago(Math.round((Date.now() - Date.parse(f.updatedAt)) / 60000))}</small></button>`; }).join('')}</div>`;
    const mail = `<div class="ml">${O.mail.map(([from, kind, subj, snip, min, unread, drafted]) => `<div class="ml-r${unread ? ' unread' : ''}"><span class="pg-av${kind === 'agent' ? ' agent' : ''}">${kind === 'agent' ? ic('bot') : esc(from[0])}</span><button class="ml-t" data-item-p="mail" data-item="${esc(subj)}"><span class="ml-top"><b>${esc(from)}</b><small>${ago(min)}</small></span><span class="ml-s">${esc(subj)}</span><small class="ml-p">${esc(snip)}</small>${drafted ? `<span class="ml-draft">${ic('bot')}Juno drafted a reply</span>` : ''}</button><span class="ml-acts"><button class="pg-ib" data-xa="archiveMail" data-arg="${esc(subj)}" aria-label="Archive" data-tip="Archive">${ic('archive')}</button><button class="pg-ib" data-item-p="mail" data-item="${esc(subj)}" aria-label="Reply">${ic('send')}</button></span></div>`).join('')}</div>`;
    return `<div class="of-cols">${sec('Today', `${O.agenda.length} meetings`, agenda)}${sec('Your desk', 'documents you touched recently', pages, `<button class="hm2-link" data-go="library">Library ${ic('right')}</button>`)}</div>` + sec('Mail', `${O.mail.filter((m) => m[5]).length} unread · 1 handled by Juno`, mail, `<button class="hm2-link" data-zone="mail">Inbox ${ic('right')}</button>`);
  }

  // =============================== CORPO ===============================
  function corpo() {
    const C = D().corpo, rev = C.revenue, month = rev.reduce((a, b) => a + b, 0), prev = month * 0.85, mx = C.pipeline[0][1];
    const labels = rev.map((_, i) => { const d = new Date(); d.setDate(d.getDate() - (rev.length - 1 - i)); return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); });
    const W = window.XENO_PG_WORKSPACE.members, online = W.filter((m) => m.status === 'running' || (m.kind === 'human' && m.lastActiveAt && Date.now() - Date.parse(m.lastActiveAt) < 3600000));
    const revenue = `<div class="cp-rev"><div class="cp-rev-h"><span><small>Revenue · last 30 days</small><b>€${k(month)}</b></span><em>↑ ${Math.round(((month - prev) / prev) * 100)}% vs the 30 days before</em></div>${chart(rev, { labels, fmt: (v) => '€' + v, h: 150, focus: true, label: 'Revenue per day' })}</div>`;
    const funnel = `<div class="cp-fun">${C.pipeline.map(([st, n, val], i) => `<button class="cp-fs" data-zone="customers" style="--w:${Math.max(6, (n / mx) * 100)}%"><span class="cp-ft"><b>${esc(st)}</b><small>${n} deals · €${k(val)}</small>${i ? `<em>${Math.round((n / C.pipeline[i - 1][1]) * 100)}% from ${esc(C.pipeline[i - 1][0])}</em>` : ''}</span><span class="cp-fb"><i></i></span></button>`).join('')}</div>`;
    const people = `<div class="cp-pp">${W.map((m) => { const on = online.includes(m); return `<span class="cp-p${on ? ' on' : ''}" title="${esc(m.name)} — ${m.kind === 'agent' ? (m.status === 'running' ? 'working' : 'idle') : on ? 'online' : 'away'}"><span class="pg-av${m.kind === 'agent' ? ' agent' : ''}">${m.kind === 'agent' ? ic('bot') : esc(m.name[0])}</span><i></i><small>${esc(m.name)}</small></span>`; }).join('')}</div>`;
    const tickets = `<div class="cp-tk">${C.tickets.map(([t, who, el, lim, own]) => { const pc = Math.min(100, (el / lim) * 100); return `<button class="cp-t${pc > 70 ? ' late' : ''}" data-item-p="desk" data-item="${esc(t)}"><span class="cp-tt"><b>${esc(t)}</b><small>${esc(who)} · ${esc(own)}</small></span><span class="cp-sla"><i style="width:${pc}%"></i></span><small class="cp-left">${lim - el > 0 ? `${ago(lim - el)} left` : 'overdue'}</small></button>`; }).join('')}</div>`;
    return sec('The company right now', '', `<div class="cp">${revenue}<div class="cp-side"><div class="cp-card"><span class="cp-k">Pipeline</span>${funnel}</div></div></div>`) + `<div class="of-cols">${sec('Who is here', `${online.length} online now`, people)}${sec('Support', `${C.tickets.length} open · SLA timers`, tickets, `<button class="hm2-link" data-zone="customers">Desk ${ic('right')}</button>`)}</div>`;
  }

  // =============================== TOOLS ===============================
  const TOOL_KIND = { 'tool-resize': 'image', 'tool-bg': 'image', 'tool-upscale': 'image', 'tool-trim': 'video', 'tool-transcribe': 'audio', 'tool-pdfmerge': 'document', 'tool-csv': 'data', 'tool-json': 'code' };
  function tools(m) {
    const ids = m.sections.flatMap(([, x]) => x).filter((id) => PR()[id]);
    return sec('Drop a file', 'XENO reads what it is and lights up the tools that can work on it', `<label class="td" data-tool-drop><input type="file" hidden data-tool-file>${ic('upload')}<span><b data-td-t>Drop a file here, or click to pick one</b><small data-td-s>Images, video, audio, documents, data — nothing is uploaded until you choose a tool</small></span></label>`)
      + sec('All tools', `${ids.length} tools`, `<div class="tg">${ids.map((id) => `<button class="tg-t" data-product="${id}" data-kind="${TOOL_KIND[id] || ''}">${X().pIconFull(PR()[id], 22)}<b>${esc(PR()[id].name)}</b><small>${esc(PR()[id].blurb || '')}</small><em class="tg-fit">Fits this file</em></button>`).join('')}</div>`);
  }
  const kindOfFile = (f) => (/^image/.test(f.type) ? 'image' : /^video/.test(f.type) ? 'video' : /^audio/.test(f.type) ? 'audio' : /pdf|word|text\/plain/.test(f.type) ? 'document' : /csv|sheet|excel/.test(f.type) || /\.csv$/.test(f.name) ? 'data' : /json|javascript/.test(f.type) || /\.json$/.test(f.name) ? 'code' : 'document');
  function suggest(file) {
    const kind = kindOfFile(file), tiles = [...document.querySelectorAll('.tg-t')], fit = tiles.filter((t) => t.dataset.kind === kind);
    tiles.forEach((t) => t.classList.toggle('fit', fit.includes(t))); tiles.forEach((t) => t.classList.toggle('dim', !fit.includes(t)));
    const zone = document.querySelector('[data-tool-drop]'); zone.classList.add('has');
    zone.querySelector('[data-td-t]').textContent = file.name; zone.querySelector('[data-td-s]').textContent = fit.length ? `${fit.length} tool${fit.length > 1 ? 's' : ''} can work on this ${kind}: ${fit.map((t) => t.querySelector('b').textContent).join(', ')}` : `No tool handles this kind of file yet`;
    fit[0]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  document.addEventListener('dragover', (e) => { const z = e.target.closest?.('[data-tool-drop]'); if (z) { e.preventDefault(); z.classList.add('over'); } });
  document.addEventListener('dragleave', (e) => { const z = e.target.closest?.('[data-tool-drop]'); if (z && !z.contains(e.relatedTarget)) z.classList.remove('over'); });
  document.addEventListener('drop', (e) => { const z = e.target.closest?.('[data-tool-drop]'); if (!z) return; e.preventDefault(); z.classList.remove('over'); if (e.dataTransfer.files[0]) suggest(e.dataTransfer.files[0]); });
  document.addEventListener('change', (e) => { if (e.target.matches?.('[data-tool-file]') && e.target.files[0]) suggest(e.target.files[0]); });

  // ---------- one ticker for everything live (render progress, run timers, log stream, now lines) ----------
  setInterval(() => {
    if (document.hidden) return;
    const job = document.querySelector('[data-live-job]');
    if (job && LIVE.pct != null && LIVE.pct < 99) { LIVE.pct += 1; const j = D().studio.jobs[0], done = Math.round((LIVE.pct / 100) * j.frames);
      job.querySelector('[data-live-pct]').textContent = LIVE.pct + '%'; job.querySelector('[data-live-eta]').textContent = `about ${Math.max(1, Math.round((100 - LIVE.pct) / 12))} min left`;
      const fr = job.querySelector('[data-live-frames]'); if (fr) fr.textContent = `frame ${done.toLocaleString('en')} of ${j.frames.toLocaleString('en')}`;
      job.querySelector('.fs-head').style.left = LIVE.pct + '%'; job.querySelectorAll('.fs-f').forEach((t, i, all) => t.classList.toggle('done', (i + 1) / all.length <= LIVE.pct / 100)); job.querySelector('.fs-strip').setAttribute('aria-label', `${j.name} — ${LIVE.pct}% rendered`); }
    document.querySelectorAll('[data-live-run]').forEach((c) => { const name = c.dataset.liveRun, L = D().dev.logs[name] || []; const ol = c.querySelector('.rb-log');
      if (L.length && Math.random() < 0.55) { const n = LIVE.log[name] = (LIVE.log[name] || 0) + 1, line = L[(n - 1) % L.length]; ol.insertAdjacentHTML('beforeend', `<li class="new">${esc(line)}</li>`); while (ol.children.length > 4) ol.firstElementChild.remove(); }
      const el = c.querySelector('[data-live-elapsed]'); const base = (LIVE.elapsed0[name] ??= parseInt(el.textContent, 10) * 60), s2 = base + Math.round((Date.now() - LIVE.started) / 1000); el.textContent = `${Math.floor(s2 / 60)} min ${String(s2 % 60).padStart(2, '0')} s`; });
  }, 1500);

  window.XENO_SIG = { studio, dev, social, office, corpo, tools, chart, wall, libFor };
})();
