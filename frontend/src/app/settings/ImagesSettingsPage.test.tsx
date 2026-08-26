import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement, useState } from "@wordpress/element";
import { describe, expect, it, vi } from "vitest";

import {
	SETTINGS_CENTER_STRING_KEYS,
	type SettingsCenterBootstrap,
} from "../../contracts/bootstrap/settings-center-bootstrap";
import type { ImageHostingSecretRevealPort } from "../../contracts/ports/image-hosting-secret-reveal-port";
import type { ImageUploadVerificationPort } from "../../contracts/ports/image-hosting-verification-port";
import type { ImageSettings } from "../../contracts/settings-center-settings";
import { SETTINGS_CENTER_TEST_SETTINGS } from "../../test/settings-center-settings-fixture";
import {
	hasDuplicateImageHostConfiguration,
	type ImageRuntimeCapabilities,
	ImagesSettingsPage,
} from "./ImagesSettingsPage";

const strings = Object.fromEntries(
	SETTINGS_CENTER_STRING_KEYS.map((key) => [key, key]),
) as unknown as SettingsCenterBootstrap["strings"];

function settings(overrides: Partial<ImageSettings> = {}): ImageSettings {
	return {
		...SETTINGS_CENTER_TEST_SETTINGS.images,
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
	verificationInvalidationTokens,
	uploadVerificationDisabled,
	uploadVerificationPort,
	initialSettings = settings(),
	onSettingsChange,
	overlayRoot = null,
	primaryCredentialsConfigured = false,
	runtimeCapabilities,
	secretRevealPort,
}: {
	verificationInvalidationTokens?: Readonly<{
		primary: number;
		backup: number;
	}>;
	uploadVerificationDisabled?: boolean;
	uploadVerificationPort?: ImageUploadVerificationPort;
	initialSettings?: ImageSettings;
	onSettingsChange?: (settings: ImageSettings) => void;
	overlayRoot?: HTMLDivElement | null;
	primaryCredentialsConfigured?: boolean;
	runtimeCapabilities?: ImageRuntimeCapabilities;
	secretRevealPort?: ImageHostingSecretRevealPort;
}) {
	const [current, setCurrent] = useState(initialSettings);
	const handleChange = (next: ImageSettings) => {
		onSettingsChange?.(next);
		setCurrent(next);
	};
	return (
		<ImagesSettingsPage
			brandMarkUrl="/plugin/brand.png"
			{...(verificationInvalidationTokens
				? { verificationInvalidationTokens }
				: {})}
			{...(uploadVerificationDisabled ? { uploadVerificationDisabled } : {})}
			{...(uploadVerificationPort ? { uploadVerificationPort } : {})}
			draft={{
				domain: "https://images.example.test",
				backupDomain: "https://backup.example.test",
				primaryCredentialsConfigured,
				backupCredentialsConfigured: false,
			}}
			onChange={handleChange}
			overlayRoot={overlayRoot}
			settings={current}
			settingsRevision={SETTINGS_CENTER_TEST_SETTINGS.revision}
			strings={strings}
			uploadLimits={{ systemMaxBytes: 8 * 1024 * 1024 }}
			{...(secretRevealPort ? { secretRevealPort } : {})}
			{...(runtimeCapabilities ? { runtimeCapabilities } : {})}
		/>
	);
}

describe("ImagesSettingsPage", () => {
	it("updates automatic pasted-image uploading independently of upload capabilities", async () => {
		const user = userEvent.setup();
		const onSettingsChange = vi.fn();
		render(<Harness onSettingsChange={onSettingsChange} />);
		const toggle = screen.getByRole("switch", {
			name: "autoUploadPastedImages",
		});

		expect(toggle.getAttribute("aria-checked")).toBe("true");
		expect(toggle.matches(":disabled")).toBe(false);
		await user.click(toggle);
		expect(onSettingsChange).toHaveBeenLastCalledWith(
			expect.objectContaining({ autoUploadPastedImages: false }),
		);
		expect(toggle.getAttribute("aria-checked")).toBe("false");
	});

	it("does not render an upload destination control that is absent from the reference UI", () => {
		render(<Harness />);

		expect(
			screen.queryByRole("combobox", { name: "uploadDestination" }),
		).toBeNull();
		expect(screen.queryByText("uploadDestination")).toBeNull();
	});

	it("offers every implemented provider for primary and backup storage", async () => {
		const user = userEvent.setup();
		render(<Harness />);
		const primary = screen.getByRole<HTMLButtonElement>("combobox", {
			name: "selectImageHostService",
		});
		const backup = screen.getByRole<HTMLButtonElement>("combobox", {
			name: "backupImageHostService",
		});
		await user.click(primary);
		expect(screen.queryByRole("option", { name: "customUpload" })).toBeNull();
		expect(
			screen
				.getByRole("option", { name: "aliyunOss" })
				.getAttribute("aria-disabled"),
		).not.toBe("true");
		await user.click(backup);
		expect(screen.queryByRole("option", { name: "customUpload" })).toBeNull();
		expect(
			screen
				.getByRole("option", { name: "cloudflareR2" })
				.getAttribute("aria-disabled"),
		).not.toBe("true");
		expect(
			screen.queryByRole("combobox", { name: "retryFailedUpload" }),
		).toBeNull();
		expect(
			screen
				.getByRole("switch", { name: "compressImages" })
				.matches(":disabled"),
		).toBe(true);
		expect(
			screen.getByRole("spinbutton", { name: "maximumImageSize" }),
		).not.toBeNull();
		expect(
			screen.queryByRole("switch", { name: "keepSameObjectPath" }),
		).toBeNull();
		expect(
			screen.queryByRole("combobox", { name: "backupFailureHandling" }),
		).toBeNull();
		expect(
			screen.queryByRole("spinbutton", { name: "retryFailedUpload" }),
		).toBeNull();
		expect(
			screen.getByRole("spinbutton", { name: "uploadRetryCount" }),
		).not.toBeNull();
	});

	it("updates the bounded upload retry count through a horizontal stepper", async () => {
		const user = userEvent.setup();
		const onSettingsChange = vi.fn();
		render(<Harness onSettingsChange={onSettingsChange} />);
		const input = screen.getByRole<HTMLInputElement>("spinbutton", {
			name: "uploadRetryCount",
		});
		const decrement = screen.getByRole<HTMLButtonElement>("button", {
			name: "uploadRetryCount - 1",
		});
		const increment = screen.getByRole<HTMLButtonElement>("button", {
			name: "uploadRetryCount + 1",
		});

		expect(input.min).toBe("0");
		expect(input.max).toBe("5");
		expect(input.step).toBe("1");
		expect(input.value).toBe("0");
		expect(decrement.disabled).toBe(true);
		expect(increment.disabled).toBe(false);
		await user.click(increment);
		expect(input.value).toBe("1");
		expect(decrement.disabled).toBe(false);
		await user.click(decrement);
		expect(input.value).toBe("0");
		fireEvent.change(input, { target: { value: "5" } });
		expect(onSettingsChange).toHaveBeenLastCalledWith(
			expect.objectContaining({ uploadRetryCount: 5 }),
		);
		expect(increment.disabled).toBe(true);
	});

	it("restores the authoritative retry count after invalid direct input", () => {
		render(<Harness initialSettings={settings({ uploadRetryCount: 3 })} />);
		const input = screen.getByRole<HTMLInputElement>("spinbutton", {
			name: "uploadRetryCount",
		});

		fireEvent.change(input, { target: { value: "" } });
		expect(input.value).toBe("3");
		fireEvent.change(input, { target: { value: "2.5" } });
		expect(input.value).toBe("3");
		fireEvent.change(input, { target: { value: "6" } });
		expect(input.value).toBe("3");
	});

	it("binds the custom endpoint and viewing domain labels to their distinct settings", async () => {
		const user = userEvent.setup();
		render(<Harness />);
		const primary = screen.getByRole<HTMLButtonElement>("combobox", {
			name: "selectImageHostService",
		});

		expect(
			screen.getByRole<HTMLInputElement>("textbox", { name: "customDomain" })
				.value,
		).toBe(SETTINGS_CENTER_TEST_SETTINGS.images.endpoint);
		expect(
			screen.getByRole<HTMLInputElement>("textbox", {
				name: "imageFallbackDomain",
			}).value,
		).toBe(SETTINGS_CENTER_TEST_SETTINGS.images.domain);
		expect(
			screen.queryByRole("textbox", { name: "providerApiEndpoint" }),
		).toBeNull();
		expect(screen.queryByText("imageFallbackDomainDescription")).toBeNull();
		expect(
			screen.getByRole("textbox", { name: "customDomain" }),
		).not.toBeNull();
		expect(
			screen.queryByRole("textbox", { name: "providerRegion" }),
		).toBeNull();
		expect(screen.queryByRole("textbox", { name: "r2AccountId" })).toBeNull();
		await user.click(primary);
		await user.click(screen.getByRole("option", { name: "aliyunOss" }));
		expect(
			screen.getByRole("textbox", { name: "customDomain" }),
		).not.toBeNull();
		expect(
			screen.queryByRole("textbox", { name: "providerRegion" }),
		).toBeNull();

		await user.click(primary);
		await user.click(screen.getByRole("option", { name: "tencentCloudCos" }));
		expect(
			screen.getByRole("textbox", { name: "customDomain" }),
		).not.toBeNull();
		expect(
			screen.queryByRole("textbox", { name: "providerRegion" }),
		).toBeNull();

		await user.click(primary);
		await user.click(screen.getByRole("option", { name: "qiniuKodo" }));
		expect(
			screen.getByRole("textbox", { name: "imageFallbackDomain" }),
		).not.toBeNull();
		expect(screen.queryByRole("textbox", { name: "customDomain" })).toBeNull();
		expect(
			screen.queryByRole("textbox", { name: "providerRegion" }),
		).toBeNull();
	});

	it("does not treat an incomplete same-provider draft as a duplicate destination", () => {
		expect(
			hasDuplicateImageHostConfiguration(
				settings({
					backupService: "cloudflare-r2",
					backupEndpoint: "",
					backupBucket: SETTINGS_CENTER_TEST_SETTINGS.images.bucket,
					endpoint: "",
				}),
			),
		).toBe(false);
		expect(
			hasDuplicateImageHostConfiguration(
				settings({
					service: "aliyun-oss",
					endpoint: "",
					backupService: "aliyun-oss",
					backupEndpoint: "",
					backupBucket: SETTINGS_CENTER_TEST_SETTINGS.images.bucket,
				}),
			),
		).toBe(false);
	});

	it("treats OSS public and internal endpoints for one bucket as the same destination", () => {
		const imageSettings = settings({
			service: "aliyun-oss",
			endpoint: "https://oss-cn-hangzhou.aliyuncs.com",
			bucket: "same-bucket",
			backupEnabled: true,
			backupService: "aliyun-oss",
			backupEndpoint: "https://oss-cn-hangzhou-internal.aliyuncs.com",
			backupBucket: "same-bucket",
		});

		expect(hasDuplicateImageHostConfiguration(imageSettings)).toBe(true);
	});

	it("does not misreport distinct malformed endpoints as one destination", () => {
		expect(
			hasDuplicateImageHostConfiguration(
				settings({
					service: "aliyun-oss",
					endpoint: "foo",
					bucket: "same-bucket",
					backupEnabled: true,
					backupService: "aliyun-oss",
					backupEndpoint: "bar",
					backupBucket: "same-bucket",
				}),
			),
		).toBe(false);
	});

	it("shows the COS name-APPID bucket requirement for either target", async () => {
		const user = userEvent.setup();
		render(<Harness />);
		const primary = screen.getByRole<HTMLButtonElement>("combobox", {
			name: "selectImageHostService",
		});
		await user.click(primary);
		await user.click(screen.getByRole("option", { name: "tencentCloudCos" }));
		expect(screen.getByText("cosBucketHint")).not.toBeNull();
	});

	it("keeps compression capability-gated and exposes the supported upload settings", () => {
		render(
			<Harness
				runtimeCapabilities={{
					compressImages: true,
				}}
			/>,
		);

		expect(
			screen
				.getByRole("switch", { name: "compressImages" })
				.matches(":disabled"),
		).toBe(false);
		expect(
			screen.getByRole("spinbutton", { name: "maximumImageSize" }),
		).not.toBeNull();
		expect(
			screen.getByRole("combobox", { name: "imageTitleDisplay" }),
		).not.toBeNull();
	});

	it("removes redundant insertion, filename, clipboard, Alt, and featured-placeholder settings", () => {
		render(<Harness />);

		for (const label of [
			"insertMarkdownAfterUpload",
			"preserveOriginalFileName",
			"copyImageUrl",
			"defaultInsertFormat",
			"altTextSource",
			"imageFeaturedPlaceholder",
		]) {
			expect(screen.queryByLabelText(label)).toBeNull();
			expect(screen.queryByText(label)).toBeNull();
		}
		expect(
			screen.queryByRole("heading", { name: "defaultInsertion" }),
		).toBeNull();
	});

	it("updates the maximum supported image size in whole megabytes from 1 through 10", () => {
		const onSettingsChange = vi.fn();
		render(<Harness onSettingsChange={onSettingsChange} />);
		const input = screen.getByRole<HTMLInputElement>("spinbutton", {
			name: "maximumImageSize",
		});

		expect(input.value).toBe("5");
		expect(input.min).toBe("1");
		expect(input.max).toBe("10");
		expect(input.step).toBe("1");
		const valueCell = input.parentElement;
		const stepper = valueCell?.parentElement;
		expect(
			valueCell?.classList.contains(
				"easymde-settings-center__image-number-value",
			),
		).toBe(true);
		expect(valueCell?.textContent).toBe("M");
		expect(stepper?.children).toHaveLength(3);
		expect(stepper?.lastElementChild?.tagName).toBe("BUTTON");
		fireEvent.change(input, { target: { value: "7" } });
		expect(onSettingsChange).toHaveBeenLastCalledWith(
			expect.objectContaining({ maxImageSizeMb: 7 }),
		);
	});

	it("warns when the configured image size exceeds the current system upload limit", () => {
		render(
			<ImagesSettingsPage
				brandMarkUrl="/plugin/brand.png"
				draft={{
					domain: "",
					backupDomain: "",
					primaryCredentialsConfigured: false,
					backupCredentialsConfigured: false,
				}}
				overlayRoot={null}
				settings={settings({ maxImageSizeMb: 5 })}
				settingsRevision={0}
				strings={strings}
				uploadLimits={{ systemMaxBytes: 2 * 1024 * 1024 }}
			/>,
		);

		const warning = screen.getByRole("alert");
		expect(warning.className).toBe(
			"easymde-settings-center__image-size-warning",
		);
		expect(warning.querySelector("svg")).not.toBeNull();
		expect(warning.querySelector("svg circle")).not.toBeNull();
		expect(warning.querySelectorAll("svg line")).toHaveLength(2);
		expect(warning.textContent).toBe("maximumImageSizeSystemLimitExceeded");
	});

	it("places image-title display in Upload behavior where filename preservation was and supports filename or empty", async () => {
		const user = userEvent.setup();
		render(<Harness />);
		const uploadBehavior = screen
			.getByRole("heading", { name: "uploadBehavior" })
			.closest("section");
		const titleDisplay = screen.getByRole<HTMLButtonElement>("combobox", {
			name: "imageTitleDisplay",
		});

		expect(uploadBehavior).not.toBeNull();
		expect(
			within(uploadBehavior as HTMLElement).getByRole("combobox", {
				name: "imageTitleDisplay",
			}),
		).toBe(titleDisplay);
		await user.click(titleDisplay);
		expect(screen.getByRole("option", { name: "useFileName" })).not.toBeNull();
		expect(screen.getByRole("option", { name: "leaveEmpty" })).not.toBeNull();
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
		expect(
			screen.getByRole("spinbutton", { name: "uploadRetryCount" }),
		).not.toBeNull();
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

	it("shows verification while the upload is pending, then reports the authoritative path in a focus-managed dialog", async () => {
		const overlayRoot = document.createElement("div");
		document.body.append(overlayRoot);
		const request = deferred<Readonly<{ path: string; url: string }>>();
		const verifyUpload = vi.fn(() => request.promise);
		const user = userEvent.setup();
		render(
			<Harness
				overlayRoot={overlayRoot}
				uploadVerificationPort={{ verifyUpload }}
			/>,
		);

		expect(screen.getAllByRole("status")[0]?.textContent).toBe(
			"uploadVerificationPending",
		);
		const connectionButton = screen.getByRole("button", {
			name: "verifyPrimaryUpload",
		});
		await user.click(connectionButton);
		expect(screen.getAllByRole("status")[0]?.textContent).toBe(
			"verifyingUpload",
		);
		expect(
			screen
				.getByRole("button", { name: "verifyingUpload" })
				.matches(":disabled"),
		).toBe(true);
		fireEvent.click(screen.getByRole("button", { name: "verifyingUpload" }));
		expect(verifyUpload).toHaveBeenCalledTimes(1);

		await act(async () => {
			request.resolve({
				path: "verification/easymde.ico",
				url: "https://images.example.test/verification/easymde.ico",
			});
			await request.promise;
		});
		expect(screen.getAllByRole("status")[0]?.textContent).toBe(
			"uploadVerified",
		);
		const dialog = within(overlayRoot).getByRole("dialog", {
			name: "uploadVerificationSucceeded",
		});
		expect(dialog.getAttribute("aria-describedby")).toBe(
			"easymde-upload-verification-description",
		);
		expect(
			within(dialog).getByText("uploadVerificationSuccessDescription"),
		).not.toBeNull();
		expect(dialog.querySelector("header img")).toBeNull();
		expect(dialog.querySelector("header .is-success > svg")).not.toBeNull();
		expect(dialog.querySelectorAll("dl > div")).toHaveLength(2);
		expect(within(dialog).getByText("verification/easymde.ico")).not.toBeNull();
		expect(
			within(dialog)
				.getByRole("link", {
					name: "https://images.example.test/verification/easymde.ico",
				})
				.getAttribute("href"),
		).toBe("https://images.example.test/verification/easymde.ico");
		expect(
			within(dialog)
				.getByRole("link", {
					name: "https://images.example.test/verification/easymde.ico",
				})
				.querySelector("svg")
				?.getAttribute("aria-hidden"),
		).toBe("true");
		const closeButtons = within(dialog).getAllByRole("button", {
			name: "closeImageFeedback",
		});
		const footerClose = dialog.querySelector("footer button");
		expect(closeButtons).toHaveLength(2);
		expect(footerClose).not.toBeNull();
		expect(document.activeElement).toBe(footerClose);
		await user.keyboard("{Escape}");
		await waitFor(() => expect(document.activeElement).toBe(connectionButton));
		expect(
			screen
				.getByRole("button", { name: "verifyPrimaryUpload" })
				.matches(":disabled"),
		).toBe(false);

		await user.clear(screen.getByRole("textbox", { name: "fileNameRule" }));
		await user.type(
			screen.getByRole("textbox", { name: "fileNameRule" }),
			"changed/{md5}.{ext}",
		);
		expect(screen.getAllByRole("status")[0]?.textContent).toBe(
			"uploadVerificationStale",
		);
		overlayRoot.remove();
	});

	it("warns when the authoritative viewing URL uses HTTP and restores focus after backdrop dismissal", async () => {
		const overlayRoot = document.createElement("div");
		document.body.append(overlayRoot);
		const user = userEvent.setup();
		render(
			<Harness
				overlayRoot={overlayRoot}
				uploadVerificationPort={{
					verifyUpload: async () => ({
						path: "verification/easymde.ico",
						url: "http://images.example.test/verification/easymde.ico",
					}),
				}}
			/>,
		);

		const trigger = screen.getByRole("button", { name: "verifyPrimaryUpload" });
		await user.click(trigger);
		const dialog = await within(overlayRoot).findByRole("dialog", {
			name: "uploadVerificationSucceeded",
		});
		expect(
			within(dialog).getByText("insecureViewingDomainWarning"),
		).not.toBeNull();
		const backdrop = overlayRoot.querySelector<HTMLButtonElement>(
			".easymde-settings-center__dialog-backdrop",
		);
		expect(backdrop).not.toBeNull();
		await user.click(backdrop as HTMLButtonElement);
		await waitFor(() => expect(document.activeElement).toBe(trigger));
		overlayRoot.remove();
	});

	it("closes upload feedback from the header action and restores the verification trigger", async () => {
		const overlayRoot = document.createElement("div");
		document.body.append(overlayRoot);
		const user = userEvent.setup();
		render(
			<Harness
				overlayRoot={overlayRoot}
				uploadVerificationPort={{
					verifyUpload: async () => ({
						path: "verification/easymde.ico",
						url: "https://images.example.test/verification/easymde.ico",
					}),
				}}
			/>,
		);

		const trigger = screen.getByRole("button", { name: "verifyPrimaryUpload" });
		await user.click(trigger);
		const dialog = await within(overlayRoot).findByRole("dialog", {
			name: "uploadVerificationSucceeded",
		});
		const headerClose =
			dialog.querySelector<HTMLButtonElement>("header button");
		expect(headerClose).not.toBeNull();
		await user.click(headerClose as HTMLButtonElement);
		await waitFor(() => expect(document.activeElement).toBe(trigger));
		overlayRoot.remove();
	});

	it("keeps a completed upload stale when the file-name rule changes in flight", async () => {
		const request = deferred<Readonly<{ path: string; url: string }>>();
		const user = userEvent.setup();
		render(
			<Harness
				uploadVerificationPort={{ verifyUpload: () => request.promise }}
			/>,
		);

		await user.click(
			screen.getByRole("button", { name: "verifyPrimaryUpload" }),
		);
		await user.clear(screen.getByRole("textbox", { name: "fileNameRule" }));
		await user.type(
			screen.getByRole("textbox", { name: "fileNameRule" }),
			"changed/{uuid}.{ext}",
		);
		await act(async () => {
			request.resolve({
				path: "verification/easymde.ico",
				url: "https://images.example.test/verification/easymde.ico",
			});
			await request.promise;
		});

		expect(screen.getAllByRole("status")[0]?.textContent).toBe(
			"uploadVerificationStale",
		);
	});

	it("blocks testing an identical enabled backup configuration in an accessible alert dialog", async () => {
		const overlayRoot = document.createElement("div");
		document.body.append(overlayRoot);
		const verifyUpload = vi.fn(async () => ({
			path: "verification/easymde.ico",
			url: "https://images.example.test/verification/easymde.ico",
		}));
		const user = userEvent.setup();
		render(
			<Harness
				overlayRoot={overlayRoot}
				uploadVerificationPort={{ verifyUpload }}
				initialSettings={settings({
					backupService: "cloudflare-r2",
					backupEndpoint: SETTINGS_CENTER_TEST_SETTINGS.images.endpoint,
					backupBucket: SETTINGS_CENTER_TEST_SETTINGS.images.bucket,
				})}
			/>,
		);

		const trigger = screen.getByRole("button", {
			name: "verifyPrimaryUpload",
		});
		await user.click(trigger);
		const dialog = within(overlayRoot).getByRole("alertdialog", {
			name: "duplicateImageHostTitle",
		});
		expect(
			within(dialog).getByText("duplicateImageHostDescription"),
		).not.toBeNull();
		expect(verifyUpload).not.toHaveBeenCalled();
		await user.keyboard("{Escape}");
		await waitFor(() => expect(document.activeElement).toBe(trigger));
		overlayRoot.remove();
	});

	it("allows the same provider when primary and backup buckets differ", async () => {
		const verifyUpload = vi.fn(async () => ({
			path: "verification/easymde.ico",
			url: "https://images.example.test/verification/easymde.ico",
		}));
		const user = userEvent.setup();
		render(
			<Harness
				uploadVerificationPort={{ verifyUpload }}
				initialSettings={settings({
					backupService: "cloudflare-r2",
					backupEndpoint: SETTINGS_CENTER_TEST_SETTINGS.images.endpoint,
					backupBucket: "different-bucket",
				})}
			/>,
		);

		await user.click(
			screen.getByRole("button", { name: "verifyPrimaryUpload" }),
		);
		expect(verifyUpload).toHaveBeenCalledTimes(1);
	});

	it("invalidates only the connection targeted by an authoritative save token", async () => {
		const verifyUpload = vi.fn(async () => ({
			path: "verification/easymde.ico",
			url: "https://images.example.test/verification/easymde.ico",
		}));
		const user = userEvent.setup();
		const { rerender } = render(
			<Harness
				verificationInvalidationTokens={{ primary: 0, backup: 0 }}
				uploadVerificationPort={{ verifyUpload }}
			/>,
		);

		await user.click(
			screen.getByRole("button", { name: "verifyPrimaryUpload" }),
		);
		await user.click(
			screen.getByRole("button", { name: "verifyBackupUpload" }),
		);
		expect(
			screen.getAllByRole("status").map((status) => status.textContent),
		).toEqual(["uploadVerified", "uploadVerified"]);

		rerender(
			<Harness
				verificationInvalidationTokens={{ primary: 1, backup: 0 }}
				uploadVerificationPort={{ verifyUpload }}
			/>,
		);

		expect(
			screen.getAllByRole("status").map((status) => status.textContent),
		).toEqual(["uploadVerificationStale", "uploadVerified"]);
	});

	it("invalidates both upload verifications when the primary viewing domain changes", async () => {
		const verifyUpload = vi.fn(async () => ({
			path: "verification/easymde.ico",
			url: "https://images.example.test/verification/easymde.ico",
		}));
		const user = userEvent.setup();
		render(<Harness uploadVerificationPort={{ verifyUpload }} />);

		await user.click(
			screen.getByRole("button", { name: "verifyPrimaryUpload" }),
		);
		await user.click(
			screen.getByRole("button", { name: "verifyBackupUpload" }),
		);
		expect(
			screen.getAllByRole("status").map((status) => status.textContent),
		).toEqual(["uploadVerified", "uploadVerified"]);

		const viewingDomain = screen.getByRole("textbox", {
			name: "imageFallbackDomain",
		});
		await user.clear(viewingDomain);
		await user.type(viewingDomain, "https://changed.example.test");

		expect(
			screen.getAllByRole("status").map((status) => status.textContent),
		).toEqual(["uploadVerificationStale", "uploadVerificationStale"]);
	});

	it("reports a rejected verification in a focus-managed dialog without exposing the provider error", async () => {
		const overlayRoot = document.createElement("div");
		document.body.append(overlayRoot);
		const verifyUpload = vi.fn(() => Promise.reject(new Error("private")));
		const user = userEvent.setup();
		render(
			<Harness
				overlayRoot={overlayRoot}
				uploadVerificationPort={{ verifyUpload }}
			/>,
		);

		const trigger = screen.getByRole("button", { name: "verifyPrimaryUpload" });
		await user.click(trigger);

		const dialog = await within(overlayRoot).findByRole("alertdialog", {
			name: "uploadVerificationFailed",
		});
		expect(dialog.getAttribute("aria-describedby")).toBe(
			"easymde-upload-verification-description",
		);
		expect(
			within(dialog).getByText("uploadVerificationFailureDescription"),
		).not.toBeNull();
		expect(
			within(dialog).getByText("uploadVerificationFailureHint"),
		).not.toBeNull();
		expect(dialog.querySelector("header .is-destructive > svg")).not.toBeNull();
		expect(screen.queryByText("private")).toBeNull();
		const footerClose =
			dialog.querySelector<HTMLButtonElement>("footer button");
		expect(footerClose).not.toBeNull();
		expect(document.activeElement).toBe(footerClose);
		await user.click(footerClose as HTMLButtonElement);
		await waitFor(() => expect(document.activeElement).toBe(trigger));
		overlayRoot.remove();
	});

	it("keeps an unconfigured credential as a plain password input", async () => {
		const user = userEvent.setup();
		render(<Harness />);
		const input = screen.getByLabelText<HTMLInputElement>("accessKey");

		expect(screen.queryByRole("button", { name: "showSecret" })).toBeNull();
		await user.type(input, "synthetic-current-draft");
		expect(input.type).toBe("password");
		expect(input.value).toBe("synthetic-current-draft");
		expect(screen.queryByRole("button", { name: "showSecret" })).toBeNull();
		expect(screen.queryByText("credentialsConfiguredHint")).toBeNull();
		expect(screen.queryByText("replaceCredentialsHint")).toBeNull();
	});

	it("reveals a configured secret on demand without copying it into the settings draft", async () => {
		const request = deferred<Readonly<{ value: string }>>();
		const revealSecret = vi.fn(() => request.promise);
		const onSettingsChange = vi.fn();
		const user = userEvent.setup();
		render(
			<Harness
				onSettingsChange={onSettingsChange}
				primaryCredentialsConfigured
				secretRevealPort={{ revealSecret }}
			/>,
		);
		const input = screen.getByLabelText<HTMLInputElement>("accessKey");

		expect(input.value).toBe("");
		expect(input.type).toBe("password");
		const reveal = screen.getAllByRole("button", { name: "showSecret" })[0];
		expect(reveal).toBeDefined();
		await user.click(reveal as HTMLButtonElement);
		expect(revealSecret).toHaveBeenCalledWith(
			expect.objectContaining({
				field: "accessKey",
				revision: SETTINGS_CENTER_TEST_SETTINGS.revision,
				target: "primary",
			}),
		);
		expect(
			screen
				.getAllByRole("button", { name: "revealingSecret" })[0]
				?.matches(":disabled"),
		).toBe(true);
		await act(async () => {
			request.resolve({ value: "synthetic-revealed-value" });
			await request.promise;
		});
		expect(input.value).toBe("synthetic-revealed-value");
		expect(input.type).toBe("text");
		expect(input.readOnly).toBe(true);
		expect(onSettingsChange).not.toHaveBeenCalled();
		const hide = screen.getAllByRole("button", { name: "hideSecret" })[0];
		expect(hide).toBeDefined();
		await user.click(hide as HTMLButtonElement);
		expect(input.value).toBe("");
		expect(input.type).toBe("password");
		expect(screen.queryByText("credentialsConfiguredHint")).toBeNull();
		expect(screen.queryByText("replaceCredentialsHint")).toBeNull();
	});

	it("aborts an in-flight configured-secret reveal when the page unmounts", async () => {
		const request = deferred<Readonly<{ value: string }>>();
		let signal: AbortSignal | undefined;
		const revealSecret = vi.fn((input) => {
			signal = input.signal;
			return request.promise;
		});
		const user = userEvent.setup();
		const view = render(
			<Harness
				primaryCredentialsConfigured
				secretRevealPort={{ revealSecret }}
			/>,
		);
		const reveal = screen.getAllByRole("button", { name: "showSecret" })[0];
		expect(reveal).toBeDefined();
		await user.click(reveal as HTMLButtonElement);
		expect(signal?.aborted).toBe(false);

		view.unmount();
		expect(signal?.aborted).toBe(true);
		request.resolve({ value: "synthetic-late-value" });
		await request.promise;
	});

	it("reports a configured-secret reveal failure without exposing the raw error", async () => {
		const revealSecret = vi.fn(() =>
			Promise.reject(new Error("private-secret")),
		);
		const user = userEvent.setup();
		render(
			<Harness
				primaryCredentialsConfigured
				secretRevealPort={{ revealSecret }}
			/>,
		);
		const reveal = screen.getAllByRole("button", { name: "showSecret" })[0];
		expect(reveal).toBeDefined();
		await user.click(reveal as HTMLButtonElement);
		expect((await screen.findByRole("alert")).textContent).toContain(
			"secretRevealFailed",
		);
		expect(screen.queryByText("private-secret")).toBeNull();
	});

	it("keeps status visible while disabling tests for unsaved settings", () => {
		const verifyUpload = vi.fn();
		render(
			<Harness
				uploadVerificationDisabled
				uploadVerificationPort={{ verifyUpload }}
			/>,
		);

		expect(screen.getAllByRole("status")[0]?.textContent).toBe(
			"uploadVerificationPending",
		);
		expect(
			screen
				.getByRole("button", { name: "verifyPrimaryUpload" })
				.matches(":disabled"),
		).toBe(true);
		expect(verifyUpload).not.toHaveBeenCalled();
	});
});
