#!/bin/sh
# xprs.dev/in/: refresh the portal page, its logo font and Reticulum for the
# browser from the sibling repos (portal/dist, portal/page/logo-font.css,
# reticulum-dart/build/rns.js). The portal page is
# the same file every station serves: never edit in/portal.html by hand.
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
cp "$HERE/../portal/dist/chat_page.html" "$HERE/in/portal.html"
# Never an older build over the one published: reticulum-dart/build/ is only
# as new as the last time it was built there.
if [ "$HERE/../reticulum-dart/build/rns.js" -nt "$HERE/in/rns.js" ]; then
  cp "$HERE/../reticulum-dart/build/rns.js" "$HERE/in/rns.js"
else
  echo "in/rns.js kept: reticulum-dart/build/rns.js is not newer" >&2
fi
# The logo font the looking page (404.html) shares with the portal.
cp "$HERE/../portal/page/logo-font.css" "$HERE/in/logo-font.css"
# xprs.dev/in/ is the visitor's own portal: the same looking page as
# /in/<callsign> (404.html), which hands the address to in/shell.js.
cp "$HERE/404.html" "$HERE/in/index.html"
# The app's files and the hash of each (in/sw.js keeps them on the device and
# fetches only one whose hash changed). The map's libraries in in/lib/ are
# pinned copies (leaflet 1.9.4, pmtiles 4.3.0, protomaps-leaflet 5.1.0), so
# the installed app asks no CDN. Not listed: sw.js, the manifest and the
# icons, which the browser fetches itself, and this list.
(
  cd "$HERE"
  printf '{"files":{'
  sep=''
  for f in favicon.svg in/index.html in/shell.js in/rns.js in/portal.html \
           in/logo-font.css in/gateways.json in/lib/*; do
    printf '%s\n"/%s":"%s"' "$sep" "$f" "$(sha256sum "$f" | cut -d' ' -f1)"
    sep=','
  done
  printf '\n}}\n'
) > "$HERE/in/version.json"
ls -l "$HERE/in/portal.html" "$HERE/in/rns.js" "$HERE/in/index.html" "$HERE/in/version.json"
