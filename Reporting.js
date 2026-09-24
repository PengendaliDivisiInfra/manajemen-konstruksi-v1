/* =====================================================================
 * MANAJEMEN KONSTRUKSI v1 — REPORTING ENGINE
 * Fase 3D: 5 Template Report + Print Preview + Export PDF
 * Loaded AFTER Schedule.js — independent module
 * Tidak menyentuh Schedule.js
 * ===================================================================== */

(function reportingModule(){
  function bootstrap(attempt){
    attempt = attempt || 0;
    if (typeof GanttEngine === 'undefined' || typeof Calc === 'undefined' ||
        typeof DB === 'undefined' || !DB){
      if (attempt > 50){
        console.error('[Reporting.js] Engine belum siap setelah 15 detik — menyerah');
        return;
      }
      setTimeout(function(){ bootstrap(attempt + 1); }, 300);
      return;
    }
    install();
  }

  function install(){
    if (window._reportingModuleInstalled) return;
    window._reportingModuleInstalled = true;

    /* ═══════════════════════════════════════════════════════════
       UTILITIES
       ═══════════════════════════════════════════════════════════ */
    var _esc = function(s){
      return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
      });
    };
    var _num = function(v){
      var n = parseFloat(String(v == null ? '' : v).replace(/[^\d.-]/g,''));
      return isFinite(n) ? n : 0;
    };
    /* Format Rp penuh (untuk kolom tabel kecil) */
    var _rp = function(n){
      return 'Rp ' + Math.round(Number(n)||0).toLocaleString('id-ID');
    };

    /* Format Rp singkat (untuk KPI/value besar — anti wrap) */
    var _rpShort = function(n){
      var v = Number(n) || 0;
      var abs = Math.abs(v);
      if (abs >= 1e12) return 'Rp ' + (v/1e12).toFixed(2).replace('.', ',') + ' T';
      if (abs >= 1e9)  return 'Rp ' + (v/1e9).toFixed(2).replace('.', ',')  + ' M';
      if (abs >= 1e6)  return 'Rp ' + (v/1e6).toFixed(2).replace('.', ',')  + ' jt';
      if (abs >= 1e3)  return 'Rp ' + (v/1e3).toFixed(1).replace('.', ',')  + ' rb';
      return 'Rp ' + Math.round(v).toLocaleString('id-ID');
    };
    var _fmt = function(n, d){
      d = d == null ? 2 : d;
      return (isFinite(n) ? Number(n) : 0).toLocaleString('id-ID', {
        minimumFractionDigits: d, maximumFractionDigits: d
      });
    };
    var _todayISO = function(){
      return new Date().toISOString().slice(0,10);
    };
    var _fmtDate = function(iso){
      if (!iso) return '—';
      var parts = String(iso).split('T')[0].split('-');
      if (parts.length !== 3) return iso;
      var bulan = ['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
      return parseInt(parts[2],10) + ' ' + bulan[parseInt(parts[1],10)-1] + ' ' + parts[0];
    };

    /* ═══════════════════════════════════════════════════════════
       TEMPLATE REGISTRY
       ═══════════════════════════════════════════════════════════ */
    var TEMPLATES = {
      executive: {
        id: 'executive',
        label: '📊 Executive Summary',
        desc: 'Ringkasan KPI proyek: kontrak, RAB/RAP, margin, EVM, jadwal',
        orientation: 'portrait'
      },
      task_detail: {
        id: 'task_detail',
        label: '📋 Task Detail',
        desc: 'Daftar lengkap task WBS dengan jadwal, predecessor, resource, biaya',
        orientation: 'landscape'
      },
      cost: {
        id: 'cost',
        label: '💰 Cost Report',
        desc: 'Breakdown biaya RAB vs RAP, komposisi Upah/Bahan/Alat, S-Curve',
        orientation: 'portrait'
      },
      critical: {
        id: 'critical',
        label: '🔥 Critical Path',
        desc: 'Semua task dengan Total Float = 0 + jalur kritis',
        orientation: 'portrait'
      },
      variance: {
        id: 'variance',
        label: '📉 Variance Report',
        desc: 'Baseline vs Current · slip analysis · variance cost',
        orientation: 'portrait'
      }
    };

    /* ═══════════════════════════════════════════════════════════
       REPORT DIALOG (di main window)
       ═══════════════════════════════════════════════════════════ */
    function openDialog(){
      if (typeof STATE === 'undefined' || !STATE.activeProject){
        if (typeof toast === 'function') toast('Pilih proyek aktif dulu', false);
        return;
      }
      var pid = STATE.activeProject;
      var proj = DB.projects.find(function(p){ return p.id === pid; });
      if (!proj){
        if (typeof toast === 'function') toast('Proyek tidak ditemukan', false);
        return;
      }

      var body =
        '<div style="margin-bottom:14px;font-size:12.5px;color:var(--muted)">' +
          'Pilih template report untuk proyek: <b style="color:#7cb3ff">' + _esc(proj.kode) + ' — ' + _esc(proj.nama) + '</b>' +
        '</div>' +

        '<div class="rpt-template-grid">' +
          Object.keys(TEMPLATES).map(function(k){
            var t = TEMPLATES[k];
            return '<div class="rpt-tpl-card" data-tpl="' + k + '">' +
              '<div class="rpt-tpl-icon">' + t.label.split(' ')[0] + '</div>' +
              '<div class="rpt-tpl-name">' + _esc(t.label.replace(/^[^\s]+\s/, '')) + '</div>' +
              '<div class="rpt-tpl-desc">' + _esc(t.desc) + '</div>' +
              '<div class="rpt-tpl-orient">' + (t.orientation === 'landscape' ? '🖼 Landscape' : '📄 Portrait') + '</div>' +
            '</div>';
          }).join('') +
        '</div>' +

        '<div class="sep"></div>' +

        '<div style="display:flex;gap:14px;flex-wrap:wrap">' +
          '<div class="field" style="flex:1;min-width:160px">' +
            '<label class="f">Mode Biaya</label>' +
            '<select id="rptMode">' +
              '<option value="rab">RAB (Rencana)</option>' +
              '<option value="rap">RAP (Realisasi)</option>' +
              '<option value="both">Keduanya</option>' +
            '</select>' +
          '</div>' +
          '<div class="field" style="flex:1;min-width:160px">' +
            '<label class="f">Tanggal Report</label>' +
            '<input id="rptDate" type="date" value="' + _todayISO() + '" />' +
          '</div>' +
          '<div class="field" style="flex:1;min-width:160px">' +
            '<label class="f">Disiapkan Oleh</label>' +
            '<input id="rptAuthor" value="Quantity Surveyor" placeholder="Nama" />' +
          '</div>' +
        '</div>' +

        '<div style="margin-top:14px;font-size:11px;color:var(--muted);line-height:1.6">' +
          '💡 Report dibuka di window baru → bisa langsung <b>Print</b> atau <b>Save as PDF</b> ' +
          'melalui dialog print browser (Ctrl+P).' +
        '</div>';

      if (typeof openModal !== 'function'){
        console.warn('[Reporting] openModal tidak tersedia');
        return;
      }

      openModal('📄 Generate Report', body, function(){ return false; });

      /* Fase E-1: di mobile, force modal jadi full-width (via class) */
      setTimeout(function(){
        var modal = document.querySelector('#overlay .modal');
        if (modal && window.innerWidth < 768){
          modal.classList.add('modal-wide');
        }
      }, 20);

      /* Hide default submit, ganti dengan tombol Generate */
      setTimeout(function(){
        var submitBtn = document.getElementById('mSubmit');
        if (submitBtn){
          submitBtn.textContent = '📄 Generate Report';
          submitBtn.style.display = '';
          submitBtn.onclick = function(){
            var selected = document.querySelector('.rpt-tpl-card.is-selected');
            if (!selected){
              if (typeof toast === 'function') toast('Pilih template dulu', false);
              return;
            }
            var tpl = selected.getAttribute('data-tpl');
            var opts = {
              mode: document.getElementById('rptMode').value,
              date: document.getElementById('rptDate').value,
              author: document.getElementById('rptAuthor').value || 'Quantity Surveyor'
            };
            if (typeof closeModal === 'function') closeModal();
            setTimeout(function(){ generate(tpl, pid, opts); }, 150);
          };
        }

        /* Highlight first card by default */
        var firstCard = document.querySelector('.rpt-tpl-card');
        if (firstCard) firstCard.classList.add('is-selected');

        document.querySelectorAll('.rpt-tpl-card').forEach(function(card){
          card.onclick = function(){
            document.querySelectorAll('.rpt-tpl-card').forEach(function(c){
              c.classList.remove('is-selected');
            });
            card.classList.add('is-selected');
          };
        });
      }, 10);
    }

    /* ═══════════════════════════════════════════════════════════
       GENERATE REPORT
       ═══════════════════════════════════════════════════════════ */
    function generate(templateId, projectId, opts){
      var proj = DB.projects.find(function(p){ return p.id === projectId; });
      if (!proj){
        if (typeof toast === 'function') toast('Proyek tidak ditemukan', false);
        return;
      }

      var tpl = TEMPLATES[templateId];
      if (!tpl){
        if (typeof toast === 'function') toast('Template tidak valid', false);
        return;
      }

      var html;
      try {
        switch (templateId){
          case 'executive':   html = buildExecutive(proj, opts); break;
          case 'task_detail': html = buildTaskDetail(proj, opts); break;
          case 'cost':        html = buildCostReport(proj, opts); break;
          case 'critical':    html = buildCriticalPath(proj, opts); break;
          case 'variance':    html = buildVariance(proj, opts); break;
          default:
            if (typeof toast === 'function') toast('Template belum tersedia', false);
            return;
        }
      } catch (e){
        console.error('[Reporting] generate error:', e);
        if (typeof toast === 'function') toast('Gagal generate report: ' + e.message, false);
        return;
      }

      printWindow(html, proj, tpl);
      if (typeof toast === 'function') toast('📄 Report ' + tpl.label + ' siap dicetak');
    }

    /* ═══════════════════════════════════════════════════════════
       PRINT WINDOW
       ═══════════════════════════════════════════════════════════ */
    function printWindow(bodyHTML, proj, tpl){
      var win = window.open('', '_blank');
      if (!win){
        if (typeof toast === 'function') toast('Popup diblokir browser', false);
        return;
      }

      /* Auto-enforce orientasi sesuai template */
      var orientationCSS =
        '<style>@page { size: A4 ' + (tpl.orientation === 'landscape' ? 'landscape' : 'portrait') + '; margin: 15mm 12mm; }</style>';

      var fullHTML =
        '<!DOCTYPE html>' +
        '<html lang="id">' +
        '<head>' +
          '<meta charset="UTF-8">' +
          '<title>' + _esc(proj.kode) + ' — ' + _esc(tpl.label.replace(/^[^\s]+\s/, '')) + '</title>' +
          '<style>' + REPORT_CSS + '</style>' +
          orientationCSS +
        '</head>' +
        '<body>' +
          bodyHTML +
          '<div class="rpt-print-toolbar no-print">' +
            '<button onclick="window.print()">🖨 Print / Save as PDF</button>' +
            '<button onclick="window.close()">✕ Tutup</button>' +
            '<span class="rpt-hint">Ctrl+P → pilih "Save as PDF" untuk export</span>' +
          '</div>' +
        '</body>' +
        '</html>';

      win.document.open();
      win.document.write(fullHTML);
      win.document.close();

      /* Auto-focus window baru */
      setTimeout(function(){ try { win.focus(); } catch(e){} }, 200);
    }

    /* ═══════════════════════════════════════════════════════════
       TEMPLATE: EXECUTIVE SUMMARY
       ═══════════════════════════════════════════════════════════ */
    function buildExecutive(proj, opts){
      var t = Calc.totals(proj.id);
      var nilaiKontrak = _num(proj.nilai_kontrak);
      var netto = nilaiKontrak / (1 + _num(typeof SET !== 'undefined' ? SET.ppn : 11) / 100);
      var margin = t.margin_pct || 0;
      var sisaKontrak = netto - t.rap;

      var evm = null;
      try { evm = Calc.evm(proj.id); } catch(e){}

      var items = DB.project_wbs.filter(function(w){ return w.project_id === proj.id && !w.is_group; });
      var critical = items.filter(function(w){ return _num(w.is_critical) === 1; });

      var header = reportHeader(proj, opts, 'Executive Summary');

      var kpiCards =
        '<div class="rpt-kpi-grid">' +
          kpiCard('Nilai Kontrak',            _rpShort(nilaiKontrak),   'Netto: ' + _rpShort(netto)) +
          kpiCard('Total RAB',                _rpShort(t.rab),          (t.rab/(netto||1)*100).toFixed(2) + '% dari kontrak netto', 'blue') +
          kpiCard('Total RAP',                _rpShort(t.rap),          'Bersih tanpa profit', 'orange') +
          kpiCard('Margin / Deviasi',         _rpShort(t.dev),          _fmt(margin, 2) + '% dari RAB', t.dev >= 0 ? 'green' : 'red') +
          kpiCard('Sisa Terhadap Kontrak',    _rpShort(sisaKontrak),    t.rap <= netto ? '✅ Di bawah pagu' : '⚠ Melebihi pagu', t.rap <= netto ? 'green' : 'red') +
          kpiCard('Total Task',               String(items.length),     critical.length + ' kritis', 'blue') +
        '</div>';

      var projectInfo =
        '<div class="rpt-section">' +
          '<h2>Informasi Proyek</h2>' +
          '<table class="rpt-info-tbl">' +
            '<tr><td class="k">Kode</td><td>' + _esc(proj.kode) + '</td>' +
                '<td class="k">Lokasi</td><td>' + _esc(proj.lokasi || '—') + '</td></tr>' +
            '<tr><td class="k">Nama</td><td>' + _esc(proj.nama) + '</td>' +
                '<td class="k">Owner</td><td>' + _esc(proj.owner || '—') + '</td></tr>' +
            '<tr><td class="k">Tanggal Mulai</td><td>' + _fmtDate(proj.tgl_mulai) + '</td>' +
                '<td class="k">Tanggal Selesai</td><td>' + _fmtDate(proj.tgl_selesai) + '</td></tr>' +
            '<tr><td class="k">Durasi</td><td>' + (proj.durasi_hari || 0) + ' hari (' + (proj.durasi_minggu || 0) + ' minggu)</td>' +
                '<td class="k">Status</td><td>' + _esc(proj.status || '—') + '</td></tr>' +
          '</table>' +
        '</div>';

      var evmSection = '';
      if (evm && evm.ok){
        evmSection =
          '<div class="rpt-section">' +
            '<h2>Earned Value Management</h2>' +
            '<table class="rpt-info-tbl">' +
              '<tr><td class="k">SPI</td><td class="' + (evm.SPI >= 0.95 ? 'ok' : 'warn') + '"><b>' + _fmt(evm.SPI, 3) + '</b></td>' +
                  '<td class="k">CPI</td><td class="' + (evm.CPI >= 0.95 ? 'ok' : 'warn') + '"><b>' + _fmt(evm.CPI, 3) + '</b></td></tr>' +
              '<tr><td class="k">SV</td><td>' + _rp(evm.SV) + '</td>' +
                  '<td class="k">CV</td><td>' + _rp(evm.CV) + '</td></tr>' +
              '<tr><td class="k">EAC</td><td>' + _rp(evm.EAC) + '</td>' +
                  '<td class="k">VAC</td><td class="' + (evm.VAC >= 0 ? 'ok' : 'bad') + '">' + _rp(evm.VAC) + '</td></tr>' +
            '</table>' +
          '</div>';
      }

      var rekap =
        '<div class="rpt-section">' +
          '<h2>Rekapitulasi Biaya</h2>' +
          '<table class="rpt-tbl">' +
            '<thead><tr><th>Uraian</th><th class="num">RAB</th><th class="num">RAP</th><th class="num">Deviasi</th></tr></thead>' +
            '<tbody>' +
              '<tr><td>Upah</td><td class="num">' + _rp(t.upahRAB) + '</td><td class="num">' + _rp(t.upahRAP) + '</td><td class="num ' + (t.upahRAB-t.upahRAP >= 0 ? 'ok' : 'bad') + '">' + _rp(t.upahRAB-t.upahRAP) + '</td></tr>' +
              '<tr><td>Bahan</td><td class="num">' + _rp(t.bahanRAB) + '</td><td class="num">' + _rp(t.bahanRAP) + '</td><td class="num ' + (t.bahanRAB-t.bahanRAP >= 0 ? 'ok' : 'bad') + '">' + _rp(t.bahanRAB-t.bahanRAP) + '</td></tr>' +
              '<tr><td>Alat</td><td class="num">' + _rp(t.alatRAB) + '</td><td class="num">' + _rp(t.alatRAP) + '</td><td class="num ' + (t.alatRAB-t.alatRAP >= 0 ? 'ok' : 'bad') + '">' + _rp(t.alatRAB-t.alatRAP) + '</td></tr>' +
              '<tr class="total"><td><b>TOTAL</b></td><td class="num"><b>' + _rp(t.rab) + '</b></td><td class="num"><b>' + _rp(t.rap) + '</b></td><td class="num ' + (t.dev >= 0 ? 'ok' : 'bad') + '"><b>' + _rp(t.dev) + '</b></td></tr>' +
            '</tbody>' +
          '</table>' +
        '</div>';

      return wrapPage(header + kpiCards + projectInfo + evmSection + rekap, proj);
    }

    /* ═══════════════════════════════════════════════════════════
       TEMPLATE: TASK DETAIL
       ═══════════════════════════════════════════════════════════ */
    function buildTaskDetail(proj, opts){
      var rows = Calc.wbsRows(proj.id);
      var header = reportHeader(proj, opts, 'Task Detail');
      var items = rows.filter(function(w){ return !w.isGroup; });

      var rowsHTML = items.map(function(w){
        var raw = DB.project_wbs.find(function(x){ return x.id === w.id; }) || {};
        var predLabel = raw.predecessor
          ? (DB.project_wbs.find(function(x){ return x.id === raw.predecessor; }) || {}).kode_wbs + ' ' + (raw.pred_type || 'FS')
          : '—';
        return '<tr>' +
          '<td>' + _esc(w.kode_wbs) + '</td>' +
          '<td>' + _esc(w.uraian) + '</td>' +
          '<td class="c">' + _esc(w.satuan) + '</td>' +
          '<td class="n">' + _fmt(w.volume_rab, 2) + '</td>' +
          '<td class="n">' + _rp(w.total_rab) + '</td>' +
          '<td class="c">' + (raw.durasi_hari || raw.duration || 1) + 'd</td>' +
          '<td class="c">' + _fmtDate(raw.tgl_mulai_rencana) + '</td>' +
          '<td class="c">' + _fmtDate(raw.tgl_selesai_rencana) + '</td>' +
          '<td class="c">' + _esc(predLabel) + '</td>' +
          '<td class="c">' + (_num(raw.is_critical) === 1 ? '★' : '') + '</td>' +
          '<td class="n">' + _fmt(_num(raw.float_total || raw.total_float), 0) + '</td>' +
        '</tr>';
      }).join('');

      var total = Calc.totals(proj.id);

      var content =
        '<div class="rpt-section">' +
          '<table class="rpt-tbl rpt-tbl-sm">' +
            '<thead><tr>' +
              '<th>Kode</th><th>Uraian</th><th>Sat</th>' +
              '<th class="num">Vol</th><th class="num">Total RAB</th>' +
              '<th class="c">Dur</th><th class="c">Mulai</th><th class="c">Selesai</th>' +
              '<th class="c">Pred</th><th class="c">★</th><th class="num">Float</th>' +
            '</tr></thead>' +
            '<tbody>' + rowsHTML + '</tbody>' +
            '<tfoot><tr class="total">' +
              '<td colspan="4"><b>TOTAL</b></td>' +
              '<td class="n"><b>' + _rp(total.rab) + '</b></td>' +
              '<td colspan="6"></td>' +
            '</tr></tfoot>' +
          '</table>' +
        '</div>';

      return wrapPage(header + content, proj);
    }

    /* ═══════════════════════════════════════════════════════════
       TEMPLATE: COST REPORT
       ═══════════════════════════════════════════════════════════ */
    function buildCostReport(proj, opts){
      var t = Calc.totals(proj.id);
      var header = reportHeader(proj, opts, 'Cost Report');

      var komposisi =
        '<div class="rpt-section">' +
          '<h2>Komposisi Biaya</h2>' +
          '<table class="rpt-tbl">' +
            '<thead><tr><th>Kategori</th><th class="num">RAB</th><th class="num">% RAB</th>' +
              '<th class="num">RAP</th><th class="num">% RAP</th><th class="num">Deviasi</th></tr></thead>' +
            '<tbody>' +
              komposisiRow('Upah', t.upahRAB, t.upahRAP, t.rab, t.rap) +
              komposisiRow('Bahan', t.bahanRAB, t.bahanRAP, t.rab, t.rap) +
              komposisiRow('Alat', t.alatRAB, t.alatRAP, t.rab, t.rap) +
              '<tr class="total"><td><b>TOTAL</b></td>' +
                '<td class="num"><b>' + _rp(t.rab) + '</b></td><td class="num"><b>100%</b></td>' +
                '<td class="num"><b>' + _rp(t.rap) + '</b></td><td class="num"><b>100%</b></td>' +
                '<td class="num ' + (t.dev >= 0 ? 'ok' : 'bad') + '"><b>' + _rp(t.dev) + '</b></td>' +
              '</tr>' +
            '</tbody>' +
          '</table>' +
        '</div>';

      var summary =
        '<div class="rpt-section">' +
          '<h2>Ringkasan Biaya</h2>' +
          '<table class="rpt-info-tbl">' +
            '<tr><td class="k">Total RAB</td><td>' + _rp(t.rab) + '</td>' +
                '<td class="k">Total RAP</td><td>' + _rp(t.rap) + '</td></tr>' +
            '<tr><td class="k">Deviasi</td><td class="' + (t.dev >= 0 ? 'ok' : 'bad') + '"><b>' + _rp(t.dev) + '</b></td>' +
                '<td class="k">Margin %</td><td class="' + (t.margin_pct >= 8 ? 'ok' : 'warn') + '"><b>' + _fmt(t.margin_pct, 2) + '%</b></td></tr>' +
            '<tr><td class="k">RAB Netto (tanpa PPN)</td><td>' + _rp(t.rab_netto) + '</td>' +
                '<td class="k">PPN</td><td>' + _rp(t.ppn) + '</td></tr>' +
          '</table>' +
        '</div>';

      return wrapPage(header + summary + komposisi, proj);
    }

    function komposisiRow(label, rab, rap, totRAB, totRAP){
      var pctRAB = totRAB > 0 ? (rab / totRAB * 100) : 0;
      var pctRAP = totRAP > 0 ? (rap / totRAP * 100) : 0;
      var dev = rab - rap;
      return '<tr><td>' + label + '</td>' +
        '<td class="num">' + _rp(rab) + '</td>' +
        '<td class="num">' + _fmt(pctRAB, 2) + '%</td>' +
        '<td class="num">' + _rp(rap) + '</td>' +
        '<td class="num">' + _fmt(pctRAP, 2) + '%</td>' +
        '<td class="num ' + (dev >= 0 ? 'ok' : 'bad') + '">' + _rp(dev) + '</td></tr>';
    }

    /* ═══════════════════════════════════════════════════════════
       TEMPLATE: CRITICAL PATH
       ═══════════════════════════════════════════════════════════ */
    function buildCriticalPath(proj, opts){
      var header = reportHeader(proj, opts, 'Critical Path Analysis');

      var rows = DB.project_wbs.filter(function(w){
        return w.project_id === proj.id && !w.is_group && _num(w.is_critical) === 1;
      }).sort(function(a, b){
        return String(a.tgl_mulai_rencana || '').localeCompare(String(b.tgl_mulai_rencana || ''));
      });

      var totalDur = rows.reduce(function(s, w){ return s + _num(w.durasi_hari || w.duration || 1); }, 0);

      var intro =
        '<div class="rpt-section">' +
          '<p class="rpt-p">Jalur kritis adalah rangkaian task dengan <b>Total Float = 0</b>. ' +
          'Keterlambatan pada task ini akan <b>menunda keseluruhan proyek</b>. ' +
          'Ditemukan <b>' + rows.length + ' task kritis</b> dengan total durasi kritis <b>' + totalDur + ' hari kerja</b>.</p>' +
        '</div>';

      var rowsHTML = rows.map(function(w, i){
        return '<tr>' +
          '<td class="c">' + (i + 1) + '</td>' +
          '<td>' + _esc(w.kode_wbs) + '</td>' +
          '<td>' + _esc(w.uraian) + '</td>' +
          '<td class="c">' + (w.durasi_hari || w.duration || 1) + 'd</td>' +
          '<td class="c">' + _fmtDate(w.tgl_mulai_rencana) + '</td>' +
          '<td class="c">' + _fmtDate(w.tgl_selesai_rencana) + '</td>' +
          '<td class="c">' + _fmt(_num(w.float_total || w.total_float), 0) + 'd</td>' +
        '</tr>';
      }).join('');

      var content =
        '<div class="rpt-section">' +
          '<table class="rpt-tbl">' +
            '<thead><tr><th class="c">#</th><th>Kode</th><th>Uraian</th>' +
              '<th class="c">Durasi</th><th class="c">Mulai</th><th class="c">Selesai</th>' +
              '<th class="c">Float</th></tr></thead>' +
            '<tbody>' + (rowsHTML || '<tr><td colspan="7" class="c" style="padding:20px;font-style:italic">Tidak ada task kritis</td></tr>') + '</tbody>' +
          '</table>' +
        '</div>';

      return wrapPage(header + intro + content, proj);
    }

    /* ═══════════════════════════════════════════════════════════
       TEMPLATE: VARIANCE REPORT
       ═══════════════════════════════════════════════════════════ */
    function buildVariance(proj, opts){
      var header = reportHeader(proj, opts, 'Variance Report');

      /* Cari baseline aktif */
      var baselineIdx = 0;
      if (typeof Baseline !== 'undefined'){
        if (Baseline.isSet(proj.id, 3)) baselineIdx = 3;
        else if (Baseline.isSet(proj.id, 2)) baselineIdx = 2;
        else if (Baseline.isSet(proj.id, 1)) baselineIdx = 1;
      }

      if (!baselineIdx){
        var noBL =
          '<div class="rpt-section">' +
            '<p class="rpt-p">⚠ <b>Baseline belum di-set.</b> ' +
            'Untuk analisis variance, jalankan:</p>' +
            '<ol class="rpt-ol">' +
              '<li>Buka tab <b>Master Schedule</b> → Gantt</li>' +
              '<li>Pilih Baseline di dropdown → klik 📌 Set</li>' +
              '<li>Ulangi report ini</li>' +
            '</ol>' +
          '</div>';
        return wrapPage(header + noBL, proj);
      }

      var vars = Baseline.variance(proj.id, baselineIdx);
      var kpi = Baseline.kpi(proj.id, baselineIdx);

      var intro =
        '<div class="rpt-section">' +
          '<p class="rpt-p">Analisis variance terhadap <b>Baseline BL' + baselineIdx + '</b>:</p>' +
          '<div class="rpt-kpi-grid">' +
            kpiCard('Total Task', String(kpi.total), '', 'blue') +
            kpiCard('On-Time', String(kpi.onTime), '', 'green') +
            kpiCard('Late', String(kpi.late), _fmt(kpi.pctLate, 1) + '% dari total', 'red') +
            kpiCard('Avg Slip', _fmt(kpi.avgSlip, 1) + 'd', 'Max: ' + kpi.maxSlip + 'd', 'orange') +
          '</div>' +
        '</div>';

      var rowsHTML = vars.map(function(v){
        var slipCls = v.slip === null ? '' : (v.slip > 0 ? 'bad' : v.slip < 0 ? 'ok' : '');
        var slipTxt = v.slip === null ? '—' : (v.slip > 0 ? '+' + v.slip + 'd' : v.slip + 'd');
        return '<tr>' +
          '<td>' + _esc(v.w.kode_wbs) + '</td>' +
          '<td>' + _esc(v.w.uraian) + '</td>' +
          '<td class="c">' + _fmtDate(v.bStart) + '</td>' +
          '<td class="c">' + _fmtDate(v.bFinish) + '</td>' +
          '<td class="c">' + _fmtDate(v.cStart) + '</td>' +
          '<td class="c">' + _fmtDate(v.cFinish) + '</td>' +
          '<td class="c ' + slipCls + '"><b>' + slipTxt + '</b></td>' +
        '</tr>';
      }).join('');

      var content =
        '<div class="rpt-section">' +
          '<table class="rpt-tbl rpt-tbl-sm">' +
            '<thead><tr><th>Kode</th><th>Uraian</th>' +
              '<th class="c">Baseline Mulai</th><th class="c">Baseline Selesai</th>' +
              '<th class="c">Current Mulai</th><th class="c">Current Selesai</th>' +
              '<th class="c">Slip</th></tr></thead>' +
            '<tbody>' + (rowsHTML || '<tr><td colspan="7" class="c" style="padding:20px">Tidak ada data variance</td></tr>') + '</tbody>' +
          '</table>' +
        '</div>';

      return wrapPage(header + intro + content, proj);
    }

    /* ═══════════════════════════════════════════════════════════
       SHARED COMPONENTS
       ═══════════════════════════════════════════════════════════ */
    function wrapPage(content, proj){
      return (
        '<div class="rpt-watermark">' + _esc(proj.kode) + '</div>' +
        '<div class="rpt-page">' +
          content +
          '<div class="rpt-footer">' +
            '<div class="rpt-footer-left">Manajemen Konstruksi v1 · ' + _esc(proj.kode) + ' — ' + _esc(proj.nama) + '</div>' +
            '<div class="rpt-footer-right">Generated: ' + new Date().toLocaleString('id-ID') + '</div>' +
          '</div>' +
        '</div>'
      );
    }

    function reportHeader(proj, opts, title){
      return (
        '<div class="rpt-header">' +
          '<div class="rpt-header-left">' +
            '<div class="rpt-logo">MK</div>' +
            '<div>' +
              '<div class="rpt-header-brand">Manajemen Konstruksi v1</div>' +
              '<div class="rpt-header-sub">Pengendalian RAB vs RAP</div>' +
            '</div>' +
          '</div>' +
          '<div class="rpt-header-right">' +
            '<div class="rpt-title">' + _esc(title) + '</div>' +
            '<div class="rpt-meta">' + _esc(proj.kode) + ' · ' + _fmtDate(opts.date || _todayISO()) + '</div>' +
          '</div>' +
        '</div>'
      );
    }

    function kpiCard(label, value, sub, cls){
      var cls2 = cls ? ' ' + cls : '';
      return '<div class="rpt-kpi' + cls2 + '">' +
        '<div class="rpt-kpi-lbl">' + _esc(label) + '</div>' +
        '<div class="rpt-kpi-val">' + _esc(value) + '</div>' +
        (sub ? '<div class="rpt-kpi-sub">' + _esc(sub) + '</div>' : '') +
      '</div>';
    }

    /* ═══════════════════════════════════════════════════════════
       REPORT CSS (untuk print window)
       ═══════════════════════════════════════════════════════════ */
    var REPORT_CSS = '' +
      '* { box-sizing: border-box; margin: 0; padding: 0; }' +
      'body {' +
        'font-family: "Segoe UI", Arial, sans-serif;' +
        'background: #f1f5f9;' +
        'color: #1a1a1a;' +
        'padding: 20px;' +
        'font-size: 12px;' +
        'line-height: 1.5;' +
      '}' +

      '.rpt-print-toolbar {' +
        'position: fixed;' +
        'top: 12px; right: 12px;' +
        'display: flex;' +
        'gap: 8px;' +
        'background: #1e293b;' +
        'padding: 10px 14px;' +
        'border-radius: 8px;' +
        'box-shadow: 0 8px 24px rgba(0,0,0,.3);' +
        'z-index: 1000;' +
        'align-items: center;' +
      '}' +
      '.rpt-print-toolbar button {' +
        'padding: 8px 14px;' +
        'border-radius: 6px;' +
        'border: 1px solid #334155;' +
        'background: #0f172a;' +
        'color: #fff;' +
        'font-weight: 700;' +
        'cursor: pointer;' +
        'font-family: inherit;' +
        'font-size: 12px;' +
      '}' +
      '.rpt-print-toolbar button:first-child {' +
        'background: linear-gradient(135deg, #2f81f7, #1f6fe0);' +
        'border-color: transparent;' +
      '}' +
      '.rpt-print-toolbar button:hover { filter: brightness(1.15); }' +
      '.rpt-print-toolbar .rpt-hint {' +
        'color: #94a3b8;' +
        'font-size: 11px;' +
        'margin-left: 8px;' +
      '}' +

      '.rpt-page {' +
        'max-width: 1100px;' +
        'margin: 0 auto;' +
        'background: #fff;' +
        'padding: 32px 40px 50px;' +
        'border-radius: 4px;' +
        'box-shadow: 0 4px 20px rgba(0,0,0,.08);' +
        'position: relative;' +
      '}' +

      '.rpt-watermark {' +
        'position: fixed;' +
        'top: 0; left: 0; right: 0; bottom: 0;' +
        'display: flex;' +
        'align-items: center;' +
        'justify-content: center;' +
        'font-size: 160px;' +
        'font-weight: 900;' +
        'color: rgba(31, 78, 121, .035);' +
        'pointer-events: none;' +
        'z-index: 0;' +
        'white-space: nowrap;' +
        'letter-spacing: 8px;' +
        'transform: rotate(-30deg);' +
        'transform-origin: center;' +
      '}' +
      '.rpt-watermark > * { transform: translate(-50%, -50%); }' +

      '.rpt-header {' +
        'display: flex;' +
        'justify-content: space-between;' +
        'align-items: flex-start;' +
        'border-bottom: 3px solid #1f4e79;' +
        'padding-bottom: 14px;' +
        'margin-bottom: 22px;' +
        'position: relative;' +
        'z-index: 2;' +
      '}' +
      '.rpt-header-left { display: flex; align-items: center; gap: 14px; }' +
      '.rpt-logo {' +
        'width: 48px; height: 48px;' +
        'border-radius: 10px;' +
        'background: linear-gradient(135deg, #2f81f7, #1abc9c);' +
        'color: #fff;' +
        'font-weight: 800;' +
        'font-size: 18px;' +
        'display: grid; place-items: center;' +
      '}' +
      '.rpt-header-brand { font-size: 16px; font-weight: 800; color: #1f4e79; }' +
      '.rpt-header-sub { font-size: 11px; color: #666; margin-top: 2px; }' +
      '.rpt-header-right { text-align: right; }' +
      '.rpt-title {' +
        'font-size: 22px;' +
        'font-weight: 900;' +
        'color: #1f4e79;' +
        'letter-spacing: .5px;' +
      '}' +
      '.rpt-meta { font-size: 11px; color: #666; margin-top: 3px; }' +

      '.rpt-section { margin-bottom: 22px; position: relative; z-index: 2; }' +
      '.rpt-section h2 {' +
        'font-size: 14px;' +
        'font-weight: 800;' +
        'color: #1f4e79;' +
        'border-left: 4px solid #2f81f7;' +
        'padding-left: 10px;' +
        'margin-bottom: 12px;' +
        'letter-spacing: .3px;' +
      '}' +

      '.rpt-p { font-size: 12px; line-height: 1.7; margin-bottom: 8px; }' +
      '.rpt-ol { padding-left: 20px; font-size: 12px; line-height: 1.8; }' +

      /* KPI grid */
      '.rpt-kpi-grid {' +
        'display: grid;' +
        'grid-template-columns: repeat(3, 1fr);' +
        'gap: 12px;' +
        'margin-bottom: 8px;' +
      '}' +
      '@media (max-width: 700px) {' +
        '.rpt-kpi-grid { grid-template-columns: repeat(2, 1fr); }' +
      '}' +
      '.rpt-kpi {' +
        'padding: 12px 14px;' +
        'background: #f8fafc;' +
        'border-radius: 8px;' +
        'border-left: 4px solid #2f81f7;' +
      '}' +
      '.rpt-kpi.blue { border-color: #2f81f7; }' +
      '.rpt-kpi.green { border-color: #22c55e; }' +
      '.rpt-kpi.red { border-color: #dc2626; }' +
      '.rpt-kpi.orange { border-color: #f59e0b; }' +
      '.rpt-kpi-lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .5px; color: #64748b; font-weight: 700; }' +
      '.rpt-kpi-val {' +
        'font-size: 17px;' +
        'font-weight: 800;' +
        'color: #0f172a;' +
        'margin-top: 5px;' +
        'font-variant-numeric: tabular-nums;' +
        'white-space: nowrap;' +
        'overflow: hidden;' +
        'text-overflow: ellipsis;' +
        'line-height: 1.2;' +
      '}' +
      '.rpt-kpi-val small { font-size: 11px; font-weight: 600; color: #64748b; }' +
      '.rpt-kpi-sub { font-size: 10.5px; color: #64748b; margin-top: 3px; }' +

      /* Tables */
      '.rpt-info-tbl, .rpt-tbl {' +
        'width: 100%;' +
        'border-collapse: collapse;' +
        'font-size: 11.5px;' +
      '}' +
      '.rpt-info-tbl td, .rpt-tbl th, .rpt-tbl td {' +
        'border: 1px solid #cbd5e1;' +
        'padding: 6px 9px;' +
        'vertical-align: middle;' +
      '}' +
      '.rpt-tbl thead th {' +
        'background: #1f4e79;' +
        'color: #fff;' +
        'font-size: 10.5px;' +
        'text-transform: uppercase;' +
        'letter-spacing: .3px;' +
        'text-align: left;' +
        'font-weight: 700;' +
      '}' +
      '.rpt-tbl tbody tr:nth-child(even) { background: #f8fafc; }' +
      '.rpt-tbl tbody tr:hover { background: #e0efff; }' +
      '.rpt-tbl td.num, .rpt-tbl th.num { text-align: right; font-variant-numeric: tabular-nums; }' +
      '.rpt-tbl td.c, .rpt-tbl th.c { text-align: center; }' +
      '.rpt-tbl td.n { text-align: right; font-variant-numeric: tabular-nums; }' +
      '.rpt-tbl .total { background: #dbeafe !important; font-weight: 700; }' +
      '.rpt-tbl-sm { font-size: 10.5px; }' +
      '.rpt-tbl-sm th, .rpt-tbl-sm td { padding: 5px 7px; }' +

      '.rpt-info-tbl .k { background: #f1f5f9; font-weight: 700; color: #475569; width: 20%; }' +
      '.rpt-info-tbl .ok { color: #15803d; font-weight: 700; }' +
      '.rpt-info-tbl .warn { color: #d97706; font-weight: 700; }' +
      '.rpt-info-tbl .bad { color: #b91c1c; font-weight: 700; }' +

      '.rpt-tbl .ok { color: #15803d; }' +
      '.rpt-tbl .warn { color: #d97706; }' +
      '.rpt-tbl .bad { color: #b91c1c; font-weight: 700; }' +

      '.rpt-footer {' +
        'margin-top: 32px;' +
        'padding-top: 12px;' +
        'border-top: 2px solid #cbd5e1;' +
        'display: flex;' +
        'justify-content: space-between;' +
        'font-size: 10px;' +
        'color: #64748b;' +
        'position: relative;' +
        'z-index: 2;' +
      '}' +

      /* Print */
      '@media print {' +
        'body { background: #fff; padding: 0; }' +
        '.rpt-print-toolbar { display: none !important; }' +
        '.rpt-page {' +
          'box-shadow: none;' +
          'padding: 0;' +
          'max-width: 100%;' +
        '}' +
        '.rpt-watermark {' +
          'position: fixed;' +
          'color: rgba(31, 78, 121, .06);' +
        '}' +
        '.rpt-tbl thead th {' +
          '-webkit-print-color-adjust: exact;' +
          'print-color-adjust: exact;' +
        '}' +
        '.rpt-kpi, .rpt-tbl thead th, .rpt-tbl .total {' +
          '-webkit-print-color-adjust: exact;' +
          'print-color-adjust: exact;' +
        '}' +
        '.rpt-section { page-break-inside: avoid; }' +
        '.rpt-tbl thead { display: table-header-group; }' +
      '}' +

      '@page {' +
        'margin: 15mm 12mm;' +
      '}';

    /* ═══════════════════════════════════════════════════════════
       TOOLBAR WIRING — tombol 📄 Report di topbar
       ═══════════════════════════════════════════════════════════ */
    function wireTopbarButton(){
      /* Cari tombol iCal sebagai anchor */
      var icalBtn = document.getElementById('btnIcal');
      if (!icalBtn){
        setTimeout(wireTopbarButton, 300);
        return;
      }
      if (document.getElementById('btnReport')) return;

      var btn = document.createElement('button');
      btn.className = 'btn btn-sm';
      btn.id = 'btnReport';
      btn.title = 'Generate Report (Executive · Task Detail · Cost · Critical Path · Variance)';
      btn.textContent = '📄 Report';
      btn.onclick = openDialog;
      icalBtn.parentNode.insertBefore(btn, icalBtn.nextSibling);
    }

    /* ═══════════════════════════════════════════════════════════
       PUBLIC API
       ═══════════════════════════════════════════════════════════ */
    window.openReport = openDialog;
    window.generateReport = function(tplId, opts){
      if (typeof STATE === 'undefined' || !STATE.activeProject){
        console.warn('Tidak ada proyek aktif');
        return;
      }
      generate(tplId, STATE.activeProject, opts || {});
    };
    window.listReportTemplates = function(){
      console.table(Object.keys(TEMPLATES).map(function(k){
        return { id: k, label: TEMPLATES[k].label, orientation: TEMPLATES[k].orientation };
      }));
    };

    /* ── Init ── */
    if (document.readyState === 'loading'){
      document.addEventListener('DOMContentLoaded', wireTopbarButton);
    } else {
      wireTopbarButton();
    }

    console.log('%c[Reporting.js] ✅ Report Engine installed',
      'color:#22c55e;font-weight:bold;font-size:13px');
  }

  /* ── Bootstrap ── */
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ bootstrap(0); });
  } else {
    bootstrap(0);
  }
})();
