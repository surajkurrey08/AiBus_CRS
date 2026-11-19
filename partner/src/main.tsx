import { createRoot } from "react-dom/client";
import { App } from "./App";
import "../../admin/src/styles/theme.css";
import "../../admin/src/styles/base.css";
import "../../admin/src/features/operators/platform.css";
import "../../admin/src/features/platform/platform.css";
import "./portal.css";
createRoot(document.getElementById("root")!).render(<App />);
