---
name: xeno-gooey
description: >-
  Bake a gooey / liquid "melted junction" effect into an SVG icon at the
  geometry level — pure vector, NO runtime filter — following XENO icon
  standards. Use whenever the user pastes SVG code with multiple layers or
  overlapping shapes (a lens+handle magnifier, joined bars, fused blobs) and
  asks to apply the gooey / liquid / melt / fuse effect, round the junction,
  "melt the shapes together", or "make it XENO". Produces one clean
  <path fill="currentColor"> normalized to the 24 grid, with an optional
  runtime-filter version for in-app hover only.
---

# XENO Gooey — bake the melt into the path

Turn an SVG made of **overlapping layers** into a single clean icon whose joints
look **melted / liquid (gooey)** — with the effect **baked into the geometry**,
not applied as a live filter.

## The one rule that matters

**The shipped asset is ALWAYS pure geometry. Never ship the `feGaussianBlur`
gooey filter inside a `.svg`.** It dies in Figma, turns to mush at 16px, and
breaks `currentColor`. The filter is a *design tool / runtime flourish* only.

A boolean **Union does NOT create gooey** — it fuses shapes with **sharp,
straight concave corners**. The melted look is a *concave fillet (meniscus)* at
each junction, which you add deliberately. That fillet is what this skill bakes.

## XENO standards to enforce on every output

- **No circles.** Any round sub-form (lens, dial, head, dot) must be a
  **squircle** — a rounded-corner square/rect. Convert circles you receive.
- **Monochrome**, single color → `fill="currentColor"` (or `stroke="currentColor"`).
- **24×24 viewBox**, content inset with ~2px padding.
- **Rounded joins/caps** everywhere; corners consistent.
- Shell/UI icons stay thin outline; the gooey/liquid look is the **bold /
  expressive tier** — apply it only when the user asks for the melt.

## Inputs this handles

- Multiple `<path>`/`<rect>`/shape layers that **overlap** at a junction.
- A single flattened path that still has a **sharp concave junction**.
- Stroked shapes (lens ring + handle line). Outline them first if you need a
  single filled path.

## The bake procedure

1. **Read the geometry.** List the shapes and find the **junction(s)** — where
   two shapes overlap and form a concave "armpit". Note the shared color.
2. **Normalize color + frame** (see checklist below). Two overlapping filled
   paths of the same color already read as one silhouette — you do **not** need
   a boolean union just to render solid.
3. **Bake the meniscus at each armpit.** For every sharp concave corner where
   two boundaries meet:
   - Find the **junction vertex `V`** (where the two outer boundaries cross).
   - Pick a **pull-back point on each of the two boundaries**, at distance `p`
     from `V` along that boundary toward the shape's body (`p` = melt amount).
   - Replace the sharp corner with a **quadratic Bézier**:
     `Q Vx Vy  Px Py` — start at pull-back #1, **control = `V`**, end at
     pull-back #2. This rounds the concave notch → the meniscus.
   - Do it on **both** armpits of a junction (keep it symmetric).
4. **Assemble one outline path.** Walk the silhouette once (lines `L`, convex
   corner arcs `A`, junction fillets `Q`, round cap `A`). Add ring holes as a
   second subpath and set `fill-rule="evenodd"`.
5. **Verify:** no self-intersections, corners squircle (not circular), reads at
   16px. Then output.

### Melt levels (pull-back `p`, in 24-grid units)

| Level    | `p`      | Notes                                                    |
|----------|----------|---------------------------------------------------------|
| subtle   | ~0.4     | barely rounded joint                                    |
| medium   | ~0.6–0.8 | default; clearly melted, still crisp                    |
| strong   | ~1.0–1.2 | very liquid; also nudge control slightly into the notch |

Ask which level if unspecified; default **medium**.

## Normalization checklist (always)

- `fill="#000"` / `black` / any hex → **`fill="currentColor"`**.
- One `viewBox="0 0 24 24"`; if the source uses a big viewBox, either rescale
  the coords or wrap the paths in `<g transform="translate(px py) scale(s)">`
  so content lands in ~`2..22` (no path-data edit needed).
- `fill-rule="evenodd"` when there are ring holes.
- Strip Figma cruft: unused `<defs>`, `clip-path`, random `id`s, redundant `<g>`.
- Round path decimals to ~2 places.
- Prefer **one `<path>`**; multiple same-color paths are acceptable if cleaner.

## Output to the user

1. The final **baked `<svg>`** (single path, `currentColor`, 24 grid).
2. One line: melt level used + how to dial it (adjust the two `Q` pairs).
3. Optional: the **runtime hover filter** version (below), clearly marked
   *in-app only, never exported*.
4. Offer to add it to the XENO Icons foundry gallery.

## Worked example — magnifier (medium melt)

Input: two overlapping layers (squircle lens ring + diagonal handle). Baked:

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd">
  <path d="M6 2 L12 2 A4 4 0 0 1 16 6 L16 12 A4 4 0 0 1 15.9 12.9
           Q15.64 13.66 16.06 14.08 L20.99 19.01 A1.4 1.4 0 0 1 19.01 20.99 L14.08 16.06
           Q13.66 15.64 12.9 15.9 A4 4 0 0 1 12 16 L6 16 A4 4 0 0 1 2 12 L2 6 A4 4 0 0 1 6 2 Z
           M6 4.8 L12 4.8 A1.2 1.2 0 0 1 13.2 6 L13.2 12 A1.2 1.2 0 0 1 12 13.2
           L6 13.2 A1.2 1.2 0 0 1 4.8 12 L4.8 6 A1.2 1.2 0 0 1 6 4.8 Z"/>
</svg>
```

The two `Q…` curves are the baked meniscus (one per armpit). Increase melt by
moving each pair's pull-back points closer to the junction vertex `V`
(`15.64 13.66` and `13.66 15.64`).

## Runtime-only hover filter (never export this in an asset)

For a live "melt" flourish in the platform UI, wrap the *baked* paths — or the
raw overlapping layers — in this filter at render time only:

```svg
<filter id="xeno-goo" x="-30%" y="-30%" width="160%" height="160%">
  <feGaussianBlur in="SourceGraphic" stdDeviation="0.5" result="b"/>
  <feColorMatrix in="b" type="matrix"
    values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 26 -11" result="g"/>
  <feComposite in="SourceGraphic" in2="g" operator="atop"/>
</filter>
```

Small `stdDeviation` melts only the joint; larger = more liquid (also rounds the
whole shape). Keep it in CSS/JSX, out of the exported `.svg`.

## When to pause and ask

- Many organic blobs where hand-baking would be unreliable → say so, and offer
  the render→trace route or a boolean-lib script instead of guessing.
- Ambiguous melt strength → ask (default medium).
- Shape contains a real circle → confirm converting it to a squircle (XENO rule).
