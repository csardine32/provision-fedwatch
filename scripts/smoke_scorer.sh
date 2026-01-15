#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_PROJECT_REF:?SUPABASE_PROJECT_REF is required}"
: "${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY is required}"

# Strip possible CRLF/whitespace from secrets.
SUPABASE_PROJECT_REF="$(echo -n "$SUPABASE_PROJECT_REF" | tr -d '\r' | xargs)"
SUPABASE_ANON_KEY="$(echo -n "$SUPABASE_ANON_KEY" | tr -d '\r')"

URL="https://${SUPABASE_PROJECT_REF}.supabase.co/functions/v1/scorer"

echo "Pinging scorer function..."
# If your function is protected, this should still return *something* (401/403 is still “reachable”).
echo "URL: ${URL}"
curl_exit=0
status=$(curl -sS -o /tmp/scorer_out.txt -w "%{http_code}" --max-time 15 \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  "${URL}") || curl_exit=$?

echo "HTTP ${status}"
head -c 500 /tmp/scorer_out.txt || true
echo

# Accept any reachable HTTP response (200/401/403/etc). Fail only on network/URL issues.
if [[ "${status}" == "000" || "${curl_exit}" -ne 0 ]]; then
  echo "ERROR: curl failed (status 000, exit ${curl_exit}). Check project ref, URL, or network."
  exit 1
fi

echo "Smoke test passed (endpoint reachable)."
