#!/usr/bin/env bash
# Test dymny gry w przeglądarce headless (Playwright). Uruchom z katalogu repo:  bash tools/testy/uruchom.sh [katalog_roboczy]
# Wymaga: node, python3 i Playwright (require('playwright') musi działać; na GitHubie robi to test.yml).
# Robi: kopia folderu site/ do katalogu roboczego -> serwer http na wolnym porcie -> smoke.cjs -> sprzątanie po PID.
# Gra nie ładuje bibliotek z sieci, więc nic nie trzeba podmieniać.
set -uo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-${TMPDIR:-/tmp}/wysepka-testy}"
mkdir -p "$OUT"
cd "$OUT" || exit 1
rm -rf ./www
rm -f ./*.png
cp -r "$REPO/site" ./www
PORT="${PORT:-$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')}"
(cd www && python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 & echo $! > "$OUT/serwer.pid")
PID="$(cat "$OUT/serwer.pid")"
trap 'kill "$PID" 2>/dev/null || true' EXIT
sleep 1
BASE="http://127.0.0.1:$PORT" node "$REPO/tools/testy/smoke.cjs" "$OUT"
