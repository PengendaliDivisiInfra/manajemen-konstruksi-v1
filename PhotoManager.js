/* =====================================================================
   MODUL PHOTO MANAGER — Upload & Kelola Foto Progress
   Setiap foto terkait dengan WBS item + tanggal + caption custom
   ===================================================================== */

(function photoManagerModule(){
  function bootstrap(attempt){
    attempt = attempt || 0;
    if (typeof DB === 'undefined' || !DB || typeof openModal !== 'function'){
      if (attempt > 50){
        console.error('[PhotoManager.js] Engine belum siap — menyerah');
        return;
      }
      setTimeout(function(){ bootstrap(attempt + 1); }, 300);
      return;
    }
    install();
  }

  function install(){
    if (window._photoManagerInstalled) return;
    window._photoManagerInstalled = true;

    // Pastikan tabel photos ada
    if (!DB.photos) DB.photos = [];

    function _uid(p){
      if (typeof uid === 'function') return uid(p);
      return (p||'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
    }
    function _esc(s){
      if (typeof esc === 'function') return esc(s);
      return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
      });
    }
    function _toast(msg, ok){
      if (typeof toast === 'function') toast(msg, ok !== false);
    }

    /* ═══════════════════════════════════════════════════════════
       CORE HELPERS
       ═══════════════════════════════════════════════════════════ */

    function getPhotos(projectId, opts){
      opts = opts || {};
      var list = DB.photos.filter(function(p){
        if (p.project_id !== projectId) return false;
        if (opts.wbs_id && p.wbs_id !== opts.wbs_id) return false;
        if (opts.tanggal && p.tanggal !== opts.tanggal) return false;
        if (opts.minggu && Number(p.minggu) !== Number(opts.minggu)) return false;
        return true;
      });
      return list.sort(function(a, b){
        if (a.tanggal !== b.tanggal) return (a.tanggal || '').localeCompare(b.tanggal || '');
        return (a.urutan || 0) - (b.urutan || 0);
      });
    }

    /* ═══════════════════════════════════════════════════════════
       KOMPRES GAMBAR (supaya tidak boros storage)
       ═══════════════════════════════════════════════════════════ */

    function compressImage(file, maxW, maxH, quality){
      return new Promise(function(resolve, reject){
        maxW = maxW || 1280;
        maxH = maxH || 1280;
        quality = quality || 0.82;

        var reader = new FileReader();
        reader.onload = function(e){
          var img = new Image();
          img.onload = function(){
            var w = img.width, h = img.height;
            if (w > maxW || h > maxH){
              var ratio = Math.min(maxW/w, maxH/h);
              w = Math.round(w * ratio);
              h = Math.round(h * ratio);
            }
            var canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            try {
              var dataURL = canvas.toDataURL('image/jpeg', quality);
              resolve(dataURL);
            } catch(err){ reject(err); }
          };
          img.onerror = reject;
          img.src = e.target.result;
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    /* ═══════════════════════════════════════════════════════════
       MODAL: KELOLA FOTO
       ═══════════════════════════════════════════════════════════ */

    function openManager(projectId, wbsId, tanggal){
      projectId = projectId || (typeof STATE !== 'undefined' ? STATE.activeProject : null);
      if (!projectId){ _toast('Pilih proyek dulu', false); return; }

      var html = buildManagerHTML(projectId, wbsId, tanggal);
      openModal('📷 Foto Progress', html, function(){ return false; });

      setTimeout(function(){
        var submitBtn = document.getElementById('mSubmit');
        if (submitBtn) submitBtn.style.display = 'none';
        var cancelBtn = document.getElementById('mCancel');
        if (cancelBtn){
          cancelBtn.textContent = 'Tutup';
          cancelBtn.onclick = function(){
            if (typeof closeModal === 'function') closeModal();
            if (typeof saveDB === 'function') saveDB();
          };
        }
        wireManagerEvents(projectId, wbsId, tanggal);
        refreshPhotoGrid(projectId, wbsId, tanggal);
      }, 10);
    }

    function buildManagerHTML(projectId, wbsId, tanggal){
      var proj = DB.projects.find(function(p){ return p.id === projectId; });
      var tasks = DB.project_wbs.filter(function(w){
        return w.project_id === projectId && !w.is_group;
      });
      var taskOpts = '<option value="">— Pilih Item WBS —</option>' +
        tasks.map(function(t){
          return '<option value="' + _esc(t.id) + '"' + (t.id === wbsId ? ' selected' : '') + '>' +
            _esc(t.kode_wbs) + ' — ' + _esc(t.uraian) + '</option>';
        }).join('');

      return '' +
        '<div class="ph-intro">' +
          '<b>📷 Foto Progress</b> untuk proyek: <b style="color:#7cb3ff">' +
          _esc(proj ? proj.kode : '') + '</b>' +
        '</div>' +

        '<div class="ph-filter">' +
          '<div class="ph-field ph-full">' +
            '<label>Item WBS</label>' +
            '<select id="ph_wbs">' + taskOpts + '</select>' +
          '</div>' +
          '<div class="ph-field">' +
            '<label>Tanggal Foto</label>' +
            '<input type="date" id="ph_tanggal" value="' + _esc(tanggal || new Date().toISOString().slice(0,10)) + '" />' +
          '</div>' +
        '</div>' +

        '<div class="ph-upload-zone" id="ph_dropzone">' +
          '<div class="ph-up-icon">📤</div>' +
          '<div class="ph-up-title">Drop foto di sini atau klik untuk pilih</div>' +
          '<div class="ph-up-hint">Bisa pilih multiple foto sekaligus. Otomatis dikompres.</div>' +
          '<input type="file" id="ph_file" accept="image/*" multiple style="display:none" />' +
        '</div>' +

        '<div class="ph-status" id="ph_status"></div>' +

        '<div class="ph-grid" id="ph_grid">' +
          '<div class="ph-empty">Belum ada foto</div>' +
        '</div>';
    }

    function wireManagerEvents(projectId, wbsId, tanggal){
      var dz = document.getElementById('ph_dropzone');
      var fi = document.getElementById('ph_file');
      var wbsSel = document.getElementById('ph_wbs');
      var tglInput = document.getElementById('ph_tanggal');

      if (wbsSel){
        wbsSel.onchange = function(){
          refreshPhotoGrid(projectId, wbsSel.value, tglInput.value);
        };
      }
      if (tglInput){
        tglInput.onchange = function(){
          refreshPhotoGrid(projectId, wbsSel.value, tglInput.value);
        };
      }

      if (!dz || !fi) return;
      dz.onclick = function(){ fi.click(); };

      dz.addEventListener('dragover', function(e){
        e.preventDefault();
        dz.classList.add('is-over');
      });
      dz.addEventListener('dragleave', function(){
        dz.classList.remove('is-over');
      });
      dz.addEventListener('drop', function(e){
        e.preventDefault();
        dz.classList.remove('is-over');
        handleFiles(e.dataTransfer.files);
      });

      fi.onchange = function(e){
        handleFiles(e.target.files);
        fi.value = '';
      };

      function handleFiles(files){
        if (!files || !files.length) return;
        var wbsIdNow = wbsSel ? wbsSel.value : '';
        if (!wbsIdNow){
          _toast('Pilih Item WBS terlebih dahulu', false);
          return;
        }
        var tglNow = tglInput ? tglInput.value : new Date().toISOString().slice(0,10);
        var proj = DB.projects.find(function(p){ return p.id === projectId; });
        var minggu = hitungMinggu(proj, tglNow);

        var statusEl = document.getElementById('ph_status');
        if (statusEl) statusEl.innerHTML = '⏳ Memproses ' + files.length + ' foto...';

        var processed = 0;
        var total = files.length;
        var successCount = 0;

        Array.prototype.forEach.call(files, function(f, idx){
          if (!f.type.startsWith('image/')){
            processed++;
            checkDone();
            return;
          }
          compressImage(f, 1280, 1280, 0.82)
            .then(function(dataURL){
              var urutan = DB.photos.filter(function(p){
                return p.project_id === projectId && p.wbs_id === wbsIdNow && p.tanggal === tglNow;
              }).length + 1;

              DB.photos.push({
                id: _uid('ph'),
                project_id: projectId,
                wbs_id: wbsIdNow,
                tanggal: tglNow,
                minggu: minggu,
                urutan: urutan,
                caption: '',
                file_data: dataURL,
                created_at: new Date().toISOString()
              });
              successCount++;
              processed++;
              checkDone();
            })
            .catch(function(err){
              console.warn('Gagal kompres', f.name, err);
              processed++;
              checkDone();
            });
        });

        function checkDone(){
          if (statusEl){
            statusEl.innerHTML = '✅ ' + successCount + ' / ' + total + ' foto tersimpan';
          }
          if (processed === total){
            if (typeof saveDB === 'function') saveDB();
            refreshPhotoGrid(projectId, wbsSel.value, tglInput.value);
            setTimeout(function(){
              if (statusEl) statusEl.innerHTML = '';
            }, 2500);
          }
        }
      }
    }

    function hitungMinggu(proj, tglISO){
      if (!proj || !proj.tgl_mulai || !tglISO) return 1;
      var d1 = new Date(proj.tgl_mulai + 'T00:00:00');
      var d2 = new Date(tglISO + 'T00:00:00');
      if (isNaN(d1.getTime()) || isNaN(d2.getTime())) return 1;
      var diffDays = Math.round((d2 - d1) / 86400000);
      return Math.max(1, Math.floor(diffDays / 7) + 1);
    }

    /* ═══════════════════════════════════════════════════════════
       GRID FOTO
       ═══════════════════════════════════════════════════════════ */

    function refreshPhotoGrid(projectId, wbsId, tanggal){
      var grid = document.getElementById('ph_grid');
      if (!grid) return;

      if (!wbsId){
        grid.innerHTML = '<div class="ph-empty">Pilih item WBS di atas untuk melihat/menambah foto</div>';
        return;
      }

      var photos = getPhotos(projectId, { wbs_id: wbsId, tanggal: tanggal });
      if (!photos.length){
        grid.innerHTML = '<div class="ph-empty">Belum ada foto untuk tanggal ini</div>';
        return;
      }

      grid.innerHTML = photos.map(function(p, idx){
        return '' +
          '<div class="ph-card" data-photo-id="' + _esc(p.id) + '">' +
            '<div class="ph-card-img">' +
              '<img src="' + p.file_data + '" alt="Foto ' + (idx+1) + '" loading="lazy" />' +
              '<button class="ph-del" data-del-photo="' + _esc(p.id) + '" title="Hapus">×</button>' +
            '</div>' +
            '<textarea class="ph-caption" data-caption-photo="' + _esc(p.id) + '" ' +
              'placeholder="Caption…" rows="2">' + _esc(p.caption || '') + '</textarea>' +
          '</div>';
      }).join('');

      grid.querySelectorAll('[data-del-photo]').forEach(function(btn){
        btn.onclick = function(){
          var id = btn.getAttribute('data-del-photo');
          if (!confirm('Hapus foto ini?')) return;
          DB.photos = DB.photos.filter(function(p){ return p.id !== id; });
          if (typeof saveDB === 'function') saveDB();
          refreshPhotoGrid(projectId, wbsId, tanggal);
          _toast('Foto dihapus');
        };
      });

      grid.querySelectorAll('[data-caption-photo]').forEach(function(ta){
        ta.oninput = function(){
          var id = ta.getAttribute('data-caption-photo');
          var p = DB.photos.find(function(x){ return x.id === id; });
          if (p) p.caption = ta.value;
        };
        ta.onblur = function(){
          if (typeof saveDB === 'function') saveDB();
        };
      });
    }

    /* ═══════════════════════════════════════════════════════════
       PUBLIC API
       ═══════════════════════════════════════════════════════════ */

    window.PhotoManager = {
      open: openManager,
      get: getPhotos,
      all: function(projectId){
        return DB.photos.filter(function(p){ return p.project_id === projectId; });
      }
    };

    console.log('%c[PhotoManager.js] ✅ Photo Manager installed',
      'color:#0891b2;font-weight:bold;font-size:13px');
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ bootstrap(0); });
  } else {
    bootstrap(0);
  }
})();
