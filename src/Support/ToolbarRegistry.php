<?php

namespace EasyMDE\Support;

if (!defined('ABSPATH')) {
    exit;
}

final class ToolbarRegistry
{
    private $toolbar_buttons = array();
    private $shortcode_helpers = array();

    public function __construct()
    {
        $this->register_default_toolbar_buttons();
    }

    public function register_toolbar_button($id, array $config)
    {
        $this->toolbar_buttons[sanitize_key($id)] = $this->normalize_command_config($id, $config);
    }

    public function register_shortcode_helper($id, array $config)
    {
        $this->shortcode_helpers[sanitize_key($id)] = $config;
    }

    public function get_command_registry()
    {
        return $this->toolbar_buttons;
    }

    public function get_commands_for_script()
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

    public function get_shortcode_helpers_for_script()
    {
        return array_values($this->shortcode_helpers);
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

    private function register_default_toolbar_buttons()
    {
        $this->register_toolbar_button(
            'savepost',
            array(
                'label' => __('Save post', 'easymde'),
                'icon' => 'saved',
                'surface' => 'hidden',
                'action' => 'savePost',
                'group' => 'system',
                'defaultShortcutWin' => 'Ctrl+S',
                'defaultShortcutMac' => 'Cmd+S',
            )
        );

        $this->register_toolbar_button(
            'bold',
            array(
                'label' => __('Bold', 'easymde'),
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

        $this->register_toolbar_button(
            'italic',
            array(
                'label' => __('Italic', 'easymde'),
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

        $this->register_toolbar_button(
            'strike',
            array(
                'label' => __('Strikethrough', 'easymde'),
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

        $this->register_toolbar_button(
            'paragraph',
            array(
                'label' => __('Paragraph', 'easymde'),
                'icon' => 'editor-paragraph',
                'surface' => 'heading-menu',
                'action' => 'paragraph',
                'group' => 'heading',
                'defaultShortcutWin' => 'Ctrl+0',
                'defaultShortcutMac' => 'Cmd+0',
            )
        );

        $heading_labels = array(
            1 => __('Heading 1', 'easymde'),
            2 => __('Heading 2', 'easymde'),
            3 => __('Heading 3', 'easymde'),
            4 => __('Heading 4', 'easymde'),
            5 => __('Heading 5', 'easymde'),
            6 => __('Heading 6', 'easymde'),
        );

        for ($level = 1; $level <= 6; ++$level) {
            $this->register_toolbar_button(
                'heading' . $level,
                array(
                    'label' => $heading_labels[$level],
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

        $this->register_toolbar_button(
            'quote',
            array(
                'label' => __('Quote', 'easymde'),
                'icon' => 'format-quote',
                'surface' => 'main',
                'action' => 'quote',
                'group' => 'block',
                'linePrefix' => '> ',
                'defaultShortcutWin' => 'Ctrl+Shift+Q',
                'defaultShortcutMac' => 'Cmd+Option+Q',
            )
        );

        $this->register_toolbar_button(
            'unorderedlist',
            array(
                'label' => __('Unordered list', 'easymde'),
                'icon' => 'editor-ul',
                'surface' => 'main',
                'action' => 'unorderedList',
                'group' => 'block',
                'linePrefix' => '- ',
                'defaultShortcutWin' => 'Ctrl+Shift+]',
                'defaultShortcutMac' => 'Cmd+Option+U',
            )
        );

        $this->register_toolbar_button(
            'orderedlist',
            array(
                'label' => __('Ordered list', 'easymde'),
                'icon' => 'editor-ol',
                'surface' => 'main',
                'action' => 'orderedList',
                'group' => 'block',
                'linePrefix' => '1. ',
                'defaultShortcutWin' => 'Ctrl+Shift+[',
                'defaultShortcutMac' => 'Cmd+Option+O',
            )
        );

        $this->register_toolbar_button(
            'inlinecode',
            array(
                'label' => __('Inline code', 'easymde'),
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

        $this->register_toolbar_button(
            'codefence',
            array(
                'label' => __('Code fence', 'easymde'),
                'icon' => 'media-code',
                'surface' => 'main',
                'action' => 'codeFence',
                'group' => 'insert',
                'defaultShortcutWin' => 'Ctrl+Shift+K',
                'defaultShortcutMac' => 'Cmd+Option+C',
            )
        );

        $this->register_toolbar_button(
            'mathblock',
            array(
                'label' => __('Math block', 'easymde'),
                'icon' => 'editor-code',
                'surface' => 'hidden',
                'action' => 'mathBlock',
                'group' => 'insert',
                'defaultShortcutWin' => 'Ctrl+Shift+M',
                'defaultShortcutMac' => 'Cmd+Option+B',
            )
        );

        $this->register_toolbar_button(
            'link',
            array(
                'label' => __('Link', 'easymde'),
                'icon' => 'admin-links',
                'surface' => 'main',
                'action' => 'link',
                'group' => 'insert',
                'defaultShortcutWin' => 'Ctrl+K',
                'defaultShortcutMac' => 'Cmd+K',
            )
        );

        $this->register_toolbar_button(
            'image',
            array(
                'label' => __('Image', 'easymde'),
                'icon' => 'format-image',
                'surface' => 'main',
                'action' => 'image',
                'group' => 'insert',
                'defaultShortcutWin' => 'Ctrl+Shift+I',
                'defaultShortcutMac' => 'Cmd+Ctrl+I',
            )
        );

        $this->register_toolbar_button(
            'copywechat',
            array(
                'label' => __('Copy to WeChat', 'easymde'),
                'icon' => 'copy',
                'surface' => 'main',
                'action' => 'copyWechat',
                'group' => 'export',
                'defaultShortcutWin' => 'Ctrl+Shift+W',
                'defaultShortcutMac' => 'Cmd+Ctrl+W',
            )
        );
    }
}
