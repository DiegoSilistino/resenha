#!/usr/bin/env bash
# Prepara uma VPS Ubuntu/Debian e coloca o Resenha no ar (app + LiveKit + Caddy com HTTPS).
#
# Uso, dentro da pasta do projeto, como root:
#   bash deploy/setup-vps.sh minharesenha.duckdns.org
#
# Pode rodar de novo quantas vezes quiser (ex.: depois de um git pull): ele mantém o .env
# e o segredo existentes e só reconstrói o que mudou.
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;35mAtenção:\033[0m %s\n' "$*"; }
die() { printf '\n\033[1;31mErro:\033[0m %s\n' "$*" >&2; exit 1; }

[[ ${EUID:-$(id -u)} -eq 0 ]] || die "rode como root (ex.: sudo bash deploy/setup-vps.sh SEU_DOMINIO)"
[[ -f docker-compose.yml ]] || die "rode este script de dentro da pasta do projeto"

# ---------------------------------------------------------------- domínio
DOMAIN="${1:-}"
if [[ -z "$DOMAIN" && -f .env ]]; then
  DOMAIN="$(grep -E '^DOMAIN=' .env | head -n1 | cut -d= -f2- || true)"
fi
if [[ -z "$DOMAIN" ]]; then
  read -rp "Domínio do app (ex.: minharesenha.duckdns.org): " DOMAIN ||
    die "informe o domínio: bash deploy/setup-vps.sh SEU_DOMINIO"
fi
# minúsculas e sem espaços nas pontas (espaço no meio é rejeitado logo abaixo)
DOMAIN="$(printf '%s' "$DOMAIN" | tr '[:upper:]' '[:lower:]' | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')"
DOMAIN="${DOMAIN#https://}"
DOMAIN="${DOMAIN#http://}"
DOMAIN="${DOMAIN%%/*}"
[[ "$DOMAIN" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] ||
  die "domínio inválido: '$DOMAIN'"

# ---------------------------------------------------------------- Docker
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  say "Instalando o Docker (script oficial get.docker.com)"
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null 2>&1 || true

# ---------------------------------------------------------------- swap (VPS com pouca memória)
MEM_MB="$(awk '/MemTotal/ { print int($2 / 1024) }' /proc/meminfo)"
if [[ -z "$(swapon --show --noheadings 2>/dev/null)" && "$MEM_MB" -lt 3500 ]]; then
  say "Criando 2 GB de swap (o build do site precisa de memória)"
  fallocate -l 2G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=2048
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ---------------------------------------------------------------- firewall do sistema
# Só mexe no ufw se ele já estiver ativo (ativar do zero poderia trancar o SSH).
if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
  say "Liberando as portas no ufw"
  for rule in 22/tcp 80/tcp 443/tcp 443/udp 7881/tcp 7882/udp; do ufw allow "$rule" >/dev/null; done
fi

# ---------------------------------------------------------------- .env
if [[ -f .env ]]; then
  say "Mantendo o .env existente (o segredo do LiveKit não muda)"
  sed -i -E "s#^DOMAIN=.*#DOMAIN=${DOMAIN}#; s#^PUBLIC_URL=.*#PUBLIC_URL=https://${DOMAIN}#" .env
else
  say "Criando o .env com um segredo novo"
  umask 077
  cat > .env <<EOF
DOMAIN=${DOMAIN}
PUBLIC_URL=https://${DOMAIN}
LIVEKIT_API_KEY=resenha
LIVEKIT_API_SECRET=$(openssl rand -hex 32)
EOF
fi
chmod 600 .env

# ---------------------------------------------------------------- DNS (só avisa)
PUBLIC_IP="$(curl -fsS4 --max-time 5 https://api.ipify.org 2>/dev/null || true)"
DNS_IP="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR == 1 { print $1 }' || true)"
if [[ -n "$PUBLIC_IP" && "$DNS_IP" != "$PUBLIC_IP" ]]; then
  warn "$DOMAIN aponta para '${DNS_IP:-nenhum IP}', mas este servidor é $PUBLIC_IP."
  warn "Corrija o IP no DuckDNS (ou no seu DNS). O HTTPS só sai quando o domínio apontar para cá."
fi

# ---------------------------------------------------------------- subir
say "Construindo e subindo (a primeira vez leva uns 5 minutos)"
docker compose up -d --build

say "Esperando o app responder"
for _ in $(seq 1 60); do
  if docker compose exec -T app wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
docker compose ps

INVITE="$(docker compose logs app 2>/dev/null | grep -oE 'https://[^ ]+/convite/[A-Za-z0-9_-]+' | tail -n1 || true)"
printf '\n\033[1;32mPronto!\033[0m Abra https://%s\n' "$DOMAIN"
if [[ -n "$INVITE" ]]; then
  printf '\nCrie a conta de ADMINISTRADOR por este link (vale uma vez):\n\n  %s\n\n' "$INVITE"
else
  printf '\nPara gerar um convite pelo terminal:\n  docker compose exec app node dist/cli.js invite\n\n'
fi
printf 'O primeiro acesso pode levar até 1 minuto enquanto o certificado HTTPS é emitido.\n'
