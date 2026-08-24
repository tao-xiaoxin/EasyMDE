import type { ImageHostingTarget } from "./image-hosting-verification-port";

export type ImageHostingSecretField = "accessKey" | "secretKey";

export type ImageHostingSecretRevealPort = Readonly<{
	revealSecret(request: {
		target: ImageHostingTarget;
		field: ImageHostingSecretField;
		revision: number;
		signal: AbortSignal;
	}): Promise<Readonly<{ value: string }>>;
}>;
