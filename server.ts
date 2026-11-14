import express from 'express';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import { getDb, SqlDb } from './server/db.ts';
import { ensureDemoData } from './server/seedDemo.ts';
import { ALSAFA_WORKSPACE_ID, ATTACHED_SHEET_PATH, startAttachedSheetWatcher } from './server/services/sheetSyncService.ts';
import { createAuthMiddleware, createRateLimiter, defaultTokenVerifier, TokenVerifier } from './server/auth.ts';
import { createCrmRoutes } from './server/routes/crm.ts';
import { createMetaRoutes } from './server/routes/meta.ts';
import { createGoogleRoutes } from './server/routes/google.ts';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function buildApp(options?: { db?: SqlDb; tokenVerifier?: TokenVerifier }) {
  const db = options?.db || getDb();
  ensureDemoData(db);

  const app = express();
  app.set('trust proxy', 1);

  // Capture rawBody for Meta X-Hub-Signature-256 verification
  app.use(
    express.json({
      limit: '5mb',
      verify: (req: any, _res, buf) => {
        req.rawBody = buf;
      },
    })
  );

  // Basic security headers & rate limiting on API
  app.use('/api', (_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
  app.use('/api', createRateLimiter(300, 60_000));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, timestamp: new Date().toISOString() });
  });

  const authMiddleware = createAuthMiddleware(db, options?.tokenVerifier || defaultTokenVerifier);

  app.use('/api', createCrmRoutes(db, authMiddleware, options?.tokenVerifier || defaultTokenVerifier));
  app.use('/api', createMetaRoutes(db, authMiddleware));
  app.use('/api', createGoogleRoutes(db, authMiddleware));

  // Global sanitized JSON error handler
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error('Unhandled server error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  });

  return app;
}

async function startServer() {
  const db = getDb();
  const app = buildApp({ db });
  startAttachedSheetWatcher(db, ALSAFA_WORKSPACE_ID, ATTACHED_SHEET_PATH);
  const PORT = Number(process.env.PORT || 3000);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`LeadFlow CRM server listening on http://0.0.0.0:${PORT}`);
  });
}

const isMainEntry =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainEntry && process.env.NODE_ENV !== 'test') {
  startServer();
}
