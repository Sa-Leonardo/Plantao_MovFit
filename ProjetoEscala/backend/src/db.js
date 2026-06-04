const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/escala.db');

let db;

function getDB() {
  if (!db) {
    // Garante que o diretório existe (útil em primeira execução ou teste sem volume)
    const dir = path.dirname(DB_PATH);
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initDB() {
  const db = getDB();

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('admin', 'user')),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS shifts (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      shift_id TEXT NOT NULL REFERENCES shifts(id) ON DELETE RESTRICT,
      active INTEGER NOT NULL DEFAULT 1,
      in_rotation INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS holidays (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      is_fixed INTEGER NOT NULL DEFAULT 0,
      scope TEXT NOT NULL DEFAULT 'national' CHECK(scope IN ('national', 'state', 'municipal', 'optional')),
      state TEXT,
      city TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS overrides (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      shift_id TEXT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
      member_id TEXT REFERENCES team_members(id) ON DELETE SET NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(date, shift_id)
    );

    CREATE TABLE IF NOT EXISTS absences (
      id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL REFERENCES team_members(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      reason TEXT,
      absence_type TEXT DEFAULT 'ausencia' CHECK(absence_type IN ('atestado','folga','ferias','ausencia','outro')),
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(member_id, date)
    );

    CREATE TABLE IF NOT EXISTS schedule_logs (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      shift_id TEXT,
      shift_label TEXT,
      old_member_id TEXT,
      old_member_name TEXT,
      new_member_id TEXT,
      new_member_name TEXT,
      reason TEXT,
      changed_by TEXT,
      changed_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      secret TEXT,
      events TEXT NOT NULL DEFAULT '["schedule_changed"]',
      active INTEGER NOT NULL DEFAULT 1,
      notify_time TEXT DEFAULT '08:00',
      days_before INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      webhook_id TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      target_date TEXT,
      payload TEXT,
      status TEXT,
      response_code INTEGER,
      delivered_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      key_hash TEXT UNIQUE NOT NULL,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      last_used TEXT
    );

    CREATE TABLE IF NOT EXISTS user_requests (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
      created_at TEXT DEFAULT (datetime('now')),
      processed_at TEXT,
      processed_by TEXT
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS schedule_snapshots (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      shift_id TEXT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
      members TEXT NOT NULL DEFAULT '[]',
      generated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(date, shift_id)
    );

    CREATE TABLE IF NOT EXISTS colaboradores (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      schedule_type TEXT DEFAULT 'fixed',
      work_days TEXT DEFAULT '[]',
      work_start TEXT DEFAULT '',
      work_end TEXT DEFAULT '',
      rotation_work_days INTEGER DEFAULT 1,
      rotation_rest_days INTEGER DEFAULT 2,
      rotation_anchor TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY,
      year INTEGER NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'generated',
      generated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      generated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS shift_slots (
      id TEXT PRIMARY KEY,
      schedule_id TEXT REFERENCES schedules(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      type TEXT NOT NULL,
      shift_id TEXT NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
      slot_code TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shift_assignments (
      id TEXT PRIMARY KEY,
      slot_id TEXT NOT NULL REFERENCES shift_slots(id) ON DELETE CASCADE,
      member_id TEXT REFERENCES team_members(id) ON DELETE SET NULL,
      assigned_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      assigned_at TEXT DEFAULT (datetime('now')),
      source TEXT NOT NULL DEFAULT 'automatic'
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      payload TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Migrações seguras (adiciona colunas se não existirem)
  const migrations = [
    `ALTER TABLE holidays ADD COLUMN is_fixed INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE holidays ADD COLUMN scope TEXT NOT NULL DEFAULT 'national'`,
    `ALTER TABLE holidays ADD COLUMN state TEXT`,
    `ALTER TABLE holidays ADD COLUMN city TEXT`,
    `ALTER TABLE team_members ADD COLUMN in_rotation INTEGER NOT NULL DEFAULT 1`,
    `ALTER TABLE team_members ADD COLUMN colaborador_id TEXT REFERENCES colaboradores(id)`,
    `ALTER TABLE colaboradores ADD COLUMN work_days TEXT DEFAULT '[]'`,
    `ALTER TABLE colaboradores ADD COLUMN work_start TEXT DEFAULT ''`,
    `ALTER TABLE colaboradores ADD COLUMN work_end TEXT DEFAULT ''`,
    `ALTER TABLE colaboradores ADD COLUMN schedule_type TEXT DEFAULT 'fixed'`,
    `ALTER TABLE colaboradores ADD COLUMN rotation_work_days INTEGER DEFAULT 1`,
    `ALTER TABLE colaboradores ADD COLUMN rotation_rest_days INTEGER DEFAULT 2`,
    `ALTER TABLE colaboradores ADD COLUMN rotation_anchor TEXT DEFAULT ''`,
    `ALTER TABLE shifts ADD COLUMN slots INTEGER DEFAULT 1`,
    `ALTER TABLE shifts ADD COLUMN sunday_slots INTEGER`,
    `ALTER TABLE shifts ADD COLUMN holiday_slots INTEGER`,
    `ALTER TABLE overrides ADD COLUMN members TEXT DEFAULT '[]'`,
    `ALTER TABLE users ADD COLUMN password_changed_at TEXT`,
    `ALTER TABLE users ADD COLUMN name TEXT`,
    `ALTER TABLE absences ADD COLUMN end_date TEXT`,
    `ALTER TABLE team_members ADD COLUMN monthly_sunday_limit INTEGER`,
    `ALTER TABLE team_members ADD COLUMN monthly_holiday_limit INTEGER`,
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch (_) { /* coluna já existe */ }
  }

  // Configurações padrão
  // schedule_start_date: data a partir da qual o sistema considera histórico válido.
  // Na primeira inicialização fica como "hoje" — antes disso o sistema não gera nem
  // persiste nada, tratando como "não existia ainda".
  const todayStr = db.prepare("SELECT date('now','localtime') AS d").get().d;
  const defaultSettings = [
    ['compensatory_monday_rest', 'false'],
    ['schedule_start_date', todayStr],
  ];
  const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of defaultSettings) insertSetting.run(k, v);
  const startRow = db.prepare("SELECT value FROM settings WHERE key = 'schedule_start_date'").get();
  if (!startRow || startRow.value > '2026-01-01') {
    db.prepare("INSERT INTO settings (key, value) VALUES ('schedule_start_date', '2026-01-01') ON CONFLICT(key) DO UPDATE SET value='2026-01-01', updated_at=datetime('now')").run();
  }

  seedMovfit2026(db);

  // Admin inicial
  const adminUsername = (process.env.ADMIN_USERNAME || 'admin').toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@1234';
  const existingAdmin = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
  if (!existingAdmin) {
    const hash = bcrypt.hashSync(adminPassword, 12);
    db.prepare('INSERT INTO users (id, username, password_hash, role) VALUES (?, ?, ?, ?)').run(
      uuidv4(), adminUsername, hash, 'admin'
    );
    console.log(`\n[DB] Admin criado — usuário: "${adminUsername}"`);
    // NÃO loga a senha! Loga apenas se está usando o default, alertando o operador.
    if (process.env.ADMIN_PASSWORD) {
      console.log('[DB] Senha do admin foi definida pela variável de ambiente ADMIN_PASSWORD.');
    } else {
      console.log('[DB] ATENÇÃO: senha padrão "Admin@1234" em uso. TROQUE imediatamente após o primeiro login.');
    }
    console.log('[DB] IMPORTANTE: Altere a senha após o primeiro login!\n');
  }

  console.log('[DB] Banco de dados inicializado:', DB_PATH);
  return db;
}

function seedMovfit2026(db) {
  const shifts = [
    ['movfit-f1', 'F1', '05:00', '11:15'],
    ['movfit-f2', 'F2', '09:00', '15:15'],
    ['movfit-f3', 'F3', '13:00', '19:15'],
    ['movfit-f4', 'F4', '17:45', '00:00'],
  ];
  const employees = [
    ['movfit-lucas', 'Lucas', '05:00', '11:15', 'movfit-f1'],
    ['movfit-luana', 'Luana', '07:00', '13:15', 'movfit-f2'],
    ['movfit-alohana', 'Alohana', '09:30', '15:45', 'movfit-f2'],
    ['movfit-maria', 'Maria', '10:00', '16:15', 'movfit-f2'],
    ['movfit-lara', 'Lara', '11:00', '17:15', 'movfit-f3'],
    ['movfit-pablo', 'Pablo', '14:00', '00:00', 'movfit-f3'],
    ['movfit-celline', 'Celline', '15:45', '22:00', 'movfit-f4'],
    ['movfit-raissa', 'Raissa', '17:00', '23:15', 'movfit-f4'],
  ];
  const holidays = [
    ['movfit-h-2026-01-01', '2026-01-01', 'Confraternizacao Universal', 'national'],
    ['movfit-h-2026-04-03', '2026-04-03', 'Sexta-feira Santa', 'national'],
    ['movfit-h-2026-04-21', '2026-04-21', 'Tiradentes', 'national'],
    ['movfit-h-2026-05-01', '2026-05-01', 'Dia do Trabalho', 'national'],
    ['movfit-h-2026-06-22', '2026-06-22', 'Feriado Municipal de Santarem', 'municipal'],
    ['movfit-h-2026-08-15', '2026-08-15', 'Adesao do Para', 'state'],
    ['movfit-h-2026-09-07', '2026-09-07', 'Independencia do Brasil', 'national'],
    ['movfit-h-2026-10-12', '2026-10-12', 'Nossa Senhora Aparecida', 'national'],
    ['movfit-h-2026-11-02', '2026-11-02', 'Finados', 'national'],
    ['movfit-h-2026-11-15', '2026-11-15', 'Proclamacao da Republica', 'national'],
    ['movfit-h-2026-11-20', '2026-11-20', 'Dia da Consciencia Negra', 'national'],
    ['movfit-h-2026-12-08', '2026-12-08', 'Nossa Senhora da Conceicao', 'municipal'],
    ['movfit-h-2026-12-25', '2026-12-25', 'Natal', 'national'],
  ];

  const tx = db.transaction(() => {
    const upsertShift = db.prepare(`
      INSERT INTO shifts (id, label, start_time, end_time, slots, sunday_slots, holiday_slots)
      VALUES (?, ?, ?, ?, 1, 1, 1)
      ON CONFLICT(id) DO UPDATE SET label=excluded.label, start_time=excluded.start_time,
      end_time=excluded.end_time, slots=1, sunday_slots=1, holiday_slots=1
    `);
    for (const row of shifts) upsertShift.run(...row);

    const upsertColab = db.prepare(`
      INSERT INTO colaboradores (id, name, schedule_type, work_days, work_start, work_end, active)
      VALUES (?, ?, 'fixed', '[1,2,3,4,5]', ?, ?, 1)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, work_start=excluded.work_start,
      work_end=excluded.work_end, active=1
    `);
    const upsertMember = db.prepare(`
      INSERT INTO team_members (id, name, shift_id, active, in_rotation, colaborador_id)
      VALUES (?, ?, ?, 1, 1, ?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, shift_id=excluded.shift_id,
      active=1, in_rotation=1, colaborador_id=excluded.colaborador_id
    `);
    for (const [colabId, name, start, end, shiftId] of employees) {
      upsertColab.run(colabId, name, start, end);
      upsertMember.run(`team-${colabId}`, name, shiftId, colabId);
    }

    const insertHoliday = db.prepare(`
      INSERT INTO holidays (id, date, label, is_fixed, scope)
      VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(date) DO UPDATE SET label=excluded.label, scope=excluded.scope
    `);
    for (const row of holidays) insertHoliday.run(...row);

    db.prepare(`
      INSERT INTO schedules (id, year, name, status)
      VALUES ('movfit-2026', 2026, 'Escala MovFit 2026', 'generated')
      ON CONFLICT(id) DO UPDATE SET status='generated'
    `).run();
  });
  tx();
}

module.exports = { getDB, initDB };
