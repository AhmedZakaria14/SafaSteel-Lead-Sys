import React, { useEffect, useState } from 'react';
import {
  FileSpreadsheet,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Webhook,
  RotateCcw,
  Link2,
  Upload,
} from 'lucide-react';
import { IntegrationRecord, Language, Role, SyncLog } from '../../types/crm';
import { getT } from '../../i18n/translations';
import { apiRequest } from '../../lib/api';
import { formatCairoDateTime } from '../../lib/dateFormat';

interface IntegrationsViewProps {
  lang: Language;
  businessId: string;
  userRole: Role;
  onLeadsUpdated: () => void;
  onNotify: (msg: string, variant?: 'success' | 'error' | 'info') => void;
}

export const IntegrationsView: React.FC<IntegrationsViewProps> = ({
  lang,
  businessId,
  userRole,
  onLeadsUpdated,
  onNotify,
}) => {
  const t = getT(lang);
  const isAr = lang === 'ar';
  const isAdmin = userRole === 'business_admin' || userRole === 'super_admin';

  const [integrations, setIntegrations] = useState<IntegrationRecord[]>([]);
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(true);

  // Meta State
  const [metaToken, setMetaToken] = useState('');
  const [metaAppSecret, setMetaAppSecret] = useState('');
  const [metaVerifyToken, setMetaVerifyToken] = useState('');
  const [metaPages, setMetaPages] = useState<any[]>([]);
  const [connectingMeta, setConnectingMeta] = useState(false);

  // Live Sheet URL / CSV Source State
  const [sheetUrlInput, setSheetUrlInput] = useState('');
  const [liveSheetStatus, setLiveSheetStatus] = useState<{
    status?: string;
    attachedSheetName?: string;
    spreadsheetName?: string | null;
    spreadsheetId?: string | null;
    lastSyncAt?: string | null;
    lastSyncDurationMs?: number | null;
    lastError?: string | null;
    publicCsvUrl?: string | null;
    sheetUrl?: string | null;
    autoScheduled?: boolean;
    syncIntervalSec?: number;
    totalLeads?: number;
    knownLeadsCount?: number;
    lastCreatedCount?: number;
  } | null>(null);
  const [syncingSource, setSyncingSource] = useState(false);

  const loadIntegrations = async () => {
    setLoading(true);
    try {
      const [res, sheetStatusRes] = await Promise.all([
        apiRequest<{ integrations: IntegrationRecord[]; logs: SyncLog[] }>(
          `/businesses/${businessId}/integrations`
        ),
        apiRequest<any>(`/businesses/${businessId}/sheet-source/status`).catch(() => null),
      ]);
      setIntegrations(res.integrations);
      setLogs(res.logs);
      if (sheetStatusRes) {
        setLiveSheetStatus(sheetStatusRes);
        const preferredUrl = sheetStatusRes.sheetUrl || sheetStatusRes.publicCsvUrl;
        if (preferredUrl && !sheetUrlInput) {
          setSheetUrlInput(preferredUrl);
        }
      }

      const metaInteg = res.integrations.find((i) => i.provider === 'meta');
      if (metaInteg?.config?.verifyToken) {
        setMetaVerifyToken(metaInteg.config.verifyToken);
      }
    } catch (err: any) {
      onNotify(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadIntegrations();
  }, [businessId]);

  const metaInteg = integrations.find((i) => i.provider === 'meta');
  const sheetsInteg = integrations.find((i) => i.provider === 'google_sheets');

  // Meta Handlers
  const handleConnectMeta = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!metaToken.trim()) return;
    setConnectingMeta(true);
    try {
      const res = await apiRequest<any>(`/businesses/${businessId}/integrations/meta/connect`, {
        method: 'POST',
        body: JSON.stringify({
          accessToken: metaToken.trim(),
          appSecret: metaAppSecret.trim(),
          verifyToken: metaVerifyToken.trim(),
        }),
      });
      setMetaPages(res.pages || []);
      setMetaToken('');
      setMetaAppSecret('');
      onNotify(isAr ? 'تم التحقق والاتصال بواجهة Meta Graph بنجاح' : 'Verified and connected to Meta Graph API', 'success');
      loadIntegrations();
    } catch (err: any) {
      onNotify(err.message, 'error');
      loadIntegrations();
    } finally {
      setConnectingMeta(false);
    }
  };

  const handleLoadMetaPages = async () => {
    try {
      const res = await apiRequest<{ pages: any[] }>(`/businesses/${businessId}/integrations/meta/pages`);
      setMetaPages(res.pages || []);
    } catch (err: any) {
      onNotify(err.message, 'error');
    }
  };

  const handleSyncMetaForm = async (formId: string, formName: string, pageId: string) => {
    try {
      const res = await apiRequest<{ created: number; skipped: number }>(
        `/businesses/${businessId}/integrations/meta/sync-form`,
        {
          method: 'POST',
          body: JSON.stringify({ formId, formName, pageId }),
        }
      );
      onNotify(
        isAr
          ? `تم استيراد ${res.created} عميل جديد وتخطي ${res.skipped} مكرر`
          : `Imported ${res.created} new leads, skipped ${res.skipped} duplicates`,
        'success'
      );
      onLeadsUpdated();
      loadIntegrations();
    } catch (err: any) {
      onNotify(err.message, 'error');
    }
  };

  const handleRetryMeta = async () => {
    try {
      const res = await apiRequest<{ retried: number; resolved: number }>(
        `/businesses/${businessId}/integrations/meta/retry-failed`,
        { method: 'POST' }
      );
      onNotify(
        isAr ? `تمت إعادة محاولة ${res.retried}، ونجح ${res.resolved}` : `Retried ${res.retried}, resolved ${res.resolved}`,
        'success'
      );
      loadIntegrations();
      onLeadsUpdated();
    } catch (err: any) {
      onNotify(err.message, 'error');
    }
  };

  const handleDisconnectMeta = async () => {
    try {
      await apiRequest(`/businesses/${businessId}/integrations/meta/disconnect`, { method: 'POST' });
      setMetaPages([]);
      onNotify(isAr ? 'تم فصل تكامل ميتا' : 'Meta integration disconnected', 'info');
      loadIntegrations();
    } catch (err: any) {
      onNotify(err.message, 'error');
    }
  };

  const handleSyncAttachedOrUrl = async (options: { sheetUrl?: string; csvText?: string }) => {
    setSyncingSource(true);
    try {
      const res = await apiRequest<{ createdCount: number; updatedCount: number; totalLeadsInBusiness: number }>(
        `/businesses/${businessId}/sheet-source/sync`,
        {
          method: 'POST',
          body: JSON.stringify({ ...options, autoScheduled: true }),
        }
      );
      onNotify(
        isAr
          ? `تمت المزامنة بنجاح: +${res.createdCount} جديد، ${res.updatedCount} محدث (الإجمالي: ${res.totalLeadsInBusiness})`
          : `Synced successfully: +${res.createdCount} created, ${res.updatedCount} updated (Total: ${res.totalLeadsInBusiness})`,
        'success'
      );
      onLeadsUpdated();
      loadIntegrations();
    } catch (err: any) {
      onNotify(err.message, 'error');
    } finally {
      setSyncingSource(false);
    }
  };

  const handleCsvFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    await handleSyncAttachedOrUrl({ csvText: text });
    e.target.value = '';
  };

  const webhookUrl = `${window.location.origin}/api/webhooks/meta`;

  if (loading) {
    return <div className="p-8 text-center text-xs text-slate-400">{t.loading}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6">
        {/* META LEAD ADS MODULE */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
                <Webhook className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{t.metaTitle}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {metaInteg?.status === 'connected' ? (
                    <span className="text-emerald-600 font-medium inline-flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      <span>{isAr ? 'متصل ومؤكد عبر Graph API' : 'Connected & Verified via Graph API'}</span>
                    </span>
                  ) : metaInteg?.status === 'error' ? (
                    <span className="text-red-600 font-medium inline-flex items-center gap-1">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      <span className="break-words">{metaInteg.last_error}</span>
                    </span>
                  ) : (
                    <span>{isAr ? 'بانتظار الإعداد — يتطلب رمز وصول حقيقي' : 'Pending Configuration — Requires real Meta token'}</span>
                  )}
                </p>
              </div>
            </div>
            {metaInteg?.status === 'connected' && isAdmin && (
              <button
                type="button"
                onClick={handleDisconnectMeta}
                className="text-xs text-red-600 hover:underline font-medium shrink-0"
              >
                {t.disconnect}
              </button>
            )}
          </div>

          {/* Webhook Endpoint Info */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3.5 space-y-2 text-xs">
            <div className="font-semibold text-slate-800 dark:text-slate-200">
              {isAr ? 'إعداد Webhook وتصاريح Meta App Review المطلوبة:' : 'Webhook Configuration & Required Meta Permissions:'}
            </div>
            <div className="flex flex-col gap-1 font-mono text-[11px] text-slate-600 dark:text-slate-400 break-all" dir="ltr">
              <div>Callback URL: {webhookUrl}</div>
              <div>Verify Token: {metaVerifyToken || '(Set below or via META_WEBHOOK_VERIFY_TOKEN)'}</div>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              {isAr
                ? 'التصاريح المطلوبة في Meta App Review: leads_retrieval و pages_manage_metadata و pages_read_engagement و ads_read (ولتكلفة الإعلان: Ads Insights). يتم منع التكرار تلقائياً باستخدام leadgen_id.'
                : 'Required Meta App Review permissions: leads_retrieval, pages_manage_metadata, pages_read_engagement, ads_read. Deduplication is enforced automatically via leadgen_id.'}
            </p>
          </div>

          {isAdmin && (
            <form onSubmit={handleConnectMeta} className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                  {isAr ? 'رمز وصول ميتا (System User / Page Token)' : 'Meta Access Token (Verified server-side)'}
                </label>
                <input
                  type="password"
                  dir="ltr"
                  value={metaToken}
                  onChange={(e) => setMetaToken(e.target.value)}
                  placeholder="EAAG..."
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 min-h-[44px] sm:min-h-0 text-base sm:text-xs"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {isAr ? 'Meta App Secret (للتحقق من التوقيع)' : 'Meta App Secret (HMAC Verification)'}
                  </label>
                  <input
                    type="password"
                    dir="ltr"
                    value={metaAppSecret}
                    onChange={(e) => setMetaAppSecret(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 min-h-[44px] sm:min-h-0 text-base sm:text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {isAr ? 'Webhook Verify Token' : 'Webhook Verify Token'}
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    value={metaVerifyToken}
                    onChange={(e) => setMetaVerifyToken(e.target.value)}
                    placeholder="leadflow_verify_..."
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 min-h-[44px] sm:min-h-0 text-base sm:text-xs"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  disabled={connectingMeta || !metaToken.trim()}
                  className="rounded-lg bg-[#0F1E3D] dark:bg-blue-600 px-4 min-h-[42px] sm:min-h-0 sm:py-2 text-xs font-medium text-white disabled:opacity-50"
                >
                  {connectingMeta ? (isAr ? 'جاري التحقق...' : 'Verifying...') : t.connectMeta}
                </button>
                {metaInteg?.status === 'connected' && (
                  <>
                    <button
                      type="button"
                      onClick={handleLoadMetaPages}
                      className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      {isAr ? 'جلب الصفحات والنماذج' : 'Load Pages & Forms'}
                    </button>
                    <button
                      type="button"
                      onClick={handleRetryMeta}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>{t.retryFailed}</span>
                    </button>
                  </>
                )}
              </div>
            </form>
          )}

          {metaPages.length > 0 && (
            <div className="space-y-3 pt-3 border-t border-slate-100 dark:border-slate-800">
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                {isAr ? 'صفحات فيسبوك ونماذج العملاء المصرح بها' : 'Authorized Pages & Lead Forms'}
              </div>
              {metaPages.map((p) => (
                <div key={p.id} className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-2">
                  <div className="text-xs font-semibold text-slate-900 dark:text-slate-100">{p.name} ({p.id})</div>
                  {(p.forms || []).map((f: any) => (
                    <div key={f.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-slate-600 dark:text-slate-300 truncate">{f.name}</span>
                      <button
                        type="button"
                        onClick={() => handleSyncMetaForm(f.id, f.name, p.id)}
                        className="rounded bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white shrink-0"
                      >
                        {isAr ? 'مزامنة النموذج' : 'Pull Leads'}
                      </button>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* GOOGLE SHEETS, DRIVE & DOCS MODULE */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
                <FileSpreadsheet className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{t.googleTitle}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {sheetsInteg?.status === 'connected' ? (
                    <span className="text-emerald-600 font-medium inline-flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      <span>{sheetsInteg.display_name}</span>
                    </span>
                  ) : (
                    <span>{isAr ? 'اختر ملف Google Sheets من Drive للمزامنة' : 'Select a Google Sheet from Drive to synchronize'}</span>
                  )}
                </p>
              </div>
            </div>
          </div>

          {/* Live Attached Sheet + Direct Google Sheet CSV URL Sync */}
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/70 bg-emerald-50/50 dark:bg-emerald-950/20 p-3.5 sm:p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="space-y-0.5">
                <div className="text-xs font-semibold text-emerald-950 dark:text-emerald-200 flex items-center gap-2">
                  <span>{isAr ? 'المزامنة اللحظية المستمرة للشيت' : 'Real-Time Continuous Sheet Sync'}</span>
                  <span className="inline-flex items-center rounded bg-emerald-100 dark:bg-emerald-900/60 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800 dark:text-emerald-200">
                    {isAr ? `فحص تلقائي كل ${liveSheetStatus?.syncIntervalSec || 15} ثانية` : `Auto-Poll Every ${liveSheetStatus?.syncIntervalSec || 15}s`}
                  </span>
                </div>
                <div className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80 tabular-nums">
                  {liveSheetStatus?.spreadsheetName || liveSheetStatus?.attachedSheetName || 'الصفا ستيل غرابيل وحوامل كابلات'} ·{' '}
                  {liveSheetStatus?.totalLeads ?? 0} {isAr ? 'عميل متزامن' : 'synced leads'} ·{' '}
                  {liveSheetStatus?.knownLeadsCount ?? liveSheetStatus?.totalLeads ?? 0}{' '}
                  {isAr ? 'معرّف مسجل (Known IDs)' : 'Known IDs'}
                  {typeof liveSheetStatus?.lastSyncDurationMs === 'number' && (
                    <span> · {liveSheetStatus.lastSyncDurationMs}ms</span>
                  )}
                </div>
                {liveSheetStatus?.lastError && (
                  <div className="text-[11px] text-red-600 dark:text-red-400 font-medium">
                    {isAr ? 'خطأ المزامنة الأخير:' : 'Last Sync Error:'} {liveSheetStatus.lastError}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={syncingSource}
                  onClick={() => handleSyncAttachedOrUrl({})}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 px-3 min-h-[40px] sm:min-h-0 sm:py-1.5 text-xs font-medium text-white disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${syncingSource ? 'animate-spin' : ''}`} />
                  <span>{t.syncNow}</span>
                </button>
                <label className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-slate-900 px-3 min-h-[40px] sm:min-h-0 sm:py-1.5 text-xs font-medium text-emerald-900 dark:text-emerald-200 cursor-pointer hover:bg-emerald-50">
                  <Upload className="h-3.5 w-3.5" />
                  <span>{isAr ? 'رفع CSV' : 'Upload CSV'}</span>
                  <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleCsvFileUpload} />
                </label>
              </div>
            </div>

            <div className="pt-2 border-t border-emerald-200/70 dark:border-emerald-900/60 space-y-2">
              <label className="block text-[11px] font-medium text-emerald-950 dark:text-emerald-200">
                {isAr
                  ? 'أو الصق رابط Google Sheet مباشر للمزامنة التلقائية كل 15 ثانية في الخلفية:'
                  : 'Or paste a Google Sheet link for automatic 15s background polling:'}
              </label>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="url"
                  dir="ltr"
                  value={sheetUrlInput}
                  onChange={(e) => setSheetUrlInput(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="flex-1 rounded-lg border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-slate-950 px-3 py-2 min-h-[42px] sm:min-h-0 text-base sm:text-xs"
                />
                <button
                  type="button"
                  disabled={syncingSource || !sheetUrlInput.trim()}
                  onClick={() => handleSyncAttachedOrUrl({ sheetUrl: sheetUrlInput.trim() })}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#0F1E3D] dark:bg-blue-600 px-3.5 min-h-[42px] sm:min-h-0 sm:py-1.5 text-xs font-medium text-white disabled:opacity-50 shrink-0"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  <span>{isAr ? 'ربط ومزامنة' : 'Link & Sync'}</span>
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4 text-xs text-slate-600 dark:text-slate-300 space-y-1.5">
            <div className="font-semibold text-slate-800 dark:text-slate-100">
              {isAr ? 'ملاحظة الربط المباشر بدون Google Auth:' : 'Direct Sheet Sync Without Google OAuth:'}
            </div>
            <p className="leading-relaxed">
              {isAr
                ? 'يمكنك مشاركة رابط Google Sheet بصلاحية "Anyone with the link" ولصقه بالأعلى للمزامنة اللحظية التلقائية كل 15 ثانية، أو رفع ملف CSV محدث مباشرة دون الحاجة لتسجيل الدخول بجوجل.'
                : 'Share any Google Sheet with link view access and paste its URL above for automatic 15-second background sync, or upload an updated CSV file directly without Google Sign-In.'}
            </p>
          </div>
        </div>
      </div>

      {/* Sync Logs */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t.syncLogs}</h3>
        </div>
        {logs.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            {isAr ? 'لا توجد عمليات مزامنة مسجلة حتى الآن' : 'No synchronization runs recorded yet'}
          </div>
        ) : (
          <>
          <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {logs.map((log) => (
              <div key={log.id} className="p-3.5 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                    {log.mode} · {log.direction}
                  </span>
                  <span className={log.status === 'success' ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold'}>
                    {log.status}
                  </span>
                </div>
                <div className="flex items-center justify-between text-slate-500 tabular-nums">
                  <span>
                    {isAr ? 'معالجة:' : 'Processed:'} {log.processed_count} (+{log.created_count} / {log.updated_count})
                  </span>
                  <span className="font-mono" dir="ltr">{formatCairoDateTime(log.started_at, lang)}</span>
                </div>
                {log.error_message && <p className="text-red-600 dark:text-red-400 break-words">{log.error_message}</p>}
              </div>
            ))}
          </div>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-start border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-500 font-semibold">
                  <th className="py-2.5 px-4 text-start">{isAr ? 'الوضع' : 'Mode'}</th>
                  <th className="py-2.5 px-4 text-start">{isAr ? 'الاتجاه' : 'Direction'}</th>
                  <th className="py-2.5 px-4 text-start">{t.status}</th>
                  <th className="py-2.5 px-4 text-end">{isAr ? 'تمت معالجته' : 'Processed'}</th>
                  <th className="py-2.5 px-4 text-end">{isAr ? 'إنشاء / تحديث' : 'Created / Updated'}</th>
                  <th className="py-2.5 px-4 text-start">{isAr ? 'الخطأ / التفاصيل' : 'Details'}</th>
                  <th className="py-2.5 px-4 text-end">{t.createdAt}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td className="py-2.5 px-4 font-mono">{log.mode}</td>
                    <td className="py-2.5 px-4">{log.direction}</td>
                    <td className="py-2.5 px-4 font-medium">
                      <span className={log.status === 'success' ? 'text-emerald-600' : 'text-red-600'}>
                        {log.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-end tabular-nums">{log.processed_count}</td>
                    <td className="py-2.5 px-4 text-end tabular-nums">
                      {log.created_count} / {log.updated_count}
                    </td>
                    <td className="py-2.5 px-4 text-slate-500 max-w-xs truncate">{log.error_message || '—'}</td>
                    <td className="py-2.5 px-4 text-end font-mono tabular-nums text-slate-400" dir="ltr">
                      {formatCairoDateTime(log.started_at, lang)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>
    </div>
  );
};
