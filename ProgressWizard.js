/* =====================================================================
 * MANAJEMEN KONSTRUKSI v1 — PROGRESS UPDATE WIZARD
 * Fase 3C: Batch input progress multi-task × multi-minggu
 * Loaded AFTER Schedule.js — independent module
 * ===================================================================== */

(function progressWizardModule(){
  function bootstrap(attempt){
    attempt = attempt || 0;
    if (typeof DB === 'undefined' || !DB || typeof Calc === 'undefined'){
      if (attempt > 50){
        console.error('[ProgressWizard.js] Engine belum siap — menyerah');
        return;
      }
      setTimeout(function(){ bootstrap(attempt + 1); }, 300);
      return;
    }
    install();
  }

  function install(){
    if (window._progressWizardInstalled) return;
    window._progressWizardInstalled = true;

    /* ═══════════════════════════════════════════════════════════
       STATE (dialog)
       ═══════════════════════════════════════════════════════════ */
    var _state = {
      mFrom: 1,
      mTo: 4,
      filterGrup: '',
      criteria: 'all',       // all | critical | no-progress
      draft: {}              // { wbsId: { minggu: volume } }
    };

    /* ═══════════════════════════════════════════════════════════
       HELPERS
       ═══════════════════════════════════════════════════════════ */
    function _num(v){
      var n = parseFloat(String(v == null ? '' : v).replace(/[^\d.-]/g,''));
      return isFinite(n) ? n : 0;
    }
    function _fmt(n, d){
      d = d == null ? 2 : d;
      return (isFinite(n) ? Number(n) : 0).toLocaleString('id-ID', {
        minimumFractionDigits: d, maximumFractionDigits: d
      });
    }
    function _esc(s){
      return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
      });
    }

    function getActiveProj(){
      if (typeof STATE === 'undefined' || !STATE.activeProject) return null;
      return DB.projects.find(function(p){ return p.id === STATE.activeProject; });
    }

    function maxMinggu(proj){
      return Math.max(1, Math.round(_num(proj && proj.durasi_minggu) || 1));
    }

    /* ═══════════════════════════════════════════════════════════
       BUILD TASK LIST (dengan filter)
       ═══════════════════════════════════════════════════════════ */
    function buildTaskList(proj){
      if (!proj || !proj.id) return { tasks: [], allGroups: [] };
      var pid = proj.id;
      var allGroups = DB.project_wbs.filter(function(w){
        return w.project_id === pid && w.is_group;
      });
      var tasks = DB.project_wbs.filter(function(w){
        return w.project_id === pid && !w.is_group;
      });

      /* Filter by grup */
      if (_state.filterGrup){
        tasks = tasks.filter(function(t){ return t.parent_id === _state.filterGrup; });
      }

      /* Filter by criteria */
      if (_state.criteria === 'critical'){
        tasks = tasks.filter(function(t){ return _num(t.is_critical) === 1; });
      } else if (_state.criteria === 'no-progress'){
        var progWbsIds = {};
        DB.progress.filter(function(p){ return p.project_id === pid; }).forEach(function(p){
          progWbsIds[p.wbs_id] = true;
        });
        tasks = tasks.filter(function(t){ return !progWbsIds[t.id]; });
      }

      return { tasks: tasks, allGroups: allGroups };
    }

    /* ═══════════════════════════════════════════════════════════
       OPEN WIZARD DIALOG
       ═══════════════════════════════════════════════════════════ */
    function openWizard(){
      var proj = getActiveProj();
      if (!proj){
        if (typeof toast === 'function') toast('Pilih proyek aktif dulu', false);
        return;
      }
      if (typeof openModal !== 'function'){
        console.warn('[ProgressWizard] openModal tidak tersedia');
        return;
      }

      /* Reset state */
      _state.mFrom = 1;
      _state.mTo = Math.min(4, maxMinggu(proj));
      _state.filterGrup = '';
      _state.criteria = 'all';
      _state.draft = {};

      var html = buildWizardHTML(proj);
      openModal('📊 Progress Update Wizard', html, function(){ return false; });

      /* Hide default submit, inject custom footer */
      setTimeout(function(){
        var submitBtn = document.getElementById('mSubmit');
        if (submitBtn){
          submitBtn.textContent = '💾 Simpan Semua';
          submitBtn.style.display = '';
          submitBtn.onclick = saveAll;
        }
        wireWizardControls(proj);
        renderTaskTable(proj);
      }, 10);
    }

    /* ═══════════════════════════════════════════════════════════
       WIZARD HTML
       ═══════════════════════════════════════════════════════════ */
    function buildWizardHTML(proj){
      var maxM = maxMinggu(proj);
      var groups = DB.project_wbs.filter(function(w){
        return w.project_id === proj.id && w.is_group;
      });

      return '' +
        '<div class="pw-intro">' +
          '<b>📊 Input progress massal</b> untuk: <b style="color:#7cb3ff">' +
          _esc(proj.kode) + ' — ' + _esc(proj.nama) + '</b>' +
        '</div>' +

          '<div class="pw-f-item">' +
            '<label>Minggu Dari</label>' +
            '<input type="number" id="pwMFrom" min="1" max="52" value="' + _state.mFrom + '" />' +
          '</div>' +
          '<div class="pw-f-item">' +
            '<label>Minggu Ke</label>' +
            '<input type="number" id="pwMTo" min="1" max="52" value="' + _state.mTo + '" />' +
          '</div>' +
         
            '<label>Filter Grup</label>' +
            '<select id="pwGrup">' +
              '<option value="">— Semua Grup —</option>' +
              groups.map(function(g){
                return '<option value="' + g.id + '">' + _esc(g.kode_wbs) + ' — ' + _esc(g.uraian) + '</option>';
              }).join('') +
            '</select>' +
          '</div>' +
         
            '<label>Kriteria</label>' +
            '<select id="pwCrit">' +
              '<option value="all">Semua Task</option>' +
              '<option value="critical">Hanya Kritis</option>' +
              '<option value="no-progress">Belum Ada Progress</option>' +
            '</select>' +
          '</div>' +
        '</div>' +

        '<div class="pw-action-bar">' +
          '<button class="pw-btn pw-btn-auto" id="pwAuto">🔄 Auto-Distribute (Merata)</button>' +
          '<button class="pw-btn pw-btn-tri" id="pwTri">📐 Segitiga</button>' +
          '<button class="pw-btn pw-btn-bell" id="pwBell">🔔 Lonceng</button>' +
          '<button class="pw-btn pw-btn-clear" id="pwClear">🗑 Kosongkan</button>' +
          '<button class="pw-btn pw-btn-csv" id="pwCSV">📥 Template CSV</button>' +
          '<span class="pw-summary" id="pwSummary"></span>' +
        '</div>' +

        '<div class="pw-table-wrap" id="pwTableWrap">' +
          '<div class="pw-empty">Memuat table…</div>' +
        '</div>';
    }

    /* ═══════════════════════════════════════════════════════════
       RENDER TABLE PREVIEW
       ═══════════════════════════════════════════════════════════ */
    function renderTaskTable(proj){
      var wrap = document.getElementById('pwTableWrap');
      if (!wrap) return;

      var list = buildTaskList(proj);
      var tasks = list.tasks;

      if (!tasks.length){
        wrap.innerHTML = '<div class="pw-empty">Tidak ada task yang cocok dengan filter</div>';
        updateSummary();
        return;
      }

      var mFrom = _state.mFrom;
      var mTo = _state.mTo;
      var weeks = [];
      for (var m = mFrom; m <= mTo; m++) weeks.push(m);

      /* Header */
      var head = '<thead><tr>' +
        '<th class="pw-th-kode">Kode</th>' +
        '<th class="pw-th-uraian">Uraian</th>' +
        '<th class="pw-th-sat">Sat</th>' +
        '<th class="pw-th-vol">Vol RAB</th>' +
        weeks.map(function(m){ return '<th class="pw-th-week">M' + m + '</th>'; }).join('') +
        '<th class="pw-th-input">Input</th>' +
        '<th class="pw-th-pct">%</th>' +
        '</tr></thead>';

      /* Body */
      var body = tasks.map(function(t){
        var target = _num(t.volume_rab) || 0;
        var draft = _state.draft[t.id] || {};
        var sum = weeks.reduce(function(s, m){ return s + _num(draft[m]); }, 0);

        /* Volume existing dari progress (untuk referensi) */
        var existing = DB.progress
          .filter(function(p){ return p.project_id === proj.id && p.wbs_id === t.id; })
          .reduce(function(s, p){ return s + _num(p.volume); }, 0);

        var pct = target > 0 ? (sum / target * 100) : 0;
        var pctCls = pct >= 100 ? 'ok' : pct > 0 ? 'warn' : '';

        var cells = weeks.map(function(m){
          var v = draft[m];
          var valStr = (v === undefined || v === null) ? '' : v;
          return '<td class="pw-cell">' +
            '<input type="number" step="0.01" min="0" class="pw-input" ' +
              'data-wbs="' + _esc(t.id) + '" data-minggu="' + m + '" ' +
              'value="' + valStr + '" placeholder="—" />' +
          '</td>';
        }).join('');

        return '<tr data-wbs-row="' + _esc(t.id) + '">' +
          '<td class="pw-td-kode">' + _esc(t.kode_wbs) + '</td>' +
          '<td class="pw-td-uraian" title="' + _esc(t.uraian) + '">' + _esc(t.uraian) + '</td>' +
          '<td class="pw-td-sat">' + _esc(t.satuan || '-') + '</td>' +
          '<td class="pw-td-vol">' + _fmt(target, 2) + '</td>' +
          cells +
          '<td class="pw-td-input" data-sum="' + _esc(t.id) + '">' + _fmt(sum, 2) + '</td>' +
          '<td class="pw-td-pct ' + pctCls + '" data-pct="' + _esc(t.id) + '">' + _fmt(pct, 1) + '%</td>' +
        '</tr>';
      }).join('');

      wrap.innerHTML = '<table class="pw-table">' + head + '<tbody>' + body + '</tbody></table>';

      /* Wire input events */
      wrap.querySelectorAll('.pw-input').forEach(function(inp){
        inp.addEventListener('input', onCellInput);
        inp.addEventListener('change', onCellInput);
      });

      /* Auto-scroll kolom minggu ke minggu awal */
      updateSummary();
    }

    /* ═══════════════════════════════════════════════════════════
       INPUT HANDLER
       ═══════════════════════════════════════════════════════════ */
    function onCellInput(e){
      var inp = e.target;
      var wbsId = inp.getAttribute('data-wbs');
      var minggu = parseInt(inp.getAttribute('data-minggu'), 10);
      var val = _num(inp.value);

      if (!_state.draft[wbsId]) _state.draft[wbsId] = {};
      if (val > 0) _state.draft[wbsId][minggu] = val;
      else delete _state.draft[wbsId][minggu];

      /* Update row summary */
      var sum = Object.keys(_state.draft[wbsId]).reduce(function(s, m){
        return s + _num(_state.draft[wbsId][m]);
      }, 0);

      var proj = getActiveProj();
      var task = DB.project_wbs.find(function(t){ return t.id === wbsId; });
      var target = task ? _num(task.volume_rab) : 0;
      var pct = target > 0 ? (sum / target * 100) : 0;
      var pctCls = pct >= 100 ? 'ok' : pct > 0 ? 'warn' : '';

      var sumEl = document.querySelector('[data-sum="' + wbsId + '"]');
      if (sumEl) sumEl.textContent = _fmt(sum, 2);

      var pctEl = document.querySelector('[data-pct="' + wbsId + '"]');
      if (pctEl){
        pctEl.textContent = _fmt(pct, 1) + '%';
        pctEl.className = 'pw-td-pct ' + pctCls;
      }

      updateSummary();
    }

    /* ═══════════════════════════════════════════════════════════
       AUTO-DISTRIBUTE
       ═══════════════════════════════════════════════════════════ */
    function autoDistribute(mode){
      var proj = getActiveProj();
      if (!proj) return;

      var list = buildTaskList(proj);
      var mFrom = _state.mFrom;
      var mTo = _state.mTo;
      var nWeeks = mTo - mFrom + 1;
      if (nWeeks <= 0) return;

      /* Bobot distribusi */
      var weights = [];
      if (mode === 'tri'){
        var c = (nWeeks - 1) / 2;
        for (var i = 0; i < nWeeks; i++){
          weights.push(1 - Math.abs(i - c) / (c || 1) + 0.05);
        }
      } else if (mode === 'bell'){
        var c2 = (nWeeks - 1) / 2;
        var sig = nWeeks / 4 || 1;
        for (var j = 0; j < nWeeks; j++){
          weights.push(Math.exp(-Math.pow((j - c2) / sig, 2)) + 0.02);
        }
      } else {
        for (var k = 0; k < nWeeks; k++) weights.push(1);
      }

      var wSum = weights.reduce(function(s, x){ return s + x; }, 0) || 1;
      weights = weights.map(function(x){ return x / wSum; });

      /* Clear draft dulu */
      list.tasks.forEach(function(t){
        _state.draft[t.id] = {};
        var target = _num(t.volume_rab) || 0;
        for (var w = 0; w < nWeeks; w++){
          var m = mFrom + w;
          var v = target * weights[w];
          if (v > 0.001){
            /* Round ke 3 desimal */
            _state.draft[t.id][m] = Math.round(v * 1000) / 1000;
          }
        }
      });

      renderTaskTable(proj);
      if (typeof toast === 'function'){
        var modeLabel = mode === 'tri' ? 'Segitiga' : mode === 'bell' ? 'Lonceng' : 'Merata';
        toast('🔄 Auto-distribute ' + modeLabel + ' untuk ' + list.tasks.length + ' task');
      }
    }

    /* ═══════════════════════════════════════════════════════════
       CLEAR
       ═══════════════════════════════════════════════════════════ */
    function clearDraft(){
      _state.draft = {};
      var proj = getActiveProj();
      if (proj) renderTaskTable(proj);
      if (typeof toast === 'function') toast('🗑 Draft dikosongkan');
    }

    /* ═══════════════════════════════════════════════════════════
       SUMMARY BAR
       ═══════════════════════════════════════════════════════════ */
    function updateSummary(){
      var el = document.getElementById('pwSummary');
      if (!el) return;
      var tasks = Object.keys(_state.draft);
      var totalCells = 0;
      var totalVal = 0;
      tasks.forEach(function(id){
        var weeks = _state.draft[id] || {};
        Object.keys(weeks).forEach(function(m){
          totalCells++;
          totalVal += _num(weeks[m]);
        });
      });
      el.innerHTML = '<b>' + tasks.length + '</b> task · ' +
                     '<b>' + totalCells + '</b> entri · ' +
                     'total vol <b>' + _fmt(totalVal, 2) + '</b>';
    }

    /* ═══════════════════════════════════════════════════════════
       SAVE ALL — batch insert to DB.progress
       ═══════════════════════════════════════════════════════════ */
    function saveAll(){
      var proj = getActiveProj();
      if (!proj){ if (typeof toast === 'function') toast('Proyek tidak ditemukan', false); return; }

      var tasks = Object.keys(_state.draft);
      if (!tasks.length){
        if (typeof toast === 'function') toast('Belum ada data untuk disimpan', false);
        return;
      }

      /* Konfirmasi */
      var totalEntries = 0;
      tasks.forEach(function(id){
        totalEntries += Object.keys(_state.draft[id]).length;
      });
      if (!confirm('Simpan ' + totalEntries + ' entri progress untuk ' + tasks.length + ' task?')) return;

      /* Undo snapshot */
      if (typeof Undo !== 'undefined' && Undo.snapshot){
        Undo.snapshot('Progress Wizard: ' + totalEntries + ' entri');
      }

      /* Insert / update */
      var added = 0;
      tasks.forEach(function(wbsId){
        var weeks = _state.draft[wbsId] || {};
        Object.keys(weeks).forEach(function(m){
          var minggu = parseInt(m, 10);
          var vol = _num(weeks[m]);
          if (vol <= 0) return;

          /* Cek existing entry (project + wbs + minggu) */
          var existing = DB.progress.find(function(p){
            return p.project_id === proj.id && p.wbs_id === wbsId && _num(p.minggu) === minggu;
          });

          if (existing){
            existing.volume = vol;
            existing.tanggal = new Date().toISOString().slice(0,10);
          } else {
            DB.progress.push({
              id: (typeof uid === 'function') ? uid('pg') : ('pg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)),
              project_id: proj.id,
              wbs_id: wbsId,
              minggu: minggu,
              volume: vol,
              tanggal: new Date().toISOString().slice(0,10)
            });
          }
          added++;
        });
      });

      /* Save + recompute */
      if (typeof saveDB === 'function') saveDB();
      if (typeof runCPM === 'function') runCPM(proj.id);
      if (typeof saveDB === 'function') saveDB();

      /* Refresh UI */
      if (typeof renderProgress === 'function') renderProgress();
      if (typeof renderSchedule === 'function') renderSchedule();

      /* Close modal */
      if (typeof closeModal === 'function') closeModal();

      if (typeof toast === 'function'){
        toast('✅ ' + added + ' entri progress disimpan untuk ' + tasks.length + ' task');
      }
    }

    /* ═══════════════════════════════════════════════════════════
       EXPORT TEMPLATE CSV
       ═══════════════════════════════════════════════════════════ */
    function exportTemplateCSV(){
      var proj = getActiveProj();
      if (!proj) return;

      var list = buildTaskList(proj);
      var mFrom = _state.mFrom;
      var mTo = _state.mTo;
      var weeks = [];
      for (var m = mFrom; m <= mTo; m++) weeks.push(m);

      var header = ['Kode', 'Uraian', 'Satuan', 'Vol RAB'].concat(weeks.map(function(m){ return 'M' + m; }));

      var rows = list.tasks.map(function(t){
        var draft = _state.draft[t.id] || {};
        return [
          t.kode_wbs,
          '"' + String(t.uraian || '').replace(/"/g, '""') + '"',
          t.satuan || '',
          _num(t.volume_rab)
        ].concat(weeks.map(function(m){
          var v = draft[m];
          return (v === undefined || v === null) ? '' : v;
        }));
      });

      var csv = [header.join(',')].concat(rows.map(function(r){ return r.join(','); })).join('\n');
      var blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'progress-template-' + proj.kode + '-' + new Date().toISOString().slice(0,10) + '.csv';
      a.click();
      if (typeof toast === 'function') toast('📥 Template CSV diunduh');
    }

    /* ═══════════════════════════════════════════════════════════
       WIRE CONTROLS
       ═══════════════════════════════════════════════════════════ */
    function wireWizardControls(proj){
      var el;

      el = document.getElementById('pwMFrom');
      if (el) el.onchange = function(){
        var v = parseInt(el.value, 10) || 1;
        _state.mFrom = Math.max(1, Math.min(v, _state.mTo));
        el.value = _state.mFrom;
        renderTaskTable(proj);
      };

      el = document.getElementById('pwMTo');
      if (el) el.onchange = function(){
        var v = parseInt(el.value, 10) || 1;
        /* Sync ke _state dengan validasi longgar */
        if (v < _state.mFrom) v = _state.mFrom;
        if (v > 52) v = 52;
        _state.mTo = v;
        el.value = _state.mTo;
        renderTaskTable(proj);
      };

      el = document.getElementById('pwGrup');
      if (el) el.onchange = function(){
        _state.filterGrup = el.value;
        renderTaskTable(proj);
      };

      el = document.getElementById('pwCrit');
      if (el) el.onchange = function(){
        _state.criteria = el.value;
        renderTaskTable(proj);
      };

      el = document.getElementById('pwAuto');
      if (el) el.onclick = function(){ autoDistribute('uniform'); };

      el = document.getElementById('pwTri');
      if (el) el.onclick = function(){ autoDistribute('tri'); };

      el = document.getElementById('pwBell');
      if (el) el.onclick = function(){ autoDistribute('bell'); };

      el = document.getElementById('pwClear');
      if (el) el.onclick = function(){ clearDraft(); };

      el = document.getElementById('pwCSV');
      if (el) el.onclick = exportTemplateCSV;
    }

    /* ═══════════════════════════════════════════════════════════
       PUBLIC API
       ═══════════════════════════════════════════════════════════ */
    window.openProgressWizard = openWizard;
    window.ProgressWizard = { open: openWizard };

    /* ── Auto wire tombol di tab Progress (kalau ada) ── */
    function wireTopbarBtn(){
      /* Cari tombol di section Progress */
      var btn = document.getElementById('btnProgressWizard');
      if (btn && !btn._wired){
        btn._wired = true;
        btn.onclick = openWizard;
      }
    }

    if (document.readyState === 'loading'){
      document.addEventListener('DOMContentLoaded', wireTopbarBtn);
    } else {
      wireTopbarBtn();
    }
    /* Retry wiring karena tab bisa di-render setelah init */
    setTimeout(wireTopbarBtn, 1000);
    setTimeout(wireTopbarBtn, 3000);

    console.log('%c[ProgressWizard.js] ✅ Progress Update Wizard installed',
      'color:#a855f7;font-weight:bold;font-size:13px');
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ bootstrap(0); });
  } else {
    bootstrap(0);
  }
})();
