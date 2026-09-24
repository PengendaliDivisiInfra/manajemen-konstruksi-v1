/* =====================================================================
 * MANAJEMEN KONSTRUKSI v1 — TRACKING MODULE
 * Fase 3B-2: Progress Line (MS Project style)
 * Loaded AFTER Schedule.js — override GanttView via wrapper
 * Tidak menyentuh Schedule.js
 * ===================================================================== */

(function trackingModule(){
  /* ── Retry sampai GanttView siap ── */
  function bootstrap(attempt){
    attempt = attempt || 0;
    if (typeof GanttView === 'undefined' || typeof GanttView.drawBars !== 'function'){
      if (attempt > 50){
        console.error('[Tracking.js] GanttView tidak siap setelah 15 detik — menyerah');
        return;
      }
      setTimeout(function(){ bootstrap(attempt + 1); }, 300);
      return;
    }
    install();
  }

  function install(){
    if (window._trackingModuleInstalled) return;
    window._trackingModuleInstalled = true;

    var STATE_KEY  = 'mk_gantt_progline';
    var STATUS_KEY = 'mk_gantt_status_date';

    /* ═══════════════════════════════════════════════════════════
       STATE HELPERS
       ═══════════════════════════════════════════════════════════ */
    function loadState(){
      var todayStr = (typeof today === 'function') ? today() : new Date().toISOString().slice(0,10);
      return {
        enabled:    localStorage.getItem(STATE_KEY) === 'on',
        statusDate: localStorage.getItem(STATUS_KEY) || todayStr
      };
    }

    function saveState(partial){
      var s = loadState();
      var next = Object.assign({}, s, partial || {});
      localStorage.setItem(STATE_KEY, next.enabled ? 'on' : 'off');
      localStorage.setItem(STATUS_KEY, next.statusDate);
      return next;
    }

    /* ═══════════════════════════════════════════════════════════
       OVERRIDE drawBars — wrapper
       ═══════════════════════════════════════════════════════════ */
    var _origDrawBars = GanttView.drawBars;
    GanttView.drawBars = function(ctx, state, canvas){
      _origDrawBars.call(this, ctx, state, canvas);
      try {
        var st = loadState();
        if (st.enabled) drawProgressLine(ctx, state, canvas, st.statusDate);
      } catch (e){
        console.warn('[Tracking] drawProgressLine error:', e.message);
      }
    };

    /* ═══════════════════════════════════════════════════════════
       OVERRIDE renderLayout — inject tombol toolbar
       ═══════════════════════════════════════════════════════════ */
    var _origRenderLayout = GanttView.renderLayout;
    GanttView.renderLayout = function(state){
      _origRenderLayout.call(this, state);
      try {
        injectToolbarButton(state);
      } catch (e){
        console.warn('[Tracking] injectToolbarButton error:', e.message);
      }
    };

    /* ═══════════════════════════════════════════════════════════
       DRAW PROGRESS LINE
       ═══════════════════════════════════════════════════════════ */
    function drawProgressLine(ctx, state, canvas, statusDateISO){
      var statusDate = new Date(statusDateISO + 'T00:00:00');
      if (isNaN(statusDate.getTime())) return;

      var startDate = state.startDate;
      var px        = state.zoomCfg.pxPerDay;
      var rowH      = GanttView.ROW_H;
      var W         = canvas.width;
      var H         = canvas.height;

      var statusOff = Math.round((statusDate - startDate) / 86400000);
      var statusX   = statusOff * px + px / 2;

      /* Hitung task yang perlu di-tracking */
      var tracked = [];
      state.visibleNodes.forEach(function(n, i){
        if (n.isGroupHeader) return;
        if (n.isSummary || n.isMilestone) return;

        var isLate      = (n.slipDays !== null && n.slipDays > 0);
        var isProgress  = (n.status === 'in-progress');
        var hasActual   = !!n.actualStart;

        if (isLate || isProgress || hasActual){
          tracked.push({ node: n, rowIdx: i, isLate: isLate, isProgress: isProgress });
        }
      });

      if (!tracked.length) return;

      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap  = 'round';

      /* ── Gambar garis zigzag ── */
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth   = 1.8;
      ctx.beginPath();
      ctx.moveTo(statusX, 0);

      var prevX = statusX;
      tracked.forEach(function(t, idx){
        var pos = state.posMap && state.posMap[t.node.id];
        if (!pos) return;

        var yMid = pos.y + rowH / 2;

        /* Titik ujung: kalau late, ujung = plan finish + slip; kalau in-progress, ujung = posisi actual bar */
        var endX;
        if (t.isLate){
          endX = pos.x2 + (state.zoomCfg.pxPerDay * (t.node.slipDays || 0));
        } else if (t.node.actualStart){
          /* Ujung actual bar */
          var actOff = Math.round((new Date(t.node.actualStart + 'T00:00:00') - startDate) / 86400000);
          var actX = actOff * px;
          /* Panjang actual bar */
          var actLen = t.node.actualFinish
            ? Math.round((new Date(t.node.actualFinish + 'T00:00:00') - new Date(t.node.actualStart + 'T00:00:00')) / 86400000)
            : 1;
          endX = actX + (actLen * px) + (px * 0.5);
        } else {
          endX = pos.x2;
        }

        /* Turun ke task */
        ctx.lineTo(prevX, yMid);
        /* Geser ke ujung */
        ctx.lineTo(endX, yMid);
        prevX = endX;

        /* Kalau bukan task terakhir, naik lagi ke status date */
        if (idx < tracked.length - 1){
          var upY = yMid + rowH * 0.5;
          ctx.lineTo(statusX, upY);
          prevX = statusX;
        }
      });

      /* Turun ke bawah */
      ctx.lineTo(prevX, H);
      ctx.stroke();

      /* ── Titik kecil di setiap ujung ── */
      ctx.fillStyle = '#f59e0b';
      tracked.forEach(function(t){
        var pos = state.posMap && state.posMap[t.node.id];
        if (!pos) return;
        var yMid = pos.y + rowH / 2;
        var endX;
        if (t.isLate){
          endX = pos.x2 + (state.zoomCfg.pxPerDay * (t.node.slipDays || 0));
        } else if (t.node.actualStart){
          var actOff = Math.round((new Date(t.node.actualStart + 'T00:00:00') - startDate) / 86400000);
          var actX = actOff * px;
          var actLen = t.node.actualFinish
            ? Math.round((new Date(t.node.actualFinish + 'T00:00:00') - new Date(t.node.actualStart + 'T00:00:00')) / 86400000)
            : 1;
          endX = actX + (actLen * px) + (px * 0.5);
        } else {
          endX = pos.x2;
        }
        ctx.beginPath();
        ctx.arc(endX, yMid, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      });

      /* ── Garis vertikal status date (dashed) ── */
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth   = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(statusX, 0);
      ctx.lineTo(statusX, H);
      ctx.stroke();
      ctx.setLineDash([]);

      /* ── Label status date di atas ── */
      var label = '📍 ' + statusDateISO;
      ctx.font = 'bold 10px Segoe UI';
      var tw = ctx.measureText(label).width;
      var boxW = tw + 14;
      var boxH = 20;
      var boxX = Math.min(Math.max(statusX - boxW / 2, 4), W - boxW - 4);
      var boxY = 4;

      ctx.fillStyle = 'rgba(245, 158, 11, 0.95)';
      var r = 5;
      ctx.beginPath();
      ctx.moveTo(boxX + r, boxY);
      ctx.arcTo(boxX + boxW, boxY, boxX + boxW, boxY + boxH, r);
      ctx.arcTo(boxX + boxW, boxY + boxH, boxX, boxY + boxH, r);
      ctx.arcTo(boxX, boxY + boxH, boxX, boxY, r);
      ctx.arcTo(boxX, boxY, boxX + boxW, boxY, r);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, boxX + boxW / 2, boxY + boxH / 2 + 0.5);

      ctx.restore();
    }

    /* ═══════════════════════════════════════════════════════════
       TOOLBAR BUTTON INJECTION
       ═══════════════════════════════════════════════════════════ */
    function injectToolbarButton(state){
      var container = state.container;
      if (!container) return;

      var toolbar = container.querySelector('.gantt-toolbar-right');
      if (!toolbar) return;

      /* Hindari duplikasi */
      if (toolbar.querySelector('.gantt-btn-progline-toggle')) return;

      var st = loadState();
      var btn = document.createElement('button');
      btn.className = 'gantt-btn-progline-toggle' + (st.enabled ? ' is-on' : '');
      btn.title = 'Progress Line — garis tracking dari status date ke task yang telat';
      btn.textContent = '📉 Progress';
      btn.onclick = function(){
        var next = !loadState().enabled;
        saveState({ enabled: next });
        GanttView.mount(state.container, state.proj.id, { mode: state.mode, zoom: state.zoom });
        if (typeof toast === 'function'){
          toast(next ? '📉 Progress Line aktif' : '📉 Progress Line nonaktif');
        }
      };

      /* Append ke toolbar (biar urutan setelah tombol lain) */
      var lbl = toolbar.querySelector('.gantt-lbl');
      if (lbl){
        toolbar.insertBefore(btn, lbl);
      } else {
        toolbar.appendChild(btn);
      }
    }

    /* ═══════════════════════════════════════════════════════════
       PUBLIC API — panggil dari Console
       ═══════════════════════════════════════════════════════════ */
    window.setStatusDate = function(iso){
      if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)){
        console.warn('Format: setStatusDate("2024-06-15")');
        return;
      }
      saveState({ statusDate: iso });
      var el = document.getElementById('ganttContainer');
      if (el && typeof STATE !== 'undefined' && STATE.activeProject){
        GanttView.mount(el, STATE.activeProject, { mode: 'rab', zoom: el._lastZoom || 'weekly' });
      }
      if (typeof toast === 'function') toast('📅 Status date → ' + iso);
      console.log('[Tracking] Status date:', iso);
    };

    window.getStatusDate = function(){
      return loadState().statusDate;
    };

    window.toggleProgressLine = function(){
      var next = !loadState().enabled;
      saveState({ enabled: next });
      var el = document.getElementById('ganttContainer');
      if (el && typeof STATE !== 'undefined' && STATE.activeProject){
        GanttView.mount(el, STATE.activeProject, { mode: 'rab', zoom: el._lastZoom || 'weekly' });
      }
      console.log('[Tracking] Progress Line:', next ? 'ON' : 'OFF');
    };

    console.log('%c[Tracking.js] ✅ Progress Line installed',
      'color:#f59e0b;font-weight:bold;font-size:13px');
  }

  /* ── Start bootstrap ── */
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ bootstrap(0); });
  } else {
    bootstrap(0);
  }
})();