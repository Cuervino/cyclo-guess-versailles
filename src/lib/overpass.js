// Fetch Versailles cycling network from OpenStreetMap via the Overpass API,
// then turn it into a list of candidate points spaced along the network.

import { samplePolyline } from "./geo.js";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

// Cycling infrastructure: dedicated paths, lanes/tracks marked on roads,
// and ways explicitly designated for bicycles.
// ref:INSEE=78646 is the French commune code for Versailles (Yvelines).
// Using it avoids matching the other "Versailles" worldwide (e.g. Kentucky, US).
const QUERY = `
[out:json][timeout:90];
area["ref:INSEE"="78646"]->.a;
(
  way["highway"="cycleway"](area.a);
  way["cycleway"~"lane|track|opposite_lane|opposite_track|shared_lane"](area.a);
  way["cycleway:left"~"lane|track"](area.a);
  way["cycleway:right"~"lane|track"](area.a);
  way["cycleway:both"~"lane|track"](area.a);
  way["bicycle"="designated"](area.a);
);
out geom;
`;

// Returns an array of candidate points: { lat, lng }.
export async function fetchCandidates(spacing = 50) {
  const res = await fetch(OVERPASS_URL, {
    method: "POST",
    body: "data=" + encodeURIComponent(QUERY),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  if (!res.ok) {
    throw new Error(`Overpass error ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();

  const candidates = [];
  for (const el of json.elements) {
    if (el.type !== "way" || !Array.isArray(el.geometry)) continue;
    const line = el.geometry.map((g) => ({ lat: g.lat, lng: g.lon }));
    for (const p of samplePolyline(line, spacing)) {
      candidates.push({ lat: p.lat, lng: p.lng });
    }
  }
  return candidates;
}
