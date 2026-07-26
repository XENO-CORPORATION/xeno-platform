# Decisions

## 2026-07-12 — Isolate the ChatWithLLM empty state

Options considered: Render the new interface inline in `ChatWithLLM.tsx`, or extract a separate `ChatEmptyState.tsx` component.

Industry standard (and why they landed there): Keep a focused interface responsibility in a small component so it can be read, changed, and verified without expanding an already large parent component.

Chosen: A separate `ChatEmptyState.tsx` component — because the empty-state interface will be easier to read, modify, and test.

Trade-off accepted: One additional file and a small component boundary.

Did the standard apply at our scale? Why / why not: Yes. `ChatWithLLM.tsx` already contains more than 9,000 lines, so isolating new presentation logic reduces further coupling without introducing a new framework or dependency.

Revisit if: The composer is later extracted into its own component and becomes responsible for the complete new-conversation layout.

## 2026-07-12 — Keep suggested prompts editable

Options considered: Send a hidden prompt immediately when an action is selected, or place a visible starter prompt in the composer.

Industry standard (and why they landed there): User-controlled submission keeps actions predictable and lets the user inspect or change the request before it consumes resources.

Chosen: Put the starter prompt in the composer and require an explicit send action — because the user gains control and can adapt the request.

Trade-off accepted: Sending requires one additional action.

Did the standard apply at our scale? Why / why not: Yes. The clarity benefit applies regardless of user count, and model requests have a real token cost.

Revisit if: Research shows that users consistently abandon the second step, or the action labels become complete and unambiguous prompts.

## 2026-07-12 — Open the file picker for document analysis

Options considered: Insert a document-analysis prompt without a document, or open the existing file picker first.

Industry standard (and why they landed there): Collect the required input before asking a model to operate on it.

Chosen: Open the existing file picker — because the model cannot analyze a document that has not been attached.

Trade-off accepted: An accidental click opens a system dialog immediately.

Did the standard apply at our scale? Why / why not: Yes. This is a direct dependency of the task, not a scale-specific optimization.

Revisit if: XENO adds a recent-document chooser directly to the empty state.

## 2026-07-12 — Use targeted extraction for the composer refinement

Options considered: Extract the complete composer, or extract only the model selector and product-update carousel.

Industry standard (and why they landed there): Component boundaries should isolate a responsibility without forcing a large prop interface or rewriting stable behavior.

Chosen: Extract `ChatModelSelector` and `ChatUpdateCarousel`, while retaining the main composer logic in `ChatWithLLM` — because this keeps the change focused and reduces regression risk.

Trade-off accepted: `ChatWithLLM.tsx` remains a large component.

Did the standard apply at our scale? Why / why not: Yes. The existing composer coordinates uploads, tokens, reasoning, voice, queues, and message submission; extracting all of it would exceed this visual-refinement scope.

Revisit if: The composer receives another behavior-heavy feature or can be migrated behind a stable, smaller prop contract.

## 2026-07-12 — Use a manual product-update carousel

Options considered: Automatic rotation or user-controlled navigation.

Industry standard (and why they landed there): Moving content must remain controllable so it does not change while a user is reading or navigating by keyboard.

Chosen: Manual previous/next navigation with a `220ms` horizontal transition and reduced-motion fallback — because reading control matters more than exposing every update automatically.

Trade-off accepted: Some users may never navigate to later updates.

Did the standard apply at our scale? Why / why not: Yes. Cognitive load and accessibility are user-level concerns, not scale-dependent concerns.

Revisit if: Product research shows poor discovery and XENO can add a compliant, user-controlled rotation setting.

## 2026-07-12 — Persist dismissed update IDs locally

Options considered: Reset dismissal after refresh, persist it in `localStorage`, or synchronize it through the backend.

Industry standard (and why they landed there): Non-critical UI preferences can be stored locally when cross-device synchronization is unnecessary.

Chosen: Store dismissed update IDs in `localStorage` — because dismissed updates should remain hidden after refresh without expanding backend scope.

Trade-off accepted: Dismissal does not synchronize across browsers or devices and is lost when browser data is cleared.

Did the standard apply at our scale? Why / why not: Yes. The data is tiny, non-sensitive, and browser-specific behavior is acceptable for this prototype.

Revisit if: Update dismissal becomes part of an account-wide notification center.

## 2026-07-12 — Expand the new-chat shell without moving the composer

Options considered: Place tool popovers outside the composer, replace the composer with a modal, or expand a surrounding shell while preserving the inner composer.

Industry standard (and why they landed there): Contextual tools should stay close to the control they modify, remain reachable by pointer and keyboard, and avoid moving the user's primary input target.

Chosen: Expand the outer shell only toward the left on desktop; keep the inner composer fixed. On small touch screens, show the rail as an overlay inside the shell.

Trade-off accepted: The shell needs separate desktop and small-screen geometry, and the expanded tool panel temporarily consumes more visual space.

Did the standard apply at our scale? Why / why not: Yes. Stable input placement and accessible disclosure matter for every user, independently of traffic scale.

Revisit if: The tool collection grows beyond the three confirmed actions or the composer becomes a shared component across other XENO interfaces.

## 2026-07-12 — Replace layout expansion with a visual toolbar extension

Options considered: Continue animating the shell width, overlay the toolbar inside the composer, or render a visually connected extension outside the fixed shell.

Industry standard (and why they landed there): Animate compositor-friendly properties such as `transform` and `opacity` instead of layout properties such as `width` and margins when surrounding geometry must remain stable.

Chosen: Keep the shell and composer dimensions fixed, then reveal a separate, visually connected toolbar surface to the left using `transform` and `opacity`.

Trade-off accepted: The extension is a separate layout layer even though it appears to users as part of the outer container.

Did the standard apply at our scale? Why / why not: Yes. The previous width animation caused a visible layout shift during every hover, so the stability benefit is immediate and measurable.

Revisit if: The toolbar becomes permanently visible or the left-side tools move into a dedicated application panel.

## 2026-07-12 — Reserve one stable carousel frame

Options considered: Allow every update to size itself, anchor the content above while allowing the carousel to grow downward, or reserve one fixed carousel height for every slide.

Industry standard (and why they landed there): Dynamic carousel content uses a stable wrapper or reserved space so replacing one slide does not shift surrounding interface elements.

Chosen: Use one fixed responsive frame for every update — `10.5rem` on desktop and `14rem` on small screens.

Trade-off accepted: Short updates contain deliberate empty space, and unusually long future updates must scroll inside the frame instead of growing it.

Did the standard apply at our scale? Why / why not: Yes. The current three mock updates already have different content heights and visibly move the centered composer when users navigate.

Revisit if: Final production update content receives a strict character limit that guarantees a smaller common frame.

## 2026-07-12 — Draw one shared surface for the open toolbar

Options considered: Overlap two independently styled cards, remove only the seam border, or draw one backdrop around the toolbar and composer together.

Industry standard (and why they landed there): A visually unified control group should have one elevation surface and one exterior outline; overlapping rounded cards retain separate silhouettes even when their seam borders are transparent.

Chosen: When the icon toolbar is open, render one shared backdrop behind both regions and remove the independent toolbar/shell border and shadow at their join.

Trade-off accepted: The visual surface is a separate presentation layer behind the interactive elements.

Did the standard apply at our scale? Why / why not: Yes. The two-card silhouette was visible immediately and contradicted the intended single-container composition.

Revisit if: The toolbar becomes a permanent structural column rather than a temporary composer extension.

## 2026-07-12 — Expand the actual outer composer element

Options considered: Animate a separate shared backdrop, reveal a clipped visual layer, or expand the actual outer composer inside a fixed-width parent section.

Industry standard (and why they landed there): Transform-only presentation layers usually minimize layout work, but they are the wrong abstraction when the product requirement is that the component itself owns the expanded geometry.

Chosen: Expand the actual outer composer width toward the left while keeping the parent section fixed and explicitly preserving the inner composer width at the right edge.

Trade-off accepted: The small outer subtree performs a width calculation during the transition; its fixed parent prevents that calculation from moving surrounding content.

Did the standard apply at our scale? Why / why not: Partially. We keep the containment and stable inner geometry, but intentionally accept a localized width transition to match the required physical interaction.

Revisit if: Browser measurements show frame drops or the toolbar grows beyond the current `3.25rem` extension.

## 2026-07-12 — Delay pointer-driven toolbar closure

Options considered: Close immediately, close after a short grace period, or keep the toolbar open until explicit dismissal.

Industry standard (and why they landed there): Hover-revealed interactive content remains available while hovered or focused and supports predictable dismissal, so users can reach and operate its controls without the surface disappearing unexpectedly.

Chosen: Start a one-second close timer only after the pointer leaves both the handle and toolbar; cancel it if the pointer returns. Keyboard focus keeps the toolbar open and `Escape` closes it immediately.

Trade-off accepted: The expanded shell occupies additional horizontal space for one second after pointer use has stopped, while giving users less recovery time than the original two-second delay.

Did the standard apply at our scale? Why / why not: Yes. Pointer accuracy, keyboard access, and predictable controls affect individual users regardless of traffic scale.

Revisit if: Usability testing shows that one second feels too abrupt or still unnecessarily slow.

## 2026-07-13 — Anchor the inner composer to a stable container

Options considered: Keep switching percentage widths with the toolbar state, measure and store a pixel width with `ResizeObserver`, or size the inner composer from a stable CSS query container.

Industry standard (and why they landed there): Container-relative units let a descendant follow a stable component boundary instead of inheriting temporary geometry from an animated intermediate parent.

Chosen: Make the empty-state section an inline-size query container and keep the inner composer at `calc(100cqw - 2px)`, accounting for the outer shell's two one-pixel borders.

Trade-off accepted: The layout relies on modern CSS container query units and still intentionally animates the outer shell's width.

Did the standard apply at our scale? Why / why not: Yes. Browser measurements showed a repeatable 52-pixel inner-composer jump on every closure, while the container-relative width remained constant at both desktop and narrow viewports.

Revisit if: XENO must support a browser without container query units or the outer shell border thickness becomes configurable.

## 2026-07-13 — Equalize desktop composer spacing

Options considered: Keep the asymmetric 16-pixel left and 12-pixel right padding, use 12 pixels on both sides at every breakpoint, or equalize only desktop spacing while preserving the touch safety area.

Industry standard (and why they landed there): Related controls use a consistent spacing rhythm unless one side needs reserved interaction space.

Chosen: Use 12 pixels on both desktop sides and retain the larger base left padding for the compact touch toolbar overlay.

Trade-off accepted: Desktop and compact touch layouts intentionally use different left padding values.

Did the standard apply at our scale? Why / why not: Yes. The four-pixel asymmetry was visible in the primary desktop composer, while the compact layout still needs protected tool space.

Revisit if: The compact toolbar no longer overlays the composer or the outer shell padding scale changes.

## 2026-07-13 — Make Agents a hub entry point

Options considered: Treat `Agents` as one general execution mode, open a picker for specialized agents, or use the tab as an entry point for creating, managing, and discovering agents.

Industry standard (and why they landed there): Agent ecosystems separate creation, personal inventory, and marketplace discovery so users can distinguish agents they own from agents they can install or rent.

Chosen: Selecting `Agents` reveals `Create Agent`, `My Agents`, and `Agent Marketplace` — because XENO intends to support user-created agents and a marketplace where agents can be shared or rented.

Trade-off accepted: `Chat`, `Research`, and `Code` are execution modes, while `Agents` is a hub, so the four tabs do not have perfectly identical behavior.

Did the standard apply at our scale? Why / why not: Yes for information architecture, but only as mock UI in this iteration because the local platform currently has no agent builder or personal-agent routes.

Revisit if: The agent builder and personal-agent inventory receive stable routes, or XENO introduces a general agent execution mode inside ChatWithLLM.

## 2026-07-13 — Keep Agent hub actions beside the Agents tab

Options considered: Replace the composer with a large Agent panel, open a popover, or reveal compact contextual actions in the same outer control row as the `Agents` tab.

Industry standard (and why they landed there): Contextual actions remain next to the control that reveals them so users can understand their relationship without losing the primary input surface.

Chosen: Place the three mock Agent actions immediately after `Agents`, hide the model selector only while they are open, and return to `Chat` after a mock action is pressed — because the actions are not yet connected to routes and the composer must remain available.

Trade-off accepted: The model selector is temporarily unavailable while Agent actions are visible, and a mock action returns to Chat rather than opening a real destination.

Did the standard apply at our scale? Why / why not: Yes. This is a direct interaction-clarity concern, independent of traffic scale; the compact layout also preserves one stable composer height.

Revisit if: XENO adds real Agent routes, agent selection, or a dedicated Agent execution mode.

## 2026-07-13 — Animate Agent actions as a reversible sequence

Options considered: Show and hide all Agent actions instantly, animate every action together, or use a staggered sequence with an explicit reverse sequence.

Industry standard (and why they landed there): A short stagger makes the relationship and order of a contextual group easier to scan, while reversible motion gives a repeated control a predictable result.

Chosen: Enter `Create Agent`, `My Agents`, and `Agent Marketplace` left-to-right at `40ms` intervals; on a second `Agents` click, close them right-to-left, then return to `Chat` and restore the model selector.

Trade-off accepted: Closing waits up to `240ms` before returning to Chat, so users can see the reverse sequence instead of receiving an instant state change.

Did the standard apply at our scale? Why / why not: Yes. This is interaction feedback, not a traffic-scale concern. The implementation animates only `transform` and `opacity`, and respects the system `prefers-reduced-motion` preference.

Revisit if: Agent actions become numerous enough to require a different disclosure pattern or users report that the stagger feels slow.

## 2026-07-13 — Keep Code inside the existing composer

Options considered: Use a code-focused chat instruction in the current composer, or build a separate coding workspace with an editor, preview, console, and file state.

Industry standard (and why they landed there): A dedicated coding workspace is useful for multi-file editing and execution, while a code-focused chat is the smaller pattern for generation, explanation, debugging, and review.

Chosen: Keep `Code` in the existing composer and layer a code-focused instruction over the user's saved system prompt.

Trade-off accepted: The mode does not provide a full project editor, file tree, or persistent coding workspace.

Did the standard apply at our scale? Why / why not: Yes. XENO already renders and executes code blocks, while a separate coding workspace would exceed the confirmed 30-minute–2-hour scope.

Revisit if: Users need coordinated multi-file edits, persistent project state, previews, or a dedicated console.

## 2026-07-14 — Place the composer context-window counter in the lower-left controls

Options considered: Keep the token counter beside the model selector and send button, place it in the lower-left tool group, or move it into a separate header status area.

Industry standard (and why they landed there): Small contextual status belongs close to the controls it describes, while primary actions such as model selection and send remain visually grouped and easy to scan.

Chosen: Put the desktop `context window` counter in the lower-left composer controls, after file actions and before the optional reasoning control; preserve the model selector and send button in the right-side action group.

Trade-off accepted: The counter is no longer immediately beside the selected model, but the primary action cluster is less crowded and its visual priority is clearer.

Did the standard apply at our scale? Why / why not: Yes. This is a local interaction and scanability concern, independent of traffic volume; it does not alter token counting or request behavior.

Revisit if: The composer gains more lower-left controls, the counter needs a progress visualization, or users need the counter visible on compact/mobile layouts.

## 2026-07-14 — Keep voice input and message sending as separate composer controls

Options considered: Replace the microphone with a send button when a message is ready, show both buttons at all times with a disabled send button, or keep the microphone visible and reveal send only when there is sendable content.

Industry standard (and why they landed there): Separate controls should retain separate functions. Icon-only buttons need an accessible name so keyboard and screen-reader users can identify their action.

Chosen: Keep the microphone visible. Keep an upward-arrow `Send message` button immediately to its right at all times, muted and disabled when the composer contains no text or attachment.

Trade-off accepted: The right control group always reserves one compact button, but voice input never appears to turn into a different action and the disabled treatment makes the empty state clear.

Did the standard apply at our scale? Why / why not: Yes. This is a direct interaction clarity and accessibility concern, independent of user volume; it reuses the existing send handler and does not introduce a new backend behavior.

Revisit if: A keyboard shortcut hint or more right-side actions require a different control density.

## 2026-07-14 — Reduce the visual weight of the white send control

Options considered: Keep send and microphone at the same size, use a dark send background, or reduce the white send button while keeping its position and behavior.

Industry standard (and why they landed there): High-contrast filled controls carry more visual weight than outlined or dark controls, so optical balance can require a smaller filled surface even when the actions share a row.

Chosen: Make the white upward-arrow send control 4px smaller than the microphone — `28px` in the new-chat composer and `36px` in the active composer — with a `16px` icon.

Trade-off accepted: The send target is smaller, which improves hierarchy but gives the user a slightly smaller pointer target than the microphone.

Did the standard apply at our scale? Why / why not: Yes. The imbalance was visible in the primary composer at normal desktop size; this is a visual hierarchy adjustment, not a scale-dependent feature.

Revisit if: Touch testing shows the smaller send target is difficult to tap, or the white surface is changed to a lower-contrast treatment.

## 2026-07-14 — Smooth the send button entrance

Options considered: Show the send button instantly, use a subtle fade and scale, or use a more noticeable fade, scale, and short horizontal entrance.

Industry standard (and why they landed there): Small contextual controls benefit from short transform-and-opacity motion because it gives visual continuity without animating layout. Motion must respect the system reduced-motion preference.

Chosen: Use a `240ms` entrance from 6 pixels to the right and `76%` scale to the final position and `100%` scale, with `cubic-bezier(0.22, 1, 0.36, 1)`. Apply it only through Tailwind's `motion-safe` variant.

Trade-off accepted: The interaction gains a more noticeable delay before visually settling, but the additional movement makes availability of the send control easier to notice without animating composer layout.

Did the standard apply at our scale? Why / why not: Yes. This is a user-perception and accessibility concern, independent of traffic; it changes neither request logic nor layout size.

Revisit if: Users perceive the 240ms duration as slow, or touch/reduced-motion testing reveals a problem.

## 2026-07-14 — Trial a distinct display voice for the XENO chat headline

Options considered: Keep Inter everywhere, adopt a new font throughout the platform, or use a distinctive display font only for the empty-chat headline while retaining Inter for the dense UI.

Industry standard (and why they landed there): Product typography often separates a more expressive display face from a highly readable interface face, so brand character does not reduce control density or scanability.

Chosen: Trial `Clash Display` for the XENO empty-chat headline only. Use `32px` on small screens, `40px` on desktop, readable `-0.01em` tracking, and a 24-pixel upward visual offset. Keep `Inter` for composer controls and body UI.

Trade-off accepted: One Fontshare web-font request creates a small loading cost, but the change is isolated to one headline and gives XENO a more recognizable visual voice. The current tight tracking can make adjacent word shapes appear too close, so this is deliberately a trial rather than a final brand decision.

Did the standard apply at our scale? Why / why not: Yes. XENO needs a coherent brand signal in its primary first-use state without risking broad UI readability; a headline-only rollout keeps the change reversible.

## 2026-07-14 — Offer persistent tap and hold voice input modes

Options considered: Keep one microphone behavior, open a separate voice page, or offer a compact selector next to the microphone.

Industry standard (and why they landed there): Controls with multiple input styles should expose the choice next to the affected control, retain keyboard semantics, and preserve a user preference when it changes repeated interaction.

Chosen: Keep tap-to-start as the default. Reveal a down-chevron to the left of the microphone on desktop microphone-hover or focus, keep it available on touch, and expose a compact monochrome `Hold to record` switch below the control row. Store the `tap` or `hold` choice in browser `localStorage`.

Trade-off accepted: The microphone needs a small contextual popover and one browser-local preference, but the composer avoids a separate settings page and supports both dictation habits.

Did the standard apply at our scale? Yes. This is a direct single-control usability decision and needs no backend contract or new dependency.

Revisit if: Voice input becomes a server-backed account preference, supports more languages, or gains a full conversational voice mode.

## 2026-07-14 — Submit only after voice recognition produces its final transcript

Options considered: Send the composer immediately when `Send` is clicked, disable `Send` during dictation, or stop recognition and submit once its final result arrives.

Industry standard (and why they landed there): Speech recognition can emit an interim result before its final result. Submission must wait for the final result or the user can lose the last spoken words.

Chosen: In either voice mode, keep live transcription in the composer. If the user presses `Send` while recognition is active, mark submission as pending, stop recognition, then submit the final transcript through the existing message path.

Trade-off accepted: There is a short delay after pressing `Send` while the browser finalizes recognition, but the sent message reliably contains the completed dictation.

Did the standard apply at our scale? Yes. This is correctness at the single-user interaction level, independent of traffic scale.

Revisit if: XENO moves to a server-side speech-to-text provider that has a different finalization event or supports streaming audio uploads.

## 2026-07-15 — Explain each XENO chat mode inside the composer

Options considered: Add a permanent subtitle below the headline, add extra quick-action cards, or change the composer placeholder with the selected mode.

Industry standard (and why they landed there): Major chat products keep advanced capabilities discoverable through contextual controls instead of placing every capability on the new-chat screen. The input is the closest place to explain what the active mode will do.

Chosen: Change the placeholder for `Chat`, `Research`, `Code`, and `Agents`. Keep the headline without a subtitle and preserve the existing layout.

Trade-off accepted: Guidance disappears once the user starts typing, but the first-use screen remains calm and the user retains a fully editable prompt.

Did the standard apply at our scale? Yes. XENO already has real mode behavior; contextual wording exposes it without a new backend feature, dependency, or layout surface.

Revisit if: Testing shows users need persistent mode explanations after they start typing, or Agent actions become connected to real routes and agent selection.

Revisit if: Andreia rejects the Clash Display trial, the tracking needs correction, the display font is adopted in another XENO product surface, font-loading affects the first render, or the brand system receives a dedicated typeface.

## 2026-07-16 — Trial a grouped inline model tray

Options considered: Keep the expandable provider dropdown, show every model as one horizontal row of buttons, or show every model in an overlay tray attached to the composer selector.

Industry standard (and why they landed there): Chat products keep the current model near the composer, but simplify the picker so people can choose by capability or provider without navigating a settings page. A raw horizontal list does not scale when model availability grows. [OpenAI model picker](https://help.openai.com/en/articles/11909943-gpt-53-and-54-in-) · [Claude model selector](https://support.anthropic.com/en/articles/8664678-how-can-i-change-the-model-version-that-i-m-chatting-with)

Chosen: Trial a monochrome `inline model-action rail`, anchored to the current model selector. Opening it temporarily replaces the mode tabs with a horizontally scrollable row of compact model buttons, each labelled with its provider. The buttons stagger from right to left and selecting one closes the rail immediately.

Trade-off accepted: The mode tabs temporarily hide while the rail is open, but the model choices no longer cover the input or change composer geometry.

Did the standard apply at our scale? Yes. XENO aggregates multiple providers, so a compact grouped surface is more useful than a picker built for one vendor's small model list. This is a local UI change with no backend contract or new dependency.

Revisit if: The horizontal rail becomes too long to browse, users need provider filtering or search, or Andreia rejects the visual trial.

## 2026-07-17 — Use ElevenLabs-style neutral hierarchy for Chat themes

Options considered: Keep XENO's existing endpoint colors, copy ElevenLabs component styling wholesale, or adapt only ElevenLabs' neutral surface hierarchy to XENO's existing Chat layout and interactions.

Industry standard (and why they landed there): Mature theme systems assign separate semantic colors to the page canvas, cards, popovers, controls, borders, primary text, and muted text. This preserves component hierarchy in both Dark and Light instead of applying one brightness filter over the complete interface. ElevenLabs UI follows this model in its official theme tokens.

Chosen: Adapt the official ElevenLabs neutral Dark and Light surface levels to Chat LLM. Keep XENO's structure, motion, Dim option, and continuous 21-step selector. Give every selector bar the real canvas color for its own percentage, and indicate only the selected bar with an outline and vertical offset.

Trade-off accepted: Dark controls become more visibly layered and Light becomes neutral white rather than XENO's previous warm off-white. The selector uses more explicit per-bar styling, but the selected state no longer distorts its preview colors.

Did the standard apply at our scale? Why / why not: Yes. Semantic theme tokens improve readability and consistency at any traffic scale and do not introduce runtime, backend, or dependency cost.

Revisit if: Andreia decides the endpoint palettes are too close to ElevenLabs, the midrange needs a different tonal curve, or accessibility testing finds a contrast failure at an intermediate percentage.

## 2026-07-17 — Use explicit palettes for every Chat theme step

Options considered: Keep interpolating RGB values, apply a global brightness filter, or define a complete semantic palette for every selectable five-percent step.

Industry standard (and why they landed there): Theme systems use semantic surface tokens rather than modifying the rendered page with one visual filter. Separate canvas, surface, elevated, control, border, and text tokens preserve hierarchy and allow contrast to be checked per component.

Chosen: Define 21 explicit palettes. Keep the ElevenLabs-inspired Dark and Light endpoints, and use XENO cool-graphite palettes through Dim and Dim Light. Share one size class between Microphone and Send so their dimensions cannot drift apart.

Trade-off accepted: The palette table is longer and future color changes must be reviewed across 21 entries, but each selectable theme is deterministic and visually auditable.

Did the standard apply at our scale? Why / why not: Yes. Semantic colors improve readability independently of user count, and the implementation remains local with no new dependency or backend work.

Revisit if: Visual review finds an abrupt transition near 90–100%, the cool graphite tint is too noticeable, or a palette fails contrast testing.

## 2026-07-17 — Separate composer elevation from inner-input containment

Options considered: Keep one heavy shared shadow on both containers, copy the supplied ElevenLabs shadow onto both containers, or apply the extracted four-layer elevation only to the outer composer while giving the inner input a subtle inset edge.

Industry standard (and why they landed there): Layered elevation combines a broad low-opacity shadow, a tighter contact shadow, a crisp edge, and an outline. Applying the same diffuse shadow to nested surfaces creates two competing floating cards instead of one clear hierarchy.

Chosen: Use the exact supplied ElevenLabs four-layer shadow on the Light outer composer. Preserve its geometry in Dark and Dim while adapting opacity for the darker canvases. Give the inner input only a one-pixel inset edge.

Trade-off accepted: Dark and Dim are adaptations rather than exact copies of the Light shadow values, but the composer remains readable without an oversized black halo. Theme-specific tokens add a small amount of CSS, while keeping layout and component logic unchanged.

Did the standard apply at our scale? Why / why not: Yes. Visual hierarchy is a per-user interaction concern, not a traffic-scale concern, and the change has no runtime dependency or backend cost.

Revisit if: Andreia wants a flatter composer, the shadow becomes too subtle on a future theme palette, or visual testing identifies clipping near a constrained viewport.

## 2026-07-17 — Use the compact ElevenLabs composer shadow

Options considered: Keep the four-layer stack with the `48px` cloud, copy a single soft `4px 24px` shadow, or use the compact three-layer elevation from the ElevenLabs extract.

Industry standard (and why they landed there): Large floating inputs use short contact shadows plus a 1px outline rather than a wide low-opacity halo. The extract showed the `48px` stack on the support-chat editor, while the home input reads visually as the tighter stack.

Chosen: Apply the compact three-layer shadow on the outer composer —
`12px` diffusion, `1px` contact, and `1px` outline — with Dark/Dim opacity adaptations.

Trade-off accepted: The composer sits closer to the page and loses the large soft halo. That matches Andreia's visual review that the previous shadow was still too big.

Did the standard apply at our scale? Why / why not: Yes. Elevation hierarchy is a local visual concern with no runtime, backend, or dependency cost.

Revisit if: Visual review finds the compact shadow too weak on a future canvas color, or Andreia wants the inner and outer surfaces fully merged into one card.

## 2026-07-18 — Remove the remaining composer cloud (edge-only elevation)

Options considered: Keep the compact `12px` diffusion layer, drop to contact+outline only, or use ElevenLabs outline-ring geometry (`1px 2px` + `2px 4px` + `1px` outline).

Industry standard (and why they landed there): Home-style floating inputs define depth at the card edge with short, low-opacity contact shadows and a crisp outline — not a soft halo under the box. Broad blur (12px+) still reads as a "cloud" even at low opacity.

Chosen: Edge-only stack on `--chat-composer-shadow` —
`0 1px 2px`, `0 2px 4px`, `0 0 0 1px` — with Dark/Dim opacity adaptations. Also replace the empty-state tool extension `18px 18px 48px` cloud with the same edge treatment.

Trade-off accepted: Elevation is subtler than the previous compact stack. On very dark canvases the lift may be harder to notice; that is preferred over another soft cloud.

Did the standard apply at our scale? Why / why not: Yes. This is a pure visual token change with no layout, API, or dependency cost.

Revisit if: Andreia finds the edge shadow too weak on a theme, or wants zero drop-shadow (border-only).

## 2026-07-18 — Remove Chat composer drop shadow for now

Options considered: Keep the edge-only stack, soften it further, or set every composer shadow token to `none`.

Industry standard (and why they landed there): Elevation is optional. Many dense product surfaces use border and surface contrast alone when a floating card is not required. Teams often trial a flatter state before locking a final elevation token.

Chosen: Set `--chat-composer-shadow` and `--chat-input-shadow` to `none` in Dark, Dim, and Light, and use `shadow-none` on the empty-state tool extension — because Andreia asked for zero shadow for now.

Trade-off accepted: The composer no longer lifts off the page. Separation depends entirely on border and background contrast.

Did the standard apply at our scale? Why / why not: Yes. This is a reversible local visual trial with no runtime or backend cost.

Revisit if: The flat composer feels too flush with the canvas, or Andreia wants a thin edge shadow restored.

## 2026-07-18 — One-plane empty composer with short bottom-edge contact

Options considered: Keep zero shadow, restore a broad cloud, or unify outer/inner into one elevated plane and use a short ElevenLabs-style contact stack.

Industry standard (and why they landed there): Floating inputs are one surface. Depth comes from a crisp outline plus a short contact shadow under the bottom edge — not from nesting two differently filled cards.

Chosen: Empty-chat shell uses `--chat-elevated`; the nested input is transparent. Light composer shadow is the short contact stack (`1px 2px` + `1px 1px -0.5px` + `1px` outline) so the bottom line stays visible without a side halo.

Trade-off accepted: Separation from the page depends on border + short contact rather than a soft cloud. Dark/Dim opacities are adaptations of the Light geometry.

Did the standard apply at our scale? Why / why not: Yes. This is a local visual hierarchy fix with no runtime or backend cost.

Revisit if: The bottom edge is still too soft on a future canvas color, or Andreia wants a fully border-only look again.

## 2026-07-18 — Bottom-weighted composer shadow and theme-aware tool-rail strokes

Options considered: Keep omnidirectional contact shadow, remove all elevation again, or use bottom-weighted shadows with negative spread and theme-aware rail strokes.

Industry standard (and why they landed there): Soft elevation under a floating input is biased downward. Side-equal shadows read as a halo. Discoverability strokes must contrast with the surface they sit on.

Chosen: Composer shadow uses `4px 12px -8px` (negative spread) plus a short contact and outline so left/right stay clean. Nested empty-state input keeps border + radius, transparent fill, and `box-shadow: none` only — borders were restored after over-removal. Tool-rail strokes use `--chat-tool-rail-stroke` tokens (dark on Light, light on Dark/Dim).

Trade-off accepted: Elevation is subtler on the sides by design; the bottom edge carries the depth cue.

Did the standard apply at our scale? Why / why not: Yes. Pure CSS token work with no dependency or backend cost.

Revisit if: Andreia still sees side halo after hard refresh, or wants the rail strokes permanently visible without hover.

## 2026-07-18 — Restore dismissed updates with "What's new" (option 1)

Options considered:
1. Always-visible "What's new" entry point
2. Warning on dismiss that updates will not return after refresh
3. Restore control only when every update is dismissed (replaces the carousel)

Industry standard (and why they landed there): Product update / changelog UIs persist dismissals in `localStorage`, but keep a recovery path so users can reopen updates on demand.

Chosen: Option 3 placement — when all updates are dismissed, show a "What's new" button fixed at the bottom-right of the **page**, portaled to `document.body`, using the same bordered `h-9` chrome as Settings / Theme / Temporary. Click clears dismissed IDs and restores the carousel below the composer.

Trade-off accepted: Recovery is available only after every update is closed, not while some slides remain visible. A body portal avoids the empty-state `-translate-y-1/2` trap that made `position: fixed` stick to the outer container.

Did the standard apply at our scale? Why / why not: Yes. Same `localStorage` persistence, no backend, no new dependency. Full always-on entry point would be overkill for three mock updates.

Revisit if: Users need to reopen one dismissed update while others stay visible, or the fixed corner conflicts with other chat chrome.

## 2026-07-18 — Keep empty-state center fixed when updates show or hide

Options considered:
1. Keep updates in normal document flow under the composer
2. Always reserve a fixed-height updates slot in flow
3. Position updates absolutely under the composer (`top-full`), out of the centered block's height

Industry standard (and why they landed there): Content that is vertically centered with `top: 50%` + `translateY(-50%)` jumps whenever the measured block height changes. Secondary UI is taken out of that height calculation.

Chosen: Option 3 — `data-update-carousel-slot` is `absolute; top: 100%` under the empty-state section. Title + composer height stays constant whether updates are visible, dismissed, or restored.

Trade-off accepted: Tall updates can extend below the centered cluster and may require scrolling the empty-state parent on short viewports, instead of pushing the composer up.

Did the standard apply at our scale? Why / why not: Yes. Pure layout; no new dependency. Reserving a permanent in-flow slot (option 2) would leave a dead gap when all updates are dismissed.

Revisit if: Updates need to stay fully visible above the fold on small screens without scroll.

## 2026-07-18 — Keep composer popovers above update carousel

Options considered: Raise only the voice popover z-index, hide updates while menus are open, or put the composer shell in a higher stacking context than the out-of-flow updates slot.

Industry standard (and why they landed there): Floating controls that belong to a surface must share that surface's stacking context above decorative/secondary siblings, or sibling z-index will cover nested popovers.

Chosen: Composer shell uses `z-20`; update carousel slot uses `z-0`. Voice / model menus that open downward stay above notifications without changing layout.

Trade-off accepted: Updates sit visually under composer chrome when they overlap in space.

Did the standard apply at our scale? Why / why not: Yes. Pure stacking-context fix.

Revisit if: Another empty-state overlay also needs to sit above the composer.

## 2026-07-18 — Per-update demo boxes in the carousel

Options considered:
1. Keep the right column only for copy/link actions
2. Always fill the right column with a feature-specific demo box (same chrome as Example prompt), each with a small looping preview

Industry standard (and why they landed there): Product update / changelog cards pair short copy with a concrete visual of the feature so the message is scannable without reading every word.

Chosen: Option 2 — every update passes a `demo` layout (`header` + optional Copy/meta + `body`) into one fixed Example-prompt shell. Body kinds: `code`, `composer-controls`, `flow-link`.

Trade-off accepted: Authors must supply layout fields per update. Legacy `action` still normalizes into that layout.

Did the standard apply at our scale? Why / why not: Yes. Static mock demos, no backend, reuses existing framer-motion.

Revisit if: Demos become noisy, or product wants video/screenshots instead of CSS micro-demos.

## 2026-07-18 — Rail "Recent files" becomes Conversation history

Options considered:
1. Keep Recent files as an in-shell tool panel
2. Replace that rail button with Conversation history that opens the existing history sidebar (`isHistoryOpen`)
3. Build a new right-side conversations panel just for empty state

Industry standard (and why they landed there): Conversation lists live in one shared history surface reused from every entry point, not duplicated per empty-state chrome.

Chosen: Option 2 — rail label/icon becomes Conversation history; click calls `setIsHistoryOpen(true)` and closes the rail. System Prompt stays as the only in-shell tool panel. Recent files remain available from the active-conversation composer path.

Trade-off accepted: History still slides in from the left (existing placement). Empty state no longer surfaces Recent files in the rail. Top-bar History control removed once the rail entry point worked — active conversations temporarily lose a desktop History button until another entry is added.

Did the standard apply at our scale? Why / why not: Yes. One history sidebar, two entry points.

Revisit if: Product wants history on the right, or Recent files back in the empty-state rail.

## 2026-07-18 — History sidebar inherits chat theme when portaled

Options considered:
1. Leave hardcoded dark colors on the history panel
2. Portal history into `.chat-themed` (risk: clipped by `overflow: hidden`)
3. Keep body portal, but put `chat-themed` + `chat-theme-*` + preview CSS variables on the portal root

Industry standard (and why they landed there): Portals leave the themed DOM subtree, so overlays must re-apply theme tokens on the portal root (Fluent UI / Base Themes pattern).

Chosen: Option 3 — history sidebar root carries the same theme classes/vars as the chat canvas; surfaces/borders/text use `--chat-*` tokens.

Trade-off accepted: Theme chrome is duplicated on the portal root until a shared ThemeProvider/root token host exists.

Did the standard apply at our scale? Why / why not: Yes. One chat theme system, two DOM roots.

Revisit if: Theme tokens move to `document.documentElement` globally.

## 2026-07-18 — Clip history slide so it never paints under the taskbar

Options considered:
1. Raise history z-index above the taskbar (panel would cover nav icons during the slide)
2. Keep animating `left` through the taskbar strip and rely on nav opacity
3. Clip: fixed viewport starts at the taskbar edge; panel uses `translateX` inside `overflow: hidden`

Industry standard (and why they landed there): Slide-in drawers that share the screen with a fixed rail animate inside a clipped region beside the rail, so the rail never shows foreign surfaces underneath.

Chosen: Option 3 on desktop single-chat. Mobile / multi-interface keep the previous left slide.

Trade-off accepted: Desktop open/close uses transform instead of left; clip width is fixed at 260px.

Did the standard apply at our scale? Why / why not: Yes. Pure layout fix, no new dependency.

Revisit if: Taskbar width changes from the current 60px / hidden-8px insets.

## 2026-07-18 — History panel flush to the taskbar

Options considered:
1. Keep the floating card (12px inset + rounded corners)
2. Sit flush: top/bottom 0, left = taskbar width (52px / `w-13`), no left border against the taskbar, square corners

Industry standard (and why they landed there): App rails that own a vertical strip usually dock secondary drawers to that rail without a floating gutter.

Chosen: Option 2 on desktop single-chat. Mobile / multi-interface keep the previous inset card for now.

Trade-off accepted: History reads as a docked column, not a floating card.

Did the standard apply at our scale? Why / why not: Yes. Matches the existing Overview taskbar width.

Revisit if: Taskbar width changes from `w-13` (52px).

## 2026-07-18 — Pin conversations in history (Pinned / Recents)

Options considered:
1. Flat list only, with a pin icon that does not regroup
2. Split into **Pinned** (top) and **Recents** (below); pin toggle on each row; persist `isPinned` with local history
3. Full ChatGPT-style time buckets (Today / Yesterday / …) plus pin — larger scope

Industry standard (and why they landed there): Chat sidebars float pinned threads above the recent stream so important chats stay reachable without search (Gram, Claude/ChatGPT-class apps).

Chosen: Option 2 for now. Pinned rows show a small MessageSquare leading icon (per Andreia's reference). Pin state is local (`isPinned` on the conversation object / localStorage). No DB pin field yet.

Trade-off accepted: Pin does not sync across devices until the backend stores it.

Did the standard apply at our scale? Why / why not: Yes for the UI split; backend sync can wait.

Revisit if: Product wants time buckets under Recents, or server-synced pins.

## 2026-07-18 — Projects entry at top of history sidebar

Options considered:
1. No Projects in history — keep only conversations
2. First row under search: Folder + **Projects** (reference look); click starts local create (name → list), stored in localStorage
3. Full project model wired to account/studio APIs immediately

Industry standard (and why they landed there): Product surfaces often put Projects / workspaces above thread history so organisation is one click from the same rail (Claude Projects, Cursor-style workspace lists).

Chosen: Option 2 as a visual + create stub. Not connected to studio/account projects yet.

Trade-off accepted: Creating a project here does not open a real project workspace — name list only until Andreia defines chat-project behaviour.

Did the standard apply at our scale? Why / why not: UI pattern yes; backend link deferred on purpose.

Revisit if: Chat projects should map to labs, workspaces, or account projects.

## 2026-07-18 — History row kebab menu with real actions

Options considered:
1. Keep separate Pin / Rename / Delete icons on hover
2. Single **⋯** control opening a menu (reference): Open as quick task, Pin, Mark unread, Rename, Add to project, Archive, Delete — wired to real state/API where available

Industry standard (and why they landed there): Chat sidebars collapse secondary actions into a kebab so the list stays scannable (Hugging Face chat-ui, Coder agents, NN/g contextual menus).

Chosen: Option 2. Pin/Rename/Delete unchanged in behaviour. Archive syncs via `chatService.updateConversation({ is_archived })` when authenticated. Unread + project assignment persist with local history. Quick task loads the chat and **keeps** history open.

Trade-off accepted: Unread/project are local until the backend gains fields; shortcuts work only while the menu is open.

Did the standard apply at our scale? Why / why not: Yes for the menu shell; partial for sync.

Revisit if: Backend adds pin/unread/project columns.

## 2026-07-18 — History top nav (Chats / Projects / Archived / …)

Options considered:
1. Keep Projects + Archived mixed into the conversation list
2. Claude-style top zone: New, Chats and tasks, Projects, Archived (under Projects when any exist), Artifacts, Scheduled, Customize — Pinned/Recents only under Chats

Industry standard (and why they landed there): LLM sidebars separate product destinations from the recents stream so archive/projects are findable without scrolling the thread list.

Chosen: Option 2. Archived conversations appear as an indented item under Projects only when at least one chat is archived. Artifacts / Scheduled / Customize are real destinations with empty states for now.

Trade-off accepted: Artifacts/Scheduled/Customize are shells until product defines their data.

Did the standard apply at our scale? Why / why not: Yes for IA; content depth deferred.

Revisit if: Artifacts or scheduled tasks ship as first-class features.

## 2026-07-25 — Share conversation: two-step modal, mock, backend-ready

Options considered:
1. Toast-only "Copied link" (Cursor-style) — fastest, weakest privacy UX
2. Privacy chooser only, no preview
3. Two-step modal: visibility + preview → link + copy + social (ChatGPT/Gemini composite)
4. Full backend share (snapshot, revoke, team ACL) in the same ticket

Industry standard (and why they landed there): Separate "who can see" from "here is the
URL". Personal shares are typically public-by-link snapshots; Team/Enterprise restrict by
workspace. After 2025 indexing incidents, privacy-by-default and clear copy matter more than
discoverability toggles
([OpenAI shared links FAQ](https://help.openai.com/en/articles/7925741-chatgpt-shared-links-faq);
[Simon Willison on privacy dialogs](https://simonwillison.net/2025/Aug/3/privacy-design/)).

Chosen: Option 3 with mock data — Private / Team / Public all selectable; Team behaves as a
real mock visibility (not disabled). Component `ChatShareModal.tsx` + a small
`createShareLink` mock module. Social: Copy + LinkedIn + X + Facebook + Reddit.

Trade-off accepted: No real persistence, revoke, or team ACL yet. Mock URLs are
session-level. Team does not actually restrict viewers until backend exists.

Did the standard apply at our scale? Why / why not: The dialog shape yes; real ACL no — we
are too early for workspace sharing, so Team is UI-contract only.

Revisit if: Backend share API lands, or product drops Team until workspaces exist.
