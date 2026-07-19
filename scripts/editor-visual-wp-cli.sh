#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd -P)"
COMPOSE_FILE="${REPO_ROOT}/docker-compose.editor-visual.yml"
PROJECT_NAME="easymde-editor-visual"
ENVIRONMENT="${EASYMDE_VISUAL_ENVIRONMENT:-}"

case "${ENVIRONMENT}" in
	reference)
		service="reference-init"
		;;
	refactor)
		service="refactor-init"
		;;
	*)
		echo "Error: Set EASYMDE_VISUAL_ENVIRONMENT to reference or refactor." >&2
		exit 1
		;;
esac

exec docker compose \
	--project-name "${PROJECT_NAME}" \
	--file "${COMPOSE_FILE}" \
	run --rm --no-deps --entrypoint wp \
	"${service}" "$@"
