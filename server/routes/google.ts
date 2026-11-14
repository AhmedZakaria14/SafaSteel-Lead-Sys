import { Router } from 'express';
import crypto from 'node:crypto';
import { SqlDb } from '../db.ts';
import { AuthRequest, requireBusinessAccess, writeAuditLog } from '../auth.ts';
import { broadcastWorkspaceEvent, syncSheetRowsToWorkspace } from '../services/sheetSyncService.ts';
import { createAndBroadcastNotification } from '../services/notificationService.ts';

function getGoogleToken(req: AuthRequest): string | null {
  const token = req.headers['x-google-access-token'];
  if (!token || typeof token !== 'string' || !token.trim()) return null;
  return token.trim();
}

export function createGoogleRoutes(db: SqlDb, authMiddleware: any) {
  const router = Router();

  // List Google Drive files (Spreadsheets or Google Docs)
  router.get(
    '/businesses/:businessId/google/drive-files',
    authMiddleware,
    requireBusinessAccess(db, ['super_admin', 'business_admin', 'manager', 'employee']),
    async (req: AuthRequest, res) => {
      const accessToken = getGoogleToken(req);
      if (!accessToken) {
        return res.status(401).json({ error: 'Google Workspace authorization required. Please sign in with Google.' });
      }

      const type = req.query.type === 'docs' ? 'application/vnd.google-apps.document' : 'application/vnd.google-apps.spreadsheet';
      const search = typeof req.query.q === 'string' ? req.query.q.trim() : '';
      let query = `mimeType='${type}' and trashed=false`;
      if (search) {
        query += ` and name contains '${search.replace(/'/g, "\\'")}'`;
      }

      try {
        const driveUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,modifiedTime,webViewLink)&orderBy=modifiedTime desc&pageSize=25`;
        const driveRes = await fetch(driveUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const data = (await driveRes.json()) as any;
        if (!driveRes.ok || data.error) {
          return res.status(driveRes.status || 502).json({
            error: data?.error?.message || 'Failed to fetch Google Drive files',
          });
        }
        res.json({ files: data.files || [] });
      } catch (err: any) {
        res.status(502).json({ error: err.message });
      }
    }
  );

  // Get Google Spreadsheet metadata & dynamic worksheet tab names (never hardcoded)
  router.get(
    '/businesses/:businessId/google/sheets/:spreadsheetId/metadata',
    authMiddleware,
    requireBusinessAccess(db, ['super_admin', 'business_admin', 'manager']),
    async (req: AuthRequest, res) => {
      const accessToken = getGoogleToken(req);
      if (!accessToken) {
        return res.status(401).json({ error: 'Google Workspace authorization required' });
      }

      try {
        const { spreadsheetId } = req.params;
        const metaRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?includeGridData=false`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const data = (await metaRes.json()) as any;
        if (!metaRes.ok || data.error) {
          return res.status(metaRes.status || 502).json({ error: data?.error?.message || 'Failed to load spreadsheet' });
        }

        const sheets = (data.sheets || []).map((s: any) => ({
          sheetId: s.properties?.sheetId,
          title: s.properties?.title,
          rowCount: s.properties?.gridProperties?.rowCount,
        }));

        res.json({
          spreadsheetId: data.spreadsheetId,
          title: data.properties?.title || 'Untitled Spreadsheet',
          spreadsheetUrl: data.spreadsheetUrl,
          sheets,
        });
      } catch (err: any) {
        res.status(502).json({ error: err.message });
      }
    }
  );

  // Fetch header row from selected worksheet tab
  router.get(
    '/businesses/:businessId/google/sheets/:spreadsheetId/headers',
    authMiddleware,
    requireBusinessAccess(db, ['super_admin', 'business_admin', 'manager']),
    async (req: AuthRequest, res) => {
      const accessToken = getGoogleToken(req);
      if (!accessToken) {
        return res.status(401).json({ error: 'Google Workspace authorization required' });
      }

      const sheetTitle = String(req.query.sheetTitle || '');
      if (!sheetTitle) {
        return res.status(400).json({ error: 'sheetTitle query param is required' });
      }

      try {
        const range = `'${sheetTitle.replace(/'/g, "''")}'!1:1`;
        const valuesRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(req.params.spreadsheetId)}/values/${encodeURIComponent(range)}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const data = (await valuesRes.json()) as any;
        if (!valuesRes.ok || data.error) {
          return res.status(valuesRes.status || 502).json({ error: data?.error?.message || 'Failed to read headers' });
        }

        const headers = Array.isArray(data.values?.[0]) ? data.values[0] : [];
        res.json({ headers });
      } catch (err: any) {
        res.status(502).json({ error: err.message });
      }
    }
  );

  // Save Google Sheets integration config (Mode A or Mode B)
  router.post(
    '/businesses/:businessId/google/sheets/config',
    authMiddleware,
    requireBusinessAccess(db, ['super_admin', 'business_admin']),
    (req: AuthRequest, res) => {
      const { businessId } = req.params;
      const {
        spreadsheetId,
        spreadsheetName,
        sheetTitle,
        mode,
        conflictPolicy,
        columnMapping,
        syncNotes,
        autoScheduled,
        syncIntervalSec,
      } = req.body || {};

      if (!spreadsheetId || !sheetTitle) {
        return res.status(400).json({ error: 'spreadsheetId and sheetTitle are required' });
      }

      const now = new Date().toISOString();
      const existing = db
        .prepare("SELECT id, config_json FROM integrations WHERE business_id = ? AND provider = 'google_sheets'")
        .get(businessId) as { id: string; config_json: string } | undefined;
      const integrationId = existing?.id || crypto.randomUUID();
      const prevCfg = existing ? JSON.parse(existing.config_json || '{}') : {};

      const config = {
        ...prevCfg,
        spreadsheetId,
        spreadsheetName: spreadsheetName || spreadsheetId,
        sheetTitle,
        mode: mode === 'A' ? 'A' : 'B',
        conflictPolicy: ['crm_wins', 'sheet_wins', 'newest_wins'].includes(conflictPolicy) ? conflictPolicy : 'sheet_wins',
        columnMapping: columnMapping || {},
        syncNotes: Boolean(syncNotes),
        autoScheduled: autoScheduled !== undefined ? Boolean(autoScheduled) : true,
        syncIntervalSec: Math.max(5, Math.min(300, Number(syncIntervalSec || prevCfg.syncIntervalSec || 15))),
      };

      db.prepare(`
        INSERT INTO integrations (id, business_id, provider, status, display_name, config_json, last_error, created_at, updated_at)
        VALUES (?, ?, 'google_sheets', 'connected', ?, ?, NULL, ?, ?)
        ON CONFLICT(business_id, provider) DO UPDATE SET
          status = 'connected',
          display_name = excluded.display_name,
          config_json = excluded.config_json,
          last_error = NULL,
          updated_at = excluded.updated_at
      `).run(integrationId, businessId, `Google Sheets — ${spreadsheetName || sheetTitle}`, JSON.stringify(config), now, now);

      writeAuditLog(db, {
        businessId,
        actorUserId: req.authUser?.id,
        action: 'google_sheets_configured',
        entityType: 'integration',
        entityId: integrationId,
        details: { spreadsheetId, sheetTitle, mode: config.mode },
        ipAddress: req.ip,
      });

      res.json({ status: 'connected', config });
    }
  );

  // Execute real Google Sheets Sync (Import / Export / Bidirectional)
  router.post(
    '/businesses/:businessId/google/sheets/sync',
    authMiddleware,
    requireBusinessAccess(db, ['super_admin', 'business_admin', 'manager']),
    async (req: AuthRequest, res) => {
      const { businessId } = req.params;
      const accessToken = getGoogleToken(req);
      if (!accessToken) {
        return res.status(401).json({ error: 'Google Workspace authorization required. Sign in with Google first.' });
      }

      const integration = db
        .prepare("SELECT * FROM integrations WHERE business_id = ? AND provider = 'google_sheets'")
        .get(businessId) as any;
      if (!integration) {
        return res.status(400).json({ error: 'Google Sheets integration not configured' });
      }

      const config = JSON.parse(integration.config_json || '{}');
      const { spreadsheetId, sheetTitle, mode = 'B', conflictPolicy = 'crm_wins', columnMapping = {} } = config;
      if (!spreadsheetId || !sheetTitle) {
        return res.status(400).json({ error: 'Spreadsheet & worksheet selection missing' });
      }

      const direction: 'inbound' | 'outbound' | 'bidirectional' = req.body?.direction || (mode === 'A' ? 'inbound' : 'bidirectional');
      const startedAt = new Date().toISOString();

      try {
        const range = `'${sheetTitle.replace(/'/g, "''")}'!A1:Z5000`;
        const sheetRes = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        const sheetData = (await sheetRes.json()) as any;
        if (!sheetRes.ok || sheetData.error) {
          throw new Error(sheetData?.error?.message || 'Failed to read Google Sheet');
        }

        const rows: string[][] = Array.isArray(sheetData.values) ? sheetData.values : [];
        let createdCount = 0;
        let updatedCount = 0;
        let skippedCount = 0;
        const conflicts: Array<{ leadId: string; reason: string }> = [];

        // Inbound: import/upsert rows from Google Sheet -> CRM using smart header & Arabic Meta Lead mapping
        if (direction === 'inbound' || direction === 'bidirectional') {
          const syncRes = syncSheetRowsToWorkspace(db, {
            businessId,
            rows,
            sourceLabel: `google_sheets:${spreadsheetId}`,
            conflictPolicy,
            columnMapping,
            actorUserId: req.authUser?.id || null,
            recordSyncLog: false,
            emitNotificationOnChanges: true,
          });
          createdCount += syncRes.createdCount;
          updatedCount += syncRes.updatedCount;
          skippedCount += syncRes.skippedCount;
        }

        // Outbound: push CRM leads -> Google Sheet (Mode B primary export/sync)
        if (direction === 'outbound' || direction === 'bidirectional') {
          const leads = db
            .prepare(`
              SELECT l.*, s.name_en as status_en, s.name_ar as status_ar, u.full_name as assigned_name
              FROM leads l
              LEFT JOIN lead_statuses s ON s.id = l.status_id
              LEFT JOIN users u ON u.id = l.assigned_to_user_id
              WHERE l.business_id = ?
              ORDER BY l.created_at DESC
              LIMIT 2000
            `)
            .all(businessId) as any[];

          const exportHeaders = [
            'crm_external_id',
            'lead_code',
            'full_name',
            'phone',
            'email',
            'interested_service',
            'status',
            'assigned_employee',
            'source',
            'campaign_name',
            'notes',
            'created_at',
            'updated_at',
          ];

          const exportRows = [
            exportHeaders,
            ...leads.map((l) => [
              l.external_row_id || l.id,
              l.lead_code || '',
              l.full_name || '',
              l.phone_e164 || l.phone || '',
              l.email || '',
              l.interested_service || '',
              l.status_en || '',
              l.assigned_name || '',
              l.source || '',
              l.campaign_name || '',
              config.syncNotes ? l.notes_summary || '' : '',
              l.created_at || '',
              l.updated_at || '',
            ]),
          ];

          const updateRange = `'${sheetTitle.replace(/'/g, "''")}'!A1`;
          const writeRes = await fetch(
            `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(updateRange)}?valueInputOption=USER_ENTERED`,
            {
              method: 'PUT',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ values: exportRows }),
            }
          );
          const writeJson = (await writeRes.json()) as any;
          if (!writeRes.ok || writeJson.error) {
            throw new Error(writeJson?.error?.message || 'Failed to write to Google Sheet');
          }
          updatedCount += leads.length;
        }

        const finishedAt = new Date().toISOString();
        const isManual = req.body?.silent !== true;
        if (isManual || createdCount > 0 || updatedCount > 0) {
          db.prepare(`
            INSERT INTO sync_logs (id, business_id, integration_id, direction, mode, status, processed_count, created_count, updated_count, skipped_count, details_json, started_at, finished_at)
            VALUES (?, ?, ?, ?, ?, 'success', ?, ?, ?, ?, ?, ?, ?)
          `).run(
            crypto.randomUUID(),
            businessId,
            integration.id,
            direction,
            `mode_${mode}`,
            createdCount + updatedCount + skippedCount,
            createdCount,
            updatedCount,
            skippedCount,
            JSON.stringify({ conflictsCount: conflicts.length }),
            startedAt,
            finishedAt
          );
        }

        db.prepare('UPDATE integrations SET status = ?, last_sync_at = ?, last_error = NULL, updated_at = ? WHERE id = ?').run(
          'connected',
          finishedAt,
          finishedAt,
          integration.id
        );

        if (createdCount > 0) {
          broadcastWorkspaceEvent(businessId, 'sheet_synced', {
            businessId,
            createdCount,
            updatedCount,
            skippedCount,
            syncedAt: finishedAt,
            sourceLabel: 'google_sheets_api',
          });
        }

        res.json({ status: 'success', createdCount, updatedCount, skippedCount, conflicts, syncedAt: finishedAt });
      } catch (err: any) {
        const finishedAt = new Date().toISOString();
        db.prepare(`
          INSERT INTO sync_logs (id, business_id, integration_id, direction, mode, status, processed_count, created_count, updated_count, skipped_count, error_message, details_json, started_at, finished_at)
          VALUES (?, ?, ?, ?, ?, 'failed', 0, 0, 0, 0, ?, '{}', ?, ?)
        `).run(crypto.randomUUID(), businessId, integration.id, direction, `mode_${mode}`, err.message, startedAt, finishedAt);

        db.prepare('UPDATE integrations SET status = ?, last_error = ?, updated_at = ? WHERE id = ?').run(
          'error',
          err.message,
          finishedAt,
          integration.id
        );

        res.status(502).json({ error: err.message });
      }
    }
  );

  // Create a Lead Brief / Proposal in Google Docs via Docs API
  router.post(
    '/businesses/:businessId/leads/:leadId/google-doc',
    authMiddleware,
    requireBusinessAccess(db, ['super_admin', 'business_admin', 'manager', 'employee']),
    async (req: AuthRequest, res) => {
      const accessToken = getGoogleToken(req);
      if (!accessToken) {
        return res.status(401).json({ error: 'Google Workspace authorization required. Sign in with Google first.' });
      }

      const { businessId, leadId } = req.params;
      const lead = db
        .prepare(`
          SELECT l.*, s.name_en as status_en, s.name_ar as status_ar, b.name as business_name
          FROM leads l
          LEFT JOIN lead_statuses s ON s.id = l.status_id
          LEFT JOIN businesses b ON b.id = l.business_id
          WHERE l.id = ? AND l.business_id = ?
        `)
        .get(leadId, businessId) as any;

      if (!lead) {
        return res.status(404).json({ error: 'Lead not found' });
      }

      if (req.membership?.role === 'employee' && lead.assigned_to_user_id !== req.authUser?.id) {
        return res.status(403).json({ error: 'Forbidden: Not assigned to this lead' });
      }

      try {
        const title = `${lead.business_name} — ${lead.full_name} (${lead.lead_code})`;
        const createRes = await fetch('https://docs.googleapis.com/v1/documents', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ title }),
        });
        const docJson = (await createRes.json()) as any;
        if (!createRes.ok || docJson.error) {
          throw new Error(docJson?.error?.message || 'Failed to create Google Doc');
        }

        const documentId = docJson.documentId;
        const answers = JSON.parse(lead.original_answers_json || '{}');
        const customVals = JSON.parse(lead.custom_values_json || '{}');

        const contentLines = [
          `LeadFlow CRM — Customer Brief (${lead.lead_code})`,
          `Business: ${lead.business_name}`,
          `Customer Name: ${lead.full_name}`,
          `Phone: ${lead.phone_e164 || lead.phone || '—'}`,
          `Email: ${lead.email || '—'}`,
          `Interested Service/Product: ${lead.interested_service || '—'}`,
          `Current Stage: ${lead.status_en || '—'} / ${lead.status_ar || '—'}`,
          `Source: ${lead.source}`,
          `Campaign: ${lead.campaign_name || '—'} | Ad Set: ${lead.ad_set_name || '—'} | Ad: ${lead.ad_name || '—'}`,
          '',
          'Original Submitted Answers:',
          ...Object.entries(answers).map(([k, v]) => `- ${k}: ${v}`),
          '',
          'Custom Fields:',
          ...Object.entries(customVals).map(([k, v]) => `- ${k}: ${v}`),
          '',
          `Notes Summary: ${req.body?.customNote || lead.notes_summary || '—'}`,
        ].join('\n');

        await fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            requests: [
              {
                insertText: {
                  location: { index: 1 },
                  text: contentLines,
                },
              },
            ],
          }),
        });

        const docUrl = `https://docs.google.com/document/d/${documentId}/edit`;
        const now = new Date().toISOString();
        db.prepare(`
          INSERT INTO lead_activities (id, business_id, lead_id, actor_user_id, activity_type, description_ar, description_en, metadata_json, created_at)
          VALUES (?, ?, ?, ?, 'google_doc_created', ?, ?, ?, ?)
        `).run(
          crypto.randomUUID(),
          businessId,
          leadId,
          req.authUser?.id || null,
          `تم إنشاء ملف عميل في مستندات جوجل`,
          `Created Google Doc customer brief`,
          JSON.stringify({ documentId, docUrl }),
          now
        );

        createAndBroadcastNotification(db, {
          businessId,
          userId: lead.assigned_to_user_id || null,
          type: 'google_doc_created',
          titleAr: `مستند جوجل جاهز: ${lead.full_name}`,
          titleEn: `Google Doc Ready: ${lead.full_name}`,
          messageAr: `تم إنشاء ملف العميل ${lead.lead_code} في Google Docs`,
          messageEn: `Created brief for ${lead.lead_code} in Google Docs`,
          linkPath: `/leads/${leadId}`,
          leadId,
          createdAt: now,
        });
        broadcastWorkspaceEvent(businessId, 'lead_updated', { businessId, leadId });

        res.json({ documentId, title, docUrl });
      } catch (err: any) {
        res.status(502).json({ error: err.message });
      }
    }
  );

  return router;
}
