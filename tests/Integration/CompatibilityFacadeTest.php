<?php

use EasyMDE\Content\PostDocument;

final class CompatibilityFacadeTest extends WP_UnitTestCase
{
    public function test_toolbar_button_and_shortcode_helper_reach_editor_script_config()
    {
        $user_id = self::factory()->user->create(array('role' => 'editor'));
        $post_id = self::factory()->post->create(
            array(
                'post_type' => 'post',
                'post_author' => $user_id,
            )
        );

        update_post_meta($post_id, PostDocument::META_ENABLED, '1');
        update_post_meta($post_id, PostDocument::META_MARKDOWN, '# Facade');

        wp_set_current_user($user_id);
        $registry_snapshot = $this->snapshot_toolbar_registry();

        EasyMDE_Plugin::register_toolbar_button(
            'fixture_button',
            array(
                'label' => 'Fixture toolbar button',
                'description' => 'Fixture toolbar description',
                'icon' => 'editor-code',
                'surface' => 'main',
                'action' => 'wrap',
                'prefix' => '<fixture>',
                'suffix' => '</fixture>',
            )
        );

        EasyMDE_Plugin::register_shortcode_helper(
            'fixture_shortcode',
            array(
                'id' => 'fixture_shortcode',
                'label' => 'Fixture shortcode helper',
                'shortcode' => '[fixture]',
            )
        );

        $previous_get = $_GET;
        $_GET = array('post' => (string) $post_id);

        try {
            set_current_screen('post');
            do_action('admin_enqueue_scripts', 'post.php');

            $data = wp_scripts()->get_data('easymde-admin', 'data');

            $this->assertIsString($data);
            $this->assertStringContainsString('fixture_button', $data);
            $this->assertStringContainsString('Fixture toolbar button', $data);
            $this->assertStringContainsString('fixture_shortcode', $data);
            $this->assertStringContainsString('[fixture]', $data);
        } finally {
            $_GET = $previous_get;
            $this->restore_toolbar_registry($registry_snapshot);
            set_current_screen('front');
        }
    }

    private function snapshot_toolbar_registry()
    {
        $registry = $this->toolbar_registry();

        return array(
            'toolbar_buttons' => $this->registry_property($registry, 'toolbar_buttons')->getValue($registry),
            'shortcode_helpers' => $this->registry_property($registry, 'shortcode_helpers')->getValue($registry),
        );
    }

    private function restore_toolbar_registry(array $snapshot)
    {
        $registry = $this->toolbar_registry();

        $this->registry_property($registry, 'toolbar_buttons')->setValue($registry, $snapshot['toolbar_buttons']);
        $this->registry_property($registry, 'shortcode_helpers')->setValue($registry, $snapshot['shortcode_helpers']);
    }

    private function toolbar_registry()
    {
        $plugin = \EasyMDE\Plugin::instance();
        $property = new \ReflectionProperty($plugin, 'toolbar_registry');
        $property->setAccessible(true);

        return $property->getValue($plugin);
    }

    private function registry_property($registry, $name)
    {
        $property = new \ReflectionProperty($registry, $name);
        $property->setAccessible(true);

        return $property;
    }
}
