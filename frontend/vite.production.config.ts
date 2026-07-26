import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

import { wordpressClassicMetadata } from "./wordpress-classic-metadata";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceEntry = "frontend/src/entrypoints/admin-editor.tsx";
const committedOutputRoot = resolve(repositoryRoot, "assets/build");
const checkOutputRoot = resolve(
	repositoryRoot,
	".cache/easymde-frontend-production-check",
);
const wordpressExternals = {
	"@wordpress/element": "wp.element",
	"@wordpress/i18n": "wp.i18n",
	react: "wp.element",
	"react-dom": "wp.element",
	"react-dom/client": "wp.element",
} as const;

export default defineConfig(({ mode }) => {
	const outputRoot =
		"easymde-check" === mode ? checkOutputRoot : committedOutputRoot;

	return {
		base: "./",
		plugins: [
			wordpressClassicMetadata({
				repositoryRoot,
				sourceEntry,
				scriptHandle: "easymde-admin-editor-toolbar",
				dependencies: [
					"media-editor",
					"wp-api-fetch",
					"wp-element",
					"wp-hooks",
					"wp-i18n",
				],
				manifestResourceField: null,
			}),
		],
		build: {
			target: "es2020",
			outDir: outputRoot,
			emptyOutDir: true,
			manifest: "manifest.json",
			sourcemap: false,
			assetsInlineLimit: 0,
			rollupOptions: {
				input: { editor: resolve(repositoryRoot, sourceEntry) },
				external: Object.keys(wordpressExternals),
				output: {
					format: "iife",
					name: "EasyMDEAdminEditorReact",
					entryFileNames: "assets/admin-editor-[hash].js",
					chunkFileNames: "assets/admin-editor-chunk-[hash].js",
					assetFileNames: "assets/admin-editor-[hash][extname]",
					globals: wordpressExternals,
				},
			},
		},
	};
});
