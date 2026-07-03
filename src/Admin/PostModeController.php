<?php

namespace EasyMDE\Admin;

use EasyMDE\Content\PostDocument;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class PostModeController {

	private $post_document;

	public function __construct( PostDocument $post_document ) {
		$this->post_document = $post_document;
	}

	public function register_hooks() {
		add_filter( 'use_block_editor_for_post', array( $this, 'maybe_disable_block_editor' ), 10, 2 );
		add_action( 'admin_init', array( $this, 'maybe_redirect_new_post_entry' ) );
	}

	public function maybe_disable_block_editor( $use_block_editor, $post ) {
		if ( ! $post || ! $this->post_document->is_supported_post_type( $post->post_type ) ) {
			return $use_block_editor;
		}

		if ( $this->is_new_easymde_request( $post->post_type ) || $this->post_document->is_easymde_post( $post->ID ) ) {
			return false;
		}

		return $use_block_editor;
	}

	public function redirect_new_post() {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only legacy redirect.
		$page       = isset( $_GET['page'] ) ? sanitize_key( wp_unslash( $_GET['page'] ) ) : '';
		$post_type  = 'easymde-new-page' === $page ? 'page' : 'post';
		$capability = $this->create_post_capability( $post_type );

		if ( ! current_user_can( $capability ) ) {
			wp_die( esc_html__( 'You are not allowed to create this EasyMDE post.', 'easymde' ) );
		}

		$url = 'page' === $post_type
			? add_query_arg( array( 'post_type' => 'page' ), admin_url( 'post-new.php' ) )
			: admin_url( 'post-new.php' );

		wp_safe_redirect( $url );
		exit;
	}

	public function maybe_redirect_new_post_entry() {
		global $pagenow;

		if ( 'edit.php' !== $pagenow ) {
			return;
		}

		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only legacy redirect.
		$page = isset( $_GET['page'] ) ? sanitize_key( wp_unslash( $_GET['page'] ) ) : '';
		if ( ! in_array( $page, array( 'easymde-new-post', 'easymde-new-page' ), true ) ) {
			return;
		}

		$this->redirect_new_post();
	}

	public function should_load_editor( $post_id, $post_type ) {
		if ( ! $this->post_document->is_supported_post_type( $post_type ) ) {
			return false;
		}

		if ( $this->is_new_easymde_request( $post_type ) ) {
			return true;
		}

		return $post_id > 0 && $this->post_document->is_easymde_post( $post_id );
	}

	public function is_new_easymde_request( $post_type ) {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only screen gate.
		if ( ! $this->is_post_new_screen() || ! empty( $_GET['post'] ) ) {
			return false;
		}

		$post_type = sanitize_key( (string) $post_type );
		if ( ! $this->post_document->is_default_new_post_type( $post_type ) ) {
			return false;
		}

		return current_user_can( $this->create_post_capability( $post_type ) );
	}

	private function is_post_new_screen() {
		global $pagenow;

		if ( 'post-new.php' === $pagenow ) {
			return true;
		}

		$self = isset( $_SERVER['PHP_SELF'] ) ? sanitize_text_field( wp_unslash( $_SERVER['PHP_SELF'] ) ) : '';

		return 'post-new.php' === basename( $self );
	}

	private function create_post_capability( $post_type ) {
		$post_type_object = get_post_type_object( $post_type );
		if ( $post_type_object && ! empty( $post_type_object->cap->create_posts ) ) {
			return $post_type_object->cap->create_posts;
		}

		return 'page' === $post_type ? 'edit_pages' : 'edit_posts';
	}
}
