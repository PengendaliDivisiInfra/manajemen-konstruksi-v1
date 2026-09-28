/* =====================================================================
   MODUL IMPORT PROGRESS DARI EXCEL
   ===================================================================== */

(function importProgressModule(){
  function bootstrap(attempt){
    attempt = attempt || 0;
    if (typeof XLSX === 'undefined' || typeof DB === 'undefined' || !DB){
      if (attempt > 60){
        console.error('[ImportProgressExcel.js] XLSX atau DB belum siap');
        return;
      }
      setTimeout(function(){ bootstrap(attempt + 1); }, 300);
      return;
    }
    install();
  }

  function install(){
    if (window._importProgressInstalled) return;
    window._importProgressInstalled = true;

    /* ═══════════════════════════════════════════════════════════
       DOWNLOAD TEMPLATE
       ═══════════════════════════════════════════════════════════ */
    function downloadTemplate(){
      const wb = XLSX.utils.book_new();
      
      const headers = ['Kode WBS', 'Minggu', 'Volume', 'Tanggal', 'Keterangan'];
      const sampleData = [
        ['I.1', 1, 380, '2024-06-03', 'Galian tanah minggu 1'],
        ['I.1', 2, 400, '2024-06-10', 'Galian tanah minggu 2'],
        ['I.2', 1, 210, '2024-06-03', 'Timbunan minggu 1']
      ];
      const wsData = [headers, ...sampleData];
      const ws = XLSX.utils.aoa_to_sheet(wsData);
      ws['!cols'] = [{ wch: 12 }, { wch: 8 }, { wch: 12 }, { wch: 14 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, ws, 'Template Progress');

      const petunjuk = [
        ['PETUNJUK PENGISIAN TEMPLATE IMPORT PROGRESS'],
        [''],
        ['1. Jangan mengubah nama kolom di baris pertama.'],
        ['2. Kolom "Kode WBS" harus sesuai dengan kode WBS di aplikasi (contoh: I.1, II.2).'],
        ['3. Kolom "Minggu" diisi angka (contoh: 1, 2, 3).'],
        ['4. Kolom "Volume" diisi angka (contoh: 380.5). Gunakan titik untuk desimal.'],
        ['5. Kolom "Tanggal" diisi format YYYY-MM-DD (contoh: 2024-06-03).'],
        ['6. Kolom "Keterangan" bersifat opsional.'],
        ['7. Hapus baris contoh sebelum mengunggah file.'],
        [''],
        ['Catatan: Volume tidak boleh melebihi sisa RAB item WBS tersebut.']
      ];
      const wsPetunjuk = XLSX.utils.aoa_to_sheet(petunjuk);
      wsPetunjuk['!cols'] = [{ wch: 80 }];
      XLSX.utils.book_append_sheet(wb, wsPetunjuk, 'Petunjuk');

      XLSX.writeFile(wb, 'template-import-progress.xlsx');
      if (typeof toast === 'function') toast('Template berhasil diunduh');
    }

    /* ═══════════════════════════════════════════════════════════
       OPEN DIALOG IMPORT
       ═══════════════════════════════════════════════════════════ */
    function openImportDialog(projectId){
      projectId = projectId || (typeof STATE !== 'undefined' ? STATE.activeProject : null);
      if (!projectId){
        if (typeof toast === 'function') toast('Pilih proyek dulu', false);
        return;
      }

      const proj = DB.projects.find(p => p.id === projectId);
      if (!proj){
        if (typeof toast === 'function') toast('Proyek tidak ditemukan', false);
        return;
      }

      const html = `
        <div class="imp-intro">
          Import data progress massal dari file Excel. Pastikan format sesuai dengan template.
        </div>
        
        <div style="display:flex; gap:10px; margin-bottom:14px;">
          <button class="btn" id="btnDownloadTemplate" style="background:linear-gradient(135deg,#16a34a,#0f8a3f);border-color:transparent;color:#fff;flex:1;">
            📄 Download Template XLSX
          </button>
          <button class="btn" id="btnUploadExcel" style="background:linear-gradient(135deg,#2f81f7,#1f6fe0);border-color:transparent;color:#fff;flex:1;">
            📥 Pilih File Excel
          </button>
          <input type="file" id="fileImportProgress" accept=".xlsx, .xls" style="display:none;">
        </div>

        <div id="impPreviewWrap" style="display:none;">
          <div class="panel-head" style="margin-bottom:6px"><h3 style="font-size:12px">👁 Preview Data</h3></div>
          <div class="imp-preview" id="impPreview" style="max-height:40vh; overflow:auto; border:1px solid var(--line); border-radius:8px;">
          </div>
          <div id="impSummary" style="margin-top:10px; font-size:12px;"></div>
          <div style="display:flex; gap:8px; justify-content:flex-end; margin-top:14px;">
            <button class="btn btn-ok" id="btnCommitImport" style="background:linear-gradient(135deg,#16a34a,#0f8a3f);border-color:transparent;color:#fff;">
              ✅ Simpan ke Database
            </button>
          </div>
        </div>
      `;

      if (typeof openModal === 'function'){
        openModal('📥 Import Progress dari Excel', html, function(){ return false; });
      } else {
        console.error('openModal tidak ditemukan');
        return;
      }

      setTimeout(function(){
        const submitBtn = document.getElementById('mSubmit');
        if (submitBtn) submitBtn.style.display = 'none';
        const cancelBtn = document.getElementById('mCancel');
        if (cancelBtn) cancelBtn.textContent = 'Tutup';

        const btnDownload = document.getElementById('btnDownloadTemplate');
        const btnUpload = document.getElementById('btnUploadExcel');
        const fileInput = document.getElementById('fileImportProgress');
        const previewWrap = document.getElementById('impPreviewWrap');
        const previewEl = document.getElementById('impPreview');
        const summaryEl = document.getElementById('impSummary');
        const btnCommit = document.getElementById('btnCommitImport');

        if (btnDownload) btnDownload.onclick = downloadTemplate;
        if (btnUpload) btnUpload.onclick = () => fileInput.click();

        let parsedData = [];

        if (fileInput){
          fileInput.onchange = function(e){
            const file = e.target.files[0];
            if (!file) return;

            // Cek dulu apakah proyek punya WBS
            const wbsListCheck = DB.project_wbs.filter(w => w.project_id === projectId && !w.is_group);
            if (wbsListCheck.length === 0){
              if (typeof toast === 'function') toast('⚠ Proyek ini belum memiliki WBS. Tambahkan WBS terlebih dahulu di tab "WBS / BQ".', false);
              return;
            }

            const reader = new FileReader();
            reader.onload = function(ev){
              try {
                const data = new Uint8Array(ev.target.result);
                const wb = XLSX.read(data, { type: 'array' });
                const sheetName = wb.SheetNames[0];
                const sheet = wb.Sheets[sheetName];
                const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
                
                if (rows.length < 2){
                  if (typeof toast === 'function') toast('File kosong atau tidak ada data', false);
                  return;
                }

                parsedData = [];
                const headers = rows[0].map(h => String(h || '').trim());
                
                const idxKode = headers.findIndex(h => h.toLowerCase().includes('kode'));
                const idxMinggu = headers.findIndex(h => h.toLowerCase().includes('minggu'));
                const idxVolume = headers.findIndex(h => h.toLowerCase().includes('volume'));
                const idxTanggal = headers.findIndex(h => h.toLowerCase().includes('tanggal'));
                const idxKet = headers.findIndex(h => h.toLowerCase().includes('keterangan'));

                if (idxKode < 0 || idxMinggu < 0 || idxVolume < 0 || idxTanggal < 0){
                  if (typeof toast === 'function') toast('Kolom wajib tidak ditemukan. Gunakan template yang disediakan.', false);
                  return;
                }

                const wbsList = DB.project_wbs.filter(w => w.project_id === projectId && !w.is_group);
                const wbsMap = {};
                wbsList.forEach(w => { wbsMap[String(w.kode_wbs).trim()] = w; });

                for (let i = 1; i < rows.length; i++){
                  const row = rows[i];
                  if (!row || row.length === 0) continue;
                  const kode = String(row[idxKode] || '').trim();
                  if (!kode) continue;

                  const minggu = parseInt(row[idxMinggu], 10) || 0;
                  const volume = parseFloat(row[idxVolume]) || 0;
                  const tanggalRaw = row[idxTanggal];
                  const keterangan = idxKet >= 0 ? String(row[idxKet] || '').trim() : '';

                  let tanggal = '';
                  if (tanggalRaw){
                    if (typeof tanggalRaw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(tanggalRaw.trim())){
                      tanggal = tanggalRaw.trim();
                    } else if (typeof tanggalRaw === 'number'){
                      const d = new Date((tanggalRaw - 25569) * 86400 * 1000);
                      if (!isNaN(d.getTime())) tanggal = d.toISOString().slice(0,10);
                    } else {
                      const d = new Date(tanggalRaw);
                      if (!isNaN(d.getTime())) tanggal = d.toISOString().slice(0,10);
                    }
                  }

                  let valid = true;
                  let error = '';

                  const wbs = wbsMap[kode];
                  if (!wbs){
                    valid = false;
                    // PESAN ERROR DIPERBARUI: Menyebutkan kode yang dicari
                    error = 'Kode WBS "' + kode + '" tidak ditemukan di proyek ini. Cek tab WBS/BQ.';
                  } else if (minggu < 1){
                    valid = false;
                    error = 'Minggu tidak valid';
                  } else if (volume <= 0){
                    valid = false;
                    error = 'Volume harus > 0';
                  } else if (!tanggal){
                    valid = false;
                    error = 'Tanggal tidak valid';
                  } else {
                    const volRAB = parseFloat(wbs.volume_rab) || 0;
                    const existingVol = DB.progress
                      .filter(p => p.project_id === projectId && p.wbs_id === wbs.id)
                      .reduce((s, p) => s + (parseFloat(p.volume) || 0), 0);
                    
                    const importedVolSameWbs = parsedData
                      .filter(d => d.kode === kode && d.valid)
                      .reduce((s, d) => s + d.volume, 0);

                    if (existingVol + importedVolSameWbs + volume > volRAB){
                      valid = false;
                      error = 'Volume melebihi RAB (Sisa: ' + (volRAB - existingVol - importedVolSameWbs).toFixed(2) + ')';
                    }
                  }

                  parsedData.push({ kode, minggu, volume, tanggal, keterangan, valid, error, wbs_id: wbs ? wbs.id : null });
                }

                renderPreview();
              } catch(err){
                console.error(err);
                if (typeof toast === 'function') toast('Gagal membaca file: ' + err.message, false);
              }
            };
            reader.readAsArrayBuffer(file);
          };
        }

        function renderPreview(){
          if (!parsedData.length){
            if (typeof toast === 'function') toast('Tidak ada data yang bisa diproses', false);
            return;
          }

          previewWrap.style.display = 'block';

          let html = '<table class="pw-table" style="width:100%; border-collapse:collapse; font-size:11px;">';
          html += '<thead><tr>';
          html += '<th>Kode WBS</th><th>Minggu</th><th>Volume</th><th>Tanggal</th><th>Keterangan</th><th>Status</th>';
          html += '</tr></thead><tbody>';

          let validCount = 0;
          let invalidCount = 0;

          parsedData.forEach((d, i) => {
            if (d.valid) validCount++; else invalidCount++;
            const rowClass = d.valid ? '' : 'style="background:rgba(220,38,38,.1);"';
            const statusBadge = d.valid 
              ? '<span class="badge b-ok">OK</span>' 
              : '<span class="badge b-danger">' + d.error + '</span>';
            
            html += '<tr ' + rowClass + '>';
            html += '<td>' + (d.kode || '-') + '</td>';
            html += '<td>' + (d.minggu || '-') + '</td>';
            html += '<td>' + (d.volume || '-') + '</td>';
            html += '<td>' + (d.tanggal || '-') + '</td>';
            html += '<td>' + (d.keterangan || '-') + '</td>';
            html += '<td>' + statusBadge + '</td>';
            html += '</tr>';
          });

          html += '</tbody></table>';
          previewEl.innerHTML = html;

          summaryEl.innerHTML = `
            <div style="display:flex; gap:15px;">
              <div>✅ <b>${validCount} Valid</b></div>
              <div>❌ <b style="color:#f87171">${invalidCount} Invalid</b></div>
            </div>
          `;

          if (btnCommit){
            btnCommit.disabled = validCount === 0;
            btnCommit.onclick = function(){
              commitData(projectId, parsedData.filter(d => d.valid));
            };
          }
        }

        function commitData(projectId, validData){
          if (!validData.length){
            if (typeof toast === 'function') toast('Tidak ada data valid untuk disimpan', false);
            return;
          }

          if (typeof Undo !== 'undefined') Undo.snapshot('Import Progress Excel');
          
          if (!DB.progress) DB.progress = [];
          
          validData.forEach(d => {
            DB.progress.push({
              id: (typeof uid === 'function' ? uid('pg') : 'pg_' + Date.now() + Math.random()),
              project_id: projectId,
              wbs_id: d.wbs_id,
              minggu: d.minggu,
              volume: d.volume,
              tanggal: d.tanggal,
              keterangan: d.keterangan || ''
            });
          });

          if (typeof saveDB === 'function') saveDB();
          
          if (typeof toast === 'function') toast('✅ ' + validData.length + ' data progress berhasil disimpan');
          
          if (typeof closeModal === 'function') closeModal();
          
          if (typeof ProgressManager !== 'undefined' && ProgressManager.renderTable){
            ProgressManager.renderTable();
          } else if (typeof renderProgress === 'function'){
            renderProgress();
          }
          
          if (typeof runCPM === 'function' && STATE.activeProject){
            runCPM(STATE.activeProject);
          }
        }

      }, 100);
    }

    /* ═══════════════════════════════════════════════════════════
       INJECT TOMBOL DI TAB PROGRESS
       ═══════════════════════════════════════════════════════════ */
    function injectImportButton(){
      const headerRow = document.querySelector('#sec-progress .panel:first-child .panel-head .row');
      if (!headerRow) return;
      if (document.getElementById('btnImportProgress')) return;

      const btnWizard = document.getElementById('btnProgressWizard');
      if (!btnWizard) return;

      const btn = document.createElement('button');
      btn.id = 'btnImportProgress';
      btn.className = 'btn';
      btn.style.cssText = 'background:linear-gradient(135deg,#0891b2,#0e7490);border-color:transparent;color:#fff';
      btn.innerHTML = '📥 Import Progress';
      btn.onclick = function(){
        const pid = (typeof STATE !== 'undefined') ? STATE.activeProject : null;
        if (!pid){
          if (typeof toast === 'function') toast('Pilih proyek dulu', false);
          return;
        }
        openImportDialog(pid);
      };
      
      if (btnWizard.nextSibling){
        headerRow.insertBefore(btn, btnWizard.nextSibling);
      } else {
        headerRow.appendChild(btn);
      }
    }

    if (document.readyState === 'loading'){
      document.addEventListener('DOMContentLoaded', injectImportButton);
    } else {
      injectImportButton();
    }
    setTimeout(injectImportButton, 1000);
    setTimeout(injectImportButton, 3000);

    console.log('%c[ImportProgressExcel.js] ✅ Modul Import Progress terpasang',
      'color:#0891b2;font-weight:bold;font-size:13px');
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ bootstrap(0); });
  } else {
    bootstrap(0);
  }
})();
