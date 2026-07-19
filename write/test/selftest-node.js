// Headless-Regressionstest für SUBMIT PAPER: lädt ../write.js mit gestubbten Browser-Globals und führt selfTest() in Node aus.
// Aufruf:  node write/test/selftest-node.js   (Exit 0 = OK, 2 = Fehler)
// Prüft die DOM-freie Kernlogik: A1-Adressierung, toNum, Formel-Engine (Calc), gridToHtml. Muster wie pdf/test.
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const file = path.join(__dirname, '..', 'write.js');
let src = fs.readFileSync(file, 'utf8');
src = src.replace(/\n\s*init\(\);\s*$/, '\n');   // Auto-Start (init(); am Ende) im Test nicht ausführen – nur Definitionen laden

function makeMagic() {
  const fn = function () { return proxy; };
  const proxy = new Proxy(fn, {
    get(t, prop) {
      if (prop === Symbol.toPrimitive) return () => 0;
      if (prop === Symbol.iterator) return function* () { };
      if (prop === 'length') return 0;
      if (prop === 'then') return undefined;
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
sandbox.requestAnimationFrame = () => 0; sandbox.cancelAnimationFrame = () => { }; sandbox.queueMicrotask = () => { };
sandbox.URLSearchParams = URLSearchParams; sandbox.TextEncoder = TextEncoder; sandbox.TextDecoder = TextDecoder;
sandbox.atob = s => Buffer.from(s, 'base64').toString('binary'); sandbox.btoa = s => Buffer.from(s, 'binary').toString('base64');
sandbox.crypto = { getRandomValues: a => a, randomUUID: () => 'x', subtle: magic };
sandbox.performance = { now: () => 0 };
sandbox.location = { search: '', origin: 'http://localhost', href: 'http://localhost/write/', hash: '', pathname: '/write/', reload: () => { } };
sandbox.navigator = { userAgent: 'node', clipboard: { writeText: () => Promise.resolve() }, language: 'de' };
sandbox.localStorage = { getItem: () => null, setItem: () => { }, removeItem: () => { }, clear: () => { } };
sandbox.sessionStorage = { getItem: () => null, setItem: () => { }, removeItem: () => { } };
sandbox.matchMedia = () => ({ matches: false, addEventListener: () => { }, addListener: () => { } });
sandbox.getComputedStyle = () => magic; sandbox.devicePixelRatio = 1;
sandbox.alert = () => { }; sandbox.confirm = () => true; sandbox.prompt = () => null;
sandbox.fetch = () => Promise.resolve({ ok: false, json: () => Promise.resolve({}), text: () => Promise.resolve('') });
sandbox.AbortController = class { constructor() { this.signal = {}; } abort() { } };
sandbox.history = { replaceState: () => { }, pushState: () => { } };
sandbox.URL = class { static createObjectURL() { return ''; } static revokeObjectURL() { } };
sandbox.Blob = class { }; sandbox.File = class { }; sandbox.Image = class { }; sandbox.FileReader = class { readAsDataURL() { } readAsText() { } };
sandbox.indexedDB = magic;
sandbox.IntersectionObserver = class { observe() { } disconnect() { } };
sandbox.ResizeObserver = class { observe() { } disconnect() { } };
sandbox.MutationObserver = class { observe() { } disconnect() { } };
sandbox.document = makeMagic(); sandbox.addEventListener = () => { }; sandbox.removeEventListener = () => { };

src += '\n;try{ globalThis.__R = (typeof selfTest===\"function\") ? selfTest() : {R:[{name:\"selfTest fehlt\",ok:false}],pass:0,fail:1}; }catch(e){ globalThis.__ERR = (e&&e.stack)||String(e); }';

try { vm.createContext(sandbox); vm.runInContext(src, sandbox, { filename: 'write.js', timeout: 20000 }); }
catch (e) { console.log('LADEFEHLER beim Auswerten von write.js:\n', (e && e.stack) || e); process.exit(1); }

if (sandbox.__ERR) { console.log('SELFTEST-FEHLER:\n', sandbox.__ERR); process.exit(1); }
const R = sandbox.__R;
if (R) {  // Verhaltens-Waechter am Quelltext (einfache Textsuche, keine Regex-Fallen)
  const q = fs.readFileSync(file, 'utf8');
  const von = q.indexOf('function liveExtendCell');
  const bis = q.indexOf('function endEdit', von);
  const rumpf = von >= 0 && bis > von ? q.slice(von, bis) : '';
  // Die Zelle muss beim Schreiben ueber die Spalten wachsen - auch im Write-Modus.
  // Ein frueher Ausstieg bei dokumentModus() hat genau das einmal verhindert.
  const bricht = rumpf.indexOf('dokumentModus()) { td.style') >= 0 || rumpf.indexOf('dokumentModus()) return') >= 0;
  R.R.push({ name: 'Zellen wachsen beim Schreiben ueber die Spalten (kein Ausstieg im Write-Modus)', ok: !bricht });
  bricht ? R.fail++ : R.pass++;
}

if (R) {  // CSS-Waechter: im JS verwendete Klassen muessen im Stylesheet existieren.
  // Anlass: ich habe zweimal eine Klasse benutzt (rib-sep, rcol), die es gar nicht gab -
  // das Element bleibt dann unsichtbar oder unformatiert, ohne jede Fehlermeldung.
  const cssTxt = fs.readFileSync(__dirname + '/../write.css', 'utf8');
  let jsTxt = fs.readFileSync(file, 'utf8');
  // Den Selbsttest ausklammern: dort stehen erfundene Klassennamen als Testdaten,
  // die es im Stylesheet natuerlich nicht gibt - sonst nur Fehlalarme.
  const stStart = jsTxt.indexOf('function selfTest');
  if (stStart > 0) jsTxt = jsTxt.slice(0, stStart);
  const gefunden = new Set();
  const re = /class="([a-zA-Z][a-zA-Z0-9 _-]*)"/g;
  let mm;
  while ((mm = re.exec(jsTxt))) mm[1].split(/\s+/).forEach(k => { if (k) gefunden.add(k); });
  const fehlend = [...gefunden].filter(k => !new RegExp('\.' + k + '(?![a-zA-Z0-9_-])').test(cssTxt));
  R.R.push({ name: 'CSS: jede im JS gesetzte Klasse hat eine Regel (' + gefunden.size + ' geprueft)',
             ok: fehlend.length === 0, msg: fehlend.join(', ') });
  fehlend.length ? R.fail++ : R.pass++;
}

if (R) {  // Quelltext-Waechter: Aufrufe, die zur Laufzeit sicher fehlschlagen wuerden
  const src0 = fs.readFileSync(file, 'utf8');
  const pruef = [
    ['syncHF() ohne Element', /[^a-zA-Z_$]syncHF\(\s*\)/],
    ['capturePage(true) fehlt beim Seitenwechsel', /switchPage[\s\S]{0,120}capturePage\(\s*\)/],
  ];
  pruef.forEach(([name, re]) => {
    const schlecht = re.test(src0);
    R.R.push({ name: 'Quelltext: ' + name, ok: !schlecht });
    schlecht ? R.fail++ : R.pass++;
  });
}
if (!R) { console.log('Kein Ergebnis – selfTest() nicht erreichbar.'); process.exit(1); }
console.log('\n=== SUBMIT PAPER · Selbsttest (headless) ===');
for (const r of R.R) console.log((r.ok ? 'OK   ' : 'FAIL ') + '| ' + r.name + (r.msg ? '  → ' + r.msg : ''));
console.log('------------------------------------------');
console.log(R.pass + ' OK, ' + R.fail + ' Fehler\n');
process.exit(R.fail ? 2 : 0);
