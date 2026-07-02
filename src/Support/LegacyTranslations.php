<?php

namespace EasyMDE\Support;

if (!defined('ABSPATH')) {
    exit;
}

final class LegacyTranslations
{
    public function register_hooks()
    {
        add_filter('gettext_easymde', array($this, 'translate_simplified_chinese'), 10, 3);
    }

    public function translate_simplified_chinese($translation, $text, $domain)
    {
        unset($domain);

        if ('zh_CN' !== determine_locale()) {
            return $translation;
        }

        $translations = array(
            'EasyMDE adds a scoped split-pane Markdown editor to supported post editing screens.' => 'EasyMDE 会在支持的内容编辑页面中添加作用域限定的分栏 Markdown 编辑器。',
            'Supported post types' => '支持的内容类型',
            'Server renderer' => '服务器端渲染器',
            'league/commonmark is active.' => 'league/commonmark 已启用。',
            'Fallback renderer is active. Install Composer dependencies for full CommonMark/GFM support.' => '正在使用备用渲染器。安装 Composer 依赖后可获得完整的 CommonMark/GFM 支持。',
            'Admin behavior' => '后台行为',
            'No activation redirect and no unrelated admin-page redirect.' => '不会在启用插件后跳转，也不会重定向无关后台页面。',
            'Toolbar layout' => '工具栏布局',
            'Hybrid icon toolbar' => '混合图标工具栏',
            'Current preset' => '当前预设',
            'Typora-inspired shortcuts' => 'Typora 风格快捷键',
            'Typora-inspired defaults are active unless overridden below.' => '默认启用 Typora 风格快捷键，除非在下方覆盖。',
            'Shortcut settings' => '快捷键设置',
            'Command' => '命令',
            'Windows / Linux' => 'Windows / Linux',
            'Default: %s' => '默认：%s',
            'Use the current Typora-inspired default by leaving the field blank.' => '留空即可继续使用当前 Typora 风格默认值。',
            'Markdown source' => 'Markdown 源文',
            'Live preview' => '实时预览',
            'Start writing Markdown to preview the article.' => '开始编写 Markdown 后将在此处预览文章。',
            'Preview failed. Please keep writing; saving is not affected.' => '预览失败。可以继续编写，保存不受影响。',
            'Insert Media' => '插入媒体',
            'Enter immersive writing' => '进入沉浸写作',
            'Exit immersive writing' => '退出沉浸写作',
            'Markdown toolbar' => 'Markdown 工具栏',
            'Preview' => '预览',
            'Markdown' => 'Markdown',
            'Bold' => '加粗',
            'Italic' => '斜体',
            'Strikethrough' => '删除线',
            'Paragraph' => '正文',
            'Heading 1' => '一级标题',
            'Heading 2' => '二级标题',
            'Heading 3' => '三级标题',
            'Heading 4' => '四级标题',
            'Heading 5' => '五级标题',
            'Heading 6' => '六级标题',
            'Quote' => '引用',
            'Ordered list' => '有序列表',
            'Unordered list' => '无序列表',
            'Inline code' => '行内代码',
            'Code fence' => '代码块',
            'Math block' => '公式块',
            'Link' => '链接',
            'Image' => '图片',
            'Save post' => '保存文章',
            'Copy to WeChat' => '复制到公众号',
            'Output actions' => '输出操作',
            'Appearance' => '外观',
            'Font' => '字体',
            'Headings' => '标题',
            'Dark mode' => '深色模式',
            'Light mode' => '浅色模式',
            'Article theme' => '文章主题',
            'Default theme' => '默认主题',
            'Markdown2Html default' => 'Markdown2Html 默认',
            'Orange heart' => '橙心',
            'Chazi purple' => '姹紫',
            'Nenqing green' => '嫩青',
            'Green vitality' => '绿意',
            'Red crimson' => '红绯',
            'Blue ying' => '蓝莹',
            'Lanqing' => '兰青',
            'Yamabuki' => '山吹',
            'Grid black' => '网格黑',
            'Geek black' => '极客黑',
            'Rose purple' => '蔷薇紫',
            'Ningye purple' => '凝夜紫',
            'Cute green' => '萌绿风',
            'Fullstack blue' => '全栈蓝',
            'Minimal black' => '极简黑',
            'Orange blue' => '橙蓝风',
            'Frontend peak' => '前端之巅同款',
            'Cupid busy' => '丘比特忙',
            'Code theme' => '代码主题',
            'Mac code frame' => 'Mac 代码框',
            'Custom CSS' => '自定义 CSS',
            'Named custom CSS' => '命名自定义 CSS',
            'CSS name' => 'CSS 名称',
            'Save CSS' => '保存 CSS',
            'Saved CSS.' => 'CSS 已保存。',
            'CSS save failed.' => 'CSS 保存失败。',
            'No custom CSS saved yet.' => '尚未保存自定义 CSS。',
            'Custom font' => '自定义',
            'Windows font' => 'Windows字体',
            'Apple font' => '苹果字体',
            'Serif font' => '衬线字体',
            'No custom font' => '无',
            'Microsoft YaHei' => '微软雅黑',
            'PingFang SC Light' => '苹方细体',
            'PingFang SC Regular' => '苹方常规体',
            'PingFang TC Light' => '苹方繁体细体',
            'PingFang TC Regular' => '苹方繁体常规体',
            'Yes' => '是',
            'No' => '否',
            'Fonts are applied in custom, Windows, Apple, and serif fallback order when supported by the current system.' => '注：Windows、苹果、Android不同操作系统支持的字体不相同，没有字体可以在所有系统都生效，在当前操作系统中按照自定义、Windows字体、苹果字体、衬线字体顺序生效',
            'Local draft saved' => '本地草稿已保存',
            'A newer local draft is available.' => '检测到更新的本地草稿。',
            'Restore draft' => '恢复草稿',
            'Discard draft' => '丢弃草稿',
            'Draft restored.' => '草稿已恢复。',
            'Draft discarded.' => '草稿已丢弃。',
            'Rendering failed.' => '渲染失败。',
            'Copy preview for WeChat' => '复制当前预览到公众号',
            'Copied preview for WeChat.' => '已复制当前预览，可直接粘贴到公众号编辑器。',
            'Copy for WeChat failed. Please try again in this browser.' => '复制到公众号失败，请在当前浏览器中重试。',
            'Clipboard access is not available in this browser.' => '当前浏览器不支持剪贴板富文本复制。',
            'Shortcut settings saved.' => '快捷键设置已保存。',
            'Invalid shortcut value for %1$s (%2$s). Use combinations like Ctrl+B or Command+Option+C.' => '%1$s（%2$s）的快捷键格式无效。请使用 Ctrl+B 或 Command+Option+C 这类组合。',
            'Shortcut conflict: %1$s and %2$s both use %3$s on %4$s.' => '快捷键冲突：%1$s 与 %2$s 在 %4$s 上都使用了 %3$s。',
        );

        return isset($translations[$text]) ? $translations[$text] : $translation;
    }
}
