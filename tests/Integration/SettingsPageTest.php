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

    public function test_legacy_settings_save_preserves_settings_center_state()
    {
        $stored = array(
            'version' => '0.1.8',
            'settings_center' => array(
                'general' => array('autoSave' => false),
            ),
        );
        update_option(Options::EDITOR_SETTINGS, $stored);

        $sanitized = $this->settings_page()->sanitize_editor_settings(array());

        $invalid = $this->settings_page()->sanitize_editor_settings(
            array('shortcuts' => array('savepost' => array('win' => 'S')))
        );

        $this->assertSame($stored['settings_center'], $invalid['settings_center']);

        $this->assertSame($stored['settings_center'], $sanitized['settings_center']);
    }

    public function test_legacy_settings_save_preserves_center_revision_and_syncs_submitted_shortcuts()
    {
        update_option(
            Options::EDITOR_SETTINGS,
            array(
                'version' => '0.1.8',
                'settings_center' => array(
                    'shortcuts' => array(
                        'values' => array(
                            'save' => array(
                                'windows' => 'Ctrl+S',
                                'mac'     => 'Cmd+S',
                            ),
                        ),
                    ),
                ),
                'settings_center_revision' => 4,
                'shortcuts' => array(
                    'savepost' => array(
                        'win' => 'Ctrl+S',
                        'mac' => 'Cmd+S',
                    ),
                ),
            )
        );

        $sanitized = $this->settings_page()->sanitize_editor_settings(
            array(
                'shortcuts' => array(
                    'savepost' => array(
                        'win' => 'Ctrl+Shift+S',
                        'mac' => 'Cmd+Shift+S',
                    ),
                ),
            )
        );

        $this->assertSame( 5, $sanitized['settings_center_revision'] );
        $this->assertSame( 'Ctrl+Shift+S', $sanitized['settings_center']['shortcuts']['values']['save']['windows'] );
        $this->assertSame( 'Cmd+Shift+S', $sanitized['settings_center']['shortcuts']['values']['save']['mac'] );
    }

    public function test_legacy_settings_api_stale_snapshot_cannot_overwrite_a_newer_center_save()
    {
        $page = $this->settings_page();
        $page->register_hooks();
        $repository = new \EasyMDE\Support\SettingsCenterRepository( new Options(), new ToolbarRegistry() );

        try {
            $legacy_value = $page->sanitize_editor_settings(
                array(
                    'shortcuts' => array(
                        'savepost' => array(
                            'win' => 'Ctrl+Shift+S',
                            'mac' => 'Cmd+Shift+S',
                        ),
                    ),
                )
            );
            $newer = $repository->get_settings();
            $newer['general']['autoSave'] = false;
            $this->assertIsArray( $repository->update_settings( $newer ) );
            $before = get_option( Options::EDITOR_SETTINGS );

            update_option( Options::EDITOR_SETTINGS, $legacy_value, false );

            $after = get_option( Options::EDITOR_SETTINGS );
            $this->assertSame( $before, $after );
            $this->assertFalse( $after['settings_center']['general']['autoSave'] );
            $this->assertSame( 'Ctrl+S', $after['shortcuts']['savepost']['win'] );
        } finally {
            remove_filter( 'pre_update_option_' . Options::EDITOR_SETTINGS, array( $page, 'intercept_legacy_settings_update' ), 10 );
        }
    }

    public function test_legacy_settings_api_write_uses_repository_revision_and_cas()
    {
        $page = $this->settings_page();
        $page->register_hooks();

        try {
            $legacy_value = $page->sanitize_editor_settings(
                array(
                    'shortcuts' => array(
                        'savepost' => array(
                            'win' => 'Ctrl+Shift+S',
                            'mac' => 'Cmd+Shift+S',
                        ),
                    ),
                )
            );

            update_option( Options::EDITOR_SETTINGS, $legacy_value, false );

            $stored = get_option( Options::EDITOR_SETTINGS );
            $this->assertSame( 1, $stored['settings_center_revision'] );
            $this->assertSame( 'Ctrl+Shift+S', $stored['shortcuts']['savepost']['win'] );
            $this->assertSame( 'Cmd+Shift+S', $stored['shortcuts']['savepost']['mac'] );
            $this->assertSame(
                'Ctrl+Shift+S',
                $stored['settings_center']['shortcuts']['values']['save']['windows']
            );
        } finally {
            remove_filter( 'pre_update_option_' . Options::EDITOR_SETTINGS, array( $page, 'intercept_legacy_settings_update' ), 10 );
        }
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

        $this->assertSame(2, $bootstrap['schemaVersion']);
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
        $this->assertSame('', $bootstrap['drafts']['images']['domain']);
        $this->assertNotEmpty( $bootstrap['api']['actionNonce'] );
        $this->assertArrayNotHasKey('testingConnection', $bootstrap['strings']);
        $this->assertArrayHasKey('pendingTest', $bootstrap['strings']);
        $this->assertArrayNotHasKey('connected', $bootstrap['strings']);
        $this->assertArrayNotHasKey('lastTest', $bootstrap['strings']);
        $this->assertArrayHasKey('promptManagement', $bootstrap['strings']);
        $this->assertArrayHasKey('transferExportConfiguration', $bootstrap['strings']);
        $this->assertArrayHasKey('transferConfigurationManagement', $bootstrap['strings']);
        $this->assertArrayHasKey('transferIntegrationPendingNotice', $bootstrap['strings']);
        $this->assertArrayHasKey('aboutVersionInformation', $bootstrap['strings']);
        $this->assertArrayHasKey('aboutPluginIntroduction', $bootstrap['strings']);
        $this->assertArrayHasKey('saveSettings', $bootstrap['strings']);
        $this->assertArrayNotHasKey('ai', $bootstrap['drafts']);
        $required_string_keys = array(
            'brandName', 'settingsCenter', 'settingsNavigation', 'helpTitle', 'helpDescription',
            'openDocumentation', 'closeSettingsCenter', 'searchSettings', 'searchSettingsPlaceholder',
            'clearSearch', 'searchPageTitle', 'searchPageDescription', 'searchResults',
            'searchResultCount', 'noSearchResults', 'noSearchResultsDescription', 'general',
            'shortcuts', 'images', 'markdown', 'transfer', 'about', 'generalDescription',
            'shortcutsDescription', 'imagesDescription', 'markdownDescription', 'transferDescription',
            'transferPageTitle', 'aboutDescription', 'sectionPending', 'sectionPendingDescription',
            'saveSettings', 'savingSettings', 'settingsSaved', 'settingsSaveFailed',
            'settingsUnsavedChanges', 'pendingTest', 'currentAllowedUploads', 'insertFileNameVariable',
            'transferExportConfiguration', 'transferConfigurationManagement', 'transferIntegrationPendingNotice',
            'transferFileSelectedNotice', 'transferChecksSummary', 'transferChecksPassed',
            'aboutVersionInformation', 'aboutPluginIntroduction', 'editPrompt', 'duplicatePrompt',
            'deletePrompt', 'promptCategoryEmpty', 'deletePromptConfirmation', 'promptCreated',
            'promptSaved', 'promptDuplicated', 'promptDeleted', 'promptImportSuccess',
            'aboutVersionInformation', 'aboutPluginIntroduction',
        );
        foreach ( $required_string_keys as $key ) {
            $this->assertArrayHasKey( $key, $bootstrap['strings'] );
            $this->assertIsString( $bootstrap['strings'][ $key ] );
            $this->assertNotSame( '', $bootstrap['strings'][ $key ] );
        }
    }

    public function test_settings_center_assets_load_only_on_the_independent_screen()
    {
        wp_set_current_user(self::factory()->user->create(array('role' => 'administrator')));
        $settings_page = $this->settings_page();

        $settings_page->enqueue_assets('settings_page_easymde');
        $this->assertFalse(wp_script_is('easymde-admin-settings-center', 'enqueued'));

        $settings_page->enqueue_assets('toplevel_page_easymde/settings/general');

        $this->assertTrue(wp_script_is('easymde-admin-settings-center', 'enqueued'));
        $this->assertTrue(wp_style_is('easymde-admin-settings-center', 'enqueued'));
        $this->assertNotEmpty(
            wp_scripts()->get_data('easymde-admin-settings-center', 'before')
        );
    }

    public function test_admin_menu_uses_the_stable_settings_route_local_logo_and_native_updates_page()
    {
        wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
        $settings_page_slug = 'easymde/settings/general';

        $this->settings_page()->register_admin_menu();

        global $menu, $submenu;
        $menu_item = $this->find_menu_item( $menu, $settings_page_slug );
        $this->assertSame( 'EasyMDE', $menu_item[0] );
        $this->assertStringContainsString( '/assets/images/easymde-editor-icon.png', $menu_item[6] );
        $this->assertArrayHasKey( $settings_page_slug, $submenu );
        $this->assertSame( $settings_page_slug, $submenu[ $settings_page_slug ][0][2] );
        $this->assertSame( 'manage_options', $submenu[ $settings_page_slug ][0][1] );
        $this->assertSame( 'update-core.php', $submenu[ $settings_page_slug ][1][2] );
        $this->assertSame( 'update_core', $submenu[ $settings_page_slug ][1][1] );
    }

    private function find_menu_item( array $menu, $slug )
    {
        foreach ( $menu as $item ) {
            if ( isset( $item[2] ) && $slug === $item[2] ) {
                return $item;
            }
        }

        $this->fail( 'Expected WordPress admin menu item was not registered.' );
    }

    private function settings_page()
    {
        return new SettingsPage(new ToolbarRegistry(), new Options());
    }
}
