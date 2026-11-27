/*
 * xprs.dev/in/ as an app that starts without xprs.dev
 * (portal/docs/plan-installable-app.md).
 *
 * The code of the app (the looking page, shell.js, Reticulum, the portal
 * page, the map's libraries) is fetched once and kept here. Every start
 * after that is served from this cache and asks the network for nothing:
 * /in/<callsign> and /in/g/<group> get the kept looking page, whatever the
 * address, so the app opens while GitHub Pages cannot be reached.
 *
 * An update is asked for, never looked for at a start: the page sends
 * {op:'check'} at most once a day, version.json (a hash per file, a few
 * hundred bytes) is read, and only a file whose hash changed is fetched.
 * Every fetched file is checked against its hash before anything is put, so
 * a half-published site changes nothing here; the new files are used at the
 * next start.
 */
var CACHE = 'xprs-app-v1';
var SHELL = '/in/index.html', VERSION = '/in/version.json';

function hex(buf) {
  var b = new Uint8Array(buf), s = '';
  for (var i = 0; i < b.length; i++) s += ('0' + b[i].toString(16)).slice(-2);
  return s;
}
// One file, fetched past every cache and checked: [path, bytes, type].
function fetched(path, hash) {
  return fetch(path, { cache: 'no-cache' }).then(function (r) {
    if (!r.ok) throw new Error(path + ': HTTP ' + r.status);
    var type = r.headers.get('content-type') || 'application/octet-stream';
    return r.arrayBuffer().then(function (buf) {
      return crypto.subtle.digest('SHA-256', buf).then(function (d) {
        if (hex(d) !== hash) throw new Error(path + ' is not the file version.json names');
        return [path, buf, type];
      });
    });
  });
}
// Resolves with how many files changed.
function update() {
  return fetch(VERSION, { cache: 'no-store' }).then(function (r) {
    if (!r.ok) throw new Error('version.json: HTTP ' + r.status);
    return r.text();
  }).then(function (text) {
    var now = JSON.parse(text);
    return caches.open(CACHE).then(function (c) {
      return c.match(VERSION).then(function (old) { return old ? old.json() : { files: {} }; })
        .catch(function () { return { files: {} }; }).then(function (was) {
          var want = Object.keys(now.files).filter(function (p) { return now.files[p] !== (was.files || {})[p]; });
          return Promise.all(want.map(function (p) { return fetched(p, now.files[p]); })).then(function (got) {
            return Promise.all(got.map(function (g) {
              return c.put(g[0], new Response(g[1], { headers: { 'content-type': g[2] } }));
            }));
          }).then(function () {
            return c.keys();
          }).then(function (keys) {
            // A file the app no longer has is no longer kept.
            return Promise.all(keys.map(function (k) {
              var p = new URL(k.url).pathname;
              return p === VERSION || now.files[p] ? null : c.delete(k);
            }));
          }).then(function () {
            return c.put(VERSION, new Response(text, { headers: { 'content-type': 'application/json' } }));
          }).then(function () { return want.length; });
        });
    });
  });
}

self.addEventListener('install', function (e) {
  e.waitUntil(update().then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(self.clients.claim());
});
self.addEventListener('message', function (e) {
  if (!e.data || e.data.op !== 'check') return;
  var to = e.source;
  e.waitUntil(update().then(function (n) {
    if (to) to.postMessage({ op: 'checked', ok: true, changed: n });
  }, function (err) {
    if (to) to.postMessage({ op: 'checked', ok: false, why: String(err && err.message || err) });
  }));
});
self.addEventListener('fetch', function (e) {
  var q = e.request;
  if (q.method !== 'GET') return;
  var u = new URL(q.url);
  // Somebody else's, a station's API (carried over the link by shell.js, not
  // by the network), or an ask with a query (the network is meant): not ours.
  if (u.origin !== location.origin || u.pathname.indexOf('/api/') === 0 || u.search) return;
  var app = u.pathname === '/in' || u.pathname.indexOf('/in/') === 0;
  if (q.mode === 'navigate') {
    if (!app) return;
    e.respondWith(caches.open(CACHE).then(function (c) { return c.match(SHELL); })
      .then(function (r) { return r || fetch(q); }));
    return;
  }
  if (!app && u.pathname !== '/favicon.svg') return;
  e.respondWith(caches.open(CACHE).then(function (c) { return c.match(u.pathname); })
    .then(function (r) { return r || fetch(q); }));
});
