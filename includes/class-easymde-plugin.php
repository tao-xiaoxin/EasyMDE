<?php

if (!defined('ABSPATH')) {
    exit;
}

require_once EASYMDE_PLUGIN_DIR . 'includes/class-easymde-markdown.php';

final class EasyMDE_Plugin
{
    private static $instance = null;

    /**
     * @var array<string,array<string,mixed>>
     */
    private $toolbar_buttons = array();

    /**
     * @var array<string,array<string,mixed>>
     */
    private $shortcode_helpers = array();

    private $custom_css_user_meta_key = 'easymde_custom_css_library';

    private $default_theme_user_meta_key = 'easymde_default_theme_state';

    private $editor_settings_option_key = 'easymde_editor_settings';

    private $editor_settings_version = '0.1.7';

    public static function init()
    {
        if (null === self::$instance) {
            self::$instance = new self();
        }

        return self::$instance;
    }

    public static function instance()
    {
        return self::init();
    }

    private function __construct()
    {
        add_filter('gettext_easymde', array($this, 'translate_simplified_chinese'), 10, 3);
        add_filter('use_block_editor_for_post_type', array($this, 'maybe_disable_block_editor'), 10, 2);
        add_action('admin_init', array($this, 'register_settings'));
        add_action('admin_enqueue_scripts', array($this, 'enqueue_admin_assets'));
        add_action('wp_enqueue_scripts', array($this, 'enqueue_frontend_assets'));
        add_action('edit_form_after_title', array($this, 'render_editor_shell'));
        add_action('admin_menu', array($this, 'register_admin_menu'));
        add_action('rest_api_init', array($this, 'register_rest_routes'));
        add_action('save_post', array($this, 'save_post_meta'), 10, 3);
        add_filter('the_content', array($this, 'render_markdown_content'), 8);
        add_filter('wp_insert_post_data', array($this, 'render_markdown_post_content'), 10, 2);

        $this->register_default_toolbar_buttons();
    }

    public function translate_simplified_chinese($translation, $text, $domain)
    {
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
            'Cute green' => '萌绿风',
            'Fullstack blue' => '全栈蓝',
            'Minimal black' => '极简黑',
            'Orange blue' => '橙蓝风',
            'Frontend peak' => '前端之巅同款',
            'Code theme' => '代码主题',
            'Mac code frame' => 'Mac 代码框',
            'Custom CSS' => '自定义 CSS',
            'Named custom CSS' => '命名自定义 CSS',
            'CSS name' => 'CSS 名称',
            'Save CSS' => '保存 CSS',
            'Saved CSS.' => 'CSS 已保存。',
            'CSS save failed.' => 'CSS 保存失败。',
            'No custom CSS saved yet.' => '尚未保存自定义 CSS。',
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

    public function register_admin_menu()
    {
        add_options_page(
            __('EasyMDE', 'easymde'),
            __('EasyMDE', 'easymde'),
            'manage_options',
            'easymde',
            array($this, 'render_settings_page')
        );
    }

    public function register_settings()
    {
        register_setting(
            'easymde_settings',
            $this->editor_settings_option_key,
            array(
                'type' => 'array',
                'sanitize_callback' => array($this, 'sanitize_editor_settings'),
                'default' => $this->get_editor_settings(),
            )
        );
    }

    public function render_settings_page()
    {
        if (!current_user_can('manage_options')) {
            return;
        }

        $has_commonmark = class_exists('League\\CommonMark\\GithubFlavoredMarkdownConverter');
        $settings = $this->get_editor_settings();
        $commands = $this->get_command_registry();
        ?>
        <div class="wrap">
            <h1><?php esc_html_e('EasyMDE', 'easymde'); ?></h1>
            <p><?php esc_html_e('EasyMDE adds a scoped split-pane Markdown editor to supported post editing screens.', 'easymde'); ?></p>
            <?php settings_errors(); ?>

            <table class="widefat striped" style="max-width: 920px; margin-bottom: 20px;">
                <tbody>
                    <tr>
                        <th scope="row"><?php esc_html_e('Supported post types', 'easymde'); ?></th>
                        <td><?php echo esc_html(implode(', ', apply_filters('easymde_supported_post_types', array('post', 'page')))); ?></td>
                    </tr>
                    <tr>
                        <th scope="row"><?php esc_html_e('Server renderer', 'easymde'); ?></th>
                        <td>
                            <?php
                            echo $has_commonmark
                                ? esc_html__('league/commonmark is active.', 'easymde')
                                : esc_html__('Fallback renderer is active. Install Composer dependencies for full CommonMark/GFM support.', 'easymde');
                            ?>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><?php esc_html_e('Admin behavior', 'easymde'); ?></th>
                        <td><?php esc_html_e('No activation redirect and no unrelated admin-page redirect.', 'easymde'); ?></td>
                    </tr>
                    <tr>
                        <th scope="row"><?php esc_html_e('Toolbar layout', 'easymde'); ?></th>
                        <td><?php esc_html_e('Hybrid icon toolbar', 'easymde'); ?></td>
                    </tr>
                    <tr>
                        <th scope="row"><?php esc_html_e('Current preset', 'easymde'); ?></th>
                        <td><?php esc_html_e('Typora-inspired shortcuts', 'easymde'); ?></td>
                    </tr>
                </tbody>
            </table>

            <form action="options.php" method="post">
                <?php settings_fields('easymde_settings'); ?>
                <input type="hidden" name="<?php echo esc_attr($this->editor_settings_option_key); ?>[toolbar_layout]" value="hybrid-icons">
                <input type="hidden" name="<?php echo esc_attr($this->editor_settings_option_key); ?>[version]" value="<?php echo esc_attr($this->editor_settings_version); ?>">

                <h2><?php esc_html_e('Shortcut settings', 'easymde'); ?></h2>
                <p><?php esc_html_e('Typora-inspired defaults are active unless overridden below.', 'easymde'); ?></p>
                <p class="description"><?php esc_html_e('Use the current Typora-inspired default by leaving the field blank.', 'easymde'); ?></p>

                <table class="widefat striped" style="max-width: 1100px;">
                    <thead>
                        <tr>
                            <th scope="col" style="width: 28%;"><?php esc_html_e('Command', 'easymde'); ?></th>
                            <th scope="col" style="width: 36%;"><?php esc_html_e('Windows / Linux', 'easymde'); ?></th>
                            <th scope="col" style="width: 36%;"><?php esc_html_e('macOS', 'easymde'); ?></th>
                        </tr>
                    </thead>
                    <tbody>
                        <?php foreach ($commands as $command_id => $command) : ?>
                            <?php
                            $shortcut = isset($settings['shortcuts'][$command_id]) ? $settings['shortcuts'][$command_id] : array('win' => '', 'mac' => '');
                            $default_win = isset($command['defaultShortcutWin']) ? $command['defaultShortcutWin'] : '';
                            $default_mac = isset($command['defaultShortcutMac']) ? $command['defaultShortcutMac'] : '';
                            ?>
                            <tr>
                                <th scope="row">
                                    <label for="easymde-shortcut-<?php echo esc_attr($command_id); ?>-win">
                                        <?php echo esc_html(translate($command['label'], 'easymde')); ?>
                                    </label>
                                </th>
                                <td>
                                    <input
                                        id="easymde-shortcut-<?php echo esc_attr($command_id); ?>-win"
                                        type="text"
                                        class="regular-text code"
                                        name="<?php echo esc_attr($this->editor_settings_option_key); ?>[shortcuts][<?php echo esc_attr($command_id); ?>][win]"
                                        value="<?php echo esc_attr($shortcut['win']); ?>"
                                        placeholder="<?php echo esc_attr($default_win); ?>"
                                    >
                                    <?php if ('' !== $default_win) : ?>
                                        <p class="description"><?php echo esc_html(sprintf(__('Default: %s', 'easymde'), $default_win)); ?></p>
                                    <?php endif; ?>
                                </td>
                                <td>
                                    <input
                                        id="easymde-shortcut-<?php echo esc_attr($command_id); ?>-mac"
                                        type="text"
                                        class="regular-text code"
                                        name="<?php echo esc_attr($this->editor_settings_option_key); ?>[shortcuts][<?php echo esc_attr($command_id); ?>][mac]"
                                        value="<?php echo esc_attr($shortcut['mac']); ?>"
                                        placeholder="<?php echo esc_attr($default_mac); ?>"
                                    >
                                    <?php if ('' !== $default_mac) : ?>
                                        <p class="description"><?php echo esc_html(sprintf(__('Default: %s', 'easymde'), $default_mac)); ?></p>
                                    <?php endif; ?>
                                </td>
                            </tr>
                        <?php endforeach; ?>
                    </tbody>
                </table>

                <?php submit_button(); ?>
            </form>
        </div>
        <?php
    }

    public function sanitize_editor_settings($input)
    {
        $current = $this->get_editor_settings();
        $registry = $this->get_command_registry();
        $sanitized = array(
            'version' => $this->editor_settings_version,
            'toolbar_layout' => 'hybrid-icons',
            'shortcuts' => $this->get_default_shortcuts(),
        );
        $errors = array();
        $seen = array(
            'win' => array(),
            'mac' => array(),
        );

        $input = is_array($input) ? $input : array();
        $input_shortcuts = isset($input['shortcuts']) && is_array($input['shortcuts']) ? $input['shortcuts'] : array();

        foreach ($registry as $command_id => $command) {
            foreach (array('win', 'mac') as $platform) {
                $raw_value = '';
                if (isset($input_shortcuts[$command_id][$platform])) {
                    $raw_value = trim((string) $input_shortcuts[$command_id][$platform]);
                }

                if ('' === $raw_value) {
                    $raw_value = isset($sanitized['shortcuts'][$command_id][$platform]) ? $sanitized['shortcuts'][$command_id][$platform] : '';
                }

                $normalized = $this->normalize_shortcut_value($raw_value, $platform);
                if (false === $normalized) {
                    $errors[] = sprintf(
                        __('Invalid shortcut value for %1$s (%2$s). Use combinations like Ctrl+B or Command+Option+C.', 'easymde'),
                        translate($command['label'], 'easymde'),
                        $this->get_platform_label($platform)
                    );
                    continue;
                }

                $sanitized['shortcuts'][$command_id][$platform] = $normalized;

                if ('' !== $normalized) {
                    if (isset($seen[$platform][$normalized])) {
                        $errors[] = sprintf(
                            __('Shortcut conflict: %1$s and %2$s both use %3$s on %4$s.', 'easymde'),
                            $seen[$platform][$normalized],
                            translate($command['label'], 'easymde'),
                            $normalized,
                            $this->get_platform_label($platform)
                        );
                        continue;
                    }

                    $seen[$platform][$normalized] = translate($command['label'], 'easymde');
                }
            }
        }

        if (!empty($errors)) {
            foreach ($errors as $index => $message) {
                add_settings_error(
                    $this->editor_settings_option_key,
                    'easymde_shortcut_error_' . $index,
                    $message,
                    'error'
                );
            }

            return $current;
        }

        return $sanitized;
    }

    public static function register_toolbar_button($id, array $config)
    {
        self::instance()->toolbar_buttons[sanitize_key($id)] = self::instance()->normalize_command_config($id, $config);
    }

    public static function register_shortcode_helper($id, array $config)
    {
        self::instance()->shortcode_helpers[sanitize_key($id)] = $config;
    }

    public function maybe_disable_block_editor($use_block_editor, $post_type)
    {
        if (!$this->is_supported_post_type($post_type)) {
            return $use_block_editor;
        }

        return false;
    }

    public function enqueue_admin_assets($hook)
    {
        if (!in_array($hook, array('post.php', 'post-new.php'), true)) {
            return;
        }

        $screen = get_current_screen();
        if (!$screen || !$this->is_supported_post_type($screen->post_type)) {
            return;
        }

        $post_id = isset($_GET['post']) ? absint(wp_unslash($_GET['post'])) : 0;

        wp_enqueue_style('dashicons');
        wp_enqueue_style(
            'easymde-admin',
            EASYMDE_PLUGIN_URL . 'assets/css/easymde-admin.css',
            array(),
            EASYMDE_VERSION
        );

        $this->enqueue_render_assets($post_id);

        wp_enqueue_script(
            'easymde-admin',
            EASYMDE_PLUGIN_URL . 'assets/js/easymde-admin.js',
            array('jquery', 'wp-api-fetch', 'easymde-enhancements'),
            EASYMDE_VERSION,
            true
        );

        wp_enqueue_media();

        wp_localize_script(
            'easymde-admin',
            'EasyMDEConfig',
            array(
                'restUrl' => esc_url_raw(rest_url('easymde/v1/preview')),
                'nonce' => wp_create_nonce('wp_rest'),
                'features' => $this->get_feature_config(),
                'storage' => $this->get_storage_config($post_id),
                'themeOptionsUrl' => esc_url_raw(rest_url('easymde/v1/theme-options')),
                'customCssUrl' => esc_url_raw(rest_url('easymde/v1/custom-css')),
                'themeOptions' => $this->get_theme_options_for_script($post_id),
                'commands' => $this->get_commands_for_script(),
                'shortcuts' => $this->get_shortcut_config_for_script(),
                'editorSettings' => $this->get_editor_settings(),
                'copy' => array(
                    'mode' => 'wechat-rich-text',
                ),
                'shortcodeHelpers' => array_values($this->shortcode_helpers),
                'strings' => array(
                    'editorLabel' => __('Markdown source', 'easymde'),
                    'previewLabel' => __('Live preview', 'easymde'),
                    'previewEmpty' => __('Start writing Markdown to preview the article.', 'easymde'),
                    'previewError' => __('Preview failed. Please keep writing; saving is not affected.', 'easymde'),
                    'insertMedia' => __('Insert Media', 'easymde'),
                    'darkMode' => __('Dark mode', 'easymde'),
                    'lightMode' => __('Light mode', 'easymde'),
                    'appearance' => __('Appearance', 'easymde'),
                    'headings' => __('Headings', 'easymde'),
                    'articleTheme' => __('Article theme', 'easymde'),
                    'codeTheme' => __('Code theme', 'easymde'),
                    'macCodeFrame' => __('Mac code frame', 'easymde'),
                    'customCss' => __('Custom CSS', 'easymde'),
                    'namedCustomCss' => __('Named custom CSS', 'easymde'),
                    'cssName' => __('CSS name', 'easymde'),
                    'saveCss' => __('Save CSS', 'easymde'),
                    'cssSaved' => __('Saved CSS.', 'easymde'),
                    'cssSaveFailed' => __('CSS save failed.', 'easymde'),
                    'noCustomCss' => __('No custom CSS saved yet.', 'easymde'),
                    'draftSaved' => __('Local draft saved', 'easymde'),
                    'draftAvailable' => __('A newer local draft is available.', 'easymde'),
                    'restoreDraft' => __('Restore draft', 'easymde'),
                    'discardDraft' => __('Discard draft', 'easymde'),
                    'draftRestored' => __('Draft restored.', 'easymde'),
                    'draftDiscarded' => __('Draft discarded.', 'easymde'),
                    'renderingFailed' => __('Rendering failed.', 'easymde'),
                    'copyWechat' => __('Copy to WeChat', 'easymde'),
                    'copyWechatTitle' => __('Copy preview for WeChat', 'easymde'),
                    'copyWechatSuccess' => __('Copied preview for WeChat.', 'easymde'),
                    'copyWechatFailed' => __('Copy for WeChat failed. Please try again in this browser.', 'easymde'),
                    'copyWechatUnsupported' => __('Clipboard access is not available in this browser.', 'easymde'),
                ),
            )
        );
    }

    public function enqueue_frontend_assets()
    {
        if (!is_singular()) {
            return;
        }

        $post_id = get_queried_object_id();
        if (!$post_id || '' === get_post_meta($post_id, '_easymde_markdown', true)) {
            return;
        }

        $this->enqueue_render_assets($post_id);

        $theme_state = $this->get_theme_state($post_id);
        if (!empty($theme_state['customCss'])) {
            wp_add_inline_style(
                'easymde-render-themes',
                $this->scope_custom_css($theme_state['customCss'])
            );
        }

        wp_enqueue_script(
            'easymde-frontend',
            EASYMDE_PLUGIN_URL . 'assets/js/easymde-frontend.js',
            array('easymde-enhancements'),
            EASYMDE_VERSION,
            true
        );

        wp_localize_script(
            'easymde-frontend',
            'EasyMDEFrontendConfig',
            array(
                'features' => $this->get_feature_config(),
                'themeState' => $theme_state,
                'strings' => array(
                    'renderingFailed' => __('Rendering failed.', 'easymde'),
                ),
            )
        );
    }

    public function render_editor_shell($post)
    {
        if (!$post || !$this->is_supported_post_type($post->post_type)) {
            return;
        }

        $markdown = get_post_meta($post->ID, '_easymde_markdown', true);
        if ('' === $markdown) {
            $markdown = $post->post_content;
        }

        $theme_state = $this->get_theme_state($post->ID);

        wp_nonce_field('easymde_save_markdown', 'easymde_nonce');
        ?>
        <div id="easymde-editor" class="easymde-editor" data-post-id="<?php echo esc_attr($post->ID); ?>">
            <input type="hidden" id="easymde-markdown-field" name="easymde_markdown" value="<?php echo esc_attr($markdown); ?>">
            <input type="hidden" id="easymde-markdown-theme-field" name="easymde_markdown_theme" value="<?php echo esc_attr($theme_state['markdownTheme']); ?>">
            <input type="hidden" id="easymde-code-theme-field" name="easymde_code_theme" value="<?php echo esc_attr($theme_state['codeTheme']); ?>">
            <input type="hidden" id="easymde-code-mac-style-field" name="easymde_code_mac_style" value="<?php echo $theme_state['codeMacStyle'] ? '1' : '0'; ?>">
            <input type="hidden" id="easymde-custom-css-id-field" name="easymde_custom_css_id" value="<?php echo esc_attr($theme_state['customCssId']); ?>">
            <div class="easymde-toolbar" role="toolbar" aria-label="<?php esc_attr_e('Markdown toolbar', 'easymde'); ?>"></div>
            <div class="easymde-workspace">
                <section class="easymde-pane easymde-pane-source">
                    <header class="easymde-pane-header"><?php esc_html_e('Markdown', 'easymde'); ?></header>
                    <textarea id="easymde-source" class="easymde-source" spellcheck="false"><?php echo esc_textarea($markdown); ?></textarea>
                </section>
                <section class="easymde-pane easymde-pane-preview">
                    <header class="easymde-pane-header"><?php esc_html_e('Preview', 'easymde'); ?></header>
                    <article id="easymde-preview" class="<?php echo esc_attr($this->get_rendered_content_classes($theme_state, 'easymde-preview')); ?>" aria-live="polite"></article>
                </section>
                <aside class="easymde-side-actions" aria-label="<?php esc_attr_e('Output actions', 'easymde'); ?>"></aside>
            </div>
        </div>
        <?php
    }

    public function register_rest_routes()
    {
        register_rest_route(
            'easymde/v1',
            '/preview',
            array(
                'methods' => WP_REST_Server::CREATABLE,
                'callback' => array($this, 'handle_preview_request'),
                'permission_callback' => array($this, 'can_preview'),
                'args' => array(
                    'markdown' => array(
                        'type' => 'string',
                        'required' => true,
                    ),
                    'post_id' => array(
                        'type' => 'integer',
                        'required' => false,
                    ),
                    'markdown_theme' => array(
                        'type' => 'string',
                        'required' => false,
                    ),
                    'code_theme' => array(
                        'type' => 'string',
                        'required' => false,
                    ),
                    'code_mac_style' => array(
                        'type' => 'boolean',
                        'required' => false,
                    ),
                    'custom_css_id' => array(
                        'type' => 'string',
                        'required' => false,
                    ),
                ),
            )
        );

        register_rest_route(
            'easymde/v1',
            '/theme-options',
            array(
                'methods' => WP_REST_Server::READABLE,
                'callback' => array($this, 'handle_theme_options_request'),
                'permission_callback' => array($this, 'can_preview'),
                'args' => array(
                    'post_id' => array(
                        'type' => 'integer',
                        'required' => false,
                    ),
                ),
            )
        );

        register_rest_route(
            'easymde/v1',
            '/custom-css',
            array(
                'methods' => WP_REST_Server::CREATABLE,
                'callback' => array($this, 'handle_custom_css_save_request'),
                'permission_callback' => array($this, 'can_preview'),
                'args' => array(
                    'id' => array(
                        'type' => 'string',
                        'required' => false,
                    ),
                    'name' => array(
                        'type' => 'string',
                        'required' => true,
                    ),
                    'css' => array(
                        'type' => 'string',
                        'required' => true,
                    ),
                ),
            )
        );

        register_rest_route(
            'easymde/v1',
            '/custom-css/(?P<id>[a-z0-9_-]+)',
            array(
                'methods' => WP_REST_Server::DELETABLE,
                'callback' => array($this, 'handle_custom_css_delete_request'),
                'permission_callback' => array($this, 'can_preview'),
            )
        );
    }

    public function can_preview()
    {
        return current_user_can('edit_posts');
    }

    public function handle_preview_request(WP_REST_Request $request)
    {
        $markdown = (string) $request->get_param('markdown');
        $markdown_theme = $this->sanitize_markdown_theme_id($request->get_param('markdown_theme'));
        $html = EasyMDE_Markdown::render($markdown, $markdown_theme);

        return rest_ensure_response(
            array(
                'html' => $html,
            )
        );
    }

    public function handle_theme_options_request(WP_REST_Request $request)
    {
        $post_id = absint($request->get_param('post_id'));

        return rest_ensure_response($this->get_theme_options_for_script($post_id));
    }

    public function handle_custom_css_save_request(WP_REST_Request $request)
    {
        $user_id = get_current_user_id();
        $name = sanitize_text_field((string) $request->get_param('name'));
        $css = $this->sanitize_custom_css((string) $request->get_param('css'));
        $id = sanitize_key((string) $request->get_param('id'));

        if ('' === $name || '' === trim($css)) {
            return new WP_Error(
                'easymde_invalid_custom_css',
                __('CSS name and CSS content are required.', 'easymde'),
                array('status' => 400)
            );
        }

        $library = $this->get_custom_css_library($user_id);
        if ('' === $id || !isset($library[$id])) {
            $id = $this->unique_custom_css_id($name, $library);
        }

        foreach ($library as $existing_id => $item) {
            if ($existing_id !== $id && 0 === strcasecmp($item['name'], $name)) {
                return new WP_Error(
                    'easymde_duplicate_custom_css_name',
                    __('A custom CSS style with this name already exists.', 'easymde'),
                    array('status' => 409)
                );
            }
        }

        $library[$id] = array(
            'id' => $id,
            'name' => $name,
            'css' => $css,
            'updatedAt' => time(),
        );

        $this->update_custom_css_library($user_id, $library);

        return rest_ensure_response(
            array(
                'item' => $this->format_custom_css_item($library[$id]),
                'customCss' => array_values(array_map(array($this, 'format_custom_css_item'), $library)),
            )
        );
    }

    public function handle_custom_css_delete_request(WP_REST_Request $request)
    {
        $user_id = get_current_user_id();
        $id = sanitize_key((string) $request->get_param('id'));
        $library = $this->get_custom_css_library($user_id);

        if (!isset($library[$id])) {
            return new WP_Error(
                'easymde_custom_css_not_found',
                __('Custom CSS style not found.', 'easymde'),
                array('status' => 404)
            );
        }

        unset($library[$id]);
        $this->update_custom_css_library($user_id, $library);

        return rest_ensure_response(
            array(
                'customCss' => array_values(array_map(array($this, 'format_custom_css_item'), $library)),
            )
        );
    }

    public function render_markdown_content($content)
    {
        if (is_admin() || !is_singular()) {
            return $content;
        }

        $post_id = get_the_ID();
        if (!$post_id) {
            return $content;
        }

        $markdown = get_post_meta($post_id, '_easymde_markdown', true);
        if ('' === $markdown) {
            return $content;
        }

        $theme_state = $this->get_theme_state($post_id);

        return sprintf(
            '<div class="%s">%s</div>',
            esc_attr($this->get_rendered_content_classes($theme_state)),
            EasyMDE_Markdown::render($markdown, $theme_state['markdownTheme'])
        );
    }

    public function save_post_meta($post_id, $post, $update)
    {
        if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) {
            return;
        }

        if (wp_is_post_revision($post_id) || !$post || !$this->is_supported_post_type($post->post_type)) {
            return;
        }

        if (!isset($_POST['easymde_nonce']) || !wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['easymde_nonce'])), 'easymde_save_markdown')) {
            return;
        }

        if (!current_user_can('edit_post', $post_id)) {
            return;
        }

        if (!isset($_POST['easymde_markdown'])) {
            return;
        }

        $markdown = wp_unslash($_POST['easymde_markdown']);
        update_post_meta($post_id, '_easymde_markdown', $markdown);

        $markdown_theme = $this->sanitize_markdown_theme_id(isset($_POST['easymde_markdown_theme']) ? wp_unslash($_POST['easymde_markdown_theme']) : '');
        $code_theme = $this->sanitize_code_theme_id(isset($_POST['easymde_code_theme']) ? wp_unslash($_POST['easymde_code_theme']) : '');
        $code_mac_style = !empty($_POST['easymde_code_mac_style']) && '0' !== (string) wp_unslash($_POST['easymde_code_mac_style']);
        $custom_css_id = sanitize_key(isset($_POST['easymde_custom_css_id']) ? wp_unslash($_POST['easymde_custom_css_id']) : '');
        $custom_css = '';

        if ('custom' === $markdown_theme && '' !== $custom_css_id) {
            $custom_item = $this->get_custom_css_item($custom_css_id);
            if ($custom_item) {
                $custom_css = $custom_item['css'];
            }
        } else {
            $custom_css_id = '';
        }

        if ('custom' === $markdown_theme && '' === $custom_css) {
            $markdown_theme = 'default';
            $custom_css_id = '';
        }

        update_post_meta($post_id, '_easymde_markdown_theme', $markdown_theme);
        update_post_meta($post_id, '_easymde_code_theme', $code_theme);
        update_post_meta($post_id, '_easymde_code_mac_style', $code_mac_style ? '1' : '0');
        update_post_meta($post_id, '_easymde_custom_css_id', $custom_css_id);
        update_post_meta($post_id, '_easymde_custom_css_snapshot', $custom_css);

        update_user_meta(
            get_current_user_id(),
            $this->default_theme_user_meta_key,
            array(
                'markdownTheme' => $markdown_theme,
                'codeTheme' => $code_theme,
                'codeMacStyle' => $code_mac_style,
                'customCssId' => $custom_css_id,
                'defaultsVersion' => EASYMDE_VERSION,
            )
        );
    }

    public function render_markdown_post_content($data, $postarr)
    {
        if (!isset($_POST['easymde_nonce'], $_POST['easymde_markdown'])) {
            return $data;
        }

        if (!wp_verify_nonce(sanitize_text_field(wp_unslash($_POST['easymde_nonce'])), 'easymde_save_markdown')) {
            return $data;
        }

        if (empty($postarr['post_type']) || !$this->is_supported_post_type($postarr['post_type'])) {
            return $data;
        }

        $markdown = wp_unslash($_POST['easymde_markdown']);
        $markdown_theme = $this->sanitize_markdown_theme_id(isset($_POST['easymde_markdown_theme']) ? wp_unslash($_POST['easymde_markdown_theme']) : '');
        $data['post_content'] = EasyMDE_Markdown::render($markdown, $markdown_theme);

        return $data;
    }

    private function is_supported_post_type($post_type)
    {
        $supported = apply_filters('easymde_supported_post_types', array('post', 'page'));

        return in_array($post_type, $supported, true);
    }

    private function add_toolbar_button($id, array $config)
    {
        $this->toolbar_buttons[sanitize_key($id)] = $this->normalize_command_config($id, $config);
    }

    private function normalize_command_config($id, array $config)
    {
        $command_id = sanitize_key($id);

        return array_merge(
            array(
                'id' => $command_id,
                'label' => $command_id,
                'description' => '',
                'icon' => 'editor-code',
                'surface' => 'main',
                'action' => 'wrap',
                'group' => 'default',
                'prefix' => '',
                'suffix' => '',
                'linePrefix' => '',
                'defaultShortcutWin' => '',
                'defaultShortcutMac' => '',
            ),
            $config,
            array(
                'id' => $command_id,
            )
        );
    }

    private function enqueue_render_assets($post_id = 0)
    {
        $theme_state = $this->get_theme_state($post_id);
        $code_theme = $this->get_code_theme($theme_state['codeTheme']);

        wp_enqueue_style(
            'easymde-content',
            EASYMDE_PLUGIN_URL . 'assets/css/easymde-content.css',
            array(),
            EASYMDE_VERSION
        );

        wp_enqueue_style(
            'easymde-render-themes',
            EASYMDE_PLUGIN_URL . 'assets/css/easymde-themes.css',
            array('easymde-content'),
            EASYMDE_VERSION
        );

        wp_enqueue_style(
            'easymde-highlight-theme',
            $code_theme['cssUrl'],
            array('easymde-content'),
            EASYMDE_VERSION
        );

        wp_enqueue_style(
            'easymde-katex',
            EASYMDE_PLUGIN_URL . 'assets/vendor/katex/katex.min.css',
            array(),
            EASYMDE_VERSION
        );

        wp_enqueue_script(
            'easymde-highlight',
            EASYMDE_PLUGIN_URL . 'assets/vendor/highlight/highlight.min.js',
            array(),
            EASYMDE_VERSION,
            true
        );

        wp_enqueue_script(
            'easymde-katex',
            EASYMDE_PLUGIN_URL . 'assets/vendor/katex/katex.min.js',
            array(),
            EASYMDE_VERSION,
            true
        );

        wp_enqueue_script(
            'easymde-mermaid',
            EASYMDE_PLUGIN_URL . 'assets/vendor/mermaid/mermaid.min.js',
            array(),
            EASYMDE_VERSION,
            true
        );

        wp_enqueue_script(
            'easymde-enhancements',
            EASYMDE_PLUGIN_URL . 'assets/js/easymde-enhancements.js',
            array('easymde-highlight', 'easymde-katex', 'easymde-mermaid'),
            EASYMDE_VERSION,
            true
        );
    }

    private function get_theme_options_for_script($post_id)
    {
        $library = $this->get_custom_css_library(get_current_user_id());

        return array(
            'markdownThemes' => array_values($this->get_markdown_themes()),
            'codeThemes' => array_values($this->get_code_themes()),
            'customCss' => array_values(array_map(array($this, 'format_custom_css_item'), $library)),
            'state' => $this->get_theme_state($post_id),
        );
    }

    private function get_markdown_themes()
    {
        $themes = array(
            'default' => __('Default theme', 'easymde'),
            'md2html-normal' => __('Markdown2Html default', 'easymde'),
            'orange-heart' => __('Orange heart', 'easymde'),
            'chazi-purple' => __('Chazi purple', 'easymde'),
            'nenqing-green' => __('Nenqing green', 'easymde'),
            'green-vitality' => __('Green vitality', 'easymde'),
            'red-crimson' => __('Red crimson', 'easymde'),
            'blue-ying' => __('Blue ying', 'easymde'),
            'lanqing' => __('Lanqing', 'easymde'),
            'yamabuki' => __('Yamabuki', 'easymde'),
            'grid-black' => __('Grid black', 'easymde'),
            'geek-black' => __('Geek black', 'easymde'),
            'rose-purple' => __('Rose purple', 'easymde'),
            'cute-green' => __('Cute green', 'easymde'),
            'fullstack-blue' => __('Fullstack blue', 'easymde'),
            'minimal-black' => __('Minimal black', 'easymde'),
            'orange-blue' => __('Orange blue', 'easymde'),
            'frontend-peak' => __('Frontend peak', 'easymde'),
        );

        $registered = array();
        foreach ($themes as $id => $label) {
            $registered[$id] = array(
                'id' => $id,
                'label' => $label,
                'className' => 'easymde-markdown-theme-' . $id,
            );
        }

        return $registered;
    }

    private function get_code_themes()
    {
        $base_url = EASYMDE_PLUGIN_URL . 'assets/vendor/highlight/';

        return array(
            'github' => array(
                'id' => 'github',
                'label' => 'github',
                'cssUrl' => $base_url . 'github.min.css',
            ),
            'github-dark' => array(
                'id' => 'github-dark',
                'label' => 'github-dark',
                'cssUrl' => $base_url . 'github-dark.min.css',
            ),
            'atom-one-dark' => array(
                'id' => 'atom-one-dark',
                'label' => 'atom-one-dark',
                'cssUrl' => $base_url . 'atom-one-dark.min.css',
            ),
            'atom-one-light' => array(
                'id' => 'atom-one-light',
                'label' => 'atom-one-light',
                'cssUrl' => $base_url . 'atom-one-light.min.css',
            ),
            'monokai' => array(
                'id' => 'monokai',
                'label' => 'monokai',
                'cssUrl' => $base_url . 'monokai.min.css',
            ),
            'vs2015' => array(
                'id' => 'vs2015',
                'label' => 'vs2015',
                'cssUrl' => $base_url . 'vs2015.min.css',
            ),
            'xcode' => array(
                'id' => 'xcode',
                'label' => 'xcode',
                'cssUrl' => $base_url . 'xcode.min.css',
            ),
            'wechat-inspired' => array(
                'id' => 'wechat-inspired',
                'label' => __('Wechat inspired', 'easymde'),
                'cssUrl' => $base_url . 'wechat-inspired.min.css',
            ),
        );
    }

    private function get_code_theme($id)
    {
        $themes = $this->get_code_themes();
        $id = $this->sanitize_code_theme_id($id);

        return $themes[$id];
    }

    private function get_theme_state($post_id)
    {
        $post_id = absint($post_id);
        $defaults = $this->get_default_theme_state();

        $markdown_theme = $defaults['markdownTheme'];
        $code_theme = $defaults['codeTheme'];
        $code_mac_style = $defaults['codeMacStyle'];
        $custom_css_id = $defaults['customCssId'];
        $custom_css = '';

        if ($post_id) {
            $stored_markdown_theme = get_post_meta($post_id, '_easymde_markdown_theme', true);
            $stored_code_theme = get_post_meta($post_id, '_easymde_code_theme', true);

            if ('' !== $stored_markdown_theme) {
                $markdown_theme = $stored_markdown_theme;
            }

            if ('' !== $stored_code_theme) {
                $code_theme = $stored_code_theme;
            }

            $stored_code_mac_style = get_post_meta($post_id, '_easymde_code_mac_style', true);
            if ('' !== $stored_code_mac_style) {
                $code_mac_style = '1' === $stored_code_mac_style;
            }

            $custom_css_id = sanitize_key((string) get_post_meta($post_id, '_easymde_custom_css_id', true));
            $custom_css = $this->sanitize_custom_css((string) get_post_meta($post_id, '_easymde_custom_css_snapshot', true));
        }

        $markdown_theme = $this->sanitize_markdown_theme_id($markdown_theme);
        $code_theme = $this->sanitize_code_theme_id($code_theme);
        $custom_css_id = sanitize_key($custom_css_id);

        if ('custom' === $markdown_theme && '' === $custom_css) {
            $custom_item = $this->get_custom_css_item($custom_css_id);
            if ($custom_item) {
                $custom_css = $custom_item['css'];
            }
        }

        if ('custom' !== $markdown_theme || '' === $custom_css) {
            $custom_css_id = '';
            $custom_css = '';
            if ('custom' === $markdown_theme) {
                $markdown_theme = 'default';
            }
        }

        return array(
            'markdownTheme' => $markdown_theme,
            'codeTheme' => $code_theme,
            'codeMacStyle' => (bool) $code_mac_style,
            'customCssId' => $custom_css_id,
            'customCss' => $custom_css,
            'scopedCustomCss' => $this->scope_custom_css($custom_css),
        );
    }

    private function get_default_theme_state()
    {
        $stored = get_user_meta(get_current_user_id(), $this->default_theme_user_meta_key, true);
        if (!is_array($stored)) {
            $stored = array();
        }

        $stored_code_theme = isset($stored['codeTheme']) ? $stored['codeTheme'] : 'atom-one-dark';
        $stored_code_mac_style = array_key_exists('codeMacStyle', $stored) ? !empty($stored['codeMacStyle']) : true;

        if (empty($stored['defaultsVersion']) && 'github' === $stored_code_theme && !$stored_code_mac_style) {
            $stored_code_theme = 'atom-one-dark';
            $stored_code_mac_style = true;
        }

        return array(
            'markdownTheme' => $this->sanitize_markdown_theme_id(isset($stored['markdownTheme']) ? $stored['markdownTheme'] : 'default'),
            'codeTheme' => $this->sanitize_code_theme_id($stored_code_theme),
            'codeMacStyle' => $stored_code_mac_style,
            'customCssId' => sanitize_key(isset($stored['customCssId']) ? $stored['customCssId'] : ''),
        );
    }

    private function sanitize_markdown_theme_id($id)
    {
        $id = sanitize_key((string) $id);
        if ('custom' === $id) {
            return 'custom';
        }

        $themes = $this->get_markdown_themes();

        return isset($themes[$id]) ? $id : 'default';
    }

    private function sanitize_code_theme_id($id)
    {
        $id = sanitize_key((string) $id);
        $themes = $this->get_code_themes();

        return isset($themes[$id]) ? $id : 'atom-one-dark';
    }

    private function get_custom_css_library($user_id)
    {
        $library = get_user_meta($user_id, $this->custom_css_user_meta_key, true);
        if (!is_array($library)) {
            return array();
        }

        $normalized = array();
        foreach ($library as $item) {
            if (!is_array($item) || empty($item['id']) || empty($item['name']) || empty($item['css'])) {
                continue;
            }

            $id = sanitize_key($item['id']);
            if ('' === $id) {
                continue;
            }

            $normalized[$id] = array(
                'id' => $id,
                'name' => sanitize_text_field($item['name']),
                'css' => $this->sanitize_custom_css($item['css']),
                'updatedAt' => isset($item['updatedAt']) ? absint($item['updatedAt']) : 0,
            );
        }

        return $normalized;
    }

    private function update_custom_css_library($user_id, array $library)
    {
        update_user_meta($user_id, $this->custom_css_user_meta_key, array_values($library));
    }

    private function get_custom_css_item($id)
    {
        $library = $this->get_custom_css_library(get_current_user_id());
        $id = sanitize_key($id);

        return isset($library[$id]) ? $library[$id] : null;
    }

    private function format_custom_css_item($item)
    {
        return array(
            'id' => $item['id'],
            'name' => $item['name'],
            'css' => $item['css'],
            'scopedCss' => $this->scope_custom_css($item['css']),
            'updatedAt' => $item['updatedAt'],
        );
    }

    private function unique_custom_css_id($name, array $library)
    {
        $base = sanitize_title($name);
        if ('' === $base) {
            $base = 'custom-css';
        }

        $id = sanitize_key($base);
        $suffix = 2;
        while (isset($library[$id])) {
            $id = sanitize_key($base . '-' . $suffix);
            ++$suffix;
        }

        return $id;
    }

    private function sanitize_custom_css($css)
    {
        $css = wp_strip_all_tags((string) $css);
        $css = str_replace(array("\0", '</style', '<style'), '', $css);
        $css = preg_replace('/@import\s+[^;]+;/i', '', $css);
        $css = preg_replace('/@charset\s+[^;]+;/i', '', $css);
        $css = preg_replace('/url\s*\([^)]*\)/i', 'none', $css);
        $css = preg_replace('/expression\s*\([^)]*\)/i', '', $css);
        $css = preg_replace('/behavior\s*:/i', 'removed-behavior:', $css);
        $css = preg_replace('/-moz-binding\s*:/i', 'removed-binding:', $css);
        $css = preg_replace('/javascript\s*:/i', 'removed:', $css);

        return trim(substr($css, 0, 30000));
    }

    private function scope_custom_css($css)
    {
        $css = $this->sanitize_custom_css($css);
        if ('' === $css) {
            return '';
        }

        $scope = '.easymde-rendered-content.easymde-custom-css-active';

        return preg_replace_callback(
            '/(^|})(\s*)([^{}@][^{}]*)\{/',
            function ($matches) use ($scope) {
                $selectors = array_map('trim', explode(',', $matches[3]));
                $scoped = array();

                foreach ($selectors as $selector) {
                    if ('' === $selector) {
                        continue;
                    }

                    if (0 === strpos($selector, $scope)) {
                        $scoped[] = $selector;
                    } else {
                        $scoped[] = $scope . ' ' . $selector;
                    }
                }

                return $matches[1] . $matches[2] . implode(', ', $scoped) . ' {';
            },
            $css
        );
    }

    private function get_rendered_content_classes(array $theme_state, $extra = '')
    {
        $classes = array('easymde-rendered-content');

        if ('' !== $extra) {
            $classes[] = $extra;
        }

        if ('custom' === $theme_state['markdownTheme']) {
            $classes[] = 'easymde-markdown-theme-custom';
            $classes[] = 'easymde-custom-css-active';
        } else {
            $classes[] = 'easymde-markdown-theme-' . sanitize_html_class($theme_state['markdownTheme']);
        }

        $classes[] = 'easymde-code-theme-' . sanitize_html_class($theme_state['codeTheme']);

        if (!empty($theme_state['codeMacStyle'])) {
            $classes[] = 'easymde-code-mac';
        }

        return implode(' ', array_filter($classes));
    }

    private function get_feature_config()
    {
        return array(
            'darkMode' => true,
            'localDrafts' => true,
            'syntaxHighlight' => true,
            'mermaid' => true,
            'math' => true,
            'toc' => true,
            'wechatCopy' => true,
        );
    }

    private function get_storage_config($post_id)
    {
        $site_key = substr(md5(home_url('/')), 0, 12);
        $user_id = get_current_user_id();
        $post_key = $post_id ? (string) $post_id : 'new';

        return array(
            'siteKey' => $site_key,
            'userId' => $user_id,
            'postId' => $post_id,
            'draftKey' => 'easymde:draft:' . $site_key . ':' . $user_id . ':' . $post_key,
            'themeKey' => 'easymde:theme:' . $site_key . ':' . $user_id,
        );
    }

    private function get_command_registry()
    {
        return $this->toolbar_buttons;
    }

    private function get_commands_for_script()
    {
        $commands = array_values($this->get_command_registry());

        foreach ($commands as &$command) {
            if (!empty($command['label']) && is_string($command['label'])) {
                $command['label'] = translate($command['label'], 'easymde');
            }

            if (!empty($command['description']) && is_string($command['description'])) {
                $command['description'] = translate($command['description'], 'easymde');
            }
        }

        return $commands;
    }

    private function get_shortcut_config_for_script()
    {
        $settings = $this->get_editor_settings();
        $registry = $this->get_command_registry();
        $shortcuts = array();

        foreach ($registry as $command_id => $command) {
            $shortcuts[$command_id] = array(
                'win' => isset($settings['shortcuts'][$command_id]['win']) ? $settings['shortcuts'][$command_id]['win'] : '',
                'mac' => isset($settings['shortcuts'][$command_id]['mac']) ? $settings['shortcuts'][$command_id]['mac'] : '',
            );
        }

        return $shortcuts;
    }

    private function get_editor_settings()
    {
        $defaults = array(
            'version' => $this->editor_settings_version,
            'toolbar_layout' => 'hybrid-icons',
            'shortcuts' => $this->get_default_shortcuts(),
        );
        $stored = get_option($this->editor_settings_option_key, array());
        if (!is_array($stored)) {
            return $defaults;
        }

        $settings = $defaults;

        if (!empty($stored['version']) && is_string($stored['version'])) {
            $settings['version'] = sanitize_text_field($stored['version']);
        }

        if (!empty($stored['toolbar_layout']) && 'hybrid-icons' === $stored['toolbar_layout']) {
            $settings['toolbar_layout'] = 'hybrid-icons';
        }

        if (!empty($stored['shortcuts']) && is_array($stored['shortcuts'])) {
            foreach ($this->get_command_registry() as $command_id => $command) {
                foreach (array('win', 'mac') as $platform) {
                    if (!isset($stored['shortcuts'][$command_id][$platform])) {
                        continue;
                    }

                    $normalized = $this->normalize_shortcut_value($stored['shortcuts'][$command_id][$platform], $platform);
                    if (false !== $normalized && '' !== $normalized) {
                        $settings['shortcuts'][$command_id][$platform] = $normalized;
                    }
                }
            }
        }

        return $settings;
    }

    private function get_default_shortcuts()
    {
        $shortcuts = array();

        foreach ($this->get_command_registry() as $command_id => $command) {
            $shortcuts[$command_id] = array(
                'win' => isset($command['defaultShortcutWin']) ? (string) $command['defaultShortcutWin'] : '',
                'mac' => isset($command['defaultShortcutMac']) ? (string) $command['defaultShortcutMac'] : '',
            );
        }

        return $shortcuts;
    }

    private function get_platform_label($platform)
    {
        return 'mac' === $platform ? __('macOS', 'easymde') : __('Windows / Linux', 'easymde');
    }

    private function normalize_shortcut_value($value, $platform)
    {
        $value = trim((string) $value);
        if ('' === $value) {
            return '';
        }

        $parts = preg_split('/\s*\+\s*/', $value);
        if (!$parts || count($parts) < 2) {
            return false;
        }

        $modifiers = array();
        $key = '';
        foreach ($parts as $part) {
            if ('' === $part) {
                return false;
            }

            $modifier = $this->normalize_shortcut_modifier($part, $platform);
            if ('' !== $modifier) {
                if (isset($modifiers[$modifier])) {
                    return false;
                }

                $modifiers[$modifier] = true;
                continue;
            }

            $normalized_key = $this->normalize_shortcut_key($part);
            if ('' === $normalized_key || '' !== $key) {
                return false;
            }

            $key = $normalized_key;
        }

        if ('' === $key || empty($modifiers)) {
            return false;
        }

        $order = 'mac' === $platform
            ? array('Cmd', 'Ctrl', 'Option', 'Shift')
            : array('Ctrl', 'Alt', 'Shift', 'Meta');

        $normalized_parts = array();
        foreach ($order as $modifier) {
            if (isset($modifiers[$modifier])) {
                $normalized_parts[] = $modifier;
            }
        }

        $normalized_parts[] = $key;

        return implode('+', $normalized_parts);
    }

    private function normalize_shortcut_modifier($modifier, $platform)
    {
        $modifier = strtolower(trim((string) $modifier));
        if ('' === $modifier) {
            return '';
        }

        if (in_array($modifier, array('mod', 'cmd', 'command', 'meta', 'super', 'win'), true)) {
            return 'mac' === $platform ? 'Cmd' : ('mod' === $modifier ? 'Ctrl' : 'Meta');
        }

        if (in_array($modifier, array('ctrl', 'control', 'ctl'), true)) {
            return 'Ctrl';
        }

        if (in_array($modifier, array('alt', 'option', 'opt'), true)) {
            return 'mac' === $platform ? 'Option' : 'Alt';
        }

        if ('shift' === $modifier) {
            return 'Shift';
        }

        return '';
    }

    private function normalize_shortcut_key($key)
    {
        $key = trim((string) $key);
        if ('' === $key) {
            return '';
        }

        $lower = strtolower($key);
        $special_keys = array(
            'tab' => 'Tab',
            'enter' => 'Enter',
            'return' => 'Enter',
            'space' => 'Space',
            'spacebar' => 'Space',
            'escape' => 'Escape',
            'esc' => 'Escape',
            'backspace' => 'Backspace',
            'delete' => 'Delete',
            'del' => 'Delete',
            'up' => 'Up',
            'arrowup' => 'Up',
            'down' => 'Down',
            'arrowdown' => 'Down',
            'left' => 'Left',
            'arrowleft' => 'Left',
            'right' => 'Right',
            'arrowright' => 'Right',
            'home' => 'Home',
            'end' => 'End',
            'pageup' => 'PageUp',
            'pagedown' => 'PageDown',
        );

        if (isset($special_keys[$lower])) {
            return $special_keys[$lower];
        }

        if (preg_match('/^f([1-9]|1[0-2])$/i', $key)) {
            return strtoupper($key);
        }

        if (1 === strlen($key)) {
            if (preg_match('/[a-z]/i', $key)) {
                return strtoupper($key);
            }

            if (preg_match('/[0-9\[\]`\\\\\\/\\.,\\-=]/', $key)) {
                return $key;
            }
        }

        return '';
    }

    private function register_default_toolbar_buttons()
    {
        $this->add_toolbar_button(
            'savepost',
            array(
                'label' => 'Save post',
                'icon' => 'saved',
                'surface' => 'hidden',
                'action' => 'savePost',
                'group' => 'system',
                'defaultShortcutWin' => 'Ctrl+S',
                'defaultShortcutMac' => 'Cmd+S',
            )
        );

        $this->add_toolbar_button(
            'bold',
            array(
                'label' => 'Bold',
                'icon' => 'editor-bold',
                'surface' => 'main',
                'action' => 'wrap',
                'group' => 'format',
                'prefix' => '**',
                'suffix' => '**',
                'defaultShortcutWin' => 'Ctrl+B',
                'defaultShortcutMac' => 'Cmd+B',
            )
        );

        $this->add_toolbar_button(
            'italic',
            array(
                'label' => 'Italic',
                'icon' => 'editor-italic',
                'surface' => 'main',
                'action' => 'wrap',
                'group' => 'format',
                'prefix' => '*',
                'suffix' => '*',
                'defaultShortcutWin' => 'Ctrl+I',
                'defaultShortcutMac' => 'Cmd+I',
            )
        );

        $this->add_toolbar_button(
            'strike',
            array(
                'label' => 'Strikethrough',
                'icon' => 'editor-strikethrough',
                'surface' => 'main',
                'action' => 'wrap',
                'group' => 'format',
                'prefix' => '~~',
                'suffix' => '~~',
                'defaultShortcutWin' => 'Alt+Shift+5',
                'defaultShortcutMac' => 'Ctrl+Shift+`',
            )
        );

        $this->add_toolbar_button(
            'paragraph',
            array(
                'label' => 'Paragraph',
                'icon' => 'editor-paragraph',
                'surface' => 'heading-menu',
                'action' => 'paragraph',
                'group' => 'heading',
                'defaultShortcutWin' => 'Ctrl+0',
                'defaultShortcutMac' => 'Cmd+0',
            )
        );

        for ($level = 1; $level <= 6; ++$level) {
            $this->add_toolbar_button(
                'heading' . $level,
                array(
                    'label' => 'Heading ' . $level,
                    'icon' => 'heading',
                    'surface' => 'heading-menu',
                    'action' => 'heading',
                    'group' => 'heading',
                    'level' => $level,
                    'defaultShortcutWin' => 'Ctrl+' . $level,
                    'defaultShortcutMac' => 'Cmd+' . $level,
                )
            );
        }

        $this->add_toolbar_button(
            'quote',
            array(
                'label' => 'Quote',
                'icon' => 'format-quote',
                'surface' => 'main',
                'action' => 'quote',
                'group' => 'block',
                'linePrefix' => '> ',
                'defaultShortcutWin' => 'Ctrl+Shift+Q',
                'defaultShortcutMac' => 'Cmd+Option+Q',
            )
        );

        $this->add_toolbar_button(
            'unorderedlist',
            array(
                'label' => 'Unordered list',
                'icon' => 'editor-ul',
                'surface' => 'main',
                'action' => 'unorderedList',
                'group' => 'block',
                'linePrefix' => '- ',
                'defaultShortcutWin' => 'Ctrl+Shift+]',
                'defaultShortcutMac' => 'Cmd+Option+U',
            )
        );

        $this->add_toolbar_button(
            'orderedlist',
            array(
                'label' => 'Ordered list',
                'icon' => 'editor-ol',
                'surface' => 'main',
                'action' => 'orderedList',
                'group' => 'block',
                'linePrefix' => '1. ',
                'defaultShortcutWin' => 'Ctrl+Shift+[',
                'defaultShortcutMac' => 'Cmd+Option+O',
            )
        );

        $this->add_toolbar_button(
            'inlinecode',
            array(
                'label' => 'Inline code',
                'icon' => 'editor-code',
                'surface' => 'main',
                'action' => 'wrap',
                'group' => 'insert',
                'prefix' => '`',
                'suffix' => '`',
                'defaultShortcutWin' => 'Ctrl+Shift+`',
                'defaultShortcutMac' => 'Cmd+Shift+`',
            )
        );

        $this->add_toolbar_button(
            'codefence',
            array(
                'label' => 'Code fence',
                'icon' => 'media-code',
                'surface' => 'main',
                'action' => 'codeFence',
                'group' => 'insert',
                'defaultShortcutWin' => 'Ctrl+Shift+K',
                'defaultShortcutMac' => 'Cmd+Option+C',
            )
        );

        $this->add_toolbar_button(
            'mathblock',
            array(
                'label' => 'Math block',
                'icon' => 'editor-code',
                'surface' => 'hidden',
                'action' => 'mathBlock',
                'group' => 'insert',
                'defaultShortcutWin' => 'Ctrl+Shift+M',
                'defaultShortcutMac' => 'Cmd+Option+B',
            )
        );

        $this->add_toolbar_button(
            'link',
            array(
                'label' => 'Link',
                'icon' => 'admin-links',
                'surface' => 'main',
                'action' => 'link',
                'group' => 'insert',
                'defaultShortcutWin' => 'Ctrl+K',
                'defaultShortcutMac' => 'Cmd+K',
            )
        );

        $this->add_toolbar_button(
            'image',
            array(
                'label' => 'Image',
                'icon' => 'format-image',
                'surface' => 'main',
                'action' => 'image',
                'group' => 'insert',
                'defaultShortcutWin' => 'Ctrl+Shift+I',
                'defaultShortcutMac' => 'Cmd+Ctrl+I',
            )
        );

        $this->add_toolbar_button(
            'copywechat',
            array(
                'label' => 'Copy to WeChat',
                'icon' => 'copy',
                'surface' => 'side',
                'action' => 'copyWechat',
                'group' => 'export',
                'defaultShortcutWin' => 'Ctrl+Shift+W',
                'defaultShortcutMac' => 'Cmd+Ctrl+W',
            )
        );
    }
}
