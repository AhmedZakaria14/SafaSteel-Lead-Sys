import React, { useState } from 'react';
import {
  UserPlus,
  RefreshCw,
  ShieldCheck,
  Crown,
  Database,
  Trash2,
  CheckCircle2,
  KeyRound,
  Lock,
} from 'lucide-react';
import {
  AccountSlot,
  Business,
  Language,
  Role,
  TeamMember,
  UserProfile,
} from '../../types/crm';
import { getT } from '../../i18n/translations';
import { apiRequest } from '../../lib/api';
import { DEFAULT_ADMIN_USERNAME, MASTER_OWNER_EMAIL } from '../../lib/constants';

interface TeamViewProps {
  lang: Language;
  business: Business;
  userRole: Role;
  currentUser: UserProfile;
  members: TeamMember[];
  onRefresh: () => void;
  onNotify: (msg: string, variant?: 'success' | 'error' | 'info') => void;
}

export const TeamView: React.FC<TeamViewProps> = ({
  lang,
  business,
  userRole,
  currentUser,
  members,
  onRefresh,
  onNotify,
}) => {
  const t = getT(lang);
  const isAr = lang === 'ar';
  const isAdmin = userRole === 'business_admin' || userRole === 'super_admin';
  const isCurrentOwner =
    Boolean(currentUser.isOwner) ||
    currentUser.username?.toLowerCase() === DEFAULT_ADMIN_USERNAME ||
    currentUser.email?.toLowerCase() === MASTER_OWNER_EMAIL;

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [accountSlot, setAccountSlot] = useState<AccountSlot>('accountant');
  const [submitting, setSubmitting] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);

  const handleCreateOrUpdateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUsername = username.trim().toLowerCase();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanUsername && !cleanEmail) return;
    if (password && password.length < 6) {
      onNotify(
        isAr ? 'يجب أن تكون كلمة المرور 6 أحرف على الأقل' : 'Password must be at least 6 characters',
        'error'
      );
      return;
    }

    setSubmitting(true);
    try {
      await apiRequest(`/businesses/${business.id}/members/invite`, {
        method: 'POST',
        body: JSON.stringify({
          username: cleanUsername || undefined,
          password: password || undefined,
          email: cleanEmail || undefined,
          displayName: displayName.trim(),
          accountSlot,
          role: 'business_admin',
        }),
      });

      setUsername('');
      setPassword('');
      setEmail('');
      setDisplayName('');
      onNotify(
        isAr
          ? `تم حفظ الحساب (${cleanUsername || cleanEmail}) بصلاحية كاملة في قاعدة البيانات`
          : `Saved account (${cleanUsername || cleanEmail}) with full access in database`,
        'success'
      );
      onRefresh();
    } catch (err: any) {
      onNotify(err.message || 'Failed to save account', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateMember = async (
    member: TeamMember,
    patch: { accountSlot?: AccountSlot; status?: string; displayName?: string; password?: string }
  ) => {
    try {
      await apiRequest(`/businesses/${business.id}/members/${member.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...patch,
          role: 'business_admin',
        }),
      });

      onNotify(isAr ? 'تم تحديث بيانات الحساب والصلاحيات' : 'Account updated', 'success');
      onRefresh();
    } catch (err: any) {
      onNotify(err.message, 'error');
    }
  };

  const handleRemoveMember = async (member: TeamMember) => {
    const isProtected =
      Boolean(member.is_owner) ||
      member.username?.toLowerCase() === DEFAULT_ADMIN_USERNAME ||
      member.invited_email.toLowerCase() === MASTER_OWNER_EMAIL;
    if (isProtected) return;
    try {
      await apiRequest(`/businesses/${business.id}/members/${member.id}`, {
        method: 'DELETE',
      });
      onNotify(
        isAr
          ? `تم حذف صلاحية الحساب ${member.username || member.invited_email}`
          : `Revoked access for ${member.username || member.invited_email}`,
        'info'
      );
      onRefresh();
    } catch (err: any) {
      onNotify(err.message, 'error');
    }
  };

  const handleChangeMyPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      onNotify(
        isAr ? 'كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل' : 'New password must be at least 6 characters',
        'error'
      );
      return;
    }
    setChangingPassword(true);
    try {
      await apiRequest('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });
      setCurrentPassword('');
      setNewPassword('');
      onNotify(isAr ? 'تم تحديث كلمة المرور بنجاح' : 'Password updated successfully', 'success');
    } catch (err: any) {
      onNotify(err.message || 'Failed to update password', 'error');
    } finally {
      setChangingPassword(false);
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

  const managerCount = members.filter((m) => (m.account_slot || 'accountant') === 'manager').length;
  const accountantCount = members.filter((m) => (m.account_slot || 'accountant') === 'accountant').length;

  return (
    <div className="space-y-6">
      {/* System Accounts Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20 p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold text-amber-950 dark:text-amber-200">
              <Crown className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <span>{isAr ? 'حساب المدير الرئيسي' : 'Primary Manager Account'}</span>
            </div>
            <span className="rounded-md bg-amber-100 dark:bg-amber-900/50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-200">
              {isAr ? 'صلاحية كاملة' : 'Full Access'}
            </span>
          </div>
          <div className="mt-2.5 flex items-center gap-2 text-xs">
            <span className="text-slate-500 dark:text-slate-400">{t.usernameLabel}:</span>
            <span className="font-mono font-bold text-slate-900 dark:text-slate-100" dir="ltr">
              {DEFAULT_ADMIN_USERNAME}
            </span>
          </div>
          <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            {isAr
              ? 'حساب الإدارة الرئيسي المعرّف في قاعدة البيانات بجميع صلاحيات لوحة التحكم وإدارة الحسابات وربط الشيت.'
              : 'Primary admin account seeded in the database with full system, workspace, and account control.'}
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
              <ShieldCheck className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span>{isAr ? 'حسابا النظام المعتمدان' : 'Two Full-Access System Accounts'}</span>
            </div>
            <span className="rounded-md bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:text-blue-300 tabular-nums">
              {members.length}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2.5 text-xs">
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3">
              <div className="text-slate-500 dark:text-slate-400">{isAr ? 'حساب المدير' : 'Manager'}</div>
              <div className="mt-1 text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {managerCount}
              </div>
              <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                {isAr ? 'صلاحية كاملة 100%' : '100% Full Access'}
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-3">
              <div className="text-slate-500 dark:text-slate-400">{isAr ? 'حساب المحاسب' : 'Accountant'}</div>
              <div className="mt-1 text-base font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {accountantCount}
              </div>
              <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                {isAr ? 'صلاحية كاملة 100%' : '100% Full Access'}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                <span>{isAr ? 'المصادقة وقواعد البيانات' : 'Database Authentication'}</span>
              </div>
              <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="h-3 w-3" />
                <span>{isAr ? 'نشط ومؤمن' : 'Active'}</span>
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {isAr
                ? 'يتم التحقق من اسم المستخدم وكلمة المرور وتشفيرها في قاعدة البيانات مع ربط تلقائي بمساحة الصفا ستيل.'
                : 'Credentials are hashed with scrypt and verified in the database with instant workspace access.'}
            </p>
          </div>
          <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
            <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
              <span>{t.roundRobinLabel}</span>
            </span>
            {isAdmin && (
              <button
                type="button"
                onClick={handleToggleRoundRobin}
                className={`rounded-md px-2.5 py-1 text-xs font-medium text-white transition-colors ${
                  business.round_robin_enabled
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-slate-700 hover:bg-slate-800'
                }`}
              >
                {business.round_robin_enabled ? (isAr ? 'مفعل' : 'Enabled') : isAr ? 'معطل' : 'Disabled'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Change Current User Password */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
            <KeyRound className="h-4 w-4 text-blue-600" />
            <span>
              {isAr
                ? `تغيير كلمة المرور للحساب الحالي (${currentUser.username || currentUser.email})`
                : `Change Password (${currentUser.username || currentUser.email})`}
            </span>
          </div>
        </div>
        <form onSubmit={handleChangeMyPassword} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <input
            type="password"
            dir="ltr"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder={isAr ? 'كلمة المرور الحالية' : 'Current password'}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm"
          />
          <input
            type="password"
            dir="ltr"
            required
            minLength={6}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder={isAr ? 'كلمة المرور الجديدة (6+ أحرف)' : 'New password (6+ chars)'}
            className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={changingPassword}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-[#0F1E3D] dark:bg-blue-600 hover:opacity-95 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            <Lock className="h-3.5 w-3.5" />
            <span>{changingPassword ? t.loading : isAr ? 'تحديث كلمة المرور' : 'Update Password'}</span>
          </button>
        </form>
      </div>

      {/* Add / Update Username + Password Account */}
      {isAdmin && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
              <UserPlus className="h-4 w-4 text-blue-600" />
              <span>
                {isAr
                  ? 'إضافة أو تحديث حساب مستخدم (باسم مستخدم وكلمة مرور)'
                  : 'Create or Update Account (Username & Password)'}
              </span>
            </div>
            {isCurrentOwner && (
              <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                {isAr ? 'صلاحية المالك مفعلة' : 'Owner permissions active'}
              </span>
            )}
          </div>

          <form onSubmit={handleCreateOrUpdateAccount} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <input
              type="text"
              required
              dir="ltr"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={isAr ? 'اسم المستخدم (مثال: accountant2)' : 'Username (e.g. accountant2)'}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm"
            />
            <input
              type="password"
              required
              minLength={6}
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isAr ? 'كلمة المرور' : 'Password'}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm"
            />
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={isAr ? 'الاسم المعروض' : 'Display name'}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm"
            />
            <input
              type="email"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={isAr ? 'البريد (اختياري)' : 'Email (optional)'}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm"
            />
            <select
              value={accountSlot}
              onChange={(e) => setAccountSlot(e.target.value as AccountSlot)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
            >
              <option value="accountant">
                {isAr ? 'حساب المحاسب (صلاحية كاملة)' : 'Accountant (Full Access)'}
              </option>
              <option value="manager">
                {isAr ? 'حساب المدير (صلاحية كاملة)' : 'Manager (Full Access)'}
              </option>
            </select>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-[#0F1E3D] dark:bg-blue-600 hover:opacity-95 px-4 py-2 text-xs font-semibold text-white whitespace-nowrap disabled:opacity-50"
            >
              {submitting
                ? isAr
                  ? 'جاري الحفظ...'
                  : 'Saving...'
                : isAr
                  ? 'حفظ ومنح الصلاحية'
                  : 'Save Account'}
            </button>
          </form>
        </div>
      )}

      {/* Accounts Table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{t.navTeam}</h3>
          <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            <span>
              {isAr
                ? 'صلاحيات كاملة للحسابين · محفوظة في قاعدة البيانات'
                : 'Full Permissions on Both Accounts · Persisted in Database'}
            </span>
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-start border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-500 font-semibold">
                <th className="py-3 px-4 text-start">{t.customerName}</th>
                <th className="py-3 px-4 text-start">{t.usernameLabel}</th>
                <th className="py-3 px-4 text-start">{t.email}</th>
                <th className="py-3 px-4 text-start">{isAr ? 'نوع الحساب' : 'Account Type'}</th>
                <th className="py-3 px-4 text-start">{isAr ? 'مستوى الصلاحية' : 'Access Level'}</th>
                <th className="py-3 px-4 text-start">{t.status}</th>
                <th className="py-3 px-4 text-end">{t.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {members.map((m) => {
                const emailLower = m.invited_email.toLowerCase();
                const isOwnerRow =
                  Boolean(m.is_owner) ||
                  m.username?.toLowerCase() === DEFAULT_ADMIN_USERNAME ||
                  emailLower === MASTER_OWNER_EMAIL;
                const slot: AccountSlot = m.account_slot || (isOwnerRow ? 'manager' : 'accountant');

                return (
                  <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">
                      <div className="flex items-center gap-2">
                        <span>{m.full_name || m.display_name || '—'}</span>
                        {isOwnerRow && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 dark:bg-amber-900/50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:text-amber-200">
                            <Crown className="h-3 w-3" />
                            <span>{isAr ? 'الرئيسي' : 'Owner'}</span>
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono font-semibold text-slate-800 dark:text-slate-200" dir="ltr">
                      {m.username || emailLower.split('@')[0]}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-500 dark:text-slate-400" dir="ltr">
                      {m.invited_email}
                    </td>
                    <td className="py-3 px-4">
                      {isAdmin && !isOwnerRow ? (
                        <select
                          value={slot}
                          onChange={(e) =>
                            handleUpdateMember(m, { accountSlot: e.target.value as AccountSlot })
                          }
                          className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-xs font-medium"
                        >
                          <option value="manager">{isAr ? 'حساب المدير' : 'Manager Account'}</option>
                          <option value="accountant">{isAr ? 'حساب المحاسب' : 'Accountant Account'}</option>
                        </select>
                      ) : (
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {slot === 'manager'
                            ? isAr
                              ? 'حساب المدير'
                              : 'Manager Account'
                            : isAr
                              ? 'حساب المحاسب'
                              : 'Accountant Account'}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                        <CheckCircle2 className="h-3 w-3" />
                        <span>{isAr ? 'صلاحية كاملة' : 'Full Access'}</span>
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      {isAdmin && !isOwnerRow ? (
                        <select
                          value={m.status}
                          onChange={(e) => handleUpdateMember(m, { status: e.target.value })}
                          className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1 text-xs"
                        >
                          <option value="active">{t.active}</option>
                          <option value="invited">{t.invited}</option>
                          <option value="inactive">{t.inactive}</option>
                        </select>
                      ) : (
                        <span className="font-medium text-emerald-600 dark:text-emerald-400">
                          {t.active}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-end">
                      {!isOwnerRow && isAdmin ? (
                        <button
                          type="button"
                          onClick={() => handleRemoveMember(m)}
                          className="inline-flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 text-[11px] font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30"
                          title={isAr ? 'حذف / سحب الصلاحية' : 'Revoke access'}
                        >
                          <Trash2 className="h-3 w-3" />
                          <span>{isAr ? 'حذف' : 'Delete'}</span>
                        </button>
                      ) : (
                        <span className="text-[11px] text-slate-400">
                          {isAr ? 'حساب محمي' : 'Protected'}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
