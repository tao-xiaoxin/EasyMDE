<?php

use EasyMDE\ImageHosting\ImageHostException;
use EasyMDE\ImageHosting\ObjectKeyBuilder;

final class ImageHostObjectKeyBuilderTest extends WP_UnitTestCase {

	public function test_builds_a_key_from_separate_storage_path_and_file_name_rule() {
		$builder = new ObjectKeyBuilder();
		$bytes   = 'synthetic-image-bytes';
		$key     = $builder->build(
			'{year}/{month}',
			'{md5}.{ext}',
			$bytes,
			'Example Image.exe',
			'image/png',
			42,
			new DateTimeImmutable( '2026-07-13 15:30:45', new DateTimeZone( 'UTC' ) ),
			'00000000-0000-4000-8000-000000000000'
		);

		$this->assertSame(
			'2026/07/' . md5( $bytes ) . '.png',
			$key
		);
	}

	public function test_combined_validation_requires_ext_but_allows_it_in_storage_path() {
		$builder = new ObjectKeyBuilder();
		$bytes   = 'synthetic-image-bytes';
		$key     = $builder->build(
			'prefix/{ext}',
			'{md5}',
			$bytes,
			'image.png',
			'image/png',
			0,
			new DateTimeImmutable( '2026-07-13 15:30:45', new DateTimeZone( 'UTC' ) ),
			'00000000-0000-4000-8000-000000000000'
		);

		$this->assertSame( 'prefix/png/' . md5( $bytes ), $key );
	}

	public function test_combined_template_length_is_limited_to_160_bytes() {
		$builder = new ObjectKeyBuilder();
		$now     = new DateTimeImmutable( '2026-07-13 15:30:45', new DateTimeZone( 'UTC' ) );

		$this->expectException( ImageHostException::class );
		$this->expectExceptionMessage( 'image_host_invalid_key_template' );
		$builder->build(
			str_repeat( 'a', 159 ),
			'{ext}',
			'bytes',
			'x.png',
			'image/png',
			0,
			$now,
			'synthetic-uuid'
		);
	}

	public function test_legacy_template_validation_rejects_a_leading_separator_before_split() {
		$builder = new ObjectKeyBuilder();

		$this->expectException( ImageHostException::class );
		$this->expectExceptionMessage( 'image_host_invalid_key_template' );
		$builder->validate_legacy_template( '/{name}.{ext}' );
	}

	public function test_storage_path_rejects_dot_segments_before_object_key_expansion()
	{
		$builder = new ObjectKeyBuilder();

		foreach ( array( '.', 'a/./b' ) as $storage_path ) {
			try {
				$builder->validate( $storage_path, '{md5}.{ext}' );
				$this->fail( 'Expected dot storage path segments to be rejected.' );
			} catch ( ImageHostException $exception ) {
				$this->assertSame( 'image_host_invalid_key_template', $exception->get_error_code(), $storage_path );
			}
		}
	}

	public function test_valid_placeholder_storage_path_remains_accepted()
	{
		$builder = new ObjectKeyBuilder();

		$this->assertSame( '2026/07/' . md5( 'bytes' ) . '.png', $builder->build(
			'{year}/{month}',
			'{md5}.{ext}',
			'bytes',
			'image.png',
			'image/png',
			0,
			new DateTimeImmutable( '2026-07-13 15:30:45', new DateTimeZone( 'UTC' ) ),
			'00000000-0000-4000-8000-000000000000'
		) );
	}

	public function test_complete_template_rejects_dot_segments_in_the_file_name_rule()
	{
		$builder = new ObjectKeyBuilder();

		$this->expectException( ImageHostException::class );
		$this->expectExceptionMessage( 'image_host_invalid_key_template' );
		$builder->validate( '{ext}', '.' );
	}

	public function test_legacy_template_validation_rejects_nested_dot_segments()
	{
		$builder = new ObjectKeyBuilder();

		$this->expectException( ImageHostException::class );
		$this->expectExceptionMessage( 'image_host_invalid_key_template' );
		$builder->validate_legacy_template( 'a/./b/{name}.{ext}' );
	}

	public function test_builds_a_key_from_validated_content_and_template() {
		$builder = new ObjectKeyBuilder();
		$bytes   = 'synthetic-image-bytes';
		$key     = $builder->build(
			'{date}/{post_id}',
			'{md5}-{uuid}-{name}.{ext}',
			$bytes,
			'Example Image.exe',
			'image/png',
			42,
			new DateTimeImmutable( '2026-07-13 15:30:45', new DateTimeZone( 'UTC' ) ),
			'00000000-0000-4000-8000-000000000000'
		);

		$this->assertSame(
			'20260713/42/' . md5( $bytes ) . '-00000000-0000-4000-8000-000000000000-example-image.png',
			$key
		);
	}

	public function test_md5_variable_uses_the_exact_uploaded_byte_sequence() {
		$builder = new ObjectKeyBuilder();
		$bytes   = 'The quick brown fox jumps over the lazy dog';

		$key = $builder->build(
			'',
			'{md5}.{ext}',
			$bytes,
			'image.png',
			'image/png',
			0,
			new DateTimeImmutable( '2026-07-13 15:30:45', new DateTimeZone( 'UTC' ) ),
			'00000000-0000-4000-8000-000000000000'
		);

		$this->assertSame( '9e107d9d372bb6826bd81d3542a419d6.png', $key );
	}

	public function test_rejects_unknown_mime_empty_content_and_unsafe_templates() {
		$builder = new ObjectKeyBuilder();
		$now     = new DateTimeImmutable( '2026-07-13 15:30:45', new DateTimeZone( 'UTC' ) );

		foreach (
			array(
				array( '{date}', '{uuid}.{ext}', 'bytes', 'x.svg', 'image/svg+xml', 'image_host_unsupported_mime' ),
				array( '{date}', '{uuid}.{ext}', '', 'x.png', 'image/png', 'image_host_empty_file' ),
				array( '../', '{uuid}.{ext}', 'bytes', 'x.png', 'image/png', 'image_host_invalid_key_template' ),
				array( '', '{unknown}.{ext}', 'bytes', 'x.png', 'image/png', 'image_host_invalid_key_template' ),
			) as $case
		) {
			try {
				$builder->build( $case[0], $case[1], $case[2], $case[3], $case[4], 0, $now, 'synthetic-uuid' );
				$this->fail( 'Expected the object key builder to reject invalid input.' );
			} catch ( ImageHostException $exception ) {
				$this->assertSame( $case[5], $exception->get_error_code() );
			}
		}
	}
}
