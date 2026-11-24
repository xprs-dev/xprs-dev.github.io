#!/bin/sh
# xprs.dev/in/: refresh the portal page, its logo font and Reticulum for the
# browser from the sibling repos (portal/dist, portal/page/logo-font.css,
# reticulum-dart/build/rns.js). The portal page is
# the same file every station serves: never edit in/portal.html by hand.
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
cp "$HERE/../portal/dist/chat_page.html" "$HERE/in/portal.html"
cp "$HERE/../reticulum-dart/build/rns.js" "$HERE/in/rns.js"
# The logo font the looking page (404.html) shares with the portal.
cp "$HERE/../portal/page/logo-font.css" "$HERE/in/logo-font.css"
ls -l "$HERE/in/portal.html" "$HERE/in/rns.js"
