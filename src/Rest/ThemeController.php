<?php

namespace EasyMDE\Rest;

use EasyMDE\Support\Capabilities;
use EasyMDE\Theme\ThemeStateRepository;
use WP_REST_Request;
use WP_REST_Server;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class ThemeController {

	private $capabilities;
	private $theme_state_repository;

	public function __construct( Capabilities $capabilities, ThemeStateRepository $theme_state_repository ) {
		$this->capabilities           = $capabilities;
		$this->theme_state_repository = $theme_state_repository;
	}

	public function register_routes() {
		register_rest_route(
			'easymde/v1',
			'/theme-options',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'handle_request' ),
				'permission_callback' => array( $this->capabilities, 'can_preview' ),
				'args'                => array(
					'post_id' => array(
						'type'              => 'integer',
						'required'          => false,
						'sanitize_callback' => 'absint',
					),
				),
			)
		);
	}

	public function handle_request( WP_REST_Request $request ) {
		$post_id = absint( $request->get_param( 'post_id' ) );

		return rest_ensure_response( $this->theme_state_repository->get_theme_options_for_script( $post_id ) );
	}
}
