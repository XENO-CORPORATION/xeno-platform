-- Browser authentication is a server-held BFF session. The browser receives
-- only an opaque HttpOnly cookie and a separate readable CSRF value; API bearer
-- tokens remain inside the server process.

CREATE TABLE IF NOT EXISTS browser_session_state (
  sid         uuid PRIMARY KEY REFERENCES user_sessions(id) ON DELETE CASCADE,
  csrf_hash   text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  rotated_at  timestamptz NOT NULL DEFAULT now()
);
