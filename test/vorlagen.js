/* Vorlagen: geht das Programm auch als Kartensammlung auf?
   --------------------------------------------------------------------
   Aufruf:  node test/vorlagen.js        (Exit 0 = alles OK, 2 = Fehler)

   selfTest() prüft die Vorlagen-Logik für sich. Hier wird sie BENUTZT:
   Ein Projekt bekommt die Vorlage «Sammlung», eine Liste wird eingelesen
   und danach werden die Ansichten wirklich gezeichnet.

   Warum das nötig ist: Eine Beschriftung, die auf ein Projekt zeigt, das
   an dieser Stelle gar nicht im Zugriff ist, fällt in keinem Logik-Test
   auf — erst beim Zeichnen. Genau solche Fehler sucht diese Datei.
*/
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const file = path.join(__dirname, '..', 'app.js');
let src = fs.readFileSync(file, 'utf8');

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

/* Statt in den Magier zu schreiben, fangen wir das erzeugte HTML ab —
   nur so lässt sich prüfen, was tatsächlich auf der Seite steht. */
src += `
;globalThis.__blatt = '';
;globalThis.render = function (html) { globalThis.__blatt = String(html); };
;globalThis.__lauf = function () {
  const raus = [];
  state = { projekte: [], kontakte: [], dokumente: [], vorlage: 'bau', woerter: {} };
  const p = {
    id: 'p_sammlung', name: 'Yu-Gi-Oh Sammlung', ort: 'Luzern', bauherr: '', projektleiter: '',
    vorlage: 'sammlung', vergaben: [], protokolle: [], entscheidungen: [], bezugsfirmen: [],
    geschosseListe: [], auflagen: [], mitglieder: [], bauteile: [], optionen: [], termine: [],
    finanz: { land: 0, honorare: 0, finanzierung: 0 },
  };
  state.projekte.push(p);
  setVorlageCtx(p);
  return { p, raus };
};
;globalThis.__vorlagen = function () { return VORLAGEN.map(v => v.key); };
;globalThis.__bauProjekt = function (muster) {
  const b = Object.assign({}, muster, { id: 'p_bau', name: 'Umbau Musterstrasse', vorlage: 'bau' });
  state.projekte.push(b); setVorlageCtx(b); return b;
};`;

src += "\n;try{ globalThis.__ERG = globalThis.__lauf(); }catch(e){ globalThis.__ERR = (e&&e.stack)||String(e); }";

try { vm.createContext(sandbox); vm.runInContext(src, sandbox, { filename: 'app.js', timeout: 20000 }); }
catch (e) { console.log('LADEFEHLER:\n', (e && e.stack) || e); process.exit(1); }
if (sandbox.__ERR) { console.log('FEHLER beim Vorbereiten:\n' + sandbox.__ERR); process.exit(2); }

const R = []; let pass = 0, fail = 0;
const ok = (name, cond, msg) => { const good = !!cond; R.push({ name, ok: good, msg: good ? '' : (msg || '') }); good ? pass++ : fail++; };
const eq = (name, got, exp) => ok(name, JSON.stringify(got) === JSON.stringify(exp), 'erwartet ' + JSON.stringify(exp) + ', bekam ' + JSON.stringify(got));
/** Eine Ansicht wirklich zeichnen und das Blatt zurückgeben. */
function zeichne(name, fn) {
  sandbox.__blatt = '';
  try { fn(); return sandbox.__blatt; }
  catch (e) { ok(name + ' zeichnet ohne Ausnahme', false, (e && e.message) || String(e)); return ''; }
}

const p = sandbox.__ERG.p;

/* ---- 1) Die Liste kommt herein ---- */
const liste = [
  'Nr.;Objekt;Einstand;Marktwert;Angebot;Angebot bei;Erhalten;Status;Notiz',
  '101;Blauäugiger weisser Drache, 1. Auflage;40;320;295;Cardmarket;;Angeboten;Near Mint',
  '104;Stardust Dragon, Ghost Rare;15;180;;;;Im Bestand;',
  '202;Display Legend of Blue Eyes;120;900;850;Ricardo;850;Verkauft;versiegelt',
].join('\n');

const erg = sandbox.csvZuPosten(liste, p);
ok('Liste wird ohne Meldung verstanden', !erg.fehler, erg.fehler);
eq('drei Zeilen erkannt', erg.posten.length, 3);
const anz = sandbox.csvPostenAnlegen(p.id, erg.posten);
eq('drei Objekte angelegt', anz, 3);
eq('sie stehen im Projekt', p.vergaben.length, 3);

/* Und die Zahlen kommen dort an, wo die Kostenübersicht sie sucht. */
const drache = p.vergaben[0];
eq('Einstand steht in der Schätzung', drache.schaetzung, 40);
eq('Marktwert steht als Angebot', sandbox.bestBetrag(drache), 320);
eq('Angebotspreis steht im Betrag', drache.betrag, 295);
eq('Marktplatz steht in der Firma', drache.firma, 'Cardmarket');

const display = p.vergaben[2];
const z = sandbox.kostenZeile(display);
eq('verkauftes Stück: Angebot zählt als Erlös', z.wv, 850);
eq('verkauftes Stück: Eingang ist verbucht', z.fakturiert, 850);
eq('verkauftes Stück: nichts mehr ausstehend', z.offenRg, 0);

/* ---- 2) Die Ansichten sprechen die neue Sprache ---- */
const kosten = zeichne('Kostenübersicht', () => sandbox.viewKosten(p.id));
ok('Kostenübersicht: Spalte heisst Einstand, nicht KV', /Einstand/.test(kosten) && !/>KV</.test(kosten));
ok('Kostenübersicht: Marktwert und Erlös stehen im Kopf', /Marktwert/.test(kosten) && /Erlös/.test(kosten));
ok('Kostenübersicht: kein Wort vom Bau mehr',
  !/Arbeitsgattung|Werkvertrag|Baukosten|Unternehmer/.test(kosten),
  (kosten.match(/Arbeitsgattung|Werkvertrag|Baukosten|Unternehmer/g) || []).join(', '));
ok('Kostenübersicht: Gruppen aus dem Sammlungs-Katalog',
  /Sammelkarten/.test(kosten) && !/Rohbau/.test(kosten));
ok('Kostenübersicht: Knopf zum Einlesen ist da', /liste-einlesen/.test(kosten));
ok('Kostenübersicht: die Marktplätze stehen in der Zeile', /Cardmarket/.test(kosten) && /Ricardo/.test(kosten));
ok('Kostenübersicht: kein U-Wert-Reiter in einer Sammlung', !/\/uwert/.test(kosten));

const detail = zeichne('Projektübersicht', () => sandbox.viewProjektDetail(p.id));
ok('Projektübersicht: Bestand statt Vergaben', /Bestand/.test(detail));
ok('Projektübersicht: Stationen in der Sprache der Sammlung', /Verkauft|Angeboten/.test(detail));

const einst = zeichne('Einstellungen', () => sandbox.viewEinstellungen());
ok('Einstellungen: die Vorlagen stehen zur Wahl', /vorlage-standard/.test(einst));
ok('Einstellungen: alle vier Vorlagen erscheinen',
  sandbox.__vorlagen().every(k => einst.indexOf(String.fromCharCode(34) + k + String.fromCharCode(34)) >= 0));
ok('Einstellungen: das Projekt lässt sich umstellen', /vorl-proj/.test(einst));
ok('Einstellungen: die Vorlagendatei ist herunterladbar', /vorlage-csv/.test(einst));

/* ---- 3) Der Bau-Fall bleibt, wie er war ---- */
const bauP = sandbox.__bauProjekt(p);
const bauKosten = zeichne('Baukostenübersicht', () => sandbox.viewKosten(bauP.id));
ok('Bau bleibt Bau: BKP, Arbeitsgattung, Unternehmer',
  /BKP/.test(bauKosten) && /Arbeitsgattung/.test(bauKosten) && /Unternehmer/.test(bauKosten));
ok('Bau bleibt Bau: Total Baukosten', /Total Baukosten/.test(bauKosten));
ok('Bau bleibt Bau: MwSt-Umschalter vorhanden', /kosten-brutto/.test(bauKosten));

sandbox.setVorlageCtx({ vorlage: 'unterschriften' });
ok('Unterschriften: kein MwSt-Umschalter', sandbox.mwstAnsichtBtn({ vorlage: 'unterschriften', id: 'x' }) === '');

/* ---- Bilanz ---- */
R.forEach(r => console.log((r.ok ? 'OK   | ' : 'FAIL | ') + r.name + (r.msg ? '  → ' + r.msg : '')));
console.log('------------------------------------------');
console.log(pass + ' OK, ' + fail + ' Fehler');
process.exit(fail ? 2 : 0);
