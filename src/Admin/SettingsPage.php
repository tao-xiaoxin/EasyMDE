<?php

namespace EasyMDE\Admin;

use EasyMDE\Support\Asset;
use EasyMDE\Support\SettingsCenterRepository;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class SettingsPage {

	private const SETTINGS_CENTER_PAGE_SLUG = 'easymde';
	private const SETTINGS_CENTER_ROUTE     = '/general_setting';

	private $settings_center_repository;

	public function __construct( SettingsCenterRepository $settings_center_repository ) {
		$this->settings_center_repository = $settings_center_repository;
	}

	public function register_hooks() {
		add_action( 'admin_menu', array( $this, 'register_admin_menu' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'enqueue_assets' ) );
		add_action( 'admin_head-toplevel_page_' . self::SETTINGS_CENTER_PAGE_SLUG, array( $this, 'render_settings_center_favicon' ) );
		add_action( 'load-toplevel_page_' . self::SETTINGS_CENTER_PAGE_SLUG, array( $this, 'enforce_settings_center_route' ) );
		add_filter( 'submenu_file', array( $this, 'filter_settings_center_submenu_file' ), 10, 2 );
	}

	public function register_admin_menu() {
		$settings_page_slug = self::SETTINGS_CENTER_PAGE_SLUG;
		$route_menu_slug    = $settings_page_slug . '&route=' . self::SETTINGS_CENTER_ROUTE;
		add_menu_page(
			__( 'EasyMDE Settings Center', 'easymde' ),
			__( 'EasyMDE', 'easymde' ),
			'manage_options',
			$settings_page_slug,
			array( $this, 'render_settings_center' ),
			Asset::url( 'assets/images/easymde-editor-icon.png' ),
			81
		);
		add_submenu_page(
			$settings_page_slug,
			__( 'EasyMDE Settings Center', 'easymde' ),
			__( 'Settings Center', 'easymde' ),
			'manage_options',
			$route_menu_slug,
			array( $this, 'render_settings_center' )
		);
		$this->promote_settings_center_route_submenu( $settings_page_slug, $route_menu_slug );

		$update_capability = $this->get_update_page_capability();
		if ( '' !== $update_capability ) {
			add_submenu_page(
				$settings_page_slug,
				__( 'EasyMDE Updates', 'easymde' ),
				__( 'Updates', 'easymde' ),
				$update_capability,
				'plugins.php?plugin_status=upgrade'
			);
		}
	}

	/**
	 * Keep the top-level menu on the canonical page slug while making its first
	 * submenu link the explicit Settings Center route.
	 *
	 * WordPress automatically inserts the parent item before a first submenu
	 * whose slug differs from the parent. Removing that synthetic item lets the
	 * core menu renderer emit `admin.php?page=easymde&route=/general_setting`,
	 * while the top-level `easymde` page hook remains the execution owner.
	 */
	private function promote_settings_center_route_submenu( $parent_slug, $route_menu_slug ) {
		global $submenu;

		if ( empty( $submenu[ $parent_slug ] ) ) {
			return;
		}

		$route_item  = null;
		$route_index = null;
		foreach ( $submenu[ $parent_slug ] as $index => $item ) {
			if ( $route_menu_slug === $item[2] ) {
				$route_item  = $item;
				$route_index = $index;
				break;
			}
		}

		if ( null === $route_item || null === $route_index ) {
			return;
		}

		array_splice( $submenu[ $parent_slug ], $route_index, 1 );
		foreach ( $submenu[ $parent_slug ] as $index => $item ) {
			if ( $parent_slug === $item[2] ) {
				array_splice( $submenu[ $parent_slug ], $index, 1 );
				break;
			}
		}

		array_unshift( $submenu[ $parent_slug ], $route_item );
	}

	/**
	 * Redirect direct no-route visits to the explicit General route and fail
	 * clearly when a caller supplies an unsupported route.
	 */
	public function enforce_settings_center_route() {
		if ( ! $this->is_canonical_settings_screen() ) {
			return;
		}

		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only route selection for an admin screen.
		$route = isset( $_GET['route'] ) ? wp_unslash( $_GET['route'] ) : null;
		if ( self::SETTINGS_CENTER_ROUTE === $route ) {
			return;
		}

		if ( null === $route || '' === $route ) {
			wp_safe_redirect( $this->get_settings_center_url() );
			exit;
		}

		wp_die(
			esc_html__( 'The EasyMDE settings route is not supported.', 'easymde' ),
			esc_html__( 'EasyMDE Settings Center', 'easymde' ),
			array(
				'response'  => 404,
				'back_link' => true,
			)
		);
	}

	public function filter_settings_center_submenu_file( $submenu_file, $parent_file ) {
		if ( self::SETTINGS_CENTER_PAGE_SLUG !== $parent_file ) {
			return $submenu_file;
		}

		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only route selection for menu highlighting.
		$route = isset( $_GET['route'] ) ? wp_unslash( $_GET['route'] ) : null;
		if ( self::SETTINGS_CENTER_ROUTE === $route ) {
			return self::SETTINGS_CENTER_PAGE_SLUG . '&route=' . self::SETTINGS_CENTER_ROUTE;
		}

		return $submenu_file;
	}

	private function get_update_page_capability() {
		return current_user_can( 'update_plugins' ) ? 'update_plugins' : '';
	}

	public function enqueue_assets( $hook ) {
		if ( current_user_can( 'manage_options' ) ) {
			try {
				$menu_version = $this->get_static_asset_version( 'assets/css/admin/menu.css' );
				wp_enqueue_style(
					'easymde-admin-menu',
					Asset::url( 'assets/css/admin/menu.css' ),
					array(),
					$menu_version
				);
			} catch ( \Throwable $error ) {
				wp_trigger_error(
					__METHOD__,
					'EasyMDE admin menu style contract failed (admin-menu-style-invalid).',
					E_USER_WARNING
				);
			}
		}

		if (
			! $this->is_canonical_settings_screen()
			|| 'toplevel_page_' . self::SETTINGS_CENTER_PAGE_SLUG !== $hook
			|| ! current_user_can( 'manage_options' )
		) {
			return;
		}

		try {
			$asset                 = $this->get_settings_center_asset();
			$css_version           = $this->get_static_asset_version( 'assets/css/admin/settings-center.css' );
			$message_alert_version = $this->get_static_asset_version( 'assets/css/admin/message-alert.css' );
		} catch ( \Throwable $error ) {
			wp_trigger_error(
				__METHOD__,
				'EasyMDE settings center asset contract failed (settings-center-asset-invalid).',
				E_USER_WARNING
			);

			return;
		}

		wp_enqueue_style(
			'easymde-admin-message-alert',
			Asset::url( 'assets/css/admin/message-alert.css' ),
			array(),
			$message_alert_version
		);
		wp_enqueue_style(
			'easymde-admin-settings-center',
			Asset::url( 'assets/css/admin/settings-center.css' ),
			array( 'easymde-admin-message-alert' ),
			$css_version
		);
		wp_enqueue_script(
			$asset['handle'],
			Asset::url( $asset['path'] ),
			$asset['dependencies'],
			$asset['version'],
			false
		);
		wp_add_inline_script(
			$asset['handle'],
			'document.documentElement.classList.add("easymde-settings-center-js");' . "\n" .
			'window.EasyMDESettingsCenterBootstrap = ' . wp_json_encode(
				$this->get_settings_center_bootstrap(),
				JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT
			) . ';',
			'before'
		);
		wp_add_inline_script(
			$asset['handle'],
			$this->get_settings_center_startup_failure_script(),
			'after'
		);
	}

	public function render_settings_center() {
		if ( ! $this->is_canonical_settings_screen() || ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$settings_center_close_url = admin_url( 'options-general.php' );

		require EASYMDE_PLUGIN_DIR . 'templates/admin/settings-center.php';
	}

	public function render_settings_center_favicon() {
		?>
		<link
			rel="icon"
			type="image/png"
			href="<?php echo esc_url( Asset::url( 'assets/images/easymde-editor-icon.png' ) ); ?>"
			data-easymde-settings-favicon="true"
		>
		<?php
	}

	private function is_canonical_settings_screen() {
		global $pagenow;

		return ! isset( $pagenow ) || 'admin.php' === $pagenow;
	}

	private function get_settings_center_url() {
		return add_query_arg(
			array(
				'page'  => self::SETTINGS_CENTER_PAGE_SLUG,
				'route' => self::SETTINGS_CENTER_ROUTE,
			),
			admin_url( 'admin.php' )
		);
	}

	private function get_settings_center_startup_failure_script() {
		return <<<'JS'
(function () {
	if (window.EasyMDESettingsCenterStarted === true) {
		return;
	}

	document.documentElement.classList.remove('easymde-settings-center-js');
	console.error('[EasyMDE] settings-center-bundle-unavailable');
}());
JS;
	}

	private function get_settings_center_bootstrap() {
		$settings_response = $this->settings_center_repository->get_settings_response();
		$settings          = $settings_response['settings'];
		$credential_status = $settings_response['credentialStatus'];

		return array(
			'schemaVersion'   => 2,
			'closeUrl'        => admin_url( 'options-general.php' ),
			'api'             => array(
				'settingsUrl'                         => rest_url( 'easymde/v1/settings' ),
				'nonce'                               => wp_create_nonce( 'wp_rest' ),
				'actionNonce'                         => wp_create_nonce( 'easymde_update_settings' ),
				'imageHostingVerificationUrl'         => rest_url( 'easymde/v1/image-hosting/verification' ),
				'imageHostingVerificationActionNonce' => wp_create_nonce( 'easymde_verify_image_hosting_upload' ),
				'imageHostingSecretRevealUrl'         => rest_url( 'easymde/v1/image-hosting/secret' ),
				'imageHostingSecretRevealActionNonce' => wp_create_nonce( 'easymde_reveal_image_hosting_secret' ),
			),
			'assets'          => array(
				'brandMarkUrl'               => Asset::url( 'assets/images/settings-center/brand-icon-clean.png' ),
				'headerIllustrationUrl'      => Asset::url( 'assets/images/settings-center/header-illustration.png' ),
				'searchEmptyIllustrationUrl' => Asset::url( 'assets/images/settings-center/search-empty-illustration.png' ),
			),
			'links'           => array(
				'projectUrl'       => 'https://github.com/tao-xiaoxin/EasyMDE',
				'documentationUrl' => 'https://github.com/tao-xiaoxin/EasyMDE#readme',
				'releasesUrl'      => 'https://github.com/tao-xiaoxin/EasyMDE/releases',
				'issuesUrl'        => 'https://github.com/tao-xiaoxin/EasyMDE/issues',
				'licenseUrl'       => 'https://github.com/tao-xiaoxin/EasyMDE/blob/main/LICENSE',
			),
			'drafts'          => array(
				'images' => array(
					'domain'                       => $settings['images']['domain'],
					'backupDomain'                 => $settings['images']['backupDomain'],
					'primaryCredentialsConfigured' => $credential_status['primaryConfigured'],
					'backupCredentialsConfigured'  => $credential_status['backupConfigured'],
				),
			),
			'defaultSettings' => $this->settings_center_repository->get_default_settings(),
			'settings'        => $settings,
			'strings'         => SettingsCenterStrings::get(),
			'uploadLimits'    => array(
				'systemMaxBytes' => (int) wp_max_upload_size(),
			),
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
}
