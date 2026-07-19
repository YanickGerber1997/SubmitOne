/* ============================================================================
   SubmitOne · Brücke zwischen den drei Apps (One ↔ Paper ↔ PDF)
   ----------------------------------------------------------------------------
   EIN gemeinsamer Übergabeweg statt kopiertem Code in jeder App.

   Warum IndexedDB statt localStorage:
   localStorage fasst rund 5 MB und speichert Text. Grosse Übergaben (Termin-
   programm über Jahre, bildlastige Pläne) liefen darin auf „Export zu gross".
   IndexedDB hat diese Grenze nicht. localStorage bleibt als Rückfallebene –
   damit ältere Übergaben, die noch dort liegen, weiterhin ankommen.

   Nutzung
     Senden:    SubmitBridge.sendToPaper({ titel, pages, quelle })
     Empfangen: await SubmitBridge.receive()      // liefert die Nutzlast oder null
   ============================================================================ */
(function () {
  'use strict';

  var KEY = 'submitpaper_import';        // Schlüssel – identisch in beiden Ebenen
  var DBN = 'submitone_bridge', STORE = 'payload', VER = 1;

  /* --- App-Erkennung: die drei Apps liegen im selben Ursprung, aber verschieden tief --- */
  function basePath() {
    var p = location.pathname;
    return (/\/(pdf|write)\//.test(p)) ? '../' : './';
  }
  function appName() {
    var p = location.pathname;
    if (p.indexOf('/pdf/') >= 0) return 'pdf';
    if (p.indexOf('/write/') >= 0) return 'paper';
    return 'one';
  }

  /* --- IndexedDB, klein gehalten: ein Speicher, ein Eintrag --- */
  function open() {
    return new Promise(function (res, rej) {
      if (!window.indexedDB) { rej(new Error('kein IndexedDB')); return; }
      var r = indexedDB.open(DBN, VER);
      r.onupgradeneeded = function () { try { r.result.createObjectStore(STORE); } catch (_) {} };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error || new Error('IndexedDB nicht verfügbar')); };
    });
  }
  function tx(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(STORE, mode), st = t.objectStore(STORE), rq = fn(st);
        t.oncomplete = function () { db.close(); res(rq && rq.result); };
        t.onerror = function () { db.close(); rej(t.error); };
      });
    });
  }
  function put(data) { return tx('readwrite', function (st) { return st.put(data, KEY); }); }
  function get() { return tx('readonly', function (st) { return st.get(KEY); }); }
  function del() { return tx('readwrite', function (st) { return st.delete(KEY); }); }

  /* --- Senden: erst IndexedDB, bei Fehlschlag localStorage, dann Paper öffnen --- */
  function sendToPaper(payload, opts) {
    opts = opts || {};
    var data = {
      titel: payload.titel || 'Dokument',
      pages: payload.pages || [],
      quelle: Object.assign({ app: appName(), zeit: new Date().toISOString() }, payload.quelle || {}),
      ts: Date.now(),
    };
    var ziel = basePath() + 'write/index.html?import=1';
    var los = function () { if (opts.navigate === false) return true; location.href = ziel; return true; };

    return put(data).then(los).catch(function () {
      try { localStorage.setItem(KEY, JSON.stringify(data)); return los(); }
      catch (e) {
        if (typeof opts.onError === 'function') opts.onError(e);
        else if (window.toast) window.toast('Übergabe zu gross – bitte weniger Inhalt wählen.', 'warn');
        return false;
      }
    });
  }

  /* --- Empfangen (in Paper): IndexedDB zuerst, dann localStorage; danach aufräumen --- */
  function receive() {
    return get().then(function (d) {
      if (d) return del().then(function () { return d; }, function () { return d; });
      return null;
    }).catch(function () { return null; }).then(function (d) {
      if (d) return d;
      try {
        var raw = localStorage.getItem(KEY);
        if (!raw) return null;
        localStorage.removeItem(KEY);
        return JSON.parse(raw);
      } catch (_) { return null; }
    });
  }

  /* --- Zählt die Seiten einer Nutzlast (Seitenumbrüche mitgerechnet) --- */
  function countPages(pages) {
    return (pages || []).reduce(function (s, p) {
      return s + 1 + (((p.html || '').match(/class="pagebreak"/g) || []).length);
    }, 0);
  }

  window.SubmitBridge = {
    sendToPaper: sendToPaper,
    receive: receive,
    countPages: countPages,
    basePath: basePath,
    appName: appName,
    KEY: KEY,
  };
})();
