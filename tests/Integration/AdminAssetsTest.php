<?php

use EasyMDE\Admin\AdminAssets;
use EasyMDE\Admin\MediaPickerPage;
use EasyMDE\Admin\PostModeController;
use EasyMDE\Content\PostDocument;
use EasyMDE\Frontend\FrontendAssets;
use EasyMDE\Support\Asset;
use EasyMDE\Support\FrontendAssetContract;
use EasyMDE\Support\Options;
use EasyMDE\Support\SettingsCenterRepository;
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
	private $get_custom_css_variables;
	private $get_custom_css_dialog_strings;
	private $get_editor_root_bootstrap;
	private $get_react_editor_loader_asset;

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
			new SettingsCenterRepository( new Options(), $toolbar_registry )
		);
		$reflection                = new ReflectionClass( AdminAssets::class );
		$this->get_react_editor_asset = $reflection->getMethod( 'get_react_editor_asset' );
		$this->get_static_asset_version = $reflection->getMethod( 'get_static_asset_version' );
		$this->get_storage_config = $reflection->getMethod( 'get_storage_config' );
		$this->get_strings = $reflection->getMethod( 'get_strings' );
		$this->get_custom_css_variables = $reflection->getMethod( 'get_custom_css_variables' );
		$this->get_custom_css_dialog_strings = $reflection->getMethod( 'get_custom_css_dialog_strings' );
		$this->get_editor_root_bootstrap = $reflection->getMethod( 'get_editor_root_bootstrap' );
		$this->get_react_editor_loader_asset = $reflection->getMethod( 'get_react_editor_loader_asset' );
		$this->get_react_editor_asset->setAccessible( true );
		$this->get_static_asset_version->setAccessible( true );
		$this->get_storage_config->setAccessible( true );
		$this->get_strings->setAccessible( true );
		$this->get_custom_css_variables->setAccessible( true );
		$this->get_custom_css_dialog_strings->setAccessible( true );
		$this->get_editor_root_bootstrap->setAccessible( true );
		$this->get_react_editor_loader_asset->setAccessible( true );
		wp_cache_flush();
	}

	public function test_editor_root_bootstrap_exposes_the_complete_single_root_contract() {
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$post_id = self::factory()->post->create( array( 'post_author' => $user_id ) );
		update_post_meta( $post_id, '_edit_last', $user_id );
		wp_set_current_user( $user_id );
		$this->enable_image_hosting();

		$bootstrap = $this->get_editor_root_bootstrap->invoke( $this->admin_assets, $post_id );

		$this->assertSame( 3, $bootstrap['schemaVersion'] );
		$this->assertSame(
			array(
				'Copy code',
				'Copy code block',
				'Copy Code Block Content',
				'Copy as image',
				'Copy MathML',
				'Copy image',
				'Copy link address',
				'Copy TeX',
				'Copy with simplified formatting',
				'Delete',
				'Delete horizontal rule',
				'Delete image',
				'Diagram',
				'Edit',
				'Format Table Source',
				'Formula',
				'Insert paragraph above',
				'Insert paragraph below',
			),
			array(
				$bootstrap['strings']['contextMenu']['copyDiagramSource'],
				$bootstrap['strings']['contextMenu']['copyCodeBlock'],
				$bootstrap['strings']['contextMenu']['copyCodeContent'],
				$bootstrap['strings']['contextMenu']['copyGeneratedImage'],
				$bootstrap['strings']['contextMenu']['copyGeneratedMathMl'],
				$bootstrap['strings']['contextMenu']['copyImage'],
				$bootstrap['strings']['contextMenu']['copyLinkAddress'],
				$bootstrap['strings']['contextMenu']['copyMathSource'],
				$bootstrap['strings']['contextMenu']['copySimplifiedFormatting'],
				$bootstrap['strings']['contextMenu']['deleteGeneratedContent'],
				$bootstrap['strings']['contextMenu']['deleteThematicBreak'],
				$bootstrap['strings']['contextMenu']['deleteImage'],
				$bootstrap['strings']['contextMenu']['diagramBlock'],
				$bootstrap['strings']['contextMenu']['editGeneratedContent'],
				$bootstrap['strings']['contextMenu']['formatTableSource'],
				$bootstrap['strings']['contextMenu']['mathBlock'],
				$bootstrap['strings']['contextMenu']['insertParagraphAboveGenerated'],
				$bootstrap['strings']['contextMenu']['insertParagraphBelowGenerated'],
			)
		);
		$this->assertMatchesRegularExpression(
			'#^' . preg_quote( Asset::url( 'assets/build/editor-block-index-worker/assets/editor-block-index-worker-' ), '#' ) . '[A-Za-z0-9_-]+\.js\?ver=[a-f0-9]{16}$#',
			$bootstrap['editorBlockIndexWorkerUrl']
		);
		$this->assertArrayHasKey( 'shortcodeHelpers', $bootstrap );
		$this->assertSame( $post_id, $bootstrap['preview']['postId'] );
		$this->assertIsObject( $bootstrap['preview']['features'] );
		$this->assertSame( $post_id, $bootstrap['imageUpload']['postId'] );
		$this->assertArrayNotHasKey( 'destination', $bootstrap['imageUpload'] );
		$this->assertArrayNotHasKey( 'insertAfterUpload', $bootstrap['imageUpload'] );
		$this->assertNotEmpty( $bootstrap['imageUpload']['actionNonce'] );
		$this->assertSame(
			array( 'image/jpeg', 'image/png', 'image/webp', 'image/gif' ),
			$bootstrap['imageUpload']['allowedMimeTypes']
		);
		$this->assertSame(
			array( 'webp', 'png', 'jpg', 'jpeg', 'jfif', 'gif' ),
			$bootstrap['imageUpload']['allowedExtensions']
		);
		$this->assertSame(
			array( 'titleDisplay' => 'none' ),
			$bootstrap['imageUpload']['insertion']
		);
		$this->assertTrue( $bootstrap['settings']['markdown']['wordWrap'] );
		$this->assertSame(
			array( 'titleDisplay' => 'none' ),
			$bootstrap['mediaPicker']['insertion']
		);
		$this->assertTrue( $bootstrap['mediaPicker']['canUseMedia'] );
		$this->assertSame( MediaPickerPage::get_url( $post_id, 'post' ), $bootstrap['mediaPicker']['frameUrl'] );
		$this->assertSame( $post_id, $bootstrap['localDrafts']['postId'] );
		$this->assertArrayHasKey( 'document', $bootstrap );
		$this->assertArrayHasKey( 'appearance', $bootstrap );
		$this->assertSame(
			current_user_can( 'unfiltered_html' ),
			$bootstrap['appearance']['canManageCustomCss']
		);
		$this->assertFalse( $bootstrap['appearance']['codeThemeExplicit'] );
		$this->assertArrayNotHasKey( 'codeThemeExplicit', $bootstrap['appearance']['state'] );
		$this->assertArrayHasKey( 'fonts', $bootstrap );
		$this->assertArrayHasKey( 'layout', $bootstrap );
		$this->assertSame( 'Character count: %s', $bootstrap['layout']['status']['wordCount'] );
		$this->assertStringContainsString( 'Last edited by', $bootstrap['layout']['status']['lastEdited'] );
		$this->assertStringContainsString( get_userdata( $user_id )->display_name, $bootstrap['layout']['status']['lastEdited'] );
		$this->assertArrayHasKey( 'mediaPicker', $bootstrap );
		$this->assertArrayHasKey( 'previewEnhancement', $bootstrap );
		$this->assertArrayHasKey( 'immersive', $bootstrap['strings'] );
		$this->assertArrayNotHasKey( 'wordCount', $bootstrap['strings']['immersive'] );
		$this->assertArrayNotHasKey( 'wordCountDescription', $bootstrap['strings']['immersive'] );
		$this->assertArrayNotHasKey( 'syncScroll', $bootstrap['strings']['immersive'] );
		$this->assertArrayNotHasKey( 'syncScrollDescription', $bootstrap['strings']['immersive'] );
		$this->assertArrayNotHasKey( 'publishing', $bootstrap );
		$this->assertArrayNotHasKey( 'revisions', $bootstrap );
		$this->assertArrayHasKey( 'toolbar', $bootstrap );
		$this->assertSame( 'Undo', $bootstrap['toolbar']['strings']['undo'] );
		$this->assertArrayHasKey( 'wechatExport', $bootstrap );
		$this->assertFalse( $bootstrap['wechatExport']['pngConversionEnabled'] );
		$this->assertArrayHasKey( 'wordpress', $bootstrap );
		$this->assertArrayHasKey( 'publishCategories', $bootstrap['wordpress'] );
		$this->assertFalse( $bootstrap['wordpress']['isNewPost'] );
		$this->assertSame( rest_url( 'easymde/v1/preview' ), $bootstrap['wordpress']['previewUrl'] );
		$this->assertArrayNotHasKey( 'revisionAdminUrl', $bootstrap['wordpress'] );
		$this->assertSame( rest_url( 'easymde/v1/posts/' ), $bootstrap['wordpress']['revisionsUrl'] );
		$this->assertSame( rest_url( 'easymde/v1/image-hosting/upload' ), $bootstrap['imageUpload']['endpoint'] );
		$this->assertNotEmpty( $bootstrap['wordpress']['nonce'] );
		$this->assertSame( $bootstrap['wordpress']['nonce'], $bootstrap['imageUpload']['nonce'] );
	}

	public function test_corrupt_canonical_settings_enter_the_accessible_editor_start_failure_path()
	{
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$post_id = self::factory()->post->create( array( 'post_author' => $user_id ) );
		update_option(
			Options::EDITOR_SETTINGS,
			array(
				'settings_center' => array(
					'images' => array(
						'storagePath'  => array( 'invalid' ),
						'fileNameRule' => '{md5}.{ext}',
					),
				),
			),
			false
		);
		$previous_get    = $_GET;
		$previous_screen = array_key_exists( 'current_screen', $GLOBALS ) ? $GLOBALS['current_screen'] : null;
		$had_screen      = array_key_exists( 'current_screen', $GLOBALS );

		try {
			wp_set_current_user( $user_id );
			$_GET              = array( 'post' => (string) $post_id );
			$GLOBALS['pagenow'] = 'post.php';
			set_current_screen( 'post' );
			wp_dequeue_script( 'easymde-admin-editor-toolbar' );

			$this->admin_assets->enqueue_admin_assets( 'post.php' );
			$before = wp_scripts()->get_data( 'easymde-admin-editor-toolbar', 'before' );
			$inline = is_array( $before ) ? implode( "\n", $before ) : (string) $before;
			ob_start();
			$this->admin_assets->render_react_editor_asset_notice();
			$notice = ob_get_clean();

			$this->assertStringContainsString( 'EasyMDEAdminEditorLoaderBootstrap', $inline );
			$this->assertStringContainsString( '"editorBootstrap":null', $inline );
			$this->assertSame( '', $notice );
		} finally {
			$_GET = $previous_get;
			if ( $had_screen ) {
				$GLOBALS['current_screen'] = $previous_screen;
			} else {
				unset( $GLOBALS['current_screen'] );
			}
		}
	}

	public function test_editor_root_bootstrap_projects_the_saved_wechat_png_conversion_setting() {
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$post_id = self::factory()->post->create( array( 'post_author' => $user_id ) );
		wp_set_current_user( $user_id );
		$repository = new SettingsCenterRepository( new Options(), new ToolbarRegistry() );
		$settings = $repository->get_settings();
		$settings['images']['wechatPngExportEnabled'] = true;
		$this->assertIsArray( $repository->update_settings( $settings ) );

		$bootstrap = $this->get_editor_root_bootstrap->invoke( $this->admin_assets, $post_id );

		$this->assertSame( array( 'enabled' => true, 'pngConversionEnabled' => true, 'strings' => $bootstrap['wechatExport']['strings'] ), $bootstrap['wechatExport'] );
	}

	public function test_new_post_bootstrap_exposes_a_media_picker_frame_without_a_post_id() {
		$user_id       = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$previous_get  = $_GET;
		$previous_page = array_key_exists( 'pagenow', $GLOBALS ) ? $GLOBALS['pagenow'] : null;
		$had_page      = array_key_exists( 'pagenow', $GLOBALS );

		try {
			wp_set_current_user( $user_id );
			$_GET              = array( 'post_type' => 'post' );
			$GLOBALS['pagenow'] = 'post-new.php';
			$bootstrap         = $this->get_editor_root_bootstrap->invoke( $this->admin_assets, 0, 'post', true );
		} finally {
			$_GET = $previous_get;
			if ( $had_page ) {
				$GLOBALS['pagenow'] = $previous_page;
			} else {
				unset( $GLOBALS['pagenow'] );
			}
		}

		$this->assertTrue( $bootstrap['mediaPicker']['canUseMedia'] );
		$this->assertSame( MediaPickerPage::get_url( 0, 'post' ), $bootstrap['mediaPicker']['frameUrl'] );
	}

	public function test_editor_upload_bootstrap_uses_fixed_markdown_behavior_and_effective_size_limit() {
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$post_id = self::factory()->post->create( array( 'post_author' => $user_id ) );
		wp_set_current_user( $user_id );
		$repository = new SettingsCenterRepository( new Options(), new ToolbarRegistry() );
		$settings = $repository->get_settings();
		$settings['images']['maxImageSizeMb'] = 8;
		$settings['images']['titleDisplay'] = 'filename';
		$this->assertIsArray( $repository->update_settings( $settings ) );
		$filter = static function () {
			return 3 * MB_IN_BYTES;
		};
		add_filter( 'upload_size_limit', $filter );

		try {
			$bootstrap = $this->get_editor_root_bootstrap->invoke( $this->admin_assets, $post_id );
		} finally {
			remove_filter( 'upload_size_limit', $filter );
		}

		$this->assertArrayNotHasKey( 'insertAfterUpload', $bootstrap['imageUpload'] );
		$this->assertSame( 3 * MB_IN_BYTES, $bootstrap['imageUpload']['maxBytes'] );
		$this->assertSame( 'Supports WebP, PNG, JPG, JPEG, JFIF, and GIF, max 3 MB', $bootstrap['strings']['immersive']['imageRequirements'] );
		$this->assertSame( array( 'titleDisplay' => 'filename' ), $bootstrap['imageUpload']['insertion'] );
		$this->assertSame( array( 'titleDisplay' => 'filename' ), $bootstrap['mediaPicker']['insertion'] );
	}

	public function test_editor_root_bootstrap_intersects_image_formats_with_wordpress_policy() {
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$post_id = self::factory()->post->create( array( 'post_author' => $user_id ) );
		wp_set_current_user( $user_id );
		$remove_webp = static function ( $mime_types ) {
			unset( $mime_types['webp'] );
			return $mime_types;
		};
		add_filter( 'upload_mimes', $remove_webp );

		try {
			$bootstrap = $this->get_editor_root_bootstrap->invoke( $this->admin_assets, $post_id );
			$this->assertNotContains( 'image/webp', $bootstrap['imageUpload']['allowedMimeTypes'] );
			$this->assertContains( 'image/png', $bootstrap['imageUpload']['allowedMimeTypes'] );
		} finally {
			remove_filter( 'upload_mimes', $remove_webp );
		}
	}

	public function test_editor_root_bootstrap_routes_remote_uploads_through_the_protected_wordpress_proxy() {
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$post_id = self::factory()->post->create( array( 'post_author' => $user_id ) );
		wp_set_current_user( $user_id );
		$this->enable_image_hosting();
		$bootstrap = $this->get_editor_root_bootstrap->invoke( $this->admin_assets, $post_id );

		$this->assertArrayNotHasKey( 'destination', $bootstrap['imageUpload'] );
		$this->assertSame(
			rest_url( 'easymde/v1/image-hosting/upload' ),
			$bootstrap['imageUpload']['endpoint']
		);
		$this->assertSame(
			rest_url( 'easymde/v1/image-hosting/import' ),
			$bootstrap['imageUpload']['importEndpoint']
		);
		$this->assertSame( 'both', $bootstrap['imageUpload']['remoteImageUploadMode'] );
		$this->assertNotEmpty( $bootstrap['imageUpload']['actionNonce'] );
		$this->assertArrayNotHasKey( 'credentials', $bootstrap['imageUpload'] );
		$this->assertArrayNotHasKey( 'providerEndpoint', $bootstrap['imageUpload'] );
	}

	public function test_editor_root_bootstrap_projects_the_saved_image_upload_owner_and_effective_remote_mode() {
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$post_id = self::factory()->post->create( array( 'post_author' => $user_id ) );
		wp_set_current_user( $user_id );

		$bootstrap = $this->get_editor_root_bootstrap->invoke( $this->admin_assets, $post_id );
		$this->assertSame( 'media', $bootstrap['imageUpload']['uploadOwner'] );
		$this->assertSame( rest_url( 'easymde/v1/media' ), $bootstrap['imageUpload']['endpoint'] );
		$this->assertSame( 'off', $bootstrap['imageUpload']['remoteImageUploadMode'] );
		$this->assertTrue( $bootstrap['imageUpload']['enabled'] );

		$repository = new SettingsCenterRepository( new Options(), new ToolbarRegistry() );
		$settings = $repository->get_settings();
		$settings['images']['imageHostingEnabled'] = true;
		$this->assertIsArray( $repository->update_settings( $settings ) );

		$bootstrap = $this->get_editor_root_bootstrap->invoke( $this->admin_assets, $post_id );
		$this->assertSame( 'image-hosting', $bootstrap['imageUpload']['uploadOwner'] );
		$this->assertSame( rest_url( 'easymde/v1/image-hosting/upload' ), $bootstrap['imageUpload']['endpoint'] );
		$this->assertSame( 'both', $bootstrap['imageUpload']['remoteImageUploadMode'] );
		$this->assertTrue( $bootstrap['imageUpload']['enabled'] );
	}

	private function enable_image_hosting() {
		$repository = new SettingsCenterRepository( new Options(), new ToolbarRegistry() );
		$settings   = $repository->get_settings();
		$settings['images']['imageHostingEnabled'] = true;

		$this->assertIsArray( $repository->update_settings( $settings ) );
	}

	public function test_editor_root_bootstrap_consumes_saved_settings_center_shortcuts() {
		update_option(
			Options::EDITOR_SETTINGS,
			array(),
			false
		);
		$repository = new SettingsCenterRepository( new Options(), new ToolbarRegistry() );
		$settings   = $repository->get_settings();
		$settings['shortcuts']['values']['bold']['windows'] = 'Ctrl+Alt+B';
		$settings['shortcuts']['values']['heading-one']['windows'] = 'Ctrl+Alt+1';
		$settings['shortcuts']['values']['heading-two']['windows'] = '';
		$settings['images']['autoUploadPastedImages']         = false;
		$this->assertNotWPError( $repository->update_settings( $settings ) );

		$bootstrap = $this->get_editor_root_bootstrap->invoke( $this->admin_assets, 0, 'post' );

		$this->assertSame( 'Ctrl+Alt+B', $bootstrap['toolbar']['shortcuts']['bold']['win'] );
		$this->assertSame( 'Ctrl+Alt+1', $bootstrap['toolbar']['shortcuts']['heading1']['win'] );
		$this->assertSame( '', $bootstrap['toolbar']['shortcuts']['heading2']['win'] );
		$this->assertArrayNotHasKey( 'showShortcutHints', $bootstrap['toolbar'] );
		$this->assertFalse( $bootstrap['imageUpload']['autoUploadPastedImages'] );
		$this->assertSame(
			'Pasted image upload is disabled. Use Insert Image to upload a file.',
			$bootstrap['imageUpload']['strings']['pasteUploadDisabled']
		);
		$this->assertSame(
			'Checking pasted image...',
			$bootstrap['imageUpload']['strings']['pasteChecking']
		);
		$this->assertSame(
			'Pasted image already uses the current image host.',
			$bootstrap['imageUpload']['strings']['pasteAlreadyHosted']
		);
		$this->assertArrayNotHasKey( 'shortcuts', get_option( Options::EDITOR_SETTINGS ) );
	}

	public function test_editor_status_uses_the_last_editor_and_localized_modified_time() {
		$author_id = self::factory()->user->create(
			array(
				'display_name' => 'Synthetic Author',
				'role'         => 'administrator',
			)
		);
		$editor_id = self::factory()->user->create(
			array(
				'display_name' => 'Synthetic Editor',
				'role'         => 'editor',
			)
		);
		$post_id   = self::factory()->post->create(
			array(
				'post_author'   => $author_id,
				'post_modified' => '2026-07-14 15:53:00',
			)
		);
		update_post_meta( $post_id, '_edit_last', $editor_id );
		wp_set_current_user( $editor_id );

		$bootstrap = $this->get_editor_root_bootstrap->invoke( $this->admin_assets, $post_id );
		$modified  = get_post_modified_time(
			get_option( 'date_format' ) . ' ' . get_option( 'time_format' ),
			false,
			get_post( $post_id ),
			true
		);

		$this->assertSame(
			'Last edited by Synthetic Editor on ' . $modified,
			$bootstrap['layout']['status']['lastEdited']
		);
	}

	public function test_editor_status_omits_the_editor_when_the_last_editor_no_longer_exists() {
		$author_id = self::factory()->user->create(
			array(
				'display_name' => 'Synthetic Author',
				'role'         => 'administrator',
			)
		);
		$post_id   = self::factory()->post->create( array( 'post_author' => $author_id ) );
		update_post_meta( $post_id, '_edit_last', 999999 );
		wp_set_current_user( $author_id );

		$bootstrap = $this->get_editor_root_bootstrap->invoke( $this->admin_assets, $post_id );

		$modified = get_post_modified_time(
			get_option( 'date_format' ) . ' ' . get_option( 'time_format' ),
			false,
			get_post( $post_id ),
			true
		);

		$this->assertSame(
			'Last edited on ' . $modified,
			$bootstrap['layout']['status']['lastEdited']
		);
	}

	public function test_new_post_status_reports_that_it_has_not_been_saved() {
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $user_id );

		$bootstrap = $this->get_editor_root_bootstrap->invoke( $this->admin_assets, 0, 'post' );

		$this->assertSame( 'Not saved yet.', $bootstrap['layout']['status']['lastEdited'] );
		$this->assertTrue( $bootstrap['wordpress']['isNewPost'] );
	}

	public function test_auto_draft_bootstrap_is_marked_as_a_new_post_even_with_a_nonzero_id() {
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$post_id = self::factory()->post->create(
			array(
				'post_author' => $user_id,
				'post_status' => 'auto-draft',
			)
		);
		wp_set_current_user( $user_id );

		$bootstrap = $this->get_editor_root_bootstrap->invoke( $this->admin_assets, $post_id, 'post' );

		$this->assertTrue( $bootstrap['wordpress']['isNewPost'] );
	}

	public function test_new_post_bootstrap_exposes_the_post_category_tree_without_a_post_id() {
		$user_id   = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$parent_id = self::factory()->category->create( array( 'name' => 'Parent category' ) );
		$child_id  = self::factory()->category->create(
			array(
				'name'   => 'Child category',
				'parent' => $parent_id,
			)
		);
		wp_set_current_user( $user_id );

		$bootstrap = $this->get_editor_root_bootstrap->invoke( $this->admin_assets, 0, 'post' );
		$categories = $bootstrap['wordpress']['publishCategories'];
		$parent = null;

		foreach ( $categories as $category ) {
			if ( (string) $parent_id === $category['id'] ) {
				$parent = $category;
				break;
			}
		}

		$this->assertNotNull( $parent );
		$this->assertSame( 'Parent category', $parent['label'] );
		$this->assertSame( (string) $child_id, $parent['children'][0]['id'] );
		$this->assertSame( 'Child category', $parent['children'][0]['label'] );
	}

	public function test_publish_categories_are_hidden_without_the_taxonomy_assignment_capability() {
		$user_id = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		self::factory()->category->create( array( 'name' => 'Unavailable category' ) );
		wp_set_current_user( $user_id );

		$bootstrap = $this->get_editor_root_bootstrap->invoke( $this->admin_assets, 0, 'post' );

		$this->assertSame( array(), $bootstrap['wordpress']['publishCategories'] );
	}

	public function test_publish_category_tree_is_bounded_to_the_client_schema_depth() {
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$parent_id = 0;
		$category_ids = array();
		for ( $index = 0; $index < 34; $index++ ) {
			$parent_id = self::factory()->category->create(
				array(
					'name'   => 'Depth ' . $index,
					'parent' => $parent_id,
				)
			);
			$category_ids[] = $parent_id;
		}
		wp_set_current_user( $user_id );

		$bootstrap = $this->get_editor_root_bootstrap->invoke( $this->admin_assets, 0, 'post' );
		$categories = $bootstrap['wordpress']['publishCategories'];
		$branch = null;
		foreach ( $categories as $category ) {
			if ( (string) $category_ids[0] === $category['id'] ) {
				$branch = $category;
				break;
			}
		}

		$this->assertNotNull( $branch );
		$emitted_ids = array();
		while ( null !== $branch ) {
			$emitted_ids[] = $branch['id'];
			$branch = $branch['children'][0] ?? null;
		}

		$this->assertCount( 32, $emitted_ids );
		$this->assertSame( array_map( 'strval', array_slice( $category_ids, 0, 32 ) ), $emitted_ids );
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

	public function test_context_menu_code_indentation_labels_are_gettext_backed_and_nested() {
		$strings  = $this->get_strings->invoke( $this->admin_assets );
		$bootstrap = $this->get_editor_root_bootstrap->invoke( $this->admin_assets, 0 );

		$this->assertSame( 'Adjust Code Block Indentation', $strings['contextMenuIndentCodeBlock'] );
		$this->assertSame( 'Adjust Selected Code Indentation', $strings['contextMenuIndentSelectedCode'] );
		$this->assertSame( 'Adjust Code Block Indentation', $bootstrap['strings']['contextMenu']['indentCodeBlock'] );
		$this->assertSame( 'Adjust Selected Code Indentation', $bootstrap['strings']['contextMenu']['indentSelectedCode'] );
	}

	public function test_custom_css_variable_categories_match_the_reference_tab_panels() {
		$variables = $this->get_custom_css_variables->invoke( $this->admin_assets );
		$groups    = array();

		foreach ( $variables as $variable ) {
			$groups[ $variable['category'] ][] = $variable['id'];
		}

		$this->assertSame(
			array(
				'foundation' => array(
					'primaryColor',
					'headingColor',
					'textColor',
					'mutedColor',
					'linkColor',
					'backgroundColor',
					'borderColor',
				),
				'blocks'     => array(
					'emphasisBackground',
					'selectionBackground',
					'quoteColor',
					'quoteBackground',
					'tableHeaderBackground',
					'tableStripeBackground',
				),
				'code'       => array(
					'inlineCodeColor',
					'inlineCodeBackground',
					'codeBlockTextColor',
					'codeBlockBackground',
					'codeKeywordColor',
					'codeStringColor',
					'codeCommentColor',
				),
				'alerts'     => array(
					'infoColor',
					'infoBackground',
					'successColor',
					'successBackground',
					'warningColor',
					'warningBackground',
					'dangerColor',
					'dangerBackground',
				),
			),
			$groups
		);
	}

	public function test_custom_css_dialog_strings_lock_the_bootstrap_contract() {
		$strings       = $this->get_custom_css_dialog_strings->invoke( $this->admin_assets );
		$expected_keys = array(
			'description',
			'close',
			'closeTitle',
			'articleThemeName',
			'codeThemeName',
			'articleNamePlaceholder',
			'codeNamePlaceholder',
			'unsavedChanges',
			'invalidColor',
			'missingName',
			'previewTitle',
			'livePreview',
			'previewHelp',
			'previewInvalid',
			'previewUnavailable',
			'themeVariables',
			'themeVariableCategories',
			'themeVariablePanelLabel',
			'customCssCodeTitle',
			'reset',
			'expandCode',
			'shrinkCode',
			'backToVariables',
			'saveTarget',
			'articleCss',
			'codeCss',
			'articleCssHelp',
			'codeCssHelp',
			'foundationCategory',
			'blocksCategory',
			'codeCategory',
			'alertsCategory',
			'customCssCode',
			'customCssCodeHelp',
			'backToThemeVariables',
			'cancel',
			'resetAll',
			'applyCustomTheme',
			'defaultArticleName',
			'defaultCodeName',
			'colorPickerLabel',
			'currentThemeVariablesComment',
			'addCustomRulesComment',
			'previewHeadingOne',
			'previewHeadingTwo',
			'previewBodyText',
			'previewParagraph',
			'previewBoldText',
			'previewItalicText',
			'previewDeletedText',
			'previewHighlight',
			'previewInlineCode',
			'previewCodeComment',
			'previewBlockquote',
			'previewUnorderedItem',
			'previewCompletedTask',
			'previewOrderedItem',
			'previewSecondStep',
			'previewTableHeader',
			'previewTableContent',
			'previewLink',
			'previewNoteLabel',
			'previewTipLabel',
			'previewWarningLabel',
			'previewCautionLabel',
			'previewInformation',
			'previewSuccess',
			'previewWarning',
			'previewDanger',
			'previewDetails',
			'previewDetailsContent',
			'previewDefinitionTerm',
			'previewDefinitionDescription',
			'previewSupplementalHeading',
			'previewSupplementalText',
			'previewFootnote',
			'previewInlineSeparator',
			'previewInlineConjunction',
			'previewSentenceEnd',
		);
		$actual_keys   = array_keys( $strings );

		sort( $expected_keys );
		sort( $actual_keys );

		$this->assertSame( $expected_keys, $actual_keys );

		foreach ( $strings as $key => $value ) {
			$this->assertIsString( $value, $key );
			$this->assertNotSame( '', trim( $value ), $key );
			$this->assertLessThanOrEqual( 512, strlen( $value ), $key );
		}
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
		$this->assertSame( array( 'wp-api-fetch', 'wp-element', 'wp-hooks', 'wp-i18n' ), $asset['dependencies'] );
		$this->assertMatchesRegularExpression( '/^[a-f0-9]{16}$/', $asset['version'] );
		$this->assertFileExists( Asset::path( $asset['path'] ) );
	}

	public function test_resolves_the_committed_head_loader_manifest_and_dependency_metadata() {
		$asset = $this->get_react_editor_loader_asset->invoke( $this->admin_assets );

		$this->assertSame( 'easymde-admin-editor-toolbar', $asset['handle'] );
		$this->assertMatchesRegularExpression( '#^assets/build/admin-editor-loader/assets/admin-editor-loader-[A-Za-z0-9_-]+\.js$#', $asset['path'] );
		$this->assertSame( array( 'wp-api-fetch', 'wp-element', 'wp-hooks', 'wp-i18n' ), $asset['dependencies'] );
		$this->assertMatchesRegularExpression( '/^[a-f0-9]{16}$/', $asset['version'] );
		$this->assertFileExists( Asset::path( $asset['path'] ) );
	}

	public function test_react_editor_does_not_queue_wordpress_media_dependencies() {
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$post_id = self::factory()->post->create( array( 'post_author' => $user_id ) );
		$previous_get = $_GET;
		$previous_screen = array_key_exists( 'current_screen', $GLOBALS ) ? $GLOBALS['current_screen'] : null;
		$had_screen = array_key_exists( 'current_screen', $GLOBALS );

		try {
			wp_dequeue_script( 'easymde-admin-editor-toolbar' );
			wp_dequeue_script( 'media-editor' );
			wp_set_current_user( $user_id );
			$_GET = array( 'post' => (string) $post_id );
			$GLOBALS['pagenow'] = 'post.php';
			set_current_screen( 'post' );
			$this->admin_assets->enqueue_admin_assets( 'post.php' );

			$queue = wp_scripts()->queue;
			$editor_index = array_search( 'easymde-admin-editor-toolbar', $queue, true );

			$this->assertNotFalse( $editor_index );
			$this->assertStringContainsString( 'admin-editor-loader', wp_scripts()->registered['easymde-admin-editor-toolbar']->src );
			$this->assertFalse( wp_scripts()->get_data( 'easymde-admin-editor-toolbar', 'group' ) );
			$this->assertFalse( wp_script_is( 'media-editor', 'enqueued' ) );
		} finally {
			$_GET = $previous_get;
			if ( $had_screen ) {
				$GLOBALS['current_screen'] = $previous_screen;
			} else {
				unset( $GLOBALS['current_screen'] );
			}
		}
	}

	public function test_react_editor_head_loader_bootstrap_points_to_the_verified_main_bundle() {
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$post_id = self::factory()->post->create( array( 'post_author' => $user_id ) );
		$previous_get = $_GET;
		$previous_screen = array_key_exists( 'current_screen', $GLOBALS ) ? $GLOBALS['current_screen'] : null;
		$had_screen = array_key_exists( 'current_screen', $GLOBALS );

		try {
			wp_dequeue_script( 'easymde-admin-editor-toolbar' );
			wp_set_current_user( $user_id );
			$_GET = array( 'post' => (string) $post_id );
			$GLOBALS['pagenow'] = 'post.php';
			set_current_screen( 'post' );
			$this->admin_assets->enqueue_admin_assets( 'post.php' );

			$before = wp_scripts()->get_data( 'easymde-admin-editor-toolbar', 'before' );
			$inline = is_array( $before ) ? implode( "\n", $before ) : (string) $before;
			$decoded_inline = str_replace( '\\/', '/', $inline );

			$this->assertStringContainsString( 'EasyMDEAdminEditorLoaderBootstrap', $inline );
			$this->assertMatchesRegularExpression( '#assets/build/assets/admin-editor-[A-Za-z0-9_-]+\.js#', $decoded_inline );
			$this->assertStringNotContainsString( 'wp_enqueue_media', $inline );

			$this->assertSame(
				0,
				has_action( 'admin_print_styles-post.php', array( $this->admin_assets, 'render_react_editor_preload' ) )
			);
			$this->assertFalse( has_action( 'admin_print_scripts-post.php', array( $this->admin_assets, 'render_react_editor_preload' ) ) );
			ob_start();
			$this->admin_assets->render_react_editor_preload();
			$preload = ob_get_clean();
			$this->assertMatchesRegularExpression( '#^<link rel="preload" as="script" fetchpriority="high" href="http://example\.org/.*/assets/build/assets/admin-editor-[A-Za-z0-9_-]+\.js">\n$#', $preload );
			$this->assertSame( 1, substr_count( $preload, 'rel="preload"' ) );

			ob_start();
			$this->admin_assets->render_react_editor_preload();
			$this->assertSame( '', ob_get_clean() );
		} finally {
			$_GET = $previous_get;
			if ( $had_screen ) {
				$GLOBALS['current_screen'] = $previous_screen;
			} else {
				unset( $GLOBALS['current_screen'] );
			}
		}
	}

	public function test_react_editor_registers_a_priority_zero_early_loader_print_hook() {
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$post_id = self::factory()->post->create( array( 'post_author' => $user_id ) );
		$previous_get = $_GET;
		$previous_screen = array_key_exists( 'current_screen', $GLOBALS ) ? $GLOBALS['current_screen'] : null;
		$had_screen = array_key_exists( 'current_screen', $GLOBALS );

		try {
			wp_dequeue_script( 'easymde-admin-editor-toolbar' );
			wp_set_current_user( $user_id );
			$_GET = array( 'post' => (string) $post_id );
			$GLOBALS['pagenow'] = 'post.php';
			set_current_screen( 'post' );
			$this->admin_assets->enqueue_admin_assets( 'post.php' );

			$this->assertSame(
				0,
				has_action( 'admin_print_scripts-post.php', array( $this->admin_assets, 'render_react_editor_loader' ) )
			);
		} finally {
			$_GET = $previous_get;
			if ( $had_screen ) {
				$GLOBALS['current_screen'] = $previous_screen;
			} else {
				unset( $GLOBALS['current_screen'] );
			}
		}
	}

	public function test_react_editor_loader_prints_once_and_generic_print_does_not_repeat_it() {
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$post_id = self::factory()->post->create( array( 'post_author' => $user_id ) );
		$previous_get = $_GET;
		$previous_screen = array_key_exists( 'current_screen', $GLOBALS ) ? $GLOBALS['current_screen'] : null;
		$had_screen = array_key_exists( 'current_screen', $GLOBALS );

		try {
			wp_dequeue_script( 'easymde-admin-editor-toolbar' );
			wp_set_current_user( $user_id );
			$_GET = array( 'post' => (string) $post_id );
			$GLOBALS['pagenow'] = 'post.php';
			set_current_screen( 'post' );
			$this->admin_assets->enqueue_admin_assets( 'post.php' );
			$script_url = wp_scripts()->registered['easymde-admin-editor-toolbar']->src;
			$script_file = basename( (string) wp_parse_url( $script_url, PHP_URL_PATH ) );

			ob_start();
			do_action( 'admin_print_scripts-post.php' );
			$early = ob_get_clean();

			$this->assertStringContainsString( 'EasyMDEAdminEditorLoaderBootstrap', $early );
			$this->assertSame( 1, substr_count( $early, $script_file ) );
			$this->assertFalse( has_action( 'admin_print_scripts-post.php', array( $this->admin_assets, 'render_react_editor_loader' ) ) );

			ob_start();
			do_action( 'admin_print_scripts-post.php' );
			$this->assertSame( 0, substr_count( ob_get_clean(), $script_file ) );

			ob_start();
			wp_print_scripts();
			$generic = ob_get_clean();
			$this->assertSame( 0, substr_count( $generic, $script_file ) );
		} finally {
			$_GET = $previous_get;
			if ( $had_screen ) {
				$GLOBALS['current_screen'] = $previous_screen;
			} else {
				unset( $GLOBALS['current_screen'] );
			}
		}
	}

	public function test_react_editor_registers_its_handle_based_translation_catalog() {
		$enqueue_react_editor_asset = new ReflectionMethod( AdminAssets::class, 'enqueue_react_editor_asset' );
		$enqueue_react_editor_asset->setAccessible( true );

		$result = $enqueue_react_editor_asset->invoke( $this->admin_assets );
		$this->assertIsArray( $result );
		$this->assertArrayHasKey( 'loader', $result );
		$this->assertArrayHasKey( 'main', $result );

		$script = wp_scripts()->registered['easymde-admin-editor-toolbar'];
		$this->assertSame( 'easymde', $script->textdomain );
		$this->assertSame( Asset::path( 'languages' ), $script->translations_path );
	}

	public function test_rejects_react_editor_bundle_bytes_that_do_not_match_dependency_metadata() {
		$build_dir = trailingslashit( get_temp_dir() ) . 'easymde-react-editor-integrity-' . wp_generate_uuid4();
		$file      = 'assets/admin-editor-synthetic.js';
		$asset     = 'assets/admin-editor-synthetic.asset.php';
		wp_mkdir_p( $build_dir . '/assets' );
		file_put_contents( $build_dir . '/' . $file, 'console.log("corrupted");' );
		file_put_contents(
			$build_dir . '/' . $asset,
			"<?php\nreturn array(\n\t'dependencies' => array( 'wp-api-fetch', 'wp-element', 'wp-hooks', 'wp-i18n' ),\n\t'version' => '0000000000000000',\n);\n"
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
							'dependencies' => array( 'wp-api-fetch', 'wp-element', 'wp-hooks', 'wp-i18n' ),
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

	public function test_absent_editor_block_index_worker_keeps_the_editor_loader_stopped_and_writes_nothing() {
		$worker_build_dir = trailingslashit( get_temp_dir() ) . 'easymde-worker-absent-' . wp_generate_uuid4() . '/';
		$this->assertFalse( file_exists( $worker_build_dir ), 'The absent-build case must not read committed assets.' );

		$observed = $this->enqueue_admin_assets_against_worker_build_dir( $worker_build_dir );

		$this->assert_worker_failure_is_nonfatal( $observed, 'editor-block-index-worker-manifest-invalid' );
	}

	public function test_tampered_editor_block_index_worker_keeps_the_editor_loader_stopped_and_writes_nothing() {
		$worker_build_dir = trailingslashit( get_temp_dir() ) . 'easymde-worker-tampered-' . wp_generate_uuid4();
		$file             = 'assets/editor-block-index-worker-synthetic.js';
		$asset            = 'assets/editor-block-index-worker-synthetic.asset.php';
		wp_mkdir_p( $worker_build_dir . '/assets' );
		file_put_contents( $worker_build_dir . '/' . $file, 'console.log("tampered");' );
		file_put_contents(
			$worker_build_dir . '/' . $asset,
			"<?php\nreturn array(\n\t'dependencies' => array(),\n\t'version' => '0000000000000000',\n);\n"
		);
		file_put_contents(
			$worker_build_dir . '/wordpress-manifest.json',
			wp_json_encode(
				array(
					'schemaVersion' => 1,
					'entries'       => array(
						'frontend/src/entrypoints/editor-block-index-worker.ts' => array(
							'handle'       => 'easymde-editor-block-index-worker',
							'file'         => $file,
							'asset'        => $asset,
							'dependencies' => array(),
							'resources'    => array(),
						),
					),
				)
			)
		);

		try {
			$observed = $this->enqueue_admin_assets_against_worker_build_dir( $worker_build_dir );
		} finally {
			wp_delete_file( $worker_build_dir . '/' . $file );
			wp_delete_file( $worker_build_dir . '/' . $asset );
			wp_delete_file( $worker_build_dir . '/wordpress-manifest.json' );
			rmdir( $worker_build_dir . '/assets' );
			rmdir( $worker_build_dir );
		}

		$this->assert_worker_failure_is_nonfatal( $observed, 'editor-block-index-worker-build-integrity-invalid' );
	}

	private function assert_worker_failure_is_nonfatal( array $observed, $expected_code ) {
		$this->assertSame( $expected_code, $observed['contract_code'] );
		$this->assertFalse( $observed['loader_enqueued'] );
		$this->assertFalse( $observed['loader_hook_registered'] );
		$this->assertFalse( $observed['preload_hook_registered'] );
		$this->assertFalse( $observed['bootstrap_inline'] );
		$this->assertStringContainsString( 'notice notice-error', $observed['notice'] );
		$this->assertStringContainsString( 'EasyMDE could not load the editor application.', $observed['notice'] );
		$this->assertSame( array(), $observed['article_writes'] );
		$this->assertSame( $observed['post_before'], $observed['post_after'] );
		$this->assertSame( $observed['published_count_before'], $observed['published_count_after'] );

		if ( '' !== $observed['contract_warning'] ) {
			$this->assertStringContainsString( '(' . $expected_code . ')', $observed['contract_warning'] );
		}
	}

	public function test_editor_block_index_worker_codes_are_classified_without_broad_throwable_handling() {
		$manifest_error  = new RuntimeException( 'editor-block-index-worker-manifest-invalid' );
		$integrity_error = new RuntimeException( 'editor-block-index-worker-build-integrity-invalid' );
		$unrelated_error = new RuntimeException( 'editor-block-index-worker' );

		$this->assertTrue( FrontendAssetContract::is_error( $manifest_error ) );
		$this->assertSame( 'editor-block-index-worker-manifest-invalid', FrontendAssetContract::error_code( $manifest_error ) );
		$this->assertFalse( FrontendAssetContract::is_code_copy_error( $manifest_error ) );
		$this->assertTrue( FrontendAssetContract::is_error( $integrity_error ) );
		$this->assertSame( 'editor-block-index-worker-build-integrity-invalid', FrontendAssetContract::error_code( $integrity_error ) );
		$this->assertFalse( FrontendAssetContract::is_error( $unrelated_error ) );
		$this->assertSame( 'frontend-asset-contract-invalid', FrontendAssetContract::error_code( $unrelated_error ) );
	}

	private function enqueue_admin_assets_against_worker_build_dir( $worker_build_dir ) {
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$post_id = self::factory()->post->create(
			array(
				'post_author'    => $user_id,
				'post_content'   => '<!-- wp:paragraph --><p>Native content</p><!-- /wp:paragraph -->',
				'post_title'     => 'Native title',
				'post_status'    => 'draft',
			)
		);
		update_post_meta( $post_id, PostDocument::META_MARKDOWN, 'Native markdown stays untouched.' );

		$admin_assets  = $this->admin_assets_using_worker_build_dir( $worker_build_dir );
		$contract_code = $this->worker_contract_code( $worker_build_dir );
		$post_before   = $this->article_snapshot( $post_id );
		$count_before  = $this->article_count();

		$article_writes = array();
		$record_write   = static function ( $meta_id, $object_id, $meta_key ) use ( &$article_writes, $post_id ) {
			unset( $meta_id, $meta_key );
			if ( (int) $object_id === $post_id ) {
				$article_writes[] = current_filter();
			}
		};
		$record_post_write = static function ( $saved_post_id ) use ( &$article_writes, $post_id ) {
			if ( (int) $saved_post_id === $post_id ) {
				$article_writes[] = current_filter();
			}
		};

		$warnings         = array();
		$previous_get     = $_GET;
		$previous_pagenow = array_key_exists( 'pagenow', $GLOBALS ) ? $GLOBALS['pagenow'] : null;
		$had_pagenow      = array_key_exists( 'pagenow', $GLOBALS );
		$previous_screen  = array_key_exists( 'current_screen', $GLOBALS ) ? $GLOBALS['current_screen'] : null;
		$had_screen       = array_key_exists( 'current_screen', $GLOBALS );
		$emoji_priority   = has_action( 'admin_print_scripts', 'print_emoji_detection_script' );

		add_action( 'added_post_meta', $record_write, 10, 3 );
		add_action( 'updated_post_meta', $record_write, 10, 3 );
		add_action( 'deleted_post_meta', $record_write, 10, 3 );
		add_action( 'save_post', $record_post_write, 10, 1 );
		add_action( 'edit_post', $record_post_write, 10, 1 );
		// Isolate the queue from earlier editor cases without touching committed assets.
		wp_dequeue_script( 'easymde-admin-editor-toolbar' );
		$loader_handle = 'easymde-admin-editor-toolbar';
		$inline_before = wp_scripts()->get_data( $loader_handle, 'before' );
		set_error_handler(
			static function ( $level, $message ) use ( &$warnings ) {
				unset( $level );
				$warnings[] = (string) $message;

				return true;
			},
			E_USER_WARNING
		);

		try {
			wp_set_current_user( $user_id );
			$_GET               = array( 'post' => (string) $post_id );
			$GLOBALS['pagenow'] = 'post.php';
			set_current_screen( 'post' );

			$admin_assets->enqueue_admin_assets( 'post.php' );

			$inline_after = wp_scripts()->get_data( $loader_handle, 'before' );
			$observed     = array(
				'contract_code'           => $contract_code,
				'loader_enqueued'         => wp_script_is( $loader_handle, 'enqueued' ),
				'loader_hook_registered'  => false !== has_action( 'admin_print_scripts-post.php', array( $admin_assets, 'render_react_editor_loader' ) ),
				'preload_hook_registered' => false !== has_action( 'admin_print_styles-post.php', array( $admin_assets, 'render_react_editor_preload' ) ),
				'bootstrap_inline'        => $inline_before !== $inline_after,
			);
			ob_start();
			$admin_assets->render_react_editor_asset_notice();
			$observed['notice'] = ob_get_clean();
		} finally {
			restore_error_handler();
			remove_action( 'added_post_meta', $record_write, 10 );
			remove_action( 'updated_post_meta', $record_write, 10 );
			remove_action( 'deleted_post_meta', $record_write, 10 );
			remove_action( 'save_post', $record_post_write, 10 );
			remove_action( 'edit_post', $record_post_write, 10 );
			if ( false !== $emoji_priority && false === has_action( 'admin_print_scripts', 'print_emoji_detection_script' ) ) {
				add_action( 'admin_print_scripts', 'print_emoji_detection_script', $emoji_priority );
			}
			$_GET = $previous_get;
			if ( $had_pagenow ) {
				$GLOBALS['pagenow'] = $previous_pagenow;
			} else {
				unset( $GLOBALS['pagenow'] );
			}
			if ( $had_screen ) {
				$GLOBALS['current_screen'] = $previous_screen;
			} else {
				unset( $GLOBALS['current_screen'] );
			}
		}

		// wp_trigger_error() is a no-op unless the WordPress test config enables WP_DEBUG.
		if ( defined( 'WP_DEBUG' ) && WP_DEBUG ) {
			$contract_warnings = array_values(
				array_filter(
					$warnings,
					static function ( $warning ) use ( $contract_code ) {
						return false !== strpos( $warning, '(' . $contract_code . ')' );
					}
				)
			);

			$this->assertCount( 1, $contract_warnings );
			$observed['contract_warning'] = $contract_warnings[0];
		} else {
			$observed['contract_warning'] = '';
		}

		$observed['article_writes']         = $article_writes;
		$observed['post_before']            = $post_before;
		$observed['post_after']             = $this->article_snapshot( $post_id );
		$observed['published_count_before'] = $count_before;
		$observed['published_count_after']  = $this->article_count();

		return $observed;
	}

	private function worker_contract_code( $worker_build_dir ) {
		$post_document          = new PostDocument();
		$theme_state_repository = new ThemeStateRepository( new ArticleThemeRegistry(), new CodeThemeRegistry(), new CustomCssPolicy() );
		$frontend_assets        = new FrontendAssets(
			$post_document,
			$theme_state_repository,
			null,
			null,
			$worker_build_dir
		);

		try {
			$frontend_assets->get_editor_block_index_worker_url();
		} catch ( RuntimeException $error ) {
			$this->assertTrue( FrontendAssetContract::is_error( $error ) );

			return FrontendAssetContract::error_code( $error );
		}

		$this->fail( 'The worker build must not resolve for this negative case.' );
	}

	private function admin_assets_using_worker_build_dir( $worker_build_dir ) {
		$post_document          = new PostDocument();
		$theme_state_repository = new ThemeStateRepository( new ArticleThemeRegistry(), new CodeThemeRegistry(), new CustomCssPolicy() );
		$toolbar_registry       = new ToolbarRegistry();
		$settings_repository    = new SettingsCenterRepository( new Options(), $toolbar_registry );

		return new AdminAssets(
			new PostModeController( $post_document ),
			new FrontendAssets(
				$post_document,
				$theme_state_repository,
				null,
				$settings_repository,
				$worker_build_dir
			),
			$theme_state_repository,
			$toolbar_registry,
			$settings_repository
		);
	}

	private function article_snapshot( $post_id ) {
		$post = get_post( $post_id );

		return array(
			'post_content'  => $post->post_content,
			'post_title'    => $post->post_title,
			'post_status'   => $post->post_status,
			'post_modified' => $post->post_modified_gmt,
			'meta'          => get_post_meta( $post_id ),
		);
	}

	private function article_count() {
		global $wpdb;

		return (int) $wpdb->get_var(
			$wpdb->prepare( "SELECT COUNT(*) FROM {$wpdb->posts} WHERE post_type = %s", 'post' )
		);
	}

	public function test_admitted_existing_post_editor_removes_core_emoji_detection_script() {
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$post_id = self::factory()->post->create( array( 'post_author' => $user_id ) );

		$remaining = $this->enqueue_admin_assets_with_emoji_action(
			'post.php',
			function () use ( $user_id, $post_id ) {
				wp_set_current_user( $user_id );
				$_GET = array( 'post' => (string) $post_id );
				$GLOBALS['pagenow'] = 'post.php';
				set_current_screen( 'post' );
			}
		);

		$this->assertFalse( $remaining );
	}

	public function test_admitted_new_post_editor_removes_core_emoji_detection_script() {
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );

		$remaining = $this->enqueue_admin_assets_with_emoji_action(
			'post-new.php',
			function () use ( $user_id ) {
				wp_set_current_user( $user_id );
				$_GET = array( 'post_type' => 'post' );
				$GLOBALS['pagenow'] = 'post-new.php';
				set_current_screen( 'post' );
			}
		);

		$this->assertFalse( $remaining );
	}

	public function test_non_editor_hook_retains_core_emoji_detection_script() {
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$post_id = self::factory()->post->create( array( 'post_author' => $user_id ) );

		$remaining = $this->enqueue_admin_assets_with_emoji_action(
			'edit.php',
			function () use ( $user_id, $post_id ) {
				wp_set_current_user( $user_id );
				$_GET = array( 'post' => (string) $post_id );
				$GLOBALS['pagenow'] = 'edit.php';
				set_current_screen( 'post' );
			}
		);

		$this->assertNotFalse( $remaining );
	}

	public function test_missing_current_screen_retains_core_emoji_detection_script() {
		$user_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$post_id = self::factory()->post->create( array( 'post_author' => $user_id ) );

		$remaining = $this->enqueue_admin_assets_with_emoji_action(
			'post.php',
			function () use ( $user_id, $post_id ) {
				wp_set_current_user( $user_id );
				$_GET = array( 'post' => (string) $post_id );
				$GLOBALS['pagenow'] = 'post.php';
				$GLOBALS['current_screen'] = null;
			}
		);

		$this->assertNotFalse( $remaining );
	}

	public function test_should_load_editor_false_retains_core_emoji_detection_script() {
		$owner_id = self::factory()->user->create( array( 'role' => 'administrator' ) );
		$user_id  = self::factory()->user->create( array( 'role' => 'subscriber' ) );
		$post_id  = self::factory()->post->create( array( 'post_author' => $owner_id ) );

		$remaining = $this->enqueue_admin_assets_with_emoji_action(
			'post.php',
			function () use ( $user_id, $post_id ) {
				wp_set_current_user( $user_id );
				$_GET = array( 'post' => (string) $post_id );
				$GLOBALS['pagenow'] = 'post.php';
				set_current_screen( 'post' );
			}
		);

		$this->assertNotFalse( $remaining );
	}

	private function enqueue_admin_assets_with_emoji_action( $hook, $prepare ) {
		$this->assertTrue( function_exists( 'print_emoji_detection_script' ) );

		$previous_get            = $_GET;
		$previous_pagenow       = array_key_exists( 'pagenow', $GLOBALS ) ? $GLOBALS['pagenow'] : null;
		$had_pagenow            = array_key_exists( 'pagenow', $GLOBALS );
		$previous_screen        = array_key_exists( 'current_screen', $GLOBALS ) ? $GLOBALS['current_screen'] : null;
		$had_screen             = array_key_exists( 'current_screen', $GLOBALS );
		$previous_emoji_priority = has_action( 'admin_print_scripts', 'print_emoji_detection_script' );
		add_action( 'admin_print_scripts', 'print_emoji_detection_script' );

		try {
			$prepare();
			$this->assertNotFalse( has_action( 'admin_print_scripts', 'print_emoji_detection_script' ) );
			$this->admin_assets->enqueue_admin_assets( $hook );

			return has_action( 'admin_print_scripts', 'print_emoji_detection_script' );
		} finally {
			remove_action( 'admin_print_scripts', 'print_emoji_detection_script' );
			if ( false !== $previous_emoji_priority ) {
				add_action( 'admin_print_scripts', 'print_emoji_detection_script', $previous_emoji_priority );
			}

			$_GET = $previous_get;
			if ( $had_pagenow ) {
				$GLOBALS['pagenow'] = $previous_pagenow;
			} else {
				unset( $GLOBALS['pagenow'] );
			}
			if ( $had_screen ) {
				$GLOBALS['current_screen'] = $previous_screen;
			} else {
				unset( $GLOBALS['current_screen'] );
			}
		}
	}

	public function tear_down() {
		remove_all_actions( 'admin_enqueue_scripts' );
		remove_all_actions( 'admin_notices' );
		delete_option( Options::EDITOR_SETTINGS );
		wp_cache_flush();

		parent::tear_down();
	}

}
