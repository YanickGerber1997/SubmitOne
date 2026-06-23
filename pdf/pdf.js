'use strict';
/* Submit PDF — Phase 2a: Viewer + Annotationen (SVG-Overlay), Drehen 90°, Kommentare, echtes Speichern (pdf-lib). */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const SVGNS = 'http://www.w3.org/2000/svg';
const PV = '3.11.174';
const CDN = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PV}/build`;
const PDFLIB = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';

let pdfjs = null, pdfDoc = null, curBytes = null, docName = 'dokument.pdf';
let zoom = 'auto', pageViews = [], renderTok = 0;
let annos = {};            // {pageNum: [anno]}
let pageRot = {};          // {pageNum: 0/90/180/270}
let tool = 'select';
let style = { color: '#b4502f', width: 2.5, size: 16 };   // Standard: Rost (gut sichtbar auf Plänen)
let penTidy = true;        // Freihand-Skizzen automatisch zu sauberen Formen aufräumen
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
async function openFiles(files) {
  files = [...files]; const pdf = files.find(f => /pdf$/i.test(f.name) || f.type === 'application/pdf'); const img = files.find(isImg);
  try { status('Lade PDF-Engine …'); await loadPdfJs(); } catch (_) { status(''); toast('PDF-Engine nicht ladbar (einmal Internet nötig).'); return; }
  try {
    if (pdf) { curBytes = new Uint8Array(await pdf.arrayBuffer()); docName = pdf.name; }
    else if (img) { await imageToPdfBytes(img); }
    else { status(''); return; }
    annos = {}; pageRot = {}; undoStack = []; sel = null; await loadDoc(curBytes.slice());
  } catch (e) { status(''); console.error(e); toast('Datei konnte nicht geöffnet werden.'); }
}
// Bild → 1-seitige PDF (so läuft alles weitere wie bei einer PDF: anmerken, speichern, senden)
async function imageToPdfBytes(file) {
  status('Bild wird vorbereitet …');
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
  curBytes = new Uint8Array(await doc.save());
  docName = file.name.replace(/\.[^.]+$/, '') + '.pdf';
}
async function loadDoc(bytes) {
  status('Öffne Dokument …');
  pdfDoc = await pdfjs.getDocument({ data: bytes }).promise;
  $('#drop').classList.add('hide'); $('#toolbar').hidden = false; $('#quickbar').hidden = false;
  $('#btnSave').disabled = false; $('#btnSend').disabled = false; $('#docName').textContent = docName;
  document.title = docName.replace(/\.pdf$/i, '') + ' – Submit PDF';
  await renderAll(); buildThumbs(); status(''); refreshComments();
}

/* ---------- Rendern ---------- */
function fitScale(pw) { const avail = $('#pages').clientWidth - 60; return Math.max(.2, Math.min(3, avail / pw)); }
async function renderAll() {
  const tok = ++renderTok; const host = $('#pages'); host.innerHTML = ''; pageViews = [];
  const dpr = window.devicePixelRatio || 1;
  for (let n = 1; n <= pdfDoc.numPages; n++) {
    if (tok !== renderTok) return;
    const page = await pdfDoc.getPage(n);
    const vp1 = page.getViewport({ scale: 1 }); const pw = vp1.width, ph = vp1.height;
    const scale = (zoom === 'auto') ? fitScale(pw) : zoom;
    const vp = page.getViewport({ scale });
    const rot = ((pageRot[n] || 0) % 360 + 360) % 360, swap = (rot === 90 || rot === 270);
    const dispW = vp.width, dispH = vp.height;
    const outer = document.createElement('div'); outer.className = 'pagewrap'; outer.dataset.n = n;
    outer.style.width = (swap ? dispH : dispW) + 'px'; outer.style.height = (swap ? dispW : dispH) + 'px';
    const inner = document.createElement('div'); inner.style.position = 'absolute'; inner.style.left = '50%'; inner.style.top = '50%';
    inner.style.width = dispW + 'px'; inner.style.height = dispH + 'px';
    inner.style.transform = `translate(-50%,-50%) rotate(${rot}deg)`;
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(dispW * dpr); canvas.height = Math.floor(dispH * dpr);
    canvas.style.width = dispW + 'px'; canvas.style.height = dispH + 'px';
    const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
    const svg = svgEl('svg', { class: 'anno', viewBox: `0 0 ${pw} ${ph}`, preserveAspectRatio: 'none' });
    svg.style.width = dispW + 'px'; svg.style.height = dispH + 'px';
    inner.appendChild(canvas); inner.appendChild(svg); outer.appendChild(inner); host.appendChild(outer);
    const pv = { num: n, wrap: outer, inner, canvas, svg, scale, pageW: pw, pageH: ph, rot };
    pageViews.push(pv);
    await page.render({ canvasContext: ctx, viewport: page.getViewport({ scale }) }).promise;
    drawAnnos(pv); bindPageEvents(pv);
  }
  applyToolCursor(); updateZoomLabel(); updatePageInd();
}
let reflowTimer = null; function reflow() { clearTimeout(reflowTimer); reflowTimer = setTimeout(() => { if (pdfDoc) renderAll(); }, 140); }

async function buildThumbs() {
  const host = $('#thumbs'); host.innerHTML = '';
  for (let n = 1; n <= pdfDoc.numPages; n++) {
    const page = await pdfDoc.getPage(n); const vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: 200 / vp1.width, rotation: pageRot[n] || 0 });
    const btn = document.createElement('button'); btn.className = 'thumb'; btn.dataset.n = n;
    const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height; btn.appendChild(c);
    const tn = document.createElement('span'); tn.className = 'tn'; tn.textContent = n; btn.appendChild(tn);
    btn.onclick = () => gotoPage(n); host.appendChild(btn);
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  }
}
function gotoPage(n) { const v = pageViews.find(p => p.num === n); if (v) v.wrap.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
function curPage() { const host = $('#pages'), mid = host.scrollTop + host.clientHeight / 2; let cur = 1; for (const v of pageViews) if (v.wrap.offsetTop <= mid) cur = v.num; return cur; }
function updatePageInd() { if (!pdfDoc) return; const cur = curPage(); $('#pageInd').textContent = cur + ' / ' + pdfDoc.numPages; $$('.thumb', $('#thumbs')).forEach(t => t.classList.toggle('active', +t.dataset.n === cur)); }

/* ---------- Zoom ---------- */
function curScale() { return (zoom === 'auto') ? (pageViews[0] ? pageViews[0].scale : 1) : zoom; }
function updateZoomLabel() { const pct = Math.round(((zoom === 'auto') ? curScale() : zoom) * 100); $('#zoomVal').innerHTML = pct + '&nbsp;%'; $('#zoomVal').classList.toggle('on', zoom === 'auto'); }
function setZoom(z) { zoom = z; if (pdfDoc) renderAll(); }
function zoomStep(d) { const c = curScale(); setZoom(Math.max(.25, Math.min(3, Math.round((c + d) * 100) / 100))); }

/* ---------- Annotationen rendern ---------- */
function getAnnos(n) { return annos[n] || (annos[n] = []); }
function findAnno(n, id) { return (annos[n] || []).find(a => a.id === id); }
function drawAnnos(pv) {
  const svg = pv.svg; svg.innerHTML = '';
  for (const a of getAnnos(pv.num)) drawOne(svg, a, pv);
  if (sel && sel.num === pv.num) drawSelection(svg, findAnno(pv.num, sel.id), pv);
}
function strokeAttrs(a) { return { stroke: a.color, 'stroke-width': a.width, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }; }
function drawOne(svg, a, pv) {
  let el, hit;
  if (a.type === 'line' || a.type === 'arrow' || a.type === 'measure') {
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
  } else if (a.type === 'note') {
    const g = svgEl('g', { class: 'note-pin', 'data-id': a.id });
    g.appendChild(svgEl('path', { d: `M${a.x} ${a.y} l13 0 l0 9 l-7 0 l-4 4 l0 -4 l-2 0 z`, fill: a.color, stroke: '#fff', 'stroke-width': 1 }));
    svg.appendChild(g); el = g;
  }
  return el;
}
function drawArrowHead(svg, a) {
  const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1), L = Math.max(7, a.width * 3.2);
  for (const s of [ang + 2.7, ang - 2.7]) svg.appendChild(svgEl('line', { x1: a.x2, y1: a.y2, x2: a.x2 + Math.cos(s) * L, y2: a.y2 + Math.sin(s) * L, ...strokeAttrs(a) }));
}
function lenLabel(a, pv) {
  const dpt = Math.hypot(a.x2 - a.x1, a.y2 - a.y1);              // Länge in PDF-Punkten
  return Math.round(dpt / 72 * 25.4) + ' mm';                    // Phase 2a: ohne Massstab (mm auf Papier); echter Massstab folgt in 2b
}
function drawMeasureLabel(svg, a, pv) {
  const mx = (a.x1 + a.x2) / 2, my = (a.y1 + a.y2) / 2;
  const t = svgEl('text', { x: mx + 4, y: my - 4, fill: a.color, 'font-size': 12 }); t.textContent = a.label || lenLabel(a, pv); svg.appendChild(t);
}

/* ---------- Auswahl / Griffe ---------- */
function bbox(a) {
  if (a.type === 'rect' || a.type === 'oval') return { x: Math.min(a.x, a.x + a.w), y: Math.min(a.y, a.y + a.h), w: Math.abs(a.w), h: Math.abs(a.h) };
  if (a.type === 'line' || a.type === 'arrow' || a.type === 'measure') return { x: Math.min(a.x1, a.x2), y: Math.min(a.y1, a.y2), w: Math.abs(a.x2 - a.x1), h: Math.abs(a.y2 - a.y1) };
  if (a.type === 'pen') { const xs = a.pts.map(p => p[0]), ys = a.pts.map(p => p[1]); return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }; }
  if (a.type === 'text') return { x: a.x, y: a.y, w: (a.w || 120), h: a.size * (a.text.split('\n').length) * 1.3 };
  if (a.type === 'note') return { x: a.x, y: a.y, w: 14, h: 14 };
  return { x: 0, y: 0, w: 0, h: 0 };
}
function drawSelection(svg, a, pv) {
  if (!a) return; const b = bbox(a); const pad = 3;
  svg.appendChild(svgEl('rect', { class: 'sel-out', x: b.x - pad, y: b.y - pad, width: b.w + 2 * pad, height: b.h + 2 * pad }));
  const hs = 4 / pv.scale;
  const pts = (a.type === 'line' || a.type === 'arrow' || a.type === 'measure')
    ? [['p1', a.x1, a.y1], ['p2', a.x2, a.y2]]
    : [['nw', b.x, b.y], ['ne', b.x + b.w, b.y], ['sw', b.x, b.y + b.h], ['se', b.x + b.w, b.y + b.h]];
  for (const [name, x, y] of pts) svg.appendChild(svgEl('rect', { class: 'handle', x: x - hs, y: y - hs, width: hs * 2, height: hs * 2, 'data-h': name }));
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
function translateAnno(a, o, dx, dy) {
  if (a.type === 'line' || a.type === 'arrow' || a.type === 'measure') { a.x1 = o.x1 + dx; a.y1 = o.y1 + dy; a.x2 = o.x2 + dx; a.y2 = o.y2 + dy; }
  else if (a.type === 'pen') a.pts = o.pts.map(p => [p[0] + dx, p[1] + dy]);
  else { a.x = o.x + dx; a.y = o.y + dy; }
}
function startResize(pv, e, h) {
  const a = findAnno(pv.num, sel.id); if (!a) return; pushUndo(); const orig = JSON.parse(JSON.stringify(a));
  const move = ev => {
    const q = evtToPage(pv, ev);
    if (a.type === 'line' || a.type === 'arrow' || a.type === 'measure') { if (h === 'p1') { a.x1 = q.x; a.y1 = q.y; } else { a.x2 = q.x; a.y2 = q.y; } }
    else { let x = orig.x, y = orig.y, w = orig.w, h2 = orig.h; if (orig.type === 'rect' || orig.type === 'oval') { const x2 = x + w, y2 = y + h2; let nx = x, ny = y, nx2 = x2, ny2 = y2; if (h.includes('w')) nx = q.x; if (h.includes('e')) nx2 = q.x; if (h.includes('n')) ny = q.y; if (h.includes('s')) ny2 = q.y; a.x = nx; a.y = ny; a.w = nx2 - nx; a.h = ny2 - ny; } }
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
    else { a.x2 = q.x; a.y2 = q.y; }
    drawAnnos(pv);
  };
  const up = () => {
    document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
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
  renderAll(); buildThumbs();
}

/* ---------- Undo / Löschen ---------- */
function snapshot() { return JSON.stringify({ annos, pageRot }); }
function pushUndo() { undoStack.push(snapshot()); if (undoStack.length > 60) undoStack.shift(); $('#btnUndo').disabled = false; }
function undo() { if (!undoStack.length) return; const s = JSON.parse(undoStack.pop()); annos = s.annos; pageRot = s.pageRot; sel = null; $('#btnUndo').disabled = !undoStack.length; renderAll(); buildThumbs(); refreshComments(); }
function saveState() { /* Platzhalter für Autosave-Hook */ }
function deleteSel() { if (!sel) return; const arr = annos[sel.num]; if (!arr) return; const i = arr.findIndex(a => a.id === sel.id); if (i < 0) return; pushUndo(); arr.splice(i, 1); sel = null; pageViews.forEach(drawAnnos); refreshComments(); }

/* ---------- Werkzeug umschalten ---------- */
function setTool(t) {
  tool = t; $$('.tool[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t)); applyToolCursor();
}
function applyToolCursor() {
  pageViews.forEach(pv => { pv.wrap.classList.toggle('tool-draw', ['pen', 'line', 'arrow', 'rect', 'oval', 'measure', 'note'].includes(tool)); pv.wrap.classList.toggle('tool-text', tool === 'text'); });
}

/* ---------- Speichern / PDF erzeugen (pdf-lib) ---------- */
function downloadBytes(bytes, name) { const blob = new Blob([bytes], { type: 'application/pdf' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1500); }
function outName() { return docName.replace(/\.pdf$/i, '') + '-submit.pdf'; }
async function buildPdfBytes() {
  const lib = await loadPdfLib();
  {
    const { PDFDocument, rgb, StandardFonts, degrees } = lib;
    const doc = await PDFDocument.load(curBytes.slice());
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const pages = doc.getPages();
    for (let n = 1; n <= pages.length; n++) {
      const pg = pages[n - 1]; const { height: PH } = pg.getSize();
      const Y = y => PH - y;                         // pdf.js (oben) → pdf-lib (unten)
      for (const a of (annos[n] || [])) {
        const col = hexToRgb(a.color), c = rgb(col.r, col.g, col.b), w = a.width || 2;
        if (a.type === 'line' || a.type === 'arrow' || a.type === 'measure') {
          pg.drawLine({ start: { x: a.x1, y: Y(a.y1) }, end: { x: a.x2, y: Y(a.y2) }, thickness: w, color: c });
          if (a.type === 'arrow') { const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1), L = Math.max(7, w * 3.2); for (const s of [ang + 2.7, ang - 2.7]) pg.drawLine({ start: { x: a.x2, y: Y(a.y2) }, end: { x: a.x2 + Math.cos(s) * L, y: Y(a.y2 + Math.sin(s) * L) }, thickness: w, color: c }); }
          if (a.type === 'measure') { const mx = (a.x1 + a.x2) / 2, my = (a.y1 + a.y2) / 2; pg.drawText(a.label || lenLabel(a), { x: mx + 4, y: Y(my) + 4, size: 11, font, color: c }); }
        } else if (a.type === 'rect') { const x = Math.min(a.x, a.x + a.w), y = Math.min(a.y, a.y + a.h), W = Math.abs(a.w), H = Math.abs(a.h); pg.drawRectangle({ x, y: Y(y + H), width: W, height: H, borderColor: c, borderWidth: w }); }
        else if (a.type === 'oval') { pg.drawEllipse({ x: a.x + a.w / 2, y: Y(a.y + a.h / 2), xScale: Math.abs(a.w / 2), yScale: Math.abs(a.h / 2), borderColor: c, borderWidth: w }); }
        else if (a.type === 'pen') { for (let i = 1; i < a.pts.length; i++) pg.drawLine({ start: { x: a.pts[i - 1][0], y: Y(a.pts[i - 1][1]) }, end: { x: a.pts[i][0], y: Y(a.pts[i][1]) }, thickness: w, color: c }); }
        else if (a.type === 'text') { a.text.split('\n').forEach((ln, i) => pg.drawText(ln, { x: a.x, y: Y(a.y + a.size + i * a.size * 1.25), size: a.size, font, color: c })); }
        else if (a.type === 'note' && a.text) { pg.drawRectangle({ x: a.x, y: Y(a.y + 11), width: 13, height: 11, color: c }); }
      }
      if (pageRot[n]) pg.setRotation(degrees(pageRot[n]));
    }
    return await doc.save();
  }
}
async function save() {
  if (!curBytes) return; status('Speichere …');
  try { const out = await buildPdfBytes(); downloadBytes(out, outName()); status(''); toast('Gespeichert ✓'); }
  catch (e) { status(''); console.error(e); toast('Speichern fehlgeschlagen (Internet für Speicher-Bibliothek nötig?).'); }
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
  add('Öffnen', '📂', () => $('#fileInput').click());
  add('Speichern (PDF)', '💾', save);
  m.hidden = false;
  const w = m.offsetWidth, h = m.offsetHeight;
  m.style.left = Math.min(x, window.innerWidth - w - 8) + 'px';
  m.style.top = Math.min(y, window.innerHeight - h - 8) + 'px';
}
function duplicateAnno(pv, id) { const a = findAnno(pv.num, id); if (!a) return; pushUndo(); const c = JSON.parse(JSON.stringify(a)); c.id = nextId++; translateAnno(c, JSON.parse(JSON.stringify(c)), 12, 12); getAnnos(pv.num).push(c); sel = { num: pv.num, id: c.id }; drawAnnos(pv); refreshComments(); }

/* ---------- Verdrahtung ---------- */
function wire() {
  $('#btnOpen').onclick = () => $('#fileInput').click();
  $('#dropOpen').onclick = () => $('#fileInput').click();
  $('#fileInput').onchange = e => { openFiles(e.target.files); e.target.value = ''; };
  $('#btnSave').onclick = save;
  $('#btnSend').onclick = openMail;
  $('#mSend').onclick = doSend;
  $('#mCancel').onclick = () => $('#mailDlg').hidden = true;
  $('#btnUndo').onclick = undo;
  $('#zoomIn').onclick = () => zoomStep(.15); $('#zoomOut').onclick = () => zoomStep(-.15); $('#zoomVal').onclick = () => setZoom('auto');
  $('#pages').addEventListener('scroll', updatePageInd, { passive: true });
  window.addEventListener('resize', () => { if (zoom === 'auto') reflow(); });
  $$('.tool[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
  $('#penTidyBtn').onclick = () => { penTidy = !penTidy; $('#penTidyBtn').classList.toggle('on', penTidy); toast(penTidy ? 'Skizze aufräumen: an' : 'Freihand: roh'); };
  $('#rotL').onclick = () => rotatePage(-90); $('#rotR').onclick = () => rotatePage(90);
  $('#delSel').onclick = deleteSel;
  // Schnellzugriff unten links
  $('#qRotL').onclick = () => rotatePage(-90); $('#qRotR').onclick = () => rotatePage(90);
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
  $('#btnComments').onclick = () => { const open = $('#work').classList.toggle('comm-open'); $('#comments').hidden = !open; $('#btnComments').classList.toggle('on', open); };
  const cp = $('#colorPick'); cp.oninput = () => { style.color = cp.value; $('#colorDot').style.background = cp.value; if (sel) { const a = findAnno(sel.num, sel.id); if (a) { pushUndo(); a.color = cp.value; pageViews.forEach(drawAnnos); } } };
  $('#widthSel').onchange = e => { style.width = +e.target.value; if (sel) { const a = findAnno(sel.num, sel.id); if (a && a.width != null) { pushUndo(); a.width = style.width; pageViews.forEach(drawAnnos); } } };
  $('#sizeSel').onchange = e => { style.size = +e.target.value; if (sel) { const a = findAnno(sel.num, sel.id); if (a && a.type === 'text') { pushUndo(); a.size = style.size; pageViews.forEach(drawAnnos); } } };
  $('#colorDot').style.background = style.color;

  // Drag & Drop
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach(ev => window.addEventListener(ev, e => { e.preventDefault(); if ([...(e.dataTransfer?.items || [])].some(i => i.kind === 'file')) drop.classList.add('over'); }));
  window.addEventListener('dragleave', e => { if (!e.relatedTarget) drop.classList.remove('over'); });
  window.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer?.files; if (f && f.length) openFiles(f); });

  // Tastatur
  document.addEventListener('keydown', e => {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) { if (e.key === 'Escape') e.target.blur(); return; }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); $('#fileInput').click(); }
    else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    else if (mod && (e.key === '+' || e.key === '=')) { e.preventDefault(); zoomStep(.15); }
    else if (mod && e.key === '-') { e.preventDefault(); zoomStep(-.15); }
    else if (mod && e.key === '0') { e.preventDefault(); setZoom('auto'); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { if (sel) { e.preventDefault(); deleteSel(); } }
    else if (e.key === 'Escape') { hideCtx(); sel = null; pageViews.forEach(drawAnnos); }
    else if (!mod && e.key.toLowerCase() === 'v') setTool('select');
    else if (!mod && e.key.toLowerCase() === 't') setTool('text');
    else if (!mod && e.key.toLowerCase() === 's') setTool('pen');
    else if (!mod && e.key.toLowerCase() === 'l') setTool('line');
    else if (!mod && e.key.toLowerCase() === 'p') setTool('arrow');
    else if (!mod && e.key.toLowerCase() === 'r') setTool('rect');
    else if (!mod && e.key.toLowerCase() === 'o') setTool('oval');
    else if (!mod && e.key.toLowerCase() === 'k') setTool('note');
  });
}
wire();

/* ---------- Startbildschirm (Logo zeichnet sich, Schrift buchstabenweise) ---------- */
(function splashIntro() {
  const word = $('#splashWord'), sp = $('#splash'); if (!sp) return;
  if (word) {
    const add = (txt, cls, base) => [...txt].forEach((ch, i) => { const s = document.createElement('span'); s.className = 'sl ' + cls; s.textContent = ch; s.style.animationDelay = (1.5 + (base + i) * 0.06) + 's'; word.appendChild(s); });
    add('SUBMIT', 'd', 0);
    const gap = document.createElement('span'); gap.style.width = '14px'; word.appendChild(gap);
    add('PDF', 'g', 7);
  }
  let done = false;
  const dismiss = () => { if (done) return; done = true; sp.classList.add('hide'); document.removeEventListener('pointerdown', dismiss); document.removeEventListener('keydown', dismiss); setTimeout(() => sp.remove(), 650); };
  setTimeout(dismiss, 3000);
  setTimeout(() => { document.addEventListener('pointerdown', dismiss); document.addEventListener('keydown', dismiss); }, 400);   // erst nach kurzer Zeit per Klick überspringbar
})();

/* ---------- Geräte-Anbindung (PWA) ---------- */
async function loadSharedFile() {
  try {
    const c = await caches.open('submitpdf-v1'); const r = await c.match('shared-file'); if (!r) return;
    await c.delete('shared-file');
    const blob = await r.blob(); const name = decodeURIComponent(r.headers.get('X-Filename') || 'geteilt');
    const ext = (blob.type.includes('pdf')) ? '.pdf' : (blob.type.split('/')[1] ? '.' + blob.type.split('/')[1] : '');
    openFiles([new File([blob], /\.\w+$/.test(name) ? name : name + ext, { type: blob.type })]);
  } catch (_) {}
}
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
// „Öffnen mit Submit PDF" (Desktop, installierte App)
if ('launchQueue' in window) {
  window.launchQueue.setConsumer(async params => {
    if (params && params.files && params.files.length) { const files = await Promise.all(params.files.map(h => h.getFile())); openFiles(files); }
  });
}
// Geteilte Datei vom Handy (Teilen-Ziel)
if (new URLSearchParams(location.search).get('shared')) { window.addEventListener('load', () => setTimeout(loadSharedFile, 300)); }
