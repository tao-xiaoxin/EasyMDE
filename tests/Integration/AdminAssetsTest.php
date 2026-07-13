<?php

use EasyMDE\Admin\AdminAssets;

final class AdminAssetsTest extends WP_UnitTestCase {

	private $admin_assets;
	private $get_category_options;
	private $get_category_options_cache_key;
	private $category_load_error;

	public function set_up() {
		parent::set_up();

		$reflection                = new ReflectionClass( AdminAssets::class );
		$this->admin_assets        = $reflection->newInstanceWithoutConstructor();
		$this->get_category_options = $reflection->getMethod( 'get_category_options' );
		$this->get_category_options_cache_key = $reflection->getMethod( 'get_category_options_cache_key' );
		$this->category_load_error = $reflection->getProperty( 'category_load_error' );
		$this->get_category_options->setAccessible( true );
		$this->get_category_options_cache_key->setAccessible( true );
		$this->category_load_error->setAccessible( true );
		wp_cache_flush();
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
