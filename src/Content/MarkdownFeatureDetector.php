<?php

namespace EasyMDE\Content;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class MarkdownFeatureDetector {

	public function detect( $markdown = '' ) {
		$markdown                = (string) $markdown;
		$has_fenced_code_block   = (bool) preg_match( '/(^|\n)\s*(```|~~~)/i', $markdown );
		$has_indented_code_block = (bool) preg_match( '/(^|\n)( {4}|\t)\S/', $markdown );
		$has_code_block          = $has_fenced_code_block || $has_indented_code_block;
		$has_code_fence          = $has_indented_code_block || (bool) preg_match( '/(^|\n)\s*(```|~~~)(?!\s*mermaid\b)/i', $markdown );

		return array(
			'darkMode'        => true,
			'localDrafts'     => true,
			'codeBlocks'      => $has_code_block,
			'syntaxHighlight' => $has_code_fence,
			'mermaid'         => (bool) preg_match( '/(^|\n)\s*(```|~~~)\s*mermaid\b/i', $markdown ),
			'math'            => (bool) preg_match( '/(\$\$[\s\S]+?\$\$|\\\\\[|\\\\\(|(?<!\\\\)\$[^\n$]+?(?<!\\\\)\$)/', $markdown ),
			'toc'             => (bool) preg_match( '/^\s*\\[toc\\]\s*$/im', $markdown ),
			'wechatCopy'      => true,
		);
	}
}
