<?php

use EasyMDE\ImageHosting\WordPressPinnedHttpClient;

final class WordPressPinnedHttpClientFakeTransport {

	public $requests = array();

	public function request( $url, array $arguments ) {
		$this->requests[] = array( $url, $arguments );
		$handle           = curl_init();
		$hooks            = new WP_HTTP_Requests_Hooks( $url, $arguments );
		$hooks->dispatch( 'curl.before_send', array( &$handle ) );
		curl_close( $handle );

		return array(
			'response' => array( 'code' => 200 ),
			'headers'  => array(),
			'body'     => '',
		);
	}
}

final class WordPressPinnedHttpClientTest extends WP_UnitTestCase {

	public function test_request_pins_the_validated_ipv6_address_on_the_actual_curl_hook_and_removes_the_hook() {
		$transport = new WordPressPinnedHttpClientFakeTransport();
		$options   = array();
		$client    = new WordPressPinnedHttpClient(
			static function ( $url, array $arguments ) use ( $transport ) {
				return $transport->request( $url, $arguments );
			},
			static function ( $handle, $option, $value ) use ( &$options ) {
				unset( $handle );
				$options[ $option ] = $value;

				return true;
			},
			'__return_true'
		);
		$before    = has_action( 'http_api_curl' );

		$response = $client->request( 'https://images.example.test/image.png', array(), 'images.example.test', 443, '2001:4860:4860::8888' );

		$this->assertFalse( $before );
		$this->assertNotWPError( $response );
		$this->assertSame( 'https://images.example.test/image.png', $transport->requests[0][0] );
		$this->assertSame( 'https://images.example.test/image.png', $options[ CURLOPT_URL ] );
		$this->assertSame( array( 'images.example.test:443:[2001:4860:4860::8888]' ), $options[ CURLOPT_RESOLVE ] );
		$this->assertSame( '', $options[ CURLOPT_PROXY ] );
		$this->assertSame( 2, $options[ CURLOPT_SSL_VERIFYHOST ] );
		$this->assertTrue( $options[ CURLOPT_SSL_VERIFYPEER ] );
		$this->assertSame( array( 'Host: images.example.test' ), $options[ CURLOPT_HTTPHEADER ] );
		$this->assertFalse( has_action( 'http_api_curl' ) );
	}

	public function test_request_fails_before_transport_when_curl_pinning_is_unavailable() {
		$transport_calls = 0;
		$client          = new WordPressPinnedHttpClient(
			static function () use ( &$transport_calls ) {
				$transport_calls++;

				return array();
			},
			'curl_setopt',
			'__return_false'
		);

		$response = $client->request( 'https://images.example.test/image.png', array(), 'images.example.test', 443, '8.8.8.8' );

		$this->assertWPError( $response );
		$this->assertSame( 'easymde_image_hosting_pinned_transport_unavailable', $response->get_error_code() );
		$this->assertSame( 0, $transport_calls );
		$this->assertFalse( has_action( 'http_api_curl' ) );
	}

	public function test_request_removes_the_hook_when_transport_throws() {
		$client = new WordPressPinnedHttpClient(
			static function ( $url, array $arguments ) {
				$handle = curl_init();
				$hooks  = new WP_HTTP_Requests_Hooks( $url, $arguments );
				$hooks->dispatch( 'curl.before_send', array( &$handle ) );
				curl_close( $handle );

				throw new RuntimeException( 'Synthetic transport failure.' );
			},
			'curl_setopt',
			'__return_true'
		);

		$response = $client->request( 'https://images.example.test/image.png', array(), 'images.example.test', 443, '8.8.8.8' );

		$this->assertWPError( $response );
		$this->assertSame( 'easymde_image_hosting_pinned_transport_failed', $response->get_error_code() );
		$this->assertFalse( has_action( 'http_api_curl' ) );
	}
}
