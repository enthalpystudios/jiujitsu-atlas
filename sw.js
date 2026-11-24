/* Offline for the mat: the shell is served fresh when online and from the
   cache when not; the card images are cache-first, since they never change
   once a technique's frames are set. */
const CACHE = "jj-atlas-v25";
const CORE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./i18n.js",
  "./data.js",
  "./manifest.webmanifest",
  "./favicon.png",
  "./apple-touch-icon.png",
  "./icon-512.png",
  "./count/bell.wav",
  "./count/blip.wav",
  "./count/en-n1.wav",
  "./count/en-n2.wav",
  "./count/en-n3.wav",
  "./count/en-n4.wav",
  "./count/en-n5.wav",
  "./count/en-start.wav",
  "./count/en-go.wav",
  "./count/en-rest.wav",
  "./count/en-stop.wav",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // Everything cross-origin (YouTube, fonts) is left alone.
  if (url.origin !== self.location.origin) return;

  const put = (response) => {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
    return response;
  };

  // Images are immutable here: take them from the cache first.
  if (request.destination === "image") {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then(put)));
    return;
  }

  // The shell and the data: fresh when online, cached when not.
  event.respondWith(
    fetch(request)
      .then(put)
      .catch(() => caches.match(request).then((hit) => hit || caches.match("./index.html")))
  );
});
