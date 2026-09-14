/**
 * Project a completion's citation annotations into the client's `searchInfo` shape.
 *
 * ## What this is
 *
 * When a provider grounds an answer in web results it returns `url_citation` annotations —
 * a URL, a title, and the character span of the answer each one supports. The chat client
 * renders those as numbered citations under the text, with the spans driving which sentence
 * links to which source.
 *
 * 🔴 EXTRACTED (2026-09-14) so `/api/ai/chat/stream` can produce this too. It lived only in
 * `/api/chat/generate`, which is one of the reasons that route could not serve a chat turn:
 * an answer would arrive with its citations stripped, looking like unsourced assertion.
 *
 * ## Two details that matter
 *
 * - **Sources are DEDUPED by URL, and the spans index into that deduped list.** A provider
 *   commonly cites the same page for several sentences; listing it three times would render
 *   as three separate sources that happen to be identical. The `urlMap` keeps the first
 *   index and every later span points at it.
 * - **A citation with no span still counts as a source.** It contributes to the list but
 *   adds no `support`, because there is nothing to underline — dropping it would lose a
 *   source the model actually used.
 *
 * ⚠️ `queries` is always `[]`. The provider reports which pages were cited, never what was
 * typed into the search box, so there is nothing truthful to put there. The field exists
 * because the client's type expects it; XENO's own tool loop supplies real queries by a
 * different path (`toolUse`), and conflating the two would invent search terms.
 */

/**
 * @param {object} data  the upstream `{ choices: [{ message }] }` response
 * @returns {{queries: string[], sources: Array<{uri: string, title: string}>,
 *            supports: Array<{startIndex: number, endIndex: number, sourceIndices: number[]}>}
 *          | null} null when the completion carried no citations — the caller then leaves
 *          `searchInfo` off the response entirely rather than sending an empty shell.
 */
export function searchInfoFromAnnotations(data) {
  const annotations = data?.choices?.[0]?.message?.annotations;
  if (!Array.isArray(annotations)) return null;

  const sources = [];
  const supports = [];
  const urlMap = new Map(); // url -> index in `sources`, so spans can point at one entry

  for (const annotation of annotations) {
    if (annotation?.type !== 'url_citation' || !annotation.url_citation) continue;
    const { url, title, start_index: startIndex, end_index: endIndex } = annotation.url_citation;
    if (!url) continue;

    let sourceIndex;
    if (urlMap.has(url)) {
      sourceIndex = urlMap.get(url);
    } else {
      sourceIndex = sources.length;
      // Title falls back to the URL: a citation chip with no label is unreadable.
      sources.push({ uri: url, title: title || url });
      urlMap.set(url, sourceIndex);
    }

    if (startIndex !== undefined && endIndex !== undefined) {
      supports.push({ startIndex, endIndex, sourceIndices: [sourceIndex] });
    }
  }

  if (sources.length === 0) return null;
  return { queries: [], sources, supports };
}
