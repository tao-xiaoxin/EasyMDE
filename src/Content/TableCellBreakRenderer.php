<?php

namespace EasyMDE\Content;

use League\CommonMark\Node\Node;
use League\CommonMark\Renderer\ChildNodeRendererInterface;
use League\CommonMark\Renderer\NodeRendererInterface;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Renders only the controlled table-cell break node as the canonical `<br>`.
 * It cannot render arbitrary HTML and does not alter the global raw-HTML
 * policy.
 */
final class TableCellBreakRenderer implements NodeRendererInterface {

	/**
	 * @param Node $node Node being rendered.
	 * @param ChildNodeRendererInterface $child_renderer Child renderer.
	 * @return string
	 */
	public function render( Node $node, ChildNodeRendererInterface $child_renderer ) {
		TableCellBreak::assertInstanceOf( $node );

		return '<br>';
	}
}
