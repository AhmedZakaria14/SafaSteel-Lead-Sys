import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { SqlDb, deterministicSheetLeadId, normalizePhoneE164 } from '../db.ts';
import { addSseClient, removeSseClient, broadcastWorkspaceEvent } from './realtimeService.ts';
import { createAndBroadcastNotification } from './notificationService.ts';

export { addSseClient, removeSseClient, broadcastWorkspaceEvent };

export const ALSAFA_WORKSPACE_ID = 'alsafa-steel-workspace';
export const DEFAULT_ALSAFA_SPREADSHEET_ID = '1usJ6hzbF1DTtSIhhlKOUpxRNPn01MOQWNY_Ler1N2k0';
export const DEFAULT_ALSAFA_SHEET_URL =
  'https://docs.google.com/spreadsheets/d/1usJ6hzbF1DTtSIhhlKOUpxRNPn01MOQWNY_Ler1N2k0/edit?usp=drivesdk';
export const DEFAULT_ALSAFA_CSV_URL =
  'https://docs.google.com/spreadsheets/d/1usJ6hzbF1DTtSIhhlKOUpxRNPn01MOQWNY_Ler1N2k0/export?format=csv&gid=0';

const CANDIDATE_SHEET_PATHS = [
  path.join(process.cwd(), 'public', 'assets', 'aistudio', '________________________________e27d1ae1'),
  path.resolve('public', 'assets', 'aistudio', '________________________________e27d1ae1'),
];
export const ATTACHED_SHEET_PATH =
  CANDIDATE_SHEET_PATHS.find((p) => fs.existsSync(p)) || CANDIDATE_SHEET_PATHS[0];

/**
 * RFC-4180 compliant UTF-8 CSV parser handling multiline quoted fields,
 * escaped quotes (""), and CRLF/LF line endings across all rows without row limits.
 */
export function parseCsvRows(rawContent: string): string[][] {
  const content = rawContent.replace(/^\uFEFF/, '');
  const firstLineEnd = content.indexOf('\n');
  const firstLine = firstLineEnd >= 0 ? content.slice(0, firstLineEnd) : content;
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const delimiter = tabCount > commaCount ? '\t' : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];

    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      if (content[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

export function normalizeArabicDigits(input: string): string {
  return input
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

export function cleanSheetPhone(
  rawPhone?: string | null,
  whatsappFallback?: string | null,
  defaultCountryCode = '+20'
): { displayPhone: string | null; phoneE164: string | null; whatsappClean: string | null } {
  const cleanCandidate = (val?: string | null) => {
    if (!val) return '';
    let s = normalizeArabicDigits(String(val)).trim();
    if (!s || s.includes('<test lead:')) return '';
    s = s.replace(/^p:\s*/i, '').trim();
    return s;
  };

  const primary = cleanCandidate(rawPhone);
  const waRaw = cleanCandidate(whatsappFallback);
  const waDigits = waRaw.replace(/\D/g, '');
  const chosen = primary || (waDigits.length >= 8 ? waRaw : '');

  if (!chosen) {
    return { displayPhone: null, phoneE164: null, whatsappClean: waRaw || null };
  }

  const e164 = normalizePhoneE164(chosen, defaultCountryCode);
  return {
    displayPhone: e164 || chosen,
    phoneE164: e164 || null,
    whatsappClean: waRaw || null,
  };
}

export function formatProductSelection(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed || trimmed.includes('<test lead:')) return null;
  return trimmed
    .split('|')
    .map((part) => part.replace(/_/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' · ');
}

function resolveSheetStatusId(
  rawStatus: string | undefined,
  stages: Array<{ id: string; key: string; name_ar: string; name_en: string; is_default: number }>
): string | null {
  const byKey = new Map(stages.map((s) => [s.key.toLowerCase(), s.id]));
  const normalized = (rawStatus || '').trim().toUpperCase();

  if (normalized === 'CREATED' || normalized === 'NEW') return byKey.get('new') || null;
  if (normalized === 'CONTACT_ATTEMPTED' || normalized === 'ATTEMPTED') return byKey.get('contact_attempted') || null;
  if (normalized === 'CONTACTED') return byKey.get('contacted') || null;
  if (normalized === 'INTERESTED') return byKey.get('interested') || null;
  if (normalized === 'FOLLOW_UP' || normalized === 'FOLLOW_UP_REQUIRED') return byKey.get('follow_up_required') || null;
  if (normalized === 'QUALIFIED') return byKey.get('qualified') || null;
  if (normalized === 'CONVERTED' || normalized === 'WON' || normalized === 'CLOSED_WON') {
    return byKey.get('converted') || null;
  }
  if (normalized === 'LOST' || normalized === 'BAD' || normalized === 'DISQUALIFIED') {
    return byKey.get('lost') || null;
  }

  if (normalized) {
    const lower = normalized.toLowerCase();
    const matched = stages.find(
      (s) =>
        s.key.toLowerCase() === lower ||
        s.name_en.toLowerCase() === lower ||
        s.name_ar.trim() === (rawStatus || '').trim()
    );
    if (matched) return matched.id;
  }

  return stages.find((s) => s.is_default === 1)?.id || stages[0]?.id || null;
}

function mapSourceFromPlatform(platform?: string | null): string {
  const p = (platform || '').trim().toLowerCase();
  if (p === 'ig' || p === 'instagram') return 'instagram_lead_ads';
  if (p === 'fb' || p === 'facebook') return 'facebook_lead_ads';
  if (p === 'an') return 'meta_lead_ads';
  return 'google_sheets';
}

/**
 * Parses `created_time` from Google Sheets (supporting ISO-8601 with timezone offsets,
 * date-only strings like `2026-11-14` or `2026/11/14`, local space-separated datetimes,
 * DD/MM/YYYY with optional AM/PM or ص/م, Google Sheets serial numbers, and Arabic numerals)
 * into a normalized UTC ISO-8601 timestamp for accurate sorting.
 */
export function parseSheetTimestamp(raw?: string | null, defaultOffset = '+02:00'): string {
  if (!raw) return new Date().toISOString();
  const cleaned = normalizeArabicDigits(String(raw)).trim();
  if (!cleaned) return new Date().toISOString();

  // 0. Google Sheets numeric serial date (days since 1899-12-30, e.g., 45000 - 60000)
  if (/^\d{5}(?:\.\d+)?$/.test(cleaned)) {
    const serial = Number(cleaned);
    if (serial >= 35000 && serial <= 70000) {
      const utcMs = Math.round((serial - 25569) * 86400 * 1000);
      const serialDate = new Date(utcMs);
      if (!Number.isNaN(serialDate.getTime())) {
        return serialDate.toISOString();
      }
    }
  }

  // 1. Date-only YYYY-MM-DD or YYYY/MM/DD (e.g. "2026-11-14")
  const ymdOnly = cleaned.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (ymdOnly) {
    const yyyy = ymdOnly[1];
    const mm = ymdOnly[2].padStart(2, '0');
    const dd = ymdOnly[3].padStart(2, '0');
    const parsedDateOnly = new Date(`${yyyy}-${mm}-${dd}T08:00:00${defaultOffset}`);
    if (!Number.isNaN(parsedDateOnly.getTime())) {
      return parsedDateOnly.toISOString();
    }
  }

  // 2. ISO or space-separated YYYY[-/]MM[-/]DD[T ]HH:mm(:ss)? with optional AM/PM or ص/م and no explicit timezone offset
  const noTzIsoMatch = cleaned.match(
    /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})[T\s]+(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:\s*(AM|PM|am|pm|ص|م))?$/
  );
  if (noTzIsoMatch) {
    const yyyy = noTzIsoMatch[1];
    const mo = noTzIsoMatch[2].padStart(2, '0');
    const dd = noTzIsoMatch[3].padStart(2, '0');
    let hhNum = Number(noTzIsoMatch[4]);
    const mi = noTzIsoMatch[5].padStart(2, '0');
    const ss = (noTzIsoMatch[6] || '00').padStart(2, '0');
    const mer = (noTzIsoMatch[7] || '').toUpperCase();
    if ((mer === 'PM' || mer === 'م') && hhNum < 12) hhNum += 12;
    if ((mer === 'AM' || mer === 'ص') && hhNum === 12) hhNum = 0;
    const hh = String(hhNum).padStart(2, '0');
    const withOffset = new Date(`${yyyy}-${mo}-${dd}T${hh}:${mi}:${ss}${defaultOffset}`);
    if (!Number.isNaN(withOffset.getTime())) {
      return withOffset.toISOString();
    }
  }

  // 3. DD/MM/YYYY or D/M/YYYY with optional time and optional AM/PM or ص/م
  const dmyMatch = cleaned.match(
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[T\s,]+(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*(AM|PM|am|pm|ص|م))?)?$/
  );
  if (dmyMatch) {
    const p1 = Number(dmyMatch[1]);
    const p2 = Number(dmyMatch[2]);
    const year = dmyMatch[3];
    // In Egypt/Arab world DD/MM/YYYY is standard unless 2nd part > 12
    const day = String(p2 > 12 ? p2 : p1).padStart(2, '0');
    const month = String(p2 > 12 ? p1 : p2).padStart(2, '0');
    let hhNum = Number(dmyMatch[4] ?? 8);
    const mm = String(dmyMatch[5] ?? '00').padStart(2, '0');
    const ss = String(dmyMatch[6] ?? '00').padStart(2, '0');
    const mer = (dmyMatch[7] || '').toUpperCase();
    if ((mer === 'PM' || mer === 'م') && hhNum < 12) hhNum += 12;
    if ((mer === 'AM' || mer === 'ص') && hhNum === 12) hhNum = 0;
    const hh = String(hhNum).padStart(2, '0');
    const dmyDate = new Date(`${year}-${month}-${day}T${hh}:${mm}:${ss}${defaultOffset}`);
    if (!Number.isNaN(dmyDate.getTime())) {
      return dmyDate.toISOString();
    }
  }

  // 4. Standard ISO-8601 with timezone offset (e.g., 2026-11-14T07:40:00+02:00 or 2026-11-14T18:58:07-05:00)
  const direct = new Date(cleaned);
  if (!Number.isNaN(direct.getTime())) {
    return direct.toISOString();
  }

  return new Date().toISOString();
}

function formatNotificationLeadTime(isoTimestamp: string, locale: 'ar' | 'en'): string {
  try {
    const dt = new Date(isoTimestamp);
    if (Number.isNaN(dt.getTime())) return isoTimestamp;
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Cairo',
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).formatToParts(dt);

    const get = (t: string) => parts.find((p) => p.type === t)?.value || '';
    const yyyy = get('year');
    const mm = get('month');
    const dd = get('day');
    const hh = get('hour');
    const min = get('minute');
    const rawPeriod = get('dayPeriod').toLowerCase();
    const isPm = rawPeriod.includes('p') || rawPeriod.includes('م');
    const periodLabel = locale === 'ar' ? (isPm ? 'م' : 'ص') : isPm ? 'PM' : 'AM';

    return `${yyyy}-${mm}-${dd} · ${hh}:${min} ${periodLabel}`;
  } catch {
    return isoTimestamp;
  }
}

export interface NewSheetLeadSummary {
  id: string;
  sheetLeadId: string;
  leadCode: string;
  fullName: string;
  phone: string | null;
  createdAt: string;
  interestedService: string | null;
  sheetRowNumber: number;
}

export interface SheetSyncResult {
  processedCount: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  totalLeadsInBusiness: number;
  syncedAt: string;
  syncDurationMs: number;
  sourceMode: string;
  newLeads: NewSheetLeadSummary[];
  createdNotifications: any[];
}

export function syncSheetRowsToWorkspace(
  db: SqlDb,
  params: {
    businessId: string;
    rows: string[][];
    sourceLabel?: string;
    conflictPolicy?: 'sheet_wins' | 'crm_wins' | 'newest_wins';
    columnMapping?: Record<string, string>;
    actorUserId?: string | null;
    recordSyncLog?: boolean;
    emitNotificationOnChanges?: boolean;
    integrationProvider?: 'google_sheets' | 'meta';
    syncDurationMs?: number;
  }
): SheetSyncResult {
  const {
    businessId,
    rows,
    sourceLabel = 'attached_sheet',
    conflictPolicy = 'sheet_wins',
    columnMapping = {},
    actorUserId = null,
    recordSyncLog = true,
    emitNotificationOnChanges = true,
    integrationProvider = 'google_sheets',
  } = params;

  const startMs = Date.now();
  const startedAt = new Date().toISOString();
  const biz = db
    .prepare('SELECT id, default_country_code, timezone, is_demo FROM businesses WHERE id = ?')
    .get(businessId) as { id: string; default_country_code: string; timezone?: string; is_demo: number } | undefined;
  if (!biz) {
    throw new Error('Business workspace not found');
  }

  if (!rows || rows.length < 2) {
    return {
      processedCount: 0,
      createdCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      totalLeadsInBusiness: (
        db.prepare('SELECT COUNT(*) as cnt FROM leads WHERE business_id = ?').get(businessId) as { cnt: number }
      ).cnt,
      syncedAt: startedAt,
      syncDurationMs: params.syncDurationMs ?? (Date.now() - startMs),
      sourceMode: sourceLabel,
      newLeads: [],
      createdNotifications: [],
    };
  }

  const headers = rows[0].map((h) => String(h || '').trim());
  const headerIndexMap = new Map<string, number>();
  headers.forEach((h, idx) => {
    if (h) headerIndexMap.set(h, idx);
  });

  const findColIdx = (mappingKey: string, candidates: string[]): number => {
    const mappedCol = columnMapping[mappingKey];
    if (mappedCol && headerIndexMap.has(mappedCol)) {
      return headerIndexMap.get(mappedCol)!;
    }
    for (const c of candidates) {
      if (headerIndexMap.has(c)) return headerIndexMap.get(c)!;
    }
    return -1;
  };

  const idxId = findColIdx('id', ['id', 'crm_external_id', 'lead_id']);
  const idxCreatedTime = findColIdx('created_time', ['created_time', 'created_at', 'date']);
  const idxAdId = findColIdx('ad_id', ['ad_id']);
  const idxAdName = findColIdx('ad_name', ['ad_name']);
  const idxAdSetId = findColIdx('adset_id', ['adset_id', 'ad_set_id']);
  const idxAdSetName = findColIdx('adset_name', ['adset_name', 'ad_set_name']);
  const idxCampaignId = findColIdx('campaign_id', ['campaign_id']);
  const idxCampaignName = findColIdx('campaign_name', ['campaign_name']);
  const idxFormId = findColIdx('form_id', ['form_id']);
  const idxFormName = findColIdx('form_name', ['form_name']);
  const idxIsOrganic = findColIdx('is_organic', ['is_organic']);
  const idxPlatform = findColIdx('platform', ['platform', 'source']);
  const idxProducts = findColIdx('interested_service', ['اختر_المنتجات_المرغوبة', 'interested_service', 'product']);
  const idxQuantity = findColIdx('notes', ['اكتب_الكمية_أو_المقاسات_المطلوبة_إن_وجدت', 'notes', 'quantity']);
  const idxWhatsapp = findColIdx('whatsapp', ['اكتب_رقم_الهاتف/الواتساب_لإرسال_عرض_السعر', 'whatsapp']);
  const idxFullName = findColIdx('full_name', ['full_name', 'name', 'customer_name', 'اسم العميل']);
  const idxEmail = findColIdx('email', ['email', 'البريد الإلكتروني']);
  const idxPhone = findColIdx('phone', ['phone_number', 'phone', 'الهاتف']);
  const idxCompany = findColIdx('company_name', ['company_name', 'company', 'الشركة']);
  const idxJobTitle = findColIdx('job_title', ['job_title', 'المسمى الوظيفي']);
  const idxInboxUrl = findColIdx('inbox_url', ['inbox_url']);
  const idxLeadStatus = findColIdx('status', ['lead_status', 'status', 'الحالة']);

  const stages = db
    .prepare('SELECT id, key, name_ar, name_en, is_default FROM lead_statuses WHERE business_id = ? ORDER BY sort_order ASC')
    .all(businessId) as Array<{ id: string; key: string; name_ar: string; name_en: string; is_default: number }>;

  const existingLeads = db
    .prepare(
      'SELECT id, lead_code, external_row_id, status_id, full_name, phone, email, interested_service, notes_summary, custom_values_json, created_at, updated_at FROM leads WHERE business_id = ?'
    )
    .all(businessId) as Array<{
    id: string;
    lead_code: string;
    external_row_id: string | null;
    status_id: string | null;
    full_name: string;
    phone: string | null;
    email: string | null;
    interested_service: string | null;
    notes_summary: string | null;
    custom_values_json: string;
    created_at: string;
    updated_at: string;
  }>;

  const existingByExtId = new Map<string, (typeof existingLeads)[number]>();
  for (const el of existingLeads) {
    if (el.external_row_id) {
      existingByExtId.set(el.external_row_id.trim(), el);
    }
  }

  // Load Known Lead IDs registry from persistent table
  const knownRows = db
    .prepare('SELECT sheet_lead_id, lead_id, row_hash, notified_at FROM known_sheet_leads WHERE business_id = ?')
    .all(businessId) as Array<{
    sheet_lead_id: string;
    lead_id: string;
    row_hash: string | null;
    notified_at: string | null;
  }>;
  const knownBySheetId = new Map<string, (typeof knownRows)[number]>();
  for (const kr of knownRows) {
    knownBySheetId.set(kr.sheet_lead_id.trim(), kr);
  }

  // Compute monotonic next lead code number
  const maxCodeRow = db
    .prepare("SELECT MAX(CAST(REPLACE(lead_code, 'LD-', '') AS INTEGER)) as maxNum FROM leads WHERE business_id = ? AND lead_code LIKE 'LD-%'")
    .get(businessId) as { maxNum: number | null };
  let nextLeadNum = Math.max(1001, (maxCodeRow?.maxNum || 1000) + 1);

  const insertLeadStmt = db.prepare(`
    INSERT INTO leads (
      id, lead_code, business_id, full_name, phone, phone_e164, email, interested_service,
      source, status_id, assigned_to_user_id, campaign_id, campaign_name, ad_set_id, ad_set_name,
      ad_id, ad_name, form_id, form_name, page_id, meta_leadgen_id, external_row_id,
      original_answers_json, custom_values_json, notes_summary, last_contact_at, next_follow_up_at,
      is_read, is_demo, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, NULL, 0, ?, ?, ?)
  `);

  const insertActivityStmt = db.prepare(`
    INSERT INTO lead_activities (id, business_id, lead_id, actor_user_id, activity_type, description_ar, description_en, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const updateLeadStmt = db.prepare(`
    UPDATE leads
    SET full_name = ?,
        phone = ?,
        phone_e164 = ?,
        email = ?,
        interested_service = ?,
        source = ?,
        status_id = ?,
        campaign_id = ?,
        campaign_name = ?,
        ad_set_id = ?,
        ad_set_name = ?,
        ad_id = ?,
        ad_name = ?,
        form_id = ?,
        form_name = ?,
        original_answers_json = ?,
        custom_values_json = ?,
        notes_summary = COALESCE(NULLIF(?, ''), notes_summary),
        created_at = ?,
        updated_at = ?
    WHERE id = ? AND business_id = ?
  `);

  const upsertKnownStmt = db.prepare(`
    INSERT INTO known_sheet_leads (business_id, sheet_lead_id, lead_id, row_hash, first_seen_at, last_seen_at, notified_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(business_id, sheet_lead_id) DO UPDATE SET
      lead_id = excluded.lead_id,
      row_hash = excluded.row_hash,
      last_seen_at = excluded.last_seen_at,
      notified_at = COALESCE(known_sheet_leads.notified_at, excluded.notified_at)
  `);

  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let processedCount = 0;
  const createdLeadsSummary: NewSheetLeadSummary[] = [];
  const updatedLeadsSummary: Array<{ id: string; fullName: string }> = [];
  const createdNotifications: any[] = [];
  const nowIso = new Date().toISOString();
  const seenInCurrentPass = new Set<string>();

  // Step 1: Parse all rows across the entire sheet (never stopping at blank rows)
  interface ParsedRowCandidate {
    sheetRowNumber: number;
    externalRowId: string;
    rawId: string;
    rawName: string;
    displayPhone: string | null;
    phoneE164: string | null;
    rawEmail: string;
    productLabel: string | null;
    quantitySizes: string;
    source: string;
    mappedStatusId: string | null;
    campaignId: string | null;
    campaignName: string | null;
    adSetId: string | null;
    adSetName: string | null;
    adId: string | null;
    adName: string | null;
    formId: string | null;
    formName: string | null;
    originalAnswers: Record<string, string>;
    customValues: Record<string, unknown>;
    rowFingerprint: string;
    createdAt: string;
    sheetLeadStatus: string;
    platform: string;
  }

  const parsedCandidates: ParsedRowCandidate[] = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    // Never stop on blank rows; simply continue scanning all used rows in the sheet
    if (!row || row.every((c) => !String(c || '').trim() || String(c || '').trim() === '.')) {
      continue;
    }

    const cell = (idx: number) => (idx >= 0 && idx < row.length ? String(row[idx] ?? '').trim() : '');

    const rawId = cell(idxId).replace(/^["']+|["']+$/g, '').trim();
    const rawNameCell = idxFullName >= 0 ? cell(idxFullName) : cell(0);
    const rawEmail = cell(idxEmail);
    const rawPhone = cell(idxPhone);
    const rawWhatsapp = cell(idxWhatsapp);

    // Skip Meta dummy test lead rows or rows without any meaningful identity
    if (
      rawNameCell.includes('<test lead:') ||
      rawId.includes('<test lead:') ||
      rawEmail.toLowerCase() === 'test@meta.com'
    ) {
      skippedCount += 1;
      continue;
    }

    const cleanedName = rawNameCell === '.' ? '' : rawNameCell.trim();
    const hasContactOrId = Boolean(rawId || rawPhone || rawWhatsapp || rawEmail);
    if (!cleanedName && !hasContactOrId) {
      skippedCount += 1;
      continue;
    }

    const rawName = cleanedName || (rawId ? `عميل (${rawId})` : rawPhone || rawEmail);

    const { displayPhone, phoneE164, whatsappClean } = cleanSheetPhone(
      rawPhone,
      rawWhatsapp,
      biz.default_country_code || '+20'
    );

    const externalRowId =
      rawId ||
      crypto
        .createHash('sha1')
        .update(`sheet-row:${rawName.toLowerCase()}:${phoneE164 || rawPhone}:${rawEmail.toLowerCase()}:${cell(idxCreatedTime)}`)
        .digest('hex')
        .slice(0, 20);

    // Deduplicate identical externalRowId within the same sheet read
    if (seenInCurrentPass.has(externalRowId)) {
      skippedCount += 1;
      continue;
    }
    seenInCurrentPass.add(externalRowId);

    processedCount += 1;

    const rawProducts = cell(idxProducts);
    const productLabel = formatProductSelection(rawProducts);
    const quantitySizes = cell(idxQuantity);
    const companyName = cell(idxCompany);
    const jobTitle = cell(idxJobTitle);
    const inboxUrl = cell(idxInboxUrl);
    const platform = cell(idxPlatform);
    const isOrganic = cell(idxIsOrganic);
    const sheetLeadStatus = cell(idxLeadStatus);

    const campaignId = cell(idxCampaignId) || null;
    const campaignName = cell(idxCampaignName) || null;
    const adSetId = cell(idxAdSetId) || null;
    const adSetName = cell(idxAdSetName) || null;
    const adId = cell(idxAdId) || null;
    const adName = cell(idxAdName) || null;
    const formId = cell(idxFormId) || null;
    const formName = cell(idxFormName) || null;

    const originalAnswers: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (h && row[idx] !== undefined && String(row[idx]).trim() !== '') {
        originalAnswers[h] = String(row[idx]).trim();
      }
    });

    const sheetRowNumber = r + 1;
    const createdAt = parseSheetTimestamp(cell(idxCreatedTime), '+02:00');

    const customValues: Record<string, unknown> = {
      product_selection: productLabel || '',
      quantity_sizes: quantitySizes || '',
      whatsapp_input: whatsappClean || '',
      company_name: companyName || '',
      job_title: jobTitle || '',
      inbox_url: inboxUrl || '',
      platform: platform || '',
      is_organic: isOrganic || '',
      sheet_lead_status: sheetLeadStatus || '',
      sheet_row_number: sheetRowNumber,
    };

    const rowFingerprint = crypto
      .createHash('sha1')
      .update(
        JSON.stringify({
          rawName,
          displayPhone,
          rawEmail,
          productLabel,
          quantitySizes,
          companyName,
          jobTitle,
          inboxUrl,
          platform,
          sheetLeadStatus,
          campaignName,
          adSetName,
          adName,
          createdAt,
        })
      )
      .digest('hex')
      .slice(0, 16);

    customValues._sheet_hash = rowFingerprint;

    const source = mapSourceFromPlatform(platform);
    const mappedStatusId = resolveSheetStatusId(sheetLeadStatus, stages);

    parsedCandidates.push({
      sheetRowNumber,
      externalRowId,
      rawId,
      rawName,
      displayPhone,
      phoneE164,
      rawEmail,
      productLabel,
      quantitySizes,
      source,
      mappedStatusId,
      campaignId,
      campaignName,
      adSetId,
      adSetName,
      adId,
      adName,
      formId,
      formName,
      originalAnswers,
      customValues,
      rowFingerprint,
      createdAt,
      sheetLeadStatus,
      platform,
    });
  }

  db.exec('BEGIN');
  try {
    for (const item of parsedCandidates) {
      const existing = existingByExtId.get(item.externalRowId);

      if (!existing) {
        const candidateId = deterministicSheetLeadId(businessId, item.externalRowId);
        const idTaken = db.prepare('SELECT 1 FROM leads WHERE id = ?').get(candidateId);
        const leadId = idTaken ? crypto.randomUUID() : candidateId;
        const leadCode = `LD-${nextLeadNum++}`;
        const metaLeadgenId = item.rawId.startsWith('l:') ? item.rawId : null;

        insertLeadStmt.run(
          leadId,
          leadCode,
          businessId,
          item.rawName,
          item.displayPhone,
          item.phoneE164,
          item.rawEmail || null,
          item.productLabel || (item.quantitySizes ? item.quantitySizes.slice(0, 120) : null),
          item.source,
          item.mappedStatusId,
          item.campaignId,
          item.campaignName,
          item.adSetId,
          item.adSetName,
          item.adId,
          item.adName,
          item.formId,
          item.formName,
          metaLeadgenId,
          item.externalRowId,
          JSON.stringify(item.originalAnswers),
          JSON.stringify(item.customValues),
          item.quantitySizes || null,
          biz.is_demo,
          item.createdAt,
          item.createdAt
        );

        insertActivityStmt.run(
          crypto.randomUUID(),
          businessId,
          leadId,
          actorUserId,
          'sheet_synced',
          `تم استيراد العميل تلقائياً من الشيت (${leadCode}) — صف ${item.sheetRowNumber}`,
          `Auto-synced lead from sheet (${leadCode}) — row ${item.sheetRowNumber}`,
          JSON.stringify({
            externalRowId: item.externalRowId,
            sheetRowNumber: item.sheetRowNumber,
            sourceLabel,
            platform: item.platform,
          }),
          item.createdAt
        );

        const initialNotifiedAt = emitNotificationOnChanges ? null : nowIso;
        upsertKnownStmt.run(
          businessId,
          item.externalRowId,
          leadId,
          item.rowFingerprint,
          nowIso,
          nowIso,
          initialNotifiedAt
        );

        existingByExtId.set(item.externalRowId, {
          id: leadId,
          lead_code: leadCode,
          external_row_id: item.externalRowId,
          status_id: item.mappedStatusId,
          full_name: item.rawName,
          phone: item.displayPhone,
          email: item.rawEmail || null,
          interested_service: item.productLabel,
          notes_summary: item.quantitySizes || null,
          custom_values_json: JSON.stringify(item.customValues),
          created_at: item.createdAt,
          updated_at: item.createdAt,
        });

        createdLeadsSummary.push({
          id: leadId,
          sheetLeadId: item.externalRowId,
          leadCode,
          fullName: item.rawName,
          phone: item.displayPhone || item.phoneE164,
          createdAt: item.createdAt,
          interestedService: item.productLabel || null,
          sheetRowNumber: item.sheetRowNumber,
        });
        createdCount += 1;
      } else {
        // Ensure existing lead is always registered in known_sheet_leads
        upsertKnownStmt.run(
          businessId,
          item.externalRowId,
          existing.id,
          item.rowFingerprint,
          existing.created_at || nowIso,
          nowIso,
          existing.created_at || nowIso
        );

        const prevCustom = JSON.parse(existing.custom_values_json || '{}');
        if (prevCustom._sheet_hash === item.rowFingerprint) {
          skippedCount += 1;
          continue;
        }

        if (conflictPolicy === 'crm_wins') {
          skippedCount += 1;
          continue;
        }

        const sheetStatusChanged =
          Boolean(item.sheetLeadStatus) && prevCustom.sheet_lead_status !== item.sheetLeadStatus;
        const nextStatusId = sheetStatusChanged && item.mappedStatusId ? item.mappedStatusId : existing.status_id;

        const mergedCustom = { ...prevCustom, ...item.customValues };

        updateLeadStmt.run(
          item.rawName,
          item.displayPhone,
          item.phoneE164,
          item.rawEmail || null,
          item.productLabel || existing.interested_service,
          item.source,
          nextStatusId,
          item.campaignId,
          item.campaignName,
          item.adSetId,
          item.adSetName,
          item.adId,
          item.adName,
          item.formId,
          item.formName,
          JSON.stringify(item.originalAnswers),
          JSON.stringify(mergedCustom),
          item.quantitySizes || '',
          item.createdAt || existing.created_at,
          nowIso,
          existing.id,
          businessId
        );

        updatedLeadsSummary.push({ id: existing.id, fullName: item.rawName });
        updatedCount += 1;
      }
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const finishedAt = new Date().toISOString();
  const syncDurationMs = params.syncDurationMs ?? (Date.now() - startMs);
  const totalLeadsInBusiness = (
    db.prepare('SELECT COUNT(*) as cnt FROM leads WHERE business_id = ?').get(businessId) as { cnt: number }
  ).cnt;

  const integ = db
    .prepare('SELECT id FROM integrations WHERE business_id = ? AND provider = ?')
    .get(businessId, integrationProvider) as { id: string } | undefined;

  if (integ) {
    db.prepare('UPDATE integrations SET status = ?, last_sync_at = ?, last_error = NULL, updated_at = ? WHERE id = ?').run(
      'connected',
      finishedAt,
      finishedAt,
      integ.id
    );

    if (recordSyncLog && (createdCount > 0 || updatedCount > 0)) {
      db.prepare(`
        INSERT INTO sync_logs (id, business_id, integration_id, direction, mode, status, processed_count, created_count, updated_count, skipped_count, details_json, started_at, finished_at)
        VALUES (?, ?, ?, 'inbound', ?, 'success', ?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(),
        businessId,
        integ.id,
        sourceLabel,
        processedCount,
        createdCount,
        updatedCount,
        skippedCount,
        JSON.stringify({
          totalLeadsInBusiness,
          syncDurationMs,
          newLeadIds: createdLeadsSummary.map((l) => l.sheetLeadId),
        }),
        startedAt,
        finishedAt
      );
    }
  }

  // Emit exactly one notification per new Lead ID (never duplicating across restarts/polls)
  if (emitNotificationOnChanges && createdLeadsSummary.length > 0) {
    const checkExistingNotifStmt = db.prepare(
      "SELECT id FROM notifications WHERE business_id = ? AND type = 'new_lead' AND link_path = ? LIMIT 1"
    );
    const markNotifiedStmt = db.prepare(
      'UPDATE known_sheet_leads SET notified_at = ? WHERE business_id = ? AND sheet_lead_id = ?'
    );

    const directNotifs = createdLeadsSummary.slice(0, 10);
    for (const item of directNotifs) {
      const priorKnown = knownBySheetId.get(item.sheetLeadId);
      const existingNotif = checkExistingNotifStmt.get(businessId, `/leads/${item.id}`) as { id: string } | undefined;
      if (priorKnown?.notified_at || existingNotif) {
        markNotifiedStmt.run(finishedAt, businessId, item.sheetLeadId);
        continue;
      }

      const phoneAr = item.phone ? `الهاتف: ${item.phone}` : 'بدون رقم هاتف';
      const phoneEn = item.phone ? `Phone: ${item.phone}` : 'No phone';
      const timeAr = formatNotificationLeadTime(item.createdAt, 'ar');
      const timeEn = formatNotificationLeadTime(item.createdAt, 'en');
      const serviceSuffix = item.interestedService ? ` · ${item.interestedService}` : '';

      const notif = createAndBroadcastNotification(db, {
        businessId,
        userId: null,
        type: 'new_lead',
        titleAr: `عميل جديد من الشيت: ${item.fullName}`,
        titleEn: `New Lead from Sheet: ${item.fullName}`,
        messageAr: `${phoneAr} · وقت التسجيل: ${timeAr} · (${item.leadCode})${serviceSuffix}`,
        messageEn: `${phoneEn} · Registered: ${timeEn} · (${item.leadCode})${serviceSuffix}`,
        linkPath: `/leads/${item.id}`,
        leadId: item.id,
        createdAt: finishedAt,
      });

      markNotifiedStmt.run(finishedAt, businessId, item.sheetLeadId);
      createdNotifications.push(notif);
    }

    if (createdLeadsSummary.length > 10) {
      const batchNotif = createAndBroadcastNotification(db, {
        businessId,
        userId: null,
        type: 'sheet_synced',
        titleAr: `اكتشاف ${createdCount} ليدز جديدة من Google Sheets`,
        titleEn: `Detected ${createdCount} New Leads from Google Sheets`,
        messageAr: `تمت إضافة ${createdCount} عميل جديد وتحديث ${updatedCount} سجل خلال دورة المزامنة`,
        messageEn: `Added ${createdCount} new leads and updated ${updatedCount} rows during sync`,
        linkPath: '/leads',
        createdAt: finishedAt,
      });
      createdNotifications.push(batchNotif);
    }
  }

  if (createdCount > 0 || updatedCount > 0) {
    broadcastWorkspaceEvent(businessId, 'sheet_synced', {
      businessId,
      createdCount,
      updatedCount,
      skippedCount,
      totalLeadsInBusiness,
      latestLeadId: createdLeadsSummary[0]?.id || updatedLeadsSummary[0]?.id || null,
      newLeads: createdLeadsSummary,
      syncedAt: finishedAt,
      syncDurationMs,
      sourceLabel,
    });
  }

  return {
    processedCount,
    createdCount,
    updatedCount,
    skippedCount,
    totalLeadsInBusiness,
    syncedAt: finishedAt,
    syncDurationMs,
    sourceMode: sourceLabel,
    newLeads: createdLeadsSummary,
    createdNotifications,
  };
}

export function syncAttachedSheetToWorkspace(
  db: SqlDb,
  businessId = ALSAFA_WORKSPACE_ID,
  filePath = ATTACHED_SHEET_PATH,
  options?: { emitNotificationOnChanges?: boolean }
): SheetSyncResult {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Sheet file not found at ${filePath}`);
  }
  const csvText = fs.readFileSync(filePath, 'utf8');
  const rows = parseCsvRows(csvText);
  return syncSheetRowsToWorkspace(db, {
    businessId,
    rows,
    sourceLabel: 'attached_csv_live',
    conflictPolicy: 'sheet_wins',
    recordSyncLog: true,
    emitNotificationOnChanges: options?.emitNotificationOnChanges ?? true,
    integrationProvider: 'google_sheets',
  });
}

export function extractGoogleSheetCsvUrl(inputUrl: string): string | null {
  const trimmed = inputUrl.trim();
  if (!trimmed) return null;
  if (trimmed.includes('export?format=csv') || trimmed.includes('output=csv') || trimmed.includes('tqx=out:csv')) {
    return trimmed;
  }
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) return null;
  const spreadsheetId = match[1];
  const gidMatch = trimmed.match(/[?#&]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : '0';
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
}

export function extractSpreadsheetIdFromUrl(inputUrl?: string | null): string | null {
  if (!inputUrl) return null;
  const match = String(inputUrl).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : null;
}

export interface WorkspaceSheetRuntimeState {
  isSyncing: boolean;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastSyncDurationMs: number | null;
  lastError: string | null;
  lastErrorStatus: number | null;
  consecutiveFailures: number;
  nextAllowedRetryMs: number;
  lastCreatedCount: number;
  lastUpdatedCount: number;
  lastNewLeads: NewSheetLeadSummary[];
}

const workspaceRuntimeMap = new Map<string, WorkspaceSheetRuntimeState>();
const inFlightWorkspaceSyncs = new Map<string, Promise<SheetSyncResult>>();

export function getWorkspaceSheetSyncRuntimeState(businessId: string): WorkspaceSheetRuntimeState {
  let st = workspaceRuntimeMap.get(businessId);
  if (!st) {
    st = {
      isSyncing: false,
      lastAttemptAt: null,
      lastSuccessAt: null,
      lastSyncDurationMs: null,
      lastError: null,
      lastErrorStatus: null,
      consecutiveFailures: 0,
      nextAllowedRetryMs: 0,
      lastCreatedCount: 0,
      lastUpdatedCount: 0,
      lastNewLeads: [],
    };
    workspaceRuntimeMap.set(businessId, st);
  }
  return st;
}

/**
 * Fetches all rows from Google Sheets using either Google Sheets API v4 (if OAuth token or API key is configured)
 * or Google Sheets live CSV export / gviz endpoints with strict cache-busting headers.
 */
export async function fetchLiveGoogleSheetRows(params: {
  spreadsheetId?: string | null;
  publicCsvUrl?: string | null;
  sheetTitle?: string | null;
  googleAccessToken?: string | null;
  timeoutMs?: number;
}): Promise<{ rows: string[][]; sourceLabel: string }> {
  const {
    spreadsheetId: rawSpreadsheetId,
    publicCsvUrl: rawCsvUrl,
    sheetTitle,
    googleAccessToken,
    timeoutMs = 12_000,
  } = params;

  const spreadsheetId =
    rawSpreadsheetId ||
    extractSpreadsheetIdFromUrl(rawCsvUrl) ||
    DEFAULT_ALSAFA_SPREADSHEET_ID;

  const apiKey = process.env.GOOGLE_SHEETS_API_KEY?.trim() || '';

  // Method 1: Google Sheets API v4 (when OAuth Bearer token or GOOGLE_SHEETS_API_KEY is available)
  if ((googleAccessToken || apiKey) && spreadsheetId) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // Request entire sheet without row cap (e.g. 'Sheet1' or 'A:ZZ')
      const range = sheetTitle ? `'${sheetTitle.replace(/'/g, "''")}'` : 'A:ZZ';
      const apiUrl = new URL(
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`
      );
      apiUrl.searchParams.set('valueRenderOption', 'FORMATTED_VALUE');
      if (!googleAccessToken && apiKey) {
        apiUrl.searchParams.set('key', apiKey);
      }

      const headers: Record<string, string> = {
        'Cache-Control': 'no-cache, no-store, max-age=0',
        Pragma: 'no-cache',
      };
      if (googleAccessToken) {
        headers.Authorization = `Bearer ${googleAccessToken}`;
      }

      const res = await fetch(apiUrl.toString(), {
        headers,
        signal: controller.signal,
      });

      if (res.ok) {
        const data = (await res.json()) as any;
        if (Array.isArray(data?.values) && data.values.length >= 1) {
          return {
            rows: data.values.map((r: any[]) => (Array.isArray(r) ? r.map((c) => String(c ?? '')) : [])),
            sourceLabel: 'google_sheets_api_v4',
          };
        }
      } else if (res.status === 429 || res.status >= 500) {
        const err: any = new Error(`Google Sheets API HTTP ${res.status}`);
        err.status = res.status;
        throw err;
      }
    } finally {
      clearTimeout(timer);
    }
  }

  // Method 2: Direct Google Sheets CSV Export + gviz/tq fallback (reads all used rows without row limit)
  const baseCsvUrl =
    (rawCsvUrl && extractGoogleSheetCsvUrl(rawCsvUrl)) ||
    (spreadsheetId
      ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=0`
      : DEFAULT_ALSAFA_CSV_URL);

  const gidMatch = baseCsvUrl.match(/[?&]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : '0';

  const candidateUrls = [
    baseCsvUrl,
    spreadsheetId
      ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&gid=${gid}`
      : '',
  ].filter(Boolean);

  let lastErr: any = null;
  for (const urlStr of candidateUrls) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const separator = urlStr.includes('?') ? '&' : '?';
      const cacheBustedUrl = `${urlStr}${separator}_cb=${Date.now()}`;
      const res = await fetch(cacheBustedUrl, {
        headers: {
          'Cache-Control': 'no-cache, no-store, max-age=0',
          Pragma: 'no-cache',
          Accept: 'text/csv,text/plain,*/*',
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        const err: any = new Error(`Google Sheets fetch failed (${res.status})`);
        err.status = res.status;
        lastErr = err;
        if (res.status === 429) throw err;
        continue;
      }

      const csvText = await res.text();
      if (!csvText || !csvText.trim() || csvText.trim().startsWith('<!DOCTYPE html')) {
        lastErr = new Error('Google Sheet returned HTML instead of CSV (check link sharing permissions)');
        continue;
      }

      const rows = parseCsvRows(csvText);
      if (rows.length >= 1) {
        return { rows, sourceLabel: 'google_sheet_live_csv' };
      }
    } catch (err: any) {
      lastErr = err;
      if (err?.status === 429) throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastErr || new Error('Unable to fetch rows from Google Sheets');
}

/**
 * Synchronizes a workspace from its configured Google Sheet (or fallback attached CSV in offline/test mode)
 * with in-flight deduplication and exponential backoff tracking on 429/5xx errors.
 */
export async function syncWorkspaceFromConfiguredSheet(
  db: SqlDb,
  businessId: string,
  options?: {
    sheetUrl?: string;
    csvText?: string;
    googleAccessToken?: string | null;
    actorUserId?: string | null;
    emitNotificationOnChanges?: boolean;
    force?: boolean;
    preferAttachedOnly?: boolean;
  }
): Promise<SheetSyncResult> {
  // Prevent concurrent duplicate syncs for the same workspace
  const existingInFlight = inFlightWorkspaceSyncs.get(businessId);
  if (existingInFlight && !options?.csvText) {
    return existingInFlight;
  }

  const runtime = getWorkspaceSheetSyncRuntimeState(businessId);

  // Respect exponential backoff window on background polls unless forced manually
  if (!options?.force && !options?.csvText && runtime.nextAllowedRetryMs > Date.now()) {
    const waitSec = Math.ceil((runtime.nextAllowedRetryMs - Date.now()) / 1000);
    throw new Error(`Sync backoff active — retrying in ${waitSec}s`);
  }

  const runPromise = (async (): Promise<SheetSyncResult> => {
    const startMs = Date.now();
    runtime.isSyncing = true;
    runtime.lastAttemptAt = new Date().toISOString();

    try {
      // 1. Direct CSV payload provided (e.g., manual CSV file upload or unit test)
      if (typeof options?.csvText === 'string' && options.csvText.trim()) {
        const rows = parseCsvRows(options.csvText);
        const res = syncSheetRowsToWorkspace(db, {
          businessId,
          rows,
          sourceLabel: 'csv_upload_sync',
          conflictPolicy: 'sheet_wins',
          actorUserId: options.actorUserId || null,
          recordSyncLog: true,
          emitNotificationOnChanges: options.emitNotificationOnChanges ?? true,
          syncDurationMs: Date.now() - startMs,
        });
        runtime.consecutiveFailures = 0;
        runtime.nextAllowedRetryMs = 0;
        runtime.lastError = null;
        runtime.lastErrorStatus = null;
        runtime.lastSuccessAt = res.syncedAt;
        runtime.lastSyncDurationMs = res.syncDurationMs;
        runtime.lastCreatedCount = res.createdCount;
        runtime.lastUpdatedCount = res.updatedCount;
        if (res.newLeads.length > 0) runtime.lastNewLeads = res.newLeads;
        return res;
      }

      // 2. Load integration config for this workspace
      const existingInteg = db
        .prepare("SELECT id, config_json FROM integrations WHERE business_id = ? AND provider = 'google_sheets'")
        .get(businessId) as { id: string; config_json: string } | undefined;
      const prevCfg = existingInteg ? JSON.parse(existingInteg.config_json || '{}') : {};

      const targetSheetUrl =
        options?.sheetUrl?.trim() ||
        prevCfg.sheetUrl ||
        prevCfg.publicCsvUrl ||
        (businessId === ALSAFA_WORKSPACE_ID ? DEFAULT_ALSAFA_SHEET_URL : '');

      const targetCsvUrl =
        (targetSheetUrl && extractGoogleSheetCsvUrl(targetSheetUrl)) ||
        prevCfg.publicCsvUrl ||
        (businessId === ALSAFA_WORKSPACE_ID ? DEFAULT_ALSAFA_CSV_URL : '');

      const targetSpreadsheetId =
        extractSpreadsheetIdFromUrl(targetSheetUrl) ||
        prevCfg.spreadsheetId ||
        (businessId === ALSAFA_WORKSPACE_ID ? DEFAULT_ALSAFA_SPREADSHEET_ID : '');

      // In isolated test environment without an explicit sheetUrl, use attached sheet for deterministic test speed
      const useAttachedOnly =
        options?.preferAttachedOnly === true ||
        (process.env.NODE_ENV === 'test' && !options?.sheetUrl);

      if (!useAttachedOnly && (targetCsvUrl || targetSpreadsheetId)) {
        const { rows, sourceLabel } = await fetchLiveGoogleSheetRows({
          spreadsheetId: targetSpreadsheetId,
          publicCsvUrl: targetCsvUrl,
          sheetTitle: prevCfg.sheetTitle || null,
          googleAccessToken: options?.googleAccessToken || null,
        });

        // Persist updated Google Sheet URL config in integrations table
        const now = new Date().toISOString();
        const integId = existingInteg?.id || crypto.randomUUID();
        const nextCfg = {
          ...prevCfg,
          spreadsheetId: targetSpreadsheetId,
          publicCsvUrl: targetCsvUrl,
          sheetUrl: targetSheetUrl || prevCfg.sheetUrl || DEFAULT_ALSAFA_SHEET_URL,
          attachedSheetName: prevCfg.attachedSheetName || 'الصفا ستيل غرابيل وحوامل كابلات',
          spreadsheetName: prevCfg.spreadsheetName || 'الصفا ستيل غرابيل وحوامل كابلات',
          autoScheduled: prevCfg.autoScheduled !== false,
          conflictPolicy: prevCfg.conflictPolicy || 'sheet_wins',
        };

        db.prepare(`
          INSERT INTO integrations (id, business_id, provider, status, display_name, config_json, last_sync_at, last_error, created_at, updated_at)
          VALUES (?, ?, 'google_sheets', 'connected', 'الصفا ستيل غرابيل وحوامل كابلات (Google Sheets)', ?, ?, NULL, ?, ?)
          ON CONFLICT(business_id, provider) DO UPDATE SET
            status = 'connected',
            config_json = excluded.config_json,
            last_sync_at = excluded.last_sync_at,
            last_error = NULL,
            updated_at = excluded.updated_at
        `).run(integId, businessId, JSON.stringify(nextCfg), now, now, now);

        const res = syncSheetRowsToWorkspace(db, {
          businessId,
          rows,
          sourceLabel,
          conflictPolicy: nextCfg.conflictPolicy || 'sheet_wins',
          columnMapping: nextCfg.columnMapping || {},
          actorUserId: options?.actorUserId || null,
          recordSyncLog: true,
          emitNotificationOnChanges: options?.emitNotificationOnChanges ?? true,
          syncDurationMs: Date.now() - startMs,
        });

        runtime.consecutiveFailures = 0;
        runtime.nextAllowedRetryMs = 0;
        runtime.lastError = null;
        runtime.lastErrorStatus = null;
        runtime.lastSuccessAt = res.syncedAt;
        runtime.lastSyncDurationMs = res.syncDurationMs;
        runtime.lastCreatedCount = res.createdCount;
        runtime.lastUpdatedCount = res.updatedCount;
        if (res.newLeads.length > 0) runtime.lastNewLeads = res.newLeads;
        return res;
      }

      // Fallback to local attached CSV file
      const fallbackRes = syncAttachedSheetToWorkspace(db, businessId, ATTACHED_SHEET_PATH, {
        emitNotificationOnChanges: options?.emitNotificationOnChanges ?? true,
      });
      runtime.consecutiveFailures = 0;
      runtime.nextAllowedRetryMs = 0;
      runtime.lastError = null;
      runtime.lastErrorStatus = null;
      runtime.lastSuccessAt = fallbackRes.syncedAt;
      runtime.lastSyncDurationMs = fallbackRes.syncDurationMs;
      runtime.lastCreatedCount = fallbackRes.createdCount;
      runtime.lastUpdatedCount = fallbackRes.updatedCount;
      if (fallbackRes.newLeads.length > 0) runtime.lastNewLeads = fallbackRes.newLeads;
      return fallbackRes;
    } catch (err: any) {
      runtime.consecutiveFailures += 1;
      runtime.lastError = err?.message || 'Google Sheets sync failed';
      runtime.lastErrorStatus = typeof err?.status === 'number' ? err.status : null;
      // Exponential backoff (15s -> 30s -> 60s -> max 120s) on 429 or 5xx or network error
      const backoffMs = Math.min(120_000, 15_000 * Math.pow(2, Math.min(3, runtime.consecutiveFailures - 1)));
      runtime.nextAllowedRetryMs = Date.now() + backoffMs;

      try {
        const now = new Date().toISOString();
        db.prepare(
          "UPDATE integrations SET status = 'error', last_error = ?, updated_at = ? WHERE business_id = ? AND provider = 'google_sheets'"
        ).run(runtime.lastError, now, businessId);
      } catch {
        // ignore DB status update failure
      }

      throw err;
    } finally {
      runtime.isSyncing = false;
      inFlightWorkspaceSyncs.delete(businessId);
    }
  })();

  inFlightWorkspaceSyncs.set(businessId, runPromise);
  return runPromise;
}

const activeWatchers = new Set<string>();

/**
 * Watches the attached sheet file continuously and runs background 15-second
 * adaptive Google Sheets polling with exponential backoff.
 */
export function startAttachedSheetWatcher(
  db: SqlDb,
  businessId = ALSAFA_WORKSPACE_ID,
  filePath = ATTACHED_SHEET_PATH
) {
  const watcherKey = `${businessId}:${filePath}`;
  if (activeWatchers.has(watcherKey)) return;
  activeWatchers.add(watcherKey);

  let lastMtimeMs = 0;
  let lastSize = 0;
  let lastContentHash = '';
  let syncingFile = false;
  let debounceTimer: NodeJS.Timeout | null = null;

  const initStat = () => {
    try {
      if (fs.existsSync(filePath)) {
        const st = fs.statSync(filePath);
        lastMtimeMs = st.mtimeMs;
        lastSize = st.size;
        lastContentHash = crypto.createHash('sha1').update(fs.readFileSync(filePath)).digest('hex');
      }
    } catch {
      // ignore initial stat issues
    }
  };
  initStat();

  const checkAndSyncFile = () => {
    if (syncingFile || !fs.existsSync(filePath)) return;
    try {
      const st = fs.statSync(filePath);
      if (st.mtimeMs === lastMtimeMs && st.size === lastSize) return;

      const buf = fs.readFileSync(filePath);
      const nextHash = crypto.createHash('sha1').update(buf).digest('hex');
      lastMtimeMs = st.mtimeMs;
      lastSize = st.size;

      if (nextHash === lastContentHash) return;
      lastContentHash = nextHash;

      syncingFile = true;
      const result = syncAttachedSheetToWorkspace(db, businessId, filePath, { emitNotificationOnChanges: true });
      if (result.createdCount > 0 || result.updatedCount > 0) {
        console.log(
          `[LiveSheetSync] Detected local sheet update (${businessId}): +${result.createdCount} created, ${result.updatedCount} updated`
        );
      }
    } catch (err) {
      console.error('[LiveSheetSync] File watch sync error:', err);
    } finally {
      syncingFile = false;
    }
  };

  const scheduleCheck = () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(checkAndSyncFile, 250);
  };

  try {
    const dir = path.dirname(filePath);
    const targetName = path.basename(filePath);
    if (fs.existsSync(dir)) {
      const watcher = fs.watch(dir, (_eventType, filename) => {
        if (!filename || filename === targetName) {
          scheduleCheck();
        }
      });
      watcher.unref?.();
    }
  } catch {
    // fallback polling below covers environments where fs.watch is unavailable
  }

  const filePollTimer = setInterval(checkAndSyncFile, 2500);
  filePollTimer.unref?.();

  // Trigger an immediate initial live Google Sheet sync on server start (in non-test environments)
  if (process.env.NODE_ENV !== 'test') {
    setTimeout(() => {
      syncWorkspaceFromConfiguredSheet(db, businessId, {
        emitNotificationOnChanges: true,
      }).catch(() => {
        // silent background fallback
      });
    }, 800);
  }

  // Adaptive 15-second background polling of the connected Google Sheet
  const remotePollTimer = setInterval(async () => {
    if (process.env.NODE_ENV === 'test') return;
    try {
      const integ = db
        .prepare("SELECT config_json FROM integrations WHERE business_id = ? AND provider = 'google_sheets'")
        .get(businessId) as { config_json: string } | undefined;
      if (integ) {
        const cfg = JSON.parse(integ.config_json || '{}');
        if (cfg.autoScheduled === false) return;
      }

      await syncWorkspaceFromConfiguredSheet(db, businessId, {
        emitNotificationOnChanges: true,
      });
    } catch {
      // Backoff is recorded in workspaceRuntimeMap and integrations.last_error
    }
  }, 15_000);
  remotePollTimer.unref?.();
}
