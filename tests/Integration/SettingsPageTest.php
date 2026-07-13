<?php

use EasyMDE\Admin\SettingsPage;
use EasyMDE\Support\Options;
use EasyMDE\Support\ToolbarRegistry;

final class SettingsPageTest extends WP_UnitTestCase
{
    public function tear_down()
    {
        delete_option(Options::EDITOR_SETTINGS);
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

    private function settings_page()
    {
        return new SettingsPage(new ToolbarRegistry(), new Options());
    }
}
