/* =====================================================================
   MODUL PROJECT METADATA — Logo, Instansi, Penandatangan
   Menyimpan semua data identitas proyek untuk keperluan laporan PDF
   ===================================================================== */

(function projectMetaModule(){
  function bootstrap(attempt){
    attempt = attempt || 0;
    if (typeof DB === 'undefined' || !DB || typeof openModal !== 'function'){
      if (attempt > 50){
        console.error('[ProjectMeta.js] Engine belum siap — menyerah');
        return;
      }
      setTimeout(function(){ bootstrap(attempt + 1); }, 300);
      return;
    }
    install();
  }

  function install(){
    if (window._projectMetaInstalled) return;
    window._projectMetaInstalled = true;

    /* ═══════════════════════════════════════════════════════════
       DATA STRUKTUR & HELPER
       ═══════════════════════════════════════════════════════════ */

    function _esc(s){
      if (typeof esc === 'function') return esc(s);
      return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
      });
    }

    function _toast(msg, ok){
      if (typeof toast === 'function') toast(msg, ok !== false);
    }

    /**
     * Default meta — dipakai kalau proyek belum punya meta
     */
    function defaultMeta(){
      return {
        // Identitas
        nama_instansi:    'DINAS PEKERJAAN UMUM DAN PENATAAN RUANG',
        alamat_instansi:  '',
        nama_kontraktor:  '',
        alamat_kontraktor:'',
        nomor_kontrak:    '',
        tanggal_kontrak:  '',
        sumber_dana:      'APBD',
        tahun_anggaran:   new Date().getFullYear().toString(),
        jenis_kontrak:    'Unit Price',

        // Logo (disimpan sebagai data URL base64)
        logo_pupr:        '',
        logo_kontraktor:  '',

        // Lokasi rinci
        lokasi_kabupaten: '',
        lokasi_kecamatan: '',
        lokasi_desa:      '',

        // Penandatangan
        ttd_project_manager: { nama:'', jabatan:'Project Manager', nik:'', tanggal:'' },
        ttd_team_leader:     { nama:'', jabatan:'Team Leader Konsultan', nik:'', tanggal:'' },
        ttd_direksi:         { nama:'', jabatan:'Direksi Pengawas', nik:'', tanggal:'' },
        ttd_ppk:             { nama:'', jabatan:'Pejabat Pembuat Komitmen', nik:'', tanggal:'' }
      };
    }

    /**
     * Ambil meta proyek — selalu return lengkap dengan default
     */
    function getMeta(projectId){
      var proj = DB.projects.find(function(p){ return p.id === projectId; });
      if (!proj) return defaultMeta();

      if (!proj.meta){
        proj.meta = defaultMeta();
        // Auto-fill dari data proyek yang sudah ada
        proj.meta.lokasi_kabupaten = proj.lokasi || '';
        proj.meta.nama_instansi    = proj.owner || proj.meta.nama_instansi;
      }

      // Merge dengan default untuk memastikan semua field ada
      var def = defaultMeta();
      var merged = Object.assign({}, def, proj.meta);
      // Merge nested objects juga
      ['ttd_project_manager','ttd_team_leader','ttd_direksi','ttd_ppk'].forEach(function(k){
        merged[k] = Object.assign({}, def[k], proj.meta[k] || {});
      });

      return merged;
    }

    /**
     * Simpan meta ke DB
     */
    function saveMeta(projectId, meta){
      var proj = DB.projects.find(function(p){ return p.id === projectId; });
      if (!proj){ _toast('Proyek tidak ditemukan', false); return false; }

      proj.meta = meta;
      if (typeof saveDB === 'function') saveDB();
      return true;
    }

    /* ═══════════════════════════════════════════════════════════
       UI: MODAL EDIT META
       ═══════════════════════════════════════════════════════════ */

    function openEditor(projectId){
      projectId = projectId || (typeof STATE !== 'undefined' ? STATE.activeProject : null);
      if (!projectId){ _toast('Pilih proyek dulu', false); return; }

      var proj = DB.projects.find(function(p){ return p.id === projectId; });
      if (!proj){ _toast('Proyek tidak ditemukan', false); return; }

      var meta = getMeta(projectId);
      var html = buildEditorHTML(proj, meta);

      openModal('⚙ Metadata Proyek & Laporan', html, function(){ return false; });

      setTimeout(function(){
        var submitBtn = document.getElementById('mSubmit');
        if (submitBtn){
          submitBtn.textContent = '💾 Simpan Metadata';
          submitBtn.style.display = '';
          submitBtn.onclick = function(){ handleSave(projectId); };
        }
        var cancelBtn = document.getElementById('mCancel');
        if (cancelBtn) cancelBtn.textContent = 'Batal';
        wireEditorEvents(projectId);
      }, 10);
    }

    function buildEditorHTML(proj, meta){
      return '' +
        '<div class="pm-tabs">' +
          '<button class="pm-tab is-active" data-tab="identitas">🏛 Identitas</button>' +
          '<button class="pm-tab" data-tab="logo">🖼 Logo</button>' +
          '<button class="pm-tab" data-tab="lokasi">📍 Lokasi</button>' +
          '<button class="pm-tab" data-tab="ttd">✍ Penandatangan</button>' +
        '</div>' +

        /* ═══ TAB 1: IDENTITAS ═══ */
        '<div class="pm-tab-content is-active" data-tab="identitas">' +
          '<div class="pm-grid">' +
            '<div class="pm-field pm-full">' +
              '<label>Nama Instansi (Owner)</label>' +
              '<input id="pm_instansi" value="' + _esc(meta.nama_instansi) + '" placeholder="mis. DINAS PUPR PROV. JAWA TIMUR" />' +
            '</div>' +
            '<div class="pm-field pm-full">' +
              '<label>Alamat Instansi</label>' +
              '<input id="pm_alamat_instansi" value="' + _esc(meta.alamat_instansi) + '" placeholder="Jl. ..." />' +
            '</div>' +
            '<div class="pm-field pm-full">' +
              '<label>Nama Kontraktor / Perusahaan</label>' +
              '<input id="pm_kontraktor" value="' + _esc(meta.nama_kontraktor) + '" placeholder="mis. PT. KARYA BANGUN JAYA" />' +
            '</div>' +
            '<div class="pm-field pm-full">' +
              '<label>Alamat Kontraktor</label>' +
              '<input id="pm_alamat_kontraktor" value="' + _esc(meta.alamat_kontraktor) + '" placeholder="Jl. ..." />' +
            '</div>' +
            '<div class="pm-field">' +
              '<label>Nomor Kontrak</label>' +
              '<input id="pm_nomor_kontrak" value="' + _esc(meta.nomor_kontrak) + '" placeholder="mis. 123/SPK/2026" />' +
            '</div>' +
            '<div class="pm-field">' +
              '<label>Tanggal Kontrak</label>' +
              '<input type="date" id="pm_tanggal_kontrak" value="' + _esc(meta.tanggal_kontrak) + '" />' +
            '</div>' +
            '<div class="pm-field">' +
              '<label>Sumber Dana</label>' +
              '<select id="pm_sumber_dana">' +
                ['APBD','APBN','APBD Provinsi','APBD Kabupaten','PHLN','DAK','Lainnya']
                  .map(function(s){
                    return '<option value="' + s + '"' + (meta.sumber_dana === s ? ' selected' : '') + '>' + s + '</option>';
                  }).join('') +
              '</select>' +
            '</div>' +
            '<div class="pm-field">' +
              '<label>Tahun Anggaran</label>' +
              '<input id="pm_tahun" value="' + _esc(meta.tahun_anggaran) + '" placeholder="2026" />' +
            '</div>' +
            '<div class="pm-field pm-full">' +
              '<label>Jenis Kontrak</label>' +
              '<select id="pm_jenis_kontrak">' +
                ['Unit Price','Lump Sum','Unit Price & Lump Sum','Turnkey','Kontrak Payung','Lainnya']
                  .map(function(s){
                    return '<option value="' + s + '"' + (meta.jenis_kontrak === s ? ' selected' : '') + '>' + s + '</option>';
                  }).join('') +
              '</select>' +
            '</div>' +
          '</div>' +
        '</div>' +

        /* ═══ TAB 2: LOGO ═══ */
        '<div class="pm-tab-content" data-tab="logo">' +
          '<p class="pm-hint">Upload logo sebagai gambar (PNG/JPG). Ukuran disarankan maks 500×500 px. ' +
          'Logo akan muncul di header setiap laporan PDF.</p>' +
          '<div class="pm-grid pm-logo-grid">' +
            '<div class="pm-logo-slot">' +
              '<label>Logo PUPR / Instansi</label>' +
              '<div class="pm-logo-preview" id="pm_preview_pupr">' +
                (meta.logo_pupr
                  ? '<img src="' + meta.logo_pupr + '" alt="Logo PUPR" />'
                  : '<div class="pm-logo-empty">Belum ada</div>') +
              '</div>' +
              '<input type="file" id="pm_file_pupr" accept="image/*" style="display:none" />' +
              '<button class="pm-btn" data-pick="pupr">📁 Pilih File</button>' +
              (meta.logo_pupr ? '<button class="pm-btn pm-btn-danger" data-clear="pupr">🗑 Hapus</button>' : '') +
            '</div>' +
            '<div class="pm-logo-slot">' +
              '<label>Logo Kontraktor</label>' +
              '<div class="pm-logo-preview" id="pm_preview_kontraktor">' +
                (meta.logo_kontraktor
                  ? '<img src="' + meta.logo_kontraktor + '" alt="Logo Kontraktor" />'
                  : '<div class="pm-logo-empty">Belum ada</div>') +
              '</div>' +
              '<input type="file" id="pm_file_kontraktor" accept="image/*" style="display:none" />' +
              '<button class="pm-btn" data-pick="kontraktor">📁 Pilih File</button>' +
              (meta.logo_kontraktor ? '<button class="pm-btn pm-btn-danger" data-clear="kontraktor">🗑 Hapus</button>' : '') +
            '</div>' +
          '</div>' +
        '</div>' +

        /* ═══ TAB 3: LOKASI ═══ */
        '<div class="pm-tab-content" data-tab="lokasi">' +
          '<div class="pm-grid">' +
            '<div class="pm-field">' +
              '<label>Kabupaten / Kota</label>' +
              '<input id="pm_lok_kabupaten" value="' + _esc(meta.lokasi_kabupaten) + '" placeholder="mis. Kabupaten Jember" />' +
            '</div>' +
            '<div class="pm-field">' +
              '<label>Kecamatan</label>' +
              '<input id="pm_lok_kecamatan" value="' + _esc(meta.lokasi_kecamatan) + '" placeholder="mis. Kecamatan Tanggul" />' +
            '</div>' +
            '<div class="pm-field pm-full">' +
              '<label>Desa / Kelurahan</label>' +
              '<input id="pm_lok_desa" value="' + _esc(meta.lokasi_desa) + '" placeholder="mis. Desa Patemon" />' +
            '</div>' +
          '</div>' +
        '</div>' +

        /* ═══ TAB 4: PENANDATANGAN ═══ */
        '<div class="pm-tab-content" data-tab="ttd">' +
          '<p class="pm-hint">Data ini akan tercetak di bagian bawah setiap laporan PDF. ' +
          'Kosongkan jika belum tahu — akan tampil sebagai garis kosong.</p>' +
          buildTtdSection('project_manager', 'Project Manager (Kontraktor)', meta.ttd_project_manager) +
          buildTtdSection('team_leader', 'Team Leader Konsultan', meta.ttd_team_leader) +
          buildTtdSection('direksi', 'Direksi Pengawas / Pengawas Lapangan', meta.ttd_direksi) +
          buildTtdSection('ppk', 'Pejabat Pembuat Komitmen (PPK)', meta.ttd_ppk) +
        '</div>';
    }

    function buildTtdSection(key, label, data){
      return '' +
        '<div class="pm-ttd-block">' +
          '<div class="pm-ttd-header">' + _esc(label) + '</div>' +
          '<div class="pm-grid">' +
            '<div class="pm-field">' +
              '<label>Nama</label>' +
              '<input id="pm_ttd_' + key + '_nama" value="' + _esc(data.nama) + '" placeholder="Nama lengkap" />' +
            '</div>' +
            '<div class="pm-field">' +
              '<label>Jabatan Resmi</label>' +
              '<input id="pm_ttd_' + key + '_jabatan" value="' + _esc(data.jabatan) + '" />' +
            '</div>' +
            '<div class="pm-field">' +
              '<label>NIK / NIP</label>' +
              '<input id="pm_ttd_' + key + '_nik" value="' + _esc(data.nik) + '" placeholder="mis. 19780512..." />' +
            '</div>' +
            '<div class="pm-field">' +
              '<label>Tanggal Tanda Tangan</label>' +
              '<input type="date" id="pm_ttd_' + key + '_tanggal" value="' + _esc(data.tanggal) + '" />' +
            '</div>' +
          '</div>' +
        '</div>';
    }

    /* ═══════════════════════════════════════════════════════════
       WIRE EVENTS
       ═══════════════════════════════════════════════════════════ */

    function wireEditorEvents(projectId){
      // Tabs
      document.querySelectorAll('.pm-tab').forEach(function(tab){
        tab.onclick = function(){
          document.querySelectorAll('.pm-tab').forEach(function(t){
            t.classList.toggle('is-active', t === tab);
          });
          var name = tab.getAttribute('data-tab');
          document.querySelectorAll('.pm-tab-content').forEach(function(c){
            c.classList.toggle('is-active', c.getAttribute('data-tab') === name);
          });
        };
      });

      // Logo upload
      ['pupr','kontraktor'].forEach(function(key){
        var fileInput = document.getElementById('pm_file_' + key);
        var pickBtn = document.querySelector('[data-pick="' + key + '"]');
        var clearBtn = document.querySelector('[data-clear="' + key + '"]');

        if (pickBtn && fileInput){
          pickBtn.onclick = function(){ fileInput.click(); };
        }
        if (fileInput){
          fileInput.onchange = function(e){
            var f = e.target.files[0];
            if (!f) return;
            if (f.size > 1024 * 1024){
              _toast('Ukuran file terlalu besar. Maks 1 MB.', false);
              return;
            }
            var reader = new FileReader();
            reader.onload = function(ev){
              var dataURL = ev.target.result;
              var preview = document.getElementById('pm_preview_' + key);
              if (preview){
                preview.innerHTML = '<img src="' + dataURL + '" alt="Logo" />';
              }
              // Simpan sementara di dataset
              preview.setAttribute('data-dataurl', dataURL);
            };
            reader.readAsDataURL(f);
          };
        }
        if (clearBtn){
          clearBtn.onclick = function(){
            var preview = document.getElementById('pm_preview_' + key);
            if (preview){
              preview.innerHTML = '<div class="pm-logo-empty">Belum ada</div>';
              preview.setAttribute('data-dataurl', '');
            }
            if (fileInput) fileInput.value = '';
          };
        }
      });
    }

    /* ═══════════════════════════════════════════════════════════
       SAVE
       ═══════════════════════════════════════════════════════════ */

    function handleSave(projectId){
      var meta = {
        nama_instansi:    val('pm_instansi'),
        alamat_instansi:  val('pm_alamat_instansi'),
        nama_kontraktor:  val('pm_kontraktor'),
        alamat_kontraktor:val('pm_alamat_kontraktor'),
        nomor_kontrak:    val('pm_nomor_kontrak'),
        tanggal_kontrak:  val('pm_tanggal_kontrak'),
        sumber_dana:      val('pm_sumber_dana'),
        tahun_anggaran:   val('pm_tahun'),
        jenis_kontrak:    val('pm_jenis_kontrak'),
        lokasi_kabupaten: val('pm_lok_kabupaten'),
        lokasi_kecamatan: val('pm_lok_kecamatan'),
        lokasi_desa:      val('pm_lok_desa'),

        logo_pupr:       getLogoData('pupr'),
        logo_kontraktor: getLogoData('kontraktor'),

        ttd_project_manager: readTtd('project_manager'),
        ttd_team_leader:     readTtd('team_leader'),
        ttd_direksi:         readTtd('direksi'),
        ttd_ppk:             readTtd('ppk')
      };

      if (saveMeta(projectId, meta)){
        _toast('✅ Metadata proyek tersimpan');
        if (typeof closeModal === 'function') closeModal();
      }
    }

    function val(id){
      var el = document.getElementById(id);
      return el ? el.value.trim() : '';
    }

    function getLogoData(key){
      var preview = document.getElementById('pm_preview_' + key);
      if (!preview) return '';
      var custom = preview.getAttribute('data-dataurl');
      if (custom !== null) return custom;   // null = tidak diubah, '' = dihapus
      // Kalau tidak diubah, ambil dari <img> yang ada
      var img = preview.querySelector('img');
      return img ? img.src : '';
    }

    function readTtd(key){
      return {
        nama:    val('pm_ttd_' + key + '_nama'),
        jabatan: val('pm_ttd_' + key + '_jabatan'),
        nik:     val('pm_ttd_' + key + '_nik'),
        tanggal: val('pm_ttd_' + key + '_tanggal')
      };
    }

    /* ═══════════════════════════════════════════════════════════
       PUBLIC API
       ═══════════════════════════════════════════════════════════ */

    window.ProjectMeta = {
      open: openEditor,
      get: getMeta,
      save: saveMeta,
      default: defaultMeta
    };

    /* ═══════════════════════════════════════════════════════════
       HOOK: Tombol Metadata Per-Baris di Tabel Proyek
       ═══════════════════════════════════════════════════════════ */

    function hookRenderProjects(){
      if (typeof window.renderProjects !== 'function'){
        setTimeout(hookRenderProjects, 500);
        return;
      }
      if (window._renderProjectsMetaHooked) return;
      window._renderProjectsMetaHooked = true;

      var _orig = window.renderProjects;
      window.renderProjects = function(){
        _orig.apply(this, arguments);

        // Setelah render selesai, inject tombol ke setiap row
        setTimeout(function(){
          document.querySelectorAll('[data-edit-prj]').forEach(function(btn){
            var prjId = btn.getAttribute('data-edit-prj');
            var parent = btn.parentElement;
            if (!parent) return;
            if (parent.querySelector('[data-meta-prj="' + prjId + '"]')) return;

            var metaBtn = document.createElement('button');
            metaBtn.className = 'btn btn-sm';
            metaBtn.setAttribute('data-meta-prj', prjId);
            metaBtn.style.cssText = 'background:linear-gradient(135deg,#0891b2,#0e7490);border-color:transparent;color:#fff';
            metaBtn.title = 'Kelola logo, instansi & penandatangan laporan';
            metaBtn.innerHTML = '⚙';
            metaBtn.onclick = function(){
              openEditor(prjId);
            };

            parent.insertBefore(metaBtn, btn);
          });

          // Tombol "Metadata" juga di header (untuk proyek aktif)
          var addBtn = document.getElementById('btnAddProj');
          if (addBtn && addBtn.parentElement && !document.getElementById('btnProjectMeta')){
            var headerBtn = document.createElement('button');
            headerBtn.id = 'btnProjectMeta';
            headerBtn.className = 'btn';
            headerBtn.style.cssText = 'background:linear-gradient(135deg,#0891b2,#0e7490);border-color:transparent;color:#fff;margin-left:8px';
            headerBtn.innerHTML = '⚙ Metadata';
            headerBtn.title = 'Kelola metadata proyek aktif';
            headerBtn.onclick = function(){
              var pid = (typeof STATE !== 'undefined') ? STATE.activeProject : null;
              if (!pid){ _toast('Pilih proyek dulu', false); return; }
              openEditor(pid);
            };
            addBtn.parentElement.insertBefore(headerBtn, addBtn);
          }
        }, 50);
      };

      console.log('%c[ProjectMeta.js] Hook renderProjects dipasang', 'color:#0891b2');
       }

    hookRenderProjects();

    console.log('%c[ProjectMeta.js] ✅ Project Metadata module installed',
      'color:#0891b2;font-weight:bold;font-size:13px');
    }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ bootstrap(0); });
  } else {
    bootstrap(0);
  }
})();
