<?php

namespace EasyMDE\ImageHosting;

use Qiniu\Auth;
use Qiniu\Config;
use Qiniu\Http\Client;
use Qiniu\Http\Request;
use Qiniu\Http\RequestOptions;
use Qiniu\Http\Response as QiniuResponse;
use Qiniu\Region;
use Throwable;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class QiniuKodoProvider {

	const PROVIDER_ID      = 'qiniu-kodo';
	const TOKEN_LIFETIME   = 3600;
	const REGION_HOST      = 'https://uc.qiniuapi.com';
	const MAX_UPLOAD_HOSTS = 4;

	private $transport;
	private $access_key;
	private $secret_key;
	private $bucket_name;
	private $public_base_url;
	private $diagnostic_context = array();

	public function __construct(
		HttpTransport $transport,
		$access_key,
		$secret_key,
		$bucket_name,
		$public_base_url
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
		$this->public_base_url = '' === $public_base_url ? '' : ImageHostProviderSupport::normalize_public_base_url( $public_base_url );
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
		try {
			$sdk_available = $this->sdk_available();
		} catch ( Throwable $throwable ) {
			return $this->failure( 'qiniu_sdk_unavailable', 'sdk', 'unavailable', null, $operation_id, $started_at );
		}
		if ( ! $sdk_available ) {
			return $this->failure( 'qiniu_sdk_unavailable', 'sdk', 'unavailable', null, $operation_id, $started_at );
		}

		try {
			$region_result = $this->discover_region();
			if ( ! $region_result['ok'] ) {
				return $this->failure(
					'qiniu_region_discovery_failed',
					'discovery',
					$region_result['category'],
					$region_result['status'],
					$operation_id,
					$started_at
				);
			}

			$auth  = new Auth( $this->access_key, $this->secret_key );
			$token = $auth->uploadToken( $this->bucket_name, $object_key, self::TOKEN_LIFETIME );
			if ( ! is_string( $token ) || '' === $token ) {
				return $this->failure( 'qiniu_auth_failed', 'auth', 'token', null, $operation_id, $started_at );
			}

			$request_options = new RequestOptions(
				10,
				null,
				10,
				null,
				array( new QiniuSdkTransportMiddleware( $this->transport ) )
			);
			$body            = $this->multipart_body(
				array(
					'token' => $token,
					'key'   => $object_key,
					'crc32' => \Qiniu\crc32_data( $bytes ),
				),
				$bytes,
				$mime_type,
				$this->filename_for_mime( $mime_type )
			);
			$host_index      = min(
				max( 0, $this->diagnostic_context['attempt'] - 1 ),
				count( $region_result['hosts'] ) - 1
			);
			$upload_result   = $this->upload_to_host(
				$region_result['hosts'][ $host_index ],
				$body,
				$object_key,
				$request_options
			);
			if ( $upload_result['ok'] ) {
				$this->diagnostic( $operation_id, 'complete', 'success', 200, $started_at, 'success' );
				return ImageHostResult::uploaded(
					self::PROVIDER_ID,
					$object_key,
					ImageHostProviderSupport::public_url( $this->public_base_url, $object_key )
				);
			}

			return $this->failure(
				$upload_result['error_code'],
				$upload_result['stage'],
				$upload_result['category'],
				$upload_result['status'],
				$operation_id,
				$started_at
			);
		} catch ( Throwable $throwable ) {
			return $this->failure( 'qiniu_sdk_failure', 'sdk', 'exception', null, $operation_id, $started_at );
		}
	}

	private function upload_to_host( $host, array $body, $object_key, RequestOptions $request_options ) {
		$config = new Config( new Region( array( $host ), array( $host ) ) );
		// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Qiniu SDK public API.
		$config->useHTTPS = true;
		// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Qiniu SDK public API.
		$config->useCdnDomains           = false;
		list( $upload_url, $host_error ) = $config->getUpHostV2( $this->access_key, $this->bucket_name, $request_options );
		if ( null !== $host_error || ! $this->is_safe_upload_url( $upload_url ) ) {
			return $this->upload_failure( 'qiniu_region_discovery_failed', 'discovery', 'unsafe_host', null );
		}

		$request = new Request(
			'POST',
			$upload_url,
			array( 'Content-Type' => 'multipart/form-data; boundary=' . $body['boundary'] ),
			$body['body'],
			$request_options
		);
		try {
			$response = Client::sendRequestWithMiddleware( $request );
		} catch ( Throwable $throwable ) {
			return $this->upload_failure( 'qiniu_transport_failure', 'transport', 'exception', null );
		}
		if ( ! $response instanceof QiniuResponse ) {
			return $this->upload_failure( 'qiniu_transport_failure', 'transport', 'response_type', null );
		}
		// phpcs:ignore WordPress.NamingConventions.ValidVariableName.UsedPropertyNotSnakeCase -- Qiniu SDK response field.
		$status_code = (int) $response->statusCode;
		if ( 0 === $status_code ) {
			if ( 'timeout' === $response->error ) {
				return $this->upload_failure( 'image_host_timeout', 'transport', 'timeout', null );
			}
			if ( 'response_too_large' === $response->error ) {
				return $this->upload_failure( 'qiniu_response_too_large', 'transport', 'response_too_large', null );
			}
			return $this->upload_failure( 'qiniu_transport_failure', 'transport', 'transport', null );
		}
		if ( 200 !== $status_code ) {
			return $this->upload_failure(
				$this->upload_rejection_code( $status_code ),
				'response',
				'status',
				$status_code
			);
		}
		if ( null !== $response->error ) {
			return $this->upload_failure( 'qiniu_invalid_response', 'response', 'parser', 200 );
		}

		$payload = $response->json();
		if (
			! is_array( $payload ) ||
			! isset( $payload['key'] ) ||
			! is_string( $payload['key'] ) ||
			$object_key !== $payload['key']
		) {
			return $this->upload_failure( 'qiniu_invalid_response', 'response', 'key', 200 );
		}

		return array(
			'ok'         => true,
			'error_code' => '',
			'stage'      => 'complete',
			'category'   => 'success',
			'status'     => 200,
		);
	}

	private function sdk_available() {
		return extension_loaded( 'curl' ) &&
			extension_loaded( 'xml' ) &&
			extension_loaded( 'json' ) &&
		class_exists( 'Qiniu\\Auth' ) &&
		class_exists( 'Qiniu\\Config' ) &&
		class_exists( 'Qiniu\\Region' ) &&
		class_exists( 'Qiniu\\Http\\Client' ) &&
		class_exists( 'Qiniu\\Http\\Request' ) &&
		class_exists( 'Qiniu\\Http\\RequestOptions' ) &&
		class_exists( 'Qiniu\\Http\\Response' ) &&
		function_exists( 'Qiniu\\crc32_data' );
	}

	private function discover_region() {
		$query = self::REGION_HOST . '/v4/query?ak=' . rawurlencode( $this->access_key ) . '&bucket=' . rawurlencode( $this->bucket_name );
		try {
			$response = $this->transport->request(
				'GET',
				$query,
				ImageHostProviderSupport::request_arguments( array() )
			);
		} catch ( Throwable $throwable ) {
			return array(
				'ok'       => false,
				'category' => 'transport',
				'status'   => null,
			);
		}

		if ( ! $response instanceof HttpResponse || ! $response->is_success() ) {
			return array(
				'ok'       => false,
				'category' => 'transport',
				'status'   => $response instanceof HttpResponse ? $response->get_status_code() : null,
			);
		}
		if ( strlen( $response->get_body() ) > ImageHostProviderSupport::MAX_RESPONSE_BYTES ) {
			return array(
				'ok'       => false,
				'category' => 'response_too_large',
				'status'   => $response->get_status_code(),
			);
		}
		if ( 200 !== $response->get_status_code() ) {
			return array(
				'ok'       => false,
				'category' => 'status',
				'status'   => $response->get_status_code(),
			);
		}

		$parsed  = new QiniuResponse(
			$response->get_status_code(),
			0,
			$response->get_headers(),
			$response->get_body(),
			null
		);
		$payload = $parsed->json();
		if ( null !== $parsed->error || ! is_array( $payload ) ) {
			return array(
				'ok'       => false,
				'category' => 'parser',
				'status'   => 200,
			);
		}

		$domains = isset( $payload['hosts'][0]['up']['domains'] ) && is_array( $payload['hosts'][0]['up']['domains'] )
			? $payload['hosts'][0]['up']['domains']
			: array();
		if ( empty( $domains ) ) {
			return array(
				'ok'       => false,
				'category' => 'unsafe_host',
				'status'   => 200,
			);
		}

		$source_hosts   = array();
		$fallback_hosts = array();
		foreach ( $domains as $host ) {
			if ( ! is_string( $host ) || ! $this->is_official_upload_host( $host ) ) {
				return array(
					'ok'       => false,
					'category' => 'unsafe_host',
					'status'   => 200,
				);
			}

			$host = strtolower( $host );
			if ( in_array( $host, $source_hosts, true ) || in_array( $host, $fallback_hosts, true ) ) {
				continue;
			}
			if ( $this->is_source_upload_host( $host ) ) {
				$source_hosts[] = $host;
			} else {
				$fallback_hosts[] = $host;
			}
		}

		$hosts = array_slice( array_merge( $source_hosts, $fallback_hosts ), 0, self::MAX_UPLOAD_HOSTS );
		if ( empty( $hosts ) ) {
			return array(
				'ok'       => false,
				'category' => 'unsafe_host',
				'status'   => 200,
			);
		}

		return array(
			'ok'    => true,
			'hosts' => $hosts,
		);
	}

	private function is_official_upload_host( $host ) {
		if ( ! is_string( $host ) || strlen( $host ) > 253 || '' === $host || false !== strpos( $host, '.' . "\0" ) ) {
			return false;
		}
		$labels = explode( '.', strtolower( $host ) );
		if ( 3 !== count( $labels ) || 'qiniup' !== $labels[1] || 'com' !== $labels[2] ) {
			return false;
		}
		$first_label = $labels[0];
		if (
			'up' !== $first_label &&
			'upload' !== $first_label &&
			0 !== strpos( $first_label, 'up-' ) &&
			0 !== strpos( $first_label, 'upload-' )
		) {
			return false;
		}
		foreach ( $labels as $label ) {
			if ( 1 !== preg_match( '/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/', $label ) ) {
				return false;
			}
		}

		return true;
	}

	private function is_source_upload_host( $host ) {
		$first_label = explode( '.', strtolower( $host ), 2 )[0];

		return 'up' === $first_label || 0 === strpos( $first_label, 'up-' );
	}

	private function is_safe_upload_url( $url ) {
		$parts = wp_parse_url( (string) $url );
		return is_array( $parts ) &&
			isset( $parts['scheme'], $parts['host'] ) &&
			'https' === strtolower( $parts['scheme'] ) &&
			! isset( $parts['user'], $parts['pass'], $parts['port'], $parts['query'], $parts['fragment'], $parts['path'] ) &&
			$this->is_official_upload_host( $parts['host'] );
	}

	private function multipart_body( array $fields, $bytes, $mime_type, $filename ) {
		$boundary = '----EasyMDE' . bin2hex( random_bytes( 12 ) );
		$lines    = array();
		foreach ( $fields as $name => $value ) {
			$lines[] = '--' . $boundary;
			$lines[] = 'Content-Disposition: form-data; name="' . $name . '"';
			$lines[] = '';
			$lines[] = $value;
		}
		$lines[] = '--' . $boundary;
		$lines[] = 'Content-Disposition: form-data; name="file"; filename="' . $filename . '"';
		$lines[] = 'Content-Type: ' . $mime_type;
		$lines[] = '';
		$lines[] = $bytes;
		$lines[] = '--' . $boundary . '--';
		$lines[] = '';

		return array(
			'boundary' => $boundary,
			'body'     => implode( "\r\n", $lines ),
		);
	}

	private function filename_for_mime( $mime_type ) {
		$extensions = array(
			'image/gif'  => 'gif',
			'image/jpeg' => 'jpg',
			'image/png'  => 'png',
			'image/webp' => 'webp',
		);

		return 'easymde-upload.' . $extensions[ $mime_type ];
	}

	private function upload_failure( $error_code, $stage, $category, $status ) {
		return array(
			'ok'         => false,
			'error_code' => $error_code,
			'stage'      => $stage,
			'category'   => $category,
			'status'     => is_int( $status ) ? $status : null,
		);
	}

	private function upload_rejection_code( $status_code ) {
		if ( in_array( (int) $status_code, array( 401, 403 ), true ) ) {
			return 'image_host_unauthorized';
		}
		if ( 404 === (int) $status_code ) {
			return 'image_host_bucket_not_found';
		}

		return 'qiniu_upload_rejected';
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

	private function failure( $error_code, $stage, $category, $status, $operation_id, $started_at ) {
		$this->diagnostic( $operation_id, $stage, $category, $status, $started_at, 'failure' );
		return ImageHostResult::failed( self::PROVIDER_ID, $error_code );
	}

	private function diagnostic( $operation_id, $stage, $category, $status, $started_at, $result ) {
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
				'duration_ms'   => max( 0, (int) round( ( microtime( true ) - $started_at ) * 1000 ) ),
				'result'        => (string) $result,
			)
		);
	}
}
