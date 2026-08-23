<?php

use EasyMDE\ImageHosting\CloudflareR2Provider;
use EasyMDE\ImageHosting\HttpResponse;
use EasyMDE\ImageHosting\HttpTransport;
use EasyMDE\ImageHosting\QiniuKodoProvider;
use EasyMDE\ImageHosting\WordPressHttpTransport;

final class ImageHostFakeTransport implements HttpTransport {

	public $requests = array();
	private $responses;

	public function __construct( array $responses ) {
		$this->responses = $responses;
	}

	public function request( $method, $url, array $arguments ) {
		$this->requests[] = array(
			'method'    => $method,
			'url'       => $url,
			'arguments' => $arguments,
		);

		return array_shift( $this->responses );
	}
}

final class ImageHostProvidersTest extends WP_UnitTestCase {

	public function test_wordpress_transport_enforces_the_bounded_https_request_contract() {
		$captured = array();
		$filter   = static function ( $preempt, $arguments, $url ) use ( &$captured ) {
			$captured = array( $arguments, $url );

			return array(
				'headers'  => array(),
				'body'     => 'synthetic-response',
				'response' => array(
					'code'    => 204,
					'message' => 'No Content',
				),
				'cookies'  => array(),
				'filename' => null,
			);
		};
		add_filter( 'pre_http_request', $filter, 10, 3 );

		try {
			$transport = new WordPressHttpTransport();
			$response  = $transport->request(
				'head',
				'https://example.com/status',
				array(
					'timeout'     => 90,
					'redirection' => 7,
				)
			);
		} finally {
			remove_filter( 'pre_http_request', $filter, 10 );
		}

		$this->assertTrue( $response->is_success() );
		$this->assertSame( 204, $response->get_status_code() );
		$this->assertSame( 'HEAD', $captured[0]['method'] );
		$this->assertSame( 10, $captured[0]['timeout'] );
		$this->assertSame( 0, $captured[0]['redirection'] );
		$this->assertTrue( $captured[0]['sslverify'] );
		$this->assertTrue( $captured[0]['reject_unsafe_urls'] );
		$this->assertSame( 65536, $captured[0]['limit_response_size'] );
	}

	public function test_wordpress_transport_never_exposes_raw_http_errors() {
		$filter = static function () {
			return new WP_Error( 'http_request_failed', 'Synthetic upstream details must not escape.' );
		};
		add_filter( 'pre_http_request', $filter );

		try {
			$transport = new WordPressHttpTransport();
			$response  = $transport->request( 'GET', 'https://example.com/status', array() );
		} finally {
			remove_filter( 'pre_http_request', $filter );
		}

		$this->assertFalse( $response->is_success() );
		$this->assertSame( 'transport_failure', $response->get_error_code() );
		$this->assertStringNotContainsString( 'upstream', $response->get_error_code() );
	}

	public function test_r2_upload_uses_one_signed_put_and_returns_the_https_public_url() {
		$transport = new ImageHostFakeTransport( array( HttpResponse::success( 200, '' ) ) );
		$provider  = new CloudflareR2Provider(
			$transport,
			'synthetic-account',
			'SYNTHETIC_ACCESS',
			'SYNTHETIC_SECRET',
			'synthetic-bucket',
			'https://images.example.test',
			static function () {
				return new DateTimeImmutable( '2026-07-13 15:30:45', new DateTimeZone( 'UTC' ) );
			}
		);

		$result = $provider->upload( 'synthetic-image-bytes', 'image/png', '20260713/example.png' );

		$this->assertTrue( $result->is_success() );
		$this->assertSame( 'https://images.example.test/20260713/example.png', $result->get_url() );
		$this->assertCount( 1, $transport->requests );
		$request = $transport->requests[0];
		$this->assertSame( 'PUT', $request['method'] );
		$this->assertSame(
			'https://synthetic-account.r2.cloudflarestorage.com/synthetic-bucket/20260713/example.png',
			$request['url']
		);
		$this->assertSame( 10, $request['arguments']['timeout'] );
		$this->assertSame( 0, $request['arguments']['redirection'] );
		$this->assertTrue( $request['arguments']['sslverify'] );
		$this->assertTrue( $request['arguments']['reject_unsafe_urls'] );
		$this->assertSame( 65536, $request['arguments']['limit_response_size'] );
		$this->assertSame( 'image/png', $request['arguments']['headers']['Content-Type'] );
		$this->assertSame(
			'AWS4-HMAC-SHA256 Credential=SYNTHETIC_ACCESS/20260713/auto/s3/aws4_request, ' .
			'SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, ' .
			'Signature=33562b9cc14898bc6f2c95064528fb52b928409815b994a16ab594c853604008',
			$request['arguments']['headers']['Authorization']
		);
		$this->assertStringNotContainsString( 'SYNTHETIC_SECRET', $request['arguments']['headers']['Authorization'] );
	}

	public function test_r2_probe_is_read_only_and_transport_failures_are_stable() {
		$transport = new ImageHostFakeTransport( array( HttpResponse::failure( 'timeout' ) ) );
		$provider  = $this->create_r2_provider( $transport );

		$result = $provider->probe();

		$this->assertFalse( $result->is_success() );
		$this->assertSame( 'image_host_timeout', $result->get_error_code() );
		$this->assertCount( 1, $transport->requests );
		$this->assertSame( 'HEAD', $transport->requests[0]['method'] );
	}

	public function test_r2_rejection_is_not_retried_or_exposed_as_a_raw_provider_error() {
		$transport = new ImageHostFakeTransport( array( HttpResponse::success( 500, 'private provider details' ) ) );
		$provider  = $this->create_r2_provider( $transport );

		$result = $provider->upload( 'synthetic-image-bytes', 'image/png', '20260713/example.png' );

		$this->assertFalse( $result->is_success() );
		$this->assertSame( 'r2_upload_rejected', $result->get_error_code() );
		$this->assertStringNotContainsString( 'private', $result->get_error_code() );
		$this->assertCount( 1, $transport->requests );
	}

	public function test_qiniu_upload_uses_one_multipart_request_and_the_same_object_key() {
		$transport = new ImageHostFakeTransport(
			array( HttpResponse::success( 200, '{"key":"20260713/example.png","hash":"synthetic"}' ) )
		);
		$provider  = new QiniuKodoProvider(
			$transport,
			'SYNTHETIC_ACCESS',
			'SYNTHETIC_SECRET',
			'synthetic-bucket',
			'https://backup.example.test',
			static function () {
				return 1783956645;
			}
		);

		$result = $provider->upload( 'synthetic-image-bytes', 'image/png', '20260713/example.png' );

		$this->assertTrue( $result->is_success() );
		$this->assertSame( 'https://backup.example.test/20260713/example.png', $result->get_url() );
		$this->assertCount( 1, $transport->requests );
		$request = $transport->requests[0];
		$this->assertSame( 'POST', $request['method'] );
		$this->assertSame( 'https://upload.qiniup.com', $request['url'] );
		$this->assertStringContainsString( 'name="key"', $request['arguments']['body'] );
		$this->assertStringContainsString( '20260713/example.png', $request['arguments']['body'] );
		$this->assertStringContainsString( 'name="token"', $request['arguments']['body'] );
		$this->assertStringContainsString(
			'SYNTHETIC_ACCESS:-H9il2VoWkY7TC1Jibxg3jhg0jY=:' .
			'eyJzY29wZSI6InN5bnRoZXRpYy1idWNrZXQ6MjAyNjA3MTMvZXhhbXBsZS5wbmciLCJkZWFkbGluZSI6MTc4Mzk2MDI0NX0=',
			$request['arguments']['body']
		);
		$this->assertStringNotContainsString( 'SYNTHETIC_SECRET', $request['arguments']['body'] );
		$this->assertSame( 10, $request['arguments']['timeout'] );
		$this->assertSame( 0, $request['arguments']['redirection'] );
	}

	public function test_qiniu_probe_is_read_only_and_signed_without_exposing_the_secret() {
		$transport = new ImageHostFakeTransport( array( HttpResponse::success( 200, '["synthetic-bucket"]' ) ) );
		$provider  = $this->create_qiniu_provider( $transport );

		$result = $provider->probe();

		$this->assertTrue( $result->is_success() );
		$this->assertCount( 1, $transport->requests );
		$request = $transport->requests[0];
		$this->assertSame( 'GET', $request['method'] );
		$this->assertSame( 'https://rs.qbox.me/buckets', $request['url'] );
		$this->assertStringStartsWith( 'QBox SYNTHETIC_ACCESS:', $request['arguments']['headers']['Authorization'] );
		$this->assertStringNotContainsString( 'SYNTHETIC_SECRET', $request['arguments']['headers']['Authorization'] );
	}

	private function create_r2_provider( HttpTransport $transport ) {
		return new CloudflareR2Provider(
			$transport,
			'synthetic-account',
			'SYNTHETIC_ACCESS',
			'SYNTHETIC_SECRET',
			'synthetic-bucket',
			'https://images.example.test',
			static function () {
				return new DateTimeImmutable( '2026-07-13 15:30:45', new DateTimeZone( 'UTC' ) );
			}
		);
	}

	private function create_qiniu_provider( HttpTransport $transport ) {
		return new QiniuKodoProvider(
			$transport,
			'SYNTHETIC_ACCESS',
			'SYNTHETIC_SECRET',
			'synthetic-bucket',
			'https://backup.example.test',
			static function () {
				return 1783956645;
			}
		);
	}
}
