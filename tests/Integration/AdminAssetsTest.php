<?php

use EasyMDE\Admin\AdminAssets;
use EasyMDE\Admin\PostModeController;
use EasyMDE\Admin\SettingsPage;
use EasyMDE\Content\PostDocument;
use EasyMDE\Frontend\FrontendAssets;
use EasyMDE\Support\Asset;
use EasyMDE\Support\Options;
use EasyMDE\Support\ToolbarRegistry;
use EasyMDE\Theme\ArticleThemeRegistry;
use EasyMDE\Theme\CodeThemeRegistry;
use EasyMDE\Theme\CustomCssPolicy;
use EasyMDE\Theme\ThemeStateRepository;

final class AdminAssetsTest extends WP_UnitTestCase {

	private $admin_assets;
	private $get_react_editor_asset;
	private $get_static_asset_version;
	private $get_storage_config;
	private $get_strings;
	private $get_editor_root_bootstrap;

	public function set_up() {
		parent::set_up();

		$post_document             = new PostDocument();
		$theme_state_repository    = new ThemeStateRepository( new ArticleThemeRegistry(), new CodeThemeRegistry(), new CustomCssPolicy() );
		$toolbar_registry          = new ToolbarRegistry();
		$this->admin_assets        = new AdminAssets(
			new PostModeController( $post_document ),
			new FrontendAssets( $post_document, $theme_state_repository ),
			$theme_state_repository,
			$toolbar_registry,
			new SettingsPage( $toolbar_registry, new Options() )
		);
		$reflection                = new ReflectionClass( AdminAssets::class );
		$this->get_react_editor_asset = $reflection->getMethod( 'get_react_editor_asset' );
		$this->get_static_asset_version = $reflection->getMethod( 'get_static_asset_version' );
		$this->get_storage_config = $reflection->getMethod( 'get_storage_config' );
		$this->get_strings = $reflection->getMethod( 'get_strings' );
		$this->get_editor_root_bootstrap = $reflection->getMethod( 'get_editor_root_bootstrap' );
		$this->get_react_editor_asset->setAccessible( true );
		$this->get_static_asset_version->setAccessible( true );
		$this->get_storage_config->setAccessible( true );
		$this->get_strings->setAccessible( true );
		$this->get_editor_root_bootstrap->setAccessible( true );
		wp_cache_flush();
	}

	public function test_editor_root_bootstrap_exposes_the_complete_single_root_contract() {
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$post_id = self::factory()->post->create( array( 'post_author' => $user_id ) );
		wp_set_current_user( $user_id );

		$bootstrap = $this->get_editor_root_bootstrap->invoke( $this->admin_assets, $post_id );

		$this->assertSame( 2, $bootstrap['schemaVersion'] );
		$this->assertArrayHasKey( 'shortcodeHelpers', $bootstrap );
		$this->assertSame( $post_id, $bootstrap['preview']['postId'] );
		$this->assertIsObject( $bootstrap['preview']['features'] );
		$this->assertSame( $post_id, $bootstrap['imageUpload']['postId'] );
		$this->assertSame( $post_id, $bootstrap['localDrafts']['postId'] );
		$this->assertArrayHasKey( 'document', $bootstrap );
		$this->assertArrayHasKey( 'appearance', $bootstrap );
		$this->assertArrayHasKey( 'fonts', $bootstrap );
		$this->assertArrayHasKey( 'layout', $bootstrap );
		$this->assertArrayHasKey( 'mediaPicker', $bootstrap );
		$this->assertArrayHasKey( 'previewEnhancement', $bootstrap );
		$this->assertArrayHasKey( 'immersive', $bootstrap['strings'] );
		$this->assertArrayNotHasKey( 'publishing', $bootstrap );
		$this->assertArrayNotHasKey( 'revisions', $bootstrap );
		$this->assertArrayHasKey( 'toolbar', $bootstrap );
		$this->assertArrayHasKey( 'wechatExport', $bootstrap );
		$this->assertArrayHasKey( 'wordpress', $bootstrap );
		$this->assertSame( rest_url( 'easymde/v1/preview' ), $bootstrap['wordpress']['previewUrl'] );
		$this->assertArrayNotHasKey( 'revisionAdminUrl', $bootstrap['wordpress'] );
		$this->assertSame( rest_url( 'easymde/v1/posts/' ), $bootstrap['wordpress']['revisionsUrl'] );
		$this->assertSame( rest_url( 'easymde/v1/media' ), $bootstrap['imageUpload']['endpoint'] );
		$this->assertNotEmpty( $bootstrap['wordpress']['nonce'] );
		$this->assertSame( $bootstrap['wordpress']['nonce'], $bootstrap['imageUpload']['nonce'] );
	}

	public function test_local_draft_bootstrap_exposes_a_versioned_bounded_locale_contract() {
		$user_id = self::factory()->user->create( array( 'role' => 'author' ) );
		wp_set_current_user( $user_id );
		update_option( 'timezone_string', 'Asia/Shanghai' );

		$storage = $this->get_storage_config->invoke( $this->admin_assets, 41 );

		$this->assertSame( 1, $storage['draftSchemaVersion'] );
		$this->assertSame( 1048576, $storage['draftMaxBytes'] );
		$this->assertSame( get_user_locale( $user_id ), $storage['locale'] );
		$this->assertSame( 'Asia/Shanghai', $storage['timeZone'] );
		$this->assertSame( 41, $storage['postId'] );
		$this->assertSame( $user_id, $storage['userId'] );
	}

	public function test_local_draft_failures_and_conflicts_have_php_gettext_messages() {
		$strings = $this->get_strings->invoke( $this->admin_assets );

		$this->assertSame( 'Local draft could not be read.', $strings['draftReadFailed'] );
		$this->assertSame( 'Local draft could not be saved.', $strings['draftSaveFailed'] );
		$this->assertSame( 'Local draft could not be discarded.', $strings['draftDiscardFailed'] );
		$this->assertSame( 'A different local draft was saved in another tab.', $strings['draftConflict'] );
	}

	public function test_editor_layout_omits_withdrawn_ui_strings_and_keeps_native_direction() {
		$strings = $this->get_strings->invoke( $this->admin_assets );
		$bootstrap = $this->get_editor_root_bootstrap->invoke( $this->admin_assets, 0 );

		$this->assertArrayNotHasKey( 'outline', $strings );
		$this->assertArrayNotHasKey( 'resizePanes', $strings );
		$this->assertArrayNotHasKey( 'publishingTitle', $strings );
		$this->assertArrayNotHasKey( 'historyVersions', $strings );
		$this->assertTrue( in_array( $bootstrap['layout']['direction'], array( 'ltr', 'rtl' ), true ) );
	}

	public function test_toolbar_stylesheet_uses_a_content_version_for_the_react_owner() {
		$asset_path = 'assets/css/admin/toolbar.css';
		$version    = $this->get_static_asset_version->invoke( $this->admin_assets, $asset_path );

		$this->assertMatchesRegularExpression( '/^[a-f0-9]{16}$/', $version );
		$this->assertSame( substr( hash_file( 'sha256', Asset::path( $asset_path ) ), 0, 16 ), $version );
		$this->assertNotSame( EASYMDE_VERSION, $version );
	}

	public function test_editor_stylesheet_uses_a_content_version_for_the_react_owner() {
		$asset_path = 'assets/css/admin/editor.css';
		$version    = $this->get_static_asset_version->invoke( $this->admin_assets, $asset_path );

		$this->assertMatchesRegularExpression( '/^[a-f0-9]{16}$/', $version );
		$this->assertSame( substr( hash_file( 'sha256', Asset::path( $asset_path ) ), 0, 16 ), $version );
		$this->assertNotSame( EASYMDE_VERSION, $version );
	}

	public function test_resolves_the_committed_react_editor_manifest_and_dependency_metadata() {
		$asset = $this->get_react_editor_asset->invoke( $this->admin_assets );

		$this->assertSame( 'easymde-admin-editor-toolbar', $asset['handle'] );
		$this->assertMatchesRegularExpression( '#^assets/build/assets/admin-editor-[A-Za-z0-9_-]+\.js$#', $asset['path'] );
		$this->assertSame( array( 'media-editor', 'wp-api-fetch', 'wp-element', 'wp-hooks' ), $asset['dependencies'] );
		$this->assertMatchesRegularExpression( '/^[a-f0-9]{16}$/', $asset['version'] );
		$this->assertFileExists( Asset::path( $asset['path'] ) );
	}

	public function test_rejects_react_editor_bundle_bytes_that_do_not_match_dependency_metadata() {
		$build_dir = trailingslashit( get_temp_dir() ) . 'easymde-react-editor-integrity-' . wp_generate_uuid4();
		$file      = 'assets/admin-editor-synthetic.js';
		$asset     = 'assets/admin-editor-synthetic.asset.php';
		wp_mkdir_p( $build_dir . '/assets' );
		file_put_contents( $build_dir . '/' . $file, 'console.log("corrupted");' );
		file_put_contents(
			$build_dir . '/' . $asset,
			"<?php\nreturn array(\n\t'dependencies' => array( 'media-editor', 'wp-api-fetch', 'wp-element', 'wp-hooks' ),\n\t'version' => '0000000000000000',\n);\n"
		);
		file_put_contents(
			$build_dir . '/wordpress-manifest.json',
			wp_json_encode(
				array(
					'schemaVersion' => 1,
					'entries'       => array(
						'frontend/src/entrypoints/admin-editor.tsx' => array(
							'handle'       => 'easymde-admin-editor-toolbar',
							'file'         => $file,
							'asset'        => $asset,
							'dependencies' => array( 'media-editor', 'wp-api-fetch', 'wp-element', 'wp-hooks' ),
							'resources'    => array(),
						),
					)
				)
			)
		);

		try {
			$this->expectException( RuntimeException::class );
			$this->expectExceptionMessage( 'react-editor-build-integrity-invalid' );
			$this->get_react_editor_asset->invoke( $this->admin_assets, $build_dir );
		} finally {
			wp_delete_file( $build_dir . '/' . $file );
			wp_delete_file( $build_dir . '/' . $asset );
			wp_delete_file( $build_dir . '/wordpress-manifest.json' );
			rmdir( $build_dir . '/assets' );
			rmdir( $build_dir );
		}
	}

	public function test_rejects_an_incompatible_react_editor_manifest_contract() {
		$build_dir = trailingslashit( get_temp_dir() ) . 'easymde-react-editor-invalid-' . wp_generate_uuid4();
		wp_mkdir_p( $build_dir );
		file_put_contents(
			$build_dir . '/wordpress-manifest.json',
			wp_json_encode(
				array(
					'schemaVersion' => 2,
						'entries'       => array(),
					)
				)
		);

		try {
			$this->expectException( RuntimeException::class );
			$this->expectExceptionMessage( 'react-editor-manifest-invalid' );
			$this->get_react_editor_asset->invoke( $this->admin_assets, $build_dir );
		} finally {
			wp_delete_file( $build_dir . '/wordpress-manifest.json' );
			rmdir( $build_dir );
		}
	}

	public function test_react_editor_asset_failure_is_visible_to_the_administrator() {
		$build_dir = trailingslashit( get_temp_dir() ) . 'easymde-react-editor-missing-' . wp_generate_uuid4();
		wp_mkdir_p( $build_dir );
		$enqueue_react_editor_asset = new ReflectionMethod( AdminAssets::class, 'enqueue_react_editor_asset' );
		$enqueue_react_editor_asset->setAccessible( true );

		set_error_handler(
			static function () {
				return true;
			},
			E_USER_WARNING
		);

		try {
			$this->assertFalse( $enqueue_react_editor_asset->invoke( $this->admin_assets, $build_dir ) );
		} finally {
			restore_error_handler();
			rmdir( $build_dir );
		}

		ob_start();
		$this->admin_assets->render_react_editor_asset_notice();
		$notice = ob_get_clean();

		$this->assertStringContainsString( 'notice notice-error', $notice );
		$this->assertStringContainsString( 'EasyMDE could not load the editor application.', $notice );
	}

	public function test_react_editor_asset_notice_is_registered_with_admin_notices() {
		$this->admin_assets->register_hooks();

		$this->assertNotFalse(
			has_action( 'admin_notices', array( $this->admin_assets, 'render_react_editor_asset_notice' ) )
		);
	}

	public function tear_down() {
		remove_all_actions( 'admin_enqueue_scripts' );
		remove_all_actions( 'admin_notices' );
		wp_cache_flush();

		parent::tear_down();
	}

}
