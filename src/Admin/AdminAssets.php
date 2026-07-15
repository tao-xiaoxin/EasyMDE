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
	private $category_load_error = '';

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
		$uploads = wp_upload_dir();

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
		wp_enqueue_style(
			'easymde-immersive-workspace',
			Asset::url( 'assets/css/admin/immersive-workspace.css' ),
			array(),
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
			'easymde-immersive-workspace',
			Asset::url( 'assets/js/admin/immersive-workspace.js' ),
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
				'easymde-immersive-workspace',
			),
			EASYMDE_VERSION,
			true
		);

		wp_enqueue_media();
		$category_options = $this->get_category_options( $screen->post_type, $post_id );

		wp_localize_script(
			'easymde-admin',
			'EasyMDEConfig',
			array(
				'restUrl'                 => esc_url_raw( rest_url( 'easymde/v1/preview' ) ),
				'nonce'                   => wp_create_nonce( 'wp_rest' ),
				'features'                => $this->frontend_assets->get_feature_config( '' ),
				'previewAssets'           => $this->frontend_assets->get_editor_preview_assets(),
				'storage'                 => $this->get_storage_config( $post_id ),
				'themeOptionsUrl'         => esc_url_raw( rest_url( 'easymde/v1/theme-options' ) ),
				'customCssUrl'            => esc_url_raw( rest_url( 'easymde/v1/custom-css' ) ),
				'customCssPreviewUrl'     => esc_url_raw( rest_url( 'easymde/v1/custom-css/preview' ) ),
				'imageUploadUrl'          => esc_url_raw( rest_url( 'easymde/v1/media' ) ),
				'uploadsBaseUrl'          => empty( $uploads['error'] ) ? esc_url_raw( $uploads['baseurl'] ) : '',
				'mediaPickerScriptUrl'    => esc_url_raw( add_query_arg( 'ver', EASYMDE_VERSION, Asset::url( 'assets/js/admin/media-picker.js' ) ) ),
				'imagePasteScriptUrl'     => esc_url_raw( add_query_arg( 'ver', EASYMDE_VERSION, Asset::url( 'assets/js/admin/image-paste.js' ) ) ),
				'wechatExporterScriptUrl' => esc_url_raw( add_query_arg( 'ver', EASYMDE_VERSION, Asset::url( 'assets/js/admin/wechat-exporter.js' ) ) ),
				'visualModelScriptUrl'    => esc_url_raw( add_query_arg( 'ver', EASYMDE_VERSION, Asset::url( 'assets/js/admin/visual-markdown-model.js' ) ) ),
				'visualAdapterScriptUrl'  => esc_url_raw( add_query_arg( 'ver', EASYMDE_VERSION, Asset::url( 'assets/js/admin/visual-editor-adapter.js' ) ) ),
				'imageUpload'             => $this->get_image_upload_config(),
				'themeOptions'            => $this->theme_state_repository->get_theme_options_for_script( $post_id ),
				'commands'                => $this->toolbar_registry->get_commands_for_script(),
				'shortcuts'               => $this->settings_page->get_shortcut_config_for_script(),
				'editorSettings'          => $this->settings_page->get_editor_settings(),
				'categoryOptions'         => $category_options,
				'categoryLoadError'       => $this->category_load_error,
				'copy'                    => array(
					'mode' => 'wechat-rich-text',
				),
				'shortcodeHelpers'        => $this->toolbar_registry->get_shortcode_helpers_for_script(),
				'strings'                 => $this->get_strings(),
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
			'siteKey'   => $site_key,
			'userId'    => $user_id,
			'postId'    => $post_id,
			'draftKey'  => 'easymde:draft:' . $site_key . ':' . $user_id . ':' . $post_key,
			'layoutKey' => 'easymde:immersive-layout:' . $site_key . ':' . $user_id,
		);
	}

	private function get_image_upload_config() {
		return array(
			'enabled'  => current_user_can( 'upload_files' ),
			'maxBytes' => min( 10485760, (int) wp_max_upload_size() ),
		);
	}

	/**
	 * Return the native category hierarchy used by the immersive publish panel.
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
			$this->category_load_error = sprintf(
				/* translators: %s is the WordPress taxonomy error message. */
				__( 'EasyMDE could not load WordPress categories: %s', 'easymde' ),
				$terms->get_error_message()
			);
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
		 * Filters the context used to cache immersive category options.
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
			'editorLabel'                   => __( 'Markdown source', 'easymde' ),
			'previewLabel'                  => __( 'Live preview', 'easymde' ),
			'previewEmpty'                  => __( 'Start writing Markdown to preview the article.', 'easymde' ),
			'previewRendering'              => __( 'Rendering preview...', 'easymde' ),
			'previewError'                  => __( 'Preview failed. Please keep writing; saving is not affected.', 'easymde' ),
			'insertMedia'                   => __( 'Insert Media', 'easymde' ),
			'enterImmersive'                => __( 'Enter immersive writing', 'easymde' ),
			'exitImmersive'                 => __( 'Exit immersive writing', 'easymde' ),
			'immersiveModeTitle'            => __( 'Immersive writing', 'easymde' ),
			'workspaceLabel'                => __( 'EasyMDE immersive writing workspace', 'easymde' ),
			'postTitle'                     => __( 'Post title', 'easymde' ),
			'postTitlePlaceholder'          => __( 'Article title...', 'easymde' ),
			'editorActions'                 => __( 'Editor actions', 'easymde' ),
			'viewMode'                      => __( 'View mode', 'easymde' ),
			'editMode'                      => __( 'Edit', 'easymde' ),
			'editModeTitle'                 => __( 'Edit mode', 'easymde' ),
			'splitMode'                     => __( 'Split', 'easymde' ),
			'splitModeTitle'                => __( 'Split mode', 'easymde' ),
			'previewMode'                   => __( 'Preview', 'easymde' ),
			'previewModeTitle'              => __( 'Preview mode', 'easymde' ),
			'previewEditable'               => __( 'Editable', 'easymde' ),
			'previewReadOnly'               => __( 'Read-only', 'easymde' ),
			'previewEditableTitle'          => __( 'Lock visual editing', 'easymde' ),
			'previewReadOnlyTitle'          => __( 'Unlock visual editing', 'easymde' ),
			'visualEditorLabel'             => __( 'Structured visual Markdown editor', 'easymde' ),
			'visualEditorEmpty'             => __( 'Start writing Markdown...', 'easymde' ),
			'visualEditorUnavailable'       => __( 'Visual Markdown editing could not be loaded. The Markdown source was not changed.', 'easymde' ),
			'editInMarkdown'                => __( 'Edit in Markdown', 'easymde' ),
			'codeLanguage'                  => __( 'Code language', 'easymde' ),
			'linkUrl'                       => __( 'Link URL', 'easymde' ),
			'toolbarCompositionUnavailable' => __( 'Formatting is unavailable during text composition.', 'easymde' ),
			'toolbarReadOnlyUnavailable'    => __( 'Formatting is unavailable while the Markdown source is read-only.', 'easymde' ),
			'toolbarUndoUnavailable'        => __( 'The browser could not create an undoable Markdown edit.', 'easymde' ),
			'history'                       => __( 'History', 'easymde' ),
			'historyShort'                  => __( 'History', 'easymde' ),
			'historyVersions'               => __( 'Version history', 'easymde' ),
			/* translators: %d is the number of available WordPress revisions. */
			'historyCount'                  => __( '%d revisions', 'easymde' ),
			'historyFilterAll'              => __( 'All', 'easymde' ),
			'historyAutoSave'               => __( 'Auto save', 'easymde' ),
			'historyManualSave'             => __( 'Manual save', 'easymde' ),
			'historyRestore'                => __( 'Restore this version', 'easymde' ),
			'historyJustNow'                => __( 'Just now', 'easymde' ),
			'loadingHistoryPreview'         => __( 'Loading revision preview...', 'easymde' ),
			'historyPreviewFailed'          => __( 'Revision preview could not be loaded.', 'easymde' ),
			'historyHelp'                   => __( 'WordPress revisions for this article', 'easymde' ),
			'loadingHistory'                => __( 'Loading revisions...', 'easymde' ),
			'noRevisions'                   => __( 'No revisions are available yet.', 'easymde' ),
			'untitledRevision'              => __( 'Untitled revision', 'easymde' ),
			'historyFailed'                 => __( 'Revision history could not be loaded.', 'easymde' ),
			'copyMarkdown'                  => __( 'Copy Markdown', 'easymde' ),
			'moreActions'                   => __( 'More actions', 'easymde' ),
			'sourcePlaceholder'             => __( 'Start writing...', 'easymde' ),
			'untitled'                      => __( 'Untitled', 'easymde' ),
			'aiAssistant'                   => __( 'AI Assistant', 'easymde' ),
			'aiSupportStatus'               => __( 'Ready to support your writing anytime', 'easymde' ),
			'aiPin'                         => __( 'Pin AI Assistant', 'easymde' ),
			'aiUnpin'                       => __( 'Unpin AI Assistant', 'easymde' ),
			'aiSettingsUnavailableTitle'    => __( 'Settings are not available yet', 'easymde' ),
			'aiSettingsUnavailable'         => __( 'AI settings are not available yet', 'easymde' ),
			'closeAiAssistant'              => __( 'Close AI Assistant', 'easymde' ),
			'aiPartnerHelp'                 => __( 'Start with a clear goal. You can add the remaining details during the conversation.', 'easymde' ),
			'aiStartCreating'               => __( 'Start creating', 'easymde' ),
			'aiAgentGreeting'               => __( 'Hi! I am your all-purpose writing assistant. Tell me your idea in one sentence and I will help you start a new article.', 'easymde' ),
			'aiNextSteps'                   => __( 'Next you can:', 'easymde' ),
			'aiSuggestionOutline'           => __( 'Generate an article outline and title', 'easymde' ),
			'aiSuggestionIntroduction'      => __( 'Write an introduction and background', 'easymde' ),
			'aiSuggestionConcepts'          => __( 'Explain the core concepts', 'easymde' ),
			'aiSuggestionOutlineHelp'       => __( 'Quickly generate a clear outline and engaging titles', 'easymde' ),
			'aiSuggestionIntroductionHelp'  => __( 'Write an introduction or add background information', 'easymde' ),
			'aiSuggestionConceptsHelp'      => __( 'Explain and expand key concepts concisely', 'easymde' ),
			'aiQuickActions'                => __( 'Quick actions', 'easymde' ),
			'aiAddContext'                  => __( 'Add context', 'easymde' ),
			'add'                           => __( 'Add', 'easymde' ),
			'aiUploadAttachment'            => __( 'Upload a file or attachment', 'easymde' ),
			'skills'                        => __( 'Skills', 'easymde' ),
			'aiAssistantMode'               => __( 'Assistant mode', 'easymde' ),
			'aiGenerationSettings'          => __( 'Generation settings', 'easymde' ),
			'model'                         => __( 'Model', 'easymde' ),
			'aiThinkingLength'              => __( 'Thinking length', 'easymde' ),
			'aiSelectModel'                 => __( 'Select model', 'easymde' ),
			'aiDisclaimer'                  => __( 'AI-generated content is for reference only', 'easymde' ),
			'aiChatGreeting'                => __( 'Hi! I am your creative partner. Ask me for research, outlines, or inspiration. This local demo never changes your article.', 'easymde' ),
			'aiHotTopics'                   => __( 'Trending creative topics', 'easymde' ),
			'aiRefreshTopics'               => __( 'Refresh', 'easymde' ),
			'aiWritingPlaceholder'          => __( 'Describe what you want to create...', 'easymde' ),
			'aiModelReasoning'              => __( 'Deep reasoning (R1)', 'easymde' ),
			'aiSmartLayout'                 => __( 'Smart layout', 'easymde' ),
			'aiOptimizeArticle'             => __( 'Optimize article', 'easymde' ),
			'aiExtractSummary'              => __( 'Extract summary', 'easymde' ),
			'aiGenerateOutline'             => __( 'Generate outline', 'easymde' ),
			'aiGenerateCode'                => __( 'Generate code', 'easymde' ),
			'aiAcademicSearch'              => __( 'Academic search', 'easymde' ),
			'aiTopicTypora'                 => __( 'Typora plugin development guide: build an IDE-like writing environment', 'easymde' ),
			'aiTopicGitOps'                 => __( 'Cursor + GitOps: a new approach to automated operations', 'easymde' ),
			'aiTopicToolchain'              => __( 'My 2026 AI-assisted development toolchain', 'easymde' ),
			'aiTopicDeepSeek'               => __( 'Complete guide to local DeepSeek deployment', 'easymde' ),
			'aiTopicKnowledgeBase'          => __( 'Build a personal knowledge base with the Claude API', 'easymde' ),
			'aiTopicMarkdownTools'          => __( 'Tools that improve Markdown writing efficiency tenfold', 'easymde' ),
			'aiDemoMessage'                 => __( 'This is a local interface preview. It is not connected to article data or a network service.', 'easymde' ),
			'aiDemoInput'                   => __( 'AI demo input', 'easymde' ),
			'aiDemoPlaceholder'             => __( 'Enter a demo question...', 'easymde' ),
			'aiDemoReply'                   => __( 'Thank you for your input! This is a demo interface. Once connected to an AI service, real writing suggestions will appear here.', 'easymde' ),
			'aiRemoveAttachment'            => __( 'Remove attachment', 'easymde' ),
			'send'                          => __( 'Send', 'easymde' ),
			'publishArticle'                => __( 'Publish article', 'easymde' ),
			/* translators: %s is the keyboard shortcut used to publish an article. */
			'publishArticleShortcut'        => sprintf( __( 'Publish article (%s)', 'easymde' ), '⌘↵' ),
			'updateArticle'                 => __( 'Update article', 'easymde' ),
			/* translators: %s is the keyboard shortcut used to update an article. */
			'updateArticleShortcut'         => sprintf( __( 'Update article (%s)', 'easymde' ), '⌘↵' ),
			'closePublishDialog'            => __( 'Close publish dialog', 'easymde' ),
			'publishArticleHelp'            => __( 'Confirm these settings to publish to the current WordPress site.', 'easymde' ),
			'updateArticleHelp'             => __( 'Confirm these settings to update the current WordPress article.', 'easymde' ),
			'readyToPublish'                => __( 'Ready to publish', 'easymde' ),
			'updateExistingArticle'         => __( 'Update existing article', 'easymde' ),
			'publishTags'                   => __( 'Tags', 'easymde' ),
			'publishTagsHelp'               => __( 'Press Enter or comma to add tags.', 'easymde' ),
			'publishTagPlaceholder'         => __( 'Add tags', 'easymde' ),
			'publishTagContinuePlaceholder' => __( 'Continue adding...', 'easymde' ),
			'removeTag'                     => __( 'Remove tag', 'easymde' ),
			'publishFeaturedImage'          => __( 'Featured image', 'easymde' ),
			'featuredLandscapeHelp'         => __( 'Landscape images work best', 'easymde' ),
			'featuredFormatsHelp'           => __( 'Supports JPG, PNG, and WebP up to 5MB', 'easymde' ),
			'replaceFeaturedImage'          => __( 'Replace', 'easymde' ),
			'publishVisibility'             => __( 'Visibility', 'easymde' ),
			'publishVisibilityPublic'       => __( 'Public', 'easymde' ),
			'publishVisibilityPassword'     => __( 'Password', 'easymde' ),
			'publishVisibilityPrivate'      => __( 'Private', 'easymde' ),
			'publishSticky'                 => __( 'Stick to the top of the front page', 'easymde' ),
			'publishPassword'               => __( 'Access password', 'easymde' ),
			'publishPasswordPlaceholder'    => __( 'Enter an access password', 'easymde' ),
			'publishPasswordRequired'       => __( 'Enter an access password before submitting.', 'easymde' ),
			'publishPrivateHelp'            => __( 'Only site administrators and editors can view this article.', 'easymde' ),
			'publishVisibilityUnavailable'  => __( 'WordPress visibility controls are unavailable. The article was not submitted.', 'easymde' ),
			'publishExcerpt'                => __( 'Summary', 'easymde' ),
			'publishAiSummary'              => __( 'Generate summary with AI', 'easymde' ),
			'publishExcerptPlaceholder'     => __( 'Write a short summary for search results, article lists, and sharing previews...', 'easymde' ),
			'publishCategories'             => __( 'Categories', 'easymde' ),
			'publishCategoriesHelp'         => __( 'Choose the sections this article belongs to.', 'easymde' ),
			/* translators: %d is the number of selected categories. */
			'publishCategoryCount'          => __( 'Selected %d', 'easymde' ),
			'publishOptions'                => __( 'Publish options', 'easymde' ),
			'publishPreviewAfter'           => __( 'Open preview after publishing', 'easymde' ),
			'openPreviewAfterUpdate'        => __( 'Open preview after updating', 'easymde' ),
			'publishPreviewHelp'            => __( 'Open the article preview in a new page after submission.', 'easymde' ),
			'publishZeroWriteHelp'          => __( 'Nothing is written to WordPress before submission.', 'easymde' ),
			'publishLoadingPreview'         => __( 'Loading preview...', 'easymde' ),
			'publishPreviewBlocked'         => __( 'The article was saved, but the preview window was blocked.', 'easymde' ),
			'selectFeaturedImage'           => __( 'Select featured image', 'easymde' ),
			'useFeaturedImage'              => __( 'Use featured image', 'easymde' ),
			'removeFeaturedImage'           => __( 'Remove', 'easymde' ),
			'noFeaturedImage'               => __( 'No featured image selected', 'easymde' ),
			'noCategories'                  => __( 'No categories are available for this post type.', 'easymde' ),
			'cancel'                        => __( 'Cancel', 'easymde' ),
			'close'                         => __( 'Close', 'easymde' ),
			'markdownToolbar'               => __( 'Markdown toolbar', 'easymde' ),
			'bold'                          => __( 'Bold', 'easymde' ),
			'boldShortcutTitle'             => __( 'Bold (Ctrl+B)', 'easymde' ),
			'italic'                        => __( 'Italic', 'easymde' ),
			'italicShortcutTitle'           => __( 'Italic (Ctrl+I)', 'easymde' ),
			'strikethrough'                 => __( 'Strikethrough', 'easymde' ),
			'quote'                         => __( 'Quote', 'easymde' ),
			'quoteTitle'                    => __( 'Blockquote', 'easymde' ),
			'unorderedList'                 => __( 'Unordered list', 'easymde' ),
			'orderedList'                   => __( 'Ordered list', 'easymde' ),
			'inlineCode'                    => __( 'Inline code', 'easymde' ),
			'codeFence'                     => __( 'Code fence', 'easymde' ),
			'link'                          => __( 'Link', 'easymde' ),
			'image'                         => __( 'Image', 'easymde' ),
			'table'                         => __( 'Table', 'easymde' ),
			'mobilePreview'                 => __( 'Mobile', 'easymde' ),
			'settings'                      => __( 'Settings', 'easymde' ),
			'editorSettings'                => __( 'Editor settings', 'easymde' ),
			'outline'                       => __( 'Outline', 'easymde' ),
			'closeOutline'                  => __( 'Close outline', 'easymde' ),
			'openOutline'                   => __( 'Open outline', 'easymde' ),
			'outlineSettings'               => __( 'Outline settings', 'easymde' ),
			'outlineHelp'                   => __( 'Show heading navigation', 'easymde' ),
			'noOutline'                     => __( 'No headings yet', 'easymde' ),
			'splitPreview'                  => __( 'Split preview', 'easymde' ),
			'splitPreviewHelp'              => __( 'Show source and preview', 'easymde' ),
			'syncScroll'                    => __( 'Sync scrolling', 'easymde' ),
			'syncScrollHelp'                => __( 'Link source and preview scrolling', 'easymde' ),
			'settingsOutline'               => __( 'Article outline', 'easymde' ),
			'settingsOutlineHelp'           => __( 'Show heading hierarchy navigation on the left', 'easymde' ),
			'settingsWordCount'             => __( 'Word count', 'easymde' ),
			'settingsWordCountHelp'         => __( 'Show words, characters, and reading time beside the article title', 'easymde' ),
			'settingsSplitPreview'          => __( 'Split preview', 'easymde' ),
			'settingsSplitPreviewHelp'      => __( 'Show the live preview area by default', 'easymde' ),
			'autoSave'                      => __( 'Auto save', 'easymde' ),
			'autoSaveHelp'                  => __( 'Automatically save local drafts', 'easymde' ),
			'settingsSyncScroll'            => __( 'Sync scrolling', 'easymde' ),
			'settingsSyncScrollHelp'        => __( 'Link the editor and preview areas', 'easymde' ),
			'settingsAiAutocomplete'        => __( 'AI autocomplete', 'easymde' ),
			'settingsAiAutocompleteHelp'    => __( 'AI autocomplete is not available yet', 'easymde' ),
			'lineColumn'                    => __( 'Line 1, Column 1', 'easymde' ),
			'line'                          => __( 'Line', 'easymde' ),
			'column'                        => __( 'Column', 'easymde' ),
			'localDraftsEnabled'            => __( 'Local drafts enabled', 'easymde' ),
			'statistics'                    => __( 'Writing statistics', 'easymde' ),
			'wordsShort'                    => __( 'words', 'easymde' ),
			'charactersShort'               => __( 'characters', 'easymde' ),
			'about'                         => __( 'about', 'easymde' ),
			'minutesShort'                  => __( 'min', 'easymde' ),
			'readingTime'                   => __( 'Reading time (minutes)', 'easymde' ),
			'lines'                         => __( 'Lines', 'easymde' ),
			'westernWords'                  => __( 'Western words', 'easymde' ),
			'cjkCharacters'                 => __( 'CJK characters', 'easymde' ),
			'totalCharacters'               => __( 'Total characters', 'easymde' ),
			'statisticsHelp'                => __( 'Reading time is estimated locally at 300 reading units per minute; each Western word and CJK character counts as one unit.', 'easymde' ),
			'appearance'                    => __( 'Appearance', 'easymde' ),
			'theme'                         => __( 'Theme', 'easymde' ),
			'themeTitle'                    => __( 'Switch theme', 'easymde' ),
			'font'                          => __( 'Font', 'easymde' ),
			'fontTitle'                     => __( 'Font settings', 'easymde' ),
			'headings'                      => __( 'Headings', 'easymde' ),
			'headingLevel'                  => __( 'Heading level', 'easymde' ),
			'articleTheme'                  => __( 'Article theme', 'easymde' ),
			'codeTheme'                     => __( 'Code theme', 'easymde' ),
			'macCodeFrame'                  => __( 'Mac code frame', 'easymde' ),
			'customCss'                     => __( 'Custom CSS', 'easymde' ),
			'customCssTheme'                => __( 'Custom CSS theme', 'easymde' ),
			'customCssThemeName'            => __( 'Theme name', 'easymde' ),
			'customCssCode'                 => __( 'CSS code', 'easymde' ),
			'customCssStylePreview'         => __( 'Style preview', 'easymde' ),
			'customCssNamePlaceholder'      => __( 'Enter theme name…', 'easymde' ),
			'customCssCodePlaceholder'      => __( '/* CSS styles */', 'easymde' ),
			'customCssSaveTheme'            => __( 'Save theme', 'easymde' ),
			'customCssSaved'                => __( 'Saved', 'easymde' ),
			'saved'                         => __( 'Saved', 'easymde' ),
			'customCssValidating'           => __( 'Checking CSS...', 'easymde' ),
			'customCssPreviewFailed'        => __( 'CSS preview failed.', 'easymde' ),
			'customCssDefaultName'          => __( 'My theme', 'easymde' ),
			'namedCustomCss'                => __( 'Named custom CSS', 'easymde' ),
			'cssName'                       => __( 'CSS name', 'easymde' ),
			'saveCss'                       => __( 'Save CSS', 'easymde' ),
			'cssSaved'                      => __( 'Saved CSS.', 'easymde' ),
			'cssSaveFailed'                 => __( 'CSS save failed.', 'easymde' ),
			'noCustomCss'                   => __( 'No custom CSS saved yet.', 'easymde' ),
			'customFont'                    => __( 'Custom font', 'easymde' ),
			'windowsFont'                   => __( 'Windows font', 'easymde' ),
			'appleFont'                     => __( 'Apple font', 'easymde' ),
			'serifFont'                     => __( 'Serif font', 'easymde' ),
			'fontStackHelp'                 => __( 'Fonts are applied in custom, Windows, Apple, and serif fallback order when supported by the current system.', 'easymde' ),
			'draftSaved'                    => __( 'Local draft saved', 'easymde' ),
			'draftAvailable'                => __( 'A newer local draft is available.', 'easymde' ),
			'restoreDraft'                  => __( 'Restore draft', 'easymde' ),
			'discardDraft'                  => __( 'Discard draft', 'easymde' ),
			'draftRestored'                 => __( 'Draft restored.', 'easymde' ),
			'draftDiscarded'                => __( 'Draft discarded.', 'easymde' ),
			'save'                          => __( 'Save', 'easymde' ),
			'renderingFailed'               => __( 'Rendering failed.', 'easymde' ),
			'featuredImageLookupFailed'     => __( 'The first local image could not be verified.', 'easymde' ),
			'featuredCandidateHelp'         => __( 'Suggested from the first verified local image. It is not selected yet.', 'easymde' ),
			'useFeaturedCandidate'          => __( 'Use first local image', 'easymde' ),
			'historyUnsavedConfirm'         => __( 'You have unsaved title or Markdown changes. Continue to revision history and leave these changes behind?', 'easymde' ),
			'copyWechat'                    => __( 'Copy to WeChat', 'easymde' ),
			'copyWechatTitle'               => __( 'Copy preview for WeChat', 'easymde' ),
			'copyWechatImmersiveTitle'      => __( 'Copy current preview content to WeChat', 'easymde' ),
			'copyWechatSuccess'             => __( 'Copied preview for WeChat.', 'easymde' ),
			'copyWechatFailed'              => __( 'Copy for WeChat failed. Please try again in this browser.', 'easymde' ),
			'copyWechatUnsupported'         => __( 'Clipboard access is not available in this browser.', 'easymde' ),
			'tableColumn'                   => __( 'Column ', 'easymde' ),
			'tableContent'                  => __( 'Content', 'easymde' ),
			'publishAiSummaryUnavailable'   => __( 'AI summary generation is not available yet', 'easymde' ),
			'insertTable'                   => __( 'Insert table', 'easymde' ),
			'tableRows'                     => __( 'Rows', 'easymde' ),
			'tableColumns'                  => __( 'Columns', 'easymde' ),
			'tableQuickSelect'              => __( 'Quick table size selection', 'easymde' ),
			'resizeOutline'                 => __( 'Resize outline', 'easymde' ),
			'copying'                       => __( 'Copying...', 'easymde' ),
			'copied'                        => __( 'Copied', 'easymde' ),
			'imagePasteUploading'           => __( 'Uploading pasted image...', 'easymde' ),
			'imagePasteUploaded'            => __( 'Pasted image uploaded.', 'easymde' ),
			'imagePasteFailed'              => __( 'Pasted image upload failed. Please use the media library instead.', 'easymde' ),
			'imagePasteTooLarge'            => __( 'Pasted image is too large for this site.', 'easymde' ),
			'imageDropUploading'            => __( 'Uploading dropped image...', 'easymde' ),
			'imageDropUploaded'             => __( 'Dropped image uploaded.', 'easymde' ),
			'imageDropFailed'               => __( 'Dropped image upload failed. Please use the media library instead.', 'easymde' ),
			'imageDropTooLarge'             => __( 'Dropped image is too large for this site.', 'easymde' ),
			'mediaAltText'                  => __( 'alt text', 'easymde' ),
			'mediaDefaultAlt'               => __( 'image', 'easymde' ),
			'mediaPickerFailed'             => __( 'The WordPress media library could not be opened.', 'easymde' ),
			'linkText'                      => __( 'link text', 'easymde' ),
		);
	}
}
