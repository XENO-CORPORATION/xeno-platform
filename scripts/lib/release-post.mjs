/**
 * The release post a MAJOR XENO product release carries: what changed, shown with real footage from the app. Same shape as the
 * Bunkerverse game and Control Center posts (`post.json` plus exactly the files it names), so one format and one reader serve
 * every product page.
 *
 *   {
 *     "title": "...", "say": "one line why it matters", "art": "hero.jpg", "artCaption": "In the app, 0.2.0",
 *     "blocks": [
 *       {"p": "Plain text."}, {"h": "Section"},
 *       {"video": "clip.mp4", "poster": "clip.jpg", "caption": "In the app, 0.2.0"},
 *       {"img": "shot.jpg", "caption": "..."},
 *       {"list": [["New", "..."], ["Fixed", "..."], ["Changed", "..."]]},
 *       {"note": "What is still rough."},
 *       {"banner": "wide.jpg", "title": "...", "text": "...", "caption": "Key art"}
 *     ]
 *   }
 *
 * Checked BEFORE anything uploads (xeno-release.mjs phase A): a post that would show broken is refused whole.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

export const POST_FILE = 'post.json';
const IMAGE = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const VIDEO = new Set(['.mp4', '.webm']);
const TAGS = new Set(['New', 'Fixed', 'Changed']);
const MAX_FILE = 60 * 1024 * 1024, MAX_TOTAL = 250 * 1024 * 1024, MAX_TEXT = 4000;
const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export class PostError extends Error {}

/** @param {unknown} v */ const text = (v) => typeof v === 'string' && v.trim().length > 0 && v.length <= MAX_TEXT;

/**
 * Validate a post folder. Returns the parsed post and every file it names (post.json first). Throws PostError naming every problem.
 * @param {string} dir @returns {{post: any, files: {name: string, path: string, size: number, kind: 'json'|'image'|'video'}[]}}
 */
export function validateReleasePost(dir) {
  const problems = [];
  const path = join(dir, POST_FILE);
  if (!existsSync(path)) throw new PostError(`no ${POST_FILE} in ${dir}`);
  let post;
  try { post = JSON.parse(readFileSync(path, 'utf8')); } catch (e) { throw new PostError(`${POST_FILE} is not JSON: ${e.message}`); }
  if (!post || typeof post !== 'object' || Array.isArray(post)) throw new PostError(`${POST_FILE} must be an object`);

  /** @type {Map<string, 'image'|'video'>} */ const named = new Map();
  const want = (/** @type {unknown} */ name, /** @type {'image'|'video'} */ kind, /** @type {string} */ where) => {
    if (typeof name !== 'string' || !NAME.test(name)) { problems.push(`${where}: "${name}" is not a plain file name`); return; }
    const ext = extname(name).toLowerCase();
    if (!(kind === 'image' ? IMAGE : VIDEO).has(ext)) { problems.push(`${where}: ${name} is not ${kind === 'image' ? 'an image (jpg, png, webp)' : 'a video (mp4, webm)'}`); return; }
    named.set(name, kind);
  };

  if (!text(post.title)) problems.push('title is required (one line)');
  if (!text(post.say)) problems.push('say is required: one line that says why it matters');
  if (post.art !== undefined) want(post.art, 'image', 'art');
  if (!Array.isArray(post.blocks) || post.blocks.length === 0) problems.push('blocks must be a non-empty list');
  let media = post.art !== undefined ? 1 : 0, videos = 0;
  for (const [i, b] of (Array.isArray(post.blocks) ? post.blocks : []).entries()) {
    const at = `blocks[${i}]`;
    if (!b || typeof b !== 'object' || Array.isArray(b)) { problems.push(`${at} must be an object`); continue; }
    const keys = Object.keys(b);
    if ('p' in b || 'h' in b || 'note' in b) {
      const k = 'p' in b ? 'p' : 'h' in b ? 'h' : 'note';
      if (!text(b[k])) problems.push(`${at}.${k} must be text`);
    } else if ('video' in b) {
      want(b.video, 'video', `${at}.video`); videos++; media++;
      if (b.poster === undefined) problems.push(`${at}: a video needs a poster image (shown before it plays)`); else want(b.poster, 'image', `${at}.poster`);
    } else if ('img' in b) { want(b.img, 'image', `${at}.img`); media++; }
    else if ('banner' in b) { want(b.banner, 'image', `${at}.banner`); media++; if (!text(b.title)) problems.push(`${at}.title is required for a banner`); }
    else if ('list' in b) {
      if (!Array.isArray(b.list) || !b.list.length) problems.push(`${at}.list must be a non-empty list`);
      else for (const [j, row] of b.list.entries()) {
        if (!Array.isArray(row) || row.length !== 2 || !TAGS.has(row[0]) || !text(row[1])) problems.push(`${at}.list[${j}] must be ["New"|"Fixed"|"Changed", "text"]`);
      }
    } else problems.push(`${at}: unknown block (${keys.join(', ')}); use p, h, note, video, img, banner or list`);
  }
  // A major release post shows the change: at least one picture or clip.
  if (media === 0) problems.push('a release post shows the change: add at least one video, image or banner from the real app');

  // Every named file exists; nothing is in the folder that the post does not name (a stray file would be published unseen).
  const files = [{ name: POST_FILE, path, size: statSync(path).size, kind: /** @type {const} */ ('json') }];
  let total = files[0].size;
  for (const [name, kind] of named) {
    const p = join(dir, name);
    if (!existsSync(p)) { problems.push(`${name} is named in the post but not in the folder`); continue; }
    const st = statSync(p);
    if (!st.isFile()) { problems.push(`${name} is not a file`); continue; }
    if (st.size === 0) problems.push(`${name} is empty`);
    if (st.size > MAX_FILE) problems.push(`${name} is ${(st.size / 1048576).toFixed(0)} MB; the limit is ${MAX_FILE / 1048576} MB`);
    total += st.size;
    files.push({ name, path: p, size: st.size, kind });
  }
  for (const entry of readdirSync(dir)) if (entry !== POST_FILE && !named.has(entry)) problems.push(`${entry} is in the folder but the post does not name it`);
  if (total > MAX_TOTAL) problems.push(`the post is ${(total / 1048576).toFixed(0)} MB in all; the limit is ${MAX_TOTAL / 1048576} MB`);
  if (problems.length) throw new PostError(`the release post is not ready:\n  - ${problems.join('\n  - ')}`);
  return { post, files, videos };
}
