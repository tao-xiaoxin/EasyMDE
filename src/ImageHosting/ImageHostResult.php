<?php

namespace EasyMDE\ImageHosting;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class ImageHostResult {

	private $success;
	private $provider;
	private $key;
	private $url;
	private $error_code;

	private function __construct( $success, $provider, $key, $url, $error_code ) {
		$this->success    = (bool) $success;
		$this->provider   = (string) $provider;
		$this->key        = (string) $key;
		$this->url        = (string) $url;
		$this->error_code = (string) $error_code;
	}

	public static function uploaded( $provider, $key, $url ) {
		return new self( true, $provider, $key, $url, '' );
	}

	public static function connected( $provider ) {
		return new self( true, $provider, '', '', '' );
	}

	public static function failed( $provider, $error_code ) {
		return new self( false, $provider, '', '', $error_code );
	}

	public function is_success() {
		return $this->success;
	}

	public function get_provider() {
		return $this->provider;
	}

	public function get_key() {
		return $this->key;
	}

	public function get_url() {
		return $this->url;
	}

	public function get_error_code() {
		return $this->error_code;
	}
}
