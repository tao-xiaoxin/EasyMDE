#!/usr/bin/env bash
set -euo pipefail

DB_NAME="${1:-wordpress_test}"
DB_USER="${2:-root}"
DB_PASS="${3:-root}"
DB_HOST="${4:-127.0.0.1}"
WP_VERSION="${5:-latest}"
WP_TESTS_DIR="${WP_TESTS_DIR:-/tmp/wordpress-tests-lib}"
WP_CORE_DIR="${WP_CORE_DIR:-/tmp/wordpress}"

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
		--ssl=0 \
		-e "CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`;"
}

configure_tests() {
	sed -i.bak \
		-e "s:dirname( __FILE__ ) . '/src/':'${WP_CORE_DIR}/':" \
		-e "s/youremptytestdbnamehere/${DB_NAME}/" \
		-e "s/yourusernamehere/${DB_USER}/" \
		-e "s/yourpasswordhere/${DB_PASS}/" \
		-e "s|localhost|${DB_HOST}|" \
		"${WP_TESTS_DIR}/wp-tests-config.php"
	rm -f "${WP_TESTS_DIR}/wp-tests-config.php.bak"
}

download_wordpress
download_tests
create_database
configure_tests

echo "Installed WordPress ${WP_VERSION} tests in ${WP_TESTS_DIR} with core in ${WP_CORE_DIR}."
