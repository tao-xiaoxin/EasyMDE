<?php

namespace EasyMDE\Content;

use EasyMDE\Theme\ThemeStateRepository;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class RevisionManager {

	private $post_document;
	private $theme_state_repository;
	private $renderer_available_callback;
	private $restoring              = false;
	private $pre_save_revision_meta = array();
	private $created_revision_ids   = array();
	private $recording_revision_ids = array();

	public function __construct(
		PostDocument $post_document,
		ThemeStateRepository $theme_state_repository,
		?callable $renderer_available_callback = null
	) {
		$this->post_document               = $post_document;
		$this->theme_state_repository      = $theme_state_repository;
		$this->renderer_available_callback = null !== $renderer_available_callback ? $renderer_available_callback : array( MarkdownRenderer::class, 'is_available' );
	}

	public function register_hooks() {
		add_filter( 'wp_post_revision_meta_keys', array( $this, 'register_revision_meta_keys' ) );
		add_action( 'pre_post_update', array( $this, 'begin_revision_recording_before_update' ), 1, 2 );
		add_action( 'save_post', array( $this, 'capture_revision_meta_before_save' ), 1, 3 );
		add_action( '_wp_put_post_revision', array( $this, 'save_revision_meta' ), 10, 2 );
		add_action( 'wp_after_insert_post', array( $this, 'sync_latest_revision_meta_after_save' ), 20, 3 );
		add_action( 'wp_restore_post_revision', array( $this, 'restore_revision_meta' ), 10, 2 );
	}

	public function register_revision_meta_keys( $keys ) {
		foreach ( $this->post_document->revision_meta_keys() as $key ) {
			if ( ! in_array( $key, $keys, true ) ) {
				$keys[] = $key;
			}
		}

		return $keys;
	}

	public function save_revision_meta( $revision_id, $post_id = 0 ) {
		$revision_id = absint( $revision_id );
		$parent_id   = $post_id ? absint( $post_id ) : wp_is_post_revision( $revision_id );
		if ( $parent_id && $revision_id && ! wp_is_post_autosave( $revision_id ) && ! empty( $this->recording_revision_ids[ $parent_id ] ) ) {
			if ( ! isset( $this->created_revision_ids[ $parent_id ] ) ) {
				$this->created_revision_ids[ $parent_id ] = array();
			}
			$this->created_revision_ids[ $parent_id ][] = $revision_id;
		}

		if ( ! $parent_id || ! $this->post_document->is_easymde_post( $parent_id ) ) {
			return;
		}

		foreach ( $this->post_document->revision_meta_keys() as $key ) {
			if ( metadata_exists( 'post', $parent_id, $key ) ) {
				update_metadata( 'post', $revision_id, $key, get_post_meta( $parent_id, $key, true ) );
			} else {
				delete_metadata( 'post', $revision_id, $key );
			}
		}
	}

	public function begin_revision_recording_before_update( $post_id, $data = array() ) {
		$post_id = absint( $post_id );
		if ( ! $post_id || $this->restoring || wp_is_post_revision( $post_id ) ) {
			return;
		}

		unset( $this->created_revision_ids[ $post_id ], $this->recording_revision_ids[ $post_id ] );

		$post_type = is_array( $data ) && isset( $data['post_type'] ) ? (string) $data['post_type'] : '';
		if ( '' === $post_type ) {
			$post      = get_post( $post_id );
			$post_type = $post ? (string) $post->post_type : '';
		}

		if ( ! $post_type || ! $this->post_document->is_supported_post_type( $post_type ) ) {
			return;
		}

		$this->recording_revision_ids[ $post_id ] = true;
	}

	public function capture_revision_meta_before_save( $post_id, $post, $update ) {
		$post_id = absint( $post_id );
		if ( ! $update || $this->restoring || wp_is_post_revision( $post_id ) || ! $post || ! $this->post_document->is_supported_post_type( $post->post_type ) ) {
			return;
		}

		$this->pre_save_revision_meta[ $post_id ] = $this->snapshot_revision_meta( $post_id );
	}

	public function sync_latest_revision_meta_after_save( $post_id, $post, $update ) {
		$post_id = absint( $post_id );

		try {
			if ( ! $update || $this->restoring || wp_is_post_revision( $post_id ) || ! $post || ! $this->post_document->is_easymde_post( $post_id ) ) {
				return;
			}

			$revision_id = $this->latest_current_save_revision_id( $post_id );
			if ( $revision_id ) {
				$this->save_revision_meta( $revision_id, $post_id );
				return;
			}

			if ( empty( $this->pre_save_revision_meta[ $post_id ] ) || ! $this->revision_meta_changed_since( $post_id, $this->pre_save_revision_meta[ $post_id ] ) ) {
				return;
			}

			$this->force_revision_for_meta_change( $post_id );
		} finally {
			unset( $this->pre_save_revision_meta[ $post_id ], $this->created_revision_ids[ $post_id ], $this->recording_revision_ids[ $post_id ] );
		}
	}

	public function restore_revision_meta( $post_id, $revision_id ) {
		if ( $this->restoring || ! $post_id || ! $revision_id ) {
			return;
		}

		$has_easymde_meta = false;
		foreach ( $this->post_document->revision_meta_keys() as $key ) {
			if ( metadata_exists( 'post', $revision_id, $key ) ) {
				$has_easymde_meta = true;
				break;
			}
		}

		if ( ! $has_easymde_meta ) {
			$this->restore_pre_easymde_revision( $post_id, $revision_id );
			return;
		}

		$this->restoring = true;
		$previous_meta   = $this->snapshot_revision_meta( $post_id );

		try {
			foreach ( $this->post_document->revision_meta_keys() as $key ) {
				if ( metadata_exists( 'post', $revision_id, $key ) ) {
					update_post_meta( $post_id, $key, get_post_meta( $revision_id, $key, true ) );
				} else {
					delete_post_meta( $post_id, $key );
				}
			}

			if ( $this->post_document->is_easymde_post( $post_id ) ) {
				$this->restore_post_content( $post_id, $revision_id );
			}
		} catch ( \RuntimeException $exception ) {
			do_action( 'easymde_revision_restore_failed', $post_id, $revision_id, $exception );
			unset( $exception );
			if ( $this->post_content_matches_revision( $post_id, $revision_id ) ) {
				return;
			}
			$this->restore_meta_snapshot( $post_id, $previous_meta );
		} finally {
			$this->restoring = false;
		}
	}

	private function restore_pre_easymde_revision( $post_id, $revision_id ) {
		if ( ! $this->post_document->is_easymde_post( $post_id ) ) {
			return;
		}

		$revision = get_post( absint( $revision_id ) );
		if ( ! $revision ) {
			return;
		}

		$this->restoring = true;
		$previous_meta   = $this->snapshot_revision_meta( $post_id );

		try {
			foreach ( $this->post_document->revision_meta_keys() as $key ) {
				delete_post_meta( $post_id, $key );
			}

			$this->update_post_content( $post_id, (string) $revision->post_content );
		} catch ( \RuntimeException $exception ) {
			do_action( 'easymde_revision_restore_failed', $post_id, $revision_id, $exception );
			unset( $exception );
			if ( $this->post_content_matches_revision( $post_id, $revision_id ) ) {
				return;
			}
			$this->restore_meta_snapshot( $post_id, $previous_meta );
		} finally {
			$this->restoring = false;
		}
	}

	private function snapshot_revision_meta( $post_id ) {
		$snapshot = array();

		foreach ( $this->post_document->revision_meta_keys() as $key ) {
			$snapshot[ $key ] = array(
				'exists' => metadata_exists( 'post', $post_id, $key ),
				'value'  => get_post_meta( $post_id, $key, true ),
			);
		}

		return $snapshot;
	}

	private function restore_meta_snapshot( $post_id, array $snapshot ) {
		foreach ( $snapshot as $key => $item ) {
			if ( ! empty( $item['exists'] ) ) {
				update_post_meta( $post_id, $key, $item['value'] );
			} else {
				delete_post_meta( $post_id, $key );
			}
		}
	}

	private function revision_meta_changed_since( $post_id, array $snapshot ) {
		foreach ( $this->post_document->revision_meta_keys() as $key ) {
			$exists = metadata_exists( 'post', $post_id, $key );
			$value  = get_post_meta( $post_id, $key, true );

			if ( empty( $snapshot[ $key ] ) || (bool) $snapshot[ $key ]['exists'] !== $exists || $snapshot[ $key ]['value'] !== $value ) {
				return true;
			}
		}

		return false;
	}

	private function latest_current_save_revision_id( $post_id ) {
		if ( empty( $this->created_revision_ids[ $post_id ] ) ) {
			return 0;
		}

		foreach ( array_reverse( $this->created_revision_ids[ $post_id ] ) as $revision_id ) {
			$revision_id = absint( $revision_id );
			if ( $revision_id && ! wp_is_post_autosave( $revision_id ) ) {
				return $revision_id;
			}
		}

		return 0;
	}

	private function force_revision_for_meta_change( $post_id ) {
		if ( ! function_exists( 'wp_save_post_revision' ) ) {
			return;
		}

		$force_revision = function ( $post_has_changed, $latest_revision, $post ) use ( $post_id ) {
			unset( $latest_revision );

			return $post && (int) $post->ID === (int) $post_id ? true : $post_has_changed;
		};

		add_filter( 'wp_save_post_revision_post_has_changed', $force_revision, 10, 3 );
		try {
			wp_save_post_revision( $post_id );
		} finally {
			remove_filter( 'wp_save_post_revision_post_has_changed', $force_revision, 10 );
		}
	}

	private function restore_post_content( $post_id, $revision_id ) {
		$content                = null;
		$rendered_from_markdown = false;

		if ( $this->is_renderer_available() ) {
			try {
				$theme_state            = $this->theme_state_repository->get_theme_state( $post_id );
				$markdown               = (string) get_post_meta( $post_id, PostDocument::META_MARKDOWN, true );
				$content                = MarkdownRenderer::render( $markdown, $theme_state['markdownTheme'] );
				$rendered_from_markdown = true;
			} catch ( \Throwable $exception ) {
				unset( $exception );
			}
		}

		if ( null === $content ) {
			$revision = get_post( absint( $revision_id ) );
			if ( ! $revision ) {
				return;
			}

			$content = (string) $revision->post_content;
		}

		$this->update_post_content( $post_id, $content );

		if ( $rendered_from_markdown ) {
			$this->post_document->store_render_signature(
				$post_id,
				$markdown,
				$theme_state['markdownTheme'],
				$content
			);
		}
	}

	private function update_post_content( $post_id, $content ) {
		global $wpdb;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery -- Revision restore updates post_content directly to avoid recursive save hooks while syncing restored meta.
		$updated = $wpdb->update(
			$wpdb->posts,
			array( 'post_content' => $content ),
			array( 'ID' => $post_id ),
			array( '%s' ),
			array( '%d' )
		);

		if ( false === $updated ) {
			throw new \RuntimeException( 'Unable to restore EasyMDE revision post content.' );
		}

		clean_post_cache( $post_id );
	}

	private function post_content_matches_revision( $post_id, $revision_id ) {
		$post     = get_post( absint( $post_id ) );
		$revision = get_post( absint( $revision_id ) );

		if ( ! $post || ! $revision ) {
			return false;
		}

		return (string) $post->post_content === (string) $revision->post_content;
	}

	private function is_renderer_available() {
		return (bool) call_user_func( $this->renderer_available_callback );
	}
}
