# Colocar o Resenha no ar

O servidor fica ligado 24 h numa VPS (um computador alugado na nuvem). Seus amigos só abrem o link no Chrome ou no Edge, sem instalar nada.

Tempo total: cerca de 30 minutos. Você faz tudo pelo navegador e pelo PowerShell do Windows.

## Onde hospedar

| Opção | Custo (out/2026) | Para quem |
|---|---|---|
| **Hostinger VPS KVM 1, São Paulo** (recomendado) | R$ 29,99/mês na promoção, pago de uma vez pelo período contratado; renova a R$ 59,99/mês | 1 vCPU, 4 GB de RAM, 4 TB de tráfego. Sobra para 10 pessoas, inclusive com tela compartilhada. |
| Hostinger KVM 2, São Paulo | R$ 42,99/mês na promoção; renova a R$ 77,99/mês | Se quiser folga para crescer. |
| Oracle Cloud "Always Free", São Paulo | R$ 0 | ARM com 2 núcleos e 12 GB (limite reduzido em jun/2026). Exige cartão, costuma faltar capacidade para criar a máquina e tem firewall em dois lugares. Só vale se você quiser gastar zero e topar mais configuração. |

**Escolha São Paulo**, seja qual for o provedor. A latência da voz depende da distância até o servidor.

Os preços mudam, então confira na hora da compra. O preço promocional costuma exigir pagar o período inteiro adiantado.

## Passo a passo (Hostinger + DuckDNS)

### 1. Contrate a VPS

1. Na Hostinger, escolha **VPS → KVM 1**.
2. Na configuração:
   - **Localização:** Brasil (São Paulo).
   - **Sistema:** Ubuntu 24.04, o modelo puro ou o "com Docker"; os dois servem.
   - **Senha de root:** uma senha forte. Guarde-a.
3. Quando a máquina estiver pronta, **anote o IP** que aparece no painel (algo como `191.x.x.x`).

Se você ativar o **firewall do painel da Hostinger**, libere estas portas:
- `22/tcp` (SSH);
- `80/tcp` e `443/tcp` (site);
- `443/udp` (HTTP/3);
- `7881/tcp` e `7882/udp` (voz).

### 2. Crie o endereço grátis no DuckDNS

1. Entre em [duckdns.org](https://www.duckdns.org) com sua conta Google ou GitHub.
2. Crie um subdomínio, por exemplo `minharesenha`. O endereço fica `minharesenha.duckdns.org`.
3. Em **current ip**, cole o IP da VPS e clique em **update ip**.

Prefere um domínio próprio (ex.: `.com.br` no registro.br)? Crie um registro **A** apontando para o IP da VPS e use esse domínio no passo 5.

### 3. Conecte na VPS pelo Windows

No PowerShell normal, sem "Executar como administrador":

```powershell
ssh root@SEU_IP
```

Na primeira vez, ele pergunta se confia no servidor: digite `yes`. Depois, digite a senha de root. A senha não aparece enquanto você digita; isso é normal.

Daqui em diante, os comandos são digitados **dentro da VPS**.

### 4. Dê à VPS acesso de leitura ao repositório

O repositório é privado, então a VPS precisa de uma chave própria, que só pode **ler** o código.

```bash
ssh-keygen -t ed25519 -N "" -f ~/.ssh/resenha_deploy -C "vps-resenha"
cat ~/.ssh/resenha_deploy.pub
```

1. Copie a linha que começa com `ssh-ed25519`.
2. No GitHub, abra o repositório e vá em **Settings → Deploy keys → Add deploy key**.
3. Título: `VPS`. Cole a chave e **deixe desmarcado** "Allow write access". Salve.

Em seguida, baixe o projeto:

```bash
apt-get update && apt-get install -y git
GIT_SSH_COMMAND="ssh -i ~/.ssh/resenha_deploy -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new" \
  git clone git@github.com:DiegoSilistino/resenha.git /opt/resenha
cd /opt/resenha
git config core.sshCommand "ssh -i ~/.ssh/resenha_deploy -o IdentitiesOnly=yes"
```

### 5. Rode o instalador

```bash
bash deploy/setup-vps.sh minharesenha.duckdns.org
```

O script faz tudo sozinho:
- instala o Docker;
- cria o arquivo de configuração com um segredo aleatório;
- avisa se o DuckDNS ainda não aponta para esta VPS;
- sobe o app, o servidor de voz e o HTTPS automático.

No fim, mostra o **link de convite do administrador**. Na primeira vez leva uns 5 minutos.

### 6. Entre e convide a turma

1. Abra o link de convite e crie sua conta de administrador.
2. Em **⚙ Administrar → Convites**, gere um link para cada amigo. Cada um vale para 1 pessoa por padrão e expira em 3 dias.

O primeiro acesso pode demorar até 1 minuto enquanto o certificado HTTPS é emitido.

## Atualizar depois de mudanças no código

```bash
ssh root@SEU_IP
cd /opt/resenha && git pull && bash deploy/setup-vps.sh
```

Contas, mensagens e arquivos ficam guardados: a atualização só troca o programa.

## Quando algo dá errado

| Sintoma | Verifique |
|---|---|
| O site não abre ou o navegador avisa "não seguro" | O IP no DuckDNS é o da VPS? As portas 80 e 443 estão liberadas? Veja o log com `docker compose logs caddy`. |
| A voz não conecta | Entre no app e abra `https://SEU_DOMINIO/api/voice/health`. Confira as portas `7881/tcp` e `7882/udp` e veja o log com `docker compose logs livekit`. |
| Alguém esqueceu a senha | `docker compose exec app node dist/cli.js reset-password USUARIO` |
| Gerar um convite pelo terminal | `docker compose exec app node dist/cli.js invite` |
| Ver se tudo está rodando | `docker compose ps` |

Para backup, veja a seção **Manutenção** do [README](README.md).
