<?php

namespace EasyMDE\Content;

use League\CommonMark\Node\Block\AbstractBlock;
use League\CommonMark\Parser\Block\BlockContinue;
use League\CommonMark\Parser\Block\BlockContinueParserInterface;
use League\CommonMark\Parser\Cursor;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Observes CommonMark code-block parsing without replacing its parser or node.
 */
final class CodeProjectionParser implements BlockContinueParserInterface {
	const DATA_KEY = 'easymde_code_projection';

	private $delegate;

	private $kind;

	private $budget;

	private $initial_before;

	private $initial_after;

	private $pending;

	private $content_line = 0;

	private $next_line;

	private $fence_info_seen = false;

	private $rows = array();

	/**
	 * @param array{position:int,column:int,remainderLength:int,remainderLeadingSpaces:int} $initial_before
	 * @param array{position:int,column:int,remainderLength:int,remainderLeadingSpaces:int} $initial_after
	 */
	public function __construct( BlockContinueParserInterface $delegate, $kind, CodeProjectionBudget $budget, array $initial_before, array $initial_after ) {
		$this->delegate       = $delegate;
		$this->kind           = (string) $kind;
		$this->budget         = $budget;
		$this->initial_before = $initial_before;
		$this->initial_after  = $initial_after;
		$this->pending        = 'indented' === $this->kind
			? array(
				'line'   => null,
				'before' => $initial_before,
				'after'  => $initial_after,
			)
			: null;
	}

	/**
	 * @return array{position:int,column:int,remainderLength:int,remainderLeadingSpaces:int}
	 */
	public static function cursor_snapshot( Cursor $cursor ) {
		$remainder = $cursor->getRemainder();

		return array(
			'position'               => $cursor->getPosition(),
			'column'                 => $cursor->getColumn(),
			'remainderLength'        => function_exists( 'mb_strlen' ) ? mb_strlen( $remainder, 'UTF-8' ) : strlen( $remainder ),
			'remainderLeadingSpaces' => strspn( $remainder, ' ' ),
		);
	}

	public function getBlock(): AbstractBlock {
		return $this->delegate->getBlock();
	}

	public function isContainer(): bool {
		return $this->delegate->isContainer();
	}

	public function canHaveLazyContinuationLines(): bool {
		return $this->delegate->canHaveLazyContinuationLines();
	}

	public function canContain( AbstractBlock $child_block ): bool {
		return $this->delegate->canContain( $child_block );
	}

	public function tryContinue( Cursor $cursor, BlockContinueParserInterface $active_block_parser ): ?BlockContinue {
		$before = self::cursor_snapshot( $cursor );
		$result = $this->delegate->tryContinue( $cursor, $active_block_parser );

		$this->pending = null;
		if ( null !== $result && ! $result->isFinalize() ) {
			$this->pending = array(
				'line'   => $this->next_line_number(),
				'before' => $before,
				'after'  => self::cursor_snapshot( $cursor ),
			);
		}

		return $result;
	}

	public function addLine( string $line ): void {
		if ( 'fenced' === $this->kind && ! $this->fence_info_seen ) {
			$this->fence_info_seen = true;
			$this->delegate->addLine( $line );
			$this->next_line = $this->start_line() + 1;
			return;
		}

		$line_number = $this->next_line_number();
		$pending     = $this->pending;
		if ( null !== $line_number && null !== $pending && null === $pending['line'] ) {
			$pending['line'] = $line_number;
		}

		if ( ! preg_match( '/^[ \t]*$/D', $line ) ) {
			if ( ! $this->budget->reserve_row() ) {
				$this->rows = array();
			} elseif ( null === $pending || null === $pending['line'] ) {
				$this->rows[] = array(
					'line'        => $line_number,
					'contentLine' => $this->content_line,
					'unavailable' => true,
				);
			} else {
				$this->rows[] = array(
					'line'        => $pending['line'],
					'contentLine' => $this->content_line,
					'before'      => $pending['before'],
					'after'       => $pending['after'],
				);
			}
		}

		++$this->content_line;
		$this->pending   = null;
		$this->next_line = null === $line_number ? null : $line_number + 1;
		$this->delegate->addLine( $line );
	}

	public function closeBlock(): void {
		$this->delegate->closeBlock();
		$this->getBlock()->data->set(
			self::DATA_KEY,
			array(
				'kind' => $this->kind,
				'rows' => $this->rows,
			)
		);
	}

	private function start_line() {
		$start_line = $this->getBlock()->getStartLine();

		return null === $start_line ? 0 : (int) $start_line;
	}

	private function next_line_number() {
		if ( null !== $this->next_line ) {
			return $this->next_line;
		}

		return $this->start_line() + ( 'fenced' === $this->kind ? 1 : 0 );
	}
}
