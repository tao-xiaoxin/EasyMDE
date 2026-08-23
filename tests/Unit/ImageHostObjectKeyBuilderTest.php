<?php

use EasyMDE\ImageHosting\ImageHostException;
use EasyMDE\ImageHosting\ObjectKeyBuilder;

final class ImageHostObjectKeyBuilderTest extends WP_UnitTestCase {

	public function test_builds_a_key_from_validated_content_and_template() {
		$builder = new ObjectKeyBuilder();
		$bytes   = 'synthetic-image-bytes';
		$key     = $builder->build(
			'{date}/{post_id}/{md5}-{uuid}-{name}.{ext}',
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

	public function test_rejects_unknown_mime_empty_content_and_unsafe_templates() {
		$builder = new ObjectKeyBuilder();
		$now     = new DateTimeImmutable( '2026-07-13 15:30:45', new DateTimeZone( 'UTC' ) );

		foreach (
			array(
				array( '{date}/{uuid}.{ext}', 'bytes', 'x.svg', 'image/svg+xml', 'image_host_unsupported_mime' ),
				array( '{date}/{uuid}.{ext}', '', 'x.png', 'image/png', 'image_host_empty_file' ),
				array( '../{uuid}.{ext}', 'bytes', 'x.png', 'image/png', 'image_host_invalid_key_template' ),
				array( '{unknown}.{ext}', 'bytes', 'x.png', 'image/png', 'image_host_invalid_key_template' ),
			) as $case
		) {
			try {
				$builder->build( $case[0], $case[1], $case[2], $case[3], 0, $now, 'synthetic-uuid' );
				$this->fail( 'Expected the object key builder to reject invalid input.' );
			} catch ( ImageHostException $exception ) {
				$this->assertSame( $case[4], $exception->get_error_code() );
			}
		}
	}
}
