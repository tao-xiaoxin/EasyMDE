<?php

namespace EasyMDE\Content;

use League\CommonMark\Extension\CommonMark\Node\Block\FencedCode;
use League\CommonMark\Extension\CommonMark\Node\Block\IndentedCode;
use League\CommonMark\Parser\Block\BlockStart;
use League\CommonMark\Parser\Block\BlockStartParserInterface;
use League\CommonMark\Parser\Cursor;
use League\CommonMark\Parser\MarkdownParserStateInterface;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Delegates code-block recognition to CommonMark while observing its cursor.
 */
final class CodeProjectionStartParser implements BlockStartParserInterface {

	private $delegate;

	private $kind;

	private $budget;

	public function __construct( BlockStartParserInterface $delegate, $kind, CodeProjectionBudget $budget ) {
		$this->delegate = $delegate;
		$this->kind     = (string) $kind;
		$this->budget   = $budget;
	}

	public function tryStart( Cursor $cursor, MarkdownParserStateInterface $parser_state ): ?BlockStart {
		$before = CodeProjectionParser::cursor_snapshot( $cursor );
		$result = $this->delegate->tryStart( $cursor, $parser_state );
		if ( null === $result ) {
			return null;
		}

		$parsers = iterator_to_array( $result->getBlockParsers() );
		if ( 1 !== count( $parsers ) ) {
			return $result;
		}

		$block_parser = $parsers[0];
		if ( ! $this->matches_kind( $block_parser->getBlock() ) ) {
			return $result;
		}
		if ( ! $this->budget->reserve_entry() ) {
			return $result;
		}

		$wrapped = new CodeProjectionParser(
			$block_parser,
			$this->kind,
			$this->budget,
			$before,
			CodeProjectionParser::cursor_snapshot( $cursor )
		);

		return BlockStart::of( $wrapped )->at( $cursor );
	}

	private function matches_kind( $block ) {
		return ( 'fenced' === $this->kind && $block instanceof FencedCode )
			|| ( 'indented' === $this->kind && $block instanceof IndentedCode );
	}
}
