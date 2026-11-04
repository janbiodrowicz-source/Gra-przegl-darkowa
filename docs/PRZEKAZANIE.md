# 🧭 Przekazanie projektu „Wysepka” — stan, decyzje, plan

Ten plik to decyzje z Janem i szczegółowy plan etapów 2–3. **Przewodnik na start rozmowy jest w `START.md`** (jak pracujemy, wdrażanie, testy).
Szczegóły techniczne (architektura, sterowanie, narzędzia) są w `README.md`.

_Stan na: 04.11.2026, wersja gry 0.3.2._

---

## 1. Czym jest gra

Przytulny **idle city builder** na wyspach, czysty HTML5 (bez bibliotek, bez sieci, bez bundlera).
Cel: publikacja na CrazyGames / itch.io. Działa online na Cloudflare (Workers ze statycznymi plikami z folderu `site/`):
https://wysepka.jasko4185.workers.dev

**Wdrażanie:** wypchnięcie na `main` → Cloudflare buduje sam w ok. minutę (bez ZIP-a). Stary adres
`small-water-3eb2…` (ręczny ZIP) jest zamrożony.

## 2. Co już jest (zrobione)

| Etap | Zawartość |
|---|---|
| 0.1 | silnik, zapis + offline (8 h), UI, mapa izometryczna, grafika rysowana kodem, balans 15 min |
| 0.2 | poprawki z telefonu (większa wyspa w pionie, czytelny „brak” na kartach); 6 budynków drugiej fali (rybak, studnia, młyn, piekarnia, klomb, fontanna), aura, urok, zadania q6–q14 |
| 0.3 | **archipelag, etap 1**: port (na wodzie przy brzegu), zwiad, 5 wysp z biomami, przełączanie, wyspa główna, zapis v2 z migracją, zadania q15–q18 |

Pełna gra to dziś ok. **1:45–2:00 h** do zdobycia całego archipelagu (18 zadań).

## 3. Decyzje podjęte z właścicielem gry (NIE zmieniać bez pytania)

1. **Archipelag zamiast prestiżu z resetem.** Stare wyspy zostają i pracują; gracz przełącza się między nimi.
2. **Maksymalnie 5 wysp** (na początek): startowa + 4 biomy (Zielony Gaj — drewno, Mroźna Skała — kamień,
   Rajska Laguna — ryby/monety, Złote Pola — żywność). Każdy biom raz.
3. **Wyspa główna** — wybierana przez gracza (★), od niej zawsze startuje gra.
4. **Nowe wyspy:** zwiad statkiem z portu → 2–3 wyspy do wyboru → kolonizacja za surowce (+ paczka startowa).
5. **Surowce i magazyny osobne na każdej wyspie, monety WSPÓLNE** (jeden skarbiec) — _skarbiec jeszcze
   niezrobiony, wchodzi w etapie 2_.
6. **Transport surowców:** automatyczne trasy **i** jednorazowa wysyłka „na ratunek”.
7. **Rynek: najpierw systemowy (kupcy NPC)**, rynek z innymi graczami — **później** (wymaga serwera).
8. Zadania wspólne dla całego archipelagu + (w planie) krótkie zadania dla każdej wyspy.
9. Styl pracy: po każdym kroku testy, zrzuty, krytyczna ocena, commit + push (Cloudflare wdraża sam z `main`).
   Odpowiedzi po polsku, z humorem i emoji 😉

## 4. Plan dalszej pracy

### Etap 2 — transport i wspólny skarbiec (NASTĘPNY)
- **Wspólne monety:** `world.coins` zamiast `res.coins` na każdej wyspie. Najprostsza droga: przed każdą
  akcją/tickiem wyspy podstawić skarbiec do `state.res.coins`, a potem zebrać go z powrotem
  (albo przepisać `pay/grant/canAfford` tak, by dla `coins` sięgały do świata). Limit skarbca = suma
  limitów wysp. Migracja zapisu v2 → v3 (zsumować monety wysp).
- **Wysyłka jednorazowa:** z panelu portu (albo z okna archipelagu): wyspa-cel, surowiec, ilość →
  statek płynie (czas ~ odległość, np. 30–120 s), ładunek dociera do magazynu celu (z limitem).
  Wymaga portu na obu wyspach. W `world`: lista `shipments: [{ from, to, res, amount, left }]`,
  liczona w `tickWorld` i offline (`simulateWorld`).
- **Trasy automatyczne:** `routes: [{ from, to, res, keepAbove, every }]` — „wysyłaj nadwyżkę ponad X”,
  zawsze najpierw ratuj wyspę z głodem. Pojemność ładunku zależy od poziomu portu.
- **UI:** przycisk „Wyślij” przy wyspie w oknie archipelagu, prosty formularz (3 suwaki/przyciski,
  bez tabel), lista tras z przełącznikiem wł./wył.
- **Bot:** ma wysyłać nadwyżki z wyspy domowej na najnowszą wyspę; sprawdzić, czy kolejne wyspy rosną szybciej.
- Problem, który to rozwiąże: wyspa domowa po ~45 min ma pełne magazyny, a nowe wyspy startują od zera.

### Etap 3 — rynek NPC
- Sprzedaż nadwyżek za monety, kupno brakujących surowców. Ceny zmienne w czasie (popyt/podaż,
  np. im więcej sprzedajesz kamienia, tym taniej), dzienny limit, okazyjne „wizyty kupca”.
- Budynek „Targowisko portowe” albo zakładka w porcie.

### Później
- Muzyka i ambient (morze, mewy) — WebAudio, bez plików z sieci.
- Integracja SDK CrazyGames w `js/platform.js` (komentarze `SDK:` wskazują miejsca; reklamy nagradzane
  np. ×2 na powrocie, ×2 produkcji na 10 min).
- Ewentualnie rynek graczy (Cloudflare Workers + baza), prestiż po pełnym archipelagu, wyspa wulkaniczna.

## 5. Znane problemy i ryzyka

- Wyspa domowa przelewa się surowcami od ~45 min (bot) — do czasu etapu 2/3 brak ujść.
- Nowe wyspy rosną na starcie wolno (paczka startowa pomaga tylko trochę).
- FPS mierzone w kontenerze bez GPU — warto sprawdzić na słabym Androidzie.
- Szczegóły w `README.md` → „Znane braki”.

## 6. Jak pracować dalej — trzy drogi

### A) Claude Code (najwygodniej, wymaga płatnego planu)
Nowa sesja z dostępem do repo `janbiodrowicz-source/Gra-przegl-darkowa`. Na start:
_„Przeczytaj START.md, docs/PRZEKAZANIE.md i README.md, kontynuujemy od etapu 2”._
Claude sam uruchamia testy, zrzuty i bota oraz commituje; wdrożenie robi Cloudflare po scaleniu do `main`.

### B) Zwykły czat (darmowy plan) — da się, ale ręcznie
Czat nie ma dostępu do repo ani do uruchamiania kodu, a limity są mniejsze. Dlatego:
1. Wklej `START.md` (i ten plik) na początku rozmowy albo użyj promptu ze `START.md`.
2. Wklejaj **tylko pliki potrzebne do zadania** (cały kod to ~9 400 linii — za dużo naraz):

| Zadanie | Pliki do wklejenia |
|---|---|
| zmiana liczb balansu, nowe zadanie | `js/config.js`, `js/lang/pl.js` (i `en.js`) |
| nowy budynek | `js/config.js`, fragment `js/render/art.js` (jedna funkcja jako wzór), `js/ui/icons.js`, `js/lang/pl.js` |
| archipelag / transport | `js/core/world.js`, `js/config.js` (sekcja `WORLD`), `js/ui/islands.js`, `js/save/save.js` |
| ekonomia, produkcja | `js/core/economy.js`, `js/core/sim.js` |
| wygląd okien i przycisków | `styles.css` (odpowiednia sekcja), plik z `js/ui/` |

3. Poproś o **gotowe fragmenty do podmiany** (cały plik albo „zamień X na Y”), potem wklej je w
   GitHubie (przycisk ✏️ przy pliku → „Commit changes”).
4. Testy uruchomisz na komputerze z Node 18+: `node tools/test-core.mjs`, `node tools/balance.mjs`;
   grę lokalnie: `node tools/serve.mjs` → http://127.0.0.1:8080/
5. Po scaleniu do `main` Cloudflare wdraża sam (patrz `START.md`); ZIP-a już nie trzeba.

### C) Bez Claude
Kod jest opisany w `README.md` („Jak rozbudowywać”): nowy budynek, nowe zadanie, nowy język,
zmiana formatu zapisu — wszystko krok po kroku.

## 7. Najważniejsze liczby (stan 0.3.0)

- Siatka każdej wyspy 20×20, wyspa startowa ~105 pól lądu, biomy 140–195.
- Zwiad 150 s (×1.35 za każdą posiadaną wyspę, port +15%/poziom szybciej), koszt 150 drewna, 120 żywności, 200 monet.
- Kolonizacja 300 drewna / 200 kamienia / 150 żywności / 500 monet, ×1.35 za każdą kolejną wyspę.
- Przed kolejnym rejsem najnowsza wyspa musi mieć 20 mieszkańców.
- Tempo bota (aktywny): port ~45 min, 2. wyspa ~48 min, 5. wyspa ~81 min.
