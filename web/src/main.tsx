import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { loadRemoteConfig } from "./ai/remoteConfig";

void loadRemoteConfig(); // not awaited: the app never waits for it

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
