/* ============================================================
   Submit Write — write.js  (Vanilla, dateibasiert, .gdoc)
   "Schreiben ohne Ablenkung."
   ============================================================ */
'use strict';
const WRITE_VERSION = 'v19';
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
const ALLOWED_ATTR = { '*': ['style', 'class', 'id'], A: ['href', 'target', 'rel', 'data-go'], IMG: ['src', 'alt', 'width', 'height'], FONT: ['face', 'color', 'size'], TD: ['colspan', 'rowspan'], TH: ['colspan', 'rowspan'], DIV: ['contenteditable', 'data-toc'], SPAN: ['contenteditable'] };
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
  } catch (_) {}
  return { docs: {}, order: [], currentId: null };
}
function persistLib() { try { localStorage.setItem(LS_LIB, JSON.stringify(lib)); return true; } catch (_) { return false; } }
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
    seiten: [{ id: uid(), typ: 'write', html: '' }], aktiv: 0,
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
    p.typ = (p.typ === 'calc') ? 'calc' : (p.typ === 'slides') ? 'slides' : 'write';
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
function htmlToGrid(html) {
  const tpl = document.createElement('template'); tpl.innerHTML = html || '';
  const zeilen = [];
  const blockRow = b => {
    const cells = []; let cur = '';
    b.childNodes.forEach(n => {
      if (n.nodeType === 1 && n.classList && n.classList.contains('colsep')) { cells.push(cur); cur = ''; }
      else if (n.nodeType === 3 && n.textContent.indexOf('\t') >= 0) {       // echte Tabs im Text = Spalten
        const parts = n.textContent.split('\t');
        parts.forEach((p, idx) => { if (idx > 0) { cells.push(cur); cur = ''; } cur += esc(p); });
      }
      else cur += (n.nodeType === 1 ? n.outerHTML : esc(n.textContent));
    });
    cells.push(cur);
    zeilen.push({ tag: (b.tagName || 'P').toLowerCase(), cells });
  };
  [...tpl.content.children].forEach(b => {
    if (b.tagName === 'TABLE') {                                            // echte Write-Tabelle = Gitterzeilen
      b.querySelectorAll('tr').forEach(tr => {
        const cells = [...tr.children].map(td => td.innerHTML.trim());
        zeilen.push({ tag: 'p', cells: cells.length ? cells : [''] });
      });
    } else if (b.classList && b.classList.contains('toc')) {                // Inhaltsverzeichnis: saubere Zeilen, nicht als Wort-Salat
      zeilen.push({ tag: 'h3', cells: ['Inhaltsverzeichnis'] });
      const links = b.querySelectorAll('.toc-list a, a[data-go]');
      links.forEach(a => { const t = (a.textContent || '').trim(); if (t) zeilen.push({ tag: 'p', cells: [esc(t)] }); });
      if (!links.length) zeilen.push({ tag: 'p', cells: [''] });
    } else blockRow(b);
  });
  if (!zeilen.length) zeilen.push({ tag: 'p', cells: [''] });
  return { cols: Math.max(1, ...zeilen.map(z => z.cells.length)), zeilen };
}
function gridToHtml(grid) {
  return grid.zeilen.map(z => {
    const tag = /^h[1-3]$/.test(z.tag) ? z.tag : 'p';
    const inner = (z.cells.length ? z.cells : ['']).map(c => c || '').join(COLSEP);
    return `<${tag}>${inner || '<br>'}</${tag}>`;
  }).join('') || '<p><br></p>';
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
  if (doc && doc.id !== id && dirty) { clearTimeout(saveTimer); autosave(); }  // alten Stand sichern, bevor gewechselt wird
  clearTimeout(saveTimer);
  doc = migrateDoc(d); fileHandle = null;
  $('#zoneH').innerHTML = sanitizeHtml(d.kopf || '');
  $('#zoneF').innerHTML = sanitizeHtml(d.fuss || '');
  titleEl.value = d.titel || 'Unbenanntes Dokument';
  applySettings();
  renderPageNav();
  renderActivePage();
  lib.currentId = id; persistLib();
  setDirty(false); renderList();
}
function createDoc(partial) {
  const d = newDocObject(partial);
  if (partial && partial.html != null) { d.seiten = [{ id: uid(), typ: 'write', html: partial.html }]; d.aktiv = 0; delete d.html; }
  lib.docs[d.id] = d; lib.order.unshift(d.id); persistLib();
  openDoc(d.id);
  return d;
}
function applySettings() {
  const s = doc.einstellungen;
  editor.style.fontFamily = s.schriftart;
  editor.style.fontSize = s.schriftgroesse + 'px';
  editor.style.lineHeight = s.zeilenabstand;
  $('#selFont').value = s.schriftart;
  $('#selSize').value = String(s.schriftgroesse);
  $$('#segLine button').forEach(b => b.classList.toggle('on', +b.dataset.line === +s.zeilenabstand));
  $('#selLine').value = String(s.zeilenabstand);
  const cols = s.spalten || 1;
  editor.style.columnCount = cols > 1 ? cols : '';
  editor.style.columnGap = cols > 1 ? '12mm' : '';
  const selC2 = $('#selCols'); if (selC2) selC2.value = String(cols);
  const o = s.ausrichtung || 'hoch';
  page.classList.toggle('quer', o === 'quer');
  $('#btnPortrait').classList.toggle('on', o !== 'quer');
  $('#btnLandscape').classList.toggle('on', o === 'quer');
  applyFormat();
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
function capturePage() {
  const p = activePage(); if (!p) return;
  if (p.typ === 'calc') { if (editingTd) endEdit(true); if (curGrid) p.html = gridToHtml(curGrid); }   // offene Zellbearbeitung zuerst sichern
  else p.html = cleanEditorHTML();   // ohne Rechtschreib-Markierungen speichern
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
  if (persistLib()) { setDirty(false); renderList(); }
  else { saveState.classList.remove('saving'); saveState.classList.add('dirty'); $('.lbl', saveState).textContent = 'Speicher voll!'; warnQuota(); }
}
function scheduleSave() {
  setDirty(true);
  saveState.classList.add('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveState.classList.remove('saving'); autosave(); }, 800);
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
  let text = null, handle = null;
  if (window.showOpenFilePicker) {
    try {
      const [h] = await window.showOpenFilePicker({
        types: [{ description: 'Submit Paper', accept: { 'application/json': ['.paper', '.gdoc', '.json'] } }]
      });
      handle = h; text = await (await h.getFile()).text();
    } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  if (text === null) {
    text = await new Promise(res => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.paper,.gdoc,.json';
      inp.onchange = () => { const f = inp.files[0]; if (!f) return res(null); const r = new FileReader(); r.onload = () => res(r.result); r.readAsText(f); };
      inp.click();
    });
  }
  if (!text) return;
  ingestGdoc(text, handle);
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
      const typ = (p && p.typ === 'calc') ? 'calc' : (p && p.typ === 'slides') ? 'slides' : 'write';
      let html = sanitizeHtml((p && p.html) || '');
      if (!html && p && p.tabelle && p.tabelle.cells) html = tabelleToHtml(p.tabelle);   // sehr alte Calc-Seite
      return { id: uid(), typ, html, fmt: (p && p.fmt && typeof p.fmt === 'object') ? p.fmt : {}, colW: (p && p.colW && typeof p.colW === 'object') ? p.colW : {}, notiz: (p && typeof p.notiz === 'string') ? p.notiz : '' };
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
  if (!persistLib()) warnQuota();
  openDoc(d.id); fileHandle = handle || null;
  toast('Geöffnet: ' + d.titel);
}

/* ============================================================
   Formatierung (contentEditable)
   ============================================================ */
function cmd(name, val = null) { editor.focus(); document.execCommand(name, false, val); afterEdit(); }

function setBlock(tag) {
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
function afterEdit() { normalizeEmpty(); scheduleSave(); refreshAll(); spellLater(); }

/* ---------- aktiven Zustand der Buttons spiegeln ---------- */
function syncToolbar() {
  const q = c => { try { return document.queryCommandState(c); } catch (_) { return false; } };
  [['bold'], ['italic'], ['underline'], ['strikeThrough'],
   ['insertUnorderedList'], ['insertOrderedList'],
   ['justifyLeft'], ['justifyCenter'], ['justifyRight']
  ].forEach(([c]) => { const b = $(`.fb-btn[data-cmd="${c}"]`); if (b) b.classList.toggle('on', q(c)); });
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
  const pages = isSlides() ? Math.max(1, slidePages().length) : updatePages();
  const read = Math.max(1, Math.round(words / 200));
  $('#stWords').textContent = words.toLocaleString('de-CH') + ' Wörter';
  $('#stChars').textContent = chars.toLocaleString('de-CH') + ' Zeichen';
  $('#stPars').textContent = pars + (pars === 1 ? ' Absatz' : ' Absätze');
  $('#stPages').textContent = isSlides() ? (pages + (pages === 1 ? ' Folie' : ' Folien')) : (pages + (pages === 1 ? ' Seite' : ' Seiten'));
  $('#stRead').textContent = isSlides() ? 'Präsentation' : (words ? '~' + read + ' Min. Lesezeit' : '0 Min. Lesezeit');
  // Inspector-Statistik
  $('#statGrid').innerHTML = [
    ['Wörter', words.toLocaleString('de-CH')], ['Zeichen', chars.toLocaleString('de-CH')],
    ['Absätze', pars], ['Seiten', pages],
    ['Lesezeit', (words ? '~' + read : '0') + ' Min.'], ['Version', 'v' + (doc?.meta.version || 1)]
  ].map(([l, n]) => `<div class="stat-cell"><div class="sc-n">${n}</div><div class="sc-l">${l}</div></div>`).join('');
}
// Statistik für Calc-Seiten (echte Zell-/Zeilen-/Spaltenzahlen statt veraltetem Write-Text)
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
  $('#statGrid').innerHTML = [
    ['Zellen', filled], ['Zeilen', rows], ['Spalten', cols], ['Version', 'v' + (doc?.meta.version || 1)]
  ].map(([l, n]) => `<div class="stat-cell"><div class="sc-n">${n}</div><div class="sc-l">${l}</div></div>`).join('');
}

function updateOutline() {
  const heads = $$('h1,h2,h3', editor).filter(h => h.innerText.trim());
  const box = $('#outline');
  if (!heads.length) { box.innerHTML = '<p class="muted">Noch keine Überschriften.</p>'; return; }
  box.innerHTML = '';
  heads.forEach((h, i) => {
    h.id = h.id || 'h_' + i;
    const a = document.createElement('a');
    a.textContent = h.innerText.trim();
    a.className = 'lv' + h.tagName[1];
    a.onclick = () => h.scrollIntoView({ behavior: 'smooth', block: 'start' });
    box.appendChild(a);
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
  if (!ids.length) { list.innerHTML = '<div class="list-empty">Noch keine Dokumente hier.</div>'; return; }
  ids.forEach(id => {
    const d = lib.docs[id];
    const el = document.createElement('div');
    el.className = 'doc-item' + (id === lib.currentId ? ' current' : '');
    el.innerHTML = `<span class="di-title">${esc(d.titel)}</span><span class="di-meta">${fmtDate(d.meta.geaendert)}${d.fav ? ' · ★' : ''}</span>`;
    el.onclick = () => openDoc(id);
    el.oncontextmenu = (e) => { e.preventDefault(); docMenu(id); };
    list.appendChild(el);
  });
}
function docMenu(id) {
  const d = lib.docs[id];
  const a = prompt(`„${d.titel}"\n\n1 = Favorit umschalten\n2 = Archivieren\n3 = In Papierkorb\n4 = Duplizieren\n5 = Endgültig löschen`, '');
  if (a === '1') d.fav = !d.fav;
  else if (a === '2') { d.folder = d.folder === 'archiv' ? 'dokumente' : 'archiv'; }
  else if (a === '3') d.trashed = true;
  else if (a === '4') { const c = newDocObject({ ...JSON.parse(JSON.stringify(d)), id: uid(), titel: d.titel + ' (Kopie)', folder: 'dokumente', trashed: false, fav: false }); lib.docs[c.id] = c; lib.order.unshift(c.id); }
  else if (a === '5') { delete lib.docs[id]; lib.order = lib.order.filter(x => x !== id); if (lib.currentId === id) { lib.currentId = lib.order[0] || null; lib.currentId ? openDoc(lib.currentId) : createDoc(); } }
  persistLib(); renderList();
}

/* ---------- Vorlagen ---------- */
const TODAY = new Date().toLocaleDateString('de-CH');
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
     <h2>Kenntnisse</h2><ul><li>Sprachen: …</li><li>IT: …</li></ul>` }
};
function renderTemplateHint() {
  return '<div style="padding:8px 4px;display:flex;flex-direction:column;gap:4px">' +
    Object.entries(TEMPLATES).map(([k, t]) => `<button class="snav tmpl" data-tmpl="${k}"><svg viewBox="0 0 24 24" class="i"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg><span>${t.titel}</span></button>`).join('') +
    '</div>';
}
function bindTemplateHint() {
  $$('.tmpl').forEach(b => b.onclick = () => {
    const t = TEMPLATES[b.dataset.tmpl];
    createDoc({ titel: t.titel, html: t.html });
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
  return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>${esc(doc.titel)}</title>
<style>body{font-family:${s.schriftart};font-size:${s.schriftgroesse}px;line-height:${s.zeilenabstand};color:#1a1e27;max-width:760px;margin:40px auto;padding:0 24px}
h1{font-size:30px}h2{font-size:23px}h3{font-size:18px}blockquote{border-left:3px solid #2f6df6;padding-left:14px;color:#555;font-style:italic}
pre{background:#f5f6f8;padding:14px;border-radius:8px;overflow:auto}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:6px 10px}a{color:#2f6df6}</style>
</head><body>${inner}</body></html>`;
}
function download(name, text, mime) {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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
  if (kind === 'pdf') { if (isSlides()) { printDeck(); return; } window.print(); return; }
  const mdRoot = editor.cloneNode(true); mdRoot.querySelectorAll('.sp-err').forEach(s => s.replaceWith(document.createTextNode(s.textContent)));
  if (kind === 'html') { download(name + '.html', docHtmlShell(cleanEditorHTML()), 'text/html'); toast('HTML exportiert'); }
  else if (kind === 'md') { download(name + '.md', htmlToMarkdown(mdRoot), 'text/markdown'); toast('Markdown exportiert'); }
  else if (kind === 'docx') {
    // Beta: Word öffnet HTML mit .doc-Endung zuverlässig
    download(name + '.doc', docHtmlShell(cleanEditorHTML()), 'application/msword'); toast('DOCX (Beta) exportiert');
  }
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
  $('#selFont').addEventListener('change', e => { if (!doc) return; doc.einstellungen.schriftart = e.target.value; editor.style.fontFamily = e.target.value; scheduleSave(); });
  $('#selSize').addEventListener('change', e => { if (!doc) return; const px = +e.target.value; if (window.getSelection().isCollapsed) { doc.einstellungen.schriftgroesse = px; editor.style.fontSize = px + 'px'; scheduleSave(); } else setFontSize(px); });
  $('#inkColor').addEventListener('input', e => { document.execCommand('styleWithCSS', false, true); cmd('foreColor', e.target.value); });
  $('#imgInput').addEventListener('change', e => { insertImageFile(e.target.files[0]); e.target.value = ''; });
  $('#hlColor').addEventListener('input', e => highlight(e.target.value));
  $('#btnClear').addEventListener('click', () => { cmd('removeFormat'); setBlock('p'); });

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
  $('#pvPrint').addEventListener('click', () => { const sl = isSlides(); $('#previewOverlay').hidden = true; setTimeout(() => sl ? printDeck() : window.print(), 60); });

  // Submit PDF
  $('#btnPdf').addEventListener('click', () => { $('#pdfOverlay').hidden = false; });
  $('#pdfClose').addEventListener('click', () => { $('#pdfOverlay').hidden = true; });
  $('#pdfExport').addEventListener('click', () => { $('#pdfOverlay').hidden = true; setTimeout(() => doExport('pdf'), 60); });
  $$('[data-pdfimp]').forEach(b => b.addEventListener('click', () => { pdfTarget = b.dataset.pdfimp; $('#pdfInput').click(); }));
  $('#pdfInput').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) importPdf(f); });

  // Submit Slides – Präsentieren (Vollbild)
  $('#btnPresent').addEventListener('click', presentStart);
  $('#presClose').addEventListener('click', presentEnd);
  $('#presPrev').addEventListener('click', () => presGo(-1));
  $('#presNext').addEventListener('click', () => presGo(1));
  $('#presentSlide').addEventListener('click', () => presGo(1));
  $('#presNotesBtn').addEventListener('click', presToggleNotes);
  // Sprechnotizen bearbeiten
  $('#slideNotesInput').addEventListener('input', e => { if (doc && isSlides()) { activePage().notiz = e.target.value; scheduleSave(); } });
  document.addEventListener('keydown', e => {
    if ($('#presentOverlay').hidden) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); presGo(1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'Backspace') { e.preventDefault(); presGo(-1); }
    else if (e.key === 'Home') { e.preventDefault(); presIdx = 0; presRender(); }
    else if (e.key === 'End') { e.preventDefault(); presIdx = presList.length - 1; presRender(); }
    else if (e.key === 'n' || e.key === 'N') { e.preventDefault(); presToggleNotes(); }
    else if (e.key === 'Escape') { e.preventDefault(); presentEnd(); }
  });
  document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && !$('#presentOverlay').hidden) $('#presentOverlay').hidden = true; });

  // Modus-Umschalter (Write / Calc / Slides)
  $('#modePill').addEventListener('click', e => { e.stopPropagation(); $('#modeMenu').hidden = !$('#modeMenu').hidden; });
  $('#modeMenu').addEventListener('click', e => { const m = e.target.closest('button')?.dataset.mode; if (m) { $('#modeMenu').hidden = true; setPageType(m); } });

  // Seiten-Reiter (Navigator)
  $('#pagetabs').addEventListener('click', e => {
    const del = e.target.closest('[data-del]'); if (del) { e.stopPropagation(); deletePage(+del.dataset.del); return; }
    if (e.target.closest('#ptAdd')) { e.stopPropagation(); $('#addMenu').hidden = !$('#addMenu').hidden; return; }
    const a = e.target.closest('[data-add]'); if (a) { $('#addMenu').hidden = true; addPage(a.dataset.add); return; }
    const tab = e.target.closest('.ptab'); if (tab) switchPage(+tab.dataset.i);
  });
  document.addEventListener('click', () => { const m = $('#addMenu'); if (m) m.hidden = true; });
  document.addEventListener('click', () => $('#modeMenu').hidden = true);

  // Submit Calc – Gitter im Write-Blatt
  const pgEl = $('#pageGrid');
  const calcFocus = () => pgEl.focus();
  $('#calcAddRow').addEventListener('click', calcAddRow);
  $('#calcAddCol').addEventListener('click', calcAddCol);
  $$('#calcBar [data-fmt]').forEach(b => b.addEventListener('click', () => setCellFormat(b.dataset.fmt)));
  // Lineal-Leisten: Spalte/Zeile wählen, Spaltenbreite ziehen
  $('#colRuler').addEventListener('mousedown', e => {
    const rz = e.target.closest('.cresize'); if (rz) { e.preventDefault(); startColResize(+rz.dataset.c, e); return; }
    const seg = e.target.closest('.cr-seg'); if (seg) { const c = +seg.dataset.c; selectCell(c, 0); selectCell(c, gridRows - 1, true); calcFocus(); }
  });
  $('#rowRuler').addEventListener('mousedown', e => {
    const seg = e.target.closest('.rr-seg'); if (seg) { const r = +seg.dataset.r; selectCell(0, r); selectCell(gridCols - 1, r, true); calcFocus(); }
  });
  $('#canvas').addEventListener('scroll', () => { if (appEl.classList.contains('calc-mode')) $('#colRuler').style.top = $('#canvas').scrollTop + 'px'; });
  // Maus: Auswahl + Bereich ziehen (delegiert auf #pageGrid)
  let gridDragging = false;
  pgEl.addEventListener('mousedown', e => {
    const td = e.target.closest('td[data-c]'); if (!td) return;
    if (editingTd && editingTd !== td) endEdit(true);
    gridDragging = true; e.preventDefault();
    selectCell(+td.dataset.c, +td.dataset.r, e.shiftKey); calcFocus();
  });
  pgEl.addEventListener('mousemove', e => { if (!gridDragging) return; const td = e.target.closest('td[data-c]'); if (td) selectCell(+td.dataset.c, +td.dataset.r, true); });
  document.addEventListener('mouseup', () => { gridDragging = false; });
  pgEl.addEventListener('dblclick', e => { const td = e.target.closest('td[data-c]'); if (td) { selectCell(+td.dataset.c, +td.dataset.r); beginEdit(); } });
  pgEl.addEventListener('contextmenu', e => { const td = e.target.closest('td[data-c]'); if (!td) return; e.preventDefault(); if (!td.classList.contains('sel')) selectCell(+td.dataset.c, +td.dataset.r); showGridMenu(e.clientX, e.clientY); });
  $('#ctxmenu').addEventListener('click', e => { const g = e.target.closest('button')?.dataset.g; if (g) gridMenuAction(g); });

  // Formelzeile
  $('#formulaInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commitCell(e.target.value); selectCell(selC, selR + 1); calcFocus(); }
    else if (e.key === 'Tab') { e.preventDefault(); commitCell(e.target.value); selectCell(selC + 1, selR); calcFocus(); }
    else if (e.key === 'Escape') { highlightSel(); calcFocus(); }
  });
  // Tastatur (Navigation, Inline-Edit, Bereich mit Umschalt) – für Gitter UND Blatt
  const calcKey = e => {
    if (document.activeElement === $('#formulaInput')) return;
    if (editingTd) {
      if (e.key === 'Enter' && (e.altKey || e.shiftKey)) { e.preventDefault(); document.execCommand('insertHTML', false, '<br>'); }  // Zeilenumbruch in der Zelle
      else if (e.key === 'Enter') { e.preventDefault(); endEdit(true); selectCell(selC, selR + 1); calcFocus(); }
      else if (e.key === 'Tab') { e.preventDefault(); endEdit(true); selectCell(selC + 1, selR); calcFocus(); }
      else if (e.key === 'Escape') { e.preventDefault(); endEdit(false); calcFocus(); }
      return;
    }
    const k = e.key, ext = e.shiftKey;
    if (k === 'ArrowDown') { e.preventDefault(); selectCell(selC, selR + 1, ext); }
    else if (k === 'ArrowUp') { e.preventDefault(); selectCell(selC, selR - 1, ext); }
    else if (k === 'ArrowRight') { e.preventDefault(); selectCell(selC + 1, selR, ext); }
    else if (k === 'ArrowLeft') { e.preventDefault(); selectCell(selC - 1, selR, ext); }
    else if (k === 'Tab') { e.preventDefault(); selectCell(selC + (ext ? -1 : 1), selR); }
    else if (k === 'Enter' || k === 'F2') { e.preventDefault(); beginEdit(); }
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); const { c1, c2, r1, r2 } = rangeBounds(); for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) { gridEnsure(curGrid, c, r); curGrid.zeilen[r].cells[c] = ''; } activePage().html = gridToHtml(curGrid); renderCalc(); scheduleSave(); }
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); beginEdit(k); }
  };
  pgEl.addEventListener('keydown', calcKey);

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
    z.addEventListener('input', () => { scheduleSave(); updatePages(); });
    z.addEventListener('paste', e => { const html = e.clipboardData?.getData('text/html'); if (html) { e.preventDefault(); document.execCommand('insertHTML', false, sanitizeHtml(html)); scheduleSave(); } });
  });

  // Rechtsklick-Menü
  editor.addEventListener('contextmenu', e => {
    e.preventDefault();
    $$('img.sel', editor).forEach(i => i.classList.remove('sel'));
    if (e.target.tagName === 'IMG') e.target.classList.add('sel');
    spellTarget = e.target.closest('.sp-err');   // falsch geschriebenes Wort unter dem Cursor
    showContextMenu(e.clientX, e.clientY);
  });
  $('#ctxmenu').addEventListener('click', e => { const a = e.target.closest('button')?.dataset.ctx; if (a) ctxAction(a); });
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
    const gd = files.find(f => /\.(gdoc|json)$/i.test(f.name));
    if (gd) gd.text().then(t => ingestGdoc(t, null));
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
  document.addEventListener('selectionchange', () => { updateBubble(); updateTableTools(); });
  $('#canvas').addEventListener('scroll', () => { if (!b.hidden) updateBubble(); if (!$('#tabletools').hidden) updateTableTools(); });

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
  $('#btnFocusExit').addEventListener('click', toggleFocus);
  $('#btnTheme').addEventListener('click', () => setTheme(document.body.dataset.theme === 'dark' ? 'light' : 'dark'));

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
  $('#btnSideCollapse').addEventListener('click', () => { appEl.classList.toggle('side-rail'); applyZoom(); });
  $('#btnSideShow').addEventListener('click', () => appEl.classList.toggle('side-mobile'));
  $('#btnInspClose').addEventListener('click', () => { appEl.classList.remove('insp-open'); applyZoom(); });
  $('#btnInspector').addEventListener('click', () => { appEl.classList.toggle('insp-open'); applyZoom(); });

  // .gdoc per Drag&Drop ins Fenster öffnen
  window.addEventListener('dragover', e => { if ([...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', e => {
    if (editor.contains(e.target)) return;    // im Editor regelt der Editor selbst
    const files = [...(e.dataTransfer?.files || [])];
    if (!files.length) return;
    e.preventDefault();                       // verhindert Wegnavigieren bei Datei-Drop
    const f = files.find(f => /\.(paper|gdoc|json)$/i.test(f.name));
    if (f) f.text().then(t => ingestGdoc(t, null));
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
    // markiertes Bild löschen
    if ((e.key === 'Delete' || e.key === 'Backspace')) {
      const im = $('img.sel', editor); if (im) { e.preventDefault(); im.remove(); afterEdit(); return; }
    }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); saveFile(e.shiftKey); }
    else if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); openFile(); }
    else if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); createDoc(); }
    else if (mod && e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); toggleFocus(); }
    else if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); toggleFind(true); }
    else if (mod && (e.key === '+' || e.key === '=')) { e.preventDefault(); zoomStep(.1); }
    else if (mod && (e.key === '-' || e.key === '_')) { e.preventDefault(); zoomStep(-.1); }
    else if (mod && e.key === '0') { e.preventDefault(); setZoom('auto'); }
    else if (e.key === 'Escape') {
      if (!$('#pdfOverlay').hidden) $('#pdfOverlay').hidden = true;
      else if (!$('#previewOverlay').hidden) $('#previewOverlay').hidden = true;
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
const FORMATS = { A4: [210, 297], A3: [297, 420], A2: [420, 594], A1: [594, 841], A0: [841, 1189] };  // Hochformat [B,H] in mm
const SLIDE_MM = [338, 190];    // Folie 16:9 (≈ PowerPoint Breitbild) in mm
function isSlides() { return !!(doc && doc.seiten && activePage() && activePage().typ === 'slides'); }
function pageDims() {
  if (isSlides()) return { w: SLIDE_MM[0], h: SLIDE_MM[1] };   // Folien immer 16:9-Querformat
  const f = FORMATS[(doc && doc.einstellungen.format) || 'A4'] || FORMATS.A4;
  const quer = doc && doc.einstellungen.ausrichtung === 'quer';
  return { w: quer ? f[1] : f[0], h: quer ? f[0] : f[1] };
}
function pageWidthMm() { return pageDims().w; }
function pageHeightPx() { return pageDims().h * MM; }
function applyFormat() {
  if (!doc) return;
  const d = pageDims();
  page.style.width = d.w + 'mm';
  page.style.minHeight = d.h + 'mm';
  if (isSlides()) page.style.height = d.h + 'mm'; else page.style.height = '';
  $('#pageFormat').textContent = isSlides() ? 'Folie · 16:9' : ((doc.einstellungen.format || 'A4') + ' · ' + d.w + ' × ' + d.h + ' mm');
  $('#selFormat').value = doc.einstellungen.format || 'A4';
}
function setFormat(f) {
  if (!doc || !FORMATS[f]) return;
  doc.einstellungen.format = f;
  applyFormat(); applyZoom(); updatePages(); scheduleSave();
}
function applyZoom() {
  const extra = appEl.classList.contains('calc-mode') ? 48 : 0;   // Platz für das linke Zeilen-Lineal
  const avail = ($('#canvas').clientWidth || 800) - 56 - extra;
  const fit = Math.max(.2, avail / (pageWidthMm() * MM));
  let z = (zoomMode === 'auto') ? Math.min(1, fit) : zoomMode;
  z = Math.max(.2, Math.min(2.5, z));
  page.style.zoom = z;
  $('#zoomVal').innerHTML = Math.round(z * 100) + '&nbsp;%';
  $('#zoomVal').classList.toggle('on', zoomMode === 'auto');
  drawRuler();
  drawVRuler();
  if (appEl.classList.contains('calc-mode')) buildCalcRulers();
}
function setZoom(v) { zoomMode = v; applyZoom(); }
function zoomStep(d) {
  const cur = (zoomMode === 'auto') ? (parseFloat(page.style.zoom) || 1) : zoomMode;
  setZoom(Math.max(.3, Math.min(2.5, Math.round((cur + d) * 100) / 100)));
}
function setOrientation(o) {
  if (!doc) return;
  doc.einstellungen.ausrichtung = o;
  page.classList.toggle('quer', o === 'quer');
  $('#btnPortrait').classList.toggle('on', o !== 'quer');
  $('#btnLandscape').classList.toggle('on', o === 'quer');
  applyFormat(); scheduleSave(); applyZoom(); updatePages();
}
function updatePages() {
  if (isSlides()) { $('#guides').innerHTML = ''; return 1; }   // Folien: keine Mehrseiten-Hilfslinien
  const ph = pageHeightPx();
  const n = Math.max(1, Math.ceil((page.offsetHeight - 4) / ph));
  const g = $('#guides'); g.innerHTML = '';
  for (let k = 1; k < n; k++) {
    const line = document.createElement('div'); line.className = 'guide'; line.style.top = (k * ph) + 'px';
    const s = document.createElement('span'); s.textContent = 'Seite ' + (k + 1); line.appendChild(s); g.appendChild(line);
  }
  return n;
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
  if (spellTarget) {
    const w = spellTarget.textContent;
    h += `<div class="lbl">Rechtschreibung</div>`;
    h += `<button data-ctx="dict-add">„${esc(w)}" zum Wörterbuch hinzufügen</button>`;
    h += `<button data-ctx="dict-corr">Autokorrektur für „${esc(w)}" …</button>`;
    h += '<div class="sep"></div>';
  }
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
function previewCalc() {
  if (!curGrid) curGrid = htmlToGrid(activePage().html);
  let maxR = -1, maxC = -1;
  curGrid.zeilen.forEach((z, r) => z.cells.forEach((c, ci) => { if (cellText(c) !== '') { if (r > maxR) maxR = r; if (ci > maxC) maxC = ci; } }));
  if (maxR < 0) { maxR = 0; maxC = 0; }
  const quer = doc.einstellungen.ausrichtung === 'quer';
  let tbl = '<table class="pv-grid">';
  for (let r = 0; r <= maxR; r++) {
    tbl += '<tr>';
    for (let c = 0; c <= maxC; c++) { const v = evalCell(c, r); tbl += `<td${typeof v === 'number' ? ' class="num"' : ''}>${esc(String(v))}</td>`; }
    tbl += '</tr>';
  }
  tbl += '</table>';
  const scroll = $('#previewScroll');
  $('#previewOverlay').hidden = false;
  scroll.innerHTML = `<div class="pv-page${quer ? ' quer' : ''}"><div class="pv-h">${$('#zoneH').innerHTML}</div><div class="pv-c">${tbl}</div><div class="pv-f"><span>${$('#zoneF').innerHTML}</span><span class="pv-num">Seite 1</span></div></div>`;
  $('#pvInfo').textContent = 'Tabelle · ' + (maxR + 1) + ' × ' + (maxC + 1) + (quer ? ' · Querformat' : ' · Hochformat');
  scroll.scrollTop = 0;
}
function printPreview() {
  if (!doc) return;
  captureDoc();
  if (isSlides()) { previewSlides(); return; }
  if (activePage().typ === 'calc') { previewCalc(); return; }
  const quer = doc.einstellungen.ausrichtung === 'quer';
  const ov = $('#previewOverlay'), scroll = $('#previewScroll');
  scroll.innerHTML = ''; ov.hidden = false;          // erst sichtbar → dann messbar
  const headHTML = $('#zoneH').innerHTML, footHTML = $('#zoneF').innerHTML;
  const pageHpx = (quer ? 210 : 297) * MM;
  const newPage = () => {
    const p = document.createElement('div'); p.className = 'pv-page' + (quer ? ' quer' : '');
    p.innerHTML = `<div class="pv-h">${headHTML}</div><div class="pv-c"></div><div class="pv-f"><span>${footHTML}</span><span class="pv-num"></span></div>`;
    scroll.appendChild(p); return p;
  };
  let p = newPage(), c = p.querySelector('.pv-c'); const pages = [p];
  const budget = () => pageHpx - p.querySelector('.pv-h').offsetHeight - p.querySelector('.pv-f').offsetHeight - 8;
  [...editor.children].forEach(node => {
    const clone = node.cloneNode(true); c.appendChild(clone);
    if (c.scrollHeight > budget() && c.children.length > 1) {
      c.removeChild(clone);
      p = newPage(); pages.push(p); c = p.querySelector('.pv-c'); c.appendChild(clone);
    }
  });
  pages.forEach((pg, i) => pg.querySelector('.pv-num').textContent = 'Seite ' + (i + 1) + ' / ' + pages.length);
  $('#pvInfo').textContent = pages.length + (pages.length === 1 ? ' Seite' : ' Seiten') + ' · ' + (quer ? 'Querformat' : 'Hochformat');
  scroll.scrollTop = 0;
}

/* ============================================================
   Submit Slides — Präsentieren, Deck-Druck, Folien-Vorschau
   ============================================================ */
function slidePages() { return doc ? doc.seiten.filter(p => p.typ === 'slides') : []; }
function slideHtml(p) { return sanitizeHtml(p.html || '') || '<p class="slide-empty">Leere Folie</p>'; }

// Vollbild-Präsentation aller Folien des Dokuments
let presIdx = 0, presList = [];
function presentStart() {
  if (!doc) return;
  capturePage();
  presList = slidePages();
  if (!presList.length) { toast('Keine Folien vorhanden. Wechsle oben links auf „Submit Slides".'); return; }
  presIdx = Math.max(0, slidePages().indexOf(activePage()));
  if (presIdx < 0) presIdx = 0;
  $('#presentOverlay').hidden = false;
  presRender();
  const ov = $('#presentOverlay');
  if (ov.requestFullscreen) ov.requestFullscreen().catch(() => {});
}
function presRender() {
  const p = presList[presIdx]; if (!p) return;
  $('#presentSlide').innerHTML = slideHtml(p);
  $('#presNum').textContent = (presIdx + 1) + ' / ' + presList.length;
  const pn = $('#presNotes');
  pn.textContent = p.notiz || '';
  if (!(p.notiz || '').trim() && !pn.hidden) pn.dataset.empty = '1'; else delete pn.dataset.empty;
}
function presToggleNotes() { const pn = $('#presNotes'); pn.hidden = !pn.hidden; presRender(); }
function presGo(d) { presIdx = Math.max(0, Math.min(presList.length - 1, presIdx + d)); presRender(); }
function presentEnd() {
  $('#presentOverlay').hidden = true;
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}

// Ganzes Foliendeck als PDF drucken: eine Querformat-Seite pro Folie
function printDeck() {
  if (!doc) return;
  capturePage();
  const slides = slidePages();
  if (!slides.length) { toast('Keine Folien zum Drucken.'); return; }
  $('#deckPrint').innerHTML = slides.map(p => `<section class="deck-slide">${slideHtml(p)}</section>`).join('');
  const st = document.createElement('style');
  st.id = 'deckPageStyle'; st.textContent = '@page{size:A4 landscape;margin:0}';
  document.head.appendChild(st);
  document.body.classList.add('printing-deck');
  let done = false;
  const cleanup = () => { if (done) return; done = true; document.body.classList.remove('printing-deck'); st.remove(); window.removeEventListener('afterprint', cleanup); };
  window.addEventListener('afterprint', cleanup);
  setTimeout(() => window.print(), 60);
  setTimeout(cleanup, 60000);   // Sicherheitsnetz, falls afterprint nicht feuert
}

// Folien-Druckvorschau (alle Folien als 16:9-Blätter)
function previewSlides() {
  const slides = slidePages();
  if (!slides.length) { toast('Keine Folien vorhanden.'); return; }
  const scroll = $('#previewScroll');
  $('#previewOverlay').hidden = false;
  scroll.innerHTML = slides.map((p, i) =>
    `<div class="pv-page pv-slide"><div class="pv-slide-c">${slideHtml(p)}</div><span class="pv-num">Folie ${i + 1} / ${slides.length}</span></div>`
  ).join('');
  $('#pvInfo').textContent = slides.length + (slides.length === 1 ? ' Folie' : ' Folien') + ' · 16:9';
  scroll.scrollTop = 0;
}

/* ============================================================
   Modus-Umschalter + Submit Calc (Raster & Formeln)
   ============================================================ */
const MODE_META = { write: ['✍', 'Submit Write'], calc: ['▦', 'Submit Calc'], slides: ['▭', 'Submit Slides'] };
function pageMode(p) { return p.typ === 'calc' ? 'calc' : (p.typ === 'slides' ? 'slides' : 'write'); }
function renderActivePage() {
  if (!doc) return;
  const p = activePage(), m = pageMode(p);
  document.body.dataset.mode = m;
  const meta = MODE_META[m]; $('#modeIco').textContent = meta[0]; $('#modeName').textContent = meta[1];
  const calc = (m === 'calc');
  appEl.classList.toggle('calc-mode', calc);
  appEl.classList.toggle('slides-mode', m === 'slides');
  if (calc) { $('#findbar').hidden = true; curGrid = htmlToGrid(p.html || ''); selC = 0; selR = 0; applyFormat(); renderCalc(); selectCell(0, 0); applyZoom(); }
  else { curGrid = null; editor.innerHTML = sanitizeHtml(p.html || ''); $$('.colsep', editor).forEach(s => s.contentEditable = 'false'); $$('.toc', editor).forEach(t => t.contentEditable = 'false'); applyFormat(); applyZoom(); refreshAll(); spellLater(); }
  if (m === 'slides') { const ni = $('#slideNotesInput'); if (ni) ni.value = p.notiz || ''; }
}
// Typ der AKTIVEN Seite wechseln (Modus-Pille)
function setPageType(typ) {
  if (!doc) return;
  const p = activePage(); if (p.typ === typ) return;
  capturePage();
  p.typ = (typ === 'calc' || typ === 'slides') ? typ : 'write';
  if (p.html == null) p.html = '';
  if (typ === 'slides' && !cellTextHas(p.html)) p.html = SLIDE_STARTER;   // leere Seite → Start-Folie
  renderActivePage(); renderPageNav(); scheduleSave();
}
function cellTextHas(html) { const d = document.createElement('div'); d.innerHTML = html || ''; return !!(d.textContent || '').trim() || /<(img|table|hr)/i.test(html || ''); }
const SLIDE_STARTER = '<h1>Titel der Folie</h1><p>Klicke und schreibe deinen Inhalt …</p>';
function switchPage(i) {
  if (i === doc.aktiv || i < 0 || i >= doc.seiten.length) return;
  capturePage(); doc.aktiv = i; renderActivePage(); renderPageNav(); scheduleSave();
}
function addPage(typ) {
  capturePage();
  const t = (typ === 'calc' || typ === 'slides') ? typ : 'write';
  const p = { id: uid(), typ: t, html: t === 'slides' ? SLIDE_STARTER : '' };
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
  h += `<div class="menu-wrap"><button class="ptadd" id="ptAdd" title="Seite hinzufügen">＋ Seite</button><div class="menu" id="addMenu" hidden><button data-add="write"><span class="mi">✍</span> Write-Seite</button><button data-add="calc"><span class="mi">▦</span> Calc-Seite</button><button data-add="slides"><span class="mi">▭</span> Slides-Seite</button></div></div>`;
  bar.innerHTML = h;
}
function colToIdx(s) { let n = 0; for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; }
function idxToCol(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }
let selC = 0, selR = 0;   // 0-basiert (Spalte, Zeile)
const DISP_MIN_COLS = 6, DISP_MIN_ROWS = 20;
function cellKey(c, r) { return idxToCol(c) + (r + 1); }

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
  const m = /^([A-Z]+)(\d+)$/.exec(ref.toUpperCase()); if (!m) return 0;
  const c = colToIdx(m[1]), r = +m[2] - 1, key = c + ',' + r;
  if (seen.has(key)) throw 'circ';
  const ns = new Set(seen); ns.add(key);
  return evalRaw(gridCellRaw(c, r), ns);
}
function rangeVals(a, b, seen) {
  const m1 = /^([A-Z]+)(\d+)$/.exec(a.toUpperCase()), m2 = /^([A-Z]+)(\d+)$/.exec(b.toUpperCase());
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
      default: return '#NAME';
    }
  }
  function parseArgs() {
    const args = []; ws(); if (src[i] === ')') return args;
    for (; ;) {
      ws();
      const rm = /^([A-Za-z]+\d+):([A-Za-z]+\d+)/.exec(src.slice(i));
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
    m = /^[A-Za-z]+\d*/.exec(src.slice(i));
    if (m) {
      const id = m[0].toUpperCase(); i += m[0].length; ws();
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
function tdAt(c, r) { const t = gEl(); if (!t) return null; return t.querySelector(`td[data-c="${c}"][data-r="${r}"]`) || t.querySelector(`td[data-r="${r}"]`); }
function allTd(sel) { const t = gEl(); return t ? [...t.querySelectorAll(sel)] : []; }
function calcExtent() {   // Struktur: max. Spalten über alle Zeilen, Zeilen
  const z = curGrid.zeilen;
  return { cols: Math.max(1, ...z.map(x => x.cells.length)), rows: z.length };
}
let gridCols = 1, gridRows = 1;
function renderCalc() { renderSheet(); highlightSel(); updateStats(); updatePages(); }
// Zahlenformate je Zelle + Spaltenbreiten (am Seiten-Objekt gespeichert, übersteht Speichern/Öffnen)
function curFmt() { const p = activePage(); if (!p.fmt || typeof p.fmt !== 'object') p.fmt = {}; return p.fmt; }
function curColW() { const p = activePage(); if (!p.colW || typeof p.colW !== 'object') p.colW = {}; return p.colW; }
function fmtNum(n, f) {
  if (!isFinite(n)) return String(n);
  if (f === 'pct') return (n * 100).toLocaleString('de-CH', { maximumFractionDigits: 2 }) + ' %';
  if (f === 'chf') return 'CHF ' + n.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (f === 'num2') return n.toLocaleString('de-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (f === 'num0') return Math.round(n).toLocaleString('de-CH');
  return n.toLocaleString('de-CH');
}
function isNumericText(t) { return t !== '' && /\d/.test(t) && /^-?[\d'’.,\s]+%?$/.test(t); }
// liefert {html, cls} für eine Zelle – berücksichtigt Formel-Ergebnis und Zahlenformat
function cellDisplay(c, r) {
  const raw = gridGet(curGrid, c, r), txt = cellText(raw), isF = txt.startsWith('=');
  const f = curFmt()[c + ',' + r];
  if (isF) {
    const v = evalCell(c, r);
    if (typeof v === 'number') return { html: esc(f ? fmtNum(v, f) : String(v)), cls: 'num' };
    if (/^#/.test(String(v))) return { html: esc(String(v)), cls: 'err' };
    return { html: esc(String(v)), cls: '' };
  }
  if (f && isNumericText(txt)) return { html: esc(fmtNum(toNum(txt), f)), cls: 'num' };
  return { html: raw || '', cls: isNumericText(txt) ? 'num' : '' };
}
function setCellFormat(f) {
  if (!curGrid) return;
  const fm = curFmt(), { c1, c2, r1, r2 } = rangeBounds();
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) { const k = c + ',' + r; if (f === 'none') delete fm[k]; else fm[k] = f; }
  renderCalc(); scheduleSave();
}
// Gitter ins SELBE Blatt wie Write rendern: Ränder, Zoom, Kopf/Fuss, Lineal kommen vom .page
function renderSheet() {
  const host = $('#pageGrid'); if (!host || !curGrid) return;
  const ur = calcUsedRange(), ext = calcExtent(), d = pageDims(), m = pageSetup().margins;
  const contentMm = Math.max(60, d.w - m.left - m.right);
  const colsPP = Math.max(4, Math.floor(contentMm / 26));   // Spaltenzahl, die bequem auf die Blattbreite passt
  const cols = Math.max(ext.cols, colsPP);
  const rows = Math.max(ext.rows, 30);                       // genug Leerzeilen, damit es wie ein Blatt wirkt
  gridCols = cols; gridRows = rows;
  const cw = curColW();
  let cg = '<colgroup>';   // keine Kopf-Spalte mehr – A/B/C & 1/2/3 liegen als Lineale AUSSERHALB des Blatts
  for (let c = 0; c < cols; c++) cg += cw[c] ? `<col style="width:${cw[c]}px">` : '<col>';
  cg += '</colgroup>';
  let body = '<tbody>';
  for (let r = 0; r < rows; r++) {
    const z = curGrid.zeilen[r];
    // „Textzeile" (volle Blattbreite wie Write) nur bei Überschrift oder echtem Fliesstext – nicht bei leeren/kurzen Zellen
    const only = (z && z.cells.length === 1) ? cellText(z.cells[0]) : '';
    const isHead = !!(z && /^h[1-3]$/.test(z.tag || ''));
    const textRow = !!(z && z.cells.length === 1 && (isHead || (only && /\s/.test(only)) || only.length > 24));
    body += `<tr${r > ur.maxR ? ' class="pad"' : ''}>`;
    if (textRow) {
      const dsp = cellDisplay(0, r), cl = ['textcell'];
      if (isHead) cl.push(z.tag);
      if (dsp.cls === 'err') cl.push('err');
      if (r > ur.maxR) cl.push('pad');
      body += `<td data-c="0" data-r="${r}" colspan="${cols}" class="${cl.join(' ')}">${dsp.html}</td>`;
    } else {
      for (let c = 0; c < cols; c++) {
        const dsp = cellDisplay(c, r), cl = [];
        if (dsp.cls) cl.push(dsp.cls);
        if (c > ur.maxC || r > ur.maxR) cl.push('pad');
        body += `<td data-c="${c}" data-r="${r}"${cl.length ? ` class="${cl.join(' ')}"` : ''}>${dsp.html}</td>`;
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
    ch += `<div class="cr-seg" data-c="${c}" style="left:${(r.left - cr.left + sl)}px;width:${r.width}px">${idxToCol(c)}<span class="cresize" data-c="${c}" title="Spaltenbreite ziehen"></span></div>`;
  }
  colR.innerHTML = ch;
  colR.style.top = st + 'px';                       // bleibt am sichtbaren oberen Rand
  // Senkrechtes Lineal (1 2 3 …) – links neben dem Blatt, an Zeilen ausgerichtet
  let rh = '';
  for (let r = 0; r < gridRows; r++) {
    const cell = t.querySelector(`td[data-r="${r}"]`); if (!cell) continue;
    const rc = cell.getBoundingClientRect();
    rh += `<div class="rr-seg" data-r="${r}" style="top:${(rc.top - cr.top + st)}px;height:${rc.height}px">${r + 1}</div>`;
  }
  rowR.innerHTML = rh;
  rowR.style.left = Math.max(0, pr.left - cr.left + sl - rowR.offsetWidth) + 'px';
  updateRulerSel();
}
function updateRulerSel() {
  const { c1, c2, r1, r2 } = rangeBounds();
  $$('#colRuler .cr-seg').forEach(e => e.classList.toggle('on', +e.dataset.c >= c1 && +e.dataset.c <= c2));
  $$('#rowRuler .rr-seg').forEach(e => e.classList.toggle('on', +e.dataset.r >= r1 && +e.dataset.r <= r2));
}
let anchorC = 0, anchorR = 0, editingTd = null;
function rangeBounds() { return { c1: Math.min(anchorC, selC), c2: Math.max(anchorC, selC), r1: Math.min(anchorR, selR), r2: Math.max(anchorR, selR) }; }
function roundN(x) { return Math.round(x * 100) / 100; }
function highlightSel() {
  allTd('td.sel, td.active').forEach(td => td.classList.remove('sel', 'active'));
  const { c1, c2, r1, r2 } = rangeBounds();
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) { const td = tdAt(c, r); if (td) td.classList.add('sel'); }
  const act = tdAt(selC, selR);
  if (act) { act.classList.add('active'); $('#cellRef').textContent = cellKey(selC, selR); $('#formulaInput').value = gridCellRaw(selC, selR); }
  updateRulerSel();   // aktive Spalte/Zeile in den Lineal-Leisten hervorheben
  updateCalcStat();
}
function updateCalcStat() {
  const el = $('#calcStat'); if (!el) return;
  const { c1, c2, r1, r2 } = rangeBounds();
  if (c1 === c2 && r1 === r2) { el.textContent = ''; return; }
  const nums = []; let count = 0;
  for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) { const v = evalCell(c, r); if (v !== '' && v != null) count++; if (typeof v === 'number') nums.push(v); }
  const sum = nums.reduce((a, b) => a + b, 0);
  el.textContent = nums.length ? `Summe ${roundN(sum)}  ·  Mittel ${roundN(sum / nums.length)}  ·  Anzahl ${count}` : `Anzahl ${count}`;
}
function selectCell(c, r, extend) {
  selR = Math.max(0, Math.min(gridRows - 1, r));
  selC = Math.max(0, Math.min(gridCols - 1, c));
  const z = curGrid.zeilen[selR];
  if (z && z.cells.length === 1) selC = 0;     // Textzeile hat nur eine (volle) Zelle
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
function readCellHtml(td) {
  let h = '';
  td.childNodes.forEach(n => {
    if (n.nodeType === 3) h += esc(n.nodeValue.replace(/​/g, ''));
    else if (n.tagName === 'BR') h += '<br>';
    else if (n.tagName === 'DIV' || n.tagName === 'P') { if (h && !/<br>$/.test(h)) h += '<br>'; h += esc(n.textContent); }
    else h += esc(n.textContent);
  });
  return h.replace(/(<br>)+$/,'');
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
function calcAddRow() { if (editingTd) endEdit(true); gridEnsure(curGrid, 0, curGrid.zeilen.length); activePage().html = gridToHtml(curGrid); renderCalc(); scheduleSave(); }
function calcAddCol() { if (editingTd) endEdit(true); curGrid.cols = (curGrid.cols || 1) + 1; gridEnsure(curGrid, curGrid.cols - 1, 0); activePage().html = gridToHtml(curGrid); renderCalc(); scheduleSave(); }

/* ---- Inline-Zellbearbeitung (direkt in der Zelle) ---- */
function beginEdit(initial) {
  const td = tdAt(selC, selR); if (!td) return;
  editingTd = td;
  td.classList.add('celledit'); td.contentEditable = 'true';
  if (initial != null) td.textContent = initial;             // direkt lostippen ersetzt den Inhalt
  else td.innerHTML = gridGet(curGrid, selC, selR) || '';    // vorhandenen Inhalt (inkl. Zeilenumbrüche) bearbeiten
  td.focus();
  const rng = document.createRange(); rng.selectNodeContents(td); rng.collapse(false);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(rng);
}
function endEdit(commit) {
  if (!editingTd) return;
  const td = editingTd; editingTd = null;
  const html = readCellHtml(td);
  td.contentEditable = 'false'; td.classList.remove('celledit');
  if (commit) commitCellHtml(html); else renderCalc();
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
function cleanEditorHTML() { const c = editor.cloneNode(true); c.querySelectorAll('.sp-err').forEach(s => s.replaceWith(document.createTextNode(s.textContent))); return c.innerHTML; }
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
  if (e && e.inputType === 'insertText' && /[\s.,;:!?]/.test(e.data || '')) applyAutocorrect();
  afterEdit();
}

/* ============================================================
   Submit PDF — Export & Import (PDF → Write / Calc / Slides)
   ============================================================ */
let _pdfjs = null, pdfTarget = 'write';
function loadPdfJs() {
  if (_pdfjs) return Promise.resolve(_pdfjs);
  const ready = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; _pdfjs = window.pdfjsLib; return _pdfjs; };
  if (window.pdfjsLib) return Promise.resolve(ready());
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    s.onload = () => window.pdfjsLib ? res(ready()) : rej(new Error('pdfjs'));
    s.onerror = () => rej(new Error('offline'));
    document.head.appendChild(s);
  });
}
// Textzeilen einer PDF-Seite rekonstruieren (nach Y gruppieren, nach X sortieren)
function pdfPageLines(tc) {
  const rows = new Map();
  tc.items.forEach(it => { if (!it.str || !it.str.trim()) return; const y = Math.round(it.transform[5]); if (!rows.has(y)) rows.set(y, []); rows.get(y).push({ x: it.transform[4], s: it.str }); });
  return [...rows.keys()].sort((a, b) => b - a)
    .map(y => rows.get(y).sort((a, b) => a.x - b.x).map(o => o.s).join('').replace(/\s+/g, ' ').trim())
    .filter(l => l.length);
}
async function importPdf(file) {
  const status = $('#pdfStatus'); if (!file) return;
  status.textContent = 'Lade PDF-Engine …';
  let pdfjs; try { pdfjs = await loadPdfJs(); } catch (_) { status.textContent = 'PDF-Engine konnte nicht geladen werden (Internet nötig).'; return; }
  status.textContent = 'Lese PDF …';
  let pdf; try { const buf = await file.arrayBuffer(); pdf = await pdfjs.getDocument({ data: buf }).promise; } catch (_) { status.textContent = 'PDF konnte nicht gelesen werden.'; return; }
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) { status.textContent = 'Seite ' + i + ' / ' + pdf.numPages + ' …'; const pg = await pdf.getPage(i); pages.push(pdfPageLines(await pg.getTextContent())); }
  buildDocFromPdf((file.name || 'PDF').replace(/\.pdf$/i, ''), pages, pdfTarget);
  $('#pdfOverlay').hidden = true;
}
function buildDocFromPdf(titel, pages, target) {
  let seiten;
  if (target === 'slides') {
    seiten = pages.map(lines => ({ id: uid(), typ: 'slides', html: (lines.map((l, i) => i === 0 ? `<h1>${esc(l)}</h1>` : `<p>${esc(l)}</p>`).join('') || SLIDE_STARTER), fmt: {}, colW: {}, notiz: '' }));
  } else if (target === 'calc') {
    seiten = pages.map(lines => ({ id: uid(), typ: 'calc', html: (lines.map(l => '<p>' + l.split(/ {2,}|\t/).map(c => esc(c)).join(COLSEP) + '</p>').join('') || '<p><br></p>'), fmt: {}, colW: {}, notiz: '' }));
  } else {
    seiten = pages.map(lines => ({ id: uid(), typ: 'write', html: (lines.map(l => `<p>${esc(l)}</p>`).join('') || '<p><br></p>'), fmt: {}, colW: {}, notiz: '' }));
  }
  if (!seiten.length) seiten = [{ id: uid(), typ: target === 'calc' ? 'calc' : target === 'slides' ? 'slides' : 'write', html: '<p><br></p>' }];
  const d = newDocObject({ titel: titel || 'Importiertes PDF' });
  d.seiten = seiten; d.aktiv = 0;
  lib.docs[d.id] = d; lib.order.unshift(d.id);
  if (!persistLib()) warnQuota();
  openDoc(d.id);
  toast('PDF importiert: ' + d.titel + ' (' + seiten.length + (seiten.length === 1 ? ' Seite)' : ' Seiten)'));
}

/* ============================================================
   Start
   ============================================================ */
function init() {
  $('#verTag').textContent = WRITE_VERSION;
  editor.spellcheck = false;   // eigene Rechtschreibprüfung statt der Browser-Unterringelung
  setTheme(localStorage.getItem(LS_THEME) || 'light');
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (_) {}
  try { document.execCommand('styleWithCSS', false, true); } catch (_) {}
  wire(); initLaunch();
  // letztes oder neues Dokument
  if (lib.currentId && lib.docs[lib.currentId]) openDoc(lib.currentId);
  else if (lib.order.length && lib.docs[lib.order[0]]) openDoc(lib.order[0]);
  else createDoc();
  renderList();
}
init();
