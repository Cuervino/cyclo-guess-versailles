import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps, nearestPanorama } from "./lib/googleMaps.js";
import { fetchCandidates } from "./lib/overpass.js";
import {
  loadCandidates,
  saveCandidates,
  loadSpots,
  saveSpots,
  loadRejected,
  saveRejected,
  resetAll,
  clearCandidates,
  downloadSpots,
} from "./lib/storage.js";
import DevNav from "./DevNav.jsx";

// Fisher-Yates shuffle (returns a new array) so curation jumps around the city
// instead of walking the network path point by point.
function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const PANO_OPTIONS = {
  clickToGo: false,
  linksControl: false,
  showRoadLabels: false,
  addressControl: false,
  fullscreenControl: false,
  motionTracking: false,
  motionTrackingControl: false,
  enableCloseButton: false,
  panControl: true,
  zoomControl: true,
};

export default function Curation() {
  const [status, setStatus] = useState("init"); // init|no-key|fetching|searching|ready|exhausted|error
  const [errorMsg, setErrorMsg] = useState("");
  const [current, setCurrent] = useState(null); // {panoId, lat, lng, candidateIndex}
  const [spots, setSpots] = useState([]);
  const [rejected, setRejected] = useState([]);
  const [candidatesTotal, setCandidatesTotal] = useState(0);
  const [description, setDescription] = useState("");

  const googleRef = useRef(null);
  const candidatesRef = useRef([]);
  const indexRef = useRef(0);
  const seenRef = useRef(new Set()); // pano ids already decided (validated or rejected)

  const panoDivRef = useRef(null);
  const panoInstanceRef = useRef(null);
  const mapDivRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRef = useRef(null);

  // Walk forward from `fromIndex` until we find a candidate with a fresh panorama.
  async function findNext(fromIndex) {
    setStatus("searching");
    const cands = candidatesRef.current;
    for (let i = fromIndex; i < cands.length; i++) {
      indexRef.current = i;
      const pano = await nearestPanorama(googleRef.current, cands[i], 50);
      if (pano && !seenRef.current.has(pano.panoId)) {
        setCurrent({ ...pano, candidateIndex: i });
        setStatus("ready");
        return;
      }
    }
    indexRef.current = cands.length;
    setCurrent(null);
    setStatus("exhausted");
  }

  // Boot: load Google Maps, load or fetch candidates, start curating.
  useEffect(() => {
    let cancelled = false;
    (async () => {
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
      if (cancelled) return;
      googleRef.current = google;

      let cands = loadCandidates();
      if (!cands) {
        setStatus("fetching");
        try {
          cands = await fetchCandidates(50);
          saveCandidates(cands);
        } catch (e) {
          setStatus("error");
          setErrorMsg("OpenStreetMap: " + String(e.message || e));
          return;
        }
      }
      if (cancelled) return;
      candidatesRef.current = shuffled(cands);
      setCandidatesTotal(cands.length);

      const sp = loadSpots();
      const rj = loadRejected();
      setSpots(sp);
      setRejected(rj);
      seenRef.current = new Set([...sp.map((s) => s.id), ...rj]);

      findNext(0);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render / update the panorama when the current spot changes.
  useEffect(() => {
    if (!current || !panoDivRef.current || !googleRef.current) return;
    const g = googleRef.current;
    if (!panoInstanceRef.current) {
      panoInstanceRef.current = new g.maps.StreetViewPanorama(
        panoDivRef.current,
        PANO_OPTIONS
      );
    }
    panoInstanceRef.current.setPano(current.panoId);
    panoInstanceRef.current.setPov({ heading: 0, pitch: 0 });
    panoInstanceRef.current.setZoom(0);
  }, [current]);

  // Render / update the location map when the current spot changes.
  useEffect(() => {
    if (!current || !mapDivRef.current || !googleRef.current) return;
    const g = googleRef.current;
    const pos = { lat: current.lat, lng: current.lng };
    if (!mapInstanceRef.current) {
      mapInstanceRef.current = new g.maps.Map(mapDivRef.current, {
        center: pos,
        zoom: 16,
        disableDefaultUI: true,
        zoomControl: true,
      });
      markerRef.current = new g.maps.Marker({ map: mapInstanceRef.current });
    }
    mapInstanceRef.current.setCenter(pos);
    markerRef.current.setPosition(pos);
  }, [current]);

  function accept() {
    const pano = panoInstanceRef.current;
    const pov = pano.getPov();
    const spot = {
      id: current.panoId,
      lat: current.lat,
      lng: current.lng,
      heading: pov.heading,
      pitch: pov.pitch,
      zoom: pano.getZoom(),
      description: description.trim(),
      createdAt: new Date().toISOString(),
    };
    const next = [...spots, spot];
    setSpots(next);
    saveSpots(next);
    seenRef.current.add(current.panoId);
    setDescription("");
    findNext(indexRef.current + 1);
  }

  function reject() {
    const next = [...rejected, current.panoId];
    setRejected(next);
    saveRejected(next);
    seenRef.current.add(current.panoId);
    setDescription("");
    findNext(indexRef.current + 1);
  }

  function handleReset() {
    if (!confirm("Tout effacer (candidats, spots validés, rejetés) ?")) return;
    resetAll();
    location.reload();
  }

  function handleReloadCandidates() {
    if (
      !confirm(
        "Recharger les candidats depuis OpenStreetMap ? (tes spots validés sont conservés)"
      )
    )
      return;
    clearCandidates();
    location.reload();
  }

  // --- Render states ---------------------------------------------------------

  if (status === "no-key") {
    return (
      <div className="screen">
        <div className="card">
          <h1>Clé API manquante</h1>
          <p>
            Crée un fichier <code>.env.local</code> à la racine du projet avec :
          </p>
          <pre>VITE_GMAPS_KEY=ta_cle_ici</pre>
          <p>Puis relance le serveur de dev.</p>
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

  if (status === "init" || status === "fetching") {
    return (
      <div className="screen">
        <div className="card">
          <h1>Curation des points noirs cyclables</h1>
          <p>
            {status === "fetching"
              ? "Récupération du réseau cyclable de Versailles (OpenStreetMap)…"
              : "Chargement…"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <strong>Curation — points noirs cyclables (Versailles)</strong>
        <span className="counts">
          ✅ {spots.length} validés · ❌ {rejected.length} rejetés ·{" "}
          {candidatesTotal} candidats
        </span>
        <span className="actions">
          <DevNav current="curate" />
          <button onClick={() => downloadSpots(spots)} disabled={!spots.length}>
            Exporter spots.json
          </button>
          <button className="ghost" onClick={handleReloadCandidates}>
            Recharger candidats
          </button>
          <button className="ghost" onClick={handleReset}>
            Réinitialiser
          </button>
        </span>
      </header>

      {status === "exhausted" ? (
        <div className="screen">
          <div className="card">
            <h1>Terminé 🎉</h1>
            <p>
              Tous les candidats ont été passés en revue. {spots.length} spots
              validés.
            </p>
            <button onClick={() => downloadSpots(spots)} disabled={!spots.length}>
              Exporter spots.json
            </button>
          </div>
        </div>
      ) : (
        <div className="workbench">
          <div className="pano" ref={panoDivRef}>
            {status === "searching" && (
              <div className="overlay">Recherche du prochain spot…</div>
            )}
          </div>
          <aside className="panel">
            <div className="map" ref={mapDivRef} />
            <label className="field">
              Description du problème (optionnel)
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Carrefour où la piste disparaît, stationnement gênant…"
                rows={4}
              />
            </label>
            <div className="decision">
              <button
                className="no"
                onClick={reject}
                disabled={status !== "ready"}
              >
                ❌ Non
              </button>
              <button
                className="yes"
                onClick={accept}
                disabled={status !== "ready"}
              >
                ✅ Oui, garder
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
