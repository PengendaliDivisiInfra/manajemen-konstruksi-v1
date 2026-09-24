/* =====================================================================
 * MANAJEMEN KONSTRUKSI v1 — KEYBOARD SHORTCUTS
 * Fase 3E-4: Keyboard shortcuts global
 * Loaded AFTER semua modul — independent module
 * ===================================================================== */

(function keyboardShortcutsModule(){
  function bootstrap(attempt){
    attempt = attempt || 0;
    if (typeof GanttView === 'undefined' || typeof DB === 'undefined'){
      if (attempt > 50){
        console.error('[KeyboardShortcuts.js] Engine belum siap — menyerah');
        return;
      }
      setTimeout(function(){ bootstrap(attempt + 1); }, 300);
      return;
    }
    install();
  }

  function install(){
    if (window._keyboardShortcutsInstalled) return;
    window._keyboardShortcutsInstalled = true;

    /* ═══════════════════════════════════════════════════════════
       REGISTRY SHORTCUTS
       ═══════════════════════════════════════════════════════════ */
    var SHORTCUTS = [
      { key: 'r', shift: true, ctrl: true, label: 'Ctrl+Shift+R', desc: 'Buka Report Dialog',     fn: doReport },
      { key: 'w', shift: true, ctrl: true, label: 'Ctrl+Shift+W', desc: 'Buka Progress Wizard',   fn: doWizard },
      { key: 'p', shift: true, ctrl: true, label: 'Ctrl+Shift+P', desc: 'Buka Portfolio Timeline',fn: doPortfolio },
      { key: 't', shift: true, ctrl: true, label: 'Ctrl+Shift+T', desc: 'Toggle 📊 Tracking',      fn: doToggleTracking },
      { key: 'c', shift: true, ctrl: true, label: 'Ctrl+Shift+C', desc: 'Toggle 💵 Cost Columns',  fn: doToggleCostCols },
      { key: 's', shift: true, ctrl: true, label: 'Ctrl+Shift+S', desc: 'Toggle 📈 S-Curve',       fn: doToggleSCurve },
      { key: 'k', shift: true, ctrl: true, label: 'Ctrl+Shift+K', desc: 'Buka 🗂 Task Inspector',  fn: doInspector },
      { key: '?', shift: true, ctrl: true, label: 'Ctrl+Shift+?', desc: 'Buka Help (shortcut ini)', fn: doHelp },
      { key: '/', shift: true, ctrl: true, label: 'Ctrl+Shift+/', desc: 'Buka Help (alternatif)',   fn: doHelp }
    ];

    /* ═══════════════════════════════════════════════════════════
       HELPERS
       ═══════════════════════════════════════════════════════════ */
    function _esc(s){
      return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
      });
    }
    function _toast(msg, ok){
      if (typeof toast === 'function') toast(msg, ok !== false);
    }
    function _closeModal(){
      if (typeof closeModal === 'function') closeModal();
    }
    function _activeProject(){
      if (typeof STATE === 'undefined' || !STATE.activeProject){
        _toast('Pilih proyek aktif dulu', false);
        return null;
      }
      return STATE.activeProject;
    }

    /* ═══════════════════════════════════════════════════════════
       ACTIONS
       ═══════════════════════════════════════════════════════════ */
    function doReport(){
      if (typeof window.openReport === 'function'){
        window.openReport();
      } else {
        _toast('Report module tidak tersedia', false);
      }
    }

    function doWizard(){
      if (!_activeProject()) return;
      if (typeof window.openProgressWizard === 'function'){
        window.openProgressWizard();
      } else {
        _toast('Progress Wizard tidak tersedia', false);
      }
    }

    function doPortfolio(){
      if (typeof window.openPortfolioTimeline === 'function'){
        window.openPortfolioTimeline();
      } else {
        _toast('Portfolio Timeline tidak tersedia', false);
      }
    }

    function doToggleTracking(){
      if (!_activeProject()) return;
      var next = localStorage.getItem('mk_gantt_track') !== 'on';
      localStorage.setItem('mk_gantt_track', next ? 'on' : 'off');
      var el = document.getElementById('ganttContainer');
      if (el && typeof GanttView !== 'undefined'){
        GanttView.mount(el, STATE.activeProject, { mode: 'rab', zoom: el._lastZoom || 'weekly' });
      }
      _toast(next ? '📊 Tracking ON' : '📊 Tracking OFF');
    }

    function doToggleCostCols(){
      if (!_activeProject()) return;
      var next = localStorage.getItem('mk_gantt_cost_cols') !== 'on';
      localStorage.setItem('mk_gantt_cost_cols', next ? 'on' : 'off');
      var el = document.getElementById('ganttContainer');
      if (el && typeof GanttView !== 'undefined'){
        GanttView.mount(el, STATE.activeProject, { mode: 'rab', zoom: el._lastZoom || 'weekly' });
      }
      _toast(next ? '💵 Cost Columns ON' : '💵 Cost Columns OFF');
    }

    function doToggleSCurve(){
      if (!_activeProject()) return;
      var next = localStorage.getItem('mk_gantt_scurve') !== 'on';
      localStorage.setItem('mk_gantt_scurve', next ? 'on' : 'off');
      var el = document.getElementById('ganttContainer');
      if (el && typeof GanttView !== 'undefined'){
        GanttView.mount(el, STATE.activeProject, { mode: 'rab', zoom: el._lastZoom || 'weekly' });
      }
      _toast(next ? '📈 S-Curve ON' : '📈 S-Curve OFF');
    }

    function doInspector(){
      if (!_activeProject()) return;
      /* Ambil task pertama yang visible */
      var tasks = DB.project_wbs.filter(function(w){
        return w.project_id === STATE.activeProject && !w.is_group;
      });
      if (!tasks.length){
        _toast('Tidak ada task di proyek ini', false);
        return;
      }
      if (typeof window.TaskInspector !== 'undefined' && window.TaskInspector.open){
        /* Buka task pertama */
        window.TaskInspector.open(tasks[0].id);
        _toast('🗂 Task Inspector dibuka untuk ' + tasks[0].kode_wbs);
      } else if (typeof TaskInspector !== 'undefined' && TaskInspector.open){
        TaskInspector.open(tasks[0].id);
        _toast('🗂 Task Inspector dibuka untuk ' + tasks[0].kode_wbs);
      } else {
        _toast('Task Inspector tidak tersedia', false);
      }
    }

    function doHelp(){
      if (typeof openModal !== 'function') return;

      var rows = SHORTCUTS.map(function(s){
        return '<tr>' +
          '<td class="ks-key"><kbd>' + _esc(s.label) + '</kbd></td>' +
          '<td class="ks-desc">' + _esc(s.desc) + '</td>' +
        '</tr>';
      }).join('');

      var body =
        '<div class="ks-hint">💡 Shortcut ini bekerja global kecuali saat kursor berada di input field.</div>' +
        '<div class="ks-wrap">' +
          '<table class="ks-table">' +
            '<thead><tr><th>Shortcut</th><th>Aksi</th></tr></thead>' +
            '<tbody>' + rows + '</tbody>' +
          '</table>' +
        '</div>' +
        '<div class="ks-hint" style="margin-top:12px">Shortcut tambahan:</div>' +
        '<div class="ks-wrap">' +
          '<table class="ks-table">' +
            '<tbody>' +
              '<tr><td class="ks-key"><kbd>Ctrl+Z</kbd></td><td class="ks-desc">Undo</td></tr>' +
              '<tr><td class="ks-key"><kbd>Ctrl+Shift+Z</kbd></td><td class="ks-desc">Redo</td></tr>' +
              '<tr><td class="ks-key"><kbd>Esc</kbd></td><td class="ks-desc">Tutup modal</td></tr>' +
            '</tbody>' +
          '</table>' +
        '</div>';

      openModal('⌨ Keyboard Shortcuts', body, function(){ return false; });
      setTimeout(function(){
        var sBtn = document.getElementById('mSubmit');
        if (sBtn) sBtn.style.display = 'none';
        var cBtn = document.getElementById('mCancel');
        if (cBtn) cBtn.textContent = 'Tutup';
      }, 10);
    }

    /* ═══════════════════════════════════════════════════════════
       KEY HANDLER
       ═══════════════════════════════════════════════════════════ */
    function shouldSkip(e){
      /* Skip kalau user sedang ketik di input/textarea */
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
      if (e.target && e.target.isContentEditable) return true;
      return false;
    }

    function onKeyDown(e){
      /* Modifier: Ctrl atau Cmd (Mac) */
      var isMac = /Mac|iPhone|iPad/.test(navigator.platform);
      var mod = isMac ? e.metaKey : e.ctrlKey;
      if (!mod) return;
      if (!e.shiftKey) return;

      var key = String(e.key || '').toLowerCase();

      /* Cari shortcut yang cocok */
      for (var i = 0; i < SHORTCUTS.length; i++){
        var s = SHORTCUTS[i];
        if (s.key === key && s.ctrl === mod && s.shift === e.shiftKey){
          /* Ctrl+Shift+R biasanya hard reload di address bar — biarkan browser kalau tidak di app */
          /* Skip handler kalau user sedang fokus di input */
          if (shouldSkip(e) && s.key !== '?') return;

          e.preventDefault();
          e.stopPropagation();

          try {
            s.fn();
          } catch (err){
            console.warn('[Keyboard] Error running shortcut', s.label, err);
            _toast('Error: ' + err.message, false);
          }
          return;
        }
      }
    }

    /* ═══════════════════════════════════════════════════════════
       ATTACH LISTENER (capture phase untuk override browser)
       ═══════════════════════════════════════════════════════════ */
    document.addEventListener('keydown', onKeyDown, true);

    /* ═══════════════════════════════════════════════════════════
       PUBLIC API
       ═══════════════════════════════════════════════════════════ */
    window.KeyboardShortcuts = {
      list: function(){
        console.table(SHORTCUTS.map(function(s){
          return { shortcut: s.label, action: s.desc };
        }));
      },
      showHelp: doHelp,
      shortcuts: SHORTCUTS
    };

    console.log('%c[KeyboardShortcuts.js] ✅ ' + SHORTCUTS.length + ' shortcuts installed (Ctrl+Shift+? for help)',
      'color:#22c55e;font-weight:bold;font-size:13px');
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ bootstrap(0); });
  } else {
    bootstrap(0);
  }
})();
