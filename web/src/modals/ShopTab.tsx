import { useState, type CSSProperties } from "react";
import { Coins } from "lucide-react";
import { COINS, SHOP_ITEMS, type ShopItem, type ShopSlot } from "@resenha/shared";
import { Avatar } from "../components/Avatar.tsx";
import { Nick } from "../components/Nick.tsx";
import { api } from "../lib/api.ts";
import { useApp } from "../state/app.ts";
import { toast } from "../state/toasts.ts";

const SECTIONS: { slot: ShopSlot; title: string; hint: string }[] = [
  { slot: "deco", title: "Decoração do avatar", hint: "Um efeito animado em volta da sua foto, em todo lugar." },
  { slot: "nickFx", title: "Efeito no nick", hint: "Seu nome brilha nas mensagens e nas listas." },
  { slot: "cardFx", title: "Efeito no cartão", hint: "Um fundo animado no seu cartão de perfil." },
];

/** Loja: moedas ganhas por aparecer e por ficar em call viram extras animados do perfil. */
export function ShopTab() {
  const me = useApp((s) => s.me);
  const wallet = useApp((s) => s.wallet);
  const [busy, setBusy] = useState<string | null>(null);
  if (!me) return null;

  async function buy(item: ShopItem) {
    setBusy(item.id);
    try {
      useApp.getState().setWallet((await api.buyItem(item.id)).wallet);
      toast.info(`${item.name} é seu! Já pode usar.`);
    } catch (err) {
      toast.fromError(err);
    } finally {
      setBusy(null);
    }
  }

  async function wear(item: ShopItem, on: boolean) {
    if (!me) return;
    setBusy(item.id);
    try {
      useApp.getState().setMe((await api.updateMe({ look: { ...me.look, [item.slot]: on ? item.id : null } })).me);
    } catch (err) {
      toast.fromError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="form shop">
      <div className="shop-balance">
        <Coins size={22} aria-hidden="true" />
        <strong>{wallet.coins}</strong>
        <span>{wallet.coins === 1 ? "moeda" : "moedas"}</span>
      </div>
      <p className="small-note muted">
        Ganhe +{COINS.daily} por dia ao entrar e +{COINS.perVoiceMinute} por minuto em call com mais alguém (até{" "}
        {COINS.voiceDailyMax} por dia). Molduras, degradê, fontes e capa continuam grátis no Perfil.
      </p>
      {SECTIONS.map((section) => (
        <fieldset key={section.slot} className="field">
          <legend>{section.title}</legend>
          <small>{section.hint}</small>
          <ul className="shop-grid">
            {SHOP_ITEMS.filter((i) => i.slot === section.slot).map((item) => {
              const owned = wallet.items.includes(item.id);
              const worn = me.look[item.slot] === item.id;
              const preview = { ...me, look: { ...me.look, [item.slot]: item.id } };
              return (
                <li key={item.id} className="shop-item" data-worn={worn || undefined}>
                  <span className="shop-preview" aria-hidden="true">
                    {item.slot === "deco" && <Avatar user={preview} size={52} />}
                    {item.slot === "nickFx" && <Nick user={preview} />}
                    {item.slot === "cardFx" && (
                      <span className="shop-card-swatch" data-card-fx={item.id} style={{ "--pa": "var(--accent)" } as CSSProperties} />
                    )}
                  </span>
                  <span className="shop-name">{item.name}</span>
                  {!owned ? (
                    <button
                      type="button"
                      className="btn btn-small btn-primary"
                      disabled={busy !== null || wallet.coins < item.price}
                      onClick={() => void buy(item)}
                      aria-label={`Comprar ${item.name} por ${item.price} moedas`}
                    >
                      <Coins size={14} aria-hidden="true" /> {item.price}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className={`btn btn-small ${worn ? "btn-ghost" : "btn-outline"}`}
                      disabled={busy !== null}
                      onClick={() => void wear(item, !worn)}
                    >
                      {worn ? "Tirar" : "Usar"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}
    </div>
  );
}
