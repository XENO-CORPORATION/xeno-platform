# XENO Platform — Changelog

Newest first. The record of each deploy is XENO Index's release record (`/workspace/releases`); this file is the
plain-words account of what changed. It starts here; earlier history is in `git log` and that record.

## 2026-10-31

**Studio › Libraries has Stock (XENO Stock).**

- Search photos, art and video free of copyright (CC0), hosted by XENO. Every item states its licence at its source, and we record where that was read and when.
- Each item says who states the licence, a museum or the person who uploaded it, and that CC0 doesn't clear a person's or a brand's rights.
- Save an item to a workspace's Library so your apps and agents can use it.
- Can't find it? Your search goes to Generate, ready for you to press, and anything you already generated with those words shows up too.

**Agents can read a project on your own PC, through XENO Corpus.**

- Agents you connect to XENO MCP can read a project you turned on in XENO Corpus on your PC: its context, a tenet, what lapsed, what depends on a subject, whether a subject can ship.
- It's off until you turn a project on, on that PC, and turn Corpus on your PC on for that app in Dev › XENO MCP. It's read-only. If the PC isn't connected, the agent is told so rather than getting an empty answer.
- Answers pass through XENO and aren't kept here. Your folder paths never leave the PC.
- Settings › Corpus on your PCs shows each PC and its projects. You can turn one off or remove it from there.
- Needs a XENO Corpus release that asks for the new sign-in permission.

**Studio › Libraries has fonts (XENO Fonts).**

- A catalogue of 40 open-licence font families XENO hosts, set in the fonts themselves, with type your own sample text into and pairings written by hand.
- Upload your own fonts. They stay private to the workspace, you confirm you have the rights, and a font whose own licence forbids embedding is refused.
- A brand kit’s CSS export brings its catalogue fonts with it.
- Agents can search the catalogue and add fonts. Only a person can upload one.

**Studio › Libraries has brand kits (XENO Assets).**

- Keep a brand’s colors, sizes, type, shadows, logos and voice in one kit the whole workspace shares, with light, dark or any other modes.
- Publish a kit to freeze it as a numbered version that never changes, so what follows it always knows exactly what it has.
- Export any version as W3C Design Tokens, CSS variables, a Tailwind theme or XENO Canvas tokens, and import Design Tokens files with a preview first.
- Agents can read a published brand to stay on it, and propose tokens. Only a person can publish.

**Fixes that had been waiting on branches.**

- Expired credit holds are all released at once, not only the first thousand, so reserved credits no longer linger.
- Requesting or downloading a data export finishes writing its audit record before answering.
- Signing out of an app reports a failure honestly instead of saying it worked.
- Version floors compare versions the same way everywhere, including betas and very large numbers.
- Chat images in 2:3 and 3:2 no longer fail on the Google image models.

**Corpo › Forms is real.**

- Make a form, change its questions, and open it. It saves as you type.
- Share it by a sign-in link or a public link. People answer a public link without an account, and the page works without JavaScript. Links can be revoked and can expire.
- A form can close on a date or after a number of responses, even when answers arrive together.
- Responses show a summary of the choices and each answer with its question as it read then, export to CSV, and can become a customer, a task or a support request, on demand or on every response.
- Erasing a contact erases what they answered, and a contact’s export includes it.
- Agents can build forms, make sign-in links and read responses. Only a person can make a public link or delete anything.

**Create and Anima show real work, and the preview note is gone.**

- Studio › Create lists your files in the Library instead of sample renders.
- Anima lists the agents you made, opens each one’s Mind and skills, and says plainly where a Soul lives today: on the computer where Anima runs.
- Nothing in the workspace shows sample data as yours any more, so the “Preview” note no longer appears. A test now walks every screen with an empty account and fails if a sample row comes back.
- Anima’s sidebar lists your agents. Community’s sidebar no longer shows made-up counts, and Following shows the threads you follow.
- Customers, Scheduling, Analytics, Compute and the Tools areas no longer say “Coming soon” or offer “Notify me”: they’re live.
- A new account no longer starts with a “Video agency” mode it never made.

**Corpo › Company is real.**

- A company’s legal entity: its legal name and form, registered office and where it’s actually run, its registrations and branches, its tax, customs and financial-market numbers, and who may act for it.
- VAT numbers can be checked with VIES, and every answer is kept. If a register can’t be reached the page says it couldn’t check, never that the number is invalid.
- Owners and admins change it; a person, never an agent. A date of birth is shown only to them.

**Selling a team, and Tools for agents.**

- The Seller console can publish a team: the server packages its setup and its agents’ definitions, leaves your people behind, says who stayed, and sends it to review.
- Agents connected over XENO MCP can find the XENO tool that fits what someone wants, and give them the address that opens it. Tools still run on the person’s side.

**Two-step sign-in.**

- Settings › Sign-in & security now really sets up an authenticator app, adds passkeys, and makes recovery codes. Your password alone no longer signs in once one is on, and that goes for Google, GitHub and X sign-in too.
- The sign-in page has “Sign in with a passkey”, with nothing to type.
- Turning two-step off, or making new recovery codes, takes the second step itself. A stolen password or inbox can’t do it, and resetting a password doesn’t clear it.
- You get an email whenever what protects your account changes.
- You can connect Google, GitHub or X to your account from Settings.

**Settings, Knowledge and project Funding are real.**

- Settings › Apps lists every app signed in with your account and what it can do. Removing one signs it out everywhere at once.
- Settings › Provider keys adds your own OpenAI, Anthropic, Google or compatible key. XENO checks it with the provider first, and you confirm it’s you before adding one, because a key’s endpoint receives your prompts. Each product can use your key or XENO credits.
- Settings › Usage sets a monthly spend limit. Work that would go past it is refused.
- Settings › Connections shows your connected clouds and agents, and opens each where it is managed. Settings › Workspace and Gifts show real state; sending gifts stays closed.
- Workspace › Knowledge shows what the workspace holds to be true, with search, in place of sample sources.
- A project’s Funding tab shows campaigns, totals, budgets and requests. Nobody can see who gave what except their own part. It moves no money. Someone with edit access can propose a monthly ceiling, and an owner who didn’t propose it approves it.
- Forms that offer a choice now show a real list. Corpus’s New tenet and Research’s project field were showing a box to type in.
- A project’s tabs no longer run underneath its buttons, and the “Preview” switch is gone from real pages.

**Three more workspace areas show your real work.**

- Corpo › People, Dev › Agents and Studio › Generate now list your own people, agents and generations, and open each at its
  real page. They used to show sample rows or nothing.
- Customers, Scheduling and Analytics no longer say they are "planned" in the sidebar: they have been real for a while.
- A product's sidebar no longer shows sample folders and channels.
- The preview line at the bottom says exactly which parts are still sample data, and updates itself as they get connected.
- Workspace › Teams now creates, edits and archives real teams, each with its own link. Automations lists your real workflows and
  opens them in Automate. Activity shows what was recorded in the workspace, and says how many entries you can't see.

**Library: Shared with me, duplicate, and move to a project.**

- Shared with me lists what other people shared with you, and says who.
- Duplicate makes a real copy with its own history. If someone shared a file with you, the copy is yours.
- Move to project files the item in that project's folder, so everyone on the project can reach it.

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
