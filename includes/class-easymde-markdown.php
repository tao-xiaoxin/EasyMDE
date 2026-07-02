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
        $markdown = self::normalize_mdnice_container_markers($markdown, $theme);

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

    private static function normalize_mdnice_container_markers($markdown, $theme)
    {
        if ('cupid-busy' !== sanitize_key((string) $theme)) {
            return $markdown;
        }

        $markdown = str_replace(array("\r\n", "\r"), "\n", (string) $markdown);
        $markdown = preg_replace_callback(
            '/!\[([^\]]*)\]\((\S+)\s+=([0-9]{1,3})%x\)/',
            function ($matches) {
                $width = max(1, min(100, (int) $matches[3]));

                return '![EASYMDE_MDNICE_WIDTH_' . $width . '](' . $matches[2] . ')';
            },
            $markdown
        );

        $lines = explode("\n", $markdown);
        $normalized = array();
        $in_fence = false;

        foreach ($lines as $line) {
            if (preg_match('/^\s*(```|~~~)/', $line)) {
                $in_fence = !$in_fence;
                $normalized[] = $line;
                continue;
            }

            if (
                !$in_fence
                && preg_match('/^\s*:{3,5}(?:\s+(?:block-[123]|column|column-left|column-right))?\s*$/', $line)
            ) {
                if (!empty($normalized) && '' !== end($normalized)) {
                    $normalized[] = '';
                }

                $normalized[] = trim($line);
                $normalized[] = '';
                continue;
            }

            $normalized[] = $line;
        }

        return implode("\n", $normalized);
    }

    private static function restore_math($html, array $math)
    {
        foreach ($math as $token => $item) {
            $tex = self::normalize_math_tex(trim((string) $item['tex']));
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

    private static function normalize_math_tex($tex)
    {
        $tex = (string) $tex;

        if ('' === $tex) {
            return $tex;
        }

        $command_patterns = array(
            '/(?<![A-Za-z\\\\])(begin|end)(?=\s*\{)/',
            '/(?<![A-Za-z\\\\])(frac|dfrac|tfrac|binom|sqrt)(?=\s*\{)/',
            '/(?<![A-Za-z\\\\])(left|right)(?=\s*(?:[()\[\]{}|.]|\\\\[{}]))/',
            '/(?<![A-Za-z\\\\])(log|ln|exp|lim|sin|cos|tan|cot|sec|csc|min|max|sup|inf)(?![A-Za-z])/',
            '/(?<![A-Za-z\\\\])(cdots|ldots|dots|vdots|ddots|cdot|times|div|pm|mp|leq|geq|neq|approx|infty)(?![A-Za-z])/',
        );

        foreach ($command_patterns as $pattern) {
            $tex = preg_replace($pattern, '\\\\$1', $tex);
        }

        return self::normalize_matrix_row_separators($tex);
    }

    private static function normalize_matrix_row_separators($tex)
    {
        return preg_replace_callback(
            '/\\\\begin\{([A-Za-z]*matrix|array)\}([\s\S]*?)\\\\end\{\1\}/',
            function ($matches) {
                $body = preg_replace('/(?<!\\\\)\\\\(?![\\\\A-Za-z{])/', '\\\\\\\\\\\\\\\\', $matches[2]);

                return '\\begin{' . $matches[1] . '}' . $body . '\\end{' . $matches[1] . '}';
            },
            $tex
        );
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

        $needs_markup = false !== stripos($html, '<h')
            || false !== stripos($html, '<a')
            || false !== stripos($html, '<li')
            || false !== stripos($html, '<img')
            || ('cupid-busy' === $theme && false !== strpos($html, ':::'))
            || ('ningye-purple' === $theme && false !== stripos($html, '<table'))
            || ('rose-purple' === $theme && false !== stripos($html, '<blockquote'));

        if (!$needs_markup) {
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

        $rose_purple_footnotes = '';

        if ('cupid-busy' === $theme) {
            self::wrap_cupid_busy_containers($document, $root);
            self::apply_mdnice_image_dimensions($root);
            self::restore_unparsed_strong_markers($document, $root);
        }

        self::wrap_theme_headings($document, $root, $theme);
        self::wrap_theme_list_items($document, $root);
        self::wrap_theme_images($document, $root);
        if ('rose-purple' === $theme) {
            self::add_rose_purple_blockquote_marks($document, $root);
            $rose_purple_footnotes = self::convert_theme_links_to_footnotes($document, $root, 'Reference', true, false);
        } elseif ('ningye-purple' === $theme) {
            self::wrap_theme_tables($document, $root);
            $rose_purple_footnotes = self::convert_theme_links_to_footnotes($document, $root, 'Reference', true, false, '参考资料');
        } elseif ('yamabuki' === $theme) {
            $rose_purple_footnotes = self::convert_theme_links_to_footnotes($document, $root, '参考资料', false, true);
            self::wrap_theme_links($document, $root);
        } else {
            self::wrap_theme_links($document, $root);
        }

        $html = self::inner_html($root, $document);
        if (in_array($theme, array('rose-purple', 'yamabuki', 'ningye-purple'), true)) {
            $html = self::normalize_rose_purple_blockquote_marks($html) . $rose_purple_footnotes;
        }

        return $html;
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
                'ningye-purple',
                'tech-blue',
                'cute-green',
                'fullstack-blue',
                'minimal-black',
                'orange-blue',
                'frontend-peak',
                'cupid-busy',
            ),
            true
        );
    }

    private static function wrap_cupid_busy_containers(DOMDocument $document, DOMElement $root)
    {
        $stack = array($root);
        $children = iterator_to_array($root->childNodes);

        foreach ($children as $child) {
            if (!($child instanceof DOMElement) || 'p' !== strtolower($child->nodeName)) {
                if (count($stack) > 1) {
                    end($stack)->appendChild($child);
                }
                continue;
            }

            $marker = trim((string) $child->textContent);
            if (!preg_match('/^:{3,5}(?:\s+(block-[123]|column|column-left|column-right))?\s*$/', $marker, $matches)) {
                if (count($stack) > 1) {
                    end($stack)->appendChild($child);
                }
                continue;
            }

            $class_name = isset($matches[1]) ? $matches[1] : '';
            if ('' === $class_name) {
                if ($child->parentNode) {
                    $child->parentNode->removeChild($child);
                }

                if (count($stack) > 1) {
                    array_pop($stack);
                }
                continue;
            }

            $section = $document->createElement('section');
            $section->setAttribute('class', $class_name);
            if (0 === strpos($class_name, 'block-') || 'column' === $class_name) {
                $section->setAttribute('data-tool', 'mdnice编辑器');
            }

            $target = end($stack);
            if ($target === $root && $child->parentNode === $root) {
                $root->insertBefore($section, $child);
            } else {
                $target->appendChild($section);
            }

            if ($child->parentNode) {
                $child->parentNode->removeChild($child);
            }

            if (0 === strpos($class_name, 'block-')) {
                $inner = $document->createElement('section');
                $inner->setAttribute('class', $class_name . '-inner');
                $section->appendChild($inner);
                $stack[] = $inner;
            } else {
                $stack[] = $section;
            }
        }
    }

    private static function apply_mdnice_image_dimensions(DOMElement $root)
    {
        $images = iterator_to_array($root->getElementsByTagName('img'));
        foreach ($images as $image) {
            if (!($image instanceof DOMElement)) {
                continue;
            }

            $alt = (string) $image->getAttribute('alt');
            if (!preg_match('/^EASYMDE_MDNICE_WIDTH_([0-9]{1,3})$/', $alt, $matches)) {
                continue;
            }

            $width = max(1, min(100, (int) $matches[1]));
            $image->setAttribute('width', $width . '%');
            $image->setAttribute('alt', '');
        }
    }

    private static function restore_unparsed_strong_markers(DOMDocument $document, DOMElement $root)
    {
        $xpath = new DOMXPath($document);
        $nodes = $xpath->query('.//text()[contains(., "**")]', $root);
        if (!$nodes) {
            return;
        }

        foreach (iterator_to_array($nodes) as $node) {
            if (!($node instanceof DOMText) || self::text_node_has_ancestor($node, array('code', 'pre'))) {
                continue;
            }

            $text = (string) $node->nodeValue;
            if (!preg_match('/\*\*([^*\n]+)\*\*/u', $text)) {
                continue;
            }

            $fragment = $document->createDocumentFragment();
            $parts = preg_split('/(\*\*[^*\n]+\*\*)/u', $text, -1, PREG_SPLIT_DELIM_CAPTURE);
            foreach ($parts as $part) {
                if ('' === $part) {
                    continue;
                }

                if (preg_match('/^\*\*([^*\n]+)\*\*$/u', $part, $matches)) {
                    $strong = $document->createElement('strong');
                    $strong->appendChild($document->createTextNode($matches[1]));
                    $fragment->appendChild($strong);
                } else {
                    $fragment->appendChild($document->createTextNode($part));
                }
            }

            if ($node->parentNode) {
                $node->parentNode->replaceChild($fragment, $node);
            }
        }
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

    private static function wrap_theme_list_items(DOMDocument $document, DOMElement $root)
    {
        $items = $root->getElementsByTagName('li');
        foreach (iterator_to_array($items) as $item) {
            if (self::direct_child_with_name($item, 'section')) {
                continue;
            }

            $section = $document->createElement('section');
            while ($item->firstChild) {
                $section->appendChild($item->firstChild);
            }
            $item->appendChild($section);
        }
    }

    private static function wrap_theme_images(DOMDocument $document, DOMElement $root)
    {
        $paragraphs = iterator_to_array($root->getElementsByTagName('p'));
        foreach ($paragraphs as $paragraph) {
            if (!($paragraph instanceof DOMElement) || self::element_has_ancestor_class($paragraph, 'footnotes')) {
                continue;
            }

            $media = self::single_media_child($paragraph);
            if (!$media) {
                continue;
            }

            $image = 'img' === strtolower($media->nodeName) ? $media : self::first_descendant_image($media);
            if (!$image) {
                continue;
            }

            $figure = $document->createElement('figure');
            $paragraph->parentNode->insertBefore($figure, $paragraph);
            $figure->appendChild($media);

            $alt = trim((string) $image->getAttribute('alt'));
            if ('' !== $alt) {
                $caption = $document->createElement('figcaption');
                $caption->appendChild($document->createTextNode($alt));
                $figure->appendChild($caption);
            }

            $paragraph->parentNode->removeChild($paragraph);
        }
    }

    private static function wrap_theme_tables(DOMDocument $document, DOMElement $root)
    {
        $tables = iterator_to_array($root->getElementsByTagName('table'));
        foreach ($tables as $table) {
            if (!($table instanceof DOMElement) || self::element_has_ancestor_class($table, 'table-container')) {
                continue;
            }

            $container = $document->createElement('section');
            $container->setAttribute('class', 'table-container');
            $table->parentNode->insertBefore($container, $table);
            $container->appendChild($table);
        }
    }

    private static function wrap_theme_links(DOMDocument $document, DOMElement $root)
    {
        $links = $root->getElementsByTagName('a');
        foreach (iterator_to_array($links) as $link) {
            if (self::direct_child_with_name($link, 'span') || self::first_descendant_image($link)) {
                continue;
            }

            $span = $document->createElement('span');
            while ($link->firstChild) {
                $span->appendChild($link->firstChild);
            }
            $link->appendChild($span);
        }
    }

    private static function add_rose_purple_blockquote_marks(DOMDocument $document, DOMElement $root)
    {
        $quote_mark = html_entity_decode('&#10077;', ENT_QUOTES, 'UTF-8');
        $blockquotes = $root->getElementsByTagName('blockquote');
        foreach (iterator_to_array($blockquotes) as $blockquote) {
            if (!($blockquote instanceof DOMElement)) {
                continue;
            }

            $first_element = null;
            foreach ($blockquote->childNodes as $child) {
                if ($child instanceof DOMElement) {
                    $first_element = $child;
                    break;
                }
            }

            if ($first_element && 'span' === $first_element->nodeName && $quote_mark === trim((string) $first_element->textContent)) {
                continue;
            }

            $mark = $document->createElement('span');
            $mark->appendChild($document->createTextNode($quote_mark));
            $blockquote->insertBefore($mark, $blockquote->firstChild);
        }
    }

    private static function convert_theme_links_to_footnotes(DOMDocument $document, DOMElement $root, $reference_label, $insert_heading, $require_title, $separator_label = null)
    {
        $reference_label = (string) $reference_label;
        $separator_text = null === $separator_label ? $reference_label : (string) $separator_label;
        $links = iterator_to_array($root->getElementsByTagName('a'));
        $footnotes = array();
        $reference_heading = self::find_reference_heading($root, $reference_label);

        foreach ($links as $link) {
            if (!($link instanceof DOMElement) || self::element_has_ancestor_class($link, 'footnotes')) {
                continue;
            }

            if ($reference_heading && self::element_is_after_root_child($link, $reference_heading, $root)) {
                continue;
            }

            $href = trim((string) $link->getAttribute('href'));
            if ('' === $href || 0 === strpos($href, '#')) {
                continue;
            }

            $index = count($footnotes) + 1;
            $label = trim((string) $link->textContent);
            if ('' === $label) {
                $label = $href;
            }

            $title = trim((string) $link->getAttribute('title'));
            if ((bool) $require_title && '' === $title) {
                continue;
            }

            if (0 === stripos($href, 'mailto:') || self::first_descendant_image($link) || ('' === $title && $label === $href)) {
                continue;
            }

            if ('' === $title) {
                $title = $label;
            }

            $word = $document->createElement('span');
            $word->setAttribute('class', 'footnote-word');
            $word->appendChild($document->createTextNode($label));

            $ref = $document->createElement('sup');
            $ref->setAttribute('class', 'footnote-ref');
            $ref->appendChild($document->createTextNode('[' . $index . ']'));

            $link->parentNode->insertBefore($word, $link);
            $link->parentNode->insertBefore($ref, $link);
            $link->parentNode->removeChild($link);

            $footnotes[] = array(
                'index' => $index,
                'title' => $title,
                'href' => $href,
            );
        }

        if (empty($footnotes)) {
            return '';
        }

        if ($insert_heading && !$reference_heading) {
            $heading = $document->createElement('h2');
            $prefix = $document->createElement('span');
            $prefix->setAttribute('class', 'prefix');
            $content = $document->createElement('span');
            $content->setAttribute('class', 'content');
            $content->appendChild($document->createTextNode($reference_label));
            $suffix = $document->createElement('span');
            $suffix->setAttribute('class', 'suffix');
            $heading->appendChild($prefix);
            $heading->appendChild($content);
            $heading->appendChild($suffix);
            $root->appendChild($heading);
        }

        $separator = $document->createElement('section');
        $separator->setAttribute('class', 'footnotes-sep');
        $separator_span = $document->createElement('span');
        $separator_span->appendChild($document->createTextNode($separator_text));
        $separator->appendChild($separator_span);
        $root->appendChild($separator);

        return self::build_theme_footnotes_html($footnotes);
    }

    private static function build_theme_footnotes_html(array $footnotes)
    {
        $html = '<section class="footnotes">';
        foreach ($footnotes as $footnote) {
            $index = absint($footnote['index']);
            $html .= '<span id="fn' . esc_attr((string) $index) . '" class="footnote-item">';
            $html .= '<span class="footnote-num">[' . esc_html((string) $index) . '] </span>';
            $html .= '<p>' . esc_html($footnote['title'] . ': ') . '<em>' . esc_html($footnote['href']) . '</em></p>';
            $html .= '</span>';
        }
        $html .= '</section>';

        return $html;
    }

    private static function normalize_rose_purple_blockquote_marks($html)
    {
        $quote_mark = html_entity_decode('&#10077;', ENT_QUOTES, 'UTF-8');

        return preg_replace(
            '/(<blockquote\b[^>]*>)\s*<p>\s*(<span\b[^>]*>\s*' . preg_quote($quote_mark, '/') . '\s*<\/span>)\s*<\/p>/u',
            '$1$2',
            $html
        );
    }

    private static function find_reference_heading(DOMElement $root, $reference_label)
    {
        foreach ($root->getElementsByTagName('h2') as $heading) {
            if ($heading instanceof DOMElement && $reference_label === trim((string) $heading->textContent)) {
                return $heading;
            }
        }

        return null;
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

    private static function single_media_child(DOMElement $element)
    {
        $media = null;
        foreach ($element->childNodes as $child) {
            if ($child instanceof DOMText && '' === trim($child->nodeValue)) {
                continue;
            }

            if (!($child instanceof DOMElement)) {
                return null;
            }

            $node_name = strtolower($child->nodeName);
            if (!in_array($node_name, array('img', 'a'), true)) {
                return null;
            }

            if ('a' === $node_name && !self::first_descendant_image($child)) {
                return null;
            }

            if ($media) {
                return null;
            }

            $media = $child;
        }

        return $media;
    }

    private static function first_descendant_image(DOMElement $element)
    {
        if ('img' === strtolower($element->nodeName)) {
            return $element;
        }

        foreach ($element->getElementsByTagName('img') as $image) {
            if ($image instanceof DOMElement) {
                return $image;
            }
        }

        return null;
    }

    private static function element_has_ancestor_class(DOMElement $element, $class_name)
    {
        $parent = $element->parentNode;
        while ($parent instanceof DOMElement) {
            $classes = preg_split('/\s+/', (string) $parent->getAttribute('class'));
            if (in_array($class_name, $classes, true)) {
                return true;
            }

            $parent = $parent->parentNode;
        }

        return false;
    }

    private static function element_is_after_root_child(DOMElement $element, DOMElement $anchor, DOMElement $root)
    {
        $seen_anchor = false;
        foreach ($root->childNodes as $child) {
            if ($child === $anchor) {
                $seen_anchor = true;
                continue;
            }

            if (!$seen_anchor) {
                continue;
            }

            if ($child === $element || self::node_contains($child, $element)) {
                return true;
            }
        }

        return false;
    }

    private static function node_contains(DOMNode $container, DOMNode $target)
    {
        $node = $target;
        while ($node instanceof DOMNode) {
            if ($node === $container) {
                return true;
            }

            $node = $node->parentNode;
        }

        return false;
    }

    private static function text_node_has_ancestor(DOMText $node, array $node_names)
    {
        $parent = $node->parentNode;
        $node_names = array_map('strtolower', $node_names);

        while ($parent instanceof DOMElement) {
            if (in_array(strtolower($parent->nodeName), $node_names, true)) {
                return true;
            }

            $parent = $parent->parentNode;
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
