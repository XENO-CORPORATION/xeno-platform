-- UP
-- XENO-WORKFORCE-01 ASN-07 and ASN-08 -- a project's directory is a BINDING on a named host.
--
--   ASN-07: "Directory resource bindings include host/environment identity and canonical root.
--            Identical path strings on different machines are not the same resource. Host
--            realpath/symlink and platform permission enforcement remain authoritative."
--   ASN-08: "Keep existing project identities and personal/workspace ownership semantics.
--            Reconcile Interface directory projections and Platform `chat_projects` through
--            explicit ID mappings/bindings, not name/path equality. ... Research projects may have
--            no directory; Agent execution still requires an authorized execution root."
--   §12:    "Resource binding | project/session reference, host/environment ID, root canonical
--            identity, grant revision; path is not global ID"
--
-- Measured before writing: zero occurrences of canonical_root / host identity anywhere under
-- src/server, and nothing linking the Interface's `workspace.directories` projection to a
-- `chat_projects` row. The Interface resolves a project by path; the Platform has no path at all.
--
-- ── THE HOST IS AN AUTHENTICATED INSTALLATION, NOT A NAME ─────────────────────────────────────
-- `host_installation_id` is the DPoP key thumbprint (RFC 7638) of the installation that made the
-- binding -- the identity chat_agent_conversation_mappings already keys Agent conversations on, and
-- the one the route DERIVES from `req.auth.dpopJkt` rather than reading from a body. A hostname is
-- chosen by whoever runs the machine and two machines can share one; a key thumbprint cannot be
-- claimed without the key. So "identical path strings on different machines are not the same
-- resource" is a UNIQUE key over (host, root), and two hosts binding `C:\work\app` are two rows.
--
-- ── THE ROOT IS CANONICAL, AND THE HOST SAYS SO ───────────────────────────────────────────────
-- The Platform cannot resolve a path on someone else's machine, and pretending to would be the
-- thing ASN-07 forbids ("host realpath/symlink ... remain authoritative"). So the binding stores
-- the root AS THE HOST CANONICALIZED IT, plus the platform family it was canonicalized under.
-- What the Platform CAN refuse is a root that is visibly not canonical: relative, containing `.`
-- or `..` segments, a trailing separator, a doubled separator, or the wrong separator for its
-- family. A binding records a claim by an authenticated host about its own filesystem; it never
-- grants filesystem access, which the host enforces.
--
-- ── A BINDING IS A GRANT WITH A REVISION ──────────────────────────────────────────────────────
-- `revision` is §12's "grant revision": revoking a binding advances it, and a session that
-- captured a binding at revision N can tell that N is no longer live. Rebinding the same root on
-- the same host after revocation is a NEW row, so the history of what was bound when survives.
--
-- ── RESEARCH PROJECTS HAVE NO DIRECTORY ──────────────────────────────────────────────────────
-- chat_projects gains nothing: a project with no binding is a legitimate research project, not an
-- incomplete one. What changes is that AGENT EXECUTION needs a live binding to an authorized root
-- -- chat_project_execution_root() below answers that question, and answers NULL rather than
-- falling back to "some directory the host happens to have open".

CREATE TABLE project_directory_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES chat_projects(id) ON DELETE RESTRICT,
  -- The installation that bound it: a DPoP JWK thumbprint, base64url SHA-256, 43 characters.
  host_installation_id TEXT NOT NULL CHECK (host_installation_id ~ '^[A-Za-z0-9_-]{43}$'),
  -- The account the installation acted for. A thumbprint alone is a key, not a person.
  host_owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  -- The OIDC client the installation is (xeno-agent-interface, xeno-agent-cli, ...), for display
  -- and audit; NOT part of the identity -- the key is.
  host_client_id VARCHAR(128) NOT NULL CHECK (host_client_id ~ '^[a-zA-Z0-9._-]{1,128}$'),
  root_family TEXT NOT NULL CHECK (root_family IN ('posix','windows')),
  canonical_root TEXT NOT NULL CHECK (length(canonical_root) BETWEEN 1 AND 4096),
  label VARCHAR(200) CHECK (label IS NULL OR length(btrim(label)) > 0),
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','revoked')),
  revision BIGINT NOT NULL DEFAULT 1 CHECK (revision > 0),
  bound_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  revoked_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT project_directory_binding_state CHECK ((state = 'active') = (revoked_at IS NULL)),
  -- A POSIX root is absolute, single-slashed, has no dot segments and no trailing slash (except
  -- the root itself). A Windows root is a drive or a UNC share, backslashed, with the same rules.
  -- The HOST canonicalized it; these refuse only what could not have come from canonicalization.
  CONSTRAINT project_directory_binding_canonical CHECK (CASE root_family
    WHEN 'posix' THEN canonical_root ~ '^/' AND canonical_root !~ '//' AND canonical_root !~ '\\'
      AND canonical_root !~ '(^|/)\.\.?(/|$)' AND (canonical_root = '/' OR canonical_root !~ '/$')
    WHEN 'windows' THEN (canonical_root ~ '^[A-Za-z]:\\' OR canonical_root ~ '^\\\\[^\\]+\\[^\\]+')
      AND canonical_root !~ '/' AND substr(canonical_root, 3) !~ '\\\\'
      AND canonical_root !~ '(^|\\)\.\.?(\\|$)' AND (canonical_root ~ '^[A-Za-z]:\\$' OR canonical_root !~ '\\$')
  END)
);

-- Windows paths compare case-insensitively on the filesystem that produced them, POSIX paths do
-- not. The uniqueness key follows the family, so `C:\Work` and `C:\work` on one Windows host are
-- one resource while `/Work` and `/work` on Linux are two.
CREATE UNIQUE INDEX project_directory_bindings_live_root
  ON project_directory_bindings(host_installation_id,
    (CASE WHEN root_family = 'windows' THEN lower(canonical_root) ELSE canonical_root END))
  WHERE state = 'active';
CREATE INDEX project_directory_bindings_project ON project_directory_bindings(project_id, state, created_at DESC);
CREATE INDEX project_directory_bindings_host ON project_directory_bindings(host_owner_user_id, host_installation_id, state);

CREATE FUNCTION project_directory_binding_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP IN ('DELETE','TRUNCATE') THEN
    RAISE EXCEPTION 'directory binding history is retained; revoke instead' USING ERRCODE='23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.state <> 'active' OR NEW.revision <> 1 THEN
      RAISE EXCEPTION 'a directory binding starts active at revision 1' USING ERRCODE='23514';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM chat_projects WHERE id = NEW.project_id AND NOT is_archived) THEN
      RAISE EXCEPTION 'an archived project admits no new directory binding' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF to_jsonb(NEW) = to_jsonb(OLD) THEN RETURN NEW; END IF;
  -- Account erasure clears attribution only.
  IF (to_jsonb(NEW) - ARRAY['bound_by_user_id','revoked_by_user_id']) = (to_jsonb(OLD) - ARRAY['bound_by_user_id','revoked_by_user_id'])
     AND (NEW.bound_by_user_id IS NOT DISTINCT FROM OLD.bound_by_user_id
          OR (NEW.bound_by_user_id IS NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id = OLD.bound_by_user_id)))
     AND (NEW.revoked_by_user_id IS NOT DISTINCT FROM OLD.revoked_by_user_id
          OR (NEW.revoked_by_user_id IS NULL AND NOT EXISTS (SELECT 1 FROM users WHERE id = OLD.revoked_by_user_id))) THEN
    RETURN NEW;
  END IF;
  -- The identity of a binding is its project, host and root. Re-pointing any of them is a
  -- DIFFERENT binding wearing an old one's revision; revoke and bind again.
  IF ROW(NEW.id, NEW.project_id, NEW.host_installation_id, NEW.host_owner_user_id, NEW.host_client_id,
         NEW.root_family, NEW.canonical_root, NEW.bound_by_user_id, NEW.created_at)
     IS DISTINCT FROM ROW(OLD.id, OLD.project_id, OLD.host_installation_id, OLD.host_owner_user_id, OLD.host_client_id,
         OLD.root_family, OLD.canonical_root, OLD.bound_by_user_id, OLD.created_at) THEN
    RAISE EXCEPTION 'a directory binding''s project, host and root are immutable; revoke and bind again' USING ERRCODE='23514';
  END IF;
  IF OLD.state = 'revoked' OR NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'a directory binding''s state or revision cannot regress' USING ERRCODE='23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER project_directory_bindings_guard
BEFORE INSERT OR UPDATE OR DELETE ON project_directory_bindings
FOR EACH ROW EXECUTE FUNCTION project_directory_binding_guard();
CREATE TRIGGER project_directory_bindings_no_truncate
BEFORE TRUNCATE ON project_directory_bindings
FOR EACH STATEMENT EXECUTE FUNCTION project_directory_binding_guard();

-- ASN-08's last sentence as ONE function: where may Agent execution run for this project, on this
-- host? A live binding on THIS installation, or nothing. Never another host's binding (same path,
-- different machine), never a revoked one, never "the first directory the project has anywhere".
-- NULL is an answer: a research project, or a project not bound on this machine.
CREATE FUNCTION chat_project_execution_root(project UUID, installation TEXT)
RETURNS TABLE(binding_id UUID, root_family TEXT, canonical_root TEXT, revision BIGINT)
LANGUAGE sql STABLE AS $$
  SELECT b.id, b.root_family, b.canonical_root, b.revision
    FROM project_directory_bindings b
    JOIN chat_projects p ON p.id = b.project_id AND NOT p.is_archived
   WHERE b.project_id = project AND b.host_installation_id = installation AND b.state = 'active'
   ORDER BY b.created_at DESC
$$;

DO $harden$
DECLARE fn TEXT;
BEGIN
  FOREACH fn IN ARRAY ARRAY['project_directory_binding_guard()','chat_project_execution_root(uuid,text)'] LOOP
    EXECUTE format('ALTER FUNCTION %I.%s SET search_path = %I, pg_temp', current_schema(), fn, current_schema());
  END LOOP;
END $harden$;

-- DOWN
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM project_directory_bindings) THEN
    RAISE EXCEPTION 'directory binding rollback refused: retained bindings exist' USING ERRCODE='23514';
  END IF;
END $$;
DROP FUNCTION chat_project_execution_root(UUID, TEXT);
DROP TRIGGER project_directory_bindings_no_truncate ON project_directory_bindings;
DROP TRIGGER project_directory_bindings_guard ON project_directory_bindings;
DROP FUNCTION project_directory_binding_guard();
DROP TABLE project_directory_bindings;
