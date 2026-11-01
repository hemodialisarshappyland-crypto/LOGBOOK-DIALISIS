import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getMonthCalendarDays,
  applyNurseMatrixCell,
  applyDoctorMatrixCell,
  entryToNurseMatrixCode,
  entryToDoctorMatrixCode,
  generateMonthlyNurseRoster,
  generateMonthlyDoctorRoster,
  resolveNurseMatrixShiftForDate,
  resolvePjShiftEntryFromMatrix,
  resolveScheduledDoctorsFromMatrix
} from './monthlyScheduleMatrixHelpers.ts';
import { sampleBenchmarkNurses, initialMasterDoctors } from '../data/mockMasterData.ts';

test('getMonthCalendarDays returns exact days in month with accurate weekdays', () => {
  const oct2026 = getMonthCalendarDays(2026, 10);
  assert.equal(oct2026.length, 31);
  assert.equal(oct2026[0].isoDate, '2026-10-01');
  assert.equal(oct2026[0].dayShort, 'Km');
  assert.equal(oct2026[24].isoDate, '2026-10-25');
  assert.equal(oct2026[24].isSunday, true);

  const feb2028Leap = getMonthCalendarDays(2028, 2);
  assert.equal(feb2028Leap.length, 29);
});

test('applyNurseMatrixCell enforces single PJ Shift per shift on a given date', () => {
  const pjA = sampleBenchmarkNurses[1];
  const pjB = sampleBenchmarkNurses[2];
  const iso = '2026-10-28';

  let list = applyNurseMatrixCell([], pjA, iso, 'PJ-P', 'PJ Pagi Utama');
  assert.equal(list.length, 1);
  assert.equal(entryToNurseMatrixCode(list[0]), 'PJ-P');

  // Assigning pjB to PJ-P on the same date demotes pjA to regular Pagi ('P')
  list = applyNurseMatrixCell(list, pjB, iso, 'PJ-P');
  const entryA = list.find((s) => s.nurseId === pjA.id);
  const entryB = list.find((s) => s.nurseId === pjB.id);
  assert.equal(entryToNurseMatrixCode(entryA), 'P');
  assert.equal(entryToNurseMatrixCode(entryB), 'PJ-P');

  // Clearing pjB with '-' removes pjB's entry
  list = applyNurseMatrixCell(list, pjB, iso, '-');
  assert.equal(list.find((s) => s.nurseId === pjB.id), undefined);
});

test('generateMonthlyNurseRoster and generateMonthlyDoctorRoster cover all days of month', () => {
  const nurseRoster = generateMonthlyNurseRoster(2026, 10, sampleBenchmarkNurses);
  assert.equal(nurseRoster.length, sampleBenchmarkNurses.length * 31);

  const docRoster = generateMonthlyDoctorRoster(2026, 10, initialMasterDoctors);
  assert.equal(docRoster.length, initialMasterDoctors.length * 31);

  const doc0 = initialMasterDoctors[0];
  const edited = applyDoctorMatrixCell(docRoster, doc0, '2026-10-15', 'PS', 'Seharian');
  const target = edited.find((d) => d.doctorId === doc0.id && d.date === '2026-10-15');
  assert.equal(entryToDoctorMatrixCode(target), 'PS');
  assert.equal(target?.notes, 'Seharian');
});

test('resolveNurseMatrixShiftForDate, resolvePjShiftEntryFromMatrix, and resolveScheduledDoctorsFromMatrix map Matrix codes to Logbook inputs', () => {
  const iso = '2026-10-29';
  const pelaksana = sampleBenchmarkNurses[3];
  const pjSiang = sampleBenchmarkNurses[2];
  const offNurse = sampleBenchmarkNurses[4];

  let roster = applyNurseMatrixCell([], pelaksana, iso, 'S');
  roster = applyNurseMatrixCell(roster, pjSiang, iso, 'PJ-S');
  roster = applyNurseMatrixCell(roster, offNurse, iso, 'L');

  // Pelaksana scheduled Siang ('S') resolves to logbookShift === 'Siang'
  const resolvedPelaksana = resolveNurseMatrixShiftForDate(
    roster,
    { id: pelaksana.id, name: pelaksana.name },
    iso
  );
  assert.equal(resolvedPelaksana.matrixCode, 'S');
  assert.equal(resolvedPelaksana.logbookShift, 'Siang');
  assert.equal(resolvedPelaksana.isPjShift, false);
  assert.equal(resolvedPelaksana.isOffOrLeave, false);

  // Off nurse ('L') resolves to logbookShift === null & isOffOrLeave === true
  const resolvedOff = resolveNurseMatrixShiftForDate(
    roster,
    { name: offNurse.name },
    iso
  );
  assert.equal(resolvedOff.matrixCode, 'L');
  assert.equal(resolvedOff.logbookShift, null);
  assert.equal(resolvedOff.isOffOrLeave, true);

  // PJ Shift verifier for Siang resolves directly to pjSiang
  const resolvedPj = resolvePjShiftEntryFromMatrix(
    roster,
    sampleBenchmarkNurses,
    iso,
    'Siang'
  );
  assert.ok(resolvedPj);
  assert.equal(resolvedPj.name, pjSiang.name);
  assert.equal(resolvedPj.fromMatrix, true);

  // Doctor Matrix resolution for Shift Siang
  const dpjpDoc = initialMasterDoctors.find((d) => d.role === 'dpjp' || d.role === 'both')!;
  const jagaDoc = initialMasterDoctors.find((d) => d.role === 'dokter_jaga')!;
  let docRoster = applyDoctorMatrixCell([], dpjpDoc, iso, 'PS');
  docRoster = applyDoctorMatrixCell(docRoster, jagaDoc, iso, 'S');

  const resolvedDocs = resolveScheduledDoctorsFromMatrix(docRoster, iso, 'Siang');
  assert.equal(resolvedDocs.primaryDpjp, dpjpDoc.name);
  assert.equal(resolvedDocs.primaryJaga, jagaDoc.name);
});

