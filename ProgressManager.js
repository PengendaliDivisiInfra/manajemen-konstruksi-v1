/* =====================================================================
   PROGRESS MANAGER v2 — Laporan Progres dengan Hierarki WBS & Filter Periode
   ===================================================================== */

const ProgressManager = {
  currentPeriod: 'weekly',     // 'daily' | 'weekly' | 'monthly'
  currentRangeStart: null,
  currentRangeEnd: null,

  /* ═══════════════════════════════════════════════════════════
     A. RENDER TABEL UTAMA
     ═══════════════════════════════════════════════════════════ */
  renderTable(projectId) {
    projectId = projectId || STATE.activeProject;
    if (!projectId) return;

    const container = document.getElementById('tblProg');
    if (!container) return;

    // Ambil semua WBS proyek
    const allWbs = DB.project_wbs.filter(w => w.project_id === projectId);
    if (!allWbs.length) {
      container.innerHTML = '<tbody><tr><td class="empty">Belum ada WBS. Tambahkan di tab WBS/BQ.</td></tr></tbody>';
      return;
    }

    // Bangun tree
    const tree = this.buildTree(allWbs);
    const leaves = this.collectLeaves(tree);

    // Dapatkan daftar periode berdasarkan currentPeriod
    const periods = this.getPeriods(projectId, this.currentPeriod);

    // Header
    const headCols = periods.map(p => 
      `<th class="center" style="min-width:90px">${esc(p.label)}</th>`
    ).join('');

    const head = `
      <thead>
        <tr>
          <th style="width:80px">Kode</th>
          <th>Uraian Pekerjaan</th>
          <th style="width:55px" class="center">Sat</th>
          <th style="width:80px" class="num">Vol RAB</th>
          <th style="width:80px" class="num">Bobot %</th>
          ${headCols}
          <th style="width:90px" class="num">Total (%)</th>
        </tr>
      </thead>
    `;

    // Body: render tree
    const body = this.renderTreeRows(tree, leaves, periods, projectId, 0);

    container.innerHTML = head + `<tbody>${body}</tbody>`;

    // Wire input events
    this.wireInputEvents(projectId, periods);
  },

  /* ═══════════════════════════════════════════════════════════
     B. BUILD TREE 3-LEVEL
     ═══════════════════════════════════════════════════════════ */
  buildTree(allWbs) {
    const byId = {};
    const childrenOf = {};
    const roots = [];

    allWbs.forEach(w => {
      byId[w.id] = w;
      childrenOf[w.id] = [];
    });

    allWbs.forEach(w => {
      if (w.parent_id && byId[w.parent_id]) {
        childrenOf[w.parent_id].push(w);
      } else {
        roots.push(w);
      }
    });

    const sorter = (a, b) => (a.urut || 0) - (b.urut || 0);

    function walk(node, level) {
      node._level = level;
      node._children = (childrenOf[node.id] || []).sort(sorter);
      node._children.forEach(c => walk(c, level + 1));
      return node;
    }

    return roots.sort(sorter).map(r => walk(r, 1));
  },

  collectLeaves(tree) {
    const leaves = [];
    function walk(node) {
      if (!node._children.length) {
        leaves.push(node);
      } else {
        node._children.forEach(walk);
      }
    }
    tree.forEach(walk);
    return leaves;
  },

  /* ═══════════════════════════════════════════════════════════
     C. DAFTAR PERIODE DINAMIS
     ═══════════════════════════════════════════════════════════ */
  getPeriods(projectId, mode) {
    const proj = DB.projects.find(p => p.id === projectId);
    if (!proj) return [];

    const start = proj.tgl_mulai || today();
    const end = proj.tgl_selesai || today();

    const periods = [];
    const d1 = new Date(start + 'T00:00:00');
    const d2 = new Date(end + 'T00:00:00');

    if (mode === 'daily') {
      let d = new Date(d1);
      let guard = 0;
      while (d <= d2 && guard++ < 400) {
        const iso = localISO(d);
        periods.push({
          key: iso,
          label: d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' }),
          start: iso,
          end: iso
        });
        d.setDate(d.getDate() + 1);
      }
    } else if (mode === 'weekly') {
      let d = new Date(d1);
      let wk = 1;
      let guard = 0;
      while (d <= d2 && guard++ < 60) {
        const ws = new Date(d);
        const we = new Date(d);
        we.setDate(we.getDate() + 6);
        const wsISO = localISO(ws);
        const weISO = localISO(we > d2 ? d2 : we);
        periods.push({
          key: 'W' + wk,
          label: 'W' + wk,
          start: wsISO,
          end: weISO
        });
        d.setDate(d.getDate() + 7);
        wk++;
      }
    } else if (mode === 'monthly') {
      let d = new Date(d1.getFullYear(), d1.getMonth(), 1);
      let guard = 0;
      while (d <= d2 && guard++ < 36) {
        const mStart = new Date(d);
        const mEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0);
        periods.push({
          key: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'),
          label: d.toLocaleDateString('id-ID', { month: 'short', year: '2-digit' }),
          start: localISO(mStart),
          end: localISO(mEnd > d2 ? d2 : mEnd)
        });
        d.setMonth(d.getMonth() + 1);
      }
    }

    return periods;
  },

  /* ═══════════════════════════════════════════════════════════
     D. RENDER ROWS (REKURSIF)
     ═══════════════════════════════════════════════════════════ */
  renderTreeRows(tree, leaves, periods, projectId, depth) {
    let html = '';

    const totalRAB = leaves.reduce((s, w) => 
      s + (num(w.volume_rab) * Calc.hargaSatuanRAB(projectId, w.ahsp_id)), 0) || 1;

    tree.forEach(node => {
      const isLeaf = !node._children.length;
      const indent = depth * 16;
      const levelClass = isLeaf ? '' : (depth === 0 ? 'lvl1' : 'lvl2');

      // Bobot
      const volRAB = num(node.volume_rab);
      const costTotal = isLeaf ? volRAB * Calc.hargaSatuanRAB(projectId, node.ahsp_id) : 0;
      const bobot = isLeaf ? (costTotal / totalRAB * 100) : 0;

      // Untuk leaf: hitung progress kumulatif
      const totalProg = isLeaf ? this.getTaskTotalProgress(node.id) : 0;

      // Kolom periode
      let periodCells = '';
      periods.forEach(p => {
        if (isLeaf) {
          const val = this.getCellValue(node.id, p, this.currentPeriod);
          periodCells += `
            <td class="pw-cell">
              <input type="number" 
                     class="pw-input" 
                     step="0.01"
                     min="0"
                     data-wbs="${node.id}" 
                     data-period="${p.key}"
                     data-start="${p.start}"
                     data-end="${p.end}"
                     value="${val > 0 ? val.toFixed(2) : ''}"
                     placeholder="0" />
            </td>
          `;
        } else {
          // Summary: read-only, tampilkan hasil roll-up
          const sumVal = this.getSummaryValue(node, p, this.currentPeriod, leaves);
          periodCells += `<td class="pw-td-pct">${sumVal > 0 ? sumVal.toFixed(2) : '—'}</td>`;
        }
      });

      // Baris
      html += `
        <tr class="${levelClass}">
          <td>${esc(node.kode_wbs || '')}</td>
          <td style="padding-left:${indent}px">
            ${isLeaf ? '' : '<span style="opacity:.6">▸ </span>'}
            ${esc(node.uraian || '')}
          </td>
          <td class="center">${esc(node.satuan || '')}</td>
          <td class="num">${isLeaf ? fmt(volRAB, 2) : ''}</td>
          <td class="num">${isLeaf ? fmt(bobot, 2) : ''}</td>
          ${periodCells}
          <td class="num">${isLeaf ? fmt(totalProg, 2) + '%' : ''}</td>
        </tr>
      `;

      if (node._children.length) {
        html += this.renderTreeRows(node._children, leaves, periods, projectId, depth + 1);
      }
    });

    return html;
  },

  /* ═══════════════════════════════════════════════════════════
     E. HITUNG NILAI PER CELL
     ═══════════════════════════════════════════════════════════ */
  
  /* Ambil nilai volume untuk leaf task di periode tertentu */
  getCellValue(wbsId, period, mode) {
    const rows = DB.progress.filter(p => 
      p.wbs_id === wbsId && 
      p.tanggal >= period.start && 
      p.tanggal <= period.end
    );
    return rows.reduce((s, p) => s + num(p.volume), 0);
  },

  /* Ambil nilai summary (SUM dari anak) */
  getSummaryValue(node, period, mode, leaves) {
    // Kumpulkan semua descendant leaf
    const descendants = [];
    function walk(n) {
      if (!n._children.length) descendants.push(n);
      else n._children.forEach(walk);
    }
    walk(node);

    // SUM volume untuk periode
    return descendants.reduce((s, l) => {
      return s + this.getCellValue(l.id, period, mode);
    }, 0);
  },

  /* Total progress kumulatif per task */
  getTaskTotalProgress(wbsId) {
    const w = DB.project_wbs.find(x => x.id === wbsId);
    if (!w) return 0;
    const volRAB = num(w.volume_rab) || 1;
    const done = DB.progress
      .filter(p => p.wbs_id === wbsId)
      .reduce((s, p) => s + num(p.volume), 0);
    return Math.min(100, (done / volRAB) * 100);
  },

  /* ═══════════════════════════════════════════════════════════
     F. WIRE INPUT EVENTS — Auto-save + Akumulasi
     ═══════════════════════════════════════════════════════════ */
  wireInputEvents(projectId, periods) {
    document.querySelectorAll('.pw-input').forEach(inp => {
      inp.onchange = () => {
        const wbsId = inp.dataset.wbs;
        const periodKey = inp.dataset.period;
        const start = inp.dataset.start;
        const end = inp.dataset.end;
        const val = num(inp.value);

        // Cari periode object
        const period = periods.find(p => p.key === periodKey);
        if (!period) return;

        // Hapus dulu semua progress lama di periode ini untuk WBS ini
        DB.progress = DB.progress.filter(p => 
          !(p.wbs_id === wbsId && 
            p.tanggal >= period.start && 
            p.tanggal <= period.end)
        );

        if (val > 0) {
          // Simpan sebagai satu record di tanggal akhir periode
          const tanggalSimpan = this.getTanggalSimpan(period, this.currentPeriod);
          DB.progress.push({
            id: uid('pg'),
            project_id: projectId,
            wbs_id: wbsId,
            minggu: this.getMingguFromDate(projectId, tanggalSimpan),
            volume: val,
            tanggal: tanggalSimpan,
            keterangan: 'Input via Laporan Progres'
          });
        }

        saveDB();
        this.renderTable(projectId);
        toast('✓ Tersimpan: ' + val + ' ' + (DB.project_wbs.find(w => w.id === wbsId)?.satuan || ''));
      };
    });
  },

  getTanggalSimpan(period, mode) {
    if (mode === 'daily') return period.start;
    if (mode === 'weekly') return period.end;    // akhir minggu
    if (mode === 'monthly') return period.end;   // akhir bulan
    return period.start;
  },

  getMingguFromDate(projectId, tanggalISO) {
    const proj = DB.projects.find(p => p.id === projectId);
    if (!proj || !proj.tgl_mulai) return 1;
    const d1 = new Date(proj.tgl_mulai + 'T00:00:00');
    const d2 = new Date(tanggalISO + 'T00:00:00');
    const diff = Math.round((d2 - d1) / 86400000);
    return Math.max(1, Math.floor(diff / 7) + 1);
  },

  /* ═══════════════════════════════════════════════════════════
     G. UI CONTROLS — Filter Periode & Tombol Cetak
     ═══════════════════════════════════════════════════════════ */
  renderToolbar(projectId) {
    const wrap = document.getElementById('progressToolbar');
    if (!wrap) return;

    wrap.innerHTML = `
      <div class="row" style="align-items:center;gap:12px">
        <div class="field" style="min-width:180px">
          <label class="f">Filter Periode</label>
          <select id="pmPeriodMode">
            <option value="daily" ${this.currentPeriod==='daily'?'selected':''}>📅 Harian</option>
            <option value="weekly" ${this.currentPeriod==='weekly'?'selected':''}>📆 Mingguan</option>
            <option value="monthly" ${this.currentPeriod==='monthly'?'selected':''}>🗓 Bulanan</option>
          </select>
        </div>
        <div style="flex:1"></div>
        <button class="btn btn-sm" id="pmBtnPrint" style="background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;border-color:transparent">🖨 Cetak Laporan</button>
      </div>
    `;

    const sel = document.getElementById('pmPeriodMode');
    if (sel) {
      sel.onchange = (e) => {
        this.currentPeriod = e.target.value;
        this.renderTable(projectId);
      };
    }

    const btnPrint = document.getElementById('pmBtnPrint');
    if (btnPrint) {
      btnPrint.onclick = () => {
        if (typeof ReportGenerator !== 'undefined' && ReportGenerator.openHarian) {
          ReportGenerator.openHarian(projectId);
        }
      };
    }
  },

  /* ═══════════════════════════════════════════════════════════
     H. COMPAT: Method lama yang masih dipanggil
     ═══════════════════════════════════════════════════════════ */
  renderScurve(projectId) {
    if (typeof renderProgressScurve === 'function') {
      renderProgressScurve(projectId);
    }
  },
  
  renderVariance(projectId) {
    if (typeof renderProgressVariance === 'function') {
      renderProgressVariance(projectId);
    }
  }
};
