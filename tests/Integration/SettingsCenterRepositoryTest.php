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
        $this->assertArrayNotHasKey('shortcuts', $stored);
        $this->assertSame('Ctrl+Shift+S', $stored['settings_center']['shortcuts']['values']['save']['windows']);
        $this->assertSame($saved, $repository->get_settings());
    }

    public function test_current_settings_expose_only_the_19_editable_shortcuts_and_paste_upload_policy()
    {
        $repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
        $settings = $repository->get_settings();

        $this->assertSame(
            array(
                'save',
                'bold',
                'italic',
                'strikethrough',
                'paragraph',
                'heading-one',
                'heading-two',
                'heading-three',
                'heading-four',
                'heading-five',
                'heading-six',
                'quote',
                'unordered-list',
                'ordered-list',
                'inline-code',
                'code-fence',
                'math-block',
                'link',
                'image',
            ),
            array_keys($settings['shortcuts']['values'])
        );
        $this->assertSame(array('values'), array_keys($settings['shortcuts']));
        $this->assertTrue($settings['images']['autoUploadPastedImages']);
    }

    public function test_update_persists_the_paste_upload_policy()
    {
        $repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
        $settings = $repository->get_settings();
        $settings['images']['autoUploadPastedImages'] = false;

        $saved = $repository->update_settings($settings);

        $this->assertIsArray($saved);
        $this->assertFalse($saved['images']['autoUploadPastedImages']);
        $this->assertFalse(get_option(Options::EDITOR_SETTINGS)['settings_center']['images']['autoUploadPastedImages']);
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

	public function test_image_upload_runtime_snapshot_keeps_credentials_server_side()
	{
		update_option(
			Options::EDITOR_SETTINGS,
			array(
				'settings_center' => array(
					'images' => array(
						'endpoint' => 'https://synthetic.r2.cloudflarestorage.com',
						'domain' => 'https://img.example.test',
						'accessKey' => 'synthetic-access-key',
						'secretKey' => 'synthetic-secret-key',
					),
				),
			),
			false
		);
		$repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());

		$public = $repository->get_settings();
		$runtime = $repository->get_image_hosting_settings();

		$this->assertSame('', $public['images']['accessKey']);
		$this->assertSame('', $public['images']['secretKey']);
		$this->assertArrayNotHasKey('accountId', $public['images']);
		$this->assertArrayNotHasKey('accountId', $runtime['primary']);
		$this->assertArrayNotHasKey('destination', $public['images']);
		$this->assertArrayNotHasKey('destination', $runtime);
		$this->assertTrue($runtime['credentialStatus']['primaryConfigured']);
		$this->assertFalse($runtime['credentialStatus']['backupConfigured']);
		$this->assertSame('synthetic-access-key', $runtime['primary']['accessKey']);
		$this->assertSame('synthetic-secret-key', $runtime['primary']['secretKey']);
	}

	public function test_secret_reveal_reads_only_the_requested_current_stored_credential()
	{
		update_option(
			Options::EDITOR_SETTINGS,
			array(
				'settings_center_revision' => 11,
				'settings_center' => array(
					'images' => array(
						'accessKey' => 'synthetic-primary-access',
						'secretKey' => 'synthetic-primary-secret',
						'backupAccessKey' => 'synthetic-backup-access',
						'backupSecretKey' => 'synthetic-backup-secret',
					),
				),
			),
			false
		);
		$repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());

		$this->assertSame('synthetic-primary-access', $repository->get_image_hosting_secret('primary', 'accessKey', 11));
		$this->assertSame('synthetic-backup-secret', $repository->get_image_hosting_secret('backup', 'secretKey', 11));
		foreach (
			array(
				array('primary', 'secretKey', 10),
				array('other', 'secretKey', 11),
				array('primary', 'password', 11),
			)
			as $invalid
		) {
			$result = $repository->get_image_hosting_secret($invalid[0], $invalid[1], $invalid[2]);
			$this->assertWPError($result);
			$this->assertSame('easymde_image_hosting_secret_unavailable', $result->get_error_code());
			$this->assertSame(409, $result->get_error_data()['status']);
		}
	}

	public function test_public_settings_response_uses_one_raw_option_snapshot()
	{
		$reads = 0;
		$filter = static function () use ( &$reads ) {
			$reads++;

			return array(
				'settings_center_revision' => 27,
				'settings_center'          => array(
					'images' => array(
						'accessKey' => 'snapshot-access',
						'secretKey' => 'snapshot-secret',
					),
				),
			);
		};
		add_filter( 'pre_option_' . Options::EDITOR_SETTINGS, $filter );
		$repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());

		try {
			$response = $repository->get_settings_response();
		} finally {
			remove_filter( 'pre_option_' . Options::EDITOR_SETTINGS, $filter );
		}

		$this->assertSame(1, $reads);
		$this->assertSame(27, $response['settings']['revision']);
		$this->assertTrue($response['credentialStatus']['primaryConfigured']);
		$this->assertFalse($response['credentialStatus']['backupConfigured']);
		$this->assertSame('', $response['settings']['images']['accessKey']);
		$this->assertSame('', $response['settings']['images']['secretKey']);
	}

	public function test_image_settings_do_not_expose_or_persist_an_upload_destination()
	{
		$repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
		$settings = $repository->get_settings();

		$this->assertArrayNotHasKey('destination', $settings['images']);
		$this->assertIsArray($repository->update_settings($settings));
		$stored = get_option(Options::EDITOR_SETTINGS);
		$this->assertArrayNotHasKey('destination', $stored['settings_center']['images']);
	}

	public function test_update_rejects_invalid_image_runtime_identifiers_without_writing()
	{
		$repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
		$settings = $repository->get_settings();
		$settings['images']['endpoint'] = 'https://not-r2.example.test';

		$result = $repository->update_settings($settings);

		$this->assertWPError($result);
		$this->assertSame('easymde_settings_invalid_payload', $result->get_error_code());
		$this->assertFalse(get_option(Options::EDITOR_SETTINGS, false));
	}

	public function test_update_accepts_official_r2_jurisdiction_endpoints()
	{
		foreach ( array( 'eu', 'us', 'fedramp' ) as $jurisdiction ) {
			$repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
			$settings = $repository->get_settings();
			$settings['images']['endpoint'] = 'https://synthetic-account.' . $jurisdiction . '.r2.cloudflarestorage.com';

			$result = $repository->update_settings($settings);

			$this->assertIsArray($result, $jurisdiction);
			delete_option(Options::EDITOR_SETTINGS);
		}
	}

	public function test_settings_contract_physically_omits_removed_general_fields_and_exposes_provider_coordinates()
	{
		$settings = (new SettingsCenterRepository(new Options(), new ToolbarRegistry()))->get_settings();

		foreach (array('cleanPastedContent', 'smartListRecognition', 'defaultCategory', 'featuredImagePlaceholder') as $removed) {
			$this->assertArrayNotHasKey($removed, $settings['general']);
		}
		$this->assertArrayNotHasKey('accountId', $settings['images']);
		foreach (array('endpoint', 'domain', 'backupEndpoint', 'backupDomain') as $field) {
			$this->assertArrayHasKey($field, $settings['images']);
		}
		$this->assertSame(0, $settings['images']['uploadRetryCount']);
		$this->assertSame(5, $settings['images']['maxImageSizeMb']);
		$this->assertSame('none', $settings['images']['titleDisplay']);
		foreach (array('region', 'backupRegion', 'fallbackDomain', 'backupSameObjectKey', 'backupFailureMode', 'retryCount', 'backupRetryCount', 'insertMarkdown', 'preserveFileName', 'copyUrl', 'maxImageSize', 'insertFormat', 'altSource', 'captionMode', 'featuredPlaceholder') as $removed) {
			$this->assertArrayNotHasKey($removed, $settings['images']);
		}
		$this->assertTrue($settings['general']['applyEditorThemeToFrontend']);
		$this->assertTrue($settings['general']['showPublishedCodeCopyButton']);
		foreach (array('editorTheme', 'htmlRendering', 'lineEnding', 'unorderedMarker', 'orderedStart', 'blockquoteStyle') as $removed) {
			$this->assertArrayNotHasKey($removed, $settings['markdown']);
		}
	}

	public function test_published_markdown_presentation_accessors_use_strict_defaults()
	{
		$repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());

		$this->assertSame('center', $repository->get_published_table_alignment());
		$this->assertTrue($repository->should_show_published_code_line_numbers());
	}

	public function test_published_markdown_presentation_accessors_follow_saved_settings()
	{
		$repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
		$settings = $repository->get_settings();
		$settings['markdown']['tableAlignment'] = 'left';
		$settings['markdown']['codeLineNumbers'] = 'hide';

		$this->assertIsArray($repository->update_settings($settings));
		$this->assertSame('left', $repository->get_published_table_alignment());
		$this->assertFalse($repository->should_show_published_code_line_numbers());
	}

	public function test_published_markdown_presentation_accessors_normalize_invalid_stored_values()
	{
		update_option(
			Options::EDITOR_SETTINGS,
			array(
				'settings_center' => array(
					'markdown' => array(
						'tableAlignment' => 'diagonal',
						'codeLineNumbers' => 'sometimes',
					),
				),
			),
			false
		);
		$repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());

		$this->assertSame('center', $repository->get_published_table_alignment());
		$this->assertTrue($repository->should_show_published_code_line_numbers());
	}

	public function test_frontend_theme_linkage_defaults_on_and_exposes_a_narrow_runtime_query()
	{
		$repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());

		$this->assertTrue($repository->should_apply_editor_theme_to_frontend());

		$settings = $repository->get_settings();
		$settings['general']['applyEditorThemeToFrontend'] = false;
		$this->assertIsArray($repository->update_settings($settings));

		$this->assertFalse($repository->should_apply_editor_theme_to_frontend());
	}

	public function test_published_code_copy_button_defaults_on_and_exposes_a_narrow_runtime_query()
	{
		$repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());

		$this->assertTrue($repository->should_show_published_code_copy_button());

		$settings = $repository->get_settings();
		$settings['general']['showPublishedCodeCopyButton'] = false;
		$this->assertIsArray($repository->update_settings($settings));

		$this->assertFalse($repository->should_show_published_code_copy_button());
	}

	public function test_legacy_caption_mode_migrates_to_title_display_without_reintroducing_removed_fields()
	{
		update_option(Options::EDITOR_SETTINGS, array('settings_center' => array(
			'images' => array(
				'captionMode' => 'filename',
				'altSource' => 'empty',
				'insertFormat' => 'url',
				'insertMarkdown' => false,
				'preserveFileName' => true,
				'copyUrl' => true,
				'maxImageSize' => '3840',
				'featuredPlaceholder' => false,
			),
			'markdown' => array(
				'lineEnding' => 'lf',
				'unorderedMarker' => '*',
				'orderedStart' => '2',
				'blockquoteStyle' => 'compact',
			),
		)), false);

		$repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
		$settings = $repository->get_settings();

		$this->assertSame('filename', $settings['images']['titleDisplay']);
		foreach (array('captionMode', 'altSource', 'insertFormat', 'insertMarkdown', 'preserveFileName', 'copyUrl', 'maxImageSize', 'featuredPlaceholder') as $removed) {
			$this->assertArrayNotHasKey($removed, $settings['images']);
		}
		foreach (array('lineEnding', 'unorderedMarker', 'orderedStart', 'blockquoteStyle') as $removed) {
			$this->assertArrayNotHasKey($removed, $settings['markdown']);
		}

		$this->assertIsArray($repository->update_settings($settings));
		$stored_images = get_option(Options::EDITOR_SETTINGS)['settings_center']['images'];
		$this->assertSame('filename', $stored_images['titleDisplay']);
		foreach (array('captionMode', 'altSource', 'insertFormat', 'insertMarkdown', 'preserveFileName', 'copyUrl', 'maxImageSize', 'featuredPlaceholder') as $removed) {
			$this->assertArrayNotHasKey($removed, $stored_images);
		}
		$stored_markdown = get_option(Options::EDITOR_SETTINGS)['settings_center']['markdown'];
		foreach (array('lineEnding', 'unorderedMarker', 'orderedStart', 'blockquoteStyle') as $removed) {
			$this->assertArrayNotHasKey($removed, $stored_markdown);
		}
	}

	public function test_image_size_and_title_settings_require_the_new_strict_contract()
	{
		foreach (array(0, 11, '5', 5.0) as $invalid_size) {
			$repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
			$settings = $repository->get_settings();
			$settings['images']['maxImageSizeMb'] = $invalid_size;

			$result = $repository->update_settings($settings);

			$this->assertWPError($result, gettype($invalid_size));
			$this->assertSame('easymde_settings_invalid_payload', $result->get_error_code(), gettype($invalid_size));
			$this->assertFalse(get_option(Options::EDITOR_SETTINGS, false), gettype($invalid_size));
		}

		foreach (array('file', '', 'Filename') as $invalid_display) {
			$repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
			$settings = $repository->get_settings();
			$settings['images']['titleDisplay'] = $invalid_display;

			$result = $repository->update_settings($settings);

			$this->assertWPError($result, $invalid_display);
			$this->assertSame('easymde_settings_invalid_payload', $result->get_error_code(), $invalid_display);
			$this->assertFalse(get_option(Options::EDITOR_SETTINGS, false), $invalid_display);
		}
	}

	public function test_image_hosting_runtime_uses_the_effective_configured_upload_limit()
	{
		$filter = static function () {
			return 3 * MB_IN_BYTES;
		};
		add_filter('upload_size_limit', $filter);

		try {
			$repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
			$settings = $repository->get_settings();
			$settings['images']['maxImageSizeMb'] = 8;
			$settings['images']['titleDisplay'] = 'filename';
			$this->assertIsArray($repository->update_settings($settings));

			$runtime = $repository->get_image_hosting_settings();
			$this->assertSame(3 * MB_IN_BYTES, $runtime['behaviors']['maxBytes']);
			$this->assertSame('filename', $runtime['behaviors']['titleDisplay']);
		} finally {
			remove_filter('upload_size_limit', $filter);
		}
	}

	public function test_upload_retry_counts_are_persisted_and_projected_to_the_runtime()
	{
		$repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
		$settings = $repository->get_settings();
		$settings['images']['uploadRetryCount'] = 5;

		$saved = $repository->update_settings($settings);

		$this->assertIsArray($saved);
		$this->assertSame(5, $saved['images']['uploadRetryCount']);
		$runtime = $repository->get_image_hosting_settings();
		$this->assertSame(5, $runtime['primary']['retryCount']);
		$this->assertSame(5, $runtime['backup']['retryCount']);
	}

	public function test_http_viewing_domains_are_persisted_and_projected_to_the_runtime()
	{
		$repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
		$settings = $repository->get_settings();
		$settings['images']['domain'] = 'http://images.example.test';
		$settings['images']['backupDomain'] = 'http://backup.example.test';

		$saved = $repository->update_settings($settings);

		$this->assertIsArray($saved);
		$this->assertSame('http://images.example.test', $saved['images']['domain']);
		$this->assertSame('http://backup.example.test', $saved['images']['backupDomain']);
		$runtime = $repository->get_image_hosting_settings();
		$this->assertSame('http://images.example.test', $runtime['primary']['domain']);
		$this->assertSame('http://backup.example.test', $runtime['backup']['domain']);
	}

	public function test_upload_retry_counts_reject_out_of_range_and_non_integer_values_without_writing()
	{
		foreach (array('uploadRetryCount') as $field) {
			foreach (array(-1, 6, '2', 2.0) as $invalid) {
				$repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
				$settings = $repository->get_settings();
				$settings['images'][$field] = $invalid;

				$result = $repository->update_settings($settings);

				$this->assertWPError($result, $field . ':' . gettype($invalid));
				$this->assertSame('easymde_settings_invalid_payload', $result->get_error_code(), $field . ':' . gettype($invalid));
				$this->assertFalse(get_option(Options::EDITOR_SETTINGS, false), $field . ':' . gettype($invalid));
			}
		}
	}

	public function test_update_rejects_duplicate_primary_and_backup_destinations_before_writing()
	{
		$cases = array(
			array('cloudflare-r2', 'https://same.r2.cloudflarestorage.com', 'same-bucket'),
			array('qiniu-kodo', '', 'same-bucket'),
			array('aliyun-oss', 'https://oss-cn-hangzhou.aliyuncs.com', 'same-bucket'),
			array('tencent-cos', 'https://cos.ap-shanghai.myqcloud.com', 'same-bucket-1250000000'),
		);

		foreach ($cases as $case) {
			$repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
			$settings = $repository->get_settings();
			$settings['images']['service'] = $case[0];
			$settings['images']['endpoint'] = $case[1];
			$settings['images']['bucket'] = $case[2];
			$settings['images']['domain'] = 'https://primary.example.test';
			$settings['images']['backupEnabled'] = true;
			$settings['images']['backupService'] = $case[0];
			$settings['images']['backupEndpoint'] = strtoupper($case[1]);
			$settings['images']['backupBucket'] = $case[2];
			$settings['images']['backupDomain'] = 'https://different.example.test';

			$result = $repository->update_settings($settings);

			$this->assertWPError($result, $case[0]);
			$this->assertSame('easymde_settings_duplicate_image_host_destination', $result->get_error_code(), $case[0]);
			$this->assertSame(409, $result->get_error_data()['status'], $case[0]);
			$this->assertFalse(get_option(Options::EDITOR_SETTINGS, false), $case[0]);
		}
	}

	public function test_disabled_backup_may_reference_the_primary_destination()
	{
		$repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
		$settings = $repository->get_settings();
		$settings['images']['service'] = 'qiniu-kodo';
		$settings['images']['endpoint'] = '';
		$settings['images']['bucket'] = 'same-bucket';
		$settings['images']['backupEnabled'] = false;
		$settings['images']['backupService'] = 'qiniu-kodo';
		$settings['images']['backupBucket'] = 'same-bucket';

		$this->assertIsArray($repository->update_settings($settings));
	}

	public function test_oss_public_and_internal_endpoints_are_the_same_physical_destination()
	{
		$repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
		$settings = $repository->get_settings();
		$settings['images']['service'] = 'aliyun-oss';
		$settings['images']['endpoint'] = 'https://oss-cn-hangzhou.aliyuncs.com';
		$settings['images']['bucket'] = 'same-bucket';
		$settings['images']['backupEnabled'] = true;
		$settings['images']['backupService'] = 'aliyun-oss';
		$settings['images']['backupEndpoint'] = 'https://oss-cn-hangzhou-internal.aliyuncs.com';
		$settings['images']['backupBucket'] = 'same-bucket';

		$result = $repository->update_settings($settings);

		$this->assertWPError($result);
		$this->assertSame('easymde_settings_duplicate_image_host_destination', $result->get_error_code());
		$this->assertSame(409, $result->get_error_data()['status']);
	}

    public function test_get_settings_normalizes_legacy_values_without_writing_or_exposing_secrets()
    {
        $legacy = array(
            'version' => '0.1.8',
            'settings_center' => array(
				'general' => array('featuredImagePlaceholder' => false),
                'images' => array(
                    'service' => 'Cloudflare R2',
                    'accessKey' => 'synthetic-access-key',
                    'secretKey' => 'synthetic-secret-key',
                ),
				'markdown' => array(
					'editorTheme' => 'Follow System',
					'htmlRendering' => true,
				),
            ),
        );
        update_option(Options::EDITOR_SETTINGS, $legacy, false);

        $repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
        $settings = $repository->get_settings();

        $this->assertSame('cloudflare-r2', $settings['images']['service']);
		$this->assertArrayNotHasKey('editorTheme', $settings['markdown']);
		$this->assertArrayNotHasKey('htmlRendering', $settings['markdown']);
		$this->assertArrayNotHasKey('featuredImagePlaceholder', $settings['general']);
        $this->assertSame('', $settings['images']['accessKey']);
        $this->assertSame('', $settings['images']['secretKey']);
        $this->assertSame(0, $settings['revision']);
        $this->assertSame($legacy, get_option(Options::EDITOR_SETTINGS));
    }

	public function test_markdown_settings_contract_omits_removed_presentation_and_capability_fields()
	{
		$repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());

		$markdown = $repository->get_settings()['markdown'];

		foreach (
			array(
				'editorTheme',
				'htmlRendering',
				'editorFontSize',
				'editorFont',
				'codeTheme',
				'toc',
				'livePreview',
				'fixedToolbar',
				'taskLists',
				'emoji',
				'math',
				'tableExtension',
				'footnotes',
				'definitionLists',
				'imageSizeSyntax',
			)
			as $removed_key
		) {
			$this->assertArrayNotHasKey($removed_key, $markdown);
		}
	}

    public function test_stored_legacy_shortcuts_and_behavior_fields_have_no_current_owner()
    {
        $legacy = array(
            'shortcuts' => array(
                'savepost' => array('win' => 'Ctrl+Shift+S', 'mac' => 'Cmd+Shift+S'),
                'bold' => array('win' => 'Ctrl+Alt+B', 'mac' => 'Cmd+Option+B'),
            ),
            'settings_center' => array(
                'shortcuts' => array(
                    'values' => array(),
                    'showHints' => false,
                    'detectConflicts' => false,
                    'showSuggestions' => false,
                ),
            ),
        );
        update_option(Options::EDITOR_SETTINGS, $legacy, false);

        $repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
        $settings = $repository->get_settings();

        $this->assertSame('Ctrl+S', $settings['shortcuts']['values']['save']['windows']);
        $this->assertSame('Cmd+S', $settings['shortcuts']['values']['save']['mac']);
        $this->assertSame(array('values'), array_keys($settings['shortcuts']));
        $this->assertSame($legacy, get_option(Options::EDITOR_SETTINGS));
    }

    public function test_current_stored_shortcuts_are_not_silently_normalized_or_replaced()
    {
        update_option(
            Options::EDITOR_SETTINGS,
            array(
                'settings_center' => array(
                    'shortcuts' => array(
                        'values' => array(
                            'bold' => array(
                                'windows' => 'control+b',
                                'mac' => 'command+b',
                            ),
                        ),
                    ),
                ),
            ),
            false
        );

        $repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
        $settings = $repository->get_settings();

        $this->assertSame('control+b', $settings['shortcuts']['values']['bold']['windows']);
        $this->assertSame('command+b', $settings['shortcuts']['values']['bold']['mac']);
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
        $this->assertSame($settings['shortcuts']['values']['strikethrough']['windows'], $shortcuts['strike']['win']);
        $this->assertSame($settings['shortcuts']['values']['paragraph']['mac'], $shortcuts['paragraph']['mac']);
        $this->assertSame($settings['shortcuts']['values']['heading-six']['windows'], $shortcuts['heading6']['win']);
        $this->assertSame($settings['shortcuts']['values']['math-block']['mac'], $shortcuts['mathblock']['mac']);
        $this->assertSame('Ctrl+Shift+W', $shortcuts['copywechat']['win']);
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

    public function test_shortcuts_accept_only_canonical_modifier_order_and_keys()
    {
		$repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
		$settings = $repository->get_settings();
		$settings['shortcuts']['values']['quote']['mac'] = 'Cmd+Ctrl+Option+Shift+Q';
		$settings['shortcuts']['values']['quote']['windows'] = 'Ctrl+Alt+Shift+Meta+Q';
		$settings['shortcuts']['values']['inline-code']['windows'] = 'Alt+Backquote';
		$settings['shortcuts']['values']['inline-code']['mac'] = 'Ctrl+BracketLeft';

        $saved = $repository->update_settings($settings);

		$this->assertSame('Cmd+Ctrl+Option+Shift+Q', $saved['shortcuts']['values']['quote']['mac']);
		$this->assertSame('Ctrl+Alt+Shift+Meta+Q', $saved['shortcuts']['values']['quote']['windows']);
		$this->assertSame('Alt+Backquote', $saved['shortcuts']['values']['inline-code']['windows']);
		$this->assertSame('Ctrl+BracketLeft', $saved['shortcuts']['values']['inline-code']['mac']);
        $stored = get_option(Options::EDITOR_SETTINGS);
		$this->assertSame('Cmd+Ctrl+Option+Shift+Q', $stored['settings_center']['shortcuts']['values']['quote']['mac']);
		$this->assertSame('Ctrl+Alt+Shift+Meta+Q', $stored['settings_center']['shortcuts']['values']['quote']['windows']);
    }

    /**
     * @dataProvider non_canonical_shortcut_provider
     */
    public function test_shortcuts_reject_non_canonical_aliases_and_control_keys($platform, $value)
    {
		$repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
		$settings = $repository->get_settings();
		$settings['shortcuts']['values']['bold'][$platform] = $value;

		$result = $repository->update_settings($settings);

		$this->assertWPError($result);
		$this->assertSame('easymde_settings_invalid_shortcut', $result->get_error_code());
    }

    public function non_canonical_shortcut_provider()
    {
		return array(
			'wrong modifier order' => array('windows', 'Shift+Ctrl+B'),
			'lowercase key'        => array('windows', 'Ctrl+b'),
			'literal punctuation'  => array('mac', 'Cmd+`'),
			'escape'               => array('windows', 'Ctrl+Escape'),
			'tab'                  => array('mac', 'Cmd+Tab'),
		);
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

		$settings['images']['service'] = 'Cloudflare R2';
		$settings['images']['titleDisplay'] = 'filename';
		$saved = $repository->update_settings($settings);

		$this->assertSame('cloudflare-r2', $saved['images']['service']);
		$this->assertSame('filename', $saved['images']['titleDisplay']);
		$this->assertArrayNotHasKey('editorTheme', $saved['markdown']);
    }


    public function test_invalid_shortcut_fails_without_writing_the_editor_option()
    {
        $repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
        $before = get_option(Options::EDITOR_SETTINGS, array());
        $settings = $repository->get_settings();
        $settings['shortcuts']['values']['save']['windows'] = 'Shift+S';

        $result = $repository->update_settings($settings);

        $this->assertWPError($result);
        $this->assertSame('easymde_settings_invalid_shortcut', $result->get_error_code());
        $this->assertSame($before, get_option(Options::EDITOR_SETTINGS, array()));
    }

    public function test_duplicate_and_reserved_shortcuts_fail_without_writing_the_editor_option()
    {
        $repository = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
        $before = get_option(Options::EDITOR_SETTINGS, array());
        $settings = $repository->get_settings();
        $settings['shortcuts']['values']['bold']['windows'] = 'Ctrl+S';

        $result = $repository->update_settings($settings);

        $this->assertWPError($result);
        $this->assertSame('easymde_settings_shortcut_conflict', $result->get_error_code());
        $this->assertSame(
            array(
                'status'   => 409,
                'platform' => 'windows',
                'shortcut' => 'Ctrl+S',
                'bindings' => array(
                    array('id' => 'save', 'label' => 'Save post', 'editable' => true),
                    array('id' => 'bold', 'label' => 'Bold', 'editable' => true),
                ),
            ),
            $result->get_error_data()
        );
        $this->assertSame($before, get_option(Options::EDITOR_SETTINGS, array()));

        $settings = $repository->get_settings();
        $settings['shortcuts']['values']['image']['windows'] = 'Ctrl+Shift+W';
        $result = $repository->update_settings($settings);

        $this->assertWPError($result);
        $this->assertSame('easymde_settings_shortcut_conflict', $result->get_error_code());
        $this->assertSame(
            array(
                'status'   => 409,
                'platform' => 'windows',
                'shortcut' => 'Ctrl+Shift+W',
                'bindings' => array(
                    array('id' => 'copywechat', 'label' => 'Copy to WeChat', 'editable' => false),
                    array('id' => 'image', 'label' => 'Image', 'editable' => true),
                ),
            ),
            $result->get_error_data()
        );
        $this->assertSame($before, get_option(Options::EDITOR_SETTINGS, array()));
    }

    public function test_registered_extension_shortcuts_are_reserved_from_editable_bindings()
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
        $repository = new SettingsCenterRepository(new Options(), $registry);
        $before = get_option(Options::EDITOR_SETTINGS, array());
        $settings = $repository->get_settings();
        $settings['shortcuts']['values']['image']['mac'] = 'Cmd+Option+E';

        $result = $repository->update_settings($settings);

        $this->assertWPError($result);
        $this->assertSame('easymde_settings_shortcut_conflict', $result->get_error_code());
        $this->assertSame('mac', $result->get_error_data()['platform']);
        $this->assertSame(
            array(
                array('id' => 'synthetic-export', 'label' => 'Synthetic export', 'editable' => false),
                array('id' => 'image', 'label' => 'Image', 'editable' => true),
            ),
            $result->get_error_data()['bindings']
        );
        $this->assertSame($before, get_option(Options::EDITOR_SETTINGS, array()));
    }

    public function test_non_canonical_extension_shortcut_fails_at_the_registry_projection_boundary()
    {
        $registry = new ToolbarRegistry();
        $registry->register_toolbar_button(
            'synthetic-export',
            array(
                'label'              => 'Synthetic export',
                'defaultShortcutWin' => 'control+b',
            )
        );
        $repository = new SettingsCenterRepository(new Options(), $registry);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('easymde-toolbar-shortcut-invalid');

        $repository->get_reserved_shortcuts_for_script();
    }

    public function test_non_canonical_extension_shortcut_cannot_reach_the_editor_bootstrap()
    {
        $registry = new ToolbarRegistry();
        $registry->register_toolbar_button(
            'synthetic-export',
            array(
                'label'              => 'Synthetic export',
                'defaultShortcutMac' => 'Command+B',
            )
        );
        $repository = new SettingsCenterRepository(new Options(), $registry);

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('easymde-toolbar-shortcut-invalid');

        $repository->get_shortcut_config_for_script();
    }

    public function test_canonical_extension_duplicate_uses_the_shortcut_conflict_error()
    {
        $registry = new ToolbarRegistry();
        $registry->register_toolbar_button(
            'synthetic-export',
            array(
                'label'              => 'Synthetic export',
                'defaultShortcutWin' => 'Ctrl+B',
            )
        );
        $repository = new SettingsCenterRepository(new Options(), $registry);

        $result = $repository->update_settings($repository->get_settings());

        $this->assertWPError($result);
        $this->assertSame('easymde_settings_shortcut_conflict', $result->get_error_code());
        $this->assertSame(409, $result->get_error_data()['status']);
        $this->assertSame('windows', $result->get_error_data()['platform']);
        $this->assertSame(
            array(
                array('id' => 'synthetic-export', 'label' => 'Synthetic export', 'editable' => false),
                array('id' => 'bold', 'label' => 'Bold', 'editable' => true),
            ),
            $result->get_error_data()['bindings']
        );
    }

	public function test_removed_image_host_fields_are_not_reintroduced_by_stored_data()
	{
		update_option(Options::EDITOR_SETTINGS, array('settings_center' => array('images' => array(
			'fallbackDomain' => 'https://removed.example.test',
			'backupSameObjectKey' => false,
			'backupFailureMode' => 'abort',
			'retryCount' => 'three-times',
		))), false);
		$settings = (new SettingsCenterRepository(new Options(), new ToolbarRegistry()))->get_settings();

		foreach (array('fallbackDomain', 'backupSameObjectKey', 'backupFailureMode', 'retryCount', 'backupRetryCount') as $removed) {
			$this->assertArrayNotHasKey($removed, $settings['images']);
		}
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
