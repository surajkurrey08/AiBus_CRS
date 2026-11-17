import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AdminApp } from "./app/App";
import "./styles/base.css";
import "./styles/theme.css";
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AdminApp />
  </StrictMode>,
);
