/* =====================================================================
   WBS TEMPLATE — Auto-Generate 3-Level Hierarki untuk Proyek SDA
   ===================================================================== */

const WbsTemplate = {

  /* ═══════════════════════════════════════════════════════════
     TEMPLATE WBS — Proyek Sumber Daya Air (SDA)
     Format: [kode, uraian, satuan, level, parentKode]
     ═══════════════════════════════════════════════════════════ */
  SDA_TEMPLATE: [
    // ─── LEVEL 1 ───
    ['1', 'PEKERJAAN PERSIAPAN & UMUM', '', 1, ''],
    ['2', 'PEKERJAAN TANAH & PONDASI', '', 1, ''],
    ['3', 'PEKERJAAN STRUKTUR BETON & PASANGAN', '', 1, ''],
    ['4', 'PEKERJAAN MEKANIKAL, ELEKTRIKAL & PLAMBING', '', 1, ''],
    ['5', 'PEKERJAAN FINISHING & SERAH TERIMA', '', 1, ''],

    // ─── LEVEL 2 (di bawah "1") ───
    ['1.1', 'Mobilisasi & Demobilisasi', 'ls', 2, '1'],
    ['1.2', 'Pengukuran & Stake Out', 'ls', 2, '1'],
    ['1.3', 'Pekerjaan SMKK (Keselamatan Konstruksi)', 'ls', 2, '1'],
    ['1.4', 'Fasilitas Sementara', 'ls', 2, '1'],

    ['2.1', 'Pekerjaan Galian Tanah', 'm³', 2, '2'],
    ['2.2', 'Pekerjaan Timbunan & Pemadatan', 'm³', 2, '2'],
    ['2.3', 'Pekerjaan Pondasi Struktur', 'm³', 2, '2'],

    ['3.1', 'Pekerjaan Beton Bertulang', 'm³', 2, '3'],
    ['3.2', 'Pekerjaan Bekisting & Perancah', 'm²', 2, '3'],
    ['3.3', 'Pekerjaan Pasangan Batu & Bata', 'm³', 2, '3'],
    ['3.4', 'Pekerjaan Pembesian', 'kg', 2, '3'],

    ['4.1', 'Pekerjaan Mekanikal', 'ls', 2, '4'],
    ['4.2', 'Pekerjaan Elektrikal', 'ls', 2, '4'],
    ['4.3', 'Pekerjaan Plambing & Drainase', 'ls', 2, '4'],

    ['5.1', 'Pekerjaan Finishing & Pengecatan', 'm²', 2, '5'],
    ['5.2', 'Pekerjaan Lansekap & Perapihan', 'ls', 2, '5'],
    ['5.3', 'Uji Coba & Serah Terima', 'ls', 2, '5'],

    // ─── LEVEL 3 (di bawah "1.x") ───
    ['1.1.1', 'Mobilisasi peralatan berat & personil', 'ls', 3, '1.1'],
    ['1.1.2', 'Mobilisasi material utama', 'ls', 3, '1.1'],
    ['1.1.3', 'Demobilisasi & pembersihan lokasi', 'ls', 3, '1.1'],

    ['1.2.1', 'Pengukuran trase saluran', 'm', 3, '1.2'],
    ['1.2.2', 'Pemasangan patok & benchmark', 'titik', 3, '1.2'],
    ['1.2.3', 'Pembuatan profil memanjang & melintang', 'ls', 3, '1.2'],

    ['1.3.1', 'Penyusunan RKK (Rencana Keselamatan Konstruksi)', 'dok', 3, '1.3'],
    ['1.3.2', 'Pemasangan rambu K3 & APD', 'ls', 3, '1.3'],
    ['1.3.3', 'Sosialisasi K3 kepada pekerja', 'kali', 3, '1.3'],

    ['1.4.1', 'Pembangunan direksi keet', 'm²', 3, '1.4'],
    ['1.4.2', 'Pembangunan gudang material', 'm²', 3, '1.4'],
    ['1.4.3', 'Instalasi air & listrik sementara', 'ls', 3, '1.4'],

    // ─── LEVEL 3 (di bawah "2.x") ───
    ['2.1.1', 'Galian tanah biasa saluran', 'm³', 3, '2.1'],
    ['2.1.2', 'Galian tanah keras / batuan', 'm³', 3, '2.1'],
    ['2.1.3', 'Galian struktur pondasi', 'm³', 3, '2.1'],

    ['2.2.1', 'Timbunan tanah biasa', 'm³', 3, '2.2'],
    ['2.2.2', 'Timbunan tanah pilihan', 'm³', 3, '2.2'],
    ['2.2.3', 'Pemadatan per lapis (compaction)', 'm³', 3, '2.2'],

    ['2.3.1', 'Pondasi batu belah 1:4', 'm³', 3, '2.3'],
    ['2.3.2', 'Pondasi tapak beton bertulang', 'm³', 3, '2.3'],
    ['2.3.3', 'Pondasi tiang pancang (jika ada)', 'titik', 3, '2.3'],

    // ─── LEVEL 3 (di bawah "3.x") ───
    ['3.1.1', 'Beton struktur K-225 (lining saluran)', 'm³', 3, '3.1'],
    ['3.1.2', 'Beton struktur K-300 (bangunan utama)', 'm³', 3, '3.1'],
    ['3.1.3', 'Beton lantai kerja (lean concrete)', 'm³', 3, '3.1'],

    ['3.2.1', 'Bekisting dinding & kolom', 'm²', 3, '3.2'],
    ['3.2.2', 'Bekisting plat lantai & balok', 'm²', 3, '3.2'],
    ['3.2.3', 'Perancah scaffolding', 'm²', 3, '3.2'],

    ['3.3.1', 'Pasangan batu belah 1:4', 'm³', 3, '3.3'],
    ['3.3.2', 'Pasangan bata ringan / merah', 'm²', 3, '3.3'],
    ['3.3.3', 'Plesteran & acian', 'm²', 3, '3.3'],

    ['3.4.1', 'Pembesian besi ulir D13', 'kg', 3, '3.4'],
    ['3.4.2', 'Pembesian besi polos D8', 'kg', 3, '3.4'],
    ['3.4.3', 'Pemasangan wiremesh', 'm²', 3, '3.4'],

    // ─── LEVEL 3 (di bawah "4.x") ───
    ['4.1.1', 'Pemasangan pintu air / sluice gate', 'unit', 3, '4.1'],
    ['4.1.2', 'Pemasangan pompa air & perpipaan', 'unit', 3, '4.1'],
    ['4.1.3', 'Pemasangan trash rack / saringan', 'unit', 3, '4.1'],

    ['4.2.1', 'Instalasi penerangan & panel kontrol', 'ls', 3, '4.2'],
    ['4.2.2', 'Instalasi grounding & lightning arrester', 'ls', 3, '4.2'],
    ['4.2.3', 'Instalasi genset backup', 'unit', 3, '4.2'],

    ['4.3.1', 'Instalasi air bersih', 'ls', 3, '4.3'],
    ['4.3.2', 'Instalasi air kotor & drainase', 'ls', 3, '4.3'],
    ['4.3.3', 'Pemasangan saluran penguras (wash out)', 'm', 3, '4.3'],

    // ─── LEVEL 3 (di bawah "5.x") ───
    ['5.1.1', 'Pengecatan dinding & struktur', 'm²', 3, '5.1'],
    ['5.1.2', 'Pemasangan lantai kerja finishing', 'm²', 3, '5.1'],
    ['5.1.3', 'Pemasangan kusen, pintu & jendela', 'unit', 3, '5.1'],

    ['5.2.1', 'Penanaman rumput & tanaman', 'm²', 3, '5.2'],
    ['5.2.2', 'Pembuatan saluran tepi (drainase)', 'm', 3, '5.2'],
    ['5.2.3', 'Pembersihan akhir & perapihan', 'ls', 3, '5.2'],

    ['5.3.1', 'Uji coba fungsi (commissioning)', 'ls', 3, '5.3'],
    ['5.3.2', 'Pemeliharaan 30 hari', 'hari', 3, '5.3'],
    ['5.3.3', 'Berita Acara Serah Terima (BAST)', 'dok', 3, '5.3']
  ],

  /* ═══════════════════════════════════════════════════════════
     GENERATE: Insert WBS template ke project
     ═══════════════════════════════════════════════════════════ */
  generate(projectId, options){
    options = options || {};
    if (!projectId){
      if (typeof toast === 'function') toast('Pilih proyek dulu', false);
      return { ok: false, message: 'projectId kosong' };
    }

    const proj = DB.projects.find(p => p.id === projectId);
    if (!proj){
      if (typeof toast === 'function') toast('Proyek tidak ditemukan', false);
      return { ok: false, message: 'Proyek tidak ditemukan' };
    }

    // Cek apakah sudah ada WBS
    const existing = DB.project_wbs.filter(w => w.project_id === projectId);
    if (existing.length > 0 && !options.force){
      if (typeof toast === 'function') toast('Proyek sudah punya WBS. Hapus dulu atau gunakan mode force.', false);
      return { ok: false, message: 'WBS sudah ada', count: existing.length };
    }

    if (typeof Undo !== 'undefined') Undo.snapshot('Generate WBS Template');

    // Hapus WBS lama jika force
    if (options.force){
      DB.project_wbs = DB.project_wbs.filter(w => w.project_id !== projectId);
    }

    // Map kode → id untuk lookup parent
    const kodeToId = {};
    let urut = 1;

    // Sort by kode (natural sort: 1 < 1.1 < 1.1.1 < 1.2 < 2)
    const sorted = this.SDA_TEMPLATE.slice().sort((a, b) => {
      const pa = String(a[0]).split('.').map(Number);
      const pb = String(b[0]).split('.').map(Number);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++){
        const va = pa[i] || 0;
        const vb = pb[i] || 0;
        if (va !== vb) return va - vb;
      }
      return 0;
    });

    let added = 0;
    sorted.forEach(([kode, uraian, satuan, level, parentKode]) => {
      const id = (typeof uid === 'function') ? uid('wbs') : 'wbs_' + Date.now() + Math.random();
      const isGroup = (level === 1 || level === 2) ? 1 : 0;
      const parentId = parentKode ? (kodeToId[parentKode] || '') : '';

      DB.project_wbs.push({
        id: id,
        project_id: projectId,
        kode_wbs: kode,
        uraian: uraian,
        sta: '-',
        satuan: satuan || '',
        volume_rab: 0,
        volume_rap: 0,
        ahsp_id: '',
        parent_id: parentId,
        is_group: isGroup,
        urut: urut++,
        wbs_level: level,
        predecessor: '',
        pred_type: 'FS',
        lag_days: 0,
        duration: 1
      });

      kodeToId[kode] = id;
      added++;
    });

    // Save & recalculate
    if (typeof saveDB === 'function') saveDB();
    if (typeof runCPM === 'function') runCPM(projectId);

    return {
      ok: true,
      message: 'WBS berhasil digenerate: ' + added + ' item',
      count: added,
      level1: sorted.filter(x => x[3] === 1).length,
      level2: sorted.filter(x => x[3] === 2).length,
      level3: sorted.filter(x => x[3] === 3).length
    };
  },

  /* ═══════════════════════════════════════════════════════════
     UI: Buka modal konfirmasi generate
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

    const body = `
      <div style="padding:12px 14px;background:linear-gradient(135deg,rgba(168,85,247,.08),rgba(124,58,237,.04));border-left:3px solid #a855f7;border-radius:6px;margin-bottom:14px;font-size:12.5px;line-height:1.6">
        <b>WBS Template Proyek SDA</b><br>
        Template ini akan men-generate <b>3 tingkat hierarki</b>:
        <ul style="margin:8px 0 0 18px;padding:0">
          <li><b>Level 1</b> — Fase Siklus Proyek (5 item)</li>
          <li><b>Level 2</b> — Blok Kerja Disiplin (16 item)</li>
          <li><b>Level 3</b> — Pekerjaan Teknis Lapangan (48 item)</li>
        </ul>
        <div style="margin-top:10px;padding-top:10px;border-top:1px dashed rgba(168,85,247,.3)">
          <b>Total: 69 item WBS</b> · Volume & AHSP dikosongkan (isi manual atau via Import BQ)
        </div>
      </div>

      ${hasExisting ? `
        <div style="padding:12px 14px;background:rgba(239,68,68,.08);border-left:3px solid #ef4444;border-radius:6px;margin-bottom:14px;font-size:12px;line-height:1.6">
          <b style="color:#f87171">⚠ Proyek ini sudah memiliki ${existing.length} item WBS.</b><br>
          Jika Anda lanjutkan, WBS lama akan <b>DIHAPUS</b> dan diganti dengan template baru.
        </div>
      ` : ''}

      <p style="font-size:12px;color:var(--muted);line-height:1.6">
        Setelah generate, Anda bisa:<br>
        • Mengisi Volume RAB/RAP di tab WBS/BQ<br>
        • Mapping AHSP per item Level 3<br>
        • Set predecessor & duration di Master Schedule
      </p>
    `;

    if (typeof openModal === 'function'){
      openModal('📐 Generate WBS Template SDA', body, () => {
        const result = WbsTemplate.generate(projectId, { force: true });
        if (result.ok){
          if (typeof toast === 'function') toast('✅ ' + result.message);
          if (typeof closeModal === 'function') closeModal();
          if (typeof renderWbs === 'function') renderWbs();
        } else {
          if (typeof toast === 'function') toast('⚠ ' + result.message, false);
        }
      });
    }
  }
};
