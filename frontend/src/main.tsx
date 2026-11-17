import { Component, lazy, StrictMode, Suspense, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/base.css";
import "./styles/theme.css";
const Workspace = lazy(() =>
  import("./app/App.tsx").then((module) => ({ default: module.App })),
);
class WorkspaceBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="startup-state" role="alert">
        <div className="startup-brand">aibus</div>
        <h1>Workspace couldn’t open</h1>
        <p>
          Your saved demo data is still on this device. Reload to try again.
        </p>
        <button className="btn primary" onClick={() => location.reload()}>
          Reload workspace
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WorkspaceBoundary>
      <Suspense
        fallback={
          <div className="startup-state" role="status">
            <div className="startup-brand">aibus</div>
            <span className="loading-ring" />
            <p>Opening your operator workspace…</p>
          </div>
        }
      >
        <Workspace />
      </Suspense>
    </WorkspaceBoundary>
  </StrictMode>,
);
