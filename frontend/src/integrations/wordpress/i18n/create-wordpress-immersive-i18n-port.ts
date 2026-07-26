import { _n, sprintf } from "@wordpress/i18n";

import type { ImmersiveI18nPort } from "../../../contracts/ports/immersive-i18n-port";

type WordPressI18n = Readonly<{
	_n: typeof _n;
	sprintf: typeof sprintf;
}>;

function numberFormatter(locale: string): Intl.NumberFormat {
	const candidate = locale.replace("_", "-");
	try {
		if (0 !== Intl.NumberFormat.supportedLocalesOf(candidate).length) {
			return new Intl.NumberFormat(candidate);
		}
	} catch {
		// The stable error code is part of the adapter boundary.
	}
	throw new Error("wordpress-immersive-i18n-locale-invalid");
}

export function createWordPressImmersiveI18nPort({
	i18n = { _n, sprintf },
	locale,
}: Readonly<{
	i18n?: WordPressI18n;
	locale: string;
}>): ImmersiveI18nPort {
	const numbers = numberFormatter(locale);
	const format = (message: string, count: number): string =>
		i18n.sprintf(message, numbers.format(count));

	return {
		characters: (count) => {
			const message =
				/* translators: %s: Locale-formatted character count. */
				i18n._n("%s character", "%s characters", count, "easymde");
			return format(message, count);
		},
		readingTime: (minutes) => {
			const message =
				/* translators: %s: Locale-formatted estimated reading time in minutes. */
				i18n._n("About %s minute", "About %s minutes", minutes, "easymde");
			return format(message, minutes);
		},
		revisions: (count) => {
			const message =
				/* translators: %s: Locale-formatted revision count. */
				i18n._n("%s revision", "%s revisions", count, "easymde");
			return format(message, count);
		},
		words: (count) => {
			/* translators: %s: Locale-formatted word count. */
			return format(i18n._n("%s word", "%s words", count, "easymde"), count);
		},
	};
}
