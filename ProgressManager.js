/* =====================================================================
   MODUL PROGRESS & S-CURVE — Manajemen Progres Fisik & Analisis Deviasi
   ===================================================================== */

const ProgressManager = {
  /* ── MESIN KALKULASI (A, B, C) ── */
  getABC(projectId, wbsId, mingguTarget) {
    const wbs = DB.project_wbs.find(w => w.id === wbsId);
    if (!wbs || num(wbs.volume_rab) === 0) return { A: 0, B: 0, C: 0, bobot: 0, volLalu: 0, volKini: 0, volKumulatif: 0 };

    // 1. Hitung Bobot Item terhadap Total Proyek
    const hsRAB = Calc.hargaSatuanRAB(projectId, wbs.ahsp_id);
    const totalRABProyek = Calc.wbsRows(projectId).filter(r => !r.isGroup).reduce((s, r) => s + r.total_rab, 0) || 1;
    const bobot = (num(wbs.volume_rab) * hsRAB) / totalRABProyek * 100;

    // 2. Ambil semua progress untuk WBS ini
    const allProg = DB.progress.filter(p => p.project_id === projectId && p.wbs_id === wbsId);

    // 3. Hitung Volume Kumulatif
    const volLalu = allProg.filter(p => num(p.minggu) < mingguTarget).reduce((s, p) => s + num(p.volume), 0);
    const volKini = allProg.filter(p => num(p.minggu) === mingguTarget).reduce((s, p) => s + num(p.volume), 0);
    const volKumulatif = volLalu + volKini;

    // 4. Konversi ke Persentase terhadap Volume RAB
    const A = (volLalu / num(wbs.volume_rab)) * bobot;
    const B = (volKini / num(wbs.volume_rab)) * bobot;
    const C = (volKumulatif / num(wbs.volume_rab)) * bobot;

    return { A, B, C, bobot, volLalu, volKini, volKumulatif };
  },

  /* ── RENDER TABEL INPUT PROGRESS ── */
  renderTable() {
    const pid = STATE.activeProject;
    if (!pid) return;
    const items = DB.project_wbs.filter(w => w.project_id === pid && !w.is_group);
    const rows = DB.progress.filter(p => p.project_id === pid).sort((a,b) => num(a.minggu) - num(b.minggu) || (items.findIndex(x=>x.id===a.wbs_id) - items.findIndex(x=>x.id===b.wbs_id)));

    const head = `<thead><tr>
      <th>Minggu</th><th>Kode WBS</th><th>Uraian</th>
      <th class="num">Bobot (%)</th>
      <th class="num">Vol Lalu</th>
      <th class="num">Vol Kini</th>
      <th class="num">Vol Kumulatif</th>
      <th class="num">Progres Lalu (A)</th>
      <th class="num">Progres Kini (B)</th>
      <th class="num">S.D. Kini (C)</th>
      <th class="center">Aksi</th>
    </tr></thead>`;

    const body = rows.map(p => {
      const w = items.find(x => x.id === p.wbs_id);
      if (!w) return '';
      const abc = this.getABC(pid, p.wbs_id, p.minggu);
      return `<tr>
        <td class="center"><b>M${esc(p.minggu)}</b></td>
        <td>${esc(w.kode_wbs)}</td>
        <td>${esc(w.uraian)}</td>
        <td class="num">${fmt(abc.bobot, 2)}%</td>
        <td class="num">${fmt(abc.volLalu, 2)}</td>
        <td class="num">${fmt(abc.volKini, 2)}</td>
        <td class="num">${fmt(abc.volKumulatif, 2)}</td>
        <td class="num pos">${fmt(abc.A, 2)}%</td>
        <td class="num ${abc.B >= 0 ? 'pos' : 'neg'}">${fmt(abc.B, 2)}%</td>
        <td class="num ${abc.C >= 0 ? 'pos' : 'neg'}"><b>${fmt(abc.C, 2)}%</b></td>
        <td class="center">
          <button class="btn btn-sm" data-edit-pg="${p.id}">✎</button>
          <button class="btn btn-sm btn-danger" data-del-pg="${p.id}">✕</button>
        </td>
      </tr>`;
    }).join('');

    $('#tblProg').innerHTML = head + `<tbody>${body || `<tr><td colspan="11" class="empty">Belum ada progress.</td></tr>`}</tbody>`;
    
    // Re-attach event listeners
    $$('[data-edit-pg]').forEach(b => b.onclick = () => ProgressManager.form(b.dataset.editPg));
    $$('[data-del-pg]').forEach(b => b.onclick = () => {
      if (!confirm('Hapus progress ini?')) return;
      if (typeof Undo !== 'undefined') Undo.snapshot('Hapus Progress');
      DB.progress = DB.progress.filter(x => x.id !== b.dataset.delPg);
      saveDB(); ProgressManager.renderTable(); toast('Progress dihapus');
    });
  },

  /* ── RENDER S-CURVE & ANALISIS DEVIASI ── */
  renderScurve(projectId) {
    const sc = Calc.scurve(projectId);
    const ctx = document.getElementById('chartProgressScurve');
    if (!ctx) return;

    if (STATE.chartProgScurve) STATE.chartProgScurve.destroy();
    STATE.chartProgScurve = new Chart(ctx.getContext('2d'), {
      type: 'line',
      data: {
        labels: sc.labels,
        datasets: [
          { label: 'Rencana (%)', data: sc.planned, borderColor: '#2f81f7', backgroundColor: 'rgba(47,129,247,.14)', fill: true, tension: .35, borderWidth: 2.5, pointRadius: 3 },
          { label: 'Aktual (%)', data: sc.actual, borderColor: '#1abc9c', backgroundColor: 'rgba(26,188,156,.14)', fill: true, tension: .35, borderWidth: 2.5, pointRadius: 3 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: '#e6edf7' } } },
        scales: {
          x: { ticks: { color: '#8fa3c4' }, grid: { color: 'rgba(36,54,92,.5)' } },
          y: { ticks: { color: '#8fa3c4', callback: v => v + '%' }, grid: { color: 'rgba(36,54,92,.5)' }, beginAtZero: true, max: 100 }
        }
      }
    });
  },

  renderVariance(projectId) {
    const items = DB.project_wbs.filter(w => w.project_id === projectId && !w.is_group);
    const proj = DB.projects.find(p => p.id === projectId);
    const totalRAB = items.reduce((s, w) => s + (num(w.volume_rab) * Calc.hargaSatuanRAB(projectId, w.ahsp_id)), 0) || 1;
    const currentMinggu = DB.progress.filter(p => p.project_id === projectId).reduce((m, p) => Math.max(m, num(p.minggu)), 1);

    const rows = items.map(w => {
      const bobot = (num(w.volume_rab) * Calc.hargaSatuanRAB(projectId, w.ahsp_id)) / totalRAB * 100;
      
      // Hitung Rencana (%) berdasarkan Jadwal
      let planPct = 0;
      if (currentMinggu > 0 && w.tgl_mulai_rencana && w.tgl_selesai_rencana) {
        const cal = WorkingCalendar.get(w.calendar_id || proj.calendar_id);
        const totalDays = WorkingCalendar.diffDays(w.tgl_mulai_rencana, w.tgl_selesai_rencana, cal, 'working') || 1;
        const hariKe = Math.min(totalDays, Math.max(0, (currentMinggu - 1) * 5 + 5)); 
        planPct = Math.min((hariKe / totalDays) * bobot, bobot);
      }

      // Hitung Aktual (%) menggunakan logika A+B=C
      const abc = this.getABC(projectId, w.id, currentMinggu);
      const actPct = abc.C;
      
      const dev = actPct - planPct;
      let status = '<span class="badge b-ok">On Schedule</span>';
      if (dev < -1) status = '<span class="badge b-danger">Behind</span>';
      else if (dev > 1) status = '<span class="badge b-warn">Ahead</span>';

      return `<tr>
        <td><b>${esc(w.kode_wbs)}</b></td>
        <td>${esc(w.uraian)}</td>
        <td class="num">${fmt(bobot, 2)}%</td>
        <td class="num">${fmt(planPct, 2)}%</td>
        <td class="num">${fmt(actPct, 2)}%</td>
        <td class="num ${dev >= 0 ? 'pos' : 'neg'}">${fmt(dev, 2)}%</td>
        <td class="text-center">${status}</td>
      </tr>`;
    }).join('');

    const head = `<thead><tr>
      <th>Kode WBS</th><th>Uraian</th>
      <th class="num">Bobot (%)</th>
      <th class="num">Rencana (%)</th>
      <th class="num">Aktual (%)</th>
      <th class="num">Deviasi (%)</th>
      <th class="text-center">Status</th>
    </tr></thead>`;

    const tbl = document.getElementById('tblProgressVariance');
    if (tbl) tbl.innerHTML = head + `<tbody>${rows || '<tr><td colspan="7" class="empty">Belum ada data WBS.</td></tr>'}</tbody>`;
  },

  /* ── FORM INPUT DENGAN VALIDASI GOLDEN RULES ── */
  form(id) {
    const pid = STATE.activeProject;
    const p = id ? DB.progress.find(x => x.id === id) : null;
    const items = DB.project_wbs.filter(w => w.project_id === pid && !w.is_group);
    const opts = items.map(w => `<option value="${w.id}" ${p?.wbs_id === w.id?'selected':''}>${esc(w.kode_wbs)} — ${esc(w.uraian)}</option>`).join('');
    const proj = activeProj();
    const maxM = Math.max(1, Math.round(num(proj?.durasi_minggu)||1));

    const body = `
      <div class="row">
        <div class="field" style="flex:3"><label class="f">Item WBS</label><select id="fp_wbs">${opts}</select></div>
        <div class="field"><label class="f">Minggu ke-</label><input id="fp_m" type="number" min="1" max="${maxM}" value="${num(p?.minggu)||1}" /></div>
        <div class="field"><label class="f">Volume</label><input id="fp_v" type="number" step="0.01" value="${num(p?.volume)}" /></div>
        <div class="field"><label class="f">Tanggal</label><input id="fp_t" type="date" value="${esc(p?.tanggal||today())}" /></div>
      </div>
      <div id="fp_info" style="margin-top:12px;font-size:12px;color:var(--muted);background:#0e1a30;padding:10px;border-radius:6px"></div>
    `;
    
    openModal(id?'Edit Progress':'Tambah Progress', body, () => {
      const wbsId = $('#fp_wbs').value;
      const minggu = num($('#fp_m').value);
      const volumeInput = num($('#fp_v').value);
      const wbs = items.find(x => x.id === wbsId);
      
      // Validasi Golden Rules
      if (wbs) {
        const volRab = num(wbs.volume_rab);
        const volLalu = DB.progress.filter(x => x.project_id === pid && x.wbs_id === wbsId && num(x.minggu) < minggu && x.id !== p?.id).reduce((s,x) => s + num(x.volume), 0);
        const volTotalNanti = volLalu + volumeInput;
        
        if (volTotalNanti > volRab && volRab > 0) {
          toast(`⚠ Volume kumulatif (${fmt(volTotalNanti,2)}) melebihi Volume RAB (${fmt(volRab,2)}). Sisa maksimal: ${fmt(volRab - volLalu, 2)}`, false);
          return false;
        }
      }

      const obj = { id: p?.id || uid('pg'), project_id: pid, wbs_id: wbsId, minggu, volume: volumeInput, tanggal: $('#fp_t').value };
      if (p) Object.assign(p, obj); else DB.progress.push(obj);
      saveDB(); 
      ProgressManager.renderTable(); 
      toast('Progress disimpan');
    });
    
    const updateInfo = () => {
      const wbsId = $('#fp_wbs').value;
      const minggu = num($('#fp_m').value);
      const wbs = items.find(x => x.id === wbsId);
      if (!wbs) return;
      
      const volRab = num(wbs.volume_rab);
      const volLalu = DB.progress.filter(x => x.project_id === pid && x.wbs_id === wbsId && num(x.minggu) < minggu && x.id !== p?.id).reduce((s,x) => s + num(x.volume), 0);
      const sisa = volRab - volLalu;
      
      $('#fp_info').innerHTML = `
        <b>Volume RAB:</b> ${fmt(volRab, 2)} ${wbs.satuan} <br>
        <b>Volume s.d. Minggu ${minggu-1}:</b> ${fmt(volLalu, 2)} ${wbs.satuan} <br>
        <b style="color:var(--warn)">Sisa Volume Maksimal:</b> ${fmt(sisa, 2)} ${wbs.satuan}
      `;
    };
    
    $('#fp_wbs').onchange = updateInfo;
    $('#fp_m').oninput = updateInfo;
    updateInfo();
  }
};
