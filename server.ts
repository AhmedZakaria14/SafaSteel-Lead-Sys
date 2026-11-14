import express from 'express';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';
import { ensureDbReady, getDb } from './server/db.ts';
import { buildApp } from './server/app.ts';
import { ALSAFA_WORKSPACE_ID, ATTACHED_SHEET_PATH, startAttachedSheetWatcher } from './server/services/sheetSyncService.ts';

dotenv.config();

export { buildApp };

const __dirname =
  typeof import.meta !== 'undefined' && Boolean(import.meta.url)
    ? path.dirname(fileURLToPath(import.meta.url))
    : process.cwd();

async function startServer() {
  await ensureDbReady();
  const db = getDb();
  const app = buildApp({ db });
  startAttachedSheetWatcher(db, ALSAFA_WORKSPACE_ID, ATTACHED_SHEET_PATH);
  const PORT = Number(process.env.PORT || 3000);

  if (process.env.NODE_ENV !== 'production') {
    const vitePkg = 'vite';
    const { createServer: createViteServer } = await import(/* @vite-ignore */ vitePkg);
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
  typeof import.meta !== 'undefined' &&
  Boolean(import.meta.url) &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMainEntry && process.env.NODE_ENV !== 'test') {
  startServer();
}
