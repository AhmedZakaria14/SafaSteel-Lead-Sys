import crypto from 'node:crypto';
import { SqlDb } from '../db.ts';
import { broadcastWorkspaceEvent } from './realtimeService.ts';

export interface NotificationPayload {
  businessId: string;
  userId?: string | null;
  type: string;
  titleAr: string;
  titleEn: string;
  messageAr: string;
  messageEn: string;
  linkPath: string;
  leadId?: string | null;
  createdAt?: string;
}

export function createAndBroadcastNotification(db: SqlDb, params: NotificationPayload) {
  const id = crypto.randomUUID();
  const createdAt = params.createdAt || new Date().toISOString();

  db.prepare(`
    INSERT INTO notifications (id, business_id, user_id, type, title_ar, title_en, message_ar, message_en, link_path, is_read, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
  `).run(
    id,
    params.businessId,
    params.userId ?? null,
    params.type,
    params.titleAr,
    params.titleEn,
    params.messageAr,
    params.messageEn,
    params.linkPath,
    createdAt
  );

  const notification = {
    id,
    business_id: params.businessId,
    user_id: params.userId ?? null,
    type: params.type,
    title_ar: params.titleAr,
    title_en: params.titleEn,
    message_ar: params.messageAr,
    message_en: params.messageEn,
    link_path: params.linkPath,
    is_read: 0,
    created_at: createdAt,
  };

  broadcastWorkspaceEvent(params.businessId, 'notification', {
    notification,
    leadId: params.leadId || null,
  });

  return notification;
}
