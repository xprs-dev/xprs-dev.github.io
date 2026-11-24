# Reusable pieces

- `swapIn(html)` (`in/shell.js`): replaces this document with another page in
  the same window without `document.open()` (which erases the window's
  listeners, and with them a NOSTR extension's answers): parse, swap the root,
  run the scripts in order as fresh elements, then fire `DOMContentLoaded`
  and `load`. Use it for any page the site loads into itself.
