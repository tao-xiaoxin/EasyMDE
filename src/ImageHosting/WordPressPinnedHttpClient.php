<?php

namespace EasyMDE\ImageHosting;

use Throwable;
use WP_Error;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class WordPressPinnedHttpClient {

	private $request_executor;
	private $curl_setter;
	private $curl_supported;

	public function __construct( ?callable $request_executor = null, ?callable $curl_setter = null, ?callable $curl_supported = null ) {
		$this->request_executor = null === $request_executor ? array( $this, 'execute_requests_curl' ) : $request_executor;
		$this->curl_setter      = null === $curl_setter ? 'curl_setopt' : $curl_setter;
		$this->curl_supported   = null === $curl_supported ? array( $this, 'supports_pinning' ) : $curl_supported;
	}

	public function request( $url, array $arguments, $host, $port, $address ) {
		if ( ! call_user_func( $this->curl_supported ) ) {
			return $this->error( 'easymde_image_hosting_pinned_transport_unavailable' );
		}

		$pin_applied  = false;
		$pin_failed   = false;
		$curl_setter  = $this->curl_setter;
		$target       = false !== strpos( $address, ':' ) ? '[' . $address . ']' : $address;
		$resolve      = $host . ':' . $port . ':' . $target;
		$url_scheme   = wp_parse_url( $url, PHP_URL_SCHEME );
		$default_port = 'https' === strtolower( (string) $url_scheme ) ? 443 : 80;
		$host_header  = $host . ( $port === $default_port ? '' : ':' . $port );
		$callback     = static function ( &$handle, $request_arguments, $request_url ) use ( $url, $resolve, $host_header, $curl_setter, &$pin_applied, &$pin_failed ) {
			unset( $request_arguments );
			if ( $request_url !== $url ) {
				return;
			}

			$pin_applied = true;
			$success     = call_user_func( $curl_setter, $handle, CURLOPT_URL, $url ) &&
				call_user_func( $curl_setter, $handle, CURLOPT_RESOLVE, array( $resolve ) ) &&
				call_user_func( $curl_setter, $handle, CURLOPT_PROXY, '' ) &&
				call_user_func( $curl_setter, $handle, CURLOPT_SSL_VERIFYHOST, 2 ) &&
				call_user_func( $curl_setter, $handle, CURLOPT_SSL_VERIFYPEER, true ) &&
				call_user_func( $curl_setter, $handle, CURLOPT_HTTPHEADER, array( 'Host: ' . $host_header ) );
			if ( defined( 'CURLOPT_NOPROXY' ) ) {
				$success = call_user_func( $curl_setter, $handle, CURLOPT_NOPROXY, '*' ) && $success;
			}
			if ( ! $success ) {
				$pin_failed = true;
				call_user_func( $curl_setter, $handle, CURLOPT_URL, 'easymde-invalid://' );
				call_user_func( $curl_setter, $handle, CURLOPT_PROTOCOLS, 0 );
			}
		};

		$arguments = array_merge(
			array(
				'method'          => 'GET',
				'httpversion'     => '1.1',
				'blocking'        => true,
				'headers'         => array(),
				'body'            => null,
				'cookies'         => array(),
				'decompress'      => false,
				'user-agent'      => 'EasyMDE/' . ( defined( 'EASYMDE_VERSION' ) ? EASYMDE_VERSION : 'unknown' ),
				'sslcertificates' => ABSPATH . WPINC . '/certificates/ca-bundle.crt',
			),
			$arguments
		);

		add_action( 'http_api_curl', $callback, PHP_INT_MAX, 3 );
		try {
			$response = call_user_func( $this->request_executor, $url, $arguments );
		} catch ( Throwable $throwable ) {
			return $this->error( 'easymde_image_hosting_pinned_transport_failed' );
		} finally {
			remove_action( 'http_api_curl', $callback, PHP_INT_MAX );
		}

		return $pin_applied && ! $pin_failed ? $response : $this->error( 'easymde_image_hosting_pinned_transport_failed' );
	}

	private function supports_pinning() {
		return class_exists( 'WpOrg\Requests\Transport\Curl' ) && \WpOrg\Requests\Transport\Curl::test( array( \WpOrg\Requests\Capability::SSL => true ) ) &&
			function_exists( 'curl_init' ) && function_exists( 'curl_setopt' ) && function_exists( 'curl_exec' ) && function_exists( 'curl_close' ) &&
			defined( 'CURLOPT_RESOLVE' ) && defined( 'CURLOPT_PROXY' ) && defined( 'CURLOPT_URL' ) && defined( 'CURLOPT_PROTOCOLS' ) &&
			defined( 'CURLOPT_SSL_VERIFYHOST' ) && defined( 'CURLOPT_SSL_VERIFYPEER' ) && defined( 'CURLOPT_HTTPHEADER' );
	}

	private function execute_requests_curl( $url, array $arguments ) {
		$hooks                   = new \WP_HTTP_Requests_Hooks( $url, $arguments );
		$options                 = array(
			'timeout'          => $arguments['timeout'],
			'useragent'        => $arguments['user-agent'],
			'blocking'         => true,
			'hooks'            => $hooks,
			'filename'         => $arguments['filename'],
			'follow_redirects' => false,
			'max_bytes'        => $arguments['limit_response_size'],
			'verify'           => $arguments['sslcertificates'],
			'verifyname'       => true,
			'transport'        => \WpOrg\Requests\Transport\Curl::class,
		);
		$response                = \WpOrg\Requests\Requests::request( $url, array(), null, \WpOrg\Requests\Requests::GET, $options );
		$projected               = new \WP_HTTP_Requests_Response( $response, $arguments['filename'] );
		$result                  = $projected->to_array();
		$result['http_response'] = $projected;

		return $result;
	}

	private function error( $code ) {
		return new WP_Error( $code, __( 'The remote image could not be downloaded.', 'easymde' ), array( 'status' => 502 ) );
	}
}
