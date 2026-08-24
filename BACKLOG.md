# Backlog

## Chat LLM display name UI (removed with Profile tab)

Reason: Chat settings → Profile (display name) was removed when persona moved into This chat. `getChatProfile` / `saveChatProfile` still hold `displayName`.

Done when: Andreia picks a home (Preferences, Sidebar Settings, or drop) and the field is wired or deleted on purpose.

## Remove unused Earth texture from Public globe trials

Reason: `public/share/earth-map.jpg` was pulled for rejected A+D/B/C globe demos. Share Public icon is now lucide micro-motion only.

Done when: file (and empty `public/share/` if unused) deleted, or reused elsewhere on purpose.

## Attach "Recent files" menu after paperclip removal

Reason: Conversation paperclip was removed; upload is on the hover tool rail. Recent files are now on the same rail (Upload + Recent).

Done when: Confirmed in review, then remove this backlog note (or keep only if Recent needs fileObject restore for real re-attach).

## Revisit chat date separators

Reason: Hidden on Andreia's request — they cluttered the conversation column. Helpers `formatDateSeparator` / `shouldShowDateSeparator` still exist in `ChatWithLLM.tsx`.

Done when: She decides if/when day dividers return (and where).

## Theme color remap uses `[class*="bg-…"]` (too greedy)

Reason: Chat theme CSS remaps hard-coded Tailwind bg classes with substring selectors. That also matches child variants like `prose-pre:bg-[#18171b]` and `hover:bg-…` on the parent `className`, so the wrong element gets painted (AI answer looked “selected”).

Safer later: match whole class tokens (`[class~="bg-…"]`) or stop putting child `*:bg-*` utilities on wrappers that must stay transparent.

Done when: theme remap no longer false-matches variant class names.

## Remove Chat update mock data before PR

Reason: The product-update carousel needs temporary content for visual and interaction review, but no production update source has been selected yet.

Delete: `src/components/playground/Chat/mockChatUpdates.ts`

Done when: The carousel receives real, approved update data or is removed from the final PR.

## Project workspace: use project instructions + files in the model prompt

Reason: Chats started from the project composer are now linked (`Conversation.projectId`) and the Recents list is real. But the project's `instructions` and uploaded `files` are stored/shown only — they are NOT yet injected into the model prompt for chats in that project.

Done when: A chat opened under a project sends the project instructions (as system context) and referenced file content to the model.

## Project workspace: "Scheduled" + context search are visual only

Reason: The sidebar "Scheduled" section (recurring tasks) and the Context search icon are placeholders with no behavior.

Done when: Scheduled tasks and file search are wired (or removed).

## Project workspace: edit description inline

Reason: v1 shows the project description read-only in the workspace; editing goes through the ⋯ "Project settings" modal (General section).

Done when: (if wanted) the description can be edited directly inside the workspace.

## Project settings can persist demo instructions as real content

Reason: The rail and the settings modal both fall back to `MOCK_PROJECT_INSTRUCTIONS` when a
project has none, so the two surfaces agree. But that means opening Project settings on an empty
project and pressing `Save changes` writes the demo text into the project as if the user had typed
it. Acceptable while this is a visual prototype; not acceptable once projects hold real work.

Done when: the demo fallback is removed with the rest of the mock data, or the settings editor
distinguishes "example text" from "saved text".

## File size and extension are not visible anywhere

Reason: Accepted trade-off from removing the Files section out of Project settings (Andreia's
call, 2026-07-25 — a second list of the same files defeated the single-surface goal). The rail's
file chips are too narrow for `MD · 4.1 KB`, so that metadata now has no home. Correct fix, if it
turns out to be wanted, is a rail-level one (tooltip on hover, or a wider file view) — not a
duplicate list in a settings modal.

Done when: Andreia decides whether file metadata needs to be visible, and where.

## Project / catalog overlays can hide the chat after navigation

Reason: Fixed 2026-07-25 — `dismissChatOverlays()` now runs from `handleLoadConversation`
and `handleNewChat`, and from history nav items that leave the Projects surface. Kept here
only if a new overlay is added later without wiring the same exit.

Done when: every path that reveals the message stream also dismisses Projects list,
project workspace, and chats catalog.

## No type checking runs in this repo

Reason: Found while verifying the project-settings change. `typescript` is not a dependency, so
`npx tsc --noEmit` refuses to run, and `npm run build` is Vite/esbuild only — esbuild strips types
without checking them. A type error can therefore reach a green build and a green deploy. Noticed,
deliberately not fixed: adding a compiler and a `typecheck` script is its own decision (which
strictness, what to do with the errors it will find on a 14k-line file).

Done when: Andreia decides whether to add `typescript` + a `typecheck` script, and what to do with
the existing errors it surfaces.

