/**
 * First-party trade packs (XENO MODES - SPEC.md §8c, D-CM6: salon, club, freelance photographer).
 *
 * DATA, not code, and DRAFTS: none of these is a published Marketplace listing (a published pack is a `mode` listing
 * version, migration 20261021090000). They are applied by services/modeApply.js like any pack, and are marked
 * `status: 'draft'` so nothing presents them as finished products. Picked to be very different from each other;
 * the real versions are to be shaped by talking to real owners (D-CM6), never by guessing — so treat every line
 * below as a first draft to be corrected.
 *
 * A pack writes ordinary records only: one workspace custom mode (the shelf) and a few starter tasks. Copy follows
 * §8c.4: no "AI", "agent", "model" or "prompt"; customers read "a setup for your business" (D-CM5).
 * Prices: none. A pack must have a row in `XENO PRICING - STANDARD & LEDGER.md` §6 before it ships (D-CM3).
 */
const pack = (p) => Object.freeze({ format: 'xeno-mode-pack', schemaVersion: 1, status: 'draft', ...p });

export const MODE_PACKS = Object.freeze([
  pack({
    id: 'salon', version: '0.1.0', trade: 'salon', title: 'Hair & beauty salon',
    summary: 'Bookings, reminders, a price list and posts for your salon.',
    questions: [{ id: 'businessName', label: 'Your business name', required: true, max: 60 }],
    mode: { id: 'c-salon', name: 'Salon', products: ['scheduling', 'crm', 'post', 'comms', 'sites', 'image'] },
    tasks: [
      { title: 'Add your opening hours and services', body: 'So clients can book the right time for the right treatment.' },
      { title: 'Connect your Instagram', body: 'Share before-and-after photos and answer messages in one place.' },
      { title: 'Send your first booking reminder', body: 'Reminders cut no-shows. Try one on your next booking.' },
    ],
  }),
  pack({
    id: 'club', version: '0.1.0', trade: 'club', title: 'Club or association',
    summary: 'Members, events, a page and a group chat for your club.',
    questions: [{ id: 'businessName', label: 'Your club’s name', required: true, max: 60 }],
    mode: { id: 'c-club', name: 'Club', products: ['community', 'comms', 'scheduling', 'sites', 'forms', 'docs'] },
    tasks: [
      { title: 'Invite your committee', body: 'Bring in the people who run the club with you.' },
      { title: 'Post your next event', body: 'Date, place and who to bring.' },
      { title: 'Make a membership form', body: 'Let new members sign up without paper.' },
    ],
  }),
  pack({
    id: 'photographer', version: '0.1.0', trade: 'photographer', title: 'Freelance photographer',
    summary: 'Editing, galleries for clients, invoices and posts.',
    questions: [{ id: 'businessName', label: 'Your business name', required: true, max: 60 }],
    mode: { id: 'c-photographer', name: 'Photography', products: ['photo', 'pixel', 'storage', 'sites', 'crm', 'post'] },
    tasks: [
      { title: 'Upload your portfolio', body: 'Your best twenty pictures, for your site and your clients.' },
      { title: 'Share a gallery with a client', body: 'Send a link they can open on a phone.' },
      { title: 'Send your first invoice', body: 'Get paid for the last shoot.' },
    ],
  }),
]);

export const packById = (id) => MODE_PACKS.find((p) => p.id === id) || null;
