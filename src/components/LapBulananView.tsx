import React, { useState, useMemo, useEffect } from 'react';
import {
  MasterNurse,
  PatientHDSession,
  ShiftInfo,
  SystemAccessRole
} from '../types/dialysis.ts';
import { OFFICIAL_LOGBOOK_ITEMS } from '../data/officialPelaksanaLogbookData.ts';
import { OfficialPelaksanaLogbookPrintable } from './OfficialPelaksanaLogbookPrintable.tsx';
import { LoginUserData } from './LoginPage.tsx';
import {
  buildStaffMonthlyRecap,
  buildAllStaffMonthlyRecap,
  parseIndonesianLogbookDate,
  getMonthLabel,
  UnitMonthlyRecapOverview
} from '../utils/monthlyRecapHelpers.ts';
import {
  getCurrentIndonesianFullDate,
  normalizeIndonesianDateLabel
} from '../utils/dateHelpers.ts';
import { isMatchingNurse } from '../utils/nurseVerificationHelpers.ts';
import { canVerifyLogbook } from '../utils/masterDataHelpers.ts';
import { printDocumentWithOrientation, downloadElementAsPdf } from '../utils/printHelpers.ts';
import {
  Table,
  Printer,
  FileDown,
  Calendar,
  Award,
  UserCheck,
  Users,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Activity,
  Filter,
  RefreshCw,
  FileText,
  FileSpreadsheet
} from 'lucide-react';
import { exportMasterHemodialisaWorkbook } from '../utils/exportMasterSpreadsheet.ts';
import type { NurseLogbookCloudData } from '../services/firebase.ts';

interface LapBulananViewProps {
  masterNurses?: MasterNurse[];
  loggedInUser?: LoginUserData | null;
  shiftInfo?: ShiftInfo;
  userRole?: SystemAccessRole;
  sessions?: PatientHDSession[];
  cloudNurseLogbooks?: NurseLogbookCloudData[];
  onNavigateToLogbook?: () => void;
  onNavigateToVerifikasi?: () => void;
}

const BAGIAN_SECTION_HEADERS: {
  bagian: number;
  title: string;
  ruleBadge: string;
}[] = [
  {
    bagian: 1,
    title: 'BAGIAN I: KESIAPAN FASILITAS RUANGAN & WATER TREATMENT (RO)',
    ruleBadge: 'Nilai = 1 (1x Aktivitas / Hari)'
  },
  {
    bagian: 2,
    title: 'BAGIAN II: PERSIAPAN PERAWAT, PERALATAN, MESIN HD & ALKES (PRE-HD)',
    ruleBadge: 'Nilai Mengikuti Pasien Kelolaan'
  },
  {
    bagian: 3,
    title: 'BAGIAN III: IDENTIFIKASI PASIEN, PENGKAJIAN PRE-HD & PATIENT SAFETY',
    ruleBadge: 'Pasien Kelolaan (Poin 3.6 Sesuai Perawat Pelaksana Aksesing)'
  },
  {
    bagian: 4,
    title: 'BAGIAN IV: MONITORING INTRA-HD & PENCEGAHAN IKP',
    ruleBadge: 'Nilai Mengikuti Pasien Kelolaan'
  },
  {
    bagian: 5,
    title: 'BAGIAN V: EDUKASI TERSTRUKTUR PASIEN & KELUARGA (KIE)',
    ruleBadge: 'Nilai Mengikuti Pasien Kelolaan'
  },
  {
    bagian: 6,
    title: 'BAGIAN VI: TERMINASI AMAN, EVALUASI POST-HD, DISINFEKSI & CPPT',
    ruleBadge: 'Nilai Mengikuti Pasien Kelolaan'
  }
];

const INDONESIAN_MONTH_OPTIONS = [
  { value: 1, label: 'Januari' },
  { value: 2, label: 'Februari' },
  { value: 3, label: 'Maret' },
  { value: 4, label: 'April' },
  { value: 5, label: 'Mei' },
  { value: 6, label: 'Juni' },
  { value: 7, label: 'Juli' },
  { value: 8, label: 'Agustus' },
  { value: 9, label: 'September' },
  { value: 10, label: 'Oktober' },
  { value: 11, label: 'November' },
  { value: 12, label: 'Desember' }
];

const ALL_STAFF_KEY = 'ALL_STAFF';

export const LapBulananView: React.FC<LapBulananViewProps> = ({
  masterNurses = [],
  loggedInUser,
  shiftInfo,
  userRole = 'perawat_pelaksana',
  sessions = [],
  cloudNurseLogbooks = [],
  onNavigateToLogbook,
  onNavigateToVerifikasi
}) => {
  // Listen to live verification and storage updates to re-render in real-time
  const [refreshTick, setRefreshTick] = useState<number>(0);
  useEffect(() => {
    const handleUpdate = () => setRefreshTick((t) => t + 1);
    window.addEventListener('verification_registry_updated', handleUpdate);
    window.addEventListener('storage', handleUpdate);
    return () => {
      window.removeEventListener('verification_registry_updated', handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, []);

  const activeDateLabel = shiftInfo?.date
    ? normalizeIndonesianDateLabel(shiftInfo.date)
    : getCurrentIndonesianFullDate();

  const activeParsedDate = useMemo(
    () => parseIndonesianLogbookDate(activeDateLabel),
    [activeDateLabel]
  );

  // Month & Year state filterable by user
  const [selectedMonth, setSelectedMonth] = useState<number>(() => activeParsedDate.month);
  const [selectedYear, setSelectedYear] = useState<number>(() => activeParsedDate.year);

  const isPelaksana = userRole === 'perawat_pelaksana';
  const canViewOtherNurses =
    userRole === 'pj_shift' || userRole === 'kepala_ruangan' || userRole === 'administrator';

  // Filter active registered staff members
  const activeNurses = useMemo(() => {
    return masterNurses.filter((n) => n.accountStatus !== 'nonaktif');
  }, [masterNurses]);

  // Identify the logged-in nurse's own name
  const loggedInNurse = useMemo(() => {
    if (!loggedInUser?.name) return null;
    return activeNurses.find((n) => isMatchingNurse(n.name, loggedInUser.name)) || null;
  }, [activeNurses, loggedInUser?.name]);

  const personalStaffName =
    loggedInNurse?.name || loggedInUser?.name || activeNurses[0]?.name || 'Perawat Pelaksana';

  // Initial staff selection:
  // - Perawat Pelaksana: STRICTLY locked to their own name
  // - PJ Shift / Kepala Ruangan / Admin: defaults to ALL_STAFF (Unit Overview)
  const [selectedStaff, setSelectedStaff] = useState<string>(() => {
    if (isPelaksana) {
      return personalStaffName;
    }
    return ALL_STAFF_KEY;
  });

  // Guard: if user is Perawat Pelaksana, force selectedStaff to stay locked on their own name
  useEffect(() => {
    if (isPelaksana && selectedStaff !== personalStaffName) {
      setSelectedStaff(personalStaffName);
    }
  }, [isPelaksana, personalStaffName, selectedStaff]);

  const effectiveSelectedStaff = isPelaksana ? personalStaffName : selectedStaff;

  const [viewMode, setViewMode] = useState<'matrix' | 'print'>('matrix');

  const daysArray = Array.from({ length: 31 }, (_, i) => i + 1);
  const currentMonthLabel = getMonthLabel(selectedMonth);
  const currentMonthYearTitle = `${currentMonthLabel} ${selectedYear}`;

  // Compute Unit All-Staff Recap only for supervisor / admin roles
  const unitRecap: UnitMonthlyRecapOverview = useMemo(() => {
    if (isPelaksana) {
      return {
        month: selectedMonth,
        year: selectedYear,
        monthYear: currentMonthYearTitle,
        totalActiveNurses: 0,
        totalVerifiedDutyDays: 0,
        totalVerifiedPatientsUnit: 0,
        unitOverallCompliancePct: 0,
        staffSummaries: []
      };
    }
    return buildAllStaffMonthlyRecap({
      masterNurses: activeNurses,
      shiftInfo,
      sessions,
      cloudNurseLogbooks,
      targetMonth: selectedMonth,
      targetYear: selectedYear
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPelaksana, activeNurses, shiftInfo, sessions, cloudNurseLogbooks, selectedMonth, selectedYear, currentMonthYearTitle, refreshTick]);

  // Find the selected individual nurse (locked to personal nurse if Pelaksana)
  const activeNurseObject = useMemo(() => {
    if (!isPelaksana && effectiveSelectedStaff === ALL_STAFF_KEY) return null;
    const targetName = isPelaksana ? personalStaffName : effectiveSelectedStaff;
    const found = activeNurses.find((n) => isMatchingNurse(n.name, targetName));
    if (found) return found;
    if (isPelaksana && loggedInUser?.name) {
      return {
        id: 'nurse-logged-in',
        name: loggedInUser.name,
        nip: loggedInUser.nip || '-',
        role: 'perawat_pelaksana',
        systemAccess: 'perawat_pelaksana',
        accountStatus: 'aktif'
      } as MasterNurse;
    }
    return null;
  }, [isPelaksana, effectiveSelectedStaff, personalStaffName, activeNurses, loggedInUser]);

  // Compute individual staff recap for selected nurse
  const currentRecap = useMemo(() => {
    if (!activeNurseObject) return null;
    return buildStaffMonthlyRecap({
      nurseName: activeNurseObject.name,
      nurseNip: activeNurseObject.nip || '-',
      userRole: activeNurseObject.systemAccess || 'perawat_pelaksana',
      shiftInfo,
      sessions,
      masterNurses,
      cloudNurseLogbooks,
      targetMonth: selectedMonth,
      targetYear: selectedYear
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNurseObject, shiftInfo, sessions, masterNurses, cloudNurseLogbooks, selectedMonth, selectedYear, refreshTick]);

  const isCurrentMonthActive =
    selectedMonth === activeParsedDate.month && selectedYear === activeParsedDate.year;

  const handleResetToCurrentMonth = () => {
    setSelectedMonth(activeParsedDate.month);
    setSelectedYear(activeParsedDate.year);
  };

  const [isExportingPdf, setIsExportingPdf] = useState(false);

  // FUNGSI CETAK: Langsung membuka dialog cetak browser
  const handlePrint = () => {
    const isIndiv = isPelaksana || effectiveSelectedStaff !== ALL_STAFF_KEY;
    const docTitle = isIndiv
      ? `Logbook_Bulanan_${activeNurseObject?.name || 'Perawat'}_${currentMonthYearTitle}`
      : `Rekapitulasi_Bulanan_Unit_HD_${currentMonthYearTitle}`;

    // If viewing an individual nurse (or Perawat Pelaksana), switch to print mode and trigger landscape print
    if (viewMode !== 'print' && isIndiv) {
      setViewMode('print');
      setTimeout(() => {
        printDocumentWithOrientation(true, docTitle); // true = Landscape for 31-day table
      }, 180);
      return;
    }
    // If already in print mode or viewing unit recap overview, trigger landscape print
    printDocumentWithOrientation(true, docTitle);
  };

  // FUNGSI SIMPAN PDF: Langsung mendownload file PDF ke komputer / HP
  const handleDownloadPdf = async () => {
    const isIndiv = isPelaksana || effectiveSelectedStaff !== ALL_STAFF_KEY;
    const docTitle = isIndiv
      ? `Logbook_Bulanan_${activeNurseObject?.name || 'Perawat'}_${currentMonthYearTitle}`
      : `Rekapitulasi_Bulanan_Unit_HD_${currentMonthYearTitle}`;

    setIsExportingPdf(true);
    try {
      if (isIndiv && viewMode !== 'print') {
        setViewMode('print');
        setTimeout(async () => {
          try {
            await downloadElementAsPdf('printable-official-logbook', {
              filename: docTitle,
              isLandscape: true
            });
          } finally {
            setIsExportingPdf(false);
          }
        }, 220);
        return;
      }

      const targetId = isIndiv ? 'printable-official-logbook' : 'printable-unit-recap';
      await downloadElementAsPdf(targetId, {
        filename: docTitle,
        isLandscape: true
      });
    } catch (err) {
      console.error('Download PDF error:', err);
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleExportMasterSpreadsheet = () => {
    exportMasterHemodialisaWorkbook({
      shiftInfo: shiftInfo || {
        hospitalName: 'RS Happy Land Medical Centre',
        unitName: 'Instalasi Dialisis',
        date: getCurrentIndonesianFullDate(),
        shift: 'Pagi',
        shiftHours: '07.00 - 14.00 WIB',
        pjShift: 'M. Haikal Malilang, A.Md. Kep.',
        dokterDpjp: 'dr. Raden Heru Prasanto, Sp.PD-KGH',
        kepalaRuangan: 'Twis Fertilianti PW., S.Kep., Ns.',
        dokterJaga: 'dr. Paramitha',
        totalPerawatDinas: 8,
        detailPerawat: '8 Orang (1 PJ Shift + 7 Perawat Pelaksana)',
        perawatRatio: '1 : 3',
        tenagaPendukung: '1 Teknisi Elektromedis/RO, 1 HK Ruangan',
        pjShiftBerikutnya: 'Aprillia Dwi N, S.Kep., Ns.'
      },
      sessions: sessions || [],
      masterNurses: masterNurses || [],
      cloudNurseLogbooks: cloudNurseLogbooks || [],
      targetMonth: selectedMonth,
      targetYear: selectedYear
    });
  };

  return (
    <div className="space-y-4">
      {/* ===================================================================== */}
      {/* 1. HEADER CARD & INTEGRATED CONTROL BAR                               */}
      {/* ===================================================================== */}
      <div className="bg-white/95 rounded-2xl border border-slate-200/90 p-4 sm:p-5 shadow-xs flex flex-col gap-4">
        {/* Top Row: Title, Subtitle, & Primary Actions */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-500">
              <span className="text-[#164e78] font-bold uppercase tracking-wider">
                Laporan Bulanan Hemodialisis
              </span>
              <span aria-hidden="true" className="text-slate-300">&middot;</span>
              <span>Terstandar KARS &amp; PERNEFRI</span>
              <span aria-hidden="true" className="text-slate-300">&middot;</span>
              <span className="truncate">{shiftInfo?.hospitalName || 'RS Happy Land Medical Centre'}</span>
            </div>
            
            <h2 className="text-lg sm:text-xl xl:text-[22px] font-black text-slate-950 tracking-tight flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-blue-50 text-[#164e78] flex items-center justify-center shrink-0 border border-blue-100">
                <Calendar className="w-4 h-4" />
              </div>
              <span className="truncate">
                REKAPITULASI LOGBOOK BULANAN
              </span>
              <span className="hidden sm:inline-block text-xs font-bold px-2 py-0.5 rounded-md bg-blue-50 text-[#164e78] border border-blue-200/70 font-mono">
                {currentMonthYearTitle}
              </span>
            </h2>

            <p className="text-xs text-slate-600 leading-relaxed max-w-4xl">
              {isPelaksana
                ? 'Menampilkan matriks rekapitulasi nilai harian SPO asuhan hemodialisis pribadi Anda yang telah disahkan oleh PJ Shift atau Kepala Ruang.'
                : 'Menampilkan data logbook SPO asuhan hemodialisis seluruh staf yang telah disahkan oleh PJ Shift atau Kepala Ruang (Akses Supervisi Staf).'}{' '}
              &middot; Tanggal Dinas Aktif:{' '}
              <strong className="text-[#164e78] tabular-nums font-semibold">{activeDateLabel}</strong>.
            </p>
          </div>

          {/* Action Toolbar: View Switcher, PDF Export, and Master Excel */}
          <div className="flex flex-wrap items-center gap-2 self-start lg:self-center shrink-0">
            {/* View Switcher Segmented Control */}
            <div className="inline-flex items-center bg-slate-100/90 p-1 rounded-xl border border-slate-200/80 shrink-0">
              <button
                type="button"
                onClick={() => setViewMode('matrix')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                  viewMode === 'matrix'
                    ? 'bg-white text-[#164e78] shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Table className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {isPelaksana
                    ? 'Matriks 1–31 Hari'
                    : effectiveSelectedStaff === ALL_STAFF_KEY
                    ? 'Rekap Unit HD'
                    : 'Matriks 1–31 Hari'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('print')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                  viewMode === 'print'
                    ? 'bg-[#164e78] text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Printer className="w-3.5 h-3.5 shrink-0" />
                <span>Format Cetak A4</span>
              </button>
            </div>

            {/* Tombol Cetak (Langsung Buka Dialog Print) */}
            <button
              type="button"
              onClick={handlePrint}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#164e78] hover:bg-[#103b5b] active:scale-[0.99] text-white text-xs font-bold transition-all cursor-pointer shadow-xs whitespace-nowrap shrink-0"
              title="Cetak langsung dokumen ke printer atau dialog cetak"
            >
              <Printer className="w-3.5 h-3.5 shrink-0" />
              <span>Cetak</span>
            </button>

            {/* Tombol Simpan PDF (Langsung Unduh File PDF) */}
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={isExportingPdf}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-700 hover:bg-rose-800 disabled:opacity-50 active:scale-[0.99] text-white text-xs font-bold transition-all cursor-pointer shadow-xs whitespace-nowrap shrink-0"
              title="Download dokumen Rekapitulasi Bulanan langsung sebagai file .pdf"
            >
              <FileDown className="w-3.5 h-3.5 shrink-0" />
              <span>{isExportingPdf ? 'Mengunduh PDF...' : 'Simpan PDF'}</span>
            </button>

            {/* Tombol Master Spreadsheet */}
            <button
              type="button"
              onClick={handleExportMasterSpreadsheet}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-700 hover:bg-emerald-800 active:scale-[0.99] text-white text-xs font-bold transition-all cursor-pointer shadow-xs whitespace-nowrap shrink-0"
              title="Unduh 1 File Master Excel (.xlsx) komprehensif berisi seluruh Laporan Pasien, Laporan PJ Shift, dan Rekapitulasi Bulanan Perawat"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />
              <span>Master Excel (.xlsx)</span>
            </button>
          </div>
        </div>

        {/* Bottom Row: Staff Selector & Period Filter Bar */}
        <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3 bg-slate-50/80 rounded-xl p-3 border border-slate-200/70">
          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            {/* Staff Selector */}
            {isPelaksana ? (
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5 shrink-0">
                  <UserCheck className="w-3.5 h-3.5 text-[#164e78]" />
                  <span>Staf Logbook:</span>
                </span>
                <div className="bg-white border border-blue-200 text-slate-900 font-bold text-xs rounded-lg px-3 py-1.5 flex items-center gap-2 shadow-2xs">
                  <span className="text-[#164e78] font-bold">{personalStaffName}</span>
                  <span className="text-[10.5px] font-semibold text-blue-700 bg-blue-50/80 px-2 py-0.5 rounded border border-blue-200/60">
                    Akun Mandiri
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 min-w-[280px] flex-1 sm:flex-initial">
                <label htmlFor="select-staff" className="text-xs font-bold text-slate-700 flex items-center gap-1.5 shrink-0">
                  <UserCheck className="w-3.5 h-3.5 text-[#164e78]" />
                  <span>Pilih Staf:</span>
                </label>
                <select
                  id="select-staff"
                  value={selectedStaff}
                  onChange={(e) => {
                    setSelectedStaff(e.target.value);
                    setViewMode('matrix');
                  }}
                  className="bg-white border border-slate-300 text-slate-900 font-semibold text-xs rounded-lg px-3 py-1.5 focus:ring-2 focus:ring-[#164e78]/30 focus:border-[#164e78] focus:outline-hidden w-full cursor-pointer shadow-2xs transition-all"
                >
                  <option value={ALL_STAFF_KEY}>
                    📊 Rekapitulasi Seluruh Staf (Unit Hemodialisis)
                  </option>
                  <optgroup label="─── DAFTAR PERAWAT PELAKSANA &amp; PJ SHIFT ───">
                    {activeNurses.map((nurse) => {
                      const nurseRecap = unitRecap.staffSummaries.find((s) => s.nurseName === nurse.name);
                      const verifiedDays = nurseRecap?.verifiedDaysCount || 0;
                      const verifiedPats = nurseRecap?.totalVerifiedPatients || 0;
                      const roleTag =
                        nurse.role === 'kepala_ruangan'
                          ? '[Ka. Ruangan]'
                          : nurse.role === 'pj_shift'
                          ? '[PJ Shift]'
                          : '[Pelaksana]';
                      return (
                        <option key={nurse.id} value={nurse.name}>
                          {roleTag} {nurse.name} — ({verifiedDays} Hari | {verifiedPats} Pasien)
                        </option>
                      );
                    })}
                  </optgroup>
                </select>
              </div>
            )}

            {/* Quick Switch Button if supervisor is viewing an individual nurse */}
            {!isPelaksana && selectedStaff !== ALL_STAFF_KEY && (
              <button
                type="button"
                onClick={() => setSelectedStaff(ALL_STAFF_KEY)}
                className="text-xs font-bold text-[#164e78] hover:text-[#0e3553] bg-blue-50/80 hover:bg-blue-100/80 border border-blue-200/80 px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer shrink-0"
              >
                <Users className="w-3.5 h-3.5" />
                <span>Lihat Semua Staf</span>
              </button>
            )}
          </div>

          {/* Month & Year Filter */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 bg-white border border-slate-300 rounded-lg px-2.5 py-1 shadow-2xs">
              <Filter className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <select
                aria-label="Pilih Bulan Rekapitulasi"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(Number(e.target.value))}
                className="text-xs font-bold text-slate-800 bg-transparent border-none py-0.5 px-1 focus:ring-0 focus:outline-hidden cursor-pointer"
              >
                {INDONESIAN_MONTH_OPTIONS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
              <span className="text-slate-300">/</span>
              <select
                aria-label="Pilih Tahun Rekapitulasi"
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                className="text-xs font-bold text-slate-800 bg-transparent border-none py-0.5 px-1 focus:ring-0 focus:outline-hidden cursor-pointer"
              >
                <option value={2025}>2025</option>
                <option value={2026}>2026</option>
                <option value={2027}>2027</option>
              </select>
            </div>

            {!isCurrentMonthActive && (
              <button
                type="button"
                onClick={handleResetToCurrentMonth}
                title="Kembali ke bulan berjalan saat ini"
                className="text-xs font-semibold text-slate-700 hover:text-[#164e78] bg-white hover:bg-slate-50 border border-slate-300 px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Bulan Ini</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ===================================================================== */}
      {/* 2. VIEW 1: REKAPITULASI SELURUH STAF (UNIT OVERVIEW)                   */}
      {/* ===================================================================== */}
      {!isPelaksana && effectiveSelectedStaff === ALL_STAFF_KEY && (
        <div className="space-y-4">
          {/* Unit KPI Metric Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 tabular-nums">
            <div className="bg-white p-4 rounded-xl border border-slate-200/90 flex items-center justify-between gap-3 shadow-xs transition-all hover:border-slate-300">
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Total Tenaga Perawat
                </div>
                <div className="text-xl sm:text-2xl font-black text-slate-900 mt-1 font-mono">
                  {unitRecap.totalActiveNurses} <span className="text-xs font-semibold text-slate-500 font-sans">Orang</span>
                </div>
                <div className="text-[11px] text-slate-500 truncate mt-0.5">
                  Unit Dialisis &middot; Terjadwal
                </div>
              </div>
              <div className="w-11 h-11 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center shrink-0 border border-indigo-100">
                <Users className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200/90 flex items-center justify-between gap-3 shadow-xs transition-all hover:border-slate-300">
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Hari Dinas Disahkan
                </div>
                <div className="text-xl sm:text-2xl font-black text-slate-900 mt-1 font-mono">
                  {unitRecap.totalVerifiedDutyDays} <span className="text-xs font-semibold text-slate-500 font-sans">Hari Kerja</span>
                </div>
                <div className="text-[11px] text-[#164e78] font-semibold truncate mt-0.5">
                  Periode {unitRecap.monthYear}
                </div>
              </div>
              <div className="w-11 h-11 rounded-xl bg-blue-50 text-[#164e78] flex items-center justify-center shrink-0 border border-blue-100">
                <Calendar className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200/90 flex items-center justify-between gap-3 shadow-xs transition-all hover:border-slate-300">
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Pasien HD Terverifikasi
                </div>
                <div className="text-xl sm:text-2xl font-black text-slate-900 mt-1 font-mono">
                  {unitRecap.totalVerifiedPatientsUnit} <span className="text-xs font-semibold text-slate-500 font-sans">Pasien</span>
                </div>
                <div className="text-[11px] text-emerald-700 font-semibold truncate mt-0.5">
                  Disahkan PJ Shift &amp; KaRu
                </div>
              </div>
              <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 border border-emerald-100">
                <CheckCircle2 className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200/90 flex items-center justify-between gap-3 shadow-xs transition-all hover:border-slate-300">
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Kepatuhan SPO Unit HD
                </div>
                <div className="text-xl sm:text-2xl font-black text-emerald-800 mt-1 font-mono">
                  {unitRecap.unitOverallCompliancePct}%
                </div>
                <div className="text-[11px] text-slate-500 truncate mt-0.5">
                  Standar Akreditasi KARS
                </div>
              </div>
              <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 border border-emerald-100">
                <Award className="w-5 h-5" />
              </div>
            </div>
          </div>

          {/* Unit Staff Table Container */}
          <div
            id="printable-unit-recap"
            className="printable-sheet bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden print:border-none print:shadow-none print:rounded-none"
          >
            {/* Dedicated Official Print Header (Visible only on print/PDF) */}
            <div className="hidden print:block text-center border-b-2 border-slate-900 pb-2 mb-3">
              <div className="text-[11px] font-bold tracking-wider text-slate-700 uppercase">
                {shiftInfo?.hospitalName || 'RS HAPPY LAND MEDICAL CENTRE'} &bull; UNIT PELAYANAN HEMODIALISIS
              </div>
              <h1 className="text-[14px] font-black tracking-tight text-slate-950 uppercase mt-0.5">
                REKAPITULASI BULANAN CAPAIAN LOGBOOK ASUHAN KEPERAWATAN HEMODIALISIS
              </h1>
              <div className="text-[9.5px] text-slate-600 mt-0.5">
                Periode: <strong>{unitRecap.monthYear}</strong> &bull; Total {unitRecap.totalActiveNurses} Tenaga Perawat &bull; {unitRecap.totalVerifiedPatientsUnit} Pasien Disahkan &bull; Rata-rata Kepatuhan: {unitRecap.unitOverallCompliancePct}% &bull; Standar Akreditasi KARS &amp; PERNEFRI
              </div>
            </div>

            {/* Table Header Bar */}
            <div className="px-5 py-4 bg-slate-50/90 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-3 print:hidden">
              <div>
                <h3 className="text-sm font-bold text-slate-950 flex items-center gap-2">
                  <Activity className="w-4 h-4 text-[#164e78]" />
                  <span>Daftar Rekapitulasi Capaian Logbook Seluruh Perawat ({unitRecap.monthYear})</span>
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Akumulasi nilai SPO otomatis terhitung dari logbook harian perawat pelaksana yang telah disahkan oleh PJ Shift atau Kepala Ruang.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handlePrint}
                  className="px-3.5 py-1.5 bg-[#164e78] hover:bg-[#103b5b] text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-xs whitespace-nowrap"
                  title="Cetak Rekapitulasi Unit langsung"
                >
                  <Printer className="w-3.5 h-3.5 shrink-0" />
                  <span>Cetak</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadPdf}
                  disabled={isExportingPdf}
                  className="px-3.5 py-1.5 bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-xs whitespace-nowrap"
                  title="Download file PDF Rekapitulasi Unit"
                >
                  <FileDown className="w-3.5 h-3.5 shrink-0" />
                  <span>{isExportingPdf ? 'Mengunduh...' : 'Simpan PDF'}</span>
                </button>
                {canVerifyLogbook(userRole) && onNavigateToVerifikasi && (
                  <button
                    type="button"
                    onClick={onNavigateToVerifikasi}
                    className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200/80 rounded-xl text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Buka Verifikasi Logbook</span>
                  </button>
                )}
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto scrollbar-thin">
              <table className="w-full text-left text-xs border-collapse print:text-[8px] print:leading-tight">
                <thead>
                  <tr className="bg-[#164e78] text-white font-bold text-center text-[11px] uppercase tracking-wider">
                    <th className="p-3 border-r border-[#1e5d8e] w-12 text-center">NO</th>
                    <th className="p-3 border-r border-[#1e5d8e] text-left min-w-[210px]">NAMA PERAWAT &amp; NIP</th>
                    <th className="p-3 border-r border-[#1e5d8e] w-36 text-center">JABATAN</th>
                    <th className="p-3 border-r border-[#1e5d8e] w-28 text-center">HARI DISAHKAN</th>
                    <th className="p-3 border-r border-[#1e5d8e] w-32 text-center">PASIEN KELOLAAN</th>
                    <th className="p-3 border-r border-[#1e5d8e] w-28 text-center">AKSESING (3.6)</th>
                    <th className="p-3 border-r border-[#1e5d8e] w-32 text-center">NILAI SPO / MAKS</th>
                    <th className="p-3 border-r border-[#1e5d8e] w-28 text-center">% CAPAIAN</th>
                    <th className="p-3 border-r border-[#1e5d8e] w-44 text-left">STATUS &amp; VERIFIKATOR</th>
                    <th className="p-3 w-32 text-center print:hidden">AKSI</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-slate-800">
                  {unitRecap.staffSummaries.map((staff, idx) => {
                    const hasVerified = staff.verifiedDaysCount > 0 || staff.totalVerifiedPatients > 0;
                    return (
                      <tr
                        key={staff.nurseId || idx}
                        className={idx % 2 === 1 ? 'bg-slate-50/60 hover:bg-blue-50/50 transition-colors' : 'bg-white hover:bg-blue-50/50 transition-colors'}
                      >
                        <td className="p-3 text-center font-mono text-slate-500 font-semibold border-r border-slate-200">
                          {idx + 1}
                        </td>
                        <td className="p-3 border-r border-slate-200">
                          <div className="font-bold text-slate-950 text-xs">{staff.nurseName}</div>
                          <div className="text-[11px] text-slate-500 font-mono mt-0.5">NIP: {staff.nurseNip}</div>
                        </td>
                        <td className="p-3 text-center border-r border-slate-200">
                          <span
                            className={`inline-block px-2.5 py-0.5 rounded-md text-[10.5px] font-bold ${
                              staff.role === 'kepala_ruangan'
                                ? 'bg-amber-50 text-amber-900 border border-amber-200'
                                : staff.role === 'pj_shift'
                                ? 'bg-indigo-50 text-indigo-900 border border-indigo-200'
                                : 'bg-blue-50 text-blue-900 border border-blue-200'
                            }`}
                          >
                            {staff.role === 'kepala_ruangan'
                              ? 'Kepala Ruangan'
                              : staff.role === 'pj_shift'
                              ? 'PJ Shift'
                              : 'Perawat Pelaksana'}
                          </span>
                        </td>
                        <td className="p-3 text-center font-mono font-bold text-slate-900 border-r border-slate-200">
                          {hasVerified ? (
                            <span className="text-[#164e78] bg-blue-50/80 px-2 py-0.5 rounded-md font-black">
                              {staff.verifiedDaysCount} Hari
                            </span>
                          ) : (
                            <span className="text-slate-400 font-normal">0 Hari</span>
                          )}
                        </td>
                        <td className="p-3 text-center font-mono font-bold text-slate-900 border-r border-slate-200">
                          {hasVerified ? (
                            <span className="text-emerald-800 bg-emerald-50/80 px-2 py-0.5 rounded-md font-black">
                              {staff.totalVerifiedPatients} Pasien
                            </span>
                          ) : (
                            <span className="text-slate-400 font-normal">0 Pasien</span>
                          )}
                        </td>
                        <td className="p-3 text-center font-mono text-slate-700 border-r border-slate-200">
                          {staff.poin3_6VascularCount > 0 ? (
                            <span className="text-indigo-800 font-bold">{staff.poin3_6VascularCount}x Akses</span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                        <td className="p-3 text-center font-mono border-r border-slate-200">
                          {hasVerified ? (
                            <span className="text-slate-900 font-bold">
                              {staff.grandTotalScore} / {staff.grandMaxScore}
                            </span>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                        <td className="p-3 text-center font-mono font-bold border-r border-slate-200">
                          {hasVerified ? (
                            <span
                              className={`px-2.5 py-0.5 rounded-md text-[11px] font-black ${
                                staff.overallCompliancePct >= 90
                                  ? 'bg-emerald-100/80 text-emerald-900'
                                  : staff.overallCompliancePct >= 75
                                  ? 'bg-amber-100/80 text-amber-900'
                                  : 'bg-rose-100/80 text-rose-900'
                              }`}
                            >
                              {staff.overallCompliancePct}%
                            </span>
                          ) : (
                            <span className="text-slate-400 font-normal">-</span>
                          )}
                        </td>
                        <td className="p-3 text-left border-r border-slate-200 text-[11px]">
                          {hasVerified ? (
                            <div>
                              <div className="font-bold text-emerald-700 flex items-center gap-1">
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                <span>Disahkan</span>
                              </div>
                              <div className="text-slate-500 text-[10.5px] truncate mt-0.5" title={staff.lastVerifiedBy}>
                                Oleh: {staff.lastVerifiedBy || 'PJ Shift'}
                              </div>
                            </div>
                          ) : (
                            <div className="text-slate-400 italic text-[11px]">Belum Ada Pengesahan</div>
                          )}
                        </td>
                        <td className="p-3 text-center print:hidden">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedStaff(staff.nurseName);
                              setViewMode('matrix');
                            }}
                            className="px-3 py-1.5 bg-[#164e78] hover:bg-[#103b5b] text-white rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1.5 w-full cursor-pointer shadow-2xs"
                          >
                            <span>Buka Matriks</span>
                            <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Official Verification Signatures Block (Visible on print/PDF) */}
            <div className="hidden print:grid grid-cols-2 gap-8 text-center text-[10px] mt-6 pt-4 border-t border-slate-300">
              <div>
                <p className="text-slate-600">Mengetahui &amp; Memverifikasi,</p>
                <p className="font-bold text-slate-900">Penanggung Jawab Shift HD</p>
                <div className="h-12 flex items-end justify-center font-mono text-[9px] text-slate-700">
                  ✓ Terverifikasi Digital
                </div>
                <p className="font-extrabold underline text-slate-950 mt-1">
                  {shiftInfo?.pjShift || 'M. Haikal Malilang, A.Md. Kep.'}
                </p>
                <p className="text-[9px] text-slate-500">PJ Shift Unit Hemodialisis</p>
              </div>
              <div>
                <p className="text-slate-600">Mengesahkan,</p>
                <p className="font-bold text-slate-900">Kepala Ruangan Hemodialisis</p>
                <div className="h-12 flex items-end justify-center font-mono text-[9px] text-slate-700">
                  ✓ Disahkan Ka. Ruangan
                </div>
                <p className="font-extrabold underline text-slate-950 mt-1">
                  {shiftInfo?.kepalaRuangan || 'Twis Fertilianti PW., S.Kep., Ns.'}
                </p>
                <p className="text-[9px] text-slate-500">Kepala Ruangan Unit Hemodialisis</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* 3. VIEW 2: INDIVIDUAL STAFF RECAP (MATRIKS 1–31 ATAU FORMAT CETAK)    */}
      {/* ===================================================================== */}
      {(isPelaksana || effectiveSelectedStaff !== ALL_STAFF_KEY) && currentRecap && (
        <div className="space-y-4">
          {/* Individual Nurse KPI Metric Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5 tabular-nums">
            <div className="bg-white p-4 rounded-xl border border-slate-200/90 flex items-center justify-between gap-3 shadow-xs">
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  {isPelaksana ? 'Perawat Pelaksana' : 'Staf Terpilih'}
                </div>
                <div className="text-base sm:text-lg font-black text-slate-950 mt-1 truncate">
                  {currentRecap.logbook.nurseName}
                </div>
                <div className="text-[11.5px] text-slate-500 truncate mt-0.5">
                  {currentRecap.roleLabel} &middot; NIP: {currentRecap.logbook.nipNira}
                </div>
              </div>
              <div className="w-11 h-11 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center shrink-0 border border-indigo-100">
                <UserCheck className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200/90 flex items-center justify-between gap-3 shadow-xs">
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Hari Dinas Disahkan
                </div>
                <div className="text-xl sm:text-2xl font-black text-slate-900 mt-1 font-mono">
                  {currentRecap.verifiedDaysCount} <span className="text-xs font-semibold text-slate-500 font-sans">Hari</span>
                </div>
                <div className="text-[11.5px] text-[#164e78] font-semibold truncate mt-0.5">
                  Periode {currentRecap.logbook.monthYear}
                </div>
              </div>
              <div className="w-11 h-11 rounded-xl bg-blue-50 text-[#164e78] flex items-center justify-center shrink-0 border border-blue-100">
                <Calendar className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200/90 flex items-center justify-between gap-3 shadow-xs">
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Pasien Kelolaan Disahkan
                </div>
                <div className="text-xl sm:text-2xl font-black text-slate-900 mt-1 font-mono">
                  {currentRecap.totalVerifiedPatientsInMonth} <span className="text-xs font-semibold text-slate-500 font-sans">Pasien</span>
                </div>
                <div className="text-[11.5px] text-emerald-700 font-semibold truncate mt-0.5">
                  Disahkan PJ Shift &amp; KaRu
                </div>
              </div>
              <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 border border-emerald-100">
                <Users className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-white p-4 rounded-xl border border-slate-200/90 flex items-center justify-between gap-3 shadow-xs">
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Capaian Kepatuhan SPO
                </div>
                <div className="text-xl sm:text-2xl font-black text-emerald-800 mt-1 font-mono">
                  {currentRecap.overallCompliancePct}%
                </div>
                <div className="text-[11.5px] text-slate-500 font-mono truncate mt-0.5">
                  Nilai: {currentRecap.grandTotalScore} / {currentRecap.grandMaxScore}
                </div>
              </div>
              <div className="w-11 h-11 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0 border border-emerald-100">
                <Award className="w-5 h-5" />
              </div>
            </div>
          </div>

          {/* INFORMATIONAL EMPTY STATE IF NO VERIFIED DAYS IN THIS MONTH */}
          {currentRecap.verifiedDaysCount === 0 && (
            <div className="bg-white rounded-2xl border border-amber-200 bg-amber-50/40 p-5 shadow-xs space-y-3">
              <div className="flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0 mt-0.5 border border-amber-200">
                  <AlertCircle className="w-5 h-5" />
                </div>
                <div className="space-y-1.5 flex-1">
                  <h3 className="text-sm font-bold text-amber-950">
                    {isPelaksana
                      ? `Belum Ada Logbook Terverifikasi untuk Anda pada Periode ${currentMonthYearTitle}`
                      : `Belum Ada Logbook Terverifikasi untuk ${currentRecap.logbook.nurseName} pada Periode ${currentMonthYearTitle}`}
                  </h3>
                  <p className="text-xs text-amber-900/90 leading-relaxed">
                    {isPelaksana
                      ? 'Matriks rekapitulasi nilai harian Anda bersumber dari asuhan pasien dan checklist SPO harian yang telah disahkan oleh PJ Shift atau Kepala Ruangan.'
                      : 'Halaman Laporan Bulanan ini menampilkan nilai harian SPO yang bersumber dari asuhan hemodialisa perawat yang telah disahkan oleh PJ Shift atau Kepala Ruangan.'}
                  </p>
                  <div className="text-xs text-slate-700 space-y-1 pt-1.5">
                    <div className="font-bold text-slate-800">Alur Pengisian &amp; Verifikasi SPO:</div>
                    <ol className="list-decimal list-inside space-y-0.5 text-slate-600 pl-1">
                      <li>
                        Perawat pelaksana menginput pasien dan checklist asuhan (Bagian I–VI) di tab <strong>LOGBOOK</strong>, lalu klik <strong>Ajukan Verifikasi</strong>.
                      </li>
                      <li>
                        PJ Shift atau Kepala Ruang membuka tab <strong>VERIFIKASI</strong> untuk memeriksa dan mengesahkan logbook tersebut.
                      </li>
                      <li>
                        Setelah diverifikasi, tabel matriks 1–31 di bawah ini otomatis terisi dengan nilai SPO harian dan rekapitulasi capaian bulanan.
                      </li>
                    </ol>
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-amber-200/70">
                {!isPelaksana && (
                  <button
                    type="button"
                    onClick={() => setSelectedStaff(ALL_STAFF_KEY)}
                    className="px-3.5 py-1.5 bg-[#164e78] hover:bg-[#103b5b] text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <Users className="w-3.5 h-3.5" />
                    <span>Lihat Rekap Seluruh Staf Unit HD</span>
                  </button>
                )}

                {canVerifyLogbook(userRole) && onNavigateToVerifikasi && (
                  <button
                    type="button"
                    onClick={onNavigateToVerifikasi}
                    className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-xs"
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Buka Halaman Verifikasi Logbook</span>
                  </button>
                )}

                {onNavigateToLogbook && (
                  <button
                    type="button"
                    onClick={onNavigateToLogbook}
                    className="px-3.5 py-1.5 bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs"
                  >
                    <FileText className="w-3.5 h-3.5 text-slate-500" />
                    <span>Buka Logbook Pelaksana</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* VIEW SWITCHER CONTENT: PRINT vs MATRIX */}
          {viewMode === 'print' ? (
            <OfficialPelaksanaLogbookPrintable logbook={currentRecap.logbook} />
          ) : (
            <>
              {/* Sedia lembar cetak resmi untuk window.print() langsung dari tampilan matriks */}
              <div className="hidden print:block">
                <OfficialPelaksanaLogbookPrintable logbook={currentRecap.logbook} />
              </div>

              {/* Full Monthly Matrix 1-31 Table Container */}
              <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden print:hidden">
                {/* Table Header Bar */}
                <div className="px-5 py-3.5 bg-slate-50/90 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-950 flex items-center gap-2">
                      <Table className="w-4 h-4 text-[#164e78]" />
                      <span>Matriks Rekapitulasi Nilai Harian Tanggal 1 s/d 31 ({currentRecap.logbook.monthYear})</span>
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {isPelaksana ? (
                        <span>
                          Menampilkan nilai SPO harian pribadi Anda &middot; Angka pada kolom tanggal menunjukkan nilai capaian terverifikasi per poin SPO.
                        </span>
                      ) : (
                        <span>
                          Menampilkan nilai SPO perawat <strong>{currentRecap.logbook.nurseName}</strong> &middot; Angka pada kolom tanggal menunjukkan nilai capaian terverifikasi per poin SPO.
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setViewMode('print')}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300/80 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    >
                      <Table className="w-3.5 h-3.5 shrink-0 text-slate-500" />
                      <span>Format Cetak A4</span>
                    </button>
                    <button
                      type="button"
                      onClick={handlePrint}
                      className="px-3 py-1.5 bg-[#164e78] hover:bg-[#103b5b] text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap shadow-xs"
                      title="Buka dialog cetak browser langsung"
                    >
                      <Printer className="w-3.5 h-3.5 shrink-0" />
                      <span>Cetak</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadPdf}
                      disabled={isExportingPdf}
                      className="px-3 py-1.5 bg-rose-700 hover:bg-rose-800 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap shadow-xs"
                      title="Download file PDF logbook langsung"
                    >
                      <FileDown className="w-3.5 h-3.5 shrink-0" />
                      <span>{isExportingPdf ? 'Mengunduh...' : 'Simpan PDF'}</span>
                    </button>
                  </div>
                </div>

                {/* 31-Day Matrix Table with Precise Sticky Offsets */}
                <div className="overflow-x-auto max-h-[720px] relative scrollbar-thin">
                  <table className="w-full text-left text-xs border-collapse tabular-nums">
                    <thead className="sticky top-0 z-20 shadow-xs">
                      {/* Row 1 Header */}
                      <tr className="bg-[#164e78] text-white font-bold text-center text-[10.5px]">
                        <th
                          rowSpan={2}
                          className="p-2 border-r border-[#1e5d8e] w-[52px] min-w-[52px] max-w-[52px] sticky left-0 z-30 bg-[#164e78] text-center"
                        >
                          POIN
                        </th>
                        <th
                          rowSpan={2}
                          className="p-2 border-r border-[#1e5d8e] w-[130px] min-w-[130px] max-w-[130px] text-left sticky left-[52px] z-30 bg-[#164e78]"
                        >
                          FASE ASUHAN
                        </th>
                        <th
                          rowSpan={2}
                          className="p-2 border-r border-[#1e5d8e] min-w-[240px] text-left bg-[#164e78]"
                        >
                          URAIAN KEGIATAN SPESIFIK SPO
                        </th>
                        <th
                          colSpan={31}
                          className="p-1.5 border-b border-[#1e5d8e] text-[10px] uppercase font-bold tracking-wider bg-[#1a5b8c] text-white"
                        >
                          NILAI HARIAN TERVERIFIKASI — BULAN {currentRecap.logbook.monthYear.toUpperCase()}
                        </th>
                        <th rowSpan={2} className="p-2 border-l border-[#1e5d8e] w-[56px] min-w-[56px] text-center bg-[#164e78]">
                          TOTAL
                        </th>
                        <th rowSpan={2} className="p-2 border-l border-[#1e5d8e] w-[56px] min-w-[56px] text-center bg-[#164e78]">
                          MAKS
                        </th>
                        <th rowSpan={2} className="p-2 border-l border-[#1e5d8e] w-[56px] min-w-[56px] text-center bg-[#164e78]">
                          %
                        </th>
                      </tr>

                      {/* Row 2: Days 1 to 31 */}
                      <tr className="bg-[#1a5b8c] text-white font-bold text-[9.5px] text-center">
                        {daysArray.map((day, idx) => {
                          const isOutOfMonth = day > currentRecap.daysInMonth;
                          const isActiveDay = !isOutOfMonth && day === activeParsedDate.day && isCurrentMonthActive;
                          const isVerifiedDay = !isOutOfMonth && Boolean(currentRecap.logbook.verifiedDays?.[idx]);
                          return (
                            <th
                              key={day}
                              title={
                                isActiveDay
                                  ? `Hari / Tanggal Aktif: ${activeDateLabel}`
                                  : isOutOfMonth
                                  ? `Tidak ada tanggal ${day} pada periode ${currentRecap.logbook.monthYear}`
                                  : `Tanggal ${day} ${currentRecap.logbook.monthYear}`
                              }
                              className={`p-1 border-r border-[#226ca4] w-[28px] min-w-[28px] max-w-[28px] font-mono ${
                                isOutOfMonth
                                  ? 'bg-slate-900/60 text-slate-500'
                                  : isActiveDay
                                  ? 'bg-cyan-400 text-slate-950 font-black ring-2 ring-inset ring-white'
                                  : isVerifiedDay
                                  ? 'bg-[#246ea3] text-white'
                                  : 'text-slate-200'
                              }`}
                            >
                              {day}
                            </th>
                          );
                        })}
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-slate-200 text-[11px] text-slate-800">
                      {/* Reference Row: Number of Verified Managed Patients per Day */}
                      <tr className="bg-indigo-50/80 font-bold text-indigo-950 group">
                        <td
                          colSpan={2}
                          className="px-3 py-2 border-r border-slate-200 sticky left-0 bg-indigo-50/95 group-hover:bg-indigo-100 z-10 text-[10.5px] uppercase tracking-wider font-bold"
                        >
                          Pasien Terverifikasi
                        </td>
                        <td className="px-3 py-2 border-r border-slate-200 text-[10.5px] text-indigo-900">
                          Jumlah pasien kelolaan yang disahkan PJ Shift / Kepala Ruang
                        </td>
                        {daysArray.map((day, dayIdx) => {
                          const pCount = currentRecap.logbook.dailyVerifiedPatientCounts?.[dayIdx] || 0;
                          const isVerif = Boolean(currentRecap.logbook.verifiedDays?.[dayIdx]) && pCount > 0;
                          const isOutOfMonth = day > currentRecap.daysInMonth;
                          return (
                            <td
                              key={day}
                              className={`p-1 text-center font-mono border-r border-slate-200 text-[11px] ${
                                isOutOfMonth
                                  ? 'bg-slate-100/60 text-slate-300'
                                  : isVerif
                                  ? 'bg-indigo-100/90 text-indigo-950 font-black'
                                  : 'text-slate-300'
                              }`}
                            >
                              {isOutOfMonth ? '·' : isVerif ? pCount : ''}
                            </td>
                          );
                        })}
                        <td className="p-2 text-center font-mono font-black text-indigo-950 border-l border-slate-200">
                          {currentRecap.totalVerifiedPatientsInMonth}
                        </td>
                        <td
                          colSpan={2}
                          className="p-2 text-center text-[10.5px] font-bold text-indigo-900 border-l border-slate-200"
                        >
                          Pasien Disahkan
                        </td>
                      </tr>

                      {/* Grouped SPO Items 1.1 through 6.5 */}
                      {BAGIAN_SECTION_HEADERS.map((sec) => {
                        const sectionItems = OFFICIAL_LOGBOOK_ITEMS.filter(
                          (it) => it.bagian === sec.bagian
                        );

                        return (
                          <React.Fragment key={sec.bagian}>
                            {/* Section Header Row */}
                            <tr className="bg-slate-100/95 text-slate-900 font-bold">
                              <td
                                colSpan={3}
                                className="px-3 py-2 text-[10.5px] uppercase tracking-wider sticky left-0 bg-slate-100/95 z-10 border-r border-slate-300 flex items-center justify-between"
                              >
                                <span className="font-extrabold text-[#164e78]">{sec.title}</span>
                                <span className="font-semibold text-slate-600 text-[10px] normal-case tracking-normal">
                                  {sec.ruleBadge}
                                </span>
                              </td>
                              <td colSpan={34} className="bg-slate-100/95 border-b border-slate-200" />
                            </tr>

                            {/* Section Item Rows */}
                            {sectionItems.map((item, idx) => {
                              const scoreArr = currentRecap.logbook.dailyScores?.[item.code] || [];
                              const stat = currentRecap.itemStats[item.code] || {
                                totalScore: 0,
                                maxScore: 0,
                                pct: 0
                              };

                              return (
                                <tr
                                  key={item.code}
                                  className={`group transition-colors ${
                                    idx % 2 === 1
                                      ? 'bg-slate-50/50 hover:bg-blue-50/40'
                                      : 'bg-white hover:bg-blue-50/40'
                                  }`}
                                >
                                  {/* Sticky Col 1: Poin Code */}
                                  <td className="px-2 py-1.5 text-center font-mono font-bold text-slate-900 border-r border-slate-200 sticky left-0 z-10 bg-white group-hover:bg-blue-50/70">
                                    {item.code}
                                  </td>

                                  {/* Sticky Col 2: Fase Asuhan */}
                                  <td className="px-2.5 py-1.5 font-bold text-slate-800 border-r border-slate-200 sticky left-[52px] z-10 bg-white group-hover:bg-blue-50/70 leading-snug text-[10.5px]">
                                    {item.category}
                                  </td>

                                  {/* Fluid Col 3: Uraian Kegiatan SPO */}
                                  <td className="px-3 py-1.5 text-slate-700 border-r border-slate-200 text-[11px] leading-tight">
                                    {item.description}
                                  </td>

                                  {/* Day Score Cells (1 to 31) */}
                                  {daysArray.map((day, dayIdx) => {
                                    const isOutOfMonth = day > currentRecap.daysInMonth;
                                    const val = scoreArr[dayIdx];
                                    const isVerif =
                                      val !== null &&
                                      val !== undefined &&
                                      (Boolean(currentRecap.logbook.verifiedDays?.[dayIdx]) ||
                                        (item.code === '3.6' && Boolean(currentRecap.logbook.hasActivityDays?.[dayIdx])));
                                    const maxCell =
                                      currentRecap.logbook.dailyItemMaxScores?.[item.code]?.[dayIdx] ??
                                      (item.bagian === 1
                                        ? 1
                                        : currentRecap.logbook.dailyVerifiedPatientCounts?.[dayIdx] || 0);

                                    const cellColor = isOutOfMonth
                                      ? 'bg-slate-100/50 text-slate-300'
                                      : !isVerif
                                      ? 'text-slate-300'
                                      : val === 0 && maxCell === 0
                                      ? 'bg-slate-50 text-slate-400 font-semibold'
                                      : val === maxCell && maxCell > 0
                                      ? 'bg-emerald-50 text-emerald-900 font-bold'
                                      : val > 0
                                      ? 'bg-amber-50 text-amber-900 font-bold'
                                      : 'bg-rose-50/70 text-rose-700 font-semibold';

                                    return (
                                      <td
                                        key={day}
                                        className={`p-1 text-center font-mono border-r border-slate-200 text-[11px] ${cellColor}`}
                                        title={
                                          isOutOfMonth
                                            ? undefined
                                            : isVerif
                                            ? `Tanggal ${day}: Poin ${item.code} = ${val} dari ${maxCell}`
                                            : undefined
                                        }
                                      >
                                        {isOutOfMonth ? '·' : isVerif ? val : ''}
                                      </td>
                                    );
                                  })}

                                  {/* Right Summary Columns */}
                                  <td className="p-2 text-center font-mono font-bold text-slate-900 border-l border-slate-200">
                                    {stat.totalScore}
                                  </td>
                                  <td className="p-2 text-center font-mono text-slate-500 border-l border-slate-200">
                                    {stat.maxScore}
                                  </td>
                                  <td
                                    className={`p-2 text-center font-mono font-bold border-l border-slate-200 ${
                                      stat.maxScore === 0
                                        ? 'text-slate-400'
                                        : stat.pct === 100
                                        ? 'text-emerald-700'
                                        : stat.pct >= 75
                                        ? 'text-amber-700'
                                        : 'text-rose-700'
                                    }`}
                                  >
                                    {stat.pct}%
                                  </td>
                                </tr>
                              );
                            })}
                          </React.Fragment>
                        );
                      })}

                      {/* Sticky Footer Sums */}
                      <tr className="bg-slate-100 text-slate-950 font-bold text-center border-t-2 border-slate-300 text-[10.5px] sticky bottom-0 z-10 shadow-xs">
                        <td
                          colSpan={3}
                          className="px-3 py-2.5 border-r border-slate-300 text-right uppercase tracking-wider font-black sticky left-0 bg-slate-100 z-10"
                        >
                          TOTAL NILAI KEGIATAN SPO TERVERIFIKASI
                        </td>
                        {daysArray.map((day, dayIdx) => {
                          const isOutOfMonth = day > currentRecap.daysInMonth;
                          const daySum = currentRecap.dailyTotalScores[dayIdx];
                          const dayMax = currentRecap.dailyMaxScores[dayIdx];
                          const hasDay = daySum !== null && daySum !== undefined && !isOutOfMonth;
                          return (
                            <td
                              key={dayIdx}
                              className={`p-1 border-r border-slate-300 font-mono ${
                                isOutOfMonth
                                  ? 'bg-slate-200/50 text-slate-400'
                                  : hasDay
                                  ? 'bg-emerald-50 text-slate-950 font-black'
                                  : 'text-slate-300'
                              }`}
                              title={hasDay ? `Nilai Harian: ${daySum} / ${dayMax}` : undefined}
                            >
                              {isOutOfMonth ? '·' : hasDay ? daySum : ''}
                            </td>
                          );
                        })}
                        <td className="p-2 border-l border-slate-300 font-mono font-black text-[#164e78] text-xs">
                          {currentRecap.grandTotalScore}
                        </td>
                        <td className="p-2 border-l border-slate-300 font-mono font-bold text-slate-600 text-xs">
                          {currentRecap.grandMaxScore}
                        </td>
                        <td className="p-2 border-l border-slate-300 font-mono font-black text-emerald-800 text-xs">
                          {currentRecap.overallCompliancePct}%
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};
