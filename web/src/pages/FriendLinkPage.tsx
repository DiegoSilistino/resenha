import { useEffect, useRef } from "react";
import { useNavigate, useParams } from "react-router";
import { api } from "../lib/api.ts";
import { displayNameOf, useApp } from "../state/app.ts";
import { toast } from "../state/toasts.ts";

/** Link de amizade: abriu, o pedido já vai (ou vira amizade, se a pessoa já tinha pedido). */
export function FriendLinkPage() {
  const { code = "" } = useParams();
  const navigate = useNavigate();
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return; // StrictMode roda o efeito duas vezes em desenvolvimento
    sent.current = true;
    api
      .useFriendLink(code)
      .then(({ friend }) => {
        const name = displayNameOf(useApp.getState().users, friend.userId);
        toast.info(friend.status === "friend" ? `Você e ${name} agora são amigos!` : `Pedido de amizade enviado para ${name}.`);
        void navigate(friend.status === "friend" ? "/amigos?aba=todos" : "/amigos?aba=pedidos", { replace: true });
      })
      .catch((err) => {
        toast.fromError(err);
        void navigate("/amigos", { replace: true });
      });
  }, [code, navigate]);

  return <main className="page empty-state">Mandando o pedido de amizade…</main>;
}
