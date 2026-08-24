<?php

namespace EasyMDE\ImageHosting;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class TencentCosProvider {

	const PROVIDER_ID        = 'tencent-cos';
	const SIGNATURE_LIFETIME = 3600;

	private $transport;
	private $region;
	private $secret_id;
	private $secret_key;
	private $bucket_name;
	private $public_base_url;
	private $clock;

	public function __construct(
		HttpTransport $transport,
		$region,
		$secret_id,
		$secret_key,
		$bucket_name,
		$public_base_url,
		?callable $clock = null
	) {
		if (
			! $this->is_valid_region( $region ) ||
			! $this->is_valid_bucket_name( $bucket_name ) ||
			! ImageHostProviderSupport::validate_credential( $secret_id ) ||
			! ImageHostProviderSupport::validate_credential( $secret_key )
		) {
			throw new ImageHostException( 'image_host_invalid_configuration' );
		}

		$this->transport       = $transport;
		$this->region          = $region;
		$this->secret_id       = $secret_id;
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

		$response = $this->send_signed_request( 'PUT', $object_key, $bytes, $mime_type );
		if ( ! $response->is_success() || ! $this->is_success_status( $response->get_status_code() ) ) {
			return ImageHostResult::failed(
				self::PROVIDER_ID,
				ImageHostProviderSupport::response_error_code( $response, 'tencent_cos_upload_rejected' )
			);
		}

		return ImageHostResult::uploaded(
			self::PROVIDER_ID,
			$object_key,
			ImageHostProviderSupport::public_url( $this->public_base_url, $object_key )
		);
	}

	public function probe() {
		$response = $this->send_signed_request( 'HEAD', '', '', '' );
		if ( ! $response->is_success() || ! $this->is_success_status( $response->get_status_code() ) ) {
			return ImageHostResult::failed(
				self::PROVIDER_ID,
				ImageHostProviderSupport::response_error_code( $response, 'tencent_cos_probe_rejected' )
			);
		}

		return ImageHostResult::connected( self::PROVIDER_ID );
	}

	private function send_signed_request( $method, $object_key, $body, $mime_type ) {
		$timestamp = (int) call_user_func( $this->clock );
		if ( $timestamp <= 0 ) {
			return HttpResponse::failure( 'transport_failure' );
		}

		$host      = $this->bucket_name . '.cos.' . $this->region . '.myqcloud.com';
		$wire_path = '/' . ( '' === $object_key ? '' : ImageHostProviderSupport::encode_object_key( $object_key ) );
		$sign_path = '/' . $object_key;
		$headers   = array(
			'Host' => $host,
			'Date' => gmdate( 'D, d M Y H:i:s \G\M\T', $timestamp ),
		);
		if ( '' !== $mime_type ) {
			$headers['Content-Type'] = $mime_type;
			$headers['Content-MD5']  = $this->content_md5( $body );
		}

		$headers['Authorization'] = $this->authorization_header( $method, $sign_path, $headers, $timestamp );

		return $this->transport->request(
			$method,
			'https://' . $host . $wire_path,
			ImageHostProviderSupport::request_arguments( $headers, $body )
		);
	}

	private function authorization_header( $method, $path, array $headers, $timestamp ) {
		$key_time          = $timestamp . ';' . ( $timestamp + self::SIGNATURE_LIFETIME );
		$canonical_headers = array();
		foreach ( $headers as $name => $value ) {
			$lower_name = strtolower( $name );
			if ( ! in_array( $lower_name, array( 'content-md5', 'content-type', 'host' ), true ) ) {
				continue;
			}
			$canonical_headers[ $lower_name ] = $this->uri_encode( trim( preg_replace( '/\s+/', ' ', $value ) ) );
		}
		ksort( $canonical_headers );

		$header_list = implode( ';', array_keys( $canonical_headers ) );
		$header_text = array();
		foreach ( $canonical_headers as $name => $value ) {
			$header_text[] = $name . '=' . $value;
		}

		$http_string    = strtolower( $method ) . "\n" . $path . "\n\n" . implode( '&', $header_text ) . "\n";
		$string_to_sign = "sha1\n" . $key_time . "\n" . sha1( $http_string ) . "\n";
		$sign_key       = hash_hmac( 'sha1', $key_time, $this->secret_key );
		$signature      = hash_hmac( 'sha1', $string_to_sign, $sign_key );

		return 'q-sign-algorithm=sha1&q-ak=' . $this->secret_id .
			'&q-sign-time=' . $key_time .
			'&q-key-time=' . $key_time .
			'&q-header-list=' . $header_list .
			'&q-url-param-list=&q-signature=' . $signature;
	}

	private function uri_encode( $value ) {
		return rawurlencode( $value );
	}

	private function content_md5( $body ) {
		// The protocol requires the binary MD5 digest encoded as standard Base64.
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode
		return base64_encode( md5( $body, true ) );
	}

	private function is_valid_region( $region ) {
		return is_string( $region ) && 1 === preg_match( '/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/D', $region );
	}

	private function is_valid_bucket_name( $bucket_name ) {
		return is_string( $bucket_name ) && 1 === preg_match( '/^[a-z0-9][a-z0-9-]{0,49}-[0-9]{5,20}$/', $bucket_name );
	}

	private function is_success_status( $status_code ) {
		return $status_code >= 200 && $status_code < 300;
	}
}
