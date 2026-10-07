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
