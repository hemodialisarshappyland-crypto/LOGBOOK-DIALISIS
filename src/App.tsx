/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import {
  PatientHDSession,
  ShiftInfo,
  MachineOverview,
  OperationalItem,
  SbarData,
  ShiftSignatures,
  MasterPatient,
  MasterNurse,
  MasterBed,
  MasterDoctor,
  NurseScheduleEntry,
  DoctorScheduleEntry,
  SystemAccessRole,
  HdTreatmentDay
} from './types/dialysis.ts';
import {
  initialShiftInfo,
  initialMachineOverview,
  initialOperationalItems,
  initialSbar,
  initialPatients,
  benchmarkShiftInfo,
  benchmarkMachineOverview,
  benchmarkSamplePatients
} from './data/mockShiftData.ts';
import {
  initialMasterPatients,
  initialMasterNurses,
  initialMasterBeds,
  initialMasterDoctors,
  sampleBenchmarkPatients,
  sampleBenchmarkNurses,
  sampleBenchmarkBeds
} from './data/mockMasterData.ts';
import {
  initialNurseSchedules,
  initialDoctorSchedules,
  ensureAllOfficialDoctorSchedules
} from './data/mockScheduleData.ts';
import {
  resolveNurseMatrixShiftForDate,
  resolvePjShiftEntryFromMatrix,
  resolveScheduledDoctorsFromMatrix,
  mergeNurseSchedules,
  mergeDoctorSchedules
} from './utils/monthlyScheduleMatrixHelpers.ts';
import {
  computeCensusAndAccess,
  computeClinicalIndicators
} from './utils/hdCalculator.ts';
import {
  calculateStaffingDetails,
  canAccessMasterData,
  canVerifyLogbook,
  ensureAllOfficialDoctors,
  ensureAndDeduplicateMasterNurses,
  ensureAndDeduplicateMasterBeds,
  normalizeNurseName,
  filterMasterPatientsForActiveSchedule,
  getAccessibleTabs,
  getDefaultTabForRole,
  normalizeMasterPatient,
  resolveDoctorsFromSchedule,
  resolveNurseSystemAccess,
  updateMasterNurseData,
  updateMasterDoctorData
} from './utils/masterDataHelpers.ts';
import { ensureFullBagianData } from './utils/logbookStandards.ts';
import { AppShellLayout, HeaderNavTab } from './components/HeaderNavbar.tsx';
import { PelaksanaView } from './components/PelaksanaView.tsx';
import { LaporanPasienView } from './components/LaporanPasienView.tsx';
import { DashboardView } from './components/DashboardView.tsx';
import { LapHarianView } from './components/LapHarianView.tsx';
import { VerifikasiView } from './components/VerifikasiView.tsx';
import { RiwayatView } from './components/RiwayatView.tsx';
import { LapBulananView } from './components/LapBulananView.tsx';
import { JadwalDinasView } from './components/JadwalDinasView.tsx';
import { SessionModal } from './components/SessionModal.tsx';
import {
  testFirestoreConnection,
  subscribeToDialysisSessions,
  saveDialysisSessionCloud,
  deleteDialysisSessionCloud,
  subscribeToShiftReport,
  saveShiftReportCloud,
  subscribeToMasterPatients,
  saveMasterPatientsCloud,
  subscribeToMasterNurses,
  saveMasterNursesCloud,
  deleteMasterNurseCloud,
  subscribeToMasterBeds,
  saveMasterBedsCloud,
  deleteMasterBedCloud,
  subscribeToMasterDoctors,
  saveMasterDoctorsCloud,
  subscribeToNurseSchedules,
  saveNurseSchedulesCloud,
  subscribeToDoctorSchedules,
  saveDoctorSchedulesCloud,
  subscribeToVerificationRegistry,
  saveVerificationRegistryCloud,
  subscribeToAllNurseLogbooks,
  type NurseLogbookCloudData,
  isFirestoreQuotaExhausted
} from './services/firebase.ts';
import {
  VERIFICATION_REGISTRY_STORAGE_KEY,
  LogbookVerificationRegistryEntry,
  getVerificationRegistry,
  isMatchingNurse,
  isSameBed,
  isKepalaRuangVerifier,
  getNurseClinicalDetailsKey,
  getNursePatientStatusesKey,
  resetVerificationStorageToBenchmark,
  checkAndResetAllDailyLogbooksIfDayChanged
} from './utils/nurseVerificationHelpers.ts';
import {
  DEFAULT_KEPALA_RUANGAN_NAME,
  aggregateShiftVerifiedLogbooks
} from './utils/dailyReportHelpers.ts';
import { SystemDesignExplainerModal } from './components/SystemDesignExplainerModal.tsx';
import { PrintHelpModal } from './components/PrintHelpModal.tsx';
import { MasterDataManagementModal } from './components/MasterDataManagementModal.tsx';
import { MasterDataView } from './components/MasterDataView.tsx';
import { MyAccountView } from './components/MyAccountView.tsx';
import { LoginPage, LoginUserData } from './components/LoginPage.tsx';
import { useCleanHospitalBackground } from './utils/useCleanHospitalBackground.ts';
import {
  extractActiveDayName,
  formatCurrentWibTimestamp,
  formatIsoDateToIndonesianFull,
  formatShortIndonesianTimestampWib,
  getCurrentIndonesianFullDate,
  getCurrentIsoDateWib,
  indonesianDateLabelToIso
} from './utils/dateHelpers.ts';
import { ManagedPatient, PjVerificationStatus } from './components/Logbook5ButtonsView.tsx';
import {
  PatientLogbookClinicalDetails,
  isPoin3_6Complete,
  normalizePatientClinicalDetails,
  parseClinicalNumber,
  resolveSessionAccessFromPoin3_6,
  resolveSessionComplicationsFromPoin4_3
} from './utils/logbookClinicalHelpers.ts';

function loadPersistedArray<T>(key: string, fallback: T[]): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed as T[];
      }
    }
  } catch {
    // ignore corrupt localStorage
  }
  return fallback;
}

export default function App() {
  const {
    bgSrc: hospitalBgSrc,
    hasError: hospitalBgError,
    onImageError: handleHospitalBgError
  } = useCleanHospitalBackground();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [loggedInUser, setLoggedInUser] = useState<LoginUserData | null>(null);
  const [userRole, setUserRole] = useState<SystemAccessRole>('perawat_pelaksana');
  const [, setActiveRole] = useState<'pelaksana' | 'pj_shift'>('pelaksana');
  const [currentTab, setCurrentTab] = useState<HeaderNavTab>('dashboard');
  const [scheduleMatrixTab, setScheduleMatrixTab] = useState<'perawat' | 'dokter'>('perawat');
  const [isCloudConnected, setIsCloudConnected] = useState<boolean>(
    () => !isFirestoreQuotaExhausted()
  );
  const [isQuotaExceeded, setIsQuotaExceeded] = useState<boolean>(() =>
    isFirestoreQuotaExhausted()
  );

  useEffect(() => {
    const handleQuotaChange = (e: any) => {
      const exhausted = Boolean(e?.detail?.exhausted ?? isFirestoreQuotaExhausted());
      setIsQuotaExceeded(exhausted);
      if (exhausted) {
        setIsCloudConnected(false);
      }
    };
    window.addEventListener('firestore_quota_state_change', handleQuotaChange);
    return () => window.removeEventListener('firestore_quota_state_change', handleQuotaChange);
  }, []);

  const [printHelpState, setPrintHelpState] = useState<{
    isOpen: boolean;
    documentTitle?: string;
    errorMessage?: string;
  }>({
    isOpen: false
  });

  useEffect(() => {
    const handlePrintBlocked = (e: any) => {
      setPrintHelpState({
        isOpen: true,
        documentTitle: e?.detail?.documentTitle,
        errorMessage: e?.detail?.error
      });
    };
    window.addEventListener('dialysis_print_blocked', handlePrintBlocked);
    return () => window.removeEventListener('dialysis_print_blocked', handlePrintBlocked);
  }, []);

  const patientStorageKey = `master_patients_v6_${initialMasterPatients.length}`;
  const bedStorageKey = `master_beds_v6_${initialMasterBeds.length}`;

  // Master Data State persisted across sessions
  const [masterPatients, setMasterPatients] = useState<MasterPatient[]>(() => {
    try {
      const rawCurrent = localStorage.getItem(patientStorageKey);
      if (rawCurrent) {
        const parsedCurrent = JSON.parse(rawCurrent);
        if (Array.isArray(parsedCurrent) && parsedCurrent.length > 0) {
          return (parsedCurrent as MasterPatient[]).map(normalizeMasterPatient);
        }
      }

      // Find most recent previous master_patients_* storage to preserve edits & custom patients
      let legacyPatients: MasterPatient[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('master_patients_') && k !== patientStorageKey) {
          const rawLegacy = localStorage.getItem(k);
          if (rawLegacy) {
            const parsed = JSON.parse(rawLegacy);
            if (Array.isArray(parsed) && parsed.length > legacyPatients.length) {
              legacyPatients = parsed as MasterPatient[];
            }
          }
        }
      }

      if (legacyPatients.length > 0) {
        const legacyById = new Map(legacyPatients.map((p) => [p.id, p]));
        const merged = initialMasterPatients.map((seedPat) => legacyById.get(seedPat.id) || seedPat);
        const existingCustom = legacyPatients.filter((p) => !p.id?.startsWith('pat-hdhl-'));
        existingCustom.forEach((customPat) => {
          const duplicate = merged.some(
            (s) =>
              s.patientName.trim().toLowerCase() ===
                customPat.patientName.trim().toLowerCase() ||
              (customPat.medicalRecordNumber &&
                s.medicalRecordNumber === customPat.medicalRecordNumber)
          );
          if (!duplicate) {
            merged.push(customPat);
          }
        });
        return merged.map(normalizeMasterPatient);
      }
    } catch {
      // ignore corrupt localStorage
    }

    return initialMasterPatients.map(normalizeMasterPatient);
  });
  const [masterNurses, setMasterNurses] = useState<MasterNurse[]>(() => {
    try {
      localStorage.removeItem('master_nurses_v5');
      localStorage.removeItem('master_nurses_v6');
      const rawV8 = localStorage.getItem('master_nurses_v8_official');
      if (rawV8) {
        const parsed = JSON.parse(rawV8);
        if (Array.isArray(parsed) && parsed.length >= 17) {
          const { uniqueNurses, duplicateIdsRemoved } = ensureAndDeduplicateMasterNurses(parsed);
          duplicateIdsRemoved.forEach((dupId) => {
            deleteMasterNurseCloud(dupId).catch(() => {});
          });
          return uniqueNurses;
        }
      }

      const rawV7 = localStorage.getItem('master_nurses_v7');
      if (rawV7) {
        const parsedV7 = JSON.parse(rawV7);
        if (Array.isArray(parsedV7) && parsedV7.length > 0) {
          const { uniqueNurses, duplicateIdsRemoved } = ensureAndDeduplicateMasterNurses(parsedV7);
          duplicateIdsRemoved.forEach((dupId) => {
            deleteMasterNurseCloud(dupId).catch(() => {});
          });
          return uniqueNurses;
        }
      }
    } catch {
      // ignore corrupt localStorage
    }

    const { uniqueNurses } = ensureAndDeduplicateMasterNurses(initialMasterNurses);
    return uniqueNurses;
  });
  const [masterBeds, setMasterBeds] = useState<MasterBed[]>(() => {
    try {
      localStorage.removeItem('master_beds_v5');
      localStorage.removeItem('master_beds_v6_40');
      const rawV8 = localStorage.getItem('master_beds_v8_official');
      if (rawV8) {
        const parsed = JSON.parse(rawV8);
        if (Array.isArray(parsed) && parsed.length >= 40) {
          const { uniqueBeds, duplicateIdsRemoved } = ensureAndDeduplicateMasterBeds(parsed);
          duplicateIdsRemoved.forEach((dupId) => {
            deleteMasterBedCloud(dupId).catch(() => {});
          });
          return uniqueBeds;
        }
      }
      const rawCurrent = localStorage.getItem(bedStorageKey);
      if (rawCurrent) {
        const parsedCurrent = JSON.parse(rawCurrent);
        if (Array.isArray(parsedCurrent) && parsedCurrent.length > 0) {
          const { uniqueBeds, duplicateIdsRemoved } = ensureAndDeduplicateMasterBeds(parsedCurrent);
          duplicateIdsRemoved.forEach((dupId) => {
            deleteMasterBedCloud(dupId).catch(() => {});
          });
          return uniqueBeds;
        }
      }
    } catch {
      // ignore
    }
    const { uniqueBeds } = ensureAndDeduplicateMasterBeds(initialMasterBeds);
    return uniqueBeds;
  });

  useEffect(() => {
    try {
      localStorage.setItem(patientStorageKey, JSON.stringify(masterPatients));
    } catch {
      // ignore storage quota errors
    }
    saveMasterPatientsCloud(masterPatients).catch(() => {});
  }, [masterPatients, patientStorageKey]);

  useEffect(() => {
    try {
      localStorage.setItem('master_nurses_v8_official', JSON.stringify(masterNurses));
      localStorage.removeItem('master_nurses_v7');
    } catch {
      // ignore storage quota errors
    }
    saveMasterNursesCloud(masterNurses).catch(() => {});
  }, [masterNurses]);

  useEffect(() => {
    try {
      localStorage.setItem('master_beds_v8_official', JSON.stringify(masterBeds));
      localStorage.setItem(bedStorageKey, JSON.stringify(masterBeds));
    } catch {
      // ignore storage quota errors
    }
    saveMasterBedsCloud(masterBeds).catch(() => {});
  }, [masterBeds, bedStorageKey]);

  const [masterDoctors, setMasterDoctors] = useState<MasterDoctor[]>(() => {
    try {
      localStorage.removeItem('dialysis_master_doctors_v1');
      localStorage.removeItem('dialysis_master_doctors_v2');
      const persisted = localStorage.getItem('dialysis_master_doctors_v4_13');
      if (persisted) {
        const parsed = JSON.parse(persisted);
        if (Array.isArray(parsed) && parsed.length >= 13) {
          return ensureAllOfficialDoctors(parsed);
        }
      }
    } catch {
      // ignore
    }
    return ensureAllOfficialDoctors(initialMasterDoctors);
  });

  useEffect(() => {
    try {
      localStorage.setItem('dialysis_master_doctors_v4_13', JSON.stringify(masterDoctors));
    } catch {
      // ignore storage quota errors
    }
    saveMasterDoctorsCloud(masterDoctors).catch(() => {});
  }, [masterDoctors]);

  const [nurseSchedules, setNurseSchedules] = useState<NurseScheduleEntry[]>(() => {
    try {
      const primaryKey = 'dialysis_nurse_schedules_v2_monthly';
      const rawCurrent = localStorage.getItem(primaryKey);
      if (rawCurrent) {
        const parsed = JSON.parse(rawCurrent);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed as NurseScheduleEntry[];
        }
      }
      const legacyV1 = localStorage.getItem('dialysis_nurse_schedules_v1');
      if (legacyV1) {
        const parsedLegacy = JSON.parse(legacyV1);
        if (Array.isArray(parsedLegacy) && parsedLegacy.length > 0) {
          const merged = mergeNurseSchedules(initialNurseSchedules, parsedLegacy as NurseScheduleEntry[]);
          localStorage.setItem(primaryKey, JSON.stringify(merged));
          return merged;
        }
      }
    } catch {
      // ignore
    }
    return initialNurseSchedules;
  });

  const [doctorSchedules, setDoctorSchedules] = useState<DoctorScheduleEntry[]>(() => {
    try {
      const primaryKey = 'dialysis_doctor_schedules_v7_clean';
      const persistedMonthly = localStorage.getItem(primaryKey);
      if (persistedMonthly) {
        const parsed = JSON.parse(persistedMonthly);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed as DoctorScheduleEntry[];
        }
      }

      // Check legacy storage keys to recover previously entered doctor schedules
      const legacyKeys = [
        'dialysis_doctor_schedules_v5_monthly',
        'dialysis_doctor_schedules_v4_13',
        'dialysis_doctor_schedules_v2',
        'dialysis_doctor_schedules_v1'
      ];
      for (const key of legacyKeys) {
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            localStorage.setItem(primaryKey, JSON.stringify(parsed));
            return parsed as DoctorScheduleEntry[];
          }
        }
      }
    } catch {
      // ignore
    }
    return [];
  });

  // Debounced cloud save for Nurse Schedules (immediate localStorage, 800ms debounced Firestore write)
  useEffect(() => {
    try {
      localStorage.setItem('dialysis_nurse_schedules_v2_monthly', JSON.stringify(nurseSchedules));
    } catch {
      // ignore
    }
    const timer = setTimeout(() => {
      saveNurseSchedulesCloud(nurseSchedules).catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [nurseSchedules]);

  // Debounced cloud save for Doctor Schedules (immediate localStorage, 800ms debounced Firestore write)
  useEffect(() => {
    try {
      localStorage.setItem('dialysis_doctor_schedules_v7_clean', JSON.stringify(doctorSchedules));
    } catch {
      // ignore
    }
    const timer = setTimeout(() => {
      saveDoctorSchedulesCloud(doctorSchedules).catch(() => {});
    }, 800);
    return () => clearTimeout(timer);
  }, [doctorSchedules]);

  // Real-time Cloud Firestore sync for Master Nurses, Nurse & Doctor Schedules
  useEffect(() => {
    if (isFirestoreQuotaExhausted()) return;
    const unsubNurses = subscribeToMasterNurses((cloudNurses) => {
      if (Array.isArray(cloudNurses) && cloudNurses.length > 0) {
        const { uniqueNurses, duplicateIdsRemoved } = ensureAndDeduplicateMasterNurses(cloudNurses);
        if (duplicateIdsRemoved.length > 0) {
          duplicateIdsRemoved.forEach((dupId) => {
            deleteMasterNurseCloud(dupId).catch(() => {});
          });
        }
        setMasterNurses(uniqueNurses);
      }
    });
    const unsubN = subscribeToNurseSchedules((cloudSchedules) => {
      if (Array.isArray(cloudSchedules) && cloudSchedules.length > 0) {
        setNurseSchedules((prevLocal) => mergeNurseSchedules(prevLocal, cloudSchedules));
      }
    });
    const unsubD = subscribeToDoctorSchedules((cloudDocs) => {
      if (Array.isArray(cloudDocs) && cloudDocs.length > 0) {
        setDoctorSchedules((prevLocal) => mergeDoctorSchedules(prevLocal, cloudDocs));
      }
    });
    return () => {
      unsubNurses();
      unsubN();
      unsubD();
    };
  }, []);

  // Enforce strict RBAC tab access whenever userRole or currentTab changes
  const accessibleTabs = useMemo(() => getAccessibleTabs(userRole), [userRole]);

  useEffect(() => {
    if (!accessibleTabs.includes(currentTab)) {
      setCurrentTab(getDefaultTabForRole(userRole));
    }
  }, [accessibleTabs, currentTab, userRole]);

  const handleSelectTab = (tab: HeaderNavTab) => {
    const allowed = getAccessibleTabs(userRole);
    if (!allowed.includes(tab)) {
      setCurrentTab(getDefaultTabForRole(userRole));
      return;
    }
    setCurrentTab(tab);
    if (tab === 'dashboard' || tab === 'verifikasi' || tab === 'lap_harian') {
      setActiveRole('pj_shift');
    } else if (tab === 'logbook') {
      setActiveRole('pelaksana');
    }
  };

  const handleRoleChange = (newRole: SystemAccessRole) => {
    setUserRole(newRole);
    const allowed = getAccessibleTabs(newRole);
    if (!allowed.includes(currentTab)) {
      const nextDefault = getDefaultTabForRole(newRole);
      setCurrentTab(nextDefault);
      setActiveRole(nextDefault === 'logbook' ? 'pelaksana' : 'pj_shift');
    }
  };

  const handleLogin = (userData: LoginUserData) => {
    setIsAuthenticated(true);
    setLoggedInUser(userData);
    const role: SystemAccessRole = userData.userRole || 'perawat_pelaksana';
    setUserRole(role);
    const nextDefault = getDefaultTabForRole(role);
    setCurrentTab(nextDefault);
    setActiveRole(role === 'pj_shift' || role === 'kepala_ruangan' ? 'pj_shift' : 'pelaksana');

    const activeIso = isCustomDate
      ? indonesianDateLabelToIso(shiftInfo.date) || getCurrentIsoDateWib()
      : getCurrentIsoDateWib();
    const matrixSchedule = resolveNurseMatrixShiftForDate(
      nurseSchedules,
      { id: userData.nurseId, name: userData.name },
      activeIso
    );

    const normalizedShift: 'Pagi' | 'Siang' =
      matrixSchedule.logbookShift || (userData.shift === 'Siang' ? 'Siang' : 'Pagi');

    const matrixPj = resolvePjShiftEntryFromMatrix(
      nurseSchedules,
      masterNurses,
      activeIso,
      normalizedShift
    );
    const matchingShiftPj =
      masterNurses.find(
        (n) =>
          n.accountStatus !== 'nonaktif' &&
          resolveNurseSystemAccess(n) === 'pj_shift' &&
          n.shiftAssigned === normalizedShift &&
          n.isOnDutyToday
      ) ||
      masterNurses.find(
        (n) =>
          n.accountStatus !== 'nonaktif' &&
          resolveNurseSystemAccess(n) === 'pj_shift' &&
          n.shiftAssigned === normalizedShift
      );
    const karuNurse = masterNurses.find(
      (n) => n.accountStatus !== 'nonaktif' && resolveNurseSystemAccess(n) === 'kepala_ruangan'
    );

    const resolvedShiftHours =
      normalizedShift === 'Siang'
        ? 'Siang, jam 14.00 - 21.00 WIB'
        : 'Pagi, jam 07.00 - 14.00 WIB';

    const otherShift = normalizedShift === 'Pagi' ? 'Siang' : 'Pagi';
    const matrixNextPj = resolvePjShiftEntryFromMatrix(
      nurseSchedules,
      masterNurses,
      activeIso,
      otherShift
    );

    const matrixDocs = resolveScheduledDoctorsFromMatrix(
      doctorSchedules,
      activeIso,
      normalizedShift,
      masterDoctors
    );

    setLoggedInUser({
      ...userData,
      shift: normalizedShift,
      shiftHours: resolvedShiftHours
    });

    setShiftInfo((prev) => ({
      ...prev,
      date: isCustomDate ? prev.date : getCurrentIndonesianFullDate(),
      shift: normalizedShift,
      shiftHours: resolvedShiftHours,
      dokterDpjp: matrixDocs.primaryDpjp || prev.dokterDpjp,
      dokterJaga: matrixDocs.primaryJaga || prev.dokterJaga,
      pjShift:
        matrixPj?.name ||
        matchingShiftPj?.name ||
        (role === 'pj_shift' && userData.name
          ? userData.name
          : prev.pjShift && prev.pjShift !== '-'
          ? prev.pjShift
          : '-'),
      pjShiftBerikutnya:
        matrixNextPj?.name ||
        (normalizedShift === 'Pagi'
          ? masterNurses.find(
              (n) =>
                n.accountStatus !== 'nonaktif' &&
                resolveNurseSystemAccess(n) === 'pj_shift' &&
                n.shiftAssigned === 'Siang'
            )?.name || prev.pjShiftBerikutnya
          : prev.pjShiftBerikutnya),
      kepalaRuangan: karuNurse?.name || DEFAULT_KEPALA_RUANGAN_NAME
    }));
  };

  const handleLogbookShiftChange = (nextShift: 'Pagi' | 'Siang') => {
    const nextShiftHours =
      nextShift === 'Siang'
        ? 'Siang, jam 14.00 - 21.00 WIB'
        : 'Pagi, jam 07.00 - 14.00 WIB';

    try {
      localStorage.setItem('dialysis_last_logbook_shift', nextShift);
    } catch {
      // ignore
    }

    const activeIso = isCustomDate
      ? indonesianDateLabelToIso(shiftInfo.date) || getCurrentIsoDateWib()
      : getCurrentIsoDateWib();
    const matrixPj = resolvePjShiftEntryFromMatrix(
      nurseSchedules,
      masterNurses,
      activeIso,
      nextShift
    );
    const matrixNextPj = resolvePjShiftEntryFromMatrix(
      nurseSchedules,
      masterNurses,
      activeIso,
      nextShift === 'Pagi' ? 'Siang' : 'Pagi'
    );
    const matrixDocs = resolveScheduledDoctorsFromMatrix(
      doctorSchedules,
      activeIso,
      nextShift,
      masterDoctors
    );

    setShiftInfo((prev) => ({
      ...prev,
      shift: nextShift,
      shiftHours: nextShiftHours,
      dokterDpjp: matrixDocs.primaryDpjp || prev.dokterDpjp,
      dokterJaga: matrixDocs.primaryJaga || prev.dokterJaga,
      pjShift: matrixPj?.name || prev.pjShift,
      pjShiftBerikutnya: matrixNextPj?.name || prev.pjShiftBerikutnya
    }));

    setLoggedInUser((prev) =>
      prev
        ? {
            ...prev,
            shift: nextShift,
            shiftHours: nextShiftHours
          }
        : prev
    );
  };

  const handleActiveDateChange = (nextIsoDate: string) => {
    if (!nextIsoDate) return;
    const todayIso = getCurrentIsoDateWib();
    const formatted = formatIsoDateToIndonesianFull(nextIsoDate);
    setIsCustomDate(nextIsoDate !== todayIso);
    const activeShift: 'Pagi' | 'Siang' = shiftInfo.shift === 'Siang' ? 'Siang' : 'Pagi';
    const matrixPj = resolvePjShiftEntryFromMatrix(
      nurseSchedules,
      masterNurses,
      nextIsoDate,
      activeShift
    );
    const matrixNextPj = resolvePjShiftEntryFromMatrix(
      nurseSchedules,
      masterNurses,
      nextIsoDate,
      activeShift === 'Pagi' ? 'Siang' : 'Pagi'
    );
    const matrixDocs = resolveScheduledDoctorsFromMatrix(
      doctorSchedules,
      nextIsoDate,
      activeShift,
      masterDoctors
    );
    setShiftInfo((prev) => ({
      ...prev,
      date: formatted,
      dokterDpjp: matrixDocs.primaryDpjp || prev.dokterDpjp,
      dokterJaga: matrixDocs.primaryJaga || prev.dokterJaga,
      pjShift: matrixPj?.name || prev.pjShift,
      pjShiftBerikutnya: matrixNextPj?.name || prev.pjShiftBerikutnya
    }));
  };

  const handleResetDateToToday = () => {
    setIsCustomDate(false);
    const todayIso = getCurrentIsoDateWib();
    const wasReset = checkAndResetAllDailyLogbooksIfDayChanged(todayIso);
    if (wasReset && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('dialysis_day_changed', { detail: { todayIso } })
      );
    }
    setShiftInfo((prev) => ({
      ...prev,
      date: getCurrentIndonesianFullDate()
    }));
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
    setLoggedInUser(null);
    setUserRole('perawat_pelaksana');
    setCurrentTab('dashboard');
    setActiveRole('pelaksana');
  };

  // Shift & Sessions state (v6 starts completely clean with zero built-in patient sessions)
  const [isCustomDate, setIsCustomDate] = useState<boolean>(false);
  const [shiftInfo, setShiftInfo] = useState<ShiftInfo>(() => {
    if (typeof window !== 'undefined') {
      checkAndResetAllDailyLogbooksIfDayChanged(getCurrentIsoDateWib());
    }
    return {
      ...initialShiftInfo,
      date: getCurrentIndonesianFullDate()
    };
  });

  // Keep active day/date automatically synchronized with real-time WIB clock unless custom date selected
  useEffect(() => {
    const todayIso = getCurrentIsoDateWib();
    checkAndResetAllDailyLogbooksIfDayChanged(todayIso);

    if (isCustomDate) return;
    const syncLiveDate = () => {
      const liveDateLabel = getCurrentIndonesianFullDate();
      const currentTodayIso = getCurrentIsoDateWib();
      const wasReset = checkAndResetAllDailyLogbooksIfDayChanged(currentTodayIso);
      if (wasReset && typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('dialysis_day_changed', { detail: { todayIso: currentTodayIso } })
        );
      }
      setShiftInfo((prev) => (prev.date === liveDateLabel ? prev : { ...prev, date: liveDateLabel }));
    };
    syncLiveDate();
    const timerId = window.setInterval(syncLiveDate, 10000);
    return () => window.clearInterval(timerId);
  }, [isCustomDate]);

  // Synchronize shiftInfo.dokterDpjp & dokterJaga with Monthly Doctor Matrix whenever schedule or date/shift changes
  useEffect(() => {
    const activeIso = isCustomDate
      ? indonesianDateLabelToIso(shiftInfo.date) || getCurrentIsoDateWib()
      : getCurrentIsoDateWib();
    const activeShift: 'Pagi' | 'Siang' = shiftInfo.shift === 'Siang' ? 'Siang' : 'Pagi';
    const matrixDocs = resolveScheduledDoctorsFromMatrix(
      doctorSchedules,
      activeIso,
      activeShift,
      masterDoctors
    );
    if (matrixDocs.primaryDpjp || matrixDocs.primaryJaga) {
      setShiftInfo((prev) => {
        const nextDpjp = matrixDocs.primaryDpjp || prev.dokterDpjp;
        const nextJaga = matrixDocs.primaryJaga || prev.dokterJaga;
        if (nextDpjp === prev.dokterDpjp && nextJaga === prev.dokterJaga) {
          return prev;
        }
        return {
          ...prev,
          dokterDpjp: nextDpjp,
          dokterJaga: nextJaga
        };
      });
    }
  }, [doctorSchedules, shiftInfo.date, shiftInfo.shift, isCustomDate, masterDoctors]);

  const isDateCustomFromToday =
    isCustomDate && indonesianDateLabelToIso(shiftInfo.date) !== getCurrentIsoDateWib();
  const [operationalItems, setOperationalItems] = useState<OperationalItem[]>(() =>
    loadPersistedArray<OperationalItem>('dialysis_operational_v1', initialOperationalItems)
  );
  const [sbar, setSbar] = useState<SbarData>(() => {
    try {
      const saved = localStorage.getItem('dialysis_sbar_v1');
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return initialSbar;
  });

  useEffect(() => {
    try {
      localStorage.setItem('dialysis_operational_v1', JSON.stringify(operationalItems));
    } catch {
      // ignore
    }
  }, [operationalItems]);

  useEffect(() => {
    try {
      localStorage.setItem('dialysis_sbar_v1', JSON.stringify(sbar));
    } catch {
      // ignore
    }
  }, [sbar]);
  const [sessions, setSessions] = useState<PatientHDSession[]>(() =>
    loadPersistedArray<PatientHDSession>('dialysis_sessions_v6', initialPatients).map(
      ensureFullBagianData
    )
  );

  useEffect(() => {
    try {
      localStorage.setItem('dialysis_sessions_v6', JSON.stringify(sessions));
    } catch {
      // ignore
    }
  }, [sessions]);

  // 1. Initial Firestore connectivity validation (per SKILL.md mandate)
  useEffect(() => {
    testFirestoreConnection().then((connected) => {
      setIsCloudConnected(connected);
    });
  }, []);

  // 2. Real-time multi-device cloud synchronization for Patient HD Sessions
  useEffect(() => {
    const unsubscribe = subscribeToDialysisSessions((cloudSessions, fromCache) => {
      setIsCloudConnected(true);
      if (cloudSessions.length > 0 || !fromCache) {
        setSessions(cloudSessions.map(ensureFullBagianData));
      }
    });

    return () => unsubscribe();
  }, []);

  // 2b. Real-time multi-device & cross-role synchronization for all Nurse Logbooks (occupied patients & beds)
  const [cloudNurseLogbooks, setCloudNurseLogbooks] = useState<NurseLogbookCloudData[]>([]);

  useEffect(() => {
    const unsub = subscribeToAllNurseLogbooks((logbooks) => {
      setCloudNurseLogbooks(logbooks);
    });

    const handleLocalNurseSave = (e: Event) => {
      const detail = (e as CustomEvent<NurseLogbookCloudData>).detail;
      if (!detail || !detail.nurseName) return;
      setCloudNurseLogbooks((prev) => {
        const idx = prev.findIndex((item) => isMatchingNurse(item.nurseName, detail.nurseName));
        if (idx >= 0) {
          const next = [...prev];
          next[idx] = { ...next[idx], ...detail };
          return next;
        }
        return [...prev, detail];
      });
    };

    window.addEventListener('nurse_logbook_local_saved', handleLocalNurseSave);
    return () => {
      unsub();
      window.removeEventListener('nurse_logbook_local_saved', handleLocalNurseSave);
    };
  }, []);

  // 3. Real-time multi-device cloud synchronization for Master Patients
  useEffect(() => {
    const unsub = subscribeToMasterPatients((cloudPatients) => {
      if (cloudPatients.length > 0) {
        setMasterPatients(cloudPatients.map(normalizeMasterPatient));
      }
    });
    return () => unsub();
  }, []);

  // 4b. Real-time multi-device cloud synchronization for Master Doctors
  useEffect(() => {
    if (isFirestoreQuotaExhausted()) return;
    const unsub = subscribeToMasterDoctors((cloudDoctors) => {
      if (cloudDoctors.length > 0) {
        setMasterDoctors(ensureAllOfficialDoctors(cloudDoctors));
      }
    });
    return () => unsub();
  }, []);

  // 4. Real-time multi-device cloud synchronization for Master Nurses
  useEffect(() => {
    const unsub = subscribeToMasterNurses((cloudNurses) => {
      if (cloudNurses.length > 0) {
        setMasterNurses(
          cloudNurses.map((n) => ({
            ...n,
            systemAccess: resolveNurseSystemAccess(n)
          }))
        );
      }
    });
    return () => unsub();
  }, []);

  // 4c. Real-time multi-device cloud synchronization for Master Beds
  useEffect(() => {
    if (isFirestoreQuotaExhausted()) return;
    const unsub = subscribeToMasterBeds((cloudBeds) => {
      if (Array.isArray(cloudBeds) && cloudBeds.length > 0) {
        const { uniqueBeds, duplicateIdsRemoved } = ensureAndDeduplicateMasterBeds(cloudBeds);
        if (duplicateIdsRemoved.length > 0) {
          duplicateIdsRemoved.forEach((dupId) => {
            deleteMasterBedCloud(dupId).catch(() => {});
          });
        }
        setMasterBeds(uniqueBeds);
      }
    });
    return () => unsub();
  }, []);

  // 5. Real-time multi-device cloud synchronization for Verification Registry
  useEffect(() => {
    const unsub = subscribeToVerificationRegistry((cloudEntries) => {
      if (Array.isArray(cloudEntries) && cloudEntries.length > 0) {
        try {
          localStorage.setItem(VERIFICATION_REGISTRY_STORAGE_KEY, JSON.stringify(cloudEntries));
          window.dispatchEvent(new CustomEvent('verification_registry_updated'));
        } catch {
          // ignore
        }
      }
    });
    return () => unsub();
  }, []);

  // Synchronize managed patients & submission status from Logbook5ButtonsView into sessions
  const handleSyncNurseLogbookSessions = (
    nurseName: string,
    managedPatients: ManagedPatient[],
    verification: {
      status: PjVerificationStatus;
      verifiedAt?: string;
      verifiedBy?: string;
      verifiedByRole?: string;
      verifierNotes?: string;
      date?: string;
      sessionDate?: string;
      shift?: 'Pagi' | 'Siang';
      dokterDpjp?: string;
      dokterJaga?: string;
      clinicalDetails?: Record<string, PatientLogbookClinicalDetails>;
      patientStatuses?: Record<string, Record<string, boolean>>;
      perPatientStatuses?: Record<
        string,
        {
          status: PjVerificationStatus;
          submittedAt?: string;
          submittedEpoch?: number;
          verifiedAt?: string;
          verifiedBy?: string;
          verifiedByRole?: string;
          verifierNotes?: string;
          revisionRequested?: boolean;
          revisionRequestedAt?: string;
          revisionRequestedBy?: string;
          revisionRequestedByRole?: string;
          revisionEpoch?: number;
        }
      >;
    }
  ) => {
    if (!nurseName) return;
    const activeDateIso =
      verification.sessionDate ||
      (verification.date ? indonesianDateLabelToIso(verification.date) : indonesianDateLabelToIso(shiftInfo.date)) ||
      getCurrentIsoDateWib();
    const activeDateLabel =
      verification.date || shiftInfo.date || getCurrentIndonesianFullDate();
    const activeShift = verification.shift || shiftInfo.shift;

    let clinicalDetailsMap: Record<string, PatientLogbookClinicalDetails> =
      verification.clinicalDetails || {};
    if (Object.keys(clinicalDetailsMap).length === 0) {
      try {
        const rawClin = localStorage.getItem(getNurseClinicalDetailsKey(nurseName));
        if (rawClin) {
          const parsedClin = JSON.parse(rawClin);
          if (parsedClin && typeof parsedClin === 'object') {
            clinicalDetailsMap = parsedClin;
          }
        }
      } catch {
        // ignore
      }
    }

    let patientStatusesMap: Record<string, Record<string, boolean>> =
      verification.patientStatuses || {};
    if (Object.keys(patientStatusesMap).length === 0) {
      try {
        const rawStat = localStorage.getItem(getNursePatientStatusesKey(nurseName));
        if (rawStat) {
          const parsedStat = JSON.parse(rawStat);
          if (parsedStat && typeof parsedStat === 'object') {
            patientStatusesMap = parsedStat;
          }
        }
      } catch {
        // ignore
      }
    }

    setSessions((prev) => {
      // Retain sessions from other nurses, and sessions from the same nurse on DIFFERENT dates or shifts!
      const unaffectedSessions = prev.filter((s) => {
        const isSameNurse = isMatchingNurse(s.nurseInCharge, nurseName);
        if (!isSameNurse) return true;
        const sDateIso = s.sessionDate || (s.date ? indonesianDateLabelToIso(s.date) : '');
        const isSameDate = sDateIso === activeDateIso;
        const isSameShift = !s.shift || s.shift === activeShift;
        return !(isSameDate && isSameShift);
      });

      const existingCurrentDateSessions = prev.filter((s) => {
        const isSameNurse = isMatchingNurse(s.nurseInCharge, nurseName);
        if (!isSameNurse) return false;
        const sDateIso = s.sessionDate || (s.date ? indonesianDateLabelToIso(s.date) : '');
        const isSameDate = sDateIso === activeDateIso;
        const isSameShift = !s.shift || s.shift === activeShift;
        return isSameDate && isSameShift;
      });

      const syncedMySessions: PatientHDSession[] = managedPatients.map((mp, idx) => {
        const patVerif = verification.perPatientStatuses?.[mp.id];
        const cleanMpRm = mp.medicalRecord?.trim();
        const cleanMpName = mp.patientName.toLowerCase().trim();

        const patClinical = normalizePatientClinicalDetails(clinicalDetailsMap[mp.id]);
        const patStatusChecks = patientStatusesMap[mp.id] || patientStatusesMap[mp.bedNumber];
        const resolvedVascNurse = patClinical.poin3_6.vascularAccessNurse?.trim() || nurseName;
        const resolvedPoin3_6Done =
          patStatusChecks && typeof patStatusChecks['3.6'] === 'boolean'
            ? patStatusChecks['3.6']
            : isPoin3_6Complete(patClinical.poin3_6);
        const bbPreVal = parseClinicalNumber(patClinical.poin3_2.bbPre);
        const bbPostVal = parseClinicalNumber(patClinical.poin3_2.bbPost);
        const bbKeringVal = parseClinicalNumber(patClinical.poin3_2.bbKering);
        const tdPreHdVal = patClinical.poin3_3.tdPreHd?.trim() || '';
        const durasiVal = parseClinicalNumber(patClinical.poin3_5.waktuDialisis);
        const targetUfgVal = parseClinicalNumber(patClinical.poin3_5.targetUfg);
        const qbVal = parseClinicalNumber(patClinical.poin3_5.qb);
        const qdVal = parseClinicalNumber(patClinical.poin3_5.qd);
        const heparinVal = patClinical.poin3_5.dosisHeparin.trim();
        const resolvedComp = resolveSessionComplicationsFromPoin4_3(patClinical.poin4_3);
        const postBpVal = patClinical.poin6_3?.tdPostHd?.trim() || '';
        const achievedUfgVal = parseClinicalNumber(patClinical.poin6_3?.ufgTercapai);
        const ktvNumVal = parseClinicalNumber(patClinical.poin6_3?.ktV);
        const ktvVal = ktvNumVal !== null ? ktvNumVal : patClinical.poin6_3?.ktV?.trim() || undefined;

        const foundExisting = existingCurrentDateSessions.find((s) => {
          if (cleanMpRm && s.medicalRecordNumber?.trim() === cleanMpRm) return true;
          if (isSameBed(s.bedNumber, mp.bedNumber)) return true;
          if (cleanMpName && s.patientName.toLowerCase().trim() === cleanMpName) return true;
          return false;
        });

        if (foundExisting) {
          const resolvedAccess = resolveSessionAccessFromPoin3_6(
            patClinical.poin3_6,
            foundExisting.vascularAccess,
            foundExisting.accessSite || 'AVF Radiocephalica'
          );

          const baseExistingNote = (foundExisting.nurseNotes || '')
            .replace(/\s*\[Komplikasi HD:[^\]]*\]/g, '')
            .trim();
          const syncedExistingNote = resolvedComp.hasAnyInput
            ? resolvedComp.activeCount > 0
              ? `${baseExistingNote ? `${baseExistingNote} ` : ''}[Komplikasi HD: ${resolvedComp.activeSummary}]`
              : baseExistingNote || undefined
            : foundExisting.nurseNotes;

          const effectiveStatus: PjVerificationStatus = patVerif
            ? patVerif.status
            : foundExisting.revisionRequested && foundExisting.verificationStatus === 'belum_diajukan'
            ? 'belum_diajukan'
            : foundExisting.isVerifiedByPj || foundExisting.verificationStatus === 'terverifikasi'
            ? 'terverifikasi'
            : verification.status;
          const isPatVerified = effectiveStatus === 'terverifikasi';
          const isPatRevision =
            effectiveStatus === 'belum_diajukan' &&
            Boolean(
              patVerif?.revisionRequested ??
                foundExisting.revisionRequested ??
                (patVerif?.verifierNotes || foundExisting.verifierNotes)
            );
          const resolvedVerifiedBy =
            patVerif?.verifiedBy || verification.verifiedBy || foundExisting.verifiedBy;
          const resolvedVerifiedByRole =
            patVerif?.verifiedByRole ||
            verification.verifiedByRole ||
            foundExisting.verifiedByRole;
          const isPatKaru =
            isPatVerified && isKepalaRuangVerifier(resolvedVerifiedByRole, resolvedVerifiedBy);

          const p31Status = patClinical.poin3_1?.status;
          const p31Ruang = patClinical.poin3_1?.ruangRawatInap;
          const p31Kat = patClinical.poin3_1?.kategori;

          const syncedStatus =
            p31Status === 'RAWAT INAP'
              ? 'ranap'
              : p31Status === 'RAWAT JALAN'
              ? 'rajal'
              : foundExisting.status;

          const syncedCategory =
            p31Kat === 'ISOLASI HEPATITIS B'
              ? 'hepatitis_b'
              : p31Kat === 'ISOLASI HEPATITIS C/HIV'
              ? 'hepatitis_c'
              : p31Kat === 'REGULER'
              ? 'reguler'
              : foundExisting.category;

          return ensureFullBagianData({
            ...foundExisting,
            bedNumber: mp.bedNumber,
            patientName: mp.patientName,
            medicalRecordNumber: mp.medicalRecord || foundExisting.medicalRecordNumber,
            status: syncedStatus,
            category: syncedCategory,
            isCito:
              p31Status === 'RAWAT INAP' && p31Ruang === 'ICU'
                ? true
                : foundExisting.isCito,
            vascularAccess: resolvedAccess.vascularAccess,
            accessSite: resolvedAccess.accessSite,
            dryWeight:
              bbKeringVal !== null && bbKeringVal > 0 ? bbKeringVal : foundExisting.dryWeight,
            preWeight:
              bbPreVal !== null && bbPreVal > 0 ? bbPreVal : foundExisting.preWeight,
            postWeight:
              bbPostVal !== null && bbPostVal > 0 ? bbPostVal : foundExisting.postWeight,
            preBp: tdPreHdVal || foundExisting.preBp,
            postBp: postBpVal || foundExisting.postBp,
            durationPrescribed:
              durasiVal !== null && durasiVal > 0 ? durasiVal : foundExisting.durationPrescribed,
            durationActual:
              durasiVal !== null && durasiVal > 0 ? durasiVal : foundExisting.durationActual,
            targetUf:
              targetUfgVal !== null && targetUfgVal >= 0
                ? Math.round(targetUfgVal)
                : foundExisting.targetUf,
            achievedUf:
              achievedUfgVal !== null && achievedUfgVal >= 0
                ? Math.round(achievedUfgVal)
                : targetUfgVal !== null && targetUfgVal >= 0
                ? Math.round(targetUfgVal)
                : foundExisting.achievedUf,
            ktV: ktvVal !== undefined ? ktvVal : foundExisting.ktV,
            bloodFlowQb:
              qbVal !== null && qbVal > 0 ? Math.round(qbVal) : foundExisting.bloodFlowQb,
            dialysateFlowQd:
              qdVal !== null && qdVal > 0 ? Math.round(qdVal) : foundExisting.dialysateFlowQd,
            hasHypotension: resolvedComp.hasAnyInput
              ? resolvedComp.hasHypotension
              : foundExisting.hasHypotension,
            hypotensionBp: resolvedComp.hasAnyInput
              ? resolvedComp.hypotensionBp
              : foundExisting.hypotensionBp,
            hypotensionAction: resolvedComp.hasAnyInput
              ? resolvedComp.hypotensionAction
              : foundExisting.hypotensionAction,
            hasMuscleCramps: resolvedComp.hasAnyInput
              ? resolvedComp.hasMuscleCramps
              : foundExisting.hasMuscleCramps,
            muscleCrampAction: resolvedComp.hasAnyInput
              ? resolvedComp.muscleCrampAction
              : foundExisting.muscleCrampAction,
            hasClotting: resolvedComp.hasAnyInput
              ? resolvedComp.hasClotting
              : foundExisting.hasClotting,
            clottingDetails: resolvedComp.hasAnyInput
              ? resolvedComp.clottingDetails
              : foundExisting.clottingDetails,
            hasFirstUseSyndrome: resolvedComp.hasAnyInput
              ? resolvedComp.hasFirstUseSyndrome
              : foundExisting.hasFirstUseSyndrome,
            firstUseDetails: resolvedComp.hasAnyInput
              ? resolvedComp.firstUseDetails
              : foundExisting.firstUseDetails,
            hasAccessBleeding: resolvedComp.hasAnyInput
              ? resolvedComp.hasAccessBleeding
              : foundExisting.hasAccessBleeding,
            accessBleedingAction: resolvedComp.hasAnyInput
              ? resolvedComp.accessBleedingAction
              : foundExisting.accessBleedingAction,
            hasConsultDpjp:
              resolvedComp.hasAnyInput &&
              (resolvedComp.hasPenurunanKesadaran || resolvedComp.hasFirstUseSyndrome)
                ? true
                : foundExisting.hasConsultDpjp,
            complicationNames: resolvedComp.hasAnyInput
              ? resolvedComp.complicationNames
              : foundExisting.complicationNames,
            consultAdvice: resolvedComp.hasAnyInput
              ? (resolvedComp.doctorAdviceSummary || undefined)
              : foundExisting.consultAdvice,
            bagian4: resolvedComp.hasAnyInput ? undefined : foundExisting.bagian4,
            nurseInCharge: nurseName,
            vascularAccessNurse: resolvedVascNurse,
            poin3_6Completed: resolvedPoin3_6Done,
            dokterDpjp: verification.dokterDpjp || foundExisting.dokterDpjp,
            dokterJaga: verification.dokterJaga || foundExisting.dokterJaga,
            nurseNotes: syncedExistingNote,
            date: activeDateLabel,
            sessionDate: activeDateIso,
            shift: activeShift,
            isVerifiedByPj: isPatVerified,
            isVerifiedByKepalaRuang: isPatKaru,
            verificationStatus: effectiveStatus,
            submittedAt: patVerif?.submittedAt || foundExisting.submittedAt,
            submittedEpoch: patVerif?.submittedEpoch ?? foundExisting.submittedEpoch,
            verifiedAt: isPatVerified
              ? patVerif?.verifiedAt || verification.verifiedAt || foundExisting.verifiedAt
              : undefined,
            verifiedBy: isPatVerified ? resolvedVerifiedBy : undefined,
            verifiedByRole: isPatVerified ? resolvedVerifiedByRole : undefined,
            verifierNotes:
              effectiveStatus === 'diajukan'
                ? undefined
                : patVerif?.verifierNotes ??
                  verification.verifierNotes ??
                  foundExisting.verifierNotes,
            revisionRequested: isPatRevision,
            revisionRequestedAt: isPatRevision
              ? patVerif?.revisionRequestedAt || foundExisting.revisionRequestedAt
              : undefined,
            revisionRequestedBy: isPatRevision
              ? patVerif?.revisionRequestedBy || foundExisting.revisionRequestedBy
              : undefined,
            revisionRequestedByRole: isPatRevision
              ? patVerif?.revisionRequestedByRole || foundExisting.revisionRequestedByRole
              : undefined,
            revisionEpoch: isPatRevision
              ? patVerif?.revisionEpoch ?? foundExisting.revisionEpoch
              : undefined,
            updatedAt: new Date().toISOString()
          });
        }

        const masterMatch = masterPatients.find(
          (m) =>
            (cleanMpRm && m.medicalRecordNumber === cleanMpRm) ||
            m.patientName.toLowerCase().trim() === cleanMpName
        );

        const defaultDry =
          bbKeringVal !== null && bbKeringVal > 0
            ? bbKeringVal
            : masterMatch?.defaultDryWeight || 60.0;
        const defaultPre =
          bbPreVal !== null && bbPreVal > 0 ? bbPreVal : defaultDry + 2.4;
        const defaultPost =
          bbPostVal !== null && bbPostVal > 0 ? bbPostVal : defaultDry;
        const defaultTargetUf =
          targetUfgVal !== null && targetUfgVal >= 0 ? Math.round(targetUfgVal) : 2400;
        const defaultDur = durasiVal !== null && durasiVal > 0 ? durasiVal : 4.5;
        const resolvedAccess = resolveSessionAccessFromPoin3_6(
          patClinical.poin3_6,
          masterMatch?.defaultVascularAccess || 'av_fistula',
          masterMatch?.defaultAccessSite || 'AVF Radiocephalica'
        );

        const newEffectiveStatus: PjVerificationStatus =
          patVerif?.status || verification.status;
        const isNewVerified = newEffectiveStatus === 'terverifikasi';
        const resolvedNewVerifiedBy = patVerif?.verifiedBy || verification.verifiedBy;
        const resolvedNewVerifiedByRole = patVerif?.verifiedByRole || verification.verifiedByRole;
        const isNewKaru =
          isNewVerified &&
          isKepalaRuangVerifier(resolvedNewVerifiedByRole, resolvedNewVerifiedBy);

        const p31Status = patClinical.poin3_1?.status;
        const p31Ruang = patClinical.poin3_1?.ruangRawatInap;
        const p31Kat = patClinical.poin3_1?.kategori;

        const initialStatus =
          p31Status === 'RAWAT INAP'
            ? 'ranap'
            : p31Status === 'RAWAT JALAN'
            ? 'rajal'
            : masterMatch?.defaultStatus || 'rajal';

        const initialCategory =
          p31Kat === 'ISOLASI HEPATITIS B'
            ? 'hepatitis_b'
            : p31Kat === 'ISOLASI HEPATITIS C/HIV'
            ? 'hepatitis_c'
            : p31Kat === 'REGULER'
            ? 'reguler'
            : masterMatch?.category || 'reguler';

        return ensureFullBagianData({
          id: `sess-lb-${activeDateIso}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
          date: activeDateLabel,
          sessionDate: activeDateIso,
          bedNumber: mp.bedNumber,
          patientName: mp.patientName,
          medicalRecordNumber:
            mp.medicalRecord || masterMatch?.medicalRecordNumber || `4529${idx + 1}`,
          age: masterMatch?.age || 54,
          gender: masterMatch?.gender || 'L',
          status: initialStatus,
          category: initialCategory,
          sessionStatus: 'selesai',
          isCito: p31Status === 'RAWAT INAP' && p31Ruang === 'ICU',
          shift: activeShift,
          vascularAccess: resolvedAccess.vascularAccess,
          accessSite: resolvedAccess.accessSite,
          dialyzerModel: masterMatch?.defaultDialyzer || 'SAS HF 18',
          isReuse: false,
          dryWeight: defaultDry,
          preWeight: defaultPre,
          postWeight: defaultPost,
          targetUf: defaultTargetUf,
          achievedUf:
            achievedUfgVal !== null && achievedUfgVal >= 0
              ? Math.round(achievedUfgVal)
              : defaultTargetUf,
          durationPrescribed: defaultDur,
          durationActual: defaultDur,
          bloodFlowQb: qbVal !== null && qbVal > 0 ? Math.round(qbVal) : 220,
          dialysateFlowQd: qdVal !== null && qdVal > 0 ? Math.round(qdVal) : 500,
          preBp: tdPreHdVal || '140/85',
          postBp: postBpVal || '125/80',
          ktV: ktvVal !== undefined ? ktvVal : 1.8,
          hasHypotension: resolvedComp.hasHypotension,
          hypotensionBp: resolvedComp.hypotensionBp,
          hypotensionAction: resolvedComp.hypotensionAction,
          hasMuscleCramps: resolvedComp.hasMuscleCramps,
          muscleCrampAction: resolvedComp.muscleCrampAction,
          hasClotting: resolvedComp.hasClotting,
          clottingDetails: resolvedComp.clottingDetails,
          hasFirstUseSyndrome: resolvedComp.hasFirstUseSyndrome,
          firstUseDetails: resolvedComp.firstUseDetails,
          hasAccessBleeding: resolvedComp.hasAccessBleeding,
          accessBleedingAction: resolvedComp.accessBleedingAction,
          hasConsultDpjp:
            resolvedComp.hasPenurunanKesadaran || resolvedComp.hasFirstUseSyndrome,
          complicationNames: resolvedComp.complicationNames,
          consultAdvice: resolvedComp.doctorAdviceSummary || undefined,
          underUfTolerated: false,
          nurseInCharge: nurseName,
          vascularAccessNurse: resolvedVascNurse,
          poin3_6Completed: resolvedPoin3_6Done,
          dokterDpjp: verification.dokterDpjp,
          dokterJaga: verification.dokterJaga,
          nurseNotes: `${
            heparinVal
              ? `Asuhan HD & SPO Bagian I–VI lengkap (Dosis Heparin: ${heparinVal}).`
              : 'Asuhan hemodialisis & checklist SPO Bagian I–VI terisi lengkap.'
          }${
            resolvedComp.activeCount > 0
              ? ` [Komplikasi HD: ${resolvedComp.activeSummary}]`
              : ''
          }`,
          isVerifiedByPj: isNewVerified,
          isVerifiedByKepalaRuang: isNewKaru,
          verificationStatus: newEffectiveStatus,
          submittedAt: patVerif?.submittedAt,
          submittedEpoch: patVerif?.submittedEpoch,
          verifiedAt: isNewVerified ? patVerif?.verifiedAt || verification.verifiedAt : undefined,
          verifiedBy: isNewVerified ? resolvedNewVerifiedBy : undefined,
          verifiedByRole: isNewVerified ? resolvedNewVerifiedByRole : undefined,
          verifierNotes:
            newEffectiveStatus === 'diajukan'
              ? undefined
              : patVerif?.verifierNotes ?? verification.verifierNotes,
          revisionRequested:
            newEffectiveStatus === 'belum_diajukan' && Boolean(patVerif?.revisionRequested),
          revisionRequestedAt:
            newEffectiveStatus === 'belum_diajukan' ? patVerif?.revisionRequestedAt : undefined,
          revisionRequestedBy:
            newEffectiveStatus === 'belum_diajukan' ? patVerif?.revisionRequestedBy : undefined,
          revisionRequestedByRole:
            newEffectiveStatus === 'belum_diajukan' ? patVerif?.revisionRequestedByRole : undefined,
          revisionEpoch:
            newEffectiveStatus === 'belum_diajukan' ? patVerif?.revisionEpoch : undefined,
          updatedAt: new Date().toISOString()
        });
      });

      // Remove obsolete unverified sessions of this nurse+date+shift from Cloud Firestore
      const syncedIds = new Set(syncedMySessions.map((s) => s.id));
      existingCurrentDateSessions.forEach((oldSess) => {
        if (!syncedIds.has(oldSess.id)) {
          deleteDialysisSessionCloud(oldSess.id).catch(() => {});
        }
      });

      // Persist to Cloud Firestore for real-time synchronization across devices
      syncedMySessions.forEach((sessionItem) => {
        saveDialysisSessionCloud(sessionItem).catch((err) => {
          console.warn('Could not sync session to Firestore:', err);
        });
      });

      return [...unaffectedSessions, ...syncedMySessions];
    });
  };

  // Sync session verification status when PJ Shift or Kepala Ruang verifies a nurse's entire logbook
  const handleNurseVerificationUpdated = (
    nurseName: string,
    status: PjVerificationStatus,
    details: {
      verifiedAt?: string;
      verifiedBy?: string;
      verifiedByRole?: string;
      verifierNotes?: string;
      revisionRequested?: boolean;
      revisionRequestedAt?: string;
      revisionRequestedBy?: string;
      revisionRequestedByRole?: string;
      revisionEpoch?: number;
      shift?: string;
      dateKey?: string;
      dateLabel?: string;
    }
  ) => {
    const isVerified = status === 'terverifikasi';
    const isRevision = status === 'belum_diajukan' && Boolean(details.revisionRequested);
    const isKaru =
      isVerified && isKepalaRuangVerifier(details.verifiedByRole, details.verifiedBy);
    const targetShift: 'Pagi' | 'Siang' | undefined = details.shift
      ? details.shift.toLowerCase().includes('siang')
        ? 'Siang'
        : 'Pagi'
      : undefined;
    const targetDateIso =
      details.dateKey ||
      (details.dateLabel ? indonesianDateLabelToIso(details.dateLabel) : '');

    setSessions((prev) =>
      prev.map((s) => {
        if (!isMatchingNurse(s.nurseInCharge, nurseName)) return s;
        if (targetShift && s.shift && s.shift !== targetShift) return s;
        if (targetDateIso) {
          const sIso = s.sessionDate || (s.date ? indonesianDateLabelToIso(s.date) : '');
          if (sIso && sIso !== targetDateIso) return s;
        }
        if (isVerified && s.verificationStatus === 'belum_diajukan') {
          return s;
        }
        const updatedSession: PatientHDSession = {
          ...s,
          date: s.date || details.dateLabel || shiftInfo.date,
          sessionDate: s.sessionDate || targetDateIso || indonesianDateLabelToIso(shiftInfo.date),
          shift: s.shift || targetShift || shiftInfo.shift,
          isVerifiedByPj: isVerified,
          isVerifiedByKepalaRuang: isKaru,
          verificationStatus: status,
          verifiedAt: isVerified ? details.verifiedAt : undefined,
          verifiedBy: isVerified ? details.verifiedBy : undefined,
          verifiedByRole: isVerified ? details.verifiedByRole : undefined,
          verifierNotes: details.verifierNotes,
          revisionRequested: isRevision,
          revisionRequestedAt: isRevision ? details.revisionRequestedAt : undefined,
          revisionRequestedBy: isRevision ? details.revisionRequestedBy : undefined,
          revisionRequestedByRole: isRevision ? details.revisionRequestedByRole : undefined,
          revisionEpoch: isRevision ? details.revisionEpoch : undefined
        };
        saveDialysisSessionCloud(updatedSession).catch(() => {});
        return updatedSession;
      })
    );
  };

  // Sync individual patient verification status scoped strictly by managing nurse + bed/RM + shift/date
  const handleVerifyPatientSession = (
    patientIdentifier: { bedNumber?: string; patientName?: string; medicalRecord?: string },
    verified: boolean,
    details: {
      verifiedAt?: string;
      verifiedBy?: string;
      verifiedByRole?: string;
      verifierNotes?: string;
      revisionRequested?: boolean;
      revisionRequestedAt?: string;
      revisionRequestedBy?: string;
      revisionRequestedByRole?: string;
      revisionEpoch?: number;
      nurseName?: string;
      shift?: string;
      dateKey?: string;
      dateLabel?: string;
    }
  ) => {
    const isKaru =
      verified && isKepalaRuangVerifier(details.verifiedByRole, details.verifiedBy);
    const resolvedDetailShift: 'Pagi' | 'Siang' = details.shift
      ? details.shift.toLowerCase().includes('siang')
        ? 'Siang'
        : 'Pagi'
      : shiftInfo.shift === 'Siang'
      ? 'Siang'
      : 'Pagi';
    const resolvedDetailDateLabel = details.dateLabel || shiftInfo.date;
    const resolvedDetailDateIso =
      details.dateKey ||
      indonesianDateLabelToIso(resolvedDetailDateLabel) ||
      getCurrentIsoDateWib();

    setSessions((prev) => {
      let matched = false;
      const cleanTargetName = (patientIdentifier.patientName || '').toLowerCase().trim();
      const cleanTargetRm = patientIdentifier.medicalRecord?.trim();

      // Resolve Poin 3.6 vascular access nurse & completion from cloud/local nurse logbook if available
      let fallbackVascNurse: string | undefined;
      let fallbackPoin3_6Done: boolean | undefined;
      if (details.nurseName) {
        const matchedCloudLb = cloudNurseLogbooks.find((lb) =>
          isMatchingNurse(lb.nurseName, details.nurseName!)
        );
        let mpList: Array<{ id?: string; bedNumber?: string; medicalRecord?: string; patientName?: string }> =
          Array.isArray(matchedCloudLb?.managedPatients) ? matchedCloudLb!.managedPatients : [];
        let clinMap: Record<string, unknown> =
          (matchedCloudLb?.clinicalDetails as Record<string, unknown>) || {};
        let statMap: Record<string, Record<string, boolean>> = matchedCloudLb?.patientStatuses || {};

        if (Object.keys(clinMap).length === 0) {
          try {
            const rawClin = localStorage.getItem(getNurseClinicalDetailsKey(details.nurseName));
            if (rawClin) clinMap = JSON.parse(rawClin) || {};
          } catch {
            // ignore
          }
        }
        if (Object.keys(statMap).length === 0) {
          try {
            const rawStat = localStorage.getItem(getNursePatientStatusesKey(details.nurseName));
            if (rawStat) statMap = JSON.parse(rawStat) || {};
          } catch {
            // ignore
          }
        }
        const matchedMp = mpList.find(
          (m) =>
            (cleanTargetRm && m.medicalRecord?.trim() === cleanTargetRm) ||
            (patientIdentifier.bedNumber && isSameBed(m.bedNumber, patientIdentifier.bedNumber)) ||
            (cleanTargetName && m.patientName?.toLowerCase().trim() === cleanTargetName)
        );
        const lookupKey = matchedMp?.id || patientIdentifier.bedNumber || '';
        const rawClinItem =
          (lookupKey && clinMap[lookupKey]) ||
          (patientIdentifier.bedNumber && clinMap[patientIdentifier.bedNumber]);
        if (rawClinItem) {
          const normClin = normalizePatientClinicalDetails(rawClinItem);
          fallbackVascNurse = normClin.poin3_6.vascularAccessNurse?.trim() || details.nurseName;
          const checks =
            (lookupKey && statMap[lookupKey]) ||
            (patientIdentifier.bedNumber ? statMap[patientIdentifier.bedNumber] : undefined);
          fallbackPoin3_6Done =
            checks && typeof checks['3.6'] === 'boolean'
              ? checks['3.6']
              : isPoin3_6Complete(normClin.poin3_6);
        }
      }

      const updated = prev.map((s) => {
        if (
          details.nurseName &&
          s.nurseInCharge &&
          !isMatchingNurse(s.nurseInCharge, details.nurseName)
        ) {
          return s;
        }
        if (details.shift && s.shift && s.shift !== resolvedDetailShift) {
          return s;
        }
        if (details.dateKey || details.dateLabel) {
          const sIso = s.sessionDate || (s.date ? indonesianDateLabelToIso(s.date) : '');
          if (sIso && sIso !== resolvedDetailDateIso) {
            return s;
          }
        }

        const matchesRm = Boolean(cleanTargetRm && s.medicalRecordNumber?.trim() === cleanTargetRm);
        const matchesBed = isSameBed(s.bedNumber, patientIdentifier.bedNumber);
        const matchesName =
          cleanTargetName.length > 3 && s.patientName.toLowerCase().trim() === cleanTargetName;

        if (matchesRm || matchesBed || matchesName) {
          matched = true;
          const targetDateLabel = s.date || resolvedDetailDateLabel;
          const targetDateIso = s.sessionDate || resolvedDetailDateIso;
          const effectiveOwner = s.nurseInCharge || details.nurseName || shiftInfo.pjShift;
          const updatedSession: PatientHDSession = {
            ...s,
            date: targetDateLabel,
            sessionDate: targetDateIso,
            shift: s.shift || resolvedDetailShift,
            nurseInCharge: effectiveOwner,
            vascularAccessNurse:
              fallbackVascNurse || s.vascularAccessNurse || effectiveOwner,
            poin3_6Completed:
              fallbackPoin3_6Done ?? s.poin3_6Completed ?? true,
            isVerifiedByPj: verified,
            isVerifiedByKepalaRuang: isKaru,
            verificationStatus: (verified ? 'terverifikasi' : 'belum_diajukan') as
              | 'terverifikasi'
              | 'belum_diajukan',
            verifiedAt: verified ? details.verifiedAt : undefined,
            verifiedBy: verified ? details.verifiedBy : undefined,
            verifiedByRole: verified ? details.verifiedByRole : undefined,
            verifierNotes: details.verifierNotes,
            revisionRequested: !verified,
            revisionRequestedAt: !verified ? details.revisionRequestedAt : undefined,
            revisionRequestedBy: !verified ? details.revisionRequestedBy : undefined,
            revisionRequestedByRole: !verified ? details.revisionRequestedByRole : undefined,
            revisionEpoch: !verified ? details.revisionEpoch || Date.now() : undefined,
            updatedAt: new Date().toISOString()
          };
          saveDialysisSessionCloud(updatedSession).catch(() => {});
          return updatedSession;
        }
        return s;
      });

      // If this verified logbook patient was not already in sessions, create and append it
      if (!matched && verified && (patientIdentifier.patientName || patientIdentifier.bedNumber)) {
        const masterMatch = masterPatients.find(
          (m) =>
            (cleanTargetRm && m.medicalRecordNumber === cleanTargetRm) ||
            (cleanTargetName && m.patientName.toLowerCase().trim() === cleanTargetName)
        );
        const dryWeight = masterMatch?.defaultDryWeight || 60.0;
        const effectiveOwner = details.nurseName || shiftInfo.pjShift;

        const newSession: PatientHDSession = ensureFullBagianData({
          id: `sess-verif-${resolvedDetailDateIso}-${resolvedDetailShift}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          date: resolvedDetailDateLabel,
          sessionDate: resolvedDetailDateIso,
          shift: resolvedDetailShift,
          bedNumber: patientIdentifier.bedNumber || masterBeds[0]?.bedNumber || 'BED A01',
          patientName:
            patientIdentifier.patientName || masterMatch?.patientName || 'Pasien Dialisis',
          medicalRecordNumber:
            patientIdentifier.medicalRecord || masterMatch?.medicalRecordNumber || '452100',
          age: masterMatch?.age || 55,
          gender: masterMatch?.gender || 'L',
          status: masterMatch?.defaultStatus || 'rajal',
          category: masterMatch?.category || 'reguler',
          sessionStatus: 'selesai',
          isCito: false,
          vascularAccess: masterMatch?.defaultVascularAccess || 'av_fistula',
          accessSite: masterMatch?.defaultAccessSite || 'AVF Radiocephalica',
          dialyzerModel: masterMatch?.defaultDialyzer || 'SAS HF 18',
          isReuse: false,
          dryWeight,
          preWeight: dryWeight + 2.5,
          postWeight: dryWeight,
          targetUf: 2500,
          achievedUf: 2500,
          durationPrescribed: 4.5,
          durationActual: 4.5,
          bloodFlowQb: 220,
          dialysateFlowQd: 500,
          preBp: '140/85',
          postBp: '125/80',
          hasHypotension: false,
          hasMuscleCramps: false,
          hasClotting: false,
          hasFirstUseSyndrome: false,
          hasAccessBleeding: false,
          hasConsultDpjp: false,
          underUfTolerated: false,
          nurseInCharge: effectiveOwner,
          vascularAccessNurse: fallbackVascNurse || effectiveOwner,
          poin3_6Completed: fallbackPoin3_6Done ?? true,
          nurseNotes: 'Sesi hemodialisis dan checklist Bagian I–VI terisi lengkap.',
          isVerifiedByPj: true,
          isVerifiedByKepalaRuang: isKaru,
          verificationStatus: 'terverifikasi' as const,
          verifiedAt: details.verifiedAt || formatCurrentWibTimestamp(resolvedDetailDateLabel),
          verifiedBy:
            details.verifiedBy || (isKaru ? shiftInfo.kepalaRuangan : shiftInfo.pjShift),
          verifiedByRole: details.verifiedByRole || (isKaru ? 'Kepala Ruangan' : 'PJ Shift'),
          verifierNotes: details.verifierNotes,
          revisionRequested: false,
          updatedAt: new Date().toISOString()
        });
        saveDialysisSessionCloud(newSession).catch(() => {});
        return [...updated, newSession];
      }

      return updated;
    });
  };

  // Digital Signatures state (initial unsigned, persisted in localStorage)
  const [signatures, setSignatures] = useState<ShiftSignatures>(() => {
    try {
      const saved = localStorage.getItem('dialysis_signatures_v1');
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return {
      pjShift: { name: initialShiftInfo.pjShift, signed: false, signedAt: '' },
      pjBerikutnya: { name: initialShiftInfo.pjShiftBerikutnya, signed: false, signedAt: '' },
      kepalaRuangan: { name: initialShiftInfo.kepalaRuangan, signed: false, signedAt: '' }
    };
  });

  useEffect(() => {
    try {
      localStorage.setItem('dialysis_signatures_v1', JSON.stringify(signatures));
    } catch {
      // ignore
    }
  }, [signatures]);

  // Modal states
  const [selectedSession, setSelectedSession] = useState<PatientHDSession | null>(null);
  const [sessionModalTab, setSessionModalTab] = useState<
    'bagian1' | 'bagian2' | 'bagian3' | 'bagian4' | 'bagian5'
  >('bagian3');
  const [isSessionModalOpen, setIsSessionModalOpen] = useState(false);
  const [isExplainerModalOpen, setIsExplainerModalOpen] = useState(false);
  const [isMasterModalOpen, setIsMasterModalOpen] = useState(false);

  // Track live verification registry entries so Laporan Harian & shift manpower update immediately across accounts
  const [registryEntries, setRegistryEntries] = useState<LogbookVerificationRegistryEntry[]>(() =>
    getVerificationRegistry()
  );

  useEffect(() => {
    const syncReg = () => setRegistryEntries(getVerificationRegistry());
    syncReg();
    window.addEventListener('verification_registry_updated', syncReg);
    return () => window.removeEventListener('verification_registry_updated', syncReg);
  }, [sessions, masterNurses]);

  // Aggregate verified logbooks for the active date & shift across all accounts
  const verifiedShiftSummary = useMemo(() => {
    const activeShift: 'Pagi' | 'Siang' = shiftInfo.shift === 'Siang' ? 'Siang' : 'Pagi';
    return aggregateShiftVerifiedLogbooks({
      sessions,
      registryEntries,
      masterNurses,
      masterPatients,
      nurseSchedules,
      activeDateLabel: shiftInfo.date,
      activeShift,
      loggedInUserName: userRole === 'pj_shift' ? loggedInUser?.name : undefined,
      fallbackShiftInfo: shiftInfo
    });
  }, [
    sessions,
    registryEntries,
    masterNurses,
    masterPatients,
    nurseSchedules,
    shiftInfo.date,
    shiftInfo.shift,
    userRole,
    loggedInUser?.name
  ]);

  const liveCensus = verifiedShiftSummary.census;
  const liveClinicalIndicators = verifiedShiftSummary.clinicalIndicators;

  const [machineOverview, setMachineOverview] = useState<MachineOverview>(initialMachineOverview);

  // Sync machine overview whenever master beds change
  useEffect(() => {
    const total = masterBeds.length;
    const maintenance = masterBeds.filter((b) => b.status === 'maintenance').length;
    const ready = total - maintenance;
    const hepB = masterBeds.filter(
      (b) => b.designation === 'isolasi' || b.designation === 'isolasi_hepb'
    ).length;
    const hepC = masterBeds.filter((b) => b.designation === 'isolasi_hepc').length;
    setMachineOverview({
      totalCapacity: total,
      beroperasiSiapPakai: ready,
      maintenance,
      khususHepB: hepB,
      khususHepC: hepC
    });
  }, [masterBeds]);

  // Sync shift manpower, PJ Shift (dari Matriks Bulanan / pemilik akun), Kepala Ruangan, and ratio dynamically from verified shift logbooks
  useEffect(() => {
    const activeNurses = masterNurses.filter((n) => n.accountStatus !== 'nonaktif');
    const activeIso = indonesianDateLabelToIso(shiftInfo.date) || getCurrentIsoDateWib();
    const activeShiftBinary: 'Pagi' | 'Siang' = shiftInfo.shift === 'Siang' ? 'Siang' : 'Pagi';
    const matrixPj = resolvePjShiftEntryFromMatrix(
      nurseSchedules,
      activeNurses,
      activeIso,
      activeShiftBinary
    );

    const shiftPj =
      activeNurses.find(
        (n) =>
          resolveNurseSystemAccess(n) === 'pj_shift' &&
          n.shiftAssigned === shiftInfo.shift &&
          n.isOnDutyToday
      ) ||
      activeNurses.find(
        (n) => resolveNurseSystemAccess(n) === 'pj_shift' && n.shiftAssigned === shiftInfo.shift
      ) ||
      activeNurses.find((n) => resolveNurseSystemAccess(n) === 'pj_shift');

    const resolvedPjShift =
      matrixPj?.name ||
      shiftPj?.name ||
      (userRole === 'pj_shift' && loggedInUser?.name ? loggedInUser.name : '-');

    const resolvedDocs = resolveDoctorsFromSchedule(
      doctorSchedules,
      activeIso,
      shiftInfo.shift,
      shiftInfo.dokterDpjp,
      shiftInfo.dokterJaga
    );

    setShiftInfo((prev) => ({
      ...prev,
      pjShift: resolvedPjShift,
      kepalaRuangan: verifiedShiftSummary.kepalaRuanganName || DEFAULT_KEPALA_RUANGAN_NAME,
      dokterDpjp: resolvedDocs.dpjp || prev.dokterDpjp,
      dokterJaga: resolvedDocs.dokterJaga || prev.dokterJaga,
      totalPerawatDinas: verifiedShiftSummary.jumlahPerawatDinas,
      detailPerawat: verifiedShiftSummary.jumlahPerawatDinasLabel,
      perawatRatio: verifiedShiftSummary.rasioPerawatPasien
    }));
  }, [
    masterNurses,
    nurseSchedules,
    doctorSchedules,
    shiftInfo.date,
    shiftInfo.shift,
    userRole,
    loggedInUser?.name,
    verifiedShiftSummary.kepalaRuanganName,
    verifiedShiftSummary.jumlahPerawatDinas,
    verifiedShiftSummary.jumlahPerawatDinasLabel,
    verifiedShiftSummary.rasioPerawatPasien
  ]);

  const handleNurseDutySync = () => {
    setShiftInfo((prev) => ({
      ...prev,
      totalPerawatDinas: verifiedShiftSummary.jumlahPerawatDinas,
      detailPerawat: verifiedShiftSummary.jumlahPerawatDinasLabel,
      perawatRatio: verifiedShiftSummary.rasioPerawatPasien
    }));
  };

  // Propagate nurse name / role / account updates across active sessions, shiftInfo, and loggedInUser
  const handleNurseUpdated = (oldNurse: MasterNurse, updatedNurse: MasterNurse) => {
    if (oldNurse.name !== updatedNurse.name) {
      setSessions((prev) =>
        prev.map((s) =>
          s.nurseInCharge === oldNurse.name ? { ...s, nurseInCharge: updatedNurse.name } : s
        )
      );
    }

    setShiftInfo((prev) => ({
      ...prev,
      pjShift:
        updatedNurse.role === 'pj_shift' && updatedNurse.isOnDutyToday
          ? updatedNurse.name
          : prev.pjShift === oldNurse.name
          ? updatedNurse.name
          : prev.pjShift,
      kepalaRuangan:
        updatedNurse.role === 'kepala_ruangan'
          ? updatedNurse.name
          : prev.kepalaRuangan === oldNurse.name
          ? updatedNurse.name
          : prev.kepalaRuangan
    }));

    setLoggedInUser((prev) => {
      if (!prev || prev.nurseId !== updatedNurse.id) return prev;
      const nextAccess = resolveNurseSystemAccess(updatedNurse);
      setUserRole(nextAccess);
      return {
        ...prev,
        name: updatedNurse.name,
        email: updatedNurse.email || prev.email,
        username: updatedNurse.username,
        nip: updatedNurse.nip,
        userRole: nextAccess,
        role:
          nextAccess === 'administrator'
            ? 'Administrator Unit HD'
            : updatedNurse.role === 'kepala_ruangan'
            ? 'Kepala Ruangan (Ka. Ruangan)'
            : updatedNurse.role === 'pj_shift'
            ? 'Penanggung Jawab Shift (PJ Shift)'
            : 'Perawat Pelaksana Dialisis'
      };
    });
  };

  // Propagate bed number rename across active patient sessions
  const handleBedUpdated = (oldBed: MasterBed, updatedBed: MasterBed) => {
    if (oldBed.bedNumber !== updatedBed.bedNumber) {
      setSessions((prev) =>
        prev.map((s) =>
          s.bedNumber === oldBed.bedNumber ? { ...s, bedNumber: updatedBed.bedNumber } : s
        )
      );
    }
  };

  const handleDoctorUpdated = (_oldDoc: MasterDoctor, updatedDoc: MasterDoctor) => {
    setMasterDoctors((prev) =>
      updateMasterDoctorData(prev, updatedDoc.id, updatedDoc)
    );
  };

  // Handle saving new or updated patient session
  const handleSaveSession = (savedSession: PatientHDSession) => {
    const fullSession = ensureFullBagianData(savedSession);
    setSessions((prev) => {
      const exists = prev.some((s) => s.id === fullSession.id);
      if (exists) {
        return prev.map((s) => (s.id === fullSession.id ? fullSession : s));
      } else {
        return [...prev, fullSession];
      }
    });
    // Immediately persist to Cloud Firestore for real-time synchronization
    saveDialysisSessionCloud(fullSession).catch((err) => {
      console.warn('Could not sync session to Firestore:', err);
    });
  };

  const handleOpenEditSession = (
    session?: PatientHDSession,
    initialTab?: 'bagian1' | 'bagian2' | 'bagian3' | 'bagian4' | 'bagian5'
  ) => {
    setSelectedSession(session || null);
    if (initialTab) {
      setSessionModalTab(initialTab);
    } else {
      setSessionModalTab('bagian3');
    }
    setIsSessionModalOpen(true);
  };

  const handleQuickToggleComplete = (id: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, sessionStatus: 'selesai' } : s))
    );
  };

  const handleLoadBenchmarkData = () => {
    resetVerificationStorageToBenchmark();
    setSessions(benchmarkSamplePatients.map(ensureFullBagianData));
    setMasterPatients(sampleBenchmarkPatients);
    setMasterNurses(
      sampleBenchmarkNurses.map((n) => ({
        ...n,
        systemAccess: resolveNurseSystemAccess(n)
      }))
    );
    setMasterBeds(sampleBenchmarkBeds);
    setIsCustomDate(false);
    setShiftInfo({
      ...benchmarkShiftInfo,
      date: getCurrentIndonesianFullDate()
    });
    setMachineOverview(benchmarkMachineOverview);
    setOperationalItems(initialOperationalItems);
    setSbar(initialSbar);
    const shortStamp = formatShortIndonesianTimestampWib();
    setSignatures({
      pjShift: {
        name: benchmarkShiftInfo.pjShift,
        signed: true,
        signedAt: shortStamp
      },
      pjBerikutnya: {
        name: benchmarkShiftInfo.pjShiftBerikutnya,
        signed: true,
        signedAt: shortStamp
      },
      kepalaRuangan: {
        name: benchmarkShiftInfo.kepalaRuangan,
        signed: true,
        signedAt: shortStamp
      }
    });
  };

  // Render Login Page if not authenticated
  if (!isAuthenticated) {
    return (
      <LoginPage
        onLogin={handleLogin}
        shiftInfo={shiftInfo}
        masterNurses={masterNurses}
        nurseSchedules={nurseSchedules}
      />
    );
  }

  return (
    <div className="relative min-h-screen text-slate-900 font-sans antialiased overflow-x-clip print:bg-white">
      {/* Full-Viewport Clean RS Happy Land Hospital Exterior Background */}
      <div
        aria-hidden="true"
        className="fixed inset-0 z-0 bg-gradient-to-br from-[#6eb2dc] via-[#b8dcf0] to-[#8eb6c9] print:hidden"
      >
        {!hospitalBgError && (
          <img
            src={hospitalBgSrc}
            alt="Gedung RS Happy Land Medical Centre Yogyakarta"
            referrerPolicy="no-referrer"
            onError={handleHospitalBgError}
            className="w-full h-full object-cover object-center opacity-70"
          />
        )}
        {/* Soft airy sky-blue atmospheric glaze matching RSHL UI */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#cbe5f6]/55 via-[#e4f1fa]/45 to-[#c5dce9]/55" />
      </div>

      {/* Unified RSHL Frosted-Glass Sidebar + Top Header + Workspace Container for All 4 Roles */}
      <AppShellLayout
        currentTab={currentTab}
        onSelectTab={handleSelectTab}
        shiftInfo={shiftInfo}
        userRole={userRole}
        loggedInUserName={loggedInUser?.name}
        onDateChange={handleActiveDateChange}
        isCustomDate={isDateCustomFromToday}
        onResetDateToToday={handleResetDateToToday}
        onLogout={handleLogout}
        isCloudConnected={isCloudConnected}
        isQuotaExceeded={isQuotaExceeded}
      >
        {currentTab === 'dashboard' && accessibleTabs.includes('dashboard') && (
          <DashboardView
            masterNurses={masterNurses}
            masterPatients={masterPatients}
            sessions={sessions}
            shiftInfo={shiftInfo}
            loggedInUser={loggedInUser}
            userRole={userRole}
            onNavigateTab={handleSelectTab}
          />
        )}

        {currentTab === 'lap_harian' && accessibleTabs.includes('lap_harian') && (
          <LapHarianView
            shiftInfo={shiftInfo}
            setShiftInfo={setShiftInfo}
            census={liveCensus}
            machineOverview={machineOverview}
            setMachineOverview={setMachineOverview}
            clinicalIndicators={liveClinicalIndicators}
            operationalItems={operationalItems}
            setOperationalItems={setOperationalItems}
            sbar={sbar}
            setSbar={setSbar}
            signatures={signatures}
            setSignatures={setSignatures}
            sessions={sessions}
            userRole={userRole}
            loggedInUser={loggedInUser}
            masterNurses={masterNurses}
            masterPatients={masterPatients}
            masterDoctors={masterDoctors}
            nurseSchedules={nurseSchedules}
            doctorSchedules={doctorSchedules}
            cloudNurseLogbooks={cloudNurseLogbooks}
            onDateChange={handleActiveDateChange}
            isCustomDate={isDateCustomFromToday}
            onResetDateToToday={handleResetDateToToday}
          />
        )}

        {currentTab === 'logbook' && accessibleTabs.includes('logbook') && (
          <PelaksanaView
            sessions={sessions}
            cloudNurseLogbooks={cloudNurseLogbooks}
            onOpenSessionModal={handleOpenEditSession}
            onQuickToggleComplete={handleQuickToggleComplete}
            onOpenMasterModal={() => {
              if (canAccessMasterData(userRole)) {
                setIsMasterModalOpen(true);
              }
            }}
            shiftInfo={shiftInfo}
            masterPatients={masterPatients}
            masterNurses={masterNurses}
            masterBeds={masterBeds}
            masterDoctors={masterDoctors}
            nurseSchedules={nurseSchedules}
            doctorSchedules={doctorSchedules}
            loggedInUser={loggedInUser}
            userRole={userRole}
            onShiftChange={handleLogbookShiftChange}
            onDateChange={handleActiveDateChange}
            isCustomDate={isDateCustomFromToday}
            onResetDateToToday={handleResetDateToToday}
            onSyncNurseSessions={handleSyncNurseLogbookSessions}
            onNavigateToVerifikasi={() => handleSelectTab('verifikasi')}
            onNavigateToRiwayat={() => handleSelectTab('riwayat')}
          />
        )}

        {currentTab === 'laporan_pasien' && accessibleTabs.includes('laporan_pasien') && (
          <LaporanPasienView
            shiftInfo={shiftInfo}
            userRole={userRole}
            loggedInUserName={loggedInUser?.name}
            sessions={sessions}
            masterNurses={masterNurses}
            masterPatients={masterPatients}
            masterDoctors={masterDoctors}
            nurseSchedules={nurseSchedules}
            doctorSchedules={doctorSchedules}
            cloudNurseLogbooks={cloudNurseLogbooks}
            onDateChange={handleActiveDateChange}
            isCustomDate={isDateCustomFromToday}
            onResetDateToToday={handleResetDateToToday}
            onNavigateToLogbook={() => handleSelectTab('logbook')}
          />
        )}

        {currentTab === 'verifikasi' && canVerifyLogbook(userRole) && (
          <VerifikasiView
            shiftInfo={shiftInfo}
            masterNurses={masterNurses}
            userRole={userRole}
            loggedInUser={loggedInUser}
            sessions={sessions}
            cloudNurseLogbooks={cloudNurseLogbooks}
            onVerificationUpdated={handleNurseVerificationUpdated}
            onVerifyPatientSession={handleVerifyPatientSession}
            onSaveSession={handleSaveSession}
          />
        )}

        {currentTab === 'riwayat' && accessibleTabs.includes('riwayat') && (
          <RiwayatView
            sessions={sessions}
            shiftInfo={shiftInfo}
            userRole={userRole}
            loggedInUser={loggedInUser}
            masterNurses={masterNurses}
            onOpenSessionModal={handleOpenEditSession}
            onNavigateToLogbook={() => handleSelectTab('logbook')}
            onNavigateToVerifikasi={() => handleSelectTab('verifikasi')}
          />
        )}

        {currentTab === 'lap_bulanan' && accessibleTabs.includes('lap_bulanan') && (
          <LapBulananView
            masterNurses={masterNurses}
            loggedInUser={loggedInUser}
            shiftInfo={shiftInfo}
            userRole={userRole}
            sessions={sessions}
            cloudNurseLogbooks={cloudNurseLogbooks}
            onNavigateToLogbook={() => handleSelectTab('logbook')}
            onNavigateToVerifikasi={() => handleSelectTab('verifikasi')}
          />
        )}

        {currentTab === 'jadwal_dinas' && accessibleTabs.includes('jadwal_dinas') && (
          <JadwalDinasView
            nurseSchedules={nurseSchedules}
            setNurseSchedules={setNurseSchedules}
            doctorSchedules={doctorSchedules}
            setDoctorSchedules={setDoctorSchedules}
            masterNurses={masterNurses}
            masterDoctors={masterDoctors}
            shiftInfo={shiftInfo}
            setShiftInfo={setShiftInfo}
            userRole={userRole}
            currentIsoDate={indonesianDateLabelToIso(shiftInfo.date) || getCurrentIsoDateWib()}
            initialScheduleTab={scheduleMatrixTab}
            onApplyScheduleToShiftInfo={(appliedInfo) => {
              setShiftInfo((prev) => ({
                ...prev,
                ...appliedInfo
              }));
            }}
          />
        )}

        {(currentTab === 'data_pasien' ||
          currentTab === 'data_perawat' ||
          currentTab === 'data_mesin' ||
          currentTab === 'data_dokter') &&
          canAccessMasterData(userRole) && (
            <MasterDataView
              section={
                currentTab === 'data_pasien'
                  ? 'patients'
                  : currentTab === 'data_perawat'
                  ? 'nurses'
                  : currentTab === 'data_mesin'
                  ? 'beds'
                  : 'doctors'
              }
              masterPatients={masterPatients}
              setMasterPatients={setMasterPatients}
              masterNurses={masterNurses}
              setMasterNurses={setMasterNurses}
              masterBeds={masterBeds}
              setMasterBeds={setMasterBeds}
              masterDoctors={masterDoctors}
              setMasterDoctors={setMasterDoctors}
              onNurseDutyChange={handleNurseDutySync}
              onNurseUpdated={handleNurseUpdated}
              onBedUpdated={handleBedUpdated}
              onDoctorUpdated={handleDoctorUpdated}
              onOpenScheduleMatrix={(targetTab) => {
                setScheduleMatrixTab(targetTab);
                handleSelectTab('jadwal_dinas');
              }}
            />
          )}

        {currentTab === 'my_account' && accessibleTabs.includes('my_account') && (
          <MyAccountView
            shiftInfo={shiftInfo}
            masterNurses={masterNurses}
            onOpenMasterDataModal={() => {
              if (canAccessMasterData(userRole)) {
                setIsMasterModalOpen(true);
              }
            }}
            onLogoutSuccess={handleLogout}
            userRole={userRole}
            onRoleChange={handleRoleChange}
            loggedInUser={loggedInUser}
            onUpdateOwnPassword={(currentPass, nextPass) => {
              if (!loggedInUser?.nurseId) return { ok: true };
              const target = masterNurses.find((n) => n.id === loggedInUser.nurseId);
              if (!target) return { ok: true };
              const expected = target.password || '12345';
              if (currentPass !== expected) {
                return { ok: false, error: 'Kata sandi saat ini tidak sesuai.' };
              }
              setMasterNurses((prev) =>
                updateMasterNurseData(prev, target.id, { password: nextPass })
              );
              return { ok: true };
            }}
          />
        )}
      </AppShellLayout>

      {/* Session Edit Modal */}
      <SessionModal
        isOpen={isSessionModalOpen}
        onClose={() => setIsSessionModalOpen(false)}
        session={selectedSession}
        sessions={sessions}
        cloudNurseLogbooks={cloudNurseLogbooks}
        initialTab={sessionModalTab}
        onSave={handleSaveSession}
        masterPatients={masterPatients}
        masterNurses={masterNurses}
        masterBeds={masterBeds}
        masterDoctors={masterDoctors}
        shiftInfo={shiftInfo}
        userRole={userRole}
        loggedInUserName={loggedInUser?.name}
      />

      {/* Architecture Explainer Modal */}
      <SystemDesignExplainerModal
        isOpen={isExplainerModalOpen}
        onClose={() => setIsExplainerModalOpen(false)}
      />

      {/* Master Data Management Modal (Restricted to Administrator) */}
      {canAccessMasterData(userRole) && (
        <MasterDataManagementModal
          isOpen={isMasterModalOpen}
          onClose={() => setIsMasterModalOpen(false)}
          masterPatients={masterPatients}
          setMasterPatients={setMasterPatients}
          masterNurses={masterNurses}
          setMasterNurses={setMasterNurses}
          masterBeds={masterBeds}
          setMasterBeds={setMasterBeds}
          masterDoctors={masterDoctors}
          setMasterDoctors={setMasterDoctors}
          onNurseDutyChange={handleNurseDutySync}
        />
      )}

      {/* Print / PDF Help Modal (for iFrame blocked print dialogs) */}
      <PrintHelpModal
        isOpen={printHelpState.isOpen}
        onClose={() => setPrintHelpState({ isOpen: false })}
        documentTitle={printHelpState.documentTitle}
        errorMessage={printHelpState.errorMessage}
      />
    </div>
  );
}
