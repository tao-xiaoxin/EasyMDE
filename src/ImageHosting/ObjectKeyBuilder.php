<?php

namespace EasyMDE\ImageHosting;

use DateTimeImmutable;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class ObjectKeyBuilder {

	const MAX_TEMPLATE_BYTES = 160;

	/**
	 * MIME defaults are retained for internal validation uploads. Real uploads
	 * use the exact source extension from ImageUploadExtensionPolicy.
	 */
	const MIME_EXTENSIONS = array(
		'image/gif'  => 'gif',
		'image/jpeg' => 'jpg',
		'image/png'  => 'png',
		'image/webp' => 'webp',
	);

	/**
	 * Split a legacy complete object-key template after removing one terminal
	 * `.{ext}` marker. Invalid or unrepresentable placements return null.
	 *
	 * @param mixed $template Legacy complete template.
	 * @return array{0:string,1:string}|null
	 */
	public static function split_legacy_template( $template ) {
		if ( ! is_string( $template ) ) {
			return null;
		}
		if ( '' === $template || '/' === $template[0] || '/' === substr( $template, -1 ) ) {
			return null;
		}

		$separator = strrpos( $template, '/' );
		$storage   = false === $separator ? '' : substr( $template, 0, $separator );
		$basename  = false === $separator ? $template : substr( $template, $separator + 1 );
		$marker    = '.{ext}';

		if (
			1 !== substr_count( $template, '{ext}' ) ||
			strlen( $basename ) <= strlen( $marker ) ||
			substr( $basename, -strlen( $marker ) ) !== $marker
		) {
			return null;
		}

		$rule = substr( $basename, 0, -strlen( $marker ) );
		if ( '' === $rule ) {
			return null;
		}

		try {
			( new self() )->validate_legacy_components( $storage, $rule );
		} catch ( ImageHostException $exception ) {
			return null;
		}

		return array( $storage, $rule );
	}

	/**
	 * Validate and return one combined suffix-free object-key template.
	 *
	 * @param mixed $storage_path Storage path template.
	 * @param mixed $file_name_rule File name stem template.
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
		if ( null === self::split_legacy_template( $template ) ) {
			throw new ImageHostException( 'image_host_invalid_key_template' );
		}

		return $template;
	}

	/**
	 * Combine the split settings without applying any expansion.
	 *
	 * @param mixed $storage_path Storage path template.
	 * @param mixed $file_name_rule File name stem template.
	 * @return string
	 * @throws ImageHostException When either part is not a string.
	 */
	public function combine( $storage_path, $file_name_rule ) {
		if ( ! is_string( $storage_path ) || ! is_string( $file_name_rule ) ) {
			throw new ImageHostException( 'image_host_invalid_key_template' );
		}

		return '' === $storage_path ? $file_name_rule : $storage_path . '/' . $file_name_rule;
	}

	/**
	 * Build one object key and append exactly one verified source extension.
	 *
	 * @param mixed $enabled_extensions Canonical map, legacy map, or enabled list.
	 * @return string
	 */
	public function build( $storage_path, $file_name_rule, $bytes, $original_filename, $mime_type, $post_id, DateTimeImmutable $now, $uuid, $enabled_extensions = null ) {
		if ( ! is_string( $bytes ) || '' === $bytes ) {
			throw new ImageHostException( 'image_host_empty_file' );
		}

		if ( strlen( $bytes ) > ImageHostProviderSupport::MAX_IMAGE_BYTES ) {
			throw new ImageHostException( 'image_host_file_too_large' );
		}

		if ( ! isset( self::MIME_EXTENSIONS[ $mime_type ] ) ) {
			throw new ImageHostException( 'image_host_unsupported_mime' );
		}

		$extension = ImageUploadExtensionPolicy::verify( $original_filename, $mime_type, $enabled_extensions );
		if ( false === $extension ) {
			throw new ImageHostException( 'image_host_invalid_extension' );
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
		);
		$object_key   = strtr( $template, $replacements ) . '.' . $extension;

		if ( ! ImageHostProviderSupport::is_valid_object_key( $object_key ) ) {
			throw new ImageHostException( 'image_host_invalid_object_key' );
		}

		return $object_key;
	}

	private function is_valid_template( $template ) {
		if ( ! is_string( $template ) || '' === $template || strlen( $template ) + 5 > self::MAX_TEMPLATE_BYTES ) {
			return false;
		}

		if (
			'/' === $template[0] ||
			'/' === substr( $template, -1 ) ||
			false !== strpos( $template, '\\' ) ||
			false !== strpos( $template, '..' ) ||
			false !== strpos( $template, '//' ) ||
			false !== strpos( $template, '{ext}' ) ||
			1 === preg_match( '/[\\x00-\\x1F\\x7F?#]/', $template )
		) {
			return false;
		}
		foreach ( explode( '/', $template ) as $segment ) {
			if ( '.' === $segment ) {
				return false;
			}
		}

		$known_placeholders = '(?:year|month|day|date|time|post_id|md5|uuid|name)';
		$without_known      = preg_replace( '/\{' . $known_placeholders . '\}/', '', $template );

		return is_string( $without_known ) &&
			false === strpos( $without_known, '{' ) &&
			false === strpos( $without_known, '}' ) &&
			1 === preg_match( '/^[A-Za-z0-9._\/\-]*$/', $without_known );
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
			false !== strpos( $value, '{ext}' ) ||
			1 === preg_match( '/[\\x00-\\x1F\\x7F?#]/', $value ) ||
			( ! $allow_separator && false !== strpos( $value, '/' ) )
		) {
			return false;
		}
		if ( ! $allow_separator && 1 === preg_match( '/\.(?:webp|png|jpg|jpeg|jfif|gif)$/i', $value ) ) {
			return false;
		}
		$known_placeholders = '(?:year|month|day|date|time|post_id|md5|uuid|name)';
		$without_known      = preg_replace( '/\{' . $known_placeholders . '\}/', '', $value );

		return is_string( $without_known ) &&
			false === strpos( $without_known, '{' ) &&
			false === strpos( $without_known, '}' ) &&
			1 === preg_match( '/^[A-Za-z0-9._\/\-]*$/', $without_known );
	}

	private function validate_legacy_components( $storage_path, $file_name_rule ) {
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
