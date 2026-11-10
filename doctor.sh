#!/usr/bin/env bash
# What is actually live? Prints the code version on this Mac, the glucose
# setting, the app version, and what the Worker serves right now.
# Safe to paste anywhere: the token is never printed.
#   ~/even-realities/doctor.sh
cd "$(dirname "$0")" || exit 1
echo "code on this Mac : $(git log --oneline -1)"
echo "behind GitHub by : $(git fetch -q origin main 2>/dev/null; git rev-list --count HEAD..origin/main 2>/dev/null) commit(s)"
echo "app version      : $(grep -o '"version"[^,]*' app/app.json 2>/dev/null | head -1)"
n=$(grep -c '^GLUCOSE_URL' endpoint/wrangler.toml 2>/dev/null || true)
echo "GLUCOSE_URL lines: ${n:-0}  $(grep '^GLUCOSE_URL' endpoint/wrangler.toml 2>/dev/null | head -1 | sed 's#https\?://[^"]*#(a url)#')"
[ "${n:-0}" -gt 1 ] && echo "  PROBLEM: GLUCOSE_URL is in wrangler.toml more than once; the Worker deploy fails until one line is removed."
EP=$(grep '^VITE_HUD_ENDPOINT=' app/.env 2>/dev/null | cut -d= -f2- | tr -d '[:space:]"'"'"'')
TK=$(grep '^VITE_HUD_TOKEN=' app/.env 2>/dev/null | cut -d= -f2- | tr -d '[:space:]"'"'"'')
[ -n "$EP" ] || { echo "no endpoint in app/.env"; exit 1; }
EP=${EP%/state}
body=$(curl -s -m 10 -w '\n%{http_code}' -H "Authorization: Bearer $TK" "$EP/state")
code=${body##*$'\n'}; body=${body%$'\n'*}
echo "Worker /state    : HTTP $code"
printf '%s' "$body" | python3 -c '
import json, sys
try: s = json.load(sys.stdin)
except Exception: print("  (reply was not JSON)"); sys.exit()
g, d = s.get("glucose"), s.get("display")
print("  glucose        :", g if g else "NONE -> the Worker is not serving glucose (old Worker, or GLUCOSE_URL not set)")
print("  display        :", d if d else "NONE")
if not d or "face" not in d: print("  -> no face setting: this is the OLD Worker, the deploy did not go through")
print("  workout active :", s.get("workout", {}).get("active"))
'
