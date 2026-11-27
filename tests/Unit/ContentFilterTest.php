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
	public function test_default_markdown_presentation_settings_are_exposed_on_the_published_root()
	{
		$html = $this->render_published_markdown_with_settings();

		$this->assertStringContainsString('easymde-table-align-center', $html);
		$this->assertStringContainsString('easymde-code-line-numbers', $html);
	}

	public function test_saved_markdown_presentation_settings_change_only_the_published_root_classes()
	{
		$html = $this->render_published_markdown_with_settings(
			array(
				'tableAlignment' => 'auto',
				'codeLineNumbers' => 'hide',
			)
		);

		$this->assertStringContainsString('easymde-table-align-auto', $html);
		$this->assertStringNotContainsString('easymde-table-align-center', $html);
		$this->assertStringNotContainsString('easymde-code-line-numbers', $html);
		$this->assertStringContainsString('<pre><code class="language-php">', $html);
	}

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
		$this->assertStringNotContainsString( ' style=', $html );
	}

	public function test_math_wrappers_survive_wptexturize_without_en_dash_corruption() {
		$post_id = self::factory()->post->create( array( 'post_type' => 'post' ) );
		update_post_meta( $post_id, PostDocument::META_ENABLED, '1' );
		update_post_meta( $post_id, PostDocument::META_MARKDOWN, "Inline \$a - b\$ and block:\n\n\$\$\nf(x) = x^2 - 1\n\$\$" );

		$settings = new SettingsCenterRepository( new Options(), new ToolbarRegistry() );
		$this->go_to( get_permalink( $post_id ) );
		$filter = new ContentFilter(
			new PostDocument(),
			new ThemeStateRepository( new ArticleThemeRegistry(), new CodeThemeRegistry(), new CustomCssPolicy() ),
			$settings
		);

		$html       = $filter->render_markdown_content( 'Stored compatibility output' );
		$texturized = wptexturize( $html );

		$this->assertStringContainsString( 'easymde-math', $texturized );
		$this->assertStringNotContainsString( '&#8211;', $texturized );
		$this->assertStringContainsString( '&#45;', $texturized );
		$this->assertStringContainsString( 'a - b', html_entity_decode( $texturized, ENT_QUOTES, 'UTF-8' ) );
		$this->assertStringContainsString( 'x^2 - 1', html_entity_decode( $texturized, ENT_QUOTES, 'UTF-8' ) );
	}

	private function render_published_markdown_with_settings( array $markdown_settings = array() )
	{
		$post_id = self::factory()->post->create(array('post_type' => 'post'));
		update_post_meta($post_id, PostDocument::META_ENABLED, '1');
		update_post_meta($post_id, PostDocument::META_MARKDOWN, "| A | B |\n| - | - |\n| 1 | 2 |\n\n```php\necho 'test';\n```");

		$settings = new SettingsCenterRepository(new Options(), new ToolbarRegistry());
		if ( ! empty( $markdown_settings ) ) {
			$draft = $settings->get_settings();
			$draft['markdown'] = array_merge($draft['markdown'], $markdown_settings);
			$this->assertIsArray($settings->update_settings($draft));
		}

		$this->go_to(get_permalink($post_id));
		$filter = new ContentFilter(
			new PostDocument(),
			new ThemeStateRepository(new ArticleThemeRegistry(), new CodeThemeRegistry(), new CustomCssPolicy()),
			$settings
		);

		return $filter->render_markdown_content('Stored compatibility output');
	}
}
