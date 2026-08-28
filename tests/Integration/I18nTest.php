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
        $this->assertSame('七牛云 Kodo', translate('Qiniu Kodo', 'easymde'));
        $this->assertSame('阿里云 OSS', translate('Alibaba Cloud OSS', 'easymde'));
        $this->assertSame('腾讯云 COS', translate('Tencent Cloud COS', 'easymde'));
		$this->assertSame('代码与公式', translate('Code and formulas', 'easymde'));
		$this->assertSame('快捷键冲突', translate('Shortcut conflict', 'easymde'));
		$this->assertSame('录制%s快捷键', translate('Record %s shortcut', 'easymde'));
		$this->assertSame(
			'请使用包含 Ctrl、Alt、Option、Command 或 Meta 的快捷键。',
			translate('Use a shortcut with Ctrl, Alt, Option, Command, or Meta.', 'easymde')
		);
		$this->assertSame('自动上传粘贴的图片', translate('Automatically upload pasted images', 'easymde'));
		$this->assertSame('远程图片导入', translate('Remote image import', 'easymde'));
		$this->assertSame(
			'将以 HTML 或 Markdown 形式粘贴的绝对 HTTP 或 HTTPS 图片导入已配置的图床。',
			translate('Import absolute HTTP or HTTPS images pasted as HTML or Markdown into the configured image host.', 'easymde')
		);
		$this->assertSame('可视化和源码编辑器', translate('Visual and source editors', 'easymde'));
		$this->assertSame('仅可视化编辑器', translate('Visual editor only', 'easymde'));
		$this->assertSame('仅源码编辑器', translate('Source editor only', 'easymde'));
		$this->assertSame('不导入', translate('Do not import', 'easymde'));
		$this->assertSame('远程图片 URL 无效。', translate('The remote image URL is invalid.', 'easymde'));
		$this->assertSame('无法下载远程图片。', translate('The remote image could not be downloaded.', 'easymde'));
		$this->assertSame('远程图片为空。', translate('The remote image is empty.', 'easymde'));
		$this->assertSame('正在检查粘贴的图片...', translate('Checking pasted image...', 'easymde'));
		$this->assertSame('粘贴的图片已使用当前图床。', translate('Pasted image already uses the current image host.', 'easymde'));
    }

    public function test_en_us_does_not_receive_runtime_chinese_replacements()
    {
        unload_textdomain('easymde');

        $this->assertSame('Settings Center', translate('Settings Center', 'easymde'));
        $this->assertSame('Qiniu Kodo', translate('Qiniu Kodo', 'easymde'));
        $this->assertSame('Alibaba Cloud OSS', translate('Alibaba Cloud OSS', 'easymde'));
        $this->assertSame('Tencent Cloud COS', translate('Tencent Cloud COS', 'easymde'));
        $this->assertFalse(has_filter('gettext_easymde'));
    }
}
