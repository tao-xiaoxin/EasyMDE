<?php

namespace EasyMDE\ImageHosting;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class HttpResponse {

	private $status_code;
	private $body;
	private $error_code;
	private $transport_category;
	private $transport_errno;
	private $cancelled;

	private function __construct( $status_code, $body, $error_code, $transport_category, $transport_errno, $cancelled ) {
		$this->status_code        = (int) $status_code;
		$this->body               = (string) $body;
		$this->error_code         = (string) $error_code;
		$this->transport_category = (string) $transport_category;
		$this->transport_errno    = $transport_errno;
		$this->cancelled          = (bool) $cancelled;
	}

	public static function success( $status_code, $body ) {
		return new self( $status_code, $body, '', '', null, false );
	}

	/**
	 * Build a transport failure without carrying upstream message text.
	 *
	 * The coarse error code stays backward compatible for existing consumers.
	 * The numeric cURL errno, when the transport could observe one, refines the
	 * closed diagnostic category set: cancelled, timeout, dns_failure,
	 * connect_failure, tls_failure, transfer_failure, transport_failure.
	 *
	 * @param string   $error_code      Stable coarse code: 'timeout' or 'transport_failure'.
	 * @param int|null $transport_errno Numeric cURL errno, or null when unavailable.
	 * @param bool     $cancelled       True when the request was aborted before any response.
	 */
	public static function failure( $error_code, $transport_errno = null, $cancelled = false ) {
		$allowed_error_codes = array( 'timeout', 'transport_failure' );
		$stable_error_code   = in_array( $error_code, $allowed_error_codes, true )
			? $error_code
			: 'transport_failure';
		$transport_errno     = is_int( $transport_errno ) && $transport_errno >= 1 && $transport_errno <= 999
			? $transport_errno
			: null;
		$cancelled           = (bool) $cancelled;

		return new self(
			0,
			'',
			$stable_error_code,
			self::transport_category( $stable_error_code, $transport_errno, $cancelled ),
			$transport_errno,
			$cancelled
		);
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

	public function get_transport_category() {
		return $this->transport_category;
	}

	public function get_transport_errno() {
		return $this->transport_errno;
	}

	public function is_cancelled() {
		return $this->cancelled;
	}

	/**
	 * Map a bounded transport signal to one stable diagnostic category.
	 *
	 * The numeric ranges follow the cURL error code groups for name
	 * resolution, connection, TLS, and data transfer failures. Unrecognized
	 * signals stay on the generic category, so this never turns upstream
	 * text into an arbitrary value.
	 */
	private static function transport_category( $error_code, $transport_errno, $cancelled ) {
		if ( $cancelled ) {
			return 'cancelled';
		}
		if ( 'timeout' === $error_code || 28 === $transport_errno ) {
			return 'timeout';
		}
		if ( null === $transport_errno ) {
			return 'transport_failure';
		}
		if ( 6 === $transport_errno ) {
			return 'dns_failure';
		}
		if ( 7 === $transport_errno ) {
			return 'connect_failure';
		}
		if ( in_array( $transport_errno, array( 35, 51, 53, 54, 58, 59, 60, 64, 66, 77, 80, 83, 90, 91 ), true ) ) {
			return 'tls_failure';
		}
		if ( in_array( $transport_errno, array( 18, 55, 56, 92 ), true ) ) {
			return 'transfer_failure';
		}

		return 'transport_failure';
	}
}
