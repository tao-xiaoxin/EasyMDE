<?php

namespace EasyMDE\Content;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class MarkdownFeatureDetector {

	public function detect( $markdown = '' ) {
		$markdown                = (string) $markdown;
		$fenced_code_blocks      = $this->detect_fenced_code_blocks( $markdown );
		$has_indented_code_block = $this->might_contain_indented_code_block( $markdown )
			&& (bool) preg_match( '/(^|\n)( {4}|\t)\S/', $markdown );
		$has_code_block          = $fenced_code_blocks['any'] || $has_indented_code_block;
		$has_regular_code_block  = $fenced_code_blocks['regular'] || $has_indented_code_block;

		return array(
			'darkMode'        => true,
			'localDrafts'     => true,
			'codeBlocks'      => $has_code_block,
			'syntaxHighlight' => $has_regular_code_block,
			'mermaid'         => $fenced_code_blocks['mermaid'],
			'math'            => $this->might_contain_math( $markdown )
				&& (bool) preg_match( '/(\$\$[\s\S]+?\$\$|\\\\\[|\\\\\(|(?<!\\\\)\$[^\n$]+?(?<!\\\\)\$)/', $markdown ),
			'toc'             => false !== stripos( $markdown, '[toc]' )
				&& (bool) preg_match( '/^\s*\\[toc\\]\s*$/im', $markdown ),
			'wechatCopy'      => true,
		);
	}

	private function detect_fenced_code_blocks( $markdown ) {
		$result = array(
			'any'     => false,
			'regular' => false,
			'mermaid' => false,
		);

		if ( false === strpos( $markdown, '```' ) && false === strpos( $markdown, '~~~' ) ) {
			return $result;
		}

		$in_fence     = false;
		$fence_marker = '';
		$fence_length = 0;
		$lines        = preg_split( '/\r\n|\r|\n/', $markdown );

		foreach ( $lines as $line ) {
			if ( $in_fence ) {
				if ( preg_match( '/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/', $line, $match )
					&& substr( $match[1], 0, 1 ) === $fence_marker
					&& strlen( $match[1] ) >= $fence_length
				) {
					$in_fence = false;
				}

				continue;
			}

			if ( ! preg_match( '/^[ \t]{0,3}(`{3,}|~{3,})([^\r\n]*)$/', $line, $match ) ) {
				continue;
			}

			$info          = trim( $match[2] );
			$in_fence      = true;
			$fence_marker  = substr( $match[1], 0, 1 );
			$fence_length  = strlen( $match[1] );
			$result['any'] = true;

			if ( preg_match( '/^mermaid\b/i', $info ) ) {
				$result['mermaid'] = true;
			} else {
				$result['regular'] = true;
			}
		}

		return $result;
	}

	private function might_contain_indented_code_block( $markdown ) {
		return 0 === strpos( $markdown, '    ' )
			|| 0 === strpos( $markdown, "\t" )
			|| false !== strpos( $markdown, "\n    " )
			|| false !== strpos( $markdown, "\n\t" );
	}

	private function might_contain_math( $markdown ) {
		return false !== strpos( $markdown, '$' )
			|| false !== strpos( $markdown, '\\[' )
			|| false !== strpos( $markdown, '\\(' );
	}
}
