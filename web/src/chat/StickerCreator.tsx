import { Modal } from "../components/Modal.tsx";
import { api } from "../lib/api.ts";
import { AvatarEditor } from "../modals/AvatarEditor.tsx";

/** Nova figurinha: escolhe a foto, recorta o quadrado e ela vai para as suas (carregado só quando abre). */
export function StickerCreator({ onClose, onCreated }: { onClose(): void; onCreated(): void }) {
  return (
    <Modal title="Nova figurinha" onClose={onClose}>
      <div className="sticker-creator">
        <p className="muted">
          Escolha uma foto e recorte o quadrado. A figurinha fica nas suas, e quem receber pode tocar na estrela para usar também.
        </p>
        <AvatarEditor
          hasImage={false}
          square
          out={320}
          pickText="Escolher foto"
          savedText="Figurinha criada."
          upload={(image) => api.createSticker(image)}
          remove={async () => undefined}
          onDone={onCreated}
        />
      </div>
    </Modal>
  );
}
