<?php

namespace EasyMDE\Support;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class ToolbarShortcutCatalog {

	private const COMMAND_TO_SETTINGS = array(
		'savepost'      => 'save',
		'bold'          => 'bold',
		'italic'        => 'italic',
		'strike'        => 'strikethrough',
		'paragraph'     => 'paragraph',
		'link'          => 'link',
		'image'         => 'image',
		'heading1'      => 'heading-one',
		'heading2'      => 'heading-two',
		'heading3'      => 'heading-three',
		'heading4'      => 'heading-four',
		'heading5'      => 'heading-five',
		'heading6'      => 'heading-six',
		'quote'         => 'quote',
		'unorderedlist' => 'unordered-list',
		'orderedlist'   => 'ordered-list',
		'inlinecode'    => 'inline-code',
		'codefence'     => 'code-fence',
		'mathblock'     => 'math-block',
	);

	private function __construct() {}

	public static function settings_id_for_command( $command_id ) {
		return isset( self::COMMAND_TO_SETTINGS[ $command_id ] ) ? self::COMMAND_TO_SETTINGS[ $command_id ] : false;
	}

	public static function is_editable_command( $command_id ) {
		return false !== self::settings_id_for_command( $command_id );
	}
}
