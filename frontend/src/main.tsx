import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { initRum } from "./observability/rum.js";
import "./styles/base.css";

// PERF-02 scaffolding: no-op until VITE_RUM_APPLICATION_ID + aws-rum-web exist (see rum.ts).
initRum();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element (#root) not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
