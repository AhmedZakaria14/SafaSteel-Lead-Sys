import { getFirebaseIdToken, getGoogleWorkspaceAccessToken } from './firebase';
import { Role } from '../types/crm';

export interface ApiContext {
  isDemoMode: boolean;
  demoRole?: Role;
}

let apiContext: ApiContext = {
  isDemoMode: true,
  demoRole: 'business_admin',
};

export function setApiContext(ctx: ApiContext) {
  apiContext = ctx;
}

export async function apiRequest<T = any>(
  path: string,
  options: RequestInit & { includeGoogleToken?: boolean; expectBlob?: boolean } = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const idToken = await getFirebaseIdToken();
  if (idToken) {
    headers.set('Authorization', `Bearer ${idToken}`);
  } else if (apiContext.isDemoMode) {
    headers.set('X-Demo-Session', 'true');
    if (apiContext.demoRole) {
      headers.set('X-Demo-Role', apiContext.demoRole);
    }
  }

  if (options.includeGoogleToken) {
    const googleToken = getGoogleWorkspaceAccessToken();
    if (googleToken) {
      headers.set('X-Google-Access-Token', googleToken);
    }
  }

  const res = await fetch(`/api${path}`, {
    ...options,
    headers,
  });

  const contentType = res.headers.get('content-type') || '';
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    if (contentType.includes('application/json')) {
      const errData = await res.json().catch(() => ({}));
      message = errData.error || message;
    }
    throw new Error(message);
  }

  if (options.expectBlob) {
    return (await res.blob()) as unknown as T;
  }

  if (contentType.includes('application/json')) {
    return (await res.json()) as T;
  }

  throw new Error('API endpoint returned non-JSON response');
}
