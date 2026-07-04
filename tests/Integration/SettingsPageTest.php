<?php

use EasyMDE\Admin\SettingsPage;
use EasyMDE\Support\Options;
use EasyMDE\Support\ToolbarRegistry;

final class SettingsPageTest extends WP_UnitTestCase
{
    public function tear_down()
    {
        delete_option(Options::EDITOR_SETTINGS);

        parent::tear_down();
    }

    public function test_editor_spellcheck_setting_defaults_to_disabled()
    {
        $settings = $this->settings_page()->get_editor_settings();

        $this->assertSame(0, $settings['spellcheck_enabled']);
    }

    public function test_sanitize_editor_settings_stores_spellcheck_checkbox_as_integer_flag()
    {
        $settings_page = $this->settings_page();

        $enabled = $settings_page->sanitize_editor_settings(
            array(
                'spellcheck_enabled' => '1',
            )
        );
        $disabled = $settings_page->sanitize_editor_settings(array());

        $this->assertSame(1, $enabled['spellcheck_enabled']);
        $this->assertSame(0, $disabled['spellcheck_enabled']);
    }

    public function test_editor_settings_reads_stored_spellcheck_flag()
    {
        update_option(
            Options::EDITOR_SETTINGS,
            array(
                'spellcheck_enabled' => '1',
            )
        );

        $settings = $this->settings_page()->get_editor_settings();

        $this->assertSame(1, $settings['spellcheck_enabled']);
    }

    private function settings_page()
    {
        return new SettingsPage(new ToolbarRegistry(), new Options());
    }
}
