<?php

namespace EasyMDE\ImageHosting;

use Qiniu\Http\Middleware\Middleware;
use Qiniu\Http\Request;
use Qiniu\Http\Response;
use Throwable;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Routes one SDK request through the existing bounded WordPress transport.
 *
 * Qiniu SDK 7.14.0's form uploader bypasses RequestOptions middleware. The
 * provider therefore builds the SDK-compatible form Request and enters this
 * middleware explicitly; the middleware never calls the SDK cURL handler.
 */
final class QiniuSdkTransportMiddleware implements Middleware {

	private $transport;

	public function __construct( HttpTransport $transport ) {
		$this->transport = $transport;
	}

	/**
	 * @param Request  $request SDK request.
	 * @param callable $next    Intentionally unused SDK cURL fallback.
	 * @return Response
	 */
	public function send( $request, $next ) {
		unset( $next );
		if ( ! $request instanceof Request || 'POST' !== $request->method || ! is_string( $request->body ) ) {
			return new Response( 0, 0, array(), null, 'transport_failure' );
		}

		$headers = is_array( $request->headers ) ? $request->headers : array();
		try {
			$response = $this->transport->request(
				'POST',
				$request->url,
				ImageHostProviderSupport::request_arguments( $headers, $request->body )
			);
		} catch ( Throwable $throwable ) {
			return new Response( 0, 0, array(), null, 'transport_failure' );
		}

		if ( ! $response instanceof HttpResponse || ! $response->is_success() ) {
			$error_code = $response instanceof HttpResponse && 'timeout' === $response->get_error_code()
				? 'timeout'
				: 'transport_failure';
			return new Response( 0, 0, array(), null, $error_code );
		}

		$body = $response->get_body();
		if ( strlen( $body ) > ImageHostProviderSupport::MAX_RESPONSE_BYTES ) {
			return new Response( 0, 0, array(), null, 'response_too_large' );
		}

		return new Response(
			$response->get_status_code(),
			0,
			$response->get_headers(),
			$body,
			null
		);
	}
}
