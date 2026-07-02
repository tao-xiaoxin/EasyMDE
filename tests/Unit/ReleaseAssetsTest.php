<?php

final class ReleaseAssetsTest extends WP_UnitTestCase
{
    public function test_release_script_requires_runtime_vendor_styles_and_fonts()
    {
        $script = file_get_contents(dirname(__DIR__, 2) . '/scripts/build-release.mjs');

        $this->assertStringContainsString('assets/vendor/highlight/styles/github.min.css', $script);
        $this->assertStringContainsString('assets/vendor/highlight/styles/atom-one-dark.min.css', $script);
        $this->assertStringContainsString('assets/vendor/katex/katex.min.css', $script);
        $this->assertStringContainsString('assets/vendor/katex/fonts', $script);
    }
}
