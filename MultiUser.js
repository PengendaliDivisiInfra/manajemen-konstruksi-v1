/* =====================================================================
 * MANAJEMEN KONSTRUKSI v1 — MULTI-USER MODULE
 * Fase 4B + 4D: Login UI + Role-based access + Per-project push
 * Loaded AFTER Schedule.js — tidak menyentuh Schedule.js
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
        return ids.indexOf(String(projectId)) >= 0;
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

        /* Wire events */
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
       POST-LOGIN: filter UI + wire logout
       ═══════════════════════════════════════════════════════════ */
    function afterLogin(){
      console.log('%c[MultiUser] Logged in as ' + Auth.user.username + ' (' + Auth.user.role + ')',
        'color:#22c55e;font-weight:bold');

      /* 1. Filter project dropdown */
      filterProjectDropdown();

      /* 2. Hide master data tabs untuk non-superadmin */
      applyRoleVisibility();

      /* 3. Wire logout + user info di topbar */
      wireTopbarUser();

      /* 4. Auto-select first accessible project */
      if (!Auth.canAccess(STATE.activeProject)){
        var firstAccessible = DB.projects.find(function(p){ return Auth.canAccess(p.id); });
        if (firstAccessible){
          STATE.activeProject = firstAccessible.id;
          var sel = document.getElementById('activeProject');
          if (sel) sel.value = STATE.activeProject;
          if (typeof renderAll === 'function') renderAll();
        } else {
          console.warn('[MultiUser] User tidak punya akses ke proyek manapun');
        }
      }

      /* 5. Patch renderProjectSelector untuk preserve filter */
      patchProjectSelector();
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
    }

    function patchProjectSelector(){
      /* Override renderProjectSelector agar selalu filter by role */
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

      var restrictedTabs = ['resources', 'ahsp', 'settings'];
      restrictedTabs.forEach(function(tabName){
        var tab = document.querySelector('.tab[data-tab="' + tabName + '"]');
        if (tab) tab.style.display = 'none';

        var sec = document.getElementById('sec-' + tabName);
        if (sec) sec.style.display = 'none';
      });

      /* Kalau tab aktif termasuk restricted, pindah ke dashboard */
      var activeTab = document.querySelector('.tab.active');
      if (activeTab && restrictedTabs.indexOf(activeTab.dataset.tab) >= 0){
        if (typeof switchTab === 'function') switchTab('dashboard');
      }
    }

    function wireTopbarUser(){
      var right = document.querySelector('.topbar-right');
      if (!right || document.getElementById('userBadge')) return;

      var badge = document.createElement('div');
      badge.id = 'userBadge';
      badge.className = 'user-badge';
      badge.innerHTML =
        '<span class="user-icon">👤</span>' +
        '<span class="user-name">' + esc(Auth.user.nama || Auth.user.username) + '</span>' +
        '<span class="user-role">' + esc(Auth.user.role) + '</span>' +
        '<button class="user-logout" title="Logout">⎋</button>';
      badge.querySelector('.user-logout').onclick = doLogout;
      right.insertBefore(badge, right.firstChild);
    }

    /* ═══════════════════════════════════════════════════════════
       SYNC MANAGER EXTENSION — pushProject
       ═══════════════════════════════════════════════════════════ */
    SyncManager.pushProject = async function(projectId, db){
      if (!Auth.token){
        throw Object.assign(new Error('Belum login'), { code: 'NO_SESSION' });
      }
      if (!Auth.canAccess(projectId)){
        throw Object.assign(new Error('Tidak punya akses ke proyek ini'), { code: 'NO_ACCESS' });
      }

      /* Ambil slice data proyek */
      var data = {
        projects: (db.projects || []).filter(function(p){ return p.id === projectId; }),
        project_wbs: (db.project_wbs || []).filter(function(w){ return w.project_id === projectId; }),
        project_ahsp_details: (db.project_ahsp_details || []).filter(function(a){ return a.project_id === projectId; }),
        progress: (db.progress || []).filter(function(p){ return p.project_id === projectId; })
      };

      /* Strip field transien */
      if (SyncManager.sanitize){
        data = SyncManager.sanitize(data);
      }

      var sizeKB = SyncManager.estimateSizeKB ? SyncManager.estimateSizeKB(data) : 0;
      console.log('[MultiUser] pushProject payload:', sizeKB, 'KB');

      var out = await sheetRequest('pushProject', {
        token: Auth.token,
        projectId: projectId,
        data: data
      });

      if (out.ok && typeof out.dbVersion === 'number'){
        STATE.dbVersion = out.dbVersion;
      }
      return Object.assign(out, { sizeKB: sizeKB });
    };

    SyncManager.pullProject = async function(projectId){
      if (!Auth.token){
        throw Object.assign(new Error('Belum login'), { code: 'NO_SESSION' });
      }
      var out = await sheetRequest('getProject', {
        token: Auth.token,
        projectId: projectId
      });
      return out;
    };

    /* ═══════════════════════════════════════════════════════════
       INIT FLOW
       ═══════════════════════════════════════════════════════════ */
    async function init(){
      if (Auth.load()){
        /* Ada token → validate ke server */
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
        /* Token expired / invalid */
        Auth.clear();
      }

      /* Belum login */
      showLogin();
    }

    /* ═══════════════════════════════════════════════════════════
       PUBLIC API
       ═══════════════════════════════════════════════════════════ */
    window.MultiUser = {
      login: doLogin,
      logout: doLogout,
      whoami: function(){
        return Auth.user ? {
          username: Auth.user.username,
          nama: Auth.user.nama,
          role: Auth.user.role,
          projects: Auth.user.project_ids
        } : null;
      },
      showLogin: showLogin
    };

    console.log('%c[MultiUser.js] ✅ Multi-User module installed',
      'color:#a855f7;font-weight:bold;font-size:13px');

    /* ── Start ── */
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
