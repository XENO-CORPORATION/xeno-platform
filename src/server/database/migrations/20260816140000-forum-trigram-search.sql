-- ============================================================================
-- Search recall (WP9, the achievable half).
--
-- MEASURED FIRST, against the live corpus. Six realistic phrasings of one known
-- thread ("Pasted image looks completely wrong — blue and red are swapped"):
--
--   "blue and red are swapped"          1 hit   <- the literal title
--   "BGRA"                              1 hit   <- a literal body term
--   "colors look inverted after paste"  0
--   "pasted picture has wrong colours"  0       <- synonym + British spelling
--   "clipboard image channel order"     0
--   "skin tones wrong when pasting"     0
--
-- 2 of 6. It hits only on near-exact wording, because `plainto_tsquery` ANDs
-- every term: "colors look inverted after paste" requires ALL FOUR words to be
-- present. Loop A's entire value is that the next agent's search HITS, and it
-- was missing two thirds of realistic phrasings.
--
-- ⚠️ WP9 as specified wants pgvector. `vector` is NOT in pg_available_extensions
-- on this image (PostgreSQL 15.17, Alpine) — that is an infrastructure blocker,
-- not a code one, and it is recorded rather than worked around. `pg_trgm` IS
-- available and buys most of the recall for none of the embedding pipeline.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram index on the TITLE only, deliberately.
--
-- A title is the one sentence written to be recognised — "Export hangs on 4K"
-- — and trigram-matching whole bodies would return a thread because two long
-- posts happen to share common substrings, which is noise wearing the costume
-- of recall. Bodies keep full-text matching, where term frequency does the
-- discriminating.
CREATE INDEX IF NOT EXISTS idx_forum_threads_title_trgm
  ON forum_threads USING gin (title gin_trgm_ops);
