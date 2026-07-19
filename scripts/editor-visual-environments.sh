#!/usr/bin/env bash
set -euo pipefail

COMMAND="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd -P)"
COMPOSE_FILE="${REPO_ROOT}/docker-compose.editor-visual.yml"
PROJECT_NAME="easymde-editor-visual"
WP_RUNTIME_OWNER="33:33"
REFERENCE_PORT="${EASYMDE_VISUAL_REFERENCE_PORT:-8090}"
REFACTOR_PORT="${EASYMDE_VISUAL_REFACTOR_PORT:-8091}"
FIXTURE_CONTRACT_SHA256=""
REFERENCE_RELEASE_SHA256=""
REFERENCE_SOURCE_COMMIT=""
REFACTOR_RELEASE_SHA256=""
REFACTOR_SOURCE_COMMIT=""

compose() {
	docker compose --project-name "${PROJECT_NAME}" --file "${COMPOSE_FILE}" "$@"
}

fail() {
	echo "Error: $*" >&2
	exit 1
}

sha256_file() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$1" | awk '{print $1}'
		return
	fi

	shasum -a 256 "$1" | awk '{print $1}'
}

validate_contract() {
	node "${REPO_ROOT}/scripts/editor-visual-contract.mjs"
}

prepare_refactor_release() {
	: "${EASYMDE_VISUAL_REFACTOR_ZIP:?Set EASYMDE_VISUAL_REFACTOR_ZIP to the current refactor ZIP}"

	local expected_zip="${REPO_ROOT}/dist/EasyMDE.zip"
	local selected_zip

	selected_zip="$(
		node -e 'process.stdout.write(require("node:path").resolve(process.argv[1]))' \
			"${EASYMDE_VISUAL_REFACTOR_ZIP}"
	)"
	[[ "${selected_zip}" == "${expected_zip}" ]] ||
		fail "Refactor ZIP must use the canonical dist/EasyMDE.zip release output."

	REFACTOR_SOURCE_COMMIT="$(
		node "${REPO_ROOT}/scripts/editor-visual-contract.mjs" source-commit
	)"
	(
		cd "${REPO_ROOT}"
		npm run build:release
	)
	[[ -f "${expected_zip}" ]] || fail "Refactor release build did not produce dist/EasyMDE.zip."
}

validate_zips() {
	: "${EASYMDE_VISUAL_REFERENCE_ZIP:?Set EASYMDE_VISUAL_REFERENCE_ZIP to the fixed reference ZIP}"
	: "${EASYMDE_VISUAL_REFACTOR_ZIP:?Set EASYMDE_VISUAL_REFACTOR_ZIP to the current refactor ZIP}"

	[[ -f "${EASYMDE_VISUAL_REFERENCE_ZIP}" ]] || fail "Reference ZIP not found."
	[[ -f "${EASYMDE_VISUAL_REFACTOR_ZIP}" ]] || fail "Refactor ZIP not found."

	local expected_reference_sha
	expected_reference_sha="$(
		node -e "const value=require(process.argv[1]); process.stdout.write(value.referenceRelease.sha256)" \
			"${REPO_ROOT}/tests/e2e/fixtures/editor-visual-reference.json"
	)"
	REFERENCE_SOURCE_COMMIT="$(
		node -e "const value=require(process.argv[1]); process.stdout.write(value.referenceCommit)" \
			"${REPO_ROOT}/tests/e2e/fixtures/editor-visual-reference.json"
	)"
	FIXTURE_CONTRACT_SHA256="$(sha256_file "${REPO_ROOT}/tests/e2e/fixtures/editor-phase-0.json")"
	REFERENCE_RELEASE_SHA256="$(sha256_file "${EASYMDE_VISUAL_REFERENCE_ZIP}")"
	REFACTOR_RELEASE_SHA256="$(sha256_file "${EASYMDE_VISUAL_REFACTOR_ZIP}")"
	REFACTOR_SOURCE_COMMIT="$(
		node "${REPO_ROOT}/scripts/editor-visual-contract.mjs" source-commit
	)"

	[[ "${REFERENCE_RELEASE_SHA256}" == "${expected_reference_sha}" ]] ||
		fail "Reference ZIP SHA-256 does not match the fixed Legacy Reference identity."
	[[ "${REFERENCE_SOURCE_COMMIT}" =~ ^[0-9a-f]{40}$ ]] ||
		fail "Reference source identity is not a full Git commit."
	[[ "${REFACTOR_SOURCE_COMMIT}" =~ ^[0-9a-f]{40}$ ]] ||
		fail "Refactor source identity is not a full Git commit."
}

seed_fixture() {
	local service="$1"
	local release_sha256
	local source_commit
	local wp_path

	case "${service}" in
		reference-init)
			release_sha256="${REFERENCE_RELEASE_SHA256}"
			source_commit="${REFERENCE_SOURCE_COMMIT}"
			wp_path="/tmp/easymde-visual-reference-wp"
			;;
		refactor-init)
			release_sha256="${REFACTOR_RELEASE_SHA256}"
			source_commit="${REFACTOR_SOURCE_COMMIT}"
			wp_path="/tmp/easymde-visual-refactor-wp"
			;;
		*)
			fail "Unknown editor visual seed service: ${service}."
			;;
	esac

	compose run \
		--rm \
		--no-deps \
		--user "${WP_RUNTIME_OWNER}" \
		--env "EASYMDE_VISUAL_FIXTURE_ROOT=/workspace" \
		--env "EASYMDE_VISUAL_RELEASE_SHA256=${release_sha256}" \
		--env "EASYMDE_VISUAL_SOURCE_COMMIT=${source_commit}" \
		--entrypoint wp \
		"${service}" \
		eval-file \
		/workspace/tests/e2e/fixtures/editor-phase-0-seed.php \
		--path="${wp_path}"
}

wait_for_site() {
	local url="$1"

	for _attempt in $(seq 1 60); do
		if curl --fail --silent --show-error "${url}/wp-login.php" >/dev/null; then
			return
		fi
		sleep 2
	done

	fail "WordPress did not become ready at ${url}."
}

runtime_identity() {
	local service="$1"
	local origin="$2"
	local browser_context="$3"
	local session="$4"
	local release_sha256="$5"
	local source_commit="$6"
	local uploads
	local container_id

	container_id="$(compose ps --quiet "${service}")"
	[[ -n "${container_id}" ]] || fail "Cannot inspect ${service}; its container is not running."
	uploads="$(
		docker inspect \
			--format '{{ range .Mounts }}{{ if eq .Destination "/var/www/html" }}{{ .Name }}{{ end }}{{ end }}' \
			"${container_id}"
	)"
	[[ -n "${uploads}" ]] || fail "Cannot identify the uploads volume for ${service}."

	compose exec -T --user "${WP_RUNTIME_OWNER}" "${service}" php -r '
		require "/var/www/html/wp-load.php";
		$uploads = wp_upload_dir();
		$fixture = get_option("easymde_editor_visual_fixture", null);
		if (!is_array($fixture)
			|| empty($fixture["identity"])
			|| empty($fixture["fixtureContractSha256"])
			|| empty($fixture["releaseSha256"])
			|| empty($fixture["sourceCommit"])) {
			fwrite(STDERR, "editor_visual_fixture_identity_missing\n");
			exit(2);
		}
		echo wp_json_encode(
			array(
				"database" => DB_NAME,
				"uploadsPath" => $uploads["basedir"],
				"wordpressVersion" => get_bloginfo("version"),
				"pluginVersion" => defined("EASYMDE_VERSION") ? EASYMDE_VERSION : "",
				"phpVersion" => PHP_VERSION,
				"locale" => get_locale(),
				"externalHttpBlocked" => defined("WP_HTTP_BLOCK_EXTERNAL") && WP_HTTP_BLOCK_EXTERNAL,
				"fixtureIdentity" => $fixture["identity"],
				"fixtureContractSha256" => $fixture["fixtureContractSha256"],
				"releaseSha256" => $fixture["releaseSha256"],
				"sourceCommit" => $fixture["sourceCommit"]
			)
		);
	' | node -e '
		let input = "";
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (chunk) => { input += chunk; });
		process.stdin.on("end", () => {
			const runtime = JSON.parse(input);
			if (runtime.releaseSha256 !== process.argv[5]) {
				throw new Error("Seeded release identity does not match the selected package.");
			}
			if (runtime.sourceCommit !== process.argv[6]) {
				throw new Error("Seeded source identity does not match the selected source commit.");
			}
			runtime.origin = process.argv[1];
			runtime.browserContext = process.argv[2];
			runtime.session = process.argv[3];
			runtime.uploads = process.argv[4];
			runtime.releaseSha256 = process.argv[5];
			runtime.sourceCommit = process.argv[6];
			process.stdout.write(JSON.stringify(runtime));
		});
	' "${origin}" "${browser_context}" "${session}" "${uploads}" "${release_sha256}" "${source_commit}"
}

cleanup_authority_probes() {
	local service

	for service in reference-wordpress refactor-wordpress; do
		compose exec -T --user "${WP_RUNTIME_OWNER}" "${service}" php -r '
			require "/var/www/html/wp-load.php";
			$uploads = wp_upload_dir();
			$paths = array(
				$uploads["basedir"] . "/easymde-reference-probe.txt",
				$uploads["basedir"] . "/easymde-refactor-probe.txt"
			);
			delete_option("easymde_visual_isolation_probe");
			foreach ($paths as $path) {
				if (file_exists($path) && !unlink($path)) {
					fwrite(STDERR, "visual_isolation_probe_cleanup_failed\n");
					exit(2);
				}
			}
			if (false !== get_option("easymde_visual_isolation_probe", false)) {
				fwrite(STDERR, "visual_isolation_probe_cleanup_failed\n");
				exit(2);
			}
			foreach ($paths as $path) {
				if (file_exists($path)) {
					fwrite(STDERR, "visual_isolation_probe_cleanup_failed\n");
					exit(2);
				}
			}
		' >/dev/null
	done
}

verify_authority_isolation() {
	local status=0
	local cleanup_status=0

	cleanup_authority_probes

	compose exec -T --user "${WP_RUNTIME_OWNER}" reference-wordpress php -r '
		require "/var/www/html/wp-load.php";
		$uploads = wp_upload_dir();
		if (!empty($uploads["error"]) || !wp_mkdir_p($uploads["basedir"])) {
			fwrite(STDERR, "reference_upload_probe_failed\n");
			exit(2);
		}
		update_option("easymde_visual_isolation_probe", "reference", false);
		if ("reference" !== get_option("easymde_visual_isolation_probe", false)) {
			fwrite(STDERR, "reference_database_probe_failed\n");
			exit(2);
		}
		if (false === file_put_contents($uploads["basedir"] . "/easymde-reference-probe.txt", "reference")) {
			fwrite(STDERR, "reference_upload_probe_failed\n");
			exit(2);
		}
		if ("reference" !== file_get_contents($uploads["basedir"] . "/easymde-reference-probe.txt")) {
			fwrite(STDERR, "reference_upload_probe_failed\n");
			exit(2);
		}
	' || status=$?

	if [ "${status}" -eq 0 ]; then
			compose exec -T --user "${WP_RUNTIME_OWNER}" refactor-wordpress php -r '
			require "/var/www/html/wp-load.php";
			$uploads = wp_upload_dir();
			if (false !== get_option("easymde_visual_isolation_probe", false)
				|| file_exists($uploads["basedir"] . "/easymde-reference-probe.txt")) {
				fwrite(STDERR, "reference_authority_crossed_into_refactor\n");
				exit(2);
			}
			if (!empty($uploads["error"]) || !wp_mkdir_p($uploads["basedir"])) {
				fwrite(STDERR, "refactor_upload_probe_failed\n");
				exit(2);
			}
			update_option("easymde_visual_isolation_probe", "refactor", false);
			if ("refactor" !== get_option("easymde_visual_isolation_probe", false)) {
				fwrite(STDERR, "refactor_database_probe_failed\n");
				exit(2);
			}
			if (false === file_put_contents($uploads["basedir"] . "/easymde-refactor-probe.txt", "refactor")) {
				fwrite(STDERR, "refactor_upload_probe_failed\n");
				exit(2);
			}
			if ("refactor" !== file_get_contents($uploads["basedir"] . "/easymde-refactor-probe.txt")) {
				fwrite(STDERR, "refactor_upload_probe_failed\n");
				exit(2);
			}
		' || status=$?
	fi

	if [ "${status}" -eq 0 ]; then
			compose exec -T --user "${WP_RUNTIME_OWNER}" reference-wordpress php -r '
			require "/var/www/html/wp-load.php";
			$uploads = wp_upload_dir();
			if ("reference" !== get_option("easymde_visual_isolation_probe", false)
				|| file_exists($uploads["basedir"] . "/easymde-refactor-probe.txt")) {
				fwrite(STDERR, "refactor_authority_crossed_into_reference\n");
				exit(2);
			}
		' || status=$?
	fi

	cleanup_authority_probes || cleanup_status=$?
	if [ "${status}" -ne 0 ]; then
		if [ "${cleanup_status}" -ne 0 ]; then
			fail "Editor visual database or uploads isolation probe failed with status ${status}; cleanup also failed with status ${cleanup_status}."
		fi
		fail "Editor visual database or uploads isolation probe failed with status ${status}."
	fi
	[ "${cleanup_status}" -eq 0 ] || fail "Editor visual authority probe cleanup failed with status ${cleanup_status}."
	echo "Editor visual database and uploads writes are isolated."
}

verify_environments() {
	local reference_json
	local refactor_json

	validate_contract
	validate_zips
	wait_for_site "http://127.0.0.1:${REFERENCE_PORT}"
	wait_for_site "http://127.0.0.1:${REFACTOR_PORT}"

	reference_json="$(
		runtime_identity \
			reference-wordpress \
			"http://127.0.0.1:${REFERENCE_PORT}" \
			"reference-browser-context" \
			"reference-session" \
			"${REFERENCE_RELEASE_SHA256}" \
			"${REFERENCE_SOURCE_COMMIT}"
	)"
	refactor_json="$(
		runtime_identity \
			refactor-wordpress \
			"http://127.0.0.1:${REFACTOR_PORT}" \
			"refactor-browser-context" \
			"refactor-session" \
			"${REFACTOR_RELEASE_SHA256}" \
			"${REFACTOR_SOURCE_COMMIT}"
	)"

	node "${REPO_ROOT}/scripts/editor-visual-contract.mjs" \
		environments \
		"${reference_json}" \
		"${refactor_json}" \
		"${FIXTURE_CONTRACT_SHA256}" \
		"${REFERENCE_RELEASE_SHA256}" \
		"${REFACTOR_RELEASE_SHA256}" \
		"${REFACTOR_SOURCE_COMMIT}"
	verify_authority_isolation
}

case "${COMMAND}" in
	contract)
		validate_contract
		;;
	up)
		validate_contract
		prepare_refactor_release
		validate_zips
		compose up --detach --wait
		seed_fixture reference-init
		seed_fixture refactor-init
		verify_environments
		;;
	reset)
		validate_contract
		prepare_refactor_release
		validate_zips
		compose down --volumes --remove-orphans
		compose up --detach --wait
		seed_fixture reference-init
		seed_fixture refactor-init
		verify_environments
		;;
	verify)
		verify_environments
		;;
	down)
		compose down --volumes --remove-orphans
		;;
	*)
		fail "Usage: scripts/editor-visual-environments.sh {contract|up|reset|verify|down}"
		;;
esac
