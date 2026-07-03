<?php

use EasyMDE\Theme\ArticleThemeRegistry;
use EasyMDE\Theme\CodeThemeRegistry;
use EasyMDE\Theme\CustomCssPolicy;
use EasyMDE\Theme\ThemeStateRepository;

final class ArticleThemeRegistryTest extends WP_UnitTestCase
{
    public function test_qingbi_liujin_theme_is_registered_with_asset_and_class()
    {
        $registry = new ArticleThemeRegistry();
        $theme = $registry->get('qingbi-liujin');

        $this->assertSame('qingbi-liujin', $theme['id']);
        $this->assertSame('Qingbi Liujin', $theme['label']);
        $this->assertSame('assets/themes/article/qingbi-liujin.css', $theme['asset_path']);
        $this->assertSame('easymde-markdown-theme-qingbi-liujin', $theme['class_name']);
        $this->assertSame('qingbi-liujin', $registry->sanitize_id('qingbi-liujin'));
    }

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

    public function test_typora_derived_themes_expose_asset_and_font_defaults_for_admin_script()
    {
        $registry = new ArticleThemeRegistry();
        $themes = array_column($registry->for_script(), null, 'id');

        $expected = array(
            'qingbi-liujin' => array(
                'assetPath' => 'assets/themes/article/qingbi-liujin.css',
                'fontDefaults' => array(
                    'customFont' => 'qingbi-liujin-helvetica',
                    'windowsFont' => 'qingbi-liujin-no-windows',
                    'appleFont' => 'qingbi-liujin-no-apple',
                    'serifFont' => 'sans-serif-only',
                ),
            ),
            'qinghe-zhusha' => array(
                'assetPath' => 'assets/themes/article/qinghe-zhusha.css',
                'fontDefaults' => array(
                    'customFont' => 'qinghe-zhusha-helvetica',
                    'windowsFont' => 'qinghe-zhusha-no-windows',
                    'appleFont' => 'qinghe-zhusha-no-apple',
                    'serifFont' => 'sans-serif-only',
                ),
            ),
        );

        foreach ($expected as $theme_id => $details) {
            $this->assertArrayHasKey($theme_id, $themes);
            $this->assertStringContainsString($details['assetPath'], $themes[$theme_id]['cssUrl']);
            $this->assertStringContainsString('ver=' . EASYMDE_VERSION, $themes[$theme_id]['cssUrl']);
            $this->assertSame($details['assetPath'], $themes[$theme_id]['assetPath']);
            $this->assertSame($details['fontDefaults'], $themes[$theme_id]['fontDefaults']);
        }
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

    public function test_typora_derived_theme_state_outputs_scoped_render_class()
    {
        $repository = new ThemeStateRepository(
            new ArticleThemeRegistry(),
            new CodeThemeRegistry(),
            new CustomCssPolicy()
        );

        foreach (array('qingbi-liujin', 'qinghe-zhusha') as $theme_id) {
            $classes = $repository->get_rendered_content_classes(
                array(
                    'markdownTheme' => $theme_id,
                    'codeTheme' => 'atom-one-dark',
                    'codeMacStyle' => true,
                    'fontFamily' => 'Helvetica, Arial, sans-serif',
                )
            );

            $this->assertStringContainsString('easymde-rendered-content', $classes);
            $this->assertStringContainsString('easymde-markdown-theme-' . $theme_id, $classes);
            $this->assertStringContainsString('easymde-code-theme-atom-one-dark', $classes);
            $this->assertStringContainsString('easymde-font-overrides', $classes);
            $this->assertStringNotContainsString('easymde-markdown-theme-custom', $classes);
        }
    }
}
