import React, { useState } from 'react';
import { X } from 'lucide-react';
import { CustomField, Language, PipelineStage, Role, TeamMember } from '../../types/crm';
import { getT } from '../../i18n/translations';

interface CreateLeadModalProps {
  open: boolean;
  lang: Language;
  stages: PipelineStage[];
  customFields: CustomField[];
  members: TeamMember[];
  userRole: Role;
  onClose: () => void;
  onSubmit: (payload: Record<string, any>) => Promise<void>;
}

export const CreateLeadModal: React.FC<CreateLeadModalProps> = ({
  open,
  lang,
  stages,
  customFields,
  members,
  userRole,
  onClose,
  onSubmit,
}) => {
  const t = getT(lang);
  const isAr = lang === 'ar';

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [interestedService, setInterestedService] = useState('');
  const [statusId, setStatusId] = useState(stages[0]?.id || '');
  const [assignedToUserId, setAssignedToUserId] = useState('');
  const [campaignName, setCampaignName] = useState('');
  const [notesSummary, setNotesSummary] = useState('');
  const [customValues, setCustomValues] = useState<Record<string, any>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      setError(isAr ? 'اسم العميل مطلوب' : 'Customer name is required');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await onSubmit({
        fullName: fullName.trim(),
        phone: phone.trim(),
        email: email.trim(),
        interestedService: interestedService.trim(),
        statusId: statusId || stages[0]?.id,
        assignedToUserId: assignedToUserId || null,
        campaignName: campaignName.trim() || null,
        notesSummary: notesSummary.trim() || null,
        customValues,
        source: 'manual',
      });
      setFullName('');
      setPhone('');
      setEmail('');
      setInterestedService('');
      setCampaignName('');
      setNotesSummary('');
      setCustomValues({});
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-950/60 backdrop-blur-xs p-0 sm:p-4">
      <div className="w-full max-w-2xl max-h-[92dvh] overflow-y-auto rounded-t-2xl sm:rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl p-5 sm:p-6 pb-safe crm-sheet-enter">
        <div className="flex items-center justify-between pb-4 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{t.addLead}</h2>
          <button type="button" onClick={onClose} className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 sm:mt-5 space-y-4">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/40 px-3 py-2 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 sm:gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                {t.customerName} *
              </label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 min-h-[44px] sm:min-h-0 text-base sm:text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">{t.phone}</label>
              <input
                type="text"
                dir="ltr"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+966500000000"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 min-h-[44px] sm:min-h-0 text-base sm:text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">{t.email}</label>
              <input
                type="email"
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 min-h-[44px] sm:min-h-0 text-base sm:text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">{t.interestedService}</label>
              <input
                type="text"
                value={interestedService}
                onChange={(e) => setInterestedService(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 min-h-[44px] sm:min-h-0 text-base sm:text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">{t.status}</label>
              <select
                value={statusId}
                onChange={(e) => setStatusId(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 min-h-[44px] sm:min-h-0 text-base sm:text-sm"
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {isAr ? s.name_ar : s.name_en}
                  </option>
                ))}
              </select>
            </div>

            {userRole !== 'employee' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">{t.assignedEmployee}</label>
                <select
                  value={assignedToUserId}
                  onChange={(e) => setAssignedToUserId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 min-h-[44px] sm:min-h-0 text-base sm:text-sm"
                >
                  <option value="">{isAr ? 'تلقائي (Round-Robin إذا مفعل)' : 'Auto (Round-Robin if enabled)'}</option>
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

            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">{t.campaign}</label>
              <input
                type="text"
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 min-h-[44px] sm:min-h-0 text-base sm:text-sm"
              />
            </div>
          </div>

          {/* Dynamic Custom Fields */}
          {customFields.length > 0 && (
            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3">
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">{t.customFieldsSection}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 sm:gap-4">
                {customFields.map((cf) => {
                  const val = customValues[cf.field_key];
                  const label = isAr ? cf.label_ar : cf.label_en;
                  return (
                    <div key={cf.id} className={cf.field_type === 'long_text' ? 'sm:col-span-2' : ''}>
                      <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">{label}</label>
                      {cf.field_type === 'dropdown' ? (
                        <select
                          value={val || ''}
                          onChange={(e) => setCustomValues((p) => ({ ...p, [cf.field_key]: e.target.value }))}
                          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 min-h-[44px] sm:min-h-0 text-base sm:text-sm"
                        >
                          <option value="">—</option>
                          {cf.options.map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : cf.field_type === 'checkbox' ? (
                        <label className="inline-flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 min-h-[36px]">
                          <input
                            type="checkbox"
                            checked={Boolean(val)}
                            onChange={(e) => setCustomValues((p) => ({ ...p, [cf.field_key]: e.target.checked }))}
                          />
                          <span>{label}</span>
                        </label>
                      ) : cf.field_type === 'multi_choice' ? (
                        <div className="flex flex-wrap gap-2">
                          {cf.options.map((opt) => {
                            const selected = Array.isArray(val) ? val.includes(opt) : false;
                            return (
                              <label key={opt} className="inline-flex items-center gap-1.5 text-xs min-h-[36px]">
                                <input
                                  type="checkbox"
                                  checked={selected}
                                  onChange={(e) => {
                                    const prevArr = Array.isArray(val) ? val : [];
                                    const nextArr = e.target.checked
                                      ? [...prevArr, opt]
                                      : prevArr.filter((x: string) => x !== opt);
                                    setCustomValues((p) => ({ ...p, [cf.field_key]: nextArr }));
                                  }}
                                />
                                <span>{opt}</span>
                              </label>
                            );
                          })}
                        </div>
                      ) : cf.field_type === 'long_text' ? (
                        <textarea
                          rows={2}
                          value={val || ''}
                          onChange={(e) => setCustomValues((p) => ({ ...p, [cf.field_key]: e.target.value }))}
                          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-base sm:text-sm"
                        />
                      ) : (
                        <input
                          type={cf.field_type === 'number' ? 'number' : cf.field_type === 'date' ? 'date' : cf.field_type === 'email' ? 'email' : 'text'}
                          value={val || ''}
                          onChange={(e) => setCustomValues((p) => ({ ...p, [cf.field_key]: e.target.value }))}
                          className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 min-h-[44px] sm:min-h-0 text-base sm:text-sm"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">{t.notes}</label>
            <textarea
              rows={2}
              value={notesSummary}
              onChange={(e) => setNotesSummary(e.target.value)}
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-base sm:text-sm"
            />
          </div>

          <div className="pt-3 flex items-center justify-end gap-3 border-t border-slate-200 dark:border-slate-800">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 min-h-[44px] sm:min-h-0 sm:py-2 text-sm">
              {t.cancel}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-[#0F1E3D] hover:bg-[#162B54] dark:bg-blue-600 px-5 min-h-[44px] sm:min-h-0 sm:py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {t.save}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
