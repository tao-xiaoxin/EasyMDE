<?php

namespace EasyMDE\ImageHosting;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class HttpResponse {

	private $status_code;
	private $body;
	private $error_code;
	private $headers;

	private function __construct( $status_code, $body, $error_code, array $headers = array() ) {
		$this->status_code = (int) $status_code;
		$this->body        = (string) $body;
		$this->error_code  = (string) $error_code;
		$this->headers     = $headers;
	}

	public static function success( $status_code, $body, array $headers = array() ) {
		return new self( $status_code, $body, '', self::normalize_headers( $headers ) );
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

	public function get_headers() {
		return $this->headers;
	}

	public function get_header( $name ) {
		$name = strtolower( (string) $name );
		foreach ( $this->headers as $header_name => $value ) {
			if ( strtolower( (string) $header_name ) === $name ) {
				return $value;
			}
		}

		return null;
	}

	private static function normalize_headers( array $headers ) {
		$normalized = array();
		foreach ( $headers as $name => $raw_value ) {
			$values = is_array( $raw_value ) ? array_values( array_filter( $raw_value, 'is_string' ) ) : array( $raw_value );
			if ( ! is_string( $name ) || empty( $values ) ) {
				continue;
			}
			if ( 'content-type' !== strtolower( $name ) ) {
				continue;
			}
			$value = end( $values );
			if ( is_string( $value ) && '' !== $value && strlen( $value ) <= 256 && false === strpos( $value, "\0" ) ) {
				$normalized['Content-Type'] = $value;
			}
		}

		return $normalized;
	}
}
