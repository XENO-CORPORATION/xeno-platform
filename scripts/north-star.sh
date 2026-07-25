#!/usr/bin/env bash
# north-star.sh — the XENO platform North-Star funnel, from PRIMARY tables (read-only).
#
# WHY: every number in the fundraise must be real, sourced, dated (close-list M2). Client-side
# analytics events can be lost or faked; the primary tables cannot: users (signups),
# api_usage_logs (activation + weekly activity), credit_grants kind='paid' (paying users).
# Run anytime: prints the dated funnel + 8-week trend. Cron-able (read-only, cheap).
#
# Usage (on xeno-platform-001):  sudo /mnt/projects/xeno-platform/scripts/north-star.sh
set -uo pipefail

PSQL="docker exec xenostudio-postgres psql -U postgres -d xenostudio -tAc"

echo "================ XENO NORTH-STAR REPORT ================"
echo "generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)  (source: primary tables, read-only)"
echo ""

row(){ $PSQL "$1" 2>/dev/null | tr '|' '\t'; }

echo "── Funnel (all-time / 30d / 7d) ──"
echo -e "signups:\t$(row "SELECT count(*), count(*) FILTER (WHERE created_at > now()-interval '30 days'), count(*) FILTER (WHERE created_at > now()-interval '7 days') FROM users")"
echo -e "activated:\t$(row "WITH f AS (SELECT user_id, min(created_at) fu FROM api_usage_logs GROUP BY user_id) SELECT count(*), count(*) FILTER (WHERE fu > now()-interval '30 days'), count(*) FILTER (WHERE fu > now()-interval '7 days') FROM f")"
echo -e "active (MAU/WAU):\t$(row "SELECT count(DISTINCT user_id) FILTER (WHERE created_at > now()-interval '30 days'), count(DISTINCT user_id) FILTER (WHERE created_at > now()-interval '7 days') FROM api_usage_logs")"
echo -e "paying users:\t$(row "SELECT count(DISTINCT user_id), count(DISTINCT user_id) FILTER (WHERE created_at > now()-interval '30 days') FROM credit_grants WHERE kind='paid'")"
echo -e "paid volume (credits):\t$(row "SELECT COALESCE(round(sum(amount_micro)/1000000.0,2),0) FROM credit_grants WHERE kind='paid'")"
echo ""

echo "── 8-week trend (week / signups / WAU) ──"
$PSQL "WITH w AS (SELECT generate_series(date_trunc('week', now()) - interval '7 weeks', date_trunc('week', now()), interval '1 week') ws)
SELECT to_char(w.ws,'YYYY-MM-DD'),
       (SELECT count(*) FROM users u WHERE u.created_at >= w.ws AND u.created_at < w.ws + interval '1 week'),
       (SELECT count(DISTINCT l.user_id) FROM api_usage_logs l WHERE l.created_at >= w.ws AND l.created_at < w.ws + interval '1 week')
FROM w ORDER BY 1" 2>/dev/null | tr '|' '\t'
echo ""

echo "── Data hygiene: top 10 users by usage rows (eyeball internal/test accounts) ──"
$PSQL "SELECT l.user_id, left(coalesce(u.email,'?'),3)||'***', count(*), min(l.created_at)::date, max(l.created_at)::date
FROM api_usage_logs l LEFT JOIN users u ON u.id=l.user_id
GROUP BY 1,2 ORDER BY 3 DESC LIMIT 10" 2>/dev/null | tr '|' '\t'
echo ""
echo "NOTE: totals include internal/test accounts — subtract known-internal users before"
echo "citing externally. Paying = credit_grants kind='paid' (the money-in path writes these)."
echo "========================================================="
