#!/usr/bin/env bash
# Compare avant / après en alternant les passages (même émulateur, base vidée entre chaque passage).
# Usage : scripts/compare-loadtest.sh <repo_avant> <repo_apres> <repetitions> <fichier_sortie> [host:port]
set -e
BEFORE=$1; AFTER=$2; REPS=${3:-5}; OUT=$4; HOST=${5:-127.0.0.1:8080}
EMU=${EMU_REST:-127.0.0.1:8080}
: > "$OUT"
reset() { curl -s -X DELETE "http://$EMU/emulator/v1/projects/demo-pointage/databases/(default)/documents" > /dev/null; }
for i in $(seq 1 "$REPS"); do
  reset; $(dirname "$0")/run-loadtest.sh before "$BEFORE" "$HOST" "avant" | tail -1 >> "$OUT"
  reset; $(dirname "$0")/run-loadtest.sh after  "$AFTER"  "$HOST" "après" | tail -1 >> "$OUT"
done
