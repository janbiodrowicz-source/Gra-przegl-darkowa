#!/usr/bin/env bash
# Automatyczne podbijanie wersji (wywołuje je workflow „Podbij wersję”, można też uruchomić ręcznie).
# Zmienne: BEFORE (commit przed wypchnięciem), MANUAL=true (ręczne uruchomienie), FORCE (np. 0.4.0).
#  - ręcznie: FORCE jeśli podano, inaczej następna łatka;
#  - po wypchnięciu zmian w site/ bez zmiany numeru wersji: następna łatka;
#  - w pozostałych przypadkach tylko ujednolica ?v= z bieżącym numerem (np. nowy plik bez ?v=).
# Nic nie commituje — to robi workflow.
set -euo pipefail
cd "$(dirname "$0")/.."
wersja() { sed -n "s/.*WERSJA = '\([^']*\)'.*/\1/p"; }
teraz="$(wersja < site/js/wersja.js)"
BEFORE="${BEFORE:-}"
MANUAL="${MANUAL:-false}"
FORCE="${FORCE:-}"

if [ "$MANUAL" = "true" ]; then
  node tools/podbij-wersje.mjs "${FORCE:-patch}"
  exit 0
fi

if [ -n "$BEFORE" ] && ! [[ "$BEFORE" =~ ^0+$ ]] && git cat-file -e "$BEFORE^{commit}" 2>/dev/null; then
  przed="$(git show "$BEFORE:site/js/wersja.js" 2>/dev/null | wersja || true)"
  zmiany="$(git diff --name-only "$BEFORE" HEAD -- site ':!site/_headers' ':!site/js/wersja.js' || true)"
  if [ -n "$zmiany" ] && [ "$przed" = "$teraz" ]; then
    echo "Zmieniono kod bez podbicia wersji ($teraz):"
    echo "$zmiany"
    node tools/podbij-wersje.mjs patch
    exit 0
  fi
fi
node tools/podbij-wersje.mjs "$teraz"
