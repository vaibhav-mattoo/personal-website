#!/usr/bin/env bash
# Pulls the private notes/topics content repo and syncs it into
# site/src/content/{notes,topics}. Content collections there (see
# site/src/content.config.ts) don't care which repo tracks the files on
# disk, only that they exist at build time — this is the one place that
# populates them.
#
# Local dev: if NOTES_LOCAL_PATH points at an existing checkout (e.g. a
# sibling clone of the notes repo), files are copied straight from there —
# no network, always reflects whatever's on disk, uncommitted changes
# included.
# CI / VM deploy: falls back to cloning/fetching NOTES_REPO_URL at
# NOTES_REF into NOTES_CACHE_DIR, then syncing from that clone. Requires an
# SSH key with read access to the private notes repo to already be usable
# by the running user (ssh-agent, or an SSH config Host entry) — see
# docs/notes-repo.md.

set -euo pipefail

NOTES_REPO_URL="${NOTES_REPO_URL:-git@github.com:vaibhav-mattoo/notes.git}"
NOTES_REF="${NOTES_REF:-master}"
NOTES_LOCAL_PATH="${NOTES_LOCAL_PATH:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
NOTES_CACHE_DIR="${NOTES_CACHE_DIR:-${REPO_ROOT}/.notes-cache}"
CONTENT_DIR="${REPO_ROOT}/site/src/content"

log() { printf '==> %s\n' "$*"; }

sync_dir() {
	local src="$1" dst="$2"
	mkdir -p "$dst"
	rsync -a --delete "${src}/" "${dst}/"
}

if [[ -n "${NOTES_LOCAL_PATH}" && -d "${NOTES_LOCAL_PATH}" ]]; then
	log "Syncing notes content from local checkout: ${NOTES_LOCAL_PATH}"
	sync_dir "${NOTES_LOCAL_PATH}/notes" "${CONTENT_DIR}/notes"
	sync_dir "${NOTES_LOCAL_PATH}/topics" "${CONTENT_DIR}/topics"
else
	if [[ -d "${NOTES_CACHE_DIR}/.git" ]]; then
		log "Fetching ${NOTES_REF} in ${NOTES_CACHE_DIR}"
		git -C "${NOTES_CACHE_DIR}" fetch --depth 1 origin "${NOTES_REF}"
		git -C "${NOTES_CACHE_DIR}" checkout "${NOTES_REF}"
		git -C "${NOTES_CACHE_DIR}" reset --hard "origin/${NOTES_REF}"
	else
		log "Cloning ${NOTES_REPO_URL} (${NOTES_REF}) into ${NOTES_CACHE_DIR}"
		git clone --branch "${NOTES_REF}" --depth 1 "${NOTES_REPO_URL}" "${NOTES_CACHE_DIR}"
	fi
	sync_dir "${NOTES_CACHE_DIR}/notes" "${CONTENT_DIR}/notes"
	sync_dir "${NOTES_CACHE_DIR}/topics" "${CONTENT_DIR}/topics"
fi

log "Notes content synced into ${CONTENT_DIR}"
