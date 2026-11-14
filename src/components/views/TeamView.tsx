import React, { useState } from 'react';
import { UserPlus, RefreshCw, ShieldCheck } from 'lucide-react';
import { Business, Language, Role, TeamMember } from '../../types/crm';
import { getT } from '../../i18n/translations';
import { apiRequest } from '../../lib/api';

interface TeamViewProps {
  lang: Language;
  business: Business;
  userRole: Role;
  members: TeamMember[];
  onRefresh: () => void;
  onNotify: (msg: string, variant?: 'success' | 'error' | 'info') => void;
}

export const TeamView: React.FC<TeamViewProps> = ({
  lang,
  business,
  userRole,
  members,
  onRefresh,
  onNotify,
}) => {
  const t = getT(lang);
  const isAr = lang === 'ar';
  const isAdmin = userRole === 'business_admin' || userRole === 'super_admin';

  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<Role>('employee');
  const [inviting, setInviting] = useState(false);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setInviting(true);
    try {
      await apiRequest(`/businesses/${business.id}/members/invite`, {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), displayName: displayName.trim(), role }),
      });
      setEmail('');
      setDisplayName('');
      onNotify(isAr ? 'تم إرسال الدعوة بنجاح' : 'Employee invited successfully', 'success');
      onRefresh();
    } catch (err: any) {
      onNotify(err.message, 'error');
    } finally {
      setInviting(false);
    }
  };

  const handleUpdateMember = async (memberId: string, patch: { role?: Role; status?: string }) => {
    try {
      await apiRequest(`/businesses/${business.id}/members/${memberId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      onNotify(isAr ? 'تم تحديث بيانات العضو' : 'Member updated', 'success');
      onRefresh();
    } catch (err: any) {
      onNotify(err.message, 'error');
    }
  };

  const handleToggleRoundRobin = async () => {
    try {
      await apiRequest(`/businesses/${business.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ roundRobinEnabled: !business.round_robin_enabled }),
      });
      onNotify(isAr ? 'تم تحديث إعداد التوزيع التلقائي' : 'Round-robin setting updated', 'success');
      onRefresh();
    } catch (err: any) {
      onNotify(err.message, 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Round-Robin & Invite Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <RefreshCw className="h-4 w-4 text-blue-600" />
              <span>{t.roundRobinLabel}</span>
            </div>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {isAr
                ? 'عند التفعيل، يتم توزيع العملاء المحتملين الجدد الواردين من إعلانات ميتا وجداول جوجل بالتساوي تلقائياً على الموظفين النشطين.'
                : 'When enabled, incoming leads from Meta Lead Ads and Google Sheets are automatically distributed evenly across active team members.'}
            </p>
          </div>
          <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
              {business.round_robin_enabled ? (isAr ? 'مفعل' : 'Enabled') : isAr ? 'معطل' : 'Disabled'}
            </span>
            {isAdmin && (
              <button
                type="button"
                onClick={handleToggleRoundRobin}
                className={`rounded-lg px-3.5 py-1.5 text-xs font-medium text-white transition-colors ${
                  business.round_robin_enabled
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-slate-700 hover:bg-slate-800'
                }`}
              >
                {business.round_robin_enabled ? (isAr ? 'تعطيل' : 'Disable') : isAr ? 'تفعيل' : 'Enable'}
              </button>
            )}
          </div>
        </div>

        {isAdmin && (
          <div className="lg:col-span-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100 mb-4">
              <UserPlus className="h-4 w-4 text-blue-600" />
              <span>{t.inviteEmployee}</span>
            </div>
            <form onSubmit={handleInvite} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                type="email"
                required
                dir="ltr"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="employee@company.com"
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm"
              />
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={isAr ? 'الاسم الكامل' : 'Full Name'}
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm"
              />
              <div className="flex gap-2">
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                  className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                >
                  <option value="employee">{t.roleEmployee}</option>
                  <option value="manager">{t.roleManager}</option>
                  <option value="business_admin">{t.roleBusinessAdmin}</option>
                </select>
                <button
                  type="submit"
                  disabled={inviting}
                  className="rounded-lg bg-[#0F1E3D] dark:bg-blue-600 px-4 py-2 text-xs font-medium text-white whitespace-nowrap"
                >
                  {isAr ? 'دعوة' : 'Invite'}
                </button>
              </div>
            </form>
            <p className="mt-2.5 text-xs text-slate-500 dark:text-slate-400">
              {isAr
                ? 'بمجرد تسجيل دخول الموظف بنفس البريد الإلكتروني عبر جوجل، يتم تفعيل صلاحياته داخل مساحة العمل تلقائياً.'
                : 'Once the invited user signs in with Google using that email address, their workspace access activates automatically.'}
            </p>
          </div>
        )}
      </div>

      {/* Team Members Table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t.navTeam}</h3>
          <span className="inline-flex items-center gap-1 text-xs text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            <span>{isAr ? 'التحقق من الصلاحيات مفعل على الخادم' : 'Server-enforced RBAC'}</span>
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-start border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-500 font-semibold">
                <th className="py-3 px-4 text-start">{t.customerName}</th>
                <th className="py-3 px-4 text-start">{t.email}</th>
                <th className="py-3 px-4 text-start">{isAr ? 'الدور' : 'Role'}</th>
                <th className="py-3 px-4 text-start">{t.status}</th>
                <th className="py-3 px-4 text-end">{t.totalLeads}</th>
                <th className="py-3 px-4 text-end">{t.convertedLeads}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {members.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">
                    {m.full_name || m.display_name || '—'}
                  </td>
                  <td className="py-3 px-4 text-slate-600 dark:text-slate-300" dir="ltr">
                    {m.invited_email}
                  </td>
                  <td className="py-3 px-4">
                    {isAdmin ? (
                      <select
                        value={m.role}
                        onChange={(e) => handleUpdateMember(m.id, { role: e.target.value as Role })}
                        className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-xs"
                      >
                        <option value="business_admin">{t.roleBusinessAdmin}</option>
                        <option value="manager">{t.roleManager}</option>
                        <option value="employee">{t.roleEmployee}</option>
                      </select>
                    ) : (
                      <span>{m.role}</span>
                    )}
                  </td>
                  <td className="py-3 px-4">
                    {isAdmin ? (
                      <select
                        value={m.status}
                        onChange={(e) => handleUpdateMember(m.id, { status: e.target.value })}
                        className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-xs"
                      >
                        <option value="active">{t.active}</option>
                        <option value="invited">{t.invited}</option>
                        <option value="inactive">{t.inactive}</option>
                      </select>
                    ) : (
                      <span>{m.status}</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-end tabular-nums font-medium">{m.total_leads || 0}</td>
                  <td className="py-3 px-4 text-end tabular-nums font-semibold text-emerald-600">
                    {m.converted_leads || 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
