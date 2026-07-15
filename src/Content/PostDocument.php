<?php

namespace EasyMDE\Content;

use EasyMDE\Support\Migration;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class PostDocument {

	const META_ENABLED             = '_easymde_enabled';
	const META_MARKDOWN            = '_easymde_markdown';
	const META_MARKDOWN_THEME      = '_easymde_markdown_theme';
	const META_CODE_THEME          = '_easymde_code_theme';
	const META_CUSTOM_CSS_ID       = '_easymde_custom_css_id';
	const META_CUSTOM_CSS_SNAPSHOT = '_easymde_custom_css_snapshot';
	const META_CUSTOM_FONT         = '_easymde_custom_font';
	const META_WINDOWS_FONT        = '_easymde_windows_font';
	const META_APPLE_FONT          = '_easymde_apple_font';
	const META_SERIF_FONT          = '_easymde_serif_font';
	const META_RENDER_SIGNATURE    = '_easymde_render_signature';
	const RENDER_SIGNATURE_VERSION = '1';

	private $migration;

	public function __construct( ?Migration $migration = null ) {
		$this->migration = null !== $migration ? $migration : new Migration();
	}

	public function is_supported_post_type( $post_type ) {
		$supported = apply_filters( 'easymde_supported_post_types', array( 'post', 'page' ) );

		return in_array( $post_type, $supported, true );
	}

	public function is_easymde_post( $post_id ) {
		$post_id = absint( $post_id );
		if ( ! $post_id ) {
			return false;
		}

		$post = get_post( $post_id );
		if ( ! $post || ! $this->is_supported_post_type( $post->post_type ) ) {
			return false;
		}

		return $this->migration->is_easymde_enabled( $post_id );
	}

	public function get_markdown( $post ) {
		return $this->migration->get_markdown( $post );
	}

	public function has_stored_markdown( $post_id ) {
		return $this->migration->has_legacy_markdown( $post_id );
	}

	public function has_enabled_marker( $post_id ) {
		return $this->migration->has_enabled_marker( $post_id );
	}

	public function revision_meta_keys() {
		return $this->migration->revision_meta_keys();
	}

	public function mark_enabled( $post_id ) {
		$this->migration->mark_enabled( $post_id );
	}

	public function render_signature( $markdown, $markdown_theme, $post_content ) {
		$markdown       = (string) $markdown;
		$markdown_theme = sanitize_key( (string) $markdown_theme );
		$post_content   = (string) $post_content;

		return hash(
			'sha256',
			implode(
				"\0",
				array(
					self::RENDER_SIGNATURE_VERSION,
					(string) strlen( $markdown ),
					$markdown,
					(string) strlen( $markdown_theme ),
					$markdown_theme,
					(string) strlen( $post_content ),
					$post_content,
				)
			)
		);
	}

	public function store_render_signature( $post_id, $markdown, $markdown_theme, $post_content ) {
		update_post_meta(
			absint( $post_id ),
			self::META_RENDER_SIGNATURE,
			$this->render_signature( $markdown, $markdown_theme, $post_content )
		);
	}

	public function has_current_render_signature( $post_id, $markdown, $markdown_theme, $post_content ) {
		$post_id = absint( $post_id );
		if ( ! $post_id || ! metadata_exists( 'post', $post_id, self::META_RENDER_SIGNATURE ) ) {
			return false;
		}

		$stored   = (string) get_post_meta( $post_id, self::META_RENDER_SIGNATURE, true );
		$expected = $this->render_signature( $markdown, $markdown_theme, $post_content );

		return hash_equals( $expected, $stored );
	}
}
