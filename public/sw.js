/*
 * The only service worker in this project, and it exists for one reason:
 * a phone cannot be woken by a closed web app any other way.
 *
 * READ THIS BEFORE ADDING ANYTHING.
 *
 * There is no `fetch` handler here, and there must never be one. A service
 * worker that answers fetches serves its own cache first, and getting it to
 * ever let go of that cache is the usual reason an installed web app ends up
 * stuck on a version from three deploys ago. This app is server-rendered and
 * always goes to the network, so a deploy reaches both phones the next time
 * either of them opens it — nothing to invalidate, no "clear your cache"
 * conversation. Adding caching here would trade that away for nothing: the
 * app's whole job is telling you what's true right now.
 *
 * So: push events and notification clicks. Nothing else.
 */

// Take over from any previous version immediately rather than waiting for
// every tab to close. There's no cached state to migrate, so there is nothing
// this can break.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) =>
  event.waitUntil(self.clients.claim()),
);

self.addEventListener('push', (event) => {
  let notice = {};
  try {
    notice = event.data ? event.data.json() : {};
  } catch {
    // A push with no readable payload still means *something* changed, and
    // saying so is better than swallowing it.
  }

  const title = notice.title || 'Agenda';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: notice.body || '',
      // iOS ignores custom icons on the lock screen and uses the home-screen
      // one; Android honours these.
      icon: '/icon-192.png',
      badge: '/favicon-64.png',
      // Same tag replaces an unread notification instead of stacking a second
      // copy of the same news.
      tag: notice.tag || 'agenda',
      renotify: true,
      data: { url: notice.url || '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(
    (event.notification.data && event.notification.data.url) || '/',
    self.location.origin,
  ).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      // Focus the app if it's already open — opening a second copy of a
      // single-window home-screen app is disorienting.
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          if ('navigate' in client) await client.navigate(target);
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
