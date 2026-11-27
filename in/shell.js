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
 * 4. Kept on the device (portal/docs/plan-installable-app.md): sw.js keeps
 *    the app's own files, so a start asks xprs.dev for nothing; a file read
 *    from a station is kept under its reference (a reference names its
 *    bytes: never stale, never asked for twice); every gateway that was ever
 *    listed is remembered, the one that worked last tried first.
 */
(function () {
  'use strict';
  var BASE = '/in/';
  var m = /^\/in\/([a-z0-9]{3,8}(?:-[0-9]{1,2})?)\/?$/i.exec(location.pathname);
  var CALL = m ? m[1].toUpperCase() : '';
  // A group, not a station: xprs.dev/in/<x5 callsign> (a group has an X5
  // callsign and no station has), or xprs.dev/in/g/<name> for an open group,
  // whose name could be mistaken for a station's. Its page is the portal of
  // a station that keeps the group, opened on the group.
  var mg = /^\/in\/g\/([a-z0-9][a-z0-9_-]{0,15})\/?$/i.exec(location.pathname);
  var GROUP = mg ? mg[1].toUpperCase() : (/^X5/.test(CALL) ? CALL : '');
  if (GROUP) CALL = '';
  // xprs.dev/in/ itself: the visitor's own portal, on one of THEIR archivers
  // (the stations keeping their mail, XPRS.md 9.12), found on Reticulum and
  // never a fixed server. CALL is whichever answered.
  var HOME = !CALL && !GROUP && /^\/in\/?(index\.html)?$/i.test(location.pathname);
  // What the page shows while it looks (404.html): one line saying what is
  // being done now, the legs of the way lit as they are done (step()), and
  // everything said so far under Details. After the portal took the page's
  // place these elements are gone from it, and a later reach() says nothing.
  var box = document.getElementById('in-status'), logBox = document.getElementById('in-log');
  var LEGS = { gateway: 0, station: 1, link: 2, proof: 3, portal: 4 };
  function say(t, bad, quiet) {
    if (!box || !box.isConnected) return;
    if (!quiet) { box.textContent = t; box.className = bad ? 'bad' : ''; }
    if (!logBox) return;
    var p = document.createElement('div');
    p.textContent = t;
    if (bad) p.className = 'bad';
    logBox.appendChild(p);
    document.getElementById('in-more').className = 'some';
  }
  function step(leg) {
    var bar = document.getElementById('in-steps');
    if (!bar) return;
    bar.className = '';
    for (var i = 0; i < bar.children.length; i++)
      bar.children[i].className = i < LEGS[leg] ? 'done' : i === LEGS[leg] ? 'on' : '';
  }
  // The end of the way: what could not be done, and what to do about it.
  function failed(t, detail) {
    if (detail) say(detail, true, true);
    say(t, true);
    var bar = document.getElementById('in-steps'), acts = document.getElementById('in-acts');
    if (bar) bar.className = 'bad';
    if (acts) acts.className = 'show';
  }
  var realFetch = window.fetch.bind(window);
  var RealXHR = window.XMLHttpRequest;
  function load(src) {
    return new Promise(function (ok, no) {
      var s = document.createElement('script');
      s.src = src; s.onload = ok; s.onerror = function () { no(new Error('could not load ' + src)); };
      document.head.appendChild(s);
    });
  }
  // The app's own files. Installed (sw.js), they come from the device and
  // the network is not asked; an update is asked for once a day (appShell).
  function getText(url) {
    return realFetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ': HTTP ' + r.status);
      return r.text();
    });
  }
  function nonce() {
    var a = new Uint8Array(12); crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }

  // ---- the transport: /api/ over the link ----------------------------------
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
  //
  // The parts of a file read by range (the map's tiles, from the world map
  // an archiver shares) wait in a line of their own: a tile behind the
  // page's polls, each a history answer of tens of kB, is a map that never
  // draws. So at most two calls are in flight, the second only for a
  // station that shares such a file (a small board shares none).
  var line = Promise.resolve(), partsLine = Promise.resolve();
  function oneAtATime(fn) {
    var p = line.then(fn, fn);
    line = p.then(function () {}, function () {});
    return p;
  }
  function onePartAtATime(fn) {
    var p = partsLine.then(fn, fn);
    partsLine = p.then(function () {}, function () {});
    return p;
  }
  // ---- files, kept ----------------------------------------------------------
  // A file is named by the hash of its bytes (XPRS.md 7.7), so one that was
  // read is never stale: it is kept (Cache Storage, by its reference) and the
  // station is not asked for it again, in this visit or the next. Only what
  // anybody may read is kept: a file the station marks private (a private
  // room's, Cache-Control: private) stays in memory for the visit. Past
  // FILES_MAX the files unused longest go; one larger than FILE_KEEP_MAX is
  // not kept at all. Parts read by range (the map) are kept by the page.
  var FILES = 'xprs-files-v1', FILES_MAX = 200 * 1048576, FILE_KEEP_MAX = 32 * 1048576;
  var FILE_PRE = '/api/xprs/file/', FILES_IDX = 'xprs_files';
  function fileRef(path) {
    return path.indexOf(FILE_PRE) === 0 && path.length > FILE_PRE.length ? path.slice(FILE_PRE.length) : '';
  }
  function fileIdx() { try { return JSON.parse(localStorage.getItem(FILES_IDX) || '{}') || {}; } catch (e) { return {}; } }
  function fileIdxSet(m) { try { localStorage.setItem(FILES_IDX, JSON.stringify(m)); } catch (e) {} }
  function fileUsed(ref, size) {
    var m = fileIdx(), day = Math.floor(Date.now() / 86400000);
    if (m[ref] && m[ref][1] === day && size == null) return;
    m[ref] = [size == null ? (m[ref] ? m[ref][0] : 0) : size, day];
    var total = 0, k;
    for (k in m) total += m[k][0];
    if (total > FILES_MAX) {
      var old = Object.keys(m).sort(function (a, b) { return m[a][1] - m[b][1]; });
      caches.open(FILES).then(function (c) {
        while (total > FILES_MAX * 0.8 && old.length) {
          var x = old.shift();
          if (x === ref) continue;
          total -= m[x][0]; delete m[x]; c.delete('/in/_file/' + x);
        }
        fileIdxSet(m);
      }, function () {});
      return;
    }
    fileIdxSet(m);
  }
  function fileGet(ref) {
    if (!ref || !window.caches) return Promise.resolve(null);
    return caches.open(FILES).then(function (c) { return c.match('/in/_file/' + ref); }).then(function (r) {
      if (!r) return null;
      var type = r.headers.get('content-type') || '';
      return r.arrayBuffer().then(function (b) {
        fileUsed(ref);
        return { status: 200, type: type, body: new Uint8Array(b), headers: '{}', kept: true };
      });
    }).catch(function () { return null; });
  }
  function filePut(ref, r, withSession) {
    if (!ref || !window.caches || r.status !== 200 || !r.body || r.body.length > FILE_KEEP_MAX) return;
    var cc = '';
    try { var h = JSON.parse(r.headers || '{}') || {}; for (var k in h) if (k.toLowerCase() === 'cache-control') cc = String(h[k]); } catch (e) {}
    // Said to be private, or not said at all while a session opened it.
    if (/private|no-store/i.test(cc) || (!cc && withSession)) return;
    caches.open(FILES).then(function (c) {
      return c.put('/in/_file/' + ref, new Response(r.body, { headers: { 'content-type': r.type || 'application/octet-stream' } }));
    }).then(function () { fileUsed(ref, r.body.length); }, function () {});
  }

  // One call over the link. No status means the link is gone (the station's
  // own uplink dropped, a gateway restarted): reach the station again, its
  // proof checked again, and make the call once more.
  // [h]: request headers as JSON, or undefined (a Range on a file).
  function rawApi(method, path, query, b, h) {
    return HOME ? window.XprsRns.api(method, path, query, b, CALL, h) : window.XprsRns.api(method, path, query, b, undefined, h);
  }
  function api(method, path, query, b, h) {
    return rawApi(method, path, query, b, h).then(function (r) {
      if (r.status) return r;
      return reach().then(function () {
        return rawApi(method, path, query, b, h);
      }, function () { return r; });
    });
  }
  // A return visit shows the portal before the archiver is reached (start()):
  // until it proved itself, every call waits here.
  var proven = Promise.resolve();
  function call(method, u, body, hdr, dropped) {
    var a = method === 'GET' && !(hdr && hdr.Range) ? apiPath(u) : null, ref = a ? fileRef(a.path) : '';
    var first = ref ? fileGet(ref) : Promise.resolve(null);
    return first.then(function (kept) {
      // A kept file needs no station: it does not wait for its proof.
      return kept || proven.then(function () { return callNow(method, u, body, hdr, dropped); });
    });
  }
  // [hdr]: the headers the page set ({Range: ...}); a ranged read is its own
  // GET, never shared with a read of another part.
  // [dropped]: true once the page gave up on a ranged read (a map tile
  // scrolled or zoomed away): skipped when its turn comes, not read for nobody.
  function callNow(method, u, body, hdr, dropped) {
    var a = apiPath(u);
    var h = hdr && Object.keys(hdr).length ? JSON.stringify(hdr) : undefined;
    if (method !== 'GET') {
      gets = {};
      return bodyBytes(body).then(function (b) {
        return oneAtATime(function () { return api(method, a.path, a.query, b, h); });
      });
    }
    if (h) {
      // A part is read once, for the call that asked: never kept (a map
      // reads thousands, 256 kB each).
      return onePartAtATime(function () {
        if (dropped && dropped()) return { status: 0 };
        return api('GET', a.path, a.query, null, h);
      });
    }
    var key = a.path + '?' + a.query, now = Date.now(), g = gets[key];
    if (g && now - g.t < GET_REUSE_MS) return g.p;
    var ref = fileRef(a.path);
    var p = fileGet(ref).then(function (kept) {
      if (kept) return kept;
      return oneAtATime(function () { return api('GET', a.path, a.query, null, h); }).then(function (r) {
        if (ref) filePut(ref, r, /"session"/.test(a.query));
        return r;
      });
    });
    // An answer is of use for GET_REUSE_MS; kept longer it is only memory (a
    // page left open asks thousands of different things, each tens of kB).
    for (var k in gets) if (now - gets[k].t >= GET_REUSE_MS) delete gets[k];
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
    this._real = null; this._type = ''; this._sent = false; this._h = {}; this._rh = {};
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
  // Over the link only Range travels (a file read in parts); the rest is the
  // browser's business.
  RnsXHR.prototype.setRequestHeader = function (k, v) {
    if (this._real) return this._real.setRequestHeader(k, v);
    if (String(k).toLowerCase() === 'range') this._h.Range = String(v);
  };
  RnsXHR.prototype.getResponseHeader = function (k) {
    if (this._real) return this._real.getResponseHeader(k);
    k = String(k).toLowerCase();
    if (k === 'content-type') return this._type;
    for (var n in this._rh) if (n.toLowerCase() === k) return String(this._rh[n]);
    return null;
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
    call(this._m, this._u, body, this._h, function () { return self._aborted || done; }).then(function (r) {
      if (done || self._aborted) return; done = true; if (timer) clearTimeout(timer);
      self.status = r.status; self._type = r.type || '';
      try { self._rh = JSON.parse(r.headers || '{}') || {}; } catch (e) { self._rh = {}; }
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
  // The gateways to try: the one that worked last, the listed ones in a
  // random order (nobody's first choice is everybody's), then the ones this
  // browser was told of before and the list no longer names. Kept, so the
  // app has its ways in when xprs.dev does not answer.
  function gatewaysFrom(text) {
    var listed = [];
    try { listed = JSON.parse(text).gateways || []; } catch (e) {}
    listed = listed.filter(function (g) { return /^wss?:\/\//.test(g); });
    var m = memo(), kept = (m.gws || []).filter(function (g) { return listed.indexOf(g) < 0; });
    memoSet({ gws: uniq(listed.concat(kept)).slice(0, 32) });
    gateways = uniq([m.gw].concat(shuffle(listed), kept)).filter(function (g) {
      return listed.indexOf(g) >= 0 || kept.indexOf(g) >= 0;
    });
    return gateways;
  }
  function gatewayList() {
    return getText(BASE + 'gateways.json').then(gatewaysFrom, function () { return gatewaysFrom('{}'); }).then(function (g) {
      if (!g.length) throw new Error('no gateway is known');
      return g;
    });
  }
  // Nothing answered: the list as xprs.dev has it now, past what is kept
  // (an ask with a query goes to the network, sw.js), once.
  var listAsked = false;
  function gatewaysAgain() {
    if (listAsked) return Promise.reject(new Error('asked before'));
    listAsked = true;
    return realFetch(BASE + 'gateways.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (t) {
      var had = gateways.slice();
      gatewaysFrom(t);
      if (!gateways.some(function (g) { return had.indexOf(g) < 0; })) throw new Error('no gateway is new');
      gwOrder = null;
    });
  }
  function sleep(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  // A link to station [c] through the gateway already connected, its proof
  // checked: its callsign derives from its key and it named this link.
  function linkTo(c, g) {
    return window.XprsRns.resolve(c).then(function (j) {
      var r = JSON.parse(j);
      if (!r.rns) throw new Error(g + ' has not heard ' + c + ' on Reticulum');
      return window.XprsRns.open(r.rns);
    }).then(function (ok) {
      if (!ok) throw new Error('no link to ' + c + ' through ' + g);
      var n = nonce();
      return window.XprsRns.prove(n).then(function (p) { return JSON.parse(window.XprsRns.verify(p, c, n)); });
    }).then(function (v) {
      if (!v.ok) throw new Error('This is not ' + c + ': ' + v.why);
      return v;
    });
  }
  // The stations to try for a group, in order: the gateway's own station
  // says which archivers list the group in their index
  // (GET /api/xprs/groups?g=, XPRS.md 12.9.7). The gateway's station is
  // tried last when it does not list the group itself: a private group is
  // in no index, and that station can still take a request to join.
  function holdersOf(group, own) {
    // The link's own call, not api(): that one re-reaches on a failure, and
    // this runs inside the reach.
    return window.XprsRns.api('GET', '/api/xprs/groups', JSON.stringify({ g: group }), null).then(function (r) {
      var d = {};
      try { d = JSON.parse(new TextDecoder().decode(r.body)); } catch (e) {}
      var hs = (d.holders || []).map(function (h) { return String(h).toUpperCase(); });
      if (hs.indexOf(own) < 0) hs.push(own);
      return hs;
    }).catch(function () { return [own]; });
  }
  function onceGroup(i) {
    if (i >= gateways.length) return Promise.reject(new Error('no gateway reached a station that keeps ' + GROUP));
    var g = gateways[i], own = '';
    step('gateway');
    say('Gateway ' + g, false, true);
    say('Looking for ' + GROUP + '…');
    return window.XprsRns.connect(g).then(function (hello) {
      own = (JSON.parse(hello).station || '').toUpperCase();
      if (!own) throw new Error(g + ' names no station');
      return linkTo(own, g);
    }).then(function () {
      step('station');
      say('Asking who keeps ' + GROUP + '…');
      return holdersOf(GROUP, own);
    }).then(function (hs) {
      // One after another; the first that proves itself is the one.
      function next(k) {
        if (k >= hs.length) throw new Error('no station that keeps ' + GROUP + ' answered');
        // Already linked to the gateway's own station: no second link.
        step('link');
        var leg = hs[k] === own && k === 0 ? Promise.resolve({ nick: '' }) : linkTo(hs[k], g);
        return leg.then(function (v) {
          CALL = hs[k]; gw = g; nick = v.nick || '';
          memoSet({ gw: g });
        }, function (e) {
          say(e.message || String(e), true, true);
          return next(k + 1);
        });
      }
      return next(0);
    }).catch(function (e) {
      say(e.message || String(e), true, true);
      return onceGroup(i + 1);
    });
  }
  function once(i) {
    if (HOME) return onceHome(i);
    if (GROUP) return onceGroup(i);
    if (i >= gateways.length) return Promise.reject(new Error('no gateway reached ' + CALL));
    var g = gateways[i];
    step('gateway');
    say('Gateway ' + g, false, true);
    say('Looking for ' + CALL + '…');
    return window.XprsRns.connect(g).then(function () {
      step('station');
      return window.XprsRns.resolve(CALL);
    }).then(function (j) {
      var r = JSON.parse(j);
      if (!r.rns) throw new Error(g + ' has not heard ' + CALL + ' on Reticulum');
      step('link');
      say('Opening a link to ' + CALL + '…');
      return window.XprsRns.open(r.rns);
    }).then(function (ok) {
      if (!ok) throw new Error('no link to ' + CALL + ' through ' + g);
      step('proof');
      say('Checking it is ' + CALL + '…');
      var n = nonce();
      return window.XprsRns.prove(n).then(function (p) { return JSON.parse(window.XprsRns.verify(p, CALL, n)); });
    }).then(function (v) {
      if (!v.ok) throw new Error('This is not ' + CALL + ': ' + v.why);
      gw = g; nick = v.nick || '';
      memoSet({ gw: g });
    }).catch(function (e) {
      say(e.message || String(e), true, true);
      return once(i + 1);
    });
  }
  // ---- home: the visitor's archivers ------------------------------------
  // What this browser learned, so a return visit goes straight to an
  // archiver it reached before: the gateway that worked, each station's
  // Reticulum key, the archivers heard announcing themselves (t:service
  // serve:archive). The visitor's own list (xprs_hold, kept by the portal for
  // the account in use) comes first, in random order. Found from scratch only
  // when nothing remembered answers.
  var KEEP = 'xprs_reach';
  function memo() { try { return JSON.parse(localStorage.getItem(KEEP) || '{}') || {}; } catch (e) { return {}; } }
  function memoSet(f) {
    var m = memo();
    for (var k in f) m[k] = f[k];
    try { localStorage.setItem(KEEP, JSON.stringify(m)); } catch (e) {}
  }
  function held() { try { var h = JSON.parse(localStorage.getItem('xprs_hold') || '[]'); return Array.isArray(h) ? h : []; } catch (e) { return []; } }
  function shuffle(a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function uniq(a) { var o = [], s = {}; a.forEach(function (c) { if (c && !s[c]) { s[c] = 1; o.push(c); } }); return o; }
  // Archivers named in a history answer: {call, at} from `t:service ... serve:archive`.
  function archiversIn(rows) {
    var out = {};
    (rows || []).forEach(function (r) {
      var w = r.wire || '', f = / f:([A-Z0-9-]+)/.exec(' ' + w), sv = / serve:([^ ]+)/.exec(w);
      if (!f || !sv || w.indexOf('t:service ') !== 0 || !/(^|,)archive(,|$)/.test(sv[1])) return;
      var c = f[1].split('-')[0];
      if (!out[c] || r.ts > out[c]) out[c] = r.ts;
    });
    return out;
  }
  function learn(found) {
    var m = memo(), a = m.archivers || {};
    for (var c in found) if (!a[c] || found[c] > a[c]) a[c] = found[c];
    // The 40 heard most recently.
    var keep = Object.keys(a).sort(function (x, y) { return a[y] - a[x]; }).slice(0, 40), o = {};
    keep.forEach(function (c) { o[c] = a[c]; });
    memoSet({ archivers: o });
  }
  var linked = {};
  // A named link to station [c] through gateway [g], its proof checked. The
  // key remembered from an earlier visit first; the gateway asked when that
  // one fails (the station may have a new one).
  function linkNamed(c, g) {
    var keys = memo().keys || {};
    function via(key) {
      return window.XprsRns.open(key, c).then(function (ok) {
        if (!ok) throw new Error('no link to ' + c + ' through ' + g);
        var n = nonce();
        return window.XprsRns.prove(n, c).then(function (p) { return JSON.parse(window.XprsRns.verify(p, c, n)); });
      }).then(function (v) {
        if (!v.ok) throw new Error('This is not ' + c + ': ' + v.why);
        var k = memo().keys || {}; k[c] = key; memoSet({ keys: k });
        linked[c] = 1;
        return v;
      });
    }
    function fresh() {
      return window.XprsRns.resolve(c).then(function (j) {
        var r = JSON.parse(j);
        if (!r.rns) throw new Error(g + ' has not heard ' + c + ' on Reticulum');
        return via(r.rns);
      });
    }
    return keys[c] ? via(keys[c]).catch(fresh) : fresh();
  }
  // Up to three at once; the first to prove itself is the one. The others
  // finish in the background and stay linked for the portal's mail.
  function race(cands, g) {
    return new Promise(function (ok, no) {
      var i = 0, live = 0, won = false, last = 'no archiver known';
      function next() {
        while (!won && live < 3 && i < cands.length) {
          (function (c) {
            live++;
            say('Trying ' + c + '…', false, true);
            linkNamed(c, g).then(function (v) {
              if (!won) { won = true; ok({ call: c, v: v }); }
            }, function (e) { last = e.message || String(e); say(last, true, true); }).then(function () {
              live--;
              if (!won) next();
            });
          })(cands[i++]);
        }
        if (!won && live === 0 && i >= cands.length) no(new Error(last));
      }
      next();
    });
  }
  // From scratch: the gateway's own station says which archivers it heard
  // announcing themselves; it is itself the last resort.
  function discover(own, g) {
    say('Looking for archivers…');
    return linkNamed(own, g).then(function () {
      return window.XprsRns.api('GET', '/api/xprs/history', JSON.stringify({ kind: 'service', limit: '200' }), null, own);
    }).then(function (r) {
      var rows = [];
      try { rows = JSON.parse(new TextDecoder().decode(r.body)).rows || []; } catch (e) {}
      var found = archiversIn(rows);
      learn(found);
      return uniq(shuffle(Object.keys(found)).concat([own]));
    }, function () { return [own]; });
  }
  var gwOrder = null;
  function onceHome(i) {
    if (!gwOrder) gwOrder = gateways.slice();
    if (i >= gwOrder.length) return Promise.reject(new Error('no archiver answered'));
    var g = gwOrder[i], own = '', tried = {};
    step('gateway');
    say('Gateway ' + g, false, true);
    say('Looking for an archiver…');
    return window.XprsRns.connect(g).then(function (hello) {
      own = (JSON.parse(hello).station || '').toUpperCase();
      linked = {};
      step('station');
      // Again after a drop: the same archiver first, the portal's session is there.
      // The archiver in use first, alone (its session is there), then the
      // visitor's list and every archiver remembered, then from scratch.
      var known = uniq(shuffle(held()).concat(shuffle(Object.keys(memo().archivers || {}))));
      var cands = CALL ? [CALL] : known;
      cands.forEach(function (c) { tried[c] = 1; });
      step('link');
      return race(cands, g).catch(function () {
        var rest = known.filter(function (c) { return !tried[c]; });
        rest.forEach(function (c) { tried[c] = 1; });
        return race(rest, g);
      }).catch(function () {
        return discover(own, g).then(function (list) {
          return race(list.filter(function (c) { return !tried[c]; }).concat(tried[own] ? [own] : []), g);
        });
      });
    }).then(function (w) {
      step('proof');
      CALL = w.call; gw = g; nick = w.v.nick || '';
      memoSet({ gw: g, home: CALL });
      if (window.XPRS_REMOTE) { window.XPRS_REMOTE.station = CALL; window.XPRS_REMOTE.gateway = g; }
    }).catch(function (e) {
      say(e.message || String(e), true, true);
      return onceHome(i + 1);
    });
  }
  // Another station through the same gateway, for the portal (XPRS_REMOTE):
  // one call at a time per station, its link made when first needed and once
  // more when it dropped. The answer: {status, json, text}.
  var lines = {};
  function ask(c, method, path, query, body) {
    c = String(c || '').toUpperCase();
    var q = JSON.stringify(query || {});
    function one() {
      if (c === CALL) return api(method, path, q, body == null ? null : body);
      function go() { return window.XprsRns.api(method, path, q, body == null ? null : body, c); }
      var first = linked[c] ? Promise.resolve() : linkNamed(c, gw);
      return first.then(go).then(function (r) {
        if (r.status) return r;
        linked[c] = 0;
        return linkNamed(c, gw).then(go);
      });
    }
    var p = proven.then(function () { return lines[c] || null; }).then(one, one);
    lines[c] = p.then(function () {}, function () {});
    return p.then(function (r) {
      var text = '', json = null;
      try { text = new TextDecoder().decode(r.body); json = JSON.parse(text); } catch (e) {}
      return { status: r.status, json: json, text: text };
    });
  }
  // Another archiver as the portal's base (XPRS_REMOTE.use), from the map or
  // the archivers list: its link made and its proof checked first, through
  // the same gateway, so one that does not answer leaves the page as it is.
  // Resolves with what opens the portal on it, for the page to keep its view
  // first: on xprs.dev/in/ the page again, on it, and the next visit opens
  // there too (memo home, the visitor's mail archivers when it is gone);
  // elsewhere its own address. The visitor's mail stays where it is kept.
  function use(c) {
    c = String(c || '').toUpperCase().split('-')[0];
    if (!/^X[1-5][A-Z0-9]{2,6}$/.test(c)) return Promise.reject(new Error('not a callsign'));
    function go() {
      if (HOME) { memoSet({ home: c }); location.reload(); }
      else location.href = BASE + c.toLowerCase() + location.hash;
    }
    if (c === CALL) return Promise.resolve(function () {});
    return proven.then(function () { return linkNamed(c, gw); }).then(function () { return go; });
  }
  function knownArchivers() {
    var a = memo().archivers || {};
    return Object.keys(a).sort(function (x, y) { return (linked[y] || 0) - (linked[x] || 0) || a[y] - a[x]; })
      .map(function (c) { return { call: c, at: a[c] }; });
  }

  var reaching = null;
  function reach() {
    if (reaching) return reaching;
    var t = 0;
    function attempt() {
      return once(0).catch(function (e) {
        if (++t >= TRIES) {
          return gatewaysAgain().then(function () { t = 0; return attempt(); }, function () { throw e; });
        }
        say('Trying again…');
        return sleep(3000).then(attempt);
      });
    }
    reaching = attempt();
    reaching.then(function () { reaching = null; }, function () { reaching = null; });
    return reaching;
  }

  // The portal in place of this page, in the same window. Not document.open():
  // that erases every listener on the window, and a NOSTR extension (nos2x)
  // answers window.nostr through a 'message' listener it set before: the
  // portal saw window.nostr and waited for ever on its first question. The
  // parsed page replaces this one; its scripts, inert after parsing, run in
  // order as fresh elements; then the two events a loaded page has had.
  function swapIn(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var root = document.importNode(doc.documentElement, true);
    document.replaceChild(root, document.documentElement);
    var dead = root.querySelectorAll('script'), i, j;
    for (i = 0; i < dead.length; i++) {
      var s = document.createElement('script');
      for (j = 0; j < dead[i].attributes.length; j++) s.setAttribute(dead[i].attributes[j].name, dead[i].attributes[j].value);
      s.text = dead[i].text;
      dead[i].parentNode.replaceChild(s, dead[i]);
    }
    document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));
    window.dispatchEvent(new Event('load'));
  }

  // Where no archiver answers after the portal is already shown.
  function trouble() {
    var d = document.createElement('div');
    d.style.cssText = 'position:fixed;left:12px;right:12px;bottom:84px;z-index:99;background:#262220;color:#fff;' +
      'border:1px solid rgba(255,168,106,.4);border-radius:10px;padding:10px 14px;font:14px system-ui,sans-serif';
    d.innerHTML = 'Can\u2019t reach an archiver right now \u00b7 <a href="" style="color:#ffa86a">Try again</a>';
    document.body.appendChild(d);
  }
  // ---- the app on the device -------------------------------------------
  // sw.js keeps the app's files; an update is asked for at most once a day,
  // and only after the last one was answered (a day without a network asks
  // again at the next start). Storage is asked to stay (not cleared under
  // pressure) once the page is installed.
  var CHECKED = 'xprs_app_checked', DAY = 86400000;
  function standalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  }
  function persist() {
    try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {}); } catch (e) {}
  }
  function appShell() {
    if (standalone()) persist();
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.addEventListener('message', function (e) {
      if (e.data && e.data.op === 'checked' && e.data.ok) try { localStorage.setItem(CHECKED, String(Date.now())); } catch (x) {}
    });
    navigator.serviceWorker.register(BASE + 'sw.js', { scope: BASE }).then(function () {
      var last = 0;
      try { last = +(localStorage.getItem(CHECKED) || 0); } catch (e) {}
      if (!last) { try { localStorage.setItem(CHECKED, String(Date.now())); } catch (e) {} return; }
      if (navigator.onLine === false || Date.now() - last < DAY) return;
      return navigator.serviceWorker.ready.then(function (r) { if (r.active) r.active.postMessage({ op: 'check' }); });
    }).catch(function () {});
  }
  // The browser's offer to install, held for the portal's menu entry
  // (XPRS_REMOTE.install): 'ask' where the browser has one, 'ios' where only
  // the Share sheet installs, 'menu' where the browser's own menu does, 'no'
  // when installed already or the browser cannot.
  var offer = null;
  function installChanged() { try { window.dispatchEvent(new Event('xprs-install')); } catch (e) {} }
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); offer = e; installChanged(); });
  window.addEventListener('appinstalled', function () { offer = null; persist(); installChanged(); });
  var installer = {
    state: function () {
      if (standalone()) return 'no';
      if (offer) return 'ask';
      var ua = navigator.userAgent || '';
      if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
      return /Android/.test(ua) ? 'menu' : 'no';
    },
    ask: function () {
      if (!offer) return;
      var o = offer; offer = null;
      o.prompt();
      if (o.userChoice) o.userChoice.then(installChanged, installChanged);
    }
  };
  // What makes the page an app, on the portal's own head: the page that
  // carried them (404.html) is gone once the portal took its place.
  function appHead() {
    var tags = [['link', { rel: 'manifest', href: BASE + 'manifest.webmanifest' }],
      ['link', { rel: 'apple-touch-icon', href: BASE + 'icons/icon-180.png' }],
      ['meta', { name: 'theme-color', content: '#0a0a0b' }],
      ['meta', { name: 'mobile-web-app-capable', content: 'yes' }],
      ['meta', { name: 'apple-mobile-web-app-capable', content: 'yes' }],
      ['meta', { name: 'apple-mobile-web-app-status-bar-style', content: 'black-translucent' }],
      ['meta', { name: 'apple-mobile-web-app-title', content: 'XPRS' }]];
    tags.forEach(function (t) {
      var e = document.createElement(t[0]);
      for (var k in t[1]) e.setAttribute(k, t[1][k]);
      document.head.appendChild(e);
    });
  }
  function install(html) {
    window.XMLHttpRequest = RnsXHR;
    window.fetch = rnsFetch;
    window.XPRS_REMOTE = { station: CALL, gateway: gw, group: GROUP, home: HOME, ask: ask, use: use, archivers: knownArchivers,
      lib: BASE + 'lib/', install: installer };
    swapIn(html);
    appHead();
    watch();
  }
  // The archivers the home station heard, for the next visit and the portal's list.
  function learnFromHome() {
    ask(CALL, 'GET', '/api/xprs/history', { kind: 'service', limit: '200' }).then(function (r) {
      learn(archiversIn(r.json && r.json.rows));
    }, function () {});
  }
  // A return visit: the portal at once, on the archiver used last time, while
  // it is reached (the calls wait for its proof); another of the visitor's
  // archivers takes its place when it does not answer.
  function startEarly() {
    CALL = memo().home;
    load(BASE + 'rns.js').then(gatewayList).then(function () {
      var r = proven = reach();
      return getText(BASE + 'portal.html').then(function (html) {
        install(html);
        r.then(learnFromHome, trouble);
      });
    }).catch(function (e) {
      failed('Can\u2019t reach an archiver right now', e.message || String(e));
    });
  }
  function start() {
    if (!CALL && !GROUP && !HOME) { failed('No station has this name'); return; }
    document.title = HOME ? 'XPRS' : (GROUP || CALL) + ' · XPRS';
    if (HOME && memo().home) { startEarly(); return; }
    load(BASE + 'rns.js').then(gatewayList).then(function () {
      return reach();
    }).then(function () {
      step('portal');
      say(CALL + ' proved itself' + (nick ? ' (' + nick + ')' : ''), false, true);
      if (HOME) document.title = CALL + ' · XPRS';
      say('Loading the portal…');
      // The page opens on the group the address named (#g=, read by the
      // portal page at start).
      if (GROUP) history.replaceState(null, '', location.pathname + '#g=' + encodeURIComponent(GROUP));
      return getText(BASE + 'portal.html');
    }).then(function (html) {
      install(html);
      if (HOME) learnFromHome();
    }).catch(function (e) {
      failed('Can’t reach ' + (GROUP || CALL) + ' right now', e.message || String(e));
    });
  }
  appShell();
  start();
})();
