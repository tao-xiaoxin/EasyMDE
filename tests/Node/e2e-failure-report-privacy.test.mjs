import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parseJUnitXml } from '../../scripts/e2e-shard-summary.mjs';

const repo = new URL('../../', import.meta.url);
const redaction = 'Authenticated workflow failed; browser and assertion data omitted';
const privateMarker = /SYNTHETIC_PROTECTED_(?:BODY|BEFORE|AFTER|TITLE|PARENT_TITLE|CUSTOM_STEP)/u;
const publicMarker = 'SYNTHETIC_UNPROTECTED';

const specSource = `import { expect, test } from ${JSON.stringify(new URL('node_modules/@playwright/test/index.mjs', repo).href)};
import { privacySafeFailureDetails as details, privacySafeFailureTest as protectedTest } from ${JSON.stringify(new URL('tests/e2e/helpers/privacy-safe-failure-test.mjs', repo).href)};
const marker = (suffix) => 'SYNTHETIC_PROTECTED_' + suffix;
protectedTest.describe('nested failure', () => {
  let started = false;
  protectedTest.afterEach(() => { if (started) throw new Error(marker('AFTER')); });
  protectedTest('protected body', details, async () => {
    started = true;
    await expect(async () => {
      await protectedTest.step('nested probe', () => {});
    }, marker('PARENT_TITLE')).toPass();
    await protectedTest.step('outer step', async () => {
      await protectedTest.step(marker('CUSTOM_STEP'), () => {
        expect(marker('BODY'), marker('TITLE')).toBe('different');
      });
    });
  });
});
protectedTest.describe('hook failure', () => {
  protectedTest.beforeEach(() => { throw new Error(marker('BEFORE')); });
  protectedTest('protected hook', details, () => {});
});
test('unprotected control', async ({}, info) => {
  await info.attach('control.txt', { body: '${publicMarker}', contentType: 'text/plain' });
  await expect(async () => {
    await test.step('public custom step', () => {});
  }, 'public parent assertion').toPass();
  throw new Error('${publicMarker}');
});
`;
const assertionLine = specSource.split('\n').findIndex((line) => line.includes("expect(marker('BODY')")) + 1;
const customStepLine = specSource.split('\n').findIndex((line) => line.includes("protectedTest.step(marker('CUSTOM_STEP')")) + 1;

function reportZip(cwd) {
  const html = readFileSync(join(cwd, 'html', 'index.html'), 'utf8');
  const archive = html.match(/<template id="playwrightReportBase64">data:application\/zip;base64,([A-Za-z0-9+/=]+)<\/template>/u)?.[1];
  assert.ok(archive, 'HTML report embeds the report data');
  const file = join(cwd, 'html-data.zip');
  writeFileSync(file, Buffer.from(archive, 'base64'));
  const unzip = (...args) => {
    const result = spawnSync('unzip', args, { encoding: 'utf8' });
    assert.equal(result.status, 0, 'HTML report data is readable');
    return result.stdout;
  };
  return unzip('-Z1', file).trim().split('\n').map(entry => JSON.parse(unzip('-p', file, entry)));
}

test('authenticated failures stay private in list, JUnit and nested HTML steps', (t) => {
  const cwd = mkdtempSync(join(tmpdir(), 'easymde-report-privacy-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  writeFileSync(join(cwd, 'privacy.spec.mjs'), specSource);
  for (const directory of ['node_modules', 'scripts']) {
    symlinkSync(fileURLToPath(new URL(directory, repo)), join(cwd, directory), 'junction');
  }
  // Copy the real config without the repository's local environment file.
  writeFileSync(join(cwd, 'base.config.mjs'), readFileSync(new URL('playwright.config.mjs', repo)));
  writeFileSync(join(cwd, 'playwright.config.mjs'), `import config from './base.config.mjs';
    export default { ...config, testDir: '.', testMatch: 'privacy.spec.mjs', projects: [{ name: 'synthetic' }], outputDir: 'output',
      reporter: [...config.reporter.filter(([name]) => name !== 'junit'),
        ['junit', { outputFile: 'junit.xml' }], ['html', { outputFolder: 'html', open: 'never' }]] };
  `);
  const run = (...args) => spawnSync(process.execPath, [fileURLToPath(new URL('node_modules/playwright/cli.js', repo)), 'test', ...args], {
    cwd, encoding: 'utf8', timeout: 30_000, env: { PATH: process.env.PATH, PLAYWRIGHT_FORCE_TTY: '240x40', FORCE_COLOR: '0' }
  });
  const result = run();
  assert.equal(result.status, 1, 'the protected failures still fail the run');
  const list = `${result.stdout}${result.stderr}`;
  assert.ok(list.includes('public parent assertion › public custom step'), 'interactive List prints nested step title paths');
  assert.equal(list.includes('SYNTHETIC_PROTECTED_PARENT_TITLE'), false, 'interactive List omits the parent assertion title');
  assert.ok(list.includes('protected body › Assertion › Test step'), 'interactive List retains the safe parent chain');
  const junit = readFileSync(join(cwd, 'junit.xml'), 'utf8');
  const htmlFiles = reportZip(cwd);
  const html = JSON.stringify(htmlFiles);
  for (const [name, report] of [['list', list], ['JUnit', junit], ['HTML', html]]) {
    assert.equal(privateMarker.test(report), false, `${name} omits protected runtime data`);
    assert.ok(report.includes(redaction), `${name} reports the redacted failure`);
    assert.ok(report.includes(publicMarker), `${name} preserves unrelated diagnostics`);
  }
  assert.match(list, /3 failed/u);
  assert.equal(parseJUnitXml(junit, ['tests/e2e/privacy.spec.mjs']).counts.failed, 3);
  assert.ok(list.includes(`privacy.spec.mjs:${assertionLine}:`), 'list retains the assertion source location');
  assert.ok(junit.includes(`privacy.spec.mjs:${assertionLine}:`), 'JUnit retains the assertion source location');
  const htmlCases = htmlFiles.find(({ fileName, tests }) => fileName === 'privacy.spec.mjs' && tests?.[0]?.results).tests;
  const body = htmlCases.find(({ title }) => title === 'protected body').results[0];
  const hook = htmlCases.find(({ title }) => title === 'protected hook').results[0];
  const control = htmlCases.find(({ title }) => title === 'unprotected control').results[0];
  assert.equal(body.errors.length, 2, 'the assertion and afterEach errors both survive');
  assert.equal(hook.errors.length, 1, 'the beforeEach error survives');
  for (const result of [body, hook]) {
    assert.equal(result.status, 'failed');
    assert.deepEqual(result.attachments.map(({ name }) => name), ['error-context']);
    const attachment = readFileSync(join(cwd, 'html', result.attachments[0].path), 'utf8');
    assert.equal(privateMarker.test(attachment), false, 'failure context omits protected data');
    assert.equal(attachment.includes('# Page snapshot'), false, 'failure context omits page snapshots');
  }
  const outer = body.steps.find(({ title }) => title === 'Test step');
  const inner = outer.steps.find(({ title }) => title === 'Test step');
  const assertion = inner.steps.find(({ title }) => title === 'Assertion');
  for (const step of [outer, inner, assertion]) {
    assert.ok(step.error.startsWith(redaction), 'each nested failed step preserves a safe error');
  }
  assert.equal(inner.location.line, customStepLine);
  assert.equal(inner.location.file, 'privacy.spec.mjs');
  assert.equal(assertion.location.line, assertionLine);
  assert.equal(assertion.location.file, 'privacy.spec.mjs');
  const publicAssertion = control.steps.find(({ title }) => title === 'public parent assertion');
  assert.ok(publicAssertion.steps.some(({ title }) => title === 'public custom step'));
  assert.equal(control.attachments.find(({ name }) => name === 'control.txt').body, publicMarker);

  const bypass = run('--reporter=list', '-g', 'protected body');
  assert.equal(bypass.status, 1, 'a reporter override cannot run a protected test without redaction');
  assert.ok(bypass.stdout.includes('Protected tests require the EasyMDE privacy reporter first'));
  assert.equal(privateMarker.test(`${bypass.stdout}${bypass.stderr}`), false);

  const reporter = fileURLToPath(new URL('scripts/e2e-privacy-reporter.mjs', repo));
  const explicit = run(`--reporter=${reporter},list`, '-g', 'protected body');
  assert.equal(explicit.status, 1);
  assert.ok(explicit.stdout.includes(redaction), 'an explicit privacy-first reporter list runs the protected test');
  assert.equal(privateMarker.test(`${explicit.stdout}${explicit.stderr}`), false);
});
