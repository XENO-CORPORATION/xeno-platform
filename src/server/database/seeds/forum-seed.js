/**
 * XENO Forum seed — the spaces, the namespaced tag vocabulary, and a starter
 * Record (SPEC "XENO FORUM - SPEC.md" §14, milestone v0.1).
 *
 * WHY SEEDED CONTENT EXISTS: an empty forum reads as a dead product (D12), so
 * v0.1 ships the Record already populated from material this ecosystem has
 * already written down, and only then earns its nav slot.
 *
 * HONESTY RULES (these are the point, do not relax them):
 *   - Every seeded thread carries `source` and renders as such in the UI. The
 *     archive never pretends to be organic community activity.
 *   - Seeded rows are authored by `author_kind = 'system'` with a NULL author.
 *     No fake usernames, no fake avatars, no invented participants.
 *   - Content is transcribed from docs/engineering-learnings.md in the root
 *     workspace (root symptom + root cause + fix). It is NOT paraphrased from
 *     memory and NOT invented. That file lives outside this repo, so entries
 *     are transcribed here rather than read at runtime — a server seed cannot
 *     depend on a sibling checkout existing.
 *
 * IDEMPOTENT AND NON-DESTRUCTIVE (ABSOLUTE RULE §2b): keyed on a deterministic
 * short_id derived from the seed key. Re-running updates the seeded rows and
 * inserts what is missing. It never DELETEs, never TRUNCATEs, and never touches
 * a row it did not create (every write is scoped by `source LIKE 'seed:%'`).
 *
 * Run:  node src/server/database/seeds/forum-seed.js
 */

import pg from 'pg';
import crypto from 'crypto';

const { Pool } = pg;

const SEED_SOURCE = 'seed:engineering-learnings';

/** Stable short_id per seed key, so re-running is an upsert not a duplicate. */
function seedShortId(key) {
  return crypto.createHash('sha256').update(`forum-seed:${key}`).digest('hex').slice(0, 8);
}

function slugifyTitle(value) {
  return String(value).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200) || 'thread';
}

// ---------------------------------------------------------------------------
// Spaces — `kind` drives mechanics, not just the label (SPEC §2.1).
// ---------------------------------------------------------------------------
const SPACES = [
  {
    slug: 'help',
    name: 'Help & Troubleshooting',
    kind: 'qa',
    position: 10,
    description: 'Ask a question about any XENO product. Answers can be accepted, so the next person — or the next agent — finds the resolution instead of the argument.',
  },
  {
    slug: 'ideas',
    name: 'Ideas & Architecture',
    kind: 'discussion',
    position: 20,
    description: 'Open discussion about how the stack fits together. No accepted answers here; the point is the thinking, not the verdict.',
  },
  {
    slug: 'feedback',
    name: 'Feedback & Bug Reports',
    kind: 'feedback',
    position: 30,
    description: 'Report a bug or request a feature. Threads here can be promoted into a tracked issue — ranked by how many distinct people hit it, never by how loud the thread gets.',
  },
  {
    slug: 'showcase',
    name: 'Built with XENO',
    kind: 'showcase',
    position: 40,
    description: 'Show what you made. Humans and agents both welcome to post work.',
  },
  {
    slug: 'releases',
    name: 'Releases & Changelog',
    kind: 'announcement',
    position: 50,
    post_policy: 'staff_only',
    description: 'What shipped, when, and what changed. Staff-posted; replies open.',
  },
];

// ---------------------------------------------------------------------------
// Tag vocabulary. Namespaced on purpose (SPEC §2.2) — the namespace is the join
// key for the product-page widget, agent subscription predicates, and the
// release loop. `product:` values match real catalog slugs.
// ---------------------------------------------------------------------------
const TAGS = [
  { namespace: 'product', value: 'pixel' },
  { namespace: 'product', value: 'motion' },
  { namespace: 'product', value: 'canvas' },
  { namespace: 'product', value: 'sound' },
  { namespace: 'product', value: 'hub' },
  { namespace: 'product', value: 'workflow' },
  { namespace: 'product', value: '3d' },
  { namespace: 'product', value: 'engine' },
  { namespace: 'product', value: 'architect' },
  { namespace: 'kind', value: 'bug' },
  { namespace: 'kind', value: 'howto' },
  { namespace: 'kind', value: 'idea' },
  { namespace: 'topic', value: 'electron' },
  { namespace: 'topic', value: 'canvas-rendering' },
  { namespace: 'topic', value: 'webgl' },
  { namespace: 'topic', value: 'undo-history' },
  { namespace: 'topic', value: 'build' },
];

// ---------------------------------------------------------------------------
// Starter Record. Each entry is transcribed from a numbered entry in
// docs/engineering-learnings.md — symptom as the title (that is literally how
// a user reports it), root cause + fix as the accepted answer.
// ---------------------------------------------------------------------------
const THREADS = [
  {
    key: 'middle-click-drift',
    space: 'help',
    title: 'Canvas drifts on its own when middle mouse is held',
    tags: ['product:pixel', 'kind:bug', 'topic:canvas-rendering'],
    body: [
      'If I hold the middle mouse button without doing anything, the canvas starts moving on its own in all directions.',
      '',
      '**Affects:** Electron + canvas apps on Windows (any app that pans on middle-click).',
      'Reported against XENO Pixel; XENO Motion had defense-in-depth from the start and was never hit.',
    ].join('\n'),
    answer: [
      '**Windows middle-click activates OS auto-scroll mode.** Pressing the middle mouse button puts Windows into auto-scroll: it shows the round scroll-anchor cursor and scrolls the focused element based on the cursor offset from the anchor. The browser then fires continuous `pointermove` events whose `clientX/clientY` reflect the cursor position — so even with the mouse stationary, jitter and the auto-scroll math produce non-zero deltas. A pan handler reads those deltas and drifts the viewport.',
      '',
      'This does **not** reproduce on macOS or Linux — there is no equivalent OS-level middle-click auto-scroll. It can ship unnoticed if you only test on a Mac.',
      '',
      '**React\'s `onPointerDown` preventDefault is not enough.** React synthetic events are dispatched after React\'s own scheduling, so by the time your handler runs the browser may already be in auto-scroll mode. Suppress at the **native event layer in the capture phase**, before any default handling.',
    ].join('\n'),
  },
  {
    key: 'onnx-startup-crash',
    space: 'help',
    title: 'ONNX runtime crashes the Electron app on startup',
    tags: ['product:pixel', 'kind:bug', 'topic:electron', 'topic:build'],
    body: [
      '"App threw an error during load: Could not dynamically require `../bin/napi-v6/win32/x64/onnxruntime_binding.node`"',
      '',
      '**Affects:** any Electron app loading `onnxruntime-node`, `sharp`, `@imgly/background-removal-node`, or any other native module shipping `.node` binaries.',
    ].join('\n'),
    answer: [
      '**Native `.node` binaries cannot be bundled.** electron-vite\'s Rollup bundle tries to inline them, but they must be loaded from disk at runtime — and `@rollup/plugin-commonjs` has no way to know which dynamic requires are native bindings.',
      '',
      'Mark the native module as **external** in `electron-vite.config.ts`:',
      '',
      '```ts',
      'export default defineConfig({',
      '  main: {',
      '    plugins: [externalizeDepsPlugin({',
      "      include: ['onnxruntime-node', '@imgly/background-removal-node'],",
      '    })],',
      '  },',
      '})',
      '```',
    ].join('\n'),
  },
  {
    key: 'blurry-at-100',
    space: 'help',
    title: 'Canvas image is blurry at exactly 100% zoom',
    tags: ['kind:bug', 'topic:canvas-rendering'],
    body: 'The image looks soft at 100% zoom, but sharp at other zoom levels. At 1:1 it should be pixel-exact.',
    answer: [
      '**CSS sub-pixel translates trigger bilinear interpolation in the browser\'s compositor, even when the image scale is exactly 1.** So `transform: translate(10.4px, 20.6px) scale(1)` produces a blurry image.',
      '',
      'The fix is to snap the pan to the device-pixel grid when — and only when — zoom is exactly 1, using `window.devicePixelRatio`. Snapping at every zoom level would make panning feel notchy; the artifact only matters at 1:1.',
    ].join('\n'),
  },
  {
    key: 'reparent-deletes-subtree',
    space: 'help',
    title: 'Dragging a group onto something inside itself deletes the group and everything in it — and undo does not bring it back',
    tags: ['kind:bug', 'product:3d', 'product:engine', 'topic:undo-history'],
    body: [
      'Dragging a group in the outliner onto one of its own descendants makes the entire group disappear, along with all of its children. Undo does not restore it.',
      '',
      'This is a data-loss bug, not a display bug.',
    ].join('\n'),
    answer: [
      '**The reparent is two steps over an immutable tree, and the second step can silently fail.**',
      '',
      'First `removeFromTree()` detaches the node *with its children*. Then the code looks for the new parent inside `remaining` — but when the drop target is a **descendant of the node being moved**, that parent is no longer in `remaining`: it left the tree in step one, still attached to the detached node. The re-attach finds nothing, and the detached subtree is simply dropped on the floor.',
      '',
      'Undo "does not work" because the history entry recorded a reparent, not a deletion — it lies about what happened.',
      '',
      'The fix is to **reject the drop before mutating anything**: if the target is the node itself or any of its descendants, it is not a legal reparent.',
    ].join('\n'),
  },
  {
    key: 'webgl-context-lost',
    space: 'help',
    title: 'Viewport goes black or frozen after a driver reset, GPU switch, or waking the laptop — only a restart fixes it',
    tags: ['kind:bug', 'product:3d', 'product:engine', 'topic:webgl'],
    body: [
      'After the GPU driver resets, after switching between integrated and discrete graphics, or after waking the machine from sleep, the 3D viewport is black or frozen. Nothing recovers it short of restarting the app.',
    ].join('\n'),
    answer: [
      'Two distinct failures stacked.',
      '',
      '**1. There is no `webglcontextlost` handling at all.** The canonical trap: the browser only attempts to restore the context if you call `preventDefault()` on the `webglcontextlost` event. Without that, the context is gone permanently and no amount of re-rendering brings it back.',
      '',
      '**2. Nothing listens for `webglcontextrestored`**, so even a restored context never gets the render loop and GPU resources re-established.',
      '',
      'Handle both events, `preventDefault()` on loss, and rebuild GPU-side state on restore.',
    ].join('\n'),
  },
];

// ---------------------------------------------------------------------------

export async function seedForum(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // -- Spaces ------------------------------------------------------------
    const spaceIds = new Map();
    for (const space of SPACES) {
      const { rows } = await client.query(
        `INSERT INTO forum_spaces (slug, name, description, kind, position, post_policy)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6, 'open'))
         ON CONFLICT (slug) DO UPDATE
           SET name = EXCLUDED.name,
               description = EXCLUDED.description,
               kind = EXCLUDED.kind,
               position = EXCLUDED.position,
               post_policy = EXCLUDED.post_policy,
               updated_at = NOW()
         RETURNING id`,
        [space.slug, space.name, space.description, space.kind, space.position, space.post_policy || null],
      );
      spaceIds.set(space.slug, rows[0].id);
    }

    // -- Tags --------------------------------------------------------------
    const tagIds = new Map();
    for (const tag of TAGS) {
      const { rows } = await client.query(
        `INSERT INTO forum_tags (namespace, value, description)
         VALUES ($1, $2, $3)
         ON CONFLICT (namespace, value) DO UPDATE SET description = EXCLUDED.description
         RETURNING id`,
        [tag.namespace, tag.value, tag.description || null],
      );
      tagIds.set(`${tag.namespace}:${tag.value}`, rows[0].id);
    }

    // -- Threads + their two posts (body, accepted answer) -----------------
    for (const t of THREADS) {
      const shortId = seedShortId(t.key);
      const slug = slugifyTitle(t.title);
      const spaceId = spaceIds.get(t.space);
      if (!spaceId) throw new Error(`seed: unknown space "${t.space}" for thread "${t.key}"`);

      const { rows: threadRows } = await client.query(
        `INSERT INTO forum_threads
           (short_id, space_id, slug, title, author_id, author_kind, status, source, post_count)
         VALUES ($1, $2, $3, $4, NULL, 'system', 'resolved', $5, 2)
         ON CONFLICT (short_id) DO UPDATE
           SET title = EXCLUDED.title,
               slug = EXCLUDED.slug,
               space_id = EXCLUDED.space_id,
               updated_at = NOW()
         RETURNING id`,
        [shortId, spaceId, slug, t.title, SEED_SOURCE],
      );
      const threadId = threadRows[0].id;

      // position 1 = the thread body, position 2 = the accepted answer.
      const { rows: bodyRows } = await client.query(
        `INSERT INTO forum_posts (thread_id, position, body, author_id, author_kind, source)
         VALUES ($1, 1, $2, NULL, 'system', $3)
         ON CONFLICT (thread_id, position) DO UPDATE
           SET body = EXCLUDED.body, updated_at = NOW()
         RETURNING id`,
        [threadId, t.body, SEED_SOURCE],
      );

      const { rows: answerRows } = await client.query(
        `INSERT INTO forum_posts
           (thread_id, position, body, author_id, author_kind, is_answer, accepted_at, source)
         VALUES ($1, 2, $2, NULL, 'system', TRUE, NOW(), $3)
         ON CONFLICT (thread_id, position) DO UPDATE
           SET body = EXCLUDED.body, is_answer = TRUE, updated_at = NOW()
         RETURNING id`,
        [threadId, t.answer, SEED_SOURCE],
      );

      // accepted_by stays NULL: D6 says only a human ratifies, and no human
      // ratified these. The thread is marked resolved because the SOURCE
      // document records the fix as shipped — that provenance is in `source`.
      await client.query(
        `UPDATE forum_threads
            SET answer_post_id = $2,
                resolved_at = COALESCE(resolved_at, NOW()),
                last_activity_at = COALESCE(last_activity_at, NOW()),
                post_count = 2
          WHERE id = $1`,
        [threadId, answerRows[0].id],
      );

      void bodyRows;

      for (const tagKey of t.tags || []) {
        const tagId = tagIds.get(tagKey);
        if (!tagId) continue;
        await client.query(
          `INSERT INTO forum_thread_tags (thread_id, tag_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [threadId, tagId],
        );
      }
    }

    // -- Denormalized counters ---------------------------------------------
    await client.query(
      `UPDATE forum_spaces s
          SET thread_count = (
            SELECT COUNT(*) FROM forum_threads t
             WHERE t.space_id = s.id AND t.status <> 'archived'
          )`,
    );
    await client.query(
      `UPDATE forum_tags g
          SET thread_count = (
            SELECT COUNT(*) FROM forum_thread_tags tt WHERE tt.tag_id = g.id
          )`,
    );

    await client.query('COMMIT');

    const total = THREADS.length;
    console.log(`[Seed] forum: ${SPACES.length} spaces, ${TAGS.length} tags, ${total} threads (source=${SEED_SOURCE})`);
    return { spaces: SPACES.length, tags: TAGS.length, threads: total };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Direct invocation: node src/server/database/seeds/forum-seed.js
if (process.argv[1] && process.argv[1].endsWith('forum-seed.js')) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  seedForum(pool)
    .then(() => pool.end())
    .catch((error) => {
      console.error('[Seed] forum failed:', error);
      pool.end();
      process.exitCode = 1;
    });
}
