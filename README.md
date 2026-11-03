# 🏝️ Wysepka (Tiny Isle)

Przytulny **idle city builder** w czystym HTML5: bez bibliotek, bez bundlera, bez CDN
i bez żadnych zapytań sieciowych. Cała grafika rysowana jest kodem.

> Status: szkielet w budowie (etapy a → e).

## Uruchomienie

Moduły ES nie działają z `file://`, więc potrzebny jest dowolny serwer statyczny:

```bash
node tools/serve.mjs        # http://127.0.0.1:8080/
```

Przydatne parametry adresu:

| Parametr     | Działanie                                                     |
|--------------|---------------------------------------------------------------|
| `?debug`     | panel deweloperski (FPS, liczby, kody: zasoby, przewijanie czasu) |
| `?test`      | udostępnia `window.__game` dla testów automatycznych          |
| `?demo`      | ładuje gotową osadę do zrzutów (bez nadpisywania zapisu)      |
| `?ads=mock`  | udaje reklamę nagradzaną (test przycisku „×2”)                |

## Testy i narzędzia (Node 18+, zero zależności)

```bash
node tools/test-core.mjs    # testy logiki gry (core działa bez DOM)
node tools/shots.mjs        # Playwright: zrzuty 390×844 i 1280×720, błędy konsoli, obce requesty, FPS (--fps)
```

## Architektura

```
js/config.js     wszystkie dane i liczby balansu
js/core/         czysta logika (bez DOM): stan, ekonomia, symulacja, akcje, zadania, mapa
js/save/         zapis z wersją, migracjami, kopią zapasową i walidacją
js/game.js       pętla gry, pauza w tle, postęp offline, autozapis, konflikt kart
js/platform.js   puste hooki pod SDK portalu (gameplay, reklamy, zapis)
js/i18n.js       słownik PL (domyślny) / EN
```

Zasada: interfejs i renderer tylko czytają stan i słuchają zdarzeń; zmiany stanu
idą wyłącznie przez akcje z `js/core/actions.js`.
