#!/usr/bin/env bash
# Sube apps-script/ a Google con clasp y publica una versión nueva en la misma implementación
# de aplicación web (la URL no cambia, la tablet no hay que tocarla).
#
# Antes, una vez por sesión:  npx --yes @google/clasp@3.4.1 login --no-localhost
#   (Oscar abre el enlace, acepta y pega de vuelta la dirección http://localhost:8888/?…)
# Uso:  herramientas/subir-apps-script.sh
set -euo pipefail
raiz="$(cd "$(dirname "$0")/.." && pwd)"
clasp() { npx --yes @google/clasp@3.4.1 "$@"; }

echo "Pruebas…"
(cd "$raiz" && npm test --silent >/dev/null) || { echo "Las pruebas fallan: no se sube nada."; exit 1; }

cd "$raiz/apps-script"
clasp push --force

# La implementación publicada es la única que no es @HEAD (la @HEAD es la de pruebas del editor).
ids="$(clasp list-deployments | awk '/^- / && $3 != "@HEAD" {print $2}')"
cuantas="$(printf '%s\n' "$ids" | grep -c . || true)"
if [ "$cuantas" != 1 ]; then
  echo "Esperaba una sola implementación publicada y hay $cuantas:"; clasp list-deployments; exit 1
fi
clasp update-deployment "$ids" --description "$(git -C "$raiz" rev-parse --short HEAD)"
