/* LeadFlow CRM Service Worker for Browser Push Notifications & Deep-Link Navigation */

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'Al-Safa Steel', body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'Al-Safa Steel';
  const options = {
    body: payload.body || '',
    icon: '/favicon.png',
    badge: '/favicon.png',
    tag: payload.tag || payload.id || 'alsafa-notification',
    silent: false,
    renotify: true,
    data: {
      linkPath: payload.linkPath || '/',
      leadId: payload.leadId || null,
      businessId: payload.businessId || null,
      notifId: payload.notifId || null,
    },
  };

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, options),
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
        for (const client of clients) {
          client.postMessage({
            type: 'LEADFLOW_PLAY_SOUND',
            notifType: payload.type || 'new_lead',
            notifId: payload.id || null,
          });
        }
      }),
    ])
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const linkPath = data.linkPath || '/';
  const leadId = data.leadId || null;
  const businessId = data.businessId || null;
  const notifId = data.notifId || null;

  const params = new URLSearchParams();
  if (leadId) params.set('lead', leadId);
  if (businessId) params.set('business', businessId);
  const queryStr = params.toString();
  const fallbackUrl = queryStr ? `/?${queryStr}` : linkPath.startsWith('/') ? linkPath : '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          client.postMessage({
            type: 'LEADFLOW_NAVIGATE',
            linkPath,
            leadId,
            businessId,
            notifId,
          });
          return;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(fallbackUrl);
      }
    })
  );
});
