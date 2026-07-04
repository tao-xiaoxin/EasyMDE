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
			EASYMDE_VERSION
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
			EASYMDE_VERSION
		);

		$this->frontend_assets->enqueue_editor_base_assets( $post_id );

		wp_enqueue_script(
			'easymde-editor-state',
			Asset::url( 'assets/js/admin/editor-state.js' ),
			array(),
			EASYMDE_VERSION,
			true
		);

		wp_enqueue_script(
			'easymde-commands',
			Asset::url( 'assets/js/admin/commands.js' ),
			array( 'easymde-editor-state' ),
			EASYMDE_VERSION,
			true
		);

		wp_enqueue_script(
			'easymde-preview-client',
			Asset::url( 'assets/js/admin/preview-client.js' ),
			array( 'easymde-editor-state' ),
			EASYMDE_VERSION,
			true
		);

		wp_enqueue_script(
			'easymde-preview-feature-loader',
			Asset::url( 'assets/js/admin/preview-feature-loader.js' ),
			array(),
			EASYMDE_VERSION,
			true
		);

		wp_enqueue_script(
			'easymde-theme-manager',
			Asset::url( 'assets/js/admin/theme-manager.js' ),
			array( 'easymde-editor-state' ),
			EASYMDE_VERSION,
			true
		);

		wp_enqueue_script(
			'easymde-toolbar',
			Asset::url( 'assets/js/admin/toolbar.js' ),
			array( 'jquery', 'easymde-commands' ),
			EASYMDE_VERSION,
			true
		);

		wp_enqueue_script(
			'easymde-draft-storage',
			Asset::url( 'assets/js/admin/draft-storage.js' ),
			array(),
			EASYMDE_VERSION,
			true
		);

		wp_enqueue_script(
			'easymde-media-picker',
			Asset::url( 'assets/js/admin/media-picker.js' ),
			array(),
			EASYMDE_VERSION,
			true
		);

		wp_enqueue_script(
			'easymde-image-paste',
			Asset::url( 'assets/js/admin/image-paste.js' ),
			array( 'wp-api-fetch' ),
			EASYMDE_VERSION,
			true
		);

		wp_enqueue_script(
			'easymde-wechat-exporter',
			Asset::url( 'assets/js/admin/wechat-exporter.js' ),
			array(),
			EASYMDE_VERSION,
			true
		);

		wp_enqueue_script(
			'easymde-admin',
			Asset::url( 'assets/js/admin/bootstrap.js' ),
			array(
				'jquery',
				'wp-api-fetch',
				'easymde-enhancements',
				'easymde-editor-state',
				'easymde-commands',
				'easymde-preview-client',
				'easymde-preview-feature-loader',
				'easymde-theme-manager',
				'easymde-toolbar',
				'easymde-draft-storage',
				'easymde-media-picker',
				'easymde-image-paste',
				'easymde-wechat-exporter',
			),
			EASYMDE_VERSION,
			true
		);

		wp_enqueue_media();

		wp_localize_script(
			'easymde-admin',
			'EasyMDEConfig',
			array(
				'restUrl'          => esc_url_raw( rest_url( 'easymde/v1/preview' ) ),
				'nonce'            => wp_create_nonce( 'wp_rest' ),
				'features'         => $this->frontend_assets->get_feature_config( '' ),
				'previewAssets'    => $this->frontend_assets->get_editor_preview_assets(),
				'storage'          => $this->get_storage_config( $post_id ),
				'themeOptionsUrl'  => esc_url_raw( rest_url( 'easymde/v1/theme-options' ) ),
				'customCssUrl'     => esc_url_raw( rest_url( 'easymde/v1/custom-css' ) ),
				'imageUploadUrl'   => esc_url_raw( rest_url( 'easymde/v1/media' ) ),
				'imageUpload'      => $this->get_image_upload_config(),
				'themeOptions'     => $this->theme_state_repository->get_theme_options_for_script( $post_id ),
				'commands'         => $this->toolbar_registry->get_commands_for_script(),
				'shortcuts'        => $this->settings_page->get_shortcut_config_for_script(),
				'editorSettings'   => $this->settings_page->get_editor_settings(),
				'copy'             => array(
					'mode' => 'wechat-rich-text',
				),
				'shortcodeHelpers' => $this->toolbar_registry->get_shortcode_helpers_for_script(),
				'strings'          => $this->get_strings(),
			)
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
			'siteKey'  => $site_key,
			'userId'   => $user_id,
			'postId'   => $post_id,
			'draftKey' => 'easymde:draft:' . $site_key . ':' . $user_id . ':' . $post_key,
			'themeKey' => 'easymde:theme:' . $site_key . ':' . $user_id,
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
			'previewLabel'          => __( 'Live preview', 'easymde' ),
			'previewEmpty'          => __( 'Start writing Markdown to preview the article.', 'easymde' ),
			'previewRendering'      => __( 'Rendering preview...', 'easymde' ),
			'previewError'          => __( 'Preview failed. Please keep writing; saving is not affected.', 'easymde' ),
			'insertMedia'           => __( 'Insert Media', 'easymde' ),
			'enterImmersive'        => __( 'Enter immersive writing', 'easymde' ),
			'exitImmersive'         => __( 'Exit immersive writing', 'easymde' ),
			'darkMode'              => __( 'Dark mode', 'easymde' ),
			'lightMode'             => __( 'Light mode', 'easymde' ),
			'appearance'            => __( 'Appearance', 'easymde' ),
			'font'                  => __( 'Font', 'easymde' ),
			'headings'              => __( 'Headings', 'easymde' ),
			'articleTheme'          => __( 'Article theme', 'easymde' ),
			'codeTheme'             => __( 'Code theme', 'easymde' ),
			'macCodeFrame'          => __( 'Mac code frame', 'easymde' ),
			'customCss'             => __( 'Custom CSS', 'easymde' ),
			'namedCustomCss'        => __( 'Named custom CSS', 'easymde' ),
			'cssName'               => __( 'CSS name', 'easymde' ),
			'saveCss'               => __( 'Save CSS', 'easymde' ),
			'cssSaved'              => __( 'Saved CSS.', 'easymde' ),
			'cssSaveFailed'         => __( 'CSS save failed.', 'easymde' ),
			'noCustomCss'           => __( 'No custom CSS saved yet.', 'easymde' ),
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
			'renderingFailed'       => __( 'Rendering failed.', 'easymde' ),
			'copyWechat'            => __( 'Copy to WeChat', 'easymde' ),
			'copyWechatTitle'       => __( 'Copy preview for WeChat', 'easymde' ),
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
			'linkText'              => __( 'link text', 'easymde' ),
		);
	}
}
