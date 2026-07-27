#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd -P)"
IMAGE="${EASYMDE_CI_IMAGE:-easymde-ci:wp6.7-php8.3-node20.19.0}"
COMPOSER_CACHE_SOURCE="${EASYMDE_CI_COMPOSER_CACHE_SOURCE:-}"
NODE_ARCHIVE="${EASYMDE_CI_NODE_ARCHIVE:-}"
WP_CORE_SOURCE="${EASYMDE_CI_WP_CORE_SOURCE:-}"
WP_TESTS_SOURCE="${EASYMDE_CI_WP_TESTS_SOURCE:-}"
LOCK_SHA256="$(shasum -a 256 "${REPO_ROOT}/composer.lock" | awk '{print $1}')"
WP_CORE_SHA256="8ca7e2fbe82ab39963d9f82d8b599bf27457a3d66ab7ccd5068943cf5f248b4b"
WP_TESTS_SHA256="f57f036716891431a9276ce4f63074e4123556fb56f4a7f32e9612626cc92f81"
REBUILD=false
VERIFY_ONLY=false

verify_image() {
	docker run --rm --network=none \
		--env "EASYMDE_EXPECTED_LOCK_SHA256=${LOCK_SHA256}" \
		--env "EASYMDE_EXPECTED_WP_CORE_SHA256=${WP_CORE_SHA256}" \
		--env "EASYMDE_EXPECTED_WP_TESTS_SHA256=${WP_TESTS_SHA256}" \
		"${IMAGE}" bash -c '
		set -euo pipefail
		test "$(php -r "echo PHP_VERSION;")" = "8.3.32"
		test "$(composer --version --no-ansi | awk "{print \$3}")" = "2.10.2"
		test "$(node --version)" = "v20.19.0"
		/opt/easymde/composer-project/vendor/bin/phpunit --version >/dev/null
		test -f /opt/easymde/composer-project/vendor/yoast/phpunit-polyfills/phpunitpolyfills-autoload.php
		test -x /usr/local/bin/easymde-phpunit
		test "${EASYMDE_CI_COMPOSER_LOCK_SHA256}" = "${EASYMDE_EXPECTED_LOCK_SHA256}"
		test "$(sha256sum /opt/easymde/composer-project/composer.lock | awk "{print \$1}")" = "${EASYMDE_EXPECTED_LOCK_SHA256}"
		test "${EASYMDE_CI_WP_CORE_SHA256}" = "${EASYMDE_EXPECTED_WP_CORE_SHA256}"
		test "${EASYMDE_CI_WP_TESTS_SHA256}" = "${EASYMDE_EXPECTED_WP_TESTS_SHA256}"
		test "$(cd "${WP_CORE_DIR}" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | awk "{print \$1}")" = "${EASYMDE_EXPECTED_WP_CORE_SHA256}"
		test "$(cd "${WP_TESTS_DIR}" && find includes data -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum | awk "{print \$1}")" = "${EASYMDE_EXPECTED_WP_TESTS_SHA256}"
		test "$(php -r "require \"${WP_CORE_DIR}/wp-includes/version.php\"; echo \$wp_version;")" = "6.7"
		grep -Fq "define( '\''ABSPATH'\'', '\''/opt/easymde/wordpress/'\'' );" "${WP_TESTS_DIR}/wp-tests-config.php"
		grep -Fq "define( '\''DB_HOST'\'', '\''easymde-ci-db:3306'\'' );" "${WP_TESTS_DIR}/wp-tests-config.php"
		php -m | grep -qx mysqli
	'
}

if [ "${1:-}" = "--rebuild" ]; then
	REBUILD=true
elif [ "${1:-}" = "--verify" ]; then
	VERIFY_ONLY=true
elif [ "$#" -gt 0 ]; then
	echo "Usage: scripts/build-ci-image.sh [--rebuild|--verify]" >&2
	exit 2
fi

if [ "${VERIFY_ONLY}" = true ]; then
	if ! docker image inspect "${IMAGE}" >/dev/null 2>&1; then
		echo "Local EasyMDE CI image ${IMAGE} is required." >&2
		exit 1
	fi
	verify_image
	echo "Verified local EasyMDE CI image: ${IMAGE}"
	exit 0
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

directory_sha256() {
	local directory="$1"
	shift
	(
		cd "${directory}"
		find "$@" -type f -print0 \
			| LC_ALL=C sort -z \
			| xargs -0 shasum -a 256 \
			| shasum -a 256 \
			| awk '{print $1}'
	)
}

reject_symlinks() {
	local directory="$1"
	local label="$2"
	if find "${directory}" -type l -print -quit | grep -q .; then
		echo "${label} must not contain symbolic links." >&2
		exit 1
	fi
}

require_image "composer@sha256:5946476338742b200bb9ff88f8be56275ddae4b3949c72305cb0dbf10cfcb760"
require_image "php@sha256:2a3f699b6cb31e5638c5432e4d37d4047853ba6351a692c91e0a073af00a55cc"
require_directory_file "${COMPOSER_CACHE_SOURCE}" "files/phpunit/phpunit/32b804482376e73ab7c7360c11008979c8de6a60.zip" "EASYMDE_CI_COMPOSER_CACHE_SOURCE"
require_file "${NODE_ARCHIVE}" "EASYMDE_CI_NODE_ARCHIVE"
require_directory_file "${WP_CORE_SOURCE}" "wp-includes/version.php" "WordPress Core version file"
require_directory_file "${WP_CORE_SOURCE}" "wp-settings.php" "EASYMDE_CI_WP_CORE_SOURCE"
require_directory_file "${WP_TESTS_SOURCE}" "includes/functions.php" "EASYMDE_CI_WP_TESTS_SOURCE"
require_directory_file "${WP_TESTS_SOURCE}" "data/WPHTTP-testcase-redirection-script.php" "WordPress PHPUnit data"

reject_symlinks "${WP_CORE_SOURCE}" "EASYMDE_CI_WP_CORE_SOURCE"
reject_symlinks "${WP_TESTS_SOURCE}/includes" "WordPress PHPUnit includes"
reject_symlinks "${WP_TESTS_SOURCE}/data" "WordPress PHPUnit data"

if [ "$(php -r "require '${WP_CORE_SOURCE}/wp-includes/version.php'; echo \$wp_version;")" != "6.7" ]; then
	echo "EASYMDE_CI_WP_CORE_SOURCE must contain WordPress 6.7." >&2
	exit 1
fi

if [ "$(directory_sha256 "${WP_CORE_SOURCE}" .)" != "${WP_CORE_SHA256}" ]; then
	echo "EASYMDE_CI_WP_CORE_SOURCE does not match the pinned WordPress 6.7 contents." >&2
	exit 1
fi

if [ "$(directory_sha256 "${WP_TESTS_SOURCE}" includes data)" != "${WP_TESTS_SHA256}" ]; then
	echo "EASYMDE_CI_WP_TESTS_SOURCE does not match the pinned WordPress 6.7 test-library contents." >&2
	exit 1
fi

BUILD_CONTEXT="$(mktemp -d "${TMPDIR:-/tmp}/easymde-ci-build.XXXXXX")"
cleanup() {
	rm -rf "${BUILD_CONTEXT}"
}
trap cleanup EXIT

mkdir -p \
	"${BUILD_CONTEXT}/resources/composer-project" \
	"${BUILD_CONTEXT}/resources/node" \
	"${BUILD_CONTEXT}/resources/wordpress-core" \
	"${BUILD_CONTEXT}/resources/wordpress-tests-lib"

cp "${REPO_ROOT}/docker/ci/Dockerfile" "${BUILD_CONTEXT}/Dockerfile"
cp "${REPO_ROOT}/docker/ci/easymde-phpunit" "${BUILD_CONTEXT}/resources/easymde-phpunit"
cp "${REPO_ROOT}/docker/ci/wp-tests-config.php" "${BUILD_CONTEXT}/resources/wordpress-tests-lib/wp-tests-config.php"
chmod 0755 "${BUILD_CONTEXT}/resources/easymde-phpunit"
cp "${REPO_ROOT}/composer.json" "${REPO_ROOT}/composer.lock" "${BUILD_CONTEXT}/resources/composer-project/"
cp -R "${REPO_ROOT}/includes" "${REPO_ROOT}/src" "${BUILD_CONTEXT}/resources/composer-project/"
COMPOSER_CACHE_DIR="${COMPOSER_CACHE_SOURCE}" \
	COMPOSER_DISABLE_NETWORK=1 \
	composer install \
		--working-dir="${BUILD_CONTEXT}/resources/composer-project" \
		--no-interaction \
		--no-progress \
		--no-scripts \
		--prefer-dist
tar -xJf "${NODE_ARCHIVE}" --strip-components=1 -C "${BUILD_CONTEXT}/resources/node"
cp -R "${WP_CORE_SOURCE}/." "${BUILD_CONTEXT}/resources/wordpress-core/"
cp -R "${WP_TESTS_SOURCE}/includes" "${WP_TESTS_SOURCE}/data" "${BUILD_CONTEXT}/resources/wordpress-tests-lib/"

if [ ! -x "${BUILD_CONTEXT}/resources/node/bin/node" ]; then
	echo "The Node archive does not contain an executable bin/node." >&2
	exit 1
fi

docker build \
	--network=none \
	--pull=false \
	--build-arg EASYMDE_CI_NODE_VERSION=20.19.0 \
	--build-arg EASYMDE_CI_WORDPRESS_VERSION=6.7 \
	--build-arg "EASYMDE_CI_COMPOSER_LOCK_SHA256=${LOCK_SHA256}" \
	--build-arg "EASYMDE_CI_WP_CORE_SHA256=${WP_CORE_SHA256}" \
	--build-arg "EASYMDE_CI_WP_TESTS_SHA256=${WP_TESTS_SHA256}" \
	--tag "${IMAGE}" \
	"${BUILD_CONTEXT}"

verify_image

echo "Built and verified local EasyMDE CI image: ${IMAGE}"
