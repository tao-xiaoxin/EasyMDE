<?php

namespace EasyMDE\Support;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class ManifestAssetResolver {

	public static function resolve(
		$entry_key,
		$build_dir,
		$expected_handle,
		$expected_dependencies,
		$file_prefix,
		$verify_integrity = true,
		$error_prefix = 'frontend-enhancement-'
	) {
		$build_dir       = trailingslashit( $build_dir );
		$filesystem_root = preg_match( '#^(?:[A-Za-z]:[\\\\/]|/)#', $build_dir ) ? $build_dir : Asset::path( $build_dir );
		$manifest_path   = $filesystem_root . 'wordpress-manifest.json';
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- Reads a local committed build manifest, never a remote URL.
		$manifest_json = is_readable( $manifest_path ) ? file_get_contents( $manifest_path ) : false;
		$manifest      = false === $manifest_json ? null : json_decode( $manifest_json, true );

		if (
			! is_array( $manifest )
			|| 1 !== ( $manifest['schemaVersion'] ?? null )
			|| ! isset( $manifest['entries'] )
			|| ! is_array( $manifest['entries'] )
			|| array( $entry_key ) !== array_keys( $manifest['entries'] )
			|| ! is_array( $manifest['entries'][ $entry_key ] )
		) {
			self::throw_contract_error( $error_prefix, 'manifest-invalid' );
		}

		$entry = $manifest['entries'][ $entry_key ];
		$file  = isset( $entry['file'] ) ? (string) $entry['file'] : '';
		$asset = isset( $entry['asset'] ) ? (string) $entry['asset'] : '';
		if (
			( $entry['handle'] ?? null ) !== $expected_handle
			|| ( $entry['dependencies'] ?? null ) !== $expected_dependencies
			|| array() !== ( $entry['resources'] ?? null )
			|| '' === $file_prefix
			|| ! preg_match( '#^assets/' . preg_quote( $file_prefix, '#' ) . '-[A-Za-z0-9_-]+\.js$#', $file )
			|| preg_replace( '/\.js$/', '.asset.php', $file ) !== $asset
		) {
			self::throw_contract_error( $error_prefix, 'manifest-invalid' );
		}

		$script_path   = $filesystem_root . $file;
		$metadata_path = $filesystem_root . $asset;
		if ( ! is_file( $script_path ) || ! is_readable( $metadata_path ) ) {
			self::throw_contract_error( $error_prefix, 'build-missing' );
		}

		// The manifest and filename allowlists above constrain this include to a committed metadata file.
		$metadata = require $metadata_path;
		if (
			! is_array( $metadata )
			|| ( $metadata['dependencies'] ?? null ) !== $expected_dependencies
			|| ! isset( $metadata['version'] )
			|| ! preg_match( '/^[a-f0-9]{16}$/', (string) $metadata['version'] )
		) {
			self::throw_contract_error( $error_prefix, 'metadata-invalid' );
		}

		if ( $verify_integrity ) {
			$script_hash = hash_file( 'sha256', $script_path );
			if (
				false === $script_hash
				|| ! hash_equals( (string) $metadata['version'], substr( $script_hash, 0, 16 ) )
			) {
				self::throw_contract_error( $error_prefix, 'build-integrity-invalid' );
			}
		}

		return array(
			'handle'       => $expected_handle,
			'path'         => $build_dir . $file,
			'dependencies' => $metadata['dependencies'],
			'version'      => (string) $metadata['version'],
		);
	}

	private static function throw_contract_error( $error_prefix, $suffix ) {
		// phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- Internal contract identifiers are not user-facing output.
		throw new \RuntimeException( $error_prefix . $suffix );
	}
}
