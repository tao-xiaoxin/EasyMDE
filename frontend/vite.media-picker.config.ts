import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

import { wordpressClassicMetadata } from "./wordpress-classic-metadata";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceEntry = "frontend/src/entrypoints/media-picker-bridge.ts";
const committedOutputRoot = resolve(
	repositoryRoot,
	"assets/build/media-picker",
);
const checkOutputRoot = resolve(
	repositoryRoot,
	".cache/easymde-media-picker-production-check",
);

export default defineConfig(({ mode }) => {
	const outputRoot =
		"easymde-check" === mode ? checkOutputRoot : committedOutputRoot;

	return {
		base: "./",
		plugins: [
			wordpressClassicMetadata({
				repositoryRoot,
				sourceEntry,
				scriptHandle: "easymde-media-picker-bridge",
				dependencies: ["media-editor"],
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
				input: { mediaPicker: resolve(repositoryRoot, sourceEntry) },
				output: {
					format: "iife",
					name: "EasyMDEMediaPickerBridge",
					entryFileNames: "assets/media-picker-bridge-[hash].js",
					chunkFileNames: "assets/media-picker-bridge-chunk-[hash].js",
					assetFileNames: "assets/media-picker-bridge-[hash][extname]",
				},
			},
		},
	};
});
