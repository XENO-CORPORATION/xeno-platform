import type { CSSProperties, SVGProps } from 'react';
import type { ElementDeclaration } from '@xenosystem/elements/schema';
import { XenoElement } from '@xenosystem/elements-react';

import GAlert from '@xenosystem/elements/elements/alert';
import GArchive from '@xenosystem/elements/elements/archive';
import GUserX from '@xenosystem/elements/elements/user-x';
import GArrowRight from '@xenosystem/elements/elements/arrow-right';
import GArrowUp from '@xenosystem/elements/elements/arrow-up';
import GAttach from '@xenosystem/elements/elements/attach';
import GBookmark from '@xenosystem/elements/elements/bookmark';
import GBriefcase from '@xenosystem/elements/elements/briefcase';
import GContrast from '@xenosystem/elements/elements/contrast';
import GPlay from '@xenosystem/elements/elements/play';
import GPause from '@xenosystem/elements/elements/pause';
import GStop from '@xenosystem/elements/elements/stop';
import GPanelLeft from '@xenosystem/elements/elements/panel-left';
import GPanelLeftClose from '@xenosystem/elements/elements/panel-left-close';
import GPanelRight from '@xenosystem/elements/elements/panel-right';
import GPanelRightClose from '@xenosystem/elements/elements/panel-right-close';
import GMaximize from '@xenosystem/elements/elements/maximize';
import GMinimize from '@xenosystem/elements/elements/minimize';
import GCalendar from '@xenosystem/elements/elements/calendar';
import GCheck from '@xenosystem/elements/elements/check';
import GChevronDown from '@xenosystem/elements/elements/chevron-down';
import GChevronRight from '@xenosystem/elements/elements/chevron-right';
import GClock from '@xenosystem/elements/elements/clock';
import GCode from '@xenosystem/elements/elements/code';
import GCopy from '@xenosystem/elements/elements/copy';
import GDownload from '@xenosystem/elements/elements/download';
import GEdit from '@xenosystem/elements/elements/edit';
import GEye from '@xenosystem/elements/elements/eye';
import GFile from '@xenosystem/elements/elements/file';
import GFolder from '@xenosystem/elements/elements/folder';
import GGear from '@xenosystem/elements/elements/gear';
import GGlobe from '@xenosystem/elements/elements/globe';
import GGrid from '@xenosystem/elements/elements/grid';
import GImage from '@xenosystem/elements/elements/image';
import GInfo from '@xenosystem/elements/elements/info';
import GLayers from '@xenosystem/elements/elements/layers';
import GLink from '@xenosystem/elements/elements/link';
import GList from '@xenosystem/elements/elements/list';
import GLock from '@xenosystem/elements/elements/lock';
import GMessage from '@xenosystem/elements/elements/message';
import GMic from '@xenosystem/elements/elements/mic';
import GMore from '@xenosystem/elements/elements/more';
import GPlus from '@xenosystem/elements/elements/plus';
import GRefresh from '@xenosystem/elements/elements/refresh';
import GSearch from '@xenosystem/elements/elements/search';
import GSend from '@xenosystem/elements/elements/send';
import GShare from '@xenosystem/elements/elements/share';
import GStar from '@xenosystem/elements/elements/star';
import GTrash from '@xenosystem/elements/elements/trash';
import GX from '@xenosystem/elements/elements/x';

/**
 * The icon facade.
 *
 * Import icons from here instead of from `lucide-react`, and the ones XENO draws are XENO's while
 * everything else stays exactly as it was. Call sites do not change at all — only the import path —
 * because these take the same props lucide's do, and every usage in the chat passes `size={n}`.
 *
 * `export *` below re-exports the whole of lucide; the named exports after it shadow the ~50 that
 * XENO covers. That ordering is the point: an icon nobody has mapped keeps working untouched, and a
 * glyph added to the library later becomes a one-line change here rather than an edit in 33 files.
 *
 * ## What is NOT mapped, and why
 *
 * An alias has to say the SAME THING, not merely look similar. `EyeOff` drawn as `eye` tells the user
 * visibility is on. So anything whose modifier carries the meaning — off, plus, X, up — stays on
 * lucide: Save, Calendar, Bot, Compass, Square, Lightbulb, FileX, Monitor and the rest. Coverage is
 * 67% of the import sites in the chat, and the remaining third is deliberate.
 */

/** Lucide's own prop shape, so a call site cannot tell the difference. */
export type IconProps = Omit<SVGProps<SVGSVGElement>, 'ref'> & {
  readonly size?: number | string;
};

const FLIP: Record<string, CSSProperties> = {
  x: { scale: '-1 1' } as CSSProperties,
  y: { scale: '1 -1' } as CSSProperties,
};

/**
 * Wrap a declaration as a lucide-shaped component.
 *
 * The flip uses the standalone `scale` property, never `transform`. An icon's hover animation owns
 * `transform`, and an animation beats an inline style — so a transform-based mirror would snap back
 * the moment the glyph animated. `scale` composes with it instead.
 */
const glyph =
  (decl: ElementDeclaration, flip?: 'x' | 'y') =>
  ({ size = 24, style, ...rest }: IconProps) => (
    <XenoElement
      decl={decl}
      size={typeof size === 'string' ? Number.parseFloat(size) : size}
      style={flip ? { ...FLIP[flip], ...style } : style}
      {...rest}
    />
  );

export * from 'lucide-react';

/* Same name on both sides. */
export const Check = /* @__PURE__ */ glyph(GCheck);
export const Search = /* @__PURE__ */ glyph(GSearch);
export const X = /* @__PURE__ */ glyph(GX);
export const ChevronDown = /* @__PURE__ */ glyph(GChevronDown);
export const Copy = /* @__PURE__ */ glyph(GCopy);
export const ChevronRight = /* @__PURE__ */ glyph(GChevronRight);
export const Clock = /* @__PURE__ */ glyph(GClock);
export const Plus = /* @__PURE__ */ glyph(GPlus);
export const Globe = /* @__PURE__ */ glyph(GGlobe);
export const File = /* @__PURE__ */ glyph(GFile);
export const Download = /* @__PURE__ */ glyph(GDownload);
export const ArrowUp = /* @__PURE__ */ glyph(GArrowUp);
export const Send = /* @__PURE__ */ glyph(GSend);
export const Link = /* @__PURE__ */ glyph(GLink);
export const Mic = /* @__PURE__ */ glyph(GMic);
export const Eye = /* @__PURE__ */ glyph(GEye);
export const Layers = /* @__PURE__ */ glyph(GLayers);
export const Folder = /* @__PURE__ */ glyph(GFolder);
export const Info = /* @__PURE__ */ glyph(GInfo);
export const Image = /* @__PURE__ */ glyph(GImage);
export const Star = /* @__PURE__ */ glyph(GStar);
export const Trash = /* @__PURE__ */ glyph(GTrash);

/* Different name, same meaning. */
export const Trash2 = /* @__PURE__ */ glyph(GTrash);
export const FileText = /* @__PURE__ */ glyph(GFile);
export const MessageSquare = /* @__PURE__ */ glyph(GMessage);
export const Settings = /* @__PURE__ */ glyph(GGear);
export const Loader2 = /* @__PURE__ */ glyph(GRefresh);
export const ExternalLink = /* @__PURE__ */ glyph(GLink);
export const Paperclip = /* @__PURE__ */ glyph(GAttach);
export const SquarePen = /* @__PURE__ */ glyph(GEdit);
export const FileImage = /* @__PURE__ */ glyph(GImage);
export const Pencil = /* @__PURE__ */ glyph(GEdit);
export const Code2 = /* @__PURE__ */ glyph(GCode);
export const LayoutGrid = /* @__PURE__ */ glyph(GGrid);
export const FilePenLine = /* @__PURE__ */ glyph(GEdit);
export const MessagesSquare = /* @__PURE__ */ glyph(GMessage);
export const RefreshCcw = /* @__PURE__ */ glyph(GRefresh);
export const Pin = /* @__PURE__ */ glyph(GBookmark);
export const Share2 = /* @__PURE__ */ glyph(GShare);
export const MoreVertical = /* @__PURE__ */ glyph(GMore);
export const MessageSquareText = /* @__PURE__ */ glyph(GMessage);
export const Loader = /* @__PURE__ */ glyph(GRefresh);
export const AlertTriangle = /* @__PURE__ */ glyph(GAlert);
export const KeyRound = /* @__PURE__ */ glyph(GLock);
export const Edit2 = /* @__PURE__ */ glyph(GEdit);
export const Rows = /* @__PURE__ */ glyph(GList);
export const Link2 = /* @__PURE__ */ glyph(GLink);

/* Same glyph, mirrored — the shape carries the meaning and the direction is a transform. Because
   the flip rides on `scale` rather than `transform`, a glyph that animates on hover still composes
   with it: the motion mirrors too, so a left arrow's nudge goes left. */
export const ArrowLeft = /* @__PURE__ */ glyph(GArrowRight, 'x');
export const ChevronLeft = /* @__PURE__ */ glyph(GChevronRight, 'x');
export const ChevronUp = /* @__PURE__ */ glyph(GChevronDown, 'y');

/* Drawn for this app. The chat asked for four marks the library did not have, and the honest answer
   to a missing icon is to draw it rather than to alias something that means almost the same thing —
   `Archive` as a folder, `UserRoundX` as a plain user. Each of these says only what it says. */
export const Archive = /* @__PURE__ */ glyph(GArchive);
export const Briefcase = /* @__PURE__ */ glyph(GBriefcase);
export const UserRoundX = /* @__PURE__ */ glyph(GUserX);
export const Contrast = /* @__PURE__ */ glyph(GContrast);

/* The transport controls, the panel pair, the resize pair, and a calendar.

   Drawn as SETS rather than one at a time, because each of these is one control in several states —
   play/pause/stop, open/close, bigger/smaller. Half a pair drawn in this system with its twin still
   coming from lucide is worse than neither: two icons that mean the opposite of each other, in two
   different hands, read as a mistake rather than a pair.

   `StopCircle` becomes a squared stop. The ring is not missing by accident — the grammar has no
   circles, and the ring never said anything the square does not. `Square` itself stays on lucide: the
   one call site paints it solid (`fill` + `strokeWidth={0}`), which is a filled shape, not this glyph. */
export const Play = /* @__PURE__ */ glyph(GPlay);
export const Pause = /* @__PURE__ */ glyph(GPause);
export const StopCircle = /* @__PURE__ */ glyph(GStop);
export const PanelLeftOpen = /* @__PURE__ */ glyph(GPanelLeft);
export const PanelLeftClose = /* @__PURE__ */ glyph(GPanelLeftClose);
export const PanelRightOpen = /* @__PURE__ */ glyph(GPanelRight);
export const PanelRightClose = /* @__PURE__ */ glyph(GPanelRightClose);
export const Maximize2 = /* @__PURE__ */ glyph(GMaximize);
export const Minimize2 = /* @__PURE__ */ glyph(GMinimize);
export const Calendar = /* @__PURE__ */ glyph(GCalendar);
