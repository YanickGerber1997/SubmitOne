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
if (!R) { console.log('Kein Ergebnis – selfTest() nicht erreichbar.'); process.exit(1); }
console.log('\n=== SUBMITONE · Suite-Kern · Selbsttest (headless) ===');
for (const r of R.R) console.log((r.ok ? 'OK   ' : 'FAIL ') + '| ' + r.name + (r.msg ? '  → ' + r.msg : ''));
console.log('------------------------------------------');
console.log(R.pass + ' OK, ' + R.fail + ' Fehler\n');
process.exit(R.fail ? 2 : 0);
