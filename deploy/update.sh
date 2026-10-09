#!/usr/bin/env bash
# Pull latest main and reconcile the production stack.
# Run on the VM: sudo /opt/personal-website/deploy/update.sh [--local-build]
#
# The site itself is built in CI: the GitHub Actions deploy job uploads it
# to ${SITE_WEB_DIR}/releases/<id>/ and swaps the `current` symlink *before*
# calling this script, so Caddy (which bind-mounts SITE_WEB_DIR) is serving
# the new release already. This script only updates the repo checkout and
# the Caddy/Waline containers, which is cheap when nothing changed.
#
# --local-build: build the site here on the VM instead (notes synced from
# the notes repo) and install it as a release — for a manual update without
# CI. Slow on this VM (a few minutes).

set -euo pipefail

STATE_FILE="/var/lib/personal-website/deploy.env"
COMPOSE_FILES=(-f docker-compose.yml -f docker-compose.prod.yml)

if [[ -f "${STATE_FILE}" ]]; then
	# shellcheck disable=SC1090
	source "${STATE_FILE}"
fi

LOCAL_BUILD=false
for arg in "$@"; do
	case "${arg}" in
	--local-build) LOCAL_BUILD=true ;;
	*)
		printf 'Unknown option: %s\n' "${arg}" >&2
		exit 1
		;;
	esac
done

DEPLOY_DIR="${DEPLOY_DIR:-/opt/personal-website}"
SITE_DOMAIN="${SITE_DOMAIN:-vmattoo.dev}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-personal-website}"
REPO_REF="${REPO_REF:-main}"
# Must match the default in docker-compose.prod.yml and the deploy job's
# upload path (~/personal-website-web of the deploy user).
SITE_WEB_DIR="${SITE_WEB_DIR:-/home/vaibhav/personal-website-web}"

log() { printf '==> %s\n' "$*"; }

ensure_shared_network() {
	if docker network inspect vmattoo-shared >/dev/null 2>&1; then
		return
	fi
	log "Creating shared Docker network: vmattoo-shared"
	docker network create vmattoo-shared
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

export SITE_DOMAIN SITE_WEB_DIR

if [[ "${LOCAL_BUILD}" == true ]]; then
	log "Syncing notes/topics content"
	./deploy/sync-notes.sh

	release="local-$(date -u +%Y%m%dT%H%M%SZ)"
	log "Building the site on this VM (release ${release})"
	docker build -f site/Dockerfile --target builder \
		--build-arg "PUBLIC_SITE_NAME=${SITE_DOMAIN}" \
		--build-arg "PUBLIC_WALINE_SERVER_URL=${PUBLIC_WALINE_SERVER_URL:-https://comments.${SITE_DOMAIN}}" \
		-t personal-website-site-builder .
	owner="$(stat -c '%U:%G' "$(dirname "${SITE_WEB_DIR}")")"
	# The deploy user must own these, since CI uploads and swaps `current`
	# here without sudo.
	install -d -o "${owner%%:*}" -g "${owner##*:}" "${SITE_WEB_DIR}" "${SITE_WEB_DIR}/releases"
	container="$(docker create personal-website-site-builder)"
	docker cp "${container}:/app/site/dist" "${SITE_WEB_DIR}/releases/${release}"
	docker rm "${container}" >/dev/null
	chown -R "${owner}" "${SITE_WEB_DIR}/releases/${release}"
	ln -sfn "releases/${release}" "${SITE_WEB_DIR}/current.tmp"
	mv -Tf "${SITE_WEB_DIR}/current.tmp" "${SITE_WEB_DIR}/current"
	chown -h "${owner}" "${SITE_WEB_DIR}/current"
fi

# Never (re)start Caddy without a site to serve.
if [[ ! -f "${SITE_WEB_DIR}/current/index.html" ]]; then
	printf 'No site release at %s/current — deploy via GitHub Actions, or run with --local-build\n' "${SITE_WEB_DIR}" >&2
	exit 1
fi

ensure_shared_network
log "Updating containers (domain: ${SITE_DOMAIN}, site: $(readlink "${SITE_WEB_DIR}/current"))"
docker compose -p "${COMPOSE_PROJECT}" "${COMPOSE_FILES[@]}" up -d --build --remove-orphans

log "Running containers:"
docker compose -p "${COMPOSE_PROJECT}" "${COMPOSE_FILES[@]}" ps

log "Update complete — https://${SITE_DOMAIN}/"
