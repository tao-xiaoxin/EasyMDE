<?php

use EasyMDE\ImageHosting\ImageUploadExtensionPolicy;
use EasyMDE\ImageHosting\ImageHostException;
use EasyMDE\ImageHosting\JfifMimeScope;
use EasyMDE\ImageHosting\ObjectKeyBuilder;

final class ImageUploadExtensionPolicyTest extends WP_UnitTestCase {

	public function test_registry_is_ordered_and_defaults_enable_all_extensions() {
		$this->assertSame(
			array( 'webp', 'png', 'jpg', 'jpeg', 'jfif', 'gif' ),
			ImageUploadExtensionPolicy::extensions()
		);
		$this->assertSame(
			array(
				'webp' => true,
				'png'  => true,
				'jpg'  => true,
				'jpeg' => true,
				'jfif' => true,
				'gif'  => true,
			),
			ImageUploadExtensionPolicy::defaults()
		);
	}

	public function test_canonical_rule_appends_the_exact_verified_source_extension_once() {
		$key = ( new ObjectKeyBuilder() )->build(
			'2026/07',
			'{md5}',
			'synthetic-image-bytes',
			'photo.JPEG',
			'image/jpeg',
			0,
			new DateTimeImmutable( '2026-07-13 15:30:45', new DateTimeZone( 'UTC' ) ),
			'00000000-0000-4000-8000-000000000000'
		);

		$this->assertSame( '2026/07/' . md5( 'synthetic-image-bytes' ) . '.jpeg', $key );
	}

	public function test_all_naming_variables_expand_across_path_and_stem_before_one_verified_suffix() {
		$bytes = 'synthetic-image-bytes';
		$key   = ( new ObjectKeyBuilder() )->build(
			'{year}/{month}/{day}/{date}/{time}/{post_id}',
			'{md5}-{uuid}-{name}',
			$bytes,
			'Example Image.png',
			'image/png',
			42,
			new DateTimeImmutable( '2026-07-13 15:30:45', new DateTimeZone( 'UTC' ) ),
			'00000000-0000-4000-8000-000000000000'
		);

		$this->assertSame(
			'2026/07/13/20260713/153045/42/' . md5( $bytes ) . '-00000000-0000-4000-8000-000000000000-example-image.png',
			$key
		);
		$this->assertSame( 1, substr_count( $key, '.png' ) );
	}

	public function test_canonical_rules_reject_ext_and_legacy_migration_removes_only_terminal_ext() {
		$builder = new ObjectKeyBuilder();

		foreach ( array( '{md5}.{ext}', 'prefix/{ext}/{md5}', '{md5}{ext}', '{md5}.{ext}.{ext}', '{md5}.png' ) as $rule ) {
			try {
				$builder->validate( '2026/07', $rule );
				$this->fail( 'The canonical rule should reject {ext}: ' . $rule );
			} catch ( ImageHostException $exception ) {
				$this->assertSame( 'image_host_invalid_key_template', $exception->get_error_code() );
			}
		}

		$this->assertSame(
			array( 'legacy/{post_id}', '{name}' ),
			ObjectKeyBuilder::split_legacy_template( 'legacy/{post_id}/{name}.{ext}' )
		);
	}

	public function test_legacy_migration_rejects_unrepresentable_or_empty_stems() {
		$builder = new ObjectKeyBuilder();

		foreach ( array( 'legacy/{ext}/{md5}', 'legacy/{md5}.{ext}/tail', '{ext}', '{md5}.{ext}.{ext}' ) as $rule ) {
			$this->assertNull( ObjectKeyBuilder::split_legacy_template( $rule ), $rule );
		}
	}

	public function test_legacy_four_key_map_expands_jpeg_aliases_without_merging_siblings() {
		$this->assertSame(
			array(
				'webp' => false,
				'png'  => true,
				'jpg'  => false,
				'jpeg' => false,
				'jfif' => false,
				'gif'  => true,
			),
			ImageUploadExtensionPolicy::normalize(
				array(
					'jpg'  => false,
					'png'  => true,
					'webp' => false,
					'gif'  => true,
				)
			)
		);
	}

	public function test_exact_filename_extension_is_checked_against_mime_and_selection() {
		$formats = ImageUploadExtensionPolicy::defaults();
		$formats['jpg'] = false;

		$this->assertFalse( ImageUploadExtensionPolicy::verify( 'photo.jpg', 'image/jpeg', $formats ) );
		$this->assertSame( 'jpeg', ImageUploadExtensionPolicy::verify( 'photo.jpeg', 'image/jpeg', $formats ) );
		$this->assertFalse( ImageUploadExtensionPolicy::verify( 'photo.png', 'image/jpeg', $formats ) );
		$this->assertSame( 'jpg', ImageUploadExtensionPolicy::verify( 'photo.jpg', 'image/jpeg', ImageUploadExtensionPolicy::defaults() ) );
	}

	public function test_jfif_core_mapping_is_scoped_to_the_owned_file_and_cleaned_up() {
		$path = wp_tempnam( 'easymde-jfif' );
		file_put_contents( $path, base64_decode( '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=', true ) );
		$baseline_mimes = has_filter( 'upload_mimes' );
		$checked = JfifMimeScope::run(
			$path,
			'photo.jfif',
			static function () use ( $path ) {
				return wp_check_filetype_and_ext( $path, 'photo.jfif' );
			}
		);

		try {
			$this->assertSame( 'jfif', $checked['ext'] );
			$this->assertSame( 'image/jpeg', $checked['type'] );
			$this->assertFalse( has_filter( 'wp_check_filetype_and_ext' ) );
			$this->assertSame( $baseline_mimes, has_filter( 'upload_mimes' ) );
		} finally {
			wp_delete_file( $path );
		}
	}

	public function test_jfif_scope_does_not_bypass_site_jpeg_policy_or_authorize_an_unrelated_name() {
		$path = wp_tempnam( 'easymde-jfif' );
		file_put_contents( $path, base64_decode( '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=', true ) );
		$deny_jpeg = static function ( $mimes ) {
			foreach ( $mimes as $key => $mime ) {
				if ( 'image/jpeg' === $mime ) {
					unset( $mimes[ $key ] );
				}
			}

			return $mimes;
		};
		add_filter( 'upload_mimes', $deny_jpeg, PHP_INT_MAX, 1 );

		try {
			$denied = JfifMimeScope::run(
				$path,
				'photo.jfif',
				static function () use ( $path ) {
					return wp_check_filetype_and_ext( $path, 'photo.jfif' );
				}
			);
			$denied_with_explicit_mime = JfifMimeScope::run(
				$path,
				'photo.jfif',
				static function () use ( $path ) {
					return wp_check_filetype_and_ext( $path, 'photo.jfif', array( 'jfif' => 'image/jpeg' ) );
				}
			);
			remove_filter( 'upload_mimes', $deny_jpeg, PHP_INT_MAX );
			$unrelated = JfifMimeScope::run(
				$path,
				'photo.jfif',
				static function () use ( $path ) {
					return wp_check_filetype_and_ext( $path, 'other.jfif' );
				}
			);
		} finally {
			remove_filter( 'upload_mimes', $deny_jpeg, PHP_INT_MAX );
			wp_delete_file( $path );
		}

		$this->assertNotSame( 'image/jpeg', $denied['type'] );
		$this->assertNotSame( 'image/jpeg', $denied_with_explicit_mime['type'] );
		$this->assertNotSame( 'image/jpeg', $unrelated['type'] );
	}
}
