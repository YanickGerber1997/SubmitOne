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
let annos = {};            // {pageNum: [anno]}
let pageRot = {};          // {pageNum: 0/90/180/270} – gespeicherte 90°-Drehung
let viewRot = {};          // {pageNum: deg} – freie Ansichts-Drehung (Norden), NICHT gespeichert
let formValues = {};       // {feldName: Wert} – ausgefüllte PDF-Formularfelder (gespeichert)
let formFields = {};       // {pageNum: [{name,type,left,top,w,h,...}]} – Geometrie, beim Laden neu erkannt
let fieldTypes = {};       // {feldName: 'text'|'checkbox'|'radio'|'dropdown'}
let formMode = false;      // „Formular ausfüllen"-Modus aktiv?
let tool = 'select';
let style = { color: '#1c242c', width: 1.5, size: 16 };   // Standard: dünn + schwarz (Plan-tauglich)
function saveStyle() { try { localStorage.setItem('submitpdf.style', JSON.stringify({ color: style.color, width: style.width, size: style.size, penTidy })); } catch (_) { } }
function loadStyle() { let s; try { s = JSON.parse(localStorage.getItem('submitpdf.style') || 'null'); } catch (_) { s = null; } if (!s) return; if (s.color) style.color = s.color; if (s.width) style.width = s.width; if (s.size) style.size = s.size; if (typeof s.penTidy === 'boolean') penTidy = s.penTidy; }
function applyStyleUI() { const $$$ = id => document.getElementById(id); const d = $$$('colorDot'); if (d) d.style.background = style.color; const cp = $$$('colorPick'); if (cp) cp.value = style.color; const ws = $$$('widthSel'); if (ws) ws.value = String(style.width); const ss = $$$('sizeSel'); if (ss) ss.value = String(style.size); const pt = $$$('penTidyBtn'); if (pt) pt.classList.toggle('on', penTidy); }
let penTidy = true;        // Freihand-Skizzen automatisch zu sauberen Formen aufräumen
let docScale = null;       // {perPt: reale Meter pro PDF-Punkt, label:'1:100'} – für Messen
const PT2MM = 25.4 / 72;   // 1 PDF-Punkt in mm
let dimUnit = false, wallDimOffCm = 10, wallDimGap = 8;   // Mass-Anzeige mit Einheit? (Standard: Plan-Stil „4.00") · Abstand der Wand-Masslinie (cm) · Lücke Bauteil↔Hilfslinie (pt)
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
    row.onclick = () => { $$('.fp-row.active', t).forEach(x => x.classList.remove('active')); row.classList.add('active'); openFromHandle(r.handle); };
    t.appendChild(row);
  }
}
async function walkSearch(handle, prefix, ql, results, max, aborted) {
  if (results.length >= max || aborted()) return;
  let entries = []; try { for await (const [name, h] of handle.entries()) entries.push([name, h]); } catch (_) { return; }
  for (const [name, h] of entries) { if (results.length >= max) return; if (h.kind === 'file' && /\.(pdf|png|jpe?g|webp)$/i.test(name) && name.toLowerCase().includes(ql)) results.push({ name, handle: h, path: prefix }); }
  for (const [name, h] of entries) { if (results.length >= max || aborted()) return; if (h.kind === 'directory' && !name.startsWith('.')) await walkSearch(h, prefix + '/' + name, ql, results, max, aborted); }
}
async function buildTree(handle, container) {
  const entries = []; try { for await (const [name, h] of handle.entries()) entries.push([name, h]); } catch (_) { return; }
  entries.sort((a, b) => (a[1].kind === b[1].kind) ? a[0].localeCompare(b[0]) : (a[1].kind === 'directory' ? -1 : 1));
  for (const [name, h] of entries) {
    if (h.kind === 'directory') {
      if (name.startsWith('.')) continue;
      const row = fpRow('▸', name, 'dir'); container.appendChild(row);
      const sub = document.createElement('div'); sub.className = 'fp-sub'; sub.hidden = true; container.appendChild(sub); let loaded = false;
      row.onclick = async () => { sub.hidden = !sub.hidden; row.querySelector('.fp-ic').textContent = sub.hidden ? '▸' : '▾'; if (!loaded && !sub.hidden) { loaded = true; await buildTree(h, sub); } };
    } else if (/\.(pdf|png|jpe?g|webp)$/i.test(name)) {
      const row = fpRow(/\.pdf$/i.test(name) ? '📄' : '🖼', name, 'file'); container.appendChild(row);
      row.onclick = () => { $$('.fp-row.active', $('#fpTree')).forEach(r => r.classList.remove('active')); row.classList.add('active'); openFromHandle(h); };
    }
  }
}
function fpRow(ic, name, cls) { const d = document.createElement('div'); d.className = 'fp-row ' + cls; d.innerHTML = '<span class="fp-ic"></span><span class="fp-nm"></span>'; d.querySelector('.fp-ic').textContent = ic; d.querySelector('.fp-nm').textContent = name; return d; }
async function openFromHandle(fh) {
  try { const file = await fh.getFile(); await openFiles([file]); if (docs[active]) { docs[active].fileHandle = fh; curFileHandle = fh; } }
  catch (e) { console.error(e); toast('Datei konnte nicht geöffnet werden.'); }
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
  if (!curBytes || active < 0 || !dirty || cropping) return;
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
}
async function renderCurrentDoc() {
  $('#drop').classList.add('hide'); $('#toolbar').hidden = false; $('#quickbar').hidden = false;
  $('#btnSave').disabled = false; $('#btnSend').disabled = false; $('#docName').textContent = docName;
  document.title = 'Submit PDF';
  _searchCache = {}; if (typeof closeFind === 'function') closeFind();   // Suche fürs neue Dokument zurücksetzen
  await buildLayout(); buildThumbs(); status(''); refreshComments(); updateScaleLabel(); updateFormatLabel();
  document.body.classList.add('has-doc');
  detectForm(); detectOutline();
  if (rulerOn) requestAnimationFrame(drawRulers);
  if (gridOn) requestAnimationFrame(drawGrid);
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
function fitScale(pw) { const avail = $('#pages').clientWidth - (innerWidth < 820 ? 14 : 48); return Math.max(.2, Math.min(3, avail / pw)); }
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
function dropTile(pv) { if (pv.tileTask) { try { pv.tileTask.cancel(); } catch (_) { } pv.tileTask = null; } if (pv.tile) { pv.tile.remove(); pv.tile = null; } }
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
// Sichtbaren Seiten-Ausschnitt in Seiten-Punkten (berücksichtigt Zoom + Drehung über die CTM).
function visiblePageRect(pv) {
  const host = $('#pages'), r = host.getBoundingClientRect(), ctm = pv.svg.getScreenCTM(); if (!ctm) return null;
  const inv = ctm.inverse(), pt = pv.svg.createSVGPoint();
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const [x, y] of [[r.left, r.top], [r.right, r.top], [r.right, r.bottom], [r.left, r.bottom]]) {
    pt.x = x; pt.y = y; const q = pt.matrixTransform(inv);
    minx = Math.min(minx, q.x); maxx = Math.max(maxx, q.x); miny = Math.min(miny, q.y); maxy = Math.max(maxy, q.y);
  }
  minx = Math.max(0, minx); miny = Math.max(0, miny); maxx = Math.min(pv.pageW, maxx); maxy = Math.min(pv.pageH, maxy);
  if (maxx - minx < 1 || maxy - miny < 1) return null;
  return { x: minx, y: miny, w: maxx - minx, h: maxy - miny };
}
const TILE_MAXDIM = 8192;     // Browser-Canvas-Grenze pro Achse
async function renderTile(pv) {                      // scharfe Kachel über den sichtbaren Ausschnitt
  if (pv.rendering || !pv.page) return; const rect = visiblePageRect(pv); if (!rect) return;
  pv.rendering = true;
  try {
    const scale = pageScale(pv), dpr = dprCap(); let px = scale * dpr * SS_TILE;   // direkt überabgetastet rendern (wie vor v33)
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
    if (pv.tile) pv.tile.remove(); pv.tile = canvas; pv.inner.insertBefore(canvas, pv.svg);
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
  }, 90);
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
function updatePageInd() { if (!pdfDoc) return; const cur = curPage(); $('#pageInd').textContent = cur + ' / ' + pdfDoc.numPages; $$('.thumb', $('#thumbs')).forEach(t => t.classList.toggle('active', +t.dataset.n === cur)); updateFormatLabel(); }

/* ---------- Zoom ---------- */
function curScale() { return (zoom === 'auto') ? (pageViews[0] ? pageViews[0].scale : 1) : zoom; }
function updateZoomLabel() { const pct = Math.round(((zoom === 'auto') ? curScale() : zoom) * 100); $('#zoomVal').innerHTML = pct + '&nbsp;%'; $('#zoomVal').classList.toggle('on', zoom === 'auto'); }
function setZoom(z) { zoom = z; if (pdfDoc) relayout(); }
function zoomStep(d) { const c = curScale(); setZoom(Math.max(.1, Math.min(8, Math.round((c + d) * 100) / 100))); }
function promptZoom() {
  if (!pdfDoc) return; const cur = Math.round(curScale() * 100);
  const v = prompt('Zoom in % (z. B. 80) – leer = an Breite anpassen:', cur); if (v === null) return;
  const t = (v || '').trim(); if (t === '') { setZoom('auto'); return; }
  const n = parseFloat(t.replace(',', '.').replace('%', '')); if (n >= 10 && n <= 800) setZoom(n / 100);
}
// Zum Mauszeiger zoomen: der Punkt unter der Maus bleibt an Ort und Stelle
function zoomToward(clientX, clientY, factor) {
  if (!pdfDoc) return; const host = $('#pages'), rect = host.getBoundingClientRect();
  const px = clientX - rect.left, py = clientY - rect.top, cur = curScale();
  const nz = Math.max(.25, Math.min(5, Math.round(cur * factor * 100) / 100)); if (nz === cur) return;
  const docX = host.scrollLeft + px, docY = host.scrollTop + py, f = nz / cur;
  setZoom(nz);                                  // Layout wird synchron neu gesetzt
  host.scrollLeft = docX * f - px; host.scrollTop = docY * f - py;
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
function pageHasVisible(n) { return (annos[n] || []).some(a => layerVisible(a) && a.type !== 'crop'); }   // hat die Seite sichtbare Anmerkungen?
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
    const ele = document.createElement('input'); ele.className = 'lp-ele'; ele.type = 'number'; ele.step = '0.1'; ele.title = 'Höhenlage / Geschoss-Höhe (3D-Stapel)'; ele.value = l.elevation || 0;
    ele.onclick = e => e.stopPropagation(); ele.onchange = () => { l.elevation = parseFloat((ele.value || '').replace(',', '.')) || 0; markDirty(); };
    const del = document.createElement('button'); del.className = 'lp-del'; del.innerHTML = '✕'; del.title = 'Ebene löschen (Inhalt wandert auf die erste Ebene)';
    del.onclick = e => { e.stopPropagation(); if (layers.length <= 1) { toast('Mindestens eine Ebene muss bleiben.'); return; } const fb = layers.find(x => x.id !== l.id).id; for (const n in annos) for (const a of annos[n]) if (a.layer === l.id) a.layer = fb; layers = layers.filter(x => x.id !== l.id); if (activeLayerId === l.id) activeLayerId = fb; pageViews.forEach(drawAnnos); buildThumbs(); renderLayerPanel(); markDirty(); };
    row.append(eye, nm, ele, del);
    row.onclick = () => { activeLayerId = l.id; renderLayerPanel(); };
    list.appendChild(row);
  });
}
function toggleLayerPanel() { const p = $('#layerPanel'); if (!p) return; p.hidden = !p.hidden; if (!p.hidden) renderLayerPanel(); }
function findAnno(n, id) { return (annos[n] || []).find(a => a.id === id); }
let _wallUnionActive = false;
function drawAnnos(pv) {
  const svg = pv.svg; svg.innerHTML = '';
  for (const a of getAnnos(pv.num)) if (a.type === 'opening') openingResolve(a, pv);   // Türen/Fenster der Wand folgen lassen
  _wallUnionActive = false;
  if (window.polygonClipping) { const walls = getAnnos(pv.num).filter(a => a.type === 'wall' && (wallSimple(a) || !(a.layers && a.layers.length)) && layerVisible(a) && phaseVisible(a)); if (walls.length) _wallUnionActive = drawWallUnion(svg, walls); }   // saubere Ecken via Flächen-Vereinigung (Schicht-Wände zeichnen sich selbst; einfach = schwarz)
  for (const a of getAnnos(pv.num)) { if (!layerVisible(a) || !phaseVisible(a)) continue; drawOne(svg, a, pv); }
  _wallUnionActive = false;
  if (sel && sel.num === pv.num) drawSelection(svg, findAnno(pv.num, sel.id), pv);
  if (groupSel && groupSel.num === pv.num) drawGroupSel(svg, pv);
  updateAlignBar();
  updateSelBar();
  updatePlanBar();
}
// Farbe (#hex oder rgb()) → #rrggbb für das Farbfeld
function toHex(s) { const c = parseColor(s), h = n => ('0' + Math.round(n * 255).toString(16)).slice(-2); return '#' + h(c.r) + h(c.g) + h(c.b); }
// Schwebende Leiste über der Auswahl positionieren/konfigurieren
function updateSelBar() {
  const bar = $('#selbar'); if (!bar) return;
  if (!sel || tool !== 'select') { bar.hidden = true; return; }
  const pv = pageViews.find(p => p.num === sel.num), a = pv && findAnno(pv.num, sel.id);
  if (!pv || !a || a.type === 'crop') { bar.hidden = true; return; }   // Crop hat eine eigene Leiste
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
  konter: { label: 'Konterlattung', fill: HATCH_DEF.holz.fill, hatch: 'holz', color: HATCH_DEF.holz.color }
};
const WALL_PRESETS = [   // Schichten innen → aussen [Material, cm]
  { name: 'Mauerwerk + EPS', layers: [['putz', 1.5], ['mauerwerk', 15], ['eps', 22], ['putz', 2]] },
  { name: 'Beton + EPS', layers: [['putz', 1.5], ['beton', 20], ['eps', 22], ['putz', 2]] },
  { name: 'Hinterlüftet · Gipsplatte', layers: [['putz', 1.5], ['mauerwerk', 15], ['glaswolle', 22], ['luft', 4], ['gips', 1.5], ['putz', 0.5]] },
  { name: 'Hinterlüftet · Holz horizontal', layers: [['putz', 1.5], ['mauerwerk', 15], ['glaswolle', 22], ['luft', 4], ['holz', 2.2]] },
  { name: 'Hinterlüftet · Holz vertikal', layers: [['putz', 1.5], ['mauerwerk', 15], ['glaswolle', 22], ['luft', 4], ['konter', 3], ['holz', 2.2]] }
];
const SUB_W = { lattung: 6, staender: 5, schraube: 1.2 };   // Breite/Markierung der UK-Querschnitte (cm)
function applyWallBuildup(a, layersData, spacingCm) {   // layersData = [[mat, cm, subTyp?], …] innen→aussen · spacingCm = Achsabstand UK
  if (!layersData || !layersData.length) { delete a.layers; return; }
  const sp = cmToPts(spacingCm || 60);
  a.layers = layersData.map(([mat, cm, sub]) => { const l = { mat, t: cmToPts(cm) }; if (sub) l.sub = { type: sub, spacing: sp, w: cmToPts(SUB_W[sub] || 2) }; return l; });
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
  for (const L of a.layers) { const f0 = cum / total, f1 = (cum + L.t) / total; bands.push({ mat: L.mat, f0, f1, poly: [lp(c1B, c1A, f1), lp(c2B, c2A, f1), lp(c2B, c2A, f0), lp(c1B, c1A, f0)] }); cum += L.t; }
  return { bands, c1A, c2A, c2B, c1B };
}
function layerHatch(svg, a, band) {   // Schraffur einer einzelnen Schicht, auf das Band geclippt
  const m = WALL_MATS[band.mat]; if (!m || !m.hatch) return;
  const cid = 'hl' + a.id + '_' + Math.round(band.f0 * 1000), cp = svgEl('clipPath', { id: cid }); cp.appendChild(svgEl('polygon', { points: band.poly.map(p => p[0] + ',' + p[1]).join(' ') }));
  const defs = svgEl('defs'); defs.appendChild(cp); svg.appendChild(defs);
  const hg = svgEl('g', { 'clip-path': `url(#${cid})`, 'pointer-events': 'none' }), col = m.color, S = (a.hatch && a.hatch.scale) || lastHatchScale; let lines = [];
  if (m.hatch === 'daemm_eps' || m.hatch === 'daemm_wolle' || INSUL_TYPES.includes(m.hatch)) {   // Dämmung: Striche exakt 90° zur Wandachse (je Wand für sich), aufs Band geclippt
    const dx = a.x2 - a.x1, dy = a.y2 - a.y1, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux, T = a.thick || wallThickPts(), o = wallSideOffsets(a), eB = o[1] * T, eA = o[0] * T;
    const eFrom = eB + (eA - eB) * band.f0, eTo = eB + (eA - eB) * band.f1, step = Math.max(4, S * 1.3);
    for (let s = 0; s <= L; s += step) { const px = a.x1 + ux * s, py = a.y1 + uy * s; lines.push([px + nx * eFrom, py + ny * eFrom, px + nx * eTo, py + ny * eTo]); }
  } else {
    const xs = band.poly.map(p => p[0]), ys = band.poly.map(p => p[1]), fake = { type: 'rect', x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), hatch: { type: m.hatch, scale: S } }, g = hatchGeom(fake);
    lines = g.lines; for (const D of g.dots) hg.appendChild(svgEl('circle', { cx: D[0], cy: D[1], r: D[2] != null ? D[2] : S * 0.16, fill: col }));
  }
  for (const L of lines) hg.appendChild(svgEl('line', { x1: L[0], y1: L[1], x2: L[2], y2: L[3], stroke: col, 'stroke-width': 0.8, 'vector-effect': 'non-scaling-stroke' }));
  svg.appendChild(hg);
}
function drawLayeredWall(svg, a, arr) {
  const { bands } = wallLayerBands(a, arr);   // jede Schicht: Füllung + dünne Umrandung in der Materialfarbe (kein schwarzer Gesamtrahmen)
  for (const b of bands) { const m = WALL_MATS[b.mat] || {}; svg.appendChild(svgEl('polygon', { points: b.poly.map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' '), fill: m.fill || '#ffffff', stroke: m.color || '#9a9a9a', 'stroke-width': 0.7, 'stroke-linejoin': 'miter', 'vector-effect': 'non-scaling-stroke' })); layerHatch(svg, a, b); }
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
    if (a.dim) { const dg = wallDimGeom(a); if (wallHasOpenings(a, arr)) renderWallDimPrims(svg, wallDimChainPrims(a, arr, dg.off), "#1c242c"); else archDim(svg, [a.x1, a.y1], [a.x2, a.y2], dg.off, "#1c242c", dg.label); }
    const poly = wallClipPoly(a); hit = svgEl('polygon', { points: poly.map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' '), fill: 'transparent', 'data-id': a.id }); svg.appendChild(hit);
  } else if (a.type === 'wall') {
    const arr = getAnnos(pv.num), poly = wallPoly(a, arr), pstr = poly.map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' ');
    const g = svgEl('g', { 'data-id': a.id });
    if (!_wallUnionActive && a.fill && a.fill !== 'none') g.appendChild(svgEl('polygon', { points: pstr, fill: a.fill, stroke: 'none' }));   // Füllung (wenn keine Union)
    svg.appendChild(g); el = g;
    if (a.hatch && a.hatch.type && !wallSimple(a)) appendHatch(svg, a, arr);                                          // Schraffur (einfach → weg, schwarze Wand)
    const col = a.color || '#1c242c', lw = a.width || 1.4;
    if (!_wallUnionActive) for (const [p, q] of wallOutlineSegs(a, arr)) svg.appendChild(svgEl('line', { x1: p[0], y1: p[1], x2: q[0], y2: q[1], stroke: col, 'stroke-width': lw, 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' }));   // Umriss nur ohne Union (sonst macht die Union die sauberen Ecken)
    if (a.dim) { const dg = wallDimGeom(a); if (wallHasOpenings(a, arr)) renderWallDimPrims(svg, wallDimChainPrims(a, arr, dg.off), "#1c242c"); else archDim(svg, [a.x1, a.y1], [a.x2, a.y2], dg.off, "#1c242c", dg.label); }   // Architektur-Masslinie – immer schwarz
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
  } else if (a.type === 'block') {
    el = drawBlock(svg, a);
    const b = bbox(a); hit = svgEl('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: 'transparent', 'data-id': a.id }); svg.appendChild(hit);
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
    if (a.type === 'measure') drawMeasureLabel(svg, a, pv);
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
    if (pts.length >= 2) g.appendChild(svgEl('polygon', { points: poly, fill: a.color, 'fill-opacity': a.room ? 0.08 : 0.14, stroke: 'none' }));
    const line = (draft ? pts.concat([draft]) : pts).map(p => p[0] + ',' + p[1]).join(' ');
    if (!a.room) g.appendChild(svgEl('polyline', { points: line, fill: 'none', stroke: a.color, 'stroke-width': a.width || 2, 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }));   // Raum: kein Umriss über die Wände
    if (draft && pts.length) { const f = pts[0]; g.appendChild(svgEl('circle', { cx: f[0], cy: f[1], r: 4.5 / pv.scale, fill: '#fff', stroke: a.color, 'stroke-width': 1.5 })); }
    if (pts.length >= 3) { const ct = centroid(pts), t = svgEl('text', { x: ct[0], y: ct[1], fill: a.color, 'font-size': 12, 'text-anchor': 'middle', 'font-weight': 700, 'paint-order': 'stroke', stroke: '#fff', 'stroke-width': 3 }); t.textContent = areaLabel(pts); g.appendChild(t); }
    svg.appendChild(g); el = g;
    if (!draft && pts.length >= 3) { hit = svgEl('polygon', { points: poly, fill: 'transparent', 'data-id': a.id }); svg.appendChild(hit); }
  } else if (a.type === 'slab') {
    const g = svgEl('g', { 'data-id': a.id }), pts = a.pts, draft = a._cursor, poly = pts.map(p => p[0] + ',' + p[1]).join(' ');
    if (pts.length >= 2) g.appendChild(svgEl('polygon', { points: poly, fill: a.color, 'fill-opacity': 0.13, stroke: 'none' }));
    const line = (draft ? pts.concat([draft]) : pts).map(p => p[0] + ',' + p[1]).join(' ');
    g.appendChild(svgEl('polyline', { points: line, fill: 'none', stroke: a.color, 'stroke-width': 1.4, 'stroke-dasharray': '7 4', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }));
    if (draft && pts.length) { const f = pts[0]; g.appendChild(svgEl('circle', { cx: f[0], cy: f[1], r: 4.5 / pv.scale, fill: '#fff', stroke: a.color, 'stroke-width': 1.5 })); }
    if (pts.length >= 3) { const ct = centroid(pts), t = svgEl('text', { x: ct[0], y: ct[1], fill: a.color, 'font-size': 12, 'text-anchor': 'middle', 'font-weight': 700, 'paint-order': 'stroke', stroke: '#fff', 'stroke-width': 3 }); t.textContent = (a.base >= wallHeightM ? 'Decke' : 'Platte') + '  ' + (a.base + a.thick).toFixed(2) + ' m'; g.appendChild(t); }
    svg.appendChild(g); el = g;
    if (!draft && pts.length >= 3) { hit = svgEl('polygon', { points: poly, fill: 'transparent', 'data-id': a.id }); svg.appendChild(hit); }
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
  } else if (a.type === 'crop') {
    const g = svgEl('g', { 'data-id': a.id });
    const dim = svgEl('path', { d: `M0 0H${pv.pageW}V${pv.pageH}H0Z M${a.x} ${a.y}H${a.x + a.w}V${a.y + a.h}H${a.x}Z`, fill: '#10161c', 'fill-opacity': 0.45, 'fill-rule': 'evenodd', stroke: 'none' });
    dim.style.pointerEvents = 'none'; g.appendChild(dim);
    g.appendChild(svgEl('rect', { x: a.x, y: a.y, width: a.w, height: a.h, fill: 'none', stroke: '#ffffff', 'stroke-width': 1.5, 'vector-effect': 'non-scaling-stroke' }));
    g.appendChild(svgEl('rect', { x: a.x, y: a.y, width: a.w, height: a.h, fill: 'none', stroke: '#b4502f', 'stroke-width': 1, 'stroke-dasharray': '6 4', 'vector-effect': 'non-scaling-stroke' }));
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
    g.appendChild(svgEl('rect', { x: a.x, y: a.y, width: a.w, height: a.h, fill: a.bg || '#fff', stroke: 'none' }));   // alte Stelle überdecken
    const t = svgEl('text', { x: a.x + 1, y: a.y + 1, fill: a.color, 'font-size': a.size });
    (a.text || '').split('\n').forEach((ln, i) => { const ts = svgEl('tspan', { x: a.x + 1, dy: i === 0 ? 0 : a.size * 1.25 }); ts.textContent = ln || ' '; t.appendChild(ts); });
    g.appendChild(t); svg.appendChild(g); el = g;
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

/* ---------- Auswahl / Griffe ---------- */
function bbox(a) {
  if (a.type === 'rect' || a.type === 'oval' || a.type === 'roof' || a.type === 'block') return { x: Math.min(a.x, a.x + a.w), y: Math.min(a.y, a.y + a.h), w: Math.abs(a.w), h: Math.abs(a.h) };
  if (a.type === 'line' || a.type === 'arrow' || a.type === 'measure' || a.type === 'dim') return { x: Math.min(a.x1, a.x2), y: Math.min(a.y1, a.y2), w: Math.abs(a.x2 - a.x1), h: Math.abs(a.y2 - a.y1) };
  if (a.type === 'wall') { const t = (a.thick || wallThickPts()) / 2; return { x: Math.min(a.x1, a.x2) - t, y: Math.min(a.y1, a.y2) - t, w: Math.abs(a.x2 - a.x1) + 2 * t, h: Math.abs(a.y2 - a.y1) + 2 * t }; }
  if (a.type === 'stairs') { const t = (a.width || stairWidthPts()) / 2; return { x: Math.min(a.x1, a.x2) - t, y: Math.min(a.y1, a.y2) - t, w: Math.abs(a.x2 - a.x1) + 2 * t, h: Math.abs(a.y2 - a.y1) + 2 * t }; }
  if (a.type === 'opening') { const P = openingParts(a), xs = [], ys = []; for (const p of P.cover) { xs.push(p[0]); ys.push(p[1]); } for (const [u, v] of P.lines) { xs.push(u[0], v[0]); ys.push(u[1], v[1]); } for (const arc of P.arcs) for (const p of arcPts(arc.cx, arc.cy, arc.r, arc.from, arc.to, 8)) { xs.push(p[0]); ys.push(p[1]); } return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; }
  if (a.type === 'pen' || a.type === 'area' || a.type === 'chaindim' || a.type === 'slab') { const xs = a.pts.map(p => p[0]), ys = a.pts.map(p => p[1]); return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; }
  if (a.type === 'path') { const xs = [], ys = []; for (const nd of a.nodes) { xs.push(nd.x, nd.hIn.x, nd.hOut.x); ys.push(nd.y, nd.hIn.y, nd.hOut.y); } if (!xs.length) return { x: 0, y: 0, w: 0, h: 0 }; return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; }
  if (a.type === 'text') return { x: a.x, y: a.y, w: (a.w || 120), h: (a.h || a.size * (a.text.split('\n').length) * 1.3) };
  if (a.type === 'section') return sectionBBox(a);
  if (a.type === 'note') return { x: a.x, y: a.y, w: 14, h: 14 };
  if (a.type === 'sig' || a.type === 'img' || a.type === 'imgph' || a.type === 'edit' || a.type === 'cover' || a.type === 'stamp' || a.type === 'crop') return { x: a.x, y: a.y, w: a.w, h: a.h };
  if (a.type === 'highlight') { if (!a.rects || !a.rects.length) return { x: 0, y: 0, w: 0, h: 0 }; let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity; for (const r of a.rects) { mnx = Math.min(mnx, r.x); mny = Math.min(mny, r.y); mxx = Math.max(mxx, r.x + r.w); mxy = Math.max(mxy, r.y + r.h); } return { x: mnx, y: mny, w: mxx - mnx, h: mxy - mny }; }
  return { x: 0, y: 0, w: 0, h: 0 };
}
function isLineType(a) { return a && (a.type === 'line' || a.type === 'arrow' || a.type === 'measure' || a.type === 'dim' || a.type === 'arc' || a.type === 'wall' || a.type === 'stairs'); }
function arcPath(a) { const r = Math.hypot(a.x2 - a.x1, a.y2 - a.y1) / 2; return `M ${a.x1} ${a.y1} A ${r} ${r} 0 0 1 ${a.x2} ${a.y2}`; }
function drawSelection(svg, a, pv) {
  if (!a) return; const hs = (COARSE ? 8 : 4.5) / pv.scale;
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
  if (isLineType(a)) {                                  // Linie: KEIN Rechteck-Rahmen, nur Linie hervorheben + Endpunkte
    svg.appendChild(svgEl('line', { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, class: 'sel-line' }));
    for (const [name, x, y] of [['p1', a.x1, a.y1], ['p2', a.x2, a.y2]]) svg.appendChild(svgEl('circle', { class: 'handle', cx: x, cy: y, r: hs, 'data-h': name }));
    if (a.type === 'wall' && a.dim) { const dg = wallDimGeom(a); svg.appendChild(svgEl('circle', { class: 'handle dim-handle', cx: (dg.x1 + dg.x2) / 2, cy: (dg.y1 + dg.y2) / 2, r: hs, 'data-h': 'dimoff', 'data-id': a.id })); }   // Masslinie von Hand verschieben
  } else {
    const b = bbox(a), pad = 3;
    svg.appendChild(svgEl('rect', { class: 'sel-out', x: b.x - pad, y: b.y - pad, width: b.w + 2 * pad, height: b.h + 2 * pad }));
    for (const [name, x, y] of [['nw', b.x, b.y], ['ne', b.x + b.w, b.y], ['sw', b.x, b.y + b.h], ['se', b.x + b.w, b.y + b.h]]) svg.appendChild(svgEl('rect', { class: 'handle', x: x - hs, y: y - hs, width: hs * 2, height: hs * 2, 'data-h': name }));
  }
}
// Hover-Vorschau (Maus über Anmerkung): Linie hervorheben + Endpunkte zeigen
function setHover(pv, a) {
  const old = pv.svg.querySelector('.hover-layer'); if (old) old.remove();
  if (!a || (sel && sel.num === pv.num && sel.id === a.id)) return;
  const g = svgEl('g', { class: 'hover-layer' });
  if (a.type === 'wall') {                                   // Wand: vier Eckpunkte zum Andocken zeigen
    g.appendChild(svgEl('line', { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, class: 'hover-line' }));
    const r = 4.5 / pv.scale;
    for (const p of wallPoly(a, getAnnos(pv.num))) g.appendChild(svgEl('circle', { cx: p[0], cy: p[1], r, class: 'hover-dot corner-dot' }));
  } else if (isLineType(a)) {
    g.appendChild(svgEl('line', { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, class: 'hover-line' }));
    const r = 4 / pv.scale;
    g.appendChild(svgEl('circle', { cx: a.x1, cy: a.y1, r, class: 'hover-dot' }));
    g.appendChild(svgEl('circle', { cx: a.x2, cy: a.y2, r, class: 'hover-dot' }));
  } else { const b = bbox(a), pad = 2; g.appendChild(svgEl('rect', { x: b.x - pad, y: b.y - pad, width: b.w + 2 * pad, height: b.h + 2 * pad, class: 'hover-box' })); }
  pv.svg.appendChild(g);
}

/* ---------- Maus → Seitenkoordinaten ---------- */
function evtToPage(pv, e) {
  const ctm = pv.svg.getScreenCTM().inverse();
  const p = pv.svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY;
  const q = p.matrixTransform(ctm); return { x: q.x, y: q.y };
}

/* ---------- Werkzeuge / Interaktion ---------- */
function bindPageEvents(pv) {
  pv.svg.addEventListener('pointerdown', e => onPointerDown(pv, e));
  pv.svg.addEventListener('pointermove', e => {                       // Hover-Vorschau im Auswahl-Modus
    if (tool !== 'select' || e.buttons) return;
    const id = (e.target.getAttribute && e.target.getAttribute('data-id')) || null;
    if (id === pv._hoverId) return; pv._hoverId = id;
    const ha = id ? findAnno(pv.num, +id) : null; setHover(pv, (ha && ha.locked) ? null : ha);
  });
  pv.svg.addEventListener('pointerleave', () => { pv._hoverId = null; setHover(pv, null); });
}
// Punkt aufs cm-Raster einrasten (nur wenn Raster an) – Linien/Formen/Text/Box „greifen"
function snapPt(x, y) { if (!gridOn) return { x, y }; const c = gridCellPt(); if (c <= 0) return { x, y }; return { x: Math.round((x - gridOffX) / c) * c + gridOffX, y: Math.round((y - gridOffY) / c) * c + gridOffY }; }
// An vorhandene Endpunkte/Knoten/Ecken einrasten (sauberes Anschliessen beim Zeichnen)
function anchorSnap(pv, x, y, excludeId) {
  const thr = 9 / pv.scale, cornerThr = 13 / pv.scale, midThr = 7 / pv.scale; let best = null, bd = cornerThr;   // Wand-Ecken etwas „klebriger", Mitte nur ganz nah
  const consider = (ax, ay, kind, t) => { const d = Math.hypot(ax - x, ay - y); if (d < (t || thr) && d < bd) { bd = d; best = { x: ax, y: ay, kind }; } };
  const arr = getAnnos(pv.num) || [];
  for (const a of arr) {
    if (a.id === excludeId) continue;
    if (a.type === 'wall') { consider(a.x1, a.y1, 'end'); consider(a.x2, a.y2, 'end'); consider((a.x1 + a.x2) / 2, (a.y1 + a.y2) / 2, 'mid', midThr); for (const p of wallPoly(a, arr)) consider(p[0], p[1], 'corner', cornerThr); }   // Achs-Enden + Mitte + die vier Band-Ecken
    else if (a.x1 != null) { consider(a.x1, a.y1, 'end'); consider(a.x2, a.y2, 'end'); consider((a.x1 + a.x2) / 2, (a.y1 + a.y2) / 2, 'mid', midThr); }
    else if (a.type === 'path') { for (const nd of a.nodes) consider(nd.x, nd.y, 'node'); }
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
let wallBuildup = null, buildDraft = [], buildSpacing = 60;   // Standard-Aufbau {layers,spacing} · Entwurf [[mat,cm,sub]] · Achsabstand UK (cm)
const SUB_OPTS = [['', '— keine UK —'], ['schraube', 'Distanzschrauben'], ['lattung', 'Holzlattung'], ['staender', 'Metallständer']];
function buildMatOptions(sel) { return Object.keys(WALL_MATS).map(k => `<option value="${k}"${k === sel ? ' selected' : ''}>${WALL_MATS[k].label}</option>`).join(''); }
function buildSubOptions(sel) { return SUB_OPTS.map(([v, l]) => `<option value="${v}"${v === (sel || '') ? ' selected' : ''}>${l}</option>`).join(''); }
function updateBuildTotal() { const t = buildDraft.reduce((s, r) => s + (+r[1] || 0), 0), el = document.getElementById('bpTotal'); if (el) el.textContent = 'Gesamt: ' + (Math.round(t * 10) / 10) + ' cm'; }
function renderBuildList() {
  const list = document.getElementById('bpList'); if (!list) return; list.innerHTML = '';
  buildDraft.forEach((row, i) => {
    const r = document.createElement('div'); r.className = 'bp-row';
    r.innerHTML = `<input class="bp-t" type="number" min="0.1" step="0.1" value="${row[1]}"><span>cm</span><select class="bp-m">${buildMatOptions(row[0])}</select><select class="bp-s" title="Unterkonstruktion in dieser Schicht">${buildSubOptions(row[2])}</select><button class="bp-del" title="Schicht entfernen">✕</button>`;
    r.querySelector('.bp-t').onchange = e => { buildDraft[i][1] = parseFloat((e.target.value || '').replace(',', '.')) || 0; updateBuildTotal(); };
    r.querySelector('.bp-m').onchange = e => { buildDraft[i][0] = e.target.value; };
    r.querySelector('.bp-s').onchange = e => { buildDraft[i][2] = e.target.value; };
    r.querySelector('.bp-del').onclick = () => { buildDraft.splice(i, 1); renderBuildList(); };
    list.appendChild(r);
  });
  updateBuildTotal();
}
function openBuildPop() {
  const presets = document.getElementById('bpPresets'); presets.innerHTML = '';
  WALL_PRESETS.forEach(p => { const b = document.createElement('button'); b.className = 'bp-preset'; b.textContent = p.name; b.onclick = () => { buildDraft = p.layers.map(l => [l[0], l[1], '']); renderBuildList(); }; presets.appendChild(b); });
  const a = selWall();
  if (a && a.layers && a.layers.length) { buildDraft = a.layers.map(l => [l.mat, Math.round(ptsToCm(l.t) * 10) / 10, l.sub ? l.sub.type : '']); const sp = a.layers.find(l => l.sub); if (sp) buildSpacing = Math.round(ptsToCm(sp.sub.spacing)); }
  else if (!buildDraft.length) buildDraft = WALL_PRESETS[0].layers.map(l => [l[0], l[1], '']);
  const si = document.getElementById('bpSpacing'); if (si) si.value = buildSpacing;
  renderBuildList(); document.getElementById('buildPop').hidden = false;
}
function applyBuildup() {
  const si = document.getElementById('bpSpacing'); if (si) buildSpacing = parseFloat((si.value || '').replace(',', '.')) || 60;
  const layers = buildDraft.filter(r => r[1] > 0).map(r => [r[0], r[1], r[2] || '']);
  wallBuildup = layers.length ? { layers, spacing: buildSpacing } : null;
  const a = selWall(); if (a) { pushUndo(); applyWallBuildup(a, layers, buildSpacing); pageViews.forEach(drawAnnos); saveState(); updateSelBar(); }
  document.getElementById('buildPop').hidden = true; toast(layers.length ? 'Wandaufbau angewendet ✓' : 'Aufbau entfernt');
}
let stairW = null, stairRiseM = 2.6, stairBaseM = 0;   // Treppe: Breite · Geschosshöhe · Unterkante
let roofType = 'sattel', roofEaveM = 2.6, roofRidgeM = 4.0, roofAxis = 'x';   // Dach: Pult/Sattel · Traufe · First · Firstrichtung
function stairWidthPts() { return stairW || cmToPts(100); }
function stairSteps(a) { return a.steps || Math.max(2, Math.round((a.rise || stairRiseM) / 0.18)); }   // ~18 cm Steigung
function wallThickPts() { return lastWallThick || cmToPts(17.5); }   // Standard 17,5 cm (Backstein)
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
let wallDimOn = false;   // neue Wände bekommen eine Masslinie?
function startDimOffDrag(pv, e, id) {   // Wand-Masslinie senkrecht zur Wand verschieben (setzt a.dimOff)
  const a = findAnno(pv.num, id); if (!a) return; pushUndo();
  const dx = a.x2 - a.x1, dy = a.y2 - a.y1, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len, mx = (a.x1 + a.x2) / 2, my = (a.y1 + a.y2) / 2;
  const move = ev => { const q = evtToPage(pv, ev); a.dimOff = (q.x - mx) * nx + (q.y - my) * ny; drawAnnos(pv); };
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
function wallDimChainPrims(a, arr, off) {   // Maßkette die auf Öffnungen reagiert: Pfeiler | Öffnung (Rohbaumass + Fertigmass) | Pfeiler
  const prims = [], dx = a.x2 - a.x1, dy = a.y2 - a.y1, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, nx = -uy, ny = ux, side = off >= 0 ? 1 : -1;
  const gap = wallDimGap, over = 4, tick = 5, P = (s, e) => [a.x1 + ux * s + nx * e, a.y1 + uy * s + ny * e];
  const ops = (arr || []).filter(o => o.type === 'opening' && o.wallId === a.id).map(o => ({ c: o.t * len, hw: o.w / 2, w: o.w, o })).sort((p, q) => p.c - q.c);
  let stn = [0]; for (const op of ops) { const l = Math.max(0, op.c - op.hw), r = Math.min(len, op.c + op.hw); if (l > stn[stn.length - 1] + 0.5) stn.push(l); stn.push(r); }
  if (len > stn[stn.length - 1] + 0.5) stn.push(len); else stn[stn.length - 1] = len;
  stn = [...new Set(stn.map(v => Math.round(v * 100) / 100))].sort((x, y) => x - y);
  prims.push({ t: 'line', a: P(-over, off), b: P(len + over, off), w: 0.9 });
  const kx = ux + nx, ky = uy + ny, kl = Math.hypot(kx, ky) || 1, sx = kx / kl, sy = ky / kl;
  for (const s of stn) { prims.push({ t: 'line', a: P(s, side * gap), b: P(s, off + side * over), w: 0.7 }); const pc = P(s, off); prims.push({ t: 'line', a: [pc[0] - sx * tick, pc[1] - sy * tick], b: [pc[0] + sx * tick, pc[1] + sy * tick], w: 1.1 }); }
  let ang = Math.atan2(uy, ux) * 180 / Math.PI; while (ang >= 90) ang -= 180; while (ang < -90) ang += 180;   // immer „von rechts" lesbar (vertikal → -90°), unabhängig von Zeichenrichtung
  const hLab = m => docScale ? (Math.round(m * 100) / 100).toFixed(2) : Math.round(m * 1000) + '';
  for (let i = 0; i < stn.length - 1; i++) {
    const s0 = stn[i], s1 = stn[i + 1], mid = (s0 + s1) / 2, segLen = s1 - s0, op = ops.find(o => Math.abs(mid - o.c) < o.hw - 0.5);
    if (op) { const o2 = op.o, sill = o2.kind === 'window' ? (o2.sill || 0) : 0, head = o2.head || (o2.kind === 'window' ? 2.1 : 2.0), hM = Math.max(0, head - sill);
      prims.push({ t: 'text', p: P(mid, off + side * 7), text: fmtLen(o2.w), ang, bold: true });          // Breite (Rohmass) auf der Linie
      prims.push({ t: 'text', p: P(mid, off + side * 18), text: hLab(hM), ang });                          // Höhe (Rohmass) darüber
    } else if (segLen > 3) prims.push({ t: 'text', p: P(mid, off + side * 7), text: fmtLen(segLen), ang });
  }
  return prims;
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
  let p = evtToPage(pv, e);
  const idAttr = e.target.getAttribute && e.target.getAttribute('data-id');
  const hAttr = e.target.getAttribute && e.target.getAttribute('data-h');

  if (tool === 'select') {
    if (e.target.getAttribute && e.target.getAttribute('data-group') && groupSel && groupSel.num === pv.num) { startGroupMove(pv, e); return; }   // ganze Gruppe ziehen
    const pn = e.target.getAttribute && e.target.getAttribute('data-pn'), ph = e.target.getAttribute && e.target.getAttribute('data-ph');
    if ((pn !== null || ph !== null) && sel && sel.num === pv.num) { startNodeDrag(pv, e, sel.id, pn, ph, e.target.getAttribute('data-hk')); return; }   // Kurven-Knoten/Anfasser ziehen
    if (hAttr === 'dimoff' && sel && sel.num === pv.num) { startDimOffDrag(pv, e, sel.id); return; }   // Wand-Masslinie verschieben
    if (hAttr === 'scflip' && sel && sel.num === pv.num) { const a = findAnno(pv.num, sel.id); if (a && a.type === 'section') { pushUndo(); a.flip = !a.flip; drawAnnos(pv); saveState(); toast('Blickrichtung gedreht'); } return; }   // Schnitt-Blickrichtung
    if (hAttr && sel && sel.num === pv.num) { startResize(pv, e, hAttr); return; }
    if (idAttr) {
      const aHit = findAnno(pv.num, +idAttr);
      if (aHit && aHit.locked) { sel = null; groupSel = null; drawAnnos(pv); startMarquee(pv, e); return; }   // gesperrt (Plan-Rahmen) → nicht greifen, Rahmen aufziehen
      if (e.ctrlKey || e.metaKey) {   // Strg/Cmd-Klick = zur Auswahl hinzufügen / entfernen
        let ids = groupSel && groupSel.num === pv.num ? groupSel.ids.slice() : (sel && sel.num === pv.num ? [sel.id] : []);
        const k = ids.indexOf(+idAttr); if (k >= 0) ids.splice(k, 1); else ids.push(+idAttr);
        if (ids.length === 1) { sel = { num: pv.num, id: ids[0] }; groupSel = null; }
        else if (ids.length > 1) { sel = null; groupSel = { num: pv.num, ids }; }
        else { sel = null; groupSel = null; }
        drawAnnos(pv); updateAlignBar(); updateSelBar(); return;
      }
      const wasSel = sel && sel.num === pv.num && sel.id === +idAttr;   // war schon ausgewählt → Klick (ohne Ziehen) = bearbeiten
      groupSel = null; sel = { num: pv.num, id: +idAttr }; drawAnnos(pv);
      const a = findAnno(pv.num, sel.id);
      if (a && a.type === 'note') { openNoteEdit(pv, a); return; }
      if (a && a.type === 'opening') { startOpeningMove(pv, e, a); return; }   // Öffnung entlang der Wand schieben
      startMove(pv, e, a, wasSel); return;
    }
    sel = null; groupSel = null; drawAnnos(pv); startMarquee(pv, e); return;   // leerer Klick → Rahmen aufziehen
  }
  if (['line', 'arrow', 'rect', 'oval', 'arc', 'curve', 'measure', 'dim', 'wall'].includes(tool)) { const an = anchorSnap(pv, p.x, p.y); if (an) p = an; else if (gridOn) p = snapPt(p.x, p.y); }   // an Endpunkten/Knoten oder Raster einrasten
  else if (gridOn && tool !== 'eraser' && tool !== 'edittext' && tool !== 'pen' && tool !== 'highlight' && tool !== 'textsel' && tool !== 'calibrate') p = snapPt(p.x, p.y);
  if (tool === 'curve') { curveClick(pv, e, p); return; }
  if (tool === 'sig') { placeSig(pv, p); return; }
  if (tool === 'highlight') { startHighlight(pv, e, p); return; }
  if (tool === 'stamp') { placeStamp(pv, p); return; }
  if (tool === 'eraser') { startErase(pv, e); return; }
  if (tool === 'crop') { startCrop(pv, e, p); return; }
  if (tool === 'area' || tool === 'slab') { areaClick(pv, p); return; }
  if (tool === 'block') { placeBlock(pv, p); return; }
  if (tool === 'section') { startSection(pv, e, p); return; }
  if (tool === 'chaindim') { chaindimClick(pv, p); return; }
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
/* ---------- Fläche messen (Polygon, m²) ---------- */
function polyArea(pts) { let s = 0; for (let i = 0; i < pts.length; i++) { const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]; s += x1 * y2 - x2 * y1; } return Math.abs(s) / 2; }
function centroid(pts) { let x = 0, y = 0; for (const p of pts) { x += p[0]; y += p[1]; } return [x / pts.length, y / pts.length]; }
function areaLabel(pts) {
  const apt = polyArea(pts);
  if (docScale) { const m2 = apt * docScale.perPt * docScale.perPt; return m2 >= 0.01 ? (Math.round(m2 * 100) / 100).toString().replace('.', ',') + ' m²' : Math.round(m2 * 1e4) + ' cm²'; }
  const cm2 = apt * PT2MM * PT2MM / 100; return Math.round(cm2) + ' cm² (Papier)';
}
function areaClick(pv, p) {
  if (!areaDraft || areaDraft.pv !== pv) {
    cancelArea(); pushUndo();
    const isSlab = tool === 'slab';
    const a = isSlab ? { id: nextId++, type: 'slab', pts: [[p.x, p.y]], color: '#5b6b86', base: wallHeightM, thick: 0.2 } : { id: nextId++, type: 'area', pts: [[p.x, p.y]], color: style.color, width: style.width };
    pushAnno(pv.num, a); areaDraft = { pv, a };
    const onMove = ev => { if (!areaDraft) return; const q = evtToPage(areaDraft.pv, ev); areaDraft.a._cursor = [q.x, q.y]; drawAnnos(areaDraft.pv); };
    document.addEventListener('pointermove', onMove); areaDraft._onMove = onMove;
    drawAnnos(pv); if (isSlab && !areaClick._slabHint) { areaClick._slabHint = true; toast('Decke/Boden: Ecken klicken, am Start schliessen (oder Enter). Höhe + Dicke oben in der Planungs-Leiste · erscheint in 3D.'); } else if (!isSlab && !docScale && !areaClick._hint) { areaClick._hint = true; toast('Tipp: Für echte m² zuerst den Massstab setzen (1:n).'); }
    return;
  }
  const a = areaDraft.a, f = a.pts[0];
  if (a.pts.length >= 3 && Math.hypot(p.x - f[0], p.y - f[1]) * pv.scale < 12) { finishArea(); return; }   // am ersten Punkt schliessen
  a.pts.push([p.x, p.y]); drawAnnos(pv);
}
function finishArea() {
  if (!areaDraft) return; const { pv, a, _onMove } = areaDraft; document.removeEventListener('pointermove', _onMove);
  delete a._cursor; areaDraft = null;
  if (a.pts.length < 3) { const arr = getAnnos(pv.num), i = arr.indexOf(a); if (i >= 0) arr.splice(i, 1); if (undoStack.length) undoStack.pop(); drawAnnos(pv); setTool('select'); return; }
  sel = { num: pv.num, id: a.id }; setTool('select'); drawAnnos(pv); saveState();
}
function cancelArea() {
  if (!areaDraft) return; const { pv, a, _onMove } = areaDraft; document.removeEventListener('pointermove', _onMove);
  const arr = getAnnos(pv.num), i = arr.indexOf(a); if (i >= 0) { arr.splice(i, 1); if (undoStack.length) undoStack.pop(); }
  areaDraft = null; if (pv) drawAnnos(pv);
}
/* ---------- Kettenmass (mehrere Stationen klicken → Masskette mit Einzelmassen) ---------- */
let cdimDraft = null;
function chaindimClick(pv, p) {
  { const an = anchorSnap(pv, p.x, p.y); if (an) p = an; else if (gridOn) p = snapPt(p.x, p.y); }   // an Endpunkte/Raster
  if (!cdimDraft || cdimDraft.pv !== pv) {
    cancelChaindim(); pushUndo();
    const a = { id: nextId++, type: 'chaindim', pts: [[p.x, p.y]], color: style.color };
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
      if (!ev.altKey) {                                  // an Seitenrändern/-mitte & anderen Objekten einrasten (Alt = frei)
        const s = moveSnapAdjust(pv, a, orig, dx, dy);
        if (s.dx !== dx || s.dy !== dy) { dx = s.dx; dy = s.dy; translateAnno(a, orig, dx, dy); }
        guides = s.guides;
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
  if (a.type === 'line' || a.type === 'arrow' || a.type === 'measure' || a.type === 'dim' || a.type === 'arc' || a.type === 'wall' || a.type === 'stairs') { a.x1 = o.x1 + dx; a.y1 = o.y1 + dy; a.x2 = o.x2 + dx; a.y2 = o.y2 + dy; }
  else if (a.type === 'pen' || a.type === 'area' || a.type === 'chaindim' || a.type === 'slab') a.pts = o.pts.map(p => [p[0] + dx, p[1] + dy]);
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
    for (const a of (getAnnos(pv.num) || [])) { if (a.type === 'crop' || a.type === 'imgph' || a.locked) continue; const b = bbox(a); if (b.x < rx + rw && b.x + b.w > rx && b.y < ry + rh && b.y + b.h > ry) ids.push(a.id); }
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
function startGroupMove(pv, e) {
  const start = evtToPage(pv, e); pushUndo(); const origs = {}; let moved = false;
  for (const id of groupSel.ids) { const a = findAnno(pv.num, id); if (a) origs[id] = JSON.parse(JSON.stringify(a)); }
  const move = ev => { const q = evtToPage(pv, ev), dx = q.x - start.x, dy = q.y - start.y; moved = true; for (const id of groupSel.ids) { const a = findAnno(pv.num, id); if (a && origs[id]) translateAnno(a, origs[id], dx, dy); } drawAnnos(pv); };
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
    if (document.activeElement !== $('#pbDepth')) $('#pbDepth').value = Math.round((sO && sO.depth != null ? sO.depth : lastOpenDepth) * 100);
    $('#pbNiche').style.display = kind === 'window' ? '' : 'none'; $('#pbNiche').classList.toggle('on', !!(sO && sO.niche));
    const tOpts = kind === 'door' ? '<option value="fest">Festverglast</option><option value="f1">1 Flügel</option><option value="f2">2 Flügel</option><option value="f1f">1 Flügel + Fixteil</option>' : '<option value="fest">Festverglasung</option><option value="f1">1 Flügel</option><option value="f2">2 Flügel (direkt)</option><option value="f2s">2 Flügel + Setzholz</option>';
    if ($('#pbWinType').dataset.kind !== kind) { $('#pbWinType').innerHTML = tOpts; $('#pbWinType').dataset.kind = kind; }
    $('#pbWinType').style.display = winLike ? '' : 'none'; $('#pbWinType').value = (sO && sO.winType) || (kind === 'door' ? lastDoorType : lastWinType);
    $('#pbWinHinge').style.display = winLike ? '' : 'none'; $('#pbWinHinge').value = (sO && sO.winHinge) || lastWinHinge;
    $('#pbWinMore').style.display = winLike ? '' : 'none';
    $('#pbLaibEdit').style.display = winLike ? '' : 'none';
    $('#pbReveal').style.display = winLike ? '' : 'none'; $('#pbReveal').value = (sO && sO.revealType) || 'putz';
    $('#pbAnschlag').style.display = winLike ? '' : 'none'; $('#pbAnschlag').value = (sO && sO.anschlagType) || 'none';
    $('#pbAnschlagDWrap').style.display = winLike && sO && sO.anschlagType && sO.anschlagType !== 'none' ? '' : 'none'; if (document.activeElement !== $('#pbAnschlagD')) $('#pbAnschlagD').value = Math.round(ptsToCm(sO && sO.anschlagDepth != null ? sO.anschlagDepth : cmToPts(5)) * 10) / 10;
    $('#pbWinMat').style.display = winLike ? '' : 'none'; $('#pbWinMat').value = (sO && sO.winMat) || lastWinMat || 'holz';
    $('#pbOuterWrap').style.display = winLike ? '' : 'none'; if (document.activeElement !== $('#pbOuterLap')) $('#pbOuterLap').value = Math.round(ptsToCm(sO && sO.outerLap != null ? sO.outerLap : cmToPts(3)) * 10) / 10;
    $('#pbInnerWrap').style.display = winLike ? '' : 'none'; if (document.activeElement !== $('#pbInnerRev')) $('#pbInnerRev').value = Math.round(ptsToCm(sO && sO.innerReveal != null ? sO.innerReveal : cmToPts(2)) * 10) / 10;
    $('#pbFlip').style.display = kind === 'door' ? '' : 'none';
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
  const a = findAnno(pv.num, id); if (!a || a.type !== 'path') return; pushUndo();
  const move = ev => {
    let q = evtToPage(pv, ev); if (gridOn && !ev.altKey) q = snapPt(q.x, q.y);
    if (pnIdx !== null) { const nd = a.nodes[+pnIdx], dx = q.x - nd.x, dy = q.y - nd.y; nd.hIn.x += dx; nd.hIn.y += dy; nd.hOut.x += dx; nd.hOut.y += dy; nd.x = q.x; nd.y = q.y; }   // Knoten + seine Anfasser mitnehmen
    else { const nd = a.nodes[+phIdx], h = hk === 'in' ? nd.hIn : nd.hOut, other = hk === 'in' ? nd.hOut : nd.hIn; h.x = q.x; h.y = q.y; if (!ev.altKey) { other.x = 2 * nd.x - q.x; other.y = 2 * nd.y - q.y; } }   // Anfasser ziehen (Alt = einseitig)
    drawAnnos(pv);
  };
  const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); saveState(); };
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
  if (!e.shiftKey && (tool === 'wall' || tool === 'line' || tool === 'arrow' || tool === 'measure' || tool === 'dim' || tool === 'stairs')) {
    const sp = snapWallPt(pv, p.x, p.y); if (sp) p = { x: sp.x, y: sp.y }; else if (gridOn) p = snapPt(p.x, p.y);   // Startpunkt auf Wand-Ende/-Achse einrasten → saubere Gehrung
  }
  let a;
  if (tool === 'pen') a = { id: nextId++, type: 'pen', pts: [[p.x, p.y]], color: style.color, width: style.width };
  else if (tool === 'rect') a = { id: nextId++, type: 'rect', x: p.x, y: p.y, w: 0, h: 0, color: style.color, width: style.width };
  else if (tool === 'roof') a = { id: nextId++, type: 'roof', x: p.x, y: p.y, w: 0, h: 0, rtype: roofType, eave: roofEaveM, ridge: roofRidgeM, axis: roofAxis, color: style.color };
  else if (tool === 'oval') a = { id: nextId++, type: 'oval', x: p.x, y: p.y, w: 0, h: 0, color: style.color, width: style.width };
  else if (tool === 'wall') a = { id: nextId++, type: 'wall', x1: p.x, y1: p.y, x2: p.x, y2: p.y, thick: wallThickPts(), just: wallJust, color: (wallHatch && wallHatch.color) || style.color, fill: (wallHatch && wallHatch.fill) || '#ffffff', hatch: wallHatch ? { ...wallHatch } : null, width: 1.4, dim: wallDimOn };   // Wand = Linie mit Dicke
  else if (tool === 'stairs') a = { id: nextId++, type: 'stairs', x1: p.x, y1: p.y, x2: p.x, y2: p.y, width: stairWidthPts(), rise: stairRiseM, base: stairBaseM, color: style.color };   // Treppe = Lauf (Linie mit Breite + Höhe)
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
    if (clk && (cur.type === 'line' || cur.type === 'arrow' || cur.type === 'measure' || cur.type === 'dim' || cur.type === 'wall' || cur.type === 'stairs')) { startSegDraft(pv, cur); return; }   // Klick = Richtung anpeilen, dann 2. Klick oder L (Wand/Linie/Treppe)
    const b = bbox(cur); if (cur.type !== 'pen' && b.w < 3 && b.h < 3) { const arr = getAnnos(pv.num); arr.splice(arr.indexOf(cur), 1); undoStack.pop(); drawAnnos(pv); return; }
    if (isLineType(cur)) lastLine = { num: pv.num, id: cur.id };   // „L" wirkt auf die zuletzt gezeichnete Linie
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
  lastLine = { num: pv.num, id: a.id }; drawAnnos(pv); saveState();
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
    const box = (s0, s1, mA, mB) => fills.push({ poly: [corner(s0, mA), corner(s1, mA), corner(s1, mB), corner(s0, mB)], fill: wm.fill, stroke: wm.stroke });
    const twoMull = wt === 'f2s', twoFlush = wt === 'f2', two = twoMull || twoFlush;   // f2 = direkt verbunden (kein Mittelrahmen), f2s = mit Setzholz (Mittelrahmen)
    const gIn = cmToPts(1) / hw;   // Glas greift 1 cm in die Flügel
    const div = two ? [-1, 0, 1] : [-1, 1], hasMember = dv => dv <= -0.999 || dv >= 0.999 || twoMull;
    for (const dv of div) { if (!hasMember(dv)) continue; let m0, m1; if (dv <= -0.999) { m0 = -1; m1 = -1 + fwS; } else if (dv >= 0.999) { m0 = 1 - fwS; m1 = 1; } else { m0 = -fwS / 2; m1 = fwS / 2; } box(m0, m1, fmA, fmB); }   // Blendrahmen (Jamben + Setzholz)
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
  }
  else if (a.kind === 'door' && detail) {   // Tür wie Fenster: Zarge (Rahmen) + Flügel mit Schwenk; Festteil = Glas; 1-/2-flüglig
    const wt = a.winType || 'f1', wm = WIN_MAT[a.winMat || 'holz'];
    const depth = a.depth == null ? 0.5 : a.depth, md = Math.max(-1, Math.min(1, depth * 2 - 1));
    const frameD = a.frameD || cmToPts(7), frameW = a.frameW || cmToPts(6);
    const fdh = Math.min(0.49, frameD / (2 * ht)); let fmA = md - fdh, fmB = md + fdh;
    if (fmA < -1) { fmB += (-1 - fmA); fmA = -1; } if (fmB > 1) { fmA -= (fmB - 1); fmB = 1; }
    const fwS = Math.min(0.4, frameW / hw), gc = (fmA + fmB) / 2, gh = Math.min((fmB - fmA) * 0.32, (a.glassT || cmToPts(2)) / (2 * ht));
    const sw = a.swing || 1, hingeRight = a.winHinge === 'right', mid = wt === 'f2' || wt === 'f2s' || wt === 'f1f';
    const box = (s0, s1, mA, mB) => fills.push({ poly: [corner(s0, mA), corner(s1, mA), corner(s1, mB), corner(s0, mB)], fill: wm.fill, stroke: wm.stroke });
    const div = mid ? [-1, 0, 1] : [-1, 1];
    for (const dv of div) { let m0, m1; if (dv <= -0.999) { m0 = -1; m1 = -1 + fwS; } else if (dv >= 0.999) { m0 = 1 - fwS; m1 = 1; } else { m0 = -fwS / 2; m1 = fwS / 2; } box(m0, m1, fmA, fmB); }   // Zarge (Jamben + Mittelpfosten)
    const glassPane = (sl, sr) => fills.push({ poly: [corner(sl, gc - gh), corner(sr, gc - gh), corner(sr, gc + gh), corner(sl, gc + gh)], fill: '#c7e2f5', stroke: '#7fa9c6' });
    const leaf = (hingeS, dirAlong, clearWs) => { const hp = corner(hingeS, md), Ln = clearWs * hw, tip = [hp[0] + nx * sw * Ln, hp[1] + ny * sw * Ln], closed = [hp[0] + ux * dirAlong * Ln, hp[1] + uy * dirAlong * Ln], tw = Math.min(fdh * 1.4 * ht, cmToPts(4)), ox = ux * dirAlong * tw, oy = uy * dirAlong * tw; fills.push({ poly: [hp, tip, [tip[0] + ox, tip[1] + oy], [hp[0] + ox, hp[1] + oy]], fill: wm.fill, stroke: wm.stroke }); arcs.push({ cx: hp[0], cy: hp[1], r: Ln, from: tip, to: closed }); };
    if (wt === 'fest') glassPane(-1 + fwS, 1 - fwS);
    else if (wt === 'f2' || wt === 'f2s') { leaf(-1 + fwS, 1, 1 - 1.5 * fwS); leaf(1 - fwS, -1, 1 - 1.5 * fwS); }   // zwei Flügel von beiden Jamben zur Mitte
    else if (wt === 'f1f') { if (hingeRight) { glassPane(-1 + fwS, -fwS / 2); leaf(1 - fwS, -1, 1 - 1.5 * fwS); } else { leaf(-1 + fwS, 1, 1 - 1.5 * fwS); glassPane(fwS / 2, 1 - fwS); } }   // ein Flügel + Festverglasung
    else { if (hingeRight) leaf(1 - fwS, -1, 2 - 2 * fwS); else leaf(-1 + fwS, 1, 2 - 2 * fwS); }   // 1 Flügel
  }
  else {   // einfache Tür (einschichtig): Blatt + Schwenk
    const hS = a.hinge || 1, sN = a.swing || 1, hp = [x - ux * hw * hS, y - uy * hw * hS], tip = [hp[0] + nx * a.w * sN, hp[1] + ny * a.w * sN], closed = [x + ux * hw * hS, y + uy * hw * hS];
    bold.push([hp, tip]); arcs.push({ cx: hp[0], cy: hp[1], r: a.w, from: tip, to: closed });
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
function openingRevealStrips(a, arr) {   // Laibung: 1,5 cm Rahmen sichtbar → Schalung 1,5 cm (Schraffur) → Rest Dämmung bis Rahmen; innen Putz/Brett
  const wall = a.wallId && arr && arr.find(o => o.id === a.wallId && o.type === 'wall');
  if (!wall || !wall.layers || wall.layers.length < 2 || (a.kind !== 'window' && a.kind !== 'door')) return [];
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
  const innerLining = rt0 === 'aussen' ? [[lN.mat, Math.min(3, ptsToCm(lN.t))]] : (REVEAL_LINING[rt0] || [[l0.mat, ptsToCm(l0.t)]]);   // putz = innerste Wandschicht reingezogen; aussen = äusserste; sonst feste Konstruktion
  if (Math.abs((fmA - gapM) + 1) > 0.02) { let sAcc = 0; for (const [mat, tcm] of innerLining) { const mt = LINING_MAT[mat] || WALL_MATS[mat] || {}, tw = Math.min(0.42, cmToPts(tcm) / hw), sk = mt.stroke || mt.color || '#1c242c'; for (const sgn of [-1, 1]) { const s0 = sgn * (1 - sAcc), s1 = sgn * (1 - sAcc - tw); strips.push({ poly: [corner(s0, -1), corner(s1, -1), corner(s1, fmA - gapM), corner(s0, fmA - gapM)], fill: mt.fill || '#fff', stroke: sk, hatch: mt.hatch ? bandHatch(Math.min(s0, s1), Math.max(s0, s1), -1, fmA - gapM, corner, hw, ht, stepS) : null }); } sAcc += tw; } }
  const total = wall.layers.reduce((s, l) => s + l.t, 0) || 1; let cum = 0;
  const pos = wall.layers.map(l => { const f0 = cum / total, f1 = (cum + l.t) / total; cum += l.t; return { l, mLo: -1 + 2 * f0, mHi: -1 + 2 * f1 }; });   // Schicht-Positionen über die Wanddicke
  const outerPos = pos.filter((p, i) => i > coreIdx);   // Schichten ausserhalb Tragkern
  if (outerPos.length) {   // jede Aussenschicht läuft ununterbrochen aus der Wand (an ihrer m-Position) bis ans Laibungsbrett; Hinterlüftung bleibt offener Spalt
    const fwSr = Math.min(0.45, (a.frameW || cmToPts(10)) / hw), visS = Math.min(fwSr * 0.6, cmToPts(a.boardVis != null ? a.boardVis : 1) / hw), schWs = Math.min(0.3, cmToPts(a.boardW != null ? a.boardW : 2.5) / hw);
    const boardMat = WALL_MATS[a.boardMat || 'holz'] || { fill: '#e7cfa8', color: '#7a5126' };
    for (const sgn of [-1, 1]) {
      const sBI = sgn * Math.min(1, 1 - fwSr + visS), sBO = sgn * Math.min(1, 1 - fwSr + visS + schWs), sE = sgn, lo = Math.min(sBO, sE), hi = Math.max(sBO, sE);
      if (hi - lo > 0.02) for (const p of outerPos) {
        if (p.l.mat === 'luft') continue;   // Hinterlüftung: offener Spalt bis zum Brett (nicht gefüllt)
        const mLoC = Math.max(p.mLo, fmB + gapM); if (p.mHi - mLoC < 0.01) continue;
        const m = WALL_MATS[p.l.mat] || {}, isD = INS.includes(p.l.mat), isW = ['holz', 'konter'].includes(p.l.mat);
        strips.push({ poly: [corner(sBO, mLoC), corner(sE, mLoC), corner(sE, p.mHi), corner(sBO, p.mHi)], fill: m.fill || '#fff', stroke: m.color || '#1c242c', hatch: isD ? bandHatchPerp(lo, hi, mLoC, p.mHi, corner, stepS, s0) : (isW ? bandHatch(lo, hi, mLoC, p.mHi, corner, hw, ht, stepS) : null) });   // Schicht läuft bis zum Brett
      }
      if (Math.abs(sBO - sBI) > 0.02) strips.push({ poly: [corner(sBI, fmB), corner(sBO, fmB), corner(sBO, 1), corner(sBI, 1)], fill: boardMat.fill, stroke: boardMat.color, hatch: bandHatch(Math.min(sBI, sBO), Math.max(sBI, sBO), fmB, 1, corner, hw, ht, stepS) });   // Laibungsbrett, 1 cm vom Rahmen
    }
  }
  const anType = a.anschlagType || 'none';   // Anschlag: Mauerwerk läuft aussen (bzw. innen) vor den Rahmen → Öffnung dort schmaler
  if (anType !== 'none') {
    const core = wall.layers[coreIdx] || wall.layers[0], cmat = WALL_MATS[core.mat] || {};
    const fwSr = Math.min(0.45, (a.frameW || cmToPts(10)) / hw), anS = Math.min(0.6, cmToPts(a.anschlagDepth != null ? a.anschlagDepth : 5) / hw);
    const mLo = anType === 'innen' ? -1 : fmB, mHi = anType === 'innen' ? fmA : 1;
    for (const sgn of [-1, 1]) {
      const s0 = sgn, s1 = sgn * Math.max(0, 1 - fwSr - anS);
      if (Math.abs(mHi - mLo) > 0.02 && Math.abs(s1 - s0) > 0.02) strips.push({ poly: [corner(s0, mLo), corner(s1, mLo), corner(s1, mHi), corner(s0, mHi)], fill: cmat.fill || '#fff', stroke: cmat.color || '#1c242c', hatch: bandHatch(Math.min(s0, s1), Math.max(s0, s1), mLo, mHi, corner, hw, ht, stepS) });   // Mauerwerks-Anschlag vor dem Rahmen
    }
  }
  return strips;
}
function openingLichtW(o) {   // Rohbau-, Aussenlicht-, Innenlichtmass (Fenster)
  const roh = o.w; if (o.kind !== 'window') return { roh };
  return { roh, aussen: roh - 2 * (o.outerLap || cmToPts(3)), innen: roh - 2 * (o.innerReveal || cmToPts(2)) };
}
function openingDetail(a, arr) { const wall = a.wallId && arr && arr.find(o => o.id === a.wallId && o.type === 'wall'); return !!(wall && !wallSimple(wall) && wall.layers && wall.layers.length); }
function drawOpening(svg, a, arr) {
  const detail = openingDetail(a, arr), P = openingParts(a, detail), col = a.color || '#1c242c';
  const g = svgEl('g', { 'data-id': a.id });
  g.appendChild(svgEl('polygon', { points: P.cover.map(p => p[0] + ',' + p[1]).join(' '), fill: '#fff', stroke: 'none' }));   // Wand ausstanzen
  if (detail) for (const st of openingRevealStrips(a, arr)) { g.appendChild(svgEl('polygon', { points: st.poly.map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' '), fill: st.fill, stroke: st.stroke, 'stroke-width': 0.7, 'vector-effect': 'non-scaling-stroke' })); if (st.hatch) for (const [u, v] of st.hatch) g.appendChild(svgEl('line', { x1: u[0], y1: u[1], x2: v[0], y2: v[1], stroke: st.stroke, 'stroke-width': 0.8, 'vector-effect': 'non-scaling-stroke' })); }   // Schichteinzug + Schalungs-Schraffur
  for (const f of (P.fills || [])) g.appendChild(svgEl('polygon', { points: f.poly.map(p => p[0].toFixed(2) + ',' + p[1].toFixed(2)).join(' '), fill: f.fill, stroke: f.stroke, 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }));   // Rahmen/Flügel/Glas (Fenstermaterial)
  for (const [u, v] of P.lines) g.appendChild(svgEl('line', { x1: u[0], y1: u[1], x2: v[0], y2: v[1], stroke: col, 'stroke-width': 1.4, 'vector-effect': 'non-scaling-stroke' }));
  for (const [u, v] of (P.bold || [])) g.appendChild(svgEl('line', { x1: u[0], y1: u[1], x2: v[0], y2: v[1], stroke: col, 'stroke-width': 2.6, 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke' }));
  for (const arc of P.arcs) g.appendChild(svgEl('polyline', { points: arcPts(arc.cx, arc.cy, arc.r, arc.from, arc.to, 18).map(p => p[0] + ',' + p[1]).join(' '), fill: 'none', stroke: col, 'stroke-width': 0.8, 'stroke-dasharray': '4 3', 'vector-effect': 'non-scaling-stroke' }));
  svg.appendChild(g);
  svg.appendChild(svgEl('polygon', { points: P.cover.map(p => p[0] + ',' + p[1]).join(' '), fill: 'transparent', 'data-id': a.id }));
  return g;
}
/* ---------- Schnitt-Werkzeug: live 2D-Vertikalschnitt aus dem Modell ---------- */
function segInt(a, b, c, d) {   // Schnitt zweier Strecken → {pt,t1,t2} oder null
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0]; if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null; return { pt: [a[0] + t * r[0], a[1] + t * r[1]], t1: t, t2: u };
}
function sectionMaxH(a, arr) { let m = wallHeightM; for (const w of arr || []) { if (w.type !== 'wall' || !layerVisible(w) || !phaseVisible(w)) continue; m = Math.max(m, w.h3d || wallHeightM); } return m; }   // gemeinsames Höhen-Datum: höchste Wand im Gebäude → alle Schnitte gleich hoch (perfekt nebeneinanderlegbar)
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
  if (hatch === 'daemm_eps' || hatch === 'daemm_wolle' || INSUL_TYPES.includes(hatch)) { for (let y = y0 + S / 2; y < y1; y += S) add(x0, y, x1, y); }   // Dämmung: Striche quer zur Wanddicke (im Schnitt horizontal)
  else if (hatch === 'holz' || hatch === 'konter') { for (let x = x0 + S * 0.8; x < x1; x += S * 1.5) add(x, y0, x, y1, 0.6); }   // Holz: senkrechte Bretter
  else if (hatch === 'gips') { /* im Schnitt ruhig lassen */ }
  else if (hatch === 'beton' || hatch === 'cross') { for (let c = -rh; c < rw; c += S) add(x0 + c, y1, x0 + c + rh, y0); for (let c = 0; c < rw + rh; c += S) add(x0 + c, y0, x0 + c - rh, y1); }   // Beton: Kreuz
  else { for (let c = -rh; c < rw; c += S) add(x0 + c, y1, x0 + c + rh, y0); }   // Backstein/Diagonal/Erdreich: 45°
}
let winDimsOn = true;   // automatische Fenster-/Tür-Bemaßung im Schnitt/Ansicht
function pDimH(out, y, x1, x2, label, below) { const col = '#1c242c'; out.push({ t: 'line', x1: x1, y1: y, x2: x2, y2: y, stroke: col, w: 0.5 }); for (const x of [x1, x2]) out.push({ t: 'line', x1: x, y1: y - 3, x2: x, y2: y + 3, stroke: col, w: 0.5 }); out.push({ t: 'text', x: (x1 + x2) / 2 - label.length * 2.4, y: y + (below ? 11 : -4), text: label, col, small: true }); }
function pDimV(out, x, y1, y2, label, lx) { const col = '#1c242c'; out.push({ t: 'line', x1: x, y1: y1, x2: x, y2: y2, stroke: col, w: 0.5 }); for (const y of [y1, y2]) out.push({ t: 'line', x1: x - 3, y1: y, x2: x + 3, y2: y, stroke: col, w: 0.5 }); out.push({ t: 'text', x: x + (lx || 5), y: (y1 + y2) / 2 + 3, text: label, col, small: true }); }
function openingElev(out, X, Yh, opx0, opw, o, H, col, redM) {   // Fenster/Tür in Ansicht von aussen → Aussenlichtmaß (Verkleidung/Sturz lappt über den Rahmen, redM)
  const r = redM || 0, sill = (o.kind === 'window' ? (o.sill || 0) + r : 0), head = Math.min(H, o.head || (o.kind === 'window' ? 2.1 : 2.0)) - r;
  if (head - sill < 0.02 || opw < 1) return;
  out.push({ t: 'rect', x: X(opx0), y: Yh(head), w: opw, h: Yh(sill) - Yh(head), fill: '#ffffff', stroke: 'none', sw: 0 });
  if (o.kind === 'window') {
    const wm = WIN_MAT[o.winMat || 'holz'], wt = o.winType || 'f1', fr = Math.min(opw * 0.12, 5), yT = Yh(head), yB = Yh(sill);
    out.push({ t: 'rect', x: X(opx0), y: yT, w: opw, h: yB - yT, fill: wm.fill, stroke: wm.stroke, sw: 1.4 });   // Blendrahmen (Material)
    const two = wt === 'f2' || wt === 'f2s', panes = two ? 2 : 1, pw = opw / panes;
    for (let pi = 0; pi < panes; pi++) { const px0 = X(opx0) + pi * pw; if (pi > 0) { if (wt === 'f2s') { out.push({ t: 'rect', x: px0 - fr, y: yT, w: 2 * fr, h: yB - yT, fill: wm.fill, stroke: wm.stroke, sw: 1.2 }); } else out.push({ t: 'line', x1: px0, y1: yT, x2: px0, y2: yB, stroke: col, w: 1.2 }); }
      const ins = wt === 'fest' ? fr : fr * 2;
      out.push({ t: 'rect', x: px0 + ins, y: yT + ins, w: pw - 2 * ins, h: (yB - yT) - 2 * ins, fill: '#c7e2f5', stroke: '#7fa9c6', sw: 0.8 });   // Glas
      if (wt !== 'fest') { out.push({ t: 'rect', x: px0 + fr, y: yT + fr, w: pw - 2 * fr, h: (yB - yT) - 2 * fr, fill: 'none', stroke: wm.stroke, sw: 0.9 });   // Flügelrahmen
        const ix0 = px0 + fr * 1.6, ix1 = px0 + pw - fr * 1.6, iy0 = yT + fr * 1.6, iy1 = yB - fr * 1.6, cmx = (ix0 + ix1) / 2, cmy = (iy0 + iy1) / 2, hinge = o.winHinge || 'left';
        if (hinge === 'kipp') { out.push({ t: 'line', x1: ix0, y1: iy0, x2: cmx, y2: iy1, stroke: col, w: 0.6, dash: '4 3' }); out.push({ t: 'line', x1: ix1, y1: iy0, x2: cmx, y2: iy1, stroke: col, w: 0.6, dash: '4 3' }); }
        else { const apexL = (two ? pi === 0 : hinge === 'left'), ax = apexL ? ix0 : ix1, bx = apexL ? ix1 : ix0; out.push({ t: 'line', x1: bx, y1: iy0, x2: ax, y2: cmy, stroke: col, w: 0.6, dash: '4 3' }); out.push({ t: 'line', x1: bx, y1: iy1, x2: ax, y2: cmy, stroke: col, w: 0.6, dash: '4 3' }); }
      }
    }
    out.push({ t: 'line', x1: X(opx0) - 6, y1: Yh(sill), x2: X(opx0 + opw) + 6, y2: Yh(sill), stroke: col, w: 1.8 });   // Fensterbank
    if (o.niche) { const nh = (Yh(0) - Yh(0.24)); out.push({ t: 'rect', x: X(opx0), y: Yh(head) - nh, w: opw, h: nh, fill: '#e9e6df', stroke: col, sw: 0.8 }); }   // Storennische
  } else {
    const wm = WIN_MAT[o.winMat || 'holz'], wt = o.winType || 'f1', fr = Math.min(opw * 0.1, 5), yT = Yh(head), yB = Yh(sill), hingeRight = o.winHinge === 'right';
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
function sectionCutOpening(out, X, Yh, distPt, appW, o, H, perPt, wall, flip) {   // Schnitt DURCH die Öffnung: gedrehtes Grundriss-Profil (Rahmen/Flügel/Scheibe + Schichteinzug), Sturz oben/Schwelle unten
  const sill = o.kind === 'window' ? (o.sill || 0) : 0, head = Math.min(H, o.head || (o.kind === 'window' ? 2.1 : 2.0));
  if (head - sill < 0.02 || appW < 2) return;
  const hPx = (head - sill) / perPt, cx = X(distPt), cy = Yh((sill + head) / 2), ht2 = appW / 2, hw = hPx / 2;
  const corner = (s, m) => [cx + ht2 * m, cy - hw * s];   // s = vertikal (Kopf oben), m = horizontal (Wanddicke)
  const layered = !simpleMode && wall.layers && wall.layers.length >= 2, dep0 = o.depth == null ? 0.5 : o.depth, dep = flip ? 1 - dep0 : dep0;   // Blickrichtung: Innen/Aussen tauschen
  out.push({ t: 'rect', x: cx - ht2, y: Yh(head), w: appW, h: Yh(sill) - Yh(head), fill: '#ffffff', stroke: 'none', sw: 0 });   // Öffnung ausstanzen
  const sa = { id: o.id, kind: o.kind, x: cx, y: cy, ang: -Math.PI / 2, thick: appW, w: hPx, depth: dep, frameW: o.frameW, frameD: o.frameD, sashW: o.sashW, sashD: o.sashD, sashShift: o.sashShift, sashRecess: o.sashRecess, glassT: o.glassT, winType: o.winType || 'f1', winMat: o.winMat, winHinge: o.winHinge, revealType: o.revealType, outerLap: o.outerLap, innerReveal: o.innerReveal, anschlagType: o.anschlagType, anschlagDepth: o.anschlagDepth, wallId: 'secw' };
  if (layered) { const sw = { id: 'secw', type: 'wall', layers: flip ? wall.layers.slice().reverse() : wall.layers, x1: cx, y1: cy + hw, x2: cx, y2: cy - hw, thick: appW, hatch: wall.hatch }; for (const st of openingRevealStrips(sa, [sw])) { out.push({ t: 'poly', pts: st.poly, fill: st.fill, stroke: st.stroke, sw: 0.7 }); if (st.hatch) for (const [u, v] of st.hatch) out.push({ t: 'line', x1: u[0], y1: u[1], x2: v[0], y2: v[1], stroke: st.stroke, w: 0.6 }); } }
  if (o.kind === 'window') {
    const P = openingParts(sa, layered);
    for (const f of (P.fills || [])) out.push({ t: 'poly', pts: f.poly, fill: f.fill, stroke: f.stroke, sw: 1 });
    for (const [u, v] of P.lines) out.push({ t: 'line', x1: u[0], y1: u[1], x2: v[0], y2: v[1], stroke: '#1c242c', w: 1.2 });
    for (const [u, v] of (P.bold || [])) out.push({ t: 'line', x1: u[0], y1: u[1], x2: v[0], y2: v[1], stroke: '#1c242c', w: 2.4 });
    if (o.niche) { const nH = o.nicheH || cmToPts(28), nD = o.nicheD || cmToPts(13), nx0 = flip ? cx + ht2 - nD : cx - ht2, ny0 = (cy - hw) - nH; out.push({ t: 'rect', x: nx0, y: ny0, w: nD, h: nH, fill: '#e9e6df', stroke: '#1c242c', sw: 0.8 }); out.push({ t: 'text', x: nx0 + 2, y: ny0 + nH / 2, text: 'Storen', col: '#1c242c', small: true }); }   // Storennische 13×28 hinten, über dem Sturz
  } else {
    const wm = WIN_MAT[o.winMat || 'holz'], md = Math.max(-1, Math.min(1, sa.depth * 2 - 1)), frameD = o.frameD || cmToPts(7), frameW = o.frameW || cmToPts(6);
    const fdh = Math.min(0.49, frameD / appW), leafW = Math.min(0.4, cmToPts(4) / appW), fwS = Math.min(0.4, frameW / hPx);
    out.push({ t: 'poly', pts: [corner(-1, md - leafW), corner(1 - fwS, md - leafW), corner(1 - fwS, md + leafW), corner(-1, md + leafW)], fill: wm.fill, stroke: wm.stroke, sw: 1 });   // Türblatt (vertikal, bei Einbautiefe)
    out.push({ t: 'poly', pts: [corner(1 - fwS, md - fdh), corner(1, md - fdh), corner(1, md + fdh), corner(1 - fwS, md + fdh)], fill: wm.fill, stroke: wm.stroke, sw: 1 });   // Sturz-Rahmen
  }
  if (winDimsOn) {   // Schnitt-Bemaßung Höhe: Rohbau + Licht (Licht = Rohbau − 2×(Rahmen − sichtbarer Rahmen))
    const insM = Math.max(0, ptsToCm(o.frameW || cmToPts(10)) - (o.boardVis != null ? o.boardVis : 1)) / 100;
    const roughM = head - sill, Ypx = m => m / perPt, xR = cx + ht2 + 14, yT2 = cy - hw, yB2 = cy + hw, inside = !!flip;
    pDimV(out, xR + (inside ? 0 : 22), yT2, yB2, 'Rohbau ' + fmtLen(roughM / perPt), 6);
    pDimV(out, xR + (inside ? 22 : 0), yT2 + Ypx(insM), yB2 - Ypx(insM), 'Licht ' + fmtLen(Math.max(0.05, roughM - 2 * insM) / perPt), 6);
  }
}
function sectionPrimitives(a, arr) {
  const out = [], col = '#1c242c';
  const p1 = [a.cx1, a.cy1], p2 = [a.cx2, a.cy2], cd = [p2[0] - p1[0], p2[1] - p1[1]], cl = Math.hypot(cd[0], cd[1]) || 1, cux = cd[0] / cl, cuy = cd[1] / cl, nx = -cuy, ny = cux, lbl = a.label || 'A';
  out.push({ t: 'line', x1: a.cx1, y1: a.cy1, x2: a.cx2, y2: a.cy2, stroke: col, w: 1.2, dash: '10 4 2 4' });   // Schnittlinie im Plan
  const vdir = a.flip ? -1 : 1;   // Blickrichtung
  for (const e of [[a.cx1, a.cy1], [a.cx2, a.cy2]]) { const tk = 8, ax = nx * vdir, ay = ny * vdir; out.push({ t: 'line', x1: e[0] - ax * tk, y1: e[1] - ay * tk, x2: e[0] + ax * tk, y2: e[1] + ay * tk, stroke: col, w: 1.4 }); out.push({ t: 'arrow', x: e[0] + ax * tk, y: e[1] + ay * tk, dx: ax, dy: ay, col }); out.push({ t: 'text', x: e[0] - ax * 16, y: e[1] - ay * 16, text: lbl, col }); }
  if (!docScale) { out.push({ t: 'text', x: a.ox, y: a.oy, text: '⟶ Massstab setzen, dann erscheint der Schnitt', col }); return out; }
  const perPt = docScale.perPt, ox = a.ox, oy = a.oy, X = d => ox + d, Yh = h => oy - h / perPt, fp = d => a.flip ? cl - d : d;   // fp() spiegelt nur die Position (X bleibt normal → Rechtecke verrutschen nicht)
  const hits = [];
  for (const w of arr) { if (w.type !== 'wall' || !layerVisible(w) || !phaseVisible(w)) continue; const ix = segInt(p1, p2, [w.x1, w.y1], [w.x2, w.y2]); if (!ix) continue; const dist = fp((ix.pt[0] - p1[0]) * cux + (ix.pt[1] - p1[1]) * cuy), wdx = w.x2 - w.x1, wdy = w.y2 - w.y1, wl = Math.hypot(wdx, wdy) || 1, sinA = Math.max(0.25, Math.abs((cux * wdy - cuy * wdx) / wl)), T = w.thick || wallThickPts(); hits.push({ w, dist, appW: T / sinA, tp: ix.t2, wl, T }); }
  out.push({ t: 'line', x1: X(-14), y1: Yh(0), x2: X(cl + 14), y2: Yh(0), stroke: col, w: 1.8 });   // Bodenlinie
  for (const h of hits) {
    const w = h.w, H = w.h3d || wallHeightM, x0 = h.dist - h.appW / 2;
    const layers0 = (w.layers && w.layers.length) ? w.layers : [{ mat: null, t: h.T }], layers = a.flip ? layers0.slice().reverse() : layers0, totalT = layers.reduce((s, l) => s + l.t, 0) || h.T;
    let cx = x0;
    for (const L of layers) { const lw = (L.t / totalT) * h.appW, m = L.mat ? (WALL_MATS[L.mat] || {}) : { fill: (w.fill && w.fill !== 'none') ? w.fill : '#ffffff', color: w.color || col }; const bx = X(cx), byT = Yh(H), bhh = Yh(0) - Yh(H); out.push({ t: 'rect', x: bx, y: byT, w: lw, h: bhh, fill: m.fill || '#ffffff', stroke: m.color || col, sw: 0.6 }); if (!simpleMode) sectionBandHatch(out, bx, byT, lw, bhh, L.mat, (w.hatch && w.hatch.type)); cx += lw; }
    const ops = arr.filter(o => o.type === 'opening' && o.wallId === w.id && Math.abs(o.t - h.tp) < ((o.w / 2) / h.wl));
    for (const o of ops) sectionCutOpening(out, X, Yh, h.dist, h.appW, o, H, perPt, w, a.flip);   // quer geschnittene Öffnung = gedrehtes Grundriss-Profil (a.flip = Blickrichtung)
    out.push({ t: 'line', x1: X(x0), y1: Yh(H), x2: X(x0 + h.appW), y2: Yh(H), stroke: col, w: 1.2 });
  }
  for (const w of arr) {   // Ansicht: Fenster/Türen in (nahezu) parallel zur Schnittlinie laufenden Wänden – damit man sie im Schnitt sieht
    if (w.type !== 'wall' || !layerVisible(w) || !phaseVisible(w)) continue;
    const wdx = w.x2 - w.x1, wdy = w.y2 - w.y1, wl = Math.hypot(wdx, wdy) || 1, along = Math.abs((wdx * cux + wdy * cuy) / wl);
    if (along < 0.7) continue;   // nur fast-parallele Wände → Ansicht (quer geschnittene sind schon oben)
    const Hw = w.h3d || wallHeightM;
    const d1 = fp((w.x1 - p1[0]) * cux + (w.y1 - p1[1]) * cuy), d2 = fp((w.x2 - p1[0]) * cux + (w.y2 - p1[1]) * cuy);
    const da = Math.max(0, Math.min(d1, d2)), db = Math.min(cl, Math.max(d1, d2));
    if (db - da > 1) {   // Wand in Ansicht: Aussenschicht-Farbe + Schraffur (wie 3D)
      const outL = w.layers && w.layers.length ? w.layers[w.layers.length - 1] : null, m = outL ? (WALL_MATS[outL.mat] || {}) : { fill: (w.fill && w.fill !== 'none') ? w.fill : '#f0efea', color: w.color || col };
      out.push({ t: 'rect', x: X(da), y: Yh(Hw), w: X(db) - X(da), h: Yh(0) - Yh(Hw), fill: m.fill || '#f0efea', stroke: m.color || col, sw: 0.6 });
      if (!simpleMode && outL) sectionBandHatch(out, X(da), Yh(Hw), X(db) - X(da), Yh(0) - Yh(Hw), outL.mat, null);
    }
    for (const o of arr) { if (o.type !== 'opening' || o.wallId !== w.id) continue; const ocx = w.x1 + wdx * o.t, ocy = w.y1 + wdy * o.t, od = fp((ocx - p1[0]) * cux + (ocy - p1[1]) * cuy); if (od < -10 || od > cl + 10) continue;
      const lapPts = (o.kind === 'window' ? (o.outerLap != null ? o.outerLap : cmToPts(3)) : 0) + (o.anschlagType === 'aussen' ? (o.anschlagDepth != null ? o.anschlagDepth : cmToPts(5)) : 0);   // Aussen-Lappung + Aussenanschlag → Aussenlichtmaß
      const redM = ptsToCm(lapPts) / 100, wEff = Math.max(4, (o.w - 2 * lapPts) * along);
      openingElev(out, X, Yh, od - wEff / 2, wEff, o, Hw, col, redM);
      if (winDimsOn) {   // Ansicht: Breite + Höhe, Rohbau + Licht (rahmenbasiert)
        const insPts = Math.max(0, (o.frameW || cmToPts(10)) - cmToPts(o.boardVis != null ? o.boardVis : 1)), insM = ptsToCm(insPts) / 100;
        const sill0 = o.kind === 'window' ? (o.sill || 0) : 0, head0 = Math.min(Hw, o.head || (o.kind === 'window' ? 2.1 : 2.0)), rW = o.w * along, lW = Math.max(4, (o.w - 2 * insPts) * along), yB = Yh(sill0) + 10, xL = X(od - rW / 2) - 12;
        pDimH(out, yB, X(od - rW / 2), X(od + rW / 2), 'Rohbau ' + fmtLen(o.w), true); pDimH(out, yB + 13, X(od - lW / 2), X(od + lW / 2), 'Licht ' + fmtLen(Math.max(1, o.w - 2 * insPts)), true);
        pDimV(out, xL, Yh(head0), Yh(sill0), 'Rohbau ' + fmtLen((head0 - sill0) / perPt), -46); pDimV(out, xL - 18, Yh(head0 - insM), Yh(sill0 + insM), 'Licht ' + fmtLen(Math.max(0.05, head0 - sill0 - 2 * insM) / perPt), -46);
      } }
  }
  const Htop = sectionMaxH(a, arr), slabF = '#dadde2', slabC = '#8a8f96';   // Decke auf gemeinsamem Höhen-Datum
  out.push({ t: 'rect', x: X(-16), y: Yh(0), w: cl + 32, h: Yh(-0.22) - Yh(0), fill: slabF, stroke: slabC, sw: 0.7 });           // Bodenplatte
  out.push({ t: 'rect', x: X(-16), y: Yh(Htop + 0.24), w: cl + 32, h: Yh(Htop) - Yh(Htop + 0.24), fill: slabF, stroke: slabC, sw: 0.7 });   // Decke
  const hSet = new Set([0, Htop]);   // Höhen-Stationen: Boden, Geschoss, je Öffnung Brüstung+Sturz
  for (const h of hits) for (const o of arr.filter(o => o.type === 'opening' && o.wallId === h.w.id && Math.abs(o.t - h.tp) < ((o.w / 2) / h.wl))) { hSet.add(o.kind === 'window' ? (o.sill || 0) : 0); hSet.add(Math.min(Htop, o.head || (o.kind === 'window' ? 2.1 : 2.0))); }
  const hs = [...hSet].sort((p, q) => p - q), xD = X(-34);
  out.push({ t: 'line', x1: xD, y1: Yh(0), x2: xD, y2: Yh(Htop), w: 0.9 });
  for (const s of hs) out.push({ t: 'line', x1: xD - 4, y1: Yh(s), x2: xD + 4, y2: Yh(s), w: 0.8 });
  for (let i = 0; i < hs.length - 1; i++) { const seg = hs[i + 1] - hs[i]; if (seg < 0.02) continue; out.push({ t: 'text', x: xD - 34, y: (Yh(hs[i]) + Yh(hs[i + 1])) / 2 + 4, text: fmtLen(seg / perPt), col, small: true }); }
  out.push({ t: 'text', x: X(cl / 2) - 18, y: Yh(-0.22) + 22, text: 'Schnitt ' + lbl + '–' + lbl, col });
  return out;
}
function sectionBBox(a, arr) { if (!docScale) return { x: a.ox - 6, y: a.oy - 16, w: 180, h: 30 }; const perPt = docScale.perPt, cl = Math.hypot(a.cx2 - a.cx1, a.cy2 - a.cy1) || 1, mh = sectionMaxH(a, arr) / perPt; return { x: a.ox - 16, y: a.oy - mh - 8, w: cl + 32, h: mh + 36 }; }
function drawSection(svg, a, arr) {
  const g = svgEl('g', { 'data-id': a.id });
  for (const p of sectionPrimitives(a, arr)) {
    if (p.t === 'rect') { const r = svgEl('rect', { x: Math.min(p.x, p.x + p.w), y: Math.min(p.y, p.y + p.h), width: Math.abs(p.w), height: Math.abs(p.h), fill: p.fill || 'none', 'vector-effect': 'non-scaling-stroke' }); if (p.stroke && p.stroke !== 'none') { r.setAttribute('stroke', p.stroke); r.setAttribute('stroke-width', p.sw || 0.6); } g.appendChild(r); }
    else if (p.t === 'poly') { const pl = svgEl('polygon', { points: p.pts.map(q => q[0].toFixed(2) + ',' + q[1].toFixed(2)).join(' '), fill: p.fill || 'none', 'vector-effect': 'non-scaling-stroke' }); if (p.stroke && p.stroke !== 'none') { pl.setAttribute('stroke', p.stroke); pl.setAttribute('stroke-width', p.sw || 0.6); } g.appendChild(pl); }
    else if (p.t === 'line') { const l = svgEl('line', { x1: p.x1, y1: p.y1, x2: p.x2, y2: p.y2, stroke: p.stroke || '#1c242c', 'stroke-width': p.w || 1, 'vector-effect': 'non-scaling-stroke' }); if (p.dash) l.setAttribute('stroke-dasharray', p.dash); g.appendChild(l); }
    else if (p.t === 'arrow') { const s = 6, ang = Math.atan2(p.dy, p.dx); for (const da of [2.5, -2.5]) g.appendChild(svgEl('line', { x1: p.x, y1: p.y, x2: p.x - Math.cos(ang + da) * s, y2: p.y - Math.sin(ang + da) * s, stroke: p.col || '#1c242c', 'stroke-width': 1.4, 'vector-effect': 'non-scaling-stroke' })); }
    else if (p.t === 'text') { const t = svgEl('text', { x: p.x, y: p.y, fill: p.col || '#1c242c', 'font-size': p.small ? 9 : 12, 'font-weight': p.small ? 400 : 700, 'paint-order': 'stroke', stroke: '#fff', 'stroke-width': 3 }); t.textContent = p.text; g.appendChild(t); }
  }
  svg.appendChild(g);
  const b = sectionBBox(a, arr); svg.appendChild(svgEl('rect', { x: b.x, y: b.y, width: b.w, height: b.h, fill: 'transparent', 'data-id': a.id }));
  return g;
}
function startSection(pv, e, p) {
  pushUndo();
  const a = { id: nextId++, type: 'section', cx1: p.x, cy1: p.y, cx2: p.x, cy2: p.y, label: 'A', ox: 0, oy: 0 };
  pushAnno(pv.num, a);
  const move = ev => { const q = evtToPage(pv, ev); if (ev.shiftKey) { const s = snap15(p.x, p.y, q.x, q.y); a.cx2 = s.x; a.cy2 = s.y; } else { a.cx2 = q.x; a.cy2 = q.y; } drawAnnos(pv); };
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
}
function openingClick(pv, p) {
  const nw = nearestWall(pv, p.x, p.y);
  if (!nw || nw.dist > nw.thick * 0.85 + 10) { toast('Tür/Fenster auf eine Wand setzen.'); return; }
  pushUndo();
  const dx = nw.wall.x2 - nw.wall.x1, dy = nw.wall.y2 - nw.wall.y1, L2 = dx * dx + dy * dy || 1, t = ((nw.cx - nw.wall.x1) * dx + (nw.cy - nw.wall.y1) * dy) / L2;
  const a = { id: nextId++, type: 'opening', wallId: nw.wall.id, t, x: nw.cx, y: nw.cy, ang: nw.ang, thick: nw.thick, w: lastOpenW || cmToPts(openKind === 'window' ? 100 : 90), kind: openKind, hinge: 1, swing: 1, sill: openKind === 'window' ? 0.9 : 0, head: openKind === 'window' ? 2.1 : 2.0, depth: lastOpenDepth, winType: openKind === 'door' ? lastDoorType : lastWinType, winHinge: lastWinHinge, winMat: lastWinMat, color: nw.wall.color || '#1c242c' };
  pushAnno(pv.num, a); sel = { num: pv.num, id: a.id }; drawAnnos(pv); saveState();
}
function startOpeningMove(pv, e, a) {   // Öffnung entlang ihrer Wand verschieben (sonst frei)
  const wall = a.wallId && getAnnos(pv.num).find(o => o.id === a.wallId && o.type === 'wall');
  if (!wall) return startMove(pv, e, a);
  pushUndo(); let moved = false;
  const move = ev => { moved = true; const q = evtToPage(pv, ev), dx = wall.x2 - wall.x1, dy = wall.y2 - wall.y1, L2 = dx * dx + dy * dy || 1; let t = ((q.x - wall.x1) * dx + (q.y - wall.y1) * dy) / L2; a.t = Math.max(0, Math.min(1, t)); openingResolve(a, pv); drawAnnos(pv); };
  const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); if (!moved) undoStack.pop(); else saveState(); };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
}
/* ---------- Möbel- / Sanitär-Symbole (Blöcke) ---------- */
let blockKind = 'table';
const BLOCK_DEFS = { bed: [200, 150], table: [120, 80], sofa: [200, 90], chair: [45, 45], wc: [40, 60], sink: [60, 45], shower: [90, 90], bath: [170, 75], stove: [60, 60], fridge: [60, 65] };
const BLOCK_H = { bed: 0.5, table: 0.75, sofa: 0.8, chair: 0.9, wc: 0.4, sink: 0.85, shower: 0.04, bath: 0.55, stove: 0.9, fridge: 1.8 };
function blockShapes(a) {   // Symbol-Geometrie in absoluten Seitenkoordinaten (für Schirm + PDF)
  const x = Math.min(a.x, a.x + a.w), y = Math.min(a.y, a.y + a.h), w = Math.abs(a.w), h = Math.abs(a.h), k = a.kind, mn = Math.min(w, h), s = [];
  const X = f => x + f * w, Y = f => y + f * h;
  const rr = (fx, fy, fw, fh, r) => s.push({ t: 'rect', x: X(fx), y: Y(fy), w: fw * w, h: fh * h, rx: (r || 0) * mn });
  const el = (fx, fy, rx, ry) => s.push({ t: 'ell', cx: X(fx), cy: Y(fy), rx: rx * w, ry: ry * h });
  const ci = (fx, fy, r) => s.push({ t: 'circ', cx: X(fx), cy: Y(fy), r: r * mn });
  const ln = (x1, y1, x2, y2) => s.push({ t: 'line', x1: X(x1), y1: Y(y1), x2: X(x2), y2: Y(y2) });
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
  return s;
}
function drawBlock(svg, a) {
  const col = a.color || '#1c242c', g = svgEl('g', { 'data-id': a.id });
  for (const sp of blockShapes(a)) {
    if (sp.t === 'rect') g.appendChild(svgEl('rect', { x: sp.x, y: sp.y, width: sp.w, height: sp.h, rx: sp.rx || 0, ry: sp.rx || 0, fill: 'none', stroke: col, 'stroke-width': 1.2, 'vector-effect': 'non-scaling-stroke' }));
    else if (sp.t === 'ell') g.appendChild(svgEl('ellipse', { cx: sp.cx, cy: sp.cy, rx: sp.rx, ry: sp.ry, fill: 'none', stroke: col, 'stroke-width': 1.2, 'vector-effect': 'non-scaling-stroke' }));
    else if (sp.t === 'circ') g.appendChild(svgEl('circle', { cx: sp.cx, cy: sp.cy, r: sp.r, fill: 'none', stroke: col, 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }));
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
// Textstücke der Seite mit Kästchen in Seitenkoordinaten (y-unten, Oberkante) – einmal berechnet
async function ensureTextItems(pv) {
  if (pv.textItems) return pv.textItems;
  const items = [];
  try {
    const tc = await pv.page.getTextContent();
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const tr = it.transform, fs = Math.hypot(tr[1], tr[3]) || it.height || 10;
      const top = (pv.pageH - tr[5]) - fs * 0.82;
      items.push({ x: tr[4], y: top, w: it.width || fs * it.str.length * 0.5, h: fs * 1.2, str: it.str, size: fs });
    }
  } catch (_) { }
  pv.textItems = items; return items;
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
  const items = await ensureTextItems(pv);
  const hit = items.find(it => p.x >= it.x - 2 && p.x <= it.x + it.w + 2 && p.y >= it.y - 1 && p.y <= it.y + it.h + 1);
  let a;
  if (hit) {
    const s = sampleBox(pv, hit); a = { id: nextId++, type: 'edit', x: hit.x, y: hit.y, w: Math.max(hit.w, hit.size), h: hit.h, text: hit.str, size: hit.size, color: s.ink || '#111111', bg: s.bg || '#ffffff' };
    pushUndo(); pushAnno(pv.num, a); sel = { num: pv.num, id: a.id }; setTool('select'); drawAnnos(pv);   // Treffer: auswählen → Optionen-Leiste (Überschreiben/Verschieben/Grösse)
  } else {
    a = { id: nextId++, type: 'edit', x: p.x, y: p.y - style.size * 0.82, w: 120, h: style.size * 1.2, text: '', size: style.size, color: style.color, bg: '#ffffff' };
    pushUndo(); pushAnno(pv.num, a); sel = { num: pv.num, id: a.id }; drawAnnos(pv); openEditEdit(pv, a, true);   // leere Stelle: direkt tippen
  }
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
function openEditEdit(pv, a, isNew) {
  const sc = pv.scale; const ta = document.createElement('textarea'); ta.className = 'textedit'; ta.value = a.text; ta.rows = 1;
  ta.style.left = (a.x * sc) + 'px'; ta.style.top = (a.y * sc) + 'px'; ta.style.fontSize = (a.size * sc) + 'px'; ta.style.color = a.color; ta.style.background = a.bg; ta.style.minWidth = Math.max(40, a.w * sc) + 'px';
  pv.inner.appendChild(ta); ta.focus(); ta.select();
  const commit = () => { a.text = ta.value.replace(/\s+$/, ''); ta.remove(); if (!a.text && isNew) { const arr = getAnnos(pv.num); const i = arr.indexOf(a); if (i >= 0) arr.splice(i, 1); } setTool('select'); drawAnnos(pv); saveState(); };
  ta.addEventListener('blur', commit);
  ta.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); ta.blur(); } else if (ev.key === 'Escape') { if (isNew) ta.value = ''; ta.blur(); } });
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; });
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
  if (!items.length) { list.innerHTML = '<div class="comm-empty">Noch keine Kommentare. Werkzeug „Kommentar" wählen und in den Plan klicken.</div>'; return; }
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
  const list = (getAnnos(n) || []).filter(a => a.type !== 'crop' && a.type !== 'imgph');
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
    const MM = 72 / 25.4, out0 = [], LK = { locked: true };
    const out = { push: (...xs) => xs.forEach(x => out0.push(Object.assign(x, x.field ? {} : LK))) };   // Struktur gesperrt, ausfüllbare Felder (field) frei
    const ml = 20 * MM, mt = 8 * MM, mr = 8 * MM, mb = 8 * MM;                 // Heftrand links breiter
    const bx = ml, by = mt, bw = w - ml - mr, bh = h - mt - mb;
    out.push({ type: 'rect', x: bx, y: by, w: bw, h: bh, color: dark, width: 1.6, fill: 'none' });   // Rahmen
    const kw = Math.min(185 * MM, bw * 0.5), kh = Math.min(58 * MM, bh * 0.45), kx = bx + bw - kw, ky = by + bh - kh;
    out.push({ type: 'rect', x: kx, y: ky, w: kw, h: kh, color: dark, width: 1.2, fill: '#ffffff' });   // Plankopf-Box
    const rows = 4, rh = kh / rows, cx = kx + kw * 0.6, pad = 2.5 * MM;
    for (let r = 1; r < rows; r++) out.push({ type: 'line', x1: kx, y1: ky + rh * r, x2: kx + kw, y2: ky + rh * r, color: dark, width: 0.6 });
    out.push({ type: 'line', x1: cx, y1: ky, x2: cx, y2: ky + rh * 3, color: dark, width: 0.6 });
    const cell = (x, y, wc, label, value, field) => {                       // Label oben + ausfüllbarer Wert darunter
      out.push(mk({ x: x + pad, y: y + pad * 0.5, w: wc, h: rh * 0.4, text: label, size: 7, color: gray }));
      out.push(mk(Object.assign({ x: x + pad, y: y + rh * 0.42, w: wc, h: rh * 0.55, text: value || '', size: 9, color: dark }, field ? { field } : {})));
    };
    const lw = kw * 0.6 - 2 * pad, rw = kw * 0.4 - 2 * pad;
    cell(kx, ky, lw, 'Projekt', '', 'projekt'); cell(kx, ky + rh, lw, 'Plan', '', 'plan'); cell(kx, ky + 2 * rh, lw, 'Gezeichnet', '', 'gezeichnet');
    cell(cx, ky, rw, 'Massstab', docScale ? docScale.label : '', 'scale'); cell(cx, ky + rh, rw, 'Datum', todayStr(), 'date'); cell(cx, ky + 2 * rh, rw, 'Plan-Nr.', '', 'plannr');
    const logoSz = rh * 0.82, lox = logoDataUrl ? logoSz + pad : 0;             // Logo links im Fuss
    if (logoDataUrl) out.push({ type: 'img', data: logoDataUrl, x: kx + pad, y: ky + 3 * rh + (rh - logoSz) / 2, w: logoSz, h: logoSz });
    out.push(mk({ x: kx + pad + lox, y: ky + 3 * rh + pad, w: kw - 2 * pad - lox, h: rh, text: 'Submit PDF', size: 11, color: dark, field: 'firma' }));
    const A4w = 210 * MM, A4h = 297 * MM, tk = 5 * MM;                          // Faltmarken (DIN-824-artig, in A4-Spalten)
    for (let x = w - A4w; x > ml * 0.5; x -= A4w) { out.push({ type: 'line', x1: x, y1: 0, x2: x, y2: tk, color: gray, width: 0.6 }); out.push({ type: 'line', x1: x, y1: h - tk, x2: x, y2: h, color: gray, width: 0.6 }); }
    for (let y = h - A4h; y > mt * 0.5; y -= A4h) { out.push({ type: 'line', x1: 0, y1: y, x2: tk, y2: y, color: gray, width: 0.6 }); out.push({ type: 'line', x1: w - tk, y1: y, x2: w, y2: y, color: gray, width: 0.6 }); }
    return out0;
  }
  return [];
}
function buildPlanParts(w, h, opts) {   // frei konfigurierbarer Plankopf / Rahmen / Kantenlinie (für vorhandene Seiten)
  const MM = 72 / 25.4, color = opts.color || '#1c242c', gray = '#8a8f86', bw = +opts.bw || 1.2, LK = { locked: true };
  const margin = (opts.margin != null ? +opts.margin : 8) * MM, out = [];
  const push = o => out.push(Object.assign(o, o.field ? {} : LK));
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
  const parts = buildPlanParts(pv.pageW || 595, pv.pageH || 842, opts).map(a => Object.assign(a, { id: nextId++, layer: activeLayerId }));
  const arr = getAnnos(n); for (const a of parts) arr.push(a);
  drawAnnos(pv); saveState(); toast(opts.kind === 'kopf' ? 'Plankopf eingefügt ✓ (gesperrt – per Rechtsklick entsperren)' : 'Element eingefügt ✓');
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
function setTool(t) {
  if (cropping && t !== 'select' && t !== 'crop') removeCropAnno();   // anderes Werkzeug → Zuschneiden verwerfen
  if (areaDraft && t !== 'area' && t !== 'slab') cancelArea();        // anderes Werkzeug → Flächen-/Decken-Polygon verwerfen
  if (penDraft && t !== 'curve') finishCurve();                      // anderes Werkzeug → Kurve abschliessen
  if (segDraft) cancelSegDraft();                                    // anderes Werkzeug → laufende Linie verwerfen
  if (wallDraft && t !== 'wallchain') finishWallChain();            // anderes Werkzeug → Wand-Kette beenden
  if (cdimDraft && t !== 'chaindim') finishChaindim();              // anderes Werkzeug → Kettenmass beenden
  tool = t; $$('.tool[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t)); applyToolCursor();
  const ab = $('.tool.on[data-tool]'); if (ab) { const grp = ab.closest('.rib-tools'); if (grp && grp.hidden) activateRibTab(grp.dataset.tabgroup); }   // Reiter des aktiven Werkzeugs zeigen
  const bs = $('#btnStamp'); if (bs) bs.classList.toggle('on', t === 'stamp');
  const bb = $('#btnBlock'); if (bb) bb.classList.toggle('on', t === 'block');
  $$('.fab-b').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  pageViews.forEach(p => { p._hoverId = null; const h = p.svg && p.svg.querySelector('.hover-layer'); if (h) h.remove(); });   // Hover bei Werkzeugwechsel löschen
  $('#pages').classList.toggle('mode-text', t === 'textsel');   // Text-Auswahl-Modus
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
}
function applyToolCursor() {
  pageViews.forEach(pv => { pv.wrap.classList.toggle('tool-draw', ['pen', 'line', 'arrow', 'rect', 'oval', 'measure', 'dim', 'calibrate', 'note', 'sig', 'highlight', 'stamp', 'eraser', 'crop', 'area', 'arc', 'curve', 'wall', 'wallchain', 'chaindim', 'opening', 'window', 'slab', 'stairs', 'roof', 'block', 'section'].includes(tool)); pv.wrap.classList.toggle('tool-text', tool === 'text' || tool === 'edittext'); });
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
async function buildPdfBytes(visibleOnly, embed) {
  const lib = await loadPdfLib();
  {
    const { PDFDocument, rgb: rgb0, StandardFonts, degrees, pushGraphicsState, popGraphicsState, concatTransformationMatrix, moveTo, lineTo, closePath, clip, endPath } = lib;
    const exportBW = document.body.classList.contains('bw');   // S/W-Modus → alle Anmerkungsfarben als Graustufe ins PDF
    const rgb = exportBW ? ((r, g, b) => { const l = 0.299 * r + 0.587 * g + 0.114 * b; return rgb0(l, l, l); }) : rgb0;
    const doc = await PDFDocument.load(curBytes.slice(), { ignoreEncryption: true });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pages = doc.getPages(); const sigCache = {};
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
          if (a.dim && wallHasOpenings(a, annos[n] || [])) { const dg = wallDimGeom(a); wallDimPrimsToPdf(pg, wallDimChainPrims(a, annos[n] || [], dg.off), Y, font, degrees, rgb(.11, .14, .17)); }
          else if (a.dim) {
            const dx = a.x2 - a.x1, dy = a.y2 - a.y1, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
            const base = (a.thick || wallThickPts()) / 2 + cmToPts(wallDimOffCm), off = (a.dimOff != null ? a.dimOff : base), side = off >= 0 ? 1 : -1, gap = wallDimGap, over = 4, tick = 5, dimc = rgb(.11, .14, .17);
            const dl = (x1, y1, x2, y2, th) => pg.drawLine({ start: { x: x1, y: Y(y1) }, end: { x: x2, y: Y(y2) }, thickness: th || 0.7, color: dimc });
            for (const P of [[a.x1, a.y1], [a.x2, a.y2]]) dl(P[0] + nx * side * gap, P[1] + ny * side * gap, P[0] + nx * (off + side * over), P[1] + ny * (off + side * over));
            const q1 = [a.x1 + nx * off, a.y1 + ny * off], q2 = [a.x2 + nx * off, a.y2 + ny * off]; dl(q1[0] - ux * over, q1[1] - uy * over, q2[0] + ux * over, q2[1] + uy * over, 0.9);
            const kx = ux + nx, ky = uy + ny, kl = Math.hypot(kx, ky) || 1, kxn = kx / kl, kyn = ky / kl;
            for (const P of [q1, q2]) dl(P[0] - kxn * tick, P[1] - kyn * tick, P[0] + kxn * tick, P[1] + kyn * tick, 1.1);
            const lbl = fmtLen(len), tw = font.widthOfTextAtSize(lbl, 11); let sang = Math.atan2(uy, ux) * 180 / Math.PI; while (sang >= 90) sang -= 180; while (sang < -90) sang += 180; const pang = -sang;
            const rad = pang * Math.PI / 180, bx = Math.cos(rad), by = Math.sin(rad), cxm = (q1[0] + q2[0]) / 2 + nx * side * 7, cym = (q1[1] + q2[1]) / 2 + ny * side * 7;
            pg.drawText(lbl, { x: cxm - bx * tw / 2 + by * 3.5, y: Y(cym) - by * tw / 2 - bx * 3.5, size: 11, font, color: dimc, rotate: degrees(pang) });
          }
        }
        else if (a.type === 'wall') {
          const arr = annos[n] || [], poly = wallPoly(a, arr), lw = a.width || 1.4;
          if (!wallUni && a.fill && a.fill !== 'none') { const fc = hexToRgb(a.fill); const d = 'M' + poly.map((p, i) => (i ? 'L' : '') + p[0] + ' ' + p[1]).join(' ') + 'Z'; try { pg.drawSvgPath(d, { x: 0, y: PH, color: rgb(fc.r, fc.g, fc.b) }); } catch (_) { } }
          if (!wallUni) for (const [p, q] of wallOutlineSegs(a, arr)) pg.drawLine({ start: { x: p[0], y: Y(p[1]) }, end: { x: q[0], y: Y(q[1]) }, thickness: lw, color: c });
          if (a.dim && wallHasOpenings(a, annos[n] || [])) { const dg = wallDimGeom(a); wallDimPrimsToPdf(pg, wallDimChainPrims(a, annos[n] || [], dg.off), Y, font, degrees, rgb(.11, .14, .17)); }
          else if (a.dim) {   // Architektur-Masslinie im PDF
            const dx = a.x2 - a.x1, dy = a.y2 - a.y1, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
            const base = (a.thick || wallThickPts()) / 2 + cmToPts(wallDimOffCm), off = (a.dimOff != null ? a.dimOff : base), side = off >= 0 ? 1 : -1, gap = wallDimGap, over = 4, tick = 5;
            const dimc = rgb(.11, .14, .17), dl = (x1, y1, x2, y2, th) => pg.drawLine({ start: { x: x1, y: Y(y1) }, end: { x: x2, y: Y(y2) }, thickness: th || 0.7, color: dimc });   // Masslinie immer schwarz
            for (const P of [[a.x1, a.y1], [a.x2, a.y2]]) dl(P[0] + nx * side * gap, P[1] + ny * side * gap, P[0] + nx * (off + side * over), P[1] + ny * (off + side * over));
            const q1 = [a.x1 + nx * off, a.y1 + ny * off], q2 = [a.x2 + nx * off, a.y2 + ny * off];
            dl(q1[0] - ux * over, q1[1] - uy * over, q2[0] + ux * over, q2[1] + uy * over, 0.9);
            const kx = ux + nx, ky = uy + ny, kl = Math.hypot(kx, ky) || 1, kxn = kx / kl, kyn = ky / kl;
            for (const P of [q1, q2]) dl(P[0] - kxn * tick, P[1] - kyn * tick, P[0] + kxn * tick, P[1] + kyn * tick, 1.1);
            const lbl = fmtLen(len), tw = font.widthOfTextAtSize(lbl, 11);
            let sang = Math.atan2(uy, ux) * 180 / Math.PI; while (sang >= 90) sang -= 180; while (sang < -90) sang += 180; const pang = -sang;
            const rad = pang * Math.PI / 180, bx = Math.cos(rad), by = Math.sin(rad);
            const cxm = (q1[0] + q2[0]) / 2 + nx * side * 7, cym = (q1[1] + q2[1]) / 2 + ny * side * 7;
            pg.drawText(lbl, { x: cxm - bx * tw / 2 + by * 3.5, y: Y(cym) - by * tw / 2 - bx * 3.5, size: 11, font, color: dimc, rotate: degrees(pang) });
          }
        }
        else if (a.type === 'rect') { const x = Math.min(a.x, a.x + a.w), y = Math.min(a.y, a.y + a.h), W = Math.abs(a.w), H = Math.abs(a.h), o = { x, y: Y(y + H), width: W, height: H, borderColor: c, borderWidth: w, borderDashArray: dp }; if (a.fill && a.fill !== 'none') { const fc = hexToRgb(a.fill); o.color = rgb(fc.r, fc.g, fc.b); } pg.drawRectangle(o); }
        else if (a.type === 'roof') { const x = Math.min(a.x, a.x + a.w), y = Math.min(a.y, a.y + a.h), W = Math.abs(a.w), H = Math.abs(a.h); pg.drawRectangle({ x, y: Y(y + H), width: W, height: H, borderColor: c, borderWidth: 1.2 }); const rl = (x1, y1, x2, y2) => pg.drawLine({ start: { x: x1, y: Y(y1) }, end: { x: x2, y: Y(y2) }, thickness: 1.8, color: c }); if (a.rtype === 'pult') { a.axis === 'x' ? rl(x, y, x + W, y) : rl(x, y, x, y + H); } else { a.axis === 'x' ? rl(x, y + H / 2, x + W, y + H / 2) : rl(x + W / 2, y, x + W / 2, y + H); } const lab = a.rtype === 'pult' ? 'Pultdach' : 'Satteldach', tw = font.widthOfTextAtSize(lab, 11); pg.drawText(lab, { x: x + W / 2 - tw / 2, y: Y(y + H / 2) - 3, size: 11, font, color: c }); }
        else if (a.type === 'block') { for (const sp of blockShapes(a)) { if (sp.t === 'rect') pg.drawRectangle({ x: sp.x, y: Y(sp.y + sp.h), width: sp.w, height: sp.h, borderColor: c, borderWidth: 1.2 }); else if (sp.t === 'ell') pg.drawEllipse({ x: sp.cx, y: Y(sp.cy), xScale: sp.rx, yScale: sp.ry, borderColor: c, borderWidth: 1.2 }); else if (sp.t === 'circ') pg.drawEllipse({ x: sp.cx, y: Y(sp.cy), xScale: sp.r, yScale: sp.r, borderColor: c, borderWidth: 1 }); else if (sp.t === 'line') pg.drawLine({ start: { x: sp.x1, y: Y(sp.y1) }, end: { x: sp.x2, y: Y(sp.y2) }, thickness: 1, color: c }); } }
        else if (a.type === 'oval') { const o = { x: a.x + a.w / 2, y: Y(a.y + a.h / 2), xScale: Math.abs(a.w / 2), yScale: Math.abs(a.h / 2), borderColor: c, borderWidth: w, borderDashArray: dp }; if (a.fill && a.fill !== 'none') { const fc = hexToRgb(a.fill); o.color = rgb(fc.r, fc.g, fc.b); } pg.drawEllipse(o); }
        else if (a.type === 'pen') { const op = a.hl ? 0.35 : 1; for (let i = 1; i < a.pts.length; i++) pg.drawLine({ start: { x: a.pts[i - 1][0], y: Y(a.pts[i - 1][1]) }, end: { x: a.pts[i][0], y: Y(a.pts[i][1]) }, thickness: w, color: c, opacity: op }); }
        else if (a.type === 'opening') {
          const oDetail = openingDetail(a, annos[n] || []), P = openingParts(a, oDetail), d = 'M' + P.cover.map((p, i) => (i ? 'L' : '') + p[0] + ' ' + p[1]).join(' ') + 'Z';
          try { pg.drawSvgPath(d, { x: 0, y: PH, color: rgb(1, 1, 1) }); } catch (_) { }   // Wand ausstanzen
          if (oDetail) for (const st of openingRevealStrips(a, annos[n] || [])) { const sf = hexToRgb(st.fill), ss = hexToRgb(st.stroke), sd = 'M' + st.poly.map((p, i) => (i ? 'L' : '') + p[0] + ' ' + p[1]).join(' ') + 'Z'; try { pg.drawSvgPath(sd, { x: 0, y: PH, color: rgb(sf.r, sf.g, sf.b), borderColor: rgb(ss.r, ss.g, ss.b), borderWidth: 0.7 }); } catch (_) { } if (st.hatch) for (const [u, v] of st.hatch) pg.drawLine({ start: { x: u[0], y: Y(u[1]) }, end: { x: v[0], y: Y(v[1]) }, thickness: 0.8, color: rgb(ss.r, ss.g, ss.b) }); }   // Schichteinzug + Schraffur
          for (const f of (P.fills || [])) { const ff = hexToRgb(f.fill), fs = hexToRgb(f.stroke), fd = 'M' + f.poly.map((p, i) => (i ? 'L' : '') + p[0] + ' ' + p[1]).join(' ') + 'Z'; try { pg.drawSvgPath(fd, { x: 0, y: PH, color: rgb(ff.r, ff.g, ff.b), borderColor: rgb(fs.r, fs.g, fs.b), borderWidth: 1 }); } catch (_) { } }   // Rahmen/Flügel/Glas
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
            else if (p.t === 'text') { const tc = hexToRgb(p.col || '#1c242c'); pg.drawText(p.text, { x: p.x, y: Y(p.y) - 4, size: p.small ? 9 : 11, font, color: rgb(tc.r, tc.g, tc.b) }); }
          }
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
        else if (a.type === 'area') { if (!a.room) for (let i = 0; i < a.pts.length; i++) { const p1 = a.pts[i], p2 = a.pts[(i + 1) % a.pts.length]; pg.drawLine({ start: { x: p1[0], y: Y(p1[1]) }, end: { x: p2[0], y: Y(p2[1]) }, thickness: w, color: c }); } if (a.pts.length >= 3) { const ct = centroid(a.pts), lab = areaLabel(a.pts), tw = font.widthOfTextAtSize(lab, 11); pg.drawText(lab, { x: ct[0] - tw / 2, y: Y(ct[1]) - 4, size: 11, font, color: c }); } }
        else if (a.type === 'slab') { for (let i = 0; i < a.pts.length; i++) { const p1 = a.pts[i], p2 = a.pts[(i + 1) % a.pts.length]; pg.drawLine({ start: { x: p1[0], y: Y(p1[1]) }, end: { x: p2[0], y: Y(p2[1]) }, thickness: 1.4, color: c, dashArray: [7, 4] }); } if (a.pts.length >= 3) { const ct = centroid(a.pts), lab = ((a.base >= wallHeightM ? 'Decke' : 'Platte') + ' ' + ((a.base || 0) + (a.thick || 0.2)).toFixed(2) + ' m'), tw = font.widthOfTextAtSize(lab, 11); pg.drawText(lab, { x: ct[0] - tw / 2, y: Y(ct[1]) - 4, size: 11, font, color: c }); } }
        else if (a.type === 'stairs') {
          const dx = a.x2 - a.x1, dy = a.y2 - a.y1, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux, hw = (a.width || stairWidthPts()) / 2, n = stairSteps(a);
          const c1 = [a.x1 + nx * hw, a.y1 + ny * hw], c2 = [a.x2 + nx * hw, a.y2 + ny * hw], c3 = [a.x2 - nx * hw, a.y2 - ny * hw], c4 = [a.x1 - nx * hw, a.y1 - ny * hw];
          for (const [p, q] of [[c1, c2], [c2, c3], [c3, c4], [c4, c1]]) pg.drawLine({ start: { x: p[0], y: Y(p[1]) }, end: { x: q[0], y: Y(q[1]) }, thickness: 1.2, color: c });
          for (let i = 1; i < n; i++) { const t = i / n, mx = a.x1 + dx * t, my = a.y1 + dy * t; pg.drawLine({ start: { x: mx + nx * hw, y: Y(my + ny * hw) }, end: { x: mx - nx * hw, y: Y(my - ny * hw) }, thickness: 0.8, color: c }); }
          pg.drawLine({ start: { x: a.x1, y: Y(a.y1) }, end: { x: a.x2, y: Y(a.y2) }, thickness: 1, color: c });
          const al = 7; pg.drawLine({ start: { x: a.x2, y: Y(a.y2) }, end: { x: a.x2 - ux * al + nx * al * .6, y: Y(a.y2 - uy * al + ny * al * .6) }, thickness: 1, color: c }); pg.drawLine({ start: { x: a.x2, y: Y(a.y2) }, end: { x: a.x2 - ux * al - nx * al * .6, y: Y(a.y2 - uy * al - ny * al * .6) }, thickness: 1, color: c });
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
        else if (a.type === 'edit') { const bg = parseColor(a.bg), tc2 = parseColor(a.color); pg.drawRectangle({ x: a.x, y: Y(a.y + a.h), width: a.w, height: a.h, color: rgb(bg.r, bg.g, bg.b) }); (a.text || '').split('\n').forEach((ln, i) => pg.drawText(ln, { x: a.x + 1, y: Y(a.y + a.size + i * a.size * 1.25), size: a.size, font, color: rgb(tc2.r, tc2.g, tc2.b) })); }
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
    status(''); updateFormatLabel(); toast('Blattformat geändert ✓');
  } catch (e) { status(''); console.error(e); if (undoStack.length) undoStack.pop(); toast('Format-Änderung fehlgeschlagen.'); }
}
/* ---------- 3D-Ansicht: Wände mit Höhe extrudieren (Three.js) ---------- */
function loadThree() {
  if (window.THREE && THREE.OrbitControls) return Promise.resolve();
  return loadScript('https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js').then(() => loadScript('https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js'));
}
async function open3D() {
  if (!docScale) { toast('Für die 3D-Ansicht zuerst den Massstab setzen (1:n).'); return; }
  const arr = getAnnos(curPage()) || [], walls = arr.filter(a => a.type === 'wall' && layerVisible(a) && phaseVisible(a));
  if (!walls.length) { toast('Auf dieser (sichtbaren) Ebene sind keine Wände für die 3D-Ansicht.'); return; }
  status('3D wird geladen …');
  try { await loadThree(); } catch (_) { status(''); toast('3D-Engine nicht ladbar (einmal Internet nötig).'); return; }
  status('');
  const ov = document.createElement('div'); ov.className = 'd3-overlay';
  ov.innerHTML = '<div class="d3-bar"><b>3D-Ansicht</b><label class="d3-h">Höhe <input type="number" id="d3h" min="1" max="20" step="0.1" value="' + wallHeightM + '"> m</label><span class="d3-views"><button class="btn" data-v="iso">Iso</button><button class="btn" data-v="top">Oben</button><button class="btn" data-v="front">Vorne</button><button class="btn" data-v="side">Seite</button></span><span class="d3-hint">Ziehen = drehen · Mausrad = zoomen</span><span class="grow"></span><button class="btn" id="d3Shot">📷 Auf Plan</button><button class="btn" id="d3Close">✕ Schliessen</button></div><div class="d3-canvas" id="d3Canvas"></div>';
  document.body.appendChild(ov);
  const host = ov.querySelector('#d3Canvas');
  let api = build3DScene(host, walls, arr);
  ov.querySelector('#d3h').onchange = e => { wallHeightM = Math.max(1, Math.min(20, parseFloat(e.target.value) || 2.6)); if (api) api.dispose(); api = build3DScene(host, walls, arr); };
  ov.querySelectorAll('.d3-views button').forEach(b => b.onclick = () => { if (api && api.setView) api.setView(b.dataset.v); });
  ov.querySelector('#d3Shot').onclick = () => { if (!api || !api.snapshot) return; const s = api.snapshot(); close(); place3DImage(s.data, s.w, s.h); };
  const close = () => { if (api) api.dispose(); ov.remove(); document.removeEventListener('keydown', esc, true); };
  const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } };
  document.addEventListener('keydown', esc, true);
  ov.querySelector('#d3Close').onclick = close;
}
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
function openWallList() {
  if (!docScale) { toast('Erst Massstab setzen – die Liste braucht reale Masse.'); return; }
  const n = curPage(), arr = getAnnos(n), groups = computeWallBuildups(arr);
  const desc = layers => layers.map(l => ((WALL_MATS[l.mat] && WALL_MATS[l.mat].label) || l.mat).replace(/ .*/, '') + ' ' + (Math.round(ptsToCm(l.t) * 10) / 10) + 'cm').join(' · ');
  let rows = '', csv = 'Aufbau (innen→aussen)\tDicke (cm)\tU-Wert (W/m²K)\tAnzahl\n';
  groups.forEach((g, i) => { const u = wallUValue(g.layers, g.uVal), us = (Math.round(u * 1000) / 1000).toFixed(3), comp = g.uVal != null; rows += '<tr><td><b>W' + (i + 1) + '</b></td><td>' + buildupThumb(g.layers, g.totalCm) + '</td><td>' + desc(g.layers) + '</td><td style="text-align:right">' + (Math.round(g.totalCm * 10) / 10) + '</td><td><input class="bu-u" data-sig="' + g.sig.replace(/"/g, '') + '" type="number" step="0.01" min="0.05" value="' + us + '"> ' + (comp ? '✎' : '') + '</td><td style="text-align:center">' + g.walls.length + '</td></tr>'; csv += desc(g.layers) + '\t' + (Math.round(g.totalCm * 10) / 10) + '\t' + us + '\t' + g.walls.length + '\n'; });
  const ov = document.createElement('div'); ov.className = 'lab-overlay';
  ov.innerHTML = '<div class="lab-wrap" style="width:min(820px,95vw);height:min(600px,90vh)"><div class="lab-head"><b>Wandaufbau-Liste · U-Werte</b><span class="lab-hint">Seite ' + n + ' · U-Wert editierbar (✎ = überschrieben), gilt für alle Wände dieses Aufbaus</span><span class="grow"></span><button class="btn" id="qCopy">Kopieren</button><button class="btn" id="qClose">✕</button></div><div class="qty-body"><table class="qty-tab"><thead><tr><th>Pos</th><th>Schichten</th><th>Aufbau (innen→aussen)</th><th>Dicke</th><th>U-Wert</th><th>Wände</th></tr></thead><tbody>' + (rows || '<tr><td colspan=6>Keine mehrschichtigen Wände auf dieser Seite.</td></tr>') + '</tbody></table></div></div>';
  document.body.appendChild(ov);
  const close = () => { ov.remove(); document.removeEventListener('keydown', esc, true); };
  const esc = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  document.addEventListener('keydown', esc, true);
  ov.querySelector('#qClose').onclick = close;
  ov.querySelector('#qCopy').onclick = () => { navigator.clipboard.writeText('WANDAUFBAUTEN\n' + csv).then(() => toast('Liste kopiert (Excel-tauglich)')).catch(() => toast('Kopieren nicht möglich')); };
  ov.querySelectorAll('.bu-u').forEach(inp => inp.onchange = () => { const v = parseFloat(inp.value); if (!(v > 0)) return; const g = groups.find(x => x.sig.replace(/"/g, '') === inp.dataset.sig); if (!g) return; pushUndo(); g.uVal = v; g.walls.forEach(w => w.uVal = v); saveState(); toast('U-Wert ' + v + ' gespeichert (für ' + g.walls.length + ' Wand/Wände)'); });
  ov.addEventListener('pointerdown', e => { if (e.target === ov) close(); });
}
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
    if (wt !== 'fest' && !(o.kind === 'door' && isGlass)) { const apexL = two ? i === 0 : !hingeR, ax = apexL ? gx : gx + gw, bx = apexL ? gx + gw : gx, cy = gy + gh / 2; s += '<path d="M' + F(bx) + ' ' + F(gy) + ' L' + F(ax) + ' ' + F(cy) + ' L' + F(bx) + ' ' + F(gy + gh) + '" fill="none" stroke="' + st + '" stroke-width="0.7" stroke-dasharray="3 2"/>'; }
  }
  return s + '</svg>';
}
function openSchedule() {   // saubere Fenster-/Türliste mit Position, Ansicht-Skizze, Material, Licht/Rohbau, Brüstung, Anschlag
  if (!docScale) { toast('Erst Massstab setzen – die Liste braucht reale Masse.'); return; }
  const n = curPage(), arr = getAnnos(n), groups = {};
  for (const o of arr) { if (o.type !== 'opening' || !layerVisible(o) || !phaseVisible(o)) continue; const oh = o.kind === 'window' ? ((o.head || 2.1) - (o.sill || 0)) : (o.head || 2.0); const key = [o.kind, o.winType || 'f1', o.winMat || 'holz', Math.round(ptsToCm(o.w)), Math.round(oh * 100), Math.round((o.sill || 0) * 100), o.winHinge || 'left'].join('|'); if (!groups[key]) groups[key] = { o, n: 0, oh }; groups[key].n++; }
  const wins = [], doors = []; for (const k in groups) (groups[k].o.kind === 'window' ? wins : doors).push(groups[k]);
  wins.sort((a, b) => a.o.w - b.o.w || a.oh - b.oh); doors.sort((a, b) => a.o.w - b.o.w);
  const matL = { holz: 'Holz', metall: 'Metall', kunst: 'Kunststoff' }, typeL = { fest: 'Fest', f1: '1-flügelig', f2: '2-flügelig', f2s: '2-fl. Setzholz', f1f: '1-fl.+Fixteil' }, hingeL = { left: 'links', right: 'rechts', kipp: 'Kipp' };
  const dim = (o, oh) => { const ins = ptsToCm(openInsPts(o)) / 100; return { rw: Math.round(ptsToCm(o.w)), rh: Math.round(oh * 100), lw: Math.round((ptsToCm(o.w) / 100 - 2 * ins) * 100), lh: Math.round((oh - 2 * ins) * 100) }; };
  let wr = '', wc = 'Pos\tTyp\tMaterial\tLicht BxH\tRohbau BxH\tBrüstung\tAnschlag\tStk\n';
  wins.forEach((g, i) => { const o = g.o, d = dim(o, g.oh), p = 'F' + (i + 1); wr += '<tr><td><b>' + p + '</b></td><td>' + winThumb(o) + '</td><td>' + (typeL[o.winType || 'f1'] || '') + '</td><td>' + (matL[o.winMat || 'holz'] || '') + '</td><td>' + d.lw + '×' + d.lh + '</td><td>' + d.rw + '×' + d.rh + '</td><td>' + Math.round((o.sill || 0) * 100) + ' cm</td><td>' + (hingeL[o.winHinge || 'left'] || '') + '</td><td style="text-align:center">' + g.n + '</td></tr>'; wc += p + '\t' + (typeL[o.winType || 'f1'] || '') + '\t' + (matL[o.winMat || 'holz'] || '') + '\t' + d.lw + 'x' + d.lh + '\t' + d.rw + 'x' + d.rh + '\t' + Math.round((o.sill || 0) * 100) + '\t' + (hingeL[o.winHinge || 'left'] || '') + '\t' + g.n + '\n'; });
  let dr = '', dc = 'Pos\tTyp\tMaterial\tLicht BxH\tRohbau BxH\tAnschlag\tStk\n';
  doors.forEach((g, i) => { const o = g.o, d = dim(o, g.oh), p = 'T' + (i + 1); dr += '<tr><td><b>' + p + '</b></td><td>' + winThumb(o) + '</td><td>' + (typeL[o.winType || 'f1'] || '') + '</td><td>' + (matL[o.winMat || 'holz'] || '') + '</td><td>' + d.lw + '×' + d.lh + '</td><td>' + d.rw + '×' + d.rh + '</td><td>' + (hingeL[o.winHinge || 'left'] || '') + '</td><td style="text-align:center">' + g.n + '</td></tr>'; dc += p + '\t' + (typeL[o.winType || 'f1'] || '') + '\t' + (matL[o.winMat || 'holz'] || '') + '\t' + d.lw + 'x' + d.lh + '\t' + d.rw + 'x' + d.rh + '\t' + (hingeL[o.winHinge || 'left'] || '') + '\t' + g.n + '\n'; });
  const ov = document.createElement('div'); ov.className = 'lab-overlay';
  ov.innerHTML = '<div class="lab-wrap" style="width:min(820px,95vw);height:min(640px,92vh)"><div class="lab-head"><b>Fenster- & Türliste</b><span class="lab-hint">Seite ' + n + ' · Masse in cm (B×H)</span><span class="grow"></span><button class="btn" id="qCopy">Kopieren</button><button class="btn" id="qClose">✕</button></div><div class="qty-body"><h4>Fenster (' + wins.reduce((s, g) => s + g.n, 0) + ' Stk)</h4><table class="qty-tab ws-tab"><thead><tr><th>Pos</th><th>Ansicht</th><th>Typ</th><th>Material</th><th>Licht B×H</th><th>Rohbau B×H</th><th>Brüstung</th><th>Anschlag</th><th>Stk</th></tr></thead><tbody>' + (wr || '<tr><td colspan=9>Keine Fenster.</td></tr>') + '</tbody></table><h4>Türen (' + doors.reduce((s, g) => s + g.n, 0) + ' Stk)</h4><table class="qty-tab ws-tab"><thead><tr><th>Pos</th><th>Ansicht</th><th>Typ</th><th>Material</th><th>Licht B×H</th><th>Rohbau B×H</th><th>Anschlag</th><th>Stk</th></tr></thead><tbody>' + (dr || '<tr><td colspan=8>Keine Türen.</td></tr>') + '</tbody></table></div></div>';
  document.body.appendChild(ov);
  const close = () => { ov.remove(); document.removeEventListener('keydown', esc, true); };
  const esc = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  document.addEventListener('keydown', esc, true);
  ov.querySelector('#qClose').onclick = close;
  ov.querySelector('#qCopy').onclick = () => { navigator.clipboard.writeText('FENSTERLISTE\n' + wc + '\nTÜRLISTE\n' + dc).then(() => toast('Liste kopiert (Excel-tauglich)')).catch(() => toast('Kopieren nicht möglich')); };
  ov.addEventListener('pointerdown', e => { if (e.target === ov) close(); });
}
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
  return { mats: Object.values(mats).sort((a, b) => a.mat.localeCompare(b.mat)), ops: Object.values(opsAgg).sort((a, b) => (a.kind + a.rohW).localeCompare(b.kind + b.rohW)) };
}
function openQuantities() {
  if (!docScale) { toast('Erst Massstab setzen – Mengen brauchen reale Masse.'); return; }
  const n = curPage(), arr = getAnnos(n), { mats, ops } = computeQuantities(arr);
  const ML = { _wall: 'Wand (einschichtig)' }, lbl = m => (WALL_MATS[m] && WALL_MATS[m].label) || ML[m] || m;
  let rows = '', csv = 'Material\tStärke (cm)\tMenge\tEinheit\n';
  for (const r of mats) { const q = r.unit === 'm³' ? r.vol : r.area, qs = (Math.round(q * 100) / 100).toLocaleString('de-CH'); rows += '<tr><td>' + lbl(r.mat) + '</td><td>' + (r.unit === 'm³' ? '' : r.tcm) + '</td><td style="text-align:right">' + qs + '</td><td>' + r.unit + '</td></tr>'; csv += lbl(r.mat) + '\t' + (r.unit === 'm³' ? '' : r.tcm) + '\t' + qs + '\t' + r.unit + '\n'; }
  let orows = '', ocsv = 'Typ\tAnzahl\tLicht B×H (cm)\tRohbau B×H (cm)\n';
  const tn = { fest: 'Fest', f1: '1-flügelig', f2: '2-flügelig', f2s: '2-fl.+Setzholz', f1f: '1-fl.+Fixteil' };
  for (const o of ops) { const t = (o.kind === 'window' ? 'Fenster' : 'Tür') + ' ' + (tn[o.winType] || ''); orows += '<tr><td>' + t + '</td><td style="text-align:center">' + o.n + '</td><td>' + o.lichtW + '×' + o.lichtH + '</td><td>' + o.rohW + '×' + o.rohH + '</td></tr>'; ocsv += t + '\t' + o.n + '\t' + o.lichtW + '×' + o.lichtH + '\t' + o.rohW + '×' + o.rohH + '\n'; }
  const ov = document.createElement('div'); ov.className = 'lab-overlay';
  ov.innerHTML = '<div class="lab-wrap" style="width:min(720px,94vw);height:min(620px,90vh)"><div class="lab-head"><b>Datenliste / Mengen</b><span class="lab-hint">Seite ' + n + ' · Öffnungen abgezogen</span><span class="grow"></span><button class="btn" id="qCopy">Kopieren</button><button class="btn" id="qClose">✕</button></div><div class="qty-body"><h4>Materialliste</h4><table class="qty-tab"><thead><tr><th>Material</th><th>Stärke</th><th>Menge</th><th>Einheit</th></tr></thead><tbody>' + (rows || '<tr><td colspan=4>Keine mehrschichtigen Wände auf dieser Seite.</td></tr>') + '</tbody></table><h4>Fenster-/Türliste</h4><table class="qty-tab"><thead><tr><th>Typ</th><th>Anzahl</th><th>Licht B×H</th><th>Rohbau B×H</th></tr></thead><tbody>' + (orows || '<tr><td colspan=4>Keine Öffnungen.</td></tr>') + '</tbody></table></div></div>';
  document.body.appendChild(ov);
  const close = () => { ov.remove(); document.removeEventListener('keydown', esc, true); };
  const esc = e => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  document.addEventListener('keydown', esc, true);
  ov.querySelector('#qClose').onclick = close;
  ov.querySelector('#qCopy').onclick = () => { navigator.clipboard.writeText('MATERIALLISTE\n' + csv + '\nFENSTER/TÜREN\n' + ocsv).then(() => toast('In die Zwischenablage kopiert (Excel-tauglich)')).catch(() => toast('Kopieren nicht möglich')); };
  ov.addEventListener('pointerdown', e => { if (e.target === ov) close(); });
}
function openLaibungEditor(a, pv) {   // interaktives Laibungs-Detail: reinzoomen, Ziehgriffe + Regler, live in den Plan
  const arr = getAnnos(pv.num), wall = a.wallId && arr.find(o => o.id === a.wallId && o.type === 'wall');
  const ov = document.createElement('div'); ov.className = 'lab-overlay';
  ov.innerHTML = '<div class="lab-wrap"><div class="lab-head"><b>Laibungs-Detail</b><span class="lab-hint">Punkte ziehen oder Regler – aktualisiert live im Plan</span><span class="grow"></span><button class="btn" id="labClose">✕ Schliessen</button></div><div class="lab-body"><div class="lab-stage"><svg class="lab-svg" id="labSvg" xmlns="http://www.w3.org/2000/svg"></svg></div><div class="lab-side" id="labCtrls"></div></div></div>';
  document.body.appendChild(ov);
  const svg = ov.querySelector('#labSvg'), side = ov.querySelector('#labCtrls');
  const W = 640, Hh = 520, cx = W * 0.42, cy = Hh / 2;
  const cm = pts => Math.round(ptsToCm(pts) * 10) / 10;
  const fields = [
    { k: 'depth', label: 'Einbautiefe', unit: '%', get: () => Math.round((a.depth == null ? 0.5 : a.depth) * 100), set: v => a.depth = Math.max(0, Math.min(1, v / 100)), min: 0, max: 100, step: 1 },
    { k: 'frameD', label: 'Rahmentiefe', unit: 'cm', get: () => cm(a.frameD || cmToPts(7)), set: v => a.frameD = cmToPts(v), min: 4, max: 16, step: 0.5 },
    { k: 'boardW', label: 'Laibungsbrett Breite', unit: 'cm', get: () => a.boardW != null ? a.boardW : 2.5, set: v => a.boardW = v, min: 0.5, max: 10, step: 0.5 },
    { k: 'boardVis', label: 'Rahmen sichtbar', unit: 'cm', get: () => a.boardVis != null ? a.boardVis : 1, set: v => a.boardVis = v, min: 0, max: 6, step: 0.5 },
    { k: 'outerLap', label: 'Aussen (Dämmung über Rahmen)', unit: 'cm', get: () => cm(a.outerLap != null ? a.outerLap : cmToPts(3)), set: v => a.outerLap = cmToPts(v), min: 0, max: 20, step: 0.5 },
    { k: 'innerReveal', label: 'Innen (Putz reingezogen)', unit: 'cm', get: () => cm(a.innerReveal != null ? a.innerReveal : cmToPts(2)), set: v => a.innerReveal = cmToPts(v), min: 0, max: 20, step: 0.5 },
    { k: 'anschlagDepth', label: 'Anschlagtiefe', unit: 'cm', get: () => cm(a.anschlagDepth != null ? a.anschlagDepth : cmToPts(5)), set: v => a.anschlagDepth = cmToPts(v), min: 0, max: 20, step: 0.5, when: () => a.anschlagType && a.anschlagType !== 'none' }
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
    const { sa, reveal, parts } = geom();
    const xs = [], ys = [], acc = p => { if (p[0] >= cx - 4) { xs.push(p[0]); ys.push(p[1]); } };
    for (const st of reveal) for (const p of st.poly) acc(p);
    for (const f of (parts.fills || [])) for (const p of f.poly) acc(p);
    for (const u of parts.lines) { acc(u[0]); acc(u[1]); }
    const jamb = cx + a.w / 2;
    let x0 = xs.length ? Math.min(...xs) : jamb - 120, x1 = Math.max(jamb + 8, xs.length ? Math.max(...xs) : jamb + 8);
    let y0 = ys.length ? Math.min(...ys) : cy - 90, y1 = ys.length ? Math.max(...ys) : cy + 90;
    const mx = (x1 - x0) * 0.12 + 8, my = (y1 - y0) * 0.12 + 8; x0 -= mx; x1 += mx; y0 -= my; y1 += my;
    const vbw = x1 - x0, vbh = y1 - y0; svg.setAttribute('viewBox', x0 + ' ' + y0 + ' ' + vbw + ' ' + vbh);
    scale = vbw / (svg.clientWidth || (W * 0.6));
    let s = '';
    for (const st of reveal) { s += '<polygon points="' + st.poly.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') + '" fill="' + st.fill + '" stroke="' + st.stroke + '" stroke-width="' + (0.7 * scale) + '" vector-effect="non-scaling-stroke"/>'; if (st.hatch) for (const [u, v] of st.hatch) s += '<line x1="' + u[0].toFixed(1) + '" y1="' + u[1].toFixed(1) + '" x2="' + v[0].toFixed(1) + '" y2="' + v[1].toFixed(1) + '" stroke="' + st.stroke + '" stroke-width="0.6" vector-effect="non-scaling-stroke"/>'; }
    for (const f of (parts.fills || [])) s += '<polygon points="' + f.poly.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') + '" fill="' + f.fill + '" stroke="' + f.stroke + '" stroke-width="1" vector-effect="non-scaling-stroke"/>';
    for (const [u, v] of parts.lines) s += '<line x1="' + u[0].toFixed(1) + '" y1="' + u[1].toFixed(1) + '" x2="' + v[0].toFixed(1) + '" y2="' + v[1].toFixed(1) + '" stroke="#1c242c" stroke-width="1.2" vector-effect="non-scaling-stroke"/>';
    // Ziehgriffe (in Geometrie-Koordinaten): corner(s,m) = [cx + (a.w/2)*s, cy + (thick/2)*m]
    const hw = a.w / 2, ht = (a.thick || wallThickPts()) / 2, depth = a.depth == null ? 0.5 : a.depth, md = depth * 2 - 1;
    const fdh = Math.min(0.49, (a.frameD || cmToPts(7)) / (2 * ht)), fmB = Math.min(1, md + fdh);
    const fwSr = Math.min(0.45, (a.frameW || cmToPts(10)) / hw), boardVis = (a.boardVis != null ? a.boardVis : 1), boardW = (a.boardW != null ? a.boardW : 2.5);
    const HG = (hx, hy, id, lbl) => '<g class="lab-h" data-h="' + id + '"><circle cx="' + hx.toFixed(1) + '" cy="' + hy.toFixed(1) + '" r="' + (6 * scale) + '" /><title>' + lbl + '</title></g>';
    const hwx = s2 => cx + hw * s2, hwy = m2 => cy + ht * m2;
    let H = '';
    H += HG(hwx(1 - fwSr + cmToPts(boardVis) / hw + cmToPts(boardW) / hw), hwy(0.6), 'boardW', 'Laibungsbrett-Breite (ziehen ↔)');
    H += HG(hwx(1) - 2, hwy(md), 'depth', 'Einbautiefe (ziehen ↕)');
    if (a.anschlagType && a.anschlagType !== 'none') H += HG(hwx(Math.max(0, 1 - fwSr - cmToPts(a.anschlagDepth != null ? a.anschlagDepth : cmToPts(5)) / hw)), hwy(a.anschlagType === 'innen' ? -0.6 : 0.85), 'anschlag', 'Anschlagtiefe (ziehen ↔)');
    svg.innerHTML = s + H;
    bindHandles();
  }
  function bindHandles() {
    svg.querySelectorAll('.lab-h').forEach(g => { g.onpointerdown = e => {
      e.preventDefault(); const id = g.dataset.h, hw = a.w / 2, ht = (a.thick || wallThickPts()) / 2;
      const sx = e.clientX, sy = e.clientY, d0 = a.depth == null ? 0.5 : a.depth, bw0 = a.boardW != null ? a.boardW : 2.5, an0 = a.anschlagDepth != null ? a.anschlagDepth : cmToPts(5);
      const move = ev => {
        const dxp = (ev.clientX - sx) * scale, dyp = (ev.clientY - sy) * scale;
        if (id === 'depth') a.depth = Math.max(0, Math.min(1, d0 + (dyp / ht) / 2));
        else if (id === 'boardW') a.boardW = Math.max(0.5, Math.min(10, bw0 + ptsToCm(dxp)));
        else if (id === 'anschlag') a.anschlagDepth = Math.max(0, Math.min(cmToPts(20), an0 - dxp));
        render(); drawAnnos(pv);
      };
      const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); saveState(); };
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
    }; });
  }
  function buildCtrls() {
    side.innerHTML = '';
    const anWrap = document.createElement('label'); anWrap.className = 'lab-row'; anWrap.innerHTML = '<span>Anschlag</span>';
    const anSel = document.createElement('select'); anSel.innerHTML = '<option value="none">Kein</option><option value="aussen">Aussen</option><option value="innen">Innen</option>'; anSel.value = a.anschlagType || 'none';
    anSel.onchange = () => { a.anschlagType = anSel.value; render(); buildCtrls(); drawAnnos(pv); saveState(); }; anWrap.appendChild(anSel); side.appendChild(anWrap);
    for (const f of fields) { if (f.when && !f.when()) continue; const row = document.createElement('label'); row.className = 'lab-row'; const val = document.createElement('b'); val.textContent = f.get() + ' ' + f.unit;
      row.innerHTML = '<span>' + f.label + '</span>'; const r = document.createElement('input'); r.type = 'range'; r.min = f.min; r.max = f.max; r.step = f.step; r.value = f.get();
      r.oninput = () => { f.set(parseFloat(r.value)); val.textContent = f.get() + ' ' + f.unit; render(); drawAnnos(pv); }; r.onchange = () => saveState();
      row.appendChild(r); row.appendChild(val); side.appendChild(row); }
  }
  const close = () => { ov.remove(); document.removeEventListener('keydown', esc, true); drawAnnos(pv); saveState(); };
  const esc = e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } };
  document.addEventListener('keydown', esc, true); ov.querySelector('#labClose').onclick = close;
  buildCtrls(); requestAnimationFrame(render);
}
function build3DScene(host, walls, arr) {
  host.innerHTML = '';
  const W = host.clientWidth || 800, Hp = host.clientHeight || 500, perPt = docScale.perPt, H = wallHeightM, M = v => v * perPt, lev = a => { const l = layerById(a.layer); return (l && l.elevation) || 0; };
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  for (const w of walls) for (const [x, y] of [[w.x1, w.y1], [w.x2, w.y2]]) { minx = Math.min(minx, x); miny = Math.min(miny, y); maxx = Math.max(maxx, x); maxy = Math.max(maxy, y); }
  const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2, span = Math.max(M(maxx - minx), M(maxy - miny), 2);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xeef1ec);
  const camera = new THREE.PerspectiveCamera(50, W / Hp, 0.05, 4000); camera.position.set(span * 0.85, span * 0.95, span * 0.95);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); renderer.setSize(W, Hp); renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; host.appendChild(renderer.domElement);
  const controls = new THREE.OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.target.set(0, H * 0.4, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x55604f, 0.8));
  const sun = new THREE.DirectionalLight(0xffffff, 0.7); sun.position.set(span * 0.8, span * 1.7, span * 0.5); sun.castShadow = true;   // Schatten
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0006; const sc = sun.shadow.camera, sb = Math.max(span * 1.3, 6); sc.left = -sb; sc.right = sb; sc.top = sb; sc.bottom = -sb; sc.near = 0.1; sc.far = span * 5 + 20; scene.add(sun);
  const gsz = Math.max(span * 2.4, 4);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(gsz, gsz), new THREE.MeshLambertMaterial({ color: 0xdfe3da })); ground.rotation.x = -Math.PI / 2; ground.position.y = -0.01; ground.receiveShadow = true; scene.add(ground);
  scene.add(new THREE.GridHelper(gsz, Math.min(60, Math.max(4, Math.round(gsz))), 0xc4cabe, 0xd8dcd2));
  for (const a of arr) if (a.type === 'area' && a.room && a.pts && a.pts.length >= 3 && layerVisible(a) && phaseVisible(a)) {
    const sh = new THREE.Shape(); a.pts.forEach((p, i) => { const X = M(p[0] - cx), Z = M(p[1] - cy); i ? sh.lineTo(X, Z) : sh.moveTo(X, Z); });
    const fl = new THREE.Mesh(new THREE.ShapeGeometry(sh), new THREE.MeshLambertMaterial({ color: 0xece6d8, side: THREE.DoubleSide })); fl.rotation.x = -Math.PI / 2; fl.position.y = lev(a) + 0.006; fl.receiveShadow = true; scene.add(fl);
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
    const ux = dx / lp, uy = dy / lp, th = M(w.thick || wallThickPts()), HW = w.h3d || H, yb = lev(w), sx = M(w.x1 - cx), sz = M(w.y1 - cy), ry = -Math.atan2(dy, dx);
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
      if (!wL) { addBox(s0, s1, y0, y1, wmat, th, true); return; }
      const lenM = (s1 - s0) * perPt, hM = y1 - y0, bH = (w.schalH ? w.schalH / 100 : 0.12);
      let off = -th / 2; for (const L of wL) { const lt = (L.t / totalT) * th; if (L.mat !== 'luft') addBox2(s0, s1, y0, y1, off + lt / 2, lt, layerMat(L.mat, lenM, hM, bH), true); off += lt; }
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
      const sa2 = Object.assign({}, o, { x: 0, y: 0, ang: 0, thick: thPts, w: wPts, wallId: 'rev2sh' });
      const sw2 = { id: 'rev2sh', type: 'wall', layers: w.layers, x1: 0, y1: wPts / 2, x2: 0, y2: -wPts / 2, thick: thPts, hatch: w.hatch };
      let sh; try { sh = openingRevealStrips(sa2, [sw2]); } catch (_) { sh = null; }
      const mapSH = (p, u) => { const vOff = p[1] * perPt; return [sx + ux * M(u) + nxw * vOff, midY + p[0] * perPt, sz + uy * M(u) + nyw * vOff]; };
      if (sh) for (const st of sh) extrudePrism(st.poly, p => mapSH(p, a0), p => mapSH(p, a1), st.fill);
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
        if (op.bank) { const ext = cmToPts(8); addBox2(a0 - ext, a1 + ext, sillY - 0.04, sillY + 0.01, th / 2 + 0.03, 0.12, bmat, true); }   // Fensterbank aussen
        if (op.niche) { const nD = M(op.obj.nicheD || cmToPts(13)), nH = ptsToCm(op.obj.nicheH || cmToPts(28)) / 100, nC = -(th / 2 - nD / 2); addBox2(a0, a1, headY, Math.min(yb + HW, headY + nH), nC, nD, nmat, true); }   // Storennische 13×28 hinten (innen)
      } else if (op.kind === 'door') {   // Tür im 3D: Zarge (Material) + Türblatt / Festteil = Glas
        const fdM = M(op.fd), fwM = M(op.fw), dC = Math.max(-(th / 2 - fdM / 2), Math.min(th / 2 - fdM / 2, (op.depth - 0.5) * th)), headY = yb + Math.min(op.head, HW), leafD = M(cmToPts(4));
        addReveal3D(op.obj, yb, headY, a0, a1);   // Schichteinzug Laibung + Sturz
        addBox2(a0, a0 + op.fw, yb, headY, dC, fdM, omat, true); addBox2(a1 - op.fw, a1, yb, headY, dC, fdM, omat, true);   // Zarge seitlich
        addBox2(a0, a1, headY - fwM, headY, dC, fdM, omat, true);                                                          // Zarge oben
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
      const geo = new THREE.ExtrudeGeometry(sh, { depth: a.thick || 0.2, bevelEnabled: false }), m = new THREE.Mesh(geo, smat);
      m.castShadow = true; m.receiveShadow = true; m.rotation.x = Math.PI / 2; m.position.y = lev(a) + (a.base || 0) + (a.thick || 0.2); scene.add(m);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), emat); e.rotation.x = Math.PI / 2; e.position.y = m.position.y; scene.add(e);
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
  const bmat = new THREE.MeshLambertMaterial({ color: 0xcec5b4 });
  for (const a of arr) if (a.type === 'block' && layerVisible(a) && phaseVisible(a)) {
    const bw = M(Math.abs(a.w)), bd = M(Math.abs(a.h)), bh = BLOCK_H[a.kind] || 0.6, ccx = Math.min(a.x, a.x + a.w) + Math.abs(a.w) / 2, ccy = Math.min(a.y, a.y + a.h) + Math.abs(a.h) / 2;
    if (bw < 0.01 || bd < 0.01) continue;
    const geo = new THREE.BoxGeometry(bw, bh, bd), m = new THREE.Mesh(geo, bmat); m.position.set(M(ccx - cx), lev(a) + bh / 2, M(ccy - cy)); scene.add(m);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), emat); e.position.copy(m.position); scene.add(e);
  }
  let raf, alive = true;
  const onResize = () => { const w2 = host.clientWidth, h2 = host.clientHeight; if (!w2 || !h2) return; camera.aspect = w2 / h2; camera.updateProjectionMatrix(); renderer.setSize(w2, h2); };
  window.addEventListener('resize', onResize);
  const loop = () => { if (!alive) return; controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(loop); }; loop();
  const setView = name => { const ty = H * 0.45, d = Math.max(span * 1.4, 4); if (name === 'top') { camera.position.set(0.001, d * 1.7, 0.001); controls.target.set(0, 0, 0); } else if (name === 'front') { camera.position.set(0, ty, d * 1.5); controls.target.set(0, ty, 0); } else if (name === 'side') { camera.position.set(d * 1.5, ty, 0.001); controls.target.set(0, ty, 0); } else { camera.position.set(span * 0.85, span * 0.95, span * 0.95); controls.target.set(0, H * 0.4, 0); } camera.updateProjectionMatrix(); controls.update(); };
  const snapshot = () => { renderer.render(scene, camera); return { data: renderer.domElement.toDataURL('image/png'), w: renderer.domElement.width, h: renderer.domElement.height }; };
  return { dispose: () => { alive = false; cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); controls.dispose(); renderer.dispose(); host.innerHTML = ''; }, setView, snapshot };
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
  rulerOn = !rulerOn; const b = $('#btnRuler'); if (b) b.classList.toggle('on', rulerOn);
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
function toggleGrid() {
  gridOn = !gridOn; const b = $('#btnGrid'); if (b) b.classList.toggle('on', gridOn);
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
  // Ribbon: Reiter umschalten + Werkzeugreihe ein-/ausklappen
  $$('.rib-tab').forEach(b => b.onclick = () => { activateRibTab(b.dataset.tab); document.body.classList.remove('rib-collapsed'); });
  $('#ribCollapse').onclick = () => document.body.classList.toggle('rib-collapsed');
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
  let planKind = 'kopf', planPos = 'br';
  $('#footPlan').onclick = e => { e.stopPropagation(); const p = $('#planPop'); p.hidden = !p.hidden; };
  $('#pbBuild').onclick = e => { e.stopPropagation(); const p = $('#buildPop'); if (p.hidden) openBuildPop(); else p.hidden = true; };
  $('#bpAdd').onclick = () => { buildDraft.push(['putz', 2]); renderBuildList(); };
  $('#bpApply').onclick = applyBuildup;
  $('#bpSingle').onclick = () => { wallBuildup = null; const a = selWall(); if (a) { pushUndo(); applyWallBuildup(a, null); applyMaterial(a, 'none'); pageViews.forEach(drawAnnos); saveState(); } $('#buildPop').hidden = true; };
  document.addEventListener('pointerdown', e => { if (!e.target.closest('#buildPop') && !e.target.closest('#pbBuild')) $('#buildPop').hidden = true; }, true);
  $('#footBW').onclick = () => { document.body.classList.toggle('bw'); $('#footBW').classList.toggle('on', document.body.classList.contains('bw')); };
  $('#footSimple').onclick = () => { simpleMode = !simpleMode; $('#footSimple').classList.toggle('on', simpleMode); pageViews.forEach(drawAnnos); toast(simpleMode ? 'Einfache Darstellung – Wände schwarz, Öffnungen als Symbol' : 'Detaillierte Darstellung (automatisch nach Aufbau)'); };
  $('#footWinDim').onclick = () => { winDimsOn = !winDimsOn; $('#footWinDim').classList.toggle('on', winDimsOn); pageViews.forEach(drawAnnos); toast(winDimsOn ? 'Fenster-/Tür-Bemaßung an (R Rohbau · La Aussenlicht · Li Innenlicht)' : 'Fenster-/Tür-Bemaßung aus'); };
  $('#footQty').onclick = openQuantities;
  $('#footSchedule').onclick = openSchedule;
  $('#footWallList').onclick = openWallList;
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
  $$('#blockPop button').forEach(b => b.onclick = () => { blockKind = b.dataset.bk; $('#blockPop').hidden = true; setTool('block'); });
  document.addEventListener('pointerdown', e => { if (!e.target.closest('#blockPop') && !e.target.closest('#btnBlock')) $('#blockPop').hidden = true; }, true);
  $('#pbWallH').onchange = () => { const v = parseFloat(($('#pbWallH').value || '').replace(',', '.')); if (!(v > 0)) return; wallHeightM = v; const a = selWall(); if (a) { pushUndo(); a.h3d = v; saveState(); } };
  $('#pbSill').onchange = () => { const v = parseFloat(($('#pbSill').value || '').replace(',', '.')); if (!(v >= 0)) return; const a = selOpen(); if (a) { pushUndo(); const ins = (inputLicht && a.kind === 'window') ? ptsToCm(openInsPts(a)) / 100 : 0; a.sill = Math.max(0, v - ins); pageViews.forEach(drawAnnos); saveState(); } };
  $('#pbHead').onchange = () => { const v = parseFloat(($('#pbHead').value || '').replace(',', '.')); if (!(v > 0)) return; const a = selOpen(); if (a) { pushUndo(); const ins = inputLicht ? ptsToCm(openInsPts(a)) / 100 : 0; a.head = v + ins; pageViews.forEach(drawAnnos); saveState(); } };
  $('#pbDepth').onchange = () => { let v = parseFloat(($('#pbDepth').value || '').replace(',', '.')); if (!(v >= 0)) return; v = Math.max(0, Math.min(100, v)) / 100; lastOpenDepth = v; const a = selOpen(); if (a) { pushUndo(); a.depth = v; pageViews.forEach(drawAnnos); saveState(); } };
  $('#pbSlabBase').onchange = () => { const v = parseFloat(($('#pbSlabBase').value || '').replace(',', '.')); if (!(v >= 0)) return; const a = selSlab(); if (a) { pushUndo(); a.base = v; pageViews.forEach(drawAnnos); saveState(); } };
  $('#pbSlabThick').onchange = () => { const v = parseFloat(($('#pbSlabThick').value || '').replace(',', '.')); if (!(v > 0)) return; const a = selSlab(); if (a) { pushUndo(); a.thick = v / 100; pageViews.forEach(drawAnnos); saveState(); } };
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
  $('#pbWallColor').addEventListener('input', e => { const c = e.target.value; style.color = c; $('#colorDot').style.background = c; $('#pbWallDot').style.background = c; const a = selWall(); if (a) { a.color = c; if (a.hatch) a.hatch.color = c; pageViews.forEach(drawAnnos); } });
  $$('#pbOpen [data-ok]').forEach(b => b.onclick = () => { openKind = b.dataset.ok; const a = selOpen(); if (a) { pushUndo(); a.kind = openKind; pageViews.forEach(drawAnnos); saveState(); } else updatePlanBar(); });
  $('#pbWidth').onchange = () => { const v = parseFloat($('#pbWidth').value); if (!(v > 0)) return updatePlanBar(); const a = selOpen(); let pts = cmToPts(v); if (inputLicht) pts += 2 * openInsPts(a); lastOpenW = pts; if (a) { pushUndo(); a.w = pts; pageViews.forEach(drawAnnos); saveState(); } };
  $('#pbLichtRoh').onclick = () => { inputLicht = !inputLicht; $('#pbLichtRoh').classList.toggle('on', inputLicht); updatePlanBar(); toast(inputLicht ? 'Öffnungsbreite = Lichtmaß (Rohbau = Licht + Rahmen)' : 'Öffnungsbreite = Rohbaumaß'); };
  $('#pbFlip').onclick = () => { const a = selOpen(); if (!a) return; pushUndo(); if (a.swing === 1 && a.hinge === 1) a.hinge = -1; else if (a.hinge === -1 && a.swing === 1) a.swing = -1; else if (a.hinge === -1 && a.swing === -1) a.hinge = 1; else a.swing = 1; pageViews.forEach(drawAnnos); saveState(); };
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
    if (a.type !== 'dim' && a.type !== 'measure') return;
    const v = prompt('Mass-Beschriftung (leer = automatisch gemessen):', a.text || lenLabel(a)); if (v === null) return;
    pushUndo(); a.text = v.trim() || ''; drawAnnos(pv);
  });
  $('#delSel').onclick = deleteSel;
  // Fussleiste (Blatt-Funktionen)
  $('#qRotL').onclick = () => rotatePage(-90); $('#qRotR').onclick = () => rotatePage(90);
  $('#qCrop').onclick = () => setTool('crop');
  $('#footScale').onclick = () => openScale(0);   // 1:n-Eingabe (nicht Kalibrieren)
  $('#footFormat').onclick = e => { e.stopPropagation(); const p = $('#fmtPop'); p.hidden = !p.hidden; };
  $$('#fmtPop button').forEach(b => b.onclick = () => { $('#fmtPop').hidden = true; changePageFormat(+b.dataset.w, +b.dataset.h); });
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
  $('#sbOpenFlip').onclick = () => { const a = selA(), pv = selPv(); if (!a || a.type !== 'opening') return; pushUndo(); if (a.swing === 1 && a.hinge === 1) { a.hinge = -1; } else if (a.hinge === -1 && a.swing === 1) { a.swing = -1; } else if (a.hinge === -1 && a.swing === -1) { a.hinge = 1; } else { a.swing = 1; } if (pv) drawAnnos(pv); saveState(); };
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
    if (e.key === 'Enter' && areaDraft) { e.preventDefault(); finishArea(); return; }   // Fläche abschliessen
    if (e.key === 'Enter' && penDraft) { e.preventDefault(); finishCurve(); return; }   // Kurve abschliessen
    if (e.key === 'Enter' && wallDraft) { e.preventDefault(); finishWallChain(); return; }   // Wand-Kette abschliessen
    if (e.key === 'Enter' && cdimDraft) { e.preventDefault(); finishChaindim(); return; }   // Kettenmass abschliessen
    if (e.key === 'Enter' && segDraft) { e.preventDefault(); finishSegDraft(); return; }   // Linie beenden
    if (e.key === 'Backspace' || e.key === 'Delete') {   // im Zeichnen: letzten Punkt zurücknehmen
      if (wallDraft) { e.preventDefault(); wallChainUndo(); return; }
      if (cdimDraft) { e.preventDefault(); if (cdimDraft.a.pts.length > 1) { cdimDraft.a.pts.pop(); drawAnnos(cdimDraft.pv); } else cancelChaindim(); return; }
      if (areaDraft) { e.preventDefault(); if (areaDraft.a.pts.length > 1) { areaDraft.a.pts.pop(); drawAnnos(areaDraft.pv); } else cancelArea(); return; }
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
