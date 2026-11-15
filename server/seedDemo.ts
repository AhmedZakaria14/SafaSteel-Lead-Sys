import crypto from 'node:crypto';
import fs from 'node:fs';
import { SqlDb, createDefaultStagesForBusiness } from './db.ts';
import {
  DEFAULT_ADMIN_USERNAME,
  MASTER_OWNER_EMAIL,
  hashPassword,
  syncSystemAccountsToFirestore,
} from './auth.ts';
import {
  ALSAFA_WORKSPACE_ID,
  ATTACHED_SHEET_PATH,
  DEFAULT_ALSAFA_CSV_URL,
  DEFAULT_ALSAFA_SHEET_URL,
  DEFAULT_ALSAFA_SPREADSHEET_ID,
  syncAttachedSheetToWorkspace,
} from './services/sheetSyncService.ts';

const LEGACY_FAKE_BIZ_IDS = ['demo-biz-atlas', 'demo-biz-careline', 'demo-biz-horizon'];
const LEGACY_DEMO_USER_EMAILS = [
  'admin@alsafasteel.local',
  'sales1@alsafasteel.local',
  'sales2@alsafasteel.local',
];

const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_DEFAULT_PASSWORD || 'SafaSteels2026';

const SYSTEM_ACCOUNTS = [
  {
    id: 'alsafa-owner-manager',
    username: DEFAULT_ADMIN_USERNAME,
    email: MASTER_OWNER_EMAIL,
    full_name: 'حساب المدير (المالك الرئيسي) | Manager (Owner)',
    account_slot: 'manager' as const,
    role: 'business_admin' as const,
    is_platform_super_admin: 1,
    defaultPassword: DEFAULT_ADMIN_PASSWORD,
  },
  {
    id: 'alsafa-accountant',
    username: 'accountant',
    email: 'accountant@alsafasteel.local',
    full_name: 'حساب المحاسب (صلاحية كاملة) | Accountant (Full Access)',
    account_slot: 'accountant' as const,
    role: 'business_admin' as const,
    is_platform_super_admin: 0,
    defaultPassword: DEFAULT_ADMIN_PASSWORD,
  },
];

function ensureTwoSystemAccounts(db: SqlDb) {
  const now = new Date().toISOString();

  // Remove legacy 3-tier demo accounts from Al-Safa Steel if present in an older SQLite file
  for (const legacyEmail of LEGACY_DEMO_USER_EMAILS) {
    db.prepare('DELETE FROM business_memberships WHERE business_id = ? AND LOWER(invited_email) = ?').run(
      ALSAFA_WORKSPACE_ID,
      legacyEmail
    );
  }

  for (const acct of SYSTEM_ACCOUNTS) {
    const existingByUsername = db
      .prepare('SELECT id, firebase_uid, password_hash, username FROM users WHERE LOWER(username) = ?')
      .get(acct.username.toLowerCase()) as
      | { id: string; firebase_uid: string | null; password_hash: string | null; username: string | null }
      | undefined;

    const existingByEmail = !existingByUsername
      ? (db
          .prepare('SELECT id, firebase_uid, password_hash, username FROM users WHERE LOWER(email) = ?')
          .get(acct.email.toLowerCase()) as
          | { id: string; firebase_uid: string | null; password_hash: string | null; username: string | null }
          | undefined)
      : undefined;

    const existingById = !existingByUsername && !existingByEmail
      ? (db
          .prepare('SELECT id, firebase_uid, password_hash, username FROM users WHERE id = ?')
          .get(acct.id) as
          | { id: string; firebase_uid: string | null; password_hash: string | null; username: string | null }
          | undefined)
      : undefined;

    const existingUser = existingByUsername || existingByEmail || existingById;
    const userId = existingUser?.id || acct.id;

    if (!existingUser) {
      db.prepare(`
        INSERT INTO users (id, firebase_uid, username, password_hash, email, full_name, default_language, theme, is_platform_super_admin, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'ar', 'light', ?, ?, ?)
      `).run(
        userId,
        `seed-uid-${acct.id}`,
        acct.username,
        hashPassword(acct.defaultPassword),
        acct.email,
        acct.full_name,
        acct.is_platform_super_admin,
        now,
        now
      );
    } else {
      const nextPasswordHash =
        existingUser.password_hash && existingUser.password_hash.startsWith('scrypt:')
          ? existingUser.password_hash
          : hashPassword(acct.defaultPassword);
      const nextUsername = existingUser.username || acct.username;
      const superFlag = acct.is_platform_super_admin === 1 ? 1 : undefined;
      db.prepare(`
        UPDATE users
        SET username = ?,
            password_hash = ?,
            is_platform_super_admin = COALESCE(?, is_platform_super_admin),
            updated_at = ?
        WHERE id = ?
      `).run(nextUsername, nextPasswordHash, superFlag ?? null, now, userId);
    }

    const existingMembership = db
      .prepare('SELECT id, user_id, role, status, account_slot FROM business_memberships WHERE business_id = ? AND (user_id = ? OR LOWER(invited_email) = ?)')
      .get(ALSAFA_WORKSPACE_ID, userId, acct.email.toLowerCase()) as any;

    if (!existingMembership) {
      if (acct.account_slot === 'accountant') {
        const hasAnyAccountant = db
          .prepare("SELECT id FROM business_memberships WHERE business_id = ? AND account_slot = 'accountant'")
          .get(ALSAFA_WORKSPACE_ID);
        if (hasAnyAccountant) continue;
      }

      db.prepare(`
        INSERT INTO business_memberships (id, business_id, user_id, invited_email, display_name, account_slot, role, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
      `).run(
        crypto.randomUUID(),
        ALSAFA_WORKSPACE_ID,
        userId,
        acct.email,
        acct.full_name,
        acct.account_slot,
        acct.role,
        now,
        now
      );
    } else if (acct.username === DEFAULT_ADMIN_USERNAME || acct.email === MASTER_OWNER_EMAIL) {
      db.prepare(`
        UPDATE business_memberships
        SET user_id = ?, account_slot = 'manager', role = 'business_admin', status = 'active', updated_at = ?
        WHERE id = ?
      `).run(userId, now, existingMembership.id);
    }
  }

  void syncSystemAccountsToFirestore(db);
}

function ensureAlSafaGoogleSheetsIntegration(db: SqlDb) {
  const now = new Date().toISOString();
  const existing = db
    .prepare("SELECT id, config_json FROM integrations WHERE business_id = ? AND provider = 'google_sheets'")
    .get(ALSAFA_WORKSPACE_ID) as { id: string; config_json: string } | undefined;

  if (!existing) {
    db.prepare(`
      INSERT INTO integrations (id, business_id, provider, status, display_name, config_json, last_sync_at, last_error, created_at, updated_at)
      VALUES (?, ?, 'google_sheets', 'connected', 'الصفا ستيل غرابيل وحوامل كابلات (Live Sheet Sync)', ?, ?, NULL, ?, ?)
    `).run(
      crypto.randomUUID(),
      ALSAFA_WORKSPACE_ID,
      JSON.stringify({
        mode: 'A',
        conflictPolicy: 'sheet_wins',
        autoScheduled: true,
        syncIntervalSec: 15,
        attachedSheetName: 'الصفا ستيل غرابيل وحوامل كابلات',
        spreadsheetName: 'الصفا ستيل غرابيل وحوامل كابلات',
        spreadsheetId: DEFAULT_ALSAFA_SPREADSHEET_ID,
        sheetUrl: DEFAULT_ALSAFA_SHEET_URL,
        publicCsvUrl: DEFAULT_ALSAFA_CSV_URL,
        syncNotes: true,
      }),
      now,
      now,
      now
    );
    return;
  }

  try {
    const prevCfg = JSON.parse(existing.config_json || '{}');
    if (!prevCfg.publicCsvUrl || !prevCfg.spreadsheetId || !prevCfg.sheetUrl) {
      const nextCfg = {
        ...prevCfg,
        mode: prevCfg.mode || 'A',
        conflictPolicy: prevCfg.conflictPolicy || 'sheet_wins',
        autoScheduled: prevCfg.autoScheduled !== false,
        syncIntervalSec: Number(prevCfg.syncIntervalSec || 15),
        attachedSheetName: prevCfg.attachedSheetName || 'الصفا ستيل غرابيل وحوامل كابلات',
        spreadsheetName: prevCfg.spreadsheetName || 'الصفا ستيل غرابيل وحوامل كابلات',
        spreadsheetId: prevCfg.spreadsheetId || DEFAULT_ALSAFA_SPREADSHEET_ID,
        sheetUrl: prevCfg.sheetUrl || DEFAULT_ALSAFA_SHEET_URL,
        publicCsvUrl: prevCfg.publicCsvUrl || DEFAULT_ALSAFA_CSV_URL,
      };
      db.prepare('UPDATE integrations SET status = ?, config_json = ?, updated_at = ? WHERE id = ?').run(
        'connected',
        JSON.stringify(nextCfg),
        now,
        existing.id
      );
    }
  } catch {
    // ignore malformed json
  }
}

export function ensureDemoData(db: SqlDb) {
  // Purge legacy fake businesses if present in an existing persisted DB
  for (const legacyId of LEGACY_FAKE_BIZ_IDS) {
    db.prepare('DELETE FROM businesses WHERE id = ?').run(legacyId);
  }

  const existing = db
    .prepare('SELECT id FROM businesses WHERE id = ?')
    .get(ALSAFA_WORKSPACE_ID) as { id: string } | undefined;

  if (!existing) {
    seedAlSafaWorkspace(db);
  } else {
    ensureTwoSystemAccounts(db);
    ensureAlSafaGoogleSheetsIntegration(db);
    // In test mode only, ensure attached CSV fixture is up to date on startup;
    // production/dev runtime syncs authoritatively from the live Google Sheet.
    if (process.env.NODE_ENV === 'test' && fs.existsSync(ATTACHED_SHEET_PATH)) {
      syncAttachedSheetToWorkspace(db, ALSAFA_WORKSPACE_ID, ATTACHED_SHEET_PATH, {
        emitNotificationOnChanges: false,
      });
    }
  }
}

export function resetDemoData(db: SqlDb) {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM businesses WHERE is_demo = 1').run();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  seedAlSafaWorkspace(db);
}

function seedAlSafaWorkspace(db: SqlDb) {
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO businesses (id, name, industry, logo_url, phone, email, website, timezone, default_country_code, is_demo, round_robin_enabled, round_robin_index, created_by, created_at, updated_at)
    VALUES (?, ?, ?, NULL, NULL, NULL, NULL, 'Africa/Cairo', '+20', 1, 0, 0, NULL, ?, ?)
  `).run(
    ALSAFA_WORKSPACE_ID,
    'الصفا ستيل | Al-Safa Steel',
    'حوامل الكابلات وتخريم الصاج (الغرابيل) | Cable Trays & Perforated Sheets',
    now,
    now
  );

  ensureTwoSystemAccounts(db);
  createDefaultStagesForBusiness(db, ALSAFA_WORKSPACE_ID);

  // Custom fields matching the real sheet columns
  const customFields = [
    { key: 'company_name', ar: 'الشركة / النشاط', en: 'Company Name', type: 'text' },
    { key: 'job_title', ar: 'المسمى الوظيفي', en: 'Job Title', type: 'text' },
    { key: 'quantity_sizes', ar: 'الكمية والمقاسات المطلوبة', en: 'Quantity & Sizes', type: 'long_text' },
    { key: 'product_selection', ar: 'المنتجات المختارة', en: 'Selected Products', type: 'text' },
    { key: 'whatsapp_input', ar: 'رقم الواتساب المدخل', en: 'WhatsApp Number (Form)', type: 'phone' },
    { key: 'platform', ar: 'المنصة', en: 'Platform', type: 'text' },
    { key: 'inbox_url', ar: 'رابط المحادثة (Meta Inbox)', en: 'Meta Inbox URL', type: 'text' },
  ];

  const insertField = db.prepare(`
    INSERT INTO lead_custom_fields (id, business_id, field_key, label_ar, label_en, field_type, options_json, is_required, sort_order, created_at)
    VALUES (?, ?, ?, ?, ?, ?, '[]', 0, ?, ?)
  `);
  customFields.forEach((f, idx) => {
    insertField.run(crypto.randomUUID(), ALSAFA_WORKSPACE_ID, f.key, f.ar, f.en, f.type, idx + 1, now);
  });

  // Integration metadata for the connected live sheet
  const insertIntegration = db.prepare(`
    INSERT INTO integrations (id, business_id, provider, status, display_name, config_json, last_sync_at, last_error, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `);

  insertIntegration.run(
    crypto.randomUUID(),
    ALSAFA_WORKSPACE_ID,
    'google_sheets',
    'connected',
    'الصفا ستيل غرابيل وحوامل كابلات (Live Sheet Sync)',
    JSON.stringify({
      mode: 'A',
      conflictPolicy: 'sheet_wins',
      autoScheduled: true,
      syncIntervalSec: 15,
      attachedSheetName: 'الصفا ستيل غرابيل وحوامل كابلات',
      spreadsheetName: 'الصفا ستيل غرابيل وحوامل كابلات',
      spreadsheetId: DEFAULT_ALSAFA_SPREADSHEET_ID,
      sheetUrl: DEFAULT_ALSAFA_SHEET_URL,
      publicCsvUrl: DEFAULT_ALSAFA_CSV_URL,
      syncNotes: true,
    }),
    now,
    now,
    now
  );

  insertIntegration.run(
    crypto.randomUUID(),
    ALSAFA_WORKSPACE_ID,
    'meta',
    'pending_config',
    'Meta Lead Ads (Webhook / Graph API)',
    JSON.stringify({ note: 'Optional: connect Meta Graph Token for instant webhooks alongside Sheet sync' }),
    null,
    now,
    now
  );

  // Sync real leads from the attached CSV sheet immediately
  if (fs.existsSync(ATTACHED_SHEET_PATH)) {
    syncAttachedSheetToWorkspace(db, ALSAFA_WORKSPACE_ID, ATTACHED_SHEET_PATH, {
      emitNotificationOnChanges: false,
    });

    // Distinguish historical sheet leads as already-read (green) while keeping the newest <= 24h batch unread (red)
    const maxRow = db
      .prepare('SELECT MAX(created_at) as maxCreated FROM leads WHERE business_id = ?')
      .get(ALSAFA_WORKSPACE_ID) as { maxCreated: string | null } | undefined;
    if (maxRow?.maxCreated) {
      const maxMs = Date.parse(maxRow.maxCreated);
      const cutoffMs = Number.isFinite(maxMs) ? maxMs - 24 * 3600_000 : Date.now() - 24 * 3600_000;
      const defaultStage = db
        .prepare("SELECT id FROM lead_statuses WHERE business_id = ? AND (is_default = 1 OR key = 'new') ORDER BY is_default DESC LIMIT 1")
        .get(ALSAFA_WORKSPACE_ID) as { id: string } | undefined;

      const seededRows = db
        .prepare('SELECT id, created_at, status_id FROM leads WHERE business_id = ?')
        .all(ALSAFA_WORKSPACE_ID) as Array<{ id: string; created_at: string; status_id: string | null }>;

      const markReadStmt = db.prepare('UPDATE leads SET is_read = 1, read_at = ? WHERE id = ?');
      db.exec('BEGIN');
      try {
        for (const r of seededRows) {
          const createdMs = Date.parse(r.created_at);
          const isHistorical =
            (defaultStage?.id && r.status_id && r.status_id !== defaultStage.id) ||
            (Number.isFinite(createdMs) && createdMs < cutoffMs);
          if (isHistorical) {
            markReadStmt.run(now, r.id);
          }
        }
        db.exec('COMMIT');
      } catch {
        db.exec('ROLLBACK');
      }
    }
  }
}
