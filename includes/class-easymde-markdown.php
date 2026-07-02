<?php

if (!defined('ABSPATH')) {
    exit;
}

if (!class_exists('EasyMDE_Markdown')) {
    final class EasyMDE_Markdown
    {
        public static function render($markdown, $theme = '')
        {
            return \EasyMDE\Content\MarkdownRenderer::render($markdown, $theme);
        }
    }
}
