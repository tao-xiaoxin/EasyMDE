<?php

namespace EasyMDE\ImageHosting;

use DateTimeImmutable;
use DateTimeZone;
use Throwable;

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
	private $diagnostic_context = array();

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

	public function upload( $bytes, $mime_type, $object_key, $context = array() ) {
		$started_at               = microtime( true );
		$this->diagnostic_context = $this->normalize_diagnostic_context( $context );
		$operation_id             = $this->diagnostic_context['operation_id'];

		if ( '' === $this->public_base_url ) {
			return $this->failure( 'image_host_invalid_public_url', 'validation', 'configuration', null, $operation_id, $started_at );
		}
		$input_error = ImageHostProviderSupport::validate_upload( $bytes, $mime_type, $object_key );
		if ( '' !== $input_error ) {
			return $this->failure( $input_error, 'validation', 'input', null, $operation_id, $started_at );
		}

		$path = '/' . rawurlencode( $this->bucket_name ) . '/' . ImageHostProviderSupport::encode_object_key( $object_key );
		try {
			$response = $this->send_signed_request( 'PUT', $path, $bytes, $mime_type );
		} catch ( Throwable $throwable ) {
			return $this->failure( 'image_host_transport_failure', 'transport', 'exception', null, $operation_id, $started_at );
		}

		if ( ! $response->is_success() ) {
			return $this->failure(
				ImageHostProviderSupport::response_error_code( $response, 'r2_upload_rejected' ),
				'transport',
				$response->get_transport_category(),
				null,
				$operation_id,
				$started_at,
				$response->get_transport_errno(),
				$response->is_cancelled()
			);
		}

		$status_code = (int) $response->get_status_code();
		if ( ! $this->is_success_status( $status_code ) ) {
			return $this->failure(
				ImageHostProviderSupport::response_error_code( $response, 'r2_upload_rejected' ),
				'response',
				'status',
				$status_code,
				$operation_id,
				$started_at
			);
		}

		$this->diagnostic( $operation_id, 'complete', 'success', $status_code, $started_at, 'success' );

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

	/**
	 * Record one privacy-safe operation outcome.
	 *
	 * The payload mirrors the shared image-hosting diagnostic contract and adds
	 * the R2 transport numbers: status (HTTP status or null), errno (numeric
	 * cURL errno or null), and cancelled. It never contains URLs, credentials,
	 * signatures, headers, object keys, or response bodies.
	 *
	 * @param string   $operation_id   Stable per-operation identifier.
	 * @param string   $stage          Stable stage name.
	 * @param string   $category       Stable category from a closed vocabulary.
	 * @param int|null $status         Numeric HTTP status when the remote server answered.
	 * @param float    $started_at     Operation start timestamp.
	 * @param string   $result         'success' or 'failure'.
	 * @param int|null $transport_errno Numeric cURL errno when the transport exposed one.
	 * @param bool     $cancelled      Whether the transport observed an aborted request.
	 */
	private function diagnostic( $operation_id, $stage, $category, $status, $started_at, $result, $transport_errno = null, $cancelled = false ) {
		if ( ! function_exists( 'do_action' ) ) {
			return;
		}

		do_action(
			'easymde_image_hosting_diagnostic',
			array(
				'operation_id'  => (string) $operation_id,
				'provider'      => self::PROVIDER_ID,
				'role'          => $this->diagnostic_context['role'],
				'stage'         => (string) $stage,
				'attempt'       => $this->diagnostic_context['attempt'],
				'attempt_limit' => $this->diagnostic_context['attempt_limit'],
				'category'      => (string) $category,
				'status'        => is_int( $status ) ? $status : null,
				'errno'         => is_int( $transport_errno ) ? $transport_errno : null,
				'duration_ms'   => max( 0, (int) round( ( microtime( true ) - $started_at ) * 1000 ) ),
				'cancelled'     => (bool) $cancelled || $this->client_aborted(),
				'result'        => (string) $result,
			)
		);
	}

	private function failure( $error_code, $stage, $category, $status, $operation_id, $started_at, $transport_errno = null, $cancelled = false ) {
		$this->diagnostic( $operation_id, $stage, $category, $status, $started_at, 'failure', $transport_errno, $cancelled );

		return ImageHostResult::failed( self::PROVIDER_ID, $error_code );
	}

	/**
	 * Whether the REST client had already given up when this record was written.
	 *
	 * PHP only observes a disconnect after an I/O attempt, so this is a
	 * best-effort cancellation signal for diagnostics and never control flow.
	 */
	private function client_aborted() {
		return function_exists( 'connection_aborted' ) && connection_aborted();
	}

	private function normalize_diagnostic_context( $context ) {
		$operation_id = is_array( $context ) && isset( $context['operation_id'] ) && is_string( $context['operation_id'] )
			? $context['operation_id']
			: '';
		if ( 1 !== preg_match( '/^[A-Za-z0-9_-]{1,64}$/D', $operation_id ) ) {
			$operation_id = function_exists( 'wp_generate_uuid4' ) ? wp_generate_uuid4() : substr( hash( 'sha256', uniqid( '', true ) ), 0, 16 );
		}

		$role = is_array( $context ) && isset( $context['role'] ) && is_string( $context['role'] )
			? strtolower( $context['role'] )
			: 'unknown';
		if ( 1 !== preg_match( '/^[a-z0-9_-]{1,32}$/D', $role ) ) {
			$role = 'unknown';
		}

		$attempt_limit = is_array( $context ) && isset( $context['attempt_limit'] ) ? (int) $context['attempt_limit'] : 1;
		$attempt_limit = max( 1, min( 6, $attempt_limit ) );
		$attempt       = is_array( $context ) && isset( $context['attempt'] ) ? (int) $context['attempt'] : 1;
		$attempt       = max( 1, min( $attempt_limit, $attempt ) );

		return array(
			'operation_id'  => $operation_id,
			'role'          => $role,
			'attempt'       => $attempt,
			'attempt_limit' => $attempt_limit,
		);
	}
}
