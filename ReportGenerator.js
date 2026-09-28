/* =====================================================================
   MODUL REPORT GENERATOR — Laporan PDF (Harian/Mingguan/Bulanan)
   ===================================================================== */

(function reportGeneratorModule(){
  function bootstrap(attempt){
    attempt = attempt || 0;
    if (typeof DB === 'undefined' || !DB || typeof html2pdf === 'undefined'){
      if (attempt > 60){
        console.error('[ReportGenerator.js] html2pdf belum siap');
        return;
      }
      setTimeout(function(){ bootstrap(attempt + 1); }, 300);
      return;
    }
    install();
  }

  function install(){
    if (window._reportGeneratorInstalled) return;
    window._reportGeneratorInstalled = true;

    function _esc(s){
      if (typeof esc === 'function') return esc(s);
      return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
      });
    }
    function _num(v){
      if (typeof num === 'function') return num(v);
      var n = parseFloat(String(v == null ? '' : v).replace(/[^\d.-]/g,''));
      return isFinite(n) ? n : 0;
    }
    function _fmt(n, d){
      if (typeof fmt === 'function') return fmt(n, d);
      d = d == null ? 2 : d;
      return (isFinite(n) ? Number(n) : 0).toLocaleString('id-ID', {
        minimumFractionDigits: d, maximumFractionDigits: d
      });
    }
    function _rp(n){
      if (typeof rp === 'function') return rp(n);
      return 'Rp ' + Math.round(Number(n)||0).toLocaleString('id-ID');
    }
    function _toast(msg, ok){
      if (typeof toast === 'function') toast(msg, ok !== false);
    }

    function formatTglIndo(iso){
      if (!iso) return '—';
      var bulan = ['Januari','Februari','Maret','April','Mei','Juni',
                   'Juli','Agustus','September','Oktober','November','Desember'];
      var parts = String(iso).split('T')[0].split('-');
      if (parts.length !== 3) return iso;
      var d = parseInt(parts[2], 10);
      var m = parseInt(parts[1], 10) - 1;
      var y = parseInt(parts[0], 10);
      if (isNaN(d) || isNaN(m) || isNaN(y)) return iso;
      return d + ' ' + bulan[m] + ' ' + y;
    }

    function formatHariTgl(iso){
      if (!iso) return '—';
      var hari = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
      var d = new Date(iso + 'T00:00:00');
      if (isNaN(d.getTime())) return iso;
      return hari[d.getDay()] + ', ' + formatTglIndo(iso);
    }

    function hitungMinggu(proj, tglISO){
      if (!proj || !proj.tgl_mulai || !tglISO) return 1;
      var d1 = new Date(proj.tgl_mulai + 'T00:00:00');
      var d2 = new Date(tglISO + 'T00:00:00');
      if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return 1;
      var diffDays = Math.round((d2 - d1) / 86400000);
      return Math.max(1, Math.floor(diffDays / 7) + 1);
    }

    function openHarianDialog(projectId){
      projectId = projectId || (typeof STATE !== 'undefined' ? STATE.activeProject : null);
      if (!projectId){ _toast('Pilih proyek dulu', false); return; }

      var proj = DB.projects.find(function(p){ return p.id === projectId; });
      if (!proj){ _toast('Proyek tidak ditemukan', false); return; }

      var today = new Date().toISOString().slice(0,10);

      var dateWidget = (typeof _dateWidgetHTML === 'function')
        ? _dateWidgetHTML('rg_tgl', today, { placeholder: 'Pilih tanggal' })
        : '<input type="date" id="rg_tgl" value="' + _esc(today) + '" />';

      var html = '' +
        '<div class="rg-intro">Cetak <b>Laporan Harian</b> untuk proyek <b style="color:#7cb3ff">' + _esc(proj.kode) + '</b>.</div>' +
        '<div class="rg-field"><label>Tanggal Laporan</label>' + dateWidget + '</div>' +
        '<div class="rg-quick">' +
          '<button type="button" class="rg-quick-btn" data-offset="0">Hari Ini</button>' +
          '<button type="button" class="rg-quick-btn" data-offset="-1">Kemarin</button>' +
          '<button type="button" class="rg-quick-btn" data-offset="-7">7 Hari Lalu</button>' +
        '</div>' +
        '<div class="rg-info" id="rg_info"><div class="rg-info-row"><span>Memuat data…</span></div></div>' +
        '<p class="rg-hint">Laporan akan berisi: header logo & identitas, tabel item, ringkasan progres, foto, dan tanda tangan.</p>';

      openModal('🖨 Cetak Laporan Harian', html, function(){ return false; });

      setTimeout(function(){
        if (typeof _initDateWidgets === 'function'){
          _initDateWidgets(document.getElementById('mBody'));
        }

        var submitBtn = document.getElementById('mSubmit');
        if (submitBtn){
          submitBtn.textContent = '📄 Generate PDF';
          submitBtn.style.display = '';
          submitBtn.onclick = function(){
            var tgl = document.getElementById('rg_tgl').value;
            if (!tgl){ _toast('Pilih tanggal', false); return; }
            generateHarian(projectId, tgl);
          };
        }
        var cancelBtn = document.getElementById('mCancel');
        if (cancelBtn) cancelBtn.textContent = 'Batal';

        var tglEl = document.getElementById('rg_tgl');
        if (tglEl){
          tglEl.addEventListener('change', function(){ updateInfo(projectId, tglEl.value); });
          tglEl.addEventListener('input', function(){ updateInfo(projectId, tglEl.value); });
        }

        document.querySelectorAll('.rg-quick-btn').forEach(function(btn){
          btn.onclick = function(){
            var offset = parseInt(btn.getAttribute('data-offset'), 10) || 0;
            var d = new Date();
            d.setDate(d.getDate() + offset);
            var iso = d.toISOString().slice(0,10);
            var tglNative = document.getElementById('rg_tgl');
            if (tglNative){
              tglNative.value = iso;
              if (typeof _syncDateWidgetFace === 'function') _syncDateWidgetFace(tglNative);
              updateInfo(projectId, iso);
            }
          };
        });

        updateInfo(projectId, today);
      }, 10);
    }

    function updateInfo(projectId, tanggal){
      var info = document.getElementById('rg_info');
      if (!info) return;

      var progress = DB.progress.filter(function(p){
        return p.project_id === projectId && (p.tanggal || '').split('T')[0] === tanggal;
      });

      var wbsDone = {};
      progress.forEach(function(p){ wbsDone[p.wbs_id] = true; });
      var progressCount = Object.keys(wbsDone).length;

      var photos = (DB.photos || []).filter(function(p){
        return p.project_id === projectId && (p.tanggal || '').split('T')[0] === tanggal;
      });

      var html = '';
      html += '<div class="rg-info-row"><span>📊 Item progress:</span><b>' + progressCount + ' item</b></div>';
      html += '<div class="rg-info-row"><span>📷 Foto dokumentasi:</span><b>' + photos.length + ' foto</b></div>';
      html += '<div class="rg-info-row"><span>📅 Tanggal:</span><b>' + formatHariTgl(tanggal) + '</b></div>';

      if (progressCount === 0 && photos.length === 0){
        html += '<div class="rg-info-warn">⚠ Belum ada progress atau foto pada tanggal ini.</div>';
      }
      info.innerHTML = html;
    }

    function generateHarian(projectId, tanggal){
      var proj = DB.projects.find(function(p){ return p.id === projectId; });
      if (!proj){ _toast('Proyek tidak ditemukan', false); return; }
      var meta = (window.ProjectMeta && ProjectMeta.get) ? ProjectMeta.get(projectId) : {};
      var html = buildHarianHTML(proj, meta, tanggal);
      renderToPDF(html, 'Laporan-Harian-' + proj.kode + '-' + tanggal + '.pdf');
    }

    function buildHarianHTML(proj, meta, tanggal){
      var photos = (DB.photos || []).filter(function(p){
        return p.project_id === proj.id && (p.tanggal || '').split('T')[0] === tanggal;
      }).sort(function(a,b){ return (a.urutan||0)-(b.urutan||0); });

      var progress = DB.progress.filter(function(p){
        return p.project_id === proj.id && (p.tanggal || '').split('T')[0] === tanggal;
      });

      var byWbs = {};
      progress.forEach(function(p){
        if (!byWbs[p.wbs_id]) byWbs[p.wbs_id] = 0;
        byWbs[p.wbs_id] += _num(p.volume);
      });

      if (Object.keys(byWbs).length === 0 && photos.length > 0){
        photos.forEach(function(p){ if (!byWbs[p.wbs_id]) byWbs[p.wbs_id] = 0; });
      }

      var wbsRows = (typeof Calc !== 'undefined' && Calc.wbsRows) ? Calc.wbsRows(proj.id) : [];
      var totalRAB = wbsRows.filter(function(r){ return !r.isGroup; })
        .reduce(function(s, r){ return s + _num(r.total_rab); }, 0) || 1;

      var rowsData = [];
      Object.keys(byWbs).forEach(function(wbsId){
        var w = DB.project_wbs.find(function(x){ return x.id === wbsId; });
        if (!w) return;
        var r = wbsRows.find(function(x){ return x.id === wbsId; });
        var totalRab = r ? _num(r.total_rab) : 0;
        var bobot = totalRab / totalRAB * 100;
        var volHari = byWbs[wbsId] || 0;
        var volRAB = _num(w.volume_rab);
        var pctHari = volRAB > 0 ? (volHari / volRAB * 100) : 0;
        var pctBobotHari = bobot * (pctHari / 100);

        rowsData.push({
          kode: w.kode_wbs, uraian: w.uraian, satuan: w.satuan || '-',
          volHari: volHari, volRAB: volRAB, pctHari: pctHari,
          bobot: bobot, pctBobotHari: pctBobotHari
        });
      });

      var allProgress = DB.progress.filter(function(p){ return p.project_id === proj.id; });
      var allByWbs = {};
      allProgress.forEach(function(p){
        if (!allByWbs[p.wbs_id]) allByWbs[p.wbs_id] = 0;
        allByWbs[p.wbs_id] += _num(p.volume);
      });

      var totalKumulatif = 0;
      var mingguNow = hitungMinggu(proj, tanggal);
      var sc = (typeof Calc !== 'undefined' && Calc.scurve) ? Calc.scurve(proj.id) : { planned:[] };
      var totalRencanaPct = sc.planned[Math.min(mingguNow-1, sc.planned.length-1)] || 0;

      wbsRows.filter(function(r){ return !r.isGroup; }).forEach(function(r){
        var vol = allByWbs[r.id] || 0;
        var volRAB = _num(r.volume_rab);
        var bobot = _num(r.total_rab) / totalRAB * 100;
        if (volRAB > 0) totalKumulatif += bobot * Math.min(1, vol / volRAB);
      });

      var pctHariIni = rowsData.reduce(function(s, r){ return s + r.pctBobotHari; }, 0);
      var deviasi = totalKumulatif - totalRencanaPct;

      var logoPupr = meta.logo_pupr ? '<img src="' + meta.logo_pupr + '" class="rg-logo" />' : '<div class="rg-logo-ph"></div>';
      var logoKontraktor = meta.logo_kontraktor ? '<img src="' + meta.logo_kontraktor + '" class="rg-logo" />' : '<div class="rg-logo-ph"></div>';

      function ttdBlock(title, data){
        var nikStr = String(data.nik || '').trim();
        var nikHTML = nikStr !== '' ? '<div class="rg-ttd-nik">NIP/NIK: ' + _esc(nikStr) + '</div>' : '';
        var namaStr = String(data.nama || '').trim();
        var namaHTML = namaStr !== '' ? '<b>' + _esc(namaStr) + '</b>' : '<b style="letter-spacing:1px">................................</b>';
        return '<div class="rg-ttd">' +
          (title ? '<div class="rg-ttd-title" style="font-style:italic;margin-bottom:4px;font-size:10px;color:#333;">' + _esc(title) + '</div>' : '') +
          '<div class="rg-ttd-jabatan">' + _esc(data.jabatan || '') + '</div>' +
          '<div class="rg-ttd-space"></div>' +
          '<div class="rg-ttd-nama">' + namaHTML + '</div>' + nikHTML + '</div>';
      }

      return '<div class="rg-page">' +
        '<div class="rg-header">' +
          '<div class="rg-header-logo">' + logoPupr + '</div>' +
          '<div class="rg-header-text">' +
            '<div class="rg-instansi">' + _esc(meta.nama_instansi || 'DINAS PEKERJAAN UMUM') + '</div>' +
            (meta.alamat_instansi ? '<div class="rg-alamat">' + _esc(meta.alamat_instansi) + '</div>' : '') +
            '<div class="rg-title">LAPORAN HARIAN PROGRES PEKERJAAN</div>' +
          '</div>' +
          '<div class="rg-header-logo">' + logoKontraktor + '</div>' +
        '</div>' +
        '<div class="rg-hr"></div>' +
        '<table class="rg-info-table">' +
          '<tr><td class="rg-k">Nama Paket</td><td class="rg-c">:</td><td>' + _esc(proj.nama) + '</td></tr>' +
          '<tr><td class="rg-k">Kode Proyek</td><td class="rg-c">:</td><td>' + _esc(proj.kode) + '</td></tr>' +
          '<tr><td class="rg-k">Lokasi</td><td class="rg-c">:</td><td>' + _esc(proj.lokasi || '-') + '</td></tr>' +
          '<tr><td class="rg-k">Kontraktor</td><td class="rg-c">:</td><td>' + _esc(meta.nama_kontraktor || '-') + '</td></tr>' +
          '<tr><td class="rg-k">Tanggal</td><td class="rg-c">:</td><td><b>' + formatHariTgl(tanggal) + '</b></td></tr>' +
          '<tr><td class="rg-k">Minggu ke-</td><td class="rg-c">:</td><td>' + mingguNow + ' dari ' + (proj.durasi_minggu || '-') + '</td></tr>' +
        '</table>' +
        '<div class="rg-section-title">A. Pekerjaan yang Dilaksanakan</div>' +
        '<table class="rg-table">' +
          '<thead><tr>' +
            '<th style="width:35px">No</th><th style="width:65px">Kode</th><th>Uraian Pekerjaan</th>' +
            '<th style="width:45px">Sat</th><th style="width:90px" class="rg-num">Vol Hari Ini</th>' +
            '<th style="width:75px" class="rg-num">% Item</th><th style="width:80px" class="rg-num">Bobot %</th>' +
          '</tr></thead>' +
          '<tbody>' +
            (rowsData.length ? rowsData.map(function(r, i){
              return '<tr><td class="rg-center">' + (i+1) + '</td>' +
                '<td>' + _esc(r.kode) + '</td><td>' + _esc(r.uraian) + '</td>' +
                '<td class="rg-center">' + _esc(r.satuan) + '</td>' +
                '<td class="rg-num">' + _fmt(r.volHari, 2) + '</td>' +
                '<td class="rg-num">' + _fmt(r.pctHari, 2) + '%</td>' +
                '<td class="rg-num"><b>' + _fmt(r.pctBobotHari, 3) + '%</b></td></tr>';
            }).join('') : '<tr><td colspan="7" class="rg-empty">Tidak ada pekerjaan pada tanggal ini</td></tr>') +
          '</tbody>' +
          '<tfoot><tr><td colspan="6" class="rg-num rg-bold">Progres Hari Ini</td>' +
            '<td class="rg-num rg-bold">' + _fmt(pctHariIni, 3) + '%</td></tr></tfoot>' +
        '</table>' +
        '<div class="rg-section-title">B. Ringkasan Progres</div>' +
        '<table class="rg-summary">' +
          '<tr><td class="rg-sum-k">Progres Hari Ini</td><td class="rg-sum-v">' + _fmt(pctHariIni, 3) + '%</td>' +
            '<td class="rg-sum-k">Progres Kumulatif</td><td class="rg-sum-v">' + _fmt(totalKumulatif, 3) + '%</td></tr>' +
          '<tr><td class="rg-sum-k">Rencana (Kurva S)</td><td class="rg-sum-v">' + _fmt(totalRencanaPct, 3) + '%</td>' +
            '<td class="rg-sum-k">Deviasi</td><td class="rg-sum-v ' + (deviasi >= 0 ? 'rg-ok' : 'rg-bad') + '">' +
            (deviasi >= 0 ? '+' : '') + _fmt(deviasi, 3) + '% ' + (deviasi >= 0 ? '(Ahead)' : '(Behind)') + '</td></tr>' +
        '</table>' +
        '<div class="rg-section-title">C. LAMPIRAN FOTO</div>' +
        (photos.length
          ? '<div class="rg-subsection-label">Dokumentasi Foto (' + photos.length + ')</div>' +
            '<div class="rg-photo-grid">' + photos.map(function(p){
              var w = DB.project_wbs.find(function(x){ return x.id === p.wbs_id; });
              var cap = p.caption || (w ? (w.kode_wbs + ' — ' + w.uraian) : '');
              return '<div class="rg-photo-item"><img src="' + p.file_data + '" />' +
                '<div class="rg-photo-cap">' + _esc(cap) + '</div></div>';
            }).join('') + '</div>'
          : '<div class="rg-empty-note">Tidak ada foto dokumentasi pada tanggal ini.</div>') +
        '<div class="rg-subsection-divider" style="margin:24px 0 16px 0;"></div>' +
        '<div class="rg-subsection-label">Tanda Tangan</div>' +
        
        /* Baris Pertama: Kiri (Diperiksa) & Kanan (Dibuat) */
        '<div class="rg-ttd-wrap">' +
          '<div class="rg-ttd-col">' + ttdBlock('Di Periksa,', meta.ttd_team_leader || { jabatan: 'Konsultan Pengawas / Team Leader' }) + '</div>' +
          '<div class="rg-ttd-col">' + ttdBlock('Di Buat,', meta.ttd_project_manager || { jabatan: 'Project Manager' }) + '</div>' +
        '</div>' +
        
        /* Baris Kedua: Kiri (Disetujui) & Kanan (Mengetahui) */
        '<div class="rg-ttd-wrap" style="margin-top:30px;">' +
          '<div class="rg-ttd-col">' + ttdBlock('Disetujui,', meta.ttd_direksi || { jabatan: 'Direksi Pengawas' }) + '</div>' +
          '<div class="rg-ttd-col">' + ttdBlock('Mengetahui,', meta.ttd_ppk || { jabatan: 'Pejabat Pembuat Komitmen' }) + '</div>' +
        '</div>' +
        '</div>';
    }

    function renderToPDF(html, filename){
      var overlay = document.createElement('div');
      overlay.id = 'pdfRenderOverlay';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(4,9,18,.92);z-index:99998;display:flex;align-items:center;justify-content:center;color:#e6edf7;font-family:Arial;';
      overlay.innerHTML = '<div style="text-align:center"><div style="font-size:36px">⏳</div><div>Menyiapkan Preview...</div></div>';
      document.body.appendChild(overlay);

      var cssString = getPDFStyles();

      var fullHTML = '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>' + filename + '</title>' +
        '<style>' + cssString + '</style>' +
        '<style>html,body{margin:0;padding:0;background:#fff;}body{color:#111;font-family:Arial;font-size:10.5px;line-height:1.4;}' +
        'img{max-width:100%;height:auto;}@page{size:A4 portrait;margin:12mm;}' +
        '@media print{body{margin:0;}.rg-page{page-break-after:always;}.rg-page:last-child{page-break-after:auto;}}' +
        '</style></head><body>' + html + '</body></html>';

      var printWindow = window.open('', '_blank', 'width=900,height=1000');
      if (!printWindow){
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        _toast('⚠ Popup diblokir. Aktifkan popup di browser.', false);
        return;
      }

      printWindow.document.open();
      printWindow.document.write(fullHTML);
      printWindow.document.close();

      printWindow.onload = function(){
        setTimeout(function(){
          try {
            var toolbar = printWindow.document.createElement('div');
            toolbar.className = 'no-print';
            toolbar.style.cssText = 'position:fixed;top:0;left:0;right:0;height:52px;background:linear-gradient(135deg,#1f4e79,#17395a);color:#fff;display:flex;align-items:center;justify-content:space-between;padding:0 20px;z-index:9999;font-family:Arial;';
            toolbar.innerHTML = '<div>📄 ' + filename + '</div>' +
              '<div><button id="btnPrintPDF" style="padding:8px 18px;background:#16a34a;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:700;margin-right:8px;">🖨 Print / Save as PDF</button>' +
              '<button id="btnClosePDF" style="padding:8px 18px;background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.3);border-radius:6px;cursor:pointer;">✕ Tutup</button></div>';
            printWindow.document.body.style.paddingTop = '52px';
            printWindow.document.body.insertBefore(toolbar, printWindow.document.body.firstChild);
            printWindow.document.getElementById('btnPrintPDF').onclick = function(){ printWindow.print(); };
            printWindow.document.getElementById('btnClosePDF').onclick = function(){ printWindow.close(); };
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            _toast('✅ Preview siap — Klik "Print / Save as PDF"');
          } catch(e){
            console.error(e);
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
          }
        }, 500);
      };

      setTimeout(function(){
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
      }, 5000);
    }

    function getPDFStyles(){
      return '* { box-sizing: border-box; }' +
        '.rg-page, .rg-page * { color: #111 !important; }' +
        '.rg-page { margin: 0; padding: 0; background: #fff; font-family: Arial; font-size: 10.5px; line-height: 1.4; }' +
        '.rg-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 10px; }' +
        '.rg-header-logo { width: 80px; flex-shrink: 0; text-align: center; }' +
        '.rg-logo { max-width: 75px; max-height: 75px; object-fit: contain; }' +
        '.rg-logo-ph { width: 75px; height: 75px; border: 1px dashed #999; border-radius: 4px; }' +
        '.rg-header-text { flex: 1; text-align: center; }' +
        '.rg-instansi { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; }' +
        '.rg-alamat { font-size: 9px; color: #555; margin-top: 2px; }' +
        '.rg-title { font-size: 14px; font-weight: 700; margin-top: 6px; text-decoration: underline; }' +
        '.rg-hr { height: 3px; background: #1f4e79; margin: 6px 0 16px 0; }' +
        '.rg-info-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; padding: 0 6px; line-height: 1.7; font-size: 10px; }' +
        '.rg-info-table td { padding: 3px 4px; vertical-align: top; }' +
        '.rg-info-table .rg-k { width: 120px; font-weight: 600; }' +
        '.rg-info-table .rg-c { width: 8px; }' +
        '.rg-section-title { font-size: 11px; font-weight: 700; margin: 18px 0 10px 0; padding: 6px 12px; background: #e7effa; border-left: 3px solid #1f4e79; text-transform: uppercase; }' +
        '.rg-table { width: 100%; border-collapse: collapse; font-size: 9.5px; margin-bottom: 18px; }' +
        '.rg-table th, .rg-table td { border: 1px solid #333; padding: 6px 8px; vertical-align: middle; }' +
        '.rg-table th { background: #1f4e79; color: #fff; font-weight: 700; text-align: center; font-size: 9.5px; }' +
        '.rg-table tfoot td { background: #f0f0f0; font-weight: 700; }' +
        '.rg-table .rg-num { text-align: right; }' +
        '.rg-table .rg-center { text-align: center; }' +
        '.rg-table .rg-empty { text-align: center; font-style: italic; color: #888; padding: 10px; }' +
        '.rg-bold { font-weight: 700; }' +
        '.rg-summary { width: 100%; border-collapse: collapse; font-size: 10px; margin-bottom: 20px; }' +
        '.rg-summary td { border: 1px solid #333; padding: 8px 10px; }' +
        '.rg-sum-k { background: #f0f0f0; font-weight: 600; width: 130px; }' +
        '.rg-sum-v { width: 130px; text-align: right; font-weight: 700; }' +
        '.rg-sum-v.rg-ok { color: #16a34a; }' +
        '.rg-sum-v.rg-bad { color: #dc2626; }' +
        '.rg-photo-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 16px; }' +
        '.rg-photo-item { border: 1px solid #ccc; padding: 5px; background: #fff; border-radius: 4px; page-break-inside: avoid; }' +
        '.rg-photo-item img { width: 100%; height: 140px; object-fit: cover; display: block; }' +
        '.rg-photo-cap { font-size: 9.5px; color: #333; margin-top: 4px; min-height: 24px; }' +
        '.rg-ttd-wrap { display: flex; justify-content: space-between; gap: 24px; margin-top: 14px; page-break-inside: avoid; }' +
        '.rg-ttd-col { flex: 1; text-align: center; font-size: 10.5px; }' +
        '.rg-ttd { padding: 8px 4px; }' +
        '.rg-ttd-jabatan { font-weight: 700; text-transform: uppercase; font-size: 10px; margin-bottom: 4px; }' +
        '.rg-ttd-space { height: 60px; }' +
        '.rg-ttd-nama { border-top: 1px solid #333; padding-top: 4px; margin-top: 4px; }' +
        '.rg-ttd-nik { font-size: 9px; color: #555; margin-top: 2px; }' +
        '.rg-subsection-label { font-size: 10.5px; font-weight: 700; color: #1f4e79; margin: 14px 0 8px 0; padding-left: 8px; border-left: 3px solid #4a90d9; text-transform: uppercase; }' +
        '.rg-subsection-divider { height: 1px; background: #d0d8e4; margin: 18px 0 14px 0; }' +
        '.rg-empty-note { font-size: 10px; font-style: italic; color: #777; text-align: center; padding: 14px; background: #f8f9fb; border-radius: 4px; }' +
        '.rg-page { page-break-after: always; }' +
        '@page { size: A4 portrait; margin: 18mm 15mm; }';
    }

    window.ReportGenerator = {
      openHarian: openHarianDialog,
      harian: function(pid, tgl){ generateHarian(pid, tgl); }
    };

    console.log('%c[ReportGenerator.js] ✅ Report Generator installed',
      'color:#dc2626;font-weight:bold;font-size:13px');
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ bootstrap(0); });
  } else {
    bootstrap(0);
  }
})();

/* =====================================================================
   ADD-ON: LAPORAN MINGGUAN & BULANAN
   Sisipkan ke dalam ReportGenerator.js
   ===================================================================== */

const ReportGeneratorExtended = {

  /* ── Helper: Ambil data proyek & progres ── */
  _getProjectData(projectId) {
    const proj = DB.projects.find(p => p.id === projectId);
    if (!proj) throw new Error('Proyek tidak ditemukan');
    const wbsItems = DB.project_wbs.filter(w => w.project_id === projectId && !w.is_group);
    const progressItems = DB.progress.filter(p => p.project_id === projectId);
    const photos = (DB.photos || []).filter(p => p.project_id === projectId);
    return { proj, wbsItems, progressItems, photos };
  },

  /* ── Helper: Format tanggal ── */
  _fmtDate(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'long', year: 'numeric' });
  },

  /* =====================================================================
     A1. LAPORAN MINGGUAN
     ===================================================================== */
  buildMingguanHTML(projectId, mingguKe, options = {}) {
    const { proj, wbsItems, progressItems, photos } = this._getProjectData(projectId);
    const minggu = parseInt(mingguKe, 10) || 1;
    
    // Filter progress untuk minggu ini
    const progMingguIni = progressItems.filter(p => num(p.minggu) === minggu);
    
    // Hitung rencana vs aktual untuk minggu ini
    let totalBobotRencana = 0;
    let totalBobotAktual = 0;
    const detailRows = wbsItems.map(w => {
      const volRAB = num(w.volume_rab);
      const bobot = volRAB * Calc.hargaSatuanRAB(projectId, w.ahsp_id);
      
      // Rencana (asumsi merata per minggu)
      const durasi = num(proj.durasi_minggu) || 1;
      const rencanaPct = Math.min(100, (1 / durasi) * 100 * minggu); // Kumulatif
      
      // Aktual
      const volProg = progressItems
        .filter(p => p.wbs_id === w.id && num(p.minggu) <= minggu)
        .reduce((s, p) => s + num(p.volume), 0);
      const aktualPct = volRAB > 0 ? Math.min(100, (volProg / volRAB) * 100) : 0;
      
      const dev = aktualPct - rencanaPct;
      
      totalBobotRencana += bobot * (rencanaPct / 100);
      totalBobotAktual += bobot * (aktualPct / 100);
      
      return {
        kode: w.kode_wbs,
        uraian: w.uraian,
        satuan: w.satuan,
        volRAB,
        rencanaPct,
        aktualPct,
        dev,
        status: dev >= 0 ? 'On Schedule' : 'Behind'
      };
    });

    const totalRAB = wbsItems.reduce((s, w) => s + (num(w.volume_rab) * Calc.hargaSatuanRAB(projectId, w.ahsp_id)), 0);
    const pctRencana = totalRAB > 0 ? (totalBobotRencana / totalRAB) * 100 : 0;
    const pctAktual = totalRAB > 0 ? (totalBobotAktual / totalRAB) * 100 : 0;

    // Foto minggu ini (berdasarkan tanggal)
    const fotoMingguIni = photos.filter(p => {
      const tgl = new Date(p.tanggal);
      // Asumsi minggu ke-N dimulai dari tanggal proyek + (N-1)*7 hari
      const startProj = new Date(proj.tgl_mulai);
      const startMinggu = new Date(startProj);
      startMinggu.setDate(startMinggu.getDate() + (minggu - 1) * 7);
      const endMinggu = new Date(startMinggu);
      endMinggu.setDate(endMinggu.getDate() + 6);
      return tgl >= startMinggu && tgl <= endMinggu;
    });

    // Bangun HTML
    const css = this._getReportCSS();
    const header = this._getReportHeader(proj, `LAPORAN MINGGUAN KE-${minggu}`);
    
    const ringkasanHTML = `
      <div class="section">
        <h3>Ringkasan Progress</h3>
        <table class="data-table">
          <tr><td>Rencana Kumulatif</td><td class="num">${fmt(pctRencana, 2)}%</td></tr>
          <tr><td>Aktual Kumulatif</td><td class="num">${fmt(pctAktual, 2)}%</td></tr>
          <tr><td>Deviasi</td><td class="num ${(pctAktual - pctRencana) >= 0 ? 'pos' : 'neg'}">${fmt(pctAktual - pctRencana, 2)}%</td></tr>
        </table>
      </div>
    `;

    const detailHTML = `
      <div class="section">
        <h3>Detail Progress per Item Pekerjaan</h3>
        <table class="data-table">
          <thead>
            <tr>
              <th>Kode</th><th>Uraian</th><th>Satuan</th>
              <th class="num">Vol RAB</th><th class="num">Rencana (%)</th>
              <th class="num">Aktual (%)</th><th class="num">Deviasi</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${detailRows.map(r => `
              <tr>
                <td>${esc(r.kode)}</td><td>${esc(r.uraian)}</td><td>${esc(r.satuan)}</td>
                <td class="num">${fmt(r.volRAB, 2)}</td>
                <td class="num">${fmt(r.rencanaPct, 2)}</td>
                <td class="num">${fmt(r.aktualPct, 2)}</td>
                <td class="num ${r.dev >= 0 ? 'pos' : 'neg'}">${fmt(r.dev, 2)}%</td>
                <td>${r.status}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;

    const fotoHTML = fotoMingguIni.length > 0 ? `
      <div class="section page-break">
        <h3>Dokumentasi Foto Minggu Ke-${minggu}</h3>
        <div class="photo-grid">
          ${fotoMingguIni.map(f => `
            <div class="photo-item">
              <img src="${f.data}" alt="${esc(f.caption || '')}" />
              <p>${esc(f.caption || 'Tanpa keterangan')}</p>
            </div>
          `).join('')}
        </div>
      </div>
    ` : '';

    const ttdHTML = this._getTTDBlock(proj);

    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Laporan Mingguan - ${proj.kode}</title><style>${css}</style></head>
<body>
  ${header}
  ${ringkasanHTML}
  ${detailHTML}
  ${fotoHTML}
  ${ttdHTML}
  <script>window.onload = function() { setTimeout(function() { window.print(); }, 500); }<\/script>
</body>
</html>`;
  },

  /* =====================================================================
     A2. LAPORAN BULANAN
     ===================================================================== */
  buildBulananHTML(projectId, bulan, tahun, options = {}) {
    const { proj, wbsItems, progressItems, photos } = this._getProjectData(projectId);
    const targetBulan = parseInt(bulan, 10) || new Date().getMonth() + 1;
    const targetTahun = parseInt(tahun, 10) || new Date().getFullYear();
    
    // Filter progress untuk bulan ini
    const progBulanIni = progressItems.filter(p => {
      const d = new Date(p.tanggal);
      return d.getMonth() + 1 === targetBulan && d.getFullYear() === targetTahun;
    });

    // Hitung total minggu dalam bulan ini (dari progress)
    const mingguDiBulanIni = [...new Set(progBulanIni.map(p => num(p.minggu)))].sort((a,b) => a - b);
    const maxMinggu = mingguDiBulanIni.length > 0 ? Math.max(...mingguDiBulanIni) : 0;

    // Analisis
    const totalRAB = wbsItems.reduce((s, w) => s + (num(w.volume_rab) * Calc.hargaSatuanRAB(projectId, w.ahsp_id)), 0);
    let totalBobotAktual = 0;

    wbsItems.forEach(w => {
      const volRAB = num(w.volume_rab);
      const bobot = volRAB * Calc.hargaSatuanRAB(projectId, w.ahsp_id);
      const volProg = progressItems
        .filter(p => p.wbs_id === w.id && num(p.minggu) <= maxMinggu)
        .reduce((s, p) => s + num(p.volume), 0);
      const aktualPct = volRAB > 0 ? Math.min(100, (volProg / volRAB) * 100) : 0;
      totalBobotAktual += bobot * (aktualPct / 100);
    });

    const pctAktual = totalRAB > 0 ? (totalBobotAktual / totalRAB) * 100 : 0;
    
    // Dapatkan data EVM untuk trend SPI/CPI
    const evmData = Calc.evm(projectId);
    const spi = evmData.ok ? evmData.SPI : 1;
    const cpi = evmData.ok ? evmData.CPI : 1;

    // Foto bulan ini
    const fotoBulanIni = photos.filter(p => {
      const d = new Date(p.tanggal);
      return d.getMonth() + 1 === targetBulan && d.getFullYear() === targetTahun;
    });

    const css = this._getReportCSS();
    const header = this._getReportHeader(proj, `LAPORAN BULANAN - ${this._getNamaBulan(targetBulan)} ${targetTahun}`);

    const summaryHTML = `
      <div class="section">
        <h3>Executive Summary</h3>
        <table class="data-table">
          <tr><td>Progress Aktual Kumulatif</td><td class="num">${fmt(pctAktual, 2)}%</td></tr>
          <tr><td>Schedule Performance Index (SPI)</td><td class="num ${spi >= 0.95 ? 'pos' : 'neg'}">${fmt(spi, 3)}</td></tr>
          <tr><td>Cost Performance Index (CPI)</td><td class="num ${cpi >= 0.95 ? 'pos' : 'neg'}">${fmt(cpi, 3)}</td></tr>
          <tr><td>Total RAB</td><td class="num">${rp(totalRAB)}</td></tr>
        </table>
      </div>
    `;

    const detailMingguanHTML = `
      <div class="section">
        <h3>Rekapitulasi Progress Mingguan (Bulan ${this._getNamaBulan(targetBulan)})</h3>
        <table class="data-table">
          <thead><tr><th>Minggu</th><th class="num">Volume Progress</th><th class="num">Jumlah Item</th></tr></thead>
          <tbody>
            ${mingguDiBulanIni.map(m => {
              const items = progBulanIni.filter(p => num(p.minggu) === m);
              const totalVol = items.reduce((s, p) => s + num(p.volume), 0);
              return `<tr><td>Minggu ke-${m}</td><td class="num">${fmt(totalVol, 2)}</td><td class="num">${items.length} item</td></tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;

    const fotoHTML = fotoBulanIni.length > 0 ? `
      <div class="section page-break">
        <h3>Album Foto Dokumentasi — ${this._getNamaBulan(targetBulan)} ${targetTahun}</h3>
        <div class="photo-grid">
          ${fotoBulanIni.map(f => `
            <div class="photo-item">
              <img src="${f.data}" alt="${esc(f.caption || '')}" />
              <p>${esc(f.caption || 'Tanpa keterangan')}</p>
            </div>
          `).join('')}
        </div>
      </div>
    ` : '';

    const ttdHTML = this._getTTDBlock(proj);

    return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Laporan Bulanan - ${proj.kode}</title><style>${css}</style></head>
<body>
  ${header}
  ${summaryHTML}
  ${detailMingguanHTML}
  ${fotoHTML}
  ${ttdHTML}
  <script>window.onload = function() { setTimeout(function() { window.print(); }, 500); }<\/script>
</body>
</html>`;
  },

  /* ── Helper: Nama Bulan ── */
  _getNamaBulan(bulan) {
    const nama = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
    return nama[bulan] || '';
  },

  /* ── Helper: Header Laporan ── */
  _getReportHeader(proj, title) {
    return `
      <div class="report-header">
        <h1>${esc(proj.nama)}</h1>
        <h2>${esc(title)}</h2>
        <p>Kode Proyek: ${esc(proj.kode)} | Lokasi: ${esc(proj.lokasi || '-')}</p>
        <hr/>
      </div>
    `;
  },

  /* ── Helper: Blok Tanda Tangan ── */
  _getTTDBlock(proj) {
    return `
      <div class="section ttd-section page-break">
        <h3>Tanda Tangan</h3>
        <div class="ttd-grid">
          <div class="ttd-box">
            <p>Disetujui oleh,</p>
            <p class="ttd-role">Project Manager</p>
            <div class="ttd-space"></div>
            <p class="ttd-name">(_____________________)</p>
          </div>
          <div class="ttd-box">
            <p>Dibuat oleh,</p>
            <p class="ttd-role">Site Engineer</p>
            <div class="ttd-space"></div>
            <p class="ttd-name">(_____________________)</p>
          </div>
        </div>
      </div>
    `;
  },

  /* ── Helper: CSS Laporan ── */
  _getReportCSS() {
    return `
      body { font-family: Arial, sans-serif; font-size: 11px; color: #000; margin: 0; padding: 20px; }
      .report-header { text-align: center; margin-bottom: 20px; }
      .report-header h1 { font-size: 16px; margin: 0 0 5px 0; }
      .report-header h2 { font-size: 14px; margin: 0 0 5px 0; }
      .report-header p { font-size: 11px; margin: 0; color: #555; }
      .report-header hr { border: 1px solid #000; margin-top: 10px; }
      .section { margin-bottom: 20px; }
      .section h3 { font-size: 13px; background: #eee; padding: 5px; border-left: 4px solid #1f4e79; margin-bottom: 10px; }
      .data-table { width: 100%; border-collapse: collapse; font-size: 10px; }
      .data-table th, .data-table td { border: 1px solid #999; padding: 4px 6px; }
      .data-table th { background: #1f4e79; color: #fff; text-align: left; }
      .data-table td.num { text-align: right; }
      .pos { color: green; font-weight: bold; }
      .neg { color: red; font-weight: bold; }
      .page-break { page-break-before: always; }
      .photo-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .photo-item { text-align: center; border: 1px solid #ccc; padding: 5px; }
      .photo-item img { max-width: 100%; height: auto; max-height: 200px; object-fit: cover; }
      .photo-item p { font-size: 9px; margin-top: 5px; color: #555; }
      .ttd-grid { display: flex; justify-content: space-around; margin-top: 30px; }
      .ttd-box { text-align: center; width: 40%; }
      .ttd-role { font-weight: bold; }
      .ttd-space { height: 60px; }
      .ttd-name { text-decoration: underline; }
      @media print { body { padding: 0; } .page-break { page-break-before: always; } }
    `;
  }
};
