import type { ElementDeclaration } from '../schema'

/**
 * `xeno.folder-up` — Upload to folder. A degenerate element (pure geometry, no children).
 *
 * `folder`'s body with an arrow rising inside it. It carries only the body, not the document `folder`
 * keeps hidden above its mouth: that document is `folder`'s own motion, and a glyph that borrowed the
 * shape without the motion would be a folder with a stray sheet stuck to its lid.
 *
 * part[0] = folder body, part[1] = shaft, part[2] = head.
 */
export const FolderUp: ElementDeclaration = {
  id: 'xeno.folder-up',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M3 6.4A1.4 1.4 0 0 1 4.4 5h4l2 2.4h6A1.4 1.4 0 0 1 17.8 8.8V17a1.4 1.4 0 0 1-1.4 1.4H4.4A1.4 1.4 0 0 1 3 17z' },
      { kind: 'path', d: 'M10.4 16v-5' },
      { kind: 'path', d: 'M8 13.4 10.4 11l2.4 2.4' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Upload to folder' },
  meta: { tags: ['folder', 'upload', 'move'], since: '0.2.0' },
}

export default FolderUp
