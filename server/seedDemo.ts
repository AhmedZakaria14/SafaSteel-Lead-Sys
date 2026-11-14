import crypto from 'node:crypto';
import fs from 'node:fs';
import { SqlDb, createDefaultStagesForBusiness } from './db.ts';
import { MASTER_OWNER_EMAIL } from './auth.ts';
import {
  ALSAFA_WORKSPACE_ID,
  ATTACHED_SHEET_PATH,
  syncAttachedSheetToWorkspace,
} from './services/sheetSyncService.ts';

const LEGACY_FAKE_BIZ_IDS = ['demo-biz-atlas', 'demo-biz-careline', 'demo-biz-horizon'];
const LEGACY_DEMO_USER_EMAILS = [
  'admin@alsafasteel.local',
  'sales1@alsafasteel.local',
  'sales2@alsafasteel.local',
];

const SYSTEM_ACCOUNTS = [
  {
    id: 'alsafa-owner-manager',
    email: MASTER_OWNER_EMAIL,
    full_name: 'حساب المدير (المالك الرئيسي) | Manager (Owner)',
    account_slot: 'manager' as const,
    role: 'business_admin' as const,
    is_platform_super_admin: 1,
  },
  {
    id: 'alsafa-accountant',
    email: 'accountant@alsafasteel.local',
    full_name: 'حساب المحاسب (صلاحية كاملة) | Accountant (Full Access)',
    account_slot: 'accountant' as const,
    role: 'business_admin' as const,
    is_platform_super_admin: 0,
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
    const existingByEmail = db
      .prepare('SELECT id, firebase_uid FROM users WHERE LOWER(email) = ?')
      .get(acct.email.toLowerCase()) as { id: string; firebase_uid: string | null } | undefined;

    let userId = existingByEmail?.id || acct.id;
    if (!existingByEmail) {
      const existingById = db.prepare('SELECT id FROM users WHERE id = ?').get(acct.id);
      if (!existingById) {
        db.prepare(`
          INSERT INTO users (id, firebase_uid, email, full_name, default_language, theme, is_platform_super_admin, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'ar', 'light', ?, ?, ?)
        `).run(userId, `seed-uid-${acct.id}`, acct.email, acct.full_name, acct.is_platform_super_admin, now, now);
      }
    } else if (acct.is_platform_super_admin === 1) {
      db.prepare('UPDATE users SET is_platform_super_admin = 1, updated_at = ? WHERE id = ?').run(now, userId);
    }

    const existingMembership = db
      .prepare('SELECT id, user_id, role, status, account_slot FROM business_memberships WHERE business_id = ? AND LOWER(invited_email) = ?')
      .get(ALSAFA_WORKSPACE_ID, acct.email.toLowerCase()) as any;

    if (!existingMembership) {
      // Only seed the default placeholder accountant if no custom accountant account already exists in account_slot = 'accountant'
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
    } else if (acct.email === MASTER_OWNER_EMAIL) {
      db.prepare(`
        UPDATE business_memberships
        SET user_id = COALESCE(user_id, ?), account_slot = 'manager', role = 'business_admin', status = 'active', updated_at = ?
        WHERE id = ?
      `).run(userId, now, existingMembership.id);
    }
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
    // Ensure any newly appended rows in the attached sheet are synced on startup
    if (fs.existsSync(ATTACHED_SHEET_PATH)) {
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
      attachedSheetName: 'الصفا ستيل غرابيل وحوامل كابلات',
      spreadsheetName: 'الصفا ستيل غرابيل وحوامل كابلات',
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
  }
}
