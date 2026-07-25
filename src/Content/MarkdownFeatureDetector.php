<?php

namespace EasyMDE\Content;

use League\CommonMark\Environment\Environment;
use League\CommonMark\Extension\CommonMark\CommonMarkCoreExtension;
use League\CommonMark\Extension\CommonMark\Node\Block\FencedCode;
use League\CommonMark\Extension\CommonMark\Node\Block\IndentedCode;
use League\CommonMark\Extension\GithubFlavoredMarkdownExtension;
use League\CommonMark\Parser\MarkdownParser;
use RuntimeException;

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

final class MarkdownFeatureDetector {

	private $copyable_code_cache_key;
	private $copyable_code_cache;

	public function detect( $markdown = '' ) {
		$markdown                = (string) $markdown;
		$fenced_code_blocks      = $this->detect_fenced_code_blocks( $markdown );
		$has_indented_code_block = $this->might_contain_indented_code_block( $markdown )
			&& (bool) preg_match( '/(^|\n)( {4}|\t)\S/', $markdown );
		$has_code_block          = $fenced_code_blocks['any'] || $has_indented_code_block;
		$has_regular_code_block  = $fenced_code_blocks['regular'] || $has_indented_code_block;

		return array(
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

	public function has_copyable_code_block( $markdown = '' ) {
		$markdown  = (string) $markdown;
		$cache_key = hash( 'sha256', $markdown );

		if ( $cache_key === $this->copyable_code_cache_key ) {
			return $this->copyable_code_cache;
		}

		if ( '' === $markdown ) {
			return $this->cache_copyable_code_result( $cache_key, false );
		}

		if ( ! class_exists( Environment::class ) || ! class_exists( MarkdownParser::class ) ) {
			throw new RuntimeException( 'The league/commonmark dependency is required to detect EasyMDE Markdown features.' );
		}

		$environment = new Environment(
			array(
				'html_input'              => 'strip',
				'allow_unsafe_links'      => false,
				'max_nesting_level'       => MarkdownRenderer::MAX_NESTING_LEVEL,
				'max_delimiters_per_line' => MarkdownRenderer::MAX_DELIMITERS_PER_LINE,
			)
		);
		$environment->addExtension( new CommonMarkCoreExtension() );
		$environment->addExtension( new GithubFlavoredMarkdownExtension() );
		$parser = new MarkdownParser( $environment );

		foreach ( $parser->parse( $markdown )->iterator() as $node ) {
			if ( $node instanceof IndentedCode ) {
				return $this->cache_copyable_code_result( $cache_key, true );
			}

			if ( ! $node instanceof FencedCode ) {
				continue;
			}

			$info_words = $node->getInfoWords();
			if ( ! isset( $info_words[0] ) || 0 !== strcasecmp( $info_words[0], 'mermaid' ) ) {
				return $this->cache_copyable_code_result( $cache_key, true );
			}
		}

		return $this->cache_copyable_code_result( $cache_key, false );
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
			$fence_line = $this->strip_commonmark_container_prefixes( $line );

			if ( $in_fence ) {
				if ( preg_match( '/^ {0,3}(`{3,}|~{3,})[ \t]*$/', $fence_line, $match )
					&& substr( $match[1], 0, 1 ) === $fence_marker
					&& strlen( $match[1] ) >= $fence_length
				) {
					$in_fence = false;
				}

				continue;
			}

			if ( ! preg_match( '/^ {0,3}(`{3,}|~{3,})([^\r\n]*)$/', $fence_line, $match ) ) {
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

	private function strip_commonmark_container_prefixes( $line ) {
		$previous = null;

		while ( $previous !== $line ) {
			$previous = $line;
			$line     = preg_replace( '/^ {0,3}>[ \t]?/', '', $line, 1 );
			$line     = preg_replace( '/^ {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+/', '', $line, 1 );
		}

		return $line;
	}

	private function cache_copyable_code_result( $cache_key, $result ) {
		$this->copyable_code_cache_key = $cache_key;
		$this->copyable_code_cache     = (bool) $result;

		return $this->copyable_code_cache;
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
