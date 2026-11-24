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
