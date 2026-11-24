import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

interface Props {
  title: string;
  onClose(): void;
  children: ReactNode;
  wide?: boolean;
  /** Sem cabeçalho nem moldura: o conteúdo é o próprio cartão (ex.: perfil). */
  bare?: boolean;
}

/** Diálogo nativo (<dialog>): foco preso, Esc fecha e leitores de tela entendem. */
export function Modal({ title, onClose, children, wide, bare }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  // Guardado em ref para o efeito abaixo rodar só uma vez, mesmo com onClose inline.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    dialog.showModal();
    const onCancel = (e: Event) => {
      // o "cancel" de um <input type="file"> (fechar a janela de arquivos) também sobe até aqui
      if (e.target !== dialog) return;
      e.preventDefault();
      closeRef.current();
    };
    dialog.addEventListener("cancel", onCancel);
    return () => {
      dialog.removeEventListener("cancel", onCancel);
      dialog.close();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="modal"
      data-wide={wide || undefined}
      data-bare={bare || undefined}
      aria-label={title}
      onMouseDown={(e) => {
        if (e.target === ref.current) closeRef.current(); // clique no fundo escurecido
      }}
    >
      {bare ? (
        children
      ) : (
      <div className="modal-body">
        <header className="modal-header">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={() => closeRef.current()} aria-label="Fechar">
            <X size={20} />
          </button>
        </header>
        {children}
      </div>
      )}
    </dialog>
  );
}
