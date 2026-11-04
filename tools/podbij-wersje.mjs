#!/usr/bin/env node
/**
 * Podbija numer wersji w jednym ruchu:
 *   node tools/podbij-wersje.mjs 0.3.1     ustawia wersję 0.3.1 we wszystkich miejscach
 *   node tools/podbij-wersje.mjs patch     następna łatka (0.3.1 → 0.3.2)
 *   node tools/podbij-wersje.mjs           tylko sprawdza spójność (kod 1, gdy coś się rozjechało)
 *
 * Miejsca: site/js/wersja.js, wszystkie importy ?v= w site/js/ i w tools/*.mjs,
 * site/index.html (styles.css, modulepreload, main.js). Parametr ?v= sprawia, że telefon
 * pobiera nowe pliki zamiast starych z pamięci podręcznej.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SITE = join(REPO, 'site');
const wersjaJs = join(SITE, 'js', 'wersja.js');
const obecna = /WERSJA = '([^']+)'/.exec(readFileSync(wersjaJs, 'utf8'))?.[1];
let nowa = process.argv[2];
if (nowa === 'patch') {
  const [a, b, c] = obecna.split('.').map(Number);
  nowa = `${a}.${b}.${c + 1}`;
}
if (nowa && !/^\d+\.\d+\.\d+$/.test(nowa)) {
  console.error('Wersja ma wyglądać tak: 1.2.3 (albo: patch)');
  process.exit(2);
}
const cel = nowa || obecna;

function pliki(dir, ext, out = []) {
  for (const nazwa of readdirSync(dir)) {
    const p = join(dir, nazwa);
    if (statSync(p).isDirectory()) pliki(p, ext, out);
    else if (ext.some((e) => nazwa.endsWith(e))) out.push(p);
  }
  return out;
}

// importy względne i bezwzględne ('./x.js', '../x.js', '/js/x.js'), statyczne i dynamiczne
const IMPORT = /((?:from\s*|import\s*\(\s*|import\s+)['"])((?:\.{1,2}\/|\/js\/)[^'"?]+\.js)(\?v=[^'"]*)?(['"])/g;
const HTML = /((?:src|href)=")((?:js\/[^"?]+\.js)|styles\.css)(\?v=[^"]*)?(")/g;

let zmienione = 0;
let niespojne = 0;
const cele = [
  ...pliki(join(SITE, 'js'), ['.js']),
  ...pliki(join(REPO, 'tools'), ['.mjs']).filter((p) => !p.endsWith('podbij-wersje.mjs')),
].map((p) => [p, IMPORT]);
cele.push([join(SITE, 'index.html'), HTML]);

for (const [p, re] of cele) {
  const stary = readFileSync(p, 'utf8');
  let nowy = stary.replace(re, (_, a, sciezka, v, z) => {
    if (v && v !== `?v=${cel}`) niespojne++;
    // pliki z tools/ importują też moduły gry w przeglądarce (shots.mjs) — tu zmieniamy tylko prawdziwe importy
    return `${a}${sciezka}?v=${cel}${z}`;
  });
  if (nowy !== stary) {
    if (nowa) writeFileSync(p, nowy);
    zmienione++;
  }
}

if (nowa) {
  writeFileSync(wersjaJs, readFileSync(wersjaJs, 'utf8').replace(/WERSJA = '[^']+'/, `WERSJA = '${nowa}'`));
  console.log(`Wersja ${obecna} → ${nowa}; zmienione pliki: ${zmienione}`);
} else {
  const ok = zmienione === 0;
  console.log(ok ? `OK: wersja ${cel} jest wszędzie taka sama` : `BŁĄD: w ${zmienione} plikach numer wersji się rozjechał (uruchom: node tools/podbij-wersje.mjs ${cel})`);
  process.exit(ok ? 0 : 1);
}
