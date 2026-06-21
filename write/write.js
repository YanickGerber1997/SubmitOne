/* ============================================================
   Submit Write — write.js  (Vanilla, dateibasiert, .gdoc)
   "Schreiben ohne Ablenkung."
   ============================================================ */
'use strict';
const WRITE_VERSION = 'v8';
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
const ALLOWED_ATTR = { '*': ['style'], A: ['href', 'target', 'rel'], IMG: ['src', 'alt', 'width', 'height'], FONT: ['face', 'color', 'size'], TD: ['colspan', 'rowspan'], TH: ['colspan', 'rowspan'] };
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
  toast('Lokaler Speicher voll — bitte als .gdoc speichern (Strg+S). Tipp: grosse Bilder vermeiden.');
  setTimeout(() => { quotaWarned = false; }, 30000);
}

function newDocObject(partial = {}) {
  const t = nowIso();
  return Object.assign({
    id: uid(), titel: 'Unbenanntes Dokument', kopf: '', fuss: '',
    seiten: [{ id: uid(), typ: 'write', html: '' }], aktiv: 0,
    einstellungen: { schriftart: "'Inter', sans-serif", schriftgroesse: 16, zeilenabstand: 1.7, ausrichtung: 'hoch', margins: { top: 18, right: 22, bottom: 18, left: 22 }, kopfH: 14, fussH: 14, tabs: [] },
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
    const p = { id: uid(), typ };
    if (typ === 'calc') p.tabelle = d.tabelle || { cols: 8, rows: 20, cells: {} };
    else p.html = d.html || '';
    d.seiten = [p]; d.aktiv = 0;
  }
  if (typeof d.aktiv !== 'number' || d.aktiv < 0 || d.aktiv >= d.seiten.length) d.aktiv = 0;
  d.seiten.forEach(p => {
    if (!p.id) p.id = uid();
    if (p.typ === 'calc') { if (!p.tabelle || !p.tabelle.cells) p.tabelle = { cols: 8, rows: 20, cells: {} }; }
    else { p.typ = (p.typ === 'slides') ? 'slides' : 'write'; if (p.html == null) p.html = ''; }
  });
  if (d.einstellungen) delete d.einstellungen.modus;
  delete d.html; delete d.tabelle;
  return d;
}
function activePage() { return doc.seiten[doc.aktiv]; }
function curTab() { const p = activePage(); if (!p.tabelle || !p.tabelle.cells) p.tabelle = { cols: 8, rows: 20, cells: {} }; return p.tabelle; }

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
  const o = s.ausrichtung || 'hoch';
  page.classList.toggle('quer', o === 'quer');
  $('#btnPortrait').classList.toggle('on', o !== 'quer');
  $('#btnLandscape').classList.toggle('on', o === 'quer');
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
  if (p.typ === 'write') p.html = editor.innerHTML;   // calc-Daten werden live in p.tabelle mutiert
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
    format: 'gdoc', formatVersion: FORMAT_VERSION, typ: 'dokument',
    app: 'Submit Gdoc ' + WRITE_VERSION, exportiert: nowIso(),
    meta: { ...doc.meta, titel: doc.titel },
    inhalt: { kopf: doc.kopf || '', fuss: doc.fuss || '', seiten: doc.seiten },
    einstellungen: { ...doc.einstellungen }
  };
}
function safeName(s) { return (s || 'Dokument').replace(/[^\wäöüÄÖÜ\- ]+/g, '').trim().replace(/\s+/g, '_') || 'Dokument'; }

async function saveFile(asNew) {
  const data = buildGdoc();
  const fname = safeName(doc.titel) + '.gdoc';
  const json = JSON.stringify(data, null, 2);
  // 1) File System Access API
  if (window.showSaveFilePicker) {
    try {
      if (!fileHandle || asNew) {
        fileHandle = await window.showSaveFilePicker({
          suggestedName: fname,
          types: [{ description: 'Submit Write Dokument', accept: { 'application/json': ['.gdoc'] } }]
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
        types: [{ description: 'Submit Write / JSON', accept: { 'application/json': ['.gdoc', '.json'] } }]
      });
      handle = h; text = await (await h.getFile()).text();
    } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  if (text === null) {
    text = await new Promise(res => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.gdoc,.json';
      inp.onchange = () => { const f = inp.files[0]; if (!f) return res(null); const r = new FileReader(); r.onload = () => res(r.result); r.readAsText(f); };
      inp.click();
    });
  }
  if (!text) return;
  ingestGdoc(text, handle);
}

function ingestGdoc(text, handle) {
  let data; try { data = JSON.parse(text); } catch (_) { toast('Datei nicht lesbar'); return; }
  if (!data || data.format !== 'gdoc' || !data.inhalt) { toast('Keine .gdoc-Datei'); return; }
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
    d.seiten = data.inhalt.seiten.map(p => (p && p.typ === 'calc')
      ? { id: uid(), typ: 'calc', tabelle: (p.tabelle && p.tabelle.cells) ? { cols: +p.tabelle.cols || 8, rows: +p.tabelle.rows || 20, cells: p.tabelle.cells } : { cols: 8, rows: 20, cells: {} } }
      : { id: uid(), typ: (p && p.typ === 'slides') ? 'slides' : 'write', html: sanitizeHtml((p && p.html) || '') });
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
function afterEdit() { normalizeEmpty(); scheduleSave(); refreshAll(); }

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
  if (kind === 'pdf') { window.print(); return; }
  if (kind === 'html') { download(name + '.html', docHtmlShell(editor.innerHTML), 'text/html'); toast('HTML exportiert'); }
  else if (kind === 'md') { download(name + '.md', htmlToMarkdown(editor), 'text/markdown'); toast('Markdown exportiert'); }
  else if (kind === 'docx') {
    // Beta: Word öffnet HTML mit .doc-Endung zuverlässig
    download(name + '.doc', docHtmlShell(editor.innerHTML), 'application/msword'); toast('DOCX (Beta) exportiert');
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
  editor.addEventListener('input', afterEdit);
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

  // Einfügen (Ribbon-Buttons + „Mehr"-Menü)
  const insMenu = $('#insertMenu');
  $('#btnInsertMore').addEventListener('click', e => { e.stopPropagation(); insMenu.hidden = !insMenu.hidden; });
  $$('[data-ins]').forEach(b => b.addEventListener('click', () => { insMenu.hidden = true; doInsert(b.dataset.ins); }));
  document.addEventListener('click', () => insMenu.hidden = true);

  // Schrift-Stufen + Zeilenabstand
  $('#fontGrow').addEventListener('click', () => adjustFontSize(1));
  $('#fontShrink').addEventListener('click', () => adjustFontSize(-1));
  $('#selLine').addEventListener('change', e => setLineHeight(+e.target.value));

  // Druckvorschau
  $('#btnPreview').addEventListener('click', printPreview);
  $('#pvClose').addEventListener('click', () => $('#previewOverlay').hidden = true);
  $('#pvPrint').addEventListener('click', () => { $('#previewOverlay').hidden = true; setTimeout(() => window.print(), 60); });

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

  // Submit Calc – Raster
  $('#calcAddRow').addEventListener('click', calcAddRow);
  $('#calcAddCol').addEventListener('click', calcAddCol);
  $('#grid').addEventListener('click', e => { const td = e.target.closest('td[data-c]'); if (td) { selectCell(+td.dataset.c, +td.dataset.r); $('#calcScroll').focus(); } });
  $('#grid').addEventListener('dblclick', e => { const td = e.target.closest('td[data-c]'); if (td) { selectCell(+td.dataset.c, +td.dataset.r); $('#formulaInput').focus(); } });
  $('#formulaInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); commitCell(e.target.value); selectCell(selC, selR + 1); $('#calcScroll').focus(); }
    else if (e.key === 'Tab') { e.preventDefault(); commitCell(e.target.value); selectCell(selC + 1, selR); $('#calcScroll').focus(); }
    else if (e.key === 'Escape') { highlightSel(); $('#calcScroll').focus(); }
  });
  $('#calcScroll').addEventListener('keydown', e => {
    if (document.activeElement === $('#formulaInput')) return;
    const k = e.key;
    if (k === 'ArrowDown') { e.preventDefault(); selectCell(selC, selR + 1); }
    else if (k === 'ArrowUp') { e.preventDefault(); selectCell(selC, selR - 1); }
    else if (k === 'ArrowRight' || k === 'Tab') { e.preventDefault(); selectCell(selC + 1, selR); }
    else if (k === 'ArrowLeft') { e.preventDefault(); selectCell(selC - 1, selR); }
    else if (k === 'Enter' || k === 'F2') { e.preventDefault(); $('#formulaInput').focus(); }
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); commitCell(''); }
    else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); $('#formulaInput').value = k; $('#formulaInput').focus(); }
  });

  // Zoom & Ausrichtung
  $('#zoomIn').addEventListener('click', () => zoomStep(.1));
  $('#zoomOut').addEventListener('click', () => zoomStep(-.1));
  $('#zoomVal').addEventListener('click', () => setZoom('auto'));
  $('#btnPortrait').addEventListener('click', () => setOrientation('hoch'));
  $('#btnLandscape').addEventListener('click', () => setOrientation('quer'));
  window.addEventListener('resize', applyZoom);

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
    const f = files.find(f => /\.(gdoc|json)$/i.test(f.name));
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

/* ============================================================
   Ansicht: Zoom (auto-anpassend), Ausrichtung, Seiten-Hilfslinien
   ============================================================ */
let zoomMode = 'auto';   // 'auto' = an Fensterbreite anpassen, sonst feste Zahl
function pageWidthMm() { return (doc && doc.einstellungen.ausrichtung === 'quer') ? 297 : 210; }
function pageHeightPx() { return ((doc && doc.einstellungen.ausrichtung === 'quer') ? 210 : 297) * MM; }
function applyZoom() {
  const avail = ($('#canvas').clientWidth || 800) - 56;
  const fit = Math.max(.2, avail / (pageWidthMm() * MM));
  let z = (zoomMode === 'auto') ? Math.min(1, fit) : zoomMode;
  z = Math.max(.2, Math.min(2.5, z));
  page.style.zoom = z;
  $('#zoomVal').innerHTML = Math.round(z * 100) + '&nbsp;%';
  $('#zoomVal').classList.toggle('on', zoomMode === 'auto');
  drawRuler();
  drawVRuler();
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
  scheduleSave(); applyZoom(); updatePages();
}
function updatePages() {
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
  if (appEl.classList.contains('focus') || appEl.classList.contains('calc-mode')) { wrap.style.display = 'none'; return; }
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
function insertTab() {
  const sel = document.getSelection();
  if (!sel || !sel.rangeCount) { document.execCommand('insertHTML', false, '<span class="tabspace" style="display:inline-block;width:48px"></span>​'); afterEdit(); return; }
  const rng = sel.getRangeAt(0), rect = rng.getClientRects()[0] || rng.getBoundingClientRect();
  const z = parseFloat(page.style.zoom) || 1;
  const caretX = (rect.left - editor.getBoundingClientRect().left) / z;
  const stops = (doc.einstellungen.tabs || []).map(mm => (mm - doc.einstellungen.margins.left) * MM).sort((a, b) => a - b);
  const target = stops.find(s => s > caretX + 2);
  const w = Math.max(8, Math.round(target != null ? target - caretX : 48));
  document.execCommand('insertHTML', false, `<span class="tabspace" style="display:inline-block;width:${w}px"></span>​`);
  afterEdit();
}

/* ============================================================
   Einfügen-Menü + Inhaltsverzeichnis
   ============================================================ */
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
  editor.focus();
  document.execCommand('insertHTML', false, '<div class="toc" contenteditable="false" data-toc="1"></div><p><br></p>');
  refreshTOC(); afterEdit();
}
function refreshTOC() {
  const tocs = $$('.toc[data-toc]', editor); if (!tocs.length) return;
  const heads = $$('h1,h2,h3', editor).filter(h => h.innerText.trim());
  let html = '<div class="toc-title">Inhaltsverzeichnis</div>';
  if (!heads.length) html += '<div class="toc-empty">Überschriften erscheinen hier automatisch.</div>';
  heads.forEach((h, i) => { h.id = h.id || 'h_' + i; html += `<a class="toc-l${h.tagName[1]}" data-go="${h.id}">${esc(h.innerText.trim())}</a>`; });
  tocs.forEach(t => { if (t.innerHTML !== html) t.innerHTML = html; });
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
function printPreview() {
  if (!doc) return;
  captureDoc();
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
  if (calc) { selC = 0; selR = 1; renderGrid(); selectCell(0, 1); }
  else { editor.innerHTML = sanitizeHtml(p.html || ''); applyZoom(); refreshAll(); }
}
// Typ der AKTIVEN Seite wechseln (Modus-Pille)
function setPageType(typ) {
  if (!doc) return;
  if (typ === 'slides') { toast('Submit Slides folgt als Nächstes 🙂'); return; }
  const p = activePage(); if (p.typ === typ) return;
  capturePage();
  p.typ = typ;
  if (typ === 'calc' && (!p.tabelle || !p.tabelle.cells)) p.tabelle = { cols: 8, rows: 20, cells: {} };
  if (typ === 'write' && p.html == null) p.html = '';
  renderActivePage(); renderPageNav(); scheduleSave();
}
function switchPage(i) {
  if (i === doc.aktiv || i < 0 || i >= doc.seiten.length) return;
  capturePage(); doc.aktiv = i; renderActivePage(); renderPageNav(); scheduleSave();
}
function addPage(typ) {
  if (typ === 'slides') { toast('Submit Slides folgt als Nächstes 🙂'); return; }
  capturePage();
  const p = { id: uid(), typ: typ === 'calc' ? 'calc' : 'write' };
  if (p.typ === 'calc') p.tabelle = { cols: 8, rows: 20, cells: {} }; else p.html = '';
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
let selC = 0, selR = 1;
function cellKey(c, r) { return idxToCol(c) + r; }

/* ---- Formel-Auswertung (=SUMME(A1:A5), =A1*B2 …) ---- */
function refValue(ref, seen) {
  if (seen.has(ref)) return '#ZIRKEL';
  const ns = new Set(seen); ns.add(ref);
  return evalRaw(curTab().cells[ref] || '', ns);
}
function expandArgs(args, seen) {
  const out = [];
  args.split(/[;,]/).forEach(part => {
    part = part.trim(); if (!part) return;
    const rng = part.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
    if (rng) {
      const c1 = colToIdx(rng[1]), r1 = +rng[2], c2 = colToIdx(rng[3]), r2 = +rng[4];
      for (let c = Math.min(c1, c2); c <= Math.max(c1, c2); c++)
        for (let r = Math.min(r1, r2); r <= Math.max(r1, r2); r++) { const v = refValue(idxToCol(c) + r, seen); if (typeof v === 'number') out.push(v); }
    } else if (/^[A-Z]+\d+$/.test(part)) { const v = refValue(part, seen); if (typeof v === 'number') out.push(v); }
    else { const n = parseFloat(part.replace(',', '.')); if (!isNaN(n)) out.push(n); }
  });
  return out;
}
function evalRaw(raw, seen) {
  if (raw == null || raw === '') return '';
  const s = String(raw);
  if (s[0] !== '=') { const t = s.trim(); const n = parseFloat(t.replace(',', '.')); return (t !== '' && !isNaN(n) && /^[-+]?[\d.,]+$/.test(t)) ? n : s; }
  try {
    let e = s.slice(1).toUpperCase();
    e = e.replace(/\b(SUMME|SUM|MITTELWERT|AVERAGE|AVG|MIN|MAX|ANZAHL|COUNT|PRODUKT|PRODUCT)\s*\(([^()]*)\)/g, (m, fn, args) => {
      const v = expandArgs(args, seen);
      if (/SUM|SUMME/.test(fn)) return '(' + v.reduce((a, b) => a + b, 0) + ')';
      if (/AVERAGE|AVG|MITTELWERT/.test(fn)) return '(' + (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0) + ')';
      if (fn === 'MIN') return '(' + (v.length ? Math.min(...v) : 0) + ')';
      if (fn === 'MAX') return '(' + (v.length ? Math.max(...v) : 0) + ')';
      if (/COUNT|ANZAHL/.test(fn)) return '(' + v.length + ')';
      return '(' + v.reduce((a, b) => a * b, 1) + ')';
    });
    e = e.replace(/([A-Z]+)(\d+)/g, (m, c, r) => { const v = refValue(c + r, seen); return (typeof v === 'number') ? '(' + v + ')' : '(0)'; });
    e = e.replace(/,/g, '.');
    if (!/^[-+*/(). 0-9eE]+$/.test(e)) return '#FEHLER';
    const val = Function('"use strict";return (' + e + ')')();
    return (typeof val === 'number' && isFinite(val)) ? Math.round(val * 1e10) / 1e10 : '#FEHLER';
  } catch (_) { return '#FEHLER'; }
}

/* ---- Raster + Auswahl ---- */
function renderGrid() {
  const t = curTab(), g = $('#grid');
  let h = '<thead><tr><th class="corner"></th>';
  for (let c = 0; c < t.cols; c++) h += `<th>${idxToCol(c)}</th>`;
  h += '</tr></thead><tbody>';
  for (let r = 1; r <= t.rows; r++) {
    h += `<tr><th class="rownum">${r}</th>`;
    for (let c = 0; c < t.cols; c++) {
      const k = cellKey(c, r), val = evalRaw(t.cells[k] || '', new Set([k]));
      const cls = typeof val === 'number' ? ' class="num"' : (/^#/.test(String(val)) ? ' class="err"' : '');
      h += `<td data-c="${c}" data-r="${r}"${cls}>${esc(String(val))}</td>`;
    }
    h += '</tr>';
  }
  g.innerHTML = h + '</tbody>';
  highlightSel();
}
function highlightSel() {
  $$('#grid td.sel').forEach(td => td.classList.remove('sel'));
  const td = $(`#grid td[data-c="${selC}"][data-r="${selR}"]`);
  if (td) { td.classList.add('sel'); $('#cellRef').textContent = cellKey(selC, selR); $('#formulaInput').value = curTab().cells[cellKey(selC, selR)] || ''; }
}
function selectCell(c, r) {
  const t = curTab();
  selC = Math.max(0, Math.min(t.cols - 1, c));
  selR = Math.max(1, Math.min(t.rows, r));
  highlightSel();
  const td = $(`#grid td[data-c="${selC}"][data-r="${selR}"]`); if (td) td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function commitCell(val) {
  const k = cellKey(selC, selR), t = curTab();
  if (val === '' || val == null) delete t.cells[k]; else t.cells[k] = val;
  renderGrid(); scheduleSave();
}
function calcAddRow() { curTab().rows++; renderGrid(); scheduleSave(); }
function calcAddCol() { curTab().cols++; renderGrid(); scheduleSave(); }

/* ---- Vertikales Lineal: Kopf-/Fuss-Höhe ziehen ---- */
function drawVRuler() {
  if (!doc) return; const v = $('#vruler');
  if (appEl.classList.contains('focus') || appEl.classList.contains('calc-mode')) { v.style.display = 'none'; return; }
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
   Start
   ============================================================ */
function init() {
  $('#verTag').textContent = WRITE_VERSION;
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
