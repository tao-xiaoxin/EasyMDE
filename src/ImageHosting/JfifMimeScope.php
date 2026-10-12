<?php

namespace EasyMDE\ImageHosting;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Adds Core's JFIF MIME mapping only for one exact temporary upload.
 */
final class JfifMimeScope {

	private function __construct() {}

	/**
	 * Run an operation with a one-file JFIF Core mapping.
	 *
	 * @param string   $temporary_path Exact temporary file.
	 * @param string   $filename Exact upload filename.
	 * @param callable $operation Operation that invokes Core MIME checks.
	 * @return mixed
	 */
	public static function run( $temporary_path, $filename, callable $operation ) {
		$extension = ImageUploadExtensionPolicy::filename_extension( $filename );
		if ( 'jfif' !== $extension ) {
			return call_user_func( $operation );
		}

		$callback = static function ( $checked, $file, $name, $mimes, $real_mime ) use ( $temporary_path, $filename ) {
			if ( $temporary_path !== $file || $filename !== $name ) {
				return $checked;
			}
			$site_mimes = get_allowed_mime_types();
			if (
				! is_array( $site_mimes ) ||
				! in_array( 'image/jpeg', $site_mimes, true ) ||
				( is_array( $mimes ) && ! in_array( 'image/jpeg', $mimes, true ) )
			) {
				return $checked;
			}

			$actual_mime = function_exists( 'wp_get_image_mime' ) ? wp_get_image_mime( $file ) : '';
			if ( 'image/jpeg' !== $actual_mime && 'image/jpeg' !== $real_mime ) {
				return $checked;
			}

			$checked['ext']             = 'jfif';
			$checked['type']            = 'image/jpeg';
			$checked['proper_filename'] = false;

			return $checked;
		};
		add_filter( 'wp_check_filetype_and_ext', $callback, PHP_INT_MAX, 5 );
		try {
			return call_user_func( $operation );
		} finally {
			remove_filter( 'wp_check_filetype_and_ext', $callback, PHP_INT_MAX );
		}
	}
}
