import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(<App />);

// Ask the browser to exempt our log from automatic eviction. WebKit clears
// localStorage after 7 days without a visit unless the origin is persisted;
// Chrome grants this readily to installed apps. Failure is harmless — the
// export button remains the real backup.
if (navigator.storage && navigator.storage.persist) {
  navigator.storage
    .persisted()
    .then((already) => (already ? true : navigator.storage.persist()))
    .catch(() => {});
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}
