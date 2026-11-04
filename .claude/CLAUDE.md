# Wysepka — stan projektu i zasady pracy

**Zacznij od `START.md` (krótki przewodnik na jedną rozmowę).** Ten plik to skrót zasad; decyzje i plan etapów są w `docs/PRZEKAZANIE.md`, architektura i narzędzia w `README.md`.
Stan z 04.11.2026: wersja gry **0.3.2** (archipelag, etap 1: port, zwiad, 5 wysp z biomami; zapis v2). Gra stoi na Cloudflare: https://wysepka.jasko4185.workers.dev (Production branch = `main`, buduje się samo po wypchnięciu). Rozmowa po polsku.

## Jak pracujemy z Janem
- Jan pracuje **wyłącznie z telefonu**, nie czyta kodu. Odpowiadaj po polsku, krótko, z odrobiną humoru i emoji; o sobie w formie żeńskiej.
- **Polecenia do wklejenia w jednym bloku kodu.** **Jeden krok na raz**, po każdym Jan sprawdza grę na telefonie.
- **Scalanie z `main` tylko po wyraźnej zgodzie Jana.** Praca na osobnej gałęzi.
- **Wersję podbija automat** (workflow „Podbij wersję” dopisuje commit „Automatyczne podbicie wersji do X” po wypchnięciu zmian w `site/`); ręcznie tylko większy skok (Actions → Podbij wersję → Run workflow z numerem). Na komputerze: `node tools/podbij-wersje.mjs X.Y.Z|patch`, kontrola: `node tools/podbij-wersje.mjs`. Po wypchnięciu poczekaj na ten commit, zanim wypchniesz kolejną zmianę.
- **Po każdym wypchnięciu sprawdź wynik testu**: przeczytaj `OSTATNI-WYNIK.md` z gałęzi `wyniki-testow` (sprawdź, czy gałąź i commit zgadzają się z Twoim wypchnięciem, czyli po automatycznym podbiciu wersji) albo, jeśli masz narzędzia Actions, `actions_list`/`get_job_logs`. Zgłoś Janowi zielony/czerwony, zanim powiesz, że zmiana jest gotowa.
- Nie zmieniaj logiki gry bez prośby. Zasoby tylko własne (grafika rysowana kodem), żadnych zapytań na zewnątrz.

## Pamiętaj
- Gra jest w `site/`, narzędzia w `tools/` (`test-core.mjs`, `balance.mjs`, `shots.mjs`, `testy/`), testy w `.github/workflows/test.yml`.
- `.gitignore` ma wyjątek `!.github` — nie usuwać (patrz `START.md`).
- Zwykły czat nie uruchomi Node ani gry; testy logiki i bot balansu wymagają komputera lub Claude Code.
