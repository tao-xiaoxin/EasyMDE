<?php

namespace EasyMDE\ImageHosting;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Builds a credential-free identity for one physical image-host destination.
 */
final class ImageHostDestinationIdentity {

	private function __construct() {}

	public static function from_config( array $config ) {
		$service = isset( $config['service'] ) ? strtolower( trim( (string) $config['service'] ) ) : '';
		$bucket  = isset( $config['bucket'] ) ? strtolower( trim( (string) $config['bucket'] ) ) : '';
		if ( '' === $bucket ) {
			return '';
		}

		if ( in_array( $service, array( 'cloudflare-r2', 'aliyun-oss', 'tencent-cos' ), true ) ) {
			$endpoint = isset( $config['endpoint'] ) ? strtolower( rtrim( trim( (string) $config['endpoint'] ), '/' ) ) : '';
			$endpoint = ImageHostProviderSupport::destination_endpoint_identity( $service, $endpoint );

			return '' === $endpoint ? '' : $service . '|' . $endpoint . '|' . $bucket;
		}

		if ( 'qiniu-kodo' === $service ) {
			return $service . '|' . $bucket;
		}

		return '';
	}

	public static function are_same( array $primary, array $backup ) {
		$primary_identity = self::from_config( $primary );

		return '' !== $primary_identity && self::from_config( $backup ) === $primary_identity;
	}
}
