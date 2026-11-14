import crypto from 'node:crypto';
import fs from 'node:fs';
import { SqlDb, createDefaultStagesForBusiness } from './db.ts';
import {
  ALSAFA_WORKSPACE_ID,
  ATTACHED_SHEET_PATH,
  syncAttachedSheetToWorkspace,
} from './services/sheetSyncService.ts';

const LEGACY_FAKE_BIZ_IDS = ['demo-biz-atlas', 'demo-biz-careline', 'demo-biz-horizon'];

const WORKSPACE_USERS = [
  { id: 'demo-user-admin', email: 'admin@alsafasteel.local', full_name: 'إدارة الصفا ستيل / Al-Safa Admin' },
  { id: 'demo-user-sales1', email: 'sales1@alsafasteel.local', full_name: 'فريق المبيعات 1 / Sales Rep 1' },
  { id: 'demo-user-sales2', email: 'sales2@alsafasteel.local', full_name: 'فريق المبيعات 2 / Sales Rep 2' },
];

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

  const upsertUser = db.prepare(`
    INSERT INTO users (id, firebase_uid, email, full_name, default_language, theme, is_platform_super_admin, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'ar', 'light', 0, ?, ?)
    ON CONFLICT(id) DO UPDATE SET full_name = excluded.full_name, updated_at = excluded.updated_at
  `);
  for (const u of WORKSPACE_USERS) {
    upsertUser.run(u.id, `demo-uid-${u.id}`, u.email, u.full_name, now, now);
  }

  db.prepare(`
    INSERT INTO businesses (id, name, industry, logo_url, phone, email, website, timezone, default_country_code, is_demo, round_robin_enabled, round_robin_index, created_by, created_at, updated_at)
    VALUES (?, ?, ?, NULL, NULL, NULL, NULL, 'Africa/Cairo', '+20', 1, 0, 0, 'demo-user-admin', ?, ?)
  `).run(
    ALSAFA_WORKSPACE_ID,
    'الصفا ستيل | Al-Safa Steel',
    'حوامل الكابلات وتخريم الصاج (الغرابيل) | Cable Trays & Perforated Sheets',
    now,
    now
  );

  createDefaultStagesForBusiness(db, ALSAFA_WORKSPACE_ID);

  // Team memberships
  const insertMember = db.prepare(`
    INSERT INTO business_memberships (id, business_id, user_id, invited_email, display_name, role, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
  `);
  insertMember.run(
    crypto.randomUUID(),
    ALSAFA_WORKSPACE_ID,
    'demo-user-admin',
    'admin@alsafasteel.local',
    'إدارة الصفا ستيل / Al-Safa Admin',
    'business_admin',
    now,
    now
  );
  insertMember.run(
    crypto.randomUUID(),
    ALSAFA_WORKSPACE_ID,
    'demo-user-sales1',
    'sales1@alsafasteel.local',
    'فريق المبيعات 1 / Sales Rep 1',
    'manager',
    now,
    now
  );
  insertMember.run(
    crypto.randomUUID(),
    ALSAFA_WORKSPACE_ID,
    'demo-user-sales2',
    'sales2@alsafasteel.local',
    'فريق المبيعات 2 / Sales Rep 2',
    'employee',
    now,
    now
  );

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
