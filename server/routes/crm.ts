import { Router } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import * as XLSX from 'xlsx';
import { SqlDb, createDefaultStagesForBusiness, normalizePhoneE164 } from '../db.ts';
import {
  AuthRequest,
  DEFAULT_ADMIN_USERNAME,
  MASTER_OWNER_EMAIL,
  Role,
  TokenVerifier,
  defaultTokenVerifier,
  hashPassword,
  requireBusinessAccess,
  resolveUserFromToken,
  signSessionToken,
  verifyPassword,
  writeAuditLog,
} from '../auth.ts';
import { changeLeadStatus, createLeadRecord, findDuplicateLeads } from '../services/leadService.ts';
import { resetDemoData } from '../seedDemo.ts';
import {
  ALSAFA_WORKSPACE_ID,
  ATTACHED_SHEET_PATH,
  addSseClient,
  broadcastWorkspaceEvent,
  extractGoogleSheetCsvUrl,
  normalizeArabicDigits,
  parseCsvRows,
  removeSseClient,
  syncAttachedSheetToWorkspace,
  syncSheetRowsToWorkspace,
} from '../services/sheetSyncService.ts';
import { createAndBroadcastNotification } from '../services/notificationService.ts';

export function createCrmRoutes(
  db: SqlDb,
  authMiddleware: any,
  tokenVerifier: TokenVerifier = defaultTokenVerifier
) {
  const router = Router();

  // Traditional Username & Password Login
  router.post('/auth/login', (req, res) => {
    const rawUsername = typeof req.body?.username === 'string' ? req.body.username.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!rawUsername || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const userRow = db
      .prepare('SELECT * FROM users WHERE LOWER(username) = ? OR LOWER(email) = ? LIMIT 1')
      .get(rawUsername, rawUsername) as any;

    if (!userRow || !verifyPassword(password, userRow.password_hash)) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const isOwner =
      String(userRow.username || '').toLowerCase() === DEFAULT_ADMIN_USERNAME ||
      String(userRow.email || '').toLowerCase() === MASTER_OWNER_EMAIL;

    const now = new Date().toISOString();
    const alsafaExists = db.prepare('SELECT id FROM businesses WHERE id = ?').get(ALSAFA_WORKSPACE_ID);
    if (alsafaExists) {
      const existingMembership = db
        .prepare('SELECT id, role, status, account_slot FROM business_memberships WHERE business_id = ? AND (user_id = ? OR LOWER(invited_email) = ?)')
        .get(ALSAFA_WORKSPACE_ID, userRow.id, String(userRow.email || '').toLowerCase()) as any;

      if (!existingMembership && isOwner) {
        db.prepare(`
          INSERT INTO business_memberships (id, business_id, user_id, invited_email, display_name, account_slot, role, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'manager', 'business_admin', 'active', ?, ?)
        `).run(
          crypto.randomUUID(),
          ALSAFA_WORKSPACE_ID,
          userRow.id,
          userRow.email.toLowerCase(),
          userRow.full_name,
          now,
          now
        );
      } else if (existingMembership) {
        if (existingMembership.status === 'inactive' && !isOwner) {
          return res.status(403).json({ error: 'This account has been deactivated' });
        }
        if (existingMembership.status === 'invited' || !existingMembership.user_id) {
          db.prepare("UPDATE business_memberships SET user_id = ?, status = 'active', updated_at = ? WHERE id = ?").run(
            userRow.id,
            now,
            existingMembership.id
          );
        }
      }
    }

    const membershipRow = db
      .prepare("SELECT account_slot FROM business_memberships WHERE business_id = ? AND user_id = ? AND status = 'active'")
      .get(ALSAFA_WORKSPACE_ID, userRow.id) as { account_slot?: 'manager' | 'accountant' } | undefined;

    const accountSlot: 'manager' | 'accountant' =
      membershipRow?.account_slot === 'manager' || isOwner ? 'manager' : 'accountant';

    const token = signSessionToken({
      sub: userRow.id,
      username: userRow.username || rawUsername,
      email: userRow.email.toLowerCase(),
      name: userRow.full_name,
      isOwner,
      isPlatformSuperAdmin: Boolean(userRow.is_platform_super_admin || isOwner),
      accountSlot,
    });

    const prodBusinesses = db
      .prepare(`
        SELECT b.*, bm.role as member_role, bm.account_slot as account_slot
        FROM businesses b
        JOIN business_memberships bm ON bm.business_id = b.id
        WHERE bm.user_id = ? AND bm.status = 'active' AND (b.is_demo = 0 OR b.id = ?)
        ORDER BY b.created_at DESC
      `)
      .all(userRow.id, ALSAFA_WORKSPACE_ID) as any[];

    if (isOwner && !prodBusinesses.some((b) => b.id === ALSAFA_WORKSPACE_ID)) {
      const alsafa = db
        .prepare("SELECT *, 'business_admin' as member_role, 'manager' as account_slot FROM businesses WHERE id = ?")
        .get(ALSAFA_WORKSPACE_ID) as any;
      if (alsafa) prodBusinesses.unshift(alsafa);
    }

    writeAuditLog(db, {
      businessId: prodBusinesses[0]?.id || ALSAFA_WORKSPACE_ID,
      actorUserId: userRow.id,
      action: 'auth_login',
      entityType: 'user',
      entityId: userRow.id,
      details: { username: userRow.username || rawUsername },
      ipAddress: req.ip,
    });

    res.json({
      token,
      user: {
        id: userRow.id,
        username: userRow.username || rawUsername,
        email: userRow.email,
        full_name: userRow.full_name,
        avatar_url: userRow.avatar_url || null,
        default_language: userRow.default_language || 'ar',
        theme: userRow.theme || 'light',
        isOwner,
        isPlatformSuperAdmin: Boolean(userRow.is_platform_super_admin || isOwner),
      },
      businesses: prodBusinesses,
      demoBusinesses: [],
    });
  });

  // Change Password for authenticated user
  router.post('/auth/change-password', authMiddleware, (req: AuthRequest, res) => {
    const { currentPassword, newPassword } = req.body || {};
    if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
      return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    const dbUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.authUser!.id) as any;
    if (!dbUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (dbUser.password_hash && !verifyPassword(String(currentPassword || ''), dbUser.password_hash)) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }
    db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(
      hashPassword(newPassword),
      new Date().toISOString(),
      dbUser.id
    );
    res.json({ updated: true });
  });

  // Current user & accessible businesses
  router.get('/me', authMiddleware, (req: AuthRequest, res) => {
    const user = req.authUser!;
    const dbUser = db
      .prepare('SELECT id, username, email, full_name, avatar_url, default_language, theme, is_platform_super_admin FROM users WHERE id = ?')
      .get(user.id) as any;

    let prodBusinesses: any[] = [];
    if (!user.isDemoUser) {
      prodBusinesses = db
        .prepare(`
          SELECT b.*, bm.role as member_role, bm.account_slot as account_slot
          FROM businesses b
          JOIN business_memberships bm ON bm.business_id = b.id
          WHERE bm.user_id = ? AND bm.status = 'active' AND (b.is_demo = 0 OR b.id = ?)
          ORDER BY b.created_at DESC
        `)
        .all(user.id, ALSAFA_WORKSPACE_ID) as any[];

      if (user.isOwner && !prodBusinesses.some((b) => b.id === ALSAFA_WORKSPACE_ID)) {
        const alsafa = db
          .prepare("SELECT *, 'business_admin' as member_role, 'manager' as account_slot FROM businesses WHERE id = ?")
          .get(ALSAFA_WORKSPACE_ID) as any;
        if (alsafa) prodBusinesses.unshift(alsafa);
      }
    }

    const prodIds = new Set(prodBusinesses.map((b) => b.id));
    const demoBusinesses = (
      db
        .prepare(`
          SELECT b.*, 'business_admin' as member_role, 'manager' as account_slot
          FROM businesses b
          WHERE b.is_demo = 1
          ORDER BY b.created_at ASC
        `)
        .all() as any[]
    ).filter((b) => !prodIds.has(b.id) && (user.isDemoUser || user.isOwner));

    res.json({
      user: {
        ...(dbUser || {
          id: user.id,
          username: user.username || null,
          email: user.email,
          full_name: user.fullName,
          default_language: 'ar',
          theme: 'light',
        }),
        isOwner: user.isOwner,
        isPlatformSuperAdmin: user.isPlatformSuperAdmin,
      },
      isDemoSession: user.isDemoUser,
      businesses: prodBusinesses,
      demoBusinesses,
    });
  });

  router.patch('/me/preferences', authMiddleware, (req: AuthRequest, res) => {
    if (req.authUser?.isDemoUser) {
      return res.json({ updated: true });
    }
    const { defaultLanguage, theme } = req.body || {};
    const updates: string[] = [];
    const params: unknown[] = [];

    if (defaultLanguage === 'ar' || defaultLanguage === 'en') {
      updates.push('default_language = ?');
      params.push(defaultLanguage);
    }
    if (theme === 'light' || theme === 'dark') {
      updates.push('theme = ?');
      params.push(theme);
    }

    if (updates.length > 0) {
      updates.push('updated_at = ?');
      params.push(new Date().toISOString(), req.authUser!.id);
      db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...(params as any[]));
    }
    res.json({ updated: true });
  });

  // Reset isolated workspace & re-sync sheet
  router.post('/demo/reset', authMiddleware, (_req, res) => {
    resetDemoData(db);
    res.json({ reset: true });
  });

  // Real-time Server-Sent Events (SSE) stream for live sheet & CRM updates
  router.get('/businesses/:businessId/events', async (req, res) => {
    const { businessId } = req.params;
    const biz = db.prepare('SELECT id, is_demo FROM businesses WHERE id = ?').get(businessId) as
      | { id: string; is_demo: number }
      | undefined;
    if (!biz) {
      return res.status(404).json({ error: 'Business workspace not found' });
    }

    const tokenParam = typeof req.query.token === 'string' ? req.query.token.trim() : '';
    if (biz.is_demo !== 1 || tokenParam || process.env.NODE_ENV !== 'test') {
      if (!tokenParam && (biz.is_demo !== 1 || process.env.NODE_ENV !== 'test')) {
        return res.status(401).json({ error: 'Unauthorized SSE stream' });
      }
      if (tokenParam) {
        try {
          const user = await resolveUserFromToken(db, tokenParam, tokenVerifier);
          const member = db
            .prepare("SELECT id FROM business_memberships WHERE business_id = ? AND user_id = ? AND status = 'active'")
            .get(businessId, user.id);
          if (!member && !(user.isOwner && businessId === ALSAFA_WORKSPACE_ID)) {
            return res.status(403).json({ error: 'Forbidden SSE stream' });
          }
        } catch {
          return res.status(401).json({ error: 'Invalid SSE token' });
        }
      }
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    res.write(`event: connected\ndata: ${JSON.stringify({ businessId, connectedAt: new Date().toISOString() })}\n\n`);
    addSseClient(businessId, res);

    const keepalive = setInterval(() => {
      try {
        res.write(`: keepalive ${Date.now()}\n\n`);
      } catch {
        clearInterval(keepalive);
      }
    }, 25_000);

    req.on('close', () => {
      clearInterval(keepalive);
      removeSseClient(businessId, res);
    });
  });

  // Sheet Sync Status & Real-Time Source Endpoints
  router.get('/businesses/:businessId/sheet-source/status', authMiddleware, requireBusinessAccess(db), (req: AuthRequest, res) => {
    const { businessId } = req.params;
    const integ = db
      .prepare("SELECT status, display_name, config_json, last_sync_at, last_error FROM integrations WHERE business_id = ? AND provider = 'google_sheets'")
      .get(businessId) as any;
    const totalRow = db.prepare('SELECT COUNT(*) as cnt FROM leads WHERE business_id = ?').get(businessId) as { cnt: number };
    const cfg = integ ? JSON.parse(integ.config_json || '{}') : {};
    const attachedExists = fs.existsSync(ATTACHED_SHEET_PATH);
    const attachedStat = attachedExists ? fs.statSync(ATTACHED_SHEET_PATH) : null;

    res.json({
      attachedSheetExists: attachedExists,
      attachedSheetName: cfg.attachedSheetName || 'الصفا ستيل غرابيل وحوامل كابلات',
      attachedSheetUpdatedAt: attachedStat ? attachedStat.mtime.toISOString() : null,
      status: integ?.status || 'pending_config',
      displayName: integ?.display_name || null,
      lastSyncAt: integ?.last_sync_at || null,
      lastError: integ?.last_error || null,
      publicCsvUrl: cfg.publicCsvUrl || null,
      spreadsheetId: cfg.spreadsheetId || null,
      spreadsheetName: cfg.spreadsheetName || null,
      sheetTitle: cfg.sheetTitle || null,
      autoScheduled: cfg.autoScheduled !== false,
      syncIntervalSec: cfg.syncIntervalSec || 15,
      totalLeads: totalRow.cnt,
    });
  });

  router.post('/businesses/:businessId/sheet-source/sync', authMiddleware, requireBusinessAccess(db), async (req: AuthRequest, res) => {
    const { businessId } = req.params;
    const { mode, csvText, sheetUrl, autoScheduled } = req.body || {};

    try {
      let result;
      if (typeof csvText === 'string' && csvText.trim()) {
        const rows = parseCsvRows(csvText);
        result = syncSheetRowsToWorkspace(db, {
          businessId,
          rows,
          sourceLabel: 'csv_upload_sync',
          conflictPolicy: 'sheet_wins',
          actorUserId: req.authUser?.id || null,
          recordSyncLog: true,
          emitNotificationOnChanges: true,
        });
      } else if (typeof sheetUrl === 'string' && sheetUrl.trim()) {
        const csvExportUrl = extractGoogleSheetCsvUrl(sheetUrl);
        if (!csvExportUrl) {
          return res.status(400).json({ error: 'Invalid Google Sheets or CSV URL' });
        }
        const fetchRes = await fetch(csvExportUrl);
        if (!fetchRes.ok) {
          return res.status(502).json({
            error: `Could not fetch sheet (${fetchRes.status}). Make sure the sheet is shared ("Anyone with the link can view").`,
          });
        }
        const fetchedCsv = await fetchRes.text();
        const rows = parseCsvRows(fetchedCsv);
        if (rows.length < 2) {
          return res.status(400).json({ error: 'Sheet appears empty or unreadable as CSV' });
        }

        // Persist publicCsvUrl in integrations config for 15s background polling
        const now = new Date().toISOString();
        const existing = db
          .prepare("SELECT id, config_json FROM integrations WHERE business_id = ? AND provider = 'google_sheets'")
          .get(businessId) as { id: string; config_json: string } | undefined;
        const integId = existing?.id || crypto.randomUUID();
        const prevCfg = existing ? JSON.parse(existing.config_json || '{}') : {};
        const nextCfg = {
          ...prevCfg,
          publicCsvUrl: csvExportUrl,
          sheetUrl: sheetUrl.trim(),
          autoScheduled: autoScheduled !== undefined ? Boolean(autoScheduled) : true,
          conflictPolicy: 'sheet_wins',
        };
        db.prepare(`
          INSERT INTO integrations (id, business_id, provider, status, display_name, config_json, last_sync_at, last_error, created_at, updated_at)
          VALUES (?, ?, 'google_sheets', 'connected', 'Google Sheet (Live CSV Sync)', ?, ?, NULL, ?, ?)
          ON CONFLICT(business_id, provider) DO UPDATE SET
            status = 'connected',
            display_name = excluded.display_name,
            config_json = excluded.config_json,
            last_sync_at = excluded.last_sync_at,
            last_error = NULL,
            updated_at = excluded.updated_at
        `).run(integId, businessId, JSON.stringify(nextCfg), now, now, now);

        result = syncSheetRowsToWorkspace(db, {
          businessId,
          rows,
          sourceLabel: 'google_sheet_live_csv',
          conflictPolicy: 'sheet_wins',
          actorUserId: req.authUser?.id || null,
          recordSyncLog: true,
          emitNotificationOnChanges: true,
        });
      } else {
        if (typeof autoScheduled === 'boolean') {
          const existing = db
            .prepare("SELECT id, config_json FROM integrations WHERE business_id = ? AND provider = 'google_sheets'")
            .get(businessId) as { id: string; config_json: string } | undefined;
          if (existing) {
            const prevCfg = JSON.parse(existing.config_json || '{}');
            db.prepare('UPDATE integrations SET config_json = ?, updated_at = ? WHERE id = ?').run(
              JSON.stringify({ ...prevCfg, autoScheduled }),
              new Date().toISOString(),
              existing.id
            );
          }
        }
        result = syncAttachedSheetToWorkspace(db, businessId, ATTACHED_SHEET_PATH, {
          emitNotificationOnChanges: true,
        });
      }

      res.json({ ok: true, mode: mode || 'attached', ...result });
    } catch (err: any) {
      res.status(500).json({ error: err.message || 'Sheet sync failed' });
    }
  });

  // Create new production business workspace
  router.post('/businesses', authMiddleware, (req: AuthRequest, res) => {
    if (req.authUser?.isDemoUser) {
      return res.status(403).json({ error: 'Authentication required to create a production business workspace.' });
    }

    const { name, industry, phone, email, website, timezone, defaultCountryCode } = req.body || {};
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Business name is required' });
    }

    const now = new Date().toISOString();
    const businessId = crypto.randomUUID();

    db.exec('BEGIN');
    try {
      db.prepare(`
        INSERT INTO businesses (id, name, industry, phone, email, website, timezone, default_country_code, is_demo, round_robin_enabled, round_robin_index, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?)
      `).run(
        businessId,
        name.trim(),
        (industry || 'General').trim(),
        phone?.trim() || null,
        email?.trim() || null,
        website?.trim() || null,
        timezone || 'Asia/Riyadh',
        defaultCountryCode || '+966',
        req.authUser!.id,
        now,
        now
      );

      db.prepare(`
        INSERT INTO business_memberships (id, business_id, user_id, invited_email, display_name, role, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'business_admin', 'active', ?, ?)
      `).run(
        crypto.randomUUID(),
        businessId,
        req.authUser!.id,
        req.authUser!.email,
        req.authUser!.fullName,
        now,
        now
      );

      createDefaultStagesForBusiness(db, businessId);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    writeAuditLog(db, {
      businessId,
      actorUserId: req.authUser!.id,
      action: 'business_created',
      entityType: 'business',
      entityId: businessId,
      details: { name: name.trim() },
      ipAddress: req.ip,
    });

    const business = db.prepare("SELECT *, 'business_admin' as member_role FROM businesses WHERE id = ?").get(businessId);
    res.status(201).json({ business });
  });

  // Update business profile & settings
  router.patch(
    '/businesses/:businessId',
    authMiddleware,
    requireBusinessAccess(db, ['super_admin', 'business_admin']),
    (req: AuthRequest, res) => {
      const { businessId } = req.params;
      const { name, industry, logoUrl, phone, email, website, timezone, defaultCountryCode, roundRobinEnabled } = req.body || {};
      const now = new Date().toISOString();

      db.prepare(`
        UPDATE businesses
        SET name = COALESCE(NULLIF(?, ''), name),
            industry = COALESCE(NULLIF(?, ''), industry),
            logo_url = COALESCE(?, logo_url),
            phone = COALESCE(?, phone),
            email = COALESCE(?, email),
            website = COALESCE(?, website),
            timezone = COALESCE(NULLIF(?, ''), timezone),
            default_country_code = COALESCE(NULLIF(?, ''), default_country_code),
            round_robin_enabled = COALESCE(?, round_robin_enabled),
            updated_at = ?
        WHERE id = ?
      `).run(
        name?.trim() || '',
        industry?.trim() || '',
        logoUrl ?? null,
        phone ?? null,
        email ?? null,
        website ?? null,
        timezone || '',
        defaultCountryCode || '',
        typeof roundRobinEnabled === 'boolean' ? (roundRobinEnabled ? 1 : 0) : null,
        now,
        businessId
      );

      const updated = db.prepare('SELECT * FROM businesses WHERE id = ?').get(businessId);
      res.json({ business: updated });
    }
  );

  // Pipeline Stages
  router.get('/businesses/:businessId/stages', authMiddleware, requireBusinessAccess(db), (req: AuthRequest, res) => {
    const stages = db
      .prepare('SELECT * FROM lead_statuses WHERE business_id = ? ORDER BY sort_order ASC')
      .all(req.params.businessId);
    res.json({ stages });
  });

  router.post(
    '/businesses/:businessId/stages',
    authMiddleware,
    requireBusinessAccess(db, ['super_admin', 'business_admin']),
    (req: AuthRequest, res) => {
      const { businessId } = req.params;
      const { nameAr, nameEn, color, isConverted, isLost } = req.body || {};
      if (!nameAr || !nameEn) {
        return res.status(400).json({ error: 'Stage Arabic and English names are required' });
      }
      const maxRow = db
        .prepare('SELECT COALESCE(MAX(sort_order), 0) as maxOrder FROM lead_statuses WHERE business_id = ?')
        .get(businessId) as { maxOrder: number };

      const id = crypto.randomUUID();
      const key = `${nameEn.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${Date.now().toString().slice(-4)}`;
      const now = new Date().toISOString();

      db.prepare(`
        INSERT INTO lead_statuses (id, business_id, key, name_ar, name_en, color, sort_order, is_default, is_converted, is_lost, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
      `).run(id, businessId, key, nameAr.trim(), nameEn.trim(), color || '#2563EB', maxRow.maxOrder + 1, isConverted ? 1 : 0, isLost ? 1 : 0, now);

      const stage = db.prepare('SELECT * FROM lead_statuses WHERE id = ?').get(id);
      res.status(201).json({ stage });
    }
  );

  router.put(
    '/businesses/:businessId/stages/reorder',
    authMiddleware,
    requireBusinessAccess(db, ['super_admin', 'business_admin']),
    (req: AuthRequest, res) => {
      const { businessId } = req.params;
      const { orderedIds } = req.body || {};
      if (!Array.isArray(orderedIds)) {
        return res.status(400).json({ error: 'orderedIds array is required' });
      }
      const stmt = db.prepare('UPDATE lead_statuses SET sort_order = ? WHERE id = ? AND business_id = ?');
      orderedIds.forEach((id: string, idx: number) => {
        stmt.run(idx + 1, id, businessId);
      });
      const stages = db.prepare('SELECT * FROM lead_statuses WHERE business_id = ? ORDER BY sort_order ASC').all(businessId);
      res.json({ stages });
    }
  );

  router.patch(
    '/businesses/:businessId/stages/:stageId',
    authMiddleware,
    requireBusinessAccess(db, ['super_admin', 'business_admin']),
    (req: AuthRequest, res) => {
      const { businessId, stageId } = req.params;
      const { nameAr, nameEn, color, sortOrder } = req.body || {};
      db.prepare(`
        UPDATE lead_statuses
        SET name_ar = COALESCE(NULLIF(?, ''), name_ar),
            name_en = COALESCE(NULLIF(?, ''), name_en),
            color = COALESCE(NULLIF(?, ''), color),
            sort_order = COALESCE(?, sort_order)
        WHERE id = ? AND business_id = ?
      `).run(nameAr?.trim() || '', nameEn?.trim() || '', color || '', typeof sortOrder === 'number' ? sortOrder : null, stageId, businessId);

      const stage = db.prepare('SELECT * FROM lead_statuses WHERE id = ? AND business_id = ?').get(stageId, businessId);
      res.json({ stage });
    }
  );

  router.delete(
    '/businesses/:businessId/stages/:stageId',
    authMiddleware,
    requireBusinessAccess(db, ['super_admin', 'business_admin']),
    (req: AuthRequest, res) => {
      const { businessId, stageId } = req.params;
      const used = db
        .prepare('SELECT COUNT(*) as cnt FROM leads WHERE business_id = ? AND status_id = ?')
        .get(businessId, stageId) as { cnt: number };

      if (used.cnt > 0) {
        return res.status(409).json({ error: `Cannot delete stage with ${used.cnt} active leads. Move leads first.` });
      }
      db.prepare('DELETE FROM lead_statuses WHERE id = ? AND business_id = ?').run(stageId, businessId);
      res.json({ deleted: true });
    }
  );

  // Custom Lead Fields
  router.get('/businesses/:businessId/custom-fields', authMiddleware, requireBusinessAccess(db), (req: AuthRequest, res) => {
    const fields = db
      .prepare('SELECT * FROM lead_custom_fields WHERE business_id = ? ORDER BY sort_order ASC')
      .all(req.params.businessId)
      .map((f: any) => ({ ...f, options: JSON.parse(f.options_json || '[]') }));
    res.json({ fields });
  });

  router.post(
    '/businesses/:businessId/custom-fields',
    authMiddleware,
    requireBusinessAccess(db, ['super_admin', 'business_admin']),
    (req: AuthRequest, res) => {
      const { businessId } = req.params;
      const { labelAr, labelEn, fieldType, options, isRequired } = req.body || {};
      const validTypes = ['text', 'number', 'phone', 'email', 'date', 'dropdown', 'checkbox', 'multi_choice', 'long_text'];
      if (!labelAr || !labelEn || !validTypes.includes(fieldType)) {
        return res.status(400).json({ error: 'Valid labels and fieldType are required' });
      }

      const id = crypto.randomUUID();
      const fieldKey = `${labelEn.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_${Date.now().toString().slice(-4)}`;
      const maxOrder = db
        .prepare('SELECT COALESCE(MAX(sort_order), 0) as m FROM lead_custom_fields WHERE business_id = ?')
        .get(businessId) as { m: number };

      db.prepare(`
        INSERT INTO lead_custom_fields (id, business_id, field_key, label_ar, label_en, field_type, options_json, is_required, sort_order, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        businessId,
        fieldKey,
        labelAr.trim(),
        labelEn.trim(),
        fieldType,
        JSON.stringify(Array.isArray(options) ? options : []),
        isRequired ? 1 : 0,
        maxOrder.m + 1,
        new Date().toISOString()
      );

      const created = db.prepare('SELECT * FROM lead_custom_fields WHERE id = ?').get(id) as any;
      res.status(201).json({ field: { ...created, options: JSON.parse(created.options_json || '[]') } });
    }
  );

  router.delete(
    '/businesses/:businessId/custom-fields/:fieldId',
    authMiddleware,
    requireBusinessAccess(db, ['super_admin', 'business_admin']),
    (req: AuthRequest, res) => {
      db.prepare('DELETE FROM lead_custom_fields WHERE id = ? AND business_id = ?').run(
        req.params.fieldId,
        req.params.businessId
      );
      res.json({ deleted: true });
    }
  );

  // Leads Query with server-side pagination, search, sorting, filtering & RBAC
  router.get('/businesses/:businessId/leads', authMiddleware, requireBusinessAccess(db), (req: AuthRequest, res) => {
    const { businessId } = req.params;
    const page = Math.max(1, Number(req.query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 25)));
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const statusId = typeof req.query.statusId === 'string' ? req.query.statusId : '';
    const source = typeof req.query.source === 'string' ? req.query.source : '';
    const assignedTo = typeof req.query.assignedTo === 'string' ? req.query.assignedTo : '';
    const campaign = typeof req.query.campaign === 'string' ? req.query.campaign : '';
    const sortBy = typeof req.query.sortBy === 'string' ? req.query.sortBy : 'created_at';
    const sortDir = req.query.sortDir === 'asc' ? 'ASC' : 'DESC';

    const where: string[] = ['l.business_id = ?'];
    const params: unknown[] = [businessId];

    // Strict Employee RBAC: Employees see only leads assigned to them
    if (req.membership?.role === 'employee') {
      where.push('l.assigned_to_user_id = ?');
      params.push(req.authUser!.id);
    } else if (assignedTo) {
      if (assignedTo === 'unassigned') {
        where.push('l.assigned_to_user_id IS NULL');
      } else {
        where.push('l.assigned_to_user_id = ?');
        params.push(assignedTo);
      }
    }

    if (statusId) {
      where.push('l.status_id = ?');
      params.push(statusId);
    }
    if (source) {
      where.push('l.source = ?');
      params.push(source);
    }
    if (campaign) {
      where.push('l.campaign_name = ?');
      params.push(campaign);
    }
    if (q) {
      const normalizedQ = normalizeArabicDigits(q);
      const digitsOnly = normalizedQ.replace(/\D/g, '');
      const like = `%${normalizedQ}%`;
      if (digitsOnly.length >= 4) {
        const digitsLike = `%${digitsOnly}%`;
        where.push(
          `(l.full_name LIKE ? OR l.phone LIKE ? OR l.phone_e164 LIKE ? OR REPLACE(REPLACE(REPLACE(COALESCE(l.phone_e164, l.phone, ''), '+', ''), ' ', ''), '-', '') LIKE ? OR l.email LIKE ? OR l.lead_code LIKE ? OR l.campaign_name LIKE ? OR l.ad_name LIKE ? OR l.ad_set_name LIKE ? OR l.interested_service LIKE ? OR l.notes_summary LIKE ? OR l.custom_values_json LIKE ?)`
        );
        params.push(like, like, like, digitsLike, like, like, like, like, like, like, like, like);
      } else {
        where.push(
          '(l.full_name LIKE ? OR l.phone LIKE ? OR l.phone_e164 LIKE ? OR l.email LIKE ? OR l.lead_code LIKE ? OR l.campaign_name LIKE ? OR l.ad_name LIKE ? OR l.ad_set_name LIKE ? OR l.interested_service LIKE ? OR l.notes_summary LIKE ? OR l.custom_values_json LIKE ?)'
        );
        params.push(like, like, like, like, like, like, like, like, like, like, like);
      }
    }

    const sortableCols: Record<string, string> = {
      created_at: 'l.created_at',
      full_name: 'l.full_name',
      lead_code: 'l.lead_code',
      next_follow_up_at: 'l.next_follow_up_at',
      last_contact_at: 'l.last_contact_at',
    };
    const orderCol = sortableCols[sortBy] || 'l.created_at';
    const whereClause = where.join(' AND ');

    const totalRow = db
      .prepare(`SELECT COUNT(*) as total FROM leads l WHERE ${whereClause}`)
      .get(...(params as any[])) as { total: number };

    const offset = (page - 1) * pageSize;
    const rows = db
      .prepare(`
        SELECT l.*,
               s.key as status_key, s.name_ar as status_name_ar, s.name_en as status_name_en, s.color as status_color,
               u.full_name as assigned_employee_name, u.email as assigned_employee_email,
               b.name as business_name
        FROM leads l
        LEFT JOIN lead_statuses s ON s.id = l.status_id
        LEFT JOIN users u ON u.id = l.assigned_to_user_id
        LEFT JOIN businesses b ON b.id = l.business_id
        WHERE ${whereClause}
        ORDER BY ${orderCol} ${sortDir}
        LIMIT ? OFFSET ?
      `)
      .all(...(params as any[]), pageSize, offset);

    res.json({
      leads: rows,
      total: totalRow.total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(totalRow.total / pageSize)),
    });
  });

  // Create Lead manually
  router.post('/businesses/:businessId/leads', authMiddleware, requireBusinessAccess(db), (req: AuthRequest, res) => {
    const { businessId } = req.params;
    const body = req.body || {};
    if (!body.fullName || typeof body.fullName !== 'string' || !body.fullName.trim()) {
      return res.status(400).json({ error: 'Customer fullName is required' });
    }

    const assignedTo =
      req.membership?.role === 'employee' ? req.authUser!.id : body.assignedToUserId ?? null;

    const result = createLeadRecord(db, {
      businessId,
      fullName: body.fullName,
      phone: body.phone,
      email: body.email,
      interestedService: body.interestedService,
      source: body.source || 'manual',
      statusId: body.statusId,
      assignedToUserId: assignedTo,
      campaignName: body.campaignName,
      adSetName: body.adSetName,
      adName: body.adName,
      customValues: body.customValues || {},
      notesSummary: body.notesSummary,
      nextFollowUpAt: body.nextFollowUpAt,
      actorUserId: req.authUser?.id,
    });

    writeAuditLog(db, {
      businessId,
      actorUserId: req.authUser?.id,
      action: 'lead_created',
      entityType: 'lead',
      entityId: (result.lead as any).id,
      ipAddress: req.ip,
    });

    broadcastWorkspaceEvent(businessId, 'lead_updated', { businessId, leadId: (result.lead as any).id });
    res.status(201).json(result);
  });

  // Bulk Lead Operations
  router.post(
    '/businesses/:businessId/leads/bulk',
    authMiddleware,
    requireBusinessAccess(db, ['super_admin', 'business_admin', 'manager']),
    (req: AuthRequest, res) => {
      const { businessId } = req.params;
      const { leadIds, action, statusId, assignedToUserId } = req.body || {};

      if (!Array.isArray(leadIds) || leadIds.length === 0) {
        return res.status(400).json({ error: 'leadIds array is required' });
      }

      let updated = 0;
      if (action === 'status' && statusId) {
        for (const leadId of leadIds) {
          try {
            changeLeadStatus(db, {
              businessId,
              leadId,
              toStatusId: statusId,
              actorUserId: req.authUser?.id,
              note: 'Bulk status update',
            });
            updated += 1;
          } catch {
            // Skip invalid IDs
          }
        }
      } else if (action === 'assign') {
        const now = new Date().toISOString();
        const stmt = db.prepare('UPDATE leads SET assigned_to_user_id = ?, updated_at = ? WHERE id = ? AND business_id = ?');
        for (const leadId of leadIds) {
          const info = stmt.run(assignedToUserId || null, now, leadId, businessId);
          if (info.changes > 0) {
            updated += 1;
            db.prepare(`
              INSERT INTO lead_activities (id, business_id, lead_id, actor_user_id, activity_type, description_ar, description_en, metadata_json, created_at)
              VALUES (?, ?, ?, ?, 'lead_assigned', 'تم إعادة تعيين الموظف (تحديث جماعي)', 'Employee assigned (bulk update)', '{}', ?)
            `).run(crypto.randomUUID(), businessId, leadId, req.authUser?.id || null, now);
          }
        }
      } else {
        return res.status(400).json({ error: 'Invalid bulk action' });
      }

      if (updated > 0) {
        if (updated > 1) {
          createAndBroadcastNotification(db, {
            businessId,
            userId: null,
            type: action === 'status' ? 'status_changed' : 'lead_assigned',
            titleAr: `تحديث جماعي (${updated} عملاء)`,
            titleEn: `Bulk Update (${updated} leads)`,
            messageAr:
              action === 'status'
                ? `تم تحديث مرحلة ${updated} عميل دفعة واحدة`
                : `تم تحديث الموظف المسؤول لـ ${updated} عميل`,
            messageEn:
              action === 'status'
                ? `Updated stage for ${updated} leads`
                : `Updated assignee for ${updated} leads`,
            linkPath: '/leads',
          });
        }
        broadcastWorkspaceEvent(businessId, 'lead_updated', { businessId, updated });
      }
      res.json({ updated });
    }
  );

  // Export CSV or Excel (.xlsx)
  router.get('/businesses/:businessId/leads/export', authMiddleware, requireBusinessAccess(db), (req: AuthRequest, res) => {
    const { businessId } = req.params;
    const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv';

    const where = ['l.business_id = ?'];
    const params: unknown[] = [businessId];
    if (req.membership?.role === 'employee') {
      where.push('l.assigned_to_user_id = ?');
      params.push(req.authUser!.id);
    }

    const rows = db
      .prepare(`
        SELECT l.lead_code, l.full_name, l.phone_e164, l.phone, l.email, b.name as business_name,
               l.interested_service, s.name_en as status, u.full_name as assigned_to, l.source,
               l.campaign_name, l.ad_set_name, l.ad_name, l.notes_summary, l.created_at, l.last_contact_at, l.next_follow_up_at
        FROM leads l
        LEFT JOIN lead_statuses s ON s.id = l.status_id
        LEFT JOIN users u ON u.id = l.assigned_to_user_id
        LEFT JOIN businesses b ON b.id = l.business_id
        WHERE ${where.join(' AND ')}
        ORDER BY l.created_at DESC
      `)
      .all(...(params as any[])) as any[];

    const worksheetData = rows.map((r) => ({
      'Lead ID': r.lead_code,
      'Customer Name': r.full_name,
      Phone: r.phone_e164 || r.phone || '',
      Email: r.email || '',
      Business: r.business_name || '',
      'Interested Service': r.interested_service || '',
      Status: r.status || '',
      'Assigned Employee': r.assigned_to || '',
      Source: r.source || '',
      Campaign: r.campaign_name || '',
      'Ad Set': r.ad_set_name || '',
      Ad: r.ad_name || '',
      Notes: r.notes_summary || '',
      'Created At': r.created_at,
      'Last Contact': r.last_contact_at || '',
      'Next Follow-up': r.next_follow_up_at || '',
    }));

    const ws = XLSX.utils.json_to_sheet(worksheetData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Leads');

    if (format === 'xlsx') {
      const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="leads-${businessId.slice(0, 8)}.xlsx"`);
      return res.send(buf);
    }

    const csv = '\uFEFF' + XLSX.utils.sheet_to_csv(ws);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="leads-${businessId.slice(0, 8)}.csv"`);
    res.send(csv);
  });

  // Single Lead Profile + History + Notes + Follow-ups + Activities
  router.get('/businesses/:businessId/leads/:leadId', authMiddleware, requireBusinessAccess(db), (req: AuthRequest, res) => {
    const { businessId, leadId } = req.params;
    const lead = db
      .prepare(`
        SELECT l.*,
               s.key as status_key, s.name_ar as status_name_ar, s.name_en as status_name_en, s.color as status_color,
               u.full_name as assigned_employee_name, u.email as assigned_employee_email,
               b.name as business_name
        FROM leads l
        LEFT JOIN lead_statuses s ON s.id = l.status_id
        LEFT JOIN users u ON u.id = l.assigned_to_user_id
        LEFT JOIN businesses b ON b.id = l.business_id
        WHERE l.id = ? AND l.business_id = ?
      `)
      .get(leadId, businessId) as any;

    if (!lead) {
      return res.status(404).json({ error: 'Lead not found' });
    }

    if (req.membership?.role === 'employee' && lead.assigned_to_user_id !== req.authUser!.id) {
      return res.status(403).json({ error: 'Forbidden: You can only access leads assigned to you' });
    }

    const statusHistory = db
      .prepare(`
        SELECT h.*, fs.name_ar as from_ar, fs.name_en as from_en, ts.name_ar as to_ar, ts.name_en as to_en, u.full_name as changed_by_name
        FROM lead_status_history h
        LEFT JOIN lead_statuses fs ON fs.id = h.from_status_id
        LEFT JOIN lead_statuses ts ON ts.id = h.to_status_id
        LEFT JOIN users u ON u.id = h.changed_by_user_id
        WHERE h.lead_id = ? AND h.business_id = ?
        ORDER BY h.created_at DESC
      `)
      .all(leadId, businessId);

    const notes = db
      .prepare(`
        SELECT n.*, u.full_name as author_name
        FROM lead_notes n
        LEFT JOIN users u ON u.id = n.author_user_id
        WHERE n.lead_id = ? AND n.business_id = ?
        ORDER BY n.created_at DESC
      `)
      .all(leadId, businessId);

    const activities = db
      .prepare(`
        SELECT a.*, u.full_name as actor_name
        FROM lead_activities a
        LEFT JOIN users u ON u.id = a.actor_user_id
        WHERE a.lead_id = ? AND a.business_id = ?
        ORDER BY a.created_at DESC
      `)
      .all(leadId, businessId);

    const followUps = db
      .prepare(`
        SELECT f.*, u.full_name as assigned_name
        FROM follow_up_tasks f
        LEFT JOIN users u ON u.id = f.assigned_to_user_id
        WHERE f.lead_id = ? AND f.business_id = ?
        ORDER BY f.due_at ASC
      `)
      .all(leadId, businessId);

    const duplicates = findDuplicateLeads(db, businessId, lead.phone_e164, lead.email, lead.id);

    res.json({ lead, statusHistory, notes, activities, followUps, duplicates });
  });

  // Update Lead info (never overwrites original_answers_json)
  router.patch('/businesses/:businessId/leads/:leadId', authMiddleware, requireBusinessAccess(db), (req: AuthRequest, res) => {
    const { businessId, leadId } = req.params;
    const existing = db.prepare('SELECT * FROM leads WHERE id = ? AND business_id = ?').get(leadId, businessId) as any;
    if (!existing) return res.status(404).json({ error: 'Lead not found' });

    if (req.membership?.role === 'employee' && existing.assigned_to_user_id !== req.authUser!.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { fullName, phone, email, interestedService, customValues, notesSummary } = req.body || {};
    const biz = db.prepare('SELECT default_country_code FROM businesses WHERE id = ?').get(businessId) as { default_country_code: string };
    const now = new Date().toISOString();
    const phoneE164 = phone !== undefined ? normalizePhoneE164(phone, biz.default_country_code) : existing.phone_e164;

    db.prepare(`
      UPDATE leads
      SET full_name = COALESCE(NULLIF(?, ''), full_name),
          phone = COALESCE(?, phone),
          phone_e164 = COALESCE(?, phone_e164),
          email = COALESCE(?, email),
          interested_service = COALESCE(?, interested_service),
          custom_values_json = COALESCE(?, custom_values_json),
          notes_summary = COALESCE(?, notes_summary),
          updated_at = ?
      WHERE id = ? AND business_id = ?
    `).run(
      fullName?.trim() || '',
      phone ?? null,
      phoneE164 ?? null,
      email ?? null,
      interestedService ?? null,
      customValues ? JSON.stringify(customValues) : null,
      notesSummary ?? null,
      now,
      leadId,
      businessId
    );

    db.prepare(`
      INSERT INTO lead_activities (id, business_id, lead_id, actor_user_id, activity_type, description_ar, description_en, metadata_json, created_at)
      VALUES (?, ?, ?, ?, 'lead_updated', 'تم تحديث بيانات العميل', 'Lead details updated', '{}', ?)
    `).run(crypto.randomUUID(), businessId, leadId, req.authUser?.id || null, now);

    const updated = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId) as any;
    createAndBroadcastNotification(db, {
      businessId,
      userId: updated?.assigned_to_user_id || null,
      type: 'lead_updated',
      titleAr: `تحديث بيانات: ${updated?.full_name || existing.full_name}`,
      titleEn: `Lead Updated: ${updated?.full_name || existing.full_name}`,
      messageAr: `تم تعديل ملف العميل (${existing.lead_code})`,
      messageEn: `Updated customer profile (${existing.lead_code})`,
      linkPath: `/leads/${leadId}`,
      leadId,
      createdAt: now,
    });
    broadcastWorkspaceEvent(businessId, 'lead_updated', { businessId, leadId });
    res.json({ lead: updated });
  });

  // Change Lead Status
  router.post('/businesses/:businessId/leads/:leadId/status', authMiddleware, requireBusinessAccess(db), (req: AuthRequest, res) => {
    const { businessId, leadId } = req.params;
    const existing = db.prepare('SELECT assigned_to_user_id FROM leads WHERE id = ? AND business_id = ?').get(leadId, businessId) as any;
    if (!existing) return res.status(404).json({ error: 'Lead not found' });

    if (req.membership?.role === 'employee' && existing.assigned_to_user_id !== req.authUser!.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { statusId, note } = req.body || {};
    if (!statusId) return res.status(400).json({ error: 'statusId is required' });

    const lead = changeLeadStatus(db, {
      businessId,
      leadId,
      toStatusId: statusId,
      actorUserId: req.authUser?.id,
      note,
    });
    broadcastWorkspaceEvent(businessId, 'lead_updated', { businessId, leadId });
    res.json({ lead });
  });

  // Assign Lead to Employee
  router.post(
    '/businesses/:businessId/leads/:leadId/assign',
    authMiddleware,
    requireBusinessAccess(db, ['super_admin', 'business_admin', 'manager']),
    (req: AuthRequest, res) => {
      const { businessId, leadId } = req.params;
      const { assignedToUserId } = req.body || {};
      const lead = db.prepare('SELECT * FROM leads WHERE id = ? AND business_id = ?').get(leadId, businessId) as any;
      if (!lead) return res.status(404).json({ error: 'Lead not found' });

      const now = new Date().toISOString();
      db.prepare('UPDATE leads SET assigned_to_user_id = ?, updated_at = ? WHERE id = ? AND business_id = ?').run(
        assignedToUserId || null,
        now,
        leadId,
        businessId
      );

      const emp = assignedToUserId
        ? (db.prepare('SELECT full_name FROM users WHERE id = ?').get(assignedToUserId) as { full_name: string } | undefined)
        : undefined;

      db.prepare(`
        INSERT INTO lead_activities (id, business_id, lead_id, actor_user_id, activity_type, description_ar, description_en, metadata_json, created_at)
        VALUES (?, ?, ?, ?, 'lead_assigned', ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        businessId,
        leadId,
        req.authUser?.id || null,
        emp ? `تم تعيين العميل إلى ${emp.full_name}` : 'تم إلغاء تعيين الموظف',
        emp ? `Lead assigned to ${emp.full_name}` : 'Lead unassigned',
        JSON.stringify({ assignedToUserId }),
        now
      );

      if (assignedToUserId) {
        createAndBroadcastNotification(db, {
          businessId,
          userId: assignedToUserId,
          type: 'lead_assigned',
          titleAr: `تم تعيين عميل لك: ${lead.full_name}`,
          titleEn: `Lead Assigned: ${lead.full_name}`,
          messageAr: `تم إسناد العميل ${lead.full_name} (${lead.lead_code}) إلى ${emp?.full_name || 'موظف'}`,
          messageEn: `${lead.full_name} (${lead.lead_code}) assigned to ${emp?.full_name || 'team member'}`,
          linkPath: `/leads/${leadId}`,
          leadId,
          createdAt: now,
        });
      }

      broadcastWorkspaceEvent(businessId, 'lead_updated', { businessId, leadId });
      res.json({ lead: db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId) });
    }
  );

  // Add Note to Lead
  router.post('/businesses/:businessId/leads/:leadId/notes', authMiddleware, requireBusinessAccess(db), (req: AuthRequest, res) => {
    const { businessId, leadId } = req.params;
    const { content } = req.body || {};
    if (!content || !content.trim()) return res.status(400).json({ error: 'Note content is required' });

    const lead = db.prepare('SELECT id, full_name, lead_code, assigned_to_user_id FROM leads WHERE id = ? AND business_id = ?').get(leadId, businessId) as any;
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (req.membership?.role === 'employee' && lead.assigned_to_user_id !== req.authUser!.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const now = new Date().toISOString();
    const noteId = crypto.randomUUID();
    db.prepare('INSERT INTO lead_notes (id, business_id, lead_id, author_user_id, content, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      noteId,
      businessId,
      leadId,
      req.authUser?.id || null,
      content.trim(),
      now
    );

    db.prepare('UPDATE leads SET notes_summary = ?, last_contact_at = ?, updated_at = ? WHERE id = ?').run(
      content.trim().slice(0, 240),
      now,
      now,
      leadId
    );

    db.prepare(`
      INSERT INTO lead_activities (id, business_id, lead_id, actor_user_id, activity_type, description_ar, description_en, metadata_json, created_at)
      VALUES (?, ?, ?, ?, 'note_added', 'تمت إضافة ملاحظة جديدة', 'Internal note added', '{}', ?)
    `).run(crypto.randomUUID(), businessId, leadId, req.authUser?.id || null, now);

    createAndBroadcastNotification(db, {
      businessId,
      userId: lead.assigned_to_user_id || null,
      type: 'note_added',
      titleAr: `ملاحظة جديدة: ${lead.full_name}`,
      titleEn: `New Note: ${lead.full_name}`,
      messageAr: `${lead.lead_code}: ${content.trim().slice(0, 80)}`,
      messageEn: `${lead.lead_code}: ${content.trim().slice(0, 80)}`,
      linkPath: `/leads/${leadId}`,
      leadId,
      createdAt: now,
    });
    broadcastWorkspaceEvent(businessId, 'lead_updated', { businessId, leadId });

    res.status(201).json({ note: db.prepare('SELECT * FROM lead_notes WHERE id = ?').get(noteId) });
  });

  // Follow-up Tasks
  router.get('/businesses/:businessId/follow-ups', authMiddleware, requireBusinessAccess(db), (req: AuthRequest, res) => {
    const { businessId } = req.params;
    const filter = String(req.query.filter || 'all');
    const nowIso = new Date().toISOString();

    const where = ['f.business_id = ?'];
    const params: unknown[] = [businessId];

    if (req.membership?.role === 'employee') {
      where.push('f.assigned_to_user_id = ?');
      params.push(req.authUser!.id);
    }

    if (filter === 'overdue') {
      where.push("f.status = 'pending' AND f.due_at < ?");
      params.push(nowIso);
    } else if (filter === 'upcoming') {
      where.push("f.status = 'pending' AND f.due_at >= ?");
      params.push(nowIso);
    } else if (filter === 'completed') {
      where.push("f.status = 'completed'");
    }

    const tasks = db
      .prepare(`
        SELECT f.*, l.full_name as lead_name, l.lead_code, l.phone_e164, l.phone, u.full_name as assigned_name
        FROM follow_up_tasks f
        JOIN leads l ON l.id = f.lead_id
        LEFT JOIN users u ON u.id = f.assigned_to_user_id
        WHERE ${where.join(' AND ')}
        ORDER BY f.status ASC, f.due_at ASC
      `)
      .all(...(params as any[]));

    res.json({ followUps: tasks });
  });

  router.post('/businesses/:businessId/follow-ups', authMiddleware, requireBusinessAccess(db), (req: AuthRequest, res) => {
    const { businessId } = req.params;
    const { leadId, title, notes, dueAt, assignedToUserId } = req.body || {};
    if (!leadId || !title || !dueAt) {
      return res.status(400).json({ error: 'leadId, title, and dueAt are required' });
    }

    const lead = db.prepare('SELECT * FROM leads WHERE id = ? AND business_id = ?').get(leadId, businessId) as any;
    if (!lead) return res.status(404).json({ error: 'Lead not found' });

    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const assignee = req.membership?.role === 'employee' ? req.authUser!.id : assignedToUserId || lead.assigned_to_user_id || req.authUser!.id;

    db.prepare(`
      INSERT INTO follow_up_tasks (id, business_id, lead_id, assigned_to_user_id, created_by_user_id, title, notes, due_at, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `).run(id, businessId, leadId, assignee, req.authUser!.id, title.trim(), notes?.trim() || null, dueAt, now);

    db.prepare('UPDATE leads SET next_follow_up_at = ?, updated_at = ? WHERE id = ?').run(dueAt, now, leadId);

    db.prepare(`
      INSERT INTO lead_activities (id, business_id, lead_id, actor_user_id, activity_type, description_ar, description_en, metadata_json, created_at)
      VALUES (?, ?, ?, ?, 'follow_up_scheduled', ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      businessId,
      leadId,
      req.authUser!.id,
      `تمت جدولة متابعة: ${title.trim()}`,
      `Scheduled follow-up: ${title.trim()}`,
      JSON.stringify({ dueAt }),
      now
    );

    createAndBroadcastNotification(db, {
      businessId,
      userId: assignee,
      type: 'follow_up_scheduled',
      titleAr: `متابعة مجدولة: ${lead.full_name}`,
      titleEn: `Follow-up Scheduled: ${lead.full_name}`,
      messageAr: `${title.trim()} (${lead.lead_code})`,
      messageEn: `${title.trim()} (${lead.lead_code})`,
      linkPath: `/leads/${leadId}`,
      leadId,
      createdAt: now,
    });
    broadcastWorkspaceEvent(businessId, 'lead_updated', { businessId, leadId });

    res.status(201).json({ followUp: db.prepare('SELECT * FROM follow_up_tasks WHERE id = ?').get(id) });
  });

  router.patch('/businesses/:businessId/follow-ups/:taskId', authMiddleware, requireBusinessAccess(db), (req: AuthRequest, res) => {
    const { businessId, taskId } = req.params;
    const { status, dueAt, notes } = req.body || {};
    const existing = db.prepare('SELECT * FROM follow_up_tasks WHERE id = ? AND business_id = ?').get(taskId, businessId) as any;
    if (!existing) return res.status(404).json({ error: 'Follow-up task not found' });

    if (req.membership?.role === 'employee' && existing.assigned_to_user_id !== req.authUser!.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const now = new Date().toISOString();
    const completedAt = status === 'completed' ? now : existing.completed_at;
    db.prepare(`
      UPDATE follow_up_tasks
      SET status = COALESCE(?, status),
          due_at = COALESCE(?, due_at),
          notes = COALESCE(?, notes),
          completed_at = ?
      WHERE id = ? AND business_id = ?
    `).run(status || null, dueAt || null, notes ?? null, completedAt, taskId, businessId);

    if (status === 'completed') {
      db.prepare(`
        INSERT INTO lead_activities (id, business_id, lead_id, actor_user_id, activity_type, description_ar, description_en, metadata_json, created_at)
        VALUES (?, ?, ?, ?, 'follow_up_completed', ?, ?, '{}', ?)
      `).run(
        crypto.randomUUID(),
        businessId,
        existing.lead_id,
        req.authUser!.id,
        `تم إكمال مهمة المتابعة: ${existing.title}`,
        `Completed follow-up: ${existing.title}`,
        now
      );

      const leadRow = db.prepare('SELECT full_name, lead_code, assigned_to_user_id FROM leads WHERE id = ?').get(existing.lead_id) as any;
      createAndBroadcastNotification(db, {
        businessId,
        userId: leadRow?.assigned_to_user_id || null,
        type: 'follow_up_completed',
        titleAr: `اكتملت متابعة: ${leadRow?.full_name || ''}`.trim(),
        titleEn: `Follow-up Completed: ${leadRow?.full_name || ''}`.trim(),
        messageAr: `${existing.title}${leadRow?.lead_code ? ` (${leadRow.lead_code})` : ''}`,
        messageEn: `${existing.title}${leadRow?.lead_code ? ` (${leadRow.lead_code})` : ''}`,
        linkPath: `/leads/${existing.lead_id}`,
        leadId: existing.lead_id,
        createdAt: now,
      });
      broadcastWorkspaceEvent(businessId, 'lead_updated', { businessId, leadId: existing.lead_id });
    }

    res.json({ followUp: db.prepare('SELECT * FROM follow_up_tasks WHERE id = ?').get(taskId) });
  });

  // System Accounts (Manager & Accountant) + Traditional Username/Password Access
  router.get('/businesses/:businessId/members', authMiddleware, requireBusinessAccess(db), (req: AuthRequest, res) => {
    const { businessId } = req.params;
    const members = db
      .prepare(`
        SELECT bm.*,
               u.username,
               u.full_name,
               u.avatar_url,
               CASE WHEN LOWER(bm.invited_email) = ? OR LOWER(u.username) = ? THEN 1 ELSE 0 END as is_owner,
               (SELECT COUNT(*) FROM leads l WHERE l.business_id = bm.business_id AND l.assigned_to_user_id = bm.user_id) as total_leads,
               (SELECT COUNT(*) FROM leads l JOIN lead_statuses s ON s.id = l.status_id WHERE l.business_id = bm.business_id AND l.assigned_to_user_id = bm.user_id AND s.is_converted = 1) as converted_leads
        FROM business_memberships bm
        LEFT JOIN users u ON u.id = bm.user_id
        WHERE bm.business_id = ?
        ORDER BY is_owner DESC, bm.created_at ASC
      `)
      .all(MASTER_OWNER_EMAIL, DEFAULT_ADMIN_USERNAME, businessId);
    res.json({ members });
  });

  router.post(
    '/businesses/:businessId/members/invite',
    authMiddleware,
    requireBusinessAccess(db, ['super_admin', 'business_admin']),
    (req: AuthRequest, res) => {
      const { businessId } = req.params;
      const { email, username, password, displayName, role, accountSlot } = req.body || {};
      const validSlots = ['manager', 'accountant'];
      const validRoles: Role[] = ['business_admin', 'manager', 'employee'];
      const resolvedSlot: 'manager' | 'accountant' = validSlots.includes(accountSlot)
        ? accountSlot
        : role === 'manager'
          ? 'manager'
          : 'accountant';
      const resolvedRole: Role = validSlots.includes(accountSlot)
        ? 'business_admin'
        : validRoles.includes(role)
          ? role
          : 'business_admin';

      const cleanUsername = typeof username === 'string' ? username.trim().toLowerCase() : '';
      const rawEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
      if (!rawEmail && !cleanUsername) {
        return res.status(400).json({ error: 'Username or valid email is required' });
      }
      if (rawEmail && !rawEmail.includes('@')) {
        return res.status(400).json({ error: 'Valid email is required' });
      }

      const normalizedEmail = rawEmail || `${cleanUsername}@alsafasteel.local`;
      if ((normalizedEmail === MASTER_OWNER_EMAIL || cleanUsername === DEFAULT_ADMIN_USERNAME) && !req.authUser?.isOwner) {
        return res.status(403).json({ error: 'Only the Master Owner can modify the admin account' });
      }

      const now = new Date().toISOString();
      let existingUser = (
        cleanUsername
          ? db.prepare('SELECT id, full_name, username, email FROM users WHERE LOWER(username) = ? OR LOWER(email) = ?').get(cleanUsername, normalizedEmail)
          : db.prepare('SELECT id, full_name, username, email FROM users WHERE LOWER(email) = ?').get(normalizedEmail)
      ) as any;

      const cleanPassword = typeof password === 'string' ? password : '';
      if (cleanUsername && cleanPassword && !existingUser) {
        const newUserId = crypto.randomUUID();
        const label = displayName?.trim() || cleanUsername;
        db.prepare(`
          INSERT INTO users (id, firebase_uid, username, password_hash, email, full_name, default_language, theme, is_platform_super_admin, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'ar', 'light', 0, ?, ?)
        `).run(
          newUserId,
          `local-${newUserId}`,
          cleanUsername,
          hashPassword(cleanPassword),
          normalizedEmail,
          label,
          now,
          now
        );
        existingUser = { id: newUserId, full_name: label, username: cleanUsername, email: normalizedEmail };
      } else if (existingUser && (cleanUsername || cleanPassword)) {
        db.prepare(`
          UPDATE users
          SET username = COALESCE(NULLIF(?, ''), username),
              password_hash = COALESCE(?, password_hash),
              full_name = COALESCE(NULLIF(?, ''), full_name),
              updated_at = ?
          WHERE id = ?
        `).run(
          cleanUsername || '',
          cleanPassword ? hashPassword(cleanPassword) : null,
          displayName?.trim() || '',
          now,
          existingUser.id
        );
      }

      const id = crypto.randomUUID();
      db.prepare(`
        INSERT INTO business_memberships (id, business_id, user_id, invited_email, display_name, account_slot, role, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(business_id, invited_email) DO UPDATE SET
          user_id = COALESCE(excluded.user_id, business_memberships.user_id),
          account_slot = excluded.account_slot,
          role = excluded.role,
          display_name = COALESCE(NULLIF(excluded.display_name, ''), display_name),
          status = 'active',
          updated_at = excluded.updated_at
      `).run(
        id,
        businessId,
        existingUser?.id || null,
        normalizedEmail,
        displayName?.trim() || existingUser?.full_name || cleanUsername || normalizedEmail.split('@')[0],
        normalizedEmail === MASTER_OWNER_EMAIL || cleanUsername === DEFAULT_ADMIN_USERNAME ? 'manager' : resolvedSlot,
        normalizedEmail === MASTER_OWNER_EMAIL || cleanUsername === DEFAULT_ADMIN_USERNAME ? 'business_admin' : resolvedRole,
        existingUser ? 'active' : 'invited',
        now,
        now
      );

      writeAuditLog(db, {
        businessId,
        actorUserId: req.authUser?.id,
        action: 'full_access_granted',
        entityType: 'membership',
        entityId: id,
        details: { email: normalizedEmail, username: cleanUsername || null, accountSlot: resolvedSlot, role: resolvedRole },
        ipAddress: req.ip,
      });

      const member = db
        .prepare(`
          SELECT bm.*, u.username, u.full_name,
                 CASE WHEN LOWER(bm.invited_email) = ? OR LOWER(u.username) = ? THEN 1 ELSE 0 END as is_owner
          FROM business_memberships bm
          LEFT JOIN users u ON u.id = bm.user_id
          WHERE bm.business_id = ? AND LOWER(bm.invited_email) = ?
        `)
        .get(MASTER_OWNER_EMAIL, DEFAULT_ADMIN_USERNAME, businessId, normalizedEmail);
      res.status(201).json({ member });
    }
  );

  router.patch(
    '/businesses/:businessId/members/:memberId',
    authMiddleware,
    requireBusinessAccess(db, ['super_admin', 'business_admin']),
    (req: AuthRequest, res) => {
      const { businessId, memberId } = req.params;
      const { role, status, accountSlot, displayName, email, username, password } = req.body || {};
      const existingMember = db
        .prepare('SELECT * FROM business_memberships WHERE id = ? AND business_id = ?')
        .get(memberId, businessId) as any;
      if (!existingMember) {
        return res.status(404).json({ error: 'Account membership not found' });
      }
      const existingUser = existingMember.user_id
        ? (db.prepare('SELECT * FROM users WHERE id = ?').get(existingMember.user_id) as any)
        : null;
      const isTargetOwner =
        existingMember.invited_email?.toLowerCase() === MASTER_OWNER_EMAIL ||
        existingUser?.username?.toLowerCase() === DEFAULT_ADMIN_USERNAME;
      if (isTargetOwner && (!req.authUser?.isOwner || status === 'inactive')) {
        return res.status(403).json({ error: 'Master Owner account cannot be deactivated or downgraded' });
      }

      const now = new Date().toISOString();
      if (existingUser && (password || (username && !isTargetOwner) || displayName)) {
        const cleanNewUsername = typeof username === 'string' && !isTargetOwner ? username.trim().toLowerCase() : '';
        const cleanPass = typeof password === 'string' && password.length >= 6 ? hashPassword(password) : null;
        db.prepare(`
          UPDATE users
          SET username = COALESCE(NULLIF(?, ''), username),
              password_hash = COALESCE(?, password_hash),
              full_name = COALESCE(NULLIF(?, ''), full_name),
              updated_at = ?
          WHERE id = ?
        `).run(cleanNewUsername, cleanPass, displayName?.trim() || '', now, existingUser.id);
      }

      const normalizedNewEmail =
        typeof email === 'string' && email.includes('@') && !isTargetOwner ? email.trim().toLowerCase() : null;
      const linkedUser = normalizedNewEmail
        ? (db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(normalizedNewEmail) as any)
        : null;

      db.prepare(`
        UPDATE business_memberships
        SET role = COALESCE(?, role),
            account_slot = COALESCE(?, account_slot),
            display_name = COALESCE(NULLIF(?, ''), display_name),
            invited_email = COALESCE(?, invited_email),
            user_id = CASE WHEN ? IS NOT NULL THEN ? ELSE user_id END,
            status = COALESCE(?, status),
            updated_at = ?
        WHERE id = ? AND business_id = ?
      `).run(
        isTargetOwner ? 'business_admin' : role || null,
        isTargetOwner ? 'manager' : accountSlot || null,
        displayName?.trim() || '',
        normalizedNewEmail,
        normalizedNewEmail,
        linkedUser?.id || null,
        isTargetOwner ? 'active' : status || null,
        now,
        memberId,
        businessId
      );
      res.json({
        member: db
          .prepare(`
            SELECT bm.*, u.username, u.full_name,
                   CASE WHEN LOWER(bm.invited_email) = ? OR LOWER(u.username) = ? THEN 1 ELSE 0 END as is_owner
            FROM business_memberships bm
            LEFT JOIN users u ON u.id = bm.user_id
            WHERE bm.id = ?
          `)
          .get(MASTER_OWNER_EMAIL, DEFAULT_ADMIN_USERNAME, memberId),
      });
    }
  );

  router.delete(
    '/businesses/:businessId/members/:memberId',
    authMiddleware,
    requireBusinessAccess(db, ['super_admin', 'business_admin']),
    (req: AuthRequest, res) => {
      const { businessId, memberId } = req.params;
      const existingMember = db
        .prepare('SELECT * FROM business_memberships WHERE id = ? AND business_id = ?')
        .get(memberId, businessId) as any;
      if (!existingMember) {
        return res.status(404).json({ error: 'Account membership not found' });
      }
      const existingUser = existingMember.user_id
        ? (db.prepare('SELECT username FROM users WHERE id = ?').get(existingMember.user_id) as any)
        : null;
      if (
        existingMember.invited_email?.toLowerCase() === MASTER_OWNER_EMAIL ||
        existingUser?.username?.toLowerCase() === DEFAULT_ADMIN_USERNAME
      ) {
        return res.status(403).json({ error: 'Cannot remove the Master Owner account' });
      }

      db.prepare('DELETE FROM business_memberships WHERE id = ? AND business_id = ?').run(memberId, businessId);
      writeAuditLog(db, {
        businessId,
        actorUserId: req.authUser?.id,
        action: 'access_revoked',
        entityType: 'membership',
        entityId: memberId,
        details: { email: existingMember.invited_email },
        ipAddress: req.ip,
      });
      res.json({ deleted: true });
    }
  );

  // Sync Firebase Firestore authorized full-access accounts into workspace memberships
  router.post(
    '/businesses/:businessId/access-accounts/sync',
    authMiddleware,
    requireBusinessAccess(db, ['super_admin', 'business_admin']),
    (req: AuthRequest, res) => {
      const { businessId } = req.params;
      const { accounts } = req.body || {};
      if (!Array.isArray(accounts)) {
        return res.status(400).json({ error: 'accounts array is required' });
      }

      const now = new Date().toISOString();
      const upsertStmt = db.prepare(`
        INSERT INTO business_memberships (id, business_id, user_id, invited_email, display_name, account_slot, role, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'business_admin', ?, ?, ?)
        ON CONFLICT(business_id, invited_email) DO UPDATE SET
          account_slot = excluded.account_slot,
          role = 'business_admin',
          display_name = COALESCE(NULLIF(excluded.display_name, ''), display_name),
          status = CASE
            WHEN LOWER(business_memberships.invited_email) = ? THEN 'active'
            ELSE excluded.status
          END,
          user_id = COALESCE(excluded.user_id, business_memberships.user_id),
          updated_at = excluded.updated_at
      `);

      for (const acct of accounts) {
        if (!acct || typeof acct.email !== 'string' || !acct.email.includes('@')) continue;
        const normalizedEmail = acct.email.trim().toLowerCase();
        const slot: 'manager' | 'accountant' = acct.accountType === 'manager' ? 'manager' : 'accountant';
        const existingUser = db.prepare('SELECT id, full_name FROM users WHERE LOWER(email) = ?').get(normalizedEmail) as any;
        const status =
          normalizedEmail === MASTER_OWNER_EMAIL
            ? 'active'
            : acct.status === 'inactive'
              ? 'inactive'
              : existingUser
                ? 'active'
                : 'invited';
        upsertStmt.run(
          crypto.randomUUID(),
          businessId,
          existingUser?.id || null,
          normalizedEmail,
          (acct.displayName || existingUser?.full_name || normalizedEmail.split('@')[0]).trim(),
          normalizedEmail === MASTER_OWNER_EMAIL ? 'manager' : slot,
          status,
          now,
          now,
          MASTER_OWNER_EMAIL
        );
      }

      const members = db
        .prepare(`
          SELECT bm.*, u.full_name, u.avatar_url,
                 CASE WHEN LOWER(bm.invited_email) = ? THEN 1 ELSE 0 END as is_owner
          FROM business_memberships bm
          LEFT JOIN users u ON u.id = bm.user_id
          WHERE bm.business_id = ?
          ORDER BY is_owner DESC, bm.created_at ASC
        `)
        .all(MASTER_OWNER_EMAIL, businessId);
      res.json({ synced: true, members });
    }
  );

  // Analytics & Campaign Attribution (100% computed from real DB rows)
  router.get('/businesses/:businessId/analytics', authMiddleware, requireBusinessAccess(db), (req: AuthRequest, res) => {
    const { businessId } = req.params;
    const isEmp = req.membership?.role === 'employee';
    const scopeWhere = isEmp ? 'l.business_id = ? AND l.assigned_to_user_id = ?' : 'l.business_id = ?';
    const scopeParams = isEmp ? [businessId, req.authUser!.id] : [businessId];

    const leads = db
      .prepare(`
        SELECT l.*, s.key as status_key, s.name_ar as status_ar, s.name_en as status_en, s.color as status_color,
               s.is_converted, s.is_lost, u.full_name as employee_name
        FROM leads l
        LEFT JOIN lead_statuses s ON s.id = l.status_id
        LEFT JOIN users u ON u.id = l.assigned_to_user_id
        WHERE ${scopeWhere}
      `)
      .all(...scopeParams) as any[];

    const now = Date.now();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayMs = startOfToday.getTime();
    const weekAgoMs = now - 7 * 86400_000;
    const monthAgoMs = now - 30 * 86400_000;

    let newCount = 0;
    let contactedCount = 0;
    let qualifiedCount = 0;
    let followUpCount = 0;
    let convertedCount = 0;
    let lostCount = 0;
    let todayCount = 0;
    let weekCount = 0;
    let monthCount = 0;

    const statusDistMap = new Map<string, { key: string; nameAr: string; nameEn: string; color: string; count: number }>();
    const sourceMap = new Map<string, number>();
    const campaignMap = new Map<string, { name: string; total: number; qualified: number; converted: number }>();
    const adSetMap = new Map<string, { name: string; campaign: string; total: number; converted: number }>();
    const adMap = new Map<string, { name: string; campaign: string; total: number; converted: number }>();
    const formMap = new Map<string, { name: string; total: number; converted: number }>();
    const employeeMap = new Map<string, { name: string; total: number; contacted: number; converted: number }>();

    for (const l of leads) {
      const t = new Date(l.created_at).getTime();
      if (t >= todayMs) todayCount += 1;
      if (t >= weekAgoMs) weekCount += 1;
      if (t >= monthAgoMs) monthCount += 1;

      if (l.status_key === 'new') newCount += 1;
      if (['contacted', 'contact_attempted', 'interested'].includes(l.status_key)) contactedCount += 1;
      if (l.status_key === 'qualified') qualifiedCount += 1;
      if (l.status_key === 'follow_up_required') followUpCount += 1;
      if (l.is_converted) convertedCount += 1;
      if (l.is_lost) lostCount += 1;

      const sKey = l.status_key || 'unknown';
      const sEntry = statusDistMap.get(sKey) || {
        key: sKey,
        nameAr: l.status_ar || sKey,
        nameEn: l.status_en || sKey,
        color: l.status_color || '#64748B',
        count: 0,
      };
      sEntry.count += 1;
      statusDistMap.set(sKey, sEntry);

      const src = l.source || 'manual';
      sourceMap.set(src, (sourceMap.get(src) || 0) + 1);

      const cmp = l.campaign_name || 'Unattributed';
      const cEntry = campaignMap.get(cmp) || { name: cmp, total: 0, qualified: 0, converted: 0 };
      cEntry.total += 1;
      if (l.status_key === 'qualified' || l.is_converted) cEntry.qualified += 1;
      if (l.is_converted) cEntry.converted += 1;
      campaignMap.set(cmp, cEntry);

      if (l.ad_set_name) {
        const aEntry = adSetMap.get(l.ad_set_name) || { name: l.ad_set_name, campaign: cmp, total: 0, converted: 0 };
        aEntry.total += 1;
        if (l.is_converted) aEntry.converted += 1;
        adSetMap.set(l.ad_set_name, aEntry);
      }

      if (l.ad_name) {
        const adEntry = adMap.get(l.ad_name) || { name: l.ad_name, campaign: cmp, total: 0, converted: 0 };
        adEntry.total += 1;
        if (l.is_converted) adEntry.converted += 1;
        adMap.set(l.ad_name, adEntry);
      }

      if (l.form_name) {
        const fEntry = formMap.get(l.form_name) || { name: l.form_name, total: 0, converted: 0 };
        fEntry.total += 1;
        if (l.is_converted) fEntry.converted += 1;
        formMap.set(l.form_name, fEntry);
      }

      const empName = l.employee_name || 'Unassigned';
      const eEntry = employeeMap.get(empName) || { name: empName, total: 0, contacted: 0, converted: 0 };
      eEntry.total += 1;
      if (l.status_key !== 'new') eEntry.contacted += 1;
      if (l.is_converted) eEntry.converted += 1;
      employeeMap.set(empName, eEntry);
    }

    // Daily acquisition across last 30 days ending at latest lead date or today
    const maxLeadMs = leads.reduce((acc, l) => {
      const t = new Date(l.created_at).getTime();
      return Number.isFinite(t) && t > acc ? t : acc;
    }, now);
    const anchorMs = Math.max(now, maxLeadMs);

    const dailyTrend: Array<{ date: string; count: number; converted: number }> = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(anchorMs - i * 86400_000);
      const dayStr = d.toISOString().slice(0, 10);
      const dayLeads = leads.filter((l) => l.created_at.slice(0, 10) === dayStr);
      dailyTrend.push({
        date: dayStr.slice(5),
        count: dayLeads.length,
        converted: dayLeads.filter((l) => l.is_converted).length,
      });
    }

    // Weekly trend (last 6 weeks)
    const weeklyTrend: Array<{ week: string; count: number }> = [];
    for (let w = 5; w >= 0; w--) {
      const start = now - (w + 1) * 7 * 86400_000;
      const end = now - w * 7 * 86400_000;
      const cnt = leads.filter((l) => {
        const t = new Date(l.created_at).getTime();
        return t >= start && t < end;
      }).length;
      weeklyTrend.push({ week: `W-${w === 0 ? 'Current' : w}`, count: cnt });
    }

    // Monthly trend (last 6 months)
    const monthlyTrend: Array<{ month: string; count: number }> = [];
    for (let m = 5; m >= 0; m--) {
      const d = new Date();
      d.setMonth(d.getMonth() - m);
      const ym = d.toISOString().slice(0, 7);
      monthlyTrend.push({
        month: ym,
        count: leads.filter((l) => l.created_at.startsWith(ym)).length,
      });
    }

    // Upcoming & overdue follow-ups
    const followUpWhere = isEmp
      ? "business_id = ? AND assigned_to_user_id = ? AND status = 'pending'"
      : "business_id = ? AND status = 'pending'";
    const followUpTasks = db
      .prepare(`SELECT * FROM follow_up_tasks WHERE ${followUpWhere} ORDER BY due_at ASC`)
      .all(...scopeParams) as any[];
    const nowIso = new Date().toISOString();
    const overdueFollowUps = followUpTasks.filter((t) => t.due_at < nowIso).length;
    const upcomingFollowUps = followUpTasks.filter((t) => t.due_at >= nowIso).length;

    const total = leads.length;
    const conversionRate = total > 0 ? Number(((convertedCount / total) * 100).toFixed(1)) : 0;

    res.json({
      summary: {
        total,
        new: newCount,
        contacted: contactedCount,
        qualified: qualifiedCount,
        followUp: followUpCount,
        converted: convertedCount,
        lost: lostCount,
        conversionRate,
        today: todayCount,
        thisWeek: weekCount,
        thisMonth: monthCount,
        overdueFollowUps,
        upcomingFollowUps,
      },
      charts: {
        dailyTrend,
        weeklyTrend,
        monthlyTrend,
        statusDistribution: Array.from(statusDistMap.values()),
        bySource: Array.from(sourceMap.entries()).map(([source, count]) => ({ source, count })),
        byCampaign: Array.from(campaignMap.values()).map((c) => ({
          ...c,
          conversionRate: c.total > 0 ? Number(((c.converted / c.total) * 100).toFixed(1)) : 0,
        })),
        byAdSet: Array.from(adSetMap.values()),
        byAd: Array.from(adMap.values()),
        byForm: Array.from(formMap.values()),
        byEmployee: Array.from(employeeMap.values()),
        funnel: [
          { stage: 'Total', count: total },
          { stage: 'Contacted', count: contactedCount + qualifiedCount + followUpCount + convertedCount },
          { stage: 'Qualified', count: qualifiedCount + convertedCount },
          { stage: 'Converted', count: convertedCount },
        ],
      },
      metaInsightsConnected: false,
    });
  });

  // Integrations overview & logs (never leaks encrypted credentials)
  router.get('/businesses/:businessId/integrations', authMiddleware, requireBusinessAccess(db), (req: AuthRequest, res) => {
    const { businessId } = req.params;
    const integrations = db
      .prepare('SELECT id, business_id, provider, status, display_name, config_json, last_sync_at, last_error, updated_at FROM integrations WHERE business_id = ?')
      .all(businessId)
      .map((i: any) => ({ ...i, config: JSON.parse(i.config_json || '{}') }));

    const logs = db
      .prepare('SELECT * FROM sync_logs WHERE business_id = ? ORDER BY started_at DESC LIMIT 30')
      .all(businessId);

    res.json({ integrations, logs });
  });

  // Notifications
  router.get('/businesses/:businessId/notifications', authMiddleware, requireBusinessAccess(db), (req: AuthRequest, res) => {
    const { businessId } = req.params;
    const isEmployee = req.membership?.role === 'employee';
    const rows = isEmployee
      ? db
          .prepare(
            `SELECT * FROM notifications
             WHERE business_id = ? AND (user_id = ? OR (user_id IS NULL AND (link_path NOT LIKE '/leads/%' OR EXISTS (
               SELECT 1 FROM leads l WHERE l.id = REPLACE(link_path, '/leads/', '') AND l.assigned_to_user_id = ?
             ))))
             ORDER BY created_at DESC LIMIT 50`
          )
          .all(businessId, req.authUser!.id, req.authUser!.id)
      : db
          .prepare(
            `SELECT * FROM notifications
             WHERE business_id = ?
             ORDER BY created_at DESC LIMIT 50`
          )
          .all(businessId);
    const unreadCount = rows.filter((r: any) => !r.is_read).length;
    res.json({ notifications: rows, unreadCount });
  });

  router.patch(
    '/businesses/:businessId/notifications/:notifId/read',
    authMiddleware,
    requireBusinessAccess(db),
    (req: AuthRequest, res) => {
      db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND business_id = ?').run(
        req.params.notifId,
        req.params.businessId
      );
      res.json({ updated: true });
    }
  );

  router.post(
    '/businesses/:businessId/notifications/read-all',
    authMiddleware,
    requireBusinessAccess(db),
    (req: AuthRequest, res) => {
      if (req.membership?.role === 'employee') {
        db.prepare('UPDATE notifications SET is_read = 1 WHERE business_id = ? AND (user_id IS NULL OR user_id = ?)').run(
          req.params.businessId,
          req.authUser!.id
        );
      } else {
        db.prepare('UPDATE notifications SET is_read = 1 WHERE business_id = ?').run(req.params.businessId);
      }
      res.json({ updated: true });
    }
  );

  router.post(
    '/businesses/:businessId/notifications/test',
    authMiddleware,
    requireBusinessAccess(db),
    (req: AuthRequest, res) => {
      const { businessId } = req.params;
      const latestLead = db
        .prepare('SELECT id, full_name, lead_code, interested_service FROM leads WHERE business_id = ? ORDER BY created_at DESC LIMIT 1')
        .get(businessId) as { id: string; full_name: string; lead_code: string; interested_service: string | null } | undefined;

      const notification = createAndBroadcastNotification(db, {
        businessId,
        userId: req.membership?.role === 'employee' ? req.authUser!.id : null,
        type: 'test_notification',
        titleAr: latestLead ? `إشعار تجريبي: ${latestLead.full_name}` : 'إشعار تجريبي من LeadFlow',
        titleEn: latestLead ? `Test Notification: ${latestLead.full_name}` : 'Test Notification from LeadFlow',
        messageAr: latestLead
          ? `اضغط لفتح ملف العميل ${latestLead.lead_code}${latestLead.interested_service ? ` · ${latestLead.interested_service}` : ''}`
          : 'نظام الإشعارات الفوري يعمل بنجاح',
        messageEn: latestLead
          ? `Click to open lead ${latestLead.lead_code}${latestLead.interested_service ? ` · ${latestLead.interested_service}` : ''}`
          : 'Real-time notifications are working',
        linkPath: latestLead ? `/leads/${latestLead.id}` : '/leads',
        leadId: latestLead?.id || null,
      });

      res.json({ notification });
    }
  );

  // Audit logs & Data backup export
  router.get(
    '/businesses/:businessId/audit-logs',
    authMiddleware,
    requireBusinessAccess(db, ['super_admin', 'business_admin']),
    (req: AuthRequest, res) => {
      const logs = db
        .prepare(`
          SELECT al.*, u.full_name as actor_name, u.email as actor_email
          FROM audit_logs al
          LEFT JOIN users u ON u.id = al.actor_user_id
          WHERE al.business_id = ?
          ORDER BY al.created_at DESC
          LIMIT 100
        `)
        .all(req.params.businessId);
      res.json({ logs });
    }
  );

  router.get(
    '/businesses/:businessId/backup',
    authMiddleware,
    requireBusinessAccess(db, ['super_admin', 'business_admin']),
    (req: AuthRequest, res) => {
      const { businessId } = req.params;
      const business = db.prepare('SELECT * FROM businesses WHERE id = ?').get(businessId);
      const stages = db.prepare('SELECT * FROM lead_statuses WHERE business_id = ?').all(businessId);
      const customFields = db.prepare('SELECT * FROM lead_custom_fields WHERE business_id = ?').all(businessId);
      const leads = db.prepare('SELECT * FROM leads WHERE business_id = ?').all(businessId);
      const followUps = db.prepare('SELECT * FROM follow_up_tasks WHERE business_id = ?').all(businessId);
      const notes = db.prepare('SELECT * FROM lead_notes WHERE business_id = ?').all(businessId);

      res.setHeader('Content-Disposition', `attachment; filename="leadflow-backup-${businessId.slice(0, 8)}.json"`);
      res.json({
        exportedAt: new Date().toISOString(),
        business,
        stages,
        customFields,
        leads,
        followUps,
        notes,
      });
    }
  );

  return router;
}
