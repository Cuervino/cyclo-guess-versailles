// Loads the Google Maps JS API once and exposes the nearest-panorama lookup.

let loadPromise = null;

export function loadGoogleMaps() {
  if (loadPromise) return loadPromise;

  const apiKey = import.meta.env.VITE_GMAPS_KEY;
  if (!apiKey) {
    return Promise.reject(new Error("MISSING_KEY"));
  }

  loadPromise = new Promise((resolve, reject) => {
    const callbackName = "__gmapsInit";
    window[callbackName] = () => resolve(window.google);

    const script = document.createElement("script");
    const libraries = ["maps", "streetView"].join(",");
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${apiKey}` +
      `&v=weekly&libraries=${libraries}&loading=async&callback=${callbackName}`;
    script.async = true;
    script.onerror = () => reject(new Error("SCRIPT_LOAD_FAILED"));
    document.head.appendChild(script);
  });

  return loadPromise;
}

// Replace a Google map's base tiles with the CyclOSM layer (cycling-oriented
// OpenStreetMap tiles) and add the required attribution.
export function applyCyclOSM(google, map) {
  const cyclosm = new google.maps.ImageMapType({
    name: "CyclOSM",
    minZoom: 0,
    maxZoom: 20,
    tileSize: new google.maps.Size(256, 256),
    getTileUrl: (coord, zoom) => {
      const n = 1 << zoom;
      const x = ((coord.x % n) + n) % n; // wrap horizontally
      if (coord.y < 0 || coord.y >= n) return null; // out of bounds
      const sub = ["a", "b", "c"][Math.abs(coord.x + coord.y) % 3];
      return `https://${sub}.tile-cyclosm.openstreetmap.fr/cyclosm/${zoom}/${x}/${coord.y}.png`;
    },
  });
  map.mapTypes.set("cyclosm", cyclosm);
  map.setMapTypeId("cyclosm");

  const attrib = document.createElement("div");
  attrib.className = "tile-attrib";
  attrib.innerHTML =
    '© <a href="https://www.cyclosm.org/" target="_blank" rel="noreferrer">CyclOSM</a> · ' +
    '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';
  map.controls[google.maps.ControlPosition.BOTTOM_RIGHT].push(attrib);
}

// Get the capture date of a panorama by id. Resolves with the raw imageDate
// string ("YYYY-MM" or "YYYY") or null if unavailable.
export function panoramaDate(google, panoId) {
  const service = new google.maps.StreetViewService();
  return new Promise((resolve) => {
    service.getPanorama({ pano: panoId }, (data, status) => {
      if (status === google.maps.StreetViewStatus.OK && data?.imageDate) {
        resolve(data.imageDate);
      } else {
        resolve(null);
      }
    });
  });
}

// Find the nearest outdoor Street View panorama to a {lat,lng} point.
// Resolves with { panoId, lat, lng } or null if none within `radius` meters.
export function nearestPanorama(google, point, radius = 50) {
  const service = new google.maps.StreetViewService();
  return new Promise((resolve) => {
    service.getPanorama(
      {
        location: point,
        radius,
        source: google.maps.StreetViewSource.OUTDOOR,
        preference: google.maps.StreetViewPreference.NEAREST,
      },
      (data, status) => {
        if (status === google.maps.StreetViewStatus.OK && data?.location) {
          const ll = data.location.latLng;
          resolve({
            panoId: data.location.pano,
            lat: ll.lat(),
            lng: ll.lng(),
          });
        } else {
          resolve(null);
        }
      }
    );
  });
}
