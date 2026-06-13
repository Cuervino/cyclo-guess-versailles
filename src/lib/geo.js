// Geo helpers: distance + sampling points along a polyline at a fixed spacing.

const R = 6371000; // Earth radius in meters
const toRad = (d) => (d * Math.PI) / 180;

// Haversine distance in meters between two {lat, lng} points.
export function distanceMeters(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Linear interpolation between two points (good enough at ~50m scale).
function lerp(a, b, t) {
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
}

// Walk a polyline (array of {lat,lng}) and emit a point every `spacing` meters.
export function samplePolyline(points, spacing = 50) {
  const out = [];
  if (points.length === 0) return out;
  out.push(points[0]);

  let distSinceLast = 0; // meters walked since the last emitted point
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const segLen = distanceMeters(a, b);
    if (segLen === 0) continue;

    let from = a; // moving anchor along the current segment
    let remaining = segLen; // meters left between `from` and `b`

    while (distSinceLast + remaining >= spacing) {
      const need = spacing - distSinceLast; // meters from `from` to the next sample
      const t = need / remaining;
      const p = lerp(from, b, t);
      out.push(p);
      from = p;
      remaining -= need;
      distSinceLast = 0;
    }
    distSinceLast += remaining;
  }
  return out;
}
