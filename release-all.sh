#!/usr/bin/env bash
# Ship everything: pull both repos, deploy both Workers, release both glasses
# apps to the Even Hub beta channel.
#   ~/even-realities/release-all.sh "what changed"
#   ~/even-realities/release-all.sh --apps-only "what changed"     skip the Workers
set -uo pipefail
MSG="Update"; APPS_ONLY=0
for a in "$@"; do case "$a" in --apps-only) APPS_ONLY=1;; *) MSG="$a";; esac; done
BIO="$HOME/even-realities"; OFFICE="$HOME/office-hud"
fail=0
step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

for repo in "$BIO" "$OFFICE"; do
  step "pull $(basename "$repo")"
  git -C "$repo" pull --ff-only || { echo "pull failed in $repo"; fail=1; }
done

if [ "$APPS_ONLY" = 0 ]; then
  for repo in "$BIO" "$OFFICE"; do
    step "deploy Worker $(basename "$repo")"
    (cd "$repo/endpoint" && npm run deploy) || { echo "Worker deploy failed in $repo"; fail=1; }
  done
fi

# Beta builds show only on phones whose Even account is on the app's tester
# list, and invites lapse after 7 days: re-add yourself on every release.
TESTER="${EVEN_TESTER:-$(git config --get user.email 2>/dev/null || true)}"
[ -f "$HOME/.even-tester" ] && TESTER=$(cat "$HOME/.even-tester")

# Re-add the tester for one app. Never fatal, never silent: a lapsed tester
# invite is the usual reason a beta build does not show on the phone.
add_tester() {
  [ -n "$TESTER" ] || { echo "no tester address: put your Even account email in ~/.even-tester"; return 0; }
  local pkg
  pkg=$(grep -o '"package_id"[[:space:]]*:[[:space:]]*"[^"]*"' app.json 2>/dev/null | head -1 | cut -d'"' -f4)
  [ -n "$pkg" ] || { echo "warning: could not read package_id from $(pwd)/app.json, tester not re-added"; return 0; }
  npx evenhub testers add "$TESTER" --package-id "$pkg" || echo "warning: could not re-add $TESTER as tester of $pkg (see above); the build is still on beta"
}

for repo in "$BIO" "$OFFICE"; do
  step "release glasses app $(basename "$repo")"
  (cd "$repo/app" && npm run release -- "$MSG" && add_tester) || {
    echo
    echo "Release failed in $repo/app. If it mentioned login or 401, run:  cd $repo/app && npx evenhub login   then run this script again."
    fail=1
  }
done

echo
if [ "$fail" = 0 ]; then
  echo "Both Workers deployed, both apps on beta. Phone: Even app > Even Hub tab > update Bio HUD and Office HUD."
else
  echo "Finished with errors, see above."
fi
exit $fail
