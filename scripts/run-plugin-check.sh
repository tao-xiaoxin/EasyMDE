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
PLUGIN_CHECK_CLI="${WP_PATH}/wp-content/plugins/plugin-check/cli.php"
if [ ! -f "${PLUGIN_CHECK_CLI}" ]; then
	echo "Plugin Check runtime CLI bootstrap was not found at ${PLUGIN_CHECK_CLI}." >&2
	exit 1
fi

PLUGIN_CHECK_OUTPUT="$(mktemp)"
trap 'rm -f "${PLUGIN_CHECK_OUTPUT}"' EXIT

set +e
wp --require="${PLUGIN_CHECK_CLI}" plugin check easymde --path="${WP_PATH}" --allow-root --format=strict-json | tee "${PLUGIN_CHECK_OUTPUT}"
PLUGIN_CHECK_COMMAND_STATUS="${PIPESTATUS[0]}"
set -e

PLUGIN_CHECK_STATUS=0
node scripts/plugin-check-results.mjs "${PLUGIN_CHECK_OUTPUT}" "${PLUGIN_CHECK_COMMAND_STATUS}" || PLUGIN_CHECK_STATUS="$?"

if [ "${PLUGIN_CHECK_STATUS}" -eq 1 ]; then
	echo "Plugin Check reported errors for the built release ZIP." >&2
	exit 1
fi

if [ "${PLUGIN_CHECK_STATUS}" -ne 0 ]; then
	echo "Plugin Check output could not be parsed." >&2
	exit "${PLUGIN_CHECK_STATUS}"
fi
