import React from 'react';

/**
 * The XENO glyph, inline.
 *
 * Inline rather than <img src="/logo.svg"> because the file's paths are
 * `fill="black"` — on a black page that is invisible, and the codebase's
 * workaround everywhere else is a CSS `invert` filter. That filter is what
 * produced a solid white square in the auth mark: `invert` inverts the WHOLE
 * element, background included, so any background on the image became its
 * opposite and covered the artwork.
 *
 * Inlining removes the problem rather than working around it:
 *   - `currentColor` means the glyph takes the colour of its context, so hover
 *     and disabled states just work instead of needing a second filter
 *   - no network request, and no flash of nothing before it loads
 *   - no filter, so a background can sit behind it safely
 *
 * The four paths are the four arms of the mark and are copied verbatim from
 * public/logo.svg — only `fill` changed. If the asset is ever redrawn, this
 * needs redrawing too; that duplication is the one cost of inlining, and it is
 * worth it here because this glyph sits on the sign-in page of every product.
 */
const XenoGlyph: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg
    viewBox="0 0 1082 1082"
    xmlns="http://www.w3.org/2000/svg"
    fill="currentColor"
    aria-hidden="true"
    focusable="false"
    className={className}
  >
    <path d="M489.1 219.763L323.457 39.7072L101.649 30.4597C51.6926 28.3769 39.5494 67.5718 39.7224 87.4296L30.4124 310.735L347.816 655.757L475.833 537.987L241.73 283.514C207.644 246.462 222.019 240.156 233.467 241.634L455.275 250.881L489.1 219.763Z" />
    <path d="M861.765 489.52L1041.69 323.704L1050.94 101.684C1053.03 51.6793 1013.87 39.5273 994.024 39.7019L770.9 30.3995L426.135 348.133L543.8 476.263L798.083 241.917C835.108 207.796 841.408 222.184 839.931 233.644L830.674 455.664L861.765 489.52Z" />
    <path d="M592.871 862.143L758.514 1042.2L980.322 1051.45C1030.28 1053.53 1042.42 1014.33 1042.25 994.477L1051.56 771.171L734.155 426.15L606.138 543.919L840.241 798.392C874.327 835.444 859.952 841.751 848.504 840.272L626.696 831.025L592.871 862.143Z" />
    <path d="M220.763 592.907L40.7063 758.55L31.4588 980.358C29.3761 1030.31 68.5709 1042.46 88.4287 1042.28L311.735 1051.59L656.756 734.191L538.986 606.174L284.514 840.277C247.462 874.363 241.155 859.988 242.633 848.54L251.881 626.733L220.763 592.907Z" />
  </svg>
);

export default XenoGlyph;
