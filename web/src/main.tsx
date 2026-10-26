import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import "@fontsource-variable/atkinson-hyperlegible-next";
import "@fontsource-variable/bricolage-grotesque";
import "./styles.css";
import "./lib/errors.ts"; // registra o envio de erros inesperados para o painel do admin
import "./voice/soundboard.ts"; // toca os sons da mesa que os amigos disparam na chamada
import { App } from "./App.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
