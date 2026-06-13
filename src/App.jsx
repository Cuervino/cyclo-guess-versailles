import { useEffect, useState } from "react";
import Game from "./Game.jsx";
import Curation from "./Curation.jsx";
import "./App.css";

export default function App() {
  const [hash, setHash] = useState(window.location.hash);

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return hash === "#curate" ? <Curation /> : <Game />;
}
