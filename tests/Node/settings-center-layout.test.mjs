import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const settingsCss = readFileSync(
	join(repoRoot, 'assets/css/admin/settings-center.css'),
	'utf8',
);

function frameRuleBody() {
	const match = settingsCss.match(
		/\.easymde-settings-center__frame\s*\{([^}]*)\}/s,
	);

	assert.ok(match, 'the Settings Center frame rule should exist');

	return match[1];
}

function headerTitleRuleBody() {
	const match = settingsCss.match(
		/\.easymde-settings-center__header-scale h1\s*\{([^}]*)\}/s,
	);

	assert.ok(match, 'the Settings Center header title rule should exist');

	return match[1];
}

function cssRuleBody(selector) {
	const match = settingsCss.match(
		new RegExp(`${selector.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 's'),
	);

	assert.ok(match, `${selector} should exist`);

	return match[1];
}

test('Settings Center frame preserves the reference outer frame', () => {
	const body = frameRuleBody();

	assert.match(body, /\bborder:\s*1px solid #9dbbff;/);
	assert.match(body, /\bborder-radius:\s*13px;/);
	assert.match(body, /\bbox-shadow:\s*0 8px 36px rgba\(27, 51, 96, \.13\);/);
});

test('Settings Center header title resets WordPress admin padding', () => {
	const title = headerTitleRuleBody();

	assert.match(title, /\bpadding:\s*0;/);
	assert.match(title, /\bfont-size:\s*30\.6px;/);
	assert.match(title, /\bline-height:\s*37\.8px;/);
	assert.match(cssRuleBody('\.easymde-settings-center__header-scale header > div'), /\btop:\s*93\.6px;/);
	assert.match(cssRuleBody('\.easymde-settings-center__header-scale header > div'), /\bleft:\s*33\.3px;/);
	assert.match(cssRuleBody('\.easymde-settings-center__header-scale header p'), /\bmargin-top:\s*7\.2px;/);
	assert.match(cssRuleBody('\.easymde-settings-center__header-scale header p'), /\bfont-size:\s*14\.4px;/);
	assert.match(cssRuleBody('\.easymde-settings-center__header-scale header p'), /\bline-height:\s*21\.6px;/);
	assert.match(cssRuleBody('\.easymde-settings-center__header-scale header > a'), /\btop:\s*16\.2px;/);
	assert.match(cssRuleBody('\.easymde-settings-center__header-scale header > a'), /\bright:\s*16\.2px;/);
	assert.match(cssRuleBody('\.easymde-settings-center__header-scale header > a'), /\bwidth:\s*30\.375px;/);
	assert.match(cssRuleBody('\.easymde-settings-center__header-scale header > a'), /\bheight:\s*30\.375px;/);
	assert.match(cssRuleBody('\.easymde-settings-center__header-scale header > a'), /\bborder-radius:\s*5\.625px;/);
});

test('Settings Center search surface preserves reference scale geometry', () => {
	const search = cssRuleBody('\\.easymde-settings-center__search');
	const icon = cssRuleBody('\\.easymde-settings-center__search > svg');

	assert.match(search, /\bheight:\s*38\.7px;/);
	assert.match(search, /\bmargin:\s*0 33\.3px 0 30\.6px;/);
	assert.match(icon, /\bleft:\s*18px;/);
	assert.match(icon, /\bwidth:\s*18px;/);
	assert.match(icon, /\bheight:\s*18px;/);
});
