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

		$this->enqueue_render_assets( $post_id, $markdown );

		if ( ! empty( $theme_state['scopedCustomCss'] ) ) {
			wp_add_inline_style( 'easymde-article-theme', $theme_state['scopedCustomCss'] );
		}

		$dependencies = array( 'easymde-enhancements' );
		wp_enqueue_script(
			'easymde-frontend',
			Asset::url( 'assets/js/frontend/bootstrap.js' ),
			$dependencies,
			EASYMDE_VERSION,
			true
		);

		wp_localize_script(
			'easymde-frontend',
			'EasyMDEFrontendConfig',
			array(
				'features'   => $this->get_feature_config( $markdown ),
				'themeState' => $theme_state,
				'strings'    => array(
					'renderingFailed' => __( 'Rendering failed.', 'easymde' ),
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

			wp_enqueue_script(
				'easymde-math-renderer',
				Asset::url( 'assets/js/frontend/math.js' ),
				array( 'easymde-katex' ),
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

		if ( ! empty( $features['mermaid'] ) ) {
			wp_enqueue_script(
				'easymde-mermaid',
				Asset::url( 'assets/vendor/mermaid/mermaid.min.js' ),
				array(),
				EASYMDE_VERSION,
				true
			);

			wp_enqueue_script(
				'easymde-mermaid-renderer',
				Asset::url( 'assets/js/frontend/mermaid.js' ),
				array( 'easymde-mermaid' ),
				EASYMDE_VERSION,
				true
			);
		}

		$dependencies = array();
		if ( ! empty( $features['syntaxHighlight'] ) ) {
			$dependencies[] = 'easymde-highlight';
		}

		if ( ! empty( $features['math'] ) ) {
			$dependencies[] = 'easymde-math-renderer';
		}

		if ( ! empty( $features['mermaid'] ) ) {
			$dependencies[] = 'easymde-mermaid-renderer';
		}

		wp_enqueue_script(
			'easymde-enhancements',
			Asset::url( 'assets/js/frontend/code-highlight.js' ),
			$dependencies,
			EASYMDE_VERSION,
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

		wp_enqueue_script(
			'easymde-enhancements',
			Asset::url( 'assets/js/frontend/code-highlight.js' ),
			array(),
			EASYMDE_VERSION,
			true
		);
	}

	public function get_editor_preview_assets() {
		return array(
			'codeFrameCssUrl'      => $this->versioned_asset_url( 'assets/css/frontend/code-frame.css' ),
			'highlightScriptUrl'   => $this->versioned_asset_url( 'assets/vendor/highlight/highlight.min.js' ),
			'mathCssUrl'           => $this->versioned_asset_url( 'assets/css/frontend/math.css' ),
			'tocCssUrl'            => $this->versioned_asset_url( 'assets/css/frontend/toc.css' ),
			'katexCssUrl'          => $this->versioned_asset_url( 'assets/vendor/katex/katex.min.css' ),
			'katexScriptUrl'       => $this->versioned_asset_url( 'assets/vendor/katex/katex.min.js' ),
			'mathRendererUrl'      => $this->versioned_asset_url( 'assets/js/frontend/math.js' ),
			'mermaidScriptUrl'     => $this->versioned_asset_url( 'assets/vendor/mermaid/mermaid.min.js' ),
			'mermaidRendererUrl'   => $this->versioned_asset_url( 'assets/js/frontend/mermaid.js' ),
			'highlightThemeLinkId' => 'easymde-highlight-theme-css',
			'codeFrameLinkId'      => 'easymde-code-frame-css',
			'mathCssLinkId'        => 'easymde-math-css',
			'tocCssLinkId'         => 'easymde-toc-css',
			'katexCssLinkId'       => 'easymde-katex-css',
		);
	}

	public function get_feature_config( $markdown = '' ) {
		return $this->feature_detector->detect( $markdown );
	}

	private function versioned_asset_url( $asset_path ) {
		return add_query_arg( 'ver', EASYMDE_VERSION, Asset::url( $asset_path ) );
	}
}
