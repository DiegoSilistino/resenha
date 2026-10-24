# Resenha

Voz, chat e **assistir juntos** para um grupo fechado de amigos, no lugar do Discord. Inspirado no VoiceClub, com a arquitetura pensada para rodar inteira num servidor pequeno.

- **Contas só por convite.** O admin gera links de uso único ou limitado, com validade.
- **Canais de texto** em tempo real:
  - anexos (imagens e vídeos aparecem na conversa);
  - edição e exclusão;
  - "fulano está digitando";
  - marcação de não lidas;
  - formatação estilo Discord.
- **Canais de voz** com qualidade de SFU:
  - mutar e ensurdecer;
  - volume individual de 0 a 200%;
  - push-to-talk;
  - compartilhamento de tela com áudio (1080p30) e câmera;
  - quem fala "acende".
- **Assistir juntos.** Uma fila do YouTube sincronizada no mesmo segundo para todos, que serve para música e para cinema. Quem está no canal pausa, pula e adianta. O player continua tocando enquanto você navega pelo chat.
- **Legendas ao vivo.** Cada pessoa transcreve a própria fala no navegador e o texto vai para a sala, sem custo de servidor.
- **Funciona no navegador e no celular**, e pode ser instalado como app (PWA).

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
2. Para testar a voz com uma segunda pessoa, crie um convite em **⚙ Administrar → Convites** e abra-o numa **janela anônima**.

Se você tem Docker e prefere usá-lo, rode `docker compose -f docker-compose.dev.yml up -d` antes: o `npm run dev` percebe que já há um LiveKit rodando e usa esse.

### Problemas com a voz

O app diz exatamente onde está o problema:

| Mensagem | O que fazer |
|---|---|
| "O servidor de voz (LiveKit) não está rodando" | Veja as linhas `[voz]` no terminal. Se o download falhou (rede, proxy), baixe manualmente o arquivo indicado ali e extraia em `.livekit/1.13.10/`. |
| "Conectou ao servidor de voz, mas o áudio não passou" | No PC: permita o `livekit-server` no Firewall do Windows. Na VPS: libere `7881/tcp` e `7882/udp`. |
| "Seu navegador não alcançou o servidor de voz em …" | Na VPS: confira `LIVEKIT_PUBLIC_URL` (vazio = mesmo domínio) e o encaminhamento de `/rtc` no Caddy. |
| "…recusou as credenciais…" | `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` do app diferentes das do LiveKit. |

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
| Backup | veja abaixo |

Em desenvolvimento, os mesmos comandos rodam com `npm run cli -- invite --admin`.

**Backup.** Todos os dados (banco e anexos) ficam no volume `app-data`. Para salvar:

```bash
docker compose stop app
docker run --rm -v "$(basename "$PWD")_app-data":/data -v "$PWD":/backup alpine tar czf /backup/resenha-$(date +%F).tgz -C /data .
docker compose start app
```

## Segurança (já implementado)

- **Senhas.** Guardadas com scrypt. O login leva o mesmo tempo exista ou não o usuário, para não revelar quem tem conta. Há limite de tentativas.
- **Sessões.** Cookie `HttpOnly` + `SameSite=Lax`. O banco guarda só o hash do token. Trocar a senha ou desativar uma conta derruba as outras sessões na hora, inclusive a voz.
- **CSRF e WebSocket.** Mutações e conexões WebSocket vindas de outros sites são recusadas, com checagem de `Origin`.
- **Anexos.** O tipo é detectado pelos bytes do arquivo, e não pela extensão. Só imagens e vídeos reais aparecem na conversa; o resto vira download com `nosniff` e `CSP sandbox`, então um HTML disfarçado de foto não executa.
- **Mensagens.** A formatação gera elementos React, nunca HTML cru, então não há injeção de script.
- **Política de segurança (CSP).** Restrita, liberando só o player do YouTube.

## Limitações conhecidas

- A fila do Assistir juntos fica em memória: reiniciar o servidor esvazia as filas.
- As legendas só funcionam no Chrome e no Edge, e o áudio é processado pelo Google ou pela Microsoft. Por isso a transcrição é opcional e desliga com o microfone mudo.
- Vídeos cujo dono proibiu a incorporação são recusados ao adicionar (exigência do YouTube).
- O push-to-talk só funciona com a janela em foco. Um atalho global exige o app desktop (fase 2).
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
4. **Notificações push** (Web Push/VAPID) para menções e "fulano entrou na voz".
5. **Supressão de ruído com IA** (RNNoise em WASM, sem custo).
6. **Twitch e Kick no cinema;** persistir a fila no banco.

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
