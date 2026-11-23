import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig, type Plugin } from "vite";

import {
	wordpressClassicMetadata,
	wordpressEsmExternals,
} from "./wordpress-classic-metadata";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceEntry = "frontend/src/entrypoints/admin-editor.tsx";
const committedOutputRoot = resolve(repositoryRoot, "assets/build");
const checkOutputRoot = resolve(
	repositoryRoot,
	".cache/easymde-frontend-production-check",
);

function encodeLiteralTabOnlyLines(): Plugin {
	return {
		name: "easymde-encode-literal-tab-only-lines",
		generateBundle(_options, bundle) {
			for (const output of Object.values(bundle)) {
				if ("chunk" !== output.type) continue;
				output.code = output.code.replace(/\n\t\n/gu, "\n\\t\n");
			}
		},
	};
}

export default defineConfig(({ mode }) => {
	const outputRoot =
		"easymde-check" === mode ? checkOutputRoot : committedOutputRoot;

	return {
		base: "./",
		resolve: {
			preserveSymlinks: true,
		},
		plugins: [
			wordpressEsmExternals(),
			encodeLiteralTabOnlyLines(),
			wordpressClassicMetadata({
				allowDynamicChunks: true,
				repositoryRoot,
				sourceEntry,
				scriptHandle: "easymde-admin-editor-toolbar",
				dependencies: [
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
			modulePreload: false,
			sourcemap: false,
			assetsInlineLimit: 0,
			rolldownOptions: {
				input: { editor: resolve(repositoryRoot, sourceEntry) },
				preserveEntrySignatures: "allow-extension",
				output: {
					format: "es",
					entryFileNames: "assets/admin-editor-[hash].js",
					chunkFileNames: "assets/admin-editor-chunk-[hash].js",
					assetFileNames: "assets/admin-editor-[hash][extname]",
					codeSplitting: {
						groups: [
							{
								// Consolidate statically-booted modules shared with lazy chunks
								// into one static chunk while keeping dynamic-only chunks deferred.
								name: "shared",
								tags: ["$initial"],
								minShareCount: 2,
							},
						],
					},
				},
			},
		},
	};
});
