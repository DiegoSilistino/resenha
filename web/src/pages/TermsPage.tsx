import { Link } from "react-router";
import { APP_NAME } from "@resenha/shared";

/** Atualize junto com o texto. */
const UPDATED = "25 de novembro de 2026";

/** Termos de uso e privacidade: o que fica guardado, quem vê e as regras. Aberta, sem precisar de conta. */
export function TermsPage() {
  return (
    <main className="terms-page">
      <article className="terms">
        <Link to="/" className="terms-back">
          ← Voltar para o {APP_NAME}
        </Link>
        <h1>Termos de uso e privacidade</h1>
        <p className="muted">Última atualização: {UPDATED}</p>

        <h2>Em poucas palavras</h2>
        <ul>
          <li>O {APP_NAME} é um espaço para conversar, ligar e assistir junto com a sua turma.</li>
          <li>
            As <strong>chamadas</strong> (voz, câmera, tela e legendas) são criptografadas de ponta a ponta: nem o servidor ouve
            ou vê.
          </li>
          <li>
            As <strong>mensagens de texto</strong> não são: quem mantém o servidor no ar tem acesso técnico ao que fica guardado
            nele.
          </li>
          <li>Seus dados não são vendidos nem usados para propaganda.</li>
        </ul>

        <h2>O que fica guardado</h2>
        <ul>
          <li>
            <strong>Sua conta:</strong> nome de usuário, nome de exibição, foto, capa, recado e status. A senha é guardada de um
            jeito que ninguém consegue ler. O e-mail, só se você cadastrar.
          </li>
          <li>
            <strong>O que você manda:</strong> mensagens, arquivos, fotos, figurinhas, sons e reações, até você ou um
            administrador apagar.
          </li>
          <li>
            <strong>Dados técnicos:</strong> o navegador ou aparelho de cada sessão aberta; relatórios de erro do seu navegador
            (com o navegador e a página), que vão para o painel dos administradores; e registros do servidor com o endereço IP,
            que ficam pouco tempo (têm tamanho máximo e vão sendo sobrescritos).
          </li>
          <li>
            <strong>Voz, câmera e tela não são gravados</strong> e saem do seu aparelho criptografados de ponta a ponta: o
            servidor só repassa o que não consegue abrir.
          </li>
        </ul>

        <h2>Quem tem acesso</h2>
        <ul>
          <li>As mensagens de uma roda aparecem para os membros dela; as conversas privadas, só para quem participa.</li>
          <li>
            Quem mantém o servidor tem acesso técnico ao banco de dados e aos arquivos, incluindo as mensagens das conversas
            privadas: elas ficam guardadas sem criptografia no servidor. O caminho entre o seu aparelho e o servidor é
            criptografado (HTTPS).
          </li>
          <li>
            Nas chamadas, cada pessoa cifra o próprio áudio e vídeo com uma chave só dela, que muda sempre que alguém entra ou
            sai. O cadeado no topo da chamada mostra um código de segurança: se for igual para todos, ninguém está no meio.
          </li>
          <li>Quando alguém denuncia uma mensagem, os administradores veem a denúncia e o texto dela, mesmo de uma conversa privada.</li>
          <li>
            O servidor faz cópias de segurança, e as diárias ficam guardadas por 7 dias. Algo que você apagou pode continuar
            numa cópia até ela sair.
          </li>
        </ul>

        <h2>Serviços de fora</h2>
        <ul>
          <li>
            <strong>Legendas ao vivo:</strong> quando você liga a transcrição, a sua fala vai para o Google (no Chrome) ou para a
            Microsoft (no Edge) para virar texto. Esse serviço ouve o que você fala, mesmo com a chamada criptografada; o texto
            que vai para a chamada segue cifrado.
          </li>
          <li>
            <strong>GIFs e Assistir juntos:</strong> os GIFs vêm do GIPHY e os vídeos do YouTube. Ao carregar, esses serviços
            veem o seu endereço IP.
          </li>
          <li>
            <strong>E-mail:</strong> os códigos de confirmação e de troca de senha saem por um serviço de envio de e-mail.
          </li>
        </ul>

        <h2>Regras de uso</h2>
        <ul>
          <li>
            Não use o {APP_NAME} para assediar, ameaçar ou expor ninguém, nem para compartilhar conteúdo ilegal, material de
            outras pessoas sem permissão, golpes ou vírus. Conteúdo sexual envolvendo menores é crime e leva à remoção imediata
            da conta.
          </li>
          <li>Respeite as regras de cada roda.</li>
          <li>Os administradores podem apagar mensagens e desativar ou remover contas que descumprirem estas regras.</li>
          <li>
            Use <strong>Bloquear</strong> (no perfil da pessoa) para deixar de ver alguém e <strong>Denunciar</strong> (no
            perfil ou na mensagem) para avisar os administradores. Quem foi denunciado não fica sabendo quem denunciou.
          </li>
        </ul>

        <h2>Seus direitos</h2>
        <ul>
          <li>Você vê e corrige os dados do seu perfil em Configurações quando quiser.</li>
          <li>
            Para pedir uma cópia dos seus dados ou a exclusão da conta, use o botão de feedback da tela inicial: ele vai direto
            para quem mantém o site. Na exclusão, a conta some e as mensagens que você mandou passam a aparecer como
            "Ex-membro".
          </li>
        </ul>

        <h2>Segurança da conta</h2>
        <p>
          Use uma senha só sua. Em Configurações → Conta, dá para cadastrar um e-mail para recuperar a senha e ligar a
          verificação em duas etapas, com um app autenticador.
        </p>

        <h2>Mudanças</h2>
        <p>Se estes termos mudarem, a data lá em cima muda junto.</p>
      </article>
    </main>
  );
}
