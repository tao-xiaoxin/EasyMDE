import { createRoot, flushSync } from "@wordpress/element";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	parseSettingsCenterBootstrap,
	SETTINGS_CENTER_STRING_KEYS,
	type SettingsCenterBootstrap,
} from "../contracts/bootstrap/settings-center-bootstrap";
import {
	SETTINGS_CENTER_DEFAULT_SETTINGS,
	SETTINGS_CENTER_TEST_SETTINGS,
} from "../test/settings-center-settings-fixture";
import {
	mountSettingsCenter,
	showSettingsCenterStartupFailure,
	startSettingsCenter,
} from "./settings-center";

vi.hoisted(() => {
	vi.spyOn(console, "error").mockImplementation(() => undefined);
});

vi.mock("@wordpress/element", async (importOriginal) => ({
	...(await importOriginal<typeof import("@wordpress/element")>()),
	createRoot: vi.fn(),
	flushSync: vi.fn((callback: () => void) => callback()),
}));
vi.mock(
	"../contracts/bootstrap/settings-center-bootstrap",
	async (importOriginal) => ({
		...(await importOriginal<
			typeof import("../contracts/bootstrap/settings-center-bootstrap")
		>()),
		parseSettingsCenterBootstrap: vi.fn(),
	}),
);

function bootstrap(): SettingsCenterBootstrap {
	const origin = window.location.origin;
	return {
		schemaVersion: 2,
		closeUrl: `${origin}/wp-admin/options-general.php`,
		uploadLimits: { systemMaxBytes: 5 * 1024 * 1024 },
		api: {
			settingsUrl: `${origin}/wp-json/easymde/v1/settings`,
			nonce: "test-nonce",
			actionNonce: "test-action-nonce",
			imageHostingVerificationActionNonce: "test-image-hosting-action-nonce",
			imageHostingVerificationUrl: `${origin}/wp-json/easymde/v1/image-hosting/verification`,
			imageHostingSecretRevealActionNonce:
				"test-image-hosting-secret-reveal-action-nonce",
			imageHostingSecretRevealUrl: `${origin}/wp-json/easymde/v1/image-hosting/secret`,
		},
		assets: {
			brandMarkUrl: `${origin}/plugin/brand.png`,
			headerIllustrationUrl: `${origin}/plugin/header.png`,
			searchEmptyIllustrationUrl: `${origin}/plugin/search-empty.png`,
		},
		links: {
			projectUrl: "https://github.com/tao-xiaoxin/EasyMDE",
			documentationUrl: "https://github.com/tao-xiaoxin/EasyMDE#readme",
			releasesUrl: "https://github.com/tao-xiaoxin/EasyMDE/releases",
			issuesUrl: "https://github.com/tao-xiaoxin/EasyMDE/issues",
			licenseUrl: "https://github.com/tao-xiaoxin/EasyMDE/blob/main/LICENSE",
		},
		drafts: {
			images: {
				domain: "https://img.example.test",
				backupDomain: "https://backup.example.test",
				primaryCredentialsConfigured: false,
				backupCredentialsConfigured: false,
			},
		},
		settings: SETTINGS_CENTER_TEST_SETTINGS,
		defaultSettings: SETTINGS_CENTER_DEFAULT_SETTINGS,
		reservedShortcuts: [],
		strings: Object.fromEntries(
			SETTINGS_CENTER_STRING_KEYS.map((key) => [key, key]),
		) as SettingsCenterBootstrap["strings"],
	};
}

describe("mountSettingsCenter", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		document.body.innerHTML = '<div id="easymde-settings-center-root"></div>';
		vi.mocked(parseSettingsCenterBootstrap).mockReturnValue(bootstrap());
	});

	it("waits for a head-parsed root and mounts it exactly once", async () => {
		document.body.innerHTML = "";
		const render = vi.fn();
		const unmount = vi.fn();
		vi.mocked(createRoot).mockReturnValue({ render, unmount } as never);

		const teardown = startSettingsCenter({}, { document, window });

		expect(createRoot).not.toHaveBeenCalled();
		const container = document.createElement("div");
		container.id = "easymde-settings-center-root";
		document.body.append(container);
		await Promise.resolve();

		expect(createRoot).toHaveBeenCalledOnce();
		expect(flushSync).toHaveBeenCalledOnce();
		document.body.append(document.createElement("div"));
		await Promise.resolve();
		expect(createRoot).toHaveBeenCalledOnce();

		teardown();
		teardown();
		expect(unmount).toHaveBeenCalledOnce();
	});

	it("mounts one independent root and returns idempotent teardown", () => {
		const calls: string[] = [];
		const render = vi.fn(() => calls.push("render"));
		const unmount = vi.fn();
		vi.mocked(createRoot).mockReturnValue({ render, unmount } as never);
		vi.mocked(flushSync).mockImplementation((callback) => {
			calls.push("flush:start");
			const result = callback();
			calls.push("flush:end");
			return result;
		});

		const teardown = mountSettingsCenter({}, { document, window });
		const overlayRoot = document.querySelector<HTMLDivElement>(
			"[data-settings-overlay-root]",
		);

		expect(parseSettingsCenterBootstrap).toHaveBeenCalledWith({});
		expect(createRoot).toHaveBeenCalledWith(
			document.querySelector("#easymde-settings-center-root"),
		);
		expect(render).toHaveBeenCalledOnce();
		expect(overlayRoot).not.toBeNull();
		expect(flushSync).toHaveBeenCalledOnce();
		expect(calls).toEqual(["flush:start", "render", "flush:end"]);
		teardown();
		teardown();
		expect(unmount).toHaveBeenCalledOnce();
		expect(overlayRoot?.isConnected).toBe(false);
	});

	it("unmounts a created root when the synchronous commit fails", () => {
		const render = vi.fn(() => {
			throw new Error("settings-center-render-failed");
		});
		const unmount = vi.fn();
		vi.mocked(createRoot).mockReturnValue({ render, unmount } as never);

		expect(() => mountSettingsCenter({}, { document, window })).toThrow(
			"settings-center-render-failed",
		);
		expect(unmount).toHaveBeenCalledOnce();
		expect(document.querySelector("[data-settings-overlay-root]")).toBeNull();
	});

	it("replaces the single server fallback when startup fails", () => {
		const fallback = document.createElement("div");
		fallback.setAttribute("data-settings-center-server-fallback", "");
		document.body.prepend(fallback);
		const render = vi.fn(() => {
			throw new Error("settings-center-render-failed");
		});
		const unmount = vi.fn();
		vi.mocked(createRoot).mockReturnValue({ render, unmount } as never);

		startSettingsCenter({}, { document, window });

		expect(unmount).toHaveBeenCalledOnce();
		expect(
			document.querySelector("[data-settings-center-server-fallback]"),
		).toBeNull();
		expect(document.querySelector('[role="alert"]')).not.toBeNull();
	});

	it("accepts only an empty server root", () => {
		const container = document.querySelector<HTMLElement>(
			"#easymde-settings-center-root",
		);
		if (!container) throw new Error("settings-center-root-missing");
		container.innerHTML = `
			<div data-settings-center-startup>
				<strong>EasyMDE Settings Center</strong>
			</div>
    `;

		expect(() => mountSettingsCenter({}, { document, window })).toThrow(
			"settings-center-root-not-empty",
		);
		expect(createRoot).not.toHaveBeenCalled();
	});

	it("rejects unexpected pre-existing root content", () => {
		const container = document.querySelector<HTMLElement>(
			"#easymde-settings-center-root",
		);
		if (!container) throw new Error("settings-center-root-missing");
		container.innerHTML = "<div data-unexpected-content></div>";

		expect(() => mountSettingsCenter({}, { document, window })).toThrow(
			"settings-center-root-not-empty",
		);
		expect(createRoot).not.toHaveBeenCalled();
	});

	it("rejects cross-origin navigation", () => {
		vi.mocked(parseSettingsCenterBootstrap).mockReturnValue({
			...bootstrap(),
			closeUrl: "https://invalid.test/wp-admin/options-general.php",
		});

		expect(() => mountSettingsCenter({}, { document, window })).toThrow(
			"settings-center-url-origin-invalid",
		);
		expect(createRoot).not.toHaveBeenCalled();
	});

	it("accepts WordPress asset URLs served from a configured content origin", () => {
		const render = vi.fn();
		vi.mocked(createRoot).mockReturnValue({
			render,
			unmount: vi.fn(),
		} as never);
		vi.mocked(parseSettingsCenterBootstrap).mockReturnValue({
			...bootstrap(),
			assets: {
				brandMarkUrl: "https://static.example.test/plugin/brand.png",
				headerIllustrationUrl: "https://static.example.test/plugin/header.png",
				searchEmptyIllustrationUrl:
					"https://static.example.test/plugin/search-empty.png",
			},
		});

		expect(() => mountSettingsCenter({}, { document, window })).not.toThrow();
		expect(render).toHaveBeenCalledOnce();
	});

	it("shows a visible startup failure without exposing the raw error", () => {
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);
		const root = document.querySelector<HTMLElement>(
			"#easymde-settings-center-root",
		);
		try {
			if (!root) throw new Error("settings-center-root-missing");

			showSettingsCenterStartupFailure(
				root,
				"The EasyMDE settings center could not start. WordPress settings remain available.",
				"settings-center-startup-failed",
				`${window.location.origin}/wp-admin/options-general.php`,
			);

			expect(root.textContent).toContain(
				"The EasyMDE settings center could not start. WordPress settings remain available.",
			);
			expect(root.querySelector('[role="alert"]')).not.toBeNull();
			const exit = root.querySelector<HTMLAnchorElement>("a");
			expect(exit).not.toBeNull();
			expect(exit?.href).toBe(
				`${window.location.origin}/wp-admin/options-general.php`,
			);
			expect(consoleError).toHaveBeenCalledWith(
				"[EasyMDE] settings-center-startup-failed",
			);
			expect(root.textContent).not.toContain("private-error-details");
		} finally {
			consoleError.mockRestore();
		}
	});
});
