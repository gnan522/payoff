// Service worker: shows push notifications (Firebase Cloud Messaging) and keeps the app usable offline.
importScripts('./firebase-config.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

const CACHE = 'payoff-v1';
const SHELL = ['./', './index.html', './app.js', './logic.js', './firebase-config.js', './manifest.webmanifest', './icons/icon-192.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// Network first for the app's own files, falling back to the cached copy when offline.
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin) return;
  e.respondWith(fetch(e.request).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match('./index.html'))));
});

if (self.FIREBASE_CONFIG && self.FIREBASE_CONFIG.apiKey) {
  firebase.initializeApp(self.FIREBASE_CONFIG);
  firebase.messaging(); // displays notification payloads automatically when the app is in the background
}

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL('./#today', self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    for (const w of ws) if (w.url.startsWith(self.registration.scope) && 'focus' in w) { w.navigate(url); return w.focus(); }
    return clients.openWindow(url);
  }));
});
