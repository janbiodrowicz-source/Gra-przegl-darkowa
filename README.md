# 🏝️ Wysepka (Tiny Isle)

> 📌 **Kontynuujesz projekt? Zacznij od [`docs/PRZEKAZANIE.md`](docs/PRZEKAZANIE.md)** — stan, decyzje i plan dalszej pracy.

Przytulny **idle city builder** na małej wyspie — czysty HTML5: bez bibliotek, bez bundlera,
bez CDN i bez żadnych zapytań sieciowych. Cała grafika (wyspa, budynki, ikony) jest rysowana kodem:
canvas 2D dla mapy, inline SVG dla interfejsu. Projekt jest szkieletem pod publikację na
CrazyGames i itch.io.

## Uruchomienie

Moduły ES nie działają z `file://`, więc potrzebny jest dowolny serwer statyczny:

```bash
node tools/serve.mjs        # http://127.0.0.1:8080/
```

| Parametr adresu | Działanie |
|-----------------|-----------|
| `?debug`        | panel deweloperski (FPS, liczby, kody: zasoby, przewijanie czasu ×10, skok o 1 h / 9 h) |
| `?test`         | udostępnia `window.__game`, `window.__ui`, `window.__renderer` dla testów |
| `?demo`         | gotowa osada do zrzutów ekranu (nie nadpisuje zapisu); `?demo=2` — osada po ~40 min z drugą falą budynków; `?demo=3` — archipelag (3 wyspy, port, zwiad z ofertami) |
| `?ads=mock`     | udaje reklamę nagradzaną (przycisk „×2” na ekranie powrotu) |

Profiler rysowania: w konsoli `window.__prof = {}`, po chwili odczytaj `window.__prof` (ms/klatkę na sekcję).

## Sterowanie

| | Telefon | Komputer |
|---|---|---|
| Kamera | przeciąganie, szczypanie | przeciąganie, kółko, strzałki, `+`/`-` |
| Budowa | karta → tap przesuwa „ducha” → drugi tap albo ✓ stawia | karta (lub `1`–`9`, `0`) → klik stawia, `Shift` = seria; kółko nad kartami przewija pasek |
| Wybór | tap w budynek / drzewo / skałę | klik (podświetlenie pod kursorem) |
| Inne | — | `Q` zadania, `Esc` anuluj/zamknij, `Enter` potwierdź |

Po zmianach: `(cd site && zip -r ../dist/wysepka.zip .)` (katalog `dist/` jest w `.gitignore`).

## Testy i narzędzia (Node 18+, zero zależności)

```bash
node tools/test-core.mjs    # 38 testów logiki (core działa bez DOM)
node tools/balance.mjs      # bot grający 120 min archipelagiem na wielu mapach + cele tempa (--minutes, --seeds, --verbose)
node tools/shots.mjs        # Playwright: zrzuty 390×844 / 1280×720, błędy konsoli, obce requesty
node tools/shots.mjs --fps  # + pomiar FPS przy 4× spowolnionym CPU
```

`tools/icons.html` (przez serwer) pokazuje cały zestaw ikon.

## Architektura

```
wrangler.jsonc        hosting Cloudflare (publikuje tylko folder site/)
site/                 CAŁA gra (to jest publikowane):
site/index.html       canvas + kontener UI, splash, favicon jako data: (zero requestów)
site/_headers         nagłówki cache dla Cloudflare
site/styles.css       tokeny, układ pion/poziom, komponenty, animacje
site/js/config.js          WSZYSTKIE dane i liczby balansu (budynki, zadania, mapa, zapis)
site/js/core/              czysta logika bez DOM: stan, ekonomia, symulacja, akcje, zadania, mapa,
                      world.js — archipelag (lista wysp, wspólne zadania, port, zwiad, kolonizacja)
site/js/save/save.js       zapis z wersją (v2 = świat), migracjami (v1 → v2), kopią zapasową i sanityzacją danych
site/js/game.js            pętla rAF + stały krok, pauza w tle, offline (8 h), autozapis, konflikt kart
site/js/platform.js        puste hooki pod SDK portalu (gameplay, reklamy, zapis, język)
site/js/i18n.js, js/lang/  słownik PL (domyślny) i EN, liczba mnoga przez Intl.PluralRules
site/js/ui/                interfejs DOM: HUD, karty, panel, okna, toasty, ikony SVG, „juice”;
                      islands.js — okno archipelagu, znalezione wyspy, wyprawa w panelu portu
site/js/render/            renderer canvas: rzut izo, wypiekany teren, sztuka budynków, efekty, życie
site/js/input.js           Pointer Events: tap / pan / pinch / kółko / klawiatura
site/js/audio/sfx.js       efekty dźwiękowe syntezowane w WebAudio
site/js/dev/               panel debug i stan demo (ładowane tylko na żądanie)
tools/                serwer dev, testy, bot balansu, QA w Playwright
```

Zasady:
- **Jeden kierunek**: UI i renderer tylko czytają stan i słuchają zdarzeń z szyny (`core/events.js`);
  stan zmieniają wyłącznie akcje z `core/actions.js` (przez `game.dispatch`, na wyspie na ekranie)
  i `core/world.js` (przez `game.dispatchWorld`: przełączanie wysp, zwiad, kolonizacja).
- **Świat**: `game.world` = lista wysp; `game.state` to zawsze wyspa na ekranie (renderer i UI nie musiały
  się zmieniać). Zadania i `meta` są wspólnym obiektem wszystkich wysp; każda wyspa ma własną mapę,
  budynki, surowce i ludność i pracuje w tle tym samym `tick()` (także offline).
- **Core bez DOM i bez zegara** — czas przychodzi parametrem, więc ten sam kod działa w Node
  (testy, bot) i w przeglądarce; offline liczy się tym samym `tick()` co gra.
- **Wydajność**: warstwa statyczna (morze + teren) w cache, sprite'y budynków w dokładnej skali ekranu,
  pule cząsteczek, DPR ≤ 2 i ≤ ~3 Mpx canvasu, UI odświeżane ~10×/s tylko przy zmianie tekstu,
  bez `backdrop-filter` i filtrów w pętli.

## Projekt gry

**Zasoby:** drewno, kamień, żywność, monety (+ mieszkańcy i ich limit). Każdy zasób ma limit
(skarbiec dla monet); Magazyn podnosi wszystkie limity — to on decyduje o zyskach offline.

| Budynek | Rola | Etaty | Bonus sąsiedztwa |
|---|---|---|---|
| Chata | +4 mieszkańców (+2/poz.), podatki | — | — |
| Pole | żywność | 1 (+1/poz.) | +10% za każdy kafel wody |
| Tartak | drewno | 2 (+1/poz.) | +10% za każde drzewo |
| Kamieniołom | kamień | 2 (+1/poz.) | +15% za każdą skałę |
| Targ | monety | 2 (+1/poz.) | +10% za każdą chatę |
| Magazyn | limity zasobów | — | — |
| Rybak | żywność, **tylko na brzegu** | 1 (+1/poz.) | +12% za każdy kafel wody |
| Studnia | **aura**: +25% (+5%/poz.) dla sąsiednich pól i piekarni | — | — |
| Młyn | żywność | 2 (+1/poz.) | +20% za każde pole |
| Piekarnia | żywność + monety | 2 (+1/poz.) | +30% za każdy młyn |
| Klomb | **urok** +1 (+1/poz.) | — | — |
| Fontanna | **urok** +6 (+2/poz.) | — | — |
| Port | zwiad i nowe wyspy; **na wodzie przy brzegu**, 1 na wyspę; poziom = szybszy statek | — | — |

**Urok** (ozdoby): każdy punkt to +4% wszystkich monet (targi, piekarnie, podatki) — ujście dla monet,
które samo się spłaca. **Aura** to bonus, który budynek daje sąsiadom (podgląd przy stawianiu: `+25% ×N`).

- Koszt kolejnego budynku i kolejnego poziomu rośnie ×1.15; burzenie oddaje 50% inwestycji.
- Pracownicy przydzielają się sami (najpierw pola). Głód: gdy spichlerz pusty, produkcja (poza polami)
  spada proporcjonalnie do niedoboru, maks. o 50%, a ludność przestaje rosnąć — nikt nie umiera.
- Drzewa i skały można usunąć (szybki surowiec), ale dają bonus sąsiednim tartakom/kamieniołomom.
- Zadania, zestaw 1: Pole → Tartak i Kamieniołom → 4 chaty (odblokowuje Targ) → ulepszenie do poz. 2
  (odblokowuje Magazyn) → 30 mieszkańców (Rybak, Studnia).
- Zadania, zestaw 2: Rybak + Studnia (Młyn) → Młyn + 5 pól (Piekarnia) → Piekarnia (Klomb) → urok 8 →
  60 mieszkańców (Fontanna) → poziom 6 → 800 żywności → urok 30 → 150 mieszkańców.
  `core/prestige.js` to pusty hook pod „Nową wyprawę”.
- Zadania, zestaw 3 (archipelag): Port → 2 wyspy → 3 wyspy → 5 wysp.
- Karta bez dochodu brakującego surowca pokazuje jego ikonę i „brak”; tapnięcie mówi, skąd go wziąć.

**Archipelag** (etap 1): po 14. zadaniu odblokowuje się Port. Statek płynie na zwiad (150 s, każda
kolejna wyspa ×1.35 dalej, poziom portu przyspiesza) i wraca z 2–3 wyspami do wyboru; kolonizacja
kosztuje surowce wyspy, z której wypłynął statek (×1.35 za każdą kolejną), a osadnicy dostają paczkę
startową. Przed kolejnym rejsem najnowsza wyspa musi mieć 20 mieszkańców. Maks. 5 wysp, każda z innym biomem:

| Biom | Mapa | Specjalność |
|---|---|---|
| Wysepka (start) | ~105 pól, zrównoważona | — |
| Zielony Gaj | ~160 pól, dużo lasu | drewno +50%, kamień −20% |
| Mroźna Skała | ~160 pól, dużo skał, śnieg | kamień +60%, żywność −25% |
| Rajska Laguna | ~150 pól, palmy, stawy | żywność +40%, monety +15%, kamień −20% |
| Złote Pola | ~180 pól, stawy | żywność +60%, drewno −15% |

Przycisk z ikoną wyspy w HUD otwiera okno archipelagu: przełączanie wysp („Płyń”), wybór wyspy
głównej (★ — od niej zawsze startuje gra), status zwiadu; czerwona kropka = głód na innej wyspie.
Na razie wyspy nie wymieniają się surowcami — to etap 2 (transport), potem rynek NPC (etap 3).

**Balans** (`node tools/balance.mjs`, 120 min, mediana z 8 wysp, „aktywny” bot gra całym archipelagiem):
pierwsza budowa 0:00, 6 pierwszych budynków ~6:00, pierwszy pełny magazyn ~4:20, 5. zadanie ~9 min,
10. zadanie ~24 min, 14. ~45 min, port ~45 min, 2. wyspa ~48 min, 5. wyspa ~81 min; akcja co ≤ 70 s
na starcie, ≤ 60 s później, zero ślepych zaułków. Człowiek gra ok. 1.3–1.5× wolniej od bota, czyli
w praktyce: 5. zadanie ~12–14 min, port ~60–65 min, cały archipelag ~1:45–2:00 h.
„Niedzielny” bot (zagląda co 45 s): port ~56 min, 5. wyspa ~112 min.

## Jak rozbudowywać

- **Nowy budynek:** wpis w `BUILDINGS` + `BUILDING_ORDER` (`config.js`; pola `aura`, `charm`, `coastal` są opcjonalne), funkcja rysująca w
  `render/art.js` (dopisz do `BUILDING_DRAW`), symbol SVG w `ui/icons.js`, klucze `b.<id>.name/.desc`
  w obu słownikach. Test i18n pilnuje kompletności.
- **Nowe zadanie:** wpis w `QUESTS` (typy celów: `have`, `pop`, `level`, `cleared`, `resource`, `charm`) +
  klucze `q.<id>.title/.desc`.
- **Nowy język:** plik w `js/lang/`, dopisanie do `DICTS` w `i18n.js` (przycisk w ustawieniach pojawi się sam).
- **Zmiana formatu zapisu:** podbij `GAME.saveVersion` i dodaj `MIGRATIONS[n]` w `save/save.js`
  (funkcja zamienia zapis v`n` na v`n+1`); `sanitize()` i tak naprawi brakujące pola.

## Publikacja

- **itch.io:** spakuj zawartość folderu `site/` do ZIP, typ „HTML”,
  zaznacz obsługę urządzeń mobilnych. Gra nie wykonuje żadnych zapytań sieciowych.
- **CrazyGames / inne portale:** podłącz SDK w jednym miejscu — `js/platform.js` (komentarze `SDK:`
  wskazują miejsca na `gameplayStart/Stop`, `happytime`, reklamy i zapis w chmurze). Układ poziomy
  działa na desktopie, strzałki i spacja nie przewijają strony nadrzędnej.

## Znane braki

1. Hooki portalu są puste — brak prawdziwej integracji SDK (reklamy testowane tylko przez `?ads=mock`).
2. Zawartość: 18 zadań, ~2 h z całym archipelagiem; potem zostaje „buduj i ulepszaj”. Prestiż to pusty hook.
3. Wyspa domowa po ~45 min (bot) przelewa się drewnem i kamieniem, a nowe wyspy startują od zera —
   brak transportu między wyspami (etap 2) i rynku (etap 3). Monety są jeszcze osobne na każdej wyspie
   (wspólny skarbiec wejdzie razem z transportem). Balans wymaga danych od graczy.
4. FPS mierzone w kontenerze bez GPU (rasteryzacja programowa) — potrzebne testy na prawdziwych telefonach (zwłaszcza tanie Androidy i iOS Safari).
5. Mieszkańcy, mewy i chmury są czysto dekoracyjne; brak dróg i transportu towarów.
6. Budynki tylko 1×1, bez obracania i cofania akcji. Siatka każdej wyspy ma 20×20 pól (zapisy v1 z 14×14 są wyśrodkowywane).
7. Tylko efekty dźwiękowe (bez muzyki i ambientu morza).
8. Dostępność podstawowa: etykiety ARIA na przyciskach, ale mapa (canvas) nie jest dostępna dla czytników ekranu; brak trybu dla daltonistów.
9. Zapis tylko lokalny (localStorage) — brak synchronizacji między urządzeniami; wykrywanie drugiej karty jest proste.
10. Brak ekranu „Jak grać” — onboarding to zadania, rączka przy karcie i kilka podpowiedzi.

## 5 pomysłów na rozwój

1. **Transport i rynek (w planie):** trasy statków między wyspami (automatyczne z progiem nadwyżki i jednorazowe na ratunek), wspólny skarbiec, rynek NPC ze zmiennymi cenami; później ewentualnie rynek graczy.
2. **Prestiż:** stały bonus po odkryciu całego archipelagu (np. „Nowy archipelag”) i wyspa wulkaniczna z rzadkim surowcem.
3. **Pory roku i wydarzenia:** wiosna/lato/jesień/zima zmieniają wygląd i produkcję; dożynki, sztormy, wizyta kupca — krótkie cele na każdą sesję.
4. **Mieszkańcy z imionami:** drobne prośby („chcę klomb przy domu”), a urok wpływa też na przyrost ludności (dziś tylko na monety).
5. **Funkcje portalowe:** codzienna skrzynka, osiągnięcia, zapis w chmurze i reklamy nagradzane jako opcjonalne przyspieszenia (np. ×2 produkcji na 10 min) przez `platform.js`.
