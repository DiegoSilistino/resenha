# Resenha

Voz, chat e **assistir juntos** para um grupo fechado de amigos, no lugar do Discord. Inspirado no VoiceClub, com a arquitetura pensada para rodar inteira num servidor pequeno.

- **Cadastro aberto.** Qualquer pessoa cria conta em "Criar conta", na tela de entrada, e entra nas rodas abertas. Links de convite (uso único ou limitado, com validade) levam direto para uma roda, e o de admin cria contas de administração. Em Administrar o site → Membros ele também desativa (reversível) ou remove de vez uma conta, por exemplo uma duplicada: a pessoa sai na hora, o nome de usuário fica livre e as mensagens antigas ficam assinadas como "Ex-membro".
- **Canais de texto** em tempo real:
  - anexos de até 25 MB (imagens e vídeos, inclusive o .mov do iPhone, aparecem e tocam na conversa; se o navegador não abrir o vídeo, vira download);
  - reações com emoji (barra rápida e seletor com busca em português);
  - responder mensagens (citação clicável que leva até a original e avisa quem foi respondido);
  - GIFs do GIPHY, emoji na caixa de texto e ||spoiler||;
  - figurinhas: as do caramelo e as que cada um cria com uma foto (recorte quadrado no navegador); a estrela numa figurinha da conversa guarda a de outra pessoa nas suas (até 120 por pessoa);
  - edição (seta ↑ edita a última) e exclusão;
  - "fulano está digitando";
  - busca de mensagens (em todos os canais ou só no aberto), sem ligar para acento e aceitando palavra pela metade; clicar no resultado leva até a mensagem, mesmo se for antiga;
  - não lidas com contador na aba ("(3) #geral") e menções (@usuario) destacadas;
  - notificações do Windows quando o app está minimizado (todas as mensagens, só menções ou nunca);
  - formatação estilo Discord.
- **Perfil com foto**, recortada no próprio navegador (arrastar e zoom).
- **Canais de voz** com qualidade de SFU e chat próprio ao lado da chamada (dá para ler sem entrar):
  - mutar e ensurdecer, com sons de entrar, sair e mutar;
  - aviso opcional "fulano entrou na voz" quando você não está em chamada;
  - volume individual de 0 a 200%, separado para a voz e para o som da tela de cada pessoa (com silenciar rápido no próprio vídeo);
  - push-to-talk;
  - redução de ruído com IA (GTCRN, roda no navegador): tira teclado, mouse e barulho de fundo até enquanto a pessoa fala;
  - sensibilidade do microfone (automática ou manual, com medidor e "me ouvir"): só transmite quando você fala;
  - compartilhamento de tela com áudio e câmera, com perfis de qualidade (de "texto nítido" a 1440p a 60 fps) e indicador de resolução, fps e Mbps; a mesma qualidade no quadro pequeno e em tela cheia;
  - telas como no Discord: quem está na chamada clica em **Assistir** (antes disso não chega vídeo nem som), a tela vai para o quadro grande e dá para fixar outra ou desafixar e ver várias lado a lado na grade, que se ajusta ao número de pessoas;
  - mesa de sons: qualquer um envia trechos de até 5 s (escolhe o pedaço do áudio, o volume é igualado sozinho) e toca para a chamada; cada um tem o próprio volume e pode desligar; além da mesa da turma, cada um tem a sua mesa pessoal (aba "Meus sons", até 20 sons), que só a pessoa vê e toca, em qualquer chamada;
  - indicador de conexão (barrinhas) de cada pessoa, para saber de quem é a internet ruim;
  - quem fala "acende".
- **Assistir juntos.** Uma fila do YouTube sincronizada no mesmo segundo para todos, que serve para música e para cinema. Quem está no canal pausa, pula e adianta. O player continua tocando enquanto você navega pelo chat.
- **Legendas ao vivo.** Cada pessoa transcreve a própria fala no navegador e o texto vai para a sala, sem custo de servidor.
- **Painel do site: erros e feedback.** Clicando no seu perfil, admins têm o botão "Administrar o site". Quando algo falha no navegador de alguém (entrar na chamada, microfone, tela, redução de ruído), o erro aparece em Administrar o site → Erros com quem, quando, navegador e detalhes técnicos. O feedback que as pessoas mandam pela tela inicial vai para a aba Feedback, que só o criador do site (a primeira conta admin) vê. Um aviso aparece na lateral quando chega novidade.
  Na aba Feedback, "Marcar como implementado" deixa um aviso para quem mandou: chega na hora se a pessoa estiver online e fica no Início ("Novidades para você") até ela dispensar.
- **Loja de moedas.** Moedas por entrar no dia (+25) e por minuto em call com mais alguém (+1, até 60 por dia) compram extras animados do perfil: decoração do avatar, efeito no nick e no cartão (Configurações → Loja, ou o botão de moedas no topo). O que já era grátis (foto e capa com GIF, molduras, degradê, fontes) continua grátis.
- **Funciona no navegador e no celular**, e pode ser instalado como app (PWA).
- **App para Windows** (pasta `desktop/`, Electron). O botão "Baixar app" do topo do site baixa o instalador, que o GitHub Actions monta e publica nas Releases a cada mudança em `desktop/` (para lançar uma versão nova do instalador, suba `version` em `desktop/package.json`). O app abre o próprio site, então as novidades do site chegam sem reinstalar. O que ele soma ao navegador: push-to-talk funcionando com o jogo em foco, ícone na bandeja (fechar a janela não derruba a chamada), a janela aparecendo quando alguém liga e lembrando tamanho e posição. Para o app abrir direto no seu endereço, cadastre a variável `RESENHA_URL` (ex.: `https://resenha.seudominio.com.br`) em Settings → Secrets and variables → Actions → Variables do repositório; sem ela, o app pergunta o endereço na primeira vez. Sem certificado de assinatura, o Windows mostra "Windows protegeu o computador" na instalação: é só clicar em "Mais informações" → "Executar assim mesmo".
- **Chamada no privado sai sozinha** depois de 5 minutos com você sozinho nela (com 30 s de aviso e o botão "Ficar"), como no Discord. Salas das rodas não.

## Como funciona

```
                 HTTPS (443)
Navegador ───────────────────▶ Caddy ──┬──▶ App Node (API + WebSocket + site) ──▶ SQLite + arquivos
    │                                  └──▶ LiveKit  (sinalização da voz, rota /rtc)
    │
    └── mídia WebRTC (UDP 7882, ou TCP 7881) ──────▶ LiveKit (SFU)
```

| Camada | Escolha | Por quê |
|---|---|---|
| Frontend | React + Vite (PWA) | Leve, roda em qualquer navegador moderno |
| API e tempo real | Node + Fastify + WebSocket | Um processo só, fácil de operar |
| Banco | SQLite nativo do Node (`node:sqlite`) | Zero dependência nativa; backup é copiar um arquivo |
| Voz, vídeo e tela | LiveKit auto-hospedado (SFU) | Cada pessoa envia o áudio/vídeo **uma vez** e o servidor distribui |
| HTTPS | Caddy | Certificado automático; microfone e tela exigem HTTPS |

**Diferença em relação ao VoiceClub.** O VoiceClub usa WebRTC ponto a ponto, em que cada pessoa envia seu vídeo para todas as outras. Com 9 pessoas assistindo uma tela em 1080p, isso pede ~20 Mbps de **upload** de quem compartilha, o que muita conexão doméstica não tem. Com o SFU, quem compartilha envia uma vez (~2,5 Mbps) e o servidor repassa.

Como a sincronia do **Assistir juntos** funciona:
- O servidor nunca transmite a posição do vídeo, só o instante do relógio dele em que o vídeo "começou".
- Cada navegador estima a diferença entre o próprio relógio e o do servidor, ao estilo NTP.
- A partir disso, cada um calcula onde o vídeo deve estar, e corrige se desviar mais de 1,5 s.
- Por isso, quem entra no meio cai no ponto certo.

## Quem precisa instalar o quê

- **Seus amigos não instalam nada.** Abrem o link no Chrome ou no Edge, e podem "instalar" como app pelo próprio navegador.
- **O servidor roda num lugar só.** Para testar, roda no seu PC. Para a turma usar no dia a dia, numa VPS (seção "Colocar no ar"). O Docker só é usado na VPS.

## Rodar no seu computador (Windows, sem Docker)

Pré-requisitos: **Node 24 LTS** ([nodejs.org](https://nodejs.org)) e **Git**.

```powershell
git clone https://github.com/DiegoSilistino/resenha.git
cd resenha
npm install
npm run dev
```

O `npm run dev` sobe três coisas, cada uma com uma etiqueta no terminal:

| Etiqueta | O que é |
|---|---|
| `[voz]` | Servidor de voz (LiveKit). Na primeira vez, baixa o programa oficial (~19 MB) do GitHub, confere a assinatura SHA-256 e guarda em `.livekit/`. Se o **Firewall do Windows** perguntar, clique em **Permitir**. |
| `[server]` | API e tempo real (porta 3000). |
| `[web]` | O site, em `http://localhost:5173`. |

1. O terminal mostra um link `http://localhost:5173/convite/...`. Abra-o para criar a conta de **administrador**.
2. Para testar a voz com uma segunda pessoa, crie um convite em **Administrar o site → Convites** e abra-o numa **janela anônima**.

Se você tem Docker e prefere usá-lo, rode `docker compose -f docker-compose.dev.yml up -d` antes: o `npm run dev` percebe que já há um LiveKit rodando e usa esse.

### Problemas com a voz

O app diz exatamente onde está o problema:

| Mensagem | O que fazer |
|---|---|
| "O servidor de voz (LiveKit) não está rodando" | Veja as linhas `[voz]` no terminal. Se o download falhou (rede, proxy), baixe manualmente o arquivo indicado ali e extraia em `.livekit/1.13.10/`. |
| "Conectou ao servidor de voz, mas o áudio não passou" | No PC: permita o `livekit-server` no Firewall do Windows. Na VPS: libere `7881/tcp` e `7882/udp`. |
| "Seu navegador não alcançou o servidor de voz em …" | Na VPS: confira `LIVEKIT_PUBLIC_URL` (vazio = mesmo domínio) e o encaminhamento de `/rtc` no Caddy. |
| "…recusou as credenciais…" | `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` do app diferentes das do LiveKit. |
| Os amigos ainda ouvem seu teclado | Confira se a redução de ruído está em "Com IA" (Configurações → Áudio) e se todo mundo atualizou a página (Ctrl+F5). Use "Testar microfone" com "Me ouvir" e digite falando para conferir. |
| Sua voz soa abafada ou "robótica" | A IA reconstrói a voz até 8 kHz (qualidade de uma boa ligação). Em lugar silencioso, troque para "Básica do navegador". |
| Os amigos dizem que suas primeiras sílabas somem ou a voz picota | Em Configurações → Áudio → Sensibilidade, desmarque "Ajustar automaticamente" e baixe o nível até a barra passar da marca quando você fala baixo. Ou desligue a opção. |
| As notificações não aparecem | Configurações → Notificações mostra o estado. Se estiverem bloqueadas, libere no cadeado ao lado do endereço do site. No Windows, confira também se o "Não incomodar" (Assistente de foco) está desligado. |
| "O Windows não liberou o som do computador" (ao transmitir a tela) | Em Configurações → Sistema → Som → seu fone, desative **Aprimoramentos de áudio** e **Áudio espacial**; no software do headset, desligue surround/7.1. Ou transmita sem som. |

Para um diagnóstico rápido, entre no app e abra `/api/voice/health` (ex.: `http://localhost:5173/api/voice/health`).

## Colocar no ar (VPS)

O guia completo, passo a passo pelo Windows, está em **[DEPLOY.md](DEPLOY.md)**. Resumo:

1. Contrate uma VPS Ubuntu **em São Paulo** (ex.: Hostinger KVM 1).
2. Aponte um domínio para o IP dela. Um subdomínio grátis do DuckDNS serve.
3. Na VPS, clone o repositório e rode:
   ```bash
   bash deploy/setup-vps.sh SEU_DOMINIO
   ```
   O script instala o Docker, gera o `.env` com um segredo aleatório, sobe app, LiveKit e Caddy (HTTPS automático) e mostra o link de convite do administrador.

**Atualizar:** `git pull && bash deploy/setup-vps.sh`

## Manutenção

| Tarefa | Comando (em produção) |
|---|---|
| Novo convite pelo terminal | `docker compose exec app node dist/cli.js invite` (`--admin`, `--uses 5`, `--hours 24`) |
| Alguém esqueceu a senha | `docker compose exec app node dist/cli.js reset-password <usuario>` |
| Listar contas | `docker compose exec app node dist/cli.js users` |
| Restaurar um backup | `bash deploy/restore.sh` (veja abaixo) |

Em desenvolvimento, os mesmos comandos rodam com `npm run cli -- invite --admin`.

### Backup

Os dados (banco, anexos, fotos e sons da mesa) ficam no volume `app-data`. Há três camadas, todas automáticas menos a última:

1. **Cópia diária do banco** em `backups/` dentro do volume, guardando as últimas 7. Serve para voltar atrás se algo for apagado sem querer.
2. **Cópia antes de cada atualização** que mude a estrutura do banco (`backups/resenha-antes-da-vN-….db`).
3. **Backup completo para guardar fora da VPS.** Em Administrar o site → Backup, o botão "Baixar backup completo" gera um `.tar` com tudo. Baixe toda semana e guarde no PC ou no Google Drive; a aba avisa quando faz mais de 7 dias. Se a VPS se perder, é com esse arquivo que o Resenha volta.

**Restaurar** (na VPS, dentro de `/opt/resenha`):

```bash
bash deploy/restore.sh                               # lista as cópias guardadas no servidor
bash deploy/restore.sh resenha-2026-10-20.db         # volta o banco para a cópia daquele dia
bash deploy/restore.sh /root/resenha-backup-2026-10-24.tar   # restaura o backup completo baixado pelo app
```

O script pede confirmação e guarda os dados atuais em `backups/antes-da-restauracao-*.tar` antes de substituir, então dá para desfazer. Para levar o backup do PC para a VPS: `scp resenha-backup-AAAA-MM-DD.tar root@SEU_IP:/root/`.

Os logs do Docker têm tamanho máximo (3 arquivos de 10 MB por serviço), então não enchem o disco com o tempo. O espaço livre aparece na aba Backup.

## Segurança (já implementado)

- **Senhas.** Guardadas com scrypt. O login leva o mesmo tempo exista ou não o usuário, para não revelar quem tem conta. Há limite de tentativas.
- **Sessões.** Cookie `HttpOnly` + `SameSite=Lax`. O banco guarda só o hash do token. Trocar a senha ou desativar uma conta derruba as outras sessões na hora, inclusive a voz.
- **CSRF e WebSocket.** Mutações e conexões WebSocket vindas de outros sites são recusadas, com checagem de `Origin`.
- **Anexos e sons.** O tipo é detectado pelos bytes do arquivo, e não pela extensão. Só imagens e vídeos reais aparecem na conversa; o resto vira download com `nosniff` e `CSP sandbox`, então um HTML disfarçado de foto não executa.
- **Mensagens.** A formatação gera elementos React, nunca HTML cru, então não há injeção de script.
- **Política de segurança (CSP).** Restrita, liberando só o player do YouTube.

## Limitações conhecidas

- A fila do Assistir juntos fica em memória: reiniciar o servidor esvazia as filas.
- As legendas só funcionam no Chrome e no Edge, e o áudio é processado pelo Google ou pela Microsoft. Por isso a transcrição é opcional e desliga com o microfone mudo.
- Vídeos cujo dono proibiu a incorporação são recusados ao adicionar (exigência do YouTube).
- O push-to-talk só funciona com a janela em foco. Um atalho global exige o app desktop (fase 2).
- As notificações precisam do Resenha aberto (pode estar minimizado ou atrás de outra janela).
- As não lidas valem só enquanto a página está aberta: ao recarregar, o contador recomeça do zero.
- Não há TURN com TLS. Redes corporativas muito fechadas podem não conectar a voz; o TCP 7881 cobre a maioria dos casos.

## Próximos passos (fase 2)

1. **App Windows (Electron):**
   - bandeja do sistema;
   - push-to-talk global;
   - overlay no jogo;
   - iniciar com o Windows;
   - atualização automática.
2. **Clipes:** gravar os últimos 30 s da tela com um atalho (LiveKit Egress).
3. **Detecção de jogo** pela Steam Web API, com ícone do jogo ao lado do nome.
4. **Notificações push** (Web Push/VAPID), que chegam mesmo com o navegador fechado, e não lidas guardadas no servidor.
5. **Voz com IA em banda cheia:** hoje a IA reconstrói até 8 kHz; manter os agudos acima disso exige dividir as bandas.
6. **Twitch e Kick no cinema;** persistir a fila no banco.

## Créditos

- Redução de ruído: [GTCRN](https://github.com/Xiaobin-Rong/gtcrn) (MIT), pelo pacote [@sapphi-red/web-noise-suppressor](https://github.com/sapphi-red/web-noise-suppressor) (MIT).
- Calibração do filtro de sensibilidade: gravações de teclado do [ESC-50](https://github.com/karolpiczak/ESC-50) e de voz do LibriSpeech (só usadas nos testes, fora do repositório).

## Desenvolvimento

```
shared/   tipos, protocolo (zod), máquina de estados do Assistir juntos, relógio sincronizado
server/   Fastify: rotas, WebSocket, LiveKit, SQLite, anexos, CLI
web/      React: chat, voz (livekit-client), player sincronizado, telas de admin
deploy/   Caddyfile e configuração do LiveKit
scripts/  livekit-dev.mjs: baixa (com SHA-256 fixado) e inicia o LiveKit no npm run dev
```

```bash
npm test          # 90 testes (protocolo, sincronia, autenticação, permissões, CSRF, anexos, tempo real, diagnóstico da voz)
npm run typecheck
npm run build
```

Para renomear o app, troque `APP_NAME` em `shared/src/constants.ts` e o título em `web/index.html`.
