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
let tool = 'select';
let style = { color: '#b4502f', width: 2.5, size: 16 };   // Standard: Rost (gut sichtbar auf Plänen)
let penTidy = true;        // Freihand-Skizzen automatisch zu sauberen Formen aufräumen
let docScale = null;       // {perPt: reale Meter pro PDF-Punkt, label:'1:100'} – für Messen
const PT2MM = 25.4 / 72;   // 1 PDF-Punkt in mm
function fmtLen(pts) {
  if (!docScale) return Math.round(pts * PT2MM) + ' mm';      // ohne Massstab: Papier-mm
  const m = pts * docScale.perPt;
  if (m >= 1) return (Math.round(m * 100) / 100).toString().replace('.', ',') + ' m';
  if (m >= 0.1) return (Math.round(m * 1000) / 10).toString().replace('.', ',') + ' cm';
  return Math.round(m * 1000) + ' mm';
}
let sel = null;            // {num, id}
let nextId = 1;
let undoStack = [];

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
async function pickFolder() {
  if (!fsSupported()) { toast(location.protocol === 'file:' ? 'Ordner-Browser nur über die Online-/App-Version (https).' : 'Ordner-Zugriff braucht Chrome/Edge.'); return; }
  try { dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' }); } catch (_) { return; }
  $('#work').classList.add('files-open'); $('#btnFolder').classList.add('on'); $('#fpName').textContent = dirHandle.name || 'Ordner'; await refreshTree();
}
// „Dateien"-Knopf: Verzeichnis-Panel ein-/ausklappen (ohne Ordner-Zugriff: einfach Datei öffnen)
function toggleFiles() {
  if (!fsSupported()) { openPicker(); return; }
  const open = $('#work').classList.toggle('files-open'); $('#btnFolder').classList.toggle('on', open);
}
async function refreshTree() {
  if (!dirHandle) return; const t = $('#fpTree'); t.innerHTML = ''; await buildTree(dirHandle, t);
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
async function openFiles(files) {
  files = [...files].filter(f => /pdf$/i.test(f.name) || f.type === 'application/pdf' || isImg(f));
  if (!files.length) return;
  try { status('Lade PDF-Engine …'); await loadPdfJs(); } catch (_) { status(''); toast('PDF-Engine nicht ladbar (einmal Internet nötig).'); return; }
  try {
    for (const f of files) {                                  // jede Datei → eigener Tab
      let bytes, name;
      if (isImg(f)) { status('Bild wird vorbereitet …'); bytes = await imageToPdf(f); name = f.name.replace(/\.[^.]+$/, '') + '.pdf'; }
      else { bytes = new Uint8Array(await f.arrayBuffer()); name = f.name; }
      await addDoc(bytes, name);
    }
  } catch (e) { status(''); console.error(e); toast('Datei konnte nicht geöffnet werden.'); }
}
/* ---------- Mehrere Dokumente (Tabs) ---------- */
function blankDoc(bytes, name) { return { bytes, name, fileHandle: null, annos: {}, pageRot: {}, viewRot: {}, docScale: null, nextId: 1, undo: [], zoom: 'auto', pdfDoc: null, scrollTop: 0, dirty: false }; }
function saveActiveDoc() {
  if (active < 0 || !docs[active]) return; const d = docs[active];
  d.bytes = curBytes; d.name = docName; d.fileHandle = curFileHandle; d.annos = annos; d.pageRot = pageRot; d.viewRot = viewRot; d.docScale = docScale; d.nextId = nextId; d.undo = undoStack; d.zoom = zoom; d.pdfDoc = pdfDoc; d.dirty = dirty;
  const p = $('#pages'); d.scrollTop = p ? p.scrollTop : 0;
}
async function loadActive() {
  const d = docs[active]; if (!d) return;
  curBytes = d.bytes; docName = d.name; curFileHandle = d.fileHandle; annos = d.annos; pageRot = d.pageRot; viewRot = d.viewRot; docScale = d.docScale; nextId = d.nextId; undoStack = d.undo; zoom = d.zoom; sel = null; dirty = d.dirty || false;
  $('#btnUndo').disabled = !undoStack.length;
  if (d.pdfDoc) { pdfDoc = d.pdfDoc; await renderCurrentDoc(); } else { await loadDoc(d.bytes.slice()); d.pdfDoc = pdfDoc; }
  const p = $('#pages'); if (p) p.scrollTop = d.scrollTop || 0;
}
function showEmpty() { active = -1; pdfDoc = null; curBytes = null; curFileHandle = null; $('#drop').classList.remove('hide'); $('#toolbar').hidden = true; $('#quickbar').hidden = true; $('#pages').innerHTML = ''; $('#thumbs').innerHTML = ''; $('#btnSave').disabled = true; $('#btnSend').disabled = true; document.title = 'Submit PDF'; renderTabs(); }
async function addDoc(bytes, name) {
  saveActiveDoc(); const prev = active; const d = blankDoc(bytes, name); docs.push(d); active = docs.length - 1;
  try { await loadActive(); }
  catch (e) {                                          // z. B. Passwort abgebrochen / nicht lesbar → Tab wieder entfernen
    docs.pop(); active = docs.length ? Math.min(prev, docs.length - 1) : -1;
    if (active >= 0) { try { await loadActive(); } catch (_) { } renderTabs(); } else showEmpty();
    if (!e || e.name !== 'AbortByUser') toast('Datei konnte nicht geöffnet werden.');
    return;
  }
  renderTabs(); await maybeRestore();
}
async function activateDoc(i) { if (i === active || i < 0 || i >= docs.length) return; saveActiveDoc(); active = i; await loadActive(); renderTabs(); }
async function closeDoc(i) {
  if (i < 0 || i >= docs.length) return;
  const wasActive = i === active; docs.splice(i, 1);
  if (!docs.length) { showEmpty(); return; }
  if (wasActive) { active = Math.min(active, docs.length - 1); await loadActive(); } else if (i < active) active--;
  renderTabs();
}
function renderTabs() {
  const bar = $('#tabbar'); if (!bar) return;
  document.body.classList.toggle('has-tabs', docs.length >= 1);
  bar.innerHTML = ''; if (!docs.length) return;
  docs.forEach((d, i) => {
    const t = document.createElement('div'); t.className = 'tab' + (i === active ? ' active' : '');
    const nm = document.createElement('span'); nm.className = 'tab-nm'; nm.textContent = d.name; nm.title = d.name; nm.onclick = () => activateDoc(i);
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
  if (!curBytes || active < 0 || !dirty) return;
  try { await idbPut(docSig(), { name: docName, ts: Date.now(), annos, pageRot, viewRot, docScale, nextId }); } catch (_) { }
}
function clearAutosave() { idbDel(docSig()); }
async function maybeRestore() {                                  // beim Öffnen: gibt es gesicherte Anmerkungen?
  const rec = await idbGet(docSig());
  if (!rec || !rec.annos || !Object.keys(rec.annos).length) return;
  const when = new Date(rec.ts).toLocaleString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  if (!confirm('Für „' + docName + '" gibt es automatisch gesicherte Anmerkungen (' + when + ').\nWiederherstellen?')) return;
  annos = rec.annos; pageRot = rec.pageRot || {}; viewRot = rec.viewRot || {}; docScale = rec.docScale || null; nextId = Math.max(nextId, rec.nextId || 1);
  const d = docs[active]; if (d) { d.annos = annos; d.pageRot = pageRot; d.viewRot = viewRot; d.docScale = docScale; d.nextId = nextId; d.dirty = true; }
  dirty = true; pageViews.forEach(pv => { layoutPv(pv); drawAnnos(pv); }); buildThumbs(); refreshComments(); updateScaleLabel(); toast('Anmerkungen wiederhergestellt ✓');
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
// Bild öffnen (setzt curBytes/docName) – nutzt die nebenwirkungsfreie Variante
async function imageToPdfBytes(file) {
  status('Bild wird vorbereitet …');
  curBytes = await imageToPdf(file);
  docName = file.name.replace(/\.[^.]+$/, '') + '.pdf';
}
async function loadDoc(bytes) {
  status('Öffne Dokument …');
  const task = pdfjs.getDocument({ data: bytes }); let cancelled = false;
  task.onProgress = p => { if (p && p.total) status('Öffne Dokument … ' + Math.min(100, Math.round(p.loaded / p.total * 100)) + ' %'); };   // Fortschritt bei grossen Dateien
  task.onPassword = (updatePassword, reason) => {                          // passwortgeschütztes PDF
    const wrong = pdfjs.PasswordResponses && reason === pdfjs.PasswordResponses.INCORRECT_PASSWORD;
    const pw = prompt(wrong ? 'Falsches Passwort – bitte erneut eingeben:' : 'Dieses PDF ist passwortgeschützt.\nPasswort eingeben:');
    if (pw === null) { cancelled = true; try { task.destroy(); } catch (_) { } } else updatePassword(pw);
  };
  try { pdfDoc = await task.promise; }
  catch (e) { status(''); if (cancelled) { const er = new Error('abgebrochen'); er.name = 'AbortByUser'; throw er; } throw e; }
  await renderCurrentDoc();
}
async function renderCurrentDoc() {
  $('#drop').classList.add('hide'); $('#toolbar').hidden = false; $('#quickbar').hidden = false;
  $('#btnSave').disabled = false; $('#btnSend').disabled = false; $('#docName').textContent = docName;
  document.title = docName.replace(/\.pdf$/i, '') + ' – Submit PDF';
  _searchCache = {}; if (typeof closeFind === 'function') closeFind();   // Suche fürs neue Dokument zurücksetzen
  await buildLayout(); buildThumbs(); status(''); refreshComments(); updateScaleLabel();
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
function relayout() { if (!pdfDoc) return; pageViews.forEach(layoutPv); updateZoomLabel(); updatePageInd(); renderVisible(); updateSelBar(); }
let reflowTimer = null; function reflow() { clearTimeout(reflowTimer); reflowTimer = setTimeout(relayout, 140); }

function buildThumbs() {        // Miniaturen ebenfalls lazy (nur sichtbare im Seitenstreifen)
  const host = $('#thumbs'); host.innerHTML = ''; if (thumbObserver) thumbObserver.disconnect();
  for (let n = 1; n <= pdfDoc.numPages; n++) {
    const wrap = document.createElement('div'); wrap.className = 'thumb loading'; wrap.dataset.n = n;
    const c = document.createElement('canvas'); wrap.appendChild(c);
    const tn = document.createElement('span'); tn.className = 'tn'; tn.textContent = n; wrap.appendChild(tn);
    const ctrl = document.createElement('div'); ctrl.className = 'thumb-ctrl';
    ctrl.innerHTML = '<button data-act="up" title="Seite nach oben">▲</button><button data-act="down" title="Seite nach unten">▼</button><button data-act="extract" title="Seite als neue PDF speichern">⤓</button><button data-act="del" class="del" title="Seite löschen">✕</button>';
    wrap.appendChild(ctrl);
    wrap.addEventListener('click', e => {
      const act = e.target.getAttribute && e.target.getAttribute('data-act');
      if (act === 'up') { movePage(n, -1); } else if (act === 'down') { movePage(n, 1); } else if (act === 'del') { deletePage(n); } else if (act === 'extract') { extractPage(n); } else if (!wrap._dragged) gotoPage(n);
    });
    wrap.addEventListener('pointerdown', e => startThumbDrag(e, n, wrap));   // Drag&Drop-Umsortieren
    host.appendChild(wrap);
  }
  const add = document.createElement('button'); add.className = 'thumb-add'; add.textContent = '+ PDF/Bild anhängen';
  add.onclick = () => { const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'application/pdf,.pdf,image/*'; inp.multiple = true; inp.onchange = e => appendFiles(e.target.files); inp.click(); };
  host.appendChild(add);
  thumbObserver = new IntersectionObserver(ents => { for (const e of ents) if (e.isIntersecting) { renderThumb(+e.target.dataset.n, e.target); thumbObserver.unobserve(e.target); } }, { root: host, rootMargin: '500px 0px' });
  $$('.thumb', host).forEach(b => thumbObserver.observe(b));
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
function updatePageInd() { if (!pdfDoc) return; const cur = curPage(); $('#pageInd').textContent = cur + ' / ' + pdfDoc.numPages; $$('.thumb', $('#thumbs')).forEach(t => t.classList.toggle('active', +t.dataset.n === cur)); }

/* ---------- Zoom ---------- */
function curScale() { return (zoom === 'auto') ? (pageViews[0] ? pageViews[0].scale : 1) : zoom; }
function updateZoomLabel() { const pct = Math.round(((zoom === 'auto') ? curScale() : zoom) * 100); $('#zoomVal').innerHTML = pct + '&nbsp;%'; $('#zoomVal').classList.toggle('on', zoom === 'auto'); }
function setZoom(z) { zoom = z; if (pdfDoc) relayout(); }
function zoomStep(d) { const c = curScale(); setZoom(Math.max(.25, Math.min(5, Math.round((c + d) * 100) / 100))); }
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
function findAnno(n, id) { return (annos[n] || []).find(a => a.id === id); }
function drawAnnos(pv) {
  const svg = pv.svg; svg.innerHTML = '';
  for (const a of getAnnos(pv.num)) drawOne(svg, a, pv);
  if (sel && sel.num === pv.num) drawSelection(svg, findAnno(pv.num, sel.id), pv);
  updateSelBar();
}
// Farbe (#hex oder rgb()) → #rrggbb für das Farbfeld
function toHex(s) { const c = parseColor(s), h = n => ('0' + Math.round(n * 255).toString(16)).slice(-2); return '#' + h(c.r) + h(c.g) + h(c.b); }
// Schwebende Leiste über der Auswahl positionieren/konfigurieren
function updateSelBar() {
  const bar = $('#selbar'); if (!bar) return;
  if (!sel || tool !== 'select') { bar.hidden = true; return; }
  const pv = pageViews.find(p => p.num === sel.num), a = pv && findAnno(pv.num, sel.id);
  if (!pv || !a) { bar.hidden = true; return; }
  const hasColor = a.type !== 'sig', hasWidth = a.width != null, hasSize = (a.type === 'text' || a.type === 'edit');
  $('#sbColorWrap').hidden = !hasColor; $('#sbWidths').hidden = !hasWidth; $('#sbSize').hidden = !hasSize;
  $('#sbEdit').hidden = a.type !== 'edit'; $('#sbMove').hidden = a.type !== 'edit';
  $('#sbLine').hidden = !isLineType(a);
  if (hasColor) { $('#sbColor').value = toHex(a.color); $('#sbColorDot').style.background = a.color; }
  if (hasWidth) $$('#sbWidths button').forEach(b => b.classList.toggle('on', +b.dataset.w === a.width));
  if (hasSize) $('#sbSize').value = String(a.size);
  bar.hidden = false;
  const b = bbox(a), ctm = pv.svg.getScreenCTM(); if (!ctm) { bar.hidden = true; return; }
  const sp = pv.svg.createSVGPoint(); sp.x = b.x + b.w / 2; sp.y = b.y; const tp = sp.matrixTransform(ctm);
  const host = $('#pages').getBoundingClientRect(), bw = bar.offsetWidth, bh = bar.offsetHeight;
  let x = tp.x - bw / 2, y = tp.y - bh - 12;
  x = Math.max(host.left + 6, Math.min(host.right - bw - 6, x));
  if (y < host.top + 4) { sp.y = b.y + b.h; const bp = sp.matrixTransform(ctm); y = bp.y + 12; }   // kein Platz oben → unter die Auswahl
  bar.style.left = x + 'px'; bar.style.top = y + 'px';
}
function strokeAttrs(a) { return { stroke: a.color, 'stroke-width': a.width, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }; }
function drawOne(svg, a, pv) {
  let el, hit;
  if (a.type === 'line' || a.type === 'arrow' || a.type === 'measure' || a.type === 'dim') {
    el = svgEl('line', { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, ...strokeAttrs(a), 'data-id': a.id });
    svg.appendChild(el);
    if (a.type === 'arrow') drawArrowHead(svg, a);
    if (a.type === 'measure') drawMeasureLabel(svg, a, pv);
    hit = svgEl('line', { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, class: 'hit', 'data-id': a.id }); svg.appendChild(hit);
  } else if (a.type === 'rect') {
    el = svgEl('rect', { x: Math.min(a.x, a.x + a.w), y: Math.min(a.y, a.y + a.h), width: Math.abs(a.w), height: Math.abs(a.h), ...strokeAttrs(a), 'data-id': a.id }); svg.appendChild(el);
  } else if (a.type === 'oval') {
    el = svgEl('ellipse', { cx: a.x + a.w / 2, cy: a.y + a.h / 2, rx: Math.abs(a.w / 2), ry: Math.abs(a.h / 2), ...strokeAttrs(a), 'data-id': a.id }); svg.appendChild(el);
  } else if (a.type === 'pen') {
    el = svgEl('polyline', { points: a.pts.map(p => p[0] + ',' + p[1]).join(' '), ...strokeAttrs(a), 'data-id': a.id }); svg.appendChild(el);
  } else if (a.type === 'text') {
    el = svgEl('text', { x: a.x, y: a.y, fill: a.color, 'font-size': a.size, 'data-id': a.id });
    a.text.split('\n').forEach((ln, i) => { const ts = svgEl('tspan', { x: a.x, dy: i === 0 ? 0 : a.size * 1.25 }); ts.textContent = ln || ' '; el.appendChild(ts); });
    svg.appendChild(el);
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
  if (a.type === 'rect' || a.type === 'oval') return { x: Math.min(a.x, a.x + a.w), y: Math.min(a.y, a.y + a.h), w: Math.abs(a.w), h: Math.abs(a.h) };
  if (a.type === 'line' || a.type === 'arrow' || a.type === 'measure' || a.type === 'dim') return { x: Math.min(a.x1, a.x2), y: Math.min(a.y1, a.y2), w: Math.abs(a.x2 - a.x1), h: Math.abs(a.y2 - a.y1) };
  if (a.type === 'pen') { const xs = a.pts.map(p => p[0]), ys = a.pts.map(p => p[1]); return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; }
  if (a.type === 'text') return { x: a.x, y: a.y, w: (a.w || 120), h: a.size * (a.text.split('\n').length) * 1.3 };
  if (a.type === 'note') return { x: a.x, y: a.y, w: 14, h: 14 };
  if (a.type === 'sig' || a.type === 'edit' || a.type === 'cover') return { x: a.x, y: a.y, w: a.w, h: a.h };
  if (a.type === 'highlight') { if (!a.rects || !a.rects.length) return { x: 0, y: 0, w: 0, h: 0 }; let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity; for (const r of a.rects) { mnx = Math.min(mnx, r.x); mny = Math.min(mny, r.y); mxx = Math.max(mxx, r.x + r.w); mxy = Math.max(mxy, r.y + r.h); } return { x: mnx, y: mny, w: mxx - mnx, h: mxy - mny }; }
  return { x: 0, y: 0, w: 0, h: 0 };
}
function isLineType(a) { return a && (a.type === 'line' || a.type === 'arrow' || a.type === 'measure' || a.type === 'dim'); }
function drawSelection(svg, a, pv) {
  if (!a) return; const hs = (COARSE ? 8 : 4.5) / pv.scale;
  if (isLineType(a)) {                                  // Linie: KEIN Rechteck-Rahmen, nur Linie hervorheben + Endpunkte
    svg.appendChild(svgEl('line', { x1: a.x1, y1: a.y1, x2: a.x2, y2: a.y2, class: 'sel-line' }));
    for (const [name, x, y] of [['p1', a.x1, a.y1], ['p2', a.x2, a.y2]]) svg.appendChild(svgEl('circle', { class: 'handle', cx: x, cy: y, r: hs, 'data-h': name }));
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
  if (isLineType(a)) {
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
    setHover(pv, id ? findAnno(pv.num, +id) : null);
  });
  pv.svg.addEventListener('pointerleave', () => { pv._hoverId = null; setHover(pv, null); });
}
function onPointerDown(pv, e) {
  if (e.button !== 0) return;
  const p = evtToPage(pv, e);
  const idAttr = e.target.getAttribute && e.target.getAttribute('data-id');
  const hAttr = e.target.getAttribute && e.target.getAttribute('data-h');

  if (tool === 'select') {
    if (hAttr && sel && sel.num === pv.num) { startResize(pv, e, hAttr); return; }
    if (idAttr) {
      sel = { num: pv.num, id: +idAttr }; drawAnnos(pv);
      const a = findAnno(pv.num, sel.id);
      if (a && a.type === 'note') { openNoteEdit(pv, a); return; }
      startMove(pv, e, a); return;
    }
    sel = null; drawAnnos(pv); return;
  }
  if (tool === 'sig') { placeSig(pv, p); return; }
  if (tool === 'highlight') { startHighlight(pv, e, p); return; }
  if (tool === 'edittext') { editTextAt(pv, p); return; }
  if (tool === 'text') { createText(pv, p); return; }
  if (tool === 'note') { pushUndo(); const a = { id: nextId++, type: 'note', x: p.x, y: p.y, color: style.color, text: '' }; getAnnos(pv.num).push(a); sel = { num: pv.num, id: a.id }; drawAnnos(pv); refreshComments(); openNoteEdit(pv, a); return; }
  // Zeichnen
  startDraw(pv, e, p);
}

function startMove(pv, e, a) {
  if (!a) return; const start = evtToPage(pv, e); pushUndo(); let moved = false;
  const orig = JSON.parse(JSON.stringify(a));
  const move = ev => {
    const q = evtToPage(pv, ev), dx = q.x - start.x, dy = q.y - start.y; moved = true; translateAnno(a, orig, dx, dy); drawAnnos(pv);
  };
  const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); if (!moved) undoStack.pop(); else { saveState(); refreshComments(); } };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
}
// Endpunkt auf 15°-Schritte zum Festpunkt (ax,ay) einrasten (Shift beim Ziehen)
function snap15(ax, ay, qx, qy) { const dx = qx - ax, dy = qy - ay, len = Math.hypot(dx, dy), step = Math.PI / 12, ang = Math.round(Math.atan2(dy, dx) / step) * step; return { x: ax + Math.cos(ang) * len, y: ay + Math.sin(ang) * len }; }
function translateAnno(a, o, dx, dy) {
  if (a.type === 'line' || a.type === 'arrow' || a.type === 'measure' || a.type === 'dim') { a.x1 = o.x1 + dx; a.y1 = o.y1 + dy; a.x2 = o.x2 + dx; a.y2 = o.y2 + dy; }
  else if (a.type === 'pen') a.pts = o.pts.map(p => [p[0] + dx, p[1] + dy]);
  else if (a.type === 'highlight') a.rects = o.rects.map(r => ({ x: r.x + dx, y: r.y + dy, w: r.w, h: r.h }));
  else { a.x = o.x + dx; a.y = o.y + dy; }
}
function startResize(pv, e, h) {
  const a = findAnno(pv.num, sel.id); if (!a) return; pushUndo(); const orig = JSON.parse(JSON.stringify(a));
  const move = ev => {
    const q = evtToPage(pv, ev);
    if (isLineType(a)) { let qx = q.x, qy = q.y; if (ev.shiftKey) { const o = h === 'p1' ? { x: a.x2, y: a.y2 } : { x: a.x1, y: a.y1 }; const s = snap15(o.x, o.y, qx, qy); qx = s.x; qy = s.y; } if (h === 'p1') { a.x1 = qx; a.y1 = qy; } else { a.x2 = qx; a.y2 = qy; } }
    else if (orig.type === 'sig') { const ratio = orig.w / orig.h || 1, ax = h.includes('w') ? orig.x + orig.w : orig.x, ay = h.includes('n') ? orig.y + orig.h : orig.y; const nw = Math.max(12, Math.abs(q.x - ax)), nh = nw / ratio; a.w = nw; a.h = nh; a.x = h.includes('w') ? ax - nw : ax; a.y = h.includes('n') ? ay - nh : ay; }
    else { let x = orig.x, y = orig.y, w = orig.w, h2 = orig.h; if (orig.type === 'rect' || orig.type === 'oval' || orig.type === 'edit' || orig.type === 'cover') { const x2 = x + w, y2 = y + h2; let nx = x, ny = y, nx2 = x2, ny2 = y2; if (h.includes('w')) nx = q.x; if (h.includes('e')) nx2 = q.x; if (h.includes('n')) ny = q.y; if (h.includes('s')) ny2 = q.y; a.x = nx; a.y = ny; a.w = nx2 - nx; a.h = ny2 - ny; } }
    drawAnnos(pv);
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
  let a;
  if (tool === 'pen') a = { id: nextId++, type: 'pen', pts: [[p.x, p.y]], color: style.color, width: style.width };
  else if (tool === 'rect') a = { id: nextId++, type: 'rect', x: p.x, y: p.y, w: 0, h: 0, color: style.color, width: style.width };
  else if (tool === 'oval') a = { id: nextId++, type: 'oval', x: p.x, y: p.y, w: 0, h: 0, color: style.color, width: style.width };
  else a = { id: nextId++, type: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color: style.color, width: style.width }; // line/arrow/measure
  getAnnos(pv.num).push(a);
  const move = ev => {
    const q = evtToPage(pv, ev);
    if (a.type === 'pen') a.pts.push([q.x, q.y]);
    else if (a.type === 'rect' || a.type === 'oval') { a.w = q.x - a.x; a.h = q.y - a.y; }
    else { if (ev.shiftKey) { const s = snap15(a.x1, a.y1, q.x, q.y); a.x2 = s.x; a.y2 = s.y; } else { a.x2 = q.x; a.y2 = q.y; } }   // Shift = 15°-Winkel
    drawAnnos(pv);
  };
  const up = () => {
    document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
    if (a.type === 'calibrate') { const len = Math.hypot(a.x2 - a.x1, a.y2 - a.y1); const arr = getAnnos(pv.num); arr.splice(arr.indexOf(a), 1); undoStack.pop(); drawAnnos(pv); if (len > 4) openScale(len); else setTool('select'); return; }
    if (a.type === 'pen' && penTidy) { const bz = beautify(a.pts); if (bz) { const arr = getAnnos(pv.num), i = arr.indexOf(a); arr[i] = Object.assign({ id: a.id, color: a.color, width: a.width }, bz); } }
    const cur = getAnnos(pv.num).find(x => x.id === a.id) || a;
    const b = bbox(cur); if (cur.type !== 'pen' && b.w < 3 && b.h < 3) { const arr = getAnnos(pv.num); arr.splice(arr.indexOf(cur), 1); undoStack.pop(); drawAnnos(pv); return; }
    sel = { num: pv.num, id: a.id }; setTool('select'); drawAnnos(pv); saveState();
  };
  document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
}

/* ---------- Text ---------- */
function createText(pv, p) {
  const ta = document.createElement('textarea'); ta.className = 'textedit'; ta.rows = 1;
  const sc = pv.scale; ta.style.left = (p.x * sc) + 'px'; ta.style.top = (p.y * sc) + 'px';
  ta.style.fontSize = (style.size * sc) + 'px'; ta.style.color = style.color; ta.style.minWidth = '40px';
  pv.inner.appendChild(ta); ta.focus();
  const commit = () => { const txt = ta.value.replace(/\s+$/, ''); ta.remove(); if (!txt) return; pushUndo(); const a = { id: nextId++, type: 'text', x: p.x, y: p.y, text: txt, color: style.color, size: style.size }; getAnnos(pv.num).push(a); sel = { num: pv.num, id: a.id }; setTool('select'); drawAnnos(pv); saveState(); };
  ta.addEventListener('blur', commit);
  ta.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); ta.blur(); } else if (ev.key === 'Escape') { ta.value = ''; ta.blur(); } });
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; });
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
    pushUndo(); getAnnos(pv.num).push(a); sel = { num: pv.num, id: a.id }; setTool('select'); drawAnnos(pv);   // Treffer: auswählen → Optionen-Leiste (Überschreiben/Verschieben/Grösse)
  } else {
    a = { id: nextId++, type: 'edit', x: p.x, y: p.y - style.size * 0.82, w: 120, h: style.size * 1.2, text: '', size: style.size, color: style.color, bg: '#ffffff' };
    pushUndo(); getAnnos(pv.num).push(a); sel = { num: pv.num, id: a.id }; drawAnnos(pv); openEditEdit(pv, a, true);   // leere Stelle: direkt tippen
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
  const a = { id: nextId++, type: 'highlight', rects: [], color: style.color }; getAnnos(pv.num).push(a);
  const x0 = p.x, y0 = p.y;
  const update = (qx, qy) => {
    const rx = Math.min(x0, qx), ry = Math.min(y0, qy), rw = Math.abs(qx - x0), rh = Math.abs(qy - y0);
    a.rects = items.filter(it => it.x < rx + rw && it.x + it.w > rx && it.y < ry + rh && it.y + it.h > ry).map(it => ({ x: it.x, y: it.y, w: it.w, h: it.h }));
    a._drag = { x: rx, y: ry, w: rw, h: rh }; drawAnnos(pv);
  };
  const move = ev => { const q = evtToPage(pv, ev); update(q.x, q.y); };
  const up = ev => {
    document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
    const q = evtToPage(pv, ev); update(q.x, q.y); delete a._drag;
    if (!a.rects.length) { const arr = getAnnos(pv.num); arr.splice(arr.indexOf(a), 1); undoStack.pop(); drawAnnos(pv); setTool('select'); return; }
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
// Bestehende Text-Annotation per Doppelklick bearbeiten
function openTextAnnoEdit(pv, a) {
  const sc = pv.scale; const ta = document.createElement('textarea'); ta.className = 'textedit'; ta.value = a.text; ta.rows = 1;
  ta.style.left = (a.x * sc) + 'px'; ta.style.top = (a.y * sc) + 'px'; ta.style.fontSize = (a.size * sc) + 'px'; ta.style.color = a.color; ta.style.minWidth = '40px';
  pv.inner.appendChild(ta); ta.focus(); ta.select();
  const commit = () => { a.text = ta.value.replace(/\s+$/, ''); ta.remove(); if (!a.text) { const arr = getAnnos(pv.num), i = arr.indexOf(a); if (i >= 0) arr.splice(i, 1); } drawAnnos(pv); saveState(); };
  ta.addEventListener('blur', commit);
  ta.addEventListener('keydown', ev => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); ta.blur(); } else if (ev.key === 'Escape') ta.blur(); });
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; });
}
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
  if (!pdfDoc) return; const n = curPage(); pageRot[n] = (((pageRot[n] || 0) + deg) % 360 + 360) % 360; saveState();
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

/* ---------- Undo / Löschen ---------- */
function snapshot() { return JSON.stringify({ annos, pageRot }); }
function pushUndo() { undoStack.push({ t: 'anno', s: snapshot() }); if (undoStack.length > 80) undoStack.shift(); $('#btnUndo').disabled = false; markDirty(); }
// Dokument-Undo (für Seiten-Operationen: Löschen/Verschieben/Anhängen) – sichert auch die PDF-Bytes
function pushDocUndo() { if (!curBytes) return; undoStack.push({ t: 'doc', bytes: curBytes.slice(), s: JSON.stringify({ annos, pageRot, viewRot, docScale }) }); if (undoStack.length > 80) undoStack.shift(); $('#btnUndo').disabled = false; markDirty(); }
async function undo() {
  if (!undoStack.length) return;
  const e = undoStack.pop(); sel = null; $('#btnUndo').disabled = !undoStack.length;
  if (e.t === 'doc') { const d = JSON.parse(e.s); annos = d.annos; pageRot = d.pageRot; viewRot = d.viewRot || {}; docScale = d.docScale || null; curBytes = e.bytes; await loadDoc(curBytes.slice()); updateScaleLabel(); }
  else { const d = JSON.parse(e.s); annos = d.annos; pageRot = d.pageRot; pageViews.forEach(pv => { layoutPv(pv); drawAnnos(pv); }); buildThumbs(); refreshComments(); }
}
function saveState() { /* Platzhalter für Autosave-Hook */ }
function deleteSel() { if (!sel) return; const arr = annos[sel.num]; if (!arr) return; const i = arr.findIndex(a => a.id === sel.id); if (i < 0) return; pushUndo(); arr.splice(i, 1); sel = null; pageViews.forEach(drawAnnos); refreshComments(); }
// Ausgewählte Anmerkung mit den Pfeiltasten verschieben (Shift = grosse Schritte)
function nudgeSel(key, d) {
  if (!sel) return; const a = findAnno(sel.num, sel.id); if (!a) return; pushUndo();
  const dx = key === 'ArrowLeft' ? -d : key === 'ArrowRight' ? d : 0, dy = key === 'ArrowUp' ? -d : key === 'ArrowDown' ? d : 0;
  translateAnno(a, JSON.parse(JSON.stringify(a)), dx, dy);
  const pv = pageViews.find(p => p.num === sel.num); if (pv) drawAnnos(pv); refreshComments();
}

/* ---------- Werkzeug umschalten ---------- */
function setTool(t) {
  tool = t; $$('.tool[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t)); applyToolCursor();
  pageViews.forEach(p => { p._hoverId = null; const h = p.svg && p.svg.querySelector('.hover-layer'); if (h) h.remove(); });   // Hover bei Werkzeugwechsel löschen
  $('#pages').classList.toggle('mode-text', t === 'textsel');   // Text-Auswahl-Modus
  if (t === 'textsel') buildTextVisible();
  if (t === 'measure' && !docScale && !setTool._measHint) { setTool._measHint = true; toast('Tipp: Für echte Masse zuerst den Massstab setzen (1:n).'); }
}
function applyToolCursor() {
  pageViews.forEach(pv => { pv.wrap.classList.toggle('tool-draw', ['pen', 'line', 'arrow', 'rect', 'oval', 'measure', 'dim', 'calibrate', 'note', 'sig', 'highlight'].includes(tool)); pv.wrap.classList.toggle('tool-text', tool === 'text' || tool === 'edittext'); });
}

/* ---------- Speichern / PDF erzeugen (pdf-lib) ---------- */
function downloadBytes(bytes, name) { const blob = new Blob([bytes], { type: 'application/pdf' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1500); }
// Drucken: fertiges PDF (mit Anmerkungen) erzeugen und über ein verstecktes iframe drucken
async function printDoc() {
  if (!curBytes) return; status('Druckansicht wird vorbereitet …');
  try {
    const out = await buildPdfBytes();
    const url = URL.createObjectURL(new Blob([out], { type: 'application/pdf' }));
    const ifr = document.createElement('iframe'); ifr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'; ifr.src = url;
    ifr.onload = () => { status(''); setTimeout(() => { try { ifr.contentWindow.focus(); ifr.contentWindow.print(); } catch (_) { window.open(url, '_blank'); } setTimeout(() => { URL.revokeObjectURL(url); ifr.remove(); }, 60000); }, 350); };
    document.body.appendChild(ifr);
  } catch (e) { status(''); console.error(e); toast('Drucken fehlgeschlagen.'); }
}
function outName() { return docName.replace(/\.pdf$/i, '') + '-submit.pdf'; }
async function buildPdfBytes() {
  const lib = await loadPdfLib();
  {
    const { PDFDocument, rgb, StandardFonts, degrees } = lib;
    const doc = await PDFDocument.load(curBytes.slice(), { ignoreEncryption: true });
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pages = doc.getPages(); const sigCache = {};
    for (let n = 1; n <= pages.length; n++) {
      const pg = pages[n - 1]; const { height: PH } = pg.getSize();
      const Y = y => PH - y;                         // pdf.js (oben) → pdf-lib (unten)
      for (const a of (annos[n] || [])) {
        const col = hexToRgb(a.color), c = rgb(col.r, col.g, col.b), w = a.width || 2;
        if (a.type === 'line' || a.type === 'arrow' || a.type === 'measure' || a.type === 'dim') {
          pg.drawLine({ start: { x: a.x1, y: Y(a.y1) }, end: { x: a.x2, y: Y(a.y2) }, thickness: w, color: c });
          if (a.type === 'arrow') { const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1), L = Math.max(12, w * 5); for (const s of [ang + 2.7, ang - 2.7]) pg.drawLine({ start: { x: a.x2, y: Y(a.y2) }, end: { x: a.x2 + Math.cos(s) * L, y: Y(a.y2 + Math.sin(s) * L) }, thickness: w, color: c }); }
          if (a.type === 'measure') { const mx = (a.x1 + a.x2) / 2, my = (a.y1 + a.y2) / 2; pg.drawText(a.label || lenLabel(a), { x: mx + 4, y: Y(my) + 4, size: 11, font, color: c }); }
          if (a.type === 'dim') {
            const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1), tx = Math.cos(ang + Math.PI / 2) * 6, ty = Math.sin(ang + Math.PI / 2) * 6;
            for (const [ex, ey] of [[a.x1, a.y1], [a.x2, a.y2]]) pg.drawLine({ start: { x: ex - tx, y: Y(ey - ty) }, end: { x: ex + tx, y: Y(ey + ty) }, thickness: w, color: c });
            const mx = (a.x1 + a.x2) / 2, my = (a.y1 + a.y2) / 2, lab = a.text || lenLabel(a);
            pg.drawText(lab, { x: mx - lab.length * 3, y: Y(my) + 6, size: 11, font, color: c });
          }
        } else if (a.type === 'rect') { const x = Math.min(a.x, a.x + a.w), y = Math.min(a.y, a.y + a.h), W = Math.abs(a.w), H = Math.abs(a.h); pg.drawRectangle({ x, y: Y(y + H), width: W, height: H, borderColor: c, borderWidth: w }); }
        else if (a.type === 'oval') { pg.drawEllipse({ x: a.x + a.w / 2, y: Y(a.y + a.h / 2), xScale: Math.abs(a.w / 2), yScale: Math.abs(a.h / 2), borderColor: c, borderWidth: w }); }
        else if (a.type === 'pen') { for (let i = 1; i < a.pts.length; i++) pg.drawLine({ start: { x: a.pts[i - 1][0], y: Y(a.pts[i - 1][1]) }, end: { x: a.pts[i][0], y: Y(a.pts[i][1]) }, thickness: w, color: c }); }
        else if (a.type === 'text') { a.text.split('\n').forEach((ln, i) => pg.drawText(ln, { x: a.x, y: Y(a.y + a.size + i * a.size * 1.25), size: a.size, font, color: c })); }
        else if (a.type === 'note' && a.text) { pg.drawRectangle({ x: a.x, y: Y(a.y + 11), width: 13, height: 11, color: c }); }
        else if (a.type === 'highlight') { for (const r of (a.rects || [])) pg.drawRectangle({ x: r.x, y: Y(r.y + r.h), width: r.w, height: r.h, color: c, opacity: 0.33 }); }
        else if (a.type === 'cover') { const cc = parseColor(a.color); pg.drawRectangle({ x: a.x, y: Y(a.y + a.h), width: a.w, height: a.h, color: rgb(cc.r, cc.g, cc.b) }); }
        else if (a.type === 'edit') { const bg = parseColor(a.bg), tc2 = parseColor(a.color); pg.drawRectangle({ x: a.x, y: Y(a.y + a.h), width: a.w, height: a.h, color: rgb(bg.r, bg.g, bg.b) }); (a.text || '').split('\n').forEach((ln, i) => pg.drawText(ln, { x: a.x + 1, y: Y(a.y + a.size + i * a.size * 1.25), size: a.size, font, color: rgb(tc2.r, tc2.g, tc2.b) })); }
        else if (a.type === 'sig' && a.data) { let img = sigCache[a.data]; if (!img) { const bytes = Uint8Array.from(atob(a.data.split(',')[1]), ch => ch.charCodeAt(0)); img = sigCache[a.data] = await doc.embedPng(bytes); } pg.drawImage(img, { x: a.x, y: Y(a.y + a.h), width: a.w, height: a.h }); if (a.caption) { const fs = Math.max(7, Math.min(11, a.h * 0.16)), cy = a.y + a.h + 2; pg.drawLine({ start: { x: a.x, y: Y(cy) }, end: { x: a.x + a.w, y: Y(cy) }, thickness: 0.7, color: rgb(.11, .14, .17) }); pg.drawText(a.caption, { x: a.x, y: Y(cy + fs + 1), size: fs, font, color: rgb(.11, .14, .17) }); } }
      }
      if (pageRot[n]) pg.setRotation(degrees(pageRot[n]));
    }
    return await doc.save();
  }
}
async function save() {
  if (!curBytes) return; status('Speichere … (bei grossen Dateien etwas Geduld)');
  await new Promise(r => setTimeout(r, 20));            // Anzeige zuerst zeichnen lassen
  try {
    const out = await buildPdfBytes();
    let ok = true;
    if (curFileHandle) { const w = await curFileHandle.createWritable(); await w.write(out); await w.close(); status(''); toast('In Datei gespeichert ✓'); }   // direkt in die geöffnete Datei
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
function placeSig(pv, p) {
  if (!pendingSig) { setTool('select'); return; }
  pushUndo(); const w = 170, h = w / (pendingSig.ratio || 3);
  const a = { id: nextId++, type: 'sig', x: p.x - w / 2, y: p.y - h / 2, w, h, data: pendingSig.data, caption: pendingSig.caption || '' };
  getAnnos(pv.num).push(a); sel = { num: pv.num, id: a.id }; setTool('select'); drawAnnos(pv); saveState();
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
  $('#scaleDlg').hidden = true; updateScaleLabel(); pageViews.forEach(drawAnnos); toast('Massstab gesetzt'); setTool('measure');
}
function updateScaleLabel() { const el = $('#scaleInd'); if (el) el.textContent = docScale ? (docScale.label === 'kalibriert' ? '⟂ kalibriert' : docScale.label) : ''; }

/* ---------- Rechtsklick-Menü (alles erreichbar) ---------- */
function hideCtx() { $('#ctxmenu').hidden = true; }
function showCtx(x, y, pv, annoId) {
  const m = $('#ctxmenu'); m.innerHTML = '';
  const add = (label, mi, act, cls) => { const b = document.createElement('button'); if (cls) b.className = cls; b.innerHTML = `<span class="mi">${mi}</span><span>${label}</span>`; b.onclick = () => { hideCtx(); act(); }; m.appendChild(b); };
  const sep = () => { const d = document.createElement('div'); d.className = 'sep'; m.appendChild(d); };
  if (annoId) {
    add('Löschen', '🗑', () => { sel = { num: pv.num, id: annoId }; deleteSel(); }, 'danger');
    add('Farbe ändern', '🎨', () => $('#colorPick').click());
    add('Duplizieren', '⧉', () => duplicateAnno(pv, annoId));
    add('Kopieren', '⧉', () => { sel = { num: pv.num, id: annoId }; copySel(); });
    add('Nach vorne', '⬆', () => reorderAnno(pv, annoId, true));
    add('Nach hinten', '⬇', () => reorderAnno(pv, annoId, false));
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
  sep();
  add('Öffnen', '📂', openPicker);
  add('Speichern (PDF)', '💾', save);
  m.hidden = false;
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.min(x, window.innerWidth - w - 8) + 'px';
  m.style.top = Math.min(y, window.innerHeight - h - 8) + 'px';
}
function duplicateAnno(pv, id) { const a = findAnno(pv.num, id); if (!a) return; pushUndo(); const c = JSON.parse(JSON.stringify(a)); c.id = nextId++; translateAnno(c, JSON.parse(JSON.stringify(c)), 12, 12); getAnnos(pv.num).push(c); sel = { num: pv.num, id: c.id }; drawAnnos(pv); refreshComments(); }
// Ebene: Zeichenreihenfolge = Stapel; ans Ende = vorne, an den Anfang = hinten
function reorderAnno(pv, id, toFront) { const arr = getAnnos(pv.num), i = arr.findIndex(a => a.id === id); if (i < 0) return; pushUndo(); const [a] = arr.splice(i, 1); if (toFront) arr.push(a); else arr.unshift(a); drawAnnos(pv); }
let clipAnno = null;
function copySel() { if (!sel) return; const a = findAnno(sel.num, sel.id); if (a) { clipAnno = JSON.parse(JSON.stringify(a)); toast('Kopiert'); } }
function pasteAnno() { if (!clipAnno) return; const n = curPage(), pv = pageViews.find(p => p.num === n); if (!pv) return; pushUndo(); const c = JSON.parse(JSON.stringify(clipAnno)); c.id = nextId++; translateAnno(c, JSON.parse(JSON.stringify(c)), 14, 14); getAnnos(n).push(c); sel = { num: n, id: c.id }; drawAnnos(pv); refreshComments(); }

/* ---------- Tastenkürzel-Hilfe ---------- */
function toggleShortcuts() {
  const ex = $('#shortcutsDlg'); if (ex) { ex.remove(); return; }
  const rows = [
    ['Werkzeuge', ''], ['Auswählen / Verschieben', 'V'], ['Text schreiben', 'T'], ['Stift / Freihand', 'S'], ['Linie', 'L'], ['Pfeil', 'P'], ['Rechteck', 'R'], ['Oval', 'O'], ['Messen', 'M'], ['Kommentar', 'K'],
    ['Bearbeiten', ''], ['Rückgängig', 'Strg+Z'], ['Kopieren / Einfügen', 'Strg+C / Strg+V'], ['Duplizieren', 'Strg+D'], ['Löschen', 'Entf'], ['Verschieben (fein/grob)', '← ↑ → ↓ / + Umschalt'],
    ['Datei & Ansicht', ''], ['Öffnen', 'Strg+O'], ['Speichern', 'Strg+S'], ['Zoom +/− / Passt', 'Strg + / − / 0'], ['Abbrechen / Schliessen', 'Esc'],
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
  $('#dropOpen').onclick = openPicker;
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
  $('#zoomIn').onclick = () => zoomStep(.15); $('#zoomOut').onclick = () => zoomStep(-.15); $('#zoomVal').onclick = () => setZoom('auto');
  $('#pages').addEventListener('scroll', () => { updatePageInd(); scheduleSharpen(); updateSelBar(); }, { passive: true });
  $('#pages').addEventListener('wheel', e => {     // Strg/Cmd + Mausrad (oder Trackpad-Pinch) = zum Zeiger zoomen
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    zoomToward(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
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
  $$('.tool[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
  $('#penTidyBtn').onclick = () => { penTidy = !penTidy; $('#penTidyBtn').classList.toggle('on', penTidy); toast(penTidy ? 'Skizze aufräumen: an' : 'Freihand: roh'); };
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
  $('#scaleCancel').onclick = () => $('#scaleDlg').hidden = true;
  $('#scaleOk').onclick = applyScale;
  $('#scaleReal').onkeydown = e => { if (e.key === 'Enter') applyScale(); };
  $('#scaleRatio').onkeydown = e => { if (e.key === 'Enter') applyScale(); };
  // Doppelklick auf Mass-/Masslinie → eigenes Mass eintragen
  $('#pages').addEventListener('dblclick', e => {
    const id = e.target.getAttribute && e.target.getAttribute('data-id'); if (!id) return;
    const wrap = e.target.closest('.pagewrap'); if (!wrap) return; const pv = pageViews.find(p => p.num === +wrap.dataset.n);
    const a = findAnno(pv.num, +id); if (!a) return;
    if (a.type === 'edit') { openEditEdit(pv, a, false); return; }   // bestehende Edit-Stelle erneut bearbeiten
    if (a.type === 'text') { openTextAnnoEdit(pv, a); return; }       // Text-Annotation bearbeiten
    if (a.type !== 'dim' && a.type !== 'measure') return;
    const v = prompt('Mass-Beschriftung (leer = automatisch gemessen):', a.text || lenLabel(a)); if (v === null) return;
    pushUndo(); a.text = v.trim() || ''; drawAnnos(pv);
  });
  $('#rotL').onclick = () => rotatePage(-90); $('#rotR').onclick = () => rotatePage(90);
  $('#delSel').onclick = deleteSel;
  // Schnellzugriff unten links
  $('#qRotL').onclick = () => rotatePage(-90); $('#qRotR').onclick = () => rotatePage(90);
  $('#qFree').onclick = () => { const p = $('#freeRot'); p.hidden = !p.hidden; if (!p.hidden) { const n = curPage(); $('#freeRotRange').value = viewRot[n] || 0; $('#freeRotVal').textContent = ((viewRot[n] || 0) > 0 ? '+' : '') + (viewRot[n] || 0) + '°'; } };
  $('#freeRotRange').oninput = e => setFreeRot(+e.target.value);
  $('#freeRotReset').onclick = () => { $('#freeRotRange').value = 0; setFreeRot(0); };
  $('#qPrev').onclick = () => gotoPage(Math.max(1, curPage() - 1));
  $('#qNext').onclick = () => gotoPage(Math.min(pdfDoc ? pdfDoc.numPages : 1, curPage() + 1));
  // Rechtsklick-Menü
  $('#pages').addEventListener('contextmenu', e => {
    if (!pdfDoc) return; e.preventDefault();
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
  const setColor = c => { style.color = c; $('#colorDot').style.background = c; $('#colorPick').value = c; if (sel) { const a = findAnno(sel.num, sel.id); if (a) { pushUndo(); a.color = c; pageViews.forEach(drawAnnos); } } };
  $('#colorPick').oninput = e => setColor(e.target.value);
  $('#btnColor').onclick = e => { e.stopPropagation(); const p = $('#palettePop'); p.hidden = !p.hidden; };
  $$('#palettePop .pal-row button').forEach(b => b.onclick = () => { setColor(b.dataset.c); $('#palettePop').hidden = true; });
  $('#palCustom').onclick = () => { $('#palettePop').hidden = true; $('#colorPick').click(); };
  document.addEventListener('pointerdown', e => { if (!e.target.closest('.swatch-wrap')) $('#palettePop').hidden = true; }, true);
  $('#widthSel').onchange = e => { style.width = +e.target.value; if (sel) { const a = findAnno(sel.num, sel.id); if (a && a.width != null) { pushUndo(); a.width = style.width; pageViews.forEach(drawAnnos); } } };
  // Schwebende Auswahl-Leiste
  const selA = () => sel && findAnno(sel.num, sel.id), selPv = () => pageViews.find(p => p.num === sel.num);
  let sbColorPushed = false;
  $('#sbColor').addEventListener('pointerdown', () => { sbColorPushed = false; });
  $('#sbColor').addEventListener('input', e => { const a = selA(); if (!a) return; if (!sbColorPushed) { pushUndo(); sbColorPushed = true; } a.color = e.target.value; style.color = e.target.value; $('#colorDot').style.background = e.target.value; $('#sbColorDot').style.background = e.target.value; const pv = selPv(); if (pv) drawAnnos(pv); });
  $$('#sbWidths button').forEach(btn => btn.onclick = () => { const a = selA(); if (!a || a.width == null) return; pushUndo(); a.width = +btn.dataset.w; style.width = +btn.dataset.w; $('#widthSel').value = btn.dataset.w; const pv = selPv(); if (pv) drawAnnos(pv); });
  $('#sbSize').onchange = e => { const a = selA(); if (!a) return; pushUndo(); a.size = +e.target.value; style.size = +e.target.value; $('#sizeSel').value = e.target.value; const pv = selPv(); if (pv) drawAnnos(pv); };
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
  $('#sizeSel').onchange = e => { style.size = +e.target.value; if (sel) { const a = findAnno(sel.num, sel.id); if (a && a.type === 'text') { pushUndo(); a.size = style.size; pageViews.forEach(drawAnnos); } } };
  $('#colorDot').style.background = style.color;

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
    if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); openPicker(); }
    else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    else if (mod && e.key.toLowerCase() === 'p') { e.preventDefault(); printDoc(); }
    else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    else if (mod && (e.key === '+' || e.key === '=')) { e.preventDefault(); zoomStep(.15); }
    else if (mod && e.key === '-') { e.preventDefault(); zoomStep(-.15); }
    else if (mod && e.key === '0') { e.preventDefault(); setZoom('auto'); }
    else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); if (sel) { const pv = pageViews.find(p => p.num === sel.num); if (pv) duplicateAnno(pv, sel.id); } }
    else if (mod && e.key.toLowerCase() === 'c' && sel && tool !== 'textsel') { e.preventDefault(); copySel(); }
    else if (mod && e.key.toLowerCase() === 'v' && clipAnno && tool !== 'textsel') { e.preventDefault(); pasteAnno(); }
    else if (sel && e.key.startsWith('Arrow')) { e.preventDefault(); nudgeSel(e.key, e.shiftKey ? 10 : 1); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { if (sel) { e.preventDefault(); deleteSel(); } }
    else if (e.key === 'Escape') { hideCtx(); sel = null; pageViews.forEach(drawAnnos); }
    else if (e.key === '?' || (e.shiftKey && e.key === '/')) { e.preventDefault(); toggleShortcuts(); }
    else if (!mod && e.key.toLowerCase() === 'v') setTool('select');
    else if (!mod && e.key.toLowerCase() === 't') setTool('text');
    else if (!mod && e.key.toLowerCase() === 's') setTool('pen');
    else if (!mod && e.key.toLowerCase() === 'l') setTool('line');
    else if (!mod && e.key.toLowerCase() === 'p') setTool('arrow');
    else if (!mod && e.key.toLowerCase() === 'r') setTool('rect');
    else if (!mod && e.key.toLowerCase() === 'o') setTool('oval');
    else if (!mod && e.key.toLowerCase() === 'm') setTool('measure');
    else if (!mod && e.key.toLowerCase() === 'h') setTool('highlight');
    else if (!mod && e.key.toLowerCase() === 'k') setTool('note');
  });
}
wire();

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
// App installieren (PWA) – Button erscheint, sobald der Browser die Installation anbietet (nur über https)
let deferredInstall = null;
const installBtn = document.getElementById('btnInstall');
const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
if (installBtn && !standalone) installBtn.hidden = false;                 // sichtbar zeigen (außer schon installiert)
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; if (installBtn && !standalone) installBtn.hidden = false; });
window.addEventListener('appinstalled', () => { if (installBtn) installBtn.hidden = true; deferredInstall = null; toast('App installiert ✓'); });
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
