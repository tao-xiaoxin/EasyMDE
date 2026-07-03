#!/usr/bin/env bash
set -euo pipefail

WP_CLI_VERSION="${EASYMDE_WP_CLI_VERSION:-2.12.0}"
WP_CLI_SHA256="${EASYMDE_WP_CLI_SHA256:-ce34ddd838f7351d6759068d09793f26755463b4a4610a5a5c0a97b68220d85c}"
WP_CLI_TARGET="${EASYMDE_WP_CLI_TARGET:-/usr/local/bin/wp}"
WP_CLI_BASE_URL="https://github.com/wp-cli/wp-cli/releases/download/v${WP_CLI_VERSION}"

curl -fsSL -o wp-cli.phar "${WP_CLI_BASE_URL}/wp-cli-${WP_CLI_VERSION}.phar"
echo "${WP_CLI_SHA256}  wp-cli.phar" | sha256sum -c -
php wp-cli.phar --info
chmod +x wp-cli.phar
sudo mv wp-cli.phar "${WP_CLI_TARGET}"
