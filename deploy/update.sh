#!/usr/bin/env bash
# Pull latest main and rebuild the production stack (used by GitHub Actions deploy).
# Run on the VM: sudo /opt/personal-website/deploy/update.sh

set -euo pipefail

STATE_FILE="/var/lib/personal-website/deploy.env"
COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.prod.yml)

if [[ -f "${STATE_FILE}" ]]; then
	# shellcheck disable=SC1090
	source "${STATE_FILE}"
fi

DEPLOY_DIR="${DEPLOY_DIR:-/opt/personal-website}"
SITE_DOMAIN="${SITE_DOMAIN:-vmattoo.dev}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-personal-website}"
REPO_REF="${REPO_REF:-main}"

log() { printf '==> %s\n' "$*"; }

ensure_shared_network() {
	if docker network inspect vmattoo-shared >/dev/null 2>&1; then
		return
	fi
	log "Creating shared Docker network: vmattoo-shared"
	docker network create vmattoo-shared
}

ensure_stirling_credentials() {
	local env_file="${DEPLOY_DIR}/.env"

	if [[ ! -f "${env_file}" ]]; then
		log "ERROR: ${env_file} missing; run deploy/bootstrap.sh first" >&2
		return 1
	fi

	if ! grep -q '^STIRLING_ADMIN_USERNAME=' "${env_file}"; then
		echo 'STIRLING_ADMIN_USERNAME=admin' >>"${env_file}"
		log "Set STIRLING_ADMIN_USERNAME=admin in ${env_file}"
	fi

	if ! grep -q '^STIRLING_ADMIN_PASSWORD=' "${env_file}"; then
		local pw
		pw=$(openssl rand -base64 24 | tr -d '/+=' | head -c 32)
		echo "STIRLING_ADMIN_PASSWORD=${pw}" >>"${env_file}"
		chmod 0600 "${env_file}"
		log ""
		log "============================================================"
		log "Stirling-PDF initial admin credentials generated:"
		log "  URL:      https://pdfs.${SITE_DOMAIN}/"
		log "  Username: admin"
		log "  Password: ${pw}"
		log ""
		log "  SAVE THIS PASSWORD NOW — it will not be shown again."
		log "  It is also stored in ${env_file} (mode 0600)."
		log "  Log in once, then change it via the Stirling-PDF UI."
		log "============================================================"
		log ""
	fi
}

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
	printf 'Run as root: sudo %s\n' "$0" >&2
	exit 1
fi

[[ -d "${DEPLOY_DIR}" ]] || {
	printf 'Missing %s — run deploy/bootstrap.sh first\n' "${DEPLOY_DIR}" >&2
	exit 1
}

cd "${DEPLOY_DIR}"

log "Fetching origin/${REPO_REF}"
git fetch origin "${REPO_REF}"
git checkout "${REPO_REF}"
git reset --hard "origin/${REPO_REF}"

export SITE_DOMAIN
ensure_shared_network
ensure_stirling_credentials
log "Rebuilding and restarting (domain: ${SITE_DOMAIN})"
docker compose -p "${COMPOSE_PROJECT}" "${COMPOSE_FILES[@]}" up -d --build --remove-orphans

log "Running containers:"
docker compose -p "${COMPOSE_PROJECT}" "${COMPOSE_FILES[@]}" ps

log "Update complete — https://${SITE_DOMAIN}/"
