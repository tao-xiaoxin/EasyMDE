<?php

namespace EasyMDE\Admin;

use EasyMDE\Content\MarkdownRenderer;
use EasyMDE\Content\PostDocument;
use EasyMDE\Theme\ThemeStateRepository;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class EditorSaveHandler {

	private $post_document;
	private $theme_state_repository;
	private $renderer_available_callback;
	private $pending_render_signatures = array();

	public function __construct(
		PostDocument $post_document,
		ThemeStateRepository $theme_state_repository,
		?callable $renderer_available_callback = null
	) {
		$this->post_document               = $post_document;
		$this->theme_state_repository      = $theme_state_repository;
		$this->renderer_available_callback = null !== $renderer_available_callback ? $renderer_available_callback : array( MarkdownRenderer::class, 'is_available' );
	}

	public function register_hooks() {
		add_action( 'save_post', array( $this, 'save_post_meta' ), 10, 3 );
		add_action( 'wp_creating_autosave', array( $this, 'materialize_new_native_autosave_meta' ), 20, 2 );
		add_action( 'wp_after_insert_post', array( $this, 'materialize_native_autosave_meta' ), 20, 4 );
		add_filter( 'wp_insert_post_data', array( $this, 'render_markdown_post_content' ), 10, 2 );
		add_filter( 'redirect_post_location', array( $this, 'redirect_after_native_publish' ), 10, 2 );
	}

	public function redirect_after_native_publish( $location, $post_id ) {
		if ( ! $this->has_valid_save_request() || ! current_user_can( 'edit_post', $post_id ) ) {
			return $location;
		}

		$open_published_post = '';
		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- has_valid_save_request() verifies the action-specific EasyMDE nonce.
		if ( isset( $_POST['easymde_open_published_post'] ) ) {
			// phpcs:ignore WordPress.Security.NonceVerification.Missing -- has_valid_save_request() verifies the action-specific EasyMDE nonce.
			$open_published_post = sanitize_text_field( wp_unslash( $_POST['easymde_open_published_post'] ) );
		}
		if ( '1' !== $open_published_post ) {
			return $location;
		}

		$post = get_post( $post_id );
		if (
			! $post
			|| ! in_array( $post->post_status, array( 'publish', 'private' ), true )
			|| ! $this->post_document->is_supported_post_type( $post->post_type )
		) {
			return $location;
		}

		$permalink = get_permalink( $post_id );

		return $permalink ? $permalink : $location;
	}

	public function save_post_meta( $post_id, $post, $update ) {
		unset( $update );

		if ( wp_is_post_revision( $post_id ) || ! $post || ! $this->post_document->is_supported_post_type( $post->post_type ) ) {
			return;
		}

		$request = $this->valid_save_request( $post_id );
		if ( ! $request ) {
			return;
		}

		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return;
		}

		if ( ! $this->is_renderer_available() ) {
			$this->abort_renderer_unavailable();

			return;
		}

		$markdown    = wp_unslash( $request['source']['easymde_markdown'] );
		$theme_state = $this->theme_state_repository->sanitize_theme_state_from_request( $request['source'], $post_id );

		$this->post_document->mark_enabled( $post_id );
		update_post_meta( $post_id, PostDocument::META_MARKDOWN, $markdown );
		update_post_meta( $post_id, PostDocument::META_MARKDOWN_THEME, $theme_state['markdownTheme'] );
		if ( $theme_state['codeThemeExplicit'] ) {
			update_post_meta( $post_id, PostDocument::META_CODE_THEME, $theme_state['codeTheme'] );
		} else {
			delete_post_meta( $post_id, PostDocument::META_CODE_THEME );
		}
		update_post_meta( $post_id, PostDocument::META_CUSTOM_CSS_ID, $theme_state['customCssId'] );
		update_post_meta( $post_id, PostDocument::META_CUSTOM_CSS_SNAPSHOT, $theme_state['customCss'] );
		update_post_meta( $post_id, PostDocument::META_CUSTOM_FONT, $theme_state['customFont'] );
		update_post_meta( $post_id, PostDocument::META_WINDOWS_FONT, $theme_state['windowsFont'] );
		update_post_meta( $post_id, PostDocument::META_APPLE_FONT, $theme_state['appleFont'] );
		update_post_meta( $post_id, PostDocument::META_SERIF_FONT, $theme_state['serifFont'] );
		update_post_meta(
			$post_id,
			PostDocument::META_RENDER_SIGNATURE,
			$this->current_render_signature( $post_id, $markdown, $theme_state['markdownTheme'] )
		);

		if ( ! $request['autosave'] ) {
			$this->theme_state_repository->save_user_defaults( $theme_state );
		}
		unset( $this->pending_render_signatures[ $post_id ] );
	}

	public function render_markdown_post_content( $data, $postarr ) {
		$is_revision = isset( $postarr['post_type'] ) && 'revision' === $postarr['post_type'];
		$post_id     = $is_revision && ! empty( $postarr['post_parent'] )
			? absint( $postarr['post_parent'] )
			: ( ! empty( $postarr['ID'] ) ? absint( $postarr['ID'] ) : 0 );
		$request     = $this->valid_save_request( $post_id );
		if ( ! $request ) {
			return $data;
		}

		if ( $is_revision && ! $request['autosave'] ) {
			return $data;
		}

		$owner_id = $is_revision && ! empty( $postarr['post_parent'] )
			? absint( $postarr['post_parent'] )
			: $request['post_id'];
		$owner    = $owner_id ? get_post( $owner_id ) : null;
		if (
			empty( $postarr['post_type'] )
			|| (
				! $is_revision
				&& ! $this->post_document->is_supported_post_type( $postarr['post_type'] )
			)
			|| (
				$is_revision
				&& (
					! $owner
					|| ! $this->post_document->is_supported_post_type( $owner->post_type )
					|| $owner_id !== $request['post_id']
				)
			)
		) {
			return $data;
		}

		$capability_post_id = $owner_id ? $owner_id : $post_id;
		if ( $capability_post_id && ! current_user_can( 'edit_post', $capability_post_id ) ) {
			return $data;
		}

		if ( ! $this->is_renderer_available() ) {
			$this->abort_renderer_unavailable();

			return $data;
		}

		$markdown    = wp_unslash( $request['source']['easymde_markdown'] );
		$theme_state = $this->theme_state_repository->sanitize_theme_state_from_request( $request['source'], $owner_id );

		try {
			$data['post_content'] = MarkdownRenderer::render( $markdown, $theme_state['markdownTheme'] );
		} catch ( \Throwable $exception ) {
			unset( $exception );

			$this->abort_renderer_unavailable();

			return $data;
		}

		if ( ! empty( $postarr['ID'] ) ) {
			$this->pending_render_signatures[ absint( $postarr['ID'] ) ] = $this->post_document->render_signature(
				$markdown,
				$theme_state['markdownTheme'],
				$data['post_content']
			);
		}

		return $data;
	}

	public function materialize_native_autosave_meta( $post_id, $post, $update, $post_before ) {
		unset( $post_before );

		if ( ! $update ) {
			return;
		}

		$revision_id = absint( $post_id );
		$parent_id   = $revision_id ? wp_is_post_autosave( $revision_id ) : false;
		if (
			! $revision_id
			|| ! $parent_id
			|| ! $post
			|| 'revision' !== $post->post_type
			|| (int) $post->post_parent !== (int) $parent_id
		) {
			return;
		}

		$this->materialize_persisted_native_autosave_meta( $revision_id, $post, $parent_id );
	}

	public function materialize_new_native_autosave_meta( $new_autosave, $is_update ) {
		if (
			$is_update
			|| ! is_array( $new_autosave )
			|| empty( $new_autosave['ID'] )
			|| empty( $new_autosave['post_parent'] )
		) {
			return;
		}

		$revision_id = absint( $new_autosave['ID'] );
		$parent_id   = absint( $new_autosave['post_parent'] );
		$post        = $revision_id ? get_post( $revision_id ) : null;
		if (
			! $revision_id
			|| ! $parent_id
			|| ! $post
			|| wp_is_post_autosave( $revision_id ) !== $parent_id
		) {
			return;
		}

		$this->materialize_persisted_native_autosave_meta( $revision_id, $post, $parent_id );
	}

	private function materialize_persisted_native_autosave_meta( $revision_id, $post, $parent_id ) {
		$parent_id = absint( $parent_id );
		$request   = $this->valid_save_request( $parent_id );
		if ( ! $request || ! $request['autosave'] ) {
			return;
		}

		$markdown         = wp_unslash( $request['source']['easymde_markdown'] );
		$theme_state      = $this->theme_state_repository->sanitize_theme_state_from_request( $request['source'], $parent_id );
		$rendered_content = (string) $post->post_content;

		$metadata = array(
			PostDocument::META_ENABLED             => '1',
			PostDocument::META_MARKDOWN            => $markdown,
			PostDocument::META_MARKDOWN_THEME      => $theme_state['markdownTheme'],
			PostDocument::META_CUSTOM_CSS_ID       => $theme_state['customCssId'],
			PostDocument::META_CUSTOM_CSS_SNAPSHOT => $theme_state['customCss'],
			PostDocument::META_CUSTOM_FONT         => $theme_state['customFont'],
			PostDocument::META_WINDOWS_FONT        => $theme_state['windowsFont'],
			PostDocument::META_APPLE_FONT          => $theme_state['appleFont'],
			PostDocument::META_SERIF_FONT          => $theme_state['serifFont'],
			PostDocument::META_RENDER_SIGNATURE    => $this->post_document->render_signature(
				$markdown,
				$theme_state['markdownTheme'],
				$rendered_content
			),
		);
		if ( $theme_state['codeThemeExplicit'] ) {
			$metadata[ PostDocument::META_CODE_THEME ] = $theme_state['codeTheme'];
		} else {
			delete_metadata( 'post', $revision_id, PostDocument::META_CODE_THEME );
		}

		foreach ( $metadata as $key => $value ) {
			delete_metadata( 'post', $revision_id, $key );
			add_metadata( 'post', $revision_id, $key, $value );
		}
	}

	private function has_valid_save_request() {
		if ( ! isset( $_POST['easymde_nonce'], $_POST['easymde_markdown'], $_POST['easymde_enabled'] ) ) {
			return false;
		}

		if ( '1' !== sanitize_text_field( wp_unslash( $_POST['easymde_enabled'] ) ) ) {
			return false;
		}

		$nonce = sanitize_text_field( wp_unslash( $_POST['easymde_nonce'] ) );

		return wp_verify_nonce( $nonce, 'easymde_save_markdown' );
	}

	private function valid_save_request( $post_id = 0 ) {
		if ( $this->has_valid_save_request() ) {
			return array(
				'autosave' => false,
				'post_id'  => absint( $post_id ),
				// phpcs:ignore WordPress.Security.NonceVerification.Missing -- has_valid_save_request() verifies the action-specific EasyMDE nonce before this source is consumed.
				'source'   => $_POST,
			);
		}

		$autosave = $this->native_autosave_request();
		if ( ! $autosave ) {
			return false;
		}

		$request_post_id = absint( $autosave['post_id'] );
		if ( $post_id && $post_id !== $request_post_id ) {
			return false;
		}

		$source = array();
		foreach (
			array(
				'enabled',
				'markdown',
				'markdown_theme',
				'code_theme',
				'code_theme_explicit',
				'custom_css_id',
				'custom_font',
				'windows_font',
				'apple_font',
				'serif_font',
			) as $field
		) {
			$key = '_easymde_' . $field;
			if ( array_key_exists( $key, $autosave ) ) {
				$source[ 'easymde_' . $field ] = $autosave[ $key ];
			}
		}

		return array(
			'autosave' => true,
			'post_id'  => $request_post_id,
			'source'   => $source,
		);
	}

	private function native_autosave_request() {
		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- The native action nonce is verified below after the request shape is validated.
		if ( ! isset( $_POST['data']['wp_autosave'] ) || ! is_array( $_POST['data']['wp_autosave'] ) ) {
			return false;
		}

		// phpcs:ignore WordPress.Security.NonceVerification.Missing -- The native action nonce is verified below.
		$autosave = $_POST['data']['wp_autosave'];
		if (
			! isset( $autosave['post_id'], $autosave['_wpnonce'], $autosave['_easymde_enabled'], $autosave['_easymde_markdown'] )
			|| '1' !== sanitize_text_field( wp_unslash( $autosave['_easymde_enabled'] ) )
		) {
			return false;
		}

		$post_id = absint( $autosave['post_id'] );
		$post    = $post_id ? get_post( $post_id ) : null;
		$nonce   = sanitize_text_field( wp_unslash( $autosave['_wpnonce'] ) );
		if (
			! $post
			|| ! $this->post_document->is_supported_post_type( $post->post_type )
			|| ! current_user_can( 'edit_post', $post_id )
			|| ! wp_verify_nonce( $nonce, 'update-post_' . $post_id )
		) {
			return false;
		}

		return $autosave;
	}

	private function is_renderer_available() {
		return (bool) call_user_func( $this->renderer_available_callback );
	}

	private function current_render_signature( $post_id, $markdown, $markdown_theme ) {
		$post_id = absint( $post_id );
		if ( $post_id && isset( $this->pending_render_signatures[ $post_id ] ) ) {
			return $this->pending_render_signatures[ $post_id ];
		}

		$post = $post_id ? get_post( $post_id ) : null;

		return $this->post_document->render_signature(
			$markdown,
			$markdown_theme,
			$post ? (string) $post->post_content : ''
		);
	}

	private function abort_renderer_unavailable() {
		wp_die(
			esc_html__( 'EasyMDE cannot save this post because Markdown rendering is unavailable. Install Composer dependencies and try again.', 'easymde' ),
			esc_html__( 'EasyMDE renderer unavailable', 'easymde' ),
			array(
				'response'  => 500,
				'back_link' => true,
			)
		);
	}
}
