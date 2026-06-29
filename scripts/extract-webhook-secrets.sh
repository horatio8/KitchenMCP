#!/usr/bin/env bash
# Pull every Kitchen webhook in the workspace and emit the env-var
# assignments needed by the kitchen-mcp-server webhook receiver.
#
# The script derives each variable name from the webhook URL's category
# segment (.../webhooks/kitchen/<category>), so adding more categories
# in Kitchen just works without changes here.
#
# Usage:
#   KITCHEN_API_KEY=...            (Bearer token from Settings → API Tokens)
#   KITCHEN_WORKSPACE=teller        (subdomain in <workspace>.kitchen.co)
#   ./scripts/extract-webhook-secrets.sh                   # dotenv lines
#   ./scripts/extract-webhook-secrets.sh --vercel-cli      # vercel env commands
#   ./scripts/extract-webhook-secrets.sh --project NAME    # Vercel project (default kitchen-mcp-dugd)
#   ./scripts/extract-webhook-secrets.sh --base-path PATH  # webhook URL prefix to match
#
# Requires: bash, curl, and either jq OR python3 (auto-detected).

set -euo pipefail

WORKSPACE="${KITCHEN_WORKSPACE:-}"
API_KEY="${KITCHEN_API_KEY:-}"
MODE="dotenv"
VERCEL_PROJECT="kitchen-mcp-dugd"
BASE_PATH="/webhooks/kitchen/"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --vercel-cli) MODE="vercel-cli"; shift ;;
    --project) VERCEL_PROJECT="$2"; shift 2 ;;
    --base-path) BASE_PATH="$2"; shift 2 ;;
    -h|--help) sed -n '2,/^set -e/p' "$0" | sed -e 's/^# //' -e 's/^#$//' | head -n 20; exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$WORKSPACE" || -z "$API_KEY" ]]; then
  echo "error: set KITCHEN_API_KEY and KITCHEN_WORKSPACE first" >&2
  echo "  e.g. KITCHEN_API_KEY=... KITCHEN_WORKSPACE=teller $0" >&2
  exit 2
fi

# Pick a JSON parser.
if command -v jq >/dev/null 2>&1; then
  PARSER="jq"
elif command -v python3 >/dev/null 2>&1; then
  PARSER="python3"
else
  echo "error: need either jq or python3 on PATH" >&2
  exit 2
fi

extract_pairs() {
  # Reads a Kitchen webhooks-list JSON page on stdin.
  # Emits TAB-separated lines: <category> <secret> <url>
  # Skips webhooks whose URL doesn't match BASE_PATH.
  local base_path="$1"
  if [[ "$PARSER" == "jq" ]]; then
    jq -r --arg bp "$base_path" '
      .data[] |
      select(.url | contains($bp)) |
      ((.url | capture("(?<bp>" + ($bp|gsub("/";"\\/")) + ")(?<cat>[^/?#]+)").cat // "")) as $cat |
      "\($cat)\t\(.secret)\t\(.url)"
    '
  else
    python3 - "$base_path" <<'PY'
import json, sys
base = sys.argv[1]
data = json.load(sys.stdin).get("data", [])
for w in data:
    url = w.get("url", "")
    idx = url.find(base)
    if idx < 0: continue
    rest = url[idx+len(base):]
    cat = rest.split("/", 1)[0].split("?", 1)[0].split("#", 1)[0]
    if not cat: continue
    print(f"{cat}\t{w.get('secret','')}\t{url}")
PY
  fi
}

# Loop pages.
PAGE=1
PAIRS=""
while true; do
  RESP=$(curl -fsS \
    -H 'Accept: application/json' \
    -H "Authorization: Bearer $API_KEY" \
    -H 'X-Requested-With: XMLHttpRequest' \
    "https://${WORKSPACE}.kitchen.co/api/webhooks?per_page=100&page=${PAGE}")
  PAGE_PAIRS=$(echo "$RESP" | extract_pairs "$BASE_PATH" || true)
  if [[ -n "$PAGE_PAIRS" ]]; then
    PAIRS+="$PAGE_PAIRS"$'\n'
  fi
  # Stop when the API tells us there's no next page.
  if [[ "$PARSER" == "jq" ]]; then
    HAS_NEXT=$(echo "$RESP" | jq -r '.links.next // ""')
  else
    HAS_NEXT=$(echo "$RESP" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("links",{}).get("next","") or "")')
  fi
  [[ -z "$HAS_NEXT" ]] && break
  PAGE=$((PAGE+1))
done

if [[ -z "${PAIRS//[$'\t\r\n ']}" ]]; then
  echo "no webhooks matched '$BASE_PATH' on https://${WORKSPACE}.kitchen.co" >&2
  exit 1
fi

# Render output.
case "$MODE" in
  dotenv)
    echo "# Paste into Vercel → kitchen-mcp-dugd → Settings → Environment Variables"
    echo "# (Production scope). Then redeploy."
    echo
    while IFS=$'\t' read -r cat secret url; do
      [[ -z "$cat" ]] && continue
      cat_upper=$(printf '%s' "$cat" | tr '[:lower:]' '[:upper:]')
      printf 'KITCHEN_WEBHOOK_SECRETS_%s=%s\n' "$cat_upper" "$secret"
    done <<<"$PAIRS" | sort -u
    ;;
  vercel-cli)
    echo "# Run with the Vercel CLI installed and \`vercel link\` already done."
    echo "# Each command will prompt you to choose env scope; pick Production."
    echo
    while IFS=$'\t' read -r cat secret url; do
      [[ -z "$cat" ]] && continue
      cat_upper=$(printf '%s' "$cat" | tr '[:lower:]' '[:upper:]')
      printf 'printf "%%s" "%s" | vercel env add KITCHEN_WEBHOOK_SECRETS_%s production --project %s\n' \
        "$secret" "$cat_upper" "$VERCEL_PROJECT"
    done <<<"$PAIRS" | sort -u
    ;;
esac
