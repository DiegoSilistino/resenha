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

## Rodar no seu computador

Pré-requisitos: **Node 24 LTS** (ou 22.16+) e **Docker Desktop** (para o servidor de voz).

```bash
npm install
docker compose -f docker-compose.dev.yml up -d   # LiveKit em modo desenvolvimento
npm run dev                                      # API (porta 3000) + site (porta 5173)
```

O terminal mostra um link `http://localhost:5173/convite/...`. Abra-o para criar a conta de **administrador**. Para testar a voz, crie um convite em **⚙ Administrar → Convites** e abra-o numa janela anônima, que funciona como uma segunda pessoa.

## Colocar no ar (VPS)

1. **Servidor.** Uma VPS Linux com 2 vCPU e 2 GB de RAM basta para 10 pessoas. Escolha um data center **em São Paulo**: a latência da voz depende disso. Confira também a franquia de tráfego: uma tela compartilhada para 9 pessoas consome ~20 Mbps de saída enquanto dura.
2. **Domínio.** Crie um registro DNS do tipo `A` apontando para o IP da VPS. Um subdomínio grátis do DuckDNS também serve.
3. **Firewall.** Libere `80/tcp`, `443/tcp`, `443/udp`, `7881/tcp` e `7882/udp`.
4. **Subir o serviço:**
   ```bash
   git clone <seu-repositorio> resenha && cd resenha
   cp .env.example .env
   openssl rand -base64 48        # cole o resultado em LIVEKIT_API_SECRET no .env
   nano .env                      # preencha DOMAIN e PUBLIC_URL
   docker compose up -d --build
   docker compose logs app | grep convite
   ```
5. Abra o link de convite que apareceu no log e crie a conta de administrador. Depois, convide a turma em **⚙ Administrar → Convites**.

**Atualizar:** `git pull && docker compose up -d --build`

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
```

```bash
npm test          # 80 testes (protocolo, sincronia, autenticação, permissões, CSRF, anexos, tempo real)
npm run typecheck
npm run build
```

Para renomear o app, troque `APP_NAME` em `shared/src/constants.ts` e o título em `web/index.html`.
