/* =====================================================================
 * MANAJEMEN KONSTRUKSI v1 — SCHEDULE ENGINE
 * Pure JavaScript module — CPM, Working Calendar, Auto-Save, Resource Loading
 * =====================================================================
 */

/* =====================================================================
   BAGIAN 1 — WORKING CALENDAR ENGINE
   Menghitung durasi dengan mempertimbangkan hari kerja & hari libur
   ===================================================================== */
const WorkingCalendar = {
  DEFAULT_WORK_DAYS: [1,2,3,4,5],

  /** Ambil objek kalender dari DB, fallback ke default */
  get(calendarId){
    if (calendarId){
      const c = (DB.working_calendars || []).find(x => x.id === calendarId);
      if (c) return c;
    }
    return (DB.working_calendars || []).find(x => num(x.is_default) === 1)
        || { work_days: '1,2,3,4,5', jam_per_hari: 8 };
  },

  /** Cek apakah tanggal adalah hari kerja */
  isWorkDay(date, cal){
    const workDays = String(cal.work_days || '1,2,3,4,5')
                        .split(',').map(s => parseInt(s.trim(), 10));
    const dow = date.getDay();
    if (!workDays.includes(dow)) return false;

    const dateStr = date.toISOString().slice(0,10);
    const holidays = DB.holidays || [];
    if (holidays.some(h => h.tanggal === dateStr)) return false;
    return true;
  },

  /** Hitung durasi antara dua tanggal berdasarkan mode */
  diffDays(startDate, endDate, cal, mode){
    if (!startDate || !endDate) return 0;
    const d1 = new Date(startDate);
    const d2 = new Date(endDate);
    if (isNaN(d1) || isNaN(d2)) return 0;
    if (d2 < d1) return 0;

    if (mode === 'calendar'){
      return Math.round((d2 - d1) / 86400000);
    }

    let count = 0;
    const d = new Date(d1);
    while (d < d2){
      if (this.isWorkDay(d, cal)) count++;
      d.setDate(d.getDate() + 1);
    }
    return count;
  },

  /** Tambah N hari kerja ke tanggal */
  addWorkDays(startDate, days, cal){
    let d = new Date(startDate);
    let added = 0;
    const dir = days >= 0 ? 1 : -1;
    const remaining = Math.abs(days);
    while (added < remaining){
      d.setDate(d.getDate() + dir);
      if (this.isWorkDay(d, cal)) added++;
    }
    return d;
  },

  /** Format ISO date */
  fmt(d){
    return d.toISOString().slice(0,10);
  }
};

/** Helper: hitung lengkap durasi proyek */
function hitungDurasiLengkap(tglMulai, tglSelesai, cal, mode){
  const durasi_hari  = WorkingCalendar.diffDays(tglMulai, tglSelesai, cal, 'calendar');
  const durasi_kerja = WorkingCalendar.diffDays(tglMulai, tglSelesai, cal, 'working');

  let durasi_minggu;
  if (mode === 'working'){
    const workDaysCount = String(cal.work_days || '1,2,3,4,5').split(',').length;
    durasi_minggu = Math.ceil(durasi_kerja / workDaysCount);
  } else {
    durasi_minggu = Math.ceil(durasi_hari / 7);
  }

  return { durasi_hari, durasi_minggu, durasi_kerja };
}

/* =====================================================================
   BAGIAN 2 — SCHEDULE WHITELIST (Anti-Interference dengan RAB/RAP)
   ===================================================================== */
const SCHEDULE_WRITABLE_FIELDS = Object.freeze([
  'predecessor','pred_type','lag_days','duration','calendar_id',
  'start_date','finish_date',
  'early_start','early_finish','late_start','late_finish',
  'total_float','is_critical',
  'constraint_type','constraint_date'
]);

function writeScheduleField(wbsItem, field, value){
  if (!SCHEDULE_WRITABLE_FIELDS.includes(field)){
    console.error('[SECURITY] Attempt to write forbidden field:', field);
    return false;
  }
  wbsItem[field] = value;
  return true;
}

const CONSTRAINT_TYPES = {
  ASAP: 'As Soon As Possible',
  ALAP: 'As Late As Possible',
  SNET: 'Start No Earlier Than',
  SNLT: 'Start No Later Than',
  FNET: 'Finish No Earlier Than',
  FNLT: 'Finish No Later Than',
  MSO:  'Must Start On',
  MFO:  'Must Finish On'
};

/* =====================================================================
   BAGIAN 3 — CPM ENGINE
   Forward Pass + Backward Pass + All Relationship Types + Constraints
   ===================================================================== */
function runCPM(projectId){
  const proj = DB.projects.find(p => p.id === projectId);
  if (!proj) return { ok:false, message:'Proyek tidak ditemukan' };

  const projCal = WorkingCalendar.get(proj.calendar_id);
  const items = DB.project_wbs.filter(w => w.project_id === projectId && !w.is_group);
  if (!items.length) return { ok:true, message:'Tidak ada item WBS' };

  const map = {};
  items.forEach(it => { map[it.id] = it; });

  if (hasCycle_(items, map)){
    console.error('[CPM] Circular dependency detected');
    return { ok:false, message:'⚠ Terdeteksi siklus pada predecessor' };
  }

  const projStart = new Date(proj.tgl_mulai || new Date());
  const MAX_ITER = items.length * 5;

  /* ============ FORWARD PASS ============ */
  const visited = {};
  const computeES = (it, depth) => {
    if (depth > MAX_ITER) return;
    if (visited[it.id]) return;
    visited[it.id] = true;

    const durWorking = Math.max(1, Math.round(num(it.duration) || 1));
    const cal = WorkingCalendar.get(it.calendar_id || proj.calendar_id);

    let es = projStart;

    // Apply constraint
    if (it.constraint_type && it.constraint_date){
      const cd = new Date(it.constraint_date);
      switch (it.constraint_type){
        case 'SNET': if (cd > es) es = cd; break;
        case 'MSO':  es = cd; break;
        case 'FNET': es = WorkingCalendar.addWorkDays(cd, -durWorking, cal); break;
      }
    }

    // Predecessor
    if (it.predecessor && map[it.predecessor]){
      const pred = map[it.predecessor];
      computeES(pred, depth + 1);

      const predES = pred._ES || projStart;
      const predEF = pred._EF || WorkingCalendar.addWorkDays(projStart, num(pred.duration) || 1, cal);
      const lag = Math.round(num(it.lag_days) || 0);
      const type = it.pred_type || 'FS';

      let candidate;
      switch (type){
        case 'FS': candidate = WorkingCalendar.addWorkDays(predEF,  lag, cal); break;
        case 'SS': candidate = WorkingCalendar.addWorkDays(predES,  lag, cal); break;
        case 'FF': candidate = WorkingCalendar.addWorkDays(predEF, -durWorking + lag, cal); break;
        case 'SF': candidate = WorkingCalendar.addWorkDays(predES, -durWorking + lag, cal); break;
        default:   candidate = predEF;
      }
      if (candidate > es) es = candidate;
    }

    it._ES = es;
    it._EF = WorkingCalendar.addWorkDays(es, durWorking, cal);
  };

  items.forEach(it => computeES(it, 0));

  /* ============ PROJECT FINISH ============ */
  const projFinish = items.reduce((mx, it) => (it._EF && it._EF > mx) ? it._EF : mx, projStart);

  /* ============ BACKWARD PASS ============ */
  const successors = {};
  items.forEach(it => {
    if (it.predecessor && map[it.predecessor]){
      (successors[it.predecessor] = successors[it.predecessor] || []).push(it);
    }
  });

  const visitedB = {};
  const computeLF = (it, depth) => {
    if (depth > MAX_ITER) return;
    if (visitedB[it.id]) return;
    visitedB[it.id] = true;

    const durWorking = Math.max(1, Math.round(num(it.duration) || 1));
    const cal = WorkingCalendar.get(it.calendar_id || proj.calendar_id);
    const succs = successors[it.id] || [];
    let lf;

    if (!succs.length){
      lf = projFinish;
    } else {
      lf = null;
      succs.forEach(s => {
        computeLF(s, depth + 1);
        const sLS = s._LS || projFinish;
        const sLF = s._LF || projFinish;
        const lag = Math.round(num(s.lag_days) || 0);
        const type = s.pred_type || 'FS';
        let candidate;
        switch (type){
          case 'FS': candidate = WorkingCalendar.addWorkDays(sLS, -lag, cal); break;
          case 'SS': candidate = WorkingCalendar.addWorkDays(sLS, -lag, cal); break;
          case 'FF': candidate = WorkingCalendar.addWorkDays(sLF, -lag, cal); break;
          case 'SF': candidate = WorkingCalendar.addWorkDays(sLF, -lag, cal); break;
          default:   candidate = sLS;
        }
        if (lf === null || candidate < lf) lf = candidate;
      });
    }

    it._LF = lf;
    it._LS = WorkingCalendar.addWorkDays(lf, -durWorking, cal);
    it._float = Math.round((it._LS - it._ES) / 86400000);
  };

  items.forEach(it => computeLF(it, 0));

  /* ============ WRITE-BACK — SCHEDULE FIELDS ONLY ============ */
  items.forEach(it => {
    writeScheduleField(it, 'start_date',   WorkingCalendar.fmt(it._ES));
    writeScheduleField(it, 'finish_date',  WorkingCalendar.fmt(it._EF));
    writeScheduleField(it, 'early_start',  WorkingCalendar.fmt(it._ES));
    writeScheduleField(it, 'early_finish', WorkingCalendar.fmt(it._EF));
    writeScheduleField(it, 'late_start',   WorkingCalendar.fmt(it._LS));
    writeScheduleField(it, 'late_finish',  WorkingCalendar.fmt(it._LF));
    writeScheduleField(it, 'total_float',  it._float || 0);
    writeScheduleField(it, 'is_critical',  (it._float || 0) <= 0 ? 1 : 0);

    delete it._ES; delete it._EF; delete it._LS; delete it._LF; delete it._float;
  });

  // Update tanggal selesai proyek
  const newFinish = WorkingCalendar.fmt(projFinish);
  if (newFinish && newFinish !== proj.tgl_selesai){
    proj.tgl_selesai = newFinish;
    const dur = hitungDurasiLengkap(proj.tgl_mulai, newFinish, projCal, proj.durasi_mode || 'working');
    proj.durasi_hari   = dur.durasi_hari;
    proj.durasi_minggu = dur.durasi_minggu;
    proj.durasi_kerja  = dur.durasi_kerja;
  }

  return { ok:true, message:'CPM selesai' };
}

/** Deteksi siklus pada graph predecessor */
function hasCycle_(items, map){
  const state = {};
  const dfs = (id) => {
    if (state[id] === 1) return true;
    if (state[id] === 2) return false;
    state[id] = 1;
    const it = map[id];
    if (it && it.predecessor && map[it.predecessor]){
      if (dfs(it.predecessor)) return true;
    }
    state[id] = 2;
    return false;
  };
  for (const it of items){
    if (dfs(it.id)) return true;
  }
  return false;
}

/* =====================================================================
   BAGIAN 4 — AUTOSAVE MODULE v2
   Multi-Layer Persistence + Draft Recovery + Before-Unload Guard
   ===================================================================== */
const AUTOSAVE = {
  DELAY_MS: 2000,
  DRAFT_PREFIX: 'mk_draft_',
  DRAFT_MAX_AGE_MS: 24 * 3600 * 1000,
  DIRTY_FLAG: false,
  timer: null,
  indicator: null,
  _lastKey: null,
  _lastGetter: null,

  initIndicator(){
    if (document.getElementById('autosaveStatus')) return;
    const topbar = document.querySelector('.topbar-right');
    if (!topbar) return;
    const el = document.createElement('div');
    el.id = 'autosaveStatus';
    el.style.cssText = 'font-size:11px;color:var(--muted);padding:4px 10px;' +
                       'border-radius:6px;background:rgba(47,129,247,.08);' +
                       'border:1px solid var(--line);transition:.2s;white-space:nowrap';
    el.innerHTML = '💾 Siap';
    topbar.appendChild(el);
    this.indicator = el;
  },

  setStatus(text, color){
    if (!this.indicator) return;
    this.indicator.innerHTML = text;
    this.indicator.style.color = color || 'var(--muted)';
    this.indicator.style.borderColor = color || 'var(--line)';
  },

  schedule(entityKey, dataGetter){
    if (!entityKey) return;
    this.DIRTY_FLAG = true;
    this._lastKey = entityKey;
    this._lastGetter = dataGetter;
    this.setStatus('✎ Menyimpan…', 'var(--warn)');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(entityKey, dataGetter), this.DELAY_MS);
  },

  flush(entityKey, dataGetter){
    if (!entityKey) return;
    try {
      const data = typeof dataGetter === 'function' ? dataGetter() : dataGetter;
      const payload = { data, timestamp: Date.now(), version: 1 };
      localStorage.setItem(this.DRAFT_PREFIX + entityKey, JSON.stringify(payload));
      this.DIRTY_FLAG = false;
      const t = new Date().toLocaleTimeString('id-ID', {hour:'2-digit',minute:'2-digit',second:'2-digit'});
      this.setStatus('✓ Draft ' + t, 'var(--ok)');
      IDB.save('drafts', { key: entityKey, data, timestamp: Date.now() }).catch(()=>{});
    } catch(e){
      this.setStatus('✗ Gagal: ' + e.message, 'var(--danger)');
    }
  },

  recover(entityKey){
    try {
      const raw = localStorage.getItem(this.DRAFT_PREFIX + entityKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (Date.now() - parsed.timestamp > this.DRAFT_MAX_AGE_MS){
        localStorage.removeItem(this.DRAFT_PREFIX + entityKey);
        return null;
      }
      return parsed.data;
    } catch(e){ return null; }
  },

  clear(entityKey){
    try { localStorage.removeItem(this.DRAFT_PREFIX + entityKey); } catch(e){}
    IDB.delete('drafts', entityKey).catch(()=>{});
    this.DIRTY_FLAG = false;
    this.setStatus('💾 Siap', 'var(--muted)');
  },

  attachForm(entityKey, bodyHTML, dataGetter){
    const container = document.getElementById('mBody');
    if (!container) return;

    const recovered = this.recover(entityKey);
    if (recovered){
      const useDraft = confirm(
        '📋 Ditemukan draft yang belum tersimpan dari sesi sebelumnya.\n\n' +
        'Tekan OK untuk memulihkan draft, atau Cancel untuk mulai dari kosong.'
      );
      if (useDraft){
        setTimeout(() => this.applyDraft(container, recovered), 50);
      } else {
        this.clear(entityKey);
      }
    }

    const inputs = container.querySelectorAll('input, select, textarea');
    const getter = dataGetter || (() => {
      const d = {};
      inputs.forEach(inp => {
        if (!inp.id) return;
        d[inp.id] = inp.type === 'checkbox' ? inp.checked : inp.value;
      });
      return d;
    });

    inputs.forEach(inp => {
      if (inp.readOnly || inp.disabled) return;
      const evt = inp.tagName === 'SELECT' ? 'change' : 'input';
      inp.addEventListener(evt, () => this.schedule(entityKey, getter));
    });
  },

  applyDraft(container, data){
    Object.keys(data).forEach(id => {
      const el = container.querySelector('#' + id);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = !!data[id];
      else el.value = data[id];
      el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', {bubbles:true}));
    });
    this.setStatus('↺ Draft dipulihkan', 'var(--acc)');
  },

  forceFlush(entityKey, dataGetter){
    clearTimeout(this.timer);
    if (entityKey) this.flush(entityKey, dataGetter);
  }
};

/* =====================================================================
   BAGIAN 5 — INDEXEDDB WRAPPER (Layer 2 Backup)
   ===================================================================== */
const IDB = {
  dbName: 'mk_v1_idb',
  version: 1,
  _db: null,

  async open(){
    if (this._db) return this._db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, this.version);
      req.onerror = () => reject(req.error);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('drafts')){
          db.createObjectStore('drafts', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => { this._db = req.result; resolve(this._db); };
    });
  },

  async save(store, obj){
    try {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(obj);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    } catch(e){ return false; }
  },

  async get(store, key){
    try {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } catch(e){ return null; }
  },

  async delete(store, key){
    try {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).delete(key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
      });
    } catch(e){ return false; }
  },

  async listAll(store){
    try {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    } catch(e){ return []; }
  }
};

/* =====================================================================
   BAGIAN 6 — BEFORE UNLOAD GUARD
   ===================================================================== */
window.addEventListener('beforeunload', (e) => {
  if (AUTOSAVE.DIRTY_FLAG){
    AUTOSAVE.setStatus('⚠ Menyimpan darurat…', 'var(--danger)');
    try {
      localStorage.setItem('mk_v1_unsaved_marker', JSON.stringify({
        timestamp: Date.now()
      }));
    } catch(e){}
    e.preventDefault();
    e.returnValue = '';
    return '';
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && AUTOSAVE.DIRTY_FLAG){
    AUTOSAVE.flush(AUTOSAVE._lastKey, AUTOSAVE._lastGetter);
  }
});

/* =====================================================================
   BAGIAN 7 — RESOURCE LOADING (Time-Phased)
   Read-only terhadap RAB/RAP
   ===================================================================== */
function breakdownResources(projectId, granularity){
  granularity = granularity || 'weekly';
  const proj = DB.projects.find(p => p.id === projectId);
  if (!proj) return { error:'Proyek tidak ditemukan' };

  const items = DB.project_wbs.filter(w =>
    w.project_id === projectId && !w.is_group && w.start_date && w.finish_date
  );
  if (!items.length) return { buckets:[], byResource:{}, totals:{upah:0,bahan:0,alat:0} };

  const allDates = [];
  items.forEach(it => {
    const d1 = new Date(it.start_date);
    const d2 = new Date(it.finish_date);
    for (let d = new Date(d1); d <= d2; d.setDate(d.getDate() + 1)){
      allDates.push(d.toISOString().slice(0,10));
    }
  });
  const uniqueDates = [...new Set(allDates)].sort();
  if (!uniqueDates.length) return { buckets:[], byResource:{}, totals:{upah:0,bahan:0,alat:0} };

  const bucketMap = {};
  uniqueDates.forEach(tgl => {
    let key;
    if (granularity === 'monthly') key = tgl.slice(0,7);
    else if (granularity === 'weekly'){
      const d = new Date(tgl);
      const startOfYear = new Date(d.getFullYear(), 0, 1);
      const week = Math.ceil(((d - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
      key = d.getFullYear() + '-W' + String(week).padStart(2, '0');
    } else key = tgl;

    if (!bucketMap[key]){
      bucketMap[key] = {
        bucket_key: key,
        tanggal_mulai: tgl,
        tanggal_selesai: tgl,
        upah: 0, bahan: 0, alat: 0,
        detail_upah: {}, detail_bahan: {}, detail_alat: {}
      };
    } else {
      if (tgl > bucketMap[key].tanggal_selesai) bucketMap[key].tanggal_selesai = tgl;
    }
  });

  const byResource = {};
  const projCal = WorkingCalendar.get(proj.calendar_id);

  items.forEach(it => {
    const d1 = new Date(it.start_date);
    const d2 = new Date(it.finish_date);
    const workingDays = Math.max(1, WorkingCalendar.diffDays(it.start_date, it.finish_date, projCal, 'working'));
    const volHarian = num(it.volume_rab) / workingDays;

    const dets = DB.project_ahsp_details.filter(pd =>
      pd.project_id === projectId && pd.ahsp_id === it.ahsp_id
    );

    for (let d = new Date(d1); d <= d2; d.setDate(d.getDate() + 1)){
      if (!WorkingCalendar.isWorkDay(d, projCal)) continue;
      const tgl = d.toISOString().slice(0,10);

      let bkey;
      if (granularity === 'monthly') bkey = tgl.slice(0,7);
      else if (granularity === 'weekly'){
        const startOfYear = new Date(d.getFullYear(), 0, 1);
        const week = Math.ceil(((d - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7);
        bkey = d.getFullYear() + '-W' + String(week).padStart(2, '0');
      } else bkey = tgl;

      const bucket = bucketMap[bkey];
      if (!bucket) continue;

      dets.forEach(pd => {
        const r = DB.master_resources.find(x => x.id === pd.resource_id);
        if (!r) return;

        const kRAB = Calc.koefRAB(pd, r);
        const hRAB = num(pd.harga_rab) || num(r.harga_rab);
        const biaya = kRAB * hRAB * volHarian;
        const qty = kRAB * volHarian;

        if (r.jenis === 'upah'){
          bucket.upah += biaya;
          bucket.detail_upah[r.kode] = (bucket.detail_upah[r.kode] || 0) + qty;
        } else if (r.jenis === 'bahan'){
          bucket.bahan += biaya;
          bucket.detail_bahan[r.kode] = (bucket.detail_bahan[r.kode] || 0) + qty;
        } else if (r.jenis === 'alat'){
          bucket.alat += biaya;
          bucket.detail_alat[r.kode] = (bucket.detail_alat[r.kode] || 0) + qty;
        }

        if (!byResource[r.kode]){
          byResource[r.kode] = {
            kode: r.kode, nama: r.nama, jenis: r.jenis, satuan: r.satuan,
            total_qty: 0, total_biaya: 0
          };
        }
        byResource[r.kode].total_qty += qty;
        byResource[r.kode].total_biaya += biaya;
      });
    }
  });

  return {
    proyek: { kode: proj.kode, nama: proj.nama, mulai: proj.tgl_mulai, selesai: proj.tgl_selesai },
    granularity,
    buckets: Object.values(bucketMap).sort((a, b) => a.bucket_key.localeCompare(b.bucket_key)),
    byResource: Object.values(byResource).sort((a, b) => b.total_biaya - a.total_biaya),
    totals: {
      upah:  Object.values(bucketMap).reduce((s, b) => s + b.upah, 0),
      bahan: Object.values(bucketMap).reduce((s, b) => s + b.bahan, 0),
      alat:  Object.values(bucketMap).reduce((s, b) => s + b.alat, 0)
    }
  };
}

/* =====================================================================
   BAGIAN 8 — SCHEDULE RENDERING
   ===================================================================== */
function renderSchedule(){
  const pid = STATE.activeProject;
  if (!pid){ return; }

  const cpm = runCPM(pid);
  const proj = activeProj();
  const items = DB.project_wbs.filter(w => w.project_id === pid && !w.is_group);

  const critical = items.filter(w => num(w.is_critical) === 1);
  const totalDur = num(proj?.durasi_kerja) || 0;

  $('#schedKPI').innerHTML = `
    <div class="kpi"><div class="lbl">Total Item WBS</div><div class="val">${items.length}</div></div>
    <div class="kpi k4"><div class="lbl">Item Kritis</div><div class="val neg">${critical.length}</div></div>
    <div class="kpi k2"><div class="lbl">Durasi Proyek</div><div class="val">${totalDur} hari kerja</div><div class="sub">${proj?.durasi_minggu || 0} minggu</div></div>
    <div class="kpi k5"><div class="lbl">Periode</div><div class="val" style="font-size:13px">${esc(proj?.tgl_mulai)} → ${esc(proj?.tgl_selesai)}</div></div>
  `;

  const gran = $('#schedGranularity')?.value || 'weekly';
  const rl = breakdownResources(pid, gran);

  const head = `<thead><tr>
    <th>Periode</th>
    <th class="num">Upah (Rp)</th>
    <th class="num">Bahan (Rp)</th>
    <th class="num">Alat (Rp)</th>
    <th class="num">Total (Rp)</th>
  </tr></thead>`;
  const body = rl.buckets.map(b => `<tr>
    <td><b>${esc(b.bucket_key)}</b></td>
    <td class="num">${rp(b.upah)}</td>
    <td class="num">${rp(b.bahan)}</td>
    <td class="num">${rp(b.alat)}</td>
    <td class="num"><b>${rp(b.upah + b.bahan + b.alat)}</b></td>
  </tr>`).join('');
  $('#tblResourceLoad').innerHTML = head +
    `<tbody>${body || '<tr><td colspan="5" class="empty">Tidak ada data jadwal.</td></tr>'}</tbody>`;

  const cHead = `<thead><tr>
    <th>Kode</th><th>Uraian</th><th class="center">Dur</th>
    <th class="center">Start</th><th class="center">Finish</th>
    <th class="center">Float</th>
  </tr></thead>`;
  const cBody = critical.map(w => `<tr>
    <td><b>${esc(w.kode_wbs)}</b></td>
    <td>${esc(w.uraian)}</td>
    <td class="center">${num(w.duration) || 1}</td>
    <td class="center">${esc(w.start_date || '-')}</td>
    <td class="center">${esc(w.finish_date || '-')}</td>
    <td class="center"><span class="badge b-danger">${fmt(num(w.total_float), 0)}h</span></td>
  </tr>`).join('') || '<tr><td colspan="6" class="empty">Tidak ada item kritis</td></tr>';
  $('#tblCritical').innerHTML = cHead + `<tbody>${cBody}</tbody>`;
}

/* =====================================================================
   BAGIAN 9 — EVENT WIRING (Optional — panggil dari init jika ada tab schedule)
   ===================================================================== */
function initScheduleEvents(){
  const btnRun = document.getElementById('btnRunCPM');
  if (btnRun){
    btnRun.onclick = () => {
      const pid = STATE.activeProject;
      if (!pid){ toast('Pilih proyek dulu', false); return; }
      runCPM(pid);
      saveDB();
      renderSchedule();
      toast('CPM berhasil dihitung ulang');
    };
  }
  const selGran = document.getElementById('schedGranularity');
  if (selGran){
    selGran.onchange = renderSchedule;
  }
  const btnExp = document.getElementById('btnExportSchedule');
  if (btnExp){
    btnExp.onclick = () => {
      const pid = STATE.activeProject;
      if (!pid) return;
      const gran = $('#schedGranularity')?.value || 'weekly';
      const rl = breakdownResources(pid, gran);
      const header = ['Periode','Mulai','Selesai','Upah_Rp','Bahan_Rp','Alat_Rp','Total_Rp'];
      const rows = rl.buckets.map(b => [
        b.bucket_key, b.tanggal_mulai, b.tanggal_selesai,
        Math.round(b.upah), Math.round(b.bahan), Math.round(b.alat),
        Math.round(b.upah + b.bahan + b.alat)
      ]);
      const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n');
      const blob = new Blob(['\ufeff' + csv], {type:'text/csv;charset=utf-8'});
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'resource-loading-' + gran + '-' + today() + '.csv';
      a.click();
      toast('CSV diexport');
    };
  }
}

/* =====================================================================
   BAGIAN 10 — SEED WORKING CALENDARS & HOLIDAYS (Frontend fallback)
   ===================================================================== */
function seedCalendarDefaults(){
  if (!DB.working_calendars || !DB.working_calendars.length){
    DB.working_calendars = [
      {id:'wcal_std_001', kode:'CAL-STD', nama:'Kalender Standar (Senin-Jumat)',
       work_days:'1,2,3,4,5', jam_per_hari:8, start_hour:'08:00',
       keterangan:'Standar proyek pemerintah', is_default:1},
      {id:'wcal_6d_002', kode:'CAL-6D', nama:'Kalender 6 Hari Kerja',
       work_days:'1,2,3,4,5,6', jam_per_hari:8, start_hour:'08:00',
       keterangan:'Untuk proyek percepatan', is_default:0},
      {id:'wcal_24h_003', kode:'CAL-24H', nama:'Kalender 24/7',
       work_days:'0,1,2,3,4,5,6', jam_per_hari:24, start_hour:'00:00',
       keterangan:'Untuk pekerjaan kontinu', is_default:0}
    ];
  }
  if (!DB.holidays){
    DB.holidays = [
      {id:'hol_001', tanggal:'2026-01-01', nama:'Tahun Baru 2026', jenis:'nasional', calendar_id:'wcal_std_001'},
      {id:'hol_002', tanggal:'2026-03-19', nama:'Nyepi', jenis:'nasional', calendar_id:'wcal_std_001'},
      {id:'hol_003', tanggal:'2026-04-03', nama:'Wafat Isa Almasih', jenis:'nasional', calendar_id:'wcal_std_001'},
      {id:'hol_004', tanggal:'2026-05-01', nama:'Hari Buruh', jenis:'nasional', calendar_id:'wcal_std_001'},
      {id:'hol_005', tanggal:'2026-05-14', nama:'Kenaikan Isa Almasih', jenis:'nasional', calendar_id:'wcal_std_001'},
      {id:'hol_006', tanggal:'2026-06-01', nama:'Hari Lahir Pancasila', jenis:'nasional', calendar_id:'wcal_std_001'},
      {id:'hol_007', tanggal:'2026-08-17', nama:'Hari Kemerdekaan RI', jenis:'nasional', calendar_id:'wcal_std_001'},
      {id:'hol_008', tanggal:'2026-12-25', nama:'Hari Natal', jenis:'nasional', calendar_id:'wcal_std_001'}
    ];
  }
}