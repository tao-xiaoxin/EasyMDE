<?php

use EasyMDE\Support\ManifestAssetResolver;

final class ManifestAssetResolverTest extends WP_UnitTestCase
{
	public function test_resolves_the_admin_editor_with_exactly_one_local_png_worker_resource()
	{
		$build_dir = $this->create_build_directory(
			array( 'assets/wechat-png-encoder-test.js' ),
			true
		);

		try {
			$result = ManifestAssetResolver::resolve(
				'frontend/src/entrypoints/admin-editor.tsx',
				$build_dir,
				'easymde-admin-editor-toolbar',
				array( 'wp-api-fetch', 'wp-element', 'wp-hooks', 'wp-i18n' ),
				'admin-editor',
				true,
				'react-editor-',
				'#^assets/wechat-png-encoder-[A-Za-z0-9_-]+\.js$#'
			);

			$this->assertSame( 'easymde-admin-editor-toolbar', $result['handle'] );
			$this->assertSame( $build_dir . 'assets/admin-editor-test.js', $result['path'] );
		} finally {
			$this->remove_build_directory( $build_dir );
		}
	}

	public function test_generic_manifest_contract_still_rejects_any_resource()
	{
		$build_dir = $this->create_build_directory(
			array( 'assets/wechat-png-encoder-test.js' ),
			true
		);

		try {
			$this->expectException( RuntimeException::class );
			$this->expectExceptionMessage( 'manifest-invalid' );

			ManifestAssetResolver::resolve(
				'frontend/src/entrypoints/admin-editor.tsx',
				$build_dir,
				'easymde-admin-editor-toolbar',
				array( 'wp-api-fetch', 'wp-element', 'wp-hooks', 'wp-i18n' ),
				'admin-editor'
			);
		} finally {
			$this->remove_build_directory( $build_dir );
		}
	}

	public function test_admin_resource_contract_rejects_remote_or_unknown_paths()
	{
		foreach ( array( 'https://example.test/worker.js', 'assets/unowned.js' ) as $resource ) {
			$build_dir = $this->create_build_directory( array( $resource ), true );

			try {
				$this->assert_manifest_is_rejected( $build_dir );
			} finally {
				$this->remove_build_directory( $build_dir );
			}
		}
	}

	public function test_admin_resource_contract_rejects_duplicate_or_missing_paths()
	{
		$cases = array(
			array( 'assets/wechat-png-encoder-test.js', 'assets/wechat-png-encoder-test.js' ),
			array( 'assets/wechat-png-encoder-missing.js' ),
		);

		foreach ( $cases as $resources ) {
			$build_dir = $this->create_build_directory(
				$resources,
				1 === count( $resources ) && 'assets/wechat-png-encoder-test.js' === $resources[0]
			);

			try {
				$this->assert_manifest_is_rejected( $build_dir );
			} finally {
				$this->remove_build_directory( $build_dir );
			}
		}
	}

	private function create_build_directory( $resources, $create_worker )
	{
		$build_dir = trailingslashit( get_temp_dir() ) . 'easymde-manifest-resolver-' . wp_generate_uuid4() . '/';
		wp_mkdir_p( $build_dir . 'assets' );
		$script = 'assets/admin-editor-test.js';
		$asset  = 'assets/admin-editor-test.asset.php';
		$source = 'window.EasyMDEAdminEditorStart = function () {};';

		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- Writes isolated local test fixtures.
		file_put_contents( $build_dir . $script, $source );
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- Writes isolated local test fixtures.
		file_put_contents(
			$build_dir . $asset,
			"<?php\nreturn array( 'dependencies' => array( 'wp-api-fetch', 'wp-element', 'wp-hooks', 'wp-i18n' ), 'version' => '" . substr( hash( 'sha256', $source ), 0, 16 ) . "' );\n"
		);

		$manifest = array(
			'schemaVersion' => 1,
			'entries'       => array(
				'frontend/src/entrypoints/admin-editor.tsx' => array(
					'handle'       => 'easymde-admin-editor-toolbar',
					'file'         => $script,
					'asset'        => $asset,
					'dependencies' => array( 'wp-api-fetch', 'wp-element', 'wp-hooks', 'wp-i18n' ),
					'resources'    => $resources,
				),
			),
		);
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- Writes isolated local test fixtures.
		file_put_contents( $build_dir . 'wordpress-manifest.json', wp_json_encode( $manifest ) );

		if ( $create_worker ) {
			// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- Writes isolated local test fixtures.
			file_put_contents( $build_dir . 'assets/wechat-png-encoder-test.js', 'self.onmessage = function () {};' );
		}

		return $build_dir;
	}

	private function assert_manifest_is_rejected( $build_dir )
	{
		try {
			ManifestAssetResolver::resolve(
				'frontend/src/entrypoints/admin-editor.tsx',
				$build_dir,
				'easymde-admin-editor-toolbar',
				array( 'wp-api-fetch', 'wp-element', 'wp-hooks', 'wp-i18n' ),
				'admin-editor',
				true,
				'react-editor-',
				'#^assets/wechat-png-encoder-[A-Za-z0-9_-]+\.js$#'
			);
			$this->fail( 'The invalid manifest unexpectedly resolved.' );
		} catch ( RuntimeException $error ) {
			$this->assertSame( 'react-editor-manifest-invalid', $error->getMessage() );
		}
	}

	private function remove_build_directory( $build_dir )
	{
		foreach ( glob( $build_dir . 'assets/*' ) ?: array() as $path ) {
			wp_delete_file( $path );
		}
		wp_delete_file( $build_dir . 'wordpress-manifest.json' );
		wp_delete_file( $build_dir . 'assets/admin-editor-test.js' );
		wp_delete_file( $build_dir . 'assets/admin-editor-test.asset.php' );
		rmdir( $build_dir . 'assets' );
		rmdir( $build_dir );
	}
}
