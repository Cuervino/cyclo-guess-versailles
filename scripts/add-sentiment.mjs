// One-off: inject a `sentiment` (1 very good -> 5 very bad) on every spot that
// has a non-empty VeloVersailles description. Levels were hand-qualified from
// the description text. Re-runnable: it only sets the field, never touches text.
import { readFileSync, writeFileSync } from "node:fs";

const path = new URL("../src/data/spots.json", import.meta.url);

// id -> sentiment level (1..5).
const RATING = {
  "aZeTQp_jtZ4E0274X0OfiQ": 4,
  "JTtbnZsfAUvqBLTfnb-XbA": 4,
  "1hs9AJk8yf0aJr9Psj05nQ": 3,
  "bmCvHOV0iUDJleSa1Wskxg": 4,
  "KNIwvIO09JC-Y_VWLme_qg": 4,
  "kfPeiMsXhQSF9h7JX1Xd8Q": 3,
  "h-sTYGr4QjgWh_DPbmnFJg": 4,
  "lXT4OJAfNAxNToC_n0zDjA": 4,
  "HhktGtTYjyOWsQurujUtjA": 4,
  "2pOkq5tRXILC2G2apumz7Q": 4,
  "xD8QL5txFwJWgNumBR2KiQ": 3,
  "QeeAiRkk5GVg18QjlOs--A": 4,
  "eLio9qH4CkdJIwWSTkPT7g": 2,
  "ZoPn9G_upQP_OiPO3ZuQtA": 4,
  "BCBvWr8BnptbOEbhemCX_g": 4,
  "sYsqJDpQ0dK868xmFuBgqg": 4,
  "ns0xCAx0_1S0Ivap83WmwQ": 3,
  "FPCxm80cDsNHLK_SwSPqTA": 3,
  "wjolY6vru6epMbq1Zu9nYg": 4,
  "CAoSF0NJSE0wb2dLRUlDQWdJQzQ3NE9fM0FF": 3,
  "QHpqWUPIVxuUtV7-wWLXiw": 4,
  "8Nt2QUIEoblT3UY0fYNJuA": 3,
  "qdhAEw0CpYoRFORJ5NpnNA": 4,
  "zfRpwptGRs_m5dUHbmLaLw": 2,
  "nYXqYxeOZICHv5v69zDz9g": 4,
  "RuCTarahhg0Kl2tvypLBmA": 2,
  "y2HDWSQewVSxf3dg5sVnzA": 3,
  "Le2KLLOADCA3pAmpf5kp_w": 2,
  "BzZFOS0U6IwNN6QTZHo_jA": 2,
  "T1aQ1BeCO98DVf5uMlgC5g": 2,
  "qxc5IbsIhVPw93bwEwdO5w": 3,
  "ZsSJh5ekPmmkoIkL-BJuYQ": 3,
  "dgGiEzUibqfRdrcaxC-6AQ": 4,
  "tHK7UVs6xSboO1hi2Y8krQ": 5,
  "bUbT7Jm6DnKqR2B7SY0b5Q": 3,
  "dLI5Jt72k867k_-azFF39w": 4,
  "p8fF0xkqhhrOsrWjZoKcBg": 3,
  "rWUv_vsUgeBGyEKiPq7fdw": 4,
  "5QWtYdsSFGPBhWeN3uGnFQ": 2,
  "0W1ZPVdT8FGcBVrrY-sS9w": 4,
  "rcmK-QscAhqKs0XcxT5ERw": 2,
  "Eh4OEkuQqbN2Aqnf4-EjgA": 3,
  "XGt2PY9d0eJftrR6MTOy-A": 3,
  "G_VxI0m7O4lRIksjpv7kcg": 2,
  "diPEwYBrOEHeLpBVka_PGg": 4,
  "J4dYkvDtYkSgTOwum2I9Hw": 2,
  "1Khrx-ixIjTyTlD0-3XVpA": 3,
  "P2QE-mp_SPL25kRj6k__tQ": 3,
  "b6_c_eUZO4Et6ZTR7t0_yQ": 2,
  "pyIWKWELnfMO00xhNHRRYQ": 2,
  "liyMspPb3RpiIDbEiQh-sg": 3,
  "J7tnZhPgM90UxvVcOelTOg": 4,
  "_i3BoEGX8Hzenl03fU-uSw": 2,
  "icbeQ5iNRIkMg25zdUmo7w": 4,
  "lYJjnpaiFFJoH_5-h_nmKQ": 2,
  "iTUUUlJPvEssUO2XC96Jkw": 3,
  "SxmCU2LwOzPz5AWOH37AsA": 2,
  "g1dl6wZKnfXjciqbFKIBNg": 4,
  "qI8MQWQIeSKfJbGkS35Hyg": 3,
  "_37nZogRHWIWImeIpalMHQ": 2,
  "BPNK_-aemwDTb8UEBx3mlQ": 4,
  "4BIlIS5OdBkCmMK33qF6XQ": 2,
  "svQ7dnsMOh3ePbr7PzvBcw": 3,
  "oXvFBcC3gao1NxMZdYEqBw": 4,
  "kCmHPNdeJK8W5Qm9UfEpig": 2,
  "NgMUTWcWKJ158_0kSpbgXQ": 4,
  "MvY0J35kCyu0MalobNQkSw": 3,
  "B111lUnZ6vfh0EwMAhwQSQ": 5,
  "w16cHmUDBMfew8YGbeiQ8Q": 3,
  "VJKofJ9cCOLe5amrRiZBkw": 4,
  "2sWBtAC0Y8mJ3ESaCv9YFQ": 3,
  "VHdWXZVYhl6vwxXCAjhJ2w": 2,
  "HGpbR6zdayUkeQYM2p844A": 4,
};

const spots = JSON.parse(readFileSync(path, "utf8"));

let set = 0;
const describedNoRating = [];
for (const s of spots) {
  const hasDesc = typeof s.description === "string" && s.description.trim() !== "";
  if (!hasDesc) continue;
  if (RATING[s.id] != null) {
    s.sentiment = RATING[s.id];
    set++;
  } else {
    describedNoRating.push(s.id);
  }
}

writeFileSync(path, JSON.stringify(spots, null, 2) + "\n");

console.log(`spots total: ${spots.length}`);
console.log(`sentiment set: ${set}`);
if (describedNoRating.length) {
  console.log(`described but NOT rated (${describedNoRating.length}):`);
  console.log(describedNoRating.join("\n"));
}
