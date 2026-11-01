import React, { useState, useMemo, useEffect } from 'react';
import {
  NurseScheduleEntry,
  DoctorScheduleEntry,
  MasterNurse,
  MasterDoctor,
  ShiftInfo,
  ShiftName,
  SystemAccessRole
} from '../types/dialysis.ts';
import {
  calculateScheduledStaffing,
  resolveDoctorsFromSchedule,
  resolvePjShiftFromSchedule
} from '../utils/masterDataHelpers.ts';
import {
  getCurrentIsoDateWib,
  formatIsoDateToIndonesianFull
} from '../utils/dateHelpers.ts';
import {
  INDONESIAN_MONTH_NAMES,
  NURSE_MATRIX_PALETTE,
  DOCTOR_MATRIX_PALETTE,
  NurseMatrixCode,
  DoctorMatrixCode,
  getNurseCodeMeta,
  getDoctorCodeMeta,
  parseYearMonthFromIso,
  formatYearMonthPrefix,
  getMonthCalendarDays,
  entryToNurseMatrixCode,
  entryToDoctorMatrixCode,
  getNextNurseMatrixCode,
  getNextDoctorMatrixCode,
  applyNurseMatrixCell,
  applyDoctorMatrixCell,
  generateMonthlyNurseRoster,
  generateMonthlyDoctorRoster,
  replaceMonthNurseSchedules,
  replaceMonthDoctorSchedules,
  copyPreviousMonthNurseRoster,
  copyPreviousMonthDoctorRoster,
  computeNurseMonthlyStat,
  computeDoctorMonthlyStat,
  exportMonthlyScheduleMatrixXlsx
} from '../utils/monthlyScheduleMatrixHelpers.ts';
import { printDocumentWithOrientation, downloadElementAsPdf } from '../utils/printHelpers.ts';
import { RshlLogo } from './RshlLogo.tsx';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  UserCheck,
  Stethoscope,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  FileSpreadsheet,
  Printer,
  FileDown,
  Copy,
  Trash2,
  Search,
  Paintbrush,
  MousePointerClick,
  FileText,
  X,
  ArrowRight,
  Upload
} from 'lucide-react';
import { ImportNurseScheduleSpreadsheetModal } from './ImportNurseScheduleSpreadsheetModal.tsx';

interface JadwalDinasViewProps {
  nurseSchedules: NurseScheduleEntry[];
  setNurseSchedules: React.Dispatch<React.SetStateAction<NurseScheduleEntry[]>>;
  doctorSchedules: DoctorScheduleEntry[];
  setDoctorSchedules: React.Dispatch<React.SetStateAction<DoctorScheduleEntry[]>>;
  masterNurses: MasterNurse[];
  masterDoctors: MasterDoctor[];
  shiftInfo: ShiftInfo;
  setShiftInfo: React.Dispatch<React.SetStateAction<ShiftInfo>>;
  userRole?: SystemAccessRole;
  currentIsoDate?: string;
  initialScheduleTab?: 'perawat' | 'dokter';
  onApplyScheduleToShiftInfo?: (appliedInfo: Partial<ShiftInfo>) => void;
}

type CellInteractionMode = 'brush' | 'cycle' | 'detail';

interface CellDetailModalState {
  kind: 'perawat' | 'dokter';
  isoDate: string;
  dayLabel: string;
  nurse?: MasterNurse;
  doctor?: MasterDoctor;
  nurseCode: NurseMatrixCode;
  doctorCode: DoctorMatrixCode;
  notes: string;
}

interface PendingBatchConfirm {
  action: 'fill_standard' | 'copy_prev' | 'clear_month';
  target: 'perawat' | 'dokter';
  title: string;
  description: string;
}

export const JadwalDinasView: React.FC<JadwalDinasViewProps> = ({
  nurseSchedules,
  setNurseSchedules,
  doctorSchedules,
  setDoctorSchedules,
  masterNurses,
  masterDoctors,
  shiftInfo,
  setShiftInfo,
  userRole = 'administrator',
  currentIsoDate,
  initialScheduleTab = 'perawat',
  onApplyScheduleToShiftInfo
}) => {
  const isAdmin = userRole === 'administrator';
  const canEditMatrix = userRole === 'administrator' || userRole === 'kepala_ruangan';

  const todayWibIso = getCurrentIsoDateWib();
  const activeReferenceIso = currentIsoDate || todayWibIso;
  const initialYm = useMemo(
    () => parseYearMonthFromIso(activeReferenceIso),
    [activeReferenceIso]
  );

  const [selectedYear, setSelectedYear] = useState<number>(initialYm.year);
  const [selectedMonth, setSelectedMonth] = useState<number>(initialYm.month);
  const [matrixTab, setMatrixTab] = useState<'perawat' | 'dokter'>(initialScheduleTab);

  // Sync initialScheduleTab when navigated from Master Data shortcut
  useEffect(() => {
    setMatrixTab(initialScheduleTab);
  }, [initialScheduleTab]);

  // Supervisor-only optional daily sync view (hidden for Administrator so Administrator is 100% Monthly Matrix only)
  const [supervisorViewMode, setSupervisorViewMode] = useState<'matrix' | 'daily_sync'>('matrix');
  const [syncTargetDate, setSyncTargetDate] = useState<string>(activeReferenceIso);

  // Interactive Matrix Editing Controls
  const [interactionMode, setInteractionMode] = useState<CellInteractionMode>('brush');
  const [activeNurseBrush, setActiveNurseBrush] = useState<NurseMatrixCode>('P');
  const [activeDoctorBrush, setActiveDoctorBrush] = useState<DoctorMatrixCode>('P');
  const [isDraggingPaint, setIsDraggingPaint] = useState<boolean>(false);

  // Filters
  const [staffSearch, setStaffSearch] = useState<string>('');
  const [nurseRoleFilter, setNurseRoleFilter] = useState<'all' | 'struktural' | 'pelaksana'>('all');
  const [doctorRoleFilter, setDoctorRoleFilter] = useState<'all' | 'dpjp' | 'dokter_jaga'>('all');

  // Inline Feedback & Modals (Zero window.alert / window.confirm)
  const [feedbackBanner, setFeedbackBanner] = useState<{
    tone: 'success' | 'info' | 'warning';
    text: string;
  } | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingBatchConfirm | null>(null);
  const [detailModal, setDetailModal] = useState<CellDetailModalState | null>(null);
  const [isImportSpreadsheetOpen, setIsImportSpreadsheetOpen] = useState<boolean>(false);

  useEffect(() => {
    const stopDrag = () => setIsDraggingPaint(false);
    window.addEventListener('mouseup', stopDrag);
    return () => window.removeEventListener('mouseup', stopDrag);
  }, []);

  const showFeedback = (
    text: string,
    tone: 'success' | 'info' | 'warning' = 'success'
  ) => {
    setFeedbackBanner({ tone, text });
    window.setTimeout(() => {
      setFeedbackBanner((prev) => (prev?.text === text ? null : prev));
    }, 4500);
  };

  const monthName = INDONESIAN_MONTH_NAMES[selectedMonth - 1] || '';
  const monthPrefix = `${formatYearMonthPrefix(selectedYear, selectedMonth)}-`;
  const monthDays = useMemo(
    () => getMonthCalendarDays(selectedYear, selectedMonth),
    [selectedYear, selectedMonth]
  );

  // Year options around current year
  const yearOptions = useMemo(() => {
    const base = parseYearMonthFromIso(todayWibIso).year;
    return [base - 2, base - 1, base, base + 1, base + 2];
  }, [todayWibIso]);

  const handlePrevMonth = () => {
    setPendingConfirm(null);
    if (selectedMonth === 1) {
      setSelectedYear((y) => y - 1);
      setSelectedMonth(12);
    } else {
      setSelectedMonth((m) => m - 1);
    }
  };

  const handleNextMonth = () => {
    setPendingConfirm(null);
    if (selectedMonth === 12) {
      setSelectedYear((y) => y + 1);
      setSelectedMonth(1);
    } else {
      setSelectedMonth((m) => m + 1);
    }
  };

  const handleJumpCurrentMonth = () => {
    setPendingConfirm(null);
    const ym = parseYearMonthFromIso(todayWibIso);
    setSelectedYear(ym.year);
    setSelectedMonth(ym.month);
  };

  // Ordered & Filtered Master Nurses (Kepala Ruang -> PJ Shift -> Pelaksana)
  const orderedActiveNurses = useMemo(() => {
    const roleWeight = (r: MasterNurse['role']) =>
      r === 'kepala_ruangan' ? 0 : r === 'pj_shift' ? 1 : 2;
    return [...masterNurses]
      .filter((n) => (n.accountStatus || 'aktif') === 'aktif')
      .sort((a, b) => roleWeight(a.role) - roleWeight(b.role));
  }, [masterNurses]);

  const filteredNurses = useMemo(() => {
    const q = staffSearch.trim().toLowerCase();
    return orderedActiveNurses.filter((n) => {
      if (nurseRoleFilter === 'struktural' && n.role === 'perawat_pelaksana') return false;
      if (nurseRoleFilter === 'pelaksana' && n.role !== 'perawat_pelaksana') return false;
      if (!q) return true;
      return (
        n.name.toLowerCase().includes(q) ||
        (n.nip && n.nip.toLowerCase().includes(q))
      );
    });
  }, [orderedActiveNurses, nurseRoleFilter, staffSearch]);

  // Ordered & Filtered Master Doctors (DPJP -> Both -> Dokter Jaga)
  const orderedActiveDoctors = useMemo(() => {
    const roleWeight = (r: MasterDoctor['role']) =>
      r === 'dpjp' ? 0 : r === 'both' ? 1 : 2;
    return [...masterDoctors]
      .filter((d) => (d.status || 'aktif') === 'aktif')
      .sort((a, b) => roleWeight(a.role) - roleWeight(b.role));
  }, [masterDoctors]);

  const filteredDoctors = useMemo(() => {
    const q = staffSearch.trim().toLowerCase();
    return orderedActiveDoctors.filter((d) => {
      if (doctorRoleFilter === 'dpjp' && d.role !== 'dpjp' && d.role !== 'both') return false;
      if (doctorRoleFilter === 'dokter_jaga' && d.role !== 'dokter_jaga' && d.role !== 'both') {
        return false;
      }
      if (!q) return true;
      return (
        d.name.toLowerCase().includes(q) ||
        (d.spesialisasi && d.spesialisasi.toLowerCase().includes(q)) ||
        (d.sip && d.sip.toLowerCase().includes(q))
      );
    });
  }, [orderedActiveDoctors, doctorRoleFilter, staffSearch]);

  // Monthly schedule slices & O(1) cell lookup maps
  const monthNurseSchedules = useMemo(
    () => nurseSchedules.filter((s) => s.date.startsWith(monthPrefix)),
    [nurseSchedules, monthPrefix]
  );

  const monthDoctorSchedules = useMemo(
    () => doctorSchedules.filter((d) => d.date.startsWith(monthPrefix)),
    [doctorSchedules, monthPrefix]
  );

  const nurseCellMap = useMemo(() => {
    const map = new Map<string, NurseScheduleEntry>();
    for (const s of monthNurseSchedules) {
      if (s.nurseId) map.set(`id:${s.nurseId}__${s.date}`, s);
      if (s.nurseName) map.set(`nm:${s.nurseName.trim().toLowerCase()}__${s.date}`, s);
    }
    return map;
  }, [monthNurseSchedules]);

  const doctorCellMap = useMemo(() => {
    const map = new Map<string, DoctorScheduleEntry>();
    for (const d of monthDoctorSchedules) {
      if (d.doctorId) map.set(`id:${d.doctorId}__${d.date}`, d);
      if (d.doctorName) map.set(`nm:${d.doctorName.trim().toLowerCase()}__${d.date}`, d);
    }
    return map;
  }, [monthDoctorSchedules]);

  const getNurseEntry = (nurse: MasterNurse, isoDate: string): NurseScheduleEntry | undefined =>
    nurseCellMap.get(`id:${nurse.id}__${isoDate}`) ||
    nurseCellMap.get(`nm:${nurse.name.trim().toLowerCase()}__${isoDate}`);

  const getDoctorEntry = (doc: MasterDoctor, isoDate: string): DoctorScheduleEntry | undefined =>
    doctorCellMap.get(`id:${doc.id}__${isoDate}`) ||
    doctorCellMap.get(`nm:${doc.name.trim().toLowerCase()}__${isoDate}`);

  // Daily Footer Totals for Nurse Matrix
  const dailyNurseTotals = useMemo(() => {
    return monthDays.map((calDay) => {
      const dayEntries = monthNurseSchedules.filter((s) => s.date === calDay.isoDate);
      const pagi = dayEntries.filter((s) => s.shift === 'Pagi').length;
      const siang = dayEntries.filter((s) => s.shift === 'Siang').length;
      const hasPjPagi = dayEntries.some((s) => s.shift === 'Pagi' && s.isPjShift);
      const hasPjSiang = dayEntries.some((s) => s.shift === 'Siang' && s.isPjShift);
      const onCall = dayEntries.filter((s) => s.shift === 'On-Call').length;
      const offCount = dayEntries.filter(
        (s) => s.shift === 'Libur' || s.shift === 'Cuti'
      ).length;
      return {
        isoDate: calDay.isoDate,
        isSunday: calDay.isSunday,
        pagi,
        siang,
        hasPjPagi,
        hasPjSiang,
        onCall,
        offCount
      };
    });
  }, [monthDays, monthNurseSchedules]);

  // Daily Footer Totals for Doctor Matrix
  const dailyDoctorTotals = useMemo(() => {
    return monthDays.map((calDay) => {
      const dayEntries = monthDoctorSchedules.filter((d) => d.date === calDay.isoDate);
      const dpjpAktif = dayEntries.filter(
        (d) => (d.role === 'dpjp' || d.role === 'both') && d.shift !== 'Libur'
      ).length;
      const jagaPagi = dayEntries.filter(
        (d) =>
          (d.role === 'dokter_jaga' || d.role === 'both') &&
          (d.shift === 'Pagi' || d.shift === 'All-Day')
      ).length;
      const jagaSiang = dayEntries.filter(
        (d) =>
          (d.role === 'dokter_jaga' || d.role === 'both') &&
          (d.shift === 'Siang' || d.shift === 'All-Day')
      ).length;
      const onCall = dayEntries.filter((d) => d.shift === 'On-Call').length;
      return {
        isoDate: calDay.isoDate,
        isSunday: calDay.isSunday,
        dpjpAktif,
        jagaPagi,
        jagaSiang,
        onCall
      };
    });
  }, [monthDays, monthDoctorSchedules]);

  // Cell Interaction Handlers
  const openNurseCellDetail = (nurse: MasterNurse, isoDate: string, dayLabel: string) => {
    const existing = getNurseEntry(nurse, isoDate);
    setDetailModal({
      kind: 'perawat',
      isoDate,
      dayLabel,
      nurse,
      nurseCode: entryToNurseMatrixCode(existing),
      doctorCode: '-',
      notes: existing?.notes || ''
    });
  };

  const openDoctorCellDetail = (doctor: MasterDoctor, isoDate: string, dayLabel: string) => {
    const existing = getDoctorEntry(doctor, isoDate);
    setDetailModal({
      kind: 'dokter',
      isoDate,
      dayLabel,
      doctor,
      nurseCode: '-',
      doctorCode: entryToDoctorMatrixCode(existing),
      notes: existing?.notes || ''
    });
  };

  const handleNurseCellActivate = (
    nurse: MasterNurse,
    isoDate: string,
    dayLabel: string,
    isDragEnter: boolean = false
  ) => {
    if (!canEditMatrix) return;

    if (interactionMode === 'detail' && !isDragEnter) {
      openNurseCellDetail(nurse, isoDate, dayLabel);
      return;
    }

    if (interactionMode === 'cycle' && !isDragEnter) {
      const currentCode = entryToNurseMatrixCode(getNurseEntry(nurse, isoDate));
      const nextCode = getNextNurseMatrixCode(currentCode, nurse.role);
      setNurseSchedules((prev) => applyNurseMatrixCell(prev, nurse, isoDate, nextCode));
      return;
    }

    if (interactionMode === 'brush') {
      setNurseSchedules((prev) =>
        applyNurseMatrixCell(prev, nurse, isoDate, activeNurseBrush)
      );
    }
  };

  const handleDoctorCellActivate = (
    doctor: MasterDoctor,
    isoDate: string,
    dayLabel: string,
    isDragEnter: boolean = false
  ) => {
    if (!canEditMatrix) return;

    if (interactionMode === 'detail' && !isDragEnter) {
      openDoctorCellDetail(doctor, isoDate, dayLabel);
      return;
    }

    if (interactionMode === 'cycle' && !isDragEnter) {
      const currentCode = entryToDoctorMatrixCode(getDoctorEntry(doctor, isoDate));
      const nextCode = getNextDoctorMatrixCode(currentCode);
      setDoctorSchedules((prev) => applyDoctorMatrixCell(prev, doctor, isoDate, nextCode));
      return;
    }

    if (interactionMode === 'brush') {
      setDoctorSchedules((prev) =>
        applyDoctorMatrixCell(prev, doctor, isoDate, activeDoctorBrush)
      );
    }
  };

  const handleSaveDetailModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!detailModal) return;

    if (detailModal.kind === 'perawat' && detailModal.nurse) {
      const targetNurse = detailModal.nurse;
      setNurseSchedules((prev) =>
        applyNurseMatrixCell(
          prev,
          targetNurse,
          detailModal.isoDate,
          detailModal.nurseCode,
          detailModal.notes
        )
      );
      showFeedback(
        `Jadwal ${targetNurse.name} (${detailModal.dayLabel}) diperbarui ke [${detailModal.nurseCode}].`
      );
    } else if (detailModal.kind === 'dokter' && detailModal.doctor) {
      const targetDoc = detailModal.doctor;
      setDoctorSchedules((prev) =>
        applyDoctorMatrixCell(
          prev,
          targetDoc,
          detailModal.isoDate,
          detailModal.doctorCode,
          detailModal.notes
        )
      );
      showFeedback(
        `Jadwal ${targetDoc.name} (${detailModal.dayLabel}) diperbarui ke [${detailModal.doctorCode}].`
      );
    }

    setDetailModal(null);
  };

  // Batch Actions with Inline Confirmation
  const requestBatchAction = (action: PendingBatchConfirm['action']) => {
    const targetLabel = matrixTab === 'perawat' ? 'Perawat' : 'Dokter';
    const hasExisting =
      matrixTab === 'perawat'
        ? monthNurseSchedules.length > 0
        : monthDoctorSchedules.length > 0;

    if (action === 'fill_standard') {
      if (!hasExisting) {
        executeBatchAction('fill_standard', matrixTab);
        return;
      }
      setPendingConfirm({
        action: 'fill_standard',
        target: matrixTab,
        title: `Terapkan Pola Standar ${targetLabel} (${monthName} ${selectedYear})?`,
        description: `Matriks ${targetLabel.toLowerCase()} bulan ${monthName} ${selectedYear} akan diisi otomatis sesuai rotasi standar PERNEFRI untuk seluruh tanggal 1 s/d ${monthDays.length}.`
      });
    } else if (action === 'copy_prev') {
      setPendingConfirm({
        action: 'copy_prev',
        target: matrixTab,
        title: `Salin Matriks ${targetLabel} dari Bulan Sebelumnya?`,
        description: `Seluruh kode dinas dari bulan lalu akan disalin ke tanggal yang bersesuaian pada ${monthName} ${selectedYear}.`
      });
    } else if (action === 'clear_month') {
      setPendingConfirm({
        action: 'clear_month',
        target: matrixTab,
        title: `Kosongkan Matriks ${targetLabel} Bulan ${monthName} ${selectedYear}?`,
        description: `Seluruh isian jadwal ${targetLabel.toLowerCase()} pada bulan ${monthName} ${selectedYear} akan dikosongkan (bulan lain tetap aman).`
      });
    }
  };

  const executeBatchAction = (
    action: PendingBatchConfirm['action'],
    target: 'perawat' | 'dokter'
  ) => {
    setPendingConfirm(null);

    if (action === 'fill_standard') {
      if (target === 'perawat') {
        const generated = generateMonthlyNurseRoster(
          selectedYear,
          selectedMonth,
          orderedActiveNurses
        );
        setNurseSchedules((prev) =>
          replaceMonthNurseSchedules(prev, selectedYear, selectedMonth, generated)
        );
        showFeedback(
          `Matriks bulanan Perawat (${monthName} ${selectedYear}) berhasil diisi untuk ${orderedActiveNurses.length} staf.`
        );
      } else {
        const generated = generateMonthlyDoctorRoster(
          selectedYear,
          selectedMonth,
          orderedActiveDoctors
        );
        setDoctorSchedules((prev) =>
          replaceMonthDoctorSchedules(prev, selectedYear, selectedMonth, generated)
        );
        showFeedback(
          `Matriks bulanan Dokter (${monthName} ${selectedYear}) berhasil diisi untuk ${orderedActiveDoctors.length} dokter.`
        );
      }
      return;
    }

    if (action === 'copy_prev') {
      if (target === 'perawat') {
        const res = copyPreviousMonthNurseRoster(
          nurseSchedules,
          selectedYear,
          selectedMonth,
          orderedActiveNurses
        );
        if (res.copiedCount === 0) {
          showFeedback(
            'Bulan sebelumnya belum memiliki data jadwal perawat untuk disalin.',
            'warning'
          );
          return;
        }
        setNurseSchedules(res.entries);
        showFeedback(
          `Berhasil menyalin ${res.copiedCount} sel jadwal perawat dari bulan sebelumnya ke ${monthName} ${selectedYear}.`
        );
      } else {
        const res = copyPreviousMonthDoctorRoster(
          doctorSchedules,
          selectedYear,
          selectedMonth,
          orderedActiveDoctors
        );
        if (res.copiedCount === 0) {
          showFeedback(
            'Bulan sebelumnya belum memiliki data jadwal dokter untuk disalin.',
            'warning'
          );
          return;
        }
        setDoctorSchedules(res.entries);
        showFeedback(
          `Berhasil menyalin ${res.copiedCount} sel jadwal dokter dari bulan sebelumnya ke ${monthName} ${selectedYear}.`
        );
      }
      return;
    }

    if (action === 'clear_month') {
      if (target === 'perawat') {
        setNurseSchedules((prev) =>
          replaceMonthNurseSchedules(prev, selectedYear, selectedMonth, [])
        );
        showFeedback(`Matriks jadwal perawat bulan ${monthName} ${selectedYear} telah dikosongkan.`, 'info');
      } else {
        setDoctorSchedules((prev) =>
          replaceMonthDoctorSchedules(prev, selectedYear, selectedMonth, [])
        );
        showFeedback(`Matriks jadwal dokter bulan ${monthName} ${selectedYear} telah dikosongkan.`, 'info');
      }
    }
  };

  const handleExportExcel = () => {
    exportMonthlyScheduleMatrixXlsx({
      year: selectedYear,
      month: selectedMonth,
      nurses: orderedActiveNurses,
      doctors: orderedActiveDoctors,
      nurseSchedules,
      doctorSchedules,
      hospitalName: shiftInfo.hospitalName || 'RS Happy Land Medical Centre',
      unitName: shiftInfo.unitName || 'Instalasi Hemodialisa',
      kepalaRuangan: shiftInfo.kepalaRuangan || 'TWIS FERTILIANTI PW'
    });
    showFeedback(
      `File Excel Matriks Bulanan Perawat & Dokter (${monthName} ${selectedYear}) berhasil diunduh.`
    );
  };

  const handlePrintLandscape = () => {
    const docLabel =
      matrixTab === 'perawat'
        ? `Matriks_Jadwal_Perawat_HD_${monthName}_${selectedYear}`
        : `Matriks_Jadwal_Dokter_HD_${monthName}_${selectedYear}`;
    printDocumentWithOrientation(true, docLabel, false);
  };

  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const handleDownloadPdf = async () => {
    const el = document.getElementById('printable-jadwal-sheet');
    if (!el) return;
    setIsExportingPdf(true);
    el.classList.remove('hidden');
    try {
      const docLabel =
        matrixTab === 'perawat'
          ? `Matriks_Jadwal_Perawat_HD_${monthName}_${selectedYear}`
          : `Matriks_Jadwal_Dokter_HD_${monthName}_${selectedYear}`;
      await downloadElementAsPdf(el, {
        filename: docLabel,
        isLandscape: true
      });
    } catch (err) {
      console.error('Download PDF error:', err);
    } finally {
      el.classList.add('hidden');
      setIsExportingPdf(false);
    }
  };

  // Supervisor-only Daily Sync Handler (for Kepala Ruangan / PJ Shift)
  const handleApplyDailyShiftSync = (targetShift: ShiftName) => {
    const staffing = calculateScheduledStaffing(nurseSchedules, syncTargetDate, targetShift, 24);
    const nextShift: ShiftName = targetShift === 'Pagi' ? 'Siang' : 'Pagi';
    const nextPj = resolvePjShiftFromSchedule(
      nurseSchedules,
      syncTargetDate,
      nextShift,
      shiftInfo.pjShiftBerikutnya
    );
    const docs = resolveDoctorsFromSchedule(
      doctorSchedules,
      syncTargetDate,
      targetShift,
      shiftInfo.dokterDpjp,
      shiftInfo.dokterJaga
    );
    const shiftHoursMap: Record<ShiftName, string> = {
      Pagi: 'Pagi, jam 07.00 - 14.00 WIB',
      Siang: 'Siang, jam 14.00 - 21.00 WIB',
      Malam: 'Malam, jam 21.00 - 07.00 WIB'
    };
    const updatedFields: Partial<ShiftInfo> = {
      date: formatIsoDateToIndonesianFull(syncTargetDate),
      shift: targetShift,
      shiftHours: shiftHoursMap[targetShift],
      pjShift: staffing.pjName !== '-' ? staffing.pjName : shiftInfo.pjShift,
      pjShiftBerikutnya: nextPj,
      dokterDpjp: docs.dpjp,
      dokterJaga: docs.dokterJaga,
      totalPerawatDinas: staffing.totalDinas || shiftInfo.totalPerawatDinas,
      detailPerawat:
        staffing.totalDinas > 0 ? staffing.detailText : shiftInfo.detailPerawat,
      perawatRatio:
        staffing.totalDinas > 0 ? staffing.ratioText : shiftInfo.perawatRatio
    };
    setShiftInfo((prev) => ({ ...prev, ...updatedFields }));
    if (onApplyScheduleToShiftInfo) {
      onApplyScheduleToShiftInfo(updatedFields);
    }
    showFeedback(
      `Jadwal Shift ${targetShift} (${formatIsoDateToIndonesianFull(syncTargetDate)}) diterapkan ke Laporan Harian.`
    );
  };

  const syncDatePagiStaffing = useMemo(
    () => calculateScheduledStaffing(nurseSchedules, syncTargetDate, 'Pagi', 24),
    [nurseSchedules, syncTargetDate]
  );
  const syncDateSiangStaffing = useMemo(
    () => calculateScheduledStaffing(nurseSchedules, syncTargetDate, 'Siang', 24),
    [nurseSchedules, syncTargetDate]
  );

  return (
    <div className="space-y-4">
      {/* ===================================================================== */}
      {/* SCREEN WORKSPACE (Hidden when printing A4 Landscape)                  */}
      {/* ===================================================================== */}
      <div className="space-y-4 print:hidden">
        {/* Top Administrator / Jadwal Dinas Matrix Header */}
        <div className="bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 text-white rounded-2xl p-4 sm:p-5 shadow-md border border-blue-900/60">
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-[11px] font-semibold text-sky-300/90 tracking-wide">
                {isAdmin
                  ? 'Hak Akses Administrator · Format Matriks Bulanan Terpadu'
                  : 'Manajemen Roster Bulanan · Instalasi Hemodialisa RS Happy Land'}
              </div>
              <h2 className="text-lg sm:text-xl font-extrabold tracking-tight text-white flex items-center gap-2">
                <Calendar className="w-5 h-5 text-sky-400 shrink-0" />
                <span>
                  Matriks Bulanan Jadwal Perawat &amp; Dokter ({monthName} {selectedYear})
                </span>
              </h2>
              <p className="text-xs text-slate-300 max-w-3xl leading-relaxed">
                {isAdmin
                  ? 'Pengelolaan jadwal dinas perawat dan dokter ditampilkan penuh dalam tabel matriks 1 bulan (tanggal 1 s/d akhir bulan). Pilih kode shift lalu klik atau seret sel pada baris staf.'
                  : 'Tabel matriks jadwal dinas bulanan seluruh perawat dan dokter ruangan hemodialisis.'}
              </p>
            </div>

            {/* Month/Year Navigator + Export & Print */}
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <div className="inline-flex items-center bg-slate-800/90 border border-slate-700 rounded-xl p-1 gap-1">
                <button
                  type="button"
                  onClick={handlePrevMonth}
                  title="Bulan Sebelumnya"
                  className="p-1.5 rounded-lg text-slate-200 hover:bg-slate-700 hover:text-white transition-colors cursor-pointer shrink-0"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                <select
                  aria-label="Pilih Bulan"
                  value={selectedMonth}
                  onChange={(e) => {
                    setPendingConfirm(null);
                    setSelectedMonth(Number(e.target.value));
                  }}
                  className="bg-slate-900 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg border border-slate-700 focus:outline-hidden focus:ring-2 focus:ring-sky-500 cursor-pointer"
                >
                  {INDONESIAN_MONTH_NAMES.map((mName, i) => (
                    <option key={mName} value={i + 1}>
                      {mName}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Pilih Tahun"
                  value={selectedYear}
                  onChange={(e) => {
                    setPendingConfirm(null);
                    setSelectedYear(Number(e.target.value));
                  }}
                  className="bg-slate-900 text-white text-xs font-bold font-mono px-2 py-1.5 rounded-lg border border-slate-700 focus:outline-hidden focus:ring-2 focus:ring-sky-500 cursor-pointer tabular-nums"
                >
                  {yearOptions.map((yr) => (
                    <option key={yr} value={yr}>
                      {yr}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={handleNextMonth}
                  title="Bulan Berikutnya"
                  className="p-1.5 rounded-lg text-slate-200 hover:bg-slate-700 hover:text-white transition-colors cursor-pointer shrink-0"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={handleJumpCurrentMonth}
                  className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold text-sky-300 hover:bg-slate-700/80 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  Bulan Ini
                </button>
              </div>

              <button
                type="button"
                onClick={() => setIsImportSpreadsheetOpen(true)}
                className="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 shadow-xs"
                title="Impor jadwal dari file Excel (.xlsx / .csv) atau Copy-Paste persis sesuai format spreadsheet"
              >
                <Upload className="w-4 h-4 shrink-0" />
                <span>Impor Spreadsheet (.xlsx / Paste)</span>
              </button>

              <button
                type="button"
                onClick={handleExportExcel}
                className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 shadow-xs"
              >
                <FileSpreadsheet className="w-4 h-4 shrink-0" />
                <span>Unduh Excel (.xlsx)</span>
              </button>

              <button
                type="button"
                onClick={handlePrintLandscape}
                className="px-3.5 py-2 bg-white/10 hover:bg-white/20 text-white border border-white/20 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                title="Buka dialog cetak browser langsung (A4 Landscape)"
              >
                <Printer className="w-4 h-4 shrink-0" />
                <span>Cetak A4</span>
              </button>

              <button
                type="button"
                onClick={handleDownloadPdf}
                disabled={isExportingPdf}
                className="px-3.5 py-2 bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 shadow-xs"
                title="Download file PDF jadwal dinas langsung"
              >
                <FileDown className="w-4 h-4 shrink-0" />
                <span>{isExportingPdf ? 'Mengunduh...' : 'Simpan PDF'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Inline Feedback Banner */}
        {feedbackBanner && (
          <div
            className={`px-4 py-2.5 rounded-xl border text-xs font-semibold flex items-center justify-between gap-3 ${
              feedbackBanner.tone === 'warning'
                ? 'bg-amber-50 border-amber-200 text-amber-900'
                : feedbackBanner.tone === 'info'
                ? 'bg-sky-50 border-sky-200 text-sky-900'
                : 'bg-emerald-50 border-emerald-200 text-emerald-900'
            }`}
          >
            <div className="flex items-center gap-2">
              {feedbackBanner.tone === 'warning' ? (
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              )}
              <span>{feedbackBanner.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setFeedbackBanner(null)}
              className="text-slate-400 hover:text-slate-700 cursor-pointer p-0.5"
              aria-label="Tutup notifikasi"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Inline Batch Action Confirmation Banner */}
        {pendingConfirm && (
          <div className="bg-amber-50/95 border border-amber-300 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
            <div className="space-y-0.5">
              <div className="text-xs font-extrabold text-amber-950 flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                <span>{pendingConfirm.title}</span>
              </div>
              <p className="text-[11px] text-amber-800">{pendingConfirm.description}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setPendingConfirm(null)}
                className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-lg text-xs font-bold cursor-pointer whitespace-nowrap shrink-0"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={() =>
                  executeBatchAction(pendingConfirm.action, pendingConfirm.target)
                }
                className={`px-3.5 py-1.5 text-white rounded-lg text-xs font-bold cursor-pointer whitespace-nowrap shrink-0 ${
                  pendingConfirm.action === 'clear_month'
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-blue-700 hover:bg-blue-800'
                }`}
              >
                Ya, Lanjutkan
              </button>
            </div>
          </div>
        )}

        {/* Primary Matrix Switcher: Matriks Perawat vs Matriks Dokter (+ Optional Supervisor Daily Sync) */}
        <div className="bg-white rounded-2xl border border-slate-200/90 p-3 shadow-2xs flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center bg-slate-100 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => {
                  setMatrixTab('perawat');
                  setSupervisorViewMode('matrix');
                  setPendingConfirm(null);
                }}
                className={`px-4 py-2 rounded-lg text-xs font-extrabold transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                  supervisorViewMode === 'matrix' && matrixTab === 'perawat'
                    ? 'bg-blue-700 text-white shadow-xs'
                    : 'text-slate-700 hover:text-slate-950'
                }`}
              >
                <UserCheck className="w-4 h-4 shrink-0" />
                <span>Matriks Bulanan Perawat ({orderedActiveNurses.length})</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMatrixTab('dokter');
                  setSupervisorViewMode('matrix');
                  setPendingConfirm(null);
                }}
                className={`px-4 py-2 rounded-lg text-xs font-extrabold transition-all flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0 tabular-nums ${
                  supervisorViewMode === 'matrix' && matrixTab === 'dokter'
                    ? 'bg-blue-700 text-white shadow-xs'
                    : 'text-slate-700 hover:text-slate-950'
                }`}
              >
                <Stethoscope className="w-4 h-4 shrink-0" />
                <span>Matriks Bulanan Dokter ({orderedActiveDoctors.length})</span>
              </button>
            </div>

            {/* Only non-administrator supervisors see Daily Sync option; Administrator is purely Monthly Matrix */}
            {!isAdmin && (
              <button
                type="button"
                onClick={() =>
                  setSupervisorViewMode((m) => (m === 'matrix' ? 'daily_sync' : 'matrix'))
                }
                className={`px-3.5 py-2 rounded-xl text-xs font-bold border transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 ${
                  supervisorViewMode === 'daily_sync'
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                <span>Sinkronisasi Shift Harian</span>
              </button>
            )}
          </div>

          {/* Unboxed Monthly Summary Metrics */}
          <div className="text-xs text-slate-600 font-medium tabular-nums flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              Periode: <strong className="text-slate-900">{monthName} {selectedYear}</strong> ({monthDays.length} Hari)
            </span>
            <span className="text-slate-300">&middot;</span>
            {matrixTab === 'perawat' ? (
              <span>
                Sel Terisi:{' '}
                <strong className="text-blue-800">{monthNurseSchedules.length}</strong> /{' '}
                {orderedActiveNurses.length * monthDays.length}
              </span>
            ) : (
              <span>
                Sel Terisi:{' '}
                <strong className="text-blue-800">{monthDoctorSchedules.length}</strong> /{' '}
                {orderedActiveDoctors.length * monthDays.length}
              </span>
            )}
          </div>
        </div>

        {/* ================================================================= */}
        {/* SUPERVISOR DAILY SYNC PANEL (Non-Admin Only when toggled)         */}
        {/* ================================================================= */}
        {!isAdmin && supervisorViewMode === 'daily_sync' && (
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-2xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-extrabold text-slate-900">
                  Sinkronisasi Jadwal Matriks ke Laporan Harian PJ Shift
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Pilih tanggal untuk menarik nama PJ Shift, jumlah perawat dinas, DPJP, dan Dokter Jaga dari matriks bulanan ke Laporan Harian.
                </p>
              </div>
              <input
                type="date"
                value={syncTargetDate}
                onChange={(e) => e.target.value && setSyncTargetDate(e.target.value)}
                className="px-3 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold font-mono text-slate-800"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 tabular-nums">
              <div className="rounded-xl border border-slate-200 p-4 flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-xs font-extrabold text-slate-900">Shift Pagi (07.00 - 14.00)</div>
                  <div className="text-xs text-slate-600">
                    PJ Shift: <strong className="text-slate-900">{syncDatePagiStaffing.pjName}</strong> &middot;{' '}
                    Total Dinas: <strong className="text-blue-700">{syncDatePagiStaffing.totalDinas} Perawat</strong>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleApplyDailyShiftSync('Pagi')}
                  className="px-3.5 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-xs font-bold cursor-pointer whitespace-nowrap shrink-0"
                >
                  Terapkan Shift Pagi
                </button>
              </div>

              <div className="rounded-xl border border-slate-200 p-4 flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-xs font-extrabold text-slate-900">Shift Siang (14.00 - 21.00)</div>
                  <div className="text-xs text-slate-600">
                    PJ Shift: <strong className="text-slate-900">{syncDateSiangStaffing.pjName}</strong> &middot;{' '}
                    Total Dinas: <strong className="text-amber-700">{syncDateSiangStaffing.totalDinas} Perawat</strong>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleApplyDailyShiftSync('Siang')}
                  className="px-3.5 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded-xl text-xs font-bold cursor-pointer whitespace-nowrap shrink-0"
                >
                  Terapkan Shift Siang
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* MONTHLY MATRIX WORKSPACE (Always shown for Administrator)         */}
        {/* ================================================================= */}
        {(isAdmin || supervisorViewMode === 'matrix') && (
          <div className="bg-white rounded-2xl border border-slate-200/95 shadow-xs overflow-hidden">
            {/* Matrix Toolbar: Brush Palette + Filters + Batch Month Tools */}
            <div className="p-3.5 sm:p-4 bg-slate-50/80 border-b border-slate-200 space-y-3">
              {/* Row 1: Search, Role Filter & Month Batch Operations */}
              <div className="flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-2.5">
                <div className="flex flex-wrap items-center gap-2 flex-1">
                  <div className="relative min-w-[220px] flex-1 max-w-xs">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      value={staffSearch}
                      onChange={(e) => setStaffSearch(e.target.value)}
                      placeholder={
                        matrixTab === 'perawat'
                          ? 'Cari nama perawat atau NIP...'
                          : 'Cari nama dokter, spesialisasi, SIP...'
                      }
                      className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-300 rounded-xl text-xs font-medium text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                    />
                  </div>

                  {matrixTab === 'perawat' ? (
                    <div className="inline-flex items-center bg-slate-200/75 p-0.5 rounded-xl text-[11px] font-bold">
                      <button
                        type="button"
                        onClick={() => setNurseRoleFilter('all')}
                        className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                          nurseRoleFilter === 'all'
                            ? 'bg-white text-slate-900 shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Semua ({orderedActiveNurses.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setNurseRoleFilter('struktural')}
                        className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                          nurseRoleFilter === 'struktural'
                            ? 'bg-white text-blue-800 shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Ka. Ruang &amp; PJ
                      </button>
                      <button
                        type="button"
                        onClick={() => setNurseRoleFilter('pelaksana')}
                        className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                          nurseRoleFilter === 'pelaksana'
                            ? 'bg-white text-slate-900 shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Pelaksana
                      </button>
                    </div>
                  ) : (
                    <div className="inline-flex items-center bg-slate-200/75 p-0.5 rounded-xl text-[11px] font-bold">
                      <button
                        type="button"
                        onClick={() => setDoctorRoleFilter('all')}
                        className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                          doctorRoleFilter === 'all'
                            ? 'bg-white text-slate-900 shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Semua ({orderedActiveDoctors.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setDoctorRoleFilter('dpjp')}
                        className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                          doctorRoleFilter === 'dpjp'
                            ? 'bg-white text-blue-800 shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Dokter DPJP
                      </button>
                      <button
                        type="button"
                        onClick={() => setDoctorRoleFilter('dokter_jaga')}
                        className={`px-2.5 py-1 rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                          doctorRoleFilter === 'dokter_jaga'
                            ? 'bg-white text-emerald-800 shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        Dokter Jaga Ruangan
                      </button>
                    </div>
                  )}
                </div>

                {/* Month Batch Buttons (Editable Roles Only) */}
                {canEditMatrix && (
                  <div className="flex flex-wrap items-center gap-2">
                    {matrixTab === 'perawat' && (
                      <button
                        type="button"
                        onClick={() => setIsImportSpreadsheetOpen(true)}
                        className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-300 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0 shadow-2xs"
                        title="Impor tabel spreadsheet sesuai format gambar lampiran (P, S, L, C)"
                      >
                        <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                        <span>Impor Format Spreadsheet</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => requestBatchAction('fill_standard')}
                      className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <RefreshCw className="w-3.5 h-3.5 shrink-0" />
                      <span>Isi Pola Standar Bulan Ini</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => requestBatchAction('copy_prev')}
                      className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Copy className="w-3.5 h-3.5 shrink-0" />
                      <span>Salin Bulan Lalu</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => requestBatchAction('clear_month')}
                      className="px-3 py-1.5 bg-white hover:bg-rose-50 text-slate-600 hover:text-rose-700 border border-slate-300 hover:border-rose-200 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer whitespace-nowrap shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5 shrink-0" />
                      <span>Kosongkan Bulan</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Row 2: Interactive Shift Brush / Click Mode Selector */}
              {canEditMatrix && (
                <div className="pt-2 border-t border-slate-200/80 flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-bold text-slate-600 mr-1">
                      Mode Klik Sel:
                    </span>

                    <div className="inline-flex items-center bg-slate-200/80 p-0.5 rounded-xl text-[11px] font-bold mr-1.5">
                      <button
                        type="button"
                        onClick={() => setInteractionMode('brush')}
                        className={`px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                          interactionMode === 'brush'
                            ? 'bg-slate-900 text-white shadow-2xs'
                            : 'text-slate-700 hover:text-slate-900'
                        }`}
                      >
                        <Paintbrush className="w-3 h-3 shrink-0" />
                        <span>Kuas Shift (Klik / Seret)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setInteractionMode('cycle')}
                        className={`px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                          interactionMode === 'cycle'
                            ? 'bg-slate-900 text-white shadow-2xs'
                            : 'text-slate-700 hover:text-slate-900'
                        }`}
                      >
                        <MousePointerClick className="w-3 h-3 shrink-0" />
                        <span>Klik Putar Kode</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setInteractionMode('detail')}
                        className={`px-2.5 py-1 rounded-lg flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                          interactionMode === 'detail'
                            ? 'bg-slate-900 text-white shadow-2xs'
                            : 'text-slate-700 hover:text-slate-900'
                        }`}
                      >
                        <FileText className="w-3 h-3 shrink-0" />
                        <span>Edit Catatan Sel</span>
                      </button>
                    </div>

                    {/* Shift Code Brush Buttons */}
                    {interactionMode === 'brush' &&
                      (matrixTab === 'perawat'
                        ? NURSE_MATRIX_PALETTE.map((item) => {
                            const selected = activeNurseBrush === item.code;
                            return (
                              <button
                                key={item.code}
                                type="button"
                                onClick={() => setActiveNurseBrush(item.code)}
                                title={`${item.label} (${item.shortDesc})`}
                                className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold transition-all cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 tabular-nums ${
                                  selected
                                    ? `${item.brushClass} ring-2 ring-offset-1 ring-slate-900/30 shadow-2xs`
                                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                                }`}
                              >
                                <span className="font-mono font-extrabold">{item.code}</span>
                                <span className="hidden sm:inline font-semibold opacity-95">
                                  {item.label}
                                </span>
                              </button>
                            );
                          })
                        : DOCTOR_MATRIX_PALETTE.map((item) => {
                            const selected = activeDoctorBrush === item.code;
                            return (
                              <button
                                key={item.code}
                                type="button"
                                onClick={() => setActiveDoctorBrush(item.code)}
                                title={`${item.label} (${item.shortDesc})`}
                                className={`px-2.5 py-1 rounded-lg border text-[11px] font-bold transition-all cursor-pointer inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 tabular-nums ${
                                  selected
                                    ? `${item.brushClass} ring-2 ring-offset-1 ring-slate-900/30 shadow-2xs`
                                    : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-100'
                                }`}
                              >
                                <span className="font-mono font-extrabold">{item.code}</span>
                                <span className="hidden sm:inline font-semibold opacity-95">
                                  {item.label}
                                </span>
                              </button>
                            );
                          }))}
                  </div>

                  <div className="text-[11px] text-slate-500 shrink-0">
                    Tip: Klik kanan sel mana saja untuk mengisi catatan khusus.
                  </div>
                </div>
              )}
            </div>

            {/* =============================================================== */}
            {/* 1. MATRIKS BULANAN PERAWAT GRID                                 */}
            {/* =============================================================== */}
            {matrixTab === 'perawat' ? (
              <div
                className="overflow-x-auto select-none"
                onMouseLeave={() => setIsDraggingPaint(false)}
              >
                <table className="w-full border-collapse text-[11px] tabular-nums">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700 border-b border-slate-300">
                      <th className="sticky left-0 z-20 bg-slate-100 p-2 w-9 min-w-[36px] text-center font-extrabold border-r border-slate-200">
                        No
                      </th>
                      <th className="sticky left-9 z-20 bg-slate-100 px-3 py-2 min-w-[210px] max-w-[230px] text-left font-extrabold border-r border-slate-300 shadow-[2px_0_4px_-2px_rgba(15,23,42,0.12)]">
                        Nama Perawat &amp; Jabatan
                      </th>
                      {monthDays.map((d) => {
                        const isToday = d.isoDate === activeReferenceIso;
                        return (
                          <th
                            key={d.isoDate}
                            className={`px-0.5 py-1.5 min-w-[36px] w-[36px] text-center border-r border-slate-200/90 ${
                              isToday
                                ? 'bg-blue-100/90 text-blue-950'
                                : d.isSunday
                                ? 'bg-rose-50/90 text-rose-700'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                            title={formatIsoDateToIndonesianFull(d.isoDate)}
                          >
                            <div className="font-mono font-extrabold text-[11px] leading-tight">
                              {String(d.day).padStart(2, '0')}
                            </div>
                            <div
                              className={`text-[9.5px] font-bold leading-tight ${
                                isToday
                                  ? 'text-blue-800'
                                  : d.isSunday
                                  ? 'text-rose-600'
                                  : 'text-slate-500'
                              }`}
                            >
                              {d.dayShort}
                            </div>
                          </th>
                        );
                      })}
                      {/* Individual Monthly Summary Columns */}
                      <th
                        className="px-1.5 py-2 min-w-[34px] text-center font-extrabold bg-sky-50/90 text-sky-900 border-l border-r border-slate-200"
                        title="Total Dinas Pagi (termasuk PJ Pagi)"
                      >
                        P
                      </th>
                      <th
                        className="px-1.5 py-2 min-w-[34px] text-center font-extrabold bg-amber-50/90 text-amber-900 border-r border-slate-200"
                        title="Total Dinas Siang (termasuk PJ Siang)"
                      >
                        S
                      </th>
                      <th
                        className="px-1.5 py-2 min-w-[34px] text-center font-extrabold bg-blue-50/90 text-blue-900 border-r border-slate-200"
                        title="Total Penugasan sebagai PJ Shift"
                      >
                        PJ
                      </th>
                      <th
                        className="px-1.5 py-2 min-w-[38px] text-center font-extrabold bg-teal-50/90 text-teal-900 border-r border-slate-200"
                        title="Total On-Call Cito / Malam"
                      >
                        OC
                      </th>
                      <th
                        className="px-1.5 py-2 min-w-[38px] text-center font-extrabold bg-slate-100 text-slate-600 border-r border-slate-200"
                        title="Total Libur & Cuti"
                      >
                        L/CT
                      </th>
                      <th
                        className="px-2 py-2 min-w-[44px] text-center font-extrabold bg-slate-200/80 text-slate-900"
                        title="Total Hari Dinas Aktif Bulan Ini"
                      >
                        &Sigma;
                      </th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-200">
                    {filteredNurses.length === 0 ? (
                      <tr>
                        <td
                          colSpan={monthDays.length + 8}
                          className="p-8 text-center text-xs text-slate-500"
                        >
                          Tidak ada staf perawat yang sesuai dengan pencarian.
                        </td>
                      </tr>
                    ) : (
                      filteredNurses.map((nurse, idx) => {
                        const stat = computeNurseMonthlyStat(
                          nurse,
                          monthDays,
                          monthNurseSchedules
                        );
                        const roleShort =
                          nurse.role === 'kepala_ruangan'
                            ? 'Kepala Ruangan'
                            : nurse.role === 'pj_shift'
                            ? 'PJ Shift'
                            : 'Pelaksana';
                        const roleTone =
                          nurse.role === 'kepala_ruangan'
                            ? 'text-indigo-700'
                            : nurse.role === 'pj_shift'
                            ? 'text-blue-700'
                            : 'text-slate-500';
                        const rowBg = idx % 2 === 1 ? 'bg-slate-50/60' : 'bg-white';
                        const stickyBg = idx % 2 === 1 ? 'bg-slate-50' : 'bg-white';

                        return (
                          <tr key={nurse.id} className={`${rowBg} hover:bg-blue-50/25`}>
                            <td
                              className={`sticky left-0 z-10 ${stickyBg} p-1.5 text-center font-mono font-bold text-slate-400 border-r border-slate-200`}
                            >
                              {idx + 1}
                            </td>

                            <td
                              className={`sticky left-9 z-10 ${stickyBg} px-3 py-1.5 border-r border-slate-300 shadow-[2px_0_4px_-2px_rgba(15,23,42,0.08)]`}
                            >
                              <div className="font-bold text-[11.5px] text-slate-900 truncate max-w-[200px]">
                                {nurse.name}
                              </div>
                              <div className="text-[10px] flex items-center gap-1.5 truncate">
                                <span className={`font-bold ${roleTone}`}>{roleShort}</span>
                                {nurse.nip && (
                                  <>
                                    <span className="text-slate-300">&middot;</span>
                                    <span className="font-mono text-slate-400">{nurse.nip}</span>
                                  </>
                                )}
                              </div>
                            </td>

                            {monthDays.map((calDay) => {
                              const entry = getNurseEntry(nurse, calDay.isoDate);
                              const code = entryToNurseMatrixCode(entry);
                              const meta = getNurseCodeMeta(code);
                              const dayLabel = `${calDay.day} ${monthName} ${selectedYear}`;
                              const hasCustomNote = Boolean(entry?.notes);

                              return (
                                <td
                                  key={calDay.isoDate}
                                  className={`p-0.5 text-center border-r border-slate-200/80 ${
                                    calDay.isoDate === activeReferenceIso
                                      ? 'bg-blue-50/50'
                                      : calDay.isSunday
                                      ? 'bg-rose-50/35'
                                      : ''
                                  }`}
                                >
                                  <button
                                    type="button"
                                    disabled={!canEditMatrix}
                                    onMouseDown={(e) => {
                                      if (e.button !== 0) return;
                                      if (interactionMode === 'brush') {
                                        setIsDraggingPaint(true);
                                      }
                                      handleNurseCellActivate(
                                        nurse,
                                        calDay.isoDate,
                                        dayLabel,
                                        false
                                      );
                                    }}
                                    onMouseEnter={() => {
                                      if (isDraggingPaint && interactionMode === 'brush') {
                                        handleNurseCellActivate(
                                          nurse,
                                          calDay.isoDate,
                                          dayLabel,
                                          true
                                        );
                                      }
                                    }}
                                    onContextMenu={(e) => {
                                      if (!canEditMatrix) return;
                                      e.preventDefault();
                                      openNurseCellDetail(nurse, calDay.isoDate, dayLabel);
                                    }}
                                    title={`${nurse.name} · ${calDay.dayFull}, ${dayLabel} · ${meta.label}${
                                      entry?.notes ? ` (${entry.notes})` : ''
                                    }`}
                                    className={`relative w-full h-7 rounded-md border font-mono text-[10px] font-bold flex items-center justify-center transition-colors ${
                                      meta.cellClass
                                    } ${canEditMatrix ? 'cursor-pointer' : 'cursor-default'}`}
                                  >
                                    <span>{code === '-' ? '·' : code}</span>
                                    {hasCustomNote && (
                                      <span className="absolute top-0.5 right-0.5 w-1 h-1 rounded-full bg-current opacity-65" />
                                    )}
                                  </button>
                                </td>
                              );
                            })}

                            {/* Recap Cells */}
                            <td className="px-1 py-1.5 text-center font-mono font-bold text-sky-800 bg-sky-50/40 border-l border-r border-slate-200">
                              {stat.pagiCount}
                            </td>
                            <td className="px-1 py-1.5 text-center font-mono font-bold text-amber-800 bg-amber-50/40 border-r border-slate-200">
                              {stat.siangCount}
                            </td>
                            <td className="px-1 py-1.5 text-center font-mono font-bold text-blue-800 bg-blue-50/40 border-r border-slate-200">
                              {stat.pjCount || '-'}
                            </td>
                            <td className="px-1 py-1.5 text-center font-mono font-semibold text-teal-800 bg-teal-50/30 border-r border-slate-200">
                              {stat.onCallOrMalamCount || '-'}
                            </td>
                            <td className="px-1 py-1.5 text-center font-mono text-slate-500 bg-slate-50/60 border-r border-slate-200">
                              {stat.liburOrCutiCount}
                            </td>
                            <td className="px-1.5 py-1.5 text-center font-mono font-extrabold text-slate-900 bg-slate-100/80">
                              {stat.activeWorkDays}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>

                  {/* Daily Staffing Recap Footer */}
                  <tfoot className="border-t-2 border-slate-300 bg-slate-50 text-[10.5px] font-mono">
                    <tr className="border-b border-slate-200">
                      <td
                        colSpan={2}
                        className="sticky left-0 z-10 bg-slate-100 px-3 py-1.5 font-sans font-bold text-slate-700 border-r border-slate-300"
                      >
                        &Sigma; Perawat Dinas Pagi
                      </td>
                      {dailyNurseTotals.map((t) => (
                        <td
                          key={t.isoDate}
                          className={`py-1.5 text-center font-bold border-r border-slate-200 ${
                            t.isSunday
                              ? 'text-slate-400 bg-rose-50/40'
                              : t.pagi >= 5
                              ? 'text-sky-800 bg-sky-50/50'
                              : 'text-amber-700 bg-amber-50/60'
                          }`}
                        >
                          {t.pagi}
                        </td>
                      ))}
                      <td colSpan={6} className="bg-slate-100" />
                    </tr>

                    <tr className="border-b border-slate-200">
                      <td
                        colSpan={2}
                        className="sticky left-0 z-10 bg-slate-100 px-3 py-1.5 font-sans font-bold text-slate-700 border-r border-slate-300"
                      >
                        &Sigma; Perawat Dinas Siang
                      </td>
                      {dailyNurseTotals.map((t) => (
                        <td
                          key={t.isoDate}
                          className={`py-1.5 text-center font-bold border-r border-slate-200 ${
                            t.isSunday
                              ? 'text-slate-400 bg-rose-50/40'
                              : t.siang >= 5
                              ? 'text-amber-900 bg-amber-50/40'
                              : 'text-rose-700 bg-rose-50/50'
                          }`}
                        >
                          {t.siang}
                        </td>
                      ))}
                      <td colSpan={6} className="bg-slate-100" />
                    </tr>

                    <tr>
                      <td
                        colSpan={2}
                        className="sticky left-0 z-10 bg-slate-100 px-3 py-1.5 font-sans font-bold text-slate-700 border-r border-slate-300"
                      >
                        Kelengkapan PJ (P/S) &amp; On-Call
                      </td>
                      {dailyNurseTotals.map((t) => {
                        const okWorkday = t.hasPjPagi && t.hasPjSiang;
                        const okSunday = t.isSunday && t.onCall > 0;
                        return (
                          <td
                            key={t.isoDate}
                            title={
                              t.isSunday
                                ? `Minggu: ${t.onCall} Perawat On-Call Cito`
                                : `PJ Pagi: ${t.hasPjPagi ? 'Ada' : 'Belum'}, PJ Siang: ${
                                    t.hasPjSiang ? 'Ada' : 'Belum'
                                  }`
                            }
                            className={`py-1.5 text-center font-bold border-r border-slate-200 ${
                              t.isSunday
                                ? okSunday
                                  ? 'text-teal-700 bg-teal-50/50'
                                  : 'text-slate-400 bg-rose-50/40'
                                : okWorkday
                                ? 'text-emerald-700 bg-emerald-50/40'
                                : 'text-amber-700 bg-amber-50/60'
                            }`}
                          >
                            {t.isSunday
                              ? t.onCall > 0
                                ? `${t.onCall}OC`
                                : '-'
                              : okWorkday
                              ? 'P+S'
                              : t.hasPjPagi
                              ? 'P!'
                              : t.hasPjSiang
                              ? '!S'
                              : '-'}
                          </td>
                        );
                      })}
                      <td colSpan={6} className="bg-slate-100" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              /* =============================================================== */
              /* 2. MATRIKS BULANAN DOKTER GRID (DPJP & DOKTER JAGA)             */
              /* =============================================================== */
              <div
                className="overflow-x-auto select-none"
                onMouseLeave={() => setIsDraggingPaint(false)}
              >
                <table className="w-full border-collapse text-[11px] tabular-nums">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700 border-b border-slate-300">
                      <th className="sticky left-0 z-20 bg-slate-100 p-2 w-9 min-w-[36px] text-center font-extrabold border-r border-slate-200">
                        No
                      </th>
                      <th className="sticky left-9 z-20 bg-slate-100 px-3 py-2 min-w-[235px] max-w-[260px] text-left font-extrabold border-r border-slate-300 shadow-[2px_0_4px_-2px_rgba(15,23,42,0.12)]">
                        Nama Dokter &amp; Kategori Peran
                      </th>
                      {monthDays.map((d) => {
                        const isToday = d.isoDate === activeReferenceIso;
                        return (
                          <th
                            key={d.isoDate}
                            className={`px-0.5 py-1.5 min-w-[36px] w-[36px] text-center border-r border-slate-200/90 ${
                              isToday
                                ? 'bg-blue-100/90 text-blue-950'
                                : d.isSunday
                                ? 'bg-rose-50/90 text-rose-700'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                            title={formatIsoDateToIndonesianFull(d.isoDate)}
                          >
                            <div className="font-mono font-extrabold text-[11px] leading-tight">
                              {String(d.day).padStart(2, '0')}
                            </div>
                            <div
                              className={`text-[9.5px] font-bold leading-tight ${
                                isToday
                                  ? 'text-blue-800'
                                  : d.isSunday
                                  ? 'text-rose-600'
                                  : 'text-slate-500'
                              }`}
                            >
                              {d.dayShort}
                            </div>
                          </th>
                        );
                      })}
                      {/* Individual Monthly Summary Columns */}
                      <th
                        className="px-1.5 py-2 min-w-[34px] text-center font-extrabold bg-sky-50/90 text-sky-900 border-l border-r border-slate-200"
                        title="Total Jaga / Visite Pagi"
                      >
                        P
                      </th>
                      <th
                        className="px-1.5 py-2 min-w-[34px] text-center font-extrabold bg-amber-50/90 text-amber-900 border-r border-slate-200"
                        title="Total Jaga / Visite Siang"
                      >
                        S
                      </th>
                      <th
                        className="px-1.5 py-2 min-w-[34px] text-center font-extrabold bg-blue-50/90 text-blue-900 border-r border-slate-200"
                        title="Total Jaga Seharian (Pagi & Siang)"
                      >
                        PS
                      </th>
                      <th
                        className="px-1.5 py-2 min-w-[38px] text-center font-extrabold bg-teal-50/90 text-teal-900 border-r border-slate-200"
                        title="Total On-Call Konsulen / Cito"
                      >
                        OC
                      </th>
                      <th
                        className="px-1.5 py-2 min-w-[34px] text-center font-extrabold bg-slate-100 text-slate-600 border-r border-slate-200"
                        title="Total Hari Libur / Off"
                      >
                        L
                      </th>
                      <th
                        className="px-2 py-2 min-w-[44px] text-center font-extrabold bg-slate-200/80 text-slate-900"
                        title="Total Hari Tugas Aktif Bulan Ini"
                      >
                        &Sigma;
                      </th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-slate-200">
                    {filteredDoctors.length === 0 ? (
                      <tr>
                        <td
                          colSpan={monthDays.length + 8}
                          className="p-8 text-center text-xs text-slate-500"
                        >
                          Tidak ada dokter yang sesuai dengan pencarian.
                        </td>
                      </tr>
                    ) : (
                      filteredDoctors.map((doc, idx) => {
                        const stat = computeDoctorMonthlyStat(
                          doc,
                          monthDays,
                          monthDoctorSchedules
                        );
                        const isDpjp = doc.role === 'dpjp' || doc.role === 'both';
                        const roleLabel =
                          doc.role === 'dpjp'
                            ? 'Dokter DPJP'
                            : doc.role === 'both'
                            ? 'DPJP & Jaga'
                            : 'Dokter Jaga Ruangan';
                        const rowBg = idx % 2 === 1 ? 'bg-slate-50/60' : 'bg-white';
                        const stickyBg = idx % 2 === 1 ? 'bg-slate-50' : 'bg-white';

                        return (
                          <tr key={doc.id} className={`${rowBg} hover:bg-blue-50/25`}>
                            <td
                              className={`sticky left-0 z-10 ${stickyBg} p-1.5 text-center font-mono font-bold text-slate-400 border-r border-slate-200`}
                            >
                              {idx + 1}
                            </td>

                            <td
                              className={`sticky left-9 z-10 ${stickyBg} px-3 py-1.5 border-r border-slate-300 shadow-[2px_0_4px_-2px_rgba(15,23,42,0.08)]`}
                            >
                              <div className="font-bold text-[11.5px] text-slate-900 truncate max-w-[230px]">
                                {doc.name}
                              </div>
                              <div className="text-[10px] flex items-center gap-1.5 truncate">
                                <span
                                  className={`font-bold ${
                                    isDpjp ? 'text-blue-700' : 'text-emerald-700'
                                  }`}
                                >
                                  {roleLabel}
                                </span>
                                {doc.phone && (
                                  <>
                                    <span className="text-slate-300">&middot;</span>
                                    <span className="font-mono text-slate-400">{doc.phone}</span>
                                  </>
                                )}
                              </div>
                            </td>

                            {monthDays.map((calDay) => {
                              const entry = getDoctorEntry(doc, calDay.isoDate);
                              const code = entryToDoctorMatrixCode(entry);
                              const meta = getDoctorCodeMeta(code);
                              const dayLabel = `${calDay.day} ${monthName} ${selectedYear}`;
                              const hasCustomNote = Boolean(entry?.notes);

                              return (
                                <td
                                  key={calDay.isoDate}
                                  className={`p-0.5 text-center border-r border-slate-200/80 ${
                                    calDay.isoDate === activeReferenceIso
                                      ? 'bg-blue-50/50'
                                      : calDay.isSunday
                                      ? 'bg-rose-50/35'
                                      : ''
                                  }`}
                                >
                                  <button
                                    type="button"
                                    disabled={!canEditMatrix}
                                    onMouseDown={(e) => {
                                      if (e.button !== 0) return;
                                      if (interactionMode === 'brush') {
                                        setIsDraggingPaint(true);
                                      }
                                      handleDoctorCellActivate(
                                        doc,
                                        calDay.isoDate,
                                        dayLabel,
                                        false
                                      );
                                    }}
                                    onMouseEnter={() => {
                                      if (isDraggingPaint && interactionMode === 'brush') {
                                        handleDoctorCellActivate(
                                          doc,
                                          calDay.isoDate,
                                          dayLabel,
                                          true
                                        );
                                      }
                                    }}
                                    onContextMenu={(e) => {
                                      if (!canEditMatrix) return;
                                      e.preventDefault();
                                      openDoctorCellDetail(doc, calDay.isoDate, dayLabel);
                                    }}
                                    title={`${doc.name} · ${calDay.dayFull}, ${dayLabel} · ${meta.label}${
                                      entry?.notes ? ` (${entry.notes})` : ''
                                    }`}
                                    className={`relative w-full h-7 rounded-md border font-mono text-[10px] font-bold flex items-center justify-center transition-colors ${
                                      meta.cellClass
                                    } ${canEditMatrix ? 'cursor-pointer' : 'cursor-default'}`}
                                  >
                                    <span>{code === '-' ? '·' : code}</span>
                                    {hasCustomNote && (
                                      <span className="absolute top-0.5 right-0.5 w-1 h-1 rounded-full bg-current opacity-65" />
                                    )}
                                  </button>
                                </td>
                              );
                            })}

                            {/* Recap Cells */}
                            <td className="px-1 py-1.5 text-center font-mono font-bold text-sky-800 bg-sky-50/40 border-l border-r border-slate-200">
                              {stat.pagiCount}
                            </td>
                            <td className="px-1 py-1.5 text-center font-mono font-bold text-amber-800 bg-amber-50/40 border-r border-slate-200">
                              {stat.siangCount}
                            </td>
                            <td className="px-1 py-1.5 text-center font-mono font-bold text-blue-800 bg-blue-50/40 border-r border-slate-200">
                              {stat.allDayCount || '-'}
                            </td>
                            <td className="px-1 py-1.5 text-center font-mono font-semibold text-teal-800 bg-teal-50/30 border-r border-slate-200">
                              {stat.onCallCount || '-'}
                            </td>
                            <td className="px-1 py-1.5 text-center font-mono text-slate-500 bg-slate-50/60 border-r border-slate-200">
                              {stat.liburCount}
                            </td>
                            <td className="px-1.5 py-1.5 text-center font-mono font-extrabold text-slate-900 bg-slate-100/80">
                              {stat.activeDutyDays}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>

                  {/* Daily Doctor Coverage Recap Footer */}
                  <tfoot className="border-t-2 border-slate-300 bg-slate-50 text-[10.5px] font-mono">
                    <tr className="border-b border-slate-200">
                      <td
                        colSpan={2}
                        className="sticky left-0 z-10 bg-slate-100 px-3 py-1.5 font-sans font-bold text-slate-700 border-r border-slate-300"
                      >
                        &Sigma; Dokter DPJP Aktif / Konsulen
                      </td>
                      {dailyDoctorTotals.map((t) => (
                        <td
                          key={t.isoDate}
                          className={`py-1.5 text-center font-bold border-r border-slate-200 ${
                            t.dpjpAktif >= 1
                              ? 'text-blue-800 bg-blue-50/40'
                              : 'text-amber-700 bg-amber-50/50'
                          }`}
                        >
                          {t.dpjpAktif}
                        </td>
                      ))}
                      <td colSpan={6} className="bg-slate-100" />
                    </tr>

                    <tr className="border-b border-slate-200">
                      <td
                        colSpan={2}
                        className="sticky left-0 z-10 bg-slate-100 px-3 py-1.5 font-sans font-bold text-slate-700 border-r border-slate-300"
                      >
                        &Sigma; dr. Jaga Ruangan Pagi
                      </td>
                      {dailyDoctorTotals.map((t) => (
                        <td
                          key={t.isoDate}
                          className={`py-1.5 text-center font-bold border-r border-slate-200 ${
                            t.isSunday
                              ? 'text-slate-400 bg-rose-50/40'
                              : t.jagaPagi >= 1
                              ? 'text-sky-800 bg-sky-50/40'
                              : 'text-amber-700 bg-amber-50/50'
                          }`}
                        >
                          {t.jagaPagi}
                        </td>
                      ))}
                      <td colSpan={6} className="bg-slate-100" />
                    </tr>

                    <tr className="border-b border-slate-200">
                      <td
                        colSpan={2}
                        className="sticky left-0 z-10 bg-slate-100 px-3 py-1.5 font-sans font-bold text-slate-700 border-r border-slate-300"
                      >
                        &Sigma; dr. Jaga Ruangan Siang
                      </td>
                      {dailyDoctorTotals.map((t) => (
                        <td
                          key={t.isoDate}
                          className={`py-1.5 text-center font-bold border-r border-slate-200 ${
                            t.isSunday
                              ? 'text-slate-400 bg-rose-50/40'
                              : t.jagaSiang >= 1
                              ? 'text-amber-900 bg-amber-50/40'
                              : 'text-rose-700 bg-rose-50/50'
                          }`}
                        >
                          {t.jagaSiang}
                        </td>
                      ))}
                      <td colSpan={6} className="bg-slate-100" />
                    </tr>

                    <tr>
                      <td
                        colSpan={2}
                        className="sticky left-0 z-10 bg-slate-100 px-3 py-1.5 font-sans font-bold text-slate-700 border-r border-slate-300"
                      >
                        &Sigma; Dokter On-Call (Cito)
                      </td>
                      {dailyDoctorTotals.map((t) => (
                        <td
                          key={t.isoDate}
                          className="py-1.5 text-center font-bold text-teal-800 bg-teal-50/30 border-r border-slate-200"
                        >
                          {t.onCall}
                        </td>
                      ))}
                      <td colSpan={6} className="bg-slate-100" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {/* Legend Bar */}
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-[11px] text-slate-600">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                <span className="font-extrabold text-slate-800">Keterangan Kode Matriks:</span>
                {(matrixTab === 'perawat' ? NURSE_MATRIX_PALETTE : DOCTOR_MATRIX_PALETTE)
                  .filter((p) => p.code !== '-')
                  .map((item) => (
                    <span key={item.code} className="inline-flex items-center gap-1.5">
                      <span
                        className={`px-1.5 py-0.5 rounded border font-mono text-[10px] font-bold ${item.cellClass}`}
                      >
                        {item.code}
                      </span>
                      <span>{item.label}</span>
                    </span>
                  ))}
              </div>
              <span className="text-[10.5px] text-slate-500">
                Perubahan tersimpan otomatis &amp; tersinkronisasi lintas akun unit HD.
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ===================================================================== */}
      {/* CELL DETAIL & NOTES MODAL                                             */}
      {/* ===================================================================== */}
      {detailModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/55 backdrop-blur-xs flex items-center justify-center p-4 print:hidden">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 bg-slate-900 text-white flex items-center justify-between">
              <div>
                <div className="text-[10.5px] font-semibold text-sky-300">
                  Detail Sel Matriks Bulanan &middot; {detailModal.dayLabel}
                </div>
                <h3 className="text-sm font-extrabold mt-0.5">
                  {detailModal.kind === 'perawat'
                    ? detailModal.nurse?.name
                    : detailModal.doctor?.name}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setDetailModal(null)}
                className="p-1 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 cursor-pointer"
                aria-label="Tutup modal"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveDetailModal} className="p-5 space-y-4">
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-700">
                  Pilih Kode Shift pada Tanggal Ini
                </label>
                {detailModal.kind === 'perawat' ? (
                  <div className="grid grid-cols-3 gap-2">
                    {NURSE_MATRIX_PALETTE.map((item) => {
                      const active = detailModal.nurseCode === item.code;
                      return (
                        <button
                          key={item.code}
                          type="button"
                          onClick={() =>
                            setDetailModal((prev) =>
                              prev ? { ...prev, nurseCode: item.code } : prev
                            )
                          }
                          className={`p-2 rounded-xl border text-left transition-all cursor-pointer ${
                            active
                              ? `${item.brushClass} shadow-xs`
                              : 'bg-slate-50 hover:bg-slate-100 text-slate-800 border-slate-200'
                          }`}
                        >
                          <div className="font-mono text-xs font-extrabold">{item.code}</div>
                          <div className="text-[10.5px] font-semibold truncate">
                            {item.label}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {DOCTOR_MATRIX_PALETTE.map((item) => {
                      const active = detailModal.doctorCode === item.code;
                      return (
                        <button
                          key={item.code}
                          type="button"
                          onClick={() =>
                            setDetailModal((prev) =>
                              prev ? { ...prev, doctorCode: item.code } : prev
                            )
                          }
                          className={`p-2 rounded-xl border text-left transition-all cursor-pointer ${
                            active
                              ? `${item.brushClass} shadow-xs`
                              : 'bg-slate-50 hover:bg-slate-100 text-slate-800 border-slate-200'
                          }`}
                        >
                          <div className="font-mono text-xs font-extrabold">{item.code}</div>
                          <div className="text-[10.5px] font-semibold truncate">
                            {item.label}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700">
                  Catatan Penugasan / Zonasi (Opsional)
                </label>
                <input
                  type="text"
                  value={detailModal.notes}
                  onChange={(e) =>
                    setDetailModal((prev) =>
                      prev ? { ...prev, notes: e.target.value } : prev
                    )
                  }
                  placeholder={
                    detailModal.kind === 'perawat'
                      ? 'Contoh: Zonasi Isolasi Hep B, Tukar Dinas, Cuti Tahunan...'
                      : 'Contoh: Visite Pagi & Evaluasi Kt/V, Konsulen On-Call...'
                  }
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-medium text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setDetailModal(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-xs font-bold cursor-pointer"
                >
                  Simpan Sel Matriks
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Spreadsheet Import Modal (Excel file upload, Copy-Paste, & Screenshot preset) */}
      <ImportNurseScheduleSpreadsheetModal
        isOpen={isImportSpreadsheetOpen}
        onClose={() => setIsImportSpreadsheetOpen(false)}
        selectedYear={selectedYear}
        selectedMonth={selectedMonth}
        masterNurses={orderedActiveNurses}
        existingSchedules={nurseSchedules}
        onApplySchedules={(updatedSchedules, summaryMessage) => {
          setNurseSchedules(updatedSchedules);
          showFeedback(summaryMessage, 'success');
        }}
      />

      {/* ===================================================================== */}
      {/* PRINTABLE A4 LANDSCAPE OFFICIAL SHEET (Shown ONLY in @media print)    */}
      {/* Uses pure <td>/<span> (zero <button>) so print CSS renders every cell */}
      {/* ===================================================================== */}
      <div id="printable-jadwal-sheet" className="printable-sheet hidden print:block text-black bg-white">
        <div className="border-b-2 border-slate-900 pb-2 mb-2.5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <RshlLogo className="w-36 h-auto" />
            <div>
              <div className="text-[11px] font-extrabold uppercase tracking-wider text-slate-900">
                {shiftInfo.hospitalName || 'RS Happy Land Medical Centre Yogyakarta'}
              </div>
              <div className="text-sm font-black uppercase text-slate-950">
                {matrixTab === 'perawat'
                  ? `MATRIKS JADWAL DINAS BULANAN PERAWAT - ${shiftInfo.unitName || 'INSTALASI HEMODIALISA'}`
                  : `MATRIKS JADWAL BULANAN DOKTER (DPJP & DOKTER JAGA) - ${shiftInfo.unitName || 'INSTALASI HEMODIALISA'}`}
              </div>
            </div>
          </div>
          <div className="text-right text-[10px] font-bold tabular-nums">
            <div>
              Periode: <span className="uppercase">{monthName} {selectedYear}</span>
            </div>
            <div>Standar Akreditasi KARS &amp; PERNEFRI</div>
          </div>
        </div>

        {matrixTab === 'perawat' ? (
          <table className="w-full border-collapse border border-slate-800 text-[8.5px] tabular-nums">
            <thead>
              <tr className="bg-slate-100">
                <th className="border border-slate-700 px-1 py-1 text-center w-6">No</th>
                <th className="border border-slate-700 px-1.5 py-1 text-left min-w-[130px]">
                  Nama Perawat
                </th>
                <th className="border border-slate-700 px-1 py-1 text-center w-16">Jabatan</th>
                {monthDays.map((d) => (
                  <th
                    key={d.isoDate}
                    className={`border border-slate-700 px-0.5 py-0.5 text-center ${
                      d.isSunday ? 'bg-rose-50 text-rose-900' : ''
                    }`}
                  >
                    <div className="font-mono font-bold">{d.day}</div>
                    <div className="text-[7px]">{d.dayShort}</div>
                  </th>
                ))}
                <th className="border border-slate-700 px-1 py-1 text-center">P</th>
                <th className="border border-slate-700 px-1 py-1 text-center">S</th>
                <th className="border border-slate-700 px-1 py-1 text-center">PJ</th>
                <th className="border border-slate-700 px-1 py-1 text-center">OC</th>
                <th className="border border-slate-700 px-1 py-1 text-center">L/CT</th>
                <th className="border border-slate-700 px-1 py-1 text-center">&Sigma;</th>
              </tr>
            </thead>
            <tbody>
              {orderedActiveNurses.map((nurse, idx) => {
                const stat = computeNurseMonthlyStat(nurse, monthDays, monthNurseSchedules);
                const roleShort =
                  nurse.role === 'kepala_ruangan'
                    ? 'Ka. Ruang'
                    : nurse.role === 'pj_shift'
                    ? 'PJ Shift'
                    : 'Pelaksana';
                return (
                  <tr key={nurse.id}>
                    <td className="border border-slate-700 px-1 py-0.5 text-center font-mono">
                      {idx + 1}
                    </td>
                    <td className="border border-slate-700 px-1.5 py-0.5 font-semibold">
                      {nurse.name}
                    </td>
                    <td className="border border-slate-700 px-1 py-0.5 text-center">
                      {roleShort}
                    </td>
                    {monthDays.map((d) => {
                      const code = entryToNurseMatrixCode(getNurseEntry(nurse, d.isoDate));
                      const meta = getNurseCodeMeta(code);
                      return (
                        <td
                          key={d.isoDate}
                          className={`border border-slate-700 px-0.5 py-0.5 text-center font-mono ${meta.printTextClass}`}
                        >
                          {code}
                        </td>
                      );
                    })}
                    <td className="border border-slate-700 px-1 py-0.5 text-center font-mono font-bold">
                      {stat.pagiCount}
                    </td>
                    <td className="border border-slate-700 px-1 py-0.5 text-center font-mono font-bold">
                      {stat.siangCount}
                    </td>
                    <td className="border border-slate-700 px-1 py-0.5 text-center font-mono font-bold">
                      {stat.pjCount || '-'}
                    </td>
                    <td className="border border-slate-700 px-1 py-0.5 text-center font-mono">
                      {stat.onCallOrMalamCount || '-'}
                    </td>
                    <td className="border border-slate-700 px-1 py-0.5 text-center font-mono">
                      {stat.liburOrCutiCount}
                    </td>
                    <td className="border border-slate-700 px-1 py-0.5 text-center font-mono font-extrabold">
                      {stat.activeWorkDays}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100 font-bold">
                <td colSpan={3} className="border border-slate-700 px-1.5 py-0.5">
                  Total Perawat Dinas Pagi
                </td>
                {dailyNurseTotals.map((t) => (
                  <td
                    key={t.isoDate}
                    className="border border-slate-700 px-0.5 py-0.5 text-center font-mono"
                  >
                    {t.pagi}
                  </td>
                ))}
                <td colSpan={6} className="border border-slate-700" />
              </tr>
              <tr className="bg-slate-100 font-bold">
                <td colSpan={3} className="border border-slate-700 px-1.5 py-0.5">
                  Total Perawat Dinas Siang
                </td>
                {dailyNurseTotals.map((t) => (
                  <td
                    key={t.isoDate}
                    className="border border-slate-700 px-0.5 py-0.5 text-center font-mono"
                  >
                    {t.siang}
                  </td>
                ))}
                <td colSpan={6} className="border border-slate-700" />
              </tr>
            </tfoot>
          </table>
        ) : (
          <table className="w-full border-collapse border border-slate-800 text-[8.5px] tabular-nums">
            <thead>
              <tr className="bg-slate-100">
                <th className="border border-slate-700 px-1 py-1 text-center w-6">No</th>
                <th className="border border-slate-700 px-1.5 py-1 text-left min-w-[155px]">
                  Nama Dokter
                </th>
                <th className="border border-slate-700 px-1 py-1 text-center w-20">Peran</th>
                {monthDays.map((d) => (
                  <th
                    key={d.isoDate}
                    className={`border border-slate-700 px-0.5 py-0.5 text-center ${
                      d.isSunday ? 'bg-rose-50 text-rose-900' : ''
                    }`}
                  >
                    <div className="font-mono font-bold">{d.day}</div>
                    <div className="text-[7px]">{d.dayShort}</div>
                  </th>
                ))}
                <th className="border border-slate-700 px-1 py-1 text-center">P</th>
                <th className="border border-slate-700 px-1 py-1 text-center">S</th>
                <th className="border border-slate-700 px-1 py-1 text-center">PS</th>
                <th className="border border-slate-700 px-1 py-1 text-center">OC</th>
                <th className="border border-slate-700 px-1 py-1 text-center">L</th>
                <th className="border border-slate-700 px-1 py-1 text-center">&Sigma;</th>
              </tr>
            </thead>
            <tbody>
              {orderedActiveDoctors.map((doc, idx) => {
                const stat = computeDoctorMonthlyStat(doc, monthDays, monthDoctorSchedules);
                const roleLabel =
                  doc.role === 'dpjp'
                    ? 'DPJP'
                    : doc.role === 'both'
                    ? 'DPJP/Jaga'
                    : 'dr. Jaga';
                return (
                  <tr key={doc.id}>
                    <td className="border border-slate-700 px-1 py-0.5 text-center font-mono">
                      {idx + 1}
                    </td>
                    <td className="border border-slate-700 px-1.5 py-0.5 font-semibold">
                      {doc.name}
                    </td>
                    <td className="border border-slate-700 px-1 py-0.5 text-center">
                      {roleLabel}
                    </td>
                    {monthDays.map((d) => {
                      const code = entryToDoctorMatrixCode(getDoctorEntry(doc, d.isoDate));
                      const meta = getDoctorCodeMeta(code);
                      return (
                        <td
                          key={d.isoDate}
                          className={`border border-slate-700 px-0.5 py-0.5 text-center font-mono ${meta.printTextClass}`}
                        >
                          {code}
                        </td>
                      );
                    })}
                    <td className="border border-slate-700 px-1 py-0.5 text-center font-mono font-bold">
                      {stat.pagiCount}
                    </td>
                    <td className="border border-slate-700 px-1 py-0.5 text-center font-mono font-bold">
                      {stat.siangCount}
                    </td>
                    <td className="border border-slate-700 px-1 py-0.5 text-center font-mono font-bold">
                      {stat.allDayCount || '-'}
                    </td>
                    <td className="border border-slate-700 px-1 py-0.5 text-center font-mono">
                      {stat.onCallCount || '-'}
                    </td>
                    <td className="border border-slate-700 px-1 py-0.5 text-center font-mono">
                      {stat.liburCount}
                    </td>
                    <td className="border border-slate-700 px-1 py-0.5 text-center font-mono font-extrabold">
                      {stat.activeDutyDays}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-slate-100 font-bold">
                <td colSpan={3} className="border border-slate-700 px-1.5 py-0.5">
                  Total DPJP Aktif
                </td>
                {dailyDoctorTotals.map((t) => (
                  <td
                    key={t.isoDate}
                    className="border border-slate-700 px-0.5 py-0.5 text-center font-mono"
                  >
                    {t.dpjpAktif}
                  </td>
                ))}
                <td colSpan={6} className="border border-slate-700" />
              </tr>
              <tr className="bg-slate-100 font-bold">
                <td colSpan={3} className="border border-slate-700 px-1.5 py-0.5">
                  Total dr. Jaga Pagi / Siang
                </td>
                {dailyDoctorTotals.map((t) => (
                  <td
                    key={t.isoDate}
                    className="border border-slate-700 px-0.5 py-0.5 text-center font-mono"
                  >
                    {t.jagaPagi}/{t.jagaSiang}
                  </td>
                ))}
                <td colSpan={6} className="border border-slate-700" />
              </tr>
            </tfoot>
          </table>
        )}

        <div className="mt-2.5 flex items-start justify-between text-[9px] print-avoid-break">
          <div className="space-y-0.5 max-w-xl">
            <div className="font-bold">Keterangan Kode Shift:</div>
            {matrixTab === 'perawat' ? (
              <div>
                P = Dinas Pagi (07.00-14.00) &middot; PJ-P = PJ Shift Pagi &middot; S = Dinas Siang (14.00-21.00) &middot; PJ-S = PJ Shift Siang &middot; OC = On-Call Cito &middot; M = Malam &middot; L = Libur &middot; CT = Cuti
              </div>
            ) : (
              <div>
                P = Jaga/Visite Pagi &middot; S = Jaga/Visite Siang &middot; PS = Seharian (Pagi &amp; Siang) &middot; OC = On-Call Konsulen &middot; L = Libur/Off
              </div>
            )}
          </div>
          <div className="text-center min-w-[200px]">
            <div>Yogyakarta, {monthName} {selectedYear}</div>
            <div className="font-bold">Kepala Ruangan Instalasi Hemodialisa</div>
            <div className="h-10" />
            <div className="font-extrabold underline">
              {shiftInfo.kepalaRuangan || 'TWIS FERTILIANTI PW, S.Kep., Ns.'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
