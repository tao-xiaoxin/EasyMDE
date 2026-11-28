import { randomUUID } from "node:crypto";
import { chmod, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { preparePrivateEvidenceDirectory } from "../private-evidence-directory.mjs";
import { evidenceDirectoryEnvironment } from "./environment.mjs";

export function privateEvidenceDirectory() {
	const configured = process.env[evidenceDirectoryEnvironment]?.trim();
	if (!configured) {
		throw new Error("wechat-copy-performance-evidence-directory-required");
	}
	if (!isAbsolute(configured)) {
		throw new Error("wechat-copy-performance-evidence-directory-not-absolute");
	}
	const target = resolve(configured);
	const tempRoot = resolve(tmpdir());
	const relation = relative(tempRoot, target);
	if (
		!relation ||
		relation === ".." ||
		relation.startsWith(`..${sep}`) ||
		isAbsolute(relation)
	) {
		throw new Error("wechat-copy-performance-evidence-directory-outside-temp");
	}
	return { target, tempRoot };
}

export async function writePrivateEvidence(testInfo, records) {
	const configured = privateEvidenceDirectory();
	const { realDirectory } = await preparePrivateEvidenceDirectory({
		errorCode: "wechat-copy-performance-evidence-directory-realpath-invalid",
		target: configured.target,
		tempRoot: configured.tempRoot,
	});
	await chmod(realDirectory, 0o700);
	const filePath = join(
		realDirectory,
		`wechat-copy-performance-${testInfo.workerIndex}-${randomUUID().slice(0, 8)}.json`,
	);
	await writeFile(filePath, `${JSON.stringify(records)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	await chmod(filePath, 0o600);
}

export function stableFailureCode(error) {
	const message = error instanceof Error ? error.message : "";
	if (/^wechat-copy-performance-[a-z0-9-]+$/u.test(message)) return message;
	if (/timeout/iu.test(message)) return "wechat-copy-performance-timeout";
	return "wechat-copy-performance-assertion-failed";
}

export async function readFailureSnapshot(page) {
	if (page.isClosed()) return { pageState: "closed" };
	try {
		return await page.evaluate(() => {
			const probe = globalThis.__easymdeWechatCopyPerformance;
			const state = probe?.getState?.();
			if (!state) return { pageState: "probe-unavailable" };
			return {
				clickCount: state.clickCount,
				ownerChanges: state.ownerChanges.map(
					({ at, state: ownerState, type }) => ({
						at,
						state: ownerState,
						type,
					}),
				),
				status: state.status.map(({ at, code }) => ({ at, code })),
				writeCount: state.writeCount,
				writes: state.writes.map(
					({ activation, at, nativeState, owner, settledAt }) => ({
						activation,
						at,
						nativeState,
						owner,
						settledAt,
					}),
				),
			};
		});
	} catch {
		return { pageState: "snapshot-unavailable" };
	}
}

export function unavailableUploadFacts() {
	return {
		clock: "page-performance-upload-failure-facts",
		observedCount: 0,
		peakInFlight: 0,
		unsettledCount: 0,
		uploads: [],
		state: "unavailable",
	};
}

export async function writeFailureSnapshot(
	testInfo,
	page,
	stage,
	code,
	uploadTimeline = null,
	uploadSnapshot = null,
) {
	await writePrivateEvidence(testInfo, {
		failure: {
			code,
			snapshot: await readFailureSnapshot(page),
			stage,
			uploadFacts:
				uploadSnapshot ??
				uploadTimeline?.failureFacts?.() ??
				unavailableUploadFacts(),
		},
	});
	testInfo.wechatPerformanceFailureSnapshotWritten = true;
}

export async function writePrivateArtifact(testInfo, stem, bytes, extension = "png") {
	const configured = privateEvidenceDirectory();
	const { realDirectory } = await preparePrivateEvidenceDirectory({
		errorCode: "wechat-copy-candidate-evidence-directory-invalid",
		target: configured.target,
		tempRoot: configured.tempRoot,
	});
	await chmod(realDirectory, 0o700);
	const fileName = `wechat-copy-candidate-${testInfo.workerIndex}-${stem}-${randomUUID().slice(0, 8)}.${extension}`;
	const filePath = join(realDirectory, fileName);
	await writeFile(filePath, bytes, { mode: 0o600 });
	await chmod(filePath, 0o600);
	return fileName;
}
