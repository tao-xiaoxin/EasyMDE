<?php

namespace EasyMDE\Rest;

use EasyMDE\Support\Capabilities;
use EasyMDE\Theme\CustomCssPolicy;
use EasyMDE\Theme\ThemeStateRepository;
use WP_Error;
use WP_REST_Request;
use WP_REST_Server;

if (!defined('ABSPATH')) {
    exit;
}

final class CustomCssController
{
    private $capabilities;
    private $theme_state_repository;
    private $custom_css_policy;

    public function __construct(
        Capabilities $capabilities,
        ThemeStateRepository $theme_state_repository,
        CustomCssPolicy $custom_css_policy
    ) {
        $this->capabilities = $capabilities;
        $this->theme_state_repository = $theme_state_repository;
        $this->custom_css_policy = $custom_css_policy;
    }

    public function register_routes()
    {
        register_rest_route(
            'easymde/v1',
            '/custom-css',
            array(
                'methods' => WP_REST_Server::CREATABLE,
                'callback' => array($this, 'handle_save_request'),
                'permission_callback' => array($this->capabilities, 'can_manage_custom_css'),
                'args' => array(
                    'id' => array(
                        'type' => 'string',
                        'required' => false,
                        'sanitize_callback' => 'sanitize_key',
                    ),
                    'name' => array(
                        'type' => 'string',
                        'required' => true,
                        'sanitize_callback' => 'sanitize_text_field',
                    ),
                    'css' => array(
                        'type' => 'string',
                        'required' => true,
                        'sanitize_callback' => array($this, 'sanitize_css_input'),
                    ),
                ),
            )
        );

        register_rest_route(
            'easymde/v1',
            '/custom-css/(?P<id>[a-z0-9_-]+)',
            array(
                'methods' => WP_REST_Server::DELETABLE,
                'callback' => array($this, 'handle_delete_request'),
                'permission_callback' => array($this->capabilities, 'can_delete_custom_css'),
                'args' => array(
                    'id' => array(
                        'type' => 'string',
                        'required' => true,
                        'sanitize_callback' => 'sanitize_key',
                    ),
                ),
            )
        );
    }

    public function handle_save_request(WP_REST_Request $request)
    {
        $user_id = get_current_user_id();
        $name = sanitize_text_field((string) $request->get_param('name'));
        $id = sanitize_key((string) $request->get_param('id'));
        $css = $this->custom_css_policy->normalize_for_storage((string) $request->get_param('css'));

        if (is_wp_error($css)) {
            return $css;
        }

        if ('' === $name || '' === trim($css)) {
            return new WP_Error(
                'easymde_invalid_custom_css',
                __('CSS name and CSS content are required.', 'easymde'),
                array('status' => 400)
            );
        }

        $library = $this->theme_state_repository->get_custom_css_library($user_id);
        if ('' === $id || !isset($library[$id])) {
            $id = $this->theme_state_repository->unique_custom_css_id($name, $library);
        }

        foreach ($library as $existing_id => $item) {
            if ($existing_id !== $id && 0 === strcasecmp($item['name'], $name)) {
                return new WP_Error(
                    'easymde_duplicate_custom_css_name',
                    __('A custom CSS style with this name already exists.', 'easymde'),
                    array('status' => 409)
                );
            }
        }

        $library[$id] = array(
            'id' => $id,
            'name' => $name,
            'css' => $css,
            'updatedAt' => time(),
        );

        $this->theme_state_repository->update_custom_css_library($user_id, $library);

        return rest_ensure_response(
            array(
                'item' => $this->theme_state_repository->format_custom_css_item($library[$id]),
                'customCss' => array_values(array_map(array($this->theme_state_repository, 'format_custom_css_item'), $library)),
            )
        );
    }

    public function handle_delete_request(WP_REST_Request $request)
    {
        $user_id = get_current_user_id();
        $id = sanitize_key((string) $request->get_param('id'));
        $library = $this->theme_state_repository->get_custom_css_library($user_id);

        if (!isset($library[$id])) {
            return new WP_Error(
                'easymde_custom_css_not_found',
                __('Custom CSS style not found.', 'easymde'),
                array('status' => 404)
            );
        }

        unset($library[$id]);
        $this->theme_state_repository->update_custom_css_library($user_id, $library);

        return rest_ensure_response(
            array(
                'customCss' => array_values(array_map(array($this->theme_state_repository, 'format_custom_css_item'), $library)),
            )
        );
    }

    public function sanitize_css_input($value)
    {
        return (string) $value;
    }
}
