/* =====================================================================
 * MANAJEMEN KONSTRUKSI v1 — SHEET SYNC FIX
 * Fase F: Diagnostic + reset tools untuk Apps Script deployment
 * ===================================================================== */

(function(){
  if (window._sheetSyncFixInstalled) return;
  window._sheetSyncFixInstalled = true;

  function _log(label, value, ok){
    var icon = ok === true ? '✅' : ok === false ? '❌' : 'ℹ';
    console.log(icon + ' ' + label + ': ' + value);
  }

  window.SheetSyncFix = {

    /* ═══════════════════════════════════════════════════════════
       1. DIAGNOSE
       ═══════════════════════════════════════════════════════════ */
    diagnose: function(){
      console.log('%c══════ SHEET SYNC DIAGNOSTIC ══════',
        'color:#2f81f7;font-weight:bold;font-size:13px');

      var url = (typeof SET !== 'undefined' && SET.sheetUrl) ? SET.sheetUrl : '';

      _log('URL tersimpan', url || '(kosong)', url ? null : false);

      var valid = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url);
      _log('Format valid', valid ? 'ya' : 'TIDAK — harus /macros/s/.../exec', valid);
      _log('Panjang URL', url.length + ' karakter');
      _log('Berakhir /exec', url.endsWith('/exec') ? 'ya' : 'TIDAK', url.endsWith('/exec'));
      _log('Mengandung /dev', url.indexOf('/dev') >= 0 ? 'YA — ganti ke /exec' : 'tidak', url.indexOf('/dev') < 0);

      _log('dbVersion', (typeof STATE !== 'undefined' ? STATE.dbVersion : '?'));
      _log('Client ID', (typeof SyncManager !== 'undefined' ? SyncManager.CLIENT_ID : '?'));

      console.log('%c\n── Test koneksi (async) ──', 'color:#f59e0b;font-weight:bold');
      if (typeof SyncManager !== 'undefined' && SyncManager.status){
        SyncManager.status().then(function(s){
          if (s.ok){
            console.log('%c✅ Server OK', 'color:#22c55e;font-weight:bold');
            console.log('   Locked:', s.locked);
            console.log('   Holder:', s.holder || '—');
            console.log('   dbVersion:', s.dbVersion);
          } else {
            console.log('%c❌ Server error: ' + s.code, 'color:#dc2626;font-weight:bold');
            console.log('   Message:', s.message);
            if (s.hint) console.log('   Hint:', s.hint);
            console.log('\n   🔧 Fix: lihat SheetSyncFix.guide()');
          }
        }).catch(function(e){
          console.log('%c❌ Network error', 'color:#dc2626;font-weight:bold', e.message);
        });
      } else {
        console.log('⚠ SyncManager tidak tersedia');
      }
    },

    /* ═══════════════════════════════════════════════════════════
       2. GUIDE — panduan fix
       ═══════════════════════════════════════════════════════════ */
    guide: function(){
      console.log('%c══════ PANDUAN FIX SHEET SYNC ══════',
        'color:#f59e0b;font-weight:bold;font-size:13px');
      console.log('');
      console.log('%cLANGKAH 1 — Redeploy Apps Script:', 'color:#7cb3ff;font-weight:bold');
      console.log('  1. Buka spreadsheet → Extensions → Apps Script');
      console.log('  2. Deploy → Manage deployments');
      console.log('  3. Klik "+ Create new deployment" (atau edit yang ada)');
      console.log('  4. Type: "Web app"');
      console.log('  5. Execute as: "Me"');
      console.log('  6. Who has access: "Anyone"');
      console.log('  7. Deploy → Authorize → COPY URL /exec');
      console.log('');
      console.log('%cLANGKAH 2 — Update URL di app:', 'color:#7cb3ff;font-weight:bold');
      console.log('  1. Buka tab ⚙ Pengaturan');
      console.log('  2. Paste URL baru di field URL Web App');
      console.log('  3. Klik Simpan');
      console.log('');
      console.log('%cLANGKAH 3 — Test:', 'color:#7cb3ff;font-weight:bold');
      console.log('  SheetSyncFix.test()');
      console.log('');
      console.log('%cShortcut cepat:', 'color:#22c55e;font-weight:bold');
      console.log('  SheetSyncFix.setUrl("https://script.google.com/macros/s/xxx/exec")');
    },

    /* ═══════════════════════════════════════════════════════════
       3. SET URL — shortcut dari Console
       ═══════════════════════════════════════════════════════════ */
    setUrl: function(url){
      if (!url || !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)){
        console.error('❌ Format URL tidak valid');
        console.log('   Harus: https://script.google.com/macros/s/{ID}/exec');
        return false;
      }
      if (typeof SET === 'undefined' || typeof saveSET !== 'function'){
        console.error('❌ SET atau saveSET tidak tersedia');
        return false;
      }
      SET.sheetUrl = url;
      saveSET();
      console.log('%c✅ URL disimpan', 'color:#22c55e;font-weight:bold');
      console.log('   ' + url);
      /* Reset circuit breaker */
      if (typeof resetEndpointCircuit === 'function'){
        resetEndpointCircuit();
        console.log('   Circuit breaker di-reset');
      }
      return true;
    },

    /* ═══════════════════════════════════════════════════════════
       4. CLEAR URL — hapus URL lama
       ═══════════════════════════════════════════════════════════ */
    clearUrl: function(){
      if (typeof SET === 'undefined' || typeof saveSET !== 'function'){
        console.error('❌ SET atau saveSET tidak tersedia');
        return false;
      }
      SET.sheetUrl = '';
      saveSET();
      console.log('✅ URL dibersihkan');
      return true;
    },

    /* ═══════════════════════════════════════════════════════════
       5. TEST — quick koneksi test
       ═══════════════════════════════════════════════════════════ */
    test: function(){
      if (typeof SyncManager === 'undefined' || !SyncManager.status){
        console.error('❌ SyncManager tidak tersedia');
        return;
      }
      console.log('Testing koneksi…');
      SyncManager.status().then(function(s){
        if (s.ok){
          console.log('%c✅ OK — server merespons', 'color:#22c55e;font-weight:bold');
          console.log('   dbVersion:', s.dbVersion);
          console.log('   Locked:', s.locked);
        } else {
          console.log('%c❌ Gagal: ' + s.code, 'color:#dc2626;font-weight:bold');
          console.log('   ' + s.message);
        }
      });
    },

    /* ═══════════════════════════════════════════════════════════
       6. INFO — ringkas state
       ═══════════════════════════════════════════════════════════ */
    info: function(){
      var url = (typeof SET !== 'undefined' && SET.sheetUrl) ? SET.sheetUrl : '(kosong)';
      console.table({
        'URL': url,
        'Client ID': (typeof SyncManager !== 'undefined' ? SyncManager.CLIENT_ID : '—'),
        'dbVersion': (typeof STATE !== 'undefined' ? STATE.dbVersion : '—'),
        'Circuit Breaker': (typeof ENDPOINT_HEALTH !== 'undefined' && ENDPOINT_HEALTH.dead ? 'OPEN (blocked)' : 'closed'),
        'URL valid': /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)
      });
    }
  };

  console.log('%c[SheetSyncFix.js] ✅ Diagnostic tools installed (try SheetSyncFix.guide())',
    'color:#f59e0b;font-weight:bold;font-size:13px');
})();
