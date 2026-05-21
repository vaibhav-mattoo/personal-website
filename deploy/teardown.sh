#!/usr/bin/env bash
# Remove the site stack and all deployment artifacts from this VM.
#
# Usage:
#   sudo /opt/personal-website/deploy/teardown.sh
#
# Or from anywhere if state exists:
#   sudo bash /path/to/personal-website/deploy/teardown.sh

set -euo pipefail

STATE_FILE="/var/lib/personal-website/deploy.env"
COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.prod.yml)

log() { printf '==> %s\n' "$*"; }
warn() { printf '!!> %s\n' "$*" >&2; }

load_state() {
	if [[ -f "${STATE_FILE}" ]]; then
		# shellcheck disable=SC1090
		source "${STATE_FILE}"
	fi
	DEPLOY_DIR="${DEPLOY_DIR:-/opt/personal-website}"
	SITE_DOMAIN="${SITE_DOMAIN:-}"
	COMPOSE_PROJECT="${COMPOSE_PROJECT:-personal-website}"
	UFW_RULES_ADDED="${UFW_RULES_ADDED:-0}"
}

stop_stack() {
	if [[ ! -d "${DEPLOY_DIR}" ]]; then
		warn "Deploy directory missing (${DEPLOY_DIR}); skipping compose down"
		return
	fi
	cd "${DEPLOY_DIR}"
	if [[ ! -f docker-compose.yml ]]; then
		warn "No compose file in ${DEPLOY_DIR}"
		return
	fi
	log "Stopping containers and removing images/volumes for project ${COMPOSE_PROJECT}"
	docker compose -p "${COMPOSE_PROJECT}" "${COMPOSE_FILES[@]}" down -v --rmi all --remove-orphans 2>/dev/null || \
		docker compose -p "${COMPOSE_PROJECT}" -f docker-compose.yml -f docker-compose.prod.yml down -v --rmi all --remove-orphans || true
}

remove_firewall_rules() {
	if [[ "${UFW_RULES_ADDED}" != "1" ]] || ! command -v ufw >/dev/null 2>&1; then
		return
	fi
	log "Removing UFW rules for ports 80 and 443 (if present)"
	ufw delete allow 80/tcp 2>/dev/null || true
	ufw delete allow 443/tcp 2>/dev/null || true
}

remove_deploy_dir() {
	if [[ -d "${DEPLOY_DIR}" ]]; then
		log "Removing ${DEPLOY_DIR}"
		rm -rf "${DEPLOY_DIR}"
	fi
}

remove_state() {
	if [[ -d /var/lib/personal-website ]]; then
		log "Removing /var/lib/personal-website"
		rm -rf /var/lib/personal-website
	fi
}

prune_dangling() {
	log "Pruning unused Docker resources from this project"
	docker image prune -f >/dev/null 2>&1 || true
	docker volume prune -f >/dev/null 2>&1 || true
}

main() {
	if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
		warn "Run as root: sudo $0"
		exit 1
	fi

	load_state
	[[ -n "${SITE_DOMAIN}" ]] && log "Tearing down site: ${SITE_DOMAIN}"

	stop_stack
	remove_firewall_rules
	remove_deploy_dir
	remove_state
	prune_dangling

	log "Teardown complete. No site containers, volumes, or deploy tree remain."
	log "Docker Engine is still installed (other apps may use it)."
	[[ -n "${SITE_DOMAIN}" ]] && log "Remove the DNS A record for ${SITE_DOMAIN} in your DNS provider to fully detach the domain."
}

main "$@"
