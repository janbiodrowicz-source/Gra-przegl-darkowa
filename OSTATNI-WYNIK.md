# Ostatni test gry

- wynik: success
- gałąź: main
- commit: 1ac83c9893bf8dd8e59bd08a77b13fe41ac1b4cc
- czas: 2026-11-04 18:10:48 UTC
- przebieg: https://github.com/janbiodrowicz-source/Gra-przegl-darkowa/actions/runs/41883887783

## Testy logiki
```
  ✓ well aura boosts neighbouring fields (and stacks with levels)
  ✓ charm: decorations raise coin income and count for charm quests
  ✓ second wave unlocks follow the quest chain; old finished saves continue
  ✓ v1 saves migrate: tiles centred in the bigger grid, buildings shifted, resources kept
  ✓ port: on the sea by the shore (never on land or a pond), one per island
  ✓ scouting: needs a port, takes time, offers unowned biomes; colonising adds an island
  ✓ every island keeps working in the background and offline
  ✓ v2 save round-trip keeps islands, main/active and the scouting trip
  ✓ i18n: PL and EN have the same keys and plural forms work
  ✓ bus: listeners, wildcard, isolation of failures

38/38 passed in 251 ms
```

## Test dymny
```
OK   wersja.js dostępny — 0.3.4
     (testowana wersja: 0.3.4)
OK   nowa gra: wczytała się (is-ready)
OK   nowa gra: okienko ?debug=1 jest
OK   nowa gra: czas płynie — t=12.0s
OK   nowa gra: surowce rosną (drewno > 40) — drewno=42.4
OK   nowa gra: 1 wyspa, 1 chata — wyspy=1 budynki=1
OK   nowa gra: HUD i karty budynków — kart=13
OK   budowanie: pole postawione
OK   zapis: po odświeżeniu budynki wracają — budynki=2 status=loaded
OK   nowa gra: brak błędów
OK   archipelag: 3 wyspy — home,snow,tropic
OK   archipelag: port na wyspie głównej
OK   archipelag: zwiad wrócił z ofertami — oferty=2
OK   archipelag: okno wysp ma 3 wiersze
OK   archipelag: przełączenie na Mroźną Skałę
OK   archipelag: przełączenie na Rajską Lagunę
OK   archipelag: okno znalezionych wysp ma 2 oferty
OK   archipelag: brak błędów
OK   stary zapis v1: wczytany do nowej wersji — {"status":"loaded","wyspy":1,"q6":"active","drewno":121.77757999999993}
OK   stary zapis v1: surowce zachowane — drewno=122
OK   stary zapis: brak błędów

WYNIK: wszystko OK
```
