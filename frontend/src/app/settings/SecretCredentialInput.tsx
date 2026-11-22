import { createElement, useEffect, useRef, useState } from "@wordpress/element";
import type {
	ImageHostingSecretField,
	ImageHostingSecretRevealPort,
} from "../../contracts/ports/image-hosting-secret-reveal-port";
import type { ImageHostingTarget } from "../../contracts/ports/image-hosting-verification-port";
import { Eye, Info, RefreshCcw } from "../../generated/lucide-icons";

export function SecretCredentialInput({
	configured,
	field,
	hideLabel,
	label,
	onChange,
	revealFailedLabel,
	revealPort,
	revealingLabel,
	revision,
	showLabel,
	target,
	value,
}: {
	configured: boolean;
	field: ImageHostingSecretField;
	hideLabel: string;
	label: string;
	onChange: (value: string) => void;
	revealFailedLabel: string;
	revealPort: ImageHostingSecretRevealPort | undefined;
	revealingLabel: string;
	revision: number;
	showLabel: string;
	target: ImageHostingTarget;
	value: string;
}) {
	const [visible, setVisible] = useState(false);
	const [revealedValue, setRevealedValue] = useState<string | null>(null);
	const [revealStatus, setRevealStatus] = useState<
		"idle" | "loading" | "error"
	>("idle");
	const revealAbortRef = useRef<AbortController | null>(null);
	const canReveal = configured && Boolean(revealPort);
	const displayValue = revealedValue ?? value;
	useEffect(() => {
		if (!canReveal) setVisible(false);
	}, [canReveal]);
	useEffect(() => {
		setRevealedValue(null);
		setVisible(false);
		setRevealStatus("idle");
		revealAbortRef.current?.abort();
	}, [configured, field, revision, target, value]);
	useEffect(
		() => () => {
			revealAbortRef.current?.abort();
		},
		[],
	);

	async function toggleVisibility() {
		if (revealedValue !== null) {
			setRevealedValue(null);
			setVisible(false);
			return;
		}
		if (value) {
			setVisible((current) => !current);
			return;
		}
		if (!configured || !revealPort || revealStatus === "loading") return;
		const controller = new AbortController();
		revealAbortRef.current?.abort();
		revealAbortRef.current = controller;
		setRevealStatus("loading");
		try {
			const result = await revealPort.revealSecret({
				field,
				revision,
				signal: controller.signal,
				target,
			});
			if (controller.signal.aborted) return;
			setRevealedValue(result.value);
			setVisible(true);
			setRevealStatus("idle");
		} catch {
			if (controller.signal.aborted) return;
			setRevealStatus("error");
		} finally {
			if (revealAbortRef.current === controller) revealAbortRef.current = null;
		}
	}
	return (
		<div className="easymde-settings-center__secret-field">
			<div className="easymde-settings-center__secret-input">
				<input
					aria-label={label}
					placeholder={configured && !value ? "••••••••••••" : undefined}
					readOnly={revealedValue !== null}
					type={displayValue && visible ? "text" : "password"}
					value={displayValue}
					onChange={(event) => {
						setRevealedValue(null);
						setVisible(false);
						setRevealStatus("idle");
						onChange(event.target.value);
					}}
				/>
				{canReveal ? (
					<button
						type="button"
						aria-label={
							revealStatus === "loading"
								? revealingLabel
								: visible
									? hideLabel
									: showLabel
						}
						disabled={revealStatus === "loading"}
						onClick={() => void toggleVisibility()}
					>
						{revealStatus === "loading" ? (
							<RefreshCcw
								size={17}
								className="easymde-settings-center__verification-spinner"
							/>
						) : (
							<Eye size={18} />
						)}
					</button>
				) : null}
			</div>
			{revealStatus === "error" ? (
				<div className="easymde-settings-center__credential-error" role="alert">
					<Info size={15} />
					<span>{revealFailedLabel}</span>
				</div>
			) : null}
		</div>
	);
}
