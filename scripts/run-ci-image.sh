#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd -P)"
IMAGE="${EASYMDE_CI_IMAGE:-easymde-ci:wp6.7-php8.3-node20.19.0}"
DATABASE_IMAGE="mariadb@sha256:1b46b73d4b629022dfa29e6db3bb0d63b5df714fc3bfbe5057d63d76d8f6054b"
RUN_ID="easymde-ci-$$"
NETWORK="${RUN_ID}-network"
DATABASE="${RUN_ID}-db"

cleanup() {
	docker rm --force "${DATABASE}" >/dev/null 2>&1 || true
	docker network rm "${NETWORK}" >/dev/null 2>&1 || true
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

"${SCRIPT_DIR}/build-ci-image.sh" --verify

if ! docker image inspect "${DATABASE_IMAGE}" >/dev/null 2>&1; then
	echo "Pinned local MariaDB image ${DATABASE_IMAGE} is required; this runner never pulls images." >&2
	exit 1
fi

docker network create --internal "${NETWORK}" >/dev/null
docker run --detach \
	--name "${DATABASE}" \
	--network "${NETWORK}" \
	--network-alias easymde-ci-db \
	--pull=never \
	--env MARIADB_ROOT_PASSWORD=root \
	--env MARIADB_DATABASE=easymde_phpunit \
	"${DATABASE_IMAGE}" >/dev/null

ready=false
for _attempt in $(seq 1 60); do
	if docker exec "${DATABASE}" mariadb-admin ping \
		--host=127.0.0.1 \
		--user=root \
		--password=root \
		--silent >/dev/null 2>&1; then
		ready=true
		break
	fi
	sleep 1
done

if [ "${ready}" != true ]; then
	echo "The disposable EasyMDE CI database did not become ready within 60 seconds." >&2
	docker logs "${DATABASE}" >&2
	exit 1
fi

docker run --rm \
	--network "${NETWORK}" \
	--pull=never \
	--volume "${REPO_ROOT}:/workspace:ro" \
	"${IMAGE}" \
	easymde-phpunit "$@"
