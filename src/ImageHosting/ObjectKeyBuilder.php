<?php

namespace EasyMDE\ImageHosting;

use DateTimeImmutable;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class ObjectKeyBuilder {

	const MAX_TEMPLATE_BYTES = 256;

	const MIME_EXTENSIONS = array(
		'image/gif'  => 'gif',
		'image/jpeg' => 'jpg',
		'image/png'  => 'png',
		'image/webp' => 'webp',
	);

	public function build( $template, $bytes, $original_filename, $mime_type, $post_id, DateTimeImmutable $now, $uuid ) {
		if ( ! is_string( $bytes ) || '' === $bytes ) {
			throw new ImageHostException( 'image_host_empty_file' );
		}

		if ( strlen( $bytes ) > ImageHostProviderSupport::MAX_IMAGE_BYTES ) {
			throw new ImageHostException( 'image_host_file_too_large' );
		}

		if ( ! isset( self::MIME_EXTENSIONS[ $mime_type ] ) ) {
			throw new ImageHostException( 'image_host_unsupported_mime' );
		}

		if ( ! $this->is_valid_template( $template ) ) {
			throw new ImageHostException( 'image_host_invalid_key_template' );
		}

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

		if ( '/' === $template[0] || false !== strpos( $template, '\\' ) || false !== strpos( $template, '..' ) ) {
			return false;
		}

		$known_placeholders = '(?:year|month|day|date|time|post_id|md5|uuid|name|ext)';
		$without_known      = preg_replace( '/\{' . $known_placeholders . '\}/', '', $template );

		return is_string( $without_known ) &&
			false === strpos( $without_known, '{' ) &&
			false === strpos( $without_known, '}' ) &&
			1 === preg_match( '/^[A-Za-z0-9._\/-]*$/', $without_known );
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
