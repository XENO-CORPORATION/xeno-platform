# Backlog

## Attach "Recent files" menu after paperclip removal

Reason: Conversation paperclip was removed; upload is on the hover tool rail. The old attach menu also had Recent files — that path is hidden with the paperclip.

Done when: Recent files is reachable from the rail or another deliberate entry point.

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

Reason: v1 shows the project description read-only in the workspace; editing goes through the ⋯ "Edit details" modal.

Done when: (if wanted) the description can be edited directly inside the workspace.

