#!/usr/bin/env bash
# xeno-watch.sh — OFF-BOX availability alerting for xeno-platform-001.
#
# WHY THIS EXISTS
# xeno-platform-001 had no external alerting of any kind. Its own heartbeat.sh is
# a dead-man's-switch that needs a third-party monitor URL nobody had provisioned,
# and it had additionally been non-executable since 2026-07-14 (git stored the
# blob 100644, so a checkout stripped +x). During that window the nightly backup
# also failed every single night and nothing said so.
#
# A box cannot page you about its own death. This script therefore runs on a
# DIFFERENT machine — xeno-mail-001 — and watches the platform from outside,
# emailing through Resend, whose key is already live in the xeno-mail-core
# container and whose xenostudio.ai sending domain is verified.
#
# DESIGN NOTES
#  - Alerts on STATE CHANGE, not every run: an outage sends one mail, not one
#    every five minutes. Recovery sends exactly one "recovered" mail.
#  - Sends a weekly still-watching mail. Without it, silence is ambiguous — it
#    could mean "healthy" or "the watcher itself is dead", and that ambiguity is
#    the whole failure mode this replaces.
#  - The Resend key is read from the running container at call time and is never
#    written to disk, logged, or echoed.
#
# INSTALL (on xeno-mail-001, as root):
#   install -m 755 xeno-watch.sh /usr/local/bin/xeno-watch
#   ( crontab -l 2>/dev/null; echo '*/5 * * * * /usr/local/bin/xeno-watch >> /var/log/xeno-watch.log 2>&1' ) | crontab -
set -uo pipefail

TARGET_URL="${XENO_WATCH_URL:-https://xenostudio.ai/api/ready}"
ALERT_TO="${XENO_ALERT_TO:-support@xenostudio.ai}"
ALERT_FROM="${XENO_ALERT_FROM:-XENO Watch <alerts@xenostudio.ai>}"
STATE_DIR="/var/lib/xeno-watch"
STATE_FILE="$STATE_DIR/state"
LAST_OK_MAIL="$STATE_DIR/last-weekly"
FAIL_STREAK_FILE="$STATE_DIR/streak"
# Two consecutive failures before alerting, so one slow response is not an outage.
FAIL_THRESHOLD="${XENO_WATCH_THRESHOLD:-2}"
WEEKLY_SECS=$((7 * 24 * 3600))
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

mkdir -p "$STATE_DIR"

# Read the key out of the running container. Never persisted, never printed.
resend_key() {
  docker exec xeno-mail-core sh -c 'printf %s "${RESEND_API_KEY:-}"' 2>/dev/null
}

send_mail() {
  subject="$1"; body="$2"
  key="$(resend_key)"
  if [ -z "$key" ]; then
    echo "$TS xeno-watch: NO RESEND KEY available — cannot send: $subject" >&2
    return 1
  fi
  # Body and subject go through node's JSON encoder so quotes/newlines cannot
  # break the payload.
  RESEND_KEY="$key" WATCH_SUBJ="$subject" WATCH_BODY="$body" \
  WATCH_TO="$ALERT_TO" WATCH_FROM="$ALERT_FROM" \
  docker exec -e RESEND_KEY -e WATCH_SUBJ -e WATCH_BODY -e WATCH_TO -e WATCH_FROM \
    xeno-mail-core node -e '
      const payload = {
        from: process.env.WATCH_FROM,
        to: [process.env.WATCH_TO],
        subject: process.env.WATCH_SUBJ,
        text: process.env.WATCH_BODY,
      };
      fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + process.env.RESEND_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      })
        .then(r => r.text().then(t => {
          console.log("  resend HTTP " + r.status);
          if (r.status >= 300) console.log("  " + t.slice(0, 200));
          process.exit(r.status < 300 ? 0 : 1);
        }))
        .catch(e => { console.log("  resend failed: " + e.message); process.exit(1); });
    ' 2>&1
}

code="$(curl -s -o /dev/null -w '%{http_code}' -m 20 "$TARGET_URL" 2>/dev/null || echo 000)"
prev="$(cat "$STATE_FILE" 2>/dev/null || echo unknown)"
streak="$(cat "$FAIL_STREAK_FILE" 2>/dev/null || echo 0)"

if [ "$code" = "200" ]; then
  echo 0 > "$FAIL_STREAK_FILE"
  if [ "$prev" = "down" ]; then
    send_mail "[XENO] RECOVERED — xenostudio.ai is responding again" \
"xeno-watch on $(hostname) confirms recovery.

  target : $TARGET_URL
  status : HTTP 200
  at     : $TS

The previous alert can be considered closed."
  fi
  echo up > "$STATE_FILE"
  echo "$TS xeno-watch: up (HTTP $code)"

  # Weekly proof-of-life, so silence means something.
  last="$(cat "$LAST_OK_MAIL" 2>/dev/null || echo 0)"
  now="$(date +%s)"
  if [ $((now - last)) -ge $WEEKLY_SECS ]; then
    send_mail "[XENO] weekly check-in — platform healthy" \
"xeno-watch on $(hostname) is alive and the platform is healthy.

  target : $TARGET_URL
  status : HTTP 200
  at     : $TS

You receive this once a week so that silence from this watcher is meaningful:
if a week passes with no mail at all, the watcher itself has stopped." >/dev/null 2>&1 && echo "$now" > "$LAST_OK_MAIL"
  fi
else
  streak=$((streak + 1))
  echo "$streak" > "$FAIL_STREAK_FILE"
  echo "$TS xeno-watch: FAIL (HTTP $code) streak=$streak" >&2
  if [ "$streak" -ge "$FAIL_THRESHOLD" ] && [ "$prev" != "down" ]; then
    send_mail "[XENO] DOWN — xenostudio.ai is not responding" \
"xeno-watch on $(hostname) could not reach the platform.

  target        : $TARGET_URL
  status        : HTTP $code   (000 = no response at all)
  failed checks : $streak consecutive
  at            : $TS

This check runs from a different machine than the platform, so this alert also
fires when xeno-platform-001 itself is down or unreachable.

Worth checking, in order:
  1. ssh xeno-platform-001   — is the box up?
  2. docker ps               — are xenostudio-frontend / -backend running?
  3. /mnt/projects/xeno-platform/backups/backup.log — is the nightly backup ok?"
    echo down > "$STATE_FILE"
  fi
fi
