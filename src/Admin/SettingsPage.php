<?php

namespace EasyMDE\Admin;

use EasyMDE\Content\MarkdownRenderer;
use EasyMDE\Support\Asset;
use EasyMDE\Support\Options;
use EasyMDE\Support\ToolbarRegistry;
use EasyMDE\Support\SettingsCenterRepository;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class SettingsPage {

	private $toolbar_registry;
	private $options;
	private $settings_center_repository;

	public function __construct( ToolbarRegistry $toolbar_registry, Options $options, ?SettingsCenterRepository $settings_center_repository = null ) {
		$this->toolbar_registry           = $toolbar_registry;
		$this->options                    = $options;
		$this->settings_center_repository = $settings_center_repository ? $settings_center_repository : new SettingsCenterRepository( $options, $toolbar_registry );
	}

	public function register_hooks() {
		add_action( 'admin_init', array( $this, 'register_settings' ) );
		add_action( 'admin_menu', array( $this, 'register_admin_menu' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_assets' ) );
	}

	public function register_admin_menu() {
		add_menu_page(
			__( 'EasyMDE Settings Center', 'easymde' ),
			__( 'EasyMDE Settings', 'easymde' ),
			'manage_options',
			'easymde/settings/general',
			array( $this, 'render_settings_center' ),
			'dashicons-admin-settings',
			81
		);

		add_options_page(
			__( 'EasyMDE', 'easymde' ),
			__( 'EasyMDE', 'easymde' ),
			'manage_options',
			'easymde',
			array( $this, 'render' )
		);
	}

	public function register_settings() {
		register_setting(
			'easymde_settings',
			$this->options->editor_settings_key(),
			array(
				'type'              => 'array',
				'sanitize_callback' => array( $this, 'sanitize_editor_settings' ),
				'default'           => $this->get_editor_settings(),
			)
		);
	}

	public function enqueue_assets( $hook ) {
		if ( 'settings_page_easymde' === $hook ) {
			wp_enqueue_style(
				'easymde-admin-settings',
				Asset::url( 'assets/css/admin/settings.css' ),
				array(),
				EASYMDE_VERSION
			);

			return;
		}

		if ( 'toplevel_page_easymde/settings/general' !== $hook || ! current_user_can( 'manage_options' ) ) {
			return;
		}

		try {
			$asset       = $this->get_settings_center_asset();
			$css_version = $this->get_static_asset_version( 'assets/css/admin/settings-center.css' );
		} catch ( \Throwable $error ) {
			wp_trigger_error(
				__METHOD__,
				'EasyMDE settings center asset contract failed (settings-center-asset-invalid).',
				E_USER_WARNING
			);

			return;
		}

		wp_enqueue_style(
			'easymde-admin-settings-center',
			Asset::url( 'assets/css/admin/settings-center.css' ),
			array(),
			$css_version
		);
		wp_enqueue_script(
			$asset['handle'],
			Asset::url( $asset['path'] ),
			$asset['dependencies'],
			$asset['version'],
			true
		);
		wp_add_inline_script(
			$asset['handle'],
			'window.EasyMDESettingsCenterBootstrap = ' . wp_json_encode(
				$this->get_settings_center_bootstrap(),
				JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT
			) . ';',
			'before'
		);
	}

	public function render() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$context = array(
			'has_commonmark'       => MarkdownRenderer::is_available(),
			'settings'             => $this->get_editor_settings(),
			'commands'             => $this->toolbar_registry->get_command_registry(),
			'option_key'           => $this->options->editor_settings_key(),
			'settings_version'     => $this->options->editor_settings_version(),
			'supported_post_types' => apply_filters( 'easymde_supported_post_types', array( 'post', 'page' ) ),
		);

		require EASYMDE_PLUGIN_DIR . 'templates/admin/settings-page.php';
	}

	public function render_settings_center() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		require EASYMDE_PLUGIN_DIR . 'templates/admin/settings-center.php';
	}
	private function get_settings_center_bootstrap() {
		$settings = $this->settings_center_repository->get_settings();

		return array(
			'schemaVersion'   => 2,
			'closeUrl'        => admin_url( 'options-general.php?page=easymde' ),
			'api'             => array(
				'settingsUrl' => rest_url( 'easymde/v1/settings' ),
				'nonce'       => wp_create_nonce( 'wp_rest' ),
			),
			'assets'          => array(
				'brandMarkUrl'               => Asset::url( 'assets/images/settings-center/brand-icon-clean.png' ),
				'headerIllustrationUrl'      => Asset::url( 'assets/images/settings-center/header-illustration.png' ),
				'searchEmptyIllustrationUrl' => Asset::url( 'assets/images/settings-center/search-empty-illustration.png' ),
			),
			'drafts'          => array(
				'images' => array(
					'domain'       => $settings['images']['domain'],
					'backupDomain' => $settings['images']['backupDomain'],
				),
			),
			'defaultSettings' => $this->settings_center_repository->get_default_settings(),
			'settings'        => $settings,
			'strings'         => $this->get_settings_center_strings(),
		);
	}

	private function get_settings_center_strings() {
		return array(
			'brandName'                                    => __( 'EasyMDE', 'easymde' ),
			'settingsCenter'                               => __( 'Settings Center', 'easymde' ),
			'settingsNavigation'                           => __( 'Settings center navigation', 'easymde' ),
			'helpTitle'                                    => __( 'Help', 'easymde' ),
			'helpDescription'                              => __( 'Documentation, FAQs, and usage guides', 'easymde' ),
			'openDocumentation'                            => __( 'View documentation', 'easymde' ),
			'closeSettingsCenter'                          => __( 'Close settings center', 'easymde' ),
			'searchSettings'                               => __( 'Search all settings', 'easymde' ),
			'searchSettingsPlaceholder'                    => __( 'Search all plugin settings...', 'easymde' ),
			'clearSearch'                                  => __( 'Clear search', 'easymde' ),
			'searchPageTitle'                              => __( 'Search Settings', 'easymde' ),
			/* translators: %s: settings search query. */
			'searchPageDescription'                        => __( 'Only settings matching "%s" are shown.', 'easymde' ),
			'searchResults'                                => __( 'Search Results', 'easymde' ),
			/* translators: %s: settings search result count. */
			'searchResultCount'                            => __( '%s items', 'easymde' ),
			/* translators: %s: settings search query. */
			'noSearchResults'                              => __( 'No settings related to "%s" were found', 'easymde' ),
			'noSearchResultsDescription'                   => __( 'Try a setting name, feature keyword, or service name.', 'easymde' ),
			'general'                                      => __( 'General Settings', 'easymde' ),
			'shortcuts'                                    => __( 'Keyboard Shortcuts', 'easymde' ),
			'images'                                       => __( 'Image Hosting', 'easymde' ),
			'ai'                                           => __( 'AI Settings', 'easymde' ),
			'markdown'                                     => __( 'Markdown Settings', 'easymde' ),
			'sync'                                         => __( 'Article Sync', 'easymde' ),
			'transfer'                                     => __( 'Import / Export', 'easymde' ),
			'about'                                        => __( 'About Us', 'easymde' ),
			'generalDescription'                           => __( 'Configure EasyMDE basic behavior and interface preferences in WordPress.', 'easymde' ),
			'shortcutsDescription'                         => __( 'Configure shortcuts for common actions on Windows, Linux, and macOS.', 'easymde' ),
			'imagesDescription'                            => __( 'Configure image upload and storage services, including common hosts and custom upload solutions.', 'easymde' ),
			'aiDescription'                                => __( 'Configure AI services and writing assistance for EasyMDE in WordPress.', 'easymde' ),
			'markdownDescription'                          => __( 'Customize Markdown editor behavior and rendering for a more comfortable writing experience.', 'easymde' ),
			'syncDescription'                              => __( 'Configure article synchronization to publishing platforms and manage synchronization history.', 'easymde' ),
			'transferDescription'                          => __( 'Export plugin settings to a local file or import them for migration and backup.', 'easymde' ),
			'transferPageTitle'                            => __( 'Import / Export Configuration', 'easymde' ),
			'aboutDescription'                             => __( 'Learn about the EasyMDE plugin, version status, and related resources.', 'easymde' ),
			'sectionPending'                               => __( 'This settings section is not connected yet.', 'easymde' ),
			'sectionPendingDescription'                    => __( 'Its real WordPress data interface will be connected in a later step.', 'easymde' ),
			'basePreferences'                              => __( 'Basic Preferences', 'easymde' ),
			'editorBehavior'                               => __( 'Editor Behavior', 'easymde' ),
			'documentDefaults'                             => __( 'Document Defaults', 'easymde' ),
			'interfaceLanguage'                            => __( 'Interface Language', 'easymde' ),
			'defaultEditingMode'                           => __( 'Default Editing Mode', 'easymde' ),
			'autoFocusEditor'                              => __( 'Auto-focus Editor', 'easymde' ),
			'autoFocusEditorDescription'                   => __( 'Automatically focus the editor when creating a new article', 'easymde' ),
			'showLineNumbers'                              => __( 'Show Line Numbers', 'easymde' ),
			'showLineNumbersDescription'                   => __( 'Show line numbers on the left side of the editor', 'easymde' ),
			'syntaxHighlight'                              => __( 'Code Highlighting', 'easymde' ),
			'syntaxHighlightDescription'                   => __( 'Enable code syntax highlighting', 'easymde' ),
			'statusBarDisplay'                             => __( 'Status Bar Display', 'easymde' ),
			'autoSave'                                     => __( 'Auto Save', 'easymde' ),
			'autoSaveDescription'                          => __( 'Periodically save content to prevent accidental loss', 'easymde' ),
			'autoSaveInterval'                             => __( 'Auto Save Interval', 'easymde' ),
			'syncScroll'                                   => __( 'Synchronized Scrolling (Preview and Editor)', 'easymde' ),
			'syncScrollDescription'                        => __( 'Synchronize scrolling between the preview and editor areas', 'easymde' ),
			'cleanPastedContent'                           => __( 'Clean Pasted Content', 'easymde' ),
			'cleanPastedContentDescription'                => __( 'Automatically remove unnecessary formatting when pasting', 'easymde' ),
			'smartListRecognition'                         => __( 'Smart List Recognition', 'easymde' ),
			'smartListRecognitionDescription'              => __( 'Convert - or 1. to a list automatically', 'easymde' ),
			'defaultCategory'                              => __( 'Default Category Behavior', 'easymde' ),
			'defaultVisibility'                            => __( 'Default Publish Visibility', 'easymde' ),
			'openPreviewAfterPublish'                      => __( 'Open Preview After Publishing', 'easymde' ),
			'openPreviewAfterPublishDescription'           => __( 'Automatically open the article preview after publishing or updating', 'easymde' ),
			'summaryMode'                                  => __( 'Default Summary Sync Method', 'easymde' ),
			'summaryModeDescription'                       => __( 'Automatically extract the summary from the beginning of the content', 'easymde' ),
			'featuredImagePlaceholder'                     => __( 'Featured Image Placeholder', 'easymde' ),
			'featuredImagePlaceholderDescription'          => __( 'Show a placeholder prompt when no featured image is set', 'easymde' ),
			'simplifiedChinese'                            => __( 'Simplified Chinese', 'easymde' ),
			'traditionalChinese'                           => __( 'Traditional Chinese', 'easymde' ),
			'english'                                      => __( 'English', 'easymde' ),
			'livePreview'                                  => __( 'Live Preview (WYSIWYG)', 'easymde' ),
			'sourceEditing'                                => __( 'Source Editing', 'easymde' ),
			'previewOnly'                                  => __( 'Preview Only', 'easymde' ),
			'wordsAndReadingTime'                          => __( 'Show Word Count and Reading Time', 'easymde' ),
			'wordsOnly'                                    => __( 'Show Word Count Only', 'easymde' ),
			'hiddenStatusBar'                              => __( 'Hide Status Bar', 'easymde' ),
			'seconds30'                                    => __( '30 seconds', 'easymde' ),
			'seconds60'                                    => __( '60 seconds', 'easymde' ),
			'minutes2'                                     => __( '2 minutes', 'easymde' ),
			'minutes5'                                     => __( '5 minutes', 'easymde' ),
			'noAutomaticCategory'                          => __( 'Do Not Categorize Automatically', 'easymde' ),
			'currentCategory'                              => __( 'Use Current Category', 'easymde' ),
			'publicVisibility'                             => __( 'Public', 'easymde' ),
			'privateVisibility'                            => __( 'Private', 'easymde' ),
			'passwordProtected'                            => __( 'Password Protected', 'easymde' ),
			'summary55'                                    => __( 'Automatically Extract (First 55 Characters)', 'easymde' ),
			'summary100'                                   => __( 'Automatically Extract (First 100 Characters)', 'easymde' ),
			'manualSummary'                                => __( 'Enter Manually', 'easymde' ),
			'commonShortcuts'                              => __( 'Common Shortcuts', 'easymde' ),
			'headingAndFormatting'                         => __( 'Headings and Formatting', 'easymde' ),
			'shortcutBehavior'                             => __( 'Shortcut Behavior', 'easymde' ),
			'restoreDefaultShortcuts'                      => __( 'Restore Default Shortcuts', 'easymde' ),
			'shortcutFunction'                             => __( 'Function', 'easymde' ),
			'windowsLinux'                                 => __( 'Windows / Linux', 'easymde' ),
			'macOS'                                        => __( 'macOS', 'easymde' ),
			'saveArticle'                                  => __( 'Save Article', 'easymde' ),
			'bold'                                         => __( 'Bold', 'easymde' ),
			'italic'                                       => __( 'Italic', 'easymde' ),
			'insertLink'                                   => __( 'Insert Link', 'easymde' ),
			'insertImage'                                  => __( 'Insert Image', 'easymde' ),
			'openAiAssistant'                              => __( 'Open AI Assistant', 'easymde' ),
			'headingOne'                                   => __( 'Heading 1', 'easymde' ),
			'headingTwo'                                   => __( 'Heading 2', 'easymde' ),
			'quote'                                        => __( 'Quote', 'easymde' ),
			'unorderedList'                                => __( 'Unordered List', 'easymde' ),
			'orderedList'                                  => __( 'Ordered List', 'easymde' ),
			'showShortcutHints'                            => __( 'Show Shortcut Hints', 'easymde' ),
			'showShortcutHintsDescription'                 => __( 'Show shortcut hints in the toolbar and action menus.', 'easymde' ),
			'detectShortcutConflicts'                      => __( 'Detect and Warn About Conflicts', 'easymde' ),
			'detectShortcutConflictsDescription'           => __( 'Automatically warn and highlight when shortcut conflicts are detected.', 'easymde' ),
			'customShortcutSuggestions'                    => __( 'Custom Shortcut Suggestions', 'easymde' ),
			'customShortcutSuggestionsDescription'         => __( 'Clearing an input and saving restores that item\'s default shortcut.', 'easymde' ),
			'saveSettings'                                 => __( 'Save Settings', 'easymde' ),
			'savingSettings'                               => __( 'Saving…', 'easymde' ),
			'settingsSaved'                                => __( 'Settings saved.', 'easymde' ),
			'settingsSaveFailed'                           => __( 'Settings could not be saved. Try again.', 'easymde' ),
			'settingsUnsavedChanges'                       => __( 'Unsaved changes', 'easymde' ),
			'imageHostService'                             => __( 'Image Host Service', 'easymde' ),
			'selectImageHostService'                       => __( 'Select Image Host Service', 'easymde' ),
			'cloudflareR2'                                 => __( 'Cloudflare R2', 'easymde' ),
			'aliyunOss'                                    => __( 'Alibaba Cloud OSS', 'easymde' ),
			'tencentCloudCos'                              => __( 'Tencent Cloud COS', 'easymde' ),
			'customUpload'                                 => __( 'Custom Upload', 'easymde' ),
			'bucket'                                       => __( 'Storage Space / Bucket', 'easymde' ),
			'customDomain'                                 => __( 'Custom Domain', 'easymde' ),
			'accessKey'                                    => __( 'Access Key', 'easymde' ),
			'secretKey'                                    => __( 'Secret Key', 'easymde' ),
			'showSecret'                                   => __( 'Show Secret', 'easymde' ),
			'hideSecret'                                   => __( 'Hide Secret', 'easymde' ),
			'fileNameRule'                                 => __( 'File Name Rule', 'easymde' ),
			'fileNameRuleDescription'                      => __( 'Choose a template or combine variables to customize the storage path.', 'easymde' ),
			'commonFileNameTemplates'                      => __( 'Common Naming Templates', 'easymde' ),
			'selectTemplateToFillRule'                     => __( 'Select one to fill the rule automatically', 'easymde' ),
			'fileNamePresetDate'                           => __( 'Date Archive', 'easymde' ),
			'fileNamePresetMd5'                            => __( 'MD5 Content Hash', 'easymde' ),
			'fileNamePresetYearMonth'                      => __( 'Year and Month Directory', 'easymde' ),
			'fileNamePresetOriginal'                       => __( 'Keep Original Name', 'easymde' ),
			'fileNamePresetArticle'                        => __( 'Article Directory', 'easymde' ),
			'fileNamePresetTime'                           => __( 'Time-based Name', 'easymde' ),
			'availableVariables'                           => __( 'Available Variables', 'easymde' ),
			'yearVariable'                                 => __( 'Year', 'easymde' ),
			'monthVariable'                                => __( 'Month', 'easymde' ),
			'dayVariable'                                  => __( 'Day', 'easymde' ),
			'fullDateVariable'                             => __( 'Full Date', 'easymde' ),
			'uploadTimeVariable'                           => __( 'Upload Time', 'easymde' ),
			'postIdVariable'                               => __( 'Post ID', 'easymde' ),
			'fileMd5Variable'                              => __( 'File MD5', 'easymde' ),
			'uuidVariable'                                 => __( 'Unique Identifier', 'easymde' ),
			'originalNameVariable'                         => __( 'Original File Name', 'easymde' ),
			'extensionVariable'                            => __( 'File Extension', 'easymde' ),
			/* translators: %s: file-name rule variable label. */
			'insertFileNameVariable'                       => __( 'Insert %s variable', 'easymde' ),
			'examplePreview'                               => __( 'Example Preview', 'easymde' ),
			'enterFileNameRule'                            => __( 'Enter a file name rule', 'easymde' ),
			'connectionStatus'                             => __( 'Connection Status', 'easymde' ),
			'pendingTest'                                  => __( 'Pending Test', 'easymde' ),
			'testConnection'                               => __( 'Test Connection', 'easymde' ),
			'backupImageHost'                              => __( 'Backup Image Host', 'easymde' ),
			'backupImageHostDescription'                   => __( 'Reference dual-write upload flow: after the primary image host succeeds, continue writing to backup storage. By default, backup failures do not affect the primary URL.', 'easymde' ),
			'enableBackupImageHost'                        => __( 'Enable Backup Image Host', 'easymde' ),
			'enableBackupImageHostDescription'             => __( 'Write the same file content and object path to a second storage service.', 'easymde' ),
			'backupImageHostService'                       => __( 'Backup Image Host Service', 'easymde' ),
			'qiniuKodo'                                    => __( 'Qiniu Kodo', 'easymde' ),
			'backupBucket'                                 => __( 'Backup Storage Space / Bucket', 'easymde' ),
			'backupDomain'                                 => __( 'Backup Custom Domain', 'easymde' ),
			'backupAccessKey'                              => __( 'Backup Access Key', 'easymde' ),
			'backupSecretKey'                              => __( 'Backup Secret Key', 'easymde' ),
			'showBackupAccessKey'                          => __( 'Show Backup Access Key', 'easymde' ),
			'hideBackupAccessKey'                          => __( 'Hide Backup Access Key', 'easymde' ),
			'showBackupSecretKey'                          => __( 'Show Backup Secret Key', 'easymde' ),
			'hideBackupSecretKey'                          => __( 'Hide Backup Secret Key', 'easymde' ),
			'keepSameObjectPath'                           => __( 'Keep the Same Object Path', 'easymde' ),
			'keepSameObjectPathDescription'                => __( 'Use the same file-name rule and object key for the primary and backup hosts.', 'easymde' ),
			'backupFailureHandling'                        => __( 'Backup Failure Handling', 'easymde' ),
			'backupFailureHandlingDescription'             => __( 'Control whether the primary upload result remains available when the backup write fails.', 'easymde' ),
			'returnPrimaryUrlOnBackupFailure'              => __( 'Record Error and Return Primary Image Host URL', 'easymde' ),
			'failEntireUpload'                             => __( 'Fail Entire Upload and Prompt to Retry', 'easymde' ),
			'backupConnectionStatus'                       => __( 'Backup Connection Status', 'easymde' ),
			'testBackupConnection'                         => __( 'Test Backup Connection', 'easymde' ),
			'uploadBehavior'                               => __( 'Upload Behavior', 'easymde' ),
			'insertMarkdownAfterUpload'                    => __( 'Insert Markdown Link After Upload', 'easymde' ),
			'compressImages'                               => __( 'Compress Images Automatically', 'easymde' ),
			'compressImagesDescription'                    => __( 'Compress images before upload to save storage space.', 'easymde' ),
			'preserveOriginalFileName'                     => __( 'Preserve Original File Name', 'easymde' ),
			'preserveOriginalFileNameDescription'          => __( 'Do not rename uploaded files; preserve their original file names.', 'easymde' ),
			'copyImageUrl'                                 => __( 'Copy Image URL to Clipboard', 'easymde' ),
			'copyImageUrlDescription'                      => __( 'Copy the image URL automatically after a successful upload.', 'easymde' ),
			'retryFailedUpload'                            => __( 'Retry When Upload Fails', 'easymde' ),
			'doNotRetry'                                   => __( 'Do Not Retry', 'easymde' ),
			'retryOnce'                                    => __( 'Retry Once', 'easymde' ),
			'retryTwice'                                   => __( 'Retry Twice', 'easymde' ),
			'retryThreeTimes'                              => __( 'Retry Three Times', 'easymde' ),
			'maximumImageSize'                             => __( 'Maximum Image Size', 'easymde' ),
			'originalImageSize'                            => __( 'Original Size', 'easymde' ),
			'imageSize1920'                                => __( '1920px', 'easymde' ),
			'imageSize2560'                                => __( '2560px', 'easymde' ),
			'imageSize3840'                                => __( '3840px', 'easymde' ),
			'allowedUploadFormats'                         => __( 'Allowed Upload Formats', 'easymde' ),
			'allowedUploadFormatsDescription'              => __( 'Select the image file formats that the editor may choose and upload.', 'easymde' ),
			'uploadFormatJpg'                              => __( 'JPG / JPEG / JFIF', 'easymde' ),
			'uploadFormatPng'                              => __( 'PNG', 'easymde' ),
			'uploadFormatWebp'                             => __( 'WebP', 'easymde' ),
			'uploadFormatGif'                              => __( 'GIF', 'easymde' ),
			'allowUploadJpg'                               => __( 'Allow Uploading JPG / JPEG / JFIF Format', 'easymde' ),
			'allowUploadPng'                               => __( 'Allow Uploading PNG Format', 'easymde' ),
			'allowUploadWebp'                              => __( 'Allow Uploading WebP Format', 'easymde' ),
			'allowUploadGif'                               => __( 'Allow Uploading GIF Format', 'easymde' ),
			'uploadFormatSeparator'                        => __( ',', 'easymde' ),
			'defaultInsertion'                             => __( 'Default Insertion and Description', 'easymde' ),
			'defaultInsertFormat'                          => __( 'Default Insert Format', 'easymde' ),
			'markdownImage'                                => __( 'Markdown Image', 'easymde' ),
			'htmlImage'                                    => __( 'HTML Image', 'easymde' ),
			'urlOnly'                                      => __( 'Insert URL Only', 'easymde' ),
			'altTextSource'                                => __( 'Alt Text Source', 'easymde' ),
			'useFileName'                                  => __( 'Use File Name', 'easymde' ),
			'leaveEmpty'                                   => __( 'Leave Empty', 'easymde' ),
			'fillOnUpload'                                 => __( 'Fill In During Upload', 'easymde' ),
			'imageTitleField'                              => __( 'Image Title Field', 'easymde' ),
			'doNotInsert'                                  => __( 'Do Not Insert', 'easymde' ),
			'imageFeaturedPlaceholder'                     => _x( 'Featured Image Placeholder', 'image upload settings', 'easymde' ),
			'imageFeaturedPlaceholderDescription'          => _x( 'Show a placeholder prompt when no featured image is set', 'image upload settings', 'easymde' ),
			/* translators: %s: comma-separated image upload format labels. */
			'currentAllowedUploads'                        => __( 'Currently allowed uploads: %s.', 'easymde' ),
			'compressLargeImagesRecommendation'            => __( 'We recommend enabling automatic compression before uploading large images.', 'easymde' ),
			'aiServiceConfiguration'                       => __( 'AI Service Configuration', 'easymde' ),
			'aiProvider'                                   => __( 'AI Provider', 'easymde' ),
			'openAi'                                       => __( 'OpenAI', 'easymde' ),
			'azureOpenAi'                                  => __( 'Azure OpenAI', 'easymde' ),
			'anthropic'                                    => __( 'Anthropic', 'easymde' ),
			'customAiService'                              => __( 'Custom Service', 'easymde' ),
			'aiEndpoint'                                   => __( 'API Endpoint', 'easymde' ),
			'apiKey'                                       => __( 'API Key', 'easymde' ),
			'aiApiKey'                                     => __( 'AI API Key', 'easymde' ),
			'defaultModel'                                 => __( 'Default Model', 'easymde' ),
			'showAiApiKey'                                 => __( 'Show AI API Key', 'easymde' ),
			'hideAiApiKey'                                 => __( 'Hide AI API Key', 'easymde' ),
			'aiConnectionStatus'                           => __( 'Connection Status', 'easymde' ),
			/* translators: %s: AI provider name. */
			'aiConnectionTesting'                          => __( 'Testing %s service connection...', 'easymde' ),
			/* translators: %1$s: AI provider name, %2$s: AI model name. */
			'aiConnectionSuccess'                          => __( '%1$s service connection is normal; model %2$s is available.', 'easymde' ),
			'aiAutocomplete'                               => __( 'AI Autocomplete (Tab Completion)', 'easymde' ),
			'aiAutocompleteDescription'                    => __( 'Press Tab in the editor to trigger intelligent AI completion and improve writing efficiency.', 'easymde' ),
			'restoreAutocompleteDefaults'                  => __( 'Restore Default Completion Settings', 'easymde' ),
			'enableAiAutocomplete'                         => __( 'Enable AI Autocomplete', 'easymde' ),
			'enableAiAutocompleteDescription'              => __( 'Press Tab to trigger AI completion suggestions', 'easymde' ),
			'completionTrigger'                            => __( 'Trigger Method', 'easymde' ),
			'completionTriggerDescription'                 => __( 'Select the key method that triggers completion', 'easymde' ),
			'completionTriggerTab'                         => __( 'Tab', 'easymde' ),
			'completionTriggerShortcut'                    => __( 'Keyboard Shortcut', 'easymde' ),
			'completionTriggerAuto'                        => __( 'Automatic Trigger', 'easymde' ),
			'completionTiming'                             => __( 'Trigger Timing', 'easymde' ),
			'completionTimingDescription'                  => __( 'Select when completion is triggered', 'easymde' ),
			'completionTimingRealtime'                     => __( 'Trigger in Real Time While Typing', 'easymde' ),
			'completionTimingPause'                        => __( 'Trigger After a Pause', 'easymde' ),
			'completionTimingManual'                       => __( 'Trigger Manually', 'easymde' ),
			'minimumTriggerChars'                          => __( 'Minimum Trigger Characters', 'easymde' ),
			'minimumTriggerCharsDescription'               => __( 'Trigger after at least this many characters are entered', 'easymde' ),
			'suggestionCount'                              => __( 'Completion Suggestion Count', 'easymde' ),
			'suggestionCountDescription'                   => __( 'Number of completion suggestions shown each time', 'easymde' ),
			'contextLines'                                 => __( 'Context Lines', 'easymde' ),
			'contextLinesDescription'                      => __( 'Context range used to generate completion', 'easymde' ),
			'displayPosition'                              => __( 'Display Position', 'easymde' ),
			'displayPositionDescription'                   => __( 'Where completion suggestions are displayed', 'easymde' ),
			'displayPositionBelow'                         => __( 'Popover Below', 'easymde' ),
			'displayPositionInline'                        => __( 'Inline', 'easymde' ),
			'displayPositionSide'                          => __( 'Side Popover', 'easymde' ),
			'autoInsertSingle'                             => __( 'Automatically Insert a Single Match', 'easymde' ),
			'autoInsertSingleDescription'                  => __( 'Automatically insert when there is only one completion suggestion', 'easymde' ),
			'completeCodeBlocks'                           => __( 'Complete Code Block Content', 'easymde' ),
			'completeCodeBlocksDescription'                => __( 'Enable completion inside code blocks', 'easymde' ),
			'writingAssistance'                            => __( 'Writing Assistance', 'easymde' ),
			'assistantSidebar'                             => __( 'AI Assistant Sidebar', 'easymde' ),
			'assistantSidebarDescription'                  => __( 'Quickly open the AI assistant from the editor sidebar', 'easymde' ),
			'titleOptimization'                            => __( 'Title Optimization', 'easymde' ),
			'titleOptimizationDescription'                 => __( 'Generate more suitable title suggestions based on article content', 'easymde' ),
			'summaryGeneration'                            => __( 'Summary Generation', 'easymde' ),
			'summaryGenerationDescription'                 => __( 'Automatically generate an article summary for publishing', 'easymde' ),
			'tonePolish'                                   => __( 'Content Polishing', 'easymde' ),
			'tonePolishDescription'                        => __( 'Improve sentence expression and readability', 'easymde' ),
			'outlineGeneration'                            => __( 'Outline Generation', 'easymde' ),
			'outlineGenerationDescription'                 => __( 'Generate an article outline from a topic', 'easymde' ),
			'continuationSuggestions'                      => __( 'Continuation Suggestions', 'easymde' ),
			'continuationSuggestionsDescription'           => __( 'Suggest directions for continuing the current paragraph', 'easymde' ),
			'generationPreferences'                        => __( 'Generation and Interaction Preferences', 'easymde' ),
			'thinkingDepth'                                => __( 'Default Thinking Length', 'easymde' ),
			'thinkingDepthOff'                             => __( 'Off', 'easymde' ),
			'thinkingDepthStandard'                        => __( 'Standard', 'easymde' ),
			'thinkingDepthDeep'                            => __( 'Deep', 'easymde' ),
			'writingTone'                                  => __( 'Default Writing Tone', 'easymde' ),
			'writingToneGeneral'                           => __( 'General', 'easymde' ),
			'writingToneProfessional'                      => __( 'Professional', 'easymde' ),
			'writingToneRelaxed'                           => __( 'Relaxed', 'easymde' ),
			'writingToneConcise'                           => __( 'Concise', 'easymde' ),
			'outputLanguage'                               => __( 'Default Output Language', 'easymde' ),
			'includeContext'                               => __( 'Reference Current Article Context', 'easymde' ),
			'readMetadata'                                 => __( 'Allow Reading Title and Category Information', 'easymde' ),
			'saveLastPrompt'                               => __( 'Automatically Save the Most Recent Prompt', 'easymde' ),
			'promptManagement'                             => __( 'Prompt and Instruction Management', 'easymde' ),
			'promptManagementDescription'                  => __( 'Manage frequently used prompts and quickly invoke AI for specific tasks.', 'easymde' ),
			'importPrompts'                                => __( 'Import Prompts', 'easymde' ),
			'createPrompt'                                 => __( 'Create Prompt', 'easymde' ),
			'allPromptCategories'                          => __( 'All', 'easymde' ),
			'promptCategoryWriting'                        => __( 'Writing', 'easymde' ),
			'promptCategoryPolish'                         => __( 'Polishing', 'easymde' ),
			'promptCategorySummary'                        => __( 'Summary', 'easymde' ),
			'promptCategoryTranslation'                    => __( 'Translation', 'easymde' ),
			'promptCategoryCustom'                         => __( 'Custom', 'easymde' ),
			'promptNameHeader'                             => __( 'Prompt Name', 'easymde' ),
			'promptContentPreview'                         => __( 'Content Preview', 'easymde' ),
			'actions'                                      => __( 'Actions', 'easymde' ),
			/* translators: %s: prompt name. */
			'editPrompt'                                   => __( 'Edit %s', 'easymde' ),
			/* translators: %s: prompt name. */
			'duplicatePrompt'                              => __( 'Duplicate %s', 'easymde' ),
			/* translators: %s: prompt name. */
			'deletePrompt'                                 => __( 'Delete %s', 'easymde' ),
			'promptCopySuffix'                             => __( 'Copy', 'easymde' ),
			/* translators: %s: prompt category name. */
			'promptCategoryEmpty'                          => __( 'The "%s" category has no prompts. Create or import one.', 'easymde' ),
			/* translators: %1$s: prompt count, %2$s: current page, %3$s: total pages. */
			'promptPaginationSummary'                      => __( 'Total %1$s items, page %2$s / %3$s', 'easymde' ),
			'previousPromptPage'                           => __( 'Previous Prompt Page', 'easymde' ),
			'nextPromptPage'                               => __( 'Next Prompt Page', 'easymde' ),
			'promptItemsPerPage10'                         => __( '10 items/page', 'easymde' ),
			'promptItemsPerPage20'                         => __( '20 items/page', 'easymde' ),
			'promptItemsPerPage50'                         => __( '50 items/page', 'easymde' ),
			'promptPageSize'                               => __( 'Prompts Per Page', 'easymde' ),
			'jumpTo'                                       => __( 'Go to', 'easymde' ),
			'jumpToPromptPage'                             => __( 'Go to a Specific Prompt Page', 'easymde' ),
			'jump'                                         => __( 'Go', 'easymde' ),
			'createPromptTitle'                            => __( 'Create Prompt', 'easymde' ),
			'editPromptTitle'                              => __( 'Edit Prompt', 'easymde' ),
			'promptEditorDescription'                      => __( 'Set a name, category, and instruction content. After saving, it can be used in the AI assistant.', 'easymde' ),
			'closePromptEditor'                            => __( 'Close Prompt Editor', 'easymde' ),
			'promptName'                                   => __( 'Prompt Name', 'easymde' ),
			'requiredField'                                => __( '*', 'easymde' ),
			'promptNamePlaceholder'                        => __( 'For example: Rewrite the article in a professional tone', 'easymde' ),
			'promptCategory'                               => __( 'Category', 'easymde' ),
			'promptContent'                                => __( 'Prompt Content', 'easymde' ),
			'promptContentHelp'                            => __( 'Use {content} to reference article content', 'easymde' ),
			'promptContentPlaceholder'                     => __( 'Enter the complete instruction for AI...', 'easymde' ),
			'promptNameAndContentRequired'                 => __( 'Enter a prompt name and content', 'easymde' ),
			'promptNameRequired'                           => __( 'Enter a prompt name', 'easymde' ),
			'promptContentRequired'                        => __( 'Enter prompt content', 'easymde' ),
			'cancel'                                       => __( 'Cancel', 'easymde' ),
			'savePrompt'                                   => __( 'Save Prompt', 'easymde' ),
			'deletePromptTitle'                            => __( 'Delete Prompt', 'easymde' ),
			/* translators: %s: prompt name. */
			'deletePromptConfirmation'                     => __( 'Are you sure you want to delete "%s"? This action cannot be undone.', 'easymde' ),
			'confirmDelete'                                => __( 'Confirm Delete', 'easymde' ),
			/* translators: %s: prompt name. */
			'promptCreated'                                => __( 'Created "%s"', 'easymde' ),
			/* translators: %s: prompt name. */
			'promptSaved'                                  => __( 'Saved "%s"', 'easymde' ),
			/* translators: %s: prompt name. */
			'promptDuplicated'                             => __( 'Duplicated "%s"', 'easymde' ),
			/* translators: %s: prompt name. */
			'promptDeleted'                                => __( 'Deleted "%s"', 'easymde' ),
			'closePromptFeedback'                          => __( 'Close Notification', 'easymde' ),
			'defaultPromptTitleName'                       => __( 'Optimize Article Title', 'easymde' ),
			'defaultPromptTitleContent'                    => __( 'Based on the following content, generate five attractive titles that are concise and include keywords...', 'easymde' ),
			'defaultPromptPolishName'                      => __( 'Polish Article Content', 'easymde' ),
			'defaultPromptPolishContent'                   => __( 'Polish the following content to improve fluency, accuracy, and logical coherence: {content}...', 'easymde' ),
			'defaultPromptSummaryName'                     => __( 'Generate Article Summary', 'easymde' ),
			'defaultPromptSummaryContent'                  => __( 'Generate a publication summary of 80 to 120 Chinese characters from the following article...', 'easymde' ),
			'promptImportJsonOnly'                         => __( 'Only JSON prompt files are supported.', 'easymde' ),
			'promptImportMustBeArray'                      => __( 'The prompt file must contain a JSON array.', 'easymde' ),
			'promptImportEmpty'                            => __( 'The prompt file is empty.', 'easymde' ),
			'promptImportInvalidItem'                      => __( 'The prompt file contains an invalid item.', 'easymde' ),
			/* translators: %s: imported prompt count. */
			'promptImportSuccess'                          => __( 'Imported %s prompts', 'easymde' ),
			'promptImportUnknownError'                     => __( 'An unknown error occurred while importing prompts.', 'easymde' ),
			'promptPageInvalid'                            => __( 'Enter a valid prompt page number.', 'easymde' ),
			'markdownEditorSettings'                       => __( 'Editor Settings', 'easymde' ),
			'markdownLivePreview'                          => _x( 'Live Preview', 'Markdown editor setting', 'easymde' ),
			'livePreviewDescription'                       => __( 'Render Markdown content in real time while editing.', 'easymde' ),
			'wordWrap'                                     => __( 'Word Wrap', 'easymde' ),
			'wordWrapDescription'                          => __( 'Wrap lines in the editor instead of scrolling horizontally.', 'easymde' ),
			'markdownLineNumbersDescription'               => __( 'Show line numbers on the left side of the editor.', 'easymde' ),
			'fixedToolbar'                                 => __( 'Fixed Toolbar', 'easymde' ),
			'fixedToolbarDescription'                      => __( 'Keep the toolbar fixed at the top while scrolling.', 'easymde' ),
			'editorTheme'                                  => __( 'Editor Theme', 'easymde' ),
			'automaticFollowSystem'                        => __( 'Automatic (Follow System)', 'easymde' ),
			'light'                                        => __( 'Light', 'easymde' ),
			'dark'                                         => __( 'Dark', 'easymde' ),
			'editorFontSize'                               => __( 'Editor Font Size', 'easymde' ),
			'editorFont'                                   => __( 'Editor Font', 'easymde' ),
			'systemDefault'                                => __( 'System Default', 'easymde' ),
			'monospaceFont'                                => __( 'Monospace Font', 'easymde' ),
			'sourceHanSans'                                => __( 'Source Han Sans', 'easymde' ),
			'markdownParsingRendering'                     => __( 'Markdown Parsing and Rendering', 'easymde' ),
			'githubFlavor'                                 => __( 'GitHub Flavored Markdown', 'easymde' ),
			'githubFlavorDescription'                      => __( 'Use GitHub-flavored Markdown parsing.', 'easymde' ),
			'smartPunctuation'                             => __( 'Smart Punctuation', 'easymde' ),
			'smartPunctuationDescription'                  => __( 'Convert straight quotes and hyphens to smart punctuation.', 'easymde' ),
			'tableAlignment'                               => __( 'Table Alignment', 'easymde' ),
			'autoAlignByContent'                           => __( 'Automatically Align by Content', 'easymde' ),
			'alignLeft'                                    => __( 'Align All Left', 'easymde' ),
			'alignCenter'                                  => __( 'Align All Center', 'easymde' ),
			'codeBlockTheme'                               => __( 'Code Block Theme', 'easymde' ),
			'lightCodeTheme'                               => __( 'Light (Light)', 'easymde' ),
			'darkCodeTheme'                                => __( 'Dark (Dark)', 'easymde' ),
			'followEditor'                                 => __( 'Follow Editor', 'easymde' ),
			'codeBlockLineNumbers'                         => __( 'Code Block Line Numbers', 'easymde' ),
			'show'                                         => __( 'Show', 'easymde' ),
			'hide'                                         => __( 'Hide', 'easymde' ),
			'taskLists'                                    => __( 'Task Lists', 'easymde' ),
			'taskListsDescription'                         => __( 'Enable task lists (- [ ] / - [x]).', 'easymde' ),
			'emoji'                                        => __( 'Emoji', 'easymde' ),
			'emojiDescription'                             => __( 'Enable emoji shortcode parsing.', 'easymde' ),
			'mathSupport'                                  => __( 'Math Formula Support', 'easymde' ),
			'mathSupportDescription'                       => __( 'Enable LaTeX math rendering (requires a supported renderer).', 'easymde' ),
			'htmlRendering'                                => __( 'HTML Rendering', 'easymde' ),
			'htmlRenderingDescription'                     => __( 'Allow HTML rendering (security risk; enable with caution).', 'easymde' ),
			'markdownExtensions'                           => __( 'Markdown Extensions', 'easymde' ),
			'tableExtension'                               => __( 'Table Extension', 'easymde' ),
			'tableExtensionDescription'                    => __( 'Enable advanced table features such as merged cells.', 'easymde' ),
			'footnotes'                                    => __( 'Footnotes', 'easymde' ),
			'footnotesDescription'                         => __( 'Enable footnote syntax.', 'easymde' ),
			'definitionLists'                              => __( 'Definition Lists', 'easymde' ),
			'definitionListsDescription'                   => __( 'Enable definition list syntax.', 'easymde' ),
			'tocDirectory'                                 => __( 'TOC Directory', 'easymde' ),
			'tocDirectoryDescription'                      => __( 'Enable automatic directory generation with [TOC].', 'easymde' ),
			'imageSizeSyntax'                              => __( 'Image Size Syntax', 'easymde' ),
			'imageSizeSyntaxDescription'                   => __( 'Enable image size syntax such as ![](/... =300x200).', 'easymde' ),
			'otherSettings'                                => __( 'Other', 'easymde' ),
			'pasteAsMarkdown'                              => __( 'Convert Pasted Content to Markdown', 'easymde' ),
			'pasteAsMarkdownDescription'                   => __( 'Convert pasted content to Markdown whenever possible.', 'easymde' ),
			'defaultLineEnding'                            => __( 'Default Line Ending', 'easymde' ),
			'unorderedListMarker'                          => __( 'Unordered List Marker', 'easymde' ),
			'orderedListStart'                             => __( 'Ordered List Start Value', 'easymde' ),
			'blockquoteIndentStyle'                        => __( 'Blockquote Indentation Style', 'easymde' ),
			'standardBlockquote'                           => __( '> (Standard)', 'easymde' ),
			'spacedBlockquote'                             => __( '> (With Space)', 'easymde' ),
			'syncBrowserExtensionConnection'               => __( 'Browser Extension Connection', 'easymde' ),
			'syncConnectedBadge'                           => __( 'Connected', 'easymde' ),
			'syncExtensionDescription'                     => __( 'The EasyMDE browser extension reads your login status on supported platforms and performs article synchronization.', 'easymde' ),
			'syncCheckConnection'                          => __( 'Check Connection', 'easymde' ),
			'syncOpenExtensionSettings'                    => __( 'Open Extension Settings', 'easymde' ),
			'syncExtensionVersion'                         => __( 'Extension Version', 'easymde' ),
			'syncExtensionVersionValue'                    => __( 'EasyMDE Sync 1.2.0', 'easymde' ),
			'syncCurrentBrowser'                           => __( 'Current Browser', 'easymde' ),
			'syncCurrentBrowserValue'                      => __( 'Chrome 150.0.0.0', 'easymde' ),
			'syncConnectedDevice'                          => __( 'Connected Device', 'easymde' ),
			'syncConnectedDeviceValue'                     => __( 'MacBook Pro', 'easymde' ),
			'syncLastHeartbeat'                            => __( 'Last Heartbeat', 'easymde' ),
			'syncJustNow'                                  => __( 'Just Now', 'easymde' ),
			'syncPlatformStatus'                           => __( 'Sync Platform Status', 'easymde' ),
			'syncPlatformStatusDescription'                => __( 'Manage login status and synchronization authorization for each platform.', 'easymde' ),
			'syncCheckAllStatus'                           => __( 'Check All Statuses', 'easymde' ),
			'syncRecentSync'                               => __( 'Last Synchronized', 'easymde' ),
			'syncLoggedIn'                                 => __( 'Logged In', 'easymde' ),
			'syncLoginExpired'                             => __( 'Login Expired', 'easymde' ),
			'syncUnauthorized'                             => __( 'Unauthorized', 'easymde' ),
			'syncCheckStatus'                              => __( 'Check Status', 'easymde' ),
			'syncReauthorize'                              => __( 'Reauthorize', 'easymde' ),
			'syncAuthorize'                                => __( 'Authorize', 'easymde' ),
			/* translators: %s: synchronization platform name. */
			'syncMoreActions'                              => __( '%s More Actions', 'easymde' ),
			'syncPrivacyHint'                              => __( 'Tip: Platform login information is stored only in the browser extension. EasyMDE does not save any account passwords.', 'easymde' ),
			'syncNotification'                             => __( 'Sync Result Notifications', 'easymde' ),
			'syncNotificationDescription'                  => __( 'After a sync task completes, send the result through selected channels and optionally include success or failure details for each platform.', 'easymde' ),
			'syncSendTestMessage'                          => __( 'Send Test Message', 'easymde' ),
			'syncEnableNotifications'                      => __( 'Enable Notifications', 'easymde' ),
			'syncEnableNotificationsDescription'           => __( 'Control all sync result notification channels together.', 'easymde' ),
			'syncNotificationTrigger'                      => __( 'Notification Condition', 'easymde' ),
			'syncNotificationTiming'                       => __( 'Notification Timing', 'easymde' ),
			'syncMessageTemplate'                          => __( 'Message Template', 'easymde' ),
			'syncMessageTemplateDescription'               => __( 'Choose a built-in message structure or combine variables in a custom notification title and body.', 'easymde' ),
			'syncTemplateType'                             => __( 'Template Type', 'easymde' ),
			'syncTemplatePlatformDetailsDescription'       => __( 'Show the overall result and the synchronization status for each target platform.', 'easymde' ),
			'syncExamplePreview'                           => __( 'Example Preview', 'easymde' ),
			'syncExamplePreviewDescription'                => __( 'Replace template variables with a simulated sync result.', 'easymde' ),
			'syncTemplatePreviewTitle'                     => __( '[EasyMDE] WordPress Markdown Writing Guide Sync Partially Failed', 'easymde' ),
			'syncTemplatePreviewBody'                      => __( "Article: WordPress Markdown Writing Guide\nStatus: Partially Failed\nSuccessful Platforms: 2/3\nPlatform Details:\n✓ Juejin: Success\n✓ Zhihu: Success\n✕ CSDN: Failed\nSync Time: 2026-07-14 15:30", 'easymde' ),
			'syncBrowserNotification'                      => __( 'Browser Notification', 'easymde' ),
			'syncBrowserNotificationDescription'           => __( 'Show a system-level sync result notification in the current browser.', 'easymde' ),
			'syncEmailNotification'                        => __( 'Email Notification', 'easymde' ),
			'syncEmailNotificationDescription'             => __( 'Send the sync result to a specified email address.', 'easymde' ),
			'syncCustomWebhook'                            => __( 'Custom Webhook', 'easymde' ),
			'syncCustomWebhookDescription'                 => __( 'Send a JSON message to a custom service or automation workflow.', 'easymde' ),
			'syncWebhookPlaceholder'                       => 'https://example.com/hooks/sync',
			'syncGroupBotNotifications'                    => __( 'Group Bot Notifications', 'easymde' ),
			'syncGroupBotNotificationsDescription'         => __( 'Configure DingTalk, Feishu, and WeCom group bots separately. Each enabled bot receives sync results independently.', 'easymde' ),
			'syncDingTalk'                                 => __( 'DingTalk Bot', 'easymde' ),
			'syncDingTalkDescription'                      => __( 'Send notifications to a DingTalk group bot.', 'easymde' ),
			'syncFeishu'                                   => __( 'Feishu Bot', 'easymde' ),
			'syncFeishuDescription'                        => __( 'Send notifications to a Feishu group custom bot.', 'easymde' ),
			'syncWeCom'                                    => __( 'WeCom Bot', 'easymde' ),
			'syncWeComDescription'                         => __( 'Send notifications to a WeCom group bot.', 'easymde' ),
			'syncIncludeDetails'                           => __( 'Include Platform Details', 'easymde' ),
			'syncIncludeDetailsDescription'                => __( 'List the success, failure, or pending state for each target platform in the message.', 'easymde' ),
			'syncNotificationPrivacy'                      => __( 'Notifications report only synchronization results and never include platform accounts, cookies, or authorization credentials.', 'easymde' ),
			'syncAllResults'                               => __( 'All Results', 'easymde' ),
			'syncFailedOrPartial'                          => __( 'Failed or Partially Failed', 'easymde' ),
			'syncOnlyAllFailed'                            => __( 'Only When All Failed', 'easymde' ),
			'syncAfterEachArticle'                         => __( 'After Each Article Completes', 'easymde' ),
			'syncAfterBatch'                               => __( 'After a Batch Completes', 'easymde' ),
			'syncTemplateCompact'                          => __( 'Compact Result', 'easymde' ),
			'syncTemplatePlatformDetails'                  => __( 'Platform Details', 'easymde' ),
			'syncTemplateFailureAlert'                     => __( 'Failure Alert', 'easymde' ),
			'syncTemplateCustom'                           => __( 'Custom Template', 'easymde' ),
			'syncHistory'                                  => __( 'Article Sync History', 'easymde' ),
			'syncHistoryDescription'                       => __( 'View historical article synchronization records and statuses.', 'easymde' ),
			'syncFilterPlatform'                           => __( 'Filter Sync Platform', 'easymde' ),
			'syncAllPlatforms'                             => __( 'All Platforms', 'easymde' ),
			'syncFilterStatus'                             => __( 'Filter Sync Status', 'easymde' ),
			'syncAllStatuses'                              => __( 'All Statuses', 'easymde' ),
			'syncRefresh'                                  => __( 'Refresh', 'easymde' ),
			'syncArticleTitle'                             => __( 'Article Title', 'easymde' ),
			'syncTargetPlatforms'                          => __( 'Target Platforms', 'easymde' ),
			'syncStatus'                                   => __( 'Status', 'easymde' ),
			'syncTime'                                     => __( 'Sync Time', 'easymde' ),
			'syncActions'                                  => __( 'Actions', 'easymde' ),
			/* translators: %1$s: total record count, %2$s: current page, %3$s: total pages. */
			'syncHistorySummary'                           => __( 'A total of %1$s entries, page %2$s of %3$s', 'easymde' ),
			'syncPreviousPage'                             => __( 'Previous Sync History Page', 'easymde' ),
			'syncNextPage'                                 => __( 'Next Sync History Page', 'easymde' ),
			'syncItemsPerPage'                             => __( 'Sync History Items per Page', 'easymde' ),
			'syncItemsPerPage10'                           => __( '10 items/page', 'easymde' ),
			'syncItemsPerPage20'                           => __( '20 items/page', 'easymde' ),
			'syncItemsPerPage50'                           => __( '50 items/page', 'easymde' ),
			'syncJumpToPage'                               => __( 'Jump to the Specified Sync History Page', 'easymde' ),
			'syncSynced'                                   => __( 'Synchronized', 'easymde' ),
			'syncSyncing'                                  => __( 'Synchronizing', 'easymde' ),
			'syncPartialFailure'                           => __( 'Partially Failed', 'easymde' ),
			'syncFailed'                                   => __( 'Failed', 'easymde' ),
			'syncPending'                                  => __( 'Pending', 'easymde' ),
			'syncRetry'                                    => __( 'Retry', 'easymde' ),
			'syncCancel'                                   => __( 'Cancel Sync', 'easymde' ),
			'syncViewDetails'                              => __( 'View Details', 'easymde' ),
			'syncStartNow'                                 => __( 'Sync Now', 'easymde' ),
			/* translators: %s: synchronization platform name. */
			'syncPlatformChecked'                          => __( '%s status is normal.', 'easymde' ),
			'syncStatusesChecked'                          => __( 'All platform statuses have been checked.', 'easymde' ),
			'syncHistoryRefreshed'                         => __( 'Sync history has been refreshed.', 'easymde' ),
			'syncTestMessageSent'                          => __( 'The test notification has been prepared for this session.', 'easymde' ),
			'syncExtensionSettingsNotice'                  => __( 'Browser extension settings are not connected to WordPress yet.', 'easymde' ),
			'closeSyncFeedback'                            => __( 'Close Sync Feedback', 'easymde' ),
			'syncExtensionDialogTitle'                     => __( 'Browser Extension Settings', 'easymde' ),
			'syncExtensionDialogDescription'               => __( 'View extension connection information and platform authorization status.', 'easymde' ),
			'syncAuthorizedPlatforms'                      => __( 'Authorized Platforms', 'easymde' ),
			'syncExtensionCredentialsPrivacy'              => __( 'Platform login credentials are managed by the browser extension. This page reads authorization status only and does not store account passwords.', 'easymde' ),
			'syncRecheckConnection'                        => __( 'Recheck Connection', 'easymde' ),
			'closeSyncOperationDialog'                     => __( 'Close Sync Operation Dialog', 'easymde' ),
			/* translators: %s: synchronization platform name. */
			'syncPlatformDialogTitle'                      => __( '%s Platform Management', 'easymde' ),
			'syncPlatformDialogDescription'                => __( 'Manage authorization status and filter synchronization records for this platform.', 'easymde' ),
			'syncCheckCurrentAuthorization'                => __( 'Check Current Authorization Status', 'easymde' ),
			'syncReauthorizePlatform'                      => __( 'Reauthorize Platform', 'easymde' ),
			'syncViewPlatformHistory'                      => __( 'View This Platform Synchronization Records', 'easymde' ),
			'syncRevokeAuthorization'                      => __( 'Revoke Platform Authorization', 'easymde' ),
			/* translators: %s: synchronization platform name. */
			'syncPlatformRevoked'                          => __( '%s authorization was revoked for this browser session.', 'easymde' ),
			'syncHistoryDetailTitle'                       => __( 'Synchronization Details', 'easymde' ),
			'syncHistoryDetailDescription'                 => __( 'View the synchronization result and processing status for each target platform.', 'easymde' ),
			'syncOverallStatus'                            => __( 'Overall Status', 'easymde' ),
			'syncResultSummary'                            => __( 'Synchronization Result Summary', 'easymde' ),
			'syncTargetSuccess'                            => __( 'Synchronization Successful', 'easymde' ),
			'syncTargetFailure'                            => __( 'Synchronization Failed', 'easymde' ),
			'syncPlatformResults'                          => __( 'Platform Synchronization Results', 'easymde' ),
			/* translators: %s: target platform count. */
			'syncTargetPlatformCount'                      => __( '%s target platforms', 'easymde' ),
			'syncTargetSuccessDescription'                 => __( 'The platform received and published the article.', 'easymde' ),
			'syncTargetFailureDescription'                 => __( 'The platform did not publish the article. Check authorization status or the interface response.', 'easymde' ),
			'syncTargetSyncingDescription'                 => __( 'The article is being submitted to the platform.', 'easymde' ),
			'syncTargetPendingDescription'                 => __( 'The task has not started and is waiting to run.', 'easymde' ),
			'syncViewArticle'                              => __( 'View Article', 'easymde' ),
			'syncArticleLinkPending'                       => __( 'Synchronized article links are not connected to WordPress yet.', 'easymde' ),
			'syncFailureReason'                            => __( 'Failure Reason:', 'easymde' ),
			'syncRetryFailedPlatforms'                     => __( 'Retry Failed Platforms', 'easymde' ),
			'closeSyncHistoryDetail'                       => __( 'Close Synchronization Details', 'easymde' ),
			'transferExportConfiguration'                  => __( 'Export Configuration File', 'easymde' ),
			'transferExportConfigurationDescription'       => __( 'Export all current settings as a JSON configuration file for backup or migration to another site.', 'easymde' ),
			'transferFileName'                             => __( 'File Name', 'easymde' ),
			'transferExportFileName'                       => __( 'Export File Name', 'easymde' ),
			'transferImportConfiguration'                  => __( 'Import Configuration File', 'easymde' ),
			'transferImportConfigurationDescription'       => __( 'Import settings from a local JSON configuration file and overwrite the current configuration after confirmation.', 'easymde' ),
			'transferChooseConfigurationFile'              => __( 'Choose Configuration File', 'easymde' ),
			'transferConfirmImport'                        => __( 'Confirm Import', 'easymde' ),
			'transferImportInstructions'                   => __( 'Import Instructions', 'easymde' ),
			'transferImportOverwriteNotice'                => __( 'Importing will overwrite the current configuration. Back up important settings first.', 'easymde' ),
			'transferImportCompatibilityNotice'            => __( 'Configuration files are valid only in the same or a compatible EasyMDE version.', 'easymde' ),
			'transferImportScopeNotice'                    => __( 'Import handles plugin configuration only and does not affect articles or media data.', 'easymde' ),
			'transferConfigurationManagement'              => __( 'Configuration Management', 'easymde' ),
			'transferConfigurationManagementDescription'   => __( 'Manage and maintain plugin configuration operations.', 'easymde' ),
			'transferResetCurrentConfiguration'            => __( 'Reset Current Configuration', 'easymde' ),
			'transferResetCurrentConfigurationDescription' => __( 'Restore all settings to their defaults.', 'easymde' ),
			'transferClearLocalCache'                      => __( 'Clear Local Cache', 'easymde' ),
			'transferClearLocalCacheDescription'           => __( 'Clear cached data without affecting configuration.', 'easymde' ),
			'transferOpenConfigurationDirectory'           => __( 'Open Configuration Directory', 'easymde' ),
			'transferOpenConfigurationDirectoryDescription' => __( 'View and copy the configuration directory path.', 'easymde' ),
			'transferViewConfigurationStatus'              => __( 'View Configuration Status', 'easymde' ),
			'transferViewConfigurationStatusDescription'   => __( 'Check whether the current configuration is valid.', 'easymde' ),
			'transferCloseOperationDialog'                 => __( 'Close Operation Dialog', 'easymde' ),
			'transferConfigurationDirectory'               => __( 'Configuration Directory', 'easymde' ),
			'transferConfigurationStatusCheck'             => __( 'Configuration Status Check', 'easymde' ),
			'transferLocalStateChangeDescription'          => __( 'This operation changes local state on the current device.', 'easymde' ),
			'transferConfigurationDirectoryDescription'    => __( 'View where EasyMDE configuration is stored on the current device.', 'easymde' ),
			'transferConfigurationStatusDescription'       => __( 'Check whether required configuration is complete and usable.', 'easymde' ),
			'transferClose'                                => __( 'Close', 'easymde' ),
			'transferResetWarning'                         => __( 'Resetting restores General, Shortcuts, Images, AI, Markdown, and notification settings to their defaults. Export a backup first.', 'easymde' ),
			'transferClearCacheWarning'                    => __( 'This operation clears browser cache only. It does not delete articles, media, or current configuration. Some temporary state may require reloading.', 'easymde' ),
			'transferConfirmReset'                         => __( 'Confirm Reset', 'easymde' ),
			'transferConfirmClear'                         => __( 'Confirm Clear', 'easymde' ),
			'transferIntegrationPendingNotice'             => __( 'This settings operation is not connected to WordPress yet.', 'easymde' ),
			/* translators: %s: selected configuration file name. */
			'transferFileSelectedNotice'                   => __( 'Selected %s. Confirm to overwrite the current configuration.', 'easymde' ),
			'closeTransferFeedback'                        => __( 'Close Configuration Feedback', 'easymde' ),
			'transferStorageLocationDescription'           => __( 'A WordPress administration page cannot open a server file directory directly. Copy the non-sensitive storage owner below to identify where this configuration belongs.', 'easymde' ),
			'transferStorageLocationValue'                 => __( 'WordPress database / EasyMDE options', 'easymde' ),
			'transferCopyStorageLocation'                  => __( 'Copy Location', 'easymde' ),
			'transferStorageLocationCopied'                => __( 'The configuration storage location was copied.', 'easymde' ),
			'transferStorageLocationCopyFailed'            => __( 'The configuration storage location could not be copied. Check browser clipboard permission.', 'easymde' ),
			/* translators: %s: number of configuration checks. */
			'transferChecksSummary'                        => __( '%s key configuration items checked', 'easymde' ),
			/* translators: %s: number of configuration checks that passed. */
			'transferChecksPassed'                         => __( '%s items passed', 'easymde' ),
			'transferCheckBootstrap'                       => __( 'Settings Bootstrap', 'easymde' ),
			'transferCheckBootstrapReady'                  => __( 'The validated WordPress settings bootstrap is available.', 'easymde' ),
			'transferCheckRuntimeAssets'                   => __( 'Runtime Assets', 'easymde' ),
			'transferCheckRuntimeAssetsReady'              => __( 'Brand, header, and empty-state assets have registered URLs.', 'easymde' ),
			'transferCheckImageDraft'                      => __( 'Image Settings Draft', 'easymde' ),
			'transferCheckImageDraftReady'                 => __( 'The current image-host draft has a configured domain.', 'easymde' ),
			'transferCheckImageDraftIncomplete'            => __( 'The current image-host draft has no configured domain.', 'easymde' ),
			'transferCheckAiDraft'                         => __( 'AI Service Draft', 'easymde' ),
			'transferCheckAiDraftReady'                    => __( 'Provider, endpoint, model, and API key are present in the session draft.', 'easymde' ),
			'transferCheckAiDraftIncomplete'               => __( 'Provider, endpoint, model, or API key is missing from the session draft.', 'easymde' ),
			'transferCheckPersistence'                     => __( 'WordPress Settings Persistence', 'easymde' ),
			'transferCheckPersistencePending'              => __( 'Server-side settings persistence is intentionally not connected in this UI phase.', 'easymde' ),
			'transferCheckPersistenceReady'                => __( 'The WordPress settings endpoint is available for the current administrator.', 'easymde' ),
			'transferCheckPersistenceUnavailable'          => __( 'The browser could not verify the local settings operation.', 'easymde' ),
			'transferExportSuccess'                        => __( 'The configuration file was downloaded.', 'easymde' ),
			'transferExportFailed'                         => __( 'The configuration file could not be downloaded.', 'easymde' ),
			'transferImportInvalid'                        => __( 'The selected configuration file is invalid or incompatible.', 'easymde' ),
			'transferImportApplied'                        => __( 'The configuration was imported into the unsaved draft.', 'easymde' ),
			'transferResetApplied'                         => __( 'The settings draft was reset to the default configuration.', 'easymde' ),
			'transferLocalCacheCleared'                    => __( 'EasyMDE local browser cache was cleared.', 'easymde' ),
			'transferLocalCacheClearFailed'                => __( 'EasyMDE local browser cache could not be cleared.', 'easymde' ),
			'transferOperationUnavailable'                 => __( 'This browser operation is unavailable.', 'easymde' ),
			'aboutVersionInformation'                      => __( 'Version Information', 'easymde' ),
			'aboutCurrentVersion'                          => __( 'Current Version', 'easymde' ),
			'aboutCurrentVersionValue'                     => __( '0.1.8', 'easymde' ),
			'aboutCheckUpdates'                            => __( 'Check for Updates', 'easymde' ),
			'aboutRenderEngine'                            => __( 'Rendering Engine', 'easymde' ),
			'aboutRenderEngineValue'                       => __( 'league/commonmark 2.8.2', 'easymde' ),
			'aboutCompatibleVersion'                       => __( 'Compatible Version', 'easymde' ),
			'aboutCompatibleVersionValue'                  => __( 'WordPress 6.7+', 'easymde' ),
			'aboutPhpRequirement'                          => __( 'PHP Requirement', 'easymde' ),
			'aboutPhpRequirementValue'                     => __( '7.4+', 'easymde' ),
			'aboutLastUpdated'                             => __( 'Last Updated', 'easymde' ),
			'aboutLastUpdatedValue'                        => __( '2026-07-16', 'easymde' ),
			'aboutConfigurationStatus'                     => __( 'Configuration Status', 'easymde' ),
			'aboutStatusNormal'                            => __( 'Normal', 'easymde' ),
			'aboutCoreCapabilities'                        => __( 'Core Capabilities', 'easymde' ),
			'aboutMarkdownPreview'                         => __( 'Markdown Editing and Live Preview', 'easymde' ),
			'aboutCodeHighlighting'                        => __( 'Code Highlighting and Syntax Support', 'easymde' ),
			'aboutImageUpload'                             => __( 'Image Upload and Link Insertion', 'easymde' ),
			'aboutAiAssistance'                            => __( 'AI Writing Assistance and Autocomplete', 'easymde' ),
			'aboutShortcutWorkflow'                        => __( 'Shortcuts and Workflow Optimization', 'easymde' ),
			'aboutConfigurationMigration'                  => __( 'Configuration Import, Export, and Migration', 'easymde' ),
			'aboutResourcesSupport'                        => __( 'Resources and Support', 'easymde' ),
			'aboutOfficialDocumentation'                   => __( 'Official Documentation', 'easymde' ),
			'aboutChangelog'                               => __( 'Changelog', 'easymde' ),
			'aboutIssueFeedback'                           => __( 'Issue Feedback', 'easymde' ),
			'aboutGithubRepository'                        => __( 'GitHub Repository', 'easymde' ),
			'aboutSecurityPolicy'                          => __( 'Security Policy', 'easymde' ),
			'aboutOpenSourceLicense'                       => __( 'Open Source License', 'easymde' ),
			'aboutSupportNote'                             => __( 'Feedback is welcome. Help EasyMDE continue improving the writing experience.', 'easymde' ),
			'aboutPluginIntroduction'                      => __( 'Plugin Introduction', 'easymde' ),
			'aboutPluginIntroductionDescription'           => __( 'EasyMDE is a Markdown editor plugin built for WordPress. It provides Markdown source editing, split-pane live Preview, local runtime assets, and WordPress-native media, revisions, permissions, saving, and publishing.', 'easymde' ),
			'aboutTagMarkdown'                             => __( 'Markdown', 'easymde' ),
			'aboutTagLivePreview'                          => __( 'Live Preview', 'easymde' ),
			'aboutTagImages'                               => __( 'WordPress Media', 'easymde' ),
			'aboutTagAi'                                   => __( 'Local Assets', 'easymde' ),
			'aboutTagShortcuts'                            => __( 'Shortcuts', 'easymde' ),
			'aboutHelpDialogTitle'                         => __( 'Usage Help', 'easymde' ),
			'aboutHelpDialogDescription'                   => __( 'Find documentation about configuration, editing, and migration.', 'easymde' ),
			'aboutChangelogDescription'                    => __( 'Review the main changes in recent EasyMDE versions.', 'easymde' ),
			'aboutCloseOperationDialog'                    => __( 'Close About Dialog', 'easymde' ),
			'aboutClose'                                   => __( 'Close', 'easymde' ),
			'aboutOpenFullDocumentation'                   => __( 'Open Full Documentation', 'easymde' ),
			'aboutHelpQuickStart'                          => __( 'Quick Start', 'easymde' ),
			'aboutHelpQuickStartDescription'               => __( 'Configure the editor, appearance, image behavior, and writing preferences.', 'easymde' ),
			'aboutHelpEditorWorkflow'                      => __( 'Editor Workflow', 'easymde' ),
			'aboutHelpEditorWorkflowDescription'           => __( 'Use Markdown editing, split Preview, and WordPress-native publishing.', 'easymde' ),
			'aboutHelpConfigurationMigration'              => __( 'Configuration Migration', 'easymde' ),
			'aboutHelpConfigurationMigrationDescription'   => __( 'Export a JSON backup and import it into a compatible EasyMDE version.', 'easymde' ),
			'aboutCurrentVersionBadge'                     => __( 'Current Version', 'easymde' ),
			'aboutVersion018Date'                          => __( '2026-07-16', 'easymde' ),
			'aboutVersion018ChangeReact'                   => __( 'Deliver the ordinary editor through React 18, strict TypeScript, and Vite.', 'easymde' ),
			'aboutVersion018ChangeEditor'                  => __( 'Preserve source and Preview, themes, media, drafts, clipboard, and WeChat export.', 'easymde' ),
			'aboutVersion018ChangeNative'                  => __( 'Keep publishing, taxonomies, featured media, and revisions WordPress-native.', 'easymde' ),
			'aboutVersion017'                              => __( '0.1.7', 'easymde' ),
			'aboutVersion017Date'                          => __( '2026-07-04', 'easymde' ),
			'aboutVersion017ChangeToolbar'                 => __( 'Add a compact icon toolbar and appearance popover.', 'easymde' ),
			'aboutVersion017ChangeShortcuts'               => __( 'Add Typora-inspired shortcuts and rich-text WeChat export.', 'easymde' ),
			'aboutActionPendingNotice'                     => __( 'This About action is not connected to WordPress yet.', 'easymde' ),
			'closeAboutFeedback'                           => __( 'Close About Feedback', 'easymde' ),
		);
	}

	private function get_settings_center_asset( $build_dir = '' ) {
		$build_dir     = $build_dir ? trailingslashit( $build_dir ) : Asset::path( 'assets/build/settings-center/' );
		$manifest_path = $build_dir . 'wordpress-manifest.json';
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- Reads a local committed build manifest, never a remote URL.
		$manifest_json = is_readable( $manifest_path ) ? file_get_contents( $manifest_path ) : false;
		$manifest      = false === $manifest_json ? null : json_decode( $manifest_json, true );
		$entry_key     = 'frontend/src/entrypoints/settings-center.tsx';

		if (
			! is_array( $manifest )
			|| 1 !== ( $manifest['schemaVersion'] ?? null )
			|| ! isset( $manifest['entries'] )
			|| ! is_array( $manifest['entries'] )
			|| array( $entry_key ) !== array_keys( $manifest['entries'] )
			|| ! is_array( $manifest['entries'][ $entry_key ] )
		) {
			throw new \RuntimeException( 'settings-center-manifest-invalid' );
		}

		$entry = $manifest['entries'][ $entry_key ];
		$file  = isset( $entry['file'] ) ? (string) $entry['file'] : '';
		$asset = isset( $entry['asset'] ) ? (string) $entry['asset'] : '';
		if (
			'easymde-admin-settings-center' !== ( $entry['handle'] ?? null )
			|| array( 'wp-element' ) !== ( $entry['dependencies'] ?? null )
			|| array() !== ( $entry['resources'] ?? null )
			|| ! preg_match( '#^assets/settings-center-[A-Za-z0-9_-]+\.js$#', $file )
			|| preg_replace( '/\.js$/', '.asset.php', $file ) !== $asset
		) {
			throw new \RuntimeException( 'settings-center-manifest-invalid' );
		}

		$script_path   = $build_dir . $file;
		$metadata_path = $build_dir . $asset;
		if ( ! is_file( $script_path ) || ! is_readable( $metadata_path ) ) {
			throw new \RuntimeException( 'settings-center-build-missing' );
		}

		$metadata = require $metadata_path;
		if (
			! is_array( $metadata )
			|| array( 'wp-element' ) !== ( $metadata['dependencies'] ?? null )
			|| ! isset( $metadata['version'] )
			|| ! preg_match( '/^[a-f0-9]{16}$/', (string) $metadata['version'] )
		) {
			throw new \RuntimeException( 'settings-center-metadata-invalid' );
		}

		$script_hash = hash_file( 'sha256', $script_path );
		if (
			false === $script_hash
			|| ! hash_equals( (string) $metadata['version'], substr( $script_hash, 0, 16 ) )
		) {
			throw new \RuntimeException( 'settings-center-build-integrity-invalid' );
		}

		return array(
			'handle'       => 'easymde-admin-settings-center',
			'path'         => 'assets/build/settings-center/' . $file,
			'dependencies' => $metadata['dependencies'],
			'version'      => (string) $metadata['version'],
		);
	}

	private function get_static_asset_version( $asset_path ) {
		$path = Asset::path( $asset_path );
		if ( ! is_readable( $path ) ) {
			throw new \RuntimeException( 'settings-center-static-asset-unreadable' );
		}

		$hash = hash_file( 'sha256', $path );
		if ( ! is_string( $hash ) || ! preg_match( '/^[a-f0-9]{64}$/', $hash ) ) {
			throw new \RuntimeException( 'settings-center-static-asset-version-invalid' );
		}

		return substr( $hash, 0, 16 );
	}

	public function sanitize_editor_settings( $input ) {
		$input     = is_array( $input ) ? $input : array();
		$current   = $this->get_editor_settings();
		$registry  = $this->toolbar_registry->get_command_registry();
		$sanitized = array(
			'version'        => $this->options->editor_settings_version(),
			'toolbar_layout' => 'hybrid-icons',
			'shortcuts'      => $this->get_default_shortcuts(),
		);
		if ( isset( $current['settings_center'] ) && is_array( $current['settings_center'] ) ) {
			$sanitized['settings_center'] = $current['settings_center'];
		}
		$errors = array();
		$seen   = array(
			'win' => array(),
			'mac' => array(),
		);

		$input_shortcuts = isset( $input['shortcuts'] ) && is_array( $input['shortcuts'] ) ? $input['shortcuts'] : array();

		foreach ( $registry as $command_id => $command ) {
			foreach ( array( 'win', 'mac' ) as $platform ) {
				$raw_value = '';
				if ( isset( $input_shortcuts[ $command_id ][ $platform ] ) ) {
					$raw_value = trim( (string) $input_shortcuts[ $command_id ][ $platform ] );
				}

				if ( '' === $raw_value ) {
					$raw_value = isset( $sanitized['shortcuts'][ $command_id ][ $platform ] ) ? $sanitized['shortcuts'][ $command_id ][ $platform ] : '';
				}

				$normalized = $this->normalize_shortcut_value( $raw_value, $platform );
				if ( false === $normalized ) {
					$errors[] = sprintf(
						/* translators: 1: toolbar command label, 2: platform label. */
						__( 'Invalid shortcut value for %1$s (%2$s). Use combinations like Ctrl+B or Command+Option+C.', 'easymde' ),
						// phpcs:ignore WordPress.WP.I18n.LowLevelTranslationFunction,WordPress.WP.I18n.NonSingularStringLiteralText -- Compatibility API labels are dynamic extension data seeded from extractable source labels.
						translate( $command['label'], 'easymde' ),
						$this->get_platform_label( $platform )
					);
					continue;
				}

				$sanitized['shortcuts'][ $command_id ][ $platform ] = $normalized;

				if ( '' !== $normalized ) {
					if ( isset( $seen[ $platform ][ $normalized ] ) ) {
						$errors[] = sprintf(
							/* translators: 1: first toolbar command label, 2: second toolbar command label, 3: shortcut, 4: platform label. */
							__( 'Shortcut conflict: %1$s and %2$s both use %3$s on %4$s.', 'easymde' ),
							$seen[ $platform ][ $normalized ],
							// phpcs:ignore WordPress.WP.I18n.LowLevelTranslationFunction,WordPress.WP.I18n.NonSingularStringLiteralText -- Compatibility API labels are dynamic extension data seeded from extractable source labels.
							translate( $command['label'], 'easymde' ),
							$normalized,
							$this->get_platform_label( $platform )
						);
						continue;
					}

					// phpcs:ignore WordPress.WP.I18n.LowLevelTranslationFunction,WordPress.WP.I18n.NonSingularStringLiteralText -- Compatibility API labels are dynamic extension data seeded from extractable source labels.
					$seen[ $platform ][ $normalized ] = translate( $command['label'], 'easymde' );
				}
			}
		}

		if ( ! empty( $errors ) ) {
			foreach ( $errors as $index => $message ) {
				add_settings_error(
					$this->options->editor_settings_key(),
					'easymde_shortcut_error_' . $index,
					$message,
					'error'
				);
			}

			return $current;
		}

		return $sanitized;
	}

	public function get_editor_settings() {
		$defaults = array(
			'version'        => $this->options->editor_settings_version(),
			'toolbar_layout' => 'hybrid-icons',
			'shortcuts'      => $this->get_default_shortcuts(),
		);
		$stored   = $this->options->get_editor_settings();
		if ( ! is_array( $stored ) ) {
			return $defaults;
		}

		$settings = $defaults;

		if ( ! empty( $stored['version'] ) && is_string( $stored['version'] ) ) {
			$settings['version'] = sanitize_text_field( $stored['version'] );
		}

		if ( ! empty( $stored['toolbar_layout'] ) && 'hybrid-icons' === $stored['toolbar_layout'] ) {
			$settings['toolbar_layout'] = 'hybrid-icons';
		}

		if ( ! empty( $stored['shortcuts'] ) && is_array( $stored['shortcuts'] ) ) {
			foreach ( $this->toolbar_registry->get_command_registry() as $command_id => $command ) {
				unset( $command );
				foreach ( array( 'win', 'mac' ) as $platform ) {
					if ( ! isset( $stored['shortcuts'][ $command_id ][ $platform ] ) ) {
						continue;
					}

					$normalized = $this->normalize_shortcut_value( $stored['shortcuts'][ $command_id ][ $platform ], $platform );
					if ( false !== $normalized && '' !== $normalized ) {
						$settings['shortcuts'][ $command_id ][ $platform ] = $normalized;
					}
				}
			}
		}

		return $settings;
	}

	public function get_shortcut_config_for_script() {
		$settings  = $this->get_editor_settings();
		$registry  = $this->toolbar_registry->get_command_registry();
		$shortcuts = array();

		foreach ( $registry as $command_id => $command ) {
			unset( $command );
			$shortcuts[ $command_id ] = array(
				'win' => isset( $settings['shortcuts'][ $command_id ]['win'] ) ? $settings['shortcuts'][ $command_id ]['win'] : '',
				'mac' => isset( $settings['shortcuts'][ $command_id ]['mac'] ) ? $settings['shortcuts'][ $command_id ]['mac'] : '',
			);
		}

		return $shortcuts;
	}

	private function get_default_shortcuts() {
		$shortcuts = array();

		foreach ( $this->toolbar_registry->get_command_registry() as $command_id => $command ) {
			$shortcuts[ $command_id ] = array(
				'win' => isset( $command['defaultShortcutWin'] ) ? (string) $command['defaultShortcutWin'] : '',
				'mac' => isset( $command['defaultShortcutMac'] ) ? (string) $command['defaultShortcutMac'] : '',
			);
		}

		return $shortcuts;
	}

	private function get_platform_label( $platform ) {
		return 'mac' === $platform ? __( 'macOS', 'easymde' ) : __( 'Windows / Linux', 'easymde' );
	}

	private function normalize_shortcut_value( $value, $platform ) {
		$value = trim( (string) $value );
		if ( '' === $value ) {
			return '';
		}

		$parts = preg_split( '/\s*\+\s*/', $value );
		if ( ! $parts || count( $parts ) < 2 ) {
			return false;
		}

		$modifiers = array();
		$key       = '';
		foreach ( $parts as $part ) {
			if ( '' === $part ) {
				return false;
			}

			$modifier = $this->normalize_shortcut_modifier( $part, $platform );
			if ( '' !== $modifier ) {
				if ( isset( $modifiers[ $modifier ] ) ) {
					return false;
				}

				$modifiers[ $modifier ] = true;
				continue;
			}

			$normalized_key = $this->normalize_shortcut_key( $part );
			if ( '' === $normalized_key || '' !== $key ) {
				return false;
			}

			$key = $normalized_key;
		}

		if ( '' === $key || empty( $modifiers ) ) {
			return false;
		}

		$order = 'mac' === $platform
			? array( 'Cmd', 'Ctrl', 'Option', 'Shift' )
			: array( 'Ctrl', 'Alt', 'Shift', 'Meta' );

		$normalized_parts = array();
		foreach ( $order as $modifier ) {
			if ( isset( $modifiers[ $modifier ] ) ) {
				$normalized_parts[] = $modifier;
			}
		}

		$normalized_parts[] = $key;

		return implode( '+', $normalized_parts );
	}

	private function normalize_shortcut_modifier( $modifier, $platform ) {
		$modifier = strtolower( trim( (string) $modifier ) );
		if ( '' === $modifier ) {
			return '';
		}

		if ( in_array( $modifier, array( 'mod', 'cmd', 'command', 'meta', 'super', 'win' ), true ) ) {
			return 'mac' === $platform ? 'Cmd' : ( 'mod' === $modifier ? 'Ctrl' : 'Meta' );
		}

		if ( in_array( $modifier, array( 'ctrl', 'control', 'ctl' ), true ) ) {
			return 'Ctrl';
		}

		if ( in_array( $modifier, array( 'alt', 'option', 'opt' ), true ) ) {
			return 'mac' === $platform ? 'Option' : 'Alt';
		}

		if ( 'shift' === $modifier ) {
			return 'Shift';
		}

		return '';
	}

	private function normalize_shortcut_key( $key ) {
		$key = trim( (string) $key );
		if ( '' === $key ) {
			return '';
		}

		$lower        = strtolower( $key );
		$special_keys = array(
			'tab'        => 'Tab',
			'enter'      => 'Enter',
			'return'     => 'Enter',
			'space'      => 'Space',
			'spacebar'   => 'Space',
			'escape'     => 'Escape',
			'esc'        => 'Escape',
			'backspace'  => 'Backspace',
			'delete'     => 'Delete',
			'del'        => 'Delete',
			'up'         => 'Up',
			'arrowup'    => 'Up',
			'down'       => 'Down',
			'arrowdown'  => 'Down',
			'left'       => 'Left',
			'arrowleft'  => 'Left',
			'right'      => 'Right',
			'arrowright' => 'Right',
			'home'       => 'Home',
			'end'        => 'End',
			'pageup'     => 'PageUp',
			'pagedown'   => 'PageDown',
		);

		if ( isset( $special_keys[ $lower ] ) ) {
			return $special_keys[ $lower ];
		}

		if ( preg_match( '/^f([1-9]|1[0-2])$/i', $key ) ) {
			return strtoupper( $key );
		}

		if ( 1 === strlen( $key ) ) {
			if ( preg_match( '/[a-z]/i', $key ) ) {
				return strtoupper( $key );
			}

			if ( preg_match( '/[0-9\[\]`\\\\\\/\\.,\\-=]/', $key ) ) {
				return $key;
			}
		}

		return '';
	}
}
