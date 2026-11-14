import crypto from 'node:crypto';
import { SqlDb, deterministicSheetLeadId, generateLeadCode, normalizePhoneE164 } from '../db.ts';
import { createAndBroadcastNotification } from './notificationService.ts';

export interface CreateLeadInput {
  businessId: string;
  fullName: string;
  phone?: string | null;
  email?: string | null;
  interestedService?: string | null;
  source?: string;
  statusId?: string | null;
  assignedToUserId?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  adSetId?: string | null;
  adSetName?: string | null;
  adId?: string | null;
  adName?: string | null;
  formId?: string | null;
  formName?: string | null;
  pageId?: string | null;
  metaLeadgenId?: string | null;
  externalRowId?: string | null;
  originalAnswers?: Record<string, unknown>;
  customValues?: Record<string, unknown>;
  notesSummary?: string | null;
  nextFollowUpAt?: string | null;
  actorUserId?: string | null;
  createdAt?: string;
}

export interface LeadLookupHints {
  leadCode?: string | null;
  externalRowId?: string | null;
  phone?: string | null;
}

export function resolveValidUserId(db: SqlDb, userId?: string | null): string | null {
  if (!userId || typeof userId !== 'string') return null;
  const trimmed = userId.trim();
  if (!trimmed) return null;
  const row = db.prepare('SELECT id FROM users WHERE id = ?').get(trimmed) as { id: string } | undefined;
  return row?.id || null;
}

export function resolveStageRecord(db: SqlDb, businessId: string, statusIdentifier?: string | null): any | null {
  if (!statusIdentifier || typeof statusIdentifier !== 'string') return null;
  const raw = statusIdentifier.trim();
  if (!raw) return null;

  const byId = db
    .prepare('SELECT * FROM lead_statuses WHERE id = ? AND business_id = ?')
    .get(raw, businessId) as any;
  if (byId) return byId;

  const byKeyOrName = db
    .prepare(
      'SELECT * FROM lead_statuses WHERE business_id = ? AND (LOWER(key) = LOWER(?) OR LOWER(name_ar) = LOWER(?) OR LOWER(name_en) = LOWER(?)) LIMIT 1'
    )
    .get(businessId, raw, raw, raw) as any;
  if (byKeyOrName) return byKeyOrName;

  return null;
}

const LEAD_SELECT_ENRICHED = `
  SELECT l.*,
         s.key as status_key, s.name_ar as status_name_ar, s.name_en as status_name_en, s.color as status_color,
         u.full_name as assigned_employee_name, u.email as assigned_employee_email,
         b.name as business_name
  FROM leads l
  LEFT JOIN lead_statuses s ON s.id = l.status_id
  LEFT JOIN users u ON u.id = l.assigned_to_user_id
  LEFT JOIN businesses b ON b.id = l.business_id
`;

export function resolveLeadRecord(
  db: SqlDb,
  businessId: string,
  rawLeadId?: string | null,
  hints?: LeadLookupHints
): any | null {
  const candidates: string[] = [];
  if (rawLeadId && typeof rawLeadId === 'string') {
    const trimmed = rawLeadId.trim();
    if (trimmed) {
      candidates.push(trimmed);
      try {
        const decoded = decodeURIComponent(trimmed).trim();
        if (decoded && decoded !== trimmed) candidates.push(decoded);
      } catch {
        // ignore malformed URI encoding
      }
    }
  }

  for (const cand of candidates) {
    // 1. Direct primary key match
    const byId = db
      .prepare(`${LEAD_SELECT_ENRICHED} WHERE l.id = ? AND l.business_id = ?`)
      .get(cand, businessId) as any;
    if (byId) return byId;

    // 2. Match by lead_code (e.g. LD-1001 or 1001)
    const normalizedCode = /^\d+$/.test(cand) ? `LD-${cand}` : cand;
    const byCode = db
      .prepare(`${LEAD_SELECT_ENRICHED} WHERE LOWER(l.lead_code) = LOWER(?) AND l.business_id = ? LIMIT 1`)
      .get(normalizedCode, businessId) as any;
    if (byCode) return byCode;

    // 3. Match by external_row_id, meta_leadgen_id, or deterministic ID derived from external_row_id
    const altExt = /^\d{8,}$/.test(cand) ? `l:${cand}` : cand;
    const detFromCand = deterministicSheetLeadId(businessId, cand);
    const detFromAlt = deterministicSheetLeadId(businessId, altExt);
    const byExt = db
      .prepare(
        `${LEAD_SELECT_ENRICHED}
         WHERE l.business_id = ?
           AND (l.external_row_id = ? OR l.external_row_id = ? OR l.meta_leadgen_id = ? OR l.id = ? OR l.id = ?)
         LIMIT 1`
      )
      .get(businessId, cand, altExt, cand, detFromCand, detFromAlt) as any;
    if (byExt) return byExt;

    // 4. Match pre-migration _legacy_id stored in custom_values_json
    if (cand.length >= 8) {
      const byLegacy = db
        .prepare(`${LEAD_SELECT_ENRICHED} WHERE l.business_id = ? AND l.custom_values_json LIKE ? LIMIT 1`)
        .get(businessId, `%"_legacy_id":"${cand.replace(/["%_]/g, '')}"%`) as any;
      if (byLegacy) return byLegacy;
    }
  }

  // 5. Fallback to explicit hints (externalRowId, leadCode, phone) sent by frontend
  if (hints?.externalRowId && typeof hints.externalRowId === 'string' && hints.externalRowId.trim()) {
    const ext = hints.externalRowId.trim();
    const detId = deterministicSheetLeadId(businessId, ext);
    const byHintExt = db
      .prepare(`${LEAD_SELECT_ENRICHED} WHERE l.business_id = ? AND (l.external_row_id = ? OR l.id = ?) LIMIT 1`)
      .get(businessId, ext, detId) as any;
    if (byHintExt) return byHintExt;
  }

  if (hints?.leadCode && typeof hints.leadCode === 'string' && hints.leadCode.trim()) {
    const code = hints.leadCode.trim();
    const byHintCode = db
      .prepare(`${LEAD_SELECT_ENRICHED} WHERE l.business_id = ? AND LOWER(l.lead_code) = LOWER(?) LIMIT 1`)
      .get(businessId, code) as any;
    if (byHintCode) return byHintCode;
  }

  if (hints?.phone && typeof hints.phone === 'string' && hints.phone.trim()) {
    const ph = hints.phone.trim();
    const byHintPhone = db
      .prepare(`${LEAD_SELECT_ENRICHED} WHERE l.business_id = ? AND (l.phone_e164 = ? OR l.phone = ?) LIMIT 1`)
      .get(businessId, ph, ph) as any;
    if (byHintPhone) return byHintPhone;
  }

  // 6. Check if rawLeadId came from an older notification link_path containing (LD-xxxx) in its message
  for (const cand of candidates) {
    const notif = db
      .prepare('SELECT title_ar, message_ar, message_en FROM notifications WHERE business_id = ? AND link_path = ? LIMIT 1')
      .get(businessId, `/leads/${cand}`) as { title_ar?: string; message_ar?: string; message_en?: string } | undefined;
    if (notif) {
      const combined = `${notif.message_ar || ''} ${notif.message_en || ''} ${notif.title_ar || ''}`;
      const codeMatch = combined.match(/\b(LD-\d+)\b/i);
      if (codeMatch) {
        const byNotifCode = db
          .prepare(`${LEAD_SELECT_ENRICHED} WHERE l.business_id = ? AND LOWER(l.lead_code) = LOWER(?) LIMIT 1`)
          .get(businessId, codeMatch[1]) as any;
        if (byNotifCode) return byNotifCode;
      }
    }
  }

  return null;
}

export function pickNextRoundRobinEmployee(db: SqlDb, businessId: string): string | null {
  const biz = db
    .prepare('SELECT round_robin_enabled, round_robin_index FROM businesses WHERE id = ?')
    .get(businessId) as { round_robin_enabled: number; round_robin_index: number } | undefined;

  if (!biz || !biz.round_robin_enabled) return null;

  const members = db
    .prepare(`
      SELECT user_id FROM business_memberships
      WHERE business_id = ? AND status = 'active' AND user_id IS NOT NULL AND role IN ('employee', 'manager', 'business_admin')
      ORDER BY created_at ASC
    `)
    .all(businessId) as Array<{ user_id: string }>;

  if (members.length === 0) return null;

  const idx = biz.round_robin_index % members.length;
  const chosenUserId = members[idx].user_id;

  db.prepare('UPDATE businesses SET round_robin_index = ? WHERE id = ?').run(idx + 1, businessId);
  return chosenUserId;
}

export function findDuplicateLeads(
  db: SqlDb,
  businessId: string,
  phoneE164?: string | null,
  email?: string | null,
  excludeLeadId?: string
) {
  const conditions: string[] = [];
  const params: unknown[] = [businessId];

  if (phoneE164 && phoneE164.length >= 6) {
    conditions.push('phone_e164 = ?');
    params.push(phoneE164);
  }
  if (email && email.trim()) {
    conditions.push('LOWER(email) = ?');
    params.push(email.trim().toLowerCase());
  }

  if (conditions.length === 0) return [];

  let sql = `SELECT id, lead_code, full_name, phone, email, created_at FROM leads WHERE business_id = ? AND (${conditions.join(' OR ')})`;
  if (excludeLeadId) {
    sql += ' AND id != ?';
    params.push(excludeLeadId);
  }
  sql += ' LIMIT 5';

  return db.prepare(sql).all(...(params as any[])) as Array<{
    id: string;
    lead_code: string;
    full_name: string;
    phone: string | null;
    email: string | null;
    created_at: string;
  }>;
}

export function createLeadRecord(db: SqlDb, input: CreateLeadInput) {
  const biz = db
    .prepare('SELECT id, default_country_code, is_demo FROM businesses WHERE id = ?')
    .get(input.businessId) as { id: string; default_country_code: string; is_demo: number } | undefined;

  if (!biz) {
    throw new Error('Business not found');
  }

  // Idempotent Meta Leadgen deduplication
  if (input.metaLeadgenId) {
    const existingMeta = db
      .prepare('SELECT * FROM leads WHERE business_id = ? AND meta_leadgen_id = ?')
      .get(input.businessId, input.metaLeadgenId) as any;
    if (existingMeta) {
      return { lead: existingMeta, deduplicated: true, duplicates: [] };
    }
  }

  // Idempotent Google Sheet row deduplication
  if (input.externalRowId) {
    const existingSheet = db
      .prepare('SELECT * FROM leads WHERE business_id = ? AND external_row_id = ?')
      .get(input.businessId, input.externalRowId) as any;
    if (existingSheet) {
      return { lead: existingSheet, deduplicated: true, duplicates: [] };
    }
  }

  let statusId = input.statusId ? resolveStageRecord(db, input.businessId, input.statusId)?.id || null : null;
  if (!statusId) {
    const defaultStage = db
      .prepare('SELECT id FROM lead_statuses WHERE business_id = ? ORDER BY is_default DESC, sort_order ASC LIMIT 1')
      .get(input.businessId) as { id: string } | undefined;
    statusId = defaultStage?.id || null;
  }

  let assignedTo = resolveValidUserId(db, input.assignedToUserId);
  if (!assignedTo) {
    assignedTo = pickNextRoundRobinEmployee(db, input.businessId);
  }

  const validActorId = resolveValidUserId(db, input.actorUserId);
  const now = input.createdAt || new Date().toISOString();
  const candidateId = input.externalRowId
    ? deterministicSheetLeadId(input.businessId, input.externalRowId)
    : crypto.randomUUID();
  const leadId = db.prepare('SELECT 1 FROM leads WHERE id = ?').get(candidateId)
    ? crypto.randomUUID()
    : candidateId;
  const leadCode = generateLeadCode(input.businessId, db);
  const phoneE164 = normalizePhoneE164(input.phone, biz.default_country_code);
  const duplicates = findDuplicateLeads(db, input.businessId, phoneE164, input.email);

  db.prepare(`
    INSERT INTO leads (
      id, lead_code, business_id, full_name, phone, phone_e164, email, interested_service,
      source, status_id, assigned_to_user_id, campaign_id, campaign_name, ad_set_id, ad_set_name,
      ad_id, ad_name, form_id, form_name, page_id, meta_leadgen_id, external_row_id,
      original_answers_json, custom_values_json, notes_summary, next_follow_up_at,
      is_demo, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    leadId,
    leadCode,
    input.businessId,
    input.fullName.trim(),
    input.phone?.trim() || null,
    phoneE164 || null,
    input.email?.trim() || null,
    input.interestedService?.trim() || null,
    input.source || 'manual',
    statusId,
    assignedTo,
    input.campaignId || null,
    input.campaignName || null,
    input.adSetId || null,
    input.adSetName || null,
    input.adId || null,
    input.adName || null,
    input.formId || null,
    input.formName || null,
    input.pageId || null,
    input.metaLeadgenId || null,
    input.externalRowId || null,
    JSON.stringify(input.originalAnswers || {}),
    JSON.stringify(input.customValues || {}),
    input.notesSummary || null,
    input.nextFollowUpAt || null,
    biz.is_demo,
    now,
    now
  );

  db.prepare(`
    INSERT INTO lead_activities (id, business_id, lead_id, actor_user_id, activity_type, description_ar, description_en, metadata_json, created_at)
    VALUES (?, ?, ?, ?, 'lead_created', ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    input.businessId,
    leadId,
    validActorId,
    `تم تسجيل عميل محتمل جديد (${input.fullName.trim()}) عبر ${input.source || 'manual'}`,
    `New lead captured (${input.fullName.trim()}) via ${input.source || 'manual'}`,
    JSON.stringify({ source: input.source || 'manual', leadCode }),
    now
  );

  if (input.notesSummary) {
    db.prepare(`
      INSERT INTO lead_notes (id, business_id, lead_id, author_user_id, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), input.businessId, leadId, validActorId, input.notesSummary, now);
  }

  // Notification for new lead (broadcast live via SSE + push)
  const leadLabel = `${input.fullName.trim()} (${leadCode})`;
  const serviceHint = input.interestedService?.trim() ? ` · ${input.interestedService.trim()}` : '';
  createAndBroadcastNotification(db, {
    businessId: input.businessId,
    userId: assignedTo,
    type: 'new_lead',
    titleAr: `عميل محتمل جديد: ${input.fullName.trim()}`,
    titleEn: `New Lead: ${input.fullName.trim()}`,
    messageAr: `تم استلام ${leadLabel}${serviceHint}`,
    messageEn: `Captured ${leadLabel}${serviceHint}`,
    linkPath: `/leads/${leadId}`,
    leadId,
    createdAt: now,
  });

  if (assignedTo) {
    createAndBroadcastNotification(db, {
      businessId: input.businessId,
      userId: assignedTo,
      type: 'lead_assigned',
      titleAr: 'تم تعيين عميل محتمل لك',
      titleEn: 'Lead Assigned to You',
      messageAr: `تم تعيين العميل ${leadLabel} لك`,
      messageEn: `${leadLabel} has been assigned to you`,
      linkPath: `/leads/${leadId}`,
      leadId,
      createdAt: now,
    });
  }

  const created = db.prepare('SELECT * FROM leads WHERE id = ?').get(leadId);
  return { lead: created, deduplicated: false, duplicates };
}

export function changeLeadStatus(
  db: SqlDb,
  params: {
    businessId: string;
    leadId: string;
    toStatusId: string;
    actorUserId?: string | null;
    note?: string | null;
    hints?: LeadLookupHints;
  }
) {
  const lead = resolveLeadRecord(db, params.businessId, params.leadId, params.hints);
  if (!lead) throw new Error('Lead not found');

  const canonicalLeadId = lead.id;
  const toStatus = resolveStageRecord(db, params.businessId, params.toStatusId);
  if (!toStatus) throw new Error('Target pipeline stage not found');

  const fromStatus = lead.status_id
    ? (db.prepare('SELECT * FROM lead_statuses WHERE id = ?').get(lead.status_id) as any)
    : null;

  const validActorId = resolveValidUserId(db, params.actorUserId);
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE leads
    SET status_id = ?,
        last_contact_at = COALESCE(last_contact_at, ?),
        is_read = 1,
        read_at = COALESCE(read_at, ?),
        read_by_user_id = COALESCE(read_by_user_id, ?),
        updated_at = ?
    WHERE id = ? AND business_id = ?
  `).run(toStatus.id, now, now, validActorId, now, canonicalLeadId, params.businessId);

  db.prepare(`
    INSERT INTO lead_status_history (id, business_id, lead_id, from_status_id, to_status_id, changed_by_user_id, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    params.businessId,
    canonicalLeadId,
    lead.status_id || null,
    toStatus.id,
    validActorId,
    params.note || null,
    now
  );

  db.prepare(`
    INSERT INTO lead_activities (id, business_id, lead_id, actor_user_id, activity_type, description_ar, description_en, metadata_json, created_at)
    VALUES (?, ?, ?, ?, 'status_changed', ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    params.businessId,
    canonicalLeadId,
    validActorId,
    `تم تغيير الحالة من "${fromStatus?.name_ar || '—'}" إلى "${toStatus.name_ar}"`,
    `Status changed from "${fromStatus?.name_en || '—'}" to "${toStatus.name_en}"`,
    JSON.stringify({ fromStatusId: lead.status_id, toStatusId: toStatus.id, note: params.note || null }),
    now
  );

  if (toStatus.is_converted) {
    createAndBroadcastNotification(db, {
      businessId: params.businessId,
      userId: lead.assigned_to_user_id || null,
      type: 'lead_converted',
      titleAr: `تحويل عميل ناجح: ${lead.full_name}`,
      titleEn: `Lead Converted: ${lead.full_name}`,
      messageAr: `تم تحويل العميل ${lead.full_name} (${lead.lead_code}) بنجاح`,
      messageEn: `${lead.full_name} (${lead.lead_code}) has been converted`,
      linkPath: `/leads/${canonicalLeadId}`,
      leadId: canonicalLeadId,
      createdAt: now,
    });
  } else {
    createAndBroadcastNotification(db, {
      businessId: params.businessId,
      userId: lead.assigned_to_user_id || null,
      type: 'status_changed',
      titleAr: `تحديث حالة: ${lead.full_name}`,
      titleEn: `Stage Updated: ${lead.full_name}`,
      messageAr: `تم تغيير المرحلة من "${fromStatus?.name_ar || '—'}" إلى "${toStatus.name_ar}" (${lead.lead_code})`,
      messageEn: `Moved from "${fromStatus?.name_en || '—'}" to "${toStatus.name_en}" (${lead.lead_code})`,
      linkPath: `/leads/${canonicalLeadId}`,
      leadId: canonicalLeadId,
      createdAt: now,
    });
  }

  return resolveLeadRecord(db, params.businessId, canonicalLeadId);
}
