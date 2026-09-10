#!/usr/bin/env bash
#
# The whole design of this app is that provider keys stay out of the browser
# and out of git: data/ is ignored, the settings API returns a masked hint and
# never a key. This is the check that the design is not undone by a paste into
# a test fixture, a doc example or a commit message.
#
# It reads added lines only. A key already in history is a different problem —
# rotate it — and failing every later pull request on it helps nobody.
#
# Kept to POSIX-ish bash (no associative arrays) so it runs the same on a
# developer's macOS bash 3.2 as on the runner.
set -euo pipefail

BASE="${1:-}"

# An empty or all-zero base means there is nothing to compare against: a new
# branch, or a first push. Scan the whole tree rather than nothing at all.
if [ -z "$BASE" ] || printf '%s' "$BASE" | grep -qE '^0+$'; then
  echo "No usable base commit — scanning the tracked tree."
  SCANNED=$(git ls-files -z | xargs -0 grep -nHI '' || true)
else
  echo "Scanning lines added since $(printf '%.12s' "$BASE")."
  SCANNED=$(git diff --unified=0 --no-color "$BASE...HEAD" -- . | grep '^+' | grep -v '^+++' || true)
fi

fail=0
report() {
  printf '\n::error::%s\n%s\n' "$1" "$2"
  fail=1
}

#
# Real key shapes, deliberately narrow. The suite uses invented values like
# sk-test-000000000000000000000000004f2a, and a check that cries wolf at its
# own fixtures is one people learn to ignore.
#
# One "label|regex" per line. Labels carry no pipe.
PATTERNS='OpenAI project key|sk-proj-[A-Za-z0-9_-]{20,}
OpenAI key|sk-[A-Za-z0-9]{40,}
Anthropic key|sk-ant-[A-Za-z0-9_-]{20,}
Google API key|AIza[A-Za-z0-9_-]{30,}
xAI key|xai-[A-Za-z0-9]{20,}
AWS access key id|AKIA[A-Z0-9]{16}
private key block|-----BEGIN [A-Z ]*PRIVATE KEY-----'

while IFS='|' read -r label pattern; do
  [ -z "$label" ] && continue
  # -e, because a pattern starting with a dash is otherwise read as options.
  hits=$(printf '%s\n' "$SCANNED" | grep -nE -e "$pattern" || true)
  if [ -n "$hits" ]; then
    report "Looks like a real $label was committed. Rotate it, then take it out of the diff." "$hits"
  fi
done <<PATTERN_LIST
$PATTERNS
PATTERN_LIST

# The key database and .env are gitignored, but --force exists.
tracked=$(git ls-files -- 'data/**' '.env' '.env.*' || true)
if [ -n "$tracked" ]; then
  report "Files that must never be tracked are in the index:" "$tracked"
fi

if [ "$fail" -eq 1 ]; then
  printf '\nNothing here reaches a provider in CI, so a leaked key is leaked, not tested.\n'
  exit 1
fi

echo "No credentials found in the scanned lines."
