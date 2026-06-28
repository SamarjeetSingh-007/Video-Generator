#!/bin/bash
# Double-click this file to launch Video Generation Studio.
# It starts a local server, opens your browser, and stays running until you close this window.

# Always run from the folder this script lives in (handles spaces in the path).
cd "$(dirname "$0")" || exit 1

# Pick a free port starting at 8765.
PORT=8765
while lsof -i :"$PORT" >/dev/null 2>&1; do
  PORT=$((PORT + 1))
done

URL="http://localhost:$PORT/index.html"

echo "================================================"
echo "   🎬  Video Generation Studio"
echo "================================================"
echo ""
echo "   Serving from: $(pwd)"
echo "   URL:          $URL"
echo ""
echo "   Your browser will open automatically."
echo "   Keep this window open while you use the app."
echo "   To stop: close this window or press Ctrl+C."
echo ""
echo "================================================"

# Find a Python 3 interpreter.
if command -v python3 >/dev/null 2>&1; then
  PY=python3
elif command -v python >/dev/null 2>&1; then
  PY=python
else
  echo ""
  echo "❌ Python is not installed. Install it from https://www.python.org/downloads/ and try again."
  echo "Press any key to close."
  read -n 1 -s
  exit 1
fi

# Open the browser a moment after the server starts.
( sleep 1; open "$URL" ) &

# Start the server (this blocks until you close the window / Ctrl+C).
exec "$PY" -m http.server "$PORT"
