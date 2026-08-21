// Prüft den messenden Seitenumbruch — DRUCK_UMBRUCH_JS in app.js.
//
// Der Umbruch läuft im Druckfenster und misst, was wirklich dasteht.
// Vorher wurde geschätzt («13 mm Kopf plus 4,6 mm je Zeile»), und sobald
// ein Firmenname umbrach oder eine Schrift nachlud, lief der Inhalt unter
// die Fusszeile. Das Blatt ging nicht auf — jedes Mal woanders.
//
// Hier bekommt der Umbruch ein winziges DOM mit bekannten Höhen. Dann
// lässt sich nachrechnen, wo er trennt, statt es zu glauben.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let fehler = 0, geprueft = 0;
const ok = (bed, was) => { geprueft++; if (!bed) { fehler++; console.log('  FEHLT: ' + was); } };

const quelle = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const treffer = quelle.match(/const DRUCK_UMBRUCH_JS = `([\s\S]*?)`;\s*$/m);

console.log('\n=== Der Umbruch ist da und lesbar ===');
ok(!!treffer, 'DRUCK_UMBRUCH_JS steht in app.js');
const skript = treffer ? treffer[1] : '';
let lesbar = true;
try { new vm.Script(skript, { filename: 'druck-umbruch.js' }); }
catch (e) { lesbar = false; console.log('  ' + e.message); }
ok(lesbar, 'und lässt sich als JavaScript lesen');

/* Der Umbruch steht in app.js in einer Vorlage-Zeichenkette. Ein
   einziger Backtick darin — auch in einem Kommentar — beendet sie, und
   der Rest der Datei wird zu Zeichenkette. Genau das ist am 14.08.2026
   passiert: «Unexpected identifier 'zeilen'», und app.js liess sich gar
   nicht mehr laden. Ein `${` hätte dieselbe Wirkung. */
ok(skript.indexOf('`') < 0, 'er enthält keinen Backtick, der die Vorlage beenden würde');
ok(skript.indexOf('${') < 0, 'und keine Einsetzung, die beim Erzeugen ausgewertet würde');
const ganzeDatei = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
let appLesbar = true;
try { new vm.Script(ganzeDatei, { filename: 'app.js' }); } catch (e) { appLesbar = false; console.log('  ' + e.message); }
ok(appLesbar, 'und app.js bleibt als Ganzes lesbar');

console.log('\n=== Er kennt beide Blattarten und bremst sich selbst ===');
ok(/\.blatt/.test(skript), 'das Zahlungsplan-Blatt');
ok(/\.sheet/.test(skript), 'das Blatt von openSheetDoc');
ok(/SCHUTZ/.test(skript) && /wache/.test(skript), 'eine Notbremse gegen die Endlosschleife');
ok(/function teilen/.test(skript), 'ein zu hoher Block wird an einer Zeilengrenze geteilt');
ok(/if \(teilen\(blatt, m\)\) continue/.test(skript), 'und das Blatt danach nochmals angesehen');
/* Der Schutz gegen die Endlosschleife ist der Fortschritt selbst: Jede
   Teilung nimmt mindestens zwei Zeilen heraus, der Block wird kleiner,
   und irgendwann greift die Untergrenze. */
ok(/zeilen\.length < 4/.test(skript), 'zu kurze Blöcke bleiben ganz');
ok(/k < 2 \|\| zeilen\.length - k < 2/.test(skript), 'jede Teilung bewegt mindestens zwei Zeilen');
ok(/fonts/.test(skript), 'gemessen wird erst, wenn die Schriften stehen');

/* =====================================================================
   Ein DOM, gerade gross genug
   ---------------------------------------------------------------------
   Jedes Stück ist 30 hoch, das Feld fasst 100. Also passen drei — das
   vierte muss aufs nächste Blatt.
   ===================================================================== */

const STUECK = 30, FELD = 100;

function macheDom(anzahl) {
  let zaehler = 0;

  function El(klasse) {
    return {
      _id: ++zaehler,
      className: klasse || '',
      children: [],
      parentNode: null,
      textContent: '',
      /* Das Inhaltsfeld bekommt seine Höhe im Browser aus dem CSS
         (`flex:1` im Blatt mit fester Höhe) — auch das frisch erzeugte.
         Deshalb hängt sie hier an der Klasse und nicht am Erzeugungsweg. */
      get clientHeight() { return this.className.split(/\s+/).includes('zi') ? FELD : 0; },
      get classList() {
        const self = this;
        return {
          contains: k => self.className.split(/\s+/).includes(k),
          add: k => { if (!self.className.split(/\s+/).includes(k)) self.className += ' ' + k; }
        };
      },
      dataset: {},
      attribute: {},
      getAttribute(n) { return this.attribute[n] !== undefined ? this.attribute[n] : null; },
      setAttribute(n, w) { this.attribute[n] = String(w); },
      removeAttribute(n) { delete this.attribute[n]; },
      appendChild(k) {
        if (k.parentNode) k.parentNode.children.splice(k.parentNode.children.indexOf(k), 1);
        k.parentNode = this; this.children.push(k); return k;
      },
      removeChild(k) {
        const i = this.children.indexOf(k);
        if (i >= 0) { this.children.splice(i, 1); k.parentNode = null; }
        return k;
      },
      insertBefore(neu, vor) {
        const i = vor ? this.children.indexOf(vor) : this.children.length;
        neu.parentNode = this; this.children.splice(i < 0 ? this.children.length : i, 0, neu);
        return neu;
      },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      querySelectorAll(sel) {
        const aus = [];
        const passt = el => sel.split(',').some(s => {
          s = s.trim();
          if (s.startsWith('[') && s.endsWith(']')) {         // [data-betrag]
            return el.getAttribute(s.slice(1, -1)) !== null;
          }
          if (s.includes('>')) {                       // ».zf > div:last-child«
            const [a, b] = s.split('>').map(x => x.trim());
            if (!el.parentNode || !el.parentNode.classList.contains(a.replace('.', ''))) return false;
            return b.startsWith('div') ? el.parentNode.children[el.parentNode.children.length - 1] === el : false;
          }
          if (s.includes(':last-child')) {
            const roh = s.replace(':last-child', '').trim();
            const letzte = el.parentNode && el.parentNode.children[el.parentNode.children.length - 1] === el;
            return letzte && (roh === '' || el.className.split(/\s+/).includes(roh.replace('.', '')));
          }
          return el.className.split(/\s+/).includes(s.replace('.', ''));
        });
        const geh = el => el.children.forEach(k => { if (passt(k)) aus.push(k); geh(k); });
        geh(this);
        return aus;
      },
      closest(sel) {
        let el = this;
        while (el) { if (el.className.split(/\s+/).includes(sel.replace('.', ''))) return el; el = el.parentNode; }
        return null;
      },
      /* Tief wie im Browser: cloneNode(true) nimmt die Kinder mit. Sonst
         käme eine Fusszeile ohne ihre beiden Felder heraus. */
      cloneNode(tief) {
        const k = El(this.className);
        k.textContent = this.textContent;
        Object.keys(this.dataset).forEach(x => { k.dataset[x] = this.dataset[x]; });
        if (tief) this.children.forEach(x => k.appendChild(x.cloneNode(true)));
        return k;
      },
      get nextSibling() {
        if (!this.parentNode) return null;
        return this.parentNode.children[this.parentNode.children.indexOf(this) + 1] || null;
      },
      /* Die Lage ergibt sich aus dem Inhalt und der Reihenfolge — genau
         so, wie der Browser sie nach dem Setzen berichtet. Ein Element
         ohne Kinder ist ein Stück hoch; eines mit Kindern so hoch wie
         seine Kinder zusammen. Ohne das wäre ein Block mit acht Zeilen
         so hoch wie einer mit einer, und das Teilen liesse sich nicht
         prüfen. */
      hoehe() {
        return this.children.length
          ? this.children.reduce((a, k) => a + k.hoehe(), 0)
          : STUECK;
      },
      oben() {
        const e = this.parentNode;
        if (!e || e.className === 'wurzel') return 0;
        const i = e.children.indexOf(this);
        return e.oben() + e.children.slice(0, i).reduce((a, k) => a + k.hoehe(), 0);
      },
      getBoundingClientRect() {
        const t = this.oben(), h = this.hoehe();
        return { top: t, bottom: t + h, height: h };
      }
    };
  }

  const wurzel = El('wurzel');
  const blatt = El('blatt');
  const zk = El('zk');
  const zuO = El('zu zu-oben'), zuU = El('zu zu-unten');
  const zi = El('zi');
  const zf = El('zf'); zf.appendChild(El('div')); zf.appendChild(El('div'));
  for (let i = 0; i < anzahl; i++) {
    const s = El('stueck'); s.textContent = 'Block ' + (i + 1);
    s.setAttribute('data-betrag', String((i + 1) * 1000));   // 1000, 2000, 3000 …
    zi.appendChild(s);
  }
  blatt.appendChild(zk); blatt.appendChild(zuO); blatt.appendChild(zi);
  blatt.appendChild(zuU); blatt.appendChild(zf);
  wurzel.appendChild(blatt);

  return {
    wurzel,
    document: {
      querySelector: s => wurzel.querySelector(s),
      querySelectorAll: s => wurzel.querySelectorAll(s),
      createElement: () => El(''),
      fonts: null
    }
  };
}

function laufen(anzahl) {
  const dom = macheDom(anzahl);
  const ctx = {
    document: dom.document,
    getComputedStyle: () => ({ paddingTop: '0px', paddingBottom: '0px' }),
    setTimeout: fn => fn(),
    window: { focus() {}, print() {} }
  };
  ctx.window.document = dom.document;
  vm.createContext(ctx);
  vm.runInContext(skript, ctx);
  return dom.wurzel.children.filter(k => k.classList.contains('blatt'));
}

console.log('\n=== Er trennt dort, wo das Blatt voll ist ===');
console.log('  Feld ' + FELD + ' hoch, jedes Stück ' + STUECK + '  →  3 Stücke je Blatt');

[[2, 1], [3, 1], [4, 2], [7, 3], [10, 4]].forEach(([stuecke, erwartet]) => {
  const blaetter = laufen(stuecke);
  const verteilung = blaetter.map(b => b.querySelector('.zi').children.length);
  console.log('  ' + String(stuecke).padStart(2) + ' Stücke  →  ' + blaetter.length + ' Blatt   ['
    + verteilung.join(', ') + ']');
  ok(blaetter.length === erwartet, stuecke + ' Stücke ergeben ' + erwartet + ' Blätter');
  ok(verteilung.every(n => n <= 3), 'kein Blatt bekommt mehr, als es fasst (' + stuecke + ' Stücke)');
  ok(verteilung.reduce((a, b) => a + b, 0) === stuecke, 'kein Stück geht verloren (' + stuecke + ' Stücke)');
});

/* =====================================================================
   Ein zu hoher Block wird geteilt, nicht ganz weitergeschoben
   ---------------------------------------------------------------------
   Sonst bleibt eine halbe Seite leer, nur weil der Block als Ganzes
   nicht mehr passt — und aus zehn Seiten werden zwanzig.
   ===================================================================== */

console.log('\n=== Ein zu hoher Block wird geteilt ===');
function domMitBlock(zeilenZahl) {
  const dom = macheDom(0);
  const zi = dom.wurzel.querySelector('.zi');
  /* Ein Block mit einer Tabelle: höher als das Feld, aber teilbar. */
  const block = { name: 'zp-mon' };
  const el = dom.document.createElement();
  el.className = 'zp-mon';
  el.setAttribute('data-betrag', '5000');
  const tab = dom.document.createElement(); tab.className = 'tabelle';
  const tbody = dom.document.createElement(); tbody.className = 'tbody';
  for (let i = 0; i < zeilenZahl; i++) {
    const tr = dom.document.createElement(); tr.className = 'tr';
    tr.textContent = 'Zeile ' + (i + 1);
    tbody.appendChild(tr);
  }
  tab.appendChild(tbody); el.appendChild(tab); zi.appendChild(el);
  return { dom, block };
}

/* Die Attrappe muss tbody finden und Zeilen der Reihe nach messen. */
const domB = domMitBlock(8).dom;
const ctxB = {
  document: domB.document,
  getComputedStyle: () => ({ paddingTop: '0px', paddingBottom: '0px' }),
  setTimeout: fn => fn(),
  window: { focus() {}, print() {} }
};
ctxB.window.document = domB.document;
vm.createContext(ctxB);
vm.runInContext(skript, ctxB);

const blaetterB = domB.wurzel.children.filter(k => k.classList.contains('blatt'));
const zeilenJeBlatt = blaetterB.map(b => {
  const t = b.querySelector('.tbody');
  return t ? t.children.length : 0;
});
console.log('  8 Zeilen, Feld fasst 3  →  ' + blaetterB.length + ' Blatt   [' + zeilenJeBlatt.join(', ') + ']');
ok(blaetterB.length > 1, 'der Block verteilt sich über mehrere Blätter');
ok(zeilenJeBlatt.reduce((a, b) => a + b, 0) === 8, 'keine Zeile geht dabei verloren');
ok(zeilenJeBlatt.every(n => n > 0), 'kein Blatt bleibt leer');

/* Der Betrag des Monats darf beim Teilen nur EINMAL zählen. Das Klonen
   nahm das Attribut auf jede Fortsetzung mit — drei Fragmente, dreimal
   5'000, und das Total behauptete 15'000. Gefunden am 14.08.2026 bei
   genau dieser Kontrolle. */
const alleZu = blaetterB.map(b => { const z = b.querySelector('.zu-unten'); return z ? String(z.innerHTML) : ''; }).join(' | ');
console.log('  Übertragszeilen: ' + alleZu.replace(/<[^>]*>/g, ' '));
ok(/Total Zahlungen/.test(alleZu) && /5'000\.00/.test(alleZu), 'das Total bleibt bei 5\'000');
ok(!/15'000|10'000/.test(alleZu), 'und der geteilte Monat wird nicht doppelt gezählt');

/* =====================================================================
   Auch ein Block MITTEN auf der Seite wird geteilt
   ---------------------------------------------------------------------
   Yanicks Befund vom 14.08.2026: Nach zwei langen Monaten wanderte der
   nächste komplett auf die Folgeseite — ein Drittel des Blattes blieb
   leer. Geteilt wurde nämlich nur der oberste Block. Hier steht ein
   einfaches Stück (30 hoch) vor einem Block mit 8 Zeilen: Das Blatt
   fasst 96, also müssen nach dem Stück noch ZWEI Blockzeilen auf die
   erste Seite — nicht null.
   ===================================================================== */

console.log('\n=== Ein Block mitten auf der Seite füllt sie erst ===');
{
  const dom = macheDom(1);
  const zi = dom.wurzel.querySelector('.zi');
  const block = dom.document.createElement(); block.className = 'zp-mon';
  block.setAttribute('data-betrag', '5000');
  const tab = dom.document.createElement(); tab.className = 'tabelle';
  const tb = dom.document.createElement(); tb.className = 'tbody';
  for (let i = 0; i < 8; i++) { const tr = dom.document.createElement(); tr.className = 'tr'; tr.textContent = 'Z' + (i + 1); tb.appendChild(tr); }
  tab.appendChild(tb); block.appendChild(tab); zi.appendChild(block);

  const c2 = { document: dom.document, getComputedStyle: () => ({ paddingTop: '0px', paddingBottom: '0px' }),
               setTimeout: fn => fn(), window: { focus() {}, print() {} } };
  c2.window.document = dom.document;
  vm.createContext(c2); vm.runInContext(skript, c2);

  const seiten = dom.wurzel.children.filter(x => x.classList.contains('blatt'));
  const bild = seiten.map(b => {
    const st = b.querySelectorAll('.stueck').length, tr = b.querySelectorAll('.tr').length;
    return st + '+' + tr;
  });
  console.log('  Stück+Blockzeilen je Blatt: [' + bild.join(', ') + ']');
  ok(seiten[0] && seiten[0].querySelectorAll('.tr').length >= 2,
     'die erste Seite nimmt nach dem Stück noch Blockzeilen auf — sie bleibt nicht leer');
  const trGesamt = seiten.reduce((a, b) => a + b.querySelectorAll('.tr').length, 0);
  ok(trGesamt === 8, 'alle 8 Zeilen kommen an (' + trGesamt + ')');
  const zuAlle = seiten.map(b => { const z = b.querySelector('.zu-unten'); return z ? String(z.innerHTML) : ''; }).join(' ');
  ok(/Total Zahlungen/.test(zuAlle) && /6'000\.00/.test(zuAlle),
     'das Total zählt Stück (1\'000) und Block (5\'000) je einmal');
}

console.log('\n=== Jedes Blatt behält Kopf und Fuss ===');
const acht = laufen(8);
ok(acht.every(b => b.querySelector('.zk')), 'der Kopf steht auf jeder Seite');
ok(acht.every(b => b.querySelector('.zf')), 'die Fusszeile steht auf jeder Seite');

console.log('\n=== Und die Seitenzahlen stimmen danach ===');
const zahlen = acht.map(b => { const zf = b.querySelector('.zf'); return zf.children[zf.children.length - 1].textContent; });
zahlen.forEach(z => console.log('    ' + z));
ok(zahlen[0] === 'Seite 1 von ' + acht.length, 'die erste Seite zählt richtig');
ok(zahlen[zahlen.length - 1] === 'Seite ' + acht.length + ' von ' + acht.length, 'die letzte auch');
ok(new Set(zahlen).size === zahlen.length, 'keine Seitenzahl doppelt');

/* =====================================================================
   Der Übertrag — erst rechenbar, wenn die Seiten stehen
   ---------------------------------------------------------------------
   Jedes Stück trägt 1000, 2000, … 8000; verteilt auf [3, 3, 2] muss
   Seite 1 mit 6'000 schliessen, Seite 2 mit 6'000 öffnen und mit 21'000
   schliessen, und die letzte mit dem Total von 36'000 abschliessen.
   ===================================================================== */

console.log('\n=== Der Übertrag rechnet über die Seiten ===');
const zuText = (blatt, wo) => { const z = blatt.querySelector('.zu-' + wo); return z ? String(z.innerHTML) : ''; };
console.log('    Seite 1 unten: ' + zuText(acht[0], 'unten').replace(/<[^>]*>/g, ' '));
console.log('    Seite 2 oben:  ' + zuText(acht[1], 'oben').replace(/<[^>]*>/g, ' '));
console.log('    Seite 3 unten: ' + zuText(acht[2], 'unten').replace(/<[^>]*>/g, ' '));
ok(/Übertrag auf Seite 2/.test(zuText(acht[0], 'unten')) && /6'000\.00/.test(zuText(acht[0], 'unten')),
   'Seite 1 gibt 6\'000 weiter');
ok(/Übertrag von Seite 1/.test(zuText(acht[1], 'oben')) && /6'000\.00/.test(zuText(acht[1], 'oben')),
   'Seite 2 nimmt dieselben 6\'000 entgegen');
ok(/Übertrag auf Seite 3/.test(zuText(acht[1], 'unten')) && /21'000\.00/.test(zuText(acht[1], 'unten')),
   'Seite 2 gibt 21\'000 weiter');
ok(/Total Zahlungen/.test(zuText(acht[2], 'unten')) && /36'000\.00/.test(zuText(acht[2], 'unten')),
   'die letzte Seite schliesst mit dem Total von 36\'000');
ok(zuText(acht[0], 'oben') === '', 'die erste Seite bringt nichts mit');

console.log('\n  ' + (geprueft - fehler) + '/' + geprueft + ' geprüft'
  + (fehler ? '   ' + fehler + ' FEHLER' : '   alles grün') + '\n');
process.exit(fehler ? 1 : 0);
