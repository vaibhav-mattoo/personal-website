#!/usr/bin/env bash
# One-time VM setup so GitHub Actions can run: sudo /opt/personal-website/deploy/update.sh
#
# Usage:
#   ./deploy/configure-github-deploy.sh vaibhav
#   ./deploy/configure-github-deploy.sh vaibhav ~/.ssh/personal-website-deploy.pub

set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/personal-website}"
UPDATE_SCRIPT="${DEPLOY_DIR}/deploy/update.sh"
SUDOERS_FILE="/etc/sudoers.d/personal-website-deploy"

SSH_USER="${1:-vaibhav}"
PUBKEY_FILE="${2:-}"

log() { printf '==> %s\n' "$*"; }
die() { printf '!!> %s\n' "$*" >&2; exit 1; }

[[ -n "${SSH_USER}" ]] || die "Usage: $0 <ssh-user> [path-to-public-key.pub]"

if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
	log "Configuring sudoers (requires root)"
	sudo bash "$0" "$@"
	exit $?
fi

[[ -f "${UPDATE_SCRIPT}" ]] || die "Missing ${UPDATE_SCRIPT} — run: sudo deploy/deploy.sh setup <domain>"

log "Allowing ${SSH_USER} to run update.sh without a password"
printf '%s ALL=(root) NOPASSWD: %s\n' "${SSH_USER}" "${UPDATE_SCRIPT}" >"${SUDOERS_FILE}"
chmod 440 "${SUDOERS_FILE}"
visudo -cf "${SUDOERS_FILE}"

home="$(getent passwd "${SSH_USER}" | cut -d: -f6)"
[[ -n "${home}" && -d "${home}" ]] || die "No home directory for user ${SSH_USER}"

if [[ -n "${PUBKEY_FILE}" ]]; then
	[[ -f "${PUBKEY_FILE}" ]] || die "Public key not found: ${PUBKEY_FILE}"
	log "Installing deploy key for ${SSH_USER}"
	install -d -m 700 -o "${SSH_USER}" -g "${SSH_USER}" "${home}/.ssh"
	touch "${home}/.ssh/authorized_keys"
	chown "${SSH_USER}:${SSH_USER}" "${home}/.ssh/authorized_keys"
	chmod 600 "${home}/.ssh/authorized_keys"
	if ! grep -qF "$(cat "${PUBKEY_FILE}")" "${home}/.ssh/authorized_keys" 2>/dev/null; then
		cat "${PUBKEY_FILE}" >>"${home}/.ssh/authorized_keys"
	fi
else
	warn_msg="No public key file passed."
	printf '!!> %s\n' "${warn_msg}" >&2
	printf '    Add your GitHub Actions deploy key to %s/.ssh/authorized_keys\n' "${home}" >&2
	printf '    Example: cat personal-website-deploy.pub | ssh %s@%s "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys"\n' "${SSH_USER}" "$(hostname -f 2>/dev/null || hostname)" >&2
fi

log "GitHub deploy prep done."
log "Add GitHub secrets: DEPLOY_HOST, DEPLOY_USER=${SSH_USER}, DEPLOY_SSH_KEY"
log "Test: ssh -i <private-key> ${SSH_USER}@<host> 'sudo ${UPDATE_SCRIPT}'"
