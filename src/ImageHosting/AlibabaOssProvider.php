<?php

namespace EasyMDE\ImageHosting;

use DateTimeImmutable;
use DateTimeZone;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class AlibabaOssProvider {

	const PROVIDER_ID = 'aliyun-oss';

	private $transport;
	private $endpoint_host;
	private $region;
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
			! ImageHostProviderSupport::validate_oss_endpoint( $endpoint ) ||
			! $this->is_valid_bucket_name( $bucket_name ) ||
			! ImageHostProviderSupport::validate_credential( $access_key_id ) ||
			! ImageHostProviderSupport::validate_credential( $secret_access_key )
		) {
			throw new ImageHostException( 'image_host_invalid_configuration' );
		}

		$this->transport         = $transport;
		$this->endpoint_host     = substr( strtolower( $endpoint ), 8 );
		$this->region            = ImageHostProviderSupport::region_from_oss_endpoint( $endpoint );
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

		$response = $this->send_signed_request( 'PUT', $object_key, array(), $bytes, $mime_type );
		if ( ! $response->is_success() || ! $this->is_success_status( $response->get_status_code() ) ) {
			return ImageHostResult::failed(
				self::PROVIDER_ID,
				ImageHostProviderSupport::response_error_code( $response, 'aliyun_oss_upload_rejected' )
			);
		}

		return ImageHostResult::uploaded(
			self::PROVIDER_ID,
			$object_key,
			ImageHostProviderSupport::public_url( $this->public_base_url, $object_key )
		);
	}

	private function send_signed_request( $method, $object_key, array $query, $body, $mime_type ) {
		$now = call_user_func( $this->clock );
		if ( ! $now instanceof DateTimeImmutable ) {
			return HttpResponse::failure( 'transport_failure' );
		}

		$now            = $now->setTimezone( new DateTimeZone( 'UTC' ) );
		$host           = $this->bucket_name . '.' . $this->endpoint_host;
		$request_path   = '/' . ( '' === $object_key ? '' : ImageHostProviderSupport::encode_object_key( $object_key ) );
		$canonical_path = '/' . rawurlencode( $this->bucket_name ) . $request_path;
		$query_string   = $this->canonical_query( $query );
		$oss_date       = $now->format( 'Ymd\THis\Z' );
		$date           = $now->format( 'Ymd' );
		$headers        = array(
			'Host'                 => $host,
			'Date'                 => $now->format( 'D, d M Y H:i:s \G\M\T' ),
			'x-oss-content-sha256' => 'UNSIGNED-PAYLOAD',
			'x-oss-date'           => $oss_date,
		);
		if ( '' !== $mime_type ) {
			$headers['Content-Type'] = $mime_type;
			$headers['Content-MD5']  = $this->content_md5( $body );
		}

		$headers['Authorization'] = $this->authorization_header(
			$method,
			$canonical_path,
			$query_string,
			$headers,
			$date,
			$oss_date
		);

		$url = 'https://' . $host . $request_path;
		return $this->transport->request(
			$method,
			$url,
			ImageHostProviderSupport::request_arguments( $headers, $body )
		);
	}

	private function authorization_header( $method, $path, $query, array $headers, $date, $oss_date ) {
		$canonical_headers = array();
		foreach ( $headers as $name => $value ) {
			$lower_name = strtolower( $name );
			if ( ! in_array( $lower_name, array( 'content-md5', 'content-type' ), true ) && 0 !== strpos( $lower_name, 'x-oss-' ) ) {
				continue;
			}
			$canonical_headers[ $lower_name ] = trim( preg_replace( '/\s+/', ' ', $value ) );
		}
		ksort( $canonical_headers );

		$canonical_header_text = '';
		foreach ( $canonical_headers as $name => $value ) {
			$canonical_header_text .= $name . ':' . $value . "\n";
		}

		$canonical_request = strtoupper( $method ) . "\n" .
			$path . "\n" .
			$query . "\n" .
			$canonical_header_text . "\n\n" .
			'UNSIGNED-PAYLOAD';
		$scope             = $date . '/' . $this->region . '/oss/aliyun_v4_request';
		$string_to_sign    = "OSS4-HMAC-SHA256\n" . $oss_date . "\n" . $scope . "\n" . hash( 'sha256', $canonical_request );
		$date_key          = hash_hmac( 'sha256', $date, 'aliyun_v4' . $this->secret_access_key, true );
		$region_key        = hash_hmac( 'sha256', $this->region, $date_key, true );
		$service_key       = hash_hmac( 'sha256', 'oss', $region_key, true );
		$signing_key       = hash_hmac( 'sha256', 'aliyun_v4_request', $service_key, true );
		$signature         = hash_hmac( 'sha256', $string_to_sign, $signing_key );

		return 'OSS4-HMAC-SHA256 Credential=' . $this->access_key_id . '/' . $scope . ',Signature=' . $signature;
	}

	private function canonical_query( array $query ) {
		ksort( $query );
		$parts = array();
		foreach ( $query as $name => $value ) {
			$part = rawurlencode( $name );
			if ( '' !== $value ) {
				$part .= '=' . rawurlencode( $value );
			}
			$parts[] = $part;
		}

		return implode( '&', $parts );
	}

	private function content_md5( $body ) {
		// The protocol requires the binary MD5 digest encoded as standard Base64.
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode
		return base64_encode( md5( $body, true ) );
	}

	private function is_valid_bucket_name( $bucket_name ) {
		return is_string( $bucket_name ) && 1 === preg_match( '/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/', $bucket_name );
	}

	private function is_success_status( $status_code ) {
		return $status_code >= 200 && $status_code < 300;
	}
}
