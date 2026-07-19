<?php
/**
 * Seed the deterministic Phase 0 editor visual fixture.
 *
 * Run only inside one of the isolated editor visual WordPress environments:
 *
 * wp eval-file /workspace/tests/e2e/fixtures/editor-phase-0-seed.php
 */

if ( ! defined( 'ABSPATH' ) ) {
	throw new RuntimeException( 'phase_zero_wordpress_not_loaded' );
}

function easymde_phase_zero_fail( $code ) {
	throw new RuntimeException( sanitize_key( (string) $code ) );
}

function easymde_phase_zero_require_array( $value, $code ) {
	if ( ! is_array( $value ) ) {
		easymde_phase_zero_fail( $code );
	}

	return $value;
}

function easymde_phase_zero_require_string( $value, $code ) {
	if ( ! is_string( $value ) || '' === $value ) {
		easymde_phase_zero_fail( $code );
	}

	return $value;
}

function easymde_phase_zero_require_wp_result( $value, $code ) {
	if ( is_wp_error( $value ) ) {
		easymde_phase_zero_fail( $code . '_' . $value->get_error_code() );
	}

	return $value;
}

function easymde_phase_zero_upsert_user( array $definition ) {
	$login = easymde_phase_zero_require_string(
		isset( $definition['login'] ) ? $definition['login'] : null,
		'fixture_user_login_missing'
	);
	$role  = easymde_phase_zero_require_string(
		isset( $definition['role'] ) ? $definition['role'] : null,
		'fixture_user_role_missing'
	);
	$user  = get_user_by( 'login', $login );
	$data  = array(
		'user_login'   => $login,
		'user_pass'    => 'easymde-visual-fixture',
		'user_email'   => $login . '@example.invalid',
		'display_name' => ucwords( str_replace( '-', ' ', $login ) ),
		'role'         => $role,
	);

	if ( $user ) {
		$data['ID'] = $user->ID;
		$user_id    = wp_update_user( $data );
	} else {
		$user_id = wp_insert_user( $data );
	}

	$user_id = easymde_phase_zero_require_wp_result( $user_id, 'fixture_user_upsert_failed' );
	if ( ! $user_id ) {
		easymde_phase_zero_fail( 'fixture_user_id_missing' );
	}

	return (int) $user_id;
}

function easymde_phase_zero_upsert_term( array $definition, $taxonomy, $parent_id = 0 ) {
	$name = easymde_phase_zero_require_string(
		isset( $definition['name'] ) ? $definition['name'] : null,
		'fixture_term_name_missing'
	);
	$slug = easymde_phase_zero_require_string(
		isset( $definition['slug'] ) ? $definition['slug'] : null,
		'fixture_term_slug_missing'
	);
	$term = term_exists( $slug, $taxonomy );
	$args = array(
		'slug' => $slug,
	);

	if ( 'category' === $taxonomy ) {
		$args['parent'] = (int) $parent_id;
	}

	if ( $term ) {
		$term_id = is_array( $term ) ? (int) $term['term_id'] : (int) $term;
		$result  = wp_update_term( $term_id, $taxonomy, array_merge( $args, array( 'name' => $name ) ) );
	} else {
		$result = wp_insert_term( $name, $taxonomy, $args );
	}

	$result = easymde_phase_zero_require_wp_result( $result, 'fixture_term_upsert_failed' );
	if ( ! is_array( $result ) || empty( $result['term_id'] ) ) {
		easymde_phase_zero_fail( 'fixture_term_id_missing' );
	}

	return (int) $result['term_id'];
}

function easymde_phase_zero_upsert_image( $author_id ) {
	$uploads = wp_upload_dir();
	if ( ! empty( $uploads['error'] ) || ! wp_mkdir_p( $uploads['basedir'] ) ) {
		easymde_phase_zero_fail( 'fixture_upload_directory_unavailable' );
	}

	$filename = 'easymde-visual-featured.png';
	$path     = trailingslashit( $uploads['basedir'] ) . $filename;
	$url      = trailingslashit( $uploads['baseurl'] ) . $filename;
	// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode -- Fixed transparent synthetic PNG fixture.
	$image = base64_decode(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl5ZfoAAAAASUVORK5CYII=',
		true
	);

	// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- WP-CLI writes the synthetic image into its isolated uploads volume.
	if ( false === $image || strlen( $image ) !== file_put_contents( $path, $image ) ) {
		easymde_phase_zero_fail( 'fixture_image_write_failed' );
	}

	$attachment = get_page_by_path( 'easymde-visual-featured-image', OBJECT, 'attachment' );
	$data       = array(
		'ID'             => $attachment ? $attachment->ID : 0,
		'guid'           => $url,
		'post_author'    => (int) $author_id,
		'post_mime_type' => 'image/png',
		'post_name'      => 'easymde-visual-featured-image',
		'post_status'    => 'inherit',
		'post_title'     => 'Synthetic featured image',
		'post_type'      => 'attachment',
	);

	$attachment_id = $attachment
		? wp_update_post( $data, true )
		: wp_insert_attachment( $data, $path, 0, true );
	$attachment_id = easymde_phase_zero_require_wp_result(
		$attachment_id,
		'fixture_image_attachment_failed'
	);

	if ( ! $attachment_id ) {
		easymde_phase_zero_fail( 'fixture_image_attachment_id_missing' );
	}

	update_attached_file( $attachment_id, $path );
	wp_update_attachment_metadata(
		$attachment_id,
		array(
			'file'       => $filename,
			'height'     => 1,
			'image_meta' => array(),
			'sizes'      => array(),
			'width'      => 1,
		)
	);

	return array(
		'id'  => (int) $attachment_id,
		'url' => $url,
	);
}

function easymde_phase_zero_markdown_for_source( $source, $canonical, $image_url, array $values ) {
	switch ( $source ) {
		case 'canonical':
			return $canonical;
		case 'canonical-repeat-3':
			return implode( "\n\n---\n\n", array_fill( 0, 3, $canonical ) );
		case 'empty':
			return '';
		case 'short':
			return "# Synthetic visual fixture\n\nDeterministic Phase 0 editor content.";
		case 'mixed':
			return "# Mixed language\n\n" . (string) $values['mixedText'];
		case 'rtl':
			return "# RTL\n\n" . (string) $values['rtlText'];
		case 'long-translation':
			return "# Long translation\n\n" . (string) $values['longTranslation'];
		case 'local-image':
			return "# Taxonomy and media\n\n![Synthetic local image]({$image_url})";
		default:
			easymde_phase_zero_fail( 'fixture_content_source_unknown' );
	}
}

function easymde_phase_zero_delete_revisions( $post_id ) {
	foreach ( wp_get_post_revisions( $post_id ) as $revision ) {
		if ( false === wp_delete_post_revision( $revision->ID ) ) {
			easymde_phase_zero_fail( 'fixture_revision_delete_failed' );
		}
	}
}

function easymde_phase_zero_create_revisions( $post_id, $count ) {
	if ( ! function_exists( '_wp_put_post_revision' ) ) {
		easymde_phase_zero_fail( 'fixture_revision_api_unavailable' );
	}

	for ( $index = 0; $index < $count; ++$index ) {
		$revision_id = _wp_put_post_revision( $post_id );
		$revision_id = easymde_phase_zero_require_wp_result(
			$revision_id,
			'fixture_revision_create_failed'
		);
		if ( ! $revision_id ) {
			easymde_phase_zero_fail( 'fixture_revision_id_missing' );
		}
	}
}

function easymde_phase_zero_seed() {
	$fixture_root = getenv( 'EASYMDE_VISUAL_FIXTURE_ROOT' );
	if ( ! is_string( $fixture_root ) || '' === $fixture_root ) {
		easymde_phase_zero_fail( 'fixture_root_missing' );
	}

	$fixture_path = trailingslashit( $fixture_root ) . 'tests/e2e/fixtures/editor-phase-0.json';
	// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- This is a fixed local fixture path, never a URL.
	$fixture_json = file_get_contents( $fixture_path );
	if ( false === $fixture_json ) {
		easymde_phase_zero_fail( 'fixture_contract_read_failed' );
	}

	try {
		$fixture = json_decode( $fixture_json, true, 512, JSON_THROW_ON_ERROR );
	} catch ( JsonException $exception ) {
		easymde_phase_zero_fail( 'fixture_contract_json_invalid' );
	}

	$fixture = easymde_phase_zero_require_array( $fixture, 'fixture_contract_invalid' );
	$seed    = easymde_phase_zero_require_array(
		isset( $fixture['seed'] ) ? $fixture['seed'] : null,
		'fixture_seed_invalid'
	);

	if (
		1 !== ( isset( $fixture['schemaVersion'] ) ? $fixture['schemaVersion'] : null )
		|| 1 !== ( isset( $seed['schemaVersion'] ) ? $seed['schemaVersion'] : null )
		|| 'easymde_editor_visual_fixture' !== ( isset( $seed['optionName'] ) ? $seed['optionName'] : null )
	) {
		easymde_phase_zero_fail( 'fixture_contract_schema_invalid' );
	}

	$fixture_identity = easymde_phase_zero_require_string(
		isset( $fixture['identity'] ) ? $fixture['identity'] : null,
		'fixture_identity_missing'
	);
	$release_sha256   = getenv( 'EASYMDE_VISUAL_RELEASE_SHA256' );
	$source_commit    = getenv( 'EASYMDE_VISUAL_SOURCE_COMMIT' );

	if ( ! is_string( $release_sha256 ) || ! preg_match( '/^[0-9a-f]{64}$/', $release_sha256 ) ) {
		easymde_phase_zero_fail( 'fixture_release_sha256_invalid' );
	}
	if ( ! is_string( $source_commit ) || ! preg_match( '/^[0-9a-f]{40}$/', $source_commit ) ) {
		easymde_phase_zero_fail( 'fixture_source_commit_invalid' );
	}

	$canonical_path = trailingslashit( $fixture_root ) . easymde_phase_zero_require_string(
		isset( $fixture['canonicalMarkdown'] ) ? $fixture['canonicalMarkdown'] : null,
		'fixture_canonical_path_missing'
	);
	// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- This is a fixed repository fixture path, never a URL.
	$canonical = file_get_contents( $canonical_path );
	if ( false === $canonical ) {
		easymde_phase_zero_fail( 'fixture_canonical_markdown_unavailable' );
	}

	$users      = easymde_phase_zero_require_array(
		isset( $seed['users'] ) ? $seed['users'] : null,
		'fixture_users_invalid'
	);
	$categories = easymde_phase_zero_require_array(
		isset( $seed['categories'] ) ? $seed['categories'] : null,
		'fixture_categories_invalid'
	);
	$tags       = easymde_phase_zero_require_array(
		isset( $seed['tags'] ) ? $seed['tags'] : null,
		'fixture_tags_invalid'
	);
	$custom_css = easymde_phase_zero_require_array(
		isset( $seed['customCss'] ) ? $seed['customCss'] : null,
		'fixture_custom_css_invalid'
	);
	$posts      = easymde_phase_zero_require_array(
		isset( $seed['posts'] ) ? $seed['posts'] : null,
		'fixture_posts_invalid'
	);
	$values     = easymde_phase_zero_require_array(
		isset( $fixture['syntheticValues'] ) ? $fixture['syntheticValues'] : null,
		'fixture_synthetic_values_invalid'
	);

	if ( empty( $users ) || empty( $categories ) || empty( $tags ) || empty( $custom_css ) || empty( $posts ) ) {
		easymde_phase_zero_fail( 'fixture_seed_collection_empty' );
	}

	$user_ids = array();
	foreach ( $users as $definition ) {
		$definition       = easymde_phase_zero_require_array( $definition, 'fixture_user_invalid' );
		$key              = easymde_phase_zero_require_string(
			isset( $definition['key'] ) ? $definition['key'] : null,
			'fixture_user_key_missing'
		);
		$user_ids[ $key ] = easymde_phase_zero_upsert_user( $definition );
	}

	if ( empty( $user_ids['administrator'] ) || empty( $user_ids['lock-owner'] ) ) {
		easymde_phase_zero_fail( 'fixture_required_user_missing' );
	}

	wp_set_current_user( $user_ids['administrator'] );
	update_option( 'show_avatars', 0 );

	$category_ids = array();
	foreach ( $categories as $definition ) {
		$definition = easymde_phase_zero_require_array( $definition, 'fixture_category_invalid' );
		$key        = easymde_phase_zero_require_string(
			isset( $definition['key'] ) ? $definition['key'] : null,
			'fixture_category_key_missing'
		);
		$parent_key = isset( $definition['parent'] ) ? (string) $definition['parent'] : '';
		$parent_id  = '' === $parent_key ? 0 : ( isset( $category_ids[ $parent_key ] ) ? $category_ids[ $parent_key ] : 0 );

		if ( '' !== $parent_key && ! $parent_id ) {
			easymde_phase_zero_fail( 'fixture_category_parent_missing' );
		}

		$category_ids[ $key ] = easymde_phase_zero_upsert_term( $definition, 'category', $parent_id );
	}

	$tag_ids = array();
	foreach ( $tags as $definition ) {
		$definition       = easymde_phase_zero_require_array( $definition, 'fixture_tag_invalid' );
		$slug             = easymde_phase_zero_require_string(
			isset( $definition['slug'] ) ? $definition['slug'] : null,
			'fixture_tag_slug_missing'
		);
		$tag_ids[ $slug ] = easymde_phase_zero_upsert_term( $definition, 'post_tag' );
	}

	$css_library = array();
	foreach ( $custom_css as $definition ) {
		$definition = easymde_phase_zero_require_array( $definition, 'fixture_custom_css_item_invalid' );
		$id         = easymde_phase_zero_require_string(
			isset( $definition['id'] ) ? $definition['id'] : null,
			'fixture_custom_css_id_missing'
		);
		$state      = easymde_phase_zero_require_string(
			isset( $definition['state'] ) ? $definition['state'] : null,
			'fixture_custom_css_state_missing'
		);

		if ( 'rejected' === $state ) {
			continue;
		}

		$css_library[] = array(
			'id'        => sanitize_key( $id ),
			'name'      => easymde_phase_zero_require_string(
				isset( $definition['name'] ) ? $definition['name'] : null,
				'fixture_custom_css_name_missing'
			),
			'css'       => isset( $definition['css'] ) ? (string) $definition['css'] : '',
			'updatedAt' => 1704067200,
		);
	}
	update_user_meta( $user_ids['administrator'], 'easymde_custom_css_library', $css_library );

	$image         = easymde_phase_zero_upsert_image( $user_ids['administrator'] );
	$canonical     = str_replace(
		'https://raw.githubusercontent.com/tao-xiaoxin/EasyMDE/main/docs/assets/easymde-logo-rounded.png',
		$image['url'],
		$canonical
	);
	$post_ids      = array();
	$post_document = new EasyMDE\Content\PostDocument();

	foreach ( $posts as $definition ) {
		$definition   = easymde_phase_zero_require_array( $definition, 'fixture_post_invalid' );
		$key          = easymde_phase_zero_require_string(
			isset( $definition['key'] ) ? $definition['key'] : null,
			'fixture_post_key_missing'
		);
		$slug         = easymde_phase_zero_require_string(
			isset( $definition['slug'] ) ? $definition['slug'] : null,
			'fixture_post_slug_missing'
		);
		$content_kind = easymde_phase_zero_require_string(
			isset( $definition['contentKind'] ) ? $definition['contentKind'] : null,
			'fixture_post_content_kind_missing'
		);
		$status       = easymde_phase_zero_require_string(
			isset( $definition['status'] ) ? $definition['status'] : null,
			'fixture_post_status_missing'
		);
		$title        = 'Synthetic ' . ucwords( str_replace( '-', ' ', $key ) );

		if ( 'empty' === $key ) {
			$title = (string) $values['emptyTitle'];
		} elseif ( 'long-title' === $key ) {
			$title = (string) $values['longTitle'];
		}

		if ( 'wordpress-html' === $content_kind ) {
			$markdown     = null;
			$post_content = '<h2>Ordinary WordPress HTML</h2><p>Synthetic non-EasyMDE content.</p>';
		} elseif ( 'easymde' === $content_kind ) {
			$markdown     = easymde_phase_zero_markdown_for_source(
				easymde_phase_zero_require_string(
					isset( $definition['contentSource'] ) ? $definition['contentSource'] : null,
					'fixture_post_content_source_missing'
				),
				$canonical,
				$image['url'],
				$values
			);
			$post_content = EasyMDE\Content\MarkdownRenderer::render( $markdown, 'default' );
		} else {
			easymde_phase_zero_fail( 'fixture_post_content_kind_unknown' );
		}

		$existing  = get_page_by_path( $slug, OBJECT, 'post' );
		$post_data = array(
			'ID'            => $existing ? $existing->ID : 0,
			'post_author'   => $user_ids['administrator'],
			'post_content'  => $post_content,
			'post_excerpt'  => isset( $definition['excerpt'] ) ? (string) $definition['excerpt'] : '',
			'post_name'     => $slug,
			'post_password' => isset( $definition['password'] ) ? (string) $definition['password'] : '',
			'post_status'   => $status,
			'post_title'    => $title,
			'post_type'     => 'post',
		);

		if ( isset( $definition['date'] ) ) {
			$post_data['post_date']     = (string) $definition['date'];
			$post_data['post_date_gmt'] = get_gmt_from_date( (string) $definition['date'] );
		}

		$allow_empty_post = null;
		if ( 'empty' === $key ) {
			$allow_empty_post = static function () {
				return false;
			};
			add_filter( 'wp_insert_post_empty_content', $allow_empty_post );
		}

		try {
			$post_id = $existing
			? wp_update_post( $post_data, true )
			: wp_insert_post( $post_data, true );
		} finally {
			if ( null !== $allow_empty_post ) {
				remove_filter( 'wp_insert_post_empty_content', $allow_empty_post );
			}
		}

		$post_id = easymde_phase_zero_require_wp_result( $post_id, 'fixture_post_upsert_failed' );
		if ( ! $post_id ) {
			easymde_phase_zero_fail( 'fixture_post_id_missing' );
		}

		$post_ids[ $key ] = (int) $post_id;

		if ( null === $markdown ) {
			foreach ( $post_document->revision_meta_keys() as $meta_key ) {
				delete_post_meta( $post_id, $meta_key );
			}
			delete_post_meta( $post_id, EasyMDE\Content\PostDocument::META_ENABLED );
		} else {
			update_post_meta( $post_id, EasyMDE\Content\PostDocument::META_ENABLED, '1' );
			update_post_meta( $post_id, EasyMDE\Content\PostDocument::META_MARKDOWN, $markdown );
			update_post_meta( $post_id, EasyMDE\Content\PostDocument::META_MARKDOWN_THEME, 'default' );
			update_post_meta( $post_id, EasyMDE\Content\PostDocument::META_CODE_THEME, 'atom-one-dark' );
			update_post_meta( $post_id, EasyMDE\Content\PostDocument::META_CUSTOM_CSS_ID, '' );
			update_post_meta( $post_id, EasyMDE\Content\PostDocument::META_CUSTOM_CSS_SNAPSHOT, '' );
			update_post_meta( $post_id, EasyMDE\Content\PostDocument::META_CUSTOM_FONT, '' );
			update_post_meta( $post_id, EasyMDE\Content\PostDocument::META_WINDOWS_FONT, '0' );
			update_post_meta( $post_id, EasyMDE\Content\PostDocument::META_APPLE_FONT, '0' );
			update_post_meta( $post_id, EasyMDE\Content\PostDocument::META_SERIF_FONT, '0' );
			$post_document->store_render_signature( $post_id, $markdown, 'default', $post_content );
		}

		$post_categories = array();
		foreach ( isset( $definition['categoryKeys'] ) ? $definition['categoryKeys'] : array() as $category_key ) {
			if ( ! isset( $category_ids[ $category_key ] ) ) {
				easymde_phase_zero_fail( 'fixture_post_category_missing' );
			}
			$post_categories[] = $category_ids[ $category_key ];
		}
		easymde_phase_zero_require_wp_result(
			wp_set_post_terms( $post_id, $post_categories, 'category', false ),
			'fixture_post_categories_failed'
		);

		$post_tags = array();
		foreach ( isset( $definition['tagSlugs'] ) ? $definition['tagSlugs'] : array() as $tag_slug ) {
			if ( ! isset( $tag_ids[ $tag_slug ] ) ) {
				easymde_phase_zero_fail( 'fixture_post_tag_missing' );
			}
			$post_tags[] = $tag_ids[ $tag_slug ];
		}
		easymde_phase_zero_require_wp_result(
			wp_set_post_terms( $post_id, $post_tags, 'post_tag', false ),
			'fixture_post_tags_failed'
		);

		if ( ! empty( $definition['featuredImage'] ) ) {
			set_post_thumbnail( $post_id, $image['id'] );
			if ( (int) get_post_thumbnail_id( $post_id ) !== $image['id'] ) {
				easymde_phase_zero_fail( 'fixture_featured_image_failed' );
			}
		} else {
			delete_post_thumbnail( $post_id );
		}

		easymde_phase_zero_delete_revisions( $post_id );
		easymde_phase_zero_create_revisions(
			$post_id,
			isset( $definition['revisionCount'] ) ? absint( $definition['revisionCount'] ) : 0
		);

		if ( isset( $definition['lockOwner'] ) ) {
			$lock_key = (string) $definition['lockOwner'];
			if ( ! isset( $user_ids[ $lock_key ] ) ) {
				easymde_phase_zero_fail( 'fixture_post_lock_owner_missing' );
			}
			update_post_meta( $post_id, '_edit_lock', time() . ':' . $user_ids[ $lock_key ] );
			update_post_meta( $post_id, '_edit_last', $user_ids[ $lock_key ] );
		} else {
			delete_post_meta( $post_id, '_edit_lock' );
			delete_post_meta( $post_id, '_edit_last' );
		}
	}

	$fixture_record = array(
		'schemaVersion'         => 1,
		'identity'              => $fixture_identity,
		'fixtureContractSha256' => hash( 'sha256', $fixture_json ),
		'releaseSha256'         => $release_sha256,
		'sourceCommit'          => $source_commit,
		'summary'               => array(
			'categories' => array_keys( $category_ids ),
			'customCss'  => array_values( array_map( 'sanitize_key', wp_list_pluck( $custom_css, 'state' ) ) ),
			'posts'      => $post_ids,
			'tags'       => array_keys( $tag_ids ),
			'users'      => array_keys( $user_ids ),
		),
	);

	update_option( 'easymde_editor_visual_fixture', $fixture_record, false );
	if ( get_option( 'easymde_editor_visual_fixture' ) !== $fixture_record ) {
		easymde_phase_zero_fail( 'fixture_record_write_failed' );
	}

	echo wp_json_encode( $fixture_record ) . PHP_EOL;
}

easymde_phase_zero_seed();
