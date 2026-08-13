<?php

namespace EasyMDE\Support;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class FrontendAssetContract {

	private const CODE_COPY_PREFIX = 'frontend-code-copy-';

	private const ERROR_PREFIXES = array(
		'frontend-asset-',
		'frontend-enhancement-',
		self::CODE_COPY_PREFIX,
	);

	public static function is_error( \Throwable $error ) {
		$message = $error->getMessage();

		return self::has_prefix( $message, self::ERROR_PREFIXES );
	}

	public static function is_code_copy_error( \Throwable $error ) {
		return self::has_prefix( $error->getMessage(), array( self::CODE_COPY_PREFIX ) );
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
