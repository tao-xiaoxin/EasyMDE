<?php

namespace EasyMDE\Support;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class Options {

	private $last_compare_and_swap_status = 'none';

	const EDITOR_SETTINGS         = 'easymde_editor_settings';
	const EDITOR_SETTINGS_VERSION = '0.1.9';

	public function editor_settings_key() {
		return self::EDITOR_SETTINGS;
	}

	public function editor_settings_version() {
		return self::EDITOR_SETTINGS_VERSION;
	}

	public function get_editor_settings( $refresh_cache = false ) {
		if ( $refresh_cache ) {
			$this->invalidate_editor_settings_cache();
		}

		$stored = get_option( self::EDITOR_SETTINGS, array() );

		return is_array( $stored ) ? $stored : array();
	}

	/**
	 * Returns the raw persisted snapshot for an atomic write. Unlike
	 * get_editor_settings(), this does not substitute a Settings API default
	 * for a missing row, because false is the add_option CAS sentinel.
	 *
	 * @return array|false|null Stored array, missing row, or invalid stored type.
	 */
	public function get_editor_settings_snapshot() {
		global $wpdb;

        // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- A raw row snapshot is required to distinguish a missing canonical option from a Settings API default before CAS.
		$serialized = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT option_value FROM {$wpdb->options} WHERE option_name = %s",
				self::EDITOR_SETTINGS
			)
		);

		if ( '' !== $wpdb->last_error ) {
			return null;
		}

		if ( null === $serialized ) {
			return false;
		}

		$stored = maybe_unserialize( $serialized );

		return is_array( $stored ) ? $stored : null;
	}

	public function update_editor_settings( array $settings ) {
		$updated = update_option( self::EDITOR_SETTINGS, $settings, false );
		if ( $updated ) {
			$this->invalidate_editor_settings_cache();
		}

		return $updated;
	}

	public function compare_and_swap_editor_settings( $expected, array $settings ) {
		$this->last_compare_and_swap_status = 'none';
		if ( false === $expected ) {
			if ( ! add_option( self::EDITOR_SETTINGS, $settings, '', false ) ) {
				$this->last_compare_and_swap_status = 'conflict';

				return false;
			}

			$this->invalidate_editor_settings_cache();

			return true;
		}

		if ( ! is_array( $expected ) ) {
			$this->last_compare_and_swap_status = 'persistence';

			return false;
		}

		global $wpdb;
        // phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery,WordPress.DB.PreparedSQL.InterpolatedNotPrepared -- The option row predicate is the atomic compare-and-swap boundary for the canonical settings option.
		$updated = $wpdb->query(
			$wpdb->prepare(
				"UPDATE {$wpdb->options} SET option_value = %s WHERE option_name = %s AND CAST(option_value AS BINARY) = CAST(%s AS BINARY)",
				maybe_serialize( $settings ),
				self::EDITOR_SETTINGS,
				maybe_serialize( $expected )
			)
		);

		if ( false === $updated ) {
			$this->last_compare_and_swap_status = 'persistence';

			return false;
		}

		if ( 1 !== $updated ) {
			$this->last_compare_and_swap_status = 'conflict';

			return false;
		}

		$this->invalidate_editor_settings_cache();

		return true;
	}

	public function last_compare_and_swap_was_conflict() {
		return 'conflict' === $this->last_compare_and_swap_status;
	}

	private function invalidate_editor_settings_cache() {
		wp_cache_delete( self::EDITOR_SETTINGS, 'options' );
		wp_cache_delete( 'alloptions', 'options' );
		wp_cache_delete( 'notoptions', 'options' );
	}
}
