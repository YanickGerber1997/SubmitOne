// Leitet die bisherigen Demo-Daten aus app.js in echte Projektdateien aus.
//
// Aufruf:  node test/demo-ausleiten.js  [Zielordner]
//   Vorgabe:  privat\Projekte
//
// Warum es das gibt
// -----------------
// In app.js standen echte Bauvorhaben mit Namen, Adressen, Offertsummen und
// einer vollstaendigen Lieferantenliste. app.js ist oeffentlich — dort haben
// sie nichts verloren. Dieses Skript schreibt sie einmalig als .submit-Dateien
// heraus; danach wird demoData() geleert.
//
// Das Ergebnis ist genau der Ordneraufbau, den der Ordner-Modus erwartet:
//   <Ziel>\<Projektname>\<Projektname>.submit
//   <Ziel>\Allgemein.subone
// In SubmitOne dann: Einstellungen -> Daten -> Arbeitsordner waehlen.

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const nodeCrypto = require('crypto');

const Uebersetzer = require('../submit/kern/uebersetzer.js');

const ziel = process.argv[2] || path.join(__dirname, '..', 'privat', 'Projekte');

/* ---- app.js in einer Attrappe laden (wie test/selftest-node.js) ---- */

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
sandbox.requestAnimationFrame = () => 0; sandbox.cancelAnimationFrame = () => { };
sandbox.queueMicrotask = () => { };
sandbox.URLSearchParams = URLSearchParams; sandbox.TextEncoder = TextEncoder; sandbox.TextDecoder = TextDecoder;
sandbox.atob = s => Buffer.from(s, 'base64').toString('binary'); sandbox.btoa = s => Buffer.from(s, 'binary').toString('base64');
// Echter Zufall: sonst bekaemen alle Eintraege dieselbe Kennung.
sandbox.crypto = { getRandomValues: a => nodeCrypto.randomFillSync(a), randomUUID: () => nodeCrypto.randomUUID(), subtle: magic };
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

let src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
src += `
;try{
  if (typeof demoData !== 'function') { globalThis.__ERR = 'demoData() nicht gefunden'; }
  else {
    state = demoData();
    if (typeof migrate === 'function') migrate();
    globalThis.__STATE = state;
  }
}catch(e){ globalThis.__ERR = (e && e.stack) || String(e); }`;

try { vm.createContext(sandbox); vm.runInContext(src, sandbox, { filename: 'app.js', timeout: 30000 }); }
catch (e) { console.log('LADEFEHLER:\n', (e && e.stack) || e); process.exit(1); }

if (sandbox.__ERR) { console.log('FEHLER:\n', sandbox.__ERR); process.exit(1); }

const zustand = sandbox.__STATE;
if (!zustand || !Array.isArray(zustand.projekte)) { console.log('Kein Zustand erhalten.'); process.exit(1); }

/* ---- Schreiben ---- */

function alsOrdnername(s) {
  return String(s || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/[.\s]+$/, '').trim() || 'Projekt';
}

fs.mkdirSync(ziel, { recursive: true });

console.log('\n=== Demo-Daten ausleiten ===');
let anz = 0;
for (const p of zustand.projekte) {
  const name = alsOrdnername(p.name);
  const ordner = path.join(ziel, name);
  fs.mkdirSync(ordner, { recursive: true });

  const mappe = Uebersetzer.zuMappe(p);
  const datei = path.join(ordner, name + '.submit');
  fs.writeFileSync(datei, JSON.stringify(mappe, null, 1), 'utf8');

  // Gegenprobe: laesst sich die Datei verlustfrei zurueckwandeln?
  const zurueck = Uebersetzer.ausMappe(JSON.parse(fs.readFileSync(datei, 'utf8')));
  const gleich = JSON.stringify(sortiert(p)) === JSON.stringify(sortiert(zurueck));

  console.log(`  ${name}`);
  console.log(`     ${mappe.gewerke.length} Gewerke · ${(fs.statSync(datei).size / 1024).toFixed(1)} KB · Rueckwandlung ${gleich ? 'verlustfrei OK' : 'ABWEICHUNG!'}`);
  if (!gleich) process.exitCode = 2;
  anz++;
}

const allgemein = {
  format: 'submit.allgemein',
  fassung: 1,
  kontakte: zustand.kontakte || [],
  dokumente: zustand.dokumente || []
};
fs.writeFileSync(path.join(ziel, 'Allgemein.subone'), JSON.stringify(allgemein, null, 1), 'utf8');
console.log(`  Allgemein.subone`);
console.log(`     ${allgemein.kontakte.length} Kontakte · ${allgemein.dokumente.length} Dokumente`);

console.log(`\n${anz} Projekte geschrieben nach:\n  ${path.resolve(ziel)}\n`);
console.log('In SubmitOne oeffnen:  Einstellungen -> Daten -> Arbeitsordner waehlen');
console.log('Der Ordner "privat" steht in .gitignore und geht nie ins Repository.\n');

/* Feldreihenfolge egal, Inhalt nicht. */
function sortiert(o) {
  if (Array.isArray(o)) return o.map(sortiert);
  if (o && typeof o === 'object') {
    const raus = {};
    Object.keys(o).sort().forEach(k => { raus[k] = sortiert(o[k]); });
    return raus;
  }
  return o;
}
