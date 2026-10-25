#!/usr/bin/env bash
# Usage : scripts/run-loadtest.sh <before|after> <repo_dir> [host:port] [label]
# Prérequis : émulateur Firestore lancé (firebase emulators:start --only firestore).
set -e
MODE=$1; DIR=$2; HOST=${3:-127.0.0.1:8080}; LABEL=${4:-$MODE}
ESB=${ESBUILD:-esbuild}
cd "$DIR"
$ESB scripts/loadtest-$MODE.js --bundle --platform=node --format=esm --outfile=/tmp/lt-$MODE.mjs \
  --banner:js="import{createRequire}from'module';const require=createRequire(import.meta.url);" --log-level=error \
  --define:process.env.NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST="\"$HOST\"" --define:process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID='"demo-pointage"' \
  --define:process.env.NEXT_PUBLIC_FIREBASE_API_KEY='"x"' --define:process.env.NEXT_PUBLIC_FIREBASE_APP_ID='"x"'
cp /tmp/lt-$MODE.mjs "$DIR/.lt-$MODE.mjs"
LABEL=$LABEL node "$DIR/.lt-$MODE.mjs" | grep '^RESULT' | sed 's/^RESULT //'
rm -f "$DIR/.lt-$MODE.mjs"
