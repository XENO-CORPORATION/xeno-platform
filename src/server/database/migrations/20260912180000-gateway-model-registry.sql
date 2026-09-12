-- Gateway model registry: a model alias becomes a ROW, not a release.
--
-- 🔴 WHY THIS TABLE AND NOT THE PRICING TABLES. server.js carries three
-- hardcoded maps: MODEL_MAP (aliases), CREDIT_COSTS and
-- MODEL_PRICING_PUBLIC_UNITS. Only the first one moves here.
--
-- Aliasing is routing: adding DeepSeek, or accepting `claude-opus-4.7` as well
-- as `claude-opus-4-7`, should not need a deploy. Pricing is MONEY: a typo in a
-- runtime row overcharges real customers instantly with no review, and code
-- review before a price change is a feature, not friction. The two look alike
-- in the source and are not alike at all.
--
-- The gateway keeps its compiled-in map as a FALLBACK, so a database that is
-- unreachable degrades to today's behaviour instead of refusing every request.

CREATE TABLE IF NOT EXISTS gateway_model_aliases (
  public_id     text PRIMARY KEY,
  internal_id   text NOT NULL,
  enabled       boolean NOT NULL DEFAULT true,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE gateway_model_aliases IS
  'Public model id -> internal model id for the API gateway. Read with a short TTL cache; the gateway falls back to its compiled-in map when this is unreachable. Pricing deliberately does NOT live here.';

CREATE INDEX IF NOT EXISTS gateway_model_aliases_enabled_idx
  ON gateway_model_aliases(enabled) WHERE enabled;

-- Seeded from the MODEL_MAP compiled into server.js at the time of writing, so
-- the table starts as an exact description of live behaviour. ON CONFLICT DO
-- NOTHING makes re-running safe and never clobbers an operator's edit.
INSERT INTO gateway_model_aliases (public_id, internal_id) VALUES
  ('claude-3-5-haiku-20241022', 'claude-3-5-haiku-20241022'),
  ('claude-3-7-sonnet-20250219', 'claude-3-7-sonnet-20250219'),
  ('claude-haiku-4-5-20251001', 'claude-haiku-4-5-20251001'),
  ('claude-haiku-4.5', 'claude-haiku-4-5-20251001'),
  ('claude-opus-4-1-20250805', 'claude-opus-4-1-20250805'),
  ('claude-opus-4-20250514', 'claude-opus-4-20250514'),
  ('claude-opus-4-5-20251101', 'claude-opus-4-5-20251101'),
  ('claude-opus-4-5-thinking', 'claude-opus-4-5-thinking'),
  ('claude-opus-4-6', 'claude-opus-4-6'),
  ('claude-opus-4-6-thinking', 'claude-opus-4-6-thinking'),
  ('claude-opus-4-7', 'claude-opus-4-7'),
  ('claude-opus-4.5-thinking', 'claude-opus-4-5-thinking'),
  ('claude-opus-4.6', 'claude-opus-4-6'),
  ('claude-opus-4.6-thinking', 'claude-opus-4-6-thinking'),
  ('claude-opus-4.7', 'claude-opus-4-7'),
  ('claude-sonnet-4-20250514', 'claude-sonnet-4-20250514'),
  ('claude-sonnet-4-5', 'claude-sonnet-4-5'),
  ('claude-sonnet-4-5-20250929', 'claude-sonnet-4-5-20250929'),
  ('claude-sonnet-4-5-thinking', 'claude-sonnet-4-5-thinking'),
  ('claude-sonnet-4-6', 'claude-sonnet-4-6'),
  ('claude-sonnet-4-6-thinking', 'claude-sonnet-4-6-thinking'),
  ('claude-sonnet-4.5', 'claude-sonnet-4-5'),
  ('claude-sonnet-4.5-thinking', 'claude-sonnet-4-5-thinking'),
  ('claude-sonnet-4.6', 'claude-sonnet-4-6'),
  ('claude-sonnet-4.6-thinking', 'claude-sonnet-4-6-thinking'),
  ('dreamina-seedance-2-0-260128', 'seedance-2.0'),
  ('dreamina-seedance-2-0-fast-260128', 'seedance-2.0-fast'),
  ('gemini-2.5-flash', 'gemini-2.5-flash'),
  ('gemini-2.5-flash-lite', 'gemini-2.5-flash-lite'),
  ('gemini-2.5-flash-thinking', 'gemini-2.5-flash-thinking'),
  ('gemini-2.5-pro', 'gemini-2.5-pro'),
  ('gemini-3-flash', 'gemini-3-flash'),
  ('gemini-3-pro-high', 'gemini-3-pro-high'),
  ('gemini-3-pro-low', 'gemini-3-pro-low'),
  ('gemini-3.1-pro-preview', 'gemini-3.1-pro-preview'),
  ('google-veo3_1', 'veo_31_fast'),
  ('google-veo3_1-fast', 'veo_31_fast'),
  ('google-veo3_1-fast-relaxed', 'veo_31_fast_relaxed'),
  ('google-veo3_1-quality', 'veo_31_quality'),
  ('imagen4', 'imagen4'),
  ('nano_banana', 'nano_banana'),
  ('nano_banana_2', 'nano_banana_2'),
  ('nano_banana_pro', 'nano_banana_pro'),
  ('seedance-2', 'seedance-2.0'),
  ('seedance-2-fast', 'seedance-2.0-fast'),
  ('seedance-2.0', 'seedance-2.0'),
  ('seedance-2.0-fast', 'seedance-2.0-fast'),
  ('veo_31_fast', 'veo_31_fast'),
  ('veo_31_fast_relaxed', 'veo_31_fast_relaxed'),
  ('veo_31_quality', 'veo_31_quality')
ON CONFLICT (public_id) DO NOTHING;

-- DOWN
DROP TABLE IF EXISTS gateway_model_aliases;
