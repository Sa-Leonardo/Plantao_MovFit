const BASE = '/api';

function getToken() { return localStorage.getItem('escala_token'); }
function setToken(token) {
  if (token) localStorage.setItem('escala_token', token);
  else localStorage.removeItem('escala_token');
}

async function request(method, path, body) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));

  // 401 só força logout quando já havia um token ativo (sessão expirou / inválida)
  // e o endpoint não é de autenticação pública (login / register). Assim, login
  // errado mostra o erro normalmente ao invés de recarregar a página em silêncio.
  if (res.status === 401) {
    const isPublic = path.startsWith('/auth/login') || path.startsWith('/user-requests');
    if (token && !isPublic) {
      setToken(null); window.location.reload(); return;
    }
    throw new Error(data.error || 'Credenciais inválidas');
  }

  if (!res.ok) throw new Error(data.error || `Erro ${res.status}`);
  return data;
}

const api = {
  // Auth
  login: (username, password) => request('POST', '/auth/login', { username, password }),
  me: () => request('GET', '/auth/me'),
  changePassword: (currentPassword, newPassword) => request('POST', '/auth/change-password', { currentPassword, newPassword }),
  getUsers: () => request('GET', '/auth/users'),
  createUser: (data) => request('POST', '/auth/users', data),
  updateUser: (id, data) => request('PUT', `/auth/users/${id}`, data),
  deleteUser: (id) => request('DELETE', `/auth/users/${id}`),

  // Shifts
  getShifts: () => request('GET', '/shifts'),
  createShift: (data) => request('POST', '/shifts', data),
  updateShift: (id, data) => request('PUT', `/shifts/${id}`, data),
  deleteShift: (id) => request('DELETE', `/shifts/${id}`),

  // Colaboradores (cadastro geral de funcionários + horários de trabalho)
  getColaboradores: () => request('GET', '/colaboradores'),
  createColaborador: (data) => request('POST', '/colaboradores', data),
  updateColaborador: (id, data) => request('PUT', `/colaboradores/${id}`, data),
  deleteColaborador: (id) => request('DELETE', `/colaboradores/${id}`),

  // Equipe de Plantão (subconjunto dos colaboradores que fazem plantão)
  getTeam: () => request('GET', '/team'),
  createMember: (data) => request('POST', '/team', data),
  updateMember: (id, data) => request('PUT', `/team/${id}`, data),
  deleteMember: (id) => request('DELETE', `/team/${id}`),

  // Holidays
  getHolidays: () => request('GET', '/holidays'),
  createHoliday: (data) => request('POST', '/holidays', data),
  updateHoliday: (id, data) => request('PUT', `/holidays/${id}`, data),
  deleteHoliday: (date) => request('DELETE', `/holidays/${date}`),
  fetchBrasilAPI: (year) => request('GET', `/holidays/brasil-api/${year}`),
  importHolidays: (holidays) => request('POST', '/holidays/import', { holidays }),

  // Overrides (agora aceita reason)
  getOverrides: () => request('GET', '/overrides'),
  setOverride: (date, assignments, reason) => request('PUT', `/overrides/${date}`, { assignments, reason }),
  deleteOverride: (date) => request('DELETE', `/overrides/${date}`),

  // Absences
  getAbsences: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request('GET', `/absences${qs ? '?' + qs : ''}`);
  },
  createAbsence: (data) => request('POST', '/absences', data),
  deleteAbsence: (id) => request('DELETE', `/absences/${id}`),

  // Schedule logs
  getScheduleLogs: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request('GET', `/schedule-logs${qs ? '?' + qs : ''}`);
  },

  // Settings
  getSettings: () => request('GET', '/settings'),
  updateSettings: (data) => request('PUT', '/settings', data),

  // Schedule snapshots (imutabilidade do passado)
  getScheduleSnapshots: (year, month) => request('GET', `/schedule/${year}/${month}`),
  getHistoricalCounts: (beforeDate) => request('GET', `/schedule/counts${beforeDate ? '?before=' + encodeURIComponent(beforeDate) : ''}`),
  saveScheduleSnapshot: (schedule, overwrite = false) => request('POST', '/schedule/snapshot', { schedule, overwrite }),
  clearAllSnapshots: () => request('DELETE', '/schedule/snapshots'),
  clearSnapshotsBefore: (date) => request('DELETE', `/schedule/snapshots?before=${encodeURIComponent(date)}`),
  listAutoBackups: () => request('GET', '/backup/auto/list'),

  // Solicitações de cadastro
  requestRegister: (data) => request('POST', '/user-requests', data),
  checkUsername: (username) => request('GET', `/user-requests/check-username?username=${encodeURIComponent(username)}`),
  getUserRequests: (status = 'pending') => request('GET', `/user-requests?status=${encodeURIComponent(status)}`),
  approveUserRequest: (id) => request('POST', `/user-requests/${id}/approve`),
  rejectUserRequest: (id) => request('POST', `/user-requests/${id}/reject`),
  deleteUserRequest: (id) => request('DELETE', `/user-requests/${id}`),

  // API Keys (administração — requer JWT humano)
  getApiKeys: () => request('GET', '/api-keys'),
  createApiKey: (name) => request('POST', '/api-keys', { name }),
  updateApiKey: (id, data) => request('PUT', `/api-keys/${id}`, data),
  deleteApiKey: (id) => request('DELETE', `/api-keys/${id}`),

  // Webhooks
  getWebhooks: () => request('GET', '/webhooks'),
  createWebhook: (data) => request('POST', '/webhooks', data),
  updateWebhook: (id, data) => request('PUT', `/webhooks/${id}`, data),
  deleteWebhook: (id) => request('DELETE', `/webhooks/${id}`),
  testWebhook: (id) => request('POST', `/webhooks/${id}/test`),
  getWebhookDeliveries: (id) => request('GET', `/webhooks/${id}/deliveries`),
};

export { setToken, getToken };
export default api;
