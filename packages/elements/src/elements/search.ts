import type { ElementDeclaration } from '../schema'

/**
 * `xeno.search` — Search. A degenerate element (pure geometry, no children).
 * Imported from the foundry workbench; the declaration is the source of truth — edit here.
 */
export const Search: ElementDeclaration = {
  id: 'xeno.search',
  kind: 'icon',
  contract: { viewBox: '0 0 24 24', weight: 'regular', strokeFamily: 'xeno-regular', axes: [], signals: [] },
  geometry: {
    base: [
      { kind: 'path', d: 'M6.123 2.001H12.306C13.399 2.001 14.448 2.435 15.221 3.208 15.994 3.982 16.428 5.03 16.428 6.123V12.306C16.429 12.618 16.395 12.93 16.325 13.234 16.147 13.756 16.202 14.161 16.49 14.45L21.571 19.53C21.841 19.801 21.993 20.168 21.993 20.551 21.993 20.933 21.841 21.3 21.571 21.571 21.3 21.841 20.933 21.993 20.55 21.993 20.168 21.993 19.801 21.841 19.53 21.571L14.45 16.49C14.161 16.202 13.756 16.147 13.234 16.325 12.929 16.395 12.618 16.429 12.306 16.429H6.123C5.03 16.429 3.981 15.994 3.208 15.221 2.435 14.448 2.001 13.4 2.001 12.306V6.123C2.001 5.03 2.435 3.982 3.208 3.208 3.981 2.435 5.03 2.001 6.123 2.001ZM6.123 4.887H12.306C12.634 4.887 12.949 5.017 13.181 5.249 13.413 5.481 13.543 5.795 13.543 6.123V12.306C13.543 12.634 13.413 12.949 13.181 13.181 12.949 13.413 12.634 13.543 12.306 13.543H6.123C5.795 13.543 5.48 13.413 5.249 13.181 5.017 12.949 4.886 12.634 4.886 12.306V6.123C4.886 5.795 5.017 5.481 5.249 5.249 5.48 5.017 5.795 4.887 6.123 4.887Z', fill: 'foreground', fillRule: 'evenodd' },
    ],
  },
  bindings: [],
  a11y: { role: 'img', label: 'Search' },
  meta: { tags: ['find', 'magnifier', 'lens'], since: '0.1.0' },
}

export default Search
