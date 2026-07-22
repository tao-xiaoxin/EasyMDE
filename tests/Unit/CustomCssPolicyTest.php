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
        $this->assertWPError($policy->validate('@font-face { font-family: test; src: local("Arial"); }'));
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

    public function test_rejects_oversized_css_without_truncating()
    {
        $policy = new CustomCssPolicy();
        $css = '.x{' . str_repeat('color:red;', CustomCssPolicy::MAX_BYTES) . '}';
        $result = $policy->validate($css);

        $this->assertWPError($result);
        $this->assertSame(413, $result->get_error_data()['status']);
    }

    public function test_rejects_unscoped_global_at_rules()
    {
        $policy = new CustomCssPolicy();

        $this->assertWPError($policy->validate('@page { margin: 0; }'));
        $this->assertWPError($policy->validate('@property --brand { syntax: "<color>"; inherits: true; initial-value: red; }'));
        $this->assertSame('', $policy->scope('@page { margin: 0; }'));
    }

    public function test_scopes_root_custom_properties_to_easy_mde_container()
    {
        $policy = new CustomCssPolicy();
        $css = $policy->scope(':root { --brand: red; } h2 { color: var(--brand); }');
        $compact = str_replace(' ', '', $css);

        $this->assertStringContainsString(CustomCssPolicy::SCOPE, $css);
        $this->assertStringContainsString('--brand:red', $compact);
        $this->assertStringContainsString(CustomCssPolicy::SCOPE . ' h2', $css);
        $this->assertStringContainsString('var(--brand)', $css);
        $this->assertStringNotContainsString(CustomCssPolicy::SCOPE . ' :root', $css);
    }

    public function test_preview_css_is_scoped_to_the_immersive_modal_only()
    {
        $policy = new CustomCssPolicy();
        $preview = $policy->prepare_preview('h2 { color: red; }');

        $this->assertIsArray($preview);
        $this->assertStringContainsString(CustomCssPolicy::PREVIEW_SCOPE . ' h2', $preview['scopedCss']);
    }

    public function test_scope_prefix_collision_is_prefixed_inside_the_preview_container()
    {
        $policy = new CustomCssPolicy();
        $lookalike = CustomCssPolicy::PREVIEW_SCOPE . '--outside';
        $preview = $policy->prepare_preview($lookalike . ' { color: red; }');

        $this->assertIsArray($preview);
        $this->assertStringContainsString(
            CustomCssPolicy::PREVIEW_SCOPE . ' ' . $lookalike,
            $preview['scopedCss']
        );
    }

}
