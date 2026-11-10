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
  function call(method, u, body) {
    var a = apiPath(u);
    return bodyBytes(body).then(function (b) {
      return window.XprsRns.api(method, a.path, a.query, b);
    });
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
    if (this.timeout > 0) timer = setTimeout(function () { if (done) return; done = true; self.readyState = 4; fire('ontimeout'); fire('onloadend'); }, Math.max(this.timeout, 20000));
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
  function tryGateways(list, i) {
    if (i >= list.length) return Promise.reject(new Error('no gateway answered'));
    say('Gateway ' + list[i] + '…');
    return window.XprsRns.connect(list[i]).then(function (hello) {
      return window.XprsRns.resolve(CALL).then(function (j) {
        var r = JSON.parse(j);
        if (!r.rns) throw new Error(list[i] + ' has not heard ' + CALL + ' on Reticulum');
        say('Opening a link to ' + CALL + '…');
        return window.XprsRns.open(r.rns).then(function (ok) {
          if (!ok) throw new Error('no link to ' + CALL + ' through ' + list[i]);
          return list[i];
        });
      });
    }).catch(function (e) {
      say(e.message || String(e), true);
      return tryGateways(list, i + 1);
    });
  }

  function start() {
    if (!CALL) { say('No station named in the address: xprs.dev/in/<callsign>', true); return; }
    document.title = CALL + ' · XPRS';
    var gw;
    load(BASE + 'rns.js').then(function () {
      return getText(BASE + 'gateways.json');
    }).then(function (t) {
      var list = JSON.parse(t).gateways || [];
      return tryGateways(list, 0);
    }).then(function (g) {
      gw = g;
      var n = nonce();
      return window.XprsRns.prove(n).then(function (p) { return JSON.parse(window.XprsRns.verify(p, CALL, n)); });
    }).then(function (v) {
      if (!v.ok) throw new Error('This is not ' + CALL + ': ' + v.why);
      say(CALL + ' proved itself' + (v.nick ? ' (' + v.nick + ')' : '') + '. Loading its portal…');
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
