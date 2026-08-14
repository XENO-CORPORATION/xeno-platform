import type { CSSProperties, SVGProps } from 'react';
import type { ElementDeclaration, ElementState } from '@xenosystem/elements/schema';
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
import GEyeOff from '@xenosystem/elements/elements/eye-off';
import GMicOff from '@xenosystem/elements/elements/mic-off';
import GTimerOff from '@xenosystem/elements/elements/timer-off';
import GFileX from '@xenosystem/elements/elements/file-x';
import GFileOut from '@xenosystem/elements/elements/file-out';
import GMessagePlus from '@xenosystem/elements/elements/message-plus';
import GMessageX from '@xenosystem/elements/elements/message-x';
import GFolderUp from '@xenosystem/elements/elements/folder-up';
import GSave from '@xenosystem/elements/elements/save';
import GQuote from '@xenosystem/elements/elements/quote';
import GMonitor from '@xenosystem/elements/elements/monitor';
import GAppWindow from '@xenosystem/elements/elements/app-window';
import GZap from '@xenosystem/elements/elements/zap';
import GWrapText from '@xenosystem/elements/elements/wrap-text';
import GTrendingUp from '@xenosystem/elements/elements/trending-up';
import GArrowLeftRight from '@xenosystem/elements/elements/arrow-left-right';
import GArrowUpRight from '@xenosystem/elements/elements/arrow-up-right';
import GCheckSquare from '@xenosystem/elements/elements/check-square';
import GThumbsUp from '@xenosystem/elements/elements/thumbs-up';
import GThumbsDown from '@xenosystem/elements/elements/thumbs-down';
import GLibrary from '@xenosystem/elements/elements/library';
import GStore from '@xenosystem/elements/elements/store';
import GNavigation from '@xenosystem/elements/elements/navigation';
import GLightbulb from '@xenosystem/elements/elements/lightbulb';
import GScanEye from '@xenosystem/elements/elements/scan-eye';
import GShapes from '@xenosystem/elements/elements/shapes';
import GWaves from '@xenosystem/elements/elements/waves';
import GFeather from '@xenosystem/elements/elements/feather';
import GHand from '@xenosystem/elements/elements/hand';
import GFileClock from '@xenosystem/elements/elements/file-clock';
import GBuilding from '@xenosystem/elements/elements/building';
import GNextDismiss from '@xenosystem/elements/elements/next-dismiss';
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
/* `Lock` was reachable from lucide through the wildcard re-export, so nothing failed and nothing looked
   obviously wrong — it just came back at stroke-width 2 next to a set drawn at 1.75. The wildcard is what
   makes the facade painless to adopt and it is also what lets a name slip through unshadowed; the only
   way to catch it is to look at what the page actually rendered. */
export const Lock = /* @__PURE__ */ glyph(GLock);
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

/* Compounds: an object this library already draws, plus a mark.

   Both halves are copied from the existing glyph rather than redrawn — the eye in `eye-off` is `eye`'s
   own coordinates. An "off" glyph is the "on" one plus a denial, and if the object underneath shifted
   even half a unit the pair would flicker every time a control toggled between them.

   `FileClock` is NOT here, and it was meant to be. A clock face small enough to sit inside a file, in
   this grammar, comes out around 7 units across — and at 7 units the corner radius and the stroke
   weight compete for the same pixels, so the face renders as a blob rather than a clock. It stays on
   lucide until it can be drawn at a size the set can carry. */
export const EyeOff = /* @__PURE__ */ glyph(GEyeOff);
export const MicOff = /* @__PURE__ */ glyph(GMicOff);
export const TimerOff = /* @__PURE__ */ glyph(GTimerOff);
export const FileX = /* @__PURE__ */ glyph(GFileX);
export const FileOutput = /* @__PURE__ */ glyph(GFileOut);
export const MessageSquarePlus = /* @__PURE__ */ glyph(GMessagePlus);
export const MessageSquareX = /* @__PURE__ */ glyph(GMessageX);
export const FolderUp = /* @__PURE__ */ glyph(GFolderUp);

/* Standalone objects — the ones that compose from nothing already here and simply had to be drawn.

   `CheckCircle` becomes a check in the shared rounded-square frame, the same translation `StopCircle`
   took. That was a decision, not a shortcut: the grammar has no circles, and the ring never carried
   meaning the frame does not. What the frame does carry is a relationship — it is the same square as
   `Contrast` and the squared stop, so the three read as one family of enclosed marks. */
export const Save = /* @__PURE__ */ glyph(GSave);
export const Quote = /* @__PURE__ */ glyph(GQuote);
export const Monitor = /* @__PURE__ */ glyph(GMonitor);
export const AppWindow = /* @__PURE__ */ glyph(GAppWindow);
export const Zap = /* @__PURE__ */ glyph(GZap);
export const WrapText = /* @__PURE__ */ glyph(GWrapText);
export const TrendingUp = /* @__PURE__ */ glyph(GTrendingUp);
export const ArrowLeftRight = /* @__PURE__ */ glyph(GArrowLeftRight);
export const ArrowUpRight = /* @__PURE__ */ glyph(GArrowUpRight);
export const CheckCircle = /* @__PURE__ */ glyph(GCheckSquare);
export const ThumbsUp = /* @__PURE__ */ glyph(GThumbsUp);
export const ThumbsDown = /* @__PURE__ */ glyph(GThumbsDown);

/* The last of the drawable ones.

   FileClock comes back. It was left on lucide because a clock face small enough to sit inside a file
   rendered as a blob at 7 units — the fix was not to give up on it but to stop trying to tuck it into
   the text area: at 9 units it reads, and it fits because the mark REPLACES the contents rather than
   squeezing between them, which was the family rule all along.

   ScanEye is composed rather than drawn: Maximize's four corner brackets with Eye's lens between them,
   both at their own coordinates. The brackets already mean "a frame placed over something" and the lens
   already means "looking", so the compound says what it says without inventing a shape. */
export const Library = /* @__PURE__ */ glyph(GLibrary);
export const Store = /* @__PURE__ */ glyph(GStore);
export const Navigation = /* @__PURE__ */ glyph(GNavigation);
export const Lightbulb = /* @__PURE__ */ glyph(GLightbulb);
export const ScanEye = /* @__PURE__ */ glyph(GScanEye);
export const Shapes = /* @__PURE__ */ glyph(GShapes);
export const Waves = /* @__PURE__ */ glyph(GWaves);
export const Feather = /* @__PURE__ */ glyph(GFeather);
export const Hand = /* @__PURE__ */ glyph(GHand);
export const FileClock = /* @__PURE__ */ glyph(GFileClock);

/* Drawn for the share dialog, which had been hand-writing an animated building of its own. */
export const Building = /* @__PURE__ */ glyph(GBuilding);

/* The one glyph here that takes a STATE rather than just a size.
 *
 * `glyph()` cannot carry it: the factory exists so a call site never has to know a name is XENO-backed,
 * and a state prop is precisely the thing only a XENO-backed name can accept. So this is written out —
 * the exception proves the factory is doing its job everywhere else.
 *
 * `selection: 'on'` is the last card, where Next becomes Dismiss. The arrow morphs into the cross;
 * see the declaration for why the two are drawn from the same three strokes. */
export const NextDismiss = ({
  size = 24,
  state,
  ...rest
}: IconProps & { readonly state?: Partial<ElementState> }) => (
  <XenoElement
    decl={GNextDismiss}
    size={typeof size === 'string' ? Number.parseFloat(size) : size}
    {...(state ? { state } : {})}
    {...rest}
  />
);
