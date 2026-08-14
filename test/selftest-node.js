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
  const festeGroessen = (ohneKommentar.match(/font-size:\s*[0-9.]+px/g) || []);
  push('SKALA: styles.css ohne feste Schriftgroessen', !festeGroessen.length,
       festeGroessen.length + ' uebrig, z.B. ' + festeGroessen.slice(0, 3).join(' / '));

  const STUFEN = ['--t-2xs', '--t-xs', '--t-s', '--t-m', '--t-l', '--t-xl', '--t-2xl', '--t-3xl'];
  const benutzt = [...new Set((ohneKommentar.match(/var\(\s*(--t-[a-z0-9]+)/g) || [])
                    .map(s => s.replace(/var\(\s*/, '')))];
  const fremd = benutzt.filter(n => STUFEN.indexOf(n) < 0);
  push('SKALA: nur die acht gemeinsamen Stufen in Gebrauch', !fremd.length, 'unbekannt: ' + fremd.join(', '));

  /* Die rem-Basis gehoert dem Browser. Eine Schriftgroesse auf html
     verstellt sie und macht jedes .875rem der Skala zu etwas anderem als
     in SubZeit - genau der Fehler, der beim Umstellen fast passiert waere. */
  const htmlRegel = /(^|\})\s*html\s*(,[^{]*)?\{([^}]*)\}/g;
  let hm, htmlSchrift = false;
  while ((hm = htmlRegel.exec(ohneKommentar))) if (/font-size/.test(hm[3])) htmlSchrift = true;
  push('SKALA: html behaelt die rem-Basis des Browsers', !htmlSchrift,
       'eine html-Regel setzt font-size - dann bedeutet --t-m nicht mehr 14px');

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
  const GRUND = ['family=Inter:wght@300;400;500;600;700', 'family=Quicksand:wght@'];
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
