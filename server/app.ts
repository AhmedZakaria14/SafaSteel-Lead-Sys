import express from 'express';
import { getDb, SqlDb } from './db.ts';
import { ensureDemoData } from './seedDemo.ts';
import { createAuthMiddleware, createRateLimiter, defaultTokenVerifier, TokenVerifier } from './auth.ts';
import { createCrmRoutes } from './routes/crm.ts';
import { createMetaRoutes } from './routes/meta.ts';
import { createGoogleRoutes } from './routes/google.ts';

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

  app.use('/api', (req, res) => {
    res.status(404).json({ error: `API endpoint not found: ${req.method} ${req.originalUrl}` });
  });

  // Global sanitized JSON error handler
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error('Unhandled server error:', err);
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  });

  return app;
}
