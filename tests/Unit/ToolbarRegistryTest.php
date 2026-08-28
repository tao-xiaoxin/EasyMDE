<?php

use EasyMDE\Support\ToolbarRegistry;

final class ToolbarRegistryTest extends WP_UnitTestCase
{
    public function test_default_shortcuts_match_the_official_typora_contract()
    {
        $commands = (new ToolbarRegistry())->get_command_registry();
        $expected = array(
            'savepost'      => array('Ctrl+S', 'Cmd+S'),
            'bold'          => array('Ctrl+B', 'Cmd+B'),
            'italic'        => array('Ctrl+I', 'Cmd+I'),
            'strike'        => array('Alt+Shift+5', 'Ctrl+Shift+Backquote'),
            'paragraph'     => array('Ctrl+0', 'Cmd+0'),
            'heading1'      => array('Ctrl+1', 'Cmd+1'),
            'heading2'      => array('Ctrl+2', 'Cmd+2'),
            'heading3'      => array('Ctrl+3', 'Cmd+3'),
            'heading4'      => array('Ctrl+4', 'Cmd+4'),
            'heading5'      => array('Ctrl+5', 'Cmd+5'),
            'heading6'      => array('Ctrl+6', 'Cmd+6'),
            'quote'         => array('Ctrl+Shift+Q', 'Cmd+Option+Q'),
            'unorderedlist' => array('Ctrl+Shift+BracketRight', 'Cmd+Option+U'),
            'orderedlist'   => array('Ctrl+Shift+BracketLeft', 'Cmd+Option+O'),
            'inlinecode'    => array('Ctrl+Shift+Backquote', 'Cmd+Shift+Backquote'),
            'codefence'     => array('Ctrl+Shift+K', 'Cmd+Option+C'),
            'mathblock'     => array('Ctrl+Shift+M', 'Cmd+Option+B'),
            'link'          => array('Ctrl+K', 'Cmd+K'),
            'image'         => array('Ctrl+Shift+I', 'Cmd+Ctrl+I'),
        );

        foreach ($expected as $command_id => $shortcuts) {
            $this->assertArrayHasKey($command_id, $commands);
            $this->assertSame($shortcuts[0], $commands[$command_id]['defaultShortcutWin'], $command_id . ' Windows shortcut');
            $this->assertSame($shortcuts[1], $commands[$command_id]['defaultShortcutMac'], $command_id . ' macOS shortcut');
        }
    }

    public function test_copy_wechat_keeps_its_reserved_default_shortcuts()
    {
        $command = (new ToolbarRegistry())->get_command_registry()['copywechat'];

        $this->assertSame('Ctrl+Shift+W', $command['defaultShortcutWin']);
        $this->assertSame('Cmd+Ctrl+W', $command['defaultShortcutMac']);
    }

    public function test_registration_rejects_an_id_that_sanitizes_to_empty()
    {
        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('easymde-toolbar-command-id-invalid');

        (new ToolbarRegistry())->register_toolbar_button('!!!', array('label' => 'Invalid identity'));
    }

    public function test_registration_rejects_an_empty_label()
    {
        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('easymde-toolbar-command-label-invalid');

        (new ToolbarRegistry())->register_toolbar_button('synthetic-command', array('label' => '   '));
    }
}
