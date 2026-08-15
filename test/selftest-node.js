// Headless-Regressionstest für den SUITE-KERN: lädt ../app.js mit gestubbten Browser-Globals und führt selfTest() in Node aus.
// Aufruf:  node test/selftest-node.js   (Exit 0 = alles OK, 2 = Fehler)
// Prüft die reine Kernlogik (Geld/Datum/BKP/Kosten …) VOR jedem Commit – ohne Browser. Muster wie pdf/test/selftest-node.js.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const file = path.join(__dirname, '..', 'app.js');
let src = fs.readFileSync(file, 'utf8');

// "magic" Proxy: aufrufbar, konstruierbar, indexierbar, absorbiert jede Zuweisung, gibt sich selbst zurück
function makeMagic() {
  const fn = function () { return proxy; };
  const proxy = new Proxy(fn, {
    get(t, prop) {
      if (prop === Symbol.toPrimitive) return () => 0;
      if (prop === Symbol.iterator) return function* () { };
      if (prop === 'length') return 0;
      if (prop === 'then') return undefined;          // nicht als Promise behandeln
      if (prop === 'nodeType') return 1;
      if (prop === Symbol.hasInstance) return () => false;
      return proxy;
    },
    set() { return true; }, apply() { return proxy; }, construct() { return proxy; }, has() { return true; }
  });
  return proxy;
}
const magic = makeMagic();

const sandbox = {};
sandbox.globalThis = sandbox; sandbox.window = sandbox; sandbox.self = sandbox; sandbox.console = console;
sandbox.setTimeout = () => 0; sandbox.clearTimeout = () => { }; sandbox.setInterval = () => 0; sandbox.clearInterval = () => { };
sandbox.requestAnimationFrame = () => 0; sandbox.cancelAnimationFrame = () => { };
sandbox.queueMicrotask = () => { };
sandbox.URLSearchParams = URLSearchParams; sandbox.TextEncoder = TextEncoder; sandbox.TextDecoder = TextDecoder;
sandbox.atob = s => Buffer.from(s, 'base64').toString('binary'); sandbox.btoa = s => Buffer.from(s, 'binary').toString('base64');
sandbox.crypto = { getRandomValues: a => a, randomUUID: () => 'x', subtle: magic };
sandbox.performance = { now: () => 0 };
sandbox.location = { search: '', origin: 'http://localhost', href: 'http://localhost/', hash: '', pathname: '/', reload: () => { } };
sandbox.navigator = { userAgent: 'node', clipboard: { writeText: () => Promise.resolve() }, language: 'de', onLine: true };
sandbox.localStorage = { getItem: () => null, setItem: () => { }, removeItem: () => { }, clear: () => { } };
sandbox.sessionStorage = { getItem: () => null, setItem: () => { }, removeItem: () => { } };
sandbox.matchMedia = () => ({ matches: false, addEventListener: () => { }, addListener: () => { } });
sandbox.getComputedStyle = () => magic; sandbox.devicePixelRatio = 1;
sandbox.alert = () => { }; sandbox.confirm = () => true; sandbox.prompt = () => null;
sandbox.fetch = () => Promise.resolve({ ok: false, json: () => Promise.resolve({}), arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)), text: () => Promise.resolve('') });
sandbox.AbortController = class { constructor() { this.signal = {}; } abort() { } };
sandbox.history = { replaceState: () => { }, pushState: () => { } };
sandbox.URL = class { static createObjectURL() { return ''; } static revokeObjectURL() { } };
sandbox.Blob = class { }; sandbox.File = class { }; sandbox.Image = class { }; sandbox.FileReader = class { readAsDataURL() { } readAsArrayBuffer() { } readAsText() { } };
sandbox.indexedDB = magic;
sandbox.IntersectionObserver = class { observe() { } disconnect() { } unobserve() { } };
sandbox.ResizeObserver = class { observe() { } disconnect() { } };
sandbox.MutationObserver = class { observe() { } disconnect() { } };
sandbox.document = makeMagic(); sandbox.addEventListener = () => { }; sandbox.removeEventListener = () => { };

src += '\n;try{ globalThis.__R = (typeof selfTest===\"function\") ? selfTest() : {R:[{name:\"selfTest fehlt\",ok:false}],pass:0,fail:1}; }catch(e){ globalThis.__ERR = (e&&e.stack)||String(e); }';

try { vm.createContext(sandbox); vm.runInContext(src, sandbox, { filename: 'app.js', timeout: 20000 }); }
catch (e) { console.log('LADEFEHLER beim Auswerten von app.js:\n', (e && e.stack) || e); process.exit(1); }

if (sandbox.__ERR) { console.log('SELFTEST-FEHLER:\n', sandbox.__ERR); process.exit(1); }
const R = sandbox.__R;
if (R) {  // CSS-Integritaet: unausgeglichene Klammern zerstoeren stumm ganze Regelbloecke
  const css = fs.readFileSync(__dirname + '/../styles.css', 'utf8');
  const bal = (css.split('{').length - 1) - (css.split('}').length - 1);
  let d = 0, orphan = 0;
  css.split(String.fromCharCode(10)).forEach((l, i) => { d += (l.split('{').length - 1) - (l.split('}').length - 1); if (d < 0 && !orphan) orphan = i + 1; });
  R.R.push({ name: 'styles.css: Klammern ausgeglichen', ok: bal === 0, msg: bal === 0 ? '' : 'Differenz ' + bal });
  R.R.push({ name: 'styles.css: keine verwaiste schliessende Klammer', ok: !orphan, msg: orphan ? 'Zeile ' + orphan : '' });
  bal === 0 ? R.pass++ : R.fail++;
  orphan ? R.fail++ : R.pass++;

  /* --- Ein Design, vier Apps -------------------------------------------
     SubmitOne und SubZeit sollen gleich aussehen. Sie tun das nur, solange
     beide dieselben Dateien laden und keine davon einen Wert ein zweites
     Mal setzt. Genau so sind die Farben schon einmal auseinandergelaufen
     (siehe Kopf von ui/tokens.css) — deshalb steht es jetzt im Test. */
  const lies = p => { try { return fs.readFileSync(__dirname + '/../' + p, 'utf8'); } catch (_) { return null; } };
  const push = (name, ok, msg) => { R.R.push({ name: name, ok: ok, msg: ok ? '' : (msg || '') }); ok ? R.pass++ : R.fail++; };

  const bau = lies('ui/bausteine.css');
  push('DESIGN: ui/bausteine.css vorhanden', !!bau, 'Datei fehlt');

  // Reihenfolge zaehlt: tokens liefert die Werte, bausteine baut darauf,
  // styles.css darf zuletzt das Letzte Wort haben.
  const eins = lies('index.html') || '';
  const platz = n => eins.indexOf(n);
  const reihe = platz('ui/tokens.css') >= 0 && platz('ui/bausteine.css') > platz('ui/tokens.css')
             && platz('styles.css') > platz('ui/bausteine.css');
  push('DESIGN: index.html laedt tokens -> bausteine -> styles', reihe,
       'Reihenfolge stimmt nicht oder ein Stylesheet fehlt');

  // Dieselben gemeinsamen Dateien in beiden Apps.
  const zeit = lies('submit/zeit/index.html') || '';
  const gemeinsam = ['tokens.css', 'bausteine.css', 'wochenraster.css'];
  const fehlt = gemeinsam.filter(d => eins.indexOf('ui/' + d) < 0 || zeit.indexOf('ui/' + d) < 0);
  push('DESIGN: SubmitOne und SubZeit laden dieselben ui/-Dateien', !fehlt.length,
       'nicht in beiden: ' + fehlt.join(', '));

  // Kein Token zweimal. Der Vergleich nimmt nur die :root-Bloecke, weil
  // ein Token in einem Dunkel- oder Medienblock absichtlich neu gesetzt wird.
  if (bau) {
    const wurzel = t => { const m = /:root\s*{([^}]*)}/.exec(t); return m ? m[1] : ''; };
    const namen = t => { const s = new Set(), re = /(--[a-z0-9-]+)\s*:/gi; let m; while ((m = re.exec(t))) s.add(m[1]); return s; };
    const ausBau = namen(wurzel(bau));
    const doppelt = [...namen(wurzel(css))].filter(n => ausBau.has(n));
    push('DESIGN: styles.css setzt kein Token aus bausteine.css neu', !doppelt.length,
         'doppelt: ' + doppelt.join(', '));
  }

  /* Schriftskala: acht Stufen, nicht fuenfundzwanzig.
     styles.css wird nur vom Programm geladen, nie von den Druckfenstern -
     dort darf deshalb keine feste Pixelgroesse mehr stehen. In app.js
     bleiben die Druckvorlagen bei Pixeln, die pruefen wir hier nicht. */
  const ohneKommentar = css.replace(/\/\*[\s\S]*?\*\//g, '');

  /* Auch die geteilte Rasterdatei und SubZeits eigenes Stylesheet gehoeren
     dazu. Beide rechneten bis zum 14.08.2026 noch mit 9px, 9.5px, 10.5px -
     Werten, die es in der gemeinsamen Skala gar nicht gibt. Die Vorlage
     hielt sich also selbst nicht daran. */
  const NUR_SKALA = ['styles.css', 'ui/wochenraster.css', 'submit/zeit/stil.css'];
  const mitFesten = [];
  for (const d of NUR_SKALA) {
    let t = (lies(d) || '').replace(/\/\*[\s\S]*?\*\//g, '');
    /* Eine Ausnahme, und nur diese: die bewusste Verkleinerung der ganzen
       Skala auf dem Handy (html { font-size: Npx } in einer Medienabfrage).
       Sie IST eine feste Pixelgroesse - aber sie setzt die rem-Basis, aus
       der die Skala dann wieder rechnet, statt eine einzelne Groesse an
       der Skala vorbei zu setzen. Genau das unterscheidet sie von dem,
       was diese Pruefung verhindern soll. */
    t = t.replace(/html\s*\{\s*font-size:\s*[0-9.]+px;?\s*\}/g, '');
    const treffer = t.match(/font-size:\s*[0-9.]+px/g) || [];
    if (treffer.length) mitFesten.push(d + ' (' + treffer.length + 'x, z.B. ' + treffer[0] + ')');
  }
  push('SKALA: Stylesheets ohne feste Schriftgroessen', !mitFesten.length, mitFesten.join(', '));

  const STUFEN = ['--t-2xs', '--t-xs', '--t-s', '--t-m', '--t-l', '--t-xl', '--t-2xl', '--t-3xl'];
  const benutzt = [...new Set((ohneKommentar.match(/var\(\s*(--t-[a-z0-9]+)/g) || [])
                    .map(s => s.replace(/var\(\s*/, '')))];
  const fremd = benutzt.filter(n => STUFEN.indexOf(n) < 0);
  push('SKALA: nur die acht gemeinsamen Stufen in Gebrauch', !fremd.length, 'unbekannt: ' + fremd.join(', '));

  /* Die rem-Basis gehoert dem Browser - UNBEDINGT jedenfalls.

     Eine Schriftgroesse auf html verstellt die Bedeutung der ganzen Skala:
     Mit "html, body { font-size: 12.5px }" wurde --t-m (.875rem) zu 10.9px
     statt 14px, und die Oberflaeche waere beim Umstellen geschrumpft statt
     gewachsen - gleichmaessig genug, um plausibel auszusehen.

     Innerhalb einer Medienabfrage ist es dagegen erlaubt und beabsichtigt:
     Dort ist genau das der Zweck (Handy, alles eine Stufe kleiner). Diese
     Pruefung sieht deshalb nur die Regeln AUSSERHALB von @media an. */
  const ohneMedien = ohneKommentar.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  const htmlRegel = /(^|\})\s*html\s*(,[^{]*)?\{([^}]*)\}/g;
  let hm, htmlSchrift = false;
  while ((hm = htmlRegel.exec(ohneMedien))) if (/font-size/.test(hm[3])) htmlSchrift = true;
  push('SKALA: html behaelt die rem-Basis (ausserhalb von @media)', !htmlSchrift,
       'eine unbedingte html-Regel setzt font-size - dann bedeutet --t-m nicht mehr 14px');

  /* Handy: kein Bereich darf unerreichbar werden.

     Bis zum 14.08.2026 standen alle elf Punkte in einer Reihe, die seitlich
     rollte - mit verstecktem Rollbalken. Auf 390px waren fuenf sichtbar,
     sechs faktisch verborgen. Jetzt tragen vier einen festen Platz und der
     Rest liegt hinter "Mehr". Faellt der Knopf weg oder bekommt ein
     Bereich versehentlich data-mobil, ist die Leiste wieder zu voll. */
  const seite = lies('index.html') || '';
  const bereiche = (seite.match(/data-nav="/g) || []).length;
  const feste = (seite.match(/data-mobil="1"/g) || []).length;
  push('HANDY: "Mehr" fuehrt zu den uebrigen Bereichen', seite.indexOf('id="btnNavMehr"') >= 0,
       'der Knopf fehlt in index.html - die uebrigen Bereiche waeren unerreichbar');
  push('HANDY: hoechstens vier feste Plaetze in der Reiterleiste', feste > 0 && feste <= 4,
       feste + ' Punkte mit data-mobil (von ' + bereiche + ') - mehr als vier passen auf 390px nicht');
  const jsq = fs.readFileSync(__dirname + '/../app.js', 'utf8');
  // Definiert UND aufgerufen. Auf die Reihenfolge im Text kommt es nicht
  // an - Funktionsdeklarationen werden hochgezogen, der Aufruf steht hier
  // tatsaechlich weiter oben als die Definition.
  push('HANDY: das Blatt liest die Bereiche aus der Navigation',
       /function\s+initNavMehr\b/.test(jsq) && /(^|[^.\w])initNavMehr\(\)\s*;/m.test(jsq),
       'initNavMehr fehlt oder wird nicht aufgerufen');

  /* Projektnavigation: jedes Kapitel braucht sein eigenes Zeichen.

     Eingeklappt ist das Zeichen das Einzige, was bleibt. Fehlt eines, faellt
     das Kapitel auf das Zeichen der Uebersicht zurueck und ist von ihr nicht
     mehr zu unterscheiden; sind zwei gleich, ebenso. Beides sieht man erst,
     wenn man die Leiste zuklappt - also pruefen wir es hier. */
  const kapitel = [];
  const grp = /const PROJ_GRUPPEN = \[([\s\S]*?)\n\];/.exec(jsq);
  if (grp) { const re = /tabs:\s*\[([^\]]*)\]/g; let m;
    while ((m = re.exec(grp[1]))) m[1].split(',').forEach(s => { s = s.trim().replace(/['"]/g, ''); if (s) kapitel.push(s); }); }
  const ikon = /const P_ICO = \(\(\) => \{[\s\S]*?\n\}\)\(\);/.exec(jsq);
  const habenIcon = ikon ? kapitel.filter(k => new RegExp('\\n\\s*' + k + ':\\s').test(ikon[0])) : [];
  push('PROJEKT: jedes Kapitel hat ein eigenes Zeichen',
       kapitel.length > 0 && habenIcon.length === kapitel.length,
       'ohne Zeichen: ' + kapitel.filter(k => habenIcon.indexOf(k) < 0).join(', '));
  if (ikon) {
    const koerper = (ikon[0].match(/s\('([^']*)'\)/g) || []);
    const doppelt = koerper.length - new Set(koerper).size;
    push('PROJEKT: kein Zeichen kommt zweimal vor', doppelt === 0, doppelt + ' Zeichen doppelt vergeben');
  }
  push('PROJEKT: keine Reiterbaender mehr ueber dem Inhalt',
       jsq.indexOf('class="ribbon-tabs"') < 0 && jsq.indexOf('class="ribbon-tools"') < 0,
       'ribbon-tabs/-tools werden wieder gebaut - die Navigation stuende doppelt da');

  /* Die Umschaltpille darf nicht auf den Knoepfen sitzen. appswitch.js
     hebt sie um --so-sw-abstand an; die App muss den Wert setzen. */
  const swjs = lies('appswitch.js') || '';
  push('HANDY: Umschaltpille beachtet den belegten unteren Rand',
       swjs.indexOf('--so-sw-abstand') >= 0 && ohneKommentar.indexOf('--so-sw-abstand') >= 0,
       'appswitch.js oder styles.css kennt --so-sw-abstand nicht');

  /* Die Palette vor Violett darf nicht zurueckkriechen. Diese Werte sind
     nicht theoretisch: Sie standen am 14.08.2026 noch an 57 Stellen in
     styles.css, teils DIREKT neben var(--brand) - .cal-day.today hatte
     einen violetten Rahmen und eine gruene Fuellung, und der Grund der
     Anmeldeseite war dunkelgruen. Man sieht so etwas nur, wenn man die
     Seite oeffnet; ein Test findet es bei jedem Lauf. */
  const ALTE_PALETTE = [
    ['#4f7a3c', 'Marken-Gruen'], ['rgba(79,122,60', 'Marken-Gruen, durchscheinend'],
    ['#34502b', 'Gruen dunkel'], ['#e9efde', 'Gruen weich'], ['#22331d', 'Gruen sehr dunkel'],
    ['rgba(42,38,26', 'brauner Neutralton'], ['#1c242c', 'alte Tinte'],
    ['#faf9f5', 'Creme'], ['#faf9f4', 'Creme'], ['#f7f6f1', 'Creme'], ['#f0eee6', 'warmes Grau'],
    ['#dedcd2', 'warme Kante'], ['#f3f1ea', 'warme Flaeche'],
    // Und das Violett, das bis zum 15.08.2026 der Akzent war. Die
    // Projektfarbe --pc-violett ist etwas anderes und bleibt: Sie ist
    // eine Farbe zur Auswahl, keine Marke.
    ['#7132e3', 'Marken-Violett'], ['rgba(113,50,227', 'Violett durchscheinend'],
    ['rgba(113, 50, 227', 'Violett durchscheinend']
  ];
  const reste = ALTE_PALETTE.filter(f => ohneKommentar.indexOf(f[0]) >= 0)
                            .map(f => f[0] + ' (' + f[1] + ')');
  push('PALETTE: keine Farbe aus der Zeit vor Violett in styles.css', !reste.length, reste.join(', '));

  /* Eine Familie, eine Anmutung: dieselbe Schriftanforderung und dieselbe
     theme-color in allen fuenf Seiten. Die theme-color faerbt die Leiste
     der installierten App - laeuft sie auseinander, sieht man den Bruch
     schon vor dem ersten Klick. */
  const SEITEN = ['index.html', 'submit/index.html', 'submit/zeit/index.html',
                  'write/index.html', 'pdf/index.html'];
  const holen = (t, re) => { const m = re.exec(t || ''); return m ? m[1] : null; };
  const farben = SEITEN.map(s => [s, holen(lies(s), /name="theme-color"\s+content="([^"]+)"/)]);
  const abweichend = farben.filter(f => f[1] !== '#0b0a12');
  push('FAMILIE: dieselbe theme-color in allen Seiten', !abweichend.length,
       abweichend.map(f => f[0] + '=' + f[1]).join(', '));

  /* Die Oberflaechenschrift muss ueberall dieselbe sein. Zusaetzliche
     Schriften sind erlaubt - Paper bietet Lora und Inter Tight als
     DOKUMENT-Schriften an, das ist der Zweck eines Textprogramms und kein
     Auseinanderlaufen. Geprueft wird deshalb auf Enthaltensein, nicht auf
     Gleichheit. Submit PDF lud lange gar keine Schrift und lief still in
     Segoe UI, obwohl es ueberall var(--font) benutzte. */
  /* Seit dem 15.08.2026 drei Schriften statt zwei: Inter fuer die
     Oberflaeche, Space Grotesk fuer Ueberschriften und Schriftzug,
     Roboto Condensed fuer Zahlen. Quicksand ist entfallen. */
  const GRUND = ['family=Inter:wght@300;400;500;600;700',
                 'family=Space+Grotesk:wght@', 'family=Roboto+Condensed:wght@'];
  const ohneGrund = SEITEN.filter(s => { const t = lies(s) || ''; return GRUND.some(g => t.indexOf(g) < 0); });
  push('FAMILIE: ueberall dieselbe Oberflaechenschrift angefordert', !ohneGrund.length,
       'fehlt in: ' + ohneGrund.join(', '));

  // Der Dunkelmodus ist ein Schalter. Wer ihn setzt, ohne bereit zu sein,
  // bekommt weisse Schrift auf Weiss - deshalb steht hier, wer ihn hat.
  if (bau) {
    const geschuetzt = bau.indexOf(':root[data-dunkel="auto"]') >= 0;
    push('DESIGN: Dunkelmodus haengt am Schalter data-dunkel', geschuetzt,
         'bausteine.css faerbt :root ohne Schalter dunkel');
    push('DESIGN: SubZeit hat den Schalter gesetzt', zeit.indexOf('data-dunkel="auto"') >= 0,
         'submit/zeit/index.html fehlt data-dunkel="auto"');
  }
}
if (!R) { console.log('Kein Ergebnis – selfTest() nicht erreichbar.'); process.exit(1); }
console.log('\n=== SUBMITONE · Suite-Kern · Selbsttest (headless) ===');
for (const r of R.R) console.log((r.ok ? 'OK   ' : 'FAIL ') + '| ' + r.name + (r.msg ? '  → ' + r.msg : ''));
console.log('------------------------------------------');
console.log(R.pass + ' OK, ' + R.fail + ' Fehler\n');
process.exit(R.fail ? 2 : 0);
