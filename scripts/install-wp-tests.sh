#!/usr/bin/env bash
set -euo pipefail

DB_NAME="${1:-easymde_phpunit}"
DB_USER="${2:-root}"
DB_PASS="${3:-root}"
DB_HOST="${4:-127.0.0.1}"
WP_VERSION="${5:-latest}"
WP_TESTS_DIR="${WP_TESTS_DIR:-/tmp/easymde-wordpress-tests-lib}"
WP_CORE_DIR="${WP_CORE_DIR:-/tmp/easymde-wordpress-core}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

# shellcheck source=scripts/lib/easymde-script-safety.sh
source "${SCRIPT_DIR}/lib/easymde-script-safety.sh"

validate_database_name() {
	easymde_validate_database_name \
		"${DB_NAME}" \
		"unsafe test database" \
		"Use an easymde_* database or set EASYMDE_ALLOW_UNSAFE_DATABASE=1."
}

validate_destructive_path() {
	easymde_validate_destructive_path "$@"
}

prepare_destructive_path() {
	easymde_prepare_destructive_path "$@"
}

validate_database_name
WP_TESTS_DIR="$(prepare_destructive_path "${WP_TESTS_DIR}" "WP_TESTS_DIR")"
WP_CORE_DIR="$(prepare_destructive_path "${WP_CORE_DIR}" "WP_CORE_DIR")"

if [ "${WP_TESTS_DIR}" = "${WP_CORE_DIR}" ]; then
	fail "WP_TESTS_DIR and WP_CORE_DIR must be different EasyMDE test directories."
fi

if [ "${WP_VERSION}" = "latest" ]; then
	WP_VERSION="$(
		php -r '$json = json_decode(file_get_contents("https://api.wordpress.org/core/version-check/1.7/"), true); echo $json["offers"][0]["version"];'
	)"
fi

download_wordpress() {
	local url
	url="https://wordpress.org/wordpress-${WP_VERSION}.tar.gz"

	rm -rf "${WP_CORE_DIR}"
	mkdir -p "${WP_CORE_DIR}"
	curl -fsSL "${url}" | tar --strip-components=1 -xz -C "${WP_CORE_DIR}"
}

download_tests() {
	local tag
	tag="tags/${WP_VERSION}"

	rm -rf "${WP_TESTS_DIR}"
	mkdir -p "${WP_TESTS_DIR}"

	svn export --quiet "https://develop.svn.wordpress.org/${tag}/tests/phpunit/includes" "${WP_TESTS_DIR}/includes"
	svn export --quiet "https://develop.svn.wordpress.org/${tag}/tests/phpunit/data" "${WP_TESTS_DIR}/data"
	svn export --quiet "https://develop.svn.wordpress.org/${tag}/wp-tests-config-sample.php" "${WP_TESTS_DIR}/wp-tests-config.php"
}

create_database() {
	local mysql_host
	local mysql_port
	mysql_host="${DB_HOST}"
	mysql_port="3306"

	if [[ "${DB_HOST}" == *:* ]]; then
		mysql_host="${DB_HOST%:*}"
		mysql_port="${DB_HOST##*:}"
	fi

	mysql \
		--host="${mysql_host}" \
		--port="${mysql_port}" \
		--user="${DB_USER}" \
		--password="${DB_PASS}" \
		--protocol=tcp \
		-e "CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`;"
}

configure_tests() {
	local db_host_escaped
	local db_name_escaped
	local db_pass_escaped
	local db_user_escaped
	local wp_core_dir_escaped

	wp_core_dir_escaped="$(sed_replacement "${WP_CORE_DIR}")"
	db_name_escaped="$(sed_replacement "${DB_NAME}")"
	db_user_escaped="$(sed_replacement "${DB_USER}")"
	db_pass_escaped="$(sed_replacement "${DB_PASS}")"
	db_host_escaped="$(sed_replacement "${DB_HOST}")"

	sed -i.bak \
		-e "s|dirname( __FILE__ ) . '/src/'|'${wp_core_dir_escaped}/'|" \
		-e "s|youremptytestdbnamehere|${db_name_escaped}|" \
		-e "s|yourusernamehere|${db_user_escaped}|" \
		-e "s|yourpasswordhere|${db_pass_escaped}|" \
		-e "s|localhost|${db_host_escaped}|" \
		"${WP_TESTS_DIR}/wp-tests-config.php"
	rm -f "${WP_TESTS_DIR}/wp-tests-config.php.bak"
}

sed_replacement() {
	printf '%s' "$1" | sed -e 's/[\\&|]/\\&/g'
}

download_wordpress
download_tests
create_database
configure_tests

echo "Installed WordPress ${WP_VERSION} tests in ${WP_TESTS_DIR} with core in ${WP_CORE_DIR}."
