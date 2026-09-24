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
  'predecessor','pred_type','lag_days','duration','calendar_id',
  'start_date','finish_date',
  'early_start','early_finish','late_start','late_finish',
  'total_float','is_critical',
  'constraint_type','constraint_date',
  'durasi_hari',
  'tgl_mulai_rencana','tgl_selesai_rencana',
  'tgl_mulai_aktual','tgl_selesai_aktual',
  'float_total',
  // ── Baseline fields (Fase 4A) ──
  'bl1_start','bl1_finish','bl1_set_at',
  'bl2_start','bl2_finish','bl2_set_at',
  'bl3_start','bl3_finish','bl3_set_at',
  // ── NEW (Fase 1A) — Auto vs Manual Scheduling ──
  'schedule_mode','manual_start','manual_finish'
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
   BAGIAN 3 — CPM ENGINE v3 (Fase 1B)
   Topological Sort + Forward/Backward Pass + Critical Path
   NEW: Multiple Predecessor · Auto/Manual Routing · ALAP
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

  /* ── Helper: MODE jadwal efektif (Fase 1B) ── */
  getScheduleMode(it){
    const m = String(it.schedule_mode || 'auto').trim().toLowerCase();
    return (m === 'manual') ? 'manual' : 'auto';
  },

  /* ── Helper: parse tanggal toleran (Date | "yyyy-MM-dd" | ISO) ── */
  _parseDate(v){
    if (!v) return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : new Date(v);
    const s = String(v).trim();
    if (!s) return null;
    const d = new Date(s.includes('T') ? s : s + 'T00:00:00');
    return isNaN(d.getTime()) ? null : d;
  },

  /* ── Helper: parse SATU segmen predecessor ──
     Format: "<ref><TYPE><lag>"
     Contoh: "I.1", "I.1FS", "I.1FS+2", "I.2SS-1"
     Return: { id, type, lag, explicit } */
  parsePredecessorSegment(seg){
    const s = String(seg).trim();
    if (!s) return null;
    const m = s.match(/^(.+?)\s*(FS|SS|FF|SF)\s*([+-]\s*\d+)?$/i);
    if (m) return {
      id:  m[1].trim(),
      type:m[2].toUpperCase(),
      lag: m[3] ? parseInt(m[3].replace(/\s/g,''), 10) : 0,
      explicit: true
    };
    return { id: s, type:'FS', lag:0, explicit: false };
  },

  /* ── Helper: parse STRING predecessor (multi, dipisah ; atau newline) ── */
  parsePredecessors(str){
    if (!str) return [];
    return String(str)
      .split(/[;\n]+/)
      .map(s => this.parsePredecessorSegment(s))
      .filter(Boolean);
  },

  /* ── Helper backward-compat: pred pertama ── */
  parsePred(str){
    const list = this.parsePredecessors(str);
    return list.length ? list[0] : null;
  },

  /* ── Helper: relationship efektif untuk sebuah item (MULTI) ──
     Aturan:
       - >1 pred  → SEMUA pakai inline type/lag (global override diabaikan).
       - 1 pred + inline EKSPLISIT ("I.1FS+2") → pakai inline.
       - 1 pred + inline tidak eksplisit ("I.1") → pakai global override. */
  getRelationships(it){
    const parsed = this.parsePredecessors(it.predecessor);
    if (!parsed.length) return [];

    const multi = parsed.length > 1;
    const globalType = (it.pred_type && String(it.pred_type).trim())
                       ? String(it.pred_type).trim().toUpperCase()
                       : null;
    const globalLag  = (it.lag_days !== undefined && it.lag_days !== null && it.lag_days !== '')
                       ? num(it.lag_days)
                       : null;

    return parsed.map(p => {
      if (multi || p.explicit){
        return { predRef: p.id, type: p.type, lag: p.lag };
      }
      return {
        predRef: p.id,
        type: globalType || p.type,
        lag:  globalLag !== null ? globalLag : p.lag
      };
    });
  },

  /* ── Helper backward-compat: relationship pertama ── */
  getRelationship(it){
    const list = this.getRelationships(it);
    return list.length ? list[0] : null;
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
     A. TOPOLOGICAL SORT — Kahn's Algorithm (multi-pred safe)
     ═══════════════════════════════════════════════════════════ */
  topologicalSort(items, maps){
    const indeg = {}, succs = {};
    items.forEach(it => { indeg[it.id] = 0; succs[it.id] = []; });

    const seenEdges = {};
    items.forEach(it => {
      const rels = this.getRelationships(it);
      rels.forEach(rel => {
        const pred = this.resolveRef(rel.predRef, maps);
        if (!pred) return;
        const key = pred.id + '>' + it.id;
        if (seenEdges[key]) return;
        seenEdges[key] = true;
        indeg[it.id]++;
        succs[pred.id].push(it.id);
      });
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
     B. FORWARD PASS — ES & EF (Fase 1B: manual + multi-pred)
     ═══════════════════════════════════════════════════════════ */
  forwardPass(items, order, proj, maps){
    const byId = maps.byId;
    const projStart = new Date(proj.tgl_mulai || new Date());

    order.forEach(id => {
      const it = byId[id];
      const dur = this.getDuration(it);
      const cal = this.getCalendarFor(it, proj);
      const mode = this.getScheduleMode(it);

      /* ═══ MANUAL MODE: tanggal terkunci user ═══ */
      if (mode === 'manual'){
        const ms = this._parseDate(it.manual_start);
        if (ms){
          let mf = this._parseDate(it.manual_finish);
          if (!mf || mf <= ms){
            mf = WorkingCalendar.addWorkDays(ms, dur, cal);
          }
          it._ES = ms;
          it._EF = mf;
          it._isManual = true;
          return;
        }
        // Fallback: manual_start kosong → hitung auto
      }

      let es = new Date(projStart);

      // Constraint awal (SNET, MSO, FNET)
      const ct = it.constraint_type;
      const cd = this._parseDate(it.constraint_date);
      if (ct && cd){
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

      // Predecessor (MULTI) — ambil ES paling "ketat" (max)
      const rels = this.getRelationships(it);
      rels.forEach(rel => {
        const pred = this.resolveRef(rel.predRef, maps);
        if (!pred || !pred._ES || !pred._EF) return;
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
      });

      es = this.snapToWorkDay(es, cal);

      it._ES = es;
      it._EF = WorkingCalendar.addWorkDays(es, dur, cal);
      it._isManual = false;
    });
  },

  /* ═══════════════════════════════════════════════════════════
     C. BACKWARD PASS — LF & LS (multi-pred + manual-aware)
     ═══════════════════════════════════════════════════════════ */
  backwardPass(items, order, projFinish, proj, maps){
    const byId = maps.byId;
    const succs = {};
    items.forEach(it => { succs[it.id] = []; });

    // Build edge list dengan dedup
    const seenEdges = {};
    items.forEach(it => {
      const rels = this.getRelationships(it);
      rels.forEach(rel => {
        const pred = this.resolveRef(rel.predRef, maps);
        if (!pred) return;
        const key = pred.id + '>' + it.id;
        if (seenEdges[key]) return;
        seenEdges[key] = true;
        succs[pred.id].push({ succ: it, rel });
      });
    });

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
        list.forEach(({ succ, rel }) => {
          const lag = rel.lag;
          const type = rel.type;
          let cand;
          switch (type){
            case 'FS': cand = WorkingCalendar.addWorkDays(succ._LS, -lag, cal); break;
            case 'SS': cand = WorkingCalendar.addWorkDays(succ._LS, -lag, cal); break;
            case 'FF': cand = WorkingCalendar.addWorkDays(succ._LF, -lag, cal); break;
            case 'SF': cand = WorkingCalendar.addWorkDays(succ._LF, -lag, cal); break;
            default:   cand = succ._LS;
          }
          if (lf === null || cand < lf) lf = cand;
        });
      }

      // Constraint akhir (FNLT, MFO, SNLT, MSO)
      const ct = it.constraint_type;
      const cd = this._parseDate(it.constraint_date);
      if (ct && cd){
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
      const flt = WorkingCalendar.diffDays(
        WorkingCalendar.fmt(it._ES),
        WorkingCalendar.fmt(it._LS),
        cal, 'working'
      );
      it._totalFloat = Math.max(0, flt);
    });
  },

  /* ═══════════════════════════════════════════════════════════
     ORCHESTRATOR (Fase 1B)
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

    // 3) Project finish = max(_EF)
    const projStart = new Date(proj.tgl_mulai || new Date());
    let projFinish = projStart;
    items.forEach(it => {
      if (it._EF && it._EF > projFinish) projFinish = it._EF;
    });

    // 4) Backward pass
    this.backwardPass(items, ts.order, projFinish, proj, maps);

    // 4b) ALAP override — task ALAP pindah ke LS/LF
    items.forEach(it => {
      if (it._isManual) return;
      const ct = String(it.constraint_type || '').toUpperCase();
      if (ct === 'ALAP'){
        it._ES = new Date(it._LS);
        it._EF = new Date(it._LF);
      }
    });

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
      writeScheduleField(it, 'durasi_hari',         dur);
      writeScheduleField(it, 'tgl_mulai_rencana',   startISO);
      writeScheduleField(it, 'tgl_selesai_rencana', finishISO);
      writeScheduleField(it, 'float_total',         flt);
      writeScheduleField(it, 'is_critical',         crit);

      // Legacy fields (backward compat)
      writeScheduleField(it, 'start_date',   startISO);
      writeScheduleField(it, 'finish_date',  finishISO);
      writeScheduleField(it, 'early_start',  startISO);
      writeScheduleField(it, 'early_finish', finishISO);
      writeScheduleField(it, 'late_start',   lsISO);
      writeScheduleField(it, 'late_finish',  lfISO);
      writeScheduleField(it, 'total_float',  flt);

      // Cleanup temp fields
      delete it._ES; delete it._EF; delete it._LS; delete it._LF;
      delete it._totalFloat; delete it._isManual;
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
    const manualCount   = items.filter(it => this.getScheduleMode(it) === 'manual').length;

    return {
      ok: true,
      message: 'CPM selesai',
      count: items.length,
      critical: criticalCount,
      manual: manualCount,
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
   
   /* ── Fase 1: Gantt MS Project Style ── */
   const ganttEl = document.getElementById('ganttContainer');
   if (ganttEl){
     const mode = $('#schedMode')?.value || 'rab';
     GanttView.mount(ganttEl, pid, { mode, zoom: ganttEl._lastZoom || 'weekly' });
   }

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
              (<span class="neg">+${fmt(a.over_terburuk,2)}</span>, <b class="neg">${fmt(a.persen_over,1)}%</b>)
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

  /* ── Fase 1E: Conflict Detection Panel ── */
  const conflictEl = document.getElementById('conflictWrap');
  if (conflictEl){
    const cfr = ConflictDetector.detect(pid);
    if (!cfr.ok){
      conflictEl.innerHTML = '<div class="alert warn">' + esc(cfr.error || 'Gagal deteksi konflik') + '</div>';
    } else if (!cfr.conflicts.length){
      conflictEl.innerHTML = '<div class="alert ok"><span>✅</span><div><b>Tidak ada konflik jadwal.</b><br>Semua constraint dan predecessor konsisten.</div></div>';
    } else {
      const groups = { high: [], warn: [], info: [] };
      cfr.conflicts.forEach(c => (groups[c.severity] || groups.info).push(c));
      let html = '';
      if (groups.high.length){
        html += '<div style="font-size:11px;color:var(--muted);margin-bottom:6px;letter-spacing:.5px;font-weight:700">🔴 KRITIS (' + groups.high.length + ')</div>';
        html += groups.high.map(renderConflictCard).join('');
      }
      if (groups.warn.length){
        html += '<div style="font-size:11px;color:var(--muted);margin:10px 0 6px;letter-spacing:.5px;font-weight:700">🟡 PERINGATAN (' + groups.warn.length + ')</div>';
        html += groups.warn.map(renderConflictCard).join('');
      }
      if (groups.info.length){
        html += groups.info.map(renderConflictCard).join('');
      }
      conflictEl.innerHTML = html;

      // Click-to-edit: klik conflict card → buka form WBS
      conflictEl.querySelectorAll('[data-conflict-task]').forEach(card => {
        card.style.cursor = 'pointer';
        card.onclick = () => {
          const taskId = card.getAttribute('data-conflict-task');
          if (taskId && typeof formWbs === 'function') formWbs(taskId);
        };
      });
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

  /* ── Fase 1E: Conflict Refresh ── */
  const btnCfr = document.getElementById('btnConflictRefresh');
  if (btnCfr){
    btnCfr.onclick = () => {
      const pid = STATE.activeProject;
      if (!pid){ toast('Pilih proyek dulu', false); return; }
      renderSchedule();
      toast('Konflik jadwal di-refresh');
    };
  }

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
   BAGIAN 8B — BASELINE & VARIANCE ENGINE (Fase 4A)
   Menyimpan snapshot jadwal sebagai acuan + menghitung slip
   ===================================================================== */
const Baseline = {
  INDICES: [1, 2, 3],

  fieldFor(idx, kind){
    // kind: 'start' | 'finish' | 'set_at'
    return 'bl' + idx + '_' + kind;
  },

  /* Apakah baseline ke-idx sudah pernah di-set untuk proyek ini? */
  isSet(projectId, idx){
    if (!idx) return false;
    const items = DB.project_wbs.filter(w => w.project_id === projectId && !w.is_group);
    if (!items.length) return false;
    const f = this.fieldFor(idx, 'set_at');
    return items.some(w => w[f] && String(w[f]).trim() !== '');
  },

  /* Ambil timestamp baseline (ISO string) */
  getTimestamp(projectId, idx){
    if (!idx) return null;
    const items = DB.project_wbs.filter(w => w.project_id === projectId && !w.is_group);
    const f = this.fieldFor(idx, 'set_at');
    for (const w of items){
      const v = w[f];
      if (v && String(v).trim() !== '') return String(v);
    }
    return null;
  },

  /* Snapshot jadwal saat ini ke baseline ke-idx */
  set(projectId, idx){
    const items = DB.project_wbs.filter(w => w.project_id === projectId && !w.is_group);
    if (!items.length) return { ok:false, msg:'Tidak ada item WBS' };
    const now = new Date().toISOString();
    const fS = this.fieldFor(idx, 'start');
    const fF = this.fieldFor(idx, 'finish');
    const fT = this.fieldFor(idx, 'set_at');
    items.forEach(w => {
      writeScheduleField(w, fS, w.tgl_mulai_rencana   || '');
      writeScheduleField(w, fF, w.tgl_selesai_rencana || '');
      writeScheduleField(w, fT, now);
    });
    saveDB();
    return { ok:true, count: items.length, timestamp: now };
  },

  /* Hapus baseline ke-idx */
  clear(projectId, idx){
    const items = DB.project_wbs.filter(w => w.project_id === projectId);
    const fS = this.fieldFor(idx, 'start');
    const fF = this.fieldFor(idx, 'finish');
    const fT = this.fieldFor(idx, 'set_at');
    items.forEach(w => {
      writeScheduleField(w, fS, '');
      writeScheduleField(w, fF, '');
      writeScheduleField(w, fT, '');
    });
    saveDB();
    return { ok:true };
  },

  /* Hitung variance per task */
  variance(projectId, idx){
    if (!idx || !this.isSet(projectId, idx)) return [];
    const fS = this.fieldFor(idx, 'start');
    const fF = this.fieldFor(idx, 'finish');
    const items = DB.project_wbs.filter(w => w.project_id === projectId && !w.is_group);
    return items.map(w => {
      const bStart  = w[fS] || '';
      const bFinish = w[fF] || '';
      const cStart  = w.tgl_mulai_rencana   || '';
      const cFinish = w.tgl_selesai_rencana || '';
      if (!bFinish || !cFinish){
        return { w, bStart, bFinish, cStart, cFinish, slip: null, slipStart: null };
      }
      const cal = WorkingCalendar.get(w.calendar_id);
      const slip      = WorkingCalendar.diffDays(bFinish, cFinish, cal, 'working');
      const slipStart = WorkingCalendar.diffDays(bStart,  cStart,  cal, 'working');
      return { w, bStart, bFinish, cStart, cFinish, slip, slipStart };
    });
  },

  /* KPI agregat */
  kpi(projectId, idx){
    const rows = this.variance(projectId, idx);
    const valid   = rows.filter(r => r.slip !== null);
    const late    = valid.filter(r => r.slip > 0);
    const early   = valid.filter(r => r.slip < 0);
    const onTime  = valid.filter(r => r.slip === 0);
    const totalSlip = late.reduce((s, r) => s + r.slip, 0);
    const maxSlip   = late.reduce((m, r) => Math.max(m, r.slip), 0);
    const avgSlip   = late.length ? (totalSlip / late.length) : 0;
    return {
      total: valid.length,
      late: late.length, onTime: onTime.length, early: early.length,
      totalSlip, avgSlip, maxSlip,
      pctLate: valid.length ? (late.length / valid.length * 100) : 0
    };
  }
};

/* =====================================================================
   BAGIAN 9 — GANTT CHART MS PROJECT STYLE
   A. GanttEngine          — Data layer (tree, rollup, progress)
   B. GanttView            — Presentation layer (table + canvas)
   C. ResourceHistogram    — Histogram kebutuhan per resource
   D. OverAllocationDetector — Deteksi over-alokasi
   ===================================================================== */

/* ═══════════════════════════════════════════════════════════
   A. GANTT ENGINE — Data Layer
   ═══════════════════════════════════════════════════════════ */
const GanttEngine = {

  buildTree(projectId, opts){
    opts = opts || {};
    const mode = opts.mode || 'rab';
    const proj = DB.projects.find(p => p.id === projectId);
    if (!proj) return { ok:false, error:'Proyek tidak ditemukan', nodes:[] };

    const allWbs = DB.project_wbs.filter(w => w.project_id === projectId);
    if (!allWbs.length) return { ok:true, nodes:[], proj };

    const childrenOf = {};
    allWbs.forEach(w => {
      const pk = w.parent_id || '__root__';
      (childrenOf[pk] = childrenOf[pk] || []).push(w);
    });
    Object.keys(childrenOf).forEach(k =>
      childrenOf[k].sort((a,b) => (a.urut||0) - (b.urut||0))
    );

    const nodes = [];
    const walk = (parentKey, level) => {
      (childrenOf[parentKey] || []).forEach(w => {
        const node = this.makeNode(w, level, proj, mode);
        nodes.push(node);
        if (w.is_group) walk(w.id, level + 1);
      });
    };
    walk('__root__', 0);

    this.rollup(nodes);
    return { ok:true, nodes, proj };
  },

  makeNode(w, level, proj, mode){
    const isSummary = !!w.is_group;
    const duration  = num(w.durasi_hari) || num(w.duration) || (isSummary ? 0 : 1);
    const startISO  = w.tgl_mulai_rencana   || w.start_date  || '';
    const finishISO = w.tgl_selesai_rencana || w.finish_date || '';

    let progressPct = 0;
    if (!isSummary){
      const target = mode === 'rap' ? num(w.volume_rap) : num(w.volume_rab);
      if (target > 0){
        const done = DB.progress
          .filter(p => p.wbs_id === w.id)
          .reduce((s,p) => s + num(p.volume), 0);
        progressPct = Math.min(100, (done / target) * 100);
      }
    }

    return {
      id: w.id,
      kode: w.kode_wbs || '',
      nama: w.uraian || '',
      level,
      isSummary,
      isMilestone: !isSummary && duration === 0,
      isCritical:  !isSummary && num(w.is_critical) === 1,
      duration,
      startISO,
      finishISO,
      predecessors: this.formatPred(w),
      resources:    isSummary ? '' : this.formatResources(w, proj, mode),
      progressPct,
      parentId: w.parent_id || null,
      totalRab: num(w.volume_rab) * Calc.hargaSatuanRAB(proj.id, w.ahsp_id),
      raw: w
    };
  },

  formatPred(w){
    if (!w.predecessor) return '';
    const pred = DB.project_wbs.find(x => x.id === w.predecessor);
    if (!pred) return '';
    const type = (w.pred_type || 'FS').toUpperCase();
    const lag  = num(w.lag_days);
    let s = pred.kode_wbs || '?';
    if (type !== 'FS') s += ' ' + type;
    if (lag !== 0)     s += (lag > 0 ? '+' : '') + lag + 'd';
    return s;
  },

  formatResources(w, proj, mode){
    if (!w.ahsp_id) return '';
    const dets = DB.project_ahsp_details.filter(d =>
      d.project_id === proj.id && d.ahsp_id === w.ahsp_id
    );
    if (!dets.length) return '';
    const parts = [];
    dets.slice(0, 3).forEach(d => {
      const r = DB.master_resources.find(x => x.id === d.resource_id);
      if (!r) return;
      const k = mode === 'rap' ? Calc.koefRAP(d, r) : Calc.koefRAB(d, r);
      parts.push(`${r.nama} (${fmt(k, 3)})`);
    });
    if (dets.length > 3) parts.push(`+${dets.length - 3} lainnya`);
    return parts.join(', ');
  },

  rollup(nodes){
    const maxLevel = Math.max(...nodes.map(n => n.level), 0);
    for (let lvl = maxLevel; lvl >= 0; lvl--){
      nodes.filter(n => n.level === lvl && n.isSummary).forEach(n => {
        const kids = nodes.filter(c => c.parentId === n.id);
        if (!kids.length) return;

        const starts   = kids.map(c => c.startISO).filter(Boolean).sort();
        const finishes = kids.map(c => c.finishISO).filter(Boolean).sort();
        if (starts.length)   n.startISO  = starts[0];
        if (finishes.length) n.finishISO = finishes[finishes.length - 1];

        const cal = WorkingCalendar.get(n.raw.calendar_id);
        if (n.startISO && n.finishISO){
          n.duration = WorkingCalendar.diffDays(n.startISO, n.finishISO, cal, 'working');
        }

        const weight = kids.reduce((s,c) => s + c.totalRab, 0);
        if (weight > 0){
          n.progressPct = kids.reduce((s,c) => s + c.progressPct * c.totalRab, 0) / weight;
        }
        n.isCritical = kids.some(c => c.isCritical);
      });
    }
  }
};

/* ═══════════════════════════════════════════════════════════
   B. GANTT VIEW — Presentation Layer
   ═══════════════════════════════════════════════════════════ */
const GanttView = {

  ZOOM: {
    hourly:    { pxPerDay: 96, label: 'Per Jam',  tier1: 'day',     tier2: 'hour'    },
    daily:     { pxPerDay: 32, label: 'Harian',   tier1: 'month',   tier2: 'day'     },
    weekly:    { pxPerDay: 12, label: 'Mingguan', tier1: 'month',   tier2: 'week'    },
    monthly:   { pxPerDay: 4,  label: 'Bulanan',  tier1: 'quarter', tier2: 'month'   },
    quarterly: { pxPerDay: 2,  label: 'Triwulan', tier1: 'year',    tier2: 'quarter' },
    yearly:    { pxPerDay: 0.8,label: 'Tahunan',  tier1: 'year',    tier2: 'month'   }
  },

  COLUMNS: [
    { key:'kode',         label:'ID',        width: 78, align:'left'  },
    { key:'nama',         label:'Task Name', width:230, align:'left'  },
    { key:'duration',     label:'Dur',       width: 48, align:'right' },
    { key:'startISO',     label:'Start',     width: 78, align:'center'},
    { key:'finishISO',    label:'Finish',    width: 78, align:'center'},
    { key:'variance',     label:'Var',       width: 56, align:'center'},  // ← NEW
    { key:'predecessors', label:'Pred',      width: 62, align:'left'  },
    { key:'resources',    label:'Resources', width:108, align:'left'  }
  ],

  COL_STORE_KEY: 'mk_gantt_col_widths_v1',
  ROW_H: 26,
  AXIS_H: 60,

  /* ═══════════════════════════════════════════════════════════
     Fase 2C — Bar Style Presets + Gridlines Config
     ═══════════════════════════════════════════════════════════ */
  STYLE_STORE_KEY: 'mk_gantt_style_v1',

  BAR_STYLES: {
    classic: { label: 'Classic',  radius: 3, barH: 14, border: true,  borderW: 1,   gradient: false, shadow: false },
    modern:  { label: 'Modern',   radius: 6, barH: 16, border: false, borderW: 0,   gradient: true,  shadow: true  },
    minimal: { label: 'Minimal',  radius: 2, barH: 10, border: false, borderW: 0,   gradient: false, shadow: false },
    bold:    { label: 'Bold',     radius: 4, barH: 18, border: true,  borderW: 1.5, gradient: false, shadow: true  }
  },

  GRIDLINES_DEFAULTS: {
    vertical: true,
    horizontal: true,
    workingDaysShading: true,
    weekSeparator: true
  },

  loadStyle(){
    try {
      const raw = localStorage.getItem(this.STYLE_STORE_KEY);
      if (!raw){
        return { barStyle: 'classic', gridlines: Object.assign({}, this.GRIDLINES_DEFAULTS) };
      }
      const p = JSON.parse(raw);
      return {
        barStyle: this.BAR_STYLES[p.barStyle] ? p.barStyle : 'classic',
        gridlines: Object.assign({}, this.GRIDLINES_DEFAULTS, p.gridlines || {})
      };
    } catch(e){
      return { barStyle: 'classic', gridlines: Object.assign({}, this.GRIDLINES_DEFAULTS) };
    }
  },

  saveStyle(barStyle, gridlines){
    try {
      localStorage.setItem(this.STYLE_STORE_KEY, JSON.stringify({ barStyle, gridlines }));
    } catch(e){}
  },

  _state: null,

  /* ─────── MOUNT ─────── */
  mount(container, projectId, opts){
    if (!container) return null;
    opts = opts || {};

    const tree = GanttEngine.buildTree(projectId, { mode: opts.mode || 'rab' });
    if (!tree.ok){
      container.innerHTML = '<div class="empty">' + esc(tree.error) + '</div>';
      return null;
    }
    if (!tree.nodes.length){
      container.innerHTML = '<div class="empty">Belum ada item WBS. Tambahkan dulu di tab <b>WBS / BQ</b>.</div>';
      return null;
    }

    const nodes = tree.nodes;
    const proj  = tree.proj;

    const collapsed = container._collapsed || new Set();
    const selected  = container._selected  || new Set();
    const baselineIdx = (opts.baselineIdx !== undefined)
                        ? opts.baselineIdx
                        : (container._baselineIdx || null);
    const filter = container._filter || {
      search: '', chips: new Set(), sort: { key: null, dir: 'asc' }, groupBy: null
    };
    const collapsedGroups = container._collapsedGroups || new Set();

    const childrenOf = {};
    nodes.forEach(n => {
      if (n.parentId) (childrenOf[n.parentId] = childrenOf[n.parentId] || []).push(n.id);
    });

    const allDates = [];
    nodes.forEach(n => {
      if (n.startISO)  allDates.push(n.startISO);
      if (n.finishISO) allDates.push(n.finishISO);
    });
    if (!allDates.length){
      container.innerHTML = '<div class="empty">Item WBS belum punya jadwal. Jalankan <b>Recalculate CPM</b> dulu.</div>';
      return null;
    }
    allDates.sort();
    const minDate = allDates[0];
    const maxDate = allDates[allDates.length - 1];

    const cal = WorkingCalendar.get(proj.calendar_id);
    const startDate = WorkingCalendar.addWorkDays(minDate, -3, cal);
    const endDate   = WorkingCalendar.addWorkDays(maxDate,  7, cal);

    const zoom    = opts.zoom || 'weekly';
    const zoomCfg = this.ZOOM[zoom] || this.ZOOM.weekly;

    const totalDays   = Math.round((endDate - startDate) / 86400000) + 1;
    let chartWidth;
    if (zoom === 'hourly'){
      // Hourly: 1 hari = 24 jam, tapi kita punya pxPerDay = 96 → 4px/jam
      chartWidth = Math.max(800, totalDays * zoomCfg.pxPerDay);
    } else if (zoom === 'yearly'){
      // Yearly: pxPerDay sangat kecil — pastikan minimum lebar
      chartWidth = Math.max(600, totalDays * zoomCfg.pxPerDay);
    } else {
      chartWidth = Math.max(400, totalDays * zoomCfg.pxPerDay);
    }

    const styleState = this.loadStyle();

    const state = {
      container, nodes, proj, startDate, endDate, totalDays,
      chartWidth, zoom, zoomCfg,
      mode: opts.mode || 'rab', cal,
      collapsed, childrenOf, selected,
      baselineIdx,
      filter, collapsedGroups,
      visibleNodes: [],
      totalHeight: 0,
      posMap: {},
      barDrag: null,
      /* Fase 2C — style */
      barStyle:      styleState.barStyle,
      barStyleCfg:   this.BAR_STYLES[styleState.barStyle] || this.BAR_STYLES.classic,
      gridlines:     styleState.gridlines
    };

    this._state = state;
    container._lastZoom = zoom;
    container._collapsed = collapsed;
    container._selected  = selected;
    container._baselineIdx = baselineIdx;
    container._filter = filter;
    container._collapsedGroups = collapsedGroups;

    this.applyColWidths(state);
    this.computeVisible(state);
    this.renderLayout(state);
    this.wireEvents(state);
    return state;
  },

     /* Hitung node yang terlihat (skip descendants of collapsed) */
  computeVisible(state){
    const {nodes, collapsed, filter} = state;

    // 1. Hidden karena collapse summary
    const hidden = new Set();
    const markHidden = (id) => {
      const kids = state.childrenOf[id] || [];
      kids.forEach(kid => { hidden.add(kid); markHidden(kid); });
    };
    collapsed.forEach(id => markHidden(id));

    let visible = nodes.filter(n => !hidden.has(n.id));

    // 2. Filter by search
    if (filter.search){
      visible = this.applySearch(visible, state, filter.search);
    }

    // 3. Filter by chips
    if (filter.chips.size > 0){
      visible = this.applyChips(visible, state, filter.chips);
    }

    // 4. Sort by column (skip kalau group aktif)
    if (filter.sort.key && !filter.groupBy){
      visible = this.applySort(visible, state);
    }

    // 5. Group by (insert group headers)
    if (filter.groupBy){
      visible = this.applyGroup(visible, state);
    }

    state.visibleNodes = visible;
    state.totalHeight  = visible.length * this.ROW_H;
  },

  /* Filter by search (show matching + ancestors) */
  applySearch(nodes, state, q){
    const needle = q.toLowerCase();
    const matching = new Set();
    const byId = {};
    nodes.forEach(n => { byId[n.id] = n; });

    nodes.forEach(n => {
      if (n.isGroupHeader) return;
      const hay = ((n.kode || '') + ' ' + (n.nama || '')).toLowerCase();
      if (hay.includes(needle)) matching.add(n.id);
    });

    const keep = new Set(matching);
    matching.forEach(id => {
      let cur = byId[id];
      while (cur && cur.parentId){
        keep.add(cur.parentId);
        cur = byId[cur.parentId];
      }
    });
    return nodes.filter(n => keep.has(n.id));
  },

  /* Filter by chips (AND semantics) */
  applyChips(nodes, state, chips){
    const matching = new Set();
    const byId = {};
    nodes.forEach(n => { byId[n.id] = n; });

    const hasBaseline = state.baselineIdx && Baseline.isSet(state.proj.id, state.baselineIdx);
    const fF = hasBaseline ? Baseline.fieldFor(state.baselineIdx, 'finish') : null;

    nodes.forEach(n => {
      if (n.isGroupHeader) return;
      let ok = true;
      if (chips.has('critical')  && !n.isCritical)   ok = false;
      if (chips.has('milestone') && !n.isMilestone)  ok = false;
      if (chips.has('summary')   && !n.isSummary)    ok = false;
      if (chips.has('late')){
        if (!hasBaseline){ ok = false; }
        else {
          const bF = n.raw[fF];
          if (!bF || !n.finishISO){ ok = false; }
          else {
            const cal = WorkingCalendar.get(n.raw.calendar_id);
            const slip = WorkingCalendar.diffDays(bF, n.finishISO, cal, 'working');
            if (slip <= 0) ok = false;
          }
        }
      }
      if (ok) matching.add(n.id);
    });

    const keep = new Set(matching);
    matching.forEach(id => {
      let cur = byId[id];
      while (cur && cur.parentId){
        keep.add(cur.parentId);
        cur = byId[cur.parentId];
      }
    });
    return nodes.filter(n => keep.has(n.id));
  },

  /* Sort siblings within each parent */
  applySort(nodes, state){
    const { key, dir } = state.filter.sort;
    const byParent = {};
    nodes.forEach(n => {
      const pk = n.parentId || '__root__';
      (byParent[pk] = byParent[pk] || []).push(n);
    });

    const cmp = (a, b) => {
      const va = this.sortValue(a, key, state);
      const vb = this.sortValue(b, key, state);
      let r;
      if (typeof va === 'number' && typeof vb === 'number') r = va - vb;
      else r = String(va).localeCompare(String(vb), 'id');
      return dir === 'asc' ? r : -r;
    };
    Object.keys(byParent).forEach(pk => byParent[pk].sort(cmp));

    const result = [];
    const walk = (pk) => {
      (byParent[pk] || []).forEach(n => {
        result.push(n);
        walk(n.id);
      });
    };
    walk('__root__');
    return result;
  },

  sortValue(node, key, state){
    switch (key){
      case 'kode':      return String(node.kode || '');
      case 'nama':      return String(node.nama || '').toLowerCase();
      case 'duration':  return node.duration || 0;
      case 'startISO':  return String(node.startISO || '');
      case 'finishISO': return String(node.finishISO || '');
      case 'predecessors': return String(node.predecessors || '');
      case 'variance': {
        if (!state.baselineIdx || !Baseline.isSet(state.proj.id, state.baselineIdx)) return 0;
        const fF = Baseline.fieldFor(state.baselineIdx, 'finish');
        const bF = node.raw[fF];
        if (!bF || !node.finishISO) return 0;
        const cal = WorkingCalendar.get(node.raw.calendar_id);
        return WorkingCalendar.diffDays(bF, node.finishISO, cal, 'working');
      }
      default: return '';
    }
  },

  /* Group by field — insert synthetic header rows */
  applyGroup(nodes, state){
    const field = state.filter.groupBy;
    const groups = {};
    nodes.forEach(n => {
      if (n.isSummary) return;   // skip summaries in grouped view
      const val = this.groupValue(n, field, state);
      (groups[val] = groups[val] || []).push(n);
    });

    const names = Object.keys(groups).sort((a, b) =>
      String(a).localeCompare(String(b), 'id')
    );

    const result = [];
    names.forEach(name => {
      const items = groups[name];
      const isCollapsed = state.collapsedGroups.has(name);

      result.push({
        id: '__grp__' + field + '__' + name,
        kode: '',
        nama: name,
        isGroupHeader: true,
        groupName: name,
        groupField: field,
        groupCount: items.length,
        collapsed: isCollapsed
      });

      if (!isCollapsed){
        let items2 = items;
        if (state.filter.sort.key){
          items2 = items.slice().sort((a, b) => {
            const va = this.sortValue(a, state.filter.sort.key, state);
            const vb = this.sortValue(b, state.filter.sort.key, state);
            let r;
            if (typeof va === 'number' && typeof vb === 'number') r = va - vb;
            else r = String(va).localeCompare(String(vb), 'id');
            return state.filter.sort.dir === 'asc' ? r : -r;
          });
        }
        items2.forEach(n => result.push(n));
      }
    });
    return result;
  },

  groupValue(node, field, state){
    switch (field){
      case 'kategori': {
        const w = node.raw;
        if (!w.ahsp_id) return '— Tanpa AHSP —';
        const a = DB.ahsp_headers.find(x => x.id === w.ahsp_id);
        return a ? (a.kategori || '— Tanpa Kategori —') : '— Tanpa AHSP —';
      }
      case 'kalender': {
        const w = node.raw;
        const cal = DB.working_calendars.find(c =>
          c.id === (w.calendar_id || state.proj.calendar_id)
        );
        return cal ? (cal.kode + ' — ' + cal.nama) : '— Tidak ada kalender —';
      }
      case 'status': {
        if (!state.baselineIdx || !Baseline.isSet(state.proj.id, state.baselineIdx))
          return '🔵 Belum ada baseline';
        const w = node.raw;
        const fF = Baseline.fieldFor(state.baselineIdx, 'finish');
        const bF = w[fF];
        if (!bF) return '⚪ Belum di baseline';
        const cal = WorkingCalendar.get(w.calendar_id);
        const slip = WorkingCalendar.diffDays(bF, w.tgl_selesai_rencana, cal, 'working');
        if (slip > 0) return '🔴 Late';
        if (slip < 0) return '🟢 Early';
        return '🔵 On-Time';
      }
      default: return '—';
    }
  },

  /* Cari index node di visibleNodes */
  indexOfVisible(state, id){
    return state.visibleNodes.findIndex(n => n.id === id);
  },
     /* ── Column widths persistence ── */
  loadColWidths(){
    try {
      const raw = localStorage.getItem(this.COL_STORE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch(e){ return null; }
  },
  saveColWidths(widths){
    try { localStorage.setItem(this.COL_STORE_KEY, JSON.stringify(widths)); } catch(e){}
  },
  applyColWidths(state){
    const saved = this.loadColWidths();
    if (saved){
      this.COLUMNS.forEach(c => { if (saved[c.key]) c.width = saved[c.key]; });
    }
    state.colWidths = {};
    this.COLUMNS.forEach(c => state.colWidths[c.key] = c.width);
  },
  tableWidth(){
    return this.COLUMNS.reduce((s,c) => s + c.width, 0);
  },

  /* ─────── LAYOUT (Fase 1.2 — grid 2×2) ─────── */
  renderLayout(state){
    const {container, proj, zoom, chartWidth, totalHeight, visibleNodes, selected, baselineIdx} = state;
    const tableW = this.tableWidth();

    const blIsSet = baselineIdx && Baseline.isSet(proj.id, baselineIdx);

    // ── Toolbar baseline options ──
    const blOpts = Baseline.INDICES.map(i => {
      const isSet = Baseline.isSet(proj.id, i);
      const sel = (baselineIdx === i) ? ' selected' : '';
      return '<option value="' + i + '"' + sel + '>BL' + i + (isSet ? ' ✓' : '') + '</option>';
    }).join('');

    // ── KPI bar (hanya muncul bila baseline aktif) ──
    let kpiBar = '';
    if (blIsSet){
      const k = Baseline.kpi(proj.id, baselineIdx);
      const ts = Baseline.getTimestamp(proj.id, baselineIdx);
      const tsFmt = ts ? new Date(ts).toLocaleString('id-ID', {dateStyle:'medium', timeStyle:'short'}) : '—';
      kpiBar =
        '<div class="gantt-kpi-bar">' +
          '<div class="kpi-item"><div class="lbl">Baseline</div><div class="val ok">BL' + baselineIdx + '</div></div>' +
          '<div class="kpi-divider"></div>' +
          '<div class="kpi-item"><div class="lbl">Total Task</div><div class="val">' + k.total + '</div></div>' +
          '<div class="kpi-item"><div class="lbl">On-Time</div><div class="val ok">' + k.onTime + '</div></div>' +
          '<div class="kpi-item"><div class="lbl">Late</div><div class="val late">' + k.late + ' (' + k.pctLate.toFixed(1) + '%)</div></div>' +
          '<div class="kpi-item"><div class="lbl">Early</div><div class="val early">' + k.early + '</div></div>' +
          '<div class="kpi-divider"></div>' +
          '<div class="kpi-item"><div class="lbl">Avg Slip</div><div class="val ' + (k.avgSlip > 0 ? 'late' : 'ok') + '">' + k.avgSlip.toFixed(1) + 'd</div></div>' +
          '<div class="kpi-item"><div class="lbl">Max Slip</div><div class="val ' + (k.maxSlip > 0 ? 'late' : 'ok') + '">' + k.maxSlip + 'd</div></div>' +
          '<div class="kpi-timestamp">📌 Diset: ' + esc(tsFmt) + '</div>' +
        '</div>';
    }

    container.innerHTML =
      '<div class="gantt-root" style="--gantt-table-w:' + tableW + 'px">' +
        '<div class="gantt-toolbar">' +
          '<div class="gantt-toolbar-left">' +
            '<div class="gantt-title">🗓 ' + esc(proj.kode) + ' — Gantt Chart</div>' +
            '<div class="gantt-subtitle">' + esc(proj.nama) + ' · ' + esc(proj.tgl_mulai) + ' → ' + esc(proj.tgl_selesai) + '</div>' +
          '</div>' +
          '<div class="gantt-toolbar-right">' +
            '<button class="gantt-btn-tool gantt-btn-expand-all" title="Expand All">⊞</button>' +
            '<button class="gantt-btn-tool gantt-btn-collapse-all" title="Collapse All">⊟</button>' +
            '<button class="gantt-btn-export gantt-btn-export-png" title="Export PNG">⬇ PNG</button>' +
            '<button class="gantt-btn-export gantt-btn-export-pdf" title="Export PDF" style="background:linear-gradient(135deg,#dc2626,#b91c1c)">📄 PDF</button>' +
            '<button class="gantt-btn-level gantt-btn-level-open" title="Auto Leveling">⚖ Level</button>' +
            '<span class="gantt-lbl" style="margin-left:8px">Baseline</span>' +
            '<select class="gantt-baseline-sel">' +
              '<option value="">— Tidak ada —</option>' + blOpts +
            '</select>' +
            '<button class="gantt-btn-tool gantt-btn-bl-set" title="Set Baseline">📌 Set</button>' +
            '<button class="gantt-btn-tool gantt-btn-bl-clear" title="Clear Baseline">🗑 Clear</button>' +
            '<span class="gantt-lbl" style="margin-left:8px">Style</span>' +
            '<select class="gantt-bar-style">' +
              Object.keys(this.BAR_STYLES).map(k =>
                '<option value="' + k + '"' + (state.barStyle === k ? ' selected' : '') + '>' +
                this.BAR_STYLES[k].label + '</option>'
              ).join('') +
            '</select>' +
            '<span class="gantt-grid-toggles">' +
              '<button class="grid-chip' + (state.gridlines.vertical ? ' is-on' : '') +
                '" data-grid="vertical" title="Garis Vertikal">┃</button>' +
              '<button class="grid-chip' + (state.gridlines.horizontal ? ' is-on' : '') +
                '" data-grid="horizontal" title="Garis Horizontal">━</button>' +
              '<button class="grid-chip' + (state.gridlines.workingDaysShading ? ' is-on' : '') +
                '" data-grid="workingDaysShading" title="Shading Hari Libur">░</button>' +
              '<button class="grid-chip' + (state.gridlines.weekSeparator ? ' is-on' : '') +
                '" data-grid="weekSeparator" title="Garis Minggu">┃┃</button>' +
            '</span>' +
            '<span class="gantt-lbl" style="margin-left:8px">Zoom</span>' +
            '<select class="gantt-zoom">' +
              '<option value="hourly"    ' + (zoom==='hourly'    ?'selected':'') + '>Per Jam</option>' +
              '<option value="daily"     ' + (zoom==='daily'     ?'selected':'') + '>Harian</option>' +
              '<option value="weekly"    ' + (zoom==='weekly'    ?'selected':'') + '>Mingguan</option>' +
              '<option value="monthly"   ' + (zoom==='monthly'   ?'selected':'') + '>Bulanan</option>' +
              '<option value="quarterly" ' + (zoom==='quarterly' ?'selected':'') + '>Triwulan</option>' +
              '<option value="yearly"    ' + (zoom==='yearly'    ?'selected':'') + '>Tahunan</option>' +
            '</select>' +
            '<button class="btn btn-sm gantt-btn-today">📍 Hari Ini</button>' +
          '</div>' +
        '</div>' +
        kpiBar +

        '<div class="gantt-filterbar">' +
          '<input class="fb-search" placeholder="Cari task / kode…" value="' + esc(state.filter.search) + '">' +
          '<button class="fb-chip chip-critical' + (state.filter.chips.has('critical')  ? ' active' : '') + '" data-chip="critical">🔥 Kritis</button>' +
          '<button class="fb-chip chip-late'     + (state.filter.chips.has('late')      ? ' active' : '') + '" data-chip="late">⏰ Late</button>' +
          '<button class="fb-chip chip-ms'       + (state.filter.chips.has('milestone') ? ' active' : '') + '" data-chip="milestone">◆ Milestone</button>' +
          '<button class="fb-chip'                + (state.filter.chips.has('summary')   ? ' active' : '') + '" data-chip="summary">▾ Summary</button>' +
          '<span class="fb-lbl" style="margin-left:8px">Group</span>' +
          '<select class="fb-select fb-group">' +
            '<option value="">— Tidak ada —</option>' +
            '<option value="kategori" ' + (state.filter.groupBy === 'kategori' ? 'selected' : '') + '>Kategori</option>' +
            '<option value="kalender" ' + (state.filter.groupBy === 'kalender' ? 'selected' : '') + '>Kalender</option>' +
            '<option value="status"   ' + (state.filter.groupBy === 'status'   ? 'selected' : '') + '>Status (vs Baseline)</option>' +
          '</select>' +
          '<span class="fb-count"><b>' + state.visibleNodes.length + '</b> / ' + state.nodes.length + ' task</span>' +
          '<button class="fb-clear">✕ Reset Filter</button>' +
        '</div>' +

        '<div class="gantt-body">' +
          '<div class="gantt-thead">' +
            this.COLUMNS.map((c, idx) => {
              const cls = c.align === 'right' ? ' right' : c.align === 'center' ? ' center' : '';
              const isLast = idx === this.COLUMNS.length - 1;
              const resize = isLast ? '' : '<div class="gantt-th-resizer" data-col-idx="' + idx + '"></div>';
              const isActiveSort = state.filter.sort.key === c.key;
              const ind = isActiveSort
                ? '<span class="sort-ind">' + (state.filter.sort.dir === 'asc' ? '▲' : '▼') + '</span>'
                : '<span class="sort-ind off">▲</span>';
              return '<div class="gantt-th' + cls + '" data-col-key="' + c.key + '" style="width:' + c.width + 'px">' +
                     esc(c.label) + ind + resize + '</div>';
            }).join('') +
          '</div>' +

          '<div class="gantt-axis-wrap">' +
            '<div class="gantt-axis-track" style="width:' + chartWidth + 'px;height:' + this.AXIS_H + 'px">' +
              '<canvas class="gantt-axis" width="' + chartWidth + '" height="' + this.AXIS_H + '" ' +
                      'style="width:' + chartWidth + 'px;height:' + this.AXIS_H + 'px;display:block"></canvas>' +
            '</div>' +
          '</div>' +

          '<div class="gantt-tbody">' +
            visibleNodes.map((n,i) => this.rowHtml(n,i)).join('') +
          '</div>' +

          '<div class="gantt-bars-wrap">' +
            '<canvas class="gantt-bars" width="' + chartWidth + '" height="' + totalHeight + '" ' +
                    'style="width:' + chartWidth + 'px;height:' + totalHeight + 'px;display:block"></canvas>' +
          '</div>' +
        '</div>' +

        '<div class="gantt-sel-bar">' +
          '<span class="count"><span class="sel-count">0</span> dipilih</span>' +
          '<button class="sel-btn sel-btn-bulk" style="background:linear-gradient(135deg,#2f81f7,#1f6fe0);border-color:transparent;color:#fff">✎ Bulk Edit</button>' +
          '<button class="sel-btn sel-btn-clear">Batal Pilih</button>' +
          '<button class="sel-btn sel-btn-clear-all">Kosongkan Semua</button>' +
        '</div>' +
      '</div>';

    this.drawAxis(state, container.querySelector('.gantt-axis'));
    this.drawBars(state, container.querySelector('.gantt-bars'));
    this.updateSelBar(state);
  },

  /* ═══════════════════════════════════════════════════════════
     DEPENDENCY ARROWS — MS Project Style (Fase 1C)
     Mendukung:
       · Multi-predecessor (via CPM.getRelationships)
       · 4 tipe relasi: FS, SS, FF, SF
       · Arrowhead adaptif (right untuk FS/SS, left untuk FF/SF)
       · Routing orthogonal + detour untuk backward dependency
       · Warna kritis (merah) vs normal (grey-blue)
     ═══════════════════════════════════════════════════════════ */
  drawDependencies(ctx, state, posMap, rowH){
    const {nodes} = state;
    const visibleNodes = state.visibleNodes.filter(n => !n.isGroupHeader);

    // Lookup pred by id ATAU kode_wbs (untuk support referensi dua format)
    const nodeById = {};
    const nodeByKode = {};
    nodes.forEach(n => {
      nodeById[n.id] = n;
      if (n.kode) nodeByKode[String(n.kode).trim()] = n;
    });

    const ARROW         = 7;   // ukuran arrowhead
    const GAP           = 5;   // jarak panah dari tepi bar
    const ROUTE_OFFSET  = 12;  // offset elbow dari bar
    const DETOUR_EXTRA  = 24;  // detour untuk backward dependency

    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.lineCap   = 'round';
    ctx.lineJoin  = 'round';

    // Dedup edge: 1 pasang (pred→succ, type) digambar sekali
    const drawnEdges = new Set();

    visibleNodes.forEach(succNode => {
      if (succNode.isGroupHeader) return;
      const succRaw = succNode.raw || {};
      if (!succRaw.predecessor) return;

      // Ambil SEMUA relasi (multi-predecessor support)
      const rels = CPM.getRelationships(succRaw);
      if (!rels || !rels.length) return;

      const s = posMap[succNode.id];
      if (!s) return;

      rels.forEach(rel => {
        // Resolve predecessor: id → kode_wbs fallback
        const predRef = rel.predRef;
        const predNode = nodeById[predRef] || nodeByKode[String(predRef).trim()];
        if (!predNode) return;

        const p = posMap[predNode.id];
        if (!p) return;

        const type = (rel.type || 'FS').toUpperCase();

        // Dedup key
        const edgeKey = predNode.id + '>' + succNode.id + ':' + type;
        if (drawnEdges.has(edgeKey)) return;
        drawnEdges.add(edgeKey);

        const isCrit = succNode.isCritical || predNode.isCritical;

        // ── Tentukan anchor point per tipe relasi ──
        const pMidY = p.y + rowH / 2;
        const sMidY = s.y + rowH / 2;

        let sx, sy, tx, ty, arrowDir;
        switch (type){
          case 'SS':
            // pred.start → succ.start (exits left)
            sx = p.x1 - GAP;   sy = pMidY;
            tx = s.x1 - GAP;   ty = sMidY;
            arrowDir = 'right';
            break;
          case 'FF':
            // pred.finish → succ.finish (exits right, enters right)
            sx = p.x2 + GAP;   sy = pMidY;
            tx = s.x2 + GAP;   ty = sMidY;
            arrowDir = 'left';
            break;
          case 'SF':
            // pred.start → succ.finish (exits left, enters right)
            sx = p.x1 - GAP;   sy = pMidY;
            tx = s.x2 + GAP;   ty = sMidY;
            arrowDir = 'left';
            break;
          case 'FS':
          default:
            // pred.finish → succ.start (exits right, enters left)
            sx = p.x2 + GAP;   sy = pMidY;
            tx = s.x1 - GAP;   ty = sMidY;
            arrowDir = 'right';
            break;
        }

        // ── Warna per tipe ──
        const strokeColor = isCrit ? '#dc2626' : '#94a3b8';
        ctx.strokeStyle = strokeColor;
        ctx.fillStyle   = strokeColor;

        // ── Gambar path ──
        this._drawDependencyPath(ctx, {
          sx, sy, tx, ty,
          type, arrowDir,
          ARROW, ROUTE_OFFSET, DETOUR_EXTRA,
          srcBar: { x1: p.x1, x2: p.x2, midY: pMidY },
          tgtBar: { x1: s.x1, x2: s.x2, midY: sMidY }
        });
      });
    });
    ctx.restore();
  },

  /* ── Orthogonal routing per tipe relasi ── */
  _drawDependencyPath(ctx, o){
    const { sx, sy, tx, ty, type, arrowDir, ARROW, ROUTE_OFFSET, DETOUR_EXTRA } = o;
    const sameRow = Math.abs(sy - ty) < 2;

    // Titik berhenti garis (sebelum arrowhead)
    const stopX = arrowDir === 'right' ? tx - ARROW : tx + ARROW;

    /* ── KASUS 1: SEBARIS → garis horizontal lurus ── */
    if (sameRow){
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(stopX, ty);
      ctx.stroke();
      this._drawArrowHead(ctx, tx, ty, arrowDir, ARROW);
      return;
    }

    /* ── KASUS 2: BARIS BERBEDA → orthogonal per tipe ── */

    if (type === 'FS'){
      // Finish-to-Start: pred.finish → succ.start
      if (sx < stopX){
        // Forward: exit right pred → elbow tengah → enter left succ
        const midX = (sx + stopX) / 2;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(midX, sy);
        ctx.lineTo(midX, ty);
        ctx.lineTo(stopX, ty);
        ctx.stroke();
      } else {
        // Backward: pred di kanan succ.start → detour kanan
        const detourX = Math.max(sx, stopX) + DETOUR_EXTRA;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(detourX, sy);
        ctx.lineTo(detourX, ty);
        ctx.lineTo(stopX, ty);
        ctx.stroke();
      }
      this._drawArrowHead(ctx, tx, ty, 'right', ARROW);
    }

    else if (type === 'SS'){
      // Start-to-Start: pred.start → succ.start (keduanya di kiri)
      // Detour kiri → geser vertikal → masuk kanan ke succ.start
      const detourX = Math.min(sx, stopX) - ROUTE_OFFSET;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(detourX, sy);
      ctx.lineTo(detourX, ty);
      ctx.lineTo(stopX, ty);
      ctx.stroke();
      this._drawArrowHead(ctx, tx, ty, 'right', ARROW);
    }

    else if (type === 'FF'){
      // Finish-to-Finish: pred.finish → succ.finish (keduanya di kanan)
      // Detour kanan → geser vertikal → masuk kiri ke succ.finish
      const detourX = Math.max(sx, stopX) + ROUTE_OFFSET;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(detourX, sy);
      ctx.lineTo(detourX, ty);
      ctx.lineTo(stopX, ty);
      ctx.stroke();
      this._drawArrowHead(ctx, tx, ty, 'left', ARROW);
    }

    else if (type === 'SF'){
      // Start-to-Finish: pred.start (kiri) → succ.finish (kanan)
      if (sx < stopX){
        // Forward: elbow tengah
        const midX = (sx + stopX) / 2;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(midX, sy);
        ctx.lineTo(midX, ty);
        ctx.lineTo(stopX, ty);
        ctx.stroke();
      } else {
        // Backward: detour kanan
        const detourX = Math.max(sx, stopX) + DETOUR_EXTRA;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.lineTo(detourX, sy);
        ctx.lineTo(detourX, ty);
        ctx.lineTo(stopX, ty);
        ctx.stroke();
      }
      this._drawArrowHead(ctx, tx, ty, 'left', ARROW);
    }
  },

  /* ── Arrowhead: (x,y) adalah TIP (ujung panah) ── */
  _drawArrowHead(ctx, x, y, dir, size){
    ctx.beginPath();
    if (dir === 'right'){
      ctx.moveTo(x, y);
      ctx.lineTo(x - size, y - size * 0.55);
      ctx.lineTo(x - size, y + size * 0.55);
    } else if (dir === 'left'){
      ctx.moveTo(x, y);
      ctx.lineTo(x + size, y - size * 0.55);
      ctx.lineTo(x + size, y + size * 0.55);
    } else if (dir === 'down'){
      ctx.moveTo(x, y);
      ctx.lineTo(x - size * 0.55, y - size);
      ctx.lineTo(x + size * 0.55, y - size);
    } else { // up
      ctx.moveTo(x, y);
      ctx.lineTo(x - size * 0.55, y + size);
      ctx.lineTo(x + size * 0.55, y + size);
    }
    ctx.closePath();
    ctx.fill();
  },

  /* ── Backward-compat: arrowHead lama (base-anchored) ── */
  arrowHead(ctx, x, y, dir, size){
    ctx.beginPath();
    if (dir === 'right'){
      ctx.moveTo(x + size, y);
      ctx.lineTo(x, y - size * 0.55);
      ctx.lineTo(x, y + size * 0.55);
    } else if (dir === 'left'){
      ctx.moveTo(x - size, y);
      ctx.lineTo(x, y - size * 0.55);
      ctx.lineTo(x, y + size * 0.55);
    } else if (dir === 'down'){
      ctx.moveTo(x, y + size);
      ctx.lineTo(x - size * 0.55, y);
      ctx.lineTo(x + size * 0.55, y);
    } else {
      ctx.moveTo(x, y - size);
      ctx.lineTo(x - size * 0.55, y);
      ctx.lineTo(x + size * 0.55, y);
    }
    ctx.closePath();
    ctx.fill();
  },

  /* ─────── ROW HTML ─────── */
  rowHtml(node, idx){
    if (node.isGroupHeader) return this.groupHeaderHtml(node);

    const state = this._state;
    const collapsed = state && state.collapsed ? state.collapsed : new Set();
    const selected  = state && state.selected  ? state.selected  : new Set();
    const isSelected = selected.has(node.id);

    const cls = [
      'gantt-row',
      node.isSummary   ? 'is-summary'  : '',
      node.isCritical  ? 'is-critical' : '',
      node.isMilestone ? 'is-milestone': '',
      isSelected       ? 'is-selected' : ''
    ].filter(Boolean).join(' ');

    const cells = this.COLUMNS.map(c => {
      let inner = '';
      switch (c.key){
        case 'kode': {
          const check = '<span class="gt-check' + (isSelected ? ' is-checked' : '') +
                        '" data-select-id="' + esc(node.id) + '"></span>';
          const badge = '<span class="gt-id-badge" draggable="true" data-drag-id="' + esc(node.id) + '">' +
                        esc(node.kode || '—') + '</span>';
          inner = check + badge;
          break;
        }
        case 'nama': {
          const indent = node.level * 14;
          const tree   = indent > 0 ? '<span class="gt-tree" style="width:' + indent + 'px"></span>' : '';

          let exp = '<span class="gt-expand is-leaf"></span>';
          if (node.isSummary){
            const isCollapsed = collapsed.has(node.id);
            exp = '<span class="gt-expand" data-toggle-id="' + esc(node.id) + '">' +
                  (isCollapsed ? '▸' : '▾') + '</span>';
          }

          const dia  = node.isMilestone ? '<span class="gt-ms">◆</span>' : '';
          const prog = (!node.isSummary && node.progressPct > 0)
                     ? '<span class="gt-prog">' + Math.round(node.progressPct) + '%</span>' : '';
          inner = tree + exp + dia + '<span class="gt-name">' + esc(node.nama) + '</span>' + prog;
          break;
        }
        case 'duration':
          if (node.isMilestone) inner = '<span class="gt-dim">0</span>';
          else inner = '<span class="gt-num">' + (node.duration || 0) + '</span><span class="gt-dim">d</span>';
          break;
        case 'startISO':
        case 'startISO':
        case 'finishISO':
          inner = '<span class="gt-date">' + esc(node[c.key] || '—') + '</span>';
          break;
        case 'variance': {
          const st = this._state;
          if (!st.baselineIdx || !Baseline.isSet(st.proj.id, st.baselineIdx)){
            inner = '<span class="gt-var gt-var-na">—</span>';
          } else if (node.isSummary){
            inner = '<span class="gt-dim">—</span>';
          } else {
            const fF = Baseline.fieldFor(st.baselineIdx, 'finish');
            const bFinish = node.raw[fF] || '';
            if (!bFinish || !node.finishISO){
              inner = '<span class="gt-var gt-var-na">new</span>';
            } else {
              const cal = WorkingCalendar.get(node.raw.calendar_id);
              const slip = WorkingCalendar.diffDays(bFinish, node.finishISO, cal, 'working');
              if (slip > 0){
                inner = '<span class="gt-var gt-var-late">+' + slip + 'd</span>';
              } else if (slip < 0){
                inner = '<span class="gt-var gt-var-early">' + slip + 'd</span>';
              } else {
                inner = '<span class="gt-var gt-var-ok">on time</span>';
              }
            }
          }
          break;
        }
        case 'predecessors':
          inner = node.predecessors
            ? '<span class="gt-pred">' + esc(node.predecessors) + '</span>'
            : '<span class="gt-dim">—</span>';
          break;
        case 'resources':
          inner = node.resources
            ? '<span class="gt-res">' + esc(node.resources) + '</span>'
            : '<span class="gt-dim">—</span>';
          break;
      }

      const justify = c.align === 'right'  ? 'flex-end'
                    : c.align === 'center' ? 'center'
                    : 'flex-start';
      return '<div class="gantt-td" data-col-key="' + c.key + '" ' +
             'style="width:' + c.width + 'px;justify-content:' + justify + '">' +
             inner + '</div>';
    }).join('');

    return '<div class="' + cls + '" data-idx="' + idx + '" data-node-id="' + esc(node.id) + '">' +
           cells + '</div>';
  },

     groupHeaderHtml(node){
    const isCollapsed = node.collapsed;
    return '<div class="gantt-row is-group-header" data-group-name="' + esc(node.groupName) + '">' +
      '<div class="gantt-td" style="width:100%;justify-content:flex-start">' +
        '<span class="gt-group-toggle">' + (isCollapsed ? '▸' : '▾') + '</span>' +
        '<span class="gt-group-name">' + esc(node.groupName) + '</span>' +
        '<span class="gt-group-count">' + node.groupCount + ' task</span>' +
      '</div>' +
    '</div>';
  },

  /* ── AXIS (Fase 2B — Two-tier + multi-zoom) ──
     Tier 1 (atas)   : unit besar (tahun/triwulan/bulan/hari)
     Tier 2 (tengah) : unit kecil (bulan/minggu/hari/jam)
     Tier 3 (bawah)  : label detail (tanggal/jam) — opsional per zoom */
  drawAxis(state, canvas){
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const {startDate, endDate, chartWidth, zoom, cal} = state;
    const H = this.AXIS_H, W = chartWidth;
    const px = state.zoomCfg.pxPerDay;
    const cfg = state.zoomCfg;
    const tier1 = cfg.tier1 || 'month';
    const tier2 = cfg.tier2 || 'week';

    /* ── Background ── */
    ctx.fillStyle = '#0e1a30';
    ctx.fillRect(0, 0, W, H);

    /* ── Helper: offset pixel dari startDate ── */
    const pxOf = (d) => Math.round((d - startDate) / 86400000) * px;
    const pxOfF = (d) => ((d - startDate) / 86400000) * px;   // float (untuk hourly)

    /* ── Shading non-work days (kecuali hourly — terlalu padat) ── */
    if (zoom !== 'hourly'){
      const dSh = new Date(startDate);
      while (dSh <= endDate){
        if (!WorkingCalendar.isWorkDay(dSh, cal)){
          const x = Math.round((dSh - startDate) / 86400000) * px;
          ctx.fillStyle = 'rgba(255,255,255,.025)';
          ctx.fillRect(x, 0, px, H);
        }
        dSh.setDate(dSh.getDate() + 1);
      }
    }

    /* ── Gridlines vertikal per hari (kecuali hourly & yearly, toggle Fase 2C) ── */
    const glA = state.gridlines || { vertical: true };
    if (glA.vertical && zoom !== 'hourly' && zoom !== 'yearly'){
      const dg = new Date(startDate);
      ctx.strokeStyle = 'rgba(36,54,92,.5)';
      ctx.lineWidth = 1;
      while (dg <= endDate){
        const x = Math.round((dg - startDate) / 86400000) * px + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
        dg.setDate(dg.getDate() + 1);
      }
    }

    /* ── Helper: gambar label tier ── */
    const drawTierLabel = (cx, cy, text, isBold, size) => {
      if (cx < -50 || cx > W + 50) return;   // skip offscreen
      ctx.fillStyle = isBold ? '#e6edf7' : '#a8b8d6';
      ctx.font = (isBold ? 'bold ' : '') + (size || 10) + 'px Segoe UI';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, cx, cy);
    };

    /* ── Batas tier vertikal (H = 60) ── */
    const Y_TIER1 = H * 0.22;   // baris atas
    const Y_TIER2 = H * 0.50;   // baris tengah
    const Y_TIER3 = H * 0.80;   // baris bawah

    /* ═══════════════════════════════════════════════════════
       RENDER TIER 1 (Besar): Year / Quarter / Month / Day
       ═══════════════════════════════════════════════════════ */
    if (tier1 === 'year'){
      let y = startDate.getFullYear();
      const yEnd = endDate.getFullYear();
      while (y <= yEnd){
        const d1 = new Date(y, 0, 1);
        const d2 = new Date(y + 1, 0, 1);
        const x1 = pxOfF(d1), x2 = pxOfF(d2);
        const cx = (x1 + x2) / 2;
        // Garis pemisah tahun
        ctx.strokeStyle = '#5a7ab0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(Math.max(0, x1) + 0.5, 0);
        ctx.lineTo(Math.max(0, x1) + 0.5, H);
        ctx.stroke();
        ctx.lineWidth = 1;
        drawTierLabel(cx, Y_TIER1, String(y), true, 12);
        y++;
      }
    }
    else if (tier1 === 'quarter'){
      let d = new Date(startDate.getFullYear(), Math.floor(startDate.getMonth()/3)*3, 1);
      while (d <= endDate){
        const q = Math.floor(d.getMonth() / 3) + 1;
        const dNext = new Date(d.getFullYear(), d.getMonth() + 3, 1);
        const x1 = pxOfF(d), x2 = pxOfF(dNext);
        const cx = (x1 + x2) / 2;
        ctx.strokeStyle = '#5a7ab0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(Math.max(0, x1) + 0.5, 0);
        ctx.lineTo(Math.max(0, x1) + 0.5, H);
        ctx.stroke();
        ctx.lineWidth = 1;
        drawTierLabel(cx, Y_TIER1, 'Q' + q + ' ' + String(d.getFullYear()).slice(-2), true, 11);
        d = dNext;
      }
    }
    else if (tier1 === 'month'){
      let m = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
      while (m <= endDate){
        const mNext = new Date(m.getFullYear(), m.getMonth() + 1, 1);
        const x1 = pxOfF(m), x2 = pxOfF(mNext);
        const cx = (x1 + x2) / 2;
        ctx.strokeStyle = '#5a7ab0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(Math.max(0, x1) + 0.5, 0);
        ctx.lineTo(Math.max(0, x1) + 0.5, H);
        ctx.stroke();
        ctx.lineWidth = 1;
        drawTierLabel(cx, Y_TIER1,
          m.toLocaleDateString('id-ID', {month:'short', year:'2-digit'}).toUpperCase(),
          true, 11);
        m = mNext;
      }
    }
    else if (tier1 === 'day'){
      /* Top tier = day (untuk hourly view) — tampil "Sen 15 Jan" */
      const dd = new Date(startDate);
      while (dd <= endDate){
        const dNext = new Date(dd); dNext.setDate(dNext.getDate() + 1);
        const x1 = pxOfF(dd), x2 = pxOfF(dNext);
        const cx = (x1 + x2) / 2;
        ctx.strokeStyle = '#5a7ab0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x1 + 0.5, 0);
        ctx.lineTo(x1 + 0.5, H);
        ctx.stroke();
        ctx.lineWidth = 1;
        const isWknd = !WorkingCalendar.isWorkDay(dd, cal);
        ctx.fillStyle = isWknd ? '#94a3b8' : '#e6edf7';
        ctx.font = 'bold 11px Segoe UI';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          dd.toLocaleDateString('id-ID', {weekday:'short', day:'2-digit', month:'short'}),
          cx, Y_TIER1
        );
        dd.setDate(dd.getDate() + 1);
      }
    }

    /* ═══════════════════════════════════════════════════════
       RENDER TIER 2 (Kecil): Month / Week / Day / Hour
       ═══════════════════════════════════════════════════════ */
    if (tier2 === 'month'){
      /* Bulan — untuk monthly/quarterly/yearly view */
      const startMonth = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
      const endMonth   = new Date(endDate.getFullYear(), endDate.getMonth() + 1, 1);
      let m = new Date(startMonth);
      while (m <= endMonth){
        const mNext = new Date(m.getFullYear(), m.getMonth() + 1, 1);
        const x1 = pxOfF(m), x2 = pxOfF(mNext);
        const cx = (x1 + x2) / 2;
        ctx.strokeStyle = 'rgba(90,122,176,.7)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x1 + 0.5, H * 0.35);
        ctx.lineTo(x1 + 0.5, H);
        ctx.stroke();
        drawTierLabel(cx, Y_TIER2,
          m.toLocaleDateString('id-ID', {month:'short'}).toUpperCase(), true, 10);
        m = mNext;
      }
    }
    else if (tier2 === 'week'){
      /* Minggu — untuk weekly view */
      const wd = new Date(startDate);
      const dayNr = (wd.getDay() + 6) % 7;
      wd.setDate(wd.getDate() - dayNr);
      while (wd <= endDate){
        const x = Math.round((wd - startDate) / 86400000) * px + 0.5;
        if (x >= 0 && x <= W){
          ctx.strokeStyle = '#3a5590';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x, H * 0.35);
          ctx.lineTo(x, H);
          ctx.stroke();
          ctx.lineWidth = 1;
          ctx.fillStyle = '#a8b8d6';
          ctx.font = 'bold 9px Segoe UI';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText('W' + String(this.isoWeek(wd)).padStart(2,'0'), x + 4, Y_TIER2);
        }
        wd.setDate(wd.getDate() + 7);
      }
    }
    else if (tier2 === 'day'){
      /* Hari — untuk daily view */
      const dd = new Date(startDate);
      while (dd <= endDate){
        const x = Math.round((dd - startDate) / 86400000) * px + 0.5;
        if (x >= 0 && x <= W){
          ctx.strokeStyle = 'rgba(36,54,92,.6)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, H * 0.35);
          ctx.lineTo(x, H);
          ctx.stroke();
          const isWknd = !WorkingCalendar.isWorkDay(dd, cal);
          ctx.fillStyle = isWknd ? '#64748b' : '#a8b8d6';
          ctx.font = '9px Segoe UI';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(dd.getDate()).padStart(2,'0'), x + px/2, Y_TIER3);
        }
        dd.setDate(dd.getDate() + 1);
      }
    }
    else if (tier2 === 'hour'){
      /* Jam — untuk hourly view. Tampil 08:00, 12:00, 16:00 */
      const dd = new Date(startDate);
      while (dd <= endDate){
        const dayStart = new Date(dd); dayStart.setHours(0,0,0,0);
        // Tampil label jam pada jam kerja (8, 12, 16)
        [8, 12, 16].forEach(h => {
          const t = new Date(dayStart); t.setHours(h, 0, 0, 0);
          if (t < startDate || t > endDate) return;
          const x = pxOfF(t);
          if (x < 0 || x > W) return;
          ctx.strokeStyle = 'rgba(36,54,92,.6)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x + 0.5, H * 0.35);
          ctx.lineTo(x + 0.5, H);
          ctx.stroke();
          ctx.fillStyle = '#a8b8d6';
          ctx.font = '9px Segoe UI';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(h).padStart(2,'0') + ':00', x, Y_TIER3);
        });
        dd.setDate(dd.getDate() + 1);
      }
    }

    /* ── Batas bawah axis ── */
    ctx.strokeStyle = '#24365c';
    ctx.beginPath();
    ctx.moveTo(0, H - 0.5);
    ctx.lineTo(W, H - 0.5);
    ctx.stroke();

    /* ── Today marker (garis vertikal orange solid di axis) ── */
    const today = new Date(); today.setHours(0,0,0,0);
    const tOff = Math.round((today - startDate) / 86400000);
    if (tOff >= 0 && tOff <= state.totalDays){
      const x = tOff * px + 0.5;
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
      ctx.lineWidth = 1;
    }
  },

  /* ─────── BARS ─────── */
  drawBars(state, canvas){
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const {startDate, cal} = state;
    const visibleNodes = state.visibleNodes.filter(n => !n.isGroupHeader);
    const px  = state.zoomCfg.pxPerDay;
    const H   = canvas.height, W = canvas.width;
    const rowH = this.ROW_H;

    ctx.clearRect(0, 0, W, H);

    const gl = state.gridlines || { horizontal: true, workingDaysShading: true, vertical: true, weekSeparator: true };

    // A. Row striping
    visibleNodes.forEach((n, i) => {
      if (n.isSummary){
        ctx.fillStyle = 'rgba(47,129,247,.08)';
        ctx.fillRect(0, i*rowH, W, rowH);
      } else if (i % 2 === 0){
        ctx.fillStyle = 'rgba(255,255,255,.015)';
        ctx.fillRect(0, i*rowH, W, rowH);
      }
    });

    // B. Garis horizontal per row (toggle)
    if (gl.horizontal){
      ctx.strokeStyle = 'rgba(60, 90, 130, 0.85)';
      ctx.lineWidth = 1;
      for (let i = 1; i <= visibleNodes.length; i++){
        const y = i * rowH - 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }
    }

    // C. Shading libur (toggle)
    if (gl.workingDaysShading){
      const dShade = new Date(startDate);
      while (dShade <= state.endDate){
        if (!WorkingCalendar.isWorkDay(dShade, cal)){
          const x = Math.round((dShade - startDate) / 86400000) * px;
          ctx.fillStyle = 'rgba(255,255,255,.022)';
          ctx.fillRect(x, 0, px, H);
        }
        dShade.setDate(dShade.getDate() + 1);
      }
    }

    // C.2. Garis vertikal per hari + pemisah minggu (toggle)
    if (gl.vertical || gl.weekSeparator){
      const dv = new Date(startDate);
      while (dv <= state.endDate){
        const dow = dv.getDay();
        const isWeekStart = (dow === 1); // Senin
        const isWorkDay = WorkingCalendar.isWorkDay(dv, cal);

        if (gl.vertical && isWorkDay && !isWeekStart){
          const x = Math.round((dv - startDate) / 86400000) * px + 0.5;
          ctx.strokeStyle = 'rgba(36,54,92,.35)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, H);
          ctx.stroke();
        }
        if (gl.weekSeparator && isWeekStart){
          const x = Math.round((dv - startDate) / 86400000) * px + 0.5;
          ctx.strokeStyle = '#3a5590';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, H);
          ctx.stroke();
          ctx.lineWidth = 1;
        }
        dv.setDate(dv.getDate() + 1);
      }
    }

    // D. Today marker
    const today = new Date(); today.setHours(0,0,0,0);
    const tOff = Math.round((today - startDate) / 86400000);
    if (tOff >= 0 && tOff <= state.totalDays){
      const x = tOff * px + 0.5;
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineWidth = 1;
    }

    // E. Bars
    const posMap = {};
    state.posMap = posMap;

    // Iterate over ALL visible items (including group headers) supaya y benar
    state.visibleNodes.forEach((n, i) => {
      if (n.isGroupHeader) return;   // group header tidak punya bar
      const y = i * rowH;
      if (!n.startISO || !n.finishISO) return;

      const sOff = Math.round((new Date(n.startISO)  - startDate) / 86400000);
      const fOff = Math.round((new Date(n.finishISO) - startDate) / 86400000);

      const x1 = sOff * px;
      const x2 = fOff * px;
      posMap[n.id] = { x1, x2, y, rowIdx: i, w: Math.max(3, x2 - x1) };

      if (n.isMilestone){
        const cx = x1;
        const cy = y + rowH / 2;
        const isComplete = n.progressPct >= 99.9;
        this.diamond(ctx, cx, cy, 8, n.isCritical, isComplete);
        return;
      }
      const w = Math.max(3, x2 - x1);

      if (n.isSummary){
        this.summaryBar(ctx, x1, y + (rowH - 12)/2, w, 12);
      } else {
        const fill   = n.isCritical ? '#dc2626' : '#2f81f7';
        const stroke = n.isCritical ? '#7f1d1d' : '#1f6fe0';
        const cfg    = state.barStyleCfg;
        const barH   = cfg.barH;
        const yBar   = y + (rowH - barH) / 2;
        this.taskBar(ctx, x1, yBar, w, barH, fill, stroke, n.progressPct, cfg);
      }
    });

    // E.2. Baseline shadow bars (MS Project style — solid gray bar di bawah task bar)
    if (state.baselineIdx && Baseline.isSet(state.proj.id, state.baselineIdx)){
      const fS = Baseline.fieldFor(state.baselineIdx, 'start');
      const fF = Baseline.fieldFor(state.baselineIdx, 'finish');
      state.visibleNodes.forEach((n, i) => {
        if (n.isGroupHeader) return;
        if (n.isSummary || n.isMilestone) return;
        const bStart  = n.raw[fS];
        const bFinish = n.raw[fF];
        if (!bStart || !bFinish) return;

        const sOff = Math.round((new Date(bStart)  - startDate) / 86400000);
        const fOff = Math.round((new Date(bFinish) - startDate) / 86400000);
        const bx = sOff * px;
        const bw = Math.max(3, (fOff - sOff) * px);

        /* Baseline bar: di bawah task bar
           Row height 26, task bar bottom = y + (26-14)/2 + 14 = y + 20
           Baseline at y + 20, height 4 (fits in remaining 6px) */
        const by = i * rowH + 20;

        /* Main solid gray body */
        ctx.fillStyle = '#6b7280';
        ctx.fillRect(bx, by, bw, 4);

        /* Dark border atas untuk kontras */
        ctx.fillStyle = '#4b5563';
        ctx.fillRect(bx, by, bw, 1);

        /* End caps tipis untuk member kesan bar solid */
        ctx.fillRect(bx, by, 1.5, 4);
        ctx.fillRect(bx + bw - 1.5, by, 1.5, 4);
      });
    }

    // E.3. Constraint & Manual Badges (Fase 1E)
    state.visibleNodes.forEach((n, i) => {
      if (n.isGroupHeader) return;
      if (n.isSummary || n.isMilestone) return;
      const pos = posMap[n.id];
      if (!pos) return;

      const raw = n.raw || {};
      const schedMode = String(raw.schedule_mode || 'auto').toLowerCase();
      const isManual  = schedMode === 'manual';
      const ct        = String(raw.constraint_type || '').toUpperCase();
      const hasCt     = !!ct;
      const isConflict = num(raw.float_total ?? raw.total_float) < 0;

      if (!isManual && !hasCt && !isConflict) return;

      const midY = pos.y + rowH / 2;
      let bx = pos.x2 + 5;

      /* ── Badge helper ── */
      const drawBadge = (x, label, bg) => {
        ctx.save();
        ctx.font = 'bold 9px Segoe UI';
        const tw = ctx.measureText(label).width;
        const w = tw + 8;
        const h = 11;
        ctx.fillStyle = bg;
        this.rrect(ctx, x, midY - h/2, w, h, 3);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, x + w/2, midY + 0.5);
        ctx.restore();
        return w;
      };

      /* ── Manual badge (purple) ── */
      if (isManual) bx += drawBadge(bx, 'M', 'rgba(168,85,247,.92)') + 3;

      /* ── Conflict badge (red, high-priority) ── */
      if (isConflict){
        bx += drawBadge(bx, '⚠', 'rgba(220,38,38,.92)') + 3;
      }

      /* ── Constraint badge (orange) — tampilkan kode constraint ── */
      if (hasCt && ct.length <= 4){
        bx += drawBadge(bx, ct, 'rgba(245,158,11,.92)') + 3;
      }
    });

    // F. Dependency arrows (Fase 1C — MS Project style)
    this.drawDependencies(ctx, state, posMap, rowH);

    // G. Bar drag ghost
    const bd = state.barDrag;
    if (bd && bd.preview){
      const pos = posMap[bd.nodeId];
      if (pos){
        const gx = bd.preview.x1;
        const gw = bd.preview.w;
        const gy = pos.y + (rowH - 14)/2;
        ctx.save();
        ctx.globalAlpha = .55;
        ctx.fillStyle = bd.isCritical ? '#dc2626' : '#2f81f7';
        this.rrect(ctx, gx, gy, gw, 14, 3);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        this.rrect(ctx, gx, gy, gw, 14, 3);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    }
  },

  /* ── Task bar (MS Project style + Fase 2C presets) ── */
  /* ── Task bar (MS Project style + Fase 2C presets) ── */
  taskBar(ctx, x, y, w, h, fill, stroke, pct, cfg){
    cfg = cfg || this.BAR_STYLES.classic;
    const radius = Math.min(cfg.radius || 3, h/2);

    /* Shadow (Modern/Bold) */
    if (cfg.shadow){
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,.4)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetY = 1;
      ctx.fillStyle = 'rgba(0,0,0,.2)';
      this.rrect(ctx, x + 0.5, y + 1.5, w, h, radius);
      ctx.fill();
      ctx.restore();
    }

    /* Background fill */
    let bgFill;
    if (cfg.gradient){
      const grad = ctx.createLinearGradient(x, y, x, y + h);
      grad.addColorStop(0, this.lighten(fill, 0.15));
      grad.addColorStop(1, this.lighten(fill, 0.55));
      bgFill = grad;
    } else {
      bgFill = this.lighten(fill, 0.55);
    }

    ctx.fillStyle = bgFill;
    this.rrect(ctx, x, y, w, h, radius);
    ctx.fill();

    /* Completed portion */
    if (pct > 0){
      const pw = Math.max(2, w * (pct/100));
      let doneFill;
      if (cfg.gradient){
        const grad2 = ctx.createLinearGradient(x, y, x, y + h);
        grad2.addColorStop(0, fill);
        grad2.addColorStop(1, this.lighten(fill, 0.25));
        doneFill = grad2;
      } else {
        doneFill = fill;
      }
      ctx.fillStyle = doneFill;
      this.rrect(ctx, x, y, pw, h, radius);
      ctx.fill();

      /* Progress Line: garis vertikal hitam di batas completed */
      if (pct < 100 && pw > 3 && w > 8){
        ctx.save();
        ctx.fillStyle = '#0b1220';
        ctx.fillRect(x + pw - 1, y + 1, 2.5, h - 2);
        ctx.restore();
      }
    }

    /* Border */
    if (cfg.border){
      ctx.strokeStyle = stroke;
      ctx.lineWidth = cfg.borderW || 1;
      this.rrect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, radius);
      ctx.stroke();
    }

    /* Label % di tengah bar */
    if (w > 60 && pct > 0){
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 9px Segoe UI';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(Math.round(pct) + '%', x + w/2, y + h/2);
    }
  },

  summaryBar(ctx, x, y, w, h){
    // Fill terang + border terang → KONTRAS di background gelap
    ctx.fillStyle = '#475569';
    ctx.fillRect(x, y, w, h);

    // Border putih tipis atas & bawah
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y + 0.5);
    ctx.lineTo(x + w, y + 0.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y + h - 0.5);
    ctx.lineTo(x + w, y + h - 0.5);
    ctx.stroke();

    // End-cap triangle (kiri bawah)
    ctx.fillStyle = '#94a3b8';
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x + 8, y + h);
    ctx.lineTo(x, y + h + 5);
    ctx.closePath();
    ctx.fill();

    // End-cap triangle (kanan bawah)
    ctx.beginPath();
    ctx.moveTo(x + w, y + h);
    ctx.lineTo(x + w - 8, y + h);
    ctx.lineTo(x + w, y + h + 5);
    ctx.closePath();
    ctx.fill();
  },

  /* ── Milestone diamond (MS Project style) ──
     - Normal milestone   : fill hitam, outline abu
     - Critical milestone : fill merah, outline dark red
     - Complete milestone : fill putih, outline hitam
     Backward compat: kalau arg1 bertipe string → mode lama (arg1 = warna fill) */
  diamond(ctx, cx, cy, r, arg1, arg2){
    let fill, stroke;
    if (typeof arg1 === 'string'){
      // Mode lama
      fill = arg1;
      stroke = '#e6edf7';
    } else {
      const isCritical = !!arg1;
      const isComplete = !!arg2;
      if (isComplete){
        fill = '#e6edf7';       // putih (complete)
        stroke = '#0b1220';     // outline hitam
      } else if (isCritical){
        fill = '#dc2626';       // merah (kritis)
        stroke = '#7f1d1d';     // outline dark red
      } else {
        fill = '#0b1220';       // hitam (normal — MS Project default)
        stroke = '#94a3b8';     // outline abu
      }
    }

    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r, cy);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r, cy);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  },

  rrect(ctx, x, y, w, h, r){
    if (w < 2*r) r = w/2;
    if (h < 2*r) r = h/2;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y,     x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x,     y + h, r);
    ctx.arcTo(x,     y + h, x,     y,     r);
    ctx.arcTo(x,     y,     x + w, y,     r);
    ctx.closePath();
  },

  lighten(hex, amt){
    const c = hex.replace('#','');
    const r = parseInt(c.substr(0,2),16);
    const g = parseInt(c.substr(2,2),16);
    const b = parseInt(c.substr(4,2),16);
    return 'rgb(' +
      Math.round(r + (255-r)*amt) + ',' +
      Math.round(g + (255-g)*amt) + ',' +
      Math.round(b + (255-b)*amt) + ')';
  },

  /* ─────── EVENTS (Fase 1.2) ─────── */
  wireEvents(state){
    const {container} = state;
    const leftBody   = container.querySelector('.gantt-tbody');
    const rightScr   = container.querySelector('.gantt-bars-wrap');
    const axisTrack  = container.querySelector('.gantt-axis-track');
    const zoomSel    = container.querySelector('.gantt-zoom');
    const btnToday   = container.querySelector('.gantt-btn-today');
    const btnExpand  = container.querySelector('.gantt-btn-expand-all');
    const btnCollapse= container.querySelector('.gantt-btn-collapse-all');
    const btnPNG     = container.querySelector('.gantt-btn-export-png');
    const btnPDF     = container.querySelector('.gantt-btn-export-pdf');
    const blSel      = container.querySelector('.gantt-baseline-sel');
    const blSetBtn   = container.querySelector('.gantt-btn-bl-set');
    const blClrBtn   = container.querySelector('.gantt-btn-bl-clear');
    const selBar     = container.querySelector('.gantt-sel-bar');

    if (!leftBody || !rightScr || !axisTrack) return;

    let syncing = false;
    rightScr.addEventListener('scroll', () => {
      axisTrack.style.transform = 'translateX(' + (-rightScr.scrollLeft) + 'px)';
      if (!syncing){ syncing = true; leftBody.scrollTop = rightScr.scrollTop; syncing = false; }
    });
    leftBody.addEventListener('scroll', () => {
      if (syncing) return;
      syncing = true; rightScr.scrollTop = leftBody.scrollTop; syncing = false;
    });

    if (zoomSel) zoomSel.onchange = e => {
      this.mount(state.container, state.proj.id, { mode: state.mode, zoom: e.target.value });
    };

    /* ── Fase 2C: Bar Style dropdown ── */
    const styleSel = container.querySelector('.gantt-bar-style');
    if (styleSel){
      styleSel.onchange = e => {
        const cur = this.loadStyle();
        this.saveStyle(e.target.value, cur.gridlines);
        this.mount(state.container, state.proj.id, { mode: state.mode, zoom: state.zoom });
      };
    }

    /* ── Fase 2C: Gridline toggle chips ── */
    container.querySelectorAll('.grid-chip').forEach(chip => {
      chip.onclick = () => {
        const key = chip.getAttribute('data-grid');
        if (!key) return;
        const cur = this.loadStyle();
        cur.gridlines[key] = !cur.gridlines[key];
        this.saveStyle(cur.barStyle, cur.gridlines);
        this.mount(state.container, state.proj.id, { mode: state.mode, zoom: state.zoom });
      };
    });
    if (btnToday) btnToday.onclick = () => {
      const today = new Date(); today.setHours(0,0,0,0);
      const off = Math.round((today - state.startDate) / 86400000);
      const x = off * state.zoomCfg.pxPerDay;
      rightScr.scrollLeft = Math.max(0, x - rightScr.clientWidth / 2);
      axisTrack.style.transform = 'translateX(' + (-rightScr.scrollLeft) + 'px)';
    };
    if (btnExpand) btnExpand.onclick = () => {
      state.collapsed.clear();
      this.mount(state.container, state.proj.id, { mode: state.mode, zoom: state.zoom });
    };
    if (btnCollapse) btnCollapse.onclick = () => {
      state.collapsed.clear();
      state.nodes.filter(n => n.isSummary).forEach(n => state.collapsed.add(n.id));
      this.mount(state.container, state.proj.id, { mode: state.mode, zoom: state.zoom });
    };

    // Export
    // Export
    // Export
    if (btnPNG) btnPNG.onclick = () => this.exportPNG(state, false);
    if (btnPDF) btnPDF.onclick = () => this.exportPNG(state, true);

    // ── Leveling ──
    const btnLevel = container.querySelector('.gantt-btn-level-open');
    if (btnLevel) btnLevel.onclick = () => {
      Leveling.openUI(state.proj.id);
    };
     
    // ── Baseline controls ──
    if (blSel) blSel.onchange = e => {
      const v = e.target.value;
      state.baselineIdx = v ? parseInt(v, 10) : null;
      container._baselineIdx = state.baselineIdx;
      this.mount(state.container, state.proj.id, { mode: state.mode, zoom: state.zoom });
    };
    if (blSetBtn) blSetBtn.onclick = () => {
      const idx = state.baselineIdx || 1;
      const existing = Baseline.isSet(state.proj.id, idx);
      const msg = existing
        ? 'BL' + idx + ' sudah ada. Timpa dengan jadwal saat ini?'
        : 'Set Baseline BL' + idx + ' dari jadwal saat ini?';
      if (!confirm(msg)) return;
      const r = Baseline.set(state.proj.id, idx);
      if (r.ok){
        state.baselineIdx = idx;
        container._baselineIdx = idx;
        this.mount(state.container, state.proj.id, { mode: state.mode, zoom: state.zoom });
        toast('✅ Baseline BL' + idx + ' disimpan (' + r.count + ' item)');
      } else {
        toast('Gagal: ' + r.msg, false);
      }
    };
    if (blClrBtn) blClrBtn.onclick = () => {
      const idx = state.baselineIdx;
      if (!idx){ toast('Pilih baseline dulu di dropdown', false); return; }
      if (!Baseline.isSet(state.proj.id, idx)){ toast('BL' + idx + ' belum di-set', false); return; }
      if (!confirm('Hapus Baseline BL' + idx + '?')) return;
      Baseline.clear(state.proj.id, idx);
      state.baselineIdx = null;
      container._baselineIdx = null;
      this.mount(state.container, state.proj.id, { mode: state.mode, zoom: state.zoom });
      toast('🗑 Baseline BL' + idx + ' dihapus');
    };

    // ── Expand/Collapse individual ──
    leftBody.addEventListener('click', e => {
      const tog = e.target.closest('[data-toggle-id]');
      if (tog){
        const id = tog.getAttribute('data-toggle-id');
        if (state.collapsed.has(id)) state.collapsed.delete(id);
        else                         state.collapsed.add(id);
        this.mount(state.container, state.proj.id, { mode: state.mode, zoom: state.zoom });
        return;
      }

      // Checkbox click
      const chk = e.target.closest('[data-select-id]');
      if (chk){
        e.stopPropagation();
        const id = chk.getAttribute('data-select-id');
        this.toggleSelect(state, id, e.shiftKey);
        return;
      }

      // Row click (selection)
      const row = e.target.closest('.gantt-row');
      if (row && !e.target.closest('.gt-id-badge')){
        const id = row.getAttribute('data-node-id');
        if (e.ctrlKey || e.metaKey) this.toggleSelect(state, id, false);
        else if (e.shiftKey)         this.rangeSelect(state, id);
        else                         this.singleSelect(state, id);
      }
    });

    // ── Column resize ──
    const thead = container.querySelector('.gantt-thead');
    thead.addEventListener('mousedown', e => {
      const rez = e.target.closest('.gantt-th-resizer');
      if (!rez) return;
      e.preventDefault(); e.stopPropagation();
      this.beginColResize(state, rez, e);
    });

    // ── Row reorder (HTML5 DnD) ──
    leftBody.addEventListener('dragstart', e => {
      const badge = e.target.closest('[data-drag-id]');
      if (!badge) return;
      state.reorderSrc = badge.getAttribute('data-drag-id');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', state.reorderSrc); } catch(err){}
      badge.closest('.gantt-row').classList.add('is-dragging');
    });
    leftBody.addEventListener('dragend', e => {
      container.querySelectorAll('.gantt-row').forEach(r => {
        r.classList.remove('is-dragging','is-drop-above','is-drop-below');
      });
      state.reorderSrc = null;
    });
    leftBody.addEventListener('dragover', e => {
      if (!state.reorderSrc) return;
      e.preventDefault();
      const row = e.target.closest('.gantt-row');
      container.querySelectorAll('.gantt-row').forEach(r => r.classList.remove('is-drop-above','is-drop-below'));
      if (!row) return;
      const rect = row.getBoundingClientRect();
      const isAbove = (e.clientY - rect.top) < rect.height / 2;
      row.classList.add(isAbove ? 'is-drop-above' : 'is-drop-below');
    });
    leftBody.addEventListener('drop', e => {
      if (!state.reorderSrc) return;
      e.preventDefault();
      const row = e.target.closest('.gantt-row');
      if (!row) return;
      const targetId = row.getAttribute('data-node-id');
      const rect = row.getBoundingClientRect();
      const isAbove = (e.clientY - rect.top) < rect.height / 2;
      this.reorderRow(state, state.reorderSrc, targetId, isAbove);
    });

    // ── Bar drag-to-move ──
    this.wireBarDrag(state, rightScr);

    // ── Selection toolbar ──
    const selClear    = container.querySelector('.sel-btn-clear');
    const selClearAll = container.querySelector('.sel-btn-clear-all');
    const selBulk     = container.querySelector('.sel-btn-bulk');
    if (selClear)    selClear.onclick    = () => { state.selected.clear(); this.refreshSelectionUI(state); };
    if (selClearAll) selClearAll.onclick = () => { state.selected.clear(); this.refreshSelectionUI(state); };
    if (selBulk)     selBulk.onclick     = () => {
      BulkEdit.open(Array.from(state.selected));
    };

    // ── Filter bar wiring ──
    const filterBar = container.querySelector('.gantt-filterbar');
    if (filterBar){
      const searchInput = filterBar.querySelector('.fb-search');
      let searchTimer = null;
      if (searchInput){
        searchInput.addEventListener('input', e => {
          clearTimeout(searchTimer);
          const val = e.target.value;
          searchTimer = setTimeout(() => {
            state.filter.search = val;
            container._filter = state.filter;
            this.mount(state.container, state.proj.id, { mode: state.mode, zoom: state.zoom });
          }, 250);
        });
        // Preserve cursor pos after mount
        if (state.filter.search){
          searchInput.focus();
          searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
        }
      }

      filterBar.querySelectorAll('.fb-chip').forEach(chipEl => {
        chipEl.onclick = () => {
          const key = chipEl.getAttribute('data-chip');
          if (!key) return;
          if (state.filter.chips.has(key)) state.filter.chips.delete(key);
          else state.filter.chips.add(key);
          container._filter = state.filter;
          this.mount(state.container, state.proj.id, { mode: state.mode, zoom: state.zoom });
        };
      });

      const groupSel = filterBar.querySelector('.fb-group');
      if (groupSel){
        groupSel.onchange = e => {
          state.filter.groupBy = e.target.value || null;
          container._filter = state.filter;
          this.mount(state.container, state.proj.id, { mode: state.mode, zoom: state.zoom });
        };
      }

      const clearBtn = filterBar.querySelector('.fb-clear');
      if (clearBtn){
        clearBtn.onclick = () => {
          state.filter.search = '';
          state.filter.chips.clear();
          state.filter.sort = { key: null, dir: 'asc' };
          state.filter.groupBy = null;
          state.collapsedGroups.clear();
          container._filter = state.filter;
          container._collapsedGroups = state.collapsedGroups;
          this.mount(state.container, state.proj.id, { mode: state.mode, zoom: state.zoom });
        };
      }
    }

    // ── Sort by column header (mousedown for responsiveness) ──
    const theadEl = container.querySelector('.gantt-thead');
    if (theadEl){
      theadEl.addEventListener('mousedown', e => {
        if (e.target.closest('.gantt-th-resizer')) return;
        if (state._lastResizeAt && Date.now() - state._lastResizeAt < 200) return;
        const th = e.target.closest('.gantt-th[data-col-key]');
        if (!th) return;
        const key = th.getAttribute('data-col-key');
        if (!key) return;
        if (key === 'variance' && !state.baselineIdx) return;
        const cur = state.filter.sort;
        if (cur.key === key){
          if (cur.dir === 'asc') cur.dir = 'desc';
          else { cur.key = null; cur.dir = 'asc'; }
        } else {
          cur.key = key; cur.dir = 'asc';
        }
        container._filter = state.filter;
        this.mount(state.container, state.proj.id, { mode: state.mode, zoom: state.zoom });
      });
    }

    // ── Group header collapse toggle ──
    leftBody.addEventListener('click', e => {
      const toggle = e.target.closest('.gt-group-toggle');
      if (!toggle) return;
      const row = toggle.closest('.gantt-row.is-group-header');
      if (!row) return;
      const name = row.getAttribute('data-group-name');
      if (state.collapsedGroups.has(name)) state.collapsedGroups.delete(name);
      else state.collapsedGroups.add(name);
      container._collapsedGroups = state.collapsedGroups;
      this.mount(state.container, state.proj.id, { mode: state.mode, zoom: state.zoom });
    });

    // ── Tooltip ──
    this.wireTooltip(state, rightScr, axisTrack);

    // Auto-scroll to today
    setTimeout(() => {
      const today = new Date(); today.setHours(0,0,0,0);
      const off = Math.round((today - state.startDate) / 86400000);
      if (off >= 0){
        const x = off * state.zoomCfg.pxPerDay;
        rightScr.scrollLeft = Math.max(0, x - rightScr.clientWidth / 2);
        axisTrack.style.transform = 'translateX(' + (-rightScr.scrollLeft) + 'px)';
      }
    }, 30);
  },

     /* ═══════════════════════════════════════════════════════════
     (a) COLUMN RESIZE
     ═══════════════════════════════════════════════════════════ */
  beginColResize(state, handle, ev){
    const colIdx = parseInt(handle.getAttribute('data-col-idx'), 10);
    const col = this.COLUMNS[colIdx];
    if (!col) return;

    handle.classList.add('is-active');
    const startX = ev.clientX;
    const startW = col.width;
    const minW = 44;
    const maxW = 500;
    const body = document.body;
    const prevCursor = body.style.cursor;
    body.style.cursor = 'col-resize';
    body.style.userSelect = 'none';

    const onMove = e => {
      const delta = e.clientX - startX;
      const newW = Math.max(minW, Math.min(maxW, startW + delta));
      col.width = newW;
      state.colWidths[col.key] = newW;

      // Update header
      const th = handle.parentElement;
      th.style.width = newW + 'px';

      // Update all rows
      const rows = state.container.querySelectorAll('.gantt-row');
      rows.forEach(r => {
        const td = r.querySelector('.gantt-td[data-col-key="' + col.key + '"]');
        if (td) td.style.width = newW + 'px';
      });

      // Update grid table width
      const root = state.container.querySelector('.gantt-root');
      root.style.setProperty('--gantt-table-w', this.tableWidth() + 'px');
    };

    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      handle.classList.remove('is-active');
      body.style.cursor = prevCursor;
      body.style.userSelect = '';
      this.saveColWidths(state.colWidths);
      state._lastResizeAt = Date.now();   // ← NEW: blokir sort setelah resize
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  },

  /* ═══════════════════════════════════════════════════════════
     (b) ROW REORDER
     ═══════════════════════════════════════════════════════════ */
  reorderRow(state, srcId, targetId, before){
    if (srcId === targetId) return;

    const src = DB.project_wbs.find(w => w.id === srcId);
    const tgt = DB.project_wbs.find(w => w.id === targetId);
    if (!src || !tgt) return;

    // Hanya boleh reorder kalau parent sama
    if ((src.parent_id || '') !== (tgt.parent_id || '')){
      toast('Hanya bisa reorder item dengan induk (parent) yang sama', false);
      return;
    }

    // Rebuild ordered siblings
    const siblings = DB.project_wbs
      .filter(w => (w.parent_id || '') === (src.parent_id || '') && w.project_id === state.proj.id)
      .sort((a,b) => (a.urut||0) - (b.urut||0));

    const fromIdx = siblings.findIndex(w => w.id === srcId);
    if (fromIdx < 0) return;
    siblings.splice(fromIdx, 1);

    let toIdx = siblings.findIndex(w => w.id === targetId);
    if (toIdx < 0) toIdx = siblings.length;
    if (!before) toIdx += 1;
    siblings.splice(toIdx, 0, src);

    // Renumber
    if (typeof Undo !== 'undefined') Undo.snapshot('Reorder: ' + (src.kode_wbs || '') + ' → ' + (tgt.kode_wbs || ''));
    siblings.forEach((w, i) => { w.urut = i + 1; });
    saveDB();
    this.mount(state.container, state.proj.id, { mode: state.mode, zoom: state.zoom });
    toast('Urutan WBS diperbarui');
  },

  /* ═══════════════════════════════════════════════════════════
     (c) EXPORT PNG / PDF
     ═══════════════════════════════════════════════════════════ */
  exportPNG(state, asPDF){
    const axis = state.container.querySelector('.gantt-axis');
    const bars = state.container.querySelector('.gantt-bars');
    if (!axis || !bars) { toast('Canvas belum siap', false); return; }

    const W = state.chartWidth;
    const H = this.AXIS_H + state.totalHeight;
    const out = document.createElement('canvas');
    out.width = W;
    out.height = H;
    const ctx = out.getContext('2d');

    // Background
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, W, H);

    // Axis di atas
    ctx.drawImage(axis, 0, 0, W, this.AXIS_H);
    // Bars di bawah
    ctx.drawImage(bars, 0, this.AXIS_H, W, state.totalHeight);

    // Footer watermark
    ctx.fillStyle = '#3a5590';
    ctx.font = 'bold 12px Segoe UI';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText('Manajemen Konstruksi v1 — ' + state.proj.kode + ' — ' + today(), W - 12, H - 6);

    const dataURL = out.toDataURL('image/png');

    if (asPDF){
      const w = window.open('', '_blank');
      if (!w){ toast('Popup diblokir browser', false); return; }
      w.document.write(
        '<html><head><title>Gantt ' + esc(state.proj.kode) + '</title>' +
        '<style>@page{size:landscape;margin:10mm}body{margin:0;background:#fff}' +
        'img{width:100%;height:auto;display:block}</style></head>' +
        '<body><img src="' + dataURL + '">' +
        '<script>window.onload=function(){setTimeout(function(){window.print()},300)}<\/script>' +
        '</body></html>'
      );
      w.document.close();
      toast('PDF window dibuka — pilih "Save as PDF"');
    } else {
      const a = document.createElement('a');
      a.href = dataURL;
      a.download = 'gantt-' + state.proj.kode + '-' + today() + '.png';
      a.click();
      toast('PNG berhasil diexport');
    }
  },

  /* ═══════════════════════════════════════════════════════════
     (d) ROW SELECTION
     ═══════════════════════════════════════════════════════════ */
  singleSelect(state, id){
    state.selected.clear();
    state.selected.add(id);
    this.refreshSelectionUI(state);
  },
  toggleSelect(state, id, additive){
    if (!additive && state.selected.size === 1 && state.selected.has(id)){
      state.selected.clear();
    } else if (state.selected.has(id)){
      state.selected.delete(id);
    } else {
      state.selected.add(id);
    }
    this.refreshSelectionUI(state);
  },
  rangeSelect(state, id){
    const list = state.visibleNodes.map(n => n.id);
    const toIdx = list.indexOf(id);
    if (toIdx < 0) return;
    let anchor = list.findIndex(x => state.selected.has(x));
    if (anchor < 0) anchor = toIdx;
    const [a, b] = anchor <= toIdx ? [anchor, toIdx] : [toIdx, anchor];
    state.selected.clear();
    for (let i = a; i <= b; i++) state.selected.add(list[i]);
    this.refreshSelectionUI(state);
  },
  refreshSelectionUI(state){
    // Update checkboxes
    state.container.querySelectorAll('.gt-check[data-select-id]').forEach(el => {
      const id = el.getAttribute('data-select-id');
      el.classList.toggle('is-checked', state.selected.has(id));
    });
    // Update row highlight
    state.container.querySelectorAll('.gantt-row').forEach(r => {
      const id = r.getAttribute('data-node-id');
      r.classList.toggle('is-selected', state.selected.has(id));
    });
    this.updateSelBar(state);
  },
  updateSelBar(state){
    const bar = state.container.querySelector('.gantt-sel-bar');
    if (!bar) return;
    const cnt = state.selected.size;
    bar.classList.toggle('show', cnt > 0);
    const el = bar.querySelector('.sel-count');
    if (el) el.textContent = cnt;
  },

  /* ═══════════════════════════════════════════════════════════
     (e) BAR DRAG-TO-MOVE
     ═══════════════════════════════════════════════════════════ */
  wireBarDrag(state, rightScr){
    const canvas = state.container.querySelector('.gantt-bars');
    if (!canvas) return;

    const hitTest = (clientX, clientY) => {
      const rect = canvas.getBoundingClientRect();
      const cy = clientY - rect.top;
      const rowIdx = Math.floor(cy / this.ROW_H);
      if (rowIdx < 0 || rowIdx >= state.visibleNodes.length) return null;
      const node = state.visibleNodes[rowIdx];
      if (!node || !node.startISO) return null;
      const pos = state.posMap[node.id];
      if (!pos) return null;
      const cx = clientX - rect.left;
      // Hit horizontal: bar + 4px toleransi
      if (cx < pos.x1 - 4 || cx > pos.x2 + 4) return null;
      // Hit vertikal: hanya area bar (bukan seluruh row)
      const barTop = pos.y + (this.ROW_H - 14) / 2;
      const barBot = barTop + 14;
      if (cy < barTop - 3 || cy > barBot + 3) return null;
      return { node, pos };
    };

    rightScr.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      const hit = hitTest(e.clientX, e.clientY);
      if (!hit) return;
      if (hit.node.isSummary) return;  // summary tidak bisa di-drag

      e.preventDefault();
      state.barDrag = {
        nodeId: hit.node.id,
        node: hit.node,
        startMouseX: e.clientX,
        origStartISO: hit.node.startISO,
        origFinishISO: hit.node.finishISO,
        startDateSnapshot: new Date(state.startDate),
        pxPerDay: state.zoomCfg.pxPerDay,
        isCritical: hit.node.isCritical,
        preview: null
      };
      state.container.querySelector('.gantt-bars-wrap').classList.add('is-dragging-bar');

      const onMove = ev => {
        const bd = state.barDrag;
        if (!bd) return;
        const dx = ev.clientX - bd.startMouseX;
        // Untuk zoom sangat kecil (yearly/quarterly), pakai pendekatan berbeda
        const pxPerDay = state.zoomCfg.pxPerDay;
        const deltaDays = Math.round(dx / Math.max(2, pxPerDay));
        bd.deltaDays = deltaDays;
        const sOff = Math.round((new Date(bd.origStartISO)  - state.startDate) / 86400000);
        const fOff = Math.round((new Date(bd.origFinishISO) - state.startDate) / 86400000);
        bd.preview = {
          x1: (sOff + deltaDays) * bd.pxPerDay,
          w: Math.max(3, (fOff - sOff) * bd.pxPerDay)
        };
        this.drawBars(state, canvas);
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        state.container.querySelector('.gantt-bars-wrap').classList.remove('is-dragging-bar');

        const bd = state.barDrag;
        state.barDrag = null;
        if (!bd || !bd.deltaDays) { this.drawBars(state, canvas); return; }

        // Hitung tanggal baru — snap ke hari kerja
        const origStart = new Date(bd.origStartISO + 'T00:00:00');
        const wbsItem = DB.project_wbs.find(w => w.id === bd.nodeId);
        if (!wbsItem){ this.drawBars(state, canvas); return; }
        if (typeof Undo !== 'undefined') Undo.snapshot('Drag bar: ' + (wbsItem.kode_wbs || ''));

        const cal = WorkingCalendar.get(wbsItem.calendar_id || state.proj.calendar_id);
        const snapped = WorkingCalendar.addWorkDays(origStart, bd.deltaDays, cal);
        const newStartISO = WorkingCalendar.fmt(snapped);

        // Terapkan sebagai constraint SNET (Start No Earlier Than)
        writeScheduleField(wbsItem, 'constraint_type', 'SNET');
        writeScheduleField(wbsItem, 'constraint_date', newStartISO);

        runCPM(state.proj.id);
        saveDB();
        this.mount(state.container, state.proj.id, { mode: state.mode, zoom: state.zoom });
        toast('Jadwal ' + (wbsItem.kode_wbs || '') + ' diubah → ' + newStartISO);
      };

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    // Cursor hint
    rightScr.addEventListener('mousemove', e => {
      if (state.barDrag) return;
      const hit = hitTest(e.clientX, e.clientY);
      rightScr.classList.toggle('is-over-bar', !!hit);
    });
  },

     /* Hover tooltip pada bar chart */
  wireTooltip(state, rightScr, axisTrack){
    const {container, visibleNodes} = state;
    const canvas = container.querySelector('.gantt-bars');
    if (!canvas) return;

    // Buat elemen tooltip sekali
    let tip = container.querySelector('.gt-tip');
    if (!tip){
      tip = document.createElement('div');
      tip.className = 'gt-tip';
      container.querySelector('.gantt-root').appendChild(tip);
    }

    const showTip = (node, e) => {
      const crit = node.isCritical;
      const kind = node.isSummary ? 'SUMMARY' : node.isMilestone ? 'MILESTONE' : 'TASK';
      const kindCls = node.isSummary ? 'sum' : node.isMilestone ? 'ms' : (crit ? 'crit' : '');
      const floatVal = node.raw && (node.raw.float_total ?? node.raw.total_float);
      const pred = node.predecessors || '—';
      const res  = node.resources || '—';

      tip.innerHTML =
        '<div class="gt-tip-title">' +
          '<span class="gt-tip-badge ' + kindCls + '">' + kind + '</span>' +
          '<span class="gt-tip-kode">' + esc(node.kode) + '</span>' +
        '</div>' +
        '<div style="font-weight:700;margin-bottom:6px;color:#e6edf7">' + esc(node.nama) + '</div>' +
        '<div class="gt-tip-row"><span class="k">Mulai</span><span class="v">' + esc(node.startISO || '—') + '</span></div>' +
        '<div class="gt-tip-row"><span class="k">Selesai</span><span class="v">' + esc(node.finishISO || '—') + '</span></div>' +
        '<div class="gt-tip-row"><span class="k">Durasi</span><span class="v">' + (node.duration || 0) + ' hari</span></div>' +
        (node.isSummary ? '' : '<div class="gt-tip-row"><span class="k">Progress</span><span class="v">' + Math.round(node.progressPct || 0) + '%</span></div>') +
        (floatVal != null ? '<div class="gt-tip-row"><span class="k">Total Float</span><span class="v' + (crit?' crit':'') + '">' + floatVal + ' hari' + (crit?' ★':'') + '</span></div>' : '') +
        '<div class="gt-tip-row"><span class="k">Predecessor</span><span class="v">' + esc(pred) + '</span></div>' +
        '<div class="gt-tip-row" style="align-items:flex-start;margin-top:6px"><span class="k">Resources</span><span class="v" style="max-width:180px;text-align:right;font-weight:400;color:#a8b8d6">' + esc(res) + '</span></div>';

      const rect = container.getBoundingClientRect();
      let left = e.clientX - rect.left + 14;
      let top  = e.clientY - rect.top + 14;

      // Cegah overflow kanan/bawah
      const tipW = 280, tipH = 220;
      if (left + tipW > rect.width)  left = e.clientX - rect.left - tipW - 14;
      if (top  + tipH > rect.height) top  = rect.height - tipH - 8;
      if (left < 8) left = 8;
      if (top  < 8) top  = 8;

      tip.style.left = left + 'px';
      tip.style.top  = top  + 'px';
      tip.classList.add('show');
    };

    const hideTip = () => tip.classList.remove('show');

    rightScr.addEventListener('mousemove', e => {
      if (state.barDrag){ hideTip(); return; }   // ← tambah baris ini
      const rect = canvas.getBoundingClientRect();
      // Koordinat relatif ke canvas
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;

      if (cx < 0 || cy < 0 || cx > rect.width || cy > rect.height){ hideTip(); return; }

      const rowIdx = Math.floor(cy / this.ROW_H);
      if (rowIdx < 0 || rowIdx >= visibleNodes.length){ hideTip(); return; }

      const node = visibleNodes[rowIdx];
      if (!node || node.isGroupHeader){ hideTip(); return; }

      showTip(node, e);
    });

    rightScr.addEventListener('mouseleave', hideTip);
  }
};

/* =====================================================================
   BAGIAN 9D — RESOURCE HISTOGRAM
   Kebutuhan harian/periodik per resource + garis kapasitas
   ===================================================================== */
const ResourceHistogram = {
  render(projectId, canvasEl, resourceKode, granularity){
    if (!canvasEl || !resourceKode) return;
    granularity = granularity || 'daily';

    const rl = ResourceLoader.load(projectId, {mode:'rab', granularity});
    if (!rl.ok) return;

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
    const capBucket = granularity === 'daily'  ? cap
                    : granularity === 'weekly' ? cap * 5
                    : cap * 22;

    const datasets = [{
      label: 'Kebutuhan ' + (info?.nama || resourceKode) +
             ' (' + (info?.satuan || '') + ')',
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
            callbacks: { label: c => c.dataset.label + ': ' + fmt(c.parsed.y, 2) }
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

/* =====================================================================
   BAGIAN 9E — OVER-ALLOCATION DETECTOR
   Bandingkan kebutuhan harian vs kapasitas_harian per resource
   ===================================================================== */
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
   BAGIAN 9E.2 — CONFLICT DETECTOR (Fase 1E)
   Deteksi konflik jadwal: Manual vs Predecessor, Constraint Ketat, Negative Float
   ===================================================================== */
const ConflictDetector = {
  /**
   * Deteksi semua konflik jadwal untuk sebuah proyek.
   * Return: { ok, conflicts: [], count }
   * Setiap conflict: { type, severity, taskId, kode, uraian, message, detail }
   */
  detect(projectId){
    const proj = DB.projects.find(p => p.id === projectId);
    if (!proj) return { ok: false, error: 'Proyek tidak ditemukan', conflicts: [] };

    const items = DB.project_wbs.filter(w =>
      w.project_id === projectId && !w.is_group
    );
    if (!items.length) return { ok: true, conflicts: [], count: 0 };

    const byId = {}, byKode = {};
    items.forEach(it => {
      byId[it.id] = it;
      if (it.kode_wbs) byKode[String(it.kode_wbs).trim()] = it;
    });

    const conflicts = [];

    /* ═══ 1. NEGATIVE FLOAT ═══ */
    items.forEach(it => {
      const flt = num(it.float_total ?? it.total_float);
      if (flt < 0){
        conflicts.push({
          type: 'NEGATIVE_FLOAT',
          severity: 'high',
          taskId: it.id,
          kode: it.kode_wbs || '?',
          uraian: it.uraian || '',
          message: 'Total Float negatif (' + flt + ' hari) — jadwal tidak mungkin dengan constraint saat ini.',
          detail: 'Constraint dan predecessor saling bertentangan, sehingga task tidak dapat dijadwalkan tepat waktu.'
        });
      }
    });

    /* ═══ 2. MANUAL TASK vs PREDECESSOR ═══ */
    items.forEach(it => {
      if (CPM.getScheduleMode(it) !== 'manual') return;
      if (!it.manual_start) return;
      const rels = CPM.getRelationships(it);
      if (!rels.length) return;

      const cal = WorkingCalendar.get(it.calendar_id || proj.calendar_id);
      const mStart = CPM._parseDate(it.manual_start);
      if (!mStart) return;

      rels.forEach(rel => {
        const pred = byId[rel.predRef] || byKode[String(rel.predRef).trim()];
        if (!pred) return;

        const predEF = pred.tgl_selesai_rencana ? CPM._parseDate(pred.tgl_selesai_rencana) : null;
        const predES = pred.tgl_mulai_rencana   ? CPM._parseDate(pred.tgl_mulai_rencana)   : null;

        let minStart = null;
        if (rel.type === 'FS' && predEF){
          minStart = WorkingCalendar.addWorkDays(predEF, rel.lag, cal);
        } else if (rel.type === 'SS' && predES){
          minStart = WorkingCalendar.addWorkDays(predES, rel.lag, cal);
        }

        if (minStart && mStart < minStart){
          const lagLabel = rel.lag !== 0
            ? (rel.lag > 0 ? '+' + rel.lag : String(rel.lag)) + 'd'
            : '';
          conflicts.push({
            type: 'MANUAL_PRED_CONFLICT',
            severity: 'warn',
            taskId: it.id,
            kode: it.kode_wbs || '?',
            uraian: it.uraian || '',
            message: 'Manual start (' + it.manual_start + ') lebih awal dari yang diizinkan predecessor ' +
                     pred.kode_wbs + ' (' + WorkingCalendar.fmt(minStart) + ').',
            detail: 'Relasi ' + rel.type + lagLabel + ' — task manual mengabaikan logika predecessor. ' +
                    'Successor mungkin akan bergeser karena task ini dipatok di tanggal manual.'
          });
        }
      });
    });

    /* ═══ 3. CONSTRAINT KETAT (MSO / MFO / FNLT) vs PREDECESSOR ═══ */
    items.forEach(it => {
      const ct = String(it.constraint_type || '').toUpperCase();
      if (!['MSO', 'MFO', 'SNLT', 'FNLT'].includes(ct)) return;
      const cd = it.constraint_date ? CPM._parseDate(it.constraint_date) : null;
      if (!cd) return;

      const rels = CPM.getRelationships(it);
      if (!rels.length) return;

      const cal = WorkingCalendar.get(it.calendar_id || proj.calendar_id);

      rels.forEach(rel => {
        const pred = byId[rel.predRef] || byKode[String(rel.predRef).trim()];
        if (!pred) return;

        /* MSO: start dipatok → cek apakah predecessor masih mengizinkan */
        if (ct === 'MSO' && rel.type === 'FS'){
          const predEF = pred.tgl_selesai_rencana ? CPM._parseDate(pred.tgl_selesai_rencana) : null;
          if (!predEF) return;
          const minStart = WorkingCalendar.addWorkDays(predEF, rel.lag, cal);
          if (cd < minStart){
            conflicts.push({
              type: 'MSO_PRED_CONFLICT',
              severity: 'high',
              taskId: it.id,
              kode: it.kode_wbs || '?',
              uraian: it.uraian || '',
              message: 'MSO (' + it.constraint_date + ') lebih awal dari minimum start dari predecessor ' +
                       pred.kode_wbs + ' (' + WorkingCalendar.fmt(minStart) + ').',
              detail: 'Constraint MSO memaksa task mulai sebelum predecessor selesai — akan memicu negative float.'
            });
          }
        }

        /* FNLT: finish dipatok → cek apakah task bisa selesai tepat waktu */
        if (ct === 'FNLT'){
          const curFinish = it.tgl_selesai_rencana ? CPM._parseDate(it.tgl_selesai_rencana) : null;
          if (curFinish && curFinish > cd){
            conflicts.push({
              type: 'FNLT_PRED_CONFLICT',
              severity: 'warn',
              taskId: it.id,
              kode: it.kode_wbs || '?',
              uraian: it.uraian || '',
              message: 'Finish (' + it.tgl_selesai_rencana + ') melebihi constraint FNLT (' + it.constraint_date + ').',
              detail: 'Task tidak dapat diselesaikan sesuai batas waktu yang diinginkan.'
            });
          }
        }
      });
    });

    /* ═══ 4. MANUAL TASK vs SUCCESSOR ═══ */
    items.forEach(it => {
      if (CPM.getScheduleMode(it) !== 'manual') return;
      if (!it.manual_finish) return;

      const mFinish = CPM._parseDate(it.manual_finish);
      if (!mFinish) return;
      const cal = WorkingCalendar.get(it.calendar_id || proj.calendar_id);

      items.forEach(succ => {
        if (succ.id === it.id) return;
        const succRels = CPM.getRelationships(succ);
        succRels.forEach(rel => {
          const refTask = byId[rel.predRef] || byKode[String(rel.predRef).trim()];
          if (!refTask || refTask.id !== it.id) return;

          if (rel.type === 'FS' && succ.tgl_mulai_rencana){
            const succStart = CPM._parseDate(succ.tgl_mulai_rencana);
            if (!succStart) return;
            const minSuccStart = WorkingCalendar.addWorkDays(mFinish, rel.lag, cal);
            if (succStart < minSuccStart){
              conflicts.push({
                type: 'MANUAL_SUCC_CONFLICT',
                severity: 'warn',
                taskId: it.id,
                kode: it.kode_wbs || '?',
                uraian: it.uraian || '',
                message: 'Successor ' + succ.kode_wbs + ' mulai (' + succ.tgl_mulai_rencana +
                         ') sebelum manual finish task ini (' + it.manual_finish + ').',
                detail: 'Successor mungkin tidak menghormati tanggal manual atau akan memicu slack negatif.'
              });
            }
          }
        });
      });
    });

    /* ── Dedup by (type + taskId) ── */
    const seen = new Set();
    const filtered = conflicts.filter(c => {
      const key = c.type + '::' + c.taskId;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    /* ── Sort: high → warn → info ── */
    const ord = { high: 0, warn: 1, info: 2 };
    filtered.sort((a, b) => (ord[a.severity] ?? 99) - (ord[b.severity] ?? 99));

    return { ok: true, conflicts: filtered, count: filtered.length };
  }
};

/* ── Helper: HTML kartu konflik (dipakai di renderSchedule) ── */
function renderConflictCard(c){
  const sev = c.severity || 'warn';
  const cls = sev === 'high' ? '' : sev === 'warn' ? 'warn' : 'info';
  const ico = sev === 'high' ? '🔴' : sev === 'warn' ? '🟡' : 'ℹ';
  return '<div class="conflict-card ' + cls + '" data-conflict-task="' + esc(c.taskId) + '">' +
    '<span>' + ico + '</span>' +
    '<div style="flex:1">' +
      '<b>' + esc(c.kode) + ' — ' + esc(c.uraian) + '</b>' +
      '<div style="font-size:11.5px;margin-top:4px">' + esc(c.message) + '</div>' +
      '<div style="font-size:10.5px;color:var(--muted);margin-top:3px">' + esc(c.detail || '') + '</div>' +
    '</div>' +
  '</div>';
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
        `%c[${mode.toUpperCase()} / ${dist}]%c total=${rp(tot)} | buckets=${r.buckets.length}`,
        'color:#1abc9c;font-weight:bold', 'color:#e6edf7'
      );
    });
  });

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
   BAGIAN 9F — UNDO / REDO ENGINE (Fase 4C)
   ===================================================================== */
const Undo = {
  STACK_MAX: 25,
  undoStack: [],
  redoStack: [],
  listeners: [],
  _silent: false,

  snapshot(label){
    if (this._silent) return;
    const snap = {
      label: label || 'Perubahan',
      ts: Date.now(),
      wbs: JSON.parse(JSON.stringify(DB.project_wbs)),
      progress: JSON.parse(JSON.stringify(DB.progress))
    };
    this.undoStack.push(snap);
    if (this.undoStack.length > this.STACK_MAX) this.undoStack.shift();
    this.redoStack = [];
    this.notify();
  },

  undo(){
    if (!this.undoStack.length) return false;
    this.redoStack.push({
      label: 'Redo point',
      ts: Date.now(),
      wbs: JSON.parse(JSON.stringify(DB.project_wbs)),
      progress: JSON.parse(JSON.stringify(DB.progress))
    });
    const snap = this.undoStack.pop();
    DB.project_wbs = snap.wbs;
    DB.progress    = snap.progress;
    saveDB();
    this.notify();
    return snap.label;
  },

  redo(){
    if (!this.redoStack.length) return false;
    this.undoStack.push({
      label: 'Undo point',
      ts: Date.now(),
      wbs: JSON.parse(JSON.stringify(DB.project_wbs)),
      progress: JSON.parse(JSON.stringify(DB.progress))
    });
    const snap = this.redoStack.pop();
    DB.project_wbs = snap.wbs;
    DB.progress    = snap.progress;
    saveDB();
    this.notify();
    return true;
  },

  clear(){ this.undoStack = []; this.redoStack = []; this.notify(); },
  notify(){ this.listeners.forEach(fn => { try { fn(); } catch(e){} }); },
  onChange(fn){ this.listeners.push(fn); return () => {
    const i = this.listeners.indexOf(fn);
    if (i >= 0) this.listeners.splice(i,1);
  }; }
};

/* =====================================================================
   BAGIAN 9G — BULK EDIT (Fase 4C)
   ===================================================================== */
const BulkEdit = {
  open(ids){
    if (!ids || !ids.length){ toast('Tidak ada task terpilih', false); return; }
    const items = DB.project_wbs.filter(w => ids.includes(w.id) && !w.is_group);
    if (!items.length){ toast('Tidak ada task (non-summary) terpilih', false); return; }

    const calOpts = '<option value="">— Jangan ubah —</option>' +
      (DB.working_calendars || []).map(c =>
        '<option value="' + c.id + '">' + esc(c.kode) + ' — ' + esc(c.nama) + '</option>'
      ).join('');

    const ctOpts = '<option value="">— Jangan ubah —</option>' +
      Object.keys(CONSTRAINT_TYPES).map(k =>
        '<option value="' + k + '">' + k + ' — ' + CONSTRAINT_TYPES[k] + '</option>'
      ).join('') +
      '<option value="__none__">❌ Hapus constraint</option>';

    const body =
      '<div class="bulk-summary">✎ <b>' + items.length + ' task</b> akan diubah. Operasi yang dicentang akan diterapkan.</div>' +

      '<div class="bulk-opt-row">' +
        '<input type="checkbox" id="bulk_dur_en">' +
        '<label for="bulk_dur_en">Set Duration</label>' +
        '<div class="bulk-field"><input type="number" id="bulk_dur_val" min="1" step="1" value="1" disabled><span class="gt-dim">hari</span></div>' +
      '</div>' +

      '<div class="bulk-opt-row">' +
        '<input type="checkbox" id="bulk_cal_en">' +
        '<label for="bulk_cal_en">Ubah Kalender</label>' +
        '<div class="bulk-field"><select id="bulk_cal_val" disabled>' + calOpts + '</select></div>' +
      '</div>' +

      '<div class="bulk-opt-row">' +
        '<input type="checkbox" id="bulk_ct_en">' +
        '<label for="bulk_ct_en">Set Constraint</label>' +
        '<div class="bulk-field" style="flex-direction:column;align-items:stretch;gap:4px;min-width:220px">' +
          '<select id="bulk_ct_val" disabled>' + ctOpts + '</select>' +
          '<input type="date" id="bulk_ct_date" disabled style="width:100%">' +
        '</div>' +
      '</div>' +

      '<div class="bulk-opt-row">' +
        '<input type="checkbox" id="bulk_shift_en">' +
        '<label for="bulk_shift_en">Geser jadwal</label>' +
        '<div class="bulk-field">' +
          '<input type="number" id="bulk_shift_val" step="1" value="1" disabled>' +
          '<span class="gt-dim">hari kerja (' +
            '<a href="javascript:void(0)" id="bulk_shift_dir" style="color:#7cb3ff;font-weight:700;text-decoration:underline">+</a>)' +
          '</span>' +
        '</div>' +
      '</div>' +

      '<div class="bulk-opt-row">' +
        '<input type="checkbox" id="bulk_clrpred_en">' +
        '<label for="bulk_clrpred_en">Hapus Predecessor (jadi mulai bebas)</label>' +
        '<div class="bulk-field"></div>' +
      '</div>' +

      '<div class="bulk-opt-row">' +
        '<input type="checkbox" id="bulk_lag_en">' +
        '<label for="bulk_lag_en">Set Lag Predecessor</label>' +
        '<div class="bulk-field"><input type="number" id="bulk_lag_val" step="1" value="0" disabled><span class="gt-dim">hari</span></div>' +
      '</div>' +

      '<div class="bulk-opt-row">' +
        '<input type="checkbox" id="bulk_resetfloat_en">' +
        '<label for="bulk_resetfloat_en">Reset CPM (recalculate setelahnya)</label>' +
        '<div class="bulk-field"></div>' +
      '</div>';

    // Signal "shift dir" toggle — default +1
    let shiftDir = 1;

    openModal('✎ Bulk Edit — ' + items.length + ' task terpilih', body, () => {
      const apply = {
        dur: document.getElementById('bulk_dur_en').checked,
        cal: document.getElementById('bulk_cal_en').checked,
        ct:  document.getElementById('bulk_ct_en').checked,
        shift: document.getElementById('bulk_shift_en').checked,
        clrpred: document.getElementById('bulk_clrpred_en').checked,
        lag: document.getElementById('bulk_lag_en').checked,
        resetfloat: document.getElementById('bulk_resetfloat_en').checked
      };
      if (!apply.dur && !apply.cal && !apply.ct && !apply.shift && !apply.clrpred && !apply.lag && !apply.resetfloat){
        toast('Pilih minimal 1 operasi', false);
        return false;
      }

      Undo.snapshot('Bulk edit ' + items.length + ' task');

      items.forEach(w => {
        const cal = WorkingCalendar.get(w.calendar_id || w.project_id);
        if (apply.dur){
          const d = parseInt(document.getElementById('bulk_dur_val').value, 10) || 1;
          writeScheduleField(w, 'duration', Math.max(1, d));
        }
        if (apply.cal){
          const v = document.getElementById('bulk_cal_val').value;
          if (v) writeScheduleField(w, 'calendar_id', v);
        }
        if (apply.ct){
          const v = document.getElementById('bulk_ct_val').value;
          if (v === '__none__'){
            writeScheduleField(w, 'constraint_type', '');
            writeScheduleField(w, 'constraint_date', '');
          } else if (v){
            writeScheduleField(w, 'constraint_type', v);
            const dt = document.getElementById('bulk_ct_date').value;
            if (dt) writeScheduleField(w, 'constraint_date', dt);
          }
        }
        if (apply.shift && w.tgl_mulai_rencana){
          const shift = shiftDir * (parseInt(document.getElementById('bulk_shift_val').value, 10) || 0);
          if (shift){
            const curStart = new Date(w.tgl_mulai_rencana + 'T00:00:00');
            const newStart = WorkingCalendar.addWorkDays(curStart, shift, cal);
            writeScheduleField(w, 'constraint_type', 'SNET');
            writeScheduleField(w, 'constraint_date', WorkingCalendar.fmt(newStart));
          }
        }
        if (apply.clrpred){
          writeScheduleField(w, 'predecessor', '');
        }
        if (apply.lag){
          const lv = parseInt(document.getElementById('bulk_lag_val').value, 10) || 0;
          writeScheduleField(w, 'lag_days', lv);
        }
      });

      if (apply.resetfloat || apply.dur || apply.cal || apply.ct || apply.shift || apply.clrpred){
        runCPM(items[0].project_id);
      }
      saveDB();
      toast('✅ Bulk edit selesai: ' + items.length + ' task');
    });

    // Enable/disable inputs
    const bindEnable = (chkId, inputs) => {
      const chk = document.getElementById(chkId);
      chk.addEventListener('change', () => {
        inputs.forEach(id => {
          const el = document.getElementById(id);
          if (el) el.disabled = !chk.checked;
        });
      });
    };
    bindEnable('bulk_dur_en', ['bulk_dur_val']);
    bindEnable('bulk_cal_en', ['bulk_cal_val']);
    bindEnable('bulk_ct_en', ['bulk_ct_val','bulk_ct_date']);
    bindEnable('bulk_shift_en', ['bulk_shift_val']);
    bindEnable('bulk_lag_en', ['bulk_lag_val']);

    // Shift dir toggle
    const dirBtn = document.getElementById('bulk_shift_dir');
    dirBtn.addEventListener('click', () => {
      shiftDir = -shiftDir;
      dirBtn.textContent = shiftDir >= 0 ? '+' : '−';
    });
  }
};

/* =====================================================================
   BAGIAN 9H — RESOURCE LEVELING & WHAT-IF (Fase 4D)
   ===================================================================== */
const Leveling = {
  MAX_ITER: 20,

  /* Preview: hitung tanpa commit */
  preview(projectId, opts){
    opts = opts || {};
    const preserveCrit = opts.preserveCritical !== false;
    const maxIter = opts.maxIter || this.MAX_ITER;

    // Snapshot current state
    const snapWbs = JSON.parse(JSON.stringify(DB.project_wbs));
    const snapProg = JSON.parse(JSON.stringify(DB.progress));

    const log = [];
    let iter = 0;

    try {
      runCPM(projectId);
      while (iter < maxIter){
        iter++;
        const det = OverAllocationDetector.detect(projectId);
        if (!det.ok || !det.alerts.length) break;

        // Ambil worst offender
        const worst = det.alerts[0];
        const delayResult = this.tryFix(projectId, worst, preserveCrit);
        if (!delayResult.ok){
          log.push({
            type: 'unresolved',
            resKode: worst.kode,
            resNama: worst.nama,
            tanggal: worst.tanggal_terburuk,
            reason: delayResult.reason
          });
          break;
        }
        log.push({
          type: 'delayed',
          taskId: delayResult.task.id,
          kode: delayResult.task.kode_wbs,
          uraian: delayResult.task.uraian,
          delayDays: delayResult.delayDays,
          reason: worst.kode + ' · ' + worst.tanggal_terburuk
        });
      }

      // Compute final state
      runCPM(projectId);
      const finalKPI = this.computeKPI(projectId);
      const detFinal = OverAllocationDetector.detect(projectId);
      const remaining = detFinal.ok ? detFinal.alerts.length : 0;

      return { ok:true, log, remaining, finalKPI, iter };
    } finally {
      // Rollback
      DB.project_wbs = snapWbs;
      DB.progress    = snapProg;
      runCPM(projectId);
    }
  },

  /* Apply: commit changes */
  apply(projectId, opts){
    opts = opts || {};
    const preserveCrit = opts.preserveCritical !== false;
    const maxIter = opts.maxIter || this.MAX_ITER;

    Undo.snapshot('Auto leveling');

    const log = [];
    let iter = 0;
    runCPM(projectId);

    while (iter < maxIter){
      iter++;
      const det = OverAllocationDetector.detect(projectId);
      if (!det.ok || !det.alerts.length) break;

      const worst = det.alerts[0];
      const delayResult = this.tryFix(projectId, worst, preserveCrit);
      if (!delayResult.ok){
        log.push({ type: 'unresolved', resKode: worst.kode, tanggal: worst.tanggal_terburuk, reason: delayResult.reason });
        break;
      }
      log.push({
        type: 'delayed',
        taskId: delayResult.task.id,
        kode: delayResult.task.kode_wbs,
        uraian: delayResult.task.uraian,
        delayDays: delayResult.delayDays
      });
    }

    runCPM(projectId);
    saveDB();
    return { ok:true, log, iter };
  },

  tryFix(projectId, worst, preserveCrit){
    const cal = WorkingCalendar.get((DB.projects.find(p => p.id === projectId) || {}).calendar_id);
    const resKode = worst.kode;
    const worstDate = worst.tanggal_terburuk;

    // Cari task kandidat: aktif di tanggal worstDate, non-critical, pakai resource tsb
    const candidates = [];
    DB.project_wbs.forEach(t => {
      if (t.project_id !== projectId || t.is_group) return;
      if (preserveCrit && num(t.is_critical) === 1) return;
      if (num(t.float_total) <= 0) return;
      if (!t.tgl_mulai_rencana || !t.tgl_selesai_rencana) return;
      if (worstDate < t.tgl_mulai_rencana || worstDate >= t.tgl_selesai_rencana) return;

      const usesRes = this.taskUsesResource(projectId, t, resKode);
      if (!usesRes) return;

      candidates.push(t);
    });

    if (!candidates.length){
      return { ok:false, reason: 'Tidak ada task non-kritis dengan slack yang pakai resource ini di tanggal tsb' };
    }

    // Sort: float terbanyak dulu → delay dulu
    candidates.sort((a, b) => num(b.float_total) - num(a.float_total));
    const chosen = candidates[0];

    // Delay 1 hari kerja via SNET
    const curStart = new Date(chosen.tgl_mulai_rencana + 'T00:00:00');
    const newStart = WorkingCalendar.addWorkDays(curStart, 1, cal);
    const newISO = WorkingCalendar.fmt(newStart);

    // Kalau constraint SNET sudah ada dan lebih besar, jangan overwrite
    if (chosen.constraint_type === 'SNET' && chosen.constraint_date && chosen.constraint_date >= newISO){
      return { ok:false, reason: 'Task sudah di-delay sampai ' + chosen.constraint_date };
    }

    writeScheduleField(chosen, 'constraint_type', 'SNET');
    writeScheduleField(chosen, 'constraint_date', newISO);

    runCPM(projectId);

    return { ok:true, task: chosen, delayDays: 1 };
  },

  taskUsesResource(projectId, task, resKode){
    if (!task.ahsp_id) return false;
    const dets = DB.project_ahsp_details.filter(d =>
      d.project_id === projectId && d.ahsp_id === task.ahsp_id
    );
    return dets.some(d => {
      const r = DB.master_resources.find(x => x.id === d.resource_id);
      return r && r.kode === resKode;
    });
  },

  computeKPI(projectId){
    const proj = DB.projects.find(p => p.id === projectId);
    const items = DB.project_wbs.filter(w => w.project_id === projectId && !w.is_group);
    const critical = items.filter(w => num(w.is_critical) === 1).length;
    const finish = items.reduce((m, w) => {
      const f = w.tgl_selesai_rencana || '';
      return f > m ? f : m;
    }, '');
    return {
      total: items.length,
      critical,
      finish
    };
  },

  /* UI: buka modal */
  openUI(projectId){
    const det = OverAllocationDetector.detect(projectId);
    const alertCount = det.ok ? det.alerts.length : 0;

    const body =
      '<div class="level-status">' +
        '<div class="lvl-item"><div class="lbl">Over-Allocation</div><div class="val ' + (alertCount ? 'danger' : 'ok') + '">' + alertCount + '</div></div>' +
        '<div class="lvl-item"><div class="lbl">Max Iterasi</div><div class="val"><input type="number" id="lvl_maxiter" value="20" min="5" max="50" style="width:70px;padding:3px 6px;font-size:12px"></div></div>' +
        '<div class="lvl-item"><div class="lbl">Preserve Critical</div><div class="val"><input type="checkbox" id="lvl_preserve" checked style="width:18px;height:18px;accent-color:#2f81f7"></div></div>' +
      '</div>' +
      '<div style="margin-bottom:10px;font-size:11.5px;color:var(--muted);line-height:1.6">' +
        '<b style="color:#7cb3ff">Algoritma:</b> Greedy. Untuk setiap over-allocation terparah, ' +
        'cari task non-kritis dengan slack terbanyak yang aktif di tanggal tsb, delay 1 hari via constraint SNET. ' +
        'Iterasi sampai bersih atau batas iterasi tercapai.' +
      '</div>' +
      '<div style="display:flex;gap:8px;margin-bottom:12px">' +
        '<button class="btn" id="lvl_preview_btn" style="background:linear-gradient(135deg,#a855f7,#7c3aed);border-color:transparent;color:#fff">🔍 Preview (What-If)</button>' +
        '<button class="btn" id="lvl_apply_btn" style="background:linear-gradient(135deg,#16a34a,#0f8a3f);border-color:transparent;color:#fff">✅ Apply Leveling</button>' +
      '</div>' +
      '<div class="level-list" id="lvl_list">' +
        (alertCount === 0
          ? '<div class="lv-row lv-empty">✅ Tidak ada over-allocation — jadwal sudah seimbang</div>'
          : '<div class="lv-row lv-empty">Klik <b>Preview</b> atau <b>Apply</b> untuk memulai</div>') +
      '</div>';

    openModal('⚖ Resource Leveling', body, () => {});

    // Hide default Submit button (kita pakai tombol sendiri)
    const submitBtn = document.getElementById('mSubmit');
    if (submitBtn) submitBtn.style.display = 'none';
    const cancelBtn = document.getElementById('mCancel');
    if (cancelBtn) cancelBtn.textContent = 'Tutup';

    // Wire
    document.getElementById('lvl_preview_btn').onclick = () => {
      const previewMaxIter = parseInt(document.getElementById('lvl_maxiter').value, 10) || 20;
      const previewPreserve = document.getElementById('lvl_preserve').checked;
      const listEl = document.getElementById('lvl_list');
      listEl.innerHTML = '<div class="lv-row lv-empty">⏳ Menghitung…</div>';
      setTimeout(() => {
        const result = Leveling.preview(projectId, { maxIter: previewMaxIter, preserveCritical: previewPreserve });
        listEl.innerHTML = Leveling.renderLog(result);
      }, 50);
    };

    document.getElementById('lvl_apply_btn').onclick = () => {
      const applyMaxIter = parseInt(document.getElementById('lvl_maxiter').value, 10) || 20;
      const applyPreserve = document.getElementById('lvl_preserve').checked;
      if (!confirm('Terapkan leveling? Perubahan akan disimpan (Undo tersedia).')) return;
      const result = Leveling.apply(projectId, { maxIter: applyMaxIter, preserveCritical: applyPreserve });
      document.getElementById('lvl_list').innerHTML = Leveling.renderLog(result);
      saveDB();
      const ganttEl = document.getElementById('ganttContainer');
      if (ganttEl) GanttView.mount(ganttEl, projectId, { mode: 'rab', zoom: ganttEl._lastZoom || 'weekly' });
      toast('✅ Leveling selesai: ' + result.log.filter(x => x.type === 'delayed').length + ' task di-delay');
    };
  },

  renderLog(result){
    if (!result.log.length){
      return '<div class="lv-row lv-empty">✅ Tidak ada yang perlu di-delay — jadwal sudah optimal</div>';
    }
    return result.log.map(entry => {
      if (entry.type === 'delayed'){
        return '<div class="lv-row">' +
          '<span class="lv-kode">' + esc(entry.kode || '?') + '</span>' +
          '<span class="lv-uraian">' + esc(entry.uraian || '') + '</span>' +
          '<span class="lv-badge warn">+' + entry.delayDays + 'd</span>' +
        '</div>';
      }
      return '<div class="lv-row">' +
        '<span class="lv-kode" style="color:#f87171">⚠</span>' +
        '<span class="lv-uraian">' + esc(entry.reason || 'Unresolved') + '</span>' +
        '<span class="lv-badge danger">stuck</span>' +
      '</div>';
    }).join('') +
    (result.remaining !== undefined
      ? '<div class="lv-row lv-empty">Sisa over-allocation: <b style="color:' + (result.remaining > 0 ? '#f87171' : '#4ade80') + '">' + result.remaining + '</b></div>'
      : '');
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
    if (!SET.sheetUrl || !SET.sheetUrl.trim()) {
      return { ok: false, code: 'NO_URL', message: 'URL belum diatur' };
    }
    try {
      const out = await sheetRequest('softStatus', {});
      if (out && out.blind) {
        return { ok: false, code: 'BLIND', blind: true, message: out.message };
      }
      return out;
    } catch(e){
      if (e.code === 'HTTP_404'){
        return {
          ok: false,
          code: 'DEAD_ENDPOINT',
          message: 'Deployment tidak ditemukan (404)',
          hint: e.hint
        };
      }
      if (e.code === 'CIRCUIT_OPEN'){
        return {
          ok: false,
          code: 'CIRCUIT_OPEN',
          message: 'Endpoint offline (circuit breaker)',
          hint: ENDPOINT_HEALTH.lastError?.hint || 'Cek URL & deployment Web App.'
        };
      }
      if (e.code === 'NO_URL'){
        return { ok: false, code: 'NO_URL', message: 'URL belum diatur' };
      }
      return { ok: false, code: 'NET', message: e.message };
    }
  }
};

/* =====================================================================
   BAGIAN 11 — UNDO/REDO KEYBOARD SHORTCUTS + TOPBAR WIRING (Fase 4C)
   ===================================================================== */
(function wireUndoGlobal(){
  function refreshUndoUI(){
    const bU = document.getElementById('btnUndo');
    const bR = document.getElementById('btnRedo');
    if (bU) bU.disabled = !Undo.undoStack.length;
    if (bR) bR.disabled = !Undo.redoStack.length;
  }

  function renderHistoryMenu(){
    const menu = document.getElementById('historyMenu');
    if (!menu) return;
    let html = '<div class="hist-title">Riwayat Perubahan (terbaru di atas)</div>';
    if (!Undo.undoStack.length && !Undo.redoStack.length){
      html += '<div class="hist-empty">Belum ada riwayat</div>';
    } else {
      const stack = Undo.undoStack.slice().reverse();
      stack.forEach((snap, idx) => {
        const isCur = idx === 0;
        const t = new Date(snap.ts).toLocaleTimeString('id-ID', {hour:'2-digit',minute:'2-digit'});
        html += '<div class="hist-item' + (isCur ? ' is-current' : '') + '" data-hist-idx="' + (Undo.undoStack.length - 1 - idx) + '">' +
                '📌 ' + esc(snap.label) +
                '<span class="ts">' + t + '</span></div>';
      });
    }
    menu.innerHTML = html;

    // Click handlers — clicking jumps to that point (undo/redo repeatedly)
    menu.querySelectorAll('.hist-item').forEach(item => {
      item.onclick = () => {
        const targetIdx = parseInt(item.getAttribute('data-hist-idx'), 10);
        const steps = Undo.undoStack.length - 1 - targetIdx;
        for (let i = 0; i < steps; i++) Undo.undo();
        if (typeof renderAll === 'function') renderAll();
        menu.classList.remove('show');
        toast('↶ Undo ' + steps + ' langkah');
      };
    });
  }

  Undo.onChange(() => {
    refreshUndoUI();
    if (document.getElementById('historyMenu')?.classList.contains('show')){
      renderHistoryMenu();
    }
  });

  // Wire buttons after DOM ready
  function wire(){
    const bU = document.getElementById('btnUndo');
    const bR = document.getElementById('btnRedo');
    const bH = document.getElementById('btnHistory');
    const menu = document.getElementById('historyMenu');

    if (bU && !bU._wired){
      bU._wired = true;
      bU.onclick = () => {
        const label = Undo.undo();
        if (label){
          if (typeof renderAll === 'function') renderAll();
          const ganttEl = document.getElementById('ganttContainer');
          if (ganttEl && STATE.activeProject){
            GanttView.mount(ganttEl, STATE.activeProject, { mode: 'rab', zoom: ganttEl._lastZoom || 'weekly' });
          }
          toast('↶ Undo: ' + label);
        } else {
          toast('Tidak ada yang bisa di-undo', false);
        }
      };
    }
    if (bR && !bR._wired){
      bR._wired = true;
      bR.onclick = () => {
        if (Undo.redo()){
          if (typeof renderAll === 'function') renderAll();
          const ganttEl = document.getElementById('ganttContainer');
          if (ganttEl && STATE.activeProject){
            GanttView.mount(ganttEl, STATE.activeProject, { mode: 'rab', zoom: ganttEl._lastZoom || 'weekly' });
          }
          toast('↷ Redo');
        } else {
          toast('Tidak ada yang bisa di-redo', false);
        }
      };
    }
    if (bH && !bH._wired){
      bH._wired = true;
      bH.onclick = (e) => {
        e.stopPropagation();
        renderHistoryMenu();
        menu.classList.toggle('show');
      };
    }
    // Click outside → close menu
    document.addEventListener('click', (e) => {
      if (!menu) return;
      if (!e.target.closest('.history-wrap')) menu.classList.remove('show');
    });

    refreshUndoUI();
  }

  // Global keyboard shortcuts
  document.addEventListener('keydown', e => {
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (!mod) return;
    // Skip kalau sedang fokus input/textarea
    const tag = (e.target && e.target.tagName) || '';
    const isInput = tag === 'INPUT' || tag === 'TEXTAREA' || e.target.isContentEditable;

    if (!e.shiftKey && e.key.toLowerCase() === 'z'){
      e.preventDefault();
      if (isInput && e.target.type === 'text'){
        // Biarkan browser handle native undo di text input
        return;
      }
      const label = Undo.undo();
      if (label){
        if (typeof renderAll === 'function') renderAll();
        const ganttEl = document.getElementById('ganttContainer');
        if (ganttEl && STATE.activeProject){
          GanttView.mount(ganttEl, STATE.activeProject, { mode: 'rab', zoom: ganttEl._lastZoom || 'weekly' });
        }
        toast('↶ Undo: ' + label);
      }
    } else if (e.shiftKey && e.key.toLowerCase() === 'z'){
      e.preventDefault();
      if (Undo.redo()){
        if (typeof renderAll === 'function') renderAll();
        const ganttEl = document.getElementById('ganttContainer');
        if (ganttEl && STATE.activeProject){
          GanttView.mount(ganttEl, STATE.activeProject, { mode: 'rab', zoom: ganttEl._lastZoom || 'weekly' });
        }
        toast('↷ Redo');
      }
    }
  });

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();

/* =====================================================================
   FASE 5A — EXPORT EXCEL (SheetJS multi-sheet)
   ===================================================================== */
const ExportExcel = {
  exportProject(projectId){
    if (typeof XLSX === 'undefined'){ toast('SheetJS belum dimuat (cek koneksi)', false); return; }
    const proj = DB.projects.find(p => p.id === projectId);
    if (!proj){ toast('Proyek tidak ditemukan', false); return; }

    const wb = XLSX.utils.book_new();

    /* Sheet 1 — Info Proyek */
    const infoRows = [
      ['Kode Proyek', proj.kode],
      ['Nama', proj.nama],
      ['Lokasi', proj.lokasi || ''],
      ['Owner', proj.owner || ''],
      ['Nilai Kontrak', num(proj.nilai_kontrak)],
      ['PPN (%)', num(proj.ppn || SET.ppn)],
      ['Overhead (%)', num(proj.overhead || SET.overhead)],
      ['Tgl Mulai', proj.tgl_mulai || ''],
      ['Tgl Selesai', proj.tgl_selesai || ''],
      ['Durasi (hari)', num(proj.durasi_hari)],
      ['Durasi (minggu)', num(proj.durasi_minggu)],
      ['Hari Kerja Efektif', num(proj.durasi_kerja)],
      ['Status', proj.status || ''],
      ['Diekspor', new Date().toLocaleString('id-ID')]
    ];
    const wsInfo = XLSX.utils.aoa_to_sheet(infoRows);
    wsInfo['!cols'] = [{ wch:22 }, { wch:60 }];
    XLSX.utils.book_append_sheet(wb, wsInfo, 'Info');

    /* Sheet 2 — WBS + Biaya */
    const wbsRows = Calc.wbsRows(projectId);
    const wbsData = wbsRows.map(w => ({
      'Kode': w.kode_wbs,
      'Uraian': w.uraian,
      'STA': w.sta || '',
      'Satuan': w.satuan || '',
      'Vol RAB': num(w.volume_rab),
      'HPS RAB': Math.round(num(w.harga_satuan_rab)),
      'Total RAB': Math.round(num(w.total_rab)),
      'Vol RAP': num(w.volume_rap),
      'HPS RAP': Math.round(num(w.harga_satuan_rap)),
      'Total RAP': Math.round(num(w.total_rap)),
      'Deviasi Rp': Math.round(num(w.deviasi)),
      'Deviasi %': +num(w.deviasi_pct).toFixed(2),
      'Durasi (hari)': num(w.durasi_hari) || num(w.duration) || 1,
      'Mulai': w.tgl_mulai_rencana || '',
      'Selesai': w.tgl_selesai_rencana || '',
      'Float': num(w.float_total ?? w.total_float),
      'Kritis': num(w.is_critical) === 1 ? 'YA' : '',
      'Pred': w.predecessor ? ((DB.project_wbs.find(x=>x.id===w.predecessor)?.kode_wbs)||'') + ' ' + (w.pred_type||'FS') : ''
    }));
    const wsWBS = XLSX.utils.json_to_sheet(wbsData);
    wsWBS['!cols'] = [
      { wch:10 }, { wch:42 }, { wch:22 }, { wch:8 },
      { wch:10 }, { wch:14 }, { wch:16 },
      { wch:10 }, { wch:14 }, { wch:16 },
      { wch:14 }, { wch:10 },
      { wch:11 }, { wch:12 }, { wch:12 }, { wch:8 }, { wch:8 }, { wch:14 }
    ];
    XLSX.utils.book_append_sheet(wb, wsWBS, 'WBS');

    /* Sheet 3 — Resources */
    const resData = DB.master_resources.map(r => ({
      'Kode': r.kode,
      'Nama': r.nama,
      'Jenis': r.jenis,
      'Satuan': r.satuan,
      'Harga RAB': Math.round(num(r.harga_rab)),
      'Harga RAP': Math.round(num(r.harga_rap)),
      'Kapasitas/hari': num(r.kapasitas_harian)
    }));
    const wsRes = XLSX.utils.json_to_sheet(resData);
    wsRes['!cols'] = [{ wch:10 }, { wch:36 }, { wch:10 }, { wch:8 }, { wch:14 }, { wch:14 }, { wch:14 }];
    XLSX.utils.book_append_sheet(wb, wsRes, 'Resources');

    /* Sheet 4 — Baseline & Variance (kalau ada) */
    if (Baseline.isSet(projectId, 1) || Baseline.isSet(projectId, 2) || Baseline.isSet(projectId, 3)){
      const baselineIdx = Baseline.isSet(projectId, 3) ? 3 : Baseline.isSet(projectId, 2) ? 2 : 1;
      const vars = Baseline.variance(projectId, baselineIdx);
      const varData = vars.map(v => ({
        'Kode': v.w.kode_wbs,
        'Uraian': v.w.uraian,
        'Baseline Mulai': v.bStart,
        'Baseline Selesai': v.bFinish,
        'Current Mulai': v.cStart,
        'Current Selesai': v.cFinish,
        'Slip (hari)': v.slip === null ? '' : v.slip,
        'Slip Start': v.slipStart === null ? '' : v.slipStart
      }));
      const wsBL = XLSX.utils.json_to_sheet(varData);
      wsBL['!cols'] = [
        { wch:10 }, { wch:42 },
        { wch:14 }, { wch:14 },
        { wch:14 }, { wch:14 },
        { wch:10 }, { wch:10 }
      ];
      XLSX.utils.book_append_sheet(wb, wsBL, 'Baseline BL' + baselineIdx);
    }

    /* Sheet 5 — Resource Loading */
    const rl = ResourceLoader.load(projectId, { granularity: 'weekly', mode: 'rab' });
    if (rl.ok){
      const loadData = rl.buckets.map(b => ({
        'Periode': b.bucket_key,
        'Mulai': b.tanggal_mulai,
        'Selesai': b.tanggal_selesai,
        'Upah': Math.round(b.upah),
        'Bahan': Math.round(b.bahan),
        'Alat': Math.round(b.alat),
        'Total': Math.round(b.upah + b.bahan + b.alat)
      }));
      const wsLoad = XLSX.utils.json_to_sheet(loadData);
      wsLoad['!cols'] = [{ wch:10 }, { wch:12 }, { wch:12 }, { wch:14 }, { wch:14 }, { wch:14 }, { wch:14 }];
      XLSX.utils.book_append_sheet(wb, wsLoad, 'Resource Loading');
    }

    /* Sheet 6 — Progress */
    const progRows = DB.progress.filter(p => p.project_id === projectId);
    if (progRows.length){
      const progData = progRows.map(p => {
        const w = DB.project_wbs.find(x => x.id === p.wbs_id);
        return {
          'Minggu': num(p.minggu),
          'Kode WBS': w ? w.kode_wbs : '',
          'Uraian': w ? w.uraian : '',
          'Satuan': w ? w.satuan : '',
          'Volume': num(p.volume),
          'Tanggal': p.tanggal || ''
        };
      });
      const wsProg = XLSX.utils.json_to_sheet(progData);
      wsProg['!cols'] = [{ wch:8 }, { wch:10 }, { wch:36 }, { wch:8 }, { wch:10 }, { wch:12 }];
      XLSX.utils.book_append_sheet(wb, wsProg, 'Progress');
    }

    /* Write file */
    const fn = 'MK-' + proj.kode + '-' + new Date().toISOString().slice(0,10) + '.xlsx';
    XLSX.writeFile(wb, fn);
    toast('✅ Excel diexport: ' + fn);
  }
};

/* =====================================================================
   FASE 5B — EXPORT GOOGLE CALENDAR (.ics)
   Milestone = task dengan duration = 0
   ===================================================================== */
const CalendarExport = {
  exportICS(projectId){
    const proj = DB.projects.find(p => p.id === projectId);
    if (!proj){ toast('Proyek tidak ditemukan', false); return; }

    const milestones = DB.project_wbs.filter(w =>
      w.project_id === projectId && !w.is_group &&
      (num(w.durasi_hari) === 0 || num(w.duration) === 0) &&
      w.tgl_mulai_rencana
    );

    if (!milestones.length){
      toast('Tidak ada milestone (task durasi = 0) untuk diexport', false);
      return;
    }

    const lines = [];
    lines.push('BEGIN:VCALENDAR');
    lines.push('VERSION:2.0');
    lines.push('PRODID:-//Manajemen Konstruksi v1//EN');
    lines.push('CALSCALE:GREGORIAN');
    lines.push('METHOD:PUBLISH');
    lines.push('X-WR-CALNAME:' + this._esc(proj.kode + ' — ' + proj.nama));
    lines.push('X-WR-TIMEZONE:Asia/Jakarta');

    const stamp = this._fmt(new Date(), true);
    const cal = WorkingCalendar.get(proj.calendar_id);

    milestones.forEach(w => {
      const d = new Date(w.tgl_mulai_rencana + 'T00:00:00');
      const dEnd = new Date(d); dEnd.setDate(dEnd.getDate() + 1);
      const uid = 'mk-' + w.id + '@mk-v1.local';
      const desc = 'Kode: ' + (w.kode_wbs||'') + '\\n' +
                   'Uraian: ' + (w.uraian||'') + '\\n' +
                   'STA: ' + (w.sta||'-') + '\\n' +
                   'Volume RAB: ' + num(w.volume_rab) + ' ' + (w.satuan||'') + '\\n' +
                   'Status: MILESTONE';
      lines.push('BEGIN:VEVENT');
      lines.push('UID:' + uid);
      lines.push('DTSTAMP:' + stamp);
      lines.push('DTSTART;VALUE=DATE:' + this._fmt(d, false));
      lines.push('DTEND;VALUE=DATE:' + this._fmt(dEnd, false));
      lines.push('SUMMARY:' + this._esc('📌 ' + (w.kode_wbs||'') + ' — ' + (w.uraian||'')));
      lines.push('DESCRIPTION:' + desc);
      lines.push('CATEGORIES:Milestone Proyek');
      lines.push('STATUS:CONFIRMED');
      lines.push('TRANSP:TRANSPARENT');
      lines.push('END:VEVENT');
    });

    lines.push('END:VCALENDAR');
    const ics = lines.join('\r\n');
    const blob = new Blob([ics], { type:'text/calendar;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'milestones-' + proj.kode + '-' + today() + '.ics';
    a.click();
    toast('✅ ' + milestones.length + ' milestone diexport ke .ics');
  },

  _fmt(d, isDateTime){
    const pad = n => String(n).padStart(2, '0');
    const Y = d.getUTCFullYear();
    const M = pad(d.getUTCMonth() + 1);
    const D = pad(d.getUTCDate());
    if (isDateTime){
      return Y + M + D + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
    }
    return Y + M + D;
  },

  _esc(s){
    return String(s || '')
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\n/g, '\\n');
  }
};

/* =====================================================================
   FASE 5C — LIVE COLLABORATION (polling dengan adaptive backoff)
   Koreksi 1C: berhenti spam endpoint mati
   ===================================================================== */
const LiveSync = {
  INTERVAL_MS: 30000,
  MAX_INTERVAL_MS: 5 * 60 * 1000,
  _currentInterval: 30000,
  _timer: null,
  _remoteVersion: null,
  _paused: false,

  start(){
    this.stop();
    if (!SET.sheetUrl || !SET.sheetUrl.trim()) return;
    this._currentInterval = this.INTERVAL_MS;
    this._schedule();
  },

  _schedule(){
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      Promise.resolve(this.tick()).finally(() => {
        if (!this._paused) this._schedule();
      });
    }, this._currentInterval);
  },

  stop(){
    clearTimeout(this._timer);
    this._timer = null;
  },

  pause(){ this._paused = true; },

  resume(){
    this._paused = false;
    this._currentInterval = this.INTERVAL_MS;
    this._schedule();
  },

  _backoff(){
    this._currentInterval = Math.min(this._currentInterval * 3, this.MAX_INTERVAL_MS);
  },

  _resetBackoff(){
    this._currentInterval = this.INTERVAL_MS;
  },

  async tick(){
    if (this._paused) return;
    if (!SET.sheetUrl) return;
    if (document.getElementById('overlay')?.classList.contains('show')) return;
    if (typeof GanttView !== 'undefined' && GanttView._state?.barDrag) return;

    const ind = document.getElementById('liveIndicator');
    if (ind) ind.classList.add('is-syncing');

    try {
      const out = await SyncManager.status();
      if (!out || !out.ok){
        let txt = 'Offline';
        if (out && out.code === 'DEAD_ENDPOINT'){
          txt = 'URL mati';
          this._backoff();
        } else if (out && out.code === 'CIRCUIT_OPEN'){
          txt = 'Endpoint offline';
          this._backoff();
        } else if (out && out.code === 'NO_URL'){
          txt = 'URL kosong';
        } else {
          this._backoff();
        }
        this._setIndicator('err', txt);
        return;
      }

      // Endpoint sehat → reset backoff
      this._resetBackoff();

      const remoteVer = out.dbVersion;

      if (this._remoteVersion === null){
        this._remoteVersion = remoteVer;
        this._setIndicator('ok', 'Live');
        return;
      }

      const localVer = STATE.dbVersion;
      if (remoteVer !== this._remoteVersion){
        this._remoteVersion = remoteVer;
        if (localVer === null || remoteVer > localVer){
          this._showBanner(remoteVer);
          this._setIndicator('warn', 'Update tersedia');
        }
      } else {
        this._setIndicator('ok', 'Live');
      }
    } catch(e){
      this._backoff();
      this._setIndicator('err', 'Offline');
    } finally {
      if (ind) ind.classList.remove('is-syncing');
    }
  },

  _setIndicator(state, text){
    const ind = document.getElementById('liveIndicator');
    if (!ind) return;
    ind.classList.remove('is-ok','is-warn','is-err');
    ind.classList.add('is-' + state);
    const t = ind.querySelector('.live-text');
    if (t) t.textContent = text;
  },

  _showBanner(remoteVer){
    let b = document.getElementById('remoteBanner');
    if (!b){
      b = document.createElement('div');
      b.className = 'remote-banner';
      b.id = 'remoteBanner';
      b.innerHTML =
        '<span>🔄 <b>Data di server diperbarui</b> (v' + remoteVer + '). Klik untuk sinkronisasi.</span>' +
        '<button class="remote-btn-pull">Pull Sekarang</button>' +
        '<button class="remote-btn-later">Nanti</button>';
      document.body.appendChild(b);
    }
    b.classList.add('show');
    b.querySelector('.remote-btn-pull').onclick = () => {
      b.classList.remove('show');
      if (typeof $('#btnPull') !== 'undefined' && $('#btnPull')) $('#btnPull').click();
    };
    b.querySelector('.remote-btn-later').onclick = () => b.classList.remove('show');
  }
};

/* =====================================================================
   FASE 5D — MOBILE VIEW
   ===================================================================== */
const MobileView = {
  init(){
    const btn = document.getElementById('mobileMenuBtn');
    const tabs = document.getElementById('mainTabs');
    if (!btn || !tabs) return;

    btn.onclick = () => {
      tabs.classList.toggle('open');
      btn.textContent = tabs.classList.contains('open') ? '✕ Tutup' : '☰ Menu';
    };

    // Tutup menu saat tab dipilih
    document.querySelectorAll('.tab').forEach(t => {
      t.addEventListener('click', () => {
        if (window.innerWidth <= 768){
          tabs.classList.remove('open');
          btn.textContent = '☰ Menu';
        }
      });
    });

    // Auto-close saat layar dibesarkan
    window.addEventListener('resize', () => {
      if (window.innerWidth > 768){
        tabs.classList.remove('open');
        btn.textContent = '☰ Menu';
      }
    });
  }
};

/* =====================================================================
   FASE 5E — EXECUTIVE DASHBOARD (multi-project)
   ===================================================================== */
const ExecDashboard = {
  render(){
    if (!DB.projects.length){
      document.getElementById('execKPI').innerHTML =
        '<div class="kpi"><div class="lbl">Status</div><div class="val">Belum ada proyek</div></div>';
      document.getElementById('tblExecPortfolio').innerHTML =
        '<tbody><tr><td class="empty">Tambahkan proyek untuk melihat dashboard executive.</td></tr></tbody>';
      document.getElementById('execAlerts').innerHTML = '';
      return;
    }

    // Kumpulkan KPI per proyek
    const rows = DB.projects.map(p => {
      const t = Calc.totals(p.id);
      const nilaiKontrak = num(p.nilai_kontrak);
      const netto = nilaiKontrak / (1 + num(SET.ppn)/100);
      const margin = t.margin_pct;
      const sisaKontrak = netto - t.rap;

      // Baseline slip
      let baselineIdx = 0;
      if (Baseline.isSet(p.id, 3)) baselineIdx = 3;
      else if (Baseline.isSet(p.id, 2)) baselineIdx = 2;
      else if (Baseline.isSet(p.id, 1)) baselineIdx = 1;
      let kpi = null;
      if (baselineIdx) kpi = Baseline.kpi(p.id, baselineIdx);

      // Health score
      const marginScore   = Math.min(100, Math.max(0, margin * 8.33));   // 12% = 100
      const scheduleScore = kpi ? Math.max(0, 100 - kpi.avgSlip * 10) : 80;
      const budgetScore   = sisaKontrak >= 0 ? 100 : Math.max(0, 100 + sisaKontrak/1e6);
      const health = Math.round((marginScore * 0.4 + scheduleScore * 0.3 + budgetScore * 0.3));

      let healthLbl, healthCls;
      if (health >= 75){ healthLbl = 'SEHAT'; healthCls = 'h-good'; }
      else if (health >= 50){ healthLbl = 'WASPADA'; healthCls = 'h-warn'; }
      else { healthLbl = 'KRITIS'; healthCls = 'h-bad'; }

      return {
        proj: p,
        rab: t.rab, rap: t.rap, dev: t.dev,
        nilaiKontrak, netto, sisaKontrak,
        margin,
        baselineIdx, kpi,
        health, healthLbl, healthCls
      };
    });

    // ── KPI Cards ──
    const totalPortfolio = rows.reduce((s,r) => s + r.nilaiKontrak, 0);
    const totalRAB       = rows.reduce((s,r) => s + r.rab, 0);
    const totalRAP       = rows.reduce((s,r) => s + r.rap, 0);
    const totalDev       = totalRAB - totalRAP;
    const avgHealth      = Math.round(rows.reduce((s,r) => s + r.health, 0) / rows.length);
    const criticalCount  = rows.filter(r => r.healthLbl === 'KRITIS').length;

    document.getElementById('execKPI').innerHTML =
      '<div class="kpi">' +
        '<div class="lbl">Total Proyek</div>' +
        '<div class="val">' + rows.length + '</div>' +
        '<div class="sub">' + criticalCount + ' kritis · avg health ' + avgHealth + '</div>' +
      '</div>' +
      '<div class="kpi k2">' +
        '<div class="lbl">Nilai Portofolio</div>' +
        '<div class="val">' + rp(totalPortfolio) + '</div>' +
        '<div class="sub">Total kontrak incl. PPN</div>' +
      '</div>' +
      '<div class="kpi k3">' +
        '<div class="lbl">Total RAB</div>' +
        '<div class="val">' + rp(totalRAB) + '</div>' +
        '<div class="sub">RAP: ' + rp(totalRAP) + '</div>' +
      '</div>' +
      '<div class="kpi ' + (totalDev >= 0 ? 'k5' : 'k4') + '">' +
        '<div class="lbl">Deviasi Portofolio</div>' +
        '<div class="val ' + (totalDev >= 0 ? 'pos' : 'neg') + '">' + rp(totalDev) + '</div>' +
        '<div class="sub ' + (totalDev >= 0 ? 'pos' : 'neg') + '">' +
          (totalRAB > 0 ? fmt(totalDev/totalRAB*100, 2) : '0.00') + '% dari RAB' +
        '</div>' +
      '</div>';

    // ── Tabel Portfolio ──
    const head = '<thead><tr>' +
      '<th>Kode</th><th>Nama</th><th>Status</th>' +
      '<th class="num">Nilai Kontrak</th>' +
      '<th class="num">RAB</th><th class="num">RAP</th>' +
      '<th class="num">Margin %</th>' +
      '<th class="num">Sisa Kontrak</th>' +
      '<th class="center">Baseline</th>' +
      '<th class="center">Health</th>' +
    '</tr></thead>';

    const body = rows.map(r => {
      const isActive = r.proj.id === STATE.activeProject;
      return '<tr class="exec-row ' + (isActive ? 'is-active' : '') + '" data-exec-prj="' + r.proj.id + '">' +
        '<td><b>' + esc(r.proj.kode) + '</b></td>' +
        '<td>' + esc(r.proj.nama) + '</td>' +
        '<td><span class="badge ' + (r.proj.status === 'Selesai' ? 'b-ok' : r.proj.status === 'Ditunda' ? 'b-danger' : 'b-warn') + '">' +
          esc(r.proj.status || '-') + '</span></td>' +
        '<td class="num">' + rp(r.nilaiKontrak) + '</td>' +
        '<td class="num">' + rp(r.rab) + '</td>' +
        '<td class="num">' + rp(r.rap) + '</td>' +
        '<td class="num ' + (r.margin >= 8 ? 'pos' : r.margin >= 5 ? '' : 'neg') + '">' +
          fmt(r.margin, 2) + '%</td>' +
        '<td class="num ' + (r.sisaKontrak >= 0 ? 'pos' : 'neg') + '">' +
          rp(r.sisaKontrak) + '</td>' +
        '<td class="center">' + (r.baselineIdx ? 'BL' + r.baselineIdx : '—') + '</td>' +
        '<td class="center">' +
          '<span class="exec-health ' + r.healthCls + '">' + r.healthLbl + ' ' + r.health + '</span>' +
        '</td>' +
      '</tr>';
    }).join('');

    document.getElementById('tblExecPortfolio').innerHTML = head + '<tbody>' + body + '</tbody>';

    // Click → switch project
    document.querySelectorAll('[data-exec-prj]').forEach(tr => {
      tr.onclick = () => {
        STATE.activeProject = tr.getAttribute('data-exec-prj');
        $('#activeProject').value = STATE.activeProject;
        switchTab('dashboard');
        renderAll();
        toast('Beralih ke proyek: ' + (activeProj()?.kode || ''));
      };
    });

    // ── Chart Perbandingan ──
    const cv = document.getElementById('chartExecCompare');
    if (cv){
      if (STATE.chartExec) STATE.chartExec.destroy();
      STATE.chartExec = new Chart(cv.getContext('2d'), {
        type: 'bar',
        data: {
          labels: rows.map(r => r.proj.kode),
          datasets: [
            { label:'Nilai Kontrak', data: rows.map(r => r.nilaiKontrak),
              backgroundColor:'rgba(47,129,247,.75)', borderRadius:6 },
            { label:'Total RAB', data: rows.map(r => r.rab),
              backgroundColor:'rgba(26,188,156,.75)', borderRadius:6 },
            { label:'Total RAP', data: rows.map(r => r.rap),
              backgroundColor:'rgba(245,158,11,.75)', borderRadius:6 }
          ]
        },
        options: {
          responsive:true, maintainAspectRatio:false,
          plugins: {
            legend: { labels:{color:'#e6edf7', font:{size:11}} },
            tooltip: { callbacks:{ label: c => c.dataset.label + ': ' + rp(c.parsed.y) } }
          },
          scales: {
            x: { ticks:{color:'#8fa3c4'}, grid:{display:false} },
            y: { ticks:{color:'#8fa3c4', callback:v => 'Rp ' + (v/1e9).toFixed(2) + ' M'},
                 grid:{color:'rgba(36,54,92,.5)'} }
          }
        }
      });
    }

    // ── Alerts ──
    const alerts = [];
    rows.forEach(r => {
      if (r.sisaKontrak < 0){
        alerts.push('<div class="alert"><span>🚨</span><div><b>' + esc(r.proj.kode) + '</b> — Total RAP melampaui nilai kontrak netto (' + rp(r.sisaKontrak) + '). Segera review BQ & koefisien.</div></div>');
      }
      if (r.margin < 5 && r.rab > 0){
        alerts.push('<div class="alert warn"><span>⚠</span><div><b>' + esc(r.proj.kode) + '</b> — Margin rendah (' + fmt(r.margin,2) + '%). Target 8–12%.</div></div>');
      }
      if (r.kpi && r.kpi.late > 0){
        alerts.push('<div class="alert warn"><span>⏰</span><div><b>' + esc(r.proj.kode) + '</b> — ' + r.kpi.late + ' task telat vs Baseline BL' + r.baselineIdx + ' (avg slip ' + fmt(r.kpi.avgSlip,1) + ' hari).</div></div>');
      }
      if (r.healthLbl === 'KRITIS'){
        alerts.push('<div class="alert"><span>🔴</span><div><b>' + esc(r.proj.kode) + '</b> — Health score KRITIS (' + r.health + '). Cek margin, baseline, dan resource allocation.</div></div>');
      }
    });
    document.getElementById('execAlerts').innerHTML = alerts.length
      ? alerts.join('')
      : '<div class="alert ok"><span>✅</span><div><b>Semua proyek dalam kondisi sehat.</b></div></div>';
  }
};

/* =====================================================================
   FASE 5 — EVENT WIRING (init)
   ===================================================================== */
(function wireFase5(){
  function ready(fn){
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(() => {
    // ── Mobile ──
    if (typeof MobileView !== 'undefined') MobileView.init();

    // ── Tombol Export Excel ──
    const btnXlsx = document.getElementById('btnExcel');
    if (btnXlsx){
      btnXlsx.onclick = () => {
        if (!STATE.activeProject){ toast('Pilih proyek aktif dulu', false); return; }
        ExportExcel.exportProject(STATE.activeProject);
      };
    }

    // ── Tombol iCal ──
    const btnIcal = document.getElementById('btnIcal');
    if (btnIcal){
      btnIcal.onclick = () => {
        if (!STATE.activeProject){ toast('Pilih proyek aktif dulu', false); return; }
        CalendarExport.exportICS(STATE.activeProject);
      };
    }

    // ── Live indicator klik → toggle panel? ──
    const ind = document.getElementById('liveIndicator');
    if (ind){
      ind.onclick = () => {
        if (!SET.sheetUrl){ toast('URL Apps Script belum diatur (tab Pengaturan)', false); return; }
        LiveSync.tick();
      };
    }

    // ── Executive refresh ──
    const btnExec = document.getElementById('btnExecRefresh');
    if (btnExec) btnExec.onclick = () => { ExecDashboard.render(); toast('Executive dashboard di-refresh'); };

    // ── Start LiveSync ──
    setTimeout(() => LiveSync.start(), 1500);

    // ── Pause LiveSync saat tab disembunyikan ──
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') LiveSync.resume();
      else LiveSync.pause();
    });

    // ── Hook ke switchTab untuk Executive (DIPINDAH KE SINI) ──
    if (typeof window._origSwitchTab === 'undefined'){
      window._origSwitchTab = switchTab;
      window.switchTab = function(name){
        window._origSwitchTab(name);
        if (name === 'executive') ExecDashboard.render();
      };
    }

    // ── Hook renderAll → pastikan Executive ikut (DIPINDAH KE SINI) ──
    if (typeof window._origRenderAll === 'undefined'){
      window._origRenderAll = renderAll;
      window.renderAll = function(){
        window._origRenderAll();
        const cur = document.querySelector('.tab.active')?.dataset.tab;
        if (cur === 'executive') ExecDashboard.render();
      };
    }
  });
})();

/* =====================================================================
   FASE 6B — EVM VIEW (render dashboard EVM)
   ===================================================================== */
const EVMView = {
  render(){
    const pid = STATE.activeProject;
    const wrap = document.getElementById('evmKPI');
    if (!wrap) return;

    const proj = activeProj();
    if (!proj){
      wrap.innerHTML = '<div class="evm-kpi"><div class="lbl">Status</div><div class="val">Belum ada proyek</div></div>';
      return;
    }

    const e = Calc.evm(pid);
    if (!e.ok) return;

    /* ── KPI cards ── */
    const spiCls = e.SPI >= 0.95 ? 'good' : e.SPI >= 0.85 ? 'warn' : 'bad';
    const cpiCls = e.CPI >= 0.95 ? 'good' : e.CPI >= 0.85 ? 'warn' : 'bad';
    const svCls  = e.SV  >= 0 ? 'good' : 'bad';
    const cvCls  = e.CV  >= 0 ? 'good' : 'bad';
    const vacCls = e.VAC >= 0 ? 'good' : 'bad';

    const fmtIdx = v => v.toFixed(3);
    const fmtRp  = v => rp(v);

    wrap.innerHTML =
      '<div class="evm-kpi ' + spiCls + '">' +
        '<div class="icon">⏱</div>' +
        '<div class="lbl">SPI · Schedule Performance</div>' +
        '<div class="val ' + spiCls + '">' + fmtIdx(e.SPI) + '</div>' +
        '<div class="sub">' + (e.SPI >= 0.95 ? '✅ On Schedule' : e.SPI >= 0.85 ? '⚠ Sedikit telat' : '🔴 Terlambat signifikan') + '</div>' +
      '</div>' +
      '<div class="evm-kpi ' + cpiCls + '">' +
        '<div class="icon">💰</div>' +
        '<div class="lbl">CPI · Cost Performance</div>' +
        '<div class="val ' + cpiCls + '">' + fmtIdx(e.CPI) + '</div>' +
        '<div class="sub">' + (e.CPI >= 0.95 ? '✅ On Budget' : e.CPI >= 0.85 ? '⚠ Over budget tipis' : '🔴 Over budget besar') + '</div>' +
      '</div>' +
      '<div class="evm-kpi ' + svCls + '">' +
        '<div class="icon">📅</div>' +
        '<div class="lbl">Schedule Variance (Rp)</div>' +
        '<div class="val ' + svCls + '">' + (e.SV >= 0 ? '+' : '') + fmtRp(e.SV) + '</div>' +
        '<div class="sub">EV − PV · Forecast selesai: <b>' + esc(e.forecastFinish) + '</b></div>' +
      '</div>' +
      '<div class="evm-kpi ' + cvCls + '">' +
        '<div class="icon">📊</div>' +
        '<div class="lbl">Cost Variance (Rp)</div>' +
        '<div class="val ' + cvCls + '">' + (e.CV >= 0 ? '+' : '') + fmtRp(e.CV) + '</div>' +
        '<div class="sub">EV − AC · Rencana selesai: ' + esc(e.plannedFinish) + '</div>' +
      '</div>' +
      '<div class="evm-kpi">' +
        '<div class="icon">🎯</div>' +
        '<div class="lbl">BAC · Budget at Completion</div>' +
        '<div class="val">' + fmtRp(e.BAC) + '</div>' +
        '<div class="sub">Budget awal (Total RAB)</div>' +
      '</div>' +
      '<div class="evm-kpi ' + cpiCls + '">' +
        '<div class="icon">🔮</div>' +
        '<div class="lbl">EAC · Estimate at Completion</div>' +
        '<div class="val ' + cpiCls + '">' + fmtRp(e.EAC) + '</div>' +
        '<div class="sub">Prediksi biaya akhir · ETC: ' + fmtRp(e.ETC) + '</div>' +
      '</div>' +
      '<div class="evm-kpi ' + vacCls + '">' +
        '<div class="icon">⚖</div>' +
        '<div class="lbl">VAC · Variance at Completion</div>' +
        '<div class="val ' + vacCls + '">' + (e.VAC >= 0 ? '+' : '') + fmtRp(e.VAC) + '</div>' +
        '<div class="sub">' + (e.VAC >= 0 ? '✅ Di bawah anggaran' : '🔴 Over anggaran') + '</div>' +
      '</div>' +
      '<div class="evm-kpi">' +
        '<div class="icon">📈</div>' +
        '<div class="lbl">Baseline Aktif</div>' +
        '<div class="val">' + (e.baselineIdx ? 'BL' + e.baselineIdx : '—') + '</div>' +
        '<div class="sub">' + (e.baselineIdx ? 'Kurva baseline aktif' : 'Set baseline untuk variance') + '</div>' +
      '</div>';

    /* ── Trend chart: SPI & CPI ── */
    const cv1 = document.getElementById('chartEvmTrend');
    if (cv1){
      if (STATE.chartEvmTrend) STATE.chartEvmTrend.destroy();
      STATE.chartEvmTrend = new Chart(cv1.getContext('2d'), {
        type: 'line',
        data: {
          labels: e.weeks.map(w => 'M' + w.week),
          datasets: [
            { label:'SPI', data: e.weeks.map(w => +w.SPI.toFixed(3)),
              borderColor:'#2f81f7', backgroundColor:'rgba(47,129,247,.14)',
              tension:.35, borderWidth:2.5, pointRadius:3, fill:false },
            { label:'CPI', data: e.weeks.map(w => +w.CPI.toFixed(3)),
              borderColor:'#1abc9c', backgroundColor:'rgba(26,188,156,.14)',
              tension:.35, borderWidth:2.5, pointRadius:3, fill:false },
            { label:'Target (1.0)', data: e.weeks.map(() => 1),
              borderColor:'#f59e0b', borderDash:[6,4], borderWidth:1.5,
              pointRadius:0, fill:false }
          ]
        },
        options: {
          responsive:true, maintainAspectRatio:false,
          plugins:{
            legend:{labels:{color:'#e6edf7', font:{size:11}}},
            tooltip:{callbacks:{label:c => c.dataset.label + ': ' + c.parsed.y.toFixed(3)}}
          },
          scales:{
            x:{ticks:{color:'#8fa3c4'}, grid:{color:'rgba(36,54,92,.5)'}},
            y:{ticks:{color:'#8fa3c4', callback:v => v.toFixed(2)},
               grid:{color:'rgba(36,54,92,.5)'}, beginAtZero:false, suggestedMin:0.5}
          }
        }
      });
    }

    /* ── Variance chart: SV & CV per minggu ── */
    const cv2 = document.getElementById('chartEvmVariance');
    if (cv2){
      if (STATE.chartEvmVariance) STATE.chartEvmVariance.destroy();
      STATE.chartEvmVariance = new Chart(cv2.getContext('2d'), {
        type: 'bar',
        data: {
          labels: e.weeks.map(w => 'M' + w.week),
          datasets: [
            { label:'SV (Jadwal)', data: e.weeks.map(w => Math.round(w.SV)),
              backgroundColor: e.weeks.map(w => w.SV >= 0 ? 'rgba(34,197,94,.65)' : 'rgba(220,38,38,.65)'),
              borderRadius:4 },
            { label:'CV (Biaya)', data: e.weeks.map(w => Math.round(w.CV)),
              backgroundColor: e.weeks.map(w => w.CV >= 0 ? 'rgba(47,129,247,.65)' : 'rgba(245,158,11,.65)'),
              borderRadius:4 }
          ]
        },
        options: {
          responsive:true, maintainAspectRatio:false,
          plugins:{
            legend:{labels:{color:'#e6edf7', font:{size:11}}},
            tooltip:{callbacks:{label:c => c.dataset.label + ': ' + rp(c.parsed.y)}}
          },
          scales:{
            x:{ticks:{color:'#8fa3c4'}, grid:{display:false}},
            y:{ticks:{color:'#8fa3c4', callback:v => 'Rp ' + (v/1e6).toFixed(0) + 'jt'},
               grid:{color:'rgba(36,54,92,.5)'}}
          }
        }
      });
    }

    /* ── EVM table ── */
    const head = '<thead><tr>' +
      '<th>Minggu</th>' +
      '<th class="num">PV</th>' +
      '<th class="num">EV</th>' +
      '<th class="num">AC</th>' +
      (e.baselineIdx ? '<th class="num">Baseline</th>' : '') +
      '<th class="num">SV</th>' +
      '<th class="num">CV</th>' +
      '<th class="num">SPI</th>' +
      '<th class="num">CPI</th>' +
    '</tr></thead>';

    const body = e.weeks.map(w => {
      const spiC = w.SPI >= 0.95 ? 'spi-ok' : w.SPI >= 0.85 ? 'spi-warn' : 'spi-bad';
      const cpiC = w.CPI >= 0.95 ? 'cpi-ok' : w.CPI >= 0.85 ? 'cpi-warn' : 'cpi-bad';
      return '<tr class="evm-row">' +
        '<td><b>M' + w.week + '</b></td>' +
        '<td class="num">' + rp(w.PV) + '</td>' +
        '<td class="num">' + rp(w.EV) + '</td>' +
        '<td class="num">' + rp(w.AC) + '</td>' +
        (e.baselineIdx ? '<td class="num">' + rp(w.BL) + '</td>' : '') +
        '<td class="num ' + (w.SV >= 0 ? 'pos' : 'neg') + '">' + rp(w.SV) + '</td>' +
        '<td class="num ' + (w.CV >= 0 ? 'pos' : 'neg') + '">' + rp(w.CV) + '</td>' +
        '<td class="num ' + spiC + '">' + w.SPI.toFixed(3) + '</td>' +
        '<td class="num ' + cpiC + '">' + w.CPI.toFixed(3) + '</td>' +
      '</tr>';
    }).join('');

    const totalCols = 8 + (e.baselineIdx ? 1 : 0);
    const foot = '<tfoot><tr class="evm-forecast">' +
      '<td colspan="' + (totalCols) + '" style="text-align:right;padding:12px">' +
        '<b style="color:#a855f7">📌 FORECAST:</b> ' +
        'EAC = <b>' + rp(e.EAC) + '</b> · ' +
        'ETC = <b>' + rp(e.ETC) + '</b> · ' +
        'VAC = <b class="' + (e.VAC >= 0 ? 'pos' : 'neg') + '">' + rp(e.VAC) + '</b> · ' +
        'Selesai = <b>' + esc(e.forecastFinish) + '</b>' +
      '</td>' +
    '</tr></tfoot>';

    document.getElementById('tblEvm').innerHTML = head + '<tbody>' + body + '</tbody>' + foot;
  }
};

/* =====================================================================
   FASE 6C — IMPORT EXCEL BQ
   ===================================================================== */
const ImportExcel = {
  _workbook: null,
  _sheetName: null,
  _headers: [],
  _rows: [],
  _map: null,

  open(projectId){
    if (!projectId){ toast('Pilih proyek dulu', false); return; }
    if (typeof XLSX === 'undefined'){ toast('SheetJS belum dimuat', false); return; }

    const body =
      '<div class="imp-dropzone" id="impDrop">' +
        '<div class="imp-icon">📥</div>' +
        '<div class="imp-title">Drop file XLSX atau klik untuk pilih</div>' +
        '<div class="imp-hint">Format: .xlsx, .xls · Kolom minimal: <b>Kode</b>, <b>Uraian</b>, <b>Volume</b></div>' +
      '</div>' +
      '<input type="file" id="impFile" accept=".xlsx,.xls" style="display:none">' +
      '<div style="text-align:center;margin-bottom:14px">' +
        '<button class="btn btn-sm" id="impTemplate" style="background:linear-gradient(135deg,#16a34a,#0f8a3f);border-color:transparent;color:#fff">📄 Download Template XLSX</button>' +
      '</div>' +
      '<div id="impStep2" style="display:none"></div>';

    openModal('📥 Import BQ dari Excel', body, () => {});

    // Hide default submit
    const submitBtn = document.getElementById('mSubmit');
    if (submitBtn) submitBtn.style.display = 'none';
    const cancelBtn = document.getElementById('mCancel');
    if (cancelBtn) cancelBtn.textContent = 'Batal';

    // Wire drop zone
    const drop = document.getElementById('impDrop');
    const input = document.getElementById('impFile');
    drop.onclick = () => input.click();
    drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragover'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
    drop.addEventListener('drop', e => {
      e.preventDefault();
      drop.classList.remove('dragover');
      const f = e.dataTransfer.files[0];
      if (f) this._parseFile(f, projectId);
    });
    input.onchange = e => {
      const f = e.target.files[0];
      if (f) this._parseFile(f, projectId);
    };

    // Template
    document.getElementById('impTemplate').onclick = () => this._downloadTemplate();
  },

  _downloadTemplate(){
    const wb = XLSX.utils.book_new();
    const sample = [
      ['Kode', 'Uraian', 'STA', 'Satuan', 'Volume RAB', 'Volume RAP', 'AHSP Kode'],
      ['I.1', 'Galian tanah biasa', 'STA 0+000 - 0+100', 'm3', 1200, 1250, '1.1.1'],
      ['I.2', 'Timbunan & pemadatan', 'STA 0+000 - 0+100', 'm3', 800, 820, '1.1.2'],
      ['II.1', 'Beton struktur K-225', 'STA 0+000 - 0+100', 'm3', 150, 155, '1.2.1']
    ];
    const ws = XLSX.utils.aoa_to_sheet(sample);
    ws['!cols'] = [{ wch:10 }, { wch:40 }, { wch:24 }, { wch:8 }, { wch:12 }, { wch:12 }, { wch:12 }];
    XLSX.utils.book_append_sheet(wb, ws, 'BQ Template');
    XLSX.writeFile(wb, 'template-bq.xlsx');
    toast('Template didownload');
  },

  _parseFile(file, projectId){
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = new Uint8Array(ev.target.result);
        const wb = XLSX.read(data, { type: 'array' });
        const sheetName = wb.SheetNames[0];
        const sheet = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(sheet, { header:1, defval:'' });
        if (rows.length < 2){
          toast('File kosong atau tidak ada data', false);
          return;
        }
        this._workbook = wb;
        this._sheetName = sheetName;
        this._headers = rows[0].map(h => String(h||'').trim());
        this._rows = rows.slice(1).filter(r => r.some(c => String(c).trim() !== ''));
        this._map = this._autoMap(this._headers);
        this._renderStep2(projectId, file.name);
      } catch(err){
        toast('Gagal parse: ' + err.message, false);
      }
    };
    reader.readAsArrayBuffer(file);
  },

  _autoMap(headers){
    const norm = s => String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
    const find = (keywords) => {
      for (let i = 0; i < headers.length; i++){
        const h = norm(headers[i]);
        if (keywords.some(k => h.includes(k))) return i;
      }
      return -1;
    };
    return {
      kode:    find(['kode', 'id', 'code', 'no']),
      uraian:  find(['uraian', 'nama', 'name', 'item', 'pekerjaan', 'description']),
      sta:     find(['sta', 'lokasi', 'location']),
      satuan:  find(['satuan', 'unit', 'uom']),
      volRAB:  find(['vrab', 'volume', 'qty', 'kuantitas', 'quantity']),
      volRAP:  find(['vrap', 'volume2', 'rap']),
      ahsp:    find(['ahsp'])
    };
  },

  _renderStep2(projectId, fileName){
    const wrap = document.getElementById('impStep2');
    wrap.style.display = 'block';

    const headerOpts = (selIdx) =>
      '<option value="-1">— Tidak di-map —</option>' +
      this._headers.map((h, i) =>
        '<option value="' + i + '"' + (selIdx === i ? ' selected' : '') + '>' + esc(h || 'Kolom ' + (i+1)) + '</option>'
      ).join('');

    // Preview 5 baris pertama
    const preview = this._rows.slice(0, 8).map((r, i) =>
      '<tr>' +
      '<td><b>' + (i + 1) + '</b></td>' +
      this._headers.map((_, ci) => '<td>' + esc(String(r[ci]||'').substring(0, 40)) + '</td>').join('') +
      '</tr>'
    ).join('');

    wrap.innerHTML =
      '<div class="imp-summary">' +
        '<div class="imp-stat"><div class="lbl">File</div><div class="val" style="font-size:12px">' + esc(fileName) + '</div></div>' +
        '<div class="imp-stat"><div class="lbl">Sheet</div><div class="val" style="font-size:12px">' + esc(this._sheetName) + '</div></div>' +
        '<div class="imp-stat"><div class="lbl">Total Baris</div><div class="val">' + this._rows.length + '</div></div>' +
        '<div class="imp-stat"><div class="lbl">Total Kolom</div><div class="val">' + this._headers.length + '</div></div>' +
      '</div>' +

      '<div class="imp-mapper">' +
        '<h4>🔗 Mapping Kolom</h4>' +
        '<div class="imp-map-grid">' +
          '<div class="imp-map-item"><label>Kode WBS *</label><select class="imp-map" data-field="kode">' + headerOpts(this._map.kode) + '</select></div>' +
          '<div class="imp-map-item"><label>Uraian *</label><select class="imp-map" data-field="uraian">' + headerOpts(this._map.uraian) + '</select></div>' +
          '<div class="imp-map-item"><label>STA</label><select class="imp-map" data-field="sta">' + headerOpts(this._map.sta) + '</select></div>' +
          '<div class="imp-map-item"><label>Satuan</label><select class="imp-map" data-field="satuan">' + headerOpts(this._map.satuan) + '</select></div>' +
          '<div class="imp-map-item"><label>Volume RAB</label><select class="imp-map" data-field="volRAB">' + headerOpts(this._map.volRAB) + '</select></div>' +
          '<div class="imp-map-item"><label>Volume RAP</label><select class="imp-map" data-field="volRAP">' + headerOpts(this._map.volRAP) + '</select></div>' +
          '<div class="imp-map-item"><label>Kode AHSP</label><select class="imp-map" data-field="ahsp">' + headerOpts(this._map.ahsp) + '</select></div>' +
        '</div>' +
      '</div>' +

      '<div class="panel-head" style="margin-bottom:6px"><h3 style="font-size:12px">👁 Preview (8 baris pertama)</h3></div>' +
      '<div class="imp-preview">' +
        '<table>' +
          '<thead><tr><th style="width:40px">#</th>' +
            this._headers.map(h => '<th>' + esc(h || '—') + '</th>').join('') +
          '</tr></thead>' +
          '<tbody>' + preview + '</tbody>' +
        '</table>' +
      '</div>' +

      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">' +
        '<button class="btn" id="impBack">← Ganti File</button>' +
        '<button class="btn btn-ok" id="impCommit">✅ Import ke WBS</button>' +
      '</div>';

    // Wire mapper change
    wrap.querySelectorAll('.imp-map').forEach(sel => {
      sel.onchange = () => {
        this._map[sel.getAttribute('data-field')] = parseInt(sel.value, 10);
      };
    });

    document.getElementById('impBack').onclick = () => {
      wrap.style.display = 'none';
      document.getElementById('impFile').value = '';
    };

    document.getElementById('impCommit').onclick = () => this._commit(projectId);
  },

  _commit(projectId){
    if (this._map.kode < 0){ toast('Kolom "Kode WBS" wajib di-map', false); return; }
    if (this._map.uraian < 0){ toast('Kolom "Uraian" wajib di-map', false); return; }

    if (typeof Undo !== 'undefined') Undo.snapshot('Import BQ ' + this._rows.length + ' baris');

    // Build AHSP map kode → id
    const ahspByKode = {};
    DB.ahsp_headers.forEach(a => { ahspByKode[String(a.kode).trim().toLowerCase()] = a.id; });

    // Ambil urutan terakhir
    let maxUrut = DB.project_wbs
      .filter(w => w.project_id === projectId)
      .reduce((m, w) => Math.max(m, num(w.urut)||0), 0);

    let added = 0;
    let skipped = 0;
    this._rows.forEach(r => {
      const kode = String(r[this._map.kode] || '').trim();
      const uraian = String(r[this._map.uraian] || '').trim();
      if (!kode || !uraian){ skipped++; return; }

      const sta = this._map.sta >= 0 ? String(r[this._map.sta] || '').trim() : '';
      const satuan = this._map.satuan >= 0 ? String(r[this._map.satuan] || '').trim() : '';
      const volRAB = this._map.volRAB >= 0 ? num(r[this._map.volRAB]) : 0;
      const volRAP = this._map.volRAP >= 0 ? num(r[this._map.volRAP]) : volRAB;
      const ahspKode = this._map.ahsp >= 0 ? String(r[this._map.ahsp] || '').trim().toLowerCase() : '';

      // Detect group by kode (romawi saja, atau ada titik)
      const isGroup = /^[IVX]+$/i.test(kode) || (!satuan && volRAB === 0);
      const ahspId = ahspKode ? (ahspByKode[ahspKode] || '') : '';

      maxUrut++;
      DB.project_wbs.push({
        id: uid('wbs'),
        project_id: projectId,
        kode_wbs: kode,
        uraian,
        sta,
        satuan,
        volume_rab: volRAB,
        volume_rap: volRAP,
        ahsp_id: ahspId,
        parent_id: '',
        is_group: isGroup ? 1 : 0,
        urut: maxUrut,
        predecessor: '',
        pred_type: 'FS',
        lag_days: 0,
        duration: 1
      });
      added++;
    });

    runCPM(projectId);
    saveDB();

    const ganttEl = document.getElementById('ganttContainer');
    if (ganttEl) GanttView.mount(ganttEl, projectId, { mode:'rab', zoom: ganttEl._lastZoom || 'weekly' });

    closeModal();
    renderWbs();
    toast('✅ ' + added + ' baris di-import' + (skipped ? ' · ' + skipped + ' dilewati' : ''));

    // Reset state
    this._workbook = null;
    this._rows = [];
    this._headers = [];
    this._map = null;
  }
};

/* =====================================================================
   FASE 6 — HOOK: render dashboard EVM + tombol import
   ===================================================================== */
(function wireFase6(){
  function ready(fn){
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  ready(() => {
    // Tombol Import BQ
    const btn = document.getElementById('btnImportBQ');
    if (btn) btn.onclick = () => {
      if (!STATE.activeProject){ toast('Pilih proyek dulu', false); return; }
      ImportExcel.open(STATE.activeProject);
    };

    // Tombol EVM info
    const btnInfo = document.getElementById('btnEvmInfo');
    if (btnInfo) btnInfo.onclick = () => {
      openModal('ℹ Tentang EVM',
        '<p style="font-size:13px;line-height:1.7;color:var(--txt)">' +
          '<b>Earned Value Management (EVM)</b> adalah metode mengukur performa proyek dengan membandingkan 3 nilai:<br><br>' +
          '• <b>PV (Planned Value)</b> — Nilai pekerjaan yang <i>seharusnya</i> selesai per rencana<br>' +
          '• <b>EV (Earned Value)</b> — Nilai pekerjaan yang <i>sudah</i> dikerjakan (bobot RAB × progress)<br>' +
          '• <b>AC (Actual Cost)</b> — Biaya aktual yang sudah dikeluarkan<br><br>' +
          '<b>Indeks:</b><br>' +
          '• <b>SPI = EV / PV</b> → &lt;1 = telat, ≥1 = on/ahead schedule<br>' +
          '• <b>CPI = EV / AC</b> → &lt;1 = over budget, ≥1 = hemat<br><br>' +
          '<b>Forecast:</b><br>' +
          '• <b>EAC = BAC / CPI</b> → prediksi biaya akhir<br>' +
          '• <b>VAC = BAC − EAC</b> → selisih terhadap anggaran<br><br>' +
          '<i style="color:var(--muted)">Catatan: AC dihitung dari RAP × progress (approximation karena sistem tidak mencatat biaya aktual per transaksi).</i>' +
        '</p>',
        () => {}
      );
      setTimeout(() => { document.getElementById('mSubmit').style.display = 'none'; }, 10);
    };

    // ✅ PINDAHKAN HOOK INI KE DALAM READY()
    if (typeof window._origRenderDashboard === 'undefined'){
      window._origRenderDashboard = renderDashboard;
      window.renderDashboard = function(){
        window._origRenderDashboard();
        if (typeof EVMView !== 'undefined') EVMView.render();
      };
    }
  });
})();
