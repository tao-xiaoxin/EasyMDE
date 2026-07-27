#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd -P)"
IMAGE="${EASYMDE_CI_IMAGE:-easymde-ci:wp6.7-php8.3-node20.19.0}"
NODE_ARCHIVE="${EASYMDE_CI_NODE_ARCHIVE:-}"
WP_CORE_SOURCE="${EASYMDE_CI_WP_CORE_SOURCE:-}"
WP_TESTS_SOURCE="${EASYMDE_CI_WP_TESTS_SOURCE:-}"
REBUILD=false

verify_image() {
	docker run --rm --network=none "${IMAGE}" bash -c '
		set -euo pipefail
		test "$(node --version)" = "v20.19.0"
		test -f "${WP_CORE_DIR}/wp-settings.php"
		test -f "${WP_TESTS_DIR}/includes/functions.php"
		php -m | grep -qx mysqli
	'
}

if [ "${1:-}" = "--rebuild" ]; then
	REBUILD=true
elif [ "$#" -gt 0 ]; then
	echo "Usage: scripts/build-ci-image.sh [--rebuild]" >&2
	exit 2
fi

if [ "${REBUILD}" = false ] \
	&& docker image inspect "${IMAGE}" >/dev/null 2>&1 \
	&& verify_image; then
	echo "Reusing local EasyMDE CI image: ${IMAGE}"
	exit 0
fi

require_file() {
	local path="$1"
	local label="$2"
	if [ -z "${path}" ] || [ ! -f "${path}" ]; then
		echo "${label} is required for the offline CI image build." >&2
		exit 1
	fi
}

require_directory_file() {
	local directory="$1"
	local relative_path="$2"
	local label="$3"
	if [ -z "${directory}" ] || [ ! -f "${directory}/${relative_path}" ]; then
		echo "${label} is required for the offline CI image build." >&2
		exit 1
	fi
}

require_image() {
	local image="$1"
	if ! docker image inspect "${image}" >/dev/null 2>&1; then
		echo "Local Docker image ${image} is required; the offline CI image builder never pulls base images." >&2
		exit 1
	fi
}

require_image "composer:2"
require_image "php:8.3-cli"
require_file "${NODE_ARCHIVE}" "EASYMDE_CI_NODE_ARCHIVE"
require_directory_file "${WP_CORE_SOURCE}" "wp-settings.php" "EASYMDE_CI_WP_CORE_SOURCE"
require_directory_file "${WP_TESTS_SOURCE}" "includes/functions.php" "EASYMDE_CI_WP_TESTS_SOURCE"
require_directory_file "${WP_TESTS_SOURCE}" "data/WPHTTP-testcase-redirection-script.php" "WordPress PHPUnit data"
require_file "${WP_TESTS_SOURCE}/wp-tests-config.php" "WordPress PHPUnit configuration"

BUILD_CONTEXT="$(mktemp -d "${TMPDIR:-/tmp}/easymde-ci-build.XXXXXX")"
cleanup() {
	rm -rf "${BUILD_CONTEXT}"
}
trap cleanup EXIT

mkdir -p \
	"${BUILD_CONTEXT}/resources/node" \
	"${BUILD_CONTEXT}/resources/wordpress-core" \
	"${BUILD_CONTEXT}/resources/wordpress-tests-lib"

cp "${REPO_ROOT}/docker/ci/Dockerfile" "${BUILD_CONTEXT}/Dockerfile"
tar -xJf "${NODE_ARCHIVE}" --strip-components=1 -C "${BUILD_CONTEXT}/resources/node"
cp -R "${WP_CORE_SOURCE}/." "${BUILD_CONTEXT}/resources/wordpress-core/"
cp -R "${WP_TESTS_SOURCE}/." "${BUILD_CONTEXT}/resources/wordpress-tests-lib/"

if [ ! -x "${BUILD_CONTEXT}/resources/node/bin/node" ]; then
	echo "The Node archive does not contain an executable bin/node." >&2
	exit 1
fi

docker build \
	--network=none \
	--pull=false \
	--build-arg EASYMDE_CI_NODE_VERSION=20.19.0 \
	--build-arg EASYMDE_CI_WORDPRESS_VERSION=6.7 \
	--tag "${IMAGE}" \
	"${BUILD_CONTEXT}"

verify_image

echo "Built and verified local EasyMDE CI image: ${IMAGE}"
