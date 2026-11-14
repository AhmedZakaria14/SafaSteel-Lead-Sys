export type BrowserNotificationSupport = 'granted' | 'denied' | 'default' | 'unsupported';

const shownNotificationIds = new Set<string>();
let swRegistrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

export function getBrowserNotificationPermission(): BrowserNotificationSupport {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'unsupported';
  }
  return Notification.permission as BrowserNotificationSupport;
}

export async function ensureNotificationServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null;
  }
  if (!swRegistrationPromise) {
    swRegistrationPromise = navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => reg)
      .catch(() => null);
  }
  return swRegistrationPromise;
}

export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationSupport> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'unsupported';
  }
  try {
    await ensureNotificationServiceWorker();
    const result = await Notification.requestPermission();
    return result as BrowserNotificationSupport;
  } catch {
    return getBrowserNotificationPermission();
  }
}

export function extractLeadIdFromLinkPath(linkPath?: string | null): string | null {
  if (!linkPath) return null;
  const match = linkPath.match(/^\/leads\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export async function showBrowserPushNotification(params: {
  id: string;
  title: string;
  body: string;
  linkPath: string;
  businessId?: string;
  onNavigate?: (linkPath: string, leadId: string | null, businessId?: string | null, notifId?: string | null) => void;
}) {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return false;
  if (Notification.permission !== 'granted') return false;
  if (shownNotificationIds.has(params.id)) return false;

  shownNotificationIds.add(params.id);
  if (shownNotificationIds.size > 300) {
    const first = shownNotificationIds.values().next().value;
    if (first) shownNotificationIds.delete(first);
  }

  const leadId = extractLeadIdFromLinkPath(params.linkPath);
  const data = {
    linkPath: params.linkPath || '/',
    leadId,
    businessId: params.businessId || null,
    notifId: params.id,
  };

  try {
    const reg = await ensureNotificationServiceWorker();
    if (reg && 'showNotification' in reg) {
      await reg.showNotification(params.title, {
        body: params.body,
        tag: params.id,
        silent: false,
        data,
      });
      return true;
    }
  } catch {
    // fallback to Window Notification API below
  }

  try {
    const notif = new window.Notification(params.title, {
      body: params.body,
      tag: params.id,
      silent: false,
      data,
    });
    notif.onclick = () => {
      try {
        window.focus();
      } catch {
        // ignore focus error
      }
      params.onNavigate?.(data.linkPath, leadId, data.businessId, params.id);
      notif.close();
    };
    return true;
  } catch {
    return false;
  }
}
