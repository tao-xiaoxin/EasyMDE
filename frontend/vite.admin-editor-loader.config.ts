import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vite";

import { wordpressClassicMetadata } from "./wordpress-classic-metadata";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceEntry = "frontend/src/entrypoints/admin-editor-loader.ts";
const committedOutputRoot = resolve(
	repositoryRoot,
	"assets/build/admin-editor-loader",
);
const checkOutputRoot = resolve(
	repositoryRoot,
	".cache/easymde-admin-editor-loader-production-check",
);

export default defineConfig(({ mode }) => ({
	base: "./",
	plugins: [
		wordpressClassicMetadata({
			repositoryRoot,
			sourceEntry,
			scriptHandle: "easymde-admin-editor-toolbar",
			dependencies: ["wp-api-fetch", "wp-element", "wp-hooks", "wp-i18n"],
			manifestResourceField: null,
		}),
	],
	build: {
		target: "es2020",
		outDir: "easymde-check" === mode ? checkOutputRoot : committedOutputRoot,
		emptyOutDir: true,
		manifest: "manifest.json",
		sourcemap: false,
		assetsInlineLimit: 0,
		rollupOptions: {
			input: { loader: resolve(repositoryRoot, sourceEntry) },
			output: {
				format: "iife",
				name: "EasyMDEAdminEditorLoader",
				entryFileNames: "assets/admin-editor-loader-[hash].js",
				chunkFileNames: "assets/admin-editor-loader-chunk-[hash].js",
				assetFileNames: "assets/admin-editor-loader-[hash][extname]",
			},
		},
	},
}));
