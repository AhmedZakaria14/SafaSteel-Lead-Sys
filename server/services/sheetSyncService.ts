import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqlDb, normalizePhoneE164 } from '../db.ts';
import { addSseClient, removeSseClient, broadcastWorkspaceEvent } from './realtimeService.ts';
import { createAndBroadcastNotification } from './notificationService.ts';

export { addSseClient, removeSseClient, broadcastWorkspaceEvent };

export const ALSAFA_WORKSPACE_ID = 'alsafa-steel-workspace';
const __sheetServiceDir =
  typeof import.meta !== 'undefined' && Boolean(import.meta.url)
    ? path.dirname(fileURLToPath(import.meta.url))
    : path.join(process.cwd(), 'server', 'services');
const CANDIDATE_SHEET_PATHS = [
  path.join(process.cwd(), 'public', 'assets', 'aistudio', '________________________________e27d1ae1'),
  path.resolve(__sheetServiceDir, '../../public/assets/aistudio/________________________________e27d1ae1'),
];
export const ATTACHED_SHEET_PATH =
  CANDIDATE_SHEET_PATHS.find((p) => fs.existsSync(p)) || CANDIDATE_SHEET_PATHS[0];

/**
 * RFC-4180 compliant UTF-8 CSV parser handling multiline quoted fields,
 * escaped quotes (""), and CRLF/LF line endings.
 */
export function parseCsvRows(rawContent: string): string[][] {
  const content = rawContent.replace(/^\uFEFF/, '');
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
    } else if (ch === ',') {
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

  // Match stage key or localized name
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

function safeIsoTimestamp(raw?: string | null): string {
  if (!raw) return new Date().toISOString();
  const parsed = new Date(raw.trim());
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }
  return new Date().toISOString();
}

export interface SheetSyncResult {
  processedCount: number;
  createdCount: number;
  updatedCount: number;
  skippedCount: number;
  totalLeadsInBusiness: number;
  syncedAt: string;
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

  const startedAt = new Date().toISOString();
  const biz = db
    .prepare('SELECT id, default_country_code, is_demo FROM businesses WHERE id = ?')
    .get(businessId) as { id: string; default_country_code: string; is_demo: number } | undefined;
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
    .prepare('SELECT id, external_row_id, status_id, full_name, phone, email, interested_service, notes_summary, custom_values_json, updated_at FROM leads WHERE business_id = ?')
    .all(businessId) as Array<{
    id: string;
    external_row_id: string | null;
    status_id: string | null;
    full_name: string;
    phone: string | null;
    email: string | null;
    interested_service: string | null;
    notes_summary: string | null;
    custom_values_json: string;
    updated_at: string;
  }>;

  const existingByExtId = new Map<string, (typeof existingLeads)[number]>();
  for (const el of existingLeads) {
    if (el.external_row_id) existingByExtId.set(el.external_row_id, el);
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
      is_demo, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)
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
        updated_at = ?
    WHERE id = ? AND business_id = ?
  `);

  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  let processedCount = 0;
  const createdLeadsSummary: Array<{ id: string; leadCode: string; fullName: string; interestedService: string | null }> = [];
  const updatedLeadsSummary: Array<{ id: string; fullName: string }> = [];
  const nowIso = new Date().toISOString();

  db.exec('BEGIN');
  try {
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.every((cell) => !String(cell || '').trim())) continue;

      const cell = (idx: number) => (idx >= 0 && idx < row.length ? String(row[idx] ?? '').trim() : '');

      const rawId = cell(idxId);
      const rawName = cell(idxFullName) || (!idxFullName && idxFullName !== 0 ? '' : cell(0));
      const rawEmail = cell(idxEmail);
      const rawPhone = cell(idxPhone);
      const rawWhatsapp = cell(idxWhatsapp);

      // Skip trailing blank/dot artifacts and Meta test dummy lead rows
      if (
        !rawName ||
        rawName === '.' ||
        rawName.includes('<test lead:') ||
        rawId.includes('<test lead:') ||
        rawEmail === 'test@meta.com'
      ) {
        skippedCount += 1;
        continue;
      }

      processedCount += 1;

      const { displayPhone, phoneE164, whatsappClean } = cleanSheetPhone(
        rawPhone,
        rawWhatsapp,
        biz.default_country_code || '+20'
      );

      const externalRowId =
        rawId ||
        crypto
          .createHash('sha1')
          .update(`${sourceLabel}:${rawName}:${phoneE164 || rawPhone}:${rawEmail}`)
          .digest('hex')
          .slice(0, 20);

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
          })
        )
        .digest('hex')
        .slice(0, 16);

      customValues._sheet_hash = rowFingerprint;

      const createdAt = safeIsoTimestamp(cell(idxCreatedTime));
      const source = mapSourceFromPlatform(platform);
      const mappedStatusId = resolveSheetStatusId(sheetLeadStatus, stages);

      const existing = existingByExtId.get(externalRowId);

      if (!existing) {
        const leadId = crypto.randomUUID();
        const leadCode = `LD-${nextLeadNum++}`;
        const metaLeadgenId = rawId.startsWith('l:') ? rawId : null;

        insertLeadStmt.run(
          leadId,
          leadCode,
          businessId,
          rawName,
          displayPhone,
          phoneE164,
          rawEmail || null,
          productLabel || (quantitySizes ? quantitySizes.slice(0, 120) : null),
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
          metaLeadgenId,
          externalRowId,
          JSON.stringify(originalAnswers),
          JSON.stringify(customValues),
          quantitySizes || null,
          biz.is_demo,
          createdAt,
          createdAt
        );

        insertActivityStmt.run(
          crypto.randomUUID(),
          businessId,
          leadId,
          actorUserId,
          'sheet_synced',
          `تم استيراد العميل تلقائياً من الشيت (${leadCode})`,
          `Auto-synced lead from sheet (${leadCode})`,
          JSON.stringify({ externalRowId, sourceLabel, platform }),
          createdAt
        );

        existingByExtId.set(externalRowId, {
          id: leadId,
          external_row_id: externalRowId,
          status_id: mappedStatusId,
          full_name: rawName,
          phone: displayPhone,
          email: rawEmail || null,
          interested_service: productLabel,
          notes_summary: quantitySizes || null,
          custom_values_json: JSON.stringify(customValues),
          updated_at: createdAt,
        });

        createdLeadsSummary.push({
          id: leadId,
          leadCode,
          fullName: rawName,
          interestedService: productLabel || null,
        });
        createdCount += 1;
      } else {
        const prevCustom = JSON.parse(existing.custom_values_json || '{}');
        if (prevCustom._sheet_hash === rowFingerprint) {
          skippedCount += 1;
          continue;
        }

        if (conflictPolicy === 'crm_wins') {
          skippedCount += 1;
          continue;
        }

        // Preserve manual CRM stage changes unless sheet_lead_status actually changed on the sheet
        const sheetStatusChanged =
          Boolean(sheetLeadStatus) && prevCustom.sheet_lead_status !== sheetLeadStatus;
        const nextStatusId = sheetStatusChanged && mappedStatusId ? mappedStatusId : existing.status_id;

        const mergedCustom = { ...prevCustom, ...customValues };

        updateLeadStmt.run(
          rawName,
          displayPhone,
          phoneE164,
          rawEmail || null,
          productLabel || existing.interested_service,
          source,
          nextStatusId,
          campaignId,
          campaignName,
          adSetId,
          adSetName,
          adId,
          adName,
          formId,
          formName,
          JSON.stringify(originalAnswers),
          JSON.stringify(mergedCustom),
          quantitySizes || '',
          nowIso,
          existing.id,
          businessId
        );

        updatedLeadsSummary.push({ id: existing.id, fullName: rawName });
        updatedCount += 1;
      }
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const finishedAt = new Date().toISOString();
  const totalLeadsInBusiness = (
    db.prepare('SELECT COUNT(*) as cnt FROM leads WHERE business_id = ?').get(businessId) as { cnt: number }
  ).cnt;

  if (recordSyncLog && (createdCount > 0 || updatedCount > 0)) {
    const integ = db
      .prepare('SELECT id FROM integrations WHERE business_id = ? AND provider = ?')
      .get(businessId, integrationProvider) as { id: string } | undefined;

    if (integ) {
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
        JSON.stringify({ totalLeadsInBusiness }),
        startedAt,
        finishedAt
      );

      db.prepare('UPDATE integrations SET status = ?, last_sync_at = ?, last_error = NULL, updated_at = ? WHERE id = ?').run(
        'connected',
        finishedAt,
        finishedAt,
        integ.id
      );
    }

    if (emitNotificationOnChanges && (createdCount > 0 || updatedCount > 0)) {
      if (createdLeadsSummary.length > 0) {
        const directNotifs = createdLeadsSummary.slice(-5);
        for (const item of directNotifs) {
          const serviceSuffix = item.interestedService ? ` · ${item.interestedService}` : '';
          createAndBroadcastNotification(db, {
            businessId,
            userId: null,
            type: 'new_lead',
            titleAr: `عميل جديد من الشيت: ${item.fullName}`,
            titleEn: `New Lead from Sheet: ${item.fullName}`,
            messageAr: `${item.leadCode}${serviceSuffix}`,
            messageEn: `${item.leadCode}${serviceSuffix}`,
            linkPath: `/leads/${item.id}`,
            leadId: item.id,
            createdAt: finishedAt,
          });
        }
        if (createdLeadsSummary.length > 5) {
          createAndBroadcastNotification(db, {
            businessId,
            userId: null,
            type: 'sheet_synced',
            titleAr: 'تحديث لحظي من الشيت',
            titleEn: 'Real-Time Sheet Sync',
            messageAr: `تمت مزامنة ${createdCount} عميل جديد وتحديث ${updatedCount} سجل من الشيت`,
            messageEn: `Synced ${createdCount} new leads and updated ${updatedCount} rows from sheet`,
            linkPath: '/leads',
            createdAt: finishedAt,
          });
        }
      } else if (updatedLeadsSummary.length === 1) {
        const single = updatedLeadsSummary[0];
        createAndBroadcastNotification(db, {
          businessId,
          userId: null,
          type: 'lead_updated',
          titleAr: `تم تحديث بيانات: ${single.fullName}`,
          titleEn: `Lead Updated: ${single.fullName}`,
          messageAr: 'تم تحديث بيانات العميل تلقائياً من الشيت',
          messageEn: 'Lead details auto-updated from sheet',
          linkPath: `/leads/${single.id}`,
          leadId: single.id,
          createdAt: finishedAt,
        });
      } else if (updatedCount > 0) {
        createAndBroadcastNotification(db, {
          businessId,
          userId: null,
          type: 'sheet_synced',
          titleAr: 'تحديث بيانات من الشيت',
          titleEn: 'Sheet Sync Updated Records',
          messageAr: `تم تحديث ${updatedCount} سجل من الشيت`,
          messageEn: `Updated ${updatedCount} rows from sheet`,
          linkPath: '/leads',
          createdAt: finishedAt,
        });
      }
    }
  }

  if (createdCount > 0 || updatedCount > 0) {
    broadcastWorkspaceEvent(businessId, 'sheet_synced', {
      businessId,
      createdCount,
      updatedCount,
      skippedCount,
      totalLeadsInBusiness,
      latestLeadId: createdLeadsSummary[createdLeadsSummary.length - 1]?.id || updatedLeadsSummary[0]?.id || null,
      syncedAt: finishedAt,
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

const activeWatchers = new Set<string>();

/**
 * Watches the attached sheet file continuously (using both fs.watch and a fast
 * 2.5s stat check) and also polls any configured public CSV export URL if present,
 * broadcasting SSE events the instant new rows are added.
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
  let syncing = false;
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
    if (syncing || !fs.existsSync(filePath)) return;
    try {
      const st = fs.statSync(filePath);
      if (st.mtimeMs === lastMtimeMs && st.size === lastSize) return;

      const buf = fs.readFileSync(filePath);
      const nextHash = crypto.createHash('sha1').update(buf).digest('hex');
      lastMtimeMs = st.mtimeMs;
      lastSize = st.size;

      if (nextHash === lastContentHash) return;
      lastContentHash = nextHash;

      syncing = true;
      const result = syncAttachedSheetToWorkspace(db, businessId, filePath, { emitNotificationOnChanges: true });
      if (result.createdCount > 0 || result.updatedCount > 0) {
        console.log(
          `[LiveSheetSync] Detected sheet update (${businessId}): +${result.createdCount} created, ${result.updatedCount} updated`
        );
      }
    } catch (err) {
      console.error('[LiveSheetSync] File watch sync error:', err);
    } finally {
      syncing = false;
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

  // Also poll configured public Google Sheet CSV URL if user connected one for background server sync
  let lastRemoteHash = '';
  const remotePollTimer = setInterval(async () => {
    try {
      const integ = db
        .prepare("SELECT config_json FROM integrations WHERE business_id = ? AND provider = 'google_sheets'")
        .get(businessId) as { config_json: string } | undefined;
      if (!integ) return;
      const cfg = JSON.parse(integ.config_json || '{}');
      const publicCsvUrl = typeof cfg.publicCsvUrl === 'string' ? cfg.publicCsvUrl.trim() : '';
      if (!publicCsvUrl || cfg.autoScheduled === false) return;

      const res = await fetch(publicCsvUrl);
      if (!res.ok) return;
      const csvText = await res.text();
      if (!csvText.trim()) return;
      const nextHash = crypto.createHash('sha1').update(csvText).digest('hex');
      if (nextHash === lastRemoteHash) return;
      lastRemoteHash = nextHash;

      const rows = parseCsvRows(csvText);
      syncSheetRowsToWorkspace(db, {
        businessId,
        rows,
        sourceLabel: 'google_sheet_live_csv',
        conflictPolicy: cfg.conflictPolicy || 'sheet_wins',
        columnMapping: cfg.columnMapping || {},
        recordSyncLog: true,
        emitNotificationOnChanges: true,
        integrationProvider: 'google_sheets',
      });
    } catch {
      // silent background retry on next tick
    }
  }, 15_000);
  remotePollTimer.unref?.();
}

export function extractGoogleSheetCsvUrl(inputUrl: string): string | null {
  const trimmed = inputUrl.trim();
  if (!trimmed) return null;
  // Already a direct CSV export link
  if (trimmed.includes('export?format=csv') || trimmed.includes('output=csv')) {
    return trimmed;
  }
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!match) return null;
  const spreadsheetId = match[1];
  const gidMatch = trimmed.match(/[?#&]gid=(\d+)/);
  const gid = gidMatch ? gidMatch[1] : '0';
  return `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${gid}`;
}
