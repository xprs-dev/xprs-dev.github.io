/*
 * xprs.dev/in/<callsign>: a station's portal from anywhere, over Reticulum
 * (portal/docs/plan-browser-reticulum.md, spec/API-HTTP.md "The same API over
 * a Reticulum link").
 *
 * 1. Reticulum in the page (rns.js), a gateway from gateways.json by wss://.
 * 2. The station resolved by its callsign, a link to it, and its proof checked
 *    here: its callsign derives from its key, both its wires are signed with
 *    it, and it named this link. A gateway carries the link; it cannot stand
 *    in for the station.
 * 3. The portal page, the same file every station serves, written into this
 *    document with its transport switched: XMLHttpRequest and fetch to /api/
 *    become requests over the link, and /api/xprs/file/ media become blobs
 *    fetched over it. The page itself is not changed.
 */
(function () {
  'use strict';
  var BASE = '/in/';
  var m = /^\/in\/([a-z0-9]{3,8}(?:-[0-9]{1,2})?)\/?$/i.exec(location.pathname);
  var CALL = m ? m[1].toUpperCase() : '';
  var box = document.getElementById('in-status');
  function say(t, bad) {
    if (!box) return;
    var p = document.createElement('div');
    p.textContent = t;
    if (bad) p.className = 'bad';
    box.appendChild(p);
  }
  function load(src) {
    return new Promise(function (ok, no) {
      var s = document.createElement('script');
      s.src = src; s.onload = ok; s.onerror = function () { no(new Error('could not load ' + src)); };
      document.head.appendChild(s);
    });
  }
  function getText(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error(url + ': HTTP ' + r.status);
      return r.text();
    });
  }
  function nonce() {
    var a = new Uint8Array(12); crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }

  // ---- the transport: /api/ over the link ----------------------------------
  var realFetch = window.fetch.bind(window);
  var RealXHR = window.XMLHttpRequest;
  function apiPath(u) {
    try {
      var x = new URL(String(u), location.href);
      if (x.origin !== location.origin || x.pathname.indexOf('/api/') !== 0) return null;
      var q = {};
      x.searchParams.forEach(function (v, k) { q[k] = v; });
      return { path: x.pathname, query: JSON.stringify(q) };
    } catch (e) { return null; }
  }
  function bodyBytes(b) {
    if (b == null) return Promise.resolve(null);
    if (typeof b === 'string') return Promise.resolve(b);
    if (b instanceof Uint8Array) return Promise.resolve(b);
    if (b instanceof ArrayBuffer) return Promise.resolve(new Uint8Array(b));
    if (b instanceof Blob) return b.arrayBuffer().then(function (a) { return new Uint8Array(a); });
    if (b instanceof URLSearchParams) return Promise.resolve(b.toString());
    return Promise.resolve(String(b));
  }
  // The page polls as it does on a station's own network (the chat every
  // 3 s, the traffic every 5 s). Over a link each poll is a whole call on a
  // board that answers one at a time, and on a small one (an ESP32-C3) every
  // call in flight takes RAM its WiFi needs. So calls go to the station one
  // at a time, and an identical GET within GET_REUSE_MS shares the answer
  // already fetched or on its way. Anything that changes something (a POST,
  // PUT, DELETE) clears them: a sent message shows at once.
  var GET_REUSE_MS = 15000;
  var gets = {};
  var line = Promise.resolve();
  function oneAtATime(fn) {
    var p = line.then(fn, fn);
    line = p.then(function () {}, function () {});
    return p;
  }
  // One call over the link. No status means the link is gone (the station's
  // own uplink dropped, a gateway restarted): reach the station again, its
  // proof checked again, and make the call once more.
  function api(method, path, query, b) {
    return window.XprsRns.api(method, path, query, b).then(function (r) {
      if (r.status) return r;
      return reach().then(function () {
        return window.XprsRns.api(method, path, query, b);
      }, function () { return r; });
    });
  }
  function call(method, u, body) {
    var a = apiPath(u);
    if (method !== 'GET') {
      gets = {};
      return bodyBytes(body).then(function (b) {
        return oneAtATime(function () { return api(method, a.path, a.query, b); });
      });
    }
    var key = a.path + '?' + a.query, now = Date.now(), g = gets[key];
    if (g && now - g.t < GET_REUSE_MS) return g.p;
    var p = oneAtATime(function () { return api('GET', a.path, a.query, null); });
    gets[key] = { t: now, p: p };
    p.then(function (r) { if (!r.status && gets[key] && gets[key].p === p) delete gets[key]; },
           function () { if (gets[key] && gets[key].p === p) delete gets[key]; });
    return p;
  }

  function RnsXHR() {
    this.readyState = 0; this.status = 0; this.statusText = ''; this.responseText = '';
    this.response = ''; this.responseType = ''; this.timeout = 0; this.withCredentials = false;
    this.upload = { onprogress: null, onload: null };
    this.onload = this.onerror = this.ontimeout = this.onreadystatechange = this.onloadend = this.onabort = null;
    this._real = null; this._type = ''; this._sent = false;
  }
  RnsXHR.prototype.open = function (method, url, async) {
    this._m = String(method || 'GET').toUpperCase(); this._u = url;
    if (!apiPath(url)) {
      var r = this._real = new RealXHR(), self = this;
      r.open(method, url, async !== false);
      ['load', 'error', 'timeout', 'abort', 'loadend', 'readystatechange'].forEach(function (ev) {
        r.addEventListener(ev, function () {
          self.readyState = r.readyState; self.status = r.status; self.statusText = r.statusText;
          try { self.responseText = r.responseText; } catch (e) {}
          self.response = r.response;
          var h = self['on' + ev]; if (h) h.call(self, { type: ev, target: self });
        });
      });
      return;
    }
    this.readyState = 1;
  };
  RnsXHR.prototype.setRequestHeader = function (k, v) { if (this._real) this._real.setRequestHeader(k, v); };
  RnsXHR.prototype.getResponseHeader = function (k) {
    if (this._real) return this._real.getResponseHeader(k);
    return String(k).toLowerCase() === 'content-type' ? this._type : null;
  };
  RnsXHR.prototype.getAllResponseHeaders = function () { return this._real ? this._real.getAllResponseHeaders() : 'content-type: ' + this._type + '\r\n'; };
  RnsXHR.prototype.abort = function () { if (this._real) this._real.abort(); this._aborted = true; };
  RnsXHR.prototype.overrideMimeType = function () {};
  RnsXHR.prototype.send = function (body) {
    var self = this;
    if (this._real) {
      this._real.timeout = this.timeout; this._real.responseType = this.responseType;
      if (this.upload.onprogress) this._real.upload.onprogress = this.upload.onprogress;
      return this._real.send(body);
    }
    var done = false, timer = null;
    function fire(name) { var h = self[name]; if (h) try { h.call(self, { type: name.slice(2), target: self }); } catch (e) { console.error(e); } }
    if (this.timeout > 0) timer = setTimeout(function () { if (done) return; done = true; self.readyState = 4; fire('ontimeout'); fire('onloadend'); }, Math.max(this.timeout, 60000));
    call(this._m, this._u, body).then(function (r) {
      if (done || self._aborted) return; done = true; if (timer) clearTimeout(timer);
      self.status = r.status; self._type = r.type || '';
      if (!r.status) { self.readyState = 4; fire('onerror'); fire('onloadend'); return; }
      var text = '';
      try { text = new TextDecoder().decode(r.body); } catch (e) {}
      self.responseText = text;
      self.response = self.responseType === 'arraybuffer' ? r.body.buffer :
        self.responseType === 'blob' ? new Blob([r.body], { type: self._type }) :
        self.responseType === 'json' ? (function () { try { return JSON.parse(text); } catch (e) { return null; } })() : text;
      if (self.upload.onprogress) try { self.upload.onprogress({ lengthComputable: true, loaded: 1, total: 1 }); } catch (e) {}
      self.readyState = 4; fire('onreadystatechange'); fire('onload'); fire('onloadend');
    }, function () {
      if (done) return; done = true; if (timer) clearTimeout(timer);
      self.readyState = 4; fire('onerror'); fire('onloadend');
    });
  };

  function rnsFetch(input, init) {
    var u = typeof input === 'string' ? input : input && input.url;
    if (!apiPath(u)) return realFetch(input, init);
    var method = (init && init.method) || (input && input.method) || 'GET';
    return call(String(method).toUpperCase(), u, init && init.body).then(function (r) {
      if (!r.status) throw new TypeError('the station did not answer');
      return new Response(r.status === 204 ? null : r.body, { status: r.status, headers: { 'content-type': r.type || 'application/octet-stream' } });
    });
  }

  // /api/xprs/file/<ref> in src, href and poster: fetched over the link, a blob.
  var blobs = {};
  function blobFor(path) {
    if (!blobs[path]) blobs[path] = call('GET', path, null).then(function (r) {
      if (r.status !== 200) throw new Error('HTTP ' + r.status);
      return URL.createObjectURL(new Blob([r.body], { type: r.type || 'application/octet-stream' }));
    });
    return blobs[path];
  }
  function fix(el) {
    ['src', 'href', 'poster'].forEach(function (a) {
      var v = el.getAttribute && el.getAttribute(a);
      if (!v || v.indexOf('/api/xprs/file/') !== 0) return;
      el.setAttribute(a, '');
      el.setAttribute('data-rns-' + a, v);
      blobFor(v).then(function (url) { el.setAttribute(a, url); }, function () {
        if (el.onerror) try { el.onerror(); } catch (e) {}
      });
    });
  }
  function watch() {
    var all = document.querySelectorAll('[src^="/api/xprs/file/"],[href^="/api/xprs/file/"],[poster^="/api/xprs/file/"]');
    for (var i = 0; i < all.length; i++) fix(all[i]);
    new MutationObserver(function (ms) {
      ms.forEach(function (mu) {
        if (mu.type === 'attributes') fix(mu.target);
        else mu.addedNodes.forEach(function (n) {
          if (n.nodeType !== 1) return;
          fix(n);
          var inner = n.querySelectorAll('[src^="/api/xprs/file/"],[href^="/api/xprs/file/"],[poster^="/api/xprs/file/"]');
          for (var j = 0; j < inner.length; j++) fix(inner[j]);
        });
      });
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'href', 'poster'] });
  }

  // ---- connect, verify, show ---------------------------------------------
  // Reaching the station is one step, retried: a gateway, the station's
  // Reticulum key, a link to it, and its proof checked here. A small station
  // on a busy WiFi drops its own uplink now and then, and the link being
  // opened at that moment is lost; the next try usually gets through.
  var TRIES = 3, gateways = [], gw = '', nick = '';
  function sleep(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  function once(i) {
    if (i >= gateways.length) return Promise.reject(new Error('no gateway reached ' + CALL));
    var g = gateways[i];
    say('Gateway ' + g + '…');
    return window.XprsRns.connect(g).then(function () {
      return window.XprsRns.resolve(CALL);
    }).then(function (j) {
      var r = JSON.parse(j);
      if (!r.rns) throw new Error(g + ' has not heard ' + CALL + ' on Reticulum');
      say('Opening a link to ' + CALL + '…');
      return window.XprsRns.open(r.rns);
    }).then(function (ok) {
      if (!ok) throw new Error('no link to ' + CALL + ' through ' + g);
      var n = nonce();
      return window.XprsRns.prove(n).then(function (p) { return JSON.parse(window.XprsRns.verify(p, CALL, n)); });
    }).then(function (v) {
      if (!v.ok) throw new Error('This is not ' + CALL + ': ' + v.why);
      gw = g; nick = v.nick || '';
    }).catch(function (e) {
      say(e.message || String(e), true);
      return once(i + 1);
    });
  }
  var reaching = null;
  function reach() {
    if (reaching) return reaching;
    var t = 0;
    function attempt() {
      return once(0).catch(function (e) {
        if (++t >= TRIES) throw e;
        say('Trying again…');
        return sleep(3000).then(attempt);
      });
    }
    reaching = attempt();
    reaching.then(function () { reaching = null; }, function () { reaching = null; });
    return reaching;
  }

  function start() {
    if (!CALL) { say('No station named in the address: xprs.dev/in/<callsign>', true); return; }
    document.title = CALL + ' · XPRS';
    load(BASE + 'rns.js').then(function () {
      return getText(BASE + 'gateways.json');
    }).then(function (t) {
      gateways = JSON.parse(t).gateways || [];
      return reach();
    }).then(function () {
      say(CALL + ' proved itself' + (nick ? ' (' + nick + ')' : '') + '. Loading its portal…');
      return getText(BASE + 'portal.html');
    }).then(function (html) {
      window.XMLHttpRequest = RnsXHR;
      window.fetch = rnsFetch;
      window.XPRS_REMOTE = { station: CALL, gateway: gw };
      document.open();
      document.write(html);
      document.close();
      watch();
    }).catch(function (e) {
      say(e.message || String(e), true);
    });
  }
  start();
})();
