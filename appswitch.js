/* SubmitOne – App-Umschalter: ein Widget in allen drei Apps (Suite / Submit Paper / Submit PDF),
   ein Tap wechselt zwischen ihnen. Eigenständig (kein Einfluss auf die App), relative Links,
   verschiebbare + einklappbare Pille, Position wird gemerkt. */
(function () {
  if (window.__soAppSwitch) return; window.__soAppSwitch = 1;

  var p = location.pathname;
  var cur = /\/pdf(\/|$)/.test(p) ? 'pdf' : /\/write(\/|$)/.test(p) ? 'paper' : 'one';
  var base = (cur === 'one') ? './' : '../';   // Wurzel relativ zur aktuellen App
  var APPS = [
    { k: 'one',   name: 'SubmitOne',    short: 'One',   href: base,            ico: '▦' },
    { k: 'paper', name: 'Submit Paper', short: 'Paper', href: base + 'write/', ico: '📝' },
    { k: 'pdf',   name: 'Submit PDF',   short: 'PDF',   href: base + 'pdf/',   ico: '📐' }
  ];

  var css = [
    '.so-sw{position:fixed;z-index:2147483000;left:50%;bottom:14px;transform:translateX(-50%);',
    'font:600 12px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;-webkit-user-select:none;user-select:none;',
    'display:flex;align-items:stretch;gap:2px;padding:3px;border-radius:999px;',
    'background:rgba(20,26,38,.82);box-shadow:0 4px 18px rgba(0,0,0,.28);backdrop-filter:blur(6px);',
    'opacity:.55;transition:opacity .15s ease}',
    '.so-sw:hover{opacity:1}',
    '.so-sw.drag{opacity:1;cursor:grabbing}',
    '.so-sw a,.so-sw button{all:unset;box-sizing:border-box;display:flex;align-items:center;gap:6px;',
    'padding:7px 12px;border-radius:999px;color:#e8edf6;cursor:pointer;white-space:nowrap;transition:background .12s}',
    '.so-sw a:hover{background:rgba(255,255,255,.12)}',
    '.so-sw a.cur{background:#4f7a3c;color:#fff;cursor:default}',
    '.so-sw .so-ico{font-size:14px;line-height:1}',
    '.so-sw .so-grip{cursor:grab;padding:7px 6px;color:#9aa6b8;font-size:13px;opacity:.8}',
    '.so-sw .so-min{padding:7px 9px;color:#9aa6b8;cursor:pointer;font-size:13px}',
    '.so-sw .so-min:hover{background:rgba(255,255,255,.12);color:#fff}',
    '.so-sw.mini a.other,.so-sw.mini .so-lbl{display:none}',
    '.so-sw.mini a.cur{background:transparent;color:#e8edf6;cursor:pointer}',
    '@media(max-width:640px){.so-sw .so-lbl{display:none}}'
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
  try {
    var s = JSON.parse(localStorage.getItem('so_appsw') || '{}');
    if (s.mini) bar.classList.add('mini');
    if (s.t || s.l) { bar.style.left = s.l || ''; bar.style.top = s.t || ''; bar.style.bottom = s.b || ''; bar.style.transform = s.tr || 'none'; }
  } catch (_) { }

  // Verschieben (Griff)
  var dx = 0, dy = 0, dragging = false;
  function down(e) { dragging = true; bar.classList.add('drag'); var r = bar.getBoundingClientRect(); var pt = e.touches ? e.touches[0] : e; dx = pt.clientX - r.left; dy = pt.clientY - r.top; e.preventDefault(); document.addEventListener('pointermove', move); document.addEventListener('pointerup', up); }
  function move(e) { if (!dragging) return; var pt = e.touches ? e.touches[0] : e; var x = Math.max(4, Math.min(window.innerWidth - bar.offsetWidth - 4, pt.clientX - dx)); var y = Math.max(4, Math.min(window.innerHeight - bar.offsetHeight - 4, pt.clientY - dy)); bar.style.left = x + 'px'; bar.style.top = y + 'px'; bar.style.bottom = 'auto'; bar.style.transform = 'none'; }
  function up() { dragging = false; bar.classList.remove('drag'); document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); saveState(); }
  grip.addEventListener('pointerdown', down);
})();
