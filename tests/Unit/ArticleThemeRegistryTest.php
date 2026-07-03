<?php

use EasyMDE\Theme\ArticleThemeRegistry;
use EasyMDE\Theme\CodeThemeRegistry;
use EasyMDE\Theme\CustomCssPolicy;
use EasyMDE\Theme\ThemeStateRepository;

final class ArticleThemeRegistryTest extends WP_UnitTestCase
{
    public function test_qinghe_zhusha_theme_is_registered_with_asset_and_class()
    {
        $registry = new ArticleThemeRegistry();
        $theme = $registry->get('qinghe-zhusha');

        $this->assertSame('qinghe-zhusha', $theme['id']);
        $this->assertSame('Qinghe Zhusha', $theme['label']);
        $this->assertSame('assets/themes/article/qinghe-zhusha.css', $theme['asset_path']);
        $this->assertSame('easymde-markdown-theme-qinghe-zhusha', $theme['class_name']);
        $this->assertSame('qinghe-zhusha', $registry->sanitize_id('qinghe-zhusha'));
    }

    public function test_qinghe_zhusha_theme_exposes_asset_and_font_defaults_for_admin_script()
    {
        $registry = new ArticleThemeRegistry();
        $themes = array_column($registry->for_script(), null, 'id');

        $this->assertArrayHasKey('qinghe-zhusha', $themes);
        $this->assertStringContainsString(
            'assets/themes/article/qinghe-zhusha.css',
            $themes['qinghe-zhusha']['cssUrl']
        );
        $this->assertStringContainsString('ver=' . EASYMDE_VERSION, $themes['qinghe-zhusha']['cssUrl']);
        $this->assertSame('assets/themes/article/qinghe-zhusha.css', $themes['qinghe-zhusha']['assetPath']);
        $this->assertSame(
            array(
                'customFont' => 'qinghe-zhusha-helvetica',
                'windowsFont' => 'qinghe-zhusha-no-windows',
                'appleFont' => 'qinghe-zhusha-no-apple',
                'serifFont' => 'sans-serif-only',
            ),
            $themes['qinghe-zhusha']['fontDefaults']
        );
    }

    public function test_code_theme_registry_exposes_versioned_asset_urls_for_admin_script()
    {
        $registry = new CodeThemeRegistry();
        $themes = array_column($registry->for_script(), null, 'id');

        $this->assertArrayHasKey('atom-one-dark', $themes);
        $this->assertStringContainsString(
            'assets/vendor/highlight/styles/atom-one-dark.min.css',
            $themes['atom-one-dark']['cssUrl']
        );
        $this->assertStringContainsString('ver=' . EASYMDE_VERSION, $themes['atom-one-dark']['cssUrl']);
    }

    public function test_qinghe_zhusha_theme_state_outputs_scoped_render_class()
    {
        $repository = new ThemeStateRepository(
            new ArticleThemeRegistry(),
            new CodeThemeRegistry(),
            new CustomCssPolicy()
        );

        $classes = $repository->get_rendered_content_classes(
            array(
                'markdownTheme' => 'qinghe-zhusha',
                'codeTheme' => 'atom-one-dark',
                'codeMacStyle' => true,
                'fontFamily' => 'Helvetica, Arial, sans-serif',
            )
        );

        $this->assertStringContainsString('easymde-rendered-content', $classes);
        $this->assertStringContainsString('easymde-markdown-theme-qinghe-zhusha', $classes);
        $this->assertStringContainsString('easymde-code-theme-atom-one-dark', $classes);
        $this->assertStringContainsString('easymde-font-overrides', $classes);
        $this->assertStringNotContainsString('easymde-markdown-theme-custom', $classes);
    }
}
