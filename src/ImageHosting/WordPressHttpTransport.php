<?php

namespace EasyMDE\ImageHosting;

use WP_Error;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class WordPressHttpTransport implements HttpTransport {

	public function request( $method, $url, array $arguments ) {
		$arguments['method']              = strtoupper( (string) $method );
		$arguments['timeout']             = min( 10, max( 1, isset( $arguments['timeout'] ) ? (int) $arguments['timeout'] : 10 ) );
		$arguments['redirection']         = 0;
		$arguments['sslverify']           = true;
		$arguments['reject_unsafe_urls']  = true;
		$arguments['limit_response_size'] = ImageHostProviderSupport::MAX_RESPONSE_BYTES;

		$response = wp_safe_remote_request( $url, $arguments );
		if ( is_wp_error( $response ) ) {
			return HttpResponse::failure(
				self::is_timeout( $response ) ? 'timeout' : 'transport_failure',
				self::curl_errno( $response ),
				self::is_cancelled( $response )
			);
		}

		return HttpResponse::success(
			wp_remote_retrieve_response_code( $response ),
			wp_remote_retrieve_body( $response )
		);
	}

	/**
	 * Read the numeric cURL errno from a WP_Error without keeping its message.
	 *
	 * WordPress surfaces transport exceptions as
	 * 'cURL error <errno>: <text>', so only the bounded number is retained
	 * and the upstream text is discarded.
	 */
	private static function curl_errno( WP_Error $error ) {
		$message = $error->get_error_message();
		if ( ! is_string( $message ) || 1 !== preg_match( '/cURL error (\d{1,3})/', $message, $matches ) ) {
			return null;
		}

		$errno = (int) $matches[1];

		return $errno >= 1 && $errno <= 999 ? $errno : null;
	}

	private static function is_timeout( WP_Error $error ) {
		if ( 28 === self::curl_errno( $error ) ) {
			return true;
		}

		$message = $error->get_error_message();

		return is_string( $message ) && false !== stripos( $message, 'timed out' );
	}

	private static function is_cancelled( WP_Error $error ) {
		return 42 === self::curl_errno( $error );
	}
}
