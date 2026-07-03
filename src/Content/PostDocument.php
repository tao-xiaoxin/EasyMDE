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
	const META_CODE_MAC_STYLE      = '_easymde_code_mac_style';
	const META_CUSTOM_CSS_ID       = '_easymde_custom_css_id';
	const META_CUSTOM_CSS_SNAPSHOT = '_easymde_custom_css_snapshot';
	const META_CUSTOM_FONT         = '_easymde_custom_font';
	const META_WINDOWS_FONT        = '_easymde_windows_font';
	const META_APPLE_FONT          = '_easymde_apple_font';
	const META_SERIF_FONT          = '_easymde_serif_font';
	const DEFAULT_NEW_POST_TYPES   = array( 'post', 'page' );

	private $migration;

	public function __construct( ?Migration $migration = null ) {
		$this->migration = null !== $migration ? $migration : new Migration();
	}

	public function is_supported_post_type( $post_type ) {
		$supported = apply_filters( 'easymde_supported_post_types', array( 'post', 'page' ) );

		return in_array( $post_type, $supported, true );
	}

	public function is_default_new_post_type( $post_type ) {
		// This intentionally ignores easymde_supported_post_types: default new-item
		// takeover is limited to WordPress' built-in post and page types.
		return in_array( $post_type, self::DEFAULT_NEW_POST_TYPES, true );
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

	public function revision_meta_keys() {
		return $this->migration->revision_meta_keys();
	}

	public function mark_enabled( $post_id ) {
		$this->migration->mark_enabled( $post_id );
	}
}
