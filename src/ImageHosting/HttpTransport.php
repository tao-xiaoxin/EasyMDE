<?php

namespace EasyMDE\ImageHosting;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

interface HttpTransport {

	/**
	 * Send a bounded HTTPS request.
	 *
	 * @param string $method    HTTP method.
	 * @param string $url       Absolute HTTPS URL.
	 * @param array  $arguments WordPress HTTP API arguments.
	 * @return HttpResponse
	 */
	public function request( $method, $url, array $arguments );
}
