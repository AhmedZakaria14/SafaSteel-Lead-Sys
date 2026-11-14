import { initializeApp, getApps } from 'firebase/app';
import { Firestore, getFirestore, initializeFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

export {
  ALSAFA_WORKSPACE_ID,
  DEFAULT_ADMIN_USERNAME,
  MASTER_OWNER_EMAIL,
  isMasterOwnerEmail,
} from './constants';

let cachedFirestoreDb: Firestore | null = null;

export function getFirestoreDb(): Firestore {
  if (cachedFirestoreDb) return cachedFirestoreDb;
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  const dbId = firebaseConfig.firestoreDatabaseId || '(default)';
  try {
    cachedFirestoreDb = initializeFirestore(
      app,
      { experimentalForceLongPolling: true },
      dbId
    );
  } catch {
    cachedFirestoreDb = getFirestore(app, dbId);
  }
  return cachedFirestoreDb;
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
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
