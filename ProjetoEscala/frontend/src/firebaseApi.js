import {
  EmailAuthProvider,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
} from 'firebase/auth';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { auth, db, usernameToEmail, createAuthUserWithSecondaryApp } from './firebaseClient';
import { MOVFIT_EMPLOYEES, MOVFIT_HOLIDAYS_2026, MOVFIT_SHIFTS } from './utils/movfitSchedule';

function getToken() {
  return localStorage.getItem('escala_token');
}

async function setToken(token) {
  if (token) localStorage.setItem('escala_token', token);
  else {
    localStorage.removeItem('escala_token');
    await signOut(auth).catch(() => {});
  }
}

function waitForAuth() {
  return new Promise(resolve => {
    if (auth.currentUser) return resolve(auth.currentUser);
    const unsub = onAuthStateChanged(auth, user => {
      unsub();
      resolve(user);
    });
  });
}

async function requireUser() {
  const user = await waitForAuth();
  if (!user) throw new Error('Sessao expirada. Faca login novamente.');
  return user;
}

async function currentProfile() {
  const user = await requireUser();
  const snap = await getDoc(doc(db, 'users', user.uid));
  if (!snap.exists()) {
    return { id: user.uid, username: user.email?.split('@')[0] || 'usuario', role: 'user' };
  }
  return { id: user.uid, ...snap.data() };
}

async function requireAdmin() {
  const profile = await currentProfile();
  if (profile.role !== 'admin') throw new Error('Apenas administradores podem executar esta acao.');
  return profile;
}

function withId(snap) {
  return { id: snap.id, ...snap.data() };
}

async function list(name, orderField = null) {
  const ref = collection(db, name);
  const q = orderField ? query(ref, orderBy(orderField)) : ref;
  const snaps = await getDocs(q);
  return snaps.docs.map(withId);
}

async function create(name, data) {
  await requireAdmin();
  const ref = await addDoc(collection(db, name), { ...data, created_at: new Date().toISOString() });
  return { id: ref.id, ...data };
}

async function update(name, id, data) {
  await requireAdmin();
  await updateDoc(doc(db, name, id), data);
  const fresh = await getDoc(doc(db, name, id));
  return withId(fresh);
}

async function remove(name, id) {
  await requireAdmin();
  await deleteDoc(doc(db, name, id));
  return { message: 'Removido' };
}

function parseShift(s) {
  const legacy = s.slots || 1;
  return {
    ...s,
    slots: legacy,
    sunday_slots: s.sunday_slots != null ? s.sunday_slots : legacy,
    holiday_slots: s.holiday_slots != null ? s.holiday_slots : legacy,
  };
}

async function getShifts() {
  await ensureMovfitSeed();
  return (await list('shifts', 'start_time')).map(parseShift);
}

async function getColaboradores() {
  await ensureMovfitSeed();
  return (await list('colaboradores', 'name')).map(c => ({
    ...c,
    active: c.active !== false,
    work_days: Array.isArray(c.work_days) ? c.work_days : [],
    schedule_type: c.schedule_type || 'fixed',
  }));
}

async function getTeam() {
  await ensureMovfitSeed();
  const [members, shifts] = await Promise.all([list('team_members', 'name'), getShifts()]);
  const shiftById = Object.fromEntries(shifts.map(s => [s.id, s]));
  return members.map(m => ({
    ...m,
    active: m.active !== false,
    in_rotation: m.in_rotation !== false,
    shift: shiftById[m.shift_id] || null,
  }));
}

async function createMember(data) {
  await requireAdmin();
  const colab = data.colaborador_id ? await getDoc(doc(db, 'colaboradores', data.colaborador_id)) : null;
  const payload = {
    name: colab?.exists() ? colab.data().name : data.name,
    colaborador_id: data.colaborador_id || null,
    shift_id: data.shift_id,
    active: true,
    in_rotation: data.in_rotation !== false,
    monthly_sunday_limit: data.monthly_sunday_limit ?? null,
    monthly_holiday_limit: data.monthly_holiday_limit ?? null,
  };
  const created = await create('team_members', payload);
  const shifts = await getShifts();
  return { ...created, shift: shifts.find(s => s.id === created.shift_id) || null };
}

async function updateMember(id, data) {
  const updated = await update('team_members', id, data);
  const shifts = await getShifts();
  return { ...updated, shift: shifts.find(s => s.id === updated.shift_id) || null };
}

async function getHolidays() {
  await ensureMovfitSeed();
  return list('holidays', 'date');
}

async function deleteHoliday(dateStr) {
  await requireAdmin();
  const snaps = await getDocs(query(collection(db, 'holidays'), where('date', '==', dateStr), limit(1)));
  await Promise.all(snaps.docs.map(s => deleteDoc(s.ref)));
  return { message: 'Feriado removido' };
}

async function importHolidays(holidays) {
  await requireAdmin();
  let imported = 0;
  for (const h of holidays) {
    const id = `holiday-${h.date}`;
    await setDoc(doc(db, 'holidays', id), {
      date: h.date,
      label: h.label || h.name || 'Feriado',
      is_fixed: !!h.is_fixed,
      scope: h.scope || 'national',
      state: h.state || null,
      city: h.city || null,
    }, { merge: true });
    imported++;
  }
  return { imported, dates: holidays.map(h => h.date) };
}

async function getOverrides() {
  const rows = await list('overrides');
  return Object.fromEntries(rows.map(row => [row.id, row.assignments || {}]));
}

async function setOverride(dateStr, assignments, reason) {
  await requireAdmin();
  await setDoc(doc(db, 'overrides', dateStr), {
    assignments,
    reason: reason || '',
    updated_at: new Date().toISOString(),
  }, { merge: true });
  return { date: dateStr, assignments };
}

async function deleteOverride(dateStr) {
  await requireAdmin();
  await deleteDoc(doc(db, 'overrides', dateStr));
  return { message: 'Override removido' };
}

async function getAbsences() {
  const [absences, team] = await Promise.all([list('absences', 'date'), getTeam()]);
  const memberById = Object.fromEntries(team.map(m => [m.id, m]));
  return absences.map(a => ({ ...a, member_name: memberById[a.member_id]?.name || a.member_id }));
}

async function getSettings() {
  const snap = await getDoc(doc(db, 'settings', 'app'));
  return snap.exists() ? snap.data() : { schedule_start_date: '2026-01-01', compensatory_monday_rest: false };
}

async function updateSettings(data) {
  await requireAdmin();
  await setDoc(doc(db, 'settings', 'app'), data, { merge: true });
  return getSettings();
}

async function getScheduleSnapshots(year, month) {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  const snaps = await getDocs(query(
    collection(db, 'schedule_snapshots'),
    where('month', '==', prefix)
  ));
  const out = {};
  for (const s of snaps.docs) {
    const row = s.data();
    out[row.date] = out[row.date] || {};
    out[row.date][row.shift_id] = row.members || [];
  }
  return out;
}

async function saveScheduleSnapshot(schedule, overwrite = false) {
  await requireAdmin();
  const batch = writeBatch(db);
  let saved = 0;
  for (const [dateStr, shifts] of Object.entries(schedule || {})) {
    for (const [shiftId, members] of Object.entries(shifts || {})) {
      const id = `${dateStr}_${shiftId}`;
      const ref = doc(db, 'schedule_snapshots', id);
      if (!overwrite) {
        const existing = await getDoc(ref);
        if (existing.exists()) continue;
      }
      batch.set(ref, {
        date: dateStr,
        month: dateStr.slice(0, 7),
        shift_id: shiftId,
        members: Array.isArray(members) ? members.filter(Boolean) : [],
        generated_at: new Date().toISOString(),
      });
      saved++;
    }
  }
  await batch.commit();
  return { saved };
}

async function clearAllSnapshots() {
  await requireAdmin();
  const snaps = await getDocs(collection(db, 'schedule_snapshots'));
  await Promise.all(snaps.docs.map(s => deleteDoc(s.ref)));
  return { removed: snaps.size };
}

async function clearSnapshotsBefore(dateStr) {
  await requireAdmin();
  const snaps = await getDocs(query(collection(db, 'schedule_snapshots'), where('date', '<', dateStr)));
  await Promise.all(snaps.docs.map(s => deleteDoc(s.ref)));
  return { removed: snaps.size };
}

async function getHistoricalCounts(beforeDate) {
  const [snapshots, overrides, holidays] = await Promise.all([
    list('schedule_snapshots'),
    getOverrides(),
    getHolidays(),
  ]);
  const holidaysSet = new Set(holidays.map(h => h.date));
  const sundayCounts = {};
  const holidayCounts = {};
  const seenOverride = new Set();

  const isSunday = (dateStr) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d).getDay() === 0;
  };
  const bump = (memberId, dateStr) => {
    if (!memberId) return;
    if (isSunday(dateStr)) sundayCounts[memberId] = (sundayCounts[memberId] || 0) + 1;
    else if (holidaysSet.has(dateStr)) holidayCounts[memberId] = (holidayCounts[memberId] || 0) + 1;
  };

  for (const [dateStr, assignments] of Object.entries(overrides)) {
    if (beforeDate && dateStr >= beforeDate) continue;
    for (const [shiftId, ids] of Object.entries(assignments || {})) {
      seenOverride.add(`${dateStr}:${shiftId}`);
      for (const id of Array.isArray(ids) ? ids : [ids]) bump(id, dateStr);
    }
  }
  for (const row of snapshots) {
    if (beforeDate && row.date >= beforeDate) continue;
    if (seenOverride.has(`${row.date}:${row.shift_id}`)) continue;
    for (const id of row.members || []) bump(id, row.date);
  }
  return { sundayCounts, holidayCounts };
}

async function login(username, password) {
  const cred = await signInWithEmailAndPassword(auth, usernameToEmail(username), password);
  const profile = await currentProfile();
  localStorage.setItem('escala_token', 'firebase');
  return { token: 'firebase', user: profile, firebaseUser: cred.user };
}

async function me() {
  return { user: await currentProfile() };
}

async function changePassword(currentPassword, newPassword) {
  const user = await requireUser();
  const credential = EmailAuthProvider.credential(user.email, currentPassword);
  await reauthenticateWithCredential(user, credential);
  await updatePassword(user, newPassword);
  return { message: 'Senha alterada com sucesso' };
}

async function getUsers() {
  await requireAdmin();
  return list('users', 'username');
}

async function createUser(data) {
  await requireAdmin();
  const cred = await createAuthUserWithSecondaryApp(data.username, data.password);
  const username = data.username.trim().toLowerCase();
  const payload = {
    username,
    name: data.name || data.username,
    role: data.role || 'user',
    created_at: new Date().toISOString(),
  };
  const batch = writeBatch(db);
  batch.set(doc(db, 'users', cred.user.uid), payload);
  batch.set(doc(db, 'username_reservations', username), {
    username,
    status: 'active',
    user_id: cred.user.uid,
    updated_at: new Date().toISOString(),
  }, { merge: true });
  await batch.commit();
  return { id: cred.user.uid, ...payload };
}

async function updateUser(id, data) {
  await requireAdmin();
  const payload = { ...data };
  delete payload.password;
  await updateDoc(doc(db, 'users', id), payload);
  const fresh = await getDoc(doc(db, 'users', id));
  return withId(fresh);
}

async function requestRegister(data) {
  const username = data.username.trim().toLowerCase();
  const reservation = await getDoc(doc(db, 'username_reservations', username));
  if (reservation.exists()) throw new Error('Nome de usuario indisponivel');
  const requestRef = doc(collection(db, 'user_requests'));
  const batch = writeBatch(db);
  batch.set(requestRef, {
    name: data.name,
    username,
    requested_password: data.password,
    status: 'pending',
    created_at: new Date().toISOString(),
  });
  batch.set(doc(db, 'username_reservations', username), {
    username,
    status: 'pending',
    request_id: requestRef.id,
    updated_at: new Date().toISOString(),
  });
  await batch.commit();
  return { message: 'Solicitacao enviada' };
}

async function checkUsername(username) {
  const clean = username.trim().toLowerCase();
  const reservation = await getDoc(doc(db, 'username_reservations', clean));
  if (!reservation.exists()) return { available: true };
  const status = reservation.data().status;
  return { available: false, reason: status === 'pending' ? 'Solicitacao pendente' : 'Usuario ja existe' };
}

async function getUserRequests(status = 'pending') {
  await requireAdmin();
  return (await list('user_requests', 'created_at')).filter(r => r.status === status);
}

async function approveUserRequest(id) {
  await requireAdmin();
  const snap = await getDoc(doc(db, 'user_requests', id));
  if (!snap.exists()) throw new Error('Solicitacao nao encontrada');
  const req = { id: snap.id, ...snap.data() };
  const user = await createUser({ username: req.username, name: req.name, password: req.requested_password, role: 'user' });
  await updateDoc(doc(db, 'user_requests', id), { status: 'approved', processed_at: new Date().toISOString(), requested_password: null });
  return { user };
}

async function rejectUserRequest(id) {
  await requireAdmin();
  const snap = await getDoc(doc(db, 'user_requests', id));
  const batch = writeBatch(db);
  batch.update(doc(db, 'user_requests', id), { status: 'rejected', processed_at: new Date().toISOString(), requested_password: null });
  if (snap.exists()) batch.delete(doc(db, 'username_reservations', snap.data().username));
  await batch.commit();
  return { message: 'Rejeitado' };
}

async function ensureMovfitSeed() {
  const user = auth.currentUser;
  if (!user) return;
  const profileSnap = await getDoc(doc(db, 'users', user.uid)).catch(() => null);
  if (!profileSnap?.exists() || profileSnap.data().role !== 'admin') return;

  const marker = await getDoc(doc(db, 'settings', 'seed'));
  if (marker.exists() && marker.data().movfit2026) return;

  const batch = writeBatch(db);
  for (const shift of MOVFIT_SHIFTS) {
    batch.set(doc(db, 'shifts', `movfit-${shift.code.toLowerCase()}`), {
      label: shift.code,
      start_time: shift.start_time,
      end_time: shift.end_time,
      slots: 1,
      sunday_slots: 1,
      holiday_slots: 1,
      created_at: new Date().toISOString(),
    }, { merge: true });
  }

  const shiftFor = (index) => index === 0 ? 'movfit-f1' : index < 4 ? 'movfit-f2' : index < 6 ? 'movfit-f3' : 'movfit-f4';
  MOVFIT_EMPLOYEES.forEach((employee, index) => {
    const colabId = `movfit-${employee.name.toLowerCase()}`;
    batch.set(doc(db, 'colaboradores', colabId), {
      name: employee.name,
      schedule_type: 'fixed',
      work_days: [1, 2, 3, 4, 5],
      work_start: employee.regular_start,
      work_end: employee.regular_end,
      active: true,
      created_at: new Date().toISOString(),
    }, { merge: true });
    batch.set(doc(db, 'team_members', `team-${colabId}`), {
      name: employee.name,
      colaborador_id: colabId,
      shift_id: shiftFor(index),
      active: true,
      in_rotation: true,
      monthly_sunday_limit: null,
      monthly_holiday_limit: null,
      created_at: new Date().toISOString(),
    }, { merge: true });
  });

  for (const [date, label, scope] of MOVFIT_HOLIDAYS_2026) {
    batch.set(doc(db, 'holidays', `holiday-${date}`), {
      date, label, scope,
      is_fixed: true,
      created_at: new Date().toISOString(),
    }, { merge: true });
  }

  batch.set(doc(db, 'settings', 'app'), {
    schedule_start_date: '2026-01-01',
    compensatory_monday_rest: false,
  }, { merge: true });
  batch.set(doc(db, 'settings', 'seed'), { movfit2026: true, seeded_at: new Date().toISOString() }, { merge: true });
  await batch.commit();
}

async function fetchBrasilAPI(year) {
  const res = await fetch(`https://brasilapi.com.br/api/feriados/v1/${year}`);
  if (!res.ok) throw new Error('Erro ao buscar BrasilAPI');
  return res.json();
}

const firebaseApi = {
  login,
  me,
  changePassword,
  getUsers,
  createUser,
  updateUser,
  deleteUser: (id) => remove('users', id),
  getShifts,
  createShift: (data) => create('shifts', { ...data, label: data.label?.trim() }),
  updateShift: (id, data) => update('shifts', id, data),
  deleteShift: (id) => remove('shifts', id),
  getColaboradores,
  createColaborador: (data) => create('colaboradores', { ...data, active: true }),
  updateColaborador: (id, data) => update('colaboradores', id, data),
  deleteColaborador: (id) => remove('colaboradores', id),
  getTeam,
  createMember,
  updateMember,
  deleteMember: (id) => remove('team_members', id),
  getHolidays,
  createHoliday: (data) => create('holidays', data),
  updateHoliday: (id, data) => update('holidays', id, data),
  deleteHoliday,
  fetchBrasilAPI,
  importHolidays,
  getOverrides,
  setOverride,
  deleteOverride,
  getAbsences,
  createAbsence: (data) => create('absences', data),
  deleteAbsence: (id) => remove('absences', id),
  getScheduleLogs: () => Promise.resolve([]),
  getSettings,
  updateSettings,
  getScheduleSnapshots,
  getHistoricalCounts,
  saveScheduleSnapshot,
  clearAllSnapshots,
  clearSnapshotsBefore,
  listAutoBackups: () => Promise.resolve([]),
  requestRegister,
  checkUsername,
  getUserRequests,
  approveUserRequest,
  rejectUserRequest,
  deleteUserRequest: (id) => remove('user_requests', id),
  getApiKeys: () => list('api_keys', 'created_at').catch(() => []),
  createApiKey: (name) => create('api_keys', { name, active: true, token_preview: 'firebase-local' }),
  updateApiKey: (id, data) => update('api_keys', id, data),
  deleteApiKey: (id) => remove('api_keys', id),
  getWebhooks: () => list('webhooks', 'created_at').catch(() => []),
  createWebhook: (data) => create('webhooks', data),
  updateWebhook: (id, data) => update('webhooks', id, data),
  deleteWebhook: (id) => remove('webhooks', id),
  testWebhook: () => Promise.resolve({ ok: false, message: 'Webhooks exigem backend/Cloud Functions no modo Firebase Hosting gratuito.' }),
  getWebhookDeliveries: () => Promise.resolve([]),
};

export { setToken, getToken };
export default firebaseApi;
