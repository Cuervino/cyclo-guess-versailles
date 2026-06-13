import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps, applyCyclOSM } from "./lib/googleMaps.js";
import { distanceMeters } from "./lib/geo.js";
import {
  leaderboardEnabled,
  submitScore,
  fetchLeaderboard,
} from "./lib/leaderboard.js";
import { SENTIMENT } from "./lib/sentiment.js";
import SPOTS from "./data/spots.json";
import logoVeloVersailles from "./assets/logo-veloversailles.jpg";

const ROUNDS = 5;
const DISTANCE_SCALE = 1800; // meters; very generous curve (1 km ≈ 2870 pts)
const PERFECT_RADIUS = 15; // meters; full 5000 within this radius
const MAP_COLLAPSED = { w: 220, h: 150 }; // size when not hovered
const VERSAILLES_CENTER = { lat: 48.805, lng: 2.132 };
// Roughly Versailles, with a ~1 km margin on each side so the pan doesn't hit
// the wall too early (≈0.009° lat, ≈0.014° lng at this latitude per km).
const VERSAILLES_BOUNDS = {
  south: 48.771,
  west: 2.066,
  north: 48.839,
  east: 2.184,
};

// CyclOSM raster tiles for the landing backdrop (free OSM tiles, no Google API
// cost). Centered on Versailles at z14; a 7x5 grid covers a wide viewport.
const LANDING_TILE_Z = 14;
const LANDING_TILE_X = 8288;
const LANDING_TILE_Y = 5640; // château de Versailles (~48.805 N, 2.120 E)
const LANDING_TILES = [];
for (let dy = -3; dy <= 3; dy++)
  for (let dx = -4; dx <= 4; dx++)
    LANDING_TILES.push({ x: LANDING_TILE_X + dx, y: LANDING_TILE_Y + dy });
const cyclosmTile = (x, y) =>
  `https://a.tile-cyclosm.openstreetmap.fr/cyclosm/${LANDING_TILE_Z}/${x}/${y}.png`;

const GAME_PANO_OPTIONS = {
  clickToGo: false, // no move (can't jump to adjacent panoramas)
  linksControl: false, // hide the move arrows
  scrollwheel: false, // no zoom by scroll
  zoomControl: false, // no zoom control
  disableDoubleClickZoom: true,
  showRoadLabels: false,
  addressControl: false,
  fullscreenControl: false,
  motionTracking: false,
  motionTrackingControl: false,
  enableCloseButton: false,
  panControl: false,
};

// Applied while the result is minimized: let the player look around and move to
// get their bearings (the opposite of the locked, frozen in-game framing).
const PANO_UNLOCK = {
  clickToGo: true,
  linksControl: true,
  scrollwheel: true,
  zoomControl: true,
  disableDoubleClickZoom: false,
  showRoadLabels: true,
  panControl: true,
};

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function formatDistance(m) {
  return m < 1000
    ? `${Math.round(m).toLocaleString("fr-FR")} m`
    : `${(m / 1000).toLocaleString("fr-FR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })} km`;
}

// Leaderboard timestamp (ISO string from the sheet) -> "YYYY-MM-DD HH:MM" in the
// viewer's local time. Empty for rows without a timestamp (the optimistic "you").
function formatTs(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours()
  )}:${p(d.getMinutes())}`;
}

// Build a Google Maps marker icon from an inline SVG string.
function svgIcon(g, svg, w, h, anchorX, anchorY) {
  return {
    url: "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg),
    scaledSize: new g.maps.Size(w, h),
    anchor: new g.maps.Point(anchorX, anchorY),
  };
}

// Result markers (mockup style 5): the shape carries the meaning — a check for
// the true location, a cross for the guess — colour only reinforces it.
const TRUE_MARKER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30"><circle cx="15" cy="15" r="12.5" fill="#1f9d57" stroke="#fff" stroke-width="2.5"/><path d="M9 15.5 L13 19.5 L21 11" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const GUESS_MARKER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30"><circle cx="15" cy="15" r="12.5" fill="#d83a34" stroke="#fff" stroke-width="2.5"/><path d="M10 10 L20 20 M20 10 L10 20" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/></svg>`;

// Placement marker (mockup style 4): a rounded orange bubble whose bottom tip
// marks the clicked point.
const PLACE_MARKER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36"><path d="M14 35 L8.5 23 L19.5 23 Z" fill="#f97316"/><rect x="3" y="3" width="22" height="22" rx="8" fill="#f97316" stroke="#fff" stroke-width="2"/><circle cx="14" cy="14" r="3.6" fill="#fff"/></svg>`;

export default function Game() {
  const [status, setStatus] = useState("init"); // init|no-key|error|playing
  const [errorMsg, setErrorMsg] = useState("");
  const [roundSpots, setRoundSpots] = useState([]);
  const [round, setRound] = useState(0);
  const [phase, setPhase] = useState("guessing"); // guessing|revealed|finished
  const [started, setStarted] = useState(false); // false = landing screen shown
  const [confirmQuit, setConfirmQuit] = useState(false); // quit confirmation modal
  const [minimized, setMinimized] = useState(false); // result card collapsed to a bottom bar
  const [guess, setGuess] = useState(null);
  const [results, setResults] = useState([]); // [{distance, score}]
  const [hovered, setHovered] = useState(false);
  const hoverTimer = useRef(null); // hover-intent open/close debounce
  const [resizing, setResizing] = useState(false);
  const [gameId, setGameId] = useState(0); // bumps each new game to rebuild maps
  const [name, setName] = useState(() => localStorage.getItem("cgv_name") || "");
  const [submitState, setSubmitState] = useState("idle"); // idle|sending|sent|error
  const [leaderboard, setLeaderboard] = useState(null); // null = not loaded yet
  const [showBoard, setShowBoard] = useState(false); // leaderboard modal on the landing
  // Expanded (hover) size, resizable + remembered. Collapsed size is fixed.
  const [mapSize, setMapSize] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("cgv_mapsize_v2")) || { w: 460, h: 340 };
    } catch {
      return { w: 460, h: 340 };
    }
  });

  const googleRef = useRef(null);
  const panoDivRef = useRef(null);
  const panoRef = useRef(null);
  const guessMapDivRef = useRef(null);
  const guessMapRef = useRef(null);
  const guessMarkerRef = useRef(null);
  const resultMapDivRef = useRef(null);
  const resultMapRef = useRef(null);
  const resultOverlaysRef = useRef([]); // markers + line, cleared each reveal

  // Frame the result map tightly on the guess and the true location.
  function frameResult(g, map, a, b) {
    const bounds = new g.maps.LatLngBounds();
    bounds.extend(a);
    bounds.extend(b);
    map.fitBounds(bounds, 64);
  }

  function startGame() {
    // Drop stale map instances so the effects rebuild them for the new game.
    resultMapRef.current = null;
    resultOverlaysRef.current = [];
    setRoundSpots(shuffled(SPOTS).slice(0, Math.min(ROUNDS, SPOTS.length)));
    setRound(0);
    setResults([]);
    setGuess(null);
    setPhase("guessing");
    setGameId((id) => id + 1);
    setSubmitState("idle");
    setLeaderboard(null);
  }

  async function submitAndReplay(total) {
    setSubmitState("sending");
    try {
      const clean = name.trim() || "Anonyme";
      localStorage.setItem("cgv_name", clean);
      await submitScore(clean, total);
      startGame(); // resets state and re-prefetches the updated standings
    } catch {
      setSubmitState("error");
    }
  }

  // Boot: load Google Maps, then start a game. Held back until the player leaves
  // the landing screen, so we don't touch the Google API before "Commencer".
  useEffect(() => {
    if (!started) return;
    (async () => {
      if (!SPOTS.length) {
        setStatus("error");
        setErrorMsg("Aucun spot dans la base (src/data/spots.json).");
        return;
      }
      let google;
      try {
        google = await loadGoogleMaps();
      } catch (e) {
        if (e.message === "MISSING_KEY") setStatus("no-key");
        else {
          setStatus("error");
          setErrorMsg(String(e.message || e));
        }
        return;
      }
      googleRef.current = google;
      startGame();
      setStatus("playing");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);

  // Show the panorama for the current round, started on the curated framing.
  useEffect(() => {
    if (status !== "playing" || !panoDivRef.current || !googleRef.current)
      return;
    const spot = roundSpots[round];
    if (!spot) return;
    const g = googleRef.current;
    if (!panoRef.current) {
      panoRef.current = new g.maps.StreetViewPanorama(
        panoDivRef.current,
        GAME_PANO_OPTIONS
      );
    }
    const pano = panoRef.current;
    pano.setPano(spot.id);
    pano.setPov({ heading: spot.heading ?? 0, pitch: spot.pitch ?? 0 });
    pano.setZoom(spot.zoom ?? 1);
    // Interaction (pan/zoom/drag) is blocked by a transparent overlay in the
    // render below, so the view stays fixed on the curated framing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round, status]);

  // While the result is minimized, unlock the panorama (and drop the lock
  // overlay, see render) so the player can pan/zoom/move to get their bearings.
  // Re-lock to the frozen framing otherwise.
  useEffect(() => {
    const pano = panoRef.current;
    if (!pano) return;
    const explore = phase === "revealed" && minimized;
    pano.setOptions(explore ? PANO_UNLOCK : GAME_PANO_OPTIONS);
  }, [phase, minimized, status, round]);

  // The guess map (corner), recreated each guessing round.
  useEffect(() => {
    if (
      status !== "playing" ||
      phase !== "guessing" ||
      !googleRef.current ||
      !guessMapDivRef.current
    )
      return;
    const g = googleRef.current;
    const map = new g.maps.Map(guessMapDivRef.current, {
      center: VERSAILLES_CENTER,
      zoom: 13,
      disableDefaultUI: true,
      zoomControl: true,
      clickableIcons: false,
      draggableCursor: "crosshair",
      restriction: { latLngBounds: VERSAILLES_BOUNDS, strictBounds: false },
    });
    applyCyclOSM(g, map);
    guessMapRef.current = map;
    guessMarkerRef.current = null;
    const listener = map.addListener("click", (e) => {
      const pos = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      if (!guessMarkerRef.current) {
        guessMarkerRef.current = new g.maps.Marker({
          map,
          position: pos,
          icon: svgIcon(g, PLACE_MARKER_SVG, 28, 36, 14, 35),
        });
      } else {
        guessMarkerRef.current.setPosition(pos);
      }
      setGuess(pos);
    });
    return () => g.maps.event.removeListener(listener);
  }, [round, phase, status, gameId]);

  // Create the result map once and warm its CyclOSM tiles in the background
  // while the player is still guessing, so the reveal is instant.
  useEffect(() => {
    if (
      status !== "playing" ||
      resultMapRef.current ||
      !resultMapDivRef.current ||
      !googleRef.current
    )
      return;
    const g = googleRef.current;
    const map = new g.maps.Map(resultMapDivRef.current, {
      center: VERSAILLES_CENTER,
      zoom: 13,
      disableDefaultUI: true,
      zoomControl: true,
      clickableIcons: false,
    });
    applyCyclOSM(g, map);
    resultMapRef.current = map;
  }, [status, gameId]);

  // Warm the high-zoom tiles around the true location at the start of each round,
  // so a very close guess reveals instantly. Harmless if the guess ends up far.
  useEffect(() => {
    if (status !== "playing" || phase !== "guessing" || !resultMapRef.current)
      return;
    const spot = roundSpots[round];
    if (!spot) return;
    const map = resultMapRef.current;
    map.setCenter({ lat: spot.lat, lng: spot.lng });
    map.setZoom(18); // warm deep tiles in case the guess lands very close
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round, status, gameId]);

  // On reveal, just drop the markers + line on the (already loaded) result map.
  useEffect(() => {
    if (phase !== "revealed" || !resultMapRef.current || !googleRef.current)
      return;
    const g = googleRef.current;
    const map = resultMapRef.current;
    const spot = roundSpots[round];
    const truePos = { lat: spot.lat, lng: spot.lng };

    resultOverlaysRef.current.forEach((o) => o.setMap(null));
    const dash = {
      path: "M 0,-1 0,1",
      strokeColor: "#ff7a00",
      strokeOpacity: 1,
      strokeWeight: 5,
      scale: 4,
    };
    resultOverlaysRef.current = [
      new g.maps.Polyline({
        map,
        path: [guess, truePos],
        geodesic: true,
        strokeColor: "#ffffff",
        strokeOpacity: 1,
        strokeWeight: 7,
        zIndex: 1,
      }),
      new g.maps.Polyline({
        map,
        path: [guess, truePos],
        geodesic: true,
        strokeOpacity: 0,
        icons: [{ icon: dash, offset: "0", repeat: "18px" }],
        zIndex: 2,
      }),
      new g.maps.Marker({
        map,
        position: truePos,
        icon: svgIcon(g, TRUE_MARKER_SVG, 30, 30, 15, 15),
        zIndex: 3,
      }),
      new g.maps.Marker({
        map,
        position: guess,
        icon: svgIcon(g, GUESS_MARKER_SVG, 30, 30, 15, 15),
        zIndex: 3,
      }),
    ];

    // Already framed during guessing; re-frame to be safe (instant if unchanged).
    frameResult(g, map, guess, truePos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, round]);

  // Prefetch the standings in the background while the player plays, so the
  // end screen shows them instantly (Apps Script has a slow cold start).
  useEffect(() => {
    if (status !== "playing" || !leaderboardEnabled()) return;
    fetchLeaderboard()
      .then(setLeaderboard)
      .catch(() => setLeaderboard([]));
  }, [status, gameId]);

  // Effective corner-map size: expanded while hovered or resizing, else small.
  const eff = hovered || resizing ? mapSize : MAP_COLLAPSED;

  // Hover intent: a small open delay avoids accidental expansion when the cursor
  // just sweeps over, and a longer close delay forgives brief exits / edge wobble.
  function onCornerEnter() {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHovered(true), 80);
  }
  function onCornerLeave() {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setHovered(false), 250);
  }
  useEffect(() => () => clearTimeout(hoverTimer.current), []);

  // Keep the Google map filling its container (and centered) when it resizes.
  useEffect(() => {
    const map = guessMapRef.current;
    const g = googleRef.current;
    if (!map || !g) return;
    const center = map.getCenter();
    g.maps.event.trigger(map, "resize");
    if (center) map.setCenter(center);
  }, [eff.w, eff.h]);

  function validate() {
    if (!guess) return;
    const spot = roundSpots[round];
    const distance = distanceMeters(guess, { lat: spot.lat, lng: spot.lng });
    // Full score inside the perfect radius; the decay only starts beyond it.
    const score =
      distance <= PERFECT_RADIUS
        ? 5000
        : Math.round(
            5000 * Math.exp(-(distance - PERFECT_RADIUS) / DISTANCE_SCALE)
          );
    setResults((r) => [...r, { distance, score }]);
    setMinimized(false);
    setHovered(false);
    setPhase("revealed");
  }

  // Dev-only: jump straight to the end screen with fake results.
  function devJumpToEnd() {
    const n = Math.min(ROUNDS, roundSpots.length) || ROUNDS;
    const fake = Array.from({ length: n }, (_, i) => ({
      distance: 30 + i * 180,
      score: 5000 - i * 520,
    }));
    setResults(fake);
    setRound(fake.length - 1);
    setPhase("finished");
  }

  // Back to the landing screen. Confirm first (via the modal) if a game is still
  // in progress, since leaving abandons the current round and score.
  function quitToLanding() {
    if (phase !== "finished") {
      setConfirmQuit(true);
      return;
    }
    doQuit();
  }

  function doQuit() {
    setConfirmQuit(false);
    // Return to the landing. A full reload guarantees a clean home screen
    // (started resets to false) and fully releases the Google Maps panorama and
    // map instances — more reliable than tearing the React tree down by hand.
    window.location.reload();
  }

  // Open the leaderboard modal from the landing. Fetch the standings on demand,
  // since the in-game prefetch only runs once a game has started.
  function openBoard() {
    setShowBoard(true);
    if (leaderboard === null && leaderboardEnabled()) {
      fetchLeaderboard()
        .then(setLeaderboard)
        .catch(() => setLeaderboard([]));
    }
  }

  function next() {
    setMinimized(false);
    setHovered(false);
    if (round + 1 < roundSpots.length) {
      setGuess(null);
      setRound((r) => r + 1);
      setPhase("guessing");
    } else {
      setPhase("finished");
    }
  }

  // Drag the top-left handle to set the expanded (hover) size of the corner map.
  function onResizeStart(e) {
    e.preventDefault();
    setResizing(true);
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = mapSize.w;
    const startH = mapSize.h;
    let last = { w: startW, h: startH };
    const onMove = (ev) => {
      last = {
        w: Math.max(220, Math.min(900, startW + (startX - ev.clientX))),
        h: Math.max(160, Math.min(700, startH + (startY - ev.clientY))),
      };
      setMapSize(last);
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setResizing(false);
      localStorage.setItem("cgv_mapsize_v2", JSON.stringify(last));
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // --- Render states ---------------------------------------------------------

  // Landing screen, shown on every arrival before the game (and the API) start.
  if (!started) {
    return (
      <div className="landing">
        <div className="landing-bg">
          <div className="landing-tiles">
            {LANDING_TILES.map((t) => (
              <img
                key={`${t.x}-${t.y}`}
                src={cyclosmTile(t.x, t.y)}
                alt=""
                width="256"
                height="256"
                loading="eager"
              />
            ))}
          </div>
        </div>
        <div className="landing-scrim" />
        <div className="landing-content">
          <img
            className="landing-logo"
            src={logoVeloVersailles}
            alt="VeloVersailles"
          />
          <h1 className="landing-brand">Cyclo Guessr Versailles</h1>
          <p className="landing-lead">
            <span>
              Un jeu de localisation autour des aménagements cyclables de
              Versailles.
            </span>
            <span>
              À partir d'une photo figée (façon « NMPZ » pour les habitués de
              Geoguessr), place ton point au plus près du lieu réel pour marquer
              un maximum de points, sur 5 manches.
            </span>
            <span>
              La plupart des points sont commentés par VeloVersailles.
            </span>
          </p>
          <button className="landing-start" onClick={() => setStarted(true)}>
            Commencer
          </button>
          {leaderboardEnabled() && (
            <button className="landing-board-link" onClick={openBoard}>
              Voir le classement
            </button>
          )}
          <p className="landing-disclaimer">
            Les vues proviennent de Google Street View et peuvent dater de plusieurs
            mois ou années{' '}: elles ne reflètent pas forcément l'état actuel des
            aménagements à Versailles.
          </p>
          <p className="landing-disclaimer">
            Prototype artisanal : l'API Google étant limitée en nombre de
            requêtes, le jeu peut parfois ne pas se lancer. Le classement reste
            temporaire et pourra être remis à zéro.
          </p>
        </div>

        <a
          className="landing-attribution"
          href="https://www.cyclosm.org/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Fond de carte : CyclOSM
          <svg
            className="ext-icon"
            viewBox="0 0 24 24"
            width="12"
            height="12"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M7 17 17 7" />
            <path d="M9 7 H17 V15" />
          </svg>
        </a>

        {showBoard && (
          <div className="modal-overlay" onClick={() => setShowBoard(false)}>
            <div
              className="modal-card modal-board"
              role="dialog"
              aria-modal="true"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="modal-title">Classement</h2>
              {leaderboard === null ? (
                <p className="modal-text muted">Chargement du classement…</p>
              ) : leaderboard.length === 0 ? (
                <p className="modal-text muted">Aucun score pour l'instant.</p>
              ) : (
                <ol className="lb-list">
                  {[...leaderboard]
                    .sort((a, b) => b.score - a.score)
                    .slice(0, 10)
                    .map((e, i) => (
                      <li key={i}>
                        <span className="lb-rank">{i + 1}</span>
                        <span className="lb-name">{e.name}</span>
                        <span className="lb-date">{formatTs(e.ts)}</span>
                        <span className="lb-score">
                          {e.score.toLocaleString("fr-FR")}
                        </span>
                      </li>
                    ))}
                </ol>
              )}
              <div className="modal-actions">
                <button
                  className="modal-primary"
                  onClick={() => setShowBoard(false)}
                >
                  Fermer
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (status === "no-key") {
    return (
      <div className="screen">
        <div className="card">
          <h1>Clé API manquante</h1>
          <p>
            Crée un fichier <code>.env.local</code> avec :
          </p>
          <pre>VITE_GMAPS_KEY=ta_cle_ici</pre>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="screen">
        <div className="card">
          <h1>Erreur</h1>
          <pre>{errorMsg}</pre>
        </div>
      </div>
    );
  }

  if (status === "init") {
    return (
      <div className="screen">
        <div className="card">
          <h1>Cyclo Guessr Versailles</h1>
          <p>Chargement…</p>
        </div>
      </div>
    );
  }

  const total = results.reduce((s, r) => s + r.score, 0);
  const lastResult = results[round];
  const spot = roundSpots[round];
  const tone = spot ? SENTIMENT[spot.sentiment] : null;

  // End-screen derived values.
  const maxTotal = roundSpots.length * 5000;
  const pct = maxTotal ? Math.round((total / maxTotal) * 100) : 0;
  const youName = name.trim();
  const nameMissing = !youName;
  // Insert the current score optimistically so the player sees their rank now.
  const merged = [
    ...(leaderboard || []),
    { name: youName, score: total, you: true },
  ].sort((a, b) => b.score - a.score);
  const youRank = merged.findIndex((e) => e.you);
  const fmt = (n) => n.toLocaleString("fr-FR");

  return (
    <div className="game">
      <div className="game-pano" ref={panoDivRef} />
      {!(phase === "revealed" && minimized) && <div className="pano-lock" />}

      <div className="hud">
        <span>
          Manche {Math.min(round + 1, roundSpots.length)} / {roundSpots.length}
        </span>
        <span>· {total} pts</span>
      </div>

      <button className="quit-btn" onClick={quitToLanding} title="Revenir à l'accueil">
        ✕ Quitter
      </button>

      {import.meta.env.DEV && (
        <div className="dev-panel">
          <span className="dev-tag">DEV</span>
          <a className="dev-btn" href="#curate">
            curation
          </a>
          <a className="dev-btn" href="#avis">
            avis
          </a>
          {phase !== "finished" && (
            <button className="dev-btn" onClick={devJumpToEnd}>
              écran de fin
            </button>
          )}
        </div>
      )}

      {phase === "guessing" && (
        <div
          className={`guess-corner${resizing ? " resizing" : ""}`}
          style={{ width: eff.w }}
          onMouseEnter={onCornerEnter}
          onMouseLeave={onCornerLeave}
        >
          <div className="gmap" style={{ height: eff.h }}>
            <div
              className="resize-handle"
              onPointerDown={onResizeStart}
              title="Glisser pour régler la taille agrandie"
            />
            <div className="gmap-inner" ref={guessMapDivRef} />
          </div>
          <button className="validate" onClick={validate} disabled={!guess}>
            {guess ? "Valider" : "Place ton point"}
          </button>
        </div>
      )}

      {status === "playing" && phase !== "finished" && (
        <div
          className={`result-overlay ${
            phase === "revealed" ? "shown" : "preload"
          } ${minimized ? "minimized" : ""}`}
        >
          <div className="result-card">
            {phase === "revealed" && (
              <button
                className="result-reduce"
                onClick={() => setMinimized(true)}
                title="Réduire pour revoir le Street View"
              >
                ▾ Réduire
              </button>
            )}
            <div className="result-map" ref={resultMapDivRef} />
            <div className="legend">
              <span className="legend-item">
                <span className="legend-dot" style={{ background: "#1f9d57" }} />
                Vrai lieu
              </span>
              <span className="legend-item">
                <span className="legend-dot" style={{ background: "#d83a34" }} />
                Ton guess
              </span>
            </div>
            {phase === "revealed" && lastResult && (
              <>
                <div className="result-head">
                  <strong>{fmt(lastResult.score)} points</strong>
                  <span>à {formatDistance(lastResult.distance)} du lieu</span>
                </div>
                {spot.description ? (
                  <div className={`vv-callout${tone ? ` vv-toned ${tone.cls}` : ""}`}>
                    <div className="vv-label">
                      {tone && <span className="vv-face">{tone.emoji}</span>}
                      Avis VeloVersailles{tone ? ` · ${tone.label}` : ""}
                    </div>
                    <p>{spot.description}</p>
                  </div>
                ) : (
                  <p className="result-desc muted">
                    (Pas de description pour ce spot.)
                  </p>
                )}
                <button className="next" onClick={next}>
                  {round + 1 < roundSpots.length
                    ? "Manche suivante →"
                    : "Voir le score final →"}
                </button>
              </>
            )}
          </div>

          {phase === "revealed" && minimized && (
            <div className="result-bottombar">
              <span className="bb-comment">
                {spot.description || "(Pas de description pour ce spot.)"}
              </span>
              <button className="bb-reopen" onClick={() => setMinimized(false)}>
                ▴ Revoir
              </button>
              <button className="bb-next" onClick={next}>
                {round + 1 < roundSpots.length
                  ? "Manche suivante →"
                  : "Voir le score final →"}
              </button>
            </div>
          )}
        </div>
      )}

      {phase === "finished" && (
        <div className="result-overlay">
          <div className="result-card">
            <div className="end-hero">
              <div className="ring" style={{ "--p": pct }}>
                <div className="ring-inner">
                  <b>{pct}%</b>
                  <span>du max</span>
                </div>
              </div>
              <div className="end-score">{fmt(total)}</div>
              <div className="end-max">/ {fmt(maxTotal)} points</div>
            </div>

            <div className="round-chips">
              {results.map((r, i) => (
                <div className="chip" key={i}>
                  <b>{r.score}</b>
                  <span>M{i + 1}</span>
                </div>
              ))}
            </div>

            {leaderboardEnabled() ? (
              <>
                <div className="lb">
                  <input
                    className="name-input"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Choisis ton pseudo"
                    maxLength={30}
                  />
                  {submitState === "error" && (
                    <p className="lb-error">Échec de l'envoi, réessaie.</p>
                  )}
                  <h2 className="lb-title">Classement</h2>
                  {leaderboard === null ? (
                    <p className="muted">Chargement du classement…</p>
                  ) : (
                    <ol className="lb-list">
                      {merged.slice(0, 10).map((e, i) => (
                        <li key={i} className={e.you ? "you" : ""}>
                          <span className="lb-rank">{i + 1}</span>
                          <span className="lb-name">
                            {e.you ? (e.name ? `${e.name} (toi)` : "(toi)") : e.name}
                          </span>
                          <span className="lb-date">{formatTs(e.ts)}</span>
                          <span className="lb-score">{fmt(e.score)}</span>
                        </li>
                      ))}
                      {youRank >= 10 && (
                        <>
                          <li className="lb-sep">…</li>
                          <li className="you">
                            <span className="lb-rank">{youRank + 1}</span>
                            <span className="lb-name">
                              {youName ? `${youName} (toi)` : "(toi)"}
                            </span>
                            <span className="lb-date" />
                            <span className="lb-score">{fmt(total)}</span>
                          </li>
                        </>
                      )}
                    </ol>
                  )}
                </div>
                <div className="end-actions">
                  <button
                    className="next"
                    onClick={() => submitAndReplay(total)}
                    disabled={submitState === "sending" || nameMissing}
                  >
                    {nameMissing
                      ? "Entre ton pseudo pour publier"
                      : submitState === "sending"
                      ? "Envoi…"
                      : "Envoyer mon score et rejouer"}
                  </button>
                  <button className="ghost replay-skip" onClick={startGame}>
                    Rejouer sans envoyer
                  </button>
                </div>
              </>
            ) : (
              <button className="next" onClick={startGame}>
                Rejouer
              </button>
            )}
          </div>
        </div>
      )}

      {confirmQuit && (
        <div
          className="modal-overlay"
          onClick={() => setConfirmQuit(false)}
        >
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="modal-title">Quitter la partie ?</h2>
            <p className="modal-text">
              La manche en cours et ton score seront perdus.
            </p>
            <div className="modal-actions">
              <button
                className="ghost"
                onClick={() => setConfirmQuit(false)}
              >
                Annuler
              </button>
              <button className="modal-danger" onClick={doQuit}>
                Quitter
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
