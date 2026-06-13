# cyclo-guess-versailles

A GeoGuessr-style game built around cycling black spots in Versailles, plus the
curation tool used to build its database of spots.

## How it works

1. **Curation tool** (current screen): pulls the Versailles cycling network from
   OpenStreetMap, samples points every 50 m along it, and for each one finds the
   nearest Google Street View panorama. You review them one by one (Yes / No) and
   add a short description of the cycling problem. The result is a database of
   validated spots.
2. **Game** (next step): players see a Street View in NMPZ mode (no move, pan,
   zoom; street labels hidden), drop a guess on a Versailles-only map, get a
   GeoGuessr-style score, then see the real location and the problem description.

## Setup

1. Create a Google Maps API key with **Maps JavaScript API** and **Street View
   Static API** enabled, restricted to `localhost` referrers.
2. Copy the key into a local env file (never committed):
   ```
   cp .env.local.example .env.local
   # then edit .env.local and paste your key
   ```
3. Install and run:
   ```
   npm install
   npm run dev
   ```

## Data

- Curation state lives in the browser's `localStorage` (candidates, validated
  spots, rejected panoramas).
- Use **Exporter spots.json** to download the validated spots. That file will
  feed the game.
