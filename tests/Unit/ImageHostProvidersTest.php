<?php

use EasyMDE\ImageHosting\CloudflareR2Provider;
use EasyMDE\ImageHosting\AlibabaOssProvider;
use EasyMDE\ImageHosting\HttpResponse;
use EasyMDE\ImageHosting\HttpTransport;
use EasyMDE\ImageHosting\ImageHostException;
use EasyMDE\ImageHosting\ImageHostProviderSupport;
use EasyMDE\ImageHosting\QiniuKodoProvider;
use EasyMDE\ImageHosting\TencentCosProvider;
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

final class ImageHostThrowingTransport implements HttpTransport {

	public $requests = array();

	public function request( $method, $url, array $arguments ) {
		$this->requests[] = array(
			'method'     => $method,
			'url'       => $url,
			'arguments' => $arguments,
		);
		throw new RuntimeException( 'Synthetic transport exception must not escape.' );
	}
}

final class ImageHostProvidersTest extends WP_UnitTestCase {

	public function test_public_viewing_urls_support_http_and_preserve_encoded_object_paths() {
		$this->assertSame(
			'http://images.example.test',
			ImageHostProviderSupport::normalize_public_base_url( 'http://images.example.test/' )
		);
		$this->assertSame(
			'http://images.example.test/2026/%E9%AA%8C%E8%AF%81%E5%9B%BE%E6%A0%87.png',
			ImageHostProviderSupport::public_url( 'http://images.example.test', '2026/验证图标.png' )
		);
	}

	public function test_public_viewing_urls_reject_unsafe_or_non_root_bases() {
		$invalid_urls = array(
			'http://user@images.example.test',
			'https://user:password@images.example.test',
			'http://images.example.test:80',
			'https://images.example.test:443',
			'http://images.example.test/private',
			'https://images.example.test/private/',
			'http://images.example.test//',
			'https://images.example.test////',
			'http://images.example.test?token=synthetic',
			'https://images.example.test#fragment',
			'//images.example.test',
			'ftp://images.example.test',
			' http://images.example.test',
		);

		foreach ( $invalid_urls as $url ) {
			try {
				ImageHostProviderSupport::normalize_public_base_url( $url );
				$this->fail( 'Expected an unsafe or non-root public URL to fail fast: ' . $url );
			} catch ( ImageHostException $exception ) {
				$this->assertSame( 'image_host_invalid_public_url', $exception->get_error_code(), $url );
			}
		}
	}

	public function test_wordpress_transport_enforces_the_bounded_https_request_contract() {
		$captured = array();
		$filter   = static function ( $preempt, $arguments, $url ) use ( &$captured ) {
			$captured = array( $arguments, $url );

			return array(
				'headers'  => array( 'content-type' => array( 'text/plain', 'application/json; charset=utf-8' ) ),
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
		$this->assertSame( 'application/json; charset=utf-8', $response->get_header( 'content-type' ) );
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
			'https://synthetic-account.r2.cloudflarestorage.com',
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

	public function test_r2_accepts_only_official_jurisdiction_endpoints() {
		foreach ( array( 'eu', 'us', 'fedramp' ) as $jurisdiction ) {
			$endpoint  = 'https://synthetic-account.' . $jurisdiction . '.r2.cloudflarestorage.com';
			$transport = new ImageHostFakeTransport( array( HttpResponse::success( 200, '' ) ) );
			$provider  = new CloudflareR2Provider(
				$transport,
				$endpoint,
				'SYNTHETIC_ACCESS',
				'SYNTHETIC_SECRET',
				'synthetic-bucket',
				'https://images.example.test'
			);

			$this->assertTrue( $provider->upload( 'synthetic-image-bytes', 'image/png', 'validation.png' )->is_success(), $jurisdiction );
			$this->assertSame( $endpoint . '/synthetic-bucket/validation.png', $transport->requests[0]['url'], $jurisdiction );
		}

		foreach (
			array(
				'http://synthetic-account.r2.cloudflarestorage.com',
				'https://synthetic-account.unknown.r2.cloudflarestorage.com',
				'https://synthetic-account.eu.r2.cloudflarestorage.com:443',
				'https://synthetic-account.eu.r2.cloudflarestorage.com/path',
				'https://synthetic-account.eu.r2.cloudflarestorage.com/',
			) as $endpoint
		) {
			try {
				new CloudflareR2Provider(
					new ImageHostFakeTransport( array() ),
					$endpoint,
					'SYNTHETIC_ACCESS',
					'SYNTHETIC_SECRET',
					'synthetic-bucket',
					'https://images.example.test'
				);
				$this->fail( 'Expected an invalid R2 endpoint to fail fast.' );
			} catch ( ImageHostException $exception ) {
				$this->assertSame( 'image_host_invalid_configuration', $exception->get_error_code() );
			}
		}
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

	public function test_qiniu_upload_uses_sdk_crc_and_one_transport_write_with_the_same_object_key() {
		$transport = new ImageHostFakeTransport(
			array(
				$this->qiniu_region_response(),
				HttpResponse::success( 200, '{"key":"20260713/example.png","hash":"synthetic"}', array( 'Content-Type' => 'application/json' ) ),
			)
		);
		$provider  = new QiniuKodoProvider(
			$transport,
			'SYNTHETIC_ACCESS',
			'SYNTHETIC_SECRET',
			'synthetic-bucket',
			'https://backup.example.test'
		);

		$before = time();
		$result = $provider->upload( 'synthetic-image-bytes', 'image/png', '20260713/example.png' );
		$after  = time();

		$this->assertTrue( $result->is_success() );
		$this->assertSame( 'https://backup.example.test/20260713/example.png', $result->get_url() );
		$this->assertCount( 2, $transport->requests );
		$this->assertSame( 'GET', $transport->requests[0]['method'] );
		$this->assertStringStartsWith( 'https://uc.qiniuapi.com/v4/query?ak=', $transport->requests[0]['url'] );
		$request = $transport->requests[1];
		$body    = $request['arguments']['body'];
		$this->assertSame( 'POST', $request['method'] );
		$this->assertSame( 'https://up-z0.qiniup.com', $request['url'] );
		$this->assertStringContainsString( "name=\"key\"\r\n\r\n20260713/example.png\r\n", $body );
		$this->assertStringContainsString( "name=\"crc32\"\r\n\r\n" . \Qiniu\crc32_data( 'synthetic-image-bytes' ) . "\r\n", $body );
		$this->assertStringContainsString( "name=\"file\"; filename=\"easymde-upload.png\"\r\nContent-Type: image/png\r\n\r\nsynthetic-image-bytes\r\n", $body );
		$this->assertStringNotContainsString( 'SYNTHETIC_SECRET', $body );
		$this->assertSame( 1, preg_match( '/name=\"token\"\r\n\r\n([^\r\n]+)/', $body, $token_matches ) );
		$token_parts = explode( ':', $token_matches[1], 3 );
		$this->assertCount( 3, $token_parts );
		$this->assertSame( 'SYNTHETIC_ACCESS', $token_parts[0] );
		$policy = json_decode( \Qiniu\base64_urlSafeDecode( $token_parts[2] ), true );
		$this->assertIsArray( $policy );
		$this->assertSame( 'synthetic-bucket:20260713/example.png', $policy['scope'] );
		$this->assertGreaterThanOrEqual( $before + 3600, (int) $policy['deadline'] );
		$this->assertLessThanOrEqual( $after + 3600, (int) $policy['deadline'] );
		$this->assertSame(
			\Qiniu\base64_urlSafeEncode( hash_hmac( 'sha1', $token_parts[2], 'SYNTHETIC_SECRET', true ) ),
			$token_parts[1]
		);
		$this->assertSame( 10, $request['arguments']['timeout'] );
		$this->assertSame( 0, $request['arguments']['redirection'] );
		$this->assertTrue( $request['arguments']['sslverify'] );

	}

	public function test_qiniu_upload_selects_one_official_host_for_each_runtime_attempt() {
		$transport = new ImageHostFakeTransport(
			array(
				$this->qiniu_region_response( array( 'upload-z0.qiniup.com', 'up-z0.qiniup.com' ) ),
				HttpResponse::success( 200, '{"key":"20260713/example.png"}', array( 'Content-Type' => 'application/json' ) ),
			)
		);
		$provider = new QiniuKodoProvider( $transport, 'SYNTHETIC_ACCESS', 'SYNTHETIC_SECRET', 'synthetic-bucket', 'https://backup.example.test' );

		$result = $provider->upload(
			'synthetic-image-bytes',
			'image/png',
			'20260713/example.png',
			array(
				'attempt'       => 2,
				'attempt_limit' => 2,
			)
		);

		$this->assertTrue( $result->is_success() );
		$this->assertCount( 2, $transport->requests );
		$this->assertSame( 'https://upload-z0.qiniup.com', $transport->requests[1]['url'] );
	}

	public function test_qiniu_upload_does_not_retry_one_attempt_across_hosts() {
		$transport = new ImageHostFakeTransport(
			array(
				$this->qiniu_region_response( array( 'upload-z0.qiniup.com', 'up-z0.qiniup.com' ) ),
				HttpResponse::failure( 'transport_failure' ),
				HttpResponse::success( 200, '{"key":"20260713/example.png"}', array( 'Content-Type' => 'application/json' ) ),
			)
		);
		$provider = new QiniuKodoProvider( $transport, 'SYNTHETIC_ACCESS', 'SYNTHETIC_SECRET', 'synthetic-bucket', 'https://backup.example.test' );

		$result = $provider->upload( 'synthetic-image-bytes', 'image/png', '20260713/example.png' );

		$this->assertFalse( $result->is_success() );
		$this->assertSame( 'qiniu_transport_failure', $result->get_error_code() );
		$this->assertCount( 2, $transport->requests );
		$this->assertSame( 'https://up-z0.qiniup.com', $transport->requests[1]['url'] );
	}

	public function test_qiniu_diagnostic_contains_only_stable_privacy_safe_fields() {
		$diagnostics = array();
		$listener    = static function ( $diagnostic ) use ( &$diagnostics ) {
			$diagnostics[] = $diagnostic;
		};
		add_action( 'easymde_image_hosting_diagnostic', $listener );

		try {
			$transport = new ImageHostFakeTransport(
				array(
					$this->qiniu_region_response(),
					HttpResponse::success( 200, '{"key":"20260713/example.png"}', array( 'Content-Type' => 'application/json' ) ),
				)
			);
			$provider = new QiniuKodoProvider( $transport, 'SYNTHETIC_ACCESS', 'SYNTHETIC_SECRET', 'synthetic-bucket', 'https://backup.example.test' );
			$provider->upload(
				'synthetic-image-bytes',
				'image/png',
				'20260713/example.png',
				array(
					'operation_id'  => 'synthetic-operation',
					'role'          => 'backup',
					'attempt'       => 2,
					'attempt_limit' => 3,
				)
			);
		} finally {
			remove_action( 'easymde_image_hosting_diagnostic', $listener );
		}

		$this->assertCount( 1, $diagnostics );
		$this->assertSame(
			array( 'operation_id', 'provider', 'role', 'stage', 'attempt', 'attempt_limit', 'category', 'status', 'duration_ms', 'result' ),
			array_keys( $diagnostics[0] )
		);
		$this->assertSame( 'qiniu-kodo', $diagnostics[0]['provider'] );
		$this->assertSame( 'success', $diagnostics[0]['result'] );
		$this->assertSame( 'synthetic-operation', $diagnostics[0]['operation_id'] );
		$this->assertSame( 'backup', $diagnostics[0]['role'] );
		$this->assertSame( 2, $diagnostics[0]['attempt'] );
		$this->assertSame( 3, $diagnostics[0]['attempt_limit'] );
		$this->assertIsInt( $diagnostics[0]['duration_ms'] );
		$this->assertStringNotContainsString( 'SYNTHETIC_SECRET', wp_json_encode( $diagnostics ) );
		$this->assertStringNotContainsString( '20260713/example.png', wp_json_encode( $diagnostics ) );
	}

	public function test_qiniu_upload_rejects_region_hosts_that_are_not_official() {
		foreach ( array( 'up.qiniup.com.attacker.example', 'up.attacker.qiniup.com' ) as $host ) {
			$transport = new ImageHostFakeTransport( array( $this->qiniu_region_response( $host ) ) );
			$provider  = new QiniuKodoProvider( $transport, 'SYNTHETIC_ACCESS', 'SYNTHETIC_SECRET', 'synthetic-bucket', 'https://backup.example.test' );

			$result = $provider->upload( 'synthetic-image-bytes', 'image/png', '20260713/example.png' );

			$this->assertFalse( $result->is_success(), $host );
			$this->assertSame( 'qiniu_region_discovery_failed', $result->get_error_code(), $host );
			$this->assertCount( 1, $transport->requests, $host );
		}
	}

	public function test_qiniu_upload_rejects_malformed_region_response() {
		$transport = new ImageHostFakeTransport(
			array(
				HttpResponse::success( 200, '{"hosts":', array( 'Content-Type' => 'application/json' ) ),
			)
		);
		$provider = new QiniuKodoProvider( $transport, 'SYNTHETIC_ACCESS', 'SYNTHETIC_SECRET', 'synthetic-bucket', 'https://backup.example.test' );

		$result = $provider->upload( 'synthetic-image-bytes', 'image/png', '20260713/example.png' );

		$this->assertFalse( $result->is_success() );
		$this->assertSame( 'qiniu_region_discovery_failed', $result->get_error_code() );
		$this->assertCount( 1, $transport->requests );
	}

	public function test_qiniu_upload_rejects_missing_content_type_and_wrong_key() {
		$cases = array(
			HttpResponse::success( 200, '{"key":"20260713/example.png"}' ),
			HttpResponse::success( 200, '{"key":"different.png"}', array( 'Content-Type' => 'application/json' ) ),
		);

		foreach ( $cases as $upload_response ) {
			$transport = new ImageHostFakeTransport( array( $this->qiniu_region_response(), $upload_response ) );
			$provider  = new QiniuKodoProvider( $transport, 'SYNTHETIC_ACCESS', 'SYNTHETIC_SECRET', 'synthetic-bucket', 'https://backup.example.test' );
			$result    = $provider->upload( 'synthetic-image-bytes', 'image/png', '20260713/example.png' );

			$this->assertFalse( $result->is_success() );
			$this->assertSame( 'qiniu_invalid_response', $result->get_error_code() );
			$this->assertCount( 2, $transport->requests );
		}
	}

	public function test_qiniu_upload_rejects_non_200_without_an_extra_write() {
		foreach ( array( 201, 204 ) as $status_code ) {
			$transport = new ImageHostFakeTransport(
				array(
					$this->qiniu_region_response(),
					HttpResponse::success( $status_code, '{"key":"20260713/example.png"}', array( 'Content-Type' => 'application/json' ) ),
				)
			);
			$provider = new QiniuKodoProvider( $transport, 'SYNTHETIC_ACCESS', 'SYNTHETIC_SECRET', 'synthetic-bucket', 'https://backup.example.test' );

			$result = $provider->upload( 'synthetic-image-bytes', 'image/png', '20260713/example.png' );

			$this->assertFalse( $result->is_success(), (string) $status_code );
			$this->assertSame( 'qiniu_upload_rejected', $result->get_error_code(), (string) $status_code );
			$this->assertCount( 2, $transport->requests, (string) $status_code );
		}
	}

	public function test_qiniu_region_transport_exception_is_a_stable_failure() {
		$transport = new ImageHostThrowingTransport();
		$provider  = new QiniuKodoProvider( $transport, 'SYNTHETIC_ACCESS', 'SYNTHETIC_SECRET', 'synthetic-bucket', 'https://backup.example.test' );

		$result = $provider->upload( 'synthetic-image-bytes', 'image/png', '20260713/example.png' );

		$this->assertFalse( $result->is_success() );
		$this->assertSame( 'qiniu_region_discovery_failed', $result->get_error_code() );
		$this->assertStringNotContainsString( 'Synthetic transport exception', $result->get_error_code() );
		$this->assertCount( 1, $transport->requests );
	}

	public function test_qiniu_upload_preserves_a_timeout_as_a_stable_transport_failure() {
		$transport = new ImageHostFakeTransport(
			array(
				$this->qiniu_region_response(),
				HttpResponse::failure( 'timeout' ),
			)
		);
		$provider = new QiniuKodoProvider( $transport, 'SYNTHETIC_ACCESS', 'SYNTHETIC_SECRET', 'synthetic-bucket', 'https://backup.example.test' );

		$result = $provider->upload( 'synthetic-image-bytes', 'image/png', '20260713/example.png' );

		$this->assertFalse( $result->is_success() );
		$this->assertSame( 'image_host_timeout', $result->get_error_code() );
		$this->assertCount( 2, $transport->requests );
	}

	public function test_qiniu_upload_rejects_an_oversized_sdk_response() {
		$transport = new ImageHostFakeTransport(
			array(
				$this->qiniu_region_response(),
				HttpResponse::success(
					200,
					str_repeat( 'x', ImageHostProviderSupport::MAX_RESPONSE_BYTES + 1 ),
					array( 'Content-Type' => 'application/json' )
				),
			)
		);
		$provider = new QiniuKodoProvider( $transport, 'SYNTHETIC_ACCESS', 'SYNTHETIC_SECRET', 'synthetic-bucket', 'https://backup.example.test' );

		$result = $provider->upload( 'synthetic-image-bytes', 'image/png', '20260713/example.png' );

		$this->assertFalse( $result->is_success() );
		$this->assertSame( 'qiniu_response_too_large', $result->get_error_code() );
		$this->assertCount( 2, $transport->requests );
	}

	private function qiniu_region_response( $hosts = 'up-z0.qiniup.com' ) {
		$hosts = is_array( $hosts ) ? $hosts : array( $hosts );

		return HttpResponse::success(
			200,
			wp_json_encode( array( 'hosts' => array( array( 'up' => array( 'domains' => $hosts ) ) ) ) ),
			array( 'Content-Type' => 'application/json' )
		);
	}

	public function test_alibaba_oss_upload_uses_the_v4_virtual_host_request() {
		$transport = new ImageHostFakeTransport( array( HttpResponse::success( 200, '' ) ) );
		$provider  = $this->create_alibaba_oss_provider( $transport );

		$result = $provider->upload( 'synthetic-image-bytes', 'image/png', '20260713/example.png' );

		$this->assertTrue( $result->is_success() );
		$this->assertSame( 'https://oss.example.test/20260713/example.png', $result->get_url() );
		$this->assertCount( 1, $transport->requests );
		$request = $transport->requests[0];
		$this->assertSame( 'PUT', $request['method'] );
		$this->assertSame(
			'https://synthetic-bucket.oss-cn-hangzhou.aliyuncs.com/20260713/example.png',
			$request['url']
		);
		$this->assertSame( 'synthetic-bucket.oss-cn-hangzhou.aliyuncs.com', $request['arguments']['headers']['Host'] );
		$this->assertSame( 'UNSIGNED-PAYLOAD', $request['arguments']['headers']['x-oss-content-sha256'] );
		$this->assertSame( '20260713T153045Z', $request['arguments']['headers']['x-oss-date'] );
		$this->assertSame( 'image/png', $request['arguments']['headers']['Content-Type'] );
		$this->assertSame( 'yL/YNbiPvQtQP64/Ycc4bg==', $request['arguments']['headers']['Content-MD5'] );
		$this->assertSame(
			'OSS4-HMAC-SHA256 Credential=SYNTHETIC_ACCESS/20260713/cn-hangzhou/oss/aliyun_v4_request,' .
			'Signature=0c22427289169947735d97381f34895a39ebba19f148cdd6604e8d68741786e6',
			$request['arguments']['headers']['Authorization']
		);
		$this->assertStringNotContainsString( 'SYNTHETIC_SECRET', $request['arguments']['headers']['Authorization'] );
		$this->assertSame( 0, $request['arguments']['redirection'] );
	}

	public function test_alibaba_oss_internal_endpoint_uses_the_canonical_region_for_v4_signing() {
		$transport = new ImageHostFakeTransport( array( HttpResponse::success( 200, '' ) ) );
		$provider  = new AlibabaOssProvider(
			$transport,
			'https://oss-cn-hangzhou-internal.aliyuncs.com',
			'SYNTHETIC_ACCESS',
			'SYNTHETIC_SECRET',
			'synthetic-bucket',
			'https://oss.example.test',
			static function () {
				return new DateTimeImmutable( '2026-07-13T15:30:45Z' );
			}
		);

		$result = $provider->upload( 'synthetic-image-bytes', 'image/png', 'example.png' );

		$this->assertTrue( $result->is_success() );
		$this->assertSame(
			'https://synthetic-bucket.oss-cn-hangzhou-internal.aliyuncs.com/example.png',
			$transport->requests[0]['url']
		);
		$this->assertStringContainsString(
			'/20260713/cn-hangzhou/oss/aliyun_v4_request,',
			$transport->requests[0]['arguments']['headers']['Authorization']
		);
	}

	public function test_tencent_cos_upload_uses_one_v5_signed_put() {
		$transport = new ImageHostFakeTransport( array( HttpResponse::success( 200, '' ) ) );
		$provider  = $this->create_tencent_cos_provider( $transport );

		$result = $provider->upload( 'synthetic-image-bytes', 'image/png', '图片/示例.png' );

		$this->assertTrue( $result->is_success() );
		$this->assertSame( 'https://cos.example.test/%E5%9B%BE%E7%89%87/%E7%A4%BA%E4%BE%8B.png', $result->get_url() );
		$this->assertCount( 1, $transport->requests );
		$request = $transport->requests[0];
		$this->assertSame( 'PUT', $request['method'] );
		$this->assertSame(
			'https://synthetic-bucket-1250000000.cos.ap-shanghai.myqcloud.com/%E5%9B%BE%E7%89%87/%E7%A4%BA%E4%BE%8B.png',
			$request['url']
		);
		$this->assertSame( 'synthetic-bucket-1250000000.cos.ap-shanghai.myqcloud.com', $request['arguments']['headers']['Host'] );
		$this->assertSame( 'image/png', $request['arguments']['headers']['Content-Type'] );
		$this->assertSame( 'yL/YNbiPvQtQP64/Ycc4bg==', $request['arguments']['headers']['Content-MD5'] );
		$this->assertSame(
			'q-sign-algorithm=sha1&q-ak=SYNTHETIC_SECRET_ID&q-sign-time=1783956645;1783960245&' .
			'q-key-time=1783956645;1783960245&q-header-list=content-md5;content-type;host&q-url-param-list=&' .
			'q-signature=41629e545792d1a52bb0e738976da9a986ece0c5',
			$request['arguments']['headers']['Authorization']
		);
		$this->assertStringNotContainsString( 'SYNTHETIC_SECRET_KEY', $request['arguments']['headers']['Authorization'] );
		$this->assertSame( 0, $request['arguments']['redirection'] );
	}

	public function test_alibaba_oss_and_tencent_cos_reject_non_official_service_endpoints() {
		$transport = new ImageHostFakeTransport( array() );
		$factories = array(
			static function () use ( $transport ) {
				return new AlibabaOssProvider( $transport, 'https://oss-cn-hangzhou-.aliyuncs.com', 'ACCESS', 'SECRET', 'synthetic-bucket', 'https://oss.example.test' );
			},
			static function () use ( $transport ) {
				return new AlibabaOssProvider( $transport, 'http://oss-cn-hangzhou.aliyuncs.com', 'ACCESS', 'SECRET', 'synthetic-bucket', 'https://oss.example.test' );
			},
			static function () use ( $transport ) {
				return new TencentCosProvider( $transport, 'https://cos.ap-shanghai-.myqcloud.com', 'SECRET_ID', 'SECRET_KEY', 'synthetic-bucket-1250000000', 'https://cos.example.test' );
			},
			static function () use ( $transport ) {
				return new TencentCosProvider( $transport, 'http://cos.ap-shanghai.myqcloud.com', 'SECRET_ID', 'SECRET_KEY', 'synthetic-bucket-1250000000', 'https://cos.example.test' );
			},
		);

		foreach ( $factories as $factory ) {
			try {
				$factory();
				$this->fail( 'A malformed provider API endpoint must be rejected.' );
			} catch ( ImageHostException $exception ) {
				$this->assertSame( 'image_host_invalid_configuration', $exception->get_error_code() );
			}
		}
	}

	private function create_r2_provider( HttpTransport $transport ) {
		return new CloudflareR2Provider(
			$transport,
			'https://synthetic-account.r2.cloudflarestorage.com',
			'SYNTHETIC_ACCESS',
			'SYNTHETIC_SECRET',
			'synthetic-bucket',
			'https://images.example.test',
			static function () {
				return new DateTimeImmutable( '2026-07-13 15:30:45', new DateTimeZone( 'UTC' ) );
			}
		);
	}

	private function create_alibaba_oss_provider( HttpTransport $transport ) {
		return new AlibabaOssProvider(
			$transport,
			'https://oss-cn-hangzhou.aliyuncs.com',
			'SYNTHETIC_ACCESS',
			'SYNTHETIC_SECRET',
			'synthetic-bucket',
			'https://oss.example.test',
			static function () {
				return new DateTimeImmutable( '2026-07-13 15:30:45', new DateTimeZone( 'UTC' ) );
			}
		);
	}

	private function create_tencent_cos_provider( HttpTransport $transport ) {
		return new TencentCosProvider(
			$transport,
			'https://cos.ap-shanghai.myqcloud.com',
			'SYNTHETIC_SECRET_ID',
			'SYNTHETIC_SECRET_KEY',
			'synthetic-bucket-1250000000',
			'https://cos.example.test',
			static function () {
				return 1783956645;
			}
		);
	}
}
