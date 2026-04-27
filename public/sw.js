// sw.js — Service Worker для К.ФриРунет 2.0

const CACHE_NAME = 'kfr-cache-v2';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/style.css',
  '/client.js',
  '/manifest.json',
  '/sounds/message.mp3',
  '/sounds/subscribe.mp3',
  '/sounds/unsubscribe.mp3',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/socket.io/socket.io.js'   // если доступен
];

// Установка: кешируем основные файлы
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS_TO_CACHE).catch(err => console.warn('Кеширование не удалось', err));
    })
  );
});

// Активация: удаляем старые кеши
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.filter(name => name !== CACHE_NAME).map(name => caches.delete(name))
      );
    })
  );
});

// Перехват запросов: сначала кеш, потом сеть
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      // Возвращаем кеш, если есть, иначе делаем запрос в сеть
      return cachedResponse || fetch(event.request);
    })
  );
});