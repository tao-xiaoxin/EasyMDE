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
const settingsControlsSource = readFileSync(
	join(repoRoot, "frontend/src/app/settings/SettingsControls.tsx"),
	"utf8",
);
const settingsTemplateSource = readFileSync(
	join(repoRoot, "templates/admin/settings-center.php"),
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

test("Settings Center does not paint an opaque pre-mount viewport veil", () => {
	assert.doesNotMatch(
		settingsCss,
		/body\.toplevel_page_easymde::before\s*\{/,
	);
	assert.doesNotMatch(
		settingsCss,
		/body\.toplevel_page_easymde #easymde-settings-center-root\s*\{/,
	);
});

test("Settings Center server fallback does not duplicate a brand-only application shell", () => {
	assert.doesNotMatch(
		settingsTemplateSource,
		/easymde-settings-center__frame|easymde-settings-center__sidebar|easymde-settings-center__brand-wrap|easymde-settings-center__brand/,
	);
	assert.doesNotMatch(settingsTemplateSource, /<noscript>/);
	assert.equal(
		(settingsTemplateSource.match(/data-settings-center-server-fallback/g) ?? [])
			.length,
		1,
	);
	assert.match(settingsTemplateSource, /settings_center_close_url/);
});

test("Settings Center frame does not add an outer border, radius, or shadow", () => {
	const body = frameRuleBody();

	assert.doesNotMatch(body, /(?:^|;)\s*border\s*:/);
	assert.doesNotMatch(body, /(?:^|;)\s*border-radius\s*:/);
	assert.doesNotMatch(body, /(?:^|;)\s*box-shadow\s*:/);
});

test("Settings Center selectors use one translucent white viewport-owned popup", () => {
	const listbox = cssRuleBody(".easymde-settings-center__select-listbox");
	const option = cssRuleBody(
		'.easymde-settings-center__select-listbox [role="option"]',
	);
	const activeOption = cssRuleBody(
		'.easymde-settings-center__select-listbox [role="option"][data-active="true"]',
	);

	assert.match(listbox, /position:\s*fixed;/);
	assert.match(listbox, /z-index:\s*100002;/);
	assert.match(listbox, /box-sizing:\s*border-box;/);
	assert.match(listbox, /padding:\s*4px;/);
	assert.match(listbox, /border-radius:\s*12px;/);
	assert.match(listbox, /background:\s*rgba\(255,\s*255,\s*255,\s*\.92\);/);
	assert.match(listbox, /backdrop-filter:\s*blur\(20px\) saturate\(1\.12\);/);
	assert.match(
		listbox,
		/-webkit-backdrop-filter:\s*blur\(20px\) saturate\(1\.12\);/,
	);
	assert.match(listbox, /inset 0 1px 0 rgba\(255,\s*255,\s*255,\s*\.72\)/);
	assert.match(listbox, /animation:\s*easymde-settings-select-enter 110ms/);
	assert.match(listbox, /font-size:\s*14px;/);
	assert.match(listbox, /font-weight:\s*400;/);
	assert.match(listbox, /color-scheme:\s*light;/);
	assert.match(option, /min-height:\s*24px;/);
	assert.match(option, /grid-template-columns:\s*14px minmax\(0,\s*1fr\);/);
	assert.match(option, /gap:\s*1px;/);
	assert.match(option, /padding:\s*2px 10px 2px 4px;/);
	assert.match(option, /border-radius:\s*7px;/);
	assert.match(
		option,
		/transition:\s*background-color 100ms ease,\s*color 100ms ease,\s*box-shadow 100ms ease;/,
	);
	assert.match(activeOption, /background:\s*rgba\(52,\s*132,\s*244,\s*\.96\);/);
	assert.match(settingsControlsSource, /const SELECT_OPTION_HEIGHT = 24;/);
	assert.match(settingsControlsSource, /const SELECT_POPUP_PADDING = 10;/);
	assert.match(settingsControlsSource, /<Check size=\{13\}/);
	assert.match(
		settingsCss,
		/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.easymde-settings-center__select-listbox\s*\{[^}]*animation:\s*none;/,
	);
	assert.match(settingsRootSource, /scrollSpyFrameRef/);
	assert.match(
		settingsRootSource,
		/scrollSpyFrameRef\.current\s*=\s*windowRef\.requestAnimationFrame/,
	);
});

test("Settings Center replaces the fixed desktop crop at compact and narrow widths", () => {
	assert.match(frameRuleBody(), /min-width:\s*0;/);
	assert.match(
		settingsCss,
		/@media\s*\(max-width:\s*840px\)[\s\S]*?\.easymde-settings-center__frame\s*\{[^}]*display:\s*block;/,
	);
	assert.match(
		settingsCss,
		/@media\s*\(max-width:\s*840px\)[\s\S]*?\.easymde-settings-center__row\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/,
	);
	assert.match(
		settingsCss,
		/@media\s*\(max-width:\s*840px\)[\s\S]*?\.easymde-settings-center__sticky-header\s*\{[^}]*height:\s*auto;/,
	);
	assert.match(
		settingsCss,
		/@media\s*\(max-width:\s*840px\)[\s\S]*?\.easymde-settings-center__header-scale header\s*\{[^}]*height:\s*auto;/,
	);
	assert.match(
		settingsCss,
		/@media\s*\(max-width:\s*840px\)[\s\S]*?\.easymde-settings-center__save-bar\s*\{[^}]*position:\s*fixed;[^}]*top:\s*auto;[^}]*bottom:\s*0;/,
	);
	assert.match(
		settingsCss,
		/@media\s*\(max-width:\s*840px\)[\s\S]*?\.easymde-settings-center__frame\s*\{[^}]*--easymde-mobile-save-bar-height:\s*98px;/,
	);
	assert.match(
		settingsCss,
		/\.easymde-settings-center__save-bar\s*\{[^}]*height:\s*var\(--easymde-mobile-save-bar-height\);/,
	);
	assert.match(
		settingsCss,
		/\.easymde-settings-center__frame:has\([^}]+main\s*\{[^}]*padding-bottom:\s*var\(--easymde-mobile-save-bar-height\);/,
	);
});

test("Settings Center preserves reference Help geometry until the mobile layout", () => {
	const compactRules = settingsCss.match(
		/@media\s*\(max-width:\s*1099px\)[\s\S]*?(?=@media\s*\(max-width:\s*840px\))/,
	)?.[0];
	assert.ok(compactRules, "compact Settings Center rules must exist");
	assert.doesNotMatch(
		compactRules,
		/\.easymde-settings-center__sidebar\s*\{[^}]*width:/,
	);
	assert.doesNotMatch(
		compactRules,
		/\.easymde-settings-center__help\s*\{[^}]*(?:left|right):/,
	);
	assert.match(
		settingsCss,
		/@media\s*\(min-width:\s*841px\)[\s\S]*?\.easymde-settings-center__sidebar nav\s*\{[^}]*bottom:\s*136px;[^}]*overflow-y:\s*auto;/,
	);
	assert.match(
		settingsCss,
		/\.easymde-settings-center__upload-formats\s*\{[^}]*width:\s*min\(620px,\s*100%\);/,
	);
	assert.match(
		settingsCss,
		/\.easymde-settings-center__verification-divider \.easymde-settings-center__row-control,[\s\S]*?\.easymde-settings-center__backup-verification-divider \.easymde-settings-center__row-control\s*\{[^}]*width:\s*100%;[^}]*justify-self:\s*stretch;/,
	);
	assert.match(
		settingsCss,
		/\.easymde-settings-center__verification-row\s*\{[^}]*width:\s*520px;[^}]*max-width:\s*100%;/,
	);
	assert.match(
		compactRules,
		/\.easymde-settings-center__verification-row\s*\{[^}]*flex-wrap:\s*wrap;/,
	);
	assert.match(
		settingsCss,
		/@media\s*\(max-width:\s*840px\)\s*and\s*\(max-height:\s*500px\)[\s\S]*?grid-template-columns:\s*116px\s+minmax\(0,\s*1fr\)\s+148px;/,
	);
});

test("image number inputs use one horizontal stepper without native vertical controls", () => {
	const stepper = cssRuleBody(".easymde-settings-center__image-number-stepper");
	const input = cssRuleBody(
		".easymde-settings-center .easymde-settings-center__image-number-input",
	);
	const value = cssRuleBody(
		".easymde-settings-center__image-number-value",
	);
	const unit = cssRuleBody(
		".easymde-settings-center__image-number-value > span",
	);
	const warning = cssRuleBody(
		".easymde-settings-center__image-size-warning",
	);
	const webkitSpinner = cssRuleBody(
		".easymde-settings-center__image-number-input::-webkit-inner-spin-button",
	);

	assert.match(stepper, /display:\s*grid;/);
	assert.match(
		stepper,
		/grid-template-columns:\s*39px minmax\(0,\s*1fr\) 39px;/,
	);
	assert.match(stepper, /height:\s*39px;/);
	assert.match(stepper, /max-width:\s*100%;/);
	assert.match(stepper, /border:\s*1px solid #d4dce8;/);
	assert.match(value, /display:\s*grid;/);
	assert.match(value, /grid-template-columns:\s*minmax\(0,\s*1fr\) auto;/);
	assert.match(value, /min-width:\s*0;/);
	assert.match(unit, /font-size:\s*15px;/);
	assert.match(warning, /display:\s*flex;/);
	assert.match(warning, /color:\s*#b42318;/);
	assert.match(input, /appearance:\s*textfield;/);
	assert.match(input, /min-width:\s*0;/);
	assert.match(webkitSpinner, /appearance:\s*none;/);
	assert.match(webkitSpinner, /margin:\s*0;/);
});

test("upload verification feedback uses a compact viewport-safe dialog with accessible actions", () => {
	const dialog = cssRuleBody(
		".easymde-settings-center__upload-verification-dialog",
	);
	const closeButton = cssRuleBody(
		".easymde-settings-center__upload-verification-dialog > footer button",
	);
	const resultRows = cssRuleBody(
		".easymde-settings-center__upload-verification-result dl > div",
	);

	assert.match(dialog, /max-width:\s*520px;/);
	assert.match(dialog, /border-radius:\s*8px;/);
	assert.match(closeButton, /height:\s*44px;/);
	assert.match(closeButton, /min-width:\s*96px;/);
	assert.match(
		settingsCss,
		/\.easymde-settings-center__upload-verification-result a\s*\{[^}]*display:\s*inline-flex;[^}]*min-height:\s*44px;/,
	);
	assert.match(
		resultRows,
		/grid-template-columns:\s*132px minmax\(0,\s*1fr\);/,
	);
	assert.match(
		settingsCss,
		/@media\s*\(max-width:\s*480px\)[\s\S]*?\.easymde-settings-center__upload-verification-dialog\s*\{[^}]*max-height:\s*calc\(100dvh - 24px\);/,
	);
	assert.match(
		settingsCss,
		/@media\s*\(max-width:\s*480px\)[\s\S]*?\.easymde-settings-center__upload-verification-result dl > div\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/,
	);
});

test("Settings Center Help card leaves the scrolling desktop sidebar at narrow widths", () => {
	assert.match(
		settingsCss,
		/@media\s*\(max-width:\s*840px\)[\s\S]*?\.easymde-settings-center__help\s*\{[^}]*position:\s*static;/,
	);
});

test("Settings Center short landscape layout keeps sticky actions clear of the header", () => {
	assert.match(
		settingsCss,
		/@media\s*\(max-width:\s*840px\)\s*and\s*\(max-height:\s*500px\)[\s\S]*?\.easymde-settings-center__sidebar\s*\{[^}]*height:\s*64px;/,
	);
	assert.match(
		settingsCss,
		/@media\s*\(max-width:\s*840px\)\s*and\s*\(max-height:\s*500px\)[\s\S]*?\.easymde-settings-center__sticky-header\s*\{[^}]*top:\s*64px;/,
	);
	assert.match(
		settingsCss,
		/@media\s*\(max-width:\s*840px\)\s*and\s*\(max-height:\s*500px\)[\s\S]*?\.easymde-settings-center__header-scale header\s*\{[^}]*min-height:\s*94px;/,
	);
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
	assert.match(title, /\bletter-spacing:\s*-1\.35px;/);
	assert.match(title, /\bline-height:\s*34px;/);
	assert.match(subtitle, /\bmargin-top:\s*4px;/);
	assert.match(subtitle, /\bfont-size:\s*18px;/);
	assert.match(subtitle, /\bline-height:\s*18\.75px;/);
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
	assert.match(title, /\bletter-spacing:\s*-\.55px;/);
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
