<?php

namespace EasyMDE\Admin;

use EasyMDE\Content\MarkdownRenderer;
use EasyMDE\Support\Asset;
use EasyMDE\Support\Options;
use EasyMDE\Support\ToolbarRegistry;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class SettingsPage {

	private $toolbar_registry;
	private $options;

	public function __construct( ToolbarRegistry $toolbar_registry, Options $options ) {
		$this->toolbar_registry = $toolbar_registry;
		$this->options          = $options;
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
			'easymde-settings-center',
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

		if ( 'toplevel_page_easymde-settings-center' !== $hook || ! current_user_can( 'manage_options' ) ) {
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
		return array(
			'schemaVersion' => 1,
			'closeUrl'      => admin_url( 'options-general.php?page=easymde' ),
			'assets'        => array(
				'brandMarkUrl'               => Asset::url( 'assets/images/settings-center/brand-icon-clean.png' ),
				'headerIllustrationUrl'      => Asset::url( 'assets/images/settings-center/header-illustration.png' ),
				'searchEmptyIllustrationUrl' => Asset::url( 'assets/images/settings-center/search-empty-illustration.png' ),
			),
			'strings'       => $this->get_settings_center_strings(),
		);
	}

	private function get_settings_center_strings() {
		return array(
			'brandName'                            => __( 'EasyMDE', 'easymde' ),
			'settingsCenter'                       => __( 'Settings Center', 'easymde' ),
			'settingsNavigation'                   => __( 'Settings center navigation', 'easymde' ),
			'helpTitle'                            => __( 'Help', 'easymde' ),
			'helpDescription'                      => __( 'Documentation, FAQs, and usage guides', 'easymde' ),
			'openDocumentation'                    => __( 'View documentation', 'easymde' ),
			'closeSettingsCenter'                  => __( 'Close settings center', 'easymde' ),
			'searchSettings'                       => __( 'Search all settings', 'easymde' ),
			'searchSettingsPlaceholder'            => __( 'Search all plugin settings...', 'easymde' ),
			'clearSearch'                          => __( 'Clear search', 'easymde' ),
			'searchPageTitle'                      => __( 'Search Settings', 'easymde' ),
			/* translators: %s: settings search query. */
			'searchPageDescription'                => __( 'Only settings matching "%s" are shown.', 'easymde' ),
			/* translators: %s: settings search query. */
			'noSearchResults'                      => __( 'No settings related to "%s" were found', 'easymde' ),
			'noSearchResultsDescription'           => __( 'Try a setting name, feature keyword, or service name.', 'easymde' ),
			'general'                              => __( 'General Settings', 'easymde' ),
			'shortcuts'                            => __( 'Keyboard Shortcuts', 'easymde' ),
			'images'                               => __( 'Image Hosting', 'easymde' ),
			'ai'                                   => __( 'AI Settings', 'easymde' ),
			'markdown'                             => __( 'Markdown Settings', 'easymde' ),
			'sync'                                 => __( 'Article Sync', 'easymde' ),
			'transfer'                             => __( 'Import / Export', 'easymde' ),
			'about'                                => __( 'About Us', 'easymde' ),
			'generalDescription'                   => __( 'Configure EasyMDE basic behavior and interface preferences in WordPress.', 'easymde' ),
			'shortcutsDescription'                 => __( 'Configure shortcuts for common actions on Windows, Linux, and macOS.', 'easymde' ),
			'imagesDescription'                    => __( 'Configure image upload and storage services, including common hosts and custom upload solutions.', 'easymde' ),
			'aiDescription'                        => __( 'Configure AI services and writing assistance for EasyMDE in WordPress.', 'easymde' ),
			'markdownDescription'                  => __( 'Customize Markdown editor behavior and rendering for a more comfortable writing experience.', 'easymde' ),
			'syncDescription'                      => __( 'Configure article synchronization to publishing platforms and manage synchronization history.', 'easymde' ),
			'transferDescription'                  => __( 'Export plugin settings to a local file or import them for migration and backup.', 'easymde' ),
			'aboutDescription'                     => __( 'Learn about the EasyMDE plugin, version status, and related resources.', 'easymde' ),
			'sectionPending'                       => __( 'This settings section is not connected yet.', 'easymde' ),
			'sectionPendingDescription'            => __( 'Its real WordPress data interface will be connected in a later step.', 'easymde' ),
			'basePreferences'                      => __( 'Basic Preferences', 'easymde' ),
			'editorBehavior'                       => __( 'Editor Behavior', 'easymde' ),
			'documentDefaults'                     => __( 'Document Defaults', 'easymde' ),
			'interfaceLanguage'                    => __( 'Interface Language', 'easymde' ),
			'defaultEditingMode'                   => __( 'Default Editing Mode', 'easymde' ),
			'autoFocusEditor'                      => __( 'Auto-focus Editor', 'easymde' ),
			'autoFocusEditorDescription'           => __( 'Automatically focus the editor when creating a new article', 'easymde' ),
			'showLineNumbers'                      => __( 'Show Line Numbers', 'easymde' ),
			'showLineNumbersDescription'           => __( 'Show line numbers on the left side of the editor', 'easymde' ),
			'syntaxHighlight'                      => __( 'Code Highlighting', 'easymde' ),
			'syntaxHighlightDescription'           => __( 'Enable code syntax highlighting', 'easymde' ),
			'statusBarDisplay'                     => __( 'Status Bar Display', 'easymde' ),
			'autoSave'                             => __( 'Auto Save', 'easymde' ),
			'autoSaveDescription'                  => __( 'Periodically save content to prevent accidental loss', 'easymde' ),
			'autoSaveInterval'                     => __( 'Auto Save Interval', 'easymde' ),
			'syncScroll'                           => __( 'Synchronized Scrolling (Preview and Editor)', 'easymde' ),
			'syncScrollDescription'                => __( 'Synchronize scrolling between the preview and editor areas', 'easymde' ),
			'cleanPastedContent'                   => __( 'Clean Pasted Content', 'easymde' ),
			'cleanPastedContentDescription'        => __( 'Automatically remove unnecessary formatting when pasting', 'easymde' ),
			'smartListRecognition'                 => __( 'Smart List Recognition', 'easymde' ),
			'smartListRecognitionDescription'      => __( 'Convert - or 1. to a list automatically', 'easymde' ),
			'defaultCategory'                      => __( 'Default Category Behavior', 'easymde' ),
			'defaultVisibility'                    => __( 'Default Publish Visibility', 'easymde' ),
			'openPreviewAfterPublish'              => __( 'Open Preview After Publishing', 'easymde' ),
			'openPreviewAfterPublishDescription'   => __( 'Automatically open the article preview after publishing or updating', 'easymde' ),
			'summaryMode'                          => __( 'Default Summary Sync Method', 'easymde' ),
			'summaryModeDescription'               => __( 'Automatically extract the summary from the beginning of the content', 'easymde' ),
			'featuredImagePlaceholder'             => __( 'Featured Image Placeholder', 'easymde' ),
			'featuredImagePlaceholderDescription'  => __( 'Show a placeholder prompt when no featured image is set', 'easymde' ),
			'simplifiedChinese'                    => __( 'Simplified Chinese', 'easymde' ),
			'traditionalChinese'                   => __( 'Traditional Chinese', 'easymde' ),
			'english'                              => __( 'English', 'easymde' ),
			'livePreview'                          => __( 'Live Preview (WYSIWYG)', 'easymde' ),
			'sourceEditing'                        => __( 'Source Editing', 'easymde' ),
			'previewOnly'                          => __( 'Preview Only', 'easymde' ),
			'wordsAndReadingTime'                  => __( 'Show Word Count and Reading Time', 'easymde' ),
			'wordsOnly'                            => __( 'Show Word Count Only', 'easymde' ),
			'hiddenStatusBar'                      => __( 'Hide Status Bar', 'easymde' ),
			'seconds30'                            => __( '30 seconds', 'easymde' ),
			'seconds60'                            => __( '60 seconds', 'easymde' ),
			'minutes2'                             => __( '2 minutes', 'easymde' ),
			'minutes5'                             => __( '5 minutes', 'easymde' ),
			'noAutomaticCategory'                  => __( 'Do Not Categorize Automatically', 'easymde' ),
			'currentCategory'                      => __( 'Use Current Category', 'easymde' ),
			'publicVisibility'                     => __( 'Public', 'easymde' ),
			'privateVisibility'                    => __( 'Private', 'easymde' ),
			'passwordProtected'                    => __( 'Password Protected', 'easymde' ),
			'summary55'                            => __( 'Automatically Extract (First 55 Characters)', 'easymde' ),
			'summary100'                           => __( 'Automatically Extract (First 100 Characters)', 'easymde' ),
			'manualSummary'                        => __( 'Enter Manually', 'easymde' ),
			'commonShortcuts'                      => __( 'Common Shortcuts', 'easymde' ),
			'headingAndFormatting'                 => __( 'Headings and Formatting', 'easymde' ),
			'shortcutBehavior'                     => __( 'Shortcut Behavior', 'easymde' ),
			'restoreDefaultShortcuts'              => __( 'Restore Default Shortcuts', 'easymde' ),
			'shortcutFunction'                     => __( 'Function', 'easymde' ),
			'windowsLinux'                         => __( 'Windows / Linux', 'easymde' ),
			'macOS'                                => __( 'macOS', 'easymde' ),
			'saveArticle'                          => __( 'Save Article', 'easymde' ),
			'bold'                                 => __( 'Bold', 'easymde' ),
			'italic'                               => __( 'Italic', 'easymde' ),
			'insertLink'                           => __( 'Insert Link', 'easymde' ),
			'insertImage'                          => __( 'Insert Image', 'easymde' ),
			'openAiAssistant'                      => __( 'Open AI Assistant', 'easymde' ),
			'headingOne'                           => __( 'Heading 1', 'easymde' ),
			'headingTwo'                           => __( 'Heading 2', 'easymde' ),
			'quote'                                => __( 'Quote', 'easymde' ),
			'unorderedList'                        => __( 'Unordered List', 'easymde' ),
			'orderedList'                          => __( 'Ordered List', 'easymde' ),
			'showShortcutHints'                    => __( 'Show Shortcut Hints', 'easymde' ),
			'showShortcutHintsDescription'         => __( 'Show shortcut hints in the toolbar and action menus.', 'easymde' ),
			'detectShortcutConflicts'              => __( 'Detect and Warn About Conflicts', 'easymde' ),
			'detectShortcutConflictsDescription'   => __( 'Automatically warn and highlight when shortcut conflicts are detected.', 'easymde' ),
			'customShortcutSuggestions'            => __( 'Custom Shortcut Suggestions', 'easymde' ),
			'customShortcutSuggestionsDescription' => __( 'Clearing an input and saving restores that item\'s default shortcut.', 'easymde' ),
			'imageHostService'                     => __( 'Image Host Service', 'easymde' ),
			'selectImageHostService'               => __( 'Select Image Host Service', 'easymde' ),
			'cloudflareR2'                         => __( 'Cloudflare R2', 'easymde' ),
			'aliyunOss'                            => __( 'Alibaba Cloud OSS', 'easymde' ),
			'tencentCloudCos'                      => __( 'Tencent Cloud COS', 'easymde' ),
			'customUpload'                         => __( 'Custom Upload', 'easymde' ),
			'bucket'                               => __( 'Storage Space / Bucket', 'easymde' ),
			'customDomain'                         => __( 'Custom Domain', 'easymde' ),
			'accessKey'                            => __( 'Access Key', 'easymde' ),
			'secretKey'                            => __( 'Secret Key', 'easymde' ),
			'showSecret'                           => __( 'Show Secret', 'easymde' ),
			'hideSecret'                           => __( 'Hide Secret', 'easymde' ),
			'fileNameRule'                         => __( 'File Name Rule', 'easymde' ),
			'fileNameRuleDescription'              => __( 'Choose a template or combine variables to customize the storage path.', 'easymde' ),
			'commonFileNameTemplates'              => __( 'Common Naming Templates', 'easymde' ),
			'selectTemplateToFillRule'             => __( 'Select one to fill the rule automatically', 'easymde' ),
			'fileNamePresetDate'                   => __( 'Date Archive', 'easymde' ),
			'fileNamePresetMd5'                    => __( 'MD5 Content Hash', 'easymde' ),
			'fileNamePresetYearMonth'              => __( 'Year and Month Directory', 'easymde' ),
			'fileNamePresetOriginal'               => __( 'Keep Original Name', 'easymde' ),
			'fileNamePresetArticle'                => __( 'Article Directory', 'easymde' ),
			'fileNamePresetTime'                   => __( 'Time-based Name', 'easymde' ),
			'availableVariables'                   => __( 'Available Variables', 'easymde' ),
			'yearVariable'                         => __( 'Year', 'easymde' ),
			'monthVariable'                        => __( 'Month', 'easymde' ),
			'dayVariable'                          => __( 'Day', 'easymde' ),
			'fullDateVariable'                     => __( 'Full Date', 'easymde' ),
			'uploadTimeVariable'                   => __( 'Upload Time', 'easymde' ),
			'postIdVariable'                       => __( 'Post ID', 'easymde' ),
			'fileMd5Variable'                      => __( 'File MD5', 'easymde' ),
			'uuidVariable'                         => __( 'Unique Identifier', 'easymde' ),
			'originalNameVariable'                 => __( 'Original File Name', 'easymde' ),
			'extensionVariable'                    => __( 'File Extension', 'easymde' ),
			/* translators: %s: file-name rule variable label. */
			'insertFileNameVariable'               => __( 'Insert %s variable', 'easymde' ),
			'examplePreview'                       => __( 'Example Preview', 'easymde' ),
			'enterFileNameRule'                    => __( 'Enter a file name rule', 'easymde' ),
			'connectionStatus'                     => __( 'Connection Status', 'easymde' ),
			'pendingTest'                          => __( 'Pending Test', 'easymde' ),
			'testConnection'                       => __( 'Test Connection', 'easymde' ),
			'backupImageHost'                      => __( 'Backup Image Host', 'easymde' ),
			'backupImageHostDescription'           => __( 'After the primary image host succeeds, continue writing to backup storage. By default, backup failures do not affect the primary URL.', 'easymde' ),
			'enableBackupImageHost'                => __( 'Enable Backup Image Host', 'easymde' ),
			'enableBackupImageHostDescription'     => __( 'Write the same file content and object path to a second storage service.', 'easymde' ),
			'backupImageHostService'               => __( 'Backup Image Host Service', 'easymde' ),
			'qiniuKodo'                            => __( 'Qiniu Kodo', 'easymde' ),
			'backupBucket'                         => __( 'Backup Storage Space / Bucket', 'easymde' ),
			'backupDomain'                         => __( 'Backup Custom Domain', 'easymde' ),
			'backupAccessKey'                      => __( 'Backup Access Key', 'easymde' ),
			'backupSecretKey'                      => __( 'Backup Secret Key', 'easymde' ),
			'showBackupAccessKey'                  => __( 'Show Backup Access Key', 'easymde' ),
			'hideBackupAccessKey'                  => __( 'Hide Backup Access Key', 'easymde' ),
			'showBackupSecretKey'                  => __( 'Show Backup Secret Key', 'easymde' ),
			'hideBackupSecretKey'                  => __( 'Hide Backup Secret Key', 'easymde' ),
			'keepSameObjectPath'                   => __( 'Keep the Same Object Path', 'easymde' ),
			'keepSameObjectPathDescription'        => __( 'Use the same file-name rule and object key for the primary and backup hosts.', 'easymde' ),
			'backupFailureHandling'                => __( 'Backup Failure Handling', 'easymde' ),
			'backupFailureHandlingDescription'     => __( 'Control whether the primary upload result remains available when the backup write fails.', 'easymde' ),
			'returnPrimaryUrlOnBackupFailure'      => __( 'Record Error and Return Primary Image Host URL', 'easymde' ),
			'failEntireUpload'                     => __( 'Fail Entire Upload and Prompt to Retry', 'easymde' ),
			'backupConnectionStatus'               => __( 'Backup Connection Status', 'easymde' ),
			'testBackupConnection'                 => __( 'Test Backup Connection', 'easymde' ),
			'uploadBehavior'                       => __( 'Upload Behavior', 'easymde' ),
			'insertMarkdownAfterUpload'            => __( 'Insert Markdown Link After Upload', 'easymde' ),
			'compressImages'                       => __( 'Compress Images Automatically', 'easymde' ),
			'compressImagesDescription'            => __( 'Compress images before upload to save storage space.', 'easymde' ),
			'preserveOriginalFileName'             => __( 'Preserve Original File Name', 'easymde' ),
			'preserveOriginalFileNameDescription'  => __( 'Do not rename uploaded files; preserve their original file names.', 'easymde' ),
			'copyImageUrl'                         => __( 'Copy Image URL to Clipboard', 'easymde' ),
			'copyImageUrlDescription'              => __( 'Copy the image URL automatically after a successful upload.', 'easymde' ),
			'retryFailedUpload'                    => __( 'Retry When Upload Fails', 'easymde' ),
			'doNotRetry'                           => __( 'Do Not Retry', 'easymde' ),
			'retryOnce'                            => __( 'Retry Once', 'easymde' ),
			'retryTwice'                           => __( 'Retry Twice', 'easymde' ),
			'retryThreeTimes'                      => __( 'Retry Three Times', 'easymde' ),
			'maximumImageSize'                     => __( 'Maximum Image Size', 'easymde' ),
			'originalImageSize'                    => __( 'Original Size', 'easymde' ),
			'imageSize1920'                        => __( '1920px', 'easymde' ),
			'imageSize2560'                        => __( '2560px', 'easymde' ),
			'imageSize3840'                        => __( '3840px', 'easymde' ),
			'allowedUploadFormats'                 => __( 'Allowed Upload Formats', 'easymde' ),
			'allowedUploadFormatsDescription'      => __( 'Select the image file formats that the editor may choose and upload.', 'easymde' ),
			'uploadFormatJpg'                      => __( 'JPG / JPEG / JFIF', 'easymde' ),
			'uploadFormatPng'                      => __( 'PNG', 'easymde' ),
			'uploadFormatWebp'                     => __( 'WebP', 'easymde' ),
			'uploadFormatGif'                      => __( 'GIF', 'easymde' ),
			'allowUploadJpg'                       => __( 'Allow Uploading JPG / JPEG / JFIF Format', 'easymde' ),
			'allowUploadPng'                       => __( 'Allow Uploading PNG Format', 'easymde' ),
			'allowUploadWebp'                      => __( 'Allow Uploading WebP Format', 'easymde' ),
			'allowUploadGif'                       => __( 'Allow Uploading GIF Format', 'easymde' ),
			'uploadFormatSeparator'                => __( ',', 'easymde' ),
			'defaultInsertion'                     => __( 'Default Insertion and Description', 'easymde' ),
			'defaultInsertFormat'                  => __( 'Default Insert Format', 'easymde' ),
			'markdownImage'                        => __( 'Markdown Image', 'easymde' ),
			'htmlImage'                            => __( 'HTML Image', 'easymde' ),
			'urlOnly'                              => __( 'Insert URL Only', 'easymde' ),
			'altTextSource'                        => __( 'Alt Text Source', 'easymde' ),
			'useFileName'                          => __( 'Use File Name', 'easymde' ),
			'leaveEmpty'                           => __( 'Leave Empty', 'easymde' ),
			'fillOnUpload'                         => __( 'Fill In During Upload', 'easymde' ),
			'imageTitleField'                      => __( 'Image Title Field', 'easymde' ),
			'doNotInsert'                          => __( 'Do Not Insert', 'easymde' ),
			/* translators: %s: comma-separated image upload format labels. */
			'currentAllowedUploads'                => __( 'Currently allowed uploads: %s.', 'easymde' ),
			'compressLargeImagesRecommendation'    => __( 'We recommend enabling automatic compression before uploading large images.', 'easymde' ),
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
		$errors    = array();
		$seen      = array(
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
