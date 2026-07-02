<?php

use EasyMDE\Theme\CustomCssPolicy;

final class CustomCssPolicyTest extends WP_UnitTestCase
{
    public function test_blocks_import_url_and_dangerous_expressions()
    {
        $policy = new CustomCssPolicy();

        $this->assertWPError($policy->validate('@import url("https://example.test/a.css");'));
        $this->assertWPError($policy->validate('.x { background: url("/x.png"); }'));
        $this->assertWPError($policy->validate('.x { width: expression(alert(1)); }'));
        $this->assertWPError($policy->validate('.x { behavior: url(test.htc); }'));
    }

    public function test_scopes_nested_media_rules()
    {
        $policy = new CustomCssPolicy();
        $css = $policy->scope('@media (min-width: 700px) { h2, .lead { color: red; } }');

        $this->assertStringContainsString('@media', $css);
        $this->assertStringContainsString(CustomCssPolicy::SCOPE . ' h2', $css);
        $this->assertStringContainsString(CustomCssPolicy::SCOPE . ' .lead', $css);
    }

    public function test_preserves_keyframe_selectors()
    {
        $policy = new CustomCssPolicy();
        $css = $policy->scope('@keyframes fade { 0% { opacity: 0; } 100% { opacity: 1; } }');

        $this->assertStringContainsString('0%', $css);
        $this->assertStringContainsString('100%', $css);
        $this->assertStringNotContainsString(CustomCssPolicy::SCOPE . ' 0%', $css);
    }
}
