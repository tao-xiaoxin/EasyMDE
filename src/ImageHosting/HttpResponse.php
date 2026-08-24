<?php

namespace EasyMDE\ImageHosting;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class HttpResponse {

	private $status_code;
	private $body;
	private $error_code;

	private function __construct( $status_code, $body, $error_code ) {
		$this->status_code = (int) $status_code;
		$this->body        = (string) $body;
		$this->error_code  = (string) $error_code;
	}

	public static function success( $status_code, $body ) {
		return new self( $status_code, $body, '' );
	}

	public static function failure( $error_code ) {
		$allowed_error_codes = array( 'timeout', 'transport_failure' );
		$stable_error_code   = in_array( $error_code, $allowed_error_codes, true )
			? $error_code
			: 'transport_failure';

		return new self( 0, '', $stable_error_code );
	}

	public function is_success() {
		return '' === $this->error_code;
	}

	public function get_status_code() {
		return $this->status_code;
	}

	public function get_body() {
		return $this->body;
	}

	public function get_error_code() {
		return $this->error_code;
	}
}
