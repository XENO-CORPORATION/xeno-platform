-- =====================================================================
-- 00000000000000-baseline.sql
--
-- SQUASHED SNAPSHOT of the 40 "orphan" production tables that were hand-built
-- directly on the xenostudio prod DB and had NO committed CREATE TABLE. This
-- migration makes the repo the source of truth: a virgin Postgres, driven
-- through the exact production startup sequence, reproduces all 82 prod tables.
--
-- WHY THIS SORTS FIRST: the versioned runner (services/migrationRunner.js) sorts
-- lexicographically, so 00000000000000-... runs before every dated migration.
-- That guarantees the money/identity tables (credit_accounts, credit_transactions,
-- users, pricing_tiers, external_identity_links, billing_*, api_*, chat_*, image_*,
-- oauth_accounts, ...) exist BEFORE later migrations ALTER them
-- (e.g. 20260712000000-workspace-billing.sql ALTERs credit_accounts).
--
-- The other startup creators are DISJOINT from this file (no CREATE collides):
--   * database/youtube-schema.sql        -> 8 youtube_* tables      (step 1)
--   * database/office-canvas-schema.sql  -> office_canvases(+collab) (step 1)
--   * database/migrations/2026*.sql      -> infra/marketplace/remote/workspaces (step 2)
--   * database/migrate-account-v2.js     -> credit_holds/grants/spend_caps/oauth_*/
--                                           oidc_signing_keys/relationship_tuples (step 3)
--   * schema_migrations                  -> created by the runner itself
-- This file creates ONLY the 40 tables none of the above create.
--
-- ON EXISTING DBs (prod): these tables already exist, so this migration is
-- marked-applied by hand and never actually runs there:
--   INSERT INTO schema_migrations (version, name)
--   VALUES ('00000000000000','baseline') ON CONFLICT (version) DO NOTHING;
--
-- Faithfully reproduced from a pg_dump --schema-only of prod (PG 15.17):
-- columns/types/defaults/PK/UNIQUE/CHECK/FK/indexes + the image_projects
-- updated_at trigger. CREATE TABLE/INDEX use IF NOT EXISTS for safety; the
-- runner wraps the whole file in one transaction and records it once.
-- =====================================================================

-- Required for gen_random_uuid() column defaults below (built into core on
-- PG13+, but declared for fidelity with the prod schema and older engines).
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

-- Orphan trigger function: image_projects.updated_at bump. No other startup
-- creator defines it, so the trigger at the end of this file needs it here.
CREATE OR REPLACE FUNCTION public.update_image_projects_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $fn$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$fn$;

--
--






--
-- Name: api_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.api_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    api_key_id uuid,
    request_id character varying(64),
    provider character varying(50) NOT NULL,
    provider_job_id character varying(255),
    model character varying(255) NOT NULL,
    status character varying(50) DEFAULT 'pending'::character varying NOT NULL,
    progress numeric(5,4),
    input jsonb NOT NULL,
    output jsonb,
    error text,
    logs text,
    estimated_cost bigint,
    actual_cost bigint,
    webhook_url character varying(500),
    webhook_delivered boolean DEFAULT false,
    created_at timestamp without time zone DEFAULT now(),
    started_at timestamp without time zone,
    completed_at timestamp without time zone,
    expires_at timestamp without time zone
);


--
-- Name: api_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.api_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    key_prefix character varying(16) NOT NULL,
    key_hash character varying(255) NOT NULL,
    name character varying(100) DEFAULT 'Default Key'::character varying NOT NULL,
    rate_limit_per_minute integer DEFAULT 60,
    rate_limit_per_day integer DEFAULT 10000,
    daily_credit_limit bigint,
    is_active boolean DEFAULT true,
    last_used_at timestamp without time zone,
    usage_count bigint DEFAULT 0,
    created_at timestamp without time zone DEFAULT now(),
    expires_at timestamp without time zone
);


--
-- Name: api_usage_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.api_usage_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    api_key_id uuid,
    job_id uuid,
    request_id character varying(64),
    endpoint character varying(100) NOT NULL,
    method character varying(10) NOT NULL,
    provider character varying(50),
    model character varying(100),
    operation character varying(50),
    request_params jsonb,
    estimated_cost_micro bigint,
    actual_cost_micro bigint,
    provider_cost_usd numeric(10,6),
    status character varying(20) NOT NULL,
    response_code integer,
    error_message text,
    processing_time_ms integer,
    ip_address inet,
    user_agent text,
    created_at timestamp without time zone DEFAULT now(),
    workspace_id uuid,
    project_id uuid,
    input_tokens bigint DEFAULT 0 NOT NULL,
    output_tokens bigint DEFAULT 0 NOT NULL,
    surface character varying(64)
);


--
-- Name: billing_customers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.billing_customers (
    user_id text NOT NULL,
    stripe_customer_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: billing_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.billing_events (
    event_id text NOT NULL,
    type text,
    user_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: billing_payment_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.billing_payment_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    provider character varying(32) NOT NULL,
    transaction_type character varying(64) NOT NULL,
    checkout_mode character varying(32),
    status character varying(32) DEFAULT 'pending'::character varying NOT NULL,
    currency character varying(16) DEFAULT 'usd'::character varying NOT NULL,
    amount_cents integer,
    credit_amount_micro bigint DEFAULT 0 NOT NULL,
    provider_customer_id character varying(255),
    provider_checkout_session_id character varying(255),
    provider_payment_intent_id character varying(255),
    provider_invoice_id character varying(255),
    provider_subscription_id character varying(255),
    provider_event_id character varying(255),
    description text,
    checkout_url text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    completed_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: billing_project_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.billing_project_policies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    allow_api_access boolean DEFAULT true,
    allow_overage boolean DEFAULT false,
    daily_credit_limit_micro bigint,
    monthly_credit_limit_micro bigint,
    max_requests_per_minute integer,
    max_requests_per_day integer,
    allowed_models text[] DEFAULT ARRAY[]::text[],
    blocked_models text[] DEFAULT ARRAY[]::text[],
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: billing_projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.billing_projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid,
    name character varying(255) NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    slug character varying(255) NOT NULL,
    status character varying(32) DEFAULT 'active'::character varying NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: billing_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.billing_subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    plan_name text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    config jsonb,
    monthly_price numeric(10,2) DEFAULT 0.00 NOT NULL,
    next_billing_date timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: billing_workspace_budgets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.billing_workspace_budgets (
    workspace_id uuid NOT NULL,
    daily_credit_limit_micro bigint,
    monthly_credit_limit_micro bigint,
    alert_thresholds integer[] DEFAULT ARRAY[80, 100] NOT NULL,
    notify_on_thresholds boolean DEFAULT true NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: billing_workspace_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.billing_workspace_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    member_role character varying(32) NOT NULL,
    member_status character varying(32) NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: billing_workspaces; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.billing_workspaces (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(255) NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    owner_user_id uuid NOT NULL,
    workspace_type character varying(32) DEFAULT 'personal'::character varying NOT NULL,
    slug character varying(255) NOT NULL,
    status character varying(32) DEFAULT 'active'::character varying NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: blog_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.blog_posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug character varying(200) NOT NULL,
    title character varying(500) NOT NULL,
    excerpt text,
    content text NOT NULL,
    cover_image text,
    category character varying(50) DEFAULT 'update'::character varying NOT NULL,
    tags text[] DEFAULT '{}'::text[],
    author_name character varying(200) DEFAULT 'XENO Team'::character varying NOT NULL,
    author_avatar text,
    published boolean DEFAULT false,
    published_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: chat_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.chat_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title character varying(255) DEFAULT 'New Chat'::character varying NOT NULL,
    model_id character varying(255),
    system_prompt text,
    persona_id character varying(50),
    interface_id character varying(100) DEFAULT 'playground'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    last_message_at timestamp without time zone,
    deleted_at timestamp without time zone,
    is_archived boolean DEFAULT false,
    workspace_id uuid
);


--
-- Name: chat_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.chat_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role character varying(20) NOT NULL,
    content text NOT NULL,
    model_id character varying(255),
    thinking text,
    has_thinking boolean DEFAULT false,
    attachments jsonb,
    search_context jsonb,
    prompt_tokens integer,
    completion_tokens integer,
    total_tokens integer,
    created_at timestamp without time zone DEFAULT now(),
    message_index integer NOT NULL
);


--
-- Name: chat_personas; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.chat_personas (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    name character varying(100) NOT NULL,
    description character varying(500),
    prompt text NOT NULL,
    icon character varying(50),
    color character varying(20),
    use_count integer DEFAULT 0,
    last_used_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    sort_order integer DEFAULT 0,
    is_favorite boolean DEFAULT false
);


--
-- Name: chat_share_acceptances; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.chat_share_acceptances (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    share_id uuid NOT NULL,
    user_id uuid NOT NULL,
    new_conversation_id uuid NOT NULL,
    accepted_at timestamp without time zone DEFAULT now()
);


--
-- Name: chat_shared_conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.chat_shared_conversations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    conversation_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    share_token character varying(64) NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    revoked_at timestamp without time zone,
    accept_count integer DEFAULT 0
);


--
-- Name: containers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.containers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    container_name text NOT NULL,
    display_name text,
    status text DEFAULT 'creating'::text NOT NULL,
    config jsonb,
    resource_limits jsonb,
    docker_container_id text,
    last_started_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: credit_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.credit_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    balance bigint DEFAULT 0 NOT NULL,
    lifetime_earned bigint DEFAULT 0 NOT NULL,
    lifetime_spent bigint DEFAULT 0 NOT NULL,
    monthly_allowance bigint DEFAULT 0,
    allowance_reset_date date,
    is_frozen boolean DEFAULT false,
    frozen_reason text,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    owner_kind character varying(16) DEFAULT 'user'::character varying NOT NULL
);


--
-- Name: credit_transactions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.credit_transactions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    account_id uuid NOT NULL,
    type character varying(30) NOT NULL,
    amount bigint NOT NULL,
    balance_after bigint NOT NULL,
    reference_type character varying(50),
    reference_id character varying(255),
    description text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp without time zone DEFAULT now(),
    prev_hash text,
    entry_hash text
);


--
-- Name: email_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.email_verifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    email character varying(255) NOT NULL,
    token_hash character varying(255) NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    verified_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: external_api_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.external_api_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_system character varying(64) NOT NULL,
    external_key_id text,
    platform_api_key_id uuid,
    platform_project_id uuid,
    external_user_id text,
    external_email text,
    key_prefix text,
    legacy_status character varying(32) DEFAULT 'active'::character varying,
    legacy_created_at timestamp without time zone,
    legacy_last_used_at timestamp without time zone,
    legacy_expires_at timestamp without time zone,
    legacy_total_requests bigint DEFAULT 0,
    legacy_total_tokens bigint DEFAULT 0,
    metadata jsonb,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: external_identity_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.external_identity_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_system character varying(64) NOT NULL,
    external_user_id text,
    external_email text,
    platform_user_id uuid NOT NULL,
    metadata jsonb,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: image_assets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.image_assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid,
    session_id uuid,
    user_id uuid NOT NULL,
    name character varying(255) NOT NULL,
    type character varying(20) NOT NULL,
    format character varying(50),
    file_url character varying(500) NOT NULL,
    thumbnail_url character varying(500),
    width integer,
    height integer,
    file_size bigint,
    model_used character varying(100),
    prompt text,
    negative_prompt text,
    seed character varying(50),
    guidance_scale numeric(5,2),
    generation_time numeric(10,2),
    source character varying(50) DEFAULT 'generation'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    metadata jsonb
);


--
-- Name: TABLE image_assets; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.image_assets IS 'Stores all images (generated, uploaded, edited) associated with projects';


--
-- Name: COLUMN image_assets.metadata; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.image_assets.metadata IS 'JSONB storing additional properties like response_id, context_id, tags, etc.';


--
-- Name: image_generations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.image_generations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    prompt text NOT NULL,
    image_urls jsonb DEFAULT '[]'::jsonb NOT NULL,
    model character varying(100) NOT NULL,
    aspect_ratio character varying(20),
    resolution character varying(20),
    count integer DEFAULT 1,
    provider character varying(50),
    generation_time_ms integer,
    created_at timestamp without time zone DEFAULT now(),
    is_favorite boolean DEFAULT false,
    reference_images jsonb DEFAULT '[]'::jsonb,
    project_id uuid
);


--
-- Name: image_project_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.image_project_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    project_id uuid NOT NULL,
    user_id uuid NOT NULL,
    session_title character varying(255) NOT NULL,
    messages jsonb NOT NULL,
    canvas_snapshot jsonb,
    settings_snapshot jsonb,
    created_at timestamp without time zone DEFAULT now(),
    message_count integer DEFAULT 0,
    thumbnail_url character varying(500)
);


--
-- Name: TABLE image_project_sessions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.image_project_sessions IS 'Stores chat history and conversation checkpoints for each project';


--
-- Name: COLUMN image_project_sessions.messages; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.image_project_sessions.messages IS 'JSONB array of chat messages (role, content, images, timestamp)';


--
-- Name: image_projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.image_projects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    title character varying(255) DEFAULT 'Untitled Project'::character varying NOT NULL,
    description text,
    model character varying(100) DEFAULT 'flux-kontext'::character varying,
    seed character varying(50),
    guidance_scale numeric(5,2) DEFAULT 7.0,
    aspect_ratio character varying(10) DEFAULT '1:1'::character varying,
    num_images integer DEFAULT 1,
    canvas_data jsonb,
    style_type character varying(20),
    style_content text,
    style_name character varying(255),
    status character varying(20) DEFAULT 'draft'::character varying,
    thumbnail_url text,
    primary_image_url character varying(500),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    last_opened_at timestamp without time zone,
    is_public boolean DEFAULT false,
    share_token character varying(255),
    company character varying(64),
    folder_path text,
    resolution character varying(16),
    workspace_id uuid
);


--
-- Name: TABLE image_projects; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.image_projects IS 'Stores Image Studio projects with generation settings and canvas state';


--
-- Name: COLUMN image_projects.canvas_data; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.image_projects.canvas_data IS 'JSONB storing canvas layers, edits, segmentation masks, and canvas state';


--
-- Name: oauth_accounts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.oauth_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    provider character varying(50) NOT NULL,
    provider_user_id character varying(255) NOT NULL,
    provider_email character varying(255),
    provider_username character varying(255),
    provider_avatar_url character varying(500),
    provider_name character varying(255),
    access_token text,
    refresh_token text,
    token_expires_at timestamp without time zone,
    raw_profile jsonb,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: password_resets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.password_resets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    token_hash character varying(255) NOT NULL,
    expires_at timestamp without time zone NOT NULL,
    used_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: pricing_tiers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.pricing_tiers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider character varying(50) NOT NULL,
    model character varying(100) NOT NULL,
    operation character varying(50) NOT NULL,
    display_name character varying(100),
    description text,
    category character varying(50),
    base_cost_micro bigint DEFAULT 0 NOT NULL,
    cost_per_image bigint DEFAULT 0,
    cost_per_input_token bigint DEFAULT 0,
    cost_per_output_token bigint DEFAULT 0,
    cost_per_second bigint DEFAULT 0,
    cost_per_megapixel bigint DEFAULT 0,
    provider_base_cost_usd numeric(10,6),
    margin_percent numeric(5,2) DEFAULT 20.00,
    is_available boolean DEFAULT true,
    max_requests_per_minute integer,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: rate_limits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.rate_limits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    key character varying(255) NOT NULL,
    count integer DEFAULT 1,
    window_start timestamp without time zone DEFAULT now()
);


--
-- Name: security_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.security_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    event_type character varying(50) NOT NULL,
    ip_address inet,
    user_agent text,
    metadata jsonb,
    created_at timestamp without time zone DEFAULT now()
);


--
-- Name: tutorials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.tutorials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug character varying(200) NOT NULL,
    title character varying(500) NOT NULL,
    description text,
    content text NOT NULL,
    type character varying(50) DEFAULT 'tutorial'::character varying NOT NULL,
    category character varying(100) DEFAULT 'getting-started'::character varying NOT NULL,
    difficulty character varying(20) DEFAULT 'beginner'::character varying NOT NULL,
    duration character varying(50),
    cover_image text,
    video_url text,
    author_name character varying(200) DEFAULT 'XENO Team'::character varying NOT NULL,
    sort_order integer DEFAULT 0,
    published boolean DEFAULT false,
    published_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: user_files; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.user_files (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    filename character varying(255) NOT NULL,
    original_name character varying(255),
    file_type character varying(100),
    mime_type character varying(100),
    file_size integer,
    storage_path character varying(500),
    storage_type character varying(50) DEFAULT 'local'::character varying,
    metadata jsonb DEFAULT '{}'::jsonb,
    last_used_at timestamp without time zone DEFAULT now(),
    created_at timestamp without time zone DEFAULT now(),
    deleted_at timestamp without time zone
);


--
-- Name: user_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.user_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    token_hash character varying(255),
    expires_at timestamp without time zone NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    ip_address inet,
    user_agent text,
    session_token character varying(512),
    access_token_hash character varying(255),
    refresh_token_hash character varying(255),
    device_name character varying(255),
    device_type character varying(50),
    browser character varying(100),
    os character varying(100),
    location character varying(255),
    is_current boolean DEFAULT false,
    last_active_at timestamp without time zone DEFAULT now()
);


--
-- Name: user_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.user_settings (
    user_id uuid NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: user_usage; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.user_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    date date DEFAULT CURRENT_DATE NOT NULL,
    model_id character varying(255) NOT NULL,
    provider character varying(100),
    prompt_tokens integer DEFAULT 0,
    completion_tokens integer DEFAULT 0,
    total_tokens integer DEFAULT 0,
    request_count integer DEFAULT 0,
    estimated_cost numeric(10,6) DEFAULT 0,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    username character varying(50) NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    display_name character varying(255) NOT NULL,
    avatar_url character varying(500),
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    last_login timestamp without time zone,
    email_verified boolean DEFAULT false,
    is_active boolean DEFAULT true,
    reset_token character varying(255),
    reset_token_expires timestamp without time zone,
    credits integer DEFAULT 0,
    bonus_credits_claimed boolean DEFAULT false,
    status character varying(20) DEFAULT 'active'::character varying,
    role character varying(20) DEFAULT 'user'::character varying,
    plan character varying(50) DEFAULT 'free'::character varying,
    bio text,
    deleted_at timestamp without time zone,
    password_changed_at timestamp without time zone,
    failed_login_attempts integer DEFAULT 0,
    locked_until timestamp without time zone,
    preferences jsonb DEFAULT '{}'::jsonb
);


--
-- Name: xeno_account_plans; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS public.xeno_account_plans (
    user_id text NOT NULL,
    plan text DEFAULT 'free'::text NOT NULL,
    status text,
    stripe_subscription_id text,
    current_period_end timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: api_jobs api_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_jobs
    ADD CONSTRAINT api_jobs_pkey PRIMARY KEY (id);


--
-- Name: api_jobs api_jobs_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_jobs
    ADD CONSTRAINT api_jobs_request_id_key UNIQUE (request_id);


--
-- Name: api_keys api_keys_key_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_key_hash_key UNIQUE (key_hash);


--
-- Name: api_keys api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);


--
-- Name: api_usage_logs api_usage_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_usage_logs
    ADD CONSTRAINT api_usage_logs_pkey PRIMARY KEY (id);


--
-- Name: billing_customers billing_customers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_customers
    ADD CONSTRAINT billing_customers_pkey PRIMARY KEY (user_id);


--
-- Name: billing_customers billing_customers_stripe_customer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_customers
    ADD CONSTRAINT billing_customers_stripe_customer_id_key UNIQUE (stripe_customer_id);


--
-- Name: billing_events billing_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_events
    ADD CONSTRAINT billing_events_pkey PRIMARY KEY (event_id);


--
-- Name: billing_payment_transactions billing_payment_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_payment_transactions
    ADD CONSTRAINT billing_payment_transactions_pkey PRIMARY KEY (id);


--
-- Name: billing_project_policies billing_project_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_project_policies
    ADD CONSTRAINT billing_project_policies_pkey PRIMARY KEY (id);


--
-- Name: billing_project_policies billing_project_policies_project_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_project_policies
    ADD CONSTRAINT billing_project_policies_project_id_key UNIQUE (project_id);


--
-- Name: billing_projects billing_projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_projects
    ADD CONSTRAINT billing_projects_pkey PRIMARY KEY (id);


--
-- Name: billing_subscriptions billing_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_subscriptions
    ADD CONSTRAINT billing_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: billing_workspace_budgets billing_workspace_budgets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_workspace_budgets
    ADD CONSTRAINT billing_workspace_budgets_pkey PRIMARY KEY (workspace_id);


--
-- Name: billing_workspace_members billing_workspace_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_workspace_members
    ADD CONSTRAINT billing_workspace_members_pkey PRIMARY KEY (id);


--
-- Name: billing_workspaces billing_workspaces_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_workspaces
    ADD CONSTRAINT billing_workspaces_pkey PRIMARY KEY (id);


--
-- Name: blog_posts blog_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blog_posts
    ADD CONSTRAINT blog_posts_pkey PRIMARY KEY (id);


--
-- Name: blog_posts blog_posts_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.blog_posts
    ADD CONSTRAINT blog_posts_slug_key UNIQUE (slug);


--
-- Name: chat_conversations chat_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_conversations
    ADD CONSTRAINT chat_conversations_pkey PRIMARY KEY (id);


--
-- Name: chat_messages chat_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_pkey PRIMARY KEY (id);


--
-- Name: chat_personas chat_personas_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_personas
    ADD CONSTRAINT chat_personas_pkey PRIMARY KEY (id);


--
-- Name: chat_share_acceptances chat_share_acceptances_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_share_acceptances
    ADD CONSTRAINT chat_share_acceptances_pkey PRIMARY KEY (id);


--
-- Name: chat_share_acceptances chat_share_acceptances_share_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_share_acceptances
    ADD CONSTRAINT chat_share_acceptances_share_id_user_id_key UNIQUE (share_id, user_id);


--
-- Name: chat_shared_conversations chat_shared_conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_shared_conversations
    ADD CONSTRAINT chat_shared_conversations_pkey PRIMARY KEY (id);


--
-- Name: chat_shared_conversations chat_shared_conversations_share_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_shared_conversations
    ADD CONSTRAINT chat_shared_conversations_share_token_key UNIQUE (share_token);


--
-- Name: containers containers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.containers
    ADD CONSTRAINT containers_pkey PRIMARY KEY (id);


--
-- Name: credit_accounts credit_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_accounts
    ADD CONSTRAINT credit_accounts_pkey PRIMARY KEY (id);


--
-- Name: credit_accounts credit_accounts_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_accounts
    ADD CONSTRAINT credit_accounts_user_id_key UNIQUE (user_id);


--
-- Name: credit_transactions credit_transactions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_transactions
    ADD CONSTRAINT credit_transactions_pkey PRIMARY KEY (id);


--
-- Name: email_verifications email_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verifications
    ADD CONSTRAINT email_verifications_pkey PRIMARY KEY (id);


--
-- Name: external_api_keys external_api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_api_keys
    ADD CONSTRAINT external_api_keys_pkey PRIMARY KEY (id);


--
-- Name: external_identity_links external_identity_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_identity_links
    ADD CONSTRAINT external_identity_links_pkey PRIMARY KEY (id);


--
-- Name: image_assets image_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.image_assets
    ADD CONSTRAINT image_assets_pkey PRIMARY KEY (id);


--
-- Name: image_generations image_generations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.image_generations
    ADD CONSTRAINT image_generations_pkey PRIMARY KEY (id);


--
-- Name: image_project_sessions image_project_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.image_project_sessions
    ADD CONSTRAINT image_project_sessions_pkey PRIMARY KEY (id);


--
-- Name: image_projects image_projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.image_projects
    ADD CONSTRAINT image_projects_pkey PRIMARY KEY (id);


--
-- Name: image_projects image_projects_share_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.image_projects
    ADD CONSTRAINT image_projects_share_token_key UNIQUE (share_token);


--
-- Name: oauth_accounts oauth_accounts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_accounts
    ADD CONSTRAINT oauth_accounts_pkey PRIMARY KEY (id);


--
-- Name: oauth_accounts oauth_accounts_provider_provider_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_accounts
    ADD CONSTRAINT oauth_accounts_provider_provider_user_id_key UNIQUE (provider, provider_user_id);


--
-- Name: password_resets password_resets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_resets
    ADD CONSTRAINT password_resets_pkey PRIMARY KEY (id);


--
-- Name: pricing_tiers pricing_tiers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_tiers
    ADD CONSTRAINT pricing_tiers_pkey PRIMARY KEY (id);


--
-- Name: pricing_tiers pricing_tiers_provider_model_operation_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_tiers
    ADD CONSTRAINT pricing_tiers_provider_model_operation_key UNIQUE (provider, model, operation);


--
-- Name: rate_limits rate_limits_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limits
    ADD CONSTRAINT rate_limits_key_key UNIQUE (key);


--
-- Name: rate_limits rate_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.rate_limits
    ADD CONSTRAINT rate_limits_pkey PRIMARY KEY (id);


--
-- Name: security_events security_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_events
    ADD CONSTRAINT security_events_pkey PRIMARY KEY (id);


--
-- Name: tutorials tutorials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutorials
    ADD CONSTRAINT tutorials_pkey PRIMARY KEY (id);


--
-- Name: tutorials tutorials_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tutorials
    ADD CONSTRAINT tutorials_slug_key UNIQUE (slug);


--
-- Name: user_files user_files_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_files
    ADD CONSTRAINT user_files_pkey PRIMARY KEY (id);


--
-- Name: user_sessions user_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_pkey PRIMARY KEY (id);


--
-- Name: user_settings user_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_pkey PRIMARY KEY (user_id);


--
-- Name: user_usage user_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_usage
    ADD CONSTRAINT user_usage_pkey PRIMARY KEY (id);


--
-- Name: user_usage user_usage_user_id_date_model_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_usage
    ADD CONSTRAINT user_usage_user_id_date_model_id_key UNIQUE (user_id, date, model_id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: xeno_account_plans xeno_account_plans_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.xeno_account_plans
    ADD CONSTRAINT xeno_account_plans_pkey PRIMARY KEY (user_id);


--
-- Name: api_usage_logs_project_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS api_usage_logs_project_id_idx ON public.api_usage_logs USING btree (project_id);


--
-- Name: api_usage_logs_workspace_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS api_usage_logs_workspace_id_idx ON public.api_usage_logs USING btree (workspace_id);


--
-- Name: billing_payment_transactions_provider_checkout_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS billing_payment_transactions_provider_checkout_session_idx ON public.billing_payment_transactions USING btree (provider, provider_checkout_session_id) WHERE (provider_checkout_session_id IS NOT NULL);


--
-- Name: billing_payment_transactions_provider_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS billing_payment_transactions_provider_event_idx ON public.billing_payment_transactions USING btree (provider, provider_event_id) WHERE (provider_event_id IS NOT NULL);


--
-- Name: billing_project_policies_project_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS billing_project_policies_project_uidx ON public.billing_project_policies USING btree (project_id);


--
-- Name: billing_projects_workspace_slug_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS billing_projects_workspace_slug_uidx ON public.billing_projects USING btree (workspace_id, slug);


--
-- Name: billing_workspace_budgets_updated_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS billing_workspace_budgets_updated_at_idx ON public.billing_workspace_budgets USING btree (updated_at DESC);


--
-- Name: billing_workspace_members_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS billing_workspace_members_user_idx ON public.billing_workspace_members USING btree (user_id);


--
-- Name: billing_workspace_members_workspace_user_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS billing_workspace_members_workspace_user_uidx ON public.billing_workspace_members USING btree (workspace_id, user_id);


--
-- Name: billing_workspaces_owner_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS billing_workspaces_owner_type_idx ON public.billing_workspaces USING btree (owner_user_id, workspace_type);


--
-- Name: billing_workspaces_slug_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS billing_workspaces_slug_uidx ON public.billing_workspaces USING btree (slug);


--
-- Name: external_api_keys_source_external_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS external_api_keys_source_external_uidx ON public.external_api_keys USING btree (source_system, external_key_id);


--
-- Name: idx_api_jobs_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_api_jobs_provider ON public.api_jobs USING btree (provider);


--
-- Name: idx_api_jobs_request_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_api_jobs_request_id ON public.api_jobs USING btree (request_id);


--
-- Name: idx_api_jobs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_api_jobs_status ON public.api_jobs USING btree (status);


--
-- Name: idx_api_jobs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_api_jobs_user ON public.api_jobs USING btree (user_id, created_at DESC);


--
-- Name: idx_api_keys_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON public.api_keys USING btree (key_hash);


--
-- Name: idx_api_keys_prefix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON public.api_keys USING btree (key_prefix);


--
-- Name: idx_api_keys_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON public.api_keys USING btree (user_id);


--
-- Name: idx_billing_projects_workspace_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_billing_projects_workspace_id ON public.billing_projects USING btree (workspace_id);


--
-- Name: idx_billing_subscriptions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_status ON public.billing_subscriptions USING btree (status);


--
-- Name: idx_billing_subscriptions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_billing_subscriptions_user_id ON public.billing_subscriptions USING btree (user_id);


--
-- Name: idx_blog_posts_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_blog_posts_category ON public.blog_posts USING btree (category);


--
-- Name: idx_blog_posts_published; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_blog_posts_published ON public.blog_posts USING btree (published, published_at DESC);


--
-- Name: idx_blog_posts_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_blog_posts_slug ON public.blog_posts USING btree (slug);


--
-- Name: idx_chat_conversations_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_chat_conversations_updated ON public.chat_conversations USING btree (user_id, updated_at DESC);


--
-- Name: idx_chat_conversations_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_chat_conversations_user ON public.chat_conversations USING btree (user_id, deleted_at);


--
-- Name: idx_chat_conversations_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_chat_conversations_workspace ON public.chat_conversations USING btree (workspace_id);


--
-- Name: idx_chat_messages_conversation; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON public.chat_messages USING btree (conversation_id, message_index);


--
-- Name: idx_chat_personas_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_chat_personas_user ON public.chat_personas USING btree (user_id, sort_order);


--
-- Name: idx_chat_shared_conv; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_chat_shared_conv ON public.chat_shared_conversations USING btree (conversation_id, owner_id);


--
-- Name: idx_chat_shared_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_chat_shared_token ON public.chat_shared_conversations USING btree (share_token);


--
-- Name: idx_containers_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_containers_status ON public.containers USING btree (status);


--
-- Name: idx_containers_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_containers_user_id ON public.containers USING btree (user_id);


--
-- Name: idx_credit_accounts_owner_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_credit_accounts_owner_kind ON public.credit_accounts USING btree (owner_kind);


--
-- Name: idx_credit_accounts_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_credit_accounts_user ON public.credit_accounts USING btree (user_id);


--
-- Name: idx_credit_transactions_account; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_credit_transactions_account ON public.credit_transactions USING btree (account_id);


--
-- Name: idx_credit_transactions_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_credit_transactions_type ON public.credit_transactions USING btree (type);


--
-- Name: idx_credit_transactions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_credit_transactions_user ON public.credit_transactions USING btree (user_id, created_at DESC);


--
-- Name: idx_external_api_keys_platform_api_key_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_external_api_keys_platform_api_key_id ON public.external_api_keys USING btree (platform_api_key_id);


--
-- Name: idx_external_api_keys_source_external_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_external_api_keys_source_external_key ON public.external_api_keys USING btree (source_system, external_key_id);


--
-- Name: idx_external_identity_links_platform_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_external_identity_links_platform_user ON public.external_identity_links USING btree (platform_user_id);


--
-- Name: idx_external_identity_links_source_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_external_identity_links_source_email ON public.external_identity_links USING btree (source_system, lower(external_email));


--
-- Name: idx_external_identity_links_source_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_external_identity_links_source_user ON public.external_identity_links USING btree (source_system, external_user_id);


--
-- Name: idx_image_assets_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_image_assets_created ON public.image_assets USING btree (created_at DESC);


--
-- Name: idx_image_assets_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_image_assets_project ON public.image_assets USING btree (project_id);


--
-- Name: idx_image_assets_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_image_assets_session ON public.image_assets USING btree (session_id);


--
-- Name: idx_image_assets_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_image_assets_type ON public.image_assets USING btree (type);


--
-- Name: idx_image_assets_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_image_assets_user ON public.image_assets USING btree (user_id);


--
-- Name: idx_image_generations_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_image_generations_project ON public.image_generations USING btree (project_id) WHERE (project_id IS NOT NULL);


--
-- Name: idx_image_generations_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_image_generations_user ON public.image_generations USING btree (user_id);


--
-- Name: idx_image_generations_user_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_image_generations_user_created ON public.image_generations USING btree (user_id, created_at DESC);


--
-- Name: idx_image_generations_user_favorites; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_image_generations_user_favorites ON public.image_generations USING btree (user_id, is_favorite) WHERE (is_favorite = true);


--
-- Name: idx_image_project_sessions_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_image_project_sessions_created ON public.image_project_sessions USING btree (created_at DESC);


--
-- Name: idx_image_project_sessions_project; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_image_project_sessions_project ON public.image_project_sessions USING btree (project_id);


--
-- Name: idx_image_project_sessions_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_image_project_sessions_user ON public.image_project_sessions USING btree (user_id);


--
-- Name: idx_image_projects_share_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_image_projects_share_token ON public.image_projects USING btree (share_token) WHERE (share_token IS NOT NULL);


--
-- Name: idx_image_projects_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_image_projects_status ON public.image_projects USING btree (status);


--
-- Name: idx_image_projects_updated; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_image_projects_updated ON public.image_projects USING btree (updated_at DESC);


--
-- Name: idx_image_projects_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_image_projects_user ON public.image_projects USING btree (user_id);


--
-- Name: idx_image_projects_workspace; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_image_projects_workspace ON public.image_projects USING btree (workspace_id);


--
-- Name: idx_oauth_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_oauth_provider ON public.oauth_accounts USING btree (provider, provider_user_id);


--
-- Name: idx_oauth_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_oauth_user_id ON public.oauth_accounts USING btree (user_id);


--
-- Name: idx_pricing_tiers_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_pricing_tiers_lookup ON public.pricing_tiers USING btree (provider, model) WHERE (is_available = true);


--
-- Name: idx_rate_limits_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_rate_limits_key ON public.rate_limits USING btree (key);


--
-- Name: idx_security_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_security_created ON public.security_events USING btree (created_at);


--
-- Name: idx_security_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_security_user_id ON public.security_events USING btree (user_id);


--
-- Name: idx_sessions_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON public.user_sessions USING btree (expires_at);


--
-- Name: idx_sessions_token_hash; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON public.user_sessions USING btree (access_token_hash);


--
-- Name: idx_sessions_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON public.user_sessions USING btree (user_id);


--
-- Name: idx_tutorials_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_tutorials_category ON public.tutorials USING btree (category);


--
-- Name: idx_tutorials_published; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_tutorials_published ON public.tutorials USING btree (published, sort_order, published_at DESC);


--
-- Name: idx_tutorials_slug; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_tutorials_slug ON public.tutorials USING btree (slug);


--
-- Name: idx_tutorials_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_tutorials_type ON public.tutorials USING btree (type);


--
-- Name: idx_usage_logs_api_key; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_usage_logs_api_key ON public.api_usage_logs USING btree (api_key_id);


--
-- Name: idx_usage_logs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_usage_logs_status ON public.api_usage_logs USING btree (status);


--
-- Name: idx_usage_logs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_usage_logs_user ON public.api_usage_logs USING btree (user_id, created_at DESC);


--
-- Name: idx_user_files_last_used; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_user_files_last_used ON public.user_files USING btree (user_id, last_used_at DESC);


--
-- Name: idx_user_files_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_user_files_user ON public.user_files USING btree (user_id, deleted_at);


--
-- Name: idx_user_usage_model; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_user_usage_model ON public.user_usage USING btree (user_id, model_id);


--
-- Name: idx_user_usage_user_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_user_usage_user_date ON public.user_usage USING btree (user_id, date DESC);


--
-- Name: idx_users_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_users_email ON public.users USING btree (email);


--
-- Name: idx_users_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_users_status ON public.users USING btree (status);


--
-- Name: idx_users_username; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS idx_users_username ON public.users USING btree (username);


--
-- Name: uq_credit_txn_ref; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_txn_ref ON public.credit_transactions USING btree (user_id, reference_type, reference_id) WHERE ((reference_type IS NOT NULL) AND (reference_id IS NOT NULL));


--
-- Name: uq_eil_source_platform; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX IF NOT EXISTS uq_eil_source_platform ON public.external_identity_links USING btree (source_system, platform_user_id);


--
-- Name: credit_transactions trg_credit_txn_immutable; Type: TRIGGER; Schema: public; Owner: -
--



--
-- Name: image_projects trigger_update_image_projects_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trigger_update_image_projects_updated_at BEFORE UPDATE ON public.image_projects FOR EACH ROW EXECUTE FUNCTION public.update_image_projects_updated_at();


--
-- Name: api_jobs api_jobs_api_key_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_jobs
    ADD CONSTRAINT api_jobs_api_key_id_fkey FOREIGN KEY (api_key_id) REFERENCES public.api_keys(id) ON DELETE SET NULL;


--
-- Name: api_usage_logs api_usage_logs_api_key_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_usage_logs
    ADD CONSTRAINT api_usage_logs_api_key_id_fkey FOREIGN KEY (api_key_id) REFERENCES public.api_keys(id) ON DELETE SET NULL;


--
-- Name: api_usage_logs api_usage_logs_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_usage_logs
    ADD CONSTRAINT api_usage_logs_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.api_jobs(id) ON DELETE SET NULL;


--
-- Name: api_usage_logs api_usage_logs_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_usage_logs
    ADD CONSTRAINT api_usage_logs_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.billing_projects(id) ON DELETE SET NULL;


--
-- Name: api_usage_logs api_usage_logs_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_usage_logs
    ADD CONSTRAINT api_usage_logs_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.billing_workspaces(id) ON DELETE SET NULL;


--
-- Name: billing_payment_transactions billing_payment_transactions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_payment_transactions
    ADD CONSTRAINT billing_payment_transactions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: billing_payment_transactions billing_payment_transactions_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_payment_transactions
    ADD CONSTRAINT billing_payment_transactions_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.billing_workspaces(id) ON DELETE CASCADE;


--
-- Name: billing_project_policies billing_project_policies_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_project_policies
    ADD CONSTRAINT billing_project_policies_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.billing_projects(id) ON DELETE CASCADE;


--
-- Name: billing_projects billing_projects_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_projects
    ADD CONSTRAINT billing_projects_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.billing_workspaces(id) ON DELETE CASCADE;


--
-- Name: billing_subscriptions billing_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_subscriptions
    ADD CONSTRAINT billing_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: billing_workspace_budgets billing_workspace_budgets_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_workspace_budgets
    ADD CONSTRAINT billing_workspace_budgets_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.billing_workspaces(id) ON DELETE CASCADE;


--
-- Name: billing_workspace_members billing_workspace_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_workspace_members
    ADD CONSTRAINT billing_workspace_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: billing_workspace_members billing_workspace_members_workspace_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_workspace_members
    ADD CONSTRAINT billing_workspace_members_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.billing_workspaces(id) ON DELETE CASCADE;


--
-- Name: billing_workspaces billing_workspaces_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.billing_workspaces
    ADD CONSTRAINT billing_workspaces_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: chat_conversations chat_conversations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_conversations
    ADD CONSTRAINT chat_conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.chat_conversations(id) ON DELETE CASCADE;


--
-- Name: chat_messages chat_messages_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_messages
    ADD CONSTRAINT chat_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: chat_personas chat_personas_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_personas
    ADD CONSTRAINT chat_personas_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: chat_share_acceptances chat_share_acceptances_new_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_share_acceptances
    ADD CONSTRAINT chat_share_acceptances_new_conversation_id_fkey FOREIGN KEY (new_conversation_id) REFERENCES public.chat_conversations(id) ON DELETE CASCADE;


--
-- Name: chat_share_acceptances chat_share_acceptances_share_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_share_acceptances
    ADD CONSTRAINT chat_share_acceptances_share_id_fkey FOREIGN KEY (share_id) REFERENCES public.chat_shared_conversations(id) ON DELETE CASCADE;


--
-- Name: chat_share_acceptances chat_share_acceptances_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_share_acceptances
    ADD CONSTRAINT chat_share_acceptances_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: chat_shared_conversations chat_shared_conversations_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_shared_conversations
    ADD CONSTRAINT chat_shared_conversations_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.chat_conversations(id) ON DELETE CASCADE;


--
-- Name: chat_shared_conversations chat_shared_conversations_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chat_shared_conversations
    ADD CONSTRAINT chat_shared_conversations_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: containers containers_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.containers
    ADD CONSTRAINT containers_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: credit_transactions credit_transactions_account_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.credit_transactions
    ADD CONSTRAINT credit_transactions_account_id_fkey FOREIGN KEY (account_id) REFERENCES public.credit_accounts(id) ON DELETE CASCADE;


--
-- Name: email_verifications email_verifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_verifications
    ADD CONSTRAINT email_verifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: external_api_keys external_api_keys_platform_api_key_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_api_keys
    ADD CONSTRAINT external_api_keys_platform_api_key_id_fkey FOREIGN KEY (platform_api_key_id) REFERENCES public.api_keys(id) ON DELETE CASCADE;


--
-- Name: external_api_keys external_api_keys_platform_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_api_keys
    ADD CONSTRAINT external_api_keys_platform_project_id_fkey FOREIGN KEY (platform_project_id) REFERENCES public.billing_projects(id) ON DELETE SET NULL;


--
-- Name: external_identity_links external_identity_links_platform_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.external_identity_links
    ADD CONSTRAINT external_identity_links_platform_user_id_fkey FOREIGN KEY (platform_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: image_assets image_assets_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.image_assets
    ADD CONSTRAINT image_assets_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.image_projects(id) ON DELETE CASCADE;


--
-- Name: image_assets image_assets_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.image_assets
    ADD CONSTRAINT image_assets_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.image_project_sessions(id) ON DELETE CASCADE;


--
-- Name: image_assets image_assets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.image_assets
    ADD CONSTRAINT image_assets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: image_generations image_generations_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.image_generations
    ADD CONSTRAINT image_generations_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.image_projects(id) ON DELETE SET NULL;


--
-- Name: image_generations image_generations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.image_generations
    ADD CONSTRAINT image_generations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: image_project_sessions image_project_sessions_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.image_project_sessions
    ADD CONSTRAINT image_project_sessions_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.image_projects(id) ON DELETE CASCADE;


--
-- Name: image_project_sessions image_project_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.image_project_sessions
    ADD CONSTRAINT image_project_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: image_projects image_projects_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.image_projects
    ADD CONSTRAINT image_projects_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: oauth_accounts oauth_accounts_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.oauth_accounts
    ADD CONSTRAINT oauth_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: password_resets password_resets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_resets
    ADD CONSTRAINT password_resets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: security_events security_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.security_events
    ADD CONSTRAINT security_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_files user_files_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_files
    ADD CONSTRAINT user_files_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_sessions user_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_sessions
    ADD CONSTRAINT user_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_settings user_settings_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_settings
    ADD CONSTRAINT user_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_usage user_usage_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_usage
    ADD CONSTRAINT user_usage_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
--




-- ---------------------------------------------------------------------
-- Cross-file FK restoration (ordering fix).
-- youtube-schema.sql (step 1) creates youtube_channels / youtube_channel_groups
-- BEFORE this baseline creates public.users (step 2), so those two user_id FKs
-- were removed from youtube-schema.sql (they cannot resolve on a virgin boot)
-- and are (re)attached here, after users exists. Guarded so they never error
-- if the tables are absent or the constraints already exist.
-- ---------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.youtube_channels') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'youtube_channels_user_id_fkey') THEN
    ALTER TABLE public.youtube_channels
      ADD CONSTRAINT youtube_channels_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
  IF to_regclass('public.youtube_channel_groups') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'youtube_channel_groups_user_id_fkey') THEN
    ALTER TABLE public.youtube_channel_groups
      ADD CONSTRAINT youtube_channel_groups_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- DOWN
-- Not reversible: this is a squashed snapshot of pre-existing production tables.
-- Dropping them would destroy money/identity data. To "undo", restore from backup.
