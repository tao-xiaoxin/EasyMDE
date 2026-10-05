<?php

namespace EasyMDE\ImageHosting;

use DateTimeImmutable;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class ObjectKeyBuilder {

	const MAX_TEMPLATE_BYTES = 160;

	const MIME_EXTENSIONS = array(
		'image/gif'  => 'gif',
		'image/jpeg' => 'jpg',
		'image/png'  => 'png',
		'image/webp' => 'webp',
	);

	/**
	 * Split a legacy complete object-key template at its final separator.
	 *
	 * @param mixed $template Legacy complete template.
	 * @return array{0:string,1:string}|null
	 */
	public static function split_legacy_template( $template ) {
		if ( ! is_string( $template ) ) {
			return null;
		}

		$separator = strrpos( $template, '/' );
		if ( false === $separator ) {
			return array( '', $template );
		}

		return array(
			substr( $template, 0, $separator ),
			substr( $template, $separator + 1 ),
		);
	}

	/**
	 * Validate and return one combined object-key template.
	 *
	 * @param mixed $storage_path Storage path template.
	 * @param mixed $file_name_rule File name template.
	 * @return string
	 * @throws ImageHostException When the combined template is invalid.
	 */
	public function validate( $storage_path, $file_name_rule ) {
		if (
			! $this->is_valid_component( $storage_path, true, true ) ||
			! $this->is_valid_component( $file_name_rule, false, false )
		) {
			throw new ImageHostException( 'image_host_invalid_key_template' );
		}

		$template = $this->combine( $storage_path, $file_name_rule );
		if ( ! $this->is_valid_template( $template ) ) {
			throw new ImageHostException( 'image_host_invalid_key_template' );
		}

		return $template;
	}

	/**
	 * Validate a legacy complete object-key template before it is split.
	 *
	 * @param mixed $template Legacy complete template.
	 * @return string
	 * @throws ImageHostException When the legacy template is invalid.
	 */
	public function validate_legacy_template( $template ) {
		if ( ! $this->is_valid_template( $template ) ) {
			throw new ImageHostException( 'image_host_invalid_key_template' );
		}

		return $template;
	}

	/**
	 * Combine the split settings without applying any expansion.
	 *
	 * @param mixed $storage_path Storage path template.
	 * @param mixed $file_name_rule File name template.
	 * @return string
	 * @throws ImageHostException When either part is not a string.
	 */
	public function combine( $storage_path, $file_name_rule ) {
		if ( ! is_string( $storage_path ) || ! is_string( $file_name_rule ) ) {
			throw new ImageHostException( 'image_host_invalid_key_template' );
		}

		return '' === $storage_path ? $file_name_rule : $storage_path . '/' . $file_name_rule;
	}

	public function build( $storage_path, $file_name_rule, $bytes, $original_filename, $mime_type, $post_id, DateTimeImmutable $now, $uuid ) {
		if ( ! is_string( $bytes ) || '' === $bytes ) {
			throw new ImageHostException( 'image_host_empty_file' );
		}

		if ( strlen( $bytes ) > ImageHostProviderSupport::MAX_IMAGE_BYTES ) {
			throw new ImageHostException( 'image_host_file_too_large' );
		}

		if ( ! isset( self::MIME_EXTENSIONS[ $mime_type ] ) ) {
			throw new ImageHostException( 'image_host_unsupported_mime' );
		}

		$template = $this->validate( $storage_path, $file_name_rule );

		$name         = pathinfo( (string) $original_filename, PATHINFO_FILENAME );
		$name         = $this->sanitize_name( $name );
		$replacements = array(
			'{year}'    => $now->format( 'Y' ),
			'{month}'   => $now->format( 'm' ),
			'{day}'     => $now->format( 'd' ),
			'{date}'    => $now->format( 'Ymd' ),
			'{time}'    => $now->format( 'His' ),
			'{post_id}' => max( 0, (int) $post_id ),
			'{md5}'     => md5( $bytes ),
			'{uuid}'    => $this->sanitize_uuid( $uuid ),
			'{name}'    => $name,
			'{ext}'     => self::MIME_EXTENSIONS[ $mime_type ],
		);
		$object_key   = strtr( $template, $replacements );

		if ( ! ImageHostProviderSupport::is_valid_object_key( $object_key ) ) {
			throw new ImageHostException( 'image_host_invalid_object_key' );
		}

		return $object_key;
	}

	private function is_valid_template( $template ) {
		if ( ! is_string( $template ) || '' === $template || strlen( $template ) > self::MAX_TEMPLATE_BYTES ) {
			return false;
		}

		if (
			'/' === $template[0] ||
			'/' === substr( $template, -1 ) ||
			false !== strpos( $template, '\\' ) ||
			false !== strpos( $template, '..' ) ||
			false !== strpos( $template, '//' ) ||
			1 === preg_match( '/[\\x00-\\x1F\\x7F?#]/', $template )
		) {
			return false;
		}
		foreach ( explode( '/', $template ) as $segment ) {
			if ( '.' === $segment ) {
				return false;
			}
		}

		$known_placeholders = '(?:year|month|day|date|time|post_id|md5|uuid|name|ext)';
		$without_known      = preg_replace( '/\{' . $known_placeholders . '\}/', '', $template );

		return is_string( $without_known ) &&
			in_array( 'ext', $this->template_variables( $template ), true ) &&
			false === strpos( $without_known, '{' ) &&
			false === strpos( $without_known, '}' ) &&
			1 === preg_match( '/^[A-Za-z0-9._\/-]*$/', $without_known );
	}

	private function is_valid_component( $value, $allow_separator, $allow_empty ) {
		if ( ! is_string( $value ) || ( ! $allow_empty && '' === $value ) ) {
			return false;
		}
		if ( '' === $value ) {
			return true;
		}
		if (
			false !== strpos( $value, '\\' ) ||
			false !== strpos( $value, '..' ) ||
			false !== strpos( $value, '//' ) ||
			1 === preg_match( '/[\\x00-\\x1F\\x7F?#]/', $value ) ||
			( ! $allow_separator && false !== strpos( $value, '/' ) )
		) {
			return false;
		}
		$known_placeholders = '(?:year|month|day|date|time|post_id|md5|uuid|name|ext)';
		$without_known      = preg_replace( '/\{' . $known_placeholders . '\}/', '', $value );

		return is_string( $without_known ) &&
			false === strpos( $without_known, '{' ) &&
			false === strpos( $without_known, '}' ) &&
			1 === preg_match( '/^[A-Za-z0-9._\/-]*$/', $without_known );
	}

	private function template_variables( $template ) {
		preg_match_all( '/\{([A-Za-z0-9_]+)\}/', $template, $matches );

		return isset( $matches[1] ) && is_array( $matches[1] ) ? $matches[1] : array();
	}

	private function sanitize_name( $name ) {
		$name = strtolower( trim( (string) $name ) );
		$name = preg_replace( '/[^\p{L}\p{N}._-]+/u', '-', $name );
		$name = is_string( $name ) ? trim( $name, '.-_' ) : '';

		return '' !== $name ? $name : 'image';
	}

	private function sanitize_uuid( $uuid ) {
		$uuid = strtolower( (string) $uuid );
		if ( 1 !== preg_match( '/^[a-f0-9][a-f0-9-]{7,63}$/', $uuid ) ) {
			throw new ImageHostException( 'image_host_invalid_uuid' );
		}

		return $uuid;
	}
}
