<?php

use EasyMDE\Support\Options;
use EasyMDE\Support\SettingsCenterRepository;
use EasyMDE\Support\ToolbarRegistry;

final class ImageUploadExtensionPolicyRepositoryTest extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();
		delete_option( Options::EDITOR_SETTINGS );
	}

	public function tear_down() {
		delete_option( Options::EDITOR_SETTINGS );
		parent::tear_down();
	}

	public function test_defaults_are_suffix_free_and_enable_the_ordered_six_extension_map() {
		$repository = new SettingsCenterRepository( new Options(), new ToolbarRegistry() );
		$settings   = $repository->get_settings();

		$this->assertSame( '{md5}', $settings['images']['fileNameRule'] );
		$this->assertSame(
			array(
				'webp' => true,
				'png'  => true,
				'jpg'  => true,
				'jpeg' => true,
				'jfif' => true,
				'gif'  => true,
			),
			$settings['images']['uploadFormats']
		);
		$this->assertFalse( get_option( Options::EDITOR_SETTINGS, false ) );
	}

	public function test_legacy_rule_and_four_key_map_project_on_read_without_writing() {
		$stored = array(
			'settings_center_revision' => 9,
			'settings_center'          => array(
				'images' => array(
					'fileNameRule'  => 'legacy/{post_id}/{name}.{ext}',
					'uploadFormats' => array(
						'jpg'  => false,
						'png'  => true,
						'webp' => false,
						'gif'  => true,
					),
				),
			),
		);
		update_option( Options::EDITOR_SETTINGS, $stored, false );
		$repository = new SettingsCenterRepository( new Options(), new ToolbarRegistry() );

		$settings = $repository->get_settings();

		$this->assertSame( 'legacy/{post_id}', $settings['images']['storagePath'] );
		$this->assertSame( '{name}', $settings['images']['fileNameRule'] );
		$this->assertFalse( $settings['images']['uploadFormats']['jpg'] );
		$this->assertFalse( $settings['images']['uploadFormats']['jpeg'] );
		$this->assertFalse( $settings['images']['uploadFormats']['jfif'] );
		$this->assertSame( $stored, get_option( Options::EDITOR_SETTINGS ) );
	}

	public function test_prior_two_field_shape_projects_a_terminal_ext_rule_on_settings_read_without_writing() {
		$stored = $this->prior_two_field_shape();
		update_option( Options::EDITOR_SETTINGS, $stored, false );
		$repository = new SettingsCenterRepository( new Options(), new ToolbarRegistry() );

		$settings = $repository->get_settings();

		$this->assertSame( '{year}/{month}', $settings['images']['storagePath'] );
		$this->assertSame( '{md5}', $settings['images']['fileNameRule'] );
		$this->assertSame( array( 'webp', 'png', 'jpg', 'jpeg', 'jfif', 'gif' ), array_keys( array_filter( $settings['images']['uploadFormats'] ) ) );
		$this->assertSame( 12, $settings['revision'] );
		$this->assertSame( $stored, get_option( Options::EDITOR_SETTINGS ) );
	}

	public function test_prior_two_field_shape_projects_the_runtime_rule_without_writing() {
		$stored = $this->prior_two_field_shape();
		update_option( Options::EDITOR_SETTINGS, $stored, false );
		$repository = new SettingsCenterRepository( new Options(), new ToolbarRegistry() );

		$runtime = $repository->get_image_hosting_settings();

		$this->assertSame( '{year}/{month}', $runtime['storagePath'] );
		$this->assertSame( '{md5}', $runtime['fileNameRule'] );
		$this->assertSame( array( 'webp', 'png', 'jpg', 'jpeg', 'jfif', 'gif' ), $runtime['behaviors']['uploadFormats'] );
		$this->assertSame( $stored, get_option( Options::EDITOR_SETTINGS ) );
	}

	public function test_next_legitimate_save_migrates_the_prior_two_field_shape_to_canonical_fields() {
		$stored = $this->prior_two_field_shape();
		update_option( Options::EDITOR_SETTINGS, $stored, false );
		$repository = new SettingsCenterRepository( new Options(), new ToolbarRegistry() );
		$settings   = $repository->get_settings();
		$settings['images']['titleDisplay'] = 'filename';

		$saved = $repository->update_settings( $settings );
		$after = get_option( Options::EDITOR_SETTINGS );

		$this->assertIsArray( $saved );
		$this->assertSame( 13, $saved['revision'] );
		$this->assertSame( '{md5}', $saved['images']['fileNameRule'] );
		$this->assertSame( '{md5}', $after['settings_center']['images']['fileNameRule'] );
		$this->assertSame( 13, $after['settings_center_revision'] );
	}

	public function test_zero_enabled_extensions_are_rejected_on_save() {
		$repository = new SettingsCenterRepository( new Options(), new ToolbarRegistry() );
		$settings   = $repository->get_settings();
		$settings['images']['uploadFormats'] = array_fill_keys( array( 'webp', 'png', 'jpg', 'jpeg', 'jfif', 'gif' ), false );

		$result = $repository->update_settings( $settings );

		$this->assertWPError( $result );
		$this->assertSame( 'easymde_settings_invalid_payload', $result->get_error_code() );
		$this->assertFalse( get_option( Options::EDITOR_SETTINGS, false ) );
	}

	public function test_unrepresentable_legacy_and_canonical_ext_rules_fail_without_defaulting() {
		$cases = array(
			array( 'fileNameRule' => 'legacy/{ext}/{md5}' ),
			array( 'storagePath' => 'legacy/{ext}', 'fileNameRule' => '{md5}' ),
		);

		foreach ( $cases as $image_settings ) {
			update_option( Options::EDITOR_SETTINGS, array( 'settings_center' => array( 'images' => $image_settings ) ), false );
			$repository = new SettingsCenterRepository( new Options(), new ToolbarRegistry() );

			try {
				$repository->get_settings();
				$this->fail( 'Expected invalid image rule configuration to fail visibly.' );
			} catch ( RuntimeException $exception ) {
				$this->assertSame( SettingsCenterRepository::CONFIGURATION_ERROR_CODE, $exception->getMessage() );
			}
		}
	}

	private function prior_two_field_shape() {
		return array(
			'settings_center_revision' => 12,
			'settings_center'          => array(
				'images' => array(
					'storagePath'  => '{year}/{month}',
					'fileNameRule' => '{md5}.{ext}',
					'uploadFormats' => array(
						'jpg'  => true,
						'png'  => true,
						'webp' => true,
						'gif'  => true,
					),
				),
			),
		);
	}
}
