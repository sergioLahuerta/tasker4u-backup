// sw.js
self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(clients.claim());
});

self.addEventListener('push', function(event) {
    const data = event.data ? event.data.json() : {};
    const title = data.title || "⚠️ Tarea próxima";
    const options = {
        body: data.body || "Tienes una tarea pendiente.",
        icon: "/icon.svg",
        badge: "/icon.svg",
        vibrate: [200, 100, 200]
    };

    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});