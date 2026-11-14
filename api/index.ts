import type { Request, Response } from 'express';
import { buildApp } from '../server.ts';

let cachedApp: ReturnType<typeof buildApp> | null = null;

export default function handler(req: Request, res: Response) {
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

    if (!cachedApp) {
      cachedApp = buildApp();
    }
    return cachedApp(req, res);
  } catch (err: any) {
    console.error('Vercel API handler error:', err);
    return res.status(500).json({
      error: err?.message || 'API server initialization failed',
    });
  }
}
