import { useEffect, useRef, useState } from "react";
import {
  loadGoogleMaps,
  nearestPanorama,
  panoramaDate,
  applyCyclOSM,
} from "./lib/googleMaps.js";
import { loadSpots, saveSpots, downloadSpots } from "./lib/storage.js";
import DevNav from "./DevNav.jsx";

// Château de Versailles — where the map and the seed panorama start.
const CHATEAU = { lat: 48.8049, lng: 2.1204 };

// Map clicks are approximate, so search a generous radius to land on the nearest
// street's Street View instead of failing when the click misses a road.
const SEARCH_RADIUS = 150;

// Interactive panorama: the opposite of the random mode's frozen view.
const PANO_OPTIONS = {
  clickToGo: true,
  linksControl: true,
  showRoadLabels: true,
  addressControl: true,
  fullscreenControl: false,
  motionTracking: false,
  motionTrackingControl: false,
  enableCloseButton: false,
  panControl: true,
  zoomControl: true,
};

// Extract the year out of an imageDate string ("YYYY-MM" or "YYYY").
const yearOf = (imageDate) => (imageDate ? String(imageDate).slice(0, 4) : null);

// Resizable right panel (map + spots) width, persisted.
const WKEY = "cgv_free_panelw_v3";
const WMIN = 340;
const WMAX = 820;
const WDEF = 460;

export default function CurationFree() {
  const [status, setStatus] = useState("init"); // init|no-key|error|ready
  const [errorMsg, setErrorMsg] = useState("");
  const [spots, setSpots] = useState([]);
  const [description, setDescription] = useState("");
  const [year, setYear] = useState(null);
  const [hasPano, setHasPano] = useState(false); // a panorama is currently shown
  const [notice, setNotice] = useState("");
  const [selectedId, setSelectedId] = useState(null); // spot selected from map/list
  const [panelW, setPanelW] = useState(() => {
    const s = Number(localStorage.getItem(WKEY));
    return s >= WMIN && s <= WMAX ? s : WDEF;
  });

  const panelRef = useRef(null);
  const googleRef = useRef(null);
  const panoDivRef = useRef(null);
  const panoInstanceRef = useRef(null);
  const mapDivRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markerRef = useRef(null);
  const spotMarkersRef = useRef([]); // discreet markers for already-saved spots
  const boundaryLoadedRef = useRef(false); // Versailles outline added once
  const listRef = useRef(null);
  const syncingRef = useRef(false); // guards the pano<->map feedback loop

  // Drag the handle to set the Street View / panel ratio. During the drag we
  // mutate the DOM directly (no React re-render, so the Google map isn't
  // disturbed) and only commit the width + resize the map on release. Pointer
  // capture keeps events on the handle even over the Google iframes.
  function startResize(e) {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    let w = panelW;
    const onMove = (ev) => {
      w = Math.min(WMAX, Math.max(WMIN, window.innerWidth - ev.clientX));
      if (panelRef.current) panelRef.current.style.flex = `0 0 ${w}px`;
    };
    const onUp = (ev) => {
      handle.releasePointerCapture(ev.pointerId);
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      setPanelW(w);
      localStorage.setItem(WKEY, String(w));
      if (mapInstanceRef.current && googleRef.current)
        googleRef.current.maps.event.trigger(mapInstanceRef.current, "resize");
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  }

  // Move the marker + recenter the map on a {lat,lng} point.
  function placeMarker(point) {
    if (markerRef.current) markerRef.current.setPosition(point);
    if (mapInstanceRef.current) mapInstanceRef.current.panTo(point);
  }

  // Look up the nearest panorama to a point and show it.
  async function goToPoint(point) {
    setNotice("");
    placeMarker(point);
    const pano = await nearestPanorama(googleRef.current, point, SEARCH_RADIUS);
    if (pano) {
      panoInstanceRef.current.setPano(pano.panoId);
    } else {
      setNotice("Pas de Street View ici.");
      setHasPano(false);
      setYear(null);
    }
  }

  // Boot: load Google Maps, load saved spots, build the map + panorama.
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
      setSpots(loadSpots());
      setStatus("ready");
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Build the map + panorama once the DOM nodes exist (status === "ready").
  useEffect(() => {
    if (status !== "ready" || !googleRef.current) return;
    if (mapInstanceRef.current) return; // already built
    const g = googleRef.current;

    // Map (interactive, CyclOSM basemap).
    const map = new g.maps.Map(mapDivRef.current, {
      center: CHATEAU,
      zoom: 15,
      disableDefaultUI: true,
      zoomControl: true,
      gestureHandling: "greedy",
      draggableCursor: "crosshair",
    });
    applyCyclOSM(g, map);
    mapInstanceRef.current = map;

    const marker = new g.maps.Marker({ map, draggable: true });
    markerRef.current = marker;

    // Panorama (interactive).
    const pano = new g.maps.StreetViewPanorama(panoDivRef.current, PANO_OPTIONS);
    panoInstanceRef.current = pano;

    // Click on the map → place marker + jump to nearest panorama.
    map.addListener("click", (e) => {
      goToPoint({ lat: e.latLng.lat(), lng: e.latLng.lng() });
    });

    // Drag the marker → same behaviour as clicking.
    marker.addListener("dragend", (e) => {
      goToPoint({ lat: e.latLng.lat(), lng: e.latLng.lng() });
    });

    // Walking in Street View moves the position → follow it on the map.
    pano.addListener("position_changed", () => {
      const pos = pano.getPosition();
      if (!pos) return;
      syncingRef.current = true;
      placeMarker({ lat: pos.lat(), lng: pos.lng() });
      syncingRef.current = false;
      setHasPano(true);
    });

    // Panorama changed → refresh the capture year badge.
    pano.addListener("pano_changed", async () => {
      const id = pano.getPano();
      if (!id) return;
      const d = await panoramaDate(g, id);
      setYear(yearOf(d));
    });

    // The map is created in the same commit as the first "ready" render, so its
    // container may not be laid out yet. Force Google Maps to re-measure once the
    // browser has done layout, otherwise it can paint blank.
    requestAnimationFrame(() => {
      g.maps.event.trigger(map, "resize");
      map.setCenter(CHATEAU);
    });

    // No auto-loaded panorama: start on the map, the Street View fills in on the
    // first map click (avoids dumping the user inside the palace's indoor pano).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Show every saved spot on the map as a discreet dot; rebuild on any change.
  useEffect(() => {
    const g = googleRef.current;
    const map = mapInstanceRef.current;
    if (!g || !map) return;
    spotMarkersRef.current.forEach((m) => m.setMap(null));
    spotMarkersRef.current = spots.map((s) => {
      const m = new g.maps.Marker({
        map,
        position: { lat: s.lat, lng: s.lng },
        title: s.description || `${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}`,
        icon: {
          path: g.maps.SymbolPath.CIRCLE,
          scale: 5,
          fillColor: "#ff7a00",
          fillOpacity: 1,
          strokeColor: "#fff",
          strokeWeight: 1.5,
        },
        zIndex: 1, // below the active draggable marker
      });
      m.addListener("click", () => goToSpot(s));
      return m;
    });
  }, [spots, status]);

  // Overlay the Versailles commune outline (INSEE 78646) as a light layer so the
  // city limits are visible without hiding the map. Fetched once from the public
  // geo.api.gouv.fr; silently skipped if it fails.
  useEffect(() => {
    const g = googleRef.current;
    const map = mapInstanceRef.current;
    if (!g || !map || boundaryLoadedRef.current) return;
    boundaryLoadedRef.current = true;
    (async () => {
      try {
        const res = await fetch(
          "https://geo.api.gouv.fr/communes/78646?fields=contour&format=geojson&geometry=contour"
        );
        if (!res.ok) return;
        const geojson = await res.json();
        map.data.addGeoJson(geojson);
        map.data.setStyle({
          fillColor: "#ff7a00",
          fillOpacity: 0.15,
          strokeColor: "#ff7a00",
          strokeOpacity: 1,
          strokeWeight: 3,
          clickable: false, // let clicks pass through to place markers
        });
      } catch {
        boundaryLoadedRef.current = false; // allow a retry on next render
      }
    })();
  }, [status]);

  function addSpot() {
    const pano = panoInstanceRef.current;
    const pos = pano.getPosition();
    if (!pos) return;
    const id = pano.getPano();
    if (spots.some((s) => s.id === id)) {
      setNotice("Ce spot est déjà dans la liste.");
      return;
    }
    const pov = pano.getPov();
    const spot = {
      id,
      lat: pos.lat(),
      lng: pos.lng(),
      heading: pov.heading,
      pitch: pov.pitch,
      zoom: pano.getZoom(),
      description: description.trim(),
      createdAt: new Date().toISOString(),
    };
    const next = [...spots, spot];
    setSpots(next);
    saveSpots(next);
    setDescription("");
    setNotice("Spot ajouté.");
  }

  function goToSpot(spot) {
    setNotice("");
    setSelectedId(spot.id);
    placeMarker({ lat: spot.lat, lng: spot.lng });
    panoInstanceRef.current.setPano(spot.id);
  }

  // Scroll the selected spot into view in the list (e.g. after a marker click).
  useEffect(() => {
    if (!selectedId || !listRef.current) return;
    const el = listRef.current.querySelector(
      `[data-id="${CSS.escape(selectedId)}"]`
    );
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [selectedId]);

  function removeSpot(id) {
    const next = spots.filter((s) => s.id !== id);
    setSpots(next);
    saveSpots(next);
    if (id === selectedId) setSelectedId(null);
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

  if (status === "init") {
    return (
      <div className="screen">
        <div className="card">
          <h1>Exploration libre</h1>
          <p>Chargement…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <strong>Exploration libre — points noirs cyclables (Versailles)</strong>
        <span className="counts">📍 {spots.length} spots</span>
        <span className="actions">
          <DevNav current="free" />
          <button onClick={() => downloadSpots(spots)} disabled={!spots.length}>
            Exporter spots.json
          </button>
        </span>
      </header>

      <div className="workbench free">
        <div className="pano" ref={panoDivRef}>
          {year && hasPano && (
            <div className="pano-year">Prise de vue : {year}</div>
          )}
          {!hasPano && (
            <div className="overlay" style={{ background: "#0c0d11" }}>
              {notice || "Clique sur la carte pour explorer un endroit en Street View."}
            </div>
          )}
        </div>
        <div
          className="panel-resizer"
          onPointerDown={startResize}
          title="Glisser pour ajuster la largeur"
        />
        <aside
          className="panel"
          ref={panelRef}
          style={{ flex: `0 0 ${panelW}px` }}
        >
          <p className="hint">
            Clique sur la carte (ou déplace le marqueur) pour aller à un endroit,
            puis navigue dans le Street View comme sur Google Maps.
          </p>
          <div className="map map-free" ref={mapDivRef} />
          <label className="field">
            Description du problème (optionnel)
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Carrefour où la piste disparaît, stationnement gênant…"
              rows={3}
            />
          </label>
          <button className="add" onClick={addSpot} disabled={!hasPano}>
            ＋ Ajouter ce spot
          </button>
          {notice && hasPano && <p className="notice">{notice}</p>}

          {spots.length > 0 && (
            <ul className="spot-list" ref={listRef}>
              {spots.map((s) => (
                <li
                  key={s.id}
                  data-id={s.id}
                  className={s.id === selectedId ? "selected" : undefined}
                >
                  <span className="spot-desc">
                    {s.description || `${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}`}
                  </span>
                  <span className="spot-actions">
                    <button className="ghost" onClick={() => goToSpot(s)}>
                      Aller
                    </button>
                    <button className="ghost" onClick={() => removeSpot(s.id)}>
                      Supprimer
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
