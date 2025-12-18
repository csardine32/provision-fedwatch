#!/usr/bin/env bash
set -euo pipefail

: "${SUPABASE_PROJECT_REF:=pzqeibaqlwmfglbiumjt}"
: "${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY is required}"

BASE_URL="https://${SUPABASE_PROJECT_REF}.supabase.co"

echo "Pinging scorer function..."
# If your function is protected, this should still return *something* (401/403 is still “reachable”).
status=$(curl -s -o /tmp/scorer_out.txt -w "%{http_code}" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H "apikey: ${SUPABASE_ANON_KEY}" \
  "${BASE_URL}/functions/v1/scorer")

echo "HTTP ${status}"
head -c 500 /tmp/scorer_out.txt || true
echo

# Accept any reachable HTTP response (200/401/403/etc). Fail only on network/URL issues.
if [[ "${status}" == "000" ]]; then
  echo "ERROR: curl failed (status 000). Check project ref, function name, or network."
  exit 1
fi

echo "Smoke test passed (endpoint reachable)."
