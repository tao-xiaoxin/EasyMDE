<?php
/**
 * Seed repeatable local Docker content for visual and interaction testing.
 *
 * @package EasyMDE
 */

if ( ! defined( 'WP_CLI' ) || ! WP_CLI ) {
	throw new RuntimeException( 'This fixture must be run through WP-CLI.' );
}

( static function () {
	$category_tree = array(
		array(
			'key'      => 'technical_writing',
			'name'     => '技术写作',
			'slug'     => 'easymde-demo-technical-writing',
			'children' => array(
				array(
					'key'  => 'wordpress',
					'name' => 'WordPress',
					'slug' => 'easymde-demo-wordpress',
				),
				array(
					'key'      => 'markdown_writing',
					'name'     => 'Markdown 写作',
					'slug'     => 'easymde-demo-markdown-writing',
					'children' => array(
						array(
							'key'      => 'editor_tools',
							'name'     => '编辑器与工具',
							'slug'     => 'easymde-demo-editor-tools',
							'children' => array(
								array(
									'key'  => 'easymde',
									'name' => 'EasyMDE',
									'slug' => 'easymde-demo-easymde',
								),
								array(
									'key'  => 'plugin_design',
									'name' => '插件设计',
									'slug' => 'easymde-demo-plugin-design',
								),
							),
						),
					),
				),
			),
		),
		array(
			'key'  => 'frontend_development',
			'name' => '前端开发',
			'slug' => 'easymde-demo-frontend-development',
		),
		array(
			'key'  => 'product_design',
			'name' => '产品设计',
			'slug' => 'easymde-demo-product-design',
		),
	);

	$term_ids  = array();
	$seed_term = null;
	$seed_term = static function ( array $node, $parent_id = 0 ) use ( &$seed_term, &$term_ids ) {
		$existing = get_term_by( 'slug', $node['slug'], 'category' );

		if ( $existing instanceof WP_Term ) {
			$term_id = (int) $existing->term_id;
			if ( $existing->name !== $node['name'] || (int) $existing->parent !== (int) $parent_id ) {
				$updated = wp_update_term(
					$term_id,
					'category',
					array(
						'name'   => $node['name'],
						'parent' => (int) $parent_id,
					)
				);
				if ( is_wp_error( $updated ) ) {
					WP_CLI::error( $updated->get_error_message() );
				}
			}
		} else {
			$inserted = wp_insert_term(
				$node['name'],
				'category',
				array(
					'slug'   => $node['slug'],
					'parent' => (int) $parent_id,
				)
			);
			if ( is_wp_error( $inserted ) ) {
				WP_CLI::error( $inserted->get_error_message() );
			}
			$term_id = (int) $inserted['term_id'];
		}

		$term_ids[ $node['key'] ] = $term_id;
		foreach ( $node['children'] ?? array() as $child ) {
			$seed_term( $child, $term_id );
		}
	};

	foreach ( $category_tree as $root_category ) {
		$seed_term( $root_category );
	}

	$showcase_title = 'Markdown 全量能力测试文档';
	$fixture_title  = 'EasyMDE 分类目录测试数据';
	$posts          = get_posts(
		array(
			'post_type'        => 'post',
			'post_status'      => 'any',
			'title'            => $showcase_title,
			'posts_per_page'   => 1,
			'orderby'          => 'ID',
			'order'            => 'DESC',
			'suppress_filters' => false,
		)
	);

	if ( $posts ) {
		$post_id = (int) $posts[0]->ID;
	} else {
		$fixture_posts = get_posts(
			array(
				'post_type'        => 'post',
				'post_status'      => 'any',
				'title'            => $fixture_title,
				'posts_per_page'   => 1,
				'orderby'          => 'ID',
				'order'            => 'DESC',
				'suppress_filters' => false,
			)
		);
		$post_id       = $fixture_posts ? (int) $fixture_posts[0]->ID : 0;
	}

	if ( ! $post_id ) {
		$post_id = wp_insert_post(
			array(
				'post_type'    => 'post',
				'post_status'  => 'draft',
				'post_title'   => $fixture_title,
				'post_content' => '<h1>EasyMDE 分类目录测试数据</h1><p>用于验证沉浸写作发布弹窗中的多级 WordPress 分类目录。</p>',
				'post_excerpt' => '用于验证多级分类目录与真实 WordPress 发布字段。',
			),
			true
		);
		if ( is_wp_error( $post_id ) ) {
			WP_CLI::error( $post_id->get_error_message() );
		}
	}

	$assigned = wp_set_post_terms(
		(int) $post_id,
		array( $term_ids['wordpress'], $term_ids['easymde'] ),
		'category',
		false
	);
	if ( is_wp_error( $assigned ) ) {
		WP_CLI::error( $assigned->get_error_message() );
	}

	WP_CLI::success(
		sprintf(
			'Seeded %d EasyMDE demo categories and assigned two selections to post %d.',
			count( $term_ids ),
			(int) $post_id
		)
	);
} )();
