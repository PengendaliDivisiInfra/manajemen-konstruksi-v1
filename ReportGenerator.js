/* =====================================================================
   MODUL REPORT GENERATOR — Laporan PDF (Harian/Mingguan/Bulanan)
   Menggunakan html2pdf.js untuk convert HTML → PDF A4 Portrait
   ===================================================================== */

(function reportGeneratorModule(){
  function bootstrap(attempt){
    attempt = attempt || 0;
    if (typeof DB === 'undefined' || !DB || typeof html2pdf === 'undefined'){
      if (attempt > 60){
        console.error('[ReportGenerator.js] html2pdf belum siap atau engine belum loaded');
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

    /* ═══════════════════════════════════════════════════════════
       OPEN DIALOG: PILIH TANGGAL
       ═══════════════════════════════════════════════════════════ */

    function openHarianDialog(projectId){
      projectId = projectId || (typeof STATE !== 'undefined' ? STATE.activeProject : null);
      if (!projectId){ _toast('Pilih proyek dulu', false); return; }

      var proj = DB.projects.find(function(p){ return p.id === projectId; });
      if (!proj){ _toast('Proyek tidak ditemukan', false); return; }

      var today = new Date().toISOString().slice(0,10);

      var html = '' +
        '<div class="rg-intro">' +
          'Cetak <b>Laporan Harian</b> untuk proyek <b style="color:#7cb3ff">' + _esc(proj.kode) + '</b>.' +
        '</div>' +
        '<div class="rg-field">' +
          '<label>Tanggal Laporan</label>' +
          '<input type="date" id="rg_tgl" value="' + _esc(today) + '" />' +
        '</div>' +
        '<div class="rg-info" id="rg_info">' +
          '<div class="rg-info-row"><span>Memuat data…</span></div>' +
        '</div>' +
        '<p class="rg-hint">Laporan akan berisi: header logo & identitas, tabel item yang dikerjakan, ringkasan progres, foto dokumentasi, dan kolom tanda tangan.</p>';

      openModal('🖨 Cetak Laporan Harian', html, function(){ return false; });

      setTimeout(function(){
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
          tglEl.onchange = function(){ updateInfo(projectId, tglEl.value); };
        }
        updateInfo(projectId, today);
      }, 10);
    }

    function updateInfo(projectId, tanggal){
      var info = document.getElementById('rg_info');
      if (!info) return;

      var proj = DB.projects.find(function(p){ return p.id === projectId; });
      var progress = DB.progress.filter(function(p){
        return p.project_id === projectId && (p.tanggal || '').split('T')[0] === tanggal;
      });

      var wbsDone = {};
      progress.forEach(function(p){ wbsDone[p.wbs_id] = true; });
      var wbsCount = Object.keys(wbsDone).length;

      var photos = DB.photos.filter(function(p){
        return p.project_id === projectId && (p.tanggal || '').split('T')[0] === tanggal;
      });

      info.innerHTML =
        '<div class="rg-info-row"><span>📊 Item WBS dikerjakan:</span><b>' + wbsCount + ' item</b></div>' +
        '<div class="rg-info-row"><span>📷 Foto dokumentasi:</span><b>' + photos.length + ' foto</b></div>' +
        '<div class="rg-info-row"><span>📅 Tanggal:</span><b>' + formatHariTgl(tanggal) + '</b></div>';
    }

    /* ═══════════════════════════════════════════════════════════
       GENERATE LAPORAN HARIAN
       ═══════════════════════════════════════════════════════════ */

    function generateHarian(projectId, tanggal){
      var proj = DB.projects.find(function(p){ return p.id === projectId; });
      if (!proj){ _toast('Proyek tidak ditemukan', false); return; }

      var meta = (window.ProjectMeta && ProjectMeta.get)
        ? ProjectMeta.get(projectId)
        : {};

      var html = buildHarianHTML(proj, meta, tanggal);
      renderToPDF(html, 'Laporan-Harian-' + proj.kode + '-' + tanggal + '.pdf');
    }

    function buildHarianHTML(proj, meta, tanggal){
      // Ambil progress hari ini
      var progress = DB.progress.filter(function(p){
        return p.project_id === proj.id && (p.tanggal || '').split('T')[0] === tanggal;
      });

      // Group by WBS
      var byWbs = {};
      progress.forEach(function(p){
        if (!byWbs[p.wbs_id]) byWbs[p.wbs_id] = 0;
        byWbs[p.wbs_id] += _num(p.volume);
      });

      // Hitung total proyek
      var wbsRows = (typeof Calc !== 'undefined' && Calc.wbsRows) ? Calc.wbsRows(proj.id) : [];
      var totalRAB = wbsRows.filter(function(r){ return !r.isGroup; })
        .reduce(function(s, r){ return s + _num(r.total_rab); }, 0) || 1;

      // Baris tabel
      var rowsData = [];
      Object.keys(byWbs).forEach(function(wbsId){
        var w = DB.project_wbs.find(function(x){ return x.id === wbsId; });
        if (!w) return;
        var r = wbsRows.find(function(x){ return x.id === wbsId; });
        var totalRab = r ? _num(r.total_rab) : 0;
        var bobot = totalRab / totalRAB * 100;
        var volHari = byWbs[wbsId];
        var volRAB = _num(w.volume_rab);
        var pctHari = volRAB > 0 ? (volHari / volRAB * 100) : 0;
        var pctBobotHari = bobot * (pctHari / 100);

        rowsData.push({
          kode: w.kode_wbs,
          uraian: w.uraian,
          satuan: w.satuan || '-',
          volHari: volHari,
          volRAB: volRAB,
          pctHari: pctHari,
          bobot: bobot,
          pctBobotHari: pctBobotHari
        });
      });

      // Hitung progres kumulatif
      var allProgress = DB.progress.filter(function(p){ return p.project_id === proj.id; });
      var allByWbs = {};
      allProgress.forEach(function(p){
        if (!allByWbs[p.wbs_id]) allByWbs[p.wbs_id] = 0;
        allByWbs[p.wbs_id] += _num(p.volume);
      });

      var totalKumulatif = 0;
      var totalRencana = 0;
      var mingguNow = hitungMinggu(proj, tanggal);
      var sc = (typeof Calc !== 'undefined' && Calc.scurve) ? Calc.scurve(proj.id) : { planned:[], actual:[] };
      var totalRencanaPct = sc.planned[Math.min(mingguNow-1, sc.planned.length-1)] || 0;

      wbsRows.filter(function(r){ return !r.isGroup; }).forEach(function(r){
        var vol = allByWbs[r.id] || 0;
        var volRAB = _num(r.volume_rab);
        var bobot = _num(r.total_rab) / totalRAB * 100;
        if (volRAB > 0){
          totalKumulatif += bobot * Math.min(1, vol / volRAB);
        }
      });

      var pctHariIni = rowsData.reduce(function(s, r){ return s + r.pctBobotHari; }, 0);
      var deviasi = totalKumulatif - totalRencanaPct;

      // Foto
      var photos = DB.photos.filter(function(p){
        return p.project_id === proj.id && (p.tanggal || '').split('T')[0] === tanggal;
      }).sort(function(a,b){ return (a.urutan||0)-(b.urutan||0); });

      // Header / Footer
      var logoPupr = meta.logo_pupr ? '<img src="' + meta.logo_pupr + '" class="rg-logo" />' : '<div class="rg-logo-ph"></div>';
      var logoKontraktor = meta.logo_kontraktor ? '<img src="' + meta.logo_kontraktor + '" class="rg-logo" />' : '<div class="rg-logo-ph"></div>';

      // TTD
      function ttdBlock(data){
        return '' +
          '<div class="rg-ttd">' +
            '<div class="rg-ttd-jabatan">' + _esc(data.jabatan || '') + '</div>' +
            '<div class="rg-ttd-space"></div>' +
            '<div class="rg-ttd-nama"><b>' + _esc(data.nama || '................................') + '</b></div>' +
            (data.nik ? '<div class="rg-ttd-nik">NIP/NIK: ' + _esc(data.nik) + '</div>' : '') +
          '</div>';
      }

      return '' +
        '<div class="rg-page">' +

          /* Header */
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

          /* Info Proyek */
          '<table class="rg-info-table">' +
            '<tr><td class="rg-k">Nama Paket</td><td class="rg-c">:</td><td>' + _esc(proj.nama) + '</td></tr>' +
            '<tr><td class="rg-k">Kode Proyek</td><td class="rg-c">:</td><td>' + _esc(proj.kode) + '</td></tr>' +
            '<tr><td class="rg-k">Lokasi</td><td class="rg-c">:</td><td>' +
              _esc([meta.lokasi_desa, meta.lokasi_kecamatan, meta.lokasi_kabupaten].filter(Boolean).join(', ') || proj.lokasi || '-') +
            '</td></tr>' +
            '<tr><td class="rg-k">Kontraktor</td><td class="rg-c">:</td><td>' + _esc(meta.nama_kontraktor || '-') + '</td></tr>' +
            '<tr><td class="rg-k">Nomor Kontrak</td><td class="rg-c">:</td><td>' + _esc(meta.nomor_kontrak || '-') + '</td></tr>' +
            '<tr><td class="rg-k">Sumber Dana</td><td class="rg-c">:</td><td>' + _esc(meta.sumber_dana || '-') + ' / TA ' + _esc(meta.tahun_anggaran || '') + '</td></tr>' +
            '<tr><td class="rg-k">Tanggal</td><td class="rg-c">:</td><td><b>' + formatHariTgl(tanggal) + '</b></td></tr>' +
            '<tr><td class="rg-k">Minggu ke-</td><td class="rg-c">:</td><td>' + mingguNow + ' dari ' + (proj.durasi_minggu || '-') + '</td></tr>' +
          '</table>' +

          /* Tabel pekerjaan */
          '<div class="rg-section-title">A. Pekerjaan yang Dilaksanakan</div>' +
          '<table class="rg-table">' +
            '<thead>' +
              '<tr>' +
                '<th style="width:40px">No</th>' +
                '<th style="width:70px">Kode</th>' +
                '<th>Uraian Pekerjaan</th>' +
                '<th style="width:60px">Sat</th>' +
                '<th style="width:90px" class="rg-num">Vol Hari Ini</th>' +
                '<th style="width:80px" class="rg-num">% Item</th>' +
                '<th style="width:80px" class="rg-num">Bobot %</th>' +
              '</tr>' +
            '</thead>' +
            '<tbody>' +
              (rowsData.length
                ? rowsData.map(function(r, i){
                    return '<tr>' +
                      '<td class="rg-center">' + (i+1) + '</td>' +
                      '<td>' + _esc(r.kode) + '</td>' +
                      '<td>' + _esc(r.uraian) + '</td>' +
                      '<td class="rg-center">' + _esc(r.satuan) + '</td>' +
                      '<td class="rg-num">' + _fmt(r.volHari, 2) + '</td>' +
                      '<td class="rg-num">' + _fmt(r.pctHari, 2) + '%</td>' +
                      '<td class="rg-num"><b>' + _fmt(r.pctBobotHari, 3) + '%</b></td>' +
                    '</tr>';
                  }).join('')
                : '<tr><td colspan="7" class="rg-empty">Tidak ada pekerjaan yang dilaporkan pada tanggal ini</td></tr>') +
            '</tbody>' +
            '<tfoot>' +
              '<tr>' +
                '<td colspan="6" class="rg-num rg-bold">Progres Hari Ini</td>' +
                '<td class="rg-num rg-bold">' + _fmt(pctHariIni, 3) + '%</td>' +
              '</tr>' +
            '</tfoot>' +
          '</table>' +

          /* Ringkasan */
          '<div class="rg-section-title">B. Ringkasan Progres</div>' +
          '<table class="rg-summary">' +
            '<tr>' +
              '<td class="rg-sum-k">Progres Hari Ini</td>' +
              '<td class="rg-sum-v">' + _fmt(pctHariIni, 3) + '%</td>' +
              '<td class="rg-sum-k">Progres Kumulatif</td>' +
              '<td class="rg-sum-v">' + _fmt(totalKumulatif, 3) + '%</td>' +
            '</tr>' +
            '<tr>' +
              '<td class="rg-sum-k">Rencana (Kurva S)</td>' +
              '<td class="rg-sum-v">' + _fmt(totalRencanaPct, 3) + '%</td>' +
              '<td class="rg-sum-k">Deviasi</td>' +
              '<td class="rg-sum-v ' + (deviasi >= 0 ? 'rg-ok' : 'rg-bad') + '">' +
                (deviasi >= 0 ? '+' : '') + _fmt(deviasi, 3) + '% ' +
                (deviasi >= 0 ? '(Ahead)' : '(Behind)') +
              '</td>' +
            '</tr>' +
          '</table>' +

          /* Foto */
          (photos.length
            ? '<div class="rg-section-title">C. Dokumentasi Foto</div>' +
              '<div class="rg-photo-grid">' +
                photos.map(function(p){
                  var w = DB.project_wbs.find(function(x){ return x.id === p.wbs_id; });
                  var cap = p.caption || (w ? (w.kode_wbs + ' — ' + w.uraian) : '');
                  return '<div class="rg-photo-item">' +
                    '<img src="' + p.file_data + '" />' +
                    '<div class="rg-photo-cap">' + _esc(cap) + '</div>' +
                  '</div>';
                }).join('') +
              '</div>'
            : '') +

          /* TTD */
          '<div class="rg-section-title">D. Tanda Tangan</div>' +
          '<div class="rg-ttd-wrap">' +
            '<div class="rg-ttd-col">' + ttdBlock(meta.ttd_project_manager || {}) + '</div>' +
            '<div class="rg-ttd-col">' + ttdBlock(meta.ttd_team_leader || {}) + '</div>' +
          '</div>' +
          '<div class="rg-ttd-wrap" style="margin-top:10px">' +
            '<div class="rg-ttd-col">' + ttdBlock(meta.ttd_direksi || {}) + '</div>' +
            '<div class="rg-ttd-col">' + ttdBlock(meta.ttd_ppk || {}) + '</div>' +
          '</div>' +

          '<div class="rg-footer">' +
            'Dicetak: ' + new Date().toLocaleString('id-ID') +
            ' · Manajemen Konstruksi v1' +
          '</div>' +

        '</div>';
    }

    /* ═══════════════════════════════════════════════════════════
       RENDER KE PDF
       ═══════════════════════════════════════════════════════════ */

    function renderToPDF(html, filename){
      // Container sementara di body (invisible, ukuran A4)
      var temp = document.createElement('div');
      temp.style.cssText = 'position:fixed;left:-9999px;top:0;width:794px;background:#fff;';
      temp.innerHTML = '<style>' + getPDFStyles() + '</style>' + html;
      document.body.appendChild(temp);

      // Konfigurasi html2pdf
      var opt = {
        margin:       [10, 10, 10, 10],
        filename:     filename,
        image:        { type: 'jpeg', quality: 0.95 },
        html2canvas:  { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF:        { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak:    { mode: ['avoid-all', 'css', 'legacy'] }
      };

      _toast('⏳ Sedang membuat PDF...');

      html2pdf().set(opt).from(temp.firstElementChild || temp).save().then(function(){
        document.body.removeChild(temp);
        _toast('✅ PDF berhasil dibuat');
      }).catch(function(err){
        document.body.removeChild(temp);
        console.error(err);
        _toast('Gagal membuat PDF: ' + err.message, false);
      });
    }

    /* ═══════════════════════════════════════════════════════════
       STYLES KHUSUS UNTUK PDF
       ═══════════════════════════════════════════════════════════ */

    function getPDFStyles(){
      return '' +
        '* { box-sizing: border-box; }' +
        'body { margin: 0; padding: 0; font-family: Arial, sans-serif; color: #111; font-size: 10.5px; line-height: 1.4; }' +
        '.rg-page { padding: 0; background: #fff; }' +

        /* Header */
        '.rg-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 8px; }' +
        '.rg-header-logo { width: 80px; flex-shrink: 0; text-align: center; }' +
        '.rg-logo { max-width: 75px; max-height: 75px; object-fit: contain; }' +
        '.rg-logo-ph { width: 75px; height: 75px; border: 1px dashed #999; border-radius: 4px; }' +
        '.rg-header-text { flex: 1; text-align: center; }' +
        '.rg-instansi { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .5px; }' +
        '.rg-alamat { font-size: 9px; color: #555; margin-top: 2px; }' +
        '.rg-title { font-size: 14px; font-weight: 700; margin-top: 6px; text-decoration: underline; letter-spacing: .8px; }' +
        '.rg-hr { height: 3px; background: #1f4e79; margin: 4px 0 12px 0; }' +

        /* Info */
        '.rg-info-table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 10px; }' +
        '.rg-info-table td { padding: 2px 4px; vertical-align: top; }' +
        '.rg-info-table .rg-k { width: 120px; font-weight: 600; }' +
        '.rg-info-table .rg-c { width: 8px; }' +

        /* Section title */
        '.rg-section-title { font-size: 11px; font-weight: 700; margin: 12px 0 6px 0; padding: 4px 8px; background: #e7effa; border-left: 3px solid #1f4e79; text-transform: uppercase; letter-spacing: .3px; }' +

        /* Tabel utama */
        '.rg-table { width: 100%; border-collapse: collapse; font-size: 9.5px; margin-bottom: 10px; }' +
        '.rg-table th, .rg-table td { border: 1px solid #333; padding: 4px 6px; vertical-align: middle; }' +
        '.rg-table th { background: #1f4e79; color: #fff; font-weight: 700; text-align: center; font-size: 9.5px; }' +
        '.rg-table tfoot td { background: #f0f0f0; font-weight: 700; }' +
        '.rg-table .rg-num { text-align: right; }' +
        '.rg-table .rg-center { text-align: center; }' +
        '.rg-table .rg-empty { text-align: center; font-style: italic; color: #888; padding: 10px; }' +
        '.rg-bold { font-weight: 700; }' +

        /* Ringkasan */
        '.rg-summary { width: 100%; border-collapse: collapse; font-size: 10px; margin-bottom: 10px; }' +
        '.rg-summary td { border: 1px solid #333; padding: 6px 8px; }' +
        '.rg-sum-k { background: #f0f0f0; font-weight: 600; width: 130px; }' +
        '.rg-sum-v { width: 130px; text-align: right; font-weight: 700; }' +
        '.rg-sum-v.rg-ok { color: #16a34a; }' +
        '.rg-sum-v.rg-bad { color: #dc2626; }' +

        /* Foto */
        '.rg-photo-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }' +
        '.rg-photo-item { border: 1px solid #333; padding: 4px; background: #fff; }' +
        '.rg-photo-item img { width: 100%; height: 130px; object-fit: cover; display: block; }' +
        '.rg-photo-cap { font-size: 9px; color: #333; margin-top: 3px; line-height: 1.3; min-height: 22px; }' +

        /* TTD */
        '.rg-ttd-wrap { display: flex; justify-content: space-between; gap: 20px; margin-top: 12px; page-break-inside: avoid; }' +
        '.rg-ttd-col { flex: 1; text-align: center; font-size: 10px; }' +
        '.rg-ttd { padding: 6px 4px; }' +
        '.rg-ttd-jabatan { font-weight: 700; text-transform: uppercase; font-size: 9.5px; }' +
        '.rg-ttd-space { height: 55px; }' +
        '.rg-ttd-nama { border-top: 1px solid #333; padding-top: 3px; font-size: 10px; }' +
        '.rg-ttd-nik { font-size: 9px; color: #555; margin-top: 1px; }' +

        /* Footer */
        '.rg-footer { margin-top: 16px; padding-top: 6px; border-top: 1px dashed #999; font-size: 8.5px; color: #666; text-align: right; }' +

        '.rg-page { page-break-after: always; }' +
        '.rg-page:last-child { page-break-after: auto; }';
    }

    /* ═══════════════════════════════════════════════════════════
       PUBLIC API + TOMBOL
       ═══════════════════════════════════════════════════════════ */

    window.ReportGenerator = {
      openHarian: openHarianDialog,
      harian: function(pid, tgl){ generateHarian(pid, tgl); }
    };

    // Inject tombol "🖨 Cetak Laporan" di tab Progress
    function injectPrintButton(){
      var headerRow = document.querySelector('#sec-progress .panel:first-child .panel-head .row');
      if (!headerRow) return;
      if (document.getElementById('btnPrintReport')) return;

      var btn = document.createElement('button');
      btn.id = 'btnPrintReport';
      btn.className = 'btn';
      btn.style.cssText = 'background:linear-gradient(135deg,#dc2626,#b91c1c);border-color:transparent;color:#fff';
      btn.innerHTML = '🖨 Cetak Laporan';
      btn.onclick = function(){
        var pid = (typeof STATE !== 'undefined') ? STATE.activeProject : null;
        if (!pid){ _toast('Pilih proyek dulu', false); return; }
        openHarianDialog(pid);
      };
      headerRow.appendChild(btn);
    }

    if (document.readyState === 'loading'){
      document.addEventListener('DOMContentLoaded', injectPrintButton);
    } else {
      injectPrintButton();
    }
    setTimeout(injectPrintButton, 1000);
    setTimeout(injectPrintButton, 3000);

    console.log('%c[ReportGenerator.js] ✅ Report Generator installed',
      'color:#dc2626;font-weight:bold;font-size:13px');
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ bootstrap(0); });
  } else {
    bootstrap(0);
  }
})();
