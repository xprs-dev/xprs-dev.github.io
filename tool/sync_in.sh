#!/bin/sh
# xprs.dev/in/: refresh the portal page and Reticulum for the browser from the
# sibling repos (portal/dist, reticulum-dart/build/rns.js). The portal page is
# the same file every station serves: never edit in/portal.html by hand.
set -e
HERE="$(cd "$(dirname "$0")/.." && pwd)"
cp "$HERE/../portal/dist/chat_page.html" "$HERE/in/portal.html"
cp "$HERE/../reticulum-dart/build/rns.js" "$HERE/in/rns.js"
ls -l "$HERE/in/portal.html" "$HERE/in/rns.js"
