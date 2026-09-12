/**
 * Gooey composer reveal — the metaball mechanics shared by the mode tabs, the agent
 * action rail and the inline model rail.
 *
 * Every button that emerges is drawn TWICE: once as the real interactive element, which
 * carries no chrome while it travels, and once as a plain blob inside a single
 * SVG-filtered layer (the "skin") that also holds the composer body. Because the blobs
 * and the box live in the SAME filtered layer, the metaball filter melts them together
 * and a liquid neck forms while a button pulls away. Once a button has landed its own
 * chrome snaps on and its blob dissolves behind it. Overflowing rails can keep the real
 * controls fixed at their final geometry while only this duplicate skin travels.
 *
 * Two emergence shapes:
 *   • rise  (chain: false) — every item climbs out of the composer box, staggered.
 *   • chain (chain: true)  — the first item is born inside the control that opened the
 *                            rail, each next one inside the item before it.
 */

export const GOOEY_FILTER_ID = 'chat-composer-gooey-filter';

/** How far below its resting place an item starts when it climbs out of the box. */
const RISE_DISTANCE_PX = 46;
const RISE_SCALE = 0.94;
/** Width a chained chip is born at, as a nub inside the chip it comes out of. */
const NUB_WIDTH_PX = 20;
const NUB_SCALE_Y = 0.66;
/** Time the blob needs to fade out once its button has taken over. */
const BLOB_MELT_MS = 360;
/** Grace period after a travel ends before the hand-off runs. */
const LANDING_GRACE_MS = 40;

export const GOOEY_CLASS = {
  item: 'chat-gooey-item',
  bare: 'chat-gooey-item--bare',
  up: 'chat-gooey-item--up',
  /** Neutralises the transform so a resting rect can be read. */
  measure: 'chat-gooey-item--measure',
  /**
   * Holds transitions off. The start position has to be flushed as a real computed
   * value before the flip, or the browser sees `none → none` and never animates.
   */
  still: 'chat-gooey-item--still',
  /** Keeps the real control at its final rect while its duplicate skin travels. */
  fixed: 'chat-gooey-item--fixed',
  blob: 'chat-gooey-blob',
  blobGone: 'chat-gooey-blob--gone',
  /**
   * Keeps a blob opaque for the whole travel. On the way IN the fade happens while the
   * blob is still buried inside the chip it was born in, so nobody sees it; played
   * backwards that same fade lands at the START of the retreat and the chips vanished
   * instantly instead of melting away.
   */
  blobHold: 'chat-gooey-blob--hold',
  clipOpen: 'chat-gooey-clip--open',
} as const;

export interface GooeyRunOptions {
  /** The filtered layer the blobs are injected into. */
  skin: HTMLElement;
  /** The real buttons, in DOM order. */
  items: HTMLElement[];
  /** Per-item delay in ms, index-aligned with `items`. */
  delays: number[];
  /**
   * Which chip is born inside which, when that differs from the timing. Playing a chain
   * backwards has to reverse the CLOCK while keeping the TOPOLOGY: each chip must melt
   * back into the one it came out of, not into whichever is next in the new order.
   * Defaults to `delays`.
   */
  orderDelays?: number[];
  /** Travel time of a single item. */
  durationMs: number;
  /** true = chained sideways, false = every item rises out of the box. */
  chain: boolean;
  /**
   * Animate only the filtered duplicate. The real control keeps its final bounding box,
   * while its chrome and label wait for the duplicate to land. This is required for
   * horizontally scrolling rails: transforming the real controls produces clipped nubs
   * and labels that appear detached from their buttons.
   */
  preserveItemGeometry?: boolean;
  /** 'in' plays the emergence, 'out' plays it backwards. */
  direction?: 'in' | 'out';
  /** The control the chain grows out of — it goes liquid for that moment. */
  fromEl?: HTMLElement | null;
  /**
   * Where the chain is born, when the control that opened it is already gone by the
   * time the rail renders (the Agents tab is replaced by the rail it opens). Captured
   * before the swap and passed in here.
   */
  fromRect?: DOMRect | null;
  /** Scroll container that would otherwise clip the travel (overflow-x clips y too). */
  clip?: HTMLElement | null;
  /** Runs once every item has landed and every blob is gone. */
  onSettled?: () => void;
}

interface StartState {
  tx: number;
  ty: number;
  sx: number;
  sy: number;
}

const setStartVars = (node: HTMLElement, start: StartState, durationMs: number, delayMs: number) => {
  node.style.setProperty('--gooey-dur', `${durationMs}ms`);
  node.style.setProperty('--gooey-delay', `${delayMs}ms`);
  node.style.setProperty('--gooey-tx', `${start.tx}px`);
  node.style.setProperty('--gooey-ty', `${start.ty}px`);
  node.style.setProperty('--gooey-sx', `${start.sx}`);
  node.style.setProperty('--gooey-sy', `${start.sy}`);
};

const clearStartVars = (node: HTMLElement) => {
  ['--gooey-dur', '--gooey-delay', '--gooey-tx', '--gooey-ty', '--gooey-sx', '--gooey-sy']
    .forEach((name) => node.style.removeProperty(name));
};

/** Start life as a small blob centred inside `source`. */
const nubInside = (rect: DOMRect, source: DOMRect): StartState => ({
  tx: (source.left + source.width / 2) - (rect.left + rect.width / 2),
  ty: (source.top + source.height / 2) - (rect.top + rect.height / 2),
  sx: Math.min(Math.max(NUB_WIDTH_PX / Math.max(rect.width, 1), 0.1), 0.55),
  sy: NUB_SCALE_Y,
});

/**
 * Start life AS `source`, same size and place, then glide into position. Used when the
 * control that opened the rail is itself gone (the Agents tab is replaced by its rail):
 * the chip becomes that button rather than being born next to a ghost of it.
 */
const morphFrom = (rect: DOMRect, source: DOMRect): StartState => ({
  tx: (source.left + source.width / 2) - (rect.left + rect.width / 2),
  ty: (source.top + source.height / 2) - (rect.top + rect.height / 2),
  sx: source.width / Math.max(rect.width, 1),
  sy: source.height / Math.max(rect.height, 1),
});

/**
 * Plays one emergence. Returns a cancel function that tears everything down and leaves
 * the items in their plain resting state — safe to call at any point, including from a
 * React cleanup while the animation is mid-flight.
 */
export const runGooey = (options: GooeyRunOptions): (() => void) => {
  const {
    skin,
    items,
    delays,
    orderDelays,
    durationMs,
    chain,
    preserveItemGeometry = false,
    direction = 'in',
    fromEl = null,
    fromRect: explicitFromRect = null,
    clip = null,
    onSettled,
  } = options;

  const timers: number[] = [];
  const blobs: HTMLElement[] = [];
  let isCancelled = false;

  const cancel = () => {
    isCancelled = true;
    timers.forEach((timer) => window.clearTimeout(timer));
    timers.length = 0;
    blobs.forEach((blob) => blob.remove());
    blobs.length = 0;
    items.forEach((item) => {
      item.classList.remove(
        GOOEY_CLASS.item,
        GOOEY_CLASS.bare,
        GOOEY_CLASS.up,
        GOOEY_CLASS.measure,
        GOOEY_CLASS.still,
        GOOEY_CLASS.fixed,
      );
      clearStartVars(item);
    });
    clip?.classList.remove(GOOEY_CLASS.clipOpen);
  };

  /**
   * Hands a button back its own chrome WITHOUT it animating in.
   *
   * `.chat-gooey-item` overrides `transition` to transform only, so while it is on, a
   * background change is instant. Drop it in the same breath as `--bare` and the button's
   * own `transition-[background-color,…] duration-150` comes back first, and it then fades
   * its fill in from transparent — the button sat there looking empty for 150ms after its
   * blob had already gone. So: un-bare it while still frozen, let it paint, and only then
   * give the element its transitions back.
   */
  const restoreChrome = (element: HTMLElement) => {
    element.classList.remove(GOOEY_CLASS.bare);
    window.requestAnimationFrame(() => {
      element.classList.remove(
        GOOEY_CLASS.item,
        GOOEY_CLASS.up,
        GOOEY_CLASS.still,
        GOOEY_CLASS.measure,
        GOOEY_CLASS.fixed,
      );
      clearStartVars(element);
    });
  };

  if (items.length === 0) {
    onSettled?.();
    return cancel;
  }

  clip?.classList.add(GOOEY_CLASS.clipOpen);

  // Read each button's own fill BEFORE it is stripped. A blob stands in for one specific
  // button, so it has to be painted like that button — the composer fill is a different
  // colour from a control's, and using it made every chip change shade the moment its
  // blob took over. Most visible on the model trigger, which sits still for the whole
  // exit: it simply turned white and back again.
  const fillOf = (element: HTMLElement): string => {
    const fill = window.getComputedStyle(element).backgroundColor;
    return !fill || fill === 'transparent' || fill.endsWith(', 0)') ? '' : fill;
  };
  const itemFills = items.map(fillOf);
  const fromFill = fromEl ? fillOf(fromEl) : '';

  // Measure at rest, with transitions held off so the jump to the start position that
  // follows is silent.
  items.forEach((item) => {
    item.classList.remove(GOOEY_CLASS.up);
    item.classList.add(GOOEY_CLASS.item, GOOEY_CLASS.bare, GOOEY_CLASS.measure, GOOEY_CLASS.still);
    item.classList.toggle(GOOEY_CLASS.fixed, preserveItemGeometry);
  });
  const skinRect = skin.getBoundingClientRect();
  const rects = items.map((item) => item.getBoundingClientRect());
  const fromRect = explicitFromRect ?? fromEl?.getBoundingClientRect() ?? null;

  // Birth order = ascending order-delay, which for a forward run is just the timing.
  const topology = orderDelays ?? delays;
  const order = items.map((_, index) => index).sort((a, b) => topology[a] - topology[b]);

  const starts: StartState[] = [];
  order.forEach((index, position) => {
    if (!chain) {
      starts[index] = { tx: 0, ty: RISE_DISTANCE_PX, sx: RISE_SCALE, sy: RISE_SCALE };
      return;
    }

    if (position === 0) {
      if (!fromRect) {
        starts[index] = { tx: 0, ty: RISE_DISTANCE_PX, sx: RISE_SCALE, sy: RISE_SCALE };
        return;
      }
      // The source is still on screen (the model trigger): the chip is born as a nub
      // inside it. The source is gone (the Agents tab): the chip IS it, and glides over.
      starts[index] = fromEl
        ? nubInside(rects[index], fromRect)
        : morphFrom(rects[index], fromRect);
      return;
    }

    starts[index] = nubInside(rects[index], rects[order[position - 1]]);
  });

  items.forEach((item, index) => {
    const start = starts[index];
    const rect = rects[index];
    const blob = document.createElement('span');

    blob.className = GOOEY_CLASS.blob;
    blob.style.left = `${rect.left - skinRect.left}px`;
    blob.style.top = `${rect.top - skinRect.top}px`;
    blob.style.width = `${rect.width}px`;
    blob.style.height = `${rect.height}px`;
    blob.style.borderRadius = window.getComputedStyle(item).borderRadius;
    if (itemFills[index]) blob.style.background = itemFills[index];
    setStartVars(blob, start, durationMs, delays[index]);
    setStartVars(item, start, durationMs, delays[index]);

    skin.appendChild(blob);
    blobs.push(blob);
  });

  // The trigger needs a blob of its own, otherwise the first chip has nothing to be
  // liquid with and simply slides out with no neck.
  // Only when the trigger is still there, though: standing one in for a button that has
  // already been replaced leaves a full-size shape parked at the far end of the rail,
  // which reads as "the last chip arrived first".
  //
  // The trigger KEEPS its own chrome throughout — it is a permanent control, not a chip
  // passing through, and it must never be caught without its container. It used to go
  // liquid like everything else, which broke the moment its label changed: picking a
  // model resizes the button, its stand-in blob no longer covered it, and the new name
  // was left floating with the old blob sitting beside it.
  let sourceBlob: HTMLElement | null = null;
  if (chain && fromRect && fromEl) {
    sourceBlob = document.createElement('span');
    // Born already at rest and visible — it stands in for the button, it does not travel.
    sourceBlob.className = `${GOOEY_CLASS.blob} ${GOOEY_CLASS.up} ${GOOEY_CLASS.still}`;
    // Inset by the border width so the filter's outline — which traces 1px OUTSIDE the
    // silhouette — lands on the button's own border instead of haloing around it.
    const inset = Number.parseFloat(window.getComputedStyle(fromEl).borderTopWidth) || 0;
    sourceBlob.style.left = `${fromRect.left - skinRect.left + inset}px`;
    sourceBlob.style.top = `${fromRect.top - skinRect.top + inset}px`;
    sourceBlob.style.width = `${Math.max(fromRect.width - inset * 2, 0)}px`;
    sourceBlob.style.height = `${Math.max(fromRect.height - inset * 2, 0)}px`;
    sourceBlob.style.borderRadius = window.getComputedStyle(fromEl).borderRadius;
    if (fromFill) sourceBlob.style.background = fromFill;
    skin.appendChild(sourceBlob);
    blobs.push(sourceBlob);
  }

  const settleItem = (item: HTMLElement | null, blob: HTMLElement | null) => {
    if (isCancelled) return;
    if (item) {
      // Strip every class: a React re-render can replace these nodes at any time, and a
      // fresh node must look normal without the gooey classes ever having been applied.
      restoreChrome(item);
    }
    if (blob) {
      blob.style.removeProperty('--gooey-delay');
      blob.classList.add(GOOEY_CLASS.blobGone);
    }
  };

  const maxDelay = delays.reduce((largest, delay) => Math.max(largest, delay), 0);

  // Leave the measuring pass and settle into the pose the travel starts from — still
  // frozen, then flushed, so the browser has a real "before" value to animate away from.
  items.forEach((item) => {
    item.classList.remove(GOOEY_CLASS.measure);
    if (direction === 'out') item.classList.add(GOOEY_CLASS.up);
  });
  if (direction === 'out') {
    blobs.forEach((blob) => blob.classList.add(GOOEY_CLASS.up, GOOEY_CLASS.still, GOOEY_CLASS.blobHold));
  }
  void skin.offsetWidth;

  const release = () => {
    if (isCancelled) return;
    items.forEach((item) => {
      item.classList.remove(GOOEY_CLASS.still);
      item.classList.toggle(GOOEY_CLASS.up, direction === 'in');
    });
    blobs.forEach((blob) => {
      blob.classList.remove(GOOEY_CLASS.still);
      if (blob === sourceBlob) return;   // the source stays put; it is not travelling
      blob.classList.toggle(GOOEY_CLASS.up, direction === 'in');
    });
  };

  window.requestAnimationFrame(() => {
    if (isCancelled) return;
    window.requestAnimationFrame(release);
  });

  if (direction === 'out') {
    timers.push(window.setTimeout(() => {
      if (isCancelled) return;
      // Clear the blobs and hand the trigger back, but leave the items exactly where the
      // retreat left them. Stripping their classes here would restore their chrome AND
      // their labels, and the caller unmounts them only a beat later — the whole rail
      // flashed back into view, fully formed, at the very end of its own exit. Whoever
      // owns these nodes tears them down; if they are reused, the next run resets them.
      blobs.forEach((blob) => blob.remove());
      blobs.length = 0;
      clip?.classList.remove(GOOEY_CLASS.clipOpen);
      onSettled?.();
    }, maxDelay + durationMs + LANDING_GRACE_MS));

    return cancel;
  }

  // Each item stays liquid until the NEXT one has finished pulling out of it — landing
  // them all at once left a crisp border with a neck still growing out from behind it.
  order.forEach((index, position) => {
    const next = order[position + 1];
    const reference = chain && next !== undefined ? delays[next] : delays[index];
    timers.push(window.setTimeout(
      () => settleItem(items[index], blobs[index]),
      reference + durationMs + LANDING_GRACE_MS,
    ));
  });

  if (sourceBlob) {
    const firstDelay = delays[order[0]];
    timers.push(window.setTimeout(
      () => settleItem(fromEl, sourceBlob),
      firstDelay + durationMs + LANDING_GRACE_MS,
    ));
  }

  timers.push(window.setTimeout(() => {
    if (isCancelled) return;
    blobs.forEach((blob) => blob.remove());
    blobs.length = 0;
    clip?.classList.remove(GOOEY_CLASS.clipOpen);
    onSettled?.();
  }, maxDelay + durationMs + LANDING_GRACE_MS + BLOB_MELT_MS));

  return cancel;
};

/** Mode tabs + model chip: a deliberate diagonal chain from the bottom-left opener. */
export const TAB_REVEAL = { durationMs: 600, staggerMs: 80 } as const;
/**
 * The tabs coming BACK after a rail closes — they unfold one out of the next. Slower
 * than the rails: this cascade only starts once the outgoing rail has finished its exit,
 * so it follows a pause. Played at rail speed it read as a pop rather than a melt.
 */
export const TAB_CHAIN = { durationMs: 520, staggerMs: 170 } as const;
/** Agent actions: only 3–4 buttons, so the chain can afford to be deliberate. */
export const AGENT_CHAIN = { durationMs: 440, staggerMs: 190 } as const;
/**
 * Model chips: the duplicate skin still chains right-to-left, but the real controls do
 * not move. Keep the cascade compact so a twelve-model provider completes in < 0.9 s.
 */
export const MODEL_CHAIN = { durationMs: 280, staggerMs: 42 } as const;

interface ChainTiming { durationMs: number; staggerMs: number }

/** Runs the same clock backwards: whatever arrived last is the first to leave. */
export const reverseDelays = (delays: number[]): number[] => {
  const last = delays.reduce((largest, delay) => Math.max(largest, delay), 0);
  return delays.map((delay) => last - delay);
};

/**
 * How long a chain takes end to end. Callers that unmount the chips afterwards have to
 * wait at least this long, or the exit is cut off midway.
 */
export const chainDurationMs = (count: number, timing: ChainTiming): number =>
  Math.max(count - 1, 0) * timing.staggerMs + timing.durationMs + 60;
