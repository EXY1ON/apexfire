#!/usr/bin/env bash
# Switch on ApexFire's 15-minute live ingestion on Firebase project firewatch-ff023.
# Prerequisites (owner actions, once): Blaze billing linked, with a budget alert; the default Realtime Database created in the
# Firebase console (Realtime Database > Create database > Belgium europe-west1 > locked mode): the CLI cannot create a first instance.
# Stores the FIRMS MAP_KEY in Secret Manager without printing it,
# deploys the scheduled function and database rules, then rebuilds the site pointing at the live feed.
# It does NOT publish the website (Hosting stays a separate decision).
# Undo: firebase functions:delete refresh_live --project firewatch-ff023 (stops all scheduled work).
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT=firewatch-ff023
DB="${PROJECT}-default-rtdb"
URL="https://${DB}.europe-west1.firebasedatabase.app"

read -r -p "Billing linked to ${PROJECT} and you approve deploying the function + database rules? [y/N] " ok
[[ "$ok" == "y" ]] || { echo "Stopped; nothing changed."; exit 1; }

firebase database:instances:list --project "$PROJECT" 2>/dev/null | grep -q "$DB" \
  || { echo "No default Realtime Database ${DB}: create it in the Firebase console (Belgium europe-west1, locked mode), then rerun."; exit 1; }

# The key goes from the private file straight into Secret Manager through stdin.
python3 -c 'import sys; sys.path.insert(0, "tools"); from pathlib import Path; from check_firms import map_key; sys.stdout.write(map_key(Path("Token-and-key.txt")))' \
  | firebase functions:secrets:set FIRMS_MAP_KEY --data-file - --project "$PROJECT"

printf 'DATABASE_URL=%s\n' "$URL" > functions/.env
.venv/bin/python tools/export_web_data.py   # refreshes functions/firelib.py and functions/data/
functions/venv/bin/python -m unittest tests/test_functions.py
firebase deploy --only functions:refresh_live,database --project "$PROJECT"  # mkffis_wms is deployed separately, once MKFFIS reuse terms are settled

VITE_LIVE_URL="$URL" npm --prefix web run build
echo "Live feed: ${URL}/public/recent.json (first snapshot within 15 minutes). Site rebuilt in web/dist with the live URL; not published."
