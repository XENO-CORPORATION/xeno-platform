# XENO Platform — Changelog

Newest first. The record of each deploy is XENO Index's release record (`/workspace/releases`); this file is the
plain-words account of what changed. It starts here; earlier history is in `git log` and that record.

## 2026-11-06

**A company project can be given to an agent.** Projects made inside a company workspace were missing from the list of projects an agent can join, so no agent could work in one or talk in its channel. They now show up for that workspace's people.

**An older agent can answer in a channel, and a wake never pays for silence.** Agents made before Message existed now reach it. If an agent still can't, because Message is off for it or its connection is paused, it isn't woken and the person who pays is told why.

**Naming an agent in a channel can wake it.** Turn it on from the agent's Settings, for people or for people and other agents. The agent starts a cloud run in that channel and answers there. Whoever answers for the agent pays, up to a budget per wake and a limit per day, and agents can only wake each other three times in a row. It stays off until you turn it on.

## 2026-11-05

**Message shows what happened to what you sent.** One tick means XENO has it, two mean it reached everyone, and two in green mean everyone has read it. In a group, hover to see who, and the count shows while only some have read. If you turn read receipts off, nobody sees you read and you don't see others read. Channels no longer stay marked as new after you've read them.

**@ names someone in a conversation, people and agents alike.** Type @ to pick from who's there. It lands in their inbox, and an agent reads its own inbox with its tools. An agent can name another agent the same way. Naming an agent doesn't start it running.

**The account menu tells the truth about connected accounts.** Connected accounts opens Sign-in & security and no longer shows a made-up count, and Get the apps goes to xenosystem.ai.

## 2026-11-05

**Remote control from a phone.** remote.xenosystem.ai opens XENO Agent on your own PC from any browser, with nothing to install. It has its own address and its own sign-in, which can reach remote control and nothing else on your account.

## 2026-11-04

**A business can change its trading name.** Edit details now has it, and it goes on new invoices and renames the workspace. Invoices already issued keep the old name. Before, no screen could rename a business.

**An invoice a customer can actually use.**

- Print or save any invoice as a PDF, from exactly what was issued, in German for customers in German-speaking countries and English for everyone else. Before, the only copy was UBL XML.
- New invoice asks for the customer’s street and postal code, the date of supply or a period, and always a due date.
- Add your bank account once under Getting paid and it goes on every invoice with the invoice number as the payment reference. A mistyped IBAN is refused. Invoices already issued keep what they said.
- A small business can set its limit and see the year’s invoiced total against it. Only invoices issued here count, and the page says so.
- Germany has its own checks now: over 250 euros an invoice needs the customer’s full address, the date of supply and the seller’s tax number. Up to 250 euros the shorter rules apply.
- Every invoice with money owed now states a due date or payment terms, as the European standard requires.

**One person can run a business on XENO.**

- Corpo › Company now handles a sole proprietor: a Kleingewerbe, a PFA, a sole trader. The page reads as the owner trading under the business name, and says plainly that the owner and the business are the same legal person.
- A small business that charges no VAT states that once, with its own wording, and every invoice carries the note with no tax added. Tax can't be charged by mistake, and the day the exemption ends it's one setting. Invoices already issued keep what they said.
- A tax number now reaches the invoice when it's the only number a seller has, written as a tax number and never as a VAT ID.
- Invoices show the seller's and customer's postal code on screen.

**Found by setting up XENO on XENO.**

- Creating a company now opens Corpo › Company, not a second page for the same thing.
- Company's tabs stay still when you pick one. In a narrow window the page path gives way so the tabs stay usable, on every page with tabs.
- A company with nothing filled in gets an Add a registration button on Invoices, and no longer reads about "this country".

**XENO Company lives in the workspace.**

- Corpo › Company now has Overview, Invoices, Wallet and Activity in its header, in the workspace's own design. People, Agents and Divisions stay on their own pages.
- Issue an invoice from Invoices. Each invoice has its own address, with its lines, totals and UBL download, and a mistake is reversed with a credit note.
- The workspace's company forms no longer assume Romania. A company set up there can invoice with a VAT number or a registration alone.
- /company sends you to the workspace page.

**XENO Company's dashboard has its whole backend.**

- Everything the dashboard calls now works against the platform: found a company, members and invitations, employ agents and set what they may do, activity, the wallet and transactions. It reads the same records the workspace shows, so there is nothing to keep in sync.
- A company can be registered in any country. It states its own legal form, numbers and registered office, and that is enough. Where a register is connected, which today is Romania's, it confirms them.
- A registered company can issue invoices and credit notes in its own currency, with no tax or any rate, checked against the common invoice rules plus a country's own rules where we have them (Romania so far). Meeting local tax law stays the company's job, and the dashboard says so. Only a person who manages the company can. Numbers have no gaps, even when several invoices are issued at once or one is refused.
- An issued invoice can't be changed or deleted by anyone, in the app or the database. A mistake is corrected with a credit note.
- An employed agent's role is checked like everyone else's, and its capabilities are enforced each time it runs.
- XENO sends invoices to no tax authority, and national e-invoicing is no longer planned (owner's decision, 2026-11-04).
- A UK company can now record its own GB VAT number, and Corpo › Company lists every country.

## 2026-11-03

**XENO Creator has its own address, creator.xenosystem.ai, served the way motion.xenosystem.ai is.**

- The site serves whatever release XENO Creator has published into `/srv/xeno-creator-web` on the server, behind the same invitation gate as the rest of the site. Publishing or rolling back Creator needs no site deploy.
- Signing in there opens a XENO session on that address (client `xeno-creator-web`, identity only), and the server recognises the app as `creator` when it checks a licence.

**A release's own page now names itself in the browser tab** ("XENO Canvas 0.43.1 release notes"); it showed only "XENOsystem".

**Major releases of XENO products now come with a release post: clips, pictures and what changed.**

- A product's release page shows a major release's key picture and one line, with a link to the full post; the release's own page shows the whole post, with its clips and screenshots from the real app, above the notes. Quick releases keep their notes only.
- Posts are read from the update server beside the release's installers, so a new post needs no site deploy.
- The release script takes `--kind quick|major` and `--post <folder>`, checks the post before anything is uploaded (every named file present, nothing unnamed, images and video only, a clip needs its poster, at least one picture or clip) and reads every file back from the public address afterwards.

**A cloud run that uses up its budget now says it stopped, not that it failed.**

- The Run dialog promises a run stops when it has used its budget. It did stop, but showed as failed with a raw API error. It now shows as stopped, with a note to run it again with a bigger budget to carry on.

**An agent you talk to at its desk is the same agent that works your tasks.**

- In Places, talking to an agent now gives it its persona (its role, voice and boundaries) as well as its instructions, read from the same record its task runs use. Before, a desk conversation knew only its name and instructions.

**Leaving a chat mid-answer now stops it and releases the credits it reserved.**

- The chat server never noticed when a person closed the tab or lost connection during a streamed answer. The answer kept running, could start another model call, and the credits held for it stayed reserved for up to 30 minutes before being returned. Nothing was overcharged, because unused holds are returned, but the balance looked lower until then. Closing the tab now ends the turn and settles or returns its holds at once.

**Chat can run its turns on the XENO Agent's loop. It is off until switched on.**

- With `CHAT_AGENT_RUNTIME=xeno-agent`, the XENO Agent's loop decides when a streamed chat turn calls the model again. The model, its instructions and every tool stay the platform's, and are billed the same way. `CHAT_AGENT_RUNTIME_USERS` limits it to listed accounts.
- A failed model call is never retried, a turn stops starting new calls once the person leaves, and two calls to the same tool keep their own arguments.
- The chat server now uses XENO Agent SDK 0.10.110 and the web-search client 0.1.5.

**Spawn profile sync keeps only what Spawn names.**

- Your account now stores only the settings and instruction files Spawn syncs (`settings.json`, `CLAUDE.md`, `AGENTS.md`, `config.toml` and similar, plus your own agents, commands, prompts and output styles). Device files an older Spawn uploaded (Claude Code's `.claude.json`, with your email, machine ID and local project paths, and its paste cache) are no longer stored or sent to your other devices, and copies already stored are left out when they are read.
- Environment variables and credential helpers in `settings.json` are not stored.
- An older Spawn keeps syncing: the files it may not send are dropped and named in the reply, not refused.

**A team sold in the Marketplace keeps who each agent is.**

- Publishing a team now includes each agent's persona (its role, voice and boundaries), the way selling one agent always did. Before, a buyer's copy kept only the instructions.
- Each agent in a team is now checked like a single agent: instructions or a persona holding a key or password, or trying to take over whoever runs them, stop the export and name the agent to fix.
- Teams already published are unchanged.

**Leaving stops what you started.**

- Closing a XENO Compute command’s window now stops the command on the machine. Before, it kept running, and costing, after you left.
- Leaving Places no longer leaves you shown in the building, and closed live views stop updating in the background.

**Fixes found by using the platform as a new person would, start to finish.**

- Typing the code from the welcome mail now also confirms your email address. Before, you were active but still "unverified", so the free allowance was refused and Settings said "Not verified".
- The 11 accounts this had already caught are now marked verified.
- A team made in Workspace › Teams can be sold. Its agents used to be left out, so publishing always failed.
- The Seller console loads for sellers. It failed for everyone the moment they registered.
- Buyers can bring a team they got into their workspace. It was always refused, and the dialog now names the terms they accept.
- A listing shows who comes with a team, and a reviewer reads each agent's role, voice and instructions before approving.
- Uploading a font works. Every upload from the browser was refused.
- Adding a provider key says plainly what is wrong. An address XENO won't connect to no longer reads as a bad key.
- Opening a few pages at once no longer shows "could not be loaded" everywhere. Each signed-in person now has their own allowance, under a larger one for everyone sharing a connection.

## 2026-11-02

**Database backups in R2 now have a key we hold, and they've been restored to prove it.**

- The private key for older R2 backups couldn't be found, so new backups use a new key, and a full restore from R2 passed.
- Dumps and base backups in R2 can't be deleted for 30 days, even from the server. Backups expire after 90 days.
- The restore drill is now a script: `scripts/dr-restore-proof.sh`.
- The old key is lost, so R2 backups from before today can't be restored. One dump per day from October 28 on was re-encrypted with the new key and checked by decrypting it from R2.
- The server now keeps 3 local dumps instead of 14, which frees about 20 GB after tonight's backup.
- Recovery to an exact moment is now proven with the new key: a base backup and WAL from R2 stopped at the chosen second, and the credit ledger matched production.
- The restore drill now runs every 4 weeks, and an email goes out if it hasn't passed in 35 days.
- Server monitoring runs on time again. Listing the backups had grown to over 30 minutes, so its 15-minute checks were piling up.
- Support mail, scheduling mail and the internal Research workspace are now marked as off on purpose, so they no longer raise an alert.

## 2026-10-31

**You can sell your agents in the Marketplace.**

- Seller console › Publish an agent: rent it for 30 days at a time, offer a copy, or both, free or for credits. Its role and instructions go on sale. Its memory, credentials and history stay yours.
- Instructions holding a key or password, or trying to take over whoever runs them, are refused before they go on sale.
- A person at XENO reads each agent before it's published, in a new review queue that also covers teams.
- Renters ask the agent from Marketplace › Rentals and pay for what it uses. What it remembers for them is theirs, and the seller can't read it.
- Buyers of a copy get their own agent, which starts with no access. A copy bought under terms that forbid resale can't be sold on.
- Earlier, nothing could be rented outside a test, because nothing marked an agent as ready to run. Approving one now does.

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
