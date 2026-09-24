/* =====================================================================
 * MANAJEMEN KONSTRUKSI v1 — PERFORMANCE CACHE
 * Fase 3E-2: Cache ResourceLoader.load() dengan auto-invalidation
 * Loaded AFTER Schedule.js — independent module
 * ===================================================================== */

(function performanceCacheModule(){
  function bootstrap(attempt){
    attempt = attempt || 0;
    if (typeof ResourceLoader === 'undefined' || typeof ResourceLoader.load !== 'function'){
      if (attempt > 50){
        console.error('[PerformanceCache.js] ResourceLoader tidak siap — menyerah');
        return;
      }
      setTimeout(function(){ bootstrap(attempt + 1); }, 300);
      return;
    }
    install();
  }

  function install(){
    if (window._performanceCacheInstalled) return;
    window._performanceCacheInstalled = true;

    var MAX_ENTRIES = 20;

    var _cache = {};      // key → { data, ts }
    var _order = [];      // simple LRU order (oldest first)
    var _stats = {
      hits: 0,
      misses: 0,
      invalidations: 0,
      lastSig: '',
      installedAt: Date.now()
    };

    /* ═══════════════════════════════════════════════════════════
       SIGNATURE — hash perubahan data yang mempengaruhi hasil
       ═══════════════════════════════════════════════════════════ */
    function _num(v){
      var n = parseFloat(String(v == null ? '' : v).replace(/[^\d.-]/g,''));
      return isFinite(n) ? n : 0;
    }

    function makeSignature(projectId){
      if (typeof DB === 'undefined' || !DB) return projectId + '::empty';

      var wbs  = DB.project_wbs || [];
      var prog = DB.progress || [];
      var pad  = DB.project_ahsp_details || [];
      var res  = DB.master_resources || [];

      /* Aggregat yang sensitif terhadap perubahan */
      var wbsVolSum = 0, wbsVolRapSum = 0;
      var wbsScheduled = 0;
      for (var i = 0; i < wbs.length; i++){
        var w = wbs[i];
        if (w.project_id !== projectId) continue;
        wbsVolSum    += _num(w.volume_rab);
        wbsVolRapSum += _num(w.volume_rap);
        if (w.tgl_mulai_rencana) wbsScheduled++;
      }

      var progVolSum = 0, progCount = 0;
      for (var j = 0; j < prog.length; j++){
        if (prog[j].project_id !== projectId) continue;
        progVolSum += _num(prog[j].volume);
        progCount++;
      }

      var padSum = 0, padCount = 0;
      for (var k = 0; k < pad.length; k++){
        if (pad[k].project_id !== projectId) continue;
        padSum += _num(pad[k].koefisien_master) + _num(pad[k].koefisien_rap)
                + _num(pad[k].harga_rab) + _num(pad[k].harga_rap);
        padCount++;
      }

      var resSig = res.length;

      return [
        projectId,
        wbs.length, wbsVolSum.toFixed(2), wbsVolRapSum.toFixed(2), wbsScheduled,
        progCount, progVolSum.toFixed(2),
        padCount, padSum.toFixed(2),
        resSig
      ].join('|');
    }

    /* ═══════════════════════════════════════════════════════════
       WRAP ResourceLoader.load
       ═══════════════════════════════════════════════════════════ */
    var _origLoad = ResourceLoader.load;

    ResourceLoader.load = function(projectId, opts){
      opts = opts || {};

      var sig = makeSignature(projectId);
      _stats.lastSig = sig;

      var key = sig + '::' +
                (opts.mode || 'rab') + '::' +
                (opts.distribution || 'uniform') + '::' +
                (opts.granularity || 'weekly');

      /* Cache hit */
      if (Object.prototype.hasOwnProperty.call(_cache, key)){
        _stats.hits++;
        /* Update LRU (move to end) */
        var idx = _order.indexOf(key);
        if (idx >= 0){
          _order.splice(idx, 1);
          _order.push(key);
        }
        return _cache[key].data;
      }

      /* Cache miss */
      _stats.misses++;
      var result = _origLoad.call(this, projectId, opts);

      /* Simpan ke cache (hanya kalau sukses) */
      if (result && result.ok){
        if (Object.keys(_cache).length >= MAX_ENTRIES){
          var oldest = _order.shift();
          if (oldest) delete _cache[oldest];
        }
        _cache[key] = { data: result, ts: Date.now() };
        _order.push(key);
      }

      return result;
    };

    /* ═══════════════════════════════════════════════════════════
       PUBLIC API
       ═══════════════════════════════════════════════════════════ */
    window.PerformanceCache = {
      stats: function(){
        var total = _stats.hits + _stats.misses;
        var hitRate = total > 0 ? (_stats.hits / total * 100) : 0;
        return {
          hits: _stats.hits,
          misses: _stats.misses,
          total: total,
          hitRate: +hitRate.toFixed(1),
          entries: Object.keys(_cache).length,
          maxEntries: MAX_ENTRIES,
          invalidations: _stats.invalidations,
          uptime: Math.round((Date.now() - _stats.installedAt) / 1000) + 's'
        };
      },

      clear: function(){
        _cache = {};
        _order = [];
        _stats.hits = 0;
        _stats.misses = 0;
        _stats.invalidations++;
        console.log('[PerformanceCache] Cache cleared');
      },

      invalidate: function(projectId){
        if (!projectId){
          this.clear();
          return;
        }
        var removed = 0;
        Object.keys(_cache).forEach(function(k){
          if (k.indexOf(projectId) === 0){
            delete _cache[k];
            var idx = _order.indexOf(k);
            if (idx >= 0) _order.splice(idx, 1);
            removed++;
          }
        });
        _stats.invalidations += removed;
        console.log('[PerformanceCache] Invalidated ' + removed + ' entries for ' + projectId);
      },

      dump: function(){
        console.table(Object.keys(_cache).map(function(k){
          var entry = _cache[k];
          var parts = k.split('::');
          return {
            project: parts[0],
            mode: parts[7],
            dist: parts[8],
            gran: parts[9],
            age: Math.round((Date.now() - entry.ts) / 1000) + 's',
            buckets: entry.data.buckets ? entry.data.buckets.length : 0,
            resources: entry.data.byResource ? entry.data.byResource.length : 0
          };
        }));
      }
    };

    /* ═══════════════════════════════════════════════════════════
       AUTO CLEANUP — kalau cache terlalu besar / lama
       ═══════════════════════════════════════════════════════════ */
    setInterval(function(){
      var MAX_AGE = 30 * 60 * 1000;  // 30 menit
      var now = Date.now();
      var removed = 0;
      Object.keys(_cache).forEach(function(k){
        if (now - _cache[k].ts > MAX_AGE){
          delete _cache[k];
          var idx = _order.indexOf(k);
          if (idx >= 0) _order.splice(idx, 1);
          removed++;
        }
      });
      if (removed > 0){
        console.log('[PerformanceCache] Auto-cleanup: ' + removed + ' stale entries removed');
      }
    }, 5 * 60 * 1000);   // setiap 5 menit

    /* ═══════════════════════════════════════════════════════════
       LOG
       ═══════════════════════════════════════════════════════════ */
    console.log('%c[PerformanceCache.js] ✅ ResourceLoader cache installed (max ' + MAX_ENTRIES + ' entries)',
      'color:#22c55e;font-weight:bold;font-size:13px');

    /* Expose shortcut */
    window.pcStats = function(){ console.table(window.PerformanceCache.stats()); };
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ bootstrap(0); });
  } else {
    bootstrap(0);
  }
})();
