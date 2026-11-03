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

for repo in "$BIO" "$OFFICE"; do
  step "release glasses app $(basename "$repo")"
  (cd "$repo/app" && npm run release -- "$MSG") || {
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
