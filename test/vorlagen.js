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
;globalThis.__kursSetzen = function (a) { return kursSetzen(a); };
;globalThis.__kurse = function () { return kurse; };
;globalThis.__katalogCodes = function (k) { return (VORLAGEN.find(v => v.key === k).katalog || []).map(b => b.code); };
;globalThis.__pruefGruppen = function () { return pruefCtx ? pruefCtx.gruppen : []; };
;globalThis.__ordZeilen = function () { return ordnungCtx ? ordnungCtx.zeilen : []; };
;globalThis.__handelBlatt = function (pid, vid) { viewHandel(pid, vid); return globalThis.__blatt; };
;globalThis.__uebersicht = function (pid) { viewProjektDetail(pid); return globalThis.__blatt; };
;globalThis.__dkKacheln = function () { return dashKonfigCtx ? dashKonfigCtx.kacheln : []; };
;globalThis.__alleVorlagen = function () { return VORLAGEN.map(v => v.key); };
;globalThis.__istArt = function (k) { return DASH_ARTEN.some(a => a.key === k); };
;globalThis.__dienste = function () { return NACHSCHLAG_DIENSTE; };
;globalThis.__dienstListe = function (p) { return dienstListe(p); };
;globalThis.__sprachen = function () { return KARTEN_SPRACHEN; };
;globalThis.__ygoMitSprache = function (sp) {
  /* Was nachschlagSuche mit einem Yu-Gi-Oh-Treffer macht, wenn eine
     Sprache gesetzt ist - ohne Netz nachgestellt. */
  return { name: 'Invoked Sorath', sprache: sp };
};
;globalThis.__vorschlagKatalog = function (p) { return vorschlagKatalog(p); };
;globalThis.__kostenBlatt = function (pid) { viewKosten(pid); return globalThis.__blatt; };
;globalThis.__ebenenSummen = function (p) {
  const w = liste => liste.reduce((a, v) => a + kostenZeile(v).prognose, 0);
  const vs = (p.vergaben || []).filter(weistAus);
  return {
    gold: w(vs.filter(v => v.symbol === 'XAU')),
    silber: w(vs.filter(v => v.symbol === 'XAG')),
    edel: w(vs.filter(v => String(v.kategorie)[0] === '2')),
    krypto: w(vs.filter(v => String(v.kategorie)[0] === '1')),
    total: w(vs),
  };
};
;globalThis.__depotZweiKlassen = function () {
  kursSetzen({ rates: { CHF: 0.9333, USD: 1.16 }, date: '2026-08-20' });
  const p = { id: 'p_zwei', name: 'Depot', vorlage: 'depot', vergaben: [],
    protokolle: [], entscheidungen: [], bezugsfirmen: [], geschosseListe: [], auflagen: [],
    mitglieder: [], bauteile: [], optionen: [], termine: [], finanz: {} };
  state.projekte.push(p); setVorlageCtx(p);
  const t = (nr, name, kat, preis) => ({ nummer: nr, name, art: 'x', kategorie: kat, preisChf: preis, einheit: 'oz', herkunft: 'q' });
  const mach = (tr, m, e, d, k) => { const po = kursZuPosten(tr, m, e, d); po.schaetzung = k; return po; };
  csvPostenAnlegen('p_zwei', [
    mach(t('XAU', 'Gold', '201', 3677.91), 1, 'oz', '2025-11-20', 3400),
    mach(t('XAU', 'Gold', '201', 3677.91), 20, 'g', '2026-07-04', 2600),
    mach(t('XAG', 'Silber', '201', 55.83), 500, 'g', '2026-01-15', 700),
    mach(t('BTC', 'Bitcoin', '101', 61681), 0.35, 'BTC', '2025-09-08', 18000),
  ]);
  return p;
};
;globalThis.__bauEinstufig = function () {
  const p = { id: 'p_bau1', name: 'Bau', vorlage: 'bau', vergaben: [],
    protokolle: [], entscheidungen: [], bezugsfirmen: [], geschosseListe: [], auflagen: [],
    mitglieder: [], bauteile: [], optionen: [], termine: [], finanz: {} };
  state.projekte.push(p); setVorlageCtx(p);
  csvPostenAnlegen('p_bau1', [
    { bkp: '211', gewerk: 'Baumeister', schaetzung: 250000, betrag: 232000, firma: 'Bau AG', status: 'vergeben' },
    { bkp: '281', gewerk: 'Boden', schaetzung: 48000, betrag: 0, firma: '', status: 'ausschreibung' },
  ]);
  return p;
};
;globalThis.__hatAusschreibung = function (k) { const v = VORLAGEN.find(x => x.key === k); return v.ausschreibung !== false; };
;globalThis.__stueckBlatt = function (pid, vid) { viewStueck(pid, vid); return globalThis.__blatt; };
;globalThis.__sammlungStueck = function () {
  const p = { id: 'p_st', name: 'Sammlung', vorlage: 'sammlung', vergaben: [],
    protokolle: [], entscheidungen: [], bezugsfirmen: [], geschosseListe: [], auflagen: [],
    mitglieder: [], bauteile: [], optionen: [], termine: [], finanz: {} };
  state.projekte.push(p); setVorlageCtx(p);
  csvPostenAnlegen('p_st', [{
    bkp: 'CORI-EN001', gewerk: 'Black Chaos', satz: 'Chaos Origins', seltenheit: 'Secret Rare',
    schaetzung: 5, marktwert: 52.57, betrag: 0, firma: '', erhalten: 0, status: 'ausschreibung',
    bild: 'https://images.ygoprodeck.com/images/cards_small/1.jpg',
    beschrieb: 'Secret Rare\\nCORI-EN001 - Chaos Origins\\nPasscode 1',
  }]);
  return p;
};
;globalThis.__depotMitChargen2 = function () {
  kursSetzen({ rates: { CHF: 0.9333, USD: 1.16 }, date: '2026-08-20' });
  const p = { id: 'p_dash', name: 'Depot', vorlage: 'depot', vergaben: [],
    protokolle: [], entscheidungen: [], bezugsfirmen: [], geschosseListe: [], auflagen: [],
    mitglieder: [], bauteile: [], optionen: [], termine: [], finanz: {} };
  state.projekte.push(p); setVorlageCtx(p);
  const gold = { nummer: 'XAU', name: 'Gold', art: 'Edelmetall', kategorie: '201',
    preisChf: 3677.91, einheit: 'oz', herkunft: 'gold-api' };
  const silber = { nummer: 'XAG', name: 'Silber', art: 'Edelmetall', kategorie: '201',
    preisChf: 55.83, einheit: 'oz', herkunft: 'gold-api' };
  const mach = (t, m, e, d, k) => { const po = kursZuPosten(t, m, e, d); po.schaetzung = k; return po; };
  csvPostenAnlegen('p_dash', [
    mach(gold, 1, 'oz', '2025-11-20', 3400),
    mach(gold, 20, 'g', '2026-07-04', 2600),
    mach(silber, 500, 'g', '2026-01-15', 700),
  ]);
  return p;
};
;globalThis.__startseite = function () {
  /* Vier Projekte, vier Vorlagen — dieselbe Lage wie beim Nutzer.
     Der bisherige Zustand wird gemerkt und am Ende zurückgegeben:
     Eine Prüfung darf denen nach ihr nicht den Boden wegziehen. */
  const merkState = state, merkCtx = vorlageCtx;
  state = { projekte: [], kontakte: [], dokumente: [], vorlage: 'bau', woerter: {} };
  const leer = () => ({ protokolle: [], entscheidungen: [], bezugsfirmen: [], geschosseListe: [],
    auflagen: [], mitglieder: [], bauteile: [], optionen: [], termine: [], finanz: {} });
  const mach = (id, name, vorlage) => {
    const p = Object.assign({ id, name, vorlage, vergaben: [], ort: '–', bauherr: '–', projektleiter: '–' }, leer());
    state.projekte.push(p); setVorlageCtx(p); return p;
  };
  mach('d1', 'Umbau EFH', 'bau');
  csvPostenAnlegen('d1', [{ bkp: '211', gewerk: 'Baumeister', schaetzung: 250000, betrag: 232000, firma: 'Bau AG', status: 'vergeben' }]);
  mach('d2', 'Sammlung', 'sammlung');
  csvPostenAnlegen('d2', [{ bkp: 'CORI-EN001', gewerk: 'Black Chaos', satz: 'Chaos Origins', schaetzung: 5, marktwert: 52.57 }]);
  mach('d3', 'Depot', 'depot');
  csvPostenAnlegen('d3', [{ bkp: 'XAU', symbol: 'XAU', satz: 'Gold', kategorie: '201', menge: 12, einheit: 'g', kursChf: 3677.91, datum: '2026-03-12', schaetzung: 1450, marktwert: 1418.97 }]);
  mach('d4', 'Initiative', 'unterschriften');
  csvPostenAnlegen('d4', [{ bkp: '101', gewerk: 'Zürich', schaetzung: 4000, marktwert: 3600, betrag: 3200, firma: 'Team', status: 'vergeben' }]);
  setVorlageCtx(null);
  viewDashboard();
  const html = globalThis.__blatt;
  const geld = state.projekte.filter(x => istGeld(x));
  const volumen = { projekte: geld.length, summe: geld.reduce((a, x) => a + projektVolumen(x), 0) };
  const stand = vorlageKey(null);
  state = merkState; setVorlageCtx(merkCtx);
  return { html, volumen, stand };
};
;globalThis.__depotMitChargen = function () {
  kursSetzen({ rates: { CHF: 0.9333, USD: 1.16 }, date: '2026-08-20' });
  const p = { id: 'p_dep', name: 'Depot', vorlage: 'depot', vergaben: [],
    protokolle: [], entscheidungen: [], bezugsfirmen: [], geschosseListe: [], auflagen: [],
    mitglieder: [], bauteile: [], optionen: [], termine: [], finanz: {} };
  state.projekte.push(p); setVorlageCtx(p);
  const gold = { nummer: 'XAU', name: 'Gold', art: 'Edelmetall', kategorie: '201',
    preisChf: 3677.91, einheit: 'oz', herkunft: 'gold-api' };
  const silber = { nummer: 'XAG', name: 'Silber', art: 'Edelmetall', kategorie: '201',
    preisChf: 55.83, einheit: 'oz', herkunft: 'gold-api' };
  const mach = (t, m, e, d, k) => { const po = kursZuPosten(t, m, e, d); po.schaetzung = k; return po; };
  csvPostenAnlegen('p_dep', [
    mach(gold, 1, 'oz', '2025-11-20', 3400),
    mach(gold, 12, 'g', '2026-03-12', 1450),
    mach(gold, 20, 'g', '2026-07-04', 2600),
    mach(silber, 500, 'g', '2026-01-15', 700),
    mach(silber, 250, 'g', '2026-06-02', 420),
  ]);
  return p;
};
;globalThis.__kursNetz = function (antworten) {
  /* Netz-Attrappe für den Kursweg: je Aufruf die nächste Antwort. */
  let i = 0;
  globalThis.fetch = () => {
    const a = antworten[i++];
    if (a instanceof Error) return Promise.reject(a);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(a) });
  };
};
;globalThis.__ordSetzen = function (zeilen) { if (ordnungCtx) ordnungCtx.zeilen = zeilen; };
;globalThis.__projektMitOrdnung = function () {
  const p = { id: 'p_ord', name: 'Ordnung', vorlage: 'sammlung', vergaben: [],
    protokolle: [], entscheidungen: [], bezugsfirmen: [], geschosseListe: [], auflagen: [],
    mitglieder: [], bauteile: [], optionen: [], termine: [], finanz: {} };
  state.projekte.push(p); return p;
};
;globalThis.__sammlungMitOffenen = function () {
  /* Ein zweites Projekt, damit die Prüfungen oben unberührt bleiben.
     Vier Posten: dreimal dieselbe Nummer mit zwei Möglichkeiten,
     einmal eine Nummer mit drei. */
  kursSetzen({ rates: { CHF: 0.9333, USD: 1.16 }, date: '2026-08-20' });
  const zwei = [
    { code: 'CORI-EN003', name: 'Chaos Origins', seltenheit: 'Starlight Rare', preisUsd: 0 },
    { code: 'CORI-EN003', name: 'Chaos Origins', seltenheit: 'Super Rare', preisUsd: 0.4 },
  ];
  const drei = [
    { code: 'CORI-EN028', name: 'Chaos Origins', seltenheit: 'Secret Rare', preisUsd: 3.8 },
    { code: 'CORI-EN028', name: 'Chaos Origins', seltenheit: 'Starlight Rare', preisUsd: 0 },
    { code: 'CORI-EN028', name: 'Chaos Origins', seltenheit: 'Ultra Rare', preisUsd: 1.2 },
  ];
  const mach = (bkp, name, auflagen) => ({
    bkp, gewerk: name, satz: 'Chaos Origins', seltenheit: '', passcode: '111',
    schaetzung: 0, marktwert: 0.5, betrag: 0, firma: '', erhalten: 0, status: 'ausschreibung',
    beschrieb: '⚑ Auflage nicht bestimmt — ' + auflagen.length + ' mögliche.\\nRitual Monster\\nPasscode 111',
    frist: '', bild: '', pruefen: true, kategorie: '101', auflagenOffen: auflagen,
  });
  const p = {
    id: 'p_offen', name: 'Offene Auflagen', vorlage: 'sammlung', vergaben: [],
    protokolle: [], entscheidungen: [], bezugsfirmen: [], geschosseListe: [], auflagen: [],
    mitglieder: [], bauteile: [], optionen: [], termine: [], finanz: {},
  };
  state.projekte.push(p); setVorlageCtx(p);
  csvPostenAnlegen('p_offen', [
    mach('CORI-EN003', 'Celtic Mystic', zwei),
    mach('CORI-EN003', 'Celtic Mystic', zwei),
    mach('CORI-EN003', 'Celtic Mystic', zwei),
    mach('CORI-EN028', 'Black Luster Soldier', drei),
  ]);
  return p;
};
;globalThis.__scanBlatt = function (pid, antwort) {
  /* Das Fenster ohne Netz füllen: Treffer direkt setzen und zeichnen
     lassen. Geprüft wird, was der Mensch zu sehen bekommt. */
  const erg = ygoAuswerten(antwort, { art: 'passcode', wert: '0' });
  let inhalt = '';
  const altModal = openModal, altZiel = $;
  scanCtx = { pid, treffer: erg.treffer, gewaehlt: 0, erfasst: [], meldung: '', sucht: false, filter: '' };
  const t = scanCtx.treffer[0];
  const p = findProjekt(pid);
  inhalt = scanKarteHtml(t, p) + scanAuflagenHtml(t);
  return inhalt;
};
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
ok('Kostenübersicht: kein Bau-Wort in den Gruppen', !/Rohbau|Ausbau 1/.test(kosten));
ok('Kostenübersicht: Knopf zum Einlesen ist da', /liste-einlesen/.test(kosten));
ok('Kostenübersicht: die Marktplätze stehen in der Zeile', /Cardmarket/.test(kosten) && /Ricardo/.test(kosten));
/* Der Marktpreis ist kein Bieter: Eine Karte, die nirgends liegt,
   ist «nicht angeboten» und nicht «1 eingeladen · 1 Offerte». */
ok('Kostenübersicht: keine Ausschreibungs-Sprache in der Sammlung',
  !/eingeladen|Offerte/.test(kosten), (kosten.match(/.{0,25}(eingeladen|Offerte).{0,25}/) || [''])[0]);
ok('Kostenübersicht: was nirgends liegt, heisst «nicht angeboten»', /nicht angeboten/.test(kosten));
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

/* ---- 2c) Offene Auflagen bestimmen ----
   Der Weg, der bis v385 fehlte: eine Merkfahne schliessen, ohne die
   Karte neu zu erfassen. Gruppiert nach Nummer, weil man bei drei
   gleichen Karten einmal entscheidet und nicht dreimal. */
{
  const p3 = sandbox.__sammlungMitOffenen();
  eq('Vorbereitung: vier offene Posten', p3.vergaben.filter(v => v.pruefen).length, 4);

  sandbox.actOffenePruefen(p3.id);
  eq('gruppiert nach Nummer, nicht nach Zeile', sandbox.__pruefGruppen().length, 2);
  eq('drei Exemplare derselben Nummer in einer Gruppe',
    sandbox.__pruefGruppen()[0].vs.length, 3);

  /* Wer keine Starlight Rare besitzt, sagt das einmal — und alles,
     was danach nur noch eine Möglichkeit hat, ist bestimmt. */
  sandbox.pruefAus('Starlight Rare');
  const drei = p3.vergaben.filter(v => v.bkp === 'CORI-EN003');
  ok('Ausschluss bestimmt die eindeutig gewordene Nummer', drei.every(v => !v.pruefen),
    JSON.stringify(drei.map(v => v.pruefen)));
  eq('… mit der übrig gebliebenen Seltenheit', drei[0].seltenheit, 'Super Rare');
  ok('… die Fahnen-Zeile ist aus der Notiz verschwunden', drei[0].beschrieb.indexOf('⚑') < 0);
  ok('… und die Seltenheit steht jetzt darin', /Seltenheit: Super Rare/.test(drei[0].beschrieb));
  ok('… alle drei Exemplare, nicht nur eines', drei.length === 3 && drei.every(v => v.seltenheit === 'Super Rare'));

  /* Die dreifache Wahl bleibt offen — da hilft kein Ausschluss. */
  const acht = p3.vergaben.filter(v => v.bkp === 'CORI-EN028');
  ok('was mehrdeutig bleibt, bleibt offen', acht[0].pruefen);

  sandbox.pruefWaehlen(1, 2);
  eq('von Hand gewählt: Seltenheit gesetzt', acht[0].seltenheit, 'Ultra Rare');
  eq('von Hand gewählt: Fahne weg', acht[0].pruefen, false);
  eq('von Hand gewählt: der Preis DIESER Auflage gilt',
    sandbox.bestBetrag(acht[0]), Math.round(1.2 * sandbox.__kurse().usd * 100) / 100);
  ok('von Hand gewählt: Herkunft im Vermerk', /TCGPlayer USD 1\.20 für CORI-EN028/.test(acht[0].beschrieb));
  ok('nichts bleibt offen', p3.vergaben.every(v => !v.pruefen));
}

/* ---- 2d) Die Ordnung gehört dem Projekt ----
   Beim BKP ändert das nichts: Eine Norm schreibt niemand für sich um.
   Bei einer Sammlung ist es der ganze Punkt — wie jemand seine Sammlung
   ordnet, weiss nur er selbst. */
{
  const eigen = { vorlage: 'sammlung', katalog: [
    { code: '1', label: 'Zum Verkauf' },
    { code: '101', label: 'Gute Karten' },
    { code: '2', label: 'Behalte ich' },
  ] };

  eq('ohne eigene Ordnung gilt die der Vorlage',
    sandbox.katalogAktiv({ vorlage: 'sammlung' })[0].label, 'Einzelkarten');
  eq('mit eigener Ordnung gilt die eigene',
    sandbox.katalogAktiv(eigen)[0].label, 'Zum Verkauf');
  eq('… auch für die Überschriften', sandbox.gruppeTitel('1', [], eigen), 'Zum Verkauf');
  eq('… und die zweite', sandbox.gruppeTitel('2', [], eigen), 'Behalte ich');
  ok('… «Auflage noch offen» überlebt trotzdem',
    sandbox.gruppeTitel('?', [], eigen) === 'Auflage noch offen');
  eq('ein anderes Projekt bleibt unberührt',
    sandbox.gruppeTitel('1', [], { vorlage: 'sammlung' }), 'Einzelkarten');
  eq('und der Bau erst recht', sandbox.gruppeTitel('2', [], { vorlage: 'bau' }), 'Gebäude');

  /* Die einstellige Nummer ist die Überschrift — sonst müsste man zwei
     Listen pflegen, die auseinanderlaufen können. */
  const nurPositionen = { vorlage: 'sammlung', katalog: [{ code: '101', label: 'Gute Karten' }] };
  eq('ohne einstellige Nummer keine eigene Überschrift',
    sandbox.gruppeTitel('1', [], nurPositionen), 'Übrige');

  // Der Editor
  const pOrd = sandbox.__projektMitOrdnung();
  sandbox.actOrdnung(pOrd.id);
  eq('Editor startet mit dem Vorschlag der Vorlage',
    sandbox.__ordZeilen()[0].label, 'Einzelkarten');
  sandbox.ordnungNeu();
  ok('neue Zeile angehängt', sandbox.__ordZeilen().slice(-1)[0].code === '');
  sandbox.ordnungWeg(sandbox.__ordZeilen().length - 1);
  sandbox.__ordSetzen([{ code: '2', label: 'Behalte ich' }, { code: '1', label: 'Zum Verkauf' }]);
  sandbox.ordnungSortieren();
  eq('sortiert nach Nummer', sandbox.__ordZeilen().map(z => z.code), ['1', '2']);
  sandbox.ordnungSpeichern(pOrd.id);
  eq('gespeichert am Projekt', (pOrd.katalog || []).length, 2);
  eq('… und wirkt sofort', sandbox.gruppeTitel('1', [], pOrd), 'Zum Verkauf');

  // Was nicht durchgehen darf
  sandbox.actOrdnung(pOrd.id);
  sandbox.__ordSetzen([{ code: '1', label: 'A' }, { code: '1', label: 'B' }]);
  sandbox.ordnungSpeichern(pOrd.id);
  eq('doppelte Nummer wird nicht gespeichert', pOrd.katalog.length, 2);
  sandbox.__ordSetzen([{ code: '', label: 'Ohne Nummer' }]);
  sandbox.ordnungSpeichern(pOrd.id);
  eq('Zeile ohne Nummer wird nicht gespeichert', pOrd.katalog.length, 2);
}

/* ---- 2e) Handel statt Vergabe ----
   Hinter «Gewerke» steht beim Depot nicht eine Vergabe mit eingeladenen
   Unternehmern, sondern die Anlage mit ihren Käufen. */
{
  eq('Depot zeigt den Handel', sandbox.handelArt({ vorlage: 'depot' }), 'chargen');
  eq('ein Bauvorhaben die Vergabe', sandbox.handelArt({ vorlage: 'bau' }), '');
  eq('die Sammlung zeigt das einzelne Stueck', sandbox.handelArt({ vorlage: 'sammlung' }), 'stueck');
  ok('jede Vorlage ohne Ausschreibung hat eine eigene Ansicht',
    sandbox.__alleVorlagen().every(k => sandbox.__hatAusschreibung(k) || !!sandbox.handelArt({ vorlage: k })));

  /* Eine Karte hat keine eingeladenen Unternehmer, keinen
     Offertvergleich und keinen Werkvertrag. Genau das stand dort. */
  {
    const ps = sandbox.__sammlungStueck();
    const blatt = sandbox.__stueckBlatt(ps.id, ps.vergaben[0].id);
    ok('Stueck: die Karte im Titel', /Black Chaos/.test(blatt));
    ok('Stueck: Seltenheit und Satz in der Unterzeile',
      /Secret Rare/.test(blatt) && /Chaos Origins/.test(blatt));
    ok('Stueck: Einstand, Marktwert, Angebot als Zahlen',
      /Einstand/.test(blatt) && /Marktwert/.test(blatt) && /Angebot/.test(blatt));
    ok('Stueck: das Bild der Karte', /st-bild/.test(blatt));
    ok('Stueck: der Vermerk steht da', /Vermerk/.test(blatt));
    ok('Stueck: kein Wort von Vergabe oder Submittenten',
      !/Submittent|Werkvertrag|Zuschlag|Offertvergleich|eingeladen/.test(blatt),
      (blatt.match(/.{0,20}(Submittent|Werkvertrag|Zuschlag|Offertvergleich|eingeladen).{0,20}/) || [''])[0]);
    ok('Stueck: Verkauf buchen, solange nicht verkauft', /handel-verkauf/.test(blatt));

    ps.vergaben[0].pruefen = true;
    const mitFahne = sandbox.__stueckBlatt(ps.id, ps.vergaben[0].id);
    ok('Stueck: offene Auflage wird gesagt, nicht verschwiegen',
      /Auflage nicht bestimmt/.test(mitFahne) && /offen-pruefen/.test(mitFahne));
  }

  const pd = sandbox.__depotMitChargen();
  const gold = pd.vergaben.filter(v => v.symbol === 'XAU');
  eq('drei Chargen Gold, zwei Silber', [gold.length, pd.vergaben.length - gold.length], [3, 2]);
  eq('die Gruppe sammelt die Chargen einer Anlage',
    sandbox.handelGruppe(pd, gold[0]).length, 3);
  ok('… und nicht die der anderen',
    sandbox.handelGruppe(pd, gold[0]).every(c => c.symbol === 'XAU'));

  const sum = sandbox.handelSummen(pd, gold);
  eq('Einstand ist die Summe der Chargen', sum.einstand, 7450);
  ok('Bestand in Unzen: 1 oz + 32 g', Math.abs(sum.unzen - 2.0288) < 0.001, String(sum.unzen));
  ok('Wert kommt aus den Kursen', sum.wert > 7000 && sum.wert < 8000, String(sum.wert));

  /* Verkauftes zählt nicht mehr zum Bestand — der Erlös aber sehr wohl
     zum Wert, sonst verschwände er aus der Rechnung. */
  gold[0].status = 'vergeben'; gold[0].betrag = 4000;
  const nachher = sandbox.handelSummen(pd, gold);
  ok('verkaufte Charge fällt aus dem Bestand', nachher.unzen < sum.unzen, String(nachher.unzen));
  eq('… bleibt aber im Einstand', nachher.einstand, 7450);
  gold[0].status = 'ausschreibung'; gold[0].betrag = 0;

  // Und gezeichnet
  const blatt = sandbox.__handelBlatt(pd.id, gold[0].id);
  ok('Handel: die Anlage im Titel', /Gold/.test(blatt));
  ok('Handel: alle drei Kaufdaten', /20.11.2025/.test(blatt) && /12.03.2026/.test(blatt) && /04.07.2026/.test(blatt));
  ok('Handel: der Einstand je Einheit als eigene Spalte', /je Einheit/.test(blatt));
  ok('Handel: kein Wort von Vergabe oder Submittenten',
    !/Submittent|Werkvertrag|Zuschlag|eingeladen/.test(blatt),
    (blatt.match(/.{0,20}(Submittent|Werkvertrag|Zuschlag|eingeladen).{0,20}/) || [''])[0]);
  ok('Handel: die Seitenliste zeigt Anlagen, nicht Käufe',
    (blatt.match(/gw-side-item/g) || []).length === 2);
}

/* ---- 2f) Die Startseite, wenn Vorlagen nebeneinanderliegen ----
   Sie war ganz in Bau-Begriffen und zählte ausserdem falsch: Eine
   Unterschriftensammlung zählt Unterschriften, und die wanderten in
   dieselbe Franken-Summe wie alles andere. */
{
  const start = sandbox.__startseite();
  const dash = start.html;

  ok('Kachel Bau: die gewohnten Zahlen', /Zuschlag/.test(dash) && /Volumen/.test(dash));
  ok('Kachel Sammlung: ihre eigenen', /Karten/.test(dash) && /Einstand/.test(dash) && /Erlös/.test(dash));
  ok('Kachel Depot: ihre eigenen', /Positionen/.test(dash) && /Kurswert|Wert/.test(dash));
  ok('Kachel Unterschriften: zählt Stück, nicht Franken',
    /Sammelgebiete/.test(dash) && /Unt\./.test(dash), (dash.match(/.{0,30}Sammelgebiete.{0,60}/) || [''])[0]);
  ok('… und keine dieser Kacheln sagt «Zuschlag»',
    (dash.match(/Zuschlag/g) || []).length === 1, String((dash.match(/Zuschlag/g) || []).length));

  ok('Vorlagen-Marke statt Bauphase, wo es kein Bauvorhaben ist',
    (dash.match(/pc-vorlage/g) || []).length === 3, String((dash.match(/pc-vorlage/g) || []).length));

  /* Der eigentliche Rechenfehler: Stück und Franken in einer Summe. */
  const volumen = start.volumen;
  eq('quer gezählt wird nur, was in Franken rechnet', volumen.projekte, 3);
  ok('… die Unterschriften sind draussen', volumen.summe < 1000000 && volumen.summe > 0, String(volumen.summe));
  ok('… und es steht dabei, dass nicht alle gezählt sind',
    /von 4 Projekten/.test(dash), (dash.match(/.{0,20}von 4 Projekten.{0,20}/) || [''])[0]);

  ok('die Fristen-Tafel heisst nicht mehr «Submissionen»',
    /Nächste Fristen/.test(dash) && !/Submissionen/.test(dash));

  /* Und der Zusammenhang darf nicht kleben bleiben: Nach dem Zeichnen
     der letzten Kachel steht die Seite wieder in keinem Projekt. */
  eq('nach der Startseite gilt wieder der Standard', start.stand, 'bau');
}

/* ---- 2g) Das Projekt-Dashboard ----
   Inhalt und Darstellung sind getrennt: Jede Kachel ist ein Paar aus
   beidem, und beides ist je Projekt frei wählbar. */
{
  const pd = sandbox.__depotMitChargen2();

  // Der Inhalt rechnet, ohne zu wissen, wie er aussieht
  const vert = sandbox.dashInhalt('verteilung').daten(pd);
  eq('Verteilung: eine Gruppe je Anlage', vert.teile.length, 2);
  eq('… die grösste zuerst', vert.teile[0].label, 'Gold');
  ok('… und die Summe stimmt mit der Kostenübersicht überein',
    Math.abs(vert.teile.reduce((a, t) => a + t.wert, 0)
      - pd.vergaben.reduce((a, v) => a + sandbox.kostenZeile(v).prognose, 0)) < 0.01);

  const ew = sandbox.dashInhalt('einstandWert').daten(pd);
  eq('Einstand gegen Wert: zwei Balken', ew.teile.length, 2);
  eq('… und kein Anteil, denn es ist kein Ganzes', ew.anteil, false);

  /* Ein Ring trägt höchstens sechs Teile — darüber verschwimmen
     benachbarte Farben. Der Rest wird zusammengefasst, nicht
     weggelassen. */
  const viele = Array.from({ length: 11 }, (_, i) => ({ label: 'T' + i, wert: 11 - i }));
  const kurz = sandbox.dvGekuerzt(viele);
  eq('Ring: höchstens sechs Teile', kurz.length, 6);
  ok('… der letzte ist «Übrige»', /^Übrige/.test(kurz[5].label) && kurz[5].rest === true, kurz[5].label);
  eq('… und nichts geht verloren',
    kurz.reduce((a, t) => a + t.wert, 0), viele.reduce((a, t) => a + t.wert, 0));
  eq('bei sechs oder weniger wird nichts zusammengefasst',
    sandbox.dvGekuerzt(viele.slice(0, 6)).length, 6);
  eq('Teile ohne Wert fallen weg',
    sandbox.dvGekuerzt([{ label: 'a', wert: 5 }, { label: 'b', wert: 0 }]).length, 1);

  // Gezeichnet
  const ring = sandbox.dvZeichnen(vert, 'ring', pd);
  ok('Ring: ein Segment je Teil', (ring.match(/stroke-dasharray/g) || []).length === 2);
  ok('Ring: die Farben in fester Reihenfolge, nie im Kreis',
    /var\(--dv-1\)/.test(ring) && /var\(--dv-2\)/.test(ring) && !/var\(--dv-7\)/.test(ring));
  /* Drei der sechs Farben liegen im Hellen unter 3:1 Kontrast. Farbe
     allein darf die Aussage darum nicht tragen — die Zahl steht dabei. */
  ok('Ring: die Legende trägt Wert und Anteil, nicht nur Farbe',
    /dv-zahl/.test(ring) && /dv-anteil/.test(ring) && /Gold/.test(ring));
  ok('Ring: jedes Segment sagt beim Darüberfahren, was es ist', /<title>/.test(ring));

  const balken = sandbox.dvZeichnen(ew, 'balken', pd);
  ok('Balken: zwei Zeilen', (balken.match(/dv-balken-zeile/g) || []).length === 2);
  ok('Balken: der grössere ist voll', /width:100%/.test(balken), (balken.match(/width:[\d.]+%/g) || []).join(' '));

  const liste = sandbox.dvZeichnen(vert, 'liste', pd);
  ok('Liste: eine Zeile je Teil plus Total',
    (liste.match(/<tr/g) || []).length === 3 && /Total/.test(liste));

  ok('ohne Daten eine Meldung statt eines leeren Rings',
    /dv-leer/.test(sandbox.dvZeichnen({ titel: 'x', teile: [] }, 'ring', pd)));

  // Was die Vorlagen vorschlagen — und was das Projekt daraus macht
  const stdBau = sandbox.standardKacheln({ vorlage: 'bau' });
  const stdDepot = sandbox.standardKacheln({ vorlage: 'depot' });
  ok('jede Vorlage schlägt eigene Kacheln vor',
    JSON.stringify(stdBau) !== JSON.stringify(stdDepot));
  ok('beim Bau sind die Phasen dabei', stdBau.some(k => k.inhalt === 'phasen'));
  ok('beim Depot Einstand gegen Wert', stdDepot.some(k => k.inhalt === 'einstandWert'));
  ok('jede vorgeschlagene Kachel ist gültig',
    sandbox.__alleVorlagen().every(v => (sandbox.standardKacheln({ vorlage: v }) || []).every(k =>
      sandbox.dashInhalt(k.inhalt).key === k.inhalt && sandbox.__istArt(k.art))));

  pd.dashboard = [{ inhalt: 'top', art: 'balken' }];
  eq('das Projekt schlägt die Vorlage', sandbox.kachelnVon(pd)[0].inhalt, 'top');
  delete pd.dashboard;
  eq('ohne eigene Wahl gilt der Vorschlag', sandbox.kachelnVon(pd).length, stdDepot.length);

  // Der Einsteller
  sandbox.actDashKonfig(pd.id);
  eq('Einsteller startet beim Vorschlag', sandbox.__dkKacheln().length, stdDepot.length);
  sandbox.dashKonfigNeu();
  eq('Kachel angehängt', sandbox.__dkKacheln().length, stdDepot.length + 1);
  sandbox.dashKonfigSchieben(0, 1);
  eq('getauscht', sandbox.__dkKacheln()[0].inhalt, stdDepot[1].inhalt);
  sandbox.dashKonfigWeg(0);
  sandbox.dashKonfigSpeichern(pd.id);
  eq('gespeichert am Projekt', (pd.dashboard || []).length, stdDepot.length);
  ok('… und nur Inhalt und Darstellung, kein Ballast',
    pd.dashboard.every(k => Object.keys(k).sort().join(',') === 'art,inhalt'));

  const blatt = sandbox.__uebersicht(pd.id);
  ok('Übersicht: der Knopf zum Einstellen', /data-act="dash-konfig"/.test(blatt));
  ok('Übersicht: so viele Kacheln wie eingestellt',
    (blatt.match(/dv-kachel/g) || []).length === pd.dashboard.length);
  ok('Übersicht: keine Phasen-Leiste mehr im Depot', !/Phasen-Verteilung/.test(blatt));
}

/* ---- 2h) Zwei Gruppenebenen ----
   Anlageklasse ueber Anlage ueber Chargen — beides zugleich, weil die
   Chargen einer Anlage beieinanderstehen muessen UND die Klassen
   sichtbar sein sollen. */
{
  eq('Depot fuehrt zwei Ebenen', sandbox.zweiEbenen({ vorlage: 'depot' }), true);
  eq('die Sammlung auch', sandbox.zweiEbenen({ vorlage: 'sammlung' }), true);
  eq('der Bau bleibt einstufig', sandbox.zweiEbenen({ vorlage: 'bau' }), false);
  eq('die obere Ebene kommt aus der Kategorie', sandbox.oberGruppeVon({ kategorie: '201' }), '2');
  eq('ohne Kategorie keine obere Ebene', sandbox.oberGruppeVon({ kategorie: '' }), '?');

  const pz = sandbox.__depotZweiKlassen();
  const blatt = sandbox.__kostenBlatt(pz.id);
  ok('obere Ebene: zwei Klassen', (blatt.match(/kgroup-1/g) || []).length === 2,
    String((blatt.match(/kgroup-1/g) || []).length));
  ok('untere Ebene: drei Anlagen', (blatt.match(/kgroup-2/g) || []).length === 3,
    String((blatt.match(/kgroup-2/g) || []).length));
  ok('die Klassen heissen wie in der Ordnung',
    /Kryptowährungen/.test(blatt) && /Edelmetalle/.test(blatt));
  ok('jede Anlage hat ihren Bestand', (blatt.match(/Bestand /g) || []).length === 3);
  ok('jede Klasse hat ihr Total', (blatt.match(/Total Edelmetalle|Total Kryptow/g) || []).length === 2);

  /* Die Rechnung muss aufgehen: Klassen-Total = Summe ihrer Anlagen,
     Gesamttotal = Summe der Klassen. Sonst sieht die Tabelle nur
     ordentlich aus. */
  const zahlen = sandbox.__ebenenSummen(pz);
  ok('Klasse = Summe ihrer Anlagen',
    Math.abs(zahlen.edel - (zahlen.gold + zahlen.silber)) < 0.01,
    zahlen.edel + ' vs ' + (zahlen.gold + zahlen.silber));
  ok('Gesamt = Summe der Klassen',
    Math.abs(zahlen.total - (zahlen.edel + zahlen.krypto)) < 0.01,
    zahlen.total + ' vs ' + (zahlen.edel + zahlen.krypto));

  const bauBlatt = sandbox.__kostenBlatt(sandbox.__bauEinstufig().id);
  ok('der Bau bekommt keine zweite Ebene', !/kgroup-1/.test(bauBlatt));
  ok('… und behaelt sein Zwischentotal', /Zwischentotal/.test(bauBlatt));
}

/* ---- 2i) Pokemon: dieselbe Frage, andere Nummern ----
   Yu-Gi-Oh traegt Satz UND Nummer auf der Karte (CORI-EN030), Pokemon
   nur die Nummer im Satz (4/102) - der Satz ist ein Symbol. Also ist
   4/102 nicht eindeutig, aber es sind wenige Kandidaten. */
{
  eq('erkennt die Kennung', sandbox.pokemonErkenne('base1-4'), { art: 'kennung', wert: 'base1-4' });
  eq('erkennt die Nummer auf der Karte', sandbox.pokemonErkenne('4/102'), { art: 'bruch', nummer: '4', gesamt: 102 });
  eq('… auch mit Leerzeichen', sandbox.pokemonErkenne(' 25 / 198 ').gesamt, 198);
  eq('sonst ist es ein Name', sandbox.pokemonErkenne('Glurak'), { art: 'name', wert: 'Glurak' });
  /* "0094" ist keine Kartennummer, sondern die POKEDEX-Nummer - sie
     steht auf der Karte bei der Art und wird leicht verwechselt.
     94 ist Gengar. */
  eq('vierstellig mit Null ist die Pokedex-Nummer', sandbox.pokemonErkenne('0094'), { art: 'dex', wert: '94' });
  eq('ausdruecklich geht auch', sandbox.pokemonErkenne('dex 94'), { art: 'dex', wert: '94' });
  eq('… und mit Gatter', sandbox.pokemonErkenne('#94'), { art: 'dex', wert: '94' });
  eq('eine nackte Zahl bleibt mehrdeutig', sandbox.pokemonErkenne('94').art, 'nurzahl');

  /* Die Kennungen sind in neueren Saetzen mit Nullen aufgefuellt
     (me03-050), in alten nicht (base1-50). Wer "50/88" tippt, fand
     vorher nichts, obwohl die Karte da ist. */
  eq('beide Schreibweisen werden versucht',
    sandbox.pokemonKennungen('me03', '50'), ['me03-50', 'me03-050']);
  eq('… auch von der aufgefuellten aus',
    sandbox.pokemonKennungen('me03', '050'), ['me03-050', 'me03-50']);
  eq('dreistellige bleiben, wie sie sind',
    sandbox.pokemonKennungen('sv03', '125'), ['sv03-125']);
  eq('leer bleibt leer', sandbox.pokemonErkenne('  ').art, '');

  /* Cardmarkets Preis-Trend ist die Zahl, mit der dort gehandelt wird
     - der Schnitt nur, wenn kein Trend da ist. */
  const cm = { trend: 477.45, avg30: 399.62, avg: 402.79, low: 100, 'trend-holo': 123.63 };
  eq('nimmt den Preis-Trend', sandbox.pokemonPreis(cm, ''), 477.45);
  eq('… je Variante den ihren', sandbox.pokemonPreis(cm, '-holo'), 123.63);
  eq('ohne Trend den Schnitt', sandbox.pokemonPreis({ avg30: 12 }, ''), 12);
  eq('ohne alles null', sandbox.pokemonPreis(null, ''), 0);
  /* Der Fund vom 21.08.2026: Mega-Stalobor-ex gibt es NUR als Holo,
     darum fuehrt Cardmarket keinen getrennten Holo-Preis - der Preis
     steht im Grundfeld. Ohne Rueckfall stand die wertvollste Karte
     der Sammlung auf null, und eine Null sieht aus wie eine Auskunft,
     ohne eine zu sein. */
  const nurGrund = { trend: 5.86, avg30: 6.12, 'trend-holo': 0, 'avg30-holo': 0 };
  eq('Variante ohne eigenen Preis nimmt den der Karte',
    sandbox.pokemonPreis(nurGrund, '-holo'), 5.86);
  ok('… und sagt es auch',
    /der Karte/.test(sandbox.pokemonPreisName(nurGrund, '-holo')),
    sandbox.pokemonPreisName(nurGrund, '-holo'));
  eq('wo die Variante einen eigenen hat, gilt der ihre',
    sandbox.pokemonPreis({ trend: 477.45, 'trend-holo': 123.63 }, '-holo'), 123.63);
  eq('… und dann ohne den Zusatz',
    sandbox.pokemonPreisName({ trend: 477.45, 'trend-holo': 123.63 }, '-holo'), 'Preis-Trend');
  eq('und sagt, welche Zahl es war', sandbox.pokemonPreisName(cm, ''), 'Preis-Trend');

  // Ein Treffer wird zum Posten
  const t = {
    name: 'Glurak', art: 'Pokémon Feuer', kategorie: '101',
    setCode: 'base1-4', setName: 'Grundset', satzId: 'base1', kartenNummer: '4/102',
    seltenheit: '', preisEur: 477.45, setSicher: false, auflagen: 2,
    auflagenListe: [{ code: 'base1-4', seltenheit: 'Selten · Holo', preisEur: 123.63 },
                    { code: 'base1-4', seltenheit: 'Selten · 1. Auflage', preisEur: 477.45 }],
    bild: 'x.webp', preisArt: 'Preis-Trend', stand: '2026-08-21',
  };
  const po = sandbox.pokemonZuPosten(t);
  eq('die Nummer ist die von der Karte', po.bkp, '4/102');
  eq('der Satz steht fest, auch wenn die Variante offen ist', po.satz, 'Grundset');
  eq('… und seine Kennung dazu', po.satzId, 'base1');
  eq('Pokemonkarte wird zu 101', po.kategorie, '101');
  eq('offene Variante traegt die Merkfahne', po.pruefen, true);
  ok('… mit den Varianten zur Wahl', (po.auflagenOffen || []).length === 2);
  ok('… und dem Grund in der ersten Zeile', /Variante nicht bestimmt/.test(po.beschrieb.split(String.fromCharCode(10))[0]));

  /* «4/102» sagt fuer sich nichts - der Satz gruppiert, sonst laege
     die Karte unter «4 Briefmarken». */
  const S = { vorlage: 'sammlung' };
  eq('gruppiert nach dem Satz', sandbox.gruppeVon({ satzId: 'base1', bkp: '4/102' }, S), 'BASE1');
  eq('ohne Satz wartet die Nummer', sandbox.gruppeVon({ bkp: '4/102' }, S), '?');
  eq('ein Yu-Gi-Oh-Code gruppiert weiter nach seinem Kuerzel',
    sandbox.gruppeVon({ bkp: 'CORI-EN030' }, S), 'CORI');

  // Der Dienst gehoert dem Projekt, nicht der Vorlage
  eq('die Vorlage schlaegt vor', sandbox.nachschlagDienst({ vorlage: 'sammlung' }), 'ygo');
  eq('das Projekt entscheidet', sandbox.nachschlagDienst({ vorlage: 'sammlung', nachschlag: 'pokemon' }), 'pokemon');
  eq('und darf auch keinen wollen', sandbox.nachschlagDienst({ vorlage: 'sammlung', nachschlag: '' }), null);
  ok('jeder Dienst hat einen Namen und einen Hinweis',
    sandbox.__dienste().every(d => d.name && (d.key === '' || d.hinweis)));
  /* Beide Kartendienste teilen dieselbe Ordnung - ein Sammler ordnet
     nach «einzeln oder ungeoeffnet», nicht nach Kartenart. */
  ['ygo', 'pokemon'].forEach(d => ok('Ordnung fuer ' + d + ': Einzelkarten und Ungeoeffnetes', (() => {
    const k = JSON.stringify(sandbox.__vorschlagKatalog({ vorlage: 'sammlung', nachschlag: d }));
    return /Einzelkarten/.test(k) && /Ungeöffnete Produkte/.test(k)
        && !/Zauberkarten/.test(k) && !/Trainerkarten/.test(k);
  })()));
  ok('der Dienst setzt auch die Woerter',
    sandbox.W('posten', { vorlage: 'sammlung', nachschlag: 'pokemon' }) === 'Karte'
    && sandbox.R('gewerke', 'Gewerke', { vorlage: 'depot' }) === 'Anlagen');
}

/* ---- 2j) Die Sprache gehoert an die Karte ----
   "Deutsch und englisch - ich habe beides." Damit ist die Sprache
   keine Einstellung des Programms, sondern eine Eigenschaft des
   Stuecks: zwei verschiedene Waren mit verschiedenen Preisen. */
{
  eq('vier Sprachen zur Wahl', sandbox.__sprachen().length, 4);
  eq('Deutsch ist die erste', sandbox.spracheInfo('de').name, 'Deutsch');
  eq('Unbekanntes faellt auf Deutsch', sandbox.spracheInfo('xx').key, 'de');
  eq('ohne Angabe ebenso', sandbox.spracheInfo('').kurz, 'DE');

  const t = {
    name: 'Charizard', art: 'Pokemon Fire', kategorie: '1',
    setCode: 'base1-4', setName: 'Base Set', satzId: 'base1', kartenNummer: '4/102',
    seltenheit: 'Rare · Holo', preisEur: 477.45, setSicher: true, auflagen: 1, auflagenListe: [],
    bild: 'x.webp', preisArt: 'Preis-Trend', stand: '2026-08-21', sprache: 'en',
  };
  const po = sandbox.pokemonZuPosten(t);
  eq('die Sprache steht am Posten', po.sprache, 'en');
  ok('… und im Vermerk', /Englisch/.test(po.beschrieb), po.beschrieb);
  /* Cardmarket fuehrt EINEN Preis je Karte, nicht je Sprachfassung.
     Eine deutsche Erstauflage kann ein Vielfaches wert sein - wer das
     nicht weiss, haelt eine fremde Zahl fuer seine. */
  ok('der Preis sagt, dass er nicht nach Sprache getrennt ist',
    /nicht nach Sprache getrennt/.test(po.beschrieb), po.beschrieb);

  /* Yu-Gi-Oh fuehrt nur englische Namen - die Sprache der eigenen
     Karte bleibt trotzdem eine Angabe, die man beim Verkaufen braucht. */
  eq('auch ohne uebersetzten Namen wird die Sprache festgehalten',
    sandbox.__ygoMitSprache('de').sprache, 'de');

  /* Gefunden beim Einlesen von 18 deutschen Karten: Der Treffer trug
     die Sprache, der POSTEN nicht - ygoZuPosten reichte sie nicht
     weiter. Damit war beim Verkaufen nicht mehr zu sehen, ob eine
     Karte deutsch oder englisch ist. */
  eq('der Yu-Gi-Oh-Posten traegt die Sprache des Treffers',
    sandbox.ygoZuPosten({ name: 'Erebus', setCode: 'SR01-EN001', setName: 'Emperor of Darkness',
      seltenheit: 'Ultra Rare', setSicher: true, auflagen: 1, preisEur: 1, preisUsd: 0,
      passcode: '1', sprache: 'de' }, { eur: 0.93, usd: 0.8, datum: 'x' }).sprache, 'de');
  eq('ohne Angabe bleibt sie leer statt geraten',
    sandbox.ygoZuPosten({ name: 'x', setSicher: true, auflagen: 1, preisEur: 0, preisUsd: 0 },
      { eur: 0.93, usd: 0.8, datum: 'x' }).sprache, '');
}

/* ---- 2k) Zwei Spiele in EINEM Projekt ----
   Eine Sammlung ist eine Sammlung. Der Dienst gehoert an die ABFRAGE,
   nicht ans Projekt - die Form der Eingabe sagt, wer zustaendig ist. */
{
  const D = sandbox.eingabeDienste;
  eq('acht Ziffern sind ein Passcode', D('43989315'), ['ygo']);
  eq('Satz-Sprache-Nummer auch', D('CORI-EN030'), ['ygo']);
  eq('alte Satz-Codes ebenso', D('SDK-001'), ['ygo']);
  eq('Nummer durch Gesamtzahl ist Pokemon', D('050/088'), ['pokemon']);
  eq('… auch ohne Nullen', D('50/88'), ['pokemon']);
  eq('kleingeschriebene Kennung ist Pokemon', D('me03-050'), ['pokemon']);
  eq('die Pokedex-Nummer auch', D('0094'), ['pokemon']);
  eq('… und ausdruecklich', D('dex 94'), ['pokemon']);
  /* Nur ein Name ist wirklich mehrdeutig - dann beide, und die
     Treffer stehen nebeneinander zur Wahl. */
  eq('ein Name geht an beide', D('Gengar'), ['ygo', 'pokemon']);
  eq('leer an keinen', D('  '), []);

  ok('dienstPasst benutzt denselben Erkenner',
    sandbox.dienstPasst('ygo', '43989315') && !sandbox.dienstPasst('pokemon', '43989315')
    && sandbox.dienstPasst('pokemon', '050/088') && !sandbox.dienstPasst('ygo', '050/088'));

  // Ein Projekt mit beiden Diensten
  const pz = { vorlage: 'sammlung', dienste: ['ygo', 'pokemon'] };
  eq('beide Dienste am Projekt', sandbox.__dienstListe(pz), ['ygo', 'pokemon']);
  eq('der erste fuehrt die Woerter', sandbox.nachschlagDienst(pz), 'ygo');
  eq('ein Projekt darf auch keinen haben', sandbox.__dienstListe({ vorlage: 'sammlung', dienste: [] }), []);
  eq('ohne Angabe gilt der Vorschlag der Vorlage',
    sandbox.__dienstListe({ vorlage: 'sammlung' }), ['ygo']);
  eq('Unsinn wird aussortiert',
    sandbox.__dienstListe({ vorlage: 'sammlung', dienste: ['ygo', 'gibtsnicht'] }), ['ygo']);

  /* Der Treffer weiss selbst, woher er kommt - nur so kann eine
     Trefferliste Karten aus zwei Datenbanken enthalten. */
  const pkm = { dienst: 'pokemon', name: 'Gengar', kartenNummer: '050/088', kategorie: '1',
    setCode: 'me03-050', setName: 'Optimale Ordnung', satzId: 'me03', seltenheit: 'Selten',
    preisEur: 0.34, setSicher: true, auflagen: 1, auflagenListe: [], bild: '', preisArt: 'Preis-Trend', stand: '2026-08-21' };
  const ygo = { dienst: 'ygo', name: 'Invoked Sorath', kategorie: '1', setCode: 'CORI-EN030',
    setName: 'Chaos Origins', seltenheit: 'Super Rare', preisEur: 0.27, preisUsd: 0,
    setSicher: true, auflagen: 1, auflagenListe: [], passcode: '43989315', art: 'Fusionsmonster' };
  eq('ein Pokemon-Treffer wird ueber Pokemon uebersetzt',
    sandbox.nachschlagZuPosten(pkm, pz).bkp, '050/088');
  eq('ein Yu-Gi-Oh-Treffer ueber Yu-Gi-Oh',
    sandbox.nachschlagZuPosten(ygo, pz).bkp, 'CORI-EN030');
  ok('… obwohl beide im selben Projekt liegen',
    sandbox.nachschlagZuPosten(pkm, pz).satz === 'Optimale Ordnung'
    && sandbox.nachschlagZuPosten(ygo, pz).satz === 'Chaos Origins');
}

/* ---- 3) Der Bau-Fall bleibt, wie er war ---- */
const bauP = sandbox.__bauProjekt(p);
const bauKosten = zeichne('Baukostenübersicht', () => sandbox.viewKosten(bauP.id));
ok('Bau bleibt Bau: BKP, Arbeitsgattung, Unternehmer',
  /BKP/.test(bauKosten) && /Arbeitsgattung/.test(bauKosten) && /Unternehmer/.test(bauKosten));
ok('Bau bleibt Bau: Total Baukosten', /Total Baukosten/.test(bauKosten));
ok('Bau bleibt Bau: MwSt-Umschalter vorhanden', /kosten-brutto/.test(bauKosten));

sandbox.setVorlageCtx({ vorlage: 'unterschriften' });
ok('Unterschriften: kein MwSt-Umschalter', sandbox.mwstAnsichtBtn({ vorlage: 'unterschriften', id: 'x' }) === '');

/* ---- 4) Nachschlagen: Nummer rein, Karte fertig ----
   Ohne Netz. Was die Datenbank antwortet, steht hier als Attrappe —
   abgeschrieben von einer echten Antwort am 21.08.2026. So prüft der
   Test die Übersetzung und nicht die Laune eines fremden Servers. */
const ANTWORT_PASSCODE = {
  data: [{
    id: 43989315, name: 'Invoked Sorath', type: 'Fusion Monster',
    humanReadableCardType: 'Fusion Effect Monster', frameType: 'fusion',
    race: 'Pyro', atk: 1600, def: 2600, level: 6, attribute: 'LIGHT',
    card_sets: [{ set_name: 'Chaos Origins', set_code: 'CORI-EN030', set_rarity: 'Super Rare', set_price: '0' }],
    card_prices: [{ cardmarket_price: '0.27', tcgplayer_price: '0.18', ebay_price: '0.00' }],
    card_images: [{ image_url: 'https://images.ygoprodeck.com/images/cards/43989315.jpg', image_url_small: 'https://images.ygoprodeck.com/images/cards_small/43989315.jpg' }],
  }],
};
const ANTWORT_SETCODE = {
  id: 89631146, name: 'Blue-Eyes White Dragon', set_name: 'Starter Deck: Kaiba',
  set_code: 'SDK-001', set_rarity: 'Ultra Rare', set_price: '25.6',
};
const ANTWORT_SDK_VOLL = {
  data: [{
    id: 89631146, name: 'Blue-Eyes White Dragon', humanReadableCardType: 'Normal Monster',
    frameType: 'normal',
    card_sets: [
      { set_name: 'Legend of Blue Eyes White Dragon', set_code: 'LOB-001', set_rarity: 'Ultra Rare', set_price: '90' },
      { set_name: 'Starter Deck: Kaiba', set_code: 'SDK-001', set_rarity: 'Ultra Rare', set_price: '25.6' },
    ],
    card_prices: [{ cardmarket_price: '4.50', tcgplayer_price: '6.20' }],
    card_images: [{ image_url_small: 'https://images.ygoprodeck.com/images/cards_small/89631146.jpg' }],
  }],
};

// Erkennen
eq('erkennt einen Passcode', sandbox.ygoErkenne(' 43989315 '), { art: 'passcode', wert: '43989315' });
eq('erkennt einen Set-Code, auch klein geschrieben', sandbox.ygoErkenne('cori-en030'), { art: 'setcode', wert: 'CORI-EN030' });
eq('erkennt einen Namen', sandbox.ygoErkenne('Blue-Eyes'), { art: 'name', wert: 'Blue-Eyes' });
eq('leere Eingabe bleibt leer', sandbox.ygoErkenne('  ').art, '');
ok('baut die richtige Anfrage',
  /cardinfo\.php\?id=43989315$/.test(sandbox.ygoUrl({ art: 'passcode', wert: '43989315' }))
  && /cardsetsinfo\.php\?setcode=SDK-001$/.test(sandbox.ygoUrl({ art: 'setcode', wert: 'SDK-001' }))
  && /fname=Blue-Eyes/.test(sandbox.ygoUrl({ art: 'name', wert: 'Blue-Eyes' })));

// Kartenart → Katalognummer
/* Die Kartenart gliedert nicht mehr: Ein Sammler trennt Einzelkarte
   von ungeoeffnetem Produkt, nicht Zauber von Falle. Die Art bleibt
   als Eigenschaft im Vermerk - auf Deutsch. */
ok('jede einzelne Karte ist eine Einzelkarte',
  ['fusion', 'link', 'spell', 'trap', 'effect', 'waswohl'].every(f => sandbox.ygoKategorie(f) === '1'));
eq('die Art kommt auf Deutsch', sandbox.ygoArtDeutsch('Counter Trap'), 'Konterfalle');
eq('… auch bei Fusionsmonstern', sandbox.ygoArtDeutsch('Fusion Effect Monster'), 'Fusionsmonster');
eq('… und beim Schnellzauber', sandbox.ygoArtDeutsch('Quick-Play Spell'), 'Schnellzauber');
eq('Unbekanntes bleibt stehen, statt falsch uebersetzt zu werden',
  sandbox.ygoArtDeutsch('Skill Card'), 'Skill Card');
ok('jede vergebene Kategorie steht auch im Katalog der Vorlage', (() => {
  const codes = new Set(sandbox.__katalogCodes('sammlung'));
  return ['normal','effect','ritual','spell','trap','fusion','synchro','xyz','link','normal_pendulum','waswohl']
    .every(f => codes.has(sandbox.ygoKategorie(f)));
})());

/* Sätze aus mehreren Decks setzen einen Buchstaben vor die Nummer:
   YGLD-DEC01 ist Deck C von Yugi's Legendary Decks. Die Umschreibung
   Deutsch → Englisch verlangte dort nur Ziffern und gab leer zurück —
   die Karte war schlicht nicht auffindbar. (Fund vom 21.08.2026) */
eq('Deck-Buchstabe überlebt die Umschreibung ins Englische',
  sandbox.ygoAufEnglisch('YGLD-DEC01'), 'YGLD-ENC01');
eq('… auch bei Deck A', sandbox.ygoAufEnglisch('YGLD-DEA01'), 'YGLD-ENA01');
eq('… und die gewöhnliche Form bleibt, wie sie war',
  sandbox.ygoAufEnglisch('SDMY-DE004'), 'SDMY-EN004');
/* Ein englischer Code braucht keine Umschreibung — dann kommt leer
   zurueck, und der Aufrufer nimmt die Nummer, wie sie ist. */
eq('… Englisches braucht keine Umschreibung',
  sandbox.ygoAufEnglisch('CORI-EN030'), '');
ok('… und der Erkenner lässt die Form zu Yu-Gi-Oh durch',
  sandbox.eingabeDienste('YGLD-DEC01').join() === 'ygo'
  && sandbox.eingabeDienste('ygld-dec01').join() === 'ygo');

/* Das Kürzel der Seltenheit vor dem Namen: (UR), (SR), (ScR). Es wird
   berechnet, nie ins Feld geschrieben — sonst bliebe es stehen, wenn
   sich die Seltenheit ändert, und der Name sagte etwas anderes als
   die Karte. */
eq('Ultra Rare wird zu UR', sandbox.seltenheitKuerzel('Ultra Rare'), 'UR');
eq('Super Rare wird zu SR', sandbox.seltenheitKuerzel('Super Rare'), 'SR');
eq('Secret Rare wird zu SCR', sandbox.seltenheitKuerzel('Secret Rare'), 'SCR');
/* Das Längere muss zuerst geprüft werden, sonst gewinnt «Secret Rare»
   und aus Gold Secret wird Secret. */
eq('Gold Secret Rare bleibt unterscheidbar',
  sandbox.seltenheitKuerzel('Gold Secret Rare'), 'GSCR');
eq('… und Gold Rare auch', sandbox.seltenheitKuerzel('Gold Rare'), 'GR');
/* Pokémon trägt Stufe UND Variante — beides gehört ins Kürzel. */
eq('Pokémon: Stufe und Variante zusammen',
  sandbox.seltenheitKuerzel('Selten · Holo'), 'R·HO');
eq('… auch bei Reverse Holo',
  sandbox.seltenheitKuerzel('Häufig · Reverse Holo'), 'C·RH');
/* Unbekanntes wird abgekürzt, nicht verschwiegen — und nicht auf eine
   Stufe verkürzt, die es nicht meint. */
eq('Unbekanntes behält, was es unterscheidet',
  sandbox.seltenheitKuerzel('Duel Terminal Rare Parallel'), 'DTRP');
eq('ohne Seltenheit kein Kürzel', sandbox.seltenheitKuerzel(''), '');
eq('Der Name trägt das Kürzel davor',
  sandbox.postenName({ seltenheit: 'Ultra Rare', gewerk: 'Erebus' }), '(UR) Erebus');
/* Die Vorlage Bau kennt keine Seltenheit — dort darf sich nichts
   ändern. Ein Kürzel vor «Baumeisterarbeiten» wäre Unsinn. */
eq('… und ohne Seltenheit bleibt der Name, wie er war',
  sandbox.postenName({ gewerk: 'Baumeisterarbeiten' }), 'Baumeisterarbeiten');

// Antwort übersetzen
const a1 = sandbox.ygoAuswerten(ANTWORT_PASSCODE, { art: 'passcode', wert: '43989315' });
eq('Passcode-Antwort: ein Treffer', a1.treffer.length, 1);
eq('Name übernommen', a1.treffer[0].name, 'Invoked Sorath');
eq('jede Karte ist eine Einzelkarte', a1.treffer[0].kategorie, '1');
eq('die Art steht auf Deutsch dabei', a1.treffer[0].art, 'Fusionsmonster');
eq('Set und Seltenheit übernommen', [a1.treffer[0].setCode, a1.treffer[0].seltenheit], ['CORI-EN030', 'Super Rare']);
eq('Cardmarket-Preis übernommen', a1.treffer[0].preisEur, 0.27);
ok('Bild übernommen', /43989315/.test(a1.treffer[0].bild));

const a2 = sandbox.ygoAuswerten(ANTWORT_SETCODE, { art: 'setcode', wert: 'SDK-001' });
eq('Set-Code-Antwort will nachgeladen werden', [a2.treffer.length, a2.treffer[0].nachladen], [1, true]);
eq('… und trägt schon Passcode und Seltenheit', [a2.treffer[0].passcode, a2.treffer[0].seltenheit], ['89631146', 'Ultra Rare']);

const a3 = sandbox.ygoAuswerten(ANTWORT_SDK_VOLL, { art: 'setcode', wert: 'SDK-001' });
eq('bei Set-Code-Suche gilt GENAU dieses Set, nicht das erste', a3.treffer[0].setCode, 'SDK-001');
ok('Fehlermeldung der Datenbank kommt auf Deutsch durch',
  /keine Karte verzeichnet/.test(sandbox.ygoAuswerten({ error: 'No card matching your query was found in the database' }, {}).fehler));
eq('unbekannte Meldungen bleiben im Wortlaut',
  sandbox.ygoAuswerten({ error: 'Server überlastet' }, {}).fehler, 'Server überlastet');
ok('leere Antwort stürzt nicht ab', !!sandbox.ygoAuswerten(null, {}).fehler);
ok('Antwort ohne Daten meldet es', !!sandbox.ygoAuswerten({ data: [] }, {}).fehler);

/* Dieselbe Nummer in mehreren Seltenheiten — im Satz «Chaos Origins»
   betrifft das 25 von 100 Nummern. Wer den ersten Eintrag nimmt,
   erfindet eine Seltenheit. */
const MEHRERE_SELTENHEITEN = {
  data: [{
    id: 1, name: 'Black Luster Soldier', humanReadableCardType: 'Ritual Monster', frameType: 'ritual',
    card_sets: [
      { set_name: 'Chaos Origins', set_code: 'CORI-EN028', set_rarity: 'Secret Rare', set_price: '3.80' },
      { set_name: 'Chaos Origins', set_code: 'CORI-EN028', set_rarity: 'Starlight Rare', set_price: '0' },
      { set_name: 'Chaos Origins', set_code: 'CORI-EN028', set_rarity: 'Ultra Rare', set_price: '1.20' },
      { set_name: 'Anderer Satz', set_code: 'XYZ-EN001', set_rarity: 'Common', set_price: '0.05' },
    ],
    card_prices: [{ cardmarket_price: '0.90' }],
    card_images: [{ image_url_small: 'x.jpg' }],
  }],
};
const mS = sandbox.ygoAuswerten(MEHRERE_SELTENHEITEN, { art: 'setcode', wert: 'CORI-EN028' });
eq('eine Nummer mit drei Seltenheiten steht NICHT fest', mS.treffer[0].setSicher, false);
eq('… keine davon wird behauptet', mS.treffer[0].seltenheit, '');
eq('… zur Wahl stehen genau die drei dieser Nummer', mS.treffer[0].auflagen, 3);
/* Der Satz steht fest, sobald nach einem Satz-Code gesucht wurde -
   alle Treffer teilen ihn ja. Ohne das landeten 27 Karten unter
   "Auflage noch offen", obwohl der Nutzer den Satz selbst genannt
   hatte. Dieselbe Stelle wie bei Pokemon (Teil 50). */
eq('… der Satz bleibt trotzdem stehen', mS.treffer[0].setCode, 'CORI-EN028');
eq('… und sein Name', mS.treffer[0].setName, 'Chaos Origins');
ok('… gruppiert wird darum nach dem Satz, nicht unter "offen"',
  sandbox.gruppeVon(sandbox.ygoZuPosten(mS.treffer[0], { eur: 0.93, usd: 0.8, datum: 'x' }),
    { vorlage: 'sammlung' }) === 'CORI');
eq('… der Preis gilt aber erst, wenn die Seltenheit feststeht',
  mS.treffer[0].preisUsd, 0);
ok('… und nicht die Auflage aus einem anderen Satz',
  mS.treffer[0].auflagenListe.every(a => a.code === 'CORI-EN028'),
  JSON.stringify(mS.treffer[0].auflagenListe.map(a => a.code)));
eq('… der Posten trägt die Merkfahne',
  sandbox.ygoZuPosten(mS.treffer[0], { eur: 0.93, usd: 0.8, datum: '2026-08-21' }).pruefen, true);
ok('… eine davon wählen macht sie fest',
  sandbox.ygoAuflageWaehlen(mS.treffer[0], 2).seltenheit === 'Ultra Rare'
  && sandbox.ygoAuflageWaehlen(mS.treffer[0], 2).setSicher === true);

// Die richtige Auflage — daran ist die erste Fassung aufgelaufen
eq('Set-Code-Suche: die Auflage steht fest', a3.treffer[0].setSicher, true);
/* Zwei Zahlen, zwei Aussagen. Passt genau eine Auflage zur gesuchten
   Nummer, steht NICHTS zur Wahl — gedruckt wurde die Karte trotzdem
   zweimal, und daran hängt der Vorbehalt zum Cardmarket-Preis. */
eq('… und es steht nichts mehr zur Wahl', a3.treffer[0].auflagen, 1);
eq('… die Karte wurde aber zweimal gedruckt', a3.treffer[0].auflagenGesamt, 2);
/* Der Fund vom 21.08.2026: LCJW-DE182 wurde als RA02-EN075
   eingetragen. Passte genau eine Auflage zur Nummer, bot die Liste
   trotzdem alle Auflagen der Karte an — quer durch fremde Sätze. Wer
   daraus wählte, verschob die Karte in einen Satz, den er nie
   gesucht hatte. */
ok('zur Wahl steht nur, was zur gesuchten Nummer gehört',
  a3.treffer[0].auflagenListe.every(x => x.code === 'SDK-001'),
  JSON.stringify(a3.treffer[0].auflagenListe.map(x => x.code)));
ok('bei EINER Auflage steht sie ebenfalls fest', a1.treffer[0].setSicher === true && a1.treffer[0].auflagen === 1);
const a4 = sandbox.ygoAuswerten(ANTWORT_SDK_VOLL, { art: 'name', wert: 'Blue-Eyes' });
eq('Namenssuche: die Auflage steht NICHT fest', a4.treffer[0].setSicher, false);

/* Der Kern der Sache: Ein Passcode bezeichnet die KARTE, nicht den
   DRUCK. Blue-Eyes gibt es in 78 Auflagen mit 20 Seltenheiten von
   Common bis Ghost Rare. Eine davon hinzuschreiben, weil sie in der
   Liste zuoberst steht, wäre eine erfundene Angabe. */
eq('unklare Auflage: KEINE Seltenheit behauptet', a4.treffer[0].seltenheit, '');
eq('unklare Auflage: KEIN Set behauptet', [a4.treffer[0].setCode, a4.treffer[0].setName], ['', '']);
eq('… aber alle Auflagen liegen zur Wahl bereit', a4.treffer[0].auflagenListe.length, 2);
ok('… mit Kennung, Seltenheit und Preis je Auflage', (() => {
  const a = a4.treffer[0].auflagenListe[0];
  return !!a.code && !!a.name && !!a.seltenheit && typeof a.preisUsd === 'number';
})());
ok('bei sicherer Auflage steht die Seltenheit sehr wohl da', !!a3.treffer[0].seltenheit);

// Eine Auflage wählen macht sie fest
const gewaehlt = sandbox.ygoAuflageWaehlen(a4.treffer[0], 0);
eq('gewählte Auflage: Set übernommen', gewaehlt.setCode, 'LOB-001');
eq('gewählte Auflage: Seltenheit übernommen', gewaehlt.seltenheit, 'Ultra Rare');
eq('gewählte Auflage: gilt jetzt als sicher', gewaehlt.setSicher, true);
eq('gewählte Auflage: ihr Preis gilt', gewaehlt.preisUsd, 90);
eq('unsinnige Wahl ändert nichts', sandbox.ygoAuflageWaehlen(a4.treffer[0], 99).setSicher, false);

/* ---- 2b) Das Nachschlage-Fenster fragt nach der Auflage ---- */
{
  const blatt = sandbox.__scanBlatt(p.id, ANTWORT_SDK_VOLL);
  ok('Fenster: die Auflagen stehen zur Wahl', /scan-auflage/.test(blatt));
  ok('Fenster: beide Auflagen mit Seltenheit', /LOB-001/.test(blatt) && /SDK-001/.test(blatt) && /Ultra Rare/.test(blatt));
  ok('Fenster: die Frage steht als Warnung da', /Welche Auflage ist es/.test(blatt));
  ok('Fenster: und es wird gesagt, was ohne Wahl passiert', /Merkfahne/.test(blatt));
  const sicher = sandbox.__scanBlatt(p.id, ANTWORT_PASSCODE);
  ok('Fenster: bei EINER Auflage keine Rückfrage', !/scan-auflage/.test(sicher) && !/Welche Auflage/.test(sicher));
  ok('Fenster: dann steht die Seltenheit da', /Super Rare/.test(sicher));
}


/* Gruppiert wird, wie es die Vorlage sagt: beim Bau nach der ersten
   Ziffer, bei einer Sammlung nach dem Satz — wie ein Ordner im Regal. */
const S = { vorlage: 'sammlung' }, B = { vorlage: 'bau' };
eq('Bau gruppiert nach der ersten Ziffer', sandbox.gruppeVon({ bkp: '281.6' }, B), '2');
eq('Sammlung gruppiert einen Set-Code nach seinem Satz', sandbox.gruppeVon({ bkp: 'CORI-EN030' }, S), 'CORI');
eq('… klein geschrieben genauso', sandbox.gruppeVon({ bkp: 'lob-001' }, S), 'LOB');
eq('… eine eigene Nummer nach ihrer ersten Ziffer', sandbox.gruppeVon({ bkp: '101' }, S), '1');
eq('… ein blosser Passcode wartet auf seine Auflage', sandbox.gruppeVon({ bkp: '89631139' }, S), '?');
eq('… und ohne Nummer ebenso', sandbox.gruppeVon({ bkp: '' }, S), '?');
eq('Überschrift aus dem Katalog der Vorlage', sandbox.gruppeTitel('1', [], S), 'Einzelkarten');
eq('… und die zweite Gruppe sind die ungeoeffneten Produkte',
  sandbox.gruppeTitel('2', [], S), 'Ungeöffnete Produkte');
eq('Überschrift aus den Posten, wenn die Vorlage keine kennt',
  sandbox.gruppeTitel('CORI', [{ bkp: 'CORI-EN030' }, { bkp: 'CORI-EN040', satz: 'Chaos Origins' }], S),
  'Chaos Origins');
eq('Überschrift für das, was noch keine Auflage hat', sandbox.gruppeTitel('?', [], S), 'Auflage noch offen');
eq('und sonst schlicht «Übrige»', sandbox.gruppeTitel('ZZZ', [], S), 'Übrige');

// Kurs und Marktwert
ok('Kurs wird übernommen', sandbox.__kursSetzen({ rates: { CHF: 0.9333, USD: 1.16 }, date: '2026-08-20' }));
const k = sandbox.__kurse();
ok('Dollarkurs aus Euro abgeleitet', Math.abs(k.usd - 0.9333 / 1.16) < 0.0001, String(k.usd));
eq('Marktwert in Franken (Euro zuerst)', sandbox.ygoMarktwert(a1.treffer[0], k), 0.25);
eq('ohne Euro-Preis zählt der Dollarpreis',
  sandbox.ygoMarktwert({ preisEur: 0, preisUsd: 10 }, k), Math.round(10 * k.usd * 100) / 100);
eq('ohne jeden Preis null', sandbox.ygoMarktwert({ preisEur: 0, preisUsd: 0 }, k), 0);
/* Der Regressionstest zum Fund vom 21.08.2026: SDK-001 ist USD 25.60
   wert, nicht EUR 4.50 — der Cardmarket-Preis meint die billigste
   der Nachdruck-Auflagen, nicht die Ultra Rare von 2002. */
eq('bekannte Auflage schlägt den Sammelpreis (SDK-001 Blue-Eyes)',
  sandbox.ygoMarktwert(a3.treffer[0], k), Math.round(25.6 * k.usd * 100) / 100);
ok('… und das sind Grössenordnungen, nicht Rappen',
  sandbox.ygoMarktwert(a3.treffer[0], k) > 15);
eq('unklare Auflage nimmt den Cardmarket-Preis',
  sandbox.ygoMarktwert(a4.treffer[0], k), Math.round(4.5 * k.eur * 100) / 100);
ok('… und sagt im Vermerk, dass es die günstigste von mehreren ist',
  /günstigste über alle 2 Auflagen/.test(sandbox.ygoHerkunft(a4.treffer[0], k)));
ok('… und dass die Auflage offen ist',
  /Auflage nicht bestimmt/.test(sandbox.ygoHerkunft(a4.treffer[0], k)));
ok('bei bekannter Auflage steht deren Set-Code beim Preis',
  /TCGPlayer USD 25\.60 für SDK-001/.test(sandbox.ygoHerkunft(a3.treffer[0], k)));
ok('… und dann fehlt die Warnung zu Recht',
  !/günstigste/.test(sandbox.ygoHerkunft(a3.treffer[0], k)));
/* Der Fund vom 21.08.2026 an Battle Pack 3: Dort führt TCGPlayer für
   KEINE der zwei Auflagen einen Preis, also greift auch bei gewählter
   Auflage der Cardmarket-Preis — der günstigste über alles. Hing der
   Vorbehalt an `setSicher`, verschwand er genau dann, wenn man die
   Frage für beantwortet hielt. Er hängt am Preis, nicht an der Auflage. */
const bp = { setSicher: true, auflagen: 2, preisUsd: 0, preisEur: 0.12, setCode: 'BP03-EN223', seltenheit: 'Shatterfoil Rare' };
ok('gewählte Auflage ohne eigenen Preis: der Vorbehalt bleibt stehen',
  /günstigste über alle 2 Auflagen/.test(sandbox.ygoHerkunft(bp, k)), sandbox.ygoHerkunft(bp, k));
ok('… sagt aber nicht mehr, die Auflage sei offen',
  !/Auflage nicht bestimmt/.test(sandbox.ygoHerkunft(bp, k)), sandbox.ygoHerkunft(bp, k));
ok('die Herkunft des Werts steht dabei',
  /Cardmarket EUR 0\.27/.test(sandbox.ygoHerkunft(a1.treffer[0], k)) && /Stand 2026-08-20/.test(sandbox.ygoHerkunft(a1.treffer[0], k)));
ok('ein genäherter Kurs wird als solcher benannt',
  /genähert/.test(sandbox.ygoHerkunft(a1.treffer[0], { eur: 0.93, usd: 0.8, datum: '2026-08-21', geschaetzt: true })));

/* Eine gewählte Auflage muss den PREIS mitziehen. Yu-Gi-Oh führt ihn
   in Dollar, Pokémon in Euro — `auflageAnwenden` kannte zuerst nur
   den Dollar. Wer bei einer Pokémonkarte «Holo» wählte, bekam die
   richtige Seltenheit, die alte Zahl und keine Fahne mehr: Es sah
   geprüft aus und war es nicht. Bei Gengar (Selten) machte das
   CHF 0.32 statt CHF 0.98. (Fund vom 21.08.2026) */
{
  sandbox.__kursSetzen({ rates: { CHF: 0.9333, USD: 1.16 }, date: '2026-08-20' });
  const v = {
    bkp: 'me03-050', pruefen: true, seltenheit: '',
    beschrieb: '⚑ Variante nicht bestimmt — 3 mögliche.\nPokémon\nMarktwert: Cardmarket EUR 0.34, Stand 2026-08-21',
    eingeladene: [{ id: 'e_1', firma: 'Marktpreis', betrag: 0.32, status: 'offeriert' }],
  };
  sandbox.auflageAnwenden(v, { seltenheit: 'Selten · Holo', preisEur: 1.05, preisUsd: 0, code: 'me03-050' }, S);
  eq('gewählte Variante: die Seltenheit steht fest', v.seltenheit, 'Selten · Holo');
  eq('… die Fahne ist weg', v.pruefen, false);
  ok('… und der Euro-Preis ist mitgezogen',
    Math.abs(v.eingeladene[0].betrag - Math.round(1.05 * (0.9333) * 100) / 100) < 0.001,
    String(v.eingeladene[0].betrag));
  ok('… die Herkunft nennt Cardmarket und die Variante',
    /Cardmarket EUR 1\.05 für Selten · Holo/.test(v.beschrieb), v.beschrieb);
  /* Zweimal wählen darf nicht zwei Marktwert-Zeilen hinterlassen —
     zwei Zahlen im selben Vermerk sind zwei Wahrheiten. */
  sandbox.auflageAnwenden(v, { seltenheit: 'Selten', preisEur: 0.34, preisUsd: 0, code: 'me03-050' }, S);
  eq('… und ein zweiter Griff hinterlässt nur EINE Marktwert-Zeile',
    v.beschrieb.split('\n').filter(z => z.indexOf('Marktwert: ') === 0).length, 1);
  ok('… mit der neuen Zahl', /Cardmarket EUR 0\.34/.test(v.beschrieb), v.beschrieb);
}

/* Was der Besitzer weiss und die Datenbank nicht.

   Cosmos Holo führt weder TCGdex (38 Stufen, keine heisst so) noch
   Cardmarket (drei Preisfelder: Normal, Holo, Reverse). Die Karte
   liegt trotzdem auf dem Tisch. Sie zu verschweigen wäre so falsch
   wie sie zu belegen — also steht sie da, mit ihrer Herkunft.
   (Fund vom 21.08.2026) */
eq('Cosmos bekommt ein Kürzel', sandbox.seltenheitKuerzel('Selten · Cosmos Holo'), 'R·CO');
{
  const v = { gewerk: 'Gengar', seltenheit: 'Selten · Holo', beschrieb: 'Seltenheit: Selten · Holo\nPokémon Unlicht' };
  sandbox.seltenheitEigen(v, 'Selten · Cosmos Holo', 'Cardmarket führt diese Auflage nicht getrennt');
  eq('von Hand gesetzt: die Seltenheit steht da', v.seltenheit, 'Selten · Cosmos Holo');
  eq('… und ist als eigene Angabe gekennzeichnet', v.eigen, true);
  ok('… der Vermerk sagt es mit Grund',
    /Seltenheit: Selten · Cosmos Holo \(eigene Angabe — Cardmarket/.test(v.beschrieb), v.beschrieb);
  eq('… und es steht nur EINE Seltenheit-Zeile da',
    v.beschrieb.split('\n').filter(z => z.indexOf('Seltenheit: ') === 0).length, 1);
  ok('… der übrige Vermerk bleibt', /Pokémon Unlicht/.test(v.beschrieb));

  /* Wählt man danach doch eine belegte Auflage, ist es keine eigene
     Angabe mehr — sonst bliebe die Kennzeichnung ewig kleben. */
  sandbox.__kursSetzen({ rates: { CHF: 0.9333, USD: 1.16 }, date: '2026-08-20' });
  sandbox.auflageAnwenden(v, { seltenheit: 'Selten · Holo', preisEur: 1.05, preisUsd: 0 }, S);
  ok('eine Wahl aus der Datenbank hebt die Kennzeichnung auf', !v.eigen, String(v.eigen));
  ok('… und der Vermerk behauptet nichts mehr über eine eigene Angabe',
    !/eigene Angabe/.test(v.beschrieb), v.beschrieb);

  /* Ein leeres Feld ist keine Angabe. */
  sandbox.seltenheitEigen(v, '');
  ok('leer gesetzt heisst: keine eigene Angabe', !v.eigen, String(v.eigen));
}

/* Ein Marktwert von Hand — für Auflagen, die keine erreichbare
   Datenbank führt. Pokécardex kennt Cosmos Holo und ruft 7 Euro auf,
   sendet aber keinen CORS-Kopf: Die App kann dort nie selbst
   nachsehen. Also trägt der Besitzer die Zahl ein — mit Quelle, Kurs
   und Datum, so belegt wie eine geholte. (21.08.2026) */
{
  sandbox.__kursSetzen({ rates: { CHF: 0.9333, USD: 1.16 }, date: '2026-08-20' });
  const k = sandbox.__kurse();
  const v = { gewerk: 'Gengar', bkp: '050/088',
    beschrieb: 'Seltenheit: Selten · Cosmos Holo\nMarktwert: Cardmarket EUR 1.05, Stand 2026-08-21',
    eingeladene: [{ id: 'e_1', firma: 'Marktpreis', betrag: 0.98, status: 'offeriert' }] };

  sandbox.wertVonHand(v, 7, 'EUR', 'Pokécardex');
  ok('von Hand: der Betrag steht in Franken',
    Math.abs(v.eingeladene[0].betrag - Math.round(7 * k.eur * 100) / 100) < 0.001,
    String(v.eingeladene[0].betrag));
  ok('… die Quelle steht im Vermerk',
    /Marktwert: Pokécardex EUR 7\.00, Kurs [\d.]+, Stand .* — von Hand eingetragen/.test(v.beschrieb), v.beschrieb);
  eq('… und es steht nur EINE Marktwert-Zeile da',
    v.beschrieb.split('\n').filter(z => z.indexOf('Marktwert: ') === 0).length, 1);
  eq('… die Angabe selbst bleibt nachlesbar',
    [v.wertEigen.betrag, v.wertEigen.waehrung, v.wertEigen.quelle], [7, 'EUR', 'Pokécardex']);

  /* Die wichtigste Zusage: Kein Nachschlagen wischt die Arbeit weg.
     Die Seltenheit wird dabei trotzdem gesetzt — das sind zwei Fragen. */
  sandbox.auflageAnwenden(v, { seltenheit: 'Selten · Holo', preisEur: 1.05, preisUsd: 0 }, S);
  /* Nicht nur die ZAHL muss überleben, sondern der SATZ. Der erste
     Test prüfte den Betrag - und liess durch, dass die Zeile mit der
     Herkunft weggeräumt wurde. Eine Zahl ohne Herkunft ist schlimmer
     als keine. (Fund vom 21.08.2026) */
  ok('ein Nachschlagen überschreibt den Wert von Hand NICHT',
    Math.abs(v.eingeladene[0].betrag - Math.round(7 * k.eur * 100) / 100) < 0.001,
    String(v.eingeladene[0].betrag));
  eq('… aber die Seltenheit wird gesetzt', v.seltenheit, 'Selten · Holo');
  ok('… und die Herkunft des Werts steht weiterhin da',
    /Marktwert: Pokécardex EUR 7.00.*von Hand eingetragen/.test(v.beschrieb), v.beschrieb);
  eq('… genau einmal',
    v.beschrieb.split('\n').filter(z => z.indexOf('Marktwert: ') === 0).length, 1);

  /* Franken brauchen keinen Kurs. */
  sandbox.wertVonHand(v, 12.5, 'CHF', 'Verkauf an der Börse');
  ok('in Franken steht kein Kurs dabei',
    /Marktwert: Verkauf an der Börse CHF 12\.50, Stand/.test(v.beschrieb), v.beschrieb);
  eq('… und der Betrag gilt unverändert', v.eingeladene[0].betrag, 12.5);

  /* Leeren gibt den Automaten wieder frei. */
  sandbox.wertVonHand(v, '', 'EUR', '');
  ok('leer heisst: kein Wert von Hand mehr', !v.wertEigen, JSON.stringify(v.wertEigen));
  sandbox.auflageAnwenden(v, { seltenheit: 'Selten · Holo', preisEur: 1.05, preisUsd: 0 }, S);
  ok('… und dann greift das Nachschlagen wieder',
    Math.abs(v.eingeladene[0].betrag - Math.round(1.05 * k.eur * 100) / 100) < 0.001,
    String(v.eingeladene[0].betrag));
}

/* Anbieten: ein Preis, mehrere Marktplätze, eine Handlung.

   Die wichtigste Zusage ist die unsichtbare: Der Wunschpreis rührt
   den Marktwert NICHT an. Sonst wäre eine Sammlung wertvoll, weil man
   viel verlangt — und man merkte es erst beim Verkaufen. */
{
  const v = { id: 'v_x', gewerk: 'Gengar', status: 'ausschreibung',
    eingeladene: [{ id: 'e_1', firma: 'Marktpreis', betrag: 11.43, status: 'offeriert' }] };
  const marktVorher = sandbox.kostenZeile(v).prognose;

  sandbox.angebotSetzen(v, 12, ['eBay', 'Ricardo'], true);
  eq('der Angebotspreis steht fest', v.angebot.preis, 12);
  eq('… auf beiden Marktplätzen', v.angebot.plattformen, ['eBay', 'Ricardo']);
  eq('… und das Porto zahlt der Käufer', v.angebot.portoKaeufer, true);
  ok('… die Marktplätze stehen bei den Angefragten',
    ['eBay', 'Ricardo'].every(o => v.eingeladene.some(e => e.firma === o)),
    JSON.stringify(v.eingeladene.map(e => e.firma)));
  ok('… aber OHNE Betrag — sonst wäre ein Wunsch ein Gebot',
    v.eingeladene.filter(e => e.firma !== 'Marktpreis').every(e => e.betrag == null),
    JSON.stringify(v.eingeladene));
  eq('… und der Marktwert bleibt, was er war',
    sandbox.kostenZeile(v).prognose, marktVorher);

  /* Die Gegenprobe: Unter Wert anbieten darf den Wert nicht drücken. */
  sandbox.angebotSetzen(v, 3, ['eBay'], true);
  eq('auch ein Angebot weit unter Wert drückt den Marktwert nicht',
    sandbox.kostenZeile(v).prognose, marktVorher);
  eq('… und der abgewählte Marktplatz ist weg',
    v.eingeladene.filter(e => e.firma === 'Ricardo').length, 0);

  /* Ein Einzelpreis braucht seine Rappen. chf() rundet auf ganze
     Franken - richtig bei einer Bausumme, falsch bei einer Karte fuer
     14.50: dort verschwaende die Haelfte des Unterschieds zum Markt.
     (Fund vom 22.08.2026 beim Eintragen der eBay-Angebote.) */
  /* Der Zusammenhang bestimmt die Waehrung: die Vorlage Unterschriften
     zaehlt Stueck, nicht Franken. Also erst setzen, dann pruefen. */
  sandbox.setVorlageCtx(S);
  eq("ein Einzelpreis behaelt die Rappen", sandbox.chfGenau(14.5), "CHF 14.50");
  eq("… auch bei glatten Betraegen", sandbox.chfGenau(9), "CHF 9.00");
  /* Das Tausendertrennzeichen haengt an der Landessprache des Systems -
     geprueft wird darum nur, dass gerundet und nicht gespalten wird. */
  ok("eine Bausumme rundet weiterhin",
    /^CHF 1.250.000$/.test(sandbox.chf(1250000)), sandbox.chf(1250000));
  ok('die Zeile sagt Preis, Ort und Porto in einem Atemzug',
    /auf eBay · Porto zahlt der Käufer/.test(sandbox.angebotZeile(v)), sandbox.angebotZeile(v));

  /* Zurückziehen räumt das Angebot weg — aber nie den Marktpreis. */
  sandbox.angebotSetzen(v, 0, []);
  ok('zurückgezogen: kein Angebot mehr', !v.angebot, JSON.stringify(v.angebot));
  ok('… der Marktpreis bleibt', v.eingeladene.some(e => e.firma === 'Marktpreis'));
  eq('… und der Wert steht unverändert da', sandbox.kostenZeile(v).prognose, marktVorher);
  eq('… ohne Angebot auch keine Zeile', sandbox.angebotZeile(v), '');
}
/* Die Marktplätze kommen aus der Vorlage. Beim Bau gibt es keine —
   dort bietet man kein Gewerk an, dort schreibt man es aus. */
ok('die Sammlung kennt Marktplätze',
  sandbox.plattformenVon(S).indexOf('Ricardo') >= 0, JSON.stringify(sandbox.plattformenVon(S)));
eq('der Bau kennt keine',
  sandbox.plattformenVon({ id: 'p_b', vorlage: 'bau', vergaben: [] }).length, 0);

/* Zwei Wege zu derselben Zeile muessen dasselbe sagen. Beim Einlesen
   steht der Vorbehalt "guenstigste ueber alle N Auflagen"; waehlte man
   die Auflage spaeter von Hand, fehlte er - und die Zeile behauptete,
   die Zahl gehoere zur gewaehlten Auflage. (Fund vom 21.08.2026:
   CORI-EN028, drei Auflagen, keine mit eigenem Preis.) */
{
  sandbox.__kursSetzen({ rates: { CHF: 0.9333, USD: 1.16 }, date: '2026-08-20' });
  const v = { bkp: 'CORI-EN028', beschrieb: 'Rituakarte', eingeladene: [] };
  sandbox.auflageAnwenden(v, { seltenheit: 'Secret Rare', preisUsd: 0, preisEur: 4.07,
    code: 'CORI-EN028', auflagenGesamt: 3 }, S);
  ok('von Hand gewaehlt: der Vorbehalt steht auch hier',
    /Cardmarket EUR 4.07 für Secret Rare.*günstigste über alle 3 Auflagen/.test(v.beschrieb), v.beschrieb);
  /* Hat die Auflage einen EIGENEN Preis, ist der Vorbehalt falsch. */
  sandbox.auflageAnwenden(v, { seltenheit: 'Ultra Rare', preisUsd: 25.6, preisEur: 4.5,
    code: 'SDK-001', auflagenGesamt: 2 }, S);
  ok('… bei eigenem Preis fehlt er zu Recht',
    !/günstigste/.test(v.beschrieb), v.beschrieb);
}

/* Zustand und Angebotstext — der Kern, der jeden Verkauf speist.

   Der Zustand kommt aus der Vorlage: Sammelkarten sprechen die Skala
   von Cardmarket, weil man dort mit «NM» verstanden wird und mit
   «gut» nicht. Ein Gewerk hat keinen Zustand — dort darf gar nichts
   erscheinen. */
eq('die Sammlung kennt die Kartenskala',
  sandbox.zustandSkala(S).map(x => x[0]).join(' '), 'M NM EX GD LP PL PO');
eq('der Bau kennt keinen Zustand',
  sandbox.zustandSkala({ id: 'p_b', vorlage: 'bau', vergaben: [] }).length, 0);
eq('das Kürzel führt zu Name und Bedeutung',
  sandbox.zustandInfo(S, 'NM').name, 'Near Mint');
ok('… und die Bedeutung steht dabei, weil «Excellent» nicht «ausgezeichnet» heisst',
  /leichte Spuren/.test(sandbox.zustandInfo(S, 'EX').erklaerung),
  sandbox.zustandInfo(S, 'EX').erklaerung);

{
  const v = { gewerk: 'Gengar', bkp: '050/088', satz: 'Perfect Order',
    seltenheit: 'Rare · Cosmos Holo', sprache: 'en', quelleName: 'TCGdex',
    zustand: 'NM', angebot: { preis: 12, plattformen: ['eBay'], portoKaeufer: true, seit: '2026-08-21' } };

  const t = sandbox.angebotTitel(v, S);
  ok('der Titel nennt Spiel, Name und Nummer',
    /Pokémon/.test(t) && /Gengar/.test(t) && /050\/088/.test(t), t);
  ok('… und bleibt in eBays Grenze von 80 Zeichen', t.length <= 80, t.length + ': ' + t);

  /* Die harte Zusage: Ein zu langer Name darf nie den NAMEN kosten —
     abgeschnitten wird von hinten, wo der Satzname steht. */
  const lang = { ...v, gewerk: 'Black Luster Soldier - Soldier of Light and Darkness',
    satz: 'Chaos Origins', seltenheit: 'Secret Rare', bkp: 'CORI-EN028', quelleName: 'YGOPRODeck' };
  const tl = sandbox.angebotTitel(lang, S);
  ok('ein langer Name sprengt die Grenze nicht', tl.length <= 80, tl.length + ': ' + tl);
  ok('… und der Name steht trotzdem drin', /Black Luster Soldier/.test(tl), tl);

  const txt = sandbox.angebotText(v, S);
  ok('der Text nennt den Zustand im Klartext',
    /Zustand: Near Mint — fast neu/.test(txt), txt);
  ok('… und wer das Porto zahlt', /Porto trägt der Käufer/.test(txt), txt);
  /* Die inneren Vorbehalte über Preisquellen gehen den Käufer nichts
     an und klängen im Angebot wie Unsicherheit. */
  ok('… aber nichts über Preisquellen', !/Cardmarket|günstigste|von Hand/.test(txt), txt);

  /* Der Schlusssatz gehört dem Verkäufer. Das Programm legt ihm nichts
     Rechtliches in den Mund. */
  ok('ohne eigenen Schlusssatz steht keiner da',
    !/Privatverkauf|Garantie|Rücknahme/.test(txt), txt);
  const mitFuss = sandbox.angebotText(v, { ...S, angebotFuss: 'Privatverkauf, keine Rücknahme.' });
  ok('… mit eigenem steht er unten', /Privatverkauf, keine Rücknahme\.$/.test(mitFuss), mitFuss);

  /* Ohne Zustand wird nichts behauptet — er fehlt sichtbar. */
  const ohne = sandbox.angebotText({ ...v, zustand: '' }, S);
  ok('ohne Zustand sagt der Text, dass er fehlt',
    /Zustand: noch nicht angegeben/.test(ohne), ohne);

  /* Von Hand geschrieben schlägt erzeugt — sonst wäre jede Mühe weg. */
  eq('ein eigener Titel gilt',
    sandbox.angebotTitel({ ...v, angebotTitel: 'Mein Titel' }, S), 'Mein Titel');
  eq('ein eigener Text auch',
    sandbox.angebotText({ ...v, angebotText: 'Mein Text' }, S), 'Mein Text');
}

/* Eigene Fotos. Das Verkleinern selbst braucht einen Browser (Leinwand,
   Bildbitmap) — geprüft wird hier, was ohne ihn gilt: die Verwaltung,
   die Grössenrechnung und die Frage, welches Bild gezeigt wird. */
{
  const bild = (id, gr) => ({ id, daten: 'data:image/jpeg;base64,xxx', groesse: gr, zeit: '2026-08-21' });
  const v = { id: 'v_f', gewerk: 'Gengar', bild: 'https://katalog/gengar.webp' };

  /* Ohne eigenes Foto zeigt das Katalogbild — aber es weiss, dass es
     eines ist. Ein Katalogbild zeigt die KARTE, nicht DIESE Karte. */
  eq('ohne eigenes Foto gilt das Katalogbild', sandbox.hauptBild(v), 'https://katalog/gengar.webp');
  eq('… und es gibt sich als fremdes zu erkennen', sandbox.istEigenesBild(v), false);

  sandbox.fotoHinzu(v, bild('f_1', 90000));
  sandbox.fotoHinzu(v, bild('f_2', 80000));
  eq('zwei Fotos abgelegt', sandbox.fotosVon(v).length, 2);
  eq('das eigene schlägt den Katalog', sandbox.hauptBild(v), 'data:image/jpeg;base64,xxx');
  eq('… und sagt es', sandbox.istEigenesBild(v), true);
  eq('die Grösse wird geführt', sandbox.fotoGroesse(v), 170000);

  /* Das erste ist das Hauptbild — man muss ein anderes nach vorn holen
     können, ohne die übrigen zu verlieren. */
  sandbox.fotoHaupt(v, 'f_2');
  eq('nach vorn geholt', sandbox.fotosVon(v).map(f => f.id), ['f_2', 'f_1']);
  eq('… und keines ging verloren', sandbox.fotosVon(v).length, 2);
  sandbox.fotoHaupt(v, 'gibtsnicht');
  eq('eine unbekannte Kennung ändert nichts', sandbox.fotosVon(v).map(f => f.id), ['f_2', 'f_1']);

  sandbox.fotoWeg(v, 'f_2');
  eq('gelöscht', sandbox.fotosVon(v).map(f => f.id), ['f_1']);
  sandbox.fotoWeg(v, 'f_1');
  eq('das letzte weg heisst: kein Feld mehr', v.fotos, undefined);
  eq('… und wieder gilt der Katalog', sandbox.hauptBild(v), 'https://katalog/gengar.webp');

  /* Die Grösse fürs ganze Projekt — daran sieht man, wann die Datei
     träge wird, BEVOR sie es ist. */
  const pr = { id: 'p_f', vorlage: 'sammlung', vergaben: [
    { id: 'a', fotos: [bild('x', 100000)] },
    { id: 'b', fotos: [bild('y', 250000), bild('z', 150000)] },
    { id: 'c' } ] };
  eq('Projektgrösse zählt alle zusammen', sandbox.fotoGroesseProjekt(pr), 500000);
  eq('Bytes werden lesbar', [sandbox.kb(512), sandbox.kb(90000), sandbox.kb(5 * 1024 * 1024)],
    ['512 B', '88 KB', '5.0 MB']);
}

/* Artikelmerkmale. Das Holen braucht das Netz; geprueft wird hier,
   was ohne es gilt: die Ableitungen und die Darstellung.

   Der Charakter ist das Feld mit der zweithoechsten Suchhaeufigkeit
   bei eBay (990'000). Er ist die Art selbst, ohne die Zutaten des
   Drucks - wer nach «Excadrill» sucht, will auch «Mega Excadrill ex»
   finden. */
eq('Mega und ex fallen weg', sandbox.charakterAus('Mega Excadrill ex'), 'Excadrill');
eq('ein blosser Name bleibt', sandbox.charakterAus('Gengar'), 'Gengar');
eq('V faellt weg', sandbox.charakterAus('Charizard V'), 'Charizard');
eq('VSTAR und die Regionalform auch',
  sandbox.charakterAus('Hisuian Zoroark VSTAR'), 'Zoroark');
/* Aber ein «ex» MITTEN im Namen ist keins - da faellt nichts. */
eq('nur am Ende wird geschnitten', sandbox.charakterAus('Exeggutor'), 'Exeggutor');

eq('die Besonderheit steckt in der Variante',
  sandbox.besonderheitAus('Rare · Cosmos Holo'), 'Cosmos Holo');
eq('ohne Variante keine Besonderheit', sandbox.besonderheitAus('Secret Rare'), '');

{
  /* Die Reihenfolge ist die von eBay, nach Suchhaeufigkeit: Wer oben
     anfaengt und in der Mitte aufhoert, hat trotzdem das Richtige
     getan. Darum steht sie fest und wird geprueft. */
  const v = { merkmale: { spiel: 'Pokémon TCG', kartenname: 'Mega Excadrill ex',
    charakter: 'Excadrill', seltenheit: 'Ultra Rare', illustrator: '' } };
  const z = sandbox.merkmalZeilen(v);
  eq('Spiel steht zuoberst und ist Pflicht', [z[0].key, z[0].pflicht], ['spiel', true]);
  eq('danach der Kartenname', z[1].key, 'kartenname');
  eq('danach der Charakter', z[2].key, 'charakter');
  /* Ein leeres Feld verschwindet NICHT - es ist die Auskunft, dass
     man es selbst wissen muss. */
  eq('jedes Feld erscheint, auch das leere', z.length, 15);
  ok('das leere traegt keinen Wert',
    z.filter(x => x.key === 'illustrator')[0].wert === '', 'illustrator');
  /* Zum Mitnehmen aber nur, was wirklich dasteht. */
  ok('der Text nennt nur Bekanntes',
    /Charakter: Excadrill/.test(sandbox.merkmalText(v))
    && !/Illustrator/.test(sandbox.merkmalText(v)), sandbox.merkmalText(v));
  eq('ohne Merkmale kein Text', sandbox.merkmalText({}), '');
}

/* Auf einer deutschen Karte steht DRLG-DE023, nicht DRLG-EN023. Der
   englische Code ist der SCHLUESSEL zum Nachschlagen, nicht die Kennung
   der Sache in der Hand - und danach sucht auch ein Kaeufer. Die
   Nummernspalte zeigte trotzdem den englischen, obwohl der Kommentar
   daneben "die Nummer, die auf der Karte steht" versprach.
   (Fund vom 22.08.2026, 67 Karten waren betroffen.) */
{
  const de = { setCode: "DRLG-EN023", spracheVon: "DRLG-DE023", spracheNach: "DRLG-EN023",
    name: "Mathematician", seltenheit: "Secret Rare", setName: "Dragons of Legend",
    passcode: "41386308", sprache: "de", setSicher: true, auflagen: 1, preisUsd: 4.72, preisEur: 0 };
  const po = sandbox.ygoZuPosten(de, { usd: 0.8, eur: 0.93, datum: "2026-08-22" });
  eq("die Nummer ist die von der Karte, nicht die vom Nachschlagen", po.bkp, "DRLG-DE023");
  eq("die Sprache reist mit", po.sprache, "de");
  ok("der Vermerk sagt beides", /Eingegeben DRLG-DE023, nachgeschlagen als DRLG-EN023/.test(po.beschrieb), po.beschrieb);
  /* Eine englische Karte behaelt ihren Code - dort gibt es keine
     Umschreibung, also auch keinen abweichenden Ursprung. */
  const en = { ...de, spracheVon: "", spracheNach: "", sprache: "en" };
  eq("englisch bleibt englisch", sandbox.ygoZuPosten(en, { usd: 0.8, eur: 0.93 }).bkp, "DRLG-EN023");
}

// Treffer → Posten
const posten = sandbox.ygoZuPosten(a1.treffer[0], k);
/* Die Nummer ist die, die auf der Karte steht — nicht die Kategorie.
   Danach sucht man, damit vergleicht man, die steht im Angebot. */
eq('Posten trägt die Nummer von der Karte', posten.bkp, 'CORI-EN030');
eq('… und den Satz für die Gruppenüberschrift', posten.satz, 'Chaos Origins');
eq('… und der Posten liegt unter Einzelkarten', posten.kategorie, '1');
eq('ohne bestimmte Auflage tritt der Passcode an die Stelle der Nummer',
  sandbox.ygoZuPosten(a4.treffer[0], k).bkp, '89631146');
eq('Posten heisst wie die Karte', posten.gewerk, 'Invoked Sorath');
eq('Marktwert steht im Posten', posten.marktwert, 0.25);
ok('der Vermerk hält Set, Passcode und Herkunft fest',
  /CORI-EN030/.test(posten.beschrieb) && /Passcode 43989315/.test(posten.beschrieb) && /Cardmarket/.test(posten.beschrieb));
ok('das Bild kommt mit', !!posten.bild);
eq('bei sicherer Auflage keine Merkfahne', posten.pruefen, false);

/* Wer nicht wählt, bekommt die Karte trotzdem — aber mit der Fahne.
   Nichts wird verschwiegen und nichts blockiert. */
const postenOffen = sandbox.ygoZuPosten(a4.treffer[0], k);
eq('unklare Auflage: Merkfahne gesetzt', postenOffen.pruefen, true);
ok('… und die erste Zeile der Notiz sagt warum',
  postenOffen.beschrieb.split('\n')[0].indexOf('⚑') === 0
  && /Auflage nicht bestimmt/.test(postenOffen.beschrieb), postenOffen.beschrieb.split('\n')[0]);
ok('… und es steht keine erfundene Seltenheit drin',
  !/Ultra Rare/.test(postenOffen.beschrieb), postenOffen.beschrieb);

// Die Fahne überlebt das Anlegen und lässt sich von Hand wegnehmen
sandbox.csvPostenAnlegen(p.id, [postenOffen]);
const mitFahne = p.vergaben[p.vergaben.length - 1];
eq('die Fahne steht am angelegten Posten', mitFahne.pruefen, true);
sandbox.pruefErledigt(p.id, mitFahne.id);
eq('«geprüft» nimmt die Fahne weg', mitFahne.pruefen, false);
ok('… und die Fahnen-Zeile aus der Notiz', mitFahne.beschrieb.indexOf('⚑') < 0, mitFahne.beschrieb);
ok('… der Rest der Notiz bleibt stehen', /Passcode 89631146/.test(mitFahne.beschrieb), mitFahne.beschrieb);

/* ---- 4b) Kurse: Rohstoffe, Krypto, Währungen ----
   Geprüft wird die Übersetzung, nicht die Laune fremder Server. Die
   Antworten sind abgeschrieben von echten vom 21.08.2026. */
eq('erkennt ein Edelmetall', sandbox.kursArt('XAU'), { art: 'metall', symbol: 'XAU', name: 'Gold' });
eq('… auch auf Deutsch geschrieben', sandbox.kursArt('gold').symbol, 'XAU');
eq('erkennt ein bekanntes Krypto-Kürzel', sandbox.kursArt('btc'), { art: 'krypto', symbol: 'BTC', id: 'bitcoin' });
eq('erkennt eine Währung', sandbox.kursArt('usd').art, 'waehrung');
eq('Unbekanntes geht in die Suche', sandbox.kursArt('PEPE').art, 'krypto-suche');
eq('leer bleibt leer', sandbox.kursArt('  ').art, '');

/* Die Feinunze ist die Falle: Zwölf Gramm Gold sind nicht zwölf
   Unzen, sondern 0.386 — ein Faktor 31. */
ok('Gramm werden in Unzen umgerechnet',
  Math.abs(sandbox.inUnzen(31.1034768, 'g') - 1) < 1e-9, String(sandbox.inUnzen(31.1034768, 'g')));
eq('Unzen bleiben Unzen', sandbox.inUnzen(2, 'oz'), 2);
ok('ein Kilo sind gut 32 Unzen', Math.abs(sandbox.inUnzen(1, 'kg') - 32.1507) < 0.001);
eq('unbekannte Einheit zählt als Stück', sandbox.inUnzen(5, 'Stk'), 5);

/* Die Rechenzeile muss aufgehen, wenn man sie nachrechnet. */
ok('Rechenzeile bei Stück: schlicht Menge × Kurs',
  sandbox.mengenZeile(4, 'ETH', 1910.44, false) === '4 ETH × CHF 1\'910.44',
  sandbox.mengenZeile(4, 'ETH', 1910.44, false));
ok('Rechenzeile bei Gramm zeigt die Umrechnung',
  /500 g = 16\.0754 oz × CHF 55\.56 je Feinunze/.test(sandbox.mengenZeile(500, 'g', 55.56, true)),
  sandbox.mengenZeile(500, 'g', 55.56, true));
ok('… und rechnet sich nach', (() => {
  const z = sandbox.mengenZeile(500, 'g', 55.56, true);
  const m = z.match(/= ([\d.]+) oz × CHF ([\d'.]+)/);
  const wert = Number(m[1]) * Number(m[2].replace(/'/g, ''));
  return Math.abs(wert - 893.15) < 0.5;
})());

// Ein Treffer wird zum Posten — mit Menge, Kürzel und Herkunft
{
  const t = { nummer: 'XAU', name: 'Gold', art: 'Edelmetall', kategorie: '201',
    preisChf: 3663.85, einheit: 'oz', quelle: 'gold-api', herkunft: 'gold-api, USD 4585.60 je Feinunze' };
  const po = sandbox.kursZuPosten(t, 12, 'g');
  eq('Kürzel wird zur Nummer', po.bkp, 'XAU');
  eq('Anlageklasse aus der Quelle', po.kategorie, '201');
  eq('Menge und Einheit stehen am Posten', [po.menge, po.einheit], [12, 'g']);
  ok('Wert = Menge in Unzen × Kurs', Math.abs(po.marktwert - 1413.55) < 0.1, String(po.marktwert));
  ok('die Herkunft steht im Vermerk', /gold-api/.test(po.beschrieb) && /je Feinunze/.test(po.beschrieb));
  ok('und die Rechenzeile dazu', /12 g = 0\.3858 oz × CHF/.test(po.beschrieb), po.beschrieb);

  const krypto = sandbox.kursZuPosten({ nummer: 'BTC', name: 'Bitcoin', art: 'Kryptowährung',
    kategorie: '101', preisChf: 61827, einheit: 'BTC', kursId: 'bitcoin', herkunft: 'CoinGecko' }, 0.35, 'BTC');
  ok('Krypto rechnet ohne Unzen', Math.abs(krypto.marktwert - 21639.45) < 0.01, String(krypto.marktwert));
  eq('die Kennung der Quelle bleibt am Posten', krypto.kursId, 'bitcoin');
}

/* Chargen: jeder Kauf eine Zeile.

   Ein Depot, das je Anlage nur eine Zeile führt, kann «am xx kaufte
   ich so und so viel» nicht abbilden — der Einstand wäre ein
   Durchschnitt, der nirgends herkommt. */
{
  const gold = { nummer: 'XAU', name: 'Gold', art: 'Edelmetall', kategorie: '201',
    preisChf: 3668.48, einheit: 'oz', herkunft: 'gold-api' };
  const a = sandbox.kursZuPosten(gold, 12, 'g', '2026-03-12');
  const b = sandbox.kursZuPosten(gold, 20, 'g', '2026-07-04');
  eq('die Charge trägt ihr Kaufdatum', a.datum, '2026-03-12');
  eq('der Name der Anlage trägt die Gruppenüberschrift', a.satz, 'Gold');
  eq('beide Chargen dieselbe Nummer', [a.bkp, b.bkp], ['XAU', 'XAU']);
  ok('… aber verschiedene Werte', Math.abs(a.marktwert - 1415.33) < 0.5 && Math.abs(b.marktwert - 2358.89) < 0.5,
    a.marktwert + ' / ' + b.marktwert);

  /* Gruppiert wird beim Depot nach dem Kürzel — sonst stünden die
     Chargen einer Anlage nicht beieinander und das Zwischentotal wäre
     nicht ihr Bestand. */
  const D = { vorlage: 'depot' };
  eq('Depot gruppiert nach Kürzel', sandbox.gruppeVon({ symbol: 'XAU', bkp: 'XAU' }, D), 'XAU');
  eq('… auch klein geschrieben', sandbox.gruppeVon({ symbol: 'btc' }, D), 'BTC');
  eq('… ohne Kürzel bleibt es offen', sandbox.gruppeVon({ bkp: '' }, D), '?');
  eq('die Überschrift ist der Name der Anlage',
    sandbox.gruppeTitel('XAU', [{ satz: 'Gold' }], D), 'Gold');

  /* Die Zeile unter der Bezeichnung: Kaufdatum und Einstand JE
     EINHEIT — die Zahl, mit der man den heutigen Kurs vergleicht. */
  const mitEinstand = { ...a, schaetzung: 1450 };
  const z = sandbox.chargenZeile(mitEinstand);
  ok('Kaufdatum steht in der Zeile', /gekauft 12\.03\.2026/.test(z), z);
  ok('Einstand je Feinunze, nicht als Summe', /Einstand CHF 3'758\.\d\d je Feinunze/.test(z), z);
  ok('… und das rechnet sich nach', (() => {
    const m = z.match(/CHF ([\d'.]+) je/);
    const je = Number(m[1].replace(/'/g, ''));
    return Math.abs(je * sandbox.inUnzen(12, 'g') - 1450) < 0.5;
  })());
  eq('ohne Datum und Einstand bleibt die Zeile leer', sandbox.chargenZeile({ menge: 12, einheit: 'g' }), '');
  ok('bei Stückgut ohne Unzen-Umrechnung',
    /Einstand CHF 49'000\.00 je BTC/.test(sandbox.chargenZeile(
      { datum: '', menge: 0.2, einheit: 'BTC', kategorie: '101', schaetzung: 9800 })),
    sandbox.chargenZeile({ menge: 0.2, einheit: 'BTC', kategorie: '101', schaetzung: 9800 }));
}

// Die Vorlage selbst
eq('Depot führt Mengen', sandbox.hatMengen({ vorlage: 'depot' }), true);
eq('eine Kartensammlung nicht — ein Stück je Zeile', sandbox.hatMengen({ vorlage: 'sammlung' }), false);
eq('Depot bringt den Kursdienst mit', sandbox.nachschlagDienst({ vorlage: 'depot' }), 'kurse');
eq('die Sammlung ihren eigenen', sandbox.nachschlagDienst({ vorlage: 'sammlung' }), 'ygo');
eq('ein Bauvorhaben keinen', sandbox.nachschlagDienst({ vorlage: 'bau' }), null);
ok('die Anlageklassen des Nachschlagens stehen im Katalog', (() => {
  const codes = new Set(sandbox.__katalogCodes('depot'));
  return ['101', '201', '301', '401'].every(c => codes.has(c));
})());

/* ---- 5) Der ganze Weg, mit einer Netz-Attrappe ---- */
function mitNetz(antworten, fn) {
  const gerufen = [];
  const alt = sandbox.fetch;
  sandbox.fetch = (url) => {
    gerufen.push(String(url));
    const a = antworten[gerufen.length - 1];
    if (a instanceof Error) return Promise.reject(a);
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(a) });
  };
  return Promise.resolve(fn(gerufen)).then(r => { sandbox.fetch = alt; return r; },
                                           e => { sandbox.fetch = alt; throw e; });
}

/* Wie `mitNetz`, aber mit Kontrolle über Status und Körper. */
function mitNetzRoh(antworten, fn) {
  const alt = sandbox.fetch; let i = 0;
  sandbox.fetch = () => {
    const a = antworten[i++] || { status: 200, ok: true, body: {} };
    return Promise.resolve({ ok: a.ok, status: a.status,
      json: () => a.body ? Promise.resolve(a.body) : Promise.reject(new Error('kein JSON')) });
  };
  return Promise.resolve(fn()).then(r => { sandbox.fetch = alt; return r; },
                                    e => { sandbox.fetch = alt; throw e; });
}

async function netzPruefungen() {
  const kursAntwort = { rates: { CHF: 0.9333, USD: 1.16 }, date: '2026-08-20' };

  await mitNetz([ANTWORT_PASSCODE, kursAntwort], async gerufen => {
    const erg = await sandbox.kartenSuche('43989315');
    eq('Weg über den Passcode: ein Treffer, keine Meldung', [erg.treffer.length, erg.fehler], [1, '']);
    eq('… und nur eine Anfrage an die Datenbank',
      gerufen.filter(u => /ygoprodeck/.test(u)).length, 1);
  });

  await mitNetz([ANTWORT_SETCODE, ANTWORT_SDK_VOLL, kursAntwort], async gerufen => {
    const erg = await sandbox.kartenSuche('SDK-001');
    eq('Weg über den Set-Code: Kartenart nachgeladen', erg.treffer[0].kategorie, '1');
    eq('… und das gesuchte Set bleibt stehen', erg.treffer[0].setCode, 'SDK-001');
    eq('… die Seltenheit der Erstauskunft ebenfalls', erg.treffer[0].seltenheit, 'Ultra Rare');
    eq('… zwei Anfragen an die Datenbank', gerufen.filter(u => /ygoprodeck/.test(u)).length, 2);
  });

  /* Dieselbe Karte liegt in der Datenbank unter mehreren Passcodes
     (Alternativbilder) mit VERSCHIEDENEN Auflagenlisten. Die Liste,
     die beim Nachladen kommt, kennt das gesuchte Set darum manchmal
     nicht — die Gewissheit aus der ersten Auskunft muss trotzdem
     stehenbleiben. Sonst kostet es die richtige Bewertung: LOB-001
     Ultra Rare fiel so von CHF 49.66 auf CHF 0.02. */
  const OHNE_DAS_SET = {
    data: [{
      id: 89631146, name: 'Blue-Eyes White Dragon', humanReadableCardType: 'Normal Monster',
      frameType: 'normal',
      card_sets: [{ set_name: 'Ganz andere Sammlung', set_code: 'ZZZ-EN999', set_rarity: 'Common', set_price: '0.10' }],
      card_prices: [{ cardmarket_price: '0.02' }],
      card_images: [{ image_url_small: 'x.jpg' }],
    }],
  };
  const ERST_LOB = { id: 89631146, name: 'Blue-Eyes White Dragon',
    set_name: 'Legend of Blue Eyes White Dragon', set_code: 'LOB-001',
    set_rarity: 'Ultra Rare', set_price: '62.15' };
  await mitNetz([ERST_LOB, OHNE_DAS_SET, kursAntwort], async () => {
    const erg = await sandbox.kartenSuche('LOB-001');
    const tr = erg.treffer[0];
    eq('Nachladen: die Auflage bleibt bestimmt', tr.setSicher, true);
    eq('Nachladen: Set und Seltenheit der ersten Auskunft gelten', [tr.setCode, tr.seltenheit], ['LOB-001', 'Ultra Rare']);
    eq('Nachladen: und ihr Preis, nicht der Sammelpreis', tr.preisUsd, 62.15);
    ok('Nachladen: keine Merkfahne, es ist ja bestimmt', sandbox.ygoZuPosten(tr, k).pruefen === false);
    ok('Nachladen: der Wert liegt in der richtigen Grössenordnung',
      sandbox.ygoMarktwert(tr, k) > 40, String(sandbox.ygoMarktwert(tr, k)));
  });

  /* Set-Codes anderer Sprachen: die Datenbank führt nur englische. */
  eq('deutscher Code wird englisch', sandbox.ygoAufEnglisch('CORI-DE030'), 'CORI-EN030');
  eq('französischer auch', sandbox.ygoAufEnglisch('MP22-FR266'), 'MP22-EN266');
  eq('alte Sätze trugen einen Buchstaben', sandbox.ygoAufEnglisch('LOB-G001'), 'LOB-001');
  eq('englischer Code bleibt, wie er ist', sandbox.ygoAufEnglisch('CORI-EN030'), '');
  eq('Code ohne Sprache bleibt auch', sandbox.ygoAufEnglisch('SDK-001'), '');
  eq('japanisch lässt sich nicht umschreiben', sandbox.ygoAufEnglisch('CORI-JP030'), '');
  await mitNetz([{ error: 'No card matching your query was found in the database' }, ANTWORT_PASSCODE, kursAntwort], async gerufen => {
    const erg = await sandbox.kartenSuche('CORI-DE030');
    ok('deutscher Set-Code findet über den englischen Zwilling', erg.treffer.length === 1, erg.fehler);
    ok('… die zweite Anfrage ging auf den englischen Code', /CORI-EN030/.test(gerufen[1] || ''), gerufen.join(' '));
    eq('… und es wird gesagt, was ersetzt wurde',
      [erg.treffer[0].spracheVon, erg.treffer[0].spracheNach], ['CORI-DE030', 'CORI-EN030']);
    ok('… mit dem Vorbehalt zum Preis im Vermerk',
      /Preis = englische Auflage/.test(sandbox.ygoZuPosten(erg.treffer[0], k).beschrieb));
  });

  await mitNetz([new Error('Netz weg')], async () => {
    const erg = await sandbox.kartenSuche('43989315');
    ok('ohne Netz eine Meldung statt eines Absturzes', !erg.treffer.length && !!erg.fehler, erg.fehler);
  });

  await mitNetz([{ error: 'No card matching your query was found in the database' }, kursAntwort], async () => {
    const erg = await sandbox.kartenSuche('99999999');
    ok('unbekannte Nummer: Meldung, nichts angelegt', !erg.treffer.length && !!erg.fehler);
    ok('… und zwar die verständliche', /keine Karte verzeichnet/.test(erg.fehler), erg.fehler);
  });

  /* Die Datenbank antwortet auf eine unbekannte Nummer mit 400 UND
     einer Begründung. Die Begründung ist brauchbar, «400» nicht. */
  await mitNetzRoh([{ status: 400, ok: false, body: { error: 'No card matching your query was found in the database' } }], async () => {
    const erg = await sandbox.kartenSuche('00000001');
    ok('400 mit Begründung: die Begründung gewinnt', /keine Karte verzeichnet/.test(erg.fehler), erg.fehler);
  });
  await mitNetzRoh([{ status: 503, ok: false, body: null }], async () => {
    const erg = await sandbox.kartenSuche('43989315');
    ok('503 ohne Begründung: dann eben die Statusnummer', /503/.test(erg.fehler), erg.fehler);
  });

  // Und der Posten landet wirklich im Projekt, mit Bild und Marktwert als Angebot.
  const vorher = p.vergaben.length;
  sandbox.csvPostenAnlegen(p.id, [sandbox.ygoZuPosten(a1.treffer[0], k)]);
  const neu = p.vergaben[p.vergaben.length - 1];
  eq('nachgeschlagene Karte ist im Projekt', p.vergaben.length, vorher + 1);
  eq('sie trägt ihr Bild', !!neu.bild, true);
  eq('der Marktwert steht als Angebot vom Markt', sandbox.bestBetrag(neu), 0.25);
  eq('sie trägt die Nummer von der Karte', neu.bkp, 'CORI-EN030');
  eq('die Kartenart ist mitgekommen', neu.kategorie, '1');
  eq('der Satz ist mitgekommen', neu.satz, 'Chaos Origins');
}

netzPruefungen().then(bilanz, e => {
  ok('Netz-Prüfungen ohne Ausnahme', false, (e && e.stack) || String(e));
  bilanz();
});

function bilanz() {
  R.forEach(r => console.log((r.ok ? 'OK   | ' : 'FAIL | ') + r.name + (r.msg ? '  → ' + r.msg : '')));
  console.log('------------------------------------------');
  console.log(pass + ' OK, ' + fail + ' Fehler');
  process.exit(fail ? 2 : 0);
}

