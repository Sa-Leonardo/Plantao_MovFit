const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const rateLimit = require('express-rate-limit');
const { initDB } = require('./db');
const { checkPreEventNotifications } = require('./webhooks');
const userRequestsRouter = require('./routes/user-requests');

const app = express();
const PORT = process.env.PORT || 3001;
const IS_PROD = process.env.NODE_ENV === 'production';

// ---------- Avisos de configuração (apenas log, não bloqueia o startup) ----------
const INSECURE_JWT = [
  'mude-este-segredo-em-producao',
  'mude-este-segredo-longo-em-producao-2024',
  'troque-este-segredo-para-32-chars-ou-mais-em-producao',
];
if (IS_PROD) {
  if (!process.env.JWT_SECRET || INSECURE_JWT.includes(process.env.JWT_SECRET) || process.env.JWT_SECRET.length < 32) {
    console.warn('[SEGURANÇA] JWT_SECRET está usando valor padrão ou muito curto. Recomenda-se definir um segredo com 32+ caracteres via variável de ambiente.');
  }
  if (!process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === 'Admin@1234') {
    console.warn('[SEGURANÇA] ADMIN_PASSWORD está usando o valor padrão "Admin@1234". Troque pelo painel após o primeiro login.');
  }
}

// Inicializa banco de dados
initDB();

// ---------- Hardening global ----------
app.disable('x-powered-by');                     // não expor tecnologia
app.set('trust proxy', 1);                       // rate-limit/IP corretos atrás de proxy (nginx/docker)
app.use(helmet({                                 // headers de segurança
  contentSecurityPolicy: false,                  // frontend Vite tem inline styles; desabilitado aqui (frontend serve os headers)
  crossOriginEmbedderPolicy: false,
}));

// CORS: se origin explícita for fornecida, usa ela; senão nega credentials com wildcard
const corsOrigin = process.env.CORS_ORIGIN;
app.use(cors({
  origin: corsOrigin && corsOrigin !== '*' ? corsOrigin.split(',').map(s => s.trim()) : true,
  credentials: !!corsOrigin && corsOrigin !== '*',
}));

// Compressão gzip (substitui a do nginx)
app.use(compression());

// Body parser com limite razoável (anti-DoS por payload grande)
app.use(express.json({ limit: '256kb' }));

// Rate limit GLOBAL (genérico) — protege contra flood em todos os endpoints
const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 300,            // 300 req/min por IP (suficiente para uso normal interativo)
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Aguarde alguns instantes.' },
});
app.use('/api/', globalLimiter);

// Rate limit específico para endpoints PÚBLICOS sensíveis (sem auth)
const publicLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutos
  max: 60,                   // 60 req/10min por IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente novamente mais tarde.' },
});
app.use('/api/user-requests/check-username', publicLimiter);

// Rotas
app.use('/api/auth', require('./routes/auth'));
app.use('/api/shifts', require('./routes/shifts'));
app.use('/api/team', require('./routes/team'));
app.use('/api/holidays', require('./routes/holidays'));
app.use('/api/overrides', require('./routes/overrides'));
app.use('/api/absences', require('./routes/absences'));
app.use('/api/webhooks', require('./routes/webhooks'));
app.use('/api/schedule-logs', require('./routes/schedule-logs'));
app.use('/api/colaboradores', require('./routes/colaboradores'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/schedule', require('./routes/schedule'));
app.use('/api/api-keys', require('./routes/api-keys'));
app.use('/api/user-requests', userRequestsRouter);
const backupRouter = require('./routes/backup');
app.use('/api/backup', backupRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ---------- Frontend estático (SPA React) ----------
// Em produção o build do frontend fica em /app/public dentro da imagem
const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, '../public');
if (fs.existsSync(PUBLIC_DIR)) {
  // Assets com hash no nome (ex: index-abc123.js) podem ter cache longo
  app.use(express.static(PUBLIC_DIR, {
    maxAge: '1y',
    setHeaders: (res, filepath) => {
      // index.html nunca é cacheado
      if (filepath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
    },
  }));

  // Fallback SPA: qualquer rota não-API retorna index.html
  app.get(/^(?!\/api\/).+/, (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
  });
  console.log(`[APP] Servindo frontend de: ${PUBLIC_DIR}`);
} else {
  console.log(`[APP] Frontend estático não encontrado em ${PUBLIC_DIR} (modo API-only)`);
}

// Handler para payload JSON inválido / grande demais
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Payload muito grande' });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'JSON inválido' });
  }
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: 'Erro interno do servidor' });
});

// Cron: verifica notificações pre_event a cada minuto
cron.schedule('* * * * *', async () => {
  try {
    await checkPreEventNotifications();
  } catch (err) {
    console.error('[Cron] Erro:', err.message);
  }
});
console.log('[Cron] Agendamento de webhooks ativo (verifica a cada minuto)');

// Cron: limpa solicitações de cadastro expiradas (TTL 24h) a cada 10 minutos
cron.schedule('*/10 * * * *', () => {
  try { userRequestsRouter.cleanupExpiredRequests(); }
  catch (err) { console.error('[Cron] Erro ao limpar solicitações:', err.message); }
});
try { userRequestsRouter.cleanupExpiredRequests(); } catch (_) {}
console.log('[Cron] Limpeza de solicitações expiradas ativa (a cada 10 min, TTL 24h)');

// Cron: backup automático diário às 03:15 da manhã (mantém últimos 7)
cron.schedule('15 3 * * *', () => {
  backupRouter.runAutoBackup(7).catch(err => console.error('[Backup] Erro no cron:', err.message));
});
// Executa uma vez no startup se nenhum backup existe ainda (garante pelo menos 1)
setTimeout(() => {
  try {
    const dbPath = process.env.DB_PATH || path.join(__dirname, '../../data/escala.db');
    const bdir = path.join(path.dirname(dbPath), 'backups');
    const hasBackup = fs.existsSync(bdir) && fs.readdirSync(bdir).some(f => f.startsWith('auto-'));
    if (!hasBackup) backupRouter.runAutoBackup(7).catch(() => {});
  } catch (_) {}
}, 10 * 1000);
console.log('[Cron] Backup automático diário ativo (03:15, retém 7 snapshots)');

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[API] Servidor rodando na porta ${PORT}`);
});
