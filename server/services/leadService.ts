import crypto from 'node:crypto';
import { SqlDb, generateLeadCode, normalizePhoneE164 } from '../db.ts';
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

  let statusId = input.statusId;
  if (!statusId) {
    const defaultStage = db
      .prepare('SELECT id FROM lead_statuses WHERE business_id = ? ORDER BY is_default DESC, sort_order ASC LIMIT 1')
      .get(input.businessId) as { id: string } | undefined;
    statusId = defaultStage?.id || null;
  }

  let assignedTo = input.assignedToUserId ?? null;
  if (!assignedTo) {
    assignedTo = pickNextRoundRobinEmployee(db, input.businessId);
  }

  const now = input.createdAt || new Date().toISOString();
  const leadId = crypto.randomUUID();
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
    input.actorUserId || null,
    `تم تسجيل عميل محتمل جديد (${input.fullName.trim()}) عبر ${input.source || 'manual'}`,
    `New lead captured (${input.fullName.trim()}) via ${input.source || 'manual'}`,
    JSON.stringify({ source: input.source || 'manual', leadCode }),
    now
  );

  if (input.notesSummary) {
    db.prepare(`
      INSERT INTO lead_notes (id, business_id, lead_id, author_user_id, content, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(crypto.randomUUID(), input.businessId, leadId, input.actorUserId || null, input.notesSummary, now);
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
  }
) {
  const lead = db
    .prepare('SELECT * FROM leads WHERE id = ? AND business_id = ?')
    .get(params.leadId, params.businessId) as any;
  if (!lead) throw new Error('Lead not found');

  const toStatus = db
    .prepare('SELECT * FROM lead_statuses WHERE id = ? AND business_id = ?')
    .get(params.toStatusId, params.businessId) as any;
  if (!toStatus) throw new Error('Target pipeline stage not found');

  const fromStatus = lead.status_id
    ? (db.prepare('SELECT * FROM lead_statuses WHERE id = ?').get(lead.status_id) as any)
    : null;

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
  `).run(params.toStatusId, now, now, params.actorUserId || null, now, params.leadId, params.businessId);

  db.prepare(`
    INSERT INTO lead_status_history (id, business_id, lead_id, from_status_id, to_status_id, changed_by_user_id, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    params.businessId,
    params.leadId,
    lead.status_id || null,
    params.toStatusId,
    params.actorUserId || null,
    params.note || null,
    now
  );

  db.prepare(`
    INSERT INTO lead_activities (id, business_id, lead_id, actor_user_id, activity_type, description_ar, description_en, metadata_json, created_at)
    VALUES (?, ?, ?, ?, 'status_changed', ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(),
    params.businessId,
    params.leadId,
    params.actorUserId || null,
    `تم تغيير الحالة من "${fromStatus?.name_ar || '—'}" إلى "${toStatus.name_ar}"`,
    `Status changed from "${fromStatus?.name_en || '—'}" to "${toStatus.name_en}"`,
    JSON.stringify({ fromStatusId: lead.status_id, toStatusId: params.toStatusId, note: params.note || null }),
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
      linkPath: `/leads/${lead.id}`,
      leadId: lead.id,
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
      linkPath: `/leads/${lead.id}`,
      leadId: lead.id,
      createdAt: now,
    });
  }

  return db.prepare('SELECT * FROM leads WHERE id = ?').get(params.leadId);
}
