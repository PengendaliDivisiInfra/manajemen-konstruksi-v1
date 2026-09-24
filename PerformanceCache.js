/* =====================================================================
 * MANAJEMEN KONSTRUKSI v1 — PERFORMANCE CACHE
 * Fase 3E-2: Cache ResourceLoader.load() dengan auto-invalidation
 * Loaded AFTER Schedule.js — independent module
 *
 * v2 (FIX): Signature sekarang meng-hash field jadwal (predecessor,
 * durasi, constraint, calendar, schedule_mode, manual dates, work_contour,
 * urut, parent_id, ahsp_id, tgl rencana), progress (wbs_id, minggu, volume,
 * tanggal), PAD, dan atribut master_resources (khususnya kapasitas_harian
 * yang memengaruhi OverAllocationDetector).
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
    var _order = [];      // LRU (oldest first)
    var _stats = {
      hits: 0,
      misses: 0,
      invalidations: 0,
      installedAt: Date.now()
    };

    /* ── Util: parse numerik toleran ── */
    function _num(v){
      var n = parseFloat(String(v == null ? '' : v).replace(/[^\d.-]/g,''));
      return isFinite(n) ? n : 0;
    }

    /* ── Util: hash 32-bit (djb2) — cepat, cukup untuk signatur ── */
    function _hash32(s){
      var h = 5381;
      s = String(s || '');
      for (var i = 0; i < s.length; i++){
        h = (((h << 5) + h) + s.charCodeAt(i)) | 0;
      }
      return h >>> 0;
    }

    /* ═══════════════════════════════════════════════════════════
       SIGNATURE v2 — hash semua state yang memengaruhi load
       ═══════════════════════════════════════════════════════════ */
    function makeSignature(projectId){
      if (typeof DB === 'undefined' || !DB) return projectId + '::empty';

      var wbs  = DB.project_wbs || [];
      var prog = DB.progress || [];
      var pad  = DB.project_ahsp_details || [];
      var res  = DB.master_resources || [];

      /* ── WBS: agregat + hash field jadwal ── */
      var wbsVolSum = 0, wbsVolRapSum = 0, wbsScheduled = 0, wbsCount = 0;
      var schedHash = 0;
      for (var i = 0; i < wbs.length; i++){
        var w = wbs[i];
        if (w.project_id !== projectId) continue;
        wbsCount++;
        wbsVolSum    += _num(w.volume_rab);
        wbsVolRapSum += _num(w.volume_rap);
        if (w.tgl_mulai_rencana) wbsScheduled++;
        schedHash = (schedHash ^ _hash32([
          w.id || '',
          w.urut || 0,
          w.parent_id || '',
          w.predecessor || '',
          w.pred_type || '',
          w.lag_days || 0,
          w.duration || w.durasi_hari || 0,
          w.constraint_type || '',
          w.constraint_date || '',
          w.calendar_id || '',
          w.schedule_mode || '',
          w.manual_start || '',
          w.manual_finish || '',
          w.work_contour || '',
          w.ahsp_id || '',
          w.is_group ? 'g' : 'l',
          w.tgl_mulai_rencana || '',
          w.tgl_selesai_rencana || ''
        ].join('\u0001'))) >>> 0;
      }

      /* ── Progress: count + sum + hash ── */
      var progVolSum = 0, progCount = 0, progHash = 0;
      for (var j = 0; j < prog.length; j++){
        var p = prog[j];
        if (p.project_id !== projectId) continue;
        progVolSum += _num(p.volume);
        progCount++;
        progHash = (progHash ^ _hash32(
          (p.wbs_id || '') + '\u0001' +
          (p.minggu || 0) + '\u0001' +
          _num(p.volume) + '\u0001' +
          (p.tanggal || '')
        )) >>> 0;
      }

      /* ── PAD: koefisien + harga ── */
      var padSum = 0, padCount = 0;
      for (var k = 0; k < pad.length; k++){
        if (pad[k].project_id !== projectId) continue;
        padSum += _num(pad[k].koefisien_master) + _num(pad[k].koefisien_rap)
                + _num(pad[k].harga_rab) + _num(pad[k].harga_rap);
        padCount++;
      }

      /* ── Resources: hash atribut (kapasitas_harian → over-allocation) ── */
      var resHash = 0;
      for (var m = 0; m < res.length; m++){
        var r = res[m];
        resHash = (resHash ^ _hash32([
          r.id || '',
          r.kode || '',
          r.jenis || '',
          _num(r.harga_rab),
          _num(r.harga_rap),
          _num(r.kapasitas_harian)
        ].join('\u0001'))) >>> 0;
      }

      return [
        projectId,
        wbsCount,
        wbsVolSum.toFixed(2),
        wbsVolRapSum.toFixed(2),
        wbsScheduled,
        schedHash.toString(36),
        progCount,
        progVolSum.toFixed(2),
        progHash.toString(36),
        padCount,
        padSum.toFixed(2),
        res.length,
        resHash.toString(36)
      ].join('|');
    }

    /* ═══════════════════════════════════════════════════════════
       WRAP ResourceLoader.load
       ═══════════════════════════════════════════════════════════ */
    var _origLoad = ResourceLoader.load;

    ResourceLoader.load = function(projectId, opts){
      opts = opts || {};

      var sig = makeSignature(projectId);

      var key = sig + '::' +
                (opts.mode || 'rab') + '::' +
                (opts.distribution || 'uniform') + '::' +
                (opts.granularity || 'weekly');

      /* Cache hit */
      if (Object.prototype.hasOwnProperty.call(_cache, key)){
        _stats.hits++;
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

      /* Simpan hanya jika sukses */
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
        if (!projectId){ this.clear(); return; }
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
          var sigParts = (parts[0] || '').split('|');
          return {
            project: sigParts[0] || '?',
            mode: parts[1] || '?',
            dist: parts[2] || '?',
            gran: parts[3] || '?',
            age: Math.round((Date.now() - entry.ts) / 1000) + 's',
            buckets: entry.data.buckets ? entry.data.buckets.length : 0,
            resources: entry.data.byResource ? entry.data.byResource.length : 0
          };
        }));
      }
    };

    /* ═══════════════════════════════════════════════════════════
       AUTO CLEANUP — buang entry > 30 menit
       ═══════════════════════════════════════════════════════════ */
    setInterval(function(){
      var MAX_AGE = 30 * 60 * 1000;
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
    }, 5 * 60 * 1000);

    console.log('%c[PerformanceCache.js] ✅ ResourceLoader cache installed v2 (max ' + MAX_ENTRIES + ' entries)',
      'color:#22c55e;font-weight:bold;font-size:13px');

    window.pcStats = function(){ console.table(window.PerformanceCache.stats()); };
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ bootstrap(0); });
  } else {
    bootstrap(0);
  }
})();
