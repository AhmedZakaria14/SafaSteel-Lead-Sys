import React, { useEffect, useState } from 'react';
import {
  FileSpreadsheet,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  FolderOpen,
  Webhook,
  RotateCcw,
  FileText,
  Link2,
  Upload,
} from 'lucide-react';
import { IntegrationRecord, Language, Role, SyncLog } from '../../types/crm';
import { getT } from '../../i18n/translations';
import { apiRequest } from '../../lib/api';
import { getGoogleWorkspaceAccessToken } from '../../lib/firebase';
import { GoogleSignInButton } from '../ui/GoogleSignInButton';
import { ConfirmDialog } from '../ui/ConfirmDialog';

interface IntegrationsViewProps {
  lang: Language;
  businessId: string;
  userRole: Role;
  onGoogleSignIn: () => Promise<void>;
  onLeadsUpdated: () => void;
  onNotify: (msg: string, variant?: 'success' | 'error' | 'info') => void;
}

export const IntegrationsView: React.FC<IntegrationsViewProps> = ({
  lang,
  businessId,
  userRole,
  onGoogleSignIn,
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

  // Google Sheets & Drive State
  const [driveSheets, setDriveSheets] = useState<any[]>([]);
  const [driveDocs, setDriveDocs] = useState<any[]>([]);
  const [loadingDrive, setLoadingDrive] = useState(false);
  const [selectedSpreadsheetId, setSelectedSpreadsheetId] = useState('');
  const [selectedSpreadsheetName, setSelectedSpreadsheetName] = useState('');
  const [sheetTabs, setSheetTabs] = useState<Array<{ sheetId: number; title: string }>>([]);
  const [selectedTab, setSelectedTab] = useState('');
  const [sheetHeaders, setSheetHeaders] = useState<string[]>([]);
  const [syncMode, setSyncMode] = useState<'A' | 'B'>('B');
  const [conflictPolicy, setConflictPolicy] = useState<'crm_wins' | 'sheet_wins' | 'newest_wins'>('crm_wins');
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>({});
  const [syncNotes, setSyncNotes] = useState(true);

  const [confirmSyncOpen, setConfirmSyncOpen] = useState(false);
  const [syncDirection, setSyncDirection] = useState<'inbound' | 'outbound' | 'bidirectional'>('bidirectional');
  const [syncingSheets, setSyncingSheets] = useState(false);

  // Live Sheet URL / CSV Source State
  const [sheetUrlInput, setSheetUrlInput] = useState('');
  const [liveSheetStatus, setLiveSheetStatus] = useState<{
    attachedSheetName?: string;
    lastSyncAt?: string | null;
    publicCsvUrl?: string | null;
    autoScheduled?: boolean;
    totalLeads?: number;
  } | null>(null);
  const [syncingSource, setSyncingSource] = useState(false);

  const hasGoogleToken = Boolean(getGoogleWorkspaceAccessToken());

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
        if (sheetStatusRes.publicCsvUrl && !sheetUrlInput) {
          setSheetUrlInput(sheetStatusRes.publicCsvUrl);
        }
      }

      const sheetsInteg = res.integrations.find((i) => i.provider === 'google_sheets');
      if (sheetsInteg?.config?.spreadsheetId) {
        setSelectedSpreadsheetId(sheetsInteg.config.spreadsheetId);
        setSelectedSpreadsheetName(sheetsInteg.config.spreadsheetName || '');
        setSelectedTab(sheetsInteg.config.sheetTitle || '');
        setSyncMode(sheetsInteg.config.mode || 'B');
        setConflictPolicy(sheetsInteg.config.conflictPolicy || 'sheet_wins');
        setColumnMapping(sheetsInteg.config.columnMapping || {});
        setSyncNotes(Boolean(sheetsInteg.config.syncNotes));
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

  // Google Drive & Sheets Handlers
  const handleBrowseDrive = async () => {
    setLoadingDrive(true);
    try {
      const [sheetsRes, docsRes] = await Promise.all([
        apiRequest<{ files: any[] }>(`/businesses/${businessId}/google/drive-files?type=sheets`, {
          includeGoogleToken: true,
        }),
        apiRequest<{ files: any[] }>(`/businesses/${businessId}/google/drive-files?type=docs`, {
          includeGoogleToken: true,
        }),
      ]);
      setDriveSheets(sheetsRes.files || []);
      setDriveDocs(docsRes.files || []);
    } catch (err: any) {
      onNotify(err.message, 'error');
    } finally {
      setLoadingDrive(false);
    }
  };

  const handleSelectSpreadsheet = async (fileId: string, fileName: string) => {
    setSelectedSpreadsheetId(fileId);
    setSelectedSpreadsheetName(fileName);
    setSelectedTab('');
    setSheetHeaders([]);
    try {
      const meta = await apiRequest<{ sheets: Array<{ sheetId: number; title: string }> }>(
        `/businesses/${businessId}/google/sheets/${fileId}/metadata`,
        { includeGoogleToken: true }
      );
      setSheetTabs(meta.sheets || []);
      if (meta.sheets?.length > 0) {
        handleSelectTab(fileId, meta.sheets[0].title);
      }
    } catch (err: any) {
      onNotify(err.message, 'error');
    }
  };

  const handleSelectTab = async (spreadsheetId: string, tabTitle: string) => {
    setSelectedTab(tabTitle);
    try {
      const res = await apiRequest<{ headers: string[] }>(
        `/businesses/${businessId}/google/sheets/${spreadsheetId}/headers?sheetTitle=${encodeURIComponent(tabTitle)}`,
        { includeGoogleToken: true }
      );
      setSheetHeaders(res.headers || []);
    } catch (err: any) {
      onNotify(err.message, 'error');
    }
  };

  const handleSaveSheetsConfig = async () => {
    if (!selectedSpreadsheetId || !selectedTab) {
      onNotify(isAr ? 'اختر ملف جدول البيانات وورقة العمل أولاً' : 'Select spreadsheet and worksheet tab first', 'error');
      return;
    }
    try {
      await apiRequest(`/businesses/${businessId}/google/sheets/config`, {
        method: 'POST',
        body: JSON.stringify({
          spreadsheetId: selectedSpreadsheetId,
          spreadsheetName: selectedSpreadsheetName,
          sheetTitle: selectedTab,
          mode: syncMode,
          conflictPolicy,
          columnMapping,
          syncNotes,
        }),
      });
      onNotify(isAr ? 'تم حفظ إعدادات جداول جوجل' : 'Google Sheets configuration saved', 'success');
      loadIntegrations();
    } catch (err: any) {
      onNotify(err.message, 'error');
    }
  };

  const handleExecuteSheetsSync = async () => {
    setSyncingSheets(true);
    try {
      const res = await apiRequest<{ createdCount: number; updatedCount: number; skippedCount: number }>(
        `/businesses/${businessId}/google/sheets/sync`,
        {
          method: 'POST',
          includeGoogleToken: true,
          body: JSON.stringify({ direction: syncDirection }),
        }
      );
      setConfirmSyncOpen(false);
      onNotify(
        isAr
          ? `تمت المزامنة: إنشاء ${res.createdCount}، تحديث ${res.updatedCount}، تخطي ${res.skippedCount}`
          : `Sync completed: ${res.createdCount} created, ${res.updatedCount} updated, ${res.skippedCount} skipped`,
        'success'
      );
      onLeadsUpdated();
      loadIntegrations();
    } catch (err: any) {
      onNotify(err.message, 'error');
    } finally {
      setSyncingSheets(false);
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
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* META LEAD ADS MODULE */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
                <Webhook className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{t.metaTitle}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {metaInteg?.status === 'connected' ? (
                    <span className="text-emerald-600 font-medium inline-flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>{isAr ? 'متصل ومؤكد عبر Graph API' : 'Connected & Verified via Graph API'}</span>
                    </span>
                  ) : metaInteg?.status === 'error' ? (
                    <span className="text-red-600 font-medium inline-flex items-center gap-1">
                      <AlertCircle className="h-3.5 w-3.5" />
                      <span>{metaInteg.last_error}</span>
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
                className="text-xs text-red-600 hover:underline font-medium"
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
            <div className="flex flex-col gap-1 font-mono text-[11px] text-slate-600 dark:text-slate-400" dir="ltr">
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
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
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
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
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
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  disabled={connectingMeta || !metaToken.trim()}
                  className="rounded-lg bg-[#0F1E3D] dark:bg-blue-600 px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
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
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
                <FileSpreadsheet className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">{t.googleTitle}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {sheetsInteg?.status === 'connected' ? (
                    <span className="text-emerald-600 font-medium inline-flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" />
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
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-900/70 bg-emerald-50/50 dark:bg-emerald-950/20 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-semibold text-emerald-950 dark:text-emerald-200">
                  {isAr ? 'المزامنة اللحظية المستمرة للشيت' : 'Real-Time Continuous Sheet Sync'}
                </div>
                <div className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80 tabular-nums">
                  {liveSheetStatus?.attachedSheetName || 'الصفا ستيل غرابيل وحوامل كابلات'} ·{' '}
                  {liveSheetStatus?.totalLeads ?? 0} {isAr ? 'عميل متزامن' : 'synced leads'}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={syncingSource}
                  onClick={() => handleSyncAttachedOrUrl({})}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-800 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${syncingSource ? 'animate-spin' : ''}`} />
                  <span>{t.syncNow}</span>
                </button>
                <label className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-emerald-900 dark:text-emerald-200 cursor-pointer hover:bg-emerald-50">
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
              <div className="flex gap-2">
                <input
                  type="url"
                  dir="ltr"
                  value={sheetUrlInput}
                  onChange={(e) => setSheetUrlInput(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/..."
                  className="flex-1 rounded-lg border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs"
                />
                <button
                  type="button"
                  disabled={syncingSource || !sheetUrlInput.trim()}
                  onClick={() => handleSyncAttachedOrUrl({ sheetUrl: sheetUrlInput.trim() })}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F1E3D] dark:bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 shrink-0"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  <span>{isAr ? 'ربط ومزامنة' : 'Link & Sync'}</span>
                </button>
              </div>
            </div>
          </div>

          {!hasGoogleToken ? (
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-5 text-center space-y-3">
              <p className="text-xs text-slate-600 dark:text-slate-300">
                {isAr
                  ? 'أو قم بتسجيل الدخول بحساب جوجل للوصول إلى جداول بيانات Google Drive الخاصة بك والمزامنة ثنائية الاتجاه.'
                  : 'Or sign in with Google to authorize access to private Google Drive spreadsheets, two-way sync, and Google Docs.'}
              </p>
              <GoogleSignInButton label={t.signInGoogle} onClick={onGoogleSignIn} />
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleBrowseDrive}
                  disabled={loadingDrive}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3.5 py-2 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <FolderOpen className="h-4 w-4 text-blue-600" />
                  <span>{loadingDrive ? t.loading : isAr ? 'استعراض ملفات Google Drive' : 'Browse Google Drive Files'}</span>
                </button>
              </div>

              {driveSheets.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {isAr ? 'اختر جدول البيانات (Spreadsheet)' : 'Select Spreadsheet'}
                  </label>
                  <select
                    value={selectedSpreadsheetId}
                    onChange={(e) => {
                      const file = driveSheets.find((f) => f.id === e.target.value);
                      if (file) handleSelectSpreadsheet(file.id, file.name);
                    }}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
                  >
                    <option value="">{isAr ? '— اختر ملفاً —' : '— Select spreadsheet —'}</option>
                    {driveSheets.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {sheetTabs.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {isAr ? 'اختر ورقة العمل (Worksheet Tab)' : 'Select Worksheet Tab'}
                  </label>
                  <select
                    value={selectedTab}
                    onChange={(e) => handleSelectTab(selectedSpreadsheetId, e.target.value)}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
                  >
                    {sheetTabs.map((tab) => (
                      <option key={tab.sheetId} value={tab.title}>
                        {tab.title}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {isAr ? 'وضع التكامل' : 'Integration Mode'}
                  </label>
                  <select
                    value={syncMode}
                    onChange={(e) => setSyncMode(e.target.value as 'A' | 'B')}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
                  >
                    <option value="B">
                      {isAr ? 'الوضع B: قاعدة البيانات أساسية + مزامنة للجدول (موصى به)' : 'Mode B: CRM Primary + Synced Reporting (Recommended)'}
                    </option>
                    <option value="A">
                      {isAr ? 'الوضع A: استيراد العملاء من الجدول' : 'Mode A: Google Sheets Lead Ingestion'}
                    </option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">
                    {isAr ? 'سياسة حل التعارض' : 'Conflict Resolution Rule'}
                  </label>
                  <select
                    value={conflictPolicy}
                    onChange={(e) => setConflictPolicy(e.target.value as any)}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs"
                  >
                    <option value="crm_wins">{isAr ? 'الأولوية لنظام CRM' : 'CRM Wins'}</option>
                    <option value="sheet_wins">{isAr ? 'الأولوية لجدول جوجل' : 'Sheet Wins'}</option>
                    <option value="newest_wins">{isAr ? 'الأحدث تعديلاً يفوز' : 'Newest Timestamp Wins'}</option>
                  </select>
                </div>
              </div>

              {sheetHeaders.length > 0 && (
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-2">
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    {isAr ? 'ربط أعمدة الجدول بحقول CRM' : 'Column Mapping'}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {['full_name', 'phone', 'email', 'interested_service', 'notes'].map((crmKey) => (
                      <div key={crmKey} className="flex items-center justify-between gap-2">
                        <span className="text-slate-500">{crmKey}</span>
                        <select
                          value={columnMapping[crmKey] || ''}
                          onChange={(e) => setColumnMapping((p) => ({ ...p, [crmKey]: e.target.value }))}
                          className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-xs max-w-32"
                        >
                          <option value="">—</option>
                          {sheetHeaders.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
                <input type="checkbox" checked={syncNotes} onChange={(e) => setSyncNotes(e.target.checked)} />
                <span>{isAr ? 'مزامنة عمود الملاحظات مع الجدول' : 'Synchronize internal notes column'}</span>
              </label>

              <div className="flex flex-wrap items-center gap-2 pt-2">
                {isAdmin && (
                  <button
                    type="button"
                    onClick={handleSaveSheetsConfig}
                    className="rounded-lg border border-slate-200 dark:border-slate-700 px-3.5 py-2 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                  >
                    {t.save}
                  </button>
                )}
                <button
                  type="button"
                  disabled={!selectedSpreadsheetId || !selectedTab}
                  onClick={() => {
                    setSyncDirection(syncMode === 'A' ? 'inbound' : 'bidirectional');
                    setConfirmSyncOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#0F1E3D] dark:bg-blue-600 px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>{t.syncNow}</span>
                </button>
              </div>

              {driveDocs.length > 0 && (
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
                  <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5 text-blue-600" />
                    <span>{isAr ? 'قوالب ومستندات Google Docs في Drive' : 'Google Docs Templates in Drive'}</span>
                  </div>
                  <div className="space-y-1">
                    {driveDocs.slice(0, 5).map((doc) => (
                      <a
                        key={doc.id}
                        href={doc.webViewLink}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-300 hover:text-blue-600 py-1"
                      >
                        <span className="truncate">{doc.name}</span>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Sync Logs */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t.syncLogs}</h3>
        </div>
        {logs.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-400">
            {isAr ? 'لا توجد عمليات مزامنة مسجلة حتى الآن' : 'No synchronization runs recorded yet'}
          </div>
        ) : (
          <div className="overflow-x-auto">
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
                    <td className="py-2.5 px-4 text-end tabular-nums text-slate-400">
                      {new Date(log.started_at).toLocaleString(isAr ? 'ar-SA' : 'en-US')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmSyncOpen}
        title={isAr ? 'تأكيد مزامنة جدول Google Sheets' : 'Confirm Google Sheets Synchronization'}
        description={
          isAr
            ? `سيتم تنفيذ مزامنة (${syncDirection}) مع الملف "${selectedSpreadsheetName || selectedSpreadsheetId}" ورقة "${selectedTab}". قد يتم تحديث صفوف جدول البيانات ببيانات CRM الحالية وفق سياسة "${conflictPolicy}". هل تريد المتابعة؟`
            : `This will run a ${syncDirection} sync with spreadsheet "${selectedSpreadsheetName || selectedSpreadsheetId}" (tab "${selectedTab}") using conflict rule "${conflictPolicy}". Proceed?`
        }
        confirmLabel={t.syncNow}
        cancelLabel={t.cancel}
        busy={syncingSheets}
        onConfirm={handleExecuteSheetsSync}
        onCancel={() => setConfirmSyncOpen(false)}
      />
    </div>
  );
};
