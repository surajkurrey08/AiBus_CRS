import { useEffect, useState } from "react";
import {
  authState,
  logout,
  refreshSession,
  subscribeAuth,
} from "../api/client";
import { AdminLogin } from "../features/auth/AdminLogin";
import { PlatformScreen } from "../features/operators/PlatformScreen";
export function AdminApp() {
  const [user, setUser] = useState(authState().user);
  const [starting, setStarting] = useState(true);
  useEffect(() => {
    const unsubscribe = subscribeAuth(() => setUser(authState().user));
    void refreshSession()
      .catch(() => {})
      .finally(() => setStarting(false));
    return unsubscribe;
  }, []);
  if (starting)
    return (
      <div className="startup-state" role="status">
        Opening admin panel...
      </div>
    );
  if (!user) return <AdminLogin />;
  if (user.role !== "super_admin")
    return (
      <div className="startup-state">
        <h1>Administrator access required</h1>
        <p>Sign in with a platform administrator account.</p>
        <button className="btn" onClick={() => void logout().catch(() => {})}>
          Sign out
        </button>
      </div>
    );
  return <PlatformScreen user={user} />;
}
