#!/usr/bin/env bash

fail() {
	echo "$1" >&2
	exit 1
}

easymde_validate_database_name() {
	local db_name="$1"
	local label="$2"
	local guidance="$3"

	if [ "${EASYMDE_ALLOW_UNSAFE_DATABASE:-}" = "1" ]; then
		return
	fi

	if [[ ! "${db_name}" =~ ^easymde_[A-Za-z0-9_]+$ ]]; then
		fail "Refusing ${label} '${db_name}'. ${guidance}"
	fi
}

easymde_validate_destructive_path() {
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
		/|/tmp|/private/tmp|/var/tmp|/private/var/tmp)
			fail "Refusing unsafe ${label} '${path}'."
			;;
	esac

	base="$(basename "${path}")"
	if [[ "${base}" != easymde-* ]]; then
		fail "Refusing unsafe ${label} '${path}'. The final path segment must start with easymde-."
	fi

	if ! easymde_is_safe_test_path "${path}"; then
		fail "Refusing unsafe ${label} '${path}'. Use a dedicated /tmp/easymde-* test path or set EASYMDE_ALLOW_UNSAFE_PATHS=1."
	fi
}

easymde_is_safe_test_path() {
	local path="$1"

	case "${path}" in
		/tmp/easymde-*|/private/tmp/easymde-*|/var/tmp/easymde-*|/private/var/tmp/easymde-*)
			return 0
			;;
	esac

	return 1
}

easymde_prepare_destructive_path() {
	local path="$1"
	local label="$2"
	local canonical

	easymde_validate_destructive_path "${path}" "${label}"
	mkdir -p "${path}"
	canonical="$(cd "${path}" && pwd -P)"
	easymde_validate_destructive_path "${canonical}" "${label}"
	printf '%s\n' "${canonical}"
}
