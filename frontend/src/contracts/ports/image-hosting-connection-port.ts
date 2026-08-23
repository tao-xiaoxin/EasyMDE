import type { ImageSettings } from "../settings-center-settings";

export type ImageConnectionTarget = "primary" | "backup";

export type ImageConnectionTestPort = Readonly<{
	testConnection(request: {
		target: ImageConnectionTarget;
		settings: ImageSettings;
		signal: AbortSignal;
	}): Promise<Readonly<{ testedAt: string }>>;
}>;
