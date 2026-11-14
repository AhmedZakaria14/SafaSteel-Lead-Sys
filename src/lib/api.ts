const AUTH_TOKEN_KEY = 'leadflow_auth_token';

let inMemoryToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function getAuthToken(): string | null {
  if (inMemoryToken) return inMemoryToken;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const stored = window.localStorage.getItem(AUTH_TOKEN_KEY);
      if (stored) {
        inMemoryToken = stored;
        return stored;
      }
    }
  } catch {
    // ignore storage access errors
  }
  return null;
}

export function setAuthToken(token: string | null): void {
  inMemoryToken = token;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (token) {
        window.localStorage.setItem(AUTH_TOKEN_KEY, token);
      } else {
        window.localStorage.removeItem(AUTH_TOKEN_KEY);
      }
    }
  } catch {
    // ignore storage access errors
  }
}

export function onUnauthorized(handler: () => void): void {
  unauthorizedHandler = handler;
}

export async function apiRequest<T = any>(
  path: string,
  options: RequestInit & { expectBlob?: boolean; skipAuthRedirect?: boolean } = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && !(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const token = getAuthToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
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
    if (res.status === 401 && !options.skipAuthRedirect && !path.startsWith('/auth/login')) {
      setAuthToken(null);
      unauthorizedHandler?.();
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
