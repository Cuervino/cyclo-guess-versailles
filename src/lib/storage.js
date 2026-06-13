// Persistence for the curation tool, all in localStorage.

const KEYS = {
  candidates: "cgv_candidates",
  spots: "cgv_spots", // validated spots (the game database)
  rejected: "cgv_rejected", // pano ids rejected by the curator
};

const read = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));

export const loadCandidates = () => read(KEYS.candidates, null);
export const saveCandidates = (c) => write(KEYS.candidates, c);

export const loadSpots = () => read(KEYS.spots, []);
export const saveSpots = (s) => write(KEYS.spots, s);

export const loadRejected = () => read(KEYS.rejected, []);
export const saveRejected = (r) => write(KEYS.rejected, r);

export function resetAll() {
  localStorage.removeItem(KEYS.candidates);
  localStorage.removeItem(KEYS.spots);
  localStorage.removeItem(KEYS.rejected);
}

// Clear only the candidate list (forces a fresh OSM fetch on reload) while
// keeping validated spots and rejected pano ids.
export function clearCandidates() {
  localStorage.removeItem(KEYS.candidates);
}

// Trigger a download of the validated spots as spots.json.
export function downloadSpots(spots) {
  const blob = new Blob([JSON.stringify(spots, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "spots.json";
  a.click();
  URL.revokeObjectURL(url);
}
