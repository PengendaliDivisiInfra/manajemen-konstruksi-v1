/* =====================================================================
   MODUL BULK PROGRESS INPUT — Input Volume Aktual Massal
   Input volume aktual per Hari/Minggu untuk semua WBS sekaligus
   Dilengkapi auto-fill: Merata, Sesuai Rencana, Sisa Semua
   ===================================================================== */

(function bulkProgressInputModule(){
  function bootstrap(attempt){
    attempt = attempt || 0;
    if (typeof DB === 'undefined' || !DB || typeof ProgressManager === 'undefined'){
      if (attempt > 50){
        console.error('[BulkProgressInput.js] Engine belum siap — menyerah');
        return;
      }
      setTimeout(function(){ bootstrap(attempt + 1); }, 300);
      return;
    }
    install();
  }

  function install(){
    if (window._bulkProgressInputInstalled) return;
    window._bulkProgressInputInstalled = true;

    var _state = {
      mode: 'weekly',
      minggu: 1,
      tanggal: new Date().toISOString().slice(0,10),
      draft: {},
      filterGrup: '',
      showOnlyRemaining: true
    };

    /* ─── Utility wrappers ─── */
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
    function _esc(s){
      if (typeof esc === 'function') return esc(s);
      return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
      });
    }
    function _uid(p){
      if (typeof uid === 'function') return uid(p);
      return (p||'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
    }
    function _toast(msg, ok){
      if (typeof toast === 'function') toast(msg, ok !== false);
    }

    /* ─── Helpers ─── */
    function getProj(){
      if (typeof STATE === 'undefined' || !STATE.activeProject) return null;
      return DB.projects.find(function(p){ return p.id === STATE.activeProject; }) || null;
    }

        /* ─── Helper: Ambil tasks untuk grup (parent_id ATAU kode_wbs prefix) ─── */
   function getTasksForGroup(proj, groupId){
     var group = DB.project_wbs.find(function(w){ return w.id === groupId; });
     if (!group) return [];
   
     // Prioritas 1: filter by parent_id
     var tasks = DB.project_wbs.filter(function(t){
       return t.project_id === proj.id && !t.is_group && t.parent_id === groupId;
     });
   
     // Fallback: kalau kosong, cocokkan berdasarkan prefix kode_wbs
     if (!tasks.length && group.kode_wbs){
       var prefix = String(group.kode_wbs).trim();
       tasks = DB.project_wbs.filter(function(t){
         if (t.project_id !== proj.id || t.is_group) return false;
         var kode = String(t.kode_wbs || '').trim();
         return kode.startsWith(prefix + '.') && kode !== prefix;
       });
     }
   
     return tasks;
   }

    function maxMinggu(proj){
      return Math.max(1, Math.round(_num(proj && proj.durasi_minggu) || 1));
    }

    function mingguDariTanggal(proj, tglISO){
      if (!proj.tgl_mulai || !tglISO) return 1;
      var d1 = new Date(proj.tgl_mulai + 'T00:00:00');
      var d2 = new Date(tglISO + 'T00:00:00');
      if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return 1;
      var diffDays = Math.round((d2 - d1) / 86400000);
      return Math.max(1, Math.floor(diffDays / 7) + 1);
    }

    function tanggalDariMinggu(proj, minggu){
      if (!proj.tgl_mulai) return new Date().toISOString().slice(0,10);
      var d = new Date(proj.tgl_mulai + 'T00:00:00');
      d.setDate(d.getDate() + (minggu - 1) * 7);
      var y = d.getFullYear();
      var m = String(d.getMonth()+1).padStart(2,'0');
      var day = String(d.getDate()).padStart(2,'0');
      return y + '-' + m + '-' + day;
    }

    function getVolKumulatif(projectId, wbsId, mingguMax){
      var total = 0;
      DB.progress
        .filter(function(p){ return p.project_id === projectId && p.wbs_id === wbsId; })
        .forEach(function(p){
          if (_num(p.minggu) <= mingguMax) total += _num(p.volume);
        });
      return total;
    }

    function getVolMinggu(projectId, wbsId, minggu){
      var total = 0;
      DB.progress
        .filter(function(p){
          return p.project_id === projectId && p.wbs_id === wbsId && _num(p.minggu) === minggu;
        })
        .forEach(function(p){ total += _num(p.volume); });
      return total;
    }

    /* ═══════════════════════════════════════════════════════════
       MAIN: OPEN BULK INPUT
       ═══════════════════════════════════════════════════════════ */
    function openBulk(){
      var proj = getProj();
      if (!proj){
        _toast('Pilih proyek dulu', false);
        return;
      }
      if (typeof openModal !== 'function'){
        console.warn('[BulkProgressInput] openModal tidak tersedia');
        return;
      }

      _state.mode = 'weekly';
      _state.minggu = 1;
      _state.tanggal = proj.tgl_mulai || new Date().toISOString().slice(0,10);
      _state.draft = {};
      _state.filterGrup = '';
      _state.showOnlyRemaining = true;

      var html = buildHTML(proj);
      openModal('📥 Bulk Input Progress', html, function(){ return false; });

      setTimeout(function(){
        var submitBtn = document.getElementById('mSubmit');
        if (submitBtn){
          submitBtn.textContent = '💾 Simpan Semua';
          submitBtn.style.display = '';
          submitBtn.onclick = function(){ saveAll(); };
        }
        var cancelBtn = document.getElementById('mCancel');
        if (cancelBtn) cancelBtn.textContent = 'Batal';
        wireControls(proj);
        renderTable(proj);
      }, 10);
    }

    /* ─── Build modal HTML ─── */
    function buildHTML(proj){
      var groups = DB.project_wbs.filter(function(w){
        return w.project_id === proj.id && w.is_group;
      });

      return '' +
        '<div class="bp-intro">' +
          '<b>📥 Input volume aktual massal</b> untuk: ' +
          '<b style="color:#7cb3ff">' + _esc(proj.kode) + ' — ' + _esc(proj.nama) + '</b>' +
        '</div>' +

        '<div class="bp-mode-bar">' +
          '<button class="bp-mode-btn is-active" data-mode="weekly">📅 Per Minggu</button>' +
          '<button class="bp-mode-btn" data-mode="daily">📆 Per Hari</button>' +
        '</div>' +

        '<div class="bp-filter-bar">' +
          '<div class="bp-f-item bp-f-weekly">' +
            '<label>Minggu ke-</label>' +
            '<input type="number" id="bpMinggu" min="1" max="' + maxMinggu(proj) + '" value="1" />' +
          '</div>' +
          '<div class="bp-f-item bp-f-daily" style="display:none">' +
            '<label>Tanggal</label>' +
            '<input type="date" id="bpTanggal" value="' + _esc(proj.tgl_mulai || '') + '" />' +
          '</div>' +
          '<div class="bp-f-item">' +
            '<label>Filter Grup</label>' +
            '<select id="bpGrup">' +
              '<option value="">— Semua Grup —</option>' +
              groups.map(function(g){
                return '<option value="' + g.id + '">' + _esc(g.kode_wbs) + ' — ' + _esc(g.uraian) + '</option>';
              }).join('') +
            '</select>' +
          '</div>' +
          '<div class="bp-f-item">' +
            '<label>&nbsp;</label>' +
            '<label class="bp-chk"><input type="checkbox" id="bpHideRemaining" checked> Hanya yang belum 100%</label>' +
          '</div>' +
        '</div>' +

        '<div class="bp-action-bar">' +
          '<span class="bp-lbl">Auto-fill:</span>' +
          '<button class="bp-btn bp-btn-auto" data-fill="uniform">🔄 Merata</button>' +
          '<button class="bp-btn bp-btn-plan" data-fill="plan">📊 Sesuai Rencana</button>' +
          '<button class="bp-btn bp-btn-remain" data-fill="remaining">⏭ Sisa Semua</button>' +
          '<button class="bp-btn bp-btn-clear" data-fill="clear">🗑 Kosongkan</button>' +
          '<span class="bp-summary" id="bpSummary"></span>' +
        '</div>' +

        '<div class="bp-table-wrap" id="bpTableWrap">' +
          '<div class="bp-empty">Memuat table…</div>' +
        '</div>';
    }

    /* ═══════════════════════════════════════════════════════════
       RENDER TABLE
       ═══════════════════════════════════════════════════════════ */
    function renderTable(proj){
      var wrap = document.getElementById('bpTableWrap');
      if (!wrap) return;

      // Sync state dari DOM
      var mingguInput = document.getElementById('bpMinggu');
      if (mingguInput){
        var mv = parseInt(mingguInput.value, 10);
        if (!isNaN(mv) && mv >= 1) _state.minggu = mv;
      }
      var tanggalInput = document.getElementById('bpTanggal');
      if (tanggalInput) _state.tanggal = tanggalInput.value;

      // Ambil tasks
      var tasks = DB.project_wbs.filter(function(w){
        return w.project_id === proj.id && !w.is_group;
      });
      if (_state.filterGrup){
        tasks = tasks.filter(function(t){ return t.parent_id === _state.filterGrup; });
      }

      // Pre-compute data
      var tasksWithData = tasks.map(function(t){
        var volRAB = _num(t.volume_rab);
        var volBefore = getVolKumulatif(proj.id, t.id, _state.minggu - 1);
        var sisa = Math.max(0, volRAB - volBefore);
        return {
          wbs: t,
          volRAB: volRAB,
          volBefore: volBefore,
          sisa: sisa,
          pctBefore: volRAB > 0 ? Math.min(100, volBefore / volRAB * 100) : 0
        };
      });

      if (_state.showOnlyRemaining){
        tasksWithData = tasksWithData.filter(function(r){ return r.pctBefore < 99.99; });
      }

      if (!tasksWithData.length){
        wrap.innerHTML = '<div class="bp-empty">✅ Semua task sudah 100% selesai — tidak ada yang perlu diinput.</div>';
        updateSummary();
        return;
      }

      // Table header
      var head = '<thead><tr>' +
        '<th class="bp-th-check"><input type="checkbox" id="bpSelectAll"></th>' +
        '<th class="bp-th-kode">Kode</th>' +
        '<th class="bp-th-uraian">Uraian</th>' +
        '<th class="bp-th-sat">Sat</th>' +
        '<th class="bp-th-vol num">Vol RAB</th>' +
        '<th class="bp-th-cum num">Kumulatif</th>' +
        '<th class="bp-th-sisa num">Sisa</th>' +
        '<th class="bp-th-input num">Input Aktual</th>' +
        '<th class="bp-th-total num">Kum. Baru</th>' +
        '<th class="bp-th-pct num">%</th>' +
        '</tr></thead>';

      var body = tasksWithData.map(function(r){
        var t = r.wbs;
        var draftVal = _state.draft[t.id];
        var inputVal = (draftVal === undefined || draftVal === null) ? '' : draftVal;
        var volInput = _num(inputVal);
        var kumulatifBaru = r.volBefore + volInput;
        var pctNew = r.volRAB > 0 ? Math.min(100, kumulatifBaru / r.volRAB * 100) : 0;
        var pctCls = pctNew >= 100 ? 'ok' : pctNew > 0 ? 'warn' : '';
        var overCls = kumulatifBaru > r.volRAB + 0.01 ? 'over' : '';

        return '<tr data-bp-row="' + _esc(t.id) + '" class="' + overCls + '">' +
          '<td class="bp-td-check"><input type="checkbox" class="bp-chk-row" data-wbs="' + _esc(t.id) + '"></td>' +
          '<td class="bp-td-kode">' + _esc(t.kode_wbs) + '</td>' +
          '<td class="bp-td-uraian" title="' + _esc(t.uraian) + '">' + _esc(t.uraian) + '</td>' +
          '<td class="bp-td-sat">' + _esc(t.satuan || '-') + '</td>' +
          '<td class="bp-td-vol num">' + _fmt(r.volRAB, 2) + '</td>' +
          '<td class="bp-td-cum num">' + _fmt(r.volBefore, 2) + '</td>' +
          '<td class="bp-td-sisa num">' + _fmt(r.sisa, 2) + '</td>' +
          '<td class="bp-td-input">' +
            '<input type="number" step="0.01" min="0" class="bp-input" ' +
              'data-wbs="' + _esc(t.id) + '" ' +
              'value="' + _esc(inputVal) + '" ' +
              'placeholder="—" />' +
          '</td>' +
          '<td class="bp-td-total num" data-new-cum="' + _esc(t.id) + '">' + _fmt(kumulatifBaru, 2) + '</td>' +
          '<td class="bp-td-pct ' + pctCls + '" data-new-pct="' + _esc(t.id) + '">' + _fmt(pctNew, 1) + '%</td>' +
        '</tr>';
      }).join('');

      wrap.innerHTML = '<table class="bp-table">' + head + '<tbody>' + body + '</tbody></table>';

      // Wire events
      wrap.querySelectorAll('.bp-input').forEach(function(inp){
        inp.addEventListener('input', onCellInput);
        inp.addEventListener('change', onCellInput);
      });

      var selAll = document.getElementById('bpSelectAll');
      if (selAll){
        selAll.onclick = function(){
          wrap.querySelectorAll('.bp-chk-row').forEach(function(chk){
            chk.checked = selAll.checked;
          });
        };
      }

      updateSummary();
    }

    function onCellInput(e){
      var inp = e.target;
      var wbsId = inp.getAttribute('data-wbs');
      var val = _num(inp.value);

      if (val > 0) _state.draft[wbsId] = val;
      else delete _state.draft[wbsId];

      var task = DB.project_wbs.find(function(t){ return t.id === wbsId; });
      if (!task) return;

      var volBefore = getVolKumulatif(task.project_id, wbsId, _state.minggu - 1);
      var kumulatifBaru = volBefore + val;
      var volRAB = _num(task.volume_rab);
      var pct = volRAB > 0 ? Math.min(100, kumulatifBaru / volRAB * 100) : 0;

      var cumEl = document.querySelector('[data-new-cum="' + wbsId + '"]');
      if (cumEl) cumEl.textContent = _fmt(kumulatifBaru, 2);

      var pctEl = document.querySelector('[data-new-pct="' + wbsId + '"]');
      if (pctEl){
        pctEl.textContent = _fmt(pct, 1) + '%';
        pctEl.className = 'bp-td-pct ' + (pct >= 100 ? 'ok' : pct > 0 ? 'warn' : '');
      }

      var row = document.querySelector('[data-bp-row="' + wbsId + '"]');
      if (row) row.classList.toggle('over', kumulatifBaru > volRAB + 0.01);

      updateSummary();
    }

    /* ═══════════════════════════════════════════════════════════
       AUTO-FILL
       ═══════════════════════════════════════════════════════════ */
    function autoFill(mode){
      var proj = getProj();
      if (!proj) return;

      var tasks = DB.project_wbs.filter(function(w){
        return w.project_id === proj.id && !w.is_group;
      });
      if (_state.filterGrup){
        tasks = tasks.filter(function(t){ return t.parent_id === _state.filterGrup; });
      }
      if (_state.showOnlyRemaining){
        tasks = tasks.filter(function(t){
          var volBefore = getVolKumulatif(proj.id, t.id, _state.minggu - 1);
          return _num(t.volume_rab) > 0 && volBefore / _num(t.volume_rab) < 0.9999;
        });
      }

      if (!tasks.length){
        _toast('Tidak ada task yang perlu diisi', false);
        return;
      }

      if (mode === 'clear'){
        _state.draft = {};
        renderTable(proj);
        _toast('Draft dikosongkan');
        return;
      }

      var durasiTotal = maxMinggu(proj);
      var mingguBerjalan = _state.minggu;
      var sisaMinggu = Math.max(1, durasiTotal - mingguBerjalan + 1);

      tasks.forEach(function(t){
        var volRAB = _num(t.volume_rab);
        if (volRAB <= 0) return;

        var volBefore = getVolKumulatif(proj.id, t.id, mingguBerjalan - 1);
        var sisa = Math.max(0, volRAB - volBefore);
        if (sisa <= 0) return;

        var val = 0;
        if (mode === 'uniform'){
          val = sisa / sisaMinggu;
        } else if (mode === 'plan'){
          var rencanaPct = calculatePlanPct(proj, t, mingguBerjalan);
          var rencanaVol = volRAB * rencanaPct;
          val = Math.max(0, rencanaVol - volBefore);
        } else if (mode === 'remaining'){
          val = sisa;
        }

        val = Math.round(val * 1000) / 1000;
        if (val > 0) _state.draft[t.id] = val;
        else delete _state.draft[t.id];
      });

      renderTable(proj);
      var modeLabel = {
        uniform: 'Merata', plan: 'Sesuai Rencana', remaining: 'Sisa Semua'
      }[mode] || mode;
      _toast('🔄 Auto-fill ' + modeLabel + ' untuk ' + tasks.length + ' task');
    }

    function calculatePlanPct(proj, task, minggu){
      if (!task.tgl_mulai_rencana || !task.tgl_selesai_rencana){
        return minggu / Math.max(1, maxMinggu(proj));
      }
      var cal = (typeof WorkingCalendar !== 'undefined' && WorkingCalendar.get)
        ? WorkingCalendar.get(task.calendar_id || proj.calendar_id)
        : { work_days: '1,2,3,4,5' };

      var totalDays = (typeof WorkingCalendar !== 'undefined' && WorkingCalendar.diffDays)
        ? WorkingCalendar.diffDays(task.tgl_mulai_rencana, task.tgl_selesai_rencana, cal, 'working')
        : 10;
      if (totalDays <= 0) totalDays = 1;

      var hariBerjalan = minggu * 5;
      var pct = Math.min(1, hariBerjalan / totalDays);

      var tglMingguIni = tanggalDariMinggu(proj, minggu);
      if (tglMingguIni < task.tgl_mulai_rencana) return 0;

      return pct;
    }

    /* ═══════════════════════════════════════════════════════════
       SAVE ALL
       ═══════════════════════════════════════════════════════════ */
    function saveAll(){
      var proj = getProj();
      if (!proj){ _toast('Proyek tidak ditemukan', false); return; }

      var entries = Object.keys(_state.draft);
      if (!entries.length){ _toast('Belum ada data untuk disimpan', false); return; }

      // Validasi
      var errors = [];
      entries.forEach(function(wbsId){
        var task = DB.project_wbs.find(function(t){ return t.id === wbsId; });
        if (!task) return;
        var volRAB = _num(task.volume_rab);
        var volBefore = getVolKumulatif(proj.id, wbsId, _state.minggu - 1);
        var sisa = Math.max(0, volRAB - volBefore);
        var inputVal = _num(_state.draft[wbsId]);
        if (inputVal > sisa + 0.001){
          errors.push('• ' + task.kode_wbs + ': input ' + _fmt(inputVal, 2) + ' > sisa ' + _fmt(sisa, 2));
        }
      });

      if (errors.length){
        var msg = '⚠ Volume input melebihi sisa untuk:\n\n' + errors.slice(0, 5).join('\n');
        if (errors.length > 5) msg += '\n... dan ' + (errors.length - 5) + ' lainnya';
        if (!confirm(msg + '\n\nTetap simpan? (Volume akan di-cap ke sisa)')) return;
        entries.forEach(function(wbsId){
          var task = DB.project_wbs.find(function(t){ return t.id === wbsId; });
          if (!task) return;
          var volRAB = _num(task.volume_rab);
          var volBefore = getVolKumulatif(proj.id, wbsId, _state.minggu - 1);
          var sisa = Math.max(0, volRAB - volBefore);
          _state.draft[wbsId] = Math.min(_num(_state.draft[wbsId]), sisa);
        });
      }

      if (!confirm('Simpan ' + entries.length + ' entri progress untuk Minggu ' + _state.minggu + '?')) return;

      if (typeof Undo !== 'undefined' && Undo.snapshot){
        Undo.snapshot('Bulk Progress M' + _state.minggu + ': ' + entries.length + ' entri');
      }

      var tglISO = _state.tanggal || tanggalDariMinggu(proj, _state.minggu);
      var added = 0, updated = 0;

      entries.forEach(function(wbsId){
        var vol = _num(_state.draft[wbsId]);
        if (vol <= 0) return;

        var existing = DB.progress.find(function(p){
          return p.project_id === proj.id &&
                 p.wbs_id === wbsId &&
                 _num(p.minggu) === _state.minggu;
        });

        if (existing){
          existing.volume = vol;
          existing.tanggal = tglISO;
          updated++;
        } else {
          DB.progress.push({
            id: _uid('pg'),
            project_id: proj.id,
            wbs_id: wbsId,
            minggu: _state.minggu,
            volume: vol,
            tanggal: tglISO
          });
          added++;
        }
      });

      if (typeof closeModal === 'function') closeModal();

      var _doSave = function(){
        if (typeof saveDB === 'function') saveDB();
        if (typeof runCPM === 'function') runCPM(proj.id);
        if (typeof saveDB === 'function') saveDB();

        if (typeof ProgressManager !== 'undefined'){
          if (ProgressManager.renderTable) ProgressManager.renderTable();
          if (ProgressManager.renderScurve) ProgressManager.renderScurve(proj.id);
          if (ProgressManager.renderVariance) ProgressManager.renderVariance(proj.id);
        }
        if (typeof renderSchedule === 'function') renderSchedule();

        _toast('✅ Progress M' + _state.minggu + ': +' + added + ' baru, ' + updated + ' diupdate');
      };

      if (window.Loading && Loading.wrapSync){
        Loading.wrapSync(_doSave, 'Menyimpan progress…', 80);
      } else {
        _doSave();
      }
    }

    /* ═══════════════════════════════════════════════════════════
       SUMMARY
       ═══════════════════════════════════════════════════════════ */
    function updateSummary(){
      var el = document.getElementById('bpSummary');
      if (!el) return;

      var proj = getProj();
      var visibleCount = 0;
      try {
        if (proj){
          var tasks = DB.project_wbs.filter(function(w){
            return w.project_id === proj.id && !w.is_group;
          });
          if (_state.filterGrup){
            tasks = tasks.filter(function(t){ return t.parent_id === _state.filterGrup; });
          }
          if (_state.showOnlyRemaining){
            tasks = tasks.filter(function(t){
              var volBefore = getVolKumulatif(proj.id, t.id, _state.minggu - 1);
              return _num(t.volume_rab) > 0 && volBefore / _num(t.volume_rab) < 0.9999;
            });
          }
          visibleCount = tasks.length;
        }
      } catch(e){}

      var draftedCount = Object.keys(_state.draft).length;
      var totalVal = 0;
      Object.keys(_state.draft).forEach(function(k){ totalVal += _num(_state.draft[k]); });

      el.innerHTML = '<b>' + visibleCount + '</b> task · ' +
                     '<b>' + draftedCount + '</b> terisi · ' +
                     'vol <b>' + _fmt(totalVal, 2) + '</b>';
    }

    /* ═══════════════════════════════════════════════════════════
       WIRE CONTROLS
       ═══════════════════════════════════════════════════════════ */
    function wireControls(proj){
      var el;

      document.querySelectorAll('.bp-mode-btn').forEach(function(btn){
        btn.onclick = function(){
          document.querySelectorAll('.bp-mode-btn').forEach(function(b){
            b.classList.toggle('is-active', b === btn);
          });
          var mode = btn.getAttribute('data-mode');
          _state.mode = mode;
          var weeklyEl = document.querySelector('.bp-f-weekly');
          var dailyEl  = document.querySelector('.bp-f-daily');
          if (weeklyEl) weeklyEl.style.display = mode === 'weekly' ? '' : 'none';
          if (dailyEl)  dailyEl.style.display  = mode === 'daily'  ? '' : 'none';
        };
      });

      el = document.getElementById('bpMinggu');
      if (el){
        el.onchange = function(){
          var v = parseInt(el.value, 10);
          if (isNaN(v) || v < 1) v = 1;
          var maxM = maxMinggu(proj);
          if (v > maxM) v = maxM;
          _state.minggu = v;
          _state.draft = {};
          renderTable(proj);
        };
      }

      el = document.getElementById('bpTanggal');
      if (el){
        el.onchange = function(){
          _state.tanggal = el.value;
          _state.minggu = mingguDariTanggal(proj, el.value);
          _state.draft = {};
          renderTable(proj);
        };
      }

      el = document.getElementById('bpGrup');
      if (el){
        el.onchange = function(){
          _state.filterGrup = el.value;
          _state.draft = {};
          renderTable(proj);
        };
      }

      el = document.getElementById('bpHideRemaining');
      if (el){
        el.onchange = function(){
          _state.showOnlyRemaining = el.checked;
          renderTable(proj);
        };
      }

      document.querySelectorAll('.bp-btn[data-fill]').forEach(function(btn){
        btn.onclick = function(){
          autoFill(btn.getAttribute('data-fill'));
        };
      });
    }

    /* ═══════════════════════════════════════════════════════════
       PUBLIC API + WIRE BUTTON
       ═══════════════════════════════════════════════════════════ */
    window.BulkProgressInput = { open: openBulk };

    function wireButton(){
      var btn = document.getElementById('btnBulkProgress');
      if (!btn){
        var headerRow = document.querySelector('#sec-progress .panel:first-child .panel-head .row');
        if (headerRow){
          btn = document.createElement('button');
          btn.id = 'btnBulkProgress';
          btn.className = 'btn btn-primary';
          btn.style.cssText = 'background:linear-gradient(135deg,#16a34a,#0f8a3f);border-color:transparent;color:#fff';
          btn.innerHTML = '📥 Bulk Input';
          headerRow.appendChild(btn);
        }
      }
      if (btn && !btn._wired){
        btn._wired = true;
        btn.onclick = openBulk;
      }
    }

    if (document.readyState === 'loading'){
      document.addEventListener('DOMContentLoaded', wireButton);
    } else {
      wireButton();
    }
    setTimeout(wireButton, 1000);
    setTimeout(wireButton, 3000);

    console.log('%c[BulkProgressInput.js] ✅ Bulk Progress Input installed',
      'color:#22c55e;font-weight:bold;font-size:13px');
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ bootstrap(0); });
  } else {
    bootstrap(0);
  }
})();
