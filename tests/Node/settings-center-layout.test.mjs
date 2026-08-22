import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const settingsCss = readFileSync(
	join(repoRoot, "assets/css/admin/settings-center.css"),
	"utf8",
);
const settingsRootSource = readFileSync(
	join(repoRoot, "frontend/src/app/settings/SettingsCenterRoot.tsx"),
	"utf8",
);

function frameRuleBody() {
	const match = settingsCss.match(
		/\.easymde-settings-center__frame\s*\{([^}]*)\}/s,
	);

	assert.ok(match, "the Settings Center frame rule should exist");

	return match[1];
}

function headerTitleRuleBody() {
	const match = settingsCss.match(
		/\.easymde-settings-center__header-scale h1\s*\{([^}]*)\}/s,
	);

	assert.ok(match, "the Settings Center header title rule should exist");

	return match[1];
}

function cssRuleBody(selector) {
	const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = settingsCss.match(
		new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`, "s"),
	);

	assert.ok(match, `${selector} should exist`);

	return match[1];
}

test("Settings Center frame does not add an outer border, radius, or shadow", () => {
	const body = frameRuleBody();

	assert.doesNotMatch(body, /(?:^|;)\s*border\s*:/);
	assert.doesNotMatch(body, /(?:^|;)\s*border-radius\s*:/);
	assert.doesNotMatch(body, /(?:^|;)\s*box-shadow\s*:/);
});

test("Settings Center sidebar does not inherit frame-only corner rounding", () => {
	const sidebar = cssRuleBody(".easymde-settings-center__sidebar");

	assert.doesNotMatch(sidebar, /(?:^|;)\s*border-radius\s*:/);
});

test("Settings Center brand preserves the reference parent scale", () => {
	const brand = cssRuleBody(".easymde-settings-center__brand");
	const image = cssRuleBody(".easymde-settings-center__brand > img");
	const copy = cssRuleBody(".easymde-settings-center__brand > div");
	const title = cssRuleBody(".easymde-settings-center__brand strong");
	const subtitle = cssRuleBody(".easymde-settings-center__brand span");

	assert.match(brand, /\bheight:\s*72px;/);
	assert.match(brand, /\bgap:\s*16px;/);
	assert.match(brand, /\btranslate:\s*-4px;/);
	assert.match(brand, /\bscale:\s*\.73;/);
	assert.match(brand, /\btransform-origin:\s*top;/);
	assert.match(image, /\bwidth:\s*72px;/);
	assert.match(image, /\bheight:\s*60px;/);
	assert.match(image, /\bmargin-right:\s*4px;/);
	assert.match(image, /\btranslate:\s*-1px 3px;/);
	assert.match(copy, /\bpadding-top:\s*4px;/);
	assert.match(title, /\bfont-size:\s*33px;/);
	assert.match(title, /\bletter-spacing:\s*0;/);
	assert.match(title, /\bline-height:\s*34px;/);
	assert.match(subtitle, /\bmargin-top:\s*4px;/);
	assert.match(subtitle, /\bfont-size:\s*18px;/);
	assert.match(subtitle, /\bline-height:\s*20px;/);
	assert.match(subtitle, /\btranslate:\s*-1px 2px;/);
});

test("Settings Center header scale owns the reference 90 percent transform", () => {
	const scale = cssRuleBody(".easymde-settings-center__header-scale");

	assert.match(scale, /\bwidth:\s*111\.111111%;/);
	assert.match(scale, /\bscale:\s*\.9;/);
	assert.match(scale, /\btransform-origin:\s*top left;/);
});

test("Settings Center header and illustration preserve unscaled reference geometry", () => {
	const header = cssRuleBody(".easymde-settings-center__header-scale header");
	const illustration = cssRuleBody(
		".easymde-settings-center__header-scale header > img",
	);

	assert.match(header, /\bheight:\s*220px;/);
	assert.match(header, /\bpadding:\s*104px 37px 0;/);
	assert.match(illustration, /\bheight:\s*220px;/);
});

test("Settings Center close link preserves unscaled reference geometry", () => {
	const closeLink = cssRuleBody(
		".easymde-settings-center__header-scale header > a",
	);
	const closeIcon = cssRuleBody(
		".easymde-settings-center__header-scale header > a svg",
	);

	assert.match(closeLink, /\btop:\s*18px;/);
	assert.match(closeLink, /\bright:\s*18px;/);
	assert.match(closeLink, /\bwidth:\s*33\.75px;/);
	assert.match(closeLink, /\bheight:\s*33\.75px;/);
	assert.match(closeLink, /\bborder-radius:\s*5\.625px;/);
	assert.match(closeIcon, /\bwidth:\s*23px;/);
	assert.match(closeIcon, /\bheight:\s*23px;/);
});

test("Settings Center title preserves unscaled reference placement and type", () => {
	const titleWrap = cssRuleBody(
		".easymde-settings-center__header-scale header > div",
	);
	const title = headerTitleRuleBody();

	assert.match(titleWrap, /\btop:\s*104px;/);
	assert.match(titleWrap, /\bleft:\s*37px;/);
	assert.match(title, /\bpadding:\s*0;/);
	assert.match(title, /\bfont-size:\s*34px;/);
	assert.match(title, /\bline-height:\s*42px;/);
});

test("Settings Center header description preserves unscaled reference type", () => {
	const description = cssRuleBody(
		".easymde-settings-center__header-scale header p",
	);

	assert.match(description, /\bmargin-top:\s*8px;/);
	assert.match(description, /\bfont-size:\s*16px;/);
	assert.match(description, /\bline-height:\s*24px;/);
});

test("Settings Center search surface preserves unscaled reference geometry", () => {
	const search = cssRuleBody(".easymde-settings-center__search");
	const icon = cssRuleBody(".easymde-settings-center__search > svg");

	assert.match(search, /\bheight:\s*43px;/);
	assert.match(search, /\bmargin:\s*0 37px 0 34px;/);
	assert.match(icon, /\bleft:\s*20px;/);
	assert.match(icon, /\bwidth:\s*20px;/);
	assert.match(icon, /\bheight:\s*20px;/);
});

test("Settings Center section dividers and footer space match the reference", () => {
	assert.match(
		cssRuleBody(".easymde-settings-center__section"),
		/\bborder-bottom:\s*1px solid #e5e9ef;/,
	);
	assert.match(
		cssRuleBody(".easymde-settings-center__content"),
		/\bpadding:\s*0 37px 0 34px;/,
	);
	assert.match(
		cssRuleBody(".easymde-settings-center__content-footer-space"),
		/\bheight:\s*30px;/,
	);
	assert.match(
		settingsRootSource,
		/className="easymde-settings-center__content-footer-space"/,
	);
});

test("Settings Center General offsets remain stable through unavailable fieldsets", () => {
	assert.match(
		cssRuleBody(
			".easymde-settings-center__general-settings > .easymde-settings-center__section:first-child .easymde-settings-center__row-label",
		),
		/\btransform:\s*translateX\(-1px\);/,
	);
	assert.match(
		cssRuleBody(
			".easymde-settings-center__general-settings > .easymde-settings-center__section:first-child > .easymde-settings-center__section-body > .easymde-settings-center__row:last-child .easymde-settings-center__row-label",
		),
		/\btransform:\s*none;/,
	);
	assert.match(
		cssRuleBody(
			".easymde-settings-center__general-settings > .easymde-settings-center__section:nth-child(2) > .easymde-settings-center__section-body > .easymde-settings-center__row:nth-child(-n+2) .easymde-settings-center__row-label",
		),
		/\btransform:\s*translateX\(1px\);/,
	);
	assert.match(
		cssRuleBody(
			".easymde-settings-center__general-settings > .easymde-settings-center__unavailable-fields:nth-child(3) > .easymde-settings-center__section > h2 svg",
		),
		/\bmargin-left:\s*-1px;/,
	);
});

test("Settings Center unavailable Image and Markdown groups retain reference dividers", () => {
	assert.match(
		settingsCss,
		/\.easymde-settings-center__images-page\s*>\s*\.easymde-settings-center__unavailable-fields\s*>\s*:not\(:last-child\),\s*\.easymde-settings-center__image-secondary-groups\s*>\s*:not\(:last-child\)\s*\{/s,
	);
	assert.match(
		settingsCss,
		/\.easymde-settings-center__markdown-page\s*>\s*\.easymde-settings-center__unavailable-fields\s*>\s*\.easymde-settings-center__markdown-group:not\(:last-child\)\s*\{/s,
	);
});
