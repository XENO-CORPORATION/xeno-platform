import React, { useState } from 'react';
import XenoGlyph from './XenoGlyph';

/**
 * The XENO mark, top-right of every auth surface.
 *
 * Clicking it slides the wordmark OUT FROM BEHIND the logo — right to left,
 * linear, 0 → 100 opacity. Three details make that actually read as "from
 * behind" rather than "next to":
 *
 *   1. The logo sits above the text in the stacking order (`z-10`) and carries
 *      the page's own background, so the text is genuinely occluded as it
 *      leaves rather than fading in over open space.
 *   2. The text animates `max-width` as well as transform, so it does not
 *      reserve a gap while hidden — otherwise the logo starts pre-shifted and
 *      the reveal has nowhere to travel from.
 *   3. `ease-linear`, as asked: constant velocity reads as mechanical, which
 *      is the register this system is in. An ease-out here would feel
 *      decorative.
 *
 * It is a <button> with aria-expanded, not a div: it toggles state, and a
 * keyboard user should be able to reach it and be told what it did.
 */
const AuthMark: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [open, setOpen] = useState(false);

  return (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      aria-expanded={open}
      aria-label={open ? 'Hide the XENO wordmark' : 'Show the XENO wordmark'}
      className={`group flex items-center overflow-hidden cursor-pointer ${className}`}
    >
      <span
        aria-hidden={!open}
        className={`whitespace-nowrap text-lg font-semibold tracking-tight text-white/90 transition-all duration-500 ease-linear ${
          open
            ? 'opacity-100 translate-x-0 max-w-[7rem] mr-2'
            : 'opacity-0 translate-x-8 max-w-0 mr-0'
        }`}
      >
        XENO
      </span>

      {/*
        Inline SVG, not <img src="/logo.svg">.

        🔴 The first version was an <img> with `invert` — and a background on
        the same element to occlude the wordmark. `invert` is a CSS filter that
        inverts the WHOLE element, background included, so black became a solid
        WHITE SQUARE covering the artwork. That is the bug you saw.

        Moving the background to a wrapper fixes the symptom; inlining removes
        the cause. The glyph now takes `currentColor`, so hover is a colour
        change rather than a second filter, there is no request, and a
        background can sit behind it safely.

        The wrapper still carries the page's ground — that is what the wordmark
        actually disappears behind on its way out.
      */}
      <span className="relative z-10 grid h-7 w-7 shrink-0 place-items-center bg-[#000000]">
        <XenoGlyph className="h-[26px] w-[26px] text-white/85 transition-all duration-300 group-hover:text-white group-hover:scale-105" />
      </span>
    </button>
  );
};

export default AuthMark;
