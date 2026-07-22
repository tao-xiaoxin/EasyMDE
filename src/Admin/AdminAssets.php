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
	const CATEGORY_OPTIONS_CACHE_TTL = 300;

	private $post_mode_controller;
	private $frontend_assets;
	private $theme_state_repository;
	private $toolbar_registry;
	private $settings_page;
	private $category_load_error      = '';
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
		$category_options = $this->get_category_options( $screen->post_type, $post_id );
		if ( $this->enqueue_react_editor_asset() ) {
			wp_add_inline_script(
				'easymde-admin-editor-toolbar',
				'window.EasyMDEEditorRootBootstrap = ' . wp_json_encode(
					$this->get_editor_root_bootstrap( $post_id, $category_options ),
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

	private function get_editor_root_bootstrap( $post_id, array $category_options ) {
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
		$post           = $post_id ? get_post( $post_id ) : null;

		return array(
			'schemaVersion'      => 1,
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
				'locale'    => get_user_locale(),
				'strings'   => array(
					'cjkCharacters'    => $strings['cjkCharacters'],
					'closeOutline'     => $strings['closeOutline'],
					'cursorPosition'   => $strings['cursorPosition'],
					'editMode'         => $strings['editMode'],
					'lines'            => $strings['lines'],
					'noOutline'        => $strings['noOutline'],
					'openOutline'      => $strings['openOutline'],
					'outline'          => $strings['outline'],
					'previewMode'      => $strings['previewMode'],
					'readingTime'      => $strings['readingTime'],
					'resizePanes'      => $strings['resizePanes'],
					'saved'            => $strings['saved'],
					'showMoreHeadings' => $strings['showMoreHeadings'],
					'splitMode'        => $strings['splitMode'],
					'statistics'       => $strings['statistics'],
					'statisticsHelp'   => $strings['statisticsHelp'],
					'totalCharacters'  => $strings['totalCharacters'],
					'unsaved'          => $strings['unsaved'],
					'viewMode'         => $strings['viewMode'],
					'westernWords'     => $strings['westernWords'],
				),
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
			'publishing'         => array(
				'categoryLoadError' => $this->category_load_error,
				'categoryOptions'   => $category_options,
				'timeZone'          => wp_timezone_string(),
				'strings'           => array(
					'categories'          => $strings['publishCategories'],
					'close'               => $strings['closePublishDialog'],
					'excerpt'             => $strings['publishExcerpt'],
					'featuredImage'       => $strings['publishFeaturedImage'],
					'open'                => $strings['publishArticle'],
					'password'            => $strings['publishPassword'],
					'passwordRequired'    => $strings['publishPasswordRequired'],
					'passwordVisibility'  => $strings['publishVisibilityPassword'],
					'privateVisibility'   => $strings['publishVisibilityPrivate'],
					'publicVisibility'    => $strings['publishVisibilityPublic'],
					'removeFeaturedImage' => $strings['removeFeaturedImage'],
					'schedule'            => $strings['publishSchedule'],
					'selectFeaturedImage' => $strings['selectFeaturedImage'],
					'status'              => $strings['publishStatus'],
					'sticky'              => $strings['publishSticky'],
					'submitFailed'        => $strings['publishRequestFailed'],
					'submitting'          => $strings['publishSubmitting'],
					'tags'                => $strings['publishTags'],
					'title'               => $strings['publishingTitle'],
					'useFeaturedImage'    => $strings['useFeaturedImage'],
					'visibility'          => $strings['publishVisibility'],
				),
			),
			'revisions'          => array(
				'enabled' => (bool) ( $post && wp_revisions_enabled( $post ) ),
				'strings' => array(
					'autoSave'          => $strings['historyAutoSave'],
					'close'             => $strings['close'],
					'confirmNavigation' => $strings['historyUnsavedConfirm'],
					'count'             => $strings['historyCount'],
					'failed'            => $strings['historyFailed'],
					'filterAll'         => $strings['historyFilterAll'],
					'help'              => $strings['historyHelp'],
					'loading'           => $strings['loadingHistory'],
					'loadingPreview'    => $strings['loadingHistoryPreview'],
					'manualSave'        => $strings['historyManualSave'],
					'noRevisions'       => $strings['noRevisions'],
					'open'              => $strings['historyShort'],
					'previewFailed'     => $strings['historyPreviewFailed'],
					'restore'           => $strings['historyRestore'],
					'title'             => $strings['historyVersions'],
					'untitled'          => $strings['untitledRevision'],
				),
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
				'mediaPickerFailure' => $strings['mediaPickerFailed'],
				'preview'            => __( 'Preview', 'easymde' ),
				'source'             => __( 'Markdown', 'easymde' ),
				'toolbar'            => $strings['markdownToolbar'],
			),
			'wordpress'          => array(
				'customCssUrl'     => esc_url_raw( rest_url( 'easymde/v1/custom-css' ) ),
				'nonce'            => $nonce,
				'previewUrl'       => esc_url_raw( rest_url( 'easymde/v1/preview' ) ),
				'revisionAdminUrl' => esc_url_raw( admin_url( 'revision.php' ) ),
				'revisionsUrl'     => esc_url_raw( rest_url( 'easymde/v1/posts/' . absint( $post_id ) . '/revisions' ) ),
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

	/**
	 * Return the native category hierarchy used by editor publishing controls.
	 *
	 * @param string $post_type Current editor post type.
	 * @param int    $post_id   Current editor post ID.
	 * @return array<int, array<string, bool|string>>
	 */
	private function get_category_options( $post_type, $post_id ) {
		$this->category_load_error = '';

		if ( ! is_object_in_taxonomy( $post_type, 'category' ) ) {
			return array();
		}

		$cache_key = $this->get_category_options_cache_key( $post_type, $post_id );
		$found     = false;
		$options   = $cache_key ? wp_cache_get( $cache_key, 'easymde', false, $found ) : false;

		if ( $found && is_array( $options ) ) {
			return $options;
		}

		$terms = get_terms(
			array(
				'taxonomy'   => 'category',
				'hide_empty' => false,
				'orderby'    => 'name',
				'order'      => 'ASC',
			)
		);

		if ( is_wp_error( $terms ) ) {
			$this->category_load_error = __( 'EasyMDE could not load WordPress categories.', 'easymde' );
			do_action( 'easymde_category_options_load_failed', $post_type, $terms );

			return array();
		}

		$parent_ids = array();
		foreach ( $terms as $term ) {
			if ( $term->parent ) {
				$parent_ids[ (int) $term->parent ] = true;
			}
		}

		$options = array_map(
			static function ( $term ) use ( $parent_ids ) {
				return array(
					'id'          => (string) $term->term_id,
					'label'       => $term->name,
					'parentId'    => $term->parent ? (string) $term->parent : '',
					'hasChildren' => isset( $parent_ids[ (int) $term->term_id ] ),
				);
			},
			$terms
		);

		if ( $cache_key ) {
			wp_cache_set( $cache_key, $options, 'easymde', self::CATEGORY_OPTIONS_CACHE_TTL );
		}

		return $options;
	}

	private function get_category_options_cache_key( $post_type, $post_id ) {
		$user         = wp_get_current_user();
		$capabilities = $user->allcaps;

		ksort( $capabilities );
		$context = array(
			'blogId'           => (string) get_current_blog_id(),
			'capabilitiesHash' => md5( wp_json_encode( $capabilities ) ),
			'locale'           => determine_locale(),
			'postId'           => (string) absint( $post_id ),
			'postType'         => sanitize_key( $post_type ),
			'userId'           => (string) $user->ID,
		);

		/**
		 * Filters the context used to cache editor category options.
		 *
		 * Return false when category query filters depend on request state that
		 * cannot be represented by a stable cache context.
		 *
		 * @param array<string,string>|false $context   Default cache context.
		 * @param string                     $post_type Current editor post type.
		 * @param int                        $post_id   Current editor post ID.
		 */
		$context = apply_filters( 'easymde_category_options_cache_context', $context, $post_type, absint( $post_id ) );
		if ( false === $context ) {
			return '';
		}

		return 'category_options:' . md5(
			wp_json_encode(
				array(
					'context'     => $context,
					'lastChanged' => wp_cache_get_last_changed( 'terms' ),
				)
			)
		);
	}

	private function get_strings() {
		return array(
			'editorLabel'               => __( 'Markdown source', 'easymde' ),
			'previewEmpty'              => __( 'Start writing Markdown to preview the article.', 'easymde' ),
			'previewRendering'          => __( 'Rendering preview...', 'easymde' ),
			'previewError'              => __( 'Preview failed. Please keep writing; saving is not affected.', 'easymde' ),
			'insertMedia'               => __( 'Insert Media', 'easymde' ),
			'viewMode'                  => __( 'View mode', 'easymde' ),
			'editMode'                  => __( 'Edit', 'easymde' ),
			'splitMode'                 => __( 'Split', 'easymde' ),
			'previewMode'               => __( 'Preview', 'easymde' ),
			'historyShort'              => __( 'History', 'easymde' ),
			'historyVersions'           => __( 'Version history', 'easymde' ),
			/* translators: %d is the number of available WordPress revisions. */
			'historyCount'              => __( '%d revisions', 'easymde' ),
			'historyFilterAll'          => __( 'All', 'easymde' ),
			'historyAutoSave'           => __( 'Auto save', 'easymde' ),
			'historyManualSave'         => __( 'Manual save', 'easymde' ),
			'historyRestore'            => __( 'Restore this version', 'easymde' ),
			'loadingHistoryPreview'     => __( 'Loading revision preview...', 'easymde' ),
			'historyPreviewFailed'      => __( 'Revision preview could not be loaded.', 'easymde' ),
			'historyHelp'               => __( 'WordPress revisions for this article', 'easymde' ),
			'loadingHistory'            => __( 'Loading revisions...', 'easymde' ),
			'noRevisions'               => __( 'No revisions are available yet.', 'easymde' ),
			'untitledRevision'          => __( 'Untitled revision', 'easymde' ),
			'historyFailed'             => __( 'Revision history could not be loaded.', 'easymde' ),
			'publishArticle'            => __( 'Publish article', 'easymde' ),
			'publishingTitle'           => __( 'Publishing', 'easymde' ),
			'publishStatus'             => __( 'Status', 'easymde' ),
			'publishSchedule'           => __( 'Schedule', 'easymde' ),
			'publishSubmitting'         => __( 'Submitting...', 'easymde' ),
			'publishRequestFailed'      => __( 'WordPress could not start the requested action.', 'easymde' ),
			'closePublishDialog'        => __( 'Close publish dialog', 'easymde' ),
			'publishTags'               => __( 'Tags', 'easymde' ),
			'publishFeaturedImage'      => __( 'Featured image', 'easymde' ),
			'publishVisibility'         => __( 'Visibility', 'easymde' ),
			'publishVisibilityPublic'   => __( 'Public', 'easymde' ),
			'publishVisibilityPassword' => __( 'Password', 'easymde' ),
			'publishVisibilityPrivate'  => __( 'Private', 'easymde' ),
			'publishSticky'             => __( 'Stick to the top of the front page', 'easymde' ),
			'publishPassword'           => __( 'Access password', 'easymde' ),
			'publishPasswordRequired'   => __( 'Enter an access password before submitting.', 'easymde' ),
			'publishExcerpt'            => __( 'Summary', 'easymde' ),
			'publishCategories'         => __( 'Categories', 'easymde' ),
			'selectFeaturedImage'       => __( 'Select featured image', 'easymde' ),
			'useFeaturedImage'          => __( 'Use featured image', 'easymde' ),
			'removeFeaturedImage'       => __( 'Remove', 'easymde' ),
			'close'                     => __( 'Close', 'easymde' ),
			'markdownToolbar'           => __( 'Markdown toolbar', 'easymde' ),
			'outline'                   => __( 'Outline', 'easymde' ),
			'closeOutline'              => __( 'Close outline', 'easymde' ),
			'openOutline'               => __( 'Open outline', 'easymde' ),
			'noOutline'                 => __( 'No headings yet', 'easymde' ),
			'showMoreHeadings'          => __( 'Show more headings', 'easymde' ),
			/* translators: 1: line number, 2: column number. */
			'cursorPosition'            => __( 'Line %1$s, Column %2$s', 'easymde' ),
			'statistics'                => __( 'Writing statistics', 'easymde' ),
			'readingTime'               => __( 'Reading time (minutes)', 'easymde' ),
			'lines'                     => __( 'Lines', 'easymde' ),
			'westernWords'              => __( 'Western words', 'easymde' ),
			'cjkCharacters'             => __( 'CJK characters', 'easymde' ),
			'totalCharacters'           => __( 'Total characters', 'easymde' ),
			'statisticsHelp'            => __( 'Reading time is estimated locally at 300 reading units per minute; each Western word and CJK character counts as one unit.', 'easymde' ),
			'appearance'                => __( 'Appearance', 'easymde' ),
			'font'                      => __( 'Font', 'easymde' ),
			'headings'                  => __( 'Headings', 'easymde' ),
			'articleTheme'              => __( 'Article theme', 'easymde' ),
			'codeTheme'                 => __( 'Code theme', 'easymde' ),
			'customCss'                 => __( 'Custom CSS', 'easymde' ),
			'customCssTheme'            => __( 'Custom CSS theme', 'easymde' ),
			'saved'                     => __( 'Saved', 'easymde' ),
			'unsaved'                   => __( 'Unsaved', 'easymde' ),
			'namedCustomCss'            => __( 'Named custom CSS', 'easymde' ),
			'cssName'                   => __( 'CSS name', 'easymde' ),
			'saveCss'                   => __( 'Save CSS', 'easymde' ),
			'cssSaved'                  => __( 'Saved CSS.', 'easymde' ),
			'cssSaveFailed'             => __( 'CSS save failed.', 'easymde' ),
			'customFont'                => __( 'Custom font', 'easymde' ),
			'windowsFont'               => __( 'Windows font', 'easymde' ),
			'appleFont'                 => __( 'Apple font', 'easymde' ),
			'serifFont'                 => __( 'Serif font', 'easymde' ),
			'fontStackHelp'             => __( 'Fonts are applied in custom, Windows, Apple, and serif fallback order when supported by the current system.', 'easymde' ),
			'draftSaved'                => __( 'Local draft saved', 'easymde' ),
			'draftAvailable'            => __( 'A newer local draft is available.', 'easymde' ),
			'restoreDraft'              => __( 'Restore draft', 'easymde' ),
			'discardDraft'              => __( 'Discard draft', 'easymde' ),
			'draftRestored'             => __( 'Draft restored.', 'easymde' ),
			'draftDiscarded'            => __( 'Draft discarded.', 'easymde' ),
			'draftReadFailed'           => __( 'Local draft could not be read.', 'easymde' ),
			'draftSaveFailed'           => __( 'Local draft could not be saved.', 'easymde' ),
			'draftDiscardFailed'        => __( 'Local draft could not be discarded.', 'easymde' ),
			'draftConflict'             => __( 'A different local draft was saved in another tab.', 'easymde' ),
			'renderingFailed'           => __( 'Rendering failed.', 'easymde' ),
			'historyUnsavedConfirm'     => __( 'You have unsaved title or Markdown changes. Continue to revision history and leave these changes behind?', 'easymde' ),
			'copyWechatSuccess'         => __( 'Copied preview for WeChat.', 'easymde' ),
			'copyWechatFailed'          => __( 'Copy for WeChat failed. Please try again in this browser.', 'easymde' ),
			'copyWechatUnsupported'     => __( 'Clipboard access is not available in this browser.', 'easymde' ),
			'resizePanes'               => __( 'Resize source and preview', 'easymde' ),
			'imagePasteUploading'       => __( 'Uploading pasted image...', 'easymde' ),
			'imagePasteUploaded'        => __( 'Pasted image uploaded.', 'easymde' ),
			'imagePasteFailed'          => __( 'Pasted image upload failed. Please use the media library instead.', 'easymde' ),
			'imagePasteTooLarge'        => __( 'Pasted image is too large for this site.', 'easymde' ),
			'imageDropUploading'        => __( 'Uploading dropped image...', 'easymde' ),
			'imageDropUploaded'         => __( 'Dropped image uploaded.', 'easymde' ),
			'imageDropFailed'           => __( 'Dropped image upload failed. Please use the media library instead.', 'easymde' ),
			'imageDropTooLarge'         => __( 'Dropped image is too large for this site.', 'easymde' ),
			'mediaAltText'              => __( 'alt text', 'easymde' ),
			'mediaDefaultAlt'           => __( 'image', 'easymde' ),
			'mediaPickerFailed'         => __( 'The WordPress media library could not be opened.', 'easymde' ),
			'linkText'                  => __( 'link text', 'easymde' ),
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
