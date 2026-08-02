<?php

namespace EasyMDE\Frontend;

use EasyMDE\Content\MarkdownFeatureDetector;
use EasyMDE\Content\PostDocument;
use EasyMDE\Support\Asset;
use EasyMDE\Theme\ThemeStateRepository;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class FrontendAssets {

	private $post_document;
	private $theme_state_repository;
	private $feature_detector;

	public function __construct(
		PostDocument $post_document,
		ThemeStateRepository $theme_state_repository,
		?MarkdownFeatureDetector $feature_detector = null
	) {
		$this->post_document          = $post_document;
		$this->theme_state_repository = $theme_state_repository;
		$this->feature_detector       = $feature_detector ? $feature_detector : new MarkdownFeatureDetector();
	}

	public function register_hooks() {
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue_frontend_assets' ) );
	}

	public function enqueue_frontend_assets() {
		if ( ! is_singular() ) {
			return;
		}

		$post_id = get_queried_object_id();
		if ( ! $post_id || ! $this->post_document->is_easymde_post( $post_id ) ) {
			return;
		}

		$post        = get_post( $post_id );
		$markdown    = $this->post_document->get_markdown( $post );
		$theme_state = $this->theme_state_repository->get_theme_state( $post_id );
		$features    = $this->get_feature_config( $markdown );

		try {
			$this->enqueue_render_assets( $post_id, $markdown );
		} catch ( \RuntimeException $error ) {
			if ( ! empty( $theme_state['scopedCustomCss'] ) ) {
				wp_add_inline_style( 'easymde-article-theme', $theme_state['scopedCustomCss'] );
			}

			if ( ! $this->is_frontend_enhancement_asset_error( $error ) ) {
				throw $error;
			}

			$this->report_frontend_enhancement_asset_error( $error );
			return;
		}

		if ( ! empty( $theme_state['scopedCustomCss'] ) ) {
			wp_add_inline_style( 'easymde-article-theme', $theme_state['scopedCustomCss'] );
		}

		$dependencies = array( 'easymde-enhancements' );
		if ( ! empty( $features['codeCopy'] ) ) {
			$dependencies[] = 'easymde-code-copy';
		}

		try {
			$bootstrap_asset = $this->get_frontend_enhancement_asset(
				'frontend/src/entrypoints/frontend-bootstrap.ts',
				'assets/build/frontend-bootstrap/',
				'easymde-frontend',
				false
			);
		} catch ( \RuntimeException $error ) {
			$this->report_frontend_enhancement_asset_error( $error );
			return;
		}

		wp_enqueue_script(
			$bootstrap_asset['handle'],
			Asset::url( $bootstrap_asset['path'] ),
			$dependencies,
			$bootstrap_asset['version'],
			true
		);

		wp_localize_script(
			'easymde-frontend',
			'EasyMDEFrontendConfig',
			array(
				'features'   => $features,
				'themeState' => $theme_state,
				'strings'    => array(
					'renderingFailed' => __( 'Rendering failed.', 'easymde' ),
					'copyCode'        => __( 'Copy code', 'easymde' ),
					'copied'          => __( 'Copied', 'easymde' ),
					'codeCopied'      => __( 'Code copied', 'easymde' ),
					'codeCopyFailed'  => __( 'Unable to copy code. Try again.', 'easymde' ),
				),
			)
		);
	}

	public function enqueue_render_assets( $post_id = 0, $markdown = '' ) {
		$theme_state   = $this->theme_state_repository->get_theme_state( $post_id );
		$article_theme = $this->theme_state_repository->get_article_theme( $theme_state['markdownTheme'] );
		$code_theme    = $this->theme_state_repository->get_code_theme( $theme_state['codeTheme'] );
		$features      = $this->get_feature_config( $markdown );

		wp_enqueue_style(
			'easymde-content',
			Asset::url( 'assets/css/frontend/base.css' ),
			array(),
			EASYMDE_VERSION
		);

		wp_enqueue_style(
			'easymde-article-theme',
			Asset::url( $article_theme['asset_path'] ),
			array( 'easymde-content' ),
			EASYMDE_VERSION
		);

		if ( ! empty( $features['syntaxHighlight'] ) ) {
			wp_enqueue_style(
				'easymde-code-frame',
				Asset::url( 'assets/css/frontend/code-frame.css' ),
				array( 'easymde-content' ),
				EASYMDE_VERSION
			);

			wp_enqueue_style(
				'easymde-highlight-theme',
				Asset::url( $code_theme['asset_path'] ),
				array( 'easymde-content' ),
				EASYMDE_VERSION
			);

			wp_enqueue_script(
				'easymde-highlight',
				Asset::url( 'assets/vendor/highlight/highlight.min.js' ),
				array(),
				EASYMDE_VERSION,
				true
			);
		}

		if ( ! empty( $features['codeCopy'] ) ) {
			$code_copy_asset = $this->get_code_copy_asset();

			wp_enqueue_style(
				'easymde-code-copy',
				Asset::url( 'assets/css/frontend/code-copy.css' ),
				array( 'easymde-content' ),
				EASYMDE_VERSION
			);

			wp_enqueue_script(
				$code_copy_asset['handle'],
				Asset::url( $code_copy_asset['path'] ),
				$code_copy_asset['dependencies'],
				$code_copy_asset['version'],
				true
			);
		}

		if ( ! empty( $features['math'] ) ) {
			wp_enqueue_style(
				'easymde-math',
				Asset::url( 'assets/css/frontend/math.css' ),
				array( 'easymde-content' ),
				EASYMDE_VERSION
			);

			wp_enqueue_style(
				'easymde-katex',
				Asset::url( 'assets/vendor/katex/katex.min.css' ),
				array(),
				EASYMDE_VERSION
			);

			wp_enqueue_script(
				'easymde-katex',
				Asset::url( 'assets/vendor/katex/katex.min.js' ),
				array(),
				EASYMDE_VERSION,
				true
			);

		}

		if ( ! empty( $features['toc'] ) ) {
			wp_enqueue_style(
				'easymde-toc',
				Asset::url( 'assets/css/frontend/toc.css' ),
				array( 'easymde-content' ),
				EASYMDE_VERSION
			);
		}

		$mermaid_runtime = null;
		if ( ! empty( $features['mermaid'] ) ) {
			$mermaid_runtime = $this->get_frontend_enhancement_asset(
				'frontend/src/entrypoints/frontend-mermaid-runtime.ts',
				'assets/build/frontend-mermaid/',
				'easymde-mermaid',
				false
			);

			wp_enqueue_script(
				$mermaid_runtime['handle'],
				Asset::url( $mermaid_runtime['path'] ),
				array(),
				$mermaid_runtime['version'],
				true
			);
		}

		$dependencies = array();
		if ( ! empty( $features['syntaxHighlight'] ) ) {
			$dependencies[] = 'easymde-highlight';
		}

		if ( ! empty( $features['math'] ) ) {
			$dependencies[] = 'easymde-katex';
		}

		if ( ! empty( $mermaid_runtime ) ) {
			$dependencies[] = $mermaid_runtime['handle'];
		}

		$enhancements = $this->get_frontend_enhancement_asset(
			'frontend/src/entrypoints/frontend-enhancements.ts',
			'assets/build/frontend-enhancements/',
			'easymde-enhancements',
			false
		);

		wp_enqueue_script(
			'easymde-enhancements',
			Asset::url( $enhancements['path'] ),
			$dependencies,
			$enhancements['version'],
			true
		);
	}

	public function enqueue_editor_base_assets( $post_id = 0 ) {
		$theme_state   = $this->theme_state_repository->get_theme_state( $post_id );
		$article_theme = $this->theme_state_repository->get_article_theme( $theme_state['markdownTheme'] );

		wp_enqueue_style(
			'easymde-content',
			Asset::url( 'assets/css/frontend/base.css' ),
			array(),
			EASYMDE_VERSION
		);

		wp_enqueue_style(
			'easymde-article-theme',
			Asset::url( $article_theme['asset_path'] ),
			array( 'easymde-content' ),
			EASYMDE_VERSION
		);

		$enhancements = $this->get_frontend_enhancement_asset(
			'frontend/src/entrypoints/frontend-enhancements.ts',
			'assets/build/frontend-enhancements/',
			'easymde-enhancements'
		);

		wp_enqueue_script(
			$enhancements['handle'],
			Asset::url( $enhancements['path'] ),
			array(),
			$enhancements['version'],
			true
		);
	}

	public function get_editor_preview_assets() {
		$enhancements    = $this->get_frontend_enhancement_asset(
			'frontend/src/entrypoints/frontend-enhancements.ts',
			'assets/build/frontend-enhancements/',
			'easymde-enhancements'
		);
		$enhancement_url = $this->versioned_asset_url( $enhancements['path'] );
		$mermaid_url     = null;
		try {
			$mermaid_runtime = $this->get_frontend_enhancement_asset(
				'frontend/src/entrypoints/frontend-mermaid-runtime.ts',
				'assets/build/frontend-mermaid/',
				'easymde-mermaid',
				// Preview receives this optional URL before feature detection; build/release checks own its bytes.
				false
			);
			$mermaid_url = $this->versioned_asset_url( $mermaid_runtime['path'] );
		} catch ( \RuntimeException $error ) {
			// Mermaid is optional. Preview reports the missing runtime only when a
			// document actually requests Mermaid rendering.
			$mermaid_url = null;
		}

		return array(
			'codeFrameCssUrl'      => $this->versioned_asset_url( 'assets/css/frontend/code-frame.css' ),
			'highlightScriptUrl'   => $this->versioned_asset_url( 'assets/vendor/highlight/highlight.min.js' ),
			'mathCssUrl'           => $this->versioned_asset_url( 'assets/css/frontend/math.css' ),
			'tocCssUrl'            => $this->versioned_asset_url( 'assets/css/frontend/toc.css' ),
			'katexCssUrl'          => $this->versioned_asset_url( 'assets/vendor/katex/katex.min.css' ),
			'katexScriptUrl'       => $this->versioned_asset_url( 'assets/vendor/katex/katex.min.js' ),
			'mathRendererUrl'      => $enhancement_url,
			'mermaidScriptUrl'     => $mermaid_url,
			'mermaidRendererUrl'   => $enhancement_url,
			'highlightThemeLinkId' => 'easymde-highlight-theme-css',
			'codeFrameLinkId'      => 'easymde-code-frame-css',
			'mathCssLinkId'        => 'easymde-math-css',
			'tocCssLinkId'         => 'easymde-toc-css',
			'katexCssLinkId'       => 'easymde-katex-css',
		);
	}

	public function get_feature_config( $markdown = '' ) {
		$features = $this->feature_detector->detect( $markdown );

		// TODO: Replace this default-on product rule with the future configuration-backed code-copy switch.
		$features['codeCopy'] = $this->feature_detector->has_copyable_code_block( $markdown );

		return $features;
	}

	private function versioned_asset_url( $asset_path ) {
		return add_query_arg( 'ver', EASYMDE_VERSION, Asset::url( $asset_path ) );
	}

	private function get_frontend_enhancement_asset( $entry_key, $build_dir, $expected_handle, $verify_integrity = true ) {
		// Public enqueue paths use committed artifacts already checked by build/release gates; keep hashing out of visitor requests.
		$build_dir     = trailingslashit( $build_dir );
		$manifest_path = Asset::path( $build_dir . 'wordpress-manifest.json' );
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- Reads a local committed build manifest, never a remote URL.
		$manifest_json = is_readable( $manifest_path ) ? file_get_contents( $manifest_path ) : false;
		$manifest      = false === $manifest_json ? null : json_decode( $manifest_json, true );

		if (
			! is_array( $manifest )
			|| 1 !== ( $manifest['schemaVersion'] ?? null )
			|| ! isset( $manifest['entries'] )
			|| ! is_array( $manifest['entries'] )
			|| array( $entry_key ) !== array_keys( $manifest['entries'] )
			|| ! is_array( $manifest['entries'][ $entry_key ] )
		) {
			throw new \RuntimeException( 'frontend-enhancement-manifest-invalid' );
		}

		$entry = $manifest['entries'][ $entry_key ];
		$file  = isset( $entry['file'] ) ? (string) $entry['file'] : '';
		$asset = isset( $entry['asset'] ) ? (string) $entry['asset'] : '';
		if (
			( $entry['handle'] ?? null ) !== $expected_handle
			|| array() !== ( $entry['dependencies'] ?? null )
			|| array() !== ( $entry['resources'] ?? null )
			|| ! preg_match( '#^assets/frontend-(?:enhancements|bootstrap|mermaid)-[A-Za-z0-9_-]+\.js$#', $file )
			|| preg_replace( '/\.js$/', '.asset.php', $file ) !== $asset
		) {
			throw new \RuntimeException( 'frontend-enhancement-manifest-invalid' );
		}

		$script_path   = Asset::path( $build_dir . $file );
		$metadata_path = Asset::path( $build_dir . $asset );
		if ( ! is_file( $script_path ) || ! is_readable( $metadata_path ) ) {
			throw new \RuntimeException( 'frontend-enhancement-build-missing' );
		}

		$metadata = require $metadata_path;
		if (
			! is_array( $metadata )
			|| array() !== ( $metadata['dependencies'] ?? null )
			|| ! isset( $metadata['version'] )
			|| ! preg_match( '/^[a-f0-9]{16}$/', (string) $metadata['version'] )
		) {
			throw new \RuntimeException( 'frontend-enhancement-metadata-invalid' );
		}

		if ( $verify_integrity ) {
			$script_hash = hash_file( 'sha256', $script_path );
			if (
				false === $script_hash
				|| ! hash_equals( (string) $metadata['version'], substr( $script_hash, 0, 16 ) )
			) {
				throw new \RuntimeException( 'frontend-enhancement-build-integrity-invalid' );
			}
		}

		return array(
			'handle'       => $expected_handle,
			'path'         => $build_dir . $file,
			'dependencies' => $metadata['dependencies'],
			'version'      => (string) $metadata['version'],
		);
	}

	private function is_frontend_enhancement_asset_error( \RuntimeException $error ) {
		return 0 === strpos( $error->getMessage(), 'frontend-enhancement-' );
	}

	private function report_frontend_enhancement_asset_error( \RuntimeException $error ) {
		wp_trigger_error(
			__METHOD__,
			'EasyMDE frontend enhancement asset contract failed (' . $error->getMessage() . ').',
			E_USER_WARNING
		);
	}

	private function get_code_copy_asset( $build_dir = '' ) {
		$build_dir     = $build_dir ? trailingslashit( $build_dir ) : Asset::path( 'assets/build/code-copy/' );
		$manifest_path = $build_dir . 'wordpress-manifest.json';
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- Reads a local committed build manifest, never a remote URL.
		$manifest_json = is_readable( $manifest_path ) ? file_get_contents( $manifest_path ) : false;
		$manifest      = false === $manifest_json ? null : json_decode( $manifest_json, true );
		$entry_key     = 'frontend/src/entrypoints/frontend-code-copy.ts';

		if (
			! is_array( $manifest )
			|| 1 !== ( $manifest['schemaVersion'] ?? null )
			|| ! isset( $manifest['entries'] )
			|| ! is_array( $manifest['entries'] )
			|| array( $entry_key ) !== array_keys( $manifest['entries'] )
			|| ! is_array( $manifest['entries'][ $entry_key ] )
		) {
			throw new \RuntimeException( 'frontend-code-copy-manifest-invalid' );
		}

		$entry = $manifest['entries'][ $entry_key ];
		$file  = isset( $entry['file'] ) ? (string) $entry['file'] : '';
		$asset = isset( $entry['asset'] ) ? (string) $entry['asset'] : '';
		if (
			'easymde-code-copy' !== ( $entry['handle'] ?? null )
			|| array() !== ( $entry['dependencies'] ?? null )
			|| array() !== ( $entry['resources'] ?? null )
			|| ! preg_match( '#^assets/frontend-code-copy-[A-Za-z0-9_-]+\.js$#', $file )
			|| preg_replace( '/\.js$/', '.asset.php', $file ) !== $asset
		) {
			throw new \RuntimeException( 'frontend-code-copy-manifest-invalid' );
		}

		$script_path   = $build_dir . $file;
		$metadata_path = $build_dir . $asset;
		if ( ! is_file( $script_path ) || ! is_readable( $metadata_path ) ) {
			throw new \RuntimeException( 'frontend-code-copy-build-missing' );
		}

		$metadata = require $metadata_path;
		if (
			! is_array( $metadata )
			|| array() !== ( $metadata['dependencies'] ?? null )
			|| ! isset( $metadata['version'] )
			|| ! preg_match( '/^[a-f0-9]{16}$/', (string) $metadata['version'] )
		) {
			throw new \RuntimeException( 'frontend-code-copy-metadata-invalid' );
		}

		$script_hash = hash_file( 'sha256', $script_path );
		if (
			false === $script_hash
			|| ! hash_equals( (string) $metadata['version'], substr( $script_hash, 0, 16 ) )
		) {
			throw new \RuntimeException( 'frontend-code-copy-build-integrity-invalid' );
		}

		return array(
			'handle'       => 'easymde-code-copy',
			'path'         => 'assets/build/code-copy/' . $file,
			'dependencies' => $metadata['dependencies'],
			'version'      => (string) $metadata['version'],
		);
	}
}
