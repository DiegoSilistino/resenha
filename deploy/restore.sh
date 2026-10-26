#!/usr/bin/env bash
# Restaura um backup do Resenha. Rode na VPS, de dentro da pasta do projeto, como root.
#
#   bash deploy/restore.sh /root/resenha-backup-2026-10-24.tar   backup completo baixado pelo app
#   bash deploy/restore.sh resenha-2026-10-20.db                  cópia do banco guardada no servidor
#   bash deploy/restore.sh                                        lista as cópias guardadas no servidor
#
# Antes de substituir, guarda os dados atuais em backups/antes-da-restauracao-*.tar (dá para desfazer).
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1;33m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31mErro:\033[0m %s\n' "$*" >&2; exit 1; }

[[ ${EUID:-$(id -u)} -eq 0 ]] || die "rode como root"
[[ -f docker-compose.yml ]] || die "rode este script de dentro da pasta do projeto"

# Contêiner descartável com o volume de dados em /data (como root, para acertar o dono dos arquivos).
in_data() { docker compose run --rm --no-deps --user root "${@:1:$#-1}" --entrypoint sh app -c "${@: -1}"; }

SRC="${1:-}"
if [[ -z "$SRC" ]]; then
  say "Cópias do banco guardadas no servidor"
  in_data 'ls -1 /data/backups 2>/dev/null | grep -E "^resenha-.+\.db$" || echo "(nenhuma ainda)"'
  printf '\nUso: bash deploy/restore.sh ARQUIVO.tar  |  bash deploy/restore.sh resenha-AAAA-MM-DD.db\n'
  exit 0
fi

case "$SRC" in
  *.tar)
    [[ -f "$SRC" ]] || die "arquivo não encontrado: $SRC"
    ABS="$(realpath "$SRC")"
    tar -tf "$ABS" | grep -qx "resenha.db" || die "$SRC não parece um backup do Resenha (falta resenha.db)"
    WHAT="o backup completo $(basename "$SRC")"
    ;;
  *.db)
    NAME="$(basename "$SRC")"
    # cópia diária (resenha-AAAA-MM-DD.db) ou a feita antes de uma atualização (resenha-antes-da-vN-....db)
    [[ "$NAME" =~ ^resenha-([0-9]{4}-[0-9]{2}-[0-9]{2}|antes-da-v[0-9]+-[0-9]{8}-[0-9]{6})\.db$ ]] ||
      die "nome inesperado: $NAME (use um da lista: bash deploy/restore.sh)"
    WHAT="a cópia do banco $NAME (os anexos atuais ficam como estão)"
    ;;
  *) die "use um arquivo .tar (backup completo) ou resenha-AAAA-MM-DD.db (cópia diária)" ;;
esac

printf '\nIsso SUBSTITUI os dados atuais do Resenha por %s.\n' "$WHAT"
read -rp "Digite RESTAURAR para continuar: " ANSWER || die "cancelado"
[[ "$ANSWER" == "RESTAURAR" ]] || die "cancelado"

say "Parando o app"
docker compose stop app

# Guarda o estado atual antes de mexer. Se esta cópia falhar (ex.: disco cheio), nada é apagado.
SAVE_CURRENT='
  set -e
  cd /data
  mkdir -p backups
  items=""
  for f in resenha.db resenha.db-wal resenha.db-shm uploads avatars sounds; do [ -e "$f" ] && items="$items $f"; done
  if [ -n "$items" ]; then
    tar -cf "backups/antes-da-restauracao-$(date -u +%Y%m%dT%H%M%SZ).tar" $items
  fi'

if [[ "$SRC" == *.tar ]]; then
  say "Restaurando $(basename "$SRC")"
  in_data -v "$ABS:/restore.tar:ro" "$SAVE_CURRENT
    rm -rf resenha.db resenha.db-wal resenha.db-shm uploads avatars sounds
    tar -xf /restore.tar -C /data
    test -f resenha.db
    chown -R node:node /data"
else
  say "Restaurando $NAME"
  in_data "$SAVE_CURRENT
    test -f backups/$NAME
    rm -f resenha.db resenha.db-wal resenha.db-shm
    cp backups/$NAME resenha.db
    chown -R node:node /data"
fi

say "Subindo o app de novo"
docker compose start app
printf '\n\033[1;32mPronto!\033[0m Os dados anteriores ficaram em backups/antes-da-restauracao-*.tar, caso precise desfazer.\n'
