import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { APP_NAME } from "@resenha/shared";
import { api } from "./lib/api.ts";
import { realtime } from "./lib/realtime.ts";
import { useTheme } from "./lib/theme.ts";
import { useApp } from "./state/app.ts";
import { Toasts } from "./components/Toasts.tsx";
import { Shell } from "./layout/Shell.tsx";
import { InvitePage } from "./pages/InvitePage.tsx";
import { LoginPage } from "./pages/LoginPage.tsx";
import { TermsPage } from "./pages/TermsPage.tsx";

export function App() {
  const me = useApp((s) => s.me);
  const loggedIn = !!me;
  useTheme();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;

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
        <Route path="/termos" element={<TermsPage />} />
        {/* sem login, guarda para onde ia (link de amizade, notificação) e volta para lá depois de entrar */}
        <Route path="/login" element={loggedIn ? <Navigate to={from ?? "/"} replace /> : <LoginPage />} />
        <Route
          path="/*"
          element={loggedIn ? <Shell /> : <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />}
        />
      </Routes>
      <Toasts />
    </>
  );
}
