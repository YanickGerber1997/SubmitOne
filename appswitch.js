/* SubmitOne – App-Umschalter: ein Widget in allen drei Apps (Suite / Submit Paper / Submit PDF),
   ein Tap wechselt zwischen ihnen. Eigenständig (kein Einfluss auf die App), relative Links,
   verschiebbare + einklappbare Pille, Position wird gemerkt. */
(function () {
  if (window.__soAppSwitch) return; window.__soAppSwitch = 1;

  /* Wo die Apps liegen, ist lokal und auf dem Server verschieden:

       lokal    SubmitOne an der Wurzel, daneben write/  pdf/  submit/zeit/
       Server   Verkaufsseite an der Wurzel, daneben one/ paper/ pdf/ zeit/

     Deshalb darf das Paket es vorgeben. Steht window.SO_APPS nicht da,
     gilt der bisherige Weg — der Arbeitsordner laeuft unveraendert weiter. */
  var L = window.SO_APPS || null;

  var p = location.pathname;
  var cur = /\/(pdf)(\/|$)/.test(p) ? 'pdf'
          : /\/(write|paper)(\/|$)/.test(p) ? 'paper'
          : /\/zeit(\/|$)/.test(p) ? 'zeit'
          : 'one';

  var base = L ? L.basis : ((cur === 'one') ? './' : '../');   // Wurzel relativ zur aktuellen App
  var APPS = [
    { k: 'one',   name: 'SubmitOne',    short: 'One',   href: base + (L ? L.one   : ''),         ico: '▦' },
    { k: 'paper', name: 'Submit Paper', short: 'Paper', href: base + (L ? L.paper : 'write/'),   ico: '📝' },
    { k: 'pdf',   name: 'Submit PDF',   short: 'PDF',   href: base + (L ? L.pdf   : 'pdf/'),     ico: '📐' },
    { k: 'zeit',  name: 'SubZeit',      short: 'Zeit',  href: base + (L ? L.zeit  : 'submit/zeit/'), ico: '⏱' }
  ];

  /* Unten rechts statt oben rechts: Oben liegen in SubmitOne die Knopfleiste
     und in Paper/PDF die Werkzeugleisten - dort verdeckte die Pille Knoepfe.
     Unten ist in allen vier Apps Platz. Verschieben und Merken bleiben.

     "Unten ist Platz" stimmte allerdings nicht ueberall: In SubmitOne liegt
     dort eine 22px hohe Statuszeile, und auf dem Handy die 60px hohe
     Reiterleiste - die Pille sass beidem genau auf den Knoepfen. Statt hier
     die Masse anderer Apps nachzufuehren (die sich aendern, ohne dass diese
     Datei es erfaehrt), sagt jede App selbst, wie viel unten belegt ist:

         :root { --so-sw-abstand: 26px; }

     Ohne Angabe bleibt es beim alten Wert. Der Sicherheitsabstand des
     Geraets (Home-Balken auf dem iPhone) kommt immer dazu. */
  var css = [
    '.so-sw{position:fixed;z-index:2147483000;right:16px;',
    'bottom:calc(16px + env(safe-area-inset-bottom, 0px) + var(--so-sw-abstand, 0px));',
    'font:600 12px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;-webkit-user-select:none;user-select:none;',
    'display:flex;align-items:stretch;gap:2px;padding:3px;border-radius:999px;',
    'background:rgba(20,26,38,.94);box-shadow:0 4px 18px rgba(0,0,0,.35);backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,.14);',
    'opacity:.96;transition:opacity .15s ease}',
    '.so-sw:hover{opacity:1}',
    '.so-sw.drag{opacity:1;cursor:grabbing}',
    '.so-sw a,.so-sw button{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:6px;',
    'padding:7px 12px;border-radius:999px;color:#e8edf6;cursor:pointer;white-space:nowrap;transition:background .12s}',
    '.so-sw a:hover{background:rgba(255,255,255,.12)}',
    // Stand bis zum 15.08.2026 auf #4f7a3c - dem Marken-Gruen aus der Zeit
    // vor Violett. Es war der letzte Ort, an dem es noch vorkam.
    '.so-sw a.cur{background:#7132e3;color:#fff;cursor:default}',
    '.so-sw .so-ico{font-size:14px;line-height:1}',
    '.so-sw .so-grip{cursor:grab;padding:7px 6px;color:#9aa6b8;font-size:13px;opacity:.8}',
    '.so-sw .so-min{padding:7px 9px;color:#9aa6b8;cursor:pointer;font-size:13px}',
    '.so-sw .so-min:hover{background:rgba(255,255,255,.12);color:#fff}',
    // Mit dem Daumen getroffen wird nicht auf 28px. Gilt fuer alle vier Apps.
    '@media (pointer: coarse){.so-sw a,.so-sw button{min-height:44px}',
    '.so-sw .so-grip,.so-sw .so-min{min-height:44px;align-items:center;display:flex}}',
    '.so-sw.mini a.other,.so-sw.mini .so-lbl{display:none}',
    '.so-sw.mini a.cur{background:transparent;color:#e8edf6;cursor:pointer}',
    '@media(max-width:640px){.so-sw .so-lbl{display:none}}',
    '@media(display-mode:window-controls-overlay){.so-sw{top:calc(env(titlebar-area-height,34px) + 6px)}}'   // randlose App: Pille unter die Fensterleiste, nicht über die Fenster-Knöpfe'
  ].join('');
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  var bar = document.createElement('div'); bar.className = 'so-sw';
  var grip = document.createElement('span'); grip.className = 'so-grip'; grip.title = 'Verschieben'; grip.textContent = '⠿'; bar.appendChild(grip);
  APPS.forEach(function (a) {
    var el = document.createElement('a'); el.href = a.href; el.className = (a.k === cur ? 'cur' : 'other');
    el.title = (a.k === cur ? 'Aktuell: ' : 'Wechseln zu ') + a.name;
    el.innerHTML = '<span class="so-ico">' + a.ico + '</span><span class="so-lbl">' + a.short + '</span>';
    if (a.k === cur) el.addEventListener('click', function (e) { e.preventDefault(); bar.classList.toggle('mini'); saveState(); });
    bar.appendChild(el);
  });
  var mn = document.createElement('span'); mn.className = 'so-min'; mn.title = 'Ein-/ausklappen'; mn.textContent = '–';
  mn.addEventListener('click', function () { bar.classList.toggle('mini'); saveState(); });
  bar.appendChild(mn);
  document.body.appendChild(bar);

  // Position + Zustand merken
  function saveState() {
    try { localStorage.setItem('so_appsw', JSON.stringify({ l: bar.style.left, t: bar.style.top, b: bar.style.bottom, tr: bar.style.transform, mini: bar.classList.contains('mini') })); } catch (_) { }
  }
  /* Eingeklappt beginnen: als kleine Marke stoert sie nirgends, ein Tipp
     darauf klappt sie auf. Wer sie einmal offen laesst, bekommt sie offen. */
  try {
    var roh = localStorage.getItem('so_appsw');
    var s = JSON.parse(roh || '{}');
    if (roh === null || s.mini) bar.classList.add('mini');
    if (s.t || s.l) { bar.style.left = s.l || ''; bar.style.top = s.t || ''; bar.style.bottom = s.b || ''; bar.style.transform = s.tr || 'none'; }
  } catch (_) { bar.classList.add('mini'); }

  // Verschieben (Griff)
  var dx = 0, dy = 0, dragging = false;
  function down(e) { dragging = true; bar.classList.add('drag'); var r = bar.getBoundingClientRect(); var pt = e.touches ? e.touches[0] : e; dx = pt.clientX - r.left; dy = pt.clientY - r.top; e.preventDefault(); document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); }
  function move(e) { if (!dragging) return; var pt = e.touches ? e.touches[0] : e; var x = Math.max(4, Math.min(window.innerWidth - bar.offsetWidth - 4, pt.clientX - dx)); var y = Math.max(4, Math.min(window.innerHeight - bar.offsetHeight - 4, pt.clientY - dy)); bar.style.left = x + 'px'; bar.style.top = y + 'px'; bar.style.bottom = 'auto'; bar.style.transform = 'none'; }
  function up() { dragging = false; bar.classList.remove('drag'); document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); saveState(); }
  grip.addEventListener('pointerdown', down);
})();
