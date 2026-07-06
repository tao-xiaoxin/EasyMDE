<?php

namespace EasyMDE\Admin;

use EasyMDE\Content\MarkdownFeatureDetector;
use EasyMDE\Content\MarkdownRenderer;
use EasyMDE\Content\PostDocument;
use EasyMDE\Support\Options;
use EasyMDE\Theme\ThemeStateRepository;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class EditorScreen {

	private $post_document;
	private $post_mode_controller;
	private $options;
	private $theme_state_repository;
	private $feature_detector;

	public function __construct(
		PostDocument $post_document,
		PostModeController $post_mode_controller,
		ThemeStateRepository $theme_state_repository,
		?Options $options = null,
		?MarkdownFeatureDetector $feature_detector = null
	) {
		$this->post_document          = $post_document;
		$this->post_mode_controller   = $post_mode_controller;
		$this->options                = $options ? $options : new Options();
		$this->theme_state_repository = $theme_state_repository;
		$this->feature_detector       = $feature_detector ? $feature_detector : new MarkdownFeatureDetector();
	}

	public function register_hooks() {
		add_action( 'edit_form_after_title', array( $this, 'render_editor_shell' ) );
		add_action( 'admin_notices', array( $this, 'render_dependency_notice' ) );
	}

	public function render_editor_shell( $post ) {
		if ( ! $post || ! $this->post_mode_controller->should_load_editor( $post->ID, $post->post_type ) ) {
			return;
		}

		$context                                = array(
			'post'                        => $post,
			'markdown'                    => $this->post_document->get_markdown( $post ),
			'theme_state'                 => $this->theme_state_repository->get_theme_state( $post->ID ),
			'spellcheck_enabled'          => $this->options->is_editor_spellcheck_enabled(),
			'content_classes'             => '',
			'content_style'               => '',
			'initial_preview'             => '',
			'initial_preview_ready'       => false,
			'initial_preview_pending'     => false,
			'initial_preview_provisional' => false,
			'initial_preview_features'    => array(),
			'markdown_fingerprint'        => '',
		);
		$context['content_classes']             = $this->theme_state_repository->get_rendered_content_classes( $context['theme_state'], 'easymde-preview' );
		$context['content_style']               = $this->theme_state_repository->get_rendered_content_style( $context['theme_state'] );
		$context['markdown_fingerprint']        = $this->markdown_fingerprint( $context['markdown'] );
		$context['initial_preview']             = $this->render_initial_preview( $post, $context['markdown'] );
		$context['initial_preview_ready']       = '' !== trim( $context['initial_preview'] )
			&& $this->can_reuse_stored_content_preview( $post, $context['markdown'], $context['theme_state']['markdownTheme'] );
		$context['initial_preview_pending']     = ! $context['initial_preview_ready'] && '' !== trim( (string) $context['markdown'] );
		$context['initial_preview_provisional'] = ! $context['initial_preview_ready'] && '' !== trim( $context['initial_preview'] );
		$context['initial_preview_features']    = $context['initial_preview_ready'] ? $this->feature_detector->detect( $context['markdown'] ) : array();

		wp_nonce_field( 'easymde_save_markdown', 'easymde_nonce' );
		require EASYMDE_PLUGIN_DIR . 'templates/admin/editor-shell.php';
	}

	public function render_dependency_notice() {
		if ( MarkdownRenderer::is_available() ) {
			return;
		}

		echo '<div class="notice notice-error"><p>';
		echo esc_html__( 'EasyMDE requires Composer dependencies before Markdown can be rendered or saved. Run composer install for development or include vendor/ in release packages.', 'easymde' );
		echo '</p></div>';
	}

	private function render_initial_preview( $post, $markdown ) {
		if ( '' === trim( (string) $markdown ) ) {
			return '';
		}

		$stored_content_preview = $this->render_stored_content_preview( $post );

		if ( '' !== $stored_content_preview ) {
			return $stored_content_preview;
		}

		return '';
	}

	private function render_stored_content_preview( $post ) {
		$html = wp_kses_post( (string) $post->post_content );

		return '' !== trim( $html ) ? $html : '';
	}

	private function can_reuse_stored_content_preview( $post, $markdown, $markdown_theme ) {
		$post_id = $post ? absint( $post->ID ) : 0;

		if ( ! $post_id || ! $this->post_document->has_stored_markdown( $post_id ) ) {
			return true;
		}

		return $this->post_document->has_enabled_marker( $post_id )
			&& $this->post_document->has_current_render_signature(
				$post_id,
				$markdown,
				$markdown_theme,
				(string) $post->post_content
			);
	}

	private function markdown_fingerprint( $markdown ) {
		$markdown = str_replace( array( "\r\n", "\r" ), "\n", (string) $markdown );

		return strlen( $markdown ) . ':' . hash( 'fnv1a32', $markdown );
	}
}
