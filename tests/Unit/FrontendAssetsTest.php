<?php

use EasyMDE\Content\PostDocument;
use EasyMDE\Frontend\FrontendAssets;
use EasyMDE\Theme\ArticleThemeRegistry;
use EasyMDE\Theme\CodeThemeRegistry;
use EasyMDE\Theme\CustomCssPolicy;
use EasyMDE\Theme\ThemeStateRepository;

final class FrontendAssetsTest extends WP_UnitTestCase
{
    public function test_indented_code_blocks_request_code_assets()
    {
        $assets = new FrontendAssets(
            new PostDocument(),
            new ThemeStateRepository(new ArticleThemeRegistry(), new CodeThemeRegistry(), new CustomCssPolicy())
        );

        $features = $assets->get_feature_config("Paragraph\n\n    echo 'hello';\n");

        $this->assertTrue($features['codeBlocks']);
        $this->assertTrue($features['syntaxHighlight']);
    }
}
