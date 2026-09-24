/* =====================================================================
 * MANAJEMEN KONSTRUKSI v1 — PORTFOLIO TIMELINE
 * Fase 3E: Multi-proyek view dalam 1 Gantt timeline
 * Loaded AFTER Schedule.js — independent module
 * ===================================================================== */

(function portfolioTimelineModule(){
  function bootstrap(attempt){
    attempt = attempt || 0;
    if (typeof DB === 'undefined' || !DB || typeof Calc === 'undefined'){
      if (attempt > 50){
        console.error('[PortfolioTimeline.js] Engine belum siap — menyerah');
        return;
      }
      setTimeout(function(){ bootstrap(attempt + 1); }, 300);
      return;
    }
    install();
  }

  function install(){
    if (window._portfolioTimelineInstalled) return;
    window._portfolioTimelineInstalled = true;

    var ZOOM_KEY = 'mk_portfolio_zoom';
    var _defaultZoom = 'monthly';
    /* Auto-zoom: di mobile/tablet pakai quarterly untuk hemat ruang */
    if (typeof window !== 'undefined' && window.innerWidth){
      if (window.innerWidth < 480) _defaultZoom = 'yearly';
      else if (window.innerWidth < 1024) _defaultZoom = 'quarterly';
    }
    var _state = { zoom: localStorage.getItem(ZOOM_KEY) || _defaultZoom };

    var ZOOM_CFG = {
      monthly:   { pxPerDay: 3.5, label: 'Bulanan' },
      quarterly: { pxPerDay: 1.8, label: 'Triwulan' },
      yearly:    { pxPerDay: 0.8, label: 'Tahunan' }
    };

    /* ── Helpers ── */
    var _esc = function(s){
      return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
      });
    };
    var _num = function(v){
      var n = parseFloat(String(v == null ? '' : v).replace(/[^\d.-]/g,''));
      return isFinite(n) ? n : 0;
    };
    var _fmt = function(n, d){
      d = d == null ? 2 : d;
      return (isFinite(n) ? Number(n) : 0).toLocaleString('id-ID', {
        minimumFractionDigits: d, maximumFractionDigits: d
      });
    };
    var _rp = function(n){ return 'Rp ' + Math.round(Number(n)||0).toLocaleString('id-ID'); };
    var _MON = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];

    /* ═══════════════════════════════════════════════════════════
       MODAL
       ═══════════════════════════════════════════════════════════ */
    function openModalPortfolio(){
      if (typeof openModal !== 'function'){
        console.warn('[PortfolioTimeline] openModal tidak tersedia');
        return;
      }
      if (!DB.projects || !DB.projects.length){
        if (typeof toast === 'function') toast('Belum ada proyek', false);
        return;
      }

      var html =
        '<div class="pt-toolbar">' +
          '<div class="pt-zoom-tabs">' +
            ['monthly','quarterly','yearly'].map(function(z){
              return '<button class="pt-zoom-btn' + (_state.zoom === z ? ' is-active' : '') +
                     '" data-zoom="' + z + '">' + ZOOM_CFG[z].label + '</button>';
            }).join('') +
          '</div>' +
          '<span class="pt-count">' + DB.projects.length + ' proyek</span>' +
        '</div>' +
        '<div id="ptContainer" class="pt-wrap"></div>';

      /* Buka modal wide */
      openModal('🌐 Portfolio Timeline', html, function(){ return false; });

      /* Hide default submit */
      setTimeout(function(){
        var sBtn = document.getElementById('mSubmit');
        if (sBtn) sBtn.style.display = 'none';
        var cBtn = document.getElementById('mCancel');
        if (cBtn) cBtn.textContent = 'Tutup';

        /* Wide modal */
        var modal = document.querySelector('#overlay .modal');
        if (modal) modal.classList.add('modal-wide');

        /* Wire zoom buttons */
        document.querySelectorAll('.pt-zoom-btn').forEach(function(btn){
          btn.onclick = function(){
            _state.zoom = btn.getAttribute('data-zoom');
            localStorage.setItem(ZOOM_KEY, _state.zoom);
            document.querySelectorAll('.pt-zoom-btn').forEach(function(b){
              b.classList.toggle('is-active', b === btn);
            });
            if (window.Loading && Loading.wrapSync){
              Loading.wrapSync(function(){ renderTimeline(); }, 'Memuat timeline…', 100);
            } else {
              renderTimeline();
            }
          };
        });

        /* Initial render dengan loading */
        if (window.Loading && Loading.wrapSync){
          Loading.wrapSync(function(){ renderTimeline(); }, 'Memuat portfolio…', 100);
        } else {
          renderTimeline();
        }
      }, 10);
    }

    /* ═══════════════════════════════════════════════════════════
       RENDER TIMELINE
       ═══════════════════════════════════════════════════════════ */
    function renderTimeline(){
      var container = document.getElementById('ptContainer');
      if (!container) return;

      var projects = DB.projects.slice().sort(function(a, b){
        return String(a.tgl_mulai || '').localeCompare(String(b.tgl_mulai || ''));
      });
      if (!projects.length){
        container.innerHTML = window.EmptyState
          ? EmptyState.build({
              icon: 'project',
              title: 'Belum ada proyek',
              message: 'Tambahkan proyek terlebih dahulu untuk melihat portfolio timeline.',
              cta: {
                label: '+ Proyek Baru',
                action: function(){
                  if (typeof closeModal === 'function') closeModal();
                  if (typeof switchTab === 'function') switchTab('projects');
                  if (typeof formProject === 'function') setTimeout(function(){ formProject(null); }, 200);
                }
              }
            })
          : '<div class="pt-empty">Belum ada proyek</div>';
        return;
      }

      /* Range tanggal */
      var allDates = [];
      projects.forEach(function(p){
        if (p.tgl_mulai)  allDates.push(p.tgl_mulai);
        if (p.tgl_selesai) allDates.push(p.tgl_selesai);
      });
      if (!allDates.length){
        container.innerHTML = '<div class="pt-empty">Proyek belum punya tanggal</div>';
        return;
      }
      allDates.sort();
      var minDate = new Date(allDates[0] + 'T00:00:00');
      var maxDate = new Date(allDates[allDates.length - 1] + 'T00:00:00');

      /* Padding 14 hari */
      var startDate = new Date(minDate); startDate.setDate(startDate.getDate() - 14);
      var endDate   = new Date(maxDate); endDate.setDate(endDate.getDate() + 14);

      var px = ZOOM_CFG[_state.zoom].pxPerDay;
      var totalDays = Math.round((endDate - startDate) / 86400000) + 1;
      var chartW = Math.max(600, totalDays * px);

      var ROW_H = 52;
      var HEADER_H = 60;
      var SIDEBAR_W = 280;
      var totalH = projects.length * ROW_H;

      /* ── Kumpulkan data tiap proyek ── */
      var rows = projects.map(function(p){
        var totals = { rab: 0, rap: 0, dev: 0, margin_pct: 0 };
        try { totals = Calc.totals(p.id); } catch(e){}

        /* Progress % (bobot cost) */
        var progressPct = computeProjectProgress(p.id);

        /* Health score */
        var nilaiKontrak = _num(p.nilai_kontrak);
        var netto = nilaiKontrak / 1.11;
        var marginScore = Math.min(100, Math.max(0, totals.margin_pct * 8.33));
        var sisaKontrak = netto - totals.rap;
        var budgetScore = sisaKontrak >= 0 ? 100 : Math.max(0, 100 + sisaKontrak/1e6);
        var health = Math.round(marginScore * 0.5 + budgetScore * 0.5);
        var healthCls = health >= 75 ? 'good' : health >= 50 ? 'warn' : 'bad';

        var sStr = p.tgl_mulai || '';
        var fStr = p.tgl_selesai || '';
        var sOff = sStr ? Math.round((new Date(sStr + 'T00:00:00') - startDate) / 86400000) : 0;
        var fOff = fStr ? Math.round((new Date(fStr + 'T00:00:00') - startDate) / 86400000) : 0;

        return {
          proj: p, totals: totals,
          progressPct: progressPct,
          health: health, healthCls: healthCls,
          sOff: sOff, fOff: fOff
        };
      });

      /* ── HTML ── */
      var html = '' +
        '<div class="pt-root">' +

          /* Header */
          '<div class="pt-head" style="height:' + HEADER_H + 'px;">' +
            '<div class="pt-head-sidebar" style="width:' + SIDEBAR_W + 'px;">' +
              '<div class="pt-head-title">Proyek</div>' +
            '</div>' +
            '<div class="pt-head-timeline" style="width:' + chartW + 'px;height:' + HEADER_H + 'px;">' +
              '<canvas class="pt-axis" width="' + chartW + '" height="' + HEADER_H + '"></canvas>' +
            '</div>' +
          '</div>' +

          /* Body */
          '<div class="pt-body">' +
            '<div class="pt-sidebar" style="width:' + SIDEBAR_W + 'px;">' +
              rows.map(function(r, i){
                return '<div class="pt-side-row" data-proj-id="' + _esc(r.proj.id) + '" style="height:' + ROW_H + 'px;">' +
                  '<div class="pt-side-kode">' + _esc(r.proj.kode) + '</div>' +
                  '<div class="pt-side-nama" title="' + _esc(r.proj.nama) + '">' + _esc(r.proj.nama) + '</div>' +
                  '<div class="pt-side-meta">' +
                    '<span class="pt-health ' + r.healthCls + '">' + r.health + '</span>' +
                    '<span class="pt-prog">' + Math.min(100, _num(r.progressPct)).toFixed(1).replace('.', ',') + '%</span>' +
                  '</div>' +
                '</div>';
              }).join('') +
            '</div>' +
            '<div class="pt-chart-wrap" style="width:' + chartW + 'px;">' +
              '<canvas class="pt-chart" width="' + chartW + '" height="' + totalH + '" style="width:' + chartW + 'px;height:' + totalH + 'px;"></canvas>' +
            '</div>' +
          '</div>' +

        '</div>';

      container.innerHTML = html;

      /* ── Render axis + bars ── */
      var axisCanvas = container.querySelector('.pt-axis');
      var chartCanvas = container.querySelector('.pt-chart');

      drawAxis(axisCanvas, startDate, endDate, px, HEADER_H);
      drawBars(chartCanvas, rows, startDate, px, ROW_H, chartW, totalH);

      /* ── Klik row untuk drill-down ── */
      container.querySelectorAll('[data-proj-id]').forEach(function(el){
        el.style.cursor = 'pointer';
        el.onclick = function(){
          var pid = el.getAttribute('data-proj-id');
          var proj = DB.projects.find(function(p){ return p.id === pid; });
          if (!proj) return;
          if (typeof STATE !== 'undefined'){
            STATE.activeProject = pid;
            var sel = document.getElementById('activeProject');
            if (sel) sel.value = pid;
          }
          if (typeof closeModal === 'function') closeModal();
          if (typeof renderAll === 'function') renderAll();
          if (typeof switchTab === 'function') switchTab('dashboard');
          if (typeof toast === 'function') toast('Beralih ke: ' + proj.kode);
        };
      });

      /* ── Klik bar area → juga drill-down ── */
      var cwrap = container.querySelector('.pt-chart-wrap');
      if (cwrap){
        cwrap.onclick = function(e){
          var rect = chartCanvas.getBoundingClientRect();
          var cy = e.clientY - rect.top;
          var idx = Math.floor(cy / ROW_H);
          if (idx < 0 || idx >= rows.length) return;
          var proj = rows[idx].proj;
          if (typeof STATE !== 'undefined'){
            STATE.activeProject = proj.id;
            var sel = document.getElementById('activeProject');
            if (sel) sel.value = proj.id;
          }
          if (typeof closeModal === 'function') closeModal();
          if (typeof renderAll === 'function') renderAll();
          if (typeof switchTab === 'function') switchTab('dashboard');
          if (typeof toast === 'function') toast('Beralih ke: ' + proj.kode);
        };
      }
    }

    /* ── Progress per proyek ── */
    function computeProjectProgress(pid){
      var tasks = DB.project_wbs.filter(function(w){
        return w.project_id === pid && !w.is_group;
      });
      if (!tasks.length) return 0;

      var totalWeight = 0;
      var totalDone = 0;
      tasks.forEach(function(t){
        var target = _num(t.volume_rab) || 1;
        var done = DB.progress
          .filter(function(p){ return p.project_id === pid && p.wbs_id === t.id; })
          .reduce(function(s, p){ return s + _num(p.volume); }, 0);
        var pct = Math.min(1, done / target);
        var weight = _num(t.volume_rab) * (typeof Calc !== 'undefined' && Calc.hargaSatuanRAB ? Calc.hargaSatuanRAB(pid, t.ahsp_id) : 1);
        totalWeight += weight;
        totalDone += weight * pct;
      });
      return totalWeight > 0 ? (totalDone / totalWeight * 100) : 0;
    }

    /* ═══════════════════════════════════════════════════════════
       DRAW AXIS
       ═══════════════════════════════════════════════════════════ */
    function drawAxis(canvas, startDate, endDate, px, H){
      if (!canvas) return;
      var ctx = canvas.getContext('2d');
      var W = canvas.width;

      ctx.fillStyle = '#0e1a30';
      ctx.fillRect(0, 0, W, H);

      /* Bulan-bulan */
      var d = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
      while (d <= endDate){
        var next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
        var x1 = ((d - startDate) / 86400000) * px;
        var x2 = ((next - startDate) / 86400000) * px;
        var cx = (x1 + x2) / 2;

        ctx.strokeStyle = 'rgba(90, 122, 176, .5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(Math.round(x1) + 0.5, 0);
        ctx.lineTo(Math.round(x1) + 0.5, H);
        ctx.stroke();

        if (cx > -60 && cx < W + 60){
          ctx.fillStyle = d.getMonth() === 0 ? '#e6edf7' : '#a8b8d6';
          ctx.font = (d.getMonth() === 0 ? 'bold ' : '') + '11px Segoe UI';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          var label = _MON[d.getMonth()].toUpperCase() + (d.getMonth() === 0 ? ' ' + String(d.getFullYear()).slice(-2) : '');
          ctx.fillText(label, cx, H / 2);
        }
        d = next;
      }

      /* Border bawah */
      ctx.strokeStyle = '#24365c';
      ctx.beginPath();
      ctx.moveTo(0, H - 0.5);
      ctx.lineTo(W, H - 0.5);
      ctx.stroke();
    }

    /* ═══════════════════════════════════════════════════════════
       DRAW BARS
       ═══════════════════════════════════════════════════════════ */
    function drawBars(canvas, rows, startDate, px, ROW_H, W, H){
      if (!canvas) return;
      var ctx = canvas.getContext('2d');

      ctx.clearRect(0, 0, W, H);

      /* Zebra + today marker */
      var today = new Date(); today.setHours(0,0,0,0);
      var todayOff = Math.round((today - startDate) / 86400000);
      var todayX = todayOff * px + px / 2;

      rows.forEach(function(r, i){
        var y = i * ROW_H;

        /* Zebra */
        if (i % 2 === 0){
          ctx.fillStyle = 'rgba(255,255,255,.015)';
          ctx.fillRect(0, y, W, ROW_H);
        }

        /* Grid horizontal */
        ctx.strokeStyle = 'rgba(60, 90, 130, .3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, y + ROW_H - 0.5);
        ctx.lineTo(W, y + ROW_H - 0.5);
        ctx.stroke();

        /* Bar background (light) */
        var barX = r.sOff * px;
        var barW = Math.max(8, (r.fOff - r.sOff + 1) * px);
        var barH = 26;
        var barY = y + (ROW_H - barH) / 2;

        /* Bar color by health */
        var fillColor, strokeColor;
        if (r.healthCls === 'good'){ fillColor = '#22c55e'; strokeColor = '#15803d'; }
        else if (r.healthCls === 'warn'){ fillColor = '#f59e0b'; strokeColor = '#b45309'; }
        else { fillColor = '#dc2626'; strokeColor = '#7f1d1d'; }

        /* Light bg */
        ctx.fillStyle = 'rgba(255,255,255,.06)';
        roundRect(ctx, barX, barY, barW, barH, 5);
        ctx.fill();

        /* Progress overlay */
        if (r.progressPct > 0){
          var progW = Math.max(3, barW * r.progressPct / 100);
          ctx.fillStyle = fillColor;
          roundRect(ctx, barX, barY, progW, barH, 5);
          ctx.fill();

          /* Progress line */
          if (r.progressPct < 100){
            ctx.save();
            ctx.fillStyle = '#0b1220';
            ctx.fillRect(barX + progW - 1.5, barY + 2, 3, barH - 4);
            ctx.restore();
          }
        }

        /* Border */
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1.5;
        roundRect(ctx, barX + 0.75, barY + 0.75, barW - 1.5, barH - 1.5, 5);
        ctx.stroke();

        /* Label % di tengah */
        if (barW > 60){
          ctx.fillStyle = '#fff';
          ctx.font = 'bold 11px Segoe UI';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(_fmt(r.progressPct, 1) + '%', barX + barW / 2, barY + barH / 2);
        }

        /* Label kode proyek di kiri bar (kalau bar pendek) */
        if (barW < 60){
          ctx.fillStyle = '#e6edf7';
          ctx.font = 'bold 10px Segoe UI';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(r.proj.kode, barX + barW + 6, barY + barH / 2);
        }
      });

      /* Today marker */
      if (todayX >= 0 && todayX <= W){
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(todayX, 0);
        ctx.lineTo(todayX, H);
        ctx.stroke();
        ctx.setLineDash([]);

        /* Label today */
        ctx.fillStyle = 'rgba(245, 158, 11, .95)';
        var label = '📍 Hari ini';
        ctx.font = 'bold 10px Segoe UI';
        var tw = ctx.measureText(label).width;
        var bw = tw + 12;
        roundRect(ctx, todayX - bw / 2, 4, bw, 18, 4);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, todayX, 13);
      }
    }

    function roundRect(ctx, x, y, w, h, r){
      if (w < 2*r) r = w / 2;
      if (h < 2*r) r = h / 2;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y,     x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x,     y + h, r);
      ctx.arcTo(x,     y + h, x,     y,     r);
      ctx.arcTo(x,     y,     x + w, y,     r);
      ctx.closePath();
    }

    /* ═══════════════════════════════════════════════════════════
       WIRE TOMBOL DI TAB EXECUTIVE
       ═══════════════════════════════════════════════════════════ */
    function wireExecButton(){
      var btnRefresh = document.getElementById('btnExecRefresh');
      if (!btnRefresh) return;
      if (document.getElementById('btnPortfolioTimeline')) return;

      var btn = document.createElement('button');
      btn.className = 'btn btn-sm';
      btn.id = 'btnPortfolioTimeline';
      btn.title = 'Portfolio Timeline — multi-proyek dalam 1 view';
      btn.textContent = '🌐 Portfolio Timeline';
      btn.style.cssText = 'background:linear-gradient(135deg,#a855f7,#7c3aed);border-color:transparent;color:#fff';
      btn.onclick = openModalPortfolio;

      btnRefresh.parentNode.insertBefore(btn, btnRefresh.nextSibling);
    }

    /* ═══════════════════════════════════════════════════════════
       PUBLIC API
       ═══════════════════════════════════════════════════════════ */
    window.openPortfolioTimeline = openModalPortfolio;
    window.PortfolioTimeline = { open: openModalPortfolio };

    /* ── Init ── */
    function init(){
      wireExecButton();
      /* Retry karena tab Executive bisa di-render setelah init */
      setTimeout(wireExecButton, 1000);
      setTimeout(wireExecButton, 3000);
    }
    if (document.readyState === 'loading'){
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }

    /* Hook ke switchTab Executive */
    if (typeof window._origSwitchTab === 'undefined' && typeof switchTab === 'function'){
      window._origSwitchTab = switchTab;
      window.switchTab = function(name){
        window._origSwitchTab(name);
        if (name === 'executive') setTimeout(wireExecButton, 100);
      };
    }

    console.log('%c[PortfolioTimeline.js] ✅ Portfolio Timeline installed',
      'color:#a855f7;font-weight:bold;font-size:13px');
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ bootstrap(0); });
  } else {
    bootstrap(0);
  }
})();
