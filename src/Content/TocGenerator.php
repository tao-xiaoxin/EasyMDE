<?php

namespace EasyMDE\Content;

use DOMDocument;
use DOMElement;
use DOMXPath;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class TocGenerator {

	public static function add_heading_ids_and_toc( $html ) {
		if ( ! class_exists( 'DOMDocument' ) ) {
			return $html;
		}

		if ( false === stripos( $html, '<h' ) && false === strpos( $html, '[TOC]' ) ) {
			return $html;
		}

		$document        = new DOMDocument( '1.0', 'UTF-8' );
		$previous_errors = libxml_use_internal_errors( true );
		$loaded          = $document->loadHTML(
			'<?xml encoding="UTF-8"><div id="easymde-render-root">' . $html . '</div>',
			LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD
		);
		libxml_clear_errors();
		libxml_use_internal_errors( $previous_errors );

		if ( ! $loaded ) {
			return $html;
		}

		$root = $document->getElementById( 'easymde-render-root' );
		if ( ! $root ) {
			return $html;
		}

		$toc_items = array();
		$used_ids  = array();
		$headings  = $root->getElementsByTagName( '*' );

		foreach ( $headings as $heading ) {
			if ( ! in_array( $heading->nodeName, array( 'h2', 'h3', 'h4' ), true ) ) {
				continue;
			}

			$text = trim( $heading->textContent );
			if ( '' === $text || in_array( strtolower( $text ), array( 'toc', 'table of contents' ), true ) || '目录' === $text ) {
				continue;
			}

			$id = $heading->getAttribute( 'id' );
			if ( '' === $id ) {
				$id = self::unique_heading_id( $text, $used_ids, count( $toc_items ) + 1 );
				$heading->setAttribute( 'id', $id );
			} else {
				$used_ids[ $id ] = true;
			}

			$toc_items[] = array(
				'id'    => $id,
				'text'  => $text,
				'level' => (int) substr( $heading->nodeName, 1 ),
			);
		}

		$xpath     = new DOMXPath( $document );
		$toc_nodes = $xpath->query( './/p[translate(normalize-space(.), "toc", "TOC")="[TOC]"]', $root );
		if ( $toc_nodes && $toc_nodes->length ) {
			foreach ( iterator_to_array( $toc_nodes ) as $toc_node ) {
				$toc_node->parentNode->replaceChild( self::create_toc_node( $document, $toc_items ), $toc_node );
			}
		}

		return self::inner_html( $root, $document );
	}

	private static function unique_heading_id( $text, array &$used_ids, $fallback_index ) {
		$id = strtolower( (string) preg_replace( '/[^A-Za-z0-9]+/', '-', remove_accents( $text ) ) );
		$id = trim( $id, '-' );

		if ( '' === $id ) {
			$id = 'section-' . (int) $fallback_index;
		}

		$base   = $id;
		$suffix = 2;

		while ( isset( $used_ids[ $id ] ) ) {
			$id = $base . '-' . $suffix;
			++$suffix;
		}

		$used_ids[ $id ] = true;

		return $id;
	}

	private static function create_toc_node( DOMDocument $document, array $items ) {
		$toc = $document->createElement( 'div' );
		$toc->setAttribute( 'class', 'easymde-toc' );

		if ( empty( $items ) ) {
			return $toc;
		}

		$list = $document->createElement( 'ul' );
		foreach ( $items as $item ) {
			$entry = $document->createElement( 'li' );
			$entry->setAttribute( 'class', 'easymde-toc-level-' . (int) $item['level'] );

			$link = $document->createElement( 'a' );
			$link->setAttribute( 'href', '#' . $item['id'] );
			$link->appendChild( $document->createTextNode( $item['text'] ) );

			$entry->appendChild( $link );
			$list->appendChild( $entry );
		}

		$toc->appendChild( $list );

		return $toc;
	}

	private static function inner_html( DOMElement $element, DOMDocument $document ) {
		$html = '';
		foreach ( $element->childNodes as $child ) {
			$html .= $document->saveHTML( $child );
		}

		return $html;
	}
}
