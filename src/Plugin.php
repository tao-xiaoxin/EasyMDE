<?php

namespace EasyMDE;

use EasyMDE\Admin\AdminAssets;
use EasyMDE\Admin\EditorSaveHandler;
use EasyMDE\Admin\EditorScreen;
use EasyMDE\Admin\PostModeController;
use EasyMDE\Admin\SettingsPage;
use EasyMDE\Content\MarkdownFeatureDetector;
use EasyMDE\Content\PostDocument;
use EasyMDE\Content\RevisionManager;
use EasyMDE\Frontend\ContentFilter;
use EasyMDE\Frontend\FrontendAssets;
use EasyMDE\Rest\CustomCssController;
use EasyMDE\Rest\MediaController;
use EasyMDE\Rest\PreviewController;
use EasyMDE\Rest\RevisionController;
use EasyMDE\Rest\ThemeController;
use EasyMDE\Support\Capabilities;
use EasyMDE\Support\Migration;
use EasyMDE\Support\Options;
use EasyMDE\Support\ToolbarRegistry;
use EasyMDE\Theme\ArticleThemeRegistry;
use EasyMDE\Theme\CodeThemeRegistry;
use EasyMDE\Theme\CustomCssPolicy;
use EasyMDE\Theme\ThemeStateRepository;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class Plugin {

	private static $instance          = null;
	private static $textdomain_loaded = false;

	private $toolbar_registry;
	private $rest_controllers = array();

	public static function init() {
		self::maybe_load_textdomain();

		if ( null === self::$instance ) {
			self::$instance = new self();
			self::$instance->register_hooks();
		}

		return self::$instance;
	}

	public static function instance() {
		return self::init();
	}

	public static function load_textdomain() {
		if ( self::$textdomain_loaded ) {
			return;
		}

		self::$textdomain_loaded = true;

		load_plugin_textdomain(
			'easymde',
			false,
			dirname( plugin_basename( EASYMDE_PLUGIN_FILE ) ) . '/languages'
		);
	}

	private static function maybe_load_textdomain() {
		if ( did_action( 'init' ) ) {
			self::load_textdomain();
			return;
		}

		if ( ! has_action( 'init', array( __CLASS__, 'load_textdomain' ) ) ) {
			add_action( 'init', array( __CLASS__, 'load_textdomain' ) );
		}
	}

	private function __construct() {
		$migration              = new Migration();
		$options                = new Options();
		$post_document          = new PostDocument( $migration );
		$capabilities           = new Capabilities();
		$article_themes         = new ArticleThemeRegistry();
		$code_themes            = new CodeThemeRegistry();
		$custom_css_policy      = new CustomCssPolicy();
		$theme_state_repository = new ThemeStateRepository( $article_themes, $code_themes, $custom_css_policy );
		$feature_detector       = new MarkdownFeatureDetector();

		$this->toolbar_registry = new ToolbarRegistry();

		$settings_page        = new SettingsPage( $this->toolbar_registry, $options );
		$post_mode_controller = new PostModeController( $post_document );
		$frontend_assets      = new FrontendAssets( $post_document, $theme_state_repository, $feature_detector );

		$modules = array(
			$settings_page,
			$post_mode_controller,
			new EditorScreen( $post_document, $post_mode_controller, $theme_state_repository, $options ),
			new AdminAssets( $post_mode_controller, $frontend_assets, $theme_state_repository, $this->toolbar_registry, $settings_page ),
			new EditorSaveHandler( $post_document, $theme_state_repository ),
			$frontend_assets,
			new ContentFilter( $post_document, $theme_state_repository ),
			new RevisionManager( $post_document, $theme_state_repository ),
		);

		foreach ( $modules as $module ) {
			if ( method_exists( $module, 'register_hooks' ) ) {
				$module->register_hooks();
			}
		}

		$this->rest_controllers = array(
			new PreviewController( $capabilities, $theme_state_repository, $feature_detector ),
			new RevisionController( $capabilities, $post_document ),
			new MediaController( $capabilities ),
			new ThemeController( $capabilities, $theme_state_repository ),
			new CustomCssController( $capabilities, $theme_state_repository, $custom_css_policy ),
		);
	}

	public function register_hooks() {
		add_action( 'rest_api_init', array( $this, 'register_rest_routes' ) );
	}

	public function register_rest_routes() {
		foreach ( $this->rest_controllers as $controller ) {
			$controller->register_routes();
		}
	}

	public function register_toolbar_button( $id, array $config ) {
		$this->toolbar_registry->register_toolbar_button( $id, $config );
	}

	public function register_shortcode_helper( $id, array $config ) {
		$this->toolbar_registry->register_shortcode_helper( $id, $config );
	}
}
