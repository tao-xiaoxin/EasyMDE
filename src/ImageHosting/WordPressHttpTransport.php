<?php

namespace EasyMDE\ImageHosting;

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
			return HttpResponse::failure( 'transport_failure' );
		}

		return HttpResponse::success(
			wp_remote_retrieve_response_code( $response ),
			wp_remote_retrieve_body( $response )
		);
	}
}
