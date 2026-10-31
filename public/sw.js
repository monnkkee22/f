self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Klick auf die Benachrichtigung -> direkt zum Roblox-Item
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || 'https://www.roblox.com/catalog';
  event.waitUntil(self.clients.openWindow(url));
});
