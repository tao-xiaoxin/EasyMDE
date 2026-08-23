import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement, useState } from "@wordpress/element";
import { describe, expect, it, vi } from "vitest";

import {
	SETTINGS_CENTER_STRING_KEYS,
	type SettingsCenterBootstrap,
} from "../../contracts/bootstrap/settings-center-bootstrap";
import type { ImageConnectionTestPort } from "../../contracts/ports/image-hosting-connection-port";
import type { ImageSettings } from "../../contracts/settings-center-settings";
import { SETTINGS_CENTER_TEST_SETTINGS } from "../../test/settings-center-settings-fixture";
import {
	type ImageRuntimeCapabilities,
	ImagesSettingsPage,
} from "./ImagesSettingsPage";

const strings = Object.fromEntries(
	SETTINGS_CENTER_STRING_KEYS.map((key) => [key, key]),
) as unknown as SettingsCenterBootstrap["strings"];

function settings(overrides: Partial<ImageSettings> = {}): ImageSettings {
	return {
		...SETTINGS_CENTER_TEST_SETTINGS.images,
		destination: "remote",
		accountId: "example-account",
		...overrides,
	};
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
}

function Harness({
	connectionTestDisabled,
	connectionTestPort,
	initialSettings = settings(),
	overlayRoot = null,
	runtimeCapabilities,
}: {
	connectionTestDisabled?: boolean;
	connectionTestPort?: ImageConnectionTestPort;
	initialSettings?: ImageSettings;
	overlayRoot?: HTMLDivElement | null;
	runtimeCapabilities?: ImageRuntimeCapabilities;
}) {
	const [current, setCurrent] = useState(initialSettings);
	return (
		<ImagesSettingsPage
			{...(connectionTestDisabled ? { connectionTestDisabled } : {})}
			{...(connectionTestPort ? { connectionTestPort } : {})}
			draft={{
				domain: "https://images.example.test",
				backupDomain: "https://backup.example.test",
				primaryCredentialsConfigured: false,
				backupCredentialsConfigured: false,
			}}
			onChange={setCurrent}
			overlayRoot={overlayRoot}
			settings={current}
			strings={strings}
			{...(runtimeCapabilities ? { runtimeCapabilities } : {})}
		/>
	);
}

describe("ImagesSettingsPage", () => {
	it("keeps unsupported providers visible but unavailable", () => {
		render(<Harness />);
		const primary = screen.getByRole<HTMLSelectElement>("combobox", {
			name: "selectImageHostService",
		});
		const backup = screen.getByRole<HTMLSelectElement>("combobox", {
			name: "backupImageHostService",
		});

		expect(
			within(primary).getByRole<HTMLOptionElement>("option", {
				name: "aliyunOss",
			}).disabled,
		).toBe(true);
		expect(
			within(backup).getByRole<HTMLOptionElement>("option", {
				name: "cloudflareR2",
			}).disabled,
		).toBe(true);
		expect(
			screen
				.getByRole("combobox", { name: "retryFailedUpload" })
				.matches(":disabled"),
		).toBe(true);
		expect(
			screen.getByRole("switch", { name: "copyImageUrl" }).matches(":disabled"),
		).toBe(true);
		expect(
			screen
				.getByRole("switch", { name: "insertMarkdownAfterUpload" })
				.matches(":disabled"),
		).toBe(true);
		expect(
			screen
				.getByRole("switch", { name: "compressImages" })
				.matches(":disabled"),
		).toBe(true);
		expect(
			screen
				.getByRole("switch", { name: "preserveOriginalFileName" })
				.matches(":disabled"),
		).toBe(true);
		expect(
			screen
				.getByRole("combobox", { name: "maximumImageSize" })
				.matches(":disabled"),
		).toBe(true);
		expect(
			screen
				.getByRole("switch", { name: "keepSameObjectPath" })
				.matches(":disabled"),
		).toBe(true);
		expect(
			screen
				.getByRole("combobox", { name: "backupFailureHandling" })
				.matches(":disabled"),
		).toBe(true);
	});

	it("enables only explicitly runtime-backed upload behaviors", () => {
		render(
			<Harness
				runtimeCapabilities={{
					compressImages: true,
					insertAfterUpload: true,
					preserveOriginalFileName: true,
					maximumImageSize: true,
				}}
			/>,
		);

		expect(
			screen
				.getByRole("switch", { name: "compressImages" })
				.matches(":disabled"),
		).toBe(false);
		expect(
			screen
				.getByRole("switch", { name: "preserveOriginalFileName" })
				.matches(":disabled"),
		).toBe(false);
		expect(
			screen
				.getByRole("combobox", { name: "maximumImageSize" })
				.matches(":disabled"),
		).toBe(false);
		expect(
			screen
				.getByRole("switch", { name: "insertMarkdownAfterUpload" })
				.matches(":disabled"),
		).toBe(false);
	});

	it("renders a real filename example and restores the caret after inserting a token", async () => {
		const user = userEvent.setup();
		render(<Harness />);
		const input = screen.getByRole<HTMLInputElement>("textbox", {
			name: "fileNameRule",
		});

		expect(screen.getByText("20260713/a8f4c2d1.webp")).not.toBeNull();
		await user.clear(input);
		await user.type(input, "folder/.webp");
		input.setSelectionRange(7, 7);
		await user.click(
			screen.getByRole("button", {
				name: "insertFileNameVariable {uuid}",
			}),
		);

		expect(input.value).toBe("folder/{uuid}.webp");
		expect(input.selectionStart).toBe(13);
		expect(input.selectionEnd).toBe(13);
	});

	it("conditionally removes backup fields when backup upload is disabled", async () => {
		const user = userEvent.setup();
		render(<Harness />);

		await user.click(
			screen.getByRole("switch", { name: "enableBackupImageHost" }),
		);

		expect(screen.queryByRole("textbox", { name: "backupBucket" })).toBeNull();
	});

	it("rejects disabling the final upload format and reports the constraint", async () => {
		const overlayRoot = document.createElement("div");
		document.body.append(overlayRoot);
		const user = userEvent.setup();
		render(
			<Harness
				overlayRoot={overlayRoot}
				initialSettings={settings({
					uploadFormats: { jpg: true, png: false, webp: false, gif: false },
				})}
			/>,
		);

		await user.click(screen.getByRole("checkbox", { name: "allowUploadJpg" }));

		expect(screen.getByRole("alert").textContent).toContain(
			"uploadFormatRequired",
		);
		expect(
			screen.getByRole<HTMLInputElement>("checkbox", {
				name: "allowUploadJpg",
			}).checked,
		).toBe(true);
		overlayRoot.remove();
	});

	it("shows testing only while the real port is pending and invalidates a successful result after edits", async () => {
		const request = deferred<Readonly<{ testedAt: string }>>();
		const testConnection = vi.fn(() => request.promise);
		const user = userEvent.setup();
		render(<Harness connectionTestPort={{ testConnection }} />);

		expect(screen.getAllByRole("status")[0]?.textContent).toBe(
			"connectionPending",
		);
		await user.click(
			screen.getByRole("button", { name: "testPrimaryConnection" }),
		);
		expect(screen.getAllByRole("status")[0]?.textContent).toBe(
			"testingConnection",
		);
		expect(testConnection).toHaveBeenCalledTimes(1);

		await act(async () => {
			request.resolve({ testedAt: "2026-08-23 08:00" });
			await request.promise;
		});
		expect(screen.getAllByRole("status")[0]?.textContent).toBe("connected");
		expect(screen.getByText("2026-08-23 08:00")).not.toBeNull();

		await user.type(
			screen.getByRole("textbox", { name: "r2AccountId" }),
			"-changed",
		);
		expect(screen.getAllByRole("status")[0]?.textContent).toBe(
			"connectionStale",
		);
	});

	it("reports a rejected connection without exposing the provider error", async () => {
		const testConnection = vi.fn(() => Promise.reject(new Error("private")));
		const user = userEvent.setup();
		render(<Harness connectionTestPort={{ testConnection }} />);

		await user.click(
			screen.getByRole("button", { name: "testPrimaryConnection" }),
		);

		expect(await screen.findByText("connectionFailed")).not.toBeNull();
		expect(screen.queryByText("private")).toBeNull();
	});

	it("keeps status visible while disabling tests for unsaved settings", () => {
		const testConnection = vi.fn();
		render(
			<Harness
				connectionTestDisabled
				connectionTestPort={{ testConnection }}
			/>,
		);

		expect(screen.getAllByRole("status")[0]?.textContent).toBe(
			"connectionPending",
		);
		expect(
			screen
				.getByRole("button", { name: "testPrimaryConnection" })
				.matches(":disabled"),
		).toBe(true);
		expect(testConnection).not.toHaveBeenCalled();
	});
});
