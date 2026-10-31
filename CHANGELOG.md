# XENO Platform — Changelog

Newest first. The record of each deploy is XENO Index's release record (`/workspace/releases`); this file is the
plain-words account of what changed. It starts here; earlier history is in `git log` and that record.

## 2026-10-31

**Three more workspace areas show your real work.**

- Corpo › People, Dev › Agents and Studio › Generate now list your own people, agents and generations, and open each at its
  real page. They used to show sample rows or nothing.
- Customers, Scheduling and Analytics no longer say they are "planned" in the sidebar: they have been real for a while.
- A product's sidebar no longer shows sample folders and channels.
- The preview line at the bottom says exactly which parts are still sample data, and updates itself as they get connected.
- Workspace › Teams now creates, edits and archives real teams, each with its own link. Automations lists your real workflows and
  opens them in Automate. Activity shows what was recorded in the workspace, and says how many entries you can't see.

**You can delete your account from Settings.**

- You confirm it's you, then you have 30 days to change your mind, as the page always said. An email tells you the date.
- It works however you sign in. The old way needed a password, so anyone using Google or GitHub had to write to support.
- A company workspace you own with other people in it, or a subscription still running, comes first, and the page says so.

**The Marketplace is the real store.**

- The store lists real listings with their real prices and sellers. It used to show sample ones, and "buying" changed nothing but
  this browser.
- Buying, subscribing and renting spend your credits, and always ask first with the price. If you don't have enough, it says so and
  charges nothing.
- A rented agent is added to the workspace you're in. Rentals shows what it remembers for you, and you can export or delete
  that memory.
- Purchases, reviews and the seller console are real: earnings, listings, recent sales and sending a listing to review. Cash-out
  isn't switched on yet, and the page says so.

**Places shows your real building.**

- The Places page now shows your workspace's real floors, teams and desks, who is working and who is away. It used to show
  sample people.
- A floor you have no access to is a closed door with no name. Each floor and person has their own link, and an agent's desk opens
  that agent.
- The Arrange button is gone, because it said a layout was saved and saved nothing. Walk in opens the building in XENO Places,
  where walking and arranging happen.

**Your inbox follows you, and more of your work reaches it.**

- Archive and snooze are saved to your account, so they follow you to every device. Before, they lived in one browser.
- A snoozed item now really comes back at the time you chose, as unread. Before, it never woke up.
- New in the inbox: an agent's run finishing, failing or being stopped, even with its page closed; a workflow failing or
  turning itself off; a Forum reply, mention or accepted answer; news on a private report; someone sharing a file or folder with
  you; and a workspace invitation.
- Each item opens at its own page. Scheduling items used to open the wrong place.
- Notification settings are real: Settings and the inbox now show the same choices. Per-area levels follow your account,
  and desktop notifications and sound work on the device where you turn them on.
- The email digest can be chosen, daily or weekly. It sends nothing until we switch it on.
- Agents have their own inbox tools: read it, mark it read, archive and snooze. They can't reach their owner's inbox.

Fixed: Cloud Shell could never start again for someone whose shell machine had been deleted, because a deleted machine kept
its creation key for good. Someone without access to a shared Spawn canvas now gets a clear refusal, not a server error.

## 2026-10-30

**The credit ledger now proves itself.**

- The database itself numbers and fingerprints every credit movement, from any program that writes one, so an entry
  can no longer be skipped, reordered or forked.
- History before this date is sealed as found, never rewritten, with a report of what it holds.
- Every account's chain is checked every hour, and each result is recorded. A break is logged and kept on record.
- Every hour, the state of every chain is signed and stored outside the database under a ten-year lock that nothing on our
  servers can remove. Even someone able to rewrite the whole database could not make it match.
- A person can accept rows written while the protection was off, or a restore from backup. Both name who and why, and both
  stay on record.

**The platform no longer runs as the database's administrator.**

- The backend and workers connect with an account that can read and write data but cannot change the database's structure,
  edit the credit journal or switch its protection off.
- Database changes now run as their own step before each deploy, and the app refuses to start on a database that step
  has not prepared.
- Nothing changes the database's structure during a request any more. Login used to.

Fixed: the privacy-erasure test suite, which had been failing since report evidence was added.
