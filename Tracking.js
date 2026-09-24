/* =====================================================================
 * MANAJEMEN KONSTRUKSI v1 — TRACKING MODULE
 * Fase 3B-2: Progress Line (MS Project style)
 * Fase 3B-3: Tracking Columns (Actual Start/Finish, Slip, Status)
 * Loaded AFTER Schedule.js — override GanttView via wrapper
 * Tidak menyentuh Schedule.js
 * ===================================================================== */

(function trackingModule(){
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

    var PROGLINE_KEY  = 'mk_gantt_progline';
    var STATUSDATE_KEY = 'mk_gantt_status_date';

    /* ═══════════════════════════════════════════════════════════
       STATE HELPERS
       ═══════════════════════════════════════════════════════════ */
    function loadState(){
      var todayStr = (typeof today === 'function') ? today() : new Date().toISOString().slice(0,10);
      return {
        enabled:    localStorage.getItem(PROGLINE_KEY) === 'on',
        statusDate: localStorage.getItem(STATUSDATE_KEY) || todayStr
      };
    }
    function saveState(partial){
      var s = loadState();
      var next = Object.assign({}, s, partial || {});
      localStorage.setItem(PROGLINE_KEY, next.enabled ? 'on' : 'off');
      localStorage.setItem(STATUSDATE_KEY, next.statusDate);
      return next;
    }

    /* ═══════════════════════════════════════════════════════════
       FASE 3B-3: INJECT TRACKING COLUMNS
       Insert setelah 'finishISO' — dekat data plan
       ═══════════════════════════════════════════════════════════ */
    var TRACKING_COLS = [
      { key: 'act_start',  label: 'Act Start',  width: 92, align: 'center', tracking: true },
      { key: 'act_finish', label: 'Act Finish', width: 92, align: 'center', tracking: true },
      { key: 'slip',       label: 'Slip',       width: 68, align: 'center', tracking: true },
      { key: 'status',     label: 'Status',     width: 118, align: 'center', tracking: true }
    ];

    if (!GanttView._trackingColsInjected){
      var insertIdx = GanttView.COLUMNS.length;
      for (var i = 0; i < GanttView.COLUMNS.length; i++){
        if (GanttView.COLUMNS[i].key === 'finishISO'){ insertIdx = i + 1; break; }
      }
      var args = [insertIdx, 0].concat(TRACKING_COLS);
      Array.prototype.splice.apply(GanttView.COLUMNS, args);
      GanttView._trackingColsInjected = true;
      console.log('[Tracking] Injected ' + TRACKING_COLS.length + ' columns at index ' + insertIdx);
    }

    /* ── Helper: format dd Mmm yy ── */
    var _MON = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
    function fmtDate(iso){
      if (!iso) return '—';
      var p = String(iso).split('T')[0].split('-');
      if (p.length !== 3) return String(iso);
      var m = parseInt(p[1], 10);
      return parseInt(p[2], 10) + ' ' + (_MON[m-1] || '?') + ' ' + p[0].slice(-2);
    }

    /* ═══════════════════════════════════════════════════════════
       OVERRIDE renderLayout
       - Filter tracking columns kalau state.trackingMode OFF
       - Inject toolbar button
       ═══════════════════════════════════════════════════════════ */
    var _origRenderLayout = GanttView.renderLayout;
    GanttView.renderLayout = function(state){
      var saved = GanttView.COLUMNS.slice();
      if (!state.trackingMode){
        GanttView.COLUMNS = saved.filter(function(c){ return !c.tracking; });
      }
      try {
        _origRenderLayout.call(this, state);
      } finally {
        GanttView.COLUMNS = saved;
      }
      try { injectProgressButton(state); }
      catch(e){ console.warn('[Tracking] injectProgressButton error:', e.message); }
    };

    /* ═══════════════════════════════════════════════════════════
       OVERRIDE rowHtml
       - Panggil original dulu (cells tracking kosong)
       - Replace cell kosong dengan konten tracking
       ═══════════════════════════════════════════════════════════ */
    var _origRowHtml = GanttView.rowHtml;
    GanttView.rowHtml = function(node, idx){
      if (node.isGroupHeader) return _origRowHtml.call(this, node, idx);

      var hasTracking = this.COLUMNS.some(function(c){ return c.tracking; });
      if (!hasTracking) return _origRowHtml.call(this, node, idx);

      var html = _origRowHtml.call(this, node, idx);

      var values = {
        act_start:  cellActStart(node),
        act_finish: cellActFinish(node),
        slip:       cellSlip(node),
        status:     cellStatus(node)
      };
      Object.keys(values).forEach(function(key){
        var val = values[key];
        if (!val) return;
        var re = new RegExp('(data-col-key="' + key + '"[^>]*>)</div>', 'g');
        html = html.replace(re, '$1' + val + '</div>');
      });
      return html;
    };

    function cellActStart(node){
      if (node.isMilestone) return '<span class="gt-dim">—</span>';
      if (!node.actualStart) return '<span class="gt-dim">—</span>';
      return '<span class="gt-track-date">' + fmtDate(node.actualStart) + '</span>';
    }

    function cellActFinish(node){
      if (node.isMilestone) return '<span class="gt-dim">—</span>';
      if (node.actualFinish){
        return '<span class="gt-track-date gt-track-done">' + fmtDate(node.actualFinish) + '</span>';
      }
      if (node.actualStart){
        return '<span class="gt-track-ongoing">⏳ ongoing</span>';
      }
      return '<span class="gt-dim">—</span>';
    }

    function cellSlip(node){
      if (node.isMilestone) return '<span class="gt-dim">—</span>';
      var slip = node.slipDays;
      if (slip === null || slip === undefined) return '<span class="gt-dim">—</span>';
      if (slip > 0)  return '<span class="gt-track-slip late">+' + slip + 'd</span>';
      if (slip < 0)  return '<span class="gt-track-slip early">' + slip + 'd</span>';
      return '<span class="gt-track-slip ontime">0d</span>';
    }

    function cellStatus(node){
      var s = node.status || 'not-started';
      var map = {
        'complete':    { cls: 'complete',    txt: '✅ Complete' },
        'in-progress': { cls: 'in-progress', txt: '🟡 Progress' },
        'not-started': { cls: 'not-started', txt: '⚪ Not Started' }
      };
      var m = map[s] || map['not-started'];
      return '<span class="gt-track-badge ' + m.cls + '">' + m.txt + '</span>';
    }

    /* ═══════════════════════════════════════════════════════════
       OVERRIDE drawBars — Progress Line (dari 3B-2)
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

      var tracked = [];
      state.visibleNodes.forEach(function(n, i){
        if (n.isGroupHeader || n.isSummary || n.isMilestone) return;
        var isLate     = (n.slipDays !== null && n.slipDays > 0);
        var isProgress = (n.status === 'in-progress');
        var hasActual  = !!n.actualStart;
        if (isLate || isProgress || hasActual){
          tracked.push({ node: n, rowIdx: i, isLate: isLate });
        }
      });
      if (!tracked.length) return;

      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap  = 'round';

      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth   = 1.8;
      ctx.beginPath();
      ctx.moveTo(statusX, 0);

      var prevX = statusX;
      tracked.forEach(function(t, idx2){
        var pos = state.posMap && state.posMap[t.node.id];
        if (!pos) return;
        var yMid = pos.y + rowH / 2;
        var endX;
        if (t.isLate){
          endX = pos.x2 + (px * (t.node.slipDays || 0));
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
        ctx.lineTo(prevX, yMid);
        ctx.lineTo(endX, yMid);
        prevX = endX;
        if (idx2 < tracked.length - 1){
          ctx.lineTo(statusX, yMid + rowH * 0.5);
          prevX = statusX;
        }
      });
      ctx.lineTo(prevX, H);
      ctx.stroke();

      ctx.fillStyle = '#f59e0b';
      tracked.forEach(function(t){
        var pos = state.posMap && state.posMap[t.node.id];
        if (!pos) return;
        var yMid = pos.y + rowH / 2;
        var endX;
        if (t.isLate) endX = pos.x2 + (px * (t.node.slipDays || 0));
        else if (t.node.actualStart){
          var actOff = Math.round((new Date(t.node.actualStart + 'T00:00:00') - startDate) / 86400000);
          var actX = actOff * px;
          var actLen = t.node.actualFinish
            ? Math.round((new Date(t.node.actualFinish + 'T00:00:00') - new Date(t.node.actualStart + 'T00:00:00')) / 86400000)
            : 1;
          endX = actX + (actLen * px) + (px * 0.5);
        } else endX = pos.x2;
        ctx.beginPath();
        ctx.arc(endX, yMid, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      });

      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(statusX, 0);
      ctx.lineTo(statusX, H);
      ctx.stroke();
      ctx.setLineDash([]);

      var label = '📍 ' + statusDateISO;
      ctx.font = 'bold 10px Segoe UI';
      var tw = ctx.measureText(label).width;
      var boxW = tw + 14, boxH = 20;
      var boxX = Math.min(Math.max(statusX - boxW / 2, 4), W - boxW - 4);
      var boxY = 4;
      ctx.fillStyle = 'rgba(245, 158, 11, 0.95)';
      var rr = 5;
      ctx.beginPath();
      ctx.moveTo(boxX + rr, boxY);
      ctx.arcTo(boxX + boxW, boxY, boxX + boxW, boxY + boxH, rr);
      ctx.arcTo(boxX + boxW, boxY + boxH, boxX, boxY + boxH, rr);
      ctx.arcTo(boxX, boxY + boxH, boxX, boxY, rr);
      ctx.arcTo(boxX, boxY, boxX + boxW, boxY, rr);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, boxX + boxW / 2, boxY + boxH / 2 + 0.5);

      ctx.restore();
    }

    /* ═══════════════════════════════════════════════════════════
       TOOLBAR BUTTON INJECTION (Progress Line toggle)
       ═══════════════════════════════════════════════════════════ */
    function injectProgressButton(state){
      var container = state.container;
      if (!container) return;
      var toolbar = container.querySelector('.gantt-toolbar-right');
      if (!toolbar) return;
      if (toolbar.querySelector('.gantt-btn-progline-toggle')) return;

      var st = loadState();
      var btn = document.createElement('button');
      btn.className = 'gantt-btn-progline-toggle' + (st.enabled ? ' is-on' : '');
      btn.title = 'Progress Line — garis tracking dari status date';
      btn.textContent = '📉 Progress';
      btn.onclick = function(){
        var next = !loadState().enabled;
        saveState({ enabled: next });
        GanttView.mount(state.container, state.proj.id, { mode: state.mode, zoom: state.zoom });
        if (typeof toast === 'function'){
          toast(next ? '📉 Progress Line aktif' : '📉 Progress Line nonaktif');
        }
      };
      var lbl = toolbar.querySelector('.gantt-lbl');
      if (lbl) toolbar.insertBefore(btn, lbl);
      else toolbar.appendChild(btn);
    }

    /* ═══════════════════════════════════════════════════════════
       PUBLIC API
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

    window.getStatusDate = function(){ return loadState().statusDate; };

    window.toggleProgressLine = function(){
      var next = !loadState().enabled;
      saveState({ enabled: next });
      var el = document.getElementById('ganttContainer');
      if (el && typeof STATE !== 'undefined' && STATE.activeProject){
        GanttView.mount(el, STATE.activeProject, { mode: 'rab', zoom: el._lastZoom || 'weekly' });
      }
      console.log('[Tracking] Progress Line:', next ? 'ON' : 'OFF');
    };

    console.log('%c[Tracking.js] ✅ Progress Line + Tracking Columns installed',
      'color:#f59e0b;font-weight:bold;font-size:13px');
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ bootstrap(0); });
  } else {
    bootstrap(0);
  }
})();
