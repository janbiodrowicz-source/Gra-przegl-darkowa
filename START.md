# Wysepka — START (przekazanie pracy do zwykłego czatu)

Krótki przewodnik na jedną rozmowę. Szczegóły: `docs/PRZEKAZANIE.md` (decyzje i plan etapów 2–3), `README.md` (architektura, narzędzia), `.claude/CLAUDE.md` (skrót zasad).
Stan z 04.11.2026 (wersja 0.3.2). Rozmowa po polsku, krótko i czytelnie na telefonie.

## Kim jest Jan i jak pracujemy
- Jan pracuje **wyłącznie z telefonu**, nie czyta kodu. Potrzebuje gotowego rezultatu i krótkich odpowiedzi. Mów o sobie w formie żeńskiej, jeśli Jan o to prosił (tak jest w tym projekcie), z odrobiną humoru i emoji.
- **Polecenia do wklejenia zawsze w jednym bloku kodu** (jedno dotknięcie kopiuje całość).
- **Jeden krok na raz.** Po każdym kroku Jan sprawdza grę na telefonie i odpisuje zrzutem.
- **Nie scalaj z `main` bez wyraźnej zgody Jana** („Zgoda: scal do main”). Pracuj na osobnej gałęzi.
- Jeśli widzisz błąd albo lepsze rozwiązanie, powiedz to od razu. Nie rób zmian logiki gry bez prośby.

## Gra
Przytulny idle city builder na wyspach, czysty HTML5 (canvas 2D + SVG, bez bibliotek, bez bundlera, bez sieci), po polsku (EN też jest). Budujesz osadę, surowce rosną same (także offline do 8 h), zadania odblokowują budynki. Od 0.3.0 **archipelag**: port → zwiad statkiem → nowe wyspy z biomami (max 5), przełączanie między nimi. Cała grafika rysowana kodem.
**Adres gry:** https://wysepka.jasko4185.workers.dev (Cloudflare). Stary adres https://small-water-3eb2.jasko4185.workers.dev (ręczny ZIP) jest zamrożony.
Repo: `janbiodrowicz-source/Gra-przegl-darkowa` (publiczne).

## Wersje i gałęzie
- Gra leży w folderze **`site/`** (to jest publikowane); `tools/` i `docs/` nie trafiają na stronę.
- **`main`** to wersja produkcyjna: Cloudflare buduje ją sam po każdym wypchnięciu (Settings → Builds → Branch control → Production branch = `main`). Inne gałęzie dostają adresy podglądu (Preview builds).
- Aktualna praca była na gałęzi `ccr-7b241f7d-wcplv4`. Sprawdź `site/js/wersja.js` na `main`, żeby wiedzieć, jaka wersja jest wdrożona.

## Jak wdrażać (bez Claude Code, bez ZIP-a)
1. Zmień pliki w repo (np. konektorem GitHub w czacie) na osobnej gałęzi, wypchnij.
2. **Wersja podbija się sama.** Po wypchnięciu zmian w `site/` bez zmiany numeru GitHub (workflow „Podbij wersję”, `.github/workflows/podbij-wersje.yml`) dopisuje po ok. minucie commit „Automatyczne podbicie wersji do X” (następna łatka) we wszystkich miejscach naraz (`wersja.js` i `?v=`) i uruchamia test. **Nie podbijaj ręcznie**, chyba że chcesz większy skok: Actions → Podbij wersję → Run workflow z numerem (np. 0.4.0) albo konektorem GitHub (`actions_run_trigger`). **Po wypchnięciu odczekaj na ten commit, zanim wypchniesz kolejną zmianę na tę gałąź**, i pobierz gałąź na nowo. Skrypt `node tools/podbij-wersje.mjs` robi to samo na komputerze; `tools/auto-podbij.sh` to logika automatu.
3. Po zgodzie Jana scal do `main`. Cloudflare buduje w ok. minutę.
4. Jan sprawdza: `/js/wersja.js` ma nowy numer, potem gra na telefonie.
- **Czego zwykły czat NIE zrobi:** nie uruchomi gry, testów ani skryptów Node (`tools/balance.mjs`, `tools/podbij-wersje.mjs`, `tools/shots.mjs`). Przeliczenia balansu botem zleć Claude Code albo komuś z komputerem. Zwykły czat czyta wynik testu z pliku w repo (niżej).

## ZASADA: po każdym wypchnięciu sprawdź wynik testu
Czat nie dostaje powiadomienia o wyniku testu, więc **po każdym wypchnięciu kodu sam go sprawdź** i zgłoś Janowi zielony/czerwony (i co padło), zanim powiesz, że zmiana jest gotowa. Czerwony test = napraw przed dalszymi zmianami. Test uruchamia się po wypchnięciu na każdą gałąź.
- **Gdzie czytać wynik (zwykły czat):** plik **`OSTATNI-WYNIK.md` z gałęzi `wyniki-testow`** (zwykły odczyt pliku z repo, `ref=wyniki-testow`). GitHub zapisuje tam po każdym teście: wynik (`success`/`failure`), gałąź, commit, czas, link do przebiegu oraz listę testów logiki i test dymny (OK/FAIL). **Sprawdź, czy gałąź i commit w pliku zgadzają się z Twoim wypchnięciem** — plik opisuje ostatni test i nadpisuje go kolejny (po wypchnięciu zmiany w `site/` automat dopisuje jeszcze commit z podbiciem wersji, więc commit w pliku ma być **ten z podbiciem**, czyli najnowszy na gałęzi). Poczekaj 3–4 minuty (test trwa ok. 3 minuty, czasem dłużej przez kolejkę GitHuba); jeśli commit w pliku jest starszy, odczekaj i przeczytaj jeszcze raz.
- Jeśli masz narzędzia Actions (np. Claude Code): `actions_list` (`list_workflow_runs`, filtr `branch`) → `list_workflow_jobs` → `get_job_logs` z `return_content` i `tail_lines`.
- Jeśli plik nie przychodzi albo jest podejrzany, poproś Jana: „Test na GitHubie: zielony czy czerwony?” (Actions w repo) i przy czerwonym o wiersze FAIL.

## Okienko diagnostyczne i test
- **`?debug=1`** w adresie (np. `https://wysepka.jasko4185.workers.dev/?debug=1`): okienko z wersją, FPS, liczbą wysp i sprite'ów oraz ostatnimi błędami (zbieranymi od startu strony). Przycisk **Kopiuj** kopiuje raport do schowka, Jan wkleja go do czatu. Są też przyciski testowe (dodaj surowce, przewiń czas ×10, `clear errors`). Bez `?debug=1` okienka nie ma. Obiekty gry są w `window.__gra`.
- **Test dymny** (`tools/testy/smoke.cjs`, `uruchom.sh`, workflow `.github/workflows/test.yml`): Chromium headless sprawdza wczytanie gry, brak błędów i zapytań na zewnątrz, czas i surowce, budowanie i zapis, archipelag (3 wyspy, przełączanie, okna) i wczytanie starego zapisu v1; zrzuty są w artefakcie „zrzuty”. Lokalnie: `bash tools/testy/uruchom.sh` (wymaga Node i Playwright).
- Testy logiki: `node tools/test-core.mjs` (38 testów; liczą się też w workflow).

## Pułapka z `.gitignore`
Jeśli `.gitignore` zawiera wzorzec `.*` (ignoruj pliki z kropką), folder `.github` nigdy nie trafi do commita i GitHub nie zobaczy testu. Tu jest wyjątek `!.github` i nie wolno go usuwać. Sprawdzenie: `git check-ignore -v .github/workflows/test.yml` (brak wyniku = OK). Nowe pliki w folderach z kropką dodawaj z wyjątkiem albo `git add -f`. Jeśli GitHub nie widzi workflow: sprawdź to, potem w zakładce Actions kliknij „I understand my workflows, go ahead and enable them”.

## Mapa modułów (`site/js/`)
- `config.js` — **wszystkie dane i liczby balansu** (budynki, zadania, biomy, świat). `wersja.js` — numer wersji.
- `core/` — czysta logika bez DOM: `state`, `economy`, `sim` (tick, offline), `actions`, `quests`, `map` (generator wysp), `world` (archipelag: port, zwiad, kolonizacja).
- `save/save.js` — zapis v2 (świat), migracje (v1 → v2), kopia zapasowa.
- `game.js` — pętla, offline, autozapis; `main.js` — start; `platform.js` — puste hooki pod SDK portalu.
- `render/` — mapa izometryczna na canvasie (`art.js` budynki, `terrain.js` teren i biomy, `renderer.js`).
- `ui/` — HUD, karty, panel, okna (`islands.js` archipelag), ikony SVG; `lang/pl.js`, `lang/en.js` — teksty (oba muszą mieć te same klucze).
- Dodanie budynku: wpis w `config.js` + funkcja rysująca w `art.js` + ikona w `ui/icons.js` + teksty PL i EN.

## Zasady
- **Zasoby:** tylko własne, wszystko rysowane kodem; żadnych obcych plików ani bibliotek z sieci (gra nie wysyła zapytań na zewnątrz, test tego pilnuje).
- **Wydajność na telefonie:** canvas ≤ ~3 Mpx, DPR ≤ 2, sprite'y w cache, bez filtrów w pętli. Sprawdzaj FPS przez `?debug=1`.
- **Jedna zmiana na raz**, mała i sprawdzona na telefonie. Zmiana formatu zapisu = podbicie `saveVersion` + migracja w `save.js`.
- Każdą zmianę kodu opisz Janowi po polsku w 1–2 zdaniach.

## Plany i znane ograniczenia
- **Etap 2 (następny):** transport surowców między wyspami (jednorazowa wysyłka „na ratunek” i trasy automatyczne), wspólny skarbiec monet. **Etap 3:** rynek NPC (kupcy, zmienne ceny). Później: muzyka i ambient, SDK CrazyGames (`platform.js`), prestiż, ewentualny rynek graczy (wymaga serwera). Szczegóły: `docs/PRZEKAZANIE.md`.
- Wyspa domowa po ok. 45 min przelewa się surowcami, a nowe wyspy rosną wolno (brak transportu).
- Monety są na razie osobne na każdej wyspie. FPS mierzono bez GPU, więc warto sprawdzić na słabym Androidzie.

## Prompt na start nowej rozmowy
```
Przeczytaj START.md z repo janbiodrowicz-source/Gra-przegl-darkowa (gałąź main), potem w razie potrzeby docs/PRZEKAZANIE.md i README.md. Kontynuujemy grę Wysepka. Odpowiadaj po polsku, krótko, żeńskie formy mówiąc o sobie. Nie scalaj z main bez mojej zgody. Wersję podbija automat na GitHubie (nie rób tego ręcznie). Po każdym wypchnięciu czytaj wynik testu z OSTATNI-WYNIK.md na gałęzi wyniki-testow i pisz mi, czy przeszedł. Zaproponuj od czego zacząć i poczekaj na moją decyzję.
```
