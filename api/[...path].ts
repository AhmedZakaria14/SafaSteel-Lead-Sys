import type { Request, Response } from 'express';
import { buildApp } from '../server.ts';

let cachedApp: ReturnType<typeof buildApp> | null = null;

export default function handler(req: Request, res: Response) {
  try {
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
