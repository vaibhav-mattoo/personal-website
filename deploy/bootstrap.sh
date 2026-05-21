#!/usr/bin/env bash
# Provision an Azure (or any Linux) VM: Docker, firewall, clone repo, build & run the site.
#
# Prefer the entry point: sudo deploy/deploy.sh setup <domain>
# (See deploy/README.md)
#
# Environment overrides:
#   SITE_DOMAIN   — required if not passed as first argument
#   DEPLOY_DIR    — default /opt/personal-website
#   REPO_URL      — default https://github.com/vaibhav-mattoo/personal-website.git
#   REPO_REF      — default main
#   COMPOSE_PROJECT — default personal-website

set -euo pipefail

STATE_DIR="/var/lib/personal-website"
STATE_FILE="${STATE_DIR}/deploy.env"
COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.prod.yml)

SITE_DOMAIN="${SITE_DOMAIN:-${1:-}}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/personal-website}"
REPO_URL="${REPO_URL:-https://github.com/vaibhav-mattoo/personal-website.git}"
REPO_REF="${REPO_REF:-main}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-personal-website}"

log() { printf '==> %s\n' "$*"; }
warn() { printf '!!> %s\n' "$*" >&2; }
die() { warn "$*"; exit 1; }

require_root() {
	if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
		die "Run as root: sudo $0 ${SITE_DOMAIN:-<domain>}"
	fi
}

public_ip() {
	local ip=""
	if command -v curl >/dev/null 2>&1; then
		ip="$(curl -fsS -H Metadata:true --max-time 2 \
			"http://169.254.169.254/metadata/instance/network/interface/0/ipv4/ipAddress/0/publicIpAddress?api-version=2021-02-01&format=text" 2>/dev/null || true)"
		if [[ -z "${ip}" ]]; then
			ip="$(curl -fsS --max-time 5 https://ifconfig.me/ip 2>/dev/null || true)"
		fi
	fi
	printf '%s' "${ip}"
}

dns_points_here() {
	local domain="$1" ip="$2" resolved=""
	if ! command -v getent >/dev/null 2>&1; then
		return 1
	fi
	resolved="$(getent ahostsv4 "${domain}" 2>/dev/null | awk '{print $1; exit}')"
	[[ -n "${resolved}" && "${resolved}" == "${ip}" ]]
}

install_packages() {
	if command -v apt-get >/dev/null 2>&1; then
		export DEBIAN_FRONTEND=noninteractive
		apt-get update -qq
		apt-get install -y -qq ca-certificates curl git ufw
	elif command -v dnf >/dev/null 2>&1; then
		dnf install -y ca-certificates curl git firewalld
	else
		die "Unsupported OS: install git, curl, and a firewall tool manually, then re-run."
	fi
}

install_docker() {
	if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
		log "Docker already installed"
		return
	fi
	log "Installing Docker Engine and Compose plugin"
	curl -fsSL https://get.docker.com | sh
	systemctl enable --now docker
}

configure_firewall() {
	local added=0
	if command -v ufw >/dev/null 2>&1 && ufw status 2>/dev/null | grep -q "Status: active"; then
		ufw allow 80/tcp comment 'personal-website http' >/dev/null 2>&1 || true
		ufw allow 443/tcp comment 'personal-website https' >/dev/null 2>&1 || true
		added=1
		log "UFW: allowed TCP 80 and 443"
	fi
	printf '%s' "${added}"
}

ensure_repo() {
	if [[ -d "${DEPLOY_DIR}/.git" ]]; then
		log "Updating ${DEPLOY_DIR}"
		cd "${DEPLOY_DIR}"
		git fetch origin "${REPO_REF}"
		git checkout "${REPO_REF}"
		git pull --ff-only origin "${REPO_REF}" || true
		return
	fi

	log "Cloning ${REPO_URL} → ${DEPLOY_DIR}"
	mkdir -p "$(dirname "${DEPLOY_DIR}")"
	git clone --branch "${REPO_REF}" --depth 1 "${REPO_URL}" "${DEPLOY_DIR}"
	cd "${DEPLOY_DIR}"
}

write_state() {
	local ip="$1" ufw_added="$2"
	mkdir -p "${STATE_DIR}"
	cat >"${STATE_FILE}" <<EOF
# Written by deploy/bootstrap.sh — used by deploy/teardown.sh
DEPLOY_DIR=${DEPLOY_DIR}
SITE_DOMAIN=${SITE_DOMAIN}
COMPOSE_PROJECT=${COMPOSE_PROJECT}
PUBLIC_IP=${ip}
UFW_RULES_ADDED=${ufw_added}
EOF
	chmod 600 "${STATE_FILE}"
}

deploy_stack() {
	cd "${DEPLOY_DIR}"
	export SITE_DOMAIN
	log "Building and starting stack (project: ${COMPOSE_PROJECT})"
	docker compose -p "${COMPOSE_PROJECT}" "${COMPOSE_FILES[@]}" up -d --build --remove-orphans
}

main() {
	require_root

	[[ -n "${SITE_DOMAIN}" ]] || die "Usage: sudo $0 <domain>   e.g. sudo $0 vmattoo.dev"

	install_packages
	install_docker
	ensure_repo

	local ip ufw_added=0
	ip="$(public_ip)"
	ufw_added="$(configure_firewall)"

	log "Site domain: ${SITE_DOMAIN}"
	[[ -n "${ip}" ]] && log "VM public IP: ${ip}"

	if [[ -n "${ip}" ]] && dns_points_here "${SITE_DOMAIN}" "${ip}"; then
		log "DNS OK: ${SITE_DOMAIN} → ${ip}"
	else
		warn "DNS for ${SITE_DOMAIN} does not point to this VM yet."
		[[ -n "${ip}" ]] && warn "Create an A record: ${SITE_DOMAIN} → ${ip}"
		warn "HTTPS (Let's Encrypt) will fail until DNS propagates; re-run this script after DNS is correct."
		warn "Azure NSG: allow inbound TCP 80 and 443 to this VM."
	fi

	write_state "${ip}" "${ufw_added}"
	deploy_stack

	log "Deploy complete."
	log "Visit: https://${SITE_DOMAIN}/"
	log "Logs:  cd ${DEPLOY_DIR} && docker compose -p ${COMPOSE_PROJECT} ${COMPOSE_FILES[*]} logs -f caddy"
	log "Update:  sudo ${DEPLOY_DIR}/deploy/deploy.sh update"
	log "Remove: sudo ${DEPLOY_DIR}/deploy/deploy.sh teardown"
	chmod +x "${DEPLOY_DIR}/deploy/"*.sh 2>/dev/null || true
}

main "$@"
