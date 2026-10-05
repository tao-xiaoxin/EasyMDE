<?php

namespace EasyMDE\ImageHosting;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Owns the exact extension registry shared by every image upload owner.
 */
final class ImageUploadExtensionPolicy {

	const EXTENSIONS = array( 'webp', 'png', 'jpg', 'jpeg', 'jfif', 'gif' );

	const MIME_TYPES = array(
		'webp' => 'image/webp',
		'png'  => 'image/png',
		'jpg'  => 'image/jpeg',
		'jpeg' => 'image/jpeg',
		'jfif' => 'image/jpeg',
		'gif'  => 'image/gif',
	);

	private function __construct() {}

	/**
	 * @return string[]
	 */
	public static function extensions() {
		return self::EXTENSIONS;
	}

	/**
	 * @return array<string,bool>
	 */
	public static function defaults() {
		return array_fill_keys( self::EXTENSIONS, true );
	}

	/**
	 * Normalize the canonical six-key map or the historical four-key map.
	 *
	 * A false return is an invalid shape or a map with no enabled extension.
	 *
	 * @param mixed $formats Extension map.
	 * @return array<string,bool>|false
	 */
	public static function normalize( $formats ) {
		if ( ! is_array( $formats ) ) {
			return false;
		}

		$legacy = array( 'jpg', 'png', 'webp', 'gif' );
		$keys   = array_keys( $formats );
		if ( self::same_keys( $keys, self::EXTENSIONS ) ) {
			$normalized = array();
			foreach ( self::EXTENSIONS as $extension ) {
				if ( ! is_bool( $formats[ $extension ] ) ) {
					return false;
				}
				$normalized[ $extension ] = $formats[ $extension ];
			}
		} elseif ( self::same_keys( $keys, $legacy ) ) {
			foreach ( $legacy as $extension ) {
				if ( ! is_bool( $formats[ $extension ] ) ) {
					return false;
				}
			}
			$normalized = array(
				'webp' => $formats['webp'],
				'png'  => $formats['png'],
				'jpg'  => $formats['jpg'],
				'jpeg' => $formats['jpg'],
				'jfif' => $formats['jpg'],
				'gif'  => $formats['gif'],
			);
		} else {
			return false;
		}

		return in_array( true, $normalized, true ) ? $normalized : false;
	}

	/**
	 * @param mixed $formats Canonical or legacy extension map.
	 * @return string[]
	 */
	public static function enabled( $formats ) {
		$normalized = self::normalize( $formats );

		return is_array( $normalized ) ? array_keys( array_filter( $normalized ) ) : array();
	}

	/**
	 * Return the MIME types represented by the enabled exact extensions.
	 *
	 * @param mixed $formats Canonical or legacy extension map.
	 * @return string[]
	 */
	public static function mime_types( $formats ) {
		$mime_types = array();
		$enabled    = self::enabled( $formats );
		foreach ( array( 'jpg', 'jpeg', 'jfif', 'png', 'webp', 'gif' ) as $extension ) {
			if ( ! in_array( $extension, $enabled, true ) ) {
				continue;
			}
			$mime_type = self::MIME_TYPES[ $extension ];
			if ( ! in_array( $mime_type, $mime_types, true ) ) {
				$mime_types[] = $mime_type;
			}
		}

		return $mime_types;
	}

	/**
	 * Verify the exact source extension against the verified MIME and settings.
	 *
	 * @param mixed $filename Original or generated file name.
	 * @param mixed $mime_type Verified MIME type.
	 * @param mixed $formats Canonical/legacy map or enabled extension list.
	 * @param bool  $allow_extensionless Derive a compatible MIME extension.
	 * @return string|false
	 */
	public static function verify( $filename, $mime_type, $formats = null, $allow_extensionless = false ) {
		$extension = self::filename_extension( $filename );
		if ( '' === $extension ) {
			if ( ! $allow_extensionless ) {
				return false;
			}
			$extension = self::compatible_extension( $mime_type );
		}

		if ( '' === $extension || ! isset( self::MIME_TYPES[ $extension ] ) || self::MIME_TYPES[ $extension ] !== $mime_type ) {
			return false;
		}

		if ( null !== $formats && ! self::is_enabled( $extension, $formats ) ) {
			return false;
		}

		return $extension;
	}

	/**
	 * @param mixed $filename File name.
	 * @return string Empty when the name has no extension.
	 */
	public static function filename_extension( $filename ) {
		if ( ! is_string( $filename ) || '' === $filename ) {
			return '';
		}

		$basename  = basename( str_replace( '\\', '/', $filename ) );
		$extension = pathinfo( $basename, PATHINFO_EXTENSION );

		return is_string( $extension ) ? strtolower( $extension ) : '';
	}

	/**
	 * Return the first compatible suffix used for extensionless remote files.
	 *
	 * @param mixed $mime_type MIME type.
	 * @return string
	 */
	public static function compatible_extension( $mime_type ) {
		$defaults = array(
			'image/webp' => 'webp',
			'image/png'  => 'png',
			'image/jpeg' => 'jpg',
			'image/gif'  => 'gif',
		);

		return isset( $defaults[ $mime_type ] ) ? $defaults[ $mime_type ] : '';
	}

	/**
	 * Normalize browser-declared JPEG aliases without changing the verified MIME.
	 *
	 * @param mixed $mime_type Browser-declared MIME type.
	 * @return string
	 */
	public static function normalize_declared_mime( $mime_type ) {
		$mime_type = is_string( $mime_type ) ? strtolower( trim( $mime_type ) ) : '';

		return in_array( $mime_type, array( 'image/jpg', 'image/jfif' ), true ) ? 'image/jpeg' : $mime_type;
	}

	/**
	 * @param string $extension Extension.
	 * @param mixed  $formats Canonical/legacy map or enabled extension list.
	 * @return bool
	 */
	private static function is_enabled( $extension, $formats ) {
		if ( ! is_array( $formats ) ) {
			return false;
		}

		if ( array_key_exists( $extension, $formats ) ) {
			return true === $formats[ $extension ];
		}

		return in_array( $extension, $formats, true );
	}

	/**
	 * Compare key sets without allowing an accidental map merge.
	 *
	 * @param array $actual Actual keys.
	 * @param array $expected Expected keys.
	 * @return bool
	 */
	private static function same_keys( array $actual, array $expected ) {
		return count( $actual ) === count( $expected ) && 0 === count( array_diff( $actual, $expected ) ) && 0 === count( array_diff( $expected, $actual ) );
	}
}
