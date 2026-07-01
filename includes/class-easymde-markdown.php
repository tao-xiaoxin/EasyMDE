<?php

if (!defined('ABSPATH')) {
    exit;
}

final class EasyMDE_Markdown
{
    public static function render($markdown, $theme = '')
    {
        $markdown = (string) $markdown;
        $theme = sanitize_key((string) $theme);
        $math = array();
        $markdown = self::extract_math($markdown, $math);

        if (class_exists('League\\CommonMark\\GithubFlavoredMarkdownConverter')) {
            $converter = new League\CommonMark\GithubFlavoredMarkdownConverter(
                array(
                    'html_input' => 'strip',
                    'allow_unsafe_links' => false,
                )
            );

            $html = self::restore_math(wp_kses_post((string) $converter->convert($markdown)), $math);

            return self::post_process_html($html, $theme);
        }

        $html = self::restore_math(wp_kses_post(self::fallback_render($markdown)), $math);

        return self::post_process_html($html, $theme);
    }

    private static function fallback_render($markdown)
    {
        $markdown = str_replace(array("\r\n", "\r"), "\n", $markdown);
        $blocks = preg_split("/\n{2,}/", trim($markdown));
        $html = '';

        foreach ($blocks as $block) {
            $block = trim($block, "\n");

            if ('' === $block) {
                continue;
            }

            if (preg_match('/^```([a-zA-Z0-9_-]+)?\n([\s\S]*?)```$/', $block, $matches)) {
                $language = isset($matches[1]) ? sanitize_html_class($matches[1]) : '';
                $code = esc_html($matches[2]);
                $class = $language ? ' class="language-' . esc_attr($language) . '"' : '';
                $html .= '<pre><code' . $class . '>' . $code . '</code></pre>';
                continue;
            }

            if (preg_match('/^(#{1,6})\s+(.+)$/', $block, $matches)) {
                $level = strlen($matches[1]);
                $html .= '<h' . $level . '>' . self::inline_render($matches[2]) . '</h' . $level . '>';
                continue;
            }

            if (preg_match('/^>\s?/m', $block)) {
                $quote = preg_replace('/^>\s?/m', '', $block);
                $html .= '<blockquote><p>' . self::inline_render($quote) . '</p></blockquote>';
                continue;
            }

            if (preg_match('/^[-*]\s+/m', $block)) {
                $items = preg_split('/\n/', $block);
                $html .= '<ul>';
                foreach ($items as $item) {
                    $item = preg_replace('/^[-*]\s+/', '', trim($item));
                    if ('' !== $item) {
                        $html .= '<li>' . self::inline_render($item) . '</li>';
                    }
                }
                $html .= '</ul>';
                continue;
            }

            $html .= '<p>' . self::inline_render($block) . '</p>';
        }

        return $html;
    }

    private static function inline_render($text)
    {
        $text = esc_html($text);
        $text = preg_replace('/`([^`]+)`/', '<code>$1</code>', $text);
        $text = preg_replace('/\*\*([^*]+)\*\*/', '<strong>$1</strong>', $text);
        $text = preg_replace('/\*([^*]+)\*/', '<em>$1</em>', $text);
        $text = preg_replace('/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/', '<a href="$2">$1</a>', $text);
        $text = nl2br($text);

        return $text;
    }

    private static function extract_math($markdown, array &$math)
    {
        $patterns = array(
            '/\$\$([\s\S]+?)\$\$/',
            '/\\\\\[([\s\S]+?)\\\\\]/',
            '/\\\\\(([\s\S]+?)\\\\\)/',
            '/(?<!\\\\)\$([^\n$]+?)(?<!\\\\)\$/',
        );

        foreach ($patterns as $pattern) {
            $markdown = preg_replace_callback(
                $pattern,
                function ($matches) use (&$math, $pattern) {
                    $token = 'EASYMDE_MATH_' . count($math) . '_TOKEN';
                    $is_block = 0 === strpos($pattern, '/\$\$') || 0 === strpos($pattern, '/\\\\\[');
                    $math[$token] = array(
                        'tex' => $matches[1],
                        'block' => $is_block,
                    );

                    return $is_block ? "\n\n" . $token . "\n\n" : $token;
                },
                $markdown
            );
        }

        return $markdown;
    }

    private static function restore_math($html, array $math)
    {
        foreach ($math as $token => $item) {
            $tex = trim((string) $item['tex']);
            $escaped = esc_html($tex);
            $node = $item['block']
                ? '<div class="easymde-math easymde-math-block">$$' . $escaped . '$$</div>'
                : '<span class="easymde-math easymde-math-inline">\\(' . $escaped . '\\)</span>';

            if ($item['block']) {
                $html = preg_replace('/<p>\s*' . preg_quote($token, '/') . '\s*<\/p>/', $node, $html);
            }

            $html = str_replace($token, $node, $html);
        }

        return $html;
    }

    private static function post_process_html($html, $theme = '')
    {
        $html = self::add_heading_ids_and_toc($html);
        $html = self::add_theme_markup($html, $theme);

        return wp_kses_post($html);
    }

    private static function add_theme_markup($html, $theme)
    {
        $theme = sanitize_key((string) $theme);
        if (!self::theme_uses_markdown2html_markup($theme)) {
            return $html;
        }

        if (!class_exists('DOMDocument')) {
            return $html;
        }

        if (false === stripos($html, '<h') && false === stripos($html, '<a') && false === stripos($html, '<li')) {
            return $html;
        }

        $document = new DOMDocument('1.0', 'UTF-8');
        $previous_errors = libxml_use_internal_errors(true);
        $loaded = $document->loadHTML(
            '<?xml encoding="UTF-8"><div id="easymde-render-root">' . $html . '</div>',
            LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
        );
        libxml_clear_errors();
        libxml_use_internal_errors($previous_errors);

        if (!$loaded) {
            return $html;
        }

        $root = $document->getElementById('easymde-render-root');
        if (!$root) {
            return $html;
        }

        self::wrap_theme_headings($document, $root, $theme);
        self::wrap_theme_links($document, $root);

        return self::inner_html($root, $document);
    }

    private static function theme_uses_markdown2html_markup($theme)
    {
        return in_array(
            $theme,
            array(
                'md2html-normal',
                'orange-heart',
                'chazi-purple',
                'nenqing-green',
                'green-vitality',
                'red-crimson',
                'blue-ying',
                'lanqing',
                'yamabuki',
                'grid-black',
                'geek-black',
                'rose-purple',
                'cute-green',
                'fullstack-blue',
                'minimal-black',
                'orange-blue',
                'frontend-peak',
            ),
            true
        );
    }

    private static function wrap_theme_headings(DOMDocument $document, DOMElement $root, $theme)
    {
        $xpath = new DOMXPath($document);
        $headings = $xpath->query('.//h1|.//h2|.//h3|.//h4', $root);
        if (!$headings) {
            return;
        }

        foreach (iterator_to_array($headings) as $heading) {
            if (self::direct_child_with_class($heading, 'content')) {
                continue;
            }

            $content = $document->createElement('span');
            $content->setAttribute('class', 'content');

            while ($heading->firstChild) {
                $content->appendChild($heading->firstChild);
            }

            if (in_array($heading->nodeName, array('h1', 'h2', 'h3', 'h4'), true)) {
                $prefix = $document->createElement('span');
                $prefix->setAttribute('class', 'prefix');
                $heading->appendChild($prefix);
            }

            $heading->appendChild($content);

            if (in_array($heading->nodeName, array('h1', 'h2', 'h3', 'h4'), true)) {
                $suffix = $document->createElement('span');
                $suffix->setAttribute('class', 'suffix');
                $heading->appendChild($suffix);
            }
        }
    }

    private static function wrap_theme_links(DOMDocument $document, DOMElement $root)
    {
        $links = $root->getElementsByTagName('a');
        foreach (iterator_to_array($links) as $link) {
            if (self::direct_child_with_name($link, 'span')) {
                continue;
            }

            $span = $document->createElement('span');
            while ($link->firstChild) {
                $span->appendChild($link->firstChild);
            }
            $link->appendChild($span);
        }
    }

    private static function direct_child_with_class(DOMElement $element, $class_name)
    {
        foreach ($element->childNodes as $child) {
            if ($child instanceof DOMElement) {
                $classes = preg_split('/\s+/', (string) $child->getAttribute('class'));
                if (in_array($class_name, $classes, true)) {
                    return true;
                }
            }
        }

        return false;
    }

    private static function direct_child_with_name(DOMElement $element, $node_name)
    {
        foreach ($element->childNodes as $child) {
            if ($child instanceof DOMElement && strtolower($child->nodeName) === strtolower($node_name)) {
                return true;
            }
        }

        return false;
    }

    private static function add_heading_ids_and_toc($html)
    {
        if (!class_exists('DOMDocument')) {
            return $html;
        }

        if (false === stripos($html, '<h') && false === strpos($html, '[TOC]')) {
            return $html;
        }

        $document = new DOMDocument('1.0', 'UTF-8');
        $previous_errors = libxml_use_internal_errors(true);
        $loaded = $document->loadHTML(
            '<?xml encoding="UTF-8"><div id="easymde-render-root">' . $html . '</div>',
            LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
        );
        libxml_clear_errors();
        libxml_use_internal_errors($previous_errors);

        if (!$loaded) {
            return $html;
        }

        $root = $document->getElementById('easymde-render-root');
        if (!$root) {
            return $html;
        }

        $toc_items = array();
        $used_ids = array();
        $headings = $root->getElementsByTagName('*');

        foreach ($headings as $heading) {
            if (!in_array($heading->nodeName, array('h2', 'h3', 'h4'), true)) {
                continue;
            }

            $text = trim($heading->textContent);
            if ('' === $text || in_array(strtolower($text), array('toc', 'table of contents'), true) || '目录' === $text) {
                continue;
            }

            $id = $heading->getAttribute('id');
            if ('' === $id) {
                $id = self::unique_heading_id($text, $used_ids, count($toc_items) + 1);
                $heading->setAttribute('id', $id);
            } else {
                $used_ids[$id] = true;
            }

            $toc_items[] = array(
                'id' => $id,
                'text' => $text,
                'level' => (int) substr($heading->nodeName, 1),
            );
        }

        $xpath = new DOMXPath($document);
        $toc_nodes = $xpath->query('.//p[translate(normalize-space(.), "toc", "TOC")="[TOC]"]', $root);
        if ($toc_nodes && $toc_nodes->length) {
            foreach (iterator_to_array($toc_nodes) as $toc_node) {
                $toc_node->parentNode->replaceChild(self::create_toc_node($document, $toc_items), $toc_node);
            }
        }

        return self::inner_html($root, $document);
    }

    private static function unique_heading_id($text, array &$used_ids, $fallback_index)
    {
        $id = strtolower((string) preg_replace('/[^A-Za-z0-9]+/', '-', remove_accents($text)));
        $id = trim($id, '-');

        if ('' === $id) {
            $id = 'section-' . (int) $fallback_index;
        }

        $base = $id;
        $suffix = 2;

        while (isset($used_ids[$id])) {
            $id = $base . '-' . $suffix;
            ++$suffix;
        }

        $used_ids[$id] = true;

        return $id;
    }

    private static function create_toc_node(DOMDocument $document, array $items)
    {
        $toc = $document->createElement('div');
        $toc->setAttribute('class', 'easymde-toc');

        if (empty($items)) {
            return $toc;
        }

        $list = $document->createElement('ul');
        foreach ($items as $item) {
            $entry = $document->createElement('li');
            $entry->setAttribute('class', 'easymde-toc-level-' . (int) $item['level']);

            $link = $document->createElement('a');
            $link->setAttribute('href', '#' . $item['id']);
            $link->appendChild($document->createTextNode($item['text']));

            $entry->appendChild($link);
            $list->appendChild($entry);
        }

        $toc->appendChild($list);

        return $toc;
    }

    private static function inner_html(DOMElement $element, DOMDocument $document)
    {
        $html = '';
        foreach ($element->childNodes as $child) {
            $html .= $document->saveHTML($child);
        }

        return $html;
    }
}
