import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
// The font is installed with the app (not loaded from the internet), so it
// still works if the venue wifi is bad. Figtree = a soft, rounded sans.
import "@fontsource-variable/figtree";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
