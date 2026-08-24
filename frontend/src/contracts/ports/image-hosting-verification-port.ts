import type { ImageSettings } from "../settings-center-settings";

export type ImageHostingTarget = "primary" | "backup";

export type ImageUploadVerificationResult = Readonly<{
	path: string;
	url: string;
}>;

export type ImageUploadVerificationPort = Readonly<{
	verifyUpload(request: {
		target: ImageHostingTarget;
		settings: ImageSettings;
		revision: number;
		signal: AbortSignal;
	}): Promise<ImageUploadVerificationResult>;
}>;
