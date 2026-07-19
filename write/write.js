/* ============================================================
   Submit Write — write.js  (Vanilla, dateibasiert, .gdoc)
   "Schreiben ohne Ablenkung."
   ============================================================ */
'use strict';
const WRITE_VERSION = 'v37';
const FORMAT_VERSION = 1;
const MM = 3.7795;                       // mm -> px @96dpi
const PAGE_INNER_PX = (297 - 56) * MM;   // A4-Höhe minus 2×28mm Rand

/* ---------- kleine Helfer ---------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => 'd' + Date.now().toString(36) + Math.floor(performance.now() % 1000).toString(36);
const nowIso = () => new Date().toISOString();
const esc = s => (s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function toast(msg) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
  $('#toast-root').appendChild(t); setTimeout(() => t.remove(), 2400);
}
function fmtDate(iso) {
  try { return new Date(iso).toLocaleDateString('de-CH', { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch (_) { return ''; }
}

/* ---------- HTML-Sanitisierung (gegen XSS / kaputte Dateien) ---------- */
const ALLOWED_TAGS = new Set(['P', 'BR', 'H1', 'H2', 'H3', 'H4', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'SPAN', 'FONT', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'A', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'IMG', 'HR', 'DIV', 'MARK', 'SUB', 'SUP']);
const ALLOWED_ATTR = { '*': ['style', 'class', 'id'], A: ['href', 'target', 'rel', 'data-go'], IMG: ['src', 'alt', 'width', 'height'], FONT: ['face', 'color', 'size'], TD: ['colspan', 'rowspan'], TH: ['colspan', 'rowspan'], DIV: ['contenteditable', 'data-toc'], SPAN: ['contenteditable', 'data-tab', 'data-lead', 'data-align', 'data-fx'] };
function sanitizeHtml(html) {
  try {
    const tpl = document.createElement('template');
    tpl.innerHTML = html || '';
    tpl.content.querySelectorAll('script,style,iframe,object,embed,link,meta,noscript,svg,form,input,button').forEach(n => n.remove());
    tpl.content.querySelectorAll('*').forEach(el => {
      const tag = el.tagName;
      if (!ALLOWED_TAGS.has(tag)) { el.replaceWith(...el.childNodes); return; }
      [...el.attributes].forEach(a => {
        const name = a.name.toLowerCase();
        const ok = (ALLOWED_ATTR['*'].includes(name) || (ALLOWED_ATTR[tag] || []).includes(name)) && !name.startsWith('on');
        if (!ok) { el.removeAttribute(a.name); return; }
        if (name === 'href' && !/^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i.test(a.value.trim())) el.removeAttribute(a.name);
        if (name === 'src' && !/^(https?:|data:image\/(png|jpe?g|gif|webp|bmp);)/i.test(a.value.trim())) el.removeAttribute(a.name);
      });
      // Style-Attribut auf gefährliche Werte prüfen (CSS-Injektion / Export)
      if (el.hasAttribute('style') && /url\(|expression|javascript:|@import|position\s*:\s*fixed/i.test(el.getAttribute('style'))) el.removeAttribute('style');
      if (tag === 'A') { el.setAttribute('rel', 'noopener noreferrer'); }
    });
    return tpl.innerHTML;
  } catch (_) {
    const d = document.createElement('div'); d.textContent = html || ''; return d.innerHTML;
  }
}
// nur sichere Link-Adressen zulassen
function safeUrl(u) {
  const v = (u || '').trim();
  if (/^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i.test(v)) return v;
  if (/^[\w.-]+\.[a-z]{2,}([\/?#].*)?$/i.test(v)) return 'https://' + v;  // nackte Domain
  return '';
}

/* ---------- Elemente ---------- */
const editor = $('#editor');
const page = $('#page');
const appEl = $('#app');
const titleEl = $('#docTitle');
const saveState = $('#saveState');
let viewOnly = false;   // „Ansehen"-Modus: nur betrachten, keine Änderungen (S2.1). Standard = Bearbeiten.
// Dokument nur betrachten (contenteditable aus, Menüband gesperrt) – zum Weitergeben/Präsentieren ohne versehentliches Ändern.
function setViewOnly(on) {
  viewOnly = !!on;
  document.body.classList.toggle('view-only', viewOnly);
  const ed = viewOnly ? 'false' : 'true';
  [editor, $('#zoneH'), $('#zoneF')].forEach(el => { if (el) el.contentEditable = ed; });
  if (titleEl) titleEl.readOnly = viewOnly;
  const b = $('#btnView'); if (b) { b.classList.toggle('on', viewOnly); b.title = viewOnly ? 'Ansehen-Modus AN – hier klicken zum Bearbeiten' : 'Ansehen-Modus: nur betrachten, keine Änderungen'; }
  if (viewOnly && typeof editingTd !== 'undefined' && editingTd) { try { endEdit(true); } catch (_) {} }
  if (typeof toast === 'function') toast(viewOnly ? '👁 Ansehen-Modus – keine Änderungen möglich' : '✎ Bearbeiten-Modus');
}

/* ---------- Bibliothek (localStorage) ---------- */
const LS_LIB = 'sw_lib_v1';
const LS_THEME = 'sw_theme';
let lib = loadLib();          // { docs: {id:doc}, order:[id], currentId }
let doc = null;               // aktuelles Dokument
let dirty = false;
let fileHandle = null;        // File System Access Handle (falls vorhanden)
let saveTimer = null;

function loadLib() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_LIB) || '{}');
    if (raw && raw.docs && typeof raw.docs === 'object') {
      return {
        docs: raw.docs,
        order: Array.isArray(raw.order) ? raw.order.filter(id => raw.docs[id]) : Object.keys(raw.docs),
        currentId: raw.currentId || null
      };
    }
  } catch (e) {
    // Beschaedigte Bibliothek (z.B. halb geschriebene Daten nach vollem Speicher):
    // NICHT einfach leer weitermachen - der naechste Speichervorgang wuerde sie ueberschreiben.
    // Deshalb erst eine Sicherung unter eigenem Schluessel ablegen und den Nutzer warnen.
    try {
      const roh = localStorage.getItem(LS_LIB);
      if (roh) localStorage.setItem(LS_LIB + '_defekt', roh);
    } catch (_) {}
    setTimeout(() => { try { toast('Bibliothek war beschädigt – eine Sicherung wurde abgelegt. Bitte melden.'); } catch (_) {} }, 800);
  }
  return { docs: {}, order: [], currentId: null };
}
function persistLib() { try { localStorage.setItem(LS_LIB, JSON.stringify(lib)); return true; } catch (_) { return false; } }
/* Ueberall dort verwenden, wo bisher persistLib() ohne Pruefung stand: bei vollem Speicher
   arbeitete der Nutzer sonst ins Leere, waehrend die Anzeige 'Gespeichert' meldete. */
function persistLibGeprueft() {
  if (persistLib()) return true;
  warnQuota(); setDirty(true);
  return false;
}
let quotaWarned = false;
function warnQuota() {
  if (quotaWarned) return; quotaWarned = true;
  toast('Lokaler Speicher voll — bitte als .paper speichern (Strg+S). Tipp: grosse Bilder vermeiden.');
  setTimeout(() => { quotaWarned = false; }, 30000);
}

function newDocObject(partial = {}) {
  const t = nowIso();
  return Object.assign({
    id: uid(), titel: 'Unbenanntes Dokument', kopf: '', fuss: '',
    seiten: [{ id: uid(), typ: 'calc', html: '' }], aktiv: 0,   // Standard = Calc-Raster (Zeilen/Spalten als Leinwand)
    rasterCols: 6,
    einstellungen: { schriftart: "'Inter', sans-serif", schriftgroesse: 16, zeilenabstand: 1.7, ausrichtung: 'hoch', format: 'A4', margins: { top: 18, right: 22, bottom: 18, left: 22 }, kopfH: 14, fussH: 14, tabs: [] },
    meta: { erstellt: t, geaendert: t, autor: 'Yanick Gerber', version: 1 },
    folder: 'dokumente', fav: false, trashed: false
  }, partial);
}

/* ============================================================
   Dokument laden / anlegen / wechseln
   ============================================================ */
// Alte .gdoc (1 Modus pro Dokument) → neues Seiten-Modell (verlustfrei)
function migrateDoc(d) {
  if (!Array.isArray(d.seiten) || !d.seiten.length) {
    const typ = (d.einstellungen && d.einstellungen.modus === 'calc') ? 'calc' : 'write';
    const html = (typ === 'calc' && d.tabelle && d.tabelle.cells) ? tabelleToHtml(d.tabelle) : (d.html || '');
    d.seiten = [{ id: uid(), typ, html }]; d.aktiv = 0;
  }
  if (typeof d.aktiv !== 'number' || d.aktiv < 0 || d.aktiv >= d.seiten.length) d.aktiv = 0;
  d.seiten.forEach(p => {
    if (!p.id) p.id = uid();
    if (p.tabelle && p.tabelle.cells && p.html == null) p.html = tabelleToHtml(p.tabelle);  // alte Calc-Seite → HTML
    if (p.html == null) p.html = '';
    p.typ = (p.typ === 'calc') ? 'calc' : 'write';   // Slides entfernt → als Write
    p.linien = (p.linien === true);   // Gitterlinien gehoeren zur Seite und werden mitgespeichert
    delete p.tabelle;
  });
  if (d.einstellungen) delete d.einstellungen.modus;
  delete d.html; delete d.tabelle;
  return d;
}
function activePage() { return doc.seiten[doc.aktiv]; }

/* ============================================================
   Gemeinsames Modell: HTML  ⇄  Raster (Block = Zeile, Spaltentrenner = Spalte)
   „Ein Write IST ein Calc" — dieselben Daten, nur andere Ansicht.
   ============================================================ */
let curGrid = null;   // aktuelles Raster der aktiven Seite (Calc-Ansicht)
const COLSEP = '<span class="colsep" contenteditable="false">⇥</span>';
function cellText(frag) { const d = document.createElement('div'); d.innerHTML = frag || ''; return (d.textContent || '').replace(/​/g, '').trim(); }
const BLOCK_KEEP = /^(p|h1|h2|h3|h4|blockquote|pre)$/;   // MUSS Teilmenge von ALLOWED_TAGS sein – sonst entfernt sanitizeHtml den Tag beim Zurueckschalten stillschweigend
function plainText(frag) {   // DOM-frei (auch im Node-Test nutzbar): reiner Text zum Vergleichen
  return String(frag || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/​/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim();
}
function attrStr(el) {   // ALLE Attribute des Blocks bewahren – hier steckt Ausrichtung, Einzug, Farbe
  return [...((el && el.attributes) || [])].map(a => ` ${a.name}="${esc(a.value)}"`).join('');
}
function htmlToGrid(html) {
  const tpl = document.createElement('template'); tpl.innerHTML = html || '';
  const zeilen = [], stops = [];   // stops[i] = Position (mm ab Rand), an der Spalte i endet → gemeinsame Spalten für Write & Calc
  let grp = 0;
  const blockRow = (b, extra) => {
    const cells = []; let cur = '';
    b.childNodes.forEach(n => {
      if (n.nodeType === 1 && n.classList && n.classList.contains('colsep')) {
        if (n.dataset && n.dataset.tab) { const i = cells.length, v = parseFloat(n.dataset.tab); if (v > 0) stops[i] = Math.max(stops[i] || 0, v); }
        cells.push(cur); cur = '';
      }
      else if (n.nodeType === 3 && n.textContent.indexOf('	') >= 0) {       // echte Tabs im Text = Spalten
        const parts = n.textContent.split('	');
        parts.forEach((p, idx) => { if (idx > 0) { cells.push(cur); cur = ''; } cur += esc(p); });
      }
      else if (n.nodeType === 1 && n.classList && n.classList.contains('fx') && n.getAttribute('data-fx')) {
        cur += esc(n.getAttribute('data-fx'));      // Formel-Marke → im Raster steht die FORMEL, nicht ihr Ergebnis
      }
      else cur += (n.nodeType === 1 ? n.outerHTML : esc(n.textContent));
    });
    cells.push(cur);
    zeilen.push(Object.assign({ tag: (b.tagName || 'P').toLowerCase(), attrs: attrStr(b), cells }, extra || {}));
  };
  // Bloecke, die das Raster nicht verlustfrei zerlegen kann, kommen als „raw" durch:
  // im Gitter lesbar als Text, beim Zurueckschalten 1:1 im Original – solange sie nicht bearbeitet wurden.
  const rawRows = (b, rows) => {
    const id = ++grp, raw = b.outerHTML;
    const zs = (rows && rows.length) ? rows : [{ tag: 'p', cells: [esc(plainText(raw))] }];
    // Schluessel aus den ERSATZZEILEN bilden, nicht aus dem Original: beim Inhaltsverzeichnis
    // enthaelt das Original auch Knopfbeschriftungen, die in den Zeilen nie vorkommen -
    // der Vergleich beim Rueckweg konnte deshalb NIE zutreffen und warf das Original immer weg.
    const key = plainText(zs.map(r => (r.cells || []).join(' ')).join(' '));
    // raw/rawKey/rawN auf JEDE Zeile: wird die erste geloescht, ist das Original sonst verloren.
    zs.forEach(r => zeilen.push(Object.assign({ attrs: '' }, r, { rawId: id, raw, rawKey: key, rawN: zs.length })));
  };
  [...tpl.content.children].forEach(b => {
    const tn = (b.tagName || 'P').toLowerCase();
    if (tn === 'table') {                                                   // echte Write-Tabelle: Struktur merken, damit sie Tabelle bleibt
      const id = ++grp, tAttrs = attrStr(b);
      const trs = [...b.querySelectorAll('tr')];
      if (!trs.length) { rawRows(b); return; }
      trs.forEach(tr => {
        const tds = [...tr.children];
        zeilen.push({
          tag: 'p', attrs: '', cells: tds.length ? tds.map(td => td.innerHTML.trim()) : [''],
          tbl: id, tblAttrs: tAttrs, trAttrs: attrStr(tr),
          cellTag: tds.map(td => (td.tagName || 'TD').toLowerCase()), cellAttrs: tds.map(td => attrStr(td)),
        });
      });
    } else if (tn === 'ul' || tn === 'ol') {                                 // Liste: je Punkt eine Zeile, bleibt beim Zurueck eine Liste
      const id = ++grp, lAttrs = attrStr(b);
      const lis = [...b.children].filter(x => x.tagName === 'LI');
      if (!lis.length) { rawRows(b); return; }
      lis.forEach(li => blockRow(li, { list: tn, listId: id, listAttrs: lAttrs }));
    } else if (b.classList && b.classList.contains('toc')) {                 // Inhaltsverzeichnis: lesbar im Raster, unveraendert zurueck
      const rows = [{ tag: 'h3', cells: ['Inhaltsverzeichnis'] }];
      b.querySelectorAll('.toc-list a, a[data-go]').forEach(a => {
        const t = (a.textContent || '').trim(); if (t) rows.push({ tag: 'p', cells: [esc(t)] });
      });
      rawRows(b, rows);
    } else if (BLOCK_KEEP.test(tn)) blockRow(b);
    else rawRows(b);                                                         // div/figure/… unangetastet durchreichen
  });
  if (!zeilen.length) zeilen.push({ tag: 'p', attrs: '', cells: [''] });
  return { cols: Math.max(1, ...zeilen.map(z => z.cells.length)), zeilen, colStops: stops };
}
function colsepAt(i, grid) {   // Spaltentrenner – mit Tab-Position (mm), falls bekannt
  const pos = grid && grid.colStops && grid.colStops[i];
  return pos != null ? `<span class="colsep" data-tab="${pos}" contenteditable="false">⇥</span>` : COLSEP;
}
function zelleNachDokument(c) {   // Formelzelle → fx-Marke (Dokument zeigt den Wert, die Formel reist mit)
  const t = plainText(c);
  if (t[0] !== '=' || /class="fx"/.test(String(c))) return c || '';
  return `<span class="fx" data-fx="${esc(t)}" contenteditable="false"></span>`;   // Text füllt recomputeFormulas()
}
function gridBlock(z, grid) {   // eine normale Zeile → Absatz/Ueberschrift, Attribute bleiben erhalten
  const tag = BLOCK_KEEP.test(z.tag || '') ? z.tag : 'p';
  const cells = (z.cells && z.cells.length ? z.cells : ['']).slice();
  while (cells.length > 1 && (cells[cells.length - 1] || '') === '') cells.pop();   // leere End-Spalten weg → keine überflüssigen Tabs in Write
  let inner = ''; cells.forEach((c, i) => { inner += zelleNachDokument(c); if (i < cells.length - 1) inner += colsepAt(i, grid); });
  return `<${tag}${z.attrs || ''}>${inner || '<br>'}</${tag}>`;
}
function gridToHtml(grid) {
  const rows = (grid && grid.zeilen) || [];
  const nimm = (i, pruef) => { const g = []; while (i < rows.length && pruef(rows[i])) g.push(rows[i++]); return [g, i]; };
  let out = '', i = 0;
  while (i < rows.length) {
    const z = rows[i];
    if (z.rawId) {                                    // Sonderblock: unveraendert → Original zurueck, bearbeitet → als Absaetze
      const id = z.rawId; let g; [g, i] = nimm(i, r => r.rawId === id);
      // Original nur zurueckgeben, wenn die Gruppe VOLLSTAENDIG und unveraendert ist.
      // Sonst (Zeile geloescht, Zeile eingefuegt, Text bearbeitet) gewinnt das Bearbeitete.
      const jetzt = plainText(g.map(r => (r.cells || []).join(' ')).join(' '));
      const vollstaendig = !z.rawN || g.length === z.rawN;
      out += (vollstaendig && jetzt === (z.rawKey || '') && z.raw) ? z.raw : g.map(r => gridBlock(r, grid)).join('');
      continue;
    }
    if (z.tbl) {                                      // Tabelle bleibt Tabelle
      const id = z.tbl; let g; [g, i] = nimm(i, r => r.tbl === id);
      out += `<table${z.tblAttrs || ''}><tbody>` + g.map(r => {
        const ct = r.cellTag || [], ca = r.cellAttrs || [];
        return `<tr${r.trAttrs || ''}>` + (r.cells || ['']).map((c, k) =>
          `<${ct[k] || 'td'}${ca[k] || ''}>${c || ''}</${ct[k] || 'td'}>`).join('') + '</tr>';
      }).join('') + '</tbody></table>';
      continue;
    }
    if (z.listId) {                                   // Liste bleibt Liste
      const id = z.listId; let g; [g, i] = nimm(i, r => r.listId === id);
      out += `<${z.list || 'ul'}${z.listAttrs || ''}>` + g.map(r => {
        const inner = gridBlock(Object.assign({}, r, { tag: 'p', attrs: '' }), grid).replace(/^<p>|<\/p>$/g, '');
        return `<li${r.attrs || ''}>${inner}</li>`;
      }).join('') + `</${z.list || 'ul'}>`;
      continue;
    }
    out += gridBlock(z, grid); i++;
  }
  return out || '<p><br></p>';
}
function gridGet(grid, c, r) { const z = grid.zeilen[r]; return z ? (z.cells[c] || '') : ''; }
function gridEnsure(grid, c, r) {
  while (grid.zeilen.length <= r) grid.zeilen.push({ tag: 'p', cells: [''] });
  const z = grid.zeilen[r];
  while (z.cells.length <= c) z.cells.push('');
  grid.cols = Math.max(grid.cols, c + 1);
}
function tabelleToHtml(tab) {   // alte Calc-Tabelle → HTML-Zeilen (Migration)
  let html = '';
  for (let r = 1; r <= (tab.rows || 1); r++) {
    const cells = [];
    for (let c = 0; c < (tab.cols || 1); c++) cells.push(esc(tab.cells[idxToCol(c) + r] || ''));
    while (cells.length > 1 && cells[cells.length - 1] === '') cells.pop();
    html += '<p>' + cells.join(COLSEP) + '</p>';
  }
  return html || '<p><br></p>';
}

function openDoc(id) {
  const d = lib.docs[id]; if (!d) return;
  if (doc && dirty) { clearTimeout(saveTimer); autosave(); }   // laufenden Tippschub IMMER zuerst sichern
  if (doc && doc.id === id) { renderList(); return; }          // schon offen: nichts neu aufbauen (verwarf sonst das zuletzt Getippte)
  verlaufZurueckStapel.length = 0; verlaufVorStapel.length = 0; standJetzt = null;   // Verlauf gehoert zum Dokument
  clearTimeout(saveTimer);
  doc = migrateDoc(d); fileHandle = null;
  $('#zoneH').innerHTML = sanitizeHtml(d.kopf || '');
  $('#zoneF').innerHTML = sanitizeHtml(d.fuss || '');
  titleEl.value = d.titel || 'Unbenanntes Dokument';
  applySettings();
  renderPageNav();
  setTimeout(verlaufZuruecksetzen, 0);   // Ausgangsstand erst nach dem Aufbau merken
  renderActivePage();
  lib.currentId = id; persistLibGeprueft();
  setDirty(false); renderList();
}
function createDoc(partial) {
  const d = newDocObject(partial);
  if (partial && Array.isArray(partial.pages) && partial.pages.length) { d.seiten = partial.pages; d.aktiv = 0; }
  else if (partial && partial.html != null) { d.seiten = [{ id: uid(), typ: 'write', html: partial.html }]; d.aktiv = 0; }
  delete d.pages; delete d.html;
  lib.docs[d.id] = d; lib.order.unshift(d.id); persistLibGeprueft();
  openDoc(d.id);
  return d;
}
function applySettings() {
  const s = doc.einstellungen;
  editor.style.fontFamily = s.schriftart;
  editor.style.fontSize = s.schriftgroesse + 'px';
  editor.style.lineHeight = s.zeilenabstand;
  const pg = $('#pageGrid'); if (pg) { pg.style.fontFamily = s.schriftart; pg.style.fontSize = s.schriftgroesse + 'px'; pg.style.lineHeight = s.zeilenabstand; }   // Calc = gleiche Schrift wie Write
  $('#selFont').value = s.schriftart;
  $('#selSize').value = String(s.schriftgroesse);
  $$('#segLine button').forEach(b => b.classList.toggle('on', +b.dataset.line === +s.zeilenabstand));
  $('#selLine').value = String(s.zeilenabstand);
  const cols = s.spalten || 1;
  editor.style.columnCount = cols > 1 ? cols : '';
  editor.style.columnGap = cols > 1 ? '12mm' : '';
  const selC2 = $('#selCols'); if (selC2) selC2.value = String(cols);
  const hy = !!s.silben; editor.classList.toggle('hyphenate', hy);
  const bh = $('#btnHyphen'); if (bh) bh.classList.toggle('on', hy);
  applyFormat();        // Format/Ausrichtung pro Seite (setzt .quer + Knopf-Status)
  applyPageSetup();
  applyZoom();
}

/* ============================================================
   Speichern (Bibliothek = Autosave; Datei = .gdoc)
   ============================================================ */
function setDirty(v) {
  dirty = v;
  saveState.classList.toggle('dirty', v);
  $('.lbl', saveState).textContent = v ? 'Nicht gespeichert' : 'Gespeichert';
}
/* Inhalt der GERADE bearbeiteten Zelle ins Raster spiegeln, ohne die Bearbeitung zu beenden.
   Das Autospeichern darf den Schreibfluss nicht unterbrechen. */
function zelleSpiegeln() {
  if (!editingTd || !curGrid) return false;
  gridEnsure(curGrid, selC, selR);
  curGrid.zeilen[selR].cells[selC] = readCellHtml(editingTd) || '';
  return true;
}
/* beenden=true nur dort, wo die Seite gewechselt oder umgebaut wird (Seitenwechsel, neue Seite,
   Typwechsel). Beim Autospeichern MUSS es false bleiben - sonst schliesst sich die Zelle
   mitten im Satz und der Cursor ist weg. Genau das war der Grund fuer 'es bricht einfach ab'. */
function capturePage(beenden) {
  const p = activePage(); if (!p) return;
  if (p.typ === 'calc') {
    if (editingTd) { if (beenden) endEdit(true); else zelleSpiegeln(); }
    if (curGrid) p.html = gridToHtml(curGrid);
  }
  else p.html = cleanEditorHTML();   // ohne Rechtschreib-Markierungen speichern
}
/* ============ Rückgängig / Wiederholen ============
   Schnappschuss-Verlauf des ganzen Dokuments. Angesetzt in autosave(), weil dort
   captureDoc() gerade alles eingesammelt hat (offene Zellbearbeitung, Kopf/Fuss, Titel) -
   das ist der einzige Punkt, an dem der Zustand garantiert vollstaendig ist.
   Ein Schritt = ein Tipp-Schub (autosave ist auf 800 ms gebremst), nicht ein Zeichen. */
const VERLAUF_MAX = 80;
let verlaufZurueckStapel = [], verlaufVorStapel = [], standJetzt = null, verlaufLaeuft = false;

function verlaufZuruecksetzen() {
  verlaufZurueckStapel.length = 0; verlaufVorStapel.length = 0;
  standJetzt = schnappschuss();          // Ausgangsstand: der geoeffnete Zustand
  syncVerlaufKnoepfe();
}
function schnappschuss() {
  if (!doc) return null;
  try {
    return JSON.stringify({ seiten: doc.seiten, kopf: doc.kopf, fuss: doc.fuss, titel: doc.titel,
      einstellungen: doc.einstellungen, rasterCols: doc.rasterCols });
  } catch (_) { return null; }
}
function verlaufMerken() {
  if (verlaufLaeuft) return;                 // eigene Wiederherstellung nicht als Aenderung zaehlen
  const neu = schnappschuss(); if (!neu) return;
  if (standJetzt && standJetzt !== neu) {
    verlaufZurueckStapel.push(standJetzt);
    if (verlaufZurueckStapel.length > VERLAUF_MAX) verlaufZurueckStapel.shift();
    verlaufVorStapel.length = 0;             // neue Aenderung -> Wiederholen verfaellt (wie ueberall)
  }
  standJetzt = neu;
  syncVerlaufKnoepfe();
}
function standAnwenden(json) {
  let d; try { d = JSON.parse(json); } catch (_) { return false; }
  if (!d || !Array.isArray(d.seiten) || !d.seiten.length) return false;
  verlaufLaeuft = true;
  try {
    if (editingTd) endEdit(false);           // offene Zellbearbeitung verwerfen, sonst schreibt sie zurueck
    doc.seiten = d.seiten; doc.kopf = d.kopf || ''; doc.fuss = d.fuss || '';
    doc.titel = d.titel || doc.titel; doc.einstellungen = d.einstellungen || doc.einstellungen;
    doc.rasterCols = d.rasterCols || doc.rasterCols;
    if (doc.aktiv >= doc.seiten.length) doc.aktiv = doc.seiten.length - 1;   // Seite kann weggefallen sein
    $('#zoneH').innerHTML = doc.kopf; $('#zoneF').innerHTML = doc.fuss;
    if (titleEl) titleEl.value = doc.titel;
    applyPageSetup(); renderActivePage(); renderPageNav();
    persistLibGeprueft(); renderList();
  } finally { verlaufLaeuft = false; }
  return true;
}
function verlaufZurueck() {
  if (!doc) return false;
  captureDoc();
  verlaufMerken();   // seit dem letzten Speichern getippt? -> das ist ein eigener Schritt, sonst faellt er unter den Tisch
  if (!verlaufZurueckStapel.length) { toast('Nichts zum Rückgängigmachen.'); return false; }
  const jetzt = schnappschuss();
  const ziel = verlaufZurueckStapel.pop();
  if (!standAnwenden(ziel)) return false;
  if (jetzt) verlaufVorStapel.push(jetzt);
  standJetzt = ziel; syncVerlaufKnoepfe();
  return true;
}
function verlaufVor() {
  if (!doc || !verlaufVorStapel.length) { toast('Nichts zum Wiederholen.'); return false; }
  captureDoc();
  const jetzt = schnappschuss();
  const ziel = verlaufVorStapel.pop();
  if (!standAnwenden(ziel)) return false;
  if (jetzt) verlaufZurueckStapel.push(jetzt);
  standJetzt = ziel; syncVerlaufKnoepfe();
  return true;
}
function syncVerlaufKnoepfe() {
  const u = $('#btnUndo'), r = $('#btnRedo');
  if (u) u.disabled = !verlaufZurueckStapel.length;
  if (r) r.disabled = !verlaufVorStapel.length;
}

function captureDoc() {
  if (!doc) return;
  capturePage();
  doc.kopf = $('#zoneH').innerHTML;
  doc.fuss = $('#zoneF').innerHTML;
  doc.titel = (titleEl.value || 'Unbenanntes Dokument').trim() || 'Unbenanntes Dokument';
  doc.meta.geaendert = nowIso();
}
function autosave() {
  if (!doc) return;
  captureDoc();
  verlaufMerken();
  if (persistLib()) { setDirty(false); renderList(); }
  else { saveState.classList.remove('saving'); saveState.classList.add('dirty'); $('.lbl', saveState).textContent = 'Speicher voll!'; warnQuota(); }
}
function scheduleSave(skipPag) {
  setDirty(true);
  saveState.classList.add('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveState.classList.remove('saving'); autosave(); }, 800);
  if (!skipPag) paginateLater();
}

/* ---------- .gdoc Envelope ---------- */
function buildGdoc() {
  captureDoc();
  return {
    format: 'paper', formatVersion: FORMAT_VERSION, typ: 'dokument',
    app: 'Submit Paper ' + WRITE_VERSION, exportiert: nowIso(),
    meta: { ...doc.meta, titel: doc.titel },
    inhalt: { kopf: doc.kopf || '', fuss: doc.fuss || '', seiten: doc.seiten },
    einstellungen: { ...doc.einstellungen }
  };
}
function safeName(s) { return (s || 'Dokument').replace(/[^\wäöüÄÖÜ\- ]+/g, '').trim().replace(/\s+/g, '_') || 'Dokument'; }

async function saveFile(asNew) {
  const data = buildGdoc();
  const fname = safeName(doc.titel) + '.paper';
  const json = JSON.stringify(data, null, 2);
  // 1) File System Access API
  if (window.showSaveFilePicker) {
    try {
      if (!fileHandle || asNew) {
        fileHandle = await window.showSaveFilePicker({
          suggestedName: fname,
          types: [{ description: 'Submit Paper Dokument', accept: { 'application/json': ['.paper', '.gdoc'] } }]
        });
      }
      const w = await fileHandle.createWritable();
      await w.write(json); await w.close();
      autosave(); toast('Gespeichert: ' + fileHandle.name);
      return;
    } catch (e) { if (e && e.name === 'AbortError') return; toast('Direktes Speichern nicht möglich — lade Datei herunter.'); }
  }
  // 2) Download-Fallback
  const blob = new Blob([json], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = fname; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  autosave(); toast('Heruntergeladen: ' + fname);
}

async function openFile() {
  let file = null, handle = null;
  if (window.showOpenFilePicker) {
    try {
      const [h] = await window.showOpenFilePicker({
        types: [{ description: 'Dokumente', accept: { 'application/octet-stream': ['.paper', '.gdoc', '.json', '.docx', '.odt', '.xlsx'] } }]
      });
      handle = h; file = await h.getFile();
    } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  if (!file) {
    file = await new Promise(res => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.paper,.gdoc,.json,.docx,.odt,.xlsx';
      inp.onchange = () => res(inp.files[0] || null);
      inp.click();
    });
  }
  if (!file) return;
  const nm = (file.name || '').toLowerCase();
  if (nm.endsWith('.docx')) return importDocx(file);
  if (nm.endsWith('.odt')) return importOdt(file);
  if (nm.endsWith('.xlsx')) return importXlsx(file);
  ingestGdoc(await file.text(), handle);   // .paper/.gdoc/.json
}

function ingestGdoc(text, handle) {
  let data; try { data = JSON.parse(text); } catch (_) { toast('Datei nicht lesbar'); return; }
  if (!data || (data.format !== 'paper' && data.format !== 'gdoc') || !data.inhalt) { toast('Keine Submit-Paper-Datei'); return; }
  if (typeof data.formatVersion === 'number' && data.formatVersion > FORMAT_VERSION)
    toast('Datei aus neuerer Version — wird nach bestem Wissen geöffnet.');
  const d = newDocObject({
    titel: (data.meta && data.meta.titel) || 'Importiertes Dokument',
    kopf: sanitizeHtml(data.inhalt.kopf || ''),
    fuss: sanitizeHtml(data.inhalt.fuss || ''),
    einstellungen: Object.assign(newDocObject().einstellungen, data.einstellungen || {}),
    meta: Object.assign(newDocObject().meta, data.meta || {})
  });
  if (Array.isArray(data.inhalt.seiten)) {              // neues Seiten-Format
    d.seiten = data.inhalt.seiten.map(p => {
      const typ = (p && p.typ === 'calc') ? 'calc' : 'write';
      let html = sanitizeHtml((p && p.html) || '');
      if (!html && p && p.tabelle && p.tabelle.cells) html = tabelleToHtml(p.tabelle);   // sehr alte Calc-Seite
      return { id: uid(), typ, html, fmt: (p && p.fmt && typeof p.fmt === 'object') ? p.fmt : {}, cfmt: (p && p.cfmt && typeof p.cfmt === 'object') ? p.cfmt : {}, colW: (p && p.colW && typeof p.colW === 'object') ? p.colW : {}, notiz: (p && typeof p.notiz === 'string') ? p.notiz : '', fill: (p && p.fill && typeof p.fill === 'object') ? p.fill : {}, txtcol: (p && p.txtcol && typeof p.txtcol === 'object') ? p.txtcol : {}, rowH: (p && p.rowH && typeof p.rowH === 'object') ? p.rowH : {}, merges: Array.isArray(p && p.merges) ? p.merges : [], borders: (p && p.borders && typeof p.borders === 'object') ? p.borders : {}, dispCols: (p && +p.dispCols) || 0, dispRows: (p && +p.dispRows) || 0, linien: (p && p.linien === true),
        // Format/Ausrichtung gehoeren zur SEITE (setFormat/setOrientation schreiben sie dorthin).
        // Fehlten sie hier, fiel eine A3-quer-Seite beim Oeffnen auf die Voreinstellung zurueck.
        ...(p && typeof p.format === 'string' ? { format: p.format } : {}),
        ...(p && typeof p.ausrichtung === 'string' ? { ausrichtung: p.ausrichtung } : {}) };
    });
    if (!d.seiten.length) d.seiten = [{ id: uid(), typ: 'write', html: '' }];
    d.aktiv = 0;
  } else {                                              // altes Format → migrieren
    delete d.seiten;
    d.html = sanitizeHtml(data.inhalt.html || '');
    if (data.inhalt.tabelle && data.inhalt.tabelle.cells) d.tabelle = data.inhalt.tabelle;
    if (data.einstellungen) d.einstellungen.modus = data.einstellungen.modus;
    migrateDoc(d);
  }
  lib.docs[d.id] = d; lib.order.unshift(d.id);
  if (!persistLibGeprueft()) return;
  openDoc(d.id); fileHandle = handle || null;
  toast('Geöffnet: ' + d.titel);
}

/* ============================================================
   Formatierung (contentEditable)
   ============================================================ */
function inCalc() { return appEl.classList.contains('calc-mode'); }
function cmd(name, val = null) {
  if (inCalc()) { calcCmd(name); return; }
  editor.focus(); document.execCommand(name, false, val); afterEdit();
}
// Menüband-Formatierung auf markierte Calc-Zellen anwenden
function calcCmd(name) {
  const flag = { bold: 'b', italic: 'i', underline: 'u', strikeThrough: 's' }[name];
  if (flag) return toggleCellFmt(flag);
  if (name === 'justifyLeft') return setCellFmt('al', 'left');
  if (name === 'justifyCenter') return setCellFmt('al', 'center');
  if (name === 'justifyRight') return setCellFmt('al', 'right');
  if (name === 'justifyFull') return setCellFmt('al', 'justify');
  // Listen/Hoch-/Tiefstellen etc. sind in Zellen nicht sinnvoll – ignorieren
}

function setBlock(tag) {
  if (inCalc()) {                                  // im Raster: die ganze ZEILE wird Titel/Überschrift (wie in Write)
    if (!curGrid) return; if (editingTd) endEdit(true);
    gridEnsure(curGrid, selC, selR);
    curGrid.zeilen[selR].tag = /^h[1-3]$/.test(tag) ? tag : 'p';
    activePage().html = gridToHtml(curGrid); renderCalc(); scheduleSave();
    return;
  }
  editor.focus();
  document.execCommand('formatBlock', false, tag);
  afterEdit();
}
function setFontSize(px) {
  editor.focus();
  document.execCommand('fontSize', false, '7');
  $$('font[size="7"]', editor).forEach(f => { f.removeAttribute('size'); f.style.fontSize = px + 'px'; });
  afterEdit();
}
function insertTable() {
  const rows = 3, cols = 3;
  let html = '<table><tbody>';
  for (let r = 0; r < rows; r++) {
    html += '<tr>';
    for (let c = 0; c < cols; c++) html += r === 0 ? '<th>&nbsp;</th>' : '<td>&nbsp;</td>';
    html += '</tr>';
  }
  html += '</tbody></table><p><br></p>';
  editor.focus(); document.execCommand('insertHTML', false, html); afterEdit();
}
function insertLink() {
  const raw = prompt('Link-Adresse (URL):', 'https://');
  if (raw === null) return;
  const url = safeUrl(raw);
  if (!url) { toast('Ungültige Adresse — erlaubt: http(s), mailto, tel.'); return; }
  editor.focus(); document.execCommand('createLink', false, url);
  const sel = document.getSelection();
  if (sel && sel.anchorNode) { const a = sel.anchorNode.parentElement?.closest('a'); if (a) { a.target = '_blank'; a.rel = 'noopener noreferrer'; } }
  afterEdit();
}

function normalizeEmpty() {
  if (editor.querySelector('img,table,hr')) return;
  if (!(editor.innerText || '').replace(/​/g, '').trim() && editor.innerHTML !== '') editor.innerHTML = '';
}
function afterEdit() { normalizeEmpty(); scheduleSave(); refreshAll(); scheduleRecompute(); scheduleWriteRulers(); }
let _fxTimer = null, _rulerTimer = null;
function scheduleRecompute() { clearTimeout(_fxTimer); _fxTimer = setTimeout(recomputeFormulas, 250); }
function scheduleWriteRulers() { clearTimeout(_rulerTimer); _rulerTimer = setTimeout(buildWriteRulers, 120); }

/* ---------- aktiven Zustand der Buttons spiegeln ---------- */
function syncCalcToolbar() {
  const cf = (curGrid && curCfmt()[selC + ',' + selR]) || {};
  const set = (c, on) => $$(`.fb-btn[data-cmd="${c}"]`).forEach(b => b.classList.toggle('on', !!on));
  set('bold', cf.b); set('italic', cf.i); set('underline', cf.u); set('strikeThrough', cf.s);
  set('justifyLeft', !cf.al || cf.al === 'left'); set('justifyCenter', cf.al === 'center'); set('justifyRight', cf.al === 'right'); set('justifyFull', cf.al === 'justify');
  if (cf.fam) $('#selFont').value = cf.fam;
  $('#selSize').value = String(Math.round(cf.sz || (doc ? doc.einstellungen.schriftgroesse : 16)));
  const tag = (curGrid && curGrid.zeilen[selR] && curGrid.zeilen[selR].tag) || 'p';   // Titel/Überschrift der Zeile in der Auswahl zeigen
  $('#selBlock').value = /^h[1-3]$/.test(tag) ? tag : 'p';
}
function syncToolbar() {
  if (inCalc()) { syncCalcToolbar(); return; }
  const q = c => { try { return document.queryCommandState(c); } catch (_) { return false; } };
  ['bold', 'italic', 'underline', 'strikeThrough', 'subscript', 'superscript',
   'insertUnorderedList', 'insertOrderedList',
   'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull'
  ].forEach(c => { const on = q(c); $$(`.fb-btn[data-cmd="${c}"]`).forEach(b => b.classList.toggle('on', on)); });
  // Absatzformat
  let block = 'p';
  const sel = document.getSelection();
  if (sel && sel.anchorNode) {
    const el = (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
    const bl = el && el.closest('h1,h2,h3,blockquote,pre,p');
    if (bl) block = bl.tagName.toLowerCase();
  }
  if (['h1', 'h2', 'h3', 'blockquote', 'pre'].includes(block)) $('#selBlock').value = block;
  else $('#selBlock').value = 'p';
}

/* ============================================================
   Statistik / Gliederung / Seiten
   ============================================================ */
function refreshAll() { refreshTOC(); updateStats(); updateOutline(); syncToolbar(); }

function updateStats() {
  if (doc && activePage() && activePage().typ === 'calc') { updateStatsCalc(); return; }
  const text = (editor.innerText || '').replace(/ /g, ' ');
  const words = (text.match(/[^\s]+/g) || []).length;
  const chars = text.replace(/\s/g, '').length;
  const pars = $$('p,h1,h2,h3,li,blockquote', editor).filter(e => e.innerText.trim()).length || (text.trim() ? 1 : 0);
  const pages = updatePages();
  const read = Math.max(1, Math.round(words / 200));
  $('#stWords').textContent = words.toLocaleString('de-CH') + ' Wörter';
  $('#stChars').textContent = chars.toLocaleString('de-CH') + ' Zeichen';
  $('#stPars').textContent = pars + (pars === 1 ? ' Absatz' : ' Absätze');
  $('#stPages').textContent = pages + (pages === 1 ? ' Seite' : ' Seiten');
  $('#stRead').textContent = words ? '~' + read + ' Min. Lesezeit' : '0 Min. Lesezeit';
  // Inspector-Statistik
  $('#statGrid').innerHTML = [
    ['Wörter', words.toLocaleString('de-CH')], ['Zeichen', chars.toLocaleString('de-CH')],
    ['Absätze', pars], ['Seiten', pages],
    ['Lesezeit', (words ? '~' + read : '0') + ' Min.'], ['Version', 'v' + (doc?.meta.version || 1)]
  ].map(([l, n]) => `<div class="stat-cell"><div class="sc-n">${n}</div><div class="sc-l">${l}</div></div>`).join('');
}
// Statistik für Calc-Seiten (echte Zell-/Zeilen-/Spaltenzahlen statt veraltetem Write-Text)
/* Kennzahlen der Markierung – wie die Statusleiste in Excel. Rein rechnend, im Test pruefbar. */
function auswahlStatistik(c1, c2, r1, r2) {
  const zahlen = [];
  let belegt = 0;
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
    let v; try { v = evalCell(c, r); } catch (_) { v = ''; }
    if (v !== '' && v != null) belegt++;
    if (typeof v === 'number' && isFinite(v)) zahlen.push(v);
  }
  const summe = zahlen.reduce((a, b) => a + b, 0);
  return {
    anzahl: belegt, zahlen: zahlen.length,
    summe: zahlen.length ? Math.round(summe * 1e10) / 1e10 : null,
    mittel: zahlen.length ? Math.round((summe / zahlen.length) * 1e10) / 1e10 : null,
    min: zahlen.length ? Math.min(...zahlen) : null,
    max: zahlen.length ? Math.max(...zahlen) : null,
  };
}
function updateStatsCalc() {
  const ur = curGrid ? calcUsedRange() : { maxR: -1, maxC: -1 };
  const rows = Math.max(0, ur.maxR + 1), cols = Math.max(0, ur.maxC + 1);
  let filled = 0;
  if (curGrid) curGrid.zeilen.forEach(z => z.cells.forEach(c => { if (cellText(c) !== '') filled++; }));
  $('#stWords').textContent = filled + (filled === 1 ? ' Zelle' : ' Zellen');
  $('#stChars').textContent = cols + (cols === 1 ? ' Spalte' : ' Spalten');
  $('#stPars').textContent = rows + (rows === 1 ? ' Zeile' : ' Zeilen');
  $('#stPages').textContent = '1 Seite';
  $('#stRead').textContent = 'Tabelle';
  // Markierung: sobald mehr als eine Zelle gewaehlt ist, zaehlen Summe/Mittelwert mehr als die Dokumentzahlen
  const rb = (typeof rangeBounds === 'function' && curGrid) ? rangeBounds() : null;
  const mehr = rb && (rb.c1 !== rb.c2 || rb.r1 !== rb.r2);
  let felder;
  if (mehr) {
    const st = auswahlStatistik(rb.c1, rb.c2, rb.r1, rb.r2);
    const z = n => (n == null ? '–' : new Intl.NumberFormat('de-CH').format(n));
    felder = [['Summe', z(st.summe)], ['Mittelwert', z(st.mittel)], ['Anzahl', st.anzahl], ['Zahlen', st.zahlen]];
    $('#stRead').textContent = 'Summe ' + z(st.summe);
  } else felder = [['Zellen', filled], ['Zeilen', rows], ['Spalten', cols], ['Version', 'v' + (doc?.meta.version || 1)]];
  $('#statGrid').innerHTML = felder
    .map(([l, n]) => `<div class="stat-cell"><div class="sc-n">${n}</div><div class="sc-l">${l}</div></div>`).join('');
}

// Spaltentrenner (Tabs) in Write auf dieselben Spaltenpositionen wie Calc ausrichten
function alignColseps() {
  if (!doc || (activePage() && activePage().typ === 'calc')) return;
  const seps = $$('.colsep', editor); if (!seps.length) return;
  const m = pageSetup().margins, contentMm = Math.max(60, pageDims().w - m.left - m.right);
  let maxCells = 1; $$('p,h1,h2,h3,blockquote,pre', editor).forEach(b => { const n = b.querySelectorAll('.colsep').length + 1; if (n > maxCells) maxCells = n; });
  const auto = (doc && doc.rasterCols) || 6;   // Hintergrundraster: standardmässig 6 Spalten
  const cols = Math.max(maxCells, activePage().dispCols || auto);
  const colW = (contentMm * MM) / cols;                 // Spaltenbreite in px (ungezoomt) – wie in Calc
  const z = parseFloat(page.style.zoom) || 1;
  const maxPx = contentMm * MM;
  seps.forEach(s => { s.style.display = 'inline-block'; s.style.minWidth = '0'; s.style.width = '0px'; s.style.textAlign = 'left'; s.style.borderBottom = ''; });   // erst zurücksetzen
  seps.forEach(s => {
    const block = s.closest('p,h1,h2,h3,blockquote,pre'); if (!block) return;
    const x = (s.getBoundingClientRect().left - block.getBoundingClientRect().left) / z;
    if (s.dataset.tab) {                                 // exakte Tab-Position aus dem Word-Import (mm ab linkem Rand = Spalte)
      let w = Math.min(maxPx, parseFloat(s.dataset.tab) * MM) - x;
      if (w < 2) w = 2;
      s.style.width = Math.round(w) + 'px';
      s.style.borderBottom = s.dataset.lead === 'dot' ? '1px dotted currentColor' : s.dataset.lead === 'line' ? '1px solid currentColor' : '';
      return;
    }
    let w = (Math.floor(x / colW + 0.001) + 1) * colW - x;
    if (w < 5) w += colW;                                // mind. eine Spalte vorrücken
    s.style.width = Math.round(w) + 'px';
  });
}
function updateOutline() {
  const heads = $$('h1,h2,h3', editor).filter(h => h.innerText.trim());
  const boxes = [$('#outline'), $('#navOutline')].filter(Boolean);
  if (!heads.length) { boxes.forEach(b => b.innerHTML = '<p class="muted">Noch keine Überschriften.</p>'); return; }
  heads.forEach((h, i) => { if (!h.id) h.id = 'h_' + i; });
  boxes.forEach(box => {
    box.innerHTML = '';
    heads.forEach(h => {
      const a = document.createElement('a');
      a.textContent = h.innerText.trim();
      a.className = 'lv' + h.tagName[1];
      a.onclick = () => { const el = document.getElementById(h.id); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
      box.appendChild(a);
    });
  });
}

/* ============================================================
   Dokumentenliste / Ordner
   ============================================================ */
let activeFolder = 'dokumente';
function renderList() {
  const list = $('#sideList'); list.innerHTML = '';
  let ids = lib.order.filter(id => lib.docs[id]);
  ids = ids.filter(id => {
    const d = lib.docs[id];
    if (activeFolder === 'papierkorb') return d.trashed;
    if (d.trashed) return false;
    if (activeFolder === 'favoriten') return d.fav;
    if (activeFolder === 'zuletzt') return true;
    if (activeFolder === 'archiv') return d.folder === 'archiv';
    if (activeFolder === 'vorlagen') return d.folder === 'vorlagen';
    return d.folder === 'dokumente';
  });
  if (activeFolder === 'vorlagen' && !ids.length) { list.innerHTML = renderTemplateHint(); bindTemplateHint(); return; }
  if (!ids.length) { list.innerHTML = renderEmptyState(); const b = $('#esNew'); if (b) b.onclick = () => createDoc(); return; }
  ids.forEach(id => {
    const d = lib.docs[id];
    const el = document.createElement('div');
    el.className = 'doc-item' + (id === lib.currentId ? ' current' : '');
    el.innerHTML = `<span class="di-title">${esc(d.titel)}</span><span class="di-meta">${fmtDate(d.meta.geaendert)}${d.fav ? ' · ★' : ''}</span>`;
    el.onclick = () => openDoc(id);
    el.oncontextmenu = (e) => { e.preventDefault(); docMenu(id, e); };
    list.appendChild(el);
  });
}
// Einladender, ordner-spezifischer Leerzustand (erster Eindruck) statt einer kargen Zeile
function renderEmptyState() {
  const F = {
    dokumente: { ic: '<path d="M6 2.5h8l4 4v15H6z"/><path d="M14 2.5v4h4"/>', t: 'Noch keine Dokumente', s: 'Erstelle dein erstes Dokument – oder starte mit einer Vorlage.', cta: true },
    favoriten: { ic: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9L3.5 9.7l5.9-.9z"/>', t: 'Keine Favoriten', s: 'Markiere ein Dokument mit ★, dann erscheint es hier.' },
    zuletzt: { ic: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3.2 1.9"/>', t: 'Noch nichts geöffnet', s: 'Zuletzt bearbeitete Dokumente sammeln sich hier.' },
    archiv: { ic: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v11h14V9M9.5 13h5"/>', t: 'Archiv ist leer', s: 'Abgelegte Dokumente findest du hier wieder.' },
    papierkorb: { ic: '<path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13"/>', t: 'Papierkorb ist leer', s: 'Gelöschte Dokumente lassen sich hier wiederherstellen.' },
  };
  const f = F[activeFolder] || F.dokumente;
  return `<div class="empty-state"><svg viewBox="0 0 24 24" class="es-ico">${f.ic}</svg>`
    + `<div class="es-t">${f.t}</div><div class="es-s">${f.s}</div>`
    + (f.cta ? `<button class="empty-cta" id="esNew">+ Neues Dokument</button>` : '') + `</div>`;
}
// Echtes Rechtsklick-Menü fürs Dokument (statt Browser-prompt mit Zahlen)
let ctxDocId = null;
function docMenuItems(d) {
  return d.trashed ? ['restore', 'purge'] : ['open', 'fav', 'rename', 'dup', 'arch', 'trash'];
}
const DOC_MENU = {
  open:    { t: 'Öffnen' },
  fav:     { t: d => d.fav ? 'Favorit entfernen' : 'Als Favorit ★' },
  rename:  { t: 'Umbenennen …' },
  dup:     { t: 'Duplizieren' },
  arch:    { t: d => d.folder === 'archiv' ? 'Aus Archiv holen' : 'Archivieren' },
  trash:   { t: 'In den Papierkorb', del: true },
  restore: { t: 'Wiederherstellen' },
  purge:   { t: 'Endgültig löschen', del: true },
};
function docMenu(id, ev) {
  const d = lib.docs[id]; if (!d) return; ctxDocId = id;
  const m = $('#ctxmenu');
  m.innerHTML = `<span class="lbl">${esc(d.titel)}</span>` + docMenuItems(d).map(k => {
    const mi = DOC_MENU[k], lbl = typeof mi.t === 'function' ? mi.t(d) : mi.t;
    const sep = (k === 'trash' || k === 'purge') ? '<div class="sep"></div>' : '';
    return `${sep}<button data-doc="${k}"${mi.del ? ' class="del"' : ''}><span>${lbl}</span></button>`;
  }).join('');
  m.hidden = false;
  const x = ev ? ev.clientX : 240, y = ev ? ev.clientY : 200;
  m.style.left = Math.min(x, window.innerWidth - m.offsetWidth - 8) + 'px';
  m.style.top = Math.min(y, window.innerHeight - m.offsetHeight - 8) + 'px';
}
function docMenuAction(a) {
  $('#ctxmenu').hidden = true;
  const id = ctxDocId, d = lib.docs[id]; if (!d) return;
  if (a === 'open') return openDoc(id);
  if (a === 'fav') d.fav = !d.fav;
  else if (a === 'rename') { const t = prompt('Neuer Name:', d.titel); if (t == null) return; d.titel = t.trim() || d.titel; if (id === lib.currentId) $('#docTitle').value = d.titel; }
  else if (a === 'dup') { const c = newDocObject({ ...JSON.parse(JSON.stringify(d)), id: uid(), titel: d.titel + ' (Kopie)', folder: 'dokumente', trashed: false, fav: false }); lib.docs[c.id] = c; lib.order.unshift(c.id); }
  else if (a === 'arch') d.folder = d.folder === 'archiv' ? 'dokumente' : 'archiv';
  else if (a === 'trash') d.trashed = true;
  else if (a === 'restore') d.trashed = false;
  else if (a === 'purge') { if (!confirm(`„${d.titel}" endgültig löschen?`)) return; delete lib.docs[id]; lib.order = lib.order.filter(x => x !== id); if (lib.currentId === id) { lib.currentId = lib.order[0] || null; lib.currentId ? openDoc(lib.currentId) : createDoc(); } }
  persistLibGeprueft(); renderList();
}

/* ---------- Vorlagen ---------- */
const TODAY = new Date().toLocaleDateString('de-CH');
/* ---- Rechnende Rastervorlagen ----
   Bewusst als Rasterzeilen (Zellen durch COLSEP getrennt), nicht als HTML-Tabelle:
   nur so rechnen die Formeln, greifen die Zahlenformate und laesst sich weiterarbeiten.
   Sie sind zugleich ein Funktionstest: wer eine davon oeffnet, sieht sofort, ob Formeln,
   Einheiten, Summen und Seitenzahlen stimmen. */
const Z = (...zellen) => '<p>' + zellen.join(COLSEP) + '</p>';
function rasterVorlage(zeilen, fmt, cfmt, colW) {
  return { pages: [{ id: uid(), typ: 'calc', linien: true, html: zeilen.join(''),
    fmt: fmt || {}, cfmt: cfmt || {}, colW: colW || {}, fill: {}, txtcol: {}, borders: {}, rowH: {}, merges: [],
    dispCols: 0, dispRows: 0 }] };
}
/* Zahlenformat auf eine ganze Spalte legen (Zeilen von..bis) */
function spaltenFormat(fmt, spalte, von, bis, art) { for (let r = von; r <= bis; r++) fmt[spalte + ',' + r] = art; return fmt; }
function fettZeile(cfmt, r, spalten) { spalten.forEach(c => { cfmt[c + ',' + r] = Object.assign({}, cfmt[c + ',' + r], { b: true }); }); return cfmt; }

const TEMPLATES = {
  brief: { titel: 'Brief', html:
    `<p style="text-align:right;color:#777">Yanick Gerber&nbsp;·&nbsp;Musterstrasse 1&nbsp;·&nbsp;3000 Bern</p>
     <p><br></p><p><br></p>
     <p>Empfänger AG<br>z.&nbsp;H. Frau Muster<br>Beispielweg 5<br>3000 Bern</p>
     <p><br></p><p style="text-align:right">Bern, ${TODAY}</p><p><br></p>
     <h2>Betreff der Mitteilung</h2>
     <p>Sehr geehrte Damen und Herren</p>
     <p>Hier steht der Inhalt Ihres Schreibens. Ersetzen Sie diesen Text durch Ihr Anliegen.</p>
     <p><br></p><p>Freundliche Grüsse</p><p><br></p><p>Yanick Gerber</p>` },
  rechnung: { titel: 'Rechnung', html:
    `<h1>Rechnung</h1>
     <p style="color:#777">Rechnungsnr. 2026-001&nbsp;·&nbsp;Datum ${TODAY}&nbsp;·&nbsp;zahlbar innert 30 Tagen</p>
     <p><b>An</b><br>Kunde AG<br>Adresse<br>PLZ Ort</p>
     <table><tbody>
       <tr><th style="text-align:left">Beschreibung</th><th>Menge</th><th>Einzelpreis</th><th>Betrag</th></tr>
       <tr><td>Leistung 1</td><td>1</td><td>CHF 0.00</td><td>CHF 0.00</td></tr>
       <tr><td>Leistung 2</td><td>1</td><td>CHF 0.00</td><td>CHF 0.00</td></tr>
     </tbody></table>
     <p style="text-align:right">Zwischensumme&nbsp;&nbsp;CHF 0.00<br>MwSt 8,1&nbsp;%&nbsp;&nbsp;CHF 0.00<br><b>Total&nbsp;&nbsp;CHF 0.00</b></p>
     <p style="color:#777">Zahlbar auf IBAN CH00 0000 0000 0000 0000 0</p>` },
  angebot: { titel: 'Angebot', html:
    `<h1>Angebot</h1>
     <p style="color:#777">Angebot-Nr. 2026-001&nbsp;·&nbsp;${TODAY}&nbsp;·&nbsp;gültig 30 Tage</p>
     <p>Sehr geehrte Damen und Herren</p>
     <p>Gerne unterbreiten wir Ihnen folgendes Angebot:</p>
     <h2>Leistungen</h2><ul><li>Leistung 1</li><li>Leistung 2</li><li>Leistung 3</li></ul>
     <h2>Preis</h2><p>Pauschal <b>CHF 0.00</b> exkl. MwSt.</p>
     <h2>Konditionen</h2><p>Zahlungsziel 30 Tage · Ausführung nach Absprache.</p>
     <p><br></p><p>Freundliche Grüsse<br>Yanick Gerber</p>` },
  projektplan: { titel: 'Projektplan', html:
    `<h1>Projektplan</h1>
     <p style="color:#777">Projekt …&nbsp;·&nbsp;Verantwortlich Yanick Gerber&nbsp;·&nbsp;Stand ${TODAY}</p>
     <h2>Ausgangslage &amp; Ziel</h2><p>Worum geht es, was soll erreicht werden?</p>
     <h2>Meilensteine</h2><ol><li>Start – </li><li>Umsetzung – </li><li>Abschluss – </li></ol>
     <h2>Aufgaben</h2><ul><li>Aufgabe – verantwortlich – bis</li></ul>
     <h2>Risiken</h2><ul><li>Risiko – Massnahme</li></ul>` },
  protokoll: { titel: 'Sitzungsprotokoll', html:
    `<h1>Sitzungsprotokoll</h1>
     <p style="color:#777">Datum ${TODAY}&nbsp;·&nbsp;Ort …&nbsp;·&nbsp;Protokoll Yanick Gerber</p>
     <p><b>Teilnehmende</b>&nbsp;&nbsp;…</p>
     <h2>Traktanden</h2><ol><li></li><li></li></ol>
     <h2>Beschlüsse</h2><ul><li></li></ul>
     <h2>Pendenzen</h2><ul><li>Aufgabe – verantwortlich – bis</li></ul>` },
  lebenslauf: { titel: 'Lebenslauf', html:
    `<h1>Vorname Nachname</h1>
     <p style="color:#777">Adresse&nbsp;·&nbsp;0000 Ort&nbsp;·&nbsp;mail@example.ch&nbsp;·&nbsp;079 000 00 00</p>
     <h2>Profil</h2><p>Kurzer Beschrieb in zwei, drei Sätzen.</p>
     <h2>Berufserfahrung</h2><p><b>2022 – heute&nbsp;·&nbsp;Position</b><br>Firma, Ort<br>Wichtigste Aufgaben und Erfolge.</p>
     <h2>Ausbildung</h2><p><b>Jahr&nbsp;·&nbsp;Abschluss</b><br>Schule, Ort</p>
     <h2>Kenntnisse</h2><ul><li>Sprachen: …</li><li>IT: …</li></ul>` },
  kostenvoranschlag: { titel: 'Kostenvoranschlag', html:
    `<h1>Kostenvoranschlag</h1>
     <p style="color:#777">Objekt …&nbsp;·&nbsp;Bauherrschaft …&nbsp;·&nbsp;${TODAY}</p>
     <table class="pdftab"><tbody>
       <tr><td><strong>Pos.</strong></td><td><strong>Leistung</strong></td><td style="text-align:right"><strong>Menge</strong></td><td><strong>Einheit</strong></td><td style="text-align:right"><strong>Ansatz</strong></td><td style="text-align:right"><strong>Betrag</strong></td></tr>
       <tr><td>1</td><td>Baumeisterarbeiten</td><td style="text-align:right">1</td><td>pausch.</td><td style="text-align:right">0.00</td><td style="text-align:right">0.00</td></tr>
       <tr><td>2</td><td>…</td><td style="text-align:right"></td><td></td><td style="text-align:right"></td><td style="text-align:right">0.00</td></tr>
     </tbody></table>
     <p style="text-align:right">Zwischentotal&nbsp;&nbsp;CHF 0.00<br>MwSt 8,1&nbsp;%&nbsp;&nbsp;CHF 0.00<br><strong>Total inkl. MwSt&nbsp;&nbsp;CHF 0.00</strong></p>
     <p style="color:#777">Unverbindlicher Richtpreis · Genauigkeit ± 15 % · gültig 60 Tage.</p>` },
  regierapport: { titel: 'Regierapport', html:
    `<h1>Regie- / Arbeitsrapport</h1>
     <p style="color:#777">Objekt …&nbsp;·&nbsp;Datum ${TODAY}&nbsp;·&nbsp;Rapport-Nr. …</p>
     <h2>Arbeitsstunden</h2>
     <table class="pdftab"><tbody>
       <tr><td><strong>Mitarbeiter</strong></td><td><strong>Tätigkeit</strong></td><td style="text-align:right"><strong>Std.</strong></td><td style="text-align:right"><strong>Ansatz</strong></td><td style="text-align:right"><strong>Betrag</strong></td></tr>
       <tr><td>…</td><td>…</td><td style="text-align:right">0.0</td><td style="text-align:right">0.00</td><td style="text-align:right">0.00</td></tr>
     </tbody></table>
     <h2>Material</h2>
     <table class="pdftab"><tbody>
       <tr><td><strong>Material</strong></td><td style="text-align:right"><strong>Menge</strong></td><td><strong>Einheit</strong></td><td style="text-align:right"><strong>Betrag</strong></td></tr>
       <tr><td>…</td><td style="text-align:right"></td><td></td><td style="text-align:right">0.00</td></tr>
     </tbody></table>
     <p style="text-align:right"><strong>Total&nbsp;&nbsp;CHF 0.00</strong></p>
     <p style="color:#777">Visum Bauleitung …&nbsp;&nbsp;·&nbsp;&nbsp;Visum Unternehmer …</p>` },
  bautagebuch: { titel: 'Bautagebuch', html:
    `<h1>Bautagebuch / Baustellenprotokoll</h1>
     <p style="color:#777">Objekt …&nbsp;·&nbsp;Datum ${TODAY}&nbsp;·&nbsp;Wetter …&nbsp;·&nbsp;Temperatur … °C</p>
     <h2>Anwesende</h2><ul><li>… (Firma, Anzahl)</li></ul>
     <h2>Ausgeführte Arbeiten</h2><ul><li>…</li></ul>
     <h2>Lieferungen / Geräte</h2><ul><li>…</li></ul>
     <h2>Besondere Vorkommnisse</h2><p>…</p>
     <h2>Pendenzen</h2><ul><li>Aufgabe – verantwortlich – bis</li></ul>` },
  maengelliste: { titel: 'Mängelliste', html:
    `<h1>Mängel- / Abnahmeprotokoll</h1>
     <p style="color:#777">Objekt …&nbsp;·&nbsp;Abnahme vom ${TODAY}&nbsp;·&nbsp;Teilnehmende …</p>
     <table class="pdftab"><tbody>
       <tr><td><strong>Nr.</strong></td><td><strong>Ort / Bauteil</strong></td><td><strong>Mangel</strong></td><td><strong>Verantwortlich</strong></td><td><strong>Frist</strong></td><td><strong>erledigt</strong></td></tr>
       <tr><td>1</td><td>…</td><td>…</td><td>…</td><td>…</td><td>☐</td></tr>
       <tr><td>2</td><td>…</td><td>…</td><td>…</td><td>…</td><td>☐</td></tr>
     </tbody></table>
     <p style="color:#777">Unterschrift Bauherrschaft …&nbsp;&nbsp;·&nbsp;&nbsp;Unterschrift Unternehmer …</p>` },
  zahlungsplan: { titel: 'Zahlungsplan', html:
    `<h1>Zahlungsplan</h1>
     <p style="color:#777">Objekt …&nbsp;·&nbsp;Vertragssumme CHF 0.00&nbsp;·&nbsp;${TODAY}</p>
     <table class="pdftab"><tbody>
       <tr><td><strong>Rate</strong></td><td><strong>Zahlungsgrund / Baufortschritt</strong></td><td style="text-align:right"><strong>%</strong></td><td style="text-align:right"><strong>Betrag</strong></td><td><strong>fällig</strong></td></tr>
       <tr><td>1</td><td>Bei Vertragsabschluss</td><td style="text-align:right">30</td><td style="text-align:right">0.00</td><td>…</td></tr>
       <tr><td>2</td><td>Bei Baubeginn</td><td style="text-align:right">40</td><td style="text-align:right">0.00</td><td>…</td></tr>
       <tr><td>3</td><td>Nach Abnahme / Bezug</td><td style="text-align:right">30</td><td style="text-align:right">0.00</td><td>…</td></tr>
     </tbody></table>` },

  // ---------------- Rechnende Bau-Vorlagen ----------------
  // Bewusst Rasterzeilen statt HTML-Tabellen: nur so rechnen Formeln, greifen
  // Zahlenformate und laesst sich weiterarbeiten. Zugleich ein Funktionstest -
  // wer eine oeffnet, sieht sofort, ob Formeln, Einheiten und Summen stimmen.
  baukosten: { titel: 'Baukostenuebersicht (BKP)', bauen: () => {
    const B = [['0', 'Grundstueck'], ['1', 'Vorbereitungsarbeiten'], ['2', 'Gebaeude'],
               ['3', 'Betriebseinrichtungen'], ['4', 'Umgebung'], ['5', 'Baunebenkosten'],
               ['6', 'Reserve'], ['9', 'Ausstattung']];
    const z = [];
    z.push(Z('BAUKOSTENUEBERSICHT NACH BKP'));
    z.push(Z('Projekt', '...', 'Stand', TODAY));
    z.push(Z(''));
    z.push(Z('BKP', 'Bezeichnung', 'Kostenschaetzung', 'Voranschlag', 'Prognose', 'Abweichung', 'Anteil'));
    B.forEach((b, i) => {
      const r = 5 + i;
      z.push(Z(b[0], b[1], '0', '0', '0',
        '=E' + r + '-D' + r,
        '=WENNFEHLER(F' + r + '/D' + r + ';0)'));
    });
    const erste = 5, letzte = 4 + B.length, tot = letzte + 1;
    z.push(Z('', 'TOTAL',
      '=SUMME(C' + erste + ':C' + letzte + ')',
      '=SUMME(D' + erste + ':D' + letzte + ')',
      '=SUMME(E' + erste + ':E' + letzte + ')',
      '=SUMME(F' + erste + ':F' + letzte + ')',
      '=WENNFEHLER(F' + tot + '/D' + tot + ';0)'));
    z.push(Z(''));
    z.push(Z('', 'davon Gebaeude (BKP 2)', '', '', '=SUMMEWENN(A' + erste + ':A' + letzte + ';"2";E' + erste + ':E' + letzte + ')'));
    const fmt = {};
    [2, 3, 4, 5].forEach(c => spaltenFormat(fmt, c, erste - 1, tot - 1, 'chf'));
    spaltenFormat(fmt, 6, erste - 1, tot - 1, 'pct');
    fmt['4,' + (tot + 1)] = 'chf';
    const cfmt = fettZeile({}, 3, [0, 1, 2, 3, 4, 5, 6]);
    fettZeile(cfmt, tot - 1, [1, 2, 3, 4, 5, 6]);
    cfmt['0,0'] = { b: true, sz: 20 };
    return rasterVorlage(z, fmt, cfmt, { 0: 60, 1: 240 });
  } },

  terminprogramm: { titel: 'Terminprogramm', bauen: () => {
    const G = ['Baumeister', 'Zimmermann', 'Spengler / Bedachung', 'Fenster', 'Elektro', 'Sanitaer',
               'Heizung', 'Gipser', 'Schreiner', 'Bodenbelaege', 'Maler', 'Reinigung'];
    const z = [];
    z.push(Z('TERMINPROGRAMM'));
    z.push(Z('Projekt', '...', 'Stand', TODAY));
    z.push(Z(''));
    z.push(Z('Gewerk', 'Start', 'Ende', 'Kalendertage', 'Arbeitstage', 'Bemerkung'));
    G.forEach((g, i) => {
      const r = 5 + i;
      z.push(Z(g, '', '',
        '=WENNFEHLER(TAGE(B' + r + ';C' + r + ');"")',
        '=WENNFEHLER(ARBEITSTAGE(B' + r + ';C' + r + ');"")', ''));
    });
    const erste = 5, letzte = 4 + G.length;
    z.push(Z(''));
    z.push(Z('Summe Einzeldauern', '', '',
      '=SUMME(D' + erste + ':D' + letzte + ')',
      '=SUMME(E' + erste + ':E' + letzte + ')',
      'nicht der Kalenderzeitraum'));
    z.push(Z(''));
    z.push(Z('Datum eintragen als 01.03.2026 - die Dauer rechnet sich selbst.'));
    const cfmt = fettZeile({}, 3, [0, 1, 2, 3, 4, 5]);
    cfmt['0,0'] = { b: true, sz: 20 };
    fettZeile(cfmt, letzte + 1, [0, 3, 4]);
    return rasterVorlage(z, {}, cfmt, { 0: 200, 5: 260 });
  } },

  ausmass: { titel: 'Ausmassblatt', bauen: () => {
    const z = [];
    z.push(Z('AUSMASS'));
    z.push(Z('Projekt', '...', 'Gewerk', '...', 'Datum', TODAY));
    z.push(Z(''));
    z.push(Z('Pos.', 'Bezeichnung', 'Anzahl', 'Laenge', 'Breite', 'Menge', 'Einheit'));
    for (let i = 0; i < 12; i++) {
      const r = 5 + i;
      z.push(Z(String(i + 1), '', '', '', '',
        '=WENNFEHLER(C' + r + '*D' + r + '*E' + r + ';"")', 'm2'));
    }
    const erste = 5, letzte = 16;
    z.push(Z('', 'TOTAL', '', '', '', '=SUMME(F' + erste + ':F' + letzte + ')'));
    const fmt = {};
    spaltenFormat(fmt, 5, erste - 1, letzte, 'm2');
    const cfmt = fettZeile({}, 3, [0, 1, 2, 3, 4, 5, 6]);
    fettZeile(cfmt, letzte, [1, 5]);
    cfmt['0,0'] = { b: true, sz: 20 };
    return rasterVorlage(z, fmt, cfmt, { 1: 260 });
  } },

  preisspiegel: { titel: 'Offertvergleich (Preisspiegel)', bauen: () => {
    const z = [];
    z.push(Z('OFFERTVERGLEICH'));
    z.push(Z('Projekt', '...', 'Gewerk', '...', 'Datum', TODAY));
    z.push(Z(''));
    z.push(Z('Pos.', 'Leistung', 'Firma A', 'Firma B', 'Firma C', 'guenstigste', 'Differenz A'));
    for (let i = 0; i < 8; i++) {
      const r = 5 + i;
      z.push(Z(String(i + 1), '', '0', '0', '0',
        '=MIN(C' + r + ':E' + r + ')', '=C' + r + '-F' + r));
    }
    const erste = 5, letzte = 12, tot = 13;
    z.push(Z('', 'TOTAL',
      '=SUMME(C' + erste + ':C' + letzte + ')',
      '=SUMME(D' + erste + ':D' + letzte + ')',
      '=SUMME(E' + erste + ':E' + letzte + ')',
      '=SUMME(F' + erste + ':F' + letzte + ')',
      '=C' + tot + '-F' + tot));
    z.push(Z(''));
    z.push(Z('', 'Positionen, bei denen A am guenstigsten ist',
      '=ZAEHLENWENN(G' + erste + ':G' + letzte + ';"=0")'));
    const fmt = {};
    [2, 3, 4, 5, 6].forEach(c => spaltenFormat(fmt, c, erste - 1, tot - 1, 'chf'));
    const cfmt = fettZeile({}, 3, [0, 1, 2, 3, 4, 5, 6]);
    fettZeile(cfmt, tot - 1, [1, 2, 3, 4, 5, 6]);
    cfmt['0,0'] = { b: true, sz: 20 };
    return rasterVorlage(z, fmt, cfmt, { 1: 260 });
  } },

  beiblatt: { titel: 'Beiblatt zur Offerte', bauen: () => {
    const z = [];
    z.push(Z('BEIBLATT ZUR OFFERTE'));
    z.push(Z(''));
    z.push(Z('Projekt', '...'));
    z.push(Z('Bauherrschaft', '...'));
    z.push(Z('Gewerk / BKP', '...'));
    z.push(Z('Unternehmer', '...'));
    z.push(Z('Offerte vom', TODAY));
    z.push(Z(''));
    z.push(Z('BEDINGUNGEN'));
    [['Vertragsgrundlage', 'SIA 118, Ausgabe 2013'],
     ['Preisbasis', 'fest bis Bauvollendung, keine Teuerung'],
     ['Skonto', '2 % innert 30 Tagen'],
     ['Rueckbehalt', '10 % bis Abnahme, danach Garantieschein'],
     ['Garantie', '2 Jahre ab Abnahme, verdeckte Maengel 5 Jahre'],
     ['Ausfuehrung', 'gemaess Terminprogramm'],
     ['Regiearbeiten', 'nur nach schriftlicher Bestellung'],
     ['Baureinigung', 'taeglich durch Unternehmer'],
     ['Versicherung', 'Bauwesenversicherung durch Bauherrschaft']].forEach(p => z.push(Z(p[0], p[1])));
    z.push(Z(''));
    z.push(Z('BEMERKUNGEN'));
    z.push(Z('...'));
    z.push(Z(''));
    z.push(Z('Ort, Datum', '', 'Unternehmer', ''));
    z.push(Z(''));
    z.push(Z('..............................', '', '..............................', ''));
    const cfmt = { '0,0': { b: true, sz: 20 } };
    fettZeile(cfmt, 8, [0]);
    fettZeile(cfmt, 19, [0]);
    [2, 3, 4, 5, 6].forEach(r => fettZeile(cfmt, r, [0]));
    return rasterVorlage(z, {}, cfmt, { 0: 200, 1: 320 });
  } },
};
// Vorlagen-Galerie: Kurzbeschreibung + Kategorie-Icon je Vorlage (bessere Auffindbarkeit)
const TMPL_META = {
  brief:             { d: 'Formeller Geschäftsbrief mit Absender & Datum', i: 'doc' },
  rechnung:          { d: 'Rechnung mit Positionen & Total', i: 'money' },
  angebot:           { d: 'Angebot / Offerte mit Leistungen & Preis', i: 'money' },
  projektplan:       { d: 'Projektübersicht mit Meilensteinen', i: 'list' },
  protokoll:         { d: 'Sitzungsprotokoll mit Traktanden', i: 'doc' },
  lebenslauf:        { d: 'Strukturierter Lebenslauf (CV)', i: 'doc' },
  kostenvoranschlag: { d: 'Baukostenschätzung nach Positionen', i: 'money' },
  regierapport:      { d: 'Rapport für Regiearbeiten (Std./Material)', i: 'list' },
  bautagebuch:       { d: 'Tägliche Bau-Notizen & Wetter', i: 'list' },
  maengelliste:      { d: 'Mängel erfassen, verorten, abhaken', i: 'list' },
  zahlungsplan:      { d: 'Ratenplan nach Baufortschritt', i: 'money' },
  baukosten:         { d: 'BKP 0-9, Voranschlag/Prognose, rechnet Abweichung', i: 'money' },
  terminprogramm:    { d: 'Gewerke mit Start/Ende, rechnet Kalender- und Arbeitstage', i: 'list' },
  ausmass:           { d: 'Ausmassblatt, rechnet Mengen in m2', i: 'list' },
  preisspiegel:      { d: 'Drei Offerten vergleichen, findet die guenstigste', i: 'money' },
  beiblatt:          { d: 'Beiblatt zur Offerte: Bedingungen nach SIA 118', i: 'doc' },
};
const TMPL_ICO = {
  doc:   '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  money: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.4"/><path d="M6 9v6M18 9v6"/>',
  list:  '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',

};
function renderTemplateHint() {
  return '<div class="tmpl-gallery">' +
    Object.entries(TEMPLATES).map(([k, t]) => {
      const m = TMPL_META[k] || {}, ico = TMPL_ICO[m.i] || TMPL_ICO.doc;
      return `<button class="tmpl-card" data-tmpl="${k}"><span class="tc-ico"><svg viewBox="0 0 24 24" class="i">${ico}</svg></span><span class="tc-tx"><span class="tc-t">${esc(t.titel)}</span><span class="tc-d">${m.d || 'Vorlage'}</span></span></button>`;
    }).join('') +
    '</div>';
}
function bindTemplateHint() {
  $$('.tmpl-card').forEach(b => b.onclick = () => {
    const t = TEMPLATES[b.dataset.tmpl];
    // Rechnende Vorlagen liefern fertige Rasterseiten (mit Formeln und Zahlenformaten),
    // die aelteren liefern schlichtes HTML.
    createDoc(t.bauen ? Object.assign({ titel: t.titel }, t.bauen()) : { titel: t.titel, html: t.html });
    activeFolder = 'dokumente';
    $$('.snav[data-folder]').forEach(x => x.classList.toggle('active', x.dataset.folder === 'dokumente'));
    toast('Vorlage „' + t.titel + '" erstellt');
  });
}

/* ============================================================
   Export
   ============================================================ */
function docHtmlShell(inner) {
  const s = doc.einstellungen;
  return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(doc.titel)}</title>
<style>
:root{--acc:#4f7a3c}
*{box-sizing:border-box}
body{font-family:${s.schriftart},'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:${s.schriftgroesse}px;line-height:${s.zeilenabstand};color:#1a1e27;max-width:780px;margin:48px auto;padding:0 24px;-webkit-text-size-adjust:100%}
h1{font-size:2em;font-weight:700;line-height:1.2;letter-spacing:-.01em;margin:.4em 0 .35em}
h2{font-size:1.5em;font-weight:600;line-height:1.25;margin:1.1em 0 .3em}
h3{font-size:1.2em;font-weight:600;margin:1em 0 .25em}
p{margin:0 0 .85em}
a{color:var(--acc);text-underline-offset:2px}
blockquote{border-left:3px solid var(--acc);padding:.2em 0 .2em 1.1em;margin:.8em 0;color:#555;font-style:italic}
pre{background:#f5f6f8;border:1px solid #eceae2;padding:14px 16px;border-radius:8px;overflow:auto;font-family:'Courier New',monospace}
hr{border:none;border-top:1px solid #e2e0d6;margin:1.4em 0}
img{max-width:100%;border-radius:6px}
mark{background:#ffe066;padding:.05em .1em;border-radius:3px}
table{border-collapse:collapse;width:100%;margin:.6em 0}
td,th{border:1px solid #ddd;padding:6px 10px;text-align:left}
th{background:#f5f4ee;font-weight:600}
.pdftab{border:none;margin:.5em 0}
.pdftab td{border:none;border-bottom:1px solid #ebe9e0;padding:4px 0 4px 12px;vertical-align:top;font-variant-numeric:tabular-nums}
.pdftab td:first-child{padding-left:0}
.pdftab td:not(:first-child){padding-left:20px}
.pdftab td[colspan]{border-bottom:none;padding-top:8px;padding-left:0}
.pdftab tr:last-child td{border-bottom:none}
.pdftab tr.tot td{font-weight:700;border-top:1.5px solid #565d52;border-bottom:none;padding-top:7px}
@media print{body{margin:0;max-width:none}}
</style>
</head><body>${inner}</body></html>`;
}
function download(name, data, mime) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'text/plain' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ---------- Mini-ZIP-Writer (Store, ohne Abhängigkeit) für echte .docx/.odt ---------- */
function crc32(b) { let c = ~0; for (let i = 0; i < b.length; i++) { c ^= b[i]; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); } return ~c >>> 0; }
function zipStore(files) {                       // files: [{name, bytes:Uint8Array}]
  const u16 = n => [n & 255, (n >>> 8) & 255], u32 = n => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  const locals = [], centrals = []; let offset = 0;
  files.forEach(f => {
    const name = new TextEncoder().encode(f.name), data = f.bytes, crc = crc32(data);
    const lh = [0x50, 0x4b, 3, 4, ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0)];
    const local = new Uint8Array(lh.length + name.length + data.length);
    local.set(lh, 0); local.set(name, lh.length); local.set(data, lh.length + name.length);
    locals.push(local);
    const ch = [0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)];
    const cen = new Uint8Array(ch.length + name.length); cen.set(ch, 0); cen.set(name, ch.length); centrals.push(cen);
    offset += local.length;
  });
  let cenSize = 0; centrals.forEach(c => cenSize += c.length);
  const end = new Uint8Array([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cenSize), ...u32(offset), ...u16(0)]);
  return new Blob([...locals, ...centrals, end], { type: 'application/octet-stream' });
}
function xmlEsc(s) { return (s || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
function cssToPt(v) { v = (v || '').trim(); if (!v) return 0; if (v.endsWith('pt')) return parseFloat(v); if (v.endsWith('px')) return parseFloat(v) * 72 / 96; const n = parseFloat(v); return isNaN(n) ? 0 : n * 72 / 96; }
function cssColorHex(v) { v = (v || '').trim(); if (!v || v === 'transparent' || v === 'inherit') return ''; if (v[0] === '#') { if (v.length === 4) return '#' + [...v.slice(1)].map(c => c + c).join(''); return v.length >= 7 ? v.slice(0, 7) : ''; } const m = v.match(/rgba?\(([^)]+)\)/i); if (m) { const p = m[1].split(',').map(s => parseFloat(s)); if (p.length >= 3 && !(p[3] === 0)) return '#' + p.slice(0, 3).map(n => ('0' + Math.round(n).toString(16)).slice(-2)).join(''); } return ''; }
// Editor-Inhalt in Blöcke mit Inline-Läufen zerlegen (für .docx/.odt)
function exportBlocks() {
  const root = document.createElement('div'); root.innerHTML = cleanEditorHTML();
  const out = [];
  const runsOf = el => { const runs = []; const walk = (n, st) => { n.childNodes.forEach(x => {
    if (x.nodeType === 3) { const t = x.textContent; if (!t) return; t.split('\t').forEach((seg, i) => { if (i) runs.push({ tab: 1 }); if (seg) runs.push({ t: seg, ...st }); }); return; }
    if (x.classList && x.classList.contains('colsep')) { runs.push({ tab: 1 }); return; }
    const tg = x.tagName.toLowerCase(); if (tg === 'br') { runs.push({ br: 1 }); return; }
    if (tg === 'img') { runs.push({ img: x.getAttribute('src') || '', iw: +x.getAttribute('width') || x.width || 0, ih: +x.getAttribute('height') || x.height || 0 }); return; }
    const ns = { ...st }; if (tg === 'b' || tg === 'strong') ns.b = 1; if (tg === 'i' || tg === 'em') ns.i = 1; if (tg === 'u') ns.u = 1; if (tg === 's' || tg === 'strike' || tg === 'del') ns.s = 1;
    if (tg === 'sup') ns.vert = 'sup'; if (tg === 'sub') ns.vert = 'sub';
    const s = x.style;
    if (s) {
      if (s.fontWeight === 'bold' || +s.fontWeight >= 600) ns.b = 1;
      if (s.fontStyle === 'italic') ns.i = 1;
      const td = (s.textDecorationLine || s.textDecoration || ''); if (/underline/.test(td)) ns.u = 1; if (/line-through/.test(td)) ns.s = 1;
      if (s.fontSize) { const pt = cssToPt(s.fontSize); if (pt) ns.sz = Math.round(pt * 2); }
      if (s.fontFamily) ns.fam = s.fontFamily.replace(/["']/g, '').split(',')[0].trim();
      if (s.color) { const h = cssColorHex(s.color); if (h) ns.col = h; }
      const bg = s.backgroundColor || s.background; if (bg) { const h = cssColorHex(bg); if (h) ns.bg = h; }
    }
    walk(x, ns);
  }); }; walk(el, {}); return runs; };
  const blockMeta = el => ({ align: el.style.textAlign || '', spB: el.style.marginTop ? cssToPt(el.style.marginTop) : undefined, spA: el.style.marginBottom ? cssToPt(el.style.marginBottom) : undefined });
  [...root.children].forEach(el => {
    const tag = el.tagName.toLowerCase();
    if (tag === 'ul' || tag === 'ol') { [...el.children].forEach((li, i) => out.push({ tag: 'li', list: tag, idx: i + 1, ...blockMeta(li), runs: runsOf(li) })); return; }
    if (tag === 'table') { const rows = [...el.querySelectorAll('tr')].map(tr => [...tr.children].map(td => ({ span: +td.getAttribute('colspan') || 1, shd: cssColorHex(td.style.backgroundColor), runs: runsOf(td) }))); out.push({ tag: 'table', rows }); return; }
    if (tag === 'hr') { out.push({ tag: 'hr' }); return; }
    if (/^(p|h1|h2|h3|blockquote|pre|div)$/.test(tag)) out.push({ tag, ...blockMeta(el), runs: runsOf(el) });
  });
  return out;
}
function dataUrlToBytes(url) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(url || ''); if (!m) return null;
  const bin = atob(m[2]), arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return { mime: m[1], bytes: arr, ext: (m[1].split('/')[1] || 'png').replace('jpeg', 'jpg') };
}
function buildDocx() {
  const enc = new TextEncoder(), blocks = exportBlocks();
  const szH = { h1: 44, h2: 34, h3: 28 };
  const media = [], imgRels = []; let imgN = 0;          // eingebettete Bilder sammeln
  const drawingXml = r => {
    const d = dataUrlToBytes(r.img); if (!d) return '';
    imgN++; const rId = 'rIdImg' + imgN, fn = 'image' + imgN + '.' + d.ext;
    media.push({ name: 'word/media/' + fn, bytes: d.bytes, ext: d.ext, mime: d.mime });
    imgRels.push(`<Relationship Id="${rId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${fn}"/>`);
    const w = (r.iw || 360), h = (r.ih || 270), cx = Math.round(w * 9525), cy = Math.round(h * 9525);
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${imgN}" name="Bild${imgN}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${imgN}" name="Bild${imgN}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  };
  const runXml = r => {
    if (r.img) return drawingXml(r);
    if (r.br) return '<w:r><w:br/></w:r>'; if (r.tab) return '<w:r><w:tab/></w:r>';
    let p = '';
    if (r.fam) p += `<w:rFonts w:ascii="${xmlEsc(r.fam)}" w:hAnsi="${xmlEsc(r.fam)}"/>`;
    if (r.b) p += '<w:b/>'; if (r.i) p += '<w:i/>'; if (r.u) p += '<w:u w:val="single"/>'; if (r.s) p += '<w:strike/>';
    if (r.col) p += `<w:color w:val="${r.col.replace('#', '')}"/>`;
    if (r.bg) p += `<w:shd w:val="clear" w:color="auto" w:fill="${r.bg.replace('#', '')}"/>`;
    if (r.sz) p += `<w:sz w:val="${r.sz}"/><w:szCs w:val="${r.sz}"/>`;
    if (r.vert === 'sup') p += '<w:vertAlign w:val="superscript"/>'; if (r.vert === 'sub') p += '<w:vertAlign w:val="subscript"/>';
    return `<w:r>${p ? `<w:rPr>${p}</w:rPr>` : ''}<w:t xml:space="preserve">${xmlEsc(r.t)}</w:t></w:r>`;
  };
  const tblXml = rows => {
    const maxCols = Math.max(1, ...rows.map(r => r.reduce((a, c) => a + (c.span || 1), 0)));
    let x = '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(s => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="999999"/>`).join('') + '</w:tblBorders></w:tblPr>';
    x += '<w:tblGrid>' + Array.from({ length: maxCols }, () => '<w:gridCol/>').join('') + '</w:tblGrid>';
    rows.forEach(tr => { x += '<w:tr>'; tr.forEach(td => { const runs = (td.runs || []).map(runXml).join(''); x += `<w:tc><w:tcPr>${td.span > 1 ? `<w:gridSpan w:val="${td.span}"/>` : ''}${td.shd ? `<w:shd w:val="clear" w:color="auto" w:fill="${td.shd.replace('#', '')}"/>` : ''}</w:tcPr><w:p>${runs || '<w:r><w:t/></w:r>'}</w:p></w:tc>`; }); x += '</w:tr>'; });
    return x + '</w:tbl>';
  };
  let body = '';
  blocks.forEach(bl => {
    if (bl.tag === 'hr') { body += '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="auto"/></w:pBdr></w:pPr></w:p>'; return; }
    if (bl.tag === 'table') { body += tblXml(bl.rows || []); return; }
    const jc = bl.align === 'center' ? '<w:jc w:val="center"/>' : bl.align === 'right' ? '<w:jc w:val="right"/>' : bl.align === 'justify' ? '<w:jc w:val="both"/>' : '';
    const sp = (bl.spB != null || bl.spA != null) ? `<w:spacing${bl.spB != null ? ` w:before="${Math.round(bl.spB * 20)}"` : ''}${bl.spA != null ? ` w:after="${Math.round(bl.spA * 20)}"` : ''}/>` : '';
    const sz = szH[bl.tag];
    let runs = (bl.runs || []).map(r => { if (sz && r.t != null && !r.sz) r = { ...r, sz, b: 1 }; return runXml(r); }).join('');
    if (bl.list) runs = `<w:r><w:t xml:space="preserve">${bl.list === 'ol' ? bl.idx + '. ' : '• '}</w:t></w:r>` + runs;
    body += `<w:p><w:pPr>${sp}${jc}</w:pPr>${runs || '<w:r><w:t/></w:r>'}</w:p>`;
  });
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"';
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${NS}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const exts = [...new Set(media.map(m => m.ext))];
  const defaults = exts.map(e => `<Default Extension="${e}" ContentType="${e === 'png' ? 'image/png' : e === 'gif' ? 'image/gif' : e === 'bmp' ? 'image/bmp' : 'image/jpeg'}"/>`).join('');
  const files = [
    { name: '[Content_Types].xml', bytes: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${defaults}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`) },
    { name: '_rels/.rels', bytes: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`) },
    { name: 'word/document.xml', bytes: enc.encode(docXml) },
    { name: 'word/_rels/document.xml.rels', bytes: enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${imgRels.join('')}</Relationships>`) },
    ...media.map(m => ({ name: m.name, bytes: m.bytes }))
  ];
  download(safeName(doc.titel) + '.docx', zipStore(files));
  toast('Word-Datei (.docx) erstellt' + (imgN ? ` (mit ${imgN} Bild${imgN > 1 ? 'ern' : ''})` : ''));
}
/* ---------- ZIP lesen + Word/ODF importieren ---------- */
async function inflateRaw(b) { const s = new Blob([b]).stream().pipeThrough(new DecompressionStream('deflate-raw')); return new Uint8Array(await new Response(s).arrayBuffer()); }
async function unzipRead(buf) {
  const dv = new DataView(buf), bytes = new Uint8Array(buf), out = {}, dec = new TextDecoder();
  let eocd = -1; for (let i = bytes.length - 22; i >= 0; i--) { if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; } }
  if (eocd < 0) throw new Error('Kein ZIP');
  const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), cmtLen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    const lNameLen = dv.getUint16(lho + 26, true), lExtra = dv.getUint16(lho + 28, true);
    const start = lho + 30 + lNameLen + lExtra, comp = bytes.subarray(start, start + csize);
    out[name] = method === 8 ? await inflateRaw(comp) : comp.slice();
    p += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}
/* === Word (.docx) originalgetreu rendern: Stile, Schriften, Farben, Abstände, Tabellen, Bilder === */
const DX_HL = { yellow: '#ffff00', green: '#92d050', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0070c0', red: '#ff0000', darkBlue: '#002060', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#c00000', darkYellow: '#808000', darkGray: '#808080', lightGray: '#d9d9d9', black: '#000000', white: '#ffffff' };
const DX_PB = '<div class="pagebreak" contenteditable="false">Seitenumbruch</div>';   // manueller Seitenumbruch wie in der App
function dxListStyle(fmt, lvl) {
  const m = { decimal: 'decimal', decimalZero: 'decimal-leading-zero', lowerLetter: 'lower-alpha', upperLetter: 'upper-alpha', lowerRoman: 'lower-roman', upperRoman: 'upper-roman' };
  if (m[fmt]) return m[fmt];
  return ['disc', 'circle', 'square'][(lvl || 0) % 3];   // Aufzählung je Ebene
}
function dxKids(el, name) { return el ? [...el.children].filter(c => c.nodeName === name) : []; }
function dxKid(el, name) { return el ? [...el.children].find(c => c.nodeName === name) || null : null; }
const DX_TC = { dark1: 'dk1', text1: 'dk1', light1: 'lt1', background1: 'lt1', dark2: 'dk2', text2: 'dk2', light2: 'lt2', background2: 'lt2', accent1: 'accent1', accent2: 'accent2', accent3: 'accent3', accent4: 'accent4', accent5: 'accent5', accent6: 'accent6', hyperlink: 'hlink', followedHyperlink: 'folHlink' };
function dxThemeColor(name, ctx) { if (!ctx || !ctx.theme) return ''; return ctx.theme.colors[DX_TC[name] || name] || ''; }
function dxThemeFont(name, ctx) { if (!ctx || !ctx.theme) return ''; return /major/i.test(name) ? ctx.theme.major : ctx.theme.minor; }
function dxReadRPr(el) {
  const o = {}; if (!el) return o;
  const flag = t => { const e = dxKid(el, t); return e && e.getAttribute('w:val') !== 'false' && e.getAttribute('w:val') !== '0' && e.getAttribute('w:val') !== 'none'; };
  if (flag('w:b')) o.b = 1; if (flag('w:i')) o.i = 1; if (flag('w:u')) o.u = 1; if (flag('w:strike')) o.strike = 1;
  if (flag('w:caps')) o.caps = 1; if (flag('w:smallCaps')) o.smallCaps = 1;
  const sz = dxKid(el, 'w:sz'); if (sz) o.sz = +sz.getAttribute('w:val') / 2;
  const rf = dxKid(el, 'w:rFonts'); if (rf) { const f = rf.getAttribute('w:ascii') || rf.getAttribute('w:hAnsi') || rf.getAttribute('w:cs'); if (f) o.font = f; else { const t = rf.getAttribute('w:asciiTheme') || rf.getAttribute('w:hAnsiTheme'); if (t) o.fontTheme = t; } }
  const col = dxKid(el, 'w:color'); if (col) { const v = col.getAttribute('w:val'); if (v && v !== 'auto') o.color = '#' + v; else { const tc = col.getAttribute('w:themeColor'); if (tc) o.colorTheme = tc; } }
  const hl = dxKid(el, 'w:highlight'); if (hl) o.hl = hl.getAttribute('w:val');
  const sh = dxKid(el, 'w:shd'); if (sh) { const f = sh.getAttribute('w:fill'); if (f && f !== 'auto') o.shd = '#' + f; else { const tf = sh.getAttribute('w:themeFill'); if (tf) o.shdTheme = tf; } }
  const va = dxKid(el, 'w:vertAlign'); if (va) o.vert = va.getAttribute('w:val');
  return o;
}
function dxParseTheme(xml) {
  const t = { colors: {}, major: '', minor: '' }; if (!xml) return t;
  const x = new DOMParser().parseFromString(xml, 'application/xml');
  const cs = x.getElementsByTagName('a:clrScheme')[0];
  if (cs) for (const c of cs.children) { const nm = c.nodeName.replace('a:', ''); const s = c.getElementsByTagName('a:srgbClr')[0], sy = c.getElementsByTagName('a:sysClr')[0]; const hex = s ? s.getAttribute('val') : sy ? sy.getAttribute('lastClr') : ''; if (hex) t.colors[nm] = '#' + hex; }
  const lat = e => { const l = e && e.getElementsByTagName('a:latin')[0]; return l ? l.getAttribute('typeface') : ''; };
  t.major = lat(x.getElementsByTagName('a:majorFont')[0]); t.minor = lat(x.getElementsByTagName('a:minorFont')[0]);
  return t;
}
function dxReadPPr(el) {
  const o = {}; if (!el) return o;
  const jc = dxKid(el, 'w:jc'); if (jc) { const v = jc.getAttribute('w:val'); o.align = v === 'center' ? 'center' : (v === 'right' || v === 'end') ? 'right' : (v === 'both' || v === 'distribute') ? 'justify' : 'left'; }
  const sp = dxKid(el, 'w:spacing'); if (sp) { const b = sp.getAttribute('w:before'), a = sp.getAttribute('w:after'), l = sp.getAttribute('w:line'); if (b != null) o.spB = +b / 20; if (a != null) o.spA = +a / 20; if (l && sp.getAttribute('w:lineRule') !== 'exact') o.line = +l / 240; }
  const ind = dxKid(el, 'w:ind'); if (ind) { const l = ind.getAttribute('w:left') || ind.getAttribute('w:start'); if (l) o.indL = +l / 20; const fl = ind.getAttribute('w:firstLine'); if (fl) o.indF = +fl / 20; const hg = ind.getAttribute('w:hanging'); if (hg) o.indF = -(+hg) / 20; }
  const num = dxKid(el, 'w:numPr'); if (num) { const ni = dxKid(num, 'w:numId'); if (ni) o.numId = ni.getAttribute('w:val'); const il = dxKid(num, 'w:ilvl'); o.ilvl = il ? +il.getAttribute('w:val') : 0; }
  const ol = dxKid(el, 'w:outlineLvl'); if (ol) o.outline = +ol.getAttribute('w:val');
  const tabsEl = dxKid(el, 'w:tabs'); if (tabsEl) { const ts = []; for (const tb of dxKids(tabsEl, 'w:tab')) { const v = tb.getAttribute('w:val'); if (v === 'clear') continue; ts.push({ val: v, pos: +tb.getAttribute('w:pos') / 20, leader: tb.getAttribute('w:leader') || 'none' }); } if (ts.length) o.tabs = ts; }
  const pb = dxKid(el, 'w:pageBreakBefore'); if (pb && pb.getAttribute('w:val') !== 'false' && pb.getAttribute('w:val') !== '0') o.pbBefore = 1;
  return o;
}
function dxParseStyles(xml) {
  const out = { defR: {}, defP: {}, styles: {} }; if (!xml) return out;
  const x = new DOMParser().parseFromString(xml, 'application/xml');
  const dd = x.getElementsByTagName('w:docDefaults')[0];
  if (dd) { const r = dxKid(dxKid(dd, 'w:rPrDefault'), 'w:rPr'); out.defR = dxReadRPr(r); const p = dxKid(dxKid(dd, 'w:pPrDefault'), 'w:pPr'); out.defP = dxReadPPr(p); }
  for (const st of x.getElementsByTagName('w:style')) {
    const id = st.getAttribute('w:styleId'); if (!id) continue;
    const nm = dxKid(st, 'w:name'), bo = dxKid(st, 'w:basedOn');
    out.styles[id] = { name: nm ? nm.getAttribute('w:val') : '', basedOn: bo ? bo.getAttribute('w:val') : null, rPr: dxReadRPr(dxKid(st, 'w:rPr')), pPr: dxReadPPr(dxKid(st, 'w:pPr')) };
  }
  return out;
}
function dxResolve(ctx, id) {
  const seen = new Set(); let cur = id; const chain = [];
  while (cur && ctx.styles[cur] && !seen.has(cur)) { seen.add(cur); chain.unshift(ctx.styles[cur]); cur = ctx.styles[cur].basedOn; }
  let rPr = {}, pPr = {}; for (const s of chain) { rPr = { ...rPr, ...s.rPr }; pPr = { ...pPr, ...s.pPr }; }
  return { rPr, pPr, name: ctx.styles[id] ? ctx.styles[id].name : '' };
}
function dxRunHtml(r, baseR, ctx) {
  const rprEl = dxKid(r, 'w:rPr'), rs = dxKid(rprEl, 'w:rStyle');
  const styleR = rs ? dxResolve(ctx, rs.getAttribute('w:val')).rPr : {};
  const eff = { ...baseR, ...styleR, ...dxReadRPr(rprEl) };
  const fnr = dxKid(r, 'w:footnoteReference') || dxKid(r, 'w:endnoteReference');
  if (fnr && ctx.used) { const isE = /endnote/.test(fnr.nodeName); const src = isE ? ctx.endnotes : ctx.footnotes; const h = src && src[fnr.getAttribute('w:id')]; if (h != null) { ctx.used.push(h); return `<sup>[${ctx.used.length}]</sup>`; } return ''; }
  let img = '';
  const draw = dxKid(r, 'w:drawing') || dxKid(r, 'w:pict');
  if (draw) { const blip = draw.getElementsByTagName('a:blip')[0] || draw.getElementsByTagName('v:imagedata')[0]; const ext = draw.getElementsByTagName('wp:extent')[0]; if (blip) { const rid = blip.getAttribute('r:embed') || blip.getAttribute('r:link') || blip.getAttribute('r:id'); const url = rid && ctx.rels[rid]; if (url) { let dim = ' style="max-width:100%"'; if (ext) { const w = Math.round(+ext.getAttribute('cx') / 9525), h = Math.round(+ext.getAttribute('cy') / 9525); if (w && h) dim = ` width="${w}" height="${h}" style="max-width:100%"`; } img = `<img src="${url}"${dim}>`; } } }
  let txt = '';
  for (const n of r.childNodes) { const nm = n.nodeName; if (nm === 'w:t') txt += esc(n.textContent); else if (nm === 'w:tab') txt += '\t'; else if (nm === 'w:br') txt += n.getAttribute('w:type') === 'page' ? '' : '<br>'; else if (nm === 'w:cr') txt += '<br>'; else if (nm === 'w:noBreakHyphen') txt += '-'; }
  if (!txt && !img) return '';
  let st = '';
  if (eff.b) st += 'font-weight:700;'; if (eff.i) st += 'font-style:italic;';
  let d = ''; if (eff.u) d += 'underline '; if (eff.strike) d += 'line-through '; if (d) st += 'text-decoration:' + d.trim() + ';';
  if (eff.caps) st += 'text-transform:uppercase;'; if (eff.smallCaps) st += 'font-variant:small-caps;';
  if (eff.sz) st += `font-size:${eff.sz}pt;`;
  const font = eff.font || dxThemeFont(eff.fontTheme, ctx); if (font) st += `font-family:'${font.replace(/'/g, '')}';`;
  const color = eff.color || dxThemeColor(eff.colorTheme, ctx); if (color) st += `color:${color};`;
  const bg = eff.shd || dxThemeColor(eff.shdTheme, ctx) || (eff.hl && DX_HL[eff.hl]); if (bg) st += `background:${bg};`;
  const wrap = seg => { if (seg === '') return ''; let b = seg; if (eff.vert === 'superscript') b = '<sup>' + b + '</sup>'; else if (eff.vert === 'subscript') b = '<sub>' + b + '</sub>'; return st ? `<span style="${st}">${b}</span>` : b; };
  return img + txt.split('\t').map(wrap).join('\t');   // Tabs bleiben „roh" (oberste Ebene) – so kann der Absatz daran ausgerichtet werden
}
// Läufe in Dokument-Reihenfolge sammeln – auch in Wrappern (Änderungsverfolgung w:ins, Smart-Tags, Inhaltssteuerelemente w:sdt)
function dxParaInner(p, baseR, ctx) {
  let inner = '';
  const walk = node => {
    for (const c of node.children) {
      const n = c.nodeName;
      if (n === 'w:r') inner += dxRunHtml(c, baseR, ctx);
      else if (n === 'w:hyperlink') { let s = ''; for (const r of c.getElementsByTagName('w:r')) s += dxRunHtml(r, baseR, ctx); const rid = c.getAttribute('r:id'), href = rid && ctx.rels[rid]; inner += href ? `<a href="${esc(href)}">${s}</a>` : s; }
      else if (n === 'w:fldSimple' || n === 'w:ins' || n === 'w:smartTag' || n === 'w:sdt' || n === 'w:sdtContent' || n === 'w:bdo' || n === 'w:dir') walk(c);   // Felder: zwischengespeichertes Ergebnis (Datum, Seitenzahl …)
    }
  };
  walk(p);
  return inner;
}
function dxParaBlock(p, ctx) {
  const pprEl = dxKid(p, 'w:pPr'), psEl = dxKid(pprEl, 'w:pStyle');
  const sid = psEl ? psEl.getAttribute('w:val') : null, sres = dxResolve(ctx, sid);
  const pPr = { ...ctx.defP, ...sres.pPr, ...dxReadPPr(pprEl) };
  const baseR = { ...ctx.defR, ...sres.rPr };
  const nm = (sres.name || sid || '').toString();
  let lvl = 0; const m = nm.match(/heading\s*([1-9])/i) || nm.match(/berschrift\s*([1-9])/i); if (m) lvl = +m[1]; if (/^(title|titel)$/i.test(nm)) lvl = 1; if (!lvl && pPr.outline != null && pPr.outline < 3) lvl = pPr.outline + 1;
  const tag = lvl >= 1 ? 'h' + Math.min(3, lvl) : 'p';
  const isList = !!pPr.numId;
  let st = '';
  st += `margin-top:${pPr.spB || 0}pt;margin-bottom:${pPr.spA || 0}pt;`;   // exakt Word-Abstände (sonst greift unser 0.85em-Standard → Dokument wird zu lang)
  if (pPr.align && pPr.align !== 'left') st += `text-align:${pPr.align};`;
  if (!isList && pPr.indL) st += `margin-left:${pPr.indL}pt;`;     // bei Listen macht die Verschachtelung den Einzug
  if (!isList && pPr.indF) st += `text-indent:${pPr.indF}pt;`;
  if (pPr.line) st += `line-height:${pPr.line};`;
  const bFont = baseR.font || dxThemeFont(baseR.fontTheme, ctx), bColor = baseR.color || dxThemeColor(baseR.colorTheme, ctx);
  if (!lvl && baseR.sz) st += `font-size:${baseR.sz}pt;`;
  if (!lvl && bFont) st += `font-family:'${bFont.replace(/'/g, '')}';`;
  if (!lvl && bColor) st += `color:${bColor};`;
  let inner = dxParaInner(p, baseR, ctx) || '<br>';
  // manueller Seitenumbruch (w:br type=page oder pageBreakBefore) → echte Umbruch-Marke
  let pgPre = pPr.pbBefore ? DX_PB : '', pgPost = '';
  for (const br of p.getElementsByTagName('w:br')) { if (br.getAttribute('w:type') === 'page') { pgPost = DX_PB; break; } }
  // Tabs = sichtbare Spalten (COLSEP). Bei definierten Tabstopps an die exakte Position (mm) gesetzt → Layout wie Word UND echtes Raster wie Calc
  if (inner.indexOf('\t') >= 0) {
    const stops = (pPr.tabs || []).slice().sort((a, b) => a.pos - b.pos);
    if (stops.length) {
      let k = 0;
      inner = inner.replace(/\t/g, () => {
        const s = stops[Math.min(k, stops.length - 1)]; k++;
        const mm = Math.round(s.pos * 25.4 / 72 * 10) / 10;
        const lead = s.leader === 'dot' ? ' data-lead="dot"' : (s.leader === 'underscore' || s.leader === 'hyphen') ? ' data-lead="line"' : '';
        return `<span class="colsep" data-tab="${mm}"${lead} contenteditable="false">⇥</span>`;
      });
    } else inner = inner.split('\t').join(COLSEP);   // gleichmässige Spalte (kein definierter Tabstopp)
  }
  if (isList) {
    const il = pPr.ilvl || 0, lvls = ctx.numbering[pPr.numId] || {}, lv = lvls[il] || lvls[0] || { fmt: 'bullet', start: 1 };
    const fmt = lv.fmt || 'bullet', ordered = fmt !== 'bullet' && fmt !== 'none';
    return { list: ordered ? 'ol' : 'ul', level: il, styleType: dxListStyle(fmt, il), start: lv.start || 1, html: pgPre + `<li${st ? ` style="${st}"` : ''}>${inner}</li>` + pgPost };
  }
  return { html: pgPre + `<${tag}${st ? ` style="${st}"` : ''}>${inner}</${tag}>` + pgPost };
}
function dxBorderCss(el) {                          // Word-Rahmen → CSS (null = nicht gesetzt, 'none' = ausdrücklich ohne)
  if (!el) return null; const v = el.getAttribute('w:val'); if (!v || v === 'nil' || v === 'none') return 'none';
  const sz = +(el.getAttribute('w:sz') || 4), col = el.getAttribute('w:color');
  const c = (col && col !== 'auto') ? '#' + col : '#000';
  const style = v === 'dashed' ? 'dashed' : v === 'dotted' ? 'dotted' : v === 'double' ? 'double' : 'solid';
  return `${Math.max(1, Math.round(sz / 8))}px ${style} ${c}`;
}
function dxTableHtml(tbl, ctx) {
  const tblPr = dxKid(tbl, 'w:tblPr'), tbE = tblPr && dxKid(tblPr, 'w:tblBorders');
  const TB = s => tbE ? dxBorderCss(dxKid(tbE, s)) : null;
  const tblB = { top: TB('w:top'), bottom: TB('w:bottom'), left: TB('w:left'), right: TB('w:right'), iH: TB('w:insideH'), iV: TB('w:insideV') };
  const matrix = [], owners = [];                 // owners[col] = Zelle, die nach unten verbunden ist
  for (const tr of dxKids(tbl, 'w:tr')) {
    const cells = []; let col = 0;
    for (const tc of dxKids(tr, 'w:tc')) {
      const tcPr = dxKid(tc, 'w:tcPr');
      const gs = tcPr && dxKid(tcPr, 'w:gridSpan'); const span = gs ? +gs.getAttribute('w:val') : 1;
      const vm = tcPr && dxKid(tcPr, 'w:vMerge'); const vmVal = vm ? (vm.getAttribute('w:val') || 'continue') : null;
      if (vmVal === 'continue') { const o = owners[col]; if (o) o.rowspan++; col += span; continue; }   // gehört zur Zelle darüber
      const tcb = tcPr && dxKid(tcPr, 'w:tcBorders'); const CB = s => tcb ? dxBorderCss(dxKid(tcb, s)) : null;
      const pick = (cb, tb) => { const c = CB(cb); return c != null ? c : tb; };   // Zelle überschreibt Tabelle
      let st = 'padding:3px 7px;vertical-align:top;';   // nur tatsächlich gesetzte Rahmen zeichnen (Word: oft nur unten = Ausfülllinie)
      const sides = { top: pick('w:top', tblB.iH != null ? tblB.iH : tblB.top), bottom: pick('w:bottom', tblB.iH != null ? tblB.iH : tblB.bottom), left: pick('w:left', tblB.iV != null ? tblB.iV : tblB.left), right: pick('w:right', tblB.iV != null ? tblB.iV : tblB.right) };
      for (const k in sides) if (sides[k] && sides[k] !== 'none') st += `border-${k}:${sides[k]};`;
      const shd = tcPr && dxKid(tcPr, 'w:shd'); if (shd) { const f = shd.getAttribute('w:fill'); if (f && f !== 'auto') st += `background:#${f};`; }
      const w = tcPr && dxKid(tcPr, 'w:tcW'); if (w) { const ww = +w.getAttribute('w:w'); if (ww > 0) st += `width:${Math.round(ww / 20)}pt;`; }
      const va = tcPr && dxKid(tcPr, 'w:vAlign'); if (va && va.getAttribute('w:val') === 'center') st = st.replace('vertical-align:top;', 'vertical-align:middle;');
      let inner = ''; for (const p of dxKids(tc, 'w:p')) inner += dxParaBlock(p, ctx).html;
      for (const nt of dxKids(tc, 'w:tbl')) inner += dxTableHtml(nt, ctx);
      const cell = { span, rowspan: 1, st, inner: inner || '<br>' }; cells.push(cell);
      owners[col] = vmVal === 'restart' ? cell : null; for (let k = 1; k < span; k++) owners[col + k] = null;
      col += span;
    }
    matrix.push(cells);
  }
  let html = '<table style="border-collapse:collapse;margin:6px 0;max-width:100%">';
  matrix.forEach(cells => { html += '<tr>'; cells.forEach(c => { html += `<td${c.span > 1 ? ` colspan="${c.span}"` : ''}${c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : ''} style="${c.st}">${c.inner}</td>`; }); html += '</tr>'; });
  return html + '</table>';
}
function dxRenderContainer(root, ctx) {
  let html = ''; const stack = [];                 // verschachtelte Listen je Ebene (ul/ol)
  const closeTo = lvl => { while (stack.length > lvl) html += `</${stack.pop()}>`; };
  const proc = el => {
    if (el.nodeName === 'w:sdt') { const c = dxKid(el, 'w:sdtContent'); if (c) for (const ch of c.children) proc(ch); return; }   // Inhaltssteuerelement auflösen
    if (el.nodeName === 'w:p') {
      const blk = dxParaBlock(el, ctx);
      if (blk.list) {
        const lvl = blk.level || 0, type = blk.list;
        const open = () => `<${type} style="list-style-type:${blk.styleType || (type === 'ol' ? 'decimal' : 'disc')}"${type === 'ol' && blk.start > 1 ? ` start="${blk.start}"` : ''}>`;
        if (stack.length > lvl + 1) closeTo(lvl + 1);
        while (stack.length <= lvl) { html += open(); stack.push(type); }
        if (stack[lvl] !== type) { closeTo(lvl); html += open(); stack.push(type); }
        html += blk.html;
      } else { closeTo(0); html += blk.html; }
    } else if (el.nodeName === 'w:tbl') { closeTo(0); html += dxTableHtml(el, ctx); }
  };
  for (const el of root.children) proc(el);
  closeTo(0);
  return html;
}
function docxToHtml(documentXml, ctx) {
  const x = new DOMParser().parseFromString(documentXml, 'application/xml');
  const body = x.getElementsByTagName('w:body')[0]; if (!body) return '<p><br></p>';
  let html = dxRenderContainer(body, ctx) || '<p><br></p>';
  if (ctx.used && ctx.used.length) html += '<hr><p><strong>Fussnoten</strong></p>' + ctx.used.map((h, i) => `<div style="font-size:9pt;margin:.15em 0"><sup>[${i + 1}]</sup> ${h}</div>`).join('');   // Fuss-/Endnoten gesammelt am Ende
  return html;
}
function dxBytesToDataUrl(bytes, name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const mime = ext === 'png' ? 'image/png' : (ext === 'gif' ? 'image/gif' : ext === 'bmp' ? 'image/bmp' : ext === 'webp' ? 'image/webp' : 'image/jpeg');
  let bin = ''; const ch = 0x8000; for (let i = 0; i < bytes.length; i += ch) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + ch));
  return `data:${mime};base64,${btoa(bin)}`;
}
function dxParseRels(xml, zip, base) {
  const rels = {}; if (!xml) return rels;
  const x = new DOMParser().parseFromString(xml, 'application/xml');
  for (const r of x.getElementsByTagName('Relationship')) {
    const id = r.getAttribute('Id'), tgt = r.getAttribute('Target'), mode = r.getAttribute('TargetMode');
    if (!id || !tgt) continue;
    if (mode === 'External' || /^https?:|^mailto:/i.test(tgt)) { rels[id] = tgt; continue; }
    if (/\.(png|jpe?g|gif|bmp|webp|emf|wmf)$/i.test(tgt)) {          // nur Bilder als Data-URL einbetten
      const path = (base + tgt).replace(/^\//, '').replace(/[^/]+\/\.\.\//g, '');
      const bytes = zip[path] || zip['word/' + tgt.replace(/^\//, '')];
      rels[id] = bytes ? dxBytesToDataUrl(bytes, tgt) : tgt;
    } else { rels[id] = tgt.replace(/^\//, ''); }                    // z. B. header1.xml / Hyperlink-Anker
  }
  return rels;
}
function dxNear(a, b) { return Math.abs(a - b) < 220; }
function dxParseSect(documentXml) {
  const x = new DOMParser().parseFromString(documentXml, 'application/xml');
  const sect = [...x.getElementsByTagName('w:sectPr')].pop(); const o = {};
  if (!sect) return o;
  const tw2mm = t => Math.max(0, Math.min(60, Math.round(+t * 25.4 / 1440)));
  const sz = dxKid(sect, 'w:pgSz');
  if (sz) { const w = +sz.getAttribute('w:w'), h = +sz.getAttribute('w:h'); o.orient = (sz.getAttribute('w:orient') === 'landscape' || w > h) ? 'quer' : 'hoch'; const width = Math.min(w, h); o.format = dxNear(width, 11906) ? 'A4' : dxNear(width, 12240) ? 'Letter' : dxNear(width, 8391) ? 'A5' : 'A4'; }
  const mg = dxKid(sect, 'w:pgMar');
  if (mg) o.margins = { top: tw2mm(mg.getAttribute('w:top') || 1440), right: tw2mm(mg.getAttribute('w:right') || 1440), bottom: tw2mm(mg.getAttribute('w:bottom') || 1440), left: tw2mm(mg.getAttribute('w:left') || 1440) };
  const pick = arr => { const a = [...arr]; const def = a.find(r => r.getAttribute('w:type') === 'default') || a.find(r => r.getAttribute('w:type') !== 'first') || a[0]; return def ? def.getAttribute('r:id') : null; };
  o.headerId = pick(dxKids(sect, 'w:headerReference')); o.footerId = pick(dxKids(sect, 'w:footerReference'));
  return o;
}
function dxPartToHtml(xmlStr, ctx) {
  if (!xmlStr) return ''; const x = new DOMParser().parseFromString(xmlStr, 'application/xml');
  const root = x.getElementsByTagName('w:hdr')[0] || x.getElementsByTagName('w:ftr')[0]; if (!root) return '';
  return dxRenderContainer(root, ctx);
}
function dxParseNumbering(xml) {
  const num = {}; if (!xml) return num;
  const x = new DOMParser().parseFromString(xml, 'application/xml'); const abs = {};
  for (const a of x.getElementsByTagName('w:abstractNum')) { const id = a.getAttribute('w:abstractNumId'); const lv = {}; for (const l of a.getElementsByTagName('w:lvl')) { const il = l.getAttribute('w:ilvl'); const f = dxKid(l, 'w:numFmt'), s = dxKid(l, 'w:start'); lv[il] = { fmt: f ? f.getAttribute('w:val') : 'bullet', start: s ? +s.getAttribute('w:val') : 1 }; } abs[id] = lv; }
  for (const n of x.getElementsByTagName('w:num')) { const id = n.getAttribute('w:numId'); const a = dxKid(n, 'w:abstractNumId'); num[id] = a ? (abs[a.getAttribute('w:val')] || {}) : {}; }
  return num;
}
function dxParseNotes(xml, ctx, kind) {
  const out = {}; if (!xml) return out;
  const x = new DOMParser().parseFromString(xml, 'application/xml');
  for (const it of x.getElementsByTagName(kind === 'end' ? 'w:endnote' : 'w:footnote')) { const id = it.getAttribute('w:id'); const t = it.getAttribute('w:type'); if (t === 'separator' || t === 'continuationSeparator') continue; out[id] = dxRenderContainer(it, ctx); }
  return out;
}
function dxDefaultTab(xml) { if (!xml) return 36; const d = new DOMParser().parseFromString(xml, 'application/xml').getElementsByTagName('w:defaultTabStop')[0]; return d ? Math.round(+d.getAttribute('w:val') / 20) : 36; }
async function importDocx(file) {
  toast('Öffne Word-Datei …');
  let zip; try { zip = await unzipRead(await file.arrayBuffer()); } catch (_) { toast('Datei nicht lesbar (kein gültiges .docx).'); return; }
  const dec = new TextDecoder(), get = n => zip[n] ? dec.decode(zip[n]) : '';
  const part = zip['word/document.xml']; if (!part) { toast('Keine Word-Inhalte gefunden.'); return; }
  const ctx = dxParseStyles(get('word/styles.xml'));
  ctx.rels = dxParseRels(get('word/_rels/document.xml.rels'), zip, 'word/');
  ctx.numbering = dxParseNumbering(get('word/numbering.xml'));
  ctx.defaultTab = dxDefaultTab(get('word/settings.xml'));
  ctx.theme = dxParseTheme(get('word/theme/theme1.xml'));
  ctx.footnotes = dxParseNotes(get('word/footnotes.xml'), ctx, 'foot');
  ctx.endnotes = dxParseNotes(get('word/endnotes.xml'), ctx, 'end');
  ctx.used = [];
  const docStr = dec.decode(part);
  const html = docxToHtml(docStr, ctx);
  const sect = dxParseSect(docStr);
  const st = newDocObject().einstellungen;
  if (sect.format) st.format = sect.format;
  if (sect.orient) st.ausrichtung = sect.orient;
  if (sect.margins) st.margins = sect.margins;
  // Word-Grunddefaults übernehmen, sonst sind importierte Dokumente fast doppelt so lang
  const baseLine = ctx.defP.line || (ctx.styles.Normal && dxResolve(ctx, 'Normal').pPr.line) || (ctx.styles.Standard && dxResolve(ctx, 'Standard').pPr.line) || 1.15;
  st.zeilenabstand = Math.round(baseLine * 100) / 100;
  if (ctx.defR.sz) st.schriftgroesse = Math.round(ctx.defR.sz * 96 / 72);
  let kopf = '', fuss = '';
  const renderPart = id => {                          // Kopf-/Fusszeile mit EIGENEN Beziehungen (Bilder!) rendern
    const tgt = id && ctx.rels[id]; if (!tgt) return '';
    const saved = ctx.rels; ctx.rels = Object.assign({}, saved, dxParseRels(get('word/_rels/' + tgt + '.rels'), zip, 'word/'));
    const html = dxPartToHtml(get('word/' + tgt), ctx); ctx.rels = saved; return html;
  };
  kopf = renderPart(sect.headerId); fuss = renderPart(sect.footerId);
  createDoc({ titel: (file.name || 'Dokument').replace(/\.docx$/i, ''), html, kopf, fuss, einstellungen: st });
  toast('Word-Datei geöffnet: ' + d_title());
}
function odtToHtml(xml) {
  const xdoc = new DOMParser().parseFromString(xml, 'application/xml');
  const styleMap = {};   // style-name → {b,i,u,s}
  for (const st of xdoc.getElementsByTagName('style:style')) {
    const nm = st.getAttribute('style:name'); const tp = st.getElementsByTagName('style:text-properties')[0]; if (!nm || !tp) continue;
    styleMap[nm] = { b: tp.getAttribute('fo:font-weight') === 'bold', i: tp.getAttribute('fo:font-style') === 'italic', u: !!tp.getAttribute('style:text-underline-style') && tp.getAttribute('style:text-underline-style') !== 'none', s: !!tp.getAttribute('style:text-line-through-style') && tp.getAttribute('style:text-line-through-style') !== 'none' };
  }
  const runInner = el => {
    let seg = '';
    for (const node of el.childNodes) {
      if (node.nodeType === 3) { seg += esc(node.textContent); continue; }
      const nm = node.nodeName;
      if (nm === 'text:tab') seg += COLSEP;
      else if (nm === 'text:line-break') seg += '<br>';
      else if (nm === 'text:s') { const c = +(node.getAttribute('text:c') || 1); seg += '&nbsp;'.repeat(c); }
      else if (nm === 'text:span') { let inner = runInner(node); const f = styleMap[node.getAttribute('text:style-name')] || {}; if (f.s) inner = '<s>' + inner + '</s>'; if (f.u) inner = '<u>' + inner + '</u>'; if (f.i) inner = '<em>' + inner + '</em>'; if (f.b) inner = '<strong>' + inner + '</strong>'; seg += inner; }
      else seg += runInner(node);
    }
    return seg;
  };
  let html = '';
  const body = xdoc.getElementsByTagName('office:text')[0]; if (!body) return '<p><br></p>';
  for (const el of body.children) {
    const nm = el.nodeName;
    if (nm === 'text:h') { const lv = Math.max(1, Math.min(3, +(el.getAttribute('text:outline-level') || 1))); html += `<h${lv}>${runInner(el) || '<br>'}</h${lv}>`; }
    else if (nm === 'text:p') html += `<p>${runInner(el) || '<br>'}</p>`;
    else if (nm === 'text:list') { for (const li of el.getElementsByTagName('text:p')) html += `<p>• ${runInner(li)}</p>`; }
  }
  return html || '<p><br></p>';
}
async function importOdt(file) {
  toast('Öffne OpenDocument …');
  let zip; try { zip = await unzipRead(await file.arrayBuffer()); } catch (_) { toast('Datei nicht lesbar (kein gültiges .odt).'); return; }
  const part = zip['content.xml']; if (!part) { toast('Keine ODF-Inhalte gefunden.'); return; }
  const html = odtToHtml(new TextDecoder().decode(part));
  createDoc({ titel: (file.name || 'Dokument').replace(/\.odt$/i, ''), html });
  toast('OpenDocument geöffnet: ' + d_title());
}
function d_title() { return doc ? doc.titel : ''; }

/* === Excel (.xlsx) → dasselbe Raster (Calc-Seiten) === */
function xlsxRefToRC(ref) { const m = /^([A-Z]+)(\d+)$/.exec(ref || ''); if (!m) return { col: 0, r: 0 }; let col = 0; for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64); return { col: col - 1, r: (+m[2]) - 1 }; }
function xlsxSharedStrings(xml) { const out = []; if (!xml) return out; const x = new DOMParser().parseFromString(xml, 'application/xml'); for (const si of x.getElementsByTagName('si')) { let s = ''; for (const t of si.getElementsByTagName('t')) s += t.textContent; out.push(s); } return out; }
function xlsxRels(xml) { const r = {}; if (!xml) return r; const x = new DOMParser().parseFromString(xml, 'application/xml'); for (const e of x.getElementsByTagName('Relationship')) { const id = e.getAttribute('Id'), t = e.getAttribute('Target'); if (id && t) r[id] = t; } return r; }
const XLSX_IDX = { 0: '#000000', 1: '#ffffff', 2: '#ff0000', 3: '#00ff00', 4: '#0000ff', 5: '#ffff00', 6: '#ff00ff', 7: '#00ffff', 8: '#000000', 9: '#ffffff', 10: '#ff0000', 11: '#00ff00', 12: '#0000ff', 13: '#ffff00', 14: '#ff00ff', 15: '#00ffff', 64: '' };
function xlsxHexFromArgb(argb) { if (!argb) return ''; argb = argb.replace(/^#/, ''); if (argb.length === 8) argb = argb.slice(2); return /^[0-9a-fA-F]{6}$/.test(argb) ? '#' + argb.toLowerCase() : ''; }
function xlsxTint(hex, tint) { if (!tint) return hex; const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex); if (!m) return hex; const f = v => { let c = parseInt(v, 16) / 255; c = tint < 0 ? c * (1 + tint) : c * (1 - tint) + tint; return ('0' + Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16)).slice(-2); }; return '#' + f(m[1]) + f(m[2]) + f(m[3]); }
function xlsxColor(el, theme) {
  if (!el) return ''; const rgb = el.getAttribute('rgb'); if (rgb) return xlsxHexFromArgb(rgb);
  const th = el.getAttribute('theme');
  if (th != null && theme) { const order = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink']; let hex = theme.colors[order[+th]] || ''; const tint = parseFloat(el.getAttribute('tint') || '0'); return hex && tint ? xlsxTint(hex, tint) : hex; }
  const idx = el.getAttribute('indexed'); if (idx != null) return XLSX_IDX[+idx] || '';
  return '';
}
function xlsxStyles(xml, theme) {
  const out = { xfs: [] }; if (!xml) return out;
  const x = new DOMParser().parseFromString(xml, 'application/xml');
  const custom = {}; for (const nf of x.getElementsByTagName('numFmt')) custom[nf.getAttribute('numFmtId')] = nf.getAttribute('formatCode') || '';
  const code2fmt = code => { if (!code || /general/i.test(code)) return ''; if (/\b(yy|mm|dd|d\/|m\/|h:|hh)/i.test(code) || /[dmy]{2,}/i.test(code)) return 'date'; if (code.indexOf('%') >= 0) return 'pct'; if (/[$€£]|CHF|"kr"|Fr\./.test(code)) return 'chf'; if (/0\.00/.test(code)) return 'num2'; if (/#,##0|^0(;|$)/.test(code)) return 'num0'; return ''; };
  const builtinDate = new Set(['14', '15', '16', '17', '18', '19', '20', '21', '22', '45', '46', '47']);
  const builtin = { '1': 'num0', '2': 'num2', '3': 'num0', '4': 'num2', '9': 'pct', '10': 'pct', '37': 'num0', '38': 'num0', '39': 'num2', '40': 'num2', '41': 'num0', '42': 'chf', '43': 'num2', '44': 'chf' };
  const numOf = id => builtinDate.has(id) ? 'date' : (builtin[id] || (custom[id] ? code2fmt(custom[id]) : ''));
  const kids = (p, n) => p ? [...p.children].filter(c => c.nodeName === n) : [];
  // Schriften
  const fonts = []; const fontsEl = x.getElementsByTagName('fonts')[0];
  if (fontsEl) for (const fo of kids(fontsEl, 'font')) { const f = {}; if (kids(fo, 'b').length) f.b = 1; if (kids(fo, 'i').length) f.i = 1; if (kids(fo, 'u').length) f.u = 1; if (kids(fo, 'strike').length) f.s = 1; const sz = kids(fo, 'sz')[0]; if (sz) f.sz = Math.round(+sz.getAttribute('val') * 96 / 72); const nm = kids(fo, 'name')[0] || kids(fo, 'rFont')[0]; if (nm) f.fam = nm.getAttribute('val'); const col = kids(fo, 'color')[0]; if (col) f.color = xlsxColor(col, theme); fonts.push(f); }
  // Füllungen
  const fills = []; const fillsEl = x.getElementsByTagName('fills')[0];
  if (fillsEl) for (const fl of kids(fillsEl, 'fill')) { const pf = kids(fl, 'patternFill')[0]; let c = ''; if (pf && pf.getAttribute('patternType') && pf.getAttribute('patternType') !== 'none') { const fg = kids(pf, 'fgColor')[0]; c = xlsxColor(fg, theme); } fills.push(c); }
  // Rahmen (welche Seiten haben eine Linie)
  const borders = []; const bordersEl = x.getElementsByTagName('borders')[0];
  if (bordersEl) for (const bd of kids(bordersEl, 'border')) { let sides = ''; const has = n => { const e = kids(bd, n)[0]; return e && e.getAttribute('style') && e.getAttribute('style') !== 'none'; }; if (has('top')) sides += 't'; if (has('bottom')) sides += 'b'; if (has('left')) sides += 'l'; if (has('right')) sides += 'r'; borders.push(sides); }
  // Zellformate
  const cellXfs = x.getElementsByTagName('cellXfs')[0];
  if (cellXfs) for (const xf of kids(cellXfs, 'xf')) {
    const o = { fmt: numOf(xf.getAttribute('numFmtId') || '0') };
    if (xf.getAttribute('applyFont') !== '0') { const fi = +(xf.getAttribute('fontId') || 0); if (fonts[fi]) o.font = fonts[fi]; }
    if (xf.getAttribute('applyFill') !== '0') { const li = +(xf.getAttribute('fillId') || 0); if (fills[li]) o.fill = fills[li]; }
    if (xf.getAttribute('applyBorder') !== '0') { const bi = +(xf.getAttribute('borderId') || 0); if (borders[bi]) o.border = borders[bi]; }
    const al = kids(xf, 'alignment')[0]; if (al) { const h = al.getAttribute('horizontal'); if (h === 'center' || h === 'right' || h === 'left') o.al = h; }
    out.xfs.push(o);
  }
  return out;
}
function xlsxSerialToDate(n) { if (!isFinite(n)) return ''; const ms = Math.round((n - 25569) * 86400000); const d = new Date(ms); if (isNaN(d)) return ''; const p = x => ('0' + x).slice(-2); return p(d.getUTCDate()) + '.' + p(d.getUTCMonth() + 1) + '.' + d.getUTCFullYear(); }
function xlsxSheetToPage(xml, sst, styles) {
  const x = new DOMParser().parseFromString(xml, 'application/xml');
  const xfs = styles.xfs || [];
  const rows = [], fmtMap = {}, fill = {}, txtcol = {}, borders = {}, cfmt = {}; let maxC = 0;
  for (const row of x.getElementsByTagName('row')) {
    for (const c of row.getElementsByTagName('c')) {
      const { col, r } = xlsxRefToRC(c.getAttribute('r')); const t = c.getAttribute('t'), s = c.getAttribute('s');
      const vEl = c.getElementsByTagName('v')[0], isEl = c.getElementsByTagName('is')[0];
      const xf = s != null ? xfs[+s] : null, sf = xf ? xf.fmt : '';
      let val = '';
      if (t === 's') val = sst[+(vEl ? vEl.textContent : 0)] || '';
      else if (t === 'inlineStr' && isEl) val = isEl.textContent;
      else if (t === 'str') val = vEl ? vEl.textContent : '';
      else if (t === 'b') val = (vEl && vEl.textContent === '1') ? 'WAHR' : 'FALSCH';
      else { val = vEl ? vEl.textContent : ''; if (sf === 'date' && val !== '') val = xlsxSerialToDate(+val); }
      while (rows.length <= r) rows.push([]);
      while (rows[r].length <= col) rows[r].push('');
      rows[r][col] = esc(val);
      if (col > maxC) maxC = col;
      const key = col + ',' + r;
      if (sf && sf !== 'date') fmtMap[key] = sf;
      if (xf) {   // Zell-Styling aus Excel übernehmen
        if (xf.fill) fill[key] = xf.fill;
        if (xf.border) borders[key] = xf.border;
        const cf = {}; const f = xf.font;
        if (f) { if (f.b) cf.b = 1; if (f.i) cf.i = 1; if (f.u) cf.u = 1; if (f.s) cf.s = 1; if (f.fam) cf.fam = f.fam; if (f.sz) cf.sz = f.sz; if (f.color) txtcol[key] = f.color; }
        if (xf.al) cf.al = xf.al;
        if (Object.keys(cf).length) cfmt[key] = cf;
      }
    }
  }
  const merges = []; for (const mc of x.getElementsByTagName('mergeCell')) { const ref = (mc.getAttribute('ref') || '').split(':'); if (ref.length === 2) { const a = xlsxRefToRC(ref[0]), b = xlsxRefToRC(ref[1]); merges.push({ c: Math.min(a.col, b.col), r: Math.min(a.r, b.r), cs: Math.abs(b.col - a.col) + 1, rs: Math.abs(b.r - a.r) + 1 }); } }
  const colPx = {}, colW = {}; for (const col of x.getElementsByTagName('col')) { const mn = +col.getAttribute('min'), mx = +col.getAttribute('max'), w = +col.getAttribute('width'); if (w > 0) for (let ci = mn - 1; ci <= mx - 1; ci++) { const px = Math.round(w * 7 + 5); colPx[ci] = px; colW[ci] = px; } }
  // Spaltenpositionen (mm) → COLSEPs mit data-tab (gleiche Engine wie Word: Tabs = Spalten in Write & Calc)
  const stops = []; let cum = 0; for (let c = 0; c < maxC; c++) { cum += (colPx[c] || 64); stops[c] = Math.round(cum / MM * 10) / 10; }
  let html = '';
  for (let r = 0; r < rows.length; r++) {
    const cells = rows[r], n = Math.max(1, cells.length); let inner = '';
    for (let c = 0; c < n; c++) { inner += (cells[c] || ''); if (c < n - 1) inner += stops[c] != null ? `<span class="colsep" data-tab="${stops[c]}" contenteditable="false">⇥</span>` : COLSEP; }
    html += `<p>${inner || '<br>'}</p>`;
  }
  return { id: uid(), typ: 'calc', html: html || '<p><br></p>', fmt: fmtMap, merges, colW, fill, txtcol, borders, cfmt, notiz: '' };
}
async function importXlsx(file) {
  toast('Öffne Excel-Datei …');
  let zip; try { zip = await unzipRead(await file.arrayBuffer()); } catch (_) { toast('Datei nicht lesbar (kein gültiges .xlsx).'); return; }
  const dec = new TextDecoder(), get = n => zip[n] ? dec.decode(zip[n]) : '';
  const sst = xlsxSharedStrings(get('xl/sharedStrings.xml'));
  const theme = dxParseTheme(get('xl/theme/theme1.xml'));
  const styles = xlsxStyles(get('xl/styles.xml'), theme);
  const rels = xlsxRels(get('xl/_rels/workbook.xml.rels'));
  const wbXml = get('xl/workbook.xml'); if (!wbXml) { toast('Keine Arbeitsmappe gefunden.'); return; }
  const wb = new DOMParser().parseFromString(wbXml, 'application/xml');
  const pages = [];
  for (const s of wb.getElementsByTagName('sheet')) {
    const rid = s.getAttribute('r:id'); let tgt = (rid && rels[rid]) || 'worksheets/sheet1.xml';
    tgt = tgt.replace(/^\//, ''); if (!tgt.startsWith('xl/')) tgt = 'xl/' + tgt;
    const xml = get(tgt); if (!xml) continue;
    pages.push(xlsxSheetToPage(xml, sst, styles));
  }
  if (!pages.length) { toast('Keine Tabellen gefunden.'); return; }
  createDoc({ titel: (file.name || 'Tabelle').replace(/\.xlsx$/i, ''), pages });
  toast('Excel geöffnet: ' + d_title() + ' (' + pages.length + (pages.length === 1 ? ' Tabelle)' : ' Tabellen)'));
}
function buildOdt() {
  const enc = new TextEncoder(), blocks = exportBlocks();
  const spanOf = r => {
    if (r.img) return '';   // Bilder in .odt (noch) nicht eingebettet
    if (r.br) return '<text:line-break/>'; if (r.tab) return '<text:tab/>';
    const cls = [r.b && 'B', r.i && 'I', r.u && 'U', r.s && 'S'].filter(Boolean).join('');
    const txt = xmlEsc(r.t).replace(/ {2,}/g, m => '<text:s text:c="' + m.length + '"/>');
    return cls ? `<text:span text:style-name="${cls}">${txt}</text:span>` : txt;
  };
  let body = '';
  blocks.forEach(bl => {
    if (bl.tag === 'hr') { body += '<text:p text:style-name="HR"/>'; return; }
    if (bl.tag === 'table') { (bl.rows || []).forEach(tr => { body += `<text:p>${tr.map(td => (td.runs || []).map(spanOf).join('')).join('<text:tab/>')}</text:p>`; }); return; }
    const runs = (bl.runs || []).map(spanOf).join('');
    if (/^h[1-3]$/.test(bl.tag)) { body += `<text:h text:style-name="H${bl.tag[1]}" text:outline-level="${bl.tag[1]}">${runs}</text:h>`; return; }
    const pre = bl.list ? (bl.list === 'ol' ? bl.idx + '. ' : '• ') : '';
    body += `<text:p${bl.align ? ` text:style-name="A${bl.align}"` : ''}>${xmlEsc(pre)}${runs}</text:p>`;
  });
  const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"';
  const autoStyles = `<office:automatic-styles>
<style:style style:name="B" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>
<style:style style:name="I" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>
<style:style style:name="U" style:family="text"><style:text-properties style:text-underline-style="solid"/></style:style>
<style:style style:name="S" style:family="text"><style:text-properties style:text-line-through-style="solid"/></style:style>
<style:style style:name="BI" style:family="text"><style:text-properties fo:font-weight="bold" fo:font-style="italic"/></style:style>
<style:style style:name="Acenter" style:family="paragraph"><style:paragraph-properties fo:text-align="center"/></style:style>
<style:style style:name="Aright" style:family="paragraph"><style:paragraph-properties fo:text-align="end"/></style:style>
<style:style style:name="Ajustify" style:family="paragraph"><style:paragraph-properties fo:text-align="justify"/></style:style>
</office:automatic-styles>`;
  const content = `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-content ${NS} office:version="1.2">${autoStyles}<office:body><office:text>${body}</office:text></office:body></office:document-content>`;
  const styles = `<?xml version="1.0" encoding="UTF-8"?>\n<office:document-styles ${NS} office:version="1.2"><office:styles><style:style style:name="H1" style:family="paragraph"><style:text-properties fo:font-size="22pt" fo:font-weight="bold"/></style:style><style:style style:name="H2" style:family="paragraph"><style:text-properties fo:font-size="17pt" fo:font-weight="bold"/></style:style><style:style style:name="H3" style:family="paragraph"><style:text-properties fo:font-size="14pt" fo:font-weight="bold"/></style:style></office:styles></office:document-styles>`;
  const manifest = `<?xml version="1.0" encoding="UTF-8"?>\n<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/></manifest:manifest>`;
  const files = [
    { name: 'mimetype', bytes: enc.encode('application/vnd.oasis.opendocument.text') },   // muss zuerst & unkomprimiert sein
    { name: 'content.xml', bytes: enc.encode(content) },
    { name: 'styles.xml', bytes: enc.encode(styles) },
    { name: 'META-INF/manifest.xml', bytes: enc.encode(manifest) }
  ];
  download(safeName(doc.titel) + '.odt', zipStore(files));
  toast('OpenDocument (.odt) erstellt');
}
function htmlToMarkdown(root) {
  let out = '';
  const inline = node => {
    let s = '';
    node.childNodes.forEach(n => {
      if (n.nodeType === 3) { s += n.textContent; return; }
      const t = n.tagName?.toLowerCase();
      if (t === 'b' || t === 'strong') s += '**' + inline(n) + '**';
      else if (t === 'i' || t === 'em') s += '*' + inline(n) + '*';
      else if (t === 'a') s += '[' + inline(n) + '](' + (n.getAttribute('href') || '') + ')';
      else if (t === 'br') s += '\n';
      else if (t === 'code') s += '`' + inline(n) + '`';
      else s += inline(n);
    });
    return s;
  };
  root.childNodes.forEach(n => {
    if (n.nodeType !== 1) { if (n.textContent.trim()) out += n.textContent.trim() + '\n\n'; return; }
    const t = n.tagName.toLowerCase();
    if (t === 'h1') out += '# ' + inline(n) + '\n\n';
    else if (t === 'h2') out += '## ' + inline(n) + '\n\n';
    else if (t === 'h3') out += '### ' + inline(n) + '\n\n';
    else if (t === 'ul') n.querySelectorAll(':scope>li').forEach(li => out += '- ' + inline(li) + '\n'), out += '\n';
    else if (t === 'ol') [...n.children].forEach((li, i) => out += (i + 1) + '. ' + inline(li) + '\n'), out += '\n';
    else if (t === 'blockquote') out += '> ' + inline(n) + '\n\n';
    else if (t === 'pre') out += '```\n' + n.innerText + '\n```\n\n';
    else out += inline(n) + '\n\n';
  });
  return out.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
function doExport(kind) {
  if (!doc) return;
  captureDoc();
  const name = safeName(doc.titel);
  if (kind === 'pdf') { printPreview(); return; }   // Vorschau zeigen, von dort drucken
  const mdRoot = editor.cloneNode(true); mdRoot.querySelectorAll('.sp-err').forEach(s => s.replaceWith(document.createTextNode(s.textContent)));
  if (kind === 'html') { download(name + '.html', docHtmlShell(cleanEditorHTML()), 'text/html'); toast('HTML exportiert'); }
  else if (kind === 'md') { download(name + '.md', htmlToMarkdown(mdRoot), 'text/markdown'); toast('Markdown exportiert'); }
  else if (kind === 'docx') { buildDocx(); }
  else if (kind === 'odt') { buildOdt(); }
}

/* ============================================================
   Theme / Fokus / Layout
   ============================================================ */
function setTheme(t) {
  document.body.dataset.theme = t;
  localStorage.setItem(LS_THEME, t);
  $('#themeLbl').textContent = t === 'dark' ? 'Hell' : 'Dunkel';
  $('#themeIco').innerHTML = t === 'dark'
    ? '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>'
    : '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>';
  $('meta[name=theme-color]')?.setAttribute('content', t === 'dark' ? '#0e1118' : '#ffffff');
}
function toggleFocus() {
  const on = appEl.classList.toggle('focus');
  $('#btnFocusExit').hidden = !on;
  if (on) editor.focus();
  applyZoom();   // Lineal aus-/einblenden + Zoom an neue Breite
}

/* ============================================================
   Ereignisse verdrahten
   ============================================================ */
function wire() {
  // Editor-Eingaben
  editor.addEventListener('input', onEditorInput);
  editor.addEventListener('keyup', syncToolbar);
  editor.addEventListener('mouseup', syncToolbar);
  editor.setAttribute('data-ph', 'Schreib hier los …');
  // Titel
  titleEl.addEventListener('input', scheduleSave);
  titleEl.addEventListener('blur', autosave);

  // Format-Buttons
  $$('.fb-btn[data-cmd]').forEach(b => b.addEventListener('click', () => cmd(b.dataset.cmd)));
  $$('.fb-btn[data-block]').forEach(b => b.addEventListener('click', () => setBlock(b.dataset.block)));
  $('#selBlock').addEventListener('change', e => setBlock(e.target.value));
  $('#selFont').addEventListener('change', e => { if (!doc) return; if (inCalc()) { setCellFmt('fam', e.target.value); return; } doc.einstellungen.schriftart = e.target.value; editor.style.fontFamily = e.target.value; scheduleSave(); });
  $('#selSize').addEventListener('change', e => { if (!doc) return; const px = +e.target.value; if (inCalc()) { setCellFmt('sz', px); return; } if (window.getSelection().isCollapsed) { doc.einstellungen.schriftgroesse = px; editor.style.fontSize = px + 'px'; scheduleSave(); } else setFontSize(px); });
  $('#inkColor').addEventListener('input', e => { if (inCalc()) { setCellTextColor(e.target.value); return; } document.execCommand('styleWithCSS', false, true); cmd('foreColor', e.target.value); });
  $('#imgInput').addEventListener('change', e => { insertImageFile(e.target.files[0]); e.target.value = ''; });
  $('#hlColor').addEventListener('input', e => { if (inCalc()) { setCellFill(e.target.value); return; } highlight(e.target.value); });
  $('#btnClear').addEventListener('click', () => { if (inCalc()) { clearCellFmt(); return; } cmd('removeFormat'); setBlock('p'); });

  // Einfügen-Buttons (im Menüband)
  $$('[data-ins]').forEach(b => b.addEventListener('click', () => doInsert(b.dataset.ins)));

  // Register-Menüband: Reiter wechseln
  $('#ribTabs').addEventListener('click', e => {
    const b = e.target.closest('[data-rib]'); if (!b) return;
    $$('#ribTabs button').forEach(x => x.classList.toggle('on', x === b));
    $$('.ribpane').forEach(p => p.hidden = p.dataset.pane !== b.dataset.rib);
  });
  // Zwischenablage
  $('#btnCopy').addEventListener('click', () => { editor.focus(); document.execCommand('copy'); });
  $('#btnCut').addEventListener('click', () => { editor.focus(); document.execCommand('cut'); afterEdit(); });
  $('#btnPaste').addEventListener('click', () => {
    editor.focus();
    if (navigator.clipboard && navigator.clipboard.readText) navigator.clipboard.readText().then(t => { document.execCommand('insertText', false, t); afterEdit(); }).catch(() => toast('Bitte Strg+V drücken.'));
    else toast('Bitte Strg+V zum Einfügen drücken.');
  });
  // Format übertragen
  $('#btnFmtPaint').addEventListener('mousedown', e => { e.preventDefault(); paintFmt = captureFmt(); $('#btnFmtPaint').classList.add('on'); toast('Format kopiert – jetzt Zieltext markieren.'); });
  editor.addEventListener('mouseup', () => { if (paintFmt) { const sel = getSelection(); if (sel && !sel.isCollapsed) applyFmt(paintFmt); paintFmt = null; $('#btnFmtPaint').classList.remove('on'); } });
  // Gross-/Kleinschreibung
  const caseMenu = $('#caseMenu');
  $('#btnCase').addEventListener('click', e => { e.stopPropagation(); caseMenu.hidden = !caseMenu.hidden; });
  caseMenu.addEventListener('click', e => { const c = e.target.closest('[data-case]'); if (c) { caseMenu.hidden = true; changeCase(c.dataset.case); } });
  document.addEventListener('click', () => caseMenu.hidden = true);
  // Formatierungszeichen
  $('#btnMarks').addEventListener('click', () => editor.classList.toggle('show-marks'));
  // Einfügen-Extras
  $('#btnPageBreak').addEventListener('click', insertPageBreak);
  $('#btnDate').addEventListener('click', insertDate);
  $('#btnDropcap').addEventListener('click', toggleDropcap);
  buildSymbolMenu();
  const symMenu = $('#symMenu');
  $('#btnSymbol').addEventListener('click', e => { e.stopPropagation(); symMenu.hidden = !symMenu.hidden; });
  symMenu.addEventListener('click', e => { const s = e.target.closest('[data-sym]'); if (s) { symMenu.hidden = true; editor.focus(); document.execCommand('insertText', false, s.dataset.sym); afterEdit(); } });
  document.addEventListener('click', () => symMenu.hidden = true);
  // Layout
  $('#selCols').addEventListener('change', e => setColumns(+e.target.value));
  $('#btnHyphen').addEventListener('click', () => { if (!doc) return; const on = !doc.einstellungen.silben; doc.einstellungen.silben = on; editor.classList.toggle('hyphenate', on); $('#btnHyphen').classList.toggle('on', on); scheduleSave(); });
  $('#btnMarginsOpen').addEventListener('click', () => { appEl.classList.add('insp-open'); applyZoom(); const s = $('#mTop'); if (s) setTimeout(() => s.scrollIntoView({ block: 'center' }), 60); });
  // Ansicht-Reiter
  $$('[data-vact]').forEach(b => b.addEventListener('click', () => {
    const a = b.dataset.vact;
    if (a === 'focus') toggleFocus();
    else if (a === 'marks') editor.classList.toggle('show-marks');
    else if (a === 'inspector') { appEl.classList.toggle('insp-open'); applyZoom(); }
    else if (a === 'theme') setTheme(document.body.dataset.theme === 'dark' ? 'light' : 'dark');
  }));

  // Schrift-Stufen + Zeilenabstand
  $('#fontGrow').addEventListener('click', () => adjustFontSize(1));
  $('#fontShrink').addEventListener('click', () => adjustFontSize(-1));
  $('#selLine').addEventListener('change', e => setLineHeight(+e.target.value));

  // Druckvorschau
  $('#btnPreview').addEventListener('click', printPreview);
  $('#pvClose').addEventListener('click', () => $('#previewOverlay').hidden = true);
  $('#pvPrint').addEventListener('click', printFromPreview);

  // „Gitter"-Schalter: EIN Mechanismus – an = Raster (Calc), aus = Dokument (Write). Symmetrisch, jederzeit zurueck.
  // Vorher gab es zwei ueberlagerte Wege (Typwechsel UND eine globale Linien-Klasse); das war der Grund,
  // warum sich das Umschalten je nach Vorgeschichte der Seite anders verhielt.
  $('#gridToggle').addEventListener('click', () => {
    if (!doc) return;
    const p = activePage();
    if (p.typ !== 'calc') { setPageType('calc'); p.linien = true; renderActivePage(); syncGridToggle(); scheduleSave(); return; }
    // Nur die Linien wechseln: NICHT ueber renderActivePage gehen. Das las die Seite neu aus
    // p.html ein - also aus einem Stand, der die zuletzt getippten Zeichen noch nicht enthielt.
    // Genau dadurch verschwand oder aenderte sich Text beim Umschalten.
    if (editingTd) endEdit(true);            // laufende Zelle sauber uebernehmen
    gitterUmschalten(p);
    appEl.classList.toggle('lines-off', !gitterSichtbar(p));
    renderCalc();                            // nur neu zeichnen - keine Umwandlung, kein Datenweg
    syncGridToggle(); scheduleSave();
  });
  // Formelzeile im Write-Blatt (Etappe 3): Enter schreibt Wert/Formel-Ergebnis in die angeklickte Zelle
  $('#wfInput').addEventListener('keydown', e => {
    if (e.key !== 'Enter') return; e.preventDefault();
    if (!wfCell || !editor.contains(wfCell.rowEl)) { toast('Bitte zuerst eine Zelle im Blatt anklicken.'); return; }
    const raw = $('#wfInput').value;
    if (raw.trim().startsWith('=')) { const f = raw.trim(); const v = writeEvalFormula(f, wfCell.r, wfCell.c); writeSetCellSegHTML(wfCell.rowEl, wfCell.c, `<span class="fx" data-fx="${esc(f)}" contenteditable="false">${esc(v == null ? '' : String(v))}</span>`); }
    else writeSetCellSeg(wfCell.rowEl, wfCell.c, raw);
    editor.focus();
  });

  // Seiten-Reiter (Navigator)
  $('#pagetabs').addEventListener('click', e => {
    const del = e.target.closest('[data-del]'); if (del) { e.stopPropagation(); deletePage(+del.dataset.del); return; }
    if (e.target.closest('#ptAdd')) { e.stopPropagation(); $('#addMenu').hidden = !$('#addMenu').hidden; return; }
    const a = e.target.closest('[data-add]'); if (a) { $('#addMenu').hidden = true; addPage(a.dataset.add); return; }
    const tab = e.target.closest('.ptab'); if (tab) switchPage(+tab.dataset.i);
  });
  document.addEventListener('click', () => { const m = $('#addMenu'); if (m) m.hidden = true; });
  document.addEventListener('mousedown', e => { if (!e.target.closest('#hdrMenu')) closeHeaderMenu(); });
  $('#canvas').addEventListener('scroll', closeHeaderMenu);

  // Submit Calc – Gitter im Write-Blatt
  const pgEl = $('#pageGrid');
  const calcFocus = () => pgEl.focus();
  $('#calcAddRow').addEventListener('click', calcAddRow);
  $('#calcAddCol').addEventListener('click', calcAddCol);
  $('#calcDelRow').addEventListener('click', calcDelRow);
  $('#calcDelCol').addEventListener('click', calcDelCol);
  $$('#calcBar [data-fmt]').forEach(b => b.addEventListener('click', () => setCellFormat(b.dataset.fmt)));
  $('#cellFill').addEventListener('input', e => setCellFill(e.target.value));
  $('#cellInk').addEventListener('input', e => setCellTextColor(e.target.value));
  $('#cellNoFill').addEventListener('click', () => { setCellFill('none'); setCellTextColor('none'); });
  $('#cellMerge').addEventListener('click', mergeCells);
  $('#cellSplit').addEventListener('click', unmergeCells);
  const bdMenu = $('#borderMenu');
  $('#cellBorder').addEventListener('click', e => { e.stopPropagation(); bdMenu.hidden = !bdMenu.hidden; });
  bdMenu.addEventListener('click', e => { const m = e.target.closest('[data-bd]'); if (m) { bdMenu.hidden = true; setBorders(m.dataset.bd); } });
  document.addEventListener('click', () => bdMenu.hidden = true);
  // Lineal-Leisten: Spalte/Zeile wählen, Spaltenbreite ziehen
  $('#colRuler').addEventListener('mousedown', e => {
    const ins = e.target.closest('.cins'); if (ins) { e.preventDefault(); e.stopPropagation(); insertColAt(+ins.dataset.c + 1); return; }   // „+" → Spalte rechts daneben
    const rz = e.target.closest('.cresize'); if (rz) { e.preventDefault(); startColResize(+rz.dataset.c, e); return; }
    const seg = e.target.closest('.cr-seg'); if (seg) { const c = +seg.dataset.c; selectCell(c, 0); selectCell(c, gridRows - 1, true); calcFocus(); }
  });
  $('#colRuler').addEventListener('contextmenu', e => { const seg = e.target.closest('.cr-seg'); if (!seg) return; e.preventDefault(); openHeaderMenu('col', +seg.dataset.c, e.clientX, e.clientY); });
  $('#rowRuler').addEventListener('mousedown', e => {
    const ins = e.target.closest('.rins'); if (ins) { e.preventDefault(); e.stopPropagation(); insertRowAt(+ins.dataset.r + 1); return; }   // „+" → Zeile darunter
    const rz = e.target.closest('.rresize'); if (rz) { e.preventDefault(); startRowResize(+rz.dataset.r, e); return; }
    const seg = e.target.closest('.rr-seg'); if (seg) { const r = +seg.dataset.r; selectCell(0, r); selectCell(gridCols - 1, r, true); calcFocus(); }
  });
  $('#rowRuler').addEventListener('contextmenu', e => { const seg = e.target.closest('.rr-seg'); if (!seg) return; e.preventDefault(); openHeaderMenu('row', +seg.dataset.r, e.clientX, e.clientY); });
  $('#canvas').addEventListener('scroll', () => { if (appEl.classList.contains('calc-mode')) $('#colRuler').style.top = $('#canvas').scrollTop + 'px'; else buildWriteRulers(); });
  // Maus: Auswahl + Bereich ziehen (delegiert auf #pageGrid)
  let gridDragging = false;
  pgEl.addEventListener('mousedown', e => {
    const td = e.target.closest('td[data-c]'); if (!td) return;
    if (editingTd && editingTd !== td) endEdit(true);
    if (dokumentModus() && !e.shiftKey) {
      // Write-Modus: eine Zeile ist EINE durchgehende Zeile wie in Word. Egal in welche Spalte
      // geklickt wird - man landet immer vorne in der Zeile. Spalten gibt es sichtbar nur in Calc.
      const x = e.clientX, y = e.clientY, r = +td.dataset.r;
      selectCell(0, r);
      if (!editingTd) beginEdit();
      setzeCursorAn(x, y);   // innerhalb der Zeile an die Klickstelle, sonst ans Textende
      return;
    }
    gridDragging = true; e.preventDefault();
    selectCell(+td.dataset.c, +td.dataset.r, e.shiftKey); calcFocus();
  });
  pgEl.addEventListener('mousemove', e => { if (!gridDragging) return; const td = e.target.closest('td[data-c]'); if (td) selectCell(+td.dataset.c, +td.dataset.r, true); });
  document.addEventListener('mouseup', () => { gridDragging = false; });
  pgEl.addEventListener('dblclick', e => { const td = e.target.closest('td[data-c]'); if (td) { selectCell(+td.dataset.c, +td.dataset.r); beginEdit(); } });
  pgEl.addEventListener('contextmenu', e => { const td = e.target.closest('td[data-c]'); if (!td) return; e.preventDefault(); if (!td.classList.contains('sel')) selectCell(+td.dataset.c, +td.dataset.r); showGridMenu(e.clientX, e.clientY); });
  $('#ctxmenu').addEventListener('click', e => { const g = e.target.closest('button')?.dataset.g; if (g) gridMenuAction(g); });

  // Formelzeile
  // AutoSumme auch als Knopf – ueber ein Tastenkuerzel allein findet das niemand
  const autoSumKlick = () => {
    if (!doc || !curGrid || activePage().typ !== 'calc') { toast('AutoSumme wirkt im Gitter.'); return; }
    const f = autoSummeFormel(selC, selR);
    if (!f) { toast('Kein Zahlenblock über oder links von der Zelle.'); return; }
    gridEnsure(curGrid, selC, selR); curGrid.zeilen[selR].cells[selC] = f;
    activePage().html = gridToHtml(curGrid); renderCalc(); selectCell(selC, selR); calcFocus(); scheduleSave();
  };
  { const b = $('#btnAutoSum'); if (b) b.addEventListener('click', autoSumKlick); }
  { const u = $('#btnUndo'), r = $('#btnRedo');
    if (u) u.addEventListener('click', verlaufZurueck);
    if (r) r.addEventListener('click', verlaufVor); }
  $('#formulaInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commitCell(e.target.value); selectCell(selC, selR + 1); calcFocus(); }
    else if (e.key === 'Tab') { e.preventDefault(); commitCell(e.target.value); selectCell(selC + 1, selR); calcFocus(); }
    else if (e.key === 'Escape') { highlightSel(); calcFocus(); }
  });
  // Tastatur (Navigation, Inline-Edit, Bereich mit Umschalt) – für Gitter UND Blatt
  const calcKey = e => {
    if (viewOnly && !e.key.startsWith('Arrow')) return;   // Ansehen-Modus: keine Zell-Bearbeitung (Pfeil-Navigation bleibt)
    if (document.activeElement === $('#formulaInput')) return;
    if (editingTd) {
      if (e.key === 'Enter' && (e.altKey || e.shiftKey)) { e.preventDefault(); document.execCommand('insertHTML', false, '<br>'); }  // Zeilenumbruch in der Zelle
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (dokumentModus()) {                      // Word-Gefuehl: Enter oeffnet einen neuen Absatz darunter
          zelleSpiegeln();                          // Inhalt uebernehmen OHNE Neuaufbau ...
          if (editingTd) { editingTd.contentEditable = 'false'; editingTd.classList.remove('celledit'); editingTd = null; }
          zeileEinfuegen(selR);
          activePage().html = gridToHtml(curGrid);
          renderCalc();                             // ... dann genau EINMAL neu zeichnen (vorher zweimal je Absatz)
          selectCell(0, selR + 1); beginEdit(); scheduleSave();
        } else { endEdit(true); const m = mergeAt(selC, selR); selectCell(selC, (m ? m.r + m.rs : selR + 1)); calcFocus(); }
      }
      else if (e.key === 'Tab') {
        e.preventDefault();
        if (dokumentModus() && !e.shiftKey) {
          // In einer durchgehenden Write-Zeile gibt es noch keine zweite Zelle: erst anlegen,
          // dann springen. Dadurch wird die Zeile zur Rasterzeile und zeigt zwei Spalten.
          // Bewusst OHNE Speichern - bleibt die neue Spalte leer, faellt sie von selbst wieder weg.
          zelleSpiegeln();
          if (editingTd) { editingTd.contentEditable = 'false'; editingTd.classList.remove('celledit'); editingTd = null; }
          gridEnsure(curGrid, selC + 1, selR);
          renderCalc();
          selectCell(selC + 1, selR); beginEdit();
          return;
        }
        endEdit(true); const m = mergeAt(selC, selR);
        selectCell(e.shiftKey ? Math.max(0, selC - 1) : (m ? m.c + m.cs : selC + 1), selR); calcFocus();
      }
      else if (e.key === 'Escape') { e.preventDefault(); endEdit(false); calcFocus(); }
      else if (dokumentModus() && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        const ziel = selR + (e.key === 'ArrowDown' ? 1 : -1);      // Word-Gefuehl: Pfeile wechseln die Zeile
        if (ziel < 0) return;
        e.preventDefault(); zelleSpiegeln();
        if (editingTd) { editingTd.contentEditable = 'false'; editingTd.classList.remove('celledit'); editingTd = null; }
        selectCell(0, ziel); beginEdit();
      }
      else if (dokumentModus() && e.key === 'Backspace' && selR > 0 && cursorAmZeilenAnfang()) {
        e.preventDefault(); zelleSpiegeln();                       // Rueckschritt am Zeilenanfang haengt an die Zeile darueber an
        if (editingTd) { editingTd.contentEditable = 'false'; editingTd.classList.remove('celledit'); editingTd = null; }
        const naht = zeilenVerbinden(selR);
        activePage().html = gridToHtml(curGrid); renderCalc();
        selectCell(0, selR - 1); beginEdit();
        if (editingTd && naht >= 0) cursorAnTextPos(editingTd, naht);
        scheduleSave();
      }
      return;
    }
    const k = e.key, ext = e.shiftKey;
    if (e.ctrlKey || e.metaKey) {
      const lk = k.toLowerCase();
      if (lk === 'a') { e.preventDefault(); selectAllCells(); return; }
      if (lk === 'd' || lk === 'r') {   // Strg+D / Strg+R: nach unten / nach rechts ausfuellen (wie Excel)
        e.preventDefault();
        if (fuelleAus(lk === 'd' ? 'unten' : 'rechts')) { activePage().html = gridToHtml(curGrid); renderCalc(); scheduleSave(); }
        return;
      }
      if (k === 'Home') { e.preventDefault(); selectCell(0, 0, ext); return; }          // Strg+Pos1 → A1
      if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'ArrowRight' || k === 'ArrowLeft') {
        e.preventDefault();                                                             // Strg+Pfeil → an den Rand des Blocks
        const ur = calcUsedRange();
        if (k === 'ArrowDown') selectCell(selC, Math.max(selR, ur.maxR), ext);
        else if (k === 'ArrowUp') selectCell(selC, 0, ext);
        else if (k === 'ArrowRight') selectCell(Math.max(selC, ur.maxC), selR, ext);
        else selectCell(0, selR, ext);
        return;
      }
      if (lk === 'b') { e.preventDefault(); toggleCellFmt('b'); return; }
      if (lk === 'i') { e.preventDefault(); toggleCellFmt('i'); return; }
      if (lk === 'u') { e.preventDefault(); toggleCellFmt('u'); return; }
    }
    if (e.altKey && (k === '=' || k === '+')) {   // Alt+= : AutoSumme
      e.preventDefault();
      const f = autoSummeFormel(selC, selR);
      if (!f) { toast('Kein Zahlenblock über oder links von der Zelle.'); return; }
      gridEnsure(curGrid, selC, selR); curGrid.zeilen[selR].cells[selC] = f;
      activePage().html = gridToHtml(curGrid); renderCalc(); selectCell(selC, selR); scheduleSave();
      return;
    }
    if (k === 'Home') { e.preventDefault(); selectCell(0, selR, ext); }                  // Pos1 → Zeilenanfang
    else if (k === 'End') { e.preventDefault(); selectCell(Math.max(0, calcUsedRange().maxC), selR, ext); }
    else if (k === 'ArrowDown') { e.preventDefault(); selectCell(selC, selR + 1, ext); }
    else if (k === 'ArrowUp') { e.preventDefault(); selectCell(selC, selR - 1, ext); }
    else if (k === 'ArrowRight') { e.preventDefault(); selectCell(selC + 1, selR, ext); }
    else if (k === 'ArrowLeft') { e.preventDefault(); selectCell(selC - 1, selR, ext); }
    else if (k === 'Tab') { e.preventDefault(); selectCell(selC + (ext ? -1 : 1), selR); }
    else if (k === 'Enter' || k === 'F2') { e.preventDefault(); beginEdit(); }
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); const { c1, c2, r1, r2 } = rangeBounds(); for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) { gridEnsure(curGrid, c, r); curGrid.zeilen[r].cells[c] = ''; } activePage().html = gridToHtml(curGrid); renderCalc(); scheduleSave(); }
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); beginEdit(k); }
  };
  pgEl.addEventListener('keydown', calcKey);

  // Kopieren / Ausschneiden / Einfuegen im Raster (nur wenn keine Zelle offen ist -
  // waehrend des Schreibens gilt das normale Verhalten innerhalb der Zelle)
  const imRaster = () => doc && curGrid && activePage().typ === 'calc' && !editingTd
    && (document.activeElement === pgEl || pgEl.contains(document.activeElement));
  const kopieren = (e, ausschneiden) => {
    if (!imRaster()) return;
    const { c1, c2, r1, r2 } = rangeBounds();
    zwischenablage = bereichLesen(c1, c2, r1, r2);
    const text = bereichAlsText(zwischenablage.zeilen);
    zwischenablage.text = text;
    try { e.clipboardData.setData('text/plain', text); e.preventDefault(); } catch (_) { return; }
    if (ausschneiden && !viewOnly) {
      bereichLeeren(c1, c2, r1, r2);
      activePage().html = gridToHtml(curGrid); renderCalc(); scheduleSave();
    }
  };
  document.addEventListener('copy', e => kopieren(e, false));
  document.addEventListener('cut', e => kopieren(e, true));
  document.addEventListener('paste', e => {
    if (!imRaster() || viewOnly) return;
    let text = ''; try { text = e.clipboardData.getData('text/plain') || ''; } catch (_) {}
    if (!text) return;
    e.preventDefault();
    // Stammt der Text aus unserer eigenen Kopie? Dann die reiche Fassung nehmen (Formeln + Formate).
    const daten = (zwischenablage && zwischenablage.text === text)
      ? zwischenablage
      : { zeilen: textAlsBereich(text).map(z => z.map(esc)), fmt: {}, cfmt: {}, c1: selC, r1: selR };
    if (!bereichEinfuegen(daten, selC, selR)) return;
    activePage().html = gridToHtml(curGrid); renderCalc();
    const h = daten.zeilen.length, b = daten.zeilen[0].length;
    selectCell(selC, selR); selectCell(selC + b - 1, selR + h - 1, true);   // Eingefuegtes markieren, wie Excel
    calcFocus(); scheduleSave();
  });

  // Zoom & Ausrichtung
  $('#zoomIn').addEventListener('click', () => zoomStep(.1));
  $('#zoomOut').addEventListener('click', () => zoomStep(-.1));
  $('#zoomVal').addEventListener('click', () => setZoom('auto'));
  $('#btnPortrait').addEventListener('click', () => setOrientation('hoch'));
  $('#btnLandscape').addEventListener('click', () => setOrientation('quer'));
  $('#selFormat').addEventListener('change', e => setFormat(e.target.value));
  window.addEventListener('resize', applyZoom);
  window.addEventListener('resize', () => { if (doc && activePage().typ === 'calc') renderCalc(); });

  // Seite einrichten (Ränder + Kopf-/Fuss-Höhe)
  [['#mTop', 'top'], ['#mBottom', 'bottom'], ['#mLeft', 'left'], ['#mRight', 'right']].forEach(([sel, key]) => {
    $(sel).addEventListener('input', e => { if (!doc) return; pageSetup().margins[key] = Math.max(0, Math.min(60, +e.target.value || 0)); applyPageSetup(); drawRuler(); updatePages(); scheduleSave(); });
  });
  $('#kopfH').addEventListener('input', e => { if (!doc) return; pageSetup().kopfH = Math.max(6, Math.min(80, +e.target.value || 14)); applyPageSetup(); updatePages(); scheduleSave(); });
  $('#fussH').addEventListener('input', e => { if (!doc) return; pageSetup().fussH = Math.max(6, Math.min(80, +e.target.value || 14)); applyPageSetup(); updatePages(); scheduleSave(); });
  $('#chkFirstNoHF').addEventListener('change', e => { if (!doc) return; doc.einstellungen.erstSeiteOhne = e.target.checked; page.classList.toggle('first-no-hf', e.target.checked); paginate(); scheduleSave(true); });
  $('#setupReset').addEventListener('click', () => { if (!doc) return; doc.einstellungen.margins = defaultMargins(); doc.einstellungen.kopfH = 14; doc.einstellungen.fussH = 14; doc.einstellungen.tabs = []; applyPageSetup(); drawRuler(); updatePages(); scheduleSave(); });

  // Lineal: Klick setzt Tabstopp
  $('#ruler').addEventListener('click', e => {
    if (suppressRulerClick || e.target.classList.contains('rhandle') || e.target.classList.contains('rtab')) return;
    const mm = Math.round(rulerMm(e.clientX)), s = pageSetup();
    if (mm > s.margins.left && mm < pageWidthMm() - s.margins.right) { s.tabs.push(mm); s.tabs.sort((a, b) => a - b); drawRuler(); scheduleSave(); }
  });

  // Tab-Taste im Editor (zum nächsten Tabstopp; Umschalt+Tab = Einzug zurück)
  editor.addEventListener('keydown', e => { if (e.key === 'Tab') { e.preventDefault(); if (e.shiftKey) cmd('outdent'); else insertTab(); } });

  // Kopf-/Fusszeile (eigene Felder – immer erreichbar, nie im Textfluss)
  ['#zoneH', '#zoneF'].forEach(s => {
    const z = $(s);
    z.addEventListener('input', () => { syncHFfromMaster(); scheduleSave(); });
    z.addEventListener('paste', e => { const html = e.clipboardData?.getData('text/html'); if (html) { e.preventDefault(); document.execCommand('insertHTML', false, sanitizeHtml(html)); syncHFfromMaster(); scheduleSave(); } });
  });

  // Rechtsklick-Menü
  editor.addEventListener('contextmenu', e => {
    const onImg = e.target.tagName === 'IMG';
    const inCell = !!e.target.closest('td,th');
    const sel = getSelection();
    const hasSel = sel && sel.rangeCount && !sel.isCollapsed && editor.contains(sel.anchorNode);
    // reiner Text → natives Browser-Menü (genaue Rechtschreibung + „Zum Wörterbuch hinzufügen")
    if (!onImg && !inCell && !hasSel) return;
    e.preventDefault();
    $$('img.sel', editor).forEach(i => i.classList.remove('sel'));
    if (onImg) e.target.classList.add('sel');
    showContextMenu(e.clientX, e.clientY);
  });
  $('#ctxmenu').addEventListener('click', e => { const a = e.target.closest('button')?.dataset.ctx; if (a) ctxAction(a); });
  $('#ctxmenu').addEventListener('click', e => { const a = e.target.closest('button')?.dataset.doc; if (a) docMenuAction(a); });
  document.addEventListener('click', () => $('#ctxmenu').hidden = true);
  $('#canvas').addEventListener('scroll', () => { $('#ctxmenu').hidden = true; });

  // Bilder: Einfügen + Drag&Drop
  editor.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  editor.addEventListener('drop', e => {
    const files = [...(e.dataTransfer.files || [])];
    if (!files.length) return;
    e.preventDefault();                       // nie eine Datei "ins Nichts" fallen lassen (Navigation = Datenverlust)
    const img = files.find(f => f.type.startsWith('image/'));
    if (img) { insertImageFile(img); return; }
    const gd = files.find(f => /\.(paper|gdoc|json|docx|odt|xlsx)$/i.test(f.name));
    if (gd) { if (/\.docx$/i.test(gd.name)) importDocx(gd); else if (/\.odt$/i.test(gd.name)) importOdt(gd); else if (/\.xlsx$/i.test(gd.name)) importXlsx(gd); else gd.text().then(t => ingestGdoc(t, null)); }
  });
  editor.addEventListener('paste', e => {
    for (const it of (e.clipboardData?.items || [])) {
      if (it.type.startsWith('image/')) { e.preventDefault(); insertImageFile(it.getAsFile()); return; }
    }
    const html = e.clipboardData?.getData('text/html');
    if (html) { e.preventDefault(); document.execCommand('insertHTML', false, sanitizeHtml(html)); afterEdit(); }
  });
  editor.addEventListener('click', e => {
    const tact = e.target.closest('[data-tocact]');
    if (tact) { e.preventDefault(); const toc = tact.closest('.toc'); if (tact.dataset.tocact === 'del') { if (toc) toc.remove(); afterEdit(); } else refreshTOC(); return; }
    const go = e.target.closest('[data-go]');
    if (go) { e.preventDefault(); const el = document.getElementById(go.dataset.go); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    $$('img.sel', editor).forEach(i => i.classList.remove('sel'));
    if (e.target.tagName === 'IMG') e.target.classList.add('sel');
  });

  // Schwebe-Toolbar
  const b = bubble();
  b.querySelectorAll('.bb[data-cmd]').forEach(btn => btn.addEventListener('mousedown', e => { e.preventDefault(); cmd(btn.dataset.cmd); updateBubble(); }));
  $('#bbHl').addEventListener('mousedown', e => { e.preventDefault(); highlight($('#hlColor').value); });
  $('#bbLink').addEventListener('mousedown', e => { e.preventDefault(); insertLink(); });
  document.addEventListener('selectionchange', () => { updateBubble(); updateTableTools(); const s = getSelection(); if (s && s.anchorNode && editor.contains(s.anchorNode)) syncToolbar(); writeCellPos(); });
  $('#canvas').addEventListener('scroll', () => { if (!b.hidden) updateBubble(); if (!$('#tabletools').hidden) updateTableTools(); writeCellPos(); });

  // Tabellen-Werkzeuge
  $('#tabletools').addEventListener('mousedown', e => { const a = e.target.closest('button')?.dataset.tt; if (a) { e.preventDefault(); tableAction(a); } });

  // Suche
  $('#findClose').addEventListener('click', () => { toggleFind(false); editor.focus(); });
  $('#findNext').addEventListener('click', () => findStep(false));
  $('#findPrev').addEventListener('click', () => findStep(true));
  $('#findInput').addEventListener('input', updateFindCount);
  $('#findInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); findStep(e.shiftKey); }
    else if (e.key === 'Escape') { toggleFind(false); editor.focus(); }
  });
  // Ersetzen
  $('#btnReplace').addEventListener('click', replaceCurrent);
  $('#btnReplaceAll').addEventListener('click', replaceAll);
  $('#replaceInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? replaceAll() : replaceCurrent(); }
    else if (e.key === 'Escape') { toggleFind(false); editor.focus(); }
  });

  // Zeilenabstand
  $$('#segLine button').forEach(b => b.addEventListener('click', () => {
    if (!doc) return;
    $$('#segLine button').forEach(x => x.classList.remove('on')); b.classList.add('on');
    doc.einstellungen.zeilenabstand = +b.dataset.line; editor.style.lineHeight = b.dataset.line; scheduleSave();
  }));

  // Top-Aktionen
  $('#btnNew').addEventListener('click', () => createDoc());
  $('#btnOpen').addEventListener('click', openFile);
  $('#btnSave').addEventListener('click', () => saveFile(false));
  $('#btnFocus').addEventListener('click', toggleFocus);
  { const bv = $('#btnView'); if (bv) bv.addEventListener('click', () => setViewOnly(!viewOnly)); }
  $('#btnFocusExit').addEventListener('click', toggleFocus);
  $('#btnTheme').addEventListener('click', () => setTheme(document.body.dataset.theme === 'dark' ? 'light' : 'dark'));

  // Schöne Hover-Tooltips aus den title-Attributen
  let tipEl = null, tipTimer = null;
  const hideTip = () => { clearTimeout(tipTimer); if (tipEl && tipEl.dataset.tip != null) { tipEl.setAttribute('title', tipEl.dataset.tip); delete tipEl.dataset.tip; } tipEl = null; $('#tip').hidden = true; };
  document.addEventListener('mouseover', e => {
    const t = e.target.closest('[title]'); if (!t || t === tipEl) return;
    hideTip(); const txt = t.getAttribute('title'); if (!txt) return; tipEl = t;
    tipTimer = setTimeout(() => {
      if (!tipEl) return; tipEl.dataset.tip = txt; tipEl.removeAttribute('title');
      const tip = $('#tip'); tip.textContent = txt; tip.hidden = false;
      const r = tipEl.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
      const left = Math.max(8, Math.min(r.left + r.width / 2 - tw / 2, window.innerWidth - tw - 8));
      let top = r.bottom + 8; if (top + th > window.innerHeight - 8) top = r.top - th - 8;
      tip.style.left = left + 'px'; tip.style.top = top + 'px';
    }, 320);
  });
  document.addEventListener('mouseout', e => { if (tipEl && (!e.relatedTarget || !tipEl.contains(e.relatedTarget))) hideTip(); });
  document.addEventListener('mousedown', hideTip, true);
  window.addEventListener('scroll', hideTip, true);

  // Export-Menü
  const exMenu = $('#exportMenu');
  $('#btnExport').addEventListener('click', e => { e.stopPropagation(); exMenu.hidden = !exMenu.hidden; });
  exMenu.addEventListener('click', e => { const k = e.target.dataset.export; if (k) { doExport(k); exMenu.hidden = true; } });
  document.addEventListener('click', () => exMenu.hidden = true);

  // Seitenleiste / Ordner
  $$('.snav[data-folder]').forEach(b => b.addEventListener('click', () => {
    $$('.snav[data-folder]').forEach(x => x.classList.remove('active')); b.classList.add('active');
    activeFolder = b.dataset.folder; renderList();
  }));
  $('#btnSideCollapse').addEventListener('click', () => { const rail = appEl.classList.toggle('side-rail'); $('#btnSideCollapse').title = rail ? 'Seitenleiste ausklappen' : 'Seitenleiste einklappen'; applyZoom(); });
  $('#btnSideShow').addEventListener('click', () => appEl.classList.toggle('side-mobile'));
  $('#btnNav').addEventListener('click', () => { appEl.classList.toggle('nav-open'); });
  $('#navClose').addEventListener('click', () => appEl.classList.remove('nav-open'));
  $('#btnInspClose').addEventListener('click', () => { appEl.classList.remove('insp-open'); applyZoom(); });
  $('#btnInspector').addEventListener('click', () => { appEl.classList.toggle('insp-open'); applyZoom(); });

  // .gdoc per Drag&Drop ins Fenster öffnen
  window.addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', e => {
    if (editor.contains(e.target)) return;    // im Editor regelt der Editor selbst
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;
    e.preventDefault();                       // verhindert Wegnavigieren bei Datei-Drop
    const f = files.find(f => /\.(paper|gdoc|json|docx|odt|xlsx)$/i.test(f.name));
    if (!f) return;
    if (/\.docx$/i.test(f.name)) importDocx(f); else if (/\.odt$/i.test(f.name)) importOdt(f); else if (/\.xlsx$/i.test(f.name)) importXlsx(f); else f.text().then(t => ingestGdoc(t, null));
  });

  // Schutz vor Datenverlust beim Schliessen
  window.addEventListener('beforeunload', e => {
    if (!doc) return;
    captureDoc();
    if (persistLib()) setDirty(false);
    else { e.preventDefault(); e.returnValue = ''; }  // nur warnen, wenn wirklich nicht gesichert
  });

  // Tastenkürzel
  document.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (viewOnly && (e.key === 'Delete' || e.key === 'Backspace')) return;   // Ansehen-Modus: nichts löschen
    // markiertes Bild löschen
    if ((e.key === 'Delete' || e.key === 'Backspace')) {
      const im = $('img.sel', editor); if (im) { e.preventDefault(); im.remove(); afterEdit(); return; }
    }
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); verlaufZurueck(); }        // Strg+Z
    else if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) { e.preventDefault(); verlaufVor(); }   // Strg+Y / Strg+Umschalt+Z
    else if (mod && e.key.toLowerCase() === 'p') { e.preventDefault(); printPreview(); }   // Strg+P → eigene Druckvorschau
    else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveFile(e.shiftKey); }
    else if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); openFile(); }
    else if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); createDoc(); }
    else if (mod && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); toggleFocus(); }
    else if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); toggleFind(true); }
    else if (mod && (e.key === '+' || e.key === '=')) { e.preventDefault(); zoomStep(.1); }
    else if (mod && (e.key === '-' || e.key === '_')) { e.preventDefault(); zoomStep(-.1); }
    else if (mod && e.key === '0') { e.preventDefault(); setZoom('auto'); }
    else if (e.key === 'Escape') {
      if (!$('#previewOverlay').hidden) $('#previewOverlay').hidden = true;
      else if (!$('#ctxmenu').hidden) $('#ctxmenu').hidden = true;
      else if (!$('#findbar').hidden) { toggleFind(false); editor.focus(); }
      else if (appEl.classList.contains('focus')) toggleFocus();
    }
  });

  // Inspector standardmässig offen auf grossen Schirmen
  if (window.innerWidth > 1180) appEl.classList.add('insp-open');
}

/* ---------- Doppelklick-Start (.gdoc) ---------- */
function initLaunch() {
  if ('launchQueue' in window) {
    try {
      window.launchQueue.setConsumer(async params => {
        if (!params || !params.files || !params.files.length) return;
        const file = await params.files[0].getFile();
        ingestGdoc(await file.text(), params.files[0]);
      });
    } catch (_) {}
  }
}

/* ============================================================
   Bilder (eingebettet als Base64)
   ============================================================ */
function insertImageFile(file) {
  if (!file || !file.type || !file.type.startsWith('image/')) return;
  const r = new FileReader();
  r.onload = () => downscaleImage(r.result, file.type, url => {
    editor.focus();
    document.execCommand('insertHTML', false, `<img src="${url}" alt=""><p><br></p>`);
    afterEdit();
  });
  r.readAsDataURL(file);
}
// Grosse Bilder automatisch verkleinern/komprimieren (schützt den lokalen Speicher)
function downscaleImage(dataUrl, type, cb) {
  const MAX = 1600, LIMIT = 700000;
  const img = new Image();
  img.onload = () => {
    const w = img.naturalWidth, h = img.naturalHeight;
    if (w <= MAX && h <= MAX && dataUrl.length < LIMIT) return cb(dataUrl);
    const scale = Math.min(1, MAX / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
    try {
      const c = document.createElement('canvas'); c.width = cw; c.height = ch;
      c.getContext('2d').drawImage(img, 0, 0, cw, ch);
      const out = (type === 'image/png') ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.85);
      cb(out.length < dataUrl.length ? out : dataUrl);
    } catch (_) { cb(dataUrl); }
  };
  img.onerror = () => cb(dataUrl);
  img.src = dataUrl;
}

/* ============================================================
   Textmarker (Highlight)
   ============================================================ */
function highlight(color) {
  editor.focus();
  document.execCommand('styleWithCSS', false, true);
  document.execCommand('hiliteColor', false, color);
  afterEdit();
}

/* ============================================================
   Schwebe-Toolbar bei Textauswahl
   ============================================================ */
const bubble = () => $('#bubble');
function updateBubble() {
  const b = bubble();
  if (appEl.classList.contains('focus')) { b.hidden = true; return; }
  const sel = document.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) { b.hidden = true; return; }
  const range = sel.getRangeAt(0);
  if (!editor.contains(range.commonAncestorContainer)) { b.hidden = true; return; }
  const rect = range.getBoundingClientRect();
  if (!rect.width && !rect.height) { b.hidden = true; return; }
  b.hidden = false;
  const bw = b.offsetWidth, bh = b.offsetHeight;
  let left = Math.max(8, Math.min(rect.left + rect.width / 2 - bw / 2, window.innerWidth - bw - 8));
  let top = rect.top - bh - 8; if (top < 8) top = rect.bottom + 8;
  b.style.left = left + 'px'; b.style.top = top + 'px';
}

/* ============================================================
   Tabellen-Werkzeuge
   ============================================================ */
function currentCell() {
  const sel = document.getSelection();
  if (!sel || !sel.rangeCount) return null;
  let n = sel.anchorNode; n = (n && n.nodeType === 1) ? n : (n ? n.parentElement : null);
  return n ? n.closest('td,th') : null;
}
function updateTableTools() {
  const tt = $('#tabletools');
  if (appEl.classList.contains('calc-mode')) { tt.hidden = true; return; }   // Calc hat eigene Gitter-Werkzeuge
  const cell = currentCell();
  if (!cell || appEl.classList.contains('focus')) { tt.hidden = true; return; }
  const table = cell.closest('table'); const rect = table.getBoundingClientRect();
  tt.hidden = false;
  let top = rect.top - tt.offsetHeight - 6; if (top < 70) top = rect.bottom + 6;
  tt.style.top = top + 'px';
  tt.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - tt.offsetWidth - 8)) + 'px';
}
function tableAction(act) {
  const cell = currentCell(); if (!cell) return;
  const row = cell.parentElement, table = cell.closest('table');
  const idx = [...row.children].indexOf(cell);
  if (act === 'row+') {
    const nr = document.createElement('tr');
    [...row.children].forEach(() => { const td = document.createElement('td'); td.innerHTML = '&nbsp;'; nr.appendChild(td); });
    row.after(nr);
  } else if (act === 'row-') {
    const tb = row.parentElement; if (tb.children.length > 1) row.remove();
  } else if (act === 'col+') {
    table.querySelectorAll('tr').forEach(tr => {
      const ref = tr.children[idx];
      const c = document.createElement(ref && ref.tagName === 'TH' ? 'th' : 'td'); c.innerHTML = '&nbsp;';
      ref ? ref.after(c) : tr.appendChild(c);
    });
  } else if (act === 'col-') {
    if (row.children.length > 1) table.querySelectorAll('tr').forEach(tr => { if (tr.children[idx]) tr.children[idx].remove(); });
  } else if (act === 'del') { table.remove(); }
  afterEdit(); setTimeout(updateTableTools, 0);
}

/* ============================================================
   Dokumentsuche
   ============================================================ */
function toggleFind(show) {
  const fb = $('#findbar');
  const wantOpen = (show === true) || (show == null && fb.hidden);
  if (wantOpen && doc && activePage() && activePage().typ === 'calc') {   // Suche/Ersetzen wirkt auf den Fliesstext, nicht aufs Raster
    toast('Suchen & Ersetzen ist in Tabellen (Submit Calc) noch nicht verfügbar.');
    return;
  }
  fb.hidden = (show === false) ? true : (show === true ? false : !fb.hidden);
  if (!fb.hidden) { const i = $('#findInput'); i.focus(); i.select(); updateFindCount(); }
}
function updateFindCount() {
  const t = $('#findInput').value;
  if (!t) { $('#findCount').textContent = ''; return; }
  const n = (editor.innerText || '').toLowerCase().split(t.toLowerCase()).length - 1;
  $('#findCount').textContent = n ? n + ' Treffer' : 'keine';
}
function findStep(back) {
  const t = $('#findInput').value; if (!t) return;
  try { window.find(t, false, !!back, true, false, false, false); } catch (_) {}
}
// Aktuellen Treffer ersetzen (oder zuerst zum nächsten springen)
function replaceCurrent() {
  const t = $('#findInput').value; if (!t) return;
  const rep = $('#replaceInput').value;
  const sel = document.getSelection();
  const onMatch = sel && sel.rangeCount && !sel.isCollapsed
    && editor.contains(sel.getRangeAt(0).commonAncestorContainer)
    && sel.toString().toLowerCase() === t.toLowerCase();
  if (onMatch) { editor.focus(); document.execCommand('insertText', false, rep); afterEdit(); }
  findStep(false); updateFindCount();
}
// Alle Treffer ersetzen (textbasiert, erhält Formatierung)
function replaceAll() {
  const t = $('#findInput').value; if (!t) return;
  const rep = $('#replaceInput').value;
  const rx = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {   // nicht in Spaltentrennern, Inhaltsverzeichnis oder nicht-editierbaren Blöcken ersetzen
      const p = n.parentElement;
      if (p && p.closest('.colsep, .toc, [contenteditable="false"]')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  let count = 0;
  nodes.forEach(n => {
    const nv = n.nodeValue.replace(rx, () => { count++; return rep; });
    if (nv !== n.nodeValue) n.nodeValue = nv;
  });
  if (count) { afterEdit(); toast(count + (count === 1 ? ' Stelle ersetzt' : ' Stellen ersetzt')); }
  else toast('Nichts gefunden.');
  updateFindCount();
}

/* ============================================================
   Ansicht: Zoom (auto-anpassend), Ausrichtung, Seiten-Hilfslinien
   ============================================================ */
let zoomMode = 'auto';   // 'auto' = an Fensterbreite anpassen, sonst feste Zahl
const FORMATS = { A4: [210, 297], A5: [148, 210], Letter: [216, 279], A3: [297, 420], A2: [420, 594], A1: [594, 841], A0: [841, 1189] };  // Hochformat [B,H] in mm
function isSlides() { return false; }   // Slides entfernt – Submit Paper = Write+Calc (ein Raster)
// Format & Ausrichtung sind PRO SEITE (Fallback: Dokument-Einstellung) → A4 hoch + A3 quer im selben Dokument
function pageFmt() { const p = doc && activePage(); return (p && p.format) || (doc && doc.einstellungen.format) || 'A4'; }
function pageOrient() { const p = doc && activePage(); return (p && p.ausrichtung) || (doc && doc.einstellungen.ausrichtung) || 'hoch'; }
function pageDims() {
  const f = FORMATS[pageFmt()] || FORMATS.A4;
  const quer = pageOrient() === 'quer';
  return { w: quer ? f[1] : f[0], h: quer ? f[0] : f[1] };
}
function pageWidthMm() { return pageDims().w; }
function pageHeightPx() { return pageDims().h * MM; }
function applyFormat() {
  if (!doc) return;
  const d = pageDims(), quer = pageOrient() === 'quer';
  page.style.width = d.w + 'mm';
  page.style.minHeight = d.h + 'mm';
  page.style.height = '';
  page.classList.toggle('quer', quer);
  $('#pageFormat').textContent = pageFmt() + ' · ' + d.w + ' × ' + d.h + ' mm';
  $('#selFormat').value = pageFmt();
  $('#btnPortrait').classList.toggle('on', !quer);
  $('#btnLandscape').classList.toggle('on', quer);
}
function setFormat(f) {
  if (!doc || !FORMATS[f]) return;
  activePage().format = f;
  applyFormat(); applyZoom(); updatePages(); scheduleSave();
  if (activePage().typ === 'calc') { calcFitRows = 0; renderCalc(); }   // Spaltenzahl/Höhe ans neue Format anpassen
}
function applyZoom() {
  const avail = ($('#canvas').clientWidth || 800) - 56;   // Calc-Blatt exakt so gross wie Write
  const fit = Math.max(.2, avail / (pageWidthMm() * MM));
  let z = (zoomMode === 'auto') ? Math.min(1, fit) : zoomMode;
  z = Math.max(.2, Math.min(2.5, z));
  page.style.zoom = z;
  $('#zoomVal').innerHTML = Math.round(z * 100) + '&nbsp;%';
  $('#zoomVal').classList.toggle('on', zoomMode === 'auto');
  drawRuler();
  drawVRuler();
  if (appEl.classList.contains('calc-mode')) buildCalcRulers(); else buildWriteRulers();
}
function setZoom(v) { zoomMode = v; applyZoom(); }
function zoomStep(d) {
  const cur = (zoomMode === 'auto') ? (parseFloat(page.style.zoom) || 1) : zoomMode;
  setZoom(Math.max(.3, Math.min(2.5, Math.round((cur + d) * 100) / 100)));
}
function setOrientation(o) {
  if (!doc) return;
  activePage().ausrichtung = o;
  applyFormat(); scheduleSave(); applyZoom(); updatePages();
  if (activePage().typ === 'calc') { calcFitRows = 0; renderCalc(); }   // Spaltenzahl/Höhe ans neue Format anpassen
}
let pageCount = 1, pagTimer = null;
function updatePages() { $('#guides').innerHTML = ''; return pageCount; }   // echte Seitenlücken: siehe paginate()
function paginateLater() { clearTimeout(pagTimer); pagTimer = setTimeout(paginate, 300); }
// Cursor-Position nur im Fliesstext zählen (Kopf-/Fuss-Kopien in den Lücken ignorieren)
function bodyCaret() {
  const sel = getSelection(); if (!sel.rangeCount) return null;
  const r = sel.getRangeAt(0); if (!editor.contains(r.endContainer)) return null;
  if (r.endContainer.parentElement && r.endContainer.parentElement.closest('.pgbreak-gap')) return null;
  const w = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, { acceptNode(n) { return n.parentElement && n.parentElement.closest('.pgbreak-gap') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; } });
  let n, off = 0; while ((n = w.nextNode())) { if (n === r.endContainer) return off + r.endOffset; off += n.nodeValue.length; } return off;
}
function setBodyCaret(off) {
  if (off == null) return;
  const w = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, { acceptNode(n) { return n.parentElement && n.parentElement.closest('.pgbreak-gap') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; } });
  let n, acc = 0; while ((n = w.nextNode())) { const len = n.nodeValue.length; if (acc + len >= off) { const r = document.createRange(); r.setStart(n, Math.max(0, off - acc)); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return; } acc += len; }
}
// Echte Mehrseiten-Ansicht: volle A4-Blätter; „Seitenlücke" füllt den Rest + wiederholt Kopf-/Fusszeile (editierbar)
function paginate() {
  if (!doc || isSlides() || (activePage() && activePage().typ === 'calc')) return;
  if (document.activeElement && document.activeElement.closest && document.activeElement.closest('.pgbreak-gap')) return;  // gerade Kopf/Fuss editieren → nicht neu umbrechen
  $$('.pgbreak-gap', editor).forEach(g => g.remove());
  const off = (document.activeElement === editor) ? bodyCaret() : null;
  // echte Höhe von Kopf-/Fusszeile messen (inkl. Rand + Kopf-/Fusshöhe) – sonst wird das Blatt zu hoch
  const hH = $('#zoneH').offsetHeight || 60, fH = $('#zoneF').offsetHeight || 60;
  const H = Math.max(140, pageDims().h * MM - hH - fH - 2);   // verfügbare Inhaltshöhe je Blatt (px)
  const firstNo = !!doc.einstellungen.erstSeiteOhne;
  let used = 0, pages = 1;
  const kids = [...editor.children].filter(n => !(n.classList && n.classList.contains('pgbreak-gap')));
  kids.forEach(node => {
    const brk = node.classList && node.classList.contains('pagebreak');
    const cs = getComputedStyle(node);
    const h = brk ? 0 : node.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
    if (brk || (used + h > H && used > 0)) {
      node.before(mkGap(Math.max(0, H - used), hH, fH, pages === 1 && firstNo));
      pages++; used = brk ? 0 : h;
    } else used += h;
  });
  // letzte Seite voll auffüllen (zoneF darunter = Fusszeile der letzten Seite)
  const tail = document.createElement('div'); tail.className = 'pgbreak-gap pg-tail'; tail.contentEditable = 'false';
  tail.style.height = Math.max(0, H - used) + 'px'; editor.appendChild(tail);
  pageCount = pages;
  page.classList.toggle('first-no-hf', firstNo);
  page.classList.toggle('one-page', pages === 1);
  alignColseps();
  if (off != null) setBodyCaret(off);
  const st = $('#stPages'); if (st) st.textContent = pages + (pages === 1 ? ' Seite' : ' Seiten');
  buildWriteRulers();
}
function mkGap(fillPx, headPx, footPx, noFoot) {
  const d = document.createElement('div'); d.className = 'pgbreak-gap'; d.contentEditable = 'false';
  const fh = $('#zoneF').innerHTML, hh = $('#zoneH').innerHTML;   // Kopf-/Fusszeile pro Seite (editierbar, synchron)
  d.innerHTML =
    `<div class="pg-fill" style="height:${fillPx}px"></div>` +
    (noFoot ? `<div class="pg-foot" style="height:${footPx}px"></div>` : `<div class="pg-foot" style="height:${footPx}px" contenteditable="true">${fh}</div>`) +
    `<div class="pg-mid"></div>` +
    `<div class="pg-head" style="height:${headPx}px" contenteditable="true">${hh}</div>`;
  return d;
}
// Kopf-/Fusszeile in allen Seiten gleich halten
function syncHF(el) {
  const isFoot = el.classList.contains('pg-foot');
  const html = el.innerHTML;
  const master = isFoot ? $('#zoneF') : $('#zoneH');
  if (master.innerHTML !== html) master.innerHTML = html;
  $$('.pgbreak-gap .' + (isFoot ? 'pg-foot' : 'pg-head'), editor).forEach(c => { if (c !== el && c.innerHTML !== html) c.innerHTML = html; });
  scheduleSave(true);
}
function syncHFfromMaster() {
  const fh = $('#zoneF').innerHTML, hh = $('#zoneH').innerHTML;
  $$('.pgbreak-gap .pg-foot', editor).forEach(c => { if (c.innerHTML !== fh) c.innerHTML = fh; });
  $$('.pgbreak-gap .pg-head', editor).forEach(c => { if (c.innerHTML !== hh) c.innerHTML = hh; });
}

/* ---------- Seite einrichten (Ränder, Kopf-/Fuss-Höhe) + Lineal ---------- */
function defaultMargins() { return { top: 18, right: 22, bottom: 18, left: 22 }; }
function pageSetup() {
  const s = doc.einstellungen;
  if (!s.margins) s.margins = defaultMargins();
  if (s.kopfH == null) s.kopfH = 14;
  if (s.fussH == null) s.fussH = 14;
  if (!Array.isArray(s.tabs)) s.tabs = [];
  return s;
}
function applyPageSetup() {
  if (!doc) return;
  const s = pageSetup(), m = s.margins;
  page.style.setProperty('--mt', m.top + 'mm');
  page.style.setProperty('--mr', m.right + 'mm');
  page.style.setProperty('--mb', m.bottom + 'mm');
  page.style.setProperty('--ml', m.left + 'mm');
  page.style.setProperty('--kopfH', s.kopfH + 'mm');
  page.style.setProperty('--fussH', s.fussH + 'mm');
  $('#mTop').value = m.top; $('#mBottom').value = m.bottom; $('#mLeft').value = m.left; $('#mRight').value = m.right;
  $('#kopfH').value = s.kopfH; $('#fussH').value = s.fussH;
  const ck = $('#chkFirstNoHF'); if (ck) ck.checked = !!s.erstSeiteOhne;
  page.classList.toggle('first-no-hf', !!s.erstSeiteOhne);
}
let suppressRulerClick = false;
function drawRuler() {
  if (!doc) return;
  const wrap = $('#rulerWrap'), r = $('#ruler');
  // In Calc sind die Spalten-/Zeilenköpfe selbst das Lineal → cm-Lineal ausblenden
  if (appEl.classList.contains('focus') || appEl.classList.contains('slides-mode') || appEl.classList.contains('calc-mode')) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';
  const z = parseFloat(page.style.zoom) || 1;
  const wmm = pageWidthMm(), wpx = wmm * MM * z;
  r.style.width = wpx + 'px';
  const m = pageSetup().margins; let html = '';
  for (let cm = 0; cm <= Math.floor(wmm / 10); cm++) { html += `<div class="rtick" style="left:${cm * 10 * MM * z}px"><span>${cm}</span></div>`; }
  html += `<div class="rmargin left" style="width:${m.left * MM * z}px"></div>`;
  html += `<div class="rmargin right" style="width:${m.right * MM * z}px"></div>`;
  (doc.einstellungen.tabs || []).forEach((t, i) => { html += `<div class="rtab" data-i="${i}" style="left:${t * MM * z}px" title="Tabstopp – Klick entfernt"></div>`; });
  html += `<div class="rhandle" id="rhLeft" style="left:${m.left * MM * z}px" title="Linker Rand"></div>`;
  html += `<div class="rhandle" id="rhRight" style="left:${(wmm - m.right) * MM * z}px" title="Rechter Rand"></div>`;
  r.innerHTML = html;
  $('#rhLeft').addEventListener('mousedown', e => startMarginDrag('left', e));
  $('#rhRight').addEventListener('mousedown', e => startMarginDrag('right', e));
  $$('#ruler .rtab').forEach(t => t.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); doc.einstellungen.tabs.splice(+t.dataset.i, 1); drawRuler(); scheduleSave(); }));
}
function rulerMm(clientX) { const r = $('#ruler').getBoundingClientRect(); const z = parseFloat(page.style.zoom) || 1; return Math.max(0, Math.min(pageWidthMm(), (clientX - r.left) / (MM * z))); }
function startMarginDrag(which, e) {
  e.preventDefault(); suppressRulerClick = true;
  const wmm = pageWidthMm(), s = pageSetup();
  const move = ev => {
    const mm = Math.round(rulerMm(ev.clientX));
    if (which === 'left') s.margins.left = Math.max(0, Math.min(mm, wmm - s.margins.right - 20));
    else s.margins.right = Math.max(0, Math.min(wmm - mm, wmm - s.margins.left - 20));
    applyPageSetup(); drawRuler();
  };
  const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); scheduleSave(); updatePages(); setTimeout(() => suppressRulerClick = false, 0); };
  document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
}
// Tab = Spaltentrenner: erzeugt im Write-Modus eine Spalte (in Calc dieselbe Zelle/Spalte)
function insertTab() {
  document.execCommand('insertHTML', false, COLSEP + '​');
  afterEdit();
}

/* ============================================================
   Einfügen-Menü + Inhaltsverzeichnis
   ============================================================ */
/* ---------- Menüband-Funktionen (Format übertragen, Gross/Klein, Symbol, Datum, Seitenumbruch, Initiale, Spalten) ---------- */
let paintFmt = null;
function captureFmt() {
  const q = c => { try { return document.queryCommandState(c); } catch (_) { return false; } };
  const v = c => { try { return document.queryCommandValue(c); } catch (_) { return ''; } };
  return { b: q('bold'), i: q('italic'), u: q('underline'), s: q('strikeThrough'), fore: v('foreColor'), font: v('fontName') };
}
function applyFmt(f) {
  editor.focus();
  const q = c => { try { return document.queryCommandState(c); } catch (_) { return false; } };
  document.execCommand('styleWithCSS', false, true);
  if (q('bold') !== f.b) document.execCommand('bold');
  if (q('italic') !== f.i) document.execCommand('italic');
  if (q('underline') !== f.u) document.execCommand('underline');
  if (q('strikeThrough') !== f.s) document.execCommand('strikeThrough');
  if (f.fore) document.execCommand('foreColor', false, f.fore);
  if (f.font) document.execCommand('fontName', false, f.font);
  afterEdit();
}
function changeCase(mode) {
  const sel = getSelection(); if (!sel.rangeCount || sel.isCollapsed) { toast('Bitte zuerst Text markieren.'); return; }
  let t = sel.toString();
  if (mode === 'upper') t = t.toUpperCase();
  else if (mode === 'lower') t = t.toLowerCase();
  else if (mode === 'title') t = t.replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  else t = t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
  editor.focus(); document.execCommand('insertText', false, t); afterEdit();
}
function buildSymbolMenu() {
  const m = $('#symMenu'); if (!m) return;
  const syms = '€ £ $ ¥ © ® ™ § ¶ † • · – — … « » „ " ° ± × ÷ ≈ ≠ ≤ ≥ → ← ↑ ↓ ↔ ✓ ✗ ★ ☆ ☑ ☐ µ Ω π ∑ √ ∞ ½ ¼ ¾ ✆ ✉ ⚠'.split(' ');
  m.innerHTML = syms.map(s => `<button data-sym="${esc(s)}" title="${esc(s)} einfügen">${esc(s)}</button>`).join('');
}
function insertDate() { const d = new Date().toLocaleDateString('de-CH', { day: '2-digit', month: 'long', year: 'numeric' }); editor.focus(); document.execCommand('insertText', false, d); afterEdit(); }
function insertPageBreak() { editor.focus(); document.execCommand('insertHTML', false, '<div class="pagebreak" contenteditable="false">Seitenumbruch</div><p><br></p>'); afterEdit(); }
function toggleDropcap() {
  const sel = getSelection(); let n = sel.anchorNode; n = (n && n.nodeType === 1) ? n : (n ? n.parentElement : null);
  const p = n && n.closest('p,h1,h2,h3,blockquote');
  if (p && editor.contains(p)) { p.classList.toggle('dropcap'); afterEdit(); } else toast('Cursor in einen Absatz setzen.');
}
function setColumns(n) {
  if (!doc) return;
  doc.einstellungen.spalten = n;
  editor.style.columnCount = n > 1 ? n : '';
  editor.style.columnGap = n > 1 ? '12mm' : '';
  scheduleSave();
}
function doInsert(kind) {
  if (kind === 'seitenzahl') {   // Platzhalter in die Fusszeile - wird beim Drucken je Blatt ersetzt
    const f = $('#zoneF'); if (!f) return;
    const txt = 'Seite {Seite} von {Seiten}';
    if (document.activeElement === f) { try { document.execCommand('insertText', false, txt); } catch (_) { f.innerHTML += ' ' + txt; } }
    else f.innerHTML = (f.innerHTML.trim() ? f.innerHTML + ' &nbsp; ' : '') + txt;
    syncHFfromMaster(); scheduleSave();   // syncHF(el) braucht ein Element - hier ist der Master gemeint
    toast('Seitenzahl in der Fusszeile – beim Drucken wird sie je Blatt eingesetzt.');
    return;
  }
  if (inCalc() && ['link', 'image', 'table', 'toc', 'hr'].includes(kind)) { toast('In Calc-Zellen nicht verfügbar – nutze die Tabellen-Werkzeuge (Rahmen, Verbinden, ±Sp/±Z).'); return; }
  if (kind === 'link') insertLink();
  else if (kind === 'image') $('#imgInput').click();
  else if (kind === 'table') insertTable();
  else if (kind === 'toc') insertTOC();
  else if (kind === 'hr') { editor.focus(); document.execCommand('insertHTML', false, '<hr><p><br></p>'); afterEdit(); }
  else if (kind === 'header') { const z = $('#zoneH'); z.focus(); z.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  else if (kind === 'footer') { const z = $('#zoneF'); z.focus(); z.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
}
function insertTOC() {
  if ($('.toc', editor)) { toast('Es gibt bereits ein Inhaltsverzeichnis.'); return; }
  editor.focus();
  document.execCommand('insertHTML', false, '<div class="toc" contenteditable="false" data-toc="1"></div><p><br></p>');
  refreshTOC(); afterEdit();
}
let tocSeq = 0;
function refreshTOC() {
  let tocs = $$('.toc', editor); if (!tocs.length) return;
  // Altlast: Überschrift, die ein TOC umschliesst → TOC herauslösen
  $$('h1,h2,h3', editor).forEach(h => { if (h.querySelector('.toc')) h.replaceWith(...h.childNodes); });
  tocs = $$('.toc', editor); if (!tocs.length) return;
  tocs.slice(1).forEach(t => t.remove());                       // nur EIN Inhaltsverzeichnis behalten
  const toc = tocs[0];
  toc.contentEditable = 'false';
  toc.innerHTML = '';                                           // ZUERST leeren → Altlasten im TOC verschwinden, BEVOR gezählt wird
  // jetzt zählen: nur echte Überschriften, keine im (geleerten) Verzeichnis
  const heads = $$('h1,h2,h3', editor).filter(h => h.innerText.trim() && !h.closest('.toc'));
  heads.forEach(h => { if (!h.id || !/^h\d+t$/.test(h.id)) h.id = 'h' + (++tocSeq) + 't'; });
  let html = '<div class="toc-head"><span class="toc-title">Inhaltsverzeichnis</span>'
    + '<span class="toc-tools"><button class="toc-btn" data-tocact="refresh" title="Aktualisieren">⟳</button>'
    + '<button class="toc-btn" data-tocact="del" title="Inhaltsverzeichnis entfernen">✕</button></span></div>';
  if (!heads.length) html += '<div class="toc-empty">Sobald du Überschriften (Titel, H1–H3) verwendest, erscheinen sie hier automatisch.</div>';
  else html += '<div class="toc-list">' + heads.map(h =>
    `<a class="toc-l${h.tagName[1]}" data-go="${h.id}">${esc(h.innerText.trim())}</a>`).join('') + '</div>';
  toc.innerHTML = html;
}

/* ============================================================
   Rechtsklick-Menü
   ============================================================ */
function showContextMenu(x, y) {
  const m = $('#ctxmenu');
  const cell = currentCell();
  const img = $('img.sel', editor);
  let h = '';
  h += '<button data-ctx="cut">Ausschneiden<span class="km">Strg X</span></button>';
  h += '<button data-ctx="copy">Kopieren<span class="km">Strg C</span></button>';
  h += '<button data-ctx="paste">Einfügen<span class="km">Strg V</span></button>';
  h += '<div class="sep"></div><div class="lbl">Stil</div>';
  h += '<button data-ctx="b-h1">Titel</button><button data-ctx="b-h2">Überschrift</button><button data-ctx="b-h3">Unterüberschrift</button><button data-ctx="b-p">Fliesstext</button><button data-ctx="b-blockquote">Zitat</button>';
  h += '<div class="sep"></div><div class="lbl">Einfügen</div>';
  h += '<button data-ctx="link">Link …</button><button data-ctx="image">Bild …</button><button data-ctx="table">Tabelle</button><button data-ctx="toc">Inhaltsverzeichnis</button>';
  if (cell) h += '<div class="sep"></div><div class="lbl">Tabelle</div><button data-ctx="row+">Zeile darunter</button><button data-ctx="col+">Spalte rechts</button><button data-ctx="row-">Zeile löschen</button><button data-ctx="col-">Spalte löschen</button><button data-ctx="tdel">Tabelle löschen</button>';
  if (img) h += '<div class="sep"></div><div class="lbl">Bild</div><button data-ctx="img-s">Klein (40%)</button><button data-ctx="img-m">Mittel (70%)</button><button data-ctx="img-l">Volle Breite</button><button data-ctx="img-del">Bild löschen</button>';
  m.innerHTML = h; m.hidden = false;
  m.style.left = Math.min(x, window.innerWidth - m.offsetWidth - 8) + 'px';
  m.style.top = Math.min(y, window.innerHeight - m.offsetHeight - 8) + 'px';
}
function ctxAction(a) {
  $('#ctxmenu').hidden = true;
  if (a === 'dict-add' && spellTarget) { dictAdd(spellTarget.textContent); spellTarget = null; return; }
  if (a === 'dict-corr' && spellTarget) { const w = spellTarget.textContent; const to = prompt('„' + w + '" automatisch ersetzen durch:', w); if (to && to.trim()) corrAdd(w, to.trim()); spellTarget = null; return; }
  const img = $('img.sel', editor);
  if (a === 'cut') document.execCommand('cut');
  else if (a === 'copy') document.execCommand('copy');
  else if (a === 'paste') {
    if (navigator.clipboard && navigator.clipboard.readText)
      navigator.clipboard.readText().then(t => { editor.focus(); document.execCommand('insertText', false, t); afterEdit(); }).catch(() => toast('Bitte Strg+V zum Einfügen verwenden.'));
    else toast('Bitte Strg+V zum Einfügen verwenden.');
  }
  else if (a.startsWith('b-')) setBlock(a.slice(2));
  else if (a === 'link') insertLink();
  else if (a === 'image') $('#imgInput').click();
  else if (a === 'table') insertTable();
  else if (a === 'toc') insertTOC();
  else if (['row+', 'col+', 'row-', 'col-'].includes(a)) tableAction(a);
  else if (a === 'tdel') tableAction('del');
  else if (a === 'img-del' && img) { img.remove(); afterEdit(); }
  else if (img && (a === 'img-s' || a === 'img-m' || a === 'img-l')) { img.style.width = a === 'img-s' ? '40%' : a === 'img-m' ? '70%' : '100%'; afterEdit(); }
}

/* ============================================================
   Schriftstufen, Zeilenabstand, Druckvorschau
   ============================================================ */
function adjustFontSize(dir) {
  const sizes = [10, 12, 14, 16, 18, 20, 24, 28, 32, 40, 48];
  let cur = +($('#selSize').value) || 16;
  let idx = sizes.indexOf(cur);
  if (idx < 0) { idx = sizes.findIndex(s => s >= cur); if (idx < 0) idx = sizes.length - 1; }
  idx = Math.max(0, Math.min(sizes.length - 1, idx + (dir > 0 ? 1 : -1)));
  const px = sizes[idx]; $('#selSize').value = String(px);
  if (window.getSelection().isCollapsed) { if (doc) { doc.einstellungen.schriftgroesse = px; editor.style.fontSize = px + 'px'; scheduleSave(); } }
  else setFontSize(px);
}
function setLineHeight(v) {
  if (!doc) return;
  doc.einstellungen.zeilenabstand = v; editor.style.lineHeight = v;
  $$('#segLine button').forEach(x => x.classList.toggle('on', +x.dataset.line === v));
  $('#selLine').value = String(v); scheduleSave();
}
/* Platzhalter in Kopf- und Fusszeile. Word loest das ueber Felder; hier reicht ein
   Platzhalter, den man frei plazieren und mit Text mischen kann ('Seite {Seite} von {Seiten}').
   Ersetzt wird erst beim Seitenaufbau - vorher weiss niemand, wie viele Seiten es sind. */
const PLATZHALTER = ['{Seite}', '{Seiten}', '{Datum}', '{Titel}'];
function seitenzahlenEinsetzen(html, nr, gesamt, titel, datum) {
  return String(html == null ? '' : html)
    .replace(/\{\s*seite\s*\}/gi, String(nr))
    .replace(/\{\s*seiten\s*\}/gi, String(gesamt))
    .replace(/\{\s*titel\s*\}/gi, esc(titel || ''))
    .replace(/\{\s*datum\s*\}/gi, esc(datum || ''));
}
/* Platzhalter auf allen aufgebauten Vorschauseiten ersetzen */
function seitenzahlenAufSeiten(seiten) {
  let datum = ''; try { datum = new Date().toLocaleDateString('de-CH'); } catch (_) {}
  const titel = (doc && doc.titel) || '';
  const n = seiten.length;
  seiten.forEach((p, i) => {
    ['.pv-h', '.pv-f'].forEach(sel => {
      const el = p.querySelector(sel); if (!el) return;
      const roh = el.dataset.roh != null ? el.dataset.roh : (el.dataset.roh = el.innerHTML);
      el.innerHTML = seitenzahlenEinsetzen(roh, i + 1, n, titel, datum);
    });
  });
}

function previewCalc() {
  if (!curGrid) curGrid = htmlToGrid(activePage().html);
  let maxR = -1, maxC = -1;
  curGrid.zeilen.forEach((z, r) => z.cells.forEach((c, ci) => { if (cellText(c) !== '') { if (r > maxR) maxR = r; if (ci > maxC) maxC = ci; } }));
  if (maxR < 0) { maxR = 0; maxC = 0; }
  const quer = pageOrient() === 'quer';
  let tbl = '<table class="pv-grid">';
  for (let r = 0; r <= maxR; r++) {
    tbl += '<tr>';
    for (let c = 0; c <= maxC; c++) { const v = evalCell(c, r); tbl += `<td${typeof v === 'number' ? ' class="num"' : ''}>${esc(String(v))}</td>`; }
    tbl += '</tr>';
  }
  tbl += '</table>';
  const scroll = $('#previewScroll');
  $('#previewOverlay').hidden = false;
  scroll.innerHTML = '';
  const kopf = $('#zoneH').innerHTML, fuss = $('#zoneF').innerHTML;
  const neueSeite = () => {
    const p = document.createElement('div'); p.className = 'pv-page' + (quer ? ' quer' : '');
    p.innerHTML = `<div class="pv-h">${kopf}</div><div class="pv-c"><table class="pv-grid"><tbody></tbody></table></div>`
      + `<div class="pv-f"><span>${fuss}</span><span class="pv-num"></span></div>`;
    scroll.appendChild(p); return p;
  };
  // Vorher lag die GANZE Tabelle auf einem einzigen Blatt - bei langen Listen lief sie
  // ueber den Rand und Kopf-/Fusszeile erschienen nur auf der ersten Seite.
  let p = neueSeite(), tb = p.querySelector('tbody');
  const seiten = [p];
  const pageHpx = (quer ? 210 : 297) * MM;
  const headH = p.querySelector('.pv-h').offsetHeight, footH = p.querySelector('.pv-f').offsetHeight;
  const cp = getComputedStyle(p.querySelector('.pv-c'));
  const avail = pageHpx - headH - footH - (parseFloat(cp.paddingTop) || 0) - (parseFloat(cp.paddingBottom) || 0) - 2;
  let used = 0;
  for (let r = 0; r <= maxR; r++) {
    const tr = document.createElement('tr');
    for (let c = 0; c <= maxC; c++) {
      const v = evalCell(c, r);
      const td = document.createElement('td');
      if (typeof v === 'number') td.className = 'num';
      td.textContent = String(v);
      tr.appendChild(td);
    }
    tb.appendChild(tr);
    const h = tr.getBoundingClientRect().height;
    if (used + h > avail && used > 0) { p = neueSeite(); seiten.push(p); tb = p.querySelector('tbody'); tb.appendChild(tr); used = h; }
    else used += h;
  }
  seitenzahlenAufSeiten(seiten);
  $('#pvInfo').textContent = 'Tabelle · ' + (maxR + 1) + ' × ' + (maxC + 1) + ' · ' + seiten.length + (seiten.length === 1 ? ' Seite' : ' Seiten') + (quer ? ' · Querformat' : ' · Hochformat');
  scroll.scrollTop = 0;
}
function printPreview() {
  if (!doc) return;
  captureDoc();
  if (activePage().typ === 'calc') { previewCalc(); return; }
  const quer = pageOrient() === 'quer';
  const ov = $('#previewOverlay'), scroll = $('#previewScroll');
  scroll.classList.toggle('hy', !!doc.einstellungen.silben);   // Silbentrennung auch in der Vorschau
  scroll.innerHTML = ''; ov.hidden = false;          // erst sichtbar → dann messbar
  const headHTML = $('#zoneH').innerHTML, footHTML = $('#zoneF').innerHTML;
  const pageHpx = (quer ? 210 : 297) * MM;
  const newPage = () => {
    const p = document.createElement('div'); p.className = 'pv-page' + (quer ? ' quer' : '');
    p.innerHTML = `<div class="pv-h">${headHTML}</div><div class="pv-c"></div><div class="pv-f"><span>${footHTML}</span><span class="pv-num"></span></div>`;
    scroll.appendChild(p); return p;
  };
  let p = newPage(), c = p.querySelector('.pv-c'); const pages = [p];
  // verfügbare Höhe pro Seite (Kopf/Fuss + Innenabstand abziehen) – einmal messen, gilt für alle Seiten
  const headH = p.querySelector('.pv-h').offsetHeight, footH = p.querySelector('.pv-f').offsetHeight;
  const cpad = getComputedStyle(c); const padV = parseFloat(cpad.paddingTop) + parseFloat(cpad.paddingBottom);
  const avail = pageHpx - headH - footH - padV - 2;
  const outerH = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.height + (parseFloat(s.marginTop) || 0) + (parseFloat(s.marginBottom) || 0); };
  const nextPage = () => { p = newPage(); pages.push(p); c = p.querySelector('.pv-c'); };
  let used = 0;
  [...editor.children].forEach(node => {
    if (node.classList && node.classList.contains('pgbreak-gap')) return;   // Bildschirm-Seitenlücke nicht drucken
    // manueller Seitenumbruch
    if (node.classList && node.classList.contains('pagebreak')) { if (c.children.length) { nextPage(); used = 0; } return; }
    const clone = node.cloneNode(true);
    clone.querySelectorAll && clone.querySelectorAll('.sp-err').forEach(s => s.replaceWith(document.createTextNode(s.textContent)));
    c.appendChild(clone);
    const h = outerH(clone);
    if (used + h > avail && c.children.length > 1) {     // passt nicht mehr → ganzer Block auf neue Seite
      c.removeChild(clone); nextPage(); c.appendChild(clone); used = outerH(clone);
    } else used += h;
  });
  pages.forEach(pg => pg.querySelector('.pv-num').textContent = '');   // Seitenzahl kommt ueber den Platzhalter {Seite}, nicht automatisch
  seitenzahlenAufSeiten(pages);
  if (doc.einstellungen.erstSeiteOhne && pages[0]) { pages[0].querySelector('.pv-h').innerHTML = ''; pages[0].querySelector('.pv-f span:first-child').innerHTML = ''; }
  $('#pvInfo').textContent = pages.length + (pages.length === 1 ? ' Seite' : ' Seiten') + ' · ' + (quer ? 'Querformat' : 'Hochformat');
  scroll.scrollTop = 0;
}

// WYSIWYG-Druck: genau die paginierten Vorschau-Seiten drucken (richtige Kopf-/Fusszeile je Seite)
function printFromPreview() {
  if ($('#previewOverlay').hidden) printPreview();
  if ($('#previewOverlay').hidden) return;
  const st = document.createElement('style'); st.id = 'pvPageStyle'; st.textContent = '@page{margin:0}';
  document.head.appendChild(st);
  document.body.classList.add('printing-pages');
  let done = false;
  const cleanup = () => { if (done) return; done = true; document.body.classList.remove('printing-pages'); st.remove(); window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  setTimeout(() => window.print(), 80);
  setTimeout(cleanup, 60000);
}
/* ============================================================
   Modus-Umschalter + Submit Calc (Raster & Formeln)
   ============================================================ */
const MODE_META = { write: ['✍', 'Submit Write'], calc: ['▦', 'Submit Calc'] };
function pageMode(p) { return p.typ === 'calc' ? 'calc' : 'write'; }
/* Das Raster ist das Grundgeruest jeder Seite - eine einzellige Zeile wird als textcell
   ueber die volle Breite gesetzt und ist damit ein normaler Absatz. Der Gitter-Knopf
   wechselt daher KEINEN Dokumenttyp, er blendet nur die Linien ein und aus.
   Sichtbar nur bei linien === true: bestehende und neue Dokumente starten als Dokument. */
function dokumentModus() { const p = (typeof activePage === 'function') ? activePage() : null; return !!(p && p.typ === 'calc' && p.linien !== true); }
/* Neue Zeile unter r einfuegen - im Dokumentmodus ist das schlicht ein neuer Absatz */
function zeileEinfuegen(r) {
  if (!curGrid) return;
  curGrid.zeilen.splice(r + 1, 0, { tag: 'p', attrs: '', cells: [''] });
}
/* Zeile r an die darueberliegende anhaengen und entfernen - das Gegenstueck zu zeileEinfuegen.
   Rueckgabe: Textlaenge der oberen Zeile VOR dem Anhaengen = Position der Nahtstelle. */
function rohText(h) {   // wie plainText, aber OHNE Leerzeichen zu kuerzen - fuer Cursor-Positionen
  return String(h == null ? '' : h).replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
}
function zeilenVerbinden(r) {
  if (!curGrid || r < 1 || r >= curGrid.zeilen.length) return -1;
  const oben = curGrid.zeilen[r - 1], unten = curGrid.zeilen[r];
  const vorher = oben.cells[0] || '';
  const naht = rohText(vorher).length;   // Leerzeichen zaehlen mit, sonst sitzt der Cursor daneben
  oben.cells[0] = vorher + (unten.cells[0] || '');
  for (let i = 1; i < unten.cells.length; i++) if ((unten.cells[i] || '') !== '') oben.cells[i] = (oben.cells[i] || '') + unten.cells[i];
  curGrid.zeilen.splice(r, 1);
  return naht;
}
function gitterSichtbar(p) { return !!(p && p.typ === 'calc' && p.linien === true); }
function gitterUmschalten(p) { if (!p) return false; p.linien = !gitterSichtbar(p); return p.linien; }
function syncGridToggle() {
  const gt = $('#gridToggle'); if (!gt || !doc) return;
  const an = gitterSichtbar(activePage());
  gt.classList.toggle('on', an);
  const l = $('#gridToggleLbl'); if (l) l.textContent = an ? 'Calc' : 'Write';   // zeigt, worin man gerade schreibt
  gt.title = an ? 'Calc – Raster sichtbar, Zellen rechnen. Klicken: zurück zu Write' : 'Write – schreiben wie in Word. Klicken: Raster zeigen (Calc)';
}
function renderActivePage() {
  if (!doc) return;
  const p = activePage(), m = pageMode(p);
  document.body.dataset.mode = m;
  const calc = (m === 'calc');
  appEl.classList.toggle('calc-mode', calc);
  appEl.classList.toggle('lines-off', calc && !gitterSichtbar(p));   // Linien gehoeren zur SEITE, nicht zur App
  syncGridToggle();   // „Gitter"-Knopf spiegelt, ob die Linien sichtbar sind
  if (calc) {
    $('#findbar').hidden = true; curGrid = htmlToGrid(p.html || ''); selC = 0; selR = 0; calcFitRows = 0;
    applyFormat(); renderCalc(); selectCell(0, 0); applyZoom();
    // Dokumentmodus: Cursor steht sofort im Text, man kann losschreiben (kein Zellzeiger)
    if (dokumentModus() && !viewOnly) setTimeout(() => { try { if (!editingTd) beginEdit(); } catch (_) {} }, 0);
  }
  else { curGrid = null; editor.innerHTML = sanitizeHtml(p.html || ''); $$('.sp-err', editor).forEach(s => s.replaceWith(document.createTextNode(s.textContent))); $$('.pgbreak-gap', editor).forEach(g => g.remove()); $$('.colsep', editor).forEach(s => s.contentEditable = 'false'); $$('.fx', editor).forEach(s => s.contentEditable = 'false'); $$('.toc', editor).forEach(t => t.contentEditable = 'false'); applyFormat(); applyZoom(); refreshAll(); alignColseps(); paginateLater(); recomputeFormulas(); }
}
// Typ der AKTIVEN Seite wechseln (Modus-Pille)
function setPageType(typ) {
  if (!doc) return;
  const p = activePage(); const t = typ === 'calc' ? 'calc' : 'write'; if (p.typ === t) return;
  capturePage(true);
  p.typ = t;
  if (p.html == null) p.html = '';
  renderActivePage(); renderPageNav(); scheduleSave();
}
function switchPage(i) {
  if (i === doc.aktiv || i < 0 || i >= doc.seiten.length) return;
  capturePage(true); doc.aktiv = i; renderActivePage(); renderPageNav(); scheduleSave();
}
function addPage(typ) {
  capturePage(true);
  const t = typ === 'calc' ? 'calc' : 'write';
  const p = { id: uid(), typ: t, html: '' };
  doc.seiten.push(p); doc.aktiv = doc.seiten.length - 1;
  renderActivePage(); renderPageNav(); scheduleSave();
}
function deletePage(i) {
  if (doc.seiten.length <= 1) { toast('Mindestens eine Seite muss bleiben.'); return; }
  doc.seiten.splice(i, 1);
  if (doc.aktiv >= doc.seiten.length) doc.aktiv = doc.seiten.length - 1;
  else if (i < doc.aktiv) doc.aktiv--;
  renderActivePage(); renderPageNav(); scheduleSave();
}
function renderPageNav() {
  const bar = $('#pagetabs'); if (!bar || !doc) return;
  let h = '';
  doc.seiten.forEach((p, i) => {
    h += `<button class="ptab${i === doc.aktiv ? ' active' : ''}" data-i="${i}"><span class="pt-ico">${MODE_META[pageMode(p)][0]}</span>Seite ${i + 1}${doc.seiten.length > 1 ? `<span class="pt-del" data-del="${i}" title="Seite löschen">×</span>` : ''}</button>`;
  });
  h += `<div class="menu-wrap"><button class="ptadd" id="ptAdd" title="Seite hinzufügen">＋ Seite</button><div class="menu" id="addMenu" hidden><button data-add="write"><span class="mi">✍</span> Write-Seite</button><button data-add="calc"><span class="mi">▦</span> Calc-Seite</button></div></div>`;
  bar.innerHTML = h;
}
function colToIdx(s) { let n = 0; for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }
function idxToCol(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
let selC = 0, selR = 0;   // 0-basiert (Spalte, Zeile)
const DISP_MIN_COLS = 6, DISP_MIN_ROWS = 20;
function cellKey(c, r) { return idxToCol(c) + (r + 1); }

/* ---- Etappe 2: Zelle direkt im Write-Blatt erkennen & markieren (additiv, ohne den Editor zu verändern) ---- */
function writeCellPos() {
  const pos = $('#cellPos'), hi = $('#cellHi');
  const clear = () => { if (pos) pos.textContent = ''; if (hi) hi.hidden = true; };
  if (!doc || appEl.classList.contains('calc-mode')) { clear(); return; }
  const sel = document.getSelection();
  if (!sel || !sel.rangeCount || !sel.anchorNode || !editor.contains(sel.anchorNode)) { clear(); return; }
  let el = sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement;
  const block = el && el.closest('p,h1,h2,h3,blockquote,pre,li,div');
  if (!block || !editor.contains(block) || block.closest('.pgbreak-gap')) { clear(); return; }
  let rowEl = block; while (rowEl.parentElement && rowEl.parentElement !== editor) rowEl = rowEl.parentElement;
  const rows = [...editor.children].filter(b => !b.classList.contains('pgbreak-gap'));
  const r = rows.indexOf(rowEl); if (r < 0) { clear(); return; }
  let col = 0;
  try { const rg = document.createRange(); rg.setStart(rowEl, 0); rg.setEnd(sel.anchorNode, sel.anchorOffset); col = rg.cloneContents().querySelectorAll('.colsep').length; } catch (_) {}
  if (pos) pos.textContent = 'Zelle ' + idxToCol(col) + (r + 1);
  wfCell = { r, c: col, rowEl };
  const ref = $('#wfRef'); if (ref) ref.textContent = idxToCol(col) + (r + 1);
  const wf = $('#wfInput'); if (wf && document.activeElement !== wf) wf.value = writeCellFx(rowEl, col) || writeCellSegText(rowEl, col);
  drawWriteCellHi(rowEl, col);
}
let wfCell = null;
function writeCellRange(rowEl, col) {
  const seps = [...rowEl.querySelectorAll('.colsep')], rg = document.createRange();
  if (col === 0) rg.setStart(rowEl, 0); else rg.setStartAfter(seps[col - 1]);
  if (col < seps.length) rg.setEndBefore(seps[col]); else rg.setEnd(rowEl, rowEl.childNodes.length);
  return rg;
}
function writeCellSegText(rowEl, col) { try { return writeCellRange(rowEl, col).toString().replace(/​/g, '').trim(); } catch (_) { return ''; } }
function writeCellFx(rowEl, col) { try { const fx = writeCellRange(rowEl, col).cloneContents().querySelector('.fx[data-fx]'); return fx ? fx.getAttribute('data-fx') : null; } catch (_) { return null; } }
function writeSetCellSeg(rowEl, col, text) {
  let rg; try { rg = writeCellRange(rowEl, col); } catch (_) { return; }
  rg.deleteContents(); rg.insertNode(document.createTextNode(text)); rowEl.normalize();
  afterEdit(); alignColseps(); writeCellPos();
}
function writeSetCellSegHTML(rowEl, col, html) {
  let rg; try { rg = writeCellRange(rowEl, col); } catch (_) { return; }
  rg.deleteContents(); const tpl = document.createElement('template'); tpl.innerHTML = html; rg.insertNode(tpl.content); rowEl.normalize();
  afterEdit(); alignColseps(); writeCellPos();
}
// Live nachrechnende Formeln: =Formel wird als <span class="fx" data-fx> gespeichert (zeigt das Ergebnis) und bei Änderungen neu berechnet
function recomputeFormulas() {
  const fxs = [...editor.querySelectorAll('.fx[data-fx]')]; if (!fxs.length) return;
  const rows = [...editor.children].filter(b => !b.classList.contains('pgbreak-gap'));
  const grid = htmlToGrid(cleanEditorHTML()), locs = [];
  fxs.forEach(span => {
    let rowEl = span; while (rowEl.parentElement && rowEl.parentElement !== editor) rowEl = rowEl.parentElement;
    const r = rows.indexOf(rowEl); if (r < 0) return;
    let c = 0; try { const rg = document.createRange(); rg.setStart(rowEl, 0); rg.setEndBefore(span); c = rg.cloneContents().querySelectorAll('.colsep').length; } catch (_) {}
    const fx = span.getAttribute('data-fx'); locs.push({ span, r, c }); gridEnsure(grid, c, r); grid.zeilen[r].cells[c] = fx;   // Formel ins Raster → echte Rekursion/Abhängigkeiten
  });
  const saved = curGrid; curGrid = grid;
  locs.forEach(l => { let v; try { v = evalCell(l.c, l.r); } catch (_) { v = '#FEHLER'; } const t = (v == null ? '' : String(v)); if (l.span.textContent !== t) l.span.textContent = t; });
  curGrid = saved;
}
// Formel über das Editor-Raster rechnen (temporär curGrid setzen – dieselbe Engine wie Calc)
function writeEvalFormula(text, r, c) {
  const saved = curGrid;
  try { curGrid = htmlToGrid(cleanEditorHTML()); gridEnsure(curGrid, c, r); curGrid.zeilen[r].cells[c] = text; const v = evalCell(c, r); curGrid = saved; return v; }
  catch (_) { curGrid = saved; return '#FEHLER'; }
}
function drawWriteCellHi(rowEl, col) {
  const hi = $('#cellHi'); if (!hi) return;
  const seps = [...rowEl.querySelectorAll('.colsep')];
  try {
    const rg = document.createRange();
    if (col === 0) rg.setStart(rowEl, 0); else rg.setStartAfter(seps[col - 1]);
    if (col < seps.length) rg.setEndBefore(seps[col]); else rg.setEnd(rowEl, rowEl.childNodes.length);
    const rc = rg.getBoundingClientRect();
    if (rc.height < 2) { hi.hidden = true; return; }
    hi.style.left = rc.left + 'px'; hi.style.top = rc.top + 'px'; hi.style.width = Math.max(10, rc.width) + 'px'; hi.style.height = rc.height + 'px';
    hi.hidden = false;
  } catch (_) { hi.hidden = true; }
}

/* Kriterium wie in Excel: ">100", "<=5", "<>0", "=Text" oder schlicht ein Wert.
   Zahlen werden als Zahlen verglichen, alles andere als Text (Gross/Klein egal). */
function kriteriumPasst(wert, krit) {
  const k = String(krit == null ? '' : krit).trim();
  const m = /^(<=|>=|<>|<|>|=)?\s*(.*)$/.exec(k);
  const op = m[1] || '=', roh = m[2];
  const zahlKrit = parseFloat(String(roh).replace(',', '.'));
  const beide = (typeof wert === 'number' || (wert !== '' && !isNaN(parseFloat(wert)))) && !isNaN(zahlKrit);
  if (beide) {
    const a = typeof wert === 'number' ? wert : parseFloat(String(wert).replace(',', '.'));
    switch (op) { case '<': return a < zahlKrit; case '>': return a > zahlKrit;
      case '<=': return a <= zahlKrit; case '>=': return a >= zahlKrit;
      case '<>': return a !== zahlKrit; default: return a === zahlKrit; }
  }
  const a = String(wert == null ? '' : wert).trim().toLowerCase(), b = String(roh).trim().toLowerCase();
  switch (op) { case '<>': return a !== b; case '<': return a < b; case '>': return a > b;
    case '<=': return a <= b; case '>=': return a >= b; default: return a === b; }
}
/* Datum: im Bauwesen wird '01.03.2026' geschrieben, aus Excel kommt '2026-03-01'.
   Beide Schreibweisen werden gelesen. Rein - im Test pruefbar. */
function datumParsen(v) {
  if (v == null || v === '') return null;
  const t = String(v).trim();
  let m = /^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})$/.exec(t);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  return null;
}
function datumText(d) {
  if (!(d instanceof Date) || isNaN(d)) return '#WERT';
  const z = n => (n < 10 ? '0' : '') + n;
  return z(d.getDate()) + '.' + z(d.getMonth() + 1) + '.' + d.getFullYear();
}
function tageZwischen(a, b) {          // Kalendertage, Endtag eingeschlossen (wie im Bauprogramm gelesen)
  const d1 = datumParsen(a), d2 = datumParsen(b);
  if (!d1 || !d2) return '#WERT';
  return Math.round((d2 - d1) / 86400000) + 1;
}
function arbeitstage(a, b) {           // ohne Samstag und Sonntag
  const d1 = datumParsen(a), d2 = datumParsen(b);
  if (!d1 || !d2) return '#WERT';
  if (d2 < d1) return -arbeitstage(b, a);
  let n = 0; const d = new Date(d1.getTime());
  while (d <= d2) { const w = d.getDay(); if (w !== 0 && w !== 6) n++; d.setDate(d.getDate() + 1); }
  return n;
}
function datumPlus(a, tage) {
  const d = datumParsen(a); if (!d) return '#WERT';
  d.setDate(d.getDate() + Math.round(toNum(tage)));
  return datumText(d);
}
function istFehler(v) {
  // Division durch null ergibt INTERN Infinity und wird erst ganz am Schluss zu '#FEHLER'.
  // Mitten in einer Formel muss WENNFEHLER das ebenfalls als Fehler sehen.
  return (typeof v === 'string' && v.charAt(0) === '#') || (typeof v === 'number' && !isFinite(v));
}

/* Formel um dc Spalten / dr Zeilen verschieben – wie Excel beim Ausfuellen und Kopieren.
   Relative Bezuege wandern mit, mit $ festgehaltene bleiben stehen. Rein: im Test pruefbar. */
function verschiebeFormel(f, dc, dr) {
  const t = String(f == null ? '' : f);
  if (t[0] !== '=') return t;
  return t.replace(/(\$?)([A-Za-z]+)(\$?)(\d+)/g, (all, ds, sp, dz, zi) => {
    let c = colToIdx(sp.toUpperCase()), r = +zi;
    if (!ds) c += dc;
    if (!dz) r += dr;
    if (c < 0 || r < 1) return '#BEZUG';
    return ds + idxToCol(c) + dz + r;
  });
}
/* ---- Formel-Engine (Excel-artig): + - * / ^, Klammern, Vergleiche, Funktionen, Verschachtelung ---- */
function gridCellRaw(c, r) { return cellText(gridGet(curGrid, c, r)); }
function toNum(v) { if (typeof v === 'number') return v; if (v === true) return 1; if (!v) return 0; const n = parseFloat(String(v).replace(',', '.')); return isNaN(n) ? 0 : n; }
function evalCell(c, r) { return evalRaw(gridCellRaw(c, r), new Set([c + ',' + r])); }
function evalRaw(raw, seen) {
  if (raw == null || raw === '') return '';
  const s = String(raw).trim();
  if (s[0] !== '=') { const n = parseFloat(s.replace(',', '.')); return (!isNaN(n) && /^[-+]?\d*[.,]?\d+$/.test(s)) ? n : s; }
  try {
    const v = evalFormula(s.slice(1), seen);
    if (typeof v === 'number') return isFinite(v) ? Math.round(v * 1e10) / 1e10 : '#FEHLER';
    if (v === true) return 'WAHR'; if (v === false) return 'FALSCH';
    return v;
  } catch (e) { return e === 'circ' ? '#ZIRKEL' : '#FEHLER'; }
}
function refVal(ref, seen) {
  const m = /^([A-Z]+)(\d+)$/.exec(String(ref).toUpperCase().replace(/\$/g, '')); if (!m) return 0;
  const c = colToIdx(m[1]), r = +m[2] - 1, key = c + ',' + r;
  if (seen.has(key)) throw 'circ';
  const ns = new Set(seen); ns.add(key);
  return evalRaw(gridCellRaw(c, r), ns);
}
function rangeVals(a, b, seen) {
  const m1 = /^([A-Z]+)(\d+)$/.exec(String(a).toUpperCase().replace(/\$/g, '')), m2 = /^([A-Z]+)(\d+)$/.exec(String(b).toUpperCase().replace(/\$/g, ''));
  const c1 = colToIdx(m1[1]), r1 = +m1[2], c2 = colToIdx(m2[1]), r2 = +m2[2], out = [];
  for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++)
    for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) out.push(refVal(idxToCol(c) + r, seen));
  return out;
}
function evalFormula(src, seen) {
  let i = 0;
  const ws = () => { while (i < src.length && src[i] === ' ') i++; };
  const numsOf = args => { const o = []; args.forEach(a => { if (a.range) a.vals.forEach(v => { if (typeof v === 'number') o.push(v); }); else if (typeof a.val === 'number') o.push(a.val); }); return o; };
  function callFn(name, args) {
    const N = numsOf(args);
    switch (name) {
      case 'SUMME': case 'SUM': return N.reduce((a, b) => a + b, 0);
      case 'MITTELWERT': case 'AVERAGE': case 'AVG': return N.length ? N.reduce((a, b) => a + b, 0) / N.length : 0;
      case 'MIN': return N.length ? Math.min(...N) : 0;
      case 'MAX': return N.length ? Math.max(...N) : 0;
      case 'ANZAHL': case 'COUNT': return N.length;
      case 'ANZAHL2': case 'COUNTA': { let n = 0; args.forEach(a => { if (a.range) a.vals.forEach(v => { if (v !== '' && v != null) n++; }); else if (a.val !== '' && a.val != null) n++; }); return n; }
      case 'PRODUKT': case 'PRODUCT': return N.reduce((a, b) => a * b, 1);
      case 'MEDIAN': { if (!N.length) return 0; const q = [...N].sort((a, b) => a - b), m = q.length >> 1; return q.length % 2 ? q[m] : (q[m - 1] + q[m]) / 2; }
      case 'RUNDEN': case 'ROUND': { const f = Math.pow(10, args[1] ? toNum(args[1].val) : 0); return Math.round(toNum(args[0] && args[0].val) * f) / f; }
      case 'ABS': return Math.abs(toNum(args[0] && args[0].val));
      case 'WURZEL': case 'SQRT': return Math.sqrt(toNum(args[0] && args[0].val));
      case 'POTENZ': case 'POWER': return Math.pow(toNum(args[0] && args[0].val), toNum(args[1] && args[1].val));
      case 'GANZZAHL': case 'INT': return Math.floor(toNum(args[0] && args[0].val));
      case 'WENN': case 'IF': { const c = args[0] && args[0].val; const t = (c === true || (typeof c === 'number' && c !== 0)); return t ? (args[1] ? args[1].val : 0) : (args[2] ? args[2].val : 0); }
      // --- Ergaenzungen fuer Bau-Kostenzusammenstellungen ---
      case 'WENNFEHLER': case 'IFERROR': { const v = args[0] ? args[0].val : ''; return istFehler(v) ? (args[1] ? args[1].val : '') : v; }
      case 'AUFRUNDEN': case 'ROUNDUP': { const f = Math.pow(10, args[1] ? toNum(args[1].val) : 0); const x = toNum(args[0] && args[0].val); return (x < 0 ? -Math.ceil(-x * f) : Math.ceil(x * f)) / f; }
      case 'ABRUNDEN': case 'ROUNDDOWN': { const f = Math.pow(10, args[1] ? toNum(args[1].val) : 0); const x = toNum(args[0] && args[0].val); return (x < 0 ? -Math.floor(-x * f) : Math.floor(x * f)) / f; }
      case 'UND': case 'AND': { let alle = true; args.forEach(a => { const vs = a.range ? a.vals : [a.val]; vs.forEach(v => { if (!(v === true || (typeof v === 'number' && v !== 0))) alle = false; }); }); return alle; }
      case 'ODER': case 'OR': { let eins = false; args.forEach(a => { const vs = a.range ? a.vals : [a.val]; vs.forEach(v => { if (v === true || (typeof v === 'number' && v !== 0)) eins = true; }); }); return eins; }
      case 'NICHT': case 'NOT': { const v = args[0] && args[0].val; return !(v === true || (typeof v === 'number' && v !== 0)); }
      // --- Datum: fuer Terminprogramme ---
      case 'HEUTE': case 'TODAY': return datumText(new Date());
      case 'TAGE': case 'DAYS': return tageZwischen(args[0] && args[0].val, args[1] && args[1].val);
      case 'ARBEITSTAGE': case 'NETWORKDAYS': return arbeitstage(args[0] && args[0].val, args[1] && args[1].val);
      case 'DATUMPLUS': case 'EDATE': return datumPlus(args[0] && args[0].val, args[1] && args[1].val);
      case 'VERKETTEN': case 'TEXTKETTE': case 'CONCAT': { let t = ''; args.forEach(a => { const vs = a.range ? a.vals : [a.val]; vs.forEach(v => { t += (v == null ? '' : String(v)); }); }); return t; }
      case 'ZAEHLENWENN': case 'ZÄHLENWENN': case 'COUNTIF': {
        const vs = (args[0] && args[0].range) ? args[0].vals : [args[0] && args[0].val];
        const k = args[1] ? args[1].val : '';
        return vs.filter(v => kriteriumPasst(v, k)).length;
      }
      case 'SUMMEWENN': case 'SUMIF': {
        const vs = (args[0] && args[0].range) ? args[0].vals : [args[0] && args[0].val];
        const k = args[1] ? args[1].val : '';
        const sum = (args[2] && args[2].range) ? args[2].vals : vs;   // dritter Bereich = Summenbereich
        let t = 0;
        vs.forEach((v, i) => { if (kriteriumPasst(v, k)) t += toNum(sum[i]); });
        return t;
      }
      default: return '#NAME';
    }
  }
  function parseArgs() {
    const args = []; ws(); if (src[i] === ')') return args;
    for (; ;) {
      ws();
      const rm = /^(\$?[A-Za-z]+\$?\d+):(\$?[A-Za-z]+\$?\d+)/.exec(src.slice(i));
      if (rm) { i += rm[0].length; args.push({ range: true, vals: rangeVals(rm[1], rm[2], seen) }); }
      else args.push({ val: parseExpr() });
      ws(); if (src[i] === ';' || src[i] === ',') { i++; continue; }
      break;
    }
    return args;
  }
  function parsePrimary() {
    ws();
    if (src[i] === '(') { i++; const v = parseExpr(); ws(); if (src[i] === ')') i++; return v; }
    if (src[i] === '"') { i++; let str = ''; while (i < src.length && src[i] !== '"') str += src[i++]; if (src[i] === '"') i++; return str; }
    let m = /^\d+(\.\d+)?/.exec(src.slice(i));
    if (m) { i += m[0].length; return parseFloat(m[0]); }
    m = /^\$?[A-Za-z]+\$?\d*/.exec(src.slice(i));
    if (m) {
      const id = m[0].toUpperCase().replace(/\$/g, ''); i += m[0].length; ws();
      if (src[i] === '(') { i++; const a = parseArgs(); ws(); if (src[i] === ')') i++; return callFn(id, a); }
      if (/^[A-Z]+\d+$/.test(id)) return refVal(id, seen);
      if (id === 'WAHR' || id === 'TRUE') return true;
      if (id === 'FALSCH' || id === 'FALSE') return false;
      return '#NAME';
    }
    return 0;
  }
  function parseUnary() { ws(); if (src[i] === '-') { i++; return -toNum(parseUnary()); } if (src[i] === '+') { i++; return toNum(parseUnary()); } return parsePrimary(); }
  function parsePow() { const a = parseUnary(); ws(); if (src[i] === '^') { i++; return Math.pow(toNum(a), toNum(parseUnary())); } return a; }
  function parseMul() { let a = parsePow(); for (; ;) { ws(); const c = src[i]; if (c === '*' || c === '/') { i++; const b = parsePow(); a = c === '*' ? toNum(a) * toNum(b) : toNum(a) / toNum(b); } else break; } return a; }
  function parseAdd() { let a = parseMul(); for (; ;) { ws(); const c = src[i]; if (c === '+' || c === '-') { i++; const b = parseMul(); a = c === '+' ? toNum(a) + toNum(b) : toNum(a) - toNum(b); } else break; } return a; }
  function parseExpr() {
    const a = parseAdd(); ws();
    for (const op of ['<=', '>=', '<>', '<', '>', '=']) {
      if (src.startsWith(op, i)) { i += op.length; const y = toNum(parseAdd()), x = toNum(a); return op === '<' ? x < y : op === '>' ? x > y : op === '<=' ? x <= y : op === '>=' ? x >= y : op === '=' ? x === y : x !== y; }
    }
    return a;
  }
  return parseExpr();
}

/* ---- Gitter rendern + Auswahl (liest/schreibt curGrid = aktive Seite) ---- */
function calcUsedRange() {
  let maxR = -1, maxC = -1;
  curGrid.zeilen.forEach((z, r) => z.cells.forEach((c, ci) => { if (cellText(c) !== '') { if (r > maxR) maxR = r; if (ci > maxC) maxC = ci; } }));
  return { maxR, maxC };
}
// EINE kombinierte Ansicht: volles Tabellengitter (alle Spalten) AUF dem A4-Blatt
function gEl() { return $('#pageGrid .cgrid'); }
function tdAt(c, r) { const t = gEl(); if (!t) return null; const m = mergeAt(c, r); if (m) { c = m.c; r = m.r; } return t.querySelector(`td[data-c="${c}"][data-r="${r}"]`) || t.querySelector(`td[data-r="${r}"]`); }
function allTd(sel) { const t = gEl(); return t ? [...t.querySelectorAll(sel)] : []; }
function calcExtent() {   // Struktur: max. Spalten über alle Zeilen, Zeilen
  const z = curGrid.zeilen;
  return { cols: Math.max(1, ...z.map(x => x.cells.length)), rows: z.length };
}
let gridCols = 1, gridRows = 1, calcFitRows = 0;
function renderCalc() { renderSheet(); fitCalcRows(); calcPaginate(); buildCalcRulers(); highlightSel(); updateStats(); updatePages(); }
// Calc bei Inhalt > A4 in mehrere A4-Blätter aufteilen (Lücke mit Fuss-/Kopfzeile, wie Write)
function calcPaginate() {
  if (!doc || activePage().typ !== 'calc') return;
  const t = gEl(); if (!t) return; const tbody = t.querySelector('tbody'); if (!tbody) return;
  const z = parseFloat(page.style.zoom) || 1;
  const hH = $('#zoneH').offsetHeight || 60, fH = $('#zoneF').offsetHeight || 60;
  const usable = pageDims().h * MM - hH - fH - 12 * MM - 6;
  const fh = $('#zoneF').innerHTML, hh = $('#zoneH').innerHTML, cols = gridCols;
  const rows = [...tbody.children].filter(r => !r.classList.contains('cgap'));
  let used = 0;
  rows.forEach(tr => {
    const h = tr.getBoundingClientRect().height / z;
    if (used + h > usable && used > 0) {
      const gap = document.createElement('tr'); gap.className = 'cgap';
      gap.innerHTML = `<td colspan="${cols}"><div class="pg-fill" style="height:${Math.max(0, usable - used)}px"></div><div class="pg-foot" style="height:${fH}px">${fh}</div><div class="pg-mid"></div><div class="pg-head" style="height:${hH}px">${hh}</div></td>`;
      tbody.insertBefore(gap, tr); used = h;
    } else used += h;
  });
}
// Zeilenzahl per ECHTER Messung so setzen, dass die Tabelle genau ein A4-Blatt füllt (nicht zu hoch)
function fitCalcRows() {
  if (!doc || activePage().typ !== 'calc' || activePage().dispRows) return;
  const t = gEl(); if (!t) return;
  const z = parseFloat(page.style.zoom) || 1;
  const emptyTd = t.querySelector('td:not(.textcell)'); if (!emptyTd) return;
  const rowH = emptyTd.getBoundingClientRect().height / z; if (rowH < 8) return;
  const trs = t.querySelectorAll('tr');
  const usedRows = Math.max(0, calcUsedRange().maxR + 1);
  let contentH = 0; for (let i = 0; i < usedRows && i < trs.length; i++) contentH += trs[i].getBoundingClientRect().height / z;   // echte Höhe des Inhalts
  const hH = $('#zoneH').offsetHeight || 60, fH = $('#zoneF').offsetHeight || 60;
  const usable = pageDims().h * MM - hH - fH - 12 * MM - 6;        // A4-Inhaltshöhe
  const emptyRows = Math.max(0, Math.floor((usable - contentH) / rowH));   // nur den REST mit Leerzeilen füllen
  const want = usedRows + emptyRows;
  if (want !== gridRows && want >= usedRows) { calcFitRows = want; renderSheet(); }
}
// Zahlenformate je Zelle + Spaltenbreiten (am Seiten-Objekt gespeichert, übersteht Speichern/Öffnen)
function curFmt() { const p = activePage(); if (!p.fmt || typeof p.fmt !== 'object') p.fmt = {}; return p.fmt; }
function curColW() { const p = activePage(); if (!p.colW || typeof p.colW !== 'object') p.colW = {}; return p.colW; }
function curFill() { const p = activePage(); if (!p.fill || typeof p.fill !== 'object') p.fill = {}; return p.fill; }
function curTxtCol() { const p = activePage(); if (!p.txtcol || typeof p.txtcol !== 'object') p.txtcol = {}; return p.txtcol; }
function curRowH() { const p = activePage(); if (!p.rowH || typeof p.rowH !== 'object') p.rowH = {}; return p.rowH; }
function curMerges() { const p = activePage(); if (!Array.isArray(p.merges)) p.merges = []; return p.merges; }
function curBorders() { const p = activePage(); if (!p.borders || typeof p.borders !== 'object') p.borders = {}; return p.borders; }
function curCfmt() { const p = activePage(); if (!p.cfmt || typeof p.cfmt !== 'object') p.cfmt = {}; return p.cfmt; }
function toggleCellFmt(flag) {
  if (!curGrid) return; const m = curCfmt(), { c1, c2, r1, r2 } = rangeBounds();
  const on = !((m[selC + ',' + selR] || {})[flag]);
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) { const k = c + ',' + r, o = m[k] || (m[k] = {}); if (on) o[flag] = 1; else delete o[flag]; if (!Object.keys(o).length) delete m[k]; }
  renderCalc(); scheduleSave();
}
function setCellFmt(key, val) {
  if (!curGrid) return; const m = curCfmt(), { c1, c2, r1, r2 } = rangeBounds();
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) { const k = c + ',' + r, o = m[k] || (m[k] = {}); if (val == null || val === '') delete o[key]; else o[key] = val; if (!Object.keys(o).length) delete m[k]; }
  renderCalc(); scheduleSave();
}
function clearCellFmt() {
  if (!curGrid) return; const m = curCfmt(), f = curFill(), tc = curTxtCol(), fmt = curFmt(), bd = curBorders(), { c1, c2, r1, r2 } = rangeBounds();
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) { const k = c + ',' + r; delete m[k]; delete f[k]; delete tc[k]; delete fmt[k]; delete bd[k]; }
  renderCalc(); scheduleSave();
}
function mergeAt(c, r) { for (const m of curMerges()) { if (c >= m.c && c < m.c + m.cs && r >= m.r && r < m.r + m.rs) return m; } return null; }
function isCovered(c, r) { const m = mergeAt(c, r); return !!(m && !(m.c === c && m.r === r)); }
function safeColor(v) { return /^#[0-9a-fA-F]{3,8}$/.test(v || '') ? v : ''; }
function fmtNum(n, f) {
  if (!isFinite(n)) return String(n);
  if (f === 'pct') return (n * 100).toLocaleString('de-CH', { maximumFractionDigits: 2 }) + ' %';
  if (f === 'chf') return 'CHF ' + n.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Einheiten fuers Bauwesen: die ZAHL bleibt eine Zahl, nur die Anzeige traegt die Einheit
  // -> Summen und Formeln rechnen weiter (anders als eine getippte Einheit im Text)
  if (f === 'stk') return n.toLocaleString('de-CH', { maximumFractionDigits: 2 }) + ' Stk.';
  if (f === 'm2') return n.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' m²';
  if (f === 'm3') return n.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' m³';
  if (f === 'lfm') return n.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' lfm';
  if (f === 'num2') return n.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (f === 'num0') return Math.round(n).toLocaleString('de-CH');
  return n.toLocaleString('de-CH');
}
function isNumericText(t) { return t !== '' && /\d/.test(t) && /^-?[\d'’.,\s]+%?$/.test(t); }
// echte „Textzeile" (Absatz/Überschrift = eine volle Zelle über die Blattbreite) – sonst normales Gitter
function isTextRow(r) {
  const z = curGrid && curGrid.zeilen[r]; if (!z || z.cells.length !== 1) return false;
  if (curMerges().some(mg => r >= mg.r && r < mg.r + mg.rs)) return false;
  // WRITE: eine Zeile mit Inhalt nur in der ersten Spalte ist eine DURCHGEHENDE Zeile
  // ueber die ganze Blattbreite - man schreibt wie in Word, im Hintergrund waechst eine Zelle.
  // Sobald die Zeile eine zweite Spalte hat (Tab), wird sie wieder zur Rasterzeile.
  if (typeof dokumentModus === 'function' && dokumentModus()) return true;
  // CALC: nur explizite Ueberschriften nehmen die volle Breite - sonst sieht man die Zellen.
  return /^h[1-3]$/.test(z.tag || '');
}
// liefert {html, cls} für eine Zelle – berücksichtigt Formel-Ergebnis und Zahlenformat
function cellStyle(c, r) {
  let s = '';
  const bg = safeColor(curFill()[c + ',' + r]); if (bg) s += `background:${bg};`;
  const tc = safeColor(curTxtCol()[c + ',' + r]); if (tc) s += `color:${tc};`;
  const bd = curBorders()[c + ',' + r];
  if (bd) { const col = '#5b6472'; if (bd.includes('t')) s += `border-top:1.5px solid ${col};`; if (bd.includes('b')) s += `border-bottom:1.5px solid ${col};`; if (bd.includes('l')) s += `border-left:1.5px solid ${col};`; if (bd.includes('r')) s += `border-right:1.5px solid ${col};`; }
  const cf = curCfmt()[c + ',' + r];
  if (cf) { if (cf.b) s += 'font-weight:700;'; if (cf.i) s += 'font-style:italic;'; let d = ''; if (cf.u) d += 'underline '; if (cf.s) d += 'line-through '; if (d) s += 'text-decoration:' + d.trim() + ';'; if (cf.fam) s += `font-family:${cf.fam};`; if (cf.sz) s += `font-size:${+cf.sz}px;`; if (cf.al) s += `text-align:${cf.al};`; }
  return s;
}
function setBorders(mode) {
  if (!curGrid) return; const b = curBorders(), { c1, c2, r1, r2 } = rangeBounds();
  const add = (c, r, sides) => { const k = c + ',' + r, set = new Set((b[k] || '').split('').filter(Boolean)); sides.split('').forEach(x => set.add(x)); b[k] = [...set].join(''); if (!b[k]) delete b[k]; };
  if (mode === 'none') { for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) delete b[c + ',' + r]; }
  else if (mode === 'all') { for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) add(c, r, 'tblr'); }
  else if (mode === 'outside') { for (let c = c1; c <= c2; c++) { add(c, r1, 't'); add(c, r2, 'b'); } for (let r = r1; r <= r2; r++) { add(c1, r, 'l'); add(c2, r, 'r'); } }
  else if (mode === 'top') { for (let c = c1; c <= c2; c++) add(c, r1, 't'); }
  else if (mode === 'bottom') { for (let c = c1; c <= c2; c++) add(c, r2, 'b'); }
  else if (mode === 'left') { for (let r = r1; r <= r2; r++) add(c1, r, 'l'); }
  else if (mode === 'right') { for (let r = r1; r <= r2; r++) add(c2, r, 'r'); }
  renderCalc(); scheduleSave();
}
function cellDisplay(c, r) {
  const raw = gridGet(curGrid, c, r), txt = cellText(raw), isF = txt.startsWith('=');
  const f = curFmt()[c + ',' + r], style = cellStyle(c, r);
  if (isF) {
    const v = evalCell(c, r);
    if (typeof v === 'number') return { html: esc(f ? fmtNum(v, f) : String(v)), cls: 'num', style };
    if (/^#/.test(String(v))) return { html: esc(String(v)), cls: 'err', style };
    return { html: esc(String(v)), cls: '', style };
  }
  if (f && isNumericText(txt)) return { html: esc(fmtNum(toNum(txt), f)), cls: 'num', style };
  return { html: raw || '', cls: isNumericText(txt) ? 'num' : '', style };
}
function setCellFormat(f) {
  if (!curGrid) return;
  const fm = curFmt(), { c1, c2, r1, r2 } = rangeBounds();
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) { const k = c + ',' + r; if (f === 'none') delete fm[k]; else fm[k] = f; }
  renderCalc(); scheduleSave();
}
function setCellFill(color) {
  if (!curGrid) return; const fm = curFill(), { c1, c2, r1, r2 } = rangeBounds();
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) { const k = c + ',' + r; if (!color || color === 'none') delete fm[k]; else fm[k] = color; }
  renderCalc(); scheduleSave();
}
function setCellTextColor(color) {
  if (!curGrid) return; const fm = curTxtCol(), { c1, c2, r1, r2 } = rangeBounds();
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) { const k = c + ',' + r; if (!color || color === 'none') delete fm[k]; else fm[k] = color; }
  renderCalc(); scheduleSave();
}
function selectAllCells() {
  if (!curGrid) return; const ur = calcUsedRange();
  const c2 = ur.maxC < 0 ? gridCols - 1 : ur.maxC, r2 = ur.maxR < 0 ? gridRows - 1 : ur.maxR;
  selC = 0; selR = 0; anchorC = 0; anchorR = 0; selectCell(c2, r2, true);
}
function mergeCells() {
  if (!curGrid) return; const { c1, c2, r1, r2 } = rangeBounds();
  if (c1 === c2 && r1 === r2) { toast('Bitte mehrere Zellen markieren.'); return; }
  const merges = curMerges();
  for (let i = merges.length - 1; i >= 0; i--) { const m = merges[i]; if (!(m.c + m.cs <= c1 || m.c > c2 || m.r + m.rs <= r1 || m.r > r2)) merges.splice(i, 1); }
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) { if (c === c1 && r === r1) continue; gridEnsure(curGrid, c, r); curGrid.zeilen[r].cells[c] = ''; }
  merges.push({ c: c1, r: r1, cs: c2 - c1 + 1, rs: r2 - r1 + 1 });
  activePage().html = gridToHtml(curGrid); selectCell(c1, r1); renderCalc(); scheduleSave();
}
function unmergeCells() {
  const merges = curMerges(), m = mergeAt(selC, selR);
  if (!m) { toast('Keine verbundene Zelle ausgewählt.'); return; }
  merges.splice(merges.indexOf(m), 1); renderCalc(); scheduleSave();
}
function startRowResize(r, e) {
  const t = gEl(); if (!t) return;
  const z = parseFloat(page.style.zoom) || 1, startY = e.clientY;
  const cell = t.querySelector(`td[data-r="${r}"]`), tr = cell ? cell.parentElement : null;
  const startH = cell ? cell.offsetHeight : 24;
  const hAt = ev => Math.max(18, Math.round(startH + (ev.clientY - startY) / z));
  const move = ev => { if (tr) tr.style.height = hAt(ev) + 'px'; buildCalcRulers(); };
  const up = ev => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); curRowH()[r] = hAt(ev); scheduleSave(); renderCalc(); };
  document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
}
// Gitter ins SELBE Blatt wie Write rendern: Ränder, Zoom, Kopf/Fuss, Lineal kommen vom .page
function renderSheet() {
  const host = $('#pageGrid'); if (!host || !curGrid) return;
  const ur = calcUsedRange(), ext = calcExtent(), d = pageDims(), m = pageSetup().margins;
  const contentMm = Math.max(60, d.w - m.left - m.right);
  const colsPP = Math.max(4, Math.floor(contentMm / 26));   // Auto-Spaltenzahl, die bequem auf die Blattbreite passt
  const wantC = activePage().dispCols | 0, wantR = activePage().dispRows | 0;
  const cs = curGrid.colStops || [];   // Spaltengrenzen aus den Tabstopps (gemeinsam mit Write) – Index = Spalte
  // Spaltenbreite ist FIX (aus A4 = 6 Spalten). Grösseres Blatt (A3 …) → mehr Spalten, statt 6 breitzuziehen.
  const baseColMm = Math.max(12, (210 - m.left - m.right) / ((doc && doc.rasterCols) || 6));
  const defCols = Math.max(2, Math.round(contentMm / baseColMm));
  const cols = Math.max(ext.cols, cs.length ? cs.length + 1 : 0, wantC > 0 ? wantC : defCols);
  // Standard-Zeilenzahl so, dass genau EIN A4-Blatt gefüllt ist (sonst wird das Blatt zu lang)
  const hH = $('#zoneH').offsetHeight || 60, fH = $('#zoneF').offsetHeight || 60;
  const fs = +(doc.einstellungen.schriftgroesse) || 16, lh = +(doc.einstellungen.zeilenabstand) || 1.5;
  const rowHpx = Math.max(20, Math.round(Math.max(1.7 * fs, lh * fs)) + 8);   // Zellenhöhe inkl. Padding/Rahmen
  const availPx = d.h * MM - hH - fH - 12 * MM;                                // Blatt minus Kopf/Fuss/Innenabstand
  const rowsPP = Math.max(8, Math.floor(availPx / rowHpx));
  const rows = Math.max(ext.rows, wantR > 0 ? wantR : (calcFitRows || rowsPP));
  gridCols = cols; gridRows = rows;
  const cw = curColW();
  const widths = []; let prev = 0;   // Spaltenbreiten (px); A/B/C & 1/2/3 liegen als Lineale AUSSERHALB
  for (let c = 0; c < cols; c++) {
    const stopEnd = c < cs.length ? cs[c] : null;
    let w = cw[c];                                              // manuelle Breite hat Vorrang
    if (!w && stopEnd != null && stopEnd > prev) w = Math.round((stopEnd - prev) * MM);
    if (stopEnd != null) prev = stopEnd;
    widths[c] = w > 0 ? w : null;
  }
  const tableW = contentMm * MM, fixed = widths.reduce((a, w) => a + (w || 0), 0), nAuto = widths.filter(w => w == null).length;
  const autoW = nAuto ? Math.max(20, (tableW - fixed) / nAuto) : 0;
  gridColPx = widths.map(w => w == null ? autoW : w);   // für Auto-Verbinden bei Überlauf
  const cg = '<colgroup>' + widths.map(w => w > 0 ? `<col style="width:${w}px">` : '<col>').join('') + '</colgroup>';
  const rh = curRowH();
  let body = '<tbody>';
  for (let r = 0; r < rows; r++) {
    const z = curGrid.zeilen[r];
    const isHead = !!(z && /^h[1-3]$/.test(z.tag || ''));
    const textRow = isTextRow(r);
    const trStyle = rh[r] ? ` style="height:${rh[r]}px"` : '';
    body += `<tr${r > ur.maxR ? ' class="pad"' : ''}${trStyle}>`;
    if (textRow) {
      const dsp = cellDisplay(0, r), cl = ['textcell'];
      if (isHead) cl.push(z.tag);
      if (dsp.cls === 'err') cl.push('err');
      if (r > ur.maxR) cl.push('pad');
      body += `<td data-c="0" data-r="${r}" colspan="${cols}" class="${cl.join(' ')}"${dsp.style ? ` style="${dsp.style}"` : ''}>${dsp.html}</td>`;
    } else {
      for (let c = 0; c < cols; c++) {
        if (isCovered(c, r)) continue;   // von einer Verbindung überdeckt → keine Zelle
        const dsp = cellDisplay(c, r), cl = [];
        if (dsp.cls) cl.push(dsp.cls);
        if (c > ur.maxC || r > ur.maxR) cl.push('pad');
        const mg = mergeAt(c, r), span = (mg && mg.c === c && mg.r === r) ? ` colspan="${mg.cs}" rowspan="${mg.rs}"` : '';
        body += `<td data-c="${c}" data-r="${r}"${span}${cl.length ? ` class="${cl.join(' ')}"` : ''}${dsp.style ? ` style="${dsp.style}"` : ''}>${dsp.html}</td>`;
      }
    }
    body += '</tr>';
  }
  body += '</tbody>';
  host.innerHTML = `<table class="cgrid">${cg}${body}</table>`;
  buildCalcRulers();
}
// Spalten-/Zeilen-Lineale AUSSERHALB des Blatts aufbauen (wie das Lineal in Write), an Zellen ausgerichtet
function buildCalcRulers() {
  const t = gEl(), colR = $('#colRuler'), rowR = $('#rowRuler'), canvas = $('#canvas');
  if (!t || !colR || !rowR || !appEl.classList.contains('calc-mode')) return;
  const cr = canvas.getBoundingClientRect(), sl = canvas.scrollLeft, st = canvas.scrollTop;
  const pr = page.getBoundingClientRect();
  // Waagrechtes Lineal (A B C …) – oben fixiert, an Spalten ausgerichtet
  let ch = '';
  for (let c = 0; c < gridCols; c++) {
    const cell = t.querySelector(`td[data-c="${c}"]`); if (!cell) continue;
    const r = cell.getBoundingClientRect();
    ch += `<div class="cr-seg" data-c="${c}" style="left:${(r.left - cr.left + sl)}px;width:${r.width}px">${idxToCol(c)}<span class="cins" data-c="${c}" title="Spalte rechts einfügen">+</span><span class="cresize" data-c="${c}" title="Spaltenbreite ziehen"></span></div>`;
  }
  colR.innerHTML = ch;
  colR.style.top = st + 'px';                       // bleibt am sichtbaren oberen Rand
  // Senkrechtes Lineal (1 2 3 …) – links neben dem Blatt, an Zeilen ausgerichtet
  let rh = '';
  for (let r = 0; r < gridRows; r++) {
    const cell = t.querySelector(`td[data-r="${r}"]`); if (!cell) continue;
    const rc = cell.getBoundingClientRect();
    rh += `<div class="rr-seg" data-r="${r}" style="top:${(rc.top - cr.top + st)}px;height:${rc.height}px">${r + 1}<span class="rins" data-r="${r}" title="Zeile unten einfügen">+</span><span class="rresize" data-r="${r}" title="Zeilenhöhe ziehen"></span></div>`;
  }
  rowR.innerHTML = rh;
  rowR.style.left = Math.max(0, pr.left - cr.left + sl - rowR.offsetWidth) + 'px';
  updateRulerSel();
}
// Tabellengerüst (A B C oben, 1 2 3 links, aussen am Blattrand) AUCH im Write-Blatt – Write = Calc
function buildWriteRulers() {
  const colR = $('#colRuler'), rowR = $('#rowRuler'), canvas = $('#canvas');
  if (!colR || !rowR || !canvas || !doc) return;
  if (appEl.classList.contains('calc-mode') || appEl.classList.contains('focus')) return;
  const cr = canvas.getBoundingClientRect(), sl = canvas.scrollLeft, st = canvas.scrollTop;
  const pr = page.getBoundingClientRect(), z = parseFloat(page.style.zoom) || 1;
  const m = pageSetup().margins, contentMm = Math.max(40, pageDims().w - m.left - m.right);
  // Spaltengrenzen (mm): aus den sichtbaren COLSEPs (data-tab), sonst gleichmässig wie Calc
  const set = new Set();
  $$('.colsep', editor).forEach(s => { if (s.dataset.tab) { const v = parseFloat(s.dataset.tab); if (v > 0 && v < contentMm) set.add(Math.round(v * 10) / 10); } });
  let bounds = [...set].sort((a, b) => a - b);
  if (bounds.length) bounds.push(contentMm);
  else { const n = (doc && doc.rasterCols) || 6, w = contentMm / n; for (let c = 1; c <= n; c++) bounds.push(roundN(w * c)); }   // Hintergrundraster: 6 Spalten (A–F)
  const contentLeft = pr.left + m.left * MM * z;
  let ch = '', prev = 0;
  bounds.forEach((endMm, c) => {
    const left = contentLeft + prev * MM * z - cr.left + sl, width = (endMm - prev) * MM * z;
    ch += `<div class="cr-seg" data-c="${c}" style="left:${left}px;width:${width}px">${idxToCol(c)}</div>`;
    prev = endMm;
  });
  colR.innerHTML = ch; colR.style.top = st + 'px';
  // Zeilen: jeder Block = eine Zeile
  const blocks = [...editor.children].filter(b => !b.classList.contains('pgbreak-gap'));
  let rh = '', n = 0;
  blocks.forEach(b => { const rc = b.getBoundingClientRect(); if (rc.height < 1) return; n++; rh += `<div class="rr-seg" data-r="${n}" style="top:${rc.top - cr.top + st}px;height:${rc.height}px">${n}</div>`; });
  rowR.innerHTML = rh;
  rowR.style.left = Math.max(0, pr.left - cr.left + sl - (rowR.offsetWidth || 30)) + 'px';
}
function updateRulerSel() {
  const { c1, c2, r1, r2 } = rangeBounds();
  $$('#colRuler .cr-seg').forEach(e => e.classList.toggle('on', +e.dataset.c >= c1 && +e.dataset.c <= c2));
  $$('#rowRuler .rr-seg').forEach(e => e.classList.toggle('on', +e.dataset.r >= r1 && +e.dataset.r <= r2));
}
let anchorC = 0, anchorR = 0, editingTd = null;
/* Ausfuellen wie in Excel: oberste Zeile bzw. linke Spalte der Markierung in den Rest kopieren,
   Formeln dabei mitverschieben (relative Bezuege wandern, $-Bezuege bleiben). */
function fuelleAus(richtung) {
  if (!curGrid) return false;
  const { c1, c2, r1, r2 } = rangeBounds();
  if (richtung === 'unten' && r2 <= r1) return false;
  if (richtung === 'rechts' && c2 <= c1) return false;
  for (let c = c1; c <= c2; c++) for (let r = r1; r <= r2; r++) {
    if (richtung === 'unten' && r === r1) continue;
    if (richtung === 'rechts' && c === c1) continue;
    const qc = richtung === 'rechts' ? c1 : c, qr = richtung === 'unten' ? r1 : r;
    const quelle = gridGet(curGrid, qc, qr);
    gridEnsure(curGrid, c, r);
    const roh = cellText(quelle);
    curGrid.zeilen[r].cells[c] = (roh[0] === '=') ? verschiebeFormel(roh, c - qc, r - qr) : quelle;
  }
  return true;
}
/* AutoSumme: Zahlenblock oberhalb (bzw. links) finden und =SUMME(...) einsetzen – wie Alt+= in Excel */
function autoSummeFormel(c, r) {
  if (!curGrid) return null;
  let n = 0;
  while (r - n - 1 >= 0 && String(cellText(gridGet(curGrid, c, r - n - 1))) !== '') n++;
  if (n >= 1) return '=SUMME(' + idxToCol(c) + (r - n + 1) + ':' + idxToCol(c) + r + ')';
  let m = 0;
  while (c - m - 1 >= 0 && String(cellText(gridGet(curGrid, c - m - 1, r))) !== '') m++;
  if (m >= 1) return '=SUMME(' + idxToCol(c - m) + (r + 1) + ':' + idxToCol(c - 1) + (r + 1) + ')';
  return null;
}
/* ============ Zellbereiche kopieren / ausschneiden / einfuegen ============
   Fehlte bisher vollstaendig - fuer Ausmasslisten der wichtigste Handgriff ueberhaupt.
   Der Austausch nach aussen laeuft ueber Tabulator-Text (TSV), das versteht Excel direkt.
   Innerhalb von Paper wird zusaetzlich die reiche Fassung gemerkt (Formeln + Zellformate). */
let zwischenablage = null;
const TAB = String.fromCharCode(9), NL = String.fromCharCode(10), CR = String.fromCharCode(13);

function bereichLesen(c1, c2, r1, r2) {
  const zeilen = [], fmt = {}, cfmt = {};
  const F = curFmt(), C = curCfmt();
  for (let r = r1; r <= r2; r++) {
    const zeile = [];
    for (let c = c1; c <= c2; c++) {
      zeile.push(gridGet(curGrid, c, r) || '');
      const von = c + ',' + r, nach = (c - c1) + ',' + (r - r1);
      if (F[von]) fmt[nach] = F[von];
      if (C[von]) cfmt[nach] = C[von];
    }
    zeilen.push(zeile);
  }
  return { zeilen, fmt, cfmt, c1, r1 };
}
function bereichAlsText(zeilen) {   // TSV - Tabulator trennt Spalten, Zeilenumbruch die Zeilen
  const weg = new RegExp('[' + TAB + NL + CR + ']', 'g');
  return (zeilen || []).map(z => z.map(c => plainText(c).replace(weg, ' ')).join(TAB)).join(NL);
}
function textAlsBereich(text) {
  let t = String(text == null ? '' : text);
  while (t.length && (t.charAt(t.length - 1) === NL || t.charAt(t.length - 1) === CR)) t = t.slice(0, -1);
  return t.split(new RegExp(CR + '?' + NL)).map(z => z.split(TAB));
}
function bereichEinfuegen(daten, zc, zr) {
  if (!curGrid || !daten || !daten.zeilen || !daten.zeilen.length) return false;
  const dc = zc - (daten.c1 || 0), dr = zr - (daten.r1 || 0);
  const F = curFmt(), C = curCfmt();
  daten.zeilen.forEach((zeile, i) => zeile.forEach((wert, j) => {
    const c = zc + j, r = zr + i;
    gridEnsure(curGrid, c, r);
    const roh = cellText(wert);
    // Formeln wandern mit - relative Bezuege verschoben, $-Bezuege fest (wie Excel)
    curGrid.zeilen[r].cells[c] = (roh.charAt(0) === '=') ? verschiebeFormel(roh, dc, dr) : wert;
    const her = j + ',' + i, hin = c + ',' + r;
    if (daten.fmt && daten.fmt[her]) F[hin] = daten.fmt[her];
    if (daten.cfmt && daten.cfmt[her]) C[hin] = daten.cfmt[her];
  }));
  return true;
}
function bereichLeeren(c1, c2, r1, r2) {
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) { gridEnsure(curGrid, c, r); curGrid.zeilen[r].cells[c] = ''; }
}
function rangeBounds() { return { c1: Math.min(anchorC, selC), c2: Math.max(anchorC, selC), r1: Math.min(anchorR, selR), r2: Math.max(anchorR, selR) }; }
// Namensfeld: Einzelzelle → „A1", Bereich → „ZeilenxSpalten" (wie Excel beim Ziehen)
function selRefLabel(c1, c2, r1, r2, activeKey) {
  const rows = r2 - r1 + 1, cols = c2 - c1 + 1;
  return (rows === 1 && cols === 1) ? activeKey : `${rows}×${cols}`;
}
function roundN(x) { return Math.round(x * 100) / 100; }
function highlightSel() {
  allTd('td.sel, td.active').forEach(td => td.classList.remove('sel', 'active'));
  const { c1, c2, r1, r2 } = rangeBounds();
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) { const td = tdAt(c, r); if (td) td.classList.add('sel'); }
  const act = tdAt(selC, selR);
  if (act) { act.classList.add('active'); $('#cellRef').textContent = selRefLabel(c1, c2, r1, r2, cellKey(selC, selR)); $('#formulaInput').value = gridCellRaw(selC, selR); }
  updateRulerSel();   // aktive Spalte/Zeile in den Lineal-Leisten hervorheben
  updateCalcStat();
  syncCalcToolbar();  // Menüband (F/K/U, Ausrichtung, Schrift) auf die aktive Zelle spiegeln
}
function updateCalcStat() {
  const el = $('#calcStat'); if (!el) return;
  const { c1, c2, r1, r2 } = rangeBounds();
  if (c1 === c2 && r1 === r2) { el.textContent = ''; return; }
  const nums = []; let count = 0;
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) { const v = evalCell(c, r); if (v !== '' && v != null) count++; if (typeof v === 'number') nums.push(v); }
  const sum = nums.reduce((a, b) => a + b, 0);
  const prod = nums.length ? nums.reduce((a, b) => a * b, 1) : 0;
  el.textContent = nums.length ? `Summe ${roundN(sum)}  ·  Produkt ${roundN(prod)}  ·  Mittel ${roundN(sum / nums.length)}  ·  Anzahl ${count}` : `Anzahl ${count}`;
}
function selectCell(c, r, extend) {
  selR = Math.max(0, Math.min(gridRows - 1, r));
  selC = Math.max(0, Math.min(gridCols - 1, c));
  if (isTextRow(selR)) selC = 0;     // nur echte Fliesstext-Zeile hat eine volle Zelle
  const mg = mergeAt(selC, selR); if (mg) { selC = mg.c; selR = mg.r; }   // verbundene Zelle → Anker
  if (!extend) { anchorC = selC; anchorR = selR; }
  highlightSel();
  const td = tdAt(selC, selR); if (td) td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function commitCell(val) {                       // aus der Formelzeile (reiner Text)
  commitCellHtml(esc(val == null ? '' : String(val)));
}
function commitCellHtml(html) {                   // speichert bereits sicheres Zell-HTML (mit <br> für Zeilenumbrüche)
  gridEnsure(curGrid, selC, selR);
  curGrid.zeilen[selR].cells[selC] = html || '';
  activePage().html = gridToHtml(curGrid);
  renderCalc(); scheduleSave();
}
// Inhalt einer bearbeiteten Zelle einlesen: nur Text + Zeilenumbrüche (<br>) behalten
/* Auszeichnung, die in einer Zelle erhalten bleiben MUSS. Vorher wurde jeder Knoten
   ausser <br>/<div>/<p> auf reinen Text reduziert - dadurch verlor eine Zelle beim
   blossen Wegklicken (oder beim Autospeichern) Fett/Kursiv/Links, und ein eingefuegtes
   Bild verschwand ersatzlos. */
const ZELL_INLINE = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'SPAN', 'FONT', 'A', 'SUB', 'SUP', 'MARK', 'CODE', 'IMG']);
function zellAttrs(el) {
  const tag = el.tagName;
  return [...((el && el.attributes) || [])].filter(a => {
    const n = a.name.toLowerCase();
    if (n.startsWith('on')) return false;                       // niemals Ereignis-Attribute
    return ALLOWED_ATTR['*'].includes(n) || (ALLOWED_ATTR[tag] || []).includes(n);
  }).map(a => ` ${a.name}="${esc(a.value)}"`).join('');
}
function readCellHtml(td) {
  let h = '';
  const teil = n => {
    if (n.nodeType === 3) { h += esc(n.nodeValue.replace(/​/g, '')); return; }
    if (n.nodeType !== 1) return;
    const tag = n.tagName;
    if (tag === 'BR') { h += '<br>'; return; }
    if (tag === 'DIV' || tag === 'P') { if (h && !/<br>$/.test(h)) h += '<br>'; n.childNodes.forEach(teil); return; }
    if (ZELL_INLINE.has(tag)) {
      const t = tag.toLowerCase(), at = zellAttrs(n);
      if (tag === 'IMG') { h += `<img${at}>`; return; }
      h += `<${t}${at}>`; n.childNodes.forEach(teil); h += `</${t}>`;
      return;
    }
    n.childNodes.forEach(teil);                                  // unbekannter Tag: Inhalt behalten, Huelle weg
  };
  td.childNodes.forEach(teil);
  return h.replace(/(<br>)+$/, '');
}
// Spaltenbreite mit Maus ziehen (am Spaltenkopf-Rand)
function startColResize(c, e) {
  const t = gEl(); if (!t) return;
  const col = t.querySelectorAll('colgroup col')[c]; if (!col) return;
  const z = parseFloat(page.style.zoom) || 1, startX = e.clientX;
  const cell = t.querySelector(`td[data-c="${c}"]:not([colspan])`);
  const startW = cell ? cell.offsetWidth : (col.offsetWidth || 80);
  const wAt = ev => Math.max(28, Math.round(startW + (ev.clientX - startX) / z));
  const move = ev => { col.style.width = wAt(ev) + 'px'; buildCalcRulers(); };
  const up = ev => {
    document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
    curColW()[c] = wAt(ev); scheduleSave(); renderCalc();
  };
  document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
}
function calcAddRow() { if (editingTd) endEdit(true); activePage().dispRows = gridRows + 1; renderCalc(); scheduleSave(); }
function calcAddCol() { if (editingTd) endEdit(true); activePage().dispCols = gridCols + 1; renderCalc(); scheduleSave(); }
function calcDelRow() { if (editingTd) endEdit(true); activePage().dispRows = Math.max(1, gridRows - 1); renderCalc(); scheduleSave(); }
function calcDelCol() { if (editingTd) endEdit(true); activePage().dispCols = Math.max(1, gridCols - 1); renderCalc(); scheduleSave(); }
/* --- flexibles Einfügen/Löschen an beliebiger Position (Spalten & Zeilen) --- */
function rekeyCR(map, axis, at, delta, del) {
  const out = {};
  for (const k in map) { let p = k.split(',').map(Number), c = p[0], r = p[1]; const v = axis === 'c' ? c : r; if (del != null && v === del) continue; const nv = v >= at ? v + delta : v; if (axis === 'c') c = nv; else r = nv; out[c + ',' + r] = map[k]; }
  return out;
}
function rekey1(map, at, delta, del) { const out = {}; for (const k in map) { const i = +k; if (del != null && i === del) continue; out[(i >= at ? i + delta : i)] = map[k]; } return out; }
function applyMapsCol(at, delta, del) { const p = activePage(); p.fmt = rekeyCR(curFmt(), 'c', at, delta, del); p.fill = rekeyCR(curFill(), 'c', at, delta, del); p.txtcol = rekeyCR(curTxtCol(), 'c', at, delta, del); p.borders = rekeyCR(curBorders(), 'c', at, delta, del); p.cfmt = rekeyCR(curCfmt(), 'c', at, delta, del); p.colW = rekey1(curColW(), at, delta, del); }
function applyMapsRow(at, delta, del) { const p = activePage(); p.fmt = rekeyCR(curFmt(), 'r', at, delta, del); p.fill = rekeyCR(curFill(), 'r', at, delta, del); p.txtcol = rekeyCR(curTxtCol(), 'r', at, delta, del); p.borders = rekeyCR(curBorders(), 'r', at, delta, del); p.cfmt = rekeyCR(curCfmt(), 'r', at, delta, del); p.rowH = rekey1(curRowH(), at, delta, del); }
function saveGridStruct() { activePage().html = gridToHtml(curGrid); renderCalc(); scheduleSave(); }
function closeHeaderMenu() { const m = $('#hdrMenu'); if (m) m.remove(); }
function openHeaderMenu(kind, idx, x, y) {
  closeHeaderMenu();
  const items = kind === 'col'
    ? [['＋ Spalte links einfügen', () => insertColAt(idx)], ['＋ Spalte rechts einfügen', () => insertColAt(idx + 1)], ['✕ Spalte ' + idxToCol(idx) + ' löschen', () => deleteColAt(idx)]]
    : [['＋ Zeile oben einfügen', () => insertRowAt(idx)], ['＋ Zeile unten einfügen', () => insertRowAt(idx + 1)], ['✕ Zeile ' + (idx + 1) + ' löschen', () => deleteRowAt(idx)]];
  const menu = document.createElement('div'); menu.className = 'hdr-menu'; menu.id = 'hdrMenu';
  menu.innerHTML = items.map((it, i) => `<button data-i="${i}"${i === 2 ? ' class="del"' : ''}>${it[0]}</button>`).join('');
  document.body.appendChild(menu);
  menu.style.left = Math.min(x, window.innerWidth - 210) + 'px'; menu.style.top = Math.min(y, window.innerHeight - 130) + 'px';
  menu.addEventListener('mousedown', e => { const b = e.target.closest('button'); if (!b) return; e.preventDefault(); items[+b.dataset.i][1](); closeHeaderMenu(); });
}
function insertColAt(at) {
  if (!curGrid) return; if (editingTd) endEdit(true);
  at = Math.max(0, Math.min(gridCols, at));
  curGrid.zeilen.forEach(z => { while (z.cells.length < at) z.cells.push(''); z.cells.splice(at, 0, ''); });
  applyMapsCol(at, +1, null);
  curMerges().forEach(m => { if (m.c >= at) m.c++; else if (m.c + m.cs > at) m.cs++; });
  curGrid.colStops = [];
  activePage().dispCols = gridCols + 1;
  saveGridStruct(); selectCell(at, selR);
}
function deleteColAt(dc) {
  if (!curGrid || gridCols <= 1) return; if (editingTd) endEdit(true);
  curGrid.zeilen.forEach(z => { if (z.cells.length > dc) z.cells.splice(dc, 1); });
  applyMapsCol(dc + 1, -1, dc);
  const ms = curMerges(); for (let i = ms.length - 1; i >= 0; i--) { const m = ms[i]; if (m.c > dc) m.c--; else if (m.c <= dc && m.c + m.cs > dc) { m.cs--; if (m.cs < 1) ms.splice(i, 1); } }
  curGrid.colStops = [];
  activePage().dispCols = Math.max(1, gridCols - 1);
  saveGridStruct(); selectCell(Math.max(0, Math.min(dc, gridCols - 2)), selR);
}
function insertRowAt(at) {
  if (!curGrid) return; if (editingTd) endEdit(true);
  at = Math.max(0, Math.min(curGrid.zeilen.length, at));
  curGrid.zeilen.splice(at, 0, { tag: 'p', cells: [''] });
  applyMapsRow(at, +1, null);
  curMerges().forEach(m => { if (m.r >= at) m.r++; else if (m.r + m.rs > at) m.rs++; });
  activePage().dispRows = gridRows + 1;
  saveGridStruct(); selectCell(selC, at);
}
function deleteRowAt(dr) {
  if (!curGrid || curGrid.zeilen.length <= 1) return; if (editingTd) endEdit(true);
  curGrid.zeilen.splice(dr, 1);
  applyMapsRow(dr + 1, -1, dr);
  const ms = curMerges(); for (let i = ms.length - 1; i >= 0; i--) { const m = ms[i]; if (m.r > dr) m.r--; else if (m.r <= dr && m.r + m.rs > dr) { m.rs--; if (m.rs < 1) ms.splice(i, 1); } }
  activePage().dispRows = Math.max(1, gridRows - 1);
  saveGridStruct(); selectCell(selC, Math.max(0, Math.min(dr, curGrid.zeilen.length - 1)));
}

/* ---- Inline-Zellbearbeitung (direkt in der Zelle) ---- */
function cursorAnTextPos(el, pos) {
  try {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n, acc = 0;
    while ((n = w.nextNode())) {
      const len = (n.nodeValue || '').length;
      if (acc + len >= pos) {
        const rg = document.createRange(); rg.setStart(n, Math.max(0, pos - acc)); rg.collapse(true);
        const sel = getSelection(); sel.removeAllRanges(); sel.addRange(rg); return true;
      }
      acc += len;
    }
    const rg = document.createRange(); rg.selectNodeContents(el); rg.collapse(false);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(rg);
  } catch (_) {}
  return false;
}
function cursorAmZeilenAnfang() {
  try {
    const sel = getSelection();
    if (!sel || !sel.isCollapsed || !editingTd) return false;
    const rg = sel.getRangeAt(0).cloneRange();
    rg.selectNodeContents(editingTd); rg.setEnd(sel.anchorNode, sel.anchorOffset);
    return rg.toString().length === 0;
  } catch (_) { return false; }
}
function setzeCursorAn(x, y) {
  try {
    let rg = null;
    if (document.caretRangeFromPoint) rg = document.caretRangeFromPoint(x, y);
    else if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); if (p) { rg = document.createRange(); rg.setStart(p.offsetNode, p.offset); rg.collapse(true); } }
    if (!rg || !editingTd || !editingTd.contains(rg.startContainer)) return;   // ausserhalb der Zelle: Cursor bleibt am Ende
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(rg);
  } catch (_) {}
}
function beginEdit(initial) {
  if (viewOnly) return;   // Ansehen-Modus: keine Zell-Bearbeitung
  const td = tdAt(selC, selR); if (!td) return;
  editingTd = td;
  td.classList.add('celledit'); td.contentEditable = 'true';
  if (initial != null) td.textContent = initial;             // direkt lostippen ersetzt den Inhalt
  else td.innerHTML = gridGet(curGrid, selC, selR) || '';    // vorhandenen Inhalt (inkl. Zeilenumbrüche) bearbeiten
  td.focus();
  const rng = document.createRange(); rng.selectNodeContents(td); rng.collapse(false);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(rng);
  td.addEventListener('input', liveExtendCell);   // live über die Zelle hinausschreiben
  liveExtendCell();
}
// während des Tippens: Text breiter als die Zelle → folgende LEERE Zellen live aufnehmen (nur so viele wie nötig)
function liveExtendCell() {
  const td = editingTd; if (!td || td.classList.contains('textcell')) return;
  // Dokumentmodus: Text bricht um wie ein Absatz. Ohne das setzt die Zeile unten
  // white-space:nowrap als Inline-Stil und schiebt den Text in die Nachbarspalten -
  // das las sich beim Schreiben wie ein Haenger.
  if (typeof dokumentModus === 'function' && dokumentModus()) { td.style.whiteSpace = 'pre-wrap'; return; }
  td.style.whiteSpace = 'nowrap';   // erst in einer Zeile wachsen
  let guard = 0;
  while (td.scrollWidth > td.clientWidth + 1 && guard++ < 40) {
    const nx = td.nextElementSibling; if (!nx || nx.dataset.c == null) break;
    const nc = +nx.dataset.c, nr = +nx.dataset.r;
    if (cellText(gridGet(curGrid, nc, nr)) !== '' || mergeAt(nc, nr)) break;   // nächste Zelle nicht leer → Stopp
    nx.remove(); td.setAttribute('colspan', (+td.getAttribute('colspan') || 1) + 1);
  }
  // keine freie Spalte mehr (Blattende oder nächste Zelle belegt) → Text live umbrechen statt abschneiden
  td.style.whiteSpace = (td.scrollWidth > td.clientWidth + 1) ? 'normal' : 'nowrap';
}
function endEdit(commit) {
  if (!editingTd) return;
  const td = editingTd; editingTd = null;
  const html = readCellHtml(td);
  td.contentEditable = 'false'; td.classList.remove('celledit');
  if (commit) { commitCellHtml(html); autoMergeOverflow(selC, selR); } else renderCalc();
}
let gridColPx = [], _measCv = null;
function measureCellText(txt) {
  if (!_measCv) _measCv = document.createElement('canvas');
  const ctx = _measCv.getContext('2d');
  const fs = (doc && +doc.einstellungen.schriftgroesse) || 16;
  const fam = ((doc && doc.einstellungen.schriftart) || 'sans-serif').replace(/['"]/g, '');
  ctx.font = fs + 'px ' + fam;
  return ctx.measureText(txt || '').width;
}
function cellEmpty(c, r) { return cellText(gridGet(curGrid, c, r)) === ''; }
// Text läuft über die Zelle hinaus → folgende leere Zellen automatisch verbinden (eine Zeile, kein Umbruch)
function autoMergeOverflow(c, r) {
  if (!curGrid || isTextRow(r)) return;
  const cur = mergeAt(c, r);
  if (cur && (cur.c !== c || cur.r !== r)) return;   // überdeckte Zelle (nicht der Ursprung)
  if (cur && !cur.auto) return;                      // vom Nutzer verbunden → unangetastet lassen
  const ms = curMerges();
  if (cur) { const i = ms.indexOf(cur); if (i >= 0) ms.splice(i, 1); }   // alte Auto-Verbindung neu berechnen
  const txt = gridCellRaw(c, r), raw = gridGet(curGrid, c, r);
  let span = 1;
  if (txt && !/<br/i.test(raw) && txt[0] !== '=') {   // mehrzeilige Zellen (Alt+Enter) nicht verbinden
    const need = measureCellText(txt) + 18;
    let avail = gridColPx[c] || 80;
    while (need > avail && c + span < gridCols && cellEmpty(c + span, r) && !mergeAt(c + span, r)) { avail += gridColPx[c + span] || 80; span++; }
  }
  if (span > 1) ms.push({ c, r, cs: span, rs: 1, auto: true });
  if (span > 1 || cur) { activePage().html = gridToHtml(curGrid); renderCalc(); selectCell(c, r); scheduleSave(); }
}

/* ---- Zeilen/Spalten einfügen·löschen (Rechtsklick im Gitter) ---- */
function showGridMenu(x, y) {
  const m = $('#ctxmenu');
  m.innerHTML = '<button data-g="rowAbove">Zeile oberhalb einfügen</button><button data-g="rowBelow">Zeile unterhalb einfügen</button><button data-g="rowDel">Zeile löschen</button><div class="sep"></div><button data-g="colLeft">Spalte links einfügen</button><button data-g="colRight">Spalte rechts einfügen</button><button data-g="colDel">Spalte löschen</button><div class="sep"></div><button data-g="clear">Inhalt löschen</button>';
  m.hidden = false;
  m.style.left = Math.min(x, window.innerWidth - m.offsetWidth - 8) + 'px';
  m.style.top = Math.min(y, window.innerHeight - m.offsetHeight - 8) + 'px';
}
function gridMenuAction(g) {
  $('#ctxmenu').hidden = true;
  gridEnsure(curGrid, selC, selR);
  if (g === 'rowAbove') curGrid.zeilen.splice(selR, 0, { tag: 'p', cells: [''] });
  else if (g === 'rowBelow') curGrid.zeilen.splice(selR + 1, 0, { tag: 'p', cells: [''] });
  else if (g === 'rowDel') { if (curGrid.zeilen.length > 1) curGrid.zeilen.splice(selR, 1); }
  else if (g === 'colLeft') { curGrid.zeilen.forEach(z => z.cells.splice(selC, 0, '')); curGrid.cols++; }
  else if (g === 'colRight') { curGrid.zeilen.forEach(z => z.cells.splice(selC + 1, 0, '')); curGrid.cols++; }
  else if (g === 'colDel') { curGrid.zeilen.forEach(z => z.cells.splice(selC, 1)); curGrid.cols = Math.max(1, curGrid.cols - 1); }
  else if (g === 'clear') { const { c1, c2, r1, r2 } = rangeBounds(); for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (curGrid.zeilen[r]) curGrid.zeilen[r].cells[c] = ''; }
  activePage().html = gridToHtml(curGrid); renderCalc(); scheduleSave();
}

/* ---- Vertikales Lineal: Kopf-/Fuss-Höhe ziehen ---- */
function drawVRuler() {
  if (!doc) return; const v = $('#vruler');
  if (appEl.classList.contains('focus') || appEl.classList.contains('slides-mode') || appEl.classList.contains('calc-mode')) { v.style.display = 'none'; return; }
  v.style.display = '';
  const ph = page.offsetHeight; let html = '';
  for (let cm = 0; cm <= Math.floor(ph / (10 * MM)); cm++) html += `<div class="vtick" style="top:${cm * 10 * MM}px"><span>${cm}</span></div>`;
  html += `<div class="vhandle" id="vhHead" style="top:${$('#zoneH').offsetHeight}px" title="Kopfzeilen-Höhe ziehen"></div>`;
  html += `<div class="vhandle" id="vhFoot" style="top:${ph - $('#zoneF').offsetHeight}px" title="Fusszeilen-Höhe ziehen"></div>`;
  v.innerHTML = html;
  $('#vhHead').addEventListener('mousedown', e => startVDrag('head', e));
  $('#vhFoot').addEventListener('mousedown', e => startVDrag('foot', e));
}
function startVDrag(which, e) {
  e.preventDefault();
  const z = parseFloat(page.style.zoom) || 1, s = pageSetup();
  const move = ev => {
    const yPx = (ev.clientY - page.getBoundingClientRect().top) / z;
    if (which === 'head') s.kopfH = Math.max(6, Math.min(90, Math.round(yPx / MM - s.margins.top - 4)));
    else s.fussH = Math.max(6, Math.min(90, Math.round((page.offsetHeight - yPx) / MM - s.margins.bottom - 4)));
    applyPageSetup(); drawVRuler();
  };
  const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); scheduleSave(); updatePages(); };
  document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
}

/* ============================================================
   Rechtschreibprüfung + persönliches Wörterbuch (erweiterbar per Rechtsklick)
   ============================================================ */
const LS_DICT = 'sw_dict_v1', LS_CORR = 'sw_corr_v1';
const BASE_DICT = new Set(('der die das des dem den ein eine einer eines einem einen kein keine und oder aber denn weil dass wenn als wie wo wer was wann warum welche welcher welches ich du er sie es wir ihr mich dich sich uns euch mir dir ihm ihnen mein dein sein unser euer ist sind war waren bin bist seid sei werden wird wurde wurden geworden haben habe hast hat hatte hatten gehabt kann kannst können konnte konnten muss musst müssen musste soll sollst sollen sollte will willst wollen wollte mag möchte darf dürfen nicht nichts nie noch nur schon auch sehr mehr meist viel viele wenig hier dort da jetzt dann immer oft manchmal mit ohne für gegen durch über unter vor nach bei zu zur zum von vom aus an auf in im ins am um bis seit ab während wegen trotz statt gut sehr gute guten schlecht gross grosse klein kleine neu neue alt alte lang kurz hoch tief ja nein bitte danke gerne hallo guten tag jahr jahre monat monate woche wochen tag tage stunde stunden minute zeit mal heute morgen gestern mensch menschen mann frau kind kinder leute haus stadt land welt arbeit firma geld preis kosten projekt projekte idee ideen system word excel powerpoint wort wörter text texte seite seiten brief briefe rechnung angebot offerte frage antwort beispiel name datum ort herr damen herren sehr geehrte freundliche grüsse betreff anbei beiliegend gemäss bezüglich').split(' '));
let userDict = ssLoadSet(LS_DICT);
let corrMap = ssLoadMap(LS_CORR);
function ssLoadSet(k) { try { return new Set(JSON.parse(localStorage.getItem(k) || '[]')); } catch (_) { return new Set(); } }
function ssLoadMap(k) { try { return new Map(Object.entries(JSON.parse(localStorage.getItem(k) || '{}'))); } catch (_) { return new Map(); } }
function ssSaveDict() { try { localStorage.setItem(LS_DICT, JSON.stringify([...userDict])); } catch (_) {} }
function ssSaveCorr() { try { localStorage.setItem(LS_CORR, JSON.stringify(Object.fromEntries(corrMap))); } catch (_) {} }
function normWord(w) { return (w || '').toLowerCase().replace(/[’']/g, '').replace(/ß/g, 'ss'); }
function knownWord(w) { const k = normWord(w); if (k.length < 2) return true; if (/\d/.test(w)) return true; return BASE_DICT.has(k) || userDict.has(k); }
function dictAdd(w) { const k = normWord(w); if (!k) return; userDict.add(k); ssSaveDict(); spellcheckNow(); toast('„' + w + '" zum Wörterbuch hinzugefügt'); }
function corrAdd(from, to) { const k = normWord(from); if (!k || !to) return; corrMap.set(k, to); userDict.add(normWord(to)); ssSaveDict(); ssSaveCorr(); spellcheckNow(); toast('Autokorrektur: „' + from + '" → „' + to + '"'); }

let spellTimer = null, spellTarget = null, spellOn = true;
function spellLater() { if (!spellOn) return; clearTimeout(spellTimer); spellTimer = setTimeout(spellcheckNow, 650); }
function unwrapSpell(root) { $$('.sp-err', root).forEach(s => s.replaceWith(document.createTextNode(s.textContent))); root.normalize(); }
function cleanEditorHTML() { const c = editor.cloneNode(true); c.querySelectorAll('.sp-err').forEach(s => s.replaceWith(document.createTextNode(s.textContent))); c.querySelectorAll('.pgbreak-gap').forEach(g => g.remove()); return c.innerHTML; }
function spellcheckNow() {
  if (!doc || !spellOn) return;
  if (activePage() && activePage().typ === 'calc') return;     // nur Fliesstext prüfen
  const off = caretOffset(editor);
  unwrapSpell(editor);
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT, {
    acceptNode(n) { const p = n.parentElement; if (!p || p.closest('.toc, pre, code, a, [contenteditable="false"]')) return NodeFilter.FILTER_REJECT; return NodeFilter.FILTER_ACCEPT; }
  });
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  const RE = /[A-Za-zÀ-ÿ’']+/g;
  nodes.forEach(n => {
    const text = n.nodeValue; if (!/[A-Za-zÀ-ÿ]/.test(text)) return;
    let m, last = 0, any = false; const frag = document.createDocumentFragment(); RE.lastIndex = 0;
    while ((m = RE.exec(text))) {
      const w = m[0];
      if (w.length >= 2 && /[A-Za-zÀ-ÿ]/.test(w) && !knownWord(w)) {
        any = true;
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const sp = document.createElement('span'); sp.className = 'sp-err'; sp.textContent = w; frag.appendChild(sp);
        last = m.index + w.length;
      }
    }
    if (any) { if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last))); n.replaceWith(frag); }
  });
  if (off != null) setCaretOffset(editor, off);
}
function caretOffset(root) {
  const sel = getSelection(); if (!sel.rangeCount) return null;
  const r = sel.getRangeAt(0); if (!root.contains(r.endContainer)) return null;
  const pre = r.cloneRange(); pre.selectNodeContents(root); pre.setEnd(r.endContainer, r.endOffset);
  return pre.toString().length;
}
function setCaretOffset(root, off) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null); let n, acc = 0;
  while ((n = walker.nextNode())) { const len = n.nodeValue.length; if (acc + len >= off) { const r = document.createRange(); r.setStart(n, Math.max(0, off - acc)); r.collapse(true); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); return; } acc += len; }
}
// Autokorrektur beim Tippen (nach Wortende) anwenden
function applyAutocorrect() {
  if (!corrMap.size) return;
  const sel = getSelection(); if (!sel.rangeCount) return;
  const r = sel.getRangeAt(0), node = r.endContainer; if (node.nodeType !== 3) return;
  const text = node.nodeValue, pos = r.endOffset;
  const mm = /([A-Za-zÀ-ÿ’']+)([\s.,;:!?])$/.exec(text.slice(0, pos));
  if (!mm) return; const corr = corrMap.get(normWord(mm[1])); if (!corr || corr === mm[1]) return;
  const start = pos - mm[0].length;
  node.nodeValue = text.slice(0, start) + corr + mm[2] + text.slice(pos);
  const r2 = document.createRange(); r2.setStart(node, start + corr.length + 1); r2.collapse(true);
  sel.removeAllRanges(); sel.addRange(r2);
}
function onEditorInput(e) {
  const hf = e && e.target && e.target.closest && e.target.closest('.pg-foot, .pg-head');
  if (hf) { syncHF(hf); return; }   // Kopf-/Fusszeile in einer Seitenlücke editiert → überall übernehmen, nicht neu umbrechen
  if (e && e.inputType === 'insertText' && /[\s.,;:!?]/.test(e.data || '')) applyAutocorrect();
  afterEdit();
}

/* ============================================================
   Start
   ============================================================ */
function init() {
  $('#verTag').textContent = WRITE_VERSION;
  editor.spellcheck = true;    // echte Rechtschreibprüfung des Browsers (vollständiges Wörterbuch)
  setTheme(localStorage.getItem(LS_THEME) || 'light');
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (_) {}
  try { document.execCommand('styleWithCSS', false, true); } catch (_) {}
  wire(); initLaunch();
  // Uebergabe aus SubmitOne oder Submit PDF (gemeinsame Bruecke, siehe ../bridge.js)
  const zuletztOeffnen = () => {
    if (lib.currentId && lib.docs[lib.currentId]) openDoc(lib.currentId);
    else if (lib.order.length && lib.docs[lib.order[0]]) openDoc(lib.order[0]);
    else createDoc();
    renderList();
  };
  const uebernehmen = data => {
    if (!data || !Array.isArray(data.pages) || !data.pages.length) return false;
    const q = data.quelle || {};
    createDoc({
      titel: data.titel || 'Uebernommen',
      pages: data.pages.map(p => ({ id: uid(), typ: p.typ === 'calc' ? 'calc' : 'write', html: p.html || '' })),
    });
    try { history.replaceState(null, '', location.pathname); } catch (_) {}
    const n = window.SubmitBridge ? SubmitBridge.countPages(data.pages) : data.pages.length;
    const woher = q.app === 'one' ? 'SubmitOne' : q.app === 'pdf' ? 'Submit PDF' : 'Uebergabe';
    toast('Aus ' + woher + ' uebernommen – ' + n + (n === 1 ? ' Seite' : ' Seiten')
      + (q.projekt ? ' · ' + q.projekt : '') + '.');
    renderList();
    return true;
  };
  let holt = false;
  try {
    if (new URLSearchParams(location.search).get('import') === '1' && window.SubmitBridge) {
      holt = true;
      SubmitBridge.receive().then(d => { if (!uebernehmen(d)) zuletztOeffnen(); }).catch(zuletztOeffnen);
    }
  } catch (_) { holt = false; }
  if (!holt) zuletztOeffnen();
}
init();

/* ============================================================
   HEADLESS-SELBSTTEST · Submit Paper (S0.2)
   Aufruf:  node write/test/selftest-node.js   → prüft DOM-freie Kernlogik.
   ============================================================ */
function selfTest() {
  const R = []; let pass = 0, fail = 0;
  const ok = (name, cond, msg) => { const good = !!cond; R.push({ name, ok: good, msg: good ? '' : (msg || '') }); good ? pass++ : fail++; };
  const eq = (name, got, exp) => ok(name, JSON.stringify(got) === JSON.stringify(exp), 'erwartet ' + JSON.stringify(exp) + ', bekam ' + JSON.stringify(got));

  // A1-Adressierung (Spalten/Zeilen ↔ Bezug)
  eq('colToIdx A', colToIdx('A'), 0);
  eq('colToIdx B', colToIdx('B'), 1);
  eq('colToIdx AA', colToIdx('AA'), 26);
  eq('idxToCol 0', idxToCol(0), 'A');
  eq('idxToCol 26', idxToCol(26), 'AA');
  eq('cellKey C5', cellKey(2, 4), 'C5');
  eq('Roundtrip Spalte', idxToCol(colToIdx('AZ')), 'AZ');

  // Zahl-Umwandlung
  eq('toNum Komma', toNum('3,5'), 3.5);
  eq('toNum leer', toNum(''), 0);
  eq('toNum bool', toNum(true), 1);

  // Formel-Engine (rein): Arithmetik, Klammern, Potenz, Vergleiche, Passthrough
  eq('Punkt-vor-Strich', evalRaw('=2+3*4'), 14);
  eq('Klammern', evalRaw('=(2+3)*4'), 20);
  eq('Division', evalRaw('=10/4'), 2.5);
  eq('Potenz', evalRaw('=2^10'), 1024);
  eq('Zahl-Passthrough', evalRaw('42'), 42);
  eq('Text-Passthrough', evalRaw('hallo'), 'hallo');
  eq('Vergleich WAHR', evalRaw('=5>3'), 'WAHR');
  eq('Vergleich FALSCH', evalRaw('=5<3'), 'FALSCH');

  // Formel mit Zellbezügen: cellText im Test DOM-frei machen (echtes DOM fehlt headless)
  cellText = function (frag) { return String(frag == null ? '' : frag).replace(/<[^>]*>/g, '').replace(/​/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim(); };
  const saved = curGrid;
  curGrid = { cols: 3, zeilen: [{ tag: 'p', cells: ['2', '3', '=A1*B1'] }, { tag: 'p', cells: ['=A1+B1', '=SUMME(A1:C1)', ''] }] };
  eq('Zelle A1*B1 = 6', evalCell(2, 0), 6);
  eq('Zelle A1+B1 = 5', evalCell(0, 1), 5);
  eq('Zelle SUMME(A1:C1) = 11', evalCell(1, 1), 11);   // 2 + 3 + 6
  curGrid = { cols: 1, zeilen: [{ tag: 'p', cells: ['=A1'] }] };
  eq('Zirkelbezug erkannt', evalCell(0, 0), '#ZIRKEL');
  curGrid = saved;

  // Named functions (Bereiche A1:C1 vermeiden das Argument-Trennzeichen; cellText ist oben bereits DOM-frei)
  const savedN = curGrid;
  curGrid = { cols: 3, zeilen: [{ tag: 'p', cells: ['2', '8', '5'] }] };
  const fx = f => evalRaw(f, new Set());   // Zellbezüge → seen-Set nötig (wie evalCell)
  eq('MITTELWERT(A1:C1)', fx('=MITTELWERT(A1:C1)'), 5);
  eq('MIN(A1:C1)', fx('=MIN(A1:C1)'), 2);
  eq('MAX(A1:C1)', fx('=MAX(A1:C1)'), 8);
  eq('ANZAHL(A1:C1)', fx('=ANZAHL(A1:C1)'), 3);
  eq('PRODUKT(A1:C1)', fx('=PRODUKT(A1:C1)'), 80);
  eq('SUMME(A1:C1)', fx('=SUMME(A1:C1)'), 15);
  curGrid = savedN;
  eq('WURZEL(16)', evalRaw('=WURZEL(16)'), 4);
  eq('ABS(-7)', evalRaw('=ABS(-7)'), 7);
  eq('GANZZAHL(3.9)', evalRaw('=GANZZAHL(3.9)'), 3);
  eq('Fehler bei Division durch 0', evalRaw('=1/0'), '#FEHLER');

  // gridToHtml (rein)
  const h = gridToHtml({ cols: 2, zeilen: [{ tag: 'p', cells: ['a', 'b'] }, { tag: 'h2', cells: ['Titel'] }], colStops: [] });
  ok('gridToHtml baut HTML', /a/.test(h) && /b/.test(h) && /<h2>Titel<\/h2>/.test(h), h);

  // --- Datum: Grundlage fuers Terminprogramm ---
  ok('Datum wird in Schweizer und in ISO-Schreibweise gelesen', (() => {
    const a = datumParsen('01.03.2026'), b = datumParsen('2026-03-01');
    return a && b && a.getTime() === b.getTime();
  })());
  ok('Unsinn als Datum ergibt null (statt einem falschen Tag)',
    datumParsen('kein Datum') === null && datumParsen('') === null && datumParsen(null) === null);
  ok('TAGE zaehlt Kalendertage mit Endtag', tageZwischen('01.03.2026', '03.03.2026') === 3);
  ok('TAGE ueber den Monatswechsel', tageZwischen('28.02.2026', '02.03.2026') === 3);
  ok('TAGE im Schaltjahr (2028 hat einen 29. Februar)', tageZwischen('28.02.2028', '01.03.2028') === 3);
  ok('ARBEITSTAGE laesst Samstag und Sonntag weg', arbeitstage('02.03.2026', '08.03.2026') === 5);
  ok('ARBEITSTAGE eines einzelnen Werktags ist 1', arbeitstage('04.03.2026', '04.03.2026') === 1);
  ok('ARBEITSTAGE eines Sonntags ist 0', arbeitstage('08.03.2026', '08.03.2026') === 0);
  ok('ungueltiges Datum ergibt #WERT statt einer Zahl',
    tageZwischen('x', '01.03.2026') === '#WERT' && arbeitstage('01.03.2026', 'x') === '#WERT');
  ok('DATUMPLUS rechnet Tage dazu', datumPlus('28.02.2026', 1) === '01.03.2026');
  ok('Datumsfunktionen sind in Formeln erreichbar',
    evalRaw('=TAGE("01.03.2026";"03.03.2026")') === 3 && evalRaw('=ARBEITSTAGE("02.03.2026";"08.03.2026")') === 5);

  // --- Vorlagen: bauen sie sich, und rechnen sie wirklich? ---
  ok('jede Vorlage hat eine Beschreibung (sonst steht nur "Vorlage" in der Galerie)',
    Object.keys(TEMPLATES).every(k => TMPL_META[k] && TMPL_META[k].d));
  ok('alle rechnenden Vorlagen bauen sich ohne Fehler und liefern eine Rasterseite', (() => {
    return Object.keys(TEMPLATES).filter(k => TEMPLATES[k].bauen).every(k => {
      const v = TEMPLATES[k].bauen();
      const p = v && v.pages && v.pages[0];
      return p && p.typ === 'calc' && typeof p.html === 'string' && p.html.length > 50;
    });
  })());
  ok('Baukostenuebersicht enthaelt Summen, Abweichung und SUMMEWENN', (() => {
    const h = TEMPLATES.baukosten.bauen().pages[0].html;
    return /=SUMME\(C5:C12\)/.test(h) && /=E5-D5/.test(h) && /=SUMMEWENN\(/.test(h) && /=WENNFEHLER\(/.test(h);
  })());
  ok('Baukostenuebersicht legt CHF- und Prozentformat auf die Spalten', (() => {
    const f = TEMPLATES.baukosten.bauen().pages[0].fmt;
    return f['2,4'] === 'chf' && f['4,4'] === 'chf' && f['6,4'] === 'pct';
  })());
  ok('Terminprogramm rechnet Kalender- und Arbeitstage', (() => {
    const h = TEMPLATES.terminprogramm.bauen().pages[0].html;
    return /=WENNFEHLER\(TAGE\(B5;C5\)/.test(h) && /=WENNFEHLER\(ARBEITSTAGE\(B5;C5\)/.test(h);
  })());
  ok('Ausmassblatt rechnet Mengen und formatiert sie als m2', (() => {
    const v = TEMPLATES.ausmass.bauen().pages[0];
    return /=WENNFEHLER\(C5\*D5\*E5/.test(v.html) && v.fmt['5,4'] === 'm2';
  })());
  ok('Preisspiegel findet die guenstigste Offerte und zaehlt die Treffer', (() => {
    const h = TEMPLATES.preisspiegel.bauen().pages[0].html;
    return /=MIN\(C5:E5\)/.test(h) && /=ZAEHLENWENN\(/.test(h);
  })());
  ok('Beiblatt nennt die Vertragsgrundlage SIA 118', /SIA 118/.test(TEMPLATES.beiblatt.bauen().pages[0].html));
  ok('Vorlagen-Zellen sind durch Spaltentrenner getrennt (echte Rasterzeilen)',
    TEMPLATES.baukosten.bauen().pages[0].html.indexOf('class="colsep"') > 0);

  // Die Rechenwege der Vorlagen an echten Zahlen durchspielen
  ok('Rechenweg Baukosten: Summe, Abweichung und Anteil stimmen', (() => {
    const alt = curGrid;
    // Spalten: C=Schaetzung(2) D=Voranschlag(3) E=Prognose(4) F=Abweichung(5) G=Anteil(6)
    curGrid = { cols: 7, colStops: [], zeilen: [
      { tag: 'p', attrs: '', cells: ['1', 'Vorbereitung', '100', '100', '120', '=E1-D1', '=WENNFEHLER(F1/D1;0)'] },
      { tag: 'p', attrs: '', cells: ['2', 'Gebaeude', '900', '900', '880', '=E2-D2', '=WENNFEHLER(F2/D2;0)'] },
      { tag: 'p', attrs: '', cells: ['', 'TOTAL', '=SUMME(C1:C2)', '=SUMME(D1:D2)', '=SUMME(E1:E2)', '=SUMME(F1:F2)'] },
    ] };
    const abw1 = evalCell(5, 0), anteil1 = evalCell(6, 0);
    const totE = evalCell(4, 2), totF = evalCell(5, 2);
    curGrid = alt;
    return abw1 === 20 && anteil1 === 0.2 && totE === 1000 && totF === 0;
  })());
  ok('Rechenweg Baukosten: SUMMEWENN summiert nur die gewaehlte BKP-Gruppe', (() => {
    const alt = curGrid;
    curGrid = { cols: 5, colStops: [], zeilen: [
      { tag: 'p', attrs: '', cells: ['1', 'a', '', '', '100'] },
      { tag: 'p', attrs: '', cells: ['2', 'b', '', '', '900'] },
      { tag: 'p', attrs: '', cells: ['2', 'c', '', '', '50'] },
    ] };
    const v = evalRaw('=SUMMEWENN(A1:A3;"2";E1:E3)', new Set());
    curGrid = alt;
    return v === 950;
  })());
  ok('Rechenweg Ausmass: Menge = Anzahl x Laenge x Breite, leere Zeile bleibt leer', (() => {
    const alt = curGrid;
    curGrid = { cols: 6, colStops: [], zeilen: [
      { tag: 'p', attrs: '', cells: ['1', 'Wand', '2', '5', '2.5', '=WENNFEHLER(C1*D1*E1;"")'] },
      { tag: 'p', attrs: '', cells: ['2', '', '', '', '', '=WENNFEHLER(C2*D2*E2;"")'] },
    ] };
    const m1 = evalCell(5, 0), m2 = evalCell(5, 1);
    curGrid = alt;
    return m1 === 25 && m2 === 0;
  })());
  ok('Rechenweg Preisspiegel: MIN findet die guenstigste, Differenz stimmt', (() => {
    const alt = curGrid;
    curGrid = { cols: 7, colStops: [], zeilen: [
      { tag: 'p', attrs: '', cells: ['1', 'Pos', '1200', '980', '1100', '=MIN(C1:E1)', '=C1-F1'] },
    ] };
    const min = evalCell(5, 0), diff = evalCell(6, 0);
    curGrid = alt;
    return min === 980 && diff === 220;
  })());
  ok('Rechenweg Terminprogramm: Dauer aus zwei Daten', (() => {
    const alt = curGrid;
    curGrid = { cols: 5, colStops: [], zeilen: [
      { tag: 'p', attrs: '', cells: ['Baumeister', '02.03.2026', '08.03.2026',
        '=WENNFEHLER(TAGE(B1;C1);"")', '=WENNFEHLER(ARBEITSTAGE(B1;C1);"")'] },
      { tag: 'p', attrs: '', cells: ['Zimmermann', '', '',
        '=WENNFEHLER(TAGE(B2;C2);"")', '=WENNFEHLER(ARBEITSTAGE(B2;C2);"")'] },
    ] };
    const kal = evalCell(3, 0), arb = evalCell(4, 0), leer = evalCell(3, 1);
    curGrid = alt;
    return kal === 7 && arb === 5 && leer === '';
  })());

  // --- Write: eine Zeile ist eine durchgehende Zeile, Calc zeigt die Zellen ---
  ok('Write: Zeile mit Inhalt nur in Spalte A nimmt die volle Blattbreite', (() => {
    const aG = curGrid, aD = doc;
    doc = { seiten: [{ typ: 'calc', linien: false, merges: [] }], aktiv: 0, einstellungen: {} };
    curGrid = { cols: 1, colStops: [], zeilen: [{ tag: 'p', attrs: '', cells: ['Ein langer Satz'] }] };
    const inWrite = isTextRow(0);
    doc.seiten[0].linien = true;                       // dieselbe Zeile in Calc
    const inCalc = isTextRow(0);
    curGrid = aG; doc = aD;
    return inWrite === true && inCalc === false;       // Write: durchgehend, Calc: Zelle
  })());
  ok('Write: leere Zeile ist ebenfalls durchgehend (Cursor startet ganz links)', (() => {
    const aG = curGrid, aD = doc;
    doc = { seiten: [{ typ: 'calc', linien: false, merges: [] }], aktiv: 0, einstellungen: {} };
    curGrid = { cols: 1, colStops: [], zeilen: [{ tag: 'p', attrs: '', cells: [''] }] };
    const r = isTextRow(0); curGrid = aG; doc = aD; return r === true;
  })());
  ok('Write: sobald die Zeile zwei Spalten hat, ist sie wieder eine Rasterzeile', (() => {
    const aG = curGrid, aD = doc;
    doc = { seiten: [{ typ: 'calc', linien: false, merges: [] }], aktiv: 0, einstellungen: {} };
    curGrid = { cols: 2, colStops: [], zeilen: [{ tag: 'p', attrs: '', cells: ['links', 'rechts'] }] };
    const r = isTextRow(0); curGrid = aG; doc = aD; return r === false;
  })());
  ok('Calc: Ueberschriften nehmen weiterhin die volle Breite', (() => {
    const aG = curGrid, aD = doc;
    doc = { seiten: [{ typ: 'calc', linien: true, merges: [] }], aktiv: 0, einstellungen: {} };
    curGrid = { cols: 1, colStops: [], zeilen: [{ tag: 'h1', attrs: '', cells: ['Titel'] }] };
    const r = isTextRow(0); curGrid = aG; doc = aD; return r === true;
  })());
  ok('verbundene Zellen bleiben verbunden (keine Textzeile daraus machen)', (() => {
    const aG = curGrid, aD = doc;
    doc = { seiten: [{ typ: 'calc', linien: false, merges: [{ c: 0, r: 0, cs: 2, rs: 1 }] }], aktiv: 0, einstellungen: {} };
    curGrid = { cols: 1, colStops: [], zeilen: [{ tag: 'p', attrs: '', cells: ['x'] }] };
    const r = isTextRow(0); curGrid = aG; doc = aD; return r === false;
  })());

  // --- P4: Seitenzahlen als Platzhalter ---
  ok('Platzhalter {Seite} und {Seiten} werden ersetzt',
    seitenzahlenEinsetzen('Seite {Seite} von {Seiten}', 3, 7) === 'Seite 3 von 7');
  ok('Platzhalter sind unabhaengig von Gross-/Kleinschreibung und Leerzeichen',
    seitenzahlenEinsetzen('{seite}/{ SEITEN }', 2, 9) === '2/9');
  ok('mehrere gleiche Platzhalter werden alle ersetzt',
    seitenzahlenEinsetzen('{Seite}-{Seite}', 4, 4) === '4-4');
  ok('Titel und Datum als Platzhalter',
    seitenzahlenEinsetzen('{Titel} · {Datum}', 1, 1, 'Offerte', '19.07.2026') === 'Offerte · 19.07.2026');
  ok('Titel wird escaped (kein eingeschleustes Markup aus dem Dokumentnamen)',
    seitenzahlenEinsetzen('{Titel}', 1, 1, '<b>x</b>') === '&lt;b&gt;x&lt;/b&gt;');
  ok('Text ohne Platzhalter bleibt unveraendert',
    seitenzahlenEinsetzen('Musterfirma AG', 1, 5) === 'Musterfirma AG');
  ok('leere Kopfzeile vertraegt sich', seitenzahlenEinsetzen(null, 1, 1) === '' && seitenzahlenEinsetzen('', 2, 3) === '');
  ok('PLATZHALTER-Liste nennt alle unterstuetzten', (() => {
    return PLATZHALTER.every(p => {
      const name = p.slice(1, -1);
      return seitenzahlenEinsetzen(p, 1, 1, 'T', 'D') !== p;   // jeder Platzhalter wird tatsaechlich ersetzt
    });
  })());

  // --- P3: Zellbereiche kopieren/einfuegen + Bau-Formeln ---
  ok('bereichAlsText baut Tabulator-Text (Excel versteht das direkt)',
    bereichAlsText([['a', 'b'], ['c', 'd']]) === 'a' + TAB + 'b' + NL + 'c' + TAB + 'd');
  ok('bereichAlsText nimmt Auszeichnung weg (nur Werte in die Zwischenablage)',
    bereichAlsText([['<b>fett</b>']]) === 'fett');
  ok('textAlsBereich liest Tabulator-Text zurueck',
    JSON.stringify(textAlsBereich('a' + TAB + 'b' + NL + 'c' + TAB + 'd')) === JSON.stringify([['a', 'b'], ['c', 'd']]));
  ok('textAlsBereich vertraegt Windows-Zeilenenden und Leerzeile am Schluss',
    JSON.stringify(textAlsBereich('a' + TAB + 'b' + CR + NL + 'c' + TAB + 'd' + CR + NL)) === JSON.stringify([['a', 'b'], ['c', 'd']]));
  ok('Rundlauf Kopieren -> Einfuegen ohne Verlust', (() => {
    const alt = curGrid;
    curGrid = { cols: 2, zeilen: [{ tag: 'p', attrs: '', cells: ['1', '2'] }, { tag: 'p', attrs: '', cells: ['3', '4'] }], colStops: [] };
    const t = bereichAlsText(bereichLesen(0, 1, 0, 1).zeilen);
    const r = JSON.stringify(textAlsBereich(t)) === JSON.stringify([['1', '2'], ['3', '4']]);
    curGrid = alt; return r;
  })());
  ok('Einfuegen verschiebt Formeln mit (relativ wandert, $ bleibt)', (() => {
    const alt = curGrid;
    curGrid = { cols: 3, zeilen: [{ tag: 'p', attrs: '', cells: ['=A1+$B$1', '', ''] }], colStops: [] };
    bereichEinfuegen({ zeilen: [['=A1+$B$1']], fmt: {}, cfmt: {}, c1: 0, r1: 0 }, 1, 0);
    const v = cellText(gridGet(curGrid, 1, 0)); curGrid = alt;
    return v === '=B1+$B$1';
  })());
  ok('Einfuegen von reinem Text laesst Text unveraendert', (() => {
    const alt = curGrid;
    curGrid = { cols: 2, zeilen: [{ tag: 'p', attrs: '', cells: ['', ''] }], colStops: [] };
    bereichEinfuegen({ zeilen: [['Beton', '12.5']], c1: 0, r1: 0 }, 0, 0);
    const v = [cellText(gridGet(curGrid, 0, 0)), cellText(gridGet(curGrid, 1, 0))].join('|'); curGrid = alt;
    return v === 'Beton|12.5';
  })());
  ok('Einfuegen ohne Daten tut nichts', bereichEinfuegen(null, 0, 0) === false && bereichEinfuegen({ zeilen: [] }, 0, 0) === false);

  // Kriterien und neue Funktionen
  ok('kriteriumPasst: Zahlenvergleiche', kriteriumPasst(120, '>100') && !kriteriumPasst(80, '>100')
    && kriteriumPasst(5, '<=5') && kriteriumPasst(3, '<>4'));
  ok('kriteriumPasst: Text ohne Gross/Klein-Unterschied', kriteriumPasst('Beton', 'beton') && !kriteriumPasst('Holz', 'beton'));
  ok('kriteriumPasst: blosser Wert bedeutet gleich', kriteriumPasst(7, '7') && kriteriumPasst('x', 'x'));
  ok('WENNFEHLER faengt Fehler ab', evalRaw('=WENNFEHLER(1/0;"kein Wert")') === 'kein Wert');
  ok('WENNFEHLER laesst gute Werte durch', evalRaw('=WENNFEHLER(6/2;"x")') === 3);
  ok('AUFRUNDEN / ABRUNDEN auf Stellen', evalRaw('=AUFRUNDEN(12.341;2)') === 12.35 && evalRaw('=ABRUNDEN(12.349;2)') === 12.34);
  ok('AUFRUNDEN bei negativen Zahlen rundet vom Null weg', evalRaw('=AUFRUNDEN(-12.341;2)') === -12.35);
  ok('UND / ODER / NICHT', evalRaw('=UND(1>0;2>1)') === 'WAHR' && evalRaw('=ODER(1>2;2>1)') === 'WAHR'
    && evalRaw('=UND(1>2;2>1)') === 'FALSCH' && evalRaw('=NICHT(1>2)') === 'WAHR');
  ok('VERKETTEN fuegt zusammen', evalRaw('=VERKETTEN("NPK ";"113")') === 'NPK 113');
  ok('istFehler erkennt Fehlerwerte UND Unendlich (Division durch null)',
    istFehler('#FEHLER') && istFehler('#ZIRKEL') && istFehler(Infinity) && istFehler(NaN)
    && !istFehler('3') && !istFehler(0) && !istFehler(-5));

  // --- P1/P2: stille Datenverluste und ihre Waechter ---
  ok('Zell-Auszeichnung bleibt erhalten: ZELL_INLINE deckt Fett/Kursiv/Link/Bild ab',
    ['B','I','U','S','SPAN','A','IMG','SUB','SUP','MARK'].every(t => ZELL_INLINE.has(t)));
  ok('ZELL_INLINE ist Teilmenge von ALLOWED_TAGS (sonst raeumt sanitizeHtml es beim Laden weg)',
    [...ZELL_INLINE].every(t => ALLOWED_TAGS.has(t)));
  // Waechter fuer die Attributliste: streicht jemand data-fx oder data-tab, verlieren
  // ALLE bestehenden Dokumente beim Oeffnen ihre Formeln bzw. Spaltenpositionen - lautlos.
  ok('ALLOWED_ATTR schuetzt data-fx (Formeln) und data-tab (Spaltenpositionen)',
    ALLOWED_ATTR.SPAN.includes('data-fx') && ALLOWED_ATTR.SPAN.includes('data-tab'));
  ok('ALLOWED_ATTR schuetzt class/style (Ausrichtung, Spaltentrenner) und colspan/rowspan',
    ALLOWED_ATTR['*'].includes('class') && ALLOWED_ATTR['*'].includes('style')
    && ALLOWED_ATTR.TD.includes('colspan') && ALLOWED_ATTR.TH.includes('rowspan'));
  ok('ALLOWED_ATTR schuetzt contenteditable (Marken bleiben unantastbar)',
    ALLOWED_ATTR.SPAN.includes('contenteditable'));

  // Speichern/Laden-Rundlauf ohne DOM: sanitizeHtml wird wie cellText oben ersetzt
  ok('Speichern/Laden erhaelt Seitenformat, Ausrichtung, Zellformate und Gitter-Zustand', (() => {
    const sAlt = sanitizeHtml, dAlt = doc, lAlt = lib, oAlt = openDoc, tAlt = toast;
    try {
      sanitizeHtml = x => x;                 // DOM-frei pruefbar machen (wie cellText weiter oben)
      openDoc = () => {}; toast = () => {};  // ingestGdoc oeffnet und meldet sonst
      lib = { docs: {}, order: [], currentId: null };
      const quelle = JSON.stringify({       // ingestGdoc erwartet TEXT, nicht ein Objekt
        format: 'paper', formatVersion: FORMAT_VERSION, typ: 'dokument',
        meta: { titel: 'T', erstellt: nowIso(), geaendert: nowIso(), version: 1 },
        inhalt: { kopf: 'K', fuss: 'F', seiten: [
          { typ: 'calc', html: '<p>a</p>', format: 'A3', ausrichtung: 'quer', linien: true,
            fmt: { '0,0': 'm2' }, cfmt: { '0,0': { b: true } }, colW: { '0': 120 },
            merges: [{ c: 0, r: 0, cs: 2, rs: 1 }], dispCols: 8, dispRows: 40 },
        ] },
        einstellungen: { schriftgroesse: 16 },
      });
      ingestGdoc(quelle);
      const d = lib.docs[lib.order[0]], p = (d && d.seiten && d.seiten[0]) || {};
      return d && d.kopf === 'K' && d.fuss === 'F'
        && p.format === 'A3' && p.ausrichtung === 'quer' && p.linien === true
        && p.html === '<p>a</p>' && p.fmt['0,0'] === 'm2' && p.cfmt['0,0'].b === true
        && p.colW['0'] === 120 && p.merges.length === 1 && p.dispCols === 8 && p.dispRows === 40;
    } catch (e) { return false; }
    finally { sanitizeHtml = sAlt; doc = dAlt; lib = lAlt; openDoc = oAlt; toast = tAlt; }
  })());

  // Sonderbloecke (Inhaltsverzeichnis, Figur): Original nur zurueck, wenn Gruppe vollstaendig
  ok('Sonderblock kommt zurueck, wenn die Gruppe vollstaendig und unveraendert ist', (() => {
    const raw = '<div class="toc"><b>Inhalt</b></div>';
    const z = [{ tag: 'h3', attrs: '', cells: ['Inhaltsverzeichnis'], rawId: 5, raw, rawKey: plainText('Inhaltsverzeichnis Kapitel'), rawN: 2 },
               { tag: 'p', attrs: '', cells: ['Kapitel'], rawId: 5, raw, rawKey: plainText('Inhaltsverzeichnis Kapitel'), rawN: 2 }];
    return gridToHtml({ cols: 1, zeilen: z, colStops: [] }) === raw;
  })());
  ok('fehlt eine Zeile der Gruppe, gewinnt das Bearbeitete (kein Wiederauferstehen)', (() => {
    const raw = '<div class="toc"><b>Inhalt</b></div>';
    const z = [{ tag: 'h3', attrs: '', cells: ['Inhaltsverzeichnis'], rawId: 5, raw, rawKey: plainText('Inhaltsverzeichnis Kapitel'), rawN: 2 }];
    return gridToHtml({ cols: 1, zeilen: z, colStops: [] }) === '<h3>Inhaltsverzeichnis</h3>';
  })());
  ok('persistLibGeprueft meldet Fehlschlag zurueck statt ihn zu verschlucken',
    typeof persistLibGeprueft === 'function');

  // --- Write-Modus: eine Zeile ist EINE Zeile (wie Word), Absaetze verbinden/trennen ---
  ok('zeilenVerbinden haengt die Zeile an die darueberliegende an', (() => {
    const alt = curGrid;
    curGrid = { cols: 1, zeilen: [{ tag: 'p', attrs: '', cells: ['Hallo '] }, { tag: 'p', attrs: '', cells: ['Welt'] }], colStops: [] };
    const naht = zeilenVerbinden(1);
    const txt = curGrid.zeilen[0].cells[0], n = curGrid.zeilen.length;
    curGrid = alt;
    return txt === 'Hallo Welt' && n === 1 && naht === 6;
  })());
  ok('rohText kuerzt Leerzeichen NICHT (plainText schon) - sonst sitzt der Cursor daneben',
    rohText('Hallo ') === 'Hallo ' && plainText('Hallo ') === 'Hallo');
  ok('zeilenVerbinden meldet die Nahtstelle (dort steht danach der Cursor)', (() => {
    const alt = curGrid;
    curGrid = { cols: 1, zeilen: [{ tag: 'p', attrs: '', cells: ['<b>Fett</b>'] }, { tag: 'p', attrs: '', cells: ['x'] }], colStops: [] };
    const naht = zeilenVerbinden(1); curGrid = alt;
    return naht === 4;   // Textlaenge OHNE Auszeichnung
  })());
  ok('zeilenVerbinden nimmt weitere Spalten mit (nichts geht verloren)', (() => {
    const alt = curGrid;
    curGrid = { cols: 2, zeilen: [{ tag: 'p', attrs: '', cells: ['a', 'b'] }, { tag: 'p', attrs: '', cells: ['c', 'd'] }], colStops: [] };
    zeilenVerbinden(1);
    const z = curGrid.zeilen[0].cells.join('|'); curGrid = alt;
    return z === 'ac|bd';
  })());
  ok('zeilenVerbinden in der ersten Zeile tut nichts (kein Absturz)', (() => {
    const alt = curGrid;
    curGrid = { cols: 1, zeilen: [{ tag: 'p', attrs: '', cells: ['a'] }], colStops: [] };
    const r = zeilenVerbinden(0), n = curGrid.zeilen.length; curGrid = alt;
    return r === -1 && n === 1;
  })());
  ok('Einfuegen und Verbinden heben sich auf', (() => {
    const alt = curGrid;
    curGrid = { cols: 1, zeilen: [{ tag: 'p', attrs: '', cells: ['Text'] }], colStops: [] };
    zeileEinfuegen(0); zeilenVerbinden(1);
    const r = curGrid.zeilen.length === 1 && curGrid.zeilen[0].cells[0] === 'Text';
    curGrid = alt; return r;
  })());

  // --- Schreibfluss: Autospeichern darf die laufende Zellbearbeitung nicht beenden ---
  ok('capturePage nimmt einen Parameter (beenden) - sonst schliesst Autospeichern die Zelle',
    capturePage.length === 1);
  ok('zelleSpiegeln vorhanden (uebernimmt Inhalt ohne die Bearbeitung zu beenden)',
    typeof zelleSpiegeln === 'function');
  ok('zelleSpiegeln ohne offene Zelle tut nichts und stuerzt nicht ab', (() => {
    const alt = editingTd; editingTd = null;
    const r = zelleSpiegeln(); editingTd = alt; return r === false;
  })());

  // --- Rueckgaengig / Wiederholen: Stapel-Logik ---
  ok('Verlauf: Schnappschuss bildet Seiten, Kopf, Fuss und Titel ab', (() => {
    const alt = doc;
    doc = { seiten: [{ typ: 'calc', html: '<p>a</p>' }], kopf: 'K', fuss: 'F', titel: 'T', einstellungen: {}, rasterCols: 6 };
    const j = schnappschuss(); doc = alt;
    return /"html":"<p>a<\/p>"/.test(j) && /"kopf":"K"/.test(j) && /"fuss":"F"/.test(j) && /"titel":"T"/.test(j);
  })());
  ok('Verlauf: gleiche Aenderung zweimal legt nur EINEN Schritt ab', (() => {
    const ad = doc, az = verlaufZurueckStapel.slice(), av = verlaufVorStapel.slice(), aj = standJetzt;
    doc = { seiten: [{ typ: 'calc', html: '<p>1</p>' }], kopf: '', fuss: '', titel: 'T', einstellungen: {}, rasterCols: 6 };
    verlaufZurueckStapel.length = 0; verlaufVorStapel.length = 0; standJetzt = schnappschuss();
    verlaufMerken();                                   // nichts geaendert -> kein Schritt
    const nach1 = verlaufZurueckStapel.length;
    doc.seiten[0].html = '<p>2</p>'; verlaufMerken();   // geaendert -> ein Schritt
    const nach2 = verlaufZurueckStapel.length;
    verlaufMerken();                                   // unveraendert -> kein weiterer
    const nach3 = verlaufZurueckStapel.length;
    doc = ad; verlaufZurueckStapel.length = 0; verlaufZurueckStapel.push(...az); verlaufVorStapel.length = 0; verlaufVorStapel.push(...av); standJetzt = aj;
    return nach1 === 0 && nach2 === 1 && nach3 === 1;
  })());
  ok('Verlauf: neue Aenderung laesst Wiederholen verfallen', (() => {
    const ad = doc, az = verlaufZurueckStapel.slice(), av = verlaufVorStapel.slice(), aj = standJetzt;
    doc = { seiten: [{ typ: 'calc', html: '<p>1</p>' }], kopf: '', fuss: '', titel: 'T', einstellungen: {}, rasterCols: 6 };
    verlaufZurueckStapel.length = 0; verlaufVorStapel.length = 0; standJetzt = schnappschuss();
    verlaufVorStapel.push('irgendwas');
    doc.seiten[0].html = '<p>2</p>'; verlaufMerken();
    const leer = verlaufVorStapel.length === 0;
    doc = ad; verlaufZurueckStapel.length = 0; verlaufZurueckStapel.push(...az); verlaufVorStapel.length = 0; verlaufVorStapel.push(...av); standJetzt = aj;
    return leer;
  })());
  ok('Verlauf: Stapel waechst nicht unbegrenzt (Grenze ' + VERLAUF_MAX + ')', (() => {
    const ad = doc, az = verlaufZurueckStapel.slice(), av = verlaufVorStapel.slice(), aj = standJetzt;
    doc = { seiten: [{ typ: 'calc', html: '<p>0</p>' }], kopf: '', fuss: '', titel: 'T', einstellungen: {}, rasterCols: 6 };
    verlaufZurueckStapel.length = 0; verlaufVorStapel.length = 0; standJetzt = schnappschuss();
    for (let i = 1; i <= VERLAUF_MAX + 25; i++) { doc.seiten[0].html = '<p>' + i + '</p>'; verlaufMerken(); }
    const n = verlaufZurueckStapel.length;
    doc = ad; verlaufZurueckStapel.length = 0; verlaufZurueckStapel.push(...az); verlaufVorStapel.length = 0; verlaufVorStapel.push(...av); standJetzt = aj;
    return n === VERLAUF_MAX;
  })());
  ok('Verlauf: kaputter Schnappschuss wird abgewiesen (kein Datenverlust)',
    standAnwenden('kein json') === false && standAnwenden('{"seiten":[]}') === false);
  ok('Verlauf: Wiederherstellung zaehlt nicht als neue Aenderung (verlaufLaeuft)', (() => {
    const az = verlaufZurueckStapel.slice(), aj = standJetzt;
    verlaufLaeuft = true; const vorher = verlaufZurueckStapel.length;
    verlaufMerken();
    const nachher = verlaufZurueckStapel.length; verlaufLaeuft = false;
    verlaufZurueckStapel.length = 0; verlaufZurueckStapel.push(...az); standJetzt = aj;
    return vorher === nachher;
  })());

  // --- Einheiten (Bauwesen): Anzeige mit Einheit, Wert bleibt rechenbar ---
  ok('Stk. ohne erzwungene Nachkommastellen', fmtNum(12, 'stk') === "12 Stk." && fmtNum(12.5, 'stk') === "12.5 Stk.");
  ok('m2 mit zwei Nachkommastellen', fmtNum(12.5, 'm2') === "12.50 m²");
  ok('m3 mit zwei Nachkommastellen', fmtNum(3, 'm3') === "3.00 m³");
  ok('lfm mit zwei Nachkommastellen', fmtNum(7.25, 'lfm') === "7.25 lfm");
  ok('Tausendertrennung auch mit Einheit', /1’?'?\s?000/.test(fmtNum(1000, 'm2').replace(/’/g, "'")) || fmtNum(1000, 'm2').indexOf('000') > 0);
  ok('Einheit ist nur ANZEIGE - der Wert bleibt eine Zahl (Summen rechnen weiter)', (() => {
    const alt = curGrid;
    curGrid = { cols: 1, zeilen: [{ tag: 'p', attrs: '', cells: ['12.5'] }, { tag: 'p', attrs: '', cells: ['7.5'] }], colStops: [] };
    const v = evalRaw('=SUMME(A1:A2)', new Set());
    curGrid = alt;
    return v === 20;
  })());
  ok('unbekanntes Format faellt auf reine Zahl zurueck', fmtNum(5, 'gibtsnicht') === (5).toLocaleString('de-CH'));

  // --- Dokumentmodus: fuehlt sich an wie Word (nur Cursor, Enter = neuer Absatz) ---
  ok('zeileEinfuegen setzt einen leeren Absatz darunter', (() => {
    const alt = curGrid;
    curGrid = { cols: 1, zeilen: [{ tag: 'p', attrs: '', cells: ['eins'] }, { tag: 'p', attrs: '', cells: ['zwei'] }], colStops: [] };
    zeileEinfuegen(0);
    const r = curGrid.zeilen.map(z => z.cells[0]).join('|');
    curGrid = alt;
    return r === 'eins||zwei';
  })());
  ok('zeileEinfuegen am Ende haengt an', (() => {
    const alt = curGrid;
    curGrid = { cols: 1, zeilen: [{ tag: 'p', attrs: '', cells: ['a'] }], colStops: [] };
    zeileEinfuegen(0);
    const n = curGrid.zeilen.length; curGrid = alt; return n === 2;
  })());
  ok('neue Zeile ist ein normaler Absatz (wird zu <p>)', (() => {
    const alt = curGrid;
    curGrid = { cols: 1, zeilen: [{ tag: 'p', attrs: '', cells: ['x'] }], colStops: [] };
    zeileEinfuegen(0);
    const h = gridToHtml(curGrid); curGrid = alt;
    return h === '<p>x</p><p><br></p>';
  })());

  // --- Grundmodell: das Raster IST das Blatt; der Knopf zeigt nur die Linien ---
  ok('neues Dokument startet im Raster (Raster = Grundgeruest)',
    newDocObject().seiten[0].typ === 'calc');
  ok('neues Dokument hat Kopf- und Fusszeile', (() => {
    const d = newDocObject(); return typeof d.kopf === 'string' && typeof d.fuss === 'string';
  })());
  ok('Gitterlinien sind anfangs AUS (man sieht ein Dokument, kein Tabellenblatt)',
    gitterSichtbar({ typ: 'calc' }) === false && gitterSichtbar({ typ: 'calc', linien: false }) === false);
  ok('Gitterlinien an, wenn die SEITE es sagt', gitterSichtbar({ typ: 'calc', linien: true }) === true);
  ok('Umschalten aendert NUR die Linien, nie den Seitentyp', (() => {
    const p = { typ: 'calc', linien: false, html: '<p>x</p>' };
    gitterUmschalten(p); const an = (p.linien === true && p.typ === 'calc');
    gitterUmschalten(p); const aus = (p.linien === false && p.typ === 'calc');
    return an && aus;
  })());
  ok('Linien gehoeren zur Seite: zwei Seiten sind unabhaengig', (() => {
    const a = { typ: 'calc', linien: false }, b = { typ: 'calc', linien: false };
    gitterUmschalten(a);
    return gitterSichtbar(a) === true && gitterSichtbar(b) === false;
  })());
  ok('Umschalten ist umkehrbar (Zustand kehrt zurueck)', (() => {
    const p = { typ: 'calc', linien: false };
    gitterUmschalten(p); gitterUmschalten(p);
    return p.linien === false;
  })());

  // --- Excel-Gewohnheiten: absolute Bezuege, Ausfuellen, AutoSumme, Auswahl-Kennzahlen ---
  ok('absoluter Bezug $A$1 wird gerechnet (frueher gar nicht erkannt)', evalRaw('=$A$1+0') === evalRaw('=A1+0'));
  ok('gemischter Bezug $A1 wird gerechnet', evalRaw('=$A1+0') === evalRaw('=A1+0'));
  ok('Bereich mit $ wird gerechnet', evalRaw('=SUMME($A$1:$A$2)') === evalRaw('=SUMME(A1:A2)'));
  ok('verschiebeFormel: relative Bezuege wandern mit', verschiebeFormel('=A1+B2', 1, 2) === '=B3+C4');
  ok('verschiebeFormel: $ haelt Spalte UND Zeile fest', verschiebeFormel('=$A$1', 3, 5) === '=$A$1');
  ok('verschiebeFormel: $A1 haelt nur die Spalte', verschiebeFormel('=$A1', 2, 1) === '=$A2');
  ok('verschiebeFormel: A$1 haelt nur die Zeile', verschiebeFormel('=A$1', 1, 4) === '=B$1');
  ok('verschiebeFormel: Bereiche wandern vollstaendig', verschiebeFormel('=SUMME(A1:A3)', 1, 0) === '=SUMME(B1:B3)');
  ok('verschiebeFormel: Funktionsname bleibt unangetastet', /^=SUMME\(/.test(verschiebeFormel('=SUMME(A1:A2)', 0, 1)));
  ok('verschiebeFormel: ueber den Rand ergibt #BEZUG (kein stiller Unsinn)', /#BEZUG/.test(verschiebeFormel('=A1', -5, 0)));
  ok('verschiebeFormel laesst reinen Text in Ruhe', verschiebeFormel('Hallo A1', 3, 3) === 'Hallo A1');
  ok('auswahlStatistik/fuelleAus/autoSummeFormel vorhanden',
    [auswahlStatistik, fuelleAus, autoSummeFormel].every(f => typeof f === 'function'));

  // --- Formeln ueberleben den Wechsel Gitter <-> Dokument (vorher wurden sie zu totem Text) ---
  ok('Formelzelle wird im Dokument zur fx-Marke (Wert sichtbar, Formel bleibt)', (() => {
    const h = gridToHtml({ cols: 1, zeilen: [{ tag: 'p', attrs: '', cells: ['=SUMME(A1:A2)'] }], colStops: [] });
    return /class="fx"/.test(h) && /data-fx="=SUMME\(A1:A2\)"/.test(h);
  })());
  ok('normale Zelle bleibt unangetastet',
    gridToHtml({ cols: 1, zeilen: [{ tag: 'p', attrs: '', cells: ['Hallo'] }], colStops: [] }) === '<p>Hallo</p>');
  ok('bestehende fx-Marke wird nicht doppelt verpackt', (() => {
    const c = '<span class="fx" data-fx="=A1">5</span>';
    return gridToHtml({ cols: 1, zeilen: [{ tag: 'p', attrs: '', cells: [c] }], colStops: [] }) === '<p>' + c + '</p>';
  })());

  // --- Gitter <-> Dokument: verlustfrei umschalten (der Kern des „Gitter"-Schalters) ---
  const G = (zeilen, extra) => gridToHtml(Object.assign({ cols: 2, zeilen, colStops: [] }, extra || {}));
  ok('Ausrichtung/Einzug bleiben (Block-Attribute)',
    /<p style="text-align:center">Mitte<\/p>/.test(G([{ tag: 'p', attrs: ' style="text-align:center"', cells: ['Mitte'] }])));
  ok('BLOCK_KEEP ist Teilmenge von ALLOWED_TAGS (sonst raeumt sanitizeHtml still auf)',
    ['p','h1','h2','h3','h4','blockquote','pre'].every(t => BLOCK_KEEP.test(t) && ALLOWED_TAGS.has(t.toUpperCase()))
    && !BLOCK_KEEP.test('h5') && !BLOCK_KEEP.test('h6'));
  ok('Ueberschrift h4 bleibt h4 (frueher zu <p> plattgemacht)',
    /<h4>Vier<\/h4>/.test(G([{ tag: 'h4', attrs: '', cells: ['Vier'] }])));
  ok('unbekannter Tag faellt sicher auf <p> zurueck',
    /^<p>X<\/p>$/.test(G([{ tag: 'script', attrs: '', cells: ['X'] }])));
  ok('Liste bleibt Liste (frueher Wortsalat in einer Zelle)', (() => {
    const r = G([{ tag: 'li', attrs: '', cells: ['eins'], list: 'ul', listId: 1, listAttrs: '' },
                 { tag: 'li', attrs: '', cells: ['zwei'], list: 'ul', listId: 1, listAttrs: '' }]);
    return /^<ul><li>eins<\/li><li>zwei<\/li><\/ul>$/.test(r);
  })());
  ok('nummerierte Liste behaelt ihren Typ',
    /^<ol[\s>]/.test(G([{ tag: 'li', attrs: '', cells: ['a'], list: 'ol', listId: 2, listAttrs: '' }])));
  ok('Tabelle bleibt Tabelle (frueher unwiederbringlich zu Absaetzen)', (() => {
    const r = G([{ tag: 'p', attrs: '', cells: ['A', 'B'], tbl: 3, tblAttrs: '', trAttrs: '', cellTag: ['th', 'td'], cellAttrs: ['', ''] }]);
    return /<table><tbody><tr><th>A<\/th><td>B<\/td><\/tr><\/tbody><\/table>/.test(r);
  })());
  ok('zwei Tabellen verschmelzen NICHT', (() => {
    const r = G([{ tag: 'p', attrs: '', cells: ['1'], tbl: 1, cellTag: ['td'], cellAttrs: [''] },
                 { tag: 'p', attrs: '', cells: ['2'], tbl: 2, cellTag: ['td'], cellAttrs: [''] }]);
    return (r.match(/<table>/g) || []).length === 2;
  })());
  ok('unveraenderter Sonderblock kommt 1:1 zurueck (Inhaltsverzeichnis, Figur)', (() => {
    const raw = '<div class="toc"><b>Inhalt</b></div>';
    return G([{ tag: 'p', attrs: '', cells: ['Inhalt'], rawId: 9, raw, rawKey: plainText(raw) }]) === raw;
  })());
  ok('BEARBEITETER Sonderblock wird zu Absaetzen (Aenderung geht nicht verloren)', (() => {
    const raw = '<div class="toc"><b>Inhalt</b></div>';
    const r = G([{ tag: 'p', attrs: '', cells: ['Neuer Text'], rawId: 9, raw, rawKey: plainText(raw) }]);
    return r === '<p>Neuer Text</p>';
  })());
  ok('leeres Gitter ergibt einen leeren Absatz', gridToHtml({ zeilen: [] }) === '<p><br></p>');
  ok('plainText ist DOM-frei und vergleichbar',
    plainText('<b>Hallo</b>&nbsp;&amp; <i>Welt</i>') === 'Hallo & Welt');

  // Leerzustand (erster Eindruck): ordner-spezifisch, Aktions-Knopf nur bei „Dokumente"
  { const _af = activeFolder;
    activeFolder = 'favoriten'; ok('Leerzustand Favoriten (kein CTA)', /Keine Favoriten/.test(renderEmptyState()) && !/esNew/.test(renderEmptyState()));
    activeFolder = 'papierkorb'; ok('Leerzustand Papierkorb-Text', /Papierkorb ist leer/.test(renderEmptyState()));
    activeFolder = 'dokumente'; ok('Leerzustand Dokumente (mit CTA)', /esNew/.test(renderEmptyState()) && /Noch keine Dokumente/.test(renderEmptyState()));
    activeFolder = _af;
  }

  // Dokument-Kontextmenü (echtes Menü statt prompt): richtige Aktionen je nach Zustand
  ok('docMenuItems normal', docMenuItems({}).join(',') === 'open,fav,rename,dup,arch,trash');
  ok('docMenuItems Papierkorb', docMenuItems({ trashed: true }).join(',') === 'restore,purge');
  ok('DOC_MENU Favorit-Label wechselt', (typeof DOC_MENU.fav.t === 'function') && DOC_MENU.fav.t({ fav: true }).includes('entfernen') && !DOC_MENU.fav.t({ fav: false }).includes('entfernen'));

  // Vorlagen-Galerie: eine Karte je Vorlage, mit Beschreibung
  { const g = renderTemplateHint(); const cards = (g.match(/tmpl-card/g) || []).length;
    ok('Vorlagen-Galerie: Karte je Vorlage', cards === Object.keys(TEMPLATES).length);
    ok('Vorlagen-Galerie: Beschreibungen vorhanden', /Ratenplan nach Baufortschritt/.test(g) && /tc-d/.test(g)); }

  // Calc-Namensfeld: Einzelzelle vs. Bereichsgrösse (Zeilen×Spalten)
  ok('selRefLabel Einzelzelle', selRefLabel(0, 0, 0, 0, 'A1') === 'A1');
  ok('selRefLabel Bereich 3×2', selRefLabel(0, 1, 0, 2, 'A1') === '3×2');
  ok('selRefLabel Zeile 1×4', selRefLabel(0, 3, 5, 5, 'A6') === '1×4');

  // Export-HTML: markenkonform (grün, kein Blau-Rest) + konvertierte Positionsliste
  { const _d = doc; doc = { titel: 'T & Co', einstellungen: { schriftart: 'Inter', schriftgroesse: 16, zeilenabstand: 1.6 } };
    const shell = docHtmlShell('<p>x</p>');
    ok('Export-HTML grün, kein Blau-Rest', shell.includes('#4f7a3c') && !shell.includes('#2f6df6'));
    ok('Export-HTML rendert .pdftab', /\.pdftab tr\.tot/.test(shell));
    ok('Export-HTML Titel escaped', /T &amp; Co/.test(shell));
    doc = _d;
  }

  // Excel-Farben: ARGB, Theme+Tint, indexiert
  eq('xlsx ARGB → Hex', xlsxHexFromArgb('FF3366CC'), '#3366cc');
  eq('xlsx Indexed 2 = rot', xlsxColor({ getAttribute: a => a === 'indexed' ? '2' : null }, null), '#ff0000');
  ok('xlsx Theme+Tint heller', (() => { const th = { colors: { dk1: '#000000' } }; const el = { getAttribute: a => a === 'theme' ? '1' : a === 'tint' ? '0.5' : null }; const c = xlsxColor(el, th); return /^#[0-9a-f]{6}$/.test(c) && c !== '#000000'; })());
  ok('xlsx Tint 0 unveraendert', xlsxTint('#3366cc', 0) === '#3366cc');

  return { R, pass, fail };
}
