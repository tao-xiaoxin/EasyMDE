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

	public function test_wordpress_transport_classifies_failures_without_exposing_upstream_details() {
		$cases = array(
			array( 'http_request_failed', 'cURL error 28: Connection timed out after 10003 milliseconds', 'timeout', 28, false ),
			array( 'http_request_failed', 'cURL error 6: Could not resolve host: synthetic.internal', 'dns_failure', 6, false ),
			array( 'http_request_failed', 'cURL error 7: Failed to connect to synthetic.internal port 443 after 1000 milliseconds', 'connect_failure', 7, false ),
			array( 'http_request_failed', 'cURL error 35: OpenSSL SSL_connect: synthetic handshake detail', 'tls_failure', 35, false ),
			array( 'http_request_failed', 'cURL error 56: Recv failure: synthetic reset detail', 'transfer_failure', 56, false ),
			array( 'http_request_failed', 'cURL error 42: Callback aborted synthetic request', 'cancelled', 42, true ),
			array( 'http_request_failed', 'Connection timed out after 10000 milliseconds with 0 bytes received', 'timeout', null, false ),
			array( 'http_request_failed', 'Synthetic upstream details must not escape.', 'transport_failure', null, false ),
		);

		foreach ( $cases as $case ) {
			$filter = static function () use ( $case ) {
				return new WP_Error( $case[0], $case[1] );
			};
			add_filter( 'pre_http_request', $filter );

			try {
				$response = ( new WordPressHttpTransport() )->request( 'PUT', 'https://example.com/status', array() );
			} finally {
				remove_filter( 'pre_http_request', $filter );
			}

			$label = $case[1] . ' => ' . $case[2];
			$this->assertFalse( $response->is_success(), $label );
			$this->assertSame( 'timeout' === $case[2] ? 'timeout' : 'transport_failure', $response->get_error_code(), $label );
			$this->assertSame( $case[2], $response->get_transport_category(), $label );
			$this->assertSame( $case[3], $response->get_transport_errno(), $label );
			$this->assertSame( $case[4], $response->is_cancelled(), $label );
			$this->assertSame( 0, $response->get_status_code(), $label );
			$this->assertSame( '', $response->get_body(), $label );
			$this->assertStringNotContainsString(
				'synthetic',
				strtolower( (string) wp_json_encode( array( $response->get_error_code(), $response->get_transport_category(), $response->get_transport_errno(), $response->get_body() ) ) ),
				$label
			);
		}
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

	public function test_r2_upload_records_privacy_safe_transport_failure_diagnostics() {
		$provider = $this->create_r2_provider( new ImageHostFakeTransport( array( HttpResponse::failure( 'timeout', 28 ) ) ) );

		list( $result, $diagnostics ) = $this->capture_diagnostics(
			static function () use ( $provider ) {
				return $provider->upload(
					'synthetic-image-bytes',
					'image/png',
					'20260713/example.png',
					array(
						'operation_id'  => 'synthetic-operation',
						'role'          => 'primary',
						'attempt'       => 2,
						'attempt_limit' => 3,
					)
				);
			}
		);

		$this->assertFalse( $result->is_success() );
		$this->assertSame( 'image_host_timeout', $result->get_error_code() );
		$this->assertCount( 1, $diagnostics );
		$diagnostic = $diagnostics[0];
		$this->assertSame(
			array( 'operation_id', 'provider', 'role', 'stage', 'attempt', 'attempt_limit', 'category', 'status', 'errno', 'duration_ms', 'cancelled', 'result' ),
			array_keys( $diagnostic )
		);
		$this->assertSame( 'synthetic-operation', $diagnostic['operation_id'] );
		$this->assertSame( 'cloudflare-r2', $diagnostic['provider'] );
		$this->assertSame( 'primary', $diagnostic['role'] );
		$this->assertSame( 'transport', $diagnostic['stage'] );
		$this->assertSame( 2, $diagnostic['attempt'] );
		$this->assertSame( 3, $diagnostic['attempt_limit'] );
		$this->assertSame( 'timeout', $diagnostic['category'] );
		$this->assertNull( $diagnostic['status'] );
		$this->assertSame( 28, $diagnostic['errno'] );
		$this->assertIsInt( $diagnostic['duration_ms'] );
		$this->assertFalse( $diagnostic['cancelled'] );
		$this->assertSame( 'failure', $diagnostic['result'] );
		$this->assert_diagnostics_are_privacy_safe( $diagnostics );
	}

	public function test_r2_upload_records_numeric_status_for_remote_rejections() {
		$cases = array(
			403 => 'image_host_unauthorized',
			404 => 'image_host_bucket_not_found',
			500 => 'r2_upload_rejected',
		);

		foreach ( $cases as $status_code => $error_code ) {
			$provider = $this->create_r2_provider( new ImageHostFakeTransport( array( HttpResponse::success( $status_code, '' ) ) ) );

			list( $result, $diagnostics ) = $this->capture_diagnostics(
				static function () use ( $provider ) {
					return $provider->upload( 'synthetic-image-bytes', 'image/png', '20260713/example.png' );
				}
			);

			$this->assertFalse( $result->is_success(), (string) $status_code );
			$this->assertSame( $error_code, $result->get_error_code(), (string) $status_code );
			$this->assertCount( 1, $diagnostics, (string) $status_code );
			$this->assertSame( 'response', $diagnostics[0]['stage'], (string) $status_code );
			$this->assertSame( 'status', $diagnostics[0]['category'], (string) $status_code );
			$this->assertSame( $status_code, $diagnostics[0]['status'], (string) $status_code );
			$this->assertNull( $diagnostics[0]['errno'], (string) $status_code );
			$this->assertSame( 'failure', $diagnostics[0]['result'], (string) $status_code );
		}
	}

	public function test_r2_upload_records_success_status_and_role() {
		$provider = $this->create_r2_provider( new ImageHostFakeTransport( array( HttpResponse::success( 200, '' ) ) ) );

		list( $result, $diagnostics ) = $this->capture_diagnostics(
			static function () use ( $provider ) {
				return $provider->upload(
					'synthetic-image-bytes',
					'image/png',
					'20260713/example.png',
					array(
						'operation_id'  => 'synthetic-operation',
						'role'          => 'verify-primary',
						'attempt'       => 1,
						'attempt_limit' => 1,
					)
				);
			}
		);

		$this->assertTrue( $result->is_success() );
		$this->assertCount( 1, $diagnostics );
		$this->assertSame( 'verify-primary', $diagnostics[0]['role'] );
		$this->assertSame( 'complete', $diagnostics[0]['stage'] );
		$this->assertSame( 'success', $diagnostics[0]['category'] );
		$this->assertSame( 200, $diagnostics[0]['status'] );
		$this->assertSame( 'success', $diagnostics[0]['result'] );
	}

	public function test_r2_upload_records_cancelled_transport_state() {
		$provider = $this->create_r2_provider( new ImageHostFakeTransport( array( HttpResponse::failure( 'transport_failure', 42, true ) ) ) );

		list( $result, $diagnostics ) = $this->capture_diagnostics(
			static function () use ( $provider ) {
				return $provider->upload( 'synthetic-image-bytes', 'image/png', '20260713/example.png' );
			}
		);

		$this->assertFalse( $result->is_success() );
		$this->assertSame( 'image_host_transport_failure', $result->get_error_code() );
		$this->assertSame( 'cancelled', $diagnostics[0]['category'] );
		$this->assertSame( 42, $diagnostics[0]['errno'] );
		$this->assertTrue( $diagnostics[0]['cancelled'] );
		$this->assertSame( 'failure', $diagnostics[0]['result'] );
	}

	public function test_r2_upload_records_transport_exceptions_instead_of_escaping() {
		$provider = $this->create_r2_provider( new ImageHostThrowingTransport() );

		list( $result, $diagnostics ) = $this->capture_diagnostics(
			static function () use ( $provider ) {
				return $provider->upload( 'synthetic-image-bytes', 'image/png', '20260713/example.png' );
			}
		);

		$this->assertFalse( $result->is_success() );
		$this->assertSame( 'image_host_transport_failure', $result->get_error_code() );
		$this->assertCount( 1, $diagnostics );
		$this->assertSame( 'transport', $diagnostics[0]['stage'] );
		$this->assertSame( 'exception', $diagnostics[0]['category'] );
		$this->assertNull( $diagnostics[0]['status'] );
		$this->assertNull( $diagnostics[0]['errno'] );
		$this->assertSame( 'failure', $diagnostics[0]['result'] );
		$this->assert_diagnostics_are_privacy_safe( $diagnostics );
	}

	public function test_r2_upload_records_local_validation_failures_without_network_requests() {
		$transport = new ImageHostFakeTransport( array() );
		$provider  = $this->create_r2_provider( $transport );

		list( $result, $diagnostics ) = $this->capture_diagnostics(
			static function () use ( $provider ) {
				return $provider->upload( 'synthetic-image-bytes', 'image/tiff', '20260713/example.png' );
			}
		);

		$this->assertFalse( $result->is_success() );
		$this->assertSame( 'image_host_unsupported_mime', $result->get_error_code() );
		$this->assertCount( 0, $transport->requests );
		$this->assertCount( 1, $diagnostics );
		$this->assertSame( 'validation', $diagnostics[0]['stage'] );
		$this->assertSame( 'input', $diagnostics[0]['category'] );
		$this->assertNull( $diagnostics[0]['status'] );
		$this->assertSame( 'failure', $diagnostics[0]['result'] );
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

	private function capture_diagnostics( callable $operation ) {
		$diagnostics = array();
		$listener    = static function ( $diagnostic ) use ( &$diagnostics ) {
			$diagnostics[] = $diagnostic;
		};
		add_action( 'easymde_image_hosting_diagnostic', $listener );

		try {
			$result = $operation();
		} finally {
			remove_action( 'easymde_image_hosting_diagnostic', $listener );
		}

		return array( $result, $diagnostics );
	}

	private function assert_diagnostics_are_privacy_safe( array $diagnostics ) {
		$encoded = strtolower( (string) wp_json_encode( $diagnostics ) );
		foreach ( array( 'synthetic_secret', 'synthetic_access', 'cloudflarestorage', 'example.png', 'images.example.test', 'authorization', 'x-amz', 'synthetic transport exception' ) as $fragment ) {
			$this->assertStringNotContainsString( $fragment, $encoded );
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
