/**
 * Company blueprints — a whole company's STRUCTURE as data, applied by services/modeApply.js plan → apply like any
 * trade pack (owner 2026-10-20: "be completely ready to recreate XENO in XENO"). Never applied by hand-written SQL.
 *
 * A blueprint adds a `company` section to the pack format:
 *   company.headTitle             the applying admin's title (they head every division the blueprint makes)
 *   company.divisions[]           { name, teams: [{ name, agent?: { name, instructions } }] }
 *     → one workforce_divisions row per division, head = the applier         (services/workforceDivisions.js)
 *     → one workforce_resources kind 'team' per team, owned by the workspace, owned by its division
 *     → one platform agent per `agent`, made inside the company and placed in the division (services/platformAgents.js);
 *       it is the delegate for that product's work (a person stays the assignee, XENO Tasks §3)
 *   Places needs nothing: the building of the workspace derives floors from divisions and pods from teams.
 *
 * `xeno-corporation` mirrors the layer map in the workspace root CLAUDE.md ("The Ecosystem"). Status: draft — the
 * owner corrects names and the split before it is applied to a real workspace (docs/COMPANY-BLUEPRINT-XENO.md).
 */
const team = (name, product) => ({ name, agent: { name: `${name} agent`, instructions: `You work on ${product}. Read its repository's CLAUDE.md and agents.md before acting, take work only from XENO Tasks delegated to you, and never accept your own work.` } });
const products = (list) => list.map(([name, product]) => team(name, product || name));

export const XENO_CORPORATION = Object.freeze({
  format: 'xeno-mode-pack', schemaVersion: 1, status: 'draft',
  id: 'xeno-corporation', version: '0.1.0', title: 'XENO Corporation',
  summary: 'The XENO Corporation org: one division per ecosystem layer, one team and one product agent per product.',
  questions: [{ id: 'agents', label: 'Make one agent per product (yes or no; default yes)', required: false, max: 3 }],
  mode: { id: 'c-company', name: 'Company', products: ['tasks', 'chat', 'storage', 'places', 'company', 'forum', 'agents'] },
  tasks: [],
  company: {
    headTitle: 'Founder & CEO',
    divisions: [
      { name: 'Platform & Infrastructure', teams: products([['XENO Hub', 'xeno-hub'], ['XENO Platform', 'xeno-platform'], ['XENO Tools', 'xeno-tools'], ['XENO Proxy', 'xeno-proxy'], ['XENO Runner', 'xeno-runner'], ['XENO Index', 'xeno-index']]) },
      { name: 'Native Engine & Inference', teams: products([['XENO Lib', 'xeno-lib'], ['XENO Primitives', 'xeno-primitives'], ['XENO RT', 'xeno-rt'], ['XENO Mind', 'xeno-mind'], ['XENO Scaler', 'xeno-scaler']]) },
      { name: 'Agent & Automation', teams: products([['XENO Agent SDK', 'xeno-agent-sdk'], ['XENO Anima', 'xeno-anima'], ['XENO Agent CLI', 'xeno-agent-cli'], ['XENO Agent', 'xeno-agent-interface'], ['XENO Extension', 'xeno-extension'], ['XENO Use', 'xeno-use'], ['XENO Box', 'xeno-box'], ['XENO Workflow', 'xeno-workflow'], ['XENO Apps', 'xeno-apps'], ['XENO ACP', 'xeno-acp'], ['XENO Orchestrator', 'xeno-orchestrator']]) },
      { name: 'Shared Engine & UI Platform', teams: products([['XENO Core', 'xeno-core'], ['XENO Elements', 'xeno-elements'], ['XENO Components', 'xeno-components'], ['XENO Blocks', 'xeno-blocks'], ['XENO Nodes', 'xeno-nodes'], ['XENO Workshop', 'xeno-workshop']]) },
      { name: 'Creative Apps', teams: products([['XENO Pixel', 'xeno-pixel'], ['XENO Canvas', 'xeno-canvas'], ['XENO Motion', 'xeno-motion'], ['XENO Sound', 'xeno-sound'], ['XENO Architect', 'xeno-architect'], ['XENO Form', 'xeno-form'], ['XENO 3D', 'xeno-3d'], ['XENO Engine', 'xeno-engine'], ['XENO Photo', 'xeno-photo'], ['XENO Layout', 'xeno-layout']]) },
      { name: 'Libraries & Connect', teams: products([['XENO Assets', 'xeno-assets'], ['XENO Fonts', 'xeno-fonts'], ['XENO Stock', 'xeno-stock'], ['XENO Sites', 'xeno-sites'], ['XENO Browser', 'xeno-browser']]) },
      { name: 'Office & Communications', teams: products([['XENO Docs', 'xeno-docs'], ['XENO Sheets', 'xeno-sheets'], ['XENO Slides', 'xeno-slides'], ['XENO Notes', 'xeno-notes'], ['XENO Comms', 'xeno-comms'], ['XENO Post', 'xeno-post'], ['XENO PDF', 'xeno-pdf'], ['XENO Spectra', 'xeno-spectra'], ['XENO Company', 'xeno-company'], ['XENO Places', 'xeno-places'], ['XENO Tasks', 'xeno-tasks']]) },
      { name: 'Media & Content', teams: products([['XENO Media', 'xeno-media']]) },
      { name: 'Science & Research', teams: products([['XENO Research', 'xeno-research']]) },
    ],
  },
});

export const COMPANY_BLUEPRINTS = Object.freeze([XENO_CORPORATION]);
