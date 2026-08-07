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
        $this->assertSame('配置中心', translate('Settings Center', 'easymde'));
        $this->assertSame('青碧流金', translate('Qingbi Liujin', 'easymde'));
    }

    public function test_en_us_does_not_receive_runtime_chinese_replacements()
    {
        unload_textdomain('easymde');

        $this->assertSame('Settings Center', translate('Settings Center', 'easymde'));
        $this->assertFalse(has_filter('gettext_easymde'));
    }
}
