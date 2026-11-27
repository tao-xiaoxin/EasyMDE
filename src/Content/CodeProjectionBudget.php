<?php

namespace EasyMDE\Content;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Bounds request-local projection observation before the final JSON check.
 */
final class CodeProjectionBudget {

	const MAX_ENTRIES = 50000;
	const MAX_ROWS    = 50000;
	const MAX_BYTES   = 4194304;

	private $entries = 0;

	private $rows = 0;

	private $minimum_bytes;

	private $limited = false;

	public function __construct() {
		$this->minimum_bytes = strlen( '{"version":1,"coordinate":"line","offsetUnit":"utf16","status":"available","entries":[' );
	}

	public function reserve_entry() {
		if ( $this->limited || $this->entries >= self::MAX_ENTRIES ) {
			$this->limited = true;

			return false;
		}

		++$this->entries;
		$this->minimum_bytes += strlen( '{"kind":"indented","startLine":0,"endLine":0,"status":"available","rows":[]}' );
		if ( $this->minimum_bytes > self::MAX_BYTES ) {
			$this->limited = true;

			return false;
		}

		return true;
	}

	public function reserve_row() {
		if ( $this->limited || $this->rows >= self::MAX_ROWS ) {
			$this->limited = true;

			return false;
		}

		++$this->rows;
		$this->minimum_bytes += strlen( '{"sourceLine":0,"contentLine":0,"prefixEnd":0,"prefixTabColumns":0,"literalFrom":0,"literalLeadingSpaces":0}' );
		if ( $this->minimum_bytes > self::MAX_BYTES ) {
			$this->limited = true;

			return false;
		}

		return true;
	}

	public function is_limited() {
		return $this->limited;
	}
}
