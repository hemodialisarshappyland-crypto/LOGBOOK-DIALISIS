import {
  NurseScheduleEntry,
  DoctorScheduleEntry,
  MasterNurse,
  MasterDoctor,
  ShiftName
} from '../types/dialysis.ts';
import { getCurrentIsoDateWib } from '../utils/dateHelpers.ts';
import { sampleBenchmarkNurses, initialMasterDoctors } from './mockMasterData.ts';
import {
  generateMonthlyNurseRoster,
  generateMonthlyDoctorRoster,
  parseYearMonthFromIso
} from '../utils/monthlyScheduleMatrixHelpers.ts';

/**
 * Generate standard benchmark nurse schedules for a specified ISO date (YYYY-MM-DD).
 * Standard RS Happy Land Hemodialysis Roster:
 * - 1 Kepala Ruang: TWIS FERTILIANTI PW (Pagi / Supervisi)
 * - Shift Pagi: PJ M HAIKAL MALILANG, 6 Pelaksana (RIZKY, DEA, BRILLI, SISWANTINI, RENI, HARI ENDAH)
 * - Shift Siang: PJ APRILLIA DWI N, 6 Pelaksana (AYU W, FRANSISCA RANI, NITA, RINI, YUMIATI, AYU PUSPITA)
 * - Off / Cadangan: M NOR KHOIRUDIN (PJ Off), NOVIALITA ARYADI (PJ Off)
 */
export function generateBenchmarkNurseSchedules(dateIso: string): NurseScheduleEntry[] {
  return [
    // 1. Kepala Ruang
    {
      id: `nsch-${dateIso}-01`,
      nurseId: 'nurse-hdhl-01',
      nurseName: 'TWIS FERTILIANTI PW',
      date: dateIso,
      shift: 'Pagi',
      isPjShift: false,
      notes: 'Supervisi Klinis & Manajerial Unit HD'
    },
    // 2. PJ Shift Pagi
    {
      id: `nsch-${dateIso}-02`,
      nurseId: 'nurse-hdhl-02',
      nurseName: 'M HAIKAL MALILANG',
      date: dateIso,
      shift: 'Pagi',
      isPjShift: true,
      notes: 'PJ Shift Pagi (Penanggung Jawab Operasional)'
    },
    // 3. PJ Shift Siang Cadangan / Off
    {
      id: `nsch-${dateIso}-03`,
      nurseId: 'nurse-hdhl-03',
      nurseName: 'M NOR KHOIRUDIN',
      date: dateIso,
      shift: 'Libur',
      isPjShift: false,
      notes: 'Off Dinas Rutin'
    },
    // 4. PJ Shift Siang
    {
      id: `nsch-${dateIso}-04`,
      nurseId: 'nurse-hdhl-04',
      nurseName: 'APRILLIA DWI N',
      date: dateIso,
      shift: 'Siang',
      isPjShift: true,
      notes: 'PJ Shift Siang (Penanggung Jawab Operasional)'
    },
    // 5. PJ Shift Pagi Cadangan / Off
    {
      id: `nsch-${dateIso}-05`,
      nurseId: 'nurse-hdhl-05',
      nurseName: 'NOVIALITA ARYADI',
      date: dateIso,
      shift: 'Libur',
      isPjShift: false,
      notes: 'Off Dinas Rutin'
    },
    // 6-11. Pelaksana Shift Pagi (6 Perawat)
    {
      id: `nsch-${dateIso}-06`,
      nurseId: 'nurse-hdhl-06',
      nurseName: 'RIZKY WAHYU A',
      date: dateIso,
      shift: 'Pagi',
      isPjShift: false,
      notes: 'Bed A01 - A04 (Zonasi Reguler)'
    },
    {
      id: `nsch-${dateIso}-07`,
      nurseId: 'nurse-hdhl-07',
      nurseName: 'DEA IKA P',
      date: dateIso,
      shift: 'Pagi',
      isPjShift: false,
      notes: 'Bed A05 - A08 (Zonasi Reguler)'
    },
    {
      id: `nsch-${dateIso}-08`,
      nurseId: 'nurse-hdhl-08',
      nurseName: 'Y BRILLISANTO',
      date: dateIso,
      shift: 'Pagi',
      isPjShift: false,
      notes: 'Bed A09 - A12 (Zonasi Reguler)'
    },
    {
      id: `nsch-${dateIso}-09`,
      nurseId: 'nurse-hdhl-09',
      nurseName: 'SISWANTINI CATUR P',
      date: dateIso,
      shift: 'Pagi',
      isPjShift: false,
      notes: 'Bed B01 - B04 (Zonasi Reguler)'
    },
    {
      id: `nsch-${dateIso}-10`,
      nurseId: 'nurse-hdhl-10',
      nurseName: 'RENI DWI A',
      date: dateIso,
      shift: 'Pagi',
      isPjShift: false,
      notes: 'Bed B05 - B09 (Zonasi Reguler)'
    },
    {
      id: `nsch-${dateIso}-11`,
      nurseId: 'nurse-hdhl-11',
      nurseName: 'HARI ENDAH C',
      date: dateIso,
      shift: 'Pagi',
      isPjShift: false,
      notes: 'Bed Isolasi Hep B & Hep C (ISO 01-04)'
    },
    // 12-17. Pelaksana Shift Siang (6 Perawat)
    {
      id: `nsch-${dateIso}-12`,
      nurseId: 'nurse-hdhl-12',
      nurseName: 'AYU WULANDARI',
      date: dateIso,
      shift: 'Siang',
      isPjShift: false,
      notes: 'Bed A01 - A04 (Zonasi Reguler)'
    },
    {
      id: `nsch-${dateIso}-13`,
      nurseId: 'nurse-hdhl-13',
      nurseName: 'FRANSISCA RANI L',
      date: dateIso,
      shift: 'Siang',
      isPjShift: false,
      notes: 'Bed A05 - A08 (Zonasi Reguler)'
    },
    {
      id: `nsch-${dateIso}-14`,
      nurseId: 'nurse-hdhl-14',
      nurseName: 'NITA RESTIANA P',
      date: dateIso,
      shift: 'Siang',
      isPjShift: false,
      notes: 'Bed A09 - A12 (Zonasi Reguler)'
    },
    {
      id: `nsch-${dateIso}-15`,
      nurseId: 'nurse-hdhl-15',
      nurseName: 'RINI WULANDARI',
      date: dateIso,
      shift: 'Siang',
      isPjShift: false,
      notes: 'Bed B01 - B04 (Zonasi Reguler)'
    },
    {
      id: `nsch-${dateIso}-16`,
      nurseId: 'nurse-hdhl-16',
      nurseName: 'YUMIATI',
      date: dateIso,
      shift: 'Siang',
      isPjShift: false,
      notes: 'Bed B05 - B09 (Zonasi Reguler)'
    },
    {
      id: `nsch-${dateIso}-17`,
      nurseId: 'nurse-hdhl-17',
      nurseName: 'AYU PUSPITA',
      date: dateIso,
      shift: 'Siang',
      isPjShift: false,
      notes: 'Bed Isolasi Hep B & Hep C (ISO 01-04)'
    }
  ];
}

/**
 * Generate standard benchmark doctor schedules for a specified ISO date (YYYY-MM-DD).
 * Standard RS Happy Land Hemodialysis Roster:
 * - 3 Dokter DPJP (Pagi: dr. Heru Prasanto; Siang: dr. Muntaqinah; On-Call: dr. Alfany Fajar)
 * - 10 Dokter Ruangan (Pagi: dr. Addiniya & dr. Agnes; Siang: dr. Clara & dr. I Gede; On-Call: dr. Krishna & dr. Paramitha; Off/Libur: dr. Raden Alif, dr. Reza Rizki, dr. Talitha, dr. Tika)
 */
export function generateBenchmarkDoctorSchedules(dateIso: string): DoctorScheduleEntry[] {
  return [
    // 3 Dokter DPJP
    {
      id: `dsch-${dateIso}-01`,
      doctorId: 'doc-heru-prasanto',
      doctorName: 'dr. RADEN HERU PRASANTO, Sp.PD-KGH',
      date: dateIso,
      shift: 'Pagi',
      role: 'dpjp',
      spesialisasi: 'Spesialis Penyakit Dalam - Konsultan Ginjal Hipertensi (Sp.PD-KGH)',
      phone: '0812-3456-7890',
      notes: 'DPJP Utama Shift Pagi (Visite & Preskripsi)'
    },
    {
      id: `dsch-${dateIso}-02`,
      doctorId: 'doc-muntaqinah',
      doctorName: 'dr. MUNTAQINAH, MSC, Sp.PD',
      date: dateIso,
      shift: 'Siang',
      role: 'dpjp',
      spesialisasi: 'Spesialis Penyakit Dalam (Sp.PD, M.Sc)',
      phone: '0812-3456-7891',
      notes: 'DPJP Konsulen Shift Siang (Visite & Evaluasi HD)'
    },
    {
      id: `dsch-${dateIso}-03`,
      doctorId: 'doc-alfany-fajar',
      doctorName: 'dr. ALFANY FAJAR ILMAWAN, Sp.PD',
      date: dateIso,
      shift: 'On-Call',
      role: 'dpjp',
      spesialisasi: 'Spesialis Penyakit Dalam (Sp.PD)',
      phone: '0812-3456-7892',
      notes: 'DPJP Konsulen On-Call / Komplikasi Khusus'
    },

    // 10 Dokter Ruangan Hemodialisis
    {
      id: `dsch-${dateIso}-04`,
      doctorId: 'doc-addiniya-burhan',
      doctorName: 'dr. Addiniya Nurul Azmi Burhan',
      date: dateIso,
      shift: 'Pagi',
      role: 'dokter_jaga',
      spesialisasi: 'Dokter Ruangan Hemodialisis',
      phone: '0813-1122-3301',
      notes: 'Dokter Ruangan Standby Shift Pagi'
    },
    {
      id: `dsch-${dateIso}-05`,
      doctorId: 'doc-agnes-sandewa',
      doctorName: 'dr. Agnes Treyssia Sandewa',
      date: dateIso,
      shift: 'Pagi',
      role: 'dokter_jaga',
      spesialisasi: 'Dokter Ruangan Hemodialisis',
      phone: '0813-1122-3302',
      notes: 'Dokter Ruangan Standby Shift Pagi'
    },
    {
      id: `dsch-${dateIso}-06`,
      doctorId: 'doc-clara-wahyudi',
      doctorName: 'dr. Clara Silviana Wahyudi',
      date: dateIso,
      shift: 'Siang',
      role: 'dokter_jaga',
      spesialisasi: 'Dokter Ruangan Hemodialisis',
      phone: '0813-1122-3303',
      notes: 'Dokter Ruangan Standby Shift Siang'
    },
    {
      id: `dsch-${dateIso}-07`,
      doctorId: 'doc-gede-permana',
      doctorName: 'dr. I Gede Surya Permana',
      date: dateIso,
      shift: 'Siang',
      role: 'dokter_jaga',
      spesialisasi: 'Dokter Ruangan Hemodialisis',
      phone: '0813-1122-3304',
      notes: 'Dokter Ruangan Standby Shift Siang'
    },
    {
      id: `dsch-${dateIso}-08`,
      doctorId: 'doc-krishna-arimurti',
      doctorName: 'dr. Krishna Patria Arimurti',
      date: dateIso,
      shift: 'On-Call',
      role: 'dokter_jaga',
      spesialisasi: 'Dokter Ruangan Hemodialisis',
      phone: '0813-1122-3305',
      notes: 'Dokter Ruangan Cadangan / On-Call'
    },
    {
      id: `dsch-${dateIso}-09`,
      doctorId: 'doc-paramitha-kusumadewi',
      doctorName: 'dr. Paramitha Kusumadewi',
      date: dateIso,
      shift: 'On-Call',
      role: 'dokter_jaga',
      spesialisasi: 'Dokter Ruangan Hemodialisis',
      phone: '0813-1122-3306',
      notes: 'Dokter Ruangan Cadangan / On-Call'
    },
    {
      id: `dsch-${dateIso}-10`,
      doctorId: 'doc-raden-alif',
      doctorName: 'dr. Raden Alif Kuncorojati',
      date: dateIso,
      shift: 'Libur',
      role: 'dokter_jaga',
      spesialisasi: 'Dokter Ruangan Hemodialisis',
      phone: '0813-1122-3307',
      notes: 'Off Dinas Rutin'
    },
    {
      id: `dsch-${dateIso}-11`,
      doctorId: 'doc-reza-ramadhan',
      doctorName: 'dr. Reza Rizki Ramadhan',
      date: dateIso,
      shift: 'Libur',
      role: 'dokter_jaga',
      spesialisasi: 'Dokter Ruangan Hemodialisis',
      phone: '0813-1122-3308',
      notes: 'Off Dinas Rutin'
    },
    {
      id: `dsch-${dateIso}-12`,
      doctorId: 'doc-talitha-islamey',
      doctorName: 'dr. Talitha Ambar Islamey',
      date: dateIso,
      shift: 'Libur',
      role: 'dokter_jaga',
      spesialisasi: 'Dokter Ruangan Hemodialisis',
      phone: '0813-1122-3309',
      notes: 'Off Dinas Rutin'
    },
    {
      id: `dsch-${dateIso}-13`,
      doctorId: 'doc-tika-heryasari',
      doctorName: 'dr. Tika Heryasari',
      date: dateIso,
      shift: 'Libur',
      role: 'dokter_jaga',
      spesialisasi: 'Dokter Ruangan Hemodialisis',
      phone: '0813-1122-3310',
      notes: 'Off Dinas Rutin'
    }
  ];
}

const todayIso = getCurrentIsoDateWib();
const activeYearMonth = parseYearMonthFromIso(todayIso);

function buildInitialMonthlyNurseSchedules(): NurseScheduleEntry[] {
  const monthly = generateMonthlyNurseRoster(
    activeYearMonth.year,
    activeYearMonth.month,
    sampleBenchmarkNurses
  );
  const todayBenchmark = generateBenchmarkNurseSchedules(todayIso);
  const otherDays = monthly.filter((s) => s.date !== todayIso);
  return [...otherDays, ...todayBenchmark];
}

export const initialNurseSchedules: NurseScheduleEntry[] = buildInitialMonthlyNurseSchedules();

// Matriks Jadwal Dokter dimulai bersih/kosong (tanpa shift bawaan) agar pengguna dapat menginputkan sendiri
export const initialDoctorSchedules: DoctorScheduleEntry[] = [];

/**
 * Returns existing doctor schedules without forcing synthetic benchmarks,
 * preserving user's manual schedule inputs.
 */
export function ensureAllOfficialDoctorSchedules(
  existingSchedules: DoctorScheduleEntry[],
  _dateIso?: string
): DoctorScheduleEntry[] {
  if (!Array.isArray(existingSchedules)) {
    return [];
  }
  return existingSchedules;
}
