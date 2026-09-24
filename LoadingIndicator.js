/* =====================================================================
 * MANAJEMEN KONSTRUKSI v1 — LOADING INDICATOR
 * Fase 3E-3: Spinner overlay untuk operasi berat
 * ===================================================================== */
(function(){
  if (window._loadingIndicatorInstalled) return;
  window._loadingIndicatorInstalled = true;

  var MAX_TIMEOUT_MS = 15000;
  var _overlay = null;
  var _timeout = null;
  var _startTime = 0;

  function ensureOverlay(){
    if (_overlay && document.body.contains(_overlay)) return _overlay;
    _overlay = document.createElement('div');
    _overlay.id = 'globalLoadingOverlay';
    _overlay.className = 'loading-overlay';
    _overlay.innerHTML = '<div class="loading-content">'
      + '<div class="loading-spinner"></div>'
      + '<div class="loading-label" id="loadingLabel">Memuat...</div>'
      + '<div class="loading-sub" id="loadingSub"></div>'
      + '</div>';
    document.body.appendChild(_overlay);
    return _overlay;
  }

  function show(msg, opts){
    opts = opts || {};
    var ov = ensureOverlay();
    _startTime = Date.now();

    var lbl = document.getElementById('loadingLabel');
    if (lbl) lbl.textContent = msg || 'Memuat...';

    var sub = document.getElementById('loadingSub');
    if (sub){
      sub.textContent = opts.sub || '';
      sub.style.display = opts.sub ? 'block' : 'none';
    }

    ov.offsetHeight;
    ov.classList.add('is-visible');

    clearTimeout(_timeout);
    var ttl = opts.timeout || MAX_TIMEOUT_MS;
    _timeout = setTimeout(function(){
      var sec = ttl / 1000;
      console.warn('[Loading] Auto-hide after ' + sec + 's');
      hide();
    }, ttl);
  }

  function hide(){
    clearTimeout(_timeout);
    _timeout = null;
    if (_overlay) _overlay.classList.remove('is-visible');
  }

  function progress(current, total, msg){
    var sub = document.getElementById('loadingSub');
    if (!sub) return;
    if (typeof current === 'number' && typeof total === 'number' && total > 0){
      var pct = Math.round(current / total * 100);
      sub.textContent = (msg || 'Memproses') + ' ' + current + '/' + total + ' (' + pct + '%)';
      sub.style.display = 'block';
    } else if (msg){
      sub.textContent = msg;
      sub.style.display = 'block';
    }
  }

  function wrap(fn, msg, opts){
    opts = opts || {};
    var delay = opts.delay == null ? 150 : opts.delay;
    var showTimer = setTimeout(function(){ show(msg, opts); }, delay);

    function cleanup(){
      clearTimeout(showTimer);
      hide();
    }

    try {
      var result = fn();
      if (result && typeof result.then === 'function'){
        return result.then(function(v){ cleanup(); return v; })
                     .catch(function(e){ cleanup(); throw e; });
      }
      cleanup();
      return result;
    } catch (e){
      cleanup();
      throw e;
    }
  }

  function wrapSync(fn, msg, delayMs){
    delayMs = delayMs == null ? 120 : delayMs;
    var showTimer = setTimeout(function(){ show(msg); }, delayMs);
    try {
      var r = fn();
      clearTimeout(showTimer);
      hide();
      return r;
    } catch (e){
      clearTimeout(showTimer);
      hide();
      throw e;
    }
  }

  window.Loading = {
    show: show,
    hide: hide,
    progress: progress,
    wrap: wrap,
    wrapSync: wrapSync,
    isVisible: function(){ return _overlay && _overlay.classList.contains('is-visible'); },
    stats: function(){
      return {
        visible: this.isVisible(),
        uptime: _startTime ? Math.round((Date.now() - _startTime) / 1000) + 's' : '—'
      };
    }
  };

  console.log('%c[LoadingIndicator.js] ✅ Loading overlay installed',
    'color:#22c55e;font-weight:bold;font-size:13px');
})();
