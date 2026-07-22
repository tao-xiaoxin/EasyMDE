<?php

namespace EasyMDE\Admin;

use EasyMDE\Frontend\FrontendAssets;
use EasyMDE\Support\Asset;
use EasyMDE\Support\ToolbarRegistry;
use EasyMDE\Theme\ThemeStateRepository;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class AdminAssets {
	private $post_mode_controller;
	private $frontend_assets;
	private $theme_state_repository;
	private $toolbar_registry;
	private $settings_page;
	private $react_editor_asset_error = false;

	public function __construct(
		PostModeController $post_mode_controller,
		FrontendAssets $frontend_assets,
		ThemeStateRepository $theme_state_repository,
		ToolbarRegistry $toolbar_registry,
		SettingsPage $settings_page
	) {
		$this->post_mode_controller   = $post_mode_controller;
		$this->frontend_assets        = $frontend_assets;
		$this->theme_state_repository = $theme_state_repository;
		$this->toolbar_registry       = $toolbar_registry;
		$this->settings_page          = $settings_page;
	}

	public function register_hooks() {
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_admin_assets' ) );
		add_action( 'admin_notices', array( $this, 'render_react_editor_asset_notice' ) );
	}

	public function render_react_editor_asset_notice() {
		if ( ! $this->react_editor_asset_error ) {
			return;
		}

		echo '<div class="notice notice-error"><p>';
		esc_html_e( 'EasyMDE could not load the editor application. Reinstall EasyMDE or contact your site administrator.', 'easymde' );
		echo '</p></div>';
	}

	public function enqueue_admin_assets( $hook ) {
		if ( ! in_array( $hook, array( 'post.php', 'post-new.php' ), true ) ) {
			return;
		}

		$screen = get_current_screen();
		if ( ! $screen || ! $this->post_mode_controller->should_load_editor( $this->get_post_id(), $screen->post_type ) ) {
			return;
		}

		$post_id = $this->get_post_id();
		wp_enqueue_style( 'dashicons' );
		wp_enqueue_style(
			'easymde-admin-toolbar',
			Asset::url( 'assets/css/admin/toolbar.css' ),
			array(),
			$this->get_static_asset_version( 'assets/css/admin/toolbar.css' )
		);
		wp_enqueue_style(
			'easymde-admin-popover',
			Asset::url( 'assets/css/admin/popover.css' ),
			array( 'easymde-admin-toolbar' ),
			EASYMDE_VERSION
		);
		wp_enqueue_style(
			'easymde-admin',
			Asset::url( 'assets/css/admin/editor.css' ),
			array( 'easymde-admin-toolbar', 'easymde-admin-popover' ),
			$this->get_static_asset_version( 'assets/css/admin/editor.css' )
		);
		$this->frontend_assets->enqueue_editor_base_assets( $post_id );

		wp_enqueue_media();
		if ( $this->enqueue_react_editor_asset() ) {
			wp_add_inline_script(
				'easymde-admin-editor-toolbar',
				'window.EasyMDEEditorRootBootstrap = ' . wp_json_encode(
					$this->get_editor_root_bootstrap( $post_id ),
					JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT
				) . ';',
				'before'
			);
		}
	}

	private function enqueue_react_editor_asset( $build_dir = '' ) {
		try {
			$asset = $this->get_react_editor_asset( $build_dir );
		} catch ( \Throwable $error ) {
			$this->react_editor_asset_error = true;
			wp_trigger_error(
				__METHOD__,
				'EasyMDE React editor asset contract failed (react-editor-asset-invalid).',
				E_USER_WARNING
			);

			return false;
		}

		wp_enqueue_script(
			$asset['handle'],
			Asset::url( $asset['path'] ),
			$asset['dependencies'],
			$asset['version'],
			true
		);

		return true;
	}

	private function get_editor_root_bootstrap( $post_id ) {
		$nonce         = wp_create_nonce( 'wp_rest' );
		$strings       = $this->get_strings();
		$storage       = $this->get_storage_config( $post_id );
		$theme_options = $this->theme_state_repository->get_theme_options_for_script( $post_id );
		$theme_state   = $theme_options['state'];
		$custom_css    = $theme_options['customCss'];

		if ( 'custom' === $theme_state['markdownTheme'] && '' !== $theme_state['customCssId'] ) {
			$has_selected_item = false;
			foreach ( $custom_css as $item ) {
				if ( $theme_state['customCssId'] === $item['id'] ) {
					$has_selected_item = true;
					break;
				}
			}

			if ( ! $has_selected_item && '' !== trim( $theme_state['customCss'] ) ) {
				$custom_css[] = array(
					'id'        => $theme_state['customCssId'],
					'name'      => $strings['customCssTheme'],
					'css'       => $theme_state['customCss'],
					'scopedCss' => $theme_state['scopedCustomCss'],
				);
			}
		}

		$preview_assets = $this->frontend_assets->get_editor_preview_assets();
		$code_themes    = array_map(
			static function ( $theme ) {
				return array(
					'id'     => $theme['id'],
					'cssUrl' => $theme['cssUrl'],
				);
			},
			$theme_options['codeThemes']
		);
		return array(
			'schemaVersion'      => 2,
			'shortcodeHelpers'   => $this->toolbar_registry->get_shortcode_helpers_for_script(),
			'document'           => array(
				'strings' => array( 'editorLabel' => $strings['editorLabel'] ),
			),
			'appearance'         => array(
				'articleThemes' => $theme_options['markdownThemes'],
				'codeThemes'    => $theme_options['codeThemes'],
				'customCss'     => $custom_css,
				'state'         => array(
					'markdownTheme' => $theme_state['markdownTheme'],
					'codeTheme'     => $theme_state['codeTheme'],
					'customCssId'   => $theme_state['customCssId'],
				),
				'strings'       => array(
					'appearance'     => $strings['appearance'],
					'articleTheme'   => $strings['articleTheme'],
					'codeTheme'      => $strings['codeTheme'],
					'customCss'      => $strings['customCss'],
					'cssName'        => $strings['cssName'],
					'saveCss'        => $strings['saveCss'],
					'cssSaved'       => $strings['cssSaved'],
					'cssSaveFailed'  => $strings['cssSaveFailed'],
					'namedCustomCss' => $strings['namedCustomCss'],
				),
			),
			'fonts'              => array(
				'options' => $theme_options['fontOptions'],
				'state'   => array(
					'customFont'  => $theme_state['customFont'],
					'windowsFont' => $theme_state['windowsFont'],
					'appleFont'   => $theme_state['appleFont'],
					'serifFont'   => $theme_state['serifFont'],
				),
				'strings' => array(
					'font'          => $strings['font'],
					'customFont'    => $strings['customFont'],
					'windowsFont'   => $strings['windowsFont'],
					'appleFont'     => $strings['appleFont'],
					'serifFont'     => $strings['serifFont'],
					'fontStackHelp' => $strings['fontStackHelp'],
				),
			),
			'imageUpload'        => array(
				'enabled'  => $this->get_image_upload_config()['enabled'],
				'endpoint' => esc_url_raw( rest_url( 'easymde/v1/media' ) ),
				'maxBytes' => $this->get_image_upload_config()['maxBytes'],
				'nonce'    => $nonce,
				'postId'   => absint( $post_id ),
				'strings'  => array(
					'defaultAlt'     => $strings['mediaDefaultAlt'],
					'dropFailed'     => $strings['imageDropFailed'],
					'dropTooLarge'   => $strings['imageDropTooLarge'],
					'dropUploaded'   => $strings['imageDropUploaded'],
					'dropUploading'  => $strings['imageDropUploading'],
					'pasteFailed'    => $strings['imagePasteFailed'],
					'pasteTooLarge'  => $strings['imagePasteTooLarge'],
					'pasteUploaded'  => $strings['imagePasteUploaded'],
					'pasteUploading' => $strings['imagePasteUploading'],
				),
			),
			'layout'             => array(
				'direction' => is_rtl() ? 'rtl' : 'ltr',
			),
			'localDrafts'        => array(
				'enabled'          => true,
				'locale'           => $storage['locale'],
				'maxBytes'         => $storage['draftMaxBytes'],
				'postId'           => absint( $post_id ),
				'savedFingerprint' => '',
				'schemaVersion'    => 1,
				'siteKey'          => $storage['siteKey'],
				'timeZone'         => $storage['timeZone'],
				'userId'           => $storage['userId'],
				'strings'          => array(
					'available'     => $strings['draftAvailable'],
					'conflict'      => $strings['draftConflict'],
					'discard'       => $strings['discardDraft'],
					'discardFailed' => $strings['draftDiscardFailed'],
					'discarded'     => $strings['draftDiscarded'],
					'readFailed'    => $strings['draftReadFailed'],
					'restore'       => $strings['restoreDraft'],
					'restored'      => $strings['draftRestored'],
					'saveFailed'    => $strings['draftSaveFailed'],
					'saved'         => $strings['draftSaved'],
				),
			),
			'mediaPicker'        => array(
				'defaultAlt'     => $strings['mediaDefaultAlt'],
				'insertMedia'    => $strings['insertMedia'],
				'placeholderAlt' => $strings['mediaAltText'],
			),
			'preview'            => array(
				'features'  => (object) array(),
				'html'      => '',
				'messages'  => array(
					'empty'     => $strings['previewEmpty'],
					'error'     => $strings['previewError'],
					'rendering' => $strings['previewRendering'],
				),
				'postId'    => absint( $post_id ),
				'signature' => '',
			),
			'previewEnhancement' => array(
				'assetBaseUrl' => Asset::url( '' ),
				'assets'       => $preview_assets,
				'codeThemes'   => $code_themes,
				'strings'      => array( 'renderingFailed' => $strings['renderingFailed'] ),
			),
			'toolbar'            => array(
				'commands'  => $this->toolbar_registry->get_commands_for_script(),
				'shortcuts' => $this->settings_page->get_shortcut_config_for_script(),
				'strings'   => array(
					'headings' => $strings['headings'],
					'linkText' => $strings['linkText'],
				),
			),
			'wechatExport'       => array(
				'enabled' => true,
				'strings' => array(
					'failed'      => $strings['copyWechatFailed'],
					'success'     => $strings['copyWechatSuccess'],
					'unsupported' => $strings['copyWechatUnsupported'],
				),
			),
			'strings'            => array(
				'immersive'          => array(
					'autoSave'                => __( 'Auto save', 'easymde' ),
					'autoSaveDescription'     => __( 'Automatically save a local draft', 'easymde' ),
					'autoSaveEnabled'         => __( 'Auto save is enabled', 'easymde' ),
					'cancel'                  => __( 'Cancel', 'easymde' ),
					'characters'              => __( 'characters', 'easymde' ),
					'close'                   => __( 'Close', 'easymde' ),
					'column'                  => __( 'Column', 'easymde' ),
					'edit'                    => __( 'Edit', 'easymde' ),
					'editMode'                => __( 'Edit mode', 'easymde' ),
					'editorSettings'          => __( 'Editor settings', 'easymde' ),
					'enter'                   => __( 'Enter immersive writing', 'easymde' ),
					'exit'                    => __( 'Exit immersive writing', 'easymde' ),
					'hideOutline'             => __( 'Hide outline', 'easymde' ),
					'history'                 => __( 'History', 'easymde' ),
					'historyEmpty'            => __( 'No revisions are available.', 'easymde' ),
					'historyError'            => __( 'Revisions could not be loaded.', 'easymde' ),
					'historyLoading'          => __( 'Loading revisions...', 'easymde' ),
					'historyAll'              => __( 'All', 'easymde' ),
					/* translators: %s: Number of available revisions. */
					'historyCount'            => __( '%s revisions', 'easymde' ),
					'historyVersions'         => __( 'Revision history', 'easymde' ),
					'immersive'               => __( 'Immersive writing', 'easymde' ),
					'insert'                  => __( 'Insert', 'easymde' ),
					'insertTable'             => __( 'Insert table', 'easymde' ),
					'line'                    => __( 'Line', 'easymde' ),
					'minutes'                 => __( 'minutes', 'easymde' ),
					'manualSave'              => __( 'Manual save', 'easymde' ),
					'moreActions'             => __( 'More actions', 'easymde' ),
					'markdown'                => __( 'Markdown', 'easymde' ),
					'noHeadings'              => __( 'No headings', 'easymde' ),
					'outline'                 => __( 'Outline', 'easymde' ),
					'outlineDescription'      => __( 'Show heading navigation on the left', 'easymde' ),
					'preview'                 => __( 'Preview', 'easymde' ),
					'previewMode'             => __( 'Preview mode', 'easymde' ),
					'publish'                 => __( 'Publish article', 'easymde' ),
					'readingTime'             => __( 'About', 'easymde' ),
					'restore'                 => __( 'Restore revision', 'easymde' ),
					'restoreConfirm'          => __( 'Unsaved changes will be lost when WordPress restores this revision. Continue?', 'easymde' ),
					'restoreThisVersion'      => __( 'Restore this revision', 'easymde' ),
					'resizeOutline'           => __( 'Resize article outline', 'easymde' ),
					'saved'                   => __( 'Saved', 'easymde' ),
					'settings'                => __( 'Settings', 'easymde' ),
					'showOutline'             => __( 'Show outline', 'easymde' ),
					'split'                   => __( 'Split', 'easymde' ),
					'splitMode'               => __( 'Split mode', 'easymde' ),
					'splitPreview'            => __( 'Split preview', 'easymde' ),
					'splitPreviewDescription' => __( 'Show live preview by default', 'easymde' ),
					'syncScroll'              => __( 'Synchronized scrolling', 'easymde' ),
					'syncScrollDescription'   => __( 'Keep the editor and preview in sync', 'easymde' ),
					'table'                   => __( 'Table', 'easymde' ),
					'tableColumns'            => __( 'Columns', 'easymde' ),
					'tableRows'               => __( 'Rows', 'easymde' ),
					'theme'                   => __( 'Theme', 'easymde' ),
					'themeSettings'           => __( 'Theme settings', 'easymde' ),
					'addTags'                 => __( 'Add tags', 'easymde' ),
					'categories'              => __( 'Categories', 'easymde' ),
					'categoriesDescription'   => __( 'Choose the sections this article belongs to.', 'easymde' ),
					/* translators: %s: Number of selected categories. */
					'categoriesSelected'      => __( 'Selected: %s', 'easymde' ),
					'closePublish'            => __( 'Close publish dialog', 'easymde' ),
					'continueAddingTags'      => __( 'Continue adding...', 'easymde' ),
					'excerpt'                 => __( 'Excerpt', 'easymde' ),
					'excerptPlaceholder'      => __( 'Write a short excerpt for search results, article lists, and sharing previews...', 'easymde' ),
					'featuredImage'           => __( 'Featured image', 'easymde' ),
					'imageRecommendation'     => __( 'Landscape images are recommended', 'easymde' ),
					'imageRequirements'       => __( 'Supports JPG, PNG, and WebP', 'easymde' ),
					'noWriteBeforeSubmit'     => __( 'Nothing is written to WordPress before submission.', 'easymde' ),
					'password'                => __( 'Password', 'easymde' ),
					'passwordPlaceholder'     => __( 'Enter access password', 'easymde' ),
					'passwordRequired'        => __( 'Enter an access password before submitting.', 'easymde' ),
					'preparingPublish'        => __( 'Ready to publish', 'easymde' ),
					'private'                 => __( 'Private', 'easymde' ),
					'privateDescription'      => __( 'Only site administrators and editors can view this article.', 'easymde' ),
					'public'                  => __( 'Public', 'easymde' ),
					'publishDescription'      => __( 'Confirm the article details to publish it to the current WordPress site.', 'easymde' ),
					'remove'                  => __( 'Remove', 'easymde' ),
					/* translators: %s: Tag name. */
					'removeTag'               => __( 'Remove tag: %s', 'easymde' ),
					'replace'                 => __( 'Replace', 'easymde' ),
					'selectFeaturedImage'     => __( 'Select featured image', 'easymde' ),
					'sticky'                  => __( 'Stick to the top of the blog', 'easymde' ),
					'tags'                    => __( 'Tags', 'easymde' ),
					'tagsDescription'         => __( 'Press Enter or comma to add a tag.', 'easymde' ),
					'updateArticle'           => __( 'Update article', 'easymde' ),
					'updateDescription'       => __( 'Confirm these changes to update the current WordPress article.', 'easymde' ),
					'updateExisting'          => __( 'Update existing article', 'easymde' ),
					'visibility'              => __( 'Visibility', 'easymde' ),
					'title'                   => __( 'Article title', 'easymde' ),
					'unsaved'                 => __( 'Unsaved', 'easymde' ),
					'viewModes'               => __( 'View modes', 'easymde' ),
					'wechat'                  => __( 'Copy to WeChat', 'easymde' ),
					'wechatCopied'            => __( 'Copied', 'easymde' ),
					'wordCount'               => __( 'Writing statistics', 'easymde' ),
					'wordCountDescription'    => __( 'Show words, characters, and reading time beside the title', 'easymde' ),
					'words'                   => __( 'words', 'easymde' ),
				),
				'mediaPickerFailure' => $strings['mediaPickerFailed'],
				'preview'            => __( 'Preview', 'easymde' ),
				'source'             => __( 'Markdown', 'easymde' ),
				'toolbar'            => $strings['markdownToolbar'],
			),
			'wordpress'          => array(
				'customCssUrl' => esc_url_raw( rest_url( 'easymde/v1/custom-css' ) ),
				'nonce'        => $nonce,
				'previewUrl'   => esc_url_raw( rest_url( 'easymde/v1/preview' ) ),
				'revisionsUrl' => esc_url_raw( rest_url( 'easymde/v1/posts/' ) ),
			),
		);
	}

	private function get_react_editor_asset( $build_dir = '' ) {
		$build_dir     = $build_dir ? trailingslashit( $build_dir ) : Asset::path( 'assets/build/' );
		$manifest_path = $build_dir . 'wordpress-manifest.json';
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- Reads a local committed build manifest, never a remote URL.
		$manifest_json = is_readable( $manifest_path ) ? file_get_contents( $manifest_path ) : false;
		$manifest      = false === $manifest_json ? null : json_decode( $manifest_json, true );
		$entry_key     = 'frontend/src/entrypoints/admin-editor.tsx';

		if (
			! is_array( $manifest )
			|| 1 !== ( $manifest['schemaVersion'] ?? null )
			|| ! isset( $manifest['entries'] )
			|| ! is_array( $manifest['entries'] )
			|| array( $entry_key ) !== array_keys( $manifest['entries'] )
			|| ! is_array( $manifest['entries'][ $entry_key ] )
		) {
			throw new \RuntimeException( 'react-editor-manifest-invalid' );
		}

		$entry = $manifest['entries'][ $entry_key ];
		$file  = isset( $entry['file'] ) ? (string) $entry['file'] : '';
		$asset = isset( $entry['asset'] ) ? (string) $entry['asset'] : '';
		if (
			'easymde-admin-editor-toolbar' !== ( $entry['handle'] ?? null )
			|| array( 'media-editor', 'wp-api-fetch', 'wp-element', 'wp-hooks' ) !== ( $entry['dependencies'] ?? null )
			|| array() !== ( $entry['resources'] ?? null )
			|| ! preg_match( '#^assets/admin-editor-[A-Za-z0-9_-]+\.js$#', $file )
			|| preg_replace( '/\.js$/', '.asset.php', $file ) !== $asset
		) {
			throw new \RuntimeException( 'react-editor-manifest-invalid' );
		}

		$script_path   = $build_dir . $file;
		$metadata_path = $build_dir . $asset;
		if ( ! is_file( $script_path ) || ! is_readable( $metadata_path ) ) {
			throw new \RuntimeException( 'react-editor-build-missing' );
		}

		$metadata = require $metadata_path;
		if (
			! is_array( $metadata )
			|| array( 'media-editor', 'wp-api-fetch', 'wp-element', 'wp-hooks' ) !== ( $metadata['dependencies'] ?? null )
			|| ! isset( $metadata['version'] )
			|| ! preg_match( '/^[a-f0-9]{16}$/', (string) $metadata['version'] )
		) {
			throw new \RuntimeException( 'react-editor-metadata-invalid' );
		}

		$script_hash = hash_file( 'sha256', $script_path );
		if (
			false === $script_hash
			|| ! hash_equals( (string) $metadata['version'], substr( $script_hash, 0, 16 ) )
		) {
			throw new \RuntimeException( 'react-editor-build-integrity-invalid' );
		}

		return array(
			'handle'       => 'easymde-admin-editor-toolbar',
			'path'         => 'assets/build/' . $file,
			'dependencies' => $metadata['dependencies'],
			'version'      => (string) $metadata['version'],
		);
	}

	private function get_post_id() {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only post ID is used only to localize editor assets.
		return isset( $_GET['post'] ) ? absint( wp_unslash( $_GET['post'] ) ) : 0;
	}

	private function get_storage_config( $post_id ) {
		$site_key = substr( md5( home_url( '/' ) ), 0, 12 );
		$user_id  = get_current_user_id();
		$post_key = $post_id ? (string) $post_id : 'new';

		return array(
			'siteKey'            => $site_key,
			'userId'             => $user_id,
			'postId'             => $post_id,
			'draftKey'           => 'easymde:draft:' . $site_key . ':' . $user_id . ':' . $post_key,
			'draftSchemaVersion' => 1,
			'draftMaxBytes'      => 1048576,
			'locale'             => get_user_locale( $user_id ),
			'timeZone'           => wp_timezone_string(),
		);
	}

	private function get_image_upload_config() {
		return array(
			'enabled'  => current_user_can( 'upload_files' ),
			'maxBytes' => min( 10485760, (int) wp_max_upload_size() ),
		);
	}

	private function get_strings() {
		return array(
			'editorLabel'           => __( 'Markdown source', 'easymde' ),
			'previewEmpty'          => __( 'Start writing Markdown to preview the article.', 'easymde' ),
			'previewRendering'      => __( 'Rendering preview...', 'easymde' ),
			'previewError'          => __( 'Preview failed. Please keep writing; saving is not affected.', 'easymde' ),
			'insertMedia'           => __( 'Insert Media', 'easymde' ),
			'markdownToolbar'       => __( 'Markdown toolbar', 'easymde' ),
			'appearance'            => __( 'Appearance', 'easymde' ),
			'font'                  => __( 'Font', 'easymde' ),
			'headings'              => __( 'Headings', 'easymde' ),
			'articleTheme'          => __( 'Article theme', 'easymde' ),
			'codeTheme'             => __( 'Code theme', 'easymde' ),
			'customCss'             => __( 'Custom CSS', 'easymde' ),
			'customCssTheme'        => __( 'Custom CSS theme', 'easymde' ),
			'namedCustomCss'        => __( 'Named custom CSS', 'easymde' ),
			'cssName'               => __( 'CSS name', 'easymde' ),
			'saveCss'               => __( 'Save CSS', 'easymde' ),
			'cssSaved'              => __( 'Saved CSS.', 'easymde' ),
			'cssSaveFailed'         => __( 'CSS save failed.', 'easymde' ),
			'customFont'            => __( 'Custom font', 'easymde' ),
			'windowsFont'           => __( 'Windows font', 'easymde' ),
			'appleFont'             => __( 'Apple font', 'easymde' ),
			'serifFont'             => __( 'Serif font', 'easymde' ),
			'fontStackHelp'         => __( 'Fonts are applied in custom, Windows, Apple, and serif fallback order when supported by the current system.', 'easymde' ),
			'draftSaved'            => __( 'Local draft saved', 'easymde' ),
			'draftAvailable'        => __( 'A newer local draft is available.', 'easymde' ),
			'restoreDraft'          => __( 'Restore draft', 'easymde' ),
			'discardDraft'          => __( 'Discard draft', 'easymde' ),
			'draftRestored'         => __( 'Draft restored.', 'easymde' ),
			'draftDiscarded'        => __( 'Draft discarded.', 'easymde' ),
			'draftReadFailed'       => __( 'Local draft could not be read.', 'easymde' ),
			'draftSaveFailed'       => __( 'Local draft could not be saved.', 'easymde' ),
			'draftDiscardFailed'    => __( 'Local draft could not be discarded.', 'easymde' ),
			'draftConflict'         => __( 'A different local draft was saved in another tab.', 'easymde' ),
			'renderingFailed'       => __( 'Rendering failed.', 'easymde' ),
			'copyWechatSuccess'     => __( 'Copied preview for WeChat.', 'easymde' ),
			'copyWechatFailed'      => __( 'Copy for WeChat failed. Please try again in this browser.', 'easymde' ),
			'copyWechatUnsupported' => __( 'Clipboard access is not available in this browser.', 'easymde' ),
			'imagePasteUploading'   => __( 'Uploading pasted image...', 'easymde' ),
			'imagePasteUploaded'    => __( 'Pasted image uploaded.', 'easymde' ),
			'imagePasteFailed'      => __( 'Pasted image upload failed. Please use the media library instead.', 'easymde' ),
			'imagePasteTooLarge'    => __( 'Pasted image is too large for this site.', 'easymde' ),
			'imageDropUploading'    => __( 'Uploading dropped image...', 'easymde' ),
			'imageDropUploaded'     => __( 'Dropped image uploaded.', 'easymde' ),
			'imageDropFailed'       => __( 'Dropped image upload failed. Please use the media library instead.', 'easymde' ),
			'imageDropTooLarge'     => __( 'Dropped image is too large for this site.', 'easymde' ),
			'mediaAltText'          => __( 'alt text', 'easymde' ),
			'mediaDefaultAlt'       => __( 'image', 'easymde' ),
			'mediaPickerFailed'     => __( 'The WordPress media library could not be opened.', 'easymde' ),
			'linkText'              => __( 'link text', 'easymde' ),
		);
	}

	private function get_static_asset_version( $asset_path ) {
		$path = Asset::path( $asset_path );
		if ( ! is_readable( $path ) ) {
			throw new \RuntimeException( 'admin-asset-unreadable' );
		}

		$hash = hash_file( 'sha256', $path );
		if ( ! is_string( $hash ) || ! preg_match( '/^[a-f0-9]{64}$/', $hash ) ) {
			throw new \RuntimeException( 'admin-asset-version-invalid' );
		}

		return substr( $hash, 0, 16 );
	}
}
