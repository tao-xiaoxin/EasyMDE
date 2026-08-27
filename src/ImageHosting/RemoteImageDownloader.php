<?php

namespace EasyMDE\ImageHosting;

use Throwable;
use WP_Error;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class RemoteImageDownloader {

	private $http_client;
	private $resolver;

	public function __construct( $http_client = null, ?callable $resolver = null ) {
		if ( null !== $http_client && ( ! is_object( $http_client ) || ! is_callable( array( $http_client, 'request' ) ) ) ) {
			throw new \InvalidArgumentException( 'The pinned HTTP client is invalid.' );
		}

		$this->http_client = null === $http_client ? new WordPressPinnedHttpClient() : $http_client;
		$this->resolver    = null === $resolver ? array( $this, 'resolve_host' ) : $resolver;
	}

	public function download( $url, $maximum_bytes ) {
		if ( ! $this->is_valid_url( $url ) ) {
			return $this->error( 'easymde_image_hosting_import_invalid_url', 400, __( 'The remote image URL is invalid.', 'easymde' ) );
		}
		if ( ! is_int( $maximum_bytes ) || $maximum_bytes <= 0 || $maximum_bytes > ImageHostProviderSupport::MAX_IMAGE_BYTES ) {
			return $this->error( 'easymde_image_hosting_import_download_failed', 502, __( 'The remote image could not be downloaded.', 'easymde' ) );
		}

		$parts     = wp_parse_url( $url );
		$host      = $parts['host'];
		$addresses = call_user_func( $this->resolver, $host );
		if ( is_wp_error( $addresses ) || ! $this->are_public_addresses( $addresses ) ) {
			return $this->error( 'easymde_image_hosting_import_invalid_url', 400, __( 'The remote image URL is invalid.', 'easymde' ) );
		}
		sort( $addresses, SORT_STRING );
		$port = isset( $parts['port'] ) ? (int) $parts['port'] : ( 'https' === strtolower( $parts['scheme'] ) ? 443 : 80 );

		if ( ! function_exists( 'wp_tempnam' ) ) {
			require_once ABSPATH . 'wp-admin/includes/file.php';
		}
		$temporary_path = wp_tempnam( 'easymde-remote-image' );
		if ( ! is_string( $temporary_path ) || '' === $temporary_path ) {
			return $this->error( 'easymde_image_hosting_import_download_failed', 502, __( 'The remote image could not be downloaded.', 'easymde' ) );
		}

		try {
			$response = $this->http_client->request(
				$url,
				array(
					'timeout'             => 10,
					'redirection'         => 0,
					'sslverify'           => true,
					'reject_unsafe_urls'  => true,
					'stream'              => true,
					'filename'            => $temporary_path,
					'limit_response_size' => $maximum_bytes + 1,
				),
				$host,
				$port,
				$addresses[0]
			);
		} catch ( Throwable $throwable ) {
			$this->delete_file( $temporary_path );

			return $this->error( 'easymde_image_hosting_import_download_failed', 502, __( 'The remote image could not be downloaded.', 'easymde' ) );
		}

		clearstatcache( true, $temporary_path );
		$size = is_file( $temporary_path ) ? filesize( $temporary_path ) : false;
		if ( false !== $size && $size > $maximum_bytes ) {
			$this->delete_file( $temporary_path );

			return $this->error( 'easymde_image_hosting_import_file_too_large', 413, __( 'The image is larger than the allowed upload size.', 'easymde' ) );
		}
		if ( is_wp_error( $response ) || 200 !== wp_remote_retrieve_response_code( $response ) ) {
			$this->delete_file( $temporary_path );

			return $this->error( 'easymde_image_hosting_import_download_failed', 502, __( 'The remote image could not be downloaded.', 'easymde' ) );
		}
		if ( false === $size || 0 === $size ) {
			$this->delete_file( $temporary_path );

			return $this->error( 'easymde_image_hosting_import_empty_file', 422, __( 'The remote image is empty.', 'easymde' ) );
		}

		$mime_type = wp_get_image_mime( $temporary_path );
		if ( ! is_string( $mime_type ) || ! in_array( $mime_type, ImageHostProviderSupport::ALLOWED_MIME_TYPES, true ) ) {
			$this->delete_file( $temporary_path );

			return $this->error( 'easymde_image_hosting_import_unsupported_media_type', 415, __( 'This image format is not allowed by the current EasyMDE settings.', 'easymde' ) );
		}

		return array(
			'name'     => $this->filename( $url, $mime_type ),
			'type'     => $mime_type,
			'tmp_name' => $temporary_path,
			'error'    => UPLOAD_ERR_OK,
			'size'     => $size,
		);
	}

	private function is_valid_url( $url ) {
		if ( ! is_string( $url ) || '' === $url || strlen( $url ) > 2048 || 1 === preg_match( '/[\x00-\x20\x7F]/', $url ) ) {
			return false;
		}

		$parts = wp_parse_url( $url );
		return is_array( $parts ) && isset( $parts['scheme'], $parts['host'] ) &&
			in_array( strtolower( (string) $parts['scheme'] ), array( 'http', 'https' ), true ) &&
			! isset( $parts['user'] ) && ! isset( $parts['pass'] ) && ! isset( $parts['fragment'] ) &&
			esc_url_raw( $url, array( 'http', 'https' ) ) === $url && wp_http_validate_url( $url ) === $url;
	}

	private function resolve_host( $host ) {
		if ( filter_var( $host, FILTER_VALIDATE_IP ) ) {
			return array( $host );
		}
		if ( ! function_exists( 'dns_get_record' ) || ! defined( 'DNS_A' ) || ! defined( 'DNS_AAAA' ) ) {
			return new WP_Error( 'easymde_image_hosting_dns_unavailable' );
		}

		$records = dns_get_record( $host, DNS_A | DNS_AAAA );
		if ( ! is_array( $records ) || array() === $records ) {
			return new WP_Error( 'easymde_image_hosting_dns_failed' );
		}

		$addresses = array();
		foreach ( $records as $record ) {
			if ( isset( $record['ip'] ) && is_string( $record['ip'] ) ) {
				$addresses[] = $record['ip'];
			}
			if ( isset( $record['ipv6'] ) && is_string( $record['ipv6'] ) ) {
				$addresses[] = $record['ipv6'];
			}
		}

		return array_values( array_unique( $addresses ) );
	}

	private function are_public_addresses( $addresses ) {
		if ( ! is_array( $addresses ) || array() === $addresses ) {
			return false;
		}
		foreach ( $addresses as $address ) {
			if ( ! is_string( $address ) || ! $this->is_public_address( $address ) ) {
				return false;
			}
		}

		return true;
	}

	private function is_public_address( $address ) {
		$packed = inet_pton( $address );
		if ( false === $packed ) {
			return false;
		}
		if ( 4 === strlen( $packed ) ) {
			return $this->is_public_ipv4( $packed );
		}
		if ( 16 !== strlen( $packed ) ) {
			return false;
		}
		if ( str_repeat( "\0", 10 ) . "\xff\xff" === substr( $packed, 0, 12 ) ) {
			return $this->is_public_ipv4( substr( $packed, 12, 4 ) );
		}
		if ( ! $this->matches_cidr( $packed, '2000::', 3 ) ) {
			return false;
		}

		$denied = array(
			array( '2001::', 23 ),
			array( '2001:db8::', 32 ),
			array( '2002::', 16 ),
			array( '2620:4f:8000::', 48 ),
			array( '3fff::', 20 ),
		);
		foreach ( $denied as $cidr ) {
			if ( $this->matches_cidr( $packed, $cidr[0], $cidr[1] ) ) {
				return false;
			}
		}

		return true;
	}

	private function is_public_ipv4( $packed ) {
		$denied = array(
			array( '0.0.0.0', 8 ),
			array( '10.0.0.0', 8 ),
			array( '100.64.0.0', 10 ),
			array( '127.0.0.0', 8 ),
			array( '169.254.0.0', 16 ),
			array( '172.16.0.0', 12 ),
			array( '192.0.0.0', 24 ),
			array( '192.0.2.0', 24 ),
			array( '192.31.196.0', 24 ),
			array( '192.52.193.0', 24 ),
			array( '192.88.99.0', 24 ),
			array( '192.168.0.0', 16 ),
			array( '192.175.48.0', 24 ),
			array( '198.18.0.0', 15 ),
			array( '198.51.100.0', 24 ),
			array( '203.0.113.0', 24 ),
			array( '224.0.0.0', 4 ),
			array( '240.0.0.0', 4 ),
		);
		foreach ( $denied as $cidr ) {
			if ( $this->matches_cidr( $packed, $cidr[0], $cidr[1] ) ) {
				return false;
			}
		}

		return true;
	}

	private function matches_cidr( $packed_address, $network, $prefix_length ) {
		$packed_network = inet_pton( $network );
		if ( false === $packed_network || strlen( $packed_address ) !== strlen( $packed_network ) ) {
			return false;
		}

		$whole_bytes = intdiv( $prefix_length, 8 );
		$remaining   = $prefix_length % 8;
		if ( $whole_bytes > 0 && substr( $packed_address, 0, $whole_bytes ) !== substr( $packed_network, 0, $whole_bytes ) ) {
			return false;
		}
		if ( 0 === $remaining ) {
			return true;
		}

		$mask = ( 0xff << ( 8 - $remaining ) ) & 0xff;

		return ( ord( $packed_address[ $whole_bytes ] ) & $mask ) === ( ord( $packed_network[ $whole_bytes ] ) & $mask );
	}

	private function filename( $url, $mime_type ) {
		$extensions = array(
			'image/gif'  => 'gif',
			'image/jpeg' => 'jpg',
			'image/png'  => 'png',
			'image/webp' => 'webp',
		);
		$parts      = wp_parse_url( $url );
		$path       = is_array( $parts ) && isset( $parts['path'] ) ? rawurldecode( $parts['path'] ) : '';
		$basename   = sanitize_file_name( basename( $path ) );
		$stem       = sanitize_file_name( pathinfo( $basename, PATHINFO_FILENAME ) );
		if ( '' === $stem ) {
			$stem = 'remote-image';
		}

		return $stem . '.' . $extensions[ $mime_type ];
	}

	private function delete_file( $path ) {
		if ( is_file( $path ) ) {
			wp_delete_file( $path );
		}
	}

	private function error( $code, $status, $message ) {
		return new WP_Error( $code, $message, array( 'status' => $status ) );
	}
}
