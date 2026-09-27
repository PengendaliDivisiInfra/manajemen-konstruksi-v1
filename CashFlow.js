/* =====================================================================
   MODUL CASH FLOW & ACTUAL COST — Manajemen Arus Kas Proyek
   ===================================================================== */

let _chartCashFlowInstance = null;
let _cashFlowDataLocal = [];

/* ---------------------------------------------------------------------
   INIT MODULE
   --------------------------------------------------------------------- */
function initCashFlowModule() {
  const pid = STATE.activeProject;
  if (!pid) return;

  // Regenerate data lokal jika beda proyek atau belum ada
  if (!_cashFlowDataLocal.length || _cashFlowDataLocal[0]?.project_id !== pid) {
    generateDefaultCashFlow(pid);
  }

  renderCashFlowUI();

  // Tombol generate ulang
  const btnGen = $('#btnAutoCalcCF');
  if (btnGen) {
    btnGen.onclick = () => {
      if (confirm('Generate ulang proyeksi otomatis berdasarkan Kurva S & Nilai Kontrak? Data realisasi yang belum tersimpan mungkin akan tertimpa.')) {
        generateDefaultCashFlow(pid);
        renderCashFlowUI();
        toast('Proyeksi Cash Flow digenerate ulang');
      }
    };
  }

  // Tombol simpan
  const btnSave = $('#btnSaveCF');
  if (btnSave) {
    btnSave.onclick = async () => {
      collectCashFlowTableInputs();
      await saveCashFlowToServer(pid);
    };
  }
}

/* ---------------------------------------------------------------------
   GENERATE DEFAULT CASH FLOW (berdasarkan Kurva S & Nilai Kontrak)
   --------------------------------------------------------------------- */
function generateDefaultCashFlow(projectId) {
  const proj = DB.projects.find(p => p.id === projectId);
  if (!proj) return;

  const durasi = Math.max(1, Math.round(num(proj.durasi_minggu) || 1));
  const scurve = Calc.scurve(projectId);
  const totals = Calc.totals(projectId);

  const nilaiKontrakNetto = num(proj.nilai_kontrak) / (1 + num(SET.ppn) / 100) || totals.rab;
  const totalRAP = totals.rap || 1;

  _cashFlowDataLocal = [];

  for (let w = 1; w <= durasi; w++) {
    let marginalPct = 1 / durasi;

    if (scurve && scurve.planned && scurve.planned.length === durasi) {
      const pCumPct  = (scurve.planned[w - 1] || 0) / 100;
      const pPrevPct = w === 1 ? 0 : (scurve.planned[w - 2] || 0) / 100;
      marginalPct = Math.max(0, pCumPct - pPrevPct);
    }

    const rencanaMasuk  = nilaiKontrakNetto * marginalPct;
    const rencanaKeluar = totalRAP * marginalPct;

    _cashFlowDataLocal.push({
      id:               'cf_' + projectId + '_m' + w,
      project_id:       projectId,
      periode:          'Minggu ' + w,
      minggu:           w,
      rencana_masuk:    Math.round(rencanaMasuk),
      realisasi_masuk:  Math.round(rencanaMasuk * 0.95),
      rencana_keluar:   Math.round(rencanaKeluar),
      realisasi_keluar: Math.round(rencanaKeluar),
      keterangan:       w === 1 ? 'Uang muka / Termin awal' : 'Pekerjaan mingguan'
    });
  }
}

/* ---------------------------------------------------------------------
   COLLECT INPUT DARI TABEL
   --------------------------------------------------------------------- */
function collectCashFlowTableInputs() {
  $$('#tblCashFlow tbody tr').forEach((tr, idx) => {
    const item = _cashFlowDataLocal[idx];
    if (!item) return;

    const inpRm  = tr.querySelector(`[data-cf-rm="${idx}"]`);
    const inpRk  = tr.querySelector(`[data-cf-rk="${idx}"]`);
    const inpKet = tr.querySelector(`[data-cf-ket="${idx}"]`);

    if (inpRm)  item.realisasi_masuk  = num(inpRm.value);
    if (inpRk)  item.realisasi_keluar = num(inpRk.value);
    if (inpKet) item.keterangan       = inpKet.value.trim();
  });
}

/* ---------------------------------------------------------------------
   RENDER UI (KPI + TABEL)
   --------------------------------------------------------------------- */
function renderCashFlowUI() {
  const rows = _cashFlowDataLocal;
  if (!rows.length) return;

  let totPlanIn = 0, totRealIn = 0, totPlanOut = 0, totRealOut = 0;
  rows.forEach(r => {
    totPlanIn  += num(r.rencana_masuk);
    totRealIn  += num(r.realisasi_masuk);
    totPlanOut += num(r.rencana_keluar);
    totRealOut += num(r.realisasi_keluar);
  });

  const netCashFlow = totRealIn - totRealOut;

  // KPI
  $('#cfKPI').innerHTML = `
    <div class="kpi">
      <div class="lbl">Total Rencana Masuk</div>
      <div class="val" style="color:var(--ok)">${rp(totPlanIn)}</div>
      <div class="sub">Akumulasi termin kontrak</div>
    </div>
    <div class="kpi">
      <div class="lbl">Total Realisasi Masuk</div>
      <div class="val" style="color:var(--ok)">${rp(totRealIn)}</div>
      <div class="sub">Penerimaan kas riil</div>
    </div>
    <div class="kpi">
      <div class="lbl">Total Realisasi Keluar</div>
      <div class="val" style="color:var(--danger)">${rp(totRealOut)}</div>
      <div class="sub">Pengeluaran riil (Actual Cost)</div>
    </div>
    <div class="kpi ${netCashFlow >= 0 ? 'k5' : 'k4'}">
      <div class="lbl">Net Cash Flow</div>
      <div class="val ${netCashFlow >= 0 ? 'pos' : 'neg'}">${rp(netCashFlow)}</div>
      <div class="sub">${netCashFlow >= 0 ? '✅ Surplus Kas' : '⚠ Defisit Kas'}</div>
    </div>
  `;

  // Header tabel
  const head = `<thead><tr>
    <th>Periode</th>
    <th class="num">Rencana Masuk (In)</th>
    <th class="num">Realisasi Masuk</th>
    <th class="num">Rencana Keluar (Out)</th>
    <th class="num">Realisasi Keluar (Actual)</th>
    <th class="num">Net Kas (Riil)</th>
    <th>Keterangan</th>
  </tr></thead>`;

  // Body tabel
  let cumNet = 0;
  const body = rows.map((r, idx) => {
    const netM = num(r.realisasi_masuk) - num(r.realisasi_keluar);
    cumNet += netM;

    return `<tr>
      <td><b>${esc(r.periode)}</b></td>
      <td class="num">${rp(r.rencana_masuk)}</td>
      <td class="num">
        <input type="number" data-cf-rm="${idx}" value="${num(r.realisasi_masuk)}"
               style="width:130px;text-align:right;padding:4px" />
      </td>
      <td class="num">${rp(r.rencana_keluar)}</td>
      <td class="num">
        <input type="number" data-cf-rk="${idx}" value="${num(r.realisasi_keluar)}"
               style="width:130px;text-align:right;padding:4px" />
      </td>
      <td class="num ${netM >= 0 ? 'pos' : 'neg'}">${rp(netM)}</td>
      <td>
        <input type="text" data-cf-ket="${idx}" value="${esc(r.keterangan || '')}"
               style="width:100%;padding:4px" />
      </td>
    </tr>`;
  }).join('');

  $('#tblCashFlow').innerHTML = head + `<tbody>${body}</tbody>`;

  // Chart
  renderCashFlowChart(rows);
}

/* ---------------------------------------------------------------------
   RENDER CHART
   --------------------------------------------------------------------- */
function renderCashFlowChart(rows) {
  const labels = rows.map(r => r.periode);
  const planIn = [], realIn = [], planOut = [], realOut = [], cumulativeNet = [];

  let cPi = 0, cRi = 0, cPo = 0, cRo = 0;
  rows.forEach(r => {
    cPi += num(r.rencana_masuk);
    cRi += num(r.realisasi_masuk);
    cPo += num(r.rencana_keluar);
    cRo += num(r.realisasi_keluar);

    planIn.push(cPi);
    realIn.push(cRi);
    planOut.push(cPo);
    realOut.push(cRo);
    cumulativeNet.push(cRi - cRo);
  });

  if (_chartCashFlowInstance) _chartCashFlowInstance.destroy();

  const canvas = $('#chartCashFlow');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  _chartCashFlowInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Kumulatif Rencana Masuk',
          data: planIn,
          borderColor: '#1abc9c',
          backgroundColor: 'transparent',
          tension: 0.2,
          borderWidth: 2
        },
        {
          label: 'Kumulatif Realisasi Masuk',
          data: realIn,
          borderColor: '#2ecc71',
          backgroundColor: 'rgba(46,204,113,.05)',
          fill: true,
          tension: 0.2,
          borderWidth: 2
        },
        {
          label: 'Kumulatif Rencana Keluar',
          data: planOut,
          borderColor: '#e67e22',
          backgroundColor: 'transparent',
          tension: 0.2,
          borderWidth: 2
        },
        {
          label: 'Kumulatif Realisasi Keluar',
          data: realOut,
          borderColor: '#e74c3c',
          backgroundColor: 'rgba(231,76,60,.05)',
          fill: true,
          tension: 0.2,
          borderWidth: 2
        },
        {
          label: 'Saldo Kas Kumulatif (Net)',
          data: cumulativeNet,
          borderColor: '#3498db',
          borderDash: [5, 5],
          backgroundColor: 'transparent',
          tension: 0.2,
          borderWidth: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: '#e6edf7', font: { size: 11 } }
        }
      },
      scales: {
        x: {
          ticks: { color: '#8fa3c4' },
          grid:  { color: 'rgba(36,54,92,.2)' }
        },
        y: {
          ticks: {
            color: '#8fa3c4',
            callback: v => 'Rp ' + (v / 1e6).toFixed(0) + 'jt'
          },
          grid: { color: 'rgba(36,54,92,.2)' }
        }
      }
    }
  });
}

/* ---------------------------------------------------------------------
   SIMPAN KE SERVER
   --------------------------------------------------------------------- */
async function saveCashFlowToServer(projectId) {
  try {
    toast('Menyimpan Cash Flow...');

    const token = localStorage.getItem('mk_session_token') || '';
    const res = await sheetRequest('saveCashFlow', {
      token: token,
      projectId: projectId,
      rows: _cashFlowDataLocal
    });

    if (res && res.ok) {
      toast('✅ Cash Flow berhasil disimpan ke Sheet');
    } else {
      toast('Gagal menyimpan: ' + (res?.message || 'unknown'), false);
    }
  } catch (err) {
    toast('Error koneksi: ' + err.message, false);
  }
}

/* ---------------------------------------------------------------------
   HOOK KE switchTab
   --------------------------------------------------------------------- */
(function hookSwitchTab() {
  if (typeof window.switchTab !== 'function') return;

  const _oldSwitchTab = window.switchTab;
  window.switchTab = function (name, ...rest) {
    _oldSwitchTab.apply(this, [name, ...rest]);
    if (name === 'cashflow') {
      initCashFlowModule();
    }
  };
})();
