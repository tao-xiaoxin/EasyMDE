<?php

namespace EasyMDE\Admin;

use EasyMDE\Frontend\FrontendAssets;
use EasyMDE\Support\Asset;
use EasyMDE\Support\FrontendAssetContract;
use EasyMDE\Support\ManifestAssetResolver;
use EasyMDE\Support\SettingsCenterRepository;
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
	private $settings_center_repository;
	private $react_editor_asset_error = false;

	public function __construct(
		PostModeController $post_mode_controller,
		FrontendAssets $frontend_assets,
		ThemeStateRepository $theme_state_repository,
		ToolbarRegistry $toolbar_registry,
		SettingsCenterRepository $settings_center_repository
	) {
		$this->post_mode_controller       = $post_mode_controller;
		$this->frontend_assets            = $frontend_assets;
		$this->theme_state_repository     = $theme_state_repository;
		$this->toolbar_registry           = $toolbar_registry;
		$this->settings_center_repository = $settings_center_repository;
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

		// WordPress Emoji detection mutates editor text nodes after EasyMDE mounts CodeMirror.
		remove_action( 'admin_print_scripts', 'print_emoji_detection_script' );

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
		try {
			$this->frontend_assets->enqueue_editor_base_assets( $post_id );
		} catch ( \Throwable $error ) {
			if ( ! FrontendAssetContract::is_error( $error ) ) {
				throw $error;
			}

			$this->react_editor_asset_error = true;
			wp_trigger_error(
				__METHOD__,
				'EasyMDE frontend enhancement asset contract failed (' . FrontendAssetContract::error_code( $error ) . ').',
				E_USER_WARNING
			);

			return;
		}

		wp_enqueue_media();
		if ( $this->enqueue_react_editor_asset() ) {
			try {
				$root_bootstrap = $this->get_editor_root_bootstrap(
					$post_id,
					$screen->post_type,
					'post-new.php' === $hook
				);
			} catch ( \Throwable $error ) {
				if ( ! FrontendAssetContract::is_error( $error ) ) {
					throw $error;
				}

				wp_dequeue_script( 'easymde-admin-editor-toolbar' );
				$this->react_editor_asset_error = true;
				wp_trigger_error(
					__METHOD__,
					'EasyMDE frontend enhancement asset contract failed (' . FrontendAssetContract::error_code( $error ) . ').',
					E_USER_WARNING
				);

				return;
			}

			wp_add_inline_script(
				'easymde-admin-editor-toolbar',
				'window.EasyMDEEditorRootBootstrap = ' . wp_json_encode(
					$root_bootstrap,
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

		if ( ! wp_set_script_translations( $asset['handle'], 'easymde', Asset::path( 'languages' ) ) ) {
			wp_dequeue_script( $asset['handle'] );
			$this->react_editor_asset_error = true;
			wp_trigger_error(
				__METHOD__,
				'EasyMDE React editor translations failed to load (react-editor-translations-invalid).',
				E_USER_WARNING
			);

			return false;
		}

		return true;
	}

	private function get_editor_root_bootstrap( $post_id, $post_type = '', $is_new_post = false ) {
		$nonce         = wp_create_nonce( 'wp_rest' );
		$strings       = $this->get_strings();
		$storage       = $this->get_storage_config( $post_id );
		$theme_options = $this->theme_state_repository->get_theme_options_for_script( $post_id );
		$theme_state   = $theme_options['state'];
		$custom_css    = $theme_options['customCss'];
		$post_type     = $post_type ? sanitize_key( $post_type ) : get_post_type( $post_id );

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
					'id'               => $theme_state['customCssId'],
					'articleThemeName' => $strings['customCssTheme'],
					'codeThemeName'    => $strings['customCssTheme'],
					'css'              => $theme_state['customCss'],
					'scopedCss'        => $theme_state['scopedCustomCss'],
				);
			}
		}

		$preview_assets           = $this->frontend_assets->get_editor_preview_assets();
		$settings                 = $this->settings_center_repository->get_settings();
		$image_upload_config      = $this->get_image_upload_config();
		$allowed_image_mime_types = $this->get_allowed_editor_image_mime_types();
		$code_themes              = array_map(
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
				'articleThemes'       => $theme_options['markdownThemes'],
				'canManageCustomCss'  => current_user_can( 'unfiltered_html' ),
				'codeThemeExplicit'   => $theme_options['codeThemeExplicit'],
				'codeThemes'          => $theme_options['codeThemes'],
				'customCss'           => $custom_css,
				'customMarkupProfile' => $theme_options['customMarkupProfile'],
				'customCssVariables'  => $this->get_custom_css_variables(),
				'state'               => array(
					'markdownTheme' => $theme_state['markdownTheme'],
					'codeTheme'     => $theme_state['codeTheme'],
					'customCssId'   => $theme_state['customCssId'],
				),
				'strings'             => array(
					'appearance'       => $strings['appearance'],
					'articleTheme'     => $strings['articleTheme'],
					'codeTheme'        => $strings['codeTheme'],
					'customCss'        => $strings['customCss'],
					'customCssTheme'   => $strings['customCssTheme'],
					'cssName'          => $strings['cssName'],
					'saveCss'          => $strings['saveCss'],
					'cssSaved'         => $strings['cssSaved'],
					'cssSaveFailed'    => $strings['cssSaveFailed'],
					'themeApplyFailed' => $strings['themeApplyFailed'],
					'cssNameDuplicate' => $strings['cssNameDuplicate'],
					'namedCustomCss'   => $strings['namedCustomCss'],
					'customCssDialog'  => $this->get_custom_css_dialog_strings(),
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
				'allowedMimeTypes' => $allowed_image_mime_types,
				'enabled'          => $image_upload_config['enabled'] && ! empty( $allowed_image_mime_types ),
				'endpoint'         => esc_url_raw( rest_url( 'easymde/v1/image-hosting/upload' ) ),
				'insertion'        => array(
					'titleDisplay' => $settings['images']['titleDisplay'],
				),
				'maxBytes'         => $image_upload_config['maxBytes'],
				'nonce'            => $nonce,
				'actionNonce'      => wp_create_nonce( 'easymde_upload_image_hosting' ),
				'postId'           => absint( $post_id ),
				'strings'          => array(
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
			'settings'           => array(
				'general'  => $settings['general'],
				'markdown' => array(
					'wordWrap' => $settings['markdown']['wordWrap'],
				),
			),
			'layout'             => array(
				'direction' => is_rtl() ? 'rtl' : 'ltr',
				'status'    => array(
					'lastEdited' => $this->get_last_edited_label( $post_id ),
					'wordCount'  => $strings['wordCount'],
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
				'insertion'      => array(
					'titleDisplay' => $settings['images']['titleDisplay'],
				),
				'placeholderAlt' => $strings['mediaAltText'],
			),
			'preview'            => array(
				'features'  => (object) array(),
				'html'      => '',
				'messages'  => array(
					'empty' => $strings['previewEmpty'],
					'error' => $strings['previewError'],
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
				'commands'          => $this->toolbar_registry->get_commands_for_script(),
				'showShortcutHints' => (bool) $settings['shortcuts']['showHints'],
				'shortcuts'         => $this->settings_center_repository->get_shortcut_config_for_script(),
				'strings'           => array(
					'headingLabelFormat' => $strings['headingLabelFormat'],
					'headingLevel'       => $strings['headingLevel'],
					'headings'           => $strings['headings'],
					'linkText'           => $strings['linkText'],
					'undo'               => $strings['undo'],
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
					'autoSave'                    => __( 'Auto save', 'easymde' ),
					'autoSaveDescription'         => __( 'Automatically save a local draft', 'easymde' ),
					'autoSaveEnabled'             => __( 'Auto save is enabled', 'easymde' ),
					'articleOutline'              => __( 'Article outline', 'easymde' ),
					'cancel'                      => __( 'Cancel', 'easymde' ),
					'close'                       => __( 'Close', 'easymde' ),
					'column'                      => __( 'Column', 'easymde' ),
					'edit'                        => __( 'Edit', 'easymde' ),
					'editMode'                    => __( 'Edit mode', 'easymde' ),
					'editorSettings'              => __( 'Editor settings', 'easymde' ),
					'enter'                       => __( 'Enter immersive writing', 'easymde' ),
					'expand'                      => __( 'Expand', 'easymde' ),
					'exit'                        => __( 'Exit immersive writing', 'easymde' ),
					'hideOutline'                 => __( 'Close outline', 'easymde' ),
					'history'                     => __( 'History', 'easymde' ),
					'historyEmpty'                => __( 'No revisions are available.', 'easymde' ),
					'historyError'                => __( 'Revisions could not be loaded.', 'easymde' ),
					'historyLoading'              => __( 'Loading revisions...', 'easymde' ),
					'historyAll'                  => __( 'All', 'easymde' ),
					'historyVersions'             => __( 'Revision history', 'easymde' ),
					'immersive'                   => __( 'Immersive writing', 'easymde' ),
					'insert'                      => __( 'Insert', 'easymde' ),
					'insertTable'                 => __( 'Insert table', 'easymde' ),
					'line'                        => __( 'Line', 'easymde' ),
					'manualSave'                  => __( 'Manual save', 'easymde' ),
					'moreActions'                 => __( 'More actions', 'easymde' ),
					'markdown'                    => __( 'Markdown', 'easymde' ),
					'noHeadings'                  => __( 'No headings', 'easymde' ),
					'outline'                     => __( 'Outline', 'easymde' ),
					'outlineDescription'          => __( 'Show heading navigation on the left', 'easymde' ),
					'preview'                     => __( 'Preview', 'easymde' ),
					'previewChangesRecorded'      => __( 'Changes recorded', 'easymde' ),
					'previewContentLoaded'        => __( 'Content loaded', 'easymde' ),
					'previewEditable'             => __( 'Editable', 'easymde' ),
					'previewEditorLabel'          => __( 'Visual article editor', 'easymde' ),
					'previewLockReadOnly'         => __( 'Lock as read only', 'easymde' ),
					'previewReadOnly'             => __( 'Read only', 'easymde' ),
					'previewUnlockEdit'           => __( 'Unlock and edit', 'easymde' ),
					'previewMode'                 => __( 'Preview mode', 'easymde' ),
					'publish'                     => __( 'Publish article', 'easymde' ),
					'restore'                     => __( 'Restore revision', 'easymde' ),
					'restoreConfirm'              => __( 'Unsaved changes will be lost when WordPress restores this revision. Continue?', 'easymde' ),
					'restoreThisVersion'          => __( 'Restore this revision', 'easymde' ),
					'resizeOutline'               => __( 'Resize article outline', 'easymde' ),
					'resizeSplit'                 => __( 'Resize editor and Preview', 'easymde' ),
					'saved'                       => __( 'Saved', 'easymde' ),
					'settings'                    => __( 'Settings', 'easymde' ),
					'showOutline'                 => __( 'Open outline', 'easymde' ),
					'split'                       => __( 'Split', 'easymde' ),
					'splitMode'                   => __( 'Split mode', 'easymde' ),
					'splitPreview'                => __( 'Split preview', 'easymde' ),
					'splitPreviewDescription'     => __( 'Show live preview by default', 'easymde' ),
					'table'                       => __( 'Table', 'easymde' ),
					'tableColumns'                => __( 'Columns', 'easymde' ),
					'tableRows'                   => __( 'Rows', 'easymde' ),
					'theme'                       => __( 'Theme', 'easymde' ),
					'themeSettings'               => __( 'Theme settings', 'easymde' ),
					'addTags'                     => __( 'Add tags', 'easymde' ),
					'categories'                  => __( 'Categories', 'easymde' ),
					'categoriesDescription'       => __( 'Choose the sections this article belongs to.', 'easymde' ),
					/* translators: %s: Number of selected categories. */
					'categoriesSelected'          => __( 'Selected: %s', 'easymde' ),
					'closePublish'                => __( 'Close publish dialog', 'easymde' ),
					'collapse'                    => __( 'Collapse', 'easymde' ),
					'continueAddingTags'          => __( 'Continue adding...', 'easymde' ),
					'excerpt'                     => __( 'Excerpt', 'easymde' ),
					'excerptPlaceholder'          => __( 'Write a short excerpt for search results, article lists, and sharing previews...', 'easymde' ),
					'featuredImage'               => __( 'Featured image', 'easymde' ),
					'imageRecommendation'         => __( 'Landscape images are recommended', 'easymde' ),
					'imageRequirements'           => sprintf(
						/* translators: %s: Effective maximum image upload size, for example "5 MB". */
						__( 'Supports JPG, PNG, WebP, and GIF, max %s', 'easymde' ),
						size_format( $image_upload_config['maxBytes'] )
					),
					'noWriteBeforeSubmit'         => __( 'Nothing is written to WordPress before submission.', 'easymde' ),
					'openAfterPublish'            => __( 'Open the article page after publishing', 'easymde' ),
					'openAfterPublishDescription' => __( 'After submission, open the article page with the same article styling as the current Preview.', 'easymde' ),
					'openAfterUpdate'             => __( 'Open the article page after updating', 'easymde' ),
					'password'                    => __( 'Password', 'easymde' ),
					'passwordPlaceholder'         => __( 'Enter access password', 'easymde' ),
					'passwordRequired'            => __( 'Enter an access password before submitting.', 'easymde' ),
					'preparingPublish'            => __( 'Ready to publish', 'easymde' ),
					'private'                     => __( 'Private', 'easymde' ),
					'privateDescription'          => __( 'Only site administrators and editors can view this article.', 'easymde' ),
					'public'                      => __( 'Public', 'easymde' ),
					'publishDescription'          => __( 'Confirm the article details to publish it to the current WordPress site.', 'easymde' ),
					'publishFailed'               => __( 'WordPress did not accept the publish request. Check the page state and try again.', 'easymde' ),
					'publishLoadingPreview'       => __( 'Loading preview...', 'easymde' ),
					'publishOptions'              => __( 'Publish options', 'easymde' ),
					'remove'                      => __( 'Remove', 'easymde' ),
					/* translators: %s: Tag name. */
					'removeTag'                   => __( 'Remove tag: %s', 'easymde' ),
					'replace'                     => __( 'Replace', 'easymde' ),
					'selectFeaturedImage'         => __( 'Select featured image', 'easymde' ),
					'sticky'                      => __( 'Stick to the top of the blog', 'easymde' ),
					'tags'                        => __( 'Tags', 'easymde' ),
					'tagsDescription'             => __( 'Press Enter or comma to add a tag.', 'easymde' ),
					'updateArticle'               => __( 'Update article', 'easymde' ),
					'updateDescription'           => __( 'Confirm these changes to update the current WordPress article.', 'easymde' ),
					'updateExisting'              => __( 'Update existing article', 'easymde' ),
					'visibility'                  => __( 'Visibility', 'easymde' ),
					'title'                       => __( 'Article title', 'easymde' ),
					'unsaved'                     => __( 'Unsaved', 'easymde' ),
					'viewModes'                   => __( 'View modes', 'easymde' ),
					'wechat'                      => __( 'Copy to WeChat', 'easymde' ),
					'wechatCopied'                => __( 'Copied', 'easymde' ),
				),
				'mediaPickerFailure' => $strings['mediaPickerFailed'],
				'preview'            => __( 'Preview', 'easymde' ),
				'source'             => __( 'Markdown', 'easymde' ),
				'toolbar'            => $strings['markdownToolbar'],
			),
			'wordpress'          => array(
				'customCssUrl'      => esc_url_raw( rest_url( 'easymde/v1/custom-css' ) ),
				'isNewPost'         => (bool) $is_new_post || 0 === absint( $post_id ) || 'auto-draft' === get_post_status( $post_id ),
				'nonce'             => $nonce,
				'previewUrl'        => esc_url_raw( rest_url( 'easymde/v1/preview' ) ),
				'publishCategories' => $this->get_publish_categories( $post_type ),
				'revisionsUrl'      => esc_url_raw( rest_url( 'easymde/v1/posts/' ) ),
			),
		);
	}

	private function get_publish_categories( $post_type ) {
		if ( ! $post_type || ! is_object_in_taxonomy( $post_type, 'category' ) ) {
			return array();
		}

		$taxonomy = get_taxonomy( 'category' );
		if (
			! $taxonomy
			|| empty( $taxonomy->cap->assign_terms )
			|| ! current_user_can( $taxonomy->cap->assign_terms )
		) {
			return array();
		}

		$terms = get_terms(
			array(
				'hide_empty' => false,
				'number'     => 5000,
				'orderby'    => 'term_id',
				'order'      => 'ASC',
				'taxonomy'   => 'category',
			)
		);
		if ( is_wp_error( $terms ) ) {
			throw new \RuntimeException( 'easymde-publish-categories-unavailable' );
		}

		$terms_by_parent = array();
		foreach ( $terms as $term ) {
			$parent_id = (int) $term->parent;
			if ( ! isset( $terms_by_parent[ $parent_id ] ) ) {
				$terms_by_parent[ $parent_id ] = array();
			}
			$terms_by_parent[ $parent_id ][] = $term;
		}

		$build = static function ( $parent_id, $depth = 0 ) use ( &$build, $terms_by_parent ) {
			if ( $depth >= 32 ) {
				return array();
			}

			$categories = array();
			foreach ( $terms_by_parent[ $parent_id ] ?? array() as $term ) {
				$categories[] = array(
					'children' => $build( (int) $term->term_id, $depth + 1 ),
					'id'       => (string) $term->term_id,
					'label'    => $term->name,
				);
			}

			return $categories;
		};

		return $build( 0 );
	}

	private function get_react_editor_asset( $build_dir = '' ) {
		$build_dir = $build_dir ? $build_dir : 'assets/build/';

		return ManifestAssetResolver::resolve(
			'frontend/src/entrypoints/admin-editor.tsx',
			$build_dir,
			'easymde-admin-editor-toolbar',
			array( 'media-editor', 'wp-api-fetch', 'wp-element', 'wp-hooks', 'wp-i18n' ),
			'admin-editor',
			true,
			'react-editor-'
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

	private function get_last_edited_label( $post_id ) {
		if ( ! $post_id ) {
			return __( 'Not saved yet.', 'easymde' );
		}

		$post = get_post( $post_id );
		if ( ! $post ) {
			throw new \RuntimeException( 'editor-status-post-unavailable' );
		}

		$editor_id = absint( get_post_meta( $post_id, '_edit_last', true ) );
		$editor    = get_userdata( $editor_id );

		$modified = get_post_modified_time(
			get_option( 'date_format' ) . ' ' . get_option( 'time_format' ),
			false,
			$post,
			true
		);
		if ( ! is_string( $modified ) || '' === $modified ) {
			throw new \RuntimeException( 'editor-status-modified-time-unavailable' );
		}

		if ( $editor ) {
			return sprintf(
				/* translators: 1: display name of the last editor, 2: localized post modified date and time. */
				__( 'Last edited by %1$s on %2$s', 'easymde' ),
				$editor->display_name,
				$modified
			);
		}

		return sprintf(
			/* translators: %s: localized post modified date and time. */
			__( 'Last edited on %s', 'easymde' ),
			$modified
		);
	}

	private function get_image_upload_config() {
		return array(
			'enabled'  => current_user_can( 'upload_files' ),
			'maxBytes' => $this->settings_center_repository->get_effective_image_upload_max_bytes(),
		);
	}

	private function get_allowed_editor_image_mime_types() {
		$configured = $this->settings_center_repository->get_allowed_image_mime_types();
		$wordpress  = array_values( get_allowed_mime_types() );

		return array_values( array_intersect( $configured, $wordpress ) );
	}

	private function get_custom_css_variables() {
		return array(
			array(
				'id'          => 'primaryColor',
				'category'    => 'foundation',
				'label'       => __( 'Primary color', 'easymde' ),
				'description' => __( 'H1, list markers, and task checkmarks', 'easymde' ),
			),
			array(
				'id'          => 'headingColor',
				'category'    => 'foundation',
				'label'       => __( 'Heading color', 'easymde' ),
				'description' => __( 'H2-H6, bold text, and definition terms', 'easymde' ),
			),
			array(
				'id'          => 'textColor',
				'category'    => 'foundation',
				'label'       => __( 'Text color', 'easymde' ),
				'description' => __( 'Paragraphs, lists, and table body', 'easymde' ),
			),
			array(
				'id'          => 'mutedColor',
				'category'    => 'foundation',
				'label'       => __( 'Muted color', 'easymde' ),
				'description' => __( 'Strikethrough, footnotes, and image captions', 'easymde' ),
			),
			array(
				'id'          => 'linkColor',
				'category'    => 'foundation',
				'label'       => __( 'Link color', 'easymde' ),
				'description' => __( 'Body links and footnote links', 'easymde' ),
			),
			array(
				'id'          => 'backgroundColor',
				'category'    => 'foundation',
				'label'       => __( 'Background color', 'easymde' ),
				'description' => __( 'Article and content block base background', 'easymde' ),
			),
			array(
				'id'          => 'borderColor',
				'category'    => 'foundation',
				'label'       => __( 'Border color', 'easymde' ),
				'description' => __( 'Dividers, tables, and control borders', 'easymde' ),
			),
			array(
				'id'          => 'emphasisBackground',
				'category'    => 'blocks',
				'label'       => __( 'Highlight background', 'easymde' ),
				'description' => __( 'Marked text and emphasized content', 'easymde' ),
			),
			array(
				'id'          => 'selectionBackground',
				'category'    => 'blocks',
				'label'       => __( 'Selection background', 'easymde' ),
				'description' => __( 'Selected article text', 'easymde' ),
			),
			array(
				'id'          => 'quoteColor',
				'category'    => 'blocks',
				'label'       => __( 'Quote accent', 'easymde' ),
				'description' => __( 'Blockquote left border', 'easymde' ),
			),
			array(
				'id'          => 'quoteBackground',
				'category'    => 'blocks',
				'label'       => __( 'Quote background', 'easymde' ),
				'description' => __( 'Blockquote content background', 'easymde' ),
			),
			array(
				'id'          => 'tableHeaderBackground',
				'category'    => 'blocks',
				'label'       => __( 'Table header background', 'easymde' ),
				'description' => __( 'Table heading row background', 'easymde' ),
			),
			array(
				'id'          => 'tableStripeBackground',
				'category'    => 'blocks',
				'label'       => __( 'Table zebra stripes', 'easymde' ),
				'description' => __( 'Even content row background', 'easymde' ),
			),
			array(
				'id'          => 'inlineCodeColor',
				'category'    => 'code',
				'label'       => __( 'Inline code color', 'easymde' ),
				'description' => __( 'Inline code and keyboard shortcut text', 'easymde' ),
			),
			array(
				'id'          => 'inlineCodeBackground',
				'category'    => 'code',
				'label'       => __( 'Inline code background', 'easymde' ),
				'description' => __( 'Inline code and keyboard shortcut background', 'easymde' ),
			),
			array(
				'id'          => 'codeBlockTextColor',
				'category'    => 'code',
				'label'       => __( 'Code text color', 'easymde' ),
				'description' => __( 'Plain code and punctuation', 'easymde' ),
			),
			array(
				'id'          => 'codeBlockBackground',
				'category'    => 'code',
				'label'       => __( 'Code block background', 'easymde' ),
				'description' => __( 'Code block and line number area', 'easymde' ),
			),
			array(
				'id'          => 'codeKeywordColor',
				'category'    => 'code',
				'label'       => __( 'Keyword color', 'easymde' ),
				'description' => __( 'Keywords, functions, and booleans', 'easymde' ),
			),
			array(
				'id'          => 'codeStringColor',
				'category'    => 'code',
				'label'       => __( 'String color', 'easymde' ),
				'description' => __( 'Strings, property values, and numbers', 'easymde' ),
			),
			array(
				'id'          => 'codeCommentColor',
				'category'    => 'code',
				'label'       => __( 'Comment color', 'easymde' ),
				'description' => __( 'Comments, line numbers, and auxiliary markers', 'easymde' ),
			),
			array(
				'id'          => 'infoColor',
				'category'    => 'alerts',
				'label'       => __( 'Information accent', 'easymde' ),
				'description' => __( 'NOTE and information callout border', 'easymde' ),
			),
			array(
				'id'          => 'infoBackground',
				'category'    => 'alerts',
				'label'       => __( 'Information background', 'easymde' ),
				'description' => __( 'NOTE and information callout background', 'easymde' ),
			),
			array(
				'id'          => 'successColor',
				'category'    => 'alerts',
				'label'       => __( 'Success accent', 'easymde' ),
				'description' => __( 'TIP, success, and completed states', 'easymde' ),
			),
			array(
				'id'          => 'successBackground',
				'category'    => 'alerts',
				'label'       => __( 'Success background', 'easymde' ),
				'description' => __( 'TIP and success callout background', 'easymde' ),
			),
			array(
				'id'          => 'warningColor',
				'category'    => 'alerts',
				'label'       => __( 'Warning accent', 'easymde' ),
				'description' => __( 'WARNING callout border', 'easymde' ),
			),
			array(
				'id'          => 'warningBackground',
				'category'    => 'alerts',
				'label'       => __( 'Warning background', 'easymde' ),
				'description' => __( 'WARNING callout background', 'easymde' ),
			),
			array(
				'id'          => 'dangerColor',
				'category'    => 'alerts',
				'label'       => __( 'Danger accent', 'easymde' ),
				'description' => __( 'CAUTION and error callout border', 'easymde' ),
			),
			array(
				'id'          => 'dangerBackground',
				'category'    => 'alerts',
				'label'       => __( 'Danger background', 'easymde' ),
				'description' => __( 'CAUTION and error callout background', 'easymde' ),
			),
		);
	}

	private function get_custom_css_dialog_strings() {
		return array(
			'description'                  => __( 'Create a personal article and code theme with live preview.', 'easymde' ),
			'close'                        => __( 'Close custom CSS theme', 'easymde' ),
			'closeTitle'                   => __( 'Close', 'easymde' ),
			'articleThemeName'             => __( 'Article theme name', 'easymde' ),
			'codeThemeName'                => __( 'Code theme name', 'easymde' ),
			'articleNamePlaceholder'       => __( 'Enter article theme name', 'easymde' ),
			'codeNamePlaceholder'          => __( 'Enter code theme name', 'easymde' ),
			'unsavedChanges'               => __( 'Changes have not been applied', 'easymde' ),
			'invalidColor'                 => __( 'Enter a valid six-digit hex color', 'easymde' ),
			'missingName'                  => __( 'Enter both theme names', 'easymde' ),
			'previewTitle'                 => __( 'Modified style preview', 'easymde' ),
			'livePreview'                  => __( 'Live', 'easymde' ),
			'previewHelp'                  => __( 'The preview updates with the selected colors.', 'easymde' ),
			'previewInvalid'               => __( 'Fix invalid CSS to update the live preview.', 'easymde' ),
			'previewUnavailable'           => __( 'Live preview is temporarily unavailable.', 'easymde' ),
			'themeVariables'               => __( 'Theme variables', 'easymde' ),
			'themeVariableCategories'      => __( 'Theme variable categories', 'easymde' ),
			/* translators: %s: Custom CSS theme variable category label. */
			'themeVariablePanelLabel'      => __( '%s theme variables', 'easymde' ),
			'customCssCodeTitle'           => __( 'Custom CSS code', 'easymde' ),
			'reset'                        => __( 'Reset', 'easymde' ),
			'expandCode'                   => __( 'Expand code editor', 'easymde' ),
			'shrinkCode'                   => __( 'Shrink code editor', 'easymde' ),
			'backToVariables'              => __( 'Back to variables', 'easymde' ),
			'saveTarget'                   => __( 'CSS target', 'easymde' ),
			'articleCss'                   => __( 'Article CSS', 'easymde' ),
			'codeCss'                      => __( 'Code CSS', 'easymde' ),
			'articleCssHelp'               => __( 'These rules are applied to article content.', 'easymde' ),
			'codeCssHelp'                  => __( 'These rules are applied to code content.', 'easymde' ),
			'foundationCategory'           => __( 'Foundation', 'easymde' ),
			'blocksCategory'               => __( 'Blocks', 'easymde' ),
			'codeCategory'                 => __( 'Code', 'easymde' ),
			'alertsCategory'               => __( 'Alerts', 'easymde' ),
			'customCssCode'                => __( 'Custom CSS code', 'easymde' ),
			'customCssCodeHelp'            => __( 'Add detailed CSS rules', 'easymde' ),
			'backToThemeVariables'         => __( 'Back to theme variables', 'easymde' ),
			'cancel'                       => __( 'Cancel', 'easymde' ),
			'resetAll'                     => __( 'Reset all', 'easymde' ),
			'applyCustomTheme'             => __( 'Apply theme', 'easymde' ),
			'defaultArticleName'           => __( 'EasyMDE Blue', 'easymde' ),
			'defaultCodeName'              => __( 'EasyMDE Blue Code', 'easymde' ),
			/* translators: %s: Custom CSS color variable label. */
			'colorPickerLabel'             => __( '%s color picker', 'easymde' ),
			'currentThemeVariablesComment' => __( 'Current theme variables', 'easymde' ),
			'addCustomRulesComment'        => __( 'Add custom rules below', 'easymde' ),
			'previewHeadingOne'            => __( 'Heading 1 preview sample', 'easymde' ),
			'previewHeadingTwo'            => __( 'Heading 2 preview sample', 'easymde' ),
			'previewBodyText'              => __( 'This body text demonstrates the current theme typography, spacing, and layout.', 'easymde' ),
			'previewParagraph'             => __( 'Theme preview with', 'easymde' ),
			'previewBoldText'              => __( 'bold text', 'easymde' ),
			'previewItalicText'            => __( 'italic text', 'easymde' ),
			'previewDeletedText'           => __( 'deleted text', 'easymde' ),
			'previewHighlight'             => __( 'highlight', 'easymde' ),
			'previewInlineCode'            => __( 'inline code', 'easymde' ),
			'previewCodeComment'           => __( 'Theme preview', 'easymde' ),
			'previewBlockquote'            => __( 'Blockquote and callout styling preview.', 'easymde' ),
			'previewUnorderedItem'         => __( 'Unordered list item', 'easymde' ),
			'previewCompletedTask'         => __( 'Completed task', 'easymde' ),
			'previewOrderedItem'           => __( 'Ordered list item', 'easymde' ),
			'previewSecondStep'            => __( 'Second step', 'easymde' ),
			'previewTableHeader'           => __( 'Header', 'easymde' ),
			'previewTableContent'          => __( 'Content', 'easymde' ),
			'previewLink'                  => __( 'Link color preview', 'easymde' ),
			'previewNoteLabel'             => __( 'NOTE', 'easymde' ),
			'previewTipLabel'              => __( 'TIP', 'easymde' ),
			'previewWarningLabel'          => __( 'WARNING', 'easymde' ),
			'previewCautionLabel'          => __( 'CAUTION', 'easymde' ),
			'previewInformation'           => __( 'Information', 'easymde' ),
			'previewSuccess'               => __( 'Success', 'easymde' ),
			'previewWarning'               => __( 'Warning', 'easymde' ),
			'previewDanger'                => __( 'Danger', 'easymde' ),
			'previewDetails'               => __( 'Additional details', 'easymde' ),
			'previewDetailsContent'        => __( 'Longer supporting content can be previewed here.', 'easymde' ),
			'previewDefinitionTerm'        => __( 'Definition list', 'easymde' ),
			'previewDefinitionDescription' => __( 'Used to explain terms or add structured details.', 'easymde' ),
			'previewSupplementalHeading'   => __( 'Tertiary heading and supporting content', 'easymde' ),
			'previewSupplementalText'      => __( 'Images, mathematical formulas, and footnotes use the body text system. Example footnote', 'easymde' ),
			'previewFootnote'              => __( '[1] Footnote and supporting text color sample.', 'easymde' ),
			/* translators: Separator between inline Custom CSS preview examples. */
			'previewInlineSeparator'       => _x( ', ', 'inline Custom CSS preview separator', 'easymde' ),
			/* translators: Conjunction before the keyboard shortcut in the inline Custom CSS preview. */
			'previewInlineConjunction'     => _x( 'and ', 'inline Custom CSS preview conjunction', 'easymde' ),
			/* translators: Sentence-ending punctuation in the inline Custom CSS preview. */
			'previewSentenceEnd'           => _x( '.', 'inline Custom CSS preview sentence end', 'easymde' ),
		);
	}

	private function get_strings() {
		return array(
			'editorLabel'           => __( 'Markdown source', 'easymde' ),
			'previewEmpty'          => __( 'Start writing Markdown to preview the article.', 'easymde' ),
			'previewError'          => __( 'Preview failed. Please keep writing; saving is not affected.', 'easymde' ),
			'insertMedia'           => __( 'Insert Media', 'easymde' ),
			'markdownToolbar'       => __( 'Markdown toolbar', 'easymde' ),
			'undo'                  => __( 'Undo', 'easymde' ),
			'appearance'            => __( 'Appearance', 'easymde' ),
			'font'                  => __( 'Font', 'easymde' ),
			'headings'              => __( 'Headings', 'easymde' ),
			/* translators: %s: Heading level from 1 through 6. */
			'headingLabelFormat'    => __( 'Heading %s', 'easymde' ),
			'headingLevel'          => __( 'Heading level', 'easymde' ),
			'articleTheme'          => __( 'Article theme', 'easymde' ),
			'codeTheme'             => __( 'Code theme', 'easymde' ),
			'customCss'             => __( 'Custom CSS', 'easymde' ),
			'customCssTheme'        => __( 'Custom CSS theme', 'easymde' ),
			'namedCustomCss'        => __( 'Named custom CSS', 'easymde' ),
			'cssName'               => __( 'CSS name', 'easymde' ),
			'saveCss'               => __( 'Save CSS', 'easymde' ),
			'cssSaved'              => __( 'Saved CSS.', 'easymde' ),
			'cssSaveFailed'         => __( 'CSS save failed.', 'easymde' ),
			'themeApplyFailed'      => __( 'Theme could not be applied. The saved theme is still available.', 'easymde' ),
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
			'imagePasteFailed'      => __( 'Pasted image upload failed after the configured attempts were exhausted. Please try uploading the image again.', 'easymde' ),
			'imagePasteTooLarge'    => __( 'Pasted image is too large for this site.', 'easymde' ),
			'imageDropUploading'    => __( 'Uploading dropped image...', 'easymde' ),
			'imageDropUploaded'     => __( 'Dropped image uploaded.', 'easymde' ),
			'imageDropFailed'       => __( 'Dropped image upload failed after the configured attempts were exhausted. Please try uploading the image again.', 'easymde' ),
			'imageDropTooLarge'     => __( 'Dropped image is too large for this site.', 'easymde' ),
			'mediaAltText'          => __( 'alt text', 'easymde' ),
			'mediaDefaultAlt'       => __( 'image', 'easymde' ),
			'mediaPickerFailed'     => __( 'The WordPress media library could not be opened.', 'easymde' ),
			'linkText'              => __( 'link text', 'easymde' ),
			/* translators: %s: Locale-formatted Markdown character count. */
			'wordCount'             => __( 'Character count: %s', 'easymde' ),
			'cssNameDuplicate'      => __( 'A theme with this name already exists. Please choose another name and try again.', 'easymde' ),
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
