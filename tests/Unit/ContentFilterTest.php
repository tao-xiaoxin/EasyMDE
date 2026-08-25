<?php

use EasyMDE\Content\PostDocument;
use EasyMDE\Frontend\ContentFilter;
use EasyMDE\Support\Options;
use EasyMDE\Support\SettingsCenterRepository;
use EasyMDE\Support\ToolbarRegistry;
use EasyMDE\Theme\ArticleThemeRegistry;
use EasyMDE\Theme\CodeThemeRegistry;
use EasyMDE\Theme\CustomCssPolicy;
use EasyMDE\Theme\ThemeStateRepository;

final class ContentFilterTest extends WP_UnitTestCase
{
    public function test_disabled_frontend_theme_linkage_renders_the_default_markup_profile_and_classes()
    {
        $post_id = self::factory()->post->create(array('post_type' => 'post'));
        update_post_meta($post_id, PostDocument::META_ENABLED, '1');
        update_post_meta($post_id, PostDocument::META_MARKDOWN, "# Public heading\n\nPublished text.");
        update_post_meta($post_id, PostDocument::META_MARKDOWN_THEME, 'orange-heart');
        update_post_meta($post_id, PostDocument::META_CUSTOM_FONT, 'system-ui');

        $settings = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
        $draft = $settings->get_settings();
        $draft['general']['applyEditorThemeToFrontend'] = false;
        $this->assertIsArray($settings->update_settings($draft));

        $this->go_to(get_permalink($post_id));
        $filter = new ContentFilter(
            new PostDocument(),
            new ThemeStateRepository(new ArticleThemeRegistry(), new CodeThemeRegistry(), new CustomCssPolicy()),
            $settings
        );

        $html = $filter->render_markdown_content('Stored compatibility output');

        $this->assertStringContainsString('easymde-markdown-theme-default', $html);
        $this->assertStringContainsString('easymde-code-theme-atom-one-dark', $html);
        $this->assertStringNotContainsString('easymde-markdown-theme-orange-heart', $html);
        $this->assertStringNotContainsString('<section class="h1">', $html);
        $this->assertStringNotContainsString(' style=', $html);
    }
}
