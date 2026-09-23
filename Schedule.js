/* =====================================================================
 * MANAJEMEN KONSTRUKSI v1 — SCHEDULE ENGINE
 * Pure JavaScript module — CPM, Working Calendar, Auto-Save, Resource Loading
 * =====================================================================
 */

/* =====================================================================
   BAGIAN 1 — WORKING CALENDAR ENGINE
   Menghitung durasi dengan mempertimbangkan hari kerja & hari libur
   ===================================================================== */
/* Helper: format Date ke ISO date pakai waktu LOKAL (bukan UTC) */
function localISO(d){
  if (!(d instanceof Date) || isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}
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

    const dateStr = localISO(date);
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
    return localISO(d);
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
  // relationship & kalender
  'predecessor','pred_type','lag_days','duration','calendar_id',
  // legacy schedule fields (backward compat)
  'start_date','finish_date',
  'early_start','early_finish','late_start','late_finish',
  'total_float','is_critical',
  'constraint_type','constraint_date',
  // NEW schedule fields (Phase 1)
  'durasi_hari',
  'tgl_mulai_rencana','tgl_selesai_rencana',
  'tgl_mulai_aktual','tgl_selesai_aktual',
  'float_total'
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
   BAGIAN 3 — CPM ENGINE v2 (Phase 2)
   Topological Sort + Forward Pass + Backward Pass + Critical Path
   ===================================================================== */
const CPM = {

  /* ── Helper: durasi efektif (kompatibel lama & baru) ── */
  getDuration(it){
    const a = num(it.duration);
    if (a > 0) return Math.max(1, Math.round(a));
    const b = num(it.durasi_hari);
    if (b > 0) return Math.max(1, Math.round(b));
    return 1;
  },

  /* ── Helper: parse string predecessor ──
     Didukung:
       "ID"           → FS, lag 0
       "IDFS"         → FS, lag 0
       "IDFS+2"       → FS, lag +2
       "IDSS-1"       → SS, lag -1
     Kolom pred_type & lag_days (jika terisi) menang atas string. */
  parsePred(str){
    if (!str) return null;
    const s = String(str).trim();
    const m = s.match(/^(.+?)\s*(FS|SS|FF|SF)\s*([+-]\s*\d+)?$/i);
    if (m) return {
      id:  m[1].trim(),
      type:m[2].toUpperCase(),
      lag: m[3] ? parseInt(m[3].replace(/\s/g,''), 10) : 0
    };
    return { id: s, type:'FS', lag:0 };
  },

  /* ── Helper: relationship efektif untuk sebuah item ── */
  getRelationship(it){
    const raw = it.predecessor;
    if (!raw) return null;
    const parsed = this.parsePred(raw);
    if (!parsed) return null;
    const type = (it.pred_type && String(it.pred_type).trim())
                 ? String(it.pred_type).trim().toUpperCase()
                 : parsed.type;
    const lag  = (it.lag_days !== undefined && it.lag_days !== null && it.lag_days !== '')
                 ? num(it.lag_days)
                 : parsed.lag;
    return { predRef: parsed.id, type, lag };
  },

  /* ── Helper: bangun map id/kode → item ── */
  buildMaps(items){
    const byId = {}, byKode = {};
    items.forEach(it => {
      byId[it.id] = it;
      if (it.kode_wbs) byKode[String(it.kode_wbs).trim()] = it;
    });
    return { byId, byKode };
  },

  /* ── Helper: resolve referensi (id atau kode_wbs) ── */
  resolveRef(ref, maps){
    if (!ref) return null;
    return maps.byId[ref] || maps.byKode[String(ref).trim()] || null;
  },

  /* ── Helper: pilih kalender untuk sebuah item ── */
  getCalendarFor(it, proj){
    return WorkingCalendar.get(it.calendar_id || proj.calendar_id);
  },

   /* ── Helper: snap tanggal ke hari kerja terdekat ke depan ── */
snapToWorkDay(iso, cal){
  let d = iso instanceof Date ? new Date(iso) : new Date(iso + 'T00:00:00');
  let guard = 0;
  while (!WorkingCalendar.isWorkDay(d, cal) && guard++ < 90){
    d.setDate(d.getDate() + 1);
  }
  return d;
},

  /* ═══════════════════════════════════════════════════════════
     A. TOPOLOGICAL SORT — Kahn's Algorithm (iteratif, aman)
     ═══════════════════════════════════════════════════════════ */
  topologicalSort(items, maps){
    const indeg = {}, succs = {};
    items.forEach(it => { indeg[it.id] = 0; succs[it.id] = []; });

    items.forEach(it => {
      const rel = this.getRelationship(it);
      if (!rel) return;
      const pred = this.resolveRef(rel.predRef, maps);
      if (!pred) return;
      indeg[it.id]++;
      succs[pred.id].push(it.id);
    });

    const queue = items.filter(it => indeg[it.id] === 0).map(it => it.id);
    const order = [];
    while (queue.length){
      const id = queue.shift();
      order.push(id);
      succs[id].forEach(sid => {
        indeg[sid]--;
        if (indeg[sid] === 0) queue.push(sid);
      });
    }

    if (order.length !== items.length){
      const cycle = items.filter(it => order.indexOf(it.id) < 0)
                         .map(it => it.kode_wbs || it.id);
      return { ok:false, order, cycle };
    }
    return { ok:true, order };
  },

  /* ═══════════════════════════════════════════════════════════
     B. FORWARD PASS — ES & EF
     ═══════════════════════════════════════════════════════════ */
  forwardPass(items, order, proj, maps){
    const byId = maps.byId;
    const projStart = new Date(proj.tgl_mulai || new Date());

    order.forEach(id => {
      const it = byId[id];
      const dur = this.getDuration(it);
      const cal = this.getCalendarFor(it, proj);

      let es = new Date(projStart);

      // Constraint awal
      const ct = it.constraint_type;
      const cd = it.constraint_date ? new Date(it.constraint_date) : null;
      if (ct && cd && !isNaN(cd.getTime())){
        switch (ct){
          case 'SNET':
          case 'MSO':
            if (cd > es) es = cd;
            break;
          case 'FNET': {
            const cand = WorkingCalendar.addWorkDays(cd, -dur, cal);
            if (cand > es) es = cand;
            break;
          }
        }
      }

      // Predecessor
      const rel = this.getRelationship(it);
      if (rel){
        const pred = this.resolveRef(rel.predRef, maps);
        if (pred && pred._ES && pred._EF){
          const lag = rel.lag;
          let cand;
          switch (rel.type){
            case 'FS': cand = WorkingCalendar.addWorkDays(pred._EF,  lag, cal); break;
            case 'SS': cand = WorkingCalendar.addWorkDays(pred._ES,  lag, cal); break;
            case 'FF': cand = WorkingCalendar.addWorkDays(pred._EF, -dur + lag, cal); break;
            case 'SF': cand = WorkingCalendar.addWorkDays(pred._ES, -dur + lag, cal); break;
            default:   cand = pred._EF;
          }
          if (cand > es) es = cand;
        }
      }

      es = this.snapToWorkDay(es, cal);

      it._ES = es;
      it._EF = WorkingCalendar.addWorkDays(es, dur, cal);
    });
  },

  /* ═══════════════════════════════════════════════════════════
     C. BACKWARD PASS — LF & LS
     ═══════════════════════════════════════════════════════════ */
  backwardPass(items, order, projFinish, proj, maps){
    const byId = maps.byId;
    const succs = {};
    items.forEach(it => { succs[it.id] = []; });

    items.forEach(it => {
      const rel = this.getRelationship(it);
      if (!rel) return;
      const pred = this.resolveRef(rel.predRef, maps);
      if (pred) succs[pred.id].push(it);
    });

    // Iterasi terbalik → successors selalu sudah diproses
    for (let i = order.length - 1; i >= 0; i--){
      const it = byId[order[i]];
      const dur = this.getDuration(it);
      const cal = this.getCalendarFor(it, proj);
      const list = succs[it.id];

      let lf;
      if (!list.length){
        lf = new Date(projFinish);
      } else {
        lf = null;
        list.forEach(s => {
          const rel = this.getRelationship(s);
          const lag = rel ? rel.lag : 0;
          const type = rel ? rel.type : 'FS';
          let cand;
          switch (type){
            case 'FS': cand = WorkingCalendar.addWorkDays(s._LS, -lag, cal); break;
            case 'SS': cand = WorkingCalendar.addWorkDays(s._LS, -lag, cal); break;
            case 'FF': cand = WorkingCalendar.addWorkDays(s._LF, -lag, cal); break;
            case 'SF': cand = WorkingCalendar.addWorkDays(s._LF, -lag, cal); break;
            default:   cand = s._LS;
          }
          if (lf === null || cand < lf) lf = cand;
        });
      }

      // Constraint akhir
      const ct = it.constraint_type;
      const cd = it.constraint_date ? new Date(it.constraint_date) : null;
      if (ct && cd && !isNaN(cd.getTime())){
        switch (ct){
          case 'FNLT':
            if (cd < lf) lf = cd;
            break;
          case 'MFO':
            lf = cd;
            break;
          case 'SNLT': {
            const cand = WorkingCalendar.addWorkDays(cd, dur, cal);
            if (cand < lf) lf = cand;
            break;
          }
          case 'MSO': {
            const cand = WorkingCalendar.addWorkDays(cd, dur, cal);
            if (cand < lf) lf = cand;
            break;
          }
        }
      }

      it._LF = lf;
      it._LS = WorkingCalendar.addWorkDays(lf, -dur, cal);
    }
  },

  /* ═══════════════════════════════════════════════════════════
     D. FLOAT & CRITICAL PATH
     ═══════════════════════════════════════════════════════════ */
  computeFloat(items, proj){
    items.forEach(it => {
      const cal = this.getCalendarFor(it, proj);
      // Total Float = LS − ES (dalam hari kerja)
      const flt = WorkingCalendar.diffDays(
        WorkingCalendar.fmt(it._ES),
        WorkingCalendar.fmt(it._LS),
        cal, 'working'
      );
      it._totalFloat = Math.max(0, flt);
    });
  },

  /* ═══════════════════════════════════════════════════════════
     ORCHESTRATOR
     ═══════════════════════════════════════════════════════════ */
  run(projectId){
    const proj = DB.projects.find(p => p.id === projectId);
    if (!proj) return { ok:false, message:'Proyek tidak ditemukan' };

    const items = DB.project_wbs.filter(w =>
      w.project_id === projectId && !w.is_group
    );
    if (!items.length) return { ok:true, message:'Tidak ada item WBS', count:0 };

    // 1) Topological sort
    const maps = this.buildMaps(items);
    const ts = this.topologicalSort(items, maps);
    if (!ts.ok){
      return {
        ok:false,
        message:'⚠ Circular dependency: ' + ts.cycle.join(' → ')
      };
    }

    // 2) Forward pass
    this.forwardPass(items, ts.order, proj, maps);

    // 3) Project finish
    const projStart = new Date(proj.tgl_mulai || new Date());
    let projFinish = projStart;
    items.forEach(it => { if (it._EF && it._EF > projFinish) projFinish = it._EF; });

    // 4) Backward pass
    this.backwardPass(items, ts.order, projFinish, proj, maps);

    // 5) Float + critical
    this.computeFloat(items, proj);

    // 6) Write-back (DUAL-WRITE)
    items.forEach(it => {
      const startISO  = WorkingCalendar.fmt(it._ES);
      const finishISO = WorkingCalendar.fmt(it._EF);
      const lsISO     = WorkingCalendar.fmt(it._LS);
      const lfISO     = WorkingCalendar.fmt(it._LF);
      const dur       = this.getDuration(it);
      const flt       = it._totalFloat || 0;
      const crit      = flt <= 0 ? 1 : 0;

      // New fields (Phase 1)
      writeScheduleField(it, 'durasi_hari',            dur);
      writeScheduleField(it, 'tgl_mulai_rencana',      startISO);
      writeScheduleField(it, 'tgl_selesai_rencana',    finishISO);
      writeScheduleField(it, 'float_total',            flt);
      writeScheduleField(it, 'is_critical',            crit);

      // Legacy fields (backward compat)
      writeScheduleField(it, 'start_date',   startISO);
      writeScheduleField(it, 'finish_date',  finishISO);
      writeScheduleField(it, 'early_start',  startISO);
      writeScheduleField(it, 'early_finish', finishISO);
      writeScheduleField(it, 'late_start',   lsISO);
      writeScheduleField(it, 'late_finish',  lfISO);
      writeScheduleField(it, 'total_float',  flt);

      delete it._ES; delete it._EF; delete it._LS; delete it._LF; delete it._totalFloat;
    });

    // 7) Update tanggal selesai proyek
    const newFinishISO = WorkingCalendar.fmt(projFinish);
    if (newFinishISO && newFinishISO !== proj.tgl_selesai){
      proj.tgl_selesai = newFinishISO;
      const dur = hitungDurasiLengkap(
        proj.tgl_mulai, newFinishISO,
        WorkingCalendar.get(proj.calendar_id),
        proj.durasi_mode || 'working'
      );
      proj.durasi_hari   = dur.durasi_hari;
      proj.durasi_minggu = dur.durasi_minggu;
      proj.durasi_kerja  = dur.durasi_kerja;
    }

    const criticalCount = items.filter(it => num(it.is_critical) === 1).length;
    return {
      ok: true,
      message: 'CPM selesai',
      count: items.length,
      critical: criticalCount,
      finish: newFinishISO,
      start: WorkingCalendar.fmt(projStart)
    };
  }
};

/* ── Backward-compat: fungsi lama memanggil runCPM ── */
function runCPM(projectId){
  return CPM.run(projectId);
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
   BAGIAN 7 — RESOURCE LOADER v2 (Phase 3)
   Ekstraksi kebutuhan × distribusi waktu × agregasi bucket
   READ-ONLY terhadap master_resources, ahsp_details_master, project_ahsp_details
   ===================================================================== */
const ResourceLoader = {

  /* ── Util: daftar hari kerja eksklusif [start, finish) ── */
  workingDaysInRange(startISO, finishISOExcl, cal){
    const out = [];
    if (!startISO || !finishISOExcl) return out;
    const end = new Date(finishISOExcl + 'T00:00:00');
    let d = new Date(startISO + 'T00:00:00');
    if (isNaN(d.getTime()) || isNaN(end.getTime())) return out;
    let guard = 0;
    while (d < end && guard++ < 5000){
      if (WorkingCalendar.isWorkDay(d, cal)){
        out.push(localISO(d));
      }
      d.setDate(d.getDate() + 1);
    }
    return out;
  },

  /* ── Util: bobot distribusi ternormalisasi ── */
  computeWeights(n, mode){
    if (n <= 0) return [];
    if (n === 1) return [1];
    const w = new Array(n);
    if (mode === 'triangular'){
      const c = (n - 1) / 2;
      for (let i = 0; i < n; i++){
        w[i] = 1 - Math.abs(i - c) / (c || 1) + 0.05;
      }
    } else if (mode === 'bell'){
      const c = (n - 1) / 2;
      const sigma = n / 4 || 1;
      for (let i = 0; i < n; i++){
        w[i] = Math.exp(-Math.pow((i - c) / sigma, 2)) + 0.02;
      }
    } else {
      for (let i = 0; i < n; i++) w[i] = 1;
    }
    const sum = w.reduce((s, x) => s + x, 0) || 1;
    return w.map(x => x / sum);
  },

  /* ── Util: bucket key sesuai granularitas ── */
  bucketKey(iso, gran){
    if (gran === 'monthly') return iso.slice(0, 7);
    if (gran === 'weekly'){
      const d = new Date(iso + 'T00:00:00');
      const startOfYear = new Date(d.getFullYear(), 0, 1);
      const week = Math.ceil(
        (((d - startOfYear) / 86400000 + startOfYear.getDay() + 1) / 7)
      );
      return d.getFullYear() + '-W' + String(week).padStart(2, '0');
    }
    return iso;
  },

  /* ═══════════════════════════════════════════════════════════
     A. EKSTRAKSI KEBUTUHAN PER ITEM WBS
     Volume × Koefisien → qty_total; × harga → cost_total
     ═══════════════════════════════════════════════════════════ */
  extractItemNeeds(projectId, mode){
    mode = mode || 'rab';
    const items = DB.project_wbs.filter(w =>
      w.project_id === projectId && !w.is_group && w.ahsp_id
    );

    // Pre-index project_ahsp_details by ahsp_id
    const detByAhsp = {};
    DB.project_ahsp_details.forEach(d => {
      if (d.project_id !== projectId) return;
      (detByAhsp[d.ahsp_id] = detByAhsp[d.ahsp_id] || []).push(d);
    });

    // Pre-index resources
    const resById = {};
    DB.master_resources.forEach(r => { resById[r.id] = r; });

    const result = [];
    items.forEach(w => {
      const vol = mode === 'rap' ? num(w.volume_rap) : num(w.volume_rab);
      if (vol <= 0) return;
      const dets = detByAhsp[w.ahsp_id] || [];
      const needs = [];

      dets.forEach(d => {
        const r = resById[d.resource_id];
        if (!r) return;
        const k = mode === 'rap' ? Calc.koefRAP(d, r) : Calc.koefRAB(d, r);
        if (k <= 0) return;
        const h = mode === 'rap' ? num(d.harga_rap) : num(d.harga_rab);
        const qty  = k * vol;
        const cost = qty * h;
        if (qty <= 0 && cost <= 0) return;
        needs.push({
          resource_id: r.id,
          kode:   r.kode,
          nama:   r.nama,
          jenis:  r.jenis,
          satuan: r.satuan,
          koef:   k,
          harga:  h,
          qty_total:  qty,
          cost_total: cost
        });
      });

      result.push({ wbs: w, volume: vol, needs });
    });
    return result;
  },

  /* ═══════════════════════════════════════════════════════════
     B. DISTRIBUSI HARIAN & AGREGASI BUCKET
     ═══════════════════════════════════════════════════════════ */
  load(projectId, opts){
    opts = opts || {};
    const mode  = opts.mode         || 'rab';
    const dist  = opts.distribution || 'uniform';
    const gran  = opts.granularity  || 'weekly';

    const proj = DB.projects.find(p => p.id === projectId);
    if (!proj) return { ok:false, error:'Proyek tidak ditemukan' };

    // Pastikan CPM terbaru
    const cpm = CPM.run(projectId);
    if (!cpm.ok) return { ok:false, error: cpm.message };

    const items = this.extractItemNeeds(projectId, mode);

    const buckets     = {};
    const byResource  = {};
    const resDailyMap = {};  // resKode → { isoDate: qty }
    const byWBS       = [];

    items.forEach(({ wbs, volume, needs }) => {
      if (!wbs.tgl_mulai_rencana || !wbs.tgl_selesai_rencana) return;

      const cal = WorkingCalendar.get(wbs.calendar_id || proj.calendar_id);
      const days = this.workingDaysInRange(
        wbs.tgl_mulai_rencana, wbs.tgl_selesai_rencana, cal
      );
      if (!days.length) return;

      const weights = this.computeWeights(days.length, dist);

      const wbsAgg = {
        kode_wbs: wbs.kode_wbs,
        uraian:   wbs.uraian,
        start:    wbs.tgl_mulai_rencana,
        finish:   wbs.tgl_selesai_rencana,
        durasi:   days.length,
        volume,
        upah: 0, bahan: 0, alat: 0
      };

      needs.forEach(n => {
        const detKey = 'detail_' + n.jenis;

        if (!byResource[n.kode]){
          byResource[n.kode] = {
            kode: n.kode, nama: n.nama, jenis: n.jenis, satuan: n.satuan,
            total_qty: 0, total_cost: 0, peak_daily_qty: 0
          };
        }
        byResource[n.kode].total_qty  += n.qty_total;
        byResource[n.kode].total_cost += n.cost_total;

        if (!resDailyMap[n.kode]) resDailyMap[n.kode] = {};

        days.forEach((tgl, i) => {
          const w    = weights[i];
          const qty  = n.qty_total  * w;
          const cost = n.cost_total * w;
          const bkey = this.bucketKey(tgl, gran);

          if (!buckets[bkey]){
            buckets[bkey] = {
              bucket_key: bkey,
              tanggal_mulai: tgl,
              tanggal_selesai: tgl,
              upah: 0, bahan: 0, alat: 0,
              detail_upah: {}, detail_bahan: {}, detail_alat: {}
            };
          } else {
            const b = buckets[bkey];
            if (tgl < b.tanggal_mulai)   b.tanggal_mulai   = tgl;
            if (tgl > b.tanggal_selesai) b.tanggal_selesai = tgl;
          }
          const b = buckets[bkey];
          b[n.jenis] += cost;
          b[detKey][n.kode] = (b[detKey][n.kode] || 0) + qty;

          resDailyMap[n.kode][tgl] = (resDailyMap[n.kode][tgl] || 0) + qty;
        });

        if (n.jenis === 'upah')  wbsAgg.upah  += n.cost_total;
        if (n.jenis === 'bahan') wbsAgg.bahan += n.cost_total;
        if (n.jenis === 'alat')  wbsAgg.alat  += n.cost_total;
      });

      byWBS.push(wbsAgg);
    });

    /* ── Peak per resource ── */
    Object.keys(resDailyMap).forEach(kode => {
      const map = resDailyMap[kode];
      let peak = 0;
      for (const d in map) if (map[d] > peak) peak = map[d];
      if (byResource[kode]) byResource[kode].peak_daily_qty = peak;
    });

    return {
      ok: true,
      proyek: {
        kode: proj.kode, nama: proj.nama,
        mulai: proj.tgl_mulai, selesai: proj.tgl_selesai
      },
      mode, distribution: dist, granularity: gran,
      buckets:    Object.values(buckets).sort((a,b) => a.bucket_key.localeCompare(b.bucket_key)),
      byResource: Object.values(byResource).sort((a,b) => b.total_cost - a.total_cost),
      byWBS:      byWBS.sort((a,b) => a.kode_wbs.localeCompare(b.kode_wbs)),
      resDailyMap,                                    // ← NEW (Phase 4)
      totals: {
        upah:  Object.values(buckets).reduce((s,b) => s + b.upah,  0),
        bahan: Object.values(buckets).reduce((s,b) => s + b.bahan, 0),
        alat:  Object.values(buckets).reduce((s,b) => s + b.alat,  0)
      }
    };
  }
};

/* ── Backward-compat: kode lama yang memanggil breakdownResources ── */
function breakdownResources(projectId, granularity){
  const r = ResourceLoader.load(projectId, { granularity: granularity || 'weekly' });
  return r.ok ? r : { error: r.error };
}

/* =====================================================================
   BAGIAN 8 — SCHEDULE RENDERING
   ===================================================================== */
function renderSchedule(){
  const pid = STATE.activeProject;
  if (!pid) return;

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
  const mode = $('#schedMode')?.value         || 'rab';
  const dist = $('#schedDistribution')?.value || 'uniform';

  const rl = ResourceLoader.load(pid, { granularity: gran, mode, distribution: dist });
  if (!rl.ok){
    $('#tblResourceLoad').innerHTML =
      `<tbody><tr><td class="empty">${esc(rl.error)}</td></tr></tbody>`;
    return;
  }

  /* ── Tabel time-phased ── */
  const head = `<thead><tr>
    <th>Periode</th><th>Rentang</th>
    <th class="num">Upah (Rp)</th>
    <th class="num">Bahan (Rp)</th>
    <th class="num">Alat (Rp)</th>
    <th class="num">Total (Rp)</th>
  </tr></thead>`;
  const body = rl.buckets.map(b => `<tr>
    <td><b>${esc(b.bucket_key)}</b></td>
    <td style="font-size:11px;color:var(--muted)">${esc(b.tanggal_mulai)} → ${esc(b.tanggal_selesai)}</td>
    <td class="num">${rp(b.upah)}</td>
    <td class="num">${rp(b.bahan)}</td>
    <td class="num">${rp(b.alat)}</td>
    <td class="num"><b>${rp(b.upah + b.bahan + b.alat)}</b></td>
  </tr>`).join('');
  const foot = `<tfoot><tr style="background:#0e1a30;font-weight:800">
    <td colspan="2" style="text-align:right;padding:10px">TOTAL</td>
    <td class="num">${rp(rl.totals.upah)}</td>
    <td class="num">${rp(rl.totals.bahan)}</td>
    <td class="num">${rp(rl.totals.alat)}</td>
    <td class="num">${rp(rl.totals.upah + rl.totals.bahan + rl.totals.alat)}</td>
  </tr></tfoot>`;
  $('#tblResourceLoad').innerHTML = head +
    `<tbody>${body || '<tr><td colspan="6" class="empty">Tidak ada data jadwal.</td></tr>'}</tbody>` + foot;

  /* ── Tabel per-resource dengan Peak/hari ── */
  const rHead = `<thead><tr>
    <th>Kode</th><th>Nama</th><th>Jenis</th><th>Satuan</th>
    <th class="num">Total Qty</th>
    <th class="num">Peak/hari</th>
    <th class="num">Total Biaya</th>
  </tr></thead>`;
  const rBody = rl.byResource.map(r => {
    const ratio = r.total_qty > 0 ? (r.peak_daily_qty / r.total_qty * 100) : 0;
    return `<tr>
      <td><b>${esc(r.kode)}</b></td>
      <td>${esc(r.nama)}</td>
      <td><span class="badge b-${r.jenis}">${esc(r.jenis)}</span></td>
      <td>${esc(r.satuan)}</td>
      <td class="num">${fmt(r.total_qty, 2)}</td>
      <td class="num">${fmt(r.peak_daily_qty, 3)} <span style="color:var(--muted);font-size:10px">(${fmt(ratio,1)}%)</span></td>
      <td class="num">${rp(r.total_cost)}</td>
    </tr>`;
  }).join('');
  const tblResEl = $('#tblResourceByRes');
  if (tblResEl){
    tblResEl.innerHTML = rHead +
      `<tbody>${rBody || '<tr><td colspan="7" class="empty">Tidak ada data.</td></tr>'}</tbody>`;
  }

  /* ── Critical path ── */
  const cHead = `<thead><tr>
    <th>Kode</th><th>Uraian</th><th class="center">Dur</th>
    <th class="center">Start</th><th class="center">Finish</th>
    <th class="center">Float</th>
  </tr></thead>`;
  const cBody = critical.map(w => `<tr>
    <td><b>${esc(w.kode_wbs)}</b></td>
    <td>${esc(w.uraian)}</td>
    <td class="center">${num(w.durasi_hari) || num(w.duration) || 1}</td>
    <td class="center">${esc(w.tgl_mulai_rencana || w.start_date || '-')}</td>
    <td class="center">${esc(w.tgl_selesai_rencana || w.finish_date || '-')}</td>
    <td class="center"><span class="badge b-danger">${fmt(num(w.float_total ?? w.total_float), 0)}h</span></td>
  </tr>`).join('') || '<tr><td colspan="6" class="empty">Tidak ada item kritis</td></tr>';
  $('#tblCritical').innerHTML = cHead + `<tbody>${cBody}</tbody>`;

  /* ── Grafik distribusi biaya per periode ── */
  const cv = $('#chartResourceLoad');
  if (cv){
    if (STATE.chartRL) STATE.chartRL.destroy();
    STATE.chartRL = new Chart(cv.getContext('2d'), {
      type: 'bar',
      data: {
        labels: rl.buckets.map(b => b.bucket_key),
        datasets: [
          {label:'Upah',  data: rl.buckets.map(b => b.upah),  backgroundColor:'rgba(47,129,247,.75)',  stack:'s'},
          {label:'Bahan', data: rl.buckets.map(b => b.bahan), backgroundColor:'rgba(26,188,156,.75)',  stack:'s'},
          {label:'Alat',  data: rl.buckets.map(b => b.alat),  backgroundColor:'rgba(245,158,11,.75)',  stack:'s'}
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: {labels:{color:'#e6edf7', font:{size:11}}},
          tooltip: {callbacks:{label: c => c.dataset.label + ': ' + rp(c.parsed.y)}}
        },
        scales: {
          x: {stacked:true, ticks:{color:'#8fa3c4'}, grid:{display:false}},
          y: {stacked:true, ticks:{color:'#8fa3c4', callback:v => 'Rp ' + (v/1e6).toFixed(0) + 'jt'}, grid:{color:'rgba(36,54,92,.5)'}}
        }
      }
    });
  }
     /* ── Phase 4: Gantt ── */
  const ganttEl = document.getElementById('chartGantt');
  if (ganttEl) GanttRenderer.render(pid, ganttEl);

  /* ── Phase 4: Resource Histogram ── */
  const selRes = document.getElementById('histResource');
  const histEl = document.getElementById('chartHistogram');
  if (selRes && histEl){
    // isi dropdown resource (sekali, kalau kosong)
    if (!selRes.options.length){
      selRes.innerHTML = rl.byResource.map(r =>
        `<option value="${esc(r.kode)}">${esc(r.kode)} — ${esc(r.nama)} (${esc(r.jenis)})</option>`
      ).join('');
    }
    const kode = selRes.value || (rl.byResource[0]?.kode);
    const gran = document.getElementById('histGranularity')?.value || 'daily';
    if (kode) ResourceHistogram.render(pid, histEl, kode, gran);
  }

  /* ── Phase 4: Over-Allocation Alerts ── */
  const alertEl = document.getElementById('overAllocWrap');
  if (alertEl){
    const det = OverAllocationDetector.detect(pid);
    if (!det.ok){
      alertEl.innerHTML = `<div class="alert warn">${esc(det.error)}</div>`;
    } else if (!det.alerts.length){
      alertEl.innerHTML = `<div class="alert ok"><span>✅</span><div><b>Tidak ada over-allocation.</b><br>Semua resource berada dalam batas kapasitas harian (atau kapasitas belum diisi).</div></div>`;
    } else {
      const html = det.alerts.map(a => `
        <div class="alert">
          <span>🔴</span>
          <div style="flex:1">
            <b>${esc(a.kode)} — ${esc(a.nama)}</b>
            <div style="font-size:11.5px;margin-top:4px">
              Kapasitas <b>${fmt(a.kapasitas,0)} ${esc(a.satuan)}/hari</b> ·
              Dilampaui <b>${a.jumlah_hari} hari</b> ·
              Puncak <b>${fmt(a.qty_terburuk,2)} ${esc(a.satuan)}</b>
              (<span class="neg">+${fmt(a.over_terburuk,2)}</span>, <b class="neg">${fmt(a.persen_over,1)}%</span></b>)
              pada <b>${esc(a.tanggal_terburuk)}</b>
            </div>
            <div style="font-size:10.5px;color:var(--muted);margin-top:4px">
              Saran: delay item non-kritis, atau tambah kapasitas ${esc(a.jenis)}.
            </div>
          </div>
        </div>`).join('');
      alertEl.innerHTML = html;
    }
  }
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
  const selMode = document.getElementById('schedMode');
  if (selMode) selMode.onchange = renderSchedule;

  const selDist = document.getElementById('schedDistribution');
  if (selDist) selDist.onchange = renderSchedule;

  const selRes = document.getElementById('histResource');
  if (selRes) selRes.onchange = renderSchedule;

  const selHistGran = document.getElementById('histGranularity');
  if (selHistGran) selHistGran.onchange = renderSchedule;
   
  const btnExp = document.getElementById('btnExportSchedule');
  if (btnExp){
    btnExp.onclick = () => {
      const pid = STATE.activeProject;
      if (!pid) return;
      const gran = $('#schedGranularity')?.value || 'weekly';
      const mode = $('#schedMode')?.value         || 'rab';
      const dist = $('#schedDistribution')?.value || 'uniform';
      const rl = ResourceLoader.load(pid, { granularity: gran, mode, distribution: dist });
      if (!rl.ok){ toast('Gagal: ' + rl.error, false); return; }

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
      a.download = 'resource-loading-' + mode + '-' + gran + '-' + today() + '.csv';
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

/* =====================================================================
   TEST CPM — Jalankan dari Console Browser
   Pemakaian: testCPM()  atau  testCPM('<projectId>')
   ===================================================================== */
function testCPM(projectId){
  projectId = projectId || STATE.activeProject;
  const r = CPM.run(projectId);
  console.log('%c[CPM Result]', 'color:#1abc9c;font-weight:bold', r);

  const items = DB.project_wbs.filter(w =>
    w.project_id === projectId && !w.is_group
  );
  console.table(items.map(it => ({
    kode:     it.kode_wbs,
    pred:     it.predecessor || '—',
    type:     it.pred_type   || 'FS',
    lag:      num(it.lag_days),
    durasi:   num(it.durasi_hari),
    ES:       it.tgl_mulai_rencana,
    EF:       it.tgl_selesai_rencana,
    LS:       it.late_start,
    LF:       it.late_finish,
    float:    num(it.float_total),
    kritis:   num(it.is_critical) === 1 ? '★' : ''
  })));
  return r;
}

/* =====================================================================
   TEST RESOURCE LOADER — jalankan dari Console Browser
   Pemakaian: testResourceLoader()  atau  testResourceLoader('<projectId>')
   ===================================================================== */
function testResourceLoader(projectId){
  projectId = projectId || STATE.activeProject;

  const modes = ['rab','rap'];
  const dists = ['uniform','triangular','bell'];

  modes.forEach(mode => {
    dists.forEach(dist => {
      const r = ResourceLoader.load(projectId, {
        mode, distribution: dist, granularity: 'daily'
      });
      if (!r.ok){ console.warn(mode, dist, r.error); return; }

      const tot = r.totals.upah + r.totals.bahan + r.totals.alat;
      console.log(
        `%c[${mode.toUpperCase()} / ${dist}]%c total=${rp(tot)} | buckets=${r.buckets.length} | resources=${r.byResource.length}`,
        'color:#1abc9c;font-weight:bold', 'color:#e6edf7'
      );
    });
  });

  // Verifikasi konservasi: Σ bucket = Σ resource = Σ WBS
  const r = ResourceLoader.load(projectId, {mode:'rab', distribution:'uniform', granularity:'daily'});
  const sB = r.buckets.reduce((s,b) => s + b.upah + b.bahan + b.alat, 0);
  const sR = r.byResource.reduce((s,x) => s + x.total_cost, 0);
  const sW = r.byWBS.reduce((s,x) => s + x.upah + x.bahan + x.alat, 0);
  console.log('%c[Conservation Check]', 'color:#f59e0b;font-weight:bold');
  console.log('  Σ buckets :', rp(sB));
  console.log('  Σ resource:', rp(sR));
  console.log('  Σ WBS     :', rp(sW));
  console.log('  Δ max     :', rp(Math.max(Math.abs(sB-sR), Math.abs(sR-sW), Math.abs(sB-sW))));

  console.table(r.byResource.slice(0, 15).map(x => ({
    kode: x.kode, jenis: x.jenis, satuan: x.satuan,
    total_qty: +x.total_qty.toFixed(2),
    peak_daily: +x.peak_daily_qty.toFixed(3),
    total_cost: Math.round(x.total_cost)
  })));
  return r;
}

/* =====================================================================
   BAGIAN 9 — PHASE 4 VISUALIZATION & DETECTION
   Gantt · Resource Histogram · Over-Allocation Detector
   ===================================================================== */

/* ═══════════════════════════════════════════════════════════
   A. GANTT CHART — Bar horizontal, biru=normal, merah=kritis
   ═══════════════════════════════════════════════════════════ */
const GanttRenderer = {
  render(projectId, canvasEl){
    if (!canvasEl) return;
    const proj = DB.projects.find(p => p.id === projectId);
    if (!proj) return;

    const items = DB.project_wbs
      .filter(w => w.project_id === projectId && !w.is_group && w.tgl_mulai_rencana)
      .sort((a,b) => (a.tgl_mulai_rencana || '').localeCompare(b.tgl_mulai_rencana || ''));

    if (STATE.chartGantt){ STATE.chartGantt.destroy(); STATE.chartGantt = null; }

    if (!items.length){
      const ctx = canvasEl.getContext('2d');
      ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
      ctx.fillStyle = '#8fa3c4';
      ctx.font = '13px Segoe UI';
      ctx.textAlign = 'center';
      ctx.fillText('Belum ada item WBS dengan jadwal.', canvasEl.width/2, 40);
      return;
    }

    // Tinggi canvas adaptif: 28px per baris + 60px padding
    canvasEl.style.height = Math.max(200, items.length * 28 + 60) + 'px';

    const projStart = new Date(proj.tgl_mulai + 'T00:00:00');
    const dayMs = 86400000;

    const labels = items.map(w => w.kode_wbs + '  ' + String(w.uraian || '').slice(0, 45));
    const data = items.map(w => {
      const s = new Date(w.tgl_mulai_rencana + 'T00:00:00');
      const f = new Date(w.tgl_selesai_rencana + 'T00:00:00');
      const a = Math.round((s - projStart) / dayMs);
      const b = Math.round((f - projStart) / dayMs);
      return [a, b];
    });
    const bg = items.map(w => num(w.is_critical) === 1
      ? 'rgba(239,68,68,.85)' : 'rgba(47,129,247,.85)');
    const bc = items.map(w => num(w.is_critical) === 1 ? '#dc2626' : '#1f6fe0');

    STATE.chartGantt = new Chart(canvasEl.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: 'Jadwal',
          data,
          backgroundColor: bg,
          borderColor: bc,
          borderWidth: 1,
          borderRadius: 4,
          barPercentage: 0.7
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: {duration: 300},
        plugins: {
          legend: {display: false},
          tooltip: {
            callbacks: {
              title: c => items[c[0].dataIndex].kode_wbs + ' — ' + items[c[0].dataIndex].uraian,
              label: c => {
                const w = items[c.dataIndex];
                return [
                  'Mulai  : ' + (w.tgl_mulai_rencana || '-'),
                  'Selesai: ' + (w.tgl_selesai_rencana || '-'),
                  'Durasi : ' + (num(w.durasi_hari) || num(w.duration) || 1) + ' hari kerja',
                  'Float  : ' + num(w.float_total ?? w.total_float) + ' hari',
                  num(w.is_critical) === 1 ? '★ JALUR KRITIS' : '○ non-kritis'
                ];
              }
            }
          }
        },
        scales: {
          x: {
            ticks: {
              color: '#8fa3c4', font: {size: 10},
              callback: v => {
                const d = new Date(projStart.getTime() + v * dayMs);
                return localISO(d).slice(5);
              }
            },
            grid: {color: 'rgba(36,54,92,.5)'}
          },
          y: {
            ticks: {color: '#e6edf7', font: {size: 10}},
            grid: {display: false}
          }
        }
      }
    });
  }
};

/* ═══════════════════════════════════════════════════════════
   B. RESOURCE HISTOGRAM — Kebutuhan harian/periodik per resource
   ═══════════════════════════════════════════════════════════ */
const ResourceHistogram = {
  render(projectId, canvasEl, resourceKode, granularity){
    if (!canvasEl || !resourceKode) return;
    granularity = granularity || 'daily';

    const rl = ResourceLoader.load(projectId, {mode:'rab', granularity});
    if (!rl.ok) return;

    // Agregasi map harian ke bucket kalau perlu
    const rawMap = rl.resDailyMap[resourceKode] || {};
    const map = {};
    Object.keys(rawMap).forEach(d => {
      const k = granularity === 'monthly' ? d.slice(0,7)
              : granularity === 'weekly'  ? ResourceLoader.bucketKey(d, 'weekly')
              : d;
      map[k] = (map[k] || 0) + rawMap[d];
    });

    const labels = Object.keys(map).sort();
    const values = labels.map(k => map[k]);

    const info = rl.byResource.find(x => x.kode === resourceKode);
    const cap = num(info?.kapasitas_harian);
    // kapasitas per bucket = kapasitas harian × jumlah hari dalam bucket (approx)
    const capBucket = granularity === 'daily' ? cap
                    : granularity === 'weekly' ? cap * 5
                    : cap * 22;

    const datasets = [{
      label: 'Kebutuhan ' + (info?.nama || resourceKode) + ' (' + (info?.satuan||'') + ')',
      data: values,
      backgroundColor: values.map(v => capBucket > 0 && v > capBucket
        ? 'rgba(239,68,68,.75)' : 'rgba(47,129,247,.75)'),
      borderColor: values.map(v => capBucket > 0 && v > capBucket ? '#dc2626' : '#1f6fe0'),
      borderWidth: 1,
      borderRadius: 4
    }];

    if (capBucket > 0){
      datasets.push({
        label: 'Kapasitas (' + fmt(capBucket, 0) + ' ' + (info?.satuan||'') + ')',
        data: labels.map(() => capBucket),
        type: 'line',
        borderColor: '#f59e0b',
        backgroundColor: 'rgba(245,158,11,.1)',
        borderWidth: 2,
        borderDash: [6, 4],
        pointRadius: 0,
        fill: false
      });
    }

    if (STATE.chartHist){ STATE.chartHist.destroy(); STATE.chartHist = null; }
    STATE.chartHist = new Chart(canvasEl.getContext('2d'), {
      type: 'bar',
      data: {labels, datasets},
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: {duration: 300},
        plugins: {
          legend: {labels:{color:'#e6edf7', font:{size:11}}},
          tooltip: {
            callbacks: {
              label: c => c.dataset.label + ': ' + fmt(c.parsed.y, 2)
            }
          }
        },
        scales: {
          x: {ticks:{color:'#8fa3c4', font:{size:10}}, grid:{display:false}},
          y: {beginAtZero:true, ticks:{color:'#8fa3c4'}, grid:{color:'rgba(36,54,92,.5)'}}
        }
      }
    });
  }
};

/* ═══════════════════════════════════════════════════════════
   C. OVER-ALLOCATION DETECTOR
   Bandingkan kebutuhan harian vs kapasitas_harian per resource
   ═══════════════════════════════════════════════════════════ */
const OverAllocationDetector = {
  detect(projectId){
    const rl = ResourceLoader.load(projectId, {mode:'rab', granularity:'daily'});
    if (!rl.ok) return {ok: false, error: rl.error, alerts: []};

    const infoMap = {};
    rl.byResource.forEach(x => { infoMap[x.kode] = x; });

    const alerts = [];
    Object.keys(rl.resDailyMap).forEach(kode => {
      const info = infoMap[kode];
      const cap = num(info?.kapasitas_harian);
      if (cap <= 0) return;

      const map = rl.resDailyMap[kode];
      const violations = [];
      Object.keys(map).forEach(d => {
        if (map[d] > cap){
          violations.push({tanggal: d, qty: map[d], over: map[d] - cap});
        }
      });

      if (violations.length){
        violations.sort((a,b) => a.tanggal.localeCompare(b.tanggal));
        const maxOver = Math.max(...violations.map(v => v.over));
        const worst   = violations.find(v => v.over === maxOver);
        alerts.push({
          kode, nama: info.nama, jenis: info.jenis,
          satuan: info.satuan, kapasitas: cap,
          jumlah_hari: violations.length,
          tanggal_terburuk: worst.tanggal,
          qty_terburuk: worst.qty,
          over_terburuk: maxOver,
          persen_over: (maxOver / cap * 100),
          violations
        });
      }
    });

    alerts.sort((a,b) => b.persen_over - a.persen_over);
    return {ok: true, alerts, total_checked: rl.byResource.length};
  }
};

/* =====================================================================
   BAGIAN 10 — SYNC MANAGER (Phase 5)
   Partial payload · Version guard · Soft lock
   ===================================================================== */
const SyncManager = {

  CLIENT_ID: 'cli_' + Date.now().toString(36) + '_' +
             Math.random().toString(36).slice(2, 7),

  /* ── Strip field transien & cache turunan sebelum kirim ── */
  sanitize(db){
    if (!db || typeof db !== 'object') return db;
    const FORBIDDEN = new Set([
      'resDailyMap','buckets','byResource','byWBS','totals',
      'violations','_ES','_EF','_LS','_LF','_totalFloat'
    ]);
    const clean = {};
    Object.keys(db).forEach(sheetName => {
      const arr = db[sheetName];
      if (!Array.isArray(arr)){ clean[sheetName] = arr; return; }
      clean[sheetName] = arr.map(row => {
        if (!row || typeof row !== 'object') return row;
        const out = {};
        Object.keys(row).forEach(k => {
          if (k.startsWith('_')) return;
          if (FORBIDDEN.has(k)) return;
          out[k] = row[k];
        });
        return out;
      });
    });
    return clean;
  },

  estimateSizeKB(db){
    try {
      const s = JSON.stringify(db);
      return +(s.length / 1024).toFixed(1);
    } catch(e){ return -1; }
  },

  /* ── Push dengan version guard ── */
  async push(db, settings, opts){
    opts = opts || {};
    const clean = this.sanitize(db);
    const sizeKB = this.estimateSizeKB(clean);
    if (sizeKB > 3000) console.warn('[SyncManager] payload besar:', sizeKB, 'KB');
    console.log('[SyncManager] push payload:', sizeKB, 'KB');

    const baseVersion = opts.force ? null : (STATE.dbVersion ?? null);

    const out = await sheetRequest('push', {
      db: clean,
      settings,
      baseVersion,
      clientId: this.CLIENT_ID
    });

    if (out.ok && typeof out.dbVersion === 'number'){
      STATE.dbVersion = out.dbVersion;
      saveDB();
    }
    return Object.assign(out, { sizeKB });
  },

  /* ── Pull ── */
  async pull(){
    const out = await sheetRequest('pull', {});
    if (out.ok && typeof out.dbVersion === 'number'){
      STATE.dbVersion = out.dbVersion;
    }
    return out;
  },

  /* ── Soft lock ── */
  async lock(ttlMs){
    const out = await sheetRequest('softLock', {
      clientId: this.CLIENT_ID, ttlMs: ttlMs || 120000
    });
    return out;
  },
  async release(){
    return sheetRequest('softRelease', { clientId: this.CLIENT_ID });
  },
  async status(){
    return sheetRequest('softStatus', {});
  }
};
