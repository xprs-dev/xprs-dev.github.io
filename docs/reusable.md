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
- `parsePos(p)` (`in/index.html`): a `pos:` as XPRS.md 15.1 reads it, a value
  with redaction bars placed at the middle of the square its readable digits
  name, with that square as `box`. The map draws one marker with a count
  per square (`boxes` in `render()`). Any page that shows positions uses it.
- `in/xprs.js`: the portal's crypto, seal and NOSTR signer
  (`portal/page/xprs_crypto.js`, `xprs_seal.js`, `xprs_nostr.js`), joined by
  `tool/sync_in.sh`. A page of the site that signs, seals or derives a
  callsign loads it instead of copying the code.
- Signing in and messaging (`in/index.html`): `useKey` / `useExtension` /
  `restore` keep the portal's `xprs_nsec` / `xprs_ext`, so one sign-in holds
  on the map and every `/in/<call>`; `sign(canonical)` and `seal(npub, text)`
  are promise forms of the portal's `signAny` and seal; `sendDm(peer, npub,
  text)` is identity, seal, sign, `POST /api/xprs/send`; `room(peer)` is how
  many bytes of text still fit. Any site page that writes to someone uses them.
- `rns(method, path, q, body)` (`in/index.html`): every call over the Reticulum
  link one at a time, and `linkUp()` reaching the gateway once however many
  ask at the same moment (a second `connect()` drops the first link).
