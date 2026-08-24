<?php

namespace EasyMDE\ImageHosting;

use DateTimeImmutable;
use DateTimeZone;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class CloudflareR2Provider {

	const PROVIDER_ID = 'cloudflare-r2';

	private $transport;
	private $endpoint;
	private $host;
	private $access_key_id;
	private $secret_access_key;
	private $bucket_name;
	private $public_base_url;
	private $clock;

	public function __construct(
		HttpTransport $transport,
		$endpoint,
		$access_key_id,
		$secret_access_key,
		$bucket_name,
		$public_base_url,
		?callable $clock = null
	) {
		if (
			! ImageHostProviderSupport::validate_r2_endpoint( $endpoint ) ||
			! ImageHostProviderSupport::validate_identifier( $bucket_name ) ||
			! ImageHostProviderSupport::validate_credential( $access_key_id ) ||
			! ImageHostProviderSupport::validate_credential( $secret_access_key )
		) {
			throw new ImageHostException( 'image_host_invalid_configuration' );
		}

		$this->transport         = $transport;
		$this->endpoint          = strtolower( rtrim( $endpoint, '/' ) );
		$this->host              = (string) wp_parse_url( $this->endpoint, PHP_URL_HOST );
		$this->access_key_id     = $access_key_id;
		$this->secret_access_key = $secret_access_key;
		$this->bucket_name       = $bucket_name;
		$this->public_base_url   = '' === $public_base_url ? '' : ImageHostProviderSupport::normalize_public_base_url( $public_base_url );
		$this->clock             = $clock;
		if ( null === $this->clock ) {
			$this->clock = static function () {
				return new DateTimeImmutable( 'now', new DateTimeZone( 'UTC' ) );
			};
		}
	}

	public function upload( $bytes, $mime_type, $object_key ) {
		if ( '' === $this->public_base_url ) {
			return ImageHostResult::failed( self::PROVIDER_ID, 'image_host_invalid_public_url' );
		}
		$input_error = ImageHostProviderSupport::validate_upload( $bytes, $mime_type, $object_key );
		if ( '' !== $input_error ) {
			return ImageHostResult::failed( self::PROVIDER_ID, $input_error );
		}

		$path     = '/' . rawurlencode( $this->bucket_name ) . '/' . ImageHostProviderSupport::encode_object_key( $object_key );
		$response = $this->send_signed_request( 'PUT', $path, $bytes, $mime_type );
		if ( ! $this->is_success_status( $response->get_status_code() ) || ! $response->is_success() ) {
			return ImageHostResult::failed(
				self::PROVIDER_ID,
				ImageHostProviderSupport::response_error_code( $response, 'r2_upload_rejected' )
			);
		}

		return ImageHostResult::uploaded(
			self::PROVIDER_ID,
			$object_key,
			ImageHostProviderSupport::public_url( $this->public_base_url, $object_key )
		);
	}

	private function send_signed_request( $method, $path, $body, $mime_type ) {
		$now = call_user_func( $this->clock );
		if ( ! $now instanceof DateTimeImmutable ) {
			return HttpResponse::failure( 'transport_failure' );
		}

		$now          = $now->setTimezone( new DateTimeZone( 'UTC' ) );
		$host         = $this->host;
		$payload_hash = hash( 'sha256', $body );
		$amz_date     = $now->format( 'Ymd\THis\Z' );
		$date         = $now->format( 'Ymd' );
		$headers      = array(
			'Host'                 => $host,
			'x-amz-content-sha256' => $payload_hash,
			'x-amz-date'           => $amz_date,
		);
		if ( '' !== $mime_type ) {
			$headers['Content-Type'] = $mime_type;
		}

		$headers['Authorization'] = $this->authorization_header(
			$method,
			$path,
			$headers,
			$payload_hash,
			$date,
			$amz_date
		);

		return $this->transport->request(
			$method,
			$this->endpoint . $path,
			ImageHostProviderSupport::request_arguments( $headers, $body )
		);
	}

	private function authorization_header( $method, $path, array $headers, $payload_hash, $date, $amz_date ) {
		$canonical_headers = array();
		foreach ( $headers as $name => $value ) {
			$canonical_headers[ strtolower( $name ) ] = trim( preg_replace( '/\s+/', ' ', $value ) );
		}
		ksort( $canonical_headers );

		$signed_headers        = implode( ';', array_keys( $canonical_headers ) );
		$canonical_header_text = '';
		foreach ( $canonical_headers as $name => $value ) {
			$canonical_header_text .= $name . ':' . $value . "\n";
		}

		$canonical_request = strtoupper( $method ) . "\n" .
			$path . "\n\n" .
			$canonical_header_text . "\n" .
			$signed_headers . "\n" .
			$payload_hash;
		$scope             = $date . '/auto/s3/aws4_request';
		$string_to_sign    = "AWS4-HMAC-SHA256\n" . $amz_date . "\n" . $scope . "\n" . hash( 'sha256', $canonical_request );
		$date_key          = hash_hmac( 'sha256', $date, 'AWS4' . $this->secret_access_key, true );
		$region_key        = hash_hmac( 'sha256', 'auto', $date_key, true );
		$service_key       = hash_hmac( 'sha256', 's3', $region_key, true );
		$signing_key       = hash_hmac( 'sha256', 'aws4_request', $service_key, true );
		$signature         = hash_hmac( 'sha256', $string_to_sign, $signing_key );

		return 'AWS4-HMAC-SHA256 Credential=' . $this->access_key_id . '/' . $scope .
			', SignedHeaders=' . $signed_headers . ', Signature=' . $signature;
	}

	private function is_success_status( $status_code ) {
		return $status_code >= 200 && $status_code < 300;
	}
}
