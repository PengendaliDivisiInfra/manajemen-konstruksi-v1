/* =====================================================================
   WBS TABLE — Inline Editable Bill of Quantity Table
   Auto-sync ke DB.project_wbs + re-render Gantt/SCurve
   ===================================================================== */

const WbsTable = {

  /* ═══════════════════════════════════════════════════════════
     RENDER: Tabel WBS dengan hierarki 3-level + inline edit
     ═══════════════════════════════════════════════════════════ */
  render(containerId, projectId){
    const container = document.getElementById(containerId);
    if (!container) return;

    projectId = projectId || STATE.activeProject;
    if (!projectId){
      container.innerHTML = '<tbody><tr><td class="empty">Belum ada proyek aktif.</td></tr></tbody>';
      return;
    }

    // Recalculate CPM dulu agar tanggal terisi
    if (typeof runCPM === 'function') runCPM(projectId);

    const allItems = DB.project_wbs
      .filter(w => w.project_id === projectId)
      .sort((a, b) => {
        // Natural sort by kode_wbs (1 < 1.1 < 1.1.1)
        const pa = String(a.kode_wbs || '').split('.').map(Number);
        const pb = String(b.kode_wbs || '').split('.').map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++){
          const va = pa[i] || 0, vb = pb[i] || 0;
          if (va !== vb) return va - vb;
        }
        return (a.urut || 0) - (b.urut || 0);
      });

    const head = `
      <thead>
        <tr>
          <th style="width:70px">KODE</th>
          <th>URAIAN</th>
          <th style="width:55px" class="center">SAT</th>
          <th style="width:95px" class="num">VOL RAB</th>
          <th style="width:95px" class="num">VOL RAP</th>
          <th style="width:110px" class="num">TOTAL RAB</th>
          <th style="width:110px" class="num">TOTAL RAP</th>
          <th style="width:80px" class="num">DEV</th>
          <th style="width:70px" class="center">PRED</th>
          <th style="width:60px" class="center">DUR</th>
          <th style="width:105px" class="center">START</th>
          <th style="width:105px" class="center">FINISH</th>
          <th style="width:60px" class="center">FLOAT</th>
          <th style="width:65px" class="center">KRITIS</th>
          <th style="width:70px" class="center">AKSI</th>
        </tr>
      </thead>
    `;

    // Build rows
    const rows = this._buildRows(allItems, projectId);

    // Footer total
    const total = (typeof Calc !== 'undefined' && Calc.totals) ? Calc.totals(projectId) : { rab: 0, rap: 0, dev: 0 };
    const foot = `
      <tfoot>
        <tr style="background:#0e1a30;font-weight:800">
          <td colspan="5" style="text-align:right;padding:12px">TOTAL</td>
          <td class="num">${rp(total.rab)}</td>
          <td class="num">${rp(total.rap)}</td>
          <td class="num ${total.dev >= 0 ? 'pos' : 'neg'}">${rp(total.dev)}</td>
          <td colspan="7"></td>
        </tr>
      </tfoot>
    `;

    container.innerHTML = head + `<tbody>${rows}</tbody>` + foot;

    // Wire inline editing
    this._wireInlineEdit(container, projectId);
  },

  /* ═══════════════════════════════════════════════════════════
     BUILD ROWS: Hierarki deduktif + editable cells
     ═══════════════════════════════════════════════════════════ */
  _buildRows(items, projectId){
    if (!items.length){
      return '<tr><td colspan="15" class="empty">Belum ada item WBS. Klik "⚡ Generate WBS" untuk auto-generate.</td></tr>';
    }

    const wbsRows = (typeof Calc !== 'undefined' && Calc.wbsRows) ? Calc.wbsRows(projectId) : [];
    const rowsById = {};
    wbsRows.forEach(r => { rowsById[r.id] = r; });

    return items.map(w => {
      const level = w.wbs_level || WbsTemplate.parseLevel(w.kode_wbs);
      const isGroup = !!w.is_group;
      const wbsEnriched = rowsById[w.id] || w;

      // Level class
      const lvlClass = 'lvl' + level;
      const indent = (level - 1) * 18;

      // Enriched calc
      const hargaRAB = isGroup ? 0 : (wbsEnriched.harga_satuan_rab || 0);
      const hargaRAP = isGroup ? 0 : (wbsEnriched.harga_satuan_rap || 0);
      const vRAB = num(w.volume_rab);
      const vRAP = num(w.volume_rap);
      const totalRAB = isGroup ? 0 : vRAB * hargaRAB;
      const totalRAP = isGroup ? 0 : vRAP * hargaRAP;
      const dev = totalRAB - totalRAP;
      const devCls = dev >= 0 ? 'pos' : 'neg';

      const critical = num(w.is_critical) === 1;
      const critBadge = isGroup
        ? ''
        : (critical
            ? '<span class="badge b-danger">KRITIS</span>'
            : '<span class="badge b-ok">OK</span>');

      // Pred label
      const predLabel = w.predecessor
        ? ((DB.project_wbs.find(x => x.id === w.predecessor) || {}).kode_wbs || '?')
        : '';

      // Editable cells (hanya untuk leaf/level 3)
      const editable = !isGroup;

      // Volume RAB
      const volRABCell = editable
        ? `<input type="number" class="wbs-inline-input num" data-field="volume_rab" data-wbs="${w.id}" value="${vRAB}" step="0.01" min="0" />`
        : `<span class="wbs-num">${fmt(vRAB, 2)}</span>`;

      // Volume RAP
      const volRAPCell = editable
        ? `<input type="number" class="wbs-inline-input num" data-field="volume_rap" data-wbs="${w.id}" value="${vRAP}" step="0.01" min="0" />`
        : `<span class="wbs-num">${fmt(vRAP, 2)}</span>`;

      // Predecessor
      const predCell = editable
        ? `<input type="text" class="wbs-inline-input pred" data-field="predecessor" data-wbs="${w.id}" value="${esc(predLabel)}" placeholder="—" title="Contoh: 1.1FS+2" />`
        : '';

      // Duration
      const durCell = editable
        ? `<input type="number" class="wbs-inline-input num mini" data-field="duration" data-wbs="${w.id}" value="${num(w.duration) || 1}" min="1" step="1" />`
        : `<span class="wbs-num">${num(w.durasi_hari) || 0}</span>`;

      // Start Date
      const startCell = editable
        ? `<input type="date" class="wbs-inline-input date" data-field="tgl_mulai_rencana" data-wbs="${w.id}" value="${esc(w.tgl_mulai_rencana || '')}" />`
        : `<span class="wbs-date">${esc(w.tgl_mulai_rencana || '—')}</span>`;

      // Finish Date
      const finishCell = editable
        ? `<input type="date" class="wbs-inline-input date" data-field="tgl_selesai_rencana" data-wbs="${w.id}" value="${esc(w.tgl_selesai_rencana || '')}" />`
        : `<span class="wbs-date">${esc(w.tgl_selesai_rencana || '—')}</span>`;

      // Float
      const flt = num(w.float_total ?? w.total_float);
      const floatCell = `<span class="wbs-num">${fmt(flt, 0)}h</span>`;

      return `
        <tr class="${lvlClass}" data-wbs-id="${w.id}" data-level="${level}">
          <td>${esc(w.kode_wbs)}</td>
          <td style="padding-left:${indent}px">${esc(w.uraian)}</td>
          <td class="center">${esc(w.satuan || '')}</td>
          <td class="num">${volRABCell}</td>
          <td class="num">${volRAPCell}</td>
          <td class="num">${isGroup ? '' : rp(totalRAB)}</td>
          <td class="num">${isGroup ? '' : rp(totalRAP)}</td>
          <td class="num ${devCls}">${isGroup ? '' : rp(dev)}</td>
          <td class="center">${predCell}</td>
          <td class="center">${durCell}</td>
          <td class="center">${startCell}</td>
          <td class="center">${finishCell}</td>
          <td class="center">${floatCell}</td>
          <td class="center">${critBadge}</td>
          <td class="center">
            <button class="btn btn-sm" data-edit-wbs="${w.id}">✎</button>
            <button class="btn btn-sm btn-danger" data-del-wbs="${w.id}">✕</button>
          </td>
        </tr>
      `;
    }).join('');
  },

  /* ═══════════════════════════════════════════════════════════
     WIRE INLINE EDIT: event delegation + auto-save + re-render
     ═══════════════════════════════════════════════════════════ */
  _wireInlineEdit(container, projectId){
    // Debounce timer untuk save
    let saveTimer = null;

    const scheduleSave = (field, wbsId) => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        this._commitChange(wbsId, field, projectId);
      }, 800);  // delay 800ms agar user bisa selesai ketik
    };

    // Event listener untuk semua input inline
    container.querySelectorAll('.wbs-inline-input').forEach(input => {
      const field = input.getAttribute('data-field');
      const wbsId = input.getAttribute('data-wbs');
      if (!field || !wbsId) return;

      input.addEventListener('change', () => {
        // Commit langsung saat user blur / selesai
        this._commitChange(wbsId, field, projectId);
      });

      input.addEventListener('input', () => {
        // Debounced save saat user mengetik
        scheduleSave(field, wbsId);
      });

      // Prevent row click (edit button) saat klik input
      input.addEventListener('click', (e) => e.stopPropagation());
    });
  },

  /* ═══════════════════════════════════════════════════════════
     COMMIT: Update DB.project_wbs + re-render + save
     ═══════════════════════════════════════════════════════════ */
  _commitChange(wbsId, field, projectId){
    const input = document.querySelector(`.wbs-inline-input[data-wbs="${wbsId}"][data-field="${field}"]`);
    if (!input) return;

    const wbs = DB.project_wbs.find(w => w.id === wbsId);
    if (!wbs) return;

    const rawValue = input.value;
    let value = rawValue;

    // Parse sesuai tipe field
    if (field === 'volume_rab' || field === 'volume_rap' || field === 'duration'){
      value = num(rawValue);
    } else if (field === 'predecessor'){
      // Konversi kode_wbs → id (jika user isi kode)
      const refKode = String(rawValue).trim();
      if (refKode){
        const pred = DB.project_wbs.find(w => w.project_id === projectId && w.kode_wbs === refKode);
        value = pred ? pred.id : refKode;
      } else {
        value = '';
      }
    }

    // Cek apakah ada perubahan
    if (wbs[field] === value) return;

    // Update DB
    if (typeof Undo !== 'undefined') Undo.snapshot('Edit inline: ' + (wbs.kode_wbs || '') + ' → ' + field);
    wbs[field] = value;

    // Auto-save
    if (typeof saveDB === 'function') saveDB();

    // Recalculate CPM jika field terkait jadwal
    if (['duration', 'predecessor', 'tgl_mulai_rencana', 'tgl_selesai_rencana'].includes(field)){
      if (typeof runCPM === 'function'){
        const cpm = runCPM(projectId);
        if (cpm.ok){
          // Update tanggal di row lain yang terdampak
          this._softRefreshRow(wbsId, projectId);
        }
      }
    }

    // Re-render komponen terkait
    this._refreshRelatedViews(projectId);

    // Toast notifikasi
    if (typeof toast === 'function'){
      toast('✓ ' + (wbs.kode_wbs || '') + ' tersimpan', true);
    }
  },

  /* ═══════════════════════════════════════════════════════════
     SOFT REFRESH: Update nilai cell yang terdampak tanpa re-render
     ═══════════════════════════════════════════════════════════ */
  _softRefreshRow(wbsId, projectId){
    const wbs = DB.project_wbs.find(w => w.id === wbsId);
    if (!wbs) return;

    const row = document.querySelector(`tr[data-wbs-id="${wbsId}"]`);
    if (!row) return;

    // Update start / finish / float cells
    const startCell = row.querySelector('.wbs-inline-input[data-field="tgl_mulai_rencana"]');
    const finishCell = row.querySelector('.wbs-inline-input[data-field="tgl_selesai_rencana"]');
    if (startCell) startCell.value = wbs.tgl_mulai_rencana || '';
    if (finishCell) finishCell.value = wbs.tgl_selesai_rencana || '';

    // Update float & critical badge
    const cells = row.querySelectorAll('td');
    if (cells.length >= 14){
      const floatCell = cells[12];
      const critCell = cells[13];
      if (floatCell){
        floatCell.innerHTML = `<span class="wbs-num">${fmt(num(wbs.float_total ?? wbs.total_float), 0)}h</span>`;
      }
      if (critCell && !wbs.is_group){
        const critical = num(wbs.is_critical) === 1;
        critCell.innerHTML = critical
          ? '<span class="badge b-danger">KRITIS</span>'
          : '<span class="badge b-ok">OK</span>';
      }
    }
  },

  /* ═══════════════════════════════════════════════════════════
     REFRESH RELATED VIEWS: Gantt, Schedule, S-Curve, KPIs
     ═══════════════════════════════════════════════════════════ */
  _refreshRelatedViews(projectId){
    // Gantt Chart
    const ganttEl = document.getElementById('ganttContainer');
    if (ganttEl && typeof GanttView !== 'undefined'){
      try {
        GanttView.mount(ganttEl, projectId, {
          mode: ganttEl._mode || 'rab',
          zoom: ganttEl._lastZoom || 'weekly'
        });
      } catch(e){ console.warn('GanttView refresh error:', e); }
    }

    // Schedule Tab KPIs
    if (typeof renderSchedule === 'function' && document.getElementById('sec-schedule')?.classList.contains('active')){
      try { renderSchedule(); } catch(e){}
    }

    // Dashboard S-Curve
    if (typeof renderDashboard === 'function' && document.getElementById('sec-dashboard')?.classList.contains('active')){
      try { renderDashboard(); } catch(e){}
    }

    // Progress S-Curve
    if (typeof renderProgressScurve === 'function' && document.getElementById('chartProgressScurve')){
      try { renderProgressScurve(projectId); } catch(e){}
    }
  }
};

window.WbsTable = WbsTable;
console.log('%c[WbsTable.js] ✅ Inline Editable BQ Table loaded',
  'color:#a855f7;font-weight:bold;font-size:12px');
