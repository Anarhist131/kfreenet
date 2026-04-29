// sw.js — Service Worker для Кристы 3.0
const CACHE_NAME = 'krista-v3';
const ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/client.js',
  '/manifest.json',
  '/sounds/message.mp3',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// Установка: кешируем основные файлы
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS).catch(console.warn);
    })
  );
});

// Активация: удаляем старые кеши
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names.filter(name => name !== CACHE_NAME).map(name => caches.delete(name))
      );
    })
  );
});

// Перехват запросов: сначала кеш, потом сеть
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request);
    })
  );
});
