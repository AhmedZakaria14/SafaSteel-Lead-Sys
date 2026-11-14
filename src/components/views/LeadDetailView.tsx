import React, { useEffect, useState } from 'react';
import {
  ArrowRight,
  ArrowLeft,
  Phone,
  MessageSquare,
  Mail,
  FileText,
  CalendarPlus,
  Send,
  AlertTriangle,
  ExternalLink,
  CheckCircle2,
  Building2,
  Briefcase,
  Copy,
  Check,
  Package,
  Megaphone,
  Clock,
  Layers,
  UserCheck,
  Printer,
} from 'lucide-react';
import { CustomField, FollowUpTask, Language, Lead, PipelineStage, Role, TeamMember } from '../../types/crm';
import { getT } from '../../i18n/translations';
import { apiRequest } from '../../lib/api';

interface LeadDetailViewProps {
  lang: Language;
  businessId: string;
  leadId: string;
  userRole: Role;
  stages: PipelineStage[];
  customFields: CustomField[];
  members: TeamMember[];
  onBack: () => void;
  onUpdated: () => void;
  onNotify: (msg: string, variant?: 'success' | 'error' | 'info') => void;
}

const RAW_KEY_LABELS: Record<string, { ar: string; en: string }> = {
  id: { ar: 'معرف الصف', en: 'Row ID' },
  created_time: { ar: 'وقت التسجيل', en: 'Submitted Time' },
  ad_id: { ar: 'معرف الإعلان', en: 'Ad ID' },
  ad_name: { ar: 'اسم الإعلان', en: 'Ad Name' },
  adset_id: { ar: 'معرف المجموعة الإعلانية', en: 'Ad Set ID' },
  adset_name: { ar: 'المجموعة الإعلانية', en: 'Ad Set Name' },
  campaign_id: { ar: 'معرف الحملة', en: 'Campaign ID' },
  campaign_name: { ar: 'اسم الحملة', en: 'Campaign Name' },
  form_id: { ar: 'معرف النموذج', en: 'Form ID' },
  form_name: { ar: 'اسم النموذج', en: 'Form Name' },
  is_organic: { ar: 'تفاعل عضوي', en: 'Organic' },
  platform: { ar: 'المنصة', en: 'Platform' },
  اختر_المنتجات_المرغوبة: { ar: 'المنتجات المطلوبة', en: 'Requested Products' },
  اكتب_الكمية_أو_المقاسات_المطلوبة_إن_وجدت: { ar: 'الكمية والمقاسات المطلوبة', en: 'Quantity & Sizes' },
  'اكتب_رقم_الهاتف/الواتساب_لإرسال_عرض_السعر': { ar: 'رقم الواتساب المدخل', en: 'WhatsApp Number' },
  full_name: { ar: 'الاسم الكامل', en: 'Full Name' },
  email: { ar: 'البريد الإلكتروني', en: 'Email' },
  phone_number: { ar: 'رقم الهاتف الأساسي', en: 'Primary Phone' },
  company_name: { ar: 'الشركة / النشاط', en: 'Company Name' },
  job_title: { ar: 'المسمى الوظيفي', en: 'Job Title' },
  inbox_url: { ar: 'رابط المحادثة', en: 'Meta Inbox URL' },
  lead_status: { ar: 'حالة الشيت', en: 'Sheet Status' },
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'L';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function formatSourceDisplay(source: string, isAr: boolean): string {
  if (source === 'facebook_lead_ads') return isAr ? 'إعلانات فيسبوك' : 'Facebook Lead Ads';
  if (source === 'instagram_lead_ads') return isAr ? 'إعلانات إنستغرام' : 'Instagram Lead Ads';
  if (source === 'meta_lead_ads') return 'Meta Lead Ads';
  if (source === 'google_sheets') return 'Google Sheets';
  if (source === 'manual') return isAr ? 'إدخال يدوي' : 'Manual Entry';
  return source;
}

export const LeadDetailView: React.FC<LeadDetailViewProps> = ({
  lang,
  businessId,
  leadId,
  userRole,
  stages,
  customFields,
  members,
  onBack,
  onUpdated,
  onNotify,
}) => {
  const t = getT(lang);
  const isAr = lang === 'ar';

  const [loading, setLoading] = useState(true);
  const [lead, setLead] = useState<Lead | null>(null);
  const [notes, setNotes] = useState<any[]>([]);
  const [activities, setActivities] = useState<any[]>([]);
  const [followUps, setFollowUps] = useState<FollowUpTask[]>([]);
  const [duplicates, setDuplicates] = useState<any[]>([]);

  const [newNote, setNewNote] = useState('');
  const [followUpTitle, setFollowUpTitle] = useState('');
  const [followUpDue, setFollowUpDue] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [answersTab, setAnswersTab] = useState<'structured' | 'raw'>('structured');
  const [updatingStageId, setUpdatingStageId] = useState<string | null>(null);

  const loadDetail = async () => {
    setLoading(true);
    try {
      const res = await apiRequest<any>(`/businesses/${businessId}/leads/${leadId}`);
      setLead(res.lead);
      setNotes(res.notes || []);
      setActivities(res.activities || []);
      setFollowUps(res.followUps || []);
      setDuplicates(res.duplicates || []);
    } catch (err: any) {
      onNotify(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDetail();
  }, [businessId, leadId]);

  const handleCopy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((curr) => (curr === key ? null : curr)), 1600);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleStatusChange = async (statusId: string) => {
    if (!statusId || statusId === lead?.status_id) return;
    setUpdatingStageId(statusId);
    try {
      await apiRequest(`/businesses/${businessId}/leads/${leadId}/status`, {
        method: 'POST',
        body: JSON.stringify({ statusId }),
      });
      onNotify(isAr ? 'تم تحديث حالة العميل' : 'Lead status updated', 'success');
      await loadDetail();
      onUpdated();
    } catch (err: any) {
      onNotify(err.message, 'error');
    } finally {
      setUpdatingStageId(null);
    }
  };

  const handleAssign = async (assignedToUserId: string) => {
    try {
      await apiRequest(`/businesses/${businessId}/leads/${leadId}/assign`, {
        method: 'POST',
        body: JSON.stringify({ assignedToUserId: assignedToUserId || null }),
      });
      onNotify(isAr ? 'تم تحديث المسؤول عن العميل' : 'Assignee updated', 'success');
      await loadDetail();
      onUpdated();
    } catch (err: any) {
      onNotify(err.message, 'error');
    }
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim()) return;
    try {
      await apiRequest(`/businesses/${businessId}/leads/${leadId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ content: newNote.trim() }),
      });
      setNewNote('');
      onNotify(isAr ? 'تمت إضافة الملاحظة' : 'Note added', 'success');
      await loadDetail();
      onUpdated();
    } catch (err: any) {
      onNotify(err.message, 'error');
    }
  };

  const handleScheduleFollowUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!followUpTitle.trim() || !followUpDue) return;
    try {
      await apiRequest(`/businesses/${businessId}/follow-ups`, {
        method: 'POST',
        body: JSON.stringify({
          leadId,
          title: followUpTitle.trim(),
          dueAt: new Date(followUpDue).toISOString(),
        }),
      });
      setFollowUpTitle('');
      setFollowUpDue('');
      onNotify(isAr ? 'تمت جدولة المتابعة' : 'Follow-up scheduled', 'success');
      await loadDetail();
      onUpdated();
    } catch (err: any) {
      onNotify(err.message, 'error');
    }
  };

  const handleCompleteFollowUp = async (taskId: string) => {
    try {
      await apiRequest(`/businesses/${businessId}/follow-ups/${taskId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'completed' }),
      });
      await loadDetail();
      onUpdated();
    } catch (err: any) {
      onNotify(err.message, 'error');
    }
  };

  if (loading || !lead) {
    return (
      <div className="space-y-5 animate-pulse">
        <div className="h-32 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 h-96 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800" />
          <div className="lg:col-span-4 h-96 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800" />
        </div>
      </div>
    );
  }

  const originalAnswers = JSON.parse(lead.original_answers_json || '{}');
  const customValues = JSON.parse(lead.custom_values_json || '{}');
  const primaryPhone = lead.phone_e164 || lead.phone || '';
  const whatsappFormInput = typeof customValues.whatsapp_input === 'string' ? customValues.whatsapp_input : '';
  const whatsappDigits = (primaryPhone || whatsappFormInput).replace(/\D/g, '');

  const companyName = typeof customValues.company_name === 'string' ? customValues.company_name.trim() : '';
  const jobTitle = typeof customValues.job_title === 'string' ? customValues.job_title.trim() : '';
  const quantitySpecs =
    (typeof customValues.quantity_sizes === 'string' && customValues.quantity_sizes.trim()) ||
    lead.notes_summary ||
    '';
  const productSelection =
    (typeof customValues.product_selection === 'string' && customValues.product_selection.trim()) ||
    lead.interested_service ||
    '';
  const inboxUrl = typeof customValues.inbox_url === 'string' && customValues.inbox_url.startsWith('http') ? customValues.inbox_url : '';
  const platformCode = typeof customValues.platform === 'string' ? customValues.platform.trim().toLowerCase() : '';
  const currentStage = stages.find((s) => s.id === lead.status_id);
  const currentStageIdx = stages.findIndex((s) => s.id === lead.status_id);

  // Clean structured custom fields (hide internal _sheet_hash)
  const visibleCustomFields = customFields.filter((cf) => cf.field_key !== '_sheet_hash');

  return (
    <div className="space-y-4 sm:space-y-6 crm-animate-enter">
      {/* Hero Header + Interactive Stage Progress */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="p-4 sm:p-6">
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 sm:gap-5">
            <div className="flex items-start gap-3 sm:gap-4 min-w-0">
              <button
                type="button"
                onClick={onBack}
                className="mt-0.5 rounded-lg border border-slate-200 dark:border-slate-700 min-h-[42px] min-w-[42px] sm:min-h-0 sm:min-w-0 sm:p-2 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors shrink-0"
                title={isAr ? 'العودة لقائمة العملاء' : 'Back to Leads'}
                aria-label={isAr ? 'العودة لقائمة العملاء' : 'Back to Leads'}
              >
                {isAr ? <ArrowRight className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />}
              </button>

              <div
                className="h-11 w-11 sm:h-12 sm:w-12 rounded-xl flex items-center justify-center text-sm font-bold text-white shrink-0 shadow-xs"
                style={{ backgroundColor: currentStage?.color || '#0F1E3D' }}
              >
                {getInitials(lead.full_name)}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
                  <span className="font-mono font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
                    {lead.lead_code}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="font-medium text-blue-700 dark:text-blue-400">
                    {formatSourceDisplay(lead.source, isAr)}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="tabular-nums">
                    {new Date(lead.created_at).toLocaleString(isAr ? 'ar-EG' : 'en-US', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </span>
                  {currentStage && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span
                        className="font-semibold"
                        style={{ color: currentStage.color }}
                      >
                        {isAr ? currentStage.name_ar : currentStage.name_en}
                      </span>
                    </>
                  )}
                </div>

                <h2 className="mt-1 text-lg sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 break-words">
                  {lead.full_name}
                </h2>

                {(companyName || jobTitle) && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
                    {companyName && (
                      <span className="inline-flex items-center gap-1.5 font-medium">
                        <Building2 className="h-3.5 w-3.5 text-slate-400" />
                        <span>{companyName}</span>
                      </span>
                    )}
                    {companyName && jobTitle && <span className="text-slate-300 dark:text-slate-700">·</span>}
                    {jobTitle && (
                      <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                        <Briefcase className="h-3.5 w-3.5 text-slate-400" />
                        <span>{jobTitle}</span>
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Quick Actions (Clean 2-col grid on mobile, inline flex on desktop) */}
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2 shrink-0">
              {primaryPhone && (
                <a
                  href={`tel:${primaryPhone}`}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-blue-200 dark:border-blue-900/70 bg-blue-50/70 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 px-3.5 min-h-[42px] sm:min-h-0 sm:py-2 text-xs font-semibold hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-all duration-150 whitespace-nowrap"
                >
                  <Phone className="h-3.5 w-3.5" />
                  <span>{t.callCustomer}</span>
                </a>
              )}
              {whatsappDigits && (
                <a
                  href={`https://wa.me/${whatsappDigits}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-emerald-200 dark:border-emerald-900/70 bg-emerald-50/80 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 px-3.5 min-h-[42px] sm:min-h-0 sm:py-2 text-xs font-semibold hover:bg-emerald-100 dark:hover:bg-emerald-900/40 transition-all duration-150 whitespace-nowrap"
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  <span>{t.openWhatsApp}</span>
                </a>
              )}
              {inboxUrl && (
                <a
                  href={inboxUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-indigo-200 dark:border-indigo-900/70 bg-indigo-50/70 dark:bg-indigo-950/30 text-indigo-700 dark:text-indigo-300 px-3.5 min-h-[42px] sm:min-h-0 sm:py-2 text-xs font-semibold hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-all duration-150 whitespace-nowrap"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>{isAr ? 'محادثة Meta Inbox' : 'Meta Inbox'}</span>
                </a>
              )}
              {lead.email && (
                <a
                  href={`mailto:${lead.email}`}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 min-h-[42px] sm:min-h-0 sm:py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors whitespace-nowrap"
                >
                  <Mail className="h-3.5 w-3.5 text-slate-500" />
                  <span>{t.sendEmail}</span>
                </a>
              )}
              <button
                type="button"
                onClick={() => window.print()}
                className="col-span-2 sm:col-span-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#0F1E3D] hover:bg-[#162B54] dark:bg-blue-600 dark:hover:bg-blue-700 px-3.5 min-h-[42px] sm:min-h-0 sm:py-2 text-xs font-semibold text-white transition-colors whitespace-nowrap"
              >
                <Printer className="h-3.5 w-3.5" />
                <span>{t.printBrief}</span>
              </button>
            </div>
          </div>

          {duplicates.length > 0 && (
            <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-900 px-4 py-2.5 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>
                {t.duplicateWarning}: {duplicates.map((d) => `${d.full_name} (${d.lead_code})`).join(', ')}
              </span>
            </div>
          )}
        </div>

        {/* Interactive Pipeline Stage Stepper */}
        {stages.length > 0 && (
          <div className="px-4 sm:px-6 py-2.5 sm:py-3 bg-slate-50/80 dark:bg-slate-950/60 border-t border-slate-200 dark:border-slate-800 overflow-x-auto no-scrollbar">
            <div className="flex items-center gap-1.5 min-w-max">
              {stages.map((stage, idx) => {
                const isActive = stage.id === lead.status_id;
                const isPast = currentStageIdx >= 0 && idx < currentStageIdx && !stage.is_lost;
                const isUpdating = updatingStageId === stage.id;
                return (
                  <button
                    key={stage.id}
                    type="button"
                    disabled={Boolean(updatingStageId)}
                    onClick={() => handleStatusChange(stage.id)}
                    className={`px-3 min-h-[38px] sm:min-h-0 sm:py-1.5 rounded-lg text-xs font-medium transition-all duration-150 whitespace-nowrap border ${
                      isActive
                        ? 'text-white shadow-xs border-transparent'
                        : isPast
                          ? 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:border-slate-400'
                          : 'bg-transparent border-transparent text-slate-500 dark:text-slate-400 hover:bg-white dark:hover:bg-slate-900 hover:border-slate-200 dark:hover:border-slate-800'
                    } ${isUpdating ? 'opacity-60' : ''}`}
                    style={isActive ? { backgroundColor: stage.color || '#2563EB' } : undefined}
                  >
                    <span className="tabular-nums opacity-75 me-1">{idx + 1}.</span>
                    <span>{isAr ? stage.name_ar : stage.name_en}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Main 12-Column Organized Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Primary Column (8 cols): Inquiry Specs, Structured Form Data, Notes, Follow-ups */}
        <div className="lg:col-span-8 space-y-6">
          {/* Highlighted Customer Request & Specifications */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-slate-50/60 dark:bg-slate-950/40">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {isAr ? 'تفاصيل الطلب والمقاسات المطلوبة' : 'Requested Products & Specifications'}
                </h3>
              </div>
              {quantitySpecs && (
                <button
                  type="button"
                  onClick={() => handleCopy('specs', `${productSelection ? productSelection + '\n' : ''}${quantitySpecs}`)}
                  className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                >
                  {copiedKey === 'specs' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copiedKey === 'specs' ? (isAr ? 'تم النسخ' : 'Copied') : isAr ? 'نسخ الطلب' : 'Copy Specs'}</span>
                </button>
              )}
            </div>

            <div className="p-5 space-y-4">
              <div>
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                  {t.interestedService}
                </div>
                <div className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  {productSelection || '—'}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
                <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">
                  {isAr ? 'الكمية والمقاسات / ملاحظات العميل من النموذج' : 'Quantities, Dimensions & Client Requirements'}
                </div>
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/80 p-4 text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
                  {quantitySpecs || (isAr ? 'لم يذكر العميل مقاسات إضافية في النموذج.' : 'No additional specifications submitted.')}
                </div>
              </div>
            </div>
          </div>

          {/* Organized Submitted Fields & Original Sheet Answers */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {isAr ? 'بيانات العميل وإجابات النموذج' : 'Structured Fields & Form Answers'}
                </h3>
              </div>
              <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs">
                <button
                  type="button"
                  onClick={() => setAnswersTab('structured')}
                  className={`px-3 py-1 rounded-md font-medium transition-colors ${
                    answersTab === 'structured'
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  {isAr ? 'عرض منظم' : 'Organized'}
                </button>
                <button
                  type="button"
                  onClick={() => setAnswersTab('raw')}
                  className={`px-3 py-1 rounded-md font-medium transition-colors ${
                    answersTab === 'raw'
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  {isAr ? 'كامل أعمدة الشيت' : 'All Sheet Columns'}
                </button>
              </div>
            </div>

            {answersTab === 'structured' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:gap-px bg-slate-200 dark:bg-slate-800">
                {visibleCustomFields.length === 0 ? (
                  <div className="col-span-2 bg-white dark:bg-slate-900 p-5 text-xs text-slate-400">—</div>
                ) : (
                  visibleCustomFields.map((cf) => {
                    const val = customValues[cf.field_key];
                    const isUrl = typeof val === 'string' && val.startsWith('http');
                    const displayVal =
                      typeof val === 'boolean'
                        ? val
                          ? isAr ? 'نعم' : 'Yes'
                          : isAr ? 'لا' : 'No'
                        : Array.isArray(val)
                          ? val.join(' · ')
                          : val || '—';

                    return (
                      <div key={cf.id} className="bg-white dark:bg-slate-900 px-5 py-3.5">
                        <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                          {isAr ? cf.label_ar : cf.label_en}
                        </div>
                        {isUrl ? (
                          <a
                            href={val}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline break-all"
                          >
                            <span>{isAr ? 'فتح رابط المحادثة' : 'Open Inbox Thread'}</span>
                            <ExternalLink className="h-3 w-3 shrink-0" />
                          </a>
                        ) : (
                          <div
                            className={`text-sm font-medium text-slate-900 dark:text-slate-100 break-words whitespace-pre-wrap ${
                              cf.field_type === 'phone' || cf.field_type === 'number' ? 'font-mono tabular-nums' : ''
                            }`}
                            dir={cf.field_type === 'phone' ? 'ltr' : undefined}
                          >
                            {displayVal}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {Object.keys(originalAnswers).length === 0 ? (
                  <div className="p-5 text-xs text-slate-400">—</div>
                ) : (
                  Object.entries(originalAnswers).map(([key, val], idx) => {
                    const labelObj = RAW_KEY_LABELS[key];
                    const label = labelObj ? (isAr ? labelObj.ar : labelObj.en) : key;
                    const strVal = typeof val === 'object' ? JSON.stringify(val) : String(val);
                    const isUrl = strVal.startsWith('http');

                    return (
                      <div
                        key={key}
                        className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-5 py-3 text-xs ${
                          idx % 2 === 1 ? 'bg-slate-50/70 dark:bg-slate-950/40' : ''
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-slate-700 dark:text-slate-300">{label}</div>
                          {label !== key && <div className="text-[10px] font-mono text-slate-400 truncate">{key}</div>}
                        </div>
                        <div className="text-slate-900 dark:text-slate-100 font-medium sm:text-end max-w-md break-words whitespace-pre-wrap">
                          {isUrl ? (
                            <a href={strVal} target="_blank" rel="noreferrer" className="text-blue-600 dark:text-blue-400 underline">
                              {strVal}
                            </a>
                          ) : (
                            strVal
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Internal Notes */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">{t.internalNotes}</h3>
            <form onSubmit={handleAddNote} className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder={isAr ? 'اكتب ملاحظة داخلية حول مكالمة أو عرض سعر...' : 'Add internal note about call or quote...'}
                className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3.5 py-2.5 min-h-[44px] sm:min-h-0 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#0F1E3D] hover:bg-[#162B54] dark:bg-blue-600 dark:hover:bg-blue-700 px-4 min-h-[44px] sm:min-h-0 sm:py-2 text-xs font-semibold text-white transition-colors whitespace-nowrap"
              >
                <Send className="h-3.5 w-3.5" />
                <span>{t.addNote}</span>
              </button>
            </form>

            <div className="mt-4 space-y-2.5">
              {notes.length === 0 ? (
                <div className="text-xs text-slate-400 py-2">
                  {isAr ? 'لا توجد ملاحظات مسجلة بعد' : 'No internal notes recorded yet'}
                </div>
              ) : (
                notes.map((n) => (
                  <div
                    key={n.id}
                    className="rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200/80 dark:border-slate-800 p-3.5 text-xs transition-colors"
                  >
                    <div className="flex items-center justify-between text-slate-500 mb-1">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">{n.author_name || 'System'}</span>
                      <span className="tabular-nums">{new Date(n.created_at).toLocaleString(isAr ? 'ar-EG' : 'en-US')}</span>
                    </div>
                    <p className="text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">{n.content}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Follow-up Tasks */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">{t.followUpTasks}</h3>
            <form onSubmit={handleScheduleFollowUp} className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                type="text"
                value={followUpTitle}
                onChange={(e) => setFollowUpTitle(e.target.value)}
                placeholder={isAr ? 'عنوان المتابعة...' : 'Follow-up task title...'}
                className="sm:col-span-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 min-h-[44px] sm:min-h-0 text-base sm:text-sm"
              />
              <input
                type="datetime-local"
                value={followUpDue}
                onChange={(e) => setFollowUpDue(e.target.value)}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 min-h-[44px] sm:min-h-0 text-base sm:text-sm"
              />
              <button
                type="submit"
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#0F1E3D] hover:bg-[#162B54] dark:bg-blue-600 dark:hover:bg-blue-700 px-4 min-h-[44px] sm:min-h-0 sm:py-2 text-xs font-semibold text-white transition-colors"
              >
                <CalendarPlus className="h-3.5 w-3.5" />
                <span>{t.scheduleFollowUp}</span>
              </button>
            </form>

            <div className="mt-4 space-y-2">
              {followUps.map((f) => {
                const isOverdue = f.status === 'pending' && new Date(f.due_at).getTime() < Date.now();
                return (
                  <div
                    key={f.id}
                    className={`flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-xs ${
                      isOverdue
                        ? 'border-red-200 dark:border-red-900/70 bg-red-50/40 dark:bg-red-950/20'
                        : 'border-slate-200/80 dark:border-slate-800'
                    }`}
                  >
                    <div>
                      <div
                        className={`font-medium ${
                          f.status === 'completed'
                            ? 'line-through text-slate-400'
                            : isOverdue
                              ? 'text-red-700 dark:text-red-300'
                              : 'text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {f.title}
                      </div>
                      <div className="text-slate-500 tabular-nums mt-0.5">
                        {new Date(f.due_at).toLocaleString(isAr ? 'ar-EG' : 'en-US')}
                        {isOverdue && (
                          <span className="ms-2 font-semibold text-red-600 dark:text-red-400">
                            · {isAr ? 'متأخرة' : 'Overdue'}
                          </span>
                        )}
                      </div>
                    </div>
                    {f.status !== 'completed' ? (
                      <button
                        type="button"
                        onClick={() => handleCompleteFollowUp(f.id)}
                        className="inline-flex items-center gap-1 rounded-md border border-emerald-200 dark:border-emerald-800 px-2.5 py-1 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors shrink-0"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span>{t.markComplete}</span>
                      </button>
                    ) : (
                      <span className="text-emerald-600 font-medium shrink-0">{t.filterCompleted}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Context Sidebar Column (4 cols): Contact Info, Campaign Attribution, Activity Timeline */}
        <div className="lg:col-span-4 space-y-6">
          {/* Contact & Assignment Card */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 bg-slate-50/60 dark:bg-slate-950/40">
              <UserCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t.leadProfile}</h3>
            </div>

            <div className="p-5 space-y-4">
              {/* Highlighted Primary Phone Block */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 p-3.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">{t.phone}</div>
                  <div className="text-sm font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5" dir="ltr">
                    {primaryPhone || '—'}
                  </div>
                  {whatsappFormInput && whatsappFormInput !== primaryPhone && (
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5" dir="ltr">
                      WA: {whatsappFormInput}
                    </div>
                  )}
                </div>
                {primaryPhone && (
                  <button
                    type="button"
                    onClick={() => handleCopy('phone', primaryPhone)}
                    className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 text-slate-500 hover:text-blue-600 transition-colors shrink-0"
                    title={isAr ? 'نسخ الرقم' : 'Copy phone'}
                  >
                    {copiedKey === 'phone' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                )}
              </div>

              {/* Email Block */}
              <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 p-3.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">{t.email}</div>
                  <div className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate mt-0.5" dir="ltr">
                    {lead.email || '—'}
                  </div>
                </div>
                {lead.email && (
                  <button
                    type="button"
                    onClick={() => handleCopy('email', lead.email!)}
                    className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2 text-slate-500 hover:text-blue-600 transition-colors shrink-0"
                    title={isAr ? 'نسخ البريد' : 'Copy email'}
                  >
                    {copiedKey === 'email' ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                )}
              </div>

              {userRole !== 'employee' && (
                <div>
                  <label className="block text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">
                    {t.assignedEmployee}
                  </label>
                  <select
                    value={lead.assigned_to_user_id || ''}
                    onChange={(e) => handleAssign(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-xs font-medium"
                  >
                    <option value="">{t.unassigned}</option>
                    {members
                      .filter((m) => m.user_id && m.status === 'active')
                      .map((m) => (
                        <option key={m.id} value={m.user_id!}>
                          {m.full_name || m.display_name || m.invited_email}
                        </option>
                      ))}
                  </select>
                </div>
              )}

              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2.5 text-xs">
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">{t.lastContact}</span>
                  <span className="text-slate-900 dark:text-slate-100 tabular-nums font-medium">
                    {lead.last_contact_at ? lead.last_contact_at.slice(0, 16).replace('T', ' ') : '—'}
                  </span>
                </div>
                <div className="flex justify-between gap-2">
                  <span className="text-slate-500">{t.nextFollowUp}</span>
                  <span className="text-slate-900 dark:text-slate-100 tabular-nums font-medium">
                    {lead.next_follow_up_at ? lead.next_follow_up_at.slice(0, 16).replace('T', ' ') : '—'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Campaign Attribution */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 bg-slate-50/60 dark:bg-slate-950/40">
              <Megaphone className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t.campaignAttribution}</h3>
            </div>
            <div className="p-5 divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              <div className="py-2 flex justify-between gap-3 first:pt-0">
                <span className="text-slate-500">{isAr ? 'المنصة' : 'Platform'}</span>
                <span className="font-semibold text-slate-900 dark:text-slate-100">
                  {platformCode === 'ig'
                    ? 'Instagram'
                    : platformCode === 'fb'
                      ? 'Facebook'
                      : formatSourceDisplay(lead.source, isAr)}
                </span>
              </div>
              <div className="py-2 flex justify-between gap-3">
                <span className="text-slate-500">{t.campaign}</span>
                <span className="text-slate-900 dark:text-slate-100 font-medium text-end">{lead.campaign_name || '—'}</span>
              </div>
              <div className="py-2 flex justify-between gap-3">
                <span className="text-slate-500">{t.adSet}</span>
                <span className="text-slate-900 dark:text-slate-100 text-end">{lead.ad_set_name || '—'}</span>
              </div>
              <div className="py-2 flex justify-between gap-3">
                <span className="text-slate-500">{t.ad}</span>
                <span className="text-slate-900 dark:text-slate-100 text-end">{lead.ad_name || '—'}</span>
              </div>
              <div className="py-2 flex justify-between gap-3 last:pb-0">
                <span className="text-slate-500">{isAr ? 'النموذج' : 'Form'}</span>
                <span className="text-slate-900 dark:text-slate-100 text-end">{lead.form_name || '—'}</span>
              </div>
            </div>
          </div>

          {/* Activity Timeline */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 bg-slate-50/60 dark:bg-slate-950/40">
              <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t.activityTimeline}</h3>
            </div>
            <div className="p-5 space-y-3.5 max-h-96 overflow-y-auto">
              {activities.map((a) => {
                const meta = JSON.parse(a.metadata_json || '{}');
                return (
                  <div
                    key={a.id}
                    className="flex items-start justify-between gap-3 pb-3 border-b last:border-none last:pb-0 border-slate-100 dark:border-slate-800 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-slate-800 dark:text-slate-200 leading-snug">
                        {isAr ? a.description_ar : a.description_en}
                      </p>
                      <p className="text-slate-400 mt-1 tabular-nums">
                        {a.actor_name || 'System'} · {new Date(a.created_at).toLocaleString(isAr ? 'ar-EG' : 'en-US')}
                      </p>
                      {meta.docUrl && (
                        <a
                          href={meta.docUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-blue-600 underline mt-1"
                        >
                          <span>{isAr ? 'فتح مستند جوجل' : 'Open Google Doc'}</span>
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
