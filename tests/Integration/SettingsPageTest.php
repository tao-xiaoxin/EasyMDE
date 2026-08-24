<?php

use EasyMDE\Admin\SettingsPage;
use EasyMDE\Support\Options;
use EasyMDE\Support\SettingsCenterRepository;
use EasyMDE\Support\ToolbarRegistry;

final class SettingsPageTest extends WP_UnitTestCase
{
    private $previous_pagenow;

    public function set_up()
    {
        parent::set_up();

        global $menu, $submenu;
        $menu    = array();
        $submenu = array();

        $this->previous_pagenow = array_key_exists('pagenow', $GLOBALS) ? $GLOBALS['pagenow'] : null;
        $GLOBALS['pagenow'] = 'admin.php';
    }

    public function tear_down()
    {
        global $menu, $submenu;

        $menu    = array();
        $submenu = array();

        if (null === $this->previous_pagenow) {
            unset($GLOBALS['pagenow']);
        } else {
            $GLOBALS['pagenow'] = $this->previous_pagenow;
        }

        delete_option(Options::EDITOR_SETTINGS);
        wp_dequeue_style('easymde-admin-menu');
        wp_dequeue_script('easymde-admin-settings-center');
        wp_dequeue_style('easymde-admin-settings-center');
        wp_set_current_user(0);

        parent::tear_down();
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
        $this->assertStringContainsString('data-failure-message=', $output);
        $this->assertStringContainsString('data-settings-center-startup', $output);
        $this->assertStringContainsString('easymde-settings-center__frame', $output);
        $this->assertStringContainsString('easymde-settings-center__sidebar', $output);
        $this->assertStringContainsString('easymde-settings-center__brand-wrap', $output);
        $this->assertStringContainsString('easymde-settings-center__brand', $output);
        $this->assertStringContainsString('data-loading-message=', $output);
        $this->assertStringContainsString('Loading EasyMDE Settings Center', $output);
        $this->assertStringContainsString(esc_url(admin_url('options-general.php')), $output);
        $this->assertStringNotContainsString('options.php', $output);
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
            admin_url('options-general.php'),
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
		$this->assertFalse( $bootstrap['drafts']['images']['primaryCredentialsConfigured'] );
		$this->assertFalse( $bootstrap['drafts']['images']['backupCredentialsConfigured'] );
        $this->assertNotEmpty( $bootstrap['api']['actionNonce'] );
		$this->assertNotEmpty( $bootstrap['api']['imageHostingVerificationActionNonce'] );
		$this->assertStringContainsString(
			'/easymde/v1/image-hosting/verification',
			$bootstrap['api']['imageHostingVerificationUrl']
		);
		$this->assertNotEmpty( $bootstrap['api']['imageHostingSecretRevealActionNonce'] );
		$this->assertStringContainsString(
			'/easymde/v1/image-hosting/secret',
			$bootstrap['api']['imageHostingSecretRevealUrl']
		);
        $this->assertArrayHasKey('settingsUnavailable', $bootstrap['strings']);
        $this->assertArrayNotHasKey('promptManagement', $bootstrap['strings']);
        $this->assertArrayHasKey('transferExportConfiguration', $bootstrap['strings']);
        $this->assertArrayHasKey('transferConfigurationManagement', $bootstrap['strings']);
        $this->assertArrayNotHasKey('transferIntegrationPendingNotice', $bootstrap['strings']);
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
            'settingsUnsavedChanges', 'settingsUnavailable', 'currentAllowedUploads', 'insertFileNameVariable',
			'imageFallbackDomain', 'imageFallbackDomainDescription', 'cosBucketHint',
			'uploadRetryCount', 'uploadRetryCountDescription',
			'duplicateImageHostTitle', 'duplicateImageHostDescription',
            'primaryCredentialsConfigured', 'backupCredentialsConfigured', 'revealingSecret', 'secretRevealFailed',
			'uploadVerificationStatus', 'backupVerificationStatus', 'uploadVerificationPending',
			'verifyingUpload', 'uploadVerified', 'uploadVerificationFailed', 'uploadVerificationStale',
			'lastVerified', 'verifyPrimaryUpload', 'verifyBackupUpload', 'uploadVerificationSucceeded',
			'uploadVerificationSuccessDescription', 'uploadVerificationFailureDescription',
			'uploadVerificationFailureHint', 'insecureViewingDomainWarning',
			'uploadedObjectPath', 'uploadedImageUrl', 'closeImageFeedback',
			'imageHostFailureConfiguration', 'imageHostFailureAuthentication',
            'imageHostFailureAuthorization', 'imageHostFailureNetwork', 'imageHostFailureTimeout',
            'imageHostFailureProvider', 'imageHostFailureInvalidResponse',
            'transferExportConfiguration', 'transferConfigurationManagement',
            'transferFileSelectedNotice', 'transferExportNameInvalid', 'transferChecksSummary', 'transferChecksPassed',
            'aboutVersionInformation', 'aboutPluginIntroduction',
        );
        foreach ( $required_string_keys as $key ) {
            $this->assertArrayHasKey( $key, $bootstrap['strings'] );
            $this->assertIsString( $bootstrap['strings'][ $key ] );
            $this->assertNotSame( '', $bootstrap['strings'][ $key ] );
        }
        $this->assertArrayNotHasKey('uploadDestination', $bootstrap['strings']);
        $this->assertArrayNotHasKey('wordpressMediaLibrary', $bootstrap['strings']);
        $this->assertArrayNotHasKey('remoteImageHost', $bootstrap['strings']);
        $this->assertArrayNotHasKey('customUpload', $bootstrap['strings']);
		foreach (
			array(
				'providerApiEndpoint',
				'backupRetryCount',
				'backupRetryCountDescription',
				'keepSameObjectPath',
				'keepSameObjectPathDescription',
				'backupFailureHandling',
				'backupFailureHandlingDescription',
				'returnPrimaryUrlOnBackupFailure',
				'failEntireUpload',
				'retryFailedUpload',
				'doNotRetry',
				'retryOnce',
			)
			as $removed_image_string
		) {
			$this->assertArrayNotHasKey( $removed_image_string, $bootstrap['strings'] );
		}
		foreach (
			array(
				'r2AccountId',
				'cleanPastedContent',
				'cleanPastedContentDescription',
				'smartListRecognition',
				'smartListRecognitionDescription',
				'defaultCategory',
				'noAutomaticCategory',
				'currentCategory',
			)
			as $removed_key
		) {
			$this->assertArrayNotHasKey($removed_key, $bootstrap['strings']);
		}
		foreach (
			array(
				'markdownLivePreview',
				'livePreviewDescription',
				'fixedToolbar',
				'fixedToolbarDescription',
				'taskLists',
				'taskListsDescription',
				'emoji',
				'emojiDescription',
				'mathSupport',
				'mathSupportDescription',
				'markdownExtensions',
				'tableExtension',
				'tableExtensionDescription',
				'footnotes',
				'footnotesDescription',
				'definitionLists',
				'definitionListsDescription',
				'imageSizeSyntax',
				'imageSizeSyntaxDescription',
			)
			as $removed_key
		) {
			$this->assertArrayNotHasKey($removed_key, $bootstrap['strings']);
		}
		$this->assertArrayHasKey('livePreview', $bootstrap['strings']);
		$this->assertArrayHasKey('math', $bootstrap['strings']);
    }

    public function test_settings_center_bootstrap_projects_one_authoritative_option_snapshot()
    {
        $reads = 0;
        $filter = static function () use ( &$reads ) {
            $reads++;

            return array(
                'settings_center_revision' => 19,
                'settings_center'          => array(
                    'images' => array(
                        'domain'    => 'https://snapshot.example.test',
                        'accessKey' => 'snapshot-access',
                        'secretKey' => 'snapshot-secret',
                    ),
                ),
            );
        };
        add_filter( 'pre_option_' . Options::EDITOR_SETTINGS, $filter );
        $settings_page = $this->settings_page();
        $method = new ReflectionMethod(SettingsPage::class, 'get_settings_center_bootstrap');
        $method->setAccessible(true);

        try {
            $bootstrap = $method->invoke($settings_page);
        } finally {
            remove_filter( 'pre_option_' . Options::EDITOR_SETTINGS, $filter );
        }

        $this->assertSame(1, $reads);
        $this->assertSame(19, $bootstrap['settings']['revision']);
        $this->assertSame('https://snapshot.example.test', $bootstrap['drafts']['images']['domain']);
        $this->assertTrue($bootstrap['drafts']['images']['primaryCredentialsConfigured']);
        $this->assertFalse($bootstrap['drafts']['images']['backupCredentialsConfigured']);
        $this->assertSame('', $bootstrap['settings']['images']['accessKey']);
        $this->assertSame('', $bootstrap['settings']['images']['secretKey']);
        $this->assertStringNotContainsString('snapshot-secret', wp_json_encode($bootstrap));
    }

    public function test_settings_center_assets_load_only_on_the_canonical_screen()
    {
        wp_set_current_user(self::factory()->user->create(array('role' => 'administrator')));
        $settings_page = $this->settings_page();

        $settings_page->enqueue_assets('profile.php');
        $this->assertTrue(wp_style_is('easymde-admin-menu', 'enqueued'));

        $settings_page->enqueue_assets('settings_page_unregistered');
        $this->assertFalse(wp_script_is('easymde-admin-settings-center', 'enqueued'));

        $settings_page->enqueue_assets('toplevel_page_easymde');

        $this->assertTrue(wp_script_is('easymde-admin-settings-center', 'enqueued'));
        $this->assertTrue(wp_style_is('easymde-admin-settings-center', 'enqueued'));
        $this->assertNotEmpty(
            wp_scripts()->get_data('easymde-admin-settings-center', 'before')
        );
        $this->assertNotEmpty(
            wp_scripts()->get_data('easymde-admin-settings-center', 'after')
        );
    }

    public function test_settings_center_uses_the_immersive_editor_logo_as_its_favicon()
    {
        $settings_page = $this->settings_page();
        $settings_page->register_hooks();

        $this->assertSame(
            10,
            has_action(
                'admin_head-toplevel_page_easymde',
                array($settings_page, 'render_settings_center_favicon')
            )
        );

        ob_start();
        $settings_page->render_settings_center_favicon();
        $output = ob_get_clean();

        $this->assertStringContainsString('data-easymde-settings-favicon="true"', $output);
        $this->assertStringContainsString('rel="icon"', $output);
        $this->assertStringContainsString('type="image/png"', $output);
        $this->assertStringContainsString('/assets/images/easymde-editor-icon.png', $output);

        remove_action(
            'admin_head-toplevel_page_easymde',
            array($settings_page, 'render_settings_center_favicon')
        );
    }

    public function test_admin_menu_uses_the_general_settings_route_local_logo_and_native_plugin_updates_page()
    {
        wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
        $settings_page_slug = 'easymde';
        $route_menu_slug    = 'easymde&route=/general_setting';

        $this->settings_page()->register_admin_menu();

        global $menu, $submenu;
        $menu_item = $this->find_menu_item( $menu, $settings_page_slug );
        $this->assertSame( 'EasyMDE', $menu_item[0] );
        $this->assertStringContainsString( '/assets/images/easymde-editor-icon.png', $menu_item[6] );
        $this->assertArrayHasKey( $settings_page_slug, $submenu );
        $this->assertSame( $route_menu_slug, $submenu[ $settings_page_slug ][0][2] );
        $this->assertSame( 'manage_options', $submenu[ $settings_page_slug ][0][1] );
        $this->assertSame( 'plugins.php?plugin_status=upgrade', $submenu[ $settings_page_slug ][1][2] );
        $this->assertSame( 'update_plugins', $submenu[ $settings_page_slug ][1][1] );
    }

    public function test_admin_menu_does_not_register_the_removed_legacy_options_page()
    {
        wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );

        $this->settings_page()->register_admin_menu();

        global $submenu;
        $legacy_items = array_filter(
            isset( $submenu['options-general.php'] ) ? $submenu['options-general.php'] : array(),
            static function ( $item ) {
                return isset( $item[2] ) && 'easymde-legacy' === $item[2];
            }
        );

        $this->assertSame( array(), array_values( $legacy_items ) );
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
        $options = new Options();
        $toolbar_registry = new ToolbarRegistry();

        return new SettingsPage(new SettingsCenterRepository($options, $toolbar_registry));
    }
}
