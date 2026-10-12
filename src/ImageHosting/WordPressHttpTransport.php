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
			wp_remote_retrieve_body( $response ),
			$this->response_headers( $response )
		);
	}

	private function response_headers( $response ) {
		$content_type = wp_remote_retrieve_header( $response, 'content-type' );
		if ( is_array( $content_type ) ) {
			$values       = array_values( array_filter( $content_type, 'is_string' ) );
			$content_type = empty( $values ) ? '' : end( $values );
		}
		return is_string( $content_type ) && '' !== $content_type
			? array( 'Content-Type' => $content_type )
			: array();
	}
}
