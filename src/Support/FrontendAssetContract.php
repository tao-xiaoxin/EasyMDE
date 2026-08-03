<?php

namespace EasyMDE\Support;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class FrontendAssetContract {

	private const ERROR_PREFIXES = array(
		'frontend-enhancement-',
		'frontend-code-copy-',
	);

	public static function is_error( \Throwable $error ) {
		$message = $error->getMessage();

		return self::has_prefix( $message, self::ERROR_PREFIXES );
	}

	public static function is_code_copy_error( \Throwable $error ) {
		return self::has_prefix( $error->getMessage(), array( 'frontend-code-copy-' ) );
	}

	public static function error_code( \Throwable $error ) {
		return self::is_error( $error ) ? $error->getMessage() : 'frontend-asset-contract-invalid';
	}

	private static function has_prefix( $message, $prefixes ) {
		foreach ( $prefixes as $prefix ) {
			if ( 0 === strpos( $message, $prefix ) ) {
				return true;
			}
		}

		return false;
	}
}
