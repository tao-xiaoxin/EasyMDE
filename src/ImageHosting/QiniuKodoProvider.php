<?php

namespace EasyMDE\ImageHosting;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class QiniuKodoProvider {

	const PROVIDER_ID    = 'qiniu-kodo';
	const UPLOAD_URL     = 'https://upload.qiniup.com';
	const BUCKETS_URL    = 'https://rs.qbox.me/buckets';
	const TOKEN_LIFETIME = 3600;

	private $transport;
	private $access_key;
	private $secret_key;
	private $bucket_name;
	private $public_base_url;
	private $clock;

	public function __construct(
		HttpTransport $transport,
		$access_key,
		$secret_key,
		$bucket_name,
		$public_base_url,
		?callable $clock = null
	) {
		if (
			! ImageHostProviderSupport::validate_identifier( $bucket_name ) ||
			! ImageHostProviderSupport::validate_credential( $access_key ) ||
			! ImageHostProviderSupport::validate_credential( $secret_key )
		) {
			throw new ImageHostException( 'image_host_invalid_configuration' );
		}

		$this->transport       = $transport;
		$this->access_key      = $access_key;
		$this->secret_key      = $secret_key;
		$this->bucket_name     = $bucket_name;
		$this->public_base_url = ImageHostProviderSupport::normalize_public_base_url( $public_base_url );
		$this->clock           = null === $clock ? 'time' : $clock;
	}

	public function upload( $bytes, $mime_type, $object_key ) {
		$input_error = ImageHostProviderSupport::validate_upload( $bytes, $mime_type, $object_key );
		if ( '' !== $input_error ) {
			return ImageHostResult::failed( self::PROVIDER_ID, $input_error );
		}

		$timestamp = (int) call_user_func( $this->clock );
		if ( $timestamp <= 0 ) {
			return ImageHostResult::failed( self::PROVIDER_ID, 'image_host_clock_failure' );
		}

		$token    = $this->create_upload_token( $object_key, $timestamp + self::TOKEN_LIFETIME );
		$boundary = $this->create_boundary( $object_key, $bytes );
		$body     = $this->create_multipart_body( $boundary, $token, $object_key, $mime_type, $bytes );
		$response = $this->transport->request(
			'POST',
			self::UPLOAD_URL,
			ImageHostProviderSupport::request_arguments(
				array(
					'Content-Type'   => 'multipart/form-data; boundary=' . $boundary,
					'Content-Length' => strlen( $body ),
				),
				$body
			)
		);

		if ( ! $response->is_success() || 200 !== $response->get_status_code() ) {
			return ImageHostResult::failed(
				self::PROVIDER_ID,
				ImageHostProviderSupport::response_error_code( $response, 'qiniu_upload_rejected' )
			);
		}

		$payload = json_decode( $response->get_body(), true );
		if ( ! is_array( $payload ) || ! isset( $payload['key'] ) || $object_key !== $payload['key'] ) {
			return ImageHostResult::failed( self::PROVIDER_ID, 'qiniu_invalid_response' );
		}

		return ImageHostResult::uploaded(
			self::PROVIDER_ID,
			$object_key,
			ImageHostProviderSupport::public_url( $this->public_base_url, $object_key )
		);
	}

	public function probe() {
		$authorization = 'QBox ' . $this->access_key . ':' . $this->url_safe_base64(
			hash_hmac( 'sha1', "/buckets\n", $this->secret_key, true )
		);
		$response      = $this->transport->request(
			'GET',
			self::BUCKETS_URL,
			ImageHostProviderSupport::request_arguments(
				array( 'Authorization' => $authorization )
			)
		);

		if ( ! $response->is_success() || 200 !== $response->get_status_code() ) {
			return ImageHostResult::failed(
				self::PROVIDER_ID,
				ImageHostProviderSupport::response_error_code( $response, 'qiniu_probe_rejected' )
			);
		}

		$buckets = json_decode( $response->get_body(), true );
		if ( ! is_array( $buckets ) || ! in_array( $this->bucket_name, $buckets, true ) ) {
			return ImageHostResult::failed( self::PROVIDER_ID, 'image_host_bucket_not_found' );
		}

		return ImageHostResult::connected( self::PROVIDER_ID );
	}

	private function create_upload_token( $object_key, $deadline ) {
		$policy         = wp_json_encode(
			array(
				'scope'    => $this->bucket_name . ':' . $object_key,
				'deadline' => (int) $deadline,
			),
			JSON_UNESCAPED_SLASHES
		);
		$encoded_policy = $this->url_safe_base64( $policy );
		$encoded_sign   = $this->url_safe_base64(
			hash_hmac( 'sha1', $encoded_policy, $this->secret_key, true )
		);

		return $this->access_key . ':' . $encoded_sign . ':' . $encoded_policy;
	}

	private function url_safe_base64( $value ) {
		// Qiniu's signing protocol requires standard Base64 with URL-safe symbols.
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode
		return str_replace( array( '+', '/' ), array( '-', '_' ), base64_encode( $value ) );
	}

	private function create_boundary( $object_key, $bytes ) {
		$seed     = hash( 'sha256', $object_key . "\0" . $bytes );
		$boundary = '----EasyMDE' . substr( $seed, 0, 24 );

		while ( false !== strpos( $bytes, $boundary ) ) {
			$seed     = hash( 'sha256', $seed );
			$boundary = '----EasyMDE' . substr( $seed, 0, 24 );
		}

		return $boundary;
	}

	private function create_multipart_body( $boundary, $token, $object_key, $mime_type, $bytes ) {
		$line_break = "\r\n";
		$body       = '--' . $boundary . $line_break .
			'Content-Disposition: form-data; name="token"' . $line_break . $line_break .
			$token . $line_break .
			'--' . $boundary . $line_break .
			'Content-Disposition: form-data; name="key"' . $line_break . $line_break .
			$object_key . $line_break .
			'--' . $boundary . $line_break .
			'Content-Disposition: form-data; name="file"; filename="upload"' . $line_break .
			'Content-Type: ' . $mime_type . $line_break . $line_break .
			$bytes . $line_break .
			'--' . $boundary . '--' . $line_break;

		return $body;
	}
}
