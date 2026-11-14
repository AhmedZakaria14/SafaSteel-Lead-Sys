import { Router } from 'express';
import crypto from 'node:crypto';
import { SqlDb } from '../db.ts';
import { encryptSecret, decryptSecret, verifyMetaSignature } from '../crypto.ts';
import { AuthRequest, requireBusinessAccess, writeAuditLog } from '../auth.ts';
import { createLeadRecord } from '../services/leadService.ts';
import { broadcastWorkspaceEvent } from '../services/realtimeService.ts';
import { createAndBroadcastNotification } from '../services/notificationService.ts';

const GRAPH_VERSION = 'v21.0';

function parseFieldData(fieldData: Array<{ name: string; values: string[] }> = []) {
  const answers: Record<string, string> = {};
  for (const item of fieldData) {
    answers[item.name] = Array.isArray(item.values) ? item.values.join(', ') : String(item.values || '');
  }
  const fullName =
    answers.full_name ||
    answers.name ||
    [answers.first_name, answers.last_name].filter(Boolean).join(' ') ||
    'Meta Lead';
  const phone = answers.phone_number || answers.phone || answers.mobile || '';
  const email = answers.email || answers.work_email || '';
  const interestedService = answers.interested_service || answers.service || answers.product || '';
  return { fullName, phone, email, interestedService, answers };
}

export function createMetaRoutes(db: SqlDb, authMiddleware: any) {
  const router = Router();

  // Connect Meta Graph API token — strictly verifies with a real Graph API request before marking connected
  router.post(
    '/businesses/:businessId/integrations/meta/connect',
    authMiddleware,
    requireBusinessAccess(db, ['super_admin', 'business_admin']),
    async (req: AuthRequest, res) => {
      const { businessId } = req.params;
      const { accessToken, appSecret, verifyToken } = req.body || {};

      if (!accessToken || typeof accessToken !== 'string') {
        return res.status(400).json({ error: 'Meta Access Token is required' });
      }

      try {
        const graphRes = await fetch(
          `https://graph.facebook.com/${GRAPH_VERSION}/me/accounts?fields=id,name,tasks&access_token=${encodeURIComponent(accessToken.trim())}`
        );
        const graphData = (await graphRes.json()) as any;

        if (!graphRes.ok || graphData.error) {
          const message = graphData?.error?.message || 'Meta Graph API authentication failed';
          const now = new Date().toISOString();
          db.prepare(`
            INSERT INTO integrations (id, business_id, provider, status, display_name, config_json, last_error, created_at, updated_at)
            VALUES (?, ?, 'meta', 'error', 'Meta Lead Ads', '{}', ?, ?, ?)
            ON CONFLICT(business_id, provider) DO UPDATE SET status = 'error', last_error = excluded.last_error, updated_at = excluded.updated_at
          `).run(crypto.randomUUID(), businessId, message, now, now);

          return res.status(400).json({ error: `Meta Graph API verification failed: ${message}` });
        }

        const pages = Array.isArray(graphData.data) ? graphData.data : [];
        const now = new Date().toISOString();
        const existing = db
          .prepare("SELECT id, config_json FROM integrations WHERE business_id = ? AND provider = 'meta'")
          .get(businessId) as { id: string; config_json: string } | undefined;

        const integrationId = existing?.id || crypto.randomUUID();
        const prevConfig = existing ? JSON.parse(existing.config_json || '{}') : {};
        const newConfig = {
          ...prevConfig,
          pagesCount: pages.length,
          verifyToken: verifyToken?.trim() || prevConfig.verifyToken || crypto.randomBytes(12).toString('hex'),
          connectedAt: now,
        };

        db.prepare(`
          INSERT INTO integrations (id, business_id, provider, status, display_name, config_json, last_error, created_at, updated_at)
          VALUES (?, ?, 'meta', 'connected', 'Meta Lead Ads', ?, NULL, ?, ?)
          ON CONFLICT(business_id, provider) DO UPDATE SET
            status = 'connected',
            config_json = excluded.config_json,
            last_error = NULL,
            updated_at = excluded.updated_at
        `).run(integrationId, businessId, JSON.stringify(newConfig), now, now);

        const encrypted = encryptSecret(
          JSON.stringify({
            accessToken: accessToken.trim(),
            appSecret: appSecret?.trim() || '',
          })
        );

        db.prepare(`
          INSERT INTO integration_credentials (id, integration_id, encrypted_payload, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(integration_id) DO UPDATE SET encrypted_payload = excluded.encrypted_payload, updated_at = excluded.updated_at
        `).run(crypto.randomUUID(), integrationId, encrypted, now);

        writeAuditLog(db, {
          businessId,
          actorUserId: req.authUser?.id,
          action: 'meta_integration_connected',
          entityType: 'integration',
          entityId: integrationId,
          details: { pagesCount: pages.length },
          ipAddress: req.ip,
        });

        res.json({ status: 'connected', pages, config: newConfig });
      } catch (err: any) {
        return res.status(502).json({ error: `Unable to reach Meta Graph API: ${err.message}` });
      }
    }
  );

  // List authorized Pages & Lead Forms from Meta Graph API
  router.get(
    '/businesses/:businessId/integrations/meta/pages',
    authMiddleware,
    requireBusinessAccess(db, ['super_admin', 'business_admin', 'manager']),
    async (req: AuthRequest, res) => {
      const { businessId } = req.params;
      const integration = db
        .prepare("SELECT * FROM integrations WHERE business_id = ? AND provider = 'meta'")
        .get(businessId) as any;

      if (!integration || integration.status !== 'connected') {
        return res.status(400).json({ error: 'Meta integration is not connected yet' });
      }

      const cred = db
        .prepare('SELECT encrypted_payload FROM integration_credentials WHERE integration_id = ?')
        .get(integration.id) as { encrypted_payload: string } | undefined;

      if (!cred) {
        return res.status(400).json({ error: 'Meta credentials missing. Please reconnect.' });
      }

      try {
        const { accessToken } = JSON.parse(decryptSecret(cred.encrypted_payload));
        const pagesRes = await fetch(
          `https://graph.facebook.com/${GRAPH_VERSION}/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(accessToken)}`
        );
        const pagesJson = (await pagesRes.json()) as any;
        if (!pagesRes.ok || pagesJson.error) {
          throw new Error(pagesJson?.error?.message || 'Token expired or permissions revoked');
        }

        const pagesWithForms = await Promise.all(
          (pagesJson.data || []).map(async (page: any) => {
            const pageToken = page.access_token || accessToken;
            const formsRes = await fetch(
              `https://graph.facebook.com/${GRAPH_VERSION}/${page.id}/leadgen_forms?fields=id,name,status,leads_count&access_token=${encodeURIComponent(pageToken)}`
            );
            const formsJson = (await formsRes.json()) as any;
            return {
              id: page.id,
              name: page.name,
              forms: Array.isArray(formsJson.data) ? formsJson.data : [],
            };
          })
        );

        res.json({ pages: pagesWithForms });
      } catch (err: any) {
        db.prepare('UPDATE integrations SET status = ?, last_error = ?, updated_at = ? WHERE id = ?').run(
          'error',
          err.message,
          new Date().toISOString(),
          integration.id
        );
        res.status(502).json({ error: err.message });
      }
    }
  );

  // Save Page/Form to Business mapping & webhook config
  router.put(
    '/businesses/:businessId/integrations/meta/mappings',
    authMiddleware,
    requireBusinessAccess(db, ['super_admin', 'business_admin']),
    (req: AuthRequest, res) => {
      const { businessId } = req.params;
      const { mappedForms, verifyToken, autoSyncSheets, appSecret } = req.body || {};
      const now = new Date().toISOString();

      const existing = db
        .prepare("SELECT * FROM integrations WHERE business_id = ? AND provider = 'meta'")
        .get(businessId) as any;

      const integrationId = existing?.id || crypto.randomUUID();
      const prevConfig = existing ? JSON.parse(existing.config_json || '{}') : {};
      const newConfig = {
        ...prevConfig,
        mappedForms: Array.isArray(mappedForms) ? mappedForms : prevConfig.mappedForms || [],
        verifyToken: verifyToken?.trim() || prevConfig.verifyToken || crypto.randomBytes(12).toString('hex'),
        autoSyncSheets: Boolean(autoSyncSheets),
      };

      db.prepare(`
        INSERT INTO integrations (id, business_id, provider, status, display_name, config_json, created_at, updated_at)
        VALUES (?, ?, 'meta', ?, 'Meta Lead Ads', ?, ?, ?)
        ON CONFLICT(business_id, provider) DO UPDATE SET config_json = excluded.config_json, updated_at = excluded.updated_at
      `).run(integrationId, businessId, existing?.status || 'pending_config', JSON.stringify(newConfig), now, now);

      if (appSecret && typeof appSecret === 'string' && appSecret.trim()) {
        const cred = db
          .prepare('SELECT encrypted_payload FROM integration_credentials WHERE integration_id = ?')
          .get(integrationId) as { encrypted_payload: string } | undefined;
        const current = cred ? JSON.parse(decryptSecret(cred.encrypted_payload)) : {};
        current.appSecret = appSecret.trim();
        db.prepare(`
          INSERT INTO integration_credentials (id, integration_id, encrypted_payload, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(integration_id) DO UPDATE SET encrypted_payload = excluded.encrypted_payload, updated_at = excluded.updated_at
        `).run(crypto.randomUUID(), integrationId, encryptSecret(JSON.stringify(current)), now);
      }

      res.json({ config: newConfig });
    }
  );

  // Pull leads from a Meta Leadgen Form via Graph API
  router.post(
    '/businesses/:businessId/integrations/meta/sync-form',
    authMiddleware,
    requireBusinessAccess(db, ['super_admin', 'business_admin', 'manager']),
    async (req: AuthRequest, res) => {
      const { businessId } = req.params;
      const { formId, formName, pageId } = req.body || {};

      if (!formId) {
        return res.status(400).json({ error: 'formId is required' });
      }

      const integration = db
        .prepare("SELECT * FROM integrations WHERE business_id = ? AND provider = 'meta'")
        .get(businessId) as any;

      if (!integration || integration.status !== 'connected') {
        return res.status(400).json({ error: 'Meta integration must be connected first' });
      }

      const cred = db
        .prepare('SELECT encrypted_payload FROM integration_credentials WHERE integration_id = ?')
        .get(integration.id) as { encrypted_payload: string } | undefined;

      if (!cred) {
        return res.status(400).json({ error: 'Credentials missing' });
      }

      const startedAt = new Date().toISOString();
      try {
        const { accessToken } = JSON.parse(decryptSecret(cred.encrypted_payload));
        const url = `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(formId)}/leads?fields=id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id&limit=100&access_token=${encodeURIComponent(accessToken)}`;
        const graphRes = await fetch(url);
        const graphJson = (await graphRes.json()) as any;

        if (!graphRes.ok || graphJson.error) {
          throw new Error(graphJson?.error?.message || 'Failed to retrieve Meta leads');
        }

        const items = Array.isArray(graphJson.data) ? graphJson.data : [];
        let createdCount = 0;
        let skippedCount = 0;

        for (const item of items) {
          const parsed = parseFieldData(item.field_data);
          const result = createLeadRecord(db, {
            businessId,
            fullName: parsed.fullName,
            phone: parsed.phone,
            email: parsed.email,
            interestedService: parsed.interestedService,
            source: 'meta_lead_ads',
            campaignId: item.campaign_id,
            campaignName: item.campaign_name,
            adSetId: item.adset_id,
            adSetName: item.adset_name,
            adId: item.ad_id,
            adName: item.ad_name,
            formId: item.form_id || formId,
            formName: formName || null,
            pageId: pageId || null,
            metaLeadgenId: item.id,
            originalAnswers: parsed.answers,
            createdAt: item.created_time || startedAt,
            actorUserId: req.authUser?.id,
          });
          if (result.deduplicated) skippedCount += 1;
          else createdCount += 1;
        }

        const finishedAt = new Date().toISOString();
        db.prepare(`
          INSERT INTO sync_logs (id, business_id, integration_id, direction, mode, status, processed_count, created_count, updated_count, skipped_count, details_json, started_at, finished_at)
          VALUES (?, ?, ?, 'inbound', 'meta_graph_pull', 'success', ?, ?, 0, ?, ?, ?, ?)
        `).run(
          crypto.randomUUID(),
          businessId,
          integration.id,
          items.length,
          createdCount,
          skippedCount,
          JSON.stringify({ formId }),
          startedAt,
          finishedAt
        );

        db.prepare('UPDATE integrations SET last_sync_at = ?, last_error = NULL, updated_at = ? WHERE id = ?').run(
          finishedAt,
          finishedAt,
          integration.id
        );

        if (createdCount > 0) {
          broadcastWorkspaceEvent(businessId, 'lead_updated', { businessId, createdCount });
        }
        res.json({ processed: items.length, created: createdCount, skipped: skippedCount });
      } catch (err: any) {
        const finishedAt = new Date().toISOString();
        db.prepare(`
          INSERT INTO sync_logs (id, business_id, integration_id, direction, mode, status, processed_count, created_count, updated_count, skipped_count, error_message, details_json, started_at, finished_at)
          VALUES (?, ?, ?, 'inbound', 'meta_graph_pull', 'failed', 0, 0, 0, 0, ?, ?, ?, ?)
        `).run(
          crypto.randomUUID(),
          businessId,
          integration.id,
          err.message,
          JSON.stringify({ formId }),
          startedAt,
          finishedAt
        );
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

  // Retry failed Meta webhook/sync entries
  router.post(
    '/businesses/:businessId/integrations/meta/retry-failed',
    authMiddleware,
    requireBusinessAccess(db, ['super_admin', 'business_admin', 'manager']),
    async (req: AuthRequest, res) => {
      const { businessId } = req.params;
      const failedLogs = db
        .prepare(
          `SELECT * FROM sync_logs WHERE business_id = ? AND status = 'failed' ORDER BY started_at DESC LIMIT 20`
        )
        .all(businessId) as any[];

      const integration = db
        .prepare("SELECT * FROM integrations WHERE business_id = ? AND provider = 'meta'")
        .get(businessId) as any;

      if (!integration) {
        return res.status(400).json({ error: 'Meta integration not configured' });
      }

      const cred = db
        .prepare('SELECT encrypted_payload FROM integration_credentials WHERE integration_id = ?')
        .get(integration.id) as { encrypted_payload: string } | undefined;

      if (!cred) {
        return res.status(400).json({ error: 'Meta credentials missing' });
      }

      const { accessToken } = JSON.parse(decryptSecret(cred.encrypted_payload));
      let retried = 0;
      let resolved = 0;

      for (const log of failedLogs) {
        const details = JSON.parse(log.details_json || '{}');
        if (!details.leadgen_id) continue;
        retried += 1;
        try {
          const graphRes = await fetch(
            `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(details.leadgen_id)}?fields=id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id&access_token=${encodeURIComponent(accessToken)}`
          );
          const item = (await graphRes.json()) as any;
          if (!graphRes.ok || item.error) continue;

          const parsed = parseFieldData(item.field_data);
          createLeadRecord(db, {
            businessId,
            fullName: parsed.fullName,
            phone: parsed.phone,
            email: parsed.email,
            interestedService: parsed.interestedService,
            source: 'meta_lead_ads',
            campaignId: item.campaign_id,
            campaignName: item.campaign_name,
            adSetId: item.adset_id,
            adSetName: item.adset_name,
            adId: item.ad_id,
            adName: item.ad_name,
            formId: item.form_id || details.form_id,
            pageId: details.page_id,
            metaLeadgenId: item.id,
            originalAnswers: parsed.answers,
            createdAt: item.created_time,
          });
          db.prepare("UPDATE sync_logs SET status = 'success', created_count = 1, error_message = NULL, finished_at = ? WHERE id = ?").run(
            new Date().toISOString(),
            log.id
          );
          resolved += 1;
        } catch {
          // Leave as failed if still unreachable
        }
      }

      res.json({ retried, resolved });
    }
  );

  // Disconnect Meta integration
  router.post(
    '/businesses/:businessId/integrations/meta/disconnect',
    authMiddleware,
    requireBusinessAccess(db, ['super_admin', 'business_admin']),
    (req: AuthRequest, res) => {
      const { businessId } = req.params;
      const integration = db
        .prepare("SELECT id FROM integrations WHERE business_id = ? AND provider = 'meta'")
        .get(businessId) as { id: string } | undefined;

      if (integration) {
        db.prepare('DELETE FROM integration_credentials WHERE integration_id = ?').run(integration.id);
        db.prepare("UPDATE integrations SET status = 'disconnected', last_error = NULL, updated_at = ? WHERE id = ?").run(
          new Date().toISOString(),
          integration.id
        );
      }

      res.json({ status: 'disconnected' });
    }
  );

  // Public Meta Webhook Verification (GET /api/webhooks/meta)
  router.get('/webhooks/meta', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode !== 'subscribe' || !token) {
      return res.status(403).send('Forbidden');
    }

    if (process.env.META_WEBHOOK_VERIFY_TOKEN && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
      return res.status(200).send(String(challenge || ''));
    }

    // Check per-business configured verify token
    const integrations = db.prepare("SELECT config_json FROM integrations WHERE provider = 'meta'").all() as Array<{ config_json: string }>;
    const matched = integrations.some((row) => {
      try {
        return JSON.parse(row.config_json || '{}').verifyToken === token;
      } catch {
        return false;
      }
    });

    if (matched) {
      return res.status(200).send(String(challenge || ''));
    }

    return res.status(403).send('Verify token mismatch');
  });

  // Public Meta Webhook Ingestion (POST /api/webhooks/meta)
  router.post('/webhooks/meta', async (req: AuthRequest, res) => {
    const signature = req.headers['x-hub-signature-256'] as string | undefined;
    const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));

    // Find matching business integration and verify HMAC-SHA256 signature
    const metaIntegrations = db
      .prepare(
        `SELECT i.*, ic.encrypted_payload FROM integrations i
         LEFT JOIN integration_credentials ic ON ic.integration_id = i.id
         WHERE i.provider = 'meta'`
      )
      .all() as any[];

    const body = req.body || {};
    const entries = Array.isArray(body.entry) ? body.entry : [];
    const results: Array<{ leadgen_id: string; status: string; businessId?: string }> = [];

    for (const entry of entries) {
      const changes = Array.isArray(entry.changes) ? entry.changes : [];
      for (const change of changes) {
        if (change.field !== 'leadgen') continue;
        const val = change.value || {};
        const leadgenId = val.leadgen_id;
        const pageId = val.page_id || entry.id;
        const formId = val.form_id;

        if (!leadgenId) continue;

        // Locate mapped business for pageId/formId (or explicit targetBusinessId on signed test webhook)
        let targetIntegration = metaIntegrations.find((integ) => {
          const cfg = JSON.parse(integ.config_json || '{}');
          const mappedForms = Array.isArray(cfg.mappedForms) ? cfg.mappedForms : [];
          return mappedForms.some((m: any) => m.formId === formId || m.pageId === pageId);
        });

        if (!targetIntegration && val.business_id) {
          targetIntegration = metaIntegrations.find((integ) => integ.business_id === val.business_id);
        }

        const creds = targetIntegration?.encrypted_payload
          ? JSON.parse(decryptSecret(targetIntegration.encrypted_payload))
          : {};
        const appSecret = creds.appSecret || process.env.META_APP_SECRET || '';

        if (!appSecret || !verifyMetaSignature(rawBody, signature, appSecret)) {
          return res.status(401).json({ error: 'Invalid or missing X-Hub-Signature-256' });
        }

        const businessId = targetIntegration?.business_id || val.business_id;
        if (!businessId) {
          results.push({ leadgen_id: leadgenId, status: 'unmapped_form' });
          continue;
        }

        const now = new Date().toISOString();
        try {
          let leadFields = val.field_data ? parseFieldData(val.field_data) : null;
          let attribution = {
            campaignId: val.campaign_id,
            campaignName: val.campaign_name,
            adSetId: val.adset_id,
            adSetName: val.adset_name,
            adId: val.ad_id,
            adName: val.ad_name,
            formName: val.form_name,
          };

          if (!leadFields && creds.accessToken) {
            const graphRes = await fetch(
              `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(leadgenId)}?fields=id,created_time,field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id&access_token=${encodeURIComponent(creds.accessToken)}`
            );
            const item = (await graphRes.json()) as any;
            if (!graphRes.ok || item.error) {
              throw new Error(item?.error?.message || 'Graph API lead fetch failed');
            }
            leadFields = parseFieldData(item.field_data);
            attribution = {
              campaignId: item.campaign_id,
              campaignName: item.campaign_name,
              adSetId: item.adset_id,
              adSetName: item.adset_name,
              adId: item.ad_id,
              adName: item.ad_name,
              formName: val.form_name || null,
            };
          }

          if (!leadFields) {
            throw new Error('No Graph API token configured to fetch lead details');
          }

          const created = createLeadRecord(db, {
            businessId,
            fullName: leadFields.fullName,
            phone: leadFields.phone,
            email: leadFields.email,
            interestedService: leadFields.interestedService,
            source: 'meta_lead_ads',
            campaignId: attribution.campaignId,
            campaignName: attribution.campaignName,
            adSetId: attribution.adSetId,
            adSetName: attribution.adSetName,
            adId: attribution.adId,
            adName: attribution.adName,
            formId,
            formName: attribution.formName,
            pageId,
            metaLeadgenId: leadgenId,
            originalAnswers: leadFields.answers,
            createdAt: val.created_time ? new Date(Number(val.created_time) * 1000).toISOString() : now,
          });

          if (targetIntegration) {
            db.prepare(`
              INSERT INTO sync_logs (id, business_id, integration_id, direction, mode, status, processed_count, created_count, updated_count, skipped_count, details_json, started_at, finished_at)
              VALUES (?, ?, ?, 'inbound', 'meta_webhook', 'success', 1, ?, 0, ?, ?, ?, ?)
            `).run(
              crypto.randomUUID(),
              businessId,
              targetIntegration.id,
              created.deduplicated ? 0 : 1,
              created.deduplicated ? 1 : 0,
              JSON.stringify({ leadgen_id: leadgenId, form_id: formId }),
              now,
              now
            );
          }

          if (!created.deduplicated) {
            broadcastWorkspaceEvent(businessId, 'lead_updated', {
              businessId,
              leadId: (created.lead as any)?.id,
            });
          }

          results.push({
            leadgen_id: leadgenId,
            status: created.deduplicated ? 'deduplicated' : 'created',
            businessId,
          });
        } catch (err: any) {
          if (targetIntegration) {
            db.prepare(`
              INSERT INTO sync_logs (id, business_id, integration_id, direction, mode, status, processed_count, created_count, updated_count, skipped_count, error_message, details_json, started_at, finished_at)
              VALUES (?, ?, ?, 'inbound', 'meta_webhook', 'failed', 1, 0, 0, 0, ?, ?, ?, ?)
            `).run(
              crypto.randomUUID(),
              businessId,
              targetIntegration.id,
              err.message,
              JSON.stringify({ leadgen_id: leadgenId, form_id: formId, page_id: pageId }),
              now,
              now
            );
            createAndBroadcastNotification(db, {
              businessId,
              userId: null,
              type: 'integration_failed',
              titleAr: 'فشل استقبال عميل من ميتا',
              titleEn: 'Meta Webhook Import Failed',
              messageAr: err.message,
              messageEn: err.message,
              linkPath: '/integrations',
              createdAt: now,
            });
          }
          results.push({ leadgen_id: leadgenId, status: 'failed', businessId });
        }
      }
    }

    res.status(200).json({ received: true, results });
  });

  return router;
}
