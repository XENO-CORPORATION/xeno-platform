// Types of the XENO tool contract, copied from xeno-tools packages/tool-kit/src/host.ts + types.ts (@xeno-tools/kit
// is private and unpublished). Types only; the page's runtime half is webHost.ts. Re-copy when the kit changes.
/**
 * ToolHost — the bridge a tool uses to reach the outside world.
 * In Hub it is backed by window.xenoAPI / IPC (xeno-rt, xeno-lib, Electron).
 * Standalone it is backed by createMockHost(). See SPEC.md §4.
 *
 * NOTE: the payload shapes below are intentionally minimal placeholders for the
 * v0.0.1 scaffold. They get firmed up against real window.xenoAPI signatures when
 * the first tool is migrated out of Hub (see docs/MIGRATION.md).
 */

export interface OpenDialogOptions {
  title?: string
  multiple?: boolean
  /** e.g. [{ name: 'Images', extensions: ['png', 'jpg'] }] */
  filters?: { name: string; extensions: string[] }[]
}

export interface SaveDialogOptions {
  title?: string
  defaultPath?: string
  filters?: { name: string; extensions: string[] }[]
}

/** A text span in a multimodal message. */
export interface TextPart {
  type: 'text'
  text: string
}
/** An image the model should look at (vision). `image` is a `data:image/…;base64,…` URL. */
export interface ImagePart {
  type: 'image'
  image: string
}
export type ContentPart = TextPart | ImagePart

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  /**
   * Plain text, or an ordered array of parts for multimodal (vision) prompts. A string
   * is equivalent to a single text part — existing text-only callers are unaffected.
   * The host adapter is responsible for mapping image parts to the provider's format.
   */
  content: string | ContentPart[]
}
export interface ChatRequest {
  model?: string
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
}
export interface ChatResponse {
  content: string
}
export interface ChatChunk {
  delta: string
}

/** A job for `host.agent.run`. `input` is the runner's own options, as plain JSON. */
export interface AgentJob {
  runner: string
  input: Record<string, unknown>
  /** Progress as it happens — a plain-JSON event per step. */
  onEvent?: (event: Record<string, unknown>) => void
  signal?: AbortSignal
}

/** The runner's result, as plain JSON (for motion-2d: its AuthorResult). */
export type AgentJobResult = Record<string, unknown>

/** Generic ONNX/task-model I/O via xeno-rt. Refined per-model at migration time. */
export interface InferenceInput {
  [key: string]: unknown
}
export interface InferenceOutput {
  [key: string]: unknown
}

/**
 * AI image generation via the XENO image API (gpt-image-2).
 * In Hub this maps to window.xenoAPI.imageProjects.generateImage; standalone it
 * returns a placeholder. `referenceImages` are data URLs the model conditions on
 * (e.g. a font sample to match its style).
 */
export interface ImageGenRequest {
  prompt: string
  /** '1024x1024' | '1792x1024' | '1024x1792' | '1536x1024' | '1024x1536'. Default 1024x1024. */
  size?: string
  quality?: 'low' | 'medium' | 'high' | 'auto'
  /** Number of images. Default 1. */
  n?: number
  /** Reference images as data URLs the model should condition on. */
  referenceImages?: string[]
  /** Defaults to 'gpt-image-2'. */
  model?: string
  /**
   * gpt-image-2 edit fidelity when `referenceImages` are present. 'high' makes the model
   * preserve the reference faithfully — required when the reference is a guide template the
   * glyph must align to (and whose guide lines must survive for deterministic extraction).
   */
  inputFidelity?: 'low' | 'high'
}
export interface ImageGenResult {
  /** Generated images as `data:image/png;base64,…` (or other data) URLs. */
  images: string[]
}

/**
 * A TRUE image edit (`POST /v1/images/edits`, multipart) — structurally different from
 * `generate` with `referenceImages` (`/v1/images/generations`), where the reference is only
 * *conditioning* and the model is free to synthesise a new picture.
 *
 * Use `edit` whenever the source image IS the canvas and its pixels must survive: UI-asset
 * isolation/cutout, retouching, chroma-plating, inpainting. This is the difference between
 * "make me something like this" and "modify THIS" — the single biggest factor in whether an
 * extracted asset actually corresponds to the reference.
 */
export interface ImageEditRequest {
  prompt: string
  /**
   * Images to edit, as data URLs. `images[0]` is the primary edit target (the canvas);
   * any others are supplementary references. At least one is required.
   */
  images: string[]
  /**
   * Optional mask as a data URL. Transparent (alpha 0) pixels mark the region the model may
   * change; opaque pixels are preserved. Omit to let the model decide from the prompt.
   */
  mask?: string
  /** Output size. Defaults to the API default; prefer matching the source aspect. */
  size?: string
  quality?: 'low' | 'medium' | 'high' | 'auto'
  /** Number of images. Default 1. */
  n?: number
  /** Defaults to 'gpt-image-2'. */
  model?: string
  /** 'high' preserves the source faithfully — the default for extraction work. */
  inputFidelity?: 'low' | 'high'
}

/**
 * Font construction via xeno-lib (Rust). Two native operations behind the bridge:
 *  - `trace`: a black-on-white glyph bitmap → vector contours (potrace).
 *  - `compile`: normalized per-glyph outlines + metrics + kerning → a real font binary.
 * The metric NORMALIZE / spacing / kerning math lives tool-side (TS); only tracing and
 * the OTF/TTF/WOFF2 writer are native. In Hub these map to xeno-lib N-API; standalone
 * the mock returns dev stubs (NOT real fonts). See tools/font-generator/FONT_PIPELINE.md.
 */
export interface Point {
  x: number
  y: number
}
/** A closed contour. `points` are on-curve corners; quadratic/cubic control points are
 *  carried in the optional `controls` parallel array (null = line-to). v1 traces emit
 *  polygons (all line-to); the type already admits curves for higher-fidelity backends. */
export interface Contour {
  points: Point[]
  /** Optional per-segment control point(s); same length as points, null for line segments. */
  controls?: (Point[] | null)[]
}

export interface TraceRequest {
  /** PNG/data-url of a single glyph cell, black ink on white. */
  image: string
  /** 0..1 luminance threshold for binarization; omit for auto (Otsu). */
  threshold?: number
  /** Drop connected specks smaller than this pixel area. */
  despeckle?: number
}
export interface TraceResult {
  /** Source bitmap size, pixel space (origin top-left, y-down). */
  width: number
  height: number
  /** Traced contours in pixel space (y-down). Outer + hole contours; winding set by tracer. */
  contours: Contour[]
}

/** One finished glyph in font units (UPM space, y-up, baseline = 0). */
export interface GlyphOutline {
  /** Unicode codepoint. */
  unicode: number
  /** Glyph name (AGLFN-ish, e.g. 'A', 'zero', 'space'). */
  name: string
  /** Closed contours in font units. Empty for spacing glyphs (e.g. space). */
  contours: Contour[]
  /** Advance width in font units. */
  advanceWidth: number
}
/** A kerning adjustment between two codepoints, in font units (usually negative). */
export interface KernPair {
  left: number
  right: number
  value: number
}
export interface FontCompileRequest {
  familyName: string
  styleName?: string
  unitsPerEm: number
  ascender: number
  descender: number
  capHeight: number
  xHeight: number
  glyphs: GlyphOutline[]
  kerning?: KernPair[]
  /** Output formats to emit. */
  formats: Array<'otf' | 'ttf' | 'woff2'>
}
export interface FontFile {
  format: 'otf' | 'ttf' | 'woff2'
  fileName: string
  /** Font bytes, base64. */
  bytesBase64: string
}
export interface FontCompileResult {
  files: FontFile[]
}

/** Media processing op via xeno-lib (N-API). Refined at migration time. */
export interface ConvertOp {
  kind: string // e.g. 'image.resize' | 'image.compress' | 'pdf.merge'
  input: unknown
  options?: Record<string, unknown>
}
export interface ConvertResult {
  output: unknown
}

export interface CaptureOptions {
  windowId?: string
  region?: { x: number; y: number; width: number; height: number }
}

export type NotifyLevel = 'info' | 'warn' | 'error'

export interface ToolHost {
  /** 'hub' in production, 'standalone' during isolated dev. */
  readonly mode: 'hub' | 'standalone'
  /** Mode flags so tools can adapt their UI. */
  readonly env: { online: boolean; credits: boolean; nativeConvert: boolean; imagegen: boolean }

  fs: {
    openDialog(opts?: OpenDialogOptions): Promise<string[]>
    saveDialog(opts?: SaveDialogOptions): Promise<string | null>
    readFile(path: string): Promise<Uint8Array>
    writeFile(path: string, data: Uint8Array): Promise<void>
  }
  llm: {
    chat(req: ChatRequest): Promise<ChatResponse>
    stream(req: ChatRequest): AsyncIterable<ChatChunk>
  }
  inference: {
    run(model: string, input: InferenceInput): Promise<InferenceOutput>
  }
  imagegen: {
    generate(req: ImageGenRequest): Promise<ImageGenResult>
    /**
     * TRUE edit of `images[0]` (multipart `/v1/images/edits`). Prefer this over `generate`
     * whenever the source pixels must be preserved — see ImageEditRequest.
     */
    edit(req: ImageEditRequest): Promise<ImageGenResult>
  }
  font: {
    trace(req: TraceRequest): Promise<TraceResult>
    compile(req: FontCompileRequest): Promise<FontCompileResult>
  }
  convert: {
    run(op: ConvertOp): Promise<ConvertResult>
  }
  capture: {
    screen(opts?: CaptureOptions): Promise<Uint8Array>
  }
  clipboard: {
    readText(): Promise<string>
    writeText(text: string): Promise<void>
  }
  /**
   * Small durable key/value store, PRIVATE TO THIS TOOL.
   *
   * 🔴 Added because a tool had no way to keep anything at all. Work that took twenty
   * minutes to produce died on reload, which the workbench rules already forbid — "no
   * user-facing state that dies on reload unless it is genuinely ephemeral". `fs` cannot
   * serve this: it is consent-gated to paths the USER picked in a dialog, which is right for
   * saving a deliverable and useless for a tool remembering its own past work.
   *
   * ⚠️ NAMESPACED BY TOOL ID BY THE HOST, never by the caller. Every tool in Hub shares one
   * renderer origin, so a raw key is a collision between two tools that have never heard of
   * each other — and the failure is silent data loss in whichever wrote second.
   *
   * Values are strings; a tool serialises its own shape. Async because the host may back
   * this with a file or IPC rather than synchronous browser storage.
   *
   * NOT a database and not for large blobs — expect a few MB total. A rendered video belongs
   * on disk through `fs`, where the user chose to put it.
   */
  storage: {
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<void>
    remove(key: string): Promise<void>
    /** Keys this tool has written, in no guaranteed order. */
    keys(): Promise<string[]>
  }
  credits: {
    balance(): Promise<number>
    charge(amount: number, reason: string): Promise<void>
  }
  /**
   * An AGENT RUNTIME — optional. A host that can run a real agent (one with its own tools,
   * working in files, running commands) exposes it here; a host that cannot omits it and the
   * tool falls back to `llm.chat`.
   *
   * 🔴 WHY THIS EXISTS. `llm.chat` gives a tool a model that can only reply with text, so a tool
   * needing an agent has to simulate one — its own tool protocol, parsed from replies. Measured on
   * motion-2d (2026-09-25): the same brief, the same skill and the same gates produced markedly
   * better pieces when a real agent wrote files and ran the checker itself. The difference was the
   * runtime, not the model.
   *
   * ⚠️ ONE GENERIC PRIMITIVE, per decision D8 — never a method per tool. The job names a
   * `runner` the host recognises (e.g. 'motion-2d'); what that runner does is the tool's own
   * headless engine, which the host only launches. Gated by the `agent` capability.
   */
  agent?: {
    run(job: AgentJob): Promise<AgentJobResult>
  }
  notify(level: NotifyLevel, message: string): void
  telemetry(event: string, props?: Record<string, unknown>): void
}

/**
 * Deterministic stub host for standalone development and unit tests.
 * Logs calls and returns benign fixtures — never touches the real system.
 * Override any slice via `overrides` when a tool needs specific behavior in a test.
 */

import type { ComponentType } from 'react'
export interface ToolProps { host: ToolHost; onClose: () => void; initialInput?: { files?: string[]; payload?: Record<string, unknown> } }
export interface ToolModule { manifest: { id: string; name: string; version: string }; Component: ComponentType<ToolProps> }
