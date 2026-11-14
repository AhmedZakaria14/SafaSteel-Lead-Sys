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
