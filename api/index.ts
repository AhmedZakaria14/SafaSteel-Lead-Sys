import type { Request, Response } from 'express';
import { ensureDbReady } from '../server/db.ts';
import { buildApp } from '../server/app.ts';

let cachedApp: ReturnType<typeof buildApp> | null = null;
let initPromise: Promise<ReturnType<typeof buildApp>> | null = null;

async function getOrCreateApp() {
  if (cachedApp) return cachedApp;
  if (!initPromise) {
    initPromise = (async () => {
      await ensureDbReady();
      const app = buildApp();
      cachedApp = app;
      return app;
    })();
  }
  try {
    return await initPromise;
  } catch (err) {
    initPromise = null;
    throw err;
  }
}

function sendJsonError(res: any, statusCode: number, message: string) {
  if (typeof res?.status === 'function' && typeof res?.json === 'function') {
    return res.status(statusCode).json({ error: message });
  }
  res.statusCode = statusCode;
  if (typeof res?.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
  }
  res.end(JSON.stringify({ error: message }));
}

export default async function handler(req: Request, res: Response) {
  try {
    const rawUrl = req.url || '/api';
    const urlObj = new URL(rawUrl, 'http://localhost');
    const rewrittenPath = urlObj.searchParams.get('__path');

    if (rewrittenPath !== null) {
      urlObj.searchParams.delete('__path');
      const cleanSubPath = rewrittenPath.replace(/^\/+/, '');
      const qs = urlObj.searchParams.toString();
      req.url = `/api/${cleanSubPath}${qs ? `?${qs}` : ''}`;
    } else if (!urlObj.pathname.startsWith('/api')) {
      const qs = urlObj.searchParams.toString();
      req.url = `/api${urlObj.pathname.startsWith('/') ? '' : '/'}${urlObj.pathname}${qs ? `?${qs}` : ''}`;
    }

    if (req.body !== undefined && (req as any).readableEnded) {
      (req as any)._body = true;
    }

    const app = await getOrCreateApp();
    return app(req, res);
  } catch (err: any) {
    console.error('Vercel API handler error:', err);
    return sendJsonError(res, 500, err?.message || 'API server initialization failed');
  }
}
