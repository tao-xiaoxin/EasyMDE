<?php

namespace EasyMDE\Content;

use League\CommonMark\Environment\EnvironmentBuilderInterface;
use League\CommonMark\Extension\ExtensionInterface;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Registers the controlled table-cell break grammar. The parser runs before
 * the core raw-HTML inline parser, while code spans, escapes and entities keep
 * their higher priority and the global raw-HTML policy stays unchanged.
 */
final class TableCellBreakExtension implements ExtensionInterface {

	/**
	 * @param EnvironmentBuilderInterface $environment CommonMark environment.
	 * @return void
	 */
	public function register( EnvironmentBuilderInterface $environment ): void {
		$environment
			->addInlineParser( new TableCellBreakParser(), 45 )
			->addRenderer( TableCellBreak::class, new TableCellBreakRenderer() );
	}
}
