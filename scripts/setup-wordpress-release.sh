#!/usr/bin/env bash
set -euo pipefail

RELEASE_ZIP="${1:-dist/EasyMDE.zip}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd -P)"
WP_PATH="${EASYMDE_WP_PATH:-/tmp/easymde-release-wp}"
WP_URL="${EASYMDE_WP_URL:-http://127.0.0.1:8089}"
WP_TITLE="${EASYMDE_WP_TITLE:-EasyMDE Release Test}"
WP_ADMIN_EMAIL="${EASYMDE_WP_ADMIN_EMAIL:-admin@example.test}"
WP_VERSION="${EASYMDE_WP_VERSION:-latest}"
DB_NAME="${EASYMDE_DB_NAME:-easymde_release}"
DB_USER="${EASYMDE_DB_USER:-root}"
DB_PASS="${EASYMDE_DB_PASS:-root}"
DB_HOST="${EASYMDE_DB_HOST:-127.0.0.1:3306}"

dotenv_value() {
	local name="$1"
	node --env-file="${REPO_ROOT}/.env" -e 'process.stdout.write(process.env[process.argv[1]] || "")' "${name}"
}

if [ -f "${REPO_ROOT}/.env" ]; then
	WORDPRESS_ADMIN_USER="${WORDPRESS_ADMIN_USER:-$(dotenv_value WORDPRESS_ADMIN_USER)}"
	WORDPRESS_ADMIN_PASSWORD="${WORDPRESS_ADMIN_PASSWORD:-$(dotenv_value WORDPRESS_ADMIN_PASSWORD)}"
fi

WP_ADMIN_USER="${WORDPRESS_ADMIN_USER:?Set WORDPRESS_ADMIN_USER in .env or the process environment}"
WP_ADMIN_PASSWORD="${WORDPRESS_ADMIN_PASSWORD:?Set WORDPRESS_ADMIN_PASSWORD in .env or the process environment}"

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
