import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

import { wordpressClassicMetadata } from "./wordpress-classic-metadata";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceEntry = "frontend/src/entrypoints/editor-block-index-worker.ts";
const outputRoot = resolve(
	repositoryRoot,
	"assets/build/editor-block-index-worker",
);
const checkOutputRoot = resolve(
	repositoryRoot,
	".cache/easymde-editor-block-index-worker-production-check",
);

export default defineConfig(({ mode }) => ({
	base: "./",
	plugins: [
		wordpressClassicMetadata({
			repositoryRoot,
			sourceEntry,
			scriptHandle: "easymde-editor-block-index-worker",
			dependencies: [],
			manifestResourceField: null,
		}),
	],
	build: {
		target: "es2020",
		outDir: "easymde-check" === mode ? checkOutputRoot : outputRoot,
		emptyOutDir: true,
		manifest: "manifest.json",
		sourcemap: false,
		assetsInlineLimit: 0,
		rollupOptions: {
			input: resolve(repositoryRoot, sourceEntry),
			output: {
				format: "iife",
				name: "EasyMDEEditorBlockIndexWorker",
				entryFileNames: "assets/editor-block-index-worker-[hash].js",
				chunkFileNames: "assets/editor-block-index-worker-chunk-[hash].js",
				assetFileNames: "assets/editor-block-index-worker-[hash][extname]",
			},
		},
	},
}));
