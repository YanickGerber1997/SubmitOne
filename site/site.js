/* Submit PDF — Landingpage Logik */

// === Adresse der App ===
// Aktuell die Live-App auf GitHub Pages. Wenn submitpdf.ch die App selbst hostet,
// hier z. B. auf '/app/' oder 'https://submitpdf.ch/app/' ändern.
const APP_URL = 'https://yanickgerber1997.github.io/SubmitOne/pdf/';

// === Funktionen (eine pro Kachel) ===
// Demo-Video später so ergänzen:  video: 'videos/anmerken.mp4'
// (Datei in den Ordner site/videos/ legen). Ohne 'video' erscheint ein Platzhalter.
const CATS = [
  ['anmerken', 'Anmerken & Markieren'],
  ['messen', 'Messen'],
  ['text', 'Text'],
  ['seiten', 'Seiten & Dokumente'],
  ['profi', 'Profi & Teilen'],
];
const FEATURES = [
  { cat: 'anmerken', ic: '✎', t: 'Anmerken', d: 'Stift, Linien, Pfeile, Rechtecke, Ovale — frei über den Plan zeichnen.', vid: 'videos/anmerken.mp4' },
  { cat: 'messen', ic: '📏', t: 'Messen mit Massstab', d: 'Massstab setzen (1:100) oder kalibrieren — und reale Längen direkt im Plan messen.', vid: 'videos/messen.mp4' },
  { cat: 'messen', ic: '↔️', t: 'Masslinien', d: 'Masslinien ziehen, automatisch oder selbst beschriftet.', vid: 'videos/masslinien.mp4' },
  { cat: 'text', ic: '🔤', t: 'Text bearbeiten', d: 'Vorhandene Zahlen/Texte überschreiben oder verschieben — die alte Stelle wird sauber abgedeckt.', vid: 'videos/text-bearbeiten.mp4' },
  { cat: 'text', ic: '📋', t: 'Text auswählen & kopieren', d: 'Echten Text aus dem PDF markieren und herauskopieren.', vid: 'videos/text-kopieren.mp4' },
  { cat: 'seiten', ic: '🗂️', t: 'Seiten verwalten', d: 'Seiten löschen, sortieren, drehen — und mehrere PDFs zusammenführen.', vid: 'videos/seiten.mp4' },
  { cat: 'seiten', ic: '🧭', t: 'Frei drehen', d: 'Den Plan stufenlos drehen, um ihn nach Norden auszurichten.', vid: 'videos/drehen.mp4' },
  { cat: 'seiten', ic: '▥', t: 'Zwei nebeneinander', d: 'Zwei Dokumente gleichzeitig öffnen und vergleichen — Seite an Seite.', vid: 'videos/split.mp4' },
  { cat: 'seiten', ic: '📁', t: 'Ordner & Speichern', d: 'Ordner durchsuchen, PDFs öffnen und mit Strg+S direkt zurückspeichern.', vid: 'videos/ordner.mp4' },
  { cat: 'profi', ic: '✍️', t: 'Unterschreiben', d: 'Unterschrift einmal erstellen, speichern und überall platzieren.', vid: 'videos/unterschrift.mp4' },
  { cat: 'profi', ic: '🔍', t: 'Gestochen scharf', d: 'Pläne pixelgenau gerendert — auch feine Linien und kleine Zahlen.', vid: 'videos/schaerfe.mp4' },
  { cat: 'profi', ic: '⚡', t: 'Offline & installierbar', d: 'Als App installieren, läuft auch ohne Internet.', vid: 'videos/offline.mp4' },
  { cat: 'profi', ic: '✉️', t: 'Per E-Mail senden', d: 'Markiertes PDF direkt mit vorbereitetem Betreff & Empfänger versenden.', vid: 'videos/senden.mp4' },
  { cat: 'profi', ic: '📷', t: 'Foto vom Plan', d: 'Am Handy ein Foto teilen, anmerken und sofort weitergeben.', vid: 'videos/foto.mp4' },
];

// App-Links setzen
document.querySelectorAll('[data-app]').forEach(a => a.setAttribute('href', APP_URL));
const frame = document.querySelector('[data-app-embed]');
if (frame) frame.setAttribute('src', APP_URL + '?embed=1');

// Kacheln nach Gruppen bauen
const tiles = document.getElementById('tiles');
function tileMedia(f) {
  // Eigenes Video (im Programm aufgenommen) abspielen, sonst Platzhalter
  if (f.vid && f.has) return `<video src="${f.vid}" controls preload="metadata" playsinline></video>`;
  return `<span class="tile-ghost">${f.ic}</span><div class="tile-ph"><div class="tile-play">▶</div><small>Kurzvideo folgt</small></div>`;
}
let n = 0;
CATS.forEach(([key, label]) => {
  const fs = FEATURES.filter(f => f.cat === key); if (!fs.length) return;
  const group = document.createElement('div'); group.className = 'tiles-group';
  group.innerHTML = `<h3 class="tiles-cat reveal"><span>${label}</span></h3>`;
  const grid = document.createElement('div'); grid.className = 'tiles';
  fs.forEach(f => {
    n++; const el = document.createElement('article'); el.className = 'tile reveal';
    el.innerHTML = `<div class="tile-media"><span class="tile-n">${String(n).padStart(2, '0')}</span>${tileMedia(f)}</div>
      <div class="tile-body"><div class="tile-ic">${f.ic}</div><h3>${f.t}</h3><p>${f.d}</p></div>`;
    grid.appendChild(el);
  });
  group.appendChild(grid); tiles.appendChild(group);
});

// Scroll-Reveal
const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }, { threshold: .12 });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));

// Nav-Schatten beim Scrollen
const nav = document.getElementById('nav');
addEventListener('scroll', () => nav.classList.toggle('scrolled', scrollY > 10), { passive: true });

// Jahr
document.getElementById('year').textContent = new Date().getFullYear();
