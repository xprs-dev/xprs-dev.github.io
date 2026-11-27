# Reusable pieces

- `swapIn(html)` (`in/shell.js`): replaces this document with another page in
  the same window without `document.open()` (which erases the window's
  listeners, and with them a NOSTR extension's answers): parse, swap the root,
  run the scripts in order as fresh elements, then fire `DOMContentLoaded`
  and `load`. Use it for any page the site loads into itself.
- The portal's look outside the portal (`404.html`, `in/index.html`): the
  palette on `:root`, `.header` with the `Wartext` logo (`in/logo-font.css`,
  copied from `portal/page/logo-font.css` by `tool/sync_in.sh`), `.card` and
  `.act`. A new page of the site starts from these, so it and a station's
  portal read as one site.
- `say(text, bad, quiet)` / `step(leg)` / `failed(text, detail)`
  (`in/shell.js`, with `#in-status`, `#in-steps`, `#in-log` in `404.html`):
  one line for what is being done now, a bar of legs lit as they are done,
  and everything said kept under Details. Any page that reaches something in
  several steps before it can show it can use the same three.
- The map, its positions and the visitor's accounts and archivers are the
  portal's (`portal/docs/reusable.md`: `mapPos`, `accList`, `declareHold`).
  `in/index.html` is `404.html`, copied by `tool/sync_in.sh`.
- `in/shell.js` home mode: `linkNamed(c, g)` (a named link with its proof
  checked, the Reticulum key remembered), `race(cands, g)` (three at once,
  the first proven wins), `discover(own, g)` (archivers from `t:service
  serve:archive`), `ask(c, method, path, query, body)` (any station through
  the same gateway, one call at a time each). The portal reaches them as
  `window.XPRS_REMOTE.ask` / `.archivers()`.
- `in/shell.js` `use(c)` (`XPRS_REMOTE.use`): another archiver as the
  portal's base. `linkNamed` first through the same gateway, so a station
  that cannot be reached leaves the page as it is; it resolves with `go()`,
  which reopens `/in/` on it (memo `home`, so the next visit starts there)
  or, on `/in/<call>` and group pages, goes to its own address.
- **The app kept on the device** (`in/sw.js`, `in/version.json`,
  `in/manifest.webmanifest`): the worker keeps the files `version.json`
  lists (a SHA-256 each, written by `tool/sync_in.sh`) and answers every
  `/in/...` address from them; `{op:'check'}` from the page (at most once a
  day, `appShell()` in `in/shell.js`) fetches only a file whose hash changed
  and puts nothing unless every fetched file matches its hash. A new file of
  the app is added to the list in `tool/sync_in.sh`, never fetched from a
  CDN (`in/lib/` holds pinned copies of the map's libraries;
  `XPRS_REMOTE.lib` tells the portal where). An ask with a query goes to
  the network past the worker.
- **`fileGet(ref)` / `filePut(ref, r, withSession)`** (`in/shell.js`): a file
  read over the link, kept in Cache Storage under its reference (a
  reference names its bytes), 200 MB with the longest unused out first;
  never one the station marked private. Whatever reads
  `/api/xprs/file/<ref>` whole goes through `call()`, which looks there
  first.
- **`gatewaysFrom(text)` / `gatewayList()` / `gatewaysAgain()`**: the order
  gateways are tried in (the last that worked, the listed ones shuffled,
  then remembered ones the list dropped), all of them kept in `xprs_reach`
  so a start needs no list from xprs.dev.
- **`installer`** (`XPRS_REMOTE.install`: `state()`, `ask()`) holds the
  browser's install offer for the portal's menu; `appHead()` puts the
  manifest and the Apple tags on the portal's head after `swapIn`.
- **`tool/serve.py`**: the site on 127.0.0.1 as GitHub Pages serves it
  (`404.html` for unknown addresses), a secure context, for trying the
  worker and the install offer.

