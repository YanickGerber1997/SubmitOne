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

// Die richtige Auflage — daran ist die erste Fassung aufgelaufen
eq('Set-Code-Suche: die Auflage steht fest', a3.treffer[0].setSicher, true);
eq('… und die Anzahl Auflagen ist bekannt', a3.treffer[0].auflagen, 2);
ok('bei EINER Auflage steht sie ebenfalls fest', a1.treffer[0].setSicher === true && a1.treffer[0].auflagen === 1);
const a4 = sandbox.ygoAuswerten(ANTWORT_SDK_VOLL, { art: 'name', wert: 'Blue-Eyes' });
eq('Namenssuche: die Auflage steht NICHT fest', a4.treffer[0].setSicher, false);

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
eq('Posten trägt die Katalognummer', posten.bkp, '104');
eq('Posten heisst wie die Karte', posten.gewerk, 'Invoked Sorath');
eq('Marktwert steht im Posten', posten.marktwert, 0.25);
ok('der Vermerk hält Set, Passcode und Herkunft fest',
  /CORI-EN030/.test(posten.beschrieb) && /Passcode 43989315/.test(posten.beschrieb) && /Cardmarket/.test(posten.beschrieb));
ok('das Bild kommt mit', !!posten.bild);

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
  eq('sie liegt in der richtigen Kategorie', neu.bkp, '104');
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

