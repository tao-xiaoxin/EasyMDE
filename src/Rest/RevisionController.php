<?php

namespace EasyMDE\Rest;

use EasyMDE\Content\MarkdownRenderer;
use EasyMDE\Content\MarkdownFeatureDetector;
use EasyMDE\Content\PostDocument;
use EasyMDE\Support\Capabilities;
use WP_Error;
use WP_REST_Request;
use WP_REST_Server;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class RevisionController {

	const MAX_REVISIONS      = 50;
	const MAX_MARKDOWN_BYTES = 1048576;

	private $capabilities;
	private $post_document;
	private $feature_detector;

	public function __construct(
		Capabilities $capabilities,
		PostDocument $post_document,
		?MarkdownFeatureDetector $feature_detector = null
	) {
		$this->capabilities     = $capabilities;
		$this->post_document    = $post_document;
		$this->feature_detector = $feature_detector ? $feature_detector : new MarkdownFeatureDetector();
	}

	public function register_routes() {
		$common_args = array(
			'post_id' => array(
				'type'              => 'integer',
				'required'          => true,
				'sanitize_callback' => 'absint',
			),
		);

		register_rest_route(
			'easymde/v1',
			'/posts/(?P<post_id>\d+)/revisions',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'list_revisions' ),
				'permission_callback' => array( $this, 'can_read_revisions' ),
				'args'                => $common_args,
			)
		);

		register_rest_route(
			'easymde/v1',
			'/posts/(?P<post_id>\d+)/revisions/(?P<revision_id>\d+)',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_revision' ),
				'permission_callback' => array( $this, 'can_read_revisions' ),
				'args'                => array_merge(
					$common_args,
					array(
						'revision_id' => array(
							'type'              => 'integer',
							'required'          => true,
							'sanitize_callback' => 'absint',
						),
					)
				),
			)
		);
	}

	public function can_read_revisions( WP_REST_Request $request ) {
		$post_id = absint( $request->get_param( 'post_id' ) );

		return $this->capabilities->can_edit_post( $post_id )
			? true
			: new WP_Error(
				'easymde_rest_cannot_edit_post',
				__( 'You are not allowed to perform this EasyMDE action.', 'easymde' ),
				array( 'status' => is_user_logged_in() ? 403 : 401 )
			);
	}

	public function list_revisions( WP_REST_Request $request ) {
		$post_id = absint( $request->get_param( 'post_id' ) );
		$post    = get_post( $post_id );

		if ( ! $post || ! $this->post_document->is_supported_post_type( $post->post_type ) ) {
			return $this->not_found();
		}

		$revisions = wp_get_post_revisions(
			$post_id,
			array(
				'order'          => 'DESC',
				'orderby'        => 'date ID',
				'posts_per_page' => self::MAX_REVISIONS,
				'check_enabled'  => false,
			)
		);

		return rest_ensure_response(
			array(
				'revisions' => array_values( array_map( array( $this, 'format_revision' ), $revisions ) ),
			)
		);
	}

	public function get_revision( WP_REST_Request $request ) {
		$post_id     = absint( $request->get_param( 'post_id' ) );
		$revision_id = absint( $request->get_param( 'revision_id' ) );
		$post        = get_post( $post_id );
		$revision    = get_post( $revision_id );

		if (
			! $post
			|| ! $this->post_document->is_supported_post_type( $post->post_type )
			|| ! $revision
			|| 'revision' !== $revision->post_type
			|| $post_id !== (int) $revision->post_parent
		) {
			return $this->not_found();
		}

		$markdown = $this->post_document->get_markdown( $revision );
		if ( strlen( $markdown ) > self::MAX_MARKDOWN_BYTES ) {
			return new WP_Error(
				'easymde_revision_too_large',
				__( 'The selected revision is too large to preview.', 'easymde' ),
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

		$theme = metadata_exists( 'post', $revision_id, PostDocument::META_MARKDOWN_THEME )
			? (string) get_post_meta( $revision_id, PostDocument::META_MARKDOWN_THEME, true )
			: '';

		return rest_ensure_response(
			array(
				'id'       => $revision_id,
				'html'     => MarkdownRenderer::render( $markdown, $theme ),
				'features' => $this->feature_detector->detect( $markdown ),
			)
		);
	}

	public function format_revision( $revision ) {
		return array(
			'id'    => (int) $revision->ID,
			'title' => get_the_title( $revision ),
			'date'  => mysql_to_rfc3339( $revision->post_date ),
			'type'  => wp_is_post_autosave( $revision ) ? 'auto' : 'manual',
		);
	}

	private function not_found() {
		return new WP_Error(
			'easymde_revision_not_found',
			__( 'The requested revision could not be found.', 'easymde' ),
			array( 'status' => 404 )
		);
	}
}
