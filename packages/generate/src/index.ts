/**
 * `@xenosystem/generate` — the pipeline that turns declarations into per-platform artifacts.
 *
 * It is the ONLY writer of generated output (SPEC §6, README): renderers are generated, never
 * hand-authored, so this package owns the geometry→markup interpretation and the pack manifest.
 * Framework-free and platform-free; a native target adds its own emitter alongside `renderSvg`.
 *
 * @module
 */
export {
  interpret,
  type Scene,
  type SceneOptions,
  type ShapeNode,
  type RectNode,
  type PathNode,
} from './scene.js'
export { renderSvg, sceneToSvg, type RenderOptions } from './svg.js'
export { buildManifest, toEntry, type Manifest, type ManifestEntry } from './manifest.js'
