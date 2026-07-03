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

    public function test_qingbi_liujin_theme_exposes_font_defaults_for_admin_script()
    {
        $registry = new ArticleThemeRegistry();
        $themes = array_column($registry->for_script(), null, 'id');

        $this->assertArrayHasKey('qingbi-liujin', $themes);
        $this->assertStringEndsWith(
            'assets/themes/article/qingbi-liujin.css',
            $themes['qingbi-liujin']['cssUrl']
        );
        $this->assertSame('assets/themes/article/qingbi-liujin.css', $themes['qingbi-liujin']['assetPath']);
        $this->assertSame(
            array(
                'customFont' => 'qingbi-liujin-helvetica',
                'windowsFont' => 'qingbi-liujin-no-windows',
                'appleFont' => 'qingbi-liujin-no-apple',
                'serifFont' => 'sans-serif-only',
            ),
            $themes['qingbi-liujin']['fontDefaults']
        );
    }

    public function test_qingbi_liujin_theme_state_outputs_scoped_render_class()
    {
        $repository = new ThemeStateRepository(
            new ArticleThemeRegistry(),
            new CodeThemeRegistry(),
            new CustomCssPolicy()
        );

        $classes = $repository->get_rendered_content_classes(
            array(
                'markdownTheme' => 'qingbi-liujin',
                'codeTheme' => 'atom-one-dark',
                'codeMacStyle' => true,
                'fontFamily' => 'Helvetica, Arial, sans-serif',
            )
        );

        $this->assertStringContainsString('easymde-rendered-content', $classes);
        $this->assertStringContainsString('easymde-markdown-theme-qingbi-liujin', $classes);
        $this->assertStringContainsString('easymde-code-theme-atom-one-dark', $classes);
        $this->assertStringContainsString('easymde-font-overrides', $classes);
        $this->assertStringNotContainsString('easymde-markdown-theme-custom', $classes);
    }
}
