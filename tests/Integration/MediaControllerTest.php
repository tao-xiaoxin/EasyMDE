<?php

use EasyMDE\Rest\MediaController;
use EasyMDE\Support\Capabilities;
use EasyMDE\Support\Options;
use EasyMDE\Support\SettingsCenterRepository;
use EasyMDE\Support\ToolbarRegistry;

final class MediaControllerTest extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();
		delete_option( Options::EDITOR_SETTINGS );
	}

	public function tear_down() {
		delete_option( Options::EDITOR_SETTINGS );
		parent::tear_down();
	}

	public function test_saved_upload_formats_are_enforced_by_the_media_controller() {
		$repository = new SettingsCenterRepository( new Options(), new ToolbarRegistry() );
		$settings   = $repository->get_settings();
		$settings['images']['uploadFormats'] = array(
			'jpg'  => false,
			'png'  => true,
			'webp' => false,
			'gif'  => false,
		);
		$this->assertIsArray( $repository->update_settings( $settings ) );

		$controller = new MediaController( new Capabilities(), $repository );
		$reflection = new ReflectionMethod( MediaController::class, 'is_allowed_image_file' );
		$reflection->setAccessible( true );
		$png_path = wp_tempnam( 'allowed.png' );
		$jpg_path = wp_tempnam( 'blocked.jpg' );
		file_put_contents( $png_path, base64_decode( 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', true ) );
		file_put_contents( $jpg_path, base64_decode( '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=', true ) );

		try {
			$this->assertTrue(
				$reflection->invoke( $controller, array( 'name' => 'allowed.png', 'tmp_name' => $png_path ) )
			);
			$this->assertFalse(
				$reflection->invoke( $controller, array( 'name' => 'blocked.jpg', 'tmp_name' => $jpg_path ) )
			);
		} finally {
			unlink( $png_path );
			unlink( $jpg_path );
		}
	}
}
