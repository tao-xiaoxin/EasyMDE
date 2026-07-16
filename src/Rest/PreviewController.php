<?php

namespace EasyMDE\Rest;

use EasyMDE\Content\MarkdownFeatureDetector;
use EasyMDE\Content\MarkdownRenderer;
use EasyMDE\Support\Capabilities;
use EasyMDE\Theme\ThemeStateRepository;
use WP_Error;
use WP_REST_Request;
use WP_REST_Server;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class PreviewController {

	const MAX_MARKDOWN_BYTES = 1048576;

	private $capabilities;
	private $theme_state_repository;
	private $feature_detector;

	public function __construct(
		Capabilities $capabilities,
		ThemeStateRepository $theme_state_repository,
		?MarkdownFeatureDetector $feature_detector = null
	) {
		$this->capabilities           = $capabilities;
		$this->theme_state_repository = $theme_state_repository;
		$this->feature_detector       = $feature_detector ? $feature_detector : new MarkdownFeatureDetector();
	}

	public function register_routes() {
		register_rest_route(
			'easymde/v1',
			'/preview',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'handle_request' ),
				'permission_callback' => array( $this->capabilities, 'can_preview' ),
				'args'                => array(
					'markdown'       => array(
						'type'              => 'string',
						'required'          => true,
						'sanitize_callback' => array( $this, 'sanitize_string' ),
					),
					'post_id'        => array(
						'type'              => 'integer',
						'required'          => false,
						'sanitize_callback' => 'absint',
					),
					'markdown_theme' => array(
						'type'              => 'string',
						'required'          => false,
						'sanitize_callback' => 'sanitize_key',
					),
					'code_theme'     => array(
						'type'              => 'string',
						'required'          => false,
						'sanitize_callback' => 'sanitize_key',
					),
					'custom_css_id'  => array(
						'type'              => 'string',
						'required'          => false,
						'sanitize_callback' => 'sanitize_key',
					),
				),
			)
		);
	}

	public function handle_request( WP_REST_Request $request ) {
		$markdown = (string) $request->get_param( 'markdown' );
		if ( strlen( $markdown ) > self::MAX_MARKDOWN_BYTES ) {
			return new WP_Error(
				'easymde_markdown_too_large',
				__( 'Markdown preview content is too large.', 'easymde' ),
				array( 'status' => 413 )
			);
		}

		if ( ! MarkdownRenderer::is_available() ) {
			return new WP_Error(
				'easymde_commonmark_unavailable',
				__( 'Markdown rendering is unavailable because Composer dependencies are missing.', 'easymde' ),
				array( 'status' => 500 )
			);
		}

		$markdown_theme = $this->theme_state_repository->sanitize_markdown_theme_id( $request->get_param( 'markdown_theme' ) );

		return rest_ensure_response(
			array(
				'html'     => MarkdownRenderer::render( $markdown, $markdown_theme ),
				'features' => $this->feature_detector->detect( $markdown ),
			)
		);
	}

	public function sanitize_string( $value ) {
		return (string) $value;
	}
}
