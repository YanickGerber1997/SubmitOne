'use strict';
/* Submit PDF — Phase 1: Viewer (öffnen, anzeigen, Miniaturen, Zoom). Vanilla + pdf.js (CDN). */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const PDFJS_VER = '3.11.174';
const CDN = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VER}/build`;

let pdfjs = null;          // pdf.js Lib
let pdfDoc = null;         // aktuelles geladenes Dokument (pdf.js)
let curBytes = null;       // Original-Bytes (für Speichern später)
let docName = 'dokument.pdf';
let zoom = 'auto';         // 'auto' oder Zahl
let pageViews = [];        // [{num, wrap, canvas, vp}]
let renderTok = 0;         // bricht alte Render-Durchläufe ab

/* ---------- Bibliotheken laden ---------- */
function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('offline:' + src)); document.head.appendChild(s); });
}
async function loadPdfJs() {
  if (pdfjs) return pdfjs;
  if (!window.pdfjsLib) await loadScript(`${CDN}/pdf.min.js`);
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = `${CDN}/pdf.worker.min.js`;
  pdfjs = window.pdfjsLib;
  return pdfjs;
}

/* ---------- Status / Toast ---------- */
function status(msg) { const el = $('#status'); if (!msg) { el.hidden = true; return; } el.textContent = msg; el.hidden = false; }
function toast(msg) { const r = $('#toast-root'); const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; r.appendChild(t); setTimeout(() => t.remove(), 2600); }

/* ---------- Öffnen ---------- */
async function openFiles(files) {
  files = [...files].filter(f => /pdf$/i.test(f.name) || f.type === 'application/pdf');
  if (!files.length) return;
  try {
    status('Lade PDF-Engine …');
    await loadPdfJs();
  } catch (_) { status(''); toast('PDF-Engine nicht ladbar (einmal Internet nötig).'); return; }
  try {
    if (files.length === 1) {
      curBytes = new Uint8Array(await files[0].arrayBuffer());
      docName = files[0].name;
    } else {
      // mehrere PDFs zusammenführen (pdf-lib) – kommt in Phase 3; vorerst nur das erste anzeigen
      curBytes = new Uint8Array(await files[0].arrayBuffer());
      docName = files[0].name;
      toast('Mehrere PDFs: Zusammenführen kommt bald – vorerst wird das erste geöffnet.');
    }
    await loadDoc(curBytes.slice());
  } catch (e) { status(''); console.error(e); toast('PDF konnte nicht gelesen werden.'); }
}

async function loadDoc(bytes) {
  status('Öffne Dokument …');
  pdfDoc = await pdfjs.getDocument({ data: bytes }).promise;
  $('#drop').classList.add('hide');
  $('#btnSave').disabled = false;
  $('#docName').textContent = docName;
  document.title = docName.replace(/\.pdf$/i, '') + ' – Submit PDF';
  await renderAll();
  buildThumbs();
  status('');
}

/* ---------- Rendern ---------- */
function fitScale(page) {
  const avail = $('#pages').clientWidth - 60;        // Innenabstand
  const vp1 = page.getViewport({ scale: 1 });
  return Math.max(.2, Math.min(3, avail / vp1.width));
}
async function renderAll() {
  const tok = ++renderTok;
  const host = $('#pages'); host.innerHTML = ''; pageViews = [];
  const dpr = window.devicePixelRatio || 1;
  for (let n = 1; n <= pdfDoc.numPages; n++) {
    if (tok !== renderTok) return;
    const page = await pdfDoc.getPage(n);
    const scale = (zoom === 'auto') ? fitScale(page) : zoom;
    const vp = page.getViewport({ scale });
    const wrap = document.createElement('div'); wrap.className = 'pagewrap'; wrap.dataset.n = n;
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width * dpr); canvas.height = Math.floor(vp.height * dpr);
    canvas.style.width = Math.floor(vp.width) + 'px'; canvas.style.height = Math.floor(vp.height) + 'px';
    const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
    wrap.appendChild(canvas); host.appendChild(wrap);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    pageViews.push({ num: n, wrap, canvas, vp });
  }
  updateZoomLabel();
  updatePageInd();
}
let reflowTimer = null;
function reflow() { clearTimeout(reflowTimer); reflowTimer = setTimeout(() => { if (pdfDoc) renderAll(); }, 140); }

async function buildThumbs() {
  const host = $('#thumbs'); host.innerHTML = '';
  for (let n = 1; n <= pdfDoc.numPages; n++) {
    const page = await pdfDoc.getPage(n);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = 200 / vp1.width;          // kleine Vorschau
    const vp = page.getViewport({ scale });
    const btn = document.createElement('button'); btn.className = 'thumb'; btn.dataset.n = n;
    const canvas = document.createElement('canvas'); canvas.width = vp.width; canvas.height = vp.height;
    btn.appendChild(canvas);
    const tn = document.createElement('span'); tn.className = 'tn'; tn.textContent = n; btn.appendChild(tn);
    btn.onclick = () => gotoPage(n);
    host.appendChild(btn);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
  }
}

function gotoPage(n) {
  const v = pageViews.find(p => p.num === n); if (!v) return;
  v.wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function updatePageInd() {
  if (!pdfDoc) { $('#pageInd').textContent = ''; return; }
  const host = $('#pages'), mid = host.scrollTop + host.clientHeight / 2;
  let cur = 1;
  for (const v of pageViews) { if (v.wrap.offsetTop <= mid) cur = v.num; }
  $('#pageInd').textContent = cur + ' / ' + pdfDoc.numPages;
  $$('.thumb', $('#thumbs')).forEach(t => t.classList.toggle('active', +t.dataset.n === cur));
}

/* ---------- Zoom ---------- */
function updateZoomLabel() {
  let pct;
  if (zoom === 'auto') { const v = pageViews[0]; pct = v ? Math.round(v.vp.scale * 100) : 100; }
  else pct = Math.round(zoom * 100);
  $('#zoomVal').innerHTML = pct + '&nbsp;%';
  $('#zoomVal').classList.toggle('on', zoom === 'auto');
}
function curScale() { return (zoom === 'auto') ? (pageViews[0] ? pageViews[0].vp.scale : 1) : zoom; }
function setZoom(z) { zoom = z; if (pdfDoc) renderAll(); }
function zoomStep(d) { const cur = curScale(); setZoom(Math.max(.25, Math.min(3, Math.round((cur + d) * 100) / 100))); }

/* ---------- Verdrahtung ---------- */
function wire() {
  $('#btnOpen').onclick = () => $('#fileInput').click();
  $('#dropOpen').onclick = () => $('#fileInput').click();
  $('#fileInput').onchange = e => { openFiles(e.target.files); e.target.value = ''; };
  $('#zoomIn').onclick = () => zoomStep(.15);
  $('#zoomOut').onclick = () => zoomStep(-.15);
  $('#zoomVal').onclick = () => setZoom('auto');
  $('#btnSave').onclick = () => toast('Speichern kommt in Phase 2 (echtes PDF via pdf-lib).');
  $('#pages').addEventListener('scroll', updatePageInd, { passive: true });
  window.addEventListener('resize', () => { if (zoom === 'auto') reflow(); });

  // Drag & Drop überall
  const drop = $('#drop');
  ['dragenter', 'dragover'].forEach(ev => window.addEventListener(ev, e => { e.preventDefault(); if ([...(e.dataTransfer?.items || [])].some(i => i.kind === 'file')) drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => window.addEventListener(ev, e => { e.preventDefault(); if (ev === 'dragleave' && e.relatedTarget) return; drop.classList.remove('over'); }));
  window.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer?.files; if (f && f.length) openFiles(f); });

  // Tastatur
  document.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); $('#fileInput').click(); }
    else if (mod && (e.key === '+' || e.key === '=')) { e.preventDefault(); zoomStep(.15); }
    else if (mod && e.key === '-') { e.preventDefault(); zoomStep(-.15); }
    else if (mod && e.key === '0') { e.preventDefault(); setZoom('auto'); }
  });
}
wire();
