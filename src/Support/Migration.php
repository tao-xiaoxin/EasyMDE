<?php

namespace EasyMDE\Support;

use DOMDocument;
use DOMElement;
use DOMNode;
use DOMText;
use EasyMDE\Content\PostDocument;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class Migration {

	public function is_easymde_enabled( $post_id ) {
		$post_id = absint( $post_id );
		if ( ! $post_id ) {
			return false;
		}

		if ( metadata_exists( 'post', $post_id, PostDocument::META_ENABLED ) ) {
			return '1' === (string) get_post_meta( $post_id, PostDocument::META_ENABLED, true );
		}

		return $this->has_legacy_markdown( $post_id );
	}

	public function has_legacy_markdown( $post_id ) {
		$post_id = absint( $post_id );

		return $post_id > 0 && metadata_exists( 'post', $post_id, PostDocument::META_MARKDOWN );
	}

	public function mark_enabled( $post_id ) {
		update_post_meta( absint( $post_id ), PostDocument::META_ENABLED, '1' );
	}

	public function get_markdown( $post ) {
		if ( ! $post ) {
			return '';
		}

		$post_id = is_object( $post ) ? absint( $post->ID ) : absint( $post );
		if ( $this->has_legacy_markdown( $post_id ) ) {
			return (string) get_post_meta( $post_id, PostDocument::META_MARKDOWN, true );
		}

		$post_object = is_object( $post ) ? $post : get_post( $post_id );

		return $post_object ? $this->html_to_markdown( (string) $post_object->post_content ) : '';
	}

	public function revision_meta_keys() {
		return array(
			PostDocument::META_ENABLED,
			PostDocument::META_MARKDOWN,
			PostDocument::META_MARKDOWN_THEME,
			PostDocument::META_CODE_THEME,
			PostDocument::META_CODE_MAC_STYLE,
			PostDocument::META_CUSTOM_CSS_ID,
			PostDocument::META_CUSTOM_CSS_SNAPSHOT,
			PostDocument::META_CUSTOM_FONT,
			PostDocument::META_WINDOWS_FONT,
			PostDocument::META_APPLE_FONT,
			PostDocument::META_SERIF_FONT,
		);
	}

	private function html_to_markdown( $content ) {
		$content = (string) $content;
		if ( '' === trim( $content ) ) {
			return $content;
		}

		if ( ! preg_match( '/<\s*\/?[a-zA-Z][^>]*>/', $content ) ) {
			return html_entity_decode( $content, ENT_QUOTES | ENT_HTML5, 'UTF-8' );
		}

		if ( ! class_exists( 'DOMDocument' ) ) {
			return trim( wp_strip_all_tags( $content ) );
		}

		$document        = new DOMDocument( '1.0', 'UTF-8' );
		$previous_errors = libxml_use_internal_errors( true );
		$loaded          = $document->loadHTML(
			'<?xml encoding="UTF-8"><div id="easymde-html-import-root">' . $content . '</div>',
			LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
		);
		libxml_clear_errors();
		libxml_use_internal_errors( $previous_errors );

		if ( ! $loaded ) {
			return trim( wp_strip_all_tags( $content ) );
		}

		$root = $document->getElementById( 'easymde-html-import-root' );
		if ( ! $root ) {
			return trim( wp_strip_all_tags( $content ) );
		}

		return $this->normalize_markdown( $this->children_to_markdown( $root ) );
	}

	private function children_to_markdown( DOMNode $node ) {
		$markdown = '';

		foreach ( $node->childNodes as $child ) {
			$markdown .= $this->node_to_markdown( $child );
		}

		return $markdown;
	}

	private function node_to_markdown( DOMNode $node ) {
		if ( $node instanceof DOMText ) {
			return html_entity_decode( $node->wholeText, ENT_QUOTES | ENT_HTML5, 'UTF-8' );
		}

		if ( ! ( $node instanceof DOMElement ) ) {
			return '';
		}

		$tag      = strtolower( $node->tagName );
		$children = $this->children_to_markdown( $node );

		if ( preg_match( '/^h([1-6])$/', $tag, $matches ) ) {
			return "\n\n" . str_repeat( '#', (int) $matches[1] ) . ' ' . $this->inline_text( $children ) . "\n\n";
		}

		switch ( $tag ) {
			case 'p':
			case 'div':
			case 'section':
			case 'article':
				return "\n\n" . trim( $children ) . "\n\n";

			case 'strong':
			case 'b':
				return '**' . $this->inline_text( $children ) . '**';

			case 'em':
			case 'i':
				return '*' . $this->inline_text( $children ) . '*';

			case 'a':
				$href = trim( (string) $node->getAttribute( 'href' ) );

				return '' !== $href ? '[' . $this->inline_text( $children ) . '](' . $href . ')' : $children;

			case 'img':
				$src = trim( (string) $node->getAttribute( 'src' ) );
				$alt = $this->inline_text( (string) $node->getAttribute( 'alt' ) );

				return '' !== $src ? '![' . $alt . '](' . $src . ')' : '';

			case 'br':
				return "  \n";

			case 'hr':
				return "\n\n---\n\n";

			case 'blockquote':
				return "\n\n" . $this->prefix_lines( trim( $children ), '> ' ) . "\n\n";

			case 'pre':
				return "\n\n```\n" . rtrim( html_entity_decode( $node->textContent, ENT_QUOTES | ENT_HTML5, 'UTF-8' ) ) . "\n```\n\n";

			case 'code':
				return '`' . str_replace( '`', '\`', html_entity_decode( $node->textContent, ENT_QUOTES | ENT_HTML5, 'UTF-8' ) ) . '`';

			case 'ul':
				return "\n" . $this->list_items_to_markdown( $node, false ) . "\n";

			case 'ol':
				return "\n" . $this->list_items_to_markdown( $node, true ) . "\n";

			case 'table':
				return $this->table_to_markdown( $node );

			default:
				return $children;
		}
	}

	private function list_items_to_markdown( DOMElement $list_node, $ordered ) {
		$items = array();
		$index = 1;

		foreach ( $list_node->childNodes as $child ) {
			if ( ! ( $child instanceof DOMElement ) || 'li' !== strtolower( $child->tagName ) ) {
				continue;
			}

			$marker  = $ordered ? $index . '. ' : '- ';
			$items[] = $marker . $this->indent_continuation_lines( trim( $this->children_to_markdown( $child ) ) );
			++$index;
		}

		return implode( "\n", $items );
	}

	private function table_to_markdown( DOMElement $table ) {
		$rows = array();

		foreach ( $table->getElementsByTagName( 'tr' ) as $row ) {
			$cells = array();

			foreach ( $row->childNodes as $cell ) {
				if ( ! ( $cell instanceof DOMElement ) || ! in_array( strtolower( $cell->tagName ), array( 'th', 'td' ), true ) ) {
					continue;
				}

				$cells[] = str_replace( '|', '\|', $this->inline_text( $this->children_to_markdown( $cell ) ) );
			}

			if ( ! empty( $cells ) ) {
				$rows[] = $cells;
			}
		}

		if ( empty( $rows ) ) {
			return '';
		}

		$header    = array_shift( $rows );
		$markdown  = "\n\n| " . implode( ' | ', $header ) . " |\n";
		$markdown .= '| ' . implode( ' | ', array_fill( 0, count( $header ), '---' ) ) . " |\n";

		foreach ( $rows as $row ) {
			$row       = array_pad( $row, count( $header ), '' );
			$markdown .= '| ' . implode( ' | ', array_slice( $row, 0, count( $header ) ) ) . " |\n";
		}

		return $markdown . "\n";
	}

	private function inline_text( $text ) {
		$text = preg_replace( "/[ \t\r\n]+/", ' ', (string) $text );

		return trim( $text );
	}

	private function indent_continuation_lines( $text ) {
		return preg_replace( "/\n(?!$)/", "\n  ", (string) $text );
	}

	private function prefix_lines( $text, $prefix ) {
		return $prefix . str_replace( "\n", "\n" . $prefix, (string) $text );
	}

	private function normalize_markdown( $markdown ) {
		$markdown = str_replace( array( "\r\n", "\r" ), "\n", (string) $markdown );
		$markdown = preg_replace( "/[ \t]+\n/", "\n", $markdown );
		$markdown = preg_replace( "/\n{3,}/", "\n\n", $markdown );

		return trim( $markdown );
	}
}
