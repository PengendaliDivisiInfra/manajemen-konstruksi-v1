/* =====================================================================
   WBS TEMPLATE — Master WBS Dinamis (Multi-Template, 3-Level Deduktif)
   Exports: window.WbsTemplate
   ===================================================================== */

const WbsTemplate = {

  /* ═══════════════════════════════════════════════════════════
     MASTER TEMPLATES — Modular & Reusable
     Format: [kode, uraian, satuan, level, parentKode, ahsp_kode]
     ═══════════════════════════════════════════════════════════ */
  TEMPLATES: {

    /* ── Template 1: Proyek Sumber Daya Air (SDA) ── */
    SDA: {
      id: 'SDA',
      nama: 'Proyek Sumber Daya Air (Irigasi/Bendung/Embung)',
      deskripsi: 'Struktur 3-level untuk proyek SDA berbasis Permen PUPR',
      items: [
        // ─── LEVEL 1 (Makro) ───
        ['1', 'PEKERJAAN PERSIAPAN & UMUM', 'ls', 1, '', ''],
        ['2', 'PEKERJAAN TANAH & PONDASI', 'm³', 1, '', ''],
        ['3', 'PEKERJAAN STRUKTUR BETON & PASANGAN', 'm³', 1, '', ''],
        ['4', 'PEKERJAAN MEKANIKAL, ELEKTRIKAL & PLAMBING', 'ls', 1, '', ''],
        ['5', 'PEKERJAAN FINISHING & SERAH TERIMA', 'ls', 1, '', ''],

        // ─── LEVEL 2 (Blok Kerja) ───
        ['1.1', 'Mobilisasi & Demobilisasi', 'ls', 2, '1', ''],
        ['1.2', 'Pengukuran & Stake Out', 'ls', 2, '1', ''],
        ['1.3', 'Pekerjaan SMKK (Keselamatan Konstruksi)', 'ls', 2, '1', ''],
        ['1.4', 'Fasilitas Sementara', 'ls', 2, '1', ''],
        ['2.1', 'Pekerjaan Galian Tanah', 'm³', 2, '2', ''],
        ['2.2', 'Pekerjaan Timbunan & Pemadatan', 'm³', 2, '2', ''],
        ['2.3', 'Pekerjaan Pondasi Struktur', 'm³', 2, '2', ''],
        ['3.1', 'Pekerjaan Beton Bertulang', 'm³', 2, '3', ''],
        ['3.2', 'Pekerjaan Bekisting & Perancah', 'm²', 2, '3', ''],
        ['3.3', 'Pekerjaan Pasangan Batu & Bata', 'm³', 2, '3', ''],
        ['3.4', 'Pekerjaan Pembesian', 'kg', 2, '3', ''],
        ['4.1', 'Pekerjaan Mekanikal', 'ls', 2, '4', ''],
        ['4.2', 'Pekerjaan Elektrikal', 'ls', 2, '4', ''],
        ['4.3', 'Pekerjaan Plambing & Drainase', 'ls', 2, '4', ''],
        ['5.1', 'Pekerjaan Finishing & Pengecatan', 'm²', 2, '5', ''],
        ['5.2', 'Pekerjaan Lansekap & Perapihan', 'ls', 2, '5', ''],
        ['5.3', 'Uji Coba & Serah Terima', 'ls', 2, '5', ''],

        // ─── LEVEL 3 (Mikro/Operasional) ───
        ['1.1.1', 'Mobilisasi peralatan berat & personil', 'ls', 3, '1.1', ''],
        ['1.1.2', 'Mobilisasi material utama', 'ls', 3, '1.1', ''],
        ['1.1.3', 'Demobilisasi & pembersihan lokasi', 'ls', 3, '1.1', ''],
        ['1.2.1', 'Pengukuran trase saluran', 'm', 3, '1.2', ''],
        ['1.2.2', 'Pemasangan patok & benchmark', 'titik', 3, '1.2', ''],
        ['1.2.3', 'Pembuatan profil memanjang & melintang', 'ls', 3, '1.2', ''],
        ['1.3.1', 'Penyusunan RKK', 'dok', 3, '1.3', ''],
        ['1.3.2', 'Pemasangan rambu K3 & APD', 'ls', 3, '1.3', ''],
        ['1.3.3', 'Sosialisasi K3 pekerja', 'kali', 3, '1.3', ''],
        ['1.4.1', 'Pembangunan direksi keet', 'm²', 3, '1.4', ''],
        ['1.4.2', 'Pembangunan gudang material', 'm²', 3, '1.4', ''],
        ['1.4.3', 'Instalasi air & listrik sementara', 'ls', 3, '1.4', ''],
        ['2.1.1', 'Galian tanah biasa saluran', 'm³', 3, '2.1', '1.1.1'],
        ['2.1.2', 'Galian tanah keras / batuan', 'm³', 3, '2.1', ''],
        ['2.1.3', 'Galian struktur pondasi', 'm³', 3, '2.1', '1.1.1'],
        ['2.2.1', 'Timbunan tanah biasa', 'm³', 3, '2.2', '1.1.2'],
        ['2.2.2', 'Timbunan tanah pilihan', 'm³', 3, '2.2', ''],
        ['2.2.3', 'Pemadatan per lapis', 'm³', 3, '2.2', ''],
        ['2.3.1', 'Pondasi batu belah 1:4', 'm³', 3, '2.3', '1.3.1'],
        ['2.3.2', 'Pondasi tapak beton bertulang', 'm³', 3, '2.3', '1.2.1'],
        ['2.3.3', 'Pondasi tiang pancang', 'titik', 3, '2.3', ''],
        ['3.1.1', 'Beton struktur K-225 (lining saluran)', 'm³', 3, '3.1', '1.2.1'],
        ['3.1.2', 'Beton struktur K-300', 'm³', 3, '3.1', '1.2.1'],
        ['3.1.3', 'Beton lantai kerja (lean concrete)', 'm³', 3, '3.1', ''],
        ['3.2.1', 'Bekisting dinding & kolom', 'm²', 3, '3.2', '1.4.1'],
        ['3.2.2', 'Bekisting plat lantai & balok', 'm²', 3, '3.2', '1.4.1'],
        ['3.2.3', 'Perancah scaffolding', 'm²', 3, '3.2', ''],
        ['3.3.1', 'Pasangan batu belah 1:4', 'm³', 3, '3.3', '1.3.1'],
        ['3.3.2', 'Pasangan bata ringan/merah', 'm²', 3, '3.3', ''],
        ['3.3.3', 'Plesteran & acian', 'm²', 3, '3.3', ''],
        ['3.4.1', 'Pembesian besi ulir D13', 'kg', 3, '3.4', '1.2.2'],
        ['3.4.2', 'Pembesian besi polos D8', 'kg', 3, '3.4', '1.2.2'],
        ['3.4.3', 'Pemasangan wiremesh', 'm²', 3, '3.4', ''],
        ['4.1.1', 'Pemasangan pintu air / sluice gate', 'unit', 3, '4.1', ''],
        ['4.1.2', 'Pemasangan pompa air & perpipaan', 'unit', 3, '4.1', ''],
        ['4.1.3', 'Pemasangan trash rack', 'unit', 3, '4.1', ''],
        ['4.2.1', 'Instalasi penerangan & panel kontrol', 'ls', 3, '4.2', ''],
        ['4.2.2', 'Instalasi grounding & arrester', 'ls', 3, '4.2', ''],
        ['4.2.3', 'Instalasi genset backup', 'unit', 3, '4.2', ''],
        ['4.3.1', 'Instalasi air bersih', 'ls', 3, '4.3', ''],
        ['4.3.2', 'Instalasi air kotor & drainase', 'ls', 3, '4.3', ''],
        ['4.3.3', 'Saluran penguras (wash out)', 'm', 3, '4.3', ''],
        ['5.1.1', 'Pengecatan dinding & struktur', 'm²', 3, '5.1', ''],
        ['5.1.2', 'Pemasangan lantai kerja finishing', 'm²', 3, '5.1', ''],
        ['5.1.3', 'Pemasangan kusen, pintu & jendela', 'unit', 3, '5.1', ''],
        ['5.2.1', 'Penanaman rumput & tanaman', 'm²', 3, '5.2', ''],
        ['5.2.2', 'Pembuatan saluran tepi', 'm', 3, '5.2', ''],
        ['5.2.3', 'Pembersihan akhir & perapihan', 'ls', 3, '5.2', ''],
        ['5.3.1', 'Uji coba fungsi (commissioning)', 'ls', 3, '5.3', ''],
        ['5.3.2', 'Pemeliharaan 30 hari', 'hari', 3, '5.3', ''],
        ['5.3.3', 'BAST (Berita Acara Serah Terima)', 'dok', 3, '5.3', '']
      ]
    },

    /* ── Template 2: Gedung (Building) ── */
    GEDUNG: {
      id: 'GEDUNG',
      nama: 'Proyek Gedung / Bangunan Sipil',
      deskripsi: 'Struktur 3-level untuk proyek gedung bertingkat',
      items: [
        ['1', 'PEKERJAAN PERSIAPAN', 'ls', 1, '', ''],
        ['2', 'PEKERJAAN STRUKTUR BAWAH', 'm³', 1, '', ''],
        ['3', 'PEKERJAAN STRUKTUR ATAS', 'm³', 1, '', ''],
        ['4', 'PEKERJAAN ARSITEKTUR & FINISHING', 'm²', 1, '', ''],
        ['5', 'PEKERJAAN MEP (Mekanikal, Elektrikal, Plambing)', 'ls', 1, '', ''],

        ['1.1', 'Pembersihan Lahan & Bouwplank', 'ls', 2, '1', ''],
        ['1.2', 'Fasilitas Sementara & K3', 'ls', 2, '1', ''],
        ['2.1', 'Galian & Pondasi', 'm³', 2, '2', ''],
        ['2.2', 'Sloof & Balok Bawah', 'm³', 2, '2', ''],
        ['3.1', 'Kolom & Balok Beton Bertulang', 'm³', 2, '3', ''],
        ['3.2', 'Plat Lantai & Tangga', 'm²', 2, '3', ''],
        ['4.1', 'Pasangan Dinding & Plesteran', 'm²', 2, '4', ''],
        ['4.2', 'Pengecatan & Finishing', 'm²', 2, '4', ''],
        ['5.1', 'Instalasi Listrik & Penerangan', 'ls', 2, '5', ''],
        ['5.2', 'Instalasi Air & Sanitasi', 'ls', 2, '5', ''],

        ['1.1.1', 'Pembersihan lahan & pengukuran', 'm²', 3, '1.1', ''],
        ['1.1.2', 'Pembuatan bouwplank', 'm', 3, '1.1', ''],
        ['1.2.1', 'Direksi keet & gudang', 'm²', 3, '1.2', ''],
        ['1.2.2', 'Rambu K3 & APD', 'ls', 3, '1.2', ''],
        ['2.1.1', 'Galian tanah pondasi', 'm³', 3, '2.1', '1.1.1'],
        ['2.1.2', 'Pondasi batu kali', 'm³', 3, '2.1', '1.3.1'],
        ['2.1.3', 'Pondasi footplat beton', 'm³', 3, '2.1', '1.2.1'],
        ['2.2.1', 'Sloof beton K-225', 'm³', 3, '2.2', '1.2.1'],
        ['2.2.2', 'Pembesian sloof', 'kg', 3, '2.2', '1.2.2'],
        ['3.1.1', 'Kolom beton K-250', 'm³', 3, '3.1', '1.2.1'],
        ['3.1.2', 'Balok beton K-250', 'm³', 3, '3.1', '1.2.1'],
        ['3.1.3', 'Pembesian kolom & balok', 'kg', 3, '3.1', '1.2.2'],
        ['3.2.1', 'Plat lantai beton', 'm²', 3, '3.2', '1.2.1'],
        ['3.2.2', 'Tangga beton bertulang', 'm²', 3, '3.2', ''],
        ['4.1.1', 'Pasangan bata merah 1:4', 'm²', 3, '4.1', ''],
        ['4.1.2', 'Plesteran & acian', 'm²', 3, '4.1', ''],
        ['4.2.1', 'Pengecatan interior & eksterior', 'm²', 3, '4.2', ''],
        ['4.2.2', 'Pemasangan keramik lantai', 'm²', 3, '4.2', ''],
        ['5.1.1', 'Instalasi titik lampu & saklar', 'titik', 3, '5.1', ''],
        ['5.1.2', 'Panel distribusi utama', 'unit', 3, '5.1', ''],
        ['5.2.1', 'Instalasi air bersih PPR', 'm', 3, '5.2', ''],
        ['5.2.2', 'Instalasi air kotor PVC', 'm', 3, '5.2', ''],
        ['5.2.3', 'Sanitasi & fixture', 'unit', 3, '5.2', '']
      ]
    },

    /* ── Template 3: Jalan ── */
    JALAN: {
      id: 'JALAN',
      nama: 'Proyek Jalan & Jembatan',
      deskripsi: 'Struktur 3-level untuk pekerjaan jalan raya',
      items: [
        ['1', 'PEKERJAAN PERSIAPAN', 'ls', 1, '', ''],
        ['2', 'PEKERJAAN TANAH & DRAINASE', 'm³', 1, '', ''],
        ['3', 'PEKERJAAN PERKERASAN JALAN', 'm²', 1, '', ''],
        ['4', 'PEKERJAAN STRUKTUR JEMBATAN', 'm³', 1, '', ''],
        ['5', 'PEKERJAAN FINISHING & MARKA', 'ls', 1, '', ''],

        ['1.1', 'Mobilisasi & K3', 'ls', 2, '1', ''],
        ['2.1', 'Galian & Timbunan', 'm³', 2, '2', ''],
        ['2.2', 'Drainase & Saluran Samping', 'm', 2, '2', ''],
        ['3.1', 'Lapis Pondasi Agregat', 'm³', 2, '3', ''],
        ['3.2', 'Lapis Perkerasan Aspal/Beton', 'm²', 2, '3', ''],
        ['4.1', 'Pondasi Jembatan', 'm³', 2, '4', ''],
        ['4.2', 'Struktur Atas Jembatan', 'm³', 2, '4', ''],
        ['5.1', 'Marka & Rambu Jalan', 'm', 2, '5', ''],
        ['5.2', 'Finishing & Perapihan', 'ls', 2, '5', ''],

        ['1.1.1', 'Mobilisasi alat berat', 'ls', 3, '1.1', ''],
        ['1.1.2', 'Pengaturan lalu lintas', 'ls', 3, '1.1', ''],
        ['2.1.1', 'Galian tanah biasa', 'm³', 3, '2.1', '1.1.1'],
        ['2.1.2', 'Timbunan tanah pilihan', 'm³', 3, '2.1', '1.1.2'],
        ['2.1.3', 'Pemadatan per lapis', 'm³', 3, '2.1', ''],
        ['2.2.1', 'Galian saluran drainase', 'm³', 3, '2.2', ''],
        ['2.2.2', 'Pasangan batu saluran', 'm³', 3, '2.2', '1.3.1'],
        ['3.1.1', 'LPA kelas A', 'm³', 3, '3.1', ''],
        ['3.1.2', 'Lapis pondasi bawah beton', 'm³', 3, '3.1', '1.2.1'],
        ['3.2.1', 'Lapis AC-WC', 'm²', 3, '3.2', ''],
        ['3.2.2', 'Lapis AC-BC', 'm²', 3, '3.2', ''],
        ['3.2.3', 'Lapis perkerasan beton', 'm²', 3, '3.2', '1.2.1'],
        ['4.1.1', 'Pondasi sumuran', 'm³', 3, '4.1', ''],
        ['4.1.2', 'Pondasi tiang pancang', 'titik', 3, '4.1', ''],
        ['4.2.1', 'Gelagar beton pratekan', 'm', 3, '4.2', ''],
        ['4.2.2', 'Plat lantai jembatan', 'm²', 3, '4.2', '1.2.1'],
        ['4.2.3', 'Pagar pengaman jembatan', 'm', 3, '4.2', ''],
        ['5.1.1', 'Marka jalan termoplastik', 'm', 3, '5.1', ''],
        ['5.1.2', 'Rambu lalu lintas', 'unit', 3, '5.1', ''],
        ['5.2.1', 'Pembersihan akhir', 'ls', 3, '5.2', ''],
        ['5.2.2', 'Finishing tepi jalan', 'm', 3, '5.2', '']
      ]
    }
  },

  /* ═══════════════════════════════════════════════════════════
     PARSER: Deteksi level dari kode (deduktif top-down)
     "1"     → level 1 (Summary/Phase)
     "1.1"   → level 2 (Sub-task/Block)
     "1.1.1" → level 3 (Work Package/Leaf)
     ═══════════════════════════════════════════════════════════ */
  parseLevel(kode){
    if (!kode) return 0;
    const parts = String(kode).trim().split('.').filter(Boolean);
    return parts.length;
  },

  /* ═══════════════════════════════════════════════════════════
     VALIDATOR: Cek konsistensi struktur 3-level deduktif
     ═══════════════════════════════════════════════════════════ */
  validateStructure(items){
    const errors = [];
    const seenKodes = new Set();

    items.forEach(([kode, uraian, satuan, level, parentKode]) => {
      // 1. Duplikat kode
      if (seenKodes.has(kode)){
        errors.push('Duplikat kode: ' + kode);
      }
      seenKodes.add(kode);

      // 2. Level sesuai kedalaman digit
      const parsedLevel = this.parseLevel(kode);
      if (parsedLevel !== level){
        errors.push('Level mismatch: kode=' + kode + ' (parsed=' + parsedLevel + ', declared=' + level + ')');
      }

      // 3. Parent reference valid
      if (level > 1 && !parentKode){
        errors.push('Level ' + level + ' tanpa parent: ' + kode);
      }

      // 4. Parent harus ada di list (untuk level 2+)
      if (level > 1 && parentKode){
        const parentExists = items.some(i => i[0] === parentKode);
        if (!parentExists){
          errors.push('Parent tidak ditemukan: ' + kode + ' → ' + parentKode);
        }
      }

      // 5. Hanya level 1 yang boleh tanpa parent
      if (level === 1 && parentKode){
        errors.push('Level 1 tidak boleh punya parent: ' + kode);
      }
    });

    return { ok: errors.length === 0, errors };
  },

  /* ═══════════════════════════════════════════════════════════
     GENERATE: Insert template ke project (menggantikan existing)
     ═══════════════════════════════════════════════════════════ */
  generate(projectId, templateKey, options){
    options = options || {};
    templateKey = templateKey || 'SDA';

    if (!projectId){
      if (typeof toast === 'function') toast('Pilih proyek dulu', false);
      return { ok: false, message: 'projectId kosong' };
    }

    const proj = DB.projects.find(p => p.id === projectId);
    if (!proj){
      if (typeof toast === 'function') toast('Proyek tidak ditemukan', false);
      return { ok: false, message: 'Proyek tidak ditemukan' };
    }

    const template = this.TEMPLATES[templateKey];
    if (!template){
      if (typeof toast === 'function') toast('Template tidak ditemukan: ' + templateKey, false);
      return { ok: false, message: 'Template tidak ditemukan' };
    }

    // Validate structure
    const validation = this.validateStructure(template.items);
    if (!validation.ok){
      console.error('[WbsTemplate] Validasi gagal:', validation.errors);
      if (typeof toast === 'function') toast('⚠ Template tidak valid: ' + validation.errors[0], false);
      return { ok: false, message: 'Template tidak valid', errors: validation.errors };
    }

    // Cek existing
    const existing = DB.project_wbs.filter(w => w.project_id === projectId);
    if (existing.length > 0 && !options.force){
      return { ok: false, message: 'WBS sudah ada (' + existing.length + ' item)', count: existing.length };
    }

    if (typeof Undo !== 'undefined') Undo.snapshot('Generate WBS Template: ' + templateKey);

    // Hapus WBS lama jika force
    if (options.force){
      DB.project_wbs = DB.project_wbs.filter(w => w.project_id !== projectId);
    }

    // Build kode → id map & insert
    const kodeToId = {};
    let urut = 1;
    let added = 0;

    // Sort natural: 1 < 1.1 < 1.1.1 < 1.2 < 2
    const sorted = template.items.slice().sort((a, b) => {
      const pa = String(a[0]).split('.').map(Number);
      const pb = String(b[0]).split('.').map(Number);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++){
        const va = pa[i] || 0;
        const vb = pb[i] || 0;
        if (va !== vb) return va - vb;
      }
      return 0;
    });

    sorted.forEach(([kode, uraian, satuan, level, parentKode, ahspKode]) => {
      const id = (typeof uid === 'function') ? uid('wbs') : 'wbs_' + Date.now() + '_' + urut;
      const isGroup = (level === 1 || level === 2) ? 1 : 0;
      const parentId = parentKode ? (kodeToId[parentKode] || '') : '';

      // Resolve AHSP by kode
      let ahspId = '';
      if (ahspKode && typeof AhspMaster !== 'undefined'){
        const ahsp = AhspMaster.getByKode(ahspKode);
        if (ahsp) ahspId = ahsp.id;
      }

      DB.project_wbs.push({
        id, project_id: projectId,
        kode_wbs: kode,
        uraian: uraian,
        sta: '-',
        satuan: satuan || '',
        volume_rab: 0,
        volume_rap: 0,
        ahsp_id: ahspId,
        parent_id: parentId,
        is_group: isGroup,
        urut: urut++,
        wbs_level: level,
        predecessor: '',
        pred_type: 'FS',
        lag_days: 0,
        duration: 1,
        schedule_mode: 'auto',
        work_contour: ''
      });

      kodeToId[kode] = id;
      added++;
    });

    // Auto-save & recalc
    if (typeof saveDB === 'function') saveDB();
    if (typeof runCPM === 'function') runCPM(projectId);

    return {
      ok: true,
      message: 'WBS ' + templateKey + ' berhasil digenerate: ' + added + ' item',
      count: added,
      template: templateKey,
      breakdown: {
        level1: sorted.filter(x => x[3] === 1).length,
        level2: sorted.filter(x => x[3] === 2).length,
        level3: sorted.filter(x => x[3] === 3).length
      }
    };
  },

  /* ═══════════════════════════════════════════════════════════
     UI: Modal pemilihan template + konfirmasi
     ═══════════════════════════════════════════════════════════ */
  openDialog(projectId){
    projectId = projectId || (typeof STATE !== 'undefined' ? STATE.activeProject : null);
    if (!projectId){
      if (typeof toast === 'function') toast('Pilih proyek dulu', false);
      return;
    }

    const proj = DB.projects.find(p => p.id === projectId);
    if (!proj){
      if (typeof toast === 'function') toast('Proyek tidak ditemukan', false);
      return;
    }

    const existing = DB.project_wbs.filter(w => w.project_id === projectId);
    const hasExisting = existing.length > 0;

    // Build template cards
    const templateCards = Object.keys(this.TEMPLATES).map(key => {
      const t = this.TEMPLATES[key];
      const l1 = t.items.filter(i => i[3] === 1).length;
      const l2 = t.items.filter(i => i[3] === 2).length;
      const l3 = t.items.filter(i => i[3] === 3).length;
      return `
        <div class="wbs-tpl-card" data-template="${key}">
          <div class="wbs-tpl-icon">📐</div>
          <div class="wbs-tpl-name">${esc(t.nama)}</div>
          <div class="wbs-tpl-desc">${esc(t.deskripsi)}</div>
          <div class="wbs-tpl-stats">
            <span class="wbs-tpl-stat lvl1">L1: ${l1}</span>
            <span class="wbs-tpl-stat lvl2">L2: ${l2}</span>
            <span class="wbs-tpl-stat lvl3">L3: ${l3}</span>
            <span class="wbs-tpl-stat total">Total: ${t.items.length}</span>
          </div>
        </div>
      `;
    }).join('');

    const body = `
      <div class="wbs-tpl-intro">
        Pilih template WBS 3-level deduktif. Template akan di-generate ke proyek <b>${esc(proj.kode)}</b>.
      </div>

      ${hasExisting ? `
        <div class="wbs-tpl-warn">
          <b>⚠ Proyek ini sudah punya ${existing.length} item WBS.</b><br>
          Template baru akan <b>MENGGANTI</b> seluruh WBS lama. Lanjutkan?
        </div>
      ` : ''}

      <div class="wbs-tpl-grid" id="wbsTemplateGrid">
        ${templateCards}
      </div>

      <div class="wbs-tpl-preview" id="wbsTplPreview">
        <div class="wbs-tpl-preview-empty">👆 Pilih template di atas untuk preview</div>
      </div>
    `;

    if (typeof openModal === 'function'){
      openModal('📐 Generate WBS Template', body, () => {
        const selected = document.querySelector('.wbs-tpl-card.is-selected');
        if (!selected){
          if (typeof toast === 'function') toast('Pilih template dulu', false);
          return false;
        }
        const templateKey = selected.getAttribute('data-template');
        const result = WbsTemplate.generate(projectId, templateKey, { force: true });
        if (result.ok){
          if (typeof toast === 'function') toast('✅ ' + result.message);
          if (typeof closeModal === 'function') closeModal();
          if (typeof renderWbs === 'function') renderWbs();
        } else {
          if (typeof toast === 'function') toast('⚠ ' + result.message, false);
        }
      });
    }

    // Wire: pilih template card → tampilkan preview
    setTimeout(() => {
      document.querySelectorAll('.wbs-tpl-card').forEach(card => {
        card.onclick = () => {
          document.querySelectorAll('.wbs-tpl-card').forEach(c => c.classList.remove('is-selected'));
          card.classList.add('is-selected');
          WbsTemplate._renderPreview(card.getAttribute('data-template'));
        };
      });
    }, 50);
  },

  _renderPreview(templateKey){
    const preview = document.getElementById('wbsTplPreview');
    if (!preview) return;

    const template = this.TEMPLATES[templateKey];
    if (!template){ preview.innerHTML = '<div class="empty">Template tidak ditemukan</div>'; return; }

    // Build hierarchical preview
    const items = template.items;
    const byParent = {};
    items.forEach(i => {
      const pk = i[4] || '__root__';
      (byParent[pk] = byParent[pk] || []).push(i);
    });

    const renderLevel = (parentKey, depth) => {
      const list = (byParent[parentKey] || []).sort((a, b) => {
        const pa = String(a[0]).split('.').map(Number);
        const pb = String(b[0]).split('.').map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++){
          const va = pa[i] || 0, vb = pb[i] || 0;
          if (va !== vb) return va - vb;
        }
        return 0;
      });
      return list.map(item => {
        const [kode, uraian, satuan, level] = item;
        const indent = depth * 18;
        const cls = 'lvl' + level;
        let html = `<div class="wbs-tpl-prev-row ${cls}">
          <span class="wbs-tpl-prev-kode" style="padding-left:${indent}px">${esc(kode)}</span>
          <span class="wbs-tpl-prev-uraian">${esc(uraian)}</span>
          <span class="wbs-tpl-prev-sat">${esc(satuan || '—')}</span>
          <span class="wbs-tpl-prev-lvl">L${level}</span>
        </div>`;
        if (level < 3){
          html += renderLevel(kode, depth + 1);
        }
        return html;
      }).join('');
    };

    preview.innerHTML = `
      <div class="wbs-tpl-prev-head">
        <b>Preview: ${esc(template.nama)}</b>
        <span class="wbs-tpl-prev-total">${items.length} item total</span>
      </div>
      <div class="wbs-tpl-prev-wrap">
        <div class="wbs-tpl-prev-row head">
          <span class="wbs-tpl-prev-kode">KODE</span>
          <span class="wbs-tpl-prev-uraian">URAIAN</span>
          <span class="wbs-tpl-prev-sat">SAT</span>
          <span class="wbs-tpl-prev-lvl">LEVEL</span>
        </div>
        ${renderLevel('__root__', 0)}
      </div>
    `;
  }
};

window.WbsTemplate = WbsTemplate;
console.log('%c[WbsTemplate.js] ✅ Master WBS Template loaded (3 templates)',
  'color:#a855f7;font-weight:bold;font-size:12px');
