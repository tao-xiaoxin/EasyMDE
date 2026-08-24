<?php

namespace EasyMDE\ImageHosting;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class ImageHostProviderSupport {

	const MAX_IMAGE_BYTES    = 10485760;
	const MAX_RESPONSE_BYTES = 65536;

	const ALLOWED_MIME_TYPES = array(
		'image/gif',
		'image/jpeg',
		'image/png',
		'image/webp',
	);

	private function __construct() {}

	public static function validate_identifier( $value ) {
		return is_string( $value ) && 1 === preg_match( '/^[A-Za-z0-9][A-Za-z0-9._-]{1,127}$/', $value );
	}

	public static function validate_credential( $value ) {
		return is_string( $value ) && '' !== $value && strlen( $value ) <= 2048 && 0 === preg_match( '/[\x00-\x1F\x7F]/', $value );
	}

	public static function validate_r2_endpoint( $value ) {
		return is_string( $value ) && 1 === preg_match(
			'#^https://[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.(?:eu|us|fedramp))?\.r2\.cloudflarestorage\.com$#D',
			strtolower( $value )
		);
	}

	public static function validate_oss_endpoint( $value ) {
		return '' !== self::region_from_oss_endpoint( $value );
	}

	public static function validate_cos_endpoint( $value ) {
		return '' !== self::region_from_cos_endpoint( $value );
	}

	public static function region_from_oss_endpoint( $value ) {
		$region = self::region_from_endpoint(
			$value,
			'#^https://oss-([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.aliyuncs\.com$#D'
		);

		return '-internal' === substr( $region, -9 ) ? substr( $region, 0, -9 ) : $region;
	}

	public static function destination_endpoint_identity( $service, $value ) {
		if ( 'aliyun-oss' === $service ) {
			return self::region_from_oss_endpoint( $value );
		}

		if ( 'tencent-cos' === $service ) {
			return self::region_from_cos_endpoint( $value );
		}

		return 'cloudflare-r2' === $service && self::validate_r2_endpoint( $value )
			? strtolower( $value )
			: '';
	}

	public static function region_from_cos_endpoint( $value ) {
		return self::region_from_endpoint(
			$value,
			'#^https://cos\.([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.myqcloud\.com$#D'
		);
	}

	public static function validate_provider_endpoint( $service, $value ) {
		if ( 'cloudflare-r2' === $service ) {
			return self::validate_r2_endpoint( $value );
		}
		if ( 'aliyun-oss' === $service ) {
			return self::validate_oss_endpoint( $value );
		}
		if ( 'tencent-cos' === $service ) {
			return self::validate_cos_endpoint( $value );
		}

		return 'qiniu-kodo' === $service && '' === $value;
	}

	private static function region_from_endpoint( $value, $pattern ) {
		if ( ! is_string( $value ) || 1 !== preg_match( $pattern, strtolower( $value ), $matches ) ) {
			return '';
		}

		return $matches[1];
	}

	public static function normalize_public_base_url( $url ) {
		$url       = (string) $url;
		$parts     = wp_parse_url( $url );
		$sanitized = esc_url_raw( $url, array( 'http', 'https' ) );

		if (
			! is_array( $parts ) ||
			! in_array( strtolower( isset( $parts['scheme'] ) ? $parts['scheme'] : '' ), array( 'http', 'https' ), true ) ||
			empty( $parts['host'] ) ||
			isset( $parts['user'] ) ||
			isset( $parts['pass'] ) ||
			isset( $parts['port'] ) ||
			isset( $parts['query'] ) ||
			isset( $parts['fragment'] ) ||
			( isset( $parts['path'] ) && '' !== $parts['path'] && '/' !== $parts['path'] ) ||
			$sanitized !== $url
		) {
			throw new ImageHostException( 'image_host_invalid_public_url' );
		}

		return isset( $parts['path'] ) && '/' === $parts['path'] ? substr( $url, 0, -1 ) : $url;
	}

	public static function validate_upload( $bytes, $mime_type, $object_key ) {
		if ( ! is_string( $bytes ) || '' === $bytes ) {
			return 'image_host_empty_file';
		}

		if ( strlen( $bytes ) > self::MAX_IMAGE_BYTES ) {
			return 'image_host_file_too_large';
		}

		if ( ! in_array( $mime_type, self::ALLOWED_MIME_TYPES, true ) ) {
			return 'image_host_unsupported_mime';
		}

		if ( ! self::is_valid_object_key( $object_key ) ) {
			return 'image_host_invalid_object_key';
		}

		return '';
	}

	public static function is_valid_object_key( $object_key ) {
		if ( ! is_string( $object_key ) || '' === $object_key || strlen( $object_key ) > 1024 ) {
			return false;
		}

		if ( '/' === $object_key[0] || false !== strpos( $object_key, '\\' ) ) {
			return false;
		}

		if ( 1 !== preg_match( '/^[\p{L}\p{N}._\/-]+$/u', $object_key ) ) {
			return false;
		}

		foreach ( explode( '/', $object_key ) as $segment ) {
			if ( '' === $segment || '.' === $segment || '..' === $segment ) {
				return false;
			}
		}

		return true;
	}

	public static function encode_object_key( $object_key ) {
		return implode( '/', array_map( 'rawurlencode', explode( '/', $object_key ) ) );
	}

	public static function public_url( $base_url, $object_key ) {
		return rtrim( $base_url, '/' ) . '/' . self::encode_object_key( $object_key );
	}

	public static function request_arguments( array $headers, $body = '' ) {
		return array(
			'body'                => $body,
			'headers'             => $headers,
			'timeout'             => 10,
			'redirection'         => 0,
			'sslverify'           => true,
			'reject_unsafe_urls'  => true,
			'limit_response_size' => self::MAX_RESPONSE_BYTES,
		);
	}

	public static function response_error_code( HttpResponse $response, $rejected_code ) {
		if ( ! $response->is_success() ) {
			return 'timeout' === $response->get_error_code()
				? 'image_host_timeout'
				: 'image_host_transport_failure';
		}

		$status_code = $response->get_status_code();
		if ( 401 === $status_code || 403 === $status_code ) {
			return 'image_host_unauthorized';
		}

		if ( 404 === $status_code ) {
			return 'image_host_bucket_not_found';
		}

		return $rejected_code;
	}
}
