<?php

use EasyMDE\Support\Options;
use EasyMDE\Support\SettingsCenterRepository;
use EasyMDE\Support\ToolbarRegistry;

final class SettingsCenterRepositoryTest extends WP_UnitTestCase
{
    public function set_up()
    {
        parent::set_up();
        delete_option(Options::EDITOR_SETTINGS);
    }

    public function tear_down()
    {
        global $wp_rest_server;

        delete_option(Options::EDITOR_SETTINGS);
        wp_set_current_user(0);
        $wp_rest_server = null;
        parent::tear_down();
    }

    public function test_update_persists_settings_and_maps_shortcuts_to_editor_commands()
    {
        $repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
        $settings = $repository->get_settings();
        $settings['general']['autoSave'] = false;
        $settings['shortcuts']['values']['save']['windows'] = 'Ctrl+Shift+S';

        $saved = $repository->update_settings($settings);

        $this->assertIsArray($saved);
        $this->assertFalse($saved['general']['autoSave']);
        $this->assertSame('Ctrl+Shift+S', $saved['shortcuts']['values']['save']['windows']);
        $this->assertSame(1, $saved['revision']);
        $stored = get_option(Options::EDITOR_SETTINGS);
        $this->assertSame('Ctrl+Shift+S', $stored['shortcuts']['savepost']['win']);
        $this->assertSame($saved, $repository->get_settings());
    }

    public function test_upload_format_runtime_contract_uses_only_enabled_formats()
    {
        $repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
        $settings = $repository->get_settings();
        $settings['images']['uploadFormats'] = array(
            'jpg' => false,
            'png' => true,
            'webp' => false,
            'gif' => false,
        );

        $this->assertIsArray($repository->update_settings($settings));
        $this->assertSame(array('image/png'), $repository->get_allowed_image_mime_types());
    }

    public function test_get_settings_normalizes_legacy_values_without_writing_or_exposing_secrets()
    {
        $legacy = array(
            'version' => '0.1.8',
            'settings_center' => array(
                'images' => array(
                    'service' => 'Cloudflare R2',
                    'accessKey' => 'synthetic-access-key',
                    'secretKey' => 'synthetic-secret-key',
                ),
                'markdown' => array('editorTheme' => 'Follow System'),
            ),
        );
        update_option(Options::EDITOR_SETTINGS, $legacy, false);

        $repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
        $settings = $repository->get_settings();

        $this->assertSame('cloudflare-r2', $settings['images']['service']);
        $this->assertSame('system', $settings['markdown']['editorTheme']);
        $this->assertSame('', $settings['images']['accessKey']);
        $this->assertSame('', $settings['images']['secretKey']);
        $this->assertSame(0, $settings['revision']);
        $this->assertSame($legacy, get_option(Options::EDITOR_SETTINGS));
    }

    public function test_get_settings_imports_legacy_shortcuts_before_first_center_save()
    {
        $legacy = array(
            'shortcuts' => array(
                'savepost' => array('win' => 'Ctrl+Shift+S', 'mac' => 'Cmd+Shift+S'),
                'bold' => array('win' => 'Ctrl+Alt+B', 'mac' => 'Cmd+Option+B'),
            ),
        );
        update_option(Options::EDITOR_SETTINGS, $legacy, false);

        $repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
        $settings = $repository->get_settings();

        $this->assertSame('Ctrl+Shift+S', $settings['shortcuts']['values']['save']['windows']);
        $this->assertSame('Cmd+Shift+S', $settings['shortcuts']['values']['save']['mac']);
        $this->assertSame('Ctrl+Alt+B', $settings['shortcuts']['values']['bold']['windows']);
        $this->assertSame('Cmd+Option+B', $settings['shortcuts']['values']['bold']['mac']);
        $this->assertSame($legacy, get_option(Options::EDITOR_SETTINGS));
    }

    public function test_get_shortcut_config_for_script_maps_center_values_and_keeps_unmanaged_defaults()
    {
        $repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
        $settings = $repository->get_settings();
        $settings['shortcuts']['values']['bold']['windows'] = 'Ctrl+Alt+B';
        $repository->update_settings($settings);

        $shortcuts = $repository->get_shortcut_config_for_script();

        $this->assertSame('Ctrl+Alt+B', $shortcuts['bold']['win']);
        $this->assertSame('Cmd+B', $shortcuts['bold']['mac']);
        $this->assertSame('Alt+Shift+5', $shortcuts['strike']['win']);
    }

    public function test_save_preserves_existing_secrets_and_accepts_explicit_replacements()
    {
        update_option(
            Options::EDITOR_SETTINGS,
            array(
                'settings_center' => array(
                    'images' => array(
                        'accessKey' => 'existing-access-key',
                        'secretKey' => 'existing-secret-key',
                    ),
                ),
            ),
            false
        );
        $repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
        $settings = $repository->get_settings();
        $settings['general']['autoSave'] = false;

        $saved = $repository->update_settings($settings);
        $stored = get_option(Options::EDITOR_SETTINGS);
        $this->assertSame('existing-access-key', $stored['settings_center']['images']['accessKey']);
        $this->assertSame('existing-secret-key', $stored['settings_center']['images']['secretKey']);
        $this->assertSame('', $saved['images']['accessKey']);
        $this->assertSame('', $saved['images']['secretKey']);

        $replacement = $repository->get_settings();
        $replacement['images']['accessKey'] = 'replacement-access-key';
        $replacement['images']['secretKey'] = 'replacement-secret-key';
        $repository->update_settings($replacement);
        $stored = get_option(Options::EDITOR_SETTINGS);
        $this->assertSame('replacement-access-key', $stored['settings_center']['images']['accessKey']);
        $this->assertSame('replacement-secret-key', $stored['settings_center']['images']['secretKey']);
    }

    public function test_shortcuts_preserve_mac_option_and_use_runtime_modifier_order()
    {
        $repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
        $settings = $repository->get_settings();
        $settings['shortcuts']['values']['quote']['mac'] = 'Option+Cmd+Q';
        $settings['shortcuts']['values']['quote']['windows'] = 'Shift+Ctrl+Q';

        $saved = $repository->update_settings($settings);

        $this->assertSame('Cmd+Option+Q', $saved['shortcuts']['values']['quote']['mac']);
        $this->assertSame('Ctrl+Shift+Q', $saved['shortcuts']['values']['quote']['windows']);
        $stored = get_option(Options::EDITOR_SETTINGS);
        $this->assertSame('Cmd+Option+Q', $stored['shortcuts']['quote']['mac']);
        $this->assertSame('Ctrl+Shift+Q', $stored['shortcuts']['quote']['win']);
    }

    public function test_stale_revision_is_rejected_without_clobbering_newer_settings()
    {
        $repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
        $first = $repository->get_settings();
        $second = $repository->get_settings();
        $first['general']['autoSave'] = false;
        $this->assertIsArray($repository->update_settings($first));

        $second['general']['autoSave'] = true;
        $result = $repository->update_settings($second);

        $this->assertWPError($result);
        $this->assertSame('easymde_settings_conflict', $result->get_error_code());
        $this->assertSame(409, $result->get_error_data()['status']);
        $this->assertFalse($repository->get_settings()['general']['autoSave']);
    }

    public function test_compare_and_swap_rejects_a_case_only_concurrent_snapshot()
    {
        $options = new Options();
        update_option(
            Options::EDITOR_SETTINGS,
            array( 'case_marker' => 'lowercase' ),
            false
        );
        $expected = $options->get_editor_settings_snapshot();
        $current  = $expected;
        $current['case_marker'] = 'LOWERCASE';
        update_option( Options::EDITOR_SETTINGS, $current, false );

        $next                = $expected;
        $next['case_marker'] = 'replacement';

        $this->assertFalse( $options->compare_and_swap_editor_settings( $expected, $next ) );
        $this->assertTrue( $options->last_compare_and_swap_was_conflict() );
        $this->assertSame( $current, get_option( Options::EDITOR_SETTINGS ) );
    }

    public function test_option_write_failure_is_reported_as_an_error()
    {
        $repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
        $settings   = $repository->get_settings();
        $this->assertIsArray($repository->update_settings($settings));
        $settings = $repository->get_settings();

        global $wpdb;
        $options_table = $wpdb->options;
        $wpdb->suppress_errors(true);
        $wpdb->options = $options_table . '_missing';

        try {
            $result = $repository->update_settings($settings);
        } finally {
            $wpdb->options = $options_table;
            $wpdb->suppress_errors(false);
            wp_cache_flush();
        }

        $this->assertWPError($result);
        $this->assertSame('easymde_settings_persistence_failed', $result->get_error_code());
        $this->assertSame(500, $result->get_error_data()['status']);
    }
    public function test_settings_enums_use_stable_ids_and_migrate_legacy_labels()
    {
        $repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
        $settings = $repository->get_settings();

        $this->assertSame('cloudflare-r2', $settings['images']['service']);
        $this->assertSame('system', $settings['markdown']['editorTheme']);

        $settings['images']['service'] = 'Cloudflare R2';
        $settings['images']['retryCount'] = 'Retry once';
        $settings['images']['insertFormat'] = 'html';
        $settings['markdown']['editorTheme'] = 'Follow System';
        $saved = $repository->update_settings($settings);

        $this->assertSame('cloudflare-r2', $saved['images']['service']);
        $this->assertSame('once', $saved['images']['retryCount']);
        $this->assertSame('markdown', $saved['images']['insertFormat']);
        $this->assertSame('system', $saved['markdown']['editorTheme']);
    }


    public function test_invalid_shortcut_fails_without_writing_the_editor_option()
    {
        $repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
        $before = get_option(Options::EDITOR_SETTINGS, array());
        $settings = $repository->get_settings();
        $settings['shortcuts']['values']['save']['windows'] = 'Alt+S';

        $result = $repository->update_settings($settings);

        $this->assertWPError($result);
        $this->assertSame('easymde_settings_invalid_shortcut', $result->get_error_code());
        $this->assertSame($before, get_option(Options::EDITOR_SETTINGS, array()));
    }

    public function test_rest_update_requires_manage_options_and_returns_sanitized_settings()
    {
        global $wp_rest_server;
        $wp_rest_server = new WP_REST_Server();
        do_action('rest_api_init');

        $administrator_id = self::factory()->user->create(array('role' => 'administrator'));
        wp_set_current_user($administrator_id);
        $repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
        $settings = $repository->get_settings();
        $settings['general']['autoSave'] = false;

        $request = new WP_REST_Request('POST', '/easymde/v1/settings');
        $request->set_header('X-EasyMDE-Settings-Nonce', wp_create_nonce('easymde_update_settings'));
        $request->set_body_params(array('settings' => $settings));
        $response = rest_do_request($request);

        $this->assertSame(200, $response->get_status());
        $this->assertFalse($response->get_data()['settings']['general']['autoSave']);

        $subscriber_id = self::factory()->user->create(array('role' => 'subscriber'));
        wp_set_current_user($subscriber_id);
        $request->set_header('X-EasyMDE-Settings-Nonce', wp_create_nonce('easymde_update_settings'));
        $forbidden = rest_do_request($request);
        $this->assertSame(403, $forbidden->get_status());
        $this->assertSame('easymde_rest_cannot_manage_settings', $forbidden->as_error()->get_error_code());
    }

    public function test_rest_update_rejects_disabling_every_upload_format()
    {
        global $wp_rest_server;
        $wp_rest_server = new WP_REST_Server();
        do_action('rest_api_init');

        $administrator_id = self::factory()->user->create(array('role' => 'administrator'));
        wp_set_current_user($administrator_id);
        $repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
        $settings = $repository->get_settings();
        $settings['images']['uploadFormats'] = array(
            'jpg' => false,
            'png' => false,
            'webp' => false,
            'gif' => false,
        );

        $request = new WP_REST_Request('POST', '/easymde/v1/settings');
        $request->set_header('X-EasyMDE-Settings-Nonce', wp_create_nonce('easymde_update_settings'));
        $request->set_body_params(array('settings' => $settings));
        $response = rest_do_request($request);

        $this->assertSame(400, $response->get_status());
        $this->assertSame('easymde_settings_invalid_payload', $response->as_error()->get_error_code());
    }
}
