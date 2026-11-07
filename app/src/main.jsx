import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
// Fonts are installed with the app (not loaded from the internet), so they
// still work if the venue wifi is bad. Fraunces = soft serif for headlines,
// Figtree = rounded sans for everything else.
import "@fontsource-variable/fraunces/full.css";
import "@fontsource-variable/figtree";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
