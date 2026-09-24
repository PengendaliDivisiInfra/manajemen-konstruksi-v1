/* =====================================================================
 * MANAJEMEN KONSTRUKSI v1 — SHEET SYNC FIX
 * Fase F: Diagnostic tools untuk Apps Script deployment
 * ===================================================================== */
(function(){
  if (window._sheetSyncFixInstalled) return;
  window._sheetSyncFixInstalled = true;

  function _log(label, value, ok){
    var icon = ok === true ? '✅' : ok === false ? '❌' : 'ℹ';
    console.log(icon + ' ' + label + ': ' + value);
  }

  function diagnose(){
    console.log('%c══════ SHEET SYNC DIAGNOSTIC ══════', 'color:#2f81f7;font-weight:bold;font-size:13px');
    var url = (typeof SET !== 'undefined' && SET.sheetUrl) ? SET.sheetUrl : '';
    _log('URL tersimpan', url || '(kosong)', url ? null : false);
    var valid = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url);
    _log('Format valid', valid ? 'ya' : 'TIDAK', valid);
    _log('Berakhir /exec', url.endsWith('/exec') ? 'ya' : 'TIDAK', url.endsWith('/exec'));
    _log('dbVersion', (typeof STATE !== 'undefined' ? STATE.dbVersion : '?'));
    _log('Client ID', (typeof SyncManager !== 'undefined' ? SyncManager.CLIENT_ID : '?'));
    console.log('%c── Test koneksi ──', 'color:#f59e0b;font-weight:bold');
    if (typeof SyncManager !== 'undefined' && SyncManager.status){
      SyncManager.status().then(function(s){
        if (s.ok){
          console.log('%c✅ Server OK', 'color:#22c55e;font-weight:bold');
          console.log('   dbVersion:', s.dbVersion);
        } else {
          console.log('%c❌ Server error: ' + s.code, 'color:#dc2626;font-weight:bold');
          console.log('   ' + s.message);
        }
      }).catch(function(e){
        console.log('%c❌ Network error: ' + e.message, 'color:#dc2626;font-weight:bold');
      });
    }
  }

  function guide(){
    console.log('%c══════ PANDUAN FIX SHEET SYNC ══════', 'color:#f59e0b;font-weight:bold;font-size:13px');
    console.log('');
    console.log('%cLANGKAH 1 — Redeploy Apps Script:', 'color:#7cb3ff;font-weight:bold');
    console.log('  1. Buka spreadsheet → Extensions → Apps Script');
    console.log('  2. Deploy → Manage deployments');
    console.log('  3. Klik "Create new deployment" (atau edit yang ada)');
    console.log('  4. Type: "Web app" | Execute as: "Me" | Who has access: "Anyone"');
    console.log('  5. Deploy → Authorize → COPY URL /exec');
    console.log('');
    console.log('%cLANGKAH 2 — Update URL:', 'color:#7cb3ff;font-weight:bold');
    console.log('  SheetSyncFix.setUrl("https://script.google.com/macros/s/XXX/exec")');
    console.log('');
    console.log('%cLANGKAH 3 — Test:', 'color:#7cb3ff;font-weight:bold');
    console.log('  SheetSyncFix.test()');
  }

  function setUrl(url){
    if (!url || !/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)){
      console.error('❌ Format URL tidak valid');
      return false;
    }
    if (typeof SET === 'undefined' || typeof saveSET !== 'function') return false;
    SET.sheetUrl = url;
    saveSET();
    console.log('✅ URL disimpan:', url);
    if (typeof resetEndpointCircuit === 'function'){
      resetEndpointCircuit();
      console.log('   Circuit breaker di-reset');
    }
    return true;
  }

  function clearUrl(){
    if (typeof SET === 'undefined' || typeof saveSET !== 'function') return false;
    SET.sheetUrl = '';
    saveSET();
    console.log('✅ URL dibersihkan');
    return true;
  }

  function test(){
    if (typeof SyncManager === 'undefined' || !SyncManager.status){
      console.error('❌ SyncManager tidak tersedia');
      return;
    }
    console.log('Testing koneksi…');
    SyncManager.status().then(function(s){
      if (s.ok) console.log('%c✅ OK', 'color:#22c55e;font-weight:bold', s);
      else console.log('%c❌ Gagal: ' + s.code, 'color:#dc2626;font-weight:bold', s.message);
    });
  }

  function info(){
    var url = (typeof SET !== 'undefined' && SET.sheetUrl) ? SET.sheetUrl : '(kosong)';
    console.table({
      'URL': url,
      'Client ID': (typeof SyncManager !== 'undefined' ? SyncManager.CLIENT_ID : '—'),
      'dbVersion': (typeof STATE !== 'undefined' ? STATE.dbVersion : '—'),
      'URL valid': /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(url)
    });
  }

  function rawTest(action, payload){
    var url = (typeof SET !== 'undefined' && SET.sheetUrl) ? SET.sheetUrl : '';
    if (!url){ console.error('❌ URL belum diatur'); return Promise.reject('no url'); }
    console.log('%c🔬 RAW TEST: ' + (action || 'softStatus'), 'color:#a855f7;font-weight:bold');
    var body = JSON.stringify({ action: action || 'softStatus', payload: payload || {} });
    console.log('   Body size:', (body.length / 1024).toFixed(2), 'KB');
    return fetch(url, {
      method: 'POST',
      redirect: 'follow',
      headers: {'Content-Type': 'text/plain;charset=utf-8'},
      body: body
    }).then(function(res){
      console.log('   HTTP Status:', res.status);
      console.log('   Redirected:', res.redirected);
      return res.text();
    }).then(function(text){
      console.log('   Response length:', text.length, 'chars');
      console.log('   Preview:', text.substring(0, 400));
      try {
        var json = JSON.parse(text);
        console.log('%c✅ JSON valid', 'color:#22c55e;font-weight:bold', json);
        return json;
      } catch (e){
        console.warn('%c⚠ Response bukan JSON', 'color:#f59e0b');
        return null;
      }
    });
  }

  window.SheetSyncFix = {
    diagnose: diagnose,
    guide: guide,
    setUrl: setUrl,
    clearUrl: clearUrl,
    test: test,
    info: info,
    rawTest: rawTest
  };

  console.log('%c[SheetSyncFix.js] ✅ Diagnostic tools installed',
    'color:#f59e0b;font-weight:bold;font-size:13px');
})();
