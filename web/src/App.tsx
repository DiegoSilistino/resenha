import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router";
import { APP_NAME } from "@resenha/shared";
import { api } from "./lib/api.ts";
import { realtime } from "./lib/realtime.ts";
import { useTheme } from "./lib/theme.ts";
import { useApp } from "./state/app.ts";
import { Toasts } from "./components/Toasts.tsx";
import { Shell } from "./layout/Shell.tsx";
import { InvitePage } from "./pages/InvitePage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";

export function App() {
  const me = useApp((s) => s.me);
  const loggedIn = !!me;
  useTheme();

  useEffect(() => {
    api
      .session()
      .then((r) => useApp.getState().setMe(r.me ?? false))
      .catch(() => useApp.getState().setMe(false));
  }, []);

  useEffect(() => {
    if (loggedIn) realtime.start();
  }, [loggedIn]);

  if (me === null) {
    return (
      <div className="splash" aria-busy="true">
        <span className="wordmark">{APP_NAME}</span>
      </div>
    );
  }

  return (
    <>
      <Routes>
        <Route path="/convite/:code" element={<InvitePage />} />
        <Route path="/login" element={loggedIn ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route path="/*" element={loggedIn ? <Shell /> : <Navigate to="/login" replace />} />
      </Routes>
      <Toasts />
    </>
  );
}
