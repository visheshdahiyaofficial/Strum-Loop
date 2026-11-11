#!/bin/bash
# Double-click this file to start StrumLoop and open it in your browser.
# Keep the Terminal window that appears open while you use the app; close it to stop.

cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
PORT="${PORT:-5183}"
URL="http://localhost:$PORT"
show() { [ -n "$STRUMLOOP_NO_OPEN" ] || open "$URL"; }

# Already running (for example from an earlier double-click)? Just open it.
if curl -s -o /dev/null --max-time 2 "$URL"; then
  echo "StrumLoop is already running at $URL"
  show
  exit 0
fi

if ! command -v npm >/dev/null; then
  echo "Node.js is needed to run StrumLoop but was not found. Install it from https://nodejs.org and try again."
  read -r -p "Press Return to close."
  exit 1
fi

[ -d node_modules ] || npm install

# Open the browser as soon as the app answers.
(
  for _ in $(seq 1 60); do
    if curl -s -o /dev/null --max-time 1 "$URL"; then show; exit 0; fi
    sleep 0.5
  done
) &

echo "Starting StrumLoop at $URL — leave this window open. Close it (or press Ctrl+C) to stop."
exec npm run dev -- --port "$PORT" --strictPort --host
