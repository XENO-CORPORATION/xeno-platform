# Tickets

## Issue #7 — Improve the ChatWithLLM empty state

Status: Implemented locally — awaiting review
Estimate: 2–4 hours

### Description

Replace the unfinished empty-chat message with a focused starting experience that explains what users can do in XENO Chat without duplicating the Image Generation product.

### Acceptance criteria

- A new conversation shows the heading `What would you like to explore?` without a subtitle.
- The composer placeholder changes with the selected mode: Chat explains planning/explaining/rewriting, Research promises cited web sources, Code names writing/reviewing/debugging, and Agents explains agent selection or task description.
- The empty state offers `Explain a topic`, `Analyze a document`, `Think through a problem`, and `Review code`.
- Text actions place an editable starter prompt in the composer and focus it; they do not send automatically.
- `Analyze a document` opens the existing file picker.
- After the first message is sent or an existing conversation is loaded, the empty state disappears and the normal message exchange is shown.
- The layout remains usable on desktop, mobile, and multi-interface views.
- No backend contract or dependency is changed.

### Verification requested by Andreia

- Verify the empty state is shown only before the conversation begins.
- Verify the interface becomes the normal message exchange after the first message.
- Verify suggested text remains editable and requires an explicit send action.
- Verify document analysis starts by asking the user to choose a file.

## Issue #7 — Refine the Chat starting experience

Status: Implemented locally — awaiting review
Estimate: 2–4 hours

### Description

Refine the centered composer, move the model selector into it, and prototype a monochromatic product-update carousel below the quick actions.

### Acceptance criteria

- The composer uses XENO's monochromatic palette and groups message controls in one place.
- The model selector is removed from the header and appears in the composer's lower-right control group.
- Opening the empty-chat model selector replaces the mode tabs with an inline, horizontally scrollable model-action rail. Every available model is directly selectable, enters from right to left with a short stagger, and never covers the chat input.
- Selecting one model closes the tray and preserves the selected model.
- The empty state shows at most three product updates below the four quick actions.
- Carousel navigation is manual. The current update exits left and the next enters from the right over `220ms`.
- Reduced-motion users receive an immediate change without sliding animation.
- There is no top-right dismiss control. On the final update the right nav control becomes an X that dismisses the current update; with one update left, only that X remains.
- Dismissing an update removes only that update and persists its ID in `localStorage` across refreshes.
- When every visible update is dismissed, a "What's new" control appears fixed at the bottom-right of the page, matching the top-right chat button chrome. It clears dismissals and restores the carousel in its normal position.
- Carousel arrows and position indicators are hidden when fewer than two updates remain.
- Each update passes its own showcase layout (`header`, optional `copyValue` / `headerMeta`, and `body`) into one shared Example-prompt shell; only the filled content changes between slides.
- Update descriptions are capped at 82 characters so the left column copy stays stable.
- No backend contract or new dependency is introduced.

### Verification requested by Andreia

- Verify the model-action rail shows every model without a second provider-expansion click or overlap with the chat input; verify selection works, the rail closes, and the chosen model remains selected.
- Verify next and previous controls display the expected update.
- Verify dismissing an update survives refresh.
- Verify that after every update is dismissed, "What's new" appears and restores the carousel (including after refresh).
- Verify controls disappear when only one update remains.
- Verify the update transition is smooth and moves from right to left.

## Issue #7 — Reframe the new-chat composer

Status: Implemented locally — awaiting review
Estimate: 1–3 hours

### Description

Place the centered new-chat composer inside a larger monochromatic shell. Keep the inner input fixed while the shell reveals contextual tools from its left edge.

### Acceptance criteria

- `Explain`, `Document`, `Think`, and `Code` appear above the inner composer.
- Text starters remain editable and never send automatically; `Document` opens the file picker.
- The collapsed left rail shows only a vertical handle.
- Pointer hover and keyboard focus reveal `Upload file`, `Conversation history`, and `System Prompt` from right to left.
- Moving from the handle to a tool keeps the rail open.
- After the pointer leaves both the handle and toolbar, the toolbar waits one second before closing; returning during that interval cancels the close.
- Keyboard focus keeps the toolbar open, while pressing `Escape` closes it immediately from left to right.
- Touch users can tap the handle to reveal the tools.
- `System Prompt` remains inside the expanded outer shell; `Conversation history` opens the existing history sidebar (not an in-shell panel).
- The outer shell expands to the left on desktop; the inner composer keeps its size and position.
- On small touch screens the expanded rail overlays the left side of the shell without resizing the inner composer.
- Reasoning, model, token, voice, and send controls use compact dimensions and remain operable by pointer, keyboard, and touch.
- The active-conversation composer keeps its existing behavior.

### Verification requested by Andreia

- Verify every starter and tool performs its existing action.
- Verify hover, focus, pointer transfer, `Escape`, and touch opening behavior.
- Verify the opening movement is right-to-left and closing movement is left-to-right.
- Verify the inner composer does not move or resize when the outer shell expands.
- Verify selecting a model closes the model menu and preserves the selected model.

### Review correction — fixed composer geometry

- The centered new-chat shell is wider (`56rem`) and visually shorter.
- The model selector moves to the lower-left control group.
- Model and send controls use compact `32px` dimensions.
- Only the collapsed line and revealed toolbar area can activate the toolbar.
- The line disappears while the toolbar is visible.
- The collapsed rail sits 8px farther from the shell. Both lines use reduced opacity at rest. The smaller 16px exterior line sits 5px away, fades in gradually, then fades out completely without leaving a dark resting stroke. Both animations start while the pointer is anywhere inside the outer composer shell, including the inner chat input container.
- The toolbar is rendered in its own connected surface to the left.
- The shell and inner composer never animate `width`, `height`, or margins.
- The left extension uses only `transform` and `opacity`, so it cannot resize the composer.
- In the collapsed state, the vertical trigger line sits outside the outer shell.
- In the open state, the icon toolbar visually becomes part of the outer shell with no seam between surfaces.
- The open icon toolbar and composer use one shared backdrop, border, radius, and shadow rather than two overlapping cards.
- Every product-update slide reserves the same height at a given breakpoint.
- Changing updates never moves or resizes the title, quick actions, composer, or carousel frame.
- Product updates render out of flow under the composer so showing or hiding them never shifts the centered empty-state title or prompt containers.
- Closing the toolbar never changes the inner composer's measured width or horizontal position; only the outer shell retracts from the left.
- On desktop, the inner composer uses equal 12-pixel spacing from the left and right edges of its stable column.

## Issue #7 — Add real modes and the Agents hub entry point

Status: Implemented locally — awaiting review
Estimate: 30 minutes–2 hours

### Description

Replace the four prompt shortcuts above the new-chat composer with `Chat`, `Research`, `Code`, and `Agents` mode tabs. Keep the model selector in the outer shell's top-right area. For this iteration, `Agents` is a visual hub backed by mock data while the agent builder and personal-agent pages are designed later.

### Acceptance criteria

- The new-chat shell shows `Chat`, `Research`, `Code`, and `Agents` as one accessible tab list with matching monochromatic icons.
- `Chat` is selected initially and preserves standard LLM behavior.
- Selecting `Research` activates the existing XENO Search path; selecting another mode deactivates it.
- Selecting `Code` keeps the existing composer and adds a code-focused instruction to the request without replacing the user's saved system prompt.
- Selecting `Agents` reveals compact `Create Agent`, `My Agents`, and `Agent Marketplace` mock buttons directly beside the `Agents` tab while the prompt composer remains visible.
- Agent actions enter from left to right with a staggered `40ms` delay; they close in reverse order when `Agents` is pressed again, then the interface returns to `Chat`.
- Users with `prefers-reduced-motion` receive the same state change without the slide animation.
- The mock agent buttons are intentionally not connected to routes or backend actions in this iteration.
- The selected mode has a visible active state and the tabs work with pointer and keyboard input.
- The model selector appears in the outer shell's top-right region, remains fully operable, and is not duplicated inside the inner composer. It is temporarily hidden while the Agent action buttons are open, then returns after an action is selected.
- In the desktop active-conversation composer, the `context window` token counter appears in the lower-left control group; it remains outside the mobile header and retains its existing `Compress` action near the limit.
- The microphone remains visible in the composer. A separate upward-arrow `Send message` button remains immediately to its right: it is muted and disabled without text or an attachment, then animates into its white active state when sending becomes possible.
- The white `Send message` control is optically smaller than the microphone: `28px` versus `32px` in the new-chat composer, and `36px` versus `40px` in an active conversation.
- The microphone reveals a compact down-chevron on its left only on microphone hover or keyboard focus; its right edge remains adjacent to `Send`. Touch users can tap the chevron directly.
- The `Hold to record` popover opens below the composer controls and uses XENO's monochromatic dark surface, grayscale switch, and compact single-row layout.
- `Hold to record` starts dictation on press and stops it on release or cancellation. The selected `tap` or `hold` mode persists after refresh.
- In `tap` mode, the first microphone click starts dictation and the second stops it. In `hold` mode, dictation lasts only while the microphone is pressed. Dictation is transcribed into the composer as speech arrives.
- Sending while dictation is active stops recognition, waits for its final transcript, then submits that final text so the last spoken words are not lost.
- When send becomes available, its active treatment enters over `240ms` with a fade, movement from 6 pixels to the left, and scale from `76%`; users who request reduced motion receive the instant state change.
- The empty-chat headline uses a trial of `Clash Display` at `32px` on small screens and `40px` on desktop, with tighter display tracking and a 24-pixel visual offset upward. `Inter` remains the UI font elsewhere.
- Switching modes does not move or resize the outer shell, inner composer, product updates, or content above them.
- Switching modes changes the composer guidance without adding a permanent subtitle or moving the empty-state layout.
- No new dependency or backend contract is introduced.

### Verification requested by Andreia

- Verify every mode tab can be selected and keeps the correct active state.
- Verify `Research` uses XENO Search and leaving it disables XENO Search.
- Verify `Code` remains inside the current composer and produces code-focused requests.
- Verify `Agents` displays exactly the three confirmed compact mock buttons beside its tab, keeps the composer visible, hides the model selector, and restores it when a mock action is selected.
- Verify Agent actions enter in left-to-right order and close right-to-left when `Agents` is pressed a second time.
- Verify the model selector opens, selects a model, closes, and preserves the selected model from its new position.
- Verify the disabled gray send button is always visible and cannot submit an empty composer; verify it becomes white when text or an attachment is present.
- Verify the microphone chevron and `Hold to record` popover work with pointer, keyboard, and touch, and the selected mode persists after refresh.
- Verify tap mode starts and stops on consecutive microphone clicks; verify hold mode starts on press and stops on release; verify `Send` after dictation sends the completed transcript.
- Verify the toolbar, carousel, composer geometry, pointer behavior, keyboard behavior, and touch behavior do not regress.

## Issue #7 — Align Chat themes with ElevenLabs surface hierarchy

Status: Implemented locally — awaiting review
Estimate: 30–90 minutes

### Description

Adapt the Chat LLM Dark and Light endpoint palettes to the neutral ElevenLabs surface hierarchy while preserving XENO's layout, components, motion, and continuous theme selector.

### Acceptance criteria

- Dark uses distinct neutral levels for canvas, surface, elevated content, controls, and strong controls.
- Light uses a neutral white canvas, near-white surfaces, light-gray controls, and near-black text.
- The existing Dim option and continuous 0–100 selector remain available.
- Every one of the 21 selector bars displays the real canvas color for its own theme percentage.
- Selecting a bar never replaces or brightens that bar's color; selection is shown with border and position only.
- No dependency or backend contract is introduced.

### Verification requested by Andreia

- Verify every selector bar keeps its own color instead of receiving a shared brightness treatment.
- Verify Dark and Light retain readable, visibly separated surfaces.
- Verify dragging and clicking the selector still applies and persists the selected theme.

## Issue #7 — Give intermediate Chat themes distinct surface palettes

Status: Implemented locally — awaiting review
Estimate: 30 minutes

### Description

Replace the visually flat Dark-to-Light brightness interpolation with explicit semantic palettes for every selectable 5% theme step. Make the microphone control exactly the same size as the adjacent Send control.

### Acceptance criteria

- Dark and Light retain the confirmed ElevenLabs endpoint palettes.
- Each selectable 5% step defines its own canvas, surface, elevated, control, border, and text colors.
- Dark, Dim, Dim Light, and the steps between them preserve visible separation between the page, outer composer, inner composer, and controls.
- No global brightness, opacity, or overlay treatment generates the intermediate themes.
- The microphone and Send controls use the same dimensions in both an empty chat and an active conversation.
- No dependency or backend contract is introduced.

### Verification requested by Andreia

- Verify the intermediate palettes read as distinct themes rather than a gray brightness layer.
- Verify every selector bar continues to preview its own applied canvas color.
- Verify the microphone and Send controls have equal width and height.
- Verify theme selection and persistence continue to work after refresh.

## Issue #7 — Match the Chat composer elevation to ElevenLabs

Status: Implemented locally — awaiting review
Estimate: 20 minutes

### Description

Replace XENO Chat's single heavy composer shadow with the layered elevation extracted from the supplied ElevenLabs HTML. Keep the inner input visually contained without giving it a second diffuse shadow.

### Acceptance criteria

- The Light theme outer composer uses the extracted four-layer ElevenLabs shadow geometry and opacity.
- Dark and Dim use the same shadow geometry with theme-appropriate opacity.
- Only the outer prompt container receives the diffuse elevation shadow.
- The inner input keeps only a subtle inset edge treatment.
- The former 60–70-pixel heavy composer shadows are removed.
- Layout, dimensions, toolbar animation, theme selection, and composer interaction do not change.
- No dependency or backend contract is introduced.

### Verification requested by Andreia

- Compare the outer prompt container's elevation against the supplied ElevenLabs screenshot.
- Verify the shadow remains visible but restrained in Dark, Dim, and Light.
- Verify the inner input does not create a second floating card effect.

## Issue #7 — Shrink Chat composer elevation to compact ElevenLabs shadow

Status: Superseded by zero-shadow trial
Estimate: 15 minutes (+ follow-up to remove remaining cloud)

### Description

The previous four-layer composer shadow still looked too large against the ElevenLabs home input. After the compact `12px` stack, Andreia still saw a soft cloud under the prompt box ("scoate norul"). Tighten further to edge-only elevation: short contact + outline on the outer container margins, no broad diffusion.

### Acceptance criteria

- Light outer composer uses:
  `0 1px 2px rgba(0, 0, 0, 0.04)`,
  `0 2px 4px rgba(0, 0, 0, 0.04)`,
  `0 0 0 1px rgba(0, 0, 0, 0.06)`.
- Dark and Dim keep the same edge-only geometry with theme-adapted opacity.
- The `48px` and `12px` diffuse clouds are removed from Chat theme tokens.
- Empty-state tool extension no longer uses `18px 18px 48px` cloud shadow.
- Outer composer still owns elevation; inner input keeps only its inset edge token.
- Layout, dimensions, toolbar animation, theme selection, and composer interaction do not change.
- No dependency or backend contract is introduced.

### Verification requested by Andreia

- Compare the outer composer shadow against the supplied ElevenLabs screenshot and confirm there is no soft cloud under the box — only a thin edge lift.
- Verify the edge elevation remains visible in Dark, Dim, and Light.
- Verify the inner input does not regain a second floating-card shadow.
- Open a composer tool panel and confirm the extension panel also has no 48px cloud.

## Issue #7 — Remove Chat composer drop shadow for now

Status: Superseded by one-plane contact elevation
Estimate: 5 minutes

### Description

Temporarily remove every composer drop shadow so the prompt box is defined only by border and surface color while Andreia judges the flat treatment.

### Acceptance criteria

- `--chat-composer-shadow` and `--chat-input-shadow` are `none` in Dark, Dim, and Light.
- Empty-state tool extension uses `shadow-none`.
- Former diffuse and edge shadow stacks are absent from the Chat theme tokens.
- Layout, dimensions, toolbar animation, theme selection, and composer interaction do not change.
- No dependency or backend contract is introduced.

### Verification requested by Andreia

- Confirm the empty-state prompt box has no drop shadow in Dark, Dim, and Light.
- Confirm the tool extension panel also has no drop shadow.
- Decide whether to restore a thin edge shadow later or keep the flat border-only look.

## Issue #7 — Match empty-chat composer to ElevenLabs bottom-edge elevation

Status: Implemented locally — awaiting review
Estimate: 15 minutes

### Description

The grey “cloud” beside the white prompt was the outer shell surface wrapping a second elevated input. Unify empty-chat outer + inner into one plane and restore a short ElevenLabs-style contact shadow so the outer bottom edge reads clearly without a side halo.

### Acceptance criteria

- Empty-chat `[data-chat-composer-shell]` uses `--chat-elevated` as its surface.
- Nested `.chat-input-container` is transparent (no second fill, no second border).
- Light `--chat-composer-shadow` uses:
  `0 1px 2px rgba(0, 0, 0, 0.04)`,
  `0 1px 1px -0.5px rgba(0, 0, 0, 0.06)`,
  `0 0 0 1px rgba(0, 0, 0, 0.10)`.
- Dark and Dim keep the same short contact geometry with theme-adapted opacity.
- `48px` / `12px` diffuse clouds remain absent.
- Active-conversation composer behavior outside the empty shell is unchanged.
- No dependency or backend contract is introduced.

### Verification requested by Andreia

- On Light, confirm there is no grey side halo around the white prompt.
- Confirm the outer bottom edge is clearly visible, comparable to the ElevenLabs reference.
- Check Dark and Dim still read as one plane with a short edge lift.
