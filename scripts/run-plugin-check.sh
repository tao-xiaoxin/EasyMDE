#!/usr/bin/env bash
set -euo pipefail

RELEASE_ZIP="${1:-dist/easymde.zip}"
WP_PATH="${EASYMDE_WP_PATH:-/tmp/easymde-plugin-check-wp}"
WP_BIN="$(command -v wp)"

wp() {
	php -d memory_limit=512M "${WP_BIN}" "$@"
}

EASYMDE_WP_PATH="${WP_PATH}" scripts/setup-wordpress-release.sh "${RELEASE_ZIP}"

wp plugin install plugin-check --path="${WP_PATH}" --force --activate --allow-root
PLUGIN_CHECK_OUTPUT="$(mktemp)"
wp plugin check easymde --path="${WP_PATH}" --allow-root | tee "${PLUGIN_CHECK_OUTPUT}"

if awk -F '\t' '$3 == "ERROR" { found = 1 } END { exit found ? 0 : 1 }' "${PLUGIN_CHECK_OUTPUT}"; then
	echo "Plugin Check reported errors for the built release ZIP." >&2
	rm -f "${PLUGIN_CHECK_OUTPUT}"
	exit 1
fi

rm -f "${PLUGIN_CHECK_OUTPUT}"
