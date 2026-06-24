/* Submit PDF — Landingpage Logik */

// === Adresse der App ===
// Aktuell die Live-App auf GitHub Pages. Wenn submitpdf.ch die App selbst hostet,
// hier z. B. auf '/app/' oder 'https://submitpdf.ch/app/' ändern.
const APP_URL = 'https://yanickgerber1997.github.io/SubmitOne/pdf/';

// === Funktionen (eine pro Kachel) ===
// Demo-Video später so ergänzen:  video: 'videos/anmerken.mp4'
// (Datei in den Ordner site/videos/ legen). Ohne 'video' erscheint ein Platzhalter.
const FEATURES = [
  { ic: '✎', t: 'Anmerken', d: 'Stift, Linien, Pfeile, Rechtecke, Ovale — frei über den Plan zeichnen.', vid: 'videos/anmerken.mp4' },
  { ic: '🔤', t: 'Text bearbeiten', d: 'Vorhandene Zahlen/Texte überschreiben oder verschieben — die alte Stelle wird sauber abgedeckt.', vid: 'videos/text-bearbeiten.mp4' },
  { ic: '📏', t: 'Messen mit Massstab', d: 'Massstab setzen (1:100) oder kalibrieren — und reale Längen direkt im Plan messen.', vid: 'videos/messen.mp4' },
  { ic: '↔️', t: 'Masslinien', d: 'Masslinien ziehen, automatisch oder selbst beschriftet.', vid: 'videos/masslinien.mp4' },
  { ic: '✍️', t: 'Unterschreiben', d: 'Unterschrift einmal erstellen, speichern und überall platzieren.', vid: 'videos/unterschrift.mp4' },
  { ic: '🗂️', t: 'Seiten verwalten', d: 'Seiten löschen, sortieren, drehen — und mehrere PDFs zusammenführen.', vid: 'videos/seiten.mp4' },
  { ic: '🧭', t: 'Frei drehen', d: 'Den Plan stufenlos drehen, um ihn nach Norden auszurichten.', vid: 'videos/drehen.mp4' },
  { ic: '📋', t: 'Text auswählen & kopieren', d: 'Echten Text aus dem PDF markieren und herauskopieren.', vid: 'videos/text-kopieren.mp4' },
  { ic: '▥', t: 'Zwei nebeneinander', d: 'Zwei Dokumente gleichzeitig öffnen und vergleichen — Seite an Seite.', vid: 'videos/split.mp4' },
  { ic: '📁', t: 'Ordner & Speichern', d: 'Ordner durchsuchen, PDFs öffnen und mit Strg+S direkt zurückspeichern.', vid: 'videos/ordner.mp4' },
  { ic: '🔍', t: 'Gestochen scharf', d: 'Pläne pixelgenau gerendert — auch feine Linien und kleine Zahlen.', vid: 'videos/schaerfe.mp4' },
  { ic: '⚡', t: 'Offline & installierbar', d: 'Als App installieren, läuft auch ohne Internet.', vid: 'videos/offline.mp4' },
  { ic: '✉️', t: 'Per E-Mail senden', d: 'Markiertes PDF direkt mit vorbereitetem Betreff & Empfänger versenden.', vid: 'videos/senden.mp4' },
  { ic: '📷', t: 'Foto vom Plan', d: 'Am Handy ein Foto teilen, anmerken und sofort weitergeben.', vid: 'videos/foto.mp4' },
];

// App-Links setzen
document.querySelectorAll('[data-app]').forEach(a => a.setAttribute('href', APP_URL));
const frame = document.querySelector('[data-app-embed]');
if (frame) frame.setAttribute('src', APP_URL + '?embed=1');

// Kacheln bauen
const tiles = document.getElementById('tiles');
FEATURES.forEach(f => {
  const el = document.createElement('article'); el.className = 'tile reveal';
  // Hat die Funktion schon ein Video? Dann abspielen, sonst Platzhalter.
  const media = f.vid && f.has
    ? `<video src="${f.vid}" controls preload="metadata" playsinline></video>`
    : `<div class="tile-ph"><div class="tile-play">▶</div><small>Demo-Video folgt</small></div>`;
  el.innerHTML = `<div class="tile-media">${media}</div>
    <div class="tile-body"><div class="tile-ic">${f.ic}</div><h3>${f.t}</h3><p>${f.d}</p></div>`;
  tiles.appendChild(el);
});

// Scroll-Reveal
const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }, { threshold: .12 });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));

// Nav-Schatten beim Scrollen
const nav = document.getElementById('nav');
addEventListener('scroll', () => nav.classList.toggle('scrolled', scrollY > 10), { passive: true });

// Jahr
document.getElementById('year').textContent = new Date().getFullYear();
