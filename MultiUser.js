/* =====================================================================
 * MANAJEMEN KONSTRUKSI v1 — MULTI-USER MODULE (FINAL RBAC)
 * ===================================================================== */

(function multiUserModule(){
  function bootstrap(attempt){
    attempt = attempt || 0;
    if (typeof DB === 'undefined' || typeof SyncManager === 'undefined' || typeof STATE === 'undefined'){
      if (attempt > 50){
        console.error('[MultiUser.js] Engine belum siap — menyerah');
        return;
      }
      setTimeout(function(){ bootstrap(attempt + 1); }, 300);
      return;
    }
    install();
  }

  function install(){
    if (window._multiUserInstalled) return;
    window._multiUserInstalled = true;

    var TOKEN_KEY = 'mk_v1_session_token';
    var USER_KEY  = 'mk_v1_user_info';

    /* ═══════════════════════════════════════════════════════════
       AUTH MANAGER
       ═══════════════════════════════════════════════════════════ */
    var Auth = {
      token: null,
      user: null,

      load: function(){
        try {
          this.token = localStorage.getItem(TOKEN_KEY);
          var raw = localStorage.getItem(USER_KEY);
          this.user = raw ? JSON.parse(raw) : null;
        } catch(e){}
        return !!(this.token && this.user);
      },

      save: function(token, user){
        this.token = token;
        this.user = user;
        try {
          localStorage.setItem(TOKEN_KEY, token);
          localStorage.setItem(USER_KEY, JSON.stringify(user));
        } catch(e){}
      },

      clear: function(){
        this.token = null;
        this.user = null;
        try {
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(USER_KEY);
        } catch(e){}
      },

      isSuperadmin: function(){
        return this.user && this.user.role === 'superadmin';
      },

      canAccess: function(projectId){
        if (!this.user) return false;
        if (this.isSuperadmin()) return true;
        var ids = this.user.project_ids || [];
        return ids.indexOf('*') >= 0 || ids.indexOf(String(projectId)) >= 0;
      }
    };

    window.Auth = Auth;

    /* ═══════════════════════════════════════════════════════════
       LOGIN MODAL
       ═══════════════════════════════════════════════════════════ */
    function showLogin(){
      var ov = document.getElementById('loginOverlay');
      if (!ov){
        ov = document.createElement('div');
        ov.id = 'loginOverlay';
        ov.className = 'login-overlay';
        ov.innerHTML =
          '<div class="login-card">' +
            '<div class="login-brand">' +
              '<div class="login-logo">MK</div>' +
              '<div>' +
                '<div class="login-title">Manajemen Konstruksi v1</div>' +
                '<div class="login-sub">Pengendalian RAB vs RAP</div>' +
              '</div>' +
            '</div>' +
            '<div class="login-body">' +
              '<div class="login-field">' +
                '<label>Username</label>' +
                '<input id="loginUser" type="text" autocomplete="username" placeholder="Masukkan username" />' +
              '</div>' +
              '<div class="login-field">' +
                '<label>PIN</label>' +
                '<input id="loginPin" type="password" autocomplete="current-password" placeholder="Masukkan PIN" />' +
              '</div>' +
              '<div id="loginError" class="login-error"></div>' +
              '<button id="loginSubmit" class="login-btn">🔐 Masuk</button>' +
              '<div class="login-hint">Default admin: <b>admin</b> / PIN <b>123456</b></div>' +
            '</div>' +
          '</div>';
        document.body.appendChild(ov);

        document.getElementById('loginSubmit').onclick = doLogin;
        document.getElementById('loginPin').addEventListener('keypress', function(e){
          if (e.key === 'Enter') doLogin();
        });
        document.getElementById('loginUser').addEventListener('keypress', function(e){
          if (e.key === 'Enter') document.getElementById('loginPin').focus();
        });
      }
      ov.style.display = 'flex';
      setTimeout(function(){ document.getElementById('loginUser').focus(); }, 100);
    }

    function hideLogin(){
      var ov = document.getElementById('loginOverlay');
      if (ov) ov.style.display = 'none';
    }

    function showLoginError(msg){
      var el = document.getElementById('loginError');
      if (el){
        el.textContent = msg;
        el.style.display = 'block';
      }
    }

    async function doLogin(){
      var username = (document.getElementById('loginUser').value || '').trim();
      var pin = (document.getElementById('loginPin').value || '').trim();
      if (!username || !pin){
        showLoginError('Username dan PIN wajib diisi');
        return;
      }

      var btn = document.getElementById('loginSubmit');
      btn.disabled = true;
      btn.textContent = '⏳ Memverifikasi...';
      showLoginError('');

      try {
        var out = await sheetRequest('login', { username: username, pin: pin });
        if (out.ok && out.session){
          Auth.save(out.session.token, out.user);
          hideLogin();
          // Hapus badge lama sebelum render ulang
          var oldBadge = document.getElementById('userBadge');
          if (oldBadge) oldBadge.remove();
          afterLogin();
        } else {
          showLoginError(out.message || 'Login gagal');
          btn.disabled = false;
          btn.textContent = '🔐 Masuk';
        }
      } catch(e){
        showLoginError('Koneksi gagal: ' + e.message);
        btn.disabled = false;
        btn.textContent = '🔐 Masuk';
      }
    }

    async function doLogout(){
      if (!confirm('Yakin logout dari aplikasi?')) return;
      try {
        if (Auth.token){
          await sheetRequest('logout', { token: Auth.token });
        }
      } catch(e){}
      Auth.clear();
      location.reload();
    }

    /* ═══════════════════════════════════════════════════════════
       POST-LOGIN / GUEST MODE
       ═══════════════════════════════════════════════════════════ */
    function afterLogin(){
      console.log('%c[MultiUser] Logged in as ' + Auth.user.username + ' (' + Auth.user.role + ')',
        'color:#22c55e;font-weight:bold');

      filterProjectDropdown();
      applyRoleVisibility();
      wireTopbarUser();
      patchProjectSelector();
      applyPermissions(); // Langsung terapkan izin

      // Auto-select project pertama yang bisa diakses
      if (!Auth.canAccess(STATE.activeProject)){
        var firstAccessible = DB.projects.find(function(p){ return Auth.canAccess(p.id); });
        if (firstAccessible){
          STATE.activeProject = firstAccessible.id;
          var sel = document.getElementById('activeProject');
          if (sel) sel.value = STATE.activeProject;
          if (typeof renderAll === 'function') renderAll();
        }
      }

      // Listener ganti proyek
      var selProj = document.getElementById('activeProject');
      if (selProj && !selProj.dataset.rbacWired) {
          selProj.addEventListener('change', function() {
              STATE.activeProject = selProj.value;
              applyPermissions();
              if (typeof renderAll === 'function') renderAll();
          });
          selProj.dataset.rbacWired = 'true';
      }
    }

    function filterProjectDropdown(){
      var sel = document.getElementById('activeProject');
      if (!sel) return;

      var allowed = DB.projects.filter(function(p){ return Auth.canAccess(p.id); });
      
      sel.innerHTML = allowed.length
        ? allowed.map(function(p){
            return '<option value="' + p.id + '">' + esc(p.kode) + ' — ' + esc(p.nama) + '</option>';
          }).join('')
        : '<option value="">(Tidak ada proyek yang bisa diakses)</option>';
        
      if (allowed.length && !allowed.find(p => p.id === STATE.activeProject)) {
        STATE.activeProject = allowed[0].id;
        sel.value = STATE.activeProject;
      }
    }

    function patchProjectSelector(){
      if (typeof window._origRenderProjectSelector !== 'undefined') return;
      window._origRenderProjectSelector = window.renderProjectSelector;
      
      window.renderProjectSelector = function(){
        var sel = document.getElementById('activeProject');
        if (!sel) return;
        var allowed = DB.projects.filter(function(p){ return Auth.canAccess(p.id); });
        
        sel.innerHTML = allowed.length
          ? allowed.map(function(p){
              return '<option value="' + p.id + '">' + esc(p.kode) + ' — ' + esc(p.nama) + '</option>';
            }).join('')
          : '<option value="">(Tidak ada proyek)</option>';
          
        if (STATE.activeProject && allowed.find(function(p){ return p.id === STATE.activeProject; })){
          sel.value = STATE.activeProject;
        } else if (allowed.length){
          STATE.activeProject = allowed[0].id;
          sel.value = STATE.activeProject;
        }
      };
    }

    function applyRoleVisibility(){
      if (Auth.isSuperadmin()) return;

      // Sembunyikan tab yang tidak boleh diakses Owner/Guest
      var restrictedTabs = ['resources', 'ahsp', 'settings', 'projects'];
      restrictedTabs.forEach(function(tabName){
        var tab = document.querySelector('.tab[data-tab="' + tabName + '"]');
        if (tab) tab.style.display = 'none';

        var sec = document.getElementById('sec-' + tabName);
        if (sec) sec.style.display = 'none';
      });

      // Kalau tab aktif termasuk restricted, pindah ke dashboard
      var activeTab = document.querySelector('.tab.active');
      if (activeTab && restrictedTabs.indexOf(activeTab.dataset.tab) >= 0){
        if (typeof switchTab === 'function') switchTab('dashboard');
      }
    }

    function wireTopbarUser(){
      var right = document.querySelector('.topbar-right');
      if (!right) return;

      // Hapus badge lama jika ada
      var existingBadge = document.getElementById('userBadge');
      if (existingBadge) existingBadge.remove();

      var badge = document.createElement('div');
      badge.id = 'userBadge';
      badge.className = 'user-badge';

      // Cek apakah ini Guest Mode
      if (Auth.user.username === 'guest') {
        // Tampilan Guest: Tombol Login
        badge.innerHTML =
          '<span class="user-icon">👤</span>' +
          '<span class="user-name">Tamu</span>' +
          '<span class="user-role">Read-Only</span>' +
          '<button class="btn btn-primary btn-sm" id="btnShowLogin" style="margin-left:8px">🔐 Login</button>';
        badge.querySelector('#btnShowLogin').onclick = showLogin;
      } else {
        // Tampilan User Login: Info & Logout
        badge.innerHTML =
          '<span class="user-icon">👤</span>' +
          '<span class="user-name">' + esc(Auth.user.nama || Auth.user.username) + '</span>' +
          '<span class="user-role">' + esc(Auth.user.role) + '</span>' +
          '<button class="user-logout" title="Logout">⎋</button>';
        badge.querySelector('.user-logout').onclick = doLogout;
      }
      
      right.insertBefore(badge, right.firstChild);
    }

    /* ═══════════════════════════════════════════════════════════
       RBAC — HAK AKSES TOMBOL
       ═══════════════════════════════════════════════════════════ */
    function applyPermissions() {
      if (!Auth.user) return;

      var role = Auth.user.role;
      var isGuest = Auth.user.username === 'guest';
      var activeProjectId = STATE.activeProject;
      var allowedProjects = Auth.user.project_ids || [];
      var isAllowedInProject = allowedProjects.indexOf('*') >= 0 || allowedProjects.indexOf(String(activeProjectId)) >= 0;

      // 1. Daftar tombol Admin
      var adminOnlyButtons = [
        '#btnAddRes', '#btnAddAhsp', '#btnAddProj', '#btnAddCalendar', '#btnAddHoliday',
        '#btnReset', '#btnSeed', '#btnPush', '#btnPull', '#btnSaveSet', '#btnSyncAlat', '#btnSaveKoef'
      ];

      // 2. Daftar tombol Editor (User)
      var editorButtons = [
        '#btnAddWbs', '#btnAddWbsGroup', '#btnImportBQ', '#btnRunCPMWBS',
        '#btnAddProg', '#btnProgressWizard', '#btnRunCPM'
      ];

      // 3. Tombol Edit/Hapus di dalam tabel
      var tableActionButtons = document.querySelectorAll(
        '[data-edit-res], [data-del-res], [data-edit-wbs], [data-del-wbs], ' +
        '[data-edit-pg], [data-del-pg], [data-edit-prj], [data-del-prj], ' +
        '[data-edit-cal], [data-del-cal], [data-edit-hol], [data-del-hol], ' +
        '[data-edit-user], [data-del-user], [data-edit-ahsp], [data-del-ahsp], ' +
        '.btn-danger, .btn-edit, .btn-delete'
      );

      // --- Terapkan Aturan ---
      if (role === 'superadmin' || role === 'admin') {
        // Admin: Tampilkan semua
        adminOnlyButtons.forEach(sel => { var el = document.querySelector(sel); if (el) el.style.display = ''; });
        editorButtons.forEach(sel => { var el = document.querySelector(sel); if (el) el.style.display = ''; });
        tableActionButtons.forEach(el => el.style.display = '');
        
      } else if (role === 'owner' || isGuest) {
        // Owner / Guest: Sembunyikan SEMUA tombol edit/tambah/hapus
        adminOnlyButtons.forEach(sel => { var el = document.querySelector(sel); if (el) el.style.display = 'none'; });
        editorButtons.forEach(sel => { var el = document.querySelector(sel); if (el) el.style.display = 'none'; });
        tableActionButtons.forEach(el => el.style.display = 'none');

      } else if (role === 'user') {
        // User: Sembunyikan tombol admin
        adminOnlyButtons.forEach(sel => { var el = document.querySelector(sel); if (el) el.style.display = 'none'; });
        
        if (isAllowedInProject) {
          // Jika user punya akses ke proyek ini
          editorButtons.forEach(sel => { var el = document.querySelector(sel); if (el) el.style.display = ''; });
          tableActionButtons.forEach(el => el.style.display = '');
        } else {
          // Jika tidak punya akses
          editorButtons.forEach(sel => { var el = document.querySelector(sel); if (el) el.style.display = 'none'; });
          tableActionButtons.forEach(el => el.style.display = 'none');
        }
      }
    }

    /* ═══════════════════════════════════════════════════════════
       USER MANAGEMENT UI (Khusus Superadmin)
       ═══════════════════════════════════════════════════════════ */
    async function renderUserManagement() {
      if (!Auth.isSuperadmin()) return; 

      const tbl = document.getElementById('tblUsers');
      if (!tbl) return;

      tbl.innerHTML = '<tbody><tr><td class="empty">Memuat data user...</td></tr></tbody>';

      try {
        const out = await sheetRequest('listUsers', { token: Auth.token });
        if (!out.ok) {
          tbl.innerHTML = `<tbody><tr><td class="empty">Gagal memuat: ${out.message}</td></tr></tbody>`;
          return;
        }

        const head = `<thead><tr>
          <th>Username</th><th>Nama</th><th>Role</th><th>Proyek</th><th>Status</th><th class="center">Aksi</th>
        </tr></thead>`;

        const body = out.users.map(u => {
          const projText = u.project_ids.includes('*') ? 'Semua Proyek' : u.project_ids.join(', ');
          const statusBadge = u.aktif ? '<span class="badge b-ok">AKTIF</span>' : '<span class="badge b-danger">NONAKTIF</span>';
          return `<tr>
            <td><b>${esc(u.username)}</b></td>
            <td>${esc(u.nama)}</td>
            <td><span class="badge b-warn">${esc(u.role)}</span></td>
            <td style="font-size:11px">${esc(projText)}</td>
            <td>${statusBadge}</td>
            <td class="center">
              <button class="btn btn-sm" data-edit-user="${u.username}">✎</button>
              ${u.username !== 'admin' ? `<button class="btn btn-sm btn-danger" data-del-user="${u.username}">✕</button>` : ''}
            </td>
          </tr>`;
        }).join('');

        tbl.innerHTML = head + `<tbody>${body}</tbody>`;

        tbl.querySelectorAll('[data-edit-user]').forEach(b => b.onclick = () => formUser(b.dataset.editUser, out.users));
        tbl.querySelectorAll('[data-del-user]').forEach(b => b.onclick = async () => {
          if (!confirm(`Hapus user "${b.dataset.delUser}"?`)) return;
          const res = await sheetRequest('deleteUser', { token: Auth.token, username: b.dataset.delUser });
          if (res.ok) { toast('User dihapus'); renderUserManagement(); }
          else toast(res.message, false);
        });

      } catch (e) {
        tbl.innerHTML = `<tbody><tr><td class="empty">Error: ${e.message}</td></tr></tbody>`;
      }
    }

    function formUser(username, users) {
      const isEdit = !!username;
      const u = isEdit ? users.find(x => x.username === username) : null;

      const roleOpts = ['superadmin', 'admin', 'owner', 'user'].map(r => 
        `<option value="${r}" ${u?.role === r ? 'selected' : ''}>${r}</option>`
      ).join('');

      const body = `
        <div class="row">
          <div class="field"><label class="f">Username</label><input id="mu_user" value="${esc(u?.username || '')}" ${isEdit ? 'readonly' : ''} /></div>
          <div class="field"><label class="f">Nama Lengkap</label><input id="mu_nama" value="${esc(u?.nama || '')}" /></div>
        </div>
        <div class="row" style="margin-top:12px">
          <div class="field"><label class="f">Email</label><input id="mu_email" value="${esc(u?.email || '')}" /></div>
          <div class="field"><label class="f">PIN ${isEdit ? '(Kosongkan jika tidak diubah)' : ''}</label><input id="mu_pin" type="password" placeholder="••••••" /></div>
        </div>
        <div class="row" style="margin-top:12px">
          <div class="field"><label class="f">Role</label><select id="mu_role">${roleOpts}</select></div>
          <div class="field" style="flex:3"><label class="f">Project IDs (pisahkan dengan koma)</label><input id="mu_proj" value="${esc(u?.project_ids_raw || (u?.project_ids ? u.project_ids.join(', ') : ''))}" placeholder="SDA-2026-001, SDA-2026-002 atau *" /></div>
        </div>
        <div class="row" style="margin-top:12px">
          <div class="field"><label class="f">Status</label>
            <select id="mu_aktif">
              <option value="1" ${u?.aktif !== false ? 'selected' : ''}>Aktif</option>
              <option value="0" ${u?.aktif === false ? 'selected' : ''}>Nonaktif</option>
            </select>
          </div>
        </div>
      `;

      openModal(isEdit ? 'Edit User' : 'Tambah User Baru', body, () => {
        (async () => {
          const payload = {
            username: document.getElementById('mu_user').value.trim().toLowerCase(),
            nama: document.getElementById('mu_nama').value.trim(),
            email: document.getElementById('mu_email').value.trim(),
            role: document.getElementById('mu_role').value,
            project_ids: document.getElementById('mu_proj').value.trim(),
            aktif: document.getElementById('mu_aktif').value === '1'
          };
          
          const pin = document.getElementById('mu_pin').value.trim();
          if (pin) payload.pin = pin;

          if (!payload.username || !payload.nama) {
            toast('Username & Nama wajib diisi', false);
            return;
          }
          if (!isEdit && !pin) {
            toast('PIN wajib diisi untuk user baru', false);
            return;
          }

          const action = isEdit ? 'updateUser' : 'addUser';
          const res = await sheetRequest(action, { token: Auth.token, user: payload });

          if (res.ok) {
            toast(res.message || 'User disimpan');
            renderUserManagement();
            closeModal();
          } else {
            toast(res.message, false);
          }
        })();
      });
    }

    document.getElementById('btnAddUser')?.addEventListener('click', () => formUser(null, []));
    document.querySelector('.tab[data-tab="settings"]')?.addEventListener('click', () => {
        setTimeout(renderUserManagement, 300);
    });

    /* ═══════════════════════════════════════════════════════════
       SYNC MANAGER EXTENSION
       ═══════════════════════════════════════════════════════════ */
    SyncManager.pushProject = async function(projectId, db){
      if (!Auth.token) throw Object.assign(new Error('Belum login'), { code: 'NO_SESSION' });
      if (!Auth.canAccess(projectId)) throw Object.assign(new Error('Tidak punya akses ke proyek ini'), { code: 'NO_ACCESS' });

      var data = {
        projects: (db.projects || []).filter(function(p){ return p.id === projectId; }),
        project_wbs: (db.project_wbs || []).filter(function(w){ return w.project_id === projectId; }),
        project_ahsp_details: (db.project_ahsp_details || []).filter(function(a){ return a.project_id === projectId; }),
        progress: (db.progress || []).filter(function(p){ return p.project_id === projectId; })
      };

      if (SyncManager.sanitize) data = SyncManager.sanitize(data);

      var out = await sheetRequest('pushProject', { token: Auth.token, projectId: projectId, data: data });
      if (out.ok && typeof out.dbVersion === 'number') STATE.dbVersion = out.dbVersion;
      return out;
    };

    SyncManager.pullProject = async function(projectId){
      if (!Auth.token) throw Object.assign(new Error('Belum login'), { code: 'NO_SESSION' });
      return await sheetRequest('getProject', { token: Auth.token, projectId: projectId });
    };

    /* ═══════════════════════════════════════════════════════════
       INIT FLOW (Mode Guest vs Login)
       ═══════════════════════════════════════════════════════════ */
    async function init(){
      if (Auth.load()){
        try {
          var out = await sheetRequest('getSession', { token: Auth.token });
          if (out.ok && out.user){
            Auth.user = out.user;
            try { localStorage.setItem(USER_KEY, JSON.stringify(out.user)); } catch(e){}
            hideLogin();
            afterLogin();
            return;
          }
        } catch(e){
          console.warn('[MultiUser] Session invalid:', e.message);
        }
        Auth.clear();
      }

      // ═══ MODE GUEST (TANPA LOGIN) ═══
      console.log('%c[MultiUser] Tidak ada sesi. Masuk Mode Guest (Read-Only).', 'color:#f59e0b;font-weight:bold');
      
      Auth.user = { 
        username: 'guest', 
        nama: 'Tamu', 
        role: 'owner', 
        project_ids: ['*'] 
      };
      
      hideLogin();
      afterLogin();
    }

    /* ═══════════════════════════════════════════════════════════
       PUBLIC API
       ═══════════════════════════════════════════════════════════ */
    window.MultiUser = {
      login: doLogin,
      logout: doLogout,
      whoami: function(){
        return Auth.user ? { username: Auth.user.username, nama: Auth.user.nama, role: Auth.user.role, projects: Auth.user.project_ids } : null;
      },
      showLogin: showLogin
    };

    console.log('%c[MultiUser.js] ✅ Multi-User module installed', 'color:#a855f7;font-weight:bold;font-size:13px');

    if (document.readyState === 'loading'){
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', function(){ bootstrap(0); });
  } else {
    bootstrap(0);
  }
})();
