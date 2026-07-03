#!/usr/bin/env bash
set -euo pipefail

RELEASE_ZIP="${1:-dist/easymde.zip}"
WP_PATH="${EASYMDE_WP_PATH:-/tmp/easymde-release-wp}"
WP_URL="${EASYMDE_WP_URL:-http://127.0.0.1:8089}"
WP_TITLE="${EASYMDE_WP_TITLE:-EasyMDE Release Test}"
WP_ADMIN_USER="${EASYMDE_WP_ADMIN_USER:-admin}"
WP_ADMIN_PASSWORD="${EASYMDE_WP_ADMIN_PASSWORD:-password}"
WP_ADMIN_EMAIL="${EASYMDE_WP_ADMIN_EMAIL:-admin@example.test}"
WP_VERSION="${EASYMDE_WP_VERSION:-latest}"
DB_NAME="${EASYMDE_DB_NAME:-easymde_release}"
DB_USER="${EASYMDE_DB_USER:-root}"
DB_PASS="${EASYMDE_DB_PASS:-root}"
DB_HOST="${EASYMDE_DB_HOST:-127.0.0.1:3306}"

export WP_CLI_PHP_ARGS="${WP_CLI_PHP_ARGS:--d memory_limit=512M}"

fail() {
	echo "$1" >&2
	exit 1
}

validate_database_name() {
	if [ "${EASYMDE_ALLOW_UNSAFE_DATABASE:-}" = "1" ]; then
		return
	fi

	if [[ ! "${DB_NAME}" =~ ^easymde_[A-Za-z0-9_]+$ ]]; then
		fail "Refusing to reset non-EasyMDE database '${DB_NAME}'. Use an easymde_* test database or set EASYMDE_ALLOW_UNSAFE_DATABASE=1."
	fi
}

validate_destructive_path() {
	local path="$1"
	local label="$2"
	local base

	if [ "${EASYMDE_ALLOW_UNSAFE_PATHS:-}" = "1" ]; then
		return
	fi

	if [[ "${path}" != /* || "${path}" == *"/../"* || "${path}" == *"/.." || "${path}" == *"/./"* ]]; then
		fail "Refusing unsafe ${label} '${path}'. Use an absolute EasyMDE test path."
	fi

	case "${path}" in
		/|/tmp|/private/tmp|/var/tmp)
			fail "Refusing unsafe ${label} '${path}'."
			;;
	esac

	base="$(basename "${path}")"
	if [[ "${base}" != easymde-* ]]; then
		fail "Refusing unsafe ${label} '${path}'. The final path segment must start with easymde-."
	fi
}

prepare_destructive_path() {
	local path="$1"
	local label="$2"
	local canonical

	validate_destructive_path "${path}" "${label}"
	mkdir -p "${path}"
	canonical="$(cd "${path}" && pwd -P)"
	validate_destructive_path "${canonical}" "${label}"
	printf '%s\n' "${canonical}"
}

if [ ! -f "${RELEASE_ZIP}" ]; then
	fail "Release ZIP not found: ${RELEASE_ZIP}"
fi

validate_database_name
WP_PATH="$(prepare_destructive_path "${WP_PATH}" "EASYMDE_WP_PATH")"
WP_BIN="$(command -v wp)"

wp() {
	# shellcheck disable=SC2086 -- WP_CLI_PHP_ARGS is a local CI override string for PHP flags.
	php ${WP_CLI_PHP_ARGS} "${WP_BIN}" "$@"
}

mkdir -p "${WP_PATH}"
find "${WP_PATH}" -mindepth 1 -maxdepth 1 -exec rm -rf {} +

wp core download --path="${WP_PATH}" --version="${WP_VERSION}" --force --allow-root
wp config create \
	--path="${WP_PATH}" \
	--dbname="${DB_NAME}" \
	--dbuser="${DB_USER}" \
	--dbpass="${DB_PASS}" \
	--dbhost="${DB_HOST}" \
	--skip-check \
	--allow-root
wp db create --path="${WP_PATH}" --allow-root >/dev/null 2>&1 || true
wp db reset --path="${WP_PATH}" --yes --allow-root
wp core install \
	--path="${WP_PATH}" \
	--url="${WP_URL}" \
	--title="${WP_TITLE}" \
	--admin_user="${WP_ADMIN_USER}" \
	--admin_password="${WP_ADMIN_PASSWORD}" \
	--admin_email="${WP_ADMIN_EMAIL}" \
	--skip-email \
	--allow-root
wp plugin install "${RELEASE_ZIP}" --path="${WP_PATH}" --force --activate --allow-root
wp rewrite structure '/%postname%/' --path="${WP_PATH}" --allow-root

echo "Installed and activated EasyMDE release ZIP in ${WP_PATH}."
