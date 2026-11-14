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
} from 'lucide-react';
import { User } from 'firebase/auth';
import {
  AccountSlot,
  Business,
  FirestoreAuthorizedAccount,
  Language,
  Role,
  TeamMember,
} from '../../types/crm';
import { getT } from '../../i18n/translations';
import { apiRequest } from '../../lib/api';
import {
  MASTER_OWNER_EMAIL,
  grantFullAccessInFirestore,
  isMasterOwnerEmail,
  revokeAccessInFirestore,
} from '../../lib/firebase';

interface TeamViewProps {
  lang: Language;
  business: Business;
  userRole: Role;
  firebaseUser: User | null;
  members: TeamMember[];
  firestoreAccounts: FirestoreAuthorizedAccount[];
  onRefresh: () => void;
  onGoogleSignIn: () => void;
  onNotify: (msg: string, variant?: 'success' | 'error' | 'info') => void;
}

export const TeamView: React.FC<TeamViewProps> = ({
  lang,
  business,
  userRole,
  firebaseUser,
  members,
  firestoreAccounts,
  onRefresh,
  onGoogleSignIn,
  onNotify,
}) => {
  const t = getT(lang);
  const isAr = lang === 'ar';
  const isAdmin = userRole === 'business_admin' || userRole === 'super_admin';
  const isSignedInOwner = isMasterOwnerEmail(firebaseUser?.email);

  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [accountSlot, setAccountSlot] = useState<AccountSlot>('accountant');
  const [submitting, setSubmitting] = useState(false);

  const firestoreByEmail = new Map(
    firestoreAccounts.map((a) => [a.email.toLowerCase(), a])
  );

  const handleGrantFullAccess = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) return;
    setSubmitting(true);
    try {
      await apiRequest(`/businesses/${business.id}/members/invite`, {
        method: 'POST',
        body: JSON.stringify({
          email: cleanEmail,
          displayName: displayName.trim(),
          accountSlot,
          role: 'business_admin',
        }),
      });

      if (isSignedInOwner && firebaseUser?.email) {
        await grantFullAccessInFirestore({
          email: cleanEmail,
          displayName: displayName.trim() || undefined,
          accountType: accountSlot,
          grantedByEmail: firebaseUser.email,
        });
      }

      setEmail('');
      setDisplayName('');
      onNotify(
        isSignedInOwner
          ? isAr
            ? `تم منح الصلاحية الكاملة للبريد (${cleanEmail}) وحفظه في Firebase Firestore`
            : `Granted full access to ${cleanEmail} & saved to Firebase Firestore`
          : isAr
            ? `تمت إضافة (${cleanEmail}) بصلاحية كاملة محلياً — سجل الدخول بحساب المالك لحفظه في Firebase`
            : `Added ${cleanEmail} locally — sign in as Owner to persist to Firebase Firestore`,
        'success'
      );
      onRefresh();
    } catch (err: any) {
      onNotify(err.message || 'Failed to grant access', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateMember = async (
    member: TeamMember,
    patch: { accountSlot?: AccountSlot; status?: string; displayName?: string }
  ) => {
    try {
      await apiRequest(`/businesses/${business.id}/members/${member.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          ...patch,
          role: 'business_admin',
        }),
      });

      if (isSignedInOwner && firebaseUser?.email) {
        await grantFullAccessInFirestore({
          email: member.invited_email,
          displayName: patch.displayName ?? (member.full_name || member.display_name || undefined),
          accountType: patch.accountSlot || member.account_slot || 'accountant',
          grantedByEmail: firebaseUser.email,
        });
      }

      onNotify(isAr ? 'تم تحديث بيانات الحساب والصلاحيات' : 'Account permissions updated', 'success');
      onRefresh();
    } catch (err: any) {
      onNotify(err.message, 'error');
    }
  };

  const handleRemoveMember = async (member: TeamMember) => {
    if (member.invited_email.toLowerCase() === MASTER_OWNER_EMAIL) return;
    try {
      await apiRequest(`/businesses/${business.id}/members/${member.id}`, {
        method: 'DELETE',
      });
      if (isSignedInOwner) {
        await revokeAccessInFirestore(member.invited_email);
      }
      onNotify(
        isAr ? `تم سحب صلاحية البريد ${member.invited_email}` : `Revoked access for ${member.invited_email}`,
        'info'
      );
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

  const managerCount = members.filter((m) => (m.account_slot || 'accountant') === 'manager').length;
  const accountantCount = members.filter((m) => (m.account_slot || 'accountant') === 'accountant').length;

  return (
    <div className="space-y-6">
      {/* Master Owner & 2-Account Architecture Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20 p-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-bold text-amber-950 dark:text-amber-200">
              <Crown className="h-4 w-4 text-amber-600 dark:text-amber-400" />
              <span>{isAr ? 'حساب المالك الرئيسي (المدير)' : 'Master Owner Account (Manager)'}</span>
            </div>
            <span className="rounded-md bg-amber-100 dark:bg-amber-900/50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-200">
              {isAr ? 'صلاحية كاملة' : 'Full Access'}
            </span>
          </div>
          <p className="mt-2 font-mono text-xs font-semibold text-slate-900 dark:text-slate-100" dir="ltr">
            {MASTER_OWNER_EMAIL}
          </p>
          <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            {isAr
              ? 'يتعرف عليه النظام تلقائياً عند تسجيل الدخول عبر Google Auth كمالك رئيسي، ويمتلك حق منح أو تعديل الصلاحية الكاملة لأي بريد إلكتروني آخر.'
              : 'Automatically recognized on Google Sign-In as the Master Owner with exclusive authority to grant or revoke full access in Firebase.'}
          </p>
          {!isSignedInOwner && (
            <button
              type="button"
              onClick={onGoogleSignIn}
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-[#0F1E3D] dark:bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:opacity-95"
            >
              <KeyRound className="h-3.5 w-3.5" />
              <span>{isAr ? 'تسجيل الدخول بحساب المالك (Google)' : 'Sign in as Owner (Google)'}</span>
            </button>
          )}
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
                <span>{isAr ? 'الربط الفعلي بـ Firebase' : 'Live Firebase Firestore Sync'}</span>
              </div>
              <span
                className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                  firebaseUser
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                }`}
              >
                <CheckCircle2 className="h-3 w-3" />
                <span>{firebaseUser ? (isAr ? 'متصل' : 'Connected') : isAr ? 'بانتظار الدخول' : 'Sign in'}</span>
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {isAr
                ? 'يتم حفظ الحسابات المسموح لها وقواعد الوصول مباشرة في قاعدة بيانات Cloud Firestore مع مزامنة فورية للنظام.'
                : 'Authorized emails and full-access roles persist directly in Cloud Firestore with real-time synchronization.'}
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

      {/* Grant Full Access to Another Google Email */}
      {isAdmin && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-100">
              <UserPlus className="h-4 w-4 text-blue-600" />
              <span>
                {isAr
                  ? 'إعطاء الإذن الكامل لبريد إلكتروني (حساب المدير أو المحاسب)'
                  : 'Grant Full Access to Any Email (Manager or Accountant)'}
              </span>
            </div>
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
              {isSignedInOwner
                ? isAr
                  ? 'متصل كمالك رئيسي — الحفظ يتم مباشرة في Firebase Firestore'
                  : 'Signed in as Owner — saves directly to Firebase Firestore'
                : isAr
                  ? 'سجل الدخول بحساب azeco77@gmail.com لتفعيل الحفظ السحابي في Firebase'
                  : 'Sign in with azeco77@gmail.com to save directly to Cloud Firestore'}
            </span>
          </div>

          <form onSubmit={handleGrantFullAccess} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <input
              type="email"
              required
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="accountant@gmail.com"
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm"
            />
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={isAr ? 'الاسم (مثال: المحاسب أحمد)' : 'Name (e.g. Accountant)'}
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
                  ? 'منح الصلاحية الكاملة'
                  : 'Grant Full Access'}
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
                ? 'صلاحيات كاملة للحسابين · مرتبط بـ Firebase Auth & Firestore'
                : 'Full Permissions on Both Accounts · Backed by Firebase Auth & Firestore'}
            </span>
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-start border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-500 font-semibold">
                <th className="py-3 px-4 text-start">{t.customerName}</th>
                <th className="py-3 px-4 text-start">{t.email}</th>
                <th className="py-3 px-4 text-start">{isAr ? 'نوع الحساب' : 'Account Type'}</th>
                <th className="py-3 px-4 text-start">{isAr ? 'مستوى الصلاحية' : 'Access Level'}</th>
                <th className="py-3 px-4 text-start">{isAr ? 'حالة Firebase' : 'Firebase Sync'}</th>
                <th className="py-3 px-4 text-start">{t.status}</th>
                <th className="py-3 px-4 text-end">{t.actions}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {members.map((m) => {
                const emailLower = m.invited_email.toLowerCase();
                const isOwnerRow = Boolean(m.is_owner) || emailLower === MASTER_OWNER_EMAIL;
                const slot: AccountSlot = m.account_slot || (isOwnerRow ? 'manager' : 'accountant');
                const syncedInFirestore = firestoreByEmail.has(emailLower);

                return (
                  <tr key={m.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">
                      <div className="flex items-center gap-2">
                        <span>{m.full_name || m.display_name || '—'}</span>
                        {isOwnerRow && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 dark:bg-amber-900/50 px-1.5 py-0.5 text-[10px] font-bold text-amber-800 dark:text-amber-200">
                            <Crown className="h-3 w-3" />
                            <span>{isAr ? 'المالك' : 'Owner'}</span>
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-700 dark:text-slate-300" dir="ltr">
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
                      {syncedInFirestore ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                          <Database className="h-3 w-3" />
                          <span>{isAr ? 'متزامن Firestore' : 'Synced'}</span>
                        </span>
                      ) : (
                        <span className="text-slate-400">
                          {isAr ? 'جاهز للمزامنة' : 'Pending sync'}
                        </span>
                      )}
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
                          <span>{isAr ? 'سحب الإذن' : 'Revoke'}</span>
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
