import React, { useEffect, useState } from 'react';
import { Plus, Trash2, Download, Shield, Building2 } from 'lucide-react';
import { Business, CustomField, CustomFieldType, Language, Role } from '../../types/crm';
import { getT } from '../../i18n/translations';
import { apiRequest } from '../../lib/api';
import { formatCairoDateTime } from '../../lib/dateFormat';

interface SettingsViewProps {
  lang: Language;
  business: Business;
  userRole: Role;
  customFields: CustomField[];
  onRefreshBusiness: () => void;
  onRefreshFields: () => void;
  onNotify: (msg: string, variant?: 'success' | 'error' | 'info') => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  lang,
  business,
  userRole,
  customFields,
  onRefreshBusiness,
  onRefreshFields,
  onNotify,
}) => {
  const t = getT(lang);
  const isAr = lang === 'ar';
  const isAdmin = userRole === 'business_admin' || userRole === 'super_admin';

  const [name, setName] = useState(business.name);
  const [industry, setIndustry] = useState(business.industry);
  const [phone, setPhone] = useState(business.phone || '');
  const [email, setEmail] = useState(business.email || '');
  const [website, setWebsite] = useState(business.website || '');
  const [countryCode, setCountryCode] = useState(business.default_country_code || '+966');
  const [savingBiz, setSavingBiz] = useState(false);

  // Custom field builder
  const [labelAr, setLabelAr] = useState('');
  const [labelEn, setLabelEn] = useState('');
  const [fieldType, setFieldType] = useState<CustomFieldType>('text');
  const [optionsText, setOptionsText] = useState('');
  const [auditLogs, setAuditLogs] = useState<any[]>([]);

  useEffect(() => {
    setName(business.name);
    setIndustry(business.industry);
    setPhone(business.phone || '');
    setEmail(business.email || '');
    setWebsite(business.website || '');
    setCountryCode(business.default_country_code || '+966');
    if (isAdmin) {
      apiRequest<{ logs: any[] }>(`/businesses/${business.id}/audit-logs`)
        .then((res) => setAuditLogs(res.logs || []))
        .catch(() => setAuditLogs([]));
    }
  }, [business.id]);

  const handleSaveBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingBiz(true);
    try {
      await apiRequest(`/businesses/${business.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name, industry, phone, email, website, defaultCountryCode: countryCode }),
      });
      onNotify(isAr ? 'تم حفظ إعدادات النشاط التجاري' : 'Business settings saved', 'success');
      onRefreshBusiness();
    } catch (err: any) {
      onNotify(err.message, 'error');
    } finally {
      setSavingBiz(false);
    }
  };

  const handleAddField = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!labelAr.trim() || !labelEn.trim()) return;
    try {
      const options = optionsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      await apiRequest(`/businesses/${business.id}/custom-fields`, {
        method: 'POST',
        body: JSON.stringify({
          labelAr: labelAr.trim(),
          labelEn: labelEn.trim(),
          fieldType,
          options,
        }),
      });
      setLabelAr('');
      setLabelEn('');
      setOptionsText('');
      onNotify(isAr ? 'تمت إضافة الحقل المخصص' : 'Custom field created', 'success');
      onRefreshFields();
    } catch (err: any) {
      onNotify(err.message, 'error');
    }
  };

  const handleDeleteField = async (fieldId: string) => {
    try {
      await apiRequest(`/businesses/${business.id}/custom-fields/${fieldId}`, { method: 'DELETE' });
      onRefreshFields();
      onNotify(isAr ? 'تم حذف الحقل' : 'Field removed', 'info');
    } catch (err: any) {
      onNotify(err.message, 'error');
    }
  };

  const handleDownloadBackup = async () => {
    try {
      const data = await apiRequest<any>(`/businesses/${business.id}/backup`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `leadflow-backup-${business.id.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      onNotify(err.message, 'error');
    }
  };

  return (
    <div className="space-y-4 sm:space-y-6 crm-animate-enter">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* Business Profile */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100 mb-4">
            <Building2 className="h-4 w-4 text-blue-600" />
            <span>{isAr ? 'ملف النشاط التجاري والهوية' : 'Business Profile & Branding'}</span>
          </div>
          <form onSubmit={handleSaveBusiness} className="space-y-4 text-xs">
            <div>
              <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">{t.business}</label>
              <input
                type="text"
                disabled={!isAdmin}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 min-h-[44px] sm:min-h-0 text-base sm:text-sm"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  {isAr ? 'القطاع' : 'Industry'}
                </label>
                <input
                  type="text"
                  disabled={!isAdmin}
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 min-h-[44px] sm:min-h-0 text-base sm:text-sm"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">
                  {isAr ? 'رمز الدولة الافتراضي' : 'Default Country Code'}
                </label>
                <input
                  type="text"
                  dir="ltr"
                  disabled={!isAdmin}
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 min-h-[44px] sm:min-h-0 text-base sm:text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">{t.phone}</label>
                <input
                  type="text"
                  dir="ltr"
                  disabled={!isAdmin}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 min-h-[44px] sm:min-h-0 text-base sm:text-sm"
                />
              </div>
              <div>
                <label className="block font-medium text-slate-700 dark:text-slate-300 mb-1">{t.email}</label>
                <input
                  type="email"
                  dir="ltr"
                  disabled={!isAdmin}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 min-h-[44px] sm:min-h-0 text-base sm:text-sm"
                />
              </div>
            </div>
            {isAdmin && (
              <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-between gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={handleDownloadBackup}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3.5 min-h-[42px] sm:min-h-0 sm:py-2 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>{isAr ? 'نسخة احتياطية كاملة (JSON)' : 'Export Workspace Backup (JSON)'}</span>
                </button>
                <button
                  type="submit"
                  disabled={savingBiz}
                  className="rounded-lg bg-[#0F1E3D] dark:bg-blue-600 px-4 min-h-[42px] sm:min-h-0 sm:py-2 text-xs font-medium text-white"
                >
                  {t.save}
                </button>
              </div>
            )}
          </form>
        </div>

        {/* Custom Lead Fields Builder */}
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-6 space-y-4">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t.customFieldsSection}</h3>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {customFields.length === 0 ? (
              <p className="text-xs text-slate-400">
                {isAr ? 'لم يتم تعريف حقول مخصصة بعد' : 'No custom fields configured yet'}
              </p>
            ) : (
              customFields.map((cf) => (
                <div
                  key={cf.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 dark:border-slate-800 px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-800 dark:text-slate-200 truncate">
                      {cf.label_ar} · {cf.label_en}
                    </div>
                    <div className="text-slate-400 font-mono">{cf.field_type}</div>
                  </div>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => handleDeleteField(cf.id)}
                      className="p-2 text-red-500 hover:text-red-700 shrink-0"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))
            )}
          </div>

          {isAdmin && (
            <form onSubmit={handleAddField} className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  required
                  value={labelAr}
                  onChange={(e) => setLabelAr(e.target.value)}
                  placeholder={isAr ? 'التسمية بالعربية' : 'Arabic Label'}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 min-h-[42px] sm:min-h-0 text-base sm:text-xs"
                />
                <input
                  type="text"
                  required
                  value={labelEn}
                  onChange={(e) => setLabelEn(e.target.value)}
                  placeholder={isAr ? 'التسمية بالإنجليزية' : 'English Label'}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 min-h-[42px] sm:min-h-0 text-base sm:text-xs"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <select
                  value={fieldType}
                  onChange={(e) => setFieldType(e.target.value as CustomFieldType)}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 min-h-[42px] sm:min-h-0 text-base sm:text-xs"
                >
                  <option value="text">Text</option>
                  <option value="number">Number</option>
                  <option value="phone">Phone</option>
                  <option value="email">Email</option>
                  <option value="date">Date</option>
                  <option value="dropdown">Dropdown</option>
                  <option value="checkbox">Checkbox</option>
                  <option value="multi_choice">Multiple Choice</option>
                  <option value="long_text">Long Text</option>
                </select>
                <button
                  type="submit"
                  className="inline-flex items-center justify-center gap-1 rounded-lg bg-[#0F1E3D] dark:bg-blue-600 px-3 min-h-[42px] sm:min-h-0 sm:py-2 font-medium text-white"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>{isAr ? 'إضافة حقل' : 'Add Custom Field'}</span>
                </button>
              </div>
              {(fieldType === 'dropdown' || fieldType === 'multi_choice') && (
                <input
                  type="text"
                  value={optionsText}
                  onChange={(e) => setOptionsText(e.target.value)}
                  placeholder={isAr ? 'الخيارات مفصولة بفاصلة: خيار 1, خيار 2' : 'Options comma-separated: Option A, Option B'}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 min-h-[42px] sm:min-h-0 text-base sm:text-xs"
                />
              )}
            </form>
          )}
        </div>
      </div>

      {/* Audit Logs */}
      {isAdmin && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
            <Shield className="h-4 w-4 text-blue-600" />
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {isAr ? 'سجل التدقيق الأمني (Audit Logs)' : 'Security Audit Logs'}
            </h3>
          </div>
          <div className="md:hidden divide-y divide-slate-100 dark:divide-slate-800 text-xs max-h-72 overflow-y-auto">
            {auditLogs.map((log) => (
              <div key={log.id} className="p-3.5 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">{log.action}</span>
                  <span className="text-slate-500">{log.entity_type}</span>
                </div>
                <div className="flex items-center justify-between text-slate-500 tabular-nums">
                  <span>{log.actor_name || log.actor_email || 'System'}</span>
                  <span className="font-mono" dir="ltr">{formatCairoDateTime(log.created_at, lang)}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="hidden md:block overflow-x-auto max-h-72">
            <table className="w-full text-start border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-500 font-semibold">
                  <th className="py-2.5 px-4 text-start">{isAr ? 'الإجراء' : 'Action'}</th>
                  <th className="py-2.5 px-4 text-start">{isAr ? 'المستخدم' : 'Actor'}</th>
                  <th className="py-2.5 px-4 text-start">{isAr ? 'الكيان' : 'Entity'}</th>
                  <th className="py-2.5 px-4 text-end">{t.createdAt}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="py-2 px-4 font-mono">{log.action}</td>
                    <td className="py-2 px-4">{log.actor_name || log.actor_email || 'System'}</td>
                    <td className="py-2 px-4 text-slate-500">{log.entity_type}</td>
                    <td className="py-2 px-4 text-end font-mono tabular-nums text-slate-400" dir="ltr">
                      {formatCairoDateTime(log.created_at, lang)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
