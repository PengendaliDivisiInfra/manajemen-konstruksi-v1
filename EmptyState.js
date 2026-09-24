/* =====================================================================
 * MANAJEMEN KONSTRUKSI v1 — EMPTY STATE COMPONENT
 * Fase 3E-5: Unified empty state untuk semua view
 * Loaded AFTER Schedule.js — independent module
 * ===================================================================== */

(function emptyStateModule(){
  function bootstrap(){
    if (window._emptyStateInstalled) return;
    window._emptyStateInstalled = true;

    /* ═══════════════════════════════════════════════════════════
       TEMPLATES — icon per kategori
       ═══════════════════════════════════════════════════════════ */
    var ICONS = {
      data:     '📊',
      project:  '🏗',
      task:     '📋',
      resource: '🧱',
      schedule: '📅',
      cost:     '💰',
      report:   '📄',
      baseline: '📌',
      filter:   '🔍',
      chart:    '📈'
    };

    function _esc(s){
      return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
      });
    }

    /* ═══════════════════════════════════════════════════════════
       BUILD HTML
       opts = {
         icon: 'data' | emoji custom,
         title: 'Judul',
         message: 'Penjelasan',
         hint: 'Hint tambahan',
         cta: { label: 'Tambah WBS', action: fn }
       }
       ═══════════════════════════════════════════════════════════ */
    function build(opts){
      opts = opts || {};
      var icon = ICONS[opts.icon] || opts.icon || ICONS.data;
      var size = opts.size || 'md';

      var html =
        '<div class="empty-state empty-' + size + '">' +
          '<div class="empty-icon">' + icon + '</div>' +
          '<div class="empty-title">' + _esc(opts.title || 'Tidak ada data') + '</div>' +
          (opts.message ? '<div class="empty-message">' + _esc(opts.message) + '</div>' : '') +
          (opts.hint ? '<div class="empty-hint">' + opts.hint + '</div>' : '') +
          (opts.cta && opts.cta.label
            ? '<div class="empty-cta">' +
                '<button class="btn btn-primary btn-empty-cta" type="button">' +
                  _esc(opts.cta.label) +
                '</button>' +
              '</div>'
            : '') +
        '</div>';

      return html;
    }

    /* ═══════════════════════════════════════════════════════════
       MOUNT — inject ke container + wire CTA
       ═══════════════════════════════════════════════════════════ */
    function mount(container, opts){
      if (!container) return;
      if (typeof container === 'string'){
        container = document.querySelector(container);
        if (!container) return;
      }
      container.innerHTML = build(opts);
      if (opts.cta && typeof opts.cta.action === 'function'){
        var btn = container.querySelector('.btn-empty-cta');
        if (btn) btn.onclick = opts.cta.action;
      }
    }

    /* ═══════════════════════════════════════════════════════════
       PUBLIC API
       ═══════════════════════════════════════════════════════════ */
    window.EmptyState = {
      build: build,
      mount: mount,
      icons: ICONS
    };

    console.log('%c[EmptyState.js] ✅ Empty State component installed',
      'color:#22c55e;font-weight:bold;font-size:13px');
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
