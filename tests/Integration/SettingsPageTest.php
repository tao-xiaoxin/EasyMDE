<?php

use EasyMDE\Admin\SettingsPage;
use EasyMDE\Support\Options;
use EasyMDE\Support\ToolbarRegistry;

final class SettingsPageTest extends WP_UnitTestCase
{
    public function tear_down()
    {
        delete_option(Options::EDITOR_SETTINGS);
        wp_dequeue_script('easymde-admin-settings-center');
        wp_dequeue_style('easymde-admin-settings-center');
        wp_set_current_user(0);

        parent::tear_down();
    }

    public function test_active_editor_settings_schema_ignores_legacy_spellcheck_value_without_writing()
    {
        $stored = array(
            'version' => '0.1.8',
            'toolbar_layout' => 'hybrid-icons',
            'spellcheck_enabled' => 1,
        );
        update_option(Options::EDITOR_SETTINGS, $stored);

        $settings = $this->settings_page()->get_editor_settings();

        $this->assertArrayNotHasKey('spellcheck_enabled', $settings);
        $this->assertSame('hybrid-icons', $settings['toolbar_layout']);
        $this->assertNotEmpty($settings['shortcuts']);
        $this->assertSame($stored, get_option(Options::EDITOR_SETTINGS));
    }

    public function test_sanitize_editor_settings_discards_legacy_spellcheck_value_without_changing_shortcuts()
    {
        $settings_page = $this->settings_page();

        $with_legacy_value = $settings_page->sanitize_editor_settings(
            array(
                'spellcheck_enabled' => '1',
            )
        );
        $without_legacy_value = $settings_page->sanitize_editor_settings(array());

        $this->assertArrayNotHasKey('spellcheck_enabled', $with_legacy_value);
        $this->assertSame($without_legacy_value, $with_legacy_value);
        $this->assertNotEmpty($with_legacy_value['shortcuts']);
    }

    public function test_settings_page_does_not_render_legacy_spellcheck_control_or_mutate_option()
    {
        $stored = array(
            'version' => '0.1.8',
            'toolbar_layout' => 'hybrid-icons',
            'spellcheck_enabled' => '1',
        );
        update_option(Options::EDITOR_SETTINGS, $stored);
        wp_set_current_user(self::factory()->user->create(array('role' => 'administrator')));

        ob_start();
        $this->settings_page()->render();
        $output = ob_get_clean();

        $this->assertStringNotContainsString('easymde-spellcheck-enabled', $output);
        $this->assertStringNotContainsString('Enable browser spellcheck in the Markdown editor', $output);
        $this->assertStringContainsString('Shortcut settings', $output);
        $this->assertSame($stored, get_option(Options::EDITOR_SETTINGS));
    }

    public function test_settings_center_renders_an_independent_root_without_writing_settings()
    {
        $stored = array(
            'version' => '0.1.8',
            'toolbar_layout' => 'hybrid-icons',
        );
        update_option(Options::EDITOR_SETTINGS, $stored);
        wp_set_current_user(self::factory()->user->create(array('role' => 'administrator')));

        ob_start();
        $this->settings_page()->render_settings_center();
        $output = ob_get_clean();

        $this->assertStringContainsString('id="easymde-settings-center-root"', $output);
        $this->assertSame($stored, get_option(Options::EDITOR_SETTINGS));
    }

    public function test_settings_center_renders_nothing_without_manage_options()
    {
        wp_set_current_user(self::factory()->user->create(array('role' => 'subscriber')));

        ob_start();
        $this->settings_page()->render_settings_center();
        $output = ob_get_clean();

        $this->assertSame('', $output);
    }

    public function test_settings_center_bootstrap_uses_local_assets_and_translated_php_strings()
    {
        $settings_page = $this->settings_page();
        $method = new ReflectionMethod(SettingsPage::class, 'get_settings_center_bootstrap');
        $method->setAccessible(true);

        $bootstrap = $method->invoke($settings_page);

        $this->assertSame(1, $bootstrap['schemaVersion']);
        $this->assertSame(
            admin_url('options-general.php?page=easymde'),
            $bootstrap['closeUrl']
        );
        $this->assertStringContainsString(
            '/assets/images/settings-center/brand-icon-clean.png',
            $bootstrap['assets']['brandMarkUrl']
        );
        $this->assertStringContainsString(
            '/assets/images/settings-center/header-illustration.png',
            $bootstrap['assets']['headerIllustrationUrl']
        );
        $this->assertStringContainsString(
            '/assets/images/settings-center/search-empty-illustration.png',
            $bootstrap['assets']['searchEmptyIllustrationUrl']
        );
        $this->assertSame('EasyMDE', $bootstrap['strings']['brandName']);
        $this->assertSame('General Settings', $bootstrap['strings']['general']);
        $this->assertArrayNotHasKey('testingConnection', $bootstrap['strings']);
        $this->assertArrayNotHasKey('connected', $bootstrap['strings']);
        $this->assertArrayNotHasKey('lastTest', $bootstrap['strings']);
        $this->assertCount(209, $bootstrap['strings']);
    }

    public function test_settings_center_assets_load_only_on_the_independent_screen()
    {
        wp_set_current_user(self::factory()->user->create(array('role' => 'administrator')));
        $settings_page = $this->settings_page();

        $settings_page->enqueue_assets('settings_page_easymde');
        $this->assertFalse(wp_script_is('easymde-admin-settings-center', 'enqueued'));

        $settings_page->enqueue_assets('toplevel_page_easymde-settings-center');

        $this->assertTrue(wp_script_is('easymde-admin-settings-center', 'enqueued'));
        $this->assertTrue(wp_style_is('easymde-admin-settings-center', 'enqueued'));
        $this->assertNotEmpty(
            wp_scripts()->get_data('easymde-admin-settings-center', 'before')
        );
    }

    private function settings_page()
    {
        return new SettingsPage(new ToolbarRegistry(), new Options());
    }
}
