<?php

namespace EasyMDE\Content;

use League\CommonMark\Node\Inline\AbstractInline;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * A controlled table-cell hard break parsed from the editor's exact `<br>`
 * token. It is never produced outside a table cell and carries no attributes.
 */
final class TableCellBreak extends AbstractInline {
}
