import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initTheme } from "./hooks/useTheme";
import { installExternalLinkHandler } from "./lib/externalLinks";
import { loadDesign } from "./lib/designTokens";

// Apply saved/system theme before first render to avoid flash
initTheme();

// Route external links to the system browser so the desktop window never gets
// stranded on a page with no back/refresh controls.
installExternalLinkHandler();

// The company's accent colour, when an administrator has set one.
void loadDesign();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
