import React, { useState } from 'react';
import { Building2, X } from 'lucide-react';
import { Language } from '../../types/crm';

interface WorkspaceWizardModalProps {
  open: boolean;
  lang: Language;
  onClose: () => void;
  onCreate: (payload: {
    name: string;
    industry: string;
    phone: string;
    email: string;
    defaultCountryCode: string;
  }) => Promise<void>;
}

export const WorkspaceWizardModal: React.FC<WorkspaceWizardModalProps> = ({
  open,
  lang,
  onClose,
  onCreate,
}) => {
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [countryCode, setCountryCode] = useState('+966');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const isAr = lang === 'ar';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError(isAr ? 'يرجى إدخال اسم النشاط التجاري' : 'Business name is required');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onCreate({
        name: name.trim(),
        industry: industry.trim() || 'General',
        phone: phone.trim(),
        email: email.trim(),
        defaultCountryCode: countryCode,
      });
      setName('');
      setIndustry('');
      setPhone('');
      setEmail('');
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create workspace');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs p-0 sm:p-4">
      <div className="w-full max-w-lg max-h-[92dvh] overflow-y-auto rounded-t-2xl sm:rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl p-5 sm:p-6 pb-safe crm-sheet-enter">
        <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0F1E3D] text-white dark:bg-blue-600">
              <Building2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
                {isAr ? 'إنشاء مساحة عمل جديدة' : 'Create Business Workspace'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                {isAr
                  ? 'بيئة عمل معزولة بالكامل بعملائها ومراحلها وفريقها'
                  : 'Isolated tenant workspace with independent leads, pipeline & team'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 sm:mt-5 space-y-4">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/40 dark:border-red-900 px-3 py-2 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
              {isAr ? 'اسم النشاط التجاري *' : 'Business Name *'}
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={isAr ? 'مثال: شركة النخبة للخدمات' : 'e.g. Vertex Services Group'}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 min-h-[44px] sm:min-h-0 text-base sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 sm:gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                {isAr ? 'القطاع / التصنيف' : 'Industry / Category'}
              </label>
              <input
                type="text"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder={isAr ? 'عقارات، عيادات، تجارة...' : 'Services, Retail, Health...'}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 min-h-[44px] sm:min-h-0 text-base sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                {isAr ? 'رمز الدولة الافتراضي (لواتساب)' : 'Default Country Code'}
              </label>
              <select
                value={countryCode}
                onChange={(e) => setCountryCode(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 min-h-[44px] sm:min-h-0 text-base sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                <option value="+966">+966 (Saudi Arabia)</option>
                <option value="+971">+971 (UAE)</option>
                <option value="+20">+20 (Egypt)</option>
                <option value="+965">+965 (Kuwait)</option>
                <option value="+974">+974 (Qatar)</option>
                <option value="+962">+962 (Jordan)</option>
                <option value="+1">+1 (US / Canada)</option>
                <option value="+44">+44 (UK)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 sm:gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                {isAr ? 'رقم الهاتف' : 'Business Phone'}
              </label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                dir="ltr"
                placeholder="+966 50 000 0000"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 min-h-[44px] sm:min-h-0 text-base sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                {isAr ? 'البريد الإلكتروني الرسمي' : 'Business Email'}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                dir="ltr"
                placeholder="contact@company.com"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 min-h-[44px] sm:min-h-0 text-base sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 min-h-[44px] sm:min-h-0 sm:py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
            >
              {isAr ? 'إلغاء' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-[#0F1E3D] hover:bg-[#162B54] dark:bg-blue-600 dark:hover:bg-blue-700 px-5 min-h-[44px] sm:min-h-0 sm:py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {submitting ? (isAr ? 'جاري الإنشاء...' : 'Creating...') : isAr ? 'إنشاء المساحة' : 'Create Workspace'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
