<?php

use EasyMDE\Theme\ArticleThemeRegistry;

final class ArticleThemeRegistryTest extends WP_UnitTestCase
{
    public function test_yamabuki_declares_theme_font_defaults()
    {
        $registry = new ArticleThemeRegistry();

        $this->assertSame(
            array(
                'customFont'  => 'yamabuki-inter',
                'windowsFont' => 'yamabuki-microsoft-yahei',
                'appleFont'   => 'pingfang-sc-regular-raw',
                'serifFont'   => 'sans-serif-only',
            ),
            $registry->font_defaults('yamabuki')
        );
    }
}
