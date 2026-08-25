<?php

namespace EasyMDE\Frontend;

use EasyMDE\Content\MarkdownFeatureDetector;
use EasyMDE\Content\PostDocument;
use EasyMDE\Support\Asset;
use EasyMDE\Support\FrontendAssetContract;
use EasyMDE\Support\ManifestAssetResolver;
use EasyMDE\Support\SettingsCenterRepository;
use EasyMDE\Theme\ThemeStateRepository;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class FrontendAssets {

	private $post_document;
	private $theme_state_repository;
	private $feature_detector;
	private $settings_center_repository;

	public function __construct(
		PostDocument $post_document,
		ThemeStateRepository $theme_state_repository,
		?MarkdownFeatureDetector $feature_detector = null,
		?SettingsCenterRepository $settings_center_repository = null
	) {
		$this->post_document              = $post_document;
		$this->theme_state_repository     = $theme_state_repository;
		$this->feature_detector           = $feature_detector ? $feature_detector : new MarkdownFeatureDetector();
		$this->settings_center_repository = $settings_center_repository;
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
		$theme_state = $this->get_frontend_theme_state( $post_id );
		$features    = $this->get_feature_config( $markdown );

		try {
			$features = $this->enqueue_render_assets( $post_id, $markdown );
		} catch ( \RuntimeException $error ) {
			if ( ! FrontendAssetContract::is_error( $error ) ) {
				throw $error;
			}

			if ( ! empty( $theme_state['scopedCustomCss'] ) ) {
				wp_add_inline_style( 'easymde-article-theme', $theme_state['scopedCustomCss'] );
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
				false,
				'frontend-bootstrap'
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
		$theme_state   = $this->get_frontend_theme_state( $post_id );
		$article_theme = $this->theme_state_repository->get_article_theme( $theme_state['markdownTheme'] );
		$code_theme    = $this->theme_state_repository->get_code_theme( $theme_state['codeTheme'] );
		$features      = $this->get_feature_config( $markdown );

		wp_enqueue_style(
			'easymde-content',
			Asset::url( 'assets/css/frontend/base.css' ),
			array(),
			$this->get_static_asset_version( 'assets/css/frontend/base.css' )
		);

		wp_enqueue_style(
			'easymde-article-theme',
			Asset::url( $article_theme['asset_path'] ),
			array( 'easymde-content' ),
			EASYMDE_VERSION
		);

		$mermaid_runtime = null;
		if ( ! empty( $features['mermaid'] ) ) {
			try {
				$mermaid_runtime = $this->get_frontend_enhancement_asset(
					'frontend/src/entrypoints/frontend-mermaid-runtime.ts',
					'assets/build/frontend-mermaid/',
					'easymde-mermaid',
					false,
					'frontend-mermaid'
				);

				wp_enqueue_script(
					$mermaid_runtime['handle'],
					Asset::url( $mermaid_runtime['path'] ),
					array(),
					$mermaid_runtime['version'],
					true
				);
			} catch ( \RuntimeException $error ) {
				if ( ! FrontendAssetContract::is_error( $error ) ) {
					throw $error;
				}

				$mermaid_runtime               = null;
				$features['mermaid']           = false;
				$features['mermaidAssetError'] = FrontendAssetContract::error_code( $error );
				$this->report_frontend_enhancement_asset_error( $error );
			}
		}

		if ( ! empty( $features['syntaxHighlight'] ) || ! empty( $features['mermaidAssetError'] ) ) {
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
		}

		if ( ! empty( $features['syntaxHighlight'] ) ) {
			wp_enqueue_script(
				'easymde-highlight',
				Asset::url( 'assets/vendor/highlight/highlight.min.js' ),
				array(),
				EASYMDE_VERSION,
				true
			);
		}

		if ( ! empty( $features['codeCopy'] ) ) {
			try {
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
			} catch ( \RuntimeException $error ) {
				if ( ! FrontendAssetContract::is_code_copy_error( $error ) ) {
					throw $error;
				}

				$features['codeCopy'] = false;
				$this->report_frontend_enhancement_asset_error( $error );
			}
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
			false,
			'frontend-enhancements'
		);

		wp_enqueue_script(
			'easymde-enhancements',
			Asset::url( $enhancements['path'] ),
			$dependencies,
			$enhancements['version'],
			true
		);

		return $features;
	}

	public function enqueue_editor_base_assets( $post_id = 0 ) {
		$theme_state   = $this->theme_state_repository->get_theme_state( $post_id );
		$article_theme = $this->theme_state_repository->get_article_theme( $theme_state['markdownTheme'] );

		wp_enqueue_style(
			'easymde-content',
			Asset::url( 'assets/css/frontend/base.css' ),
			array(),
			$this->get_static_asset_version( 'assets/css/frontend/base.css' )
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
			'easymde-enhancements',
			true,
			'frontend-enhancements'
		);

		wp_enqueue_script(
			$enhancements['handle'],
			Asset::url( $enhancements['path'] ),
			array(),
			$enhancements['version'],
			true
		);
	}

	private function get_frontend_theme_state( $post_id ) {
		if ( null === $this->settings_center_repository ) {
			throw new \LogicException( 'frontend-theme-settings-unavailable' );
		}

		return $this->theme_state_repository->get_frontend_theme_state(
			$post_id,
			$this->settings_center_repository->should_apply_editor_theme_to_frontend()
		);
	}

	public function get_editor_preview_assets() {
		$enhancements    = $this->get_frontend_enhancement_asset(
			'frontend/src/entrypoints/frontend-enhancements.ts',
			'assets/build/frontend-enhancements/',
			'easymde-enhancements',
			true,
			'frontend-enhancements'
		);
		$enhancement_url = $this->versioned_asset_url( $enhancements['path'] );
		$mermaid_url     = null;
		$mermaid_error   = null;
		try {
			$mermaid_runtime = $this->get_frontend_enhancement_asset(
				'frontend/src/entrypoints/frontend-mermaid-runtime.ts',
				'assets/build/frontend-mermaid/',
				'easymde-mermaid',
				true,
				'frontend-mermaid'
			);
			$mermaid_url     = $this->versioned_asset_url( $mermaid_runtime['path'] );
		} catch ( \RuntimeException $error ) {
			if ( ! FrontendAssetContract::is_error( $error ) ) {
				throw $error;
			}

			$mermaid_url   = null;
			$mermaid_error = FrontendAssetContract::error_code( $error );
			$this->report_frontend_enhancement_asset_error( $error );
		}

		return array(
			'codeFrameCssUrl'      => $this->versioned_asset_url( 'assets/css/frontend/code-frame.css' ),
			'highlightScriptUrl'   => $this->versioned_asset_url( 'assets/vendor/highlight/highlight.min.js' ),
			'mathCssUrl'           => $this->versioned_asset_url( 'assets/css/frontend/math.css' ),
			'tocCssUrl'            => $this->versioned_asset_url( 'assets/css/frontend/toc.css' ),
			'katexCssUrl'          => $this->versioned_asset_url( 'assets/vendor/katex/katex.min.css' ),
			'katexScriptUrl'       => $this->versioned_asset_url( 'assets/vendor/katex/katex.min.js' ),
			'mathRendererUrl'      => $enhancement_url,
			'mermaidAssetError'    => $mermaid_error,
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
		if ( null === $this->settings_center_repository ) {
			throw new \LogicException( 'frontend-code-copy-settings-unavailable' );
		}

		$features = $this->feature_detector->detect( $markdown );

		$features['codeCopy'] = $this->settings_center_repository->should_show_published_code_copy_button()
			&& $this->feature_detector->has_copyable_code_block( $markdown );

		return $features;
	}

	private function versioned_asset_url( $asset_path ) {
		return add_query_arg( 'ver', EASYMDE_VERSION, Asset::url( $asset_path ) );
	}

	private function get_static_asset_version( $asset_path ) {
		$path = Asset::path( $asset_path );
		if ( ! is_readable( $path ) ) {
			throw new \RuntimeException( 'frontend-asset-unreadable' );
		}

		$hash = hash_file( 'sha256', $path );
		if ( ! is_string( $hash ) || ! preg_match( '/^[a-f0-9]{64}$/', $hash ) ) {
			throw new \RuntimeException( 'frontend-asset-version-invalid' );
		}

		return substr( $hash, 0, 16 );
	}

	private function get_frontend_enhancement_asset( $entry_key, $build_dir, $expected_handle, $verify_integrity = true, $file_prefix = '' ) {
		return ManifestAssetResolver::resolve(
			$entry_key,
			$build_dir,
			$expected_handle,
			array(),
			$file_prefix,
			$verify_integrity,
			'frontend-enhancement-' . $file_prefix . '-'
		);
	}

	private function report_frontend_enhancement_asset_error( \RuntimeException $error ) {
		wp_trigger_error(
			__METHOD__,
			'EasyMDE frontend enhancement asset contract failed (' . $error->getMessage() . ').',
			E_USER_WARNING
		);
	}

	private function get_code_copy_asset( $build_dir = '' ) {
		$build_dir = $build_dir ? $build_dir : 'assets/build/code-copy/';

		return ManifestAssetResolver::resolve(
			'frontend/src/entrypoints/frontend-code-copy.ts',
			$build_dir,
			'easymde-code-copy',
			array(),
			'frontend-code-copy',
			true,
			'frontend-code-copy-'
		);
	}
}
