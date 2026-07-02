<?php

final class I18nTest extends WP_UnitTestCase
{
    public function tear_down()
    {
        unload_textdomain('easymde');

        parent::tear_down();
    }

    public function test_wordpress_can_load_bundled_zh_cn_language_file()
    {
        unload_textdomain('easymde');

        $this->assertTrue(load_textdomain('easymde', EASYMDE_PLUGIN_DIR . 'languages/easymde-zh_CN.mo'));
        $this->assertSame('快捷键设置', translate('Shortcut settings', 'easymde'));
    }

    public function test_en_us_does_not_receive_legacy_runtime_chinese_replacements()
    {
        unload_textdomain('easymde');

        $this->assertSame('Shortcut settings', translate('Shortcut settings', 'easymde'));
        $this->assertFalse(has_filter('gettext_easymde'));
    }
}
