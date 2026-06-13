// Shared leaderboard backed by a Google Apps Script web app (a Google Sheet).
// The endpoint URL comes from VITE_LEADERBOARD_URL so it is not committed.
//
// Writes use a "simple" text/plain POST (no CORS preflight, which Apps Script
// can't answer). Reads use JSONP, because Apps Script web apps don't send the
// CORS headers a normal cross-origin fetch would need.

const URL = import.meta.env.VITE_LEADERBOARD_URL;

export function leaderboardEnabled() {
  return Boolean(URL);
}

export async function submitScore(name, score) {
  if (!URL) return;
  await fetch(URL, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ name, score }),
  });
}

export function fetchLeaderboard() {
  if (!URL) return Promise.resolve([]);
  return new Promise((resolve, reject) => {
    const cb = "__lbCb_" + Math.floor(Math.random() * 1e9);
    const script = document.createElement("script");
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("timeout"));
    }, 10000);
    function cleanup() {
      clearTimeout(timer);
      delete window[cb];
      script.remove();
    }
    window[cb] = (data) => {
      cleanup();
      resolve((data && data.scores) || []);
    };
    script.onerror = () => {
      cleanup();
      reject(new Error("network"));
    };
    const sep = URL.includes("?") ? "&" : "?";
    script.src = `${URL}${sep}callback=${cb}`;
    document.head.appendChild(script);
  });
}
