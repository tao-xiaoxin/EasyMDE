import { createElement, useRef } from "@wordpress/element";
import {
	CircleCheck,
	CircleX,
	Info,
	X,
} from "../../generated/lucide-icons";

export type SettingsFeedbackKind = "error" | "info" | "success";

export function SettingsFeedbackAlert({
	closeLabel,
	kind,
	message,
	onClose,
	onFocusChange,
}: {
	closeLabel: string;
	kind: SettingsFeedbackKind;
	message: string;
	onClose: () => void;
	onFocusChange?: (focused: boolean) => void;
}) {
	const returnFocusRef = useRef<HTMLElement | null>(null);
	const Icon =
		"success" === kind ? CircleCheck : "error" === kind ? CircleX : Info;

	return (
		<div
			className={`easymde-settings-center__transfer-feedback is-${kind}`}
			role={"error" === kind ? "alert" : "status"}
			aria-atomic="true"
		>
			<Icon size={19} aria-hidden="true" />
			<span>{message}</span>
			<button
				type="button"
				aria-label={closeLabel}
				onFocus={(event) => {
					returnFocusRef.current =
						event.relatedTarget instanceof HTMLElement
							? event.relatedTarget
							: null;
					onFocusChange?.(true);
				}}
				onBlur={() => onFocusChange?.(false)}
				onClick={() => {
					const returnTarget = returnFocusRef.current;
					onClose();
					if (returnTarget?.isConnected && !returnTarget.matches(":disabled")) {
						returnTarget.focus();
					}
				}}
			>
				<X size={16} aria-hidden="true" />
			</button>
		</div>
	);
}
