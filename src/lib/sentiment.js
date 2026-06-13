// VeloVersailles verdict scale, keyed by spot.sentiment (1 very good -> 5 very
// bad). The middle level is the neutral / mixed one. Colours come from the
// --t1..--t5 theme tokens (see index.css); the emoji carries the verdict too so
// it reads without relying on colour. Shared by the game reveal and the avis
// editor so the two never drift.
export const SENTIMENT = {
  1: { label: "Très bon", emoji: "😀", cls: "vv-s1" },
  2: { label: "Plutôt bon", emoji: "🙂", cls: "vv-s2" },
  3: { label: "Mitigé", emoji: "😐", cls: "vv-s3" },
  4: { label: "Plutôt mauvais", emoji: "🙁", cls: "vv-s4" },
  5: { label: "Très mauvais", emoji: "😡", cls: "vv-s5" },
};

export const SENTIMENT_LEVELS = [1, 2, 3, 4, 5];
