/* =====================================================================
   AHSP MASTER — Database Master AHSP PUPR SDA + HSD
   Standar: Permen PUPR No. 8/2023 & Analisa Harga Satuan Pekerjaan
   ===================================================================== */

const AhspMaster = {

  /* ═══════════════════════════════════════════════════════════
     HARGA SATUAN DASAR (HSD) — Sesuai Standar PUPR SDA 2024
     Update harga di sini untuk mengubah semua perhitungan AHSP
     ═══════════════════════════════════════════════════════════ */
  HSD: {
    // ─── UPAH ───
    upah: {
      'L.01': { kode: 'L.01', nama: 'Pekerja',              satuan: 'OH', harga: 95000  },
      'L.02': { kode: 'L.02', nama: 'Tukang Batu',          satuan: 'OH', harga: 135000 },
      'L.03': { kode: 'L.03', nama: 'Tukang Besi',          satuan: 'OH', harga: 140000 },
      'L.04': { kode: 'L.04', nama: 'Tukang Kayu',          satuan: 'OH', harga: 135000 },
      'L.05': { kode: 'L.05', nama: 'Mandor',               satuan: 'OH', harga: 165000 },
      'L.06': { kode: 'L.06', nama: 'Operator Alat Berat',  satuan: 'OH', harga: 185000 },
      'L.07': { kode: 'L.07', nama: 'Pembantu Operator',    satuan: 'OH', harga: 110000 }
    },

    // ─── BAHAN ───
    bahan: {
      'M.01': { kode: 'M.01', nama: 'Semen Portland (PC)',       satuan: 'kg',  harga: 1450    },
      'M.02': { kode: 'M.02', nama: 'Pasir Beton',               satuan: 'm³',  harga: 295000  },
      'M.03': { kode: 'M.03', nama: 'Pasir Pasang',              satuan: 'm³',  harga: 285000  },
      'M.04': { kode: 'M.04', nama: 'Kerikil / Split 2-3 cm',    satuan: 'm³',  harga: 385000  },
      'M.05': { kode: 'M.05', nama: 'Batu Belah 15/20 cm',       satuan: 'm³',  harga: 310000  },
      'M.06': { kode: 'M.06', nama: 'Besi Beton Ulir D13',       satuan: 'kg',  harga: 13800   },
      'M.07': { kode: 'M.07', nama: 'Besi Beton Polos D8',       satuan: 'kg',  harga: 12500   },
      'M.08': { kode: 'M.08', nama: 'Kayu Perancah / Bekisting', satuan: 'm³',  harga: 2450000 },
      'M.09': { kode: 'M.09', nama: 'Multiplex 12 mm',           satuan: 'lbr', harga: 195000  },
      'M.10': { kode: 'M.10', nama: 'Paku Campuran',             satuan: 'kg',  harga: 22000   },
      'M.11': { kode: 'M.11', nama: 'Air Kerja',                 satuan: 'liter', harga: 25    },
      'M.12': { kode: 'M.12', nama: 'Bata Merah',                satuan: 'bh',  harga: 850     },
      'M.13': { kode: 'M.13', nama: 'Aspal AC-WC',               satuan: 'ton', harga: 1250000 },
      'M.14': { kode: 'M.14', nama: 'Agregat Kelas A',           satuan: 'm³',  harga: 425000  }
    },

    // ─── ALAT ───
    alat: {
      'E.01': { kode: 'E.01', nama: 'Excavator PC-200 (0,8 m³)',  satuan: 'jam', harga: 485000 },
      'E.02': { kode: 'E.02', nama: 'Bulldozer D6 (Komatsu)',     satuan: 'jam', harga: 520000 },
      'E.03': { kode: 'E.03', nama: 'Dump Truck 8 m³',            satuan: 'jam', harga: 395000 },
      'E.04': { kode: 'E.04', nama: 'Vibratory Roller 8-10 Ton',  satuan: 'jam', harga: 420000 },
      'E.05': { kode: 'E.05', nama: 'Concrete Mixer 0,4 m³',      satuan: 'jam', harga: 185000 },
      'E.06': { kode: 'E.06', nama: 'Pompa Air 4 inch',           satuan: 'jam', harga: 145000 },
      'E.07': { kode: 'E.07', nama: 'Water Tanker 5000 L',        satuan: 'jam', harga: 285000 },
      'E.08': { kode: 'E.08', nama: 'Concrete Vibrator',          satuan: 'jam', harga: 125000 }
    }
  },

  /* ═══════════════════════════════════════════════════════════
     MASTER AHSP PUPR SDA — Sesuai Permen PUPR No. 8/2023
     Format setiap item:
       kode, nama, satuan, kategori, overhead (%),
       komponen: [{ resource_kode, koefisien, keterangan }]
     ═══════════════════════════════════════════════════════════ */
  MASTER_AHSP: [
    // ═══ PEKERJAAN TANAH ═══
    {
      kode: '1.1.1', nama: 'Galian Tanah Biasa (Manual + Alat)', satuan: 'm³',
      kategori: 'Pekerjaan Tanah', overhead: 10,
      komponen: [
        { resource_kode: 'E.01', koefisien: 0,     keterangan: 'Koef otomatis dari Q alat' },
        { resource_kode: 'L.01', koefisien: 0.35,  keterangan: 'Finishing manual' },
        { resource_kode: 'L.05', koefisien: 0.035, keterangan: 'Pengawasan' }
      ]
    },
    {
      kode: '1.1.2', nama: 'Timbunan / Pemadatan Tanah', satuan: 'm³',
      kategori: 'Pekerjaan Tanah', overhead: 10,
      komponen: [
        { resource_kode: 'E.02', koefisien: 0,     keterangan: 'Koef otomatis dari Q alat' },
        { resource_kode: 'E.04', koefisien: 0,     keterangan: 'Koef otomatis dari Q alat' },
        { resource_kode: 'E.03', koefisien: 0,     keterangan: 'Koef otomatis dari Q alat' },
        { resource_kode: 'L.01', koefisien: 0.20,  keterangan: 'Perataan manual' },
        { resource_kode: 'L.05', koefisien: 0.02,  keterangan: 'Pengawasan' },
        { resource_kode: 'M.11', koefisien: 120,   keterangan: 'Penyiraman' }
      ]
    },

    // ═══ PEKERJAAN BETON ═══
    {
      kode: '1.2.1', nama: 'Beton Struktur K-225', satuan: 'm³',
      kategori: 'Pekerjaan Beton', overhead: 12,
      komponen: [
        { resource_kode: 'M.01', koefisien: 371,   keterangan: 'Komposisi 1 m³' },
        { resource_kode: 'M.02', koefisien: 0.52,  keterangan: 'Komposisi' },
        { resource_kode: 'M.04', koefisien: 0.78,  keterangan: 'Komposisi' },
        { resource_kode: 'M.11', koefisien: 215,   keterangan: 'FAS 0,58' },
        { resource_kode: 'E.05', koefisien: 0,     keterangan: 'Koef otomatis dari Q alat' },
        { resource_kode: 'L.01', koefisien: 1.30,  keterangan: 'Penuangan' },
        { resource_kode: 'L.02', koefisien: 0.35,  keterangan: 'Finishing' },
        { resource_kode: 'L.05', koefisien: 0.06,  keterangan: 'Pengawasan' }
      ]
    },
    {
      kode: '1.2.2', nama: 'Pembesian Beton Bertulang', satuan: 'kg',
      kategori: 'Pekerjaan Beton', overhead: 11,
      komponen: [
        { resource_kode: 'M.06', koefisien: 1.05,  keterangan: 'Termasuk waste 5%' },
        { resource_kode: 'L.03', koefisien: 0.025, keterangan: 'Perakitan' },
        { resource_kode: 'L.01', koefisien: 0.015, keterangan: 'Bantu angkat' },
        { resource_kode: 'L.05', koefisien: 0.003, keterangan: 'Pengawasan' }
      ]
    },

    // ═══ PEKERJAAN PASANGAN ═══
    {
      kode: '1.3.1', nama: 'Pasangan Batu Belah 1:4', satuan: 'm³',
      kategori: 'Pekerjaan Pasangan', overhead: 10,
      komponen: [
        { resource_kode: 'M.05', koefisien: 1.20,  keterangan: 'Volume termasuk siar' },
        { resource_kode: 'M.01', koefisien: 163,   keterangan: 'Mortar 1:4' },
        { resource_kode: 'M.03', koefisien: 0.43,  keterangan: 'Mortar 1:4' },
        { resource_kode: 'M.11', koefisien: 90,    keterangan: 'Air kerja' },
        { resource_kode: 'L.02', koefisien: 1.20,  keterangan: 'Pemasangan' },
        { resource_kode: 'L.01', koefisien: 2.40,  keterangan: 'Angkut & bantu' },
        { resource_kode: 'L.05', koefisien: 0.12,  keterangan: 'Pengawasan' }
      ]
    },

    // ═══ PEKERJAAN BEKISTING ═══
    {
      kode: '1.4.1', nama: 'Bekisting / Perancah', satuan: 'm²',
      kategori: 'Pekerjaan Bekisting', overhead: 10,
      komponen: [
        { resource_kode: 'M.08', koefisien: 0.045, keterangan: 'Kayu + paku' },
        { resource_kode: 'M.09', koefisien: 0.35,  keterangan: 'Multiplex' },
        { resource_kode: 'L.04', koefisien: 0.35,  keterangan: 'Pasang & bongkar' },
        { resource_kode: 'L.01', koefisien: 0.50,  keterangan: 'Bantu' },
        { resource_kode: 'L.05', koefisien: 0.035, keterangan: 'Pengawasan' }
      ]
    },

    // ═══ PEKERJAAN PERSIAPAN ═══
    {
      kode: '1.5.1', nama: 'Dewatering / Pompa Air', satuan: 'jam',
      kategori: 'Pekerjaan Persiapan', overhead: 8,
      komponen: [
        { resource_kode: 'E.06', koefisien: 1.00,  keterangan: 'Sewa per jam' },
        { resource_kode: 'L.06', koefisien: 0.12,  keterangan: 'Operator' },
        { resource_kode: 'L.07', koefisien: 0.12,  keterangan: 'Pembantu' }
      ]
    }
  ],

  /* ═══════════════════════════════════════════════════════════
     PUBLIC API — Getter & Search
     ═══════════════════════════════════════════════════════════ */
  getAll(){
    return this.MASTER_AHSP.slice();
  },

  getByKode(kode){
    return this.MASTER_AHSP.find(a => a.kode === kode) || null;
  },

  search(query){
    if (!query) return this.MASTER_AHSP.slice();
    const q = String(query).toLowerCase();
    return this.MASTER_AHSP.filter(a =>
      a.kode.toLowerCase().includes(q) ||
      a.nama.toLowerCase().includes(q) ||
      a.kategori.toLowerCase().includes(q)
    );
  },

  getKategoriList(){
    const set = new Set();
    this.MASTER_AHSP.forEach(a => set.add(a.kategori));
    return Array.from(set).sort();
  },

  /* ═══════════════════════════════════════════════════════════
     HITUNG HSP (Harga Satuan Pekerjaan) dari AHSP × HSD
     Formula: HSP = (Σ koef × harga) × (1 + overhead%)
     ═══════════════════════════════════════════════════════════ */
  hitungHSP(ahspKode){
    const ahsp = this.getByKode(ahspKode);
    if (!ahsp) return 0;

    let base = 0;
    ahsp.komponen.forEach(k => {
      const hsd = this._findHSD(k.resource_kode);
      if (!hsd) return;
      base += (k.koefisien || 0) * hsd.harga;
    });

    const oh = num(ahsp.overhead);
    return base * (1 + oh / 100);
  },

  _findHSD(resourceKode){
    if (this.HSD.upah[resourceKode])  return this.HSD.upah[resourceKode];
    if (this.HSD.bahan[resourceKode]) return this.HSD.bahan[resourceKode];
    if (this.HSD.alat[resourceKode])  return this.HSD.alat[resourceKode];
    return null;
  },

  getHSD(resourceKode){
    return this._findHSD(resourceKode);
  },

  /* ═══════════════════════════════════════════════════════════
     LOAD TO PROJECT — Copy AHSP dari master ke proyek aktif
     ═══════════════════════════════════════════════════════════ */
  loadToProject(projectId, ahspKode){
    if (!projectId || !ahspKode) return { ok: false, message: 'Parameter kurang' };

    const ahsp = this.getByKode(ahspKode);
    if (!ahsp) return { ok: false, message: 'AHSP tidak ditemukan' };

    // Cek apakah sudah ada
    const existing = DB.ahsp_headers.find(a =>
      a.project_id === projectId && a.kode === ahspKode
    );
    if (existing){
      return { ok: false, message: 'AHSP sudah ada di proyek ini', id: existing.id };
    }

    if (typeof Undo !== 'undefined') Undo.snapshot('Load AHSP: ' + ahspKode);

    // Insert ke DB.ahsp_headers
    const ahspId = (typeof uid === 'function') ? uid('ahsp') : 'ahsp_' + Date.now();
    DB.ahsp_headers.push({
      id: ahspId,
      project_id: projectId,
      kode: ahsp.kode,
      nama: ahsp.nama,
      satuan: ahsp.satuan,
      kategori: ahsp.kategori,
      overhead: ahsp.overhead,
      sumber: 'Permen PUPR SDA 2023',
      is_master: 0
    });

    // Insert komponen ke DB.project_ahsp_details
    ahsp.komponen.forEach(k => {
      const hsd = this._findHSD(k.resource_kode);
      if (!hsd) return;

      // Cari resource_id berdasarkan kode
      let resourceId = '';
      const existingRes = DB.master_resources.find(r => r.kode === k.resource_kode);
      if (existingRes){
        resourceId = existingRes.id;
      } else {
        // Auto-create resource
        const newId = (typeof uid === 'function') ? uid('res') : 'res_' + Date.now() + Math.random();
        DB.master_resources.push({
          id: newId,
          kode: hsd.kode,
          nama: hsd.nama,
          jenis: this._jenisOf(hsd.kode),
          satuan: hsd.satuan,
          harga_rab: hsd.harga,
          harga_rap: hsd.harga,
          kapasitas_harian: 0
        });
        resourceId = newId;
      }

      DB.project_ahsp_details.push({
        id: (typeof uid === 'function') ? uid('pad') : 'pad_' + Date.now(),
        project_id: projectId,
        ahsp_id: ahspId,
        resource_id: resourceId,
        koefisien_master: k.koefisien,
        koefisien_rap: null,
        harga_rab: hsd.harga,
        harga_rap: hsd.harga,
        keterangan: k.keterangan || ''
      });
    });

    if (typeof saveDB === 'function') saveDB();

    return { ok: true, id: ahspId, message: 'AHSP loaded: ' + ahspKode };
  },

  _jenisOf(kode){
    if (kode.startsWith('L.')) return 'upah';
    if (kode.startsWith('M.')) return 'bahan';
    if (kode.startsWith('E.')) return 'alat';
    return 'bahan';
  },

  /* ═══════════════════════════════════════════════════════════
     UI: Modal Picker AHSP (hidden — hanya muncul saat klik "+ AHSP")
     ═══════════════════════════════════════════════════════════ */
  openPicker(projectId, onSelect){
    projectId = projectId || STATE.activeProject;
    if (!projectId){
      if (typeof toast === 'function') toast('Pilih proyek dulu', false);
      return;
    }

    const kategoris = this.getKategoriList();

    const body = `
      <div class="ahsp-picker-intro">
        Pilih AHSP standar PUPR SDA. Data di-load dari <b>MASTER_AHSP_PUPR_SDA</b> (back-end).
      </div>

      <div class="ahsp-picker-filter">
        <input type="text" id="ahspPickerSearch" placeholder="🔍 Cari kode / nama AHSP..." />
        <select id="ahspPickerKategori">
          <option value="">Semua Kategori</option>
          ${kategoris.map(k => `<option value="${esc(k)}">${esc(k)}</option>`).join('')}
        </select>
      </div>

      <div class="ahsp-picker-list" id="ahspPickerList">
        <!-- diisi oleh JS -->
      </div>
    `;

    if (typeof openModal === 'function'){
      openModal('📚 Pilih AHSP Master PUPR SDA', body, () => { return false; });
    }

    const submitBtn = document.getElementById('mSubmit');
    if (submitBtn) submitBtn.style.display = 'none';

    const renderList = (query, kategori) => {
      let list = query ? this.search(query) : this.getAll();
      if (kategori) list = list.filter(a => a.kategori === kategori);

      const wrap = document.getElementById('ahspPickerList');
      if (!wrap) return;

      if (!list.length){
        wrap.innerHTML = '<div class="empty">Tidak ada AHSP yang cocok.</div>';
        return;
      }

      wrap.innerHTML = list.map(a => {
        const hsp = this.hitungHSP(a.kode);
        return `
          <div class="ahsp-picker-item" data-kode="${esc(a.kode)}">
            <div class="ahsp-pi-head">
              <span class="ahsp-pi-kode">${esc(a.kode)}</span>
              <span class="ahsp-pi-nama">${esc(a.nama)}</span>
              <span class="ahsp-pi-satuan">${esc(a.satuan)}</span>
            </div>
            <div class="ahsp-pi-meta">
              <span class="ahsp-pi-kat">${esc(a.kategori)}</span>
              <span class="ahsp-pi-komponen">${a.komponen.length} komponen</span>
              <span class="ahsp-pi-hsp">HSP: ${rp(hsp)} / ${esc(a.satuan)}</span>
            </div>
          </div>
        `;
      }).join('');

      // Wire klik
      wrap.querySelectorAll('.ahsp-picker-item').forEach(item => {
        item.onclick = () => {
          const kode = item.getAttribute('data-kode');
          const result = AhspMaster.loadToProject(projectId, kode);
          if (result.ok){
            if (typeof toast === 'function') toast('✅ ' + result.message);
            if (typeof closeModal === 'function') closeModal();
            if (typeof renderAhspTab === 'function') renderAhspTab();
            if (typeof onSelect === 'function') onSelect(result);
          } else {
            if (typeof toast === 'function') toast('⚠ ' + result.message, false);
          }
        };
      });
    };

    setTimeout(() => {
      renderList('', '');
      const searchInput = document.getElementById('ahspPickerSearch');
      const katSelect = document.getElementById('ahspPickerKategori');
      if (searchInput) searchInput.oninput = () => renderList(searchInput.value, katSelect.value);
      if (katSelect) katSelect.onchange = () => renderList(searchInput.value, katSelect.value);
    }, 50);
  }
};

window.AhspMaster = AhspMaster;
console.log('%c[AhspMaster.js] ✅ Master AHSP PUPR SDA loaded (9 AHSP standard)',
  'color:#0891b2;font-weight:bold;font-size:12px');
