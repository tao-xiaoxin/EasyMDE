<?php

use EasyMDE\Admin\SettingsPage;
use EasyMDE\Support\Options;
use EasyMDE\Support\SettingsCenterRepository;
use EasyMDE\Support\ToolbarRegistry;

final class SettingsPageTest extends WP_UnitTestCase
{
    private $previous_pagenow;
    private $previous_get;

    public function set_up()
    {
        parent::set_up();

        global $menu, $submenu;
        $menu    = array();
        $submenu = array();

        $this->previous_pagenow = array_key_exists('pagenow', $GLOBALS) ? $GLOBALS['pagenow'] : null;
        $GLOBALS['pagenow'] = 'admin.php';
        $this->previous_get = $_GET;
		$this->reset_settings_center_asset_state();
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

        $_GET = $this->previous_get;

        delete_option(Options::EDITOR_SETTINGS);
		$this->reset_settings_center_asset_state();
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
        $this->assertStringNotContainsString('easymde-settings-center__frame', $output);
        $this->assertStringNotContainsString('easymde-settings-center__sidebar', $output);
        $this->assertStringNotContainsString('easymde-settings-center__brand-wrap', $output);
        $this->assertStringNotContainsString('easymde-settings-center__brand', $output);
        $this->assertStringNotContainsString('<noscript>', $output);
        $this->assertSame(1, substr_count($output, 'data-settings-center-server-fallback'));
        $this->assertSame(1, substr_count($output, 'role="alert"'));
        $this->assertSame(
            2,
            substr_count(
                $output,
                esc_html__('The EasyMDE settings center could not start. WordPress settings remain available.', 'easymde')
            )
        );
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

    public function test_settings_center_registers_an_early_document_dispatcher()
    {
        $settings_page = $this->settings_page();
        $settings_page->register_hooks();

        $this->assertSame(
            10,
            has_action(
                'load-toplevel_page_easymde',
                array($settings_page, 'enforce_settings_center_route')
            )
        );
        $this->assertSame(
            20,
            has_action(
                'load-toplevel_page_easymde',
                array($settings_page, 'dispatch_settings_center_document')
            )
        );
    }

    public function test_settings_center_document_has_no_wordpress_shell_and_prints_assets_before_the_root()
    {
        $stored = array(
            'version' => '0.1.8',
            'toolbar_layout' => 'hybrid-icons',
        );
        update_option(Options::EDITOR_SETTINGS, $stored);
        wp_set_current_user(self::factory()->user->create(array('role' => 'administrator')));
        $_GET['page']  = 'easymde';
        $_GET['route'] = '/general_setting';

        ob_start();
        $this->settings_page()->render_settings_center_document();
        $output = ob_get_clean();

        $this->assertStringStartsWith('<!DOCTYPE html>', $output);
        foreach (array('wpwrap', 'wpadminbar', 'adminmenu', 'wpcontent', 'wpbody', 'wpfooter') as $shell_id) {
            $this->assertStringNotContainsString('id="' . $shell_id . '"', $output);
        }
        $this->assertStringContainsString('id="easymde-settings-center-root"', $output);
		$this->assertStringContainsString('data-easymde-settings-favicon="true"', $output);
        $this->assertStringContainsString('data-settings-center-server-fallback', $output);
        $style_position  = strpos($output, 'settings-center.css');
        $script_position = strpos($output, 'settings-center-', $style_position + 1);
        $this->assertNotFalse($style_position);
        $this->assertNotFalse($script_position);
        $this->assertLessThan(
            $script_position,
            $style_position
        );
        $this->assertSame($stored, get_option(Options::EDITOR_SETTINGS));
    }

    public function test_settings_center_document_is_zero_output_for_an_unsupported_route_or_missing_capability()
    {
        wp_set_current_user(self::factory()->user->create(array('role' => 'administrator')));
        $_GET['page']  = 'easymde';
        $_GET['route'] = '/removed';

        ob_start();
        $this->settings_page()->render_settings_center_document();
        $unsupported_route_output = ob_get_clean();

        wp_set_current_user(self::factory()->user->create(array('role' => 'subscriber')));
        $_GET['route'] = '/general_setting';

        ob_start();
        $this->settings_page()->render_settings_center_document();
        $unauthorized_output = ob_get_clean();

        $this->assertSame('', $unsupported_route_output);
        $this->assertSame('', $unauthorized_output);
    }

    public function test_settings_center_document_keeps_a_dedicated_accessible_error_when_bootstrap_fails()
    {
        wp_set_current_user(self::factory()->user->create(array('role' => 'administrator')));
        $_GET['page']  = 'easymde';
        $_GET['route'] = '/general_setting';
        $filter = static function () {
            throw new RuntimeException('synthetic-settings-bootstrap-failure');
        };
        add_filter('pre_option_' . Options::EDITOR_SETTINGS, $filter);
		$status_code = null;
		$status_filter = static function ($status_header, $header_code) use (&$status_code) {
			$status_code = $header_code;

			return $status_header;
		};
		add_filter('status_header', $status_filter, 10, 2);
		$previous_display_errors = ini_get('display_errors');
		$previous_status_code    = http_response_code();
		ini_set('display_errors', '1');

        try {
            ob_start();
            $this->settings_page()->render_settings_center_document();
            $output = ob_get_clean();
        } finally {
			ini_set('display_errors', false === $previous_display_errors ? '0' : $previous_display_errors);
			remove_filter('status_header', $status_filter, 10);
            remove_filter('pre_option_' . Options::EDITOR_SETTINGS, $filter);
        }

		$this->assertSame(500, $status_code);
		$this->assertSame($previous_status_code, http_response_code());
		$this->assertStringStartsWith('<!DOCTYPE html>', $output);
        $this->assertStringContainsString('data-settings-center-server-fallback', $output);
		$this->assertStringContainsString('data-error-code="settings-center-document-asset-invalid"', $output);
        $this->assertStringContainsString('role="alert"', $output);
        $this->assertStringContainsString(esc_url(admin_url('options-general.php')), $output);
        $this->assertStringNotContainsString('id="wpwrap"', $output);
        $this->assertStringNotContainsString('settings-center.css', $output);
        $this->assertStringNotContainsString('assets/build/settings-center/', $output);
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
		$this->assertSame(wp_max_upload_size(), $bootstrap['uploadLimits']['systemMaxBytes']);
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
			'saveSettings', 'savingSettings', 'settingsSaved', 'closeSettingsFeedback', 'settingsSaveFailed',
			'settingsUnsavedChanges', 'settingsUnavailable', 'insertFileNameVariable',
			'codeAndFormula', 'strikethrough', 'paragraph',
			'headingThree', 'headingFour', 'headingFive', 'headingSix',
			'inlineCode', 'codeFence', 'mathBlock', 'recordShortcut',
			'shortcutRecording', 'clearShortcut', 'shortcutDisabled', 'shortcutInvalid',
			'shortcutConflictInline', 'shortcutConflictTitle', 'shortcutConflictDescription',
			'returnToShortcutSettings',
			'maximumImageSize', 'maximumImageSizeDescription', 'maximumImageSizeSystemLimitExceeded', 'imageTitleDisplay',
			'autoUploadPastedImages', 'autoUploadPastedImagesDescription',
			'enableImageHosting', 'enableImageHostingDescription',
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
		$this->assertSame( 1, substr_count( $bootstrap['strings']['recordShortcut'], '%s' ) );
		$this->assertSame( 1, substr_count( $bootstrap['strings']['clearShortcut'], '%s' ) );
		$this->assertSame( 1, substr_count( $bootstrap['strings']['shortcutConflictInline'], '%s' ) );
		foreach (
			array(
				'shortcutBehavior',
				'showShortcutHints',
				'showShortcutHintsDescription',
				'detectShortcutConflicts',
				'detectShortcutConflictsDescription',
				'customShortcutSuggestions',
				'customShortcutSuggestionsDescription',
				'showHints',
				'detectConflicts',
				'showSuggestions',
			)
			as $removed_shortcut_string
		) {
			$this->assertArrayNotHasKey( $removed_shortcut_string, $bootstrap['strings'] );
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
					'insertMarkdownAfterUpload',
					'preserveOriginalFileName',
					'preserveOriginalFileNameDescription',
					'copyImageUrl',
					'copyImageUrlDescription',
					'insertFormat',
					'altSource',
					'featuredPlaceholder',
					'defaultInsertion',
					'defaultInsertFormat',
					'markdownImage',
					'htmlImage',
					'urlOnly',
					'altTextSource',
					'fillOnUpload',
					'imageTitleField',
					'imageFeaturedPlaceholder',
					'imageFeaturedPlaceholderDescription',
					'originalImageSize',
					'imageSize1920',
					'imageSize2560',
					'imageSize3840',
					'currentAllowedUploads',
					'compressLargeImagesRecommendation',
					'otherSettings',
					'defaultLineEnding',
					'unorderedListMarker',
					'orderedListStart',
					'blockquoteIndentStyle',
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

    public function test_settings_center_bootstrap_lists_reserved_registry_shortcuts()
    {
        $registry = new ToolbarRegistry();
        $registry->register_toolbar_button(
            'synthetic-export',
            array(
                'label'              => 'Synthetic export',
                'defaultShortcutWin' => 'Ctrl+Alt+E',
                'defaultShortcutMac' => 'Cmd+Option+E',
            )
        );
        $page = new SettingsPage(new SettingsCenterRepository(new Options(), $registry));
        $method = new ReflectionMethod(SettingsPage::class, 'get_settings_center_bootstrap');
        $method->setAccessible(true);

        $bootstrap = $method->invoke($page);

        $this->assertSame(
            array(
                array(
                    'id'      => 'copywechat',
                    'label'   => 'Copy to WeChat',
                    'windows' => 'Ctrl+Shift+W',
                    'mac'     => 'Cmd+Ctrl+W',
                ),
                array(
                    'id'      => 'synthetic-export',
                    'label'   => 'Synthetic export',
                    'windows' => 'Ctrl+Alt+E',
                    'mac'     => 'Cmd+Option+E',
                ),
            ),
            $bootstrap['reservedShortcuts']
        );
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

    public function test_admin_enqueue_loads_only_the_shared_menu_style()
    {
        wp_set_current_user(self::factory()->user->create(array('role' => 'administrator')));
        $settings_page = $this->settings_page();
		$settings_asset_state = array(
			'script'        => wp_script_is('easymde-admin-settings-center', 'enqueued'),
			'message_style' => wp_style_is('easymde-admin-message-alert', 'enqueued'),
			'app_style'     => wp_style_is('easymde-admin-settings-center', 'enqueued'),
		);

		$settings_page->enqueue_assets();
        $this->assertTrue(wp_style_is('easymde-admin-menu', 'enqueued'));
		$this->assertSame(
			$settings_asset_state,
			array(
				'script'        => wp_script_is('easymde-admin-settings-center', 'enqueued'),
				'message_style' => wp_style_is('easymde-admin-message-alert', 'enqueued'),
				'app_style'     => wp_style_is('easymde-admin-settings-center', 'enqueued'),
			)
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

	private function reset_settings_center_asset_state()
	{
		$styles = wp_styles();
		foreach (array('easymde-admin-menu', 'easymde-admin-message-alert', 'easymde-admin-settings-center') as $handle) {
			wp_dequeue_style($handle);
			$styles->queue = array_values(array_diff($styles->queue, array($handle)));
			$styles->to_do = array_values(array_diff($styles->to_do, array($handle)));
			$styles->done  = array_values(array_diff($styles->done, array($handle)));
		}

		$scripts = wp_scripts();
		wp_dequeue_script('easymde-admin-settings-center');
		$scripts->queue = array_values(array_diff($scripts->queue, array('easymde-admin-settings-center')));
		$scripts->to_do = array_values(array_diff($scripts->to_do, array('easymde-admin-settings-center')));
		$scripts->done  = array_values(array_diff($scripts->done, array('easymde-admin-settings-center')));
	}

    private function settings_page()
    {
        $options = new Options();
        $toolbar_registry = new ToolbarRegistry();

        return new SettingsPage(new SettingsCenterRepository($options, $toolbar_registry));
    }
}
