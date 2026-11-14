import React, { useState } from 'react';
import { Eye, EyeOff, KeyRound, Languages, Lock, Moon, ShieldCheck, Sun, User } from 'lucide-react';
import { Business, Language, ThemeMode, UserProfile } from '../../types/crm';
import { getT } from '../../i18n/translations';
import { apiRequest, setAuthToken } from '../../lib/api';

interface LoginResponse {
  token: string;
  user: UserProfile;
  businesses: Business[];
  demoBusinesses: Business[];
}

interface LoginScreenProps {
  lang: Language;
  theme: ThemeMode;
  onToggleLang: () => void;
  onToggleTheme: () => void;
  onLoginSuccess: (data: LoginResponse) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  lang,
  theme,
  onToggleLang,
  onToggleTheme,
  onLoginSuccess,
}) => {
  const t = getT(lang);
  const isAr = lang === 'ar';

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setErrorMsg(
        isAr ? 'يرجى إدخال اسم المستخدم وكلمة المرور' : 'Please enter both username and password'
      );
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await apiRequest<LoginResponse>('/auth/login', {
        method: 'POST',
        skipAuthRedirect: true,
        body: JSON.stringify({
          username: username.trim(),
          password,
        }),
      });
      setAuthToken(res.token);
      onLoginSuccess(res);
    } catch (err: any) {
      const raw = String(err?.message || '');
      if (raw.toLowerCase().includes('invalid username')) {
        setErrorMsg(
          isAr ? 'اسم المستخدم أو كلمة المرور غير صحيحة' : 'Invalid username or password'
        );
      } else if (raw.toLowerCase().includes('deactivated')) {
        setErrorMsg(
          isAr ? 'تم تعطيل هذا الحساب — تواصل مع المدير' : 'This account has been deactivated'
        );
      } else {
        setErrorMsg(raw || (isAr ? 'تعذر تسجيل الدخول' : 'Sign in failed'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-between bg-slate-50 dark:bg-[#090E1A] text-slate-900 dark:text-slate-100 px-4 py-6">
      <div className="max-w-md w-full mx-auto flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onToggleLang}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
        >
          <Languages className="h-3.5 w-3.5" />
          <span>{lang === 'ar' ? 'EN' : 'العربية'}</span>
        </button>
        <button
          type="button"
          onClick={onToggleTheme}
          className="rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          aria-label="Toggle theme"
        >
          {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </button>
      </div>

      <div className="max-w-md w-full mx-auto my-auto py-8">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl shadow-slate-200/50 dark:shadow-none overflow-hidden crm-animate-enter">
          <div className="bg-[#0F1E3D] px-6 py-6 text-white">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-blue-300">
                  {t.brandName}
                </div>
                <h1 className="mt-1 text-xl font-bold tracking-tight">
                  {isAr ? 'الصفا ستيل | إدارة العملاء' : 'Al-Safa Steel CRM'}
                </h1>
              </div>
              <div className="h-11 w-11 rounded-xl bg-white/10 border border-white/15 flex items-center justify-center shrink-0">
                <KeyRound className="h-5 w-5 text-blue-200" />
              </div>
            </div>
            <p className="mt-2.5 text-xs text-slate-300 leading-relaxed">{t.loginSubtitle}</p>
          </div>

          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {errorMsg && (
              <div
                role="alert"
                className="rounded-lg border border-red-200 dark:border-red-900/70 bg-red-50 dark:bg-red-950/30 px-3.5 py-2.5 text-xs font-medium text-red-700 dark:text-red-300"
              >
                {errorMsg}
              </div>
            )}

            <div>
              <label
                htmlFor="login-username"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
              >
                {t.usernameLabel}
              </label>
              <div className="relative">
                <User className="h-4 w-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
                <input
                  id="login-username"
                  type="text"
                  dir="ltr"
                  autoComplete="username"
                  autoFocus
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="admin"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 ps-9 pe-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white dark:focus:bg-slate-950"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="login-password"
                className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5"
              >
                {t.passwordLabel}
              </label>
              <div className="relative">
                <Lock className="h-4 w-4 text-slate-400 absolute top-1/2 -translate-y-1/2 start-3 pointer-events-none" />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  dir="ltr"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 ps-9 pe-10 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:bg-white dark:focus:bg-slate-950"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute top-1/2 -translate-y-1/2 end-2.5 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full rounded-lg bg-[#0F1E3D] hover:bg-[#162B54] dark:bg-blue-600 dark:hover:bg-blue-700 py-2.5 px-4 text-sm font-semibold text-white transition-colors disabled:opacity-60"
            >
              {submitting ? t.signingIn : t.signIn}
            </button>

            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
              <span>
                {isAr
                  ? 'دخول مؤمّن ومرتبط مباشرة بقاعدة البيانات ومساحة عمل الصفا ستيل'
                  : 'Secured login linked directly to Al-Safa Steel database & sheet workspace'}
              </span>
            </div>
          </form>
        </div>
      </div>

      <div className="text-center text-[11px] text-slate-400">
        {isAr ? 'الصفا ستيل — نظام إدارة العملاء والمبيعات' : 'Al-Safa Steel — LeadFlow CRM'}
      </div>
    </div>
  );
};
