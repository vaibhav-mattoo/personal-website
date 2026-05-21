#!/usr/bin/env bash
# Single entry point for VM deploy, update, teardown, and GitHub Actions prep.
#
# Fresh VM (one command — downloads this script and clones the repo):
#   curl -fsSL https://raw.githubusercontent.com/vaibhav-mattoo/personal-website/main/deploy/deploy.sh | sudo bash -s setup vmattoo.dev
#
# From a git clone:
#   sudo ./deploy/deploy.sh setup vmattoo.dev
#   sudo ./deploy/deploy.sh update
#   sudo ./deploy/deploy.sh teardown
#   ./deploy/deploy.sh setup-ci azureuser   # optional: enable GitHub Actions SSH deploy
#
# Environment: SITE_DOMAIN, DEPLOY_DIR, REPO_URL, REPO_REF (see deploy/README.md)

set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/personal-website}"
REPO_URL="${REPO_URL:-https://github.com/vaibhav-mattoo/personal-website.git}"
REPO_REF="${REPO_REF:-main}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

usage() {
	cat <<'EOF'
Usage: deploy.sh <command> [options]

Commands:
  setup <domain>     One-time (or re-)provision: Docker, clone/pull repo, build & run site
  update             Pull latest main and rebuild containers (same as CI deploy step)
  teardown           Stop site, remove containers/volumes and /opt/personal-website
  setup-ci [user]    One-time: passwordless sudo for update.sh + install deploy SSH public key

Examples:
  sudo deploy.sh setup vmattoo.dev
  sudo deploy.sh update
  sudo deploy.sh teardown
  deploy.sh setup-ci azureuser ~/.ssh/github_actions_deploy.pub

Environment:
  DEPLOY_DIR   Install path (default: /opt/personal-website)
  REPO_URL     Git remote (default: GitHub repo above)
  REPO_REF     Branch (default: main)
EOF
}

ensure_installed_copy() {
	# Re-exec from DEPLOY_DIR so curl | bash and partial copies always use the full script set.
	local installed="${DEPLOY_DIR}/deploy/deploy.sh"
	local current=""
	current="$(realpath "${BASH_SOURCE[0]}" 2>/dev/null || true)"

	if [[ -n "${current}" && "${current}" == "$(realpath "${installed}" 2>/dev/null || true)" ]]; then
		return
	fi

	if [[ -x "${installed}" ]]; then
		exec "${installed}" "$@"
	fi

	printf '==> Cloning %s (%s) → %s\n' "${REPO_URL}" "${REPO_REF}" "${DEPLOY_DIR}"
	mkdir -p "$(dirname "${DEPLOY_DIR}")"
	git clone --branch "${REPO_REF}" --depth 1 "${REPO_URL}" "${DEPLOY_DIR}"
	exec "${installed}" "$@"
}

require_root() {
	if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
		printf 'Run with sudo: sudo %s %s\n' "$0" "$*" >&2
		exit 1
	fi
}

cmd_setup() {
	local domain="${1:-${SITE_DOMAIN:-}}"
	[[ -n "${domain}" ]] || {
		printf 'Usage: sudo deploy.sh setup <domain>\n' >&2
		exit 1
	}
	exec "${SCRIPT_DIR}/bootstrap.sh" "${domain}"
}

cmd_update() {
	require_root
	exec "${SCRIPT_DIR}/update.sh"
}

cmd_teardown() {
	require_root
	exec "${SCRIPT_DIR}/teardown.sh"
}

cmd_setup_ci() {
	local ssh_user="${1:-${SUDO_USER:-${USER}}}"
	local pubkey_file="${2:-}"
	exec "${SCRIPT_DIR}/configure-github-deploy.sh" "${ssh_user}" ${pubkey_file:+"${pubkey_file}"}
}

main() {
	local cmd="${1:-}"
	shift || true

	case "${cmd}" in
		setup) ensure_installed_copy setup "$@" ; cmd_setup "$@" ;;
		update) ensure_installed_copy update ; cmd_update ;;
		teardown) ensure_installed_copy teardown ; cmd_teardown ;;
		setup-ci) ensure_installed_copy setup-ci "$@" ; cmd_setup_ci "$@" ;;
		-h | --help | help | "") usage ;;
		*)
			printf 'Unknown command: %s\n\n' "${cmd}" >&2
			usage >&2
			exit 1
			;;
	esac
}

main "$@"
