import { initializeApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = getAuth(app);

const provider = new GoogleAuthProvider();
// Request strictly the configured Workspace scopes
provider.addScope('https://www.googleapis.com/auth/spreadsheets');
provider.addScope('https://www.googleapis.com/auth/drive.readonly');
provider.addScope('https://www.googleapis.com/auth/documents');

// Strictly in-memory token cache (never stored in localStorage or sessionStorage)
let cachedGoogleAccessToken: string | null = null;

export function initFirebaseAuth(
  onUserChanged: (user: User | null, googleAccessToken: string | null) => void
) {
  return onAuthStateChanged(auth, (user) => {
    if (!user) {
      cachedGoogleAccessToken = null;
    }
    onUserChanged(user, cachedGoogleAccessToken);
  });
}

export async function signInWithGoogleWorkspace(): Promise<{
  user: User;
  googleAccessToken: string | null;
}> {
  const result = await signInWithPopup(auth, provider);
  const credential = GoogleAuthProvider.credentialFromResult(result);
  cachedGoogleAccessToken = credential?.accessToken || null;
  return {
    user: result.user,
    googleAccessToken: cachedGoogleAccessToken,
  };
}

export async function getFirebaseIdToken(): Promise<string | null> {
  if (!auth.currentUser) return null;
  return await auth.currentUser.getIdToken();
}

export function getGoogleWorkspaceAccessToken(): string | null {
  return cachedGoogleAccessToken;
}

export async function logoutFirebase(): Promise<void> {
  cachedGoogleAccessToken = null;
  await signOut(auth);
}

export function formatFirebaseAuthError(err: unknown, isAr: boolean): string {
  const code = (err as { code?: string })?.code || '';
  const message = err instanceof Error ? err.message : String(err || '');

  if (code === 'auth/unauthorized-domain' || message.includes('auth/unauthorized-domain')) {
    const host = typeof window !== 'undefined' ? window.location.hostname : 'this domain';
    const projectId = firebaseConfig.projectId || 'Firebase';
    return isAr
      ? `النطاق (${host}) غير مصرح به في Firebase Auth. أضف "${host}" في Firebase Console ← Authentication ← Settings ← Authorized domains (مشروع ${projectId}).`
      : `Domain (${host}) is not authorized in Firebase Auth. Add "${host}" in Firebase Console → Authentication → Settings → Authorized domains (project ${projectId}).`;
  }

  if (code === 'auth/popup-blocked') {
    return isAr
      ? 'منع المتصفح نافذة تسجيل الدخول المنبثقة — اسمح بالـ Popups ثم أعد المحاولة.'
      : 'Sign-in popup was blocked by your browser — please allow popups and try again.';
  }

  if (code === 'auth/popup-closed-by-user') {
    return isAr
      ? 'تم إغلاق نافذة تسجيل الدخول قبل إكمال الدخول.'
      : 'Sign-in popup was closed before completing authentication.';
  }

  return message || (isAr ? 'فشل تسجيل الدخول' : 'Sign in failed');
}
