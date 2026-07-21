<?php

use EasyMDE\Admin\AdminAssets;
use EasyMDE\Support\Asset;

final class AdminAssetsTest extends WP_UnitTestCase {

	private $admin_assets;
	private $get_category_options;
	private $get_category_options_cache_key;
	private $category_load_error;
	private $get_react_editor_asset;
	private $get_static_asset_version;
	private $get_storage_config;
	private $get_strings;

	public function set_up() {
		parent::set_up();

		$reflection                = new ReflectionClass( AdminAssets::class );
		$this->admin_assets        = $reflection->newInstanceWithoutConstructor();
		$this->get_category_options = $reflection->getMethod( 'get_category_options' );
		$this->get_category_options_cache_key = $reflection->getMethod( 'get_category_options_cache_key' );
		$this->category_load_error = $reflection->getProperty( 'category_load_error' );
		$this->get_react_editor_asset = $reflection->getMethod( 'get_react_editor_asset' );
		$this->get_static_asset_version = $reflection->getMethod( 'get_static_asset_version' );
		$this->get_storage_config = $reflection->getMethod( 'get_storage_config' );
		$this->get_strings = $reflection->getMethod( 'get_strings' );
		$this->get_category_options->setAccessible( true );
		$this->get_category_options_cache_key->setAccessible( true );
		$this->category_load_error->setAccessible( true );
		$this->get_react_editor_asset->setAccessible( true );
		$this->get_static_asset_version->setAccessible( true );
		$this->get_storage_config->setAccessible( true );
		$this->get_strings->setAccessible( true );
		wp_cache_flush();
	}

	public function test_local_draft_bootstrap_exposes_a_versioned_bounded_locale_contract() {
		$user_id = self::factory()->user->create( array( 'role' => 'author' ) );
		wp_set_current_user( $user_id );
		update_option( 'timezone_string', 'Asia/Shanghai' );

		$storage = $this->get_storage_config->invoke( $this->admin_assets, 41 );

		$this->assertSame( 1, $storage['draftSchemaVersion'] );
		$this->assertSame( 1048576, $storage['draftMaxBytes'] );
		$this->assertSame( get_user_locale( $user_id ), $storage['locale'] );
		$this->assertSame( 'Asia/Shanghai', $storage['timeZone'] );
		$this->assertSame( 41, $storage['postId'] );
		$this->assertSame( $user_id, $storage['userId'] );
	}

	public function test_local_draft_failures_and_conflicts_have_php_gettext_messages() {
		$strings = $this->get_strings->invoke( $this->admin_assets );

		$this->assertSame( 'Local draft could not be read.', $strings['draftReadFailed'] );
		$this->assertSame( 'Local draft could not be saved.', $strings['draftSaveFailed'] );
		$this->assertSame( 'Local draft could not be discarded.', $strings['draftDiscardFailed'] );
		$this->assertSame( 'A different local draft was saved in another tab.', $strings['draftConflict'] );
	}

	public function test_toolbar_stylesheet_uses_a_content_version_for_atomic_owner_handoff() {
		$asset_path = 'assets/css/admin/toolbar.css';
		$version    = $this->get_static_asset_version->invoke( $this->admin_assets, $asset_path );

		$this->assertMatchesRegularExpression( '/^[a-f0-9]{16}$/', $version );
		$this->assertSame( substr( hash_file( 'sha256', Asset::path( $asset_path ) ), 0, 16 ), $version );
		$this->assertNotSame( EASYMDE_VERSION, $version );
	}

	public function test_editor_stylesheet_uses_a_content_version_for_document_owner_handoff() {
		$asset_path = 'assets/css/admin/editor.css';
		$version    = $this->get_static_asset_version->invoke( $this->admin_assets, $asset_path );

		$this->assertMatchesRegularExpression( '/^[a-f0-9]{16}$/', $version );
		$this->assertSame( substr( hash_file( 'sha256', Asset::path( $asset_path ) ), 0, 16 ), $version );
		$this->assertNotSame( EASYMDE_VERSION, $version );
	}

	public function test_editor_bootstrap_uses_a_content_version_for_runtime_owner_handoffs() {
		$asset_path = 'assets/js/admin/bootstrap.js';
		$version    = $this->get_static_asset_version->invoke( $this->admin_assets, $asset_path );

		$this->assertMatchesRegularExpression( '/^[a-f0-9]{16}$/', $version );
		$this->assertSame( substr( hash_file( 'sha256', Asset::path( $asset_path ) ), 0, 16 ), $version );
		$this->assertNotSame( EASYMDE_VERSION, $version );
	}

	public function test_resolves_the_committed_react_editor_manifest_and_dependency_metadata() {
		$asset = $this->get_react_editor_asset->invoke( $this->admin_assets );

		$this->assertSame( 'easymde-admin-editor-toolbar', $asset['handle'] );
		$this->assertMatchesRegularExpression( '#^assets/build/assets/admin-editor-[A-Za-z0-9_-]+\.js$#', $asset['path'] );
		$this->assertSame( array( 'wp-element' ), $asset['dependencies'] );
		$this->assertMatchesRegularExpression( '/^[a-f0-9]{16}$/', $asset['version'] );
		$this->assertFileExists( Asset::path( $asset['path'] ) );
	}

	public function test_rejects_an_incompatible_react_editor_manifest_contract() {
		$build_dir = trailingslashit( get_temp_dir() ) . 'easymde-react-editor-invalid-' . wp_generate_uuid4();
		wp_mkdir_p( $build_dir );
		file_put_contents(
			$build_dir . '/wordpress-manifest.json',
			wp_json_encode(
				array(
					'schemaVersion' => 2,
					'entries'       => array(),
				)
			)
		);

		try {
			$this->expectException( RuntimeException::class );
			$this->expectExceptionMessage( 'react-editor-manifest-invalid' );
			$this->get_react_editor_asset->invoke( $this->admin_assets, $build_dir );
		} finally {
			wp_delete_file( $build_dir . '/wordpress-manifest.json' );
			rmdir( $build_dir );
		}
	}

	public function tear_down() {
		remove_all_filters( 'get_terms_args' );
		remove_all_filters( 'get_terms' );
		remove_all_filters( 'terms_pre_query' );
		remove_all_filters( 'easymde_category_options_cache_context' );
		remove_all_actions( 'easymde_category_options_load_failed' );
		wp_cache_flush();

		parent::tear_down();
	}

	public function test_reuses_normalized_options_until_term_state_changes() {
		$parent = self::factory()->term->create_and_get(
			array(
				'taxonomy' => 'category',
				'name'     => 'Parent category',
			)
		);
		$child  = self::factory()->term->create_and_get(
			array(
				'taxonomy' => 'category',
				'name'     => 'Child category',
				'parent'   => $parent->term_id,
			)
		);
		$first     = $this->invoke_get_category_options( 'post', 41 );
		$cache_key = $this->invoke_get_category_options_cache_key( 'post', 41 );
		$sentinel  = array(
			array(
				'id'          => '999',
				'label'       => 'Cached sentinel',
				'parentId'    => '',
				'hasChildren' => false,
			),
		);

		wp_cache_set( $cache_key, $sentinel, 'easymde' );
		$this->assertSame( $sentinel, $this->invoke_get_category_options( 'post', 41 ) );
		$this->assertContains(
			array(
				'id'          => (string) $parent->term_id,
				'label'       => 'Parent category',
				'parentId'    => '',
				'hasChildren' => true,
			),
			$first
		);
		$this->assertContains(
			array(
				'id'          => (string) $child->term_id,
				'label'       => 'Child category',
				'parentId'    => (string) $parent->term_id,
				'hasChildren' => false,
			),
			$first
		);

		$new_term = self::factory()->term->create_and_get(
			array(
				'taxonomy' => 'category',
				'name'     => 'New category',
			)
		);
		$updated = $this->invoke_get_category_options( 'post', 41 );

		$this->assertNotSame( $cache_key, $this->invoke_get_category_options_cache_key( 'post', 41 ) );
		$this->assertContains(
			array(
				'id'          => (string) $new_term->term_id,
				'label'       => 'New category',
				'parentId'    => '',
				'hasChildren' => false,
			),
			$updated
		);
	}

	public function test_cache_context_separates_users_posts_and_capabilities() {
		$first_user_id  = self::factory()->user->create( array( 'role' => 'author' ) );
		$second_user_id = self::factory()->user->create( array( 'role' => 'editor' ) );

		wp_set_current_user( $first_user_id );
		$first_post_key  = $this->invoke_get_category_options_cache_key( 'post', 101 );
		$second_post_key = $this->invoke_get_category_options_cache_key( 'post', 102 );

		wp_set_current_user( $second_user_id );
		$second_user_key = $this->invoke_get_category_options_cache_key( 'post', 101 );

		$this->assertNotSame( $first_post_key, $second_post_key );
		$this->assertNotSame( $first_post_key, $second_user_key );
	}

	public function test_dynamic_term_filters_can_disable_category_option_caching() {
		self::factory()->term->create(
			array(
				'taxonomy' => 'category',
				'name'     => 'Filtered category',
			)
		);
		$filter_calls = 0;

		add_filter( 'easymde_category_options_cache_context', '__return_false' );
		add_filter(
			'get_terms',
			static function ( $terms, $taxonomies ) use ( &$filter_calls ) {
				if ( in_array( 'category', $taxonomies, true ) ) {
					++$filter_calls;
				}

				return $terms;
			},
			10,
			2
		);

		$this->assertSame( '', $this->invoke_get_category_options_cache_key( 'post', 41 ) );
		$this->invoke_get_category_options( 'post', 41 );
		$this->invoke_get_category_options( 'post', 41 );
		$this->assertSame( 2, $filter_calls );
	}

	public function test_term_query_errors_remain_observable_and_are_not_cached() {
		$error         = new WP_Error( 'category_query_failed', 'Synthetic category failure.' );
		$action_calls  = 0;
		$query_attempts = 0;

		add_filter(
			'terms_pre_query',
			static function ( $terms, $query ) use ( $error, &$query_attempts ) {
				if ( in_array( 'category', $query->query_vars['taxonomy'], true ) ) {
					++$query_attempts;

					return $error;
				}

				return $terms;
			},
			10,
			2
		);
		add_action(
			'easymde_category_options_load_failed',
			function ( $post_type, $received_error ) use ( $error, &$action_calls ) {
				++$action_calls;
				$this->assertSame( 'post', $post_type );
				$this->assertSame( $error, $received_error );
			},
			10,
			2
		);

		$this->assertSame( array(), $this->invoke_get_category_options( 'post', 41 ) );
		$this->assertSame( array(), $this->invoke_get_category_options( 'post', 41 ) );
		$this->assertSame( 2, $query_attempts );
		$this->assertSame( 2, $action_calls );
		$this->assertStringContainsString(
			'Synthetic category failure.',
			$this->category_load_error->getValue( $this->admin_assets )
		);
	}

	public function test_post_types_without_categories_return_empty_without_querying_terms() {
		$queries = 0;

		add_filter(
			'get_terms_args',
			static function ( $args ) use ( &$queries ) {
				++$queries;

				return $args;
			}
		);

		$this->assertSame( array(), $this->invoke_get_category_options( 'page', 41 ) );
		$this->assertSame( 0, $queries );
	}

	private function invoke_get_category_options( $post_type, $post_id ) {
		return $this->get_category_options->invoke( $this->admin_assets, $post_type, $post_id );
	}

	private function invoke_get_category_options_cache_key( $post_type, $post_id ) {
		return $this->get_category_options_cache_key->invoke( $this->admin_assets, $post_type, $post_id );
	}
}
