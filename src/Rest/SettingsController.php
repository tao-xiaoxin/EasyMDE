<?php

namespace EasyMDE\Rest;

use EasyMDE\Support\Capabilities;
use EasyMDE\Support\SettingsCenterRepository;
use WP_REST_Request;
use WP_REST_Server;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class SettingsController {

	private $capabilities;
	private $settings_repository;

	public function __construct( Capabilities $capabilities, SettingsCenterRepository $settings_repository ) {
		$this->capabilities        = $capabilities;
		$this->settings_repository = $settings_repository;
	}

	public function register_routes() {
		$args = array(
			'settings' => array(
				'type'     => 'object',
				'required' => true,
			),
		);

		register_rest_route(
			'easymde/v1',
			'/settings',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'handle_get_request' ),
				'permission_callback' => array( $this->capabilities, 'can_manage_settings' ),
			)
		);

		register_rest_route(
			'easymde/v1',
			'/settings',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'handle_update_request' ),
				'permission_callback' => array( $this->capabilities, 'can_manage_settings' ),
				'args'                => $args,
			)
		);
	}

	public function handle_get_request( WP_REST_Request $request ) {
		unset( $request );

		return rest_ensure_response(
			array(
				'settings' => $this->settings_repository->get_settings(),
			)
		);
	}

	public function handle_update_request( WP_REST_Request $request ) {
		$settings = $request->get_param( 'settings' );
		$result   = $this->settings_repository->update_settings( $settings );

		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return rest_ensure_response( array( 'settings' => $result ) );
	}
}
