/* ============================================================
   Submit Write — write.js  (Vanilla, dateibasiert, .gdoc)
   "Schreiben ohne Ablenkung."
   ============================================================ */
'use strict';
const WRITE_VERSION = 'v2';
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
    if (raw && raw.docs) return raw;
  } catch (_) {}
  return { docs: {}, order: [], currentId: null };
}
function persistLib() { try { localStorage.setItem(LS_LIB, JSON.stringify(lib)); } catch (_) {} }

function newDocObject(partial = {}) {
  const t = nowIso();
  return Object.assign({
    id: uid(), titel: 'Unbenanntes Dokument', html: '',
    einstellungen: { schriftart: "'Inter', sans-serif", schriftgroesse: 16, zeilenabstand: 1.7 },
    meta: { erstellt: t, geaendert: t, autor: 'Yanick Gerber', version: 1 },
    folder: 'dokumente', fav: false, trashed: false
  }, partial);
}

/* ============================================================
   Dokument laden / anlegen / wechseln
   ============================================================ */
function openDoc(id) {
  const d = lib.docs[id]; if (!d) return;
  doc = d; fileHandle = null;
  editor.innerHTML = d.html || '';
  titleEl.value = d.titel || 'Unbenanntes Dokument';
  applySettings();
  lib.currentId = id; persistLib();
  setDirty(false); refreshAll(); renderList();
  editor.focus();
}
function createDoc(partial) {
  const d = newDocObject(partial);
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
}

/* ============================================================
   Speichern (Bibliothek = Autosave; Datei = .gdoc)
   ============================================================ */
function setDirty(v) {
  dirty = v;
  saveState.classList.toggle('dirty', v);
  $('.lbl', saveState).textContent = v ? 'Nicht gespeichert' : 'Gespeichert';
}
function captureDoc() {
  if (!doc) return;
  doc.html = editor.innerHTML;
  doc.titel = (titleEl.value || 'Unbenanntes Dokument').trim() || 'Unbenanntes Dokument';
  doc.meta.geaendert = nowIso();
}
function autosave() {
  if (!doc) return;
  captureDoc(); persistLib(); setDirty(false); renderList();
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
    app: 'Submit Write ' + WRITE_VERSION, exportiert: nowIso(),
    meta: { ...doc.meta, titel: doc.titel },
    inhalt: { html: doc.html },
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
    } catch (e) { if (e && e.name === 'AbortError') return; }
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
  if (data.format !== 'gdoc' || !data.inhalt) { toast('Keine .gdoc-Datei'); return; }
  const d = newDocObject({
    titel: (data.meta && data.meta.titel) || 'Importiertes Dokument',
    html: data.inhalt.html || '',
    einstellungen: Object.assign(newDocObject().einstellungen, data.einstellungen || {}),
    meta: Object.assign(newDocObject().meta, data.meta || {})
  });
  lib.docs[d.id] = d; lib.order.unshift(d.id); persistLib();
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
  const url = prompt('Link-Adresse (URL):', 'https://');
  if (!url) return;
  editor.focus(); document.execCommand('createLink', false, url);
  const sel = document.getSelection();
  if (sel && sel.anchorNode) { const a = sel.anchorNode.parentElement?.closest('a'); if (a) a.target = '_blank'; }
  afterEdit();
}

function afterEdit() { scheduleSave(); refreshAll(); }

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
  if (['h1', 'h2', 'h3'].includes(block)) $('#selBlock').value = block;
  else $('#selBlock').value = 'p';
}

/* ============================================================
   Statistik / Gliederung / Seiten
   ============================================================ */
function refreshAll() { updateStats(); updateOutline(); syncToolbar(); }

function updateStats() {
  const text = (editor.innerText || '').replace(/ /g, ' ');
  const words = (text.match(/[^\s]+/g) || []).length;
  const chars = text.replace(/\s/g, '').length;
  const pars = $$('p,h1,h2,h3,li,blockquote', editor).filter(e => e.innerText.trim()).length || (text.trim() ? 1 : 0);
  const pages = Math.max(1, Math.ceil((editor.scrollHeight || 1) / PAGE_INNER_PX));
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
  else if (a === '4') { const c = newDocObject({ ...JSON.parse(JSON.stringify(d)), id: uid(), titel: d.titel + ' (Kopie)' }); lib.docs[c.id] = c; lib.order.unshift(c.id); }
  else if (a === '5') { delete lib.docs[id]; lib.order = lib.order.filter(x => x !== id); if (lib.currentId === id) { lib.currentId = lib.order[0] || null; lib.currentId ? openDoc(lib.currentId) : createDoc(); } }
  persistLib(); renderList();
}

/* ---------- Vorlagen ---------- */
const TEMPLATES = {
  brief: { titel: 'Brief', html: '<p style="text-align:right">Yanick Gerber<br>Musterstrasse 1<br>3000 Bern</p><p><br></p><p>Empfänger<br>Adresse<br>PLZ Ort</p><p><br></p><p style="text-align:right">Bern, ' + new Date().toLocaleDateString('de-CH') + '</p><h2>Betreff</h2><p>Sehr geehrte Damen und Herren,</p><p><br></p><p>Freundliche Grüsse<br>Yanick Gerber</p>' },
  rechnung: { titel: 'Rechnung', html: '<h1>Rechnung</h1><p><b>Rechnungsnummer:</b> 2026-001<br><b>Datum:</b> ' + new Date().toLocaleDateString('de-CH') + '</p><table><tbody><tr><th>Position</th><th>Menge</th><th>Preis</th><th>Total</th></tr><tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr></tbody></table><p style="text-align:right"><b>Total CHF&nbsp;&nbsp;</b></p>' },
  angebot: { titel: 'Angebot', html: '<h1>Angebot</h1><p>Sehr geehrte Damen und Herren,</p><p>gerne unterbreiten wir Ihnen folgendes Angebot:</p><h2>Leistungen</h2><ul><li>Leistung 1</li><li>Leistung 2</li></ul><h2>Konditionen</h2><p>Gültig bis: </p>' },
  projektplan: { titel: 'Projektplan', html: '<h1>Projektplan</h1><h2>Ziel</h2><p></p><h2>Meilensteine</h2><ol><li>Start</li><li>Umsetzung</li><li>Abschluss</li></ol><h2>Risiken</h2><p></p>' },
  protokoll: { titel: 'Meeting-Protokoll', html: '<h1>Protokoll</h1><p><b>Datum:</b> ' + new Date().toLocaleDateString('de-CH') + '<br><b>Teilnehmende:</b> </p><h2>Traktanden</h2><ol><li></li></ol><h2>Beschlüsse</h2><ul><li></li></ul><h2>Pendenzen</h2><ul><li></li></ul>' },
  lebenslauf: { titel: 'Lebenslauf', html: '<h1>Lebenslauf</h1><h2>Persönliches</h2><p>Name<br>Adresse<br>E-Mail</p><h2>Berufserfahrung</h2><p></p><h2>Ausbildung</h2><p></p><h2>Kenntnisse</h2><ul><li></li></ul>' }
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
  $('#selFont').addEventListener('change', e => { doc.einstellungen.schriftart = e.target.value; editor.style.fontFamily = e.target.value; scheduleSave(); });
  $('#selSize').addEventListener('change', e => { const px = +e.target.value; if (window.getSelection().isCollapsed) { doc.einstellungen.schriftgroesse = px; editor.style.fontSize = px + 'px'; scheduleSave(); } else setFontSize(px); });
  $('#inkColor').addEventListener('input', e => { document.execCommand('styleWithCSS', false, true); cmd('foreColor', e.target.value); });
  $('#btnLink').addEventListener('click', insertLink);
  $('#btnTable').addEventListener('click', insertTable);
  $('#btnImage').addEventListener('click', () => $('#imgInput').click());
  $('#imgInput').addEventListener('change', e => { insertImageFile(e.target.files[0]); e.target.value = ''; });
  $('#hlColor').addEventListener('input', e => highlight(e.target.value));
  $('#btnClear').addEventListener('click', () => { cmd('removeFormat'); setBlock('p'); });

  // Bilder: Einfügen + Drag&Drop
  editor.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  editor.addEventListener('drop', e => {
    const f = [...(e.dataTransfer.files || [])].find(f => f.type.startsWith('image/'));
    if (f) { e.preventDefault(); insertImageFile(f); }
  });
  editor.addEventListener('paste', e => {
    for (const it of (e.clipboardData?.items || [])) {
      if (it.type.startsWith('image/')) { e.preventDefault(); insertImageFile(it.getAsFile()); return; }
    }
  });
  editor.addEventListener('click', e => {
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
  $('#btnSideCollapse').addEventListener('click', () => appEl.classList.toggle('side-hidden'));
  $('#btnSideShow').addEventListener('click', () => appEl.classList.toggle('side-mobile'));
  $('#btnInspClose').addEventListener('click', () => appEl.classList.remove('insp-open'));

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
    else if (e.key === 'Escape') {
      if (!$('#findbar').hidden) { toggleFind(false); editor.focus(); }
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
  r.onload = () => { editor.focus(); document.execCommand('insertHTML', false, `<img src="${r.result}" alt=""><p><br></p>`); afterEdit(); };
  r.readAsDataURL(file);
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
