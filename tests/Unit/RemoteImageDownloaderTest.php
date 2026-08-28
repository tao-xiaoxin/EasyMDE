<?php

use EasyMDE\ImageHosting\RemoteImageDownloader;

final class RemoteImageDownloaderFakePinnedClient {

	public $requests = array();
	public $status   = 200;
	public $bytes;
	public $error;

	public function __construct( $bytes = '' ) {
		$this->bytes = $bytes;
	}

	public function request( $url, array $arguments, $host, $port, $address ) {
		$this->requests[] = array( $url, $arguments, $host, $port, $address );
		if ( $this->error instanceof WP_Error ) {
			return $this->error;
		}
		file_put_contents( $arguments['filename'], $this->bytes );

		return array(
			'response' => array( 'code' => $this->status ),
			'headers'  => array( 'content-type' => 'text/plain' ),
			'body'     => '',
		);
	}
}

final class RemoteImageDownloaderTest extends WP_UnitTestCase {

	public function test_download_pins_one_public_address_from_the_complete_a_and_aaaa_set_and_detects_real_mime() {
		$png           = base64_decode( 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', true );
		$client        = new RemoteImageDownloaderFakePinnedClient( $png );
		$resolve_calls = 0;
		$download      = new RemoteImageDownloader(
			$client,
			static function ( $host ) use ( &$resolve_calls ) {
				$resolve_calls++;
				unset( $host );

				return array( '8.8.8.8', '2001:4860:4860::8888' );
			}
		);

		$file = $download->download( 'https://8.8.8.8/path/remote-file?version=1', 1024 );

		try {
			$this->assertNotWPError( $file );
			$this->assertSame( 1, $resolve_calls );
			$this->assertCount( 1, $client->requests );
			$this->assertSame( 'https://8.8.8.8/path/remote-file?version=1', $client->requests[0][0] );
			$this->assertSame( '8.8.8.8', $client->requests[0][2] );
			$this->assertSame( 443, $client->requests[0][3] );
			$this->assertSame( '2001:4860:4860::8888', $client->requests[0][4] );
			$this->assertSame( 10, $client->requests[0][1]['timeout'] );
			$this->assertSame( 0, $client->requests[0][1]['redirection'] );
			$this->assertTrue( $client->requests[0][1]['sslverify'] );
			$this->assertTrue( $client->requests[0][1]['stream'] );
			$this->assertSame( 1025, $client->requests[0][1]['limit_response_size'] );
			$this->assertSame( 'image/png', $file['type'] );
			$this->assertSame( 'remote-file.png', $file['name'] );
			$this->assertSame( strlen( $png ), $file['size'] );
		} finally {
			if ( is_array( $file ) && is_file( $file['tmp_name'] ) ) {
				wp_delete_file( $file['tmp_name'] );
			}
		}
	}

	public function test_download_rejects_a_private_aaaa_when_an_a_record_is_public_before_requesting() {
		$client   = new RemoteImageDownloaderFakePinnedClient();
		$download = new RemoteImageDownloader(
			$client,
			static function () {
				return array( '8.8.8.8', 'fd00::1' );
			}
		);

		$result = $download->download( 'https://8.8.8.8/image.png', 1024 );

		$this->assertWPError( $result );
		$this->assertSame( 'easymde_image_hosting_import_invalid_url', $result->get_error_code() );
		$this->assertCount( 0, $client->requests );
	}

	public function test_download_rejects_ipv4_mapped_ipv6_for_loopback_private_and_metadata_addresses() {
		$mapped = array( '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:169.254.169.254' );

		foreach ( $mapped as $address ) {
			$client   = new RemoteImageDownloaderFakePinnedClient();
			$download = new RemoteImageDownloader(
				$client,
				static function () use ( $address ) {
					return array( '8.8.8.8', $address );
				}
			);
			$result   = $download->download( 'https://8.8.8.8/image.png', 1024 );

			$this->assertWPError( $result );
			$this->assertSame( 'easymde_image_hosting_import_invalid_url', $result->get_error_code() );
			$this->assertCount( 0, $client->requests );
		}
	}

	public function test_download_rejects_complete_special_ipv4_and_ipv6_transition_vectors() {
		$addresses = array(
			'100.64.0.1',
			'198.18.0.1',
			'192.0.0.9',
			'192.0.2.1',
			'192.31.196.1',
			'192.52.193.1',
			'192.88.99.1',
			'192.175.48.1',
			'198.51.100.1',
			'203.0.113.1',
			'224.0.0.1',
			'240.0.0.1',
			'::127.0.0.1',
			'64:ff9b::7f00:1',
			'64:ff9b:1::7f00:1',
			'2001::1',
			'2001:db8::1',
			'2002:7f00:1::',
			'2620:4f:8000::1',
			'3fff::1',
			'fc00::1',
			'fe80::1',
			'ff00::1',
		);

		foreach ( $addresses as $address ) {
			$client   = new RemoteImageDownloaderFakePinnedClient();
			$download = new RemoteImageDownloader(
				$client,
				static function () use ( $address ) {
					return array( $address );
				}
			);
			$result   = $download->download( 'https://8.8.8.8/image.png', 1024 );

			$this->assertWPError( $result, $address );
			$this->assertSame( 'easymde_image_hosting_import_invalid_url', $result->get_error_code(), $address );
			$this->assertCount( 0, $client->requests, $address );
		}
	}

	public function test_download_accepts_normal_public_ipv4_ipv6_and_public_mapped_ipv4() {
		$png       = base64_decode( 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', true );
		$addresses = array( '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8' );

		foreach ( $addresses as $address ) {
			$client   = new RemoteImageDownloaderFakePinnedClient( $png );
			$download = new RemoteImageDownloader(
				$client,
				static function () use ( $address ) {
					return array( $address );
				}
			);
			$result   = $download->download( 'https://8.8.8.8/image.png', 1024 );

			$this->assertNotWPError( $result, $address );
			$this->assertSame( $address, $client->requests[0][4], $address );
			wp_delete_file( $result['tmp_name'] );
		}
	}

	public function test_download_resolves_once_and_never_allows_a_second_dns_answer_to_change_the_pin() {
		$client        = new RemoteImageDownloaderFakePinnedClient( 'not-an-image' );
		$resolve_calls = 0;
		$download      = new RemoteImageDownloader(
			$client,
			static function () use ( &$resolve_calls ) {
				$resolve_calls++;

				return 1 === $resolve_calls ? array( '8.8.8.8' ) : array( '127.0.0.1' );
			}
		);

		$result = $download->download( 'https://8.8.8.8/image.png', 1024 );

		$this->assertWPError( $result );
		$this->assertSame( 1, $resolve_calls );
		$this->assertSame( '8.8.8.8', $client->requests[0][4] );
	}

	public function test_download_rejects_unsupported_or_credentialed_urls_before_resolution() {
		$client        = new RemoteImageDownloaderFakePinnedClient();
		$resolve_calls = 0;
		$download      = new RemoteImageDownloader(
			$client,
			static function ( $host ) use ( &$resolve_calls ) {
				$resolve_calls++;

				return filter_var( $host, FILTER_VALIDATE_IP ) ? array( $host ) : array( '8.8.8.8' );
			}
		);
		$urls          = array(
			'file:///etc/passwd',
			'https://user:password@example.test/image.png',
		);

		foreach ( $urls as $url ) {
			$result = $download->download( $url, 1024 );
			$this->assertWPError( $result );
			$this->assertSame( 'easymde_image_hosting_import_invalid_url', $result->get_error_code() );
		}
		$this->assertSame( 0, $resolve_calls );
		$this->assertCount( 0, $client->requests );
	}

	public function test_download_rejects_direct_private_addresses_without_requesting() {
		$urls = array(
			'http://127.0.0.1/image.png',
			'http://169.254.169.254/latest/meta-data',
		);

		foreach ( $urls as $url ) {
			$client   = new RemoteImageDownloaderFakePinnedClient();
			$download = new RemoteImageDownloader(
				$client,
				static function ( $host ) {
					return array( $host );
				}
			);
			$result   = $download->download( $url, 1024 );

			$this->assertWPError( $result );
			$this->assertSame( 'easymde_image_hosting_import_invalid_url', $result->get_error_code() );
			$this->assertCount( 0, $client->requests );
		}
	}

	public function test_download_rejects_redirects_empty_oversized_and_non_image_responses_and_cleans_every_temp_file() {
		$cases = array(
			array( 302, '', 'easymde_image_hosting_import_download_failed', 502 ),
			array( 200, '', 'easymde_image_hosting_import_empty_file', 422 ),
			array( 200, str_repeat( 'x', 1025 ), 'easymde_image_hosting_import_file_too_large', 413 ),
			array( 200, 'not-an-image', 'easymde_image_hosting_import_unsupported_media_type', 415 ),
		);

		foreach ( $cases as $case ) {
			$client         = new RemoteImageDownloaderFakePinnedClient( $case[1] );
			$client->status = $case[0];
			$download       = new RemoteImageDownloader(
				$client,
				static function () {
					return array( '8.8.8.8' );
				}
			);

			$result = $download->download( 'https://8.8.8.8/image.png', 1024 );
			$path   = $client->requests[0][1]['filename'];

			$this->assertWPError( $result );
			$this->assertSame( $case[2], $result->get_error_code() );
			$this->assertSame( $case[3], $result->get_error_data()['status'] );
			$this->assertFalse( is_file( $path ) );
		}
	}

	public function test_download_redacts_transport_errors_and_cleans_the_temp_file() {
		$client        = new RemoteImageDownloaderFakePinnedClient();
		$client->error = new WP_Error( 'http_request_failed', 'Synthetic private upstream detail.' );
		$download      = new RemoteImageDownloader(
			$client,
			static function () {
				return array( '8.8.8.8' );
			}
		);

		$result = $download->download( 'https://8.8.8.8/image.png', 1024 );
		$path   = $client->requests[0][1]['filename'];

		$this->assertWPError( $result );
		$this->assertSame( 'easymde_image_hosting_import_download_failed', $result->get_error_code() );
		$this->assertStringNotContainsString( 'Synthetic private upstream detail', $result->get_error_message() );
		$this->assertFalse( is_file( $path ) );
	}
}
