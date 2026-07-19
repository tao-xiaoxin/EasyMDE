#!/usr/bin/env bash
set -euo pipefail

RELEASE_ZIP="${1:-dist/EasyMDE.zip}"
WP_PATH="${EASYMDE_WP_PATH:-/tmp/easymde-release-wp}"
WP_URL="${EASYMDE_WP_URL:-http://127.0.0.1:8089}"
WP_TITLE="${EASYMDE_WP_TITLE:-EasyMDE Release Test}"
WP_ADMIN_USER="${EASYMDE_WP_ADMIN_USER:-admin}"
WP_ADMIN_PASSWORD="${EASYMDE_WP_ADMIN_PASSWORD:-password}"
WP_ADMIN_EMAIL="${EASYMDE_WP_ADMIN_EMAIL:-admin@example.test}"
WP_VERSION="${EASYMDE_WP_VERSION:-latest}"
WP_RUNTIME_OWNER="${EASYMDE_WP_RUNTIME_OWNER:-}"
DB_NAME="${EASYMDE_DB_NAME:-easymde_release}"
DB_USER="${EASYMDE_DB_USER:-root}"
DB_PASS="${EASYMDE_DB_PASS:-root}"
DB_HOST="${EASYMDE_DB_HOST:-127.0.0.1:3306}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

export WP_CLI_PHP_ARGS="${WP_CLI_PHP_ARGS:--d memory_limit=512M}"

# shellcheck source=scripts/lib/easymde-script-safety.sh
source "${SCRIPT_DIR}/lib/easymde-script-safety.sh"

validate_database_name() {
	easymde_validate_database_name \
		"${DB_NAME}" \
		"to reset non-EasyMDE database" \
		"Use an easymde_* test database or set EASYMDE_ALLOW_UNSAFE_DATABASE=1."
}

validate_destructive_path() {
	easymde_validate_destructive_path "$@"
}

prepare_destructive_path() {
	easymde_prepare_destructive_path "$@"
}

if [ ! -f "${RELEASE_ZIP}" ]; then
	fail "Release ZIP not found: ${RELEASE_ZIP}"
fi

validate_database_name
WP_PATH="$(prepare_destructive_path "${WP_PATH}" "EASYMDE_WP_PATH")"
WP_BIN="$(command -v wp)"

wp() {
	# WP_CLI_PHP_ARGS is a local CI override string for PHP flags.
	# shellcheck disable=SC2086
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
if [ "${EASYMDE_WP_BLOCK_EXTERNAL:-}" = "1" ]; then
	wp config set WP_HTTP_BLOCK_EXTERNAL true --raw --path="${WP_PATH}" --allow-root
fi
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
export WP_CLI_CONFIG_PATH="${SCRIPT_DIR}/wp-cli-apache.yml"
wp rewrite flush --hard --path="${WP_PATH}" --allow-root
if [ ! -f "${WP_PATH}/.htaccess" ] || ! grep -q '^# BEGIN WordPress$' "${WP_PATH}/.htaccess"; then
	fail "WordPress rewrite rules were not written to ${WP_PATH}/.htaccess."
fi
if [ -n "${WP_RUNTIME_OWNER}" ]; then
	if [[ ! "${WP_RUNTIME_OWNER}" =~ ^[0-9]+:[0-9]+$ ]]; then
		fail "EASYMDE_WP_RUNTIME_OWNER must be a numeric uid:gid pair."
	fi
	chown -R "${WP_RUNTIME_OWNER}" "${WP_PATH}"
fi

echo "Installed and activated EasyMDE release ZIP in ${WP_PATH}."
