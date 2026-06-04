const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const Database = require('better-sqlite3');
const { getDB } = require('../db');
const { requireHumanAdmin } = require('../middleware/auth');

const router = express.Router();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/escala.db');
const DATA_DIR = path.dirname(DB_PATH);
const AUTO_BACKUP_DIR = path.join(DATA_DIR, 'backups');

function ensureBackupDir() {
  try { fs.mkdirSync(AUTO_BACKUP_DIR, { recursive: true }); } catch (_) {}
}

// Extrai metadados de um arquivo de banco SQLite (para preview de restauração)
function extractDbMetadata(filepath) {
  const db = new Database(filepath, { readonly: true });
  try {
    const meta = {};
    const safeCount = (sql) => {
      try { return db.prepare(sql).get().c; } catch (_) { return 0; }
    };
    meta.users = safeCount('SELECT COUNT(*) AS c FROM users');
    meta.team_members = safeCount('SELECT COUNT(*) AS c FROM team_members');
    meta.colaboradores = safeCount('SELECT COUNT(*) AS c FROM colaboradores');
    meta.holidays = safeCount('SELECT COUNT(*) AS c FROM holidays');
    meta.shifts = safeCount('SELECT COUNT(*) AS c FROM shifts');
    meta.overrides = safeCount('SELECT COUNT(*) AS c FROM overrides');
    meta.absences = safeCount('SELECT COUNT(*) AS c FROM absences');
    meta.snapshots = safeCount('SELECT COUNT(*) AS c FROM schedule_snapshots');
    meta.webhooks = safeCount('SELECT COUNT(*) AS c FROM webhooks');
    meta.api_keys = safeCount('SELECT COUNT(*) AS c FROM api_keys');

    // Admin info (nomes apenas — sem senha)
    try {
      meta.admin_usernames = db.prepare("SELECT username FROM users WHERE role = 'admin'").all().map(r => r.username);
    } catch (_) { meta.admin_usernames = []; }

    // Range de datas do snapshot (mais antigo e mais recente)
    try {
      const r = db.prepare('SELECT MIN(date) AS min_d, MAX(date) AS max_d FROM schedule_snapshots').get();
      meta.schedule_range = r ? { from: r.min_d, to: r.max_d } : null;
    } catch (_) {}

    return meta;
  } finally {
    try { db.close(); } catch (_) {}
  }
}

// --- Rate limit específico para restauração (3 por hora por IP) ---
const restoreLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Limite de restaurações atingido. Tente novamente em até 1 hora.' },
});

// GET /api/backup — download seguro do banco
router.get('/', requireHumanAdmin, async (req, res) => {
  const tmpName = `backup-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`;
  const tmpPath = path.join(DATA_DIR, tmpName);

  try {
    const db = getDB();
    await db.backup(tmpPath);

    const stat = fs.statSync(tmpPath);
    const iso = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const filename = `escala-backup-${iso}.db`;

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', stat.size);

    const stream = fs.createReadStream(tmpPath);
    stream.on('close', () => { try { fs.unlinkSync(tmpPath); } catch (_) {} });
    stream.on('error', (err) => {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
    stream.pipe(res);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch (_) {}
    res.status(500).json({ error: 'Falha ao gerar backup: ' + err.message });
  }
});

// POST /api/backup/preview — analisa o arquivo sem aplicar, retorna metadata
router.post('/preview',
  requireHumanAdmin,
  express.raw({ type: 'application/octet-stream', limit: '200mb' }),
  (req, res) => {
    if (!req.body || !req.body.length) {
      return res.status(400).json({ error: 'Corpo vazio' });
    }
    const magic = req.body.slice(0, 16).toString('utf8');
    if (!magic.startsWith('SQLite format 3')) {
      return res.status(400).json({ error: 'Arquivo não parece ser um banco SQLite válido' });
    }
    const tmpPath = path.join(DATA_DIR, `preview-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.db`);
    try {
      fs.writeFileSync(tmpPath, req.body);
      const meta = extractDbMetadata(tmpPath);
      meta.file_size_bytes = req.body.length;
      res.json(meta);
    } catch (err) {
      res.status(400).json({ error: 'Não foi possível ler o backup: ' + err.message });
    } finally {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
    }
  }
);

// POST /api/backup/restore
router.post('/restore',
  restoreLimiter,
  requireHumanAdmin,
  express.raw({ type: 'application/octet-stream', limit: '200mb' }),
  (req, res) => {
    if (!req.body || !req.body.length) {
      return res.status(400).json({ error: 'Corpo da requisição vazio.' });
    }
    const magic = req.body.slice(0, 16).toString('utf8');
    if (!magic.startsWith('SQLite format 3')) {
      return res.status(400).json({ error: 'Arquivo inválido: não parece ser um banco SQLite.' });
    }

    const tmpUploadPath = path.join(DATA_DIR, `restore-upload-${Date.now()}.db`);
    const safetyBackupPath = path.join(DATA_DIR, `pre-restore-${Date.now()}.db`);

    try {
      fs.writeFileSync(tmpUploadPath, req.body);

      // Validação de integridade
      let testDb;
      try {
        testDb = new Database(tmpUploadPath, { readonly: true });
        const pragma = testDb.pragma('integrity_check', { simple: true });
        if (pragma !== 'ok') throw new Error(`integrity_check falhou: ${pragma}`);
        const required = ['users', 'shifts', 'team_members'];
        for (const t of required) {
          testDb.prepare(`SELECT 1 FROM ${t} LIMIT 1`).all();
        }
        testDb.close();
      } catch (err) {
        try { testDb && testDb.close(); } catch (_) {}
        fs.unlinkSync(tmpUploadPath);
        return res.status(400).json({ error: 'Backup inválido ou corrompido: ' + err.message });
      }

      try { fs.copyFileSync(DB_PATH, safetyBackupPath); } catch (_) {}
      try { getDB().close(); } catch (_) {}
      for (const suffix of ['-wal', '-shm']) {
        try { fs.unlinkSync(DB_PATH + suffix); } catch (_) {}
      }
      fs.renameSync(tmpUploadPath, DB_PATH);

      res.json({
        message: 'Restauração concluída. O servidor será reiniciado em 2s.',
        safety_backup: path.basename(safetyBackupPath),
      });

      // IMPORTANTE: exit(1), não exit(0). O Swarm usa restart_policy: on-failure
      // e só reinicia tasks que saem com código != 0. Se sairmos com 0, o Swarm
      // considera "trabalho concluído" e o container fica fora até alguém fazer
      // scale manual. O exit(1) aqui é intencional: estamos SINALIZANDO ao Swarm
      // "me reinicia por favor, acabei de trocar o arquivo do banco".
      setTimeout(() => process.exit(1), 2000);
    } catch (err) {
      try { fs.unlinkSync(tmpUploadPath); } catch (_) {}
      res.status(500).json({ error: 'Falha ao restaurar: ' + err.message });
    }
  }
);

// --- Backup automático diário ---
async function runAutoBackup(maxKeep = 7) {
  ensureBackupDir();
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const outPath = path.join(AUTO_BACKUP_DIR, `auto-${stamp}.db`);
  try {
    await getDB().backup(outPath);
    console.log(`[Backup] Snapshot automático salvo: ${outPath}`);
  } catch (err) {
    console.error('[Backup] Falha ao gerar backup automático:', err.message);
    return;
  }
  // Limpa backups antigos (retém últimos maxKeep)
  try {
    const files = fs.readdirSync(AUTO_BACKUP_DIR)
      .filter(f => f.startsWith('auto-') && f.endsWith('.db'))
      .map(f => ({ f, p: path.join(AUTO_BACKUP_DIR, f), mtime: fs.statSync(path.join(AUTO_BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    const toDelete = files.slice(maxKeep);
    for (const entry of toDelete) {
      try { fs.unlinkSync(entry.p); console.log(`[Backup] Removido antigo: ${entry.f}`); }
      catch (_) {}
    }
  } catch (err) {
    console.error('[Backup] Falha ao rotacionar backups:', err.message);
  }
}

// GET /api/backup/auto/list — lista backups automáticos
router.get('/auto/list', requireHumanAdmin, (req, res) => {
  ensureBackupDir();
  try {
    const files = fs.readdirSync(AUTO_BACKUP_DIR)
      .filter(f => f.startsWith('auto-') && f.endsWith('.db'))
      .map(f => {
        const p = path.join(AUTO_BACKUP_DIR, f);
        const st = fs.statSync(p);
        return { name: f, size: st.size, mtime: st.mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.runAutoBackup = runAutoBackup;
