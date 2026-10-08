# XENO Workspace — frontend prototype

The full signed-in XENO Workspace as a clickable prototype: every area works end to end on sample
data, with the backend each area needs specified but not built. **Not shipped** — the frontend
image copies only `src/`, `public/`, `packages/` and `scripts/` (`Dockerfile.frontend`), so this
folder never reaches xenostudio.ai.

The decisions behind every screen live in the workspace root `XENO MODES - SPEC.md`, §7h–§7r.
That document is the source of truth; this folder is its working demonstration.

## Open it

Double-click `index.html`. No server, no install. State is kept in the browser's `localStorage`
(keys `xw.*`), so a refresh keeps what you did; clear the site data to start fresh.

## What is in it

| Area | Where | Spec |
|---|---|---|
| Account centre (19 sections) | avatar → Settings | §7j |
| Workforce — divisions, teams, handoffs, decisions | rail → Workspace | §7k |
| Agents and teams as resources, assignments | Workspace → Agents | §7k |
| Project funding — milestones, rights, returns | Projects → a project → Funding | §7l |
| Marketplace — listings, entitlements, refunds, rentals, seller console | rail → Marketplace | §7m |
| Community and Report — votes, moderation, duplicates, tickets | rail → Community, F1 | §7n |
| Company — legal entity, wallet, staff | Workspace → Company | §7o |
| Anima — Mind, Soul, channels, swarms | rail → Anima | §7p |
| Places — the workspace as a building | rail → Places | §7q |
| Search everything | Ctrl K (`>` for commands) | §7r |
| Failure states and roles | the Prototype chip, bottom right (Ctrl+Alt+P) | §7s |
| Accessibility | WCAG 2.2 AA, keyboard only | §7t |

**Not real:** live model chat, every server call (sample data only), and payments (test checkout).

## Tests

Browser tests drive the real page with Puppeteer. From this folder:

```
npm i --no-save puppeteer axe-core
node tests/pages-test.mjs        # every page at three sizes
node tests/inert-sweep.mjs       # no control on any route is a placeholder
node tests/axe-audit.mjs         # WCAG 2.2 AA on every page — prints nothing when clean
node tests/kbd-test.mjs          # keyboard only: Tab, focus visible, dialogs trap and return focus
node tests/role-walk.mjs         # every route as member and guest — writes role-walk.json
node tests/mk-test.mjs           # one area (see tests/ for the rest)
```

Each prints `ALL PASS` or the failing checks.

### The history and the selection (`history-core.js`, `select-core.js`)

Each is a framework-free model, loaded by its adapter (`history.js`, `select.js`). The models run in a bare JavaScript context with fake ports, and a purity test stops them from reaching a browser global. The adapters are covered by the browser suites. From this folder:

```
node --test tests/unit/history-core.test.mjs tests/unit/select-core.test.mjs tests/unit/sel-codec.test.mjs tests/unit/purity.test.mjs
node tests/hist-test.mjs       # acceptance: the history (14 checks)
node tests/sel-test.mjs        # acceptance: the selection (16)
node tests/sellink-test.mjs    # acceptance: links with ?sel= (10)
node tests/hist-fix-test.mjs   # one browser check per history fix (F-04 to F-18)
node tests/sel-fix-test.mjs    # one browser check per selection fix, and the guards
```

Every browser suite exits 1 on any FAIL. `node --test` takes explicit file paths; the glob form differs between Node versions.

**Known limits, not fixed here**, each with its exit condition:
- A retry after a partial storage write reports the keys it had already restored as kept by someone else. Exit: `write()` counts a key that already holds its target value as done. Recorded at C7; not re-run in this pass.
- `XENO_DB.save` rewrites the whole stored object on each save (`pages-data.js:160-162`). The comment at lines 156-157 says an unchanged area keeps its stored copy; I have not checked each area's getter against that. Exit: each area written only when this window changed it, or a check that the getters keep the stored copy.
- `XENO_HIST.list()` exposes the stored values of each change (`before` and `after`). Exit: an owner decision on the public shape.
- A selection can keep an id that is no longer on screen, and a restore does not wait for rows that arrive later. Exit: a product rule for both. From the design review; not re-measured here.
- The lists a page declares are registered again each time it renders; the registry is not de-duplicated. Exit: de-duplicate by key (taken from the design review; not re-measured here).
- The Ctrl Alt Z alias for undo is not built, and Alt is no longer a history key. Exit: an owner decision.
- Puppeteer does not deliver `unhandledrejection` to a page listener in this harness; a rejection shows up as a page error, `Uncaught (in promise)`, and `sel-fix-test.mjs` reads that.
