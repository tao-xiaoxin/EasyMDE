<?php

namespace EasyMDE\Rest;

use EasyMDE\ImageHosting\ImageHostProviderSupport;
use RuntimeException;
use Throwable;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Projects one sideload operation into a generated uploads directory.
 *
 * WordPress owns the actual file move, unique filename, attachment, and
 * metadata work. This scope only supplies the generated basename and one
 * request-local upload directory projection.
 */
final class MediaUploadPathScope {

	const TOKEN_FIELD = 'easymde_media_upload_scope_token';

	private static $active_scopes = array();

	private $tmp_name;
	private $generated_basename;
	private $directory;
	private $token;
	private $active            = false;
	private $used              = false;
	private $armed             = false;
	private $consumed          = false;
	private $prefilter_matched = false;
	private $check_registered  = false;
	private $prefilter_callback;
	private $overrides_callback;
	private $check_filetype_callback;
	private $upload_dir_callback;

	/**
	 * @param string $tmp_name    The exact temporary file path for this upload.
	 * @param string $object_key  The validated generated relative object key.
	 */
	public function __construct( $tmp_name, $object_key ) {
		if ( ! is_string( $tmp_name ) || '' === $tmp_name || ! ImageHostProviderSupport::is_valid_object_key( $object_key ) ) {
			throw new RuntimeException( 'easymde_media_upload_scope_invalid' );
		}

		$separator = strrpos( $object_key, '/' );
		$basename  = false === $separator ? $object_key : substr( $object_key, $separator + 1 );
		$directory = false === $separator ? '' : substr( $object_key, 0, $separator );

		try {
			$this->token = bin2hex( random_bytes( 16 ) );
		} catch ( Throwable $throwable ) {
			throw new RuntimeException( 'easymde_media_upload_scope_token_failed' );
		}

		$this->tmp_name           = $tmp_name;
		$this->generated_basename = $basename;
		$this->directory          = $directory;
	}

	/**
	 * Attach this scope's private token to the file array passed to Core.
	 *
	 * @param array $file Sideload file array.
	 * @return array
	 */
	public function tag_file( array $file ) {
		if ( $this->used ) {
			throw new RuntimeException( 'easymde_media_upload_scope_reused' );
		}

		$file[ self::TOKEN_FIELD ] = $this->token;

		return $file;
	}

	/**
	 * Run exactly one Core sideload operation inside this filter scope.
	 *
	 * @param callable $operation Core sideload operation.
	 * @return mixed
	 */
	public function run( callable $operation ) {
		if ( $this->active ) {
			throw new RuntimeException( 'easymde_media_upload_scope_active' );
		}
		if ( $this->used ) {
			throw new RuntimeException( 'easymde_media_upload_scope_reused' );
		}

		$this->active          = true;
		$this->used            = true;
		self::$active_scopes[] = $this;
		$this->install_callbacks();

		try {
			return call_user_func( $operation );
		} finally {
			$this->remove_callbacks();
			array_pop( self::$active_scopes );
			$this->active = false;
			$this->token  = '';
		}
	}

	public function is_consumed() {
		return $this->consumed;
	}

	private function install_callbacks() {
		$this->prefilter_callback      = function ( $file ) {
			if ( ! $this->matches( $file ) ) {
				return $file;
			}

			$this->prefilter_matched = true;
			$file['name']            = $this->generated_basename;

			return $file;
		};
		$this->overrides_callback      = function ( $overrides, $file ) {
			if ( ! $this->matches( $file ) || $this->check_registered || $this->consumed ) {
				return $overrides;
			}

			$this->check_registered = true;
			add_filter( 'wp_check_filetype_and_ext', $this->check_filetype_callback, PHP_INT_MAX, 5 );

			return $overrides;
		};
		$this->check_filetype_callback = function ( $checked, $file, $filename, $mimes, $real_mime ) {
			unset( $mimes, $real_mime );
			if (
				! $this->prefilter_matched ||
				$this->armed ||
				$this->consumed ||
				$this->tmp_name !== $file ||
				$this->generated_basename !== $filename
			) {
				return $checked;
			}

			$this->prefilter_matched = false;
			$this->armed             = true;
			add_filter( 'upload_dir', $this->upload_dir_callback, PHP_INT_MAX, 1 );

			return $checked;
		};
		$this->upload_dir_callback     = function ( $uploads ) {
			if ( self::current_scope() !== $this ) {
				return $uploads;
			}

			remove_filter( 'upload_dir', $this->upload_dir_callback, PHP_INT_MAX );
			$this->armed    = false;
			$this->consumed = true;

			if (
				! is_array( $uploads ) ||
				! isset( $uploads['basedir'], $uploads['baseurl'] ) ||
				! is_string( $uploads['basedir'] ) ||
				! is_string( $uploads['baseurl'] ) ||
				'' === $uploads['basedir'] ||
				'' === $uploads['baseurl']
			) {
				if ( is_array( $uploads ) && empty( $uploads['error'] ) ) {
					$uploads['error'] = 'easymde_media_upload_scope_invalid_upload_directory';
				}

				return $uploads;
			}

			$uploads['path']   = '' === $this->directory
				? untrailingslashit( $uploads['basedir'] )
				: trailingslashit( $uploads['basedir'] ) . $this->directory;
			$uploads['url']    = '' === $this->directory
				? untrailingslashit( $uploads['baseurl'] )
				: trailingslashit( $uploads['baseurl'] ) . $this->directory;
			$uploads['subdir'] = '' === $this->directory ? '' : '/' . $this->directory;

			return $uploads;
		};

		add_filter( 'wp_handle_sideload_prefilter', $this->prefilter_callback, PHP_INT_MAX, 1 );
		add_filter( 'wp_handle_sideload_overrides', $this->overrides_callback, PHP_INT_MAX, 2 );
	}

	private static function current_scope() {
		$count = count( self::$active_scopes );

		return $count > 0 ? self::$active_scopes[ $count - 1 ] : null;
	}

	private function remove_callbacks() {
		if ( $this->prefilter_callback ) {
			remove_filter( 'wp_handle_sideload_prefilter', $this->prefilter_callback, PHP_INT_MAX );
		}
		if ( $this->overrides_callback ) {
			remove_filter( 'wp_handle_sideload_overrides', $this->overrides_callback, PHP_INT_MAX );
		}
		if ( $this->check_filetype_callback ) {
			remove_filter( 'wp_check_filetype_and_ext', $this->check_filetype_callback, PHP_INT_MAX );
		}
		if ( $this->upload_dir_callback ) {
			remove_filter( 'upload_dir', $this->upload_dir_callback, PHP_INT_MAX );
		}
		$this->prefilter_callback      = null;
		$this->overrides_callback      = null;
		$this->check_filetype_callback = null;
		$this->upload_dir_callback     = null;
		$this->armed                   = false;
		$this->prefilter_matched       = false;
		$this->check_registered        = false;
	}

	public function owns_relative_path( $relative_path ) {
		if ( ! $this->consumed || ! is_string( $relative_path ) || '' === $relative_path ) {
			return false;
		}

		$relative_path = ltrim( str_replace( '\\', '/', $relative_path ), '/' );
		if ( '' === $this->directory ) {
			return false === strpos( $relative_path, '/' );
		}

		return 0 === strpos( $relative_path, $this->directory . '/' );
	}

	private function matches( $file ) {
		return is_array( $file ) &&
			isset( $file['tmp_name'], $file[ self::TOKEN_FIELD ] ) &&
			is_string( $file['tmp_name'] ) &&
			is_string( $file[ self::TOKEN_FIELD ] ) &&
			$this->tmp_name === $file['tmp_name'] &&
			$this->token === $file[ self::TOKEN_FIELD ];
	}
}
