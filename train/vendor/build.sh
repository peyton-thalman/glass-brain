#!/bin/sh
# Rebuild web/js/vendor/planner.js from ~/moneyguide/src. Do not edit the output by hand.
cd "$(dirname "$0")"
~/moneyguide/node_modules/.bin/esbuild planner-entry.ts --bundle --format=esm --minify --target=es2020 \
  --banner:js="// Bundled from ~/moneyguide/src (engine + analysis + insights): the MoneyGuide planning engine, 2026 law. Rebuild with train/vendor/build.sh; do not edit." \
  --outfile=../../web/js/vendor/planner.js
