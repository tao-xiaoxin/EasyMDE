<?php

namespace EasyMDE\Content;

use League\CommonMark\Extension\Table\TableCell;
use League\CommonMark\Parser\Inline\InlineParserInterface;
use League\CommonMark\Parser\Inline\InlineParserMatch;
use League\CommonMark\Parser\InlineParserContext;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Parses the editor's exact lowercase attribute-free `<br>` token only when
 * the inline container belongs to a GFM table cell. Every other raw-HTML
 * occurrence remains governed by `html_input = strip`.
 */
final class TableCellBreakParser implements InlineParserInterface {

	/**
	 * @return InlineParserMatch
	 */
	public function getMatchDefinition(): InlineParserMatch {
		return InlineParserMatch::string( '<br>' )->caseSensitive();
	}

	/**
	 * @param InlineParserContext $inline_context Inline parser state.
	 * @return bool
	 */
	public function parse( InlineParserContext $inline_context ): bool {
		$node    = $inline_context->getContainer();
		$in_cell = false;
		while ( $node ) {
			if ( $node instanceof TableCell ) {
				$in_cell = true;
				break;
			}
			$node = $node->parent();
		}
		if ( ! $in_cell ) {
			return false;
		}

		$inline_context->getCursor()->advanceBy( $inline_context->getFullMatchLength() );
		$inline_context->getContainer()->appendChild( new TableCellBreak() );

		return true;
	}
}
