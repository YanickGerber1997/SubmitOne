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
eq('Fusion gehört ins Extra Deck', sandbox.ygoKategorie('fusion'), '104');
eq('Link auch', sandbox.ygoKategorie('link'), '104');
eq('Pendel schlägt Fusion', sandbox.ygoKategorie('fusion_pendulum'), '105');
eq('Zauber', sandbox.ygoKategorie('spell'), '102');
eq('Falle', sandbox.ygoKategorie('trap'), '103');
eq('Effektmonster', sandbox.ygoKategorie('effect'), '101');
eq('Unbekanntes wird Neuzugang, nicht falsch einsortiert', sandbox.ygoKategorie('waswohl'), '901');
ok('jede vergebene Kategorie steht auch im Katalog der Vorlage', (() => {
  const codes = new Set(sandbox.__katalogCodes('sammlung'));
  return ['normal','effect','ritual','spell','trap','fusion','synchro','xyz','link','normal_pendulum','waswohl']
    .every(f => codes.has(sandbox.ygoKategorie(f)));
})());

// Antwort übersetzen
const a1 = sandbox.ygoAuswerten(ANTWORT_PASSCODE, { art: 'passcode', wert: '43989315' });
eq('Passcode-Antwort: ein Treffer', a1.treffer.length, 1);
eq('Name übernommen', a1.treffer[0].name, 'Invoked Sorath');
eq('Kategorie aus der Kartenart', a1.treffer[0].kategorie, '104');
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
eq('… und die Anzahl Auflagen ist bekannt', a3.treffer[0].auflagen, 2);
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
eq('… und die zweite Gruppe sind die geschlossenen Produkte',
  sandbox.gruppeTitel('2', [], S), 'Geschlossene Produkte');
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
  /günstigste von 2 Auflagen/.test(sandbox.ygoHerkunft(a4.treffer[0], k)));
ok('bei bekannter Auflage steht deren Set-Code beim Preis',
  /TCGPlayer USD 25\.60 für SDK-001/.test(sandbox.ygoHerkunft(a3.treffer[0], k)));
ok('… und dann fehlt die Warnung zu Recht',
  !/günstigste von/.test(sandbox.ygoHerkunft(a3.treffer[0], k)));
ok('die Herkunft des Werts steht dabei',
  /Cardmarket EUR 0\.27/.test(sandbox.ygoHerkunft(a1.treffer[0], k)) && /Stand 2026-08-20/.test(sandbox.ygoHerkunft(a1.treffer[0], k)));
ok('ein genäherter Kurs wird als solcher benannt',
  /genähert/.test(sandbox.ygoHerkunft(a1.treffer[0], { eur: 0.93, usd: 0.8, datum: '2026-08-21', geschaetzt: true })));

// Treffer → Posten
const posten = sandbox.ygoZuPosten(a1.treffer[0], k);
/* Die Nummer ist die, die auf der Karte steht — nicht die Kategorie.
   Danach sucht man, damit vergleicht man, die steht im Angebot. */
eq('Posten trägt die Nummer von der Karte', posten.bkp, 'CORI-EN030');
eq('… und den Satz für die Gruppenüberschrift', posten.satz, 'Chaos Origins');
eq('… die Kartenart bleibt als eigene Angabe erhalten', posten.kategorie, '104');
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
    eq('Weg über den Set-Code: Kartenart nachgeladen', erg.treffer[0].kategorie, '101');
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
  eq('die Kartenart ist mitgekommen', neu.kategorie, '104');
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

