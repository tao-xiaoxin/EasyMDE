<?php

namespace EasyMDE\ImageHosting;

use RuntimeException;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class ImageHostException extends RuntimeException {

	private $error_code;

	public function __construct( $error_code ) {
		$this->error_code = (string) $error_code;
		parent::__construct( $this->error_code );
	}

	public function get_error_code() {
		return $this->error_code;
	}
}
