// Service Worker for ECHO TUTOR PRO
const CACHE_NAME = 'echo-tutor-cache-v2';
const urlsToCache = [
  '/',
  '/landing', // Cache the landing page route if it exists, or just '/' if that's landing
  '/static/css/style.css',
  '/static/js/script.js', // Ensure this file exists, or remove if not needed
  '/static/manifest.json',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
  '/static/icons/Echo.png' // Important branding asset
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  // Don't cache API calls
  if (event.request.url.includes('/chat') || event.request.url.includes('/topics') || event.request.url.includes('/health')) {
    return;
  }
  event.respondWith(
    caches.match(event.request).then(response => response || fetch(event.request))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});
