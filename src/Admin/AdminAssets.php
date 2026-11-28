<?php

namespace EasyMDE\Admin;

use EasyMDE\Frontend\FrontendAssets;
use EasyMDE\ImageHosting\ImageUploadExtensionPolicy;
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
	private $react_editor_asset_error   = false;
	private $react_editor_loader_handle = '';
	private $react_editor_loader_hook   = '';
	private $react_editor_preload_hook  = '';
	private $react_editor_preload_url   = '';

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

	public function render_react_editor_preload() {
		if ( '' === $this->react_editor_preload_hook || '' === $this->react_editor_preload_url ) {
			return;
		}

		remove_action( $this->react_editor_preload_hook, array( $this, 'render_react_editor_preload' ), 0 );
		echo '<link rel="modulepreload" fetchpriority="high" href="' . esc_url( $this->react_editor_preload_url ) . '">' . "\n";
		$this->react_editor_preload_hook = '';
		$this->react_editor_preload_url  = '';
	}

	public function render_react_editor_loader() {
		$hook   = $this->react_editor_loader_hook;
		$handle = $this->react_editor_loader_handle;

		$this->react_editor_loader_hook   = '';
		$this->react_editor_loader_handle = '';
		if ( '' !== $hook ) {
			remove_action( $hook, array( $this, 'render_react_editor_loader' ), 0 );
		}

		if ( '' === $handle ) {
			return;
		}

		if ( ! wp_script_is( $handle, 'registered' ) || ! wp_script_is( $handle, 'enqueued' ) ) {
			$this->react_editor_asset_error = true;
			wp_trigger_error(
				__METHOD__,
				'EasyMDE React editor loader could not be printed (react-editor-loader-not-enqueued).',
				E_USER_WARNING
			);

			return;
		}

		wp_print_scripts( array( $handle ) );
		if ( wp_script_is( $handle, 'done' ) ) {
			return;
		}

		$this->react_editor_asset_error = true;
		wp_trigger_error(
			__METHOD__,
			'EasyMDE React editor loader could not be printed (react-editor-loader-print-failed).',
			E_USER_WARNING
		);
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
			'easymde-admin-message-alert',
			Asset::url( 'assets/css/admin/message-alert.css' ),
			array(),
			$this->get_static_asset_version( 'assets/css/admin/message-alert.css' )
		);
		wp_enqueue_style(
			'easymde-admin',
			Asset::url( 'assets/css/admin/editor.css' ),
			array( 'easymde-admin-toolbar', 'easymde-admin-popover', 'easymde-admin-message-alert' ),
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

		$react_editor_assets = $this->enqueue_react_editor_asset();
		if ( $react_editor_assets ) {
			try {
				$root_bootstrap = $this->get_editor_root_bootstrap(
					$post_id,
					$screen->post_type,
					'post-new.php' === $hook
				);
			} catch ( \Throwable $error ) {
				if ( SettingsCenterRepository::CONFIGURATION_ERROR_CODE === $error->getMessage() ) {
					$root_bootstrap = null;
				} elseif ( ! FrontendAssetContract::is_error( $error ) ) {
					throw $error;
				} else {
					wp_dequeue_script( $react_editor_assets['loader']['handle'] );
					$this->react_editor_asset_error = true;
					wp_trigger_error(
						__METHOD__,
						'EasyMDE frontend enhancement asset contract failed (' . FrontendAssetContract::error_code( $error ) . ').',
						E_USER_WARNING
					);

					return;
				}
			}

			wp_add_inline_script(
				$react_editor_assets['loader']['handle'],
				'window.EasyMDEAdminEditorLoaderBootstrap = ' . wp_json_encode(
					array(
						'editorBootstrap' => $root_bootstrap,
						'failureMessage'  => __( 'The EasyMDE editor could not start. Your WordPress fields remain available.', 'easymde' ),
						'mainScriptUrl'   => esc_url_raw( Asset::url( $react_editor_assets['main']['path'] ) ),
					),
					JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT
				) . ';',
				'before'
			);

			$this->react_editor_loader_hook   = 'admin_print_scripts-' . $hook;
			$this->react_editor_loader_handle = $react_editor_assets['loader']['handle'];
			add_action( $this->react_editor_loader_hook, array( $this, 'render_react_editor_loader' ), 0 );
			$this->react_editor_preload_hook = 'admin_print_styles-' . $hook;
			$this->react_editor_preload_url  = Asset::url( $react_editor_assets['main']['path'] );
			add_action( $this->react_editor_preload_hook, array( $this, 'render_react_editor_preload' ), 0 );
		}
	}

	private function enqueue_react_editor_asset( $build_dir = '' ) {
		try {
			$assets = array(
				'loader' => $this->get_react_editor_loader_asset(),
				'main'   => $this->get_react_editor_asset( $build_dir ),
			);
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
			$assets['loader']['handle'],
			Asset::url( $assets['loader']['path'] ),
			$assets['loader']['dependencies'],
			$assets['loader']['version'],
			false
		);

		if ( ! wp_set_script_translations( $assets['loader']['handle'], 'easymde', Asset::path( 'languages' ) ) ) {
			wp_dequeue_script( $assets['loader']['handle'] );
			$this->react_editor_asset_error = true;
			wp_trigger_error(
				__METHOD__,
				'EasyMDE React editor translations failed to load (react-editor-translations-invalid).',
				E_USER_WARNING
			);

			return false;
		}

		return $assets;
	}

	private static function reference_label_case_fold_profile( $php_version_id, $mbstring_available ) {
		if ( ! $mbstring_available ) {
			return 'unsupported';
		}
		if ( $php_version_id >= 70400 && $php_version_id < 70500 ) {
			return 11;
		}
		if ( $php_version_id >= 80000 && $php_version_id < 80100 ) {
			return 13;
		}
		if ( $php_version_id >= 80100 && $php_version_id < 80400 ) {
			return 14;
		}
		if ( $php_version_id >= 80400 && $php_version_id < 80500 ) {
			return 16;
		}
		if ( $php_version_id >= 80500 && $php_version_id < 80600 ) {
			return 17;
		}
		return 'unsupported';
	}

	private function get_editor_root_bootstrap( $post_id, $post_type = '', $is_new_post = false ) {
		$nonce                             = wp_create_nonce( 'wp_rest' );
		$strings                           = $this->get_strings();
		$storage                           = $this->get_storage_config( $post_id );
		$theme_options                     = $this->theme_state_repository->get_theme_options_for_script( $post_id );
		$theme_state                       = $theme_options['state'];
		$custom_css                        = $theme_options['customCss'];
		$post_type                         = $post_type ? sanitize_key( $post_type ) : get_post_type( $post_id );
		$can_use_media                     = $this->can_use_media_picker( $post_id, $post_type, $is_new_post );
		$wechat_math_atlas_content_version = $this->get_static_asset_version( 'assets/math/easymde-katex-glyph-atlas.json' );
		$wechat_math_atlas_url             = add_query_arg(
			'contentversion',
			$wechat_math_atlas_content_version,
			Asset::url( 'assets/math/easymde-katex-glyph-atlas.json' )
		);

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

		$preview_assets                = $this->frontend_assets->get_editor_preview_assets();
		$editor_block_index_worker_url = $this->frontend_assets->get_editor_block_index_worker_url();
		$settings                      = $this->settings_center_repository->get_settings();
		$image_upload_config           = $this->get_image_upload_config( $settings );
		$image_hosting_enabled         = isset( $settings['images']['imageHostingEnabled'] ) && true === $settings['images']['imageHostingEnabled'];
		$allowed_image_extensions      = ImageUploadExtensionPolicy::enabled( $settings['images']['uploadFormats'] );
		$allowed_image_mime_types      = $this->get_allowed_editor_image_mime_types( $settings['images']['uploadFormats'] );
		$code_themes                   = array_map(
			static function ( $theme ) {
				return array(
					'id'     => $theme['id'],
					'cssUrl' => $theme['cssUrl'],
				);
			},
			$theme_options['codeThemes']
		);
		return array(
			'schemaVersion'                 => 3,
			'referenceLabelCaseFoldProfile' => self::reference_label_case_fold_profile(
				PHP_VERSION_ID,
				extension_loaded( 'mbstring' ) && function_exists( 'mb_convert_case' ) && defined( 'MB_CASE_FOLD' )
			),
			'editorBlockIndexWorkerUrl'     => $editor_block_index_worker_url,
			'shortcodeHelpers'              => $this->toolbar_registry->get_shortcode_helpers_for_script(),
			'document'                      => array(
				'strings' => array( 'editorLabel' => $strings['editorLabel'] ),
			),
			'appearance'                    => array(
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
			'fonts'                         => array(
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
			'imageUpload'                   => array(
				'allowedMimeTypes'       => $allowed_image_mime_types,
				'allowedExtensions'      => $allowed_image_extensions,
				'autoUploadPastedImages' => $settings['images']['autoUploadPastedImages'],
				'enabled'                => $image_upload_config['enabled'] && ! empty( $allowed_image_extensions ),
				'endpoint'               => esc_url_raw( rest_url( $image_hosting_enabled ? 'easymde/v1/image-hosting/upload' : 'easymde/v1/media' ) ),
				'importEndpoint'         => esc_url_raw( rest_url( 'easymde/v1/image-hosting/import' ) ),
				'insertion'              => array(
					'titleDisplay' => $settings['images']['titleDisplay'],
				),
				'maxBytes'               => $image_upload_config['maxBytes'],
				'remoteImageUploadMode'  => $image_hosting_enabled ? $settings['images']['remoteImageUploadMode'] : 'off',
				'uploadOwner'            => $image_hosting_enabled ? 'image-hosting' : 'media',
				'nonce'                  => $nonce,
				'actionNonce'            => wp_create_nonce( 'easymde_upload_image_hosting' ),
				'postId'                 => absint( $post_id ),
				'strings'                => array(
					'defaultAlt'          => $strings['mediaDefaultAlt'],
					'dropFailed'          => $strings['imageDropFailed'],
					'dropTooLarge'        => $strings['imageDropTooLarge'],
					'dropUploaded'        => $strings['imageDropUploaded'],
					'dropUploading'       => $strings['imageDropUploading'],
					'pasteAlreadyHosted'  => __( 'Pasted image already uses the current image host.', 'easymde' ),
					'pasteChecking'       => __( 'Checking pasted image...', 'easymde' ),
					'pasteFailed'         => $strings['imagePasteFailed'],
					'pasteUploadDisabled' => __( 'Pasted image upload is disabled. Use Insert Image to upload a file.', 'easymde' ),
					'pasteTooLarge'       => $strings['imagePasteTooLarge'],
					'pasteUploaded'       => $strings['imagePasteUploaded'],
					'pasteUploading'      => $strings['imagePasteUploading'],
				),
			),
			'settings'                      => array(
				'general'  => $settings['general'],
				'markdown' => array(
					'wordWrap' => $settings['markdown']['wordWrap'],
				),
			),
			'layout'                        => array(
				'direction' => is_rtl() ? 'rtl' : 'ltr',
				'status'    => array(
					'lastEdited' => $this->get_last_edited_label( $post_id ),
					'wordCount'  => $strings['wordCount'],
				),
			),
			'localDrafts'                   => array(
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
			'mediaPicker'                   => array(
				'canUseMedia'    => $can_use_media,
				'defaultAlt'     => $strings['mediaDefaultAlt'],
				'frameUrl'       => $can_use_media ? MediaPickerPage::get_url( $post_id, $post_type ) : '',
				'insertMedia'    => $strings['insertMedia'],
				'insertion'      => array(
					'titleDisplay' => $settings['images']['titleDisplay'],
				),
				'placeholderAlt' => $strings['mediaAltText'],
			),
			'preview'                       => array(
				'features'  => (object) array(),
				'html'      => '',
				'messages'  => array(
					'empty'   => $strings['previewEmpty'],
					'error'   => $strings['previewError'],
					'loading' => $strings['previewLoading'],
				),
				'postId'    => absint( $post_id ),
				'signature' => '',
			),
			'previewEnhancement'            => array(
				'assetBaseUrl' => Asset::url( '' ),
				'assets'       => $preview_assets,
				'codeThemes'   => $code_themes,
				'strings'      => array( 'renderingFailed' => $strings['renderingFailed'] ),
			),
			'toolbar'                       => array(
				'commands'  => $this->toolbar_registry->get_commands_for_script(),
				'shortcuts' => $this->settings_center_repository->get_shortcut_config_for_script(),
				'strings'   => array(
					'headingLabelFormat' => $strings['headingLabelFormat'],
					'headingLevel'       => $strings['headingLevel'],
					'headings'           => $strings['headings'],
					'linkText'           => $strings['linkText'],
					'undo'               => $strings['undo'],
				),
			),
			'wechatExport'                  => array(
				'enabled'                       => true,
				'pngConversionEnabled'          => $settings['images']['wechatPngExportEnabled'],
				'wechatMathAtlasContentVersion' => $wechat_math_atlas_content_version,
				'wechatMathAtlasUrl'            => esc_url_raw( $wechat_math_atlas_url ),
				'strings'                       => array(
					'failed'            => $strings['copyWechatFailed'],
					'failedWithUploads' => $strings['copyWechatFailedWithUploads'],
					'success'           => $strings['copyWechatSuccess'],
					'unsupported'       => $strings['copyWechatUnsupported'],
				),
			),
			'strings'                       => array(
				'contextMenu'        => AdminEditorStrings::get_context_menu_strings( $strings ),
				'immersive'          => AdminEditorStrings::get_immersive_strings( $image_upload_config['maxBytes'] ),
				'mediaPickerFailure' => $strings['mediaPickerFailed'],
				'preview'            => __( 'Preview', 'easymde' ),
				'source'             => __( 'Markdown', 'easymde' ),
				'toolbar'            => $strings['markdownToolbar'],
			),
			'wordpress'                     => array(
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
			array( 'wp-api-fetch', 'wp-element', 'wp-hooks', 'wp-i18n' ),
			'admin-editor',
			true,
			'react-editor-',
			'#^assets/wechat-png-encoder-[A-Za-z0-9_-]+\.js$#'
		);
	}

	private function get_react_editor_loader_asset( $build_dir = '' ) {
		$build_dir = $build_dir ? trailingslashit( $build_dir ) . 'admin-editor-loader/' : 'assets/build/admin-editor-loader/';

		return ManifestAssetResolver::resolve(
			'frontend/src/entrypoints/admin-editor-loader.ts',
			$build_dir,
			'easymde-admin-editor-toolbar',
			array( 'wp-api-fetch', 'wp-element', 'wp-hooks', 'wp-i18n' ),
			'admin-editor-loader',
			true,
			'react-editor-loader-'
		);
	}

	private function get_post_id() {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only post ID is used only to localize editor assets.
		return isset( $_GET['post'] ) ? absint( wp_unslash( $_GET['post'] ) ) : 0;
	}

	private function can_use_media_picker( $post_id, $post_type, $is_new_post = false ) {
		if ( ! current_user_can( 'upload_files' ) ) {
			return false;
		}

		$post_id   = absint( $post_id );
		$post_type = sanitize_key( (string) $post_type );

		if ( $post_id > 0 ) {
			return $this->post_mode_controller->is_easymde_editable_post( $post_id, $post_type );
		}

		if ( ! $is_new_post || '' === $post_type || ! $this->post_mode_controller->is_new_easymde_request( $post_type ) ) {
			return false;
		}

		return true;
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

	private function get_image_upload_config( array $settings = array() ) {
		$max_bytes = empty( $settings )
			? $this->settings_center_repository->get_effective_image_upload_max_bytes()
			: min( $settings['images']['maxImageSizeMb'] * MB_IN_BYTES, (int) wp_max_upload_size(), 10 * MB_IN_BYTES );

		return array(
			'enabled'  => current_user_can( 'upload_files' ),
			'maxBytes' => $max_bytes,
		);
	}

	private function get_allowed_editor_image_mime_types( $formats = null ) {
		$configured = null === $formats
			? $this->settings_center_repository->get_allowed_image_mime_types()
			: ImageUploadExtensionPolicy::mime_types( $formats );
		$wordpress  = array_values( get_allowed_mime_types() );

		return array_values( array_intersect( $configured, $wordpress ) );
	}

	private function get_custom_css_variables() {
		return AdminEditorStrings::get_custom_css_variables();
	}

	private function get_custom_css_dialog_strings() {
		return AdminEditorStrings::get_custom_css_dialog_strings();
	}

	private function get_strings() {
		return AdminEditorStrings::get_strings();
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
