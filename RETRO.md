# Retrospectives

## 2026-07-17 — Explicit Chat theme palettes

- Estimate: 30 minutes.
- Actual: completed within the estimate.
- What broke: The first technically correct version still looked like a gray brightness layer during browser review.
- What changed: Replaced neutral midrange values with explicit cool-graphite semantic palettes and reused one size rule for Microphone and Send.
- What to do differently: Include a browser screenshot of the middle theme positions before treating token-level tests as sufficient.

## 2026-07-17 — Layered Chat composer elevation

- Estimate: 20 minutes.
- Actual: completed within the estimate.
- What broke: Before implementation, the outer composer and inner input shared one heavy 60-pixel diffuse shadow, so the nested surfaces competed visually.
- What changed: Applied the extracted four-layer ElevenLabs shadow to the outer composer only and reduced the inner input to a subtle inset edge.
- What to do differently: Continue checking both computed shadow values and unchanged container dimensions in the browser; a correct token alone does not prove that the hierarchy or layout is stable.

## 2026-07-17 — Compact Chat composer elevation

- Estimate: 15 minutes.
- Actual: completed within the estimate.
- What broke: The four-layer shadow with the `48px` cloud still looked too large against the ElevenLabs screenshot; that stack belonged to support chat in the extract, not the home input.
- What changed: Removed the `48px` layer and kept the compact three-layer elevation on the outer composer for Light, Dark, and Dim.
- What to do differently: Match shadow tokens to the exact component in the reference image before treating an extract value as the home-composer source of truth.

## 2026-07-18 — Zero Chat composer drop shadow

- Estimate: 5 minutes.
- Actual: completed within the estimate.
- What broke: Even the edge-only stack still counted as shadow for Andreia's review; she wanted none for now.
- What changed: Set composer and input shadow tokens to `none`, and removed the tool-panel drop shadow.
- What to do differently: When the visual goal is "no cloud," ask early whether the accepted end state is thin edge lift or truly zero shadow.

## 2026-07-18 — One-plane empty composer bottom edge

- Estimate: 15 minutes.
- Actual: completed within the estimate.
- What broke: The “cloud” beside the white prompt was the grey outer shell (`surface`) wrapping a white inner (`elevated`), not a large `box-shadow`.
- What changed: One elevated plane for shell + transparent inner; short contact shadow for a visible bottom edge like ElevenLabs.
- What to do differently: When a light theme shows a side halo, inspect nested surface tokens before chasing shadow values.
