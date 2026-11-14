import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
// @ts-ignore - subpath export without bundled .d.ts
import sqlJsModule from 'sql.js/dist/sql-wasm-inline.js';

export interface SqlRunResult {
  changes: number | bigint;
  lastInsertRowid: number | bigint;
}

export interface SqlStatement {
  run(...params: unknown[]): SqlRunResult;
  get(...params: unknown[]): any;
  all(...params: unknown[]): any[];
}

export interface SqlDb {
  exec(sql: string): void;
  prepare(sql: string): SqlStatement;
}

let singletonDb: SqlDb | null = null;
let cachedSqlJs: any = null;
let sqlJsLoadPromise: Promise<any> | null = null;

function normalizeBindParams(params: unknown[]): Array<string | number | Uint8Array | null> {
  return params.map((p) => {
    if (p === undefined || p === null) return null;
    if (typeof p === 'boolean') return p ? 1 : 0;
    if (typeof p === 'bigint') return Number(p);
    if (p instanceof Uint8Array) return p;
    if (typeof p === 'number' || typeof p === 'string') return p;
    return String(p);
  });
}

class SqlJsCompatDb implements SqlDb {
  private rawDb: any;
  private filePath: string;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(SQL: any, filePath: string) {
    this.filePath = filePath;
    if (filePath !== ':memory:' && fs.existsSync(filePath)) {
      try {
        const bytes = fs.readFileSync(filePath);
        this.rawDb = new SQL.Database(new Uint8Array(bytes));
      } catch {
        this.rawDb = new SQL.Database();
      }
    } else {
      this.rawDb = new SQL.Database();
    }
  }

  private schedulePersist() {
    if (this.filePath === ':memory:') return;
    if (this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      try {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        const exported = this.rawDb.export();
        fs.writeFileSync(this.filePath, Buffer.from(exported));
      } catch {
        // Ignore non-writable filesystem errors in serverless ephemeral containers
      }
    }, 25);
    if (typeof (this.persistTimer as any).unref === 'function') {
      (this.persistTimer as any).unref();
    }
  }

  exec(sql: string): void {
    this.rawDb.exec(sql);
    if (!/^\s*(BEGIN|ROLLBACK|PRAGMA|SELECT)/i.test(sql)) {
      this.schedulePersist();
    }
  }

  prepare(sql: string): SqlStatement {
    const rawDb = this.rawDb;
    const schedulePersist = () => this.schedulePersist();

    return {
      run(...params: unknown[]): SqlRunResult {
        const stmt = rawDb.prepare(sql);
        try {
          const normalized = normalizeBindParams(params);
          if (normalized.length > 0) stmt.bind(normalized);
          stmt.step();
          schedulePersist();
          return {
            changes: typeof rawDb.getRowsModified === 'function' ? rawDb.getRowsModified() : 0,
            lastInsertRowid: 0,
          };
        } finally {
          stmt.free();
        }
      },
      get(...params: unknown[]): any {
        const stmt = rawDb.prepare(sql);
        try {
          const normalized = normalizeBindParams(params);
          if (normalized.length > 0) stmt.bind(normalized);
          if (stmt.step()) {
            return stmt.getAsObject();
          }
          return undefined;
        } finally {
          stmt.free();
        }
      },
      all(...params: unknown[]): any[] {
        const stmt = rawDb.prepare(sql);
        const rows: any[] = [];
        try {
          const normalized = normalizeBindParams(params);
          if (normalized.length > 0) stmt.bind(normalized);
          while (stmt.step()) {
            rows.push(stmt.getAsObject());
          }
          return rows;
        } finally {
          stmt.free();
        }
      },
    };
  }
}

function tryLoadNativeSqlite(): (new (dbPath: string) => SqlDb) | null {
  try {
    const getBuiltin = (process as any).getBuiltinModule;
    if (typeof getBuiltin !== 'function') return null;
    const mod = getBuiltin.call(process, 'node:sqlite');
    return mod?.DatabaseSync || null;
  } catch {
    return null;
  }
}

export async function ensureDbReady(): Promise<void> {
  if (cachedSqlJs) return;
  if (!sqlJsLoadPromise) {
    sqlJsLoadPromise = (async () => {
      const initSqlJs = (sqlJsModule as any)?.default || sqlJsModule;
      cachedSqlJs = await initSqlJs();
      return cachedSqlJs;
    })();
  }
  await sqlJsLoadPromise;
}

export function createDatabase(dbPath?: string, forceDriver?: 'native' | 'sqljs'): SqlDb {
  const defaultDir = process.env.VERCEL ? '/tmp' : path.join(process.cwd(), '.data');
  const resolvedPath =
    dbPath || process.env.DATABASE_PATH || path.join(defaultDir, 'leadflow.db');

  if (resolvedPath !== ':memory:') {
    try {
      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch {
      // Fallback safely if directory creation fails
    }
  }

  if (forceDriver !== 'sqljs' && !process.env.VERCEL) {
    const NativeDatabaseSync = tryLoadNativeSqlite();
    if (NativeDatabaseSync) {
      try {
        const db = new NativeDatabaseSync(resolvedPath);
        db.exec('PRAGMA foreign_keys = ON;');
        if (resolvedPath !== ':memory:') {
          db.exec('PRAGMA journal_mode = WAL;');
        }
        initSchema(db);
        return db;
      } catch {
        // Fall through to sql.js if native node:sqlite is unavailable or missing flag
      }
    }
  }

  if (!cachedSqlJs) {
    throw new Error('SQL.js engine not initialized. Call await ensureDbReady() before createDatabase/getDb.');
  }

  const db = new SqlJsCompatDb(cachedSqlJs, resolvedPath);
  db.exec('PRAGMA foreign_keys = ON;');
  initSchema(db);
  return db;
}

export function getDb(): SqlDb {
  if (!singletonDb) {
    singletonDb = createDatabase();
  }
  return singletonDb;
}

function initSchema(db: SqlDb) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      firebase_uid TEXT UNIQUE,
      username TEXT UNIQUE,
      password_hash TEXT,
      email TEXT NOT NULL UNIQUE,
      full_name TEXT NOT NULL,
      avatar_url TEXT,
      default_language TEXT NOT NULL DEFAULT 'ar',
      theme TEXT NOT NULL DEFAULT 'light',
      is_platform_super_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS businesses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      industry TEXT NOT NULL DEFAULT 'General',
      logo_url TEXT,
      phone TEXT,
      email TEXT,
      website TEXT,
      timezone TEXT NOT NULL DEFAULT 'Asia/Riyadh',
      default_country_code TEXT NOT NULL DEFAULT '+966',
      is_demo INTEGER NOT NULL DEFAULT 0,
      round_robin_enabled INTEGER NOT NULL DEFAULT 0,
      round_robin_index INTEGER NOT NULL DEFAULT 0,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS business_memberships (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      invited_email TEXT NOT NULL,
      display_name TEXT,
      account_slot TEXT NOT NULL DEFAULT 'accountant' CHECK (account_slot IN ('manager', 'accountant')),
      role TEXT NOT NULL CHECK (role IN ('super_admin', 'business_admin', 'manager', 'employee')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'invited', 'inactive')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (business_id, invited_email)
    );

    CREATE TABLE IF NOT EXISTS lead_statuses (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      name_ar TEXT NOT NULL,
      name_en TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#2563EB',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_default INTEGER NOT NULL DEFAULT 0,
      is_converted INTEGER NOT NULL DEFAULT 0,
      is_lost INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE (business_id, key)
    );

    CREATE TABLE IF NOT EXISTS lead_custom_fields (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      field_key TEXT NOT NULL,
      label_ar TEXT NOT NULL,
      label_en TEXT NOT NULL,
      field_type TEXT NOT NULL CHECK (field_type IN ('text', 'number', 'phone', 'email', 'date', 'dropdown', 'checkbox', 'multi_choice', 'long_text')),
      options_json TEXT NOT NULL DEFAULT '[]',
      is_required INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      UNIQUE (business_id, field_key)
    );

    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      lead_code TEXT NOT NULL,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      full_name TEXT NOT NULL,
      phone TEXT,
      phone_e164 TEXT,
      email TEXT,
      interested_service TEXT,
      source TEXT NOT NULL DEFAULT 'manual',
      status_id TEXT REFERENCES lead_statuses(id) ON DELETE SET NULL,
      assigned_to_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      campaign_id TEXT,
      campaign_name TEXT,
      ad_set_id TEXT,
      ad_set_name TEXT,
      ad_id TEXT,
      ad_name TEXT,
      form_id TEXT,
      form_name TEXT,
      page_id TEXT,
      meta_leadgen_id TEXT,
      external_row_id TEXT,
      original_answers_json TEXT NOT NULL DEFAULT '{}',
      custom_values_json TEXT NOT NULL DEFAULT '{}',
      notes_summary TEXT,
      last_contact_at TEXT,
      next_follow_up_at TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      read_at TEXT,
      read_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      is_demo INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_meta_dedup
      ON leads(business_id, meta_leadgen_id)
      WHERE meta_leadgen_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_leads_sheet_row
      ON leads(business_id, external_row_id)
      WHERE external_row_id IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_leads_biz_created ON leads(business_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_leads_biz_status ON leads(business_id, status_id);
    CREATE INDEX IF NOT EXISTS idx_leads_biz_assigned ON leads(business_id, assigned_to_user_id);
    CREATE INDEX IF NOT EXISTS idx_leads_biz_read ON leads(business_id, is_read);

    CREATE TABLE IF NOT EXISTS lead_status_history (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      from_status_id TEXT REFERENCES lead_statuses(id) ON DELETE SET NULL,
      to_status_id TEXT REFERENCES lead_statuses(id) ON DELETE SET NULL,
      changed_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      note TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lead_notes (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      author_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lead_activities (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      activity_type TEXT NOT NULL,
      description_ar TEXT NOT NULL,
      description_en TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS follow_up_tasks (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      lead_id TEXT NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      assigned_to_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      created_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      notes TEXT,
      due_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
      completed_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      provider TEXT NOT NULL CHECK (provider IN ('meta', 'google_sheets', 'google_docs')),
      status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('disconnected', 'connected', 'error', 'pending_config')),
      display_name TEXT,
      config_json TEXT NOT NULL DEFAULT '{}',
      last_sync_at TEXT,
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (business_id, provider)
    );

    CREATE TABLE IF NOT EXISTS integration_credentials (
      id TEXT PRIMARY KEY,
      integration_id TEXT NOT NULL UNIQUE REFERENCES integrations(id) ON DELETE CASCADE,
      encrypted_payload TEXT NOT NULL,
      expires_at TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sync_logs (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
      direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound', 'bidirectional')),
      mode TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('success', 'partial', 'failed')),
      processed_count INTEGER NOT NULL DEFAULT 0,
      created_count INTEGER NOT NULL DEFAULT 0,
      updated_count INTEGER NOT NULL DEFAULT 0,
      skipped_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      details_json TEXT NOT NULL DEFAULT '{}',
      started_at TEXT NOT NULL,
      finished_at TEXT
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title_ar TEXT NOT NULL,
      title_en TEXT NOT NULL,
      message_ar TEXT NOT NULL,
      message_en TEXT NOT NULL,
      link_path TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      business_id TEXT REFERENCES businesses(id) ON DELETE CASCADE,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      details_json TEXT NOT NULL DEFAULT '{}',
      ip_address TEXT,
      created_at TEXT NOT NULL
    );
  `);

  const userCols = db.prepare('PRAGMA table_info(users)').all() as Array<{ name: string }>;
  if (!userCols.some((c) => c.name === 'username')) {
    db.exec('ALTER TABLE users ADD COLUMN username TEXT;');
  }
  if (!userCols.some((c) => c.name === 'password_hash')) {
    db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT;');
  }
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users(LOWER(username)) WHERE username IS NOT NULL;');

  const memberCols = db.prepare('PRAGMA table_info(business_memberships)').all() as Array<{ name: string }>;
  if (!memberCols.some((c) => c.name === 'account_slot')) {
    db.exec("ALTER TABLE business_memberships ADD COLUMN account_slot TEXT NOT NULL DEFAULT 'accountant';");
  }

  const leadCols = db.prepare('PRAGMA table_info(leads)').all() as Array<{ name: string }>;
  const hadIsRead = leadCols.some((c) => c.name === 'is_read');
  if (!hadIsRead) {
    db.exec('ALTER TABLE leads ADD COLUMN is_read INTEGER NOT NULL DEFAULT 0;');
  }
  if (!leadCols.some((c) => c.name === 'read_at')) {
    db.exec('ALTER TABLE leads ADD COLUMN read_at TEXT;');
  }
  if (!leadCols.some((c) => c.name === 'read_by_user_id')) {
    db.exec('ALTER TABLE leads ADD COLUMN read_by_user_id TEXT;');
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_leads_biz_read ON leads(business_id, is_read);');

  if (!hadIsRead) {
    // One-time backfill for pre-existing DBs: mark older/already-handled leads as read (green),
    // keeping only the newest <= 24h uncontacted batch as unread (red).
    const nowIso = new Date().toISOString();
    const businesses = db.prepare('SELECT id FROM businesses').all() as Array<{ id: string }>;
    for (const biz of businesses) {
      const maxRow = db
        .prepare('SELECT MAX(created_at) as maxCreated FROM leads WHERE business_id = ?')
        .get(biz.id) as { maxCreated: string | null } | undefined;
      if (!maxRow?.maxCreated) continue;

      const maxMs = Date.parse(maxRow.maxCreated);
      const cutoffMs = Number.isFinite(maxMs) ? maxMs - 24 * 3600_000 : Date.now() - 24 * 3600_000;
      const defaultStage = db
        .prepare("SELECT id FROM lead_statuses WHERE business_id = ? AND (is_default = 1 OR key = 'new') ORDER BY is_default DESC LIMIT 1")
        .get(biz.id) as { id: string } | undefined;

      const existingRows = db
        .prepare('SELECT id, created_at, status_id, last_contact_at, updated_at FROM leads WHERE business_id = ?')
        .all(biz.id) as Array<{
        id: string;
        created_at: string;
        status_id: string | null;
        last_contact_at: string | null;
        updated_at: string;
      }>;

      const markReadStmt = db.prepare('UPDATE leads SET is_read = 1, read_at = ? WHERE id = ?');
      db.exec('BEGIN');
      try {
        for (const r of existingRows) {
          const createdMs = Date.parse(r.created_at);
          const alreadyHandled =
            Boolean(r.last_contact_at) ||
            (defaultStage?.id && r.status_id && r.status_id !== defaultStage.id) ||
            (Number.isFinite(createdMs) && createdMs < cutoffMs);
          if (alreadyHandled) {
            markReadStmt.run(r.last_contact_at || r.updated_at || nowIso, r.id);
          }
        }
        db.exec('COMMIT');
      } catch {
        db.exec('ROLLBACK');
      }
    }
  }
}

export const DEFAULT_PIPELINE_STAGES = [
  { key: 'new', name_ar: 'جديد', name_en: 'New', color: '#2563EB', sort_order: 1, is_default: 1, is_converted: 0, is_lost: 0 },
  { key: 'contact_attempted', name_ar: 'محاولة تواصل', name_en: 'Contact Attempted', color: '#6366F1', sort_order: 2, is_default: 0, is_converted: 0, is_lost: 0 },
  { key: 'contacted', name_ar: 'تم التواصل', name_en: 'Contacted', color: '#0EA5E9', sort_order: 3, is_default: 0, is_converted: 0, is_lost: 0 },
  { key: 'interested', name_ar: 'مهتم', name_en: 'Interested', color: '#8B5CF6', sort_order: 4, is_default: 0, is_converted: 0, is_lost: 0 },
  { key: 'follow_up_required', name_ar: 'بحاجة لمتابعة', name_en: 'Follow-up Required', color: '#D97706', sort_order: 5, is_default: 0, is_converted: 0, is_lost: 0 },
  { key: 'qualified', name_ar: 'مؤهل', name_en: 'Qualified', color: '#0D9488', sort_order: 6, is_default: 0, is_converted: 0, is_lost: 0 },
  { key: 'converted', name_ar: 'تم التحويل', name_en: 'Converted', color: '#059669', sort_order: 7, is_default: 0, is_converted: 1, is_lost: 0 },
  { key: 'lost', name_ar: 'مفقود', name_en: 'Lost', color: '#DC2626', sort_order: 8, is_default: 0, is_converted: 0, is_lost: 1 },
];

export function createDefaultStagesForBusiness(db: SqlDb, businessId: string) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO lead_statuses (id, business_id, key, name_ar, name_en, color, sort_order, is_default, is_converted, is_lost, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const s of DEFAULT_PIPELINE_STAGES) {
    stmt.run(
      crypto.randomUUID(),
      businessId,
      s.key,
      s.name_ar,
      s.name_en,
      s.color,
      s.sort_order,
      s.is_default,
      s.is_converted,
      s.is_lost,
      now
    );
  }
}

export function normalizePhoneE164(phone?: string | null, defaultCountryCode = '+966'): string {
  if (!phone) return '';
  const trimmed = phone.trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('+')) {
    return '+' + trimmed.slice(1).replace(/\D/g, '');
  }
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('00')) {
    return '+' + digits.slice(2);
  }
  const cc = defaultCountryCode.replace(/\D/g, '') || '966';
  if (digits.startsWith('0')) {
    return '+' + cc + digits.slice(1);
  }
  if (digits.startsWith(cc)) {
    return '+' + digits;
  }
  return '+' + cc + digits;
}

export function generateLeadCode(businessId: string, db: SqlDb): string {
  const row = db.prepare('SELECT COUNT(*) as cnt FROM leads WHERE business_id = ?').get(businessId) as { cnt: number };
  const num = (row?.cnt || 0) + 1001;
  return `LD-${num}`;
}
