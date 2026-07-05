'use strict';
/* Submit PDF — Phase 2a: Viewer + Annotationen (SVG-Overlay), Drehen 90°, Kommentare, echtes Speichern (pdf-lib). */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const SVGNS = 'http://www.w3.org/2000/svg';
const COARSE = matchMedia('(pointer:coarse)').matches;   // Touch-Gerät → grössere Anfasser
const PV = '3.11.174';
const CDN = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PV}/build`;
const PDFLIB = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';

let pdfjs = null, pdfDoc = null, curBytes = null, docName = 'dokument.pdf';
let docs = [], active = -1;   // mehrere offene Dokumente (Tabs); active = Index des sichtbaren
let zoom = 'auto', pageViews = [], renderTok = 0;
let _editingId = null;   // gerade inline getippte Edit-Stelle (transient, nicht gespeichert) → deren Text nicht doppelt zeichnen
let annos = {};            // {pageNum: [anno]}
let pageRot = {};          // {pageNum: 0/90/180/270} – gespeicherte 90°-Drehung
let viewRot = {};          // {pageNum: deg} – freie Ansichts-Drehung (Norden), NICHT gespeichert
let formValues = {};       // {feldName: Wert} – ausgefüllte PDF-Formularfelder (gespeichert)
let formFields = {};       // {pageNum: [{name,type,left,top,w,h,...}]} – Geometrie, beim Laden neu erkannt
let fieldTypes = {};       // {feldName: 'text'|'checkbox'|'radio'|'dropdown'}
let formMode = false;      // „Formular ausfüllen"-Modus aktiv?
let tool = 'select';
let viewOnly = false;   // „Ansehen"-Modus: nur betrachten/scrollen/Text markieren – keine Änderungen (S2.1). Standard = Bearbeiten.
let style = { color: '#1c242c', width: 1.5, size: 16 };   // Standard: dünn + schwarz (Plan-tauglich)
function saveStyle() { try { localStorage.setItem('submitpdf.style', JSON.stringify({ color: style.color, width: style.width, size: style.size, penTidy })); } catch (_) { } }
function loadStyle() { let s; try { s = JSON.parse(localStorage.getItem('submitpdf.style') || 'null'); } catch (_) { s = null; } if (!s) return; if (s.color) style.color = s.color; if (s.width) style.width = s.width; if (s.size) style.size = s.size; if (typeof s.penTidy === 'boolean') penTidy = s.penTidy; }
function applyStyleUI() { const $$$ = id => document.getElementById(id); const d = $$$('colorDot'); if (d) d.style.background = style.color; const cp = $$$('colorPick'); if (cp) cp.value = style.color; const ws = $$$('widthSel'); if (ws) ws.value = String(style.width); const ss = $$$('sizeSel'); if (ss) ss.value = String(style.size); const pt = $$$('penTidyBtn'); if (pt) pt.classList.toggle('on', penTidy); }
let penTidy = true;        // Freihand-Skizzen automatisch zu sauberen Formen aufräumen
let docScale = null;       // {perPt: reale Meter pro PDF-Punkt, label:'1:100'} – für Messen
const PT2MM = 25.4 / 72;   // 1 PDF-Punkt in mm
let dimUnit = false, wallDimOffCm = 10, wallDimGap = 8;   // Mass-Anzeige mit Einheit? (Standard: Plan-Stil „4.00") · Abstand der Wand-Masslinie (cm) · Lücke Bauteil↔Hilfslinie (pt)
let dimWithPlaster = false;   // Massbezug: false = ohne Putz (innen Tragschicht/Mauerwerk, aussen Dämmung) · true = fertige Oberfläche
let simpleMode = false;   // global einfache Darstellung erzwingen: Wände schwarz (Poché), Öffnungen als Symbol
function wallSimple(w) { return (w && w.simple != null) ? w.simple : simpleMode; }   // pro Wand überschreibbar (a.simple true/false), sonst global
function fmtLen(pts) {
  if (docScale && !dimUnit) return (pts * docScale.perPt).toFixed(2);          // Plan-Stil: „2.00" (Meter, 2 Nachkommastellen, ohne Einheit)
  if (!docScale) return Math.round(pts * PT2MM) + (dimUnit ? ' mm' : '');      // ohne Massstab: Papier-mm
  const m = pts * docScale.perPt;
  if (m >= 1) return (Math.round(m * 100) / 100).toString().replace('.', ',') + ' m';
  if (m >= 0.1) return (Math.round(m * 1000) / 10).toString().replace('.', ',') + ' cm';
  return Math.round(m * 1000) + ' mm';
}
let sel = null;            // {num, id}
let secSelWall = null;     // im Schnitt sub-gewählte Wand (id) → nur deren Ziehpunkte + Highlight
let groupSel = null;       // {num, ids:[…]} – Mehrfachauswahl (Rahmen)
let nextId = 1;
let undoStack = [];
let redoStack = [];

/* ---------- Libs ---------- */
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('offline')); document.head.appendChild(s); }); }
async function loadPdfJs() { if (pdfjs) return pdfjs; if (!window.pdfjsLib) await loadScript(`${CDN}/pdf.min.js`); window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${CDN}/pdf.worker.min.js`; pdfjs = window.pdfjsLib; return pdfjs; }
async function loadPdfLib() { if (!window.PDFLib) await loadScript(PDFLIB); return window.PDFLib; }

/* ---------- UI Helpers ---------- */
function status(m) { const el = $('#status'); if (!m) { el.hidden = true; return; } el.textContent = m; el.hidden = false; }
function toast(m) { const r = $('#toast-root'); const t = document.createElement('div'); t.className = 'toast'; t.textContent = m; r.appendChild(t); setTimeout(() => t.remove(), 2600); }
function svgEl(tag, attrs) { const e = document.createElementNS(SVGNS, tag); for (const k in (attrs || {})) e.setAttribute(k, attrs[k]); return e; }
function hexToRgb(h) { h = (h || '#000').replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4, 6), 16) / 255 }; }

/* ---------- Öffnen ---------- */
function isImg(f) { return /^image\//.test(f.type) || /\.(png|jpe?g|gif|webp|bmp|heic)$/i.test(f.name); }
// Datei-Auswahl: native (Tauri-Desktop) bevorzugt, sonst Browser-Dateidialog
function openPicker() { if (window.nativeOpen) { window.nativeOpen(); return; } $('#fileInput').click(); }
// Einstieg für die Desktop-Hülle: rohe Bytes (z. B. aus Datei-Verknüpfung) in die normale Pipeline
window.openNativeBytes = function (arr, path) { const name = (path || '').split(/[\\/]/).pop() || 'dokument.pdf'; openFiles([new File([arr], name, { type: /\.pdf$/i.test(name) ? 'application/pdf' : '' })]); };

/* ---------- Ordner-Browser (File System Access API) ---------- */
let dirHandle = null, curFileHandle = null;
function fsSupported() { return 'showDirectoryPicker' in window; }
// Läuft die App als Tauri-Desktop-App (.exe)? Im Browser immer false → Tauri-Pfade schlafen.
function isTauri() { return !!(window.__TAURI__ || window.__TAURI_INTERNALS__); }
async function pickFolder() {
  if (isTauri()) { await tauriPickStart(); return; }                 // Desktop: nativer Ordner-Dialog (voller Zugriff)
  if (!fsSupported()) { toast(location.protocol === 'file:' ? 'Ordner-Browser nur über die Online-/App-Version (https).' : 'Ordner-Zugriff braucht Chrome/Edge.'); return; }
  try { dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' }); } catch (_) { return; }
  $('#work').classList.add('files-open'); $('#btnFolder').classList.add('on'); $('#fpName').textContent = dirHandle.name || 'Ordner'; await refreshTree();
}
// „Dateien"-Knopf: Verzeichnis-Panel ein-/ausklappen (ohne Ordner-Zugriff: einfach Datei öffnen)
function toggleFiles() {
  if (isTauri()) {                                                   // Desktop: Panel zeigt direkt die Laufwerke (C:\ …)
    const open = $('#work').classList.toggle('files-open'); $('#btnFolder').classList.toggle('on', open);
    if (open) { $('#fpName').textContent = 'Dieser PC'; refreshTree(); } return;
  }
  if (!fsSupported()) { openPicker(); return; }
  const open = $('#work').classList.toggle('files-open'); $('#btnFolder').classList.toggle('on', open);
}
async function refreshTree() {
  const t = $('#fpTree');
  if (isTauri()) {                                                   // Desktop: Laufwerke als Wurzeln, beliebig tief
    t.innerHTML = '';
    for (const r of tauriRoots()) {
      const row = fpRow('▾', r.name, 'dir'); t.appendChild(row);
      const sub = document.createElement('div'); sub.className = 'fp-sub'; t.appendChild(sub);
      await buildTreeTauri(r, sub);
      row.onclick = () => { sub.hidden = !sub.hidden; row.querySelector('.fp-ic').textContent = sub.hidden ? '▸' : '▾'; };
    }
    return;
  }
  if (!dirHandle) return; t.innerHTML = ''; await buildTree(dirHandle, t);
  if (!t.children.length) t.innerHTML = '<div class="fp-hint">Keine PDFs/Bilder in diesem Ordner.</div>';
}
// Im Ordner (inkl. Unterordner) nach Dateinamen suchen
let _searchT = null, _searchRun = 0;
function onFolderSearch(q) {
  clearTimeout(_searchT);
  q = (q || '').trim();
  if (!dirHandle) return;
  if (!q) { refreshTree(); return; }
  _searchT = setTimeout(() => searchFolder(q), 220);
}
async function searchFolder(q) {
  const t = $('#fpTree'), run = ++_searchRun; t.innerHTML = '<div class="fp-hint">Suche …</div>';
  const ql = q.toLowerCase(), results = [];
  await walkSearch(dirHandle, '', ql, results, 400, () => run !== _searchRun);
  if (run !== _searchRun) return;                              // neuere Suche läuft
  t.innerHTML = '';
  if (!results.length) { t.innerHTML = '<div class="fp-hint">Nichts gefunden für „' + q + '".</div>'; return; }
  for (const r of results) {
    const row = fpRow(/\.pdf$/i.test(r.name) ? '📄' : '🖼', r.name, 'file result');
    if (r.path) { const p = document.createElement('span'); p.className = 'fp-path'; p.textContent = r.path; row.appendChild(p); }
    row.onclick = () => { $$('.fp-row.active', t).forEach(x => x.classList.remove('active')); row.classList.add('active'); openFromHandle(r.handle, (r.path || '').split('/').filter(Boolean)[0]); };
    t.appendChild(row);
  }
}
async function walkSearch(handle, prefix, ql, results, max, aborted) {
  if (results.length >= max || aborted()) return;
  let entries = []; try { for await (const [name, h] of handle.entries()) entries.push([name, h]); } catch (_) { return; }
  for (const [name, h] of entries) { if (results.length >= max) return; if (h.kind === 'file' && /\.(pdf|png|jpe?g|webp)$/i.test(name) && name.toLowerCase().includes(ql)) results.push({ name, handle: h, path: prefix }); }
  for (const [name, h] of entries) { if (results.length >= max || aborted()) return; if (h.kind === 'directory' && !name.startsWith('.')) await walkSearch(h, prefix + '/' + name, ql, results, max, aborted); }
}
async function buildTree(handle, container, proj) {   // proj = Projektname (erste Ordnerebene unter dem Arbeitsordner)
  const entries = []; try { for await (const [name, h] of handle.entries()) entries.push([name, h]); } catch (_) { return; }
  entries.sort((a, b) => (a[1].kind === b[1].kind) ? a[0].localeCompare(b[0]) : (a[1].kind === 'directory' ? -1 : 1));
  for (const [name, h] of entries) {
    if (h.kind === 'directory') {
      if (name.startsWith('.')) continue;
      const childProj = proj || name, row = fpRow('▸', name, 'dir' + (!proj && knownProjects().includes(name) ? ' fp-proj' : '')); container.appendChild(row);
      const sub = document.createElement('div'); sub.className = 'fp-sub'; sub.hidden = true; container.appendChild(sub); let loaded = false;
      row.onclick = async () => { sub.hidden = !sub.hidden; row.querySelector('.fp-ic').textContent = sub.hidden ? '▸' : '▾'; if (!loaded && !sub.hidden) { loaded = true; await buildTree(h, sub, childProj); } };
    } else if (/\.(pdf|png|jpe?g|webp)$/i.test(name)) {
      const row = fpRow(/\.pdf$/i.test(name) ? '📄' : '🖼', name, 'file'); container.appendChild(row);
      row.onclick = () => { $$('.fp-row.active', $('#fpTree')).forEach(r => r.classList.remove('active')); row.classList.add('active'); openFromHandle(h, proj); };
    }
  }
}
function fpRow(ic, name, cls) { const d = document.createElement('div'); d.className = 'fp-row ' + cls; d.innerHTML = '<span class="fp-ic"></span><span class="fp-nm"></span>'; d.querySelector('.fp-ic').textContent = ic; d.querySelector('.fp-nm').textContent = name; return d; }
async function openFromHandle(fh, proj) {
  try { const file = await fh.getFile(); await openFiles([file]); if (docs[active]) { docs[active].fileHandle = fh; curFileHandle = fh; if (proj) docs[active].project = proj; } updateProjectChip(); }
  catch (e) { console.error(e); toast('Datei konnte nicht geöffnet werden.'); }
}
function updateProjectChip() {
  const el = $('#docProject'); if (!el) return;
  const p = (docs[active] && docs[active].project) || '';
  if (p) { el.textContent = '📁 ' + p; el.hidden = false; } else { el.hidden = true; }
}

/* ============================================================================
   DESKTOP (Tauri) – voller Datei-Baum ab Laufwerk. Schläft im Browser komplett
   (isTauri()===false → nichts davon läuft). Wird automatisch aktiv, sobald die
   App als .exe gebaut ist. Beim ersten .exe-Build nur prüfen:
   - tauri.conf.json: fs- + dialog-Plugin in der Allowlist freigeben
   - ggf. echte Laufwerksliste via kleinem Rust-Command (statt fixem C:\)
   - exakte JS-Bindung (Tauri v1: window.__TAURI__.fs / v2: plugin-fs)
   ============================================================================ */
function tauriRoots() {
  // Vorerst Laufwerk C:\ als Wurzel. (Build-Zeit: echte Laufwerksliste ergänzen.)
  return [{ tauri: true, name: 'C:\\', path: 'C:\\', isDir: true }];
}
async function tauriReadDir(path) {
  const fs = window.__TAURI__.fs;
  const ents = await fs.readDir(path);                               // Tauri v1: [{name, path, children?}]
  return ents.map(e => ({ tauri: true, name: e.name || e.path, path: e.path, isDir: Array.isArray(e.children) }));
}
async function buildTreeTauri(node, container) {
  let entries; try { entries = await tauriReadDir(node.path); } catch (_) { container.innerHTML = '<div class="fp-hint">Ordner nicht lesbar.</div>'; return; }
  entries = entries.filter(e => e.isDir ? !e.name.startsWith('.') : /\.(pdf|png|jpe?g|webp)$/i.test(e.name));
  entries.sort((a, b) => (a.isDir === b.isDir) ? a.name.localeCompare(b.name) : (a.isDir ? -1 : 1));
  for (const e of entries) {
    if (e.isDir) {
      const row = fpRow('▸', e.name, 'dir'); container.appendChild(row);
      const sub = document.createElement('div'); sub.className = 'fp-sub'; sub.hidden = true; container.appendChild(sub); let loaded = false;
      row.onclick = async () => { sub.hidden = !sub.hidden; row.querySelector('.fp-ic').textContent = sub.hidden ? '▸' : '▾'; if (!loaded && !sub.hidden) { loaded = true; await buildTreeTauri(e, sub); } };
    } else {
      const row = fpRow(/\.pdf$/i.test(e.name) ? '📄' : '🖼', e.name, 'file'); container.appendChild(row);
      row.onclick = () => { $$('.fp-row.active', $('#fpTree')).forEach(r => r.classList.remove('active')); row.classList.add('active'); openNodeTauri(e); };
    }
  }
}
async function openNodeTauri(e) {
  try {
    const data = new Uint8Array(await window.__TAURI__.fs.readBinaryFile(e.path));
    if (/\.(png|jpe?g|webp)$/i.test(e.name)) { const f = new File([data], e.name); const bytes = await imageToPdf(f); await addDoc(bytes, e.name.replace(/\.[^.]+$/, '') + '.pdf'); }
    else { await loadPdfJs(); await addDoc(data, e.name); }
  } catch (err) { console.error(err); toast('Datei konnte nicht geöffnet werden.'); }
}
async function tauriPickStart() {                                     // nativer Ordner-Dialog → als Wurzel anzeigen
  try {
    const sel = await window.__TAURI__.dialog.open({ directory: true });
    if (!sel) return; const path = Array.isArray(sel) ? sel[0] : sel;
    $('#work').classList.add('files-open'); $('#btnFolder').classList.add('on'); $('#fpName').textContent = path;
    const t = $('#fpTree'); t.innerHTML = '';
    const node = { tauri: true, name: path, path, isDir: true };
    const row = fpRow('▾', path, 'dir'); t.appendChild(row);
    const sub = document.createElement('div'); sub.className = 'fp-sub'; t.appendChild(sub);
    await buildTreeTauri(node, sub);
    row.onclick = () => { sub.hidden = !sub.hidden; row.querySelector('.fp-ic').textContent = sub.hidden ? '▸' : '▾'; };
  } catch (_) { }
}
async function openFiles(files) {
  files = [...files];
  if (files.some(f => /\.dwg$/i.test(f.name))) toast('DWG geht im Browser nicht direkt (Autodesk-Binärformat). Bitte als DXF oder PDF exportieren – die Desktop-App kann DWG später umwandeln.');
  files = files.filter(f => /\.(pdf|dxf)$/i.test(f.name) || f.type === 'application/pdf' || isImg(f));
  if (!files.length) return;
  try { status('Lade PDF-Engine …'); await loadPdfJs(); } catch (_) { status(''); toast('PDF-Engine nicht ladbar (einmal Internet nötig).'); return; }
  try {
    for (const f of files) {                                  // jede Datei → eigener Tab
      let bytes, name;
      if (/\.dxf$/i.test(f.name)) { status('DXF wird umgewandelt …'); try { bytes = await dxfToPdf(f); } catch (err) { status(''); toast('DXF konnte nicht umgewandelt werden: ' + (err && err.message || 'unbekannt')); continue; } name = f.name.replace(/\.[^.]+$/, '') + '.pdf'; }
      else if (isImg(f)) { status('Bild wird vorbereitet …'); bytes = await imageToPdf(f); name = f.name.replace(/\.[^.]+$/, '') + '.pdf'; }
      else { bytes = new Uint8Array(await f.arrayBuffer()); name = f.name; }
      await addDoc(bytes, name);
    }
  } catch (e) { status(''); console.error(e); toast('Datei konnte nicht geöffnet werden.'); }
}
/* ---------- Mehrere Dokumente (Tabs) ---------- */
function blankDoc(bytes, name) { return { bytes, name, fileHandle: null, annos: {}, pageRot: {}, viewRot: {}, docScale: null, nextId: 1, undo: [], zoom: 'auto', pdfDoc: null, scrollTop: 0, dirty: false, formValues: {}, layers: [{ id: 'base', name: 'Ebene 1', visible: true }], activeLayerId: 'base' }; }
function saveActiveDoc() {
  if (active < 0 || !docs[active]) return; const d = docs[active];
  d.bytes = curBytes; d.name = docName; d.fileHandle = curFileHandle; d.annos = annos; d.pageRot = pageRot; d.viewRot = viewRot; d.docScale = docScale; d.nextId = nextId; d.undo = undoStack; d.zoom = zoom; d.pdfDoc = pdfDoc; d.dirty = dirty; d.formValues = formValues; d.layers = layers; d.activeLayerId = activeLayerId;
  const p = $('#pages'); d.scrollTop = p ? p.scrollTop : 0;
}
async function loadActive() {
  const d = docs[active]; if (!d) return;
  curBytes = d.bytes; docName = d.name; curFileHandle = d.fileHandle; annos = d.annos; pageRot = d.pageRot; viewRot = d.viewRot; docScale = d.docScale; nextId = d.nextId; undoStack = d.undo; zoom = d.zoom; sel = null; dirty = d.dirty || false; formValues = d.formValues || {}; layers = d.layers || [{ id: 'base', name: 'Ebene 1', visible: true }]; activeLayerId = d.activeLayerId || (layers[0] && layers[0].id);
  redoStack = []; updateUndoButtons();
  if (d.pdfDoc) { pdfDoc = d.pdfDoc; await renderCurrentDoc(); } else { await loadDoc(d.bytes.slice()); d.pdfDoc = pdfDoc; }
  const p = $('#pages'); if (p) p.scrollTop = d.scrollTop || 0;
}
function showEmpty() { active = -1; pdfDoc = null; curBytes = null; curFileHandle = null; document.body.classList.remove('has-doc'); ['#rulerH', '#rulerV', '#rulerCorner', '#gridCv', '#gridBar'].forEach(s => { const e = $(s); if (e) e.hidden = true; }); $('#drop').classList.remove('hide'); $('#toolbar').hidden = true; $('#quickbar').hidden = true; $('#pages').innerHTML = ''; showEmptyThumbs(); $('#btnSave').disabled = true; $('#btnSend').disabled = true; document.title = 'Submit PDF'; renderTabs(); }
// Leerzustand: Vorschau-Spalte zeigt zwei Kacheln – „PDF öffnen" und „Neue Seite/Folie"
function showEmptyThumbs() {
  const host = $('#thumbs'); if (!host) return; host.innerHTML = '';
  const open = document.createElement('button'); open.className = 'thumb-new tn-open'; open.title = 'PDF/Bild öffnen';
  open.innerHTML = '<svg class="tn-ic" viewBox="0 0 24 24"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/></svg><span>PDF öffnen</span>';
  open.onclick = openPicker;
  const neu = document.createElement('button'); neu.className = 'thumb-new'; neu.title = 'Neue Seite / Folie';
  neu.innerHTML = '<span class="tn-plus">＋</span><span>Neue Seite</span>';
  neu.onclick = () => openSlidePicker('new');
  host.appendChild(open); host.appendChild(neu);
}
async function addDoc(bytes, name, skipRestore) {
  saveActiveDoc(); const prev = active; const d = blankDoc(bytes, name); docs.push(d); active = docs.length - 1;
  try { await loadActive(); }
  catch (e) {                                          // z. B. Passwort abgebrochen / nicht lesbar → Tab wieder entfernen
    console.error('Dokument konnte nicht geladen werden:', e);
    docs.pop(); active = docs.length ? Math.min(prev, docs.length - 1) : -1;
    if (active >= 0) { try { await loadActive(); } catch (_) { } renderTabs(); } else showEmpty();
    status('');
    if (!e || e.name !== 'AbortByUser') toast('Konnte nicht öffnen: ' + (e && (e.message || e.name) || 'unbekannt'));
    return;
  }
  renderTabs(); if (!skipRestore) { try { await maybeRestore(); } catch (_) { } }   // neue Leerseiten: keine (kollidierende) Wiederherstellung
}
async function activateDoc(i) { if (i === active || i < 0 || i >= docs.length) return; saveActiveDoc(); active = i; await loadActive(); renderTabs(); }
async function closeDoc(i) {
  if (i < 0 || i >= docs.length) return;
  const wasActive = i === active; docs.splice(i, 1);
  if (!docs.length) { showEmpty(); return; }
  if (wasActive) { active = Math.min(active, docs.length - 1); await loadActive(); } else if (i < active) active--;
  renderTabs();
}
// Dokument umbenennen (Tab-Name)
function renameDoc(i) {
  const d = docs[i]; if (!d) return;
  const base = d.name.replace(/\.pdf$/i, '');
  const v = prompt('Dokumentname:', base); if (v == null) return;
  let name = v.trim(); if (!name) return; if (!/\.pdf$/i.test(name)) name += '.pdf';
  d.name = name; if (i === active) { docName = name; $('#docName').textContent = name; document.title = 'Submit PDF'; markDirty(); }
  renderTabs();
}
function renderTabs() {
  const bar = $('#tabbar'); if (!bar) return;
  document.body.classList.toggle('has-tabs', docs.length >= 1);
  bar.innerHTML = ''; if (!docs.length) return;
  docs.forEach((d, i) => {
    const t = document.createElement('div'); t.className = 'tab' + (i === active ? ' active' : '');
    const nm = document.createElement('span'); nm.className = 'tab-nm'; nm.textContent = d.name; nm.title = d.name + '  ·  Doppelklick zum Umbenennen'; nm.onclick = () => activateDoc(i); nm.ondblclick = e => { e.stopPropagation(); renameDoc(i); };
    const x = document.createElement('button'); x.className = 'tab-x'; x.textContent = '✕'; x.title = 'Schliessen'; x.onclick = e => { e.stopPropagation(); closeDoc(i); };
    t.appendChild(nm); t.appendChild(x); bar.appendChild(t);
  });
  const add = document.createElement('button'); add.className = 'tab-add'; add.textContent = '＋'; add.title = 'Weiteres Dokument öffnen'; add.onclick = () => openPicker(); bar.appendChild(add);
}
/* ---------- Autosave & Wiederherstellen (IndexedDB) ---------- */
let dirty = false, _autosaveT = null, _db = null;
function idb() { return new Promise((res, rej) => { if (_db) return res(_db); let r; try { r = indexedDB.open('submitpdf', 1); } catch (e) { return rej(e); } r.onupgradeneeded = () => r.result.createObjectStore('autosave'); r.onsuccess = () => res(_db = r.result); r.onerror = () => rej(r.error); }); }
async function idbPut(k, v) { try { const db = await idb(); await new Promise((res, rej) => { const tx = db.transaction('autosave', 'readwrite'); tx.objectStore('autosave').put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); } catch (_) { } }
async function idbGet(k) { try { const db = await idb(); return await new Promise(res => { const rq = db.transaction('autosave', 'readonly').objectStore('autosave').get(k); rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null); }); } catch (_) { return null; } }
async function idbDel(k) { try { const db = await idb(); await new Promise(res => { const tx = db.transaction('autosave', 'readwrite'); tx.objectStore('autosave').delete(k); tx.oncomplete = res; tx.onerror = res; }); } catch (_) { } }
function docSig() { return (docName || 'dok') + '::' + (curBytes ? curBytes.length : 0); }
function markDirty() { dirty = true; scheduleAutosave(); }
function scheduleAutosave() { clearTimeout(_autosaveT); _autosaveT = setTimeout(autosaveNow, 1200); }
async function autosaveNow() {
  if (!curBytes || active < 0 || !dirty || cropping || snipping) return;
  try { await idbPut(docSig(), { name: docName, ts: Date.now(), annos, pageRot, viewRot, docScale, nextId, formValues, layers, activeLayerId }); } catch (_) { }
}
function clearAutosave() { idbDel(docSig()); }
async function maybeRestore() {                                  // beim Öffnen: gibt es gesicherte Anmerkungen?
  const rec = await idbGet(docSig());
  const hasForm = rec && rec.formValues && Object.keys(rec.formValues).length;
  if (!rec || ((!rec.annos || !Object.keys(rec.annos).length) && !hasForm)) return;
  const when = new Date(rec.ts).toLocaleString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  if (!confirm('Für „' + docName + '" gibt es automatisch gesicherte Eingaben (' + when + ').\nWiederherstellen?')) return;
  annos = rec.annos || {}; pageRot = rec.pageRot || {}; viewRot = rec.viewRot || {}; docScale = rec.docScale || null; nextId = Math.max(nextId, rec.nextId || 1); if (hasForm) formValues = rec.formValues; if (rec.layers && rec.layers.length) { layers = rec.layers; activeLayerId = rec.activeLayerId || layers[0].id; }
  const d = docs[active]; if (d) { d.annos = annos; d.pageRot = pageRot; d.viewRot = viewRot; d.docScale = docScale; d.nextId = nextId; d.formValues = formValues; d.dirty = true; }
  dirty = true; pageViews.forEach(pv => { layoutPv(pv); drawAnnos(pv); buildFormLayer(pv); }); buildThumbs(); refreshComments(); updateScaleLabel(); toast('Eingaben wiederhergestellt ✓');
}

// Bild → 1-seitige PDF (Bytes, nebenwirkungsfrei)
async function imageToPdf(file) {
  const lib = await loadPdfLib();
  const url = URL.createObjectURL(file);
  const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
  const cv = document.createElement('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight;
  cv.getContext('2d').drawImage(im, 0, 0); URL.revokeObjectURL(url);
  const b64 = cv.toDataURL('image/png').split(',')[1];
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const doc = await lib.PDFDocument.create();
  const png = await doc.embedPng(bytes);
  const pg = doc.addPage([im.naturalWidth, im.naturalHeight]);
  pg.drawImage(png, { x: 0, y: 0, width: im.naturalWidth, height: im.naturalHeight });
  return new Uint8Array(await doc.save());
}
/* ---------- DXF (CAD, Text-Format) → PDF-Seite zum Draufzeichnen ---------- */
function parseDxf(text) {
  const L = text.split(/\r\n|\r|\n/), toks = [];
  for (let i = 0; i + 1 < L.length; i += 2) { const c = parseInt(L[i], 10); if (Number.isNaN(c)) { i -= 1; continue; } toks.push([c, L[i + 1]]); }
  const ents = []; let i = 0;
  const readEntity = type => { const e = { type, g: {}, xs: [], ys: [] }; while (i < toks.length) { const [c, v] = toks[i]; if (c === 0) break; i++; if (c === 10) e.xs.push(parseFloat(v)); else if (c === 20) e.ys.push(parseFloat(v)); else if (!(c in e.g)) e.g[c] = v; } return e; };
  while (i < toks.length) {
    const [c, v] = toks[i]; if (c !== 0) { i++; continue; }
    const t = v.trim(); i++;
    if (t === 'POLYLINE') { const head = readEntity('POLYLINE'), verts = []; while (i < toks.length) { const [cc, vv] = toks[i]; if (cc !== 0) { i++; continue; } const tt = vv.trim(); if (tt === 'VERTEX') { i++; const ve = readEntity('VERTEX'); verts.push([ve.xs[0] || 0, ve.ys[0] || 0]); } else if (tt === 'SEQEND') { i++; readEntity('SEQEND'); break; } else break; } head.verts = verts; head.closed = (parseInt(head.g[70] || '0', 10) & 1) === 1; ents.push(head); }
    else ents.push(readEntity(t));
  }
  return ents;
}
function dxfGeom(ents) {
  const segs = [], circles = [], arcs = [], texts = [];
  for (const e of ents) {
    if (e.type === 'LINE') { const x2 = parseFloat(e.g[11]), y2 = parseFloat(e.g[21]); if (isFinite(e.xs[0]) && isFinite(x2)) segs.push({ pts: [[e.xs[0], e.ys[0]], [x2, y2]], closed: false }); }
    else if (e.type === 'LWPOLYLINE' && e.xs.length >= 2) segs.push({ pts: e.xs.map((x, k) => [x, e.ys[k]]), closed: (parseInt(e.g[70] || '0', 10) & 1) === 1 });
    else if (e.type === 'POLYLINE' && e.verts && e.verts.length >= 2) segs.push({ pts: e.verts, closed: e.closed });
    else if (e.type === 'CIRCLE') circles.push({ cx: e.xs[0], cy: e.ys[0], r: parseFloat(e.g[40] || '0') });
    else if (e.type === 'ARC') arcs.push({ cx: e.xs[0], cy: e.ys[0], r: parseFloat(e.g[40] || '0'), a0: parseFloat(e.g[50] || '0'), a1: parseFloat(e.g[51] || '0') });
    else if (e.type === 'TEXT' || e.type === 'MTEXT') { const str = (e.g[1] || '').replace(/\\[A-Za-z0-9.|]+;?/g, '').replace(/[{}]/g, '').trim(); if (str) texts.push({ x: e.xs[0] || 0, y: e.ys[0] || 0, h: parseFloat(e.g[40] || '2.5'), str }); }
  }
  return { segs, circles, arcs, texts };
}
async function dxfToPdf(file) {
  const lib = await loadPdfLib(), geom = dxfGeom(parseDxf(await file.text()));
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  const ext = (x, y) => { if (!isFinite(x) || !isFinite(y)) return; if (x < minx) minx = x; if (y < miny) miny = y; if (x > maxx) maxx = x; if (y > maxy) maxy = y; };
  for (const s of geom.segs) for (const p of s.pts) ext(p[0], p[1]);
  for (const c of geom.circles) { ext(c.cx - c.r, c.cy - c.r); ext(c.cx + c.r, c.cy + c.r); }
  for (const a of geom.arcs) { ext(a.cx - a.r, a.cy - a.r); ext(a.cx + a.r, a.cy + a.r); }
  for (const t of geom.texts) ext(t.x, t.y);
  if (!isFinite(minx)) throw new Error('Keine zeichenbare Geometrie in der DXF.');
  const W = maxx - minx || 1, H = maxy - miny || 1;
  let pw = 1190, ph = 842; if (H > W) { pw = 842; ph = 1190; }
  const m = 30, s = Math.min((pw - 2 * m) / W, (ph - 2 * m) / H);
  const ox = m - minx * s + ((pw - 2 * m) - W * s) / 2, oy = m - miny * s + ((ph - 2 * m) - H * s) / 2;
  const X = x => ox + x * s, Yv = y => oy + y * s;   // DXF y-oben = PDF y-oben
  const doc = await lib.PDFDocument.create(), font = await doc.embedFont(lib.StandardFonts.Helvetica), pg = doc.addPage([pw, ph]), col = lib.rgb(0.12, 0.14, 0.16), lw = 0.5;
  for (const seg of geom.segs) { const p = seg.pts; for (let k = 1; k < p.length; k++) pg.drawLine({ start: { x: X(p[k - 1][0]), y: Yv(p[k - 1][1]) }, end: { x: X(p[k][0]), y: Yv(p[k][1]) }, thickness: lw, color: col }); if (seg.closed && p.length > 2) pg.drawLine({ start: { x: X(p[p.length - 1][0]), y: Yv(p[p.length - 1][1]) }, end: { x: X(p[0][0]), y: Yv(p[0][1]) }, thickness: lw, color: col }); }
  for (const c of geom.circles) if (c.r > 0) pg.drawEllipse({ x: X(c.cx), y: Yv(c.cy), xScale: c.r * s, yScale: c.r * s, borderColor: col, borderWidth: lw });
  for (const a of geom.arcs) { if (!(a.r > 0)) continue; const a0 = a.a0 * Math.PI / 180; let d = (a.a1 - a.a0) * Math.PI / 180; while (d <= 0) d += 2 * Math.PI; const N = Math.max(6, Math.ceil(d / (Math.PI / 18))); let px = a.cx + Math.cos(a0) * a.r, py = a.cy + Math.sin(a0) * a.r; for (let k = 1; k <= N; k++) { const ang = a0 + d * k / N, nx = a.cx + Math.cos(ang) * a.r, ny = a.cy + Math.sin(ang) * a.r; pg.drawLine({ start: { x: X(px), y: Yv(py) }, end: { x: X(nx), y: Yv(ny) }, thickness: lw, color: col }); px = nx; py = ny; } }
  for (const t of geom.texts) { const fs = Math.max(4, Math.min(40, t.h * s)); try { pg.drawText(t.str, { x: X(t.x), y: Yv(t.y), size: fs, font, color: col }); } catch (_) { } }
  return new Uint8Array(await doc.save());
}
// Bild öffnen (setzt curBytes/docName) – nutzt die nebenwirkungsfreie Variante
async function imageToPdfBytes(file) {
  status('Bild wird vorbereitet …');
  curBytes = await imageToPdf(file);
  docName = file.name.replace(/\.[^.]+$/, '') + '.pdf';
}
function maxAnnoId(a) { let m = 0; for (const k in (a || {})) for (const an of (a[k] || [])) if (an && an.id > m) m = an.id; return m; }
async function loadDoc(bytes, skipRestore) {
  status('Öffne Dokument …');
  if (!pdfjs) { try { await loadPdfJs(); } catch (_) { status(''); toast('PDF-Engine nicht ladbar (einmal Internet nötig).'); throw new Error('pdfjs'); } }   // z. B. „Neue Seite" als erste Aktion
  const task = pdfjs.getDocument({ data: bytes }); let cancelled = false;
  task.onProgress = p => { if (p && p.total) status('Öffne Dokument … ' + Math.min(100, Math.round(p.loaded / p.total * 100)) + ' %'); };   // Fortschritt bei grossen Dateien
  task.onPassword = (updatePassword, reason) => {                          // passwortgeschütztes PDF
    const wrong = pdfjs.PasswordResponses && reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD;
    const pw = prompt(wrong ? 'Falsches Passwort – bitte erneut eingeben:' : 'Dieses PDF ist passwortgeschützt.\nPasswort eingeben:');
    if (pw === null) { cancelled = true; try { task.destroy(); } catch (_) { } } else updatePassword(pw);
  };
  try { pdfDoc = await task.promise; }
  catch (e) { status(''); if (cancelled) { const er = new Error('abgebrochen'); er.name = 'AbortByUser'; throw er; } throw e; }
  if (!skipRestore) {   // eingebettete editierbare Daten (von Submit PDF gespeichert) wiederherstellen → sauberes Original + bearbeitbare Anmerkungen
    let att = null; try { att = await pdfDoc.getAttachments(); } catch (_) { }
    const proj = att && att['submitpdf-project.json'], base = att && att['submitpdf-base.pdf'];
    if (proj && base) { let obj = null; try { obj = JSON.parse(new TextDecoder().decode(proj.content)); } catch (_) { }
      if (obj && obj.annos) {
        annos = obj.annos; docScale = obj.scale || null; pageRot = obj.pageRot || {}; viewRot = obj.viewRot || {}; formValues = obj.formValues || {}; layers = obj.layers || layers; activeLayerId = obj.activeLayerId || activeLayerId; nextId = maxAnnoId(annos) + 1; sel = null;
        curBytes = new Uint8Array(base.content);
        if (docs[active]) { const d = docs[active]; d.bytes = curBytes; d.annos = annos; d.docScale = docScale; d.pageRot = pageRot; d.viewRot = viewRot; d.formValues = formValues; d.layers = layers; d.activeLayerId = activeLayerId; d.nextId = nextId; d.pdfDoc = null; }
        await loadDoc(curBytes.slice(), true); if (docs[active]) docs[active].pdfDoc = pdfDoc;
        try { updateScaleLabel(); } catch (_) { } toast('Bearbeitbarer Plan + Anmerkungen wiederhergestellt – du kannst weiterzeichnen.');
        return;
      }
    }
  }
  await renderCurrentDoc();
  if (!skipRestore && active >= 0 && docs[active] && !docs[active]._annAsked) { docs[active]._annAsked = true; setTimeout(() => { try { importPdfAnnotations(true); } catch (_) { } }, 350); }   // PDF-Anmerkungen aus anderen Programmen anbieten
}
async function renderCurrentDoc() {
  $('#drop').classList.add('hide'); $('#toolbar').hidden = false; $('#quickbar').hidden = false;
  requestAnimationFrame(syncToolbarHeight);   // Toolbar-Höhe an die tatsächlichen Reihen anpassen
  $('#btnSave').disabled = false; $('#btnSend').disabled = false; $('#docName').textContent = docName;
  document.title = 'Submit PDF';
  _searchCache = {}; if (typeof closeFind === 'function') closeFind();   // Suche fürs neue Dokument zurücksetzen
  document.body.classList.add('has-doc');   // Toolbar-Höhe VOR dem Layout setzen → „auto"-Zoom rechnet mit dem endgültigen sichtbaren Feld (sonst Seite 1 zu gross)
  await buildLayout(); buildThumbs(); status(''); refreshComments(); updateScaleLabel(); updateFormatLabel();
  detectForm(); detectOutline();
  requestAnimationFrame(() => { if (zoom === 'auto' && pdfDoc) relayout(); });   // nach dem ersten Paint einmal sauber einpassen (endgültige Feldgrösse) → keine Doppel-/Versatz-Kachel
  setTimeout(() => { if (zoom === 'auto' && pdfDoc) relayout(); }, 280);   // nach dem Paletten-Übergang (~0,15s) nochmal → Seite 1 sitzt sicher richtig (nicht zu gross)
  if (rulerOn) requestAnimationFrame(drawRulers);
  if (gridOn) requestAnimationFrame(drawGrid);
  setTimeout(maybeOfferMount, 400);   // flaches „kein Blatt"-Dokument → anbieten, auf A4 zu legen
}

/* ---------- Lesezeichen / Inhalt (vorhandene PDF-Outline) ---------- */
async function detectOutline() {
  const btn = $('#btnOutline'), pop = $('#outlinePop');
  if (btn) { btn.hidden = true; btn.classList.remove('on'); } if (pop) { pop.hidden = true; pop.innerHTML = ''; }
  if (!pdfDoc || !pop) return;
  let ol; try { ol = await pdfDoc.getOutline(); } catch (_) { ol = null; }
  if (!ol || !ol.length) return;
  const build = (items, depth) => {
    for (const it of items) {
      const row = document.createElement('button'); row.className = 'ol-row'; row.style.paddingLeft = (10 + depth * 14) + 'px';
      row.textContent = it.title || '(ohne Titel)'; row.title = it.title || '';
      row.onclick = () => { gotoDest(it.dest); pop.hidden = true; if (btn) btn.classList.remove('on'); };
      pop.appendChild(row);
      if (it.items && it.items.length) build(it.items, depth + 1);
    }
  };
  build(ol, 0);
  if (btn) btn.hidden = false;
}
async function gotoDest(dest) {
  try {
    let d = dest; if (typeof d === 'string') d = await pdfDoc.getDestination(d);
    if (!Array.isArray(d) || !d[0]) return;
    const idx = await pdfDoc.getPageIndex(d[0]); gotoPage(idx + 1);
  } catch (_) { }
}
function askGotoPage() {
  if (!pdfDoc) return; const v = prompt('Zu welcher Seite? (1–' + pdfDoc.numPages + ')', String(curPage()));
  if (v == null) return; const n = parseInt(v, 10); if (n >= 1 && n <= pdfDoc.numPages) gotoPage(n);
}

/* ---------- PDF-Formularfelder ausfüllen ---------- */
async function detectForm() {
  formFields = {}; fieldTypes = {}; formMode = false;
  const btn = $('#btnForm'); if (btn) { btn.hidden = true; btn.classList.remove('on'); }
  document.body.classList.remove('form-fill');
  if (!pdfDoc) return;
  let count = 0;
  try {
    for (let n = 1; n <= pdfDoc.numPages; n++) {
      const page = await pdfDoc.getPage(n);
      const anns = await page.getAnnotations();
      const vp = page.getViewport({ scale: 1 });
      const list = [];
      for (const an of anns) {
        if (an.subtype !== 'Widget' || !an.fieldName) continue;
        const ft = an.fieldType; let type = null;
        if (ft === 'Tx') type = 'text';
        else if (ft === 'Btn') { if (an.checkBox) type = 'checkbox'; else if (an.radioButton) type = 'radio'; else continue; }
        else if (ft === 'Ch') type = 'dropdown';
        else continue;
        const r = vp.convertToViewportRectangle(an.rect);
        const left = Math.min(r[0], r[2]), top = Math.min(r[1], r[3]), w = Math.abs(r[2] - r[0]), h = Math.abs(r[3] - r[1]);
        const f = { name: an.fieldName, type, left, top, w, h, pw: vp.width, ph: vp.height, multiline: !!an.multiLine, maxLen: an.maxLen || 0, options: an.options || [], exportValue: an.buttonValue || an.exportValue || null, readonly: !!an.readOnly };
        list.push(f); fieldTypes[an.fieldName] = type; count++;
        // Vorbelegung aus dem PDF übernehmen (falls noch kein Wert gesetzt)
        if (!(an.fieldName in formValues)) {
          if (type === 'checkbox') formValues[an.fieldName] = (an.fieldValue && an.fieldValue !== 'Off') ? (f.exportValue || 'Yes') : 'Off';
          else if (type === 'radio') { if (an.fieldValue && an.fieldValue !== 'Off') formValues[an.fieldName] = an.fieldValue; }
          else if (an.fieldValue != null) formValues[an.fieldName] = Array.isArray(an.fieldValue) ? an.fieldValue[0] : an.fieldValue;
        }
      }
      if (list.length) formFields[n] = list;
    }
  } catch (e) { console.warn('Formular-Erkennung:', e); }
  if (count) {
    if (btn) { btn.hidden = false; }
    pageViews.forEach(buildFormLayer);
    toast(count + ' Formularfeld' + (count > 1 ? 'er' : '') + ' erkannt – „Formular" oben zum Ausfüllen.');
  }
}
function buildFormLayer(pv) {
  if (pv._formLayer) { pv._formLayer.remove(); pv._formLayer = null; }
  const fields = formFields[pv.num]; if (!fields || !fields.length) return;
  const layer = document.createElement('div'); layer.className = 'form-layer';
  for (const f of fields) {
    const pct = el => { el.style.left = (f.left / f.pw * 100) + '%'; el.style.top = (f.top / f.ph * 100) + '%'; el.style.width = (f.w / f.pw * 100) + '%'; el.style.height = (f.h / f.ph * 100) + '%'; };
    let el;
    if (f.type === 'text') {
      el = document.createElement(f.multiline ? 'textarea' : 'input'); if (!f.multiline) el.type = 'text';
      if (f.maxLen) el.maxLength = f.maxLen;
      el.value = formValues[f.name] || '';
      el.style.fontSize = Math.max(9, Math.min(f.h * 0.62, 22)) + 'px';
      el.oninput = () => { formValues[f.name] = el.value; markDirty(); syncField(f.name); };
    } else if (f.type === 'checkbox') {
      el = document.createElement('input'); el.type = 'checkbox'; el.checked = (formValues[f.name] && formValues[f.name] !== 'Off');
      el.onchange = () => { formValues[f.name] = el.checked ? (f.exportValue || 'Yes') : 'Off'; markDirty(); };
    } else if (f.type === 'radio') {
      el = document.createElement('input'); el.type = 'radio'; el.name = 'rg_' + f.name; el.dataset.export = f.exportValue; el.checked = (formValues[f.name] === f.exportValue);
      el.onchange = () => { if (el.checked) { formValues[f.name] = f.exportValue; markDirty(); syncField(f.name); } };
    } else if (f.type === 'dropdown') {
      el = document.createElement('select');
      const opts = f.options.length ? f.options : [];
      el.appendChild(new Option('', ''));
      for (const o of opts) { const dv = o.displayValue != null ? o.displayValue : o; const ev = o.exportValue != null ? o.exportValue : o; el.appendChild(new Option(dv, ev)); }
      el.value = formValues[f.name] || '';
      el.style.fontSize = Math.max(9, Math.min(f.h * 0.62, 18)) + 'px';
      el.onchange = () => { formValues[f.name] = el.value; markDirty(); };
    }
    el.classList.add('ff'); el.classList.add('ff-' + f.type); if (f.readonly) el.disabled = true;
    el.dataset.fname = f.name; pct(el); layer.appendChild(el);
  }
  pv.inner.appendChild(layer); pv._formLayer = layer;   // über Canvas + SVG
}
// gleichen Feldnamen auf anderen Seiten/Widgets nachziehen (Radio-Gruppen, wiederholte Felder)
function syncField(name) {
  pageViews.forEach(pv => {
    if (!pv._formLayer) return;
    pv._formLayer.querySelectorAll('[data-fname="' + CSS.escape(name) + '"]').forEach(el => {
      if (el === document.activeElement) return;            // gerade getipptes Feld nicht überschreiben (Cursor)
      if (el.type === 'checkbox') el.checked = (formValues[name] && formValues[name] !== 'Off');
      else if (el.type === 'radio') el.checked = (formValues[name] === el.dataset.export);
      else el.value = formValues[name] || '';
    });
  });
}
function toggleFormMode() {
  formMode = !formMode; document.body.classList.toggle('form-fill', formMode);
  $('#btnForm').classList.toggle('on', formMode);
  if (formMode) { setTool('select'); toast('Formular-Modus: in die Felder tippen. Zum Zeichnen „Formular" wieder aus.'); }
}

/* ---------- Rendern (virtualisiert: nur sichtbare Seiten) ----------
   Grosse PDFs (viele Seiten) liefen voll, weil früher ALLE Seiten zugleich als Canvas
   in voller Auflösung gerendert wurden (Speicher = Seitenzahl × Auflösung → Absturz).
   Jetzt: Platzhalter sofort (richtige Grösse → korrektes Scrollen), Canvas nur wenn die
   Seite in Sichtweite kommt; entfernt, wenn sie weit weg ist. Speicher bleibt konstant. */
const MAX_AREA = 24e6;       // max. Canvas-Pixel pro Seite, scharf (deckelt Speicher/Seite)
const PREVIEW_AREA = 6e6;    // max. Canvas-Pixel pro Seite, Vorschau (schnell, beim Scrollen)
const RENDER_MAX = 2;        // gleichzeitige Seiten-Renderings
let pageObserver = null, thumbObserver = null, renderQueue = [], renderActive = 0;
function fitScale(pw, ph) {   // Skala, bei der die Seite ganz ins sichtbare Feld passt (Breite UND Höhe) – echtes Innenmass, Padding abgezogen (sonst zu breit → nicht eingemittet)
  const host = $('#pages'), cs = getComputedStyle(host);
  const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  const availW = host.clientWidth - padX - 6, availH = host.clientHeight - padY - 6;
  let s = availW / pw;
  if (ph && availH > 60) s = Math.min(s, availH / ph);
  return Math.max(.2, Math.min(3, s));
}
// „auto": Fit-Breite je Seite → JEDE Seite füllt exakt die verfügbare Breite. Dadurch alle Seiten gleich breit auf dem Schirm (auch bei unterschiedlichen Seitengrössen) → einheitlich, keine „erste Seite grösser".
function pageScale(pv) { return (zoom === 'auto') ? fitScale(pv.pageW) : zoom; }
// Gerätegenau rendern (1:1 mit den Bildschirmpixeln): scharf, ohne dünne Linien zu verblassen.
function dprCap() { return Math.min(window.devicePixelRatio || 1, 3); }
function dprPreview() { return Math.min(window.devicePixelRatio || 1, 1.5); }
const SS_TILE = 2;           // Überabtastung der scharfen Kachel (2× = der „viel besser"-Stand)
const MIN_LINE_PX = 1;       // Mindest-Linienbreite in Gerätepixeln (Haarlinien sichtbar)
// Acrobat-Trick: keine Linie dünner als 1 Gerätepixel zeichnen (sonst werden Haarlinien grau/unscharf).
function patchMinLine(ctx, minBuf) {
  if (!(minBuf > 0)) minBuf = 1;
  const orig = ctx.stroke.bind(ctx);
  ctx.stroke = function (p) {
    let sx = 1; try { const m = ctx.getTransform(); sx = Math.hypot(m.a, m.b) || 1; } catch (_) { }
    const need = minBuf / sx;                          // Mindest-Linienbreite in PDF-Einheiten
    if (ctx.lineWidth < need) { const s = ctx.lineWidth; ctx.lineWidth = need; p ? orig(p) : orig(); ctx.lineWidth = s; }
    else { p ? orig(p) : orig(); }
  };
}

function layoutPv(pv) {                                  // Grösse/Drehung setzen (ohne zu rendern)
  // Anzeigegrösse exakt auf ganze GERÄTEPIXEL einrasten → Canvas 1:1 mit dem Bildschirm, keine Interpolation (Acrobat-scharf).
  const scale = pageScale(pv), dpr = dprCap();
  const dispW = Math.round(pv.pageW * scale * dpr) / dpr, dispH = Math.round(pv.pageH * scale * dpr) / dpr;
  const rot = (pageRot[pv.num] || 0) + (viewRot[pv.num] || 0), rad = rot * Math.PI / 180;
  const bw = Math.abs(dispW * Math.cos(rad)) + Math.abs(dispH * Math.sin(rad)), bh = Math.abs(dispW * Math.sin(rad)) + Math.abs(dispH * Math.cos(rad));
  if ((pv.scale !== scale || pv.rot !== rot)) { dropTile(pv); dropText(pv); }   // Skalierung/Drehung geändert → Kachel/Text neu
  if (pv.scale !== scale && pv.rendered) pv.stale = true;     // Zoom geändert → Basis neu rendern
  pv.scale = scale; pv.dispW = dispW; pv.dispH = dispH; pv.rot = rot;
  pv.wrap.style.width = bw + 'px'; pv.wrap.style.height = bh + 'px';
  pv.inner.style.width = dispW + 'px'; pv.inner.style.height = dispH + 'px';
  if (rot % 360 === 0) { pv.inner.style.left = '0'; pv.inner.style.top = '0'; pv.inner.style.transform = 'none'; }   // 0° = kein Transform → kein Verwischen
  else { pv.inner.style.left = '50%'; pv.inner.style.top = '50%'; pv.inner.style.transform = `translate(-50%,-50%) rotate(${rot}deg)`; }
  pv.svg.style.width = dispW + 'px'; pv.svg.style.height = dispH + 'px';
  if (pv.canvas) { pv.canvas.style.width = dispW + 'px'; pv.canvas.style.height = dispH + 'px'; }
}
async function buildLayout() {
  const tok = ++renderTok; const host = $('#pages'); host.innerHTML = ''; pageViews = [];
  renderQueue = []; if (pageObserver) pageObserver.disconnect();
  const p1 = await pdfDoc.getPage(1), v1 = p1.getViewport({ scale: 1 });   // Seite 1 für Standardgrösse
  for (let n = 1; n <= pdfDoc.numPages; n++) {
    if (tok !== renderTok) return;
    const outer = document.createElement('div'); outer.className = 'pagewrap loading'; outer.dataset.n = n;
    const inner = document.createElement('div'); inner.className = 'pageinner';
    const svg = svgEl('svg', { class: 'anno', viewBox: `0 0 ${v1.width} ${v1.height}`, preserveAspectRatio: 'none' });
    inner.appendChild(svg); outer.appendChild(inner); host.appendChild(outer);
    const pv = { num: n, wrap: outer, inner, svg, canvas: null, tile: null, textLayer: null, page: n === 1 ? p1 : null, pageW: v1.width, pageH: v1.height, scale: 0, rot: 0, rendered: false, rendering: false, stale: false, baseCapped: false, task: null, tileTask: null, textScale: 0, textBusy: false };
    pageViews.push(pv); layoutPv(pv); drawAnnos(pv); bindPageEvents(pv);
  }
  pageObserver = new IntersectionObserver(ents => {
    for (const e of ents) { const pv = pageViews.find(p => p.wrap === e.target); if (!pv) continue; if (e.isIntersecting) enqueueRender(pv); else releasePage(pv); }
  }, { root: host, rootMargin: '900px 0px' });
  pageViews.forEach(pv => pageObserver.observe(pv.wrap));
  applyToolCursor(); updateZoomLabel(); updatePageInd(); renderVisible();
}
// Basis: ganze Seite als günstige Vorschau. Scharf: nur der SICHTBARE Ausschnitt als
// hochauflösende Kachel darüber → gestochen scharf bei jeder Seitengrösse und jedem Zoom.
function enqueueRender(pv) { if (pv.rendering || (pv.rendered && !pv.stale) || renderQueue.includes(pv)) return; renderQueue.push(pv); pumpRender(); }
function pumpRender() { while (renderActive < RENDER_MAX && renderQueue.length) { const pv = renderQueue.shift(); renderActive++; renderPage(pv).catch(() => { }).finally(() => { renderActive--; pumpRender(); }); } }
async function renderPage(pv) {                       // Basis-Vorschau (ganze Seite, günstig)
  if (pv.rendering || (pv.rendered && !pv.stale)) return; pv.rendering = true; pv.wrap.classList.remove('render-fail');
  try {
    if (!pv.page) { pv.page = await pdfDoc.getPage(pv.num); const vp1 = pv.page.getViewport({ scale: 1 }); if (Math.abs(vp1.width - pv.pageW) > 1 || Math.abs(vp1.height - pv.pageH) > 1) { pv.pageW = vp1.width; pv.pageH = vp1.height; pv.svg.setAttribute('viewBox', `0 0 ${vp1.width} ${vp1.height}`); layoutPv(pv); } }
    // Adaptiv: kleine/mittlere Seiten sofort VOLL scharf; nur riesige Seiten deckeln (dann schärft die Kachel).
    const dpr = dprCap(); let rscale = (pv.dispW * dpr) / pv.pageW;   // Canvas-Breite = dispW*dpr → ganzzahlig, 1:1 mit dem Geräteraster
    const area = pv.pageW * rscale * pv.pageH * rscale; pv.baseCapped = area > MAX_AREA; if (pv.baseCapped) rscale *= Math.sqrt(MAX_AREA / area);
    const vp = pv.page.getViewport({ scale: rscale });
    const canvas = document.createElement('canvas'); canvas.className = 'pagecanvas';
    canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
    canvas.style.width = pv.dispW + 'px'; canvas.style.height = pv.dispH + 'px';
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; patchMinLine(ctx, MIN_LINE_PX);   // Haarlinien sichtbar halten, Bilder hochwertig glätten
    const task = pv.page.render({ canvasContext: ctx, viewport: vp }); pv.task = task;
    await task.promise; pv.task = null;
    if (!pv.rendering) return;   // zwischenzeitlich weggescrollt/freigegeben → verwerfen
    if (pv.canvas) pv.canvas.remove();
    pv.inner.insertBefore(canvas, pv.tile || pv.svg); pv.canvas = canvas; pv.rendered = true; pv.stale = false; pv.wrap.classList.remove('loading');
  } catch (e) { if (e && e.name !== 'RenderingCancelledException') { pv.wrap.classList.remove('loading'); pv.wrap.classList.add('render-fail'); } }   // echter Fehler → Hinweis statt leer
  finally { pv.rendering = false; scheduleSharpen(); }   // sobald die Basis steht, scharfe Kachel anstossen
}
function releasePage(pv) {     // weit weg → laufendes Rendern abbrechen + Canvas/Kachel freigeben
  if (pv.task) { try { pv.task.cancel(); } catch (_) { } pv.task = null; }
  dropTile(pv); dropText(pv);
  if (pv.canvas) { pv.canvas.remove(); pv.canvas = null; }
  pv.rendered = false; pv.rendering = false; pv.stale = false;
  const i = renderQueue.indexOf(pv); if (i >= 0) renderQueue.splice(i, 1); pv.wrap.classList.add('loading');
}
function dropTile(pv) { if (pv.tileTask) { try { pv.tileTask.cancel(); } catch (_) { } pv.tileTask = null; } if (pv.tile) { pv.tile.remove(); pv.tile = null; } pv.tileRect = null; pv.tileScale = 0; }
function dropText(pv) { if (pv.textLayer) { pv.textLayer.remove(); pv.textLayer = null; } pv.textScale = 0; }
// Auswählbare/kopierbare Textebene (pdf.js) über die Seite legen – im aktuellen Zoom positioniert.
async function ensureTextLayer(pv) {
  if (!pv.page || pv.textBusy || (pv.textLayer && pv.textScale === pv.scale)) return;
  pv.textBusy = true;
  try {
    const tc = await pv.page.getTextContent();
    const div = document.createElement('div'); div.className = 'textLayer';
    const scale = pv.scale; div.style.width = pv.dispW + 'px'; div.style.height = pv.dispH + 'px'; div.style.setProperty('--scale-factor', scale);
    const task = pdfjs.renderTextLayer({ textContentSource: tc, container: div, viewport: pv.page.getViewport({ scale }), textDivs: [] });
    await task.promise;
    if (pv.scale !== scale) return;     // Zoom hat sich zwischenzeitlich geändert
    if (pv.textLayer) pv.textLayer.remove();
    pv.inner.insertBefore(div, pv.svg); pv.textLayer = div; pv.textScale = scale;
  } catch (_) { /* Textebene optional */ }
  finally { pv.textBusy = false; }
}
function buildTextVisible() {     // Textebenen für sichtbare Seiten (nur im Text-Modus)
  const host = $('#pages'), top = host.scrollTop - 200, bot = host.scrollTop + host.clientHeight + 200;
  for (const pv of pageViews) { const t = pv.wrap.offsetTop, b = t + pv.wrap.offsetHeight; if (pv.page && b >= top && t <= bot) ensureTextLayer(pv); }
}

function renderVisible() {
  const host = $('#pages'), top = host.scrollTop - 900, bot = host.scrollTop + host.clientHeight + 900;
  for (const pv of pageViews) { const t = pv.wrap.offsetTop, b = t + pv.wrap.offsetHeight; if (b >= top && t <= bot) enqueueRender(pv); }
  scheduleSharpen();
}
// Sichtbaren Seiten-Ausschnitt in Seiten-Punkten (berücksichtigt Zoom + Drehung über die CTM). margin = Anteil, um den rundum vorgerendert wird.
function visiblePageRect(pv, margin) {
  const host = $('#pages'), r = host.getBoundingClientRect(), ctm = pv.svg.getScreenCTM(); if (!ctm) return null;
  const inv = ctm.inverse(), pt = pv.svg.createSVGPoint();
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const [x, y] of [[r.left, r.top], [r.right, r.top], [r.right, r.bottom], [r.left, r.bottom]]) {
    pt.x = x; pt.y = y; const q = pt.matrixTransform(inv);
    minx = Math.min(minx, q.x); maxx = Math.max(maxx, q.x); miny = Math.min(miny, q.y); maxy = Math.max(maxy, q.y);
  }
  if (margin) { const mw = (maxx - minx) * margin, mh = (maxy - miny) * margin; minx -= mw; maxx += mw; miny -= mh; maxy += mh; }   // rundum etwas mehr rendern → beim Scrollen bleibt es scharf
  minx = Math.max(0, minx); miny = Math.max(0, miny); maxx = Math.min(pv.pageW, maxx); maxy = Math.min(pv.pageH, maxy);
  if (maxx - minx < 1 || maxy - miny < 1) return null;
  return { x: minx, y: miny, w: maxx - minx, h: maxy - miny };
}
function rectCovers(o, i) { return o && i && i.x >= o.x - 0.5 && i.y >= o.y - 0.5 && i.x + i.w <= o.x + o.w + 0.5 && i.y + i.h <= o.y + o.h + 0.5; }
const TILE_MAXDIM = 8192;     // Browser-Canvas-Grenze pro Achse
async function renderTile(pv) {                      // scharfe Kachel über den sichtbaren Ausschnitt (+ Rand vorgerendert)
  if (pv.rendering || !pv.page) return;
  const scale = pageScale(pv), vis = visiblePageRect(pv, 0); if (!vis) return;
  if (pv.tile && pv.tileScale === scale && rectCovers(pv.tileRect, vis)) return;   // aktueller Blick ist schon scharf abgedeckt → nichts tun (kein Flackern/kein Neurendern)
  const rect = visiblePageRect(pv, 0.6); if (!rect) return;   // 60 % Rand rundum → beim Scrollen sofort scharf, muss nicht ständig nachladen
  pv.rendering = true;
  try {
    const dpr = dprCap(); let px = scale * dpr * SS_TILE;   // direkt überabgetastet rendern (wie vor v33)
    let tw = rect.w * px, th = rect.h * px;
    if (tw > TILE_MAXDIM || th > TILE_MAXDIM) { const f = Math.min(TILE_MAXDIM / tw, TILE_MAXDIM / th); px *= f; tw *= f; th *= f; }
    const vp = pv.page.getViewport({ scale: px });
    const canvas = document.createElement('canvas'); canvas.className = 'pagetile';
    canvas.width = Math.max(1, Math.round(tw)); canvas.height = Math.max(1, Math.round(th));
    canvas.style.left = (rect.x * scale) + 'px'; canvas.style.top = (rect.y * scale) + 'px';
    canvas.style.width = (rect.w * scale) + 'px'; canvas.style.height = (rect.h * scale) + 'px';   // Backing wird vom Browser heruntergerechnet → überabgetastet
    const transform = [1, 0, 0, 1, -rect.x * px, -rect.y * px];
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; patchMinLine(ctx, MIN_LINE_PX * px / (scale * dpr));
    const task = pv.page.render({ canvasContext: ctx, viewport: vp, transform }); pv.tileTask = task;
    await task.promise; pv.tileTask = null;
    if (!pv.rendered) return;   // zwischenzeitlich freigegeben → verwerfen
    if (pv.tile) pv.tile.remove(); pv.tile = canvas; pv.tileRect = rect; pv.tileScale = scale; pv.inner.insertBefore(canvas, pv.svg);
  } catch (_) { /* abgebrochen */ }
  finally { pv.rendering = false; }
}
let sharpenTimer = null;
function scheduleSharpen() {    // nach kurzer Ruhe: scharfe Kachel für die sichtbaren Seiten
  clearTimeout(sharpenTimer);
  sharpenTimer = setTimeout(() => {
    const host = $('#pages'), top = host.scrollTop, bot = host.scrollTop + host.clientHeight;
    // Position einrasten; scharfe (2× überabgetastete) Kachel über den sichtbaren Ausschnitt – für ALLE sichtbaren Seiten.
    for (const pv of pageViews) { const t = pv.wrap.offsetTop, b = t + pv.wrap.offsetHeight; if (b >= top && t <= bot) { snapPos(pv); if (pv.rendered) renderTile(pv); } }
    if (tool === 'textsel') buildTextVisible();
    if (tool === 'edittext') buildBlocksVisible();
  }, 55);
}
// Horizontale Zentrierung aufs Gerätepixel einrasten (sonst landet die Seite auf einem halben Pixel → leichtes Verwischen).
function snapPos(pv) {
  if (pv.rot % 360 !== 0) { pv.wrap.style.transform = 'none'; return; }   // gedreht: nicht einrasten
  const dpr = window.devicePixelRatio || 1; pv.wrap.style.transform = 'none';
  const left = pv.wrap.getBoundingClientRect().left;
  const dx = Math.round(left * dpr) / dpr - left;
  pv.wrap.style.transform = Math.abs(dx) > 0.001 ? `translateX(${dx}px)` : 'none';
}
function relayout() { if (!pdfDoc) return; pageViews.forEach(layoutPv); updateZoomLabel(); updatePageInd(); renderVisible(); updateSelBar(); scheduleRulers(); scheduleGrid(); }
let reflowTimer = null; function reflow() { clearTimeout(reflowTimer); reflowTimer = setTimeout(relayout, 140); }
// Toolbar wächst mit dem Inhalt (2 oder 3 Reihen je nach Fensterbreite) → echte Höhe messen und --tools setzen, damit nichts abgeschnitten wird und die Vorschau darunter korrekt sitzt.
let _tbH = 0;
function syncToolbarHeight() {
  const tb = document.getElementById('toolbar'); if (!tb || tb.hidden) return;
  const h = Math.round(tb.getBoundingClientRect().height);
  if (h > 0 && Math.abs(h - _tbH) > 1) { _tbH = h; document.documentElement.style.setProperty('--tools', h + 'px'); if (zoom === 'auto') reflow(); }
}

function buildThumbs() {        // Miniaturen ebenfalls lazy (nur sichtbare im Seitenstreifen)
  const host = $('#thumbs'); host.innerHTML = ''; if (thumbObserver) thumbObserver.disconnect();
  const ft = document.createElement('button'); ft.className = 'thumb-filter' + (thumbFilter ? ' on' : ''); ft.id = 'thumbFilterBtn'; ft.textContent = (thumbFilter ? '☑' : '☐') + ' Nur bezeichnete'; ft.title = 'Nur Seiten mit (sichtbaren) Anmerkungen anzeigen – Übersicht, welche Blätter bezeichnet sind';
  ft.onclick = () => { thumbFilter = !thumbFilter; applyThumbFilter(); }; host.appendChild(ft);
  const insBar = after => { const d = document.createElement('div'); d.className = 'thumb-ins'; d.title = 'Seite hier einfügen'; d.innerHTML = '<span class="ins-plus">＋</span>'; d.onclick = e => { e.stopPropagation(); showInsertMenu(after, d); }; return d; };
  host.appendChild(insBar(0));   // ganz oben einfügen
  for (let n = 1; n <= pdfDoc.numPages; n++) {
    const wrap = document.createElement('div'); wrap.className = 'thumb loading'; wrap.dataset.n = n;
    const c = document.createElement('canvas'); wrap.appendChild(c);
    const tn = document.createElement('span'); tn.className = 'tn'; tn.textContent = n; wrap.appendChild(tn);
    const ctrl = document.createElement('div'); ctrl.className = 'thumb-ctrl';
    ctrl.innerHTML = '<button data-act="up" title="Seite nach oben">▲</button><button data-act="down" title="Seite nach unten">▼</button><button data-act="dup" title="Seite duplizieren">⧉</button><button data-act="extract" title="Seite als neue PDF speichern">⤓</button><button data-act="del" class="del" title="Seite löschen">✕</button>';
    wrap.appendChild(ctrl);
    wrap.addEventListener('click', e => {
      const act = e.target.getAttribute && e.target.getAttribute('data-act');
      if (act === 'up') { movePage(n, -1); } else if (act === 'down') { movePage(n, 1); } else if (act === 'del') { deletePage(n); } else if (act === 'extract') { extractPage(n); } else if (act === 'dup') { duplicatePage(n); } else if (!wrap._dragged) gotoPage(n);
    });
    wrap.addEventListener('pointerdown', e => startThumbDrag(e, n, wrap));   // Drag&Drop-Umsortieren
    host.appendChild(wrap);
    host.appendChild(insBar(n));   // zwischen/nach dieser Seite einfügen
  }
  const add = document.createElement('button'); add.className = 'thumb-add'; add.textContent = '+ PDF/Bild anhängen';
  add.onclick = () => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/pdf,.pdf,image/*'; inp.multiple = true; inp.onchange = e => appendFiles(e.target.files); inp.click(); };
  host.appendChild(add);
  thumbObserver = new IntersectionObserver(ents => { for (const e of ents) if (e.isIntersecting) { renderThumb(+e.target.dataset.n, e.target); thumbObserver.unobserve(e.target); } }, { root: host, rootMargin: '500px 0px' });
  $$('.thumb', host).forEach(b => thumbObserver.observe(b));
  applyThumbFilter();
}
async function renderThumb(n, btn) {
  try { const page = await pdfDoc.getPage(n), vp1 = page.getViewport({ scale: 1 }); const vp = page.getViewport({ scale: 200 / vp1.width, rotation: pageRot[n] || 0 }); const c = btn.querySelector('canvas'); c.width = vp.width; c.height = vp.height; await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise; btn.classList.remove('loading'); } catch (_) { }
}
/* Miniaturen per Drag&Drop umsortieren */
function thumbList() { return $$('.thumb', $('#thumbs')); }
function thumbInsertIndex(clientY) { const ts = thumbList(); for (let i = 0; i < ts.length; i++) { const r = ts[i].getBoundingClientRect(); if (clientY < r.top + r.height / 2) return i; } return ts.length; }
function thumbMarker(clientY) { const ts = thumbList(), idx = thumbInsertIndex(clientY); ts.forEach((t, i) => { t.classList.toggle('drop-before', i === idx); t.classList.toggle('drop-after', idx >= ts.length && i === ts.length - 1); }); }
function clearThumbMarker() { thumbList().forEach(t => t.classList.remove('drop-before', 'drop-after')); }
function startThumbDrag(e, n, wrap) {
  if (e.button !== 0 || (e.target.closest && e.target.closest('.thumb-ctrl'))) return;
  wrap._dragged = false; const startY = e.clientY; let active = false;
  const move = ev => { if (!active && Math.abs(ev.clientY - startY) < 6) return; active = true; wrap._dragged = true; wrap.classList.add('dragging'); thumbMarker(ev.clientY); };
  const up = ev => {
    document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
    wrap.classList.remove('dragging'); clearThumbMarker();
    if (active) reorderThumb(n, thumbInsertIndex(ev.clientY));
    setTimeout(() => { wrap._dragged = false; }, 60);   // Klick nach Drag unterdrücken, dann zurücksetzen
  };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
}
function reorderThumb(srcN, insertIdx) {
  if (!pdfDoc) return; const N = pdfDoc.numPages; const order = []; for (let i = 1; i <= N; i++) order.push(i);
  const from = srcN - 1; order.splice(from, 1);
  let to = insertIdx; if (from < insertIdx) to = insertIdx - 1;
  order.splice(to, 0, srcN);
  if (order.every((v, i) => v === i + 1)) return;   // unverändert → nichts tun
  applyPageOrder(order);
}
function refreshThumb(n) { const btn = $(`.thumb[data-n="${n}"]`, $('#thumbs')); if (btn) { btn.classList.add('loading'); renderThumb(n, btn); } }
function gotoPage(n) { const v = pageViews.find(p => p.num === n); if (v) v.wrap.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
function curPage() { const host = $('#pages'), mid = host.scrollTop + host.clientHeight / 2; let cur = 1; for (const v of pageViews) if (v.wrap.offsetTop <= mid) cur = v.num; return cur; }
function updatePageInd() { if (!pdfDoc) return; const cur = curPage(); $('#pageInd').textContent = cur + ' / ' + pdfDoc.numPages; $$('.thumb', $('#thumbs')).forEach(t => t.classList.toggle('active', +t.dataset.n === cur)); updateFormatLabel(); updateProjectChip(); }

/* ---------- Zoom ---------- */
function curScale() { return (zoom === 'auto') ? (pageViews[0] ? pageViews[0].scale : 1) : zoom; }
function updateZoomLabel() { const pct = Math.round(((zoom === 'auto') ? curScale() : zoom) * 100); $('#zoomVal').innerHTML = pct + '&nbsp;%'; $('#zoomVal').classList.toggle('on', zoom === 'auto'); }
let _zoomRenderDeb = null;
function setZoom(z) {   // Zoom: Layout/Canvas sofort per CSS skalieren (flüssig), den teuren scharfen PDF-Re-Render entprellen
  zoom = z; if (!pdfDoc) return;
  pageViews.forEach(layoutPv); updateZoomLabel(); updatePageInd(); updateSelBar();
  clearTimeout(_zoomRenderDeb); _zoomRenderDeb = setTimeout(() => { renderVisible(); scheduleRulers(); scheduleGrid(); }, 110);
}
function zoomStep(d) { const c = curScale(); setZoom(Math.max(.1, Math.min(16, Math.round((c + d) * 100) / 100))); }
function promptZoom() {
  if (!pdfDoc) return; const cur = Math.round(curScale() * 100);
  const v = prompt('Zoom in % (z. B. 80) – leer = an Breite anpassen:', cur); if (v === null) return;
  const t = (v || '').trim(); if (t === '') { setZoom('auto'); return; }
  const n = parseFloat(t.replace(',', '.').replace('%', '')); if (n >= 10 && n <= 1600) setZoom(n / 100);
}
// Zum Mauszeiger zoomen: der Punkt unter der Maus bleibt an Ort und Stelle
function zoomToward(clientX, clientY, factor) {
  if (!pdfDoc) return; const host = $('#pages'), rect = host.getBoundingClientRect();
  const px = clientX - rect.left, py = clientY - rect.top, cur = curScale();
  const nz = Math.max(.25, Math.min(16, Math.round(cur * factor * 100) / 100)); if (nz === cur) return;
  const docX = host.scrollLeft + px, docY = host.scrollTop + py, f = nz / cur;
  setZoom(nz);                                  // Layout wird synchron neu gesetzt
  host.scrollLeft = docX * f - px; host.scrollTop = docY * f - py;
}
function zoomToClick(clientX, clientY) {   // beim Anklicken eines Bauteils sauber heranzoomen + auf den Klickpunkt zentrieren
  if (!pdfDoc) return; const host = $('#pages'), rect = host.getBoundingClientRect();
  const px = clientX - rect.left, py = clientY - rect.top, cur = curScale(), nz = Math.min(16, Math.max(cur, 3.4)), f = nz / cur;
  const docX = host.scrollLeft + px, docY = host.scrollTop + py;
  setZoom(nz); host.scrollLeft = docX * f - host.clientWidth / 2; host.scrollTop = docY * f - host.clientHeight / 2;
}
function zoomToReveal(el) {   // auf EINE Laibungsschicht zentriert heranzoomen, bis die Schicht-Dicke gut greifbar ist (bis 1600%)
  if (!pdfDoc || !el || !el.getBoundingClientRect) return; const host = $('#pages'), rect = host.getBoundingClientRect(), b = el.getBoundingClientRect();
  const cur = curScale(), smaller = Math.max(1, Math.min(b.width, b.height)), targetPx = 90;   // gewünschte Schicht-Dicke auf dem Bildschirm
  let nz = cur * (targetPx / smaller); nz = Math.max(cur, Math.min(16, Math.round(nz * 100) / 100)); const f = nz / cur;
  const ccx = b.left + b.width / 2 - rect.left, ccy = b.top + b.height / 2 - rect.top, docX = host.scrollLeft + ccx, docY = host.scrollTop + ccy;
  setZoom(nz); host.scrollLeft = docX * f - host.clientWidth / 2; host.scrollTop = docY * f - host.clientHeight / 2;
}

/* ---------- Annotationen rendern ---------- */
function getAnnos(n) { return annos[n] || (annos[n] = []); }
/* ---------- Ebenen / Stockwerke ---------- */
let layers = [{ id: 'base', name: 'Ebene 1', visible: true }], activeLayerId = 'base';
function layerById(id) { return layers.find(l => l.id === id); }
function layerVisible(a) { if (a.layer == null) return true; const l = layerById(a.layer); return l ? l.visible : true; }   // ohne Ebene → sichtbar (Alt-Daten)
/* ---------- Bauphasen: Bestand (schwarz) / Neu (rot) / Abbruch (gelb) ---------- */
const PHASE_COLORS = { bestand: '#1c242c', neu: '#d11a1a', abbruch: '#e0a800' };
let activePhase = null, phaseView = 'all';
function applyPhase(a, ph) { if (!a) return; if (ph && PHASE_COLORS[ph]) { a.phase = ph; if (a.color != null) a.color = PHASE_COLORS[ph]; if (a.hatch) a.hatch.color = PHASE_COLORS[ph]; } else delete a.phase; }
function phaseVisible(a) { if (phaseView === 'all' || !a.phase) return true; if (phaseView === 'end') return a.phase !== 'abbruch'; return a.phase === phaseView; }
function updatePhaseUI() { $$('#phSet button').forEach(b => b.classList.toggle('on', (b.dataset.ph || '') === (activePhase || ''))); $$('#phView button').forEach(b => b.classList.toggle('on', b.dataset.pv === phaseView)); const fp = $('#footPhase'); if (fp) fp.classList.toggle('on', !!activePhase || phaseView !== 'all'); }
function setActivePhase(ph) {
  activePhase = ph || null;
  const tgt = [];
  if (groupSel) { const arr = getAnnos(groupSel.num) || []; for (const id of groupSel.ids) { const a = arr.find(x => x.id === id); if (a) tgt.push(a); } }
  else if (sel) { const a = findAnno(sel.num, sel.id); if (a) tgt.push(a); }
  if (tgt.length) { pushUndo(); tgt.forEach(a => applyPhase(a, ph)); pageViews.forEach(drawAnnos); saveState(); }
  updatePhaseUI();
}
function setPhaseView(v) { phaseView = v; pageViews.forEach(drawAnnos); updatePhaseUI(); }
function pushAnno(n, a) { if (a && a.layer === undefined) a.layer = activeLayerId; if (a && activePhase && a.phase === undefined) applyPhase(a, activePhase); getAnnos(n).push(a); return a; }
function pageHasVisible(n) { return (annos[n] || []).some(a => layerVisible(a) && a.type !== 'crop' && a.type !== 'snip'); }   // hat die Seite sichtbare Anmerkungen?
let thumbFilter = false;
function applyThumbFilter() {
  const host = $('#thumbs'); if (!host) return;
  $$('.thumb', host).forEach(t => { t.style.display = (thumbFilter && !pageHasVisible(+t.dataset.n)) ? 'none' : ''; });
  $$('.thumb-ins', host).forEach(d => { d.style.display = thumbFilter ? 'none' : ''; });
  const b = $('#thumbFilterBtn'); if (b) { b.classList.toggle('on', thumbFilter); b.textContent = (thumbFilter ? '☑' : '☐') + ' Nur bezeichnete'; }
}
function newLayerId() { return 'l' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }
function renderLayerPanel() {
  const list = $('#lpList'); if (!list) return; list.innerHTML = '';
  const eyeOn = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>';
  const eyeOff = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3l18 18M10.6 10.7a3 3 0 0 0 4 4M9.9 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-3.2 3.9M6.1 6.2A18 18 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 3.1-.5"/></svg>';
  layers.forEach(l => {
    const row = document.createElement('div'); row.className = 'lp-row' + (l.id === activeLayerId ? ' active' : '') + (l.visible ? '' : ' hidden-layer');
    const eye = document.createElement('button'); eye.className = 'lp-eye'; eye.innerHTML = l.visible ? eyeOn : eyeOff; eye.title = l.visible ? 'Sichtbar – ausblenden' : 'Ausgeblendet – einblenden';
    eye.onclick = e => { e.stopPropagation(); l.visible = !l.visible; pageViews.forEach(drawAnnos); buildThumbs(); renderLayerPanel(); markDirty(); };
    const nm = document.createElement('span'); nm.className = 'lp-name'; nm.textContent = l.name; nm.title = l.name;
    nm.ondblclick = e => { e.stopPropagation(); const v = prompt('Ebene umbenennen:', l.name); if (v && v.trim()) { l.name = v.trim(); renderLayerPanel(); markDirty(); } };
    const ele = document.createElement('input'); ele.className = 'lp-ele'; ele.type = 'number'; ele.step = '0.1'; ele.title = 'Höhe / Lage dieser Ebene in m – für den 3D-Stapel (z. B. EG = 0, OG = 2.8)'; ele.value = l.elevation || 0;
    ele.onclick = e => e.stopPropagation(); ele.onchange = () => { l.elevation = parseFloat((ele.value || '').replace(',', '.')) || 0; markDirty(); };
    const del = document.createElement('button'); del.className = 'lp-del'; del.innerHTML = '✕'; del.title = 'Ebene löschen (Inhalt wandert auf die erste Ebene)';
    del.onclick = e => { e.stopPropagation(); if (layers.length <= 1) { toast('Mindestens eine Ebene muss bleiben.'); return; } const fb = layers.find(x => x.id !== l.id).id; for (const n in annos) for (const a of annos[n]) if (a.layer === l.id) a.layer = fb; layers = layers.filter(x => x.id !== l.id); if (activeLayerId === l.id) activeLayerId = fb; pageViews.forEach(drawAnnos); buildThumbs(); renderLayerPanel(); markDirty(); };
    row.append(eye, nm, ele, del);
    row.onclick = () => { activeLayerId = l.id; renderLayerPanel(); };
    list.appendChild(row);
  });
}
function toggleLayerPanel() { const p = $('#layerPanel'); if (!p) return; p.hidden = !p.hidden; if (!p.hidden) renderLayerPanel(); }
function toggleHdrPop(popId, btnId) {   // Header-Menü „Listen"/„Submit" auf-/zuklappen (fixed positioniert unter dem Knopf)
  const pop = document.getElementById(popId), btn = document.getElementById(btnId); if (!pop || !btn) return;
  document.querySelectorAll('.hdr-pop').forEach(p => { if (p !== pop) p.hidden = true; });
  if (pop.hidden) { pop.hidden = false; const r = btn.getBoundingClientRect(), w = pop.offsetWidth || 236; pop.style.top = (r.bottom + 6) + 'px'; pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8)) + 'px'; }
  else pop.hidden = true;
}
function duplicateLayerUp() {   // aktives Geschoss 1:1 nach oben kopieren (neue Ebene mit Höhenlage = aktuell + Geschosshöhe)
  const src = layerById(activeLayerId); if (!src) return;
  let wh = 0; for (const n in annos) for (const a of (annos[n] || [])) if (a.layer === activeLayerId && a.type === 'wall') wh = Math.max(wh, a.h3d || wallHeightM);
  if (!wh) wh = wallHeightM;
  const inp = prompt('Höhe der neuen Ebene (m)\nLage der Kopie = aktuelle Höhenlage + dieser Wert (z. B. 2.8 für ein Geschoss):', String(wh));
  if (inp == null) return;
  const h = parseFloat((inp || '').replace(',', '.')); if (!(h > 0)) { toast('Ungültige Höhe.'); return; }
  pushUndo();
  const newId = newLayerId(), elev = Math.round(((src.elevation || 0) + h) * 1000) / 1000;
  layers.push({ id: newId, name: 'Ebene ' + (layers.length + 1), visible: true, elevation: elev });
  const idMap = {};   // alte → neue ID (für Öffnung→Wand-Referenz)
  for (const n in annos) for (const a of (annos[n] || [])) if (a.layer === activeLayerId) idMap[a.id] = nextId++;
  let cnt = 0;
  for (const n in annos) {
    const add = [];
    for (const a of (annos[n] || [])) { if (a.layer !== activeLayerId) continue; const c = JSON.parse(JSON.stringify(a)); c.id = idMap[a.id]; c.layer = newId; if (c.wallId != null && idMap[c.wallId] != null) c.wallId = idMap[c.wallId]; add.push(c); cnt++; }
    for (const c of add) annos[n].push(c);
  }
  activeLayerId = newId;
  pageViews.forEach(drawAnnos); buildThumbs(); renderLayerPanel(); markDirty(); saveState();
  toast(cnt ? (cnt + ' Element(e) in neue Ebene kopiert · Höhe ' + elev.toFixed(2) + ' m') : 'Leere Ebene angelegt · Höhe ' + elev.toFixed(2) + ' m');
}
function findAnno(n, id) { return (annos[n] || []).find(a => a.id === id); }
let _wallUnionActive = false;
let _rafDraw = 0, _fastDraw = false, _fullDeb = 0, _secLive = false; const _rafPvs = new Set(), _fullPvs = new Set(), _secCache = {}, _secCacheSig = {};   // _fastDraw = Frame während Drag → teure Schnitte aus Cache; _secLive = Schnitt wird gerade IM Schnitt bearbeitet → live neu rechnen (kein Cache); _fullDeb = kurz nach dem Drag voller Redraw
function requestDraw(pv) {   // mehrere drawAnnos pro Frame (z. B. während Drag) zu EINEM Redraw bündeln → flüssiger; Schnitte folgen kurz danach automatisch
  _rafPvs.add(pv); _fullPvs.add(pv);
  if (!_rafDraw) _rafDraw = requestAnimationFrame(() => { _rafDraw = 0; _fastDraw = true; const ps = [..._rafPvs]; _rafPvs.clear(); for (const p of ps) { try { drawAnnos(p); } catch (_) { } } _fastDraw = false; });
  clearTimeout(_fullDeb); _fullDeb = setTimeout(() => { const ps = [..._fullPvs]; _fullPvs.clear(); for (const p of ps) { try { drawAnnos(p); } catch (_) { } } }, 150);   // sobald das Ziehen kurz pausiert/endet: voller Redraw → Schnitte aktualisieren sich selbst
}
function drawAnnos(pv) {
  const svg = pv.svg; svg.innerHTML = '';
  for (const a of getAnnos(pv.num)) if (a.type === 'opening') openingResolve(a, pv);   // Türen/Fenster der Wand folgen lassen
  _wallUnionActive = false;
  if (window.polygonClipping) { const walls = getAnnos(pv.num).filter(a => a.type === 'wall' && (wallSimple(a) || !(a.layers && a.layers.length)) && layerVisible(a) && phaseVisible(a)); if (walls.length) _wallUnionActive = drawWallUnion(svg, walls); }   // saubere Ecken via Flächen-Vereinigung (Schicht-Wände zeichnen sich selbst; einfach = schwarz)
  ensureJunctionClips(pv);   // prioritätsbasierte Eck-Verschneidung der Schicht-Wände vorbereiten (gecacht)
  for (const a of getAnnos(pv.num)) { if (!layerVisible(a) || !phaseVisible(a)) continue; drawOne(svg, a, pv); }
  _wallUnionActive = false;
  if (snapLayersOn && ['line', 'arrow', 'rect', 'oval', 'arc', 'curve', 'measure', 'dim', 'wall', 'slab', 'area', 'terrain'].includes(tool)) drawSnapNet(svg, pv);   // Schicht-Kanten-Hilfsnetz beim Zeichnen
  if (openPosOn && docScale) drawOpenPosTags(svg, pv);   // Positionsnummern F1/T1
  if (sel && sel.num === pv.num) drawSelection(svg, findAnno(pv.num, sel.id), pv);
  if (groupSel && groupSel.num === pv.num) drawGroupSel(svg, pv);
  updateAlignBar();
  updateSelBar();
  updatePlanBar();
}
function drawSnapNet(svg, pv) {   // Hilfsnetz: Schicht-Kanten aller Wände (zum Einrasten von Decke/Linie/Wand) als feine grüne Linien
  const arr = getAnnos(pv.num) || [];
  for (const a of arr) { if (a.type !== 'wall' || !a.layers || !a.layers.length || !layerVisible(a) || !phaseVisible(a)) continue;
    const wlb = wallLayerBands(a, arr);
    for (const b of wlb.bands) { const q = b.poly; for (const [u, v] of [[q[0], q[1]], [q[3], q[2]]]) svg.appendChild(svgEl('line', { x1: u[0], y1: u[1], x2: v[0], y2: v[1], stroke: '#1a9a4e', 'stroke-width': 0.6, 'stroke-dasharray': '3 3', opacity: 0.45, 'pointer-events': 'none', 'vector-effect': 'non-scaling-stroke' })); }
  }
}
function brandMarkGeom(W, H) {   // schräge Eck-Signatur unten rechts: zwei parallele Striche (Herbst-Olive + Gold), 45°
  const L = Math.min(W, H) * 0.3, s = 1 / Math.SQRT2, off = L * 0.135;   // n = (s,s) zur Ecke hin
  const A = [W - L, H], B = [W, H - L];
  return { oli: { x1: A[0], y1: A[1], x2: B[0], y2: B[1], w: Math.max(2, L * 0.085) }, gold: { x1: A[0] + s * off, y1: A[1] + s * off, x2: B[0] + s * off, y2: B[1] + s * off, w: Math.max(1.2, L * 0.05) }, oliC: '#6f7a39', goldC: '#caa44b' };
}
function drawBrandMark(pv) {
  const W = pv.pageW || 595, H = pv.pageH || 842, g = brandMarkGeom(W, H);
  const ln = (s, c) => pv.svg.appendChild(svgEl('line', { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, stroke: c, 'stroke-width': s.w, 'stroke-linecap': 'butt', opacity: 0.92, 'pointer-events': 'none', class: 'brandmark' }));
  ln(g.oli, g.oliC); ln(g.gold, g.goldC);
}
// Farbe (#hex oder rgb()) → #rrggbb für das Farbfeld
function toHex(s) { const c = parseColor(s), h = n => ('0' + Math.round(n * 255).toString(16)).slice(-2); return '#' + h(c.r) + h(c.g) + h(c.b); }
// Schwebende Leiste über der Auswahl positionieren/konfigurieren
function updateSelBar() {
  try { syncInspector(); } catch (_) { }   // Auswahl → Inspector rechts aktualisieren
  const bar = $('#selbar'); if (!bar) return;
  if (!sel || tool !== 'select') { bar.hidden = true; return; }
  const pv = pageViews.find(p => p.num === sel.num), a = pv && findAnno(pv.num, sel.id);
  if (!pv || !a || a.type === 'crop' || a.type === 'snip') { bar.hidden = true; return; }   // Crop/Ausschnitt haben eine eigene Leiste
  const hasColor = a.type !== 'sig' && a.type !== 'img' && a.type !== 'imgph', hasWidth = a.width != null, hasSize = (a.type === 'text' || a.type === 'edit');
  const hasFill = (a.type === 'rect' || a.type === 'oval' || a.type === 'path' || a.type === 'wall');
  $('#sbColorWrap').hidden = !hasColor; $('#sbWidths').hidden = !hasWidth; $('#sbSize').hidden = !hasSize;
  $('#sbFillWrap').hidden = !hasFill; $('#sbNoFill').hidden = !hasFill;
  $('#sbDash').hidden = !hasWidth || a.type === 'wall'; $('#sbDash').textContent = a.dash === 'dash' ? '- -' : a.dash === 'dot' ? '···' : '—';
  $('#sbHatch').hidden = !hasFill; $('#sbHatch').classList.toggle('on', !!(a.hatch && a.hatch.type));
  $('#sbWallDim').hidden = a.type !== 'wall'; $('#sbWallDim').classList.toggle('on', !!a.dim);
  const isOpen = a.type === 'opening'; $('#sbOpen').hidden = !isOpen;
  if (isOpen) { $$('#sbOpen [data-ok]').forEach(b => b.classList.toggle('on', a.kind === b.dataset.ok)); $('#sbOpenW').textContent = String(Math.round(ptsToCm(a.w))); $('#sbOpenFlip').style.display = a.kind === 'door' ? '' : 'none'; }
  $('#sbEdit').hidden = a.type !== 'edit'; $('#sbMove').hidden = a.type !== 'edit';
  $('#sbLine').hidden = !isLineType(a);
  if (hasColor) { $('#sbColor').value = toHex(a.color); $('#sbColorDot').style.background = a.color; }
  if (hasFill) { const f = (a.fill && a.fill !== 'none') ? a.fill : null; $('#sbFillDot').style.background = f || 'transparent'; $('#sbFill').value = toHex(f || a.color); }
  if (hasWidth) $$('#sbWidths button').forEach(b => b.classList.toggle('on', +b.dataset.w === a.width));
  if (hasSize) $('#sbSize').value = String(a.size);
  const isText = a.type === 'text';
  $('#sbTextFmt').hidden = !isText;
  if (isText) {
    $$('#sbTextFmt [data-al]').forEach(b => b.classList.toggle('on', (a.align || 'left') === b.dataset.al));
    $('#sbTbgNone').classList.toggle('on', !a.bg || a.bg === 'transparent');
    $('#sbTbgDot').style.background = (a.bg && a.bg !== 'transparent') ? a.bg : 'transparent';
    $('#sbTbg').value = (a.bg && a.bg[0] === '#') ? a.bg : '#ffffff';
    $('#sbTborder').classList.toggle('on', !!a.border);
  }
  bar.hidden = false;
  const b = bbox(a), ctm = pv.svg.getScreenCTM(); if (!ctm) { bar.hidden = true; return; }
  const sp = pv.svg.createSVGPoint(); sp.x = b.x + b.w / 2; sp.y = b.y; const tp = sp.matrixTransform(ctm);
  const host = $('#pages').getBoundingClientRect(), bw = bar.offsetWidth, bh = bar.offsetHeight;
  let x = tp.x - bw / 2, y = tp.y - bh - 12;
  x = Math.max(host.left + 6, Math.min(host.right - bw - 6, x));
  if (y < host.top + 4) { sp.y = b.y + b.h; const bp = sp.matrixTransform(ctm); y = bp.y + 12; }   // kein Platz oben → unter die Auswahl
  bar.style.left = x + 'px'; bar.style.top = y + 'px';
}
/* ---------- Schraffuren (SIA-artig: Wand/Material/Detail) ---------- */
const HATCH_DEF = {   // Material: color = Striche/Umrandung (dunkel), fill = ganze Wand (hell)
  backstein: { label: 'Backstein (orange)', color: '#b85c1e', fill: '#f5ddc8' },
  kalksand: { label: 'Kalksandstein (grau)', color: '#6b7178', fill: '#e1e4e7' },
  beton: { label: 'Beton (grün, gekreuzt)', color: '#2f7d4f', fill: '#dcecdf' },
  beton_vorfab: { label: 'Beton vorfabriziert / Element', color: '#2f7d4f', fill: '#dcecdf' },
  daemm_holz: { label: 'Dämmung Holzwolle (braun)', color: '#6b4423', fill: '#e6d6c2' },
  daemm_wolle: { label: 'Dämmung Glas-/Steinwolle (gelb)', color: '#a07b00', fill: '#f7ecb3' },
  daemm_eps: { label: 'Dämmung EPS (weiss)', color: '#9097a0', fill: '#eef0f2' },
  daemm_xps: { label: 'Dämmung XPS (violett)', color: '#6f3f9e', fill: '#e9def5' },
  gips: { label: 'Gips (Punkte)', color: '#7d828a', fill: '#f3f4f5' },
  kies: { label: 'Kies', color: '#6b6253', fill: '#e7e2d8' },
  erdreich: { label: 'Erdreich', color: '#5a3f22', fill: '#e5d8c6' },
  holz: { label: 'Holz', color: '#7a5126', fill: '#eedcc8' },
  diag: { label: 'Diagonal', color: null, fill: null }, cross: { label: 'Kreuz', color: null, fill: null }
};
const INSUL_TYPES = ['daemm_holz', 'daemm_wolle', 'daemm_eps', 'daemm_xps'];
function applyMaterial(a, t) {   // Material auf Wand/Form anwenden: Strichfarbe (dunkel) + Wandfüllung (hell)
  if (!t || t === 'none') { a.hatch = null; if (a.type === 'wall') { a.fill = '#ffffff'; a.color = '#1c242c'; } return; }   // zurück auf weisse Wand, schwarzer Rand
  const d = HATCH_DEF[t] || {};
  a.hatch = { type: t, scale: (a.hatch && a.hatch.scale) || lastHatchScale, w: 0.8, color: d.color || a.color };
  if (d.color) a.color = d.color;
  if (d.fill) a.fill = d.fill;
}
/* ---------- Mehrschichtige Wandaufbäue ---------- */
const WALL_MATS = {   // Schicht-Material: Füllung (hell), Schraffur-Typ (oder null) + Strichfarbe (dunkel)
  putz: { label: 'Putz / Verputz', fill: '#ededed', hatch: null, color: '#9a9a9a' },
  mauerwerk: { label: 'Mauerwerk', fill: HATCH_DEF.backstein.fill, hatch: 'backstein', color: HATCH_DEF.backstein.color },
  beton: { label: 'Beton', fill: HATCH_DEF.beton.fill, hatch: 'beton', color: HATCH_DEF.beton.color },
  eps: { label: 'Dämmung EPS', fill: HATCH_DEF.daemm_eps.fill, hatch: 'daemm_eps', color: HATCH_DEF.daemm_eps.color },
  glaswolle: { label: 'Dämmung Glas-/Steinwolle', fill: HATCH_DEF.daemm_wolle.fill, hatch: 'daemm_wolle', color: HATCH_DEF.daemm_wolle.color },
  luft: { label: 'Hinterlüftung', fill: '#ffffff', hatch: null, color: '#c2c2c2' },
  gips: { label: 'Gipsplatte', fill: HATCH_DEF.gips.fill, hatch: 'gips', color: HATCH_DEF.gips.color },
  holz: { label: 'Holzschalung', fill: HATCH_DEF.holz.fill, hatch: 'holz', color: HATCH_DEF.holz.color },
  konter: { label: 'Konterlattung', fill: HATCH_DEF.holz.fill, hatch: 'holz', color: HATCH_DEF.holz.color },
  belag: { label: 'Bodenbelag', fill: '#cdb79e', hatch: null, color: '#7a5126' },
  estrich: { label: 'Unterlagsboden / Estrich', fill: '#e7e7e3', hatch: null, color: '#9a9a9a' },
  trittschall: { label: 'Trittschalldämmung', fill: HATCH_DEF.daemm_eps.fill, hatch: 'daemm_eps', color: '#b59a4d' },
  xps: { label: 'Dämmung XPS', fill: HATCH_DEF.daemm_xps.fill, hatch: 'daemm_xps', color: HATCH_DEF.daemm_xps.color },
  kies: { label: 'Kies / Schotter', fill: '#e9e4d6', hatch: null, color: '#9a8e72' },
  schalung: { label: 'Holzschalung (Latten)', fill: '#e7cfa8', hatch: null, color: '#7a5126', boards: true },
  windpapier: { label: 'Windpapier (schwarz)', fill: '#262626', hatch: null, color: '#111111', membrane: true },
  dampfbremse: { label: 'Dampfbremse (schwarz)', fill: '#262626', hatch: null, color: '#111111', membrane: true },
  osb: { label: 'OSB-Platte', fill: '#e3c489', hatch: null, color: '#9c7a3e' },
  mdf: { label: 'MDF-/Holzfaserplatte', fill: '#d7b483', hatch: null, color: '#8a6a3a' },
  staender: { label: 'Holzständer + Dämmung', fill: HATCH_DEF.daemm_wolle.fill, hatch: 'daemm_wolle', color: HATCH_DEF.daemm_wolle.color },
  klinker: { label: 'Backstein / Vormauerung', fill: HATCH_DEF.backstein.fill, hatch: 'backstein', color: HATCH_DEF.backstein.color },
  dreischicht: { label: 'Dreischichtplatte', fill: '#e8d3ad', hatch: null, color: '#9c7a3e' },
  stahl: { label: 'Stahlträger', fill: '#c8ccd2', hatch: null, color: '#3a3f45' }
};
const MAT_PRIO = {   // Verschneidungs-Priorität: höher = läuft durch, niedriger endet daran (Dämmung > Beton > Mauerwerk > Platten > Luft > Putz)
  eps: 100, xps: 100, glaswolle: 100, daemm_eps: 100, daemm_wolle: 100, daemm_xps: 100, staender: 95, trittschall: 90,
  beton: 80, mauerwerk: 70, kalksand: 70, klinker: 66,
  dreischicht: 55, osb: 52, mdf: 52, gips: 50, schalung: 46, holz: 46,
  luft: 40, konter: 40, belag: 32, estrich: 30, stahl: 78, kies: 20, erdreich: 20,
  putz: 10, gips_deck: 10
};
function matPrio(mat) { return MAT_PRIO[mat] != null ? MAT_PRIO[mat] : 50; }   // Standard-Priorität, wenn Material unbekannt
function bandBoards(band, boardWpt, gapPt) {   // Holzschalung als einzelne Latten (Breite + Abstand) entlang der Schicht → Lücken zeigen das Windpapier dahinter
  const p0 = band.poly[0], p1 = band.poly[1], p2 = band.poly[2], p3 = band.poly[3], lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) || 1, step = Math.max(2, boardWpt + gapPt), quads = [];
  for (let d = 0; d < L - 0.5; d += step) { const t0 = d / L, t1 = Math.min(1, (d + boardWpt) / L); quads.push([lerp(p0, p1, t0), lerp(p0, p1, t1), lerp(p3, p2, t1), lerp(p3, p2, t0)]); }
  return quads;
}
const WALL_PRESETS = [   // Schichten innen → aussen [Material, cm]
  { name: 'Mauerwerk + EPS', layers: [['putz', 1.5], ['mauerwerk', 15], ['eps', 22], ['putz', 2.5]] },
  { name: 'Beton + EPS', layers: [['putz', 1.5], ['beton', 20], ['eps', 22], ['putz', 2.5]] },
  { name: 'Hinterlüftet · Gipsplatte', layers: [['putz', 1.5], ['mauerwerk', 15], ['glaswolle', 22], ['luft', 4], ['gips', 1.5], ['putz', 0.5]] },
  { name: 'Hinterlüftet · Holz horizontal', layers: [['putz', 1.5], ['mauerwerk', 15], ['glaswolle', 22], ['luft', 4], ['holz', 2.2]] },
  { name: 'Hinterlüftet · Holz vertikal', layers: [['putz', 1.5], ['mauerwerk', 15], ['glaswolle', 22], ['luft', 4], ['konter', 3], ['holz', 2.2]] },
  { name: 'Hinterlüftet · Latten-Schalung + Windpapier', layers: [['putz', 1.5], ['mauerwerk', 15], ['glaswolle', 22], ['windpapier', 0.1], ['luft', 4], ['schalung', 2.4]] },
  { name: 'Holzbau (Ständer + Schalung)', layers: [['putz', 0.5], ['gips', 1.25], ['konter', 4], ['osb', 2], ['staender', 16], ['mdf', 6], ['luft', 4], ['schalung', 2.2]] },   // innen Deckputz/Gips/Installationsrost/OSB, Ständer 16, aussen MDF/Luft/Schalung
  { name: 'Zweischalenmauerwerk (verputzt)', layers: [['putz', 1.5], ['mauerwerk', 17.5], ['glaswolle', 20], ['luft', 4], ['klinker', 12.5], ['putz', 1.5]] }   // Tragschale 17.5 + Glaswolle 20 + Hinterlüftung + Vormauerung 12.5, beidseitig Putz
];
const SLAB_PRESETS = [   // Decken-/Bodenaufbau OBEN → UNTEN [Material, cm]
  { name: 'Geschossdecke (Unterlagsboden)', layers: [['belag', 1], ['estrich', 7], ['trittschall', 3], ['beton', 24]] },
  { name: 'Bodenplatte auf Erdreich', layers: [['belag', 1], ['estrich', 8], ['xps', 12], ['beton', 25]] },
  { name: 'Flachdach (Warmdach)', layers: [['kies', 5], ['eps', 20], ['beton', 24]] },
  { name: 'Holzbalkendecke', layers: [['belag', 1], ['estrich', 6], ['trittschall', 3], ['holz', 24]] },
  { name: 'Decke ohne Aufbau (Beton)', layers: [['beton', 24]] },
  { name: 'Stahlbeton gedämmt (Standard)', layers: [['belag', 1.5], ['estrich', 6], ['trittschall', 2], ['eps', 2], ['beton', 25], ['putz', 1.5]] },   // 15mm Deckschicht/60 Unterlagsboden/20 Trittschall/20 Wärmedämmung/25cm Stahlbeton/15 Putz
  { name: 'Holzbau Dreischicht (gedämmt)', layers: [['belag', 1.5], ['estrich', 6], ['trittschall', 2], ['eps', 2], ['dreischicht', 2.5], ['glaswolle', 20], ['dreischicht', 1.5], ['konter', 4], ['gips', 1.25], ['putz', 0.5]] }   // oben Boden+Dämmung, 25 Dreischicht, 20cm Glaswolle, unten 15 Dreischicht/40 Installationsrost/12.5 Gips/5 Deckputz
];
function applySlabBuildup(a, layersData) {   // layersData = [[mat, cm, einzugCm?], …] OBEN→UNTEN; t in Metern (Decke rechnet vertikal in m)
  if (!layersData || !layersData.length) { delete a.layers; return; }
  const topBefore = (a.base != null ? a.base : 0) + (a.thick || 0.2);   // Oberkante festhalten (liegt auf Geschosshöhe)
  a.layers = layersData.map(([mat, cm, inset]) => { const l = { mat, t: cm / 100 }; if (inset) l.inset = (+inset) / 100; return l; });   // inset = Einzug je Schicht beidseitig (cm→m) – z.B. Estrich stoppt vor der Wand
  a.thick = a.layers.reduce((s, l) => s + l.t, 0);
  if (a.base != null) a.base = Math.round((topBefore - a.thick) * 1000) / 1000;   // Decken-OBERKANTE bleibt auf Geschosshöhe (Unterkante wandert mit der Dicke)
}
function slabLayerBands(a) {   // → [{mat,t,y0,y1,inset}] Höhen über der Decken-Unterkante (0..thick); Schichten OBEN→UNTEN
  const layers = a && a.layers; if (!layers || !layers.length) return null;
  let yTop = layers.reduce((s, l) => s + l.t, 0); const out = [];
  for (const l of layers) { const y1 = yTop, y0 = yTop - l.t; out.push({ mat: l.mat, t: l.t, y0, y1, inset: l.inset || 0 }); yTop = y0; }
  return out;
}
const SUB_W = { lattung: 6, staender: 5, schraube: 1.2 };   // Breite/Markierung der UK-Querschnitte (cm)
function applyWallBuildup(a, layersData, spacingCm) {   // layersData = [[mat, cm, subTyp?], …] innen→aussen · spacingCm = Achsabstand UK
  if (!layersData || !layersData.length) { delete a.layers; return; }
  const sp = cmToPts(spacingCm || 60), old = a.layers || null;
  a.layers = layersData.map(([mat, cm, sub, top, bot, lowMat, lowH, boardW, boardGap], i) => { const l = { mat, t: cmToPts(cm) }; if (sub) l.sub = { type: sub, spacing: sp, w: cmToPts(SUB_W[sub] || 2) }; if (top) l.top = (+top) / 100; if (bot) l.bot = (+bot) / 100; if (lowMat && (+lowH) > 0) { l.lowMat = lowMat; l.lowH = (+lowH) / 100; } if (mat === 'schalung') { l.boardW = +boardW || 4; l.boardGap = boardGap != null ? +boardGap : 2; } if (old && old[i] && old[i].mat === mat) { if (old[i].ext1) l.ext1 = old[i].ext1; if (old[i].ext2) l.ext2 = old[i].ext2; } return l; });   // top/bot = Über-/Unterlänge; lowMat/lowH = Sockelzone; boardW/boardGap = Latten; ext1/ext2 (gezogene Länge) bleiben erhalten
  a.thick = a.layers.reduce((s, l) => s + l.t, 0);
  a.hatch = null; a.fill = '#ffffff'; a.color = '#1c242c';   // Aufbau übernimmt die Darstellung
}
function wallOpeningsAlong(a, arr) {   // [t0,t1] in pt entlang der Achse je Öffnung auf dieser Wand (für UK-Unterbruch)
  const res = [], L = Math.hypot(a.x2 - a.x1, a.y2 - a.y1) || 1;
  for (const o of arr) if (o.type === 'opening' && o.wallId === a.id) { const c = o.t * L, hw = (o.w || 0) / 2; res.push([c - hw, c + hw]); }
  return res;
}
function drawLayerSub(svg, a, band, arr) {   // Unterkonstruktion (Schrauben/Lattung/Ständer) im Achsabstand, an Öffnungen unterbrochen
  const sub = band.sub; if (!sub) return;
  const dx = a.x2 - a.x1, dy = a.y2 - a.y1, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux, T = a.thick || wallThickPts(), o = wallSideOffsets(a), eB = o[1] * T, eA = o[0] * T;
  const eFrom = eB + (eA - eB) * band.f0, eTo = eB + (eA - eB) * band.f1, spacing = sub.spacing || cmToPts(60), skips = wallOpeningsAlong(a, arr);
  const inSkip = s => skips.some(([t0, t1]) => s > t0 - 2 && s < t1 + 2);
  const dark = '#3a3f45', metal = '#6b7178', wood = WALL_MATS.holz.color, woodF = WALL_MATS.holz.fill, NS = 'vector-effect';
  for (let s = spacing / 2; s <= L; s += spacing) {
    if (inSkip(s)) continue;
    const px = a.x1 + ux * s, py = a.y1 + uy * s, A = [px + nx * eFrom, py + ny * eFrom], B = [px + nx * eTo, py + ny * eTo];
    if (sub.type === 'schraube') {
      svg.appendChild(svgEl('line', { x1: A[0], y1: A[1], x2: B[0], y2: B[1], stroke: dark, 'stroke-width': 1.2, [NS]: 'non-scaling-stroke' }));
      const hw = cmToPts(1.4); svg.appendChild(svgEl('line', { x1: B[0] - ux * hw, y1: B[1] - uy * hw, x2: B[0] + ux * hw, y2: B[1] + uy * hw, stroke: dark, 'stroke-width': 1.4, [NS]: 'non-scaling-stroke' }));
    } else {
      const w = (sub.w || cmToPts(5)) / 2, c1 = [A[0] - ux * w, A[1] - uy * w], c2 = [B[0] - ux * w, B[1] - uy * w], c3 = [B[0] + ux * w, B[1] + uy * w], c4 = [A[0] + ux * w, A[1] + uy * w], pts = [c1, c2, c3, c4].map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' ');
      if (sub.type === 'lattung') { svg.appendChild(svgEl('polygon', { points: pts, fill: woodF, stroke: wood, 'stroke-width': 0.8, [NS]: 'non-scaling-stroke' })); svg.appendChild(svgEl('line', { x1: c1[0], y1: c1[1], x2: c3[0], y2: c3[1], stroke: wood, 'stroke-width': 0.6, [NS]: 'non-scaling-stroke' })); svg.appendChild(svgEl('line', { x1: c2[0], y1: c2[1], x2: c4[0], y2: c4[1], stroke: wood, 'stroke-width': 0.6, [NS]: 'non-scaling-stroke' })); }
      else svg.appendChild(svgEl('polygon', { points: pts, fill: 'none', stroke: metal, 'stroke-width': 1.3, [NS]: 'non-scaling-stroke' }));   // Metallständer
    }
  }
}
let lastHatchScale = 7;   // gemerkte Schraffur-Dichte (Abstand in pt)
function wallLayerBands(a, arr) {   // jede Schicht als (gehrungsfolgendes) Band-Polygon zwischen den beiden Wandflächen
  const poly = wallPoly(a, arr), c1A = poly[0], c2A = poly[1], c2B = poly[2], c1B = poly[3];
  const lp = (p, q, f) => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
  const total = a.layers.reduce((s, l) => s + l.t, 0) || 1, bands = []; let cum = 0;
  const dxw = a.x2 - a.x1, dyw = a.y2 - a.y1, Lw = Math.hypot(dxw, dyw) || 1, uxw = dxw / Lw, uyw = dyw / Lw;   // Wandachse (für Schicht-Eigenlänge ext1/ext2 in pt)
  for (const L of a.layers) {
    const f0 = cum / total, f1 = (cum + L.t) / total, e1 = L.ext1 || 0, e2 = L.ext2 || 0;
    let p0 = lp(c1B, c1A, f1), p1 = lp(c2B, c2A, f1), p2 = lp(c2B, c2A, f0), p3 = lp(c1B, c1A, f0);
    if (e1) { p0 = [p0[0] - uxw * e1, p0[1] - uyw * e1]; p3 = [p3[0] - uxw * e1, p3[1] - uyw * e1]; }   // Schicht an Ende 1 (bei x1) verlängern/kürzen
    if (e2) { p1 = [p1[0] + uxw * e2, p1[1] + uyw * e2]; p2 = [p2[0] + uxw * e2, p2[1] + uyw * e2]; }   // Ende 2 (bei x2)
    bands.push({ mat: L.mat, f0, f1, poly: [p0, p1, p2, p3] }); cum += L.t;
  }
  return { bands, c1A, c2A, c2B, c1B };
}
const _hcCache = new Map();   // Waben-Segmente cachen (teuer; deterministisch über bbox+R) – spart Rechenzeit bei jedem Redraw für unveränderte Wände
function honeycombSegs(x0, y0, x1, y1, R) {   // Waben-/Hexagon-Schraffur (EPS/XPS): Liniensegmente über das Rechteck, Ursprung 0,0 → fluchtet über Bauteile
  const key = Math.round(x0) + ',' + Math.round(y0) + ',' + Math.round(x1) + ',' + Math.round(y1) + ',' + R.toFixed(2);
  const cached = _hcCache.get(key); if (cached) return cached;
  const segs = [], w = Math.sqrt(3) * R, vs = 1.5 * R, fl = (v, s) => Math.floor(v / s) * s;
  let row = Math.round(fl(y0 - R, vs) / vs);
  for (let cy = fl(y0 - R, vs); cy <= y1 + R; cy += vs, row++) {
    const xoff = ((row % 2) + 2) % 2 ? w / 2 : 0;
    for (let cx = fl(x0 - w, w) + xoff; cx <= x1 + w; cx += w) {
      const v = [];
      for (let k = 0; k < 6; k++) { const ang = Math.PI / 180 * (60 * k - 90); v.push([cx + R * Math.cos(ang), cy + R * Math.sin(ang)]); }
      for (let k = 0; k < 3; k++) segs.push([v[k][0], v[k][1], v[(k + 1) % 6][0], v[(k + 1) % 6][1]]);   // nur 3 Kanten je Wabe → Nachbarn ergänzen den Rest (keine Doppelung)
    }
  }
  if (_hcCache.size > 400) _hcCache.clear(); _hcCache.set(key, segs); return segs;
}
let _hlClip = 0;   // eindeutige clipPath-IDs (sonst überschreiben sich gesplittete Bänder → fehlende Schraffur)
function layerHatch(svg, a, band) {   // Schraffur einer einzelnen Schicht, auf das Band geclippt
  const m = WALL_MATS[band.mat]; if (!m || !m.hatch) return;
  const cid = 'hl' + (_hlClip++), cp = svgEl('clipPath', { id: cid }); cp.appendChild(svgEl('polygon', { points: band.poly.map(p => p[0] + ',' + p[1]).join(' ') }));
  const defs = svgEl('defs'); defs.appendChild(cp); svg.appendChild(defs);
  const hg = svgEl('g', { 'clip-path': `url(#${cid})`, 'pointer-events': 'none' }), col = m.color, S = (a.hatch && a.hatch.scale) || lastHatchScale; let lines = [];
  if (m.hatch === 'daemm_eps' || m.hatch === 'daemm_xps') {   // EPS/XPS: Waben (Hexagon)
    const xs = band.poly.map(p => p[0]), ys = band.poly.map(p => p[1]); lines = honeycombSegs(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), Math.max(7, S * 1.5));
  } else if (m.hatch === 'daemm_wolle' || INSUL_TYPES.includes(m.hatch)) {   // übrige Dämmung: Striche exakt 90° zur Wandachse (je Wand für sich), aufs Band geclippt
    const dx = a.x2 - a.x1, dy = a.y2 - a.y1, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux, T = a.thick || wallThickPts(), o = wallSideOffsets(a), eB = o[1] * T, eA = o[0] * T;
    const eFrom = eB + (eA - eB) * band.f0, eTo = eB + (eA - eB) * band.f1, step = Math.max(4, S * 1.3);
    for (let s = 0; s <= L; s += step) { const px = a.x1 + ux * s, py = a.y1 + uy * s; lines.push([px + nx * eFrom, py + ny * eFrom, px + nx * eTo, py + ny * eTo]); }
  } else {
    const xs = band.poly.map(p => p[0]), ys = band.poly.map(p => p[1]), fake = { type: 'rect', x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), hatch: { type: m.hatch, scale: S } }, g = hatchGeom(fake);
    lines = g.lines; for (const D of g.dots) hg.appendChild(svgEl('circle', { cx: D[0], cy: D[1], r: D[2] != null ? D[2] : S * 0.16, fill: col }));
  }
  if (lines.length) { let d = ''; for (const L of lines) d += 'M' + L[0].toFixed(1) + ' ' + L[1].toFixed(1) + 'L' + L[2].toFixed(1) + ' ' + L[3].toFixed(1); hg.appendChild(svgEl('path', { d, stroke: col, 'stroke-width': 0.8, fill: 'none', 'vector-effect': 'non-scaling-stroke' })); }   // alle Schraffur-Striche als EIN Pfad (statt vieler <line> → viel weniger DOM)
  svg.appendChild(hg);
}
let _junctionClips = {}, _junctionSig = '';   // pro Wand/Schicht die abzuziehenden (höher priorisierten) Fremd-Bänder → prioritätsbasierte Eck-Verschneidung
function _polyBB(poly) { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const p of poly) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; } return [x0, y0, x1, y1]; }
function _bbOver(a, b) { return a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3]; }
function computeJunctionClips(arr, walls) {   // je Band: Liste der zu subtrahierenden Fremd-Bänder mit STRIKT höherer Priorität (überlappend) → läuft durch / endet daran
  if (!window.polygonClipping) return {};
  const all = [];
  for (const w of walls) { const wlb = wallLayerBands(w, arr); wlb.bands.forEach((b, i) => all.push({ wid: w.id, li: i, prio: matPrio(b.mat), poly: b.poly, bb: _polyBB(b.poly) })); }
  const res = {};
  for (const band of all) { const subs = [];
    for (const o of all) { if (o.wid === band.wid || o.prio <= band.prio || !_bbOver(band.bb, o.bb)) continue; subs.push([o.poly.map(p => [p[0], p[1]])]); }
    if (subs.length) (res[band.wid] = res[band.wid] || {})[band.li] = subs;
  }
  return res;
}
function ensureJunctionClips(pv) {
  const arr = getAnnos(pv.num) || [], walls = arr.filter(a => a.type === 'wall' && a.layers && a.layers.length && layerVisible(a) && phaseVisible(a));
  let sig = ''; for (const w of walls) sig += w.id + ':' + w.x1.toFixed(1) + ',' + w.y1.toFixed(1) + ',' + w.x2.toFixed(1) + ',' + w.y2.toFixed(1) + ',' + (w.thick || 0).toFixed(1) + ',' + (w.just || '') + ',' + w.layers.map(l => l.mat + (l.t || 0).toFixed(1) + (l.ext1 || 0) + (l.ext2 || 0)).join('') + ';';
  if (sig === _junctionSig) return; _junctionSig = sig; _junctionClips = computeJunctionClips(arr, walls);
}
function drawLayeredWall(svg, a, arr) {
  const { bands } = wallLayerBands(a, arr);   // jede Schicht: Füllung + dünne Umrandung in der Materialfarbe (kein schwarzer Gesamtrahmen)
  const ops = (arr || []).filter(o => o.type === 'opening' && o.wallId === a.id && o.x != null);   // Öffnungen boolesch aus den Schichten ausschneiden
  const cuts = (window.polygonClipping && ops.length) ? ops.map(o => [openingCutPoly(o).map(p => [p[0], p[1]])]) : null;
  const jc = _junctionClips[a.id] || {};   // prioritätsbasierte Eck-Verschneidung: höher priorisierte Fremd-Bänder abziehen
  const clipBand = (poly, i) => { const subs = []; if (cuts) for (const c of cuts) subs.push(c); if (jc[i]) for (const c of jc[i]) subs.push(c); if (!subs.length || !window.polygonClipping) return [poly]; try { const r = polygonClipping.difference([poly.map(p => [p[0], p[1]])], ...subs); return r.length ? r.map(rg => rg[0]) : []; } catch (_) { return [poly]; } };
  bands.forEach((b, i) => {
    const m = WALL_MATS[b.mat] || {}, lay = a.layers[i] || {};
    if (m.boards) { const bw = cmToPts(lay.boardW || 4), gp = cmToPts(lay.boardGap != null ? lay.boardGap : 2); for (const q of bandBoards(b, bw, gp)) svg.appendChild(svgEl('polygon', { points: q.map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' '), fill: m.fill || '#e7cfa8', stroke: m.color || '#7a5126', 'stroke-width': 0.7, 'vector-effect': 'non-scaling-stroke' })); return; }   // Latten einzeln (Lücken = Windpapier dahinter)
    for (const poly of clipBand(b.poly, i)) { svg.appendChild(svgEl('polygon', { points: poly.map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' '), fill: m.fill || '#ffffff', stroke: m.color || '#9a9a9a', 'stroke-width': 0.7, 'stroke-linejoin': 'miter', 'vector-effect': 'non-scaling-stroke' })); layerHatch(svg, a, { ...b, poly }); }
  });
  a.layers.forEach((l, i) => { if (l.sub && bands[i]) { bands[i].sub = l.sub; drawLayerSub(svg, a, bands[i], arr); } });   // Unterkonstruktion über die Schichten
}
function wallClipPoly(a) {   // einfaches, nicht-gehrtes Wandrechteck (immer simpel → sicherer Schraffur-Clip)
  const dx = a.x2 - a.x1, dy = a.y2 - a.y1, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L, T = a.thick || wallThickPts(), o = wallSideOffsets(a), oA = o[0], oB = o[1];
  return [[a.x1 + nx * T * oA, a.y1 + ny * T * oA], [a.x2 + nx * T * oA, a.y2 + ny * T * oA], [a.x2 + nx * T * oB, a.y2 + ny * T * oB], [a.x1 + nx * T * oB, a.y1 + ny * T * oB]];
}
function shapeOutline(a, arr) {
  if (a.type === 'wall') return svgEl('polygon', { points: wallClipPoly(a).map(p => p[0] + ',' + p[1]).join(' ') });
  if (a.type === 'rect') return svgEl('rect', { x: Math.min(a.x, a.x + a.w), y: Math.min(a.y, a.y + a.h), width: Math.abs(a.w), height: Math.abs(a.h) });
  if (a.type === 'oval') return svgEl('ellipse', { cx: a.x + a.w / 2, cy: a.y + a.h / 2, rx: Math.abs(a.w / 2), ry: Math.abs(a.h / 2) });
  return svgEl('path', { d: pathD(a) });
}
function insulWallStrokes(a, S, lines) {   // Dämmung: kurze Striche quer zur Wand (über die Dicke)
  const dx = a.x2 - a.x1, dy = a.y2 - a.y1, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux, T = a.thick || wallThickPts(), o = wallSideOffsets(a), eA = o[0] * T, eB = o[1] * T, step = Math.max(4, S * 1.3);
  for (let s = 0; s <= L; s += step) { const px = a.x1 + ux * s, py = a.y1 + uy * s; lines.push([px + nx * eA, py + ny * eA, px + nx * eB, py + ny * eB]); }
}
function betonElemWall(a, S, lines) {   // Beton-Element: Gitter 90° zur Wand (parallel + quer)
  const dx = a.x2 - a.x1, dy = a.y2 - a.y1, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux, T = a.thick || wallThickPts(), o = wallSideOffsets(a), eA = o[0] * T, eB = o[1] * T, step = Math.max(5, S * 1.6);
  for (let s = 0; s <= L; s += step) { const px = a.x1 + ux * s, py = a.y1 + uy * s; lines.push([px + nx * eA, py + ny * eA, px + nx * eB, py + ny * eB]); }   // quer
  for (let e = eB; e <= eA; e += step) { lines.push([a.x1 + nx * e, a.y1 + ny * e, a.x2 + nx * e, a.y2 + ny * e]); }   // parallel zur Wand
}
function hatchGeom(a) {
  const b = bbox(a); const lines = [], dots = []; if (b.w <= 0 || b.h <= 0) return { lines, dots };
  const S = a.hatch.scale || 7, t = a.hatch.type, x0 = b.x - 1, y0 = b.y - 1, x1 = b.x + b.w + 1, y1 = b.y + b.h + 1, ext = b.h + 2;
  const fl = (v, s) => Math.floor(v / s) * s;   // auf globales Raster (Ursprung 0,0) einrasten → Schraffur fluchtet über Formen/Wände hinweg
  const diag = (slope, step) => { const SS = step || S; if (slope > 0) { for (let c = fl(y0 - x1, SS); c <= (y1 - x0); c += SS) lines.push([x0 - ext, x0 - ext + c, x1 + ext, x1 + ext + c]); } else { for (let c = fl(y0 + x0, SS); c <= (y1 + x1); c += SS) lines.push([x0 - ext, -(x0 - ext) + c, x1 + ext, -(x1 + ext) + c]); } };
  if (t === 'backstein' || t === 'diag') diag(1);
  else if (t === 'kalksand') diag(-1);
  else if (t === 'cross' || t === 'beton') { diag(1); diag(-1); }   // Beton: diagonales Kreuz
  else if (t === 'beton_vorfab') { if (a.type === 'wall') betonElemWall(a, S, lines); else { for (let y = fl(y0, S * 1.6); y <= y1; y += S * 1.6) lines.push([x0, y, x1, y]); for (let x = fl(x0, S * 1.6); x <= x1; x += S * 1.6) lines.push([x, y0, x, y1]); } }   // Element: orthogonales Gitter
  else if (t === 'daemm_eps' || t === 'daemm_xps') { for (const sg of honeycombSegs(x0, y0, x1, y1, Math.max(7, S * 1.5))) lines.push(sg); }   // EPS/XPS: Waben (dicht)
  else if (INSUL_TYPES.includes(t) || t === 'insul') { if (a.type === 'wall') insulWallStrokes(a, S, lines); else { const g = S * 1.4; for (let y = fl(y0, g); y <= y1; y += g) lines.push([x0, y, x1, y]); } }
  else if (t === 'erdreich') diag(-1, S * 0.75);
  else if (t === 'holz' || t === 'wood') { const sp = Math.max(3, S * 0.55), gap = S * 2, period = 2 * sp + gap; for (let base = fl(y0 - x1, period); base <= (y1 - x0); base += period) for (let k = 0; k < 3; k++) { const c = base + k * sp; lines.push([x0 - ext, x0 - ext + c, x1 + ext, x1 + ext + c]); } }
  else if (t === 'gips') { const g = S * 1.7; for (let y = fl(y0, g); y <= y1; y += g) { const off = (Math.round(y / g) % 2) ? g / 2 : 0; for (let x = fl(x0 - off, g) + off; x <= x1; x += g) dots.push([x, y, S * 0.14]); } }
  else if (t === 'kies') { const g = S * 1.9; let i = 0; for (let y = fl(y0, g); y <= y1; y += g) for (let x = fl(x0, g); x <= x1; x += g) { i++; const jx = ((i * 37) % 100 / 100 - 0.5) * g, jy = ((i * 53) % 100 / 100 - 0.5) * g, r = S * (0.1 + ((i * 29) % 5) * 0.035); dots.push([x + jx, y + jy, r]); } }
  else if (t === 'dots') { const g = S * 1.7; for (let y = fl(y0, g); y <= y1; y += g) { const off = (Math.round(y / g) % 2) ? g / 2 : 0; for (let x = fl(x0 - off, g) + off; x <= x1; x += g) dots.push([x, y, S * 0.16]); } }
  else if (t === 'brick') { const bh = S * 1.6, bw = S * 3.2; for (let y = fl(y0, bh); y <= y1; y += bh) { lines.push([x0, y, x1, y]); const off = (Math.round(y / bh) % 2) ? bw / 2 : 0; for (let x = fl(x0 - off, bw) + off; x <= x1; x += bw) lines.push([x, y, x, y + bh]); } }
  return { lines, dots };
}
function appendHatch(svg, a, arr) {
  const cid = 'hc' + a.id, cp = svgEl('clipPath', { id: cid }); cp.appendChild(shapeOutline(a, arr));
  const defs = svgEl('defs'); defs.appendChild(cp); svg.appendChild(defs);
  const hg = svgEl('g', { 'clip-path': `url(#${cid})`, 'pointer-events': 'none' }), col = a.hatch.color || a.color, lw = a.hatch.w || 0.8, geom = hatchGeom(a);
  for (const L of geom.lines) hg.appendChild(svgEl('line', { x1: L[0], y1: L[1], x2: L[2], y2: L[3], stroke: col, 'stroke-width': lw, 'vector-effect': 'non-scaling-stroke' }));
  for (const D of geom.dots) hg.appendChild(svgEl('circle', { cx: D[0], cy: D[1], r: D[2] != null ? D[2] : (a.hatch.scale || 7) * 0.16, fill: col }));
  svg.appendChild(hg);
}
function dashSvg(a) { const w = a.width || 2; return a.dash === 'dash' ? (w * 3) + ',' + (w * 2) : a.dash === 'dot' ? '0.1,' + (w * 2.2) : null; }
function dashPdf(a) { const w = a.width || 2; return a.dash === 'dash' ? [w * 3, w * 2] : a.dash === 'dot' ? [w * 0.8, w * 2] : null; }
function strokeAttrs(a) { const o = { stroke: a.color, 'stroke-width': a.width, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }; if (a.hl) o['stroke-opacity'] = 0.35; const d = dashSvg(a); if (d) o['stroke-dasharray'] = d; return o; }
function drawOne(svg, a, pv) {
  let el, hit;
  if (a.type === 'text' && a.id === editingId) return;  // wird gerade per Textbox-Editor bearbeitet
  if (a.type === 'path') {
    const g = svgEl('g', { 'data-id': a.id }), d = pathD(a), drafting = penDraft && penDraft.a === a;
    if (d && a.hatch && a.hatch.type) appendHatch(g, a);
    if (d) { const pe = svgEl('path', { d, fill: (a.hatch && a.hatch.type) ? 'none' : (a.fill || 'none'), stroke: a.color, 'stroke-width': a.width || 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }); const ds = dashSvg(a); if (ds) pe.setAttribute('stroke-dasharray', ds); g.appendChild(pe); }
    if (drafting) {
      const last = a.nodes[a.nodes.length - 1];
      if (last && a._preview) g.appendChild(svgEl('line', { x1: last.x, y1: last.y, x2: a._preview.x, y2: a._preview.y, stroke: a.color, 'stroke-width': 1, 'stroke-dasharray': '4 3', 'vector-effect': 'non-scaling-stroke' }));
      a.nodes.forEach((nd, i) => { const r = 4 / pv.scale; if (nd.hOut && (nd.hOut.x !== nd.x || nd.hOut.y !== nd.y)) { g.appendChild(svgEl('line', { x1: nd.x, y1: nd.y, x2: nd.hOut.x, y2: nd.hOut.y, stroke: a.color, 'stroke-opacity': .5, 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' })); g.appendChild(svgEl('circle', { cx: nd.hOut.x, cy: nd.hOut.y, r: 3 / pv.scale, fill: a.color })); } g.appendChild(svgEl('circle', { cx: nd.x, cy: nd.y, r, fill: i === 0 ? '#fff' : a.color, stroke: a.color, 'stroke-width': 1.2 })); });
    }
    svg.appendChild(g); el = g;
    if (d && !drafting) { hit = svgEl('path', { d, fill: (a.fill && a.fill !== 'none') ? a.fill : 'transparent', stroke: 'transparent', 'stroke-width': Math.max(12, (a.width || 2) + 10), 'data-id': a.id }); svg.appendChild(hit); }
  } else if (a.type === 'arc') {
    const d = arcPath(a);
    el = svgEl('path', { d, fill: 'none', stroke: a.color, 'stroke-width': a.width || 2, 'stroke-linecap': 'round', 'data-id': a.id }); const ds = dashSvg(a); if (ds) el.setAttribute('stroke-dasharray', ds); svg.appendChild(el);
    hit = svgEl('path', { d, fill: 'none', stroke: 'transparent', 'stroke-width': Math.max(12, (a.width || 2) + 10), 'data-id': a.id }); svg.appendChild(hit);
  } else if (a.type === 'wall' && a.layers && a.layers.length && !wallSimple(a)) {   // mehrschichtiger Aufbau (einfach → schwarze Union)
    const arr = getAnnos(pv.num);
    drawLayeredWall(svg, a, arr);
    if (a.dim) renderWallDimPrims(svg, wallDimChains(a, arr), "#1c242c");   // zwei Maßketten: aussen Rohbau / innen Fertig
    const poly = wallClipPoly(a); hit = svgEl('polygon', { points: poly.map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' '), fill: 'transparent', 'data-id': a.id }); svg.appendChild(hit);
  } else if (a.type === 'wall') {
    const arr = getAnnos(pv.num), poly = wallPoly(a, arr), pstr = poly.map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' ');
    const g = svgEl('g', { 'data-id': a.id });
    if (!_wallUnionActive && a.fill && a.fill !== 'none') g.appendChild(svgEl('polygon', { points: pstr, fill: a.fill, stroke: 'none' }));   // Füllung (wenn keine Union)
    svg.appendChild(g); el = g;
    if (a.hatch && a.hatch.type && !wallSimple(a)) appendHatch(svg, a, arr);                                          // Schraffur (einfach → weg, schwarze Wand)
    const col = a.color || '#1c242c', lw = a.width || 1.4;
    if (!_wallUnionActive) for (const [p, q] of wallOutlineSegs(a, arr)) svg.appendChild(svgEl('line', { x1: p[0], y1: p[1], x2: q[0], y2: q[1], stroke: col, 'stroke-width': lw, 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' }));   // Umriss nur ohne Union (sonst macht die Union die sauberen Ecken)
    if (a.dim) renderWallDimPrims(svg, wallDimChains(a, arr), "#1c242c");   // zwei Maßketten: aussen Rohbau / innen Fertig   // Architektur-Masslinie – immer schwarz
    hit = svgEl('polygon', { points: pstr, fill: 'transparent', 'data-id': a.id }); svg.appendChild(hit);
  } else if (a.type === 'stairs') {
    const dx = a.x2 - a.x1, dy = a.y2 - a.y1, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux, hw = (a.width || stairWidthPts()) / 2, col = a.color || '#1c242c', n = stairSteps(a);
    const g = svgEl('g', { 'data-id': a.id });
    const c1 = [a.x1 + nx * hw, a.y1 + ny * hw], c2 = [a.x2 + nx * hw, a.y2 + ny * hw], c3 = [a.x2 - nx * hw, a.y2 - ny * hw], c4 = [a.x1 - nx * hw, a.y1 - ny * hw];
    g.appendChild(svgEl('polygon', { points: [c1, c2, c3, c4].map(p => p[0] + ',' + p[1]).join(' '), fill: '#fff', 'fill-opacity': .5, stroke: col, 'stroke-width': 1.2, 'vector-effect': 'non-scaling-stroke' }));
    for (let i = 1; i < n; i++) { const t = i / n, mx = a.x1 + dx * t, my = a.y1 + dy * t; g.appendChild(svgEl('line', { x1: mx + nx * hw, y1: my + ny * hw, x2: mx - nx * hw, y2: my - ny * hw, stroke: col, 'stroke-width': 0.8, 'vector-effect': 'non-scaling-stroke' })); }
    g.appendChild(svgEl('circle', { cx: a.x1, cy: a.y1, r: 2.6, fill: col }));   // unten (Antritt)
    g.appendChild(svgEl('line', { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, stroke: col, 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }));   // Lauflinie
    const al = 7; g.appendChild(svgEl('path', { d: `M${a.x2} ${a.y2} L${a.x2 - ux * al + nx * al * .6} ${a.y2 - uy * al + ny * al * .6} M${a.x2} ${a.y2} L${a.x2 - ux * al - nx * al * .6} ${a.y2 - uy * al - ny * al * .6}`, stroke: col, 'stroke-width': 1, fill: 'none', 'vector-effect': 'non-scaling-stroke' }));   // Pfeil = aufwärts
    svg.appendChild(g); el = g;
    hit = svgEl('polygon', { points: [c1, c2, c3, c4].map(p => p[0] + ',' + p[1]).join(' '), fill: 'transparent', 'data-id': a.id }); svg.appendChild(hit);
  } else if (a.type === 'beam') {   // Unterzug: gestricheltes Rechteck (überkopf)
    const dx = a.x2 - a.x1, dy = a.y2 - a.y1, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L, hw = (a.width || beamWidthPts()) / 2, col = a.color || '#1c242c';
    const c1 = [a.x1 + nx * hw, a.y1 + ny * hw], c2 = [a.x2 + nx * hw, a.y2 + ny * hw], c3 = [a.x2 - nx * hw, a.y2 - ny * hw], c4 = [a.x1 - nx * hw, a.y1 - ny * hw], pts = [c1, c2, c3, c4].map(p => p[0] + ',' + p[1]).join(' ');
    const g = svgEl('g', { 'data-id': a.id });
    g.appendChild(svgEl('polygon', { points: pts, fill: 'none', stroke: col, 'stroke-width': 1.1, 'stroke-dasharray': '7 4', 'vector-effect': 'non-scaling-stroke' }));
    g.appendChild(svgEl('line', { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, stroke: col, 'stroke-width': 0.7, 'stroke-dasharray': '7 4', 'stroke-opacity': .5, 'vector-effect': 'non-scaling-stroke' }));
    svg.appendChild(g); el = g;
    hit = svgEl('polygon', { points: pts, fill: 'transparent', 'data-id': a.id }); svg.appendChild(hit);
  } else if (a.type === 'block') {
    el = drawBlock(svg, a);
    const b = bbox(a); hit = svgEl('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: 'transparent', 'data-id': a.id }); svg.appendChild(hit);
  } else if (a.type === 'mesh3d') {   // akkurates 3D-Objekt: im Grundriss als Umriss-Box mit Label (+ optional echter Höhenschnitt)
    const g = svgEl('g', { 'data-id': a.id });
    g.appendChild(svgEl('rect', { x: a.x, y: a.y, width: a.fw, height: a.fh, fill: '#cfc8ba', 'fill-opacity': 0.12, stroke: '#8a8f86', 'stroke-width': 1, 'stroke-dasharray': '6 4', 'vector-effect': 'non-scaling-stroke' }));
    if (meshSliceH != null) { for (const s of sliceMesh3d(a, meshSliceH)) g.appendChild(svgEl('line', { x1: s[0], y1: s[1], x2: s[2], y2: s[3], stroke: '#1c242c', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' })); }   // echter 3D-Höhenschnitt → Grundriss-Linien
    else { const t = svgEl('text', { x: a.x + a.fw / 2, y: a.y + a.fh / 2, fill: '#6b7280', 'font-size': 12, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'paint-order': 'stroke', stroke: '#fff', 'stroke-width': 3 }); t.textContent = '📦 ' + (a.name || '3D-Objekt'); g.appendChild(t); }
    svg.appendChild(g); el = g;
    hit = svgEl('rect', { x: a.x, y: a.y, width: a.fw, height: a.fh, fill: 'transparent', 'data-id': a.id }); svg.appendChild(hit);
  } else if (a.type === 'profile') {   // Komplexes Profil: Pfad-Polylinie + Offset-Band (Profil-Breite) + Label
    const path = a._cursor ? a.path.concat([a._cursor]) : a.path, col = a.color || '#7a8392', g = svgEl('g', { 'data-id': a.id }), ptsStr = path.map(p => p[0] + ',' + p[1]).join(' ');
    g.appendChild(svgEl(a.closed && !a._cursor ? 'polygon' : 'polyline', { points: ptsStr, fill: 'none', stroke: col, 'stroke-width': 1.6, 'vector-effect': 'non-scaling-stroke' }));
    const sp = profileUSpan(a.prof), off = cmToPts(sp[1]), segPts = a.closed && !a._cursor && path.length >= 3 ? path.concat([path[0]]) : path;
    if (Math.abs(off) > 0.3 && segPts.length >= 2) { let d = ''; for (let i = 0; i < segPts.length - 1; i++) { const x1 = segPts[i][0], y1 = segPts[i][1], x2 = segPts[i + 1][0], y2 = segPts[i + 1][1], L = Math.hypot(x2 - x1, y2 - y1) || 1, nx = -(y2 - y1) / L, ny = (x2 - x1) / L; d += (i ? 'L' : 'M') + (x1 + nx * off) + ',' + (y1 + ny * off) + ' L' + (x2 + nx * off) + ',' + (y2 + ny * off) + ' '; } g.appendChild(svgEl('path', { d, fill: 'none', stroke: col, 'stroke-width': 0.8, 'stroke-dasharray': '4 3', opacity: 0.7, 'vector-effect': 'non-scaling-stroke' })); }
    const pSel = sel && sel.id === a.id; a.path.forEach((p, i) => { const at = { cx: p[0], cy: p[1], r: pSel ? 3 : 1.8, fill: col, 'vector-effect': 'non-scaling-stroke' }; if (pSel) { at.class = 'pnode'; at['data-pn'] = i; at['data-id'] = a.id; } g.appendChild(svgEl('circle', at)); });
    const lab = svgEl('text', { x: a.path[0][0] + 5, y: a.path[0][1] - 5, fill: '#6b7280', 'font-size': 11, 'paint-order': 'stroke', stroke: '#fff', 'stroke-width': 3 }); lab.textContent = '⌐ ' + (a.name || 'Profil') + (a.elev != null ? ' @' + (+a.elev).toFixed(2) + 'm' : ''); g.appendChild(lab);
    svg.appendChild(g); el = g;
    hit = svgEl('polyline', { points: a.path.map(p => p[0] + ',' + p[1]).join(' '), fill: 'none', stroke: 'transparent', 'stroke-width': 10, 'data-id': a.id }); svg.appendChild(hit);
  } else if (a.type === 'roof') {
    const x = Math.min(a.x, a.x + a.w), y = Math.min(a.y, a.y + a.h), W = Math.abs(a.w), H = Math.abs(a.h), col = a.color || '#1c242c', g = svgEl('g', { 'data-id': a.id });
    g.appendChild(svgEl('rect', { x, y, width: W, height: H, fill: '#fff', 'fill-opacity': .4, stroke: col, 'stroke-width': 1.2, 'vector-effect': 'non-scaling-stroke' }));
    const ridge = (x1, y1, x2, y2) => g.appendChild(svgEl('line', { x1, y1, x2, y2, stroke: col, 'stroke-width': 1.8, 'vector-effect': 'non-scaling-stroke' }));
    if (a.rtype === 'pult') { a.axis === 'x' ? ridge(x, y, x + W, y) : ridge(x, y, x, y + H); }   // hohe Traufkante
    else { a.axis === 'x' ? ridge(x, y + H / 2, x + W, y + H / 2) : ridge(x + W / 2, y, x + W / 2, y + H); }   // First mittig
    const t = svgEl('text', { x: x + W / 2, y: y + H / 2 - 3, fill: col, 'font-size': 11, 'text-anchor': 'middle', 'font-weight': 700, 'paint-order': 'stroke', stroke: '#fff', 'stroke-width': 3 }); t.textContent = a.rtype === 'pult' ? 'Pultdach' : 'Satteldach'; g.appendChild(t);
    svg.appendChild(g); el = g;
    hit = svgEl('rect', { x, y, width: W, height: H, fill: 'transparent', 'data-id': a.id }); svg.appendChild(hit);
  } else if (a.type === 'line' || a.type === 'arrow' || a.type === 'measure' || a.type === 'dim') {
    el = svgEl('line', { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, ...strokeAttrs(a), 'data-id': a.id });
    svg.appendChild(el);
    if (a.type === 'arrow') drawArrowHead(svg, a);
    if (a.type === 'measure' && !a.anschluss) drawMeasureLabel(svg, a, pv);
    if (a.wallface) drawWallFaceLabel(svg, a, pv);   // Wandbelag: Höhe + Wandfläche
    if (a.wallface && a.ansicht !== false) drawWallFaceElevation(svg, a, pv);   // Wand-Ansicht mit Plattenspiegel (+ Fenster)
    if (a.anschluss) drawAnschlussLabel(svg, a, pv);   // Anschluss: Art + Länge
    hit = svgEl('line', { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, class: 'hit', 'data-id': a.id }); svg.appendChild(hit);
  } else if (a.type === 'rect') {
    const hatched = a.hatch && a.hatch.type; if (hatched) appendHatch(svg, a);
    el = svgEl('rect', { x: Math.min(a.x, a.x + a.w), y: Math.min(a.y, a.y + a.h), width: Math.abs(a.w), height: Math.abs(a.h), ...strokeAttrs(a), 'data-id': a.id }); if (hatched) el.setAttribute('fill', 'transparent'); else if (a.fill && a.fill !== 'none') el.setAttribute('fill', a.fill); svg.appendChild(el);
  } else if (a.type === 'oval') {
    const hatched = a.hatch && a.hatch.type; if (hatched) appendHatch(svg, a);
    el = svgEl('ellipse', { cx: a.x + a.w / 2, cy: a.y + a.h / 2, rx: Math.abs(a.w / 2), ry: Math.abs(a.h / 2), ...strokeAttrs(a), 'data-id': a.id }); if (hatched) el.setAttribute('fill', 'transparent'); else if (a.fill && a.fill !== 'none') el.setAttribute('fill', a.fill); svg.appendChild(el);
  } else if (a.type === 'pen') {
    el = svgEl('polyline', { points: a.pts.map(p => p[0] + ',' + p[1]).join(' '), ...strokeAttrs(a), 'data-id': a.id }); svg.appendChild(el);
  } else if (a.type === 'text') {
    const g = svgEl('g', { 'data-id': a.id });
    const pad = 3, lines = (a.text || '').split('\n'), lineH = a.size * 1.25;
    const w = a.w || 120, h = a.h || (lines.length * lineH + pad * 2), align = a.align || 'left';
    if (a.bg && a.bg !== 'transparent') g.appendChild(svgEl('rect', { x: a.x, y: a.y, width: w, height: h, fill: a.bg, stroke: 'none' }));
    if (a.border) g.appendChild(svgEl('rect', { x: a.x, y: a.y, width: w, height: h, fill: 'none', stroke: a.border, 'stroke-width': a.borderW || 1 }));
    const tx = align === 'center' ? a.x + w / 2 : align === 'right' ? a.x + w - pad : a.x + pad;
    const anchor = align === 'center' ? 'middle' : align === 'right' ? 'end' : 'start';
    const t = svgEl('text', { fill: a.color, 'font-size': a.size, 'text-anchor': anchor });
    lines.forEach((ln, i) => { const ts = svgEl('tspan', { x: tx, y: a.y + pad + i * lineH }); ts.textContent = ln || ' '; t.appendChild(ts); });
    g.appendChild(t); svg.appendChild(g); el = g;
    hit = svgEl('rect', { x: a.x, y: a.y, width: w, height: h, fill: 'transparent', 'data-id': a.id }); svg.appendChild(hit);
  } else if (a.type === 'stamp') {
    const g = svgEl('g', { 'data-id': a.id }); const x = a.x, y = a.y, w = a.w, h = a.h, sw = Math.max(2, Math.min(w, h) / 9);
    if (a.kind === 'check') g.appendChild(svgEl('path', { d: `M${x + w * 0.18} ${y + h * 0.55} L${x + w * 0.42} ${y + h * 0.78} L${x + w * 0.84} ${y + h * 0.22}`, fill: 'none', stroke: a.color, 'stroke-width': sw, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    else if (a.kind === 'cross') { g.appendChild(svgEl('line', { x1: x + w * 0.2, y1: y + h * 0.2, x2: x + w * 0.8, y2: y + h * 0.8, stroke: a.color, 'stroke-width': sw, 'stroke-linecap': 'round' })); g.appendChild(svgEl('line', { x1: x + w * 0.8, y1: y + h * 0.2, x2: x + w * 0.2, y2: y + h * 0.8, stroke: a.color, 'stroke-width': sw, 'stroke-linecap': 'round' })); }
    else if (a.kind === 'circle') g.appendChild(svgEl('ellipse', { cx: x + w / 2, cy: y + h / 2, rx: w / 2 - sw, ry: h / 2 - sw, fill: 'none', stroke: a.color, 'stroke-width': sw }));
    else if (a.kind === 'label') { g.appendChild(svgEl('rect', { x, y, width: w, height: h, fill: 'none', stroke: a.color, 'stroke-width': 2 })); const fs = h * 0.46, t = svgEl('text', { x: x + w / 2, y: y + h * 0.27, fill: a.color, 'font-size': fs, 'text-anchor': 'middle', 'font-weight': 700 }); t.textContent = a.text || ''; g.appendChild(t); }
    svg.appendChild(g); el = g;
    hit = svgEl('rect', { x, y, width: w, height: h, fill: 'transparent', 'data-id': a.id }); svg.appendChild(hit);
  } else if (a.type === 'area') {
    const g = svgEl('g', { 'data-id': a.id }), pts = a.pts, draft = a._cursor;
    const poly = pts.map(p => p[0] + ',' + p[1]).join(' ');
    if (pts.length >= 2) g.appendChild(svgEl('polygon', { points: poly, fill: a.color, 'fill-opacity': a.room ? 0.08 : (a.cutout ? 0.5 : (a.belag ? 0.14 : 0.14)), stroke: 'none' }));
    if (a.belag) drawTileGrid(g, a, pv);   // Plattenspiegel (auf die Fläche geclippt)
    const line = (draft ? pts.concat([draft]) : pts).map(p => p[0] + ',' + p[1]).join(' ');
    if (!a.room) g.appendChild(svgEl('polyline', { points: line, fill: 'none', stroke: a.color, 'stroke-width': a.width || 2, 'stroke-dasharray': a.cutout ? '6 3' : null, 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }));   // Raum: kein Umriss über die Wände; Aussparung gestrichelt
    if (draft && pts.length) { const f = pts[0]; g.appendChild(svgEl('circle', { cx: f[0], cy: f[1], r: 4.5 / pv.scale, fill: '#fff', stroke: a.color, 'stroke-width': 1.5 })); }
    if (pts.length >= 3) { const ct = centroid(pts), dispNm = a.cutout ? ('Aussparung' + (typeof a.cutout === 'string' && a.cutout ? ' ' + a.cutout : '')) : a.name, t = svgEl('text', { x: ct[0], y: ct[1], fill: a.color, 'font-size': 12, 'text-anchor': 'middle', 'font-weight': 700, 'paint-order': 'stroke', stroke: '#fff', 'stroke-width': 3 }); if (dispNm) { const t1 = svgEl('tspan', { x: ct[0], dy: '-0.6em' }); t1.textContent = dispNm; const t2 = svgEl('tspan', { x: ct[0], dy: '1.2em', 'font-weight': 400 }); t2.textContent = (a.cutout ? '− ' : '') + areaLabel(pts); t.append(t1, t2); } else t.textContent = areaLabel(pts); g.appendChild(t); }
    svg.appendChild(g); el = g;
    if (!draft && pts.length >= 3) { hit = svgEl('polygon', { points: poly, fill: 'transparent', 'data-id': a.id }); svg.appendChild(hit); }
  } else if (a.type === 'slab') {
    const g = svgEl('g', { 'data-id': a.id }), pts = a.pts, draft = a._cursor, poly = pts.map(p => p[0] + ',' + p[1]).join(' ');
    if (pts.length >= 2) g.appendChild(svgEl('polygon', { points: poly, fill: a.color, 'fill-opacity': 0.13, stroke: 'none' }));
    const line = (draft ? pts.concat([draft]) : pts).map(p => p[0] + ',' + p[1]).join(' ');
    g.appendChild(svgEl('polyline', { points: line, fill: 'none', stroke: a.color, 'stroke-width': 1.4, 'stroke-dasharray': '7 4', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }));
    if (draft && pts.length) { const f = pts[0]; g.appendChild(svgEl('circle', { cx: f[0], cy: f[1], r: 4.5 / pv.scale, fill: '#fff', stroke: a.color, 'stroke-width': 1.5 })); }
    if (pts.length >= 3) { const ct = centroid(pts), t = svgEl('text', { x: ct[0], y: ct[1], fill: a.color, 'font-size': 12, 'text-anchor': 'middle', 'font-weight': 700, 'paint-order': 'stroke', stroke: '#fff', 'stroke-width': 3 }); t.textContent = (a.base >= wallHeightM ? 'Decke' : 'Platte') + '  ' + (a.base + a.thick).toFixed(2) + ' m' + (a.layers && a.layers.length ? '  ▦' + a.layers.length : ''); g.appendChild(t); }
    svg.appendChild(g); el = g;
    if (!draft && pts.length >= 3) { hit = svgEl('polygon', { points: poly, fill: 'transparent', 'data-id': a.id }); svg.appendChild(hit); }
  } else if (a.type === 'terrain') {   // Gelände/Terrain: offene Linie + Erdreich-Symbol (45°-Striche darunter)
    const col = a.color || '#7a6a4a', g = svgEl('g', { 'data-id': a.id }), path = a._cursor ? a.pts.concat([a._cursor]) : a.pts;
    g.appendChild(svgEl('polyline', { points: path.map(p => p[0] + ',' + p[1]).join(' '), fill: 'none', stroke: col, 'stroke-width': 1.8, 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }));
    const tick = 6, step = 9; for (let i = 0; i < path.length - 1; i++) { const x1 = path[i][0], y1 = path[i][1], x2 = path[i + 1][0], y2 = path[i + 1][1], L = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / L, uy = (y2 - y1) / L; for (let d = step / 2; d < L; d += step) { const px = x1 + ux * d, py = y1 + uy * d; g.appendChild(svgEl('line', { x1: px, y1: py, x2: px - tick, y2: py + tick, stroke: col, 'stroke-width': 0.8, 'vector-effect': 'non-scaling-stroke' })); } }
    for (const p of a.pts) g.appendChild(svgEl('circle', { cx: p[0], cy: p[1], r: 1.6, fill: col, 'vector-effect': 'non-scaling-stroke' }));
    svg.appendChild(g); el = g;
    hit = svgEl('polyline', { points: a.pts.map(p => p[0] + ',' + p[1]).join(' '), fill: 'none', stroke: 'transparent', 'stroke-width': 10, 'data-id': a.id }); svg.appendChild(hit);
  } else if (a.type === 'img') {
    el = svgEl('image', { x: a.x, y: a.y, width: a.w, height: a.h, preserveAspectRatio: 'none', 'data-id': a.id });
    el.setAttributeNS('http://www.w3.org/1999/xlink', 'href', a.data); el.setAttribute('href', a.data);
    if (a.opacity != null && a.opacity < 1) el.setAttribute('opacity', a.opacity);
    svg.appendChild(el);
  } else if (a.type === 'imgph') {
    const g = svgEl('g', { 'data-id': a.id });
    g.appendChild(svgEl('rect', { x: a.x, y: a.y, width: a.w, height: a.h, fill: '#f3f4f2', stroke: '#b9bdb6', 'stroke-width': 1.5, 'stroke-dasharray': '7 5' }));
    const s = Math.min(a.w, a.h) * 0.22, ix = a.x + a.w / 2 - s / 2, iy = a.y + a.h / 2 - s * 0.7;
    g.appendChild(svgEl('rect', { x: ix, y: iy, width: s, height: s * 0.8, fill: 'none', stroke: '#9aa093', 'stroke-width': 1.5 }));
    g.appendChild(svgEl('path', { d: `M${ix} ${iy + s * 0.62} L${ix + s * 0.35} ${iy + s * 0.3} L${ix + s * 0.6} ${iy + s * 0.55} L${ix + s * 0.78} ${iy + s * 0.4} L${ix + s} ${iy + s * 0.8}`, fill: 'none', stroke: '#9aa093', 'stroke-width': 1.5, 'stroke-linejoin': 'round' }));
    const t = svgEl('text', { x: a.x + a.w / 2, y: a.y + a.h / 2 + s * 0.55, fill: '#9aa093', 'font-size': Math.max(9, Math.min(a.h * 0.06, 15)), 'text-anchor': 'middle', 'font-weight': 600 }); t.textContent = 'Doppelklick: Bild'; g.appendChild(t);
    svg.appendChild(g); el = g;
    hit = svgEl('rect', { x: a.x, y: a.y, width: a.w, height: a.h, fill: 'transparent', 'data-id': a.id }); svg.appendChild(hit);
  } else if (a.type === 'crop' || a.type === 'snip') {
    const g = svgEl('g', { 'data-id': a.id });
    const dim = svgEl('path', { d: `M0 0H${pv.pageW}V${pv.pageH}H0Z M${a.x} ${a.y}H${a.x + a.w}V${a.y + a.h}H${a.x}Z`, fill: '#10161c', 'fill-opacity': 0.45, 'fill-rule': 'evenodd', stroke: 'none' });
    dim.style.pointerEvents = 'none'; g.appendChild(dim);
    g.appendChild(svgEl('rect', { x: a.x, y: a.y, width: a.w, height: a.h, fill: 'none', stroke: '#ffffff', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' }));
    g.appendChild(svgEl('rect', { x: a.x, y: a.y, width: a.w, height: a.h, fill: 'none', stroke: a.type === 'snip' ? '#2e7d46' : '#b4502f', 'stroke-width': 1, 'stroke-dasharray': '6 4', 'vector-effect': 'non-scaling-stroke' }));
    svg.appendChild(g); el = g;
    hit = svgEl('rect', { x: a.x, y: a.y, width: a.w, height: a.h, fill: 'transparent', 'data-id': a.id }); svg.appendChild(hit);
  } else if (a.type === 'highlight') {
    const g = svgEl('g', { 'data-id': a.id });
    for (const r of (a.rects || [])) g.appendChild(svgEl('rect', { x: r.x, y: r.y, width: r.w, height: r.h, fill: a.color, 'fill-opacity': 0.33, stroke: 'none' }));
    if (a._drag) g.appendChild(svgEl('rect', { x: a._drag.x, y: a._drag.y, width: a._drag.w, height: a._drag.h, fill: 'none', stroke: a.color, 'stroke-width': 1, 'stroke-dasharray': '4 3', 'vector-effect': 'non-scaling-stroke' }));
    svg.appendChild(g); el = g;
    const b = bbox(a); if (b.w) { hit = svgEl('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: 'transparent', 'data-id': a.id }); svg.appendChild(hit); }
  } else if (a.type === 'cover') {
    el = svgEl('rect', { x: a.x, y: a.y, width: a.w, height: a.h, fill: a.color || '#fff', stroke: 'none', 'data-id': a.id }); svg.appendChild(el);
    hit = svgEl('rect', { x: a.x, y: a.y, width: a.w, height: a.h, fill: 'transparent', 'data-id': a.id }); svg.appendChild(hit);
  } else if (a.type === 'edit') {
    const g = svgEl('g', { 'data-id': a.id });
    if (a.bg && a.bg !== 'transparent') g.appendChild(svgEl('rect', { x: a.x, y: a.y, width: a.w, height: a.h, fill: a.bg, stroke: 'none' }));   // alte Stelle überdecken (nur wenn Abdeckung gewünscht)
    if (a.id !== _editingId) {   // während des Tippens zeigt die Textarea den Text – nicht doppelt zeichnen
      const t = svgEl('text', { x: a.x + 1, y: a.y + 1, fill: a.color, 'font-size': a.size, 'font-family': cssFontStack(a.fam) });
      if (a.bold) t.setAttribute('font-weight', 'bold'); if (a.italic) t.setAttribute('font-style', 'italic');
      (a.text || '').split('\n').forEach((ln, i) => { const ts = svgEl('tspan', { x: a.x + 1, dy: i === 0 ? 0 : (a.lh || a.size * 1.25) }); ts.textContent = ln || ' '; t.appendChild(ts); });
      g.appendChild(t);
    }
    svg.appendChild(g); el = g;
    const hit2 = svgEl('rect', { x: a.x, y: a.y, width: a.w, height: a.h, fill: 'transparent', 'data-id': a.id }); svg.appendChild(hit2);
  } else if (a.type === 'note') {
    const g = svgEl('g', { class: 'note-pin', 'data-id': a.id });
    g.appendChild(svgEl('path', { d: `M${a.x} ${a.y} l13 0 l0 9 l-7 0 l-4 4 l0 -4 l-2 0 z`, fill: a.color, stroke: '#fff', 'stroke-width': 1 }));
    svg.appendChild(g); el = g;
  } else if (a.type === 'sig') {
    el = svgEl('image', { x: a.x, y: a.y, width: a.w, height: a.h, href: a.data, 'data-id': a.id, preserveAspectRatio: 'none' });
    el.setAttributeNS('http://www.w3.org/1999/xlink', 'href', a.data); svg.appendChild(el);
    if (a.caption) {                                   // Signatur-Block: Linie + Name/Datum darunter
      const cy = a.y + a.h + 2, fs = Math.max(7, Math.min(11, a.h * 0.16));
      svg.appendChild(svgEl('line', { x1: a.x, y1: cy, x2: a.x + a.w, y2: cy, stroke: '#1c242c', 'stroke-width': 0.7 }));
      const t = svgEl('text', { x: a.x, y: cy + fs + 1, fill: '#1c242c', 'font-size': fs }); t.textContent = a.caption; svg.appendChild(t);
    }
    hit = svgEl('rect', { x: a.x, y: a.y, width: a.w, height: a.h, fill: 'transparent', 'data-id': a.id }); svg.appendChild(hit);
  } else if (a.type === 'opening') {
    el = drawOpening(svg, a, getAnnos(pv.num));
  } else if (a.type === 'section') {
    el = drawSection(svg, a, getAnnos(pv.num));
  } else if (a.type === 'chaindim') {
    el = drawChainDim(svg, a, pv);
    if (a.anschluss && a.pts && a.pts.length) { const p0 = a.pts[0], t = svgEl('text', { x: p0[0], y: p0[1] - 8, fill: a.color, 'font-size': 11, 'font-weight': 600, 'paint-order': 'stroke', stroke: '#fff', 'stroke-width': 3 }); t.textContent = 'Anschluss ' + (ANSCHLUSS_KAT[a.anschluss] || ''); svg.appendChild(t); }   // Anschluss-Kategorie im Plan
  } else if (a.type === 'dim') {
    drawDim(svg, a);
    hit = svgEl('line', { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, class: 'hit', 'data-id': a.id }); svg.appendChild(hit);
    el = svg.lastChild;
  }
  return el;
}
// Masslinie mit End-Strichen + (auto oder eigenem) Mass
function drawDim(svg, a) {
  svg.appendChild(svgEl('line', { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, ...strokeAttrs(a), 'data-id': a.id }));
  const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1), tx = Math.cos(ang + Math.PI / 2) * 6, ty = Math.sin(ang + Math.PI / 2) * 6;
  for (const [ex, ey] of [[a.x1, a.y1], [a.x2, a.y2]]) svg.appendChild(svgEl('line', { x1: ex - tx, y1: ey - ty, x2: ex + tx, y2: ey + ty, ...strokeAttrs(a) }));
  const mx = (a.x1 + a.x2) / 2, my = (a.y1 + a.y2) / 2, lab = a.text || lenLabel(a);
  const w = lab.length * 7 + 8, t = svgEl('text', { x: mx, y: my - 4, fill: a.color, 'font-size': 12, 'text-anchor': 'middle', 'dominant-baseline': 'auto' });
  svg.appendChild(svgEl('rect', { x: mx - w / 2, y: my - 18, width: w, height: 15, fill: '#fff', 'fill-opacity': .82, stroke: 'none' }));
  t.textContent = lab; svg.appendChild(t);
}
function drawChainDim(svg, a, pv) {
  const pts = a._cursor ? a.pts.concat([a._cursor]) : a.pts, col = a.color || '#1c242c';
  if (pts.length < 2) { if (pts[0]) svg.appendChild(svgEl('circle', { cx: pts[0][0], cy: pts[0][1], r: 3 / pv.scale, fill: col, 'data-id': a.id })); return svg.lastChild; }
  const G = chainDimStations(pts); if (!G) return null; const { nx, ny, st } = G, tk = 4.5;
  const g = svgEl('g', { 'data-id': a.id });
  const ln = (x1, y1, x2, y2, w) => g.appendChild(svgEl('line', { x1, y1, x2, y2, stroke: col, 'stroke-width': w || 0.8, 'vector-effect': 'non-scaling-stroke' }));
  ln(st[0].proj[0], st[0].proj[1], st[st.length - 1].proj[0], st[st.length - 1].proj[1], 1);   // Basislinie
  for (const s of st) { ln(s.proj[0] - nx * tk, s.proj[1] - ny * tk, s.proj[0] + nx * tk, s.proj[1] + ny * tk); if (Math.hypot(s.p[0] - s.proj[0], s.p[1] - s.proj[1]) > 1) ln(s.p[0], s.p[1], s.proj[0], s.proj[1]); }
  for (let i = 0; i < st.length - 1; i++) { const d = Math.abs(st[i + 1].t - st[i].t); if (d < 1) continue; const mx = (st[i].proj[0] + st[i + 1].proj[0]) / 2, my = (st[i].proj[1] + st[i + 1].proj[1]) / 2, t = svgEl('text', { x: mx + nx * 7, y: my + ny * 7, fill: col, 'font-size': 11, 'text-anchor': 'middle', 'paint-order': 'stroke', stroke: '#fff', 'stroke-width': 3 }); t.textContent = fmtLen(d); g.appendChild(t); }
  if (st.length > 2) { const tot = Math.abs(st[st.length - 1].t - st[0].t), e = st[st.length - 1].proj, t = svgEl('text', { x: e[0] + nx * 16, y: e[1] + ny * 16, fill: col, 'font-size': 11, 'font-weight': 700, 'text-anchor': 'middle', 'paint-order': 'stroke', stroke: '#fff', 'stroke-width': 3 }); t.textContent = '∑ ' + fmtLen(tot); g.appendChild(t); }
  svg.appendChild(g);
  if (!a._cursor) svg.appendChild(svgEl('line', { x1: st[0].proj[0], y1: st[0].proj[1], x2: st[st.length - 1].proj[0], y2: st[st.length - 1].proj[1], class: 'hit', 'data-id': a.id }));
  return g;
}
function drawArrowHead(svg, a) {
  const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1), L = Math.max(12, a.width * 5);
  for (const s of [ang + 2.7, ang - 2.7]) svg.appendChild(svgEl('line', { x1: a.x2, y1: a.y2, x2: a.x2 + Math.cos(s) * L, y2: a.y2 + Math.sin(s) * L, ...strokeAttrs(a) }));
}
function lenLabel(a) { return fmtLen(Math.hypot(a.x2 - a.x1, a.y2 - a.y1)); }
function drawMeasureLabel(svg, a, pv) {
  const mx = (a.x1 + a.x2) / 2, my = (a.y1 + a.y2) / 2;
  const t = svgEl('text', { x: mx + 4, y: my - 4, fill: a.color, 'font-size': 12 }); t.textContent = a.label || lenLabel(a); svg.appendChild(t);
}
// Wandbelag: Höhe + Wandfläche (Länge×Höhe) unter der Messlinie
function drawWallFaceLabel(svg, a, pv) {
  const lenPts = Math.hypot(a.x2 - a.x1, a.y2 - a.y1), mx = (a.x1 + a.x2) / 2, my = (a.y1 + a.y2) / 2, h = a.height || 2.5;
  let txt = 'H ' + (Math.round(h * 100) / 100).toString().replace('.', ',') + ' m';
  if (docScale) txt += ' · ' + (Math.round(wallFaceAreaM2(lenPts, docScale.perPt, h) * 100) / 100).toFixed(2).replace('.', ',') + ' m²';
  const t = svgEl('text', { x: mx + 4, y: my + 14, fill: a.color, 'font-size': 11, 'font-weight': 600, 'paint-order': 'stroke', stroke: '#fff', 'stroke-width': 3 }); t.textContent = txt; svg.appendChild(t);
}
// Anschluss-Kategorien (Längen, lfm) für die Ausschreibung
const ANSCHLUSS_KAT = { boden: 'Boden', wand: 'Wand', decke: 'Decke', fenster: 'Fenster' };
function drawAnschlussLabel(svg, a, pv) {
  const mx = (a.x1 + a.x2) / 2, my = (a.y1 + a.y2) / 2, len = Math.hypot(a.x2 - a.x1, a.y2 - a.y1);
  let txt = 'Anschluss ' + (ANSCHLUSS_KAT[a.anschluss] || '');
  if (docScale) txt += ' · ' + (Math.round(len * docScale.perPt * 100) / 100).toFixed(2).replace('.', ',') + ' m';
  const t = svgEl('text', { x: mx + 4, y: my - 4, fill: a.color, 'font-size': 11, 'font-weight': 600, 'paint-order': 'stroke', stroke: '#fff', 'stroke-width': 3 }); t.textContent = txt; svg.appendChild(t);
}
// Wand-Ansicht (Elevation): die Wand klappt von der Messlinie senkrecht ab → Rechteck Länge×Höhe mit Plattenspiegel (+ Fenster) in Ansicht
function drawWallFaceElevation(svg, a, pv) {
  if (!docScale) return;
  const perPt = docScale.perPt, h = a.height || 2.5, Hpts = h / perPt;
  const dx = a.x2 - a.x1, dy = a.y2 - a.y1, len = Math.hypot(dx, dy); if (len < 2) return;
  const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;           // Wandrichtung + Normale (Abklapp-Seite)
  const gap = 8 / pv.scale, ox = nx * gap, oy = ny * gap;
  const A = [a.x1 + ox, a.y1 + oy], B = [a.x2 + ox, a.y2 + oy], C = [B[0] + nx * Hpts, B[1] + ny * Hpts], D = [A[0] + nx * Hpts, A[1] + ny * Hpts];
  const quad = [A, B, C, D].map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' '), col = a.color || '#2f6ea3';
  const g = svgEl('g', {});
  g.appendChild(svgEl('polygon', { points: quad, fill: '#ffffff', 'fill-opacity': 0.88, stroke: col, 'stroke-width': 1.2, 'vector-effect': 'non-scaling-stroke' }));
  const b = a.belag || DEFAULT_BELAG, jw = Math.max(0, b.joint || 0) / 1000, stepU = ((b.tileW / 100) + jw) / perPt, stepN = ((b.tileH / 100) + jw) / perPt;
  const cid = 'wfel' + (_tileClip++), cp = svgEl('clipPath', { id: cid }); cp.appendChild(svgEl('polygon', { points: quad })); g.appendChild(cp);
  const gg = svgEl('g', { 'clip-path': 'url(#' + cid + ')' });
  if (stepU > 1) for (let d = stepU; d < len; d += stepU) gg.appendChild(svgEl('line', { x1: (A[0] + ux * d).toFixed(2), y1: (A[1] + uy * d).toFixed(2), x2: (D[0] + ux * d).toFixed(2), y2: (D[1] + uy * d).toFixed(2), stroke: col, 'stroke-width': 0.5, 'stroke-opacity': 0.5, 'vector-effect': 'non-scaling-stroke' }));
  if (stepN > 1) for (let d = stepN; d < Hpts; d += stepN) gg.appendChild(svgEl('line', { x1: (A[0] + nx * d).toFixed(2), y1: (A[1] + ny * d).toFixed(2), x2: (B[0] + nx * d).toFixed(2), y2: (B[1] + ny * d).toFixed(2), stroke: col, 'stroke-width': 0.5, 'stroke-opacity': 0.5, 'vector-effect': 'non-scaling-stroke' }));
  // Fenster (a.fenster: [{t: 0..1 Position entlang der Wand, w, h, sill}]) als Aussparung in der Ansicht
  for (const f of (a.fenster || [])) {
    const fw = (f.w || 1) / perPt, fh = (f.h || 1) / perPt, sill = (f.sill || 0.9) / perPt, cU = (f.t != null ? f.t : 0.5) * len;
    const bx = A[0] + ux * (cU - fw / 2) + nx * sill, by = A[1] + uy * (cU - fw / 2) + ny * sill;
    const fq = [[bx, by], [bx + ux * fw, by + uy * fw], [bx + ux * fw + nx * fh, by + uy * fw + ny * fh], [bx + nx * fh, by + ny * fh]].map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' ');
    gg.appendChild(svgEl('polygon', { points: fq, fill: '#dfe8f2', stroke: col, 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }));
  }
  g.appendChild(gg); svg.appendChild(g);
}
// Nach dem Zeichnen eines Wandbelags/Anschlusses: auswählen, Inspector öffnen (bei Wandbelag Höhe-Feld fokussieren)
function afterWallfaceDraw(pv, a) {
  if (!a || (!a.wallface && !a.anschluss)) return false;
  sel = { num: pv.num, id: a.id }; setTool('select'); _listTab = 'sel';
  if (typeof openListPanel === 'function') openListPanel('sel');
  if (typeof renderList === 'function') renderList();
  drawAnnos(pv); saveState();
  const el = document.getElementById('iWfH'); if (el) { try { el.focus(); el.select(); } catch (_) {} }
  return true;
}

/* ---------- Auswahl / Griffe ---------- */
function bbox(a) {
  if (a.type === 'rect' || a.type === 'oval' || a.type === 'roof' || a.type === 'block') return { x: Math.min(a.x, a.x + a.w), y: Math.min(a.y, a.y + a.h), w: Math.abs(a.w), h: Math.abs(a.h) };
  if (a.type === 'mesh3d') return { x: a.x, y: a.y, w: a.fw, h: a.fh };
  if (a.type === 'line' || a.type === 'arrow' || a.type === 'measure' || a.type === 'dim') return { x: Math.min(a.x1, a.x2), y: Math.min(a.y1, a.y2), w: Math.abs(a.x2 - a.x1), h: Math.abs(a.y2 - a.y1) };
  if (a.type === 'wall') { const t = (a.thick || wallThickPts()) / 2; return { x: Math.min(a.x1, a.x2) - t, y: Math.min(a.y1, a.y2) - t, w: Math.abs(a.x2 - a.x1) + 2 * t, h: Math.abs(a.y2 - a.y1) + 2 * t }; }
  if (a.type === 'stairs') { const t = (a.width || stairWidthPts()) / 2; return { x: Math.min(a.x1, a.x2) - t, y: Math.min(a.y1, a.y2) - t, w: Math.abs(a.x2 - a.x1) + 2 * t, h: Math.abs(a.y2 - a.y1) + 2 * t }; }
  if (a.type === 'beam') { const t = (a.width || beamWidthPts()) / 2; return { x: Math.min(a.x1, a.x2) - t, y: Math.min(a.y1, a.y2) - t, w: Math.abs(a.x2 - a.x1) + 2 * t, h: Math.abs(a.y2 - a.y1) + 2 * t }; }
  if (a.type === 'opening') { const P = openingParts(a), xs = [], ys = []; for (const p of P.cover) { xs.push(p[0]); ys.push(p[1]); } for (const [u, v] of P.lines) { xs.push(u[0], v[0]); ys.push(u[1], v[1]); } for (const arc of P.arcs) for (const p of arcPts(arc.cx, arc.cy, arc.r, arc.from, arc.to, 8)) { xs.push(p[0]); ys.push(p[1]); } return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; }
  if (a.type === 'pen' || a.type === 'area' || a.type === 'chaindim' || a.type === 'slab' || a.type === 'terrain') { const xs = a.pts.map(p => p[0]), ys = a.pts.map(p => p[1]); return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; }
  if (a.type === 'profile') { const xs = a.path.map(p => p[0]), ys = a.path.map(p => p[1]); return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; }
  if (a.type === 'path') { const xs = [], ys = []; for (const nd of a.nodes) { xs.push(nd.x, nd.hIn.x, nd.hOut.x); ys.push(nd.y, nd.hIn.y, nd.hOut.y); } if (!xs.length) return { x: 0, y: 0, w: 0, h: 0 }; return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; }
  if (a.type === 'text') return { x: a.x, y: a.y, w: (a.w || 120), h: (a.h || a.size * (a.text.split('\n').length) * 1.3) };
  if (a.type === 'section') return sectionBBox(a);
  if (a.type === 'note') return { x: a.x, y: a.y, w: 14, h: 14 };
  if (a.type === 'sig' || a.type === 'img' || a.type === 'imgph' || a.type === 'edit' || a.type === 'cover' || a.type === 'stamp' || a.type === 'crop' || a.type === 'snip') return { x: a.x, y: a.y, w: a.w, h: a.h };
  if (a.type === 'highlight') { if (!a.rects || !a.rects.length) return { x: 0, y: 0, w: 0, h: 0 }; let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity; for (const r of a.rects) { mnx = Math.min(mnx, r.x); mny = Math.min(mny, r.y); mxx = Math.max(mxx, r.x + r.w); mxy = Math.max(mxy, r.y + r.h); } return { x: mnx, y: mny, w: mxx - mnx, h: mxy - mny }; }
  return { x: 0, y: 0, w: 0, h: 0 };
}
function isLineType(a) { return a && (a.type === 'line' || a.type === 'arrow' || a.type === 'measure' || a.type === 'dim' || a.type === 'arc' || a.type === 'wall' || a.type === 'stairs' || a.type === 'beam'); }
function arcPath(a) { const r = Math.hypot(a.x2 - a.x1, a.y2 - a.y1) / 2; return `M ${a.x1} ${a.y1} A ${r} ${r} 0 0 1 ${a.x2} ${a.y2}`; }
function compOutline(a, arr) {   // exakte Bauteil-Aussenform (Polygone) zum Hervorheben/Nachziehen – Wand/Fenster/Tür/Decke/Dach/…
  if (!a) return null;
  if (a.type === 'wall') return [wallPoly(a, arr)];
  if (a.type === 'opening') return [openingFootprint(a)];
  if ((a.type === 'slab' || a.type === 'area' || a.type === 'terrain') && a.pts && a.pts.length >= 2) return [a.pts];
  if (a.type === 'rect' || a.type === 'roof' || a.type === 'block' || a.type === 'mesh3d' || a.type === 'columnSquare') { const x = a.x, y = a.y, w = a.w != null ? a.w : (a.fw || 0), h = a.h != null ? a.h : (a.fh || 0); if (w && h) return [[[x, y], [x + w, y], [x + w, y + h], [x, y + h]]]; }
  if (a.type === 'profile' && a.path && a.path.length >= 2) return [a.closed ? a.path.concat([a.path[0]]) : a.path];
  if (a.type === 'stairs' && a.x1 != null) { const dx = a.x2 - a.x1, dy = a.y2 - a.y1, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux, hw = (a.width || stairWidthPts()) / 2; return [[[a.x1 + nx * hw, a.y1 + ny * hw], [a.x2 + nx * hw, a.y2 + ny * hw], [a.x2 - nx * hw, a.y2 - ny * hw], [a.x1 - nx * hw, a.y1 - ny * hw]]]; }
  return null;
}
function drawCompOutline(svg, a, arr, cls) { const polys = compOutline(a, arr); if (!polys) return false; for (const poly of polys) { if (!poly || poly.length < 2) continue; svg.appendChild(svgEl('polygon', { class: cls, points: poly.map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' ') })); } return true; }
function drawSelection(svg, a, pv) {
  if (!a) return; const hs = (COARSE ? 8 : 4.5) / pv.scale;
  if (a.type === 'opening') return;   // Fenster/Tür: KEINE Auswahl-Umrandung – die Auswahl zeigt sich an den farbigen Laibungen; Form nur beim Drüberfahren (Hover)
  if (a.type === 'path') {                              // Kurve: Knoten + Anfasser zum Nachbearbeiten
    const r = hs;
    a.nodes.forEach((nd, i) => {
      for (const [hk, h] of [['in', nd.hIn], ['out', nd.hOut]]) if (h.x !== nd.x || h.y !== nd.y) {
        svg.appendChild(svgEl('line', { x1: nd.x, y1: nd.y, x2: h.x, y2: h.y, class: 'phl' }));
        svg.appendChild(svgEl('circle', { class: 'phandle', cx: h.x, cy: h.y, r: r * 0.85, 'data-ph': i, 'data-hk': hk, 'data-id': a.id }));
      }
      svg.appendChild(svgEl('rect', { class: 'pnode', x: nd.x - r, y: nd.y - r, width: r * 2, height: r * 2, 'data-pn': i, 'data-id': a.id }));
    });
    return;
  }
  if (a.type === 'section') {                           // Schnitt: Schnittlinie mit Endpunkt-Griffen + Mittelpunkt + Blickrichtung-Flip; Block-Rahmen
    svg.appendChild(svgEl('line', { x1: a.cx1, y1: a.cy1, x2: a.cx2, y2: a.cy2, class: 'sel-line' }));
    for (const [name, x, y] of [['sc1', a.cx1, a.cy1], ['sc2', a.cx2, a.cy2]]) svg.appendChild(svgEl('circle', { class: 'handle', cx: x, cy: y, r: hs, 'data-h': name, 'data-id': a.id }));
    const mx = (a.cx1 + a.cx2) / 2, my = (a.cy1 + a.cy2) / 2, dx = a.cx2 - a.cx1, dy = a.cy2 - a.cy1, L = Math.hypot(dx, dy) || 1, nnx = -dy / L, nny = dx / L, fd = a.flip ? -1 : 1;
    svg.appendChild(svgEl('circle', { class: 'handle', cx: mx, cy: my, r: hs * 0.9, 'data-h': 'scmid', 'data-id': a.id }));
    svg.appendChild(svgEl('line', { x1: mx, y1: my, x2: mx + nnx * fd * 26 / pv.scale, y2: my + nny * fd * 26 / pv.scale, class: 'sel-line' }));
    svg.appendChild(svgEl('circle', { class: 'handle dim-handle', cx: mx + nnx * fd * 26 / pv.scale, cy: my + nny * fd * 26 / pv.scale, r: hs, 'data-h': 'scflip', 'data-id': a.id }));
    const b = bbox(a), pad = 3; svg.appendChild(svgEl('rect', { class: 'sel-out', x: b.x - pad, y: b.y - pad, width: b.w + 2 * pad, height: b.h + 2 * pad }));
    return;
  }
  if (a.type === 'area' || a.type === 'slab' || a.type === 'terrain') {   // Polygon/Polylinie: echte Form nachziehen + Eck-Knoten ziehen
    if (!drawCompOutline(svg, a, getAnnos(pv.num), 'sel-shape')) { const b = bbox(a), pad = 3; svg.appendChild(svgEl('rect', { class: 'sel-out', x: b.x - pad, y: b.y - pad, width: b.w + 2 * pad, height: b.h + 2 * pad })); }
    (a.pts || []).forEach((p, i) => svg.appendChild(svgEl('rect', { class: 'pnode', x: p[0] - hs, y: p[1] - hs, width: hs * 2, height: hs * 2, 'data-pn': i, 'data-id': a.id })));
    return;
  }
  if (isLineType(a)) {                                  // Linie/Wand: bei Wand die echte Form nachziehen, sonst nur Linie + Endpunkte
    if (a.type === 'wall') drawCompOutline(svg, a, getAnnos(pv.num), 'sel-shape');   // Wand-Aussenform exakt hervorheben
    svg.appendChild(svgEl('line', { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, class: 'sel-line' }));
    for (const [name, x, y] of [['p1', a.x1, a.y1], ['p2', a.x2, a.y2]]) svg.appendChild(svgEl('circle', { class: 'handle', cx: x, cy: y, r: hs, 'data-h': name }));
    if (a.type === 'wall' && a.dim) { const dg = wallDimGeom(a); svg.appendChild(svgEl('circle', { class: 'handle dim-handle', cx: (dg.x1 + dg.x2) / 2, cy: (dg.y1 + dg.y2) / 2, r: hs, 'data-h': 'dimoff', 'data-id': a.id })); }   // Masslinie von Hand verschieben
    if (a.type === 'wall' && a.layers && a.layers.length && !wallSimple(a)) {   // pro Schicht je ein Griff an beiden Enden → Schicht-Länge ziehen
      const lb = wallLayerBands(a, getAnnos(pv.num)).bands;
      lb.forEach((b, i) => { const e1 = [(b.poly[0][0] + b.poly[3][0]) / 2, (b.poly[0][1] + b.poly[3][1]) / 2], e2 = [(b.poly[1][0] + b.poly[2][0]) / 2, (b.poly[1][1] + b.poly[2][1]) / 2]; svg.appendChild(svgEl('circle', { class: 'handle lay-handle', cx: e1[0], cy: e1[1], r: hs * 0.8, 'data-h': 'wl:' + i + ':1', 'data-id': a.id })); svg.appendChild(svgEl('circle', { class: 'handle lay-handle', cx: e2[0], cy: e2[1], r: hs * 0.8, 'data-h': 'wl:' + i + ':2', 'data-id': a.id })); });
    }
  } else {
    const b = bbox(a), pad = 3;
    if (!drawCompOutline(svg, a, getAnnos(pv.num), 'sel-shape')) svg.appendChild(svgEl('rect', { class: 'sel-out', x: b.x - pad, y: b.y - pad, width: b.w + 2 * pad, height: b.h + 2 * pad }));   // echte Form nachziehen, sonst Box
    if (a.type !== 'opening') for (const [name, x, y] of [['nw', b.x, b.y], ['ne', b.x + b.w, b.y], ['sw', b.x, b.y + b.h], ['se', b.x + b.w, b.y + b.h]]) svg.appendChild(svgEl('rect', { class: 'handle', x: x - hs, y: y - hs, width: hs * 2, height: hs * 2, 'data-h': name }));   // Öffnung: keine Box-Eckgriffe (Breite/Position + Laibung haben eigene Griffe)
  }
}
// Hover-Vorschau (Maus über Anmerkung): Linie hervorheben + Endpunkte zeigen
function setHover(pv, a) {
  const old = pv.svg.querySelector('.hover-layer'); if (old) old.remove();
  if (!a || (sel && sel.num === pv.num && sel.id === a.id)) return;
  const g = svgEl('g', { class: 'hover-layer' });
  if (a.type === 'wall') {                                   // Wand: echte Form nachziehen + vier Eckpunkte zum Andocken
    drawCompOutline(g, a, getAnnos(pv.num), 'hover-shape');
    const r = 4.5 / pv.scale;
    for (const p of wallPoly(a, getAnnos(pv.num))) g.appendChild(svgEl('circle', { cx: p[0], cy: p[1], r, class: 'hover-dot corner-dot' }));
  } else if (isLineType(a)) {
    g.appendChild(svgEl('line', { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, class: 'hover-line' }));
    const r = 4 / pv.scale;
    g.appendChild(svgEl('circle', { cx: a.x1, cy: a.y1, r, class: 'hover-dot' }));
    g.appendChild(svgEl('circle', { cx: a.x2, cy: a.y2, r, class: 'hover-dot' }));
  } else if (!drawCompOutline(g, a, getAnnos(pv.num), 'hover-shape')) { const b = bbox(a), pad = 2; g.appendChild(svgEl('rect', { x: b.x - pad, y: b.y - pad, width: b.w + 2 * pad, height: b.h + 2 * pad, class: 'hover-box' })); }   // echte Bauteil-Form, sonst Box
  pv.svg.appendChild(g);
}

/* ---------- Maus → Seitenkoordinaten ---------- */
function evtToPage(pv, e) {
  const ctm = pv.svg.getScreenCTM().inverse();
  const p = pv.svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
  const q = p.matrixTransform(ctm); return { x: q.x, y: q.y };
}

/* ---------- Werkzeuge / Interaktion ---------- */
// Dezentes Overlay im „Text bearbeiten"-Modus: zeigt, welchen Absatz ein Klick trifft
function setEditHover(pv, b) {
  const old = pv.svg.querySelector('.edit-hover'); if (old) old.remove();
  if (!b) return;
  pv.svg.appendChild(svgEl('rect', { class: 'edit-hover', x: b.x - 2, y: b.y - 1, width: b.w + 4, height: b.h + 2, rx: 3, fill: 'rgba(74,143,87,.10)', stroke: '#3a8f57', 'stroke-width': 1, 'stroke-dasharray': '5 3', 'vector-effect': 'non-scaling-stroke', 'pointer-events': 'none' }));
}
function buildBlocksVisible() {   // Absätze der sichtbaren Seiten vorab berechnen (für flüssiges Hover im edittext-Modus)
  const host = $('#pages'), top = host.scrollTop - 200, bot = host.scrollTop + host.clientHeight + 200;
  for (const pv of pageViews) { const t = pv.wrap.offsetTop, b = t + pv.wrap.offsetHeight; if (pv.page && !pv.textBlocks && b >= top && t <= bot) buildTextBlocks(pv); }
}
function bindPageEvents(pv) {
  pv.svg.addEventListener('pointerdown', e => onPointerDown(pv, e));
  pv.svg.addEventListener('pointermove', e => {                       // Hover-Vorschau
    if (e.buttons) return;
    if (tool === 'edittext') { const bl = pv.textBlocks; if (bl) { const p = evtToPage(pv, e); setEditHover(pv, bl.find(b => p.x >= b.x - 3 && p.x <= b.x + b.w + 3 && p.y >= b.y - 2 && p.y <= b.y + b.h + 2)); } return; }
    if (tool !== 'select') return;
    const id = (e.target.getAttribute && e.target.getAttribute('data-id')) || null;
    if (id === pv._hoverId) return; pv._hoverId = id;
    const ha = id ? findAnno(pv.num, +id) : null; setHover(pv, (ha && ha.locked) ? null : ha);
  });
  pv.svg.addEventListener('pointerleave', () => { pv._hoverId = null; setHover(pv, null); setEditHover(pv, null); });
}
// Punkt aufs cm-Raster einrasten (nur wenn Raster an) – Linien/Formen/Text/Box „greifen"
function snapPt(x, y) { if (!gridOn) return { x, y }; const c = gridCellPt(); if (c <= 0) return { x, y }; return { x: Math.round((x - gridOffX) / c) * c + gridOffX, y: Math.round((y - gridOffY) / c) * c + gridOffY }; }
// An vorhandene Endpunkte/Knoten/Ecken einrasten (sauberes Anschliessen beim Zeichnen)
function anchorSnap(pv, x, y, excludeId) {
  const thr = 9 / pv.scale, cornerThr = 13 / pv.scale, midThr = 7 / pv.scale, lineThr = 7 / pv.scale, layerLineThr = 11 / pv.scale; let best = null, bd = cornerThr;   // Wand-Ecken etwas „klebriger", Mitte nur ganz nah
  const consider = (ax, ay, kind, t) => { const d = Math.hypot(ax - x, ay - y); if (d < (t || thr) && d < bd) { bd = d; best = { x: ax, y: ay, kind }; } };
  const considerLine = (a, b, kind, t) => { const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy; if (L2 < 1) return; let u = ((x - a[0]) * dx + (y - a[1]) * dy) / L2; if (u < 0 || u > 1) return; const px = a[0] + dx * u, py = a[1] + dy * u, d = Math.hypot(px - x, py - y); if (d < (t || lineThr) && d < bd) { bd = d; best = { x: px, y: py, kind }; } };
  const arr = getAnnos(pv.num) || [];
  for (const a of arr) {
    if (a.id === excludeId) continue;
    if (a.type === 'wall') { consider(a.x1, a.y1, 'end'); consider(a.x2, a.y2, 'end'); consider((a.x1 + a.x2) / 2, (a.y1 + a.y2) / 2, 'mid', midThr); for (const p of wallPoly(a, arr)) consider(p[0], p[1], 'corner', cornerThr);   // Achs-Enden + Mitte + die vier Band-Ecken
      if (snapLayersOn && a.layers && a.layers.length && layerVisible(a)) { const wlb = wallLayerBands(a, arr); for (const b of wlb.bands) { const q = b.poly; consider(q[0][0], q[0][1], 'layer', cornerThr); consider(q[1][0], q[1][1], 'layer', cornerThr); consider(q[2][0], q[2][1], 'layer', cornerThr); consider(q[3][0], q[3][1], 'layer', cornerThr); considerLine(q[0], q[1], 'layer', layerLineThr); considerLine(q[3], q[2], 'layer', layerLineThr); } }   // Schicht-Kanten (Bänder) einrasten – Decke/Linie/Wand exakt an eine Schicht (grösserer Fang)
    }
    else if (a.x1 != null) { consider(a.x1, a.y1, 'end'); consider(a.x2, a.y2, 'end'); consider((a.x1 + a.x2) / 2, (a.y1 + a.y2) / 2, 'mid', midThr); }
    else if (a.type === 'path') { for (const nd of a.nodes) consider(nd.x, nd.y, 'node'); }
    else if (a.type === 'slab' && a.pts && a.pts.length >= 3) { for (let i = 0; i < a.pts.length; i++) { consider(a.pts[i][0], a.pts[i][1], 'corner'); considerLine(a.pts[i], a.pts[(i + 1) % a.pts.length], 'edge'); } }   // Decken-Ecken/Kanten einrasten
    else if (a.w != null && a.x != null) { consider(a.x, a.y, 'corner'); consider(a.x + a.w, a.y, 'corner'); consider(a.x, a.y + a.h, 'corner'); consider(a.x + a.w, a.y + a.h, 'corner'); }
  }
  return best;
}
function wallProjSnap(pv, x, y, excludeId) {   // Fusspunkt auf eine vorhandene Wand-Achse (für saubere T-Stösse / Start auf Wand)
  const thr = 9 / pv.scale; let best = null, bd = thr;
  for (const o of (getAnnos(pv.num) || [])) {
    if (o.type !== 'wall' || o.id === excludeId) continue;
    const dx = o.x2 - o.x1, dy = o.y2 - o.y1, L2 = dx * dx + dy * dy; if (L2 < 1) continue;
    const t = ((x - o.x1) * dx + (y - o.y1) * dy) / L2; if (t < 0.02 || t > 0.98) continue;   // Enden macht anchorSnap
    const px = o.x1 + dx * t, py = o.y1 + dy * t, d = Math.hypot(px - x, py - y);
    if (d < bd) { bd = d; best = { x: px, y: py, kind: 'axis' }; }
  }
  return best;
}
function snapWallPt(pv, x, y, excludeId) { return anchorSnap(pv, x, y, excludeId) || wallProjSnap(pv, x, y, excludeId); }   // erst Wand-Ende, dann Wand-Achse
const SNAP_LABELS = { corner: 'Ecke', end: 'Ende', mid: 'Mitte', node: 'Knoten', axis: 'Achse' };
function snapIndicator(pv, p) {
  const g = svgEl('g', { class: 'snap-layer' }), s = 1 / pv.scale, r = 5 * s;
  if (p.kind === 'corner') g.appendChild(svgEl('rect', { x: p.x - r, y: p.y - r, width: r * 2, height: r * 2, class: 'snap-anchor' }));
  else if (p.kind === 'mid') g.appendChild(svgEl('path', { d: `M${p.x} ${p.y - r} L${p.x + r} ${p.y + r} L${p.x - r} ${p.y + r} Z`, class: 'snap-anchor' }));
  else g.appendChild(svgEl('circle', { cx: p.x, cy: p.y, r, class: 'snap-anchor' }));
  const lbl = SNAP_LABELS[p.kind]; if (lbl) { const t = svgEl('text', { x: p.x + 9 * s, y: p.y - 9 * s, class: 'snap-label', 'font-size': 11 * s }); t.textContent = lbl; g.appendChild(t); }
  pv.svg.appendChild(g);
}
/* ---------- Zeichen-Hilfslinien, Längen-/Winkel-Anzeige, exakte Längeneingabe ---------- */
let lastLine = null;   // {num,id} – zuletzt gezeichnete Linie (für „L" = exakte Länge)
function angleSnapPoint(x1, y1, x2, y2) {   // auf nächste 45°-Richtung einrasten, wenn nahe dran – sonst null
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy); if (len < 1) return null;
  let ang = Math.atan2(dy, dx) * 180 / Math.PI;
  const near = Math.round(ang / 45) * 45, diff = Math.abs(ang - near);
  const tol = (((near % 90) + 90) % 90 === 0) ? 4.5 : 2.5;   // waagrecht/senkrecht grosszügiger als 45°
  if (diff > tol) return null;
  const r = near * Math.PI / 180;
  return { x: x1 + Math.cos(r) * len, y: y1 + Math.sin(r) * len };
}
// Senkrecht/parallel zu einer am Startpunkt anliegenden Linie/Wand einrasten (= „90° von der schrägen Linie weg")
function refAngleSnap(pv, a, qx, qy) {
  const sx = a.x1, sy = a.y1, dx = qx - sx, dy = qy - sy, len = Math.hypot(dx, dy); if (len < 3) return null;
  const curAng = Math.atan2(dy, dx), near = 42 / pv.scale, tol = 3.2 * Math.PI / 180, refs = [];
  for (const o of getAnnos(pv.num)) {
    if (o === a || !isLineType(o) || o.x1 == null) continue;
    for (const [ex, ey, ox, oy] of [[o.x1, o.y1, o.x2, o.y2], [o.x2, o.y2, o.x1, o.y1]]) if (Math.hypot(ex - sx, ey - sy) < near) refs.push(Math.atan2(oy - ey, ox - ex));
  }
  for (const rf of refs) for (const k of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const target = rf + k, diff = Math.atan2(Math.sin(curAng - target), Math.cos(curAng - target));
    if (Math.abs(diff) < tol) return { x: sx + Math.cos(target) * len, y: sy + Math.sin(target) * len, perp: (((k % Math.PI) + Math.PI) % Math.PI) !== 0 };
  }
  return null;
}
let hudEl = null;
function showDrawHud(ev, a, mark) {
  if (!hudEl) { hudEl = document.createElement('div'); hudEl.className = 'draw-hud'; document.body.appendChild(hudEl); }
  const len = Math.hypot(a.x2 - a.x1, a.y2 - a.y1);
  let aDeg = Math.round(Math.atan2(-(a.y2 - a.y1), a.x2 - a.x1) * 180 / Math.PI); if (aDeg < 0) aDeg += 360;
  hudEl.textContent = (mark ? mark + '  ' : '') + fmtLen(len) + '   ·   ' + aDeg + '°';
  hudEl.style.left = (ev.clientX + 16) + 'px'; hudEl.style.top = (ev.clientY + 18) + 'px'; hudEl.hidden = false;
}
function hideDrawHud() { if (hudEl) hudEl.hidden = true; }
// Verschieben: an Seitenrändern, Seitenmitte und anderen Objekten (Kanten/Mitte) einrasten
function moveSnapAdjust(pv, a, orig, dx, dy) {
  const thr = 6 / pv.scale, b = bbox(a);
  const myX = { l: b.x, c: b.x + b.w / 2, r: b.x + b.w }, myY = { t: b.y, c: b.y + b.h / 2, b: b.y + b.h };
  const targX = [0, pv.pageW / 2, pv.pageW], targY = [0, pv.pageH / 2, pv.pageH];
  for (const o of getAnnos(pv.num)) { if (o.id === a.id) continue; const ob = bbox(o); targX.push(ob.x, ob.x + ob.w / 2, ob.x + ob.w); targY.push(ob.y, ob.y + ob.h / 2, ob.y + ob.h); }
  let bx = null, by = null;
  for (const k in myX) for (const t of targX) { const d = t - myX[k]; if (Math.abs(d) < thr && (!bx || Math.abs(d) < Math.abs(bx.d))) bx = { d, t }; }
  for (const k in myY) for (const t of targY) { const d = t - myY[k]; if (Math.abs(d) < thr && (!by || Math.abs(d) < Math.abs(by.d))) by = { d, t }; }
  const guides = [];
  if (bx) guides.push({ x1: bx.t, y1: 0, x2: bx.t, y2: pv.pageH });
  if (by) guides.push({ x1: 0, y1: by.t, x2: pv.pageW, y2: by.t });
  return { dx: dx + (bx ? bx.d : 0), dy: dy + (by ? by.d : 0), guides };
}
function parseLenToPts(str) {
  if (!str) return 0; const s = str.trim().toLowerCase().replace(',', '.');
  const m = /^([0-9]*\.?[0-9]+)\s*(mm|cm|m)?$/.exec(s); if (!m) return 0;
  const v = parseFloat(m[1]), unit = m[2];
  let meters; if (unit === 'mm') meters = v / 1000; else if (unit === 'cm') meters = v / 100; else if (unit === 'm') meters = v; else meters = docScale ? v : null;
  if (meters === null) return v / PT2MM;                 // ohne Einheit & ohne Massstab → Papier-mm
  return docScale ? meters / docScale.perPt : meters * 1000 / PT2MM;
}
function lineLenInput(pv, a) {   // „L": Linie auf exakte Länge in aktueller Richtung bringen
  const sc = pv.scale, curPts = Math.hypot(a.x2 - a.x1, a.y2 - a.y1);
  const inp = document.createElement('input'); inp.className = 'len-input';
  inp.style.left = ((a.x1 + a.x2) / 2 * sc) + 'px'; inp.style.top = ((a.y1 + a.y2) / 2 * sc) + 'px';
  const def = docScale ? (Math.round(curPts * docScale.perPt * 1000) / 1000) : Math.round(curPts * PT2MM);
  inp.value = String(def).replace('.', ','); inp.title = docScale ? 'Länge in Metern (z. B. 3,25) – oder mit cm/mm' : 'Länge in mm (Papier) – oder mit cm/m';
  pv.inner.appendChild(inp); inp.focus(); inp.select();
  let done = false;
  const apply = commit => {
    if (done) return; done = true; const val = inp.value; inp.remove();
    if (commit) { const pts = parseLenToPts(val); if (pts > 0) { pushUndo(); let ux = a.x2 - a.x1, uy = a.y2 - a.y1, l = Math.hypot(ux, uy); if (l < 0.001) { ux = 1; uy = 0; l = 1; } ux /= l; uy /= l; a.x2 = a.x1 + ux * pts; a.y2 = a.y1 + uy * pts; drawAnnos(pv); saveState(); updateSelBar(); } }
  };
  inp.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); apply(true); } else if (ev.key === 'Escape') { ev.preventDefault(); apply(false); } });
  inp.addEventListener('blur', () => apply(true));
}
function lineForLength() {
  if (sel) { const pv = pageViews.find(p => p.num === sel.num), a = pv && findAnno(pv.num, sel.id); if (a && isLineType(a)) return { pv, a }; }
  if (lastLine) { const pv = pageViews.find(p => p.num === lastLine.num), a = pv && findAnno(pv.num, lastLine.id); if (a && isLineType(a)) return { pv, a }; }
  return null;
}
/* ---------- Wand (Linie mit Dicke; Schraffuren laufen durch, Wände verschmelzen) ---------- */
function cmToPts(cm) { return cm * (docScale ? (0.01 / docScale.perPt) : (10 / PT2MM)); }
function ptsToCm(pts) { return pts / (docScale ? (0.01 / docScale.perPt) : (10 / PT2MM)); }
let lastWallThick = null, wallJust = 'center', wallHatch = null, wallHeightM = 2.6;   // Achse · Schraffur · 3D-Höhe der neuen Wand
let show3DSlabs = true;   // 3D: Geschossdecken/Bodenplatte automatisch aus dem Wand-Footprint
let wallBuildup = null, buildDraft = [], buildSpacing = 60;   // Standard-Aufbau {layers,spacing} · Entwurf [[mat,cm,sub]] · Achsabstand UK (cm)
const SUB_OPTS = [['', '— keine UK —'], ['schraube', 'Distanzschrauben'], ['lattung', 'Holzlattung'], ['staender', 'Metallständer']];
function buildMatOptions(sel) { return Object.keys(WALL_MATS).map(k => `<option value="${k}"${k === sel ? ' selected' : ''}>${WALL_MATS[k].label}</option>`).join(''); }
function buildSubOptions(sel) { return SUB_OPTS.map(([v, l]) => `<option value="${v}"${v === (sel || '') ? ' selected' : ''}>${l}</option>`).join(''); }
function updateBuildTotal() { const t = buildDraft.reduce((s, r) => s + (+r[1] || 0), 0), el = document.getElementById('bpTotal'); if (el) el.textContent = 'Gesamt: ' + (Math.round(t * 10) / 10) + ' cm'; }
function renderBuildList() {
  const list = document.getElementById('bpList'); if (!list) return; list.innerHTML = '';
  buildDraft.forEach((row, i) => {
    const r = document.createElement('div'); r.className = 'bp-row';
    const isBoard = row[0] === 'schalung', boardHtml = isBoard ? `<input class="bp-bw" type="number" step="0.5" min="0.5" value="${row[7] != null ? row[7] : 4}" title="Lattenbreite cm" style="width:44px"><span title="Lattenbreite">▯</span><input class="bp-bg" type="number" step="0.5" min="0" value="${row[8] != null ? row[8] : 2}" title="Lattenabstand cm" style="width:44px"><span title="Abstand">⇆</span>` : '';
    r.innerHTML = `<input class="bp-t" type="number" min="0.1" step="0.1" value="${row[1]}"><span>cm</span><select class="bp-m">${buildMatOptions(row[0])}</select><select class="bp-s" title="Unterkonstruktion in dieser Schicht">${buildSubOptions(row[2])}</select><input class="bp-top" type="number" step="1" value="${row[3] || 0}" title="im Schnitt: Schicht oben verlängern (+) / kürzen (−), cm" style="width:46px"><span title="oben ± cm">↑</span><input class="bp-bot" type="number" step="1" value="${row[4] || 0}" title="im Schnitt: Schicht unten verlängern (+) / kürzen (−), cm" style="width:46px"><span title="unten ± cm">↓</span><select class="bp-lm" title="Sockelzone: unten anderes Material (bis Höhe)"><option value="">— Sockel —</option>${buildMatOptions(row[5])}</select><input class="bp-lh" type="number" step="1" value="${row[6] || 0}" title="Sockelzone-Höhe ab Boden, cm" style="width:46px"><span title="Sockelhöhe cm">cm</span>${boardHtml}<button class="bp-del" title="Schicht entfernen">✕</button>`;
    r.querySelector('.bp-t').onchange = e => { buildDraft[i][1] = parseFloat((e.target.value || '').replace(',', '.')) || 0; updateBuildTotal(); };
    r.querySelector('.bp-m').onchange = e => { buildDraft[i][0] = e.target.value; renderBuildList(); };
    if (isBoard) { r.querySelector('.bp-bw').onchange = e => { buildDraft[i][7] = parseFloat((e.target.value || '').replace(',', '.')) || 4; }; r.querySelector('.bp-bg').onchange = e => { buildDraft[i][8] = parseFloat((e.target.value || '').replace(',', '.')) || 0; }; }
    r.querySelector('.bp-s').onchange = e => { buildDraft[i][2] = e.target.value; };
    r.querySelector('.bp-top').onchange = e => { buildDraft[i][3] = parseFloat((e.target.value || '').replace(',', '.')) || 0; };
    r.querySelector('.bp-bot').onchange = e => { buildDraft[i][4] = parseFloat((e.target.value || '').replace(',', '.')) || 0; };
    { const lm = r.querySelector('.bp-lm'); lm.value = row[5] || ''; lm.onchange = e => { buildDraft[i][5] = e.target.value; }; }
    r.querySelector('.bp-lh').onchange = e => { buildDraft[i][6] = parseFloat((e.target.value || '').replace(',', '.')) || 0; };
    r.querySelector('.bp-del').onclick = () => { buildDraft.splice(i, 1); renderBuildList(); };
    list.appendChild(r);
  });
  updateBuildTotal();
}
let buildupWall = null, buildupCb = null;   // Ziel-Wand + Refresh-Callback, wenn das Aufbau-Popup aus dem Laibungs-Editor kommt
function openBuildPop(target, cb) {
  buildupWall = target || null; buildupCb = cb || null;
  const presets = document.getElementById('bpPresets'); presets.innerHTML = '';
  WALL_PRESETS.forEach(p => { const b = document.createElement('button'); b.className = 'bp-preset'; b.textContent = p.name; b.onclick = () => { buildDraft = p.layers.map(l => [l[0], l[1], '', 0, 0, '', 0]); renderBuildList(); }; presets.appendChild(b); });
  const a = buildupWall || selWall();
  if (a && a.layers && a.layers.length) { buildDraft = a.layers.map(l => [l.mat, Math.round(ptsToCm(l.t) * 10) / 10, l.sub ? l.sub.type : '', Math.round((l.top || 0) * 100), Math.round((l.bot || 0) * 100), l.lowMat || '', Math.round((l.lowH || 0) * 100), l.boardW != null ? l.boardW : 4, l.boardGap != null ? l.boardGap : 2]); const sp = a.layers.find(l => l.sub); if (sp) buildSpacing = Math.round(ptsToCm(sp.sub.spacing)); }
  else if (!buildDraft.length) buildDraft = WALL_PRESETS[0].layers.map(l => [l[0], l[1], '', 0, 0, '', 0]);
  const si = document.getElementById('bpSpacing'); if (si) si.value = buildSpacing;
  const bp = document.getElementById('buildPop'); bp.style.zIndex = buildupWall ? '100002' : ''; if (buildupWall) { bp.style.position = 'fixed'; bp.style.left = '50%'; bp.style.top = '50%'; bp.style.transform = 'translate(-50%,-50%)'; bp.style.maxHeight = '88vh'; bp.style.overflow = 'auto'; } else { bp.style.position = ''; bp.style.left = ''; bp.style.top = ''; bp.style.transform = ''; }
  renderBuildList(); bp.hidden = false;
}
function applyBuildup() {
  const si = document.getElementById('bpSpacing'); if (si) buildSpacing = parseFloat((si.value || '').replace(',', '.')) || 60;
  const layers = buildDraft.filter(r => r[1] > 0).map(r => [r[0], r[1], r[2] || '', r[3] || 0, r[4] || 0, r[5] || '', r[6] || 0, r[7] != null ? r[7] : 4, r[8] != null ? r[8] : 2]);
  const a = buildupWall || selWall(); if (!buildupWall) wallBuildup = layers.length ? { layers, spacing: buildSpacing } : null;   // nur der Standard-Aufbau (für neue Wände) wenn nicht gezielt
  if (a) { pushUndo(); applyWallBuildup(a, layers, buildSpacing); pageViews.forEach(drawAnnos); saveState(); updateSelBar(); }
  document.getElementById('buildPop').hidden = true; toast(layers.length ? 'Wandaufbau angewendet ✓' : 'Aufbau entfernt');
  const cb = buildupCb; buildupWall = null; buildupCb = null; if (cb) try { cb(); } catch (_) { }
}
let stairW = null, stairRiseM = 2.6, stairBaseM = 0;   // Treppe: Breite · Geschosshöhe · Unterkante
let roofType = 'sattel', roofEaveM = 2.6, roofRidgeM = 4.0, roofAxis = 'x';   // Dach: Pult/Sattel · Traufe · First · Firstrichtung
let beamW = null, beamHM = 0.4;   // Unterzug: Breite · Höhe (hängt unter der Decke)
function beamWidthPts() { return beamW || cmToPts(24); }
function stairWidthPts() { return stairW || cmToPts(100); }
function stairSteps(a) { return a.steps || Math.max(2, Math.round((a.rise || stairRiseM) / 0.18)); }   // ~18 cm Steigung
function wallThickPts() { return lastWallThick || cmToPts(17.5); }   // Standard 17,5 cm (Backstein)
/* ---------- Komplexes Profil: frei definierter Querschnitt, entlang eines Pfades gezogen (Z-Blech, Sockel, Gesims …) ---------- */
function profilePreset(kind, p) {   // → Querschnitt-Polygon [[u,v]] in cm (u = quer/horizontal, v = Höhe)
  p = p || {}; const t = +p.t || 1.5;
  if (kind === 'zblech') { const a = +p.a || 4, h = +p.h || 12, b = +p.b || 3; return [[-a, h], [t / 2, h], [t / 2, t], [b, t], [b, 0], [-t / 2, 0], [-t / 2, h - t], [-a, h - t]]; }
  if (kind === 'sockel') { const h = +p.h || 30, d = +p.d || 3; return [[0, 0], [d, 0], [d, h], [0, h]]; }
  if (kind === 'gesims') { const h = +p.h || 20, d = +p.d || 12; return [[0, 0], [d, 0], [d, h * 0.4], [d * 0.35, h], [0, h]]; }
  if (kind === 'attika') { const h = +p.h || 25, d = +p.d || 30; return [[0, 0], [d, 0], [d, h], [0, h + d * 0.12]]; }
  if (kind === 'rinne') { const w = +p.w || 12, h = +p.h || 10, tt = +p.t || 0.7; return [[0, 0], [w, 0], [w, h], [w - tt, h], [w - tt, tt], [tt, tt], [tt, h], [0, h]]; }
  return [[0, 0], [3, 0], [3, 12], [0, 12]];
}
let curProfile = { prof: profilePreset('zblech'), elev: 3.0, name: 'Z-Blech', color: '#7a8392', mat: 'metall', closed: true };
function profileArea(prof) { let s = 0; for (let i = 0; i < prof.length; i++) { const a = prof[i], b = prof[(i + 1) % prof.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; }   // cm²
function profilePathLenM(path) { let L = 0; for (let i = 1; i < path.length; i++) L += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); return ptsToCm(L) / 100; }   // m (Plan-Länge)
function profileUSpan(prof) { let mn = Infinity, mx = -Infinity; for (const p of prof) { if (p[0] < mn) mn = p[0]; if (p[0] > mx) mx = p[0]; } return [mn, mx]; }   // cm
function wallEnds(a, arr) {   // Enden an verbundenen Stössen um halbe Dicke verlängern (saubere Aussenecke)
  let x1 = a.x1, y1 = a.y1, x2 = a.x2, y2 = a.y2;
  if (arr) { const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, ext = (a.thick || wallThickPts()) / 2;
    if (!wallEndFree(a, a.x1, a.y1, arr)) { x1 -= ux * ext; y1 -= uy * ext; }
    if (!wallEndFree(a, a.x2, a.y2, arr)) { x2 += ux * ext; y2 += uy * ext; } }
  return { x1, y1, x2, y2 };
}
function wallSideOffsets(a) { const j = a.just || 'center'; return [j === 'left' ? 1 : j === 'right' ? 0 : 0.5, j === 'left' ? 0 : j === 'right' ? -1 : -0.5]; }
function lineX(p, d, q, e) {   // Schnitt der Geraden p+t·d und q+s·e
  const den = d[0] * e[1] - d[1] * e[0]; if (Math.abs(den) < 1e-7) return null;
  const t = ((q[0] - p[0]) * e[1] - (q[1] - p[1]) * e[0]) / den;
  return [p[0] + t * d[0], p[1] + t * d[1]];
}
function wallNeighborAt(a, ex, ey, arr) {   // genau EINE andere Wand teilt diesen Endpunkt → Gehrung möglich
  const near = (a.thick || wallThickPts()) * 0.6, res = [];
  for (const o of arr) { if (o === a || o.type !== 'wall') continue; if (Math.hypot(o.x1 - ex, o.y1 - ey) < near || Math.hypot(o.x2 - ex, o.y2 - ey) < near) res.push(o); }
  return res.length === 1 ? res[0] : null;
}
function wallEdgePts(b) {   // die zwei Längskanten von b als Gerade {p, d}
  const dx = b.x2 - b.x1, dy = b.y2 - b.y1, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux, T = b.thick || wallThickPts(), o = wallSideOffsets(b);
  return [{ p: [b.x1 + nx * T * o[0], b.y1 + ny * T * o[0]], d: [ux, uy] }, { p: [b.x1 + nx * T * o[1], b.y1 + ny * T * o[1]], d: [ux, uy] }];
}
function wallPoly(a, arr) {                                              // 4 Eckpunkte des Wand-Streifens – an Stössen echt auf Gehrung geschnitten (kein Überstand)
  const dx = a.x2 - a.x1, dy = a.y2 - a.y1, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux, T = (a.thick || wallThickPts()), o = wallSideOffsets(a);
  let c1A = [a.x1 + nx * T * o[0], a.y1 + ny * T * o[0]], c2A = [a.x2 + nx * T * o[0], a.y2 + ny * T * o[0]];
  let c1B = [a.x1 + nx * T * o[1], a.y1 + ny * T * o[1]], c2B = [a.x2 + nx * T * o[1], a.y2 + ny * T * o[1]];
  if (arr) {
    const dir = [ux, uy], maxd = T * 4, D = (p, q) => (p && q) ? Math.hypot(p[0] - q[0], p[1] - q[1]) : Infinity;
    const join = (cA, cB, fromA, fromB, b, setA, setB) => {   // Kante A↔eine b-Kante, Kante B↔andere b-Kante (Kreuzung vermieden)
      const be = wallEdgePts(b);
      const a0 = lineX(fromA, dir, be[0].p, be[0].d), a1 = lineX(fromA, dir, be[1].p, be[1].d);
      const b0 = lineX(fromB, dir, be[0].p, be[0].d), b1 = lineX(fromB, dir, be[1].p, be[1].d);
      let pa, pb; if (D(a0, cA) + D(b1, cB) <= D(a1, cA) + D(b0, cB)) { pa = a0; pb = b1; } else { pa = a1; pb = b0; }
      if (pa && D(pa, cA) < maxd) setA(pa); if (pb && D(pb, cB) < maxd) setB(pb);
    };
    const nb2 = wallNeighborAt(a, a.x2, a.y2, arr); if (nb2) join(c2A, c2B, c1A, c1B, nb2, p => c2A = p, p => c2B = p);
    const nb1 = wallNeighborAt(a, a.x1, a.y1, arr); if (nb1) join(c1A, c1B, c2A, c2B, nb1, p => c1A = p, p => c1B = p);
  }
  return [c1A, c2A, c2B, c1B];
}
function wallEndFree(a, ex, ey, arr) {                             // true = freies Ende → Stirnseite zeichnen (sonst verschmelzen lassen)
  const near = (a.thick || wallThickPts()) * 0.9;
  for (const o of arr) { if (o === a || o.type !== 'wall') continue; for (const p of [[o.x1, o.y1], [o.x2, o.y2]]) if (Math.hypot(p[0] - ex, p[1] - ey) < near) return false; }
  return true;
}
function wallForThick() {
  if (sel) { const pv = pageViews.find(p => p.num === sel.num), a = pv && findAnno(pv.num, sel.id); if (a && a.type === 'wall') return { pv, a }; }
  if (lastLine) { const pv = pageViews.find(p => p.num === lastLine.num), a = pv && findAnno(pv.num, lastLine.id); if (a && a.type === 'wall') return { pv, a }; }
  return null;
}
function wallThickInput(pv, a) {   // „D": Wand-Dicke setzen (cm)
  const cur = Math.round(ptsToCm(a.thick || wallThickPts()) * 10) / 10;
  const v = prompt('Wand-Dicke in cm (z. B. 17,5 · 12,5 · 25):', String(cur).replace('.', ',')); if (v == null) return;
  const s = v.trim().toLowerCase().replace(',', '.'); const m = /^([0-9]*\.?[0-9]+)\s*(mm|cm|m)?$/.exec(s); if (!m) return;
  const pts = parseLenToPts(m[1] + (m[2] || 'cm')); if (pts > 0) { pushUndo(); a.thick = pts; lastWallThick = pts; drawAnnos(pv); saveState(); updateSelBar(); }
}
// Umriss-Segment innerhalb eines konvexen Vierecks finden → [t0,t1] oder null (zum Wegschneiden an Stössen)
function segInsideQuad(p, q, quad) {
  const cx = (quad[0][0] + quad[1][0] + quad[2][0] + quad[3][0]) / 4, cy = (quad[0][1] + quad[1][1] + quad[2][1] + quad[3][1]) / 4;
  let t0 = 0, t1 = 1;
  for (let i = 0; i < 4; i++) {
    const a = quad[i], b = quad[(i + 1) % 4]; let nx = -(b[1] - a[1]), ny = (b[0] - a[0]);
    if ((cx - a[0]) * nx + (cy - a[1]) * ny < 0) { nx = -nx; ny = -ny; }            // Normale nach innen
    const n0 = (p[0] - a[0]) * nx + (p[1] - a[1]) * ny, n1 = (q[0] - a[0]) * nx + (q[1] - a[1]) * ny, dn = n1 - n0;
    if (Math.abs(dn) < 1e-9) { if (n0 < 0) return null; }
    else { const tc = -n0 / dn; if (dn > 0) t0 = Math.max(t0, tc); else t1 = Math.min(t1, tc); }
    if (t0 > t1) return null;
  }
  return [t0, t1];
}
function shrinkQuad(q) { const cx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, cy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4, s = 0.04; return q.map(v => [v[0] + (cx - v[0]) * s, v[1] + (cy - v[1]) * s]); }
function wallOutlineSegs(a, arr) {                              // sichtbare Umriss-Segmente (Längskanten durch andere Wände weggeschnitten)
  const poly = wallPoly(a, arr), segs = [];
  for (const [p, q] of [[poly[0], poly[1]], [poly[3], poly[2]]]) {
    const ivs = [];
    for (const o of arr) { if (o === a || o.type !== 'wall') continue; const iv = segInsideQuad(p, q, shrinkQuad(wallPoly(o, arr))); if (iv && iv[1] - iv[0] > 0.01) ivs.push(iv); }
    ivs.sort((u, v) => u[0] - v[0]); let cur = 0;
    const sub = (s, e) => segs.push([[p[0] + (q[0] - p[0]) * s, p[1] + (q[1] - p[1]) * s], [p[0] + (q[0] - p[0]) * e, p[1] + (q[1] - p[1]) * e]]);
    for (const [s, e] of ivs) { if (s > cur) sub(cur, Math.min(s, 1)); cur = Math.max(cur, e); if (cur >= 1) break; }
    if (cur < 1) sub(cur, 1);
  }
  if (wallEndFree(a, a.x1, a.y1, arr)) segs.push([poly[0], poly[3]]);   // Stirn nur an freien Enden
  if (wallEndFree(a, a.x2, a.y2, arr)) segs.push([poly[1], poly[2]]);
  return segs;
}
function loadPolyClip() { if (window.polygonClipping) return; loadScript('https://cdn.jsdelivr.net/npm/polygon-clipping@0.15.7/dist/polygon-clipping.umd.js').then(() => { if (pdfDoc) pageViews.forEach(drawAnnos); }).catch(() => { }); }
function drawWallUnion(svg, walls) {   // Wandflächen vereinigen → saubere Gehrungs-Ecken; je Material (Farbe+Füllung) eine Gruppe
  try {
    const groups = {};
    for (const w of walls) { const k = wallSimple(w) ? 'BLACK' : ((w.color || '#1c242c') + '|' + (w.fill || '#ffffff')); (groups[k] || (groups[k] = [])).push(w); }
    let any = false;
    for (const k in groups) {
      const grp = groups[k], blk = k === 'BLACK', polys = grp.map(w => [wallPoly(w, walls).map(p => [p[0], p[1]])]);   // Gehrung gegen ALLE Wände
      const uni = polygonClipping.union(...polys);
      if (!uni || !uni.length) continue;
      const col = blk ? '#1c242c' : (grp[0].color || '#1c242c'), fill = blk ? '#1c242c' : (grp[0].fill || '#ffffff'), lw = grp[0].width || 1.4;
      for (const poly of uni) {
        let d = '';
        for (const ring of poly) { if (!ring.length) continue; d += 'M' + ring.map(p => p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' L ') + ' Z'; }
        if (d) svg.appendChild(svgEl('path', { d, fill, 'fill-rule': 'evenodd', stroke: col, 'stroke-width': lw, 'stroke-linejoin': 'miter', 'vector-effect': 'non-scaling-stroke' }));
      }
      any = true;
    }
    return any;
  } catch (_) { return false; }
}
let wallDimOn = true;   // neue Wände bekommen standardmässig eine Masskette (aussen Rohbau / innen Fertig)
let revealCouple = 'side';   // Laibungs-Kopplung: 'none' = nur diese Kante · 'side' = alle Kanten DERSELBEN Seite (innen ODER aussen, Standard) · 'all' = alle Kanten beide Seiten
const _angHandles = {};   // {openingId: handle} – Ziehpunkt des offenen Flügels (Öffnungswinkel ziehen)
const _revtHandles = {};   // {key: {dirx,diry}} – Ziehgriff Laibungs-Lappung (Rahmen sichtbar)
const _revoHandles = {};   // {key: {dirx,diry,li}} – Ziehgriff Laibungs-Überstand (über die Wandfläche)
function startRevealOverDrag(pv, e, id, revKey) {   // Überstand/Rücksprung der Laibungsschicht per Maus (Tiefe über die Wandfläche)
  const a = findAnno(pv.num, id), h = _revoHandles[id + '|' + revKey]; if (!a || !h) return;
  const parts = revKey.split(':'), edge = parts[0], sk = parts[1] === 'i' ? 'in' : 'out', li = +parts[2];
  a.reveals = a.reveals || {}; a.reveals[edge] = a.reveals[edge] || {};
  const lst0 = a.reveals[edge][sk] || [], o0 = (lst0[li] && lst0[li].over) || 0, start = evtToPage(pv, e); let moved = false;
  const move = ev => { const q = evtToPage(pv, ev); if (!moved) { if (Math.hypot(q.x - start.x, q.y - start.y) < 3 / pv.scale) return; pushUndo(); moved = true; } const proj = (q.x - start.x) * h.dirx + (q.y - start.y) * h.diry, ov = Math.round((o0 + ptsToCm(proj)) * 10) / 10; revealEachEdge(a, edge, sk, (er, l2) => { if (l2[li]) l2[li].over = ov; }); requestDraw(pv); };
  const up = ev => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); if (!moved) { const rel = pv.svg.querySelector('.rev-hit[data-rev="' + revKey + '"]'); if (rel) zoomToReveal(rel); drawAnnos(pv); openRevealLayerPop(pv, a, revKey, (ev && ev.clientX) || e.clientX, (ev && ev.clientY) || e.clientY); } else { drawAnnos(pv); saveState(); } };   // nur Klick (kein Ziehen) → auf die Laibung zoomen + Popup
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
}
function revealEachEdge(a, edge, sk, cb) {   // Kopplung wie im Popup: none=nur Kante, side=alle Kanten dieser Seite, all=alle Kanten beide Seiten
  const es = revealCouple === 'none' ? [edge] : ['L', 'R', 'T', 'B'], sides = revealCouple === 'all' ? ['in', 'out'] : [sk];
  for (const e of es) { a.reveals[e] = a.reveals[e] || {}; for (const s2 of sides) { if (!Array.isArray(a.reveals[e][s2])) a.reveals[e][s2] = []; cb(a.reveals[e], a.reveals[e][s2], s2); } }
}
const REV_PAL = ['#2a9d4e', '#c0392b', '#2980b9', '#d4a017', '#8e44ad', '#16a085'];   // grün, rot, blau, gelb … – Farbe pro Laibungs-Gruppe (gleiche Einstellung = gleiche Farbe)
function revealSig(o, edge, side) { const er = o.reveals && o.reveals[edge]; if (!er) return ''; const lst = side === 'in' ? er.in : er.out, bv = side === 'in' ? er.boardVisIn : er.boardVisOut, f = l => Array.isArray(l) ? l.map(x => x.mat + (x.t || 0) + (x.over || 0) + (x.len != null ? 'L' + x.len : '')).join('|') : ''; return f(lst) + '#' + (bv != null ? bv : (er.boardVis != null ? er.boardVis : '')); }
function revealGroupColor(o, edge, side) {   // gleiche Laibungs-Konfiguration → gleiche Farbe (Zugehörigkeit sichtbar, Grundriss + Schnitt konsistent)
  const seen = {}; let ci = 0, col = REV_PAL[0];
  for (const e of ['L', 'R', 'T', 'B']) for (const s of ['in', 'out']) { const sg = revealSig(o, e, s); if (!sg) continue; if (seen[sg] == null) seen[sg] = REV_PAL[(ci++) % REV_PAL.length]; if (e === edge && s === side) col = seen[sg]; }
  return col;
}
function startOpeningWidthDrag(pv, e, id, side) {   // am kurzen Ende (Kantenzone) ziehen = Breite; nur Klick (kein Ziehen) = Fenster auswählen
  const a = findAnno(pv.num, id); if (!a) return; const w = a.wallId && getAnnos(pv.num).find(o => o.id === a.wallId && o.type === 'wall'); if (!w) return;
  const ux = (w.x2 - w.x1), uy = (w.y2 - w.y1), len = Math.hypot(ux, uy) || 1, uX = ux / len, uY = uy / len, c0 = a.t * len, fixedS = c0 - side * (a.w / 2);
  const start = evtToPage(pv, e); let moved = false;
  const move = ev => { const q = evtToPage(pv, ev); if (!moved) { if (Math.hypot(q.x - start.x, q.y - start.y) < 3 / pv.scale) return; pushUndo(); moved = true; } const proj = (q.x - w.x1) * uX + (q.y - w.y1) * uY, dragS = Math.max(0, Math.min(len, proj)), newW = Math.abs(dragS - fixedS); if (newW < cmToPts(30)) return; a.w = newW; a.t = ((dragS + fixedS) / 2) / len; openingResolve(a, pv); requestDraw(pv); };
  const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); if (!moved) { sel = { num: pv.num, id: a.id }; drawAnnos(pv); updateSelBar(); } else { drawAnnos(pv); saveState(); } };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
}
function startRevealLapDrag(pv, e, id, revKey) {   // im Grundriss ziehen: wie weit die Laibung auf den Rahmen lappt (= „Rahmen sichtbar", per Seite)
  const a = findAnno(pv.num, id), h = _revtHandles[id + '|' + revKey]; if (!a || !h) return;
  const parts = revKey.split(':'), edge = parts[0], sk = parts[1] === 'i' ? 'in' : 'out';
  a.reveals = a.reveals || {}; a.reveals[edge] = a.reveals[edge] || {};
  const bvKey0 = sk === 'in' ? 'boardVisIn' : 'boardVisOut', bv0 = a.reveals[edge][bvKey0] != null ? a.reveals[edge][bvKey0] : (a.reveals[edge].boardVis != null ? a.reveals[edge].boardVis : 1), start = evtToPage(pv, e); let moved = false;
  function mv(q) { const proj = (q.x - start.x) * h.dirx + (q.y - start.y) * h.diry; const bv = Math.round((bv0 - ptsToCm(proj)) * 10) / 10; revealEachEdge(a, edge, sk, (er, l2, s2) => { er[s2 === 'in' ? 'boardVisIn' : 'boardVisOut'] = bv; }); requestDraw(pv); }
  const move = ev => { const q = evtToPage(pv, ev); if (!moved) { if (Math.hypot(q.x - start.x, q.y - start.y) < 3 / pv.scale) return; pushUndo(); moved = true; } mv(q); };
  const up = ev => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); if (!moved) { const rel = pv.svg.querySelector('.rev-hit[data-rev="' + revKey + '"]'); if (rel) zoomToReveal(rel); drawAnnos(pv); openRevealLayerPop(pv, a, revKey, (ev && ev.clientX) || e.clientX, (ev && ev.clientY) || e.clientY); } else { drawAnnos(pv); saveState(); } };   // nur Klick (kein Ziehen) → auf die Laibung zoomen + Popup
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
}
let _revThickHandles = {}, _revLenHandles = {};
function _revClickFallback(pv, a, revKey, e, ev) { const rel = pv.svg.querySelector('.rev-hit[data-rev="' + revKey + '"]'); if (rel) zoomToReveal(rel); drawAnnos(pv); openRevealLayerPop(pv, a, revKey, (ev && ev.clientX) || e.clientX, (ev && ev.clientY) || e.clientY); }
function startRevealThickDrag(pv, e, id, revKey) {   // Schicht-DICKE an ihrer Aussenkante ziehen
  const a = findAnno(pv.num, id), h = _revThickHandles[id + '|' + revKey]; if (!a || !h) return;
  const parts = revKey.split(':'), edge = parts[0], sk = parts[1] === 'i' ? 'in' : 'out', li = +parts[2];
  a.reveals = a.reveals || {}; a.reveals[edge] = a.reveals[edge] || {};
  const lst0 = a.reveals[edge][sk] || [], t0 = (lst0[li] && lst0[li].t) || 1, start = evtToPage(pv, e); let moved = false;
  const move = ev => { const q = evtToPage(pv, ev); if (!moved) { if (Math.hypot(q.x - start.x, q.y - start.y) < 3 / pv.scale) return; pushUndo(); moved = true; } const proj = (q.x - start.x) * h.dirx + (q.y - start.y) * h.diry, t = Math.max(0.1, Math.round((t0 + ptsToCm(proj)) * 10) / 10); revealEachEdge(a, edge, sk, (er, l2) => { if (l2[li]) l2[li].t = t; }); requestDraw(pv); };
  const up = ev => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); if (!moved) _revClickFallback(pv, a, revKey, e, ev); else { drawAnnos(pv); saveState(); } };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
}
function startRevealLenDrag(pv, e, id, revKey) {   // Schicht-TIEFE/LÄNGE (wie weit rein, Richtung Rahmen) an der Rahmenkante ziehen
  const a = findAnno(pv.num, id), h = _revLenHandles[id + '|' + revKey]; if (!a || !h) return;
  const parts = revKey.split(':'), edge = parts[0], sk = parts[1] === 'i' ? 'in' : 'out', li = +parts[2];
  a.reveals = a.reveals || {}; a.reveals[edge] = a.reveals[edge] || {};
  const lst0 = a.reveals[edge][sk] || [], len0 = (lst0[li] && lst0[li].len != null) ? lst0[li].len : h.depthCm, start = evtToPage(pv, e); let moved = false;
  const move = ev => { const q = evtToPage(pv, ev); if (!moved) { if (Math.hypot(q.x - start.x, q.y - start.y) < 3 / pv.scale) return; pushUndo(); moved = true; } const proj = (q.x - start.x) * h.dirx + (q.y - start.y) * h.diry, ln = Math.max(0, Math.round((len0 + ptsToCm(proj)) * 10) / 10); revealEachEdge(a, edge, sk, (er, l2) => { if (l2[li]) l2[li].len = ln; }); requestDraw(pv); };
  const up = ev => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); if (!moved) _revClickFallback(pv, a, revKey, e, ev); else { drawAnnos(pv); saveState(); } };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
}
let _dimHandles = {};
function startDimEdgeDrag(pv, e, id, key) {   // Rahmen-/Flügelmass an der Kante ziehen (frameW/sashW …); Klick = Popup
  const a = findAnno(pv.num, id), h = _dimHandles[id + '|' + key]; if (!a || !h) return;
  const base = ptsToCm(a[h.prop] != null ? a[h.prop] : cmToPts(h.def)), start = evtToPage(pv, e); let moved = false;
  const move = ev => { const q = evtToPage(pv, ev); if (!moved) { if (Math.hypot(q.x - start.x, q.y - start.y) < 3 / pv.scale) return; pushUndo(); moved = true; } const proj = (q.x - start.x) * h.dirx + (q.y - start.y) * h.diry, v = Math.max(h.min, Math.min(h.max, Math.round((base + ptsToCm(proj)) * 10) / 10)); a[h.prop] = cmToPts(v); if (typeof openingResolve === 'function') openingResolve(a, pv); requestDraw(pv); };
  const up = ev => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); if (!moved) { zoomToClick((ev && ev.clientX) || e.clientX, (ev && ev.clientY) || e.clientY); drawAnnos(pv); openFramePop(pv, a, (ev && ev.clientX) || e.clientX, (ev && ev.clientY) || e.clientY); } else { drawAnnos(pv); saveState(); } };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
}
function addHoverHL(el) { el.addEventListener('pointerenter', () => el.classList.add('hl-on')); el.addEventListener('pointerleave', () => el.classList.remove('hl-on')); return el; }   // nur das berührte Bauteil hervorheben (kein SVG-:hover auf überlappenden Flächen)
let _tipEl = null;
function showTip(text, x, y) { if (!_tipEl) { _tipEl = document.createElement('div'); _tipEl.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;background:#1c242c;color:#fff;font:11px/1.3 system-ui,sans-serif;padding:3px 7px;border-radius:5px;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.35)'; document.body.appendChild(_tipEl); } _tipEl.textContent = text; _tipEl.style.display = 'block'; _tipEl.style.left = (x + 13) + 'px'; _tipEl.style.top = (y + 13) + 'px'; }
function hideTip() { if (_tipEl) _tipEl.style.display = 'none'; }
function attachTip(el, text) { el.addEventListener('pointerenter', e => showTip(text, e.clientX, e.clientY)); el.addEventListener('pointermove', e => { if (_tipEl && _tipEl.style.display !== 'none') { _tipEl.style.left = (e.clientX + 13) + 'px'; _tipEl.style.top = (e.clientY + 13) + 'px'; } }); el.addEventListener('pointerleave', hideTip); return el; }   // schwebender Tooltip beim Drüberfahren
function revealName(edge, side, li) { const E = { L: 'links', R: 'rechts', T: 'Sturz', B: 'Brüstung' }, S = (side === 'in' || side === 'i') ? 'innen' : 'aussen'; return 'Laibung ' + S + ' ' + (E[edge] || edge) + (li != null && li !== '' ? ' · Schicht ' + (+li + 1) : ''); }   // z. B. „Laibung innen rechts"
function flipOpening(a) {   // 4 Anschlag-Varianten (Tür+Fenster): Band links/rechts × öffnet innen/aussen – nutzt winHinge + swing (Detail-Profil)
  if (a.winHinge === 'kipp') { a.winHinge = 'left'; return; } const r = a.winHinge === 'right', s = (a.swing || 1) === 1;
  if (!r && s) a.winHinge = 'right'; else if (r && s) a.swing = -1; else if (r && !s) { a.winHinge = 'left'; } else a.swing = 1;
}
function startDimOffDrag(pv, e, id) {   // Wand-Masslinie senkrecht zur Wand verschieben (setzt a.dimOff)
  const a = findAnno(pv.num, id); if (!a) return; pushUndo();
  const dx = a.x2 - a.x1, dy = a.y2 - a.y1, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len, mx = (a.x1 + a.x2) / 2, my = (a.y1 + a.y2) / 2;
  const move = ev => { const q = evtToPage(pv, ev); a.dimOff = (q.x - mx) * nx + (q.y - my) * ny; requestDraw(pv); };
  const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); saveState(); };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
}
function wallDimGeom(a) {                                            // parallele Masslinie neben der Wand (a.dimOff = von Hand verschoben)
  const dx = a.x2 - a.x1, dy = a.y2 - a.y1, len = Math.hypot(dx, dy) || 1;
  const base = (a.thick || wallThickPts()) / 2 + cmToPts(wallDimOffCm), off = (a.dimOff != null ? a.dimOff : base), side = off >= 0 ? 1 : -1;
  const nx = -dy / len, ny = dx / len, ux = dx / len, uy = dy / len;
  return { x1: a.x1 + nx * off, y1: a.y1 + ny * off, x2: a.x2 + nx * off, y2: a.y2 + ny * off, nx, ny, ux, uy, len, side, off, label: fmtLen(len) };
}
// Richtige Architektur-Masslinie: Hilfslinien (Lücke zum Bauteil, über die Masslinie hinaus) + Masslinie (über die äussersten Hilfslinien) + 45°-Schrägstriche + mitlaufender Text über/links der Linie.
function archDim(svg, p1, p2, off, col, label) {
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1], len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
  const side = off >= 0 ? 1 : -1, gap = wallDimGap, over = 4, tick = 5;
  const D = (x1, y1, x2, y2, w) => svg.appendChild(svgEl('line', { x1, y1, x2, y2, stroke: col, 'stroke-width': w || 0.7, 'vector-effect': 'non-scaling-stroke' }));
  for (const P of [p1, p2]) D(P[0] + nx * side * gap, P[1] + ny * side * gap, P[0] + nx * (off + side * over), P[1] + ny * (off + side * over));   // Maßhilfslinien
  const a1 = [p1[0] + nx * off, p1[1] + ny * off], a2 = [p2[0] + nx * off, p2[1] + ny * off];
  D(a1[0] - ux * over, a1[1] - uy * over, a2[0] + ux * over, a2[1] + uy * over, 0.9);   // Masslinie (quere), beidseitig etwas über
  const kx = (ux + nx), ky = (uy + ny), kl = Math.hypot(kx, ky) || 1, sx = kx / kl, sy = ky / kl;   // 45°-Schrägstrich
  for (const P of [a1, a2]) D(P[0] - sx * tick, P[1] - sy * tick, P[0] + sx * tick, P[1] + sy * tick, 1.1);
  let ang = Math.atan2(uy, ux) * 180 / Math.PI; while (ang >= 90) ang -= 180; while (ang < -90) ang += 180;   // immer von rechts lesbar (vertikal → -90°)
  const mx = (a1[0] + a2[0]) / 2 + nx * side * 7, my = (a1[1] + a2[1]) / 2 + ny * side * 7;
  const t = svgEl('text', { x: mx, y: my, fill: col, 'font-size': 11, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'paint-order': 'stroke', stroke: '#fff', 'stroke-width': 3, transform: `rotate(${ang.toFixed(1)} ${mx.toFixed(2)} ${my.toFixed(2)})` });
  t.textContent = label; svg.appendChild(t);
}
function openingClearW(o, wall) {   // Fertigmaß (lichte Öffnung) – Verputz zählt NICHT (immer ohne Verputz); Gips/Holz-Verkleidung schon
  if (!wall.layers || !wall.layers.length) return null;
  const LIN = ['gips', 'holz', 'konter'], l0 = wall.layers[0], lN = wall.layers[wall.layers.length - 1]; let red = 0;
  if (LIN.includes(l0.mat)) red += l0.t; if (lN !== l0 && LIN.includes(lN.mat)) red += lN.t;
  return red > 0 ? o.w - 2 * red : null;
}
function wallDimChainPrims(a, arr, off, mode) {   // Maßkette: Pfeiler | Öffnung | Pfeiler · mode 'fertig' = Licht (Laibung abgezogen), sonst Rohbau
  const prims = [], fertig = mode === 'fertig', dx = a.x2 - a.x1, dy = a.y2 - a.y1, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, nx = -uy, ny = ux, side = off >= 0 ? 1 : -1;
  const gap = wallDimGap, over = 4, tick = 5, P = (s, e) => [a.x1 + ux * s + nx * e, a.y1 + uy * s + ny * e];
  const T = a.thick || wallThickPts(), FIN = ['putz', 'gips', 'dsp'];   // Massbezug: ohne Putz → innen Tragschicht (Mauerwerk), aussen Dämmung
  let inP = 0; for (const l of (a.layers || [])) { if (FIN.includes(l.mat)) inP += l.t; else break; }
  let outP = 0; for (let i = (a.layers || []).length - 1; i >= 0; i--) { if (FIN.includes(a.layers[i].mat)) outP += a.layers[i].t; else break; }
  const putzExcl = dimWithPlaster ? 0 : (side < 0 ? inP : outP), faceE = side * Math.max(0, (T / 2) - putzExcl);   // Bezugsfläche der Maßhilfslinien (side<0 = innen)
  prims.push({ t: 'text', p: P(-over - 3, off), text: fertig ? 'F' : 'R', ang: 0, small: true });   // Kettenkennung: R=Rohbau (aussen), F=Fertig/Licht (innen)
  const ops = (arr || []).filter(o => o.type === 'opening' && o.wallId === a.id).map(o => { const ins = fertig ? openLichtInset(o) : 0; return { c: o.t * len, hw: Math.max(2, o.w / 2 - ins), w: Math.max(2, o.w - 2 * ins), ins, o }; }).sort((p, q) => p.c - q.c);
  let stn = [0]; for (const op of ops) { const l = Math.max(0, op.c - op.hw), r = Math.min(len, op.c + op.hw); if (l > stn[stn.length - 1] + 0.5) stn.push(l); stn.push(r); }
  if (len > stn[stn.length - 1] + 0.5) stn.push(len); else stn[stn.length - 1] = len;
  stn = [...new Set(stn.map(v => Math.round(v * 100) / 100))].sort((x, y) => x - y);
  prims.push({ t: 'line', a: P(-over, off), b: P(len + over, off), w: 0.9 });
  const kx = ux + nx, ky = uy + ny, kl = Math.hypot(kx, ky) || 1, sx = kx / kl, sy = ky / kl;
  for (const s of stn) { prims.push({ t: 'line', a: P(s, faceE), b: P(s, off + side * over), w: 0.7 }); const pc = P(s, off); prims.push({ t: 'line', a: [pc[0] - sx * tick, pc[1] - sy * tick], b: [pc[0] + sx * tick, pc[1] + sy * tick], w: 1.1 }); }
  let ang = Math.atan2(uy, ux) * 180 / Math.PI; while (ang >= 90) ang -= 180; while (ang < -90) ang += 180;   // immer „von rechts" lesbar (vertikal → -90°), unabhängig von Zeichenrichtung
  const hLab = m => docScale ? (Math.round(m * 100) / 100).toFixed(2) : Math.round(m * 1000) + '';
  for (let i = 0; i < stn.length - 1; i++) {
    const s0 = stn[i], s1 = stn[i + 1], mid = (s0 + s1) / 2, segLen = s1 - s0, op = ops.find(o => Math.abs(mid - o.c) < o.hw - 0.5);
    if (op) { const o2 = op.o, sill = o2.kind === 'window' ? (o2.sill || 0) : 0, head = o2.head || (o2.kind === 'window' ? 2.1 : 2.0), insM = ptsToCm(op.ins) / 100, hM = Math.max(0, head - sill - 2 * insM);
      prims.push({ t: 'text', p: P(mid, off + side * 7), text: fmtLen(op.w), ang, bold: true });          // Breite (Rohbau bzw. Licht)
      prims.push({ t: 'text', p: P(mid, off + side * 18), text: hLab(hM), ang });                          // Höhe (Brüstung→Sturz, Rohbau bzw. Licht)
    } else if (segLen > 3) prims.push({ t: 'text', p: P(mid, off + side * 7), text: fmtLen(segLen), ang });
  }
  return prims;
}
function wallDimChains(a, arr) {   // zwei Maßketten: INNEN = Rohbau (R, Bezug Tragschicht/Mauerwerk) · AUSSEN = Fertig/Licht (F, Bezug Dämmung)
  const dg = wallDimGeom(a), o = Math.abs(dg.off);
  return [...wallDimChainPrims(a, arr, -o, 'roh'), ...wallDimChainPrims(a, arr, o, 'fertig')];
}
function renderWallDimPrims(svg, prims, col) {
  for (const p of prims) {
    if (p.t === 'line') svg.appendChild(svgEl('line', { x1: p.a[0], y1: p.a[1], x2: p.b[0], y2: p.b[1], stroke: col, 'stroke-width': p.w || 0.7, 'vector-effect': 'non-scaling-stroke' }));
    else { const fs = p.small ? 9 : 11, t = svgEl('text', { x: p.p[0], y: p.p[1], fill: col, 'font-size': fs, 'font-weight': p.bold ? 700 : 400, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'paint-order': 'stroke', stroke: '#fff', 'stroke-width': 3, transform: `rotate(${p.ang.toFixed(1)} ${p.p[0].toFixed(2)} ${p.p[1].toFixed(2)})` }); t.textContent = p.text; svg.appendChild(t); }
  }
}
function wallHasOpenings(a, arr) { return (arr || []).some(o => o.type === 'opening' && o.wallId === a.id); }
function wallDimPrimsToPdf(pg, prims, Y, font, degrees, dimc) {
  for (const p of prims) {
    if (p.t === 'line') pg.drawLine({ start: { x: p.a[0], y: Y(p.a[1]) }, end: { x: p.b[0], y: Y(p.b[1]) }, thickness: p.w || 0.7, color: dimc });
    else { const fs = p.small ? 9 : 11, tw = font.widthOfTextAtSize(p.text, fs), pang = -p.ang, rad = pang * Math.PI / 180, bx = Math.cos(rad), by = Math.sin(rad), o = fs * 0.32; pg.drawText(p.text, { x: p.p[0] - bx * tw / 2 + by * o, y: Y(p.p[1]) - by * tw / 2 - bx * o, size: fs, font, color: dimc, rotate: degrees(pang) }); }
  }
}
function onPointerDown(pv, e) {
  if (e.button !== 0) return;
  if (viewOnly && tool !== 'textsel') return;   // Ansehen-Modus: keine Zeichen-/Editier-Aktionen (Text markieren bleibt erlaubt)
  let p = evtToPage(pv, e);
  const idAttr = e.target.getAttribute && e.target.getAttribute('data-id');
  const hAttr = e.target.getAttribute && e.target.getAttribute('data-h');

  if (tool === 'select') {
    const revAttr = e.target.getAttribute && e.target.getAttribute('data-rev');   // Klick auf eine Laibungs-Schicht im Grundriss → direkt editieren
    if (revAttr && idAttr) { const oo = findAnno(pv.num, +idAttr); if (oo && oo.type === 'opening') { sel = { num: pv.num, id: oo.id }; zoomToReveal(e.target); drawAnnos(pv); openRevealLayerPop(pv, oo, revAttr, e.clientX, e.clientY); return; } }   // Laibung anklicken → zentriert auf die Schicht zoomen (Kanten gross & greifbar)
    if (e.target.getAttribute && e.target.getAttribute('data-frame') && idAttr) { const oo = findAnno(pv.num, +idAttr); if (oo && oo.type === 'opening') { sel = { num: pv.num, id: oo.id }; zoomToClick(e.clientX, e.clientY); drawAnnos(pv); openFramePop(pv, oo, e.clientX, e.clientY); return; } }   // Klick auf Rahmen → direkt editieren
    if (e.target.getAttribute && e.target.getAttribute('data-ah') && idAttr) { startAngleDrag(pv, e, +idAttr); return; }   // offenen Flügel ziehen → Öffnungswinkel
    { const rt = e.target.getAttribute && e.target.getAttribute('data-revt'); if (rt && idAttr) { startRevealLapDrag(pv, e, +idAttr, rt); return; } }   // Laibung-Lappung (Rahmen sichtbar) per Maus ziehen
    { const ow = e.target.getAttribute && e.target.getAttribute('data-ow'); if (ow && idAttr) { startOpeningWidthDrag(pv, e, +idAttr, +ow); return; } }   // am kurzen Ende ziehen = Breite, Klick = auswählen
    { const ro = e.target.getAttribute && e.target.getAttribute('data-revo'); if (ro && idAttr) { startRevealOverDrag(pv, e, +idAttr, ro); return; } }   // Laibungs-Überstand per Maus ziehen
    { const rtk = e.target.getAttribute && e.target.getAttribute('data-revtk'); if (rtk && idAttr) { startRevealThickDrag(pv, e, +idAttr, rtk); return; } }   // Laibungs-Schichtdicke per Maus ziehen
    { const rln = e.target.getAttribute && e.target.getAttribute('data-revln'); if (rln && idAttr) { startRevealLenDrag(pv, e, +idAttr, rln); return; } }   // Laibungs-Tiefe/Länge per Maus ziehen
    { const dim = e.target.getAttribute && e.target.getAttribute('data-dim'); if (dim && idAttr) { startDimEdgeDrag(pv, e, +idAttr, dim); return; } }   // Rahmen-/Flügelbreite per Maus ziehen
    { const ra = e.target.getAttribute && e.target.getAttribute('data-revadd'); if (ra && idAttr) { const oo = findAnno(pv.num, +idAttr); if (oo) { const p2 = ra.split(':'), sk = p2[1] === 'i' ? 'in' : 'out', li2 = +p2[2]; pushUndo(); revealEachEdge(oo, p2[0], sk, (er, l2) => { const src = l2[li2] || l2[l2.length - 1] || { mat: 'putz', t: 1 }; l2.splice(li2 + 1, 0, { mat: src.mat, t: src.t || 1 }); }); drawAnnos(pv); saveState(); } return; } }   // + : Laibungsschicht einfügen
    { const rd = e.target.getAttribute && e.target.getAttribute('data-revdel'); if (rd && idAttr) { const oo = findAnno(pv.num, +idAttr); if (oo) { const p2 = rd.split(':'), sk = p2[1] === 'i' ? 'in' : 'out', li2 = +p2[2]; pushUndo(); revealEachEdge(oo, p2[0], sk, (er, l2) => { if (l2.length > 1 && l2[li2]) l2.splice(li2, 1); }); drawAnnos(pv); saveState(); } return; } }   // − : Laibungsschicht entfernen
    { const wallAttr = e.target.getAttribute && e.target.getAttribute('data-wall'); if (wallAttr && idAttr) { const sa = findAnno(pv.num, +idAttr); if (sa && sa.type === 'section') { sel = { num: pv.num, id: sa.id }; groupSel = null; secSelWall = +wallAttr; drawAnnos(pv); updateSelBar(); toast('Wand im Schnitt gewählt – nur deren Höhen/Schicht-Punkte. Leere Stelle klicken = alle.'); return; } } }   // Wand im Schnitt sub-wählen
    if (e.target.getAttribute && e.target.getAttribute('data-group') && groupSel && groupSel.num === pv.num) { startGroupMove(pv, e); return; }   // ganze Gruppe ziehen
    const pn = e.target.getAttribute && e.target.getAttribute('data-pn'), ph = e.target.getAttribute && e.target.getAttribute('data-ph');
    if ((pn !== null || ph !== null) && sel && sel.num === pv.num) { startNodeDrag(pv, e, sel.id, pn, ph, e.target.getAttribute('data-hk')); return; }   // Kurven-Knoten/Anfasser ziehen
    if (hAttr === 'dimoff' && sel && sel.num === pv.num) { startDimOffDrag(pv, e, sel.id); return; }   // Wand-Masslinie verschieben
    if (hAttr && hAttr.indexOf('wl:') === 0 && sel && sel.num === pv.num) { const pp = hAttr.split(':'); startLayerExtDrag(pv, e, sel.id, +pp[1], +pp[2]); return; }   // Schicht-Länge (pro Schicht/Ende) ziehen
    if (hAttr && hAttr.indexOf('sl:') === 0 && sel && sel.num === pv.num) { const pp = hAttr.split(':'); startSectionLayerDrag(pv, e, +pp[1], +pp[2], pp[3]); return; }   // Schicht-Kante im Schnitt ziehen (Ober-/Unterlänge)
    if (hAttr && hAttr.indexOf('sh:') === 0 && sel && sel.num === pv.num) { startSectionEdit(pv, e, hAttr); return; }   // Wandhöhe / Brüstung / Sturz / Decke im Schnitt ziehen
    if (hAttr === 'scflip' && sel && sel.num === pv.num) { const a = findAnno(pv.num, sel.id); if (a && a.type === 'section') { pushUndo(); a.flip = !a.flip; drawAnnos(pv); saveState(); toast('Blickrichtung gedreht'); } return; }   // Schnitt-Blickrichtung
    if (hAttr && sel && sel.num === pv.num) { startResize(pv, e, hAttr); return; }
    if (idAttr) {
      const aHit = findAnno(pv.num, +idAttr);
      if (aHit && aHit.grp != null && !e.ctrlKey && !e.metaKey) {   // Plankopf/Gruppe → ganze Gruppe wählen + ziehen (Felder per Doppelklick editierbar)
        const ids = (getAnnos(pv.num) || []).filter(x => x.grp === aHit.grp).map(x => x.id);
        if (ids.length) { sel = null; groupSel = { num: pv.num, ids }; drawAnnos(pv); updateAlignBar(); updateSelBar(); startGroupMove(pv, e); return; }
      }
      if (aHit && aHit.locked) { sel = null; groupSel = null; drawAnnos(pv); startMarquee(pv, e); return; }   // gesperrt (z. B. Rahmen) → nicht greifen, Rahmen aufziehen
      if (e.ctrlKey || e.metaKey) {   // Strg/Cmd-Klick = zur Auswahl hinzufügen / entfernen
        let ids = groupSel && groupSel.num === pv.num ? groupSel.ids.slice() : (sel && sel.num === pv.num ? [sel.id] : []);
        const k = ids.indexOf(+idAttr); if (k >= 0) ids.splice(k, 1); else ids.push(+idAttr);
        if (ids.length === 1) { sel = { num: pv.num, id: ids[0] }; groupSel = null; }
        else if (ids.length > 1) { sel = null; groupSel = { num: pv.num, ids }; }
        else { sel = null; groupSel = null; }
        drawAnnos(pv); updateAlignBar(); updateSelBar(); return;
      }
      const wasSel = sel && sel.num === pv.num && sel.id === +idAttr;   // war schon ausgewählt → Klick (ohne Ziehen) = bearbeiten
      secSelWall = null; groupSel = null; sel = { num: pv.num, id: +idAttr }; drawAnnos(pv);
      const a = findAnno(pv.num, sel.id);
      if (a && a.type === 'note') { openNoteEdit(pv, a); return; }
      if (a && a.type === 'opening') { startOpeningMove(pv, e, a); return; }   // Öffnung entlang der Wand schieben
      startMove(pv, e, a, wasSel); return;
    }
    sel = null; secSelWall = null; groupSel = null; drawAnnos(pv); startMarquee(pv, e); return;   // leerer Klick → Rahmen aufziehen
  }
  if (['line', 'arrow', 'rect', 'oval', 'arc', 'curve', 'measure', 'dim', 'wall'].includes(tool)) { const an = anchorSnap(pv, p.x, p.y); if (an) p = an; else if (gridOn) p = snapPt(p.x, p.y); }   // an Endpunkten/Knoten oder Raster einrasten
  else if (gridOn && tool !== 'eraser' && tool !== 'edittext' && tool !== 'pen' && tool !== 'highlight' && tool !== 'textsel' && tool !== 'calibrate') p = snapPt(p.x, p.y);
  if (tool === 'curve') { curveClick(pv, e, p); return; }
  if (tool === 'sig') { placeSig(pv, p); return; }
  if (tool === 'highlight') { startHighlight(pv, e, p); return; }
  if (tool === 'stamp') { placeStamp(pv, p); return; }
  if (tool === 'eraser') { startErase(pv, e); return; }
  if (tool === 'crop') { startCrop(pv, e, p); return; }
  if (tool === 'snip') { startSnip(pv, e, p); return; }
  if (tool === 'area' || tool === 'slab' || tool === 'terrain' || tool === 'floortile' || tool === 'aussparung') { areaClick(pv, p); return; }
  if (tool === 'profile') { profileClick(pv, p); return; }
  if (tool === 'block') { placeBlock(pv, p); return; }
  if (tool === 'section') { startSection(pv, e, p); return; }
  if (tool === 'chaindim' || tool === 'anschluss') { chaindimClick(pv, p); return; }
  if (tool === 'opening' || tool === 'window') { openKind = tool === 'window' ? 'window' : 'door'; openingClick(pv, p); return; }
  if (tool === 'edittext') { editTextAt(pv, p); return; }
  if (tool === 'text') { createText(pv, p); return; }
  if (tool === 'note') { pushUndo(); const a = { id: nextId++, type: 'note', x: p.x, y: p.y, color: style.color, text: '' }; pushAnno(pv.num, a); sel = { num: pv.num, id: a.id }; drawAnnos(pv); refreshComments(); openNoteEdit(pv, a); return; }
  if (segDraft && segDraft.pv === pv) { finishSegDraft(); return; }                            // 2. Klick = Linie/Wand beenden
  if (tool === 'wallchain') { let q = p; const an = snapWallPt(pv, q.x, q.y); if (an) q = an; else if (gridOn) q = snapPt(q.x, q.y); if (wallDraft && wallDraft.pv === pv) wallChainClick(pv, q); else startWallChain(pv, q.x, q.y); return; }   // Wände am Stück
  // Zeichnen
  startDraw(pv, e, p);
}

// Radierer: über Anmerkungen wischen löscht sie (nutzt die Treffer-Flächen mit data-id)
function startErase(pv, e) {
  let did = false;
  const eraseAt = ev => {
    const t = document.elementFromPoint(ev.clientX, ev.clientY); if (!t) return;
    const idEl = t.closest && t.closest('[data-id]'); if (!idEl || !pv.svg.contains(idEl)) return;
    const id = +idEl.getAttribute('data-id'); const arr = getAnnos(pv.num); const i = arr.findIndex(a => a.id === id);
    if (i >= 0 && arr[i].locked) return;   // gesperrte Plan-Elemente nicht radieren
    if (i >= 0) { if (!did) { pushUndo(); did = true; } arr.splice(i, 1); if (sel && sel.id === id) sel = null; drawAnnos(pv); if (typeof refreshComments === 'function') refreshComments(); }
  };
  eraseAt(e);
  const move = ev => eraseAt(ev);
  const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); if (did) saveState(); };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
}
/* ---------- Zuschneiden (Crop) ---------- */
function removeCropAnno() {
  if (!cropping) return; const { pv, a } = cropping; const arr = getAnnos(pv.num); const i = arr.indexOf(a); if (i >= 0) arr.splice(i, 1);
  cropping = null; if (sel && sel.id === (a && a.id)) sel = null; $('#cropBar').hidden = true;
  pageViews.forEach(drawAnnos);
}
function startCrop(pv, e, p) {
  removeCropAnno();
  const a = { id: nextId++, type: 'crop', x: p.x, y: p.y, w: 0, h: 0 }; pushAnno(pv.num, a);
  cropping = { pv, a };
  const move = ev => { const q = evtToPage(pv, ev); a.x = Math.min(p.x, q.x); a.y = Math.min(p.y, q.y); a.w = Math.abs(q.x - p.x); a.h = Math.abs(q.y - p.y); drawAnnos(pv); };
  const up = () => {
    document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
    if (a.w < 8 || a.h < 8) { removeCropAnno(); setTool('select'); return; }   // zu klein → verwerfen
    sel = { num: pv.num, id: a.id }; setTool('select'); drawAnnos(pv); $('#cropBar').hidden = false;
  };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
}
async function applyCrop(allPages) {
  if (!cropping) return; const { pv } = cropping, a = cropping.a;
  const rect = { x: a.x, y: a.y, w: a.w, h: a.h }; const num = pv.num;
  removeCropAnno();
  status('Zuschneiden …'); await new Promise(r => setTimeout(r, 10));
  try {
    pushDocUndo();
    const lib = await loadPdfLib();
    const doc = await lib.PDFDocument.load(curBytes.slice(), { ignoreEncryption: true });
    const pages = doc.getPages();
    const targets = allPages ? pages.map((_, i) => i + 1) : [num];
    for (const n of targets) {
      const pg = pages[n - 1]; let cb0; try { cb0 = pg.getCropBox(); } catch (_) { const s = pg.getSize(); cb0 = { x: 0, y: 0, width: s.width, height: s.height }; }
      // Rahmen (Seite num, y-unten von oben) → Nutzerraum. Bei „alle Seiten" denselben Rahmen relativ anwenden.
      const left = cb0.x + rect.x, top = (cb0.y + cb0.height) - rect.y;
      const w = Math.min(rect.w, cb0.width - rect.x), h = Math.min(rect.h, rect.y + rect.h > cb0.height ? cb0.height - rect.y : rect.h);
      if (w <= 1 || h <= 1) continue;
      pg.setCropBox(left, top - h, w, h);
    }
    const bytes = new Uint8Array(await doc.save());
    // Anmerkungen auf den zugeschnittenen Seiten in den neuen Ursprung verschieben
    for (const n of targets) { for (const an of (annos[n] || [])) translateAnno(an, JSON.parse(JSON.stringify(an)), -rect.x, -rect.y); }
    curBytes = bytes; await loadDoc(bytes.slice());
    status(''); toast(allPages ? 'Alle Seiten zugeschnitten ✓' : 'Seite zugeschnitten ✓');
  } catch (err) { status(''); console.error(err); toast('Zuschneiden fehlgeschlagen.'); }
}
/* ---------- Ausschnitt (Snip): Rahmen aufziehen → als PDF / in Zwischenablage / per Mail ---------- */
let snipping = null;                                                           // {pv, a} – aktiver Ausschnitt-Rahmen
function removeSnipAnno() {
  if (!snipping) return; const { pv, a } = snipping; const arr = getAnnos(pv.num); const i = arr.indexOf(a); if (i >= 0) arr.splice(i, 1);
  snipping = null; if (sel && sel.id === (a && a.id)) sel = null; const sb = $('#snipBar'); if (sb) sb.hidden = true;
  pageViews.forEach(drawAnnos);
}
function startSnip(pv, e, p) {
  removeSnipAnno();
  const a = { id: nextId++, type: 'snip', x: p.x, y: p.y, w: 0, h: 0 }; pushAnno(pv.num, a);
  snipping = { pv, a };
  const move = ev => { const q = evtToPage(pv, ev); a.x = Math.min(p.x, q.x); a.y = Math.min(p.y, q.y); a.w = Math.abs(q.x - p.x); a.h = Math.abs(q.y - p.y); drawAnnos(pv); };
  const up = () => {
    document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
    if (a.w < 8 || a.h < 8) { removeSnipAnno(); setTool('select'); return; }   // zu klein → verwerfen
    sel = { num: pv.num, id: a.id }; setTool('select'); drawAnnos(pv); const sb = $('#snipBar'); if (sb) sb.hidden = false;
  };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
}
// Ausschnitt scharf rendern: Original-Seiteninhalt + Anmerkungen (SVG-Overlay) über dem Rechteck.
async function renderSnipCanvas(pv, rect) {
  let scale = Math.max(2, Math.min(6, 2400 / Math.max(rect.w, rect.h)));       // Zielkante ~2400 px, scharf
  let tw = Math.round(rect.w * scale), th = Math.round(rect.h * scale);
  const MAX = 8000; if (tw > MAX || th > MAX) { const f = Math.min(MAX / tw, MAX / th); scale *= f; tw = Math.round(rect.w * scale); th = Math.round(rect.h * scale); }
  const cv = document.createElement('canvas'); cv.width = tw; cv.height = th;
  const ctx = cv.getContext('2d'); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, tw, th);
  // 1) Seiteninhalt (aus dem Original) scharf in den Ausschnitt rendern – eigenes Dokument, um das Live-Rendering nicht zu stören
  try {
    await loadPdfJs();
    const doc = await pdfjs.getDocument({ data: curBytes.slice() }).promise;
    try {
      const page = await doc.getPage(pv.num);
      const vp = page.getViewport({ scale });
      await page.render({ canvasContext: ctx, viewport: vp, transform: [1, 0, 0, 1, -rect.x * scale, -rect.y * scale] }).promise;
    } finally { doc.destroy(); }
  } catch (_) { /* Notfalls nur Anmerkungen */ }
  // 2) Anmerkungen (SVG) darüberlegen – exakt auf den Ausschnitt beschnitten
  const im = await snipAnnoImage(pv, rect, tw, th); if (im) try { ctx.drawImage(im, 0, 0, tw, th); } catch (_) { }
  // 3) Seiten-Drehung (90/180/270) auf das fertige Bild anwenden, damit es wie am Bildschirm liegt
  const rot = (((pageRot[pv.num] || 0) % 360) + 360) % 360;
  if (rot === 90 || rot === 180 || rot === 270) {
    const swap = rot !== 180, rc = document.createElement('canvas'); rc.width = swap ? th : tw; rc.height = swap ? tw : th;
    const rx = rc.getContext('2d'); rx.translate(rc.width / 2, rc.height / 2); rx.rotate(rot * Math.PI / 180); rx.drawImage(cv, -tw / 2, -th / 2); return rc;
  }
  return cv;
}
function snipAnnoImage(pv, rect, tw, th) {   // SVG-Overlay des Ausschnitts als Bild (Anmerkungen)
  const src = pv.svg.cloneNode(true);
  src.querySelectorAll('.snap-guide, .snap-layer, .hover-layer, .handle, [data-h], .sel-line, .dim-handle').forEach(e => e.remove());
  src.querySelectorAll('rect[fill="transparent"], polygon[fill="transparent"]').forEach(e => e.remove());
  src.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); src.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  src.setAttribute('viewBox', `${rect.x} ${rect.y} ${rect.w} ${rect.h}`); src.setAttribute('width', tw); src.setAttribute('height', th);
  src.removeAttribute('class'); src.removeAttribute('style'); src.setAttribute('preserveAspectRatio', 'none');
  const xml = new XMLSerializer().serializeToString(src), url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
  return new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = url; });
}
function snipBaseName() { return docName.replace(/\.pdf$/i, '') + '_Ausschnitt'; }
function canvasToBlob(cv) { return new Promise(res => cv.toBlob(res, 'image/png')); }
async function snipPdfBytes(cv, rect, pv) {   // Ausschnitt als eigenständige 1-Seiten-PDF (Bild in Originalgrösse in Punkten)
  const lib = await loadPdfLib(), doc = await lib.PDFDocument.create();
  const blob = await canvasToBlob(cv), png = await doc.embedPng(new Uint8Array(await blob.arrayBuffer()));
  const rot = (((pageRot[pv.num] || 0) % 360) + 360) % 360, swap = rot === 90 || rot === 270;
  const pw = swap ? rect.h : rect.w, ph = swap ? rect.w : rect.h;             // Seitengrösse = Ausschnitt in PDF-Punkten
  const pg = doc.addPage([pw, ph]); pg.drawImage(png, { x: 0, y: 0, width: pw, height: ph });
  return new Uint8Array(await doc.save());
}
async function snipDo(kind) {   // kind: 'pdf' | 'copy' | 'mail'
  if (!snipping) return; const { pv } = snipping, a = snipping.a, rect = { x: a.x, y: a.y, w: a.w, h: a.h };
  removeSnipAnno(); setTool('select');
  status('Ausschnitt wird erzeugt …'); await new Promise(r => setTimeout(r, 10));
  try {
    const cv = await renderSnipCanvas(pv, rect);
    if (kind === 'copy') {
      const blob = await canvasToBlob(cv);
      try {
        if (!navigator.clipboard || !window.ClipboardItem) throw new Error('no-clipboard');
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        status(''); toast('Ausschnitt in die Zwischenablage kopiert ✓ (Bild einfügen mit Strg+V)');
      } catch (_) {   // Zwischenablage nicht erlaubt → als PNG sichern
        const a2 = document.createElement('a'); a2.href = URL.createObjectURL(blob); a2.download = snipBaseName() + '.png'; a2.click(); setTimeout(() => URL.revokeObjectURL(a2.href), 1500);
        status(''); toast('Zwischenablage nicht möglich → als PNG gespeichert.');
      }
      return;
    }
    const bytes = await snipPdfBytes(cv, rect, pv), fname = snipBaseName() + '.pdf';
    if (kind === 'mail') {
      const file = new File([bytes], fname, { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: fname }); status(''); return; } catch (_) { /* abgebrochen → Fallback */ }
      }
      downloadBytes(bytes, fname);
      const q = ['subject=' + encodeURIComponent(snipBaseName()), 'body=' + encodeURIComponent('Hallo,\n\nim Anhang ein Planausschnitt.\n\nGruss\n\n(„' + fname + '" wurde heruntergeladen – bitte anhängen.)')];
      window.location.href = 'mailto:?' + q.join('&');
      status(''); toast('Ausschnitt-PDF heruntergeladen · Mail geöffnet → anhängen.');
      return;
    }
    downloadBytes(bytes, fname); status(''); toast('Ausschnitt als PDF gespeichert ✓');
  } catch (e) { status(''); console.error(e); toast('Ausschnitt fehlgeschlagen.'); }
}
/* ---------- Fläche messen (Polygon, m²) ---------- */
function polyArea(pts) { let s = 0; for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; s += x1 * y2 - x2 * y1; } return Math.abs(s) / 2; }
function centroid(pts) { let x = 0, y = 0; for (const p of pts) { x += p[0]; y += p[1]; } return [x / pts.length, y / pts.length]; }
function polylineLen(pts) { let s = 0; for (let i = 1; i < (pts || []).length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return s; }   // Polylinien-Gesamtlänge (offen)
function pointInPoly(p, pts) { let inside = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1]; if (((yi > p[1]) !== (yj > p[1])) && (p[0] < (xj - xi) * (p[1] - yi) / ((yj - yi) || 1e-9) + xi)) inside = !inside; } return inside; }
function areaLabel(pts) {
  const apt = polyArea(pts);
  if (docScale) { const m2 = apt * docScale.perPt * docScale.perPt; return m2 >= 0.01 ? (Math.round(m2 * 100) / 100).toString().replace('.', ',') + ' m²' : Math.round(m2 * 1e4) + ' cm²'; }
  const cm2 = apt * PT2MM * PT2MM / 100; return Math.round(cm2) + ' cm² (Papier)';
}
/* ============================================================
   Belag / Platten – reiner Rechenkern (Plattenspiegel + Wandfläche)
   Wird von den neuen Werkzeugen „Bodenbelag" und „Wandbelag" genutzt.
   Rein & headless-getestet; keine DOM-Abhängigkeit.
   ============================================================ */
// Wandfläche in m²: Länge (PDF-Punkte) × Massstab (m/Punkt) × Höhe (m)
function wallFaceAreaM2(lenPts, perPt, heightM) { return Math.max(0, lenPts * perPt) * Math.max(0, heightM); }
// Plattenspiegel-Raster: Anzahl Spalten/Zeilen, die eine Fläche B×H (m) mit Plattenmass (cm) + Fuge (mm) belegen
function tilePlan(widthM, heightM, tileWcm, tileHcm, jointMm) {
  const jw = Math.max(0, jointMm || 0) / 1000;
  const wu = tileWcm / 100 + jw, hu = tileHcm / 100 + jw;
  const cols = (wu > 0 && widthM > 0) ? Math.max(1, Math.ceil((widthM - jw) / wu)) : 0;
  const rows = (hu > 0 && heightM > 0) ? Math.max(1, Math.ceil((heightM - jw) / hu)) : 0;
  const unitM2 = Math.round((tileWcm / 100) * (tileHcm / 100) * 1e4) / 1e4;
  return { cols, rows, count: cols * rows, unitM2 };
}
// Netto-Plattenbedarf für eine Fläche (m²) inkl. Verschnitt (%), aufgerundet auf ganze Platten
function tilesForArea(areaM2, tileWcm, tileHcm, wastePct) {
  const unit = (tileWcm / 100) * (tileHcm / 100);
  if (unit <= 0 || areaM2 <= 0) return 0;
  return Math.ceil((areaM2 / unit) * (1 + Math.max(0, wastePct || 0) / 100));
}
// Startpunkt des Plattenrasters aus Bounding-Box + gewählter Ecke (center = mittig für symmetrische Randschnitte)
function tileStartPoint(minX, minY, maxX, maxY, corner, stepX, stepY) {
  if (corner === 'tr') return [maxX, minY];
  if (corner === 'bl') return [minX, maxY];
  if (corner === 'br') return [maxX, maxY];
  if (corner === 'center') return [(minX + maxX) / 2 - (stepX || 0) / 2, (minY + maxY) / 2 - (stepY || 0) / 2];
  return [minX, minY];   // 'tl' = Standard oben links
}
const DEFAULT_BELAG = { tileW: 60, tileH: 60, joint: 3, waste: 8, name: '' };   // Standard-Plattenmass 60×60, Fuge 3 mm, 8 % Verschnitt
let _tileClip = 0;   // eindeutige clipPath-IDs fürs Plattenraster
// Plattenspiegel in eine Flächen-Gruppe zeichnen (Raster ab Startpunkt, auf das Polygon geclippt) – braucht Massstab
function drawTileGrid(g, a, pv) {
  if (!a.belag || !docScale || !a.pts || a.pts.length < 3 || a._cursor) return;
  const b = a.belag, perPt = docScale.perPt, jw = Math.max(0, b.joint || 0) / 1000;
  const stepX = ((b.tileW / 100) + jw) / perPt, stepY = ((b.tileH / 100) + jw) / perPt;
  if (!(stepX > 1) || !(stepY > 1)) return;   // zu dichtes Raster → nichts zeichnen (Schutz)
  const pts = a.pts; let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const p of pts) { if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0]; if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
  const cid = 'tile' + (_tileClip++), cp = svgEl('clipPath', { id: cid });
  // Aussparungen (Schwerpunkt in der Fläche) als echtes Loch aus dem Raster ausschneiden – via polygonClipping, sonst einfacher Umriss
  const PC = window.polygonClipping, cuts = [];
  if (PC && pv) { const pa = getAnnos(pv.num) || []; for (const c of pa) if (c !== a && c.type === 'area' && c.cutout && c.pts && c.pts.length >= 3 && pointInPoly(centroid(c.pts), pts)) cuts.push([c.pts.map(p => [p[0], p[1]])]); }
  if (cuts.length) {
    try { const res = PC.difference([pts.map(p => [p[0], p[1]])], ...cuts); let d = ''; for (const poly of res) for (const ring of poly) { if (ring.length < 3) continue; d += 'M' + ring.map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join('L') + 'Z'; } cp.appendChild(svgEl('path', { d, 'clip-rule': 'evenodd' })); }
    catch (_) { cp.appendChild(svgEl('polygon', { points: pts.map(p => p[0] + ',' + p[1]).join(' ') })); }
  } else cp.appendChild(svgEl('polygon', { points: pts.map(p => p[0] + ',' + p[1]).join(' ') }));
  g.appendChild(cp);
  const gg = svgEl('g', { 'clip-path': 'url(#' + cid + ')' }), col = a.color || '#b5651d';
  const rot = b.angle === 45, cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const gin = rot ? svgEl('g', { transform: 'rotate(45 ' + cx.toFixed(2) + ' ' + cy.toFixed(2) + ')' }) : gg;   // Clip aussen (unrotierte Fläche), Raster innen gedreht
  let lx0 = minX, ly0 = minY, lx1 = maxX, ly1 = maxY;
  if (rot) { const d = Math.hypot(maxX - minX, maxY - minY) / 2 + Math.max(stepX, stepY); lx0 = cx - d; lx1 = cx + d; ly0 = cy - d; ly1 = cy + d; }   // erweitern, damit das gedrehte Raster die Fläche voll füllt
  const sx = rot ? lx0 : ((b.start && b.start[0] != null) ? b.start[0] : minX), sy = rot ? ly0 : ((b.start && b.start[1] != null) ? b.start[1] : minY);
  for (let x = sx - Math.ceil((sx - lx0) / stepX) * stepX; x <= lx1 + 0.01; x += stepX) gin.appendChild(svgEl('line', { x1: x, y1: ly0, x2: x, y2: ly1, stroke: col, 'stroke-width': 0.6, 'stroke-opacity': 0.5, 'vector-effect': 'non-scaling-stroke' }));
  for (let y = sy - Math.ceil((sy - ly0) / stepY) * stepY; y <= ly1 + 0.01; y += stepY) gin.appendChild(svgEl('line', { x1: lx0, y1: y, x2: lx1, y2: y, stroke: col, 'stroke-width': 0.6, 'stroke-opacity': 0.5, 'vector-effect': 'non-scaling-stroke' }));
  if (rot) gg.appendChild(gin);
  g.appendChild(gg);
}
function areaClick(pv, p) {
  if (!areaDraft || areaDraft.pv !== pv) {
    cancelArea(); pushUndo();
    const isSlab = tool === 'slab', isTerr = tool === 'terrain', isFloor = tool === 'floortile', isCut = tool === 'aussparung';
    const a = isSlab ? { id: nextId++, type: 'slab', pts: [[p.x, p.y]], color: '#5b6b86', base: Math.max(0, wallHeightM - 0.2), thick: 0.2 } :   // Decken-OBERKANTE auf Geschosshöhe (Unterkante = Geschosshöhe − Dicke) isTerr ? { id: nextId++, type: 'terrain', pts: [[p.x, p.y]], color: '#7a6a4a' } : isFloor ? { id: nextId++, type: 'area', pts: [[p.x, p.y]], color: '#b5651d', width: 1.4, belag: { ...DEFAULT_BELAG } } : isCut ? { id: nextId++, type: 'area', pts: [[p.x, p.y]], color: '#8a8f98', width: 1.2, cutout: 'Schrank' } : { id: nextId++, type: 'area', pts: [[p.x, p.y]], color: style.color, width: style.width };
    pushAnno(pv.num, a); areaDraft = { pv, a }; a._cursor = [p.x, p.y];   // sofort einen sichtbaren Startpunkt zeigen (Feedback beim ersten Klick)
    const onMove = ev => { if (!areaDraft) return; const q = evtToPage(areaDraft.pv, ev); areaDraft.a._cursor = [q.x, q.y]; drawAnnos(areaDraft.pv); };
    document.addEventListener('pointermove', onMove); areaDraft._onMove = onMove;
    drawAnnos(pv); if (isTerr && !areaClick._terrHint) { areaClick._terrHint = true; toast('Gelände/Terrain: Punkte klicken (offene Linie mit Erdreich-Symbol), Doppelklick/Enter = fertig.'); } else if (isSlab && !areaClick._slabHint) { areaClick._slabHint = true; toast('Decke/Boden: Ecken klicken, am Start schliessen (oder Enter). Höhe + Dicke oben in der Planungs-Leiste · erscheint in 3D.'); } else if (isFloor && !areaClick._floorHint) { areaClick._floorHint = true; toast(docScale ? 'Bodenbelag: Ecken klicken, am Start schliessen – der Plattenspiegel (60×60) erscheint automatisch. Mass/Fuge später anpassbar.' : 'Bodenbelag: Für echte Plattenzahlen zuerst den Massstab (1:n) setzen. Fläche ziehen geht trotzdem.'); } else if (!isSlab && !isTerr && !isFloor && !docScale && !areaClick._hint) { areaClick._hint = true; toast('Tipp: Für echte m² zuerst den Massstab setzen (1:n).'); }
    return;
  }
  const a = areaDraft.a, f = a.pts[0];
  if (a.type !== 'terrain' && a.pts.length >= 3 && Math.hypot(p.x - f[0], p.y - f[1]) * pv.scale < 12) { finishArea(); return; }   // am ersten Punkt schliessen (Polygon; Terrain bleibt offen)
  a.pts.push([p.x, p.y]); drawAnnos(pv);
}
function finishArea() {
  if (!areaDraft) return; const { pv, a, _onMove } = areaDraft; document.removeEventListener('pointermove', _onMove);
  delete a._cursor; areaDraft = null;
  if (a.pts.length < (a.type === 'terrain' ? 2 : 3)) { const arr = getAnnos(pv.num), i = arr.indexOf(a); if (i >= 0) arr.splice(i, 1); if (undoStack.length) undoStack.pop(); drawAnnos(pv); setTool('select'); return; }
  sel = { num: pv.num, id: a.id }; setTool('select'); drawAnnos(pv); saveState();
  if (a.belag || a.cutout) { _listTab = 'sel'; if (typeof openListPanel === 'function') openListPanel('sel'); }   // Bodenbelag/Aussparung fertig → Einstellungen gleich zeigen
}
function cancelArea() {
  if (!areaDraft) return; const { pv, a, _onMove } = areaDraft; document.removeEventListener('pointermove', _onMove);
  const arr = getAnnos(pv.num), i = arr.indexOf(a); if (i >= 0) { arr.splice(i, 1); if (undoStack.length) undoStack.pop(); }
  areaDraft = null; if (pv) drawAnnos(pv);
}
/* ---------- Profil-Pfad zeichnen (Polylinie, snappt an Wandenden) ---------- */
let profDraft = null;
function profileClick(pv, p) {
  { const an = anchorSnap(pv, p.x, p.y); if (an) p = an; else if (gridOn) p = snapPt(p.x, p.y); }
  if (!profDraft || profDraft.pv !== pv) {
    cancelProfile(); pushUndo();
    const a = { id: nextId++, type: 'profile', path: [[p.x, p.y]], prof: curProfile.prof.map(q => q.slice()), elev: curProfile.elev, name: curProfile.name, color: curProfile.color, mat: curProfile.mat, closed: false, layer: activeLayerId };
    pushAnno(pv.num, a); profDraft = { pv, a };
    const onMove = ev => { if (!profDraft) return; let q = evtToPage(pv, ev); const an = anchorSnap(pv, q.x, q.y, a.id); if (an) q = an; else if (gridOn) q = snapPt(q.x, q.y); profDraft.a._cursor = [q.x, q.y]; drawAnnos(pv); };
    document.addEventListener('pointermove', onMove); profDraft._onMove = onMove;
    drawAnnos(pv); if (!profileClick._hint) { profileClick._hint = true; toast('Profil-Pfad: Punkte klicken (rastet an Wandenden) · am Startpunkt schliessen = Runde ums Haus · Doppelklick/Enter = fertig. Profil & Höhe oben einstellbar.'); }
    return;
  }
  const a = profDraft.a, f = a.path[0];
  if (a.path.length >= 2 && Math.hypot(p.x - f[0], p.y - f[1]) * pv.scale < 12) { a.closed = true; finishProfile(); return; }
  a.path.push([p.x, p.y]); drawAnnos(pv);
}
function finishProfile() {
  if (!profDraft) return; const { pv, a, _onMove } = profDraft; document.removeEventListener('pointermove', _onMove);
  delete a._cursor; profDraft = null;
  if (a.path.length < 2) { const arr = getAnnos(pv.num), i = arr.indexOf(a); if (i >= 0) arr.splice(i, 1); if (undoStack.length) undoStack.pop(); drawAnnos(pv); setTool('select'); return; }
  sel = { num: pv.num, id: a.id }; setTool('select'); drawAnnos(pv); saveState();
}
function cancelProfile() {
  if (!profDraft) return; const { pv, a, _onMove } = profDraft; document.removeEventListener('pointermove', _onMove);
  const arr = getAnnos(pv.num), i = arr.indexOf(a); if (i >= 0) { arr.splice(i, 1); if (undoStack.length) undoStack.pop(); }
  profDraft = null; if (pv) drawAnnos(pv);
}
function openProfileEditor(cb, init) {   // Querschnitt definieren: Vorlagen (parametrisch) oder frei zeichnen (Raster, cm). init = bestehendes Profil bearbeiten
  const NS = 'http://www.w3.org/2000/svg', S = 3.4, OX = 96, OY = 178, src = init || curProfile;   // feste Frei-Zeichnen-Transformation (px/cm)
  let kind = init ? 'frei' : 'zblech', params = {}, freePts = init ? init.prof.map(p => p.slice()) : [], prof = init ? init.prof.map(p => p.slice()) : profilePreset('zblech');
  const dlg = document.createElement('div'); dlg.className = 'd3-overlay'; dlg.style.zIndex = 100000;
  dlg.innerHTML = '<div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:#fff;border-radius:12px;box-shadow:0 12px 48px rgba(0,0,0,.3);padding:18px;width:min(680px,94vw);max-height:92vh;overflow:auto;font:14px system-ui">'
    + '<div style="font-weight:600;font-size:16px;margin-bottom:10px">Profil-Querschnitt</div>'
    + '<div id="pfPresets" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px"></div>'
    + '<div style="display:flex;gap:16px;flex-wrap:wrap"><div style="flex:0 0 280px"><svg id="pfSvg" width="280" height="240" style="border:1px solid #e5e7eb;border-radius:8px;background:#fafafa"></svg><div id="pfHint" style="font-size:12px;color:#6b7280;margin-top:4px;min-height:16px"></div></div>'
    + '<div style="flex:1;min-width:200px"><div id="pfParams" style="margin-bottom:8px"></div><hr style="margin:10px 0;border:none;border-top:1px solid #eee">'
    + '<label style="display:block;margin-bottom:8px">Höhe (Bezug) <input id="pfElev" type="number" step="0.05" value="' + (src.elev != null ? src.elev : 3) + '" style="width:80px"> m</label>'
    + '<label style="display:block;margin-bottom:8px">Name <input id="pfName" type="text" value="' + (src.name || 'Profil') + '" style="width:150px"></label>'
    + '<label style="display:block;margin-bottom:8px">Farbe <input id="pfColor" type="color" value="' + (src.color || '#7a8392') + '"></label></div></div>'
    + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px"><button class="btn" id="pfCancel">Abbrechen</button><button class="btn" id="pfOk" style="background:#1c242c;color:#fff">Profil verwenden →</button></div></div>';
  document.body.appendChild(dlg);
  const svg = dlg.querySelector('#pfSvg'), $ = s => dlg.querySelector(s);
  const presetDefs = [['zblech', 'Z-Blech'], ['sockel', 'Sockel'], ['gesims', 'Gesims'], ['attika', 'Attika'], ['rinne', 'Rinne'], ['frei', 'Frei zeichnen']];
  const paramDefs = { zblech: [['a', 'Schenkel oben', 4], ['h', 'Steg/Höhe', 12], ['b', 'Schenkel unten', 3], ['t', 'Dicke', 1.5]], sockel: [['h', 'Höhe', 30], ['d', 'Tiefe', 3]], gesims: [['h', 'Höhe', 20], ['d', 'Tiefe', 12]], attika: [['h', 'Höhe', 25], ['d', 'Breite', 30]], rinne: [['w', 'Breite', 12], ['h', 'Höhe', 10], ['t', 'Dicke', 0.7]], frei: [] };
  function mk(tag, at) { const e = document.createElementNS(NS, tag); for (const k in at) e.setAttribute(k, at[k]); return e; }
  function redraw() {
    prof = kind === 'frei' ? freePts.slice() : profilePreset(kind, params);
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const col = $('#pfColor').value;
    if (kind === 'frei') {   // festes Raster + Achsen
      for (let g = -20; g <= 60; g += 5) { svg.appendChild(mk('line', { x1: OX + g * S, y1: 8, x2: OX + g * S, y2: 232, stroke: g === 0 ? '#cbd5e1' : '#eef1f4', 'stroke-width': g === 0 ? 1.2 : 1 })); svg.appendChild(mk('line', { x1: 8, y1: OY - g * S, x2: 272, y2: OY - g * S, stroke: g === 0 ? '#cbd5e1' : '#eef1f4', 'stroke-width': g === 0 ? 1.2 : 1 })); }
      const pts = freePts.map(p => (OX + p[0] * S) + ',' + (OY - p[1] * S)).join(' ');
      if (freePts.length >= 3) svg.appendChild(mk('polygon', { points: pts, fill: col + '44', stroke: col, 'stroke-width': 2 })); else if (freePts.length) svg.appendChild(mk('polyline', { points: pts, fill: 'none', stroke: col, 'stroke-width': 2 }));
      for (const p of freePts) svg.appendChild(mk('circle', { cx: OX + p[0] * S, cy: OY - p[1] * S, r: 3.5, fill: col }));
      $('#pfHint').textContent = 'Klicken = Punkt (cm-Raster) · ' + freePts.length + ' Punkte · Doppelklick/„Schliessen" = fertig';
    } else {   // Vorlage: einpassen
      let mnu = Infinity, mxu = -Infinity, mnv = Infinity, mxv = -Infinity; for (const p of prof) { mnu = Math.min(mnu, p[0]); mxu = Math.max(mxu, p[0]); mnv = Math.min(mnv, p[1]); mxv = Math.max(mxv, p[1]); }
      const pad = 28, su = Math.max(mxu - mnu, 1), sv = Math.max(mxv - mnv, 1), sc = Math.min((280 - 2 * pad) / su, (240 - 2 * pad) / sv), TX = u => pad + (u - mnu) * sc, TY = v => 240 - pad - (v - mnv) * sc;
      svg.appendChild(mk('polygon', { points: prof.map(p => TX(p[0]) + ',' + TY(p[1])).join(' '), fill: col + '44', stroke: col, 'stroke-width': 2 }));
      for (const p of prof) svg.appendChild(mk('circle', { cx: TX(p[0]), cy: TY(p[1]), r: 3, fill: col }));
      $('#pfHint').textContent = 'Querschnittsfläche ≈ ' + profileArea(prof).toFixed(1) + ' cm²';
    }
  }
  function buildParams() {
    const pp = $('#pfParams'); pp.innerHTML = '';
    (paramDefs[kind] || []).forEach(([key, lbl, def]) => { const w = document.createElement('label'); w.style.cssText = 'display:inline-block;margin:0 10px 8px 0'; w.innerHTML = lbl + ' <input type="number" step="0.1" style="width:62px"> cm'; const inp = w.querySelector('input'); inp.value = params[key] != null ? params[key] : def; inp.oninput = () => { params[key] = +inp.value; redraw(); }; pp.appendChild(w); });
    if (kind === 'frei') { const b = document.createElement('button'); b.className = 'btn'; b.textContent = '↺ Löschen'; b.onclick = () => { freePts = []; redraw(); }; const b2 = document.createElement('button'); b2.className = 'btn'; b2.textContent = '✓ Schliessen'; b2.style.marginLeft = '6px'; b2.onclick = () => redraw(); pp.appendChild(b); pp.appendChild(b2); }
  }
  const pc = $('#pfPresets'); presetDefs.forEach(([k, lbl]) => { const b = document.createElement('button'); b.className = 'btn'; b.textContent = lbl; if (k === kind) b.classList.add('on'); b.onclick = () => { kind = k; if (k !== 'frei') { params = {}; (paramDefs[k] || []).forEach(([key, , def]) => params[key] = def); } pc.querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on'); buildParams(); redraw(); }; pc.appendChild(b); });
  svg.addEventListener('click', ev => { if (kind !== 'frei') return; const r = svg.getBoundingClientRect(), u = Math.round(((ev.clientX - r.left) - OX) / S * 2) / 2, v = Math.round((OY - (ev.clientY - r.top)) / S * 2) / 2; freePts.push([u, v]); redraw(); });
  svg.addEventListener('dblclick', () => { if (kind === 'frei') redraw(); });
  $('#pfColor').oninput = redraw;
  const close = () => dlg.remove();
  $('#pfCancel').onclick = close;
  $('#pfOk').onclick = () => { const p = kind === 'frei' ? freePts.slice() : profilePreset(kind, params); if (p.length < 3) { toast('Mindestens 3 Punkte für ein Profil.'); return; } cb({ prof: p, elev: +$('#pfElev').value || 0, name: $('#pfName').value || 'Profil', color: $('#pfColor').value, mat: 'metall' }); close(); };
  buildParams(); redraw();
}
function openSlabBuildup(a, pv) {   // Decken-/Bodenaufbau: Vorlagen + freie Schichtliste (oben→unten)
  if (!a) { toast('Erst eine Decke/Platte wählen.'); return; }
  let draft = (a.layers && a.layers.length) ? a.layers.map(l => [l.mat, Math.round(l.t * 1000) / 10, Math.round((l.inset || 0) * 100)]) : SLAB_PRESETS[0].layers.map(l => l.slice());
  const dlg = document.createElement('div'); dlg.className = 'lab-overlay'; dlg.style.zIndex = 100000;
  dlg.innerHTML = '<div class="lab-wrap" style="width:min(560px,94vw);height:auto;max-height:90vh"><div class="lab-head"><b>Decken-/Bodenaufbau</b><span class="lab-hint">oben → unten</span><span class="grow"></span><button class="btn" id="sbClose">✕</button></div><div style="padding:14px;overflow:auto">'
    + '<div id="sbPresets" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px"></div><div id="sbList"></div>'
    + '<button class="btn" id="sbAdd" style="margin-top:8px">+ Schicht</button> <b id="sbTotal" style="margin-left:10px"></b>'
    + '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:14px"><button class="btn" id="sbNone">Aufbau entfernen</button><button class="btn" id="sbOk" style="background:#1c242c;color:#fff">Anwenden →</button></div></div></div>';
  document.body.appendChild(dlg);
  const $ = s => dlg.querySelector(s), matOpts = sel => Object.keys(WALL_MATS).map(k => '<option value="' + k + '"' + (k === sel ? ' selected' : '') + '>' + WALL_MATS[k].label + '</option>').join('');
  const total = () => draft.reduce((s, r) => s + (+r[1] || 0), 0);
  function renderList() { const L = $('#sbList'); L.innerHTML = ''; draft.forEach((row, i) => { const r = document.createElement('div'); r.style.cssText = 'display:flex;gap:6px;align-items:center;margin-bottom:6px'; r.innerHTML = '<input type="number" min="0.1" step="0.1" value="' + row[1] + '" style="width:60px"><span>cm</span><select style="flex:1">' + matOpts(row[0]) + '</select><input type="number" step="0.5" value="' + (row[2] || 0) + '" title="Einzug beidseitig (im Schnitt vor der Wand stoppen), cm" style="width:52px"><span title="Einzug cm">⊣⊢</span><button class="btn">✕</button>'; const inp = r.children[0], sel = r.children[2], ins = r.children[3], del = r.children[5]; inp.onchange = () => { draft[i][1] = parseFloat((inp.value || '').replace(',', '.')) || 0; $('#sbTotal').textContent = 'Gesamt: ' + (Math.round(total() * 10) / 10) + ' cm'; }; sel.onchange = () => draft[i][0] = sel.value; ins.onchange = () => draft[i][2] = parseFloat((ins.value || '').replace(',', '.')) || 0; del.onclick = () => { draft.splice(i, 1); renderList(); }; L.appendChild(r); }); $('#sbTotal').textContent = 'Gesamt: ' + (Math.round(total() * 10) / 10) + ' cm'; }
  const pc = $('#sbPresets'); SLAB_PRESETS.forEach(p => { const b = document.createElement('button'); b.className = 'btn'; b.textContent = p.name; b.onclick = () => { draft = p.layers.map(l => l.slice()); renderList(); }; pc.appendChild(b); });
  $('#sbAdd').onclick = () => { draft.push(['beton', 10]); renderList(); };
  const close = () => dlg.remove();
  $('#sbClose').onclick = close;
  $('#sbNone').onclick = () => { pushUndo(); applySlabBuildup(a, null); pageViews.forEach(drawAnnos); saveState(); close(); toast('Aufbau entfernt'); };
  $('#sbOk').onclick = () => { const layers = draft.filter(r => r[1] > 0).map(r => [r[0], r[1], r[2] || 0]); if (!layers.length) { toast('Mindestens eine Schicht.'); return; } pushUndo(); applySlabBuildup(a, layers); pageViews.forEach(drawAnnos); saveState(); close(); toast('Deckenaufbau angewendet ✓ (' + (Math.round(total() * 10) / 10) + ' cm)'); };
  renderList();
}
/* ---------- Kettenmass (mehrere Stationen klicken → Masskette mit Einzelmassen) ---------- */
let cdimDraft = null;
function chaindimClick(pv, p) {
  { const an = anchorSnap(pv, p.x, p.y); if (an) p = an; else if (gridOn) p = snapPt(p.x, p.y); }   // an Endpunkte/Raster
  if (!cdimDraft || cdimDraft.pv !== pv) {
    cancelChaindim(); pushUndo();
    const a = { id: nextId++, type: 'chaindim', pts: [[p.x, p.y]], color: tool === 'anschluss' ? '#8a5a2a' : style.color };
    if (tool === 'anschluss') a.anschluss = 'boden';   // Anschluss = getaggtes Kettenmass (Polylinie, lfm)
    pushAnno(pv.num, a); cdimDraft = { pv, a };
    const onMove = ev => { if (!cdimDraft) return; let q = evtToPage(pv, ev); const an = anchorSnap(pv, q.x, q.y, a.id); if (an) q = an; else if (gridOn) q = snapPt(q.x, q.y); cdimDraft.a._cursor = [q.x, q.y]; drawAnnos(pv); };
    document.addEventListener('pointermove', onMove); cdimDraft._onMove = onMove;
    drawAnnos(pv); if (!docScale && !chaindimClick._hint) { chaindimClick._hint = true; toast('Tipp: Für echte Masse zuerst den Massstab setzen (1:n). Klicken = Station · Doppelklick/Enter = fertig.'); }
    return;
  }
  cdimDraft.a.pts.push([p.x, p.y]); drawAnnos(pv);
}
function finishChaindim() {
  if (!cdimDraft) return; const { pv, a, _onMove } = cdimDraft; document.removeEventListener('pointermove', _onMove);
  delete a._cursor; cdimDraft = null;
  if (a.pts.length < 2) { const arr = getAnnos(pv.num), i = arr.indexOf(a); if (i >= 0) arr.splice(i, 1); if (undoStack.length) undoStack.pop(); drawAnnos(pv); return; }
  sel = { num: pv.num, id: a.id }; drawAnnos(pv); saveState();
  if (a.anschluss) { _listTab = 'sel'; if (typeof openListPanel === 'function') openListPanel('sel'); }   // Anschluss fertig → Art wählen
}
function cancelChaindim() {
  if (!cdimDraft) return; const { pv, a, _onMove } = cdimDraft; document.removeEventListener('pointermove', _onMove);
  const arr = getAnnos(pv.num), i = arr.indexOf(a); if (i >= 0) { arr.splice(i, 1); if (undoStack.length) undoStack.pop(); }
  cdimDraft = null; if (pv) drawAnnos(pv);
}
// Geometrie: Stationen auf die Basislinie (erster→letzter Punkt) projizieren
function chainDimStations(pts) {
  const f = pts[0], l = pts[pts.length - 1]; let dx = l[0] - f[0], dy = l[1] - f[1], len = Math.hypot(dx, dy); if (len < 1) return null;
  const ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
  const st = pts.map(p => { const t = (p[0] - f[0]) * ux + (p[1] - f[1]) * uy; return { p, t, proj: [f[0] + ux * t, f[1] + uy * t] }; }).sort((a, b) => a.t - b.t);
  return { ux, uy, nx, ny, st };
}

/* ---------- Kurven-Werkzeug (Bézier, wie Illustrator-Zeichenstift) ---------- */
let penDraft = null, _curveHover = null;
function pathD(a) {
  const n = a.nodes; if (!n.length) return '';
  let d = `M ${n[0].x} ${n[0].y}`;
  for (let i = 1; i < n.length; i++) { const p0 = n[i - 1], p1 = n[i]; d += ` C ${p0.hOut.x} ${p0.hOut.y} ${p1.hIn.x} ${p1.hIn.y} ${p1.x} ${p1.y}`; }
  if (a.closed && n.length > 1) { const p0 = n[n.length - 1], p1 = n[0]; d += ` C ${p0.hOut.x} ${p0.hOut.y} ${p1.hIn.x} ${p1.hIn.y} ${p1.x} ${p1.y} Z`; }
  return d;
}
function cubicPt(p0, c1, c2, p1, t) { const u = 1 - t, A = u * u * u, B = 3 * u * u * t, C = 3 * u * t * t, D = t * t * t; return { x: A * p0.x + B * c1.x + C * c2.x + D * p1.x, y: A * p0.y + B * c1.y + C * c2.y + D * p1.y }; }
function flattenPath(a) {
  const n = a.nodes, out = []; if (!n.length) return out; out.push({ x: n[0].x, y: n[0].y });
  const seg = (p0, p1) => { for (let k = 1; k <= 14; k++) out.push(cubicPt({ x: p0.x, y: p0.y }, p0.hOut, p1.hIn, { x: p1.x, y: p1.y }, k / 14)); };
  for (let i = 1; i < n.length; i++) seg(n[i - 1], n[i]); if (a.closed && n.length > 1) seg(n[n.length - 1], n[0]); return out;
}
function attachCurveHover() { detachCurveHover(); _curveHover = ev => { if (!penDraft || ev.buttons) return; const pv = penDraft.pv; let q = evtToPage(pv, ev); const an = anchorSnap(pv, q.x, q.y, penDraft.a.id); if (an) q = an; else if (gridOn) q = snapPt(q.x, q.y); penDraft.a._preview = { x: q.x, y: q.y }; drawAnnos(pv); }; document.addEventListener('pointermove', _curveHover); }
function detachCurveHover() { if (_curveHover) { document.removeEventListener('pointermove', _curveHover); _curveHover = null; } }
function curveClick(pv, e, p) {
  if (!penDraft || penDraft.pv !== pv) { cancelCurve(); pushUndo(); const a = { id: nextId++, type: 'path', nodes: [], closed: false, color: style.color, width: style.width, fill: 'none' }; pushAnno(pv.num, a); penDraft = { pv, a }; attachCurveHover(); }
  const a = penDraft.a;
  if (a.nodes.length >= 2) { const f = a.nodes[0]; if (Math.hypot(p.x - f.x, p.y - f.y) * pv.scale < 12) { a.closed = true; finishCurve(); return; } }   // am ersten Punkt schliessen
  const node = { x: p.x, y: p.y, hIn: { x: p.x, y: p.y }, hOut: { x: p.x, y: p.y } }; a.nodes.push(node);
  const dragMove = ev => { const q = evtToPage(pv, ev); node.hOut = { x: q.x, y: q.y }; node.hIn = { x: 2 * node.x - q.x, y: 2 * node.y - q.y }; drawAnnos(pv); };   // ziehen = Kurvenanfasser
  const dragUp = () => { document.removeEventListener('pointermove', dragMove); document.removeEventListener('pointerup', dragUp); drawAnnos(pv); };
  document.addEventListener('pointermove', dragMove); document.addEventListener('pointerup', dragUp);
}
function nearestOnPath(a, px, py) {
  const n = a.nodes; if (n.length < 2) return null; let best = null;
  const chk = (i, p0, p1, p2, p3) => { for (let k = 0; k <= 24; k++) { const t = k / 24, pt = cubicPt(p0, p1, p2, p3, t), d = Math.hypot(pt.x - px, pt.y - py); if (!best || d < best.dist) best = { seg: i, t, dist: d }; } };
  for (let i = 0; i < n.length - 1; i++) chk(i, { x: n[i].x, y: n[i].y }, n[i].hOut, n[i + 1].hIn, { x: n[i + 1].x, y: n[i + 1].y });
  if (a.closed && n.length > 1) chk(n.length - 1, { x: n[n.length - 1].x, y: n[n.length - 1].y }, n[n.length - 1].hOut, n[0].hIn, { x: n[0].x, y: n[0].y });
  return best;
}
function addPathNode(a, seg, t) {
  const n = a.nodes, i = seg, j = (i + 1) % n.length;
  const lerp = (A, B) => ({ x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t });
  const p0 = { x: n[i].x, y: n[i].y }, p1 = { x: n[i].hOut.x, y: n[i].hOut.y }, p2 = { x: n[j].hIn.x, y: n[j].hIn.y }, p3 = { x: n[j].x, y: n[j].y };
  const aa = lerp(p0, p1), bb = lerp(p1, p2), cc = lerp(p2, p3), dd = lerp(aa, bb), ee = lerp(bb, cc), ff = lerp(dd, ee);   // de Casteljau (formtreu)
  n[i].hOut = aa; n[j].hIn = cc;
  n.splice(i + 1, 0, { x: ff.x, y: ff.y, hIn: { x: dd.x, y: dd.y }, hOut: { x: ee.x, y: ee.y } });
}
function finishCurve() {
  if (!penDraft) return; const { pv, a } = penDraft; detachCurveHover(); delete a._preview; penDraft = null;
  if (a.nodes.length < 2) { const arr = getAnnos(pv.num), i = arr.indexOf(a); if (i >= 0) arr.splice(i, 1); if (undoStack.length) undoStack.pop(); drawAnnos(pv); return; }
  sel = null; drawAnnos(pv); saveState();   // Kurven-Werkzeug bleibt aktiv → nächste Kurve zeichnen (V/Esc = auswählen/bearbeiten)
}
function cancelCurve() {
  if (!penDraft) return; const { pv, a } = penDraft; detachCurveHover();
  const arr = getAnnos(pv.num), i = arr.indexOf(a); if (i >= 0) { arr.splice(i, 1); if (undoStack.length) undoStack.pop(); }
  penDraft = null; if (pv) drawAnnos(pv);
}
// Bild (Foto/Logo) auf die aktuelle Seite platzieren – verschieb-/skalierbar
function pickImage() {
  if (!pdfDoc) { toast('Erst ein Dokument öffnen oder eine Seite anlegen.'); return; }
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = e => { if (e.target.files && e.target.files[0]) placeImageFile(e.target.files[0]); };
  inp.click();
}
function place3DImage(data, wpx, hpx) {   // 3D-Screenshot als Bild auf die aktuelle Seite legen
  if (!pdfDoc) { toast('Erst ein Dokument öffnen oder neu starten.'); return; }
  const n = curPage(), pv = pageViews.find(p => p.num === n) || pageViews[0]; if (!pv) return;
  const ratio = (wpx / hpx) || 1.5; let w = Math.min(pv.pageW * 0.5, 380), h = w / ratio; if (h > pv.pageH * 0.6) { h = pv.pageH * 0.6; w = h * ratio; }
  pushUndo();
  const a = { id: nextId++, type: 'img', data, x: (pv.pageW - w) / 2, y: (pv.pageH - h) / 2, w, h };
  pushAnno(n, a); sel = { num: n, id: a.id }; setTool('select'); drawAnnos(pv); saveState();
  toast('3D-Ansicht als Bild auf die Seite gelegt – verschieben/skalieren möglich.');
}
const IMPORT_SUBTYPES = ['Text', 'FreeText', 'Line', 'Square', 'Circle', 'Ink', 'Highlight', 'PolyLine', 'Polygon'];
function annColHex(c) { if (!c || c.length < 3) return '#1c242c'; const h = v => ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2); return '#' + h(c[0]) + h(c[1]) + h(c[2]); }
function ptList(arr, fy) {   // pdf.js Punktlisten: [{x,y}…] ODER flach [x,y,x,y…]
  const out = []; if (!arr || !arr.length) return out;
  if (typeof arr[0] === 'object' && arr[0] != null && 'x' in arr[0]) { for (const p of arr) out.push([p.x, fy(p.y)]); }
  else { for (let i = 0; i + 1 < arr.length; i += 2) out.push([arr[i], fy(arr[i + 1])]); }
  return out;
}
function convertAnnot(an, H) {   // native PDF-Annotation → Submit-Anmerkung
  const fy = y => H - y, col = annColHex(an.color), r = an.rect || [0, 0, 0, 0];
  const L = Math.min(r[0], r[2]), R = Math.max(r[0], r[2]), T = Math.max(r[1], r[3]), B = Math.min(r[1], r[3]), box = { x: L, y: fy(T), w: R - L, h: T - B };
  try {
    switch (an.subtype) {
      case 'Text': return { type: 'note', x: box.x, y: box.y, text: an.contents || '' };
      case 'FreeText': return { type: 'text', x: box.x, y: box.y, w: Math.max(40, box.w), h: Math.max(16, box.h), text: an.contents || '', size: 12, color: col };
      case 'Square': return { type: 'rect', x: box.x, y: box.y, w: box.w, h: box.h, color: col, fill: 'none', width: 1.5 };
      case 'Circle': return { type: 'oval', x: box.x, y: box.y, w: box.w, h: box.h, color: col, fill: 'none', width: 1.5 };
      case 'Line': { const lc = an.lineCoordinates || [r[0], r[1], r[2], r[3]], le = an.lineEndings, arrow = le && ((le[0] && le[0] !== 'None') || (le[1] && le[1] !== 'None')); return { type: arrow ? 'arrow' : 'line', x1: lc[0], y1: fy(lc[1]), x2: lc[2], y2: fy(lc[3]), color: col, width: 1.5 }; }
      case 'Ink': { const pts = []; for (const pl of (an.inkLists || [])) pts.push(...ptList(pl, fy)); return pts.length >= 2 ? { type: 'pen', pts, color: col, width: 1.6 } : null; }
      case 'PolyLine': case 'Polygon': { const pts = ptList(an.vertices, fy); return pts.length >= 2 ? { type: 'pen', pts, color: col, width: 1.6 } : null; }
      case 'Highlight': { const rects = []; for (const q of (an.quadPoints || [])) { const p = ptList(q, fy); if (p.length >= 4) { const xs = p.map(a => a[0]), ys = p.map(a => a[1]); rects.push({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }); } } return rects.length ? { type: 'highlight', rects, color: col } : null; }
    }
  } catch (_) { }
  return null;
}
async function stripPdfAnnotations(bytes) {   // native Markup-Annotationen aus dem PDF entfernen (Formfelder/Links bleiben)
  const lib = await loadPdfLib(), { PDFDocument, PDFName } = lib, doc = await PDFDocument.load(bytes.slice(), { ignoreEncryption: true });
  for (const pg of doc.getPages()) {
    let annots; try { annots = pg.node.Annots(); } catch (_) { annots = null; } if (!annots || !annots.size) continue;
    const keep = [];
    for (let i = 0; i < annots.size(); i++) { const ref = annots.get(i); let st = ''; try { const d = doc.context.lookup(ref); const sub = d.get(PDFName.of('Subtype')); st = sub ? String(sub).replace(/^\//, '') : ''; } catch (_) { } if (st === 'Widget' || st === 'Link') keep.push(ref); }
    try { pg.node.set(PDFName.of('Annots'), doc.context.obj(keep)); } catch (_) { }
  }
  return new Uint8Array(await doc.save());
}
async function importPdfAnnotations(autoPrompt) {
  if (!pdfDoc) return;
  const found = [];
  try { for (let n = 1; n <= pdfDoc.numPages; n++) { const page = await pdfDoc.getPage(n), H = page.getViewport({ scale: 1 }).height, anns = await page.getAnnotations(); for (const an of anns) if (IMPORT_SUBTYPES.includes(an.subtype)) found.push({ n, an, H }); } } catch (_) { }
  if (!found.length) { if (!autoPrompt) toast('Keine importierbaren PDF-Anmerkungen gefunden.'); return; }
  if (autoPrompt && !confirm('Dieses PDF enthält ' + found.length + ' Anmerkung(en) aus einem anderen Programm (z. B. Acrobat/Drawboard).\n\nIn bearbeitbare Anmerkungen umwandeln?')) return;
  status('Anmerkungen werden importiert …'); await new Promise(r => setTimeout(r, 20));
  pushUndo(); let ok = 0;
  for (const f of found) { const a = convertAnnot(f.an, f.H); if (a) { a.id = nextId++; a.layer = activeLayerId; if (!annos[f.n]) annos[f.n] = []; annos[f.n].push(a); ok++; } }
  try { curBytes = await stripPdfAnnotations(curBytes); if (docs[active]) docs[active].bytes = curBytes; } catch (e) { console.warn('strip failed', e); }
  saveState(); await loadDoc(curBytes.slice(), true); if (docs[active]) docs[active].pdfDoc = pdfDoc;
  status(''); toast(ok + ' Anmerkung(en) importiert – jetzt anwählbar & bearbeitbar.');
}
async function placeImageFile(file) {
  if (!pdfDoc) return;
  try {
    const url = URL.createObjectURL(file);
    const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const cv = document.createElement('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight;
    cv.getContext('2d').drawImage(im, 0, 0); URL.revokeObjectURL(url);
    const data = cv.toDataURL('image/png');
    const n = curPage(), pv = pageViews.find(p => p.num === n) || pageViews[0]; if (!pv) return;
    const ratio = (im.naturalWidth / im.naturalHeight) || 1;
    let w = Math.min(pv.pageW * 0.6, im.naturalWidth), h = w / ratio;
    if (h > pv.pageH * 0.7) { h = pv.pageH * 0.7; w = h * ratio; }
    pushUndo();
    const a = { id: nextId++, type: 'img', data, x: (pv.pageW - w) / 2, y: (pv.pageH - h) / 2, w, h };
    pushAnno(n, a); sel = { num: n, id: a.id }; setTool('select'); drawAnnos(pv); saveState();
    toast('Bild eingefügt – verschieben/skalieren möglich.');
  } catch (e) { console.error(e); toast('Bild konnte nicht eingefügt werden.'); }
}
// Bild-Platzhalter (Folien-Vorlage) per Doppelklick mit einem Bild füllen (eingepasst)
function fillImgPlaceholder(pv, a) {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = async e => {
    const file = e.target.files && e.target.files[0]; if (!file) return;
    try {
      const url = URL.createObjectURL(file);
      const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const cv = document.createElement('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight; cv.getContext('2d').drawImage(im, 0, 0); URL.revokeObjectURL(url);
      const data = cv.toDataURL('image/png'), ratio = (im.naturalWidth / im.naturalHeight) || 1;
      let w = a.w, h = w / ratio; if (h > a.h) { h = a.h; w = h * ratio; }          // in die Box einpassen
      const x = a.x + (a.w - w) / 2, y = a.y + (a.h - h) / 2;
      pushUndo();
      const arr = getAnnos(pv.num), idx = arr.indexOf(a), img = { id: nextId++, type: 'img', data, x, y, w, h, layer: a.layer != null ? a.layer : activeLayerId };
      if (idx >= 0) arr.splice(idx, 1, img); else arr.push(img);
      sel = { num: pv.num, id: img.id }; drawAnnos(pv); saveState();
    } catch (err) { console.error(err); toast('Bild konnte nicht eingefügt werden.'); }
  };
  inp.click();
}
function wallSnapPoint(pv, x, y, w) {   // (x,y) auf EINE Wand einrasten: JEDE Schichtgrenze als Linie (Decke quer durch die Schichten klipsbar) + Wand-Aussenecken
  const arr = getAnnos(pv.num) || [], cThr = 12 / pv.scale, lThr = 13 / pv.scale; let best = null, bd = Infinity;
  const consider = (ax, ay) => { const d = Math.hypot(ax - x, ay - y); if (d < cThr && d < bd) { bd = d; best = { x: ax, y: ay }; } };
  const considerLine = (p, q) => { const dx = q[0] - p[0], dy = q[1] - p[1], L2 = dx * dx + dy * dy; if (L2 < 1) return; let u = ((x - p[0]) * dx + (y - p[1]) * dy) / L2; if (u < -0.04 || u > 1.04) return; u = Math.max(0, Math.min(1, u)); const px = p[0] + dx * u, py = p[1] + dy * u, d = Math.hypot(px - x, py - y); if (d < lThr && d < bd) { bd = d; best = { x: px, y: py }; } };
  for (const p of wallPoly(w, arr)) consider(p[0], p[1]);   // nur die vier Aussenecken (Gebäudeecke)
  if (w.layers && w.layers.length) { const wlb = wallLayerBands(w, arr); for (const b of wlb.bands) { const q = b.poly; considerLine(q[0], q[1]); considerLine(q[3], q[2]); } }   // JEDE Schichtgrenze als Linie → quer durch die Schichten an jede einrasten
  return best;
}
function wallLayerGuides(pv, w) {   // Schicht-Kanten EINER Wand als Hilfslinien (nur die aktive Wand zeigen)
  const arr = getAnnos(pv.num) || [], g = []; if (!(w.layers && w.layers.length)) return g;
  const wlb = wallLayerBands(w, arr); for (const b of wlb.bands) { const q = b.poly; g.push({ x1: q[0][0], y1: q[0][1], x2: q[1][0], y2: q[1][1] }); g.push({ x1: q[3][0], y1: q[3][1], x2: q[2][0], y2: q[2][1] }); }
  return g;
}
function startMove(pv, e, a, wasSel) {
  if (!a) return; const start = evtToPage(pv, e); pushUndo(); let moved = false;
  const orig = JSON.parse(JSON.stringify(a));
  const cx = pv.pageW / 2, cy = pv.pageH / 2, thr = 6 / pv.scale;
  const removeGuides = () => pv.svg.querySelectorAll('.snap-guide').forEach(g => g.remove());
  const ox = orig.x1 != null ? orig.x1 : orig.x != null ? orig.x : (orig.pts ? orig.pts[0][0] : (orig.rects && orig.rects[0] ? orig.rects[0].x : 0));   // Ankerpunkt fürs Raster
  const oy = orig.y1 != null ? orig.y1 : orig.y != null ? orig.y : (orig.pts ? orig.pts[0][1] : (orig.rects && orig.rects[0] ? orig.rects[0].y : 0));
  const move = ev => {
    const q = evtToPage(pv, ev); let dx = q.x - start.x, dy = q.y - start.y; moved = true;
    let guides = [];
    if (gridOn && !ev.altKey) {                          // aufs Raster einrasten (Ankerpunkt)
      const sp = snapPt(ox + dx, oy + dy); dx = sp.x - ox; dy = sp.y - oy; translateAnno(a, orig, dx, dy);
    } else {
      translateAnno(a, orig, dx, dy);
      if (!ev.altKey) {                                  // einrasten (Alt = frei)
        if (a.type === 'wall' || a.type === 'slab' || a.type === 'area' || a.type === 'terrain') {   // NUR die nächste Wand erkennen → an deren Schichtkanten sauber einrasten (keine Hilfslinien-Flut)
          const pts = a.type === 'wall' ? [[a.x1, a.y1], [a.x2, a.y2]] : (a.pts || []); let bd = 18 / pv.scale, best = null, bw = null;
          for (const o of (getAnnos(pv.num) || [])) { if (o.type !== 'wall' || o.id === a.id || !layerVisible(o)) continue; for (const pt of pts) { const an = wallSnapPoint(pv, pt[0], pt[1], o); if (an) { const d = Math.hypot(an.x - pt[0], an.y - pt[1]); if (d < bd) { bd = d; best = { ddx: an.x - pt[0], ddy: an.y - pt[1], gx: an.x, gy: an.y }; bw = o; } } } }
          if (bw) { dx += best.ddx; dy += best.ddy; translateAnno(a, orig, dx, dy); guides = wallLayerGuides(pv, bw).concat([{ x1: best.gx - 9, y1: best.gy, x2: best.gx + 9, y2: best.gy }, { x1: best.gx, y1: best.gy - 9, x2: best.gx, y2: best.gy + 9 }]); }   // nur die Schicht-Kanten DIESER Wand + Fadenkreuz
          else { const s = moveSnapAdjust(pv, a, orig, dx, dy); if (s.dx !== dx || s.dy !== dy) { dx = s.dx; dy = s.dy; translateAnno(a, orig, dx, dy); } guides = s.guides; }
        } else {
          const s = moveSnapAdjust(pv, a, orig, dx, dy);
          if (s.dx !== dx || s.dy !== dy) { dx = s.dx; dy = s.dy; translateAnno(a, orig, dx, dy); }
          guides = s.guides;
        }
      }
    }
    drawAnnos(pv); removeGuides();
    for (const g of guides) pv.svg.appendChild(svgEl('line', { x1: g.x1, y1: g.y1, x2: g.x2, y2: g.y2, class: 'snap-guide' }));
  };
  const up = () => {
    document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); removeGuides();
    if (!moved) {
      undoStack.pop();
      if (wasSel && editingId == null && (a.type === 'text' || a.type === 'edit')) {   // reiner Klick auf bereits gewählten Text → bearbeiten
        if (a.type === 'text') openTextAnnoEdit(pv, a); else openEditEdit(pv, a, false);
      }
    } else { saveState(); refreshComments(); }
  };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
}
// Endpunkt auf 15°-Schritte zum Festpunkt (ax,ay) einrasten (Shift beim Ziehen)
function snap15(ax, ay, qx, qy) { const dx = qx - ax, dy = qy - ay, len = Math.hypot(dx, dy), step = Math.PI / 12, ang = Math.round(Math.atan2(dy, dx) / step) * step; return { x: ax + Math.cos(ang) * len, y: ay + Math.sin(ang) * len }; }
function translateAnno(a, o, dx, dy) {
  if (a.type === 'line' || a.type === 'arrow' || a.type === 'measure' || a.type === 'dim' || a.type === 'arc' || a.type === 'wall' || a.type === 'stairs' || a.type === 'beam') { a.x1 = o.x1 + dx; a.y1 = o.y1 + dy; a.x2 = o.x2 + dx; a.y2 = o.y2 + dy; }
  else if (a.type === 'pen' || a.type === 'area' || a.type === 'chaindim' || a.type === 'slab' || a.type === 'terrain') a.pts = o.pts.map(p => [p[0] + dx, p[1] + dy]);
  else if (a.type === 'profile') a.path = o.path.map(p => [p[0] + dx, p[1] + dy]);
  else if (a.type === 'path') a.nodes = o.nodes.map(nd => ({ x: nd.x + dx, y: nd.y + dy, hIn: { x: nd.hIn.x + dx, y: nd.hIn.y + dy }, hOut: { x: nd.hOut.x + dx, y: nd.hOut.y + dy } }));
  else if (a.type === 'highlight') a.rects = o.rects.map(r => ({ x: r.x + dx, y: r.y + dy, w: r.w, h: r.h }));
  else if (a.type === 'section') { a.ox = o.ox + dx; a.oy = o.oy + dy; }   // nur der Schnitt-Block wandert, Schnittlinie bleibt
  else { a.x = o.x + dx; a.y = o.y + dy; }
}
// Kurven-Knoten (data-pn) oder Anfasser (data-ph) ziehen
/* ---------- Mehrfachauswahl (Rahmen aufziehen) ---------- */
function startMarquee(pv, e) {
  const start = evtToPage(pv, e); let rectEl = null, dragged = false;
  const move = ev => {
    const q = evtToPage(pv, ev); if (Math.hypot(q.x - start.x, q.y - start.y) * pv.scale > 3) dragged = true; if (!dragged) return;
    const x = Math.min(start.x, q.x), y = Math.min(start.y, q.y), w = Math.abs(q.x - start.x), h = Math.abs(q.y - start.y);
    if (rectEl) rectEl.remove(); rectEl = svgEl('rect', { x, y, width: w, height: h, class: 'marquee' }); pv.svg.appendChild(rectEl);
  };
  const up = ev => {
    document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); if (rectEl) rectEl.remove();
    if (!dragged) return;
    const q = evtToPage(pv, ev), rx = Math.min(start.x, q.x), ry = Math.min(start.y, q.y), rw = Math.abs(q.x - start.x), rh = Math.abs(q.y - start.y), ids = [];
    for (const a of (getAnnos(pv.num) || [])) { if (a.type === 'crop' || a.type === 'snip' || a.type === 'imgph' || a.locked) continue; const b = bbox(a); if (b.x < rx + rw && b.x + b.w > rx && b.y < ry + rh && b.y + b.h > ry) ids.push(a.id); }
    if (ids.length === 1) { sel = { num: pv.num, id: ids[0] }; groupSel = null; }
    else if (ids.length > 1) { groupSel = { num: pv.num, ids }; sel = null; }
    else { sel = null; groupSel = null; }
    drawAnnos(pv); updateSelBar();
  };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
}
function drawGroupSel(svg, pv) {
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity; const arr = getAnnos(pv.num);
  for (const id of groupSel.ids) { const a = arr.find(x => x.id === id); if (!a) continue; const b = bbox(a); mnx = Math.min(mnx, b.x); mny = Math.min(mny, b.y); mxx = Math.max(mxx, b.x + b.w); mxy = Math.max(mxy, b.y + b.h); svg.appendChild(svgEl('rect', { x: b.x, y: b.y, width: b.w, height: b.h, class: 'group-item' })); }
  if (isFinite(mnx)) svg.appendChild(svgEl('rect', { x: mnx - 3, y: mny - 3, width: (mxx - mnx) + 6, height: (mxy - mny) + 6, class: 'group-box', 'data-group': '1' }));
}
function startSectionEdit(pv, e, key) {   // im Schnitt direkt ziehen: Wandhöhe / Brüstung / Sturz / Decken-Höhe (Höhen in m via perPt)
  if (!docScale) return; const pp = key.split(':'), kind = pp[1], perPt = docScale.perPt, start = evtToPage(pv, e); pushUndo();
  const dh = q => (start.y - q.y) * perPt;   // nach oben ziehen = grösser
  let move;
  if (kind === 'wh') { const w = findAnno(pv.num, +pp[2]); if (!w) { if (undoStack.length) undoStack.pop(); return; } const o = w.h3d || wallHeightM; move = ev => { w.h3d = Math.max(0.5, Math.round((o + dh(evtToPage(pv, ev))) * 100) / 100); requestDraw(pv); }; }
  else if (kind === 'op') { const o = findAnno(pv.num, +pp[2]); if (!o) { if (undoStack.length) undoStack.pop(); return; } const edge = pp[3], base = edge === 'head' ? (o.head != null ? o.head : (o.kind === 'window' ? 2.1 : 2.0)) : (o.sill || 0); move = ev => { const v = Math.max(0, Math.round((base + dh(evtToPage(pv, ev))) * 100) / 100); if (edge === 'head') o.head = v; else o.sill = v; requestDraw(pv); }; }
  else if (kind === 'sb') { const s = findAnno(pv.num, +pp[2]); if (!s) { if (undoStack.length) undoStack.pop(); return; } const o = s.base || 0; move = ev => { s.base = Math.max(0, Math.round((o + dh(evtToPage(pv, ev))) * 100) / 100); requestDraw(pv); }; }
  else { if (undoStack.length) undoStack.pop(); return; }
  _secLive = true;
  const up = () => { _secLive = false; document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); drawAnnos(pv); saveState(); };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
}
function startSectionLayerDrag(pv, e, wallId, li, edge) {   // im Schnitt: Schicht-Ober-/Unterkante ziehen → layer.top/bot (m)
  const w = findAnno(pv.num, wallId); if (!w || !w.layers || !w.layers[li] || !docScale) return; pushUndo();
  const perPt = docScale.perPt, L = w.layers[li], o = edge === 'top' ? (L.top || 0) : (L.bot || 0), start = evtToPage(pv, e);
  const move = ev => { const q = evtToPage(pv, ev); if (edge === 'top') L.top = Math.max(-2, Math.round(((o + (start.y - q.y) * perPt)) * 1000) / 1000); else L.bot = Math.max(-2, Math.round(((o + (q.y - start.y) * perPt)) * 1000) / 1000); requestDraw(pv); };
  _secLive = true;
  const up = () => { _secLive = false; document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); drawAnnos(pv); saveState(); };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
}
function startLayerExtDrag(pv, e, id, li, end) {   // eine Wandschicht an einem Ende entlang der Wandachse verlängern/kürzen (pt)
  const a = findAnno(pv.num, id); if (!a || !a.layers || !a.layers[li]) return; pushUndo();
  const dxw = a.x2 - a.x1, dyw = a.y2 - a.y1, Lw = Math.hypot(dxw, dyw) || 1, uxw = dxw / Lw, uyw = dyw / Lw, o1 = a.layers[li].ext1 || 0, o2 = a.layers[li].ext2 || 0, start = evtToPage(pv, e);
  const move = ev => { const q = evtToPage(pv, ev), proj = (q.x - start.x) * uxw + (q.y - start.y) * uyw; if (end === 1) a.layers[li].ext1 = Math.round(o1 - proj); else a.layers[li].ext2 = Math.round(o2 + proj); requestDraw(pv); };
  const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); saveState(); };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
}
function startGroupMove(pv, e) {
  const start = evtToPage(pv, e); pushUndo(); const origs = {}; let moved = false;
  for (const id of groupSel.ids) { const a = findAnno(pv.num, id); if (a) origs[id] = JSON.parse(JSON.stringify(a)); }
  const move = ev => { const q = evtToPage(pv, ev), dx = q.x - start.x, dy = q.y - start.y; moved = true; for (const id of groupSel.ids) { const a = findAnno(pv.num, id); if (a && origs[id]) translateAnno(a, origs[id], dx, dy); } requestDraw(pv); };
  const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); if (!moved) { if (undoStack.length) undoStack.pop(); } else { saveState(); refreshComments(); } };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
}
function updateAlignBar() { const ab = $('#alignBar'); if (ab) ab.hidden = !(groupSel && groupSel.ids && groupSel.ids.length >= 2 && tool === 'select'); }
function selWall() { const a = sel && findAnno(sel.num, sel.id); return a && a.type === 'wall' ? a : null; }
function selOpen() { const a = sel && findAnno(sel.num, sel.id); return a && a.type === 'opening' ? a : null; }
function selSlab() { const a = sel && findAnno(sel.num, sel.id); return a && a.type === 'slab' ? a : null; }
function updatePlanBar() {   // Planungs-Einstellungen: Standard fürs nächste Zeichnen ODER ausgewähltes Objekt
  const bar = $('#planBar'); if (!bar) return;
  const a = (sel && tool === 'select') ? findAnno(sel.num, sel.id) : null;
  const sW = a && a.type === 'wall' ? a : null, sO = a && a.type === 'opening' ? a : null;
  const isDimObj = a && ['dim', 'measure', 'chaindim', 'area'].includes(a.type), sS = a && a.type === 'slab' ? a : null, sT = a && a.type === 'stairs' ? a : null, sR = a && a.type === 'roof' ? a : null;
  let mode = sW ? 'wall' : sO ? 'open' : sS ? 'slab' : sT ? 'stairs' : sR ? 'roof' : isDimObj ? 'dim' : ((tool === 'wall' || tool === 'wallchain') ? 'wall' : (tool === 'opening' || tool === 'window') ? 'open' : tool === 'slab' ? 'slab' : tool === 'stairs' ? 'stairs' : tool === 'roof' ? 'roof' : (['measure', 'dim', 'chaindim', 'area'].includes(tool) ? 'dim' : null));
  if (!mode) { bar.hidden = true; document.body.classList.remove('has-planbar'); return; }
  bar.hidden = false; document.body.classList.add('has-planbar'); $('#pbWall').hidden = mode !== 'wall'; $('#pbOpen').hidden = mode !== 'open'; $('#pbSlab').hidden = mode !== 'slab'; $('#pbStairs').hidden = mode !== 'stairs'; $('#pbRoof').hidden = mode !== 'roof';
  if (mode === 'roof') { const rt = sR ? sR.rtype : roofType; $$('#pbRoof [data-rt]').forEach(b => b.classList.toggle('on', b.dataset.rt === rt)); if (document.activeElement !== $('#pbEave')) $('#pbEave').value = sR ? sR.eave : roofEaveM; if (document.activeElement !== $('#pbRidge')) $('#pbRidge').value = sR ? sR.ridge : roofRidgeM; }
  if (mode === 'slab') { if (document.activeElement !== $('#pbSlabBase')) $('#pbSlabBase').value = sS ? sS.base : wallHeightM; if (document.activeElement !== $('#pbSlabThick')) $('#pbSlabThick').value = Math.round((sS ? sS.thick : 0.2) * 100); }
  if (mode === 'stairs') { if (document.activeElement !== $('#pbStairW')) $('#pbStairW').value = Math.round(ptsToCm(sT ? sT.width : stairWidthPts())); if (document.activeElement !== $('#pbStairRise')) $('#pbStairRise').value = sT ? sT.rise : stairRiseM; if (document.activeElement !== $('#pbStairBase')) $('#pbStairBase').value = sT ? sT.base : stairBaseM; }
  $('#pbDimset').hidden = (mode !== 'wall' && mode !== 'dim'); $('#pbUnit').classList.toggle('on', dimUnit);
  { const b = $('#pbDimPutz'); if (b) { b.classList.toggle('on', dimWithPlaster); b.textContent = dimWithPlaster ? 'mit Putz' : 'ohne Putz'; } }
  if (document.activeElement !== $('#pbDimGap')) $('#pbDimGap').value = wallDimGap;
  if (mode === 'wall') {
    const cm = ptsToCm(sW ? (sW.thick || wallThickPts()) : wallThickPts());
    if (document.activeElement !== $('#pbThick')) $('#pbThick').value = Math.round(cm * 10) / 10;
    $('#pbDim').classList.toggle('on', sW ? !!sW.dim : wallDimOn);
    if (document.activeElement !== $('#pbDimOff')) $('#pbDimOff').value = wallDimOffCm;
    const jv = sW ? (sW.just || 'center') : wallJust; $$('#pbWall .pb-j').forEach(b => b.classList.toggle('on', b.dataset.just === jv));
    const ht = sW ? (sW.hatch && sW.hatch.type) : (wallHatch && wallHatch.type); $('#pbHatch').value = ht || '';
    const col = sW ? sW.color : style.color; $('#pbWallDot').style.background = col; $('#pbWallColor').value = toHex(col);
    if (document.activeElement !== $('#pbWallH')) $('#pbWallH').value = sW ? (sW.h3d || wallHeightM) : wallHeightM;
    $('#pbWallDisp').value = sW ? (sW.simple === true ? 'simple' : sW.simple === false ? 'detail' : 'auto') : 'auto';
    const hasSchal = sW && sW.layers && sW.layers.some(l => l.mat === 'holz' || l.mat === 'konter');
    $('#pbSchalHWrap').style.display = hasSchal ? '' : 'none'; if (hasSchal && document.activeElement !== $('#pbSchalH')) $('#pbSchalH').value = sW.schalH || 12;
  } else if (mode === 'open') {
    const kind = sO ? sO.kind : openKind;
    $$('#pbOpen [data-ok]').forEach(b => b.classList.toggle('on', b.dataset.ok === kind));
    const rawW = sO ? sO.w : (lastOpenW || cmToPts(kind === 'window' ? 100 : 90)), insW = openInsPts(sO);
    const cm = ptsToCm(inputLicht ? Math.max(cmToPts(20), rawW - 2 * insW) : rawW);
    if (document.activeElement !== $('#pbWidth')) $('#pbWidth').value = Math.round(cm);
    { const lab = $('#pbWidthLab'); if (lab) lab.textContent = inputLicht ? 'Licht-B' : 'Rohbau-B'; $('#pbLichtRoh').classList.toggle('on', inputLicht); }
    const insMh = ptsToCm(openInsPts(sO)) / 100, sill = sO ? (sO.sill || 0) : (kind === 'window' ? 0.9 : 0), head = sO ? (sO.head || (kind === 'window' ? 2.1 : 2.0)) : (kind === 'window' ? 2.1 : 2.0);
    if (document.activeElement !== $('#pbSill')) $('#pbSill').value = Math.round((inputLicht && kind === 'window' ? sill + insMh : sill) * 100) / 100;
    if (document.activeElement !== $('#pbHead')) $('#pbHead').value = Math.round((inputLicht ? head - insMh : head) * 100) / 100;
    const winLike = kind === 'window' || kind === 'door';
    $('#pbSillWrap').style.display = kind === 'window' ? '' : 'none';
    $('#pbDepthWrap').style.display = winLike ? '' : 'none';
    const thCm = ptsToCm((sO && sO.thick) || wallThickPts());   // Flügel-/Rahmenposition in cm (Abstand von der Innenseite)
    if (document.activeElement !== $('#pbDepth')) $('#pbDepth').value = (Math.round((sO && sO.depth != null ? sO.depth : lastOpenDepth) * thCm * 10) / 10);
    { const w2 = $('#pbBoardVisWrap'); if (w2) w2.style.display = winLike ? '' : 'none'; if (document.activeElement !== $('#pbBoardVis')) $('#pbBoardVis').value = (sO && sO.boardVis != null ? sO.boardVis : 1); }   // Abstand Laibung↔Rahmen (sichtbarer Rahmen)
    { const isWin = kind === 'window'; $('#pbBank').style.display = isWin ? '' : 'none'; $('#pbBank').classList.toggle('on', !!(sO && sO.bank !== false)); $('#pbSims').style.display = isWin ? '' : 'none'; $('#pbSims').classList.toggle('on', !!(sO && sO.sims)); const ow = $('#pbBankOverWrap'); if (ow) ow.style.display = (isWin && (sO && (sO.bank !== false || sO.sims))) ? '' : 'none'; if (document.activeElement !== $('#pbBankOver')) $('#pbBankOver').value = (sO && sO.bankOver != null ? sO.bankOver : 4); }   // Fensterbank (aussen) / Sims (innen) + Überstand zur Fassade
    $('#pbNiche').style.display = 'none'; $('#pbNiche').classList.toggle('on', !!(sO && sO.niche));   // Konsolidiert: Storenkasten nur im „⊕ Detail"
    const tOpts = kind === 'door' ? '<option value="fest">Festverglast</option><option value="f1">1 Flügel</option><option value="f2">2 Flügel</option><option value="f1f">1 Flügel + Fixteil</option>' : '<option value="fest">Festverglasung</option><option value="f1">1 Flügel</option><option value="f2">2 Flügel (direkt)</option><option value="f2s">2 Flügel + Setzholz</option>';
    if ($('#pbWinType').dataset.kind !== kind) { $('#pbWinType').innerHTML = tOpts; $('#pbWinType').dataset.kind = kind; }
    $('#pbWinType').style.display = winLike ? '' : 'none'; $('#pbWinType').value = (sO && sO.winType) || (kind === 'door' ? lastDoorType : lastWinType);
    $('#pbWinHinge').style.display = winLike ? '' : 'none'; $('#pbWinHinge').value = (sO && sO.winHinge) || lastWinHinge;
    $('#pbWinMore').style.display = winLike ? '' : 'none';
    $('#pbLaibEdit').style.display = winLike ? '' : 'none';
    $('#pbReveal').style.display = 'none'; $('#pbReveal').value = (sO && sO.revealType) || 'putz';   // Konsolidiert: Laibung/Anschlag nur im „⊕ Detail"
    { const ro = $('#pbRevealOut'); if (ro) { ro.style.display = 'none'; ro.value = (sO && sO.revealOuter) || ''; } }
    $('#pbAnschlag').style.display = 'none'; $('#pbAnschlag').value = (sO && sO.anschlagType) || 'none';
    $('#pbAnschlagDWrap').style.display = 'none'; if (document.activeElement !== $('#pbAnschlagD')) $('#pbAnschlagD').value = Math.round(ptsToCm(sO && sO.anschlagDepth != null ? sO.anschlagDepth : cmToPts(5)) * 10) / 10;
    $('#pbWinMat').style.display = winLike ? '' : 'none'; $('#pbWinMat').value = (sO && sO.winMat) || lastWinMat || 'holz';
    $('#pbOuterWrap').style.display = 'none'; if (document.activeElement !== $('#pbOuterLap')) $('#pbOuterLap').value = Math.round(ptsToCm(sO && sO.outerLap != null ? sO.outerLap : cmToPts(3)) * 10) / 10;
    $('#pbInnerWrap').style.display = 'none'; if (document.activeElement !== $('#pbInnerRev')) $('#pbInnerRev').value = Math.round(ptsToCm(sO && sO.innerReveal != null ? sO.innerReveal : cmToPts(2)) * 10) / 10;
    $('#pbFlip').style.display = winLike ? '' : 'none';   // Anschlag/Seite wechseln – für Tür UND Fenster
  }
}
function alignGroup(mode) {
  if (mode === 'dup') { duplicateGroup(); return; }
  if (!groupSel) return; const pv = pageViews.find(p => p.num === groupSel.num); if (!pv) return;
  const arr = getAnnos(pv.num), items = groupSel.ids.map(id => arr.find(a => a.id === id)).filter(Boolean); if (items.length < 2) return;
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
  const bbs = items.map(a => { const b = bbox(a); mnx = Math.min(mnx, b.x); mny = Math.min(mny, b.y); mxx = Math.max(mxx, b.x + b.w); mxy = Math.max(mxy, b.y + b.h); return { a, b }; });
  pushUndo(); const cx = (mnx + mxx) / 2, cy = (mny + mxy) / 2;
  if (mode === 'distH' || mode === 'distV') {
    const horiz = mode === 'distH'; bbs.sort((p, q) => horiz ? (p.b.x + p.b.w / 2) - (q.b.x + q.b.w / 2) : (p.b.y + p.b.h / 2) - (q.b.y + q.b.h / 2));
    const n = bbs.length, c0 = horiz ? bbs[0].b.x + bbs[0].b.w / 2 : bbs[0].b.y + bbs[0].b.h / 2, c1 = horiz ? bbs[n - 1].b.x + bbs[n - 1].b.w / 2 : bbs[n - 1].b.y + bbs[n - 1].b.h / 2, step = (c1 - c0) / (n - 1);
    bbs.forEach((p, i) => { const cur = horiz ? p.b.x + p.b.w / 2 : p.b.y + p.b.h / 2, d = (c0 + step * i) - cur; translateAnno(p.a, JSON.parse(JSON.stringify(p.a)), horiz ? d : 0, horiz ? 0 : d); });
  } else {
    bbs.forEach(({ a, b }) => { let dx = 0, dy = 0;
      if (mode === 'left') dx = mnx - b.x; else if (mode === 'right') dx = mxx - (b.x + b.w); else if (mode === 'centerH') dx = cx - (b.x + b.w / 2);
      else if (mode === 'top') dy = mny - b.y; else if (mode === 'bottom') dy = mxy - (b.y + b.h); else if (mode === 'middle') dy = cy - (b.y + b.h / 2);
      translateAnno(a, JSON.parse(JSON.stringify(a)), dx, dy);
    });
  }
  drawAnnos(pv); saveState();
}
function duplicateGroup() {
  if (!groupSel) return; const pv = pageViews.find(p => p.num === groupSel.num); if (!pv) return; const arr = getAnnos(pv.num);
  pushUndo(); const newIds = [];
  for (const id of groupSel.ids) { const a = arr.find(x => x.id === id); if (!a) continue; const orig = JSON.parse(JSON.stringify(a)), copy = JSON.parse(JSON.stringify(a)); copy.id = nextId++; translateAnno(copy, orig, 12, 12); arr.push(copy); newIds.push(copy.id); }
  groupSel = { num: pv.num, ids: newIds }; drawAnnos(pv); refreshComments(); saveState(); toast('Gruppe dupliziert ✓');
}
function applyGroupColor(color) {
  if (!groupSel) return; const pv = pageViews.find(p => p.num === groupSel.num); if (!pv) return; const arr = getAnnos(pv.num);
  for (const id of groupSel.ids) { const a = arr.find(x => x.id === id); if (a && a.color != null) a.color = color; }
  drawAnnos(pv);
}
function deleteGroup() {
  if (!groupSel) return; pushUndo(); const arr = getAnnos(groupSel.num); if (arr) for (const id of groupSel.ids) { const i = arr.findIndex(a => a.id === id); if (i >= 0) arr.splice(i, 1); }
  groupSel = null; pageViews.forEach(drawAnnos); refreshComments();
}
function startNodeDrag(pv, e, id, pnIdx, phIdx, hk) {
  const a = findAnno(pv.num, id); if (!a) return;
  if (a.type === 'profile' || a.type === 'slab' || a.type === 'area' || a.type === 'terrain') {   // Polygon/Pfad-Knoten ziehen (rastet an Wandenden/Raster)
    if (pnIdx === null) return; pushUndo(); const key = a.type === 'profile' ? 'path' : 'pts';
    const move = ev => { let q = evtToPage(pv, ev); const an = anchorSnap(pv, q.x, q.y, a.id); if (an) q = an; else if (gridOn && !ev.altKey) q = snapPt(q.x, q.y); a[key][+pnIdx] = [q.x, q.y]; requestDraw(pv); };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); saveState(); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); return;
  }
  if (a.type !== 'path') return; pushUndo();
  const move = ev => {
    let q = evtToPage(pv, ev); if (gridOn && !ev.altKey) q = snapPt(q.x, q.y);
    if (pnIdx !== null) { const nd = a.nodes[+pnIdx], dx = q.x - nd.x, dy = q.y - nd.y; nd.hIn.x += dx; nd.hIn.y += dy; nd.hOut.x += dx; nd.hOut.y += dy; nd.x = q.x; nd.y = q.y; }   // Knoten + seine Anfasser mitnehmen
    else { const nd = a.nodes[+phIdx], h = hk === 'in' ? nd.hIn : nd.hOut, other = hk === 'in' ? nd.hOut : nd.hIn; h.x = q.x; h.y = q.y; if (!ev.altKey) { other.x = 2 * nd.x - q.x; other.y = 2 * nd.y - q.y; } }   // Anfasser ziehen (Alt = einseitig)
    drawAnnos(pv);
  };
  const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); saveState(); };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
}
function startAngleDrag(pv, e, id) {   // offenes Türblatt/Fenster ziehen → Öffnungswinkel a.openAngle (0–170°, 5°-Raster, Alt = frei)
  const a = findAnno(pv.num, id), h = _angHandles[id]; if (!a || !h) return; pushUndo();
  const move = ev => { const q = evtToPage(pv, ev), vx = q.x - h.hx, vy = q.y - h.hy, along = vx * h.cdx + vy * h.cdy, across = vx * h.odx + vy * h.ody; let deg = Math.atan2(across, along) * 180 / Math.PI; deg = Math.max(0, Math.min(170, deg)); if (!ev.altKey) deg = Math.round(deg / 5) * 5; a.openAngle = deg; requestDraw(pv); };
  const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); saveState(); toast('Öffnungswinkel ' + Math.round(a.openAngle != null ? a.openAngle : 90) + '°'); };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
}
function startResize(pv, e, h) {
  const a = findAnno(pv.num, sel.id); if (!a) return; pushUndo(); const orig = JSON.parse(JSON.stringify(a));
  const move = ev => {
    let q = evtToPage(pv, ev), snapped = null;
    if (a.type === 'section') {
      if (ev.shiftKey && (h === 'sc1' || h === 'sc2')) { const o2 = h === 'sc1' ? { x: orig.cx2, y: orig.cy2 } : { x: orig.cx1, y: orig.cy1 }; const s = snap15(o2.x, o2.y, q.x, q.y); q = { x: s.x, y: s.y }; }
      if (h === 'sc1') { a.cx1 = q.x; a.cy1 = q.y; } else if (h === 'sc2') { a.cx2 = q.x; a.cy2 = q.y; }
      else if (h === 'scmid') { const mx = (orig.cx1 + orig.cx2) / 2, my = (orig.cy1 + orig.cy2) / 2, ddx = q.x - mx, ddy = q.y - my; a.cx1 = orig.cx1 + ddx; a.cy1 = orig.cy1 + ddy; a.cx2 = orig.cx2 + ddx; a.cy2 = orig.cy2 + ddy; }
      drawAnnos(pv); return;
    }
    if (isLineType(a)) {
      let qx = q.x, qy = q.y;
      if (ev.shiftKey) { const o = h === 'p1' ? { x: a.x2, y: a.y2 } : { x: a.x1, y: a.y1 }; const s = snap15(o.x, o.y, qx, qy); qx = s.x; qy = s.y; }
      else { const an = snapWallPt(pv, qx, qy, a.id); if (an) { qx = an.x; qy = an.y; snapped = an; } else if (gridOn && !ev.altKey) { const g = snapPt(qx, qy); qx = g.x; qy = g.y; } }   // Endpunkt an Wand-Ecke/-Ende/-Achse fangen
      if (h === 'p1') { a.x1 = qx; a.y1 = qy; } else { a.x2 = qx; a.y2 = qy; }
    } else {
      if (gridOn && !ev.shiftKey && !ev.altKey) q = snapPt(q.x, q.y);   // Anfasser aufs Raster
      if (orig.type === 'sig' || orig.type === 'img') { const ratio = orig.w / orig.h || 1, ax = h.includes('w') ? orig.x + orig.w : orig.x, ay = h.includes('n') ? orig.y + orig.h : orig.y; const nw = Math.max(12, Math.abs(q.x - ax)), nh = nw / ratio; a.w = nw; a.h = nh; a.x = h.includes('w') ? ax - nw : ax; a.y = h.includes('n') ? ay - nh : ay; }
      else { let x = orig.x, y = orig.y, w = orig.w, h2 = orig.h; if (orig.type === 'rect' || orig.type === 'oval' || orig.type === 'edit' || orig.type === 'cover' || orig.type === 'stamp' || orig.type === 'text' || orig.type === 'crop' || orig.type === 'imgph' || orig.type === 'roof' || orig.type === 'block') { const x2 = x + w, y2 = y + h2; let nx = x, ny = y, nx2 = x2, ny2 = y2; if (h.includes('w')) nx = q.x; if (h.includes('e')) nx2 = q.x; if (h.includes('n')) ny = q.y; if (h.includes('s')) ny2 = q.y; a.x = nx; a.y = ny; a.w = nx2 - nx; a.h = ny2 - ny; } }
    }
    drawAnnos(pv); if (snapped) snapIndicator(pv, snapped);
  };
  const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); saveState(); };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
}
/* ---------- Freihand „aufräumen": Skizze → perfekte Form ---------- */
function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
function perpDist(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1; return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / L; }
function rdp(pts, eps) {
  if (pts.length < 3) return pts.slice();
  let dm = 0, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) { const d = perpDist(pts[i], pts[0], pts[pts.length - 1]); if (d > dm) { dm = d; idx = i; } }
  if (dm > eps) { const l = rdp(pts.slice(0, idx + 1), eps), r = rdp(pts.slice(idx), eps); return l.slice(0, -1).concat(r); }
  return [pts[0], pts[pts.length - 1]];
}
function maxDev(pts, a, b) { let m = 0; for (const p of pts) m = Math.max(m, perpDist(p, a, b)); return m; }
function rectOrOval(pts, x, y, w, h) {
  const cx = x + w / 2, cy = y + h / 2, rx = (w / 2) || 1, ry = (h / 2) || 1; let er = 0, eo = 0;
  for (const p of pts) {
    const dl = Math.abs(p[0] - x), dr = Math.abs(p[0] - (x + w)), dt = Math.abs(p[1] - y), db = Math.abs(p[1] - (y + h));
    er += Math.min(dl, dr, dt, db);
    eo += Math.abs(Math.hypot((p[0] - cx) / rx, (p[1] - cy) / ry) - 1) * Math.min(rx, ry);
  }
  return er <= eo ? 'rect' : 'oval';
}
function beautify(pts) {
  if (pts.length < 4) return null;
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
  const w = maxx - minx, h = maxy - miny, diag = Math.hypot(w, h);
  if (diag < 8) return null;
  const s = rdp(pts, Math.max(4, diag * 0.05));
  const p0 = s[0], pL = s[s.length - 1], closed = dist(p0, pL) < diag * 0.22 && s.length >= 4;
  // fast gerade → Linie
  if (!closed && (s.length === 2 || maxDev(pts, p0, pL) < diag * 0.06)) return { type: 'line', x1: p0[0], y1: p0[1], x2: pL[0], y2: pL[1] };
  if (closed) { const t = rectOrOval(pts, minx, miny, w, h); return t === 'rect' ? { type: 'rect', x: minx, y: miny, w, h } : { type: 'oval', x: minx, y: miny, w, h }; }
  // offen mit Knicken: Pfeil (Schaft + kurzer zurückgeknickter Widerhaken) oder Polylinie
  if (s.length === 3) {
    const l1 = dist(s[0], s[1]), l2 = dist(s[1], s[2]);
    const d1 = [(s[1][0] - s[0][0]) / (l1 || 1), (s[1][1] - s[0][1]) / (l1 || 1)];
    const d2 = [(s[2][0] - s[1][0]) / (l2 || 1), (s[2][1] - s[1][1]) / (l2 || 1)];
    const dot = d1[0] * d2[0] + d1[1] * d2[1];
    if (l2 < l1 * 0.6 && dot < 0.35) return { type: 'arrow', x1: s[0][0], y1: s[0][1], x2: s[1][0], y2: s[1][1] };
  }
  return { type: 'pen', pts: s };   // saubere Polylinie mit 1–2 Abbiegern
}

function startDraw(pv, e, p) {
  pushUndo();
  if (!e.shiftKey && (tool === 'wall' || tool === 'line' || tool === 'arrow' || tool === 'measure' || tool === 'dim' || tool === 'stairs' || tool === 'beam' || tool === 'wallface' || tool === 'anschluss')) {
    const sp = snapWallPt(pv, p.x, p.y); if (sp) p = { x: sp.x, y: sp.y }; else if (gridOn) p = snapPt(p.x, p.y);   // Startpunkt auf Wand-Ende/-Achse einrasten → saubere Gehrung
  }
  let a;
  if (tool === 'pen') a = { id: nextId++, type: 'pen', pts: [[p.x, p.y]], color: style.color, width: style.width };
  else if (tool === 'rect') a = { id: nextId++, type: 'rect', x: p.x, y: p.y, w: 0, h: 0, color: style.color, width: style.width };
  else if (tool === 'roof') a = { id: nextId++, type: 'roof', x: p.x, y: p.y, w: 0, h: 0, rtype: roofType, eave: roofEaveM, ridge: roofRidgeM, axis: roofAxis, color: style.color };
  else if (tool === 'oval') a = { id: nextId++, type: 'oval', x: p.x, y: p.y, w: 0, h: 0, color: style.color, width: style.width };
  else if (tool === 'wall') a = { id: nextId++, type: 'wall', x1: p.x, y1: p.y, x2: p.x, y2: p.y, thick: wallThickPts(), just: wallJust, color: (wallHatch && wallHatch.color) || style.color, fill: (wallHatch && wallHatch.fill) || '#ffffff', hatch: wallHatch ? { ...wallHatch } : null, width: 1.4, dim: wallDimOn };   // Wand = Linie mit Dicke
  else if (tool === 'stairs') a = { id: nextId++, type: 'stairs', x1: p.x, y1: p.y, x2: p.x, y2: p.y, width: stairWidthPts(), rise: stairRiseM, base: stairBaseM, color: style.color };   // Treppe = Lauf (Linie mit Breite + Höhe)
  else if (tool === 'beam') a = { id: nextId++, type: 'beam', x1: p.x, y1: p.y, x2: p.x, y2: p.y, width: beamWidthPts(), height: beamHM, color: style.color };   // Unterzug = Balken (Linie mit Breite + Höhe, unter der Decke)
  else if (tool === 'wallface') a = { id: nextId++, type: 'measure', x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: '#2f6ea3', width: 1.6, wallface: true, height: wallHeightM || 2.5, belag: { ...DEFAULT_BELAG } };   // Wandbelag = Messlinie + Höhe → Wandfläche
  else a = { id: nextId++, type: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: style.color, width: style.width }; // line/arrow/measure
  pushAnno(pv.num, a);
  if (a.type === 'wall' && wallBuildup) applyWallBuildup(a, wallBuildup.layers, wallBuildup.spacing);   // Standard-Aufbau übernehmen
  const isLine = (a.type !== 'pen' && a.type !== 'rect' && a.type !== 'oval');
  const move = ev => {
    let q = evtToPage(pv, ev), snapped = null;
    if (a.type !== 'pen' && !ev.shiftKey) { const an = snapWallPt(pv, q.x, q.y, a.id); if (an) { q = snapped = an; } else if (gridOn) q = snapPt(q.x, q.y); }
    let rel = null;
    if (a.type === 'pen') a.pts.push([q.x, q.y]);
    else if (a.type === 'rect' || a.type === 'oval' || a.type === 'roof') { a.w = q.x - a.x; a.h = q.y - a.y; }
    else if (ev.shiftKey) { const s = snap15(a.x1, a.y1, q.x, q.y); a.x2 = s.x; a.y2 = s.y; }   // Shift = 15°
    else {                                                                                       // Linie/Pfeil/Mass/Wand
      if (!snapped) rel = refAngleSnap(pv, a, q.x, q.y);                                   // senkrecht/parallel zu Nachbar-Linie/Wand
      const as = rel || (!snapped ? angleSnapPoint(a.x1, a.y1, q.x, q.y) : null);
      if (as) { a.x2 = as.x; a.y2 = as.y; } else { a.x2 = q.x; a.y2 = q.y; }               // sonst auto 0/45/90°
    }
    drawAnnos(pv); if (snapped) snapIndicator(pv, snapped);
    if (rel) { pv.svg.appendChild(svgEl('line', { x1: a.x1, y1: a.y1, x2: a.x2 + (a.x2 - a.x1) * 0.25, y2: a.y2 + (a.y2 - a.y1) * 0.25, class: 'snap-guide' })); }   // Führungslinie
    if (isLine) showDrawHud(ev, a, rel ? (rel.perp ? '⟂' : '∥') : '');
  };
  const up = () => {
    document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); hideDrawHud();
    if (a.type === 'calibrate') { const len = Math.hypot(a.x2 - a.x1, a.y2 - a.y1); const arr = getAnnos(pv.num); arr.splice(arr.indexOf(a), 1); undoStack.pop(); drawAnnos(pv); if (len > 4) openScale(len); else setTool('select'); return; }
    if (a.type === 'pen' && penTidy) { const bz = beautify(a.pts); if (bz) { const arr = getAnnos(pv.num), i = arr.indexOf(a); arr[i] = Object.assign({ id: a.id, color: a.color, width: a.width }, bz); } }
    const cur = getAnnos(pv.num).find(x => x.id === a.id) || a;
    const clk = isLineType(cur) ? Math.hypot(cur.x2 - cur.x1, cur.y2 - cur.y1) < 3 : false;
    if (clk && (cur.type === 'line' || cur.type === 'arrow' || cur.type === 'measure' || cur.type === 'dim' || cur.type === 'wall' || cur.type === 'stairs' || cur.type === 'beam')) { startSegDraft(pv, cur); return; }   // Klick = Richtung anpeilen, dann 2. Klick oder L (Wand/Linie/Treppe/Unterzug)
    const b = bbox(cur); if (cur.type !== 'pen' && b.w < 3 && b.h < 3) { const arr = getAnnos(pv.num); arr.splice(arr.indexOf(cur), 1); undoStack.pop(); drawAnnos(pv); return; }
    if (isLineType(cur)) lastLine = { num: pv.num, id: cur.id };   // „L" wirkt auf die zuletzt gezeichnete Linie
    if (afterWallfaceDraw(pv, cur)) return;   // Wandbelag → gleich Höhe eintippen
    sel = null; drawAnnos(pv); saveState();   // Werkzeug bleibt aktiv → mehrere zeichnen (V/Esc = auswählen)
  };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
}
/* ---------- Gerade Linie per Klick: Start klicken → Richtung anpeilen → 2. Klick oder „L" = Länge ---------- */
let segDraft = null;
function startSegDraft(pv, a) {
  segDraft = { pv, a };
  const onMove = ev => {
    if (!segDraft) return; let q = evtToPage(pv, ev), snapped = null, rel = null;
    if (!ev.shiftKey) { const an = snapWallPt(pv, q.x, q.y, a.id); if (an) { q = snapped = an; } else if (gridOn) q = snapPt(q.x, q.y); }
    if (ev.shiftKey) { const s = snap15(a.x1, a.y1, q.x, q.y); a.x2 = s.x; a.y2 = s.y; }
    else { if (!snapped) rel = refAngleSnap(pv, a, q.x, q.y); const as = rel || (!snapped ? angleSnapPoint(a.x1, a.y1, q.x, q.y) : null); if (as) { a.x2 = as.x; a.y2 = as.y; } else { a.x2 = q.x; a.y2 = q.y; } }
    drawAnnos(pv); if (snapped) snapIndicator(pv, snapped);
    if (rel) pv.svg.appendChild(svgEl('line', { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, class: 'snap-guide' }));
    showDrawHud(ev, a, rel ? (rel.perp ? '⟂' : '∥') : '');
  };
  document.addEventListener('pointermove', onMove); segDraft._onMove = onMove;
  if (!startSegDraft._hint) { startSegDraft._hint = true; toast('Richtung anpeilen, dann 2. Klick = Ende · oder „L" drücken und Länge eingeben · Esc = abbrechen.'); }
}
function segDraftLength() {   // „L" während des Zeichnens: exakte Länge in der angepeilten Richtung
  if (!segDraft) return; const a = segDraft.a; let ux = a.x2 - a.x1, uy = a.y2 - a.y1, l = Math.hypot(ux, uy);
  const cur = docScale ? Math.round((l || 0) * docScale.perPt * 1000) / 1000 : Math.round((l || 0) * PT2MM);
  const v = prompt('Länge' + (docScale ? ' in Metern (z. B. 3,25)' : ' in mm') + ' – Richtung = wie angepeilt:', String(cur).replace('.', ',')); if (v == null) return;
  const pts = parseLenToPts(v); if (!(pts > 0)) return;
  if (l < 0.001) { ux = 1; uy = 0; l = 1; } ux /= l; uy /= l; a.x2 = a.x1 + ux * pts; a.y2 = a.y1 + uy * pts;
  finishSegDraft();
}
function finishSegDraft() {
  if (!segDraft) return; const { pv, a, _onMove } = segDraft; document.removeEventListener('pointermove', _onMove); segDraft = null; hideDrawHud();
  const arr = getAnnos(pv.num); if (Math.hypot(a.x2 - a.x1, a.y2 - a.y1) < 2) { const i = arr.indexOf(a); if (i >= 0) arr.splice(i, 1); if (undoStack.length) undoStack.pop(); drawAnnos(pv); return; }
  lastLine = { num: pv.num, id: a.id };
  if (afterWallfaceDraw(pv, a)) return;   // Wandbelag → gleich Höhe eintippen
  drawAnnos(pv); saveState();
}
function cancelSegDraft() {
  if (!segDraft) return; const { pv, a, _onMove } = segDraft; document.removeEventListener('pointermove', _onMove);
  const arr = getAnnos(pv.num), i = arr.indexOf(a); if (i >= 0) arr.splice(i, 1); if (undoStack.length) undoStack.pop(); segDraft = null; hideDrawHud(); drawAnnos(pv);
}
/* ---------- Wand-Kette: klicken–klicken = ganze Raumzüge (Doppelklick/Enter/Esc = fertig) ---------- */
let wallDraft = null;   // {pv, last:[x,y], seg, _onMove, _rel}
function startWallChain(pv, x, y) {
  pushUndo();
  const seg = { id: nextId++, type: 'wall', x1: x, y1: y, x2: x, y2: y, thick: wallThickPts(), just: wallJust, color: (wallHatch && wallHatch.color) || style.color, fill: (wallHatch && wallHatch.fill) || '#ffffff', hatch: wallHatch ? { ...wallHatch } : null, width: 1.4, dim: wallDimOn, _draft: true };
  pushAnno(pv.num, seg); if (wallBuildup) applyWallBuildup(seg, wallBuildup.layers, wallBuildup.spacing); wallDraft = { pv, last: [x, y], seg, pts: [[x, y]], segIds: [] };
  const onMove = ev => {
    if (!wallDraft) return; const s = wallDraft.seg; let q = evtToPage(pv, ev), snapped = null, rel = null;
    if (!ev.shiftKey) { const an = snapWallPt(pv, q.x, q.y, s.id); if (an) { q = snapped = an; } else if (gridOn) q = snapPt(q.x, q.y); }
    if (ev.shiftKey) { const sn = snap15(s.x1, s.y1, q.x, q.y); s.x2 = sn.x; s.y2 = sn.y; }
    else { if (!snapped) rel = refAngleSnap(pv, s, q.x, q.y); const as = rel || (!snapped ? angleSnapPoint(s.x1, s.y1, q.x, q.y) : null); if (as) { s.x2 = as.x; s.y2 = as.y; } else { s.x2 = q.x; s.y2 = q.y; } }
    wallDraft._rel = rel; drawAnnos(pv); if (snapped) snapIndicator(pv, snapped);
    if (rel) pv.svg.appendChild(svgEl('line', { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, class: 'snap-guide' }));
    showDrawHud(ev, s, rel ? (rel.perp ? '⟂' : '∥') : '');
  };
  document.addEventListener('pointermove', onMove); wallDraft._onMove = onMove;
}
function wallChainClick(pv, p) {
  if (!wallDraft) return; const s = wallDraft.seg, ex = s.x2, ey = s.y2;   // Vorschau-Endpunkt (bereits gesnappt) übernehmen
  if (Math.hypot(ex - s.x1, ey - s.y1) < 2) return;                       // zu kurz – ignorieren
  delete s._draft; lastLine = { num: pv.num, id: s.id }; wallDraft.pts.push([ex, ey]); wallDraft.segIds.push(s.id);
  pushUndo();
  const first = wallDraft.pts[0], closed = wallDraft.pts.length >= 4 && Math.hypot(ex - first[0], ey - first[1]) < (s.thick * 0.7 + 5);   // Zug geschlossen?
  if (closed) { addRoomArea(pv, wallDraft.pts.slice(0, -1), s.thick); finishWallChain(); return; }
  const seg2 = { id: nextId++, type: 'wall', x1: ex, y1: ey, x2: ex, y2: ey, thick: s.thick, just: s.just, color: s.color, fill: s.fill, hatch: s.hatch, width: s.width, dim: s.dim, _draft: true };
  pushAnno(pv.num, seg2); if (wallBuildup) applyWallBuildup(seg2, wallBuildup.layers, wallBuildup.spacing); wallDraft.seg = seg2; wallDraft.last = [ex, ey];
  drawAnnos(pv); saveState();
}
function wallChainLength() {   // „L" während der Wand-Kette: aktuelles Segment auf exakte Länge setzen + Ecke setzen
  if (!wallDraft || !wallDraft.seg) return; const pv = wallDraft.pv, s = wallDraft.seg;
  let ux = s.x2 - s.x1, uy = s.y2 - s.y1, l = Math.hypot(ux, uy);
  const cur = docScale ? Math.round((l || 0) * docScale.perPt * 1000) / 1000 : Math.round((l || 0) * PT2MM);
  const v = prompt('Wand-Länge' + (docScale ? ' in Metern (z. B. 3,25)' : ' in mm') + ' – Richtung = wie gezogen:', String(cur).replace('.', ',')); if (v == null) return;
  const pts = parseLenToPts(v); if (!(pts > 0)) return;
  if (l < 0.001) { ux = 1; uy = 0; l = 1; } ux /= l; uy /= l;
  s.x2 = s.x1 + ux * pts; s.y2 = s.y1 + uy * pts;
  wallChainClick(pv, { x: s.x2, y: s.y2 });   // Ecke an exakter Länge setzen, Kette läuft weiter
}
function polyArea2(pts) { let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; } return s; }
function insetPolygon(pts, d) {   // Polygon um d nach innen versetzen (lichte Fläche)
  const n = pts.length; if (n < 3) return null; const ccw = polyArea2(pts) > 0;
  const lines = [];
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; let ex = b[0] - a[0], ey = b[1] - a[1]; const L = Math.hypot(ex, ey) || 1; ex /= L; ey /= L; let nx = -ey, ny = ex; if (!ccw) { nx = ey; ny = -ex; } lines.push({ px: a[0] + nx * d, py: a[1] + ny * d, dx: ex, dy: ey }); }
  const out = [];
  for (let i = 0; i < n; i++) { const l1 = lines[(i - 1 + n) % n], l2 = lines[i]; const den = l1.dx * (-l2.dy) - l1.dy * (-l2.dx); if (Math.abs(den) < 1e-6) { out.push([l2.px, l2.py]); continue; } const t = ((l2.px - l1.px) * (-l2.dy) - (l2.py - l1.py) * (-l2.dx)) / den; out.push([l1.px + t * l1.dx, l1.py + t * l1.dy]); }
  if (Math.sign(polyArea2(out)) !== Math.sign(polyArea2(pts)) || Math.abs(polyArea2(out)) < Math.abs(polyArea2(pts)) * 0.05) return null;   // kollabiert/umgestülpt → verwerfen
  return out;
}
/* ---------- Öffnungen (Tür/Fenster) in Wänden ---------- */
let openKind = 'door', lastOpenW = null, lastOpenDepth = 0.5, lastWinType = 'f1', lastDoorType = 'f1', lastWinHinge = 'left', lastWinMat = 'holz';
let inputLicht = true;   // eingegebene/angezeigte Öffnungsbreite = Lichtmaß (Rohbau = Licht + 2×(Rahmen − sichtbarer Rahmen)); sonst Rohbaumaß
function openInsPts(o) { return Math.max(0, ((o && o.frameW) || cmToPts(10)) - cmToPts((o && o.boardVis != null) ? o.boardVis : 1)); }   // Licht-Einzug pro Seite
function openingFootprint(o) {   // Öffnungs-Grundriss (Breite × volle Wanddicke) – einfacher Vollausschnitt
  const hw = (o.w || 0) / 2, ht = ((o.thick || wallThickPts()) / 2) + 1, ux = Math.cos(o.ang || 0), uy = Math.sin(o.ang || 0), nx = -uy, ny = ux, x = o.x, y = o.y;
  return [[x - ux * hw - nx * ht, y - uy * hw - ny * ht], [x + ux * hw - nx * ht, y + uy * hw - ny * ht], [x + ux * hw + nx * ht, y + uy * hw + ny * ht], [x - ux * hw + nx * ht, y - uy * hw + ny * ht]];
}
function openingRevealTotalPts(o, edge, side) {   // Gesamtdicke der Laibung (pt) je Kante (L/R/T/B) + Seite (i/o); Fallback auf globale revealLining/Out
  let lst = null; if (o.reveals && o.reveals[edge]) lst = side === 'i' ? o.reveals[edge].in : o.reveals[edge].out;
  if (!Array.isArray(lst) || !lst.length) lst = side === 'i' ? o.revealLining : o.revealLiningOut;
  return Array.isArray(lst) && lst.length ? lst.reduce((s, L) => s + cmToPts(L.t || 0) + cmToPts(L.gap || 0), 0) : 0;
}
function openingCutPoly(o) {   // Laibungs-bewusster Ausschnitt (H-Form): die Wand lappt an den Laibungstiefen auf den Rahmen – pro Jamb (L/R) und Tiefe (innen/aussen) eigene freie Breite
  const hw = (o.w || 0) / 2, ht = (o.thick || wallThickPts()) / 2, ux = Math.cos(o.ang || 0), uy = Math.sin(o.ang || 0), nx = -uy, ny = ux, x = o.x, y = o.y, e = 1;
  const frameW = o.frameW || cmToPts(10), bvG = o.boardVis != null ? o.boardVis : 1;
  const free = (edge, side) => { const er = o.reveals && o.reveals[edge], bvS = er ? (side === 'i' ? er.boardVisIn : er.boardVisOut) : null, bv = bvS != null ? bvS : (er && er.boardVis != null ? er.boardVis : bvG), lapNom = frameW - cmToPts(bv), lapE = Math.max(0, Math.min(frameW, lapNom)), grow = Math.max(0, lapNom - frameW); return Math.max(2, hw - Math.max(0, lapE - openingRevealTotalPts(o, edge, side)) + grow); };   // freie Halbbreite je Kante/Seite: Wand-Lappung max bis Rahmen-Innenkante; negativer bv → grow (Wand zurück, Öffnung grösser)
  const wInL = free('L', 'i'), wOutL = free('L', 'o'), wInR = free('R', 'i'), wOutR = free('R', 'o');   // links (−s) = Kante L, rechts (+s) = Kante R
  const depth = o.depth == null ? 0.5 : o.depth, md = depth * 2 - 1, fdh = Math.min(0.49, (o.frameD || cmToPts(7)) / (2 * ht)), fmA = (md - fdh) * ht, fmB = (md + fdh) * ht;
  const P = (s, m) => [x + ux * s + nx * m, y + uy * s + ny * m];
  return [P(-wInL, -ht - e), P(wInR, -ht - e), P(wInR, fmA), P(hw + e, fmA), P(hw + e, fmB), P(wOutR, fmB), P(wOutR, ht + e), P(-wOutL, ht + e), P(-wOutL, fmB), P(-hw - e, fmB), P(-hw - e, fmA), P(-wInL, fmA)];
}
function revInsetPts(lst) { if (!Array.isArray(lst) || !lst.length) return 0; let acc = 0, mx = 0; for (const L of lst) { acc += cmToPts(L.t || 0); mx = Math.max(mx, acc + (L.sOff ? cmToPts(L.sOff) : 0)); } return mx; }   // seitliche Einragung einer Laibungs-Schichtliste (Dicke + Versatz, tiefste Kante)
function openLichtInset(o) {   // seitlicher Licht-Einzug pro Seite (pt): STANDARD = am Rahmen (frameW − 1cm sichtbar), und reagiert wenn die Laibung tiefer einragt
  return Math.max(openInsPts(o), revInsetPts(o && o.revealLining), revInsetPts(o && o.revealLiningOut));
}
function openingEdgeLayers(o, edge, side) {   // per-Kante-Laibung (edge L/R/T/B × side i/o); null → Fallback auf globale revealLining/Out
  const r = o && o.reveals && o.reveals[edge]; if (!r) return null;
  const lst = side === 'i' ? r.in : r.out; if (!Array.isArray(lst) || !lst.length) return null;
  return lst.map((L, i) => [L.mat, L.t, L.gap || 0, L.prio, i, L.len, L.over]);   // [4]=Index, [5]=Länge/Tiefe (cm), [6]=Überstand(+)/Rücksprung(−) (cm)
}
function nearestWall(pv, x, y) {
  let best = null, bd = Infinity;
  for (const o of getAnnos(pv.num)) { if (o.type !== 'wall') continue; const dx = o.x2 - o.x1, dy = o.y2 - o.y1, L2 = dx * dx + dy * dy || 1; let t = ((x - o.x1) * dx + (y - o.y1) * dy) / L2; t = Math.max(0, Math.min(1, t)); const px = o.x1 + dx * t, py = o.y1 + dy * t, d = Math.hypot(px - x, py - y); if (d < bd) { bd = d; best = { wall: o, cx: px, cy: py, ang: Math.atan2(dy, dx), thick: o.thick || wallThickPts(), dist: d }; } }
  return best;
}
function arcPts(cx, cy, r, from, to, n) { let a0 = Math.atan2(from[1] - cy, from[0] - cx), a1 = Math.atan2(to[1] - cy, to[0] - cx), d = a1 - a0; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; const out = []; for (let i = 0; i <= n; i++) { const a = a0 + d * i / n; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return out; }
const WIN_MAT = { holz: { fill: '#e7cfa8', stroke: '#7a5126' }, metall: { fill: '#cfd3d8', stroke: '#565b62' }, kunst: { fill: '#f4f5f7', stroke: '#8a9099' } };   // Fenster: Holz / Metall / Kunststoff (Rahmen+Flügel)
function openingParts(a, detail) {   // detail=false → einfache Symbol-Darstellung (einschichtige Wand)
  detail = detail !== false;
  const x = a.x, y = a.y, ang = a.ang, ht = (a.thick || wallThickPts()) / 2, hw = a.w / 2;
  const ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux;
  const corner = (s, m) => [x + ux * hw * s + nx * ht * m, y + uy * hw * s + ny * ht * m];
  const cover = [corner(-1, -1), corner(1, -1), corner(1, 1), corner(-1, 1)];
  const lines = [], arcs = [], bold = [], fills = [];
  const isDetailWin = (a.kind === 'window' || a.kind === 'door') && detail;
  if (!isDetailWin) lines.push([corner(-1, -1), corner(-1, 1)], [corner(1, -1), corner(1, 1)]);   // Laibungs-Querlinien (beim Detail-Fenster weg)
  if (a.kind === 'window' && !detail) { bold.push([corner(-1, -0.13), corner(1, -0.13)]); lines.push([corner(-1, 0.13), corner(1, 0.13)]); }   // einfach: zwei quere Linien, eine breit
  else if (a.kind === 'window') {   // Profil: Blendrahmen Höhe 10 (entlang Öffnung) × Tiefe 7; Flügel 7×7, 4 cm entlang in den Rahmen, 1 cm Tiefe zurück
    const wt = a.winType || 'f1';
    const depth = a.depth == null ? 0.5 : a.depth, md = Math.max(-1, Math.min(1, depth * 2 - 1));
    const frameW = a.frameW || cmToPts(10), frameD = a.frameD || cmToPts(7), sashW = a.sashW || cmToPts(7), sashD = a.sashD || cmToPts(7), shift = a.sashShift != null ? a.sashShift : cmToPts(4), recess = a.sashRecess != null ? a.sashRecess : cmToPts(1);
    const fdh = Math.min(0.49, frameD / (2 * ht)); let fmA = md - fdh, fmB = md + fdh;   // fmB = Vorderkante (aussen), fmA = innen
    if (fmA < -1) { fmB += (-1 - fmA); fmA = -1; } if (fmB > 1) { fmA -= (fmB - 1); fmB = 1; }
    const fwS = Math.min(0.45, frameW / hw), ssW = Math.min(0.42, sashW / hw), backS = Math.min(fwS, shift / hw);   // backS = Überlappung in den Rahmen (4 cm) → Flügel schaut ssW−backS (≈3 cm) heraus
    const recM = Math.min(fdh * 1.4, recess / ht), sdM = Math.min(fdh * 1.95, sashD / ht), smB = fmB - recM, smA = Math.max(-1, smB - sdM), gc = (smA + smB) / 2, gh = Math.min((smB - smA) * 0.42, (a.glassT || cmToPts(2)) / (2 * ht));
    const wm = WIN_MAT[a.winMat || 'holz'];
    const box = (s0, s1, mA, mB, role) => fills.push({ poly: [corner(s0, mA), corner(s1, mA), corner(s1, mB), corner(s0, mB)], fill: wm.fill, stroke: wm.stroke, role });
    const twoMull = wt === 'f2s', twoFlush = wt === 'f2', two = twoMull || twoFlush;   // f2 = direkt verbunden (kein Mittelrahmen), f2s = mit Setzholz (Mittelrahmen)
    const gIn = cmToPts(1) / hw;   // Glas greift 1 cm in die Flügel
    const div = two ? [-1, 0, 1] : [-1, 1], hasMember = dv => dv <= -0.999 || dv >= 0.999 || twoMull;
    for (const dv of div) { if (!hasMember(dv)) continue; let m0, m1; if (dv <= -0.999) { m0 = -1; m1 = -1 + fwS; } else if (dv >= 0.999) { m0 = 1 - fwS; m1 = 1; } else { m0 = -fwS / 2; m1 = fwS / 2; } box(m0, m1, fmA, fmB, 'frame'); }   // Blendrahmen (Jamben + Setzholz)
    for (let i = 0; i < div.length - 1; i++) {
      const dvL = div[i], dvR = div[i + 1];
      const lEdge = dvL <= -0.999 ? -1 + fwS : (twoMull ? fwS / 2 : 0), rEdge = dvR >= 0.999 ? 1 - fwS : (twoMull ? -fwS / 2 : 0);   // Setzholz-Kante oder Mitte
      let gl, gr;
      if (wt !== 'fest') {
        const lsa = hasMember(dvL) ? lEdge - backS : lEdge, rsb = hasMember(dvR) ? rEdge + backS : rEdge;   // Jamb/Setzholz: 4 cm Überlappung; Mitte (direkt): bündig
        box(lsa, lsa + ssW, smA, smB); box(rsb - ssW, rsb, smA, smB);   // Flügelrahmen 7×7
        gl = lsa + ssW - gIn; gr = rsb - ssW + gIn;   // Glas zwischen den Flügeln, 1 cm rein
      } else { gl = lEdge - gIn; gr = rEdge + gIn; }
      fills.push({ poly: [corner(gl, gc - gh), corner(gr, gc - gh), corner(gr, gc + gh), corner(gl, gc + gh)], fill: '#c7e2f5', stroke: '#7fa9c6' });   // Glas (blau)
    }
    if (wt !== 'fest' && !a.noSwing) {   // offener Flügel hell + Schwenkbogen + Ziehpunkt (Fenster, 1/2-flüglig); NUR im Grundriss. Geschlossen = der oben gezeichnete Flügel
      const oAngW = (a.openAngle != null ? a.openAngle : 90) * Math.PI / 180, swW = a.swing || 1, twW = cmToPts(2), Ln1 = ((2 - 2 * fwS) / (two ? 2 : 1)) * hw;
      const wleaf = (hingeS, dirAlong) => { const hp = corner(hingeS, md), cdx = ux * dirAlong, cdy = uy * dirAlong, odx = -nx * swW, ody = -ny * swW, ldx = cdx * Math.cos(oAngW) + odx * Math.sin(oAngW), ldy = cdy * Math.cos(oAngW) + ody * Math.sin(oAngW), tp = [hp[0] + ldx * Ln1, hp[1] + ldy * Ln1], px = -ldy * twW, py = ldx * twW; fills.push({ poly: [hp, tp, [tp[0] + px, tp[1] + py], [hp[0] + px, hp[1] + py]], fill: wm.fill, stroke: wm.stroke, op: 0.26 }); arcs.push({ cx: hp[0], cy: hp[1], r: Ln1, from: tp, to: [hp[0] + cdx * Ln1, hp[1] + cdy * Ln1], handle: { x: tp[0], y: tp[1], hx: hp[0], hy: hp[1], cdx, cdy, odx, ody } }); };   // Fenster öffnet nach INNEN (−nx, wo der Rahmen nicht raussteht); swing kehrt um
      if (two) { wleaf(-1 + fwS, 1); wleaf(1 - fwS, -1); }   // zwei Flügel zur Mitte
      else if (a.winHinge === 'right') wleaf(1 - fwS, -1); else wleaf(-1 + fwS, 1);
    }
  }
  else if (a.kind === 'door' && detail) {   // Tür wie Fenster: Zarge (Rahmen) + Flügel mit Schwenk; Festteil = Glas; 1-/2-flüglig
    const wt = a.winType || 'f1', wm = WIN_MAT[a.winMat || 'holz'];
    const depth = a.depth == null ? 0.5 : a.depth, md = Math.max(-1, Math.min(1, depth * 2 - 1));
    const frameD = a.frameD || cmToPts(7), frameW = a.frameW || cmToPts(6);
    const fdh = Math.min(0.49, frameD / (2 * ht)); let fmA = md - fdh, fmB = md + fdh;
    if (fmA < -1) { fmB += (-1 - fmA); fmA = -1; } if (fmB > 1) { fmA -= (fmB - 1); fmB = 1; }
    const fwS = Math.min(0.4, frameW / hw), gc = (fmA + fmB) / 2, gh = Math.min((fmB - fmA) * 0.32, (a.glassT || cmToPts(2)) / (2 * ht));
    const sw = a.swing || 1, hingeRight = a.winHinge === 'right', mid = wt === 'f2' || wt === 'f2s' || wt === 'f1f';
    const box = (s0, s1, mA, mB, role) => fills.push({ poly: [corner(s0, mA), corner(s1, mA), corner(s1, mB), corner(s0, mB)], fill: wm.fill, stroke: wm.stroke, role });
    const div = mid ? [-1, 0, 1] : [-1, 1];
    for (const dv of div) { let m0, m1; if (dv <= -0.999) { m0 = -1; m1 = -1 + fwS; } else if (dv >= 0.999) { m0 = 1 - fwS; m1 = 1; } else { m0 = -fwS / 2; m1 = fwS / 2; } box(m0, m1, fmA, fmB, 'frame'); }   // Zarge (Jamben + Mittelpfosten)
    const glassPane = (sl, sr) => fills.push({ poly: [corner(sl, gc - gh), corner(sr, gc - gh), corner(sr, gc + gh), corner(sl, gc + gh)], fill: '#c7e2f5', stroke: '#7fa9c6' });
    const oAng = (a.openAngle != null ? a.openAngle : 90) * Math.PI / 180;   // Öffnungswinkel (Standard 90°); 0 = ganz zu
    const leaf = (hingeS, dirAlong, clearWs) => {   // geschlossenes Blatt (voll) + offenes Blatt (hell) beim Winkel + Schwenkbogen
      const hp = corner(hingeS, md), Ln = clearWs * hw, tw = Math.min(fdh * 1.4 * ht, cmToPts(4));
      const cdx = ux * dirAlong, cdy = uy * dirAlong, odx = nx * sw, ody = ny * sw;   // zu-Richtung (entlang Wand) / auf-Richtung (quer)
      const ldx = cdx * Math.cos(oAng) + odx * Math.sin(oAng), ldy = cdy * Math.cos(oAng) + ody * Math.sin(oAng);   // Blattrichtung beim Öffnungswinkel
      const blade = (dx, dy, op, role) => { const tp = [hp[0] + dx * Ln, hp[1] + dy * Ln], px = -dy * tw, py = dx * tw; fills.push({ poly: [hp, tp, [tp[0] + px, tp[1] + py], [hp[0] + px, hp[1] + py]], fill: wm.fill, stroke: wm.stroke, op, role }); return tp; };
      blade(cdx, cdy, 1, 'sash');                          // geschlossen = voll (Flügel, anklickbar)
      if (!a.noSwing) { const tipO = blade(ldx, ldy, 0.26); arcs.push({ cx: hp[0], cy: hp[1], r: Ln, from: tipO, to: [hp[0] + cdx * Ln, hp[1] + cdy * Ln], handle: { x: tipO[0], y: tipO[1], hx: hp[0], hy: hp[1], cdx, cdy, odx, ody } }); }   // offen hell + Schwenkbogen + Ziehpunkt – NUR im Grundriss
    };
    if (wt === 'fest') glassPane(-1 + fwS, 1 - fwS);
    else if (wt === 'f2' || wt === 'f2s') { leaf(-1 + fwS, 1, 1 - 1.5 * fwS); leaf(1 - fwS, -1, 1 - 1.5 * fwS); }   // zwei Flügel von beiden Jamben zur Mitte
    else if (wt === 'f1f') { if (hingeRight) { glassPane(-1 + fwS, -fwS / 2); leaf(1 - fwS, -1, 1 - 1.5 * fwS); } else { leaf(-1 + fwS, 1, 1 - 1.5 * fwS); glassPane(fwS / 2, 1 - fwS); } }   // ein Flügel + Festverglasung
    else { if (hingeRight) leaf(1 - fwS, -1, 2 - 2 * fwS); else leaf(-1 + fwS, 1, 2 - 2 * fwS); }   // 1 Flügel
  }
  else {   // einfache Tür (einschichtig): geschlossen (voll) + offen (hell) beim Winkel + Schwenk
    const hS = a.hinge || 1, sN = a.swing || 1, Ln = a.w, hp = [x - ux * hw * hS, y - uy * hw * hS], oAng = (a.openAngle != null ? a.openAngle : 90) * Math.PI / 180;
    const cdx = ux * hS, cdy = uy * hS, odx = nx * sN, ody = ny * sN, ldx = cdx * Math.cos(oAng) + odx * Math.sin(oAng), ldy = cdy * Math.cos(oAng) + ody * Math.sin(oAng);
    const tipC = [hp[0] + cdx * Ln, hp[1] + cdy * Ln], tipO = [hp[0] + ldx * Ln, hp[1] + ldy * Ln], tw = cmToPts(4);
    fills.push({ poly: [hp, tipC, [tipC[0] - cdy * tw, tipC[1] + cdx * tw], [hp[0] - cdy * tw, hp[1] + cdx * tw]], fill: '#e9e6df', stroke: col });   // geschlossen voll
    if (!a.noSwing) { fills.push({ poly: [hp, tipO, [tipO[0] - ldy * tw, tipO[1] + ldx * tw], [hp[0] - ldy * tw, hp[1] + ldx * tw]], fill: '#e9e6df', stroke: col, op: 0.26 }); arcs.push({ cx: hp[0], cy: hp[1], r: Ln, from: tipO, to: tipC, handle: { x: tipO[0], y: tipO[1], hx: hp[0], hy: hp[1], cdx, cdy, odx, ody } }); }   // offen hell + Schwenk – NUR im Grundriss
  }
  return { cover, lines, arcs, bold, fills };
}
const REVEAL_MAT = { putz: { fill: '#ededed', color: '#9a9a9a' }, beton: { fill: '#dcecdf', color: '#2f7d4f' }, stahl: { fill: '#c9ccd1', color: '#565b62' }, holz: { fill: '#eedcc8', color: '#7a5126' } };
const LINING_MAT = { putz: { fill: '#ededed', stroke: '#9a9a9a' }, gips: { fill: '#f3f3f3', stroke: '#b0b0b0' }, holz: { fill: '#e7cfa8', stroke: '#7a5126' }, stahl: { fill: '#c4c8cd', stroke: '#4f545b', hatch: 1 }, alu: { fill: '#dfe3e7', stroke: '#7d848c', hatch: 1 }, dsp: { fill: '#e9d6b8', stroke: '#9a7a45' } };
const REVEAL_LINING = { gips: [['gips', 1.5], ['putz', 0.5]], holz: [['holz', 2.5]], stahl: [['stahl', 1.5]], alu: [['dsp', 1.8], ['alu', 0.7]] };   // Innen-Laibung: Gips+Putz / Holzbrett 25mm / Stahlzarge 15mm / Aluzarge (18mm Dreischichtplatte + 7mm)
function bandHatchPerp(sa, sb, ma, mb, corner, stepS, s0) {   // Striche 90° zur Wand (m-Richtung) – auf das Wand-Schraffurraster eingerastet (gleicher Abstand wie Wand)
  const out = [], sLo = Math.min(sa, sb), sHi = Math.max(sa, sb);
  if (sHi - sLo < 1e-4 || Math.abs(mb - ma) < 1e-4 || stepS <= 1e-6) return out;
  for (let s = s0 + Math.ceil((sLo - s0) / stepS) * stepS; s <= sHi + 1e-9; s += stepS) out.push([corner(s, ma), corner(s, mb)]);
  return out;
}
function bandHatch(sa, sb, ma, mb, corner, hw, ht, stepS) {   // diagonale Schraffur (≈45°) im Parameter-Rechteck s∈[sa,sb], m∈[ma,mb]; Abstand = Wand-Schraffurraster
  const out = [], sLo = Math.min(sa, sb), sHi = Math.max(sa, sb), mLo = Math.min(ma, mb), mHi = Math.max(ma, mb), dm = mHi - mLo, dsE = Math.min(dm * ht / hw, sHi - sLo);
  if (dsE <= 1e-6 || sHi - sLo < 1e-4) return out;
  const step = Math.max(stepS || cmToPts(0.7) / hw, 0.006);
  for (let s = sLo - dsE; s < sHi; s += step) {
    let aS = s, aM = mLo, bS = s + dsE, bM = mHi;
    if (aS < sLo) { const f = (sLo - aS) / (bS - aS); aS = sLo; aM = mLo + dm * f; }
    if (bS > sHi) { const f = (sHi - aS) / (bS - aS); bS = sHi; bM = aM + (bM - aM) * f; }
    if (bS > aS + 1e-6) out.push([corner(aS, aM), corner(bS, bM)]);
  }
  return out;
}
function revealEdgeSegs(poly, seam) { const n = poly.length, out = []; for (let i = 0; i < n; i++) { if (i === seam) continue; out.push([poly[i], poly[(i + 1) % n]]); } return out; }   // Rand-Kanten eines Laibungs-Streifens ausser der Naht-Kante (seam)
function ensureRevealLayers(a, arr) {   // Standard-Laibung in a.reveals materialisieren → JEDE Laibung wird anklick-/einstellbar (Dicke/Länge/Überstand/Rahmen sichtbar)
  if (a.kind !== 'window' && a.kind !== 'door') return false;
  const wall = a.wallId && arr && arr.find(o => o.id === a.wallId && o.type === 'wall');
  if (!wall || !wall.layers || wall.layers.length < 2) return false;
  const l0 = wall.layers[0], lN = wall.layers[wall.layers.length - 1], rt0 = a.revealType || 'putz', rtOut = a.revealOuter || '';
  const defIn = (Array.isArray(a.revealLining) && a.revealLining.length) ? a.revealLining.map(L => ({ mat: L.mat, t: L.t, gap: L.gap || 0, prio: L.prio }))
    : (rt0 === 'aussen' ? [{ mat: lN.mat, t: Math.min(3, Math.round(ptsToCm(lN.t) * 10) / 10) }] : (REVEAL_LINING[rt0] ? REVEAL_LINING[rt0].map(d => ({ mat: d[0], t: d[1] })) : [{ mat: l0.mat, t: Math.round(ptsToCm(l0.t) * 10) / 10 }]));
  const defOut = (Array.isArray(a.revealLiningOut) && a.revealLiningOut.length) ? a.revealLiningOut.map(L => ({ mat: L.mat, t: L.t, gap: L.gap || 0, prio: L.prio }))
    : (rtOut === 'putz' ? [{ mat: lN.mat, t: Math.min(3, Math.round(ptsToCm(lN.t) * 10) / 10) }] : (rtOut && REVEAL_LINING[rtOut] ? REVEAL_LINING[rtOut].map(d => ({ mat: d[0], t: d[1] })) : [{ mat: lN.mat, t: Math.round(ptsToCm(lN.t) * 10) / 10 }]));
  a.reveals = a.reveals || {}; let changed = false;
  for (const edge of ['L', 'R', 'T', 'B']) { a.reveals[edge] = a.reveals[edge] || {};
    if (!Array.isArray(a.reveals[edge].in) || !a.reveals[edge].in.length) { a.reveals[edge].in = defIn.map(d => ({ ...d })); changed = true; }
    if (!Array.isArray(a.reveals[edge].out) || !a.reveals[edge].out.length) { a.reveals[edge].out = defOut.map(d => ({ ...d })); changed = true; }
  }
  return changed;
}
let _revStripCache = {};
function openingRevealStrips(a, arr) {   // Laibung: 1,5 cm Rahmen sichtbar → Schalung 1,5 cm (Schraffur) → Rest Dämmung bis Rahmen; innen Putz/Brett
  const wall = a.wallId && arr && arr.find(o => o.id === a.wallId && o.type === 'wall');
  if (!wall || !wall.layers || wall.layers.length < 2 || (a.kind !== 'window' && a.kind !== 'door')) return [];
  const ck = a.id + '|' + a.wallId, sig = [a.x, a.y, a.ang, a.w, a.thick || 0, a.frameW || 0, a.depth == null ? 0.5 : a.depth, a.frameD || 0, a.revealType || '', a.revealOuter || '', a.anschlagType || '', a.anschlagDepth || 0, a.boardVis != null ? a.boardVis : '', _revSig(a), wall.layers.map(l => l.mat + (l.t || 0)).join('|'), (wall.hatch && wall.hatch.scale) || lastHatchScale].join('~');   // unveränderte Laibung → aus Cache (Schraffur/Geometrie nicht jedes Frame neu rechnen)
  const C = _revStripCache[ck]; if (C && C.sig === sig) return C.strips;
  const x = a.x, y = a.y, ang = a.ang, ht = (a.thick || wallThickPts()) / 2, hw = a.w / 2;
  const ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux, corner = (s, m) => [x + ux * hw * s + nx * ht * m, y + uy * hw * s + ny * ht * m];
  const depth = a.depth == null ? 0.5 : a.depth, md = Math.max(-1, Math.min(1, depth * 2 - 1));
  const fmh = Math.min(0.48, (a.frameD || cmToPts(7)) / (2 * ht)); let fmA = md - fmh, fmB = md + fmh;   // fmB=aussen, fmA=innen
  if (fmA < -1) { fmB += (-1 - fmA); fmA = -1; } if (fmB > 1) { fmA -= (fmB - 1); fmB = 1; }
  const gapM = cmToPts(0.5) / ht, CORE = ['mauerwerk', 'beton'], INS = ['eps', 'glaswolle', 'daemm_holz', 'daemm_wolle', 'daemm_eps', 'daemm_xps'];
  const strips = [];
  const S = (wall.hatch && wall.hatch.scale) || lastHatchScale, hStep = Math.max(4, S * 1.3), stepS = hStep / hw;   // exakt das Wand-Schraffurraster (Bildschirm-Dichte, skalenunabhängig)
  const Lx = wall.x2 - wall.x1, Ly = wall.y2 - wall.y1, Lw = Math.hypot(Lx, Ly) || 1, uxW = Lx / Lw, uyW = Ly / Lw;
  const dC = (x - wall.x1) * uxW + (y - wall.y1) * uyW, sgnDir = (ux * uxW + uy * uyW) >= 0 ? 1 : -1, s0 = sgnDir * (Math.round(dC / hStep) * hStep - dC) / hw;   // Phase: auf das Wandraster (Ursprung Wandanfang) eingerastet
  let coreIdx = wall.layers.findIndex(l => CORE.includes(l.mat)); if (coreIdx < 0) coreIdx = Math.floor((wall.layers.length - 1) / 2);
  const l0 = wall.layers[0], lN = wall.layers[wall.layers.length - 1], rt0 = a.revealType || 'putz';   // Innen-Laibungs-Element nach Typ
  const anType = a.anschlagType || 'none', oneCm = cmToPts(1) / ht;   // 1 cm in m-Richtung – Putz nie näher als 1 cm an den Flügel
  const userLin = Array.isArray(a.revealLining) && a.revealLining.length ? a.revealLining.map(L => [L.mat, L.t, (L.depth == null ? 1 : L.depth), (L.protrude || 0), L.dF, L.dS, L.sOff]) : null;   // innen: +sOff (seitl. Versatz entlang der Laibung)
  const userLinOut = Array.isArray(a.revealLiningOut) && a.revealLiningOut.length ? a.revealLiningOut.map(L => [L.mat, L.t, (L.depth == null ? 1 : L.depth), (L.protrude || 0), L.dF, L.dS, L.sOff]) : null;   // aussen
  // NEUES Modell: die Laibung lappt seitlich AUF den Rahmen (Standard: frameW − 1cm sichtbar). Schichten stapeln in die Tiefe (m), die Deckschicht lappt voll, dahinterliegende Schichten treten um deren Dicke zurück (z. B. Putz voll, Dämmung dahinter).
  const boardVisCm = a.boardVis != null ? a.boardVis : 1;   // wie viel cm vom Rahmen sichtbar bleiben (Standard 1 cm)
  const drawReveal = (layers, sideOut, sgn, slopeCm, bv, edge) => {   // EINE Laibungsseite: bv = „Rahmen sichtbar" (eine Logik). >0 = Laibung lappt auf Rahmen, Rest sichtbar. <0 = Laibung deckt ganzen Rahmen und verlängert sich (Wand zurückgeschnitten, Öffnung grösser)
    if (!layers || !layers.length) return;
    if (a.noSillReveal && sgn < 0) return;   // Schwelle bei Fensterbank überspringen (nur im Schnitt-sa relevant)
    const frameWpt = a.frameW || cmToPts(10), lapNom = frameWpt - cmToPts(bv != null ? bv : boardVisCm), lapPt = Math.max(0, Math.min(hw * 0.92, lapNom)), growPt = Math.max(0, lapNom - frameWpt);   // Lappung frei bis fast zur Öffnungsmitte (nicht mehr bei Rahmenbreite gekappt) → volle Zieh-Freiheit; >Rahmen schneidet die Wand zurück (grow)
    const mFrame = sideOut ? (fmB + oneCm) : (fmA - oneCm), mFace = sideOut ? 1 : -1, dirF = Math.sign(mFrame - mFace) || 1, fullDepth = Math.abs(mFrame - mFace), offP = cmToPts(slopeCm || 0), sd = sideOut ? 'o' : 'i';
    if (fullDepth < 0.02) return;
    const ord = layers.slice().sort((x, y) => (y[3] != null ? y[3] : 2) - (x[3] != null ? x[3] : 2));   // PRIORITÄT: höchste direkt am Rahmen, niedrigere nach aussen
    let sIn = lapPt;
    ord.forEach((L, idx) => {
      const mat = L[0], tcm = L[1], gap = L[2] || 0, len = L[5], over = L[6], mt = LINING_MAT[mat] || WALL_MATS[mat] || {};
      const mB2 = mFace + (-dirF) * (over ? cmToPts(over) / ht : 0), mA2 = (len != null) ? Math.max(-1.15, Math.min(1.15, mFace + dirF * cmToPts(len) / ht)) : mFrame, m0 = Math.min(mA2, mB2), m1 = Math.max(mA2, mB2);   // Länge (len) darf über den Rahmen hinaus; Überstand/Rücksprung (over)
      const sOut = sIn - cmToPts(tcm);   // jede Schicht behält ihre Dicke – die Laibung wandert nur (kein Mitwachsen)
      const sk = mt.stroke || mt.color || '#1c242c';
      if (sIn - sOut > 0.05 && m1 - m0 > 0.005) { const aI = sgn * (1 - sIn / hw), aO = sgn * (1 - sOut / hw), bI = sgn * (1 - (sIn - offP) / hw), bO = sgn * (1 - (sOut - offP) / hw), ss = [aI, aO, bI, bO]; strips.push({ poly: [corner(aI, mA2), corner(aO, mA2), corner(bO, mB2), corner(bI, mB2)], fill: mt.fill || '#fff', stroke: sk, edge, side: sd, li: L[4], hatch: mt.hatch ? bandHatch(Math.min(...ss), Math.max(...ss), m0, m1, corner, hw, ht, stepS) : null }); }
      sIn = sOut - cmToPts(gap);
    });
  };
  const innerLayers = userLin ? a.revealLining.map(L => [L.mat, L.t, L.gap || 0, L.prio]) : (rt0 === 'aussen' ? [[lN.mat, Math.min(3, ptsToCm(lN.t))]] : (REVEAL_LINING[rt0] || [[l0.mat, ptsToCm(l0.t)]]));
  const rtOut = a.revealOuter || '';
  const outerLayers = userLinOut ? a.revealLiningOut.map(L => [L.mat, L.t, L.gap || 0, L.prio]) : (rtOut === 'putz' ? [[lN.mat, Math.min(3, ptsToCm(lN.t))]] : (rtOut ? (REVEAL_LINING[rtOut] || [[lN.mat, Math.min(3, ptsToCm(lN.t))]]) : [[lN.mat, ptsToCm(lN.t)]]));
  for (const sgn of [-1, 1]) {   // links (sgn -1, Kante L) und rechts (sgn +1, Kante R) je eigene Laibung; Fallback = globale Liste
    const edge = sgn < 0 ? 'L' : 'R', er = a.reveals && a.reveals[edge], slope = (er && er.slope) || 0;
    const bvIn = er && er.boardVisIn != null ? er.boardVisIn : (er && er.boardVis != null ? er.boardVis : boardVisCm), bvOut = er && er.boardVisOut != null ? er.boardVisOut : (er && er.boardVis != null ? er.boardVis : boardVisCm);   // „Rahmen sichtbar" je Seite (innen/aussen) eigenständig
    if (anType !== 'innen') drawReveal(openingEdgeLayers(a, edge, 'i') || innerLayers, false, sgn, slope, bvIn, edge);
    if (anType !== 'aussen') drawReveal(openingEdgeLayers(a, edge, 'o') || outerLayers, true, sgn, slope, bvOut, edge);
  }
  if (anType !== 'none') {
    const core = wall.layers[coreIdx] || wall.layers[0], cmat = WALL_MATS[core.mat] || {};
    const fwSr = Math.min(0.45, (a.frameW || cmToPts(10)) / hw), anS = Math.min(0.6, cmToPts(a.anschlagDepth != null ? a.anschlagDepth : 5) / hw);
    const hatchOf = (mat, sA, sB, mA, mB) => { const mt = WALL_MATS[mat] || {}; return (mt.hatch === 'daemm_eps' || mt.hatch === 'daemm_wolle' || (mt.hatch && INS.includes(mat))) ? bandHatchPerp(Math.min(sA, sB), Math.max(sA, sB), mA, mB, corner, stepS, s0) : (mt.hatch ? bandHatch(Math.min(sA, sB), Math.max(sA, sB), mA, mB, corner, hw, ht, stepS) : null); };
    if (anType === 'innen') {   // INNENANSCHLAG: Mauerwerks-Schulter raumseitig vor dem Rahmen; innere Deckschicht (Putz) läuft um die Ecke, 1 cm vor dem Flügel
      const sEdge = Math.max(0, 1 - Math.min(anS, fwSr * 0.85)), mHi = fmA;          // Schulter deckt max. ~85% der Rahmenbreite – nie bis zum Flügel/Glas
      const fin = coreIdx > 0 ? wall.layers[coreIdx - 1] : null, fmat = fin ? (WALL_MATS[fin.mat] || {}) : null;
      const putzTm = fin ? Math.min(0.5, fin.t / ht) : 0, putzTs = fin ? Math.min(0.3, fin.t / hw) : 0;   // Putzdicke quer (m) bzw. längs (s)
      const finMHi = Math.max(-1 + 0.02, fmA - oneCm), mLoMas = -1 + putzTm;          // Putz endet 1 cm vor Rahmen; Mauerwerk hinter dem raumseitigen Putz
      for (const sgn of [-1, 1]) {
        const sJ = sgn, sEdgeS = sgn * sEdge;
        if (Math.abs(mHi - mLoMas) > 0.02 && Math.abs(sEdgeS - sJ) > 0.02) strips.push({ poly: [corner(sJ, mLoMas), corner(sEdgeS, mLoMas), corner(sEdgeS, mHi), corner(sJ, mHi)], fill: cmat.fill || '#fff', stroke: cmat.color || '#1c242c', hatch: hatchOf(core.mat, sJ, sEdgeS, mLoMas, mHi) });   // Mauerwerks-Schulter
        if (fin && putzTm > 0.005) {
          strips.push({ poly: [corner(sJ, -1), corner(sEdgeS, -1), corner(sEdgeS, mLoMas), corner(sJ, mLoMas)], fill: fmat.fill || '#fff', stroke: fmat.color || '#1c242c', hatch: hatchOf(fin.mat, sJ, sEdgeS, -1, mLoMas) });   // Putz raumseitig über die Schulter → verbindet mit gerader Wand
          const sb = sEdgeS - sgn * putzTs;
          strips.push({ poly: [corner(sEdgeS, -1), corner(sb, -1), corner(sb, finMHi), corner(sEdgeS, finMHi)], fill: fmat.fill || '#fff', stroke: fmat.color || '#1c242c', seam: 0, hatch: hatchOf(fin.mat, sEdgeS, sb, -1, finMHi) });   // Putz-Return (Naht zur raumseitigen Schicht = Kante 0)
        }
      }
    } else {   // AUSSENANSCHLAG: Mauerwerk/Konstruktion aussen vor den Rahmen
      const mLo = fmB, mHi = 1;
      for (const sgn of [-1, 1]) { const s0b = sgn, s1 = sgn * Math.max(0, 1 - fwSr - anS); if (Math.abs(mHi - mLo) > 0.02 && Math.abs(s1 - s0b) > 0.02) strips.push({ poly: [corner(s0b, mLo), corner(s1, mLo), corner(s1, mHi), corner(s0b, mHi)], fill: cmat.fill || '#fff', stroke: cmat.color || '#1c242c', hatch: hatchOf(core.mat, s0b, s1, mLo, mHi) }); }
    }
  }
  for (const st of strips) if (st.seam == null && !st.board) st.seam = 3;   // Standard: nur die Kante am Stoß zur Wand (Kante 3) läuft randlos durch; übrige Kanten behalten den Rahmen
  _revStripCache[ck] = { sig, strips }; return strips;
}
function openingLichtW(o) {   // Rohbau-, Aussenlicht-, Innenlichtmass (Fenster)
  const roh = o.w; if (o.kind !== 'window') return { roh };
  return { roh, aussen: roh - 2 * (o.outerLap || cmToPts(3)), innen: roh - 2 * (o.innerReveal || cmToPts(2)) };
}
function openingDetail(a, arr) { const wall = a.wallId && arr && arr.find(o => o.id === a.wallId && o.type === 'wall'); return !!(wall && !wallSimple(wall) && wall.layers && wall.layers.length); }
function drawOpening(svg, a, arr) {
  if (sel && sel.num != null && sel.id === a.id) ensureRevealLayers(a, arr);   // gewähltes Fenster: Standard-Laibung materialisieren → anklick-/einstellbar
  const detail = openingDetail(a, arr), P = openingParts(a, detail), col = a.color || '#1c242c';
  const g = svgEl('g', { 'data-id': a.id, class: 'opening-g' });
  const coverPoly = (window.polygonClipping && a.x != null && a.wallId) ? openingCutPoly(a) : P.cover;   // nur den freien Teil ausstanzen (Wand-Lappung bleibt sichtbar)
  g.appendChild(svgEl('polygon', { points: coverPoly.map(p => p[0] + ',' + p[1]).join(' '), fill: '#fff', stroke: 'none' }));   // Wand ausstanzen (Laibungs-aware)
  const revHits = [], hatchG = svgEl('g', { class: 'rev-hatch' });   // Laibungs-Schichten + Schraffur (Schraffur nur beim Drüberfahren sichtbar)
  if (detail) for (const st of openingRevealStrips(a, arr)) { const pgr = svgEl('polygon', { points: st.poly.map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' '), fill: st.fill, stroke: st.seam == null ? st.stroke : 'none', 'stroke-width': 0.7, 'vector-effect': 'non-scaling-stroke' }); g.appendChild(pgr); if (st.edge != null && st.li != null) revHits.push(st); if (st.seam != null) for (const [u, v] of revealEdgeSegs(st.poly, st.seam)) g.appendChild(svgEl('line', { x1: u[0], y1: u[1], x2: v[0], y2: v[1], stroke: st.stroke, 'stroke-width': 0.7, 'vector-effect': 'non-scaling-stroke' })); if (st.hatch) for (const [u, v] of st.hatch) hatchG.appendChild(svgEl('line', { x1: u[0], y1: u[1], x2: v[0], y2: v[1], stroke: st.stroke, 'stroke-width': 0.8, 'vector-effect': 'non-scaling-stroke' })); }
  if (hatchG.childNodes.length) g.appendChild(hatchG);   // Laibungs-Schraffur in eigene Gruppe → standardmäßig aus, nur bei Hover an
  for (const f of (P.fills || [])) g.appendChild(svgEl('polygon', { points: f.poly.map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' '), fill: f.fill, stroke: f.stroke, 'stroke-width': 1, 'fill-opacity': f.op != null ? f.op : 1, 'stroke-opacity': f.op != null ? f.op : 1, 'vector-effect': 'non-scaling-stroke' }));   // Rahmen/Flügel/Glas (Fenstermaterial); op = offenes Türblatt hell
  for (const [u, v] of P.lines) g.appendChild(svgEl('line', { x1: u[0], y1: u[1], x2: v[0], y2: v[1], stroke: col, 'stroke-width': 1.4, 'vector-effect': 'non-scaling-stroke' }));
  for (const [u, v] of (P.bold || [])) g.appendChild(svgEl('line', { x1: u[0], y1: u[1], x2: v[0], y2: v[1], stroke: col, 'stroke-width': 2.6, 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' }));
  const seld = sel && sel.num != null && sel.id === a.id;
  for (const arc of P.arcs) { g.appendChild(svgEl('polyline', { points: arcPts(arc.cx, arc.cy, arc.r, arc.from, arc.to, 18).map(p => p[0] + ',' + p[1]).join(' '), fill: 'none', stroke: col, 'stroke-width': 0.8, 'stroke-dasharray': '4 3', 'vector-effect': 'non-scaling-stroke' })); if (arc.handle) _angHandles[a.id] = arc.handle; }
  svg.appendChild(g);
  svg.appendChild(svgEl('polygon', { points: P.cover.map(p => p[0] + ',' + p[1]).join(' '), fill: 'transparent', 'data-id': a.id }));
  { const hw3 = (a.w || 0) / 2, uxa = Math.cos(a.ang || 0), uya = Math.sin(a.ang || 0), nxa = -uya, nya = uxa, ht3 = (a.thick || wallThickPts()) / 2 + 1; for (const sd of [-1, 1]) { const ex = a.x + uxa * hw3 * sd, ey = a.y + uya * hw3 * sd, ix = a.x + uxa * hw3 * sd * 0.82, iy = a.y + uya * hw3 * sd * 0.82, poly = [[ix - nxa * ht3, iy - nya * ht3], [ex - nxa * ht3, ey - nya * ht3], [ex + nxa * ht3, ey + nya * ht3], [ix + nxa * ht3, iy + nya * ht3]]; const z = svgEl('polygon', { points: poly.map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' '), fill: 'transparent', 'data-id': a.id, 'data-ow': String(sd) }); z.style.cursor = 'ew-resize'; svg.appendChild(z); } }   // Kantenzonen: Fensterbreite direkt an der Kante ziehen (auch ohne Auswahl)
  if (seld && !_fastDraw) for (const f of (P.fills || [])) { if (f.role !== 'frame' && f.role !== 'sash') continue; svg.appendChild(svgEl('polygon', { class: 'frame-hit', points: f.poly.map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' '), fill: '#37404a', 'fill-opacity': 0.10, stroke: '#37404a', 'stroke-width': 1, 'stroke-opacity': 0.7, 'stroke-dasharray': '4 3', 'vector-effect': 'non-scaling-stroke', 'data-id': a.id, 'data-frame': '1' })); }   // Rahmen + Flügel: gestrichelte Anthrazit-Linie, anklickbar (kein Hover)
  if (seld && !_fastDraw) for (const arc of P.arcs) { if (!arc.handle) continue; const c = svgEl('circle', { cx: arc.handle.x.toFixed(2), cy: arc.handle.y.toFixed(2), r: 5, fill: '#fff', stroke: '#2a7', 'stroke-width': 2, 'data-id': a.id, 'data-ah': '1', 'vector-effect': 'non-scaling-stroke' }); c.style.cursor = 'grab'; svg.appendChild(c); }   // Ziehpunkt: Öffnungswinkel
  if (seld && !_fastDraw) { const seen = {}; const edgeStrip = (A, B, attr) => { const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1, ox = -dy / L * 6, oy = dx / L * 6, poly = [[A[0] + ox, A[1] + oy], [B[0] + ox, B[1] + oy], [B[0] - ox, B[1] - oy], [A[0] - ox, A[1] - oy]]; svg.appendChild(svgEl('polygon', Object.assign({ points: poly.map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' '), fill: 'transparent', stroke: 'none', 'data-id': a.id }, attr))); };   // unsichtbare Ziehkante (Hit-Zone) – KEINE Hover-Effekte
    const pmBtn = (px0, py0, sym, attr, col) => { const c = svgEl('circle', Object.assign({ class: 'pm-btn', cx: px0.toFixed(2), cy: py0.toFixed(2), r: 3.4, fill: '#fff', stroke: col, 'stroke-width': 0.9, 'vector-effect': 'non-scaling-stroke', 'data-id': a.id }, attr)); c.style.cursor = 'pointer'; const t = svgEl('text', { class: 'pm-btn', x: px0.toFixed(2), y: (py0 + 0.2).toFixed(2), 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 5.5, 'font-weight': 700, fill: col }); t.style.pointerEvents = 'none'; t.textContent = sym; svg.appendChild(c); svg.appendChild(t); };
    for (const st of revHits) { const q = st.poly; if (q.length < 4) continue; const sgn = st.edge === 'R' ? 1 : -1, ca = Math.cos(a.ang || 0), sa = Math.sin(a.ang || 0), key = st.edge + ':' + st.side + ':' + st.li, gc = revealGroupColor(a, st.edge, st.side === 'i' ? 'in' : 'out');
      svg.appendChild(svgEl('polygon', { class: 'rev-hit', points: q.map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' '), fill: gc, 'fill-opacity': 0.10, stroke: gc, 'stroke-width': 1, 'stroke-opacity': 0.85, 'stroke-dasharray': '4 3', 'vector-effect': 'non-scaling-stroke', 'data-id': a.id, 'data-rev': key }));   // Laibungs-Linie (gestrichelt), anklickbar – KEIN Hover-Glow
      const k2 = st.edge + ':' + st.side; if (!seen[k2]) { seen[k2] = 1; _revtHandles[a.id + '|' + key] = { dirx: -sgn * ca, diry: -sgn * sa }; edgeStrip(q[0], q[3], { 'data-revt': key }); }   // Lappung (Rahmen sichtbar)
      const fmx = (q[0][0] + q[3][0]) / 2, fmy = (q[0][1] + q[3][1]) / 2, flx = (q[2][0] + q[3][0]) / 2, fly = (q[2][1] + q[3][1]) / 2, odx = flx - fmx, ody = fly - fmy, odl = Math.hypot(odx, ody) || 1; _revoHandles[a.id + '|' + key] = { dirx: odx / odl, diry: ody / odl, li: st.li }; edgeStrip(q[2], q[3], { 'data-revo': key });   // Überstand
      const tdx = q[1][0] - q[0][0], tdy = q[1][1] - q[0][1], tdl = Math.hypot(tdx, tdy) || 1; _revThickHandles[a.id + '|' + key] = { dirx: tdx / tdl, diry: tdy / tdl }; edgeStrip(q[1], q[2], { 'data-revtk': key });   // Dicke
      const ldx = q[0][0] - q[3][0], ldy = q[0][1] - q[3][1], ldl = Math.hypot(ldx, ldy) || 1; _revLenHandles[a.id + '|' + key] = { dirx: ldx / ldl, diry: ldy / ldl, depthCm: Math.round(ptsToCm(ldl) * 10) / 10 }; edgeStrip(q[0], q[1], { 'data-revln': key });   // Tiefe/Länge
      const mx = (q[1][0] + q[2][0]) / 2, my = (q[1][1] + q[2][1]) / 2, ex = q[2][0] - q[1][0], ey = q[2][1] - q[1][1], el = Math.hypot(ex, ey) || 1, ux2 = ex / el, uy2 = ey / el;   // + / − klein an der wandseitigen Kante (sOut)
      pmBtn(mx - ux2 * 4.5, my - uy2 * 4.5, '+', { 'data-revadd': key }, gc);
      pmBtn(mx + ux2 * 4.5, my + uy2 * 4.5, '−', { 'data-revdel': key }, gc);
    }
    const uxF = Math.cos(a.ang || 0), uyF = Math.sin(a.ang || 0); let fi = 0;   // Rahmenbreite an der inneren Rahmenkante ziehen (Flügel: per Zahlen im Popup)
    for (const f of (P.fills || [])) { if (f.role !== 'frame') continue; const q = f.poly; if (q.length < 4) continue;
      const e1 = [(q[0][0] + q[3][0]) / 2, (q[0][1] + q[3][1]) / 2], e2 = [(q[1][0] + q[2][0]) / 2, (q[1][1] + q[2][1]) / 2];
      const inner = Math.hypot(e1[0] - a.x, e1[1] - a.y) < Math.hypot(e2[0] - a.x, e2[1] - a.y) ? [q[0], q[3]] : [q[1], q[2]];
      const bcx = (q[0][0] + q[1][0] + q[2][0] + q[3][0]) / 4, bcy = (q[0][1] + q[1][1] + q[2][1] + q[3][1]) / 4, sSign = ((bcx - a.x) * uxF + (bcy - a.y) * uyF) < 0 ? 1 : -1;
      const key = 'fw:' + (fi++); _dimHandles[a.id + '|' + key] = { dirx: sSign * uxF, diry: sSign * uyF, prop: 'frameW', def: a.kind === 'window' ? 10 : 6, min: 1, max: 30 };
      edgeStrip(inner[0], inner[1], { 'data-dim': key });   // Rahmenbreite (unsichtbare Ziehkante)
    } }
  // Breiten-Änderung: einfach am kurzen Ende ganz aussen am Rahmen ziehen (Kantenzonen data-ow oben) – keine extra Griffe nötig
  return g;
}
function popDrag(pop, head, ignore) {   // Popup am Titel verschiebbar (falls es im Weg ist)
  head.style.cursor = 'move';
  head.addEventListener('pointerdown', ev => { if (ignore && (ev.target === ignore || (ignore.contains && ignore.contains(ev.target)))) return; const sx = ev.clientX, sy = ev.clientY, l0 = pop.offsetLeft, t0 = pop.offsetTop; const mv = e2 => { pop.style.left = (l0 + e2.clientX - sx) + 'px'; pop.style.top = (t0 + e2.clientY - sy) + 'px'; }; const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); }; document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up); ev.preventDefault(); });
}
function openRevealLayerPop(pv, a, revAttr, cx, cy) {   // Inline-Editor für EINE Laibungsschicht (im Grundriss angeklickt): Material/Dicke + „Rahmen sichtbar" dieser Kante
  document.querySelectorAll('.rev-pop').forEach(n => n.remove());
  const parts = (revAttr || '').split(':'), edge = parts[0], sk = parts[1] === 'i' ? 'in' : 'out', li = +parts[2];
  ensureRevealLayers(a, getAnnos(pv.num));   // Standard-Laibung sicherstellen, damit die Schicht existiert + editierbar ist
  a.reveals = a.reveals || {}; a.reveals[edge] = a.reveals[edge] || {}; if (!Array.isArray(a.reveals[edge][sk])) a.reveals[edge][sk] = [];
  const lst = a.reveals[edge][sk]; if (!lst[li]) lst[li] = { mat: 'putz', t: 1.5 }; const L = lst[li];
  const EDGEN = { L: 'Laibung links', R: 'Laibung rechts', T: 'Sturz', B: 'Schwelle' }, SIDEN = sk === 'in' ? 'innen' : 'aussen', matOpts = Object.keys(WALL_MATS).map(k => [k, WALL_MATS[k].label || k]);
  const pop = document.createElement('div'); pop.className = 'rev-pop'; pop.style.cssText = 'position:fixed;z-index:99999;background:#fff;border:1px solid #b8c0ad;border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.2);padding:10px 11px;font:13px system-ui;min-width:220px';
  const upd = () => { drawAnnos(pv); saveState(); };
  const eachEdge = cb => { const es = revealCouple === 'none' ? [edge] : ['L', 'R', 'T', 'B'], sides = revealCouple === 'all' ? ['in', 'out'] : [sk]; for (const e of es) { a.reveals[e] = a.reveals[e] || {}; for (const s2 of sides) { if (!Array.isArray(a.reveals[e][s2])) a.reveals[e][s2] = []; cb(a.reveals[e], a.reveals[e][s2], s2); } } };   // none=nur Kante · side=alle Kanten dieser Seite · all=alle Kanten beide Seiten
  const head = document.createElement('div'); head.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:5px;font-weight:600'; head.innerHTML = '<span>' + (EDGEN[edge] || edge) + ' · ' + SIDEN + '</span>'; const xb = document.createElement('button'); xb.textContent = '✕'; xb.style.cssText = 'margin-left:auto;border:none;background:none;cursor:pointer;font-size:15px'; xb.onclick = () => pop.remove(); head.appendChild(xb); pop.appendChild(head);
  const cbar = document.createElement('div'); cbar.style.cssText = 'display:flex;gap:5px;margin-bottom:7px'; const sideLbl = sk === 'in' ? 'innere' : 'äussere';
  const cBtn = (label, mode, title) => { const b = document.createElement('button'); b.textContent = label; b.title = title; b.style.cssText = 'flex:1;padding:4px 3px;cursor:pointer;border:1px solid #b8c0ad;border-radius:6px;font-size:12px;background:' + (revealCouple === mode ? '#cfe6c4' : '#fff'); b.onclick = () => { revealCouple = (revealCouple === mode ? 'none' : mode); pop.remove(); openRevealLayerPop(pv, a, revAttr, cx, cy); }; return b; };
  cbar.appendChild(cBtn('🔗 ' + sideLbl + ' gekoppelt', 'side', 'Alle 4 ' + sideLbl + ' Laibungen gemeinsam bearbeiten (Standard)'));
  cbar.appendChild(cBtn('🔗 alle gekoppelt', 'all', 'Alle Laibungen innen + aussen gemeinsam bearbeiten'));
  pop.appendChild(cbar);
  const cnote = document.createElement('div'); cnote.style.cssText = 'margin:-3px 0 7px;color:#7a8366;font-size:11px'; cnote.textContent = revealCouple === 'none' ? 'nur diese Kante (' + (EDGEN[edge] || edge) + ' ' + SIDEN + ')' : revealCouple === 'side' ? 'wirkt auf alle ' + sideLbl + ' Laibungen' : 'wirkt auf alle Laibungen (innen + aussen)'; pop.appendChild(cnote);
  const wallA = a.wallId && (annos[pv.num] || []).find(o => o.id === a.wallId && o.type === 'wall'), wls = wallA && Array.isArray(wallA.layers) ? wallA.layers : null, dL = wls && wls.length ? (sk === 'out' ? wls[wls.length - 1] : wls[0]) : null, defMat = dL ? dL.mat : 'putz', defT = dL ? Math.round(ptsToCm(dL.t) * 10) / 10 : 1.5;   // Standardwerte = Wand-Deckschicht dieser Seite
  const mk = (lbl, node, reset) => { const r = document.createElement('div'); r.style.cssText = 'display:flex;align-items:center;gap:6px;margin:3px 0'; const s = document.createElement('span'); s.textContent = lbl; s.style.cssText = 'flex:1;color:#5a6152'; r.appendChild(s); r.appendChild(node); if (reset) { const rb = document.createElement('button'); rb.textContent = '↺'; rb.title = 'Zurück zum Standard'; rb.style.cssText = 'border:none;background:none;cursor:pointer;color:#7a8366;font-size:14px;padding:0 2px'; rb.onclick = reset; r.appendChild(rb); } pop.appendChild(r); };
  const ms = document.createElement('select'); matOpts.forEach(([k, lab]) => { const o = document.createElement('option'); o.value = k; o.textContent = lab; if (k === L.mat) o.selected = true; ms.appendChild(o); }); ms.onchange = () => { eachEdge((er, l2) => { if (l2[li]) l2[li].mat = ms.value; }); upd(); }; mk('Material', ms, () => { eachEdge((er, l2) => { if (l2[li]) l2[li].mat = defMat; }); ms.value = defMat; upd(); });
  const tn = document.createElement('input'); tn.type = 'number'; tn.min = '0.1'; tn.max = '30'; tn.step = '0.1'; tn.value = L.t; tn.style.width = '62px'; tn.onchange = () => { const v = parseFloat((tn.value || '').replace(',', '.')); if (v > 0) { eachEdge((er, l2) => { if (l2[li]) l2[li].t = v; }); upd(); } }; mk('Dicke (cm)', tn, () => { eachEdge((er, l2) => { if (l2[li]) l2[li].t = defT; }); tn.value = defT; upd(); });
  const ln = document.createElement('input'); ln.type = 'number'; ln.min = '0'; ln.max = '80'; ln.step = '0.5'; ln.value = (L.len != null ? L.len : ''); ln.placeholder = 'bis Rahmen'; ln.style.width = '62px'; ln.title = 'Länge/Tiefe der Schicht (cm, von der Wandfläche). Leer = bis zum Rahmen. Darf über den Rahmen hinaus (z. B. Mauerwerk tiefer)'; ln.onchange = () => { const v = parseFloat((ln.value || '').replace(',', '.')), nv = (ln.value === '' || isNaN(v)) ? undefined : Math.max(0, v); eachEdge((er, l2) => { if (l2[li]) l2[li].len = nv; }); upd(); }; mk('Länge/Tiefe (cm)', ln, () => { eachEdge((er, l2) => { if (l2[li]) l2[li].len = undefined; }); ln.value = ''; upd(); });
  const ov = document.createElement('input'); ov.type = 'number'; ov.min = '-20'; ov.max = '20'; ov.step = '0.1'; ov.value = (L.over != null ? L.over : 0); ov.style.width = '62px'; ov.title = 'Überstand (+) über die Wandfläche / Rücksprung (−) dahinter (cm)'; ov.onchange = () => { const v = parseFloat((ov.value || '').replace(',', '.')), nv = isNaN(v) ? 0 : v; eachEdge((er, l2) => { if (l2[li]) l2[li].over = nv; }); upd(); }; mk('Überstand +/− (cm)', ov, () => { eachEdge((er, l2) => { if (l2[li]) l2[li].over = 0; }); ov.value = 0; upd(); });
  const bvKey = sk === 'in' ? 'boardVisIn' : 'boardVisOut', frameWcm = Math.round(ptsToCm(a.frameW || cmToPts(10)) * 10) / 10, FINm = ['putz', 'gips', 'dsp'], inFinT = wls && wls[0] && FINm.includes(wls[0].mat) ? Math.round(ptsToCm(wls[0].t) * 10) / 10 : 0, defBv = sk === 'in' ? Math.max(0, frameWcm - inFinT) : 1;   // Standard: innen Mauerwerk bündig (frameW − Innenputz), aussen 1
  const curBv = a.reveals[edge][bvKey] != null ? a.reveals[edge][bvKey] : (a.reveals[edge].boardVis != null ? a.reveals[edge].boardVis : defBv);
  const bvv = document.createElement('input'); bvv.type = 'number'; bvv.min = '-30'; bvv.max = '30'; bvv.step = '0.1'; bvv.value = curBv; bvv.style.width = '62px'; bvv.title = 'cm Rahmen sichtbar (' + SIDEN + '). Positiv = Laibung lappt auf Rahmen, Rest sichtbar. Negativ = Laibung deckt ganzen Rahmen und verlängert sich (Wand zurückgeschnitten, Öffnung grösser)'; bvv.onchange = () => { const v = parseFloat((bvv.value || '').replace(',', '.')), nv = isNaN(v) ? defBv : v; eachEdge(er => { er[bvKey] = nv; }); upd(); }; mk('Rahmen sichtbar ' + SIDEN + ' (cm)', bvv, () => { eachEdge(er => { er[bvKey] = defBv; }); bvv.value = defBv; upd(); });
  const bar = document.createElement('div'); bar.style.cssText = 'display:flex;gap:6px;margin-top:8px';
  const add = document.createElement('button'); add.textContent = '+ Schicht'; add.style.cssText = 'flex:1;padding:4px;cursor:pointer'; add.onclick = () => { eachEdge((er, l2) => { l2.splice(li + 1, 0, { mat: 'putz', t: 1 }); }); upd(); pop.remove(); };
  const del = document.createElement('button'); del.textContent = '✕ Schicht'; del.style.cssText = 'flex:1;padding:4px;cursor:pointer'; del.onclick = () => { eachEdge((er, l2) => { if (l2[li]) l2.splice(li, 1); }); upd(); pop.remove(); };
  bar.appendChild(add); bar.appendChild(del); pop.appendChild(bar);
  const dt = document.createElement('button'); dt.textContent = '⊕ Detail (alle Kanten: Sturz/Schwelle…)'; dt.style.cssText = 'width:100%;margin-top:6px;padding:4px;cursor:pointer'; dt.onclick = () => { pop.remove(); try { openLaibungEditor(a, pv); } catch (_) { } }; pop.appendChild(dt);
  document.body.appendChild(pop);
  pop.style.left = Math.max(8, Math.min((cx || 200) + 8, window.innerWidth - pop.offsetWidth - 12)) + 'px';
  pop.style.top = Math.max(8, Math.min((cy || 200) + 8, window.innerHeight - pop.offsetHeight - 12)) + 'px';
  popDrag(pop, head, xb);   // am Titel verschiebbar, falls im Weg
  const close = ev => { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('pointerdown', close, true); } };
  setTimeout(() => document.addEventListener('pointerdown', close, true), 0);
}
function buildFrameFields(host, a, pv) {   // Rahmen-/Flügel-Felder in einen beliebigen Container (Popup ODER Inspector)
  host.innerHTML = ''; const isWin = a.kind === 'window', cm = v => Math.round(ptsToCm(v) * 10) / 10, upd = () => { drawAnnos(pv); saveState(); };
  const mk = (lbl, node, reset) => { const r = document.createElement('div'); r.className = 'insp-row'; const s = document.createElement('span'); s.textContent = lbl; s.className = 'insp-lbl'; r.appendChild(s); r.appendChild(node); if (reset) { const rb = document.createElement('button'); rb.textContent = '↺'; rb.title = 'Zurück zum Standard'; rb.className = 'insp-rst'; rb.onclick = reset; r.appendChild(rb); } host.appendChild(r); };
  const numF = (val, mn, mx, set, def) => { const n = document.createElement('input'); n.type = 'number'; n.min = mn; n.max = mx; n.step = '0.1'; n.value = val; n.className = 'insp-num'; n.onchange = () => { const v = parseFloat((n.value || '').replace(',', '.')); if (!isNaN(v)) { set(v); upd(); } }; return { n, reset: () => { n.value = def; set(def); upd(); } }; };
  const selF = (opts, cur, set) => { const sl = document.createElement('select'); sl.className = 'insp-sel'; opts.forEach(([k, lab]) => { const o = document.createElement('option'); o.value = k; o.textContent = lab; if (k === cur) o.selected = true; sl.appendChild(o); }); sl.onchange = () => { set(sl.value); upd(); }; return sl; };
  const fwd = isWin ? 10 : 6, fw = numF(cm(a.frameW || cmToPts(fwd)), '1', '30', v => a.frameW = cmToPts(v), fwd); mk('Rahmenbreite (cm)', fw.n, fw.reset);
  const fd = numF(cm(a.frameD || cmToPts(7)), '2', '40', v => a.frameD = cmToPts(v), 7); mk('Rahmentiefe (cm)', fd.n, fd.reset);
  if (isWin) {
    const sw = numF(cm(a.sashW || cmToPts(7)), '2', '20', v => a.sashW = cmToPts(v), 7); mk('Flügelbreite (cm)', sw.n, sw.reset);
    const sd = numF(cm(a.sashD || cmToPts(7)), '2', '20', v => a.sashD = cmToPts(v), 7); mk('Flügeltiefe (cm)', sd.n, sd.reset);
    const sh = numF(cm(a.sashShift != null ? a.sashShift : cmToPts(4)), '0', '15', v => a.sashShift = cmToPts(v), 4); mk('Überlappung Flügel↔Rahmen (cm)', sh.n, sh.reset);
    const sr = numF(cm(a.sashRecess != null ? a.sashRecess : cmToPts(1)), '0', '10', v => a.sashRecess = cmToPts(v), 1); mk('Flügel-Rücksprung (cm)', sr.n, sr.reset);
  }
  const types = isWin ? [['f1', '1-flügelig'], ['f2', '2-flügelig'], ['f2s', '2-fl. Setzholz'], ['fest', 'Fest']] : [['f1', '1-flügelig'], ['f2', '2-flügelig'], ['f1f', '1-fl. + Fixteil'], ['fest', 'Fest']];
  mk('Typ', selF(types, a.winType || 'f1', v => a.winType = v));
  const hinges = isWin ? [['left', 'Band links'], ['right', 'Band rechts'], ['kipp', 'Kipp']] : [['left', 'Band links'], ['right', 'Band rechts']];
  mk('Anschlag', selF(hinges, a.winHinge || 'left', v => a.winHinge = v));
  mk('Material', selF([['holz', 'Holz'], ['metall', 'Metall'], ['kunst', 'Kunststoff']], a.winMat || 'holz', v => a.winMat = v));
  const flip = document.createElement('button'); flip.textContent = '⇄ Anschlag / Öffnungsseite wechseln'; flip.className = 'insp-btn'; flip.onclick = () => { flipOpening(a); upd(); buildFrameFields(host, a, pv); }; host.appendChild(flip);
  const st = document.createElement('div'); st.className = 'insp-note'; st.textContent = 'Band ' + (a.winHinge === 'right' ? 'rechts' : a.winHinge === 'kipp' ? 'Kipp' : 'links') + ' · öffnet ' + ((a.swing || 1) === 1 ? 'innen' : 'aussen'); host.appendChild(st);
}
function openFramePop(pv, a, cx, cy) {   // schwebender Rahmen-/Flügel-Editor (im Plan/Schnitt angeklickt)
  document.querySelectorAll('.rev-pop').forEach(n => n.remove());
  const pop = document.createElement('div'); pop.className = 'rev-pop'; pop.style.cssText = 'position:fixed;z-index:99999;background:#fff;border:1px solid #b8c0ad;border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.2);padding:10px 11px;font:13px system-ui;min-width:220px';
  const head = document.createElement('div'); head.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:7px;font-weight:600'; head.innerHTML = '<span>Rahmen / Flügel</span>'; const xb = document.createElement('button'); xb.textContent = '✕'; xb.style.cssText = 'margin-left:auto;border:none;background:none;cursor:pointer;font-size:15px'; xb.onclick = () => pop.remove(); head.appendChild(xb); pop.appendChild(head);
  const fwrap = document.createElement('div'); pop.appendChild(fwrap); buildFrameFields(fwrap, a, pv);
  document.body.appendChild(pop);
  pop.style.left = Math.max(8, Math.min((cx || 200) + 8, window.innerWidth - pop.offsetWidth - 12)) + 'px';
  pop.style.top = Math.max(8, Math.min((cy || 200) + 8, window.innerHeight - pop.offsetHeight - 12)) + 'px';
  popDrag(pop, head, xb);
  const close = ev => { if (!pop.contains(ev.target)) { pop.remove(); document.removeEventListener('pointerdown', close, true); } };
  setTimeout(() => document.addEventListener('pointerdown', close, true), 0);
}
/* ---------- Schnitt-Werkzeug: live 2D-Vertikalschnitt aus dem Modell ---------- */
function segInt(a, b, c, d) {   // Schnitt zweier Strecken → {pt,t1,t2} oder null
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0]; if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null; return { pt: [a[0] + t * r[0], a[1] + t * r[1]], t1: t, t2: u };
}
function sectionMaxH(a, arr) { let m = wallHeightM; for (const w of arr || []) { if (!layerVisible(w) || !phaseVisible(w)) continue; if (w.type === 'wall') m = Math.max(m, (w.base || 0) + (w.h3d || wallHeightM)); else if (w.type === 'slab') m = Math.max(m, (w.base || 0) + (w.thick || 0.2)); else if (w.type === 'profile' && w.prof && w.prof.length) { let v = 0; for (const q of w.prof) v = Math.max(v, q[1]); m = Math.max(m, (w.elev || 0) + v / 100); } } return m; }   // gemeinsames Höhen-Datum: höchste Wand/Decke/Profil → alle Schnitte gleich hoch (perfekt nebeneinanderlegbar)
function clipSeg(ax, ay, bx, by, x0, y0, x1, y1) {   // Strecke gegen achsenparalleles Rechteck (Liang-Barsky)
  let t0 = 0, t1 = 1; const dx = bx - ax, dy = by - ay;
  const cl = (p, q) => { if (Math.abs(p) < 1e-9) return q >= 0; const r = q / p; if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; } return true; };
  if (cl(-dx, ax - x0) && cl(dx, x1 - ax) && cl(-dy, ay - y0) && cl(dy, y1 - ay) && t1 > t0) return [ax + t0 * dx, ay + t0 * dy, ax + t1 * dx, ay + t1 * dy];
  return null;
}
function sectionBandHatch(out, rx, ry, rw, rh, mat, fallbackHatch) {   // Material-Schraffur in eine Schnitt-Wandschicht (auf das Band geclippt)
  const def = WALL_MATS[mat] || {}, hatch = mat ? def.hatch : fallbackHatch, col = (mat ? def.color : null) || '#1c242c';
  if (!hatch || rw < 1 || rh < 1) return;
  const S = lastHatchScale * 1.15, x0 = rx, y0 = ry, x1 = rx + rw, y1 = ry + rh;
  const add = (ax, ay, bx, by, w) => { const c = clipSeg(ax, ay, bx, by, x0, y0, x1, y1); if (c) out.push({ t: 'line', x1: c[0], y1: c[1], x2: c[2], y2: c[3], stroke: col, w: w || 0.5 }); };
  if (hatch === 'daemm_eps' || hatch === 'daemm_xps') { for (const sg of honeycombSegs(x0, y0, x1, y1, Math.max(7, S * 1.5))) add(sg[0], sg[1], sg[2], sg[3], 0.45); }   // EPS/XPS: Waben (dicht)
  else if (hatch === 'daemm_wolle' || INSUL_TYPES.includes(hatch)) { for (let y = y0 + S / 2; y < y1; y += S) add(x0, y, x1, y); }   // übrige Dämmung: Striche quer zur Wanddicke (im Schnitt horizontal)
  else if (hatch === 'holz' || hatch === 'konter') { for (let x = x0 + S * 0.8; x < x1; x += S * 1.5) add(x, y0, x, y1, 0.6); }   // Holz: senkrechte Bretter
  else if (hatch === 'gips') { /* im Schnitt ruhig lassen */ }
  else if (hatch === 'beton' || hatch === 'cross') { for (let c = -rh; c < rw; c += S) add(x0 + c, y1, x0 + c + rh, y0); for (let c = 0; c < rw + rh; c += S) add(x0 + c, y0, x0 + c - rh, y1); }   // Beton: Kreuz
  else { for (let c = -rh; c < rw; c += S) add(x0 + c, y1, x0 + c + rh, y0); }   // Backstein/Diagonal/Erdreich: 45°
}
let openPosOn = false;   // Fenster-/Tür-Positionsnummern (F1/T1) im Plan
function pDimH(out, y, x1, x2, label, below) { const col = '#1c242c'; out.push({ t: 'line', x1: x1, y1: y, x2: x2, y2: y, stroke: col, w: 0.5 }); for (const x of [x1, x2]) out.push({ t: 'line', x1: x, y1: y - 3, x2: x, y2: y + 3, stroke: col, w: 0.5 }); out.push({ t: 'text', x: (x1 + x2) / 2 - label.length * 2.4, y: y + (below ? 11 : -4), text: label, col, small: true }); }
function pDimV(out, x, y1, y2, label, lx) { const col = '#1c242c'; out.push({ t: 'line', x1: x, y1: y1, x2: x, y2: y2, stroke: col, w: 0.5 }); for (const y of [y1, y2]) out.push({ t: 'line', x1: x - 3, y1: y, x2: x + 3, y2: y, stroke: col, w: 0.5 }); out.push({ t: 'text', x: x + (lx || 5), y: (y1 + y2) / 2 + 3, text: label, col, small: true }); }
function openingSpec(o) {   // KANONISCHE, abgeleitete Fenster-/Tür-Masse – EINE Quelle für Grundriss/Schnitt/Ansicht/3D (verhindert Divergenz)
  const win = o.kind === 'window', sashW = o.sashW || cmToPts(7), sashShift = o.sashShift != null ? o.sashShift : cmToPts(4);
  return {
    win, w: o.w, sill: win ? (o.sill || 0) : 0, head: o.head || (win ? 2.1 : 2.0),
    frameW: o.frameW || cmToPts(win ? 10 : 6), frameD: o.frameD || cmToPts(7), sashW, sashShift,
    frameVis: cmToPts(o.boardVis != null ? o.boardVis : 1.5),         // sichtbarer Blendrahmen in der Ansicht
    sashVis: Math.max(cmToPts(1), sashW - sashShift),                  // sichtbarer Flügel in der Ansicht (≈ sashW − Versatz)
    boardW: win ? cmToPts(o.boardW != null ? o.boardW : 2) : 0,        // Laibungsbrett
    outerLap: o.outerLap != null ? o.outerLap : cmToPts(3), innerReveal: o.innerReveal != null ? o.innerReveal : cmToPts(2)
  };
}
function openingElev(out, X, Yh, opx0, opw, o, H, col, redM, side) {   // Fenster/Tür in Ansicht (side='i' innen → mehr Rahmen, weniger Flügel; 'a' aussen → mehr Flügel)
  const r = redM || 0, sill = (o.kind === 'window' ? (o.sill || 0) + r : 0), head = Math.min(H, o.head || (o.kind === 'window' ? 2.1 : 2.0)) - r;
  if (head - sill < 0.02 || opw < 1) return;
  out.push({ t: 'rect', x: X(opx0), y: Yh(head), w: opw, h: Yh(sill) - Yh(head), fill: '#ffffff', stroke: 'none', sw: 0 });
  if (o.kind === 'window') {
    const sp = openingSpec(o), inside = side === 'i', wm = WIN_MAT[o.winMat || 'holz'], wt = o.winType || 'f1', sc = opw / Math.max(1, o.w), fb = Math.min(opw * 0.16, sp.frameVis * (inside ? 1.7 : 1) * sc), fs = Math.min(opw * 0.22, sp.sashVis * (inside ? 0.5 : 1) * sc), yT = Yh(head), yB = Yh(sill);   // innen: mehr Blendrahmen / weniger Flügel; aussen: mehr Flügel (Anschlag-Logik)
    out.push({ t: 'rect', x: X(opx0), y: yT, w: opw, h: yB - yT, fill: wm.fill, stroke: wm.stroke, sw: 1.4 });   // Blendrahmen (Material)
    const two = wt === 'f2' || wt === 'f2s', panes = two ? 2 : 1, pw = opw / panes;
    for (let pi = 0; pi < panes; pi++) { const px0 = X(opx0) + pi * pw; if (pi > 0) { if (wt === 'f2s') { out.push({ t: 'rect', x: px0 - fb, y: yT, w: 2 * fb, h: yB - yT, fill: wm.fill, stroke: wm.stroke, sw: 1.2 }); } else out.push({ t: 'line', x1: px0, y1: yT, x2: px0, y2: yB, stroke: col, w: 1.2 }); }
      const fest = wt === 'fest', ins = fest ? fb : fb + fs;
      if (!fest && pw - 2 * fb > 1 && (yB - yT) - 2 * fb > 1) out.push({ t: 'rect', x: px0 + fb, y: yT + fb, w: pw - 2 * fb, h: (yB - yT) - 2 * fb, fill: wm.fill, stroke: wm.stroke, sw: 1 });   // Flügelrahmen (eigenes Profil, Face = sashW)
      if (pw - 2 * ins > 1 && (yB - yT) - 2 * ins > 1) out.push({ t: 'rect', x: px0 + ins, y: yT + ins, w: pw - 2 * ins, h: (yB - yT) - 2 * ins, fill: '#c7e2f5', stroke: '#7fa9c6', sw: 0.8 });   // Glas
      if (!fest) {
        const ix0 = px0 + ins, ix1 = px0 + pw - ins, iy0 = yT + ins, iy1 = yB - ins, cmx = (ix0 + ix1) / 2, cmy = (iy0 + iy1) / 2, hinge = o.winHinge || 'left';
        if (hinge === 'kipp') { out.push({ t: 'line', x1: ix0, y1: iy0, x2: cmx, y2: iy1, stroke: col, w: 0.6, dash: '4 3' }); out.push({ t: 'line', x1: ix1, y1: iy0, x2: cmx, y2: iy1, stroke: col, w: 0.6, dash: '4 3' }); }
        else { const apexL = (two ? pi !== 0 : hinge === 'right'), ax = apexL ? ix0 : ix1, bx = apexL ? ix1 : ix0; out.push({ t: 'line', x1: bx, y1: iy0, x2: ax, y2: cmy, stroke: col, w: 0.6, dash: '4 3' }); out.push({ t: 'line', x1: bx, y1: iy1, x2: ax, y2: cmy, stroke: col, w: 0.6, dash: '4 3' }); }   // Apex = Öffnungsseite
      }
    }
    if (o.bank !== false) { const bm = o.bankMat === 'holz' ? { fill: '#e7cfa8', color: '#7a5126' } : o.bankMat === 'beton' ? { fill: '#dadde2', color: '#8a8f96' } : { fill: '#cfd3d8', color: '#565b62' }, pj = cmToPts(4), th = cmToPts(2.5); out.push({ t: 'rect', x: X(opx0) - pj, y: Yh(sill), w: opw + 2 * pj, h: th, fill: bm.fill, stroke: bm.color, sw: 0.9 }); }   // Fensterbank aussen = projizierende Sohlbank
    else out.push({ t: 'line', x1: X(opx0), y1: Yh(sill), x2: X(opx0 + opw), y2: Yh(sill), stroke: col, w: 1.2 });   // innen: nur Sohlbankkante
    if (o.niche) { const nhM = ptsToCm(o.nicheH || cmToPts(28)) / 100, nhP = Math.abs(Yh(nhM) - Yh(0)); out.push({ t: 'rect', x: X(opx0), y: Yh(head) - nhP, w: opw, h: nhP, fill: '#e9e6df', stroke: col, sw: 0.8 }); out.push({ t: 'text', x: X(opx0) + 3, y: Yh(head) - nhP / 2 + 3, text: 'Storen', col, small: true }); }   // Storenkasten (einstellbare Höhe)
  } else {
    const wm = WIN_MAT[o.winMat || 'holz'], wt = o.winType || 'f1', fr = Math.min(opw * 0.42, (o.frameW || cmToPts(6)) * (opw / Math.max(1, o.w))), yT = Yh(head), yB = Yh(sill), hingeRight = o.winHinge === 'right';   // echte Rahmen-/Zargenbreite
    out.push({ t: 'rect', x: X(opx0), y: yT, w: opw, h: yB - yT, fill: wm.fill, stroke: wm.stroke, sw: 1.2 });   // Zarge
    const two = wt === 'f2' || wt === 'f2s' || wt === 'f1f', panes = two ? 2 : 1, pw = opw / panes;
    for (let pi = 0; pi < panes; pi++) { const px0 = X(opx0) + pi * pw; if (pi > 0) out.push({ t: 'line', x1: px0, y1: yT, x2: px0, y2: yB, stroke: col, w: 1 });
      const isGlass = wt === 'fest' || (wt === 'f1f' && pi === (hingeRight ? 0 : 1));
      if (isGlass) out.push({ t: 'rect', x: px0 + fr, y: yT + fr, w: pw - 2 * fr, h: (yB - yT) - 2 * fr, fill: '#c7e2f5', stroke: '#7fa9c6', sw: 0.8 });   // Fixteil verglast
      else { out.push({ t: 'rect', x: px0 + fr, y: yT + fr, w: pw - 2 * fr, h: (yB - yT) - 2 * fr, fill: wm.fill, stroke: wm.stroke, sw: 0.9 });   // Türblatt
        const hx = (two ? (pi === 0 ? px0 + pw - fr * 2 : px0 + fr * 2) : (hingeRight ? px0 + fr * 2 : px0 + pw - fr * 2)); out.push({ t: 'line', x1: hx, y1: (yT + yB) / 2 - 6, x2: hx, y2: (yT + yB) / 2 + 6, stroke: col, w: 1.6 }); }   // Türgriff
    }
  }
}
function sectionCutOpening(out, X, Yh, distPt, appW, o, H, perPt, wall, flip, noDims, mullion, revealOnly) {   // revealOnly = nur Laibung/Schichteinzug zeichnen (Rahmen/Glas/Bank kommen aus Solids)
  const sill = o.kind === 'window' ? (o.sill || 0) : 0, head = Math.min(H, o.head || (o.kind === 'window' ? 2.1 : 2.0));
  if (head - sill < 0.02 || appW < 2) return;
  const hPx = (head - sill) / perPt, cx = X(distPt), cy = Yh((sill + head) / 2), ht2 = appW / 2, hw = hPx / 2;
  const corner = (s, m) => [cx + ht2 * m, cy - hw * s];   // s = vertikal (Kopf oben), m = horizontal (Wanddicke)
  const layered = !simpleMode && wall.layers && wall.layers.length >= 2, dep0 = o.depth == null ? 0.5 : o.depth, dep = flip ? 1 - dep0 : dep0;   // Blickrichtung: Innen/Aussen tauschen
  if (layered) ensureRevealLayers(o, [wall]);   // Schnitt: Standard-Laibung materialisieren → Sturz/Schwelle anklick-/einstellbar
  out.push({ t: 'rect', x: cx - ht2, y: Yh(head), w: appW, h: Yh(sill) - Yh(head), fill: '#ffffff', stroke: 'none', sw: 0 });   // Öffnung ausstanzen
  if (!revealOnly) out.push({ t: 'owhit', x: cx - ht2, y: Math.min(Yh(head), Yh(sill)), w: appW, h: Math.abs(Yh(sill) - Yh(head)), oid: o.id });   // Klickzone: Fenster im Schnitt auswählen
  const sa = { id: o.id, kind: o.kind, x: cx, y: cy, ang: -Math.PI / 2, thick: appW, w: hPx, depth: dep, frameW: o.frameW, frameD: o.frameD, sashW: o.sashW, sashD: o.sashD, sashShift: o.sashShift, sashRecess: o.sashRecess, glassT: o.glassT, winType: (o.winType === 'fest' || o.winType === 'f1f') ? o.winType : 'f1', winMat: o.winMat, winHinge: o.winHinge, revealType: flip ? (o.revealOuter || 'putz') : o.revealType, revealOuter: flip ? o.revealType : o.revealOuter, boardW: o.boardW, boardVis: o.boardVis, boardProtrude: o.boardProtrude, boardMat: o.boardMat, outerLap: o.outerLap, innerReveal: o.innerReveal, revealLining: flip ? o.revealLiningOut : o.revealLining, revealLiningOut: flip ? o.revealLining : o.revealLiningOut, reveals: (() => { if (!o.reveals) return undefined; const sw = e => e ? (flip ? { in: e.out, out: e.in, slope: e.slope, boardVis: e.boardVis, boardVisIn: e.boardVisOut, boardVisOut: e.boardVisIn } : e) : undefined; return { L: sw(o.reveals.B), R: sw(o.reveals.T) }; })(), noSillReveal: (o.kind === 'window' && o.bank !== false), anschlagType: flip ? (o.anschlagType === 'innen' ? 'aussen' : o.anschlagType === 'aussen' ? 'innen' : (o.anschlagType || 'none')) : o.anschlagType, anschlagDepth: o.anschlagDepth, noSwing: true, wallId: 'secw' };   // noSwing: Flügel-Schwenk ist NUR im Grundriss, nicht im Schnitt
  if (layered) {   // Wandaufbau im Sturz/Brüstung mit EXAKTER Laibungs-Verschneidung wie im Grundriss: Wand-Schicht minus Öffnungs-Notch (openingCutPoly), pro Schicht geclippt (genau wie drawLayeredWall/clipBand)
    const wls = flip ? wall.layers.slice().reverse() : wall.layers, tot = (wls || []).reduce((s, l) => s + l.t, 0) || appW;
    const yT0 = Math.min(Yh(head), Yh(sill)), yB0 = Math.max(Yh(head), Yh(sill));
    let cutPoly = null; if (window.polygonClipping) { try { cutPoly = openingCutPoly(sa).map(p => [p[0], p[1]]); } catch (_) { } }
    let acc = 0;
    for (const L of wls) { const m0 = -1 + 2 * acc / tot, m1 = -1 + 2 * (acc + L.t) / tot; acc += L.t; if (L.mat === 'luft') continue;
      const xa = cx + ht2 * m0, xb = cx + ht2 * m1, x0 = Math.min(xa, xb), x1 = Math.max(xa, xb), wd = x1 - x0, mt = WALL_MATS[L.mat] || {}; if (wd < 0.3) continue;
      const strip = [[x0, yT0], [x1, yT0], [x1, yB0], [x0, yB0]];
      let parts = [strip]; if (cutPoly) { try { const r = polygonClipping.difference([strip], [cutPoly]); parts = r.length ? r.map(rg => rg[0]) : []; } catch (_) { parts = [strip]; } }   // Schicht minus Öffnung = Sturz-/Brüstungs-Lappung (H-Form, identisch zum Grundriss)
      for (const poly of parts) { if (!poly || poly.length < 3) continue; out.push({ t: 'poly', pts: poly, fill: mt.fill || '#fff', stroke: mt.color || '#1c242c', sw: 0.5 });
        if (!simpleMode && mt.hatch) { let bx = Infinity, by = Infinity, bX = -Infinity, bY = -Infinity; for (const p of poly) { bx = Math.min(bx, p[0]); by = Math.min(by, p[1]); bX = Math.max(bX, p[0]); bY = Math.max(bY, p[1]); } sectionBandHatch(out, bx, by, bX - bx, bY - by, L.mat, null); } } }
  }
  if (layered) { const sw = { id: 'secw', type: 'wall', layers: flip ? wall.layers.slice().reverse() : wall.layers, x1: cx, y1: cy + hw, x2: cx, y2: cy - hw, thick: appW, hatch: wall.hatch }; for (const st of openingRevealStrips(sa, [sw])) { let rev, oid, gcol; if (st.edge != null && st.li != null) { const realEdge = st.edge === 'L' ? 'B' : (st.edge === 'R' ? 'T' : st.edge), realSide = flip ? (st.side === 'i' ? 'o' : 'i') : st.side; rev = realEdge + ':' + realSide + ':' + st.li; oid = o.id; gcol = revealGroupColor(o, realEdge, realSide === 'i' ? 'in' : 'out'); }   // Rück-Mapping + Gruppenfarbe (konsistent zum Grundriss)
    out.push({ t: 'poly', pts: st.poly, fill: st.fill, stroke: st.seam == null ? st.stroke : 'none', sw: 0.7, rev, oid, gcol }); if (st.seam != null) for (const [u, v] of revealEdgeSegs(st.poly, st.seam)) out.push({ t: 'line', x1: u[0], y1: u[1], x2: v[0], y2: v[1], stroke: st.stroke, w: 0.7 }); if (st.hatch) for (const [u, v] of st.hatch) out.push({ t: 'line', x1: u[0], y1: u[1], x2: v[0], y2: v[1], stroke: st.stroke, w: 0.6, hov: 1 }); } }   // Laibungs-Lining-Schraffur: nur beim Drüberfahren über den Schnitt
  if (!revealOnly && o.kind === 'window') {
    const P = openingParts(sa, layered), wmM = WIN_MAT[o.winMat || 'holz'];
    for (const f of (P.fills || [])) { const isGlass = f.fill === '#c7e2f5'; out.push({ t: 'poly', pts: f.poly, fill: (mullion && isGlass) ? wmM.fill : f.fill, stroke: (mullion && isGlass) ? wmM.stroke : f.stroke, sw: 1, frame: f.role === 'frame' ? 1 : undefined, oid: f.role === 'frame' ? o.id : undefined }); }   // Mittelstoss-Schnitt: Glas → Rahmen-/Setzholzmaterial; Rahmen anklickbar
    if (mullion) { out.push({ t: 'line', x1: cx, y1: Yh(sill), x2: cx, y2: Yh(head), stroke: '#1c242c', w: 0.7, dash: '4 3' }); out.push({ t: 'text', x: cx + 3, y: cy, text: 'Setzholz', col: '#1c242c', small: true }); }   // Mittelstoss markiert
    for (const [u, v] of P.lines) out.push({ t: 'line', x1: u[0], y1: u[1], x2: v[0], y2: v[1], stroke: '#1c242c', w: 1.2 });
    for (const [u, v] of (P.bold || [])) out.push({ t: 'line', x1: u[0], y1: u[1], x2: v[0], y2: v[1], stroke: '#1c242c', w: 2.4 });
    if (o.niche) { const nH = o.nicheH || cmToPts(28), nD = o.nicheD || cmToPts(13), nx0 = flip ? cx + ht2 - nD : cx - ht2, ny0 = (cy - hw) - nH; out.push({ t: 'rect', x: nx0, y: ny0, w: nD, h: nH, fill: '#e9e6df', stroke: '#1c242c', sw: 0.8 }); out.push({ t: 'text', x: nx0 + 2, y: ny0 + nH / 2, text: 'Storen', col: '#1c242c', small: true }); }   // Storennische 13×28 hinten, über dem Sturz
  } else if (!revealOnly && o.kind === 'door') {
    const wm = WIN_MAT[o.winMat || 'holz'], md = Math.max(-1, Math.min(1, sa.depth * 2 - 1)), frameD = o.frameD || cmToPts(7), frameW = o.frameW || cmToPts(6);
    const fdh = Math.min(0.49, frameD / appW), leafW = Math.min(0.4, cmToPts(4) / appW), fwS = Math.min(0.4, frameW / hPx);
    out.push({ t: 'poly', pts: [corner(-1, md - leafW), corner(1 - fwS, md - leafW), corner(1 - fwS, md + leafW), corner(-1, md + leafW)], fill: wm.fill, stroke: wm.stroke, sw: 1 });   // Türblatt (vertikal, bei Einbautiefe)
    out.push({ t: 'poly', pts: [corner(1 - fwS, md - fdh), corner(1, md - fdh), corner(1, md + fdh), corner(1 - fwS, md + fdh)], fill: wm.fill, stroke: wm.stroke, sw: 1 });   // Sturz-Rahmen
    { const thS = Math.min(0.5, 0.06 / Math.max(0.1, head - sill)); out.push({ t: 'poly', pts: [corner(-1, md - fdh), corner(-1 + thS, md - fdh), corner(-1 + thS, md + fdh), corner(-1, md + fdh)], fill: wm.fill, stroke: wm.stroke, sw: 1 }); }   // Türschwelle / Bodenschiene unten
  }
  if (!revealOnly && o.kind === 'window' && o.bank !== false) {   // Fensterbank aussen: Metallblech am Sims, geneigt + Überstand + Tropfkante
    const bm = WALL_MATS[o.bankMat] || { fill: '#cfd3d8', color: '#565b62' }, over = cmToPts(o.bankOver != null ? o.bankOver : 4), bt = cmToPts(2), drop = cmToPts(2.5), md0 = Math.max(-1, Math.min(1, (o.depth == null ? 0.5 : o.depth) * 2 - 1));
    const xIn = cx + ht2 * md0, xOut = cx + ht2 + over, yT = Yh(sill);
    out.push({ t: 'poly', pts: [[xIn, yT], [xOut, yT + drop], [xOut, yT + drop + bt], [xIn, yT + bt]], fill: bm.fill, stroke: bm.color, sw: 0.9 });   // Bankblech
    out.push({ t: 'line', x1: xOut, y1: yT + drop + bt, x2: xOut, y2: yT + drop + bt + cmToPts(2), stroke: bm.color, w: 1 });   // Tropfkante
  }
  if (!revealOnly) { out.push({ t: 'shandle', x: cx, y: Yh(head), key: 'sh:op:' + o.id + ':head' });   // Sturz-Höhe ziehen
    if (o.kind === 'window') out.push({ t: 'shandle', x: cx, y: Yh(sill), key: 'sh:op:' + o.id + ':sill' }); }   // Brüstungs-Höhe ziehen
}
function sectionPrimitives(a, arr) {
  const out = [], col = '#1c242c';
  const p1 = [a.cx1, a.cy1], p2 = [a.cx2, a.cy2], cd = [p2[0] - p1[0], p2[1] - p1[1]], cl = Math.hypot(cd[0], cd[1]) || 1, cux = cd[0] / cl, cuy = cd[1] / cl, nx = -cuy, ny = cux, lbl = a.label || 'A';
  const vdir = a.flip ? -1 : 1;   // Blickrichtung
  if (!a.noPlanLine) {   // Plan-Schnittlinie + Pfeile (im Detail-Editor weggelassen)
    out.push({ t: 'line', x1: a.cx1, y1: a.cy1, x2: a.cx2, y2: a.cy2, stroke: col, w: 1.2, dash: '10 4 2 4' });   // Schnittlinie im Plan
    for (const e of [[a.cx1, a.cy1], [a.cx2, a.cy2]]) { const tk = 8, ax = nx * vdir, ay = ny * vdir; out.push({ t: 'line', x1: e[0] - ax * tk, y1: e[1] - ay * tk, x2: e[0] + ax * tk, y2: e[1] + ay * tk, stroke: col, w: 1.4 }); out.push({ t: 'arrow', x: e[0] + ax * tk, y: e[1] + ay * tk, dx: ax, dy: ay, col }); out.push({ t: 'text', x: e[0] - ax * 16, y: e[1] - ay * 16, text: lbl, col }); }
  }
  if (!docScale) { out.push({ t: 'text', x: a.ox, y: a.oy, text: '⟶ Massstab setzen, dann erscheint der Schnitt', col }); return out; }
  const perPt = docScale.perPt, ox = a.ox, oy = a.oy, X = d => ox + d, Yh = h => oy - h / perPt, fp = d => a.flip ? cl - d : d;   // fp() spiegelt nur die Position (X bleibt normal → Rechtecke verrutschen nicht)
  const hits = [];
  for (const w of arr) { if (w.type !== 'wall' || !layerVisible(w) || !phaseVisible(w)) continue; const ix = segInt(p1, p2, [w.x1, w.y1], [w.x2, w.y2]); if (!ix) continue; const dist = fp((ix.pt[0] - p1[0]) * cux + (ix.pt[1] - p1[1]) * cuy), wdx = w.x2 - w.x1, wdy = w.y2 - w.y1, wl = Math.hypot(wdx, wdy) || 1, sinA = Math.max(0.25, Math.abs((cux * wdy - cuy * wdx) / wl)), T = w.thick || wallThickPts(); hits.push({ w, dist, appW: T / sinA, tp: ix.t2, wl, T }); }
  out.push({ t: 'line', x1: X(-14), y1: Yh(0), x2: X(cl + 14), y2: Yh(0), stroke: col, w: 1.8 });   // Bodenlinie
  for (const sl of arr) {   // Decken/Platten ZUERST (hinter den Wänden) → Decke läuft sauber an die Wand an, statt sie zu überdecken
    if (sl.type !== 'slab' || !sl.pts || sl.pts.length < 3 || !layerVisible(sl) || !phaseVisible(sl)) continue;
    const ds = [];
    for (let i = 0; i < sl.pts.length; i++) { const q1 = sl.pts[i], q2 = sl.pts[(i + 1) % sl.pts.length], ix = segInt(p1, p2, q1, q2); if (ix) ds.push((ix.pt[0] - p1[0]) * cux + (ix.pt[1] - p1[1]) * cuy); }
    if (pointInPoly(p1, sl.pts)) ds.push(0); if (pointInPoly(p2, sl.pts)) ds.push(cl);
    ds.sort((u, v) => u - v);
    const base = sl.base || 0, thick = sl.thick || 0.2, bands = slabLayerBands(sl);
    for (let i = 0; i + 1 < ds.length; i++) { const dm = (ds[i] + ds[i + 1]) / 2, mid = [p1[0] + cux * dm, p1[1] + cuy * dm]; if (!pointInPoly(mid, sl.pts)) continue; const dA = fp(ds[i]), dB = fp(ds[i + 1]), xa = X(Math.min(dA, dB)), xb = X(Math.max(dA, dB));
      if (bands) for (const b of bands) { const m = WALL_MATS[b.mat] || {}, yT = Yh(base + b.y1), hh = Yh(base + b.y0) - Yh(base + b.y1), ins = cmToPts((b.inset || 0) * 100), xaB = xa + ins, xbB = xb - ins; if (xbB - xaB < 0.5) continue; out.push({ t: 'rect', x: xaB, y: yT, w: xbB - xaB, h: hh, fill: m.fill || '#fff', stroke: m.color || col, sw: 0.6 }); if (!simpleMode && m.hatch) sectionBandHatch(out, xaB, yT, xbB - xaB, hh, b.mat, null); }
      else out.push({ t: 'rect', x: xa, y: Yh(base + thick), w: xb - xa, h: Yh(base) - Yh(base + thick), fill: '#dadde2', stroke: '#8a8f96', sw: 0.7 });
      out.push({ t: 'shandle', x: (xa + xb) / 2, y: Yh(base + thick), key: 'sh:sb:' + sl.id });   // Decken-Höhe (Unterkante) im Schnitt ziehen
    }
  }
  const elevOps = [];   // in Ansicht gezeichnete Öffnungen → kommen in die Höhen-Maskette (Brüstung/Sturz)
  const cutOps = new Set();   // Öffnungen, die der (auch schräge) Schnitt KREUZT → werden als echter Schnitt gezeichnet, NICHT zusätzlich als Ansicht
  for (const h of hits) for (const o of arr) if (o.type === 'opening' && o.wallId === h.w.id && Math.abs(o.t - h.tp) < ((o.w / 2) / h.wl)) cutOps.add(o.id);
  for (const w of arr) {   // Ansicht ZUERST (hinten): jede Wand in Blickrichtung als Fassade – auch schräg geschnittene (Poché kommt danach darüber)
    if (w.type !== 'wall' || !layerVisible(w) || !phaseVisible(w)) continue;
    const wdx = w.x2 - w.x1, wdy = w.y2 - w.y1, wl = Math.hypot(wdx, wdy) || 1, along = Math.abs((wdx * cux + wdy * cuy) / wl);
    if (along < 0.3) continue;   // sehr steil gekreuzte Wände → nur Poché (Fassade vernachlässigbar schmal)
    const wOff = ((w.x1 + w.x2) / 2 - p1[0]) * nx + ((w.y1 + w.y2) / 2 - p1[1]) * ny;   // senkrechter Abstand der Wandmitte zur Schnittebene
    if (wOff * vdir < -cmToPts(3)) continue;   // Wand liegt HINTER der Blickrichtung (Schnitt schaut weg) → nicht sichtbar
    const Hw = w.h3d || wallHeightM, base = w.base || 0, Yb = z => Yh(base + z);   // base = Wand-Basishöhe (OG-Wand steht auf der Decke)
    const d1 = fp((w.x1 - p1[0]) * cux + (w.y1 - p1[1]) * cuy), d2 = fp((w.x2 - p1[0]) * cux + (w.y2 - p1[1]) * cuy);
    const da = Math.max(0, Math.min(d1, d2)), db = Math.min(cl, Math.max(d1, d2));
    if (db - da > 1) {   // Wand in Ansicht SCHICHTWEISE (tiefensortiert): jede Schicht mit top/bot/Sockelzone → Sichtkanten beim Schicht-Unterbruch (Verputz runtergezogen etc.)
      const wl2 = w.layers && w.layers.length ? w.layers : null, fSide = (wOff * vdir >= 0) ? 'a' : 'i', xa = X(da), xw = X(db) - X(da);
      const fRect = (mat, yT, yB) => { const m = WALL_MATS[mat] || {}; if (yB - yT <= 0.3) return; out.push({ t: 'rect', x: xa, y: yT, w: xw, h: yB - yT, fill: m.fill || '#f0efea', stroke: m.color || col, sw: 0.6 }); if (!simpleMode) sectionBandHatch(out, xa, yT, xw, yB - yT, mat, null); };
      if (wl2) { const idxs = fSide === 'i' ? [...wl2.keys()].reverse() : [...wl2.keys()];   // betrachtete Seite zuletzt (vorne/oben)
        for (const i of idxs) { const L = wl2[i]; if (L.mat === 'luft') continue; const top = Hw + (L.top || 0), bot = 0 - (L.bot || 0);
          if (L.lowMat && L.lowH > 0) { fRect(L.lowMat, Yb(L.lowH), Yb(bot)); fRect(L.mat, Yb(top), Yb(L.lowH)); } else fRect(L.mat, Yb(top), Yb(bot)); }
      } else { const m = { fill: (w.fill && w.fill !== 'none') ? w.fill : '#f0efea', color: w.color || col }; out.push({ t: 'rect', x: xa, y: Yb(Hw), w: xw, h: Yb(0) - Yb(Hw), fill: m.fill, stroke: m.color, sw: 0.6 }); }
    }
    for (const o of arr) { if (o.type !== 'opening' || o.wallId !== w.id || cutOps.has(o.id)) continue; const ocx = w.x1 + wdx * o.t, ocy = w.y1 + wdy * o.t, od = fp((ocx - p1[0]) * cux + (ocy - p1[1]) * cuy); if (od < -10 || od > cl + 10) continue;
      const eSide = (wOff * vdir >= 0 ? 'a' : 'i'), ring = openingRevealRing(o, eSide, w), headF = Math.min(Hw, o.head || (o.kind === 'window' ? 2.1 : 2.0)), sillF = (o.kind === 'window' ? (o.sill || 0) : 0);   // Ansicht: nur die SICHTBARE Deckschicht (deckt die Lappung, verdeckt dahinterliegende Schichten)
      if (ring.mat) { const mt = LINING_MAT[ring.mat] || WALL_MATS[ring.mat] || {}, xa = X(od - (o.w / 2) * along), xb = X(od + (o.w / 2) * along); out.push({ t: 'rect', x: Math.min(xa, xb), y: Yb(headF), w: Math.abs(xb - xa), h: Yb(sillF) - Yb(headF), fill: mt.fill || '#eee', stroke: (mt.stroke || mt.color) || col, sw: 0.6 }); }
      try { openingElevDraw(out, Object.assign({}, o, { w: Math.max(4, o.w - 2 * ring.w) }), s => X(od + s * along), Yb); } catch (_) { }   // Fenster um die Lappung eingezogen (1cm Rahmen sichtbar)
      if (!a.noDims && !elevOps.includes(o)) elevOps.push(o);   // Ansicht-Öffnung in die Höhen-Maskette aufnehmen (statt eigener schräger Höhenmasse)
    }
  }
  for (const h of hits) {
    const w = h.w, H = w.h3d || wallHeightM, x0 = h.dist - h.appW / 2, base = w.base || 0, Yb = z => Yh(base + z);   // base = Wand-Basishöhe (OG-Wand auf der Decke)
    const layers0 = (w.layers && w.layers.length) ? w.layers : [{ mat: null, t: h.T }];
    const _wp = wallPoly(w, arr), _inM = [(_wp[2][0] + _wp[3][0]) / 2, (_wp[2][1] + _wp[3][1]) / 2], _outM = [(_wp[0][0] + _wp[1][0]) / 2, (_wp[0][1] + _wp[1][1]) / 2], _innerFirst = fp((_inM[0] - p1[0]) * cux + (_inM[1] - p1[1]) * cuy) <= fp((_outM[0] - p1[0]) * cux + (_outM[1] - p1[1]) * cuy);   // Schicht-Reihenfolge aus echter Wand-Geometrie: trifft der Schnitt die Innenseite zuerst? → korrekt zur Decke/zum Raum (statt a.flip)
    const layers = _innerFirst ? layers0 : layers0.slice().reverse(), totalT = layers.reduce((s, l) => s + l.t, 0) || h.T;
    if (USE_SOLID && w.layers && w.layers.length) {   // KANONISCH (Standard): Wand-Poché aus elementSolids + slicePlane – inkl. Lattung + Schicht-Ziehgriffe (Parität zur Alt-Logik)
      const byLi = {};
      for (const c of slicePlane(elementSolids(w, arr), { kind: 'v', p1, p2 })) { const xa = X(fp(c.d0)), xb = X(fp(c.d1)), x = Math.min(xa, xb), wd = Math.abs(xb - xa), yT = Yb(c.z1), yB = Yb(c.z0); if (wd < 0.2 || yB - yT < 0.1) continue;
        const lm = WALL_MATS[c.mat] || {}, m = c.mat ? lm : { fill: (w.fill && w.fill !== 'none') ? w.fill : '#ffffff', color: w.color || col };
        if (lm.boards) { const lay = (w.layers || [])[c.li] || {}, bwp = cmToPts(lay.boardW || 4), gpp = cmToPts(lay.boardGap != null ? lay.boardGap : 2), step = Math.max(2, bwp + gpp); for (let yy = yT; yy < yB - 0.5; yy += step) { const y2 = Math.min(yB, yy + bwp); out.push({ t: 'rect', x, y: yy, w: wd, h: y2 - yy, fill: lm.fill || '#e7cfa8', stroke: lm.color || '#7a5126', sw: 0.6 }); } }   // Lattung gestapelt
        else { out.push({ t: 'rect', x, y: yT, w: wd, h: yB - yT, fill: m.fill || '#ffffff', stroke: m.color || col, sw: 0.6 }); if (!simpleMode) sectionBandHatch(out, x, yT, wd, yB - yT, c.mat, (w.hatch && w.hatch.type)); }
        const g = byLi[c.li] || (byLi[c.li] = { x: x + wd / 2, t: yT, b: yB }); g.t = Math.min(g.t, yT); g.b = Math.max(g.b, yB); g.x = x + wd / 2;
      }
      for (const li in byLi) { const g = byLi[li]; out.push({ t: 'lhandle', x: g.x, y: g.t, wallId: w.id, li: +li, edge: 'top' }); out.push({ t: 'lhandle', x: g.x, y: g.b, wallId: w.id, li: +li, edge: 'bot' }); }   // Schicht-Ziehgriffe (Ober-/Unterkante)
    } else {
    let cx = x0;
    for (let li = 0; li < layers.length; li++) { const L = layers[li], lw = (L.t / totalT) * h.appW, bx = X(cx), yTopF = Yb(H + (L.top || 0)), yBotF = Yb(0 - (L.bot || 0));   // L.top/L.bot = eigene Über-/Unterlänge; L.lowMat/L.lowH = Sockelzone
      const drawSeg = (mat, yT, yB) => { if (yB - yT < 0.1) return; const m = mat ? (WALL_MATS[mat] || {}) : { fill: (w.fill && w.fill !== 'none') ? w.fill : '#ffffff', color: w.color || col }; out.push({ t: 'rect', x: bx, y: yT, w: lw, h: yB - yT, fill: m.fill || '#ffffff', stroke: m.color || col, sw: 0.6, wid: w.id }); if (!simpleMode) sectionBandHatch(out, bx, yT, lw, yB - yT, mat, (w.hatch && w.hatch.type)); };
      const lm = WALL_MATS[L.mat] || {};
      if (lm.boards) { const lay = (w.layers || [])[_innerFirst ? li : (layers.length - 1 - li)] || {}, bwp = cmToPts(lay.boardW || 4), gpp = cmToPts(lay.boardGap != null ? lay.boardGap : 2), step = Math.max(2, bwp + gpp); for (let yy = yTopF; yy < yBotF - 0.5; yy += step) { const y2 = Math.min(yBotF, yy + bwp); out.push({ t: 'rect', x: bx, y: yy, w: lw, h: y2 - yy, fill: lm.fill || '#e7cfa8', stroke: lm.color || '#7a5126', sw: 0.6 }); } }   // Latten gestapelt (Lücken zeigen Windpapier dahinter)
      else if (L.lowMat && L.lowH > 0) { const yS = Yb(L.lowH); drawSeg(L.lowMat, yS, yBotF); drawSeg(L.mat, yTopF, yS); } else drawSeg(L.mat, yTopF, yBotF);
      if (w.layers && w.layers.length) { const oi = _innerFirst ? li : (layers.length - 1 - li); out.push({ t: 'lhandle', x: bx + lw / 2, y: yTopF, wallId: w.id, li: oi, edge: 'top' }); out.push({ t: 'lhandle', x: bx + lw / 2, y: yBotF, wallId: w.id, li: oi, edge: 'bot' }); }   // Schicht-Ziehgriffe (Ober-/Unterkante) → im Schnitt verlängern/kürzen
      cx += lw; }
    }
    const ops = arr.filter(o => o.type === 'opening' && o.wallId === w.id && Math.abs(o.t - h.tp) < ((o.w / 2) / h.wl));
    for (const o of ops) {
      if (USE_SOLID) {   // STUFE 3d/3f: Öffnung im Schnitt = Laibung (bewährt, revealOnly) + Fenster/Bank aus kanonischem sliceOpeningV
        sectionCutOpening(out, X, Yb, h.dist, h.appW, o, H, perPt, w, a.flip, a.noDims, a.mullion, true);   // Laibung/Schichteinzug + Ausstanzen
        const cx = X(h.dist), sCut = (a.flip ? -1 : 1) * (h.tp - o.t) * h.wl;
        for (const r of sliceOpeningV(Object.assign({}, o, { thick: h.appW }), sCut)) { const x0 = cx + r.m0 * (h.appW / 2), x1 = cx + r.m1 * (h.appW / 2), st = openingPartStyle(r.role, o, r.mat); out.push({ t: 'rect', x: Math.min(x0, x1), y: Yb(r.z1), w: Math.abs(x1 - x0), h: Yb(r.z0) - Yb(r.z1), fill: st.fill, stroke: st.stroke, sw: 1 }); }
      } else sectionCutOpening(out, X, Yb, h.dist, h.appW, o, H, perPt, w, a.flip, a.noDims, a.mullion);   // quer geschnittene Öffnung = gedrehtes Grundriss-Profil (a.flip = Blickrichtung)
    }
    out.push({ t: 'line', x1: X(x0), y1: Yb(H), x2: X(x0 + h.appW), y2: Yb(H), stroke: col, w: 1.2 });
    out.push({ t: 'shandle', x: X(h.dist), y: Yb(H), key: 'sh:wh:' + w.id });   // Wandhöhe im Schnitt ziehen
  }
  { const INSUL = ['eps', 'glaswolle', 'xps', 'daemm_eps', 'daemm_wolle', 'daemm_xps', 'daemm_holz', 'luft', 'konter'];   // Automatische Decke↔Wand-Verschneidung: die Decke läuft bis zur Tragschicht (vor der Dämmung/Verkleidung), die durchgehend bleibt
    for (const sl of arr) {
      if (sl.type !== 'slab' || !sl.layers || !sl.layers.length || !sl.pts || !layerVisible(sl) || !phaseVisible(sl)) continue;
      const ds = [];
      for (let i = 0; i < sl.pts.length; i++) { const q1 = sl.pts[i], q2 = sl.pts[(i + 1) % sl.pts.length], ix = segInt(p1, p2, q1, q2); if (ix) ds.push((ix.pt[0] - p1[0]) * cux + (ix.pt[1] - p1[1]) * cuy); }
      if (pointInPoly(p1, sl.pts)) ds.push(0); if (pointInPoly(p2, sl.pts)) ds.push(cl); ds.sort((u, v) => u - v);
      const ivs = []; for (let i = 0; i + 1 < ds.length; i++) { const dm = (ds[i] + ds[i + 1]) / 2, mid = [p1[0] + cux * dm, p1[1] + cuy * dm]; if (pointInPoly(mid, sl.pts)) ivs.push([fp(ds[i]), fp(ds[i + 1])]); }
      if (!ivs.length) continue;
      const sb0 = sl.base || 0, stk = sl.thick || 0.2, bands = slabLayerBands(sl) || [];
      let structIdx = 0, maxT = -1; bands.forEach((b, ix) => { if (b.t > maxT) { maxT = b.t; structIdx = ix; } }); const structTop = bands.length ? bands[structIdx].y1 : stk;   // Tragschicht = dickste Decken-Schicht (Beton/Holz-Box); Oberkante davon
      for (const h of hits) {
        const w = h.w, wb = w.base || 0, wh = w.h3d || wallHeightM;
        if (sb0 >= wb + wh - 0.005 || sb0 + stk <= wb + 0.005 || !(w.layers && w.layers.length)) continue;   // keine Höhen-Überlappung Wand/Decke
        const wd0 = h.dist - h.appW / 2, wd1 = h.dist + h.appW / 2;
        let touches = false, roomHigh = false;
        for (const iv of ivs) { const lo = Math.min(iv[0], iv[1]), hi = Math.max(iv[0], iv[1]); if (hi > wd0 - 3 && lo < wd1 + 3) { touches = true; roomHigh = ((lo + hi) / 2) >= h.dist; } }
        if (!touches) continue;
        const _wp = wallPoly(w, arr), _inM = [(_wp[2][0] + _wp[3][0]) / 2, (_wp[2][1] + _wp[3][1]) / 2], _outM = [(_wp[0][0] + _wp[1][0]) / 2, (_wp[0][1] + _wp[1][1]) / 2], _innerFirst = fp((_inM[0] - p1[0]) * cux + (_inM[1] - p1[1]) * cuy) <= fp((_outM[0] - p1[0]) * cux + (_outM[1] - p1[1]) * cuy);
        const layers = _innerFirst ? w.layers : w.layers.slice().reverse(), totalT = layers.reduce((s, l) => s + l.t, 0) || h.T;
        let cum = 0; const bnd = [wd0]; for (const L of layers) { cum += L.t; bnd.push(wd0 + (cum / totalT) * h.appW); }
        let structFace;   // Tragschicht-Aussenkante (= Innenkante der ersten Dämm-/Luftschicht von innen)
        if (roomHigh) { structFace = wd0; for (let i = layers.length - 1; i >= 0; i--) { if (INSUL.includes(layers[i].mat)) { structFace = bnd[i + 1]; break; } } }
        else { structFace = wd1; for (let i = 0; i < layers.length; i++) { if (INSUL.includes(layers[i].mat)) { structFace = bnd[i]; break; } } }
        const innerFace = roomHigh ? wd1 : wd0, pxa = X(Math.min(innerFace, structFace)), pxb = X(Math.max(innerFace, structFace));
        if (Math.abs(pxb - pxa) < 0.5) continue;
        for (const bd of bands) { if (bd.y0 >= structTop - 1e-6) continue;   // schwimmender Bodenaufbau ÜBER der Tragschicht springt an der Wand zurück (nicht einbinden); nur Tragschicht + Untersicht (Putz/Gips) binden ein
          const m = WALL_MATS[bd.mat] || {}, yT = Yh(sb0 + bd.y1), yB = Yh(sb0 + bd.y0); if (yB - yT < 0.3) continue; out.push({ t: 'rect', x: Math.min(pxa, pxb), y: yT, w: Math.abs(pxb - pxa), h: yB - yT, fill: m.fill || '#dadde2', stroke: m.color || col, sw: 0.6 }); if (!simpleMode && m.hatch) sectionBandHatch(out, Math.min(pxa, pxb), yT, Math.abs(pxb - pxa), yB - yT, bd.mat, null); }
      }
    }
  }
  for (const pr of arr) {   // Profile: wo die Schnittlinie den Pfad kreuzt → echter Querschnitt an seiner Höhe
    if (pr.type !== 'profile' || !pr.path || pr.path.length < 2 || !pr.prof || pr.prof.length < 3 || !layerVisible(pr) || !phaseVisible(pr)) continue;
    const seg = pr.closed && pr.path.length >= 3 ? pr.path.concat([pr.path[0]]) : pr.path, base = pr.elev || 0;
    for (let i = 0; i < seg.length - 1; i++) { const ix = segInt(p1, p2, seg[i], seg[i + 1]); if (!ix) continue; const d = fp((ix.pt[0] - p1[0]) * cux + (ix.pt[1] - p1[1]) * cuy), pts = pr.prof.map(q => [X(d) + cmToPts(q[0]), Yh(base + q[1] / 100)]); out.push({ t: 'poly', pts, fill: pr.color || '#7a8392', stroke: '#1c242c', sw: 0.6 }); }
  }
  if (!a.noDims) {   // Höhen-Masketten wie im Grundriss: zwei Ketten (links innen=Rohbau „R", rechts aussen=Fertig/Licht „F"), wandabhängig, gleicher Abstand, geschnittene Fenster/Türen mitgenommen
    const Htop = sectionMaxH(a, arr), DOFF = Math.max(8, Math.min(80, cmToPts(wallDimOffCm))), over = 4;   // Abstand zur Wand exakt wie im Grundriss (wallDimOffCm), ohne künstlichen Mindestabstand
    const dimOps = [];   // alle Öffnungen im Schnitt (geschnitten + Ansicht) → Höhen-Stationen
    for (const h of hits) for (const o of arr.filter(o => o.type === 'opening' && o.wallId === h.w.id && Math.abs(o.t - h.tp) < ((o.w / 2) / h.wl))) if (!dimOps.includes(o)) dimOps.push(o);
    for (const o of elevOps) if (!dimOps.includes(o)) dimOps.push(o);
    const dimChain = (xLine, side, fertig, tag) => {   // side<0 links (Text links), side>0 rechts; fertig = Licht (Laibung abgezogen)
      const hSet = new Set([0, Htop]);
      for (const o of dimOps) { const sill = o.kind === 'window' ? (o.sill || 0) : 0, head = Math.min(Htop, o.head || (o.kind === 'window' ? 2.1 : 2.0)), insM = fertig ? ptsToCm(Math.max(0, (o.frameW || cmToPts(10)) - cmToPts(o.boardVis != null ? o.boardVis : 1))) / 100 : 0; hSet.add(Math.max(0, sill + insM)); hSet.add(Math.max(sill + insM + 0.02, head - insM)); }
      const hs = [...new Set([...hSet].map(v => Math.round(v * 1000) / 1000))].sort((p, q) => p - q), xFace = side < 0 ? X(0) : X(cl);
      out.push({ t: 'line', x1: xLine, y1: Yh(0) + side * 0, x2: xLine, y2: Yh(Htop), w: 0.9 });   // Masslinie
      out.push({ t: 'text', x: xLine + side * 9, y: Yh(Htop) - 7, text: tag, col, small: true });   // Kettenkennung F/R
      for (const s of hs) { out.push({ t: 'line', x1: xFace, y1: Yh(s), x2: xLine + side * over, y2: Yh(s), w: 0.55 }); const px = xLine; out.push({ t: 'line', x1: px - 3.5, y1: Yh(s) + 3.5, x2: px + 3.5, y2: Yh(s) - 3.5, w: 1.1 }); }   // Masshilfslinie (bis Wandfläche) + Tick
      for (let i = 0; i < hs.length - 1; i++) { const seg = hs[i + 1] - hs[i]; if (seg < 0.02) continue; out.push({ t: 'text', x: xLine - side * 7, y: (Yh(hs[i]) + Yh(hs[i + 1])) / 2, text: fmtLen(seg / perPt), col, size: 11, ang: -90, mid: true }); }   // Segment-Mass mittig auf/an der Masslinie (gedreht, von rechts lesbar)
    };
    dimChain(X(-DOFF), -1, false, 'R');         // innen (links) = Rohbau (Bezug Mauerwerk)
    dimChain(X(cl + DOFF), 1, true, 'F');       // aussen (rechts) = Fertig/Licht (Bezug Dämmung)
    { const stxt = 'Schnitt ' + lbl + '–' + lbl; out.push({ t: 'text', x: X(cl / 2) - stxt.length * 5.2, y: Yh(-0.22) + 30, text: stxt, col, size: 21 }); }   // grössere Schnitt-Beschriftung
  }
  return out;
}
function sectionBBox(a, arr) { if (!docScale) return { x: a.ox - 6, y: a.oy - 16, w: 180, h: 30 }; const perPt = docScale.perPt, cl = Math.hypot(a.cx2 - a.cx1, a.cy2 - a.cy1) || 1, mh = sectionMaxH(a, arr) / perPt, dOff = Math.max(8, Math.min(80, cmToPts(wallDimOffCm))) + 24; return { x: a.ox - dOff, y: a.oy - mh - 12, w: cl + 2 * dOff, h: mh + 40 }; }   // breiter: zwei Höhen-Masketten (links/rechts), Abstand = wallDimOffCm
const _revSig = o => { const f = l => Array.isArray(l) ? l.map(x => x.mat + (x.t || 0) + (x.gap || 0) + (x.prio || '') + (x.len != null ? 'L' + x.len : '') + (x.over || 0)).join('') : ''; let r = f(o.revealLining) + '|' + f(o.revealLiningOut); if (o.reveals) for (const e of ['L', 'R', 'T', 'B']) { const ed = o.reveals[e]; if (ed) r += e + f(ed.in) + f(ed.out) + (ed.slope || 0) + (ed.boardVis != null ? 'b' + ed.boardVis : '') + (ed.boardVisIn != null ? 'i' + ed.boardVisIn : '') + (ed.boardVisOut != null ? 'o' + ed.boardVisOut : ''); } return r; };
function sectionSig(a, arr) {   // billige Inhalts-Signatur: alles was den Schnitt/die Ansicht beeinflusst → nur bei Änderung neu rechnen
  const p = docScale ? docScale.perPt : 0;
  let s = 'S' + a.cx1.toFixed(1) + ',' + a.cy1.toFixed(1) + ',' + a.cx2.toFixed(1) + ',' + a.cy2.toFixed(1) + ',' + a.ox + ',' + a.oy + ',' + (a.flip ? 1 : 0) + ',' + (a.mullion ? 1 : 0) + ',' + (a.noDims ? 1 : 0) + ',' + p + ',' + (USE_SOLID ? 1 : 0) + ',' + (simpleMode ? 1 : 0) + ',' + wallDimOffCm + ',' + (sel && sel.id === a.id ? 1 : 0) + ',' + (sel && sel.id === a.id ? (secSelWall || 0) : 0) + '|';
  for (const o of arr) {
    if (!layerVisible(o) || !phaseVisible(o)) continue; const t = o.type;
    if (t === 'wall') s += 'W' + o.id + ':' + o.x1.toFixed(1) + ',' + o.y1.toFixed(1) + ',' + o.x2.toFixed(1) + ',' + o.y2.toFixed(1) + ',' + (o.thick || 0).toFixed(1) + ',' + (o.h3d || 0) + ',' + (o.base || 0) + ',' + (o.just || '') + ',' + (o.fill || '') + ',' + (o.layers ? o.layers.map(l => l.mat + (l.t || 0).toFixed(1) + '/' + (l.top || 0) + '/' + (l.bot || 0) + '/' + (l.ext1 || 0) + '/' + (l.ext2 || 0) + '/' + (l.lowMat || '') + (l.lowH || 0) + (l.sub ? l.sub.type : '')).join('') : '') + ';';
    else if (t === 'opening') s += 'O' + o.id + ':' + o.wallId + ',' + (o.t || 0).toFixed(4) + ',' + (o.w || 0).toFixed(1) + ',' + (o.sill || 0) + ',' + (o.head || 0) + ',' + (o.depth || 0) + ',' + (o.frameW || 0) + ',' + (o.frameD || 0) + ',' + o.kind + ',' + (o.winType || '') + ',' + (o.winHinge || '') + ',' + (o.winMat || '') + ',' + (o.bank !== false ? 1 : 0) + ',' + (o.sims ? 1 : 0) + ',' + (o.bankOver || 0) + ',' + (o.boardVis != null ? o.boardVis : 1) + ',' + (o.anschlagType || '') + ',' + (o.anschlagDepth || 0) + ',' + (o.niche ? 1 : 0) + ',' + _revSig(o) + ';';
    else if (t === 'slab') s += 'B' + o.id + ':' + (o.base || 0) + ',' + (o.thick || 0) + ',' + (o.pts ? o.pts.length : 0) + ',' + (o.layers ? o.layers.map(l => l.mat + (l.t || 0)).join('') : '') + ';';
    else if (t === 'profile') s += 'P' + o.id + ':' + (o.elev || 0) + ',' + (o.path ? o.path.length : 0) + ',' + (o.prof ? o.prof.length : 0) + ',' + (o.mat || '') + ';';
    else if (t === 'roof') s += 'R' + o.id + ':' + o.x + ',' + o.y + ',' + o.w + ',' + o.h + ',' + (o.rtype || '') + ',' + (o.axis || '') + ';';
    else if (t === 'stairs') s += 'T' + o.id + ':' + o.x1 + ',' + o.y1 + ',' + o.x2 + ',' + o.y2 + ';';
  }
  return s;
}
function drawSection(svg, a, arr) {
  const revLayer = () => { const rh = _secCache[a.id] && _secCache[a.id]._revHits; if (rh) for (const h of rh) { const at = { class: h.frame ? 'frame-hit' : 'rev-hit', points: h.pts.map(q => q[0].toFixed(2) + ',' + q[1].toFixed(2)).join(' '), fill: h.gcol || 'transparent', 'data-id': h.oid }; if (h.gcol) { at.fill = h.gcol; at['fill-opacity'] = 0.16; at.stroke = h.gcol; at['stroke-width'] = 1; at['stroke-opacity'] = 0.8; at['stroke-dasharray'] = '4 3'; at['vector-effect'] = 'non-scaling-stroke'; } if (h.frame) at['data-frame'] = '1'; else at['data-rev'] = h.rev; const pr = (h.rev || '').split(':'), tip = h.frame ? 'Rahmen' : revealName(pr[0], pr[1], pr[2]); svg.appendChild(attachTip(addHoverHL(svgEl('polygon', at)), tip)); } };   // klickbare Laibungsschichten (Sturz/Schwelle) + Rahmen, farbcodiert nach Zugehörigkeit (konsistent zum Grundriss)
  const hdlVis = h => secSelWall == null || h.wid === secSelWall;   // bei sub-gewählter Wand nur deren Ziehpunkte
  const wallLayer = () => { const wh = _secCache[a.id] && _secCache[a.id]._wallHits; if (wh) for (const b of wh) { const r = svgEl('rect', { x: b.x0, y: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0, fill: 'transparent', 'data-id': a.id, 'data-wall': b.wid }); r.style.cursor = 'pointer'; svg.appendChild(r); } };   // klickbare Wand-Bauteile (Wand im Schnitt wählen) ÜBER dem Hit-Rechteck
  const owLayer = () => { const oh = _secCache[a.id] && _secCache[a.id]._owHits; if (oh) for (const o of oh) { const r = svgEl('rect', { x: o.x, y: o.y, width: o.w, height: o.h, fill: 'transparent', 'data-id': o.oid }); r.style.cursor = 'pointer'; svg.appendChild(r); } };   // Fenster im Schnitt auswählbar (Klickzone über der Öffnung; Laibungen liegen darüber)
  const reuse = () => { const gc = _secCache[a.id].cloneNode(true); svg.appendChild(gc); const bb = sectionBBox(a, arr); svg.appendChild(svgEl('rect', { x: bb.x, y: bb.y, width: bb.w, height: bb.h, fill: 'transparent', 'data-id': a.id })); wallLayer(); owLayer(); revLayer(); if (sel && sel.id === a.id && _secCache[a.id]._hdl) for (const h of _secCache[a.id]._hdl) { if (!hdlVis(h)) continue; svg.appendChild(svgEl('circle', { class: 'handle ' + h.cls, cx: h.x, cy: h.y, r: h.r, 'data-h': h.key, 'data-id': a.id, 'vector-effect': 'non-scaling-stroke' })); } return gc; };
  if (_fastDraw && _secCache[a.id] && !(_secLive && sel && sel.id === a.id)) return reuse();   // während Drag: aus Cache → flüssig; nur der aktiv bearbeitete Schnitt rechnet live neu
  const sig = sectionSig(a, arr); if (_secCacheSig[a.id] === sig && _secCache[a.id]) return reuse();   // unverändert → aus Cache (kein Neuschnitt bei Klicks/Eingaben anderswo)
  const g = svgEl('g', { 'data-id': a.id, class: 'sec-g' }), hatchG = svgEl('g', { class: 'rev-hatch' }), hdl = [], revHits = [], wallHB = {}, owHits = [];   // hatchG: Laibungs-Lining-Schraffur, nur bei Hover über den Schnitt
  for (const p of sectionPrimitives(a, arr)) {
    if (p.t === 'rect') { const hl = p.wid != null && sel && sel.id === a.id && secSelWall === p.wid, r = svgEl('rect', { x: Math.min(p.x, p.x + p.w), y: Math.min(p.y, p.y + p.h), width: Math.abs(p.w), height: Math.abs(p.h), fill: p.fill || 'none', 'vector-effect': 'non-scaling-stroke' }); if (hl) { r.setAttribute('stroke', '#1a9a4e'); r.setAttribute('stroke-width', 2); } else if (p.stroke && p.stroke !== 'none') { r.setAttribute('stroke', p.stroke); r.setAttribute('stroke-width', p.sw || 0.6); } if (p.wid != null) { const k = p.wid, b = wallHB[k] || (wallHB[k] = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, wid: k }), rx0 = Math.min(p.x, p.x + p.w), ry0 = Math.min(p.y, p.y + p.h), rx1 = Math.max(p.x, p.x + p.w), ry1 = Math.max(p.y, p.y + p.h); b.x0 = Math.min(b.x0, rx0); b.y0 = Math.min(b.y0, ry0); b.x1 = Math.max(b.x1, rx1); b.y1 = Math.max(b.y1, ry1); } g.appendChild(r); }
    else if (p.t === 'poly') { const pl = svgEl('polygon', { points: p.pts.map(q => q[0].toFixed(2) + ',' + q[1].toFixed(2)).join(' '), fill: p.fill || 'none', 'vector-effect': 'non-scaling-stroke' }); if (p.stroke && p.stroke !== 'none') { pl.setAttribute('stroke', p.stroke); pl.setAttribute('stroke-width', p.sw || 0.6); } g.appendChild(pl); if (p.rev && p.oid != null) revHits.push({ pts: p.pts, oid: p.oid, rev: p.rev, gcol: p.gcol }); else if (p.frame && p.oid != null) revHits.push({ pts: p.pts, oid: p.oid, frame: 1 }); }
    else if (p.t === 'line') { const l = svgEl('line', { x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2, stroke: p.stroke || '#1c242c', 'stroke-width': p.w || 1, 'vector-effect': 'non-scaling-stroke' }); if (p.dash) l.setAttribute('stroke-dasharray', p.dash); (p.hov ? hatchG : g).appendChild(l); }
    else if (p.t === 'arrow') { const s = 6, ang = Math.atan2(p.dy, p.dx); for (const da of [2.5, -2.5]) g.appendChild(svgEl('line', { x1: p.x, y1: p.y, x2: p.x - Math.cos(ang + da) * s, y2: p.y - Math.sin(ang + da) * s, stroke: p.col || '#1c242c', 'stroke-width': 1.4, 'vector-effect': 'non-scaling-stroke' })); }
    else if (p.t === 'text') { const t = svgEl('text', { x: p.x, y: p.y, fill: p.col || '#1c242c', 'font-size': p.size || (p.small ? 9 : 12), 'font-weight': p.small ? 400 : 700, 'paint-order': 'stroke', stroke: '#fff', 'stroke-width': 3 }); if (p.mid) { t.setAttribute('text-anchor', 'middle'); t.setAttribute('dominant-baseline', 'middle'); } if (p.ang) t.setAttribute('transform', 'rotate(' + p.ang.toFixed(1) + ' ' + p.x.toFixed(2) + ' ' + p.y.toFixed(2) + ')'); t.textContent = p.text; g.appendChild(t); }
    else if (p.t === 'owhit') owHits.push({ x: p.x, y: p.y, w: p.w, h: p.h, oid: p.oid });
    else if (p.t === 'lhandle') hdl.push({ x: p.x, y: p.y, key: 'sl:' + p.wallId + ':' + p.li + ':' + p.edge, cls: 'lay-handle', r: 4.5, wid: p.wallId });
    else if (p.t === 'shandle') { const m = /^sh:wh:(\d+)/.exec(p.key); hdl.push({ x: p.x, y: p.y, key: p.key, cls: 'dim-handle', r: 5, wid: m ? +m[1] : null }); }
  }
  if (hatchG.childNodes.length) g.appendChild(hatchG);   // Laibungs-Lining-Schraffur in eigene Gruppe (Hover-gesteuert)
  svg.appendChild(g);
  const clone = g.cloneNode(true); clone._hdl = hdl; clone._revHits = revHits; clone._wallHits = Object.values(wallHB); clone._owHits = owHits; _secCache[a.id] = clone; _secCacheSig[a.id] = sig;   // Cache + Signatur + Griffe + Laibungs-/Wand-/Fenster-Klickflächen
  const b = sectionBBox(a, arr); svg.appendChild(svgEl('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: 'transparent', 'data-id': a.id }));
  wallLayer(); owLayer(); revLayer();
  if (sel && sel.id === a.id) for (const h of hdl) { if (!hdlVis(h)) continue; svg.appendChild(svgEl('circle', { class: 'handle ' + h.cls, cx: h.x, cy: h.y, r: h.r, 'data-h': h.key, 'data-id': a.id, 'vector-effect': 'non-scaling-stroke' })); }   // Griffe ÜBER dem Hit-Rechteck → klickbar (bei sub-gewählter Wand nur deren)
  return g;
}
function startSection(pv, e, p) {
  pushUndo();
  const a = { id: nextId++, type: 'section', cx1: p.x, cy1: p.y, cx2: p.x, cy2: p.y, label: 'A', ox: 0, oy: 0 };
  pushAnno(pv.num, a);
  const move = ev => { const q = evtToPage(pv, ev); if (ev.shiftKey) { const s = snap15(p.x, p.y, q.x, q.y); a.cx2 = s.x; a.cy2 = s.y; } else { a.cx2 = q.x; a.cy2 = q.y; } requestDraw(pv); };
  const up = () => {
    document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
    if (Math.hypot(a.cx2 - a.cx1, a.cy2 - a.cy1) < 8) { const arr = getAnnos(pv.num); arr.splice(arr.indexOf(a), 1); undoStack.pop(); drawAnnos(pv); return; }
    const perPt = docScale ? docScale.perPt : 0, hPts = perPt ? (sectionMaxH(a, getAnnos(pv.num)) / perPt) : 200;
    a.ox = Math.min(a.cx1, a.cx2); a.oy = Math.max(a.cy1, a.cy2) + 70 + hPts;
    sel = { num: pv.num, id: a.id }; setTool('select'); drawAnnos(pv); saveState();
    toast('Schnitt erstellt – er aktualisiert sich live. Block verschiebbar; Schnittlinie über die Wände ziehen.');
  };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
}
function openingResolve(a, pv) {   // Position/Winkel/Dicke aus der zugehörigen Wand ableiten (Öffnung läuft mit)
  if (!a.wallId) return; const w = getAnnos(pv.num).find(o => o.id === a.wallId && o.type === 'wall'); if (!w) return;
  const t = a.t == null ? 0.5 : a.t, T = w.thick || wallThickPts(); let px = w.x1 + (w.x2 - w.x1) * t, py = w.y1 + (w.y2 - w.y1) * t;
  const dx = w.x2 - w.x1, dy = w.y2 - w.y1, L = Math.hypot(dx, dy) || 1, off = (w.just === 'left' ? T / 2 : w.just === 'right' ? -T / 2 : 0);   // Band-Mitte bei Achsen-Versatz
  a.x = px + (-dy / L) * off; a.y = py + (dx / L) * off; a.ang = Math.atan2(dy, dx); a.thick = T;
  if ((a.kind === 'window' || a.kind === 'door') && w.layers && w.layers.length) {   // STANDARD-Laibung: übernimmt die Deckschicht (Material + Stärke) – innen innerste, aussen äusserste Wandschicht; deckt bis 1cm vom Rahmen
    const cm = t => Math.round(ptsToCm(t) * 10) / 10, L0 = w.layers[0], LN = w.layers[w.layers.length - 1];
    if (!Array.isArray(a.revealLining)) a.revealLining = [{ mat: L0.mat, t: cm(L0.t) }];
    if (!Array.isArray(a.revealLiningOut)) a.revealLiningOut = [{ mat: LN.mat, t: cm(LN.t) }];
    if (!a.reveals) { const cp = arr2 => (Array.isArray(arr2) ? arr2 : []).map(L => ({ mat: L.mat, t: L.t, gap: L.gap, prio: L.prio })); const FIN = ['putz', 'gips', 'dsp'], frameWcm = Math.round(ptsToCm(a.frameW || cmToPts(10)) * 10) / 10, inFin = FIN.includes(L0.mat) ? cm(L0.t) : 0; const bvIn = Math.max(0, Math.round((frameWcm - inFin) * 10) / 10); a.reveals = {}; for (const e of ['L', 'R', 'T', 'B']) a.reveals[e] = { in: cp(a.revealLining), out: cp(a.revealLiningOut), boardVisIn: bvIn, boardVisOut: (a.boardVis != null ? a.boardVis : 1) }; }   // innen: Mauerwerk bündig an Rahmen-Aussenkante, nur Innenputz lappt (Rahmen sichtbar = frameW − Innenputz); aussen wie bisher (1 cm sichtbar)
  }
}
function openingClick(pv, p) {
  const nw = nearestWall(pv, p.x, p.y);
  if (!nw || nw.dist > nw.thick * 0.85 + 10) { toast('Tür/Fenster auf eine Wand setzen.'); return; }
  pushUndo();
  const dx = nw.wall.x2 - nw.wall.x1, dy = nw.wall.y2 - nw.wall.y1, L2 = dx * dx + dy * dy || 1, t = ((nw.cx - nw.wall.x1) * dx + (nw.cy - nw.wall.y1) * dy) / L2;
  const a = { id: nextId++, type: 'opening', wallId: nw.wall.id, t, x: nw.cx, y: nw.cy, ang: nw.ang, thick: nw.thick, w: lastOpenW || cmToPts(openKind === 'window' ? 100 : 90), kind: openKind, hinge: 1, swing: 1, sill: openKind === 'window' ? 0.9 : 0, head: openKind === 'window' ? 2.1 : 2.0, depth: lastOpenDepth, winType: openKind === 'door' ? lastDoorType : lastWinType, winHinge: lastWinHinge, winMat: lastWinMat, color: nw.wall.color || '#1c242c' };
  pushAnno(pv.num, a); sel = { num: pv.num, id: a.id }; drawAnnos(pv); saveState();
}
// Öffnung (Fenster/Tür) mittig auf eine Wand – reines Objekt (für 3D-Panel „+ Fenster/+ Tür")
function makeOpening(wall, kind) {
  const dx = wall.x2 - wall.x1, dy = wall.y2 - wall.y1, t = 0.5;
  return { id: nextId++, type: 'opening', wallId: wall.id, t, x: wall.x1 + dx * t, y: wall.y1 + dy * t, ang: Math.atan2(dy, dx), thick: wall.thick || wallThickPts(), w: cmToPts(kind === 'window' ? 100 : 90), kind, hinge: 1, swing: 1, sill: kind === 'window' ? 0.9 : 0, head: kind === 'window' ? 2.1 : 2.0, depth: lastOpenDepth, winType: kind === 'door' ? lastDoorType : lastWinType, winHinge: lastWinHinge, winMat: lastWinMat, color: wall.color || '#1c242c', layer: wall.layer };
}
function addOpeningToWall(wall, kind, pageNum) { if (!wall) return null; pushUndo(); const a = makeOpening(wall, kind); pushAnno(pageNum, a); saveState(); return a; }
function startOpeningMove(pv, e, a) {   // Öffnung entlang ihrer Wand verschieben (sonst frei)
  const wall = a.wallId && getAnnos(pv.num).find(o => o.id === a.wallId && o.type === 'wall');
  if (!wall) return startMove(pv, e, a);
  pushUndo(); let moved = false;
  const move = ev => { moved = true; const q = evtToPage(pv, ev), dx = wall.x2 - wall.x1, dy = wall.y2 - wall.y1, L2 = dx * dx + dy * dy || 1; let t = ((q.x - wall.x1) * dx + (q.y - wall.y1) * dy) / L2; a.t = Math.max(0, Math.min(1, t)); openingResolve(a, pv); requestDraw(pv); };
  const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); if (!moved) undoStack.pop(); else saveState(); };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
}
/* ---------- Möbel- / Sanitär-Symbole (Blöcke) ---------- */
let blockKind = 'table';
const BLOCK_DEFS = { bed: [200, 150], table: [120, 80], sofa: [200, 90], chair: [45, 45], wc: [40, 60], sink: [60, 45], shower: [90, 90], bath: [170, 75], stove: [60, 60], fridge: [60, 65], kitchen: [60, 60], kitchensink: [80, 50], dishwasher: [60, 60], washer: [60, 60], cabinet: [90, 40], wardrobe: [140, 60], tallcab: [60, 60], desk: [140, 70], nightstand: [45, 40], column: [30, 30], columnRound: [36, 36] };
const BLOCK_H = { bed: 0.5, table: 0.75, sofa: 0.8, chair: 0.9, wc: 0.4, sink: 0.85, shower: 0.04, bath: 0.55, stove: 0.9, fridge: 1.8, kitchen: 0.9, kitchensink: 0.9, dishwasher: 0.85, washer: 0.85, cabinet: 1.2, wardrobe: 2.0, tallcab: 2.1, desk: 0.74, nightstand: 0.5, column: 2.6, columnRound: 2.6 };
const IS_COLUMN = k => k === 'column' || k === 'columnRound';   // Stütze (Poché-Füllung, volle Geschosshöhe im 3D)
function blockShapes(a) {   // Symbol-Geometrie in absoluten Seitenkoordinaten (für Schirm + PDF)
  const x = Math.min(a.x, a.x + a.w), y = Math.min(a.y, a.y + a.h), w = Math.abs(a.w), h = Math.abs(a.h), k = a.kind, mn = Math.min(w, h), s = [];
  const X = f => x + f * w, Y = f => y + f * h;
  const rr = (fx, fy, fw, fh, r) => s.push({ t: 'rect', x: X(fx), y: Y(fy), w: fw * w, h: fh * h, rx: (r || 0) * mn });
  const el = (fx, fy, rx, ry) => s.push({ t: 'ell', cx: X(fx), cy: Y(fy), rx: rx * w, ry: ry * h });
  const ci = (fx, fy, r) => s.push({ t: 'circ', cx: X(fx), cy: Y(fy), r: r * mn });
  const ln = (x1, y1, x2, y2) => s.push({ t: 'line', x1: X(x1), y1: Y(y1), x2: X(x2), y2: Y(y2) });
  if (k === 'columnRound') { ci(0.5, 0.5, 0.5); return s; }   // runde Stütze
  if (k === 'column') { rr(0, 0, 1, 1, 0); return s; }         // rechteckige Stütze
  rr(0, 0, 1, 1, 0.03);
  if (k === 'bed') { rr(0.06, 0.04, 0.88, 0.26, 0.04); ln(0, 0.32, 1, 0.32); }
  else if (k === 'table') rr(0.12, 0.12, 0.76, 0.76, 0.02);
  else if (k === 'sofa') { rr(0, 0, 1, 0.26, 0.06); rr(0, 0.12, 0.12, 0.88, 0.06); rr(0.88, 0.12, 0.12, 0.88, 0.06); ln(0.34, 0.28, 0.34, 1); ln(0.66, 0.28, 0.66, 1); }
  else if (k === 'chair') rr(0.12, 0, 0.76, 0.16, 0.03);
  else if (k === 'wc') { rr(0.3, 0, 0.4, 0.22, 0.02); el(0.5, 0.62, 0.26, 0.33); }
  else if (k === 'sink') { rr(0.12, 0.12, 0.76, 0.76, 0.12); ci(0.5, 0.74, 0.05); ci(0.5, 0.2, 0.05); }
  else if (k === 'shower') { ln(0.06, 0.06, 0.94, 0.94); ln(0.94, 0.06, 0.06, 0.94); ci(0.5, 0.5, 0.06); }
  else if (k === 'bath') { rr(0.06, 0.12, 0.88, 0.76, 0.2); ci(0.82, 0.5, 0.05); }
  else if (k === 'stove') { ci(0.3, 0.3, 0.13); ci(0.7, 0.3, 0.13); ci(0.3, 0.7, 0.13); ci(0.7, 0.7, 0.13); }
  else if (k === 'fridge') { ln(0, 0.42, 1, 0.42); ln(0.84, 0.12, 0.84, 0.32); ln(0.84, 0.52, 0.84, 0.72); }
  else if (k === 'kitchen') { ln(0, 0.16, 1, 0.16); ln(0.42, 0.9, 0.58, 0.9); }   // Küchen-Unterschrank: Arbeitsplattenkante + Griff
  else if (k === 'kitchensink') { rr(0.07, 0.2, 0.4, 0.6, 0.06); rr(0.53, 0.2, 0.4, 0.6, 0.06); ci(0.5, 0.1, 0.045); }   // Spüle: zwei Becken + Armatur
  else if (k === 'dishwasher') { ln(0, 0.18, 1, 0.18); ci(0.5, 0.55, 0.3); ci(0.5, 0.55, 0.06); }   // Geschirrspüler
  else if (k === 'washer') { ln(0, 0.16, 1, 0.16); ci(0.5, 0.56, 0.3); ci(0.5, 0.56, 0.12); }   // Waschmaschine: Trommel
  else if (k === 'cabinet') { ln(0, 0.34, 1, 0.34); ln(0, 0.67, 1, 0.67); }   // Regal/Schrank: Tablare
  else if (k === 'wardrobe') { ln(0.5, 0, 0.5, 1); ln(0.08, 0.5, 0.92, 0.5); }   // Kleiderschrank: zwei Türen + Kleiderstange
  else if (k === 'tallcab') { ln(0, 0, 1, 1); ln(1, 0, 0, 1); }   // Hochschrank: X (raumhoch)
  else if (k === 'desk') { rr(0.66, 0.08, 0.28, 0.84, 0.02); }   // Schreibtisch: Rollcontainer
  else if (k === 'nightstand') { rr(0.22, 0.22, 0.56, 0.56, 0.02); }   // Nachttisch: Schublade
  return s;
}
function drawBlock(svg, a) {
  const col = a.color || '#1c242c', fill = IS_COLUMN(a.kind) ? '#b8bcb2' : 'none', g = svgEl('g', { 'data-id': a.id });
  if (a.rot) { const bx = Math.min(a.x, a.x + a.w) + Math.abs(a.w) / 2, by = Math.min(a.y, a.y + a.h) + Math.abs(a.h) / 2; g.setAttribute('transform', 'rotate(' + (a.rot * 180 / Math.PI).toFixed(2) + ' ' + bx + ' ' + by + ')'); }
  for (const sp of blockShapes(a)) {
    if (sp.t === 'rect') g.appendChild(svgEl('rect', { x: sp.x, y: sp.y, width: sp.w, height: sp.h, rx: sp.rx || 0, ry: sp.rx || 0, fill, stroke: col, 'stroke-width': 1.2, 'vector-effect': 'non-scaling-stroke' }));
    else if (sp.t === 'ell') g.appendChild(svgEl('ellipse', { cx: sp.cx, cy: sp.cy, rx: sp.rx, ry: sp.ry, fill, stroke: col, 'stroke-width': 1.2, 'vector-effect': 'non-scaling-stroke' }));
    else if (sp.t === 'circ') g.appendChild(svgEl('circle', { cx: sp.cx, cy: sp.cy, r: sp.r, fill: a.kind === 'columnRound' ? fill : 'none', stroke: col, 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }));
    else if (sp.t === 'line') g.appendChild(svgEl('line', { x1: sp.x1, y1: sp.y1, x2: sp.x2, y2: sp.y2, stroke: col, 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }));
  }
  svg.appendChild(g); return g;
}
function placeBlock(pv, p) {
  pushUndo(); const d = BLOCK_DEFS[blockKind] || [80, 80], w = docScale ? cmToPts(d[0]) : d[0] * 1.3, h = docScale ? cmToPts(d[1]) : d[1] * 1.3;
  const a = { id: nextId++, type: 'block', kind: blockKind, x: p.x - w / 2, y: p.y - h / 2, w, h, color: '#1c242c' };
  pushAnno(pv.num, a); sel = { num: pv.num, id: a.id }; drawAnnos(pv); saveState();
}
function addRoomArea(pv, pts, thick) {   // geschlossener Wandzug → lichte Raumfläche (m²)
  if (pts.length < 3) return;
  let poly = pts.map(p => [p[0], p[1]]); const inner = insetPolygon(poly, (thick || wallThickPts()) / 2); if (inner) poly = inner;
  getAnnos(pv.num).unshift({ id: nextId++, type: 'area', pts: poly, color: '#4f7a3c', width: 0, room: true, layer: activeLayerId });   // hinter die Wände
  toast('Raumfläche (lichte) ergänzt ✓');
}
function wallChainUndo() {   // Rücktaste: letzte gesetzte Wand zurücknehmen
  if (!wallDraft) return; const { pv, seg, segIds } = wallDraft;
  if (!segIds || !segIds.length) { finishWallChain(); return; }   // nichts gesetzt → Kette beenden
  const arr = getAnnos(pv.num), lastId = segIds.pop(); const i = arr.findIndex(x => x.id === lastId); if (i >= 0) arr.splice(i, 1);
  wallDraft.pts.pop(); const np = wallDraft.pts[wallDraft.pts.length - 1]; wallDraft.last = np; seg.x1 = np[0]; seg.y1 = np[1];
  drawAnnos(pv);
}
function finishWallChain() {
  if (!wallDraft) return; const { pv, seg, _onMove } = wallDraft; document.removeEventListener('pointermove', _onMove);
  const arr = getAnnos(pv.num), i = arr.indexOf(seg); if (i >= 0) arr.splice(i, 1);   // unbestätigtes letztes Segment verwerfen
  wallDraft = null; hideDrawHud(); if (pv) drawAnnos(pv); saveState();
}

/* ---------- Text-Box (mit Rahmen, Ausrichtung, Hintergrund, Rand, Grösse) ---------- */
let textStyle = { size: 16, align: 'left', bg: 'transparent', border: null };   // gemerkt für die nächste neue Box
let editingId = null;                                                          // Id der gerade editierten Text-Box
let cropping = null;                                                           // {pv, a} – aktiver Zuschneide-Rahmen
let panMode = false, panning = null;                                          // Leertaste-Hand (Pan)
let areaDraft = null;                                                          // {pv, a} – Polygon im Bau (Fläche messen)
function createText(pv, p) {
  pushUndo();
  const w = Math.max(120, Math.min(260, pv.pageW - p.x - 8));
  const a = { id: nextId++, type: 'text', x: p.x, y: p.y, w, h: textStyle.size * 1.5, text: '', size: textStyle.size, color: style.color, align: textStyle.align, bg: textStyle.bg, border: textStyle.border, borderW: 1.2 };
  pushAnno(pv.num, a); sel = { num: pv.num, id: a.id };
  openTextBox(pv, a, true);
}
function openTextBox(pv, a, isNew) {
  const sc = pv.scale, pad = 3;
  editingId = a.id; drawAnnos(pv);
  const ta = document.createElement('textarea'); ta.className = 'textedit tb-edit'; ta.value = a.text || '';
  const restyle = () => {
    ta.style.left = (a.x * sc) + 'px'; ta.style.top = (a.y * sc) + 'px'; ta.style.width = (a.w * sc) + 'px';
    ta.style.fontSize = (a.size * sc) + 'px'; ta.style.color = a.color; ta.style.textAlign = a.align || 'left';
    ta.style.padding = (pad * sc) + 'px';
    ta.style.background = (a.bg && a.bg !== 'transparent') ? a.bg : 'rgba(255,255,255,.04)';
    ta.style.border = a.border ? ((a.borderW || 1.2) + 'px solid ' + a.border) : '1px dashed rgba(80,110,70,.55)';
  };
  const autoH = () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; a.h = ta.scrollHeight / sc; };
  restyle(); pv.inner.appendChild(ta); autoH();
  ta.focus(); try { ta.scrollIntoView({ block: 'center' }); } catch (_) { } if (!isNew) ta.select();
  const bar = buildTextBar(pv, a, ta, restyle, autoH);
  let done = false;
  const commit = () => {
    if (done) return; done = true;
    document.removeEventListener('pointerdown', outside, true);
    a.text = ta.value.replace(/\s+$/, ''); ta.remove(); bar.remove(); editingId = null;
    textStyle = { size: a.size, align: a.align, bg: a.bg, border: a.border };
    if (!a.text) { const arr = getAnnos(pv.num), i = arr.indexOf(a); if (i >= 0) arr.splice(i, 1); sel = null; }
    setTool('select'); drawAnnos(pv); saveState();
  };
  const outside = ev => { if (ev.target.closest('.tb-edit') === ta || ev.target.closest('.textbar') === bar) return; commit(); };
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);   // erst nach dem aktuellen Klick scharf schalten
  ta.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); commit(); } else if (ev.key === 'Escape') { ev.preventDefault(); commit(); } });
  ta.addEventListener('input', autoH);
}
function buildTextBar(pv, a, ta, restyle, autoH) {
  const sc = pv.scale, bar = document.createElement('div'); bar.className = 'textbar';
  bar.style.left = (a.x * sc) + 'px'; bar.style.top = Math.max(0, a.y * sc - 42) + 'px';
  bar.innerHTML =
    '<div class="tb-g"><button data-al="left" title="Linksbündig">⯇</button><button data-al="center" title="Zentriert">≡</button><button data-al="right" title="Rechtsbündig">⯈</button></div>' +
    '<div class="tb-g"><button data-sz="-1" title="Kleiner">A−</button><button data-sz="1" title="Grösser">A＋</button></div>' +
    '<div class="tb-g"><label class="tb-sw" title="Textfarbe"><span class="tb-dot" data-dot="text"></span><input type="color" data-col="text"></label></div>' +
    '<div class="tb-g"><span class="tb-lbl">Hg</span><button data-bg="transparent" title="Transparent">∅</button><button data-bg="#ffffff" title="Weiss">□</button><label class="tb-sw" title="Hintergrundfarbe"><span class="tb-dot" data-dot="bg"></span><input type="color" data-col="bg"></label></div>' +
    '<div class="tb-g"><button data-bd="t" title="Rand an/aus">Rand</button><label class="tb-sw" title="Randfarbe"><span class="tb-dot" data-dot="bd"></span><input type="color" data-col="bd"></label></div>';
  pv.inner.appendChild(bar);
  const mark = () => {
    bar.querySelectorAll('[data-al]').forEach(b => b.classList.toggle('on', (a.align || 'left') === b.dataset.al));
    bar.querySelectorAll('[data-bg]').forEach(b => b.classList.toggle('on', (a.bg || 'transparent') === b.dataset.bg));
    bar.querySelector('[data-bd="t"]').classList.toggle('on', !!a.border);
    const td = bar.querySelector('[data-dot="text"]'); td.style.background = a.color;
    const bd = bar.querySelector('[data-dot="bg"]'); bd.style.background = (a.bg && a.bg !== 'transparent') ? a.bg : 'transparent';
    const dd = bar.querySelector('[data-dot="bd"]'); dd.style.background = a.border || 'transparent';
  };
  bar.querySelector('[data-col="text"]').value = a.color || '#1c242c';
  bar.querySelector('[data-col="bg"]').value = (a.bg && a.bg[0] === '#') ? a.bg : '#ffffff';
  bar.querySelector('[data-col="bd"]').value = a.border || '#1c242c';
  bar.addEventListener('mousedown', e => { if (e.target.closest('input[type=color]')) return; e.preventDefault(); });   // Fokus im Textfeld halten
  bar.querySelectorAll('[data-al]').forEach(b => b.onclick = () => { a.align = b.dataset.al; restyle(); mark(); ta.focus(); });
  bar.querySelectorAll('[data-sz]').forEach(b => b.onclick = () => { a.size = Math.max(8, Math.min(96, a.size + (+b.dataset.sz) * 2)); restyle(); autoH(); ta.focus(); });
  bar.querySelectorAll('[data-bg]').forEach(b => b.onclick = () => { a.bg = b.dataset.bg; restyle(); mark(); ta.focus(); });
  bar.querySelector('[data-bd="t"]').onclick = () => { a.border = a.border ? null : (bar.querySelector('[data-col="bd"]').value || '#1c242c'); restyle(); mark(); ta.focus(); };
  bar.querySelector('[data-col="text"]').oninput = e => { a.color = e.target.value; restyle(); mark(); };
  bar.querySelector('[data-col="bg"]').oninput = e => { a.bg = e.target.value; restyle(); mark(); };
  bar.querySelector('[data-col="bd"]').oninput = e => { a.border = e.target.value; restyle(); mark(); };
  mark(); return bar;
}
/* ---------- Vorhandenen Text bearbeiten (überdecken + neu schreiben) ---------- */
function parseColor(s) { if (!s) return { r: 0, g: 0, b: 0 }; if (s[0] === '#') return hexToRgb(s); const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(s); return m ? { r: +m[1] / 255, g: +m[2] / 255, b: +m[3] / 255 } : { r: 0, g: 0, b: 0 }; }
// Schrift-Familie (CSS) aus erkannter Klasse
function cssFontStack(fam) { return fam === 'times' ? 'Georgia,"Times New Roman",serif' : fam === 'courier' ? 'Consolas,"Courier New",monospace' : 'Helvetica,Arial,sans-serif'; }
// Original-Schrift bestmöglich erkennen: Serif/Sans/Mono + fett + kursiv (aus PDF-Schriftname/-familie)
function detectFontMeta(pv, fontName, family) {
  let nm = '';
  try { const f = pv.page.commonObjs.get(fontName); if (f && f.name) nm = f.name; } catch (_) { }
  const s = ((nm || '') + ' ' + (family || '')).toLowerCase();
  const bold = /bold|black|heavy|semibold|demibold|-bd|\bbd\b|extrab/.test(s);
  const italic = /italic|oblique|-it\b|\bit\b/.test(s);
  const mono = /mono|courier|consol|typewriter/.test(s) || family === 'monospace';
  const serif = !mono && (/times|serif|roman|georgia|minion|garamond|antiqua|palatino|cambria|caslon/.test(s) || family === 'serif');
  return { fam: mono ? 'courier' : serif ? 'times' : 'helv', bold: !!bold, italic: !!italic };
}
// Textstücke der Seite mit Kästchen in Seitenkoordinaten (y-unten, Oberkante) – einmal berechnet, inkl. erkannter Schrift
async function ensureTextItems(pv) {
  if (pv.textItems) return pv.textItems;
  const items = [];
  try {
    const tc = await pv.page.getTextContent();
    const styles = tc.styles || {};
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const tr = it.transform, fs = Math.hypot(tr[1], tr[3]) || it.height || 10;
      const top = (pv.pageH - tr[5]) - fs * 0.82;
      const fm = detectFontMeta(pv, it.fontName, styles[it.fontName] && styles[it.fontName].fontFamily);
      items.push({ x: tr[4], y: top, w: it.width || fs * it.str.length * 0.5, h: fs * 1.2, str: it.str, size: fs, fam: fm.fam, bold: fm.bold, italic: fm.italic });
    }
  } catch (_) { }
  pv.textItems = items; return items;
}
// Textstücke zu ZEILEN und ABSÄTZEN gruppieren → ein Block je Absatz (statt einer Box pro Zeile).
async function buildTextBlocks(pv) {
  if (pv.textBlocks) return pv.textBlocks;
  pv.textBlocks = groupTextBlocks(await ensureTextItems(pv)); return pv.textBlocks;
}
function groupTextBlocks(items) {
  const its = items.slice().sort((a, b) => a.y - b.y || a.x - b.x);
  // 1) Zeilen: Items mit überlappender vertikaler Lage zusammenfassen
  const lines = [];
  for (const it of its) {
    const cy = it.y + it.h / 2; let L = null;
    for (let i = lines.length - 1; i >= 0 && i >= lines.length - 5; i--) { const c = lines[i]; if (Math.abs(c.cy - cy) < Math.min(c.h, it.h) * 0.55) { L = c; break; } }
    if (L) { L.items.push(it); L.x = Math.min(L.x, it.x); L.maxx = Math.max(L.maxx, it.x + it.w); L.y = Math.min(L.y, it.y); L.maxy = Math.max(L.maxy, it.y + it.h); L.h = L.maxy - L.y; L.cy = (L.y + L.maxy) / 2; L.size = Math.max(L.size, it.size); }
    else lines.push({ items: [it], x: it.x, maxx: it.x + it.w, y: it.y, maxy: it.y + it.h, h: it.h, cy, size: it.size });
  }
  for (const L of lines) {
    L.items.sort((a, b) => a.x - b.x);
    let str = '';
    for (let i = 0; i < L.items.length; i++) { const it = L.items[i]; if (i > 0) { const pr = L.items[i - 1], gap = it.x - (pr.x + pr.w); if (gap > it.size * 0.2 && !/\s$/.test(str) && !/^\s/.test(it.str)) str += ' '; } str += it.str; }
    L.str = str; const dom = L.items.reduce((a, b) => (b.w > a.w ? b : a), L.items[0]); L.fam = dom.fam; L.bold = dom.bold; L.italic = dom.italic;
  }
  lines.sort((a, b) => a.y - b.y);
  // 2) Absätze: aufeinanderfolgende Zeilen mit ähnlicher linker Kante + Zeilenabstand ~ Zeilenhöhe + ähnlicher Grösse
  const blocks = [];
  for (const L of lines) {
    const B = blocks[blocks.length - 1], prev = B && B.lines[B.lines.length - 1];
    if (B && prev) {
      const gap = L.y - prev.maxy, lh = L.y - prev.y;
      const sameLeft = Math.abs(L.x - B.x) < B.size * 1.7, sameSize = L.size / B.size < 1.35 && B.size / L.size < 1.35, closeV = gap < B.size * 1.1 && lh > 0;
      if (sameLeft && sameSize && closeV) { B.lines.push(L); B.x = Math.min(B.x, L.x); B.maxx = Math.max(B.maxx, L.maxx); B.maxy = L.maxy; B.lhs.push(lh); continue; }
    }
    blocks.push({ lines: [L], x: L.x, maxx: L.maxx, y: L.y, maxy: L.maxy, size: L.size, fam: L.fam, bold: L.bold, italic: L.italic, lhs: [] });
  }
  return blocks.map(B => ({ x: B.x, y: B.y, w: Math.max(B.maxx - B.x, B.size), h: B.maxy - B.y, right: B.maxx, text: B.lines.map(l => l.str).join('\n'), lines: B.lines.map(l => ({ str: l.str, x: l.x, maxx: l.maxx })), size: B.size, lh: B.lhs.length ? B.lhs.reduce((a, b) => a + b, 0) / B.lhs.length : B.size * 1.25, fam: B.fam, bold: B.bold, italic: B.italic }));
}
/* ---------- Als Submit Paper öffnen: PDF-Text → editierbares Dokument (an /write/ übergeben) ---------- */
function _htmlEsc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
async function pageTextItemsFor(page, pageH) {   // Textstücke einer beliebigen Seite (ohne pv) – y von oben
  const items = [];
  try {
    const tc = await page.getTextContent(), styles = tc.styles || {};
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const tr = it.transform, fs = Math.hypot(tr[1], tr[3]) || it.height || 10, top = (pageH - tr[5]) - fs * 0.82;
      const s = ((styles[it.fontName] && styles[it.fontName].fontFamily) || '').toLowerCase();
      items.push({ x: tr[4], y: top, w: it.width || fs * it.str.length * 0.5, h: fs * 1.2, str: it.str, size: fs, fam: /serif|times|roman/.test(s) ? 'times' : /mono|courier/.test(s) ? 'courier' : 'helv', bold: /bold/.test(s), italic: /italic|oblique/.test(s) });
    }
  } catch (_) { }
  return items;
}
const _isListLine = s => /^\s*([-–—•*·▪◦‣]|\d{1,3}[.)])\s/.test(s) || /^\s*[-–—•*·▪◦‣]\S/.test(s);
// Ein Absatz-Block → HTML. Gestapelte Zeilen bleiben GESTAPELT (<br>); nur echt umbrochene Fliesstext-Zeilen werden zusammengezogen (vorige Zeile reicht fast ganz nach rechts, diese beginnt links, kein Listenpunkt, keine Satzende-Zeile davor).
function blockToParaHtml(b, body, pageRight) {
  const lines = (b.lines && b.lines.length) ? b.lines : b.text.split('\n').map(str => ({ str, x: b.x, maxx: b.right || (b.x + b.w) }));
  let inner = '';
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i], prev = lines[i - 1];
    if (i > 0) {
      const prevReaches = prev.maxx >= pageRight - b.size * 2.5;   // vorige Zeile reicht bis zum SEITEN-Textrand → umbrochener Fliesstext
      const curLeft = (cur.x - b.x) <= b.size * 1.2;               // diese Zeile beginnt links
      const wrapped = prevReaches && curLeft && !_isListLine(cur.str) && !/[.:!?]$/.test((prev.str || '').trim());
      inner += wrapped ? ' ' : '<br>';
    }
    inner += _htmlEsc(cur.str);
  }
  if (!inner.trim()) return '';
  const px = Math.max(9, Math.min(48, Math.round(b.size / body * 15)));   // Schriftgrösse relativ zur Grundschrift (Body ≈ 15px)
  const lhR = Math.max(1, Math.min(2.2, (b.lh || b.size * 1.25) / b.size));   // Zeilenabstand aus dem Original
  const st = `font-size:${px}px;line-height:${lhR.toFixed(2)}`;
  if (b.size >= body * 1.45 && lines.length === 1) return `<h2 style="${st}">` + inner + '</h2>';   // grosse Einzelzeile → Überschrift
  if (b.bold) inner = '<strong>' + inner + '</strong>'; if (b.italic) inner = '<em>' + inner + '</em>';
  return `<p style="${st}">` + inner + '</p>';
}
// Gemeinsamer rechter Textrand der Seite (dort bricht Fliesstext um) – 90-Perzentil der Zeilen-Enden
function pageRightMargin(blocks) { const r = []; blocks.forEach(b => (b.lines || []).forEach(l => r.push(l.maxx))); if (!r.length) return 1e9; r.sort((a, b) => a - b); return r[Math.floor(r.length * 0.9)]; }
function blocksToPaperHtml(blocks) {
  if (!blocks.length) return '<p></p>';
  const sizes = blocks.map(b => b.size).slice().sort((a, b) => a - b), body = sizes[Math.floor(sizes.length / 2)] || 12;
  const pr = pageRightMargin(blocks);
  const html = blocks.map(b => blockToParaHtml(b, body, pr)).filter(Boolean).join('\n');
  return html || '<p></p>';
}
/* ---------- Rechnung/Kalkulation erkennen: Anzahl × Ansatz = Betrag, mit Neuberechnung + rot markierter Fehlerwarnung ---------- */
function _parseNum(raw) {   // 4'269.75 / 4’269.75 / 1.234,55 / 1234,55 / 183.00
  if (raw == null) return null;
  let s = String(raw).trim().replace(/[’'`´ ]/g, '').replace(/\s/g, ''); if (!/\d/.test(s)) return null;
  const hasDot = s.includes('.'), hasCom = s.includes(',');
  if (hasDot && hasCom) { if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.'); else s = s.replace(/,/g, ''); }
  else if (hasCom) { if (/,\d{1,2}$/.test(s)) s = s.replace(',', '.'); else s = s.replace(/,/g, ''); }
  const m = s.match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : null;
}
function _isNumCell(s) { const t = (s || '').trim(); return /\d/.test(t) && /^[-+]?[\d'’., \s]+%?$/.test(t) && _parseNum(t) != null; }
function _isTotalDesc(s) {
  // bare gesamt/netto/brutto nur als GANZES Wort (Lookahead) → „Gesamtfläche"/„Bruttogeschossfläche"/„Nettowohnfläche" sind KEINE Summenzeilen
  return /^\s*((?:gesamt|netto|brutto|zwischen|end)?total|(?:gesamt|end|netto|brutto|rechnungs)?betrag|(?:gesamt|zwischen)?summe|(?:gesamt|netto|brutto)(?![a-zäöü])|mwst|mehrwertsteuer|rundung|rabatt|skonto|akonto|schlusszahlung|inkl\.?\s|exkl\.?\s)/i.test(s || '');
}
function _numDecimals(s) { const m = String(s).replace(/[’'\s]/g, '').match(/[.,](\d+)$/); return m ? m[1].length : 0; }
function _fmtNum(n) { const neg = n < 0; n = Math.abs(Math.round(n * 100) / 100); const p = n.toFixed(2).split('.'); return (neg ? '-' : '') + p[0].replace(/\B(?=(\d{3})+(?!\d))/g, '’') + '.' + p[1]; }
// nums: [{v,str,k}] → prüft, ob ein Wert das Produkt zweier anderer ist (Anzahl×Ansatz=Betrag). {ok, expected, cK} oder null.
function _checkCalc(nums) {
  if (nums.length < 3) {   // genau 2 Zahlen: nur wenn eindeutig Anzahl×Ansatz-Zeile mit drittem Ergebnis nicht vorhanden → kein Check
    return null;
  }
  const v = nums.map(n => n.v);
  for (let a = 0; a < v.length; a++) for (let b = 0; b < v.length; b++) { if (a === b || !v[a] || !v[b]) continue;
    for (let c = 0; c < v.length; c++) { if (c === a || c === b) continue;
      const tol = Math.max(Math.pow(10, -Math.max(_numDecimals(nums[c].str), 2)) * 0.5, 0.005) + Math.abs(v[c]) * 1e-6;
      if (Math.abs(v[a] * v[b] - v[c]) <= tol) return { ok: true, expected: Math.round(v[a] * v[b] * 100) / 100, cK: nums[c].k };
    }
  }
  // kein exaktes Tripel gefunden, aber erste×zweite weicht klar von letzter ab → Rechenfehler markieren
  if (v[0] > 0 && v[1] > 0 && v[0] < 1e5) { const prod = Math.round(v[0] * v[1] * 100) / 100; if (Math.abs(prod - v[v.length - 1]) > 0.02) return { ok: false, expected: prod, cK: nums[v.length - 1].k }; }
  return null;
}
function _joinItems(items) { let str = ''; for (let i = 0; i < items.length; i++) { const it = items[i]; if (i > 0) { const pr = items[i - 1], gap = it.x - (pr.x + pr.w); if (gap > it.size * 0.2 && !/\s$/.test(str) && !/^\s/.test(it.str)) str += ' '; } str += it.str; } return str; }
function itemsToLines(items) {   // Items → Zeilen (nach y), Items je Zeile nach x sortiert
  const its = items.slice().sort((a, b) => a.y - b.y || a.x - b.x), lines = [];
  for (const it of its) { const L = lines[lines.length - 1]; if (L && Math.abs(L.y - (it.y + it.h / 2)) < Math.min(L.size, it.size) * 0.55) { L.items.push(it); L.y = (L.y + it.y + it.h / 2) / 2; L.size = Math.max(L.size, it.size); } else lines.push({ y: it.y + it.h / 2, size: it.size, items: [it] }); }
  lines.forEach(L => L.items.sort((a, b) => a.x - b.x));
  return lines;
}
const _UNIT_RE = /^(Stk\.?|CHF|EUR|€|%|m2|m²|m3|m³|m|cm|mm|kg|g|h|Std\.?|Fr\.?|St|lfm|Pau?sch\.?|Pos\.?)$/i;
function numberColumns(lines, pageW) {   // rechte Zahlen-/Einheiten-Spalten (linke Kante)
  const xs = [], cut = pageW * 0.35;
  lines.forEach(L => L.items.forEach(it => { if (it.x > cut && (_isNumCell(it.str) || _UNIT_RE.test(it.str.trim()))) xs.push(it.x); }));
  xs.sort((a, b) => a - b); const cols = [];
  for (const x of xs) { const last = cols[cols.length - 1]; if (last && x - last.max < 16) { last.max = x; last.xs.push(x); } else cols.push({ max: x, xs: [x] }); }
  return cols.filter(c => c.xs.length >= 3).map(c => Math.min(...c.xs) - 4);
}
// Tabellenbereich → HTML. Zusammenhängende Beschreibungszeilen werden in EINER Zelle zusammengefasst (nicht in viele leere Zeilen zerrissen); Abschnitts-Überschriften (enden mit „:") = eigene fette Zeile über volle Breite.
function tableHtml(lines, first, last, cols, body) {
  const ncol = cols.length + 1;
  const rights = []; for (let i = first; i <= last; i++) rights.push(Math.max(...lines[i].items.map(it => it.x + it.w)));
  rights.sort((a, b) => a - b); const pageRight = rights[Math.floor(rights.length * 0.9)] || 1e9;
  const rows = [];
  for (let i = first; i <= last; i++) {
    const L = lines[i], cells = Array.from({ length: ncol }, () => []);
    for (const it of L.items) { let ci = 0; for (let k = 0; k < cols.length; k++) if (it.x >= cols[k] - 2) ci = k + 1; cells[ci].push(it); }
    const texts = cells.map(_joinItems); if (!texts.some(t => t.trim())) continue;
    const descItems = cells[0], hasNum = texts.slice(1).some(t => t.trim());
    const dx = descItems.length ? descItems[0].x : 0, dmax = descItems.length ? Math.max(...descItems.map(it => it.x + it.w)) : 0;
    const heading = /[:：]\s*$/.test(texts[0].trim());
    if (!hasNum) {
      const prev = rows[rows.length - 1];
      if (prev && prev.descOnly && !prev.heading && !heading && texts[0].trim()) prev.dl.push({ str: texts[0], x: dx, maxx: dmax });
      else rows.push({ descOnly: true, heading, dl: [{ str: texts[0], x: dx, maxx: dmax }] });
    } else rows.push({ descOnly: false, desc: texts[0], numTexts: texts.slice(1) });
  }
  // Geld-Spalten erkennen (Mehrheit der Zahlen hat 2 Nachkommastellen) → dort Beträge einheitlich formatieren
  const money = [];
  for (let c = 0; c < ncol - 1; c++) {
    let numeric = 0, dec2 = 0;
    for (const r of rows) if (!r.descOnly) { const t = r.numTexts[c]; if (t && _isNumCell(t) && !t.includes('%')) { numeric++; if (_numDecimals(t) === 2) dec2++; } }
    money[c] = numeric >= 3 && dec2 / numeric >= 0.6;
  }
  let html = '<table class="pdftab" style="width:100%;border-collapse:collapse;font-size:15px">';
  for (const r of rows) {
    if (r.descOnly) {
      let inner = '';
      for (let i = 0; i < r.dl.length; i++) { const cur = r.dl[i], prev = r.dl[i - 1];
        if (i > 0) { const wrapped = prev.maxx >= pageRight - body * 2.5 && (cur.x - r.dl[0].x) <= body * 1.5 && !_isListLine(cur.str) && !/[.:!?]$/.test((prev.str || '').trim()); inner += wrapped ? ' ' : '<br>'; }
        inner += _htmlEsc(cur.str);
      }
      if (!inner.trim()) continue;
      html += r.heading ? `<tr><td colspan="${ncol}" style="padding-top:5px"><strong>${inner}</strong></td></tr>` : `<tr><td colspan="${ncol}">${inner}</td></tr>`;
    } else {
      const nums = []; for (let k = 0; k < r.numTexts.length; k++) if (_isNumCell(r.numTexts[k])) nums.push({ v: _parseNum(r.numTexts[k]), str: r.numTexts[k], k: k + 1 });
      const chk = nums.length >= 3 ? _checkCalc(nums) : null;
      const totalRow = _isTotalDesc(r.desc);
      let tds = `<td>${_htmlEsc(r.desc)}</td>`;
      for (let k = 0; k < r.numTexts.length; k++) { const col = k + 1, t = r.numTexts[k];
        if (chk && !chk.ok && chk.cK === col) { tds += `<td style="text-align:right;white-space:nowrap;background:#ffd6d6;color:#8a1f11"><strong>${_fmtNum(chk.expected)}</strong> ⚠ <s>${_htmlEsc(t)}</s></td>`; continue; }   // Rechenfehler → berechnetes Ergebnis rot, Original durchgestrichen
        const isNum = _isNumCell(t), disp = (money[k] && isNum && !t.includes('%')) ? _fmtNum(_parseNum(t)) : (_htmlEsc(t) || '');   // Geld-Spalte → einheitlich 1'234.50
        tds += `<td${isNum ? ' style="text-align:right;white-space:nowrap"' : ''}>${disp}</td>`;
      }
      html += `<tr${totalRow ? ' class="tot"' : ''}>` + tds + '</tr>';
    }
  }
  return html + '</table>';
}
// Fasst erkannte Rechenfehler (rot markierte Zellen) zu einem Hinweis oben im Dokument zusammen
function _calcErrorBanner(pagesHtml) {
  const n = pagesHtml.reduce((s, h) => s + (String(h).match(/background:#ffd6d6/g) || []).length, 0);
  if (!n) return '';
  return `<p style="background:#fff3cd;border:1px solid #e0c96b;border-radius:6px;padding:8px 12px;color:#7a5c00">`
    + `<strong>⚠ ${n} mögliche${n === 1 ? 'r' : ''} Rechenfehler</strong> automatisch erkannt und rot markiert – bitte prüfen.</p>`;
}
// Seite → HTML: Fliesstext + erkannte Tabellen/Kalkulationen (mit Neuberechnung)
function pdfPageToPaperHtml(items, pageW) {
  const lines = itemsToLines(items), cols = numberColumns(lines, pageW);
  if (!cols.length) return blocksToPaperHtml(groupTextBlocks(items));   // keine Zahlenspalten → reiner Fliesstext
  const rowHasNum = L => L.items.some(it => cols.some(cx => it.x >= cx - 2 && (_isNumCell(it.str) || _UNIT_RE.test(it.str.trim()))));
  let first = -1, last = -1; lines.forEach((L, i) => { if (rowHasNum(L)) { if (first < 0) first = i; last = i; } });
  const body = (() => { const s = lines.map(L => L.size).sort((a, b) => a - b); return s[Math.floor(s.length / 2)] || 12; })();
  const preItems = lines.slice(0, first).flatMap(L => L.items), postItems = lines.slice(last + 1).flatMap(L => L.items);
  let html = '';
  if (preItems.length) html += blocksToPaperHtml(groupTextBlocks(preItems));
  html += tableHtml(lines, first, last, cols, body);
  if (postItems.length) html += blocksToPaperHtml(groupTextBlocks(postItems));
  return html || '<p></p>';
}
// „1-3, 5, 8-9" → [1,2,3,5,8,9] (begrenzt auf 1..max)
function parsePageRange(str, max) {
  const out = new Set();
  for (const part of (str || '').split(/[,\s]+/)) {
    if (!part) continue;
    const m = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (m) { let a = +m[1], z = +m[2]; if (a > z) [a, z] = [z, a]; for (let i = a; i <= z; i++) if (i >= 1 && i <= max) out.add(i); }
    else { const n = +part; if (n >= 1 && n <= max) out.add(n); }
  }
  return [...out].sort((a, b) => a - b);
}
function openPaperDlg() {
  if (!pdfDoc) return; const d = $('#paperDlg'); if (!d) { convertToPaper(); return; }
  const r = d.querySelector('input[name="ppScope"][value="all"]'); if (r) r.checked = true;
  const rg = $('#ppRange'); if (rg) rg.value = '';
  d.hidden = false;
}
async function convertToPaper(pageNums) {
  if (!pdfDoc) return;
  const nums = (pageNums && pageNums.length) ? pageNums : Array.from({ length: pdfDoc.numPages }, (_, i) => i + 1);
  status('In Submit Paper umwandeln …'); await new Promise(r => setTimeout(r, 10));
  try {
    await loadPdfJs(); const pages = []; let blockN = 0, substantial = 0;
    for (const n of nums) {
      const page = await pdfDoc.getPage(n), vp = page.getViewport({ scale: 1 });
      const items = await pageTextItemsFor(page, vp.height), blocks = groupTextBlocks(items);
      for (const b of blocks) { blockN++; if ((b.text || '').split(/\s+/).filter(Boolean).length >= 6 || (b.lines && b.lines.length >= 3)) substantial++; }   // „richtige" Textblöcke (Fliesstext) vs. verstreute Labels
      pages.push({ typ: 'write', html: pdfPageToPaperHtml(items, vp.width) });
    }
    if (!pages.some(p => p.html.replace(/<[^>]+>/g, '').trim().length)) { status(''); toast('Kein Text zum Übernehmen gefunden (evtl. gescanntes Bild-PDF).'); return; }
    const hadTable = pages.some(p => /<table/.test(p.html));
    if (!hadTable && blockN >= 16 && substantial / blockN < 0.14) {   // viele winzige, verstreute Beschriftungen, keine Tabellen → sieht aus wie Plan/Zeichnung
      status('');
      if (!confirm('Dieses PDF sieht aus wie ein Plan/eine Zeichnung (viele verstreute Beschriftungen statt Fliesstext).\n\nDie Umwandlung liefert dann nur die einzelnen Beschriftungen – kein sauberes Textdokument. Trotzdem umwandeln?')) return;
      status('In Submit Paper umwandeln …'); await new Promise(r => setTimeout(r, 10));
    }
    const banner = _calcErrorBanner(pages.map(p => p.html));   // erkannte Rechenfehler oben zusammenfassen (sonst leicht zu übersehen)
    if (banner && pages[0]) pages[0].html = banner + pages[0].html;
    const titel = (docName || 'Aus PDF').replace(/\.pdf$/i, '') + (nums.length < pdfDoc.numPages ? ' (S. ' + nums.join(',') + ')' : '');
    try { localStorage.setItem('submitpaper_import', JSON.stringify({ titel, pages, ts: Date.now() })); }
    catch (_) { status(''); toast('Text zu gross für die Übergabe – weniger Seiten wählen.'); return; }
    status(''); location.href = '../write/index.html?import=1';
  } catch (e) { status(''); console.error(e); toast('Umwandlung fehlgeschlagen.'); }
}
// Hintergrund- (häufigste) und Text-Farbe (dunkelste) im Kästchen abtasten
function sampleBox(pv, box) {
  const cv = pv.canvas; if (!cv) return {};
  let data; try { data = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; } catch (_) { return {}; }
  const k = cv.width / pv.pageW, w = cv.width, h = cv.height, counts = {}; let ink = null, inkLum = 1e9;
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 3; j++) {
    const px = Math.round((box.x + box.w * (i / 10)) * k), py = Math.round((box.y + box.h * (j / 3)) * k);
    if (px < 0 || py < 0 || px >= w || py >= h) continue; const o = (py * w + px) * 4;
    const key = (data[o] >> 4) + ',' + (data[o + 1] >> 4) + ',' + (data[o + 2] >> 4);
    (counts[key] = counts[key] || { n: 0, c: [data[o], data[o + 1], data[o + 2]] }).n++;
    const lum = data[o] + data[o + 1] + data[o + 2]; if (lum < inkLum) { inkLum = lum; ink = [data[o], data[o + 1], data[o + 2]]; }
  }
  let best = null, bn = 0; for (const k2 in counts) if (counts[k2].n > bn) { bn = counts[k2].n; best = counts[k2].c; }
  return { bg: best ? `rgb(${best[0]},${best[1]},${best[2]})` : null, ink: ink ? `rgb(${ink[0]},${ink[1]},${ink[2]})` : null };
}
async function editTextAt(pv, p) {
  if (!pv.page) return;
  // 1) Bereits editierbare Stelle getroffen → sofort tippen (kein Doppelklick, kein Auswählen)
  const existing = (getAnnos(pv.num) || []).filter(a => a.type === 'edit').find(a => p.x >= a.x - 2 && p.x <= a.x + a.w + 2 && p.y >= a.y - 2 && p.y <= a.y + a.h + 2);
  if (existing) { sel = null; drawAnnos(pv); openEditEdit(pv, existing, false, p); return; }   // kein Auswahl-Rahmen → direkt tippen, Cursor an die Klickstelle
  // 2) Absatz an der Klickstelle → abdecken + direkt editieren
  const blocks = await buildTextBlocks(pv);
  const hit = blocks.find(b => p.x >= b.x - 3 && p.x <= b.x + b.w + 3 && p.y >= b.y - 2 && p.y <= b.y + b.h + 2);
  let a;
  if (hit) {
    const s = sampleBox(pv, hit); a = { id: nextId++, type: 'edit', x: hit.x, y: hit.y, w: Math.max(hit.w, hit.size), h: hit.h, text: hit.text, size: hit.size, lh: hit.lh, color: s.ink || '#111111', bg: s.bg || '#ffffff', fam: hit.fam, bold: hit.bold, italic: hit.italic };
    pushUndo(); pushAnno(pv.num, a); sel = null; drawAnnos(pv); openEditEdit(pv, a, false, p);
  } else {
    a = { id: nextId++, type: 'edit', x: p.x, y: p.y - style.size * 0.82, w: 140, h: style.size * 1.3, text: '', size: style.size, lh: style.size * 1.3, color: style.color, bg: 'transparent' };
    pushUndo(); pushAnno(pv.num, a); sel = null; drawAnnos(pv); openEditEdit(pv, a, true);   // leere Stelle: direkt tippen
  }
}
// Ganze Seite auf einmal editierbar machen (wie Acrobat): jede erkannte Textstelle wird eine überschreibbare Edit-Stelle in passender Schrift.
let _editAllBusy = false;
async function editAllTextOnPage(pv) {
  pv = pv || pageViews.find(p => p.num === curPage()); if (!pv || !pv.page || _editAllBusy) return;
  _editAllBusy = true; status('Text wird eingelesen …'); await new Promise(r => setTimeout(r, 10));
  try {
    const blocks = await buildTextBlocks(pv);
    if (!blocks.length) { toast('Auf dieser Seite wurde kein bearbeitbarer Text erkannt (evtl. gescanntes Bild).'); return; }
    const already = new Set((getAnnos(pv.num) || []).filter(a => a.type === 'edit').map(a => Math.round(a.x) + '|' + Math.round(a.y)));
    if (blocks.length > 300 && !confirm(blocks.length + ' Absätze editierbar machen? Das kann einen Moment dauern.')) return;
    pushUndo(); let added = 0;
    for (const b of blocks) {
      if (already.has(Math.round(b.x) + '|' + Math.round(b.y))) continue;   // schon editierbar → nicht doppelt
      const s = sampleBox(pv, b);
      pushAnno(pv.num, { id: nextId++, type: 'edit', x: b.x, y: b.y, w: Math.max(b.w, b.size), h: b.h, text: b.text, size: b.size, lh: b.lh, color: s.ink || '#111111', bg: s.bg || '#ffffff', fam: b.fam, bold: b.bold, italic: b.italic });
      added++;
    }
    drawAnnos(pv); saveState();
    toast(added ? (added + ' Absätze sind editierbar – klick hinein und tippe.') : 'Alle Absätze sind bereits editierbar.');
  } catch (e) { console.error(e); toast('Text-Einlesen fehlgeschlagen.'); }
  finally { _editAllBusy = false; status(''); }
}
// „Verschieben": Original-Stelle bleibt abgedeckt (Cover), der gleiche Text wird beweglich
function splitEditMove(pv, a) {
  if (!a || a.type !== 'edit') return; const arr = getAnnos(pv.num), i = arr.indexOf(a); if (i < 0) return;
  pushUndo();
  const cover = { id: nextId++, type: 'cover', x: a.x, y: a.y, w: a.w, h: a.h, color: a.bg || '#ffffff' };
  const txt = { id: nextId++, type: 'text', x: a.x + 1, y: a.y, text: a.text, color: a.color, size: a.size };
  arr.splice(i, 1, cover, txt); sel = { num: pv.num, id: txt.id }; drawAnnos(pv); refreshComments();
  toast('Original abgedeckt – Text frei verschiebbar');
}
// Text markieren (Marker): über Text ziehen → alle berührten Textstücke werden hinterlegt
async function startHighlight(pv, e, p) {
  const items = await ensureTextItems(pv);
  pushUndo();
  const a = { id: nextId++, type: 'highlight', rects: [], color: style.color }; pushAnno(pv.num, a);
  const x0 = p.x, y0 = p.y;
  const update = (qx, qy) => {
    const rx = Math.min(x0, qx), ry = Math.min(y0, qy), rw = Math.abs(qx - x0), rh = Math.abs(qy - y0);
    a.rects = items.filter(it => it.x < rx + rw && it.x + it.w > rx && it.y < ry + rh && it.y + it.h > ry).map(it => ({ x: it.x, y: it.y, w: it.w, h: it.h }));
    a._drag = { x: rx, y: ry, w: rw, h: rh }; drawAnnos(pv);
  };
  const pts = [[p.x, p.y]];
  const move = ev => { const q = evtToPage(pv, ev); pts.push([q.x, q.y]); update(q.x, q.y); };
  const up = ev => {
    document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
    const q = evtToPage(pv, ev); update(q.x, q.y); delete a._drag;
    if (!a.rects.length) {                               // kein echter Text drunter → freier Marker-Strich
      const arr = getAnnos(pv.num); arr.splice(arr.indexOf(a), 1);
      if (pts.length >= 2) {
        const w = Math.max(10, (style.width || 2.5) * 4);
        const b = { id: nextId++, type: 'pen', hl: true, width: w, color: style.color, pts: pts.slice() };
        pushAnno(pv.num, b); sel = { num: pv.num, id: b.id }; setTool('select'); drawAnnos(pv); saveState(); return;
      }
      undoStack.pop(); drawAnnos(pv); setTool('select'); return;
    }
    sel = { num: pv.num, id: a.id }; setTool('select'); drawAnnos(pv); saveState();
  };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
}
// Cursor an die Klickstelle setzen (Zeile aus y, Zeichen aus x per Textbreiten-Messung)
function caretOffsetAt(a, val, clickPt) {
  const lh = a.lh || a.size * 1.25, lines = val.split('\n');
  const li = Math.max(0, Math.min(lines.length - 1, Math.floor((clickPt.y - a.y) / lh)));
  const xoff = Math.max(0, clickPt.x - a.x - 1), line = lines[li];
  const ctx = caretOffsetAt._c || (caretOffsetAt._c = document.createElement('canvas').getContext('2d'));
  ctx.font = (a.italic ? 'italic ' : '') + (a.bold ? '700 ' : '') + a.size + 'px ' + cssFontStack(a.fam);
  let ci = line.length;
  for (let k = 1; k <= line.length; k++) { const w = ctx.measureText(line.slice(0, k)).width, wp = ctx.measureText(line.slice(0, k - 1)).width; if ((w + wp) / 2 >= xoff) { ci = k - 1; break; } }
  let off = 0; for (let i = 0; i < li; i++) off += lines[i].length + 1; return off + ci;
}
function openEditEdit(pv, a, isNew, clickPt) {
  const sc = pv.scale, lh = a.lh || a.size * 1.25;
  _editingId = a.id; drawAnnos(pv);   // Text der Stelle ausblenden (nur Abdeckung bleibt) → keine Doppel-Anzeige
  const ta = document.createElement('textarea'); ta.className = 'textedit'; ta.value = a.text || '';
  ta.style.left = (a.x * sc) + 'px'; ta.style.top = (a.y * sc) + 'px';
  ta.style.fontSize = (a.size * sc) + 'px'; ta.style.lineHeight = (lh * sc) + 'px';
  ta.style.color = a.color; ta.style.background = 'transparent';   // die Abdeckung darunter liefert den Hintergrund
  ta.style.width = Math.max(60, a.w * sc + 10) + 'px';
  ta.style.fontFamily = cssFontStack(a.fam); if (a.bold) ta.style.fontWeight = 'bold'; if (a.italic) ta.style.fontStyle = 'italic';
  pv.inner.appendChild(ta);
  const autoH = () => { ta.style.height = 'auto'; ta.style.height = Math.max(a.h * sc, ta.scrollHeight) + 'px'; };
  autoH(); ta.focus();
  if (isNew) ta.select();
  else if (clickPt) { try { const o = caretOffsetAt(a, ta.value, clickPt); ta.setSelectionRange(o, o); } catch (_) { } }   // Cursor an die Klickstelle
  const orig = a.text || '', multiline = orig.indexOf('\n') >= 0 || a.h > a.size * 1.9;   // Absatz vs. Einzeiler
  let done = false, cancelled = false;
  const finish = () => {
    if (done) return; done = true; _editingId = null; ta.remove();
    if (cancelled) { a.text = orig; if (isNew) { const arr = getAnnos(pv.num), i = arr.indexOf(a); if (i >= 0) arr.splice(i, 1); } }   // Esc → Änderung verwerfen
    else { a.text = ta.value.replace(/[ \t]+$/, ''); if (!a.text.trim() && isNew) { const arr = getAnnos(pv.num), i = arr.indexOf(a); if (i >= 0) arr.splice(i, 1); } }
    drawAnnos(pv); saveState();
  };
  ta.addEventListener('blur', finish);
  ta.addEventListener('keydown', ev => {   // Esc = verwerfen · Tab = nächster Absatz · Einzeiler: Enter = fertig · Absatz: Enter = neue Zeile, Strg+Enter = fertig
    if (ev.key === 'Escape') { ev.preventDefault(); cancelled = true; ta.blur(); }
    else if (ev.key === 'Tab') { ev.preventDefault(); const d = ev.shiftKey ? -1 : 1; ta.blur(); editNextBlock(pv, a, d); }
    else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey || (!ev.shiftKey && !multiline))) { ev.preventDefault(); ta.blur(); }
  });
  ta.addEventListener('input', autoH);
}
// Tab/Shift+Tab im Bearbeiten-Modus → nächsten/vorigen Absatz öffnen (Lesereihenfolge)
function editNextBlock(pv, curA, dir) {
  const blocks = pv.textBlocks; if (!blocks || !blocks.length) return;
  const sorted = blocks.slice().sort((p, q) => p.y - q.y || p.x - q.x);
  const idx = sorted.findIndex(b => Math.abs(b.x - curA.x) < 4 && Math.abs(b.y - curA.y) < 4);
  const ni = (idx < 0 ? 0 : idx + dir); if (ni < 0 || ni >= sorted.length) return;
  const nb = sorted[ni];
  setTimeout(() => {
    const ex = (getAnnos(pv.num) || []).filter(x => x.type === 'edit').find(x => Math.abs(x.x - nb.x) < 4 && Math.abs(x.y - nb.y) < 4);
    if (ex) { openEditEdit(pv, ex, false); return; }
    const s = sampleBox(pv, nb), a2 = { id: nextId++, type: 'edit', x: nb.x, y: nb.y, w: Math.max(nb.w, nb.size), h: nb.h, text: nb.text, size: nb.size, lh: nb.lh, color: s.ink || '#111111', bg: s.bg || '#ffffff', fam: nb.fam, bold: nb.bold, italic: nb.italic };
    pushUndo(); pushAnno(pv.num, a2); openEditEdit(pv, a2, false);
  }, 0);
}
// Bestehende Text-Box bearbeiten (öffnet den Box-Editor mit Format-Leiste)
function openTextAnnoEdit(pv, a) { openTextBox(pv, a, false); }
function openNoteEdit(pv, a) {
  const sc = pv.scale; const ta = document.createElement('textarea'); ta.className = 'textedit'; ta.value = a.text || '';
  ta.style.left = (a.x * sc + 16) + 'px'; ta.style.top = (a.y * sc) + 'px'; ta.style.width = '180px'; ta.style.height = '70px'; ta.style.fontSize = '13px'; ta.placeholder = 'Kommentar …';
  pv.inner.appendChild(ta); ta.focus();
  const commit = () => { a.text = ta.value.trim(); ta.remove(); if (!a.text) { const arr = getAnnos(pv.num); const i = arr.indexOf(a); if (i >= 0) arr.splice(i, 1); } drawAnnos(pv); saveState(); refreshComments(); };
  ta.addEventListener('blur', commit);
  ta.addEventListener('keydown', ev => { if (ev.key === 'Escape') ta.blur(); });
}

/* ---------- Kommentare rechts ---------- */
function refreshComments() {
  const list = $('#commList'); if (!list) return; list.innerHTML = '';
  const items = [];
  for (const n of Object.keys(annos)) for (const a of annos[n]) if (a.type === 'note' && a.text) items.push({ n: +n, a });
  if (!items.length) { list.innerHTML = '<div class="comm-empty"><svg viewBox="0 0 24 24" class="es-ico"><path d="M4 5h16v11H9l-4 4v-4H4z"/></svg><div class="es-t">Noch keine Kommentare</div><div class="es-s">Wähle das Werkzeug <b>Kommentar</b> und klicke in den Plan, um eine Notiz zu setzen.</div></div>'; return; }
  items.sort((x, y) => x.n - y.n);
  for (const it of items) { const d = document.createElement('div'); d.className = 'comm-item'; d.innerHTML = `<div class="ci-pg">Seite ${it.n}</div><div class="ci-tx"></div>`; d.querySelector('.ci-tx').textContent = it.a.text; d.onclick = () => { gotoPage(it.n); sel = { num: it.n, id: it.a.id }; const pv = pageViews.find(p => p.num === it.n); if (pv) drawAnnos(pv); }; list.appendChild(d); }
}

/* ---------- Drehen ---------- */
function rotatePage(deg) {
  if (!pdfDoc) return; const n = curPage(); pushUndo(); pageRot[n] = (((pageRot[n] || 0) + deg) % 360 + 360) % 360;
  const pv = pageViews.find(p => p.num === n); if (pv) layoutPv(pv);   // reine CSS-Drehung, kein Neu-Render
  refreshThumb(n); updatePageInd(); scheduleSharpen();
}
// Freies Drehen (nur Ansicht, live per CSS – kein Re-Render): Plan nach Norden ausrichten
function applyViewRot(pv) {
  const rot = (pageRot[pv.num] || 0) + (viewRot[pv.num] || 0), rad = rot * Math.PI / 180;
  const bw = Math.abs(pv.dispW * Math.cos(rad)) + Math.abs(pv.dispH * Math.sin(rad)), bh = Math.abs(pv.dispW * Math.sin(rad)) + Math.abs(pv.dispH * Math.cos(rad));
  pv.wrap.style.width = bw + 'px'; pv.wrap.style.height = bh + 'px';
  if (rot % 360 === 0) { pv.inner.style.left = '0'; pv.inner.style.top = '0'; pv.inner.style.transform = 'none'; }
  else { pv.inner.style.left = '50%'; pv.inner.style.top = '50%'; pv.inner.style.transform = `translate(-50%,-50%) rotate(${rot}deg)`; }
}
function setFreeRot(deg) {
  const n = curPage(); viewRot[n] = deg; const pv = pageViews.find(p => p.num === n); if (pv) { dropTile(pv); applyViewRot(pv); }
  $('#freeRotVal').textContent = (deg > 0 ? '+' : '') + deg + '°';
  scheduleSharpen();
}

/* ---------- Seiten verwalten (löschen / umsortieren / anhängen) ---------- */
// Dokument neu aufbauen in der Reihenfolge `order` (1-basierte Originalseiten). Drehung wird einbezogen, Anmerkungen umnummeriert.
async function applyPageOrder(order) {
  if (!curBytes) return; pushDocUndo(); status('Seiten werden neu angeordnet …');   // rückgängig-fähig
  try {
    const lib = await loadPdfLib();
    const src = await lib.PDFDocument.load(curBytes.slice(), { ignoreEncryption: true });
    const out = await lib.PDFDocument.create();
    const pages = await out.copyPages(src, order.map(n => n - 1));
    pages.forEach((p, i) => { const rot = pageRot[order[i]] || 0; if (rot) p.setRotation(lib.degrees(rot)); out.addPage(p); });
    const newAnnos = {}; order.forEach((oldN, i) => { if (annos[oldN]) newAnnos[i + 1] = annos[oldN]; });
    annos = newAnnos; pageRot = {}; viewRot = {}; sel = null;   // Drehung ist jetzt in den Seiten gebacken
    curBytes = new Uint8Array(await out.save());
    await loadDoc(curBytes.slice());
  } catch (e) { status(''); console.error(e); undoStack.pop(); toast('Konnte Seiten nicht ändern.'); }
}
function deletePage(n) {
  if (!pdfDoc || pdfDoc.numPages <= 1) { toast('Die letzte Seite kann nicht gelöscht werden.'); return; }
  if (!confirm(`Seite ${n} löschen?`)) return;
  const order = []; for (let i = 1; i <= pdfDoc.numPages; i++) if (i !== n) order.push(i);
  applyPageOrder(order);
}
function movePage(n, dir) {     // dir: -1 hoch, +1 runter
  if (!pdfDoc) return; const j = n + dir; if (j < 1 || j > pdfDoc.numPages) return;
  const order = []; for (let i = 1; i <= pdfDoc.numPages; i++) order.push(i);
  [order[n - 1], order[j - 1]] = [order[j - 1], order[n - 1]];
  applyPageOrder(order);
}
// Zeichnung einer Seite als echte Vektor-SVG exportieren (Logo/Grafik – skalierbar)
function exportSVG(n) {
  const pv = pageViews.find(p => p.num === n); if (!pv) { toast('Seite kurz sichtbar machen, dann erneut.'); return; }
  const list = (getAnnos(n) || []).filter(a => a.type !== 'crop' && a.type !== 'snip' && a.type !== 'imgph');
  if (!list.length) { toast('Nichts zum Exportieren – erst etwas zeichnen.'); return; }
  sel = null; groupSel = null; drawAnnos(pv);                      // Auswahl/Anfasser weg, damit sie nicht mitexportiert werden
  const src = pv.svg.cloneNode(true);
  src.querySelectorAll('.snap-guide, .hover-layer, .handle, [data-h]').forEach(e => e.remove());
  src.querySelectorAll('rect[fill="transparent"], polygon[fill="transparent"]').forEach(e => e.remove());
  src.querySelectorAll('text').forEach(t => { if (!t.getAttribute('dominant-baseline')) t.setAttribute('dominant-baseline', 'hanging'); if (!t.getAttribute('font-family')) t.setAttribute('font-family', 'Arial, Helvetica, sans-serif'); });
  // eng auf die Zeichnung zuschneiden
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
  for (const a of list) { const b = bbox(a); if (!b || !isFinite(b.x)) continue; mnx = Math.min(mnx, b.x); mny = Math.min(mny, b.y); mxx = Math.max(mxx, b.x + b.w); mxy = Math.max(mxy, b.y + b.h); }
  const pad = 10; let vb, W, H;
  if (isFinite(mnx)) { mnx -= pad; mny -= pad; W = (mxx - mnx) + pad; H = (mxy - mny) + pad; vb = `${mnx} ${mny} ${W} ${H}`; } else { W = pv.pageW; H = pv.pageH; vb = `0 0 ${W} ${H}`; }
  src.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); src.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  src.setAttribute('viewBox', vb); src.setAttribute('width', Math.round(W)); src.setAttribute('height', Math.round(H));
  src.removeAttribute('class'); src.removeAttribute('style'); src.removeAttribute('preserveAspectRatio');
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(src);
  const blob = new Blob([xml], { type: 'image/svg+xml' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = docName.replace(/\.pdf$/i, '') + '_Seite-' + n + '.svg'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1500);
  toast('Als SVG gespeichert ✓ (skalierbarer Vektor)');
}
// Eine Seite (inkl. Anmerkungen) als PNG-Bild exportieren (scharf gerendert)
async function exportPagePng(n) {
  if (!curBytes) return; status('Bild wird erzeugt …'); await new Promise(r => setTimeout(r, 10));
  try {
    const bytes = await buildPdfBytes(); await loadPdfJs();
    const doc = await pdfjs.getDocument({ data: bytes }).promise;
    const page = await doc.getPage(n), w0 = page.getViewport({ scale: 1 }).width;
    const vp = page.getViewport({ scale: Math.max(1, Math.min(3, 2000 / w0)) });
    const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise; doc.destroy();
    cv.toBlob(blob => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = docName.replace(/\.pdf$/i, '') + '_Seite-' + n + '.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1500); status(''); toast('Seite als PNG gespeichert ✓'); }, 'image/png');
  } catch (e) { status(''); console.error(e); toast('Bild-Export fehlgeschlagen.'); }
}
// Eine Seite (inkl. Anmerkungen) als neue PDF speichern
async function extractPage(n) {
  if (!curBytes) return; status('Seite wird extrahiert …');
  try {
    const full = await buildPdfBytes();                 // ganzes Dokument MIT Anmerkungen
    const lib = await loadPdfLib();
    const src = await lib.PDFDocument.load(full, { ignoreEncryption: true });
    const out = await lib.PDFDocument.create();
    const [p] = await out.copyPages(src, [n - 1]); out.addPage(p);
    const bytes = new Uint8Array(await out.save());
    status('');
    downloadBytes(bytes, docName.replace(/\.pdf$/i, '') + '_Seite-' + n + '.pdf');
    toast('Seite ' + n + ' als neue PDF gespeichert ✓');
  } catch (e) { status(''); console.error(e); toast('Extrahieren fehlgeschlagen.'); }
}
// Weitere PDF(s)/Bilder ans Dokument anhängen
async function appendFiles(files) {
  if (!curBytes) return openFiles(files);
  files = [...files]; pushDocUndo(); status('Seiten werden angehängt …');   // rückgängig-fähig
  try {
    const lib = await loadPdfLib();
    const out = await lib.PDFDocument.load(curBytes.slice(), { ignoreEncryption: true });
    for (const f of files) {
      let bytes;
      if (isImg(f)) { bytes = await imageToPdf(f); }   // Bild → 1-seitige PDF (nebenwirkungsfrei)
      else if (/pdf$/i.test(f.name) || f.type === 'application/pdf') { bytes = new Uint8Array(await f.arrayBuffer()); }
      else continue;
      const add = await lib.PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = await out.copyPages(add, add.getPageIndices());
      pages.forEach(p => out.addPage(p));
    }
    curBytes = new Uint8Array(await out.save());   // bestehende Anmerkungen behalten ihre Seitennummern (neue Seiten hinten dran)
    await loadDoc(curBytes.slice());
    toast('Seiten angehängt ✓');
  } catch (e) { status(''); console.error(e); undoStack.pop(); toast('Anhängen fehlgeschlagen.'); }
}

// Seiten-Maps nach einem Einfügen verschieben (Seiten ab insertPageNum um count nach hinten)
function remapAfterInsert(insertPageNum, count) {
  const shift = obj => { const o = {}; for (const k in obj) { const n = +k; o[n >= insertPageNum ? n + count : n] = obj[k]; } return o; };
  annos = shift(annos); pageRot = shift(pageRot); viewRot = shift(viewRot); sel = null;
}
// Vorlagen-Inhalt (Folien-Layouts) als Annotationen für eine Seite der Grösse w×h
let logoDataUrl = null;   // Logo als data-URL (für den Plankopf), einmal vorgeladen
let planGrpSeq = 0;       // Gruppen-Zähler: jeder eingefügte Plankopf/Rahmen ist eine verschiebbare Gruppe
function loadLogoData() { try { fetch('icon.png').then(r => r.blob()).then(b => { const fr = new FileReader(); fr.onload = () => { logoDataUrl = fr.result; }; fr.readAsDataURL(b); }).catch(() => { }); } catch (_) { } }
function todayStr() { const d = new Date(), p = n => ('0' + n).slice(-2); return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear(); }
function fillPlanField(field, value) {   // Plankopf-Feld (z. B. Massstab) automatisch eintragen
  let changed = false;
  for (const n in annos) for (const a of (annos[n] || [])) if (a.type === 'text' && a.field === field && !a.text) { a.text = value; changed = true; }
  if (changed) pageViews.forEach(drawAnnos);
}
function templateAnnos(kind, w, h) {
  const dark = '#1c242c', gray = '#8a8f86';
  const mk = o => Object.assign({ type: 'text', size: 16, color: dark, align: 'left', bg: 'transparent', border: null, borderW: 1.2 }, o);
  if (kind === 'title') return [
    mk({ x: w * 0.1, y: h * 0.38, w: w * 0.8, h: h * 0.12, text: 'Titel', size: Math.round(h * 0.07), align: 'center' }),
    mk({ x: w * 0.15, y: h * 0.52, w: w * 0.7, h: h * 0.06, text: 'Untertitel', size: Math.round(h * 0.032), align: 'center', color: gray })
  ];
  if (kind === 'titlecontent') return [
    mk({ x: w * 0.07, y: h * 0.07, w: w * 0.86, h: h * 0.1, text: 'Titel', size: Math.round(h * 0.05) }),
    mk({ x: w * 0.07, y: h * 0.2, w: w * 0.86, h: h * 0.7, text: '•  Punkt 1\n•  Punkt 2\n•  Punkt 3', size: Math.round(h * 0.03) })
  ];
  if (kind === 'twocol') return [
    mk({ x: w * 0.07, y: h * 0.07, w: w * 0.86, h: h * 0.1, text: 'Titel', size: Math.round(h * 0.05) }),
    mk({ x: w * 0.07, y: h * 0.22, w: w * 0.42, h: h * 0.66, text: '•  Punkt\n•  Punkt', size: Math.round(h * 0.028) }),
    mk({ x: w * 0.51, y: h * 0.22, w: w * 0.42, h: h * 0.66, text: '•  Punkt\n•  Punkt', size: Math.round(h * 0.028) })
  ];
  if (kind === 'compare') return [
    mk({ x: w * 0.07, y: h * 0.07, w: w * 0.86, h: h * 0.1, text: 'Vergleich', size: Math.round(h * 0.05) }),
    { type: 'rect', x: w * 0.07, y: h * 0.24, w: w * 0.42, h: h * 0.64, color: gray, width: 1.5 },
    { type: 'rect', x: w * 0.51, y: h * 0.24, w: w * 0.42, h: h * 0.64, color: gray, width: 1.5 },
    mk({ x: w * 0.07, y: h * 0.26, w: w * 0.42, h: h * 0.06, text: 'Option A', size: Math.round(h * 0.03), align: 'center' }),
    mk({ x: w * 0.51, y: h * 0.26, w: w * 0.42, h: h * 0.06, text: 'Option B', size: Math.round(h * 0.03), align: 'center' })
  ];
  if (kind === 'image') return [
    { type: 'imgph', x: w * 0.1, y: h * 0.12, w: w * 0.8, h: h * 0.62 },
    mk({ x: w * 0.1, y: h * 0.78, w: w * 0.8, h: h * 0.05, text: 'Bildunterschrift', size: Math.round(h * 0.024), align: 'center', color: gray })
  ];
  if (kind === 'plan') {   // Rahmen + Plankopf unten rechts + Faltmarken (je nach Blattgrösse)
    const MM = 72 / 25.4, out0 = [], LK = { locked: true }, gid = 'pk' + (++planGrpSeq);
    const out = { push: (...xs) => xs.forEach(x => out0.push(Object.assign(x, x.field ? {} : LK))) };   // Rahmen/Faltmarken: Struktur gesperrt, Felder frei
    const outPk = { push: (...xs) => xs.forEach(x => out0.push(Object.assign(x, { grp: gid }, x.field ? {} : LK))) };   // Plankopf = eine verschiebbare Gruppe
    const ml = 20 * MM, mt = 8 * MM, mr = 8 * MM, mb = 8 * MM;                 // Heftrand links breiter
    const bx = ml, by = mt, bw = w - ml - mr, bh = h - mt - mb;
    out.push({ type: 'rect', x: bx, y: by, w: bw, h: bh, color: dark, width: 1.6, fill: 'none' });   // Rahmen (fix)
    const kw = Math.min(185 * MM, bw * 0.5), kh = Math.min(58 * MM, bh * 0.45), kx = bx + bw - kw, ky = by + bh - kh;
    outPk.push({ type: 'rect', x: kx, y: ky, w: kw, h: kh, color: dark, width: 1.2, fill: '#ffffff' });   // Plankopf-Box
    const rows = 4, rh = kh / rows, cx = kx + kw * 0.6, pad = 2.5 * MM;
    for (let r = 1; r < rows; r++) outPk.push({ type: 'line', x1: kx, y1: ky + rh * r, x2: kx + kw, y2: ky + rh * r, color: dark, width: 0.6 });
    outPk.push({ type: 'line', x1: cx, y1: ky, x2: cx, y2: ky + rh * 3, color: dark, width: 0.6 });
    const cell = (x, y, wc, label, value, field) => {                       // Label oben + ausfüllbarer Wert darunter
      outPk.push(mk({ x: x + pad, y: y + pad * 0.5, w: wc, h: rh * 0.4, text: label, size: 7, color: gray }));
      outPk.push(mk(Object.assign({ x: x + pad, y: y + rh * 0.42, w: wc, h: rh * 0.55, text: value || '', size: 9, color: dark }, field ? { field } : {})));
    };
    const lw = kw * 0.6 - 2 * pad, rw = kw * 0.4 - 2 * pad;
    cell(kx, ky, lw, 'Projekt', '', 'projekt'); cell(kx, ky + rh, lw, 'Plan', '', 'plan'); cell(kx, ky + 2 * rh, lw, 'Gezeichnet', '', 'gezeichnet');
    cell(cx, ky, rw, 'Massstab', docScale ? docScale.label : '', 'scale'); cell(cx, ky + rh, rw, 'Datum', todayStr(), 'date'); cell(cx, ky + 2 * rh, rw, 'Plan-Nr.', '', 'plannr');
    const logoSz = rh * 0.82, lox = logoDataUrl ? logoSz + pad : 0;             // Logo links im Fuss
    if (logoDataUrl) outPk.push({ type: 'img', data: logoDataUrl, x: kx + pad, y: ky + 3 * rh + (rh - logoSz) / 2, w: logoSz, h: logoSz });
    outPk.push(mk({ x: kx + pad + lox, y: ky + 3 * rh + pad, w: kw - 2 * pad - lox, h: rh, text: 'Submit PDF', size: 11, color: dark, field: 'firma' }));
    const A4w = 210 * MM, A4h = 297 * MM, tk = 5 * MM;                          // Faltmarken (DIN-824-artig, in A4-Spalten)
    for (let x = w - A4w; x > ml * 0.5; x -= A4w) { out.push({ type: 'line', x1: x, y1: 0, x2: x, y2: tk, color: gray, width: 0.6 }); out.push({ type: 'line', x1: x, y1: h - tk, x2: x, y2: h, color: gray, width: 0.6 }); }
    for (let y = h - A4h; y > mt * 0.5; y -= A4h) { out.push({ type: 'line', x1: 0, y1: y, x2: tk, y2: y, color: gray, width: 0.6 }); out.push({ type: 'line', x1: w - tk, y1: y, x2: w, y2: y, color: gray, width: 0.6 }); }
    return out0;
  }
  return [];
}
function buildPlanParts(w, h, opts) {   // frei konfigurierbarer Plankopf / Rahmen / Kantenlinie (für vorhandene Seiten)
  const MM = 72 / 25.4, color = opts.color || '#1c242c', gray = '#8a8f86', bw = +opts.bw || 1.2, LK = { locked: true }, gid = 'pk' + (++planGrpSeq);
  const margin = (opts.margin != null ? +opts.margin : 8) * MM, out = [];
  const push = o => out.push(Object.assign(o, { grp: gid }, o.field ? {} : LK));   // alle Teile = eine verschiebbare Gruppe (Felder bleiben editierbar)
  const mk = o => Object.assign({ type: 'text', size: 16, color, align: 'left', bg: 'transparent', border: null, borderW: 1.2 }, o);
  if (opts.kind === 'rahmen') { push({ type: 'rect', x: margin, y: margin, w: w - 2 * margin, h: h - 2 * margin, color, width: bw, fill: 'none' }); return out; }
  if (opts.kind === 'linie') {
    const e = opts.edge || 'left';
    if (e === 'left') push({ type: 'line', x1: margin, y1: margin, x2: margin, y2: h - margin, color, width: bw });
    else if (e === 'right') push({ type: 'line', x1: w - margin, y1: margin, x2: w - margin, y2: h - margin, color, width: bw });
    else if (e === 'top') push({ type: 'line', x1: margin, y1: margin, x2: w - margin, y2: margin, color, width: bw });
    else push({ type: 'line', x1: margin, y1: h - margin, x2: w - margin, y2: h - margin, color, width: bw });
    return out;
  }
  if (opts.kind === 'mstab') {   // grafischer Massstabsbalken (an den realen Massstab gekoppelt)
    if (!docScale) { toast('Für den Massstabsbalken zuerst den Massstab setzen (1:n).'); return out; }
    const nice = [0.25, 0.5, 1, 2, 5, 10, 20, 50, 100], u0 = ptsToCm(58) / 100; let unit = nice[0];
    for (const u of nice) if (Math.abs(u - u0) < Math.abs(unit - u0)) unit = u;
    const segPt = cmToPts(unit * 100), nSeg = 4, barH = 2.6 * MM, x0 = margin + 2 * MM, y0 = h - margin - 9 * MM;
    push({ type: 'rect', x: x0, y: y0, w: segPt * nSeg, h: barH, color, width: 0.8, fill: '#ffffff' });
    for (let i = 0; i < nSeg; i += 2) push({ type: 'rect', x: x0 + i * segPt, y: y0, w: segPt, h: barH, color, width: 0, fill: color });
    for (let i = 0; i <= nSeg; i++) { push({ type: 'line', x1: x0 + i * segPt, y1: y0 - 1 * MM, x2: x0 + i * segPt, y2: y0 + barH, color, width: 0.6 }); push(mk({ type: 'text', x: x0 + i * segPt - 6 * MM, y: y0 + barH + 0.8 * MM, w: 12 * MM, h: 4 * MM, text: ('' + +(i * unit).toFixed(2)).replace('.', ',') + (i === nSeg ? ' m' : ''), size: 7, align: 'center', color: gray })); }
    push(mk({ type: 'text', x: x0, y: y0 - 5.5 * MM, w: 40 * MM, h: 4 * MM, text: 'Massstab ' + (docScale.label || ''), size: 8, color }));
    return out;
  }
  if (opts.kind === 'nord') {   // Nordpfeil (Norden oben), oben rechts
    const r = 8.5 * MM, cxp = w - margin - r - 2 * MM, cyp = margin + r + 7 * MM;
    push({ type: 'oval', x: cxp - r, y: cyp - r, w: 2 * r, h: 2 * r, color, width: 1, fill: 'none' });
    push({ type: 'arrow', x1: cxp, y1: cyp + r * 0.62, x2: cxp, y2: cyp - r * 0.62, color, width: 1.6 });
    push(mk({ type: 'text', x: cxp - 4 * MM, y: cyp - r - 5.5 * MM, w: 8 * MM, h: 5 * MM, text: 'N', size: 12, align: 'center', color }));
    return out;
  }
  const kw = Math.min(185 * MM, (w - 2 * margin) * 0.6), kh = Math.min(58 * MM, (h - 2 * margin) * 0.5);
  const pos = opts.pos || 'br', vc = pos[0], hc = pos[1];
  const kx = hc === 'l' ? margin : hc === 'c' ? (w - kw) / 2 : w - margin - kw;
  const ky = vc === 't' ? margin : vc === 'm' ? (h - kh) / 2 : h - margin - kh;
  if (opts.frame !== false) push({ type: 'rect', x: kx, y: ky, w: kw, h: kh, color, width: bw, fill: '#ffffff' });
  const rows = 4, rh = kh / rows, cx = kx + kw * 0.6, pad = 2.5 * MM;
  for (let r = 1; r < rows; r++) push({ type: 'line', x1: kx, y1: ky + rh * r, x2: kx + kw, y2: ky + rh * r, color, width: 0.6 });
  push({ type: 'line', x1: cx, y1: ky, x2: cx, y2: ky + rh * 3, color, width: 0.6 });
  const cell = (x, y, wc, label, value, field) => { push(mk({ x: x + pad, y: y + pad * 0.5, w: wc, h: rh * 0.4, text: label, size: 7, color: gray })); push(mk(Object.assign({ x: x + pad, y: y + rh * 0.42, w: wc, h: rh * 0.55, text: value || '', size: 9, color }, field ? { field } : {}))); };
  const lw = kw * 0.6 - 2 * pad, rw = kw * 0.4 - 2 * pad, f = opts.fields || {};
  cell(kx, ky, lw, 'Projekt', f.projekt, 'projekt'); cell(kx, ky + rh, lw, 'Plan', '', 'plan'); cell(kx, ky + 2 * rh, lw, 'Gezeichnet', f.gezeichnet, 'gezeichnet');
  cell(cx, ky, rw, 'Massstab', docScale ? docScale.label : '', 'scale'); cell(cx, ky + rh, rw, 'Datum', todayStr(), 'date'); cell(cx, ky + 2 * rh, rw, 'Plan-Nr.', f.plannr, 'plannr');
  const logoSz = rh * 0.82, lox = logoDataUrl ? logoSz + pad : 0;
  if (logoDataUrl) push({ type: 'img', data: logoDataUrl, x: kx + pad, y: ky + 3 * rh + (rh - logoSz) / 2, w: logoSz, h: logoSz });
  push(mk({ x: kx + pad + lox, y: ky + 3 * rh + pad, w: kw - 2 * pad - lox, h: rh, text: f.firma || 'Submit PDF', size: 11, color, field: 'firma' }));
  return out;
}
function insertPlanParts(opts) {
  const n = curPage(), pv = pageViews.find(p => p.num === n); if (!pv) { toast('Keine Seite offen.'); return; }
  pushUndo();
  const gid = 'pk' + nextId, optClone = JSON.parse(JSON.stringify(opts));   // Gruppe + Bauplan-Optionen merken → beim Formatwechsel neu aufbauen
  const parts = buildPlanParts(pv.pageW || 595, pv.pageH || 842, opts).map(a => Object.assign(a, { id: nextId++, layer: activeLayerId, pkGid: gid, pkOpts: optClone }));
  const arr = getAnnos(n); for (const a of parts) arr.push(a);
  drawAnnos(pv); saveState(); toast(opts.kind === 'kopf' ? 'Plankopf eingefügt ✓ (passt sich dem Blattformat an · gesperrt)' : 'Element eingefügt ✓ (passt sich dem Blattformat an)');
}
function reflowPlanGroups(n, w, h) {   // Plankopf/Rahmen/Linie an neues Blattformat (w,h) anpassen, Feldwerte erhalten
  const arr = getAnnos(n); if (!arr || !arr.length) return; const groups = {};
  for (const a of arr) if (a.pkGid) (groups[a.pkGid] = groups[a.pkGid] || []).push(a);
  for (const gid of Object.keys(groups)) {
    const parts = groups[gid]; let opts = null; for (const p of parts) if (p.pkOpts) { opts = JSON.parse(JSON.stringify(p.pkOpts)); break; }
    if (!opts) continue;
    const vals = {}; for (const p of parts) if (p.field) vals[p.field] = p.text;   // aktuelle Feldinhalte sichern
    opts.fields = Object.assign({}, opts.fields, vals);
    const layer = parts[0].layer, fresh = buildPlanParts(w, h, opts).map(a => Object.assign(a, { id: nextId++, layer, pkGid: gid, pkOpts: opts }));
    for (const fp of fresh) if (fp.field && vals[fp.field] != null) fp.text = vals[fp.field];   // Werte zurückschreiben
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i].pkGid === gid) arr.splice(i, 1);
    for (const fp of fresh) arr.push(fp);
  }
}
function paintBg(lib, pg, w, h, bg) { if (!bg || bg === '#ffffff') return; const c = hexToRgb(bg); pg.drawRectangle({ x: 0, y: 0, width: w, height: h, color: lib.rgb(c.r, c.g, c.b) }); }
// Seite nach `after` einfügen (after=0 → ganz oben). size optional {w,h} (sonst Nachbarseite), tmpl = Vorlage, bg = Hintergrund.
async function insertBlankPage(after, size, tmpl, bg) {
  if (!curBytes) return; pushDocUndo(); status('Seite wird eingefügt …');
  try {
    const lib = await loadPdfLib();
    const out = await lib.PDFDocument.load(curBytes.slice(), { ignoreEncryption: true });
    let w, h;
    if (size) { w = size.w; h = size.h; } else { const pgs = out.getPages(); const ref = pgs[Math.max(0, Math.min(pgs.length - 1, after - 1))]; const s = ref ? ref.getSize() : { width: 595, height: 842 }; w = s.width; h = s.height; }
    const newPg = out.insertPage(after, [w, h]); paintBg(lib, newPg, w, h, bg);
    remapAfterInsert(after + 1, 1);
    const t = templateAnnos(tmpl || 'blank', w, h); if (t.length) annos[after + 1] = t.map(a => Object.assign(a, { id: nextId++ }));
    curBytes = new Uint8Array(await out.save()); await loadDoc(curBytes.slice());
    status(''); toast('Seite eingefügt ✓'); gotoPage(after + 1);
  } catch (e) { status(''); console.error(e); undoStack.pop(); toast('Einfügen fehlgeschlagen.'); }
}
// Seite n duplizieren (Inhalt + Anmerkungen), Kopie direkt dahinter
async function duplicatePage(n) {
  if (!curBytes) return; pushDocUndo(); status('Seite wird dupliziert …');
  try {
    const lib = await loadPdfLib();
    const out = await lib.PDFDocument.load(curBytes.slice(), { ignoreEncryption: true });
    const [copy] = await out.copyPages(out, [n - 1]);
    out.insertPage(n, copy);                              // 0-basiert: neue Seite wird Nr. n+1
    const dupAnnos = annos[n] ? JSON.parse(JSON.stringify(annos[n])) : null, dupRot = pageRot[n];
    remapAfterInsert(n + 1, 1);
    if (dupAnnos) annos[n + 1] = dupAnnos.map(a => Object.assign(a, { id: nextId++ }));
    if (dupRot) pageRot[n + 1] = dupRot;
    curBytes = new Uint8Array(await out.save()); await loadDoc(curBytes.slice());
    status(''); toast('Seite dupliziert ✓'); gotoPage(n + 1);
  } catch (e) { status(''); console.error(e); undoStack.pop(); toast('Duplizieren fehlgeschlagen.'); }
}
// PDF(s)/Bild(er) nach Seite `after` einfügen
async function insertFilesAt(after, files) {
  if (!curBytes) return; files = [...files]; pushDocUndo(); status('Seiten werden eingefügt …');
  try {
    const lib = await loadPdfLib();
    const out = await lib.PDFDocument.load(curBytes.slice(), { ignoreEncryption: true });
    let idx = after, count = 0;
    for (const f of files) {
      let bytes;
      if (isImg(f)) bytes = await imageToPdf(f);
      else if (/pdf$/i.test(f.name) || f.type === 'application/pdf') bytes = new Uint8Array(await f.arrayBuffer());
      else continue;
      const add = await lib.PDFDocument.load(bytes, { ignoreEncryption: true });
      const cps = await out.copyPages(add, add.getPageIndices());
      for (const p of cps) { out.insertPage(idx, p); idx++; count++; }
    }
    if (!count) { status(''); undoStack.pop(); return; }
    remapAfterInsert(after + 1, count);
    curBytes = new Uint8Array(await out.save()); await loadDoc(curBytes.slice());
    status(''); toast(count + ' Seite(n) eingefügt ✓'); gotoPage(after + 1);
  } catch (e) { status(''); console.error(e); undoStack.pop(); toast('Einfügen fehlgeschlagen.'); }
}
// Leeres Dokument (eine Seite, gewähltes Format + Vorlage) als neuen Tab starten
async function newBlankDoc(size, tmpl, bg) {
  const w = (size && size.w) || 595, h = (size && size.h) || 842;
  try {
    const lib = await loadPdfLib(); const d = await lib.PDFDocument.create(); const pg = d.addPage([w, h]); paintBg(lib, pg, w, h, bg);
    const bytes = new Uint8Array(await d.save()); await addDoc(bytes, 'Neue Seite.pdf', true);   // skipRestore: keine Autosave-Kollision
    if (active < 0) return;                                                       // Anlegen fehlgeschlagen → still
    const t = templateAnnos(tmpl || 'blank', w, h);
    if (t.length) { annos[1] = t.map(a => Object.assign(a, { id: nextId++ })); if (docs[active]) docs[active].annos = annos; pageViews.forEach(drawAnnos); markDirty(); }
  } catch (e) { console.error(e); status(''); toast('Konnte kein leeres Dokument anlegen.'); }
}
// Folien-/Seiten-Picker (Format + Vorlage)
let _slideCtx = null;
function openSlidePicker(mode, after) {
  _slideCtx = { mode, after };
  $('#sdTitle').textContent = mode === 'new' ? 'Leeres Dokument starten' : 'Seite / Folie einfügen';
  $('#sdOk').textContent = mode === 'new' ? 'Erstellen' : 'Einfügen';
  applySlideDefaults();
  $('#slideDlg').hidden = false; renderSlidePreview();
}
function applySlideDefaults() {
  let s; try { s = JSON.parse(localStorage.getItem('submitpdf.slide') || '{}'); } catch (_) { s = {}; }
  const setOn = (group, pred) => { const btns = [...$$('#' + group + ' button')]; const m = btns.find(pred); if (m) { btns.forEach(x => x.classList.remove('on')); m.classList.add('on'); } };
  if (s.fmt) setOn('sdFormats', b => (b.dataset.w + 'x' + b.dataset.h) === s.fmt);
  if (s.tmpl) setOn('sdLayouts', b => b.dataset.t === s.tmpl);
  if (s.bg) setOn('sdBg', b => b.dataset.bg === s.bg);
}
function renderSlidePreview() {
  const fmt = $('#sdFormats button.on') || $('#sdFormats button'), lay = $('#sdLayouts button.on') || $('#sdLayouts button');
  if (!fmt || !lay) return;
  const w = +fmt.dataset.w, h = +fmt.dataset.h, t = lay.dataset.t, sc = Math.min(150 / w, 104 / h);
  const bgB = $('#sdBg button.on') || $('#sdBg button'), bg = bgB ? bgB.dataset.bg : '#ffffff';
  const bar = (x, y, bw, bh, cls) => `<div class="pv-b ${cls || ''}" style="left:${x}%;top:${y}%;width:${bw}%;height:${bh}%"></div>`;
  let inner = '';
  if (t === 'plan') inner = bar(3, 3, 94, 94, 'pv-box') + bar(64, 76, 32, 20, 'pv-box') + bar(66, 78, 28, 4, 'pv-strong');
  else if (t === 'title') inner = bar(15, 40, 70, 12, 'pv-strong') + bar(25, 57, 50, 7);
  else if (t === 'titlecontent') inner = bar(8, 8, 75, 11, 'pv-strong') + bar(8, 28, 80, 6) + bar(8, 40, 80, 6) + bar(8, 52, 65, 6);
  else if (t === 'twocol') inner = bar(8, 8, 75, 11, 'pv-strong') + bar(8, 28, 38, 6) + bar(8, 40, 38, 6) + bar(54, 28, 38, 6) + bar(54, 40, 38, 6);
  else if (t === 'compare') inner = bar(8, 8, 75, 11, 'pv-strong') + bar(8, 26, 38, 60, 'pv-box') + bar(54, 26, 38, 60, 'pv-box');
  else if (t === 'image') inner = bar(10, 12, 80, 55, 'pv-box') + bar(20, 76, 60, 6);
  $('#sdPreview').innerHTML = `<div class="pv-page" style="width:${Math.round(w * sc)}px;height:${Math.round(h * sc)}px;background:${bg}">${inner}</div>`;
}
function slideConfirm() {
  const fmt = $('#sdFormats button.on') || $('#sdFormats button'), lay = $('#sdLayouts button.on') || $('#sdLayouts button'), bgB = $('#sdBg button.on') || $('#sdBg button');
  const size = { w: +fmt.dataset.w, h: +fmt.dataset.h }, tmpl = lay.dataset.t, bg = bgB.dataset.bg;
  try { localStorage.setItem('submitpdf.slide', JSON.stringify({ fmt: fmt.dataset.w + 'x' + fmt.dataset.h, tmpl, bg })); } catch (_) { }
  $('#slideDlg').hidden = true;
  if (_slideCtx && _slideCtx.mode === 'new') newBlankDoc(size, tmpl, bg); else insertBlankPage(_slideCtx ? _slideCtx.after : 0, size, tmpl, bg);
}
function closeInsertMenu() { const m = $('#insMenu'); if (m) { if (m._onDoc) document.removeEventListener('pointerdown', m._onDoc, true); m.remove(); } }
function showInsertMenu(after, anchor) {
  closeInsertMenu();
  const m = document.createElement('div'); m.className = 'ins-menu'; m.id = 'insMenu';
  m.innerHTML = '<button data-a="blank">＋ Leere Seite</button><button data-a="tmpl">Vorlage / Format …</button><button data-a="file">Bild / PDF …</button>';
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect(); m.style.left = (r.right + 6) + 'px'; m.style.top = Math.min(r.top, innerHeight - 120) + 'px';
  m.querySelector('[data-a="blank"]').onclick = () => { closeInsertMenu(); insertBlankPage(after); };
  m.querySelector('[data-a="tmpl"]').onclick = () => { closeInsertMenu(); openSlidePicker('insert', after); };
  m.querySelector('[data-a="file"]').onclick = () => { closeInsertMenu(); const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/pdf,.pdf,image/*'; inp.multiple = true; inp.onchange = e => insertFilesAt(after, e.target.files); inp.click(); };
  const onDoc = e => { if (!e.target.closest('#insMenu')) closeInsertMenu(); }; m._onDoc = onDoc;
  setTimeout(() => document.addEventListener('pointerdown', onDoc, true), 0);
}

/* ---------- Undo / Löschen ---------- */
function snapshot() { return JSON.stringify({ annos, pageRot, viewRot, docScale }); }
function curAnnoEntry() { return { t: 'anno', s: snapshot() }; }
function curDocEntry() { return { t: 'doc', bytes: curBytes.slice(), s: JSON.stringify({ annos, pageRot, viewRot, docScale }) }; }
function pushUndo() { undoStack.push(curAnnoEntry()); if (undoStack.length > 80) undoStack.shift(); redoStack = []; updateUndoButtons(); markDirty(); }
// Dokument-Undo (für Seiten-Operationen: Löschen/Verschieben/Anhängen) – sichert auch die PDF-Bytes
function pushDocUndo() { if (!curBytes) return; undoStack.push(curDocEntry()); if (undoStack.length > 80) undoStack.shift(); redoStack = []; updateUndoButtons(); markDirty(); }
function updateUndoButtons() { $('#btnUndo').disabled = !undoStack.length; const r = $('#btnRedo'); if (r) r.disabled = !redoStack.length; }
async function applyState(e) {
  sel = null;
  if (e.t === 'doc') { const d = JSON.parse(e.s); annos = d.annos; pageRot = d.pageRot; viewRot = d.viewRot || {}; docScale = d.docScale || null; curBytes = e.bytes; await loadDoc(curBytes.slice()); updateScaleLabel(); }
  else { const d = JSON.parse(e.s); annos = d.annos; pageRot = d.pageRot; viewRot = d.viewRot || {}; docScale = d.docScale || null; pageViews.forEach(pv => { layoutPv(pv); drawAnnos(pv); }); buildThumbs(); refreshComments(); updateScaleLabel(); scheduleSharpen(); }
}
async function undo() {
  if (!undoStack.length) return;
  const e = undoStack.pop();
  redoStack.push(e.t === 'doc' ? curDocEntry() : curAnnoEntry());   // aktuellen Zustand für Redo sichern
  await applyState(e); updateUndoButtons(); markDirty();
}
async function redo() {
  if (!redoStack.length) return;
  const e = redoStack.pop();
  undoStack.push(e.t === 'doc' ? curDocEntry() : curAnnoEntry());
  await applyState(e); updateUndoButtons(); markDirty();
}
function saveState() { if (thumbFilter) applyThumbFilter(); /* + Autosave-Hook */ }
function deleteSel() { if (!sel) return; const arr = annos[sel.num]; if (!arr) return; const i = arr.findIndex(a => a.id === sel.id); if (i < 0) return; pushUndo(); arr.splice(i, 1); sel = null; pageViews.forEach(drawAnnos); refreshComments(); }
// Ausgewählte Anmerkung mit den Pfeiltasten verschieben (Shift = grosse Schritte)
function nudgeSel(key, d) {
  if (!sel) return; const a = findAnno(sel.num, sel.id); if (!a) return; pushUndo();
  const dx = key === 'ArrowLeft' ? -d : key === 'ArrowRight' ? d : 0, dy = key === 'ArrowUp' ? -d : key === 'ArrowDown' ? d : 0;
  translateAnno(a, JSON.parse(JSON.stringify(a)), dx, dy);
  const pv = pageViews.find(p => p.num === sel.num); if (pv) drawAnnos(pv); refreshComments();
}

/* ---------- Werkzeug umschalten ---------- */
function activateRibTab(t) { $$('.rib-tab').forEach(x => x.classList.toggle('on', x.dataset.tab === t)); $$('.rib-tools').forEach(g => g.hidden = g.dataset.tabgroup !== t); }
let _scaleAfter = null;   // Werkzeug, zu dem nach dem Massstab-Setzen zurückgekehrt wird
// „Ansehen"-Modus: nur betrachten/scrollen/Text markieren – schützt vor versehentlichen Änderungen (z. B. PDF zum Weitergeben). Standard = Bearbeiten.
function setViewOnly(on) {
  viewOnly = !!on;
  document.body.classList.toggle('view-only', viewOnly);
  const b = $('#btnView'); if (b) { b.classList.toggle('on', viewOnly); b.title = viewOnly ? 'Ansehen-Modus AN – hier klicken zum Bearbeiten' : 'Ansehen-Modus: nur betrachten, keine Änderungen'; }
  if (viewOnly && tool !== 'select' && tool !== 'textsel') setTool('select');
  toast(viewOnly ? '👁 Ansehen-Modus – keine Änderungen möglich' : '✎ Bearbeiten-Modus');
}
function setTool(t) {
  if (cropping && t !== 'select' && t !== 'crop') removeCropAnno();   // anderes Werkzeug → Zuschneiden verwerfen
  if (snipping && t !== 'select' && t !== 'snip') removeSnipAnno();   // anderes Werkzeug → Ausschnitt verwerfen
  if (areaDraft && t !== 'area' && t !== 'slab' && t !== 'terrain' && t !== 'floortile' && t !== 'aussparung') cancelArea();        // anderes Werkzeug → Flächen-/Decken-/Gelände-/Belag-/Aussparungs-Polygon verwerfen
  if (profDraft && t !== 'profile') finishProfile();                  // anderes Werkzeug → Profil-Pfad abschliessen
  if (penDraft && t !== 'curve') finishCurve();                      // anderes Werkzeug → Kurve abschliessen
  if (segDraft) cancelSegDraft();                                    // anderes Werkzeug → laufende Linie verwerfen
  if (wallDraft && t !== 'wallchain') finishWallChain();            // anderes Werkzeug → Wand-Kette beenden
  if (cdimDraft && t !== 'chaindim' && t !== 'anschluss') finishChaindim();              // anderes Werkzeug → Kettenmass/Anschluss beenden
  tool = t; $$('.tool[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t)); applyToolCursor();
  const ab = $('.tool.on[data-tool]'); if (ab && !$('.plan-rail [data-tool="' + t + '"]')) { const grp = ab.closest('.rib-tools'); if (grp && grp.hidden) activateRibTab(grp.dataset.tabgroup); }   // Reiter des aktiven Werkzeugs zeigen – aber NICHT umschalten, wenn das Werkzeug in der linken Planungs-Spalte liegt (sonst doppelte Tools oben)
  const bs = $('#btnStamp'); if (bs) bs.classList.toggle('on', t === 'stamp');
  const bb = $('#btnBlock'); if (bb) bb.classList.toggle('on', t === 'block');
  const bpf = $('#btnProfile'); if (bpf) bpf.classList.toggle('on', t === 'profile');
  $$('.fab-b').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  pageViews.forEach(p => { p._hoverId = null; const h = p.svg && p.svg.querySelector('.hover-layer'); if (h) h.remove(); });   // Hover bei Werkzeugwechsel löschen
  $('#pages').classList.toggle('mode-text', t === 'textsel');   // Text-Auswahl-Modus
  { const eb = $('#editBar'); if (eb) eb.hidden = (t !== 'edittext'); }   // „Text bearbeiten"-Leiste (ganze Seite editierbar)
  if (t === 'edittext') buildBlocksVisible(); else pageViews.forEach(pv => setEditHover(pv, null));   // Absätze für Hover bereitstellen / Hover entfernen
  if (t === 'textsel') buildTextVisible();
  if (t === 'measure' && !docScale && !setTool._measHint) { setTool._measHint = true; toast('Tipp: Für echte Masse zuerst den Massstab setzen (1:n).'); }
  if (t === 'curve' && !setTool._curveHint) { setTool._curveHint = true; toast('Kurve: Klick = Ecke (gerade) · Klick+Ziehen = Kurve · Enter/Doppelklick = fertig · Esc = abbrechen'); }
  if (['pen', 'line', 'arrow', 'rect', 'oval', 'arc'].includes(t) && !setTool._drawHint) { setTool._drawHint = true; toast('Werkzeug bleibt aktiv – einfach weiterzeichnen. V oder Esc = auswählen/bearbeiten.'); }
  if ((t === 'opening' || t === 'window') && !setTool._openHint) { setTool._openHint = true; toast('Tür/Fenster: auf eine Wand klicken → wird eingesetzt. Oben in der Planungs-Leiste: Breite, Brüstung/Höhe, Anschlag – wirken in 2D und 3D.'); }
  if (t === 'block' && !setTool._blockHint) { setTool._blockHint = true; toast('Symbol auf die Seite klicken zum Platzieren. Danach auswählen → ziehen/skalieren. Weite/Höhe der Box = Ausrichtung (z. B. Bett quer/längs).'); }
  if (t === 'section' && !setTool._secHint) { setTool._secHint = true; toast('Schnittlinie über die Wände ziehen (Shift = 15°). Daraus entsteht ein LIVE-Vertikalschnitt (Wände/Schichten/Höhen, Fenster mit Bank/Nische). Massstab muss gesetzt sein.'); }
  if (t === 'roof' && !setTool._roofHint) { setTool._roofHint = true; toast('Dach: Grundfläche aufziehen. Oben: Sattel/Pult, Traufe + First, „First ↻" dreht die Firstrichtung. 3D zeigt die Schräge.'); }
  if (t === 'stairs' && !setTool._stairHint) { setTool._stairHint = true; toast('Treppe (gerader Lauf): Start klicken → Richtung/Länge → 2. Klick oder „L". Breite/Höhe/UK oben einstellen · L-/U-Treppe: mehrere Läufe + Podest (Decke). 3D zeigt die Stufen.'); }
  if (t === 'chaindim' && !setTool._cdimHint) { setTool._cdimHint = true; toast('Kettenmass: Stationen klicken (rastet an Ecken/Enden ein) · je Abschnitt ein Mass + Gesamt · Rücktaste = letzte Station zurück · Doppelklick/Enter = fertig.'); }
  updatePlanBar();
  if ((t === 'wall' || t === 'wallchain') && !docScale && !_scaleAfter) { _scaleAfter = t; toast('Erst den Massstab wählen – dann passen die Wände masstabsgetreu aufs Blatt.'); openScale(); return; }
  if (t === 'wall' && !setTool._wallHint) { setTool._wallHint = true; toast('Einzelne Wand: Start klicken → Richtung → 2. Klick oder „L" = Länge. Volle Kontrolle (Dicke/Achse/Schraffur) oben in der Planungs-Leiste.'); }
  if (t === 'wallchain' && !setTool._wcHint) { setTool._wcHint = true; toast('Wände am Stück: klicken–klicken = Raumzug · zurück auf den Startpunkt = Raum schliessen (m²) · Rücktaste = letzte Wand zurück · Doppelklick/Enter = fertig.'); }
  if (pdfDoc) pageViews.forEach(p => drawAnnos(p));   // neu zeichnen → Schicht-Hilfsnetz erscheint/verschwindet je nach Werkzeug
}
function applyToolCursor() {
  pageViews.forEach(pv => { pv.wrap.classList.toggle('tool-draw', ['pen', 'line', 'arrow', 'rect', 'oval', 'measure', 'dim', 'calibrate', 'note', 'sig', 'highlight', 'stamp', 'eraser', 'crop', 'snip', 'area', 'arc', 'curve', 'wall', 'wallchain', 'chaindim', 'opening', 'window', 'slab', 'stairs', 'beam', 'roof', 'block', 'profile', 'terrain', 'section', 'floortile', 'wallface', 'anschluss', 'aussparung'].includes(tool)); pv.wrap.classList.toggle('tool-text', tool === 'text' || tool === 'edittext'); });
}

/* ---------- Speichern / PDF erzeugen (pdf-lib) ---------- */
function downloadBytes(bytes, name) { const blob = new Blob([bytes], { type: 'application/pdf' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1500); }
// Drucken: fertiges PDF (mit Anmerkungen) erzeugen und über ein verstecktes iframe drucken
async function printDoc() {
  if (!curBytes) return; status('Druckansicht wird vorbereitet …');
  try {
    const out = await buildPdfBytes(layers.some(l => !l.visible));   // ausgeblendete Ebenen nicht mitdrucken
    const url = URL.createObjectURL(new Blob([out], { type: 'application/pdf' }));
    const ifr = document.createElement('iframe'); ifr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; ifr.src = url;
    ifr.onload = () => { status(''); setTimeout(() => { try { ifr.contentWindow.focus(); ifr.contentWindow.print(); } catch (_) { window.open(url, '_blank'); } setTimeout(() => { URL.revokeObjectURL(url); ifr.remove(); }, 60000); }, 350); };
    document.body.appendChild(ifr);
  } catch (e) { status(''); console.error(e); toast('Drucken fehlgeschlagen.'); }
}
function outName() { return docName.replace(/\.pdf$/i, '') + '-submit.pdf'; }
const NATIVE_OK = new Set(['note', 'text', 'line', 'arrow', 'rect', 'oval', 'pen', 'highlight']);
function addNativeAnnot(doc, lib, pg, a, PH, cbx, cby, font) {   // Submit-Anmerkung → native PDF-Annotation MIT Appearance-Stream (in jedem Viewer sichtbar + editierbar)
  const { PDFName, PDFString } = lib, N = PDFName.of, S = PDFString.of, fx = x => x + cbx, fy = y => PH - y + cby;
  const C = hex => { const c = hexToRgb(hex || '#1c242c'); return [c.r, c.g, c.b]; }, f = n => Math.round(n * 100) / 100;
  let d = null, content = null, W = 0, Hh = 0, res = {};
  const mkAP = () => { try { const ap = doc.context.stream(content, { Type: N('XObject'), Subtype: N('Form'), FormType: 1, BBox: [0, 0, W, Hh], Resources: res }); d.AP = { N: doc.context.register(ap) }; } catch (e) { console.warn('AP', e); } };
  if (a.type === 'rect' || a.type === 'oval') {
    const x1 = fx(a.x), y2 = fy(a.y), x2 = fx(a.x + a.w), y1 = fy(a.y + a.h), rx = Math.min(x1, x2), ry = Math.min(y1, y2); W = Math.abs(x2 - x1); Hh = Math.abs(y2 - y1);
    const lw = a.width || 1.5, col = C(a.color), hasF = a.fill && a.fill !== 'none', fc = hasF ? C(a.fill) : null;
    d = { Type: N('Annot'), Subtype: N(a.type === 'rect' ? 'Square' : 'Circle'), Rect: [rx, ry, rx + W, ry + Hh], C: col, Border: [0, 0, lw], Contents: S('') }; if (hasF) d.IC = fc;
    let c = (hasF ? fc[0] + ' ' + fc[1] + ' ' + fc[2] + ' rg ' : '') + col[0] + ' ' + col[1] + ' ' + col[2] + ' RG ' + lw + ' w ';
    if (a.type === 'rect') c += f(lw / 2) + ' ' + f(lw / 2) + ' ' + f(W - lw) + ' ' + f(Hh - lw) + ' re ' + (hasF ? 'B' : 'S');
    else { const cx = W / 2, cy = Hh / 2, ex = (W - lw) / 2, ey = (Hh - lw) / 2, k = 0.5523; c += f(cx + ex) + ' ' + f(cy) + ' m ' + f(cx + ex) + ' ' + f(cy + ey * k) + ' ' + f(cx + ex * k) + ' ' + f(cy + ey) + ' ' + f(cx) + ' ' + f(cy + ey) + ' c ' + f(cx - ex * k) + ' ' + f(cy + ey) + ' ' + f(cx - ex) + ' ' + f(cy + ey * k) + ' ' + f(cx - ex) + ' ' + f(cy) + ' c ' + f(cx - ex) + ' ' + f(cy - ey * k) + ' ' + f(cx - ex * k) + ' ' + f(cy - ey) + ' ' + f(cx) + ' ' + f(cy - ey) + ' c ' + f(cx + ex * k) + ' ' + f(cy - ey) + ' ' + f(cx + ex) + ' ' + f(cy - ey * k) + ' ' + f(cx + ex) + ' ' + f(cy) + ' c ' + (hasF ? 'B' : 'S'); }
    content = c; mkAP();
  } else if (a.type === 'line' || a.type === 'arrow') {
    const px1 = fx(a.x1), py1 = fy(a.y1), px2 = fx(a.x2), py2 = fy(a.y2), lw = a.width || 1.5, pad = Math.max(8, lw * 4), rx = Math.min(px1, px2) - pad, ry = Math.min(py1, py2) - pad; W = Math.abs(px2 - px1) + 2 * pad; Hh = Math.abs(py2 - py1) + 2 * pad;
    const lx1 = px1 - rx, ly1 = py1 - ry, lx2 = px2 - rx, ly2 = py2 - ry, col = C(a.color);
    d = { Type: N('Annot'), Subtype: N('Line'), Rect: [rx, ry, rx + W, ry + Hh], L: [px1, py1, px2, py2], C: col, Border: [0, 0, lw], Contents: S('') };
    let c = col[0] + ' ' + col[1] + ' ' + col[2] + ' RG ' + lw + ' w 1 J 1 j ' + f(lx1) + ' ' + f(ly1) + ' m ' + f(lx2) + ' ' + f(ly2) + ' l S';
    if (a.type === 'arrow') { d.LE = [N('None'), N('OpenArrow')]; const ang = Math.atan2(ly2 - ly1, lx2 - lx1), hl = Math.max(8, lw * 4.5), aw = 0.5; c += ' ' + f(lx2 - Math.cos(ang - aw) * hl) + ' ' + f(ly2 - Math.sin(ang - aw) * hl) + ' m ' + f(lx2) + ' ' + f(ly2) + ' l ' + f(lx2 - Math.cos(ang + aw) * hl) + ' ' + f(ly2 - Math.sin(ang + aw) * hl) + ' l S'; }
    content = c; mkAP();
  } else if (a.type === 'pen' && a.pts && a.pts.length > 1) {
    const xs = a.pts.map(p => fx(p[0])), ys = a.pts.map(p => fy(p[1])), rx = Math.min(...xs) - 2, ry = Math.min(...ys) - 2; W = Math.max(...xs) - Math.min(...xs) + 4; Hh = Math.max(...ys) - Math.min(...ys) + 4;
    const lw = a.width || 1.6, col = C(a.color), path = a.pts.map((p, i) => f(fx(p[0]) - rx) + ' ' + f(fy(p[1]) - ry) + ' ' + (i ? 'l' : 'm')).join(' ');
    d = { Type: N('Annot'), Subtype: N('Ink'), Rect: [rx, ry, rx + W, ry + Hh], InkList: [a.pts.map(p => [fx(p[0]), fy(p[1])]).flat()], C: col, Border: [0, 0, lw], Contents: S('') };
    content = col[0] + ' ' + col[1] + ' ' + col[2] + ' RG ' + lw + ' w 1 J 1 j ' + path + ' S'; mkAP();
  } else if (a.type === 'highlight' && a.rects && a.rects.length) {
    const xs = [], ys = [], q = []; for (const r of a.rects) { const x1 = fx(r.x), x2 = fx(r.x + r.w), yt = fy(r.y), yb = fy(r.y + r.h); q.push(x1, yt, x2, yt, x1, yb, x2, yb); xs.push(x1, x2); ys.push(yt, yb); }
    const rx = Math.min(...xs), ry = Math.min(...ys), col = C(a.color || '#ffe14d'); W = Math.max(...xs) - rx; Hh = Math.max(...ys) - ry;
    d = { Type: N('Annot'), Subtype: N('Highlight'), Rect: [rx, ry, rx + W, ry + Hh], QuadPoints: q, C: col, CA: 0.4 };
    res = { ExtGState: { GSm: { Type: N('ExtGState'), ca: 0.4, BM: N('Multiply') } } };
    let c = '/GSm gs ' + col[0] + ' ' + col[1] + ' ' + col[2] + ' rg '; for (const r of a.rects) c += f(fx(r.x) - rx) + ' ' + f(fy(r.y + r.h) - ry) + ' ' + f(r.w) + ' ' + f(r.h) + ' re '; c += 'f'; content = c; mkAP();
  } else if (a.type === 'text') {
    const x1 = fx(a.x), y2 = fy(a.y), x2 = fx(a.x + (a.w || 60)), y1 = fy(a.y + (a.h || 16)), rx = Math.min(x1, x2), ry = Math.min(y1, y2); W = Math.abs(x2 - x1); Hh = Math.abs(y2 - y1);
    const sz = a.size || 12, col = C(a.color && a.color !== '#ffffff' ? a.color : '#1c242c');
    d = { Type: N('Annot'), Subtype: N('FreeText'), Rect: [rx, ry, rx + W, ry + Hh], Contents: S(a.text || ''), DA: S('/Helv ' + sz + ' Tf ' + col[0] + ' ' + col[1] + ' ' + col[2] + ' rg') };
    res = { Font: { Helv: font.ref } };
    const lines = (a.text || '').split('\n').map(l => l.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'));
    let c = 'BT /Helv ' + sz + ' Tf ' + col[0] + ' ' + col[1] + ' ' + col[2] + ' rg ' + (sz * 1.2) + ' TL 2 ' + f(Hh - sz) + ' Td'; for (const ln of lines) c += ' (' + ln + ') Tj T*'; c += ' ET'; content = c; mkAP();
  } else if (a.type === 'note') {
    const rx = fx(a.x), ry = fy(a.y + 18); W = 18; Hh = 18;
    d = { Type: N('Annot'), Subtype: N('Text'), Rect: [rx, ry, rx + 18, ry + 18], Contents: S(a.text || ''), C: C('#f5c84b'), Name: N('Comment'), Open: false };
    content = '0.96 0.78 0.29 rg 0.4 0.36 0.16 RG 1 w 1 4 16 12 re B 0.25 0.22 0.18 RG 0.7 w 4 13 m 14 13 l S 4 10 m 14 10 l S 4 7 m 11 7 l S'; mkAP();
  }
  if (!d) return;
  try { let an = pg.node.Annots(); if (!an) { an = doc.context.obj([]); pg.node.set(PDFName.of('Annots'), an); } an.push(doc.context.register(doc.context.obj(d))); } catch (_) { }
}
async function buildPdfBytes(visibleOnly, embed, nativeExport) {
  const lib = await loadPdfLib();
  {
    const { PDFDocument, rgb: rgb0, StandardFonts, degrees, pushGraphicsState, popGraphicsState, concatTransformationMatrix, moveTo, lineTo, closePath, clip, endPath } = lib;
    const exportBW = document.body.classList.contains('bw');   // S/W-Modus → alle Anmerkungsfarben als Graustufe ins PDF
    const rgb = exportBW ? ((r, g, b) => { const l = 0.299 * r + 0.587 * g + 0.114 * b; return rgb0(l, l, l); }) : rgb0;
    const doc = await PDFDocument.load(curBytes.slice(), { ignoreEncryption: true });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const _fontCache = {};   // passende Standardschrift je erkannter Familie/Stil (Text-Bearbeiten) – identischer Look wie am Bildschirm
    async function getFont(fam, bold, italic) {
      const key = (fam || 'helv') + (bold ? 'B' : '') + (italic ? 'I' : ''); if (_fontCache[key]) return _fontCache[key];
      const SF = StandardFonts; let nm;
      if (fam === 'times') nm = bold && italic ? SF.TimesRomanBoldItalic : bold ? SF.TimesRomanBold : italic ? SF.TimesRomanItalic : SF.TimesRoman;
      else if (fam === 'courier') nm = bold && italic ? SF.CourierBoldOblique : bold ? SF.CourierBold : italic ? SF.CourierOblique : SF.Courier;
      else nm = bold && italic ? SF.HelveticaBoldOblique : bold ? SF.HelveticaBold : italic ? SF.HelveticaOblique : SF.Helvetica;
      try { return _fontCache[key] = await doc.embedFont(nm); } catch (_) { return _fontCache[key] = font; }
    }
    const pages = doc.getPages(); const sigCache = {}, nativeAnns = [];
    for (let n = 1; n <= pages.length; n++) {
      const pg = pages[n - 1];
      let cb; try { cb = pg.getCropBox(); } catch (_) { const s = pg.getSize(); cb = { x: 0, y: 0, width: s.width, height: s.height }; }
      const PH = cb.height;                          // zugeschnittene Höhe (Anmerkungen liegen relativ zum sichtbaren Rahmen)
      const Y = y => PH - y;                          // pdf.js (oben) → pdf-lib (unten)
      const cropT = (cb.x !== 0 || cb.y !== 0) && pushGraphicsState && popGraphicsState && concatTransformationMatrix;
      if (cropT) pg.pushOperators(pushGraphicsState(), concatTransformationMatrix(1, 0, 0, 1, cb.x, cb.y));   // Ursprung in die CropBox-Ecke
      let wallUni = false;
      if (window.polygonClipping) {   // Wandflächen vereinigen → saubere Ecken auch im PDF
        const walls = (annos[n] || []).filter(a => a.type === 'wall' && !a._draft && (wallSimple(a) || !(a.layers && a.layers.length)) && phaseVisible(a) && (!visibleOnly || layerVisible(a)));
        if (walls.length) try {
          const groups = {};
          for (const w of walls) { const k = wallSimple(w) ? 'BLACK' : ((w.color || '#1c242c') + '|' + (w.fill || '#ffffff')); (groups[k] || (groups[k] = [])).push(w); }
          for (const k in groups) {
            const grp = groups[k], blk = k === 'BLACK', uni = polygonClipping.union(...grp.map(w => [wallPoly(w, walls).map(p => [p[0], p[1]])]));
            if (!uni || !uni.length) continue; wallUni = true;
            const wc = hexToRgb(blk ? '#1c242c' : (grp[0].color || '#1c242c')), fc = hexToRgb(blk ? '#1c242c' : (grp[0].fill || '#ffffff')), lw = grp[0].width || 1.4;
            for (const poly of uni) { let d = ''; for (const ring of poly) { if (!ring.length) continue; d += 'M' + ring.map(p => p[0] + ' ' + p[1]).join(' L ') + ' Z'; } if (d) pg.drawSvgPath(d, { x: 0, y: PH, color: rgb(fc.r, fc.g, fc.b), borderColor: rgb(wc.r, wc.g, wc.b), borderWidth: lw }); }
          }
        } catch (_) { wallUni = false; }
      }
      for (const a of (annos[n] || [])) {
        if (a._draft) continue;   // unbestätigtes Wand-Ketten-Segment nicht speichern
        if (visibleOnly && !layerVisible(a)) continue;   // Drucken: nur sichtbare Ebenen
        if (!phaseVisible(a)) continue;                  // Drucken: nur Phasen der aktuellen Ansicht
        if (nativeExport && NATIVE_OK.has(a.type)) { nativeAnns.push({ a, pg, PH, cbx: cb.x, cby: cb.y }); continue; }   // als native PDF-Annotation exportieren statt einbacken
        if (a.type === 'opening') openingResolve(a, { num: +n });   // Öffnung aus Wand ableiten
        if (a.type === 'opening') openingResolve(a, { num: +n });   // Öffnung aus Wand ableiten
        const col = hexToRgb(a.color), c = rgb(col.r, col.g, col.b), w = a.width || 2, dp = dashPdf(a);
        if (a.type === 'path') {
          if (a.fill && a.fill !== 'none') { const fc = hexToRgb(a.fill); try { pg.drawSvgPath(pathD(a), { x: 0, y: PH, color: rgb(fc.r, fc.g, fc.b) }); } catch (_) { } }   // Füllung (Vektor)
          const pts = flattenPath(a); for (let i = 1; i < pts.length; i++) pg.drawLine({ start: { x: pts[i - 1].x, y: Y(pts[i - 1].y) }, end: { x: pts[i].x, y: Y(pts[i].y) }, thickness: w, color: c });   // Strich (bewährt)
        }
        else if (a.type === 'arc') {
          const cx = (a.x1 + a.x2) / 2, cy = (a.y1 + a.y2) / 2, r = Math.hypot(a.x2 - a.x1, a.y2 - a.y1) / 2, a1 = Math.atan2(a.y1 - cy, a.x1 - cx);
          let px = a.x1, py = a.y1; const N = 28;
          for (let i = 1; i <= N; i++) { const ang = a1 + Math.PI * (i / N), nx = cx + r * Math.cos(ang), ny = cy + r * Math.sin(ang); pg.drawLine({ start: { x: px, y: Y(py) }, end: { x: nx, y: Y(ny) }, thickness: w, color: c }); px = nx; py = ny; }
        }
        else if (a.type === 'line' || a.type === 'arrow' || a.type === 'measure' || a.type === 'dim') {
          pg.drawLine({ start: { x: a.x1, y: Y(a.y1) }, end: { x: a.x2, y: Y(a.y2) }, thickness: w, color: c, dashArray: dp });
          if (a.type === 'arrow') { const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1), L = Math.max(12, w * 5); for (const s of [ang + 2.7, ang - 2.7]) pg.drawLine({ start: { x: a.x2, y: Y(a.y2) }, end: { x: a.x2 + Math.cos(s) * L, y: Y(a.y2 + Math.sin(s) * L) }, thickness: w, color: c }); }
          if (a.type === 'measure') { const mx = (a.x1 + a.x2) / 2, my = (a.y1 + a.y2) / 2; pg.drawText(a.label || lenLabel(a), { x: mx + 4, y: Y(my) + 4, size: 11, font, color: c }); }
          if (a.type === 'dim') {
            const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1), tx = Math.cos(ang + Math.PI / 2) * 6, ty = Math.sin(ang + Math.PI / 2) * 6;
            for (const [ex, ey] of [[a.x1, a.y1], [a.x2, a.y2]]) pg.drawLine({ start: { x: ex - tx, y: Y(ey - ty) }, end: { x: ex + tx, y: Y(ey + ty) }, thickness: w, color: c });
            const mx = (a.x1 + a.x2) / 2, my = (a.y1 + a.y2) / 2, lab = a.text || lenLabel(a);
            pg.drawText(lab, { x: mx - lab.length * 3, y: Y(my) + 6, size: 11, font, color: c });
          }
        }
        else if (a.type === 'wall' && a.layers && a.layers.length && !wallSimple(a)) {   // mehrschichtiger Aufbau im PDF
          const arr = annos[n] || [], { bands, c1A, c2A, c2B, c1B } = wallLayerBands(a, arr), lp = (p, q, f) => [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f];
          const polyD = pts => 'M' + pts.map((p, i) => (i ? 'L' : '') + p[0] + ' ' + p[1]).join(' ') + 'Z';
          for (const b of bands) {
            const m = WALL_MATS[b.mat] || {}, fc = hexToRgb(m.fill || '#ffffff'), bc = hexToRgb(m.color || '#9a9a9a');
            try { pg.drawSvgPath(polyD(b.poly), { x: 0, y: PH, color: rgb(fc.r, fc.g, fc.b), borderColor: rgb(bc.r, bc.g, bc.b), borderWidth: 0.7 }); } catch (_) { }
            if (m.hatch && moveTo && clip) { try {
              const ops = [pushGraphicsState(), moveTo(b.poly[0][0], Y(b.poly[0][1]))]; for (let i = 1; i < b.poly.length; i++) ops.push(lineTo(b.poly[i][0], Y(b.poly[i][1]))); ops.push(closePath(), clip(), endPath()); pg.pushOperators(...ops);
              const hc = hexToRgb(m.color), hcc = rgb(hc.r, hc.g, hc.b), S = (a.hatch && a.hatch.scale) || lastHatchScale;
              if (m.hatch === 'daemm_eps' || m.hatch === 'daemm_wolle' || INSUL_TYPES.includes(m.hatch)) {   // Striche 90° zur Wandachse
                const dx = a.x2 - a.x1, dy = a.y2 - a.y1, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux, T = a.thick || wallThickPts(), o = wallSideOffsets(a), eB = o[1] * T, eA = o[0] * T;
                const eFrom = eB + (eA - eB) * b.f0, eTo = eB + (eA - eB) * b.f1, step = Math.max(4, S * 1.3);
                for (let s = 0; s <= L; s += step) { const px = a.x1 + ux * s, py = a.y1 + uy * s; pg.drawLine({ start: { x: px + nx * eFrom, y: Y(py + ny * eFrom) }, end: { x: px + nx * eTo, y: Y(py + ny * eTo) }, thickness: 0.8, color: hcc }); }
              } else { const xs = b.poly.map(p => p[0]), ys = b.poly.map(p => p[1]), g = hatchGeom({ type: 'rect', x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), hatch: { type: m.hatch, scale: S } }); for (const L of g.lines) pg.drawLine({ start: { x: L[0], y: Y(L[1]) }, end: { x: L[2], y: Y(L[3]) }, thickness: 0.8, color: hcc }); for (const D of g.dots) { const dr = D[2] != null ? D[2] : S * 0.16; pg.drawEllipse({ x: D[0], y: Y(D[1]), xScale: dr, yScale: dr, color: hcc }); } }
              pg.pushOperators(popGraphicsState());
            } catch (_) { } }
          }
          a.layers.forEach((Ly, li) => {   // Unterkonstruktion im PDF
            const b = bands[li]; if (!Ly.sub || !b) return; const sub = Ly.sub;
            const dx = a.x2 - a.x1, dy = a.y2 - a.y1, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux, T = a.thick || wallThickPts(), o = wallSideOffsets(a), eB = o[1] * T, eA = o[0] * T;
            const eFrom = eB + (eA - eB) * b.f0, eTo = eB + (eA - eB) * b.f1, spacing = sub.spacing || cmToPts(60), skips = wallOpeningsAlong(a, arr), inSkip = s => skips.some(([t0, t1]) => s > t0 - 2 && s < t1 + 2);
            const dark = rgb(.23, .25, .27), mc = hexToRgb('#6b7178'), metalC = rgb(mc.r, mc.g, mc.b), wc = hexToRgb(WALL_MATS.holz.color), woodC = rgb(wc.r, wc.g, wc.b), wf = hexToRgb(WALL_MATS.holz.fill);
            for (let s = spacing / 2; s <= L; s += spacing) {
              if (inSkip(s)) continue; const px = a.x1 + ux * s, py = a.y1 + uy * s, A = [px + nx * eFrom, py + ny * eFrom], B = [px + nx * eTo, py + ny * eTo];
              if (sub.type === 'schraube') { pg.drawLine({ start: { x: A[0], y: Y(A[1]) }, end: { x: B[0], y: Y(B[1]) }, thickness: 1.2, color: dark }); const hw = cmToPts(1.4); pg.drawLine({ start: { x: B[0] - ux * hw, y: Y(B[1] - uy * hw) }, end: { x: B[0] + ux * hw, y: Y(B[1] + uy * hw) }, thickness: 1.4, color: dark }); }
              else { const w = (sub.w || cmToPts(5)) / 2, c1 = [A[0] - ux * w, A[1] - uy * w], c2 = [B[0] - ux * w, B[1] - uy * w], c3 = [B[0] + ux * w, B[1] + uy * w], c4 = [A[0] + ux * w, A[1] + uy * w], d = 'M' + [c1, c2, c3, c4].map((p, k) => (k ? 'L' : '') + p[0] + ' ' + p[1]).join(' ') + 'Z';
                if (sub.type === 'lattung') { try { pg.drawSvgPath(d, { x: 0, y: PH, color: rgb(wf.r, wf.g, wf.b), borderColor: woodC, borderWidth: 0.8 }); } catch (_) { } pg.drawLine({ start: { x: c1[0], y: Y(c1[1]) }, end: { x: c3[0], y: Y(c3[1]) }, thickness: 0.6, color: woodC }); pg.drawLine({ start: { x: c2[0], y: Y(c2[1]) }, end: { x: c4[0], y: Y(c4[1]) }, thickness: 0.6, color: woodC }); }
                else { try { pg.drawSvgPath(d, { x: 0, y: PH, borderColor: metalC, borderWidth: 1.3 }); } catch (_) { } }
              }
            }
          });
          if (a.dim) wallDimPrimsToPdf(pg, wallDimChains(a, annos[n] || []), Y, font, degrees, rgb(.11, .14, .17));   // zwei Maßketten: aussen Rohbau / innen Fertig
        }
        else if (a.type === 'wall') {
          const arr = annos[n] || [], poly = wallPoly(a, arr), lw = a.width || 1.4;
          if (!wallUni && a.fill && a.fill !== 'none') { const fc = hexToRgb(a.fill); const d = 'M' + poly.map((p, i) => (i ? 'L' : '') + p[0] + ' ' + p[1]).join(' ') + 'Z'; try { pg.drawSvgPath(d, { x: 0, y: PH, color: rgb(fc.r, fc.g, fc.b) }); } catch (_) { } }
          if (!wallUni) for (const [p, q] of wallOutlineSegs(a, arr)) pg.drawLine({ start: { x: p[0], y: Y(p[1]) }, end: { x: q[0], y: Y(q[1]) }, thickness: lw, color: c });
          if (a.dim) wallDimPrimsToPdf(pg, wallDimChains(a, annos[n] || []), Y, font, degrees, rgb(.11, .14, .17));   // zwei Maßketten: aussen Rohbau / innen Fertig
        }
        else if (a.type === 'rect') { const x = Math.min(a.x, a.x + a.w), y = Math.min(a.y, a.y + a.h), W = Math.abs(a.w), H = Math.abs(a.h), o = { x, y: Y(y + H), width: W, height: H, borderColor: c, borderWidth: w, borderDashArray: dp }; if (a.fill && a.fill !== 'none') { const fc = hexToRgb(a.fill); o.color = rgb(fc.r, fc.g, fc.b); } pg.drawRectangle(o); }
        else if (a.type === 'roof') { const x = Math.min(a.x, a.x + a.w), y = Math.min(a.y, a.y + a.h), W = Math.abs(a.w), H = Math.abs(a.h); pg.drawRectangle({ x, y: Y(y + H), width: W, height: H, borderColor: c, borderWidth: 1.2 }); const rl = (x1, y1, x2, y2) => pg.drawLine({ start: { x: x1, y: Y(y1) }, end: { x: x2, y: Y(y2) }, thickness: 1.8, color: c }); if (a.rtype === 'pult') { a.axis === 'x' ? rl(x, y, x + W, y) : rl(x, y, x, y + H); } else { a.axis === 'x' ? rl(x, y + H / 2, x + W, y + H / 2) : rl(x + W / 2, y, x + W / 2, y + H); } const lab = a.rtype === 'pult' ? 'Pultdach' : 'Satteldach', tw = font.widthOfTextAtSize(lab, 11); pg.drawText(lab, { x: x + W / 2 - tw / 2, y: Y(y + H / 2) - 3, size: 11, font, color: c }); }
        else if (a.type === 'block') {
          const pf = IS_COLUMN(a.kind) ? hexToRgb('#b8bcb2') : null, fco = pf ? { color: rgb(pf.r, pf.g, pf.b) } : {};
          const ro = a.rot || 0, bcx = Math.min(a.x, a.x + a.w) + Math.abs(a.w) / 2, bcy = Math.min(a.y, a.y + a.h) + Math.abs(a.h) / 2, cs = Math.cos(ro), sn = Math.sin(ro);
          const R = (x, y) => ro ? [bcx + (x - bcx) * cs - (y - bcy) * sn, bcy + (x - bcx) * sn + (y - bcy) * cs] : [x, y];
          for (const sp of blockShapes(a)) {
            if (sp.t === 'rect') {
              if (!ro) { pg.drawRectangle({ x: sp.x, y: Y(sp.y + sp.h), width: sp.w, height: sp.h, borderColor: c, borderWidth: 1.2, ...fco }); }
              else { const cs4 = [[sp.x, sp.y], [sp.x + sp.w, sp.y], [sp.x + sp.w, sp.y + sp.h], [sp.x, sp.y + sp.h]].map(p => R(p[0], p[1])); for (let i = 0; i < 4; i++) { const p = cs4[i], q = cs4[(i + 1) % 4]; pg.drawLine({ start: { x: p[0], y: Y(p[1]) }, end: { x: q[0], y: Y(q[1]) }, thickness: 1.2, color: c }); } }
            } else if (sp.t === 'ell') { const [px, py] = R(sp.cx, sp.cy); pg.drawEllipse({ x: px, y: Y(py), xScale: sp.rx, yScale: sp.ry, rotate: degrees(-ro * 180 / Math.PI), borderColor: c, borderWidth: 1.2 }); }
            else if (sp.t === 'circ') { const [px, py] = R(sp.cx, sp.cy); pg.drawEllipse({ x: px, y: Y(py), xScale: sp.r, yScale: sp.r, borderColor: c, borderWidth: 1, ...(a.kind === 'columnRound' ? fco : {}) }); }
            else if (sp.t === 'line') { const [ax, ay] = R(sp.x1, sp.y1), [bx2, by2] = R(sp.x2, sp.y2); pg.drawLine({ start: { x: ax, y: Y(ay) }, end: { x: bx2, y: Y(by2) }, thickness: 1, color: c }); }
          }
        }
        else if (a.type === 'oval') { const o = { x: a.x + a.w / 2, y: Y(a.y + a.h / 2), xScale: Math.abs(a.w / 2), yScale: Math.abs(a.h / 2), borderColor: c, borderWidth: w, borderDashArray: dp }; if (a.fill && a.fill !== 'none') { const fc = hexToRgb(a.fill); o.color = rgb(fc.r, fc.g, fc.b); } pg.drawEllipse(o); }
        else if (a.type === 'pen') { const op = a.hl ? 0.35 : 1; for (let i = 1; i < a.pts.length; i++) pg.drawLine({ start: { x: a.pts[i - 1][0], y: Y(a.pts[i - 1][1]) }, end: { x: a.pts[i][0], y: Y(a.pts[i][1]) }, thickness: w, color: c, opacity: op }); }
        else if (a.type === 'opening') {
          const oDetail = openingDetail(a, annos[n] || []), P = openingParts(a, oDetail);
          const coverPoly = (a.x != null && a.wallId) ? openingCutPoly(a) : P.cover, d = 'M' + coverPoly.map((p, i) => (i ? 'L' : '') + p[0] + ' ' + p[1]).join(' ') + 'Z';   // Laibungs-aware H-Ausschnitt (wie Bildschirm): Wand lappt auf den Rahmen
          try { pg.drawSvgPath(d, { x: 0, y: PH, color: rgb(1, 1, 1) }); } catch (_) { }   // Wand ausstanzen
          if (oDetail) for (const st of openingRevealStrips(a, annos[n] || [])) { const sf = hexToRgb(st.fill), ss = hexToRgb(st.stroke), sd = 'M' + st.poly.map((p, i) => (i ? 'L' : '') + p[0] + ' ' + p[1]).join(' ') + 'Z'; try { pg.drawSvgPath(sd, Object.assign({ x: 0, y: PH, color: rgb(sf.r, sf.g, sf.b) }, st.seam == null ? { borderColor: rgb(ss.r, ss.g, ss.b), borderWidth: 0.7 } : {})); } catch (_) { } if (st.seam != null) for (const [u, v] of revealEdgeSegs(st.poly, st.seam)) pg.drawLine({ start: { x: u[0], y: Y(u[1]) }, end: { x: v[0], y: Y(v[1]) }, thickness: 0.7, color: rgb(ss.r, ss.g, ss.b) }); if (st.hatch) for (const [u, v] of st.hatch) pg.drawLine({ start: { x: u[0], y: Y(u[1]) }, end: { x: v[0], y: Y(v[1]) }, thickness: 0.8, color: rgb(ss.r, ss.g, ss.b) }); }   // Rahmen ausser an der Naht + Schraffur
          for (const f of (P.fills || [])) { const ff = hexToRgb(f.fill), fs = hexToRgb(f.stroke), fd = 'M' + f.poly.map((p, i) => (i ? 'L' : '') + p[0] + ' ' + p[1]).join(' ') + 'Z', fop = f.op != null ? f.op : 1; try { pg.drawSvgPath(fd, { x: 0, y: PH, color: rgb(ff.r, ff.g, ff.b), borderColor: rgb(fs.r, fs.g, fs.b), borderWidth: 1, opacity: fop, borderOpacity: fop }); } catch (_) { } }   // Rahmen/Flügel/Glas (op = offenes Blatt hell)
          for (const [u, v] of P.lines) pg.drawLine({ start: { x: u[0], y: Y(u[1]) }, end: { x: v[0], y: Y(v[1]) }, thickness: 1.4, color: c });
          for (const [u, v] of (P.bold || [])) pg.drawLine({ start: { x: u[0], y: Y(u[1]) }, end: { x: v[0], y: Y(v[1]) }, thickness: 2.6, color: c });
          for (const arc of P.arcs) { const pts = arcPts(arc.cx, arc.cy, arc.r, arc.from, arc.to, 18); for (let i = 1; i < pts.length; i++) pg.drawLine({ start: { x: pts[i - 1][0], y: Y(pts[i - 1][1]) }, end: { x: pts[i][0], y: Y(pts[i][1]) }, thickness: 0.8, color: c }); }
        }
        else if (a.type === 'section') {
          for (const p of sectionPrimitives(a, annos[n] || [])) {
            if (p.t === 'rect') { const o = { x: Math.min(p.x, p.x + p.w), y: Y(Math.max(p.y, p.y + p.h)), width: Math.abs(p.w), height: Math.abs(p.h) }; if (p.fill && p.fill !== 'none') { const fc = hexToRgb(p.fill); o.color = rgb(fc.r, fc.g, fc.b); } if (p.stroke && p.stroke !== 'none') { const sc = hexToRgb(p.stroke); o.borderColor = rgb(sc.r, sc.g, sc.b); o.borderWidth = p.sw || 0.6; } pg.drawRectangle(o); }
            else if (p.t === 'poly') { const d = 'M' + p.pts.map((q, i) => (i ? 'L' : '') + q[0] + ' ' + q[1]).join(' ') + 'Z', opt = { x: 0, y: PH }; if (p.fill && p.fill !== 'none') { const fc = hexToRgb(p.fill); opt.color = rgb(fc.r, fc.g, fc.b); } if (p.stroke && p.stroke !== 'none') { const sc = hexToRgb(p.stroke); opt.borderColor = rgb(sc.r, sc.g, sc.b); opt.borderWidth = p.sw || 0.6; } try { pg.drawSvgPath(d, opt); } catch (_) { } }
            else if (p.t === 'line') { const lc = hexToRgb(p.stroke || '#1c242c'); pg.drawLine({ start: { x: p.x1, y: Y(p.y1) }, end: { x: p.x2, y: Y(p.y2) }, thickness: p.w || 1, color: rgb(lc.r, lc.g, lc.b), dashArray: p.dash ? [4, 3] : undefined }); }
            else if (p.t === 'arrow') { const s = 6, ang = Math.atan2(p.dy, p.dx), ac0 = hexToRgb(p.col || '#1c242c'), ac = rgb(ac0.r, ac0.g, ac0.b); for (const da of [2.5, -2.5]) pg.drawLine({ start: { x: p.x, y: Y(p.y) }, end: { x: p.x - Math.cos(ang + da) * s, y: Y(p.y - Math.sin(ang + da) * s) }, thickness: 1.4, color: ac }); }
            else if (p.t === 'text') { const tc = hexToRgb(p.col || '#1c242c'), tcol = rgb(tc.r, tc.g, tc.b), fsz = p.size || (p.small ? 9 : 11); if (p.ang) { const tw = font.widthOfTextAtSize(p.text, fsz), pang = -p.ang, rad = pang * Math.PI / 180, bx = Math.cos(rad), by = Math.sin(rad), oo = fsz * 0.32; pg.drawText(p.text, { x: p.x - bx * tw / 2 + by * oo, y: Y(p.y) - by * tw / 2 - bx * oo, size: fsz, font, color: tcol, rotate: degrees(pang) }); } else pg.drawText(p.text, { x: p.x - (p.mid ? font.widthOfTextAtSize(p.text, fsz) / 2 : 0), y: Y(p.y) - 4, size: fsz, font, color: tcol }); }
          }
        }
        else if (a.type === 'mesh3d') {   // 3D-Objekt: Umriss-Box + Label im PDF (Geometrie selbst nur im 3D)
          pg.drawRectangle({ x: a.x, y: PH - (a.y + a.fh), width: a.fw, height: a.fh, borderColor: rgb(0.54, 0.56, 0.52), borderWidth: 1, opacity: 0 });
          try { pg.drawText('3D: ' + (a.name || 'Objekt'), { x: a.x + 6, y: PH - (a.y + 14), size: 9, font, color: rgb(0.42, 0.45, 0.5) }); } catch (_) { }
        }
        else if (a.type === 'profile' && a.path && a.path.length >= 2) {   // Komplexes Profil: Pfad-Linie im PDF
          const pc0 = hexToRgb(a.color || '#7a8392'), pcc = rgb(pc0.r, pc0.g, pc0.b), pth = a.closed && a.path.length >= 3 ? a.path.concat([a.path[0]]) : a.path;
          for (let i = 1; i < pth.length; i++) pg.drawLine({ start: { x: pth[i - 1][0], y: Y(pth[i - 1][1]) }, end: { x: pth[i][0], y: Y(pth[i][1]) }, thickness: 1.4, color: pcc });
          try { pg.drawText((a.name || 'Profil') + (a.elev != null ? ' @' + (+a.elev).toFixed(2) + 'm' : ''), { x: a.path[0][0] + 5, y: Y(a.path[0][1]) + 4, size: 8, font, color: pcc }); } catch (_) { }
        }
        else if (a.type === 'chaindim') {
          const G = a.pts.length >= 2 && chainDimStations(a.pts);
          if (G) { const { nx, ny, st } = G, tk = 4.5, dl = (x1, y1, x2, y2, th) => pg.drawLine({ start: { x: x1, y: Y(y1) }, end: { x: x2, y: Y(y2) }, thickness: th || 0.8, color: c });
            dl(st[0].proj[0], st[0].proj[1], st[st.length - 1].proj[0], st[st.length - 1].proj[1], 1);
            for (const s of st) { dl(s.proj[0] - nx * tk, s.proj[1] - ny * tk, s.proj[0] + nx * tk, s.proj[1] + ny * tk); if (Math.hypot(s.p[0] - s.proj[0], s.p[1] - s.proj[1]) > 1) dl(s.p[0], s.p[1], s.proj[0], s.proj[1]); }
            for (let i = 0; i < st.length - 1; i++) { const d = Math.abs(st[i + 1].t - st[i].t); if (d < 1) continue; const mx = (st[i].proj[0] + st[i + 1].proj[0]) / 2, my = (st[i].proj[1] + st[i + 1].proj[1]) / 2, lab = fmtLen(d), tw = font.widthOfTextAtSize(lab, 11); pg.drawText(lab, { x: mx + nx * 7 - tw / 2, y: Y(my + ny * 7) - 3, size: 11, font, color: c }); }
            if (st.length > 2) { const tot = '∑ ' + fmtLen(Math.abs(st[st.length - 1].t - st[0].t)), e = st[st.length - 1].proj, tw = font.widthOfTextAtSize(tot, 11); pg.drawText(tot, { x: e[0] + nx * 16 - tw / 2, y: Y(e[1] + ny * 16) - 3, size: 11, font, color: c }); }
          }
        }
        else if (a.type === 'area') { if (!a.room) for (let i = 0; i < a.pts.length; i++) { const p1 = a.pts[i], p2 = a.pts[(i + 1) % a.pts.length]; pg.drawLine({ start: { x: p1[0], y: Y(p1[1]) }, end: { x: p2[0], y: Y(p2[1]) }, thickness: w, color: c }); } if (a.pts.length >= 3) { const ct = centroid(a.pts), lab = areaLabel(a.pts); if (a.name) { const nw = font.widthOfTextAtSize(a.name, 11); pg.drawText(a.name, { x: ct[0] - nw / 2, y: Y(ct[1]) + 4, size: 11, font, color: c }); const tw2 = font.widthOfTextAtSize(lab, 9); pg.drawText(lab, { x: ct[0] - tw2 / 2, y: Y(ct[1]) - 9, size: 9, font, color: c }); } else { const tw = font.widthOfTextAtSize(lab, 11); pg.drawText(lab, { x: ct[0] - tw / 2, y: Y(ct[1]) - 4, size: 11, font, color: c }); } } }
        else if (a.type === 'slab') { for (let i = 0; i < a.pts.length; i++) { const p1 = a.pts[i], p2 = a.pts[(i + 1) % a.pts.length]; pg.drawLine({ start: { x: p1[0], y: Y(p1[1]) }, end: { x: p2[0], y: Y(p2[1]) }, thickness: 1.4, color: c, dashArray: [7, 4] }); } if (a.pts.length >= 3) { const ct = centroid(a.pts), lab = ((a.base >= wallHeightM ? 'Decke' : 'Platte') + ' ' + ((a.base || 0) + (a.thick || 0.2)).toFixed(2) + ' m'), tw = font.widthOfTextAtSize(lab, 11); pg.drawText(lab, { x: ct[0] - tw / 2, y: Y(ct[1]) - 4, size: 11, font, color: c }); } }
        else if (a.type === 'terrain' && a.pts && a.pts.length >= 2) {   // Gelände: Linie + Erdreich-Striche
          const tc0 = hexToRgb(a.color || '#7a6a4a'), tcc = rgb(tc0.r, tc0.g, tc0.b), tick = 6, step = 9;
          for (let i = 1; i < a.pts.length; i++) pg.drawLine({ start: { x: a.pts[i - 1][0], y: Y(a.pts[i - 1][1]) }, end: { x: a.pts[i][0], y: Y(a.pts[i][1]) }, thickness: 1.6, color: tcc });
          for (let i = 0; i < a.pts.length - 1; i++) { const x1 = a.pts[i][0], y1 = a.pts[i][1], x2 = a.pts[i + 1][0], y2 = a.pts[i + 1][1], L = Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / L, uy = (y2 - y1) / L; for (let d = step / 2; d < L; d += step) { const px = x1 + ux * d, py = y1 + uy * d; pg.drawLine({ start: { x: px, y: Y(py) }, end: { x: px - tick, y: Y(py + tick) }, thickness: 0.7, color: tcc }); } }
        }
        else if (a.type === 'stairs') {
          const dx = a.x2 - a.x1, dy = a.y2 - a.y1, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux, hw = (a.width || stairWidthPts()) / 2, n = stairSteps(a);
          const c1 = [a.x1 + nx * hw, a.y1 + ny * hw], c2 = [a.x2 + nx * hw, a.y2 + ny * hw], c3 = [a.x2 - nx * hw, a.y2 - ny * hw], c4 = [a.x1 - nx * hw, a.y1 - ny * hw];
          for (const [p, q] of [[c1, c2], [c2, c3], [c3, c4], [c4, c1]]) pg.drawLine({ start: { x: p[0], y: Y(p[1]) }, end: { x: q[0], y: Y(q[1]) }, thickness: 1.2, color: c });
          for (let i = 1; i < n; i++) { const t = i / n, mx = a.x1 + dx * t, my = a.y1 + dy * t; pg.drawLine({ start: { x: mx + nx * hw, y: Y(my + ny * hw) }, end: { x: mx - nx * hw, y: Y(my - ny * hw) }, thickness: 0.8, color: c }); }
          pg.drawLine({ start: { x: a.x1, y: Y(a.y1) }, end: { x: a.x2, y: Y(a.y2) }, thickness: 1, color: c });
          const al = 7; pg.drawLine({ start: { x: a.x2, y: Y(a.y2) }, end: { x: a.x2 - ux * al + nx * al * .6, y: Y(a.y2 - uy * al + ny * al * .6) }, thickness: 1, color: c }); pg.drawLine({ start: { x: a.x2, y: Y(a.y2) }, end: { x: a.x2 - ux * al - nx * al * .6, y: Y(a.y2 - uy * al - ny * al * .6) }, thickness: 1, color: c });
        }
        else if (a.type === 'beam') {
          const dx = a.x2 - a.x1, dy = a.y2 - a.y1, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L, hw = (a.width || beamWidthPts()) / 2;
          const c1 = [a.x1 + nx * hw, a.y1 + ny * hw], c2 = [a.x2 + nx * hw, a.y2 + ny * hw], c3 = [a.x2 - nx * hw, a.y2 - ny * hw], c4 = [a.x1 - nx * hw, a.y1 - ny * hw];
          for (const [p, q] of [[c1, c2], [c2, c3], [c3, c4], [c4, c1]]) pg.drawLine({ start: { x: p[0], y: Y(p[1]) }, end: { x: q[0], y: Y(q[1]) }, thickness: 1.1, color: c, dashArray: [7, 4] });
        }
        else if (a.type === 'text') {
          const pad = 3, lines = (a.text || '').split('\n'), lineH = a.size * 1.25, align = a.align || 'left';
          const W = a.w || 120, H = a.h || (lines.length * lineH + pad * 2);
          if (a.bg && a.bg !== 'transparent') { const bc = parseColor(a.bg); pg.drawRectangle({ x: a.x, y: Y(a.y + H), width: W, height: H, color: rgb(bc.r, bc.g, bc.b) }); }
          if (a.border) { const oc = parseColor(a.border); pg.drawRectangle({ x: a.x, y: Y(a.y + H), width: W, height: H, borderColor: rgb(oc.r, oc.g, oc.b), borderWidth: a.borderW || 1.2 }); }
          lines.forEach((ln, i) => {
            const tw = font.widthOfTextAtSize(ln, a.size);
            const tx = align === 'center' ? a.x + (W - tw) / 2 : align === 'right' ? a.x + W - pad - tw : a.x + pad;
            pg.drawText(ln, { x: tx, y: Y(a.y + pad + a.size + i * lineH), size: a.size, font, color: c });
          });
        }
        else if (a.type === 'note' && a.text) { pg.drawRectangle({ x: a.x, y: Y(a.y + 11), width: 13, height: 11, color: c }); }
        else if (a.type === 'highlight') { for (const r of (a.rects || [])) pg.drawRectangle({ x: r.x, y: Y(r.y + r.h), width: r.w, height: r.h, color: c, opacity: 0.33 }); }
        else if (a.type === 'stamp') {
          const sw = Math.max(2, Math.min(a.w, a.h) / 9);
          if (a.kind === 'check') { pg.drawLine({ start: { x: a.x + a.w * 0.18, y: Y(a.y + a.h * 0.55) }, end: { x: a.x + a.w * 0.42, y: Y(a.y + a.h * 0.78) }, thickness: sw, color: c }); pg.drawLine({ start: { x: a.x + a.w * 0.42, y: Y(a.y + a.h * 0.78) }, end: { x: a.x + a.w * 0.84, y: Y(a.y + a.h * 0.22) }, thickness: sw, color: c }); }
          else if (a.kind === 'cross') { pg.drawLine({ start: { x: a.x + a.w * 0.2, y: Y(a.y + a.h * 0.2) }, end: { x: a.x + a.w * 0.8, y: Y(a.y + a.h * 0.8) }, thickness: sw, color: c }); pg.drawLine({ start: { x: a.x + a.w * 0.8, y: Y(a.y + a.h * 0.2) }, end: { x: a.x + a.w * 0.2, y: Y(a.y + a.h * 0.8) }, thickness: sw, color: c }); }
          else if (a.kind === 'circle') pg.drawEllipse({ x: a.x + a.w / 2, y: Y(a.y + a.h / 2), xScale: a.w / 2 - sw, yScale: a.h / 2 - sw, borderColor: c, borderWidth: sw });
          else if (a.kind === 'label') { pg.drawRectangle({ x: a.x, y: Y(a.y + a.h), width: a.w, height: a.h, borderColor: c, borderWidth: 2 }); const fs = a.h * 0.46, tw = font.widthOfTextAtSize(a.text || '', fs); pg.drawText(a.text || '', { x: a.x + (a.w - tw) / 2, y: Y(a.y + a.h) + (a.h - fs) / 2 + fs * 0.2, size: fs, font, color: c }); }
        }
        else if (a.type === 'cover') { const cc = parseColor(a.color); pg.drawRectangle({ x: a.x, y: Y(a.y + a.h), width: a.w, height: a.h, color: rgb(cc.r, cc.g, cc.b) }); }
        else if (a.type === 'edit') { const tc2 = parseColor(a.color), ef = await getFont(a.fam, a.bold, a.italic), elh = a.lh || a.size * 1.25; if (a.bg && a.bg !== 'transparent') { const bg = parseColor(a.bg); pg.drawRectangle({ x: a.x, y: Y(a.y + a.h), width: a.w, height: a.h, color: rgb(bg.r, bg.g, bg.b) }); } (a.text || '').split('\n').forEach((ln, i) => { try { pg.drawText(ln, { x: a.x + 1, y: Y(a.y + a.size + i * elh), size: a.size, font: ef, color: rgb(tc2.r, tc2.g, tc2.b) }); } catch (_) { try { pg.drawText(ln, { x: a.x + 1, y: Y(a.y + a.size + i * elh), size: a.size, font, color: rgb(tc2.r, tc2.g, tc2.b) }); } catch (_) { } } }); }
        else if (a.type === 'img' && a.data) { let img = sigCache[a.data]; if (!img) { const bytes = Uint8Array.from(atob(a.data.split(',')[1]), ch => ch.charCodeAt(0)); img = sigCache[a.data] = await doc.embedPng(bytes); } pg.drawImage(img, { x: a.x, y: Y(a.y + a.h), width: a.w, height: a.h, opacity: a.opacity != null ? a.opacity : 1 }); }
        else if (a.type === 'sig' && a.data) { let img = sigCache[a.data]; if (!img) { const bytes = Uint8Array.from(atob(a.data.split(',')[1]), ch => ch.charCodeAt(0)); img = sigCache[a.data] = await doc.embedPng(bytes); } pg.drawImage(img, { x: a.x, y: Y(a.y + a.h), width: a.w, height: a.h }); if (a.caption) { const fs = Math.max(7, Math.min(11, a.h * 0.16)), cy = a.y + a.h + 2; pg.drawLine({ start: { x: a.x, y: Y(cy) }, end: { x: a.x + a.w, y: Y(cy) }, thickness: 0.7, color: rgb(.11, .14, .17) }); pg.drawText(a.caption, { x: a.x, y: Y(cy + fs + 1), size: fs, font, color: rgb(.11, .14, .17) }); } }
        // Schraffur (geclippt auf die Form)
        if ((a.type === 'rect' || a.type === 'oval' || a.type === 'path' || a.type === 'wall') && a.hatch && a.hatch.type && !(a.type === 'wall' && wallSimple(a)) && moveTo && clip) {
          try {
            const ops = [pushGraphicsState()];
            if (a.type === 'wall') { const poly = wallClipPoly(a); ops.push(moveTo(poly[0][0], Y(poly[0][1]))); for (let i = 1; i < 4; i++) ops.push(lineTo(poly[i][0], Y(poly[i][1]))); ops.push(closePath()); }
            else if (a.type === 'rect') { const x = Math.min(a.x, a.x + a.w), y = Math.min(a.y, a.y + a.h), W = Math.abs(a.w), H = Math.abs(a.h); ops.push(moveTo(x, Y(y)), lineTo(x + W, Y(y)), lineTo(x + W, Y(y + H)), lineTo(x, Y(y + H)), closePath()); }
            else if (a.type === 'oval') { const cx = a.x + a.w / 2, cy = a.y + a.h / 2, rx = Math.abs(a.w / 2), ry = Math.abs(a.h / 2); ops.push(moveTo(cx + rx, Y(cy))); for (let k = 1; k <= 32; k++) { const ang = k / 32 * 2 * Math.PI; ops.push(lineTo(cx + rx * Math.cos(ang), Y(cy + ry * Math.sin(ang)))); } ops.push(closePath()); }
            else { const pts = flattenPath(a); if (pts.length) { ops.push(moveTo(pts[0].x, Y(pts[0].y))); for (let i = 1; i < pts.length; i++) ops.push(lineTo(pts[i].x, Y(pts[i].y))); ops.push(closePath()); } }
            ops.push(clip(), endPath()); pg.pushOperators(...ops);
            const hc = hexToRgb(a.hatch.color || a.color), hcc = rgb(hc.r, hc.g, hc.b), lw = a.hatch.w || 0.8, geom = hatchGeom(a);
            for (const L of geom.lines) pg.drawLine({ start: { x: L[0], y: Y(L[1]) }, end: { x: L[2], y: Y(L[3]) }, thickness: lw, color: hcc });
            for (const D of geom.dots) { const dr = D[2] != null ? D[2] : (a.hatch.scale || 7) * 0.16; pg.drawEllipse({ x: D[0], y: Y(D[1]), xScale: dr, yScale: dr, color: hcc }); }
            pg.pushOperators(popGraphicsState());
          } catch (_) { }
        }
      }
      if (openPosOn && docScale) {   // Positionsnummern F1/T1 ins PDF
        const { posOf } = openingGroups(annos[n] || []), r = 9, tc = rgb(.11, .14, .17);
        for (const o of (annos[n] || [])) { if (o.type !== 'opening' || !posOf[o.id] || (visibleOnly && !layerVisible(o)) || !phaseVisible(o)) continue; const ang = o.ang || 0, nx = -Math.sin(ang), ny = Math.cos(ang), off = (o.thick || wallThickPts()) / 2 + r + 5, tx = o.x + nx * off, ty = o.y + ny * off, p = posOf[o.id], fs = 11, tw = font.widthOfTextAtSize(p, fs); pg.drawEllipse({ x: tx, y: Y(ty), xScale: r, yScale: r, color: rgb(1, 1, 1), borderColor: tc, borderWidth: 1.2 }); pg.drawText(p, { x: tx - tw / 2, y: Y(ty) - fs * 0.35, size: fs, font, color: tc }); }
      }
      if (cropT) pg.pushOperators(popGraphicsState());
      if (pageRot[n]) pg.setRotation(degrees(pageRot[n]));
    }
    // Ausgefüllte Formularfelder in das PDF schreiben (echte AcroForm-Werte)
    if (formValues && Object.keys(formValues).length) {
      try {
        const form = doc.getForm();
        for (const [name, val] of Object.entries(formValues)) {
          const ty = fieldTypes[name]; if (!ty) continue;
          try {
            if (ty === 'text') form.getTextField(name).setText(val == null ? '' : String(val));
            else if (ty === 'checkbox') { const cb = form.getCheckBox(name); (val && val !== 'Off') ? cb.check() : cb.uncheck(); }
            else if (ty === 'radio') { const rg = form.getRadioGroup(name); (val && val !== 'Off') ? rg.select(val) : rg.clear(); }
            else if (ty === 'dropdown') { if (val) form.getDropdown(name).select(val); }
          } catch (_) { /* Feldtyp passt nicht → überspringen */ }
        }
        try { form.updateFieldAppearances(font); } catch (_) { }
      } catch (_) { /* kein AcroForm */ }
    }
    if (nativeExport) for (const z of nativeAnns) addNativeAnnot(doc, lib, z.pg, z.a, z.PH, z.cbx, z.cby, font);   // native Markup-Annotationen schreiben
    if (embed) {   // editierbare Daten (Wände, Anmerkungen, Massstab …) + Originaldokument einbetten → in Submit PDF wieder bearbeitbar
      try {
        const proj = JSON.stringify({ v: 1, scale: docScale, annos, pageRot, viewRot, formValues, layers, activeLayerId, name: docName });
        await doc.attach(new TextEncoder().encode(proj), 'submitpdf-project.json', { mimeType: 'application/json', description: 'Submit PDF – editierbare Plandaten' });
        await doc.attach(curBytes.slice(), 'submitpdf-base.pdf', { mimeType: 'application/pdf', description: 'Submit PDF – Originaldokument (ohne Anmerkungen)' });
      } catch (e) { console.warn('Einbetten fehlgeschlagen', e); }
    }
    return await doc.save();
  }
}
async function save() {
  if (!curBytes) return; status('Speichere … (bei grossen Dateien etwas Geduld)');
  await new Promise(r => setTimeout(r, 20));            // Anzeige zuerst zeichnen lassen
  try {
    const out = await buildPdfBytes(false, true);   // editierbare Daten einbetten → wieder bearbeitbar
    let ok = true;
    if (curFileHandle) { const w = await curFileHandle.createWritable(); await w.write(out); await w.close(); status(''); toast('In Datei gespeichert ✓ (in Submit PDF wieder bearbeitbar)'); }   // direkt in die geöffnete Datei
    else if (window.nativeSave) { ok = await window.nativeSave(out, outName()); status(''); toast(ok ? 'Gespeichert ✓' : 'Abgebrochen'); }
    else { downloadBytes(out, outName()); status(''); toast('Gespeichert ✓'); }
    if (ok) { dirty = false; if (docs[active]) docs[active].dirty = false; clearAutosave(); }   // gespeichert → sauber, Autosave verwerfen
  } catch (e) { status(''); console.error(e); toast('Speichern fehlgeschlagen (Internet für Speicher-Bibliothek nötig?).'); }
}

function sanFolder(s) { return (s || '').replace(/[\\/:*?"<>|]+/g, '-').replace(/[.\s]+$/, '').trim() || 'Projekt'; }
function projectGuess() {   // Projekt aus dem Plankopf-Feld „Projekt", sonst zuletzt verwendet / Dokumentname
  for (const n in annos) for (const a of (annos[n] || [])) if (a.field === 'projekt' && a.text && a.text.trim()) return a.text.trim();
  return (docs[active] && docs[active].project) || localStorage.getItem('submitpdf_lastproject') || docName.replace(/\.pdf$/i, '');
}
function subfolderGuess() {   // passender Unterordner nach Inhalt
  const arr = getAnnos(curPage()) || [];
  if (arr.some(a => a.type === 'wall' || a.type === 'opening')) return 'Pläne';
  if (arr.some(a => a.type === 'section')) return 'Schnitte';
  return 'Dokumente';
}
function knownProjects() { try { return JSON.parse(localStorage.getItem('submitpdf_projects') || '[]'); } catch (_) { return []; } }
function rememberProject(p) { if (!p) return; const list = knownProjects().filter(x => x !== p); list.unshift(p); localStorage.setItem('submitpdf_projects', JSON.stringify(list.slice(0, 30))); localStorage.setItem('submitpdf_lastproject', p); }
function projPreviewUpd() { const pv = $('#projPreview'); if (!pv) return; const p = sanFolder($('#projName').value.trim() || 'Projekt'), s = sanFolder($('#projSub').value.trim() || 'Dokumente'), f = sanFolder(($('#projFile').value.replace(/\.pdf$/i, '') || 'plan')) + '.pdf'; pv.textContent = p + ' / ' + s + ' / ' + f; }
function openProjectDlg() {   // Dialog: Projekt zuordnen (Liste bekannter Projekte + Unterordner + Dateiname)
  if (!curBytes) return;
  $('#projName').value = projectGuess();
  $('#projList').innerHTML = knownProjects().map(p => '<option value="' + p.replace(/"/g, '&quot;') + '"></option>').join('');
  const sel = $('#projSub'), sub = subfolderGuess(); if (![...sel.options].some(o => o.value === sub)) { const o = document.createElement('option'); o.value = sub; o.textContent = sub; sel.appendChild(o); } sel.value = sub;
  $('#projFile').value = (docName.replace(/\.pdf$/i, '') || 'plan') + '.pdf';
  projPreviewUpd(); $('#projDlg').hidden = false; setTimeout(() => { $('#projName').focus(); $('#projName').select(); }, 30);
}
async function doProjectSave(proj, sub, name) {   // Datei in <Arbeitsordner>/<Projekt>/<Unterordner>/<name> ablegen
  if (!curBytes) return; proj = sanFolder(proj); sub = sanFolder(sub); name = sanFolder((name || '').replace(/\.pdf$/i, '') || 'plan') + '.pdf';
  if (!fsSupported() && !dirHandle && !window.nativeSave) { status('Speichere …'); const out = await buildPdfBytes(false, true); status(''); downloadBytes(out, proj + ' - ' + name); rememberProject(proj); toast('Projekt-Ordner brauchen einen Arbeitsordner (Chrome/Edge). Datei mit Projekt-Präfix heruntergeladen.'); return; }
  if (!dirHandle) { if (!fsSupported()) { toast('Bitte zuerst oben den Arbeitsordner öffnen (📁).'); return; } await pickFolder(); if (!dirHandle) return; }
  status('Lege im Projekt ab …'); await new Promise(r => setTimeout(r, 20));
  try {
    const out = await buildPdfBytes(false, true);
    let dir = await dirHandle.getDirectoryHandle(proj, { create: true }); dir = await dir.getDirectoryHandle(sub, { create: true });
    const fh = await dir.getFileHandle(name, { create: true }), w = await fh.createWritable(); await w.write(out); await w.close();
    curFileHandle = fh; docName = name; if (docs[active]) { docs[active].fileHandle = fh; docs[active].name = name; docs[active].project = proj; docs[active].dirty = false; }
    dirty = false; clearAutosave(); rememberProject(proj);
    const dn = $('#docName'); if (dn) dn.textContent = name; updateProjectChip();
    try { await refreshTree(); } catch (_) { }
    status(''); toast('Abgelegt in „' + proj + ' / ' + sub + '" ✓ (in Submit PDF wieder bearbeitbar)');
  } catch (e) { status(''); console.error(e); toast('Ablage ins Projekt fehlgeschlagen.'); }
}
async function exportNative() {   // unsere Anmerkungen als native PDF-Annotationen exportieren (für Acrobat/Drawboard)
  if (!curBytes) return; status('Exportiere native Anmerkungen …'); await new Promise(r => setTimeout(r, 20));
  try { const out = await buildPdfBytes(false, false, true); downloadBytes(out, docName.replace(/\.pdf$/i, '') + '-annot.pdf'); status(''); toast('Als native PDF-Anmerkungen exportiert – in Acrobat/Drawboard editierbar (CAD/Wände bleiben eingebacken).'); }
  catch (e) { status(''); console.error(e); toast('Export fehlgeschlagen.'); }
}
/* ---------- Senden per E-Mail ---------- */
function openMail() {
  if (!curBytes) return;
  const cfg = JSON.parse(localStorage.getItem('submitpdf_mail') || '{}');
  $('#mTo').value = cfg.to || ''; $('#mCc').value = cfg.cc || '';
  $('#mSub').value = cfg.sub || (docName.replace(/\.pdf$/i, '') + ' – Anmerkungen');
  $('#mBody').value = cfg.body || 'Hallo,\n\nim Anhang die markierte PDF.\n\nGruss';
  $('#mailDlg').hidden = false; $('#mTo').focus();
}
async function doSend() {
  const to = $('#mTo').value.trim(), cc = $('#mCc').value.trim(), sub = $('#mSub').value, body = $('#mBody').value;
  localStorage.setItem('submitpdf_mail', JSON.stringify({ to, cc, sub, body }));
  $('#mailDlg').hidden = true; status('Bereite Versand vor …');
  let out; try { out = await buildPdfBytes(); } catch (e) { status(''); toast('PDF konnte nicht erzeugt werden.'); return; }
  status('');
  const file = new File([out], outName(), { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: sub || file.name, text: body || '' }); return; } catch (_) { /* abgebrochen → Fallback */ }
  }
  downloadBytes(out, file.name);
  const q = [];
  if (cc) q.push('cc=' + encodeURIComponent(cc));
  if (sub) q.push('subject=' + encodeURIComponent(sub));
  q.push('body=' + encodeURIComponent((body || '') + '\n\n(„' + file.name + '" wurde heruntergeladen – bitte noch anhängen.)'));
  window.location.href = 'mailto:' + encodeURIComponent(to) + '?' + q.join('&');
  toast('PDF heruntergeladen · Mail geöffnet → PDF anhängen.');
}

/* ---------- Unterschrift ---------- */
let pendingSig = null;       // {data, ratio} – bereit zum Platzieren
let _sigCtx = null, _sigDraw = false, _sigEmpty = true;
function openSig() {
  const dlg = $('#sigDlg'), cv = $('#sigCanvas');
  const saved = localStorage.getItem('submitpdf_sig');
  $('#sigSaved').hidden = !saved; if (saved) $('#sigSavedImg').src = saved;
  $('#sigName').value = localStorage.getItem('submitpdf_signame') || '';
  dlg.hidden = false;
  // Canvas auf Anzeigegrösse bringen
  const r = cv.getBoundingClientRect(); cv.width = Math.round(r.width); cv.height = Math.round(r.height);
  _sigCtx = cv.getContext('2d'); _sigCtx.lineCap = 'round'; _sigCtx.lineJoin = 'round'; _sigCtx.lineWidth = 2.6; _sigCtx.strokeStyle = '#14213d';
  _sigEmpty = true;
}
function sigPos(e) { const cv = $('#sigCanvas'), r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function sigDown(e) { _sigDraw = true; _sigEmpty = false; const p = sigPos(e); _sigCtx.beginPath(); _sigCtx.moveTo(p.x, p.y); e.preventDefault(); }
function sigMove(e) { if (!_sigDraw) return; const p = sigPos(e); _sigCtx.lineTo(p.x, p.y); _sigCtx.stroke(); }
function sigUp() { _sigDraw = false; }
function sigClear() { const cv = $('#sigCanvas'); _sigCtx.clearRect(0, 0, cv.width, cv.height); _sigEmpty = true; }
// Auf Inhalt zuschneiden → dataURL + Seitenverhältnis
function sigToData(cv) {
  const w = cv.width, h = cv.height, d = cv.getContext('2d').getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = 0, y1 = 0, any = false;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { if (d[(y * w + x) * 4 + 3] > 10) { any = true; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
  if (!any) return null;
  const pad = 6; x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w, x1 + pad); y1 = Math.min(h, y1 + pad);
  const cw = x1 - x0, ch = y1 - y0, out = document.createElement('canvas'); out.width = cw; out.height = ch;
  out.getContext('2d').drawImage(cv, x0, y0, cw, ch, 0, 0, cw, ch);
  return { data: out.toDataURL('image/png'), ratio: cw / ch };
}
function useSig(fromSaved) {
  let sig;
  if (fromSaved) { const s = localStorage.getItem('submitpdf_sig'); if (!s) return; const tmp = new Image(); sig = { data: s, ratio: 0 }; }
  else { if (_sigEmpty) { toast('Bitte zuerst unterschreiben.'); return; } sig = sigToData($('#sigCanvas')); if (!sig) return; localStorage.setItem('submitpdf_sig', sig.data); }
  $('#sigDlg').hidden = true;
  // Signatur-Block: Name + Datum/Uhrzeit (lokal, kein Upload)
  const name = ($('#sigName').value || '').trim(), withDate = $('#sigDate').checked;
  localStorage.setItem('submitpdf_signame', name);
  let caption = '';
  if (name) caption += name;
  if (withDate) caption += (caption ? ' · ' : '') + 'Signiert ' + new Date().toLocaleString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const finish = ratio => { pendingSig = { data: sig.data, ratio: ratio || 3, caption }; setTool('sig'); toast('Auf den Plan tippen, um die Unterschrift zu setzen.'); };
  if (sig.ratio) finish(sig.ratio);
  else { const im = new Image(); im.onload = () => finish(im.naturalWidth / im.naturalHeight); im.src = sig.data; }
}
let pendingStamp = null;
function placeStamp(pv, p) {
  if (!pendingStamp) { setTool('select'); return; }
  pushUndo();
  const k = pendingStamp.kind; let w, h, text = pendingStamp.text || '';
  if (k === 'label') { if (text === '__DATE__') text = new Date().toLocaleDateString('de-CH'); const fs = 18; w = Math.round(text.length * fs * 0.64) + 18; h = 30; }
  else { w = 34; h = 34; }
  const a = { id: nextId++, type: 'stamp', kind: k, text, x: p.x - w / 2, y: p.y - h / 2, w, h, color: pendingStamp.color };
  pushAnno(pv.num, a); sel = { num: pv.num, id: a.id }; setTool('select'); drawAnnos(pv); saveState();
}
function placeSig(pv, p) {
  if (!pendingSig) { setTool('select'); return; }
  pushUndo(); const w = 170, h = w / (pendingSig.ratio || 3);
  const a = { id: nextId++, type: 'sig', x: p.x - w / 2, y: p.y - h / 2, w, h, data: pendingSig.data, caption: pendingSig.caption || '' };
  pushAnno(pv.num, a); sel = { num: pv.num, id: a.id }; setTool('select'); drawAnnos(pv); saveState();
}

/* ---------- Massstab ---------- */
let _calibLen = 0;
function openScale(calibLen) {
  _calibLen = calibLen || 0;
  $('#scaleCalib').hidden = !_calibLen; $('#scaleRatioRow').hidden = !!_calibLen;
  if (docScale && docScale.n) $('#scaleRatio').value = docScale.n;
  $('#scaleDlg').hidden = false; (_calibLen ? $('#scaleReal') : $('#scaleRatio')).focus();
}
function applyScale() {
  pushUndo();   // Massstab-Änderung rückgängig-fähig
  if (_calibLen) {
    const v = parseFloat(($('#scaleReal').value || '').replace(',', '.')), u = $('#scaleUnit').value;
    if (!(v > 0)) { $('#scaleDlg').hidden = true; return; }
    const meters = u === 'm' ? v : u === 'cm' ? v / 100 : v / 1000;
    docScale = { perPt: meters / _calibLen, label: 'kalibriert' };
  } else {
    const n = parseFloat(($('#scaleRatio').value || '').replace(',', '.'));
    if (!(n > 0)) { $('#scaleDlg').hidden = true; return; }
    docScale = { perPt: n * PT2MM / 1000, label: '1:' + Math.round(n), n: Math.round(n) };
  }
  $('#scaleDlg').hidden = true; updateScaleLabel(); if (docScale) fillPlanField('scale', docScale.label); pageViews.forEach(drawAnnos); toast('Massstab gesetzt'); const after = _scaleAfter; _scaleAfter = null; setTool(after || 'measure');
}
function updateScaleLabel() {
  const lab = docScale ? (docScale.label === 'kalibriert' ? '⟂ kalibriert' : docScale.label) : '';
  const el = $('#scaleInd'); if (el) el.textContent = lab;
  const fs = $('#footScale'); if (fs) fs.textContent = lab || '—';
}
function fmtName(w, h) {
  const near = (a, b) => Math.abs(a - b) < 4, S = [['A4', 595, 842], ['A3', 842, 1191], ['A2', 1191, 1684], ['A1', 1684, 2384], ['A0', 2384, 3370], ['Letter', 612, 792]];
  for (const [n, a, b] of S) { if (near(w, a) && near(h, b)) return n + ' hoch'; if (near(w, b) && near(h, a)) return n + ' quer'; }
  return Math.round(w * PT2MM) + '×' + Math.round(h * PT2MM) + ' mm';
}
function updateFormatLabel() {
  const el = $('#footFormat'); if (!el) return;
  const pv = pageViews.find(p => p.num === curPage()) || pageViews[0];
  el.textContent = pv ? fmtName(pv.pageW, pv.pageH) : '—';
}
async function changePageFormat(w, h) {   // aktuelle Seite auf neues Blattformat bringen
  if (!curBytes) return; pushDocUndo(); status('Format wird geändert …');
  try {
    const lib = await loadPdfLib(), out = await lib.PDFDocument.load(curBytes.slice(), { ignoreEncryption: true });
    const n = curPage(), pg = out.getPages()[n - 1]; if (pg) pg.setSize(w, h);
    curBytes = new Uint8Array(await out.save()); await loadDoc(curBytes.slice());
    const hadPlan = (getAnnos(curPage()) || []).some(a => a.pkGid);
    reflowPlanGroups(curPage(), w, h);   // Plankopf/Rahmen mit dem Format mitziehen
    const pv = pageViews.find(p => p.num === curPage()); if (pv) drawAnnos(pv);
    status(''); updateFormatLabel(); saveState(); toast('Blattformat geändert ✓' + (hadPlan ? ' – Plankopf angepasst' : ''));
  } catch (e) { status(''); console.error(e); if (undoStack.length) undoStack.pop(); toast('Format-Änderung fehlgeschlagen.'); }
}
// „Kein Blatt" erkennen: kein Standardformat + sehr flach/schmal oder extremes Seitenverhältnis (z. B. ein exportierter Tabellen-Streifen)
function isOddSheet(w, h) {
  const near = (a, b) => Math.abs(a - b) < 6, S = [[595, 842], [842, 1191], [1191, 1684], [1684, 2384], [2384, 3370], [612, 792]];
  for (const [a, b] of S) { if ((near(w, a) && near(h, b)) || (near(w, b) && near(h, a))) return false; }
  const ar = Math.max(w, h) / Math.max(1, Math.min(w, h));
  return Math.min(w, h) < 420 || ar > 2.2;
}
// Geometrie skalieren + verschieben (Anno-Raum, y von oben): newCoord = coord*s + offset. Für s=1 reine Verschiebung.
function sxAnno(a, o, s, dx, dy) {
  const P = p => [p[0] * s + dx, p[1] * s + dy];
  if (['line', 'arrow', 'measure', 'dim', 'arc', 'wall', 'stairs', 'beam'].includes(a.type)) { a.x1 = o.x1 * s + dx; a.y1 = o.y1 * s + dy; a.x2 = o.x2 * s + dx; a.y2 = o.y2 * s + dy; }
  else if (['pen', 'area', 'chaindim', 'slab', 'terrain'].includes(a.type)) a.pts = o.pts.map(P);
  else if (a.type === 'profile') a.path = o.path.map(P);
  else if (a.type === 'path') a.nodes = o.nodes.map(nd => ({ x: nd.x * s + dx, y: nd.y * s + dy, hIn: { x: nd.hIn.x * s + dx, y: nd.hIn.y * s + dy }, hOut: { x: nd.hOut.x * s + dx, y: nd.hOut.y * s + dy } }));
  else if (a.type === 'highlight') a.rects = o.rects.map(r => ({ x: r.x * s + dx, y: r.y * s + dy, w: r.w * s, h: r.h * s }));
  else if (a.type === 'section') { a.ox = o.ox * s + dx; a.oy = o.oy * s + dy; }
  else { a.x = o.x * s + dx; a.y = o.y * s + dy; if (o.w != null) a.w = o.w * s; if (o.h != null) a.h = o.h * s; }
  if (s !== 1) { if (o.width != null) a.width = o.width * s; if (o.size != null) a.size = o.size * s; if (o.fontSize != null) a.fontSize = o.fontSize * s; if (o.r != null) a.r = o.r * s; }
}
// Aktuellen Seiteninhalt (vektortreu) auf ein A4-Blatt legen – Ausrichtung ha=l|c|r, va=t|c|b. Rundherum bleibt Platz für Anmerkungen.
async function mountOnSheet(va, ha) {
  if (!curBytes) return; va = va || 't'; ha = ha || 'c';
  const n = curPage(), pv = pageViews.find(p => p.num === n); if (!pv) return;
  const cw = pv.pageW, ch = pv.pageH;
  const land = cw > ch, SW = land ? 842 : 595, SH = land ? 595 : 842, m = 24;   // A4, Orientierung nach Inhalt, Rand ~8.5 mm
  const s = Math.min(1, (SW - 2 * m) / cw, (SH - 2 * m) / ch), dw = cw * s, dh = ch * s;
  const dx = ha === 'l' ? m : ha === 'r' ? (SW - m - dw) : (SW - dw) / 2;
  const dyTop = va === 't' ? m : va === 'b' ? (SH - m - dh) : (SH - dh) / 2;
  pushDocUndo(); status('Auf A4-Blatt legen …'); await new Promise(r => setTimeout(r, 10));
  try {
    const lib = await loadPdfLib();
    const srcDoc = await lib.PDFDocument.load(curBytes.slice(), { ignoreEncryption: true });
    const out = await lib.PDFDocument.create();
    const total = srcDoc.getPageCount();
    const [emb] = await out.embedPages([srcDoc.getPage(n - 1)]);
    for (let i = 0; i < total; i++) {
      if (i === n - 1) { const pg = out.addPage([SW, SH]); pg.drawPage(emb, { x: dx, y: SH - dyTop - dh, width: dw, height: dh }); }   // pdf-lib: Ursprung unten-links → y = SH − oben − Höhe
      else { const [cp] = await out.copyPages(srcDoc, [i]); out.addPage(cp); }
    }
    // vorhandene Anmerkungen dieser Seite mitskalieren/-verschieben, damit sie auf dem Inhalt bleiben
    for (const a of (annos[n] || [])) { const o = JSON.parse(JSON.stringify(a)); sxAnno(a, o, s, dx, dyTop); }
    pageRot[n] = 0;
    curBytes = new Uint8Array(await out.save()); await loadDoc(curBytes.slice());
    status(''); updateFormatLabel(); saveState();
    toast('Auf A4 gelegt ✓ – jetzt rundherum frei beschriften. Andere Ausrichtung: unten „Format".');
  } catch (e) { status(''); console.error(e); if (undoStack.length) undoStack.pop(); toast('Auf A4 legen fehlgeschlagen.'); }
}
function toastAction(msg, label, fn) {   // Hinweis-Toast mit einem Aktions-Knopf (länger sichtbar)
  const r = $('#toast-root'); if (!r) return; const t = document.createElement('div'); t.className = 'toast';
  const s = document.createElement('span'); s.textContent = msg; t.appendChild(s);
  const b = document.createElement('button'); b.className = 'toast-act'; b.textContent = label; b.onclick = () => { t.remove(); fn(); }; t.appendChild(b);
  r.appendChild(t); setTimeout(() => t.remove(), 9000);
}
let _oddOfferedSig = null;
function maybeOfferMount() {   // beim Öffnen: flaches/„kein Blatt"-Dokument → einmalig je Dokument anbieten, auf A4 zu legen
  if (!pageViews.length) return; const pv = pageViews[0]; if (!pv) return;
  let sig; try { sig = docSig(); } catch (_) { sig = docName; }
  if (sig === _oddOfferedSig) return; _oddOfferedSig = sig;
  if (isOddSheet(pv.pageW, pv.pageH)) toastAction('Diese Seite ist kein Standard-Blatt. ', 'Auf A4 legen', () => mountOnSheet('t', 'c'));
}
/* ---------- 3D-Ansicht: Wände mit Höhe extrudieren (Three.js) ---------- */
function loadThree() {
  if (window.THREE && THREE.OrbitControls) return Promise.resolve();
  return loadScript('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js').then(() => loadScript('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js'));
}
function dayOfYearOf(y, m, d) { const cum = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334], leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; return cum[(m - 1) % 12] + d + ((leap && m > 2) ? 1 : 0); }
function solarPosition(latDeg, doy, hour) {   // Sonnenstand: Höhe (Elevation) + Azimut aus Breitengrad, Tag im Jahr, (Solar-)Stunde
  const rad = Math.PI / 180, lat = latDeg * rad;
  const decl = 23.45 * rad * Math.sin(2 * Math.PI * (284 + doy) / 365);   // Deklination
  const H = (hour - 12) * 15 * rad;                                       // Stundenwinkel
  const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H);
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  let cosAz = (Math.sin(decl) - Math.sin(el) * Math.sin(lat)) / ((Math.cos(el) * Math.cos(lat)) || 1e-6);
  cosAz = Math.max(-1, Math.min(1, cosAz));
  let az = Math.acos(cosAz); if (H > 0) az = 2 * Math.PI - az;            // 0 = Nord, 90 = Ost, 180 = Süd, 270 = West; nachmittags → West
  return { el, az, elDeg: el / rad, azDeg: az / rad };
}
function exportSceneObj(scene) {   // THREE-Szene → Wavefront .obj (nur solide Meshes, ohne Boden/Raster/Linien)
  let out = '# Submit PDF – 3D-Modell-Export (Wavefront OBJ)\n', vCount = 0, n = 0; const v = new THREE.Vector3();
  scene.traverse(obj => {
    if (!obj.isMesh || obj.name === 'ground' || (obj.name && obj.name.indexOf('__') === 0)) return;
    const geo = obj.geometry; if (!geo || !geo.attributes || !geo.attributes.position) return;
    obj.updateWorldMatrix(true, false);
    const pos = geo.attributes.position, idx = geo.index, base = vCount; n++;
    out += 'o ' + (obj.name || ('teil_' + n)) + '\n';
    for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); v.applyMatrix4(obj.matrixWorld); out += 'v ' + v.x.toFixed(4) + ' ' + v.y.toFixed(4) + ' ' + v.z.toFixed(4) + '\n'; vCount++; }
    if (idx) { for (let i = 0; i < idx.count; i += 3) out += 'f ' + (idx.getX(i) + base + 1) + ' ' + (idx.getX(i + 1) + base + 1) + ' ' + (idx.getX(i + 2) + base + 1) + '\n'; }
    else { for (let i = 0; i < pos.count; i += 3) out += 'f ' + (base + i + 1) + ' ' + (base + i + 2) + ' ' + (base + i + 3) + '\n'; }
  });
  return { obj: out, parts: n, verts: vCount };
}
function downloadText(str, name, mime) { const blob = new Blob([str], { type: mime || 'text/plain' }), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500); }
function saveObjFrom(api, baseName) {
  if (!api || !api.exportObj) return; const r = api.exportObj(); if (!r || !r.parts) { toast('Keine 3D-Geometrie zum Exportieren.'); return; }
  downloadText(r.obj, (baseName || 'modell').replace(/\.[a-z0-9]+$/i, '').replace(/[^\w.-]+/g, '_') + '.obj', 'model/obj');
  toast('OBJ exportiert: ' + r.parts + ' Teile, ' + r.verts + ' Punkte (Blender/SketchUp/…).');
}
async function open3D() {
  if (!docScale) { toast('Für die 3D-Ansicht zuerst den Massstab setzen (1:n).'); return; }
  const arr = getAnnos(curPage()) || [], walls = arr.filter(a => a.type === 'wall' && layerVisible(a) && phaseVisible(a)), extra3d = arr.filter(a => (a.type === 'mesh3d' || a.type === 'profile' || a.type === 'slab' || a.type === 'block') && layerVisible(a) && phaseVisible(a));
  if (!walls.length && !extra3d.length) { toast('Auf dieser (sichtbaren) Ebene sind keine Wände/3D-Objekte für die 3D-Ansicht.'); return; }
  status('3D wird geladen …');
  try { await loadThree(); } catch (_) { status(''); toast('3D-Engine nicht ladbar (einmal Internet nötig).'); return; }
  if (!window.polygonClipping) { try { await loadScript('https://cdn.jsdelivr.net/npm/polygon-clipping@0.15.7/dist/polygon-clipping.umd.js'); } catch (_) { } }   // für Geschossdecken-Footprint
  status('');
  const ov = document.createElement('div'); ov.className = 'd3-overlay';
  ov.innerHTML = '<div class="d3-bar"><b>3D-Ansicht</b><label class="d3-h">Höhe <input type="number" id="d3h" min="1" max="20" step="0.1" value="' + wallHeightM + '"> m</label><span class="d3-views"><button class="btn" data-v="iso">Iso</button><button class="btn" data-v="top">Oben</button><button class="btn" data-v="front">Vorne</button><button class="btn" data-v="side">Seite</button><button class="btn" id="d3Fly" title="Fliegen: W/A/S/D bewegen · Maus ziehen = schauen · E/Leer hoch · Q/Strg runter · Shift = schneller · Taste F schaltet um">✈ Fliegen</button></span><span class="d3-views"><button class="btn" id="d3Rot" title="Modell automatisch drehen (Turntable)">🔄 Dreh</button><label class="d3-h" title="Sonnenstand / Verschattung: Breitengrad (°N) · Datum · Tageszeit – echte Sonnenstands-Berechnung">☀ <input type="number" id="d3Lat" value="47" min="-66" max="66" step="0.5" style="width:44px" title="Breitengrad °N (z. B. Zürich 47, Berlin 52, Wien 48)">° <input type="date" id="d3Date" style="width:122px"> <input type="range" id="d3Sun" min="0" max="100" value="50" style="width:74px;vertical-align:middle"> <span id="d3SunInfo" style="font-variant-numeric:tabular-nums;opacity:.85">–</span></label><button class="btn" id="d3SunPlay" title="Sonnenlauf über den Tag abspielen">▶</button><button class="btn" id="d3Rec" title="Als Video (WebM) aufnehmen – dreht automatisch für einen Turntable">⏺ Video</button></span><span class="d3-hint">Ziehen = drehen · Mausrad = zoomen</span><span class="grow"></span><button class="btn" id="d3Add" title="Wand im 3D zeichnen: Boden anklicken (Start) → nochmal (Ende), mit Snapping an Wandenden. Knopf erneut = aus.">➕ Wand</button><button class="btn' + (show3DSlabs ? ' on' : '') + '" id="d3Slab" title="Geschossdecken/Bodenplatte (aus Wand-Footprint) ein-/ausblenden">▦ Decken</button><button class="btn" id="d3Obj" title="3D-Modell als OBJ exportieren (Blender/SketchUp/Rhino …)">⭳ OBJ</button><button class="btn" id="d3Shot">📷 Auf Plan</button><button class="btn" id="d3Close">✕ Schliessen</button></div><div class="d3-canvas" id="d3Canvas"></div>';
  document.body.appendChild(ov);
  const host = ov.querySelector('#d3Canvas');
  let api = null;
  let addOn = false;
  const d3Sel = document.createElement('div'); d3Sel.className = 'd3-sel'; d3Sel.hidden = true; ov.appendChild(d3Sel);
  const findAnnoAny = id => { for (const nn in annos) { const f = (annos[nn] || []).find(x => x.id === id); if (f) return f; } return null; };
  function show3DSettings(id) {
    const a = findAnnoAny(id); if (!a) { d3Sel.hidden = true; return; }
    const apply = () => { mk(true); pageViews.forEach(drawAnnos); markDirty(); };
    const row = (lbl, rid, val, unit, step) => '<label class="d3-sr"><span>' + lbl + '</span><input id="' + rid + '" type="number" step="' + (step || 1) + '" value="' + val + '">' + (unit ? '<em>' + unit + '</em>' : '') + '</label>';
    const title = a.type === 'wall' ? 'Wand' : (a.type === 'opening' ? (a.kind === 'window' ? 'Fenster' : 'Tür') : (a.belag ? 'Bodenbelag' : (a.wallface ? 'Wandbelag' : 'Bauteil')));
    let h = '<div class="d3-sel-h"><b>' + title + '</b><button id="d3SelX" title="Schliessen">✕</button></div>';
    if (a.type === 'wall') h += row('Stärke', 'sw_t', Math.round(ptsToCm(a.thick || wallThickPts())), 'cm') + row('Höhe', 'sw_h', a.h3d || wallHeightM, 'm', 0.05) + '<div class="d3-sr" style="gap:6px;margin-top:8px"><button class="btn" id="sw_win" style="flex:1">+ Fenster</button><button class="btn" id="sw_door" style="flex:1">+ Tür</button></div>';
    else if (a.belag) { const b = a.belag; h += row('Platte B', 'sb_w', b.tileW, 'cm') + row('Platte H', 'sb_h', b.tileH, 'cm') + row('Fuge', 'sb_j', b.joint != null ? b.joint : 3, 'mm') + row('Verschnitt', 'sb_v', b.waste != null ? b.waste : 8, '%'); }
    else if (a.wallface) { const b = a.belag || (a.belag = { ...DEFAULT_BELAG }); h += row('Höhe', 'swf_h', a.height || wallHeightM, 'm', 0.05) + row('Platte B', 'sb_w', b.tileW, 'cm') + row('Platte H', 'sb_h', b.tileH, 'cm'); }
    else if (a.type === 'opening') { h += '<div class="d3-sr"><span>Art</span><span style="display:inline-flex;gap:4px"><button class="insp-mini' + (a.kind === 'window' ? ' on' : '') + '" id="so_kw" style="width:auto;padding:0 8px">Fenster</button><button class="insp-mini' + (a.kind === 'door' ? ' on' : '') + '" id="so_kd" style="width:auto;padding:0 8px">Tür</button></span></div>' + row('Breite', 'so_w', Math.round(ptsToCm(a.w || cmToPts(90))), 'cm') + row('Brüstung', 'so_s', a.sill || 0, 'm', 0.05) + row('Sturz', 'so_h', a.head || (a.kind === 'window' ? 2.1 : 2.0), 'm', 0.05); }
    else h += '<p class="d3-sr" style="opacity:.7">Für diesen Typ (noch) keine 3D-Einstellungen.</p>';
    d3Sel.innerHTML = h; d3Sel.hidden = false;
    d3Sel.querySelector('#d3SelX').onclick = () => { d3Sel.hidden = true; };
    const bind = (rid, fn) => { const el = d3Sel.querySelector('#' + rid); if (el) el.onchange = () => { const v = parseFloat((el.value || '').replace(',', '.')); if (isFinite(v)) { fn(v); apply(); } }; };
    if (a.type === 'wall') { bind('sw_t', v => a.thick = cmToPts(Math.max(1, v))); bind('sw_h', v => a.h3d = Math.max(0.5, v));
      const bwin = d3Sel.querySelector('#sw_win'); if (bwin) bwin.onclick = () => { addOpeningToWall(a, 'window', curPage()); apply(); toast('Fenster gesetzt (mittig) – im Grundriss verschieben/anpassen.'); };
      const bdoor = d3Sel.querySelector('#sw_door'); if (bdoor) bdoor.onclick = () => { addOpeningToWall(a, 'door', curPage()); apply(); toast('Tür gesetzt (mittig) – im Grundriss verschieben/anpassen.'); }; }
    else if (a.belag) { bind('sb_w', v => a.belag.tileW = v); bind('sb_h', v => a.belag.tileH = v); bind('sb_j', v => a.belag.joint = v); bind('sb_v', v => a.belag.waste = v); }
    else if (a.wallface) { bind('swf_h', v => a.height = Math.max(0.1, v)); bind('sb_w', v => a.belag.tileW = v); bind('sb_h', v => a.belag.tileH = v); }
    else if (a.type === 'opening') { bind('so_w', v => a.w = cmToPts(Math.max(20, v))); bind('so_s', v => a.sill = Math.max(0, v)); bind('so_h', v => a.head = Math.max((a.sill || 0) + 0.3, v));
      const kw = d3Sel.querySelector('#so_kw'); if (kw) kw.onclick = () => { a.kind = 'window'; if (!a.sill) a.sill = 0.9; apply(); show3DSettings(id); };
      const kd = d3Sel.querySelector('#so_kd'); if (kd) kd.onclick = () => { a.kind = 'door'; a.sill = 0; apply(); show3DSettings(id); }; }
  }
  const mk = keepCam => { const cam = keepCam && api && api.camState ? api.camState() : null; if (api) api.dispose(); const curWalls = arr.filter(a => a.type === 'wall' && layerVisible(a) && phaseVisible(a)); api = build3DScene(host, curWalls, arr, { initCam: cam, onEdit: () => { pageViews.forEach(drawAnnos); markDirty(); mk(true); applySun(); }, onPick: id => show3DSettings(id) }); if (addOn && api.setAddMode) api.setAddMode(true); };
  mk(false);
  if (walls.length) toast('3D-Editor: 🔵 Wandende (Snap) · ▭ grau Wand verschieben · 🌸 pink Höhe · 🟣 Möbel/Stütze · 🟡 drehen · 🟢 Fenster · Griff anklicken + Entf = löschen.');
  ov.querySelector('#d3h').onchange = e => { wallHeightM = Math.max(1, Math.min(20, parseFloat(e.target.value) || 2.6)); mk(true); };
  ov.querySelector('#d3Slab').onclick = e => { show3DSlabs = !show3DSlabs; e.currentTarget.classList.toggle('on', show3DSlabs); mk(true); };
  ov.querySelector('#d3Add').onclick = e => { addOn = !addOn; e.currentTarget.classList.toggle('on', addOn); if (api && api.setAddMode) api.setAddMode(addOn); toast(addOn ? 'Wand zeichnen: Boden anklicken (Start) → nochmal (Ende). Knopf erneut = aus.' : 'Wand-Zeichnen aus.'); };
  ov.querySelector('#d3Obj').onclick = () => saveObjFrom(api, docName);
  ov.querySelector('#d3Fly').onclick = e => { const on = !(api && api.getFly && api.getFly()); if (api && api.setFly) api.setFly(on); e.currentTarget.classList.toggle('on', on); toast(on ? 'Fliegen ✈  W/A/S/D bewegen · Maus ziehen = schauen · E/Leer hoch · Q/Strg runter · Shift = schneller · F = zurück' : 'Umkreisen (Maus)'); };
  let sunRAF = 0, rec = null; const sunIn = ov.querySelector('#d3Sun'), latIn = ov.querySelector('#d3Lat'), dateIn = ov.querySelector('#d3Date'), sunInfo = ov.querySelector('#d3SunInfo');
  const td = new Date(); dateIn.value = td.getFullYear() + '-' + ('0' + (td.getMonth() + 1)).slice(-2) + '-' + ('0' + td.getDate()).slice(-2);
  const applySun = () => {
    const lat = parseFloat((latIn.value || '47').replace(',', '.')); const p = (dateIn.value || '2025-06-21').split('-'), doy = dayOfYearOf(+p[0] || 2025, +p[1] || 6, +p[2] || 21);
    const hour = 4 + (sunIn.value / 100) * 18, sp = solarPosition(isNaN(lat) ? 47 : lat, doy, hour);   // 4:00 … 22:00
    if (api && api.setSunDir) api.setSunDir(sp.az, sp.el);
    const hh = Math.floor(hour), mm = Math.round((hour - hh) * 60); sunInfo.textContent = ('0' + hh).slice(-2) + ':' + ('0' + (mm % 60)).slice(-2) + ' · ' + (sp.elDeg >= 0 ? Math.round(sp.elDeg) + '° hoch' : 'Nacht');
  };
  sunIn.oninput = applySun; latIn.onchange = applySun; dateIn.onchange = applySun; applySun();
  ov.querySelector('#d3Rot').onclick = e => { const on = !(api && api.getRotate && api.getRotate()); if (api && api.setRotate) api.setRotate(on); e.currentTarget.classList.toggle('on', on); };
  ov.querySelector('#d3SunPlay').onclick = e => {
    const btn = e.currentTarget;
    if (sunRAF) { cancelAnimationFrame(sunRAF); sunRAF = 0; btn.textContent = '▶'; return; }
    btn.textContent = '⏸'; let val = 0;
    const step = () => { val += 0.6; if (val >= 100) val = 100; sunIn.value = val; applySun(); if (val < 100) sunRAF = requestAnimationFrame(step); else { sunRAF = 0; btn.textContent = '▶'; } };
    step();
  };
  ov.querySelector('#d3Rec').onclick = e => {
    const btn = e.currentTarget, canvas = host.querySelector('canvas');
    if (rec && rec.state === 'recording') { rec.stop(); return; }
    if (!canvas || !canvas.captureStream) { toast('Video-Aufnahme in diesem Browser nicht verfügbar.'); return; }
    let stream; try { stream = canvas.captureStream(30); } catch (_) { toast('Aufnahme nicht möglich.'); return; }
    const chunks = []; try { rec = new MediaRecorder(stream, { mimeType: 'video/webm' }); } catch (_) { toast('WebM wird in diesem Browser nicht unterstützt.'); rec = null; return; }
    rec.ondataavailable = ev => { if (ev.data && ev.data.size) chunks.push(ev.data); };
    rec.onstop = () => { if (api && api.setRotate) api.setRotate(false); const blob = new Blob(chunks, { type: 'video/webm' }), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = (docName || 'modell').replace(/\.[a-z0-9]+$/i, '') + '.webm'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000); btn.classList.remove('on'); btn.textContent = '⏺ Video'; toast('Video gespeichert (WebM).'); rec = null; };
    if (api && api.setRotate) api.setRotate(true);   // Turntable während der Aufnahme
    rec.start(); btn.classList.add('on'); btn.textContent = '⏹ Stop'; toast('Aufnahme läuft … nochmal „Stop" klicken zum Speichern.');
  };
  ov.querySelectorAll('.d3-views button').forEach(b => b.onclick = () => { if (api && api.setView) api.setView(b.dataset.v); });
  ov.querySelector('#d3Shot').onclick = () => { if (!api || !api.snapshot) return; const s = api.snapshot(); close(); place3DImage(s.data, s.w, s.h); };
  const close = () => { if (sunRAF) cancelAnimationFrame(sunRAF); if (rec && rec.state === 'recording') { try { rec.onstop = null; rec.stop(); } catch (_) { } } if (api) api.dispose(); ov.remove(); document.removeEventListener('keydown', esc, true); };
  const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } };
  document.addEventListener('keydown', esc, true);
  ov.querySelector('#d3Close').onclick = close;
}
/* ===================== IFC-Import (ArchiCAD/Allplan → BIM via web-ifc/WASM) ===================== */
let _webifc = null, ifcShowEnv = false, ifcUpAxis = 'y';   // ifcShowEnv: Umgebung anzeigen? · ifcUpAxis: welche Achse ist „oben" (vom Nutzer korrigierbar)
function ifcRemap(p) { return ifcUpAxis === 'z' ? [p[0], p[2], p[1]] : ifcUpAxis === 'x' ? [p[1], p[0], p[2]] : [p[0], p[1], p[2]]; }   // (Welt) → [planX, Höhe, planZ]
function ifcHeightMin(ifc) { const b = ifc.bbox; return ifcUpAxis === 'z' ? b.minz : ifcUpAxis === 'x' ? b.minx : b.miny; }
function ifcHeightExt(ifc) { const b = ifc.bbox; return ifcUpAxis === 'z' ? (b.maxz - b.minz) : ifcUpAxis === 'x' ? (b.maxx - b.minx) : (b.maxy - b.miny); }
function _ab2b64(buf) { const b = new Uint8Array(buf); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }
function _b642ab(str) { const s = atob(str), b = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i); return b.buffer; }
function encodeMesh3d(pos, idx) {   // Positionen (Float32) + Indizes → kompakt: 16-bit quantisiert über Bbox, base64
  const n = pos.length / 3; let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (let i = 0; i < n; i++) { const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2]; if (x < mnx) mnx = x; if (y < mny) mny = y; if (z < mnz) mnz = z; if (x > mxx) mxx = x; if (y > mxy) mxy = y; if (z > mxz) mxz = z; }
  const bmin = [mnx, mny, mnz], bsz = [(mxx - mnx) || 1, (mxy - mny) || 1, (mxz - mnz) || 1], q = new Int16Array(pos.length);
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) { const t = (pos[i * 3 + a] - bmin[a]) / bsz[a]; q[i * 3 + a] = Math.round(Math.max(0, Math.min(1, t)) * 32767); }
  const bits = n <= 65535 ? 16 : 32, ia = bits === 16 ? Uint16Array.from(idx) : Uint32Array.from(idx);
  return { v: _ab2b64(q.buffer), i: _ab2b64(ia.buffer), bits, n, bmin, bsz, ic: idx.length };
}
function decodeMesh3d(e) {
  const q = new Int16Array(_b642ab(e.v)), n = e.n, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) for (let a = 0; a < 3; a++) pos[i * 3 + a] = e.bmin[a] + (q[i * 3 + a] / 32767) * e.bsz[a];
  return { pos, idx: e.bits === 16 ? new Uint16Array(_b642ab(e.i)) : new Uint32Array(_b642ab(e.i)) };
}
let meshSliceH = null;   // IFC-/Mesh-Höhenschnitt: null = aus, sonst Höhe in m (echter 3D-Schnitt → Grundriss)
let USE_SOLID = false;   // STANDARD: bewährte, akkurate Schnitt-Logik (war „immer sehr gut"). Kanonisch (elementSolids/slicePlane) optional via A/B-Knopf „⬛ Solid-Schnitt"
function meshLev(a) { const l = layerById(a.layer); return (l && l.elevation) || 0; }
function sliceMesh3d(a, hWorld) {   // schneidet das echte 3D-Mesh an der horizontalen Ebene y=hWorld → Grundriss-Segmente [x1,y1,x2,y2] (Plan-Punkte)
  if (!a.enc) return []; let d; try { d = decodeMesh3d(a.enc); } catch (_) { return []; }
  const pos = d.pos, idx = d.idx, yL = hWorld - meshLev(a), segs = [];
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const i0 = idx[t] * 3, i1 = idx[t + 1] * 3, i2 = idx[t + 2] * 3;
    const E = [[pos[i0], pos[i0 + 1], pos[i0 + 2], pos[i1], pos[i1 + 1], pos[i1 + 2]], [pos[i1], pos[i1 + 1], pos[i1 + 2], pos[i2], pos[i2 + 1], pos[i2 + 2]], [pos[i2], pos[i2 + 1], pos[i2 + 2], pos[i0], pos[i0 + 1], pos[i0 + 2]]];
    const P = [];
    for (const e of E) { const y1 = e[1] - yL, y2 = e[4] - yL; if ((y1 <= 0 && y2 > 0) || (y2 <= 0 && y1 > 0)) { const tt = y1 / (y1 - y2); P.push([e[0] + (e[3] - e[0]) * tt, e[2] + (e[5] - e[2]) * tt]); } }
    if (P.length === 2) segs.push([P[0][0] + a.x, P[0][1] + a.y, P[1][0] + a.x, P[1][1] + a.y]);
  }
  return segs;
}
/* ===== Kanonische Bauteil-Geometrie (Stufe 1) – EINE Quelle für Plan/Schnitt/Ansicht/3D =====
   Solid = { poly:[[x,y]…] (Grundriss-Basispolygon, Welt-pt), z0,z1 (Höhe m), mat, role, fill?, color? }.
   slicePlane(): horizontal → Grundriss-Schnitt (Polygone); vertikal → Vertikalschnitt (Strecke d0..d1 × z0..z1). */
function elementSolids(a, arr) {
  const out = [];
  if (a.type === 'wall' && a.layers && a.layers.length) {
    const H = a.h3d || wallHeightM, bands = wallLayerBands(a, arr).bands;
    bands.forEach((b, i) => {
      const L = a.layers[i] || {}, z0 = 0 - (L.bot || 0), zTop = H + (L.top || 0);
      if (L.lowMat && L.lowH > 0) { out.push({ poly: b.poly, z0, z1: L.lowH, mat: L.lowMat, role: 'wall-layer', li: i }); out.push({ poly: b.poly, z0: L.lowH, z1: zTop, mat: b.mat, role: 'wall-layer', li: i }); }   // Sockelzone unten + Hauptmaterial darüber
      else out.push({ poly: b.poly, z0, z1: zTop, mat: b.mat, role: 'wall-layer', li: i });
    });
  } else if (a.type === 'wall') {
    out.push({ poly: wallPoly(a, arr), z0: 0, z1: a.h3d || wallHeightM, mat: null, role: 'wall', fill: a.fill, color: a.color });
  } else if (a.type === 'slab' && a.pts && a.pts.length >= 3) {
    const base = a.base || 0, bands = slabLayerBands(a);
    if (bands) for (const b of bands) out.push({ poly: a.pts, z0: base + b.y0, z1: base + b.y1, mat: b.mat, role: 'slab-layer', inset: b.inset });
    else out.push({ poly: a.pts, z0: base, z1: base + (a.thick || 0.2), mat: null, role: 'slab', fill: '#dadde2', color: '#8a8f96' });
  }
  return out;
}
function slicePlane(solids, plane) {   // plane: {kind:'h', z} (Grundriss) | {kind:'v', p1,p2} (Vertikalschnitt entlang Linie p1→p2)
  const res = [];
  if (plane.kind === 'h') { const z = plane.z; for (const s of solids) if (s.z0 <= z && z < s.z1) res.push({ poly: s.poly, mat: s.mat, role: s.role, fill: s.fill, color: s.color, inset: s.inset, li: s.li }); return res; }
  const p1 = plane.p1, p2 = plane.p2, dx = p2[0] - p1[0], dy = p2[1] - p1[1], L = Math.hypot(dx, dy) || 1, cux = dx / L, cuy = dy / L, nx = -cuy, ny = cux;
  for (const s of solids) {
    const poly = s.poly, ds = [];
    for (let i = 0; i < poly.length; i++) {
      const a0 = poly[i], b0 = poly[(i + 1) % poly.length], sa = (a0[0] - p1[0]) * nx + (a0[1] - p1[1]) * ny, sb = (b0[0] - p1[0]) * nx + (b0[1] - p1[1]) * ny;
      if ((sa <= 0 && sb > 0) || (sb <= 0 && sa > 0)) { const t = sa / (sa - sb), ix = a0[0] + (b0[0] - a0[0]) * t, iy = a0[1] + (b0[1] - a0[1]) * t; ds.push((ix - p1[0]) * cux + (iy - p1[1]) * cuy); }
    }
    if (ds.length >= 2) { ds.sort((u, v) => u - v); res.push({ d0: ds[0], d1: ds[ds.length - 1], z0: s.z0, z1: s.z1, mat: s.mat, role: s.role, fill: s.fill, color: s.color, li: s.li }); }
  }
  return res;
}
function openingSolids(o) {   // Stufe 3: Fenster/Tür als Profil-Teile in der ANSICHTSEBENE (s = entlang Wand [pt, zentriert], z = Höhe [m]).
  // Eine Quelle → Ansicht = Profil direkt; Schnitt = bei s geschnitten; Grundriss = bei z geschnitten. role: frame|mullion|sash|glass|sill.
  const sp = openingSpec(o), hw = sp.w / 2, sill = sp.sill, head = sp.head, parts = [];
  const fw = Math.min(hw * 0.8, sp.frameVis + sp.sashVis), fwB = Math.min(hw * 0.5, sp.frameVis);   // s-Richtung (pt)
  const m = pt => ptsToCm(pt) / 100, fwBm = m(fwB), sashVm = m(sp.sashVis);                          // z-Richtung (m)
  const ht = (o.thick || wallThickPts()) / 2, depth = o.depth == null ? 0.5 : o.depth, md = Math.max(-1, Math.min(1, depth * 2 - 1));   // Tiefe über Wanddicke (m ∈ [-1,1])
  const frameD = sp.frameD, sashD = o.sashD || cmToPts(7), recess = o.sashRecess != null ? o.sashRecess : cmToPts(1);
  const fdh = Math.min(0.48, frameD / (2 * ht)); let fmA = md - fdh, fmB = md + fdh; if (fmA < -1) { fmB += (-1 - fmA); fmA = -1; } if (fmB > 1) { fmA -= (fmB - 1); fmB = 1; }   // Rahmen-Tiefe
  const recM = Math.min(fdh * 1.4, recess / ht), sdM = Math.min(fdh * 1.95, sashD / ht), smB = fmB - recM, smA = Math.max(-1, smB - sdM);   // Flügel-Tiefe (zurückgesetzt)
  const gc = (smA + smB) / 2, gh = Math.min((smB - smA) * 0.42, (o.glassT || cmToPts(2)) / (2 * ht)), gA = gc - gh, gB = gc + gh;   // Glas-Tiefe (dünn, mittig)
  const rect = (s0, s1, z0, z1, role, mat, mLo, mHi) => { if (s1 - s0 > 0.5 && z1 - z0 > 0.001) parts.push({ prof: [[s0, z0], [s1, z0], [s1, z1], [s0, z1]], role, mat, mLo, mHi }); };
  const two = o.winType === 'f2' || o.winType === 'f2s', door = o.kind === 'door';
  // Blendrahmen (4 Stäbe, sichtbare Breite, Rahmen-Tiefe); Tür ohne unteren Stab
  rect(-hw, -hw + fwB, sill, head, 'frame', 'holz', fmA, fmB); rect(hw - fwB, hw, sill, head, 'frame', 'holz', fmA, fmB);
  rect(-hw + fwB, hw - fwB, head - fwBm, head, 'frame', 'holz', fmA, fmB);
  if (!door) rect(-hw + fwB, hw - fwB, sill, sill + fwBm, 'frame', 'holz', fmA, fmB);
  if (two) rect(-fw / 2, fw / 2, sill + fwBm, head - fwBm, 'mullion', 'holz', fmA, fmB);   // Setzholz / Mittelstoss
  const innerZ0 = sill + (door ? 0 : fwBm), innerZ1 = head - fwBm;
  const panes = two ? [[-hw + fwB, -fw / 2], [fw / 2, hw - fwB]] : [[-hw + fwB, hw - fwB]];
  for (const [a0, b0] of panes) { rect(a0, b0, innerZ0, innerZ1, 'sash', 'holz', smA, smB); rect(a0 + fw, b0 - fw, innerZ0 + sashVm, innerZ1 - sashVm, door ? 'leaf' : 'glass', door ? 'holz' : null, door ? smA : gA, door ? smB : gB); }   // Flügel + Glas/Türblatt mit Tiefe
  const bankLayers = (Array.isArray(o.bankLayers) && o.bankLayers.length) ? o.bankLayers : [{ mat: o.bankMat || 'metall', t: (o.bankH != null ? o.bankH : 2.5) }];   // Fensterbank/Sims-Aufbau (Schichten, Oberkante an der Schwelle)
  if (!door && o.bank !== false) { const overD = cmToPts(o.bankOver != null ? o.bankOver : 4), sideO = cmToPts(4), mOut = 1 + overD / ht; let z = sill; for (const L of bankLayers) { const h = m(cmToPts(L.t || 2.5)); rect(-hw - sideO, hw + sideO, z - h, z, 'bank', L.mat, md, mOut); z -= h; } }   // Fensterbank aussen: geschichtet, Oberkante an der Schwelle, projiziert um bankOver über die Fassade
  if (!door && o.sims) { const overD = cmToPts(o.bankOver != null ? o.bankOver : 4), sideO = cmToPts(4), mIn = -1 - overD / ht; let z = sill; for (const L of bankLayers) { const h = m(cmToPts(L.t || 2.5)); rect(-hw - sideO, hw + sideO, z - h, z, 'bank', L.mat, mIn, md); z -= h; } }   // Fenstersims innen (geschichtet)
  if (door) { const tl = (Array.isArray(o.sillLayers) && o.sillLayers.length) ? o.sillLayers : [{ mat: o.thresholdMat || 'holz', t: 2.5 }]; let z = sill; for (const L of tl) { const h = m(cmToPts(L.t || 2.5)); rect(-hw + fwB, hw - fwB, z, z + h, 'bank', L.mat, fmA, fmB); z += h; } }   // Türschwelle geschichtet (Aufbau, vom Boden hoch)
  return parts;
}
function openingPartStyle(role, o, mat) {   // Füllung/Strich je Bauteil-Rolle (eine Quelle für Ansicht + Schnitt); mat = optionales Schicht-Material (Fensterbank-Aufbau)
  if (role === 'glass') return { fill: '#c7e2f5', stroke: '#7fa9c6' };
  if (role === 'bank') { const b = mat || o.bankMat; if (b === 'holz') return { fill: '#e7cfa8', stroke: '#7a5126' }; if (b === 'beton') return { fill: '#dadde2', stroke: '#8a8f96' }; if (b === 'metall' || !b) return { fill: '#cfd3d8', stroke: '#565b62' }; const wm = WALL_MATS[b] || LINING_MAT[b]; return wm ? { fill: wm.fill || '#cfd3d8', stroke: wm.color || wm.stroke || '#565b62' } : { fill: '#cfd3d8', stroke: '#565b62' }; }
  const wm = WIN_MAT[o.winMat || 'holz']; return { fill: wm.fill || '#e7cfa8', stroke: wm.stroke || '#7a5126' };
}
function openingElevDraw(out, o, sx, zy) {   // KANONISCHE Ansicht: openingSolids-Profil + Öffnungsrichtung. sx(s)=Zeichen-x, zy(z)=Zeichen-y
  const parts = openingSolids(o), col = '#1c242c';
  for (const part of parts) { const st = openingPartStyle(part.role, o, part.mat); out.push({ t: 'poly', pts: part.prof.map(p => [sx(p[0]), zy(p[1])]), fill: st.fill, stroke: st.stroke, sw: 1 }); }
  const leaves = parts.filter(p => p.role === 'glass' || p.role === 'leaf'), two = leaves.length > 1, hinge = o.winHinge || 'left', door = o.kind === 'door';   // Öffnungsrichtung (gestrichelt) + Türgriff
  leaves.forEach((g, pi) => {
    const ss = g.prof.map(p => p[0]), zz = g.prof.map(p => p[1]), s0 = Math.min(...ss), s1 = Math.max(...ss), z0 = Math.min(...zz), z1 = Math.max(...zz), mz = (z0 + z1) / 2, ms = (s0 + s1) / 2;
    if (hinge === 'kipp' && !door) { out.push({ t: 'line', x1: sx(s0), y1: zy(z1), x2: sx(ms), y2: zy(z0), stroke: col, w: 0.6, dash: '4 3' }); out.push({ t: 'line', x1: sx(s1), y1: zy(z1), x2: sx(ms), y2: zy(z0), stroke: col, w: 0.6, dash: '4 3' }); }
    else { const apexLeft = two ? (pi !== 0) : (hinge === 'right'), ax = apexLeft ? s0 : s1, bx = apexLeft ? s1 : s0; out.push({ t: 'line', x1: sx(bx), y1: zy(z0), x2: sx(ax), y2: zy(mz), stroke: col, w: 0.6, dash: '4 3' }); out.push({ t: 'line', x1: sx(bx), y1: zy(z1), x2: sx(ax), y2: zy(mz), stroke: col, w: 0.6, dash: '4 3' });   // Apex = ÖFFNUNGSseite (Bandgegenseite), wo der Flügel aufgeht
      if (door) { const hx = ax + (bx > ax ? 1 : -1) * (s1 - s0) * 0.13; out.push({ t: 'line', x1: sx(hx), y1: zy(mz - 0.06), x2: sx(hx), y2: zy(mz + 0.06), stroke: col, w: 2.2 }); }   // Türgriff auf der Öffnungsseite (beim Apex), ~Hüfthöhe
    }
  });
}
function openingRevealRing(o, side, wall) {   // sichtbare Laibungs-Lappung in der Ansicht je Seite (Material + Breite) – EINE Quelle für Detail + Plan/PDF
  const wlrs = wall && wall.layers && wall.layers.length ? wall.layers : null, lyr0 = wlrs ? wlrs[0] : null, lyrN = wlrs ? wlrs[wlrs.length - 1] : null;
  const customSide = side === 'i' ? o.revealLining : o.revealLiningOut;
  let faceMat, ringW = Math.max(0, (o.frameW || cmToPts(10)) - cmToPts(o.boardVis != null ? o.boardVis : 1));   // Breite = Lappung (frameW − 1cm sichtbar): die sichtbare Deckschicht deckt die volle Lappung und VERDECKT die dahinterliegenden Schichten
  if (Array.isArray(customSide) && customSide.length) faceMat = customSide[0].mat;   // sichtbare Deckschicht (innen innerste / aussen äusserste)
  else if (side === 'i') { const rt = o.revealType || 'putz'; faceMat = rt === 'aussen' ? (lyrN ? lyrN.mat : 'putz') : ((REVEAL_LINING[rt] && REVEAL_LINING[rt][0][0]) || (lyr0 ? lyr0.mat : 'putz')); }
  else { const ro = o.revealOuter || ''; faceMat = (ro && REVEAL_LINING[ro] && REVEAL_LINING[ro][0][0]) || (lyrN ? lyrN.mat : 'putz'); }
  const anT = o.anschlagType || 'none';
  if ((side === 'i' && anT === 'innen') || (side === 'a' && anT === 'aussen')) { const core = wlrs ? (wlrs.find(l => ['mauerwerk', 'beton'].includes(l.mat)) || wlrs[Math.floor((wlrs.length - 1) / 2)]) : null; faceMat = core ? core.mat : 'mauerwerk'; ringW = o.anschlagDepth != null ? o.anschlagDepth : cmToPts(5); }
  return { mat: faceMat, w: Math.min(ringW, o.w * 0.45) };
}
function openingRevealBands(o, side, wall) {   // VOLLER Laibungs-Stack in der Ansicht je Seite: [{mat,w}] von der Öffnungskante (aussen) zum Rahmen (innen) – per-Kante (revealLining/Out), Prioritäten, Lappung
  const wlrs = wall && wall.layers && wall.layers.length ? wall.layers : null, lyr0 = wlrs ? wlrs[0] : null, lyrN = wlrs ? wlrs[wlrs.length - 1] : null;
  const hw = (o.w || 0) / 2, frameW = o.frameW || cmToPts(10), boardVis = cmToPts(o.boardVis != null ? o.boardVis : 1), lapPt = Math.max(cmToPts(0.4), Math.min(hw * 0.45, frameW - boardVis));
  const anT = o.anschlagType || 'none';
  if ((side === 'i' && anT === 'innen') || (side === 'a' && anT === 'aussen')) { const core = wlrs ? (wlrs.find(l => ['mauerwerk', 'beton'].includes(l.mat)) || wlrs[Math.floor((wlrs.length - 1) / 2)]) : null; return [{ mat: core ? core.mat : 'mauerwerk', w: Math.min(o.anschlagDepth != null ? o.anschlagDepth : cmToPts(5), hw * 0.45) }]; }   // Anschlag = Mauerwerks-Schulter
  let lst = side === 'i' ? o.revealLining : o.revealLiningOut;
  if (!Array.isArray(lst) || !lst.length) { const pick = side === 'i' ? lyr0 : lyrN; lst = pick ? [{ mat: pick.mat, t: ptsToCm(pick.t) }] : null; }
  if (!Array.isArray(lst) || !lst.length) return [];
  const ord = lst.slice().sort((a, b) => (a.prio != null ? a.prio : 2) - (b.prio != null ? b.prio : 2));   // niedrigste Prio an der Öffnungskante (aussen), höchste am Rahmen (zuletzt)
  const bands = []; let acc = 0;
  ord.forEach((L, i) => { let w = cmToPts(L.t || 0) + cmToPts(L.gap || 0); if (i === ord.length - 1) w = Math.max(w, lapPt - acc); w = Math.min(w, lapPt - acc); if (w > 0.3) { bands.push({ mat: L.mat, w }); acc += w; } });
  return bands;
}
function sliceOpeningV(o, sCut) {   // Vertikalschnitt durch die Öffnung bei Position sCut (pt, zentriert) → Rechtecke {m0,m1 (Dicke ∈[-1,1]), z0,z1, role}
  const res = [];
  for (const p of openingSolids(o)) { const s0 = Math.min(p.prof[0][0], p.prof[2][0]), s1 = Math.max(p.prof[0][0], p.prof[2][0]); if (sCut >= s0 && sCut <= s1) { const z0 = Math.min(p.prof[0][1], p.prof[2][1]), z1 = Math.max(p.prof[0][1], p.prof[2][1]); res.push({ m0: Math.min(p.mLo, p.mHi), m1: Math.max(p.mLo, p.mHi), z0, z1, role: p.role, mat: p.mat }); } }
  return res;
}
function ifcMatKey(name) {   // IFC-Materialname → unser Material-Schlüssel (für Schraffur + λ/U-Wert)
  const s = (name || '').toLowerCase();
  if (/luft|cavity|\bair\b|hinterl/.test(s)) return 'luft';
  if (/beton|concrete|stahlbet/.test(s)) return 'beton';
  if (/xps/.test(s)) return 'daemm_xps';
  if (/eps|styropor/.test(s)) return 'eps';
  if (/wolle|mineral|glaswoll|steinwoll|rockwool|isover|\bwool\b/.test(s)) return 'glaswolle';
  if (/holzfaser|holzweichfaser/.test(s)) return 'daemm_holz';
  if (/dämm|daemm|insulat|isolier|wdvs/.test(s)) return 'eps';
  if (/gips|gypsum|fermacell/.test(s)) return 'gips';
  if (/putz|plaster|render|mörtel|moertel/.test(s)) return 'putz';
  if (/holz|wood|timber|osb|sperrholz|brett|furnier/.test(s)) return 'holz';
  if (/mauer|backstein|ziegel|brick|kalksand|klinker|stein|block/.test(s)) return 'mauerwerk';
  return 'mauerwerk';
}
function ifcResolveLayers(api, modelID, matId, depth) {   // IFC-Material → [{name, thick(m)}] (folgt LayerSetUsage → LayerSet → Layer)
  if (matId == null || (depth || 0) > 5) return null;
  let m; try { m = api.GetLine(modelID, matId); } catch (_) { return null; } if (!m) return null;
  if (m.ForLayerSet && m.ForLayerSet.value != null) return ifcResolveLayers(api, modelID, m.ForLayerSet.value, (depth || 0) + 1);
  if (m.MaterialLayers && m.MaterialLayers.length) { const out = []; for (const L of m.MaterialLayers) { try { const lay = api.GetLine(modelID, L.value); const t = lay && lay.LayerThickness && lay.LayerThickness.value; let nm = ''; if (lay && lay.Material && lay.Material.value != null) { const mm = api.GetLine(modelID, lay.Material.value); nm = (mm && mm.Name && mm.Name.value) || ''; } if (t > 0) out.push({ name: nm, thick: t }); } catch (_) { } } return out.length ? out : null; }
  return null;
}
async function loadWebIFC() {
  if (_webifc) return _webifc;
  for (const VER of ['0.0.68', '0.0.57']) {   // neuere Engine zuerst (bessere Verschneidungen/Boolean), Rückfall auf die bewährte
    try {
      let mod;
      try { mod = await import('https://unpkg.com/web-ifc@' + VER + '/web-ifc-api.js'); }
      catch (_) { mod = await import('https://cdn.jsdelivr.net/npm/web-ifc@' + VER + '/web-ifc-api.js'); }
      const api = new mod.IfcAPI(); api.SetWasmPath('https://unpkg.com/web-ifc@' + VER + '/'); await api.Init();
      _webifc = { api, mod, version: VER }; return _webifc;
    } catch (e) { console.warn('web-ifc ' + VER + ' nicht ladbar, versuche Rückfall …', e); }
  }
  throw new Error('web-ifc (BIM-Engine) nicht ladbar – Internet nötig.');
}
async function parseIFC(bytes) {   // → { meshes (Welt-Geometrie, Y-oben), bbox, summary, spaces, project, dim }
  const { api, mod } = await loadWebIFC();
  const modelID = api.OpenModel(new Uint8Array(bytes), { COORDINATE_TO_ORIGIN: true });
  const meshes = [], bb = { minx: Infinity, miny: Infinity, minz: Infinity, maxx: -Infinity, maxy: -Infinity, maxz: -Infinity };
  const ENV = new Set([mod.IFCBUILDINGELEMENTPROXY, mod.IFCSITE, mod.IFCFURNISHINGELEMENT, mod.IFCSPACE, mod.IFCOPENINGELEMENT].filter(x => x != null));   // Umgebung/Möbel/Pflanzen
  const KIND = new Map([[mod.IFCWINDOW, 'window'], [mod.IFCDOOR, 'door'], [mod.IFCCOLUMN, 'column'], [mod.IFCBEAM, 'beam'], [mod.IFCSLAB, 'slab'], [mod.IFCROOF, 'roof'], [mod.IFCWALL, 'wall'], [mod.IFCWALLSTANDARDCASE, 'wall']].filter(e => e[0] != null)), elemAcc = {};   // Schwerpunkt + Bbox je Bauteil sammeln (für Rückbau)
  api.StreamAllMeshes(modelID, flat => {
    const gs = flat.geometries; let et = 0; try { et = api.GetLineType(modelID, flat.expressID); } catch (_) { } const env = ENV.has(et);
    let oa = null; const kd = KIND.get(et); if (kd) { oa = elemAcc[flat.expressID] || (elemAcc[flat.expressID] = { kind: kd, sx: 0, sy: 0, sz: 0, n: 0, minx: Infinity, miny: Infinity, minz: Infinity, maxx: -Infinity, maxy: -Infinity, maxz: -Infinity }); }
    for (let i = 0; i < gs.size(); i++) {
      const pg = gs.get(i), geom = api.GetGeometry(modelID, pg.geometryExpressID);
      const va = api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize()), ia = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
      const m = pg.flatTransformation, n = va.length / 6, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
      for (let v = 0; v < n; v++) {
        const x = va[v * 6], y = va[v * 6 + 1], z = va[v * 6 + 2], nx = va[v * 6 + 3], ny = va[v * 6 + 4], nz = va[v * 6 + 5];
        const tx = m[0] * x + m[4] * y + m[8] * z + m[12], ty = m[1] * x + m[5] * y + m[9] * z + m[13], tz = m[2] * x + m[6] * y + m[10] * z + m[14];   // Welt (web-ifc liefert bereits Y-oben)
        pos[v * 3] = tx; pos[v * 3 + 1] = ty; pos[v * 3 + 2] = tz;
        nor[v * 3] = m[0] * nx + m[4] * ny + m[8] * nz; nor[v * 3 + 1] = m[1] * nx + m[5] * ny + m[9] * nz; nor[v * 3 + 2] = m[2] * nx + m[6] * ny + m[10] * nz;
        if (tx < bb.minx) bb.minx = tx; if (tx > bb.maxx) bb.maxx = tx; if (ty < bb.miny) bb.miny = ty; if (ty > bb.maxy) bb.maxy = ty; if (tz < bb.minz) bb.minz = tz; if (tz > bb.maxz) bb.maxz = tz;
        if (oa) { oa.sx += tx; oa.sy += ty; oa.sz += tz; oa.n++; if (tx < oa.minx) oa.minx = tx; if (tx > oa.maxx) oa.maxx = tx; if (ty < oa.miny) oa.miny = ty; if (ty > oa.maxy) oa.maxy = ty; if (tz < oa.minz) oa.minz = tz; if (tz > oa.maxz) oa.maxz = tz; }
      }
      const c = pg.color; meshes.push({ pos, nor, indices: Array.from(ia), color: { r: c.x, g: c.y, b: c.z, a: c.w }, env });
      if (geom.delete) try { geom.delete(); } catch (_) { }
    }
  });
  const matByElem = {};   // Element-/Typ-ID → Schichtaufbau [{name, thick}] (aus IfcRelAssociatesMaterial)
  try { const rels = api.GetLineIDsWithType(modelID, mod.IFCRELASSOCIATESMATERIAL); for (let i = 0; i < rels.size(); i++) { let r; try { r = api.GetLine(modelID, rels.get(i)); } catch (_) { continue; } if (!r || !r.RelatingMaterial) continue; const ly = ifcResolveLayers(api, modelID, r.RelatingMaterial.value, 0); if (!ly || !ly.length) continue; for (const o of (r.RelatedObjects || [])) if (o && o.value != null) matByElem[o.value] = ly; } } catch (_) { }
  const typeOf = {};   // Instanz-ID → Typ-ID (für Material, das am Bauteil-Typ hängt – häufig bei Revit-Export)
  try { const rt = api.GetLineIDsWithType(modelID, mod.IFCRELDEFINESBYTYPE); for (let i = 0; i < rt.size(); i++) { let r; try { r = api.GetLine(modelID, rt.get(i)); } catch (_) { continue; } if (!r || !r.RelatingType) continue; const ty = r.RelatingType.value; for (const o of (r.RelatedObjects || [])) if (o && o.value != null) typeOf[o.value] = ty; } } catch (_) { }
  const elements = []; for (const k in elemAcc) { const o = elemAcc[k]; if (o.n) elements.push({ kind: o.kind, eid: +k, c: [o.sx / o.n, o.sy / o.n, o.sz / o.n], min: [o.minx, o.miny, o.minz], max: [o.maxx, o.maxy, o.maxz], layers: matByElem[+k] || (typeOf[+k] != null ? matByElem[typeOf[+k]] : null) || null }); }
  const openings = elements.filter(e => e.kind === 'window' || e.kind === 'door');
  const T = mod, TYPES = [['Wände', T.IFCWALL], ['Wände (Std.)', T.IFCWALLSTANDARDCASE], ['Fenster', T.IFCWINDOW], ['Türen', T.IFCDOOR], ['Decken/Platten', T.IFCSLAB], ['Dächer', T.IFCROOF], ['Stützen', T.IFCCOLUMN], ['Träger', T.IFCBEAM], ['Treppen', T.IFCSTAIR], ['Geländer', T.IFCRAILING], ['Vorhangfassade', T.IFCCURTAINWALL], ['Möblierung', T.IFCFURNISHINGELEMENT], ['Räume', T.IFCSPACE]];
  const summary = []; for (const [label, t] of TYPES) { if (t == null) continue; let v; try { v = api.GetLineIDsWithType(modelID, t); } catch (_) { continue; } const cnt = v ? v.size() : 0; if (cnt) summary.push({ label, n: cnt }); }
  const spaces = []; try { const sp = api.GetLineIDsWithType(modelID, T.IFCSPACE); for (let i = 0; i < Math.min(sp.size(), 800); i++) { const id = sp.get(i); let line; try { line = api.GetLine(modelID, id); } catch (_) { continue; } const nm = (line.LongName && line.LongName.value) || (line.Name && line.Name.value) || '—', num = (line.Name && line.Name.value) || ''; spaces.push({ name: nm, num }); } } catch (_) { }
  let project = ''; try { const pr = api.GetLineIDsWithType(modelID, T.IFCPROJECT); if (pr && pr.size()) { const p = api.GetLine(modelID, pr.get(0)); project = (p.Name && p.Name.value) || (p.LongName && p.LongName.value) || ''; } } catch (_) { }
  const storeys = []; try { const st = api.GetLineIDsWithType(modelID, T.IFCBUILDINGSTOREY); for (let i = 0; i < st.size(); i++) { const id = st.get(i); let l; try { l = api.GetLine(modelID, id); } catch (_) { continue; } const nm = (l.Name && l.Name.value) || (l.LongName && l.LongName.value) || 'Geschoss', el = (l.Elevation && typeof l.Elevation.value === 'number') ? l.Elevation.value : (typeof l.Elevation === 'number' ? l.Elevation : null); storeys.push({ name: nm, elev: el }); } storeys.sort((a, b) => (a.elev == null ? 0 : a.elev) - (b.elev == null ? 0 : b.elev)); } catch (_) { }
  api.CloseModel(modelID);
  return { meshes, bbox: bb, summary, spaces, storeys, openings, elements, project, dim: { x: bb.maxx - bb.minx, y: bb.maxy - bb.miny, z: bb.maxz - bb.minz } };
}
function buildIFCScene(host, ifc) {
  host.innerHTML = '';
  const W = host.clientWidth || 800, Hp = host.clientHeight || 500, rb = ifc.bbox;
  const ex = ifcUpAxis === 'z' ? { x0: rb.minx, x1: rb.maxx, h0: rb.minz, h1: rb.maxz, z0: rb.miny, z1: rb.maxy } : ifcUpAxis === 'x' ? { x0: rb.miny, x1: rb.maxy, h0: rb.minx, h1: rb.maxx, z0: rb.minz, z1: rb.maxz } : { x0: rb.minx, x1: rb.maxx, h0: rb.miny, h1: rb.maxy, z0: rb.minz, z1: rb.maxz };
  const cx = (ex.x0 + ex.x1) / 2, cz = (ex.z0 + ex.z1) / 2, floor = ex.h0, sy = ex.h1 - ex.h0, span = Math.max(ex.x1 - ex.x0, ex.z1 - ex.z0, sy, 2);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xeef1ec);
  const camera = new THREE.PerspectiveCamera(50, W / Hp, 0.05, span * 40 + 60); camera.position.set(span * 0.9, span * 0.9, span * 0.9);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); renderer.setSize(W, Hp); renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; host.appendChild(renderer.domElement);
  const controls = new THREE.OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.target.set(0, sy * 0.4, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x55604f, 0.85));
  const sun = new THREE.DirectionalLight(0xffffff, 0.7); sun.position.set(span, span * 1.7, span * 0.6); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0006; const scam = sun.shadow.camera, sb = span * 1.4; scam.left = -sb; scam.right = sb; scam.top = sb; scam.bottom = -sb; scam.near = 0.1; scam.far = span * 6 + 30; scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(span * 3, span * 3), new THREE.MeshLambertMaterial({ color: 0xdfe3da })); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.01; ground.receiveShadow = true; ground.name = 'ground'; scene.add(ground);
  scene.add(new THREE.GridHelper(span * 3, 40, 0xc4cabe, 0xd8dcd2));
  const byColor = {};   // nach Farbe zusammenfassen → wenige Draw-Calls
  for (const me of ifc.meshes) { if (!ifcShowEnv && me.env) continue; const c = me.color, k = (c.r * 255 | 0) + '_' + (c.g * 255 | 0) + '_' + (c.b * 255 | 0) + '_' + c.a.toFixed(2); let g = byColor[k]; if (!g) g = byColor[k] = { color: c, pos: [], nor: [], idx: [], base: 0 }; const P = me.pos, N = me.nor; for (let i = 0; i < P.length; i += 3) { const r = ifcRemap([P[i], P[i + 1], P[i + 2]]); g.pos.push(r[0] - cx, r[1] - floor, r[2] - cz); const rn = ifcRemap([N[i], N[i + 1], N[i + 2]]); g.nor.push(rn[0], rn[1], rn[2]); } for (const ix of me.indices) g.idx.push(ix + g.base); g.base += P.length / 3; }
  for (const k in byColor) { const g = byColor[k], geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.nor, 3)); geo.setIndex(g.idx); const tr = g.color.a < 0.99, mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(g.color.r, g.color.g, g.color.b), transparent: tr, opacity: tr ? g.color.a : 1, roughness: 0.85, metalness: 0, side: THREE.DoubleSide }); const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; scene.add(m); }
  let raf; const tick = () => { controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(tick); }; tick();
  const setView = v => { const d = span * 1.4; if (v === 'top') camera.position.set(0.001, d * 1.5, 0); else if (v === 'front') camera.position.set(0, sy * 0.5, d); else if (v === 'side') camera.position.set(d, sy * 0.5, 0); else camera.position.set(d * 0.7, d * 0.7, d * 0.7); controls.target.set(0, sy * 0.4, 0); controls.update(); };
  const snapshot = () => { renderer.render(scene, camera); return { data: renderer.domElement.toDataURL('image/png'), w: W, h: Hp }; };
  const dispose = () => { cancelAnimationFrame(raf); try { renderer.dispose(); } catch (_) { } host.innerHTML = ''; };
  return { dispose, setView, snapshot, exportObj: () => exportSceneObj(scene) };
}
function open3DIFC(ifc) {
  const ov = document.createElement('div'); ov.className = 'd3-overlay';
  const dim = ifc.dim ? (ifc.dim.x.toFixed(1) + '×' + ifc.dim.z.toFixed(1) + ' m, H ' + ifc.dim.y.toFixed(1) + ' m') : '';
  ov.innerHTML = '<div class="d3-bar"><b>IFC-Modell</b>' + (ifc.project ? '<span class="d3-hint">' + ifc.project + '</span>' : '') + '<span class="d3-views"><button class="btn" data-v="iso">Iso</button><button class="btn" data-v="top">Oben</button><button class="btn" data-v="front">Vorne</button><button class="btn" data-v="side">Seite</button></span><span class="d3-hint">' + dim + ' · Ziehen = drehen</span><span class="grow"></span><button class="btn" id="ifcUp" title="Aufrichten: schaltet die Hoch-Achse durch (Y → Z → X), falls das Modell liegt oder gekippt ist – wirkt auf 3D, Grundriss und Wände">↻ Aufrichten</button><button class="btn' + (ifcShowEnv ? ' on' : '') + '" id="ifcEnv" title="Umgebung/Pflanzen/Möbel (RPC-Proxys, Gelände) ein-/ausblenden – für eine saubere Bauwerks-Ansicht standardmäßig aus">🌳 Umgebung</button><button class="btn" id="ifcList">▦ Bauteilliste</button><button class="btn" id="ifcPlan" title="Grundriss erzeugen: Horizontalschnitt durchs Modell → editierbare 2D-Linien auf die offene Seite (Massstab nötig)">⊞ Grundriss</button><button class="btn" id="ifcWalls" title="Als editierbare Wände (EIN Geschoss): erkennt aus dem Schnitt parallele Wandpaare → echte Submit-Wände. Experimentell.">⌂ Als Wände</button><button class="btn" id="ifcStoreys" title="ALLE Geschosse → je eine editierbare Ebene mit Wänden, im 3D korrekt gestapelt (Höhen aus den IFC-Geschossen). Experimentell.">🏢 Alle Geschosse</button><button class="btn" id="ifcMesh" title="Als akkurates 3D-Objekt übernehmen: die echte IFC-Geometrie wird (komprimiert) in unser Modell geholt – korrekt dargestellt, im Grundriss als Umriss. Fallback für nicht parametrisch nachbaubare Teile.">📦 Als 3D-Objekt</button><button class="btn" id="ifcObj" title="IFC-Modell als OBJ exportieren (Blender/SketchUp …)">⭳ OBJ</button><button class="btn" id="d3Shot">📷 Auf Plan</button><button class="btn" id="d3Close">✕ Schliessen</button></div><div class="d3-canvas" id="d3Canvas"></div>';
  document.body.appendChild(ov); const host = ov.querySelector('#d3Canvas'); let api = buildIFCScene(host, ifc);
  ov.querySelectorAll('.d3-views button').forEach(b => b.onclick = () => api && api.setView && api.setView(b.dataset.v));
  ov.querySelector('#d3Shot').onclick = () => { if (!api || !api.snapshot) return; const s = api.snapshot(); if (pdfDoc) { close(); place3DImage(s.data, s.w, s.h); } else toast('Erst ein PDF/Plan öffnen, um das Bild abzulegen.'); };
  ov.querySelector('#ifcList').onclick = () => openIFCList(ifc);
  ov.querySelector('#ifcEnv').onclick = e => { ifcShowEnv = !ifcShowEnv; e.currentTarget.classList.toggle('on', ifcShowEnv); if (api) api.dispose(); api = buildIFCScene(host, ifc); toast(ifcShowEnv ? 'Umgebung/Pflanzen eingeblendet.' : 'Umgebung/Pflanzen ausgeblendet (saubere Bauwerks-Ansicht).'); };
  ov.querySelector('#ifcUp').onclick = () => { ifcUpAxis = ifcUpAxis === 'y' ? 'z' : ifcUpAxis === 'z' ? 'x' : 'y'; if (api) api.dispose(); api = buildIFCScene(host, ifc); toast('Hoch-Achse: ' + ifcUpAxis.toUpperCase() + ' – passt für 3D, Grundriss & Wände.'); };
  ov.querySelector('#ifcObj').onclick = () => saveObjFrom(api, ifc.project || 'ifc-modell');
  ov.querySelector('#ifcPlan').onclick = () => { if (!pdfDoc) { toast('Erst ein PDF/Plan öffnen, um den Grundriss abzulegen.'); return; } const h = prompt('Schnitthöhe für den Grundriss (m über Gebäude-Unterkante):', '1.2'); if (h == null) return; const hv = parseFloat((h || '').replace(',', '.')); ifcFloorPlan(ifc, hv > 0 ? hv : 1.2).then(ok => { if (ok) close(); }).catch(err => { status(''); console.error(err); toast('Grundriss fehlgeschlagen: ' + ((err && err.message) || err)); }); };
  ov.querySelector('#ifcWalls').onclick = () => { if (!pdfDoc) { toast('Erst ein PDF/Plan öffnen, um die Wände abzulegen.'); return; } const h = prompt('Schnitthöhe für die Wand-Erkennung (m über Gebäude-Unterkante):', '1.2'); if (h == null) return; const hv = parseFloat((h || '').replace(',', '.')); ifcToWalls(ifc, hv > 0 ? hv : 1.2).then(ok => { if (ok) close(); }).catch(err => { status(''); console.error(err); toast('Wände fehlgeschlagen: ' + ((err && err.message) || err)); }); };
  ov.querySelector('#ifcStoreys').onclick = () => { if (!pdfDoc) { toast('Erst ein Dokument öffnen/neu starten.'); return; } ifcAllStoreysToWalls(ifc).then(ok => { if (ok) close(); }).catch(err => { status(''); console.error(err); toast('Geschosse fehlgeschlagen: ' + ((err && err.message) || err)); }); };
  ov.querySelector('#ifcMesh').onclick = () => { if (!pdfDoc) { toast('Erst ein Dokument öffnen/neu starten.'); return; } importIfcMesh3d(ifc).then(ok => { if (ok) close(); }).catch(err => { status(''); console.error(err); toast('3D-Objekt fehlgeschlagen: ' + ((err && err.message) || err)); }); };
  const close = () => { if (api) api.dispose(); ov.remove(); document.removeEventListener('keydown', esc, true); };
  const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } }; document.addEventListener('keydown', esc, true);
  ov.querySelector('#d3Close').onclick = close;
}
function openIFCList(ifc) {
  const rows = ifc.summary.map(s => '<tr><td>' + s.label + '</td><td style="text-align:right">' + s.n + '</td></tr>').join('');
  const sp = (ifc.spaces && ifc.spaces.length) ? ('<h4 style="margin:12px 6px 4px">Räume (' + ifc.spaces.length + ')</h4><table class="qty-tab"><tbody>' + ifc.spaces.map(s => '<tr><td style="white-space:nowrap">' + (s.num || '') + '</td><td>' + s.name + '</td></tr>').join('') + '</tbody></table>') : '';
  const st = (ifc.storeys && ifc.storeys.length) ? ('<h4 style="margin:12px 6px 4px">Geschosse / Ebenen (' + ifc.storeys.length + ')</h4><table class="qty-tab"><thead><tr><th>Name</th><th style="text-align:right">Höhe (m)</th></tr></thead><tbody>' + ifc.storeys.map(s => '<tr><td>' + s.name + '</td><td style="text-align:right">' + (s.elev == null ? '—' : (Math.round(s.elev * 100) / 100)) + '</td></tr>').join('') + '</tbody></table>') : '';
  const ov = document.createElement('div'); ov.className = 'lab-overlay';
  ov.innerHTML = '<div class="lab-wrap" style="width:min(560px,94vw);height:auto;max-height:84vh"><div class="lab-head"><b>IFC-Bauteilliste</b>' + (ifc.project ? '<span class="lab-hint">' + ifc.project + '</span>' : '') + '<span class="grow"></span><button class="btn" id="ifcCopy">In Zwischenablage</button><button class="btn" id="ifcLClose">✕</button></div><div class="qty-body"><table class="qty-tab"><thead><tr><th>Bauteil</th><th style="text-align:right">Anzahl</th></tr></thead><tbody>' + rows + '</tbody></table>' + st + sp + '</div></div>';
  document.body.appendChild(ov); ov.querySelector('#ifcLClose').onclick = () => ov.remove(); ov.addEventListener('pointerdown', e => { if (e.target === ov) ov.remove(); });
  ov.querySelector('#ifcCopy').onclick = () => { const tsv = ifc.summary.map(s => s.label + '\t' + s.n).join('\n') + (ifc.spaces.length ? ('\n\nRäume\n' + ifc.spaces.map(s => (s.num || '') + '\t' + s.name).join('\n')) : ''); if (navigator.clipboard) navigator.clipboard.writeText(tsv); toast('Liste kopiert (Excel-tauglich).'); };
}
function ifcSliceSegments(meshes, cutY) {   // Horizontalschnitt auf Höhe cutY (Höhenachse je ifcUpAxis) → 2D-Segmente (die beiden Horizontalachsen)
  const segs = [], hO = ifcUpAxis === 'z' ? 2 : ifcUpAxis === 'x' ? 0 : 1, xO = ifcUpAxis === 'x' ? 1 : 0, zO = ifcUpAxis === 'z' ? 1 : 2;
  for (const m of meshes) {
    if (m.env) continue;   // Umgebung/Pflanzen/Möbel nicht schneiden
    const p = m.pos, idx = m.indices;
    const handle = (a, b, c) => {
      const ay = p[a * 3 + hO], by = p[b * 3 + hO], cy = p[c * 3 + hO], mn = Math.min(ay, by, cy), mx = Math.max(ay, by, cy);
      if (cutY < mn || cutY > mx) return;
      const pts = [], ed = (i, j) => { const yi = p[i * 3 + hO], yj = p[j * 3 + hO]; if ((yi < cutY) !== (yj < cutY)) { const t = (cutY - yi) / ((yj - yi) || 1e-9); pts.push([p[i * 3 + xO] + (p[j * 3 + xO] - p[i * 3 + xO]) * t, p[i * 3 + zO] + (p[j * 3 + zO] - p[i * 3 + zO]) * t]); } };
      ed(a, b); ed(b, c); ed(c, a); if (pts.length === 2) segs.push(pts);
    };
    if (idx && idx.length) { for (let i = 0; i + 2 < idx.length; i += 3) handle(idx[i], idx[i + 1], idx[i + 2]); }
    else { const n = p.length / 3; for (let i = 0; i + 2 < n; i += 3) handle(i, i + 1, i + 2); }
  }
  return segs;
}
function mergeIfcSegments(segs) {   // viele Dreieck-Schnipsel → wenige lange, kollineare Linien (gruppiert nach Richtung+Lage, Intervalle vereinigt)
  const Q = 0.004, A = Math.PI / 360, groups = new Map();   // 4 mm Raster · 0.5°
  for (const seg of segs) {
    const a = seg[0], b = seg[1]; let dx = b[0] - a[0], dy = b[1] - a[1]; const len = Math.hypot(dx, dy); if (len < 0.01) continue; dx /= len; dy /= len;
    if (dx < -1e-9 || (Math.abs(dx) < 1e-9 && dy < 0)) { dx = -dx; dy = -dy; }
    const nx = -dy, ny = dx, key = Math.round(Math.atan2(dy, dx) / A) + '|' + Math.round((a[0] * nx + a[1] * ny) / Q);
    let g = groups.get(key); if (!g) { g = { dx, dy, ax: a[0], ay: a[1], ints: [] }; groups.set(key, g); }
    const ta = (a[0] - g.ax) * g.dx + (a[1] - g.ay) * g.dy, tb = (b[0] - g.ax) * g.dx + (b[1] - g.ay) * g.dy;
    g.ints.push([Math.min(ta, tb), Math.max(ta, tb)]);
  }
  const out = [];
  for (const g of groups.values()) {
    g.ints.sort((p, q) => p[0] - q[0]); let s = g.ints[0][0], e = g.ints[0][1];
    for (let i = 1; i < g.ints.length; i++) { const it = g.ints[i]; if (it[0] <= e + 0.02) { if (it[1] > e) e = it[1]; } else { out.push([[g.ax + g.dx * s, g.ay + g.dy * s], [g.ax + g.dx * e, g.ay + g.dy * e]]); s = it[0]; e = it[1]; } }
    out.push([[g.ax + g.dx * s, g.ay + g.dy * s], [g.ax + g.dx * e, g.ay + g.dy * e]]);
  }
  return out;
}
async function ifcFloorPlan(ifc, cutAbove) {   // IFC → massstäblicher Grundriss (editierbare Vektorlinien) auf einer NEUEN Seite (Bild-Fallback bei zu vielen)
  if (!pdfDoc) { toast('Erst ein Dokument öffnen/neu starten, dann den Grundriss erzeugen.'); return; }
  if (!docScale) { docScale = { perPt: 50 * PT2MM / 1000, label: '1:50', n: 50 }; toast('Massstab automatisch auf 1:50 gesetzt (im Footer änderbar).'); }
  status('Grundriss wird erzeugt …'); await new Promise(r => setTimeout(r, 20));
  const raw = ifcSliceSegments(ifc.meshes, ifcHeightMin(ifc) + (cutAbove || 1.2));
  if (!raw.length) { status(''); toast('Auf dieser Höhe keine Schnittlinien gefunden – andere Höhe versuchen.'); return; }
  const segs = mergeIfcSegments(raw);
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const s of segs) for (const q of s) { if (q[0] < minx) minx = q[0]; if (q[0] > maxx) maxx = q[0]; if (q[1] < miny) miny = q[1]; if (q[1] > maxy) maxy = q[1]; }
  const pad = 50, pgW = cmToPts((maxx - minx) * 100) + 2 * pad, pgH = cmToPts((maxy - miny) * 100) + 2 * pad;
  await insertBlankPage(curPage(), { w: Math.max(300, Math.round(pgW)), h: Math.max(300, Math.round(pgH)) });
  const n = curPage(), pv = pageViews.find(p => p.num === n) || pageViews[0]; if (!pv) { status(''); return; }
  const cxm = (minx + maxx) / 2, cym = (miny + maxy) / 2, pcx = (pv.pageW || 595) / 2, pcy = (pv.pageH || 842) / 2, toPt = (x, y) => [pcx + cmToPts((x - cxm) * 100), pcy + cmToPts((y - cym) * 100)];
  pushUndo();
  if (segs.length <= 6000) {   // editierbare Linien auf eigener Ebene
    const lid = newLayerId(); layers.push({ id: lid, name: 'IFC-Grundriss', visible: true }); const arr = getAnnos(n);
    for (const s of segs) { const a = toPt(s[0][0], s[0][1]), b = toPt(s[1][0], s[1][1]); arr.push({ id: nextId++, type: 'line', x1: a[0], y1: a[1], x2: b[0], y2: b[1], color: '#1c242c', width: 1.2, layer: lid }); }
    activeLayerId = lid; drawAnnos(pv); renderLayerPanel(); saveState(); status('');
    toast('IFC-Grundriss: ' + segs.length + ' editierbare Linien auf neuer Seite ' + n + ' (massstäblich) – anwählbar & verschiebbar.'); return true;
  } else {   // Fallback: Bild
    const wM = Math.max(0.2, maxx - minx), hM = Math.max(0.2, maxy - miny), ppm = Math.max(20, Math.min(120, 3200 / Math.max(wM, hM)));
    const cw = Math.min(4000, Math.round(wM * ppm)), ch = Math.min(4000, Math.round(hM * ppm)), cv = document.createElement('canvas'); cv.width = cw; cv.height = ch; const g = cv.getContext('2d');
    g.strokeStyle = '#1c242c'; g.lineWidth = 1.4; g.lineCap = 'round'; g.beginPath();
    for (const s of segs) { g.moveTo((s[0][0] - minx) / (maxx - minx || 1) * cw, (s[0][1] - miny) / (maxy - miny || 1) * ch); g.lineTo((s[1][0] - minx) / (maxx - minx || 1) * cw, (s[1][1] - miny) / (maxy - miny || 1) * ch); }
    g.stroke();
    const wPts = cmToPts(wM * 100), hPts = cmToPts(hM * 100), a = { id: nextId++, type: 'img', data: cv.toDataURL('image/png'), x: (pv.pageW - wPts) / 2, y: (pv.pageH - hPts) / 2, w: wPts, h: hPts, layer: activeLayerId };
    pushAnno(n, a); sel = { num: n, id: a.id }; setTool('select'); drawAnnos(pv); saveState(); status('');
    toast('IFC-Grundriss als Bild auf neuer Seite ' + n + ' (sehr viele Linien).'); return true;
  }
}
function ifcPairWalls(lines) {   // aus den Schnittlinien parallele, nahe, überlappende Paare → Wand-Achse + Dicke (Meter)
  const A = Math.PI / 180, items = lines.map(s => {
    let dx = s[1][0] - s[0][0], dy = s[1][1] - s[0][1]; const len = Math.hypot(dx, dy) || 1; dx /= len; dy /= len;
    if (dx < -1e-9 || (Math.abs(dx) < 1e-9 && dy < 0)) { dx = -dx; dy = -dy; }
    const nx = -dy, ny = dx, t0 = s[0][0] * dx + s[0][1] * dy, t1 = s[1][0] * dx + s[1][1] * dy;
    return { dx, dy, nx, ny, off: s[0][0] * nx + s[0][1] * ny, lo: Math.min(t0, t1), hi: Math.max(t0, t1), used: false };
  });
  const groups = {}; for (const it of items) { const k = Math.round(Math.atan2(it.dy, it.dx) / A); (groups[k] = groups[k] || []).push(it); }
  const walls = [];
  for (const k in groups) {
    const arr = groups[k].sort((a, b) => a.off - b.off);
    for (let a = 0; a < arr.length; a++) {
      if (arr[a].used) continue;
      for (let b = a + 1; b < arr.length; b++) {
        if (arr[b].used) continue; const gap = arr[b].off - arr[a].off; if (gap < 0.04) continue; if (gap > 0.65) break;
        const lo = Math.max(arr[a].lo, arr[b].lo), hi = Math.min(arr[a].hi, arr[b].hi); if (hi - lo < 0.3) continue;
        const d = arr[a], mo = (arr[a].off + arr[b].off) / 2;
        walls.push({ x1: d.dx * lo + d.nx * mo, y1: d.dy * lo + d.ny * mo, x2: d.dx * hi + d.nx * mo, y2: d.dy * hi + d.ny * mo, thick: gap });
        arr[a].used = true; arr[b].used = true; break;
      }
    }
  }
  return walls;
}
async function ifcToWalls(ifc, cutAbove) {   // IFC → editierbare Submit-Wände (parametrisch, 2D+3D) auf einer NEUEN, passenden Seite – Stufe 2, experimentell
  if (!pdfDoc) { toast('Erst ein Dokument öffnen/neu starten, dann die Wände erzeugen.'); return; }
  if (!docScale) { docScale = { perPt: 50 * PT2MM / 1000, label: '1:50', n: 50 }; toast('Massstab automatisch auf 1:50 gesetzt (im Footer änderbar).'); }
  status('Wände werden rekonstruiert …'); await new Promise(r => setTimeout(r, 20));
  const ws = ifcPairWalls(mergeIfcSegments(ifcSliceSegments(ifc.meshes, ifcHeightMin(ifc) + (cutAbove || 1.2))));
  if (!ws.length) { status(''); toast('Keine parallelen Wandpaare gefunden – andere Schnitthöhe versuchen.'); return; }
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const w of ws) { for (const x of [w.x1, w.x2]) { if (x < minx) minx = x; if (x > maxx) maxx = x; } for (const y of [w.y1, w.y2]) { if (y < miny) miny = y; if (y > maxy) maxy = y; } }
  const pad = 50, wPts = cmToPts((maxx - minx) * 100) + 2 * pad, hPts = cmToPts((maxy - miny) * 100) + 2 * pad;
  await insertBlankPage(curPage(), { w: Math.max(300, Math.round(wPts)), h: Math.max(300, Math.round(hPts)) });   // neue, maßstäblich passende Seite
  const n = curPage(), pv = pageViews.find(p => p.num === n) || pageViews[0]; if (!pv) { status(''); return; }
  const cxm = (minx + maxx) / 2, cym = (miny + maxy) / 2, pcx = (pv.pageW || 595) / 2, pcy = (pv.pageH || 842) / 2, toPt = (x, y) => [pcx + cmToPts((x - cxm) * 100), pcy + cmToPts((y - cym) * 100)];
  pushUndo();
  const lid = newLayerId(); layers.push({ id: lid, name: 'IFC-Wände', visible: true }); const arr = getAnnos(n), h3 = Math.min(3.2, Math.max(2.3, ifcHeightExt(ifc) || wallHeightM)), ca = cutAbove || 1.2, placedWalls = [];
  let nMat = 0;
  for (const w of ws) { const wid = nextId++, a = toPt(w.x1, w.y1), b = toPt(w.x2, w.y2), mat = ifcWallMatFor(ifc, (w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2, ca); const wo = { id: wid, type: 'wall', x1: a[0], y1: a[1], x2: b[0], y2: b[1], thick: mat ? mat.thick : cmToPts(Math.max(6, Math.min(60, w.thick * 100))), just: 'center', color: '#1c242c', fill: '#ffffff', hatch: null, width: 1.4, h3d: h3, dim: false, layer: lid }; if (mat) { wo.layers = mat.layers; wo.uVal = mat.uVal; nMat++; } arr.push(wo); placedWalls.push({ id: wid, x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, h0: ca - 1.5, h1: ca + 1.8, layer: lid }); }
  const fl = [{ layer: lid, h0: ca - 1.5, h1: ca + 1.8, elev: 0 }], nOp = ifcPlaceOpenings(ifc, placedWalls, arr), nC = ifcPlaceColumns(ifc, fl, arr, toPt), nB = ifcPlaceBeams(ifc, fl, arr, toPt), nS = ifcPlaceSlabs(ifc, fl, arr, toPt);
  activeLayerId = lid; for (const a of arr) if (a.type === 'opening') openingResolve(a, { num: n }); drawAnnos(pv); renderLayerPanel(); saveState(); status('');
  toast(ws.length + ' Wände (' + nMat + ' mit IFC-Schichten) · ' + nOp + ' Fenster/Türen · ' + nC + ' Stützen · ' + nB + ' Träger · ' + nS + ' Decken auf Seite ' + n + '. Tipp: „🏢 Alle Geschosse" baut auch Dächer.'); return true;
}
function ifcPlaceOpenings(ifc, placedWalls, arr) {   // IFC-Fenster/Türen → Öffnung in die nächstgelegene rekonstruierte Wand (passend zur Höhe/Geschoss)
  if (!ifc.openings || !ifc.openings.length || !placedWalls.length) return 0;
  const hMin = ifcHeightMin(ifc); let placed = 0;
  for (const o of ifc.openings) {
    const cr = ifcRemap(o.c), rmin = ifcRemap(o.min), rmax = ifcRemap(o.max), px = cr[0], pz = cr[2], hRel = cr[1] - hMin;
    const wM = Math.max(0.4, Math.min(3, Math.max(Math.abs(rmax[0] - rmin[0]), Math.abs(rmax[2] - rmin[2]))));
    let best = null, bd = 0.7;
    for (const w of placedWalls) { if (hRel < w.h0 - 0.7 || hRel > w.h1 + 0.7) continue; const dx = w.x2 - w.x1, dy = w.y2 - w.y1, L2 = dx * dx + dy * dy || 1; let t = ((px - w.x1) * dx + (pz - w.y1) * dy) / L2; t = Math.max(0, Math.min(1, t)); const d = Math.hypot(px - (w.x1 + dx * t), pz - (w.y1 + dy * t)); if (d < bd) { bd = d; best = { w, t }; } }
    if (best) { arr.push({ id: nextId++, type: 'opening', wallId: best.w.id, t: best.t, w: cmToPts(wM * 100), kind: o.kind, hinge: 1, swing: 1, sill: o.kind === 'door' ? 0 : 0.9, head: o.kind === 'door' ? 2.0 : 2.1, depth: 0.5, winType: 'f1', winHinge: 'left', winMat: 'holz', color: '#1c242c', layer: best.w.layer }); placed++; }
  }
  return placed;
}
function ifcToMesh3d(ifc) {   // alle (sichtbaren) IFC-Meshes → kompakte Mesh3D-Geometrie: lokale Plan-Punkte (Seitenpunkte) + Höhe (m)
  const hMin = ifcHeightMin(ifc); let mnx = Infinity, mnz = Infinity, mxx = -Infinity, mxz = -Infinity; const parts = [];
  for (const me of ifc.meshes) { if (me.env) continue; const P = me.pos, vs = new Float32Array(P.length); for (let i = 0; i < P.length; i += 3) { const r = ifcRemap([P[i], P[i + 1], P[i + 2]]), xpt = cmToPts(r[0] * 100), zpt = cmToPts(r[2] * 100); vs[i] = xpt; vs[i + 1] = r[1] - hMin; vs[i + 2] = zpt; if (xpt < mnx) mnx = xpt; if (xpt > mxx) mxx = xpt; if (zpt < mnz) mnz = zpt; if (zpt > mxz) mxz = zpt; } parts.push({ vs, idx: me.indices }); }
  if (!parts.length) return null;
  const posArr = [], idxArr = []; let base = 0;
  for (const p of parts) { for (let i = 0; i < p.vs.length; i += 3) posArr.push(p.vs[i] - mnx, p.vs[i + 1], p.vs[i + 2] - mnz); for (const ix of p.idx) idxArr.push(ix + base); base += p.vs.length / 3; }
  return { enc: encodeMesh3d(new Float32Array(posArr), idxArr), fw: mxx - mnx, fh: mxz - mnz };
}
async function importIfcMesh3d(ifc) {   // IFC als akkurates 3D-Objekt (Mesh) in unser Modell übernehmen – Fallback für nicht-rekonstruierbare Geometrie
  if (!pdfDoc) { toast('Erst ein Dokument öffnen/neu starten.'); return; }
  if (!docScale) { docScale = { perPt: 50 * PT2MM / 1000, label: '1:50', n: 50 }; }
  status('3D-Objekt wird übernommen …'); await new Promise(r => setTimeout(r, 20));
  const m = ifcToMesh3d(ifc); if (!m) { status(''); toast('Keine Geometrie gefunden.'); return; }
  await insertBlankPage(curPage(), { w: Math.max(300, Math.round(m.fw + 100)), h: Math.max(300, Math.round(m.fh + 100)) });
  const n = curPage(), pv = pageViews.find(p => p.num === n) || pageViews[0]; if (!pv) { status(''); return; }
  pushUndo();
  const a = { id: nextId++, type: 'mesh3d', enc: m.enc, x: ((pv.pageW || 595) - m.fw) / 2, y: ((pv.pageH || 842) - m.fh) / 2, fw: m.fw, fh: m.fh, color: '#cfc8ba', name: ifc.project || 'IFC-Modell', layer: activeLayerId };
  getAnnos(n).push(a); sel = { num: n, id: a.id }; setTool('select'); drawAnnos(pv); saveState(); status('');
  toast('IFC als akkurates 3D-Objekt übernommen (' + m.enc.n + ' Punkte) – im 3D sichtbar (◳ 3D), im Grundriss als Umriss. Komprimiert mitgespeichert.'); return true;
}
function ifcFloorFor(floorLayers, hRel, pad) { let best = null, bd = Infinity; for (const f of floorLayers) { if (hRel >= f.h0 - (pad || 0.7) && hRel <= f.h1 + (pad || 0.7)) { const d = Math.abs(hRel - (f.h0 + f.h1) / 2); if (d < bd) { bd = d; best = f; } } } return best; }
function ifcWallMatFor(ifc, mx, mz, hRel) {   // nächste IFC-Wand mit Schichtaufbau zur rekonstruierten Wand → unsere Schichten + Dicke + U-Wert
  if (!ifc.elements) return null; let best = null, bd = 1.6; const hMin = ifcHeightMin(ifc);
  for (const e of ifc.elements) { if (e.kind !== 'wall' || !e.layers || !e.layers.length) continue; const cr = ifcRemap(e.c); if (Math.abs((cr[1] - hMin) - hRel) > 2.5) continue; const d = Math.hypot(cr[0] - mx, cr[2] - mz); if (d < bd) { bd = d; best = e; } }
  if (!best) return null;
  const lyrs = best.layers.map(l => ({ mat: ifcMatKey(l.name), t: cmToPts(l.thick * 100) })), totM = best.layers.reduce((s, l) => s + l.thick, 0);
  return { layers: lyrs, thick: cmToPts(totM * 100), uVal: wallUValue(lyrs) };
}
function ifcPlaceColumns(ifc, floorLayers, arr, toPt) {   // IfcColumn → Stütze (Block) auf dem passenden Geschoss
  let n = 0, hMin = ifcHeightMin(ifc);
  for (const e of ifc.elements) { if (e.kind !== 'column') continue; const cr = ifcRemap(e.c), rmin = ifcRemap(e.min), rmax = ifcRemap(e.max), f = ifcFloorFor(floorLayers, cr[1] - hMin, 1.0); if (!f) continue; const wx = Math.max(0.1, Math.abs(rmax[0] - rmin[0])), wz = Math.max(0.1, Math.abs(rmax[2] - rmin[2])), ctr = toPt(cr[0], cr[2]), wPt = cmToPts(wx * 100), hPt = cmToPts(wz * 100); arr.push({ id: nextId++, type: 'block', kind: 'column', x: ctr[0] - wPt / 2, y: ctr[1] - hPt / 2, w: wPt, h: hPt, color: '#1c242c', layer: f.layer }); n++; }
  return n;
}
function ifcPlaceBeams(ifc, floorLayers, arr, toPt) {   // IfcBeam → Unterzug (2-Punkt) auf dem passenden Geschoss
  let n = 0, hMin = ifcHeightMin(ifc);
  for (const e of ifc.elements) { if (e.kind !== 'beam') continue; const cr = ifcRemap(e.c), rmin = ifcRemap(e.min), rmax = ifcRemap(e.max), f = ifcFloorFor(floorLayers, cr[1] - hMin, 1.3); if (!f) continue; const xR = Math.abs(rmax[0] - rmin[0]), zR = Math.abs(rmax[2] - rmin[2]); let p1, p2, wid; if (xR >= zR) { p1 = toPt(Math.min(rmin[0], rmax[0]), cr[2]); p2 = toPt(Math.max(rmin[0], rmax[0]), cr[2]); wid = zR; } else { p1 = toPt(cr[0], Math.min(rmin[2], rmax[2])); p2 = toPt(cr[0], Math.max(rmin[2], rmax[2])); wid = xR; } arr.push({ id: nextId++, type: 'beam', x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], width: cmToPts(Math.max(8, Math.min(60, wid * 100))), height: Math.max(0.2, Math.min(1, Math.abs(rmax[1] - rmin[1]))), color: '#1c242c', layer: f.layer }); n++; }
  return n;
}
function ifcPlaceRoofs(ifc, floorLayers, arr, toPt) {   // IfcRoof → Dach (Rechteck + Neigung, Näherung) auf dem obersten passenden Geschoss
  let n = 0, hMin = ifcHeightMin(ifc);
  for (const e of ifc.elements) { if (e.kind !== 'roof') continue; const rmin = ifcRemap(e.min), rmax = ifcRemap(e.max), botH = Math.min(rmin[1], rmax[1]) - hMin, topH = Math.max(rmin[1], rmax[1]) - hMin; const f = ifcFloorFor(floorLayers, botH, 2.0) || floorLayers[floorLayers.length - 1]; if (!f) continue; const x0 = Math.min(rmin[0], rmax[0]), x1 = Math.max(rmin[0], rmax[0]), z0 = Math.min(rmin[2], rmax[2]), z1 = Math.max(rmin[2], rmax[2]), a = toPt(x0, z0), b = toPt(x1, z1); arr.push({ id: nextId++, type: 'roof', x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]), rtype: 'sattel', eave: Math.max(0, botH - f.elev), ridge: Math.max(0.5, topH - f.elev), axis: (x1 - x0) >= (z1 - z0) ? 'x' : 'y', color: '#1c242c', layer: f.layer }); n++; }
  return n;
}
function ifcPlaceSlabs(ifc, floorLayers, arr, toPt) {   // IfcSlab → Decke/Platte (Rechteck-Näherung) auf dem passenden Geschoss
  let n = 0, hMin = ifcHeightMin(ifc);
  for (const e of ifc.elements) { if (e.kind !== 'slab') continue; const cr = ifcRemap(e.c), rmin = ifcRemap(e.min), rmax = ifcRemap(e.max), f = ifcFloorFor(floorLayers, cr[1] - hMin, 1.6); if (!f) continue; const x0 = Math.min(rmin[0], rmax[0]), x1 = Math.max(rmin[0], rmax[0]), z0 = Math.min(rmin[2], rmax[2]), z1 = Math.max(rmin[2], rmax[2]); const a = toPt(x0, z0), b = toPt(x1, z0), c = toPt(x1, z1), d = toPt(x0, z1); arr.push({ id: nextId++, type: 'slab', pts: [[a[0], a[1]], [b[0], b[1]], [c[0], c[1]], [d[0], d[1]]], base: f.elev, thick: Math.max(0.1, Math.min(0.4, Math.abs(rmax[1] - rmin[1]))), color: '#5b6b86', layer: f.layer }); n++; }
  return n;
}
async function ifcAllStoreysToWalls(ifc) {   // alle Geschosse → je eine editierbare Ebene mit Wänden, korrekt gestapelt (Höhe aus IfcBuildingStorey, ausgerichtet an der Geometrie-Unterkante)
  if (!pdfDoc) { toast('Erst ein Dokument öffnen/neu starten.'); return; }
  if (!docScale) { docScale = { perPt: 50 * PT2MM / 1000, label: '1:50', n: 50 }; toast('Massstab automatisch auf 1:50 gesetzt (im Footer änderbar).'); }
  if (!ifc.storeys || !ifc.storeys.filter(s => s.elev != null).length) { toast('Keine Geschoss-Höhen im IFC – nutze „⌂ Als Wände" mit Schnitthöhe.'); return; }
  status('Geschosse werden rekonstruiert …'); await new Promise(r => setTimeout(r, 20));
  const sts = ifc.storeys.filter(s => s.elev != null).slice().sort((a, b) => a.elev - b.elev), minElev = sts[0].elev, floors = [];
  for (let i = 0; i < sts.length; i++) {
    const cutY = ifcHeightMin(ifc) + (sts[i].elev - minElev) + 1.2;
    const ws = ifcPairWalls(mergeIfcSegments(ifcSliceSegments(ifc.meshes, cutY)));
    if (ws.length >= 3) { const next = sts.slice(i + 1).find(s => s.elev - sts[i].elev > 1.8); floors.push({ name: sts[i].name, elev: Math.round((sts[i].elev - minElev) * 1000) / 1000, h3d: next ? Math.min(4, next.elev - sts[i].elev) : 2.7, walls: ws }); }
  }
  if (!floors.length) { status(''); toast('Keine Geschosse mit erkennbaren Wänden gefunden – evtl. andere Geometrie.'); return; }
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const f of floors) for (const w of f.walls) { for (const x of [w.x1, w.x2]) { if (x < minx) minx = x; if (x > maxx) maxx = x; } for (const y of [w.y1, w.y2]) { if (y < miny) miny = y; if (y > maxy) maxy = y; } }
  const pad = 50, pgW = cmToPts((maxx - minx) * 100) + 2 * pad, pgH = cmToPts((maxy - miny) * 100) + 2 * pad;
  await insertBlankPage(curPage(), { w: Math.max(300, Math.round(pgW)), h: Math.max(300, Math.round(pgH)) });
  const n = curPage(), pv = pageViews.find(p => p.num === n) || pageViews[0]; if (!pv) { status(''); return; }
  const cxm = (minx + maxx) / 2, cym = (miny + maxy) / 2, pcx = (pv.pageW || 595) / 2, pcy = (pv.pageH || 842) / 2, toPt = (x, y) => [pcx + cmToPts((x - cxm) * 100), pcy + cmToPts((y - cym) * 100)];
  pushUndo();
  const arr = getAnnos(n), placedWalls = [], floorLayers = []; let first = null, nMat = 0;
  for (const f of floors) {
    const lid = newLayerId(); layers.push({ id: lid, name: f.name, visible: true, elevation: f.elev }); if (!first) first = lid;
    floorLayers.push({ layer: lid, h0: f.elev, h1: f.elev + f.h3d, elev: f.elev });
    for (const w of f.walls) {
      const wid = nextId++, a = toPt(w.x1, w.y1), b = toPt(w.x2, w.y2), mat = ifcWallMatFor(ifc, (w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2, f.elev + f.h3d / 2);
      const wo = { id: wid, type: 'wall', x1: a[0], y1: a[1], x2: b[0], y2: b[1], thick: mat ? mat.thick : cmToPts(Math.max(6, Math.min(60, w.thick * 100))), just: 'center', color: '#1c242c', fill: '#ffffff', hatch: null, width: 1.4, h3d: f.h3d, dim: false, layer: lid };
      if (mat) { wo.layers = mat.layers; wo.uVal = mat.uVal; nMat++; }
      arr.push(wo); placedWalls.push({ id: wid, x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, h0: f.elev, h1: f.elev + f.h3d, layer: lid });
    }
  }
  const nOp = ifcPlaceOpenings(ifc, placedWalls, arr), nC = ifcPlaceColumns(ifc, floorLayers, arr, toPt), nB = ifcPlaceBeams(ifc, floorLayers, arr, toPt), nS = ifcPlaceSlabs(ifc, floorLayers, arr, toPt), nR = ifcPlaceRoofs(ifc, floorLayers, arr, toPt);
  if (first) activeLayerId = first; for (const a of arr) if (a.type === 'opening') openingResolve(a, { num: n }); drawAnnos(pv); renderLayerPanel(); saveState(); status('');
  toast(floors.length + ' Geschosse · ' + placedWalls.length + ' Wände (' + nMat + ' mit IFC-Schichten/U-Wert) · ' + nOp + ' Fenster/Türen · ' + nC + ' Stützen · ' + nB + ' Träger · ' + nS + ' Decken · ' + nR + ' Dächer rekonstruiert.'); return true;
}
async function pdfPageSegments(n) {   // Vektorlinien einer PDF-Seite aus der Operator-Liste (mit CTM-Verfolgung) → Segmente in Seitenpunkten (oben-links)
  const page = await pdfDoc.getPage(n), OPS = pdfjs.OPS, opl = await page.getOperatorList(), PH = page.getViewport({ scale: 1 }).height;
  let ctm = [1, 0, 0, 1, 0, 0]; const stack = [], segs = [];
  const mul = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const comp = (m, a) => [m[0] * a[0] + m[2] * a[1], m[1] * a[0] + m[3] * a[1], m[0] * a[2] + m[2] * a[3], m[1] * a[2] + m[3] * a[3], m[0] * a[4] + m[2] * a[5] + m[4], m[1] * a[4] + m[3] * a[5] + m[5]];
  for (let i = 0; i < opl.fnArray.length; i++) {
    const fn = opl.fnArray[i], args = opl.argsArray[i];
    if (fn === OPS.save) stack.push(ctm.slice());
    else if (fn === OPS.restore) { if (stack.length) ctm = stack.pop(); }
    else if (fn === OPS.transform) ctm = comp(ctm, args);
    else if (fn === OPS.constructPath) {
      const ops = args[0], co = args[1]; let k = 0, cx = 0, cy = 0, sx = 0, sy = 0;
      const add = (x1, y1, x2, y2) => { const a = mul(ctm, x1, y1), b = mul(ctm, x2, y2); segs.push([[a[0], PH - a[1]], [b[0], PH - b[1]]]); };
      for (const op of ops) {
        if (op === OPS.moveTo) { cx = co[k++]; cy = co[k++]; sx = cx; sy = cy; }
        else if (op === OPS.lineTo) { const nx = co[k++], ny = co[k++]; add(cx, cy, nx, ny); cx = nx; cy = ny; }
        else if (op === OPS.curveTo) { k += 4; const nx = co[k++], ny = co[k++]; add(cx, cy, nx, ny); cx = nx; cy = ny; }
        else if (op === OPS.curveTo2 || op === OPS.curveTo3) { k += 2; const nx = co[k++], ny = co[k++]; add(cx, cy, nx, ny); cx = nx; cy = ny; }
        else if (op === OPS.rectangle) { const x = co[k++], y = co[k++], w = co[k++], h = co[k++]; add(x, y, x + w, y); add(x + w, y, x + w, y + h); add(x + w, y + h, x, y + h); add(x, y + h, x, y); cx = x; cy = y; sx = x; sy = y; }
        else if (op === OPS.closePath) { add(cx, cy, sx, sy); cx = sx; cy = sy; }
      }
    }
  }
  return { segs, PH };
}
async function detectWallsFromPdf() {   // Vektor-PDF-Plan → editierbare Wände (gleiche Erkennung wie IFC)
  if (!pdfDoc) { toast('Erst einen PDF-Plan öffnen.'); return; }
  if (!docScale) { toast('Erst den Massstab setzen (1:n) – sonst stimmen die Wanddicken nicht.'); return; }
  status('Wände werden aus dem PDF erkannt …'); await new Promise(r => setTimeout(r, 20));
  try {
    const n = curPage(), perPt = docScale.perPt, { segs } = await pdfPageSegments(n);
    if (!segs.length) { status(''); toast('Keine Vektorlinien gefunden – vermutlich ein gescannter (Pixel-)Plan. Das geht (noch) nicht.'); return; }
    const segM = segs.map(s => [[s[0][0] * perPt, s[0][1] * perPt], [s[1][0] * perPt, s[1][1] * perPt]]);
    const merged = mergeIfcSegments(segM).filter(s => Math.hypot(s[1][0] - s[0][0], s[1][1] - s[0][1]) > 0.25);   // Text/Schraffur (kurze) weg
    const walls = ifcPairWalls(merged);
    if (!walls.length) { status(''); toast('Keine parallelen Wandpaare erkannt. (Maßstab prüfen; Einfachlinien-Pläne haben keine Wand-Dicke zum Paaren.) ' + merged.length + ' lange Linien gefunden.'); return; }
    pushUndo();
    const lid = newLayerId(); layers.push({ id: lid, name: 'Erkannte Wände', visible: true }); const arr = getAnnos(n);
    for (const w of walls) arr.push({ id: nextId++, type: 'wall', x1: w.x1 / perPt, y1: w.y1 / perPt, x2: w.x2 / perPt, y2: w.y2 / perPt, thick: cmToPts(Math.max(6, Math.min(60, w.thick * 100))), just: 'center', color: '#1c242c', fill: '#ffffff', hatch: null, width: 1.4, h3d: wallHeightM, dim: false, layer: lid });
    activeLayerId = lid; const pv = pageViews.find(p => p.num === n); if (pv) drawAnnos(pv); renderLayerPanel(); saveState();
    status(''); toast(walls.length + ' Wände aus dem PDF erkannt (Ebene „Erkannte Wände") – in 2D & 3D editierbar. Bitte prüfen & nachjustieren.');
  } catch (e) { status(''); console.error(e); toast('Wand-Erkennung fehlgeschlagen.'); }
}
function importIFCFile() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.ifc,.ifcxml,.ifczip';
  inp.onchange = async () => {
    const fl = inp.files && inp.files[0]; if (!fl) return;
    status('IFC wird geladen (einmal Internet für die BIM-Engine) …');
    try { await loadThree(); } catch (_) { status(''); toast('3D-Engine nicht ladbar.'); return; }
    let buf; try { buf = await fl.arrayBuffer(); } catch (_) { status(''); return; }
    let ifc; try { ifc = await parseIFC(buf); } catch (e) { console.error(e); status(''); toast('IFC-Import fehlgeschlagen (' + (e && e.message || 'Format?') + ').'); return; }
    status(''); if (!ifc.meshes.length) { toast('Keine Geometrie in der IFC gefunden.'); return; }
    window._ifc = ifc; toast('IFC geladen: ' + ifc.meshes.length + ' Objekte' + (ifc.summary.length ? ' · ' + ifc.summary.map(s => s.n + ' ' + s.label).slice(0, 4).join(', ') : '')); open3DIFC(ifc);
  };
  inp.click();
}
function roomData() {   // alle Flächen-/Raum-Anmerkungen → Raumbuch-Zeilen
  const rooms = [];
  for (const n in annos) for (const a of (annos[n] || [])) {
    if (a.type !== 'area' || !a.pts || a.pts.length < 3) continue;
    if (!layerVisible(a) || !phaseVisible(a)) continue;
    const apt = polyArea(a.pts); let per = 0; for (let i = 0; i < a.pts.length; i++) { const p = a.pts[i], q = a.pts[(i + 1) % a.pts.length]; per += Math.hypot(q[0] - p[0], q[1] - p[1]); }
    const m2 = docScale ? apt * docScale.perPt * docScale.perPt : 0, um = docScale ? per * docScale.perPt : 0, lay = layerById(a.layer);
    rooms.push({ a, page: +n, floor: lay ? lay.name : '—', m2, um });
  }
  rooms.sort((x, y) => (x.floor || '').localeCompare(y.floor || '') || (y.m2 - x.m2));
  return rooms;
}
let _listTab = 'sel', _listCopyFn = null, _lastInspId = null;
function openListPanel(tab) {   // rechtes Inspector/Listen-Panel zeigen + Tab wählen
  if (tab) _listTab = tab; const p = document.getElementById('listPanel'); if (!p) return; p.hidden = false; document.body.classList.add('list-open');   // schiebt die Vorschau zur Seite (wie Kommentar-Panel)
  document.querySelectorAll('.lp2-tab').forEach(b => b.classList.toggle('on', b.dataset.lt === _listTab));
  const cp = document.getElementById('lp2Copy'); if (cp) cp.style.display = _listTab === 'sel' ? 'none' : '';   // Kopieren nur bei Listen
  const sb = document.getElementById('srInspect'); if (sb) sb.classList.add('on');
  renderList(); if (zoom === 'auto') relayout();   // Vorschau wird schmaler → Seite neu einpassen
}
function closeListPanel() { const p = document.getElementById('listPanel'); if (p) p.hidden = true; document.body.classList.remove('list-open'); const sb = document.getElementById('srInspect'); if (sb) sb.classList.remove('on'); if (zoom === 'auto') relayout(); }   // wieder volle Breite → Seite neu einpassen
function renderList() {   // aktuellen Tab in den Panel-Body rendern (Inspector + Listen einheitlich)
  const body = document.getElementById('lp2Body'); if (!body) return; body.innerHTML = ''; _listCopyFn = null;
  if (_listTab === 'sel') { fillSelectionInspector(body); return; }
  if (!docScale) { body.innerHTML = '<p class="lp2-empty">Für Flächen/Mengen in m² zuerst den Massstab setzen (1:n) – unten in der Fusszeile.</p>'; return; }
  if (_listTab === 'rooms') _listCopyFn = fillRoomList(body);
  else if (_listTab === 'qty') _listCopyFn = fillQtyList(body);
  else if (_listTab === 'schedule') _listCopyFn = fillScheduleList(body);
  else if (_listTab === 'walls') _listCopyFn = fillWallList(body);
  else if (_listTab === 'belag') _listCopyFn = fillBelagList(body);
}
function fillSelectionInspector(body) {   // „Auswahl"-Tab: Einstellungen des gewählten Bauteils (wie ein Inspector)
  const a = sel ? findAnno(sel.num, sel.id) : null, pv = sel ? pageViews.find(p => p.num === sel.num) : null;
  if (!a || !pv) { body.innerHTML = '<p class="lp2-empty">Kein Bauteil gewählt.<br><br>Wähle ein <b>Fenster</b>, eine <b>Tür</b>, eine <b>Wand</b> oder eine <b>Fläche</b> an – die Einstellungen erscheinen hier.</p>'; return; }
  if (a.type === 'opening') {
    body.innerHTML = '<h4>' + (a.kind === 'window' ? 'Fenster' : 'Tür') + ' · Rahmen / Flügel</h4>';
    const wrap = document.createElement('div'); body.appendChild(wrap); buildFrameFields(wrap, a, pv);
    body.insertAdjacentHTML('beforeend', '<p class="insp-hint">Laibung: im Plan auf die gestrichelten Linien klicken (zoomt rein) oder die Kanten ziehen. + / − an jeder Schicht.</p>');
    return;
  }
  if (a.type === 'wall') {
    const u = a.layers && a.layers.length ? wallUValue(a.layers, a.uVal) : null, tcm = a.layers && a.layers.length ? a.layers.reduce((s, l) => s + ptsToCm(l.t), 0) : ptsToCm(a.thick || wallThickPts());
    body.innerHTML = '<h4>Wand</h4>' + (a.layers && a.layers.length ? buildupThumb(a.layers, tcm) : '') +
      '<div class="insp-kv"><span>Dicke</span><b>' + (Math.round(tcm * 10) / 10) + ' cm</b></div>' +
      (u != null ? '<div class="insp-kv"><span>U-Wert</span><b>' + (Math.round(u * 1000) / 1000).toFixed(3) + ' W/m²K</b></div>' : '') +
      '<div class="insp-kv"><span>Höhe (m)</span><input class="insp-num" id="iWh" type="number" step="0.05" min="0.5" value="' + (a.h3d || wallHeightM) + '"></div>';
    const wh = body.querySelector('#iWh'); if (wh) wh.onchange = () => { const v = parseFloat((wh.value || '').replace(',', '.')); if (v > 0) { pushUndo(); a.h3d = v; pageViews.forEach(drawAnnos); saveState(); } };
    const bb = document.createElement('button'); bb.className = 'insp-btn'; bb.textContent = '▦ Schicht-Aufbau bearbeiten'; bb.onclick = () => openBuildPop(a, () => { pageViews.forEach(drawAnnos); renderList(); }); body.appendChild(bb);   // Wandaufbau-Editor direkt aus dem Inspector
    body.insertAdjacentHTML('beforeend', '<p class="insp-hint">Ausrichtung/Farbe in der Planungsleiste. Im Schnitt sind die Höhen direkt ziehbar.</p>');
    return;
  }
  if (a.type === 'area' && a.cutout) {
    const m2 = docScale ? polyArea(a.pts || []) * docScale.perPt * docScale.perPt : 0;
    body.innerHTML = '<h4>Aussparung</h4>' + (m2 ? '<div class="insp-kv"><span>Fläche</span><b>' + (Math.round(m2 * 100) / 100).toFixed(2).replace('.', ',') + ' m²</b></div>' : '')
      + '<div class="insp-row"><span class="insp-lbl">Art</span><span id="iCk" style="display:inline-flex;gap:3px;flex-wrap:wrap">' + ['Schrank', 'Dusche', 'Wanne', 'frei'].map(k => '<button class="insp-mini' + (a.cutout === k ? ' on' : '') + '" data-k="' + k + '" style="width:auto;padding:0 8px">' + k + '</button>').join('') + '</span></div>';
    body.querySelectorAll('#iCk .insp-mini').forEach(btn => btn.onclick = () => { a.cutout = btn.dataset.k; markDirty(); pageViews.forEach(drawAnnos); renderList(); });
    body.insertAdjacentHTML('beforeend', '<p class="insp-hint">Wird von der darunterliegenden Belagsfläche abgezogen → Netto-Fläche in Liste & Ausschreibung.</p>');
    return;
  }
  if (a.type === 'area') {
    const m2 = docScale ? polyArea(a.pts || []) * docScale.perPt * docScale.perPt : 0;
    body.innerHTML = '<h4>Fläche / Raum</h4>' + (m2 ? '<div class="insp-kv"><span>Fläche</span><b>' + (Math.round(m2 * 100) / 100).toFixed(2).replace('.', ',') + ' m²</b></div>' : '') +
      '<div class="insp-row"><span class="insp-lbl">Raumname</span><input class="insp-num" style="width:120px" id="iNm" value="' + (a.name ? a.name.replace(/"/g, '&quot;') : '') + '" placeholder="z. B. Wohnen"></div>' +
      '<div class="insp-row"><span class="insp-lbl">Bodenbelag</span><input class="insp-num" style="width:120px" id="iFl" value="' + (a.floor ? a.floor.replace(/"/g, '&quot;') : '') + '" placeholder="z. B. Parkett"></div>';
    if (a.belag) {
      const b = a.belag;
      let bh = '<div class="insp-lbl" style="margin-top:10px;font-weight:700;color:var(--ink)">⌗ Plattenspiegel</div>'
        + '<div class="insp-row"><span class="insp-lbl">Platte B×H</span><input class="insp-num" style="width:50px" id="iTW" type="number" min="1" value="' + b.tileW + '"> × <input class="insp-num" style="width:50px" id="iTH" type="number" min="1" value="' + b.tileH + '"> cm</div>'
        + '<div class="insp-row"><span class="insp-lbl">Fuge</span><input class="insp-num" style="width:60px" id="iJ" type="number" min="0" value="' + (b.joint != null ? b.joint : 3) + '"> mm</div>'
        + '<div class="insp-row"><span class="insp-lbl">Verschnitt</span><input class="insp-num" style="width:60px" id="iWa" type="number" min="0" value="' + (b.waste != null ? b.waste : 8) + '"> %</div>'
        + '<div class="insp-row"><span class="insp-lbl">Aufbau</span><input class="insp-num" style="width:120px" id="iAu" value="' + (a.aufbau ? a.aufbau.replace(/"/g, '&quot;') : '') + '" placeholder="z. B. OK FB / roher Boden"></div>'
        + '<div class="insp-row"><span class="insp-lbl">Start (von wo)</span><span id="iStart" style="display:inline-flex;gap:3px">'
        + ['tl:◰:oben links', 'tr:◳:oben rechts', 'bl:◱:unten links', 'br:◲:unten rechts', 'center:⊹:mittig (symmetrisch)'].map(s => { const [c, ic, ti] = s.split(':'); return '<button class="insp-mini' + (b.startCorner === c ? ' on' : (!b.startCorner && c === 'tl' ? ' on' : '')) + '" data-c="' + c + '" title="' + ti + '">' + ic + '</button>'; }).join('') + '</span></div>'
        + '<div class="insp-row"><span class="insp-lbl">Richtung</span><span id="iDir" style="display:inline-flex;gap:3px"><button class="insp-mini' + (b.angle !== 45 ? ' on' : '') + '" data-a="0" title="gerade">▦</button><button class="insp-mini' + (b.angle === 45 ? ' on' : '') + '" data-a="45" title="diagonal 45°">◇</button></span></div>';
      if (docScale && m2) bh += '<div class="insp-kv"><span>Platten (inkl. Verschnitt)</span><b>' + tilesForArea(m2, b.tileW, b.tileH, b.waste || 0) + ' Stk</b></div>';
      body.insertAdjacentHTML('beforeend', bh);
    }
    const nm = body.querySelector('#iNm'), fl = body.querySelector('#iFl');
    if (nm) nm.onchange = () => { const v = nm.value.trim(); if (v) a.name = v; else delete a.name; markDirty(); pageViews.forEach(drawAnnos); };
    if (fl) fl.onchange = () => { const v = fl.value.trim(); if (v) a.floor = v; else delete a.floor; markDirty(); pageViews.forEach(drawAnnos); };
    if (a.belag) {
      const bindNum = (id, key) => { const el = body.querySelector(id); if (el) el.onchange = () => { const v = parseFloat((el.value || '').replace(',', '.')); if (isFinite(v) && v >= 0) { a.belag[key] = v; markDirty(); pageViews.forEach(drawAnnos); renderList(); } }; };
      bindNum('#iTW', 'tileW'); bindNum('#iTH', 'tileH'); bindNum('#iJ', 'joint'); bindNum('#iWa', 'waste');
      const au = body.querySelector('#iAu'); if (au) au.onchange = () => { const v = au.value.trim(); if (v) a.aufbau = v; else delete a.aufbau; markDirty(); pageViews.forEach(drawAnnos); };
      body.querySelectorAll('#iStart .insp-mini').forEach(btn => btn.onclick = () => {
        const pts = a.pts; let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9; for (const q of pts) { if (q[0] < minX) minX = q[0]; if (q[0] > maxX) maxX = q[0]; if (q[1] < minY) minY = q[1]; if (q[1] > maxY) maxY = q[1]; }
        const jw = Math.max(0, a.belag.joint || 0) / 1000, perPt = docScale ? docScale.perPt : 1, stepX = ((a.belag.tileW / 100) + jw) / perPt, stepY = ((a.belag.tileH / 100) + jw) / perPt;
        a.belag.startCorner = btn.dataset.c; a.belag.start = tileStartPoint(minX, minY, maxX, maxY, btn.dataset.c, stepX, stepY);
        markDirty(); pageViews.forEach(drawAnnos); renderList();
      });
      body.querySelectorAll('#iDir .insp-mini').forEach(btn => btn.onclick = () => { a.belag.angle = +btn.dataset.a; markDirty(); pageViews.forEach(drawAnnos); renderList(); });
    }
    const tb = document.createElement('button'); tb.className = 'insp-btn'; tb.textContent = a.belag ? '⌗ Plattenspiegel entfernen' : '⌗ Plattenspiegel hinzufügen';
    tb.onclick = () => { pushUndo(); if (a.belag) delete a.belag; else { a.belag = { ...DEFAULT_BELAG }; if (a.color === '#4f7a3c' || !a.color) a.color = '#b5651d'; } markDirty(); pageViews.forEach(drawAnnos); renderList(); };
    body.appendChild(tb);
    return;
  }
  if (a.type === 'measure' && a.wallface) {
    const lenPts = Math.hypot(a.x2 - a.x1, a.y2 - a.y1), lenM = docScale ? lenPts * docScale.perPt : 0, h = a.height || 2.5;
    const area = docScale ? wallFaceAreaM2(lenPts, docScale.perPt, h) : 0, b = a.belag || (a.belag = { ...DEFAULT_BELAG });
    let html = '<h4>Wandbelag</h4>'
      + (docScale ? '<div class="insp-kv"><span>Länge</span><b>' + (Math.round(lenM * 100) / 100).toFixed(2).replace('.', ',') + ' m</b></div>' : '')
      + '<div class="insp-row"><span class="insp-lbl">Höhe</span><input class="insp-num" style="width:60px" id="iWfH" type="number" step="0.05" min="0.1" value="' + h + '"> m</div>'
      + (docScale ? '<div class="insp-kv"><span>Wandfläche</span><b>' + (Math.round(area * 100) / 100).toFixed(2).replace('.', ',') + ' m²</b></div>' : '')
      + '<div class="insp-row"><span class="insp-lbl">Name</span><input class="insp-num" style="width:120px" id="iWfN" value="' + (a.name ? a.name.replace(/"/g, '&quot;') : '') + '" placeholder="z. B. Bad Wand N"></div>'
      + '<div class="insp-lbl" style="margin-top:10px;font-weight:700;color:var(--ink)">⌗ Plattenspiegel</div>'
      + '<div class="insp-row"><span class="insp-lbl">Platte B×H</span><input class="insp-num" style="width:50px" id="iWfTW" type="number" min="1" value="' + b.tileW + '"> × <input class="insp-num" style="width:50px" id="iWfTH" type="number" min="1" value="' + b.tileH + '"> cm</div>'
      + '<div class="insp-row"><span class="insp-lbl">Fuge</span><input class="insp-num" style="width:60px" id="iWfJ" type="number" min="0" value="' + (b.joint != null ? b.joint : 3) + '"> mm</div>'
      + '<div class="insp-row"><span class="insp-lbl">Verschnitt</span><input class="insp-num" style="width:60px" id="iWfWa" type="number" min="0" value="' + (b.waste != null ? b.waste : 8) + '"> %</div>'
      + '<div class="insp-row"><span class="insp-lbl">Aufbau</span><input class="insp-num" style="width:120px" id="iWfAu" value="' + (a.aufbau ? a.aufbau.replace(/"/g, '&quot;') : '') + '" placeholder="z. B. bis H 2.10"></div>';
    if (docScale && area) html += '<div class="insp-kv"><span>Platten (inkl. Verschnitt)</span><b>' + tilesForArea(area, b.tileW, b.tileH, b.waste || 0) + ' Stk</b></div>';
    const ans = a.ans || (a.ans = { boden: true, decke: true, wand: 2 });   // Anschlüsse (Randfugen) direkt aus der Wand
    html += '<div class="insp-lbl" style="margin-top:10px;font-weight:700;color:var(--ink)">Anschlüsse (Randfugen)</div>'
      + '<div class="insp-row"><span class="insp-lbl">Boden / Decke</span><span style="display:inline-flex;gap:3px"><button class="insp-mini' + (ans.boden ? ' on' : '') + '" id="anB" style="width:auto;padding:0 8px">Boden</button><button class="insp-mini' + (ans.decke ? ' on' : '') + '" id="anD" style="width:auto;padding:0 8px">Decke</button></span></div>'
      + '<div class="insp-row"><span class="insp-lbl">Wand seitlich</span><span id="anW" style="display:inline-flex;gap:3px">' + [0, 1, 2].map(n => '<button class="insp-mini' + ((ans.wand || 0) === n ? ' on' : '') + '" data-n="' + n + '" style="width:26px">' + n + '</button>').join('') + '</span></div>';
    if (docScale) html += '<div class="insp-kv"><span>Anschluss lfm gesamt</span><b>' + (Math.round(((ans.boden ? lenM : 0) + (ans.decke ? lenM : 0) + (ans.wand || 0) * h) * 100) / 100).toFixed(2).replace('.', ',') + ' m</b></div>';
    const fen = a.fenster || [];
    html += '<div class="insp-lbl" style="margin-top:10px;font-weight:700;color:var(--ink)">Fenster / Aussparung</div>'
      + '<div class="insp-row"><span class="insp-lbl">Fenster (' + fen.length + ')</span><span style="display:inline-flex;gap:4px"><button class="insp-mini" id="fenAdd" style="width:auto;padding:0 8px">+ Fenster</button><button class="insp-mini" id="fenDel" style="width:auto;padding:0 8px">−</button></span></div>';
    if (fen.length && docScale) html += '<div class="insp-kv"><span>Wandfläche netto</span><b>' + (Math.round(Math.max(0, area - fen.reduce((s, f) => s + (f.w || 0) * (f.h || 0), 0)) * 100) / 100).toFixed(2).replace('.', ',') + ' m²</b></div>';
    html += '<div class="insp-row"><span class="insp-lbl">Wand-Ansicht</span><span><button class="insp-mini' + (a.ansicht !== false ? ' on' : '') + '" id="wfElev" style="width:auto;padding:0 8px">' + (a.ansicht !== false ? 'sichtbar' : 'aus') + '</button></span></div>';
    body.innerHTML = html;
    const hEl = body.querySelector('#iWfH'); if (hEl) hEl.onchange = () => { const v = parseFloat((hEl.value || '').replace(',', '.')); if (v > 0) { a.height = v; markDirty(); pageViews.forEach(drawAnnos); renderList(); } };
    const nm = body.querySelector('#iWfN'); if (nm) nm.onchange = () => { const v = nm.value.trim(); if (v) a.name = v; else delete a.name; markDirty(); pageViews.forEach(drawAnnos); };
    const bindB = (id, key) => { const el = body.querySelector(id); if (el) el.onchange = () => { const v = parseFloat((el.value || '').replace(',', '.')); if (isFinite(v) && v >= 0) { a.belag[key] = v; markDirty(); pageViews.forEach(drawAnnos); renderList(); } }; };
    bindB('#iWfTW', 'tileW'); bindB('#iWfTH', 'tileH'); bindB('#iWfJ', 'joint'); bindB('#iWfWa', 'waste');
    const au = body.querySelector('#iWfAu'); if (au) au.onchange = () => { const v = au.value.trim(); if (v) a.aufbau = v; else delete a.aufbau; markDirty(); pageViews.forEach(drawAnnos); };
    const tgl = (id, key) => { const el = body.querySelector(id); if (el) el.onclick = () => { a.ans[key] = !a.ans[key]; markDirty(); renderList(); pageViews.forEach(drawAnnos); }; };
    tgl('#anB', 'boden'); tgl('#anD', 'decke');
    body.querySelectorAll('#anW .insp-mini').forEach(btn => btn.onclick = () => { a.ans.wand = +btn.dataset.n; markDirty(); renderList(); pageViews.forEach(drawAnnos); });
    const fa = body.querySelector('#fenAdd'); if (fa) fa.onclick = () => { a.fenster = a.fenster || []; const n = a.fenster.length; a.fenster.push({ t: (n + 1) / (a.fenster.length + 2), w: 1.0, h: 1.2, sill: 0.9 }); markDirty(); renderList(); pageViews.forEach(drawAnnos); };
    const fd = body.querySelector('#fenDel'); if (fd) fd.onclick = () => { if (a.fenster && a.fenster.length) { a.fenster.pop(); markDirty(); renderList(); pageViews.forEach(drawAnnos); } };
    const we = body.querySelector('#wfElev'); if (we) we.onclick = () => { a.ansicht = a.ansicht === false ? true : false; markDirty(); renderList(); pageViews.forEach(drawAnnos); };
    return;
  }
  if (a.anschluss && (a.type === 'measure' || a.type === 'chaindim')) {
    const len = a.type === 'chaindim' ? polylineLen(a.pts) : Math.hypot(a.x2 - a.x1, a.y2 - a.y1), lm = docScale ? len * docScale.perPt : 0;
    body.innerHTML = '<h4>Anschluss</h4>' + (docScale ? '<div class="insp-kv"><span>Länge</span><b>' + (Math.round(lm * 100) / 100).toFixed(2).replace('.', ',') + ' m</b></div>' : '')
      + '<div class="insp-row"><span class="insp-lbl">Art</span><span id="iAk" style="display:inline-flex;gap:3px;flex-wrap:wrap">' + Object.keys(ANSCHLUSS_KAT).map(k => '<button class="insp-mini' + (a.anschluss === k ? ' on' : '') + '" data-k="' + k + '" style="width:auto;padding:0 8px">' + ANSCHLUSS_KAT[k] + '</button>').join('') + '</span></div>'
      + '<div class="insp-row"><span class="insp-lbl">Name</span><input class="insp-num" style="width:120px" id="iAn" value="' + (a.name ? a.name.replace(/"/g, '&quot;') : '') + '" placeholder="z. B. Bad Sockel"></div>';
    body.querySelectorAll('#iAk .insp-mini').forEach(btn => btn.onclick = () => { a.anschluss = btn.dataset.k; markDirty(); pageViews.forEach(drawAnnos); renderList(); });
    const nm = body.querySelector('#iAn'); if (nm) nm.onchange = () => { const v = nm.value.trim(); if (v) a.name = v; else delete a.name; markDirty(); pageViews.forEach(drawAnnos); };
    return;
  }
  body.innerHTML = '<h4>' + (a.type || 'Bauteil') + '</h4><p class="lp2-empty">Für diesen Typ gibt es (noch) keine Inspector-Einstellungen. Doppelklick im Plan öffnet ggf. die Eingabe.</p>';
}
function syncInspector() {   // Auswahl gewechselt → Inspector zeigen/aktualisieren (Bauteil anwählen ⇒ Einstellungen rechts)
  const id = sel ? sel.id : null; if (id === _lastInspId) return; _lastInspId = id;
  const p = document.getElementById('listPanel'); if (!p || p.hidden) return;   // nur aktualisieren, wenn Panel offen (Einklappen wird respektiert)
  const a = (id != null && sel) ? findAnno(sel.num, sel.id) : null;
  if (a && (a.type === 'opening' || a.type === 'wall' || a.type === 'area' || (a.type === 'measure' && (a.wallface || a.anschluss)) || (a.type === 'chaindim' && a.anschluss))) { _listTab = 'sel'; openListPanel('sel'); }   // Bauteil gewählt → Inspector zeigt Einstellungen
  else if (_listTab === 'sel') renderList();   // abgewählt → Inspector leeren
}
function fillRoomList(bodyEl) {   // Raumbuch in das Listen-Panel
  const rooms = roomData(), total = rooms.reduce((s, r) => s + r.m2, 0);
  bodyEl.innerHTML = '<h4>' + rooms.length + ' Räume · Name & Bodenbelag werden gespeichert</h4>' + (rooms.length ? ('<table class="qty-tab"><thead><tr><th>Ebene</th><th>Raum (Name)</th><th style="text-align:right">Fläche</th><th style="text-align:right">Umfang</th><th>Bodenbelag</th></tr></thead><tbody>' +
    rooms.map((r, i) => '<tr><td style="white-space:nowrap">' + r.floor + '</td><td><input class="bu-u" style="width:110px" data-i="' + i + '" data-k="name" value="' + (r.a.name ? r.a.name.replace(/"/g, '&quot;') : '') + '" placeholder="z. B. Wohnen"></td><td style="text-align:right;white-space:nowrap">' + (Math.round(r.m2 * 100) / 100).toFixed(2).replace('.', ',') + ' m²</td><td style="text-align:right;white-space:nowrap">' + (Math.round(r.um * 100) / 100).toFixed(2).replace('.', ',') + ' m</td><td><input class="bu-u" style="width:110px" data-i="' + i + '" data-k="floor" value="' + (r.a.floor ? r.a.floor.replace(/"/g, '&quot;') : '') + '" placeholder="z. B. Parkett"></td></tr>').join('') +
    '</tbody><tfoot><tr><th colspan="2" style="text-align:right">Summe</th><th style="text-align:right;white-space:nowrap">' + (Math.round(total * 100) / 100).toFixed(2).replace('.', ',') + ' m²</th><th colspan="2"></th></tr></tfoot></table>') : '<p class="lp2-empty">Noch keine Räume/Flächen. Zeichne mit dem Flächen-Werkzeug einen geschlossenen Wandzug oder ein Polygon.</p>');
  bodyEl.querySelectorAll('input.bu-u').forEach(inp => inp.onchange = () => { const r = rooms[+inp.dataset.i]; if (!r) return; const k = inp.dataset.k, v = inp.value.trim(); if (v) r.a[k] = v; else delete r.a[k]; markDirty(); pageViews.forEach(drawAnnos); });
  return () => { const tsv = 'Ebene\tRaum\tFläche m²\tUmfang m\tBodenbelag\n' + rooms.map(r => r.floor + '\t' + (r.a.name || '') + '\t' + (Math.round(r.m2 * 100) / 100).toString().replace('.', ',') + '\t' + (Math.round(r.um * 100) / 100).toString().replace('.', ',') + '\t' + (r.a.floor || '')).join('\n') + '\nSumme\t\t' + (Math.round(total * 100) / 100).toString().replace('.', ','); if (navigator.clipboard) navigator.clipboard.writeText(tsv); toast('Raumbuch kopiert (Excel-tauglich).'); };
}
function openRoomList() { openListPanel('rooms'); }
// Beläge sammeln: Bodenbeläge (area+belag) und Wandflächen (measure+wallface) über alle Seiten
function belagData() {
  const floors = [], walls = [], anschluesse = [], cutouts = []; if (!docScale) return { floors, walls, anschluesse, cutouts };
  const pp = docScale.perPt;
  for (const n of Object.keys(annos)) for (const a of (annos[n] || [])) {
    if (a.type === 'area' && a.cutout && a.pts && a.pts.length >= 3) {
      cutouts.push({ a, name: (typeof a.cutout === 'string' && a.cutout) ? a.cutout : 'Aussparung', m2: polyArea(a.pts) * pp * pp, c: centroid(a.pts) });
    } else if (a.type === 'area' && a.belag && a.pts && a.pts.length >= 3) {
      const b = a.belag;
      floors.push({ a, name: a.name || a.floor || '', grossM2: polyArea(a.pts) * pp * pp, poly: a.pts, b, aufbau: a.aufbau || '' });
    } else if (a.type === 'measure' && a.wallface) {
      const len = Math.hypot(a.x2 - a.x1, a.y2 - a.y1), h = a.height || 2.5, gross = wallFaceAreaM2(len, pp, h), b = a.belag || DEFAULT_BELAG, wl = len * pp;
      const fen = a.fenster || [], fenAr = fen.reduce((s, f) => s + (f.w || 0) * (f.h || 0), 0), m2 = Math.max(0, gross - fenAr);
      walls.push({ a, name: a.name || '', m2, grossM2: gross, fenM2: fenAr, h, lenM: wl, tiles: tilesForArea(m2, b.tileW, b.tileH, b.waste || 0), b, aufbau: a.aufbau || '' });
      const ans = a.ans || { boden: true, decke: true, wand: 2 };   // Anschlüsse direkt aus der Wandgeometrie
      const nm = a.name ? a.name + ' – ' : '';
      if (ans.boden) anschluesse.push({ a, kat: 'boden', katLabel: 'Boden', name: nm + 'Wandbelag unten', lenM: wl });
      if (ans.decke) anschluesse.push({ a, kat: 'decke', katLabel: 'Decke', name: nm + 'Wandbelag oben', lenM: wl });
      if (ans.wand) anschluesse.push({ a, kat: 'wand', katLabel: 'Wand', name: nm + 'Wandbelag seitlich', lenM: (ans.wand || 0) * h });
      if (fen.length) anschluesse.push({ a, kat: 'fenster', katLabel: 'Fenster', name: nm + 'Fensteranschluss', lenM: fen.reduce((s, f) => s + 2 * ((f.w || 0) + (f.h || 0)), 0) });
    } else if ((a.type === 'measure' || a.type === 'chaindim') && a.anschluss) {
      const lp = a.type === 'chaindim' ? polylineLen(a.pts) : Math.hypot(a.x2 - a.x1, a.y2 - a.y1);
      anschluesse.push({ a, kat: a.anschluss, katLabel: ANSCHLUSS_KAT[a.anschluss] || a.anschluss, name: a.name || '', lenM: lp * pp });
    }
  }
  // Aussparungen von den Böden abziehen (Aussparungs-Schwerpunkt liegt in der Fläche) → Netto-Fläche
  floors.forEach(f => { let cut = 0; for (const c of cutouts) if (pointInPoly(c.c, f.poly)) cut += c.m2; f.cutM2 = cut; f.m2 = Math.max(0, f.grossM2 - cut); f.tiles = tilesForArea(f.m2, f.b.tileW, f.b.tileH, f.b.waste || 0); });
  return { floors, walls, anschluesse, cutouts };
}
function fillBelagList(bodyEl) {   // Boden-/Wandbeläge mit Flächen, Platten & Summen
  if (!docScale) { bodyEl.innerHTML = '<p class="lp2-empty">Für Belags-Mengen zuerst den Massstab setzen (1:n) – unten in der Fusszeile.</p>'; return null; }
  const { floors, walls, anschluesse } = belagData();
  if (!floors.length && !walls.length && !anschluesse.length) { bodyEl.innerHTML = '<p class="lp2-empty">Noch keine Beläge. Zeichne mit <b>Bodenbelag</b> eine Fläche, mit <b>Wandbelag</b> eine Wand oder mit <b>Anschluss</b> eine Kante.</p>'; return null; }
  const fmt = x => (Math.round(x * 100) / 100).toFixed(2).replace('.', ',');
  const fm2 = floors.reduce((s, r) => s + r.m2, 0), ft = floors.reduce((s, r) => s + r.tiles, 0);
  const wm2 = walls.reduce((s, r) => s + r.m2, 0), wt = walls.reduce((s, r) => s + r.tiles, 0);
  let html = '<div style="display:flex;gap:6px;margin-bottom:10px"><button class="insp-btn" id="belExpA" style="width:auto;flex:1" title="Als Ausschreibung nach Submit Paper (mit leerer Preisspalte)">→ Ausschreibung</button><button class="insp-btn" id="belExpM" style="width:auto;flex:1" title="Als Mengenauszug nach Submit Paper (ohne Preisspalte)">→ Mengenauszug</button></div>';
  if (floors.length) html += '<h4>Bodenbeläge (' + floors.length + ')</h4><table class="qty-tab"><thead><tr><th>Raum</th><th style="text-align:right">Fläche</th><th style="text-align:right">Platte</th><th style="text-align:right">Platten</th></tr></thead><tbody>'
    + floors.map(r => '<tr><td>' + (_htmlEsc(r.name) || '–') + (r.aufbau ? '<div style="font-size:10px;color:var(--ink-soft)">' + _htmlEsc(r.aufbau) + '</div>' : '') + (r.cutM2 ? '<div style="font-size:10px;color:var(--ink-soft)">netto · abzügl. Aussparungen ' + fmt(r.cutM2) + ' m²</div>' : '') + '</td><td style="text-align:right;white-space:nowrap">' + fmt(r.m2) + ' m²</td><td style="text-align:right;white-space:nowrap">' + r.b.tileW + '×' + r.b.tileH + '</td><td style="text-align:right">' + r.tiles + '</td></tr>').join('')
    + '</tbody><tfoot><tr><th style="text-align:right">Summe</th><th style="text-align:right;white-space:nowrap">' + fmt(fm2) + ' m²</th><th></th><th style="text-align:right">' + ft + '</th></tr></tfoot></table>';
  if (walls.length) html += '<h4 style="margin-top:14px">Wandflächen (' + walls.length + ')</h4><table class="qty-tab"><thead><tr><th>Wand</th><th style="text-align:right">L×H</th><th style="text-align:right">Fläche</th><th style="text-align:right">Platten</th></tr></thead><tbody>'
    + walls.map(r => '<tr><td>' + (_htmlEsc(r.name) || '–') + (r.aufbau ? '<div style="font-size:10px;color:var(--ink-soft)">' + _htmlEsc(r.aufbau) + '</div>' : '') + '</td><td style="text-align:right;white-space:nowrap">' + fmt(r.lenM) + '×' + fmt(r.h) + '</td><td style="text-align:right;white-space:nowrap">' + fmt(r.m2) + ' m²</td><td style="text-align:right">' + r.tiles + '</td></tr>').join('')
    + '</tbody><tfoot><tr><th style="text-align:right" colspan="2">Summe</th><th style="text-align:right;white-space:nowrap">' + fmt(wm2) + ' m²</th><th style="text-align:right">' + wt + '</th></tr></tfoot></table>';
  if (anschluesse.length) {
    const byKat = {}; anschluesse.forEach(r => { (byKat[r.kat] = byKat[r.kat] || { label: r.katLabel, len: 0, n: 0 }); byKat[r.kat].len += r.lenM; byKat[r.kat].n++; });
    const total = anschluesse.reduce((s, r) => s + r.lenM, 0);
    html += '<h4 style="margin-top:14px">Anschlüsse (' + anschluesse.length + ')</h4><table class="qty-tab"><thead><tr><th>Art</th><th style="text-align:right">Stk</th><th style="text-align:right">Länge</th></tr></thead><tbody>'
      + Object.keys(byKat).map(k => '<tr><td>Anschluss ' + _htmlEsc(byKat[k].label) + '</td><td style="text-align:right">' + byKat[k].n + '</td><td style="text-align:right;white-space:nowrap">' + fmt(byKat[k].len) + ' m</td></tr>').join('')
      + '</tbody><tfoot><tr><th style="text-align:right" colspan="2">Summe</th><th style="text-align:right;white-space:nowrap">' + fmt(total) + ' m</th></tr></tfoot></table>';
  }
  bodyEl.innerHTML = html;
  { const ba = bodyEl.querySelector('#belExpA'); if (ba) ba.onclick = () => exportBelagToPaper('ausschreibung'); const bm = bodyEl.querySelector('#belExpM'); if (bm) bm.onclick = () => exportBelagToPaper('mengen'); }
  return () => {
    const tsv = 'Bodenbeläge\nRaum\tFläche m²\tPlatte\tPlatten\n' + floors.map(r => (r.name || '') + '\t' + fmt(r.m2) + '\t' + r.b.tileW + '×' + r.b.tileH + '\t' + r.tiles).join('\n') + '\nSumme\t' + fmt(fm2) + '\t\t' + ft
      + '\n\nWandflächen\nWand\tL×H\tFläche m²\tPlatten\n' + walls.map(r => (r.name || '') + '\t' + fmt(r.lenM) + '×' + fmt(r.h) + '\t' + fmt(r.m2) + '\t' + r.tiles).join('\n') + '\nSumme\t\t' + fmt(wm2) + '\t' + wt;
    if (navigator.clipboard) navigator.clipboard.writeText(tsv); toast('Belags-Liste kopiert (Excel-tauglich).');
  };
}
function openBelagList() { openListPanel('belag'); }
// Ausschreibungs-/Mengenauszug-Tabelle (rein) – Spalten: Pos · Beschrieb · Ausmass · Einheit (+ leere Einheitspreis/Betrag bei Ausschreibung)
function buildBelagTableHtml(floors, walls, price, anschluesse) {
  anschluesse = anschluesse || [];
  const fmt = x => (Math.round(x * 100) / 100).toFixed(2).replace('.', ','), cols = price ? 6 : 4, pad = price ? '<td></td><td></td>' : '';
  const head = '<tr>' + ['Pos.', 'Beschrieb', 'Ausmass', 'Einh.'].concat(price ? ['Einheitspreis', 'Betrag'] : []).map(h => '<th>' + h + '</th>').join('') + '</tr>';
  const posRow = (pos, besch, menge, einh) => '<tr><td>' + pos + '</td><td>' + _htmlEsc(besch) + '</td><td style="text-align:right;white-space:nowrap">' + fmt(menge) + '</td><td>' + einh + '</td>' + pad + '</tr>';
  const zt = (title, sum, einh) => '<tr><td></td><td><em>Zwischentotal ' + title + '</em></td><td style="text-align:right;white-space:nowrap"><strong>' + fmt(sum) + '</strong></td><td>' + einh + '</td>' + pad + '</tr>';
  let rows = '', sec = 0;
  if (floors.length) { sec++; rows += '<tr><td colspan="' + cols + '"><strong>' + sec + '  Bodenbeläge</strong></td></tr>'; floors.forEach((r, i) => rows += posRow(sec + '.' + (i + 1), (r.name || 'Bodenbelag') + ' · Platten ' + r.b.tileW + '×' + r.b.tileH + (r.aufbau ? ' · ' + r.aufbau : '') + (r.cutM2 ? ' · netto (abzügl. Aussparungen ' + fmt(r.cutM2) + ' m²)' : ''), r.m2, 'm²')); rows += zt('Bodenbeläge', floors.reduce((s, r) => s + r.m2, 0), 'm²'); }
  if (walls.length) { sec++; rows += '<tr><td colspan="' + cols + '"><strong>' + sec + '  Wandflächen</strong></td></tr>'; walls.forEach((r, i) => rows += posRow(sec + '.' + (i + 1), (r.name || 'Wandbelag') + ' · H ' + fmt(r.h || 0) + ' m · Platten ' + r.b.tileW + '×' + r.b.tileH + (r.aufbau ? ' · ' + r.aufbau : ''), r.m2, 'm²')); rows += zt('Wandflächen', walls.reduce((s, r) => s + r.m2, 0), 'm²'); }
  if (anschluesse.length) {
    sec++; rows += '<tr><td colspan="' + cols + '"><strong>' + sec + '  Anschlüsse</strong></td></tr>';
    const byKat = {}; anschluesse.forEach(r => { byKat[r.kat] = byKat[r.kat] || { label: r.katLabel || r.kat, len: 0 }; byKat[r.kat].len += r.lenM; });
    let i = 0; Object.keys(byKat).forEach(k => { i++; rows += posRow(sec + '.' + i, 'Anschluss ' + byKat[k].label, byKat[k].len, 'lfm'); });
    rows += zt('Anschlüsse', anschluesse.reduce((s, r) => s + r.lenM, 0), 'lfm');
  }
  return '<table style="width:100%;border-collapse:collapse">' + head + rows + '</table>';
}
// Ausschreibungs-Kopf (in Submit Paper editierbar): Bauvorhaben · Datum · Bauherr · Massstab · Unternehmer
function belagTenderHeader(bauvorhaben, datum, massstab) {
  return '<table style="width:100%;border-collapse:collapse;margin:0 0 10px;border:none">'
    + '<tr><td style="border:none;padding:2px 0"><b>Bauvorhaben:</b> ' + _htmlEsc(bauvorhaben || '') + '</td><td style="border:none;padding:2px 0;text-align:right"><b>Datum:</b> ' + _htmlEsc(datum || '') + '</td></tr>'
    + '<tr><td style="border:none;padding:2px 0"><b>Bauherr:</b> _______________________</td><td style="border:none;padding:2px 0;text-align:right"><b>Massstab:</b> ' + _htmlEsc(massstab || '–') + '</td></tr>'
    + '<tr><td style="border:none;padding:2px 0" colspan="2"><b>Unternehmer / Firma:</b> _________________________________________</td></tr>'
    + '</table>';
}
// Abschluss-Block einer Ausschreibung (leere Linien für den Unternehmer): Total exkl. · MwSt · Total inkl.
function belagTenderFooter() {
  const line = 'border:none;padding:3px 0;border-bottom:1px solid #999';
  return '<table style="width:100%;border-collapse:collapse;margin-top:10px;border:none">'
    + '<tr><td style="border:none;padding:3px 0;text-align:right;width:70%"><b>Total exkl. MwSt (CHF):</b></td><td style="' + line + '">&nbsp;</td></tr>'
    + '<tr><td style="border:none;padding:3px 0;text-align:right">MwSt 8,1 % (CHF):</td><td style="' + line + '">&nbsp;</td></tr>'
    + '<tr><td style="border:none;padding:3px 0;text-align:right"><b>Total inkl. MwSt (CHF):</b></td><td style="border:none;padding:3px 0;border-bottom:2px solid #333">&nbsp;</td></tr>'
    + '</table>';
}
// Beläge als Ausschreibung (mit leerer Preisspalte) oder Mengenauszug nach Submit Paper übergeben
function exportBelagToPaper(mode) {
  if (!docScale) { toast('Zuerst den Massstab (1:n) setzen – unten in der Fusszeile.'); return; }
  const { floors, walls, anschluesse } = belagData();
  if (!floors.length && !walls.length && !anschluesse.length) { toast('Noch keine Beläge zum Exportieren.'); return; }
  const price = mode === 'ausschreibung';
  let datum = ''; try { datum = new Date().toLocaleDateString('de-CH'); } catch (_) { }
  const html = '<h1>' + (price ? 'Ausschreibung' : 'Mengenauszug') + '</h1>'
    + belagTenderHeader((docName || '').replace(/\.pdf$/i, ''), datum, docScale.label || '–')
    + buildBelagTableHtml(floors, walls, price, anschluesse)
    + (price ? belagTenderFooter() + '<p style="color:#777;font-size:12px">Einheitspreise bitte durch den Unternehmer eintragen.</p>' : '');
  const titel = (docName || 'Ausmass').replace(/\.pdf$/i, '') + (price ? ' – Ausschreibung' : ' – Mengenauszug');
  try { localStorage.setItem('submitpaper_import', JSON.stringify({ titel, pages: [{ typ: 'write', html }], ts: Date.now() })); }
  catch (_) { toast('Export zu gross.'); return; }
  toast('Öffne in Submit Paper …'); location.href = '../write/index.html?import=1';
}
function geoToLocal(gj) {   // GeoJSON (lon/lat) → lokale Meter (äquirektangulär um den Schwerpunkt), Nord = oben
  const feats = gj && gj.type === 'FeatureCollection' ? (gj.features || []) : gj && gj.type === 'Feature' ? [gj] : gj && gj.type ? [{ geometry: gj }] : [];
  const rings = [], collect = geom => {
    if (!geom) return; const t = geom.type, c = geom.coordinates;
    if (t === 'Polygon') for (const r of c) rings.push({ kind: 'poly', coords: r });
    else if (t === 'MultiPolygon') for (const p of c) for (const r of p) rings.push({ kind: 'poly', coords: r });
    else if (t === 'LineString') rings.push({ kind: 'line', coords: c });
    else if (t === 'MultiLineString') for (const l of c) rings.push({ kind: 'line', coords: l });
    else if (t === 'Point') rings.push({ kind: 'point', coords: [c] });
    else if (t === 'MultiPoint') for (const p of c) rings.push({ kind: 'point', coords: [p] });
    else if (t === 'GeometryCollection') for (const g of (geom.geometries || [])) collect(g);
  };
  for (const f of feats) collect(f.geometry || f);
  let sLon = 0, sLat = 0, cnt = 0; for (const r of rings) for (const p of r.coords) { sLon += p[0]; sLat += p[1]; cnt++; }
  if (!cnt) return { shapes: [], bbox: null };
  const lon0 = sLon / cnt, lat0 = sLat / cnt, k = Math.cos(lat0 * Math.PI / 180), shapes = [];
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const r of rings) { const mpts = r.coords.map(p => { const mx = (p[0] - lon0) * 111320 * k, my = -(p[1] - lat0) * 110574; if (mx < minx) minx = mx; if (mx > maxx) maxx = mx; if (my < miny) miny = my; if (my > maxy) maxy = my; return [mx, my]; }); shapes.push({ kind: r.kind, mpts }); }
  return { shapes, bbox: { minx, miny, maxx, maxy }, lon0, lat0 };
}
async function importGeoJSON(file) {
  if (!docScale) { toast('Erst Massstab setzen (1:n) – GIS-Daten brauchen reale Masse.'); return; }
  let gj; try { gj = JSON.parse(await file.text()); } catch (_) { toast('Keine gültige GeoJSON-Datei.'); return; }
  const loc = geoToLocal(gj); if (!loc.shapes.length) { toast('Keine Geometrie in der GeoJSON gefunden.'); return; }
  const n = curPage(), pv = pageViews.find(p => p.num === n); if (!pv) { toast('Keine Seite offen.'); return; }
  const gcx = (loc.bbox.minx + loc.bbox.maxx) / 2, gcy = (loc.bbox.miny + loc.bbox.maxy) / 2, pcx = (pv.pageW || 595) / 2, pcy = (pv.pageH || 842) / 2;
  const toPt = (mx, my) => [pcx + cmToPts((mx - gcx) * 100), pcy + cmToPts((my - gcy) * 100)];
  pushUndo();
  const prev = activeLayerId, id = newLayerId(); layers.push({ id, name: 'Gelände/GIS', visible: true });
  const arr = getAnnos(n); let added = 0;
  for (const s of loc.shapes) {
    const pts = s.mpts.map(p => toPt(p[0], p[1]));
    if (s.kind === 'poly' && pts.length >= 3) arr.push({ id: nextId++, type: 'area', pts, color: '#7a5c3c', width: 1.4, room: false, layer: id });
    else if (s.kind === 'line' && pts.length >= 2) arr.push({ id: nextId++, type: 'pen', pts, color: '#7a5c3c', width: 1.4, layer: id });
    else if (s.kind === 'point') { const q = pts[0]; arr.push({ id: nextId++, type: 'oval', x: q[0] - 3, y: q[1] - 3, w: 6, h: 6, color: '#7a5c3c', fill: '#7a5c3c', width: 1.2, layer: id }); }
    else continue; added++;
  }
  activeLayerId = prev;   // weiter auf der vorherigen Ebene zeichnen
  drawAnnos(pv); buildThumbs(); renderLayerPanel(); saveState(); toast(added + ' GIS-Objekt(e) als massstäbliches Gelände importiert (Ebene „Gelände/GIS").');
}
function importGISFile() { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.geojson,.json'; inp.onchange = () => { const f = inp.files && inp.files[0]; if (f) importGeoJSON(f); }; inp.click(); }
const LAMBDA = { putz: 0.70, gips: 0.25, mauerwerk: 0.50, beton: 2.10, eps: 0.035, daemm_eps: 0.035, daemm_xps: 0.035, glaswolle: 0.035, daemm_wolle: 0.035, daemm_holz: 0.045, holz: 0.13, konter: 0.13 };   // Wärmeleitfähigkeit λ (W/mK)
function wallUValue(layers, override) {   // U-Wert [W/m²K] = 1 / (Rsi + Σ d/λ + Rse); Luft = R 0.15
  if (override != null && override > 0) return override;
  let R = 0.13 + 0.04;
  for (const l of layers) { const d = ptsToCm(l.t) / 100; if (l.mat === 'luft') R += 0.15; else R += d / (LAMBDA[l.mat] || 1.0); }
  return R > 0 ? 1 / R : 0;
}
function computeWallBuildups(arr) {   // eindeutige Wandaufbauten gruppieren
  const groups = {};
  for (const w of arr) {
    if (w.type !== 'wall' || !w.layers || !w.layers.length || !layerVisible(w) || !phaseVisible(w)) continue;
    const sig = w.layers.map(l => l.mat + ':' + Math.round(ptsToCm(l.t) * 10)).join('|');
    if (!groups[sig]) groups[sig] = { sig, layers: w.layers, walls: [], totalCm: w.layers.reduce((s, l) => s + ptsToCm(l.t), 0), uVal: null };
    groups[sig].walls.push(w); if (w.uVal != null) groups[sig].uVal = w.uVal;
  }
  return Object.values(groups).sort((a, b) => b.totalCm - a.totalCm);
}
function buildupThumb(layers, totalCm) {   // Mini-Schichtbild (von innen links → aussen rechts)
  const W = 120, H = 30; let x = 0, s = '<svg class="bu-thumb" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '">';
  for (const l of layers) { const w = Math.max(1.5, (ptsToCm(l.t) / (totalCm || 1)) * W), m = WALL_MATS[l.mat] || {}; s += '<rect x="' + x.toFixed(1) + '" y="0" width="' + w.toFixed(1) + '" height="' + H + '" fill="' + (m.fill || '#eee') + '" stroke="' + (m.color || '#999') + '" stroke-width="0.6"/>'; x += w; }
  return s + '<text x="2" y="' + (H - 3) + '" font-size="7" fill="#555">innen</text><text x="' + (W - 2) + '" y="' + (H - 3) + '" font-size="7" fill="#555" text-anchor="end">aussen</text></svg>';
}
function fillWallList(bodyEl) {   // Wandaufbau/U-Werte in das Listen-Panel
  const n = curPage(), arr = getAnnos(n), groups = computeWallBuildups(arr);
  const desc = layers => layers.map(l => ((WALL_MATS[l.mat] && WALL_MATS[l.mat].label) || l.mat).replace(/ .*/, '') + ' ' + (Math.round(ptsToCm(l.t) * 10) / 10) + 'cm').join(' · ');
  let cards = '', csv = 'Aufbau (innen→aussen)\tDicke (cm)\tU-Wert (W/m²K)\tAnzahl\n';
  groups.forEach((g, i) => { const u = wallUValue(g.layers, g.uVal), us = (Math.round(u * 1000) / 1000).toFixed(3), comp = g.uVal != null, uc = u < 0.2 ? 'uval-good' : u < 0.35 ? 'uval-mid' : 'uval-poor';
    cards += '<div class="wb-card"><div class="wb-top"><b>W' + (i + 1) + '</b><span class="wb-dim">' + (Math.round(g.totalCm * 10) / 10).toString().replace('.', ',') + ' cm</span><span class="grow"></span><span class="wb-cnt">' + g.walls.length + '×</span></div><div class="wb-thumb">' + buildupThumb(g.layers, g.totalCm) + '</div><div class="wb-desc">' + desc(g.layers) + '</div><div class="wb-u"><span>U-Wert</span><input class="bu-u ' + uc + '" data-sig="' + g.sig.replace(/"/g, '') + '" type="number" step="0.01" min="0.05" value="' + us + '"><span class="wb-uu">W/m²K</span>' + (comp ? '<span class="wb-edit" title="manuell überschrieben">✎</span>' : '') + '</div></div>';
    csv += desc(g.layers) + '\t' + (Math.round(g.totalCm * 10) / 10) + '\t' + us + '\t' + g.walls.length + '\n'; });
  bodyEl.innerHTML = '<h4>Seite ' + n + ' · U-Wert editierbar (✎ = überschrieben)</h4>' + (cards || '<p class="lp2-empty">Keine mehrschichtigen Wände auf dieser Seite.</p>');
  bodyEl.querySelectorAll('.bu-u').forEach(inp => inp.onchange = () => { const v = parseFloat(inp.value); if (!(v > 0)) return; const g = groups.find(x => x.sig.replace(/"/g, '') === inp.dataset.sig); if (!g) return; pushUndo(); g.uVal = v; g.walls.forEach(w => w.uVal = v); saveState(); toast('U-Wert ' + v + ' gespeichert (für ' + g.walls.length + ' Wand/Wände)'); });
  return () => navigator.clipboard.writeText('WANDAUFBAUTEN\n' + csv).then(() => toast('Liste kopiert (Excel-tauglich)')).catch(() => toast('Kopieren nicht möglich'));
}
function openWallList() { openListPanel('walls'); }
function selfTest() {   // prüft die Kern-Rechenpfade (kein DOM nötig); fängt Regressionen
  const R = [], A = (name, fn) => { try { const m = fn(); R.push({ name, ok: m === '' || m === true || m == null, msg: typeof m === 'string' ? m : '' }); } catch (e) { R.push({ name, ok: false, msg: (e && e.message) || 'Fehler' }); } };   // Pass = '' / true / nichts; non-leerer String od. false = Fehler
  const saved = docScale; docScale = { perPt: 50 * PT2MM / 1000, label: '1:50', n: 50 };
  try {
    A('cm↔pt Round-Trip', () => Math.abs(ptsToCm(cmToPts(123.4)) - 123.4) < 0.01);
    A('fmtLen liefert Text', () => { const s = fmtLen(cmToPts(200)); return typeof s === 'string' && s.length > 0; });
    const wall = { id: 9001, type: 'wall', x1: 100, y1: 100, x2: 400, y2: 100, thick: cmToPts(40), h3d: 2.6, layers: [{ mat: 'putz', t: cmToPts(1.5) }, { mat: 'mauerwerk', t: cmToPts(15) }, { mat: 'eps', t: cmToPts(22) }, { mat: 'putz', t: cmToPts(2) }] };
    const win = { id: 9002, type: 'opening', kind: 'window', wallId: 9001, x: 250, y: 100, ang: 0, thick: wall.thick, w: cmToPts(100), depth: 0.5, winType: 'f1', winMat: 'holz', sill: 0.9, head: 2.1, frameW: cmToPts(10), frameD: cmToPts(7) };
    const arr = [wall, win];
    A('openInsPts > 0', () => openInsPts(win) > 0);
    A('U-Wert plausibel (0.1–0.4)', () => { const u = wallUValue(wall.layers); return (u > 0.1 && u < 0.4) ? '' : 'U=' + u.toFixed(3); });
    A('openingParts: Fenster-Profil', () => { const p = openingParts(win, true); return (p.fills && p.fills.length > 0) || (p.lines && p.lines.length > 0); });
    A('openingRevealStrips: Schichteinzug', () => { const s = openingRevealStrips(win, arr); return s && s.length > 0 ? '' : 'keine Strips'; });
    A('computeQuantities: Fläche', () => { const q = computeQuantities(arr); return q.mats.length > 0 && q.mats.some(m => m.area > 0); });
    A('Fensterliste: Skizze', () => { const s = winThumb(win); return typeof s === 'string' && s.indexOf('<svg') === 0; });
    A('Wandaufbau-Gruppe', () => computeWallBuildups(arr).length === 1);
    A('Raumbuch: Fläche (~30 m²)', () => { const m2 = polyArea([[0, 0], [cmToPts(600), 0], [cmToPts(600), cmToPts(500)], [0, cmToPts(500)]]) * docScale.perPt * docScale.perPt; return Math.abs(m2 - 30) < 0.5 ? '' : 'm²=' + m2.toFixed(2); });
    A('Annotation-Import (Square→rect)', () => { const a = convertAnnot({ subtype: 'Square', rect: [10, 10, 50, 50], color: [255, 0, 0] }, 200); return !!(a && a.type === 'rect'); });
    A('Massstabsbalken-Element', () => buildPlanParts(842, 595, { kind: 'mstab', margin: 8 }).length > 3);
    A('Öffnungs-Nummern (F1/F2)', () => { const g = openingGroups([wall, win, { id: 9004, type: 'opening', kind: 'window', wallId: 9001, w: cmToPts(80), head: 2.1, sill: 0.9, winType: 'f1', winMat: 'holz' }]); return (g.wins.length === 2 && g.posOf[9004] === 'F1' && g.posOf[9002] === 'F2') ? '' : JSON.stringify(g.posOf); });
    A('Mengen: Laibung', () => { const w2 = { id: 9101, type: 'wall', x1: 0, y1: 0, x2: cmToPts(300), y2: 0, thick: cmToPts(30), layers: [{ mat: 'putz', t: cmToPts(1.5) }, { mat: 'mauerwerk', t: cmToPts(15) }, { mat: 'eps', t: cmToPts(16) }] }; const o2 = { id: 9102, type: 'opening', kind: 'window', wallId: 9101, w: cmToPts(120), head: 2.1, sill: 0.9, frameD: cmToPts(7), revealLining: [{ mat: 'putz', t: 1.5 }], revealLiningOut: [{ mat: 'putz', t: 2.5 }] }; const q = computeQuantities([w2, o2]); const rev = q.extra.find(e => e.label && e.label.indexOf('Laibung') === 0); return (rev && rev.qty > 0) ? '' : 'rev=' + JSON.stringify(q.extra.map(e => e.label)); });
    A('Möbel-Symbol (Kleiderschrank)', () => blockShapes({ x: 0, y: 0, w: 140, h: 60, kind: 'wardrobe' }).length >= 3 && !!BLOCK_DEFS.kitchen && !!BLOCK_H.tallcab);
    A('Stütze (rund/eckig)', () => { const r = blockShapes({ x: 0, y: 0, w: 30, h: 30, kind: 'columnRound' }); return r.length === 1 && r[0].t === 'circ' && IS_COLUMN('column') && !IS_COLUMN('table'); });
    A('Unterzug (Bauteil)', () => { const b = { id: 9100, type: 'beam', x1: 0, y1: 0, x2: cmToPts(500), y2: 0, width: cmToPts(24), height: 0.4 }; const bb = bbox(b); return isLineType(b) && bb.w > 0 && computeQuantities([b]).extra.some(e => e.label === 'Unterzug'); });
    A('Sonnenstand (Sommer Mittag ~66°)', () => { const doy = dayOfYearOf(2025, 6, 21), s = solarPosition(47, doy, 12), n = solarPosition(47, doy, 0); return (doy === 172 && Math.abs(s.elDeg - 66.5) < 2 && Math.abs(s.azDeg - 180) < 6 && n.elDeg < 0) ? '' : 'doy=' + doy + ' el=' + s.elDeg.toFixed(1) + ' az=' + s.azDeg.toFixed(1); });
    A('GIS-Projektion (GeoJSON→m)', () => { const l = geoToLocal({ type: 'Polygon', coordinates: [[[8, 47], [8.001, 47], [8.001, 47.001], [8, 47.001], [8, 47]]] }), w = l.bbox.maxx - l.bbox.minx, h = l.bbox.maxy - l.bbox.miny; return (l.shapes.length === 1 && Math.abs(w - 75.9) < 3 && Math.abs(h - 110.6) < 3) ? '' : 'w=' + w.toFixed(1) + ' h=' + h.toFixed(1); });
    A('Schnitt-Linien zusammenfassen', () => { const m = mergeIfcSegments([[[0, 0], [1, 0]], [[0.9, 0], [2, 0]]]); return (m.length === 1 && Math.abs(m[0][1][0] - m[0][0][0]) > 1.9) ? '' : JSON.stringify(m); });
    A('Wand-Erkennung (2 Linien → Wand)', () => { const w = ifcPairWalls([[[0, 0], [3, 0]], [[0, 0.3], [3, 0.3]]]); return (w.length === 1 && Math.abs(w[0].thick - 0.3) < 0.01 && Math.abs(w[0].y1 - 0.15) < 0.01 && Math.abs(Math.hypot(w[0].x2 - w[0].x1, w[0].y2 - w[0].y1) - 3) < 0.01) ? '' : JSON.stringify(w); });
    A('IFC-Remap (Z→oben)', () => { const s = ifcUpAxis; ifcUpAxis = 'z'; const r = ifcRemap([1, 2, 3]); ifcUpAxis = s; return (r[0] === 1 && r[1] === 3 && r[2] === 2) ? '' : JSON.stringify(r); });
    A('IFC-Schnitt (Mesh→Segment)', () => { const s = ifcUpAxis; ifcUpAxis = 'y'; const seg = ifcSliceSegments([{ pos: [0, 0, 0, 0, 2, 0, 2, 2, 0], indices: [0, 1, 2], env: false }], 1); ifcUpAxis = s; return seg.length === 1 ? '' : JSON.stringify(seg); });
    A('IFC-Material-Mapping', () => (ifcMatKey('Beton C25/30') === 'beton' && ifcMatKey('Mineralwolle 035') === 'glaswolle' && ifcMatKey('Backstein 1.4') === 'mauerwerk' && ifcMatKey('Aussenputz') === 'putz') ? '' : 'Mapping falsch');
    A('Mesh3D encode/decode', () => { const pos = new Float32Array([0, 0, 0, 12, 0, 0, 0, 3, 7, 12, 3, 7]); const e = encodeMesh3d(pos, [0, 1, 2, 1, 3, 2]); const d = decodeMesh3d(e); let mx = 0; for (let i = 0; i < pos.length; i++) mx = Math.max(mx, Math.abs(d.pos[i] - pos[i])); return (mx < 0.01 && d.idx.length === 6 && d.idx[4] === 3) ? '' : 'Abw. ' + mx; });
    A('Profil-Querschnitt', () => { const r = profileArea([[0, 0], [3, 0], [3, 12], [0, 12]]), z = profilePreset('zblech'); return (Math.abs(r - 36) < 0.01 && z.length === 8 && profileArea(z) > 0) ? '' : 'r=' + r + ' z=' + z.length; });
    A('Profil-Länge', () => { const sv = docScale; docScale = { perPt: 0.01, label: '1:50', n: 50 }; const len = profilePathLenM([[0, 0], [100, 0], [100, 100]]); docScale = sv; return Math.abs(len - 2) < 0.001 ? '' : 'len=' + len; });
    A('Decken-Schichtaufbau', () => { const s = { type: 'slab', pts: [[0, 0], [100, 0], [100, 100], [0, 100]], base: 3 }; applySlabBuildup(s, [['belag', 1], ['estrich', 7], ['beton', 24]]); const b = slabLayerBands(s); return (s.layers.length === 3 && Math.abs(s.thick - 0.32) < 1e-6 && b[0].mat === 'belag' && Math.abs(b[0].y1 - 0.32) < 1e-6 && Math.abs(b[2].y0) < 1e-6) ? '' : 'thick=' + s.thick; });
    const sec = { id: 9003, type: 'section', cx1: 250, cy1: 0, cx2: 250, cy2: 300, ox: 500, oy: 600, label: 'A' };
    A('Live-Schnitt: Primitives', () => { const pr = sectionPrimitives(sec, [wall, win, sec]); return pr && pr.length > 3 ? '' : 'zu wenig'; });
    A('Profil im Schnitt', () => { const prof = { id: 9004, type: 'profile', path: [[200, 150], [300, 150]], prof: [[0, 0], [3, 0], [3, 12], [0, 12]], elev: 2.5, closed: false }; const pr = sectionPrimitives(sec, [prof, sec]); return pr.some(p => p.t === 'poly') ? '' : 'kein Querschnitt'; });
    A('Decke im Schnitt (Schichten)', () => { const sl = { id: 9005, type: 'slab', pts: [[180, 100], [320, 100], [320, 200], [180, 200]], base: 2.6 }; applySlabBuildup(sl, [['belag', 1], ['estrich', 7, 1], ['beton', 24]]); const pr = sectionPrimitives(sec, [sl, sec]); return (pr.filter(p => p.t === 'rect').length >= 3 && Math.abs(sl.layers[1].inset - 0.01) < 1e-6) ? '' : 'Schichten/Einzug falsch'; });
    A('Schicht-Über/Unterlänge', () => { const w = { type: 'wall', x1: 0, y1: 0, x2: 100, y2: 0, thick: cmToPts(31) }; applyWallBuildup(w, [['mauerwerk', 15, '', 0, 30], ['eps', 16, '', 20, 0]]); return (Math.abs(w.layers[1].top - 0.2) < 1e-6 && Math.abs(w.layers[0].bot - 0.3) < 1e-6 && !w.layers[0].top) ? '' : 'top=' + w.layers[1].top + ' bot=' + w.layers[0].bot; });
    A('Sockelzone (Material-Split)', () => { const w = { type: 'wall', x1: 0, y1: 0, x2: 100, y2: 0, thick: cmToPts(31) }; applyWallBuildup(w, [['mauerwerk', 15, '', 0, 0, '', 0], ['glaswolle', 16, '', 0, 0, 'xps', 50]]); return (w.layers[1].lowMat === 'xps' && Math.abs(w.layers[1].lowH - 0.5) < 1e-6 && !w.layers[0].lowMat) ? '' : 'lowMat=' + w.layers[1].lowMat + ' lowH=' + w.layers[1].lowH; });
    A('Schicht-Eigenlänge (Wand)', () => { const mk = () => ({ type: 'wall', x1: 0, y1: 0, x2: cmToPts(500), y2: 0, thick: cmToPts(30) }); const w1 = mk(); applyWallBuildup(w1, [['mauerwerk', 15], ['eps', 15]]); const w2 = mk(); applyWallBuildup(w2, [['mauerwerk', 15], ['eps', 15]]); w2.layers[1].ext2 = 20; const a1 = Math.max(...wallLayerBands(w1, [w1]).bands[1].poly.map(p => p[0])), a2 = Math.max(...wallLayerBands(w2, [w2]).bands[1].poly.map(p => p[0])); return Math.abs((a2 - a1) - 20) < 0.01 ? '' : 'd=' + (a2 - a1); });
    A('Holz-Latten (Schalung)', () => { const q = bandBoards({ poly: [[0, 0], [100, 0], [100, 10], [0, 10]] }, 10, 10); return (q.length === 5 && Math.abs(q[0][1][0] - 10) < 0.01 && !!WALL_MATS.schalung.boards && !!WALL_MATS.windpapier.membrane) ? '' : 'n=' + q.length; });
    A('IFC-Höhenschnitt (Mesh-Slice)', () => { const P = [0, 0, 0, 100, 0, 0, 100, 0, 100, 0, 0, 100, 0, 100, 0, 100, 100, 0, 100, 100, 100, 0, 100, 100], I = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7, 0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2]; const enc = encodeMesh3d(P, I); const segs = sliceMesh3d({ type: 'mesh3d', enc, x: 0, y: 0 }, 50); if (segs.length < 4) return 'zu wenig Segmente: ' + segs.length; return segs.every(s => s.every(v => v >= -2 && v <= 102)) ? '' : 'Segment ausserhalb der Bbox'; });
    A('openingSpec (kanonisch)', () => { const sp = openingSpec({ kind: 'window', w: cmToPts(120), sashW: cmToPts(7), sashShift: cmToPts(4), boardVis: 1.5 }); return (Math.abs(ptsToCm(sp.sashVis) - 3) < 0.02 && Math.abs(ptsToCm(sp.frameVis) - 1.5) < 0.02) ? '' : 'sashVis=' + ptsToCm(sp.sashVis) + ' frameVis=' + ptsToCm(sp.frameVis); });
    A('Solid: Wand-Schichten', () => { const w = { type: 'wall', x1: 0, y1: 0, x2: cmToPts(400), y2: 0, thick: cmToPts(30), h3d: 2.6 }; applyWallBuildup(w, [['putz', 2], ['mauerwerk', 18], ['eps', 10]]); const sol = elementSolids(w, [w]); return (sol.length === 3 && sol.every(s => s.poly.length === 4 && s.z1 > s.z0)) ? '' : 'n=' + sol.length; });
    A('slicePlane horizontal (Grundriss)', () => { const w = { type: 'wall', x1: 0, y1: 0, x2: cmToPts(400), y2: 0, thick: cmToPts(30), h3d: 2.6 }; applyWallBuildup(w, [['putz', 2], ['mauerwerk', 18], ['eps', 10]]); const cut = slicePlane(elementSolids(w, [w]), { kind: 'h', z: 1.0 }); return (cut.length === 3 && slicePlane(elementSolids(w, [w]), { kind: 'h', z: 9 }).length === 0) ? '' : 'n=' + cut.length; });
    A('slicePlane vertikal (Schnitt)', () => { const w = { type: 'wall', x1: 0, y1: cmToPts(200), x2: cmToPts(400), y2: cmToPts(200), thick: cmToPts(30), h3d: 2.6 }; applyWallBuildup(w, [['putz', 2], ['mauerwerk', 18], ['eps', 10]]); const cut = slicePlane(elementSolids(w, [w]), { kind: 'v', p1: [cmToPts(200), 0], p2: [cmToPts(200), cmToPts(400)] }); const tot = cut.reduce((s, c) => s + (c.d1 - c.d0), 0); return (cut.length === 3 && cut.every(c => c.d1 > c.d0) && Math.abs(tot - cmToPts(30)) < 1) ? '' : 'n=' + cut.length + ' tot=' + tot; });
    A('openingSolids (Fenster-Profil)', () => { const f2 = openingSolids({ kind: 'window', winType: 'f2', w: cmToPts(120), sill: 0.9, head: 2.2, frameW: cmToPts(10), sashW: cmToPts(7), boardVis: 1.5, winMat: 'holz' }); const f1 = openingSolids({ kind: 'window', winType: 'f1', w: cmToPts(120), sill: 0.9, head: 2.2, frameW: cmToPts(10), sashW: cmToPts(7), boardVis: 1.5, winMat: 'holz' }); const g2 = f2.filter(p => p.role === 'glass').length, m2 = f2.filter(p => p.role === 'mullion').length, g1 = f1.filter(p => p.role === 'glass').length; return (g2 === 2 && m2 === 1 && g1 === 1 && f2.every(p => p.mHi > p.mLo)) ? '' : 'g2=' + g2 + ' m2=' + m2 + ' g1=' + g1; });
    A('sliceOpeningV (Schnitt durch Öffnung)', () => { const o = { kind: 'window', winType: 'f2', w: cmToPts(120), sill: 0.9, head: 2.2, frameW: cmToPts(10), sashW: cmToPts(7), boardVis: 1.5, depth: 0.5, thick: cmToPts(35), winMat: 'holz' }; const mid = sliceOpeningV(o, 0), pane = sliceOpeningV(o, cmToPts(30)); const midGlass = mid.some(r => r.role === 'glass'), paneGlass = pane.some(r => r.role === 'glass'); return (!midGlass && paneGlass && mid.length > 0 && mid.every(r => r.m1 > r.m0 && r.z1 > r.z0)) ? '' : 'midGlass=' + midGlass + ' paneGlass=' + paneGlass; });
    A('openingSolids Fensterbank', () => { const wb = openingSolids({ kind: 'window', winType: 'f1', w: cmToPts(120), sill: 0.9, head: 2.2, frameW: cmToPts(10), sashW: cmToPts(7), boardVis: 1.5, thick: cmToPts(35), bank: true, bankMat: 'metall', winMat: 'holz' }); const nb = openingSolids({ kind: 'window', winType: 'f1', w: cmToPts(120), sill: 0.9, head: 2.2, frameW: cmToPts(10), bank: false, thick: cmToPts(35), winMat: 'holz' }); return (wb.some(p => p.role === 'bank') && !nb.some(p => p.role === 'bank') && openingPartStyle('bank', { bankMat: 'metall' }).fill === '#cfd3d8') ? '' : 'bank fehlt/falsch'; });
    // --- PDF→Paper Konvertierung (reine Logik): Zahlen-Parser, Rechen-Check, Total-Erkennung ---
    A('parseNum Schweizer Format', () => (_parseNum("4'269.75") === 4269.75 && _parseNum('4’269.75') === 4269.75) ? '' : 'got ' + _parseNum("4'269.75"));
    A('parseNum deutsches Format', () => (_parseNum('1.234,55') === 1234.55 && _parseNum('1234,55') === 1234.55) ? '' : 'got ' + _parseNum('1.234,55'));
    A('parseNum einfach', () => (_parseNum('183.00') === 183 && _parseNum('3.00') === 3) ? '' : 'fail');
    A('isNumCell erkennt Zahl/Einheit', () => (_isNumCell("1'200.00") && _isNumCell('50%') && !_isNumCell('Stk.') && !_isNumCell('Legrabox')) ? '' : 'fail');
    A('checkCalc korrekt (3×12.5=37.5)', () => { const c = _checkCalc([{ v: 3, str: '3', k: 1 }, { v: 12.5, str: '12.50', k: 2 }, { v: 37.5, str: '37.50', k: 3 }]); return (c && c.ok) ? '' : 'nicht ok: ' + JSON.stringify(c); });
    A('checkCalc Fehler (3×12.5=37.0)', () => { const c = _checkCalc([{ v: 3, str: '3', k: 1 }, { v: 12.5, str: '12.50', k: 2 }, { v: 37.0, str: '37.00', k: 3 }]); return (c && !c.ok && c.expected === 37.5) ? '' : 'erwartet Fehler+37.5: ' + JSON.stringify(c); });
    A('fmtNum Schweizer Tausender', () => (_fmtNum(4269.75) === '4’269.75' && _fmtNum(1000) === '1’000.00') ? '' : 'got ' + _fmtNum(4269.75));
    A('isTotalDesc erkennt Total/MwSt', () => (_isTotalDesc('Total Möbel') && _isTotalDesc('MwSt 8,1%') && _isTotalDesc('Zwischentotal') && !_isTotalDesc('Legrabox seidenweiss')) ? '' : 'fail');
    A('isTotalDesc: Bau-Positionen sind KEINE Summenzeile', () => (!_isTotalDesc('Gesamtfläche Fassade') && !_isTotalDesc('Bruttogeschossfläche') && !_isTotalDesc('Nettowohnfläche') && _isTotalDesc('Gesamt') && _isTotalDesc('Netto CHF') && _isTotalDesc('Gesamttotal') && _isTotalDesc('Gesamtbetrag')) ? '' : 'fail');
    A('isListLine erkennt Aufzählung', () => (_isListLine('- Punkt') && _isListLine('1. Punkt') && _isListLine('• Punkt') && !_isListLine('Normaler Text')) ? '' : 'fail');
    A('blockToParaHtml stapelt kurze Zeilen (<br>)', () => { const b = { x: 0, size: 10, lh: 12, right: 40, lines: [{ str: 'Zeile A', x: 0, maxx: 40 }, { str: 'Zeile B', x: 0, maxx: 40 }] }; const h = blockToParaHtml(b, 10, 500); return /Zeile A<br>Zeile B/.test(h) ? '' : h; });
    A('blockToParaHtml führt Fliesstext zusammen (Leerzeichen)', () => { const b = { x: 0, size: 10, lh: 12, right: 498, lines: [{ str: 'lange Zeile bis Rand', x: 0, maxx: 498 }, { str: 'weiter', x: 0, maxx: 40 }] }; const h = blockToParaHtml(b, 10, 500); return /Rand weiter/.test(h) ? '' : h; });
    A('blockToParaHtml Überschrift bei grosser Einzelzeile', () => { const b = { x: 0, size: 20, lh: 24, right: 60, lines: [{ str: 'Titel', x: 0, maxx: 60 }] }; return /<h2/.test(blockToParaHtml(b, 10, 500)) ? '' : 'kein h2'; });
    A('tableHtml Rechenfehler → rot markiert', () => { const lines = [{ items: [{ x: 0, y: 0, w: 60, size: 10, str: 'Pos' }, { x: 100, y: 0, w: 12, size: 10, str: '3' }, { x: 150, y: 0, w: 20, size: 10, str: '12.50' }, { x: 200, y: 0, w: 24, size: 10, str: '37.00' }] }]; const html = tableHtml(lines, 0, 0, [90, 140, 190], 10); return (/background:#ffd6d6/.test(html) && /37[’']?\.50/.test(html) && /<s>37\.00<\/s>/.test(html)) ? '' : html; });
    A('tableHtml vereinheitlicht Geld-Spalte (183 → 183.00)', () => {
      const mk = (d, a) => ({ items: [{ x: 0, y: 0, w: 40, size: 10, str: d }, { x: 200, y: 0, w: 30, size: 10, str: a }] });
      const lines = [mk('A', '1234.5'), mk('B', '183'), mk('C', '250.00'), mk('D', '99.50'), mk('E', '12.00')];
      const html = tableHtml(lines, 0, 4, [190], 10);
      return (/1[’']234\.50/.test(html) && />183\.00</.test(html) && />250\.00</.test(html)) ? '' : html;
    });
    A('_calcErrorBanner zählt Rechenfehler', () => { const b = _calcErrorBanner(['<td style="background:#ffd6d6">x</td>', 'ok', '<span style="background:#ffd6d6"></span>']); return (/2 mögliche/.test(b) && /Rechenfehler/.test(b)) ? '' : b; });
    A('_calcErrorBanner leer ohne Fehler', () => _calcErrorBanner(['<p>ok</p>', 'nix']) === '' ? '' : 'nicht leer');
    A('wallFaceAreaM2 = Länge×Höhe', () => Math.abs(wallFaceAreaM2(1000, 0.005, 2.5) - 12.5) < 1e-6 ? '' : 'fail');   // 1000pt×0.005=5m, ×2.5m = 12.5m²
    A('tilePlan 3×2m / 60×60 / Fuge 3mm → 5×4=20', () => { const p = tilePlan(3, 2, 60, 60, 3); return (p.cols === 5 && p.rows === 4 && p.count === 20 && Math.abs(p.unitM2 - 0.36) < 1e-9) ? '' : JSON.stringify(p); });
    A('tilePlan exakt aufgehend 2.4m / 60cm ohne Fuge → 4', () => { const p = tilePlan(2.4, 0.6, 60, 60, 0); return (p.cols === 4 && p.rows === 1) ? '' : JSON.stringify(p); });
    A('tilesForArea inkl. 10% Verschnitt', () => tilesForArea(10, 60, 60, 10) === Math.ceil((10 / 0.36) * 1.1) ? '' : 'fail');
    A('DEFAULT_BELAG Standard 60×60 / 3mm / 8%', () => (DEFAULT_BELAG.tileW === 60 && DEFAULT_BELAG.tileH === 60 && DEFAULT_BELAG.joint === 3 && DEFAULT_BELAG.waste === 8) ? '' : 'fail');
    A('tileStartPoint Ecken + Mitte', () => { const tl = tileStartPoint(0, 0, 100, 80, 'tl', 10, 10), tr = tileStartPoint(0, 0, 100, 80, 'tr', 10, 10), br = tileStartPoint(0, 0, 100, 80, 'br', 10, 10), ce = tileStartPoint(0, 0, 100, 80, 'center', 10, 10); return (tl[0] === 0 && tl[1] === 0 && tr[0] === 100 && tr[1] === 0 && br[0] === 100 && br[1] === 80 && ce[0] === 45 && ce[1] === 35) ? '' : 'fail'; });
    A('makeOpening: Fenster mittig auf der Wand', () => { const o = makeOpening({ id: 5, x1: 0, y1: 0, x2: 100, y2: 0, thick: 10 }, 'window'); return (o.type === 'opening' && o.wallId === 5 && o.t === 0.5 && o.x === 50 && o.kind === 'window' && o.sill === 0.9) ? '' : JSON.stringify(o); });
    A('Ausschreibungs-Abschluss: MwSt + Total inkl.', () => { const h = belagTenderFooter(); return (/Total exkl\. MwSt/.test(h) && /MwSt 8,1 %/.test(h) && /Total inkl\. MwSt/.test(h)) ? '' : 'fail'; });
    A('Ausschreibungs-Kopf: Bauvorhaben/Datum/Massstab + Escaping', () => { const h = belagTenderHeader('Haus <A>', '05.07.2026', '1:50'); return (/Bauvorhaben:/.test(h) && /Haus &lt;A&gt;/.test(h) && /05\.07\.2026/.test(h) && /1:50/.test(h) && /Unternehmer/.test(h)) ? '' : 'fail'; });
    A('Belag-Ausschreibung: Preisspalten nur im Ausschreibungs-Modus + Pos/Menge', () => { const floors = [{ name: 'Wohnen', m2: 24.5, b: { tileW: 60, tileH: 60 }, aufbau: 'OK FB' }]; const aus = buildBelagTableHtml(floors, [], true), men = buildBelagTableHtml(floors, [], false); return (/Einheitspreis/.test(aus) && /Betrag/.test(aus) && !/Einheitspreis/.test(men) && /Bodenbeläge/.test(aus) && /1\.1/.test(aus) && /24,50/.test(aus)) ? '' : 'fail'; });
    A('belagData sammelt Boden + Wand mit m²', () => { const sa = annos, sd = docScale; try { docScale = { perPt: 0.01, label: 't' }; annos = { 1: [{ type: 'area', belag: { tileW: 60, tileH: 60, joint: 3, waste: 8 }, pts: [[0, 0], [100, 0], [100, 100], [0, 100]] }, { type: 'measure', wallface: true, height: 2.5, belag: { tileW: 60, tileH: 60, waste: 8 }, x1: 0, y1: 0, x2: 100, y2: 0 }] }; const d = belagData(); return (d.floors.length === 1 && Math.abs(d.floors[0].m2 - 1) < 1e-6 && d.walls.length === 1 && Math.abs(d.walls[0].m2 - 2.5) < 1e-6) ? '' : JSON.stringify({ f: d.floors.length, w: d.walls.length, fm: d.floors[0] && d.floors[0].m2, wm: d.walls[0] && d.walls[0].m2 }); } finally { annos = sa; docScale = sd; } });
    A('Aussparung: Netto = Brutto − Aussparung', () => { const sa = annos, sd = docScale; try { docScale = { perPt: 0.01, label: 't' }; annos = { 1: [{ type: 'area', belag: { tileW: 60, tileH: 60, waste: 0 }, pts: [[0, 0], [200, 0], [200, 100], [0, 100]] }, { type: 'area', cutout: 'Schrank', pts: [[10, 10], [60, 10], [60, 60], [10, 60]] }] }; const d = belagData(); const f = d.floors[0]; return (Math.abs(f.grossM2 - 2) < 1e-6 && Math.abs(f.cutM2 - 0.25) < 1e-6 && Math.abs(f.m2 - 1.75) < 1e-6 && d.cutouts.length === 1) ? '' : JSON.stringify({ g: f.grossM2, c: f.cutM2, n: f.m2 }); } finally { annos = sa; docScale = sd; } });
    A('Wandbelag: Fenster → Netto-Fläche + Anschluss Fenster', () => { const sa = annos, sd = docScale; try { docScale = { perPt: 0.01, label: 't' }; annos = { 1: [{ type: 'measure', wallface: true, height: 2.5, x1: 0, y1: 0, x2: 400, y2: 0, ans: { boden: false, decke: false, wand: 0 }, fenster: [{ w: 1, h: 1, sill: 0.9 }] }] }; const d = belagData(); const w = d.walls[0], f = d.anschluesse.find(x => x.kat === 'fenster'); return (Math.abs(w.grossM2 - 10) < 1e-6 && Math.abs(w.m2 - 9) < 1e-6 && f && Math.abs(f.lenM - 4) < 1e-6) ? '' : JSON.stringify({ g: w.grossM2, n: w.m2, f: f && f.lenM }); } finally { annos = sa; docScale = sd; } });
    A('Wandbelag erzeugt Anschlüsse (Boden/Decke=Länge, Wand=n×Höhe)', () => { const sa = annos, sd = docScale; try { docScale = { perPt: 0.01, label: 't' }; annos = { 1: [{ type: 'measure', wallface: true, height: 2.5, x1: 0, y1: 0, x2: 300, y2: 0, ans: { boden: true, decke: true, wand: 2 } }] }; const d = belagData(); const bk = {}; d.anschluesse.forEach(r => bk[r.kat] = (bk[r.kat] || 0) + r.lenM); return (Math.abs(bk.boden - 3) < 1e-6 && Math.abs(bk.decke - 3) < 1e-6 && Math.abs(bk.wand - 5) < 1e-6) ? '' : JSON.stringify(bk); } finally { annos = sa; docScale = sd; } });
    A('Anschluss als Polylinie (chaindim) → lfm', () => { const sa = annos, sd = docScale; try { docScale = { perPt: 0.01, label: 't' }; annos = { 1: [{ type: 'chaindim', anschluss: 'wand', pts: [[0, 0], [100, 0], [100, 100]] }] }; const d = belagData(); return (Math.abs(polylineLen([[0, 0], [100, 0], [100, 100]]) - 200) < 1e-6 && d.anschluesse.length === 1 && Math.abs(d.anschluesse[0].lenM - 2) < 1e-6 && d.anschluesse[0].kat === 'wand') ? '' : 'fail'; } finally { annos = sa; docScale = sd; } });
    A('belagData + Ausschreibung: Anschluss (lfm)', () => { const sa = annos, sd = docScale; try { docScale = { perPt: 0.01, label: 't' }; annos = { 1: [{ type: 'measure', anschluss: 'boden', x1: 0, y1: 0, x2: 300, y2: 0 }] }; const d = belagData(); const ok1 = d.anschluesse.length === 1 && Math.abs(d.anschluesse[0].lenM - 3) < 1e-6; const html = buildBelagTableHtml([], [], false, d.anschluesse); return (ok1 && /Anschlüsse/.test(html) && /Anschluss Boden/.test(html) && /lfm/.test(html) && /3,00/.test(html)) ? '' : 'fail'; } finally { annos = sa; docScale = sd; } });
  } finally { docScale = saved; }
  return { R, pass: R.filter(r => r.ok).length, fail: R.filter(r => !r.ok).length };
}
function showSelfTest() {
  const { R, pass, fail } = selfTest(), rows = R.map(r => '<tr><td>' + (r.ok ? '✅' : '❌') + '</td><td>' + r.name + '</td><td style="color:#b23">' + (r.msg || '') + '</td></tr>').join('');
  const ov = document.createElement('div'); ov.className = 'lab-overlay';
  ov.innerHTML = '<div class="lab-wrap" style="width:min(560px,94vw);height:auto;max-height:84vh"><div class="lab-head"><b>Selbsttest</b><span class="lab-hint">' + pass + ' OK · ' + fail + ' Fehler</span><span class="grow"></span><button class="btn" id="stClose">✕</button></div><div class="qty-body"><table class="qty-tab"><tbody>' + rows + '</tbody></table></div></div>';
  document.body.appendChild(ov); ov.querySelector('#stClose').onclick = () => ov.remove(); ov.addEventListener('pointerdown', e => { if (e.target === ov) ov.remove(); });
  console.log('[Submit PDF Selbsttest] ' + pass + ' OK, ' + fail + ' Fehler', R);
  return { pass, fail };
}
window.submitSelfTest = showSelfTest;
if (/[?&]selftest\b/i.test(location.search)) window.addEventListener('load', () => setTimeout(showSelfTest, 500));   // Aufruf: …/pdf/?selftest  oder Konsole: submitSelfTest()
function winThumb(o) {   // Mini-Ansicht (SVG) eines Fensters/einer Tür für die Liste
  const W = 64, H = 78, ww = ptsToCm(o.w) / 100, wh = o.kind === 'window' ? ((o.head || 2.1) - (o.sill || 0)) : (o.head || 2.0), ar = ww / Math.max(0.2, wh);
  let bw = W - 12, bh = bw / ar; if (bh > H - 10) { bh = H - 10; bw = bh * ar; } bw = Math.max(14, Math.min(W - 8, bw));
  const x0 = (W - bw) / 2, y0 = (H - bh) / 2, wm = WIN_MAT[o.winMat || 'holz'], wt = o.winType || 'f1', st = wm.stroke, F = v => v.toFixed(1);
  let s = '<svg class="ws-thumb" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '">';
  s += '<rect x="' + F(x0) + '" y="' + F(y0) + '" width="' + F(bw) + '" height="' + F(bh) + '" fill="' + wm.fill + '" stroke="' + st + '" stroke-width="1.3"/>';
  const fr = Math.min(bw, bh) * 0.12, two = wt === 'f2' || wt === 'f2s' || (o.kind === 'door' && wt === 'f1f'), np = two ? 2 : 1, pw = bw / np, hingeR = o.winHinge === 'right';
  for (let i = 0; i < np; i++) {
    const px = x0 + i * pw; if (i > 0) s += '<line x1="' + F(px) + '" y1="' + F(y0) + '" x2="' + F(px) + '" y2="' + F(y0 + bh) + '" stroke="' + st + '" stroke-width="1"/>';
    const ins = fr * 1.7, gx = px + ins, gy = y0 + ins, gw = pw - 2 * ins, gh = bh - 2 * ins; if (gw <= 1 || gh <= 1) continue;
    const isGlass = o.kind === 'window' ? true : (wt === 'fest' || (wt === 'f1f' && i === (hingeR ? 0 : 1)));
    s += '<rect x="' + F(gx) + '" y="' + F(gy) + '" width="' + F(gw) + '" height="' + F(gh) + '" fill="' + (isGlass ? '#c7e2f5' : wm.fill) + '" stroke="' + (isGlass ? '#7fa9c6' : st) + '" stroke-width="0.8"/>';
    if (wt !== 'fest' && !(o.kind === 'door' && isGlass)) { const apexL = two ? i !== 0 : hingeR, ax = apexL ? gx : gx + gw, bx = apexL ? gx + gw : gx, cy = gy + gh / 2; s += '<path d="M' + F(bx) + ' ' + F(gy) + ' L' + F(ax) + ' ' + F(cy) + ' L' + F(bx) + ' ' + F(gy + gh) + '" fill="none" stroke="' + st + '" stroke-width="0.7" stroke-dasharray="3 2"/>'; }   // Apex = Öffnungsseite
  }
  return s + '</svg>';
}
function openingGroups(arr) {   // Öffnungen nach identischem Typ gruppieren + Positionsnummern (F1…/T1…) – geteilt von Liste, Plan-Tag und PDF
  const groups = {};
  for (const o of arr) {
    if (o.type !== 'opening' || !layerVisible(o) || !phaseVisible(o)) continue;
    const oh = o.kind === 'window' ? ((o.head || 2.1) - (o.sill || 0)) : (o.head || 2.0);
    const key = [o.kind, o.winType || 'f1', o.winMat || 'holz', Math.round(ptsToCm(o.w)), Math.round(oh * 100), Math.round((o.sill || 0) * 100), o.winHinge || 'left'].join('|');
    if (!groups[key]) groups[key] = { o, oh, n: 0, members: [], pos: '' };
    groups[key].n++; groups[key].members.push(o);
  }
  const wins = [], doors = []; for (const k in groups) (groups[k].o.kind === 'window' ? wins : doors).push(groups[k]);
  wins.sort((a, b) => a.o.w - b.o.w || a.oh - b.oh); doors.sort((a, b) => a.o.w - b.o.w);
  const posOf = {};
  wins.forEach((g, i) => { g.pos = 'F' + (i + 1); for (const m of g.members) posOf[m.id] = g.pos; });
  doors.forEach((g, i) => { g.pos = 'T' + (i + 1); for (const m of g.members) posOf[m.id] = g.pos; });
  return { wins, doors, posOf };
}
function drawOpenPosTags(svg, pv) {   // Positionsbubble (Kreis + F1/T1) am Öffnungsrand
  const arr = getAnnos(pv.num), { posOf } = openingGroups(arr), r = 9;
  for (const o of arr) {
    if (o.type !== 'opening' || !layerVisible(o) || !phaseVisible(o)) continue; const p = posOf[o.id]; if (!p) continue;
    const ang = o.ang || 0, nx = -Math.sin(ang), ny = Math.cos(ang), off = (o.thick || wallThickPts()) / 2 + r + 5;
    const tx = o.x + nx * off, ty = o.y + ny * off;
    svg.appendChild(svgEl('circle', { cx: tx, cy: ty, r, fill: '#fff', stroke: '#1c242c', 'stroke-width': 1.2, 'vector-effect': 'non-scaling-stroke' }));
    const t = svgEl('text', { x: tx, y: ty, fill: '#1c242c', 'font-size': 11, 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-weight': 700 }); t.textContent = p; svg.appendChild(t);
  }
}
function fillScheduleList(bodyEl) {   // Fenster-/Türliste in das Listen-Panel (Position, Ansicht-Skizze, Material, Licht/Rohbau, Brüstung, Anschlag)
  const n = curPage(), arr = getAnnos(n), { wins, doors } = openingGroups(arr);
  const matL = { holz: 'Holz', metall: 'Metall', kunst: 'Kunststoff' }, typeL = { fest: 'Fest', f1: '1-flügelig', f2: '2-flügelig', f2s: '2-fl. Setzholz', f1f: '1-fl.+Fixteil' }, hingeL = { left: 'links', right: 'rechts', kipp: 'Kipp' };
  const dim = (o, oh) => { const ins = ptsToCm(openInsPts(o)) / 100; return { rw: Math.round(ptsToCm(o.w)), rh: Math.round(oh * 100), lw: Math.round((ptsToCm(o.w) / 100 - 2 * ins) * 100), lh: Math.round((oh - 2 * ins) * 100) }; };
  const badge = (lab, val) => '<span class="ws-badge"><i>' + lab + '</i>' + val + '</span>';
  const card = (o, g, p, isWin) => { const d = dim(o, g.oh); return '<div class="ws-card"><div class="ws-thumb">' + winThumb(o) + '</div><div class="ws-info"><div class="ws-top"><b>' + p + '</b><span class="ws-type">' + (typeL[o.winType || 'f1'] || '') + '</span><span class="grow"></span><span class="ws-cnt">' + g.n + '×</span></div><div class="ws-badges">' + badge('Licht', d.lw + '×' + d.lh) + badge('Rohbau', d.rw + '×' + d.rh) + (isWin ? badge('Brüstung', Math.round((o.sill || 0) * 100)) : '') + badge('Anschlag', hingeL[o.winHinge || 'left'] || '') + '</div><div class="ws-mat">' + (matL[o.winMat || 'holz'] || '') + '</div></div></div>'; };
  let wcards = '', dcards = '', wc = 'Pos\tTyp\tMaterial\tLicht BxH\tRohbau BxH\tBrüstung\tAnschlag\tStk\n', dc = 'Pos\tTyp\tMaterial\tLicht BxH\tRohbau BxH\tAnschlag\tStk\n';
  wins.forEach((g, i) => { const o = g.o, d = dim(o, g.oh), p = g.pos || ('F' + (i + 1)); wcards += card(o, g, p, true); wc += p + '\t' + (typeL[o.winType || 'f1'] || '') + '\t' + (matL[o.winMat || 'holz'] || '') + '\t' + d.lw + 'x' + d.lh + '\t' + d.rw + 'x' + d.rh + '\t' + Math.round((o.sill || 0) * 100) + '\t' + (hingeL[o.winHinge || 'left'] || '') + '\t' + g.n + '\n'; });
  doors.forEach((g, i) => { const o = g.o, d = dim(o, g.oh), p = g.pos || ('T' + (i + 1)); dcards += card(o, g, p, false); dc += p + '\t' + (typeL[o.winType || 'f1'] || '') + '\t' + (matL[o.winMat || 'holz'] || '') + '\t' + d.lw + 'x' + d.lh + '\t' + d.rw + 'x' + d.rh + '\t' + (hingeL[o.winHinge || 'left'] || '') + '\t' + g.n + '\n'; });
  bodyEl.innerHTML = '<h4>Fenster (' + wins.reduce((s, g) => s + g.n, 0) + ' Stk) · Masse in cm (B×H)</h4>' + (wcards || '<p class="lp2-empty">Keine Fenster.</p>') + '<h4>Türen (' + doors.reduce((s, g) => s + g.n, 0) + ' Stk)</h4>' + (dcards || '<p class="lp2-empty">Keine Türen.</p>');
  return () => navigator.clipboard.writeText('FENSTERLISTE\n' + wc + '\nTÜRLISTE\n' + dc).then(() => toast('Liste kopiert (Excel-tauglich)')).catch(() => toast('Kopieren nicht möglich'));
}
function openSchedule() { openListPanel('schedule'); }
function computeQuantities(arr) {   // Mengenauszug: Wandfläche × Schichtstärke − Öffnungen
  const VOL = ['beton', 'mauerwerk'], mats = {}, opsAgg = {};
  for (const w of arr) {
    if (w.type !== 'wall' || !layerVisible(w) || !phaseVisible(w)) continue;
    const L = ptsToCm(Math.hypot(w.x2 - w.x1, w.y2 - w.y1)) / 100, Hgt = w.h3d || wallHeightM;
    let openA = 0;
    for (const o of arr) {
      if (o.type !== 'opening' || o.wallId !== w.id) continue;
      const oh = o.kind === 'window' ? ((o.head || 2.1) - (o.sill || 0)) : (o.head || 2.0), ow = ptsToCm(o.w) / 100, ins = ptsToCm(openInsPts(o)) / 100;
      openA += ow * oh;
      const lw = Math.round((ow - 2 * ins) * 100), lh = Math.round((oh - 2 * ins) * 100), key = o.kind + ':' + Math.round(ow * 100) + 'x' + Math.round(oh * 100);
      if (!opsAgg[key]) opsAgg[key] = { kind: o.kind, n: 0, rohW: Math.round(ow * 100), rohH: Math.round(oh * 100), lichtW: lw, lichtH: lh, winType: o.winType || 'f1', mat: o.winMat || 'holz' };
      opsAgg[key].n++;
    }
    const netA = Math.max(0, L * Hgt - openA), layers = (w.layers && w.layers.length) ? w.layers : null;
    if (!layers) { const k = '_wall@' + Math.round(ptsToCm(w.thick || wallThickPts())); if (!mats[k]) mats[k] = { mat: '_wall', tcm: Math.round(ptsToCm(w.thick || wallThickPts())), area: 0, vol: 0, unit: 'm²' }; mats[k].area += netA; continue; }
    for (const ly of layers) { if (ly.mat === 'luft') continue; const tcm = Math.round(ptsToCm(ly.t) * 10) / 10, key = ly.mat + '@' + tcm, vol = VOL.includes(ly.mat); if (!mats[key]) mats[key] = { mat: ly.mat, tcm, area: 0, vol: 0, unit: vol ? 'm³' : 'm²' }; mats[key].area += netA; if (vol) mats[key].vol += netA * (tcm / 100); }
  }
  const extra = {}, ex = (key, label, unit) => extra[key] || (extra[key] = { label, unit, qty: 0, n: 0, vol: 0, steps: 0 });   // Decken/Dächer/Treppen
  const pp = docScale ? docScale.perPt : 0;
  for (const a of arr) {
    if (!layerVisible(a) || !phaseVisible(a)) continue;
    if (a.type === 'slab' && a.pts && a.pts.length >= 3) { const m2 = polyArea(a.pts) * pp * pp; if (a.layers && a.layers.length) { for (const l of a.layers) { const lbl = (WALL_MATS[l.mat] && WALL_MATS[l.mat].label) || l.mat, e = ex('slabL:' + l.mat, 'Decke: ' + lbl, 'm²'); e.qty += m2; e.n++; e.vol += m2 * l.t; } } else { const e = ex('slab', 'Decke / Bodenplatte', 'm²'); e.qty += m2; e.n++; e.vol += m2 * (a.thick || 0.2); } }
    else if (a.type === 'roof' && a.w && a.h) { const e = ex('roof', 'Dach (Grundfläche)', 'm²'); e.qty += Math.abs(a.w * a.h) * pp * pp; e.n++; }
    else if (a.type === 'stairs') { const e = ex('stairs', 'Treppe (Lauf)', 'm'); e.qty += ptsToCm(Math.hypot(a.x2 - a.x1, a.y2 - a.y1)) / 100; e.n++; e.steps += stairSteps(a); }
    else if (a.type === 'beam') { const e = ex('beam', 'Unterzug', 'm'); e.qty += ptsToCm(Math.hypot(a.x2 - a.x1, a.y2 - a.y1)) / 100; e.n++; }
    else if (a.type === 'profile' && a.path && a.path.length >= 2) { const len = profilePathLenM(a.closed && a.path.length >= 3 ? a.path.concat([a.path[0]]) : a.path), volM3 = len * (profileArea(a.prof || []) / 10000), e = ex('profile:' + (a.name || 'Profil'), 'Profil: ' + (a.name || 'Profil'), 'm'); e.qty += len; e.n++; e.vol += volM3; if (a.mat === 'metall') e.kg = (e.kg || 0) + volM3 * 7850; }
    else if (a.type === 'opening' && (a.kind === 'window' || a.kind === 'door')) {   // Laibung: 4 Kanten × innen/aussen, Fläche (m²) + Volumen (m³) je Material
      const w = arr.find(x => x.id === a.wallId && x.type === 'wall');
      const T = ptsToCm(a.thick || (w && w.thick) || wallThickPts()) / 100, frameD = ptsToCm(a.frameD || cmToPts(7)) / 100, depthSide = Math.max(0.02, (T - frameD) / 2);
      const ow = ptsToCm(a.w || 0) / 100, oh = a.kind === 'window' ? ((a.head || 2.1) - (a.sill || 0)) : (a.head || 2.0);
      for (const [edge, len] of [['L', oh], ['R', oh], ['T', ow], ['B', ow]]) for (const side of ['in', 'out']) {
        const er = a.reveals && a.reveals[edge], lst = (er && Array.isArray(er[side]) && er[side].length) ? er[side] : (side === 'in' ? a.revealLining : a.revealLiningOut);
        if (!Array.isArray(lst) || len <= 0) continue;
        for (const ly of lst) { if (!ly || ly.mat === 'luft') continue; const lbl = (WALL_MATS[ly.mat] && WALL_MATS[ly.mat].label) || ly.mat, vol = VOL.includes(ly.mat), e = ex('reveal:' + ly.mat, 'Laibung: ' + lbl, vol ? 'm³' : 'm²'); e.qty += vol ? (len * depthSide * ((ly.t || 0) / 100)) : (len * depthSide); e.n++; e.vol += len * depthSide * ((ly.t || 0) / 100); }
      }
    }
  }
  return { mats: Object.values(mats).sort((a, b) => a.mat.localeCompare(b.mat)), ops: Object.values(opsAgg).sort((a, b) => (a.kind + a.rohW).localeCompare(b.kind + b.rohW)), extra: Object.values(extra) };
}
function fillQtyList(bodyEl) {   // Mengenauszug in das Listen-Panel
  const n = curPage(), arr = getAnnos(n), { mats, ops, extra } = computeQuantities(arr);
  const ML = { _wall: 'Wand (einschichtig)' }, lbl = m => (WALL_MATS[m] && WALL_MATS[m].label) || ML[m] || m;
  let rows = '', csv = 'Material\tStärke (cm)\tMenge\tEinheit\n';
  const sw = m => { const mt = WALL_MATS[m] || {}; return '<span class="mat-sw" style="background:' + (mt.fill || '#d7d9d0') + ';border-color:' + (mt.color || '#9a9a9a') + '"></span>'; };   // Material-Farbtupfer
  for (const r of mats) { const q = r.unit === 'm³' ? r.vol : r.area, qs = (Math.round(q * 100) / 100).toLocaleString('de-CH'); rows += '<tr><td>' + sw(r.mat) + lbl(r.mat) + '</td><td>' + (r.unit === 'm³' ? '' : r.tcm) + '</td><td class="num" style="text-align:right">' + qs + '</td><td class="unit">' + r.unit + '</td></tr>'; csv += lbl(r.mat) + '\t' + (r.unit === 'm³' ? '' : r.tcm) + '\t' + qs + '\t' + r.unit + '\n'; }
  let orows = '', ocsv = 'Typ\tAnzahl\tLicht B×H (cm)\tRohbau B×H (cm)\n';
  const tn = { fest: 'Fest', f1: '1-flügelig', f2: '2-flügelig', f2s: '2-fl.+Setzholz', f1f: '1-fl.+Fixteil' };
  for (const o of ops) { const t = (o.kind === 'window' ? 'Fenster' : 'Tür') + ' ' + (tn[o.winType] || ''); orows += '<tr><td>' + t + '</td><td style="text-align:center">' + o.n + '</td><td>' + o.lichtW + '×' + o.lichtH + '</td><td>' + o.rohW + '×' + o.rohH + '</td></tr>'; ocsv += t + '\t' + o.n + '\t' + o.lichtW + '×' + o.lichtH + '\t' + o.rohW + '×' + o.rohH + '\n'; }
  let erows = '', ecsv = 'Bauteil\tAnzahl\tMenge\tEinheit\tZusatz\n';
  for (const e of (extra || [])) { const q = (Math.round(e.qty * 100) / 100).toLocaleString('de-CH'), np = []; if (e.vol) np.push((Math.round(e.vol * 100) / 100).toLocaleString('de-CH') + ' m³'); if (e.kg) np.push(Math.round(e.kg).toLocaleString('de-CH') + ' kg'); if (e.steps) np.push(e.steps + ' Stufen'); const note = np.join(' · '); erows += '<tr><td>' + e.label + '</td><td style="text-align:center">' + e.n + '</td><td style="text-align:right">' + q + '</td><td>' + e.unit + '</td><td>' + note + '</td></tr>'; ecsv += e.label + '\t' + e.n + '\t' + q + '\t' + e.unit + '\t' + note + '\n'; }
  bodyEl.innerHTML = '<h4>Seite ' + n + ' · Öffnungen abgezogen · Materialliste</h4><table class="qty-tab"><thead><tr><th>Material</th><th>Stärke</th><th>Menge</th><th>Einheit</th></tr></thead><tbody>' + (rows || '<tr><td colspan=4>Keine mehrschichtigen Wände auf dieser Seite.</td></tr>') + '</tbody></table><h4>Fenster-/Türliste</h4><table class="qty-tab"><thead><tr><th>Typ</th><th>Anzahl</th><th>Licht B×H</th><th>Rohbau B×H</th></tr></thead><tbody>' + (orows || '<tr><td colspan=4>Keine Öffnungen.</td></tr>') + '</tbody></table>' + (erows ? '<h4>Decken · Dächer · Treppen · Profile</h4><table class="qty-tab"><thead><tr><th>Bauteil</th><th>Anzahl</th><th>Menge</th><th>Einheit</th><th>Zusatz</th></tr></thead><tbody>' + erows + '</tbody></table>' : '');
  return () => navigator.clipboard.writeText('MATERIALLISTE\n' + csv + '\nFENSTER/TÜREN\n' + ocsv + (erows ? '\nDECKEN/DÄCHER/TREPPEN\n' + ecsv : '')).then(() => toast('In die Zwischenablage kopiert (Excel-tauglich)')).catch(() => toast('Kopieren nicht möglich'));
}
function openQuantities() { openListPanel('qty'); }
function applyMountPreset(a, mode) {   // drei Montagearten des Rahmens → sinnvolle Defaults (danach frei editierbar)
  if (mode === 'innen') { a.depth = 0.2; a.anschlagType = 'innen'; if (a.anschlagDepth == null) a.anschlagDepth = cmToPts(5); }          // innen ans Mauerwerk angeschlagen
  else if (mode === 'laibung') { a.depth = 0.5; a.anschlagType = 'none'; }                                                              // stumpf in der Laibung
  else if (mode === 'aussen') { a.depth = 0.82; a.anschlagType = 'aussen'; if (a.outerLap == null) a.outerLap = cmToPts(3); if (a.anschlagDepth == null) a.anschlagDepth = cmToPts(5); }   // aussen auf die Konstruktion
}
async function makeTestScene() {   // schnelle Test-Szene: mehrschichtige Wand + Fenster, bereit für den Detail-Editor
  if (!pdfDoc) { try { await newBlankDoc(); } catch (_) { } }
  if (!pdfDoc) { toast('Kein Dokument – „leer starten" oder PDF öffnen.'); return; }
  if (!docScale) docScale = { perPt: 50 * PT2MM / 1000, label: '1:50', n: 50 };
  const n = curPage(), pv = pageViews.find(p => p.num === n); if (!pv) { toast('Keine Seite offen.'); return; }
  pushUndo();
  const arr = getAnnos(n), y = (pv.pageH || 842) * 0.42, x1 = (pv.pageW || 595) * 0.18, x2 = x1 + cmToPts(400), wid = nextId++;
  const wall = { id: wid, type: 'wall', x1, y1: y, x2, y2: y, thick: cmToPts(35), just: 'center', color: '#1c242c', fill: '#ffffff', hatch: null, width: 1.4, h3d: wallHeightM, dim: false, layer: activeLayerId };
  applyWallBuildup(wall, [['putz', 1.5], ['mauerwerk', 15], ['eps', 16], ['putz', 2.5]]); arr.push(wall);
  const win = { id: nextId++, type: 'opening', kind: 'window', wallId: wid, t: 0.5, w: cmToPts(120), depth: 0.5, frameW: cmToPts(10), frameD: cmToPts(7), winType: 'f2', winMat: 'holz', sill: 0.9, head: 2.2, revealType: 'putz', layer: activeLayerId };
  openingResolve(win, pv); arr.push(win);
  try { updateScaleLabel(); } catch (_) { }
  sel = { num: n, id: win.id }; setTool('select'); drawAnnos(pv); saveState();
  toast('Test-Wand (35 cm, mehrschichtig) + Fenster (120 cm) erstellt → Fenster ist gewählt, jetzt „⊕ Detail" öffnen.');
}
async function buildExampleProject() {   // Start-Beispiel: Grundriss (Wand + Fenster + Tür) + 2 Schnitte + Ansicht vorne/hinten, 1:20, beschriftet
  try { await newBlankDoc({ w: 1684, h: 1191 }); } catch (_) { }   // A2 quer (Inhalt füllt das Blatt)
  if (!pdfDoc) { toast('Beispiel konnte nicht erstellt werden.'); return; }
  docScale = { perPt: 20 * PT2MM / 1000, label: '1:20', n: 20 };
  const n = curPage(), pv = pageViews.find(p => p.num === n); if (!pv) return;
  const arr = getAnnos(n);
  const txt = (x, y, t, size, w) => arr.push({ id: nextId++, type: 'text', x, y, w: w || cmToPts(200), h: 30, text: t, size: size || 16, color: '#1c242c', align: 'left', bg: 'transparent', border: null, layer: activeLayerId });
  const mkSection = (cx1, cy1, cx2, cy2, label, ox, oy, flip) => { const s = { id: nextId++, type: 'section', cx1, cy1, cx2, cy2, label, ox, oy, layer: activeLayerId }; if (flip) s.flip = true; arr.push(s); };
  txt(82, 96, 'BEISPIELPROJEKT — Wand mit Fenster & Tür · Massstab 1:20', 22, cmToPts(900));   // Titel weiter hoch
  const wy = 360, wx1 = 100, wlen = cmToPts(500), wx2 = wx1 + wlen, wid = nextId++;   // GRUNDRISS (Abstand zum Titel)
  const wall = { id: wid, type: 'wall', x1: wx1, y1: wy, x2: wx2, y2: wy, thick: cmToPts(35), just: 'center', color: '#1c242c', fill: '#ffffff', hatch: null, width: 1.4, h3d: wallHeightM, dim: true, layer: activeLayerId };
  applyWallBuildup(wall, [['putz', 1.5], ['mauerwerk', 15], ['eps', 16], ['putz', 2.5]]); arr.push(wall);
  const win = { id: nextId++, type: 'opening', kind: 'window', wallId: wid, t: 0.28, w: cmToPts(120), depth: 0.5, frameW: cmToPts(10), frameD: cmToPts(7), winType: 'f2', winMat: 'holz', sill: 0.9, head: 2.2, revealType: 'putz', bank: true, layer: activeLayerId };
  const dr = { id: nextId++, type: 'opening', kind: 'door', wallId: wid, t: 0.72, w: cmToPts(100), depth: 0.5, frameW: cmToPts(6), frameD: cmToPts(7), winType: 'f1', winMat: 'holz', head: 2.05, revealType: 'putz', layer: activeLayerId };
  openingResolve(win, pv); openingResolve(dr, pv); arr.push(win); arr.push(dr);
  txt(wx1, wy - 80, 'GRUNDRISS', 16);
  const winX = wx1 + 0.28 * wlen, drX = wx1 + 0.72 * wlen;
  mkSection(winX, wy - 70, winX, wy + 70, 'A', 100, 970);   // Schnitt durch Fenster
  mkSection(drX, wy - 70, drX, wy + 70, 'B', 510, 970);     // Schnitt durch Tür
  mkSection(wx1, wy - 110, wx2, wy - 110, 'V', 980, 600, false);   // Ansicht vorne: Blickrichtungs-Linie auf der Aussenseite → sieht die Wand, unspiegelt
  mkSection(wx1, wy + 110, wx2, wy + 110, 'H', 980, 1040, true);   // Ansicht hinten: andere Seite, gespiegelt – gestapelt, weiter rechts (eigene Labels weg, Schnitt V-V/H-H reicht)
  for (const part of buildPlanParts(1684, 1191, { kind: 'rahmen' })) arr.push(Object.assign(part, { id: nextId++, layer: activeLayerId }));
  for (const part of buildPlanParts(1684, 1191, { pos: 'br', fields: { projekt: 'Beispielprojekt', gezeichnet: 'Submit PDF' } })) arr.push(Object.assign(part, { id: nextId++, layer: activeLayerId }));   // vollwertiger Plankopf unten rechts
  drawAnnos(pv);
  try { await buildTestSheet(); } catch (e) { console.error(e); }   // Seite 2: Teststand 3 Aufbauten + EG/Decke/OG
  try { await buildCornerTest(); } catch (e) { console.error(e); }   // Seite 3: Eck-Test (45°/90°-Ecken, Fenster + Tür je Wand)
  saveState();
  toast('Beispielprojekt: Seite 1 = Grundriss/Schnitte/Ansicht. Seite 2 = Teststand (3 Wandaufbauten, EG+Decke+OG) zum Testen der Wand-Decken-Verschneidung + Performance.');
}
async function buildTestSheet() {   // Seite 2: 3 Wandaufbauten, je EG-Wand + Decke (OK auf Geschosshöhe) + OG-Wand, Schnitt quer → Wand-Decken-Verschneidung
  await insertBlankPage(1, { w: 3370, h: 2384 });   // A1 quer – breit genug für 3 Aufbauten nebeneinander, hoch genug für EG+OG-Schnitte
  const pv2 = pageViews.find(p => p.num === 2); if (!pv2) return; const a2 = getAnnos(2);
  const gh = 2.0;   // Geschosshöhe 2.0 m
  const slabBeton = [['belag', 1.5], ['estrich', 6], ['trittschall', 2], ['eps', 2], ['beton', 25], ['putz', 1.5]];   // Stahlbeton gedämmt
  const slabHolz = [['belag', 1.5], ['estrich', 6], ['trittschall', 2], ['eps', 2], ['dreischicht', 2.5], ['glaswolle', 20], ['dreischicht', 1.5], ['konter', 4], ['gips', 1.25], ['putz', 0.5]];   // Holzbau Dreischicht
  const txt2 = (x, y, t, size, w) => a2.push({ id: nextId++, type: 'text', x, y, w: w || cmToPts(300), h: 30, text: t, size: size || 16, color: '#1c242c', align: 'left', bg: 'transparent', border: null, layer: activeLayerId });
  txt2(80, 70, 'TESTSTAND — 3 Wandaufbauten · EG-Wand + Decke + OG-Wand · Wand-Decken-Verschneidung · 1:20', 20, cmToPts(1500));
  const setups = [
    { name: 'Standard: Mauerwerk + EPS', b: [['putz', 1.5], ['mauerwerk', 15], ['eps', 22], ['putz', 2.5]], s: slabBeton },
    { name: 'Holzbau: Ständer + Schalung', b: [['putz', 0.5], ['gips', 1.25], ['konter', 4], ['osb', 2], ['staender', 16], ['mdf', 6], ['luft', 4], ['schalung', 2.2]], s: slabHolz },
    { name: 'Zweischalenmauerwerk (verputzt)', b: [['putz', 1.5], ['mauerwerk', 17.5], ['glaswolle', 20], ['luft', 4], ['klinker', 12.5], ['putz', 1.5]], s: slabBeton }
  ];
  const wlen = cmToPts(200), planY = 300, colW = 1040, secOy = 2120;
  for (const part of buildPlanParts(3370, 2384, { kind: 'rahmen' })) a2.push(Object.assign(part, { id: nextId++, layer: activeLayerId }));
  for (const part of buildPlanParts(3370, 2384, { pos: 'br', fields: { projekt: 'Beispielprojekt – Teststand', gezeichnet: 'Submit PDF' } })) a2.push(Object.assign(part, { id: nextId++, layer: activeLayerId }));   // vollwertiger Plankopf unten rechts
  setups.forEach((su, i) => {
    const X0 = 90 + i * colW, secX = X0 + wlen / 2;
    txt2(X0, planY - 40, (i + 1) + ') ' + su.name, 13, cmToPts(380));
    const eg = { id: nextId++, type: 'wall', x1: X0 + wlen, y1: planY, x2: X0, y2: planY, thick: cmToPts(20), just: 'center', color: '#1c242c', fill: '#fff', hatch: null, width: 1.4, h3d: gh, base: 0, dim: true, layer: activeLayerId };   // Endpunkte gedreht → Innenseite zeigt zur Decke (Raum)
    applyWallBuildup(eg, su.b); a2.push(eg);   // EG-Wand (Basis 0)
    const og = { id: nextId++, type: 'wall', x1: X0 + wlen, y1: planY, x2: X0, y2: planY, thick: cmToPts(20), just: 'center', color: '#1c242c', fill: '#fff', hatch: null, width: 1.4, h3d: gh, base: gh, layer: activeLayerId };
    applyWallBuildup(og, su.b); a2.push(og);   // OG-Wand (steht auf der Decke, Basis = Geschosshöhe)
    const slab = { id: nextId++, type: 'slab', pts: [[X0 - cmToPts(20), planY], [X0 + wlen + cmToPts(20), planY], [X0 + wlen + cmToPts(20), planY + cmToPts(200)], [X0 - cmToPts(20), planY + cmToPts(200)]], color: '#5b6b86', base: gh - 0.35, thick: 0.35, layer: activeLayerId };
    applySlabBuildup(slab, su.s); slab.base = Math.round((gh - slab.thick) * 1000) / 1000; a2.push(slab);   // Decke: passender Schichtaufbau, Oberkante auf Geschosshöhe gh
    a2.push({ id: nextId++, type: 'section', cx1: secX, cy1: planY - cmToPts(45), cx2: secX, cy2: planY + cmToPts(210), label: String.fromCharCode(65 + i), ox: X0 + 30, oy: secOy, layer: activeLayerId });   // Schnitt quer durch EG-Wand + Decke + OG-Wand
  });
  drawAnnos(pv2);
}
async function buildCornerTest() {   // Seite 3: Wandzug mit 45°/90°-Ecken, je Fenster + Tür → Eck-Verschneidung + Performance
  await insertBlankPage(2, { w: 1684, h: 1191 });   // A2 quer
  const pv3 = pageViews.find(p => p.num === 3); if (!pv3) return; const a3 = getAnnos(3);
  const b = [['putz', 1.5], ['mauerwerk', 15], ['eps', 22], ['putz', 2.5]];
  a3.push({ id: nextId++, type: 'text', x: 80, y: 70, w: cmToPts(1400), h: 30, text: 'ECK-TEST — Wandzug mit 45°/90°-Ecken, je Fenster + Tür · Eck-Verschneidung + Performance · 1:20', size: 18, color: '#1c242c', align: 'left', bg: 'transparent', border: null, layer: activeLayerId });
  const P = [[380, 300], [663, 300], [813, 450], [813, 733], [601, 733]];   // A→B 4m, B→C 3m 45°, C→D 4m, D→E 3m (Ecken: B 45°, C 45°, D 90°)
  const walls = [];
  for (let i = 0; i < P.length - 1; i++) { const w = { id: nextId++, type: 'wall', x1: P[i][0], y1: P[i][1], x2: P[i + 1][0], y2: P[i + 1][1], thick: cmToPts(41), just: 'center', color: '#1c242c', fill: '#fff', hatch: null, width: 1.4, h3d: wallHeightM, base: 0, dim: true, layer: activeLayerId }; applyWallBuildup(w, b); a3.push(w); walls.push(w); }
  for (const w of walls) { const len = Math.hypot(w.x2 - w.x1, w.y2 - w.y1);
    const win = { id: nextId++, type: 'opening', kind: 'window', wallId: w.id, t: 0.3, w: Math.min(cmToPts(120), len * 0.42), depth: 0.5, frameW: cmToPts(10), frameD: cmToPts(7), winType: 'f1', winMat: 'holz', sill: 0.9, head: 2.1, bank: true, layer: activeLayerId }; openingResolve(win, pv3); a3.push(win);
    if (len > cmToPts(280)) { const dr = { id: nextId++, type: 'opening', kind: 'door', wallId: w.id, t: 0.74, w: cmToPts(90), depth: 0.5, frameW: cmToPts(6), frameD: cmToPts(7), winType: 'f1', winMat: 'holz', head: 2.0, layer: activeLayerId }; openingResolve(dr, pv3); a3.push(dr); }
  }
  a3.push({ id: nextId++, type: 'section', cx1: 520, cy1: 250, cx2: 520, cy2: 370, label: 'E', ox: 130, oy: 1080, layer: activeLayerId });   // Schnitt quer durch Wand A→B
  for (const part of buildPlanParts(1684, 1191, { kind: 'rahmen' })) a3.push(Object.assign(part, { id: nextId++, layer: activeLayerId }));
  for (const part of buildPlanParts(1684, 1191, { pos: 'br', fields: { projekt: 'Beispiel – Eck-Test', gezeichnet: 'Submit PDF' } })) a3.push(Object.assign(part, { id: nextId++, layer: activeLayerId }));
  drawAnnos(pv3);
}
function openLaibungEditor(a, pv) {   // interaktives Laibungs-Detail: reinzoomen, Ziehgriffe + Regler, live in den Plan
  const arr = getAnnos(pv.num), wall = a.wallId && arr.find(o => o.id === a.wallId && o.type === 'wall');
  if ((a.kind === 'window' || a.kind === 'door') && wall && wall.layers && wall.layers.length) {   // Laibung von Anfang an als echte Schichten anlegen (aus dem Wandaufbau) → Lichtmass stimmt sofort + reagiert
    const L0 = wall.layers[0], LN = wall.layers[wall.layers.length - 1];
    if (!Array.isArray(a.revealLining)) a.revealLining = [{ mat: L0.mat, t: Math.round(ptsToCm(L0.t) * 10) / 10 }];
    if (!Array.isArray(a.revealLiningOut)) a.revealLiningOut = [{ mat: LN.mat, t: Math.round(ptsToCm(LN.t) * 10) / 10 }];
  }
  const ov = document.createElement('div'); ov.className = 'lab-overlay';
  ov.innerHTML = '<div class="lab-wrap"><div class="lab-head"><b>Fenster-Detail</b><span class="lab-hint">Grundriss + Schnitt im Wandkontext · Mausrad = zoomen · Punkte ziehen / Regler · alles live</span><span class="grow"></span><button class="btn" id="labFit" title="Ansichten einpassen">⤢ Einpassen</button><button class="btn" id="labClose">✕ Schliessen</button></div><div class="lab-body"><div class="lab-stage" id="labStage"><div class="lab-view" style="grid-column:1;grid-row:1"><span class="lab-vlbl">GRUNDRISS</span><div class="lab-zoom" data-view="g"><button data-z="in">＋</button><button data-z="out">−</button><button data-z="fit">⤢</button></div><svg class="lab-svg" id="labSvg" xmlns="http://www.w3.org/2000/svg"></svg></div><div class="lab-view" style="grid-column:3;grid-row:1"><span class="lab-vlbl">ANSICHT AUSSEN</span><div class="lab-zoom" data-view="ao"><button data-z="in">＋</button><button data-z="out">−</button><button data-z="fit">⤢</button></div><svg class="lab-svg" id="labSvgAo" xmlns="http://www.w3.org/2000/svg"></svg></div><div class="lab-view" style="grid-column:1;grid-row:3"><span class="lab-vlbl">SCHNITT</span><div class="lab-zoom" data-view="s"><button data-z="in">＋</button><button data-z="out">−</button><button data-z="fit">⤢</button></div><svg class="lab-svg" id="labSvgS" xmlns="http://www.w3.org/2000/svg"></svg></div><div class="lab-view" style="grid-column:3;grid-row:3"><span class="lab-vlbl">ANSICHT INNEN</span><div class="lab-zoom" data-view="ai"><button data-z="in">＋</button><button data-z="out">−</button><button data-z="fit">⤢</button></div><svg class="lab-svg" id="labSvgAi" xmlns="http://www.w3.org/2000/svg"></svg></div><div class="lab-split lab-split-v" id="labSplitV" title="Spalten-Breite ziehen"></div><div class="lab-split lab-split-h" id="labSplitH" title="Zeilen-Höhe ziehen"></div></div><div class="lab-side" id="labCtrls"></div></div></div>';
  document.body.appendChild(ov);
  const svg = ov.querySelector('#labSvg'), svgS = ov.querySelector('#labSvgS'), svgAo = ov.querySelector('#labSvgAo'), svgAi = ov.querySelector('#labSvgAi'), side = ov.querySelector('#labCtrls');
  let vbG = null, vbS = null, vbAo = null, vbAi = null;   // aktuelle viewBox je Ansicht (zoomen/verschieben wie im echten Grundriss; null = einpassen)
  let secFlip = false, secLine = null, secMullion = false;   // Schnitt: Blickrichtung + frei verschiebbare Schnittlinie + Schnitt durch Mittelstoss (Setzholz)
  let selLayer = null;   // im Bild angeklickte Schicht: { kind:'wall', i } → Inline-Editor
  let editEdge = 'all';   // welche Laibungs-Kante bearbeitet wird: all | L | R | T | B
  const dimOff = {};   // verschiebbare Masslinien: key -> Offset (Zeichnungseinheiten)
  const DIMD = { secRoh: 74, secLicht: 36, elW: 40, elH: 60, gndRoh: 60, gndLicht: 28 };
  const doff = k => dimOff[k] != null ? dimOff[k] : DIMD[k];
  const pushDim = (out, P1, P2, n, off, label, key) => {   // durchlaufende Masslinie: Hilfslinien + Linie + Ticks + Text + Ziehgriff
    const e = 3, q1 = [P1[0] + n[0] * off, P1[1] + n[1] * off], q2 = [P2[0] + n[0] * off, P2[1] + n[1] * off];
    out.push({ t: 'line', x1: P1[0] + n[0] * e, y1: P1[1] + n[1] * e, x2: q1[0] + n[0] * e, y2: q1[1] + n[1] * e, stroke: '#5a6152', w: 0.4 });
    out.push({ t: 'line', x1: P2[0] + n[0] * e, y1: P2[1] + n[1] * e, x2: q2[0] + n[0] * e, y2: q2[1] + n[1] * e, stroke: '#5a6152', w: 0.4 });
    out.push({ t: 'line', x1: q1[0], y1: q1[1], x2: q2[0], y2: q2[1], stroke: '#1c242c', w: 0.7 });
    const dx = q2[0] - q1[0], dy = q2[1] - q1[1], dl = Math.hypot(dx, dy) || 1, tx = dx / dl, ty = dy / dl, t = 3.2;
    for (const q of [q1, q2]) out.push({ t: 'line', x1: q[0] - ty * t, y1: q[1] + tx * t, x2: q[0] + ty * t, y2: q[1] - tx * t, stroke: '#1c242c', w: 0.7 });
    out.push({ t: 'text', x: (q1[0] + q2[0]) / 2 + n[0] * 6 - (Math.abs(n[1]) > 0.5 ? label.length * 2.5 : 0), y: (q1[1] + q2[1]) / 2 + n[1] * 6 + 3.5, text: label, col: '#1c242c', small: true });
    out.push({ t: 'dh', x: (q1[0] + q2[0]) / 2, y: (q1[1] + q2[1]) / 2, nx: n[0], ny: n[1], key });
  };
  const bindDim = (el, getVb, redraw) => { const vb = getVb(); const sc = vb ? vb.w / (el.clientWidth || 320) : 1; el.querySelectorAll('.lab-dh').forEach(h => h.onpointerdown = ev => { ev.preventDefault(); ev.stopPropagation(); const key = h.dataset.key, nx = parseFloat(h.dataset.nx), ny = parseFloat(h.dataset.ny), o0 = doff(key), sx = ev.clientX, sy = ev.clientY; const mv = e2 => { const d = ((e2.clientX - sx) * nx + (e2.clientY - sy) * ny) * sc; dimOff[key] = Math.max(8, o0 + d); redraw(); }; const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); }; document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up); }); };
  const vbStr = v => v.x + ' ' + v.y + ' ' + v.w + ' ' + v.h;
  function navSetup(el, getV, setV, redraw) {   // Mausrad = Zoom zum Cursor · Ziehen (ausser auf Griff) = verschieben
    el.addEventListener('wheel', e => { e.preventDefault(); const vb = getV(); if (!vb) return; const r = el.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height, mx = vb.x + fx * vb.w, my = vb.y + fy * vb.h, f = e.deltaY < 0 ? 1 / 1.15 : 1.15, nw = Math.max(3, vb.w * f), nh = Math.max(3, vb.h * f); setV({ x: mx - fx * nw, y: my - fy * nh, w: nw, h: nh }); redraw(); }, { passive: false });
    el.addEventListener('pointerdown', e => { if (e.target.closest && e.target.closest('.lab-h')) return; const vb = getV(); if (!vb) return; const r = el.getBoundingClientRect(), sx = e.clientX, sy = e.clientY, ox = vb.x, oy = vb.y, sw = vb.w / r.width, sh = vb.h / r.height; el.style.cursor = 'grabbing'; const mv = ev => { setV({ x: ox - (ev.clientX - sx) * sw, y: oy - (ev.clientY - sy) * sh, w: vb.w, h: vb.h }); redraw(); }; const up = () => { el.style.cursor = ''; document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); }; document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up); });
  }
  const W = 640, Hh = 520, cx = W * 0.42, cy = Hh / 2;
  const cm = pts => Math.round(ptsToCm(pts) * 10) / 10;
  const fields = [
    { k: 'depth', label: 'Einbautiefe', unit: '%', get: () => Math.round((a.depth == null ? 0.5 : a.depth) * 100), set: v => a.depth = Math.max(0, Math.min(1, v / 100)), min: 0, max: 100, step: 1 },
    { k: 'frameW', label: 'Rahmenbreite (Ansicht)', unit: 'cm', get: () => cm(a.frameW || cmToPts(a.kind === 'door' ? 6 : 10)), set: v => a.frameW = cmToPts(v), min: 3, max: 20, step: 0.5 },
    { k: 'frameD', label: 'Rahmentiefe', unit: 'cm', get: () => cm(a.frameD || cmToPts(7)), set: v => a.frameD = cmToPts(v), min: 4, max: 16, step: 0.5 },
    { k: 'sashW', label: 'Flügelbreite', unit: 'cm', get: () => cm(a.sashW || cmToPts(7)), set: v => a.sashW = cmToPts(v), min: 3, max: 14, step: 0.5, when: () => a.kind === 'window' },
    { k: 'sashD', label: 'Flügeltiefe', unit: 'cm', get: () => cm(a.sashD || cmToPts(7)), set: v => a.sashD = cmToPts(v), min: 3, max: 14, step: 0.5, when: () => a.kind === 'window' },
    { k: 'sashShift', label: 'Flügel-Überlappung', unit: 'cm', get: () => cm(a.sashShift != null ? a.sashShift : cmToPts(4)), set: v => a.sashShift = cmToPts(v), min: 0, max: 8, step: 0.5, when: () => a.kind === 'window' },
    { k: 'boardW', label: 'Laibungsbrett Breite', unit: 'cm', get: () => a.boardW != null ? a.boardW : 2.5, set: v => a.boardW = v, min: 0.5, max: 20, step: 0.5 },
    { k: 'boardVis', label: 'Brett-Abstand zum Rahmen', unit: 'cm', get: () => a.boardVis != null ? a.boardVis : 1, set: v => a.boardVis = v, min: 0, max: 12, step: 0.5 },
    { k: 'boardProtrude', label: 'Brett über Aussenschicht (+/−)', unit: 'cm', get: () => a.boardProtrude || 0, set: v => a.boardProtrude = v, min: -10, max: 20, step: 0.5 },
    { k: 'outerLap', label: 'Aussen (Dämmung über Rahmen)', unit: 'cm', get: () => cm(a.outerLap != null ? a.outerLap : cmToPts(3)), set: v => a.outerLap = cmToPts(v), min: 0, max: 20, step: 0.5 },
    { k: 'innerReveal', label: 'Innen (Putz reingezogen)', unit: 'cm', get: () => cm(a.innerReveal != null ? a.innerReveal : cmToPts(2)), set: v => a.innerReveal = cmToPts(v), min: 0, max: 20, step: 0.5 },
    { k: 'bankOver', label: 'Fensterbank Überstand', unit: 'cm', get: () => a.bankOver != null ? a.bankOver : 4, set: v => a.bankOver = v, min: 0, max: 15, step: 0.5, when: () => a.kind === 'window' && a.bank !== false },
    { k: 'anschlagDepth', label: 'Anschlagtiefe', unit: 'cm', get: () => cm(a.anschlagDepth != null ? a.anschlagDepth : cmToPts(5)), set: v => a.anschlagDepth = cmToPts(v), min: 0, max: 20, step: 0.5, when: () => a.anschlagType && a.anschlagType !== 'none' },
    { k: 'nicheH', label: 'Storenkasten Höhe', unit: 'cm', get: () => cm(a.nicheH != null ? a.nicheH : cmToPts(28)), set: v => a.nicheH = cmToPts(v), min: 10, max: 45, step: 1, when: () => a.kind === 'window' && a.niche },
    { k: 'nicheD', label: 'Storenkasten Tiefe', unit: 'cm', get: () => cm(a.nicheD != null ? a.nicheD : cmToPts(13)), set: v => a.nicheD = cmToPts(v), min: 8, max: 30, step: 1, when: () => a.kind === 'window' && a.niche }
  ];
  let scale = 1;
  function geom() {
    const sa = Object.assign({}, a, { x: cx, y: cy, ang: 0, wallId: 'labw' });
    const sw = wall ? Object.assign({}, wall, { id: 'labw', x1: cx, y1: cy - 4000, x2: cx, y2: cy + 4000 }) : null;
    const layered = !!(sw && sw.layers && sw.layers.length >= 2);
    const reveal = sw ? openingRevealStrips(sa, [sw]) : [];
    const parts = openingParts(sa, layered);
    return { sa, reveal, parts };
  }
  function render() {
    svg.innerHTML = '';
    for (const an of (getAnnos(pv.num) || [])) { if (!layerVisible(an) || !phaseVisible(an)) continue; try { drawOne(svg, an, pv); } catch (_) { } }   // echter Planausschnitt: Wand + dieses Fenster + Nachbarn
    const ang = a.ang || 0, ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux, hw = a.w / 2, ht = (a.thick || wallThickPts()) / 2;
    const rc = (sv, mv) => [a.x + ux * hw * sv + nx * ht * mv, a.y + uy * hw * sv + ny * ht * mv];   // echte Fensterkoordinaten
    if (!vbG) { const cs = [rc(-1.7, -1.7), rc(1.7, -1.7), rc(1.7, 1.7), rc(-1.7, 1.7)]; const X0 = Math.min(...cs.map(c => c[0])), X1 = Math.max(...cs.map(c => c[0])), Y0 = Math.min(...cs.map(c => c[1])), Y1 = Math.max(...cs.map(c => c[1])), m = Math.max(X1 - X0, Y1 - Y0) * 0.12 + 10; vbG = { x: X0 - m, y: Y0 - m, w: (X1 - X0) + 2 * m, h: (Y1 - Y0) + 2 * m }; }
    svg.setAttribute('viewBox', vbStr(vbG));
    scale = vbG.w / (svg.clientWidth || (W * 0.6));
    if (wall && wall.layers && wall.layers.length) {   // Wandschichten klickbar: transparente Overlays je Schicht-Band → Auswahl + Inline-Editor
      try { const bands = wallLayerBands(wall, arr).bands; bands.forEach((b, i) => { const onSel = selLayer && selLayer.kind === 'wall' && selLayer.i === i; const pg = svgEl('polygon', { points: b.poly.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' '), fill: onSel ? 'rgba(42,168,105,0.22)' : 'transparent', stroke: onSel ? '#2aa869' : 'none', 'stroke-width': onSel ? 2 : 0, 'vector-effect': 'non-scaling-stroke' }); pg.style.cursor = 'pointer'; pg.onclick = e => { e.stopPropagation(); selLayer = onSel ? null : { kind: 'wall', i }; buildCtrls(); render(); }; svg.appendChild(pg); }); } catch (_) { }
    }
    const depth = a.depth == null ? 0.5 : a.depth, md = depth * 2 - 1;
    const fdh = Math.min(0.49, (a.frameD || cmToPts(7)) / (2 * ht)), fmB = Math.min(1, md + fdh), fmA = Math.max(-1, md - fdh);
    const fwSr = Math.min(0.45, (a.frameW || cmToPts(10)) / hw), boardVis = (a.boardVis != null ? a.boardVis : 1), boardW = (a.boardW != null ? a.boardW : 2.5);
    const HG = (p, id, lbl, val) => { const hx = p[0], hy = p[1]; return '<g class="lab-h" data-h="' + id + '"><circle cx="' + hx.toFixed(1) + '" cy="' + hy.toFixed(1) + '" r="' + (6 * scale) + '" /><title>' + lbl + (val ? ' · ' + val : '') + '</title></g>' + (val ? '<text x="' + (hx + 8.5 * scale) + '" y="' + (hy + 3.2 * scale) + '" font-size="' + (9 * scale) + '" fill="#1f7a4d" font-weight="700" style="pointer-events:none;paint-order:stroke" stroke="#fff" stroke-width="' + (2.4 * scale) + '">' + val + '</text>' : ''); };
    const cmv = pts => (Math.round(ptsToCm(pts) * 10) / 10).toString().replace('.', ',');
    const ln = (p1, p2) => '<line x1="' + p1[0].toFixed(1) + '" y1="' + p1[1].toFixed(1) + '" x2="' + p2[0].toFixed(1) + '" y2="' + p2[1].toFixed(1) + '" stroke="#1c242c" stroke-width="' + (0.6 * scale) + '"/>';
    const dimSeg = (p1, p2, td, label) => { const t = 4 * scale; let d = ln(p1, p2); for (const pp of [p1, p2]) d += ln([pp[0] - td[0] * t, pp[1] - td[1] * t], [pp[0] + td[0] * t, pp[1] + td[1] * t]); const mx2 = (p1[0] + p2[0]) / 2 + td[0] * 8 * scale, my2 = (p1[1] + p2[1]) / 2 + td[1] * 8 * scale; return d + '<text x="' + mx2.toFixed(1) + '" y="' + my2.toFixed(1) + '" font-size="' + (9 * scale) + '" fill="#1c242c" text-anchor="middle" style="paint-order:stroke" stroke="#fff" stroke-width="' + (2.2 * scale) + '">' + label + '</text>'; };
    const dimStr = (P1, P2, n, off, label, key) => {   // durchlaufende, verschiebbare Masslinie als SVG-String
      const e = 3 * scale, q1 = [P1[0] + n[0] * off, P1[1] + n[1] * off], q2 = [P2[0] + n[0] * off, P2[1] + n[1] * off];
      let s = ln([P1[0] + n[0] * e, P1[1] + n[1] * e], [q1[0] + n[0] * e, q1[1] + n[1] * e]) + ln([P2[0] + n[0] * e, P2[1] + n[1] * e], [q2[0] + n[0] * e, q2[1] + n[1] * e]) + ln(q1, q2);
      const dx = q2[0] - q1[0], dy = q2[1] - q1[1], dl = Math.hypot(dx, dy) || 1, tx = dx / dl, ty = dy / dl, t = 3.2 * scale;
      for (const q of [q1, q2]) s += ln([q[0] - ty * t, q[1] + tx * t], [q[0] + ty * t, q[1] - tx * t]);
      const mx2 = (q1[0] + q2[0]) / 2, my2 = (q1[1] + q2[1]) / 2;
      s += '<text x="' + (mx2 + n[0] * 7 * scale).toFixed(1) + '" y="' + (my2 + n[1] * 7 * scale + 3.5 * scale).toFixed(1) + '" font-size="' + (9 * scale) + '" fill="#1c242c" text-anchor="middle" style="paint-order:stroke" stroke="#fff" stroke-width="' + (2.2 * scale) + '">' + label + '</text>';
      s += '<circle class="lab-dh" data-key="' + key + '" data-nx="' + n[0] + '" data-ny="' + n[1] + '" cx="' + mx2.toFixed(1) + '" cy="' + my2.toFixed(1) + '" r="' + (5 * scale) + '"/>';
      return s;
    };
    const lapTotG = Math.min(hw * 0.92, openLichtInset(a)), rfG = Math.min(0.92, lapTotG / hw);   // Lichtmass = STANDARD am Rahmen (frameW−1cm), reagiert wenn Laibung tiefer einragt – gleiche Quelle wie Plan-Maßkette
    let H = '';
    H += dimSeg(rc(1.18, -1), rc(1.18, 1), [ux, uy], cmv(a.thick || wallThickPts()) + ' cm');     // Wanddicke
    H += dimSeg(rc(1.34, fmA), rc(1.34, fmB), [ux, uy], cmv(a.frameD || cmToPts(7)) + ' cm');      // Rahmentiefe
    H += dimStr(rc(-1, 1), rc(1, 1), [nx, ny], doff('gndRoh'), 'Rohbau ' + fmtLen(a.w), 'gndRoh');                                   // Breite Rohbau (aussen)
    H += dimStr(rc(-1 + rfG, 1), rc(1 - rfG, 1), [nx, ny], doff('gndLicht'), 'Licht ' + fmtLen(Math.max(2, a.w - 2 * lapTotG)), 'gndLicht');   // Breite Licht
    H += HG(rc(1, md), 'depth', 'Einbautiefe (ziehen)', Math.round(depth * 100) + '%');
    H += HG(rc(1 - fwSr / 2, fmB), 'frameD', 'Rahmentiefe (ziehen)', cmv(a.frameD || cmToPts(7)) + ' cm');
    H += HG(rc(1 - fwSr, md), 'frameW', 'Rahmenbreite (ziehen)', cmv(a.frameW || cmToPts(a.kind === 'door' ? 6 : 10)) + ' cm');
    if (a.anschlagType && a.anschlagType !== 'none') H += HG(rc(Math.max(0, 1 - fwSr - cmToPts(a.anschlagDepth != null ? a.anschlagDepth : cmToPts(5)) / hw), a.anschlagType === 'innen' ? -0.6 : 0.85), 'anschlag', 'Anschlagtiefe (ziehen)', cmv(a.anschlagDepth != null ? a.anschlagDepth : cmToPts(5)) + ' cm');
    svg.insertAdjacentHTML('beforeend', H);
    bindHandles();
    bindDim(svg, () => vbG, render);
    renderSec();
    renderElev(svgAo, 'a', () => vbAo, v => { vbAo = v; });
    renderElev(svgAi, 'i', () => vbAi, v => { vbAi = v; });
  }
  function primStr(out, scS) {   // Schnitt-/Ansicht-Primitive → SVG-String
    let s = '';
    for (const p of out) {
      if (p.t === 'rect') s += '<rect x="' + Math.min(p.x, p.x + p.w) + '" y="' + Math.min(p.y, p.y + p.h) + '" width="' + Math.abs(p.w) + '" height="' + Math.abs(p.h) + '" fill="' + (p.fill || 'none') + '" stroke="' + ((p.stroke && p.stroke !== 'none') ? p.stroke : 'none') + '" stroke-width="' + (p.sw || 0.6) + '" vector-effect="non-scaling-stroke"/>';
      else if (p.t === 'poly') s += '<polygon points="' + p.pts.map(q => q[0].toFixed(1) + ',' + q[1].toFixed(1)).join(' ') + '" fill="' + (p.fill || 'none') + '" stroke="' + ((p.stroke && p.stroke !== 'none') ? p.stroke : 'none') + '" stroke-width="' + (p.sw || 0.6) + '" vector-effect="non-scaling-stroke"/>';
      else if (p.t === 'line') s += '<line x1="' + p.x1 + '" y1="' + p.y1 + '" x2="' + p.x2 + '" y2="' + p.y2 + '" stroke="' + (p.stroke || '#1c242c') + '" stroke-width="' + (p.w || 1) + '" vector-effect="non-scaling-stroke"' + (p.dash ? ' stroke-dasharray="' + p.dash + '"' : '') + '/>';
      else if (p.t === 'arrow') { const sa = 6, ang = Math.atan2(p.dy, p.dx); for (const da of [2.5, -2.5]) s += '<line x1="' + p.x + '" y1="' + p.y + '" x2="' + (p.x - Math.cos(ang + da) * sa) + '" y2="' + (p.y - Math.sin(ang + da) * sa) + '" stroke="' + (p.col || '#1c242c') + '" stroke-width="1.2" vector-effect="non-scaling-stroke"/>'; }
      else if (p.t === 'text') s += '<text x="' + p.x + '" y="' + p.y + '" font-size="' + ((p.size || (p.small ? 9 : 11)) * scS) + '" fill="' + (p.col || '#1c242c') + '"' + (p.mid ? ' text-anchor="middle" dominant-baseline="middle"' : '') + (p.ang ? ' transform="rotate(' + p.ang.toFixed(1) + ' ' + p.x + ' ' + p.y + ')"' : '') + ' style="paint-order:stroke" stroke="#fff" stroke-width="' + (2.2 * scS) + '">' + (p.text || '').replace(/[<>&]/g, '') + '</text>';
      else if (p.t === 'dh') s += '<circle class="lab-dh" data-key="' + p.key + '" data-nx="' + p.nx + '" data-ny="' + p.ny + '" cx="' + p.x + '" cy="' + p.y + '" r="' + (5 * scS) + '"/>';
    }
    return s;
  }
  function drawPrims(el, out, getVb, setVb) {   // Bbox einpassen (einmal) + zeichnen
    let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity; const acc = (x, y) => { if (x < mnx) mnx = x; if (y < mny) mny = y; if (x > mxx) mxx = x; if (y > mxy) mxy = y; };
    for (const p of out) { if (p.t === 'rect') { acc(p.x, p.y); acc(p.x + p.w, p.y + p.h); } else if (p.t === 'poly') { for (const q of p.pts) acc(q[0], q[1]); } else if (p.t === 'line') { acc(p.x1, p.y1); acc(p.x2, p.y2); } else if (p.x != null) acc(p.x, p.y); }
    if (!isFinite(mnx)) { el.innerHTML = ''; return; }
    const pad = (mxx - mnx) * 0.14 + 12; mnx -= pad; mxx += pad; mny -= pad; mxy += pad;
    if (!getVb()) setVb({ x: mnx, y: mny, w: mxx - mnx, h: mxy - mny });
    const vb = getVb(); el.setAttribute('viewBox', vbStr(vb)); el.innerHTML = primStr(out, vb.w / (el.clientWidth || 320));
  }
  function renderSec() {   // Schnitt im Wandkontext: echte Schnitt-Engine an frei wählbarer Linie (Default = perpendikulär durchs Fenster)
    if (!docScale) { svgS.innerHTML = '<text x="10" y="22" font-size="13" fill="#9aa090">Für den Schnitt zuerst den Massstab setzen (1:n)</text>'; svgS.setAttribute('viewBox', '0 0 300 60'); return; }
    const ang = a.ang || 0, nx = -Math.sin(ang), ny = Math.cos(ang), ux = Math.cos(ang), uy = Math.sin(ang), L = (a.thick || wallThickPts()) * 1.7 + cmToPts(90);   // Schnittlinie quer durch die Wand
    const two = a.kind === 'window' && (a.winType === 'f2' || a.winType === 'f2s');
    const leafOff = (two && !secMullion) ? a.w / 4 : 0;   // 2-flügelig: Schnitt durch EINEN Flügel; Mittelstoss-Schnitt = mittig
    const ccx = a.x + ux * leafOff, ccy = a.y + uy * leafOff;
    const c1 = secLine ? secLine.c1 : [ccx - nx * L / 2, ccy - ny * L / 2], c2 = secLine ? secLine.c2 : [ccx + nx * L / 2, ccy + ny * L / 2];
    const tmp = { type: 'section', cx1: c1[0], cy1: c1[1], cx2: c2[0], cy2: c2[1], ox: 0, oy: 0, flip: secFlip, label: 'A', noPlanLine: true, noDims: true, mullion: (two && secMullion) };
    let out = []; try { out = sectionPrimitives(tmp, arr); } catch (_) { out = []; }
    const perPt = docScale.perPt, Yh = h => -h / perPt;   // eigene, verschiebbare Masslinien: innen Rohbau, aussen Licht (vertikal, versetzt)
    const head0 = Math.min((a.head != null ? a.head : (a.kind === 'window' ? 2.1 : 2.0)), (wall && wall.h3d) || wallHeightM), sill0 = a.kind === 'window' ? (a.sill || 0) : 0;
    const revM = ptsToCm(openLichtInset(a)) / 100;   // Lichtmass (Höhe) = STANDARD am Rahmen, reagiert wenn Laibung tiefer – gleiche Quelle wie Plan
    pushDim(out, [0, Yh(sill0)], [0, Yh(head0)], [-1, 0], doff('secRoh'), 'Rohbau ' + fmtLen((head0 - sill0) / perPt), 'secRoh');
    pushDim(out, [0, Yh(sill0 + revM)], [0, Yh(head0 - revM)], [-1, 0], doff('secLicht'), 'Licht ' + fmtLen(Math.max(0.02, head0 - sill0 - 2 * revM) / perPt), 'secLicht');
    drawPrims(svgS, out, () => vbS, v => { vbS = v; });
    bindDim(svgS, () => vbS, renderSec);
    if (wall && wall.layers && wall.layers.length) {   // Wandschichten im Schnitt klickbar (Index li aus slicePlane)
      try { const cl = Math.hypot(c2[0] - c1[0], c2[1] - c1[1]) || 1, fpp = d => secFlip ? cl - d : d; for (const r of slicePlane(elementSolids(wall, arr), { kind: 'v', p1: c1, p2: c2 })) { if (r.li == null) continue; const xa = fpp(r.d0), xb = fpp(r.d1), x = Math.min(xa, xb), w = Math.abs(xb - xa), y = -r.z1 / perPt, h = (r.z1 - r.z0) / perPt, onSel = selLayer && selLayer.kind === 'wall' && selLayer.i === r.li; if (w < 0.2 || h < 0.2) continue; const pg = svgEl('rect', { x: x.toFixed(1), y: y.toFixed(1), width: w.toFixed(1), height: h.toFixed(1), fill: onSel ? 'rgba(42,168,105,0.22)' : 'transparent', stroke: onSel ? '#2aa869' : 'none', 'stroke-width': onSel ? 2 : 0, 'vector-effect': 'non-scaling-stroke' }); pg.style.cursor = 'pointer'; pg.onclick = e => { e.stopPropagation(); selLayer = onSel ? null : { kind: 'wall', i: r.li }; buildCtrls(); render(); renderSec(); }; svgS.appendChild(pg); } } catch (_) { }
    }
  }
  function renderElev(el, side, getVb, setVb) {   // Ansicht innen/aussen – die ganze WAND mit allen Fenstern/Türen (Kontext), aktuelles markiert
    if (!docScale) { el.innerHTML = '<text x="10" y="22" font-size="13" fill="#9aa090">Massstab setzen (1:n)</text>'; el.setAttribute('viewBox', '0 0 300 60'); return; }
    const perPt = docScale.perPt, Yh = h => -h / perPt, out = [];
    const Hwall = (wall && wall.h3d) || wallHeightM;
    const x1 = wall ? wall.x1 : a.x - a.w / 2, y1 = wall ? wall.y1 : a.y, x2 = wall ? wall.x2 : a.x + a.w / 2, y2 = wall ? wall.y2 : a.y;
    const Lw = Math.hypot(x2 - x1, y2 - y1) || a.w, uxw = (x2 - x1) / Lw, uyw = (y2 - y1) / Lw, along = (px, py) => (px - x1) * uxw + (py - y1) * uyw, flip = side === 'i';
    const ops = wall ? arr.filter(o2 => o2.type === 'opening' && (o2.kind === 'window' || o2.kind === 'door') && o2.wallId === wall.id) : [a];
    if (!ops.length) ops.push(a);
    let curD = null;   // Geometrie des aktuellen Fensters für die Masslinien merken
    const wlys = (wall && wall.layers && wall.layers.length) ? wall.layers : null;   // Fassade SCHICHTWEISE (tiefensortiert): jede Schicht mit top/bot/ext + Sockelzone → Sichtkanten beim Schicht-Unterbruch
    if (wlys) { const idxs = side === 'i' ? [...wlys.keys()].reverse() : [...wlys.keys()];   // betrachtete Seite zuletzt (oben): innen → innerste vorne, aussen → äusserste vorne
      for (const i of idxs) { const L = wlys[i]; if (L.mat === 'luft') continue; const mt = WALL_MATS[L.mat] || {}, x = -(L.ext1 || 0), w = Lw + (L.ext1 || 0) + (L.ext2 || 0), top = Hwall + (L.top || 0), bot = 0 - (L.bot || 0);
        if (L.lowMat && L.lowH > 0) { const mlo = WALL_MATS[L.lowMat] || {}; out.push({ t: 'rect', x, y: Yh(L.lowH), w, h: Yh(bot) - Yh(L.lowH), fill: mlo.fill || '#eee', stroke: mlo.color || '#9aa08f', sw: 0.8 }); out.push({ t: 'rect', x, y: Yh(top), w, h: Yh(L.lowH) - Yh(top), fill: mt.fill || '#eee', stroke: mt.color || '#9aa08f', sw: 0.8 }); }   // Sockelzone (lowMat) unten, Hauptmaterial oben
        else out.push({ t: 'rect', x, y: Yh(top), w, h: Yh(bot) - Yh(top), fill: mt.fill || '#f3f1ec', stroke: mt.color || '#9aa08f', sw: 0.8 }); }
    } else out.push({ t: 'rect', x: 0, y: Yh(Hwall), w: Lw, h: Yh(0) - Yh(Hwall), fill: '#f3f1ec', stroke: '#9aa08f', sw: 1 });   // einschichtige Wand
    out.push({ t: 'line', x1: -10, y1: Yh(0), x2: Lw + 10, y2: Yh(0), stroke: '#1c242c', w: 1.8 });   // Boden / OK Terrain
    for (const o2 of ops) {
      const oo = side === 'i' ? Object.assign({}, o2, { winHinge: o2.winHinge === 'left' ? 'right' : o2.winHinge === 'right' ? 'left' : o2.winHinge, bank: false }) : Object.assign({}, o2, { niche: false });   // innen: Storenkasten zeigen, keine Aussenbank · aussen: Bank, kein Kasten
      const a0 = (wall ? along(o2.x, o2.y) : Lw / 2) - o2.w / 2, opx0 = flip ? (Lw - a0 - o2.w) : a0;
      const lapClad = side === 'i' ? (o2.innerReveal != null ? o2.innerReveal : cmToPts(2)) : (o2.outerLap != null ? o2.outerLap : cmToPts(3));
      const sillF = (o2.kind === 'window' ? (o2.sill || 0) : 0), headF = Math.min(Hwall, o2.head || (o2.kind === 'window' ? 2.1 : 2.0));
      const ring = openingRevealRing(o2, side, wall), rings = ring.mat ? [{ mat: ring.mat, w: ring.w }] : [];   // Ansicht: nur die SICHTBARE Deckschicht (Breite = Lappung, verdeckt dahinterliegende Schichten)
      let cum = 0;
      for (const rg of rings) { const mt = LINING_MAT[rg.mat] || WALL_MATS[rg.mat] || { fill: '#eee', color: '#1c242c' }, x = opx0 + cum, w = o2.w - 2 * cum, yT = Yh(headF - cum * perPt), yB = Yh(sillF); if (w > 1 && yB - yT > 0.5) out.push({ t: 'rect', x, y: yT, w, h: yB - yT, fill: mt.fill || '#eee', stroke: (mt.stroke || mt.color) || '#1c242c', sw: 0.7 }); cum += rg.w; }   // Laibung wickelt Sturz + Seiten; unten = Fensterbank (kein Doppel-Sims)
      const rPts = Math.min(cum, o2.w * 0.45);
      { const ow = Math.max(4, o2.w - 2 * rPts), cxs = opx0 + o2.w / 2; try { openingElevDraw(out, Object.assign({}, oo, { w: ow }), s => cxs + s, Yh); } catch (_) { } }   // Ansicht IMMER kanonisch (openingSolids + Öffnungsrichtung)
      if (side === 'i' && o2.kind === 'window') { const pjI = cmToPts(3), th = cmToPts(2.5); out.push({ t: 'rect', x: opx0 - pjI, y: Yh(sillF), w: o2.w + 2 * pjI, h: th, fill: '#e7cfa8', stroke: '#7a5126', sw: 0.8 }); }   // innen: Holz-Fensterbrett
      if (o2.id === a.id) { out.push({ t: 'rect', x: opx0 - 4, y: Yh(headF) - 4, w: o2.w + 8, h: (Yh(sillF) - Yh(headF)) + 8, fill: 'none', stroke: '#2aa869', sw: 2.4 }); curD = { opx0, w: o2.w, headF, sillF, rPts }; }   // aktuelles Fenster markiert
    }
    if (curD) {   // verschiebbare Masslinien: Breite (unten) + Höhe (links) – INNEN = Rohbaumass, AUSSEN = Fertig-/Lichtmass
      const roh = side === 'i', tag = roh ? 'Rohbau ' : 'Licht ', x0 = roh ? curD.opx0 : curD.opx0 + curD.rPts, w0 = roh ? curD.w : Math.max(2, curD.w - 2 * curD.rPts);
      const rM = ptsToCm(curD.rPts) / 100, hb = roh ? curD.sillF : curD.sillF + (curD.sillF > 0 ? rM : 0), htp = roh ? curD.headF : curD.headF - rM;
      pushDim(out, [x0, Yh(hb)], [x0 + w0, Yh(hb)], [0, 1], doff('elW'), tag + 'B ' + fmtLen(w0 / perPt), 'elW');
      pushDim(out, [x0, Yh(hb)], [x0, Yh(htp)], [-1, 0], doff('elH'), tag + 'H ' + fmtLen((htp - hb) / perPt), 'elH');
    }
    drawPrims(el, out, getVb, setVb);
    bindDim(el, getVb, () => renderElev(el, side, getVb, setVb));
  }
  function bindHandles() {
    svg.querySelectorAll('.lab-h').forEach(g => { g.onpointerdown = e => {
      e.preventDefault(); const id = g.dataset.h, hw = a.w / 2, ht = (a.thick || wallThickPts()) / 2;
      const sx = e.clientX, sy = e.clientY, d0 = a.depth == null ? 0.5 : a.depth, bw0 = a.boardW != null ? a.boardW : 2.5, an0 = a.anschlagDepth != null ? a.anschlagDepth : cmToPts(5), fd0 = a.frameD || cmToPts(7), fw0 = a.frameW || cmToPts(a.kind === 'door' ? 6 : 10);
      const ang = a.ang || 0, ux = Math.cos(ang), uy = Math.sin(ang), nx = -uy, ny = ux;
      const move = ev => {
        const dxp = (ev.clientX - sx) * scale, dyp = (ev.clientY - sy) * scale, ds = dxp * ux + dyp * uy, dm = dxp * nx + dyp * ny;   // auf Wandachse projizieren
        if (id === 'depth') a.depth = Math.max(0, Math.min(1, d0 + (dm / ht) / 2));
        else if (id === 'boardW') a.boardW = Math.max(0.5, Math.min(20, bw0 + ptsToCm(ds)));
        else if (id === 'anschlag') a.anschlagDepth = Math.max(0, Math.min(cmToPts(20), an0 - ds));
        else if (id === 'frameD') a.frameD = Math.max(cmToPts(2), Math.min(cmToPts(16), fd0 + 2 * dm));   // Rahmentiefe
        else if (id === 'frameW') a.frameW = Math.max(cmToPts(2), Math.min(cmToPts(20), fw0 - ds));        // Rahmenbreite
        render(); drawAnnos(pv);
      };
      const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); saveState(); };
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
    }; });
  }
  function buildCtrls() {
    side.innerHTML = '';
    const head = t => { const h = document.createElement('div'); h.className = 'lab-grp'; h.textContent = t; side.appendChild(h); };
    const sel = (label, opts, cur, cb) => { const w = document.createElement('label'); w.className = 'lab-row'; w.innerHTML = '<span>' + label + '</span>'; const s = document.createElement('select'); s.style.flex = '1'; s.innerHTML = opts.map(o => '<option value="' + o[0] + '"' + (o[0] === cur ? ' selected' : '') + '>' + o[1] + '</option>').join(''); s.value = cur; s.onchange = () => cb(s.value); w.appendChild(s); side.appendChild(w); };
    const fld = k => { const f = fields.find(x => x.k === k); if (!f || (f.when && !f.when())) return; const row = document.createElement('label'); row.className = 'lab-row'; row.innerHTML = '<span>' + f.label + '</span>'; const r = document.createElement('input'); r.type = 'range'; r.min = f.min; r.max = f.max; r.step = f.step; r.value = f.get(); r.style.flex = '1'; const num = document.createElement('input'); num.type = 'number'; num.min = f.min; num.max = f.max; num.step = f.step; num.value = f.get(); num.style.width = '54px'; r.oninput = () => { f.set(parseFloat(r.value)); num.value = f.get(); render(); drawAnnos(pv); }; r.onchange = () => saveState(); num.onchange = () => { const v = parseFloat((num.value || '').replace(',', '.')); if (isNaN(v)) return; f.set(v); r.value = f.get(); render(); drawAnnos(pv); saveState(); }; const u = document.createElement('b'); u.textContent = f.unit; u.style.minWidth = '16px'; r.style.flex = '1'; const line = document.createElement('div'); line.className = 'lab-line'; line.appendChild(r); line.appendChild(num); line.appendChild(u); row.appendChild(line); side.appendChild(row); };
    const win = a.kind === 'window';
    if (selLayer && selLayer.kind === 'wall' && wall && wall.layers && wall.layers[selLayer.i]) {   // im Bild angeklickte Wandschicht → Inline-Editor oben
      const L = wall.layers[selLayer.i], matOpts = Object.keys(WALL_MATS).map(k => [k, WALL_MATS[k].label || k]);
      head('▣ Wandschicht ' + (selLayer.i + 1) + ' (angeklickt)');
      sel('Material', matOpts, L.mat, v => { L.mat = v; render(); drawAnnos(pv); saveState(); });
      { const row = document.createElement('label'); row.className = 'lab-row'; row.innerHTML = '<span>Dicke</span>'; const line = document.createElement('div'); line.className = 'lab-line'; const num = document.createElement('input'); num.type = 'number'; num.min = '0.2'; num.max = '60'; num.step = '0.5'; num.value = Math.round(ptsToCm(L.t) * 10) / 10; num.style.width = '64px'; const u = document.createElement('b'); u.textContent = 'cm'; num.onchange = () => { const v = parseFloat((num.value || '').replace(',', '.')); if (v > 0) { L.t = cmToPts(v); wall.thick = wall.layers.reduce((s, l) => s + l.t, 0); a.thick = wall.thick; render(); drawAnnos(pv); saveState(); } }; line.appendChild(num); line.appendChild(u); row.appendChild(line); side.appendChild(row); }
      { const bar = document.createElement('div'); bar.className = 'lab-line'; bar.style.gap = '4px'; const full = document.createElement('button'); full.className = 'btn'; full.textContent = '▦ Voller Wandaufbau'; full.style.flex = '1'; full.onclick = () => openBuildPop(wall, () => { render(); buildCtrls(); drawAnnos(pv); }); const ds = document.createElement('button'); ds.className = 'btn'; ds.textContent = '✕ Abwählen'; ds.style.flex = '1'; ds.onclick = () => { selLayer = null; buildCtrls(); render(); }; bar.appendChild(full); bar.appendChild(ds); side.appendChild(bar); }
    }
    head('Schnitt');
    { const tw = document.createElement('label'); tw.className = 'lab-row'; tw.style.cssText = 'flex-direction:row;align-items:center;gap:7px'; const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = secFlip; const sp = document.createElement('span'); sp.textContent = 'Blickrichtung drehen (innen ⇄ aussen)'; cb.onchange = () => { secFlip = cb.checked; renderSec(); }; tw.appendChild(cb); tw.appendChild(sp); side.appendChild(tw); }
    if (win && (a.winType === 'f2' || a.winType === 'f2s')) { const tw = document.createElement('label'); tw.className = 'lab-row'; tw.style.cssText = 'flex-direction:row;align-items:center;gap:7px'; const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = secMullion; const sp = document.createElement('span'); sp.textContent = 'Schnitt durch Mittelstoss (Setzholz)'; cb.onchange = () => { secMullion = cb.checked; renderSec(); }; tw.appendChild(cb); tw.appendChild(sp); side.appendChild(tw); }
    head(win ? 'Fenster' : 'Tür');
    sel('Typ', win ? [['f1', '1-flügelig'], ['f2', '2-flügelig (bündig)'], ['f2s', '2-fl. + Setzholz'], ['fest', 'Fest verglast']] : [['f1', '1-flügelig'], ['f2', '2-flügelig'], ['fest', 'Fest'], ['f1f', '1-fl. + Fixteil']], a.winType || 'f1', v => { a.winType = v; render(); drawAnnos(pv); saveState(); });
    sel('Material', [['holz', 'Holz'], ['metall', 'Metall'], ['kunst', 'Kunststoff']], a.winMat || 'holz', v => { a.winMat = v; render(); drawAnnos(pv); saveState(); });
    fld('frameW'); fld('frameD'); fld('sashW'); fld('sashD'); fld('sashShift');
    head('Einbau / Montage');
    sel('Montageart', [['', '– frei –'], ['aussen', 'Innen ans Mauerwerk'], ['laibung', 'In der Laibung'], ['innen', 'Aussen auf Konstruktion']], a.mountMode || '', v => { a.mountMode = v; if (v) applyMountPreset(a, v); render(); buildCtrls(); drawAnnos(pv); saveState(); });
    fld('depth');
    head('Anschlag');
    sel('Anschlag', [['none', 'Kein'], ['aussen', 'Innen'], ['innen', 'Aussen']], a.anschlagType || 'none', v => { a.anschlagType = v; render(); buildCtrls(); drawAnnos(pv); saveState(); });
    fld('anschlagDepth');
    head('Laibung');
    { const note = document.createElement('div'); note.className = 'lab-row'; note.innerHTML = '<span style="color:#7a8366">Innen/Außen kommt aus dem Wandaufbau (Schichten innen→außen). Standard: die Deckschicht wickelt um die Ecke; für vollen Aufbau die Laibung je Kante/Seite anlegen.</span>'; side.appendChild(note); }
    const redrawAll = () => { render(); renderSec(); renderElev(svgAo, 'a', () => vbAo, v => { vbAo = v; }); renderElev(svgAi, 'i', () => vbAi, v => { vbAi = v; }); };
    const EDGES = [['all', 'Alle'], ['L', 'Links'], ['R', 'Rechts'], ['T', 'Sturz'], ['B', 'Schwelle']];
    const revealEditor = (prop, label) => {   // Laibung je Seite (innen=revealLining / aussen=revealLiningOut), pro Kante (editEdge) eigene Liste
      const sideKey = prop === 'revealLining' ? 'in' : 'out', matOpts = Object.keys(WALL_MATS).map(k => [k, WALL_MATS[k].label || k]);
      const getRL = () => editEdge === 'all' ? a[prop] : (a.reveals && a.reveals[editEdge] ? a.reveals[editEdge][sideKey] : null);
      const setRL = v => { if (editEdge === 'all') a[prop] = v; else { a.reveals = a.reveals || {}; a.reveals[editEdge] = a.reveals[editEdge] || {}; a.reveals[editEdge][sideKey] = v; } };
      const prefill = () => { const ls = (wall && wall.layers && wall.layers.length) ? wall.layers : null, pick = ls ? (sideKey === 'out' ? ls[ls.length - 1] : ls[0]) : { mat: 'putz', t: cmToPts(1.5) }; return [{ mat: pick.mat, t: Math.round(ptsToCm(pick.t || cmToPts(1.5)) * 10) / 10 }]; };
      let RL = getRL();
      if (editEdge !== 'all' && (!Array.isArray(RL) || !RL.length)) { const base = Array.isArray(a[prop]) && a[prop].length ? a[prop].map(L => Object.assign({}, L)) : prefill(); setRL(base); RL = getRL(); }   // Kante sofort editierbar: aus Standard vorbefüllen
      if (!Array.isArray(RL) || !RL.length) {
        const b = document.createElement('button'); b.className = 'btn'; b.textContent = '⊞ ' + label + (editEdge === 'all' ? '' : ' (' + EDGES.find(e => e[0] === editEdge)[1] + ')'); b.style.cssText = 'width:100%;margin:5px 0 2px'; b.title = 'Eigene Laibungsschichten – Start = Wandschichten, danach frei';
        b.onclick = () => { setRL(prefill()); redrawAll(); buildCtrls(); drawAnnos(pv); saveState(); }; side.appendChild(b); return;
      }
      const hint = document.createElement('div'); hint.className = 'lab-row'; hint.innerHTML = '<span style="color:#46503f"><b style="color:#34502b">' + label + '</b> · Deckschicht zuerst · Abstand = Luftspalt davor</span>'; side.appendChild(hint);
      RL.forEach((L, i) => {
        const row = document.createElement('div'); row.className = 'lab-row'; row.style.cssText = 'border-left:3px solid #c9d4bd;padding-left:7px;margin-bottom:2px';
        const l1 = document.createElement('div'); l1.className = 'lab-line';
        const ms = document.createElement('select'); ms.style.flex = '1'; matOpts.forEach(([k, lab]) => { const o = document.createElement('option'); o.value = k; o.textContent = lab; if (k === L.mat) o.selected = true; ms.appendChild(o); }); ms.onchange = () => { L.mat = ms.value; redrawAll(); drawAnnos(pv); saveState(); };
        const tn = document.createElement('input'); tn.type = 'number'; tn.min = '0.1'; tn.max = '30'; tn.step = '0.1'; tn.value = L.t; tn.style.width = '46px'; tn.title = 'Dicke (cm)'; tn.onchange = () => { const v = parseFloat((tn.value || '').replace(',', '.')); if (v > 0) { L.t = v; redrawAll(); drawAnnos(pv); saveState(); } };
        const gp = document.createElement('input'); gp.type = 'number'; gp.min = '0'; gp.max = '20'; gp.step = '0.5'; gp.value = (L.gap || 0); gp.style.width = '40px'; gp.title = 'Abstand/Luftspalt vor dieser Schicht (cm)'; gp.onchange = () => { const v = parseFloat((gp.value || '').replace(',', '.')); L.gap = isNaN(v) ? 0 : v; redrawAll(); drawAnnos(pv); saveState(); };
        const pr = document.createElement('input'); pr.type = 'number'; pr.min = '1'; pr.max = '9'; pr.step = '1'; pr.value = (L.prio != null ? L.prio : 2); pr.style.width = '34px'; pr.title = 'Priorität: höher = reicht zum Rahmen, niedriger endet davor (z. B. Brett > Putz)'; pr.onchange = () => { const v = parseInt(pr.value); L.prio = isNaN(v) ? 2 : v; redrawAll(); drawAnnos(pv); saveState(); };
        const del = document.createElement('button'); del.className = 'btn'; del.textContent = '✕'; del.style.cssText = 'padding:0 8px'; del.title = 'Schicht löschen'; del.onclick = () => { RL.splice(i, 1); if (!RL.length) setRL(null); redrawAll(); buildCtrls(); drawAnnos(pv); saveState(); };
        l1.appendChild(ms); l1.appendChild(tn); const gl = document.createElement('span'); gl.textContent = '⊥'; gl.style.cssText = 'font-size:10px;color:#7a8366'; l1.appendChild(gl); l1.appendChild(gp); const pl2 = document.createElement('span'); pl2.textContent = '★'; pl2.style.cssText = 'font-size:10px;color:#7a8366'; l1.appendChild(pl2); l1.appendChild(pr); l1.appendChild(del); row.appendChild(l1); side.appendChild(row);
      });
      const bar = document.createElement('div'); bar.className = 'lab-line'; bar.style.gap = '4px';
      const add = document.createElement('button'); add.className = 'btn'; add.textContent = '+ Schicht'; add.style.flex = '1'; add.onclick = () => { RL.push({ mat: 'putz', t: 1 }); redrawAll(); buildCtrls(); drawAnnos(pv); saveState(); };
      const wb = document.createElement('button'); wb.className = 'btn'; wb.textContent = '⟳ Wand'; wb.style.flex = '1'; wb.title = 'Aus den Wandschichten neu übernehmen'; wb.onclick = () => { setRL(prefill()); redrawAll(); buildCtrls(); drawAnnos(pv); saveState(); };
      bar.appendChild(add); bar.appendChild(wb); side.appendChild(bar);
      const rs = document.createElement('button'); rs.className = 'btn'; rs.textContent = 'Zurücksetzen'; rs.style.cssText = 'width:100%;margin-top:3px'; rs.onclick = () => { setRL(null); redrawAll(); buildCtrls(); drawAnnos(pv); saveState(); }; side.appendChild(rs);
    };
    { head('Rahmen ↔ Laibung');
      const info = document.createElement('div'); info.className = 'lab-row'; info.style.cssText = 'font-size:11px;color:#3a4150;line-height:1.6;margin-bottom:2px';
      const upd = () => { const fw = ptsToCm(a.frameW || cmToPts(10)), bv = a.boardVis != null ? a.boardVis : 1, lap = Math.max(0, fw - bv); info.innerHTML = 'Rahmen <b>' + fw.toFixed(1) + ' cm</b> · davon sichtbar <b>' + bv.toFixed(1) + ' cm</b> · Laibung deckt <b>' + lap.toFixed(1) + ' cm</b>'; };
      upd(); side.appendChild(info);
      const row = document.createElement('div'); row.className = 'lab-line';
      const lb = document.createElement('span'); lb.textContent = 'Rahmen sichtbar (cm)'; lb.style.cssText = 'font-size:11px;color:#7a8366;flex:1';
      const inp = document.createElement('input'); inp.type = 'number'; inp.min = '0'; inp.max = '30'; inp.step = '0.5'; inp.value = (a.boardVis != null ? a.boardVis : 1); inp.style.width = '54px'; inp.title = 'Wie viel cm vom Rahmen sichtbar bleiben – Rest deckt die Laibung';
      inp.onchange = () => { const v = parseFloat((inp.value || '').replace(',', '.')); a.boardVis = isNaN(v) ? 1 : Math.max(0, v); upd(); redrawAll(); drawAnnos(pv); saveState(); };
      row.appendChild(lb); row.appendChild(inp); side.appendChild(row);
    }
    { const pick = document.createElement('div'); pick.className = 'lab-line'; pick.style.cssText = 'flex-wrap:wrap;gap:3px;margin:4px 0 2px';
      const pl = document.createElement('span'); pl.textContent = 'Kante:'; pl.style.cssText = 'font-size:11px;color:#7a8366;align-self:center'; pick.appendChild(pl);
      EDGES.forEach(([k, lab]) => { const b = document.createElement('button'); b.className = 'btn' + (editEdge === k ? ' on' : ''); b.textContent = lab; b.style.cssText = 'flex:1;min-width:48px;padding:3px 4px' + (editEdge === k ? ';background:#2aa869;color:#fff' : ''); b.onclick = () => { editEdge = k; buildCtrls(); }; pick.appendChild(b); });
      side.appendChild(pick);
      const en = document.createElement('div'); en.className = 'lab-row'; en.innerHTML = '<span style="color:#7a8366;font-size:11px">' + (editEdge === 'all' ? 'Gilt für alle Kanten (Standard). Wähle eine Kante für eigene Schichten.' : 'Nur Kante <b>' + EDGES.find(e => e[0] === editEdge)[1] + '</b>. „Alle" = gemeinsamer Standard.') + '</span>'; side.appendChild(en);
      if (editEdge !== 'all') {   // schräge Laibung je Kante
        const sr = document.createElement('div'); sr.className = 'lab-line';
        const sl = document.createElement('span'); sl.textContent = 'Schräg (cm)'; sl.style.cssText = 'font-size:11px;color:#7a8366;flex:1';
        const si = document.createElement('input'); si.type = 'number'; si.min = '-20'; si.max = '20'; si.step = '0.5'; si.value = ((a.reveals && a.reveals[editEdge] && a.reveals[editEdge].slope) || 0); si.style.width = '54px'; si.title = 'Neigung der Laibung: Versatz am Wandflächen-Ende (cm). + = öffnet zur Wandfläche hin (Splay), − = umgekehrt';
        si.onchange = () => { const v = parseFloat((si.value || '').replace(',', '.')); a.reveals = a.reveals || {}; a.reveals[editEdge] = a.reveals[editEdge] || {}; a.reveals[editEdge].slope = isNaN(v) ? 0 : v; redrawAll(); drawAnnos(pv); saveState(); };
        sr.appendChild(sl); sr.appendChild(si); side.appendChild(sr);
      }
    }
    revealEditor('revealLining', 'Laibung innen');
    revealEditor('revealLiningOut', 'Laibung aussen');
    if (win) {
      head('Fensterbank / Sims');
      const tw = document.createElement('label'); tw.className = 'lab-row'; tw.style.cssText = 'flex-direction:row;align-items:center;gap:7px'; const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = a.bank !== false; const sp = document.createElement('span'); sp.textContent = 'Fensterbank (aussen)'; cb.onchange = () => { a.bank = cb.checked; render(); buildCtrls(); drawAnnos(pv); saveState(); }; tw.appendChild(cb); tw.appendChild(sp); side.appendChild(tw);
      { const ts = document.createElement('label'); ts.className = 'lab-row'; ts.style.cssText = 'flex-direction:row;align-items:center;gap:7px'; const cs = document.createElement('input'); cs.type = 'checkbox'; cs.checked = !!a.sims; const sps = document.createElement('span'); sps.textContent = 'Fenstersims (innen, gerade)'; cs.onchange = () => { a.sims = cs.checked; redrawAll(); buildCtrls(); drawAnnos(pv); saveState(); }; ts.appendChild(cs); ts.appendChild(sps); side.appendChild(ts); }
      if (a.bank !== false || a.sims) {   // Fensterbank/Sims-AUFBAU (Schichten, oben = Oberkante an der Schwelle) – editierbar wie die Laibung
        if (!Array.isArray(a.bankLayers) || !a.bankLayers.length) a.bankLayers = [{ mat: a.bankMat || 'metall', t: 2.5 }];
        const RL = a.bankLayers, bmatOpts = [['metall', 'Metallblech'], ['holz', 'Holz'], ['beton', 'Beton/Stein']].concat(Object.keys(WALL_MATS).map(k => [k, WALL_MATS[k].label || k]));
        const hint = document.createElement('div'); hint.className = 'lab-row'; hint.innerHTML = '<span style="color:#46503f"><b style="color:#34502b">Bank-Aufbau</b> · oberste = OK Schwelle</span>'; side.appendChild(hint);
        RL.forEach((L, i) => { const row = document.createElement('div'); row.className = 'lab-line';
          const ms = document.createElement('select'); ms.style.flex = '1'; bmatOpts.forEach(([k, lab]) => { const o = document.createElement('option'); o.value = k; o.textContent = lab; if (k === L.mat) o.selected = true; ms.appendChild(o); }); ms.onchange = () => { L.mat = ms.value; redrawAll(); drawAnnos(pv); saveState(); };
          const tn = document.createElement('input'); tn.type = 'number'; tn.min = '0.2'; tn.max = '20'; tn.step = '0.1'; tn.value = L.t; tn.style.width = '48px'; tn.title = 'Dicke (cm)'; tn.onchange = () => { const v = parseFloat((tn.value || '').replace(',', '.')); if (v > 0) { L.t = v; redrawAll(); drawAnnos(pv); saveState(); } };
          const del = document.createElement('button'); del.className = 'btn'; del.textContent = '✕'; del.style.cssText = 'padding:0 8px'; del.onclick = () => { RL.splice(i, 1); if (!RL.length) a.bankLayers = [{ mat: 'metall', t: 2.5 }]; redrawAll(); buildCtrls(); drawAnnos(pv); saveState(); };
          row.appendChild(ms); row.appendChild(tn); row.appendChild(del); side.appendChild(row); });
        const ab = document.createElement('button'); ab.className = 'btn'; ab.textContent = '+ Schicht'; ab.style.cssText = 'width:100%;margin:2px 0'; ab.onclick = () => { RL.push({ mat: 'beton', t: 2 }); redrawAll(); buildCtrls(); drawAnnos(pv); saveState(); }; side.appendChild(ab);
        fld('bankOver');
      }
      const tn = document.createElement('label'); tn.className = 'lab-row'; tn.style.cssText = 'flex-direction:row;align-items:center;gap:7px'; const cbn = document.createElement('input'); cbn.type = 'checkbox'; cbn.checked = !!a.niche; const spn = document.createElement('span'); spn.textContent = 'Storenkasten (innen, über Sturz)'; cbn.onchange = () => { a.niche = cbn.checked; render(); buildCtrls(); drawAnnos(pv); saveState(); }; tn.appendChild(cbn); tn.appendChild(spn); side.appendChild(tn);
      if (a.niche) { fld('nicheH'); fld('nicheD'); }
    } else if (a.kind === 'door') {
      head('Türschwelle');
      if (!Array.isArray(a.sillLayers) || !a.sillLayers.length) a.sillLayers = [{ mat: a.thresholdMat || 'holz', t: 2.5 }];
      const RL = a.sillLayers, bmatOpts = [['holz', 'Holz'], ['metall', 'Metallschiene'], ['beton', 'Beton/Stein']].concat(Object.keys(WALL_MATS).map(k => [k, WALL_MATS[k].label || k]));
      const hint = document.createElement('div'); hint.className = 'lab-row'; hint.innerHTML = '<span style="color:#46503f"><b style="color:#34502b">Schwellen-Aufbau</b> · vom Boden hoch</span>'; side.appendChild(hint);
      RL.forEach((L, i) => { const row = document.createElement('div'); row.className = 'lab-line';
        const ms = document.createElement('select'); ms.style.flex = '1'; bmatOpts.forEach(([k, lab]) => { const o = document.createElement('option'); o.value = k; o.textContent = lab; if (k === L.mat) o.selected = true; ms.appendChild(o); }); ms.onchange = () => { L.mat = ms.value; redrawAll(); drawAnnos(pv); saveState(); };
        const tn = document.createElement('input'); tn.type = 'number'; tn.min = '0.2'; tn.max = '20'; tn.step = '0.1'; tn.value = L.t; tn.style.width = '48px'; tn.title = 'Dicke (cm)'; tn.onchange = () => { const v = parseFloat((tn.value || '').replace(',', '.')); if (v > 0) { L.t = v; redrawAll(); drawAnnos(pv); saveState(); } };
        const del = document.createElement('button'); del.className = 'btn'; del.textContent = '✕'; del.style.cssText = 'padding:0 8px'; del.onclick = () => { RL.splice(i, 1); if (!RL.length) a.sillLayers = [{ mat: 'holz', t: 2.5 }]; redrawAll(); buildCtrls(); drawAnnos(pv); saveState(); };
        row.appendChild(ms); row.appendChild(tn); row.appendChild(del); side.appendChild(row); });
      const ab = document.createElement('button'); ab.className = 'btn'; ab.textContent = '+ Schicht'; ab.style.cssText = 'width:100%;margin-top:2px'; ab.onclick = () => { RL.push({ mat: 'beton', t: 2 }); redrawAll(); buildCtrls(); drawAnnos(pv); saveState(); }; side.appendChild(ab);
    }
    if (wall && wall.layers && wall.layers.length) {
      head('Wandschichten (innen → aussen)');
      const fullBtn = document.createElement('button'); fullBtn.className = 'btn'; fullBtn.textContent = '▦ Alle Schichten voll bearbeiten'; fullBtn.style.cssText = 'width:100%;margin:2px 0 6px'; fullBtn.onclick = () => openBuildPop(wall, () => { render(); buildCtrls(); }); side.appendChild(fullBtn);
      wall.layers.forEach(ly => {
        const row = document.createElement('label'); row.className = 'lab-row'; const nm = (WALL_MATS[ly.mat] && WALL_MATS[ly.mat].label) || ly.mat || 'Schicht'; row.innerHTML = '<span>' + nm + '</span>';
        const inp = document.createElement('input'); inp.type = 'number'; inp.step = '0.5'; inp.min = '0.1'; inp.style.width = '66px'; inp.value = Math.round(ptsToCm(ly.t) * 10) / 10;
        inp.oninput = () => { const v = parseFloat(inp.value); if (!(v > 0)) return; ly.t = cmToPts(v); wall.thick = wall.layers.reduce((s, l) => s + l.t, 0); a.thick = wall.thick; render(); drawAnnos(pv); };
        inp.onchange = () => saveState();
        const u = document.createElement('b'); u.textContent = 'cm'; row.appendChild(inp); row.appendChild(u); side.appendChild(row);
      });
    }
  }
  const close = () => { ov.remove(); document.removeEventListener('keydown', esc, true); drawAnnos(pv); saveState(); };
  const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } };
  document.addEventListener('keydown', esc, true); ov.querySelector('#labClose').onclick = close;
  navSetup(svg, () => vbG, v => { vbG = v; }, () => render());
  navSetup(svgS, () => vbS, v => { vbS = v; }, () => renderSec());
  navSetup(svgAo, () => vbAo, v => { vbAo = v; }, () => renderElev(svgAo, 'a', () => vbAo, v => { vbAo = v; }));
  navSetup(svgAi, () => vbAi, v => { vbAi = v; }, () => renderElev(svgAi, 'i', () => vbAi, v => { vbAi = v; }));
  const VIEW = { g: { get: () => vbG, set: v => { vbG = v; }, draw: () => render() }, s: { get: () => vbS, set: v => { vbS = v; }, draw: () => renderSec() }, ao: { get: () => vbAo, set: v => { vbAo = v; }, draw: () => renderElev(svgAo, 'a', () => vbAo, v => { vbAo = v; }) }, ai: { get: () => vbAi, set: v => { vbAi = v; }, draw: () => renderElev(svgAi, 'i', () => vbAi, v => { vbAi = v; }) } };
  { const fb = ov.querySelector('#labFit'); if (fb) fb.onclick = () => { vbG = vbS = vbAo = vbAi = null; render(); }; }
  const zoomVbC = (vb, f) => { if (!vb) return vb; const cx2 = vb.x + vb.w / 2, cy2 = vb.y + vb.h / 2, nw = Math.max(3, vb.w * f), nh = Math.max(3, vb.h * f); return { x: cx2 - nw / 2, y: cy2 - nh / 2, w: nw, h: nh }; };
  ov.querySelectorAll('.lab-zoom').forEach(tb => { const V = VIEW[tb.dataset.view]; if (!V) return; tb.querySelectorAll('button').forEach(b => b.onclick = e => { e.stopPropagation(); const z = b.dataset.z; if (z === 'fit') { V.set(null); V.draw(); return; } V.set(zoomVbC(V.get(), z === 'in' ? 1 / 1.25 : 1.25)); V.draw(); }); });
  { const stage = ov.querySelector('#labStage'), sv = ov.querySelector('#labSplitV'), sh = ov.querySelector('#labSplitH');   // verschiebbare Trennlinien – Ansichten bleiben aneinander
    const drag = (el, horiz) => { if (!el || !stage) return; el.addEventListener('pointerdown', e => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch (_) { } const mv = ev => { const r = stage.getBoundingClientRect(); if (horiz) { let w = ev.clientX - r.left - 9; w = Math.max(150, Math.min(r.width - 162, w)); stage.style.gridTemplateColumns = w + 'px 8px 1fr'; } else { let h = ev.clientY - r.top - 9; h = Math.max(120, Math.min(r.height - 132, h)); stage.style.gridTemplateRows = h + 'px 8px 1fr'; } }; const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); render(); }; el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up); }); };
    drag(sv, true); drag(sh, false); }
  buildCtrls(); requestAnimationFrame(render);
}
function build3DScene(host, walls, arr, opts) {
  host.innerHTML = ''; opts = opts || {};
  const cleanups = [], W = host.clientWidth || 800, Hp = host.clientHeight || 500, perPt = docScale.perPt, H = wallHeightM, M = v => v * perPt, lev = a => { const l = layerById(a.layer); return (l && l.elevation) || 0; };
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const w of walls) for (const [x, y] of [[w.x1, w.y1], [w.x2, w.y2]]) { minx = Math.min(minx, x); miny = Math.min(miny, y); maxx = Math.max(maxx, x); maxy = Math.max(maxy, y); }
  for (const a of (arr || [])) if (a.type === 'mesh3d' && a.enc && layerVisible(a) && phaseVisible(a)) { minx = Math.min(minx, a.x); miny = Math.min(miny, a.y); maxx = Math.max(maxx, a.x + a.fw); maxy = Math.max(maxy, a.y + a.fh); }
  for (const a of (arr || [])) if (a.type === 'profile' && a.path && layerVisible(a) && phaseVisible(a)) for (const p of a.path) { minx = Math.min(minx, p[0]); miny = Math.min(miny, p[1]); maxx = Math.max(maxx, p[0]); maxy = Math.max(maxy, p[1]); }
  if (!isFinite(minx)) { minx = 0; miny = 0; maxx = M ? 10 / perPt : 10; maxy = maxx; }
  const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2, span = Math.max(M(maxx - minx), M(maxy - miny), 2);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xeef1ec);
  const camera = new THREE.PerspectiveCamera(50, W / Hp, 0.05, 4000); camera.position.set(span * 0.85, span * 0.95, span * 0.95);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); renderer.setSize(W, Hp); renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; host.appendChild(renderer.domElement);
  const controls = new THREE.OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.target.set(0, H * 0.4, 0); controls.autoRotate = false; controls.autoRotateSpeed = 1.6;
  if (opts.initCam) { try { camera.position.fromArray(opts.initCam.p); controls.target.fromArray(opts.initCam.t); } catch (_) { } }   // Kamera über Rebuilds erhalten
  const hemi = new THREE.HemisphereLight(0xffffff, 0x55604f, 0.8); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 0.7); sun.position.set(span * 0.8, span * 1.7, span * 0.5); sun.castShadow = true;   // Schatten
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0006; const sc = sun.shadow.camera, sb = Math.max(span * 1.3, 6); sc.left = -sb; sc.right = sb; sc.top = sb; sc.bottom = -sb; sc.near = 0.1; sc.far = span * 5 + 20; scene.add(sun);
  const setSun3D = t => {   // t 0..1 = Morgen→Mittag→Abend (relativer Tagesbogen): Sonne Ost→Zenit→West, Schatten ziehen mit
    const a = Math.PI * Math.max(0, Math.min(1, t)), elev = Math.sin(a);
    sun.position.set(Math.cos(a) * span * 1.5, Math.max(0.08, elev) * span * 1.9, span * 0.55);
    sun.intensity = 0.35 + 0.45 * elev; hemi.intensity = 0.55 + 0.35 * elev;   // tief = schwächer/wärmer
  };
  const setSunDir = (az, el) => {   // echter Sonnenstand: Azimut (0=Nord, 90=Ost) + Höhe → Lichtrichtung, Schatten + Lichtfarbe
    const ce = Math.cos(el), se = Math.sin(el), d = span * 1.85, day = Math.max(0, se);
    sun.position.set(Math.sin(az) * ce * d, Math.max(0.04, se) * d, -Math.cos(az) * ce * d);
    sun.intensity = 0.12 + 0.62 * day; hemi.intensity = 0.4 + 0.45 * day;
    sun.color.setRGB(1, 0.78 + 0.22 * day, 0.55 + 0.45 * day);   // tiefe Sonne = wärmer/oranger
  };
  const gsz = Math.max(span * 2.4, 4);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(gsz, gsz), new THREE.MeshLambertMaterial({ color: 0xdfe3da })); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.01; ground.receiveShadow = true; ground.name = 'ground'; scene.add(ground);
  scene.add(new THREE.GridHelper(gsz, Math.min(60, Math.max(4, Math.round(gsz))), 0xc4cabe, 0xd8dcd2));
  for (const a of arr) if (a.type === 'area' && a.room && a.pts && a.pts.length >= 3 && layerVisible(a) && phaseVisible(a)) {
    const sh = new THREE.Shape(); a.pts.forEach((p, i) => { const X = M(p[0] - cx), Z = M(p[1] - cy); i ? sh.lineTo(X, Z) : sh.moveTo(X, Z); });
    const fl = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshLambertMaterial({ color: 0xece6d8, side: THREE.DoubleSide })); fl.rotation.x = -Math.PI / 2; fl.position.y = lev(a) + 0.006; fl.receiveShadow = true; scene.add(fl);
  }
  const pickables = [], pickPrio = [];   // anklickbare Meshes: pickPrio (Öffnungen) hat Vorrang vor pickables (Wände/Beläge)
  // Bodenbeläge (a.belag) flach am Boden – in Belagsfarbe; Aussparungen als dunkle Flecken darüber
  for (const a of arr) if (a.type === 'area' && a.belag && a.pts && a.pts.length >= 3 && layerVisible(a) && phaseVisible(a)) {
    const sh = new THREE.Shape(); a.pts.forEach((p, i) => { const X = M(p[0] - cx), Z = M(p[1] - cy); i ? sh.lineTo(X, Z) : sh.moveTo(X, Z); });
    const fl = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshLambertMaterial({ color: new THREE.Color(a.color || '#b5651d'), side: THREE.DoubleSide })); fl.rotation.x = -Math.PI / 2; fl.position.y = lev(a) + 0.008; fl.receiveShadow = true; fl.name = 'belagFloor'; fl.userData = { annoId: a.id, kind: 'belagFloor' }; scene.add(fl); pickables.push(fl);
  }
  for (const a of arr) if (a.type === 'area' && a.cutout && a.pts && a.pts.length >= 3 && layerVisible(a) && phaseVisible(a)) {
    const sh = new THREE.Shape(); a.pts.forEach((p, i) => { const X = M(p[0] - cx), Z = M(p[1] - cy); i ? sh.lineTo(X, Z) : sh.moveTo(X, Z); });
    const fl = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshLambertMaterial({ color: 0x8a8f98, side: THREE.DoubleSide })); fl.rotation.x = -Math.PI / 2; fl.position.y = lev(a) + 0.012; scene.add(fl);
  }
  // Wandbeläge (measure + wallface) als senkrechte Flächen (Länge × Höhe)
  for (const a of arr) if (a.type === 'measure' && a.wallface && layerVisible(a) && phaseVisible(a)) {
    const x1 = M(a.x1 - cx), z1 = M(a.y1 - cy), x2 = M(a.x2 - cx), z2 = M(a.y2 - cy), len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 1e-4) continue; const h = a.height || H || 2.5, base = lev(a);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(len, h), new THREE.MeshLambertMaterial({ color: new THREE.Color(a.color || '#2f6ea3'), side: THREE.DoubleSide }));
    m.position.set((x1 + x2) / 2, base + h / 2, (z1 + z2) / 2); m.rotation.y = Math.atan2(-(z2 - z1), x2 - x1); m.receiveShadow = true; m.name = 'belagWall'; m.userData = { annoId: a.id, kind: 'belagWall' }; scene.add(m); pickables.push(m);
  }
  if (show3DSlabs && walls.length) {   // Geschossdecken / Bodenplatte: Wand-Footprint je Geschoss vereinigen → massive Platte (Oberkante = Geschoss-Höhenlage)
    const slabT = 0.2, slabMat = new THREE.MeshStandardMaterial({ color: 0xd6d3cb, roughness: 0.92, metalness: 0, side: THREE.DoubleSide });
    const wth = w => { const ls = (w.layers && w.layers.length) ? w.layers.reduce((s, l) => s + (l.t || 0), 0) : 0; return Math.max(ls, w.thick || 0, cmToPts(12)); };
    const wallRect = w => { const dx = w.x2 - w.x1, dy = w.y2 - w.y1, L = Math.hypot(dx, dy) || 1, nx = -dy / L, ny = dx / L, hh = wth(w) / 2; return [[w.x1 + nx * hh, w.y1 + ny * hh], [w.x2 + nx * hh, w.y2 + ny * hh], [w.x2 - nx * hh, w.y2 - ny * hh], [w.x1 - nx * hh, w.y1 - ny * hh]]; };
    const stories = {}; for (const w of walls) { const e = lev(w); (stories[e] = stories[e] || []).push(w); }
    const PC = window.polygonClipping;
    for (const e in stories) {
      const grp = stories[e], elev = +e; let rings = [];
      if (PC) { try { const polys = grp.map(w => [wallRect(w)]); const res = PC.union(polys[0], ...polys.slice(1)); for (const poly of res) if (poly[0]) rings.push(poly[0]); } catch (_) { rings = []; } }
      if (!rings.length) { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const w of grp) for (const [x, y] of wallRect(w)) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); } if (isFinite(a)) rings = [[[a, b], [c, b], [c, d], [a, d]]]; }
      for (const ring of rings) { if (!ring || ring.length < 3) continue; const sh = new THREE.Shape(); ring.forEach((p, i) => { const X = M(p[0] - cx), Z = M(p[1] - cy); i ? sh.lineTo(X, Z) : sh.moveTo(X, Z); }); const geo = new THREE.ExtrudeGeometry(sh, { depth: slabT, bevelEnabled: false }); const m = new THREE.Mesh(geo, slabMat); m.rotation.x = -Math.PI / 2; m.position.y = elev - slabT; m.receiveShadow = true; m.castShadow = true; scene.add(m); }
    }
  }
  const wmat = new THREE.MeshLambertMaterial({ color: 0xe9e3d8 }), emat = new THREE.LineBasicMaterial({ color: 0x8c8678 }), gmat = new THREE.MeshPhongMaterial({ color: 0x9fc6e0, transparent: true, opacity: 0.35 });
  const texCache = {}, matCache = {}, INSUL_T = ['daemm_eps', 'daemm_wolle', 'daemm_holz', 'daemm_xps', 'eps', 'glaswolle'];
  const faceMat = matKey => {   // Stufe 2: Material-Textur (Verputz-Körnung / Holzschalung horizontal|vertikal / Beton / Dämmung / Backstein)
    if (matCache[matKey]) return matCache[matKey];
    const def = WALL_MATS[matKey] || {};
    if (!texCache[matKey]) {
      const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
      g.fillStyle = def.fill || '#e9e3d8'; g.fillRect(0, 0, 128, 128); const sc = def.color || '#9a9a9a'; const h = def.hatch;
      const isInsul = h && (String(h).indexOf('daemm') === 0 || INSUL_T.includes(h) || INSUL_T.includes(matKey));
      if (matKey === 'holz' || matKey === 'konter') { const vert = matKey === 'konter';   // 1 Brett pro Kachel (Fuge an der Kachelkante) + feine Maserung
        g.globalAlpha = 0.12; g.strokeStyle = sc; g.lineWidth = 1; for (let i = 0; i < 9; i++) { const p = Math.random() * 128; g.beginPath(); if (vert) { g.moveTo(p, 0); g.lineTo(p + (Math.random() * 8 - 4), 128); } else { g.moveTo(0, p); g.lineTo(128, p + (Math.random() * 8 - 4)); } g.stroke(); }
        g.globalAlpha = 0.5; g.lineWidth = 3; g.beginPath(); if (vert) { g.moveTo(126, 0); g.lineTo(126, 128); } else { g.moveTo(0, 126); g.lineTo(128, 126); } g.stroke(); g.globalAlpha = 0.18; g.strokeStyle = '#ffffff'; g.lineWidth = 1.5; g.beginPath(); if (vert) { g.moveTo(2, 0); g.lineTo(2, 128); } else { g.moveTo(0, 2); g.lineTo(128, 2); } g.stroke(); }
      else if (matKey === 'putz' || matKey === 'gips') { g.globalAlpha = 0.16; g.fillStyle = sc; for (let i = 0; i < 2600; i++) g.fillRect(Math.random() * 128, Math.random() * 128, 1, 1); g.globalAlpha = 0.10; g.fillStyle = '#ffffff'; for (let i = 0; i < 1300; i++) g.fillRect(Math.random() * 128, Math.random() * 128, 1, 1); }   // Verputz: feine Körnung (dunkel+hell)
      else if (matKey === 'beton') { g.globalAlpha = 0.08; g.fillStyle = sc; for (let i = 0; i < 500; i++) g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2); }
      else if (matKey === 'eps' || matKey === 'daemm_eps' || matKey === 'daemm_xps') { g.globalAlpha = 0.22; g.strokeStyle = sc; g.lineWidth = 1; for (let i = 0; i < 90; i++) { const x = Math.random() * 128, y = Math.random() * 128, r = 3 + Math.random() * 4; g.beginPath(); g.arc(x, y, r, 0, 6.3); g.stroke(); } }   // EPS/XPS: Perlen/Körner
      else if (isInsul) { g.globalAlpha = 0.35; g.strokeStyle = sc; g.lineWidth = 1; for (let i = 0; i < 300; i++) { const x = Math.random() * 128, y = Math.random() * 128, a = Math.random() * Math.PI, l = 6 + Math.random() * 12; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); } }   // Glas-/Steinwolle: Fasern
      else if (h) { g.strokeStyle = sc; g.globalAlpha = 0.22; g.lineWidth = 1.2; for (let i = -128; i < 128; i += 14) { g.beginPath(); g.moveTo(i, 128); g.lineTo(i + 128, 0); g.stroke(); } }
      const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 2); texCache[matKey] = t;
    }
    return (matCache[matKey] = new THREE.MeshLambertMaterial({ color: new THREE.Color(def.fill || '#e9e3d8'), map: texCache[matKey] }));
  };
  const layerMatCache = {};
  const layerMat = (matKey, lenM, hM, boardHm) => {   // Textur mit realem Abstand; Holz = 1 Brett pro Bretthöhe (boardHm)
    faceMat(matKey); if (!texCache[matKey]) return faceMat(matKey);
    const bH = boardHm || 0.12; let ru, rv;
    if (matKey === 'holz') { ru = Math.max(1, Math.round((lenM || 1.2) / 1.2)); rv = Math.max(1, Math.round((hM || bH) / bH)); }   // horizontale Bretter
    else if (matKey === 'konter') { ru = Math.max(1, Math.round((lenM || bH) / bH)); rv = Math.max(1, Math.round((hM || 1.2) / 1.2)); }   // vertikale Bretter
    else { const P = (matKey === 'mauerwerk' || matKey === 'beton') ? 0.35 : 0.3; ru = Math.max(1, Math.round((lenM || P) / P)); rv = Math.max(1, Math.round((hM || P) / P)); }
    const key = matKey + ':' + ru + ':' + rv;
    if (!layerMatCache[key]) { const tx = texCache[matKey].clone(); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.repeat.set(ru, rv); tx.needsUpdate = true; layerMatCache[key] = new THREE.MeshLambertMaterial({ color: new THREE.Color((WALL_MATS[matKey] || {}).fill || '#e9e3d8'), map: tx }); }
    return layerMatCache[key];
  };
  for (const w of walls) {
    if (!layerVisible(w) || !phaseVisible(w)) continue;
    const dx = w.x2 - w.x1, dy = w.y2 - w.y1, lp = Math.hypot(dx, dy); if (lp < 1) continue;
    const ux = dx / lp, uy = dy / lp, th = M(w.thick || wallThickPts()), HW = w.h3d || H, yb = lev(w) + (w.base || 0), sx = M(w.x1 - cx), sz = M(w.y1 - cy), ry = -Math.atan2(dy, dx);   // yb = Ebenen-Höhe + Wand-Basishöhe (OG-Wand auf der Decke → alle Geschosse sichtbar)
    const nxw = -uy, nyw = ux;   // Querrichtung der Wand (in der Ebene)
    const addBox = (s0, s1, y0, y1, mat, depth, edge) => {                                  // Teilstück der Wand (Längs-Span s0..s1 in pt, Höhe y0..y1 in m)
      const lenM = (s1 - s0) * perPt; if (lenM <= 0.002 || y1 - y0 <= 0.002) return;
      const mid = (s0 + s1) / 2, geo = new THREE.BoxGeometry(lenM, y1 - y0, depth), m = new THREE.Mesh(geo, mat);
      m.castShadow = true; m.receiveShadow = true;
      m.position.set(sx + ux * M(mid), (y0 + y1) / 2, sz + uy * M(mid)); m.rotation.y = ry; scene.add(m);
      if (edge) { const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), emat); e.position.copy(m.position); e.rotation.copy(m.rotation); scene.add(e); }
    };
    const addBox2 = (s0, s1, y0, y1, dCenter, dDepth, mat, edge) => {                       // wie addBox, aber mit Quer-Versatz dCenter (m) → Rahmen/Bank an bestimmter Tiefe
      const lenM = (s1 - s0) * perPt; if (lenM <= 0.002 || y1 - y0 <= 0.002 || dDepth <= 0.001) return;
      const mid = (s0 + s1) / 2, geo = new THREE.BoxGeometry(lenM, y1 - y0, dDepth), m = new THREE.Mesh(geo, mat);
      m.castShadow = true; m.receiveShadow = true;
      m.position.set(sx + ux * M(mid) + nxw * dCenter, (y0 + y1) / 2, sz + uy * M(mid) + nyw * dCenter); m.rotation.y = ry; scene.add(m);
      if (edge) { const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), emat); e.position.copy(m.position); e.rotation.copy(m.rotation); scene.add(e); }
    };
    const fmat = new THREE.MeshLambertMaterial({ color: 0xf2efe9 }), bmat = new THREE.MeshLambertMaterial({ color: 0xcfcabf }), nmat = new THREE.MeshLambertMaterial({ color: 0x3a3f45 });
    const wL = w.layers && w.layers.length ? w.layers : null, totalT = wL ? (wL.reduce((s, l) => s + l.t, 0) || 1) : 1;
    const addWallLayered = (s0, s1, y0, y1) => {   // Wand schichtweise; Luft (Hinterlüftung) bleibt leer/transparent
      if (!wL) { addBox(s0, s1, y0, y1, wmat, th, false); return; }
      const bH = (w.schalH ? w.schalH / 100 : 0.12), atBase = Math.abs(y0 - yb) < 1e-4, atTop = Math.abs(y1 - (yb + HW)) < 1e-4, atStart = Math.abs(s0) < 1e-4, atEnd = Math.abs(s1 - lp) < 1e-4;   // top/bot an Ober-/Unterkante; ext1/ext2 an den Wandenden
      let off = -th / 2; for (const L of wL) { const lt = (L.t / totalT) * th; if (L.mat !== 'luft') { const yy0 = y0 - (atBase ? (L.bot || 0) : 0), yy1 = y1 + (atTop ? (L.top || 0) : 0), sA = s0 - (atStart ? (L.ext1 || 0) : 0), sB = s1 + (atEnd ? (L.ext2 || 0) : 0), lenM = (sB - sA) * perPt, lm = WALL_MATS[L.mat] || {}; if (lm.boards) { const bwp = cmToPts(L.boardW || 4), gpp = cmToPts(L.boardGap != null ? L.boardGap : 2), stp = Math.max(2, bwp + gpp), bmat = layerMat(L.mat, bwp * perPt, yy1 - yy0, bH); for (let s = sA; s < sB - 0.5; s += stp) { const s2 = Math.min(sB, s + bwp); addBox2(s, s2, yy0, yy1, off + lt / 2, lt, bmat, false); } } else if (L.lowMat && L.lowH > 0) { const ys = yb + L.lowH, segs = (ys > yy0 + 1e-4 && ys < yy1 - 1e-4) ? [[yy0, ys, L.lowMat], [ys, yy1, L.mat]] : [[yy0, yy1, ys >= yy1 - 1e-4 ? L.lowMat : L.mat]]; for (const sg of segs) addBox2(sA, sB, sg[0], sg[1], off + lt / 2, lt, layerMat(sg[2], lenM, sg[1] - sg[0], bH), false); } else addBox2(sA, sB, yy0, yy1, off + lt / 2, lt, layerMat(L.mat, lenM, yy1 - yy0, bH), false); } off += lt; }   // lm.boards = Latten einzeln (Lücken zeigen Windpapier)
    };
    const winMat3D = key => { const wm = WIN_MAT[key] || WIN_MAT.holz; return new THREE.MeshLambertMaterial({ color: new THREE.Color(wm.fill) }); };
    const fillToMat = {}; for (const k in WALL_MATS) { const f = WALL_MATS[k] && WALL_MATS[k].fill; if (f) fillToMat[f.toLowerCase()] = k; }
    const revMatCache = {};
    const revealMat = fill => {   // Laibungs-Farbe → Wandmaterial (texturiert, beidseitig)
      const mk = fillToMat[(fill || '').toLowerCase()], key = (mk || '_') + ':' + (fill || '');
      if (!revMatCache[key]) { if (mk) { faceMat(mk); const tx = texCache[mk] ? texCache[mk].clone() : null; if (tx) { tx.wrapS = tx.wrapT = THREE.RepeatWrapping; tx.repeat.set(1, 1); tx.needsUpdate = true; } revMatCache[key] = new THREE.MeshLambertMaterial({ color: new THREE.Color((WALL_MATS[mk] || {}).fill || fill || '#e9e3d8'), map: tx || undefined, side: THREE.DoubleSide }); } else revMatCache[key] = new THREE.MeshLambertMaterial({ color: new THREE.Color(fill || '#e9e3d8'), side: THREE.DoubleSide }); }
      return revMatCache[key];
    };
    const extrudePrism = (poly, mapA, mapB, fill) => {   // 2D-Polygon zwischen zwei 3D-Abbildungen extrudieren (mit UV + Material-Textur)
      if (!poly || poly.length < 3) return; const n = poly.length, bot = poly.map(mapA), top = poly.map(mapB), v = [], uv = [], S = 1 / 0.28;
      const T = (A, B, C) => { v.push(A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2]); uv.push((A[0] + A[2]) * S, A[1] * S, (B[0] + B[2]) * S, B[1] * S, (C[0] + C[2]) * S, C[1] * S); };
      for (let i = 1; i < n - 1; i++) { T(top[0], top[i], top[i + 1]); T(bot[0], bot[i + 1], bot[i]); }
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; T(bot[i], bot[j], top[j]); T(bot[i], top[j], top[i]); }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); geo.computeVertexNormals();
      const rm = new THREE.Mesh(geo, revealMat(fill)); rm.castShadow = true; rm.receiveShadow = true; scene.add(rm);
    };
    const addReveal3D = (o, y0, y1, a0, a1) => {   // 2D-Schichteinzug (openingRevealStrips) → 3D, garantiert gleich wie 2D
      if (!wL) return;
      let jamb; try { jamb = openingRevealStrips(o, arr); } catch (_) { jamb = null; }   // Laibung (Jamben): Grundriss-Reveal vertikal extrudiert
      if (jamb) for (const st of jamb) extrudePrism(st.poly, p => [M(p[0] - cx), y0, M(p[1] - cy)], p => [M(p[0] - cx), y1, M(p[1] - cy)], st.fill);
      const heightM = y1 - y0, midY = (y0 + y1) / 2, wPts = heightM / perPt, thPts = o.thick || (w.thick || wallThickPts());   // Sturz/Schwelle: vertikales Schnitt-Reveal horizontal extrudiert
      const sa2 = Object.assign({}, o, { x: 0, y: 0, ang: 0, thick: thPts, w: wPts, wallId: 'rev2sh', noSillReveal: (o.kind === 'window' && o.bank !== false), reveals: (o.reveals ? { L: o.reveals.B, R: o.reveals.T } : undefined) });   // Sturz/Schwelle nutzen die per-Kante T/B-Laibung (wie im Schnitt); noSillReveal bei Fensterbank
      const sw2 = { id: 'rev2sh', type: 'wall', layers: w.layers, x1: 0, y1: wPts / 2, x2: 0, y2: -wPts / 2, thick: thPts, hatch: w.hatch };
      let sh; try { sh = openingRevealStrips(sa2, [sw2]); } catch (_) { sh = null; }
      const mapSH = (p, u) => { const vOff = p[1] * perPt; return [sx + ux * M(u) + nxw * vOff, midY + p[0] * perPt, sz + uy * M(u) + nyw * vOff]; };
      if (sh) for (const st of sh) extrudePrism(st.poly, p => mapSH(p, a0), p => mapSH(p, a1), st.fill);
    };
    const addWallLap3D = (o, a0, a1, yBot, yTop, dC, fdM) => {   // Wand-Finish-Schichten (ausserhalb der Rahmen-Tiefe) lappen auf den Rahmen → füllt die Lücke an Laibung/Sturz/Brüstung
      if (!wL) return;
      const lapPt0 = (o.frameW || cmToPts(10)) - cmToPts(o.boardVis != null ? o.boardVis : 1), lapInPt = Math.max(0, lapPt0 - openingRevealTotalPts(o, 'L', 'i')), lapOutPt = Math.max(0, lapPt0 - openingRevealTotalPts(o, 'L', 'o')), bH = (w.schalH ? w.schalH / 100 : 0.12);
      const offs = []; { let off = -th / 2; for (const L of wL) { offs.push(off); off += (L.t / totalT) * th; } }
      for (const [i, lapPtS] of [[0, lapInPt], [wL.length - 1, lapOutPt]]) {   // NUR Deckschichten lappen: innerste (innen) + äusserste (aussen) – Dämmung dazwischen NICHT (sonst graue Flicken)
        const L = wL[i]; if (!L || L.mat === 'luft' || lapPtS <= 0.5) continue; const lt = (L.t / totalT) * th, dcen = offs[i] + lt / 2, lapM = lapPtS * perPt, mat = layerMat(L.mat, lapPtS * perPt, yTop - yBot, bH);
        addBox2(a0, a0 + lapPtS, yBot, yTop, dcen, lt, mat, false); addBox2(a1 - lapPtS, a1, yBot, yTop, dcen, lt, mat, false);   // Jamben (nahtlos)
        if (yBot > yb + 1e-4) addBox2(a0, a1, yBot, yBot + lapM, dcen, lt, mat, false);   // Brüstung/Schwelle hoch
        addBox2(a0, a1, yTop - lapM, yTop, dcen, lt, mat, false);   // Sturz runter
      }
    };
    const ops = arr.filter(o => o.type === 'opening' && o.wallId === w.id).map(o => ({ obj: o, c: o.t * lp, hw: o.w / 2, sill: o.kind === 'window' ? (o.sill || 0) : 0, head: o.head || (o.kind === 'window' ? 2.1 : 2.0), kind: o.kind, depth: o.depth == null ? 0.5 : o.depth, fw: o.frameW || cmToPts(o.kind === 'door' ? 6 : 10), fd: o.frameD || cmToPts(7), bank: o.bank !== false, niche: !!o.niche, winType: o.winType || 'f1', winMat: o.winMat || 'holz', winHinge: o.winHinge || 'left' })).sort((a, b) => a.c - b.c);
    let cur = 0;
    for (const op of ops) {
      const a0 = Math.max(0, op.c - op.hw), a1 = Math.min(lp, op.c + op.hw); if (a1 <= a0) continue;
      if (a0 > cur) addWallLayered(cur, a0, yb, yb + HW);                                      // volles Wandstück bis zur Öffnung (schichtweise)
      if (op.sill > 0) addWallLayered(a0, a1, yb, yb + Math.min(op.sill, HW));                 // Brüstung (Fenster)
      if (op.head < HW) addWallLayered(a0, a1, yb + op.head, yb + HW);                         // Sturz über der Öffnung
      const omat = winMat3D(op.winMat);
      if (op.kind === 'window') {
        const fdM = M(op.fd), fwM = M(op.fw), dC = Math.max(-(th / 2 - fdM / 2), Math.min(th / 2 - fdM / 2, (op.depth - 0.5) * th)), sillY = yb + op.sill, headY = yb + Math.min(op.head, HW);
        addReveal3D(op.obj, sillY, headY, a0, a1);   // Schichteinzug Laibung + Sturz/Schwelle
        addWallLap3D(op.obj, a0, a1, sillY, headY, dC, fdM);   // Wandschichten lappen auf den Rahmen (Lücke füllen)
        addBox2(a0, a0 + op.fw, sillY, headY, dC, fdM, omat, true); addBox2(a1 - op.fw, a1, sillY, headY, dC, fdM, omat, true);   // Blendrahmen seitlich
        addBox2(a0, a1, sillY, sillY + fwM, dC, fdM, omat, true); addBox2(a0, a1, headY - fwM, headY, dC, fdM, omat, true);       // Blendrahmen oben/unten
        if (op.winType === 'f2s') addBox2((a0 + a1) / 2 - op.fw / 2, (a0 + a1) / 2 + op.fw / 2, sillY, headY, dC, fdM, omat, true);   // Setzholz/Mittelpfosten
        { const o2 = op.obj, swPts = o2.sashW || cmToPts(7), shPts = o2.sashShift != null ? o2.sashShift : cmToPts(4), ovPts = Math.max(0, swPts - shPts), swM = M(swPts), shM = M(shPts), ovM = Math.max(0, swM - shM);   // Flügel exakt nach 2D: Versatz/Rücksprung/Tiefe
          const sdM = M(o2.sashD || cmToPts(7)), srM = M(o2.sashRecess != null ? o2.sashRecess : cmToPts(1)), gtM = M(o2.glassT || cmToPts(2)), sashC = dC + fdM / 2 - srM - sdM / 2;   // Flügel: 1 cm vom Rahmen-Vorderkante zurück, Tiefe 7 cm
          const iL = a0 + op.fw, iR = a1 - op.fw, iB = sillY + fwM, iT = headY - fwM;
          if (op.winType !== 'fest' && iR - iL > 0.02 && iT - iB > 0.02) { const np = (op.winType === 'f2' || op.winType === 'f2s') ? 2 : 1, pw = (iR - iL) / np;
            for (let pi = 0; pi < np; pi++) { const pl = iL + pi * pw, pr = pl + pw, gL = pl + ovPts, gR = pr - ovPts, gB = iB + ovM, gT = iT - ovM;
              addBox2(pl - shPts, gL, iB - shM, iT + shM, sashC, sdM, omat, true); addBox2(gR, pr + shPts, iB - shM, iT + shM, sashC, sdM, omat, true);   // Flügelrahmen seitlich (4 cm Überlappung)
              addBox2(gL, gR, iB - shM, gB, sashC, sdM, omat, true); addBox2(gL, gR, gT, iT + shM, sashC, sdM, omat, true);   // Flügelrahmen oben/unten
              addBox2(gL, gR, gB, gT, sashC, gtM, gmat, false); } }   // Scheibe im Flügel
          else addBox2(iL, iR, iB, iT, sashC, gtM, gmat, false); }   // Festverglasung
        if (op.bank) { const ext = cmToPts(8), bl = (Array.isArray(op.obj.bankLayers) && op.obj.bankLayers.length) ? op.obj.bankLayers : [{ mat: op.obj.bankMat || 'metall', t: op.obj.bankH != null ? op.obj.bankH : 2.5 }]; let z = sillY; for (const L of bl) { const h = M(cmToPts(L.t || 2.5)), st = openingPartStyle('bank', op.obj, L.mat), bm = new THREE.MeshLambertMaterial({ color: new THREE.Color(st.fill) }); addBox2(a0 - ext, a1 + ext, z - h, z, th / 2 + 0.03, 0.12, bm, false); z -= h; } }   // Fensterbank aussen: geschichtet, Oberkante an der Schwelle (sillY)
        if (op.niche) { const nD = M(op.obj.nicheD || cmToPts(13)), nH = ptsToCm(op.obj.nicheH || cmToPts(28)) / 100, nC = -(th / 2 - nD / 2); addBox2(a0, a1, headY, Math.min(yb + HW, headY + nH), nC, nD, nmat, true); }   // Storennische 13×28 hinten (innen)
      } else if (op.kind === 'door') {   // Tür im 3D: Zarge (Material) + Türblatt / Festteil = Glas
        const fdM = M(op.fd), fwM = M(op.fw), dC = Math.max(-(th / 2 - fdM / 2), Math.min(th / 2 - fdM / 2, (op.depth - 0.5) * th)), headY = yb + Math.min(op.head, HW), leafD = M(cmToPts(4));
        addReveal3D(op.obj, yb, headY, a0, a1);   // Schichteinzug Laibung + Sturz
        addWallLap3D(op.obj, a0, a1, yb, headY, dC, fdM);   // Wandschichten lappen auf die Zarge (Lücke füllen)
        addBox2(a0, a0 + op.fw, yb, headY, dC, fdM, omat, true); addBox2(a1 - op.fw, a1, yb, headY, dC, fdM, omat, true);   // Zarge seitlich
        addBox2(a0, a1, headY - fwM, headY, dC, fdM, omat, true);                                                          // Zarge oben
        { const tl = (Array.isArray(op.obj.sillLayers) && op.obj.sillLayers.length) ? op.obj.sillLayers : [{ mat: op.obj.thresholdMat || 'holz', t: 2.5 }]; let z = yb; for (const L of tl) { const h = M(cmToPts(L.t || 2.5)), st = openingPartStyle('bank', op.obj, L.mat), bm = new THREE.MeshLambertMaterial({ color: new THREE.Color(st.fill) }); addBox2(a0 + op.fw, a1 - op.fw, z, z + h, dC, fdM, bm, false); z += h; } }   // Türschwelle geschichtet (vom Boden hoch)
        const mid = op.winType === 'f2' || op.winType === 'f2s' || op.winType === 'f1f';
        if (mid) addBox2((a0 + a1) / 2 - op.fw / 2, (a0 + a1) / 2 + op.fw / 2, yb, headY, dC, fdM, omat, true);             // Mittelpfosten/Setzholz
        if (op.winType === 'fest') addBox2(a0 + op.fw, a1 - op.fw, yb, headY - fwM, dC, M(cmToPts(2)), gmat, false);        // Festverglasung
        else addBox2(a0 + op.fw, a1 - op.fw, yb, headY - fwM, dC, leafD, omat, true);                                       // Türblatt (Material)
      }
      cur = Math.max(cur, a1);
    }
    if (cur < lp) addWallLayered(cur, lp, yb, yb + HW);                                       // Reststück (schichtweise)
  }
  // Decken / Platten (slab) extrudieren
  const smat = new THREE.MeshLambertMaterial({ color: 0xd7dbe2, side: THREE.DoubleSide });
  for (const a of arr) if (a.type === 'slab' && a.pts && a.pts.length >= 3 && layerVisible(a) && phaseVisible(a)) {
    try {
      const sh = new THREE.Shape(); a.pts.forEach((p, i) => { const X = M(p[0] - cx), Y = M(p[1] - cy); i ? sh.lineTo(X, Y) : sh.moveTo(X, Y); });
      const bands = slabLayerBands(a), baseY = lev(a) + (a.base || 0);
      if (bands) {   // Decke schichtweise (Belag/Trittschall/Dämmung/Tragschicht …), Einzug je Schicht
        for (const b of bands) { let shp = sh; if (b.inset > 0) { const ip = insetPolygon(a.pts, cmToPts(b.inset * 100)); if (ip && ip.length >= 3) { shp = new THREE.Shape(); ip.forEach((p, i) => { const X = M(p[0] - cx), Y = M(p[1] - cy); i ? shp.lineTo(X, Y) : shp.moveTo(X, Y); }); } } const mt = WALL_MATS[b.mat] || {}, mat = new THREE.MeshStandardMaterial({ color: new THREE.Color(mt.fill || '#cfcfcf'), roughness: 0.93, metalness: 0 }), geo = new THREE.ExtrudeGeometry(shp, { depth: b.t, bevelEnabled: false }), m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; m.rotation.x = Math.PI / 2; m.position.y = baseY + b.y1; scene.add(m); const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), emat); e.rotation.x = Math.PI / 2; e.position.y = m.position.y; scene.add(e); }
      } else {
        const geo = new THREE.ExtrudeGeometry(sh, { depth: a.thick || 0.2, bevelEnabled: false }), m = new THREE.Mesh(geo, smat);
        m.castShadow = true; m.receiveShadow = true; m.rotation.x = Math.PI / 2; m.position.y = baseY + (a.thick || 0.2); scene.add(m);
        const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), emat); e.rotation.x = Math.PI / 2; e.position.y = m.position.y; scene.add(e);
      }
    } catch (_) { }
  }
  // Treppen (gerader Lauf) als 3D-Stufen
  const stmat = new THREE.MeshLambertMaterial({ color: 0xd9d2c4 });
  for (const a of arr) if (a.type === 'stairs' && layerVisible(a) && phaseVisible(a)) {
    const dx = a.x2 - a.x1, dy = a.y2 - a.y1, lp = Math.hypot(dx, dy); if (lp < 1) continue;
    const ux = dx / lp, uy = dy / lp, sx = M(a.x1 - cx), sz = M(a.y1 - cy), ry = -Math.atan2(dy, dx), wm = M(a.width || stairWidthPts()), n = stairSteps(a), rise = a.rise || stairRiseM, base = lev(a) + (a.base || 0), stepRise = rise / n, going = (lp * perPt) / n;
    for (let i = 0; i < n; i++) {
      const h = (i + 1) * stepRise, geo = new THREE.BoxGeometry(going, h, wm), m = new THREE.Mesh(geo, stmat), along = (i + 0.5) * going;
      m.position.set(sx + ux * along, base + h / 2, sz + uy * along); m.rotation.y = ry; scene.add(m);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), emat); e.position.copy(m.position); e.rotation.copy(m.rotation); scene.add(e);
    }
  }
  // Unterzüge: Box direkt unter der Decke (Oberkante = Geschosshöhe)
  const beamMat = new THREE.MeshLambertMaterial({ color: 0xc2bdb0 });
  for (const a of arr) if (a.type === 'beam' && layerVisible(a) && phaseVisible(a)) {
    const dx = a.x2 - a.x1, dy = a.y2 - a.y1, lp = Math.hypot(dx, dy); if (lp < 1) continue;
    const ry = -Math.atan2(dy, dx), wm = M(a.width || beamWidthPts()), hm = a.height || beamHM, lenM = lp * perPt, ceil = lev(a) + wallHeightM, mxp = (a.x1 + a.x2) / 2, myp = (a.y1 + a.y2) / 2;
    const geo = new THREE.BoxGeometry(lenM, hm, wm), m = new THREE.Mesh(geo, beamMat); m.position.set(M(mxp - cx), ceil - hm / 2, M(myp - cy)); m.rotation.y = ry; m.castShadow = true; m.receiveShadow = true; scene.add(m);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), emat); e.position.copy(m.position); e.rotation.copy(m.rotation); scene.add(e);
  }
  // Dächer (Pult-/Satteldach) als 3D-Schräge
  const rmat = new THREE.MeshLambertMaterial({ color: 0xb06a4f, side: THREE.DoubleSide });
  for (const a of arr) if (a.type === 'roof' && layerVisible(a) && phaseVisible(a)) {
    const x0 = M(Math.min(a.x, a.x + a.w) - cx), x1 = M(Math.max(a.x, a.x + a.w) - cx), z0 = M(Math.min(a.y, a.y + a.h) - cy), z1 = M(Math.max(a.y, a.y + a.h) - cy), ev = lev(a) + (a.eave || roofEaveM), rg = lev(a) + (a.ridge || roofRidgeM), tris = [];
    const quad = (A, B, C, D) => { tris.push([A, B, C], [A, C, D]); };
    if (a.rtype === 'pult') {
      if (a.axis === 'x') { quad([x0, ev, z0], [x1, ev, z0], [x1, rg, z1], [x0, rg, z1]); tris.push([[x0, ev, z0], [x0, rg, z1], [x0, ev, z1]], [[x1, ev, z0], [x1, ev, z1], [x1, rg, z1]]); }
      else { quad([x0, ev, z0], [x0, ev, z1], [x1, rg, z1], [x1, rg, z0]); tris.push([[x0, ev, z0], [x1, rg, z0], [x1, ev, z0]], [[x0, ev, z1], [x1, ev, z1], [x1, rg, z1]]); }
    } else {
      if (a.axis === 'x') { const zc = (z0 + z1) / 2; quad([x0, ev, z0], [x1, ev, z0], [x1, rg, zc], [x0, rg, zc]); quad([x0, ev, z1], [x0, rg, zc], [x1, rg, zc], [x1, ev, z1]); tris.push([[x0, ev, z0], [x0, rg, zc], [x0, ev, z1]], [[x1, ev, z0], [x1, ev, z1], [x1, rg, zc]]); }
      else { const xc = (x0 + x1) / 2; quad([x0, ev, z0], [x0, ev, z1], [xc, rg, z1], [xc, rg, z0]); quad([x1, ev, z0], [xc, rg, z0], [xc, rg, z1], [x1, ev, z1]); tris.push([[x0, ev, z0], [xc, rg, z0], [x1, ev, z0]], [[x0, ev, z1], [x1, ev, z1], [xc, rg, z1]]); }
    }
    const flat = []; for (const tri of tris) for (const v of tri) flat.push(v[0], v[1], v[2]);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(flat, 3)); geo.computeVertexNormals(); scene.add(new THREE.Mesh(geo, rmat));
  }
  // Möbel/Sanitär als niedrige Blöcke
  const bmat = new THREE.MeshLambertMaterial({ color: 0xcec5b4 }), colMat = new THREE.MeshLambertMaterial({ color: 0xb8bcb2 });
  for (const a of arr) if (a.type === 'block' && layerVisible(a) && phaseVisible(a)) {
    const isCol = IS_COLUMN(a.kind), bw = M(Math.abs(a.w)), bd = M(Math.abs(a.h)), bh = isCol ? (a.h3d || wallHeightM) : (BLOCK_H[a.kind] || 0.6), ccx = Math.min(a.x, a.x + a.w) + Math.abs(a.w) / 2, ccy = Math.min(a.y, a.y + a.h) + Math.abs(a.h) / 2;
    if (bw < 0.01 || bd < 0.01) continue;
    const geo = a.kind === 'columnRound' ? new THREE.CylinderGeometry(Math.min(bw, bd) / 2, Math.min(bw, bd) / 2, bh, 24) : new THREE.BoxGeometry(bw, bh, bd), m = new THREE.Mesh(geo, isCol ? colMat : bmat); m.position.set(M(ccx - cx), lev(a) + bh / 2, M(ccy - cy)); m.rotation.y = -(a.rot || 0); m.castShadow = true; m.receiveShadow = true; scene.add(m);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), emat); e.position.copy(m.position); e.rotation.copy(m.rotation); scene.add(e);
  }
  for (const a of arr) if (a.type === 'mesh3d' && a.enc && layerVisible(a) && phaseVisible(a)) {   // akkurates 3D-Objekt (IFC-Fallback): rohe Geometrie, lokale Plan-Punkte + Höhe → Welt
    let d; try { d = decodeMesh3d(a.enc); } catch (_) { continue; }
    const pos = d.pos, wp = new Float32Array(pos.length);
    for (let i = 0; i < pos.length; i += 3) { wp[i] = M((pos[i] + a.x) - cx); wp[i + 1] = lev(a) + pos[i + 1]; wp[i + 2] = M((pos[i + 2] + a.y) - cy); }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3)); geo.setIndex(new THREE.BufferAttribute(d.idx, 1)); geo.computeVertexNormals();
    const mm = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: new THREE.Color(a.color || '#cfc8ba'), roughness: 0.92, metalness: 0, side: THREE.DoubleSide, flatShading: true })); mm.castShadow = true; mm.receiveShadow = true; scene.add(mm);
  }
  for (const a of arr) if (a.type === 'profile' && a.path && a.path.length >= 2 && a.prof && a.prof.length >= 2 && layerVisible(a) && phaseVisible(a)) {   // Komplexes Profil: Querschnitt entlang Pfad ziehen (Sweep)
    const path = a.path, nP = a.prof.length, closed = !!a.closed && path.length >= 3, segN = [];
    for (let i = 0; i < path.length - 1; i++) { const dx = path[i + 1][0] - path[i][0], dy = path[i + 1][1] - path[i][1], L = Math.hypot(dx, dy) || 1; segN.push([-dy / L, dx / L]); }
    if (closed) { const dx = path[0][0] - path[path.length - 1][0], dy = path[0][1] - path[path.length - 1][1], L = Math.hypot(dx, dy) || 1; segN.push([-dy / L, dx / L]); }
    const nodeN = []; for (let i = 0; i < path.length; i++) { let a1, a2; if (closed) { a1 = segN[(i - 1 + segN.length) % segN.length]; a2 = segN[i % segN.length]; } else { a1 = segN[Math.max(0, i - 1)]; a2 = segN[Math.min(segN.length - 1, i)]; } let nx = a1[0] + a2[0], ny = a1[1] + a2[1]; const L = Math.hypot(nx, ny) || 1; nodeN.push([nx / L, ny / L]); }
    const lv = lev(a) + (a.elev || 0), pos = [], idx = [];
    for (let i = 0; i < path.length; i++) { const px = M(path[i][0] - cx), pz = M(path[i][1] - cy), n = nodeN[i]; for (let k = 0; k < nP; k++) { const u = a.prof[k][0] / 100, v = a.prof[k][1] / 100; pos.push(px + n[0] * u, lv + v, pz + n[1] * u); } }
    const nR = path.length, segCount = closed ? nR : nR - 1;
    for (let i = 0; i < segCount; i++) { const i2 = (i + 1) % nR; for (let k = 0; k < nP; k++) { const k2 = (k + 1) % nP, A = i * nP + k, B = i * nP + k2, C = i2 * nP + k2, D = i2 * nP + k; idx.push(A, B, D, B, C, D); } }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    const mm = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: new THREE.Color(a.color || '#7a8392'), roughness: 0.5, metalness: 0.35, side: THREE.DoubleSide })); mm.castShadow = true; mm.receiveShadow = true; scene.add(mm);
  }
  let raf, alive = true;
  const onResize = () => { const w2 = host.clientWidth, h2 = host.clientHeight; if (!w2 || !h2) return; camera.aspect = w2 / h2; camera.updateProjectionMatrix(); renderer.setSize(w2, h2); };
  window.addEventListener('resize', onResize);
  let editHandles = [], editSetAddMode = () => { };
  if (opts.onEdit) {   // Griffe: Wand-Endpunkte (Kugel, Snapping) + Wand-Mittelpunkt (Quader) + Möbel/Stützen-Mittelpunkt → ändern DAS Bauteil-Objekt
    const hR = Math.max(0.07, span * 0.013), hGeo = new THREE.SphereGeometry(hR, 14, 14), midGeo = new THREE.BoxGeometry(hR * 1.7, hR * 0.5, hR * 1.7), blkGeo = new THREE.BoxGeometry(hR * 2.2, hR * 0.5, hR * 2.2), opGeo = new THREE.SphereGeometry(hR * 1.05, 14, 14), rotGeo = new THREE.SphereGeometry(hR * 1.1, 14, 14), htGeo = new THREE.ConeGeometry(hR * 1.2, hR * 2.4, 4);
    const cEnd = 0x2f7be4, cMid = 0x6b7280, cBlk = 0x8a5cc4, cOpen = 0x14b8a6, cRot = 0xeab308, cHt = 0xdb2777, cHot = 0xf08a24, cSnap = 0x2fae4e;
    const addH = (geo, col, x, y, z, ud) => { const s = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: col })); s.position.set(x, y, z); s.name = '__handle'; s.renderOrder = 999; s.userData = ud; scene.add(s); editHandles.push(s); };
    for (const w of walls) { addH(hGeo, cEnd, M(w.x1 - cx), lev(w) + 0.07, M(w.y1 - cy), { obj: w, end: 1 }); addH(hGeo, cEnd, M(w.x2 - cx), lev(w) + 0.07, M(w.y2 - cy), { obj: w, end: 2 }); addH(midGeo, cMid, M((w.x1 + w.x2) / 2 - cx), lev(w) + 0.07, M((w.y1 + w.y2) / 2 - cy), { obj: w, end: 'mid' }); addH(htGeo, cHt, M((w.x1 + w.x2) / 2 - cx), lev(w) + (w.h3d || wallHeightM), M((w.y1 + w.y2) / 2 - cy), { obj: w, end: 'wh', baseY: lev(w) }); }
    for (const a of arr) if (a.type === 'block' && layerVisible(a) && phaseVisible(a)) { const bx = Math.min(a.x, a.x + a.w) + Math.abs(a.w) / 2, by = Math.min(a.y, a.y + a.h) + Math.abs(a.h) / 2, cwx = M(bx - cx), cwz = M(by - cy), rad = Math.max(0.28, M(Math.max(Math.abs(a.w), Math.abs(a.h)) / 2) + 0.3); addH(blkGeo, cBlk, cwx, lev(a) + 0.07, cwz, { obj: a, end: 'block' }); addH(rotGeo, cRot, cwx + Math.sin(a.rot || 0) * rad, lev(a) + 0.07, cwz - Math.cos(a.rot || 0) * rad, { obj: a, end: 'brot', cwx, cwz, rad }); }
    for (const a of arr) if (a.type === 'opening' && layerVisible(a) && phaseVisible(a)) { const w = arr.find(o => o.id === a.wallId && o.type === 'wall'); if (!w) continue; addH(opGeo, cOpen, M(a.x - cx), lev(w) + 1.0, M(a.y - cy), { obj: a, end: 'open', wall: w }); }
    const snapTargets = []; for (const w of walls) { snapTargets.push({ w, x: M(w.x1 - cx), z: M(w.y1 - cy) }); snapTargets.push({ w, x: M(w.x2 - cx), z: M(w.y2 - cy) }); }
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hitP = new THREE.Vector3(), dom = renderer.domElement;
    const prevGeo = new THREE.BufferGeometry(); prevGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3)); const prevLine = new THREE.Line(prevGeo, new THREE.LineBasicMaterial({ color: cHot })); prevLine.visible = false; prevLine.renderOrder = 998; prevLine.name = '__handle'; scene.add(prevLine);
    let drag = null, startW = null, orig = null, moved = false, armed = null, snapThr = Math.max(0.25, span * 0.03), vplane = new THREE.Plane();
    let addMode = false, addStart = null; const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);   // Wand im 3D zeichnen
    const setNdc = ev => { const r = dom.getBoundingClientRect(); ndc.x = ((ev.clientX - r.left) / r.width) * 2 - 1; ndc.y = -((ev.clientY - r.top) / r.height) * 2 + 1; };
    const setPrev = (ax, az, bx, bz, y) => { const p = prevGeo.attributes.position; p.setXYZ(0, ax, y, az); p.setXYZ(1, bx, y, bz); p.needsUpdate = true; prevLine.visible = true; };
    const snapGround = () => { let wx = hitP.x, wz = hitP.z, bd = snapThr; for (const t of snapTargets) { const d = Math.hypot(t.x - wx, t.z - wz); if (d < bd) { bd = d; wx = t.x; wz = t.z; } } return { wx, wz }; };
    editSetAddMode = v => { addMode = !!v; controls.enabled = !addMode; addStart = null; prevLine.visible = false; };
    const onDown = ev => {
      setNdc(ev); ray.setFromCamera(ndc, camera);
      if (addMode) { if (!ray.ray.intersectPlane(groundPlane, hitP)) return; const s = snapGround(); if (!addStart) { addStart = { wx: s.wx, wz: s.wz }; } else { const lay = (walls[0] && walls[0].layer != null) ? walls[0].layer : activeLayerId; getAnnos(curPage()).push({ id: nextId++, type: 'wall', x1: addStart.wx / perPt + cx, y1: addStart.wz / perPt + cy, x2: s.wx / perPt + cx, y2: s.wz / perPt + cy, thick: wallThickPts(), just: wallJust, color: (wallHatch && wallHatch.color) || style.color, fill: (wallHatch && wallHatch.fill) || '#ffffff', hatch: wallHatch ? { ...wallHatch } : null, width: 1.4, h3d: wallHeightM, dim: wallDimOn, layer: lay }); addStart = null; prevLine.visible = false; setTimeout(() => opts.onEdit(), 0); } ev.preventDefault(); ev.stopPropagation(); return; }
      const h = ray.intersectObjects(editHandles)[0]; if (h) { drag = h.object; armed = drag.userData.obj; moved = false; controls.enabled = false; plane.constant = -drag.position.y; startW = { x: drag.position.x, z: drag.position.z }; const o = drag.userData.obj; orig = o.type === 'block' ? { x: o.x, y: o.y } : { x1: o.x1, y1: o.y1, x2: o.x2, y2: o.y2 }; ev.preventDefault(); ev.stopPropagation(); }
    };
    const onMove = ev => {
      if (addMode) { if (!addStart) return; setNdc(ev); ray.setFromCamera(ndc, camera); if (ray.ray.intersectPlane(groundPlane, hitP)) { const s = snapGround(); setPrev(addStart.wx, addStart.wz, s.wx, s.wz, 0.05); } return; }
      if (!drag) return; setNdc(ev); ray.setFromCamera(ndc, camera); const o = drag.userData.obj, end = drag.userData.end; moved = true;
      if (end === 'wh') { const nrm = new THREE.Vector3().subVectors(camera.position, drag.position); nrm.y = 0; if (nrm.lengthSq() < 1e-6) nrm.set(0, 0, 1); nrm.normalize(); vplane.setFromNormalAndCoplanarPoint(nrm, drag.position); if (ray.ray.intersectPlane(vplane, hitP)) { let hgt = Math.max(0.5, Math.min(20, hitP.y - drag.userData.baseY)); drag.position.y = drag.userData.baseY + hgt; drag.userData._h = hgt; } drag.material.color.setHex(cHot); prevLine.visible = false; return; }
      if (!ray.ray.intersectPlane(plane, hitP)) return; const y = drag.position.y;
      if (end === 'brot') { const u = drag.userData, r = Math.atan2(hitP.x - u.cwx, -(hitP.z - u.cwz)); drag.position.x = u.cwx + Math.sin(r) * u.rad; drag.position.z = u.cwz - Math.cos(r) * u.rad; u._rot = r; drag.material.color.setHex(cHot); prevLine.visible = false; }
      else if (end === 'open') { const w = drag.userData.wall, p1x = M(w.x1 - cx), p1z = M(w.y1 - cy), vx = M(w.x2 - cx) - p1x, vz = M(w.y2 - cy) - p1z, len2 = vx * vx + vz * vz || 1; let t = ((hitP.x - p1x) * vx + (hitP.z - p1z) * vz) / len2; t = Math.max(0, Math.min(1, t)); drag.position.x = p1x + vx * t; drag.position.z = p1z + vz * t; drag.userData._t = t; drag.material.color.setHex(cHot); prevLine.visible = false; }
      else if (end === 'mid' || end === 'block') { const dx = hitP.x - startW.x, dz = hitP.z - startW.z; drag.position.x = startW.x + dx; drag.position.z = startW.z + dz; drag.material.color.setHex(cHot); if (end === 'mid') setPrev(M(orig.x1 - cx) + dx, M(orig.y1 - cy) + dz, M(orig.x2 - cx) + dx, M(orig.y2 - cy) + dz, y); else prevLine.visible = false; }
      else { let hx = hitP.x, hz = hitP.z, best = null, bd = snapThr; for (const t of snapTargets) { if (t.w === o) continue; const d = Math.hypot(t.x - hx, t.z - hz); if (d < bd) { bd = d; best = t; } } if (best) { hx = best.x; hz = best.z; drag.material.color.setHex(cSnap); } else drag.material.color.setHex(cHot); drag.position.x = hx; drag.position.z = hz; const fx = end === 1 ? M(o.x2 - cx) : M(o.x1 - cx), fz = end === 1 ? M(o.y2 - cy) : M(o.y1 - cy); setPrev(fx, fz, hx, hz, y); }
    };
    const onUp = () => { if (!drag) return; const d = drag, o = d.userData.obj, end = d.userData.end; drag = null; controls.enabled = true; prevLine.visible = false; if (!moved) return;   // reiner Klick = nur anwählen (für Entf), kein Rebuild
      const dxp = (d.position.x - startW.x) / perPt, dzp = (d.position.z - startW.z) / perPt;
      if (end === 'wh') { if (d.userData._h != null) o.h3d = Math.round(d.userData._h * 100) / 100; }
      else if (end === 'brot') { if (d.userData._rot != null) o.rot = d.userData._rot; }
      else if (end === 'open') { if (d.userData._t != null) o.t = d.userData._t; }
      else if (end === 'block') { o.x = orig.x + dxp; o.y = orig.y + dzp; }
      else if (end === 'mid') { o.x1 = orig.x1 + dxp; o.y1 = orig.y1 + dzp; o.x2 = orig.x2 + dxp; o.y2 = orig.y2 + dzp; }
      else { const px = d.position.x / perPt + cx, py = d.position.z / perPt + cy; if (end === 1) { o.x1 = px; o.y1 = py; } else { o.x2 = px; o.y2 = py; } }
      setTimeout(() => opts.onEdit(), 0);
    };
    const onKey = ev => { if (/^(INPUT|TEXTAREA|SELECT)$/.test((ev.target && ev.target.tagName) || '')) return; if ((ev.key === 'Delete' || ev.key === 'Backspace') && armed) { ev.preventDefault(); const o = armed; armed = null; for (const nn in annos) { const i = (annos[nn] || []).indexOf(o); if (i >= 0) { annos[nn].splice(i, 1); if (o.type === 'wall') for (let j = annos[nn].length - 1; j >= 0; j--) if (annos[nn][j].type === 'opening' && annos[nn][j].wallId === o.id) annos[nn].splice(j, 1); break; } } setTimeout(() => opts.onEdit(), 0); } };
    dom.addEventListener('pointerdown', onDown); dom.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('keydown', onKey);
    cleanups.push(() => { dom.removeEventListener('pointerdown', onDown); dom.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('keydown', onKey); });
  }
  // ── Anklicken → Einstellungen: unsichtbare Klick-Proxys je Wand; Raycast beim Klick → opts.onPick(annoId, kind) ──
  for (const w of walls) {
    const px1 = M(w.x1 - cx), pz1 = M(w.y1 - cy), px2 = M(w.x2 - cx), pz2 = M(w.y2 - cy), plen = Math.hypot(px2 - px1, pz2 - pz1);
    if (plen < 1e-4) continue; const pth = Math.max(0.03, (w.thick || wallThickPts()) * perPt), ph = w.h3d || H;
    const box = new THREE.Mesh(new THREE.BoxGeometry(plen, ph, pth), new THREE.MeshBasicMaterial({ visible: false }));
    box.position.set((px1 + px2) / 2, lev(w) + ph / 2, (pz1 + pz2) / 2); box.rotation.y = Math.atan2(-(pz2 - pz1), px2 - px1);
    box.userData = { annoId: w.id, kind: 'wall' }; box.name = '__pick'; scene.add(box); pickables.push(box);
  }
  for (const a of arr) if (a.type === 'opening' && layerVisible(a) && phaseVisible(a)) {   // Fenster/Tür anklickbar (Vorrang vor der Wand)
    const w = walls.find(ww => ww.id === a.wallId); if (!w || a.x == null) continue;
    const dxp = M(w.x2 - cx) - M(w.x1 - cx), dzp = M(w.y2 - cy) - M(w.y1 - cy);
    const wd = Math.max(0.05, (a.w || cmToPts(90)) * perPt), th = Math.max(0.06, (a.thick || w.thick || wallThickPts()) * perPt) + 0.02;
    const sill = a.sill || 0, head = a.head || (a.kind === 'window' ? 2.1 : 2.0), hh = Math.max(0.2, head - sill);
    const box = new THREE.Mesh(new THREE.BoxGeometry(wd, hh, th), new THREE.MeshBasicMaterial({ visible: false }));
    box.position.set(M(a.x - cx), lev(w) + sill + hh / 2, M(a.y - cy)); box.rotation.y = Math.atan2(-dzp, dxp);
    box.userData = { annoId: a.id, kind: 'opening' }; box.name = '__pick'; scene.add(box); pickPrio.push(box);
  }
  if (typeof opts.onPick === 'function') {
    const pRay = new THREE.Raycaster(), pNdc = new THREE.Vector2(), pDom = renderer.domElement; let pDX = 0, pDY = 0;
    const pkDown = ev => { pDX = ev.clientX; pDY = ev.clientY; };
    const pkUp = ev => {
      if (flyMode || Math.hypot(ev.clientX - pDX, ev.clientY - pDY) > 4) return;   // im Flug oder beim Ziehen nicht picken
      const r = pDom.getBoundingClientRect(); pNdc.x = ((ev.clientX - r.left) / r.width) * 2 - 1; pNdc.y = -((ev.clientY - r.top) / r.height) * 2 + 1;
      pRay.setFromCamera(pNdc, camera); const hit = pRay.intersectObjects(pickPrio, false)[0] || pRay.intersectObjects(pickables, false)[0];
      if (hit && hit.object.userData && hit.object.userData.annoId != null) opts.onPick(hit.object.userData.annoId, hit.object.userData.kind);
    };
    pDom.addEventListener('pointerdown', pkDown); pDom.addEventListener('pointerup', pkUp);
    cleanups.push(() => { pDom.removeEventListener('pointerdown', pkDown); pDom.removeEventListener('pointerup', pkUp); });
  }
  // ── Fly-Modus: mit F umschalten. W/A/S/D bewegen, Maus ziehen = schauen, E/Leer hoch, Q/Strg runter, Shift = schneller ──
  let flyMode = false; const flyKeys = new Set(); let flyYaw = 0, flyPitch = 0, flyDrag = false, flyPX = 0, flyPY = 0; const flyDom = renderer.domElement;
  const flySync = () => { const dir = new THREE.Vector3().subVectors(controls.target, camera.position).normalize(); flyYaw = Math.atan2(dir.x, dir.z); flyPitch = Math.asin(Math.max(-1, Math.min(1, dir.y))); };
  const setFlyMode = on => { flyMode = !!on; controls.enabled = !flyMode; flyKeys.clear(); flyDrag = false; flyDom.style.cursor = flyMode ? 'crosshair' : ''; if (flyMode) flySync(); };
  const flyFwd = () => new THREE.Vector3(Math.sin(flyYaw) * Math.cos(flyPitch), Math.sin(flyPitch), Math.cos(flyYaw) * Math.cos(flyPitch));
  const flyStep = () => {
    const fwd = flyFwd(), right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const spd = span * 0.012 * (flyKeys.has('shift') ? 3.2 : 1), mv = new THREE.Vector3();
    if (flyKeys.has('w')) mv.add(fwd); if (flyKeys.has('s')) mv.sub(fwd);
    if (flyKeys.has('d')) mv.add(right); if (flyKeys.has('a')) mv.sub(right);
    if (flyKeys.has('e') || flyKeys.has('space')) mv.y += 1; if (flyKeys.has('q') || flyKeys.has('control')) mv.y -= 1;
    if (mv.lengthSq() > 0) camera.position.addScaledVector(mv.normalize(), spd);
    camera.lookAt(camera.position.x + fwd.x, camera.position.y + fwd.y, camera.position.z + fwd.z);
    controls.target.copy(camera.position).add(fwd);   // Orbit läuft nach dem Fliegen sinnvoll weiter
  };
  const flyKeyDown = ev => { if (/^(INPUT|TEXTAREA|SELECT)$/.test((ev.target && ev.target.tagName) || '')) return;
    if ((ev.key === 'f' || ev.key === 'F') && !ev.repeat) { setFlyMode(!flyMode); toast(flyMode ? 'Fliegen ✈  W/A/S/D · Maus ziehen = schauen · E/Leer hoch · Q/Strg runter · Shift = schneller · F = Umkreisen' : 'Umkreisen (Maus)'); return; }
    if (!flyMode) return; const k = ev.key === ' ' ? 'space' : ev.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'q', 'e', 'space', 'shift', 'control'].includes(k)) { flyKeys.add(k); ev.preventDefault(); } };
  const flyKeyUp = ev => { const k = ev.key === ' ' ? 'space' : ev.key.toLowerCase(); flyKeys.delete(k); };
  const flyPDown = ev => { if (flyMode) { flyDrag = true; flyPX = ev.clientX; flyPY = ev.clientY; } };
  const flyPMove = ev => { if (!flyMode || !flyDrag) return; flyYaw -= (ev.clientX - flyPX) * 0.0035; flyPitch = Math.max(-1.45, Math.min(1.45, flyPitch - (ev.clientY - flyPY) * 0.0035)); flyPX = ev.clientX; flyPY = ev.clientY; };
  const flyPUp = () => { flyDrag = false; };
  flyDom.addEventListener('pointerdown', flyPDown); window.addEventListener('pointermove', flyPMove); window.addEventListener('pointerup', flyPUp);
  window.addEventListener('keydown', flyKeyDown); window.addEventListener('keyup', flyKeyUp);
  cleanups.push(() => { flyDom.removeEventListener('pointerdown', flyPDown); window.removeEventListener('pointermove', flyPMove); window.removeEventListener('pointerup', flyPUp); window.removeEventListener('keydown', flyKeyDown); window.removeEventListener('keyup', flyKeyUp); });
  const loop = () => { if (!alive) return; if (flyMode) flyStep(); else controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(loop); }; loop();
  const setView = name => { const ty = H * 0.45, d = Math.max(span * 1.4, 4); if (name === 'top') { camera.position.set(0.001, d * 1.7, 0.001); controls.target.set(0, 0, 0); } else if (name === 'front') { camera.position.set(0, ty, d * 1.5); controls.target.set(0, ty, 0); } else if (name === 'side') { camera.position.set(d * 1.5, ty, 0.001); controls.target.set(0, ty, 0); } else { camera.position.set(span * 0.85, span * 0.95, span * 0.95); controls.target.set(0, H * 0.4, 0); } camera.updateProjectionMatrix(); controls.update(); };
  const snapshot = () => { editHandles.forEach(h => h.visible = false); renderer.render(scene, camera); const d = renderer.domElement.toDataURL('image/png'); editHandles.forEach(h => h.visible = true); return { data: d, w: renderer.domElement.width, h: renderer.domElement.height }; };
  return { dispose: () => { alive = false; cancelAnimationFrame(raf); cleanups.forEach(fn => { try { fn(); } catch (_) { } }); window.removeEventListener('resize', onResize); controls.dispose(); renderer.dispose(); host.innerHTML = ''; }, setView, snapshot, exportObj: () => exportSceneObj(scene), setRotate: on => { controls.autoRotate = !!on; }, getRotate: () => controls.autoRotate, setSun: setSun3D, setSunDir, camState: () => ({ p: camera.position.toArray(), t: controls.target.toArray() }), setAddMode: v => editSetAddMode(v), setFly: v => setFlyMode(v), getFly: () => flyMode };
}

/* ---------- Rechtsklick-Menü (alles erreichbar) ---------- */
// Seitenzahlen „n / N" unten mittig auf jede Seite setzen
function addPageNumbers() {
  if (!pdfDoc) return; pushUndo(); const N = pdfDoc.numPages, size = 12, bw = 70, bh = size * 1.5;
  for (let n = 1; n <= N; n++) {
    const pv = pageViews.find(p => p.num === n), w = pv ? pv.pageW : 595, h = pv ? pv.pageH : 842;
    pushAnno(n, { id: nextId++, type: 'text', x: (w - bw) / 2, y: h - bh - 12, w: bw, h: bh, text: n + ' / ' + N, size, color: '#555555', align: 'center', bg: 'transparent', border: null, borderW: 1.2 });
  }
  pageViews.forEach(drawAnnos); saveState(); toast('Seitenzahlen eingefügt ✓');
}
/* ---------- Lineal (oben & rechts, echte Masse) ---------- */
let rulerOn = false, _rulerRAF = 0;
function toggleRuler() {
  rulerOn = !rulerOn; const b = $('#btnRuler'); if (b) b.classList.toggle('on', rulerOn); const b2 = $('#btnRuler2'); if (b2) b2.classList.toggle('on', rulerOn);
  ['#rulerH', '#rulerV', '#rulerCorner'].forEach(s => { const e = $(s); if (e) e.hidden = !rulerOn; });
  if (rulerOn) drawRulers();
}
function scheduleRulers() { if (!rulerOn || _rulerRAF) return; _rulerRAF = requestAnimationFrame(() => { _rulerRAF = 0; drawRulers(); }); }
function niceStep(raw) { if (raw <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; }
function fmtRuler(v, step) { v = Math.abs(v) < 1e-9 ? 0 : v; return step >= 1 ? String(Math.round(v)) : step >= 0.1 ? v.toFixed(1) : v.toFixed(2); }
function posFixed(sel, l, t, w, h) { const e = $(sel); if (!e) return; e.style.left = l + 'px'; e.style.top = t + 'px'; e.style.width = w + 'px'; e.style.height = h + 'px'; }
function drawRulers() {
  if (!rulerOn || !pdfDoc) return;
  ['#rulerH', '#rulerV', '#rulerCorner'].forEach(s => { const e = $(s); if (e) e.hidden = false; });
  const pagesEl = $('#pages'); if (!pagesEl) return; const pr = pagesEl.getBoundingClientRect();
  const pv = pageViews.find(p => p.num === curPage()) || pageViews[0]; if (!pv) return;
  const wr = pv.wrap.getBoundingClientRect(), RW = 20;
  const scaleSet = !!docScale, valPerPt = scaleSet ? docScale.perPt : PT2MM;   // m/pt oder mm/pt
  const cc = $('#rulerCorner'); if (cc) cc.textContent = scaleSet ? 'm' : 'mm';
  posFixed('#rulerH', pr.left, pr.top, Math.max(0, pr.width - RW), RW);
  posFixed('#rulerV', pr.right - RW, pr.top, RW, pr.height);
  posFixed('#rulerCorner', pr.right - RW, pr.top, RW, RW);
  drawAxis($('#rulerH'), true, pr.width - RW, RW, wr.left - pr.left, wr.width / pv.pageW, pv.pageW, valPerPt);
  drawAxis($('#rulerV'), false, RW, pr.height, wr.top - pr.top, wr.height / pv.pageH, pv.pageH, valPerPt);
}
function drawAxis(cv, horiz, cssW, cssH, pageStartRel, pxPerPt, pageLenPt, valPerPt) {
  if (!cv || pxPerPt <= 0) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  cv.width = Math.max(1, Math.round(cssW * dpr)); cv.height = Math.max(1, Math.round(cssH * dpr));
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = '#f4f1ec'; ctx.fillRect(0, 0, cssW, cssH);
  ctx.strokeStyle = '#b9bcb3'; ctx.fillStyle = '#6a6f64'; ctx.lineWidth = 1; ctx.font = '8.5px sans-serif'; ctx.textBaseline = 'top';
  const pxPerVal = pxPerPt / valPerPt, step = niceStep(58 / pxPerVal), maxVal = pageLenPt * valPerPt;
  for (let v = 0; v <= maxVal + 1e-6; v += step) {
    const pos = pageStartRel + (v / valPerPt) * pxPerPt; if (pos < -1 || pos > (horiz ? cssW : cssH) + 1) continue;
    const lbl = fmtRuler(v, step);
    ctx.beginPath();
    if (horiz) { ctx.moveTo(pos, cssH); ctx.lineTo(pos, cssH - 9); ctx.stroke(); ctx.fillText(lbl, pos + 2, 2); }
    else { ctx.moveTo(cssW, pos); ctx.lineTo(cssW - 9, pos); ctx.stroke(); ctx.fillText(lbl, 2, pos + 2); }
  }
}
/* ---------- cm-Raster (zum Nachzeichnen, verschiebbar) ---------- */
let gridOn = false, gridMove = false, gridCellCm = 1, gridOffX = 0, gridOffY = 0, _gridRAF = 0;
let snapLayersOn = true;   // Einrasten auf Wand-Schichtkanten (Hilfsnetz) beim Zeichnen von Decke/Linie/Wand
function toggleGrid() {
  gridOn = !gridOn; const b = $('#btnGrid'); if (b) b.classList.toggle('on', gridOn); const b2 = $('#btnGrid2'); if (b2) b2.classList.toggle('on', gridOn);
  $('#gridCv').hidden = !gridOn; $('#gridBar').hidden = !gridOn;
  if (!gridOn) { gridMove = false; $('#gridMoveBtn').classList.remove('on'); }
  updateGridPE(); if (gridOn) drawGrid();
}
function updateGridPE() { const c = $('#gridCv'); if (c) c.style.pointerEvents = (gridOn && gridMove) ? 'auto' : 'none'; }
function scheduleGrid() { if (!gridOn || _gridRAF) return; _gridRAF = requestAnimationFrame(() => { _gridRAF = 0; drawGrid(); }); }
function gridCellPt() { return gridCellCm * (docScale ? (0.01 / docScale.perPt) : (10 / PT2MM)); }   // 1 cm in PDF-Punkten (real oder Papier)
function drawGrid() {
  if (!gridOn || !pdfDoc) return; const cv = $('#gridCv'); cv.hidden = false;
  const pagesEl = $('#pages'); if (!pagesEl) return; const pr = pagesEl.getBoundingClientRect();
  const pv = pageViews.find(p => p.num === curPage()) || pageViews[0]; if (!pv) return; const wr = pv.wrap.getBoundingClientRect();
  posFixed('#gridCv', pr.left, pr.top, pr.width, pr.height);
  const dpr = Math.min(window.devicePixelRatio || 1, 2); cv.width = Math.round(pr.width * dpr); cv.height = Math.round(pr.height * dpr);
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, pr.width, pr.height);
  const pxPerPt = wr.width / pv.pageW, cellPx = gridCellPt() * pxPerPt; if (cellPx < 3) return;   // zu eng → nicht zeichnen
  const originX = (wr.left - pr.left) + gridOffX * pxPerPt, originY = (wr.top - pr.top) + gridOffY * pxPerPt;
  ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(70,100,60,.28)';
  let x = originX % cellPx; if (x < 0) x += cellPx; for (; x <= pr.width; x += cellPx) { ctx.beginPath(); ctx.moveTo(Math.round(x) + .5, 0); ctx.lineTo(Math.round(x) + .5, pr.height); ctx.stroke(); }
  let y = originY % cellPx; if (y < 0) y += cellPx; for (; y <= pr.height; y += cellPx) { ctx.beginPath(); ctx.moveTo(0, Math.round(y) + .5); ctx.lineTo(pr.width, Math.round(y) + .5); ctx.stroke(); }
}
function startGridDrag(e) {
  if (!gridMove) return; e.preventDefault();
  const pv = pageViews.find(p => p.num === curPage()) || pageViews[0]; if (!pv) return; const pxPerPt = pv.wrap.getBoundingClientRect().width / pv.pageW;
  const sx = e.clientX, sy = e.clientY, ox = gridOffX, oy = gridOffY;
  const mv = ev => { gridOffX = ox + (ev.clientX - sx) / pxPerPt; gridOffY = oy + (ev.clientY - sy) / pxPerPt; drawGrid(); };
  const up = () => { document.removeEventListener('pointermove', mv); document.removeEventListener('pointerup', up); };
  document.addEventListener('pointermove', mv); document.addEventListener('pointerup', up);
}
// Eine Anmerkung auf alle anderen Seiten kopieren (Logo/Fusszeile/Stempel etc.)
function annoToAllPages(pv, id) {
  const a = findAnno(pv.num, id); if (!a || !pdfDoc) return; pushUndo(); let cnt = 0;
  for (let n = 1; n <= pdfDoc.numPages; n++) { if (n === pv.num) continue; const copy = JSON.parse(JSON.stringify(a)); copy.id = nextId++; pushAnno(n, copy); cnt++; }
  pageViews.forEach(drawAnnos); refreshComments(); saveState(); toast('Auf ' + cnt + ' weitere Seite(n) kopiert ✓');
}
/* ---------- Bild anpassen (Helligkeit/Kontrast/Graustufen/Drehen) ---------- */
let _iaCtx = null;
function openImgAdjust(pv, a) {
  if (a.orig == null) a.orig = a.data; if (!a.f) a.f = { b: 100, c: 100, g: 0 };
  _iaCtx = { pv, a }; pushUndo();
  $('#iaB').value = a.f.b; $('#iaC').value = a.f.c; $('#iaG').value = a.f.g;
  $('#imgAdjDlg').hidden = false;
}
function applyImgFilters() {
  if (!_iaCtx) return; const { pv, a } = _iaCtx; a.f = { b: +$('#iaB').value, c: +$('#iaC').value, g: +$('#iaG').value };
  const im = new Image(); im.onload = () => { const cv = document.createElement('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight; const ctx = cv.getContext('2d'); ctx.filter = `brightness(${a.f.b}%) contrast(${a.f.c}%) grayscale(${a.f.g}%)`; ctx.drawImage(im, 0, 0); a.data = cv.toDataURL('image/png'); drawAnnos(pv); }; im.src = a.orig;
}
function rotateImg() {
  if (!_iaCtx) return; const { pv, a } = _iaCtx;
  const im = new Image(); im.onload = () => { const cv = document.createElement('canvas'); cv.width = im.naturalHeight; cv.height = im.naturalWidth; const ctx = cv.getContext('2d'); ctx.translate(cv.width / 2, cv.height / 2); ctx.rotate(Math.PI / 2); ctx.drawImage(im, -im.naturalWidth / 2, -im.naturalHeight / 2); a.orig = cv.toDataURL('image/png'); const t = a.w; a.w = a.h; a.h = t; applyImgFilters(); }; im.src = a.orig;
}
function hideCtx() { $('#ctxmenu').hidden = true; }
// Kanonische Geometrie: aus einer gezeichneten Linie/Messlinie/Wandbelag nahtlos eine echte Wand machen
// (bekommt Stärke → danach Fenster/Türen einfügen + 3D). Endpunkte bleiben, additive Umwandlung.
function convertLineToWall(pv, annoId) {
  const a = findAnno(pv.num, annoId); if (!a || a.x1 == null) return;
  pushUndo();
  a.type = 'wall'; a.thick = wallThickPts(); a.just = wallJust; a.width = 1.4; a.dim = wallDimOn;
  a.fill = (wallHatch && wallHatch.fill) || '#ffffff'; a.color = (wallHatch && wallHatch.color) || a.color || '#1c242c';
  a.hatch = wallHatch ? { ...wallHatch } : null;
  delete a.wallface; delete a.belag; delete a.height; delete a.label; delete a.aufbau;   // Belag-/Mess-Reste entfernen
  if (wallBuildup) applyWallBuildup(a, wallBuildup.layers, wallBuildup.spacing);   // Standard-Aufbau (falls gesetzt)
  sel = { num: pv.num, id: annoId }; markDirty(); pageViews.forEach(drawAnnos); saveState();
  _listTab = 'sel'; if (typeof openListPanel === 'function') openListPanel('sel');
  toast('Linie ist jetzt eine Wand – Stärke rechts einstellen, dann Fenster/Türen einfügen und „3D" ansehen.');
}
// Kanonische Geometrie: aus einer bestehenden Wand direkt einen Wandbelag (Plättli-Fläche) ableiten – nutzt Länge + Höhe der Wand
function wallToWallface(pv, annoId) {
  const w = findAnno(pv.num, annoId); if (!w || w.type !== 'wall') return;
  pushUndo();
  const a = { id: nextId++, type: 'measure', x1: w.x1, y1: w.y1, x2: w.x2, y2: w.y2, color: '#2f6ea3', width: 1.6, wallface: true, height: w.h3d || wallHeightM || 2.5, belag: { ...DEFAULT_BELAG }, layer: w.layer };
  pushAnno(pv.num, a);
  sel = { num: pv.num, id: a.id }; setTool('select'); markDirty(); pageViews.forEach(drawAnnos); saveState();
  _listTab = 'sel'; if (typeof openListPanel === 'function') openListPanel('sel');
  toast('Wandbelag aus der Wand abgeleitet (Länge × Höhe) – Höhe/Platten rechts anpassen.');
}
function showCtx(x, y, pv, annoId) {
  const m = $('#ctxmenu'); m.innerHTML = '';
  const add = (label, mi, act, cls) => { const b = document.createElement('button'); if (cls) b.className = cls; b.innerHTML = `<span class="mi">${mi}</span><span>${label}</span>`; b.onclick = () => { hideCtx(); act(); }; m.appendChild(b); };
  const sep = () => { const d = document.createElement('div'); d.className = 'sep'; m.appendChild(d); };
  const _lockedCa = annoId && findAnno(pv.num, annoId);
  if (annoId && _lockedCa && _lockedCa.locked) {
    add('Entsperren (Plan-Element)', '🔓', () => { pushUndo(); _lockedCa.locked = false; sel = { num: pv.num, id: annoId }; pageViews.forEach(drawAnnos); saveState(); });
    add('Löschen', '🗑', () => { pushUndo(); const arr = getAnnos(pv.num), i = arr.findIndex(a => a.id === annoId); if (i >= 0) arr.splice(i, 1); pageViews.forEach(drawAnnos); saveState(); }, 'danger');
    sep();
  } else if (annoId) {
    add('Löschen', '🗑', () => { sel = { num: pv.num, id: annoId }; deleteSel(); }, 'danger');
    add('Farbe ändern', '🎨', () => $('#colorPick').click());
    add('Duplizieren', '⧉', () => duplicateAnno(pv, annoId));
    add('Auf alle Seiten', '▤', () => annoToAllPages(pv, annoId));
    add('Kopieren', '⧉', () => { sel = { num: pv.num, id: annoId }; copySel(); });
    add('Nach vorne', '⬆', () => reorderAnno(pv, annoId, true));
    add('Nach hinten', '⬇', () => reorderAnno(pv, annoId, false));
    const ca = findAnno(pv.num, annoId);
    if (ca && (ca.type === 'line' || ca.type === 'arrow' || ca.type === 'measure')) { add('→ In Wand umwandeln', '🧱', () => convertLineToWall(pv, annoId)); }   // nahtlos: Linie → Wand (Stärke, dann Fenster/Türen, 3D)
    if (ca && ca.type === 'wall') { add('→ Wandbelag ableiten (Plättli)', '⌗', () => wallToWallface(pv, annoId)); }   // Wand → Wandfläche fürs Plättlibudget (Länge × Höhe)
    if (ca && ca.type === 'img') { add('Bild anpassen …', '◑', () => openImgAdjust(pv, ca)); add((ca.opacity != null && ca.opacity < 1) ? 'Volle Deckkraft' : 'Als Vorlage dimmen (nachzeichnen)', '◐', () => { pushUndo(); ca.opacity = (ca.opacity != null && ca.opacity < 1) ? 1 : 0.3; reorderAnno(pv, annoId, false); drawAnnos(pv); saveState(); }); }
    sep();
  } else if (clipAnno) {
    add('Einfügen', '⎘', pasteAnno);
    sep();
  }
  // Werkzeuge als kompakte Icon-Reihe
  const grp = document.createElement('div'); grp.className = 'grp';
  [['select', '↖', 'Auswählen'], ['text', 'T', 'Text'], ['note', '💬', 'Kommentar'], ['pen', '✎', 'Stift'], ['line', '╱', 'Linie'], ['arrow', '➔', 'Pfeil'], ['rect', '▭', 'Rechteck'], ['oval', '◯', 'Oval']]
    .forEach(([t, ic, ti]) => { const b = document.createElement('button'); b.title = ti; b.innerHTML = ic; b.onclick = () => { hideCtx(); setTool(t); }; grp.appendChild(b); });
  m.appendChild(grp);
  sep();
  add('Seite 90° links drehen', '⟲', () => rotatePage(-90));
  add('Seite 90° rechts drehen', '⟳', () => rotatePage(90));
  add('Seite als Bild (PNG)', '🖼', () => exportPagePng(pv.num));
  add('Als SVG (Vektor/Logo)', '✦', () => exportSVG(pv.num));
  add('Seitenzahlen einfügen', '#', addPageNumbers);
  sep();
  add('Öffnen', '📂', openPicker);
  add('Speichern (PDF)', '💾', save);
  m.hidden = false;
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.min(x, window.innerWidth - w - 8) + 'px';
  m.style.top = Math.min(y, window.innerHeight - h - 8) + 'px';
}
function duplicateAnno(pv, id) { const a = findAnno(pv.num, id); if (!a) return; pushUndo(); const c = JSON.parse(JSON.stringify(a)); c.id = nextId++; translateAnno(c, JSON.parse(JSON.stringify(c)), 12, 12); pushAnno(pv.num, c); sel = { num: pv.num, id: c.id }; drawAnnos(pv); refreshComments(); }
// Ebene: Zeichenreihenfolge = Stapel; ans Ende = vorne, an den Anfang = hinten
function reorderAnno(pv, id, toFront) { const arr = getAnnos(pv.num), i = arr.findIndex(a => a.id === id); if (i < 0) return; pushUndo(); const [a] = arr.splice(i, 1); if (toFront) arr.push(a); else arr.unshift(a); drawAnnos(pv); }
let clipAnno = null;
function copySel() { if (!sel) return; const a = findAnno(sel.num, sel.id); if (a) { clipAnno = JSON.parse(JSON.stringify(a)); toast('Kopiert'); } }
function pasteAnno() { if (!clipAnno) return; const n = curPage(), pv = pageViews.find(p => p.num === n); if (!pv) return; pushUndo(); const c = JSON.parse(JSON.stringify(clipAnno)); c.id = nextId++; translateAnno(c, JSON.parse(JSON.stringify(c)), 14, 14); pushAnno(n, c); sel = { num: n, id: c.id }; drawAnnos(pv); refreshComments(); }

/* ---------- Tastenkürzel-Hilfe ---------- */
function toggleShortcuts() {
  const ex = $('#shortcutsDlg'); if (ex) { ex.remove(); return; }
  const rows = [
    ['Werkzeuge', ''], ['Auswählen / Verschieben', 'V'], ['Text-Box schreiben', 'T'], ['Stift / Freihand', 'S'], ['Radierer', 'E'], ['Linie', 'L'], ['Pfeil', 'P'], ['Rechteck', 'R'], ['Oval', 'O'], ['Wand', 'W'], ['Text markieren / Marker', 'H'], ['Messen', 'M'], ['Kommentar', 'K'],
    ['Zeichnen & Wände', ''], ['Exakte Länge eingeben (Linie/Wand)', 'L'], ['Wand-Dicke eingeben (cm)', 'D'], ['Raumzug zeichnen', 'Wand: klicken–klicken'], ['Raum schliessen → m²', 'zurück auf Start klicken'], ['Kette/Raum beenden', 'Doppelklick · Enter · Esc'], ['Einrasten: waagrecht/45°/senkrecht', 'automatisch'], ['15°-Schritte / frei (kein Einrasten)', 'Umschalt / Alt'],
    ['Bearbeiten', ''], ['Rückgängig / Wiederherstellen', 'Strg+Z / Strg+Y'], ['Kopieren / Einfügen', 'Strg+C / Strg+V'], ['Duplizieren', 'Strg+D'], ['Löschen', 'Entf'], ['Verschieben (fein/grob)', '← ↑ → ↓ / + Umschalt'], ['Text bearbeiten', 'Doppelklick / 2× Klick'],
    ['Datei & Ansicht', ''], ['Öffnen', 'Strg+O'], ['Speichern', 'Strg+S'], ['Suchen', 'Strg+F'], ['Drucken', 'Strg+P'], ['Zoom +/− (5%) / Passt', 'Strg + / − / 0'], ['Zoom (unten links): % eingeben', 'Klick auf %'], ['Hand / Verschieben der Ansicht', 'Leertaste'], ['Abbrechen / Schliessen', 'Esc'],
  ];
  const m = document.createElement('div'); m.className = 'modal'; m.id = 'shortcutsDlg';
  let body = '<div class="modal-card"><div class="modal-head">Tastenkürzel</div><div class="sc-grid">';
  for (const [label, key] of rows) body += key === '' ? `<div class="sc-h">${label}</div>` : `<span>${label}</span><kbd>${key}</kbd>`;
  body += '</div><div class="modal-act"><span class="grow"></span><button class="btn primary" id="scClose">Schliessen</button></div></div>';
  m.innerHTML = body; document.body.appendChild(m);
  const close = () => m.remove();
  m.addEventListener('pointerdown', e => { if (e.target === m) close(); });
  $('#scClose').onclick = close;
}

/* ---------- Zwei Dokumente nebeneinander (Split) ---------- */
const EMBED = new URLSearchParams(location.search).has('embed');   // läuft dieses Fenster als Split-Bereich?
let splitOn = false;
function toggleSplit() {
  if (EMBED) return;
  if (splitOn) return exitSplit();
  splitOn = true; document.body.classList.add('split-mode');
  const v = document.createElement('div'); v.id = 'splitView'; v.className = 'split-view';
  v.innerHTML = '<div class="split-bar"><img class="logomark" src="icon.png" alt=""><b>Nebeneinander</b><span class="grow"></span><button class="btn" id="splitExit">✕ Split beenden</button></div>'
    + '<div class="split-body"><div class="split-pane" id="paneL"><iframe src="index.html?embed=1"></iframe></div><div class="split-divider" id="splitDiv"></div><div class="split-pane" id="paneR"><iframe src="index.html?embed=1"></iframe></div></div>';
  document.body.appendChild(v);
  $('#splitExit').onclick = exitSplit;
  const lf = $('#paneL iframe');                                   // aktuelles Dokument in den linken Bereich übernehmen
  if (curBytes) { const bytes = curBytes.slice(), name = docName; lf.addEventListener('load', () => { try { lf.contentWindow.postMessage({ type: 'submitpdf-open', bytes, name }, location.origin); } catch (_) { } }, { once: true }); }
  setupDivider();
}
function exitSplit() { splitOn = false; document.body.classList.remove('split-mode'); const v = $('#splitView'); if (v) v.remove(); }
function setupDivider() {
  const div = $('#splitDiv'), body = $('.split-body'), L = $('#paneL'), R = $('#paneR'); let drag = false;
  div.addEventListener('pointerdown', e => { drag = true; div.setPointerCapture(e.pointerId); e.preventDefault(); });
  div.addEventListener('pointermove', e => { if (!drag) return; const r = body.getBoundingClientRect(); let f = (e.clientX - r.left) / r.width; f = Math.max(.2, Math.min(.8, f)); L.style.flex = f + ' 1 0'; R.style.flex = (1 - f) + ' 1 0'; });
  div.addEventListener('pointerup', () => drag = false);
}
// Im Embed-Bereich: Split/Suite/Installieren ausblenden + Dokument per Nachricht entgegennehmen
if (EMBED) document.body.classList.add('embed');
window.addEventListener('message', e => {
  if (e.origin !== location.origin) return; const d = e.data;
  if (d && d.type === 'submitpdf-open' && d.bytes && window.openNativeBytes) window.openNativeBytes(d.bytes, d.name);
});

/* ---------- Suche im Dokument (Strg+F) ---------- */
let searchMatches = [], searchIdx = -1, _searchCache = {}, _findT = null, _searchTok = 0;
function openFind() { const b = $('#findBar'); b.hidden = false; const i = $('#findInput'); i.focus(); i.select(); if (i.value) runSearch(i.value); }
function closeFind() { $('#findBar').hidden = true; $('#findHL').hidden = true; searchMatches = []; searchIdx = -1; }
function updateFindCount() { $('#findCount').textContent = searchMatches.length ? (searchIdx + 1) + ' / ' + searchMatches.length : ($('#findInput').value ? 'keine' : ''); }
async function pageSearchData(n) {
  if (_searchCache[n]) return _searchCache[n];
  let page; try { page = await pdfDoc.getPage(n); } catch (_) { return _searchCache[n] = { joined: '', ranges: [] }; }
  const ph = page.getViewport({ scale: 1 }).height; let tc; try { tc = await page.getTextContent(); } catch (_) { return _searchCache[n] = { joined: '', ranges: [] }; }
  let joined = ''; const ranges = [];
  for (const it of tc.items) { if (!it.str) continue; const s = joined.length; joined += it.str; const tr = it.transform, fs = Math.hypot(tr[1], tr[3]) || it.height || 10; ranges.push({ s, e: joined.length, x: tr[4], y: (ph - tr[5]) - fs * 0.82, w: it.width || fs, h: fs * 1.2 }); }
  return _searchCache[n] = { joined, ranges };
}
async function runSearch(q) {
  q = (q || '').trim(); searchMatches = []; searchIdx = -1;
  if (!q || !pdfDoc) { updateFindCount(); $('#findHL').hidden = true; return; }
  const ql = q.toLowerCase(), token = ++_searchTok;
  for (let n = 1; n <= pdfDoc.numPages; n++) {
    const { joined, ranges } = await pageSearchData(n);
    if (token !== _searchTok) return;                     // neuere Suche → abbrechen
    if (!joined) continue;
    const lower = joined.toLowerCase(); let from = 0, idx;
    while ((idx = lower.indexOf(ql, from)) !== -1) {
      const end = idx + ql.length;
      const rects = ranges.filter(r => r.e > idx && r.s < end).map(r => ({ x: r.x, y: r.y, w: r.w, h: r.h }));
      if (rects.length) searchMatches.push({ page: n, rects });
      from = end;
      if (searchMatches.length > 3000) break;
    }
    if (searchMatches.length > 3000) break;
  }
  updateFindCount();
  if (searchMatches.length) gotoMatch(0); else $('#findHL').hidden = true;
}
function gotoMatch(i) {
  if (!searchMatches.length) return;
  searchIdx = (i + searchMatches.length) % searchMatches.length;
  const m = searchMatches[searchIdx], pv = pageViews.find(p => p.num === m.page);
  if (pv) pv.wrap.scrollIntoView({ behavior: 'auto', block: 'center' });
  updateFindCount(); requestAnimationFrame(positionFindHL);
}
function positionFindHL() {
  const hl = $('#findHL'), m = searchMatches[searchIdx]; if (!m) { hl.hidden = true; return; }
  const pv = pageViews.find(p => p.num === m.page), ctm = pv && pv.svg.getScreenCTM(); if (!ctm) { hl.hidden = true; return; }
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity; const pt = pv.svg.createSVGPoint();
  for (const r of m.rects) for (const [px, py] of [[r.x, r.y], [r.x + r.w, r.y + r.h]]) { pt.x = px; pt.y = py; const q = pt.matrixTransform(ctm); minx = Math.min(minx, q.x); maxx = Math.max(maxx, q.x); miny = Math.min(miny, q.y); maxy = Math.max(maxy, q.y); }
  hl.style.left = (minx - 2) + 'px'; hl.style.top = (miny - 1) + 'px'; hl.style.width = (maxx - minx + 4) + 'px'; hl.style.height = (maxy - miny + 2) + 'px'; hl.hidden = false;
}

/* ---------- Verdrahtung ---------- */
function wire() {
  loadLogoData(); loadPolyClip();
  $('#btnLayers').onclick = toggleLayerPanel;
  $('#lpAdd').onclick = () => { const id = newLayerId(); layers.push({ id, name: 'Ebene ' + (layers.length + 1), visible: true }); activeLayerId = id; renderLayerPanel(); markDirty(); };
  $('#lpDup').onclick = duplicateLayerUp;
  // Ribbon: Reiter umschalten + Werkzeugreihe ein-/ausklappen
  $$('.rib-tab').forEach(b => b.onclick = () => { activateRibTab(b.dataset.tab); document.body.classList.remove('rib-collapsed'); });
  $('#ribCollapse').onclick = () => { document.body.classList.toggle('rib-collapsed'); requestAnimationFrame(syncToolbarHeight); };
  try { const tb = document.getElementById('toolbar'); if (tb && window.ResizeObserver) new ResizeObserver(() => syncToolbarHeight()).observe(tb); } catch (_) { }   // Toolbar-Umbruch (Fensterbreite) → Höhe darunter mitführen
  try { const hostEl = document.getElementById('pages'); if (hostEl && window.ResizeObserver) new ResizeObserver(() => { if (zoom === 'auto' && pdfDoc) reflow(); }).observe(hostEl); } catch (_) { }   // Vorschau-Feld ändert Breite (linke Palette/Panels/Fenster) → alle Seiten neu einpassen (auch Seite 1!)
  // Planungs-Leiste: Wandstärke / Masslinie / Farbe / Öffnungs-Breite – Standard ODER Auswahl
  $('#pbThick').onchange = () => { const v = parseFloat(($('#pbThick').value || '').replace(',', '.')); if (!(v > 0)) return updatePlanBar(); const pts = cmToPts(v); lastWallThick = pts; const a = selWall(); if (a) { pushUndo(); a.thick = pts; pageViews.forEach(drawAnnos); saveState(); } else updatePlanBar(); };
  $('#pbDim').onclick = () => { const a = selWall(); if (a) { pushUndo(); a.dim = !a.dim; wallDimOn = a.dim; pageViews.forEach(drawAnnos); saveState(); } else { wallDimOn = !wallDimOn; updatePlanBar(); } };
  $$('#pbWall .pb-j').forEach(b => b.onclick = () => { wallJust = b.dataset.just; const a = selWall(); if (a) { pushUndo(); a.just = wallJust; pageViews.forEach(drawAnnos); saveState(); } else updatePlanBar(); });
  $('#pbDimOff').onchange = () => { const v = parseFloat(($('#pbDimOff').value || '').replace(',', '.')); if (v >= 0) { wallDimOffCm = v; pageViews.forEach(drawAnnos); saveState(); } };
  $('#pbDimGap').onchange = () => { const v = parseFloat(($('#pbDimGap').value || '').replace(',', '.')); if (v >= 0) { wallDimGap = v; pageViews.forEach(drawAnnos); saveState(); } };
  $('#pbWallDisp').onchange = () => { const v = $('#pbWallDisp').value, a = selWall(); if (!a) return; pushUndo(); if (v === 'simple') a.simple = true; else if (v === 'detail') a.simple = false; else delete a.simple; pageViews.forEach(drawAnnos); saveState(); };
  $('#pbSchalH').onchange = () => { const v = parseFloat(($('#pbSchalH').value || '').replace(',', '.')); if (!(v >= 4)) return; const a = selWall(); if (a) { pushUndo(); a.schalH = v; saveState(); toast('Schalung Bretthöhe ' + v + ' cm – im 3D sichtbar'); } };
  $('#pbHatch').onchange = () => { const t = $('#pbHatch').value, d = HATCH_DEF[t] || {}; wallHatch = t ? { type: t, scale: lastHatchScale, w: 0.8, color: d.color || style.color, fill: d.fill || null } : null; const a = selWall(); if (a) { pushUndo(); applyMaterial(a, t); pageViews.forEach(drawAnnos); saveState(); } };
  $('#foot3d').onclick = open3D;
  $('#footIFC').onclick = importIFCFile;
  $('#footGIS').onclick = importGISFile;
  $('#smPdfWalls').onclick = detectWallsFromPdf;
  $('#smIfcReopen').onclick = () => { if (window._ifc) open3DIFC(window._ifc); else toast('Noch kein IFC importiert – zuerst „IFC importieren".'); };
  $('#smOpen').onclick = openPicker;
  { const tb = $('#smTestScene'); if (tb) tb.onclick = () => buildExampleProject(); }
  { const sb = $('#smSolidCut'); if (sb) { sb.classList.toggle('on', USE_SOLID); sb.onclick = () => { USE_SOLID = !USE_SOLID; sb.classList.toggle('on', USE_SOLID); (pageViews || []).forEach(pv => { try { drawAnnos(pv); } catch (_) { } }); toast(USE_SOLID ? 'Schnitt: kanonische Geometrie (Standard)' : 'Schnitt: Alt-Logik (Fallback)'); }; } }
  { const mb = $('#smMeshSlice'); if (mb) mb.onclick = () => { const cur = meshSliceH != null ? String(meshSliceH) : '1.2'; const r = prompt('IFC-/3D-Höhenschnitt bei welcher Höhe (m)? Leer = aus:', cur); if (r === null) return; const v = parseFloat((r || '').replace(',', '.')); meshSliceH = (r.trim() === '' || isNaN(v)) ? null : v; mb.classList.toggle('on', meshSliceH != null); (pageViews || []).forEach(pv => { try { drawAnnos(pv); } catch (_) { } }); toast(meshSliceH != null ? ('Höhenschnitt bei ' + meshSliceH + ' m – schneidet das echte 3D-Modell') : 'Höhenschnitt aus'); }; }
  $('#smProject').onclick = openProjectDlg;
  $('#docProject').onclick = openProjectDlg;
  $('#projCancel').onclick = () => { $('#projDlg').hidden = true; };
  $('#projOk').onclick = () => { const p = $('#projName').value.trim(); if (!p) { $('#projName').focus(); return; } $('#projDlg').hidden = true; doProjectSave(p, $('#projSub').value, $('#projFile').value); };
  $('#projName').oninput = projPreviewUpd; $('#projSub').onchange = projPreviewUpd; $('#projFile').oninput = projPreviewUpd;
  $('#projName').onkeydown = e => { if (e.key === 'Enter') $('#projOk').click(); };
  $('#smHint3d').onclick = () => toast('OBJ-Export: unten „◳ 3D" öffnen → im 3D-Balken „⭳ OBJ".');
  { const tp = $('#smToPaper'); if (tp) tp.onclick = openPaperDlg; const tb = $('#btnToPaper'); if (tb) tb.onclick = openPaperDlg;
    const pc = $('#ppCancel'); if (pc) pc.onclick = () => { $('#paperDlg').hidden = true; };
    const pg = $('#ppGo'); if (pg) pg.onclick = () => {
      const scope = (document.querySelector('input[name="ppScope"]:checked') || {}).value || 'all';
      let nums = null;
      if (scope === 'cur') nums = [curPage()];
      else if (scope === 'range') { nums = parsePageRange($('#ppRange').value, pdfDoc.numPages); if (!nums.length) { toast('Bitte gültige Seiten angeben (z. B. 1-3, 5).'); return; } }
      $('#paperDlg').hidden = true; convertToPaper(nums);
    };
    const rg = $('#ppRange'); if (rg) { rg.onfocus = () => { const r = document.querySelector('input[name="ppScope"][value="range"]'); if (r) r.checked = true; }; rg.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); $('#ppGo').click(); } }; } }
  let planKind = 'kopf', planPos = 'br';
  $('#footPlan').onclick = e => { e.stopPropagation(); const p = $('#planPop'); p.hidden = !p.hidden; };
  $('#pbBuild').onclick = e => { e.stopPropagation(); const p = $('#buildPop'); if (p.hidden) openBuildPop(); else p.hidden = true; };
  $('#bpAdd').onclick = () => { buildDraft.push(['putz', 2]); renderBuildList(); };
  $('#bpApply').onclick = applyBuildup;
  $('#bpSingle').onclick = () => { wallBuildup = null; const a = selWall(); if (a) { pushUndo(); applyWallBuildup(a, null); applyMaterial(a, 'none'); pageViews.forEach(drawAnnos); saveState(); } $('#buildPop').hidden = true; };
  document.addEventListener('pointerdown', e => { if (!e.target.closest('#buildPop') && !e.target.closest('#pbBuild')) $('#buildPop').hidden = true; }, true);
  $('#footBW').onclick = () => { document.body.classList.toggle('bw'); $('#footBW').classList.toggle('on', document.body.classList.contains('bw')); };
  $('#footSimple').onclick = () => { simpleMode = !simpleMode; $('#footSimple').classList.toggle('on', simpleMode); pageViews.forEach(drawAnnos); toast(simpleMode ? 'Einfache Darstellung – Wände schwarz, Öffnungen als Symbol' : 'Detaillierte Darstellung (automatisch nach Aufbau)'); };
  $('#footPosNo').onclick = () => { if (!docScale) { toast('Erst Massstab setzen (1:n).'); return; } openPosOn = !openPosOn; $('#footPosNo').classList.toggle('on', openPosOn); pageViews.forEach(drawAnnos); toast(openPosOn ? 'Positionsnummern an (F1/T1 … wie in der Fensterliste)' : 'Positionsnummern aus'); };
  $('#footQty').onclick = openQuantities;
  $('#footSchedule').onclick = openSchedule;
  $('#footWallList').onclick = openWallList;
  $('#footRooms').onclick = openRoomList;
  { const si = $('#srInspect'); if (si) si.onclick = () => { const p = $('#listPanel'); if (p && p.hidden) openListPanel(); else closeListPanel(); }; const sc = $('#srComments'); if (sc) sc.onclick = () => { const b = $('#btnComments'); if (b && b.onclick) b.onclick(); const c = $('#comments'); sc.classList.toggle('on', !!(c && !c.hidden)); }; const cl = $('#lp2Close'); if (cl) cl.onclick = closeListPanel; const cp = $('#lp2Copy'); if (cp) cp.onclick = () => { if (_listCopyFn) _listCopyFn(); }; document.querySelectorAll('.lp2-tab').forEach(b => b.onclick = () => openListPanel(b.dataset.lt)); }   // rechte Rail: Listen/Inspector + Kommentare; Panel standardmäßig EINGEKLAPPT (spart Platz; per ▤ Listen öffnen)
  $('#footImportAnn').onclick = () => importPdfAnnotations(false);
  $('#footExportAnn').onclick = exportNative;
  $('#footPhase').onclick = e => { e.stopPropagation(); const p = $('#phasePop'); p.hidden = !p.hidden; if (!p.hidden) updatePhaseUI(); };
  $$('#phSet button').forEach(b => b.onclick = () => setActivePhase(b.dataset.ph || null));
  $$('#phView button').forEach(b => b.onclick = () => setPhaseView(b.dataset.pv));
  document.addEventListener('pointerdown', e => { if (!e.target.closest('#phasePop') && !e.target.closest('#footPhase')) $('#phasePop').hidden = true; }, true);
  $$('#ppKind button').forEach(b => b.onclick = () => { planKind = b.dataset.pk; $$('#ppKind button').forEach(x => x.classList.toggle('on', x === b)); $$('#planPop .pp-sec').forEach(s => s.hidden = s.dataset.for !== planKind); });
  $$('#ppGrid button').forEach(b => b.onclick = () => { planPos = b.dataset.pos; $$('#ppGrid button').forEach(x => x.classList.toggle('on', x === b)); });
  try { const pf = JSON.parse(localStorage.getItem('submitpdf-plankopf') || '{}'); if (pf.firma) $('#ppFirma').value = pf.firma; if (pf.gezeichnet) $('#ppGezeichnet').value = pf.gezeichnet; } catch (_) { }
  $('#ppInsert').onclick = () => {
    const fields = { projekt: $('#ppProjekt').value.trim(), plannr: $('#ppPlannr').value.trim(), gezeichnet: $('#ppGezeichnet').value.trim(), firma: $('#ppFirma').value.trim() };
    try { localStorage.setItem('submitpdf-plankopf', JSON.stringify({ firma: fields.firma, gezeichnet: fields.gezeichnet })); } catch (_) { }
    insertPlanParts({ kind: planKind, pos: planPos, frame: $('#ppFrame').checked, edge: $('#ppEdge').value, margin: parseFloat($('#ppMargin').value), bw: parseFloat($('#ppBW').value), color: $('#ppColor').value, fields });
    $('#planPop').hidden = true;
  };
  document.addEventListener('pointerdown', e => { if (!e.target.closest('#planPop') && !e.target.closest('#footPlan')) $('#planPop').hidden = true; }, true);
  $('#btnBlock').onclick = e => { e.stopPropagation(); const p = $('#blockPop'); p.hidden = !p.hidden; };
  { const bp = $('#btnProfile'); if (bp) bp.onclick = () => { openProfileEditor(spec => { curProfile = Object.assign({}, curProfile, spec, { closed: true }); setTool('profile'); toast('Profil „' + curProfile.name + '" gewählt – jetzt den Pfad klicken (rastet an Wandenden, am Start schliessen = ums Haus).'); }); }; }
  $$('#blockPop button').forEach(b => b.onclick = () => { blockKind = b.dataset.bk; $('#blockPop').hidden = true; setTool('block'); });
  document.addEventListener('pointerdown', e => { if (!e.target.closest('#blockPop') && !e.target.closest('#btnBlock') && !e.target.closest('#btnBlock2')) $('#blockPop').hidden = true; }, true);
  $('#pbWallH').onchange = () => { const v = parseFloat(($('#pbWallH').value || '').replace(',', '.')); if (!(v > 0)) return; wallHeightM = v; const a = selWall(); if (a) { pushUndo(); a.h3d = v; saveState(); } };
  $('#pbSill').onchange = () => { const v = parseFloat(($('#pbSill').value || '').replace(',', '.')); if (!(v >= 0)) return; const a = selOpen(); if (a) { pushUndo(); const ins = (inputLicht && a.kind === 'window') ? ptsToCm(openInsPts(a)) / 100 : 0; a.sill = Math.max(0, v - ins); pageViews.forEach(drawAnnos); saveState(); } };
  $('#pbHead').onchange = () => { const v = parseFloat(($('#pbHead').value || '').replace(',', '.')); if (!(v > 0)) return; const a = selOpen(); if (a) { pushUndo(); const ins = inputLicht ? ptsToCm(openInsPts(a)) / 100 : 0; a.head = v + ins; pageViews.forEach(drawAnnos); saveState(); } };
  $('#pbDepth').onchange = () => { let v = parseFloat(($('#pbDepth').value || '').replace(',', '.')); if (!(v >= 0)) return; const a = selOpen(); const thCm = ptsToCm((a && a.thick) || wallThickPts()) || 1; let f = Math.max(0, Math.min(1, v / thCm)); lastOpenDepth = f; if (a) { pushUndo(); a.depth = f; pageViews.forEach(drawAnnos); saveState(); } };
  $('#pbBoardVis').onchange = () => { const v = parseFloat(($('#pbBoardVis').value || '').replace(',', '.')); if (!(v >= 0)) return; const a = selOpen(); if (a) { pushUndo(); a.boardVis = v; pageViews.forEach(drawAnnos); saveState(); } };   // Abstand Laibung↔Rahmen (sichtbarer Rahmen)
  { const b = $('#pbBank'); if (b) b.onclick = () => { const a = selOpen(); if (a && a.kind === 'window') { pushUndo(); a.bank = (a.bank === false); pageViews.forEach(drawAnnos); updatePlanBar(); saveState(); } }; }
  { const b = $('#pbSims'); if (b) b.onclick = () => { const a = selOpen(); if (a && a.kind === 'window') { pushUndo(); a.sims = !a.sims; pageViews.forEach(drawAnnos); updatePlanBar(); saveState(); } }; }
  $('#pbBankOver').onchange = () => { const v = parseFloat(($('#pbBankOver').value || '').replace(',', '.')); if (!(v >= 0)) return; const a = selOpen(); if (a) { pushUndo(); a.bankOver = v; pageViews.forEach(drawAnnos); saveState(); } };
  $('#pbSlabBase').onchange = () => { const v = parseFloat(($('#pbSlabBase').value || '').replace(',', '.')); if (!(v >= 0)) return; const a = selSlab(); if (a) { pushUndo(); a.base = v; pageViews.forEach(drawAnnos); saveState(); } };
  $('#pbSlabThick').onchange = () => { const v = parseFloat(($('#pbSlabThick').value || '').replace(',', '.')); if (!(v > 0)) return; const a = selSlab(); if (a) { pushUndo(); a.thick = v / 100; if (a.layers) delete a.layers; pageViews.forEach(drawAnnos); saveState(); } };
  { const sb = $('#pbSlabBuildup'); if (sb) sb.onclick = () => openSlabBuildup(selSlab()); }
  const selStairs = () => { const a = sel && findAnno(sel.num, sel.id); return a && a.type === 'stairs' ? a : null; };
  $('#pbStairW').onchange = () => { const v = parseFloat(($('#pbStairW').value || '').replace(',', '.')); if (!(v > 0)) return; const pts = cmToPts(v); stairW = pts; const a = selStairs(); if (a) { pushUndo(); a.width = pts; pageViews.forEach(drawAnnos); saveState(); } };
  $('#pbStairRise').onchange = () => { const v = parseFloat(($('#pbStairRise').value || '').replace(',', '.')); if (!(v > 0)) return; stairRiseM = v; const a = selStairs(); if (a) { pushUndo(); a.rise = v; pageViews.forEach(drawAnnos); saveState(); } };
  $('#pbStairBase').onchange = () => { const v = parseFloat(($('#pbStairBase').value || '').replace(',', '.')); if (!(v >= 0)) return; stairBaseM = v; const a = selStairs(); if (a) { pushUndo(); a.base = v; saveState(); } };
  const selRoof = () => { const a = sel && findAnno(sel.num, sel.id); return a && a.type === 'roof' ? a : null; };
  $$('#pbRoof [data-rt]').forEach(b => b.onclick = () => { roofType = b.dataset.rt; const a = selRoof(); if (a) { pushUndo(); a.rtype = roofType; pageViews.forEach(drawAnnos); saveState(); } else updatePlanBar(); });
  $('#pbEave').onchange = () => { const v = parseFloat(($('#pbEave').value || '').replace(',', '.')); if (!(v >= 0)) return; roofEaveM = v; const a = selRoof(); if (a) { pushUndo(); a.eave = v; saveState(); } };
  $('#pbRidge').onchange = () => { const v = parseFloat(($('#pbRidge').value || '').replace(',', '.')); if (!(v > 0)) return; roofRidgeM = v; const a = selRoof(); if (a) { pushUndo(); a.ridge = v; saveState(); } };
  $('#pbAxis').onclick = () => { roofAxis = roofAxis === 'x' ? 'y' : 'x'; const a = selRoof(); if (a) { pushUndo(); a.axis = roofAxis; pageViews.forEach(drawAnnos); saveState(); } };
  $('#pbUnit').onclick = () => { dimUnit = !dimUnit; pageViews.forEach(drawAnnos); updatePlanBar(); saveState(); };
  { const b = $('#pbDimPutz'); if (b) b.onclick = () => { dimWithPlaster = !dimWithPlaster; pageViews.forEach(drawAnnos); updatePlanBar(); saveState(); }; }
  $('#pbWallColor').addEventListener('input', e => { const c = e.target.value; style.color = c; $('#colorDot').style.background = c; $('#pbWallDot').style.background = c; const a = selWall(); if (a) { a.color = c; if (a.hatch) a.hatch.color = c; pageViews.forEach(drawAnnos); } });
  $$('#pbOpen [data-ok]').forEach(b => b.onclick = () => { openKind = b.dataset.ok; const a = selOpen(); if (a) { pushUndo(); a.kind = openKind; pageViews.forEach(drawAnnos); saveState(); } else updatePlanBar(); });
  $('#pbWidth').onchange = () => { const v = parseFloat($('#pbWidth').value); if (!(v > 0)) return updatePlanBar(); const a = selOpen(); let pts = cmToPts(v); if (inputLicht) pts += 2 * openInsPts(a); lastOpenW = pts; if (a) { pushUndo(); a.w = pts; pageViews.forEach(drawAnnos); saveState(); } };
  $('#pbLichtRoh').onclick = () => { inputLicht = !inputLicht; $('#pbLichtRoh').classList.toggle('on', inputLicht); updatePlanBar(); toast(inputLicht ? 'Öffnungsbreite = Lichtmaß (Rohbau = Licht + Rahmen)' : 'Öffnungsbreite = Rohbaumaß'); };
  $('#pbFlip').onclick = () => { const a = selOpen(); if (!a) return; pushUndo(); flipOpening(a); pageViews.forEach(drawAnnos); saveState(); toast('Anschlag: Band ' + (a.winHinge === 'right' ? 'rechts' : 'links') + ', öffnet ' + ((a.swing || 1) === 1 ? 'innen' : 'aussen')); };
  $('#pbNiche').onclick = () => { const a = selOpen(); if (!a || a.kind !== 'window') { toast('Nische gibt es nur beim Fenster.'); return; } pushUndo(); a.niche = !a.niche; $('#pbNiche').classList.toggle('on', a.niche); saveState(); toast(a.niche ? 'Storennische an – im 3D sichtbar' : 'Storennische aus'); };
  $('#pbWinType').onchange = () => { const v = $('#pbWinType').value, a = selOpen(); if (a && a.kind === 'door') lastDoorType = v; else lastWinType = v; if (a && (a.kind === 'window' || a.kind === 'door')) { pushUndo(); a.winType = v; pageViews.forEach(drawAnnos); saveState(); } };
  $('#pbWinHinge').onchange = () => { const v = $('#pbWinHinge').value; lastWinHinge = v; const a = selOpen(); if (a && (a.kind === 'window' || a.kind === 'door')) { pushUndo(); a.winHinge = v; pageViews.forEach(drawAnnos); saveState(); } };
  const winProf = [['wpFrameW', 'frameW', 10], ['wpFrameD', 'frameD', 7], ['wpSashW', 'sashW', 7], ['wpSashD', 'sashD', 7], ['wpShift', 'sashShift', 4], ['wpRecess', 'sashRecess', 1], ['wpGlass', 'glassT', 2]];
  $('#pbWinMore').onclick = e => { e.stopPropagation(); const p = $('#winPop'); p.hidden = !p.hidden; if (!p.hidden) { const a = selOpen(); for (const [id, key, def] of winProf) $('#' + id).value = Math.round(ptsToCm(a && a[key] != null ? a[key] : cmToPts(def)) * 10) / 10; } };
  for (const [id, key] of winProf) $('#' + id).onchange = () => { const v = parseFloat(($('#' + id).value || '').replace(',', '.')); if (!(v >= 0)) return; const a = selOpen(); if (a && (a.kind === 'window' || a.kind === 'door')) { pushUndo(); a[key] = cmToPts(v); pageViews.forEach(drawAnnos); saveState(); } };
  document.addEventListener('pointerdown', e => { if (!e.target.closest('#winPop') && !e.target.closest('#pbWinMore')) $('#winPop').hidden = true; }, true);
  $('#pbOuterLap').onchange = () => { const v = parseFloat(($('#pbOuterLap').value || '').replace(',', '.')); if (!(v >= 0)) return; const a = selOpen(); if (a && (a.kind === 'window' || a.kind === 'door')) { pushUndo(); a.outerLap = cmToPts(v); pageViews.forEach(drawAnnos); saveState(); } };
  $('#pbInnerRev').onchange = () => { const v = parseFloat(($('#pbInnerRev').value || '').replace(',', '.')); if (!(v >= 0)) return; const a = selOpen(); if (a && (a.kind === 'window' || a.kind === 'door')) { pushUndo(); a.innerReveal = cmToPts(v); pageViews.forEach(drawAnnos); saveState(); } };
  $('#pbReveal').onchange = () => { const v = $('#pbReveal').value, a = selOpen(); if (a && (a.kind === 'window' || a.kind === 'door')) { pushUndo(); a.revealType = v; pageViews.forEach(drawAnnos); saveState(); } };
  { const ro = $('#pbRevealOut'); if (ro) ro.onchange = () => { const a = selOpen(); if (a && (a.kind === 'window' || a.kind === 'door')) { pushUndo(); a.revealOuter = ro.value; pageViews.forEach(drawAnnos); saveState(); } }; }
  $('#pbAnschlag').onchange = () => { const v = $('#pbAnschlag').value, a = selOpen(); if (a && (a.kind === 'window' || a.kind === 'door')) { pushUndo(); a.anschlagType = v; updatePlanBar(); pageViews.forEach(drawAnnos); saveState(); } };
  $('#pbLaibEdit').onclick = () => { const a = selOpen(), pv = sel && pageViews.find(p => p.num === sel.num); if (a && pv && (a.kind === 'window' || a.kind === 'door')) openLaibungEditor(a, pv); };
  $('#pbAnschlagD').onchange = () => { const v = parseFloat(($('#pbAnschlagD').value || '').replace(',', '.')); if (!(v >= 0)) return; const a = selOpen(); if (a && (a.kind === 'window' || a.kind === 'door')) { pushUndo(); a.anschlagDepth = cmToPts(v); pageViews.forEach(drawAnnos); saveState(); } };
  $('#pbWinMat').onchange = () => { const v = $('#pbWinMat').value, a = selOpen(); lastWinMat = v; if (a && (a.kind === 'window' || a.kind === 'door')) { pushUndo(); a.winMat = v; pageViews.forEach(drawAnnos); saveState(); } };
  $('#dropOpen').onclick = openPicker;
  $('#dropBlank').onclick = () => openSlidePicker('new');
  $('#btnNew').onclick = () => openSlidePicker('new');
  ['#iaB', '#iaC', '#iaG'].forEach(s => $(s).addEventListener('input', applyImgFilters));
  $('#iaRotate').onclick = rotateImg;
  $('#iaReset').onclick = () => { $('#iaB').value = 100; $('#iaC').value = 100; $('#iaG').value = 0; applyImgFilters(); };
  $('#iaDone').onclick = () => { $('#imgAdjDlg').hidden = true; saveState(); _iaCtx = null; };
  $('#btnDownload').onclick = () => { toast('Die Desktop-App (voller Funktionsumfang mit Datei-Verzeichnis) liefern wir von Anfang an mit – kommt in Kürze.'); };   // Platzhalter → später Tauri-.exe-Download
  $$('#sdFormats button').forEach(b => b.onclick = () => { $$('#sdFormats button').forEach(x => x.classList.remove('on')); b.classList.add('on'); renderSlidePreview(); });
  $$('#sdLayouts button').forEach(b => b.onclick = () => { $$('#sdLayouts button').forEach(x => x.classList.remove('on')); b.classList.add('on'); renderSlidePreview(); });
  $$('#sdBg button').forEach(b => b.onclick = () => { $$('#sdBg button').forEach(x => x.classList.remove('on')); b.classList.add('on'); renderSlidePreview(); });
  $('#sdCancel').onclick = () => $('#slideDlg').hidden = true;
  $('#sdOk').onclick = slideConfirm;
  $('#btnFolder').onclick = toggleFiles;
  $('#btnSplit').onclick = toggleSplit;
  $('#fpName').onclick = pickFolder;            // Ordnernamen klicken = (anderen) Ordner wählen
  $('#fpPickFolder').onclick = pickFolder;      // leerer Zustand: Ordner durchsuchen
  $('#fpOpenFile').onclick = openPicker;        // leerer Zustand: einzelne Datei öffnen
  $('#fpClose').onclick = () => { $('#work').classList.remove('files-open'); $('#btnFolder').classList.remove('on'); };
  $('#fpRefresh').onclick = () => { $('#fpSearch').value = ''; refreshTree(); };
  $('#fpSearch').addEventListener('input', e => onFolderSearch(e.target.value));
  $('#fileInput').onchange = e => { openFiles(e.target.files); e.target.value = ''; };
  $('#btnSave').onclick = save;
  $('#btnSend').onclick = openMail;
  $('#mSend').onclick = doSend;
  $('#mCancel').onclick = () => $('#mailDlg').hidden = true;
  $('#btnUndo').onclick = undo;
  $('#btnRedo').onclick = redo;
  $('#zoomIn').onclick = () => zoomStep(.05); $('#zoomOut').onclick = () => zoomStep(-.05); $('#zoomVal').onclick = promptZoom;
  $('#pages').addEventListener('scroll', () => { updatePageInd(); scheduleSharpen(); updateSelBar(); }, { passive: true });
  $('#pages').addEventListener('wheel', e => {     // Strg/Cmd + Mausrad (oder Trackpad-Pinch) = zum Zeiger zoomen
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    zoomToward(e.clientX, e.clientY, e.deltaY < 0 ? 1.05 : 1 / 1.05);   // feinere Abstufung
  }, { passive: false });
  // Handy: Zwei-Finger-Pinch zoomt zum Mittelpunkt, gleichzeitig verschieben
  const pg = $('#pages'); let pinch = null;
  pg.addEventListener('touchstart', e => { if (e.touches.length === 2) { const [a, b] = e.touches; pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), cx: (a.clientX + b.clientX) / 2, cy: (a.clientY + b.clientY) / 2 }; } }, { passive: true });
  pg.addEventListener('touchmove', e => {
    if (e.touches.length !== 2 || !pinch) return;
    e.preventDefault();
    const [a, b] = e.touches, d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), cx = (a.clientX + b.clientX) / 2, cy = (a.clientY + b.clientY) / 2;
    if (pinch.d > 0 && Math.abs(d / pinch.d - 1) > 0.012) { zoomToward(cx, cy, d / pinch.d); pinch.d = d; }
    pg.scrollLeft -= (cx - pinch.cx); pg.scrollTop -= (cy - pinch.cy); pinch.cx = cx; pinch.cy = cy;
  }, { passive: false });
  pg.addEventListener('touchend', e => { if (e.touches.length < 2) pinch = null; });
  window.addEventListener('resize', () => { if (zoom === 'auto') reflow(); });
  // Arbeit nicht verlieren: warnen beim Schliessen + Autosave beim Verlassen/Verstecken
  window.addEventListener('beforeunload', e => { saveActiveDoc(); if (dirty || docs.some(d => d.dirty)) { autosaveNow(); e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('pagehide', () => { saveActiveDoc(); autosaveNow(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { saveActiveDoc(); autosaveNow(); } });
  loadStyle(); applyStyleUI();   // zuletzt benutzte Farbe/Strichstärke/Textgrösse/Skizze-Modus wiederherstellen
  $$('.tool[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
  $('#penTidyBtn').onclick = () => { penTidy = !penTidy; $('#penTidyBtn').classList.toggle('on', penTidy); saveStyle(); toast(penTidy ? 'Skizze aufräumen: an' : 'Freihand: roh'); };
  $('#btnImg').onclick = pickImage;
  $('#btnSig').onclick = openSig;
  const sc = $('#sigCanvas');
  sc.addEventListener('pointerdown', e => { sc.setPointerCapture(e.pointerId); sigDown(e); });
  sc.addEventListener('pointermove', sigMove);
  sc.addEventListener('pointerup', sigUp); sc.addEventListener('pointercancel', sigUp);
  $('#sigClearBtn').onclick = sigClear;
  $('#sigCancel').onclick = () => $('#sigDlg').hidden = true;
  $('#sigUse').onclick = () => useSig(false);
  $('#sigUseSaved').onclick = () => useSig(true);
  $('#btnScale').onclick = () => openScale(0);
  $('#scaleCalibBtn').onclick = () => { $('#scaleDlg').hidden = true; setTool('calibrate'); toast('Bekannte Strecke im Plan einzeichnen …'); };
  $('#scaleCancel').onclick = () => { _scaleAfter = null; $('#scaleDlg').hidden = true; };
  $('#scaleOk').onclick = applyScale;
  $('#scaleReal').onkeydown = e => { if (e.key === 'Enter') applyScale(); };
  $('#scaleRatio').onkeydown = e => { if (e.key === 'Enter') applyScale(); };
  // Doppelklick auf Mass-/Masslinie → eigenes Mass eintragen
  $('#pages').addEventListener('dblclick', e => {
    if (viewOnly) return;   // Ansehen-Modus: kein Doppelklick-Bearbeiten
    if (editingId != null) return;   // schon im Bearbeiten-Modus (Klick hat bereits geöffnet)
    if (segDraft) { finishSegDraft(); return; }     // Doppelklick = Linie fertig
    if (wallDraft) { finishWallChain(); return; }   // Doppelklick = Wand-Kette fertig
    if (cdimDraft) { finishChaindim(); return; }   // Doppelklick = Kettenmass fertig
    if (penDraft) { if (penDraft.a.nodes.length >= 2) penDraft.a.nodes.pop(); finishCurve(); return; }   // Doppelklick = Kurve fertig
    const pnAttr = e.target.getAttribute && e.target.getAttribute('data-pn');
    const id = e.target.getAttribute && e.target.getAttribute('data-id'); if (!id) return;
    const wrap = e.target.closest('.pagewrap'); if (!wrap) return; const pv = pageViews.find(p => p.num === +wrap.dataset.n);
    const a = findAnno(pv.num, +id); if (!a) return;
    if (a.type === 'path') {                                          // Kurve: Knoten löschen / hinzufügen
      if (!sel || sel.id !== a.id) { sel = { num: pv.num, id: a.id }; drawAnnos(pv); return; }   // erst auswählen
      if (pnAttr !== null) { if (a.nodes.length > 2) { pushUndo(); a.nodes.splice(+pnAttr, 1); drawAnnos(pv); saveState(); } return; }
      const q = evtToPage(pv, e), hit = nearestOnPath(a, q.x, q.y);
      if (hit && hit.dist * pv.scale < 16) { pushUndo(); addPathNode(a, hit.seg, hit.t); drawAnnos(pv); saveState(); }
      return;
    }
    if (a.type === 'edit') { openEditEdit(pv, a, false); return; }   // bestehende Edit-Stelle erneut bearbeiten
    if (a.type === 'text') { openTextAnnoEdit(pv, a); return; }       // Text-Annotation bearbeiten
    if (a.type === 'imgph') { fillImgPlaceholder(pv, a); return; }    // Bild-Platzhalter füllen
    if (a.type === 'profile') { openProfileEditor(spec => { pushUndo(); a.prof = spec.prof; a.elev = spec.elev; a.name = spec.name; a.color = spec.color; a.mat = spec.mat; curProfile = Object.assign({}, curProfile, spec); drawAnnos(pv); saveState(); }, { prof: a.prof, elev: a.elev, name: a.name, color: a.color }); return; }   // Profil bearbeiten
    if (a.type === 'slab') { sel = { num: pv.num, id: a.id }; openSlabBuildup(a, pv); return; }   // Decke: Doppelklick → Schichtaufbau
    if (a.type !== 'dim' && a.type !== 'measure') return;
    const v = prompt('Mass-Beschriftung (leer = automatisch gemessen):', a.text || lenLabel(a)); if (v === null) return;
    pushUndo(); a.text = v.trim() || ''; drawAnnos(pv);
  });
  $('#delSel').onclick = deleteSel;
  // Fussleiste (Blatt-Funktionen)
  $('#qRotL').onclick = () => rotatePage(-90); $('#qRotR').onclick = () => rotatePage(90);
  $('#qCrop').onclick = () => setTool('crop');
  { const qs = $('#qSnip'); if (qs) qs.onclick = () => setTool('snip'); }
  { const bv = $('#btnView'); if (bv) bv.onclick = () => setViewOnly(!viewOnly); }
  $('#footScale').onclick = () => openScale(0);   // 1:n-Eingabe (nicht Kalibrieren)
  $('#footFormat').onclick = e => { e.stopPropagation(); const p = $('#fmtPop'); p.hidden = !p.hidden; };
  $$('#fmtPop button').forEach(b => b.onclick = () => { $('#fmtPop').hidden = true; if (b.dataset.mount) { const [va, ha] = b.dataset.mount.split('-'); mountOnSheet(va, ha); } else changePageFormat(+b.dataset.w, +b.dataset.h); });
  document.addEventListener('pointerdown', e => { if (!e.target.closest('#fmtPop') && !e.target.closest('#footFormat')) $('#fmtPop').hidden = true; }, true);
  $('#qFree').onclick = () => { const p = $('#freeRot'); p.hidden = !p.hidden; if (!p.hidden) { const n = curPage(); $('#freeRotRange').value = viewRot[n] || 0; $('#freeRotVal').textContent = ((viewRot[n] || 0) > 0 ? '+' : '') + (viewRot[n] || 0) + '°'; } };
  let _rotPushed = false;
  $('#freeRotRange').addEventListener('pointerdown', () => { _rotPushed = false; });
  $('#freeRotRange').oninput = e => { if (!_rotPushed) { pushUndo(); _rotPushed = true; } setFreeRot(+e.target.value); };
  $('#freeRotReset').onclick = () => { if ((viewRot[curPage()] || 0) !== 0) pushUndo(); $('#freeRotRange').value = 0; setFreeRot(0); };
  $('#qPrev').onclick = () => gotoPage(Math.max(1, curPage() - 1));
  $('#qNext').onclick = () => gotoPage(Math.min(pdfDoc ? pdfDoc.numPages : 1, curPage() + 1));
  // Rechtsklick-Menü
  $('#pages').addEventListener('contextmenu', e => {
    if (!pdfDoc) return; e.preventDefault();
    if (wallDraft) { finishWallChain(); return; }                    // Rechtsklick = Wandkette beenden
    if (segDraft) { finishSegDraft(); return; }                      // Rechtsklick = Linie/Wand beenden
    if (areaDraft) { finishArea(); return; }
    if (profDraft) { finishProfile(); return; }
    const wrap = e.target.closest('.pagewrap'); if (!wrap) return;
    const pv = pageViews.find(p => p.num === +wrap.dataset.n); if (!pv) return;
    const id = e.target.getAttribute && e.target.getAttribute('data-id');
    if (id) { sel = { num: pv.num, id: +id }; drawAnnos(pv); }
    showCtx(e.clientX, e.clientY, pv, id ? +id : null);
  });
  document.addEventListener('pointerdown', e => { if (!e.target.closest('#ctxmenu')) hideCtx(); }, true);
  $('#pages').addEventListener('scroll', hideCtx, { passive: true });
  $('#pages').addEventListener('scroll', () => { if (!$('#findBar').hidden) positionFindHL(); }, { passive: true });
  // Suche im Dokument
  $('#findInput').addEventListener('input', e => { clearTimeout(_findT); const v = e.target.value; _findT = setTimeout(() => runSearch(v), 200); });
  $('#findInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); gotoMatch(searchIdx + (e.shiftKey ? -1 : 1)); } else if (e.key === 'Escape') { e.preventDefault(); closeFind(); } });
  $('#findNext').onclick = () => gotoMatch(searchIdx + 1);
  $('#findPrev').onclick = () => gotoMatch(searchIdx - 1);
  $('#findClose').onclick = closeFind;
  $('#btnComments').onclick = () => { const open = $('#work').classList.toggle('comm-open'); $('#comments').hidden = !open; $('#btnComments').classList.toggle('on', open); };
  $('#btnPrint').onclick = printDoc;
  const setColor = c => { style.color = c; $('#colorDot').style.background = c; $('#colorPick').value = c; saveStyle(); if (sel) { const a = findAnno(sel.num, sel.id); if (a) { pushUndo(); a.color = c; pageViews.forEach(drawAnnos); } } };
  $('#colorPick').oninput = e => setColor(e.target.value);
  $('#btnColor').onclick = e => { e.stopPropagation(); const p = $('#palettePop'); p.hidden = !p.hidden; };
  $$('#palettePop .pal-row button').forEach(b => b.onclick = () => { setColor(b.dataset.c); $('#palettePop').hidden = true; });
  $('#palCustom').onclick = () => { $('#palettePop').hidden = true; $('#colorPick').click(); };
  $('#btnStamp').onclick = e => { e.stopPropagation(); const p = $('#stampPop'); p.hidden = !p.hidden; };
  $$('#stampPop button').forEach(b => b.onclick = () => { pendingStamp = { kind: b.dataset.kind, text: b.dataset.text || '', color: b.dataset.color }; $('#stampPop').hidden = true; setTool('stamp'); toast('Auf den Plan tippen, um den Stempel zu setzen.'); });
  document.addEventListener('pointerdown', e => { if (!e.target.closest('.stamp-wrap')) $('#stampPop').hidden = true; }, true);
  $('#btnForm').onclick = toggleFormMode;
  $$('.fab-b').forEach(b => b.onclick = () => setTool(b.dataset.tool));
  $('#pageInd').onclick = askGotoPage;
  $('#btnRuler').onclick = toggleRuler;
  $('#btnGrid').onclick = toggleGrid;
  { const s2 = $('#btnScale2'); if (s2) s2.onclick = () => openScale(0); const r2 = $('#btnRuler2'); if (r2) r2.onclick = toggleRuler; const g2 = $('#btnGrid2'); if (g2) g2.onclick = toggleGrid; }   // Dokument-Reiter: Duplikate von Massstab/Lineal/Raster
  { const pt = $('#planRailToggle'); if (pt) pt.onclick = () => document.body.classList.toggle('planrail-collapsed'); const bp2 = $('#btnProfile2'); if (bp2) bp2.onclick = () => { const o = $('#btnProfile'); if (o) o.click(); };
    const popAt = (pop, btn, side) => { const r = btn.getBoundingClientRect(); pop.hidden = false; const w = pop.offsetWidth || 200, h = pop.offsetHeight || 100; let x = side === 'right' ? r.right + 4 : r.left; x = Math.min(x, window.innerWidth - w - 8); let y = Math.min(r.top, window.innerHeight - h - 8); pop.style.left = Math.max(8, x) + 'px'; pop.style.top = Math.max(8, y) + 'px'; };
    const bb2 = $('#btnBlock2'); if (bb2) bb2.onclick = e => { e.stopPropagation(); const p = $('#blockPop'); if (!p) return; if (!p.hidden) { p.hidden = true; return; } popAt(p, bb2, 'right'); };
    const fm = $('#btnFileMenu'); if (fm) fm.onclick = e => { e.stopPropagation(); const p = $('#smMenu'); if (!p) return; if (!p.hidden) { p.hidden = true; return; } popAt(p, fm, 'below'); };
    const sm = $('#smMenu'); if (sm) sm.querySelectorAll('.rib-act').forEach(b => b.addEventListener('click', () => { sm.hidden = true; }));   // nach Auswahl Menü schliessen
    document.addEventListener('pointerdown', e => { const sm2 = $('#smMenu'); if (sm2 && !sm2.hidden && !e.target.closest('#smMenu') && !e.target.closest('#btnFileMenu')) sm2.hidden = true; const bp = $('#blockPop'); if (bp && !bp.hidden && !e.target.closest('#blockPop') && !e.target.closest('#btnBlock2') && !e.target.closest('#btnBlock')) bp.hidden = true; }, true);
  }   // linke Planungs-Rail: Toggle + Profil; Objekt-/Datei-Menüs als positionierte Dropdowns
  $('#gridCell').onchange = e => { gridCellCm = +e.target.value; drawGrid(); };
  $('#gridMoveBtn').onclick = () => { gridMove = !gridMove; $('#gridMoveBtn').classList.toggle('on', gridMove); updateGridPE(); };
  $('#gridClose').onclick = toggleGrid;
  $('#gridCv').addEventListener('pointerdown', startGridDrag);
  $('#pages').addEventListener('scroll', () => { scheduleRulers(); scheduleGrid(); }, { passive: true });
  window.addEventListener('resize', () => { scheduleRulers(); scheduleGrid(); });
  $$('#alignBar button').forEach(b => b.onclick = () => alignGroup(b.dataset.al));
  let abPushed = false;
  $('#abColor').addEventListener('pointerdown', () => { abPushed = false; });
  $('#abColor').addEventListener('input', e => { if (!abPushed) { pushUndo(); abPushed = true; } $('#abColorDot').style.background = e.target.value; applyGroupColor(e.target.value); });
  $('#cropApply').onclick = () => applyCrop(false);
  $('#cropAll').onclick = () => applyCrop(true);
  $('#cropCancel').onclick = () => { removeCropAnno(); setTool('select'); };
  { const b1 = $('#snipPdf'), b2 = $('#snipCopy'), b3 = $('#snipMail'), b4 = $('#snipCancel');
    if (b1) b1.onclick = () => snipDo('pdf'); if (b2) b2.onclick = () => snipDo('copy'); if (b3) b3.onclick = () => snipDo('mail');
    if (b4) b4.onclick = () => { removeSnipAnno(); setTool('select'); }; }
  { const ea = $('#editAllPage'), ed = $('#editDone'); if (ea) ea.onclick = () => editAllTextOnPage(); if (ed) ed.onclick = () => setTool('select'); }
  $('#btnOutline').onclick = e => { e.stopPropagation(); const p = $('#outlinePop'); p.hidden = !p.hidden; $('#btnOutline').classList.toggle('on', !p.hidden); };
  document.addEventListener('pointerdown', e => { if (!e.target.closest('#outlinePop') && !e.target.closest('#btnOutline')) { $('#outlinePop').hidden = true; $('#btnOutline').classList.remove('on'); } }, true);
  document.addEventListener('pointerdown', e => { if (!e.target.closest('.swatch-wrap')) $('#palettePop').hidden = true; }, true);
  $('#widthSel').onchange = e => { style.width = +e.target.value; saveStyle(); if (sel) { const a = findAnno(sel.num, sel.id); if (a && a.width != null) { pushUndo(); a.width = style.width; pageViews.forEach(drawAnnos); } } };
  // Schwebende Auswahl-Leiste
  const selA = () => sel && findAnno(sel.num, sel.id), selPv = () => pageViews.find(p => p.num === sel.num);
  let sbColorPushed = false, sbTbgPushed = false;
  $('#sbColor').addEventListener('pointerdown', () => { sbColorPushed = false; });
  $('#sbColor').addEventListener('input', e => { const a = selA(); if (!a) return; if (!sbColorPushed) { pushUndo(); sbColorPushed = true; } a.color = e.target.value; if (a.hatch) a.hatch.color = e.target.value; style.color = e.target.value; $('#colorDot').style.background = e.target.value; $('#sbColorDot').style.background = e.target.value; const pv = selPv(); if (pv) drawAnnos(pv); });
  let sbFillPushed = false;
  $('#sbFill').addEventListener('pointerdown', () => { sbFillPushed = false; });
  $('#sbFill').addEventListener('input', e => { const a = selA(); if (!a) return; if (!sbFillPushed) { pushUndo(); sbFillPushed = true; } a.fill = e.target.value; $('#sbFillDot').style.background = e.target.value; const pv = selPv(); if (pv) drawAnnos(pv); });
  $('#sbNoFill').onclick = () => { const a = selA(); if (!a) return; pushUndo(); a.fill = 'none'; $('#sbFillDot').style.background = 'transparent'; const pv = selPv(); if (pv) drawAnnos(pv); };
  $('#sbDash').onclick = () => { const a = selA(); if (!a) return; pushUndo(); a.dash = a.dash === 'dash' ? 'dot' : a.dash === 'dot' ? null : 'dash'; $('#sbDash').textContent = a.dash === 'dash' ? '- -' : a.dash === 'dot' ? '···' : '—'; const pv = selPv(); if (pv) drawAnnos(pv); };
  $('#sbHatch').onclick = e => { e.stopPropagation(); const p = $('#hatchPop'); p.hidden = !p.hidden; if (!p.hidden) { const a = selA(); $('#hpScaleVal').textContent = String(Math.round((a && a.hatch && a.hatch.scale) || lastHatchScale)); } };
  $$('#hatchPop button[data-h]').forEach(b => b.onclick = () => { const a = selA(); if (!a) return; pushUndo(); applyMaterial(a, b.dataset.h); $('#hatchPop').hidden = true; $('#sbHatch').classList.toggle('on', !!a.hatch); const pv = selPv(); if (pv) drawAnnos(pv); saveState(); });
  $$('#hatchPop button[data-hs]').forEach(b => b.onclick = e => { e.stopPropagation(); const a = selA(); const cur = (a && a.hatch && a.hatch.scale) || lastHatchScale; const nv = Math.max(3, Math.min(20, cur + (+b.dataset.hs) * 1)); lastHatchScale = nv; $('#hpScaleVal').textContent = String(nv); if (a && a.hatch) { pushUndo(); a.hatch.scale = nv; const pv = selPv(); if (pv) drawAnnos(pv); saveState(); } });
  document.addEventListener('pointerdown', e => { if (!e.target.closest('.sb-hatch-wrap')) $('#hatchPop').hidden = true; }, true);
  $$('#sbWidths button').forEach(btn => btn.onclick = () => { const a = selA(); if (!a || a.width == null) return; pushUndo(); a.width = +btn.dataset.w; style.width = +btn.dataset.w; $('#widthSel').value = btn.dataset.w; const pv = selPv(); if (pv) drawAnnos(pv); });
  $('#sbSize').onchange = e => { const a = selA(); if (!a) return; pushUndo(); a.size = +e.target.value; style.size = +e.target.value; $('#sizeSel').value = e.target.value; const pv = selPv(); if (pv) drawAnnos(pv); };
  // Text-Format direkt aus der Auswahl-Leiste (volle Kontrolle, ohne erst zu editieren)
  $$('#sbTextFmt [data-al]').forEach(b => b.onclick = () => { const a = selA(), pv = selPv(); if (!a || a.type !== 'text') return; pushUndo(); a.align = b.dataset.al; textStyle.align = b.dataset.al; if (pv) drawAnnos(pv); updateSelBar(); saveState(); });
  $('#sbTbgNone').onclick = () => { const a = selA(), pv = selPv(); if (!a || a.type !== 'text') return; pushUndo(); a.bg = 'transparent'; textStyle.bg = 'transparent'; if (pv) drawAnnos(pv); updateSelBar(); saveState(); };
  $('#sbTbg').addEventListener('pointerdown', () => { sbTbgPushed = false; });
  $('#sbTbg').addEventListener('input', e => { const a = selA(), pv = selPv(); if (!a || a.type !== 'text') return; if (!sbTbgPushed) { pushUndo(); sbTbgPushed = true; } a.bg = e.target.value; textStyle.bg = e.target.value; if (pv) drawAnnos(pv); updateSelBar(); });
  $('#sbTborder').onclick = () => { const a = selA(), pv = selPv(); if (!a || a.type !== 'text') return; pushUndo(); a.border = a.border ? null : (a.color || '#1c242c'); if (a.border && !a.borderW) a.borderW = 1.2; textStyle.border = a.border; if (pv) drawAnnos(pv); updateSelBar(); saveState(); };
  $('#sbTedit').onclick = () => { const a = selA(), pv = selPv(); if (a && pv && a.type === 'text') openTextAnnoEdit(pv, a); };
  $('#sbWallDim').onclick = () => { const a = selA(), pv = selPv(); if (!a || a.type !== 'wall') return; pushUndo(); a.dim = !a.dim; wallDimOn = a.dim; if (pv) drawAnnos(pv); updateSelBar(); saveState(); };
  $$('#sbOpen [data-ok]').forEach(b => b.onclick = () => { const a = selA(), pv = selPv(); if (!a || a.type !== 'opening') return; pushUndo(); a.kind = b.dataset.ok; openKind = a.kind; if (pv) drawAnnos(pv); updateSelBar(); saveState(); });
  $$('#sbOpen [data-ow]').forEach(b => b.onclick = () => { const a = selA(), pv = selPv(); if (!a || a.type !== 'opening') return; pushUndo(); a.w = Math.max(cmToPts(40), Math.min(cmToPts(400), a.w + (+b.dataset.ow) * cmToPts(5))); lastOpenW = a.w; if (pv) drawAnnos(pv); updateSelBar(); saveState(); });
  $('#sbOpenFlip').onclick = () => { const a = selA(), pv = selPv(); if (!a || a.type !== 'opening') return; pushUndo(); flipOpening(a); if (pv) drawAnnos(pv); saveState(); };
  $('#sbEdit').onclick = () => { const a = selA(), pv = selPv(); if (a && pv) openEditEdit(pv, a, false); };
  $('#sbMove').onclick = () => { const a = selA(), pv = selPv(); if (a && pv) splitEditMove(pv, a); };
  const lineAdjust = (dx, dy) => { const a = selA(); if (!isLineType(a)) return; pushUndo(); a.x1 += dx; a.y1 += dy; a.x2 += dx; a.y2 += dy; const pv = selPv(); if (pv) drawAnnos(pv); };
  const lineRotate = deg => { const a = selA(); if (!isLineType(a)) return; pushUndo(); const cx = (a.x1 + a.x2) / 2, cy = (a.y1 + a.y2) / 2, r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r), rt = (x, y) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];[a.x1, a.y1] = rt(a.x1, a.y1);[a.x2, a.y2] = rt(a.x2, a.y2); const pv = selPv(); if (pv) drawAnnos(pv); };
  $('#sbUp').onclick = () => lineAdjust(0, -2);
  $('#sbDown').onclick = () => lineAdjust(0, 2);
  $('#sbRotL').onclick = () => lineRotate(-15);
  $('#sbRotR').onclick = () => lineRotate(15);
  $('#sbDup').onclick = () => { const pv = selPv(); if (pv && sel) duplicateAnno(pv, sel.id); };
  $('#sbDel').onclick = () => deleteSel();
  $('#sizeSel').onchange = e => { style.size = +e.target.value; saveStyle(); if (sel) { const a = findAnno(sel.num, sel.id); if (a && a.type === 'text') { pushUndo(); a.size = style.size; pageViews.forEach(drawAnnos); } } };
  $('#colorDot').style.background = style.color;

  // Leertaste-Hand (Pan): mit gedrückter Leertaste den Plan ziehen statt scrollen
  document.addEventListener('keyup', e => { if (e.key === ' ') { panMode = false; panning = null; document.body.classList.remove('pan', 'panning'); } });
  window.addEventListener('blur', () => { panMode = false; panning = null; document.body.classList.remove('pan', 'panning'); });
  $('#pages').addEventListener('pointerdown', e => {
    if (!panMode) return; e.preventDefault(); e.stopPropagation();
    const pg = $('#pages'); panning = { x: e.clientX, y: e.clientY, l: pg.scrollLeft, t: pg.scrollTop }; document.body.classList.add('panning');
    const move = ev => { if (!panning) return; pg.scrollLeft = panning.l - (ev.clientX - panning.x); pg.scrollTop = panning.t - (ev.clientY - panning.y); };
    const up = () => { panning = null; document.body.classList.remove('panning'); document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  }, true);

  // Drag & Drop
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach(ev => window.addEventListener(ev, e => { e.preventDefault(); if ([...(e.dataTransfer?.items || [])].some(i => i.kind === 'file')) drop.classList.add('over'); }));
  window.addEventListener('dragleave', e => { if (!e.relatedTarget) drop.classList.remove('over'); });
  window.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer?.files; if (f && f.length) openFiles(f); });

  // Tastatur
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f' && pdfDoc) { e.preventDefault(); openFind(); return; }   // Suche – auch wenn ein Feld fokussiert ist
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) { if (e.key === 'Escape') e.target.blur(); return; }
    const mod = e.ctrlKey || e.metaKey;
    if (viewOnly) {   // Ansehen-Modus: nur Ansicht/Navigation zulassen (Entf/Einfügen/Duplizieren/Undo/Werkzeug-Tasten blockiert)
      const allow = e.key === 'Escape' || e.key === ' ' || e.key === '?' || (e.shiftKey && e.key === '/') ||
        (mod && ['c', 'f', 's', 'p', 'o'].includes(e.key.toLowerCase())) || (mod && ['+', '=', '-', '0'].includes(e.key));
      if (!allow) return;
    }
    if (e.key === 'Enter' && areaDraft) { e.preventDefault(); finishArea(); return; }   // Fläche abschliessen
    if (e.key === 'Enter' && profDraft) { e.preventDefault(); finishProfile(); return; }   // Profil-Pfad abschliessen
    if (e.key === 'Enter' && penDraft) { e.preventDefault(); finishCurve(); return; }   // Kurve abschliessen
    if (e.key === 'Enter' && wallDraft) { e.preventDefault(); finishWallChain(); return; }   // Wand-Kette abschliessen
    if (e.key === 'Enter' && cdimDraft) { e.preventDefault(); finishChaindim(); return; }   // Kettenmass abschliessen
    if (e.key === 'Enter' && segDraft) { e.preventDefault(); finishSegDraft(); return; }   // Linie beenden
    if (e.key === 'Backspace' || e.key === 'Delete') {   // im Zeichnen: letzten Punkt zurücknehmen
      if (wallDraft) { e.preventDefault(); wallChainUndo(); return; }
      if (cdimDraft) { e.preventDefault(); if (cdimDraft.a.pts.length > 1) { cdimDraft.a.pts.pop(); drawAnnos(cdimDraft.pv); } else cancelChaindim(); return; }
      if (areaDraft) { e.preventDefault(); if (areaDraft.a.pts.length > 1) { areaDraft.a.pts.pop(); drawAnnos(areaDraft.pv); } else cancelArea(); return; }
      if (profDraft) { e.preventDefault(); if (profDraft.a.path.length > 1) { profDraft.a.path.pop(); drawAnnos(profDraft.pv); } else cancelProfile(); return; }
      if (penDraft) { e.preventDefault(); if (penDraft.a.nodes.length > 1) { penDraft.a.nodes.pop(); drawAnnos(penDraft.pv); } else cancelCurve(); return; }
    }
    if (e.key === ' ' && !mod) { if (active >= 0 && !panMode) { e.preventDefault(); panMode = true; document.body.classList.add('pan'); } return; }   // Leertaste = Hand
    if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); openPicker(); }
    else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    else if (mod && e.key.toLowerCase() === 'p') { e.preventDefault(); printDoc(); }
    else if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); }
    else if (mod && (e.key === '+' || e.key === '=')) { e.preventDefault(); zoomStep(.05); }
    else if (mod && e.key === '-') { e.preventDefault(); zoomStep(-.05); }
    else if (mod && e.key === '0') { e.preventDefault(); setZoom('auto'); }
    else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); if (groupSel) duplicateGroup(); else if (sel) { const pv = pageViews.find(p => p.num === sel.num); if (pv) duplicateAnno(pv, sel.id); } }
    else if (mod && e.key.toLowerCase() === 'c' && sel && tool !== 'textsel') { e.preventDefault(); copySel(); }
    else if (mod && e.key.toLowerCase() === 'v' && clipAnno && tool !== 'textsel') { e.preventDefault(); pasteAnno(); }
    else if (sel && e.key.startsWith('Arrow')) { e.preventDefault(); nudgeSel(e.key, e.shiftKey ? 10 : 1); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { if (groupSel) { e.preventDefault(); deleteGroup(); } else if (sel) { e.preventDefault(); deleteSel(); } }
    else if (e.key === 'Escape') {
      hideCtx();
      if (segDraft) { cancelSegDraft(); return; }                                      // Linie abbrechen
      if (wallDraft) { finishWallChain(); return; }                                    // Wand-Kette beenden (gesetzte Wände bleiben)
      if (cdimDraft) { finishChaindim(); return; }                                      // Kettenmass beenden
      if (areaDraft) { cancelArea(); setTool('select'); return; }                     // Flächen-Polygon abbrechen
      if (profDraft) { cancelProfile(); setTool('select'); return; }                  // Profil-Pfad abbrechen
      if (penDraft) { cancelCurve(); setTool('select'); return; }                      // Kurve abbrechen
      if (cropping) { removeCropAnno(); setTool('select'); return; }                  // Zuschneiden abbrechen
      let closed = false;
      ['palettePop', 'stampPop', 'outlinePop', 'slideDlg'].forEach(id => { const el = $('#' + id); if (el && !el.hidden) { el.hidden = true; closed = true; } });
      const im = $('#insMenu'); if (im) { closeInsertMenu(); closed = true; }
      if (closed) return;                                                              // erst Popups schliessen
      if (tool !== 'select') setTool('select');                                        // dann zurück zum Auswählen
      sel = null; groupSel = null; pageViews.forEach(drawAnnos);
    }
    else if (e.key === '?' || (e.shiftKey && e.key === '/')) { e.preventDefault(); toggleShortcuts(); }
    else if (!mod && e.key.toLowerCase() === 'v') setTool('select');
    else if (!mod && e.key.toLowerCase() === 't') setTool('text');
    else if (!mod && e.key.toLowerCase() === 's') setTool('pen');
    else if (!mod && e.key.toLowerCase() === 'l') { if (segDraft) { e.preventDefault(); segDraftLength(); return; } if (wallDraft && wallDraft.seg) { e.preventDefault(); wallChainLength(); return; } const t = lineForLength(); if (t) { e.preventDefault(); lineLenInput(t.pv, t.a); } else setTool('line'); }
    else if (!mod && e.key.toLowerCase() === 'w') setTool('wall');
    else if (!mod && e.key.toLowerCase() === 'd') { const t = wallForThick(); if (t) { e.preventDefault(); wallThickInput(t.pv, t.a); } }
    else if (!mod && e.key.toLowerCase() === 'p') setTool('arrow');
    else if (!mod && e.key.toLowerCase() === 'r') setTool('rect');
    else if (!mod && e.key.toLowerCase() === 'o') setTool('oval');
    else if (!mod && e.key.toLowerCase() === 'm') setTool('measure');
    else if (!mod && e.key.toLowerCase() === 'h') setTool('highlight');
    else if (!mod && e.key.toLowerCase() === 'e') setTool('eraser');
    else if (!mod && e.key.toLowerCase() === 'k') setTool('note');
  });
}
wire();
if (active < 0) showEmptyThumbs();   // beim Start: Vorschau-Spalte zeigt „Neue Seite/Folie"

/* ---------- Startbildschirm (Logo zeichnet sich, Schrift buchstabenweise) ---------- */
(function splashIntro() {
  const sp = $('#splash'); if (!sp) return;
  let done = false;
  const dismiss = () => { if (done) return; done = true; sp.classList.add('hide'); document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', dismiss); setTimeout(() => sp.remove(), 650); };
  setTimeout(dismiss, 3000);
  setTimeout(() => { document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', dismiss); }, 400);   // erst nach kurzer Zeit per Klick überspringbar
})();
setTimeout(() => { try { if (!pdfDoc && (typeof buildExampleProject === 'function')) buildExampleProject(); } catch (_) { } }, 1600);   // Start mit Beispielprojekt, wenn kein Dokument/Wiederherstellung geladen
(function uiZoom() {   // Oberflächen-Zoom: skaliert die ganze App (Werkzeuge/Buttons/Blatt), unabhängig vom Browser-Zoom
  let s = parseFloat(localStorage.getItem('uiScale') || '1') || 1;
  const lbl = document.getElementById('uiZoomLbl'), inB = document.getElementById('uiZoomIn'), outB = document.getElementById('uiZoomOut');
  const apply = () => { document.body.style.zoom = String(s); if (lbl) lbl.textContent = Math.round(s * 100) + '%'; try { localStorage.setItem('uiScale', String(s)); } catch (_) { } };
  const set = v => { s = Math.max(0.6, Math.min(2.4, Math.round(v * 20) / 20)); apply(); };
  if (inB) inB.onclick = () => set(s + 0.1);
  if (outB) outB.onclick = () => set(s - 0.1);
  if (lbl) lbl.onclick = () => set(1);
  document.addEventListener('keydown', e => { if (!(e.ctrlKey && e.altKey)) return; if (e.key === '+' || e.key === '=') { set(s + 0.1); e.preventDefault(); } else if (e.key === '-') { set(s - 0.1); e.preventDefault(); } else if (e.key === '0') { set(1); e.preventDefault(); } });
  apply();
})();

/* ---------- Geräte-Anbindung (PWA) ---------- */
async function loadSharedFile() {
  try {
    const c = await caches.open('submitpdf-share'); const r = await c.match('shared-file'); if (!r) return;
    await c.delete('shared-file');
    const blob = await r.blob(); const name = decodeURIComponent(r.headers.get('X-Filename') || 'geteilt');
    const ext = (blob.type.includes('pdf')) ? '.pdf' : (blob.type.split('/')[1] ? '.' + blob.type.split('/')[1] : '');
    openFiles([new File([blob], /\.\w+$/.test(name) ? name : name + ext, { type: blob.type })]);
  } catch (_) {}
}
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
  let _swReloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (_swReloaded) return; _swReloaded = true; location.reload(); });
}
// PWA-Installation bewusst DEAKTIVIERT: Wir liefern die Desktop-App über Tauri (.exe) – kein PWA-Download.
let deferredInstall = null;
const installBtn = document.getElementById('btnInstall');
const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
if (installBtn) installBtn.hidden = true;                                 // PWA-Knopf bleibt aus (Download-Button ersetzt ihn)
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });   // Auto-Prompt abfangen, aber nichts anzeigen
window.addEventListener('appinstalled', () => { if (installBtn) installBtn.hidden = true; deferredInstall = null; });
if (installBtn) installBtn.onclick = async () => {
  if (deferredInstall) { deferredInstall.prompt(); const r = await deferredInstall.userChoice; if (r.outcome === 'accepted') installBtn.hidden = true; deferredInstall = null; }
  else if (standalone) { toast('Läuft bereits als App.'); }
  else if (location.protocol === 'file:') { toast('Installation nur über die Online-Seite (https) möglich.'); }
  else { toast('Im Browser-Menü „App installieren" wählen (Chrome/Edge).'); }
};
// „Öffnen mit Submit PDF" (Desktop, installierte App)
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async params => {
    if (params && params.files && params.files.length) { const files = await Promise.all(params.files.map(h => h.getFile())); openFiles(files); }
  });
}
// Geteilte Datei vom Handy (Teilen-Ziel)
if (new URLSearchParams(location.search).get('shared')) { window.addEventListener('load', () => setTimeout(loadSharedFile, 300)); }

// Schöne Hover-Tooltips aus den title-Attributen (wie Submit Paper) – ersetzt die trägen Browser-Tooltips
function initTooltips() {
  if (document.getElementById('tip')) return;
  const tip = document.createElement('div'); tip.id = 'tip'; tip.className = 'tip'; tip.hidden = true; document.body.appendChild(tip);
  let tipEl = null, tipTimer = null;
  const hideTip = () => { clearTimeout(tipTimer); if (tipEl && tipEl.dataset.tip != null) { tipEl.setAttribute('title', tipEl.dataset.tip); delete tipEl.dataset.tip; } tipEl = null; tip.hidden = true; };
  document.addEventListener('mouseover', e => {
    const t = e.target.closest && e.target.closest('[title]'); if (!t || t === tipEl) return;
    hideTip(); const txt = t.getAttribute('title'); if (!txt) return; tipEl = t;
    tipTimer = setTimeout(() => {
      if (!tipEl) return; tipEl.dataset.tip = txt; tipEl.removeAttribute('title');
      tip.textContent = txt; tip.hidden = false;
      const r = tipEl.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
      const left = Math.max(8, Math.min(r.left + r.width / 2 - tw / 2, window.innerWidth - tw - 8));
      let top = r.bottom + 8; if (top + th > window.innerHeight - 8) top = r.top - th - 8;
      tip.style.left = left + 'px'; tip.style.top = top + 'px';
    }, 320);
  });
  document.addEventListener('mouseout', e => { if (tipEl && (!e.relatedTarget || !tipEl.contains(e.relatedTarget))) hideTip(); });
  document.addEventListener('mousedown', hideTip, true);
  window.addEventListener('scroll', hideTip, true);
}
if (document.body) initTooltips(); else document.addEventListener('DOMContentLoaded', initTooltips);
