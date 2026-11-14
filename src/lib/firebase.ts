import { initializeApp, getApps } from 'firebase/app';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { AccountSlot, FirestoreAuthorizedAccount } from '../types/crm';

export const MASTER_OWNER_EMAIL = 'azeco77@gmail.com';
export const ALSAFA_WORKSPACE_ID = 'alsafa-steel-workspace';

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const firestoreDb = firebaseConfig.firestoreDatabaseId
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);

export function isMasterOwnerEmail(email?: string | null): boolean {
  return Boolean(email && email.trim().toLowerCase() === MASTER_OWNER_EMAIL);
}

// Validate live connection to Firestore on boot
async function testConnection() {
  try {
    await getDocFromServer(doc(firestoreDb, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
if (typeof window !== 'undefined') {
  void testConnection();
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

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

/**
 * Syncs signed-in user profile and ensures Master Owner (azeco77@gmail.com)
 * records exist in real Cloud Firestore.
 */
export async function syncSignedInUserToFirestore(user: User): Promise<void> {
  const email = user.email?.trim().toLowerCase();
  if (!email) return;
  const owner = isMasterOwnerEmail(email);

  const userPath = `users/${user.uid}`;
  try {
    const userRef = doc(firestoreDb, 'users', user.uid);
    const existingSnap = await getDoc(userRef);
    const basePayload = {
      uid: user.uid,
      email,
      fullName: user.displayName || email.split('@')[0],
      accountType: owner ? ('manager' as const) : ('accountant' as const),
      updatedAt: serverTimestamp(),
    };
    if (!existingSnap.exists()) {
      await setDoc(userRef, {
        ...basePayload,
        isOwner: owner,
        defaultLanguage: 'ar',
        theme: 'light',
      });
    } else {
      await updateDoc(userRef, {
        fullName: basePayload.fullName,
        accountType: basePayload.accountType,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, userPath);
  }

  if (owner) {
    const authEmailPath = `authorized_emails/${MASTER_OWNER_EMAIL}`;
    try {
      const ownerAuthRef = doc(firestoreDb, 'authorized_emails', MASTER_OWNER_EMAIL);
      await setDoc(
        ownerAuthRef,
        {
          email: MASTER_OWNER_EMAIL,
          displayName: user.displayName || 'المدير (المالك الرئيسي)',
          accountType: 'manager',
          role: 'full_access',
          isOwner: true,
          status: 'active',
          grantedBy: MASTER_OWNER_EMAIL,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, authEmailPath);
    }

    const bizPath = `businesses/${ALSAFA_WORKSPACE_ID}`;
    try {
      const bizRef = doc(firestoreDb, 'businesses', ALSAFA_WORKSPACE_ID);
      const bizSnap = await getDoc(bizRef);
      if (!bizSnap.exists()) {
        await setDoc(bizRef, {
          name: 'الصفا ستيل | Al-Safa Steel',
          industry: 'حوامل الكابلات وتخريم الصاج (الغرابيل)',
          ownerUid: user.uid,
          ownerEmail: MASTER_OWNER_EMAIL,
          authorizedEmails: [MASTER_OWNER_EMAIL],
          isDemo: false,
          updatedAt: serverTimestamp(),
        });
      } else {
        await updateDoc(bizRef, {
          authorizedEmails: arrayUnion(MASTER_OWNER_EMAIL),
          updatedAt: serverTimestamp(),
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, bizPath);
    }
  }
}

export function subscribeFirestoreAuthorizedAccounts(
  userEmail: string,
  onData: (accounts: FirestoreAuthorizedAccount[]) => void,
  onError?: (err: Error) => void
): () => void {
  const normalized = userEmail.trim().toLowerCase();
  if (!normalized) return () => {};

  if (isMasterOwnerEmail(normalized)) {
    const path = 'authorized_emails';
    return onSnapshot(
      collection(firestoreDb, 'authorized_emails'),
      (snap) => {
        const list: FirestoreAuthorizedAccount[] = snap.docs.map((d) => {
          const data = d.data() as Record<string, any>;
          return {
            email: String(data.email || d.id).toLowerCase(),
            displayName: data.displayName || '',
            accountType: data.accountType === 'manager' ? 'manager' : 'accountant',
            role: 'full_access',
            isOwner: Boolean(data.isOwner || String(data.email || d.id).toLowerCase() === MASTER_OWNER_EMAIL),
            status: data.status === 'inactive' ? 'inactive' : 'active',
            grantedBy: String(data.grantedBy || MASTER_OWNER_EMAIL),
          };
        });
        list.sort((a, b) => Number(Boolean(b.isOwner)) - Number(Boolean(a.isOwner)));
        onData(list);
      },
      (err) => {
        try {
          handleFirestoreError(err, OperationType.LIST, path);
        } catch (wrapped) {
          onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
        }
      }
    );
  }

  const singlePath = `authorized_emails/${normalized}`;
  return onSnapshot(
    doc(firestoreDb, 'authorized_emails', normalized),
    (snap) => {
      if (!snap.exists()) {
        onData([]);
        return;
      }
      const data = snap.data() as Record<string, any>;
      onData([
        {
          email: String(data.email || snap.id).toLowerCase(),
          displayName: data.displayName || '',
          accountType: data.accountType === 'manager' ? 'manager' : 'accountant',
          role: 'full_access',
          isOwner: false,
          status: data.status === 'inactive' ? 'inactive' : 'active',
          grantedBy: String(data.grantedBy || MASTER_OWNER_EMAIL),
        },
      ]);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.GET, singlePath);
      } catch (wrapped) {
        onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function grantFullAccessInFirestore(params: {
  email: string;
  displayName?: string;
  accountType: AccountSlot;
  grantedByEmail: string;
}): Promise<void> {
  const normalizedEmail = params.email.trim().toLowerCase();
  const path = `authorized_emails/${normalizedEmail}`;
  try {
    await setDoc(
      doc(firestoreDb, 'authorized_emails', normalizedEmail),
      {
        email: normalizedEmail,
        displayName: params.displayName?.trim() || normalizedEmail.split('@')[0],
        accountType: params.accountType,
        role: 'full_access',
        isOwner: normalizedEmail === MASTER_OWNER_EMAIL,
        status: 'active',
        grantedBy: params.grantedByEmail.trim().toLowerCase(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, path);
  }

  const bizPath = `businesses/${ALSAFA_WORKSPACE_ID}`;
  try {
    const bizRef = doc(firestoreDb, 'businesses', ALSAFA_WORKSPACE_ID);
    const bizSnap = await getDoc(bizRef);
    if (bizSnap.exists()) {
      await updateDoc(bizRef, {
        authorizedEmails: arrayUnion(normalizedEmail),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, bizPath);
  }
}

export async function revokeAccessInFirestore(email: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  if (normalizedEmail === MASTER_OWNER_EMAIL) {
    throw new Error('Cannot revoke access for Master Owner');
  }
  const path = `authorized_emails/${normalizedEmail}`;
  try {
    await deleteDoc(doc(firestoreDb, 'authorized_emails', normalizedEmail));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }

  const bizPath = `businesses/${ALSAFA_WORKSPACE_ID}`;
  try {
    const bizRef = doc(firestoreDb, 'businesses', ALSAFA_WORKSPACE_ID);
    const bizSnap = await getDoc(bizRef);
    if (bizSnap.exists()) {
      await updateDoc(bizRef, {
        authorizedEmails: arrayRemove(normalizedEmail),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, bizPath);
  }
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
