import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, relative } from 'node:path';

// JUnit retains its existing consumers. The public summaries take failure
// locations from Playwright's source metadata, not JUnit titles or error text.
export default class ShardCaseReporter {
  constructor({ outputFile }) {
    this.outputFile = outputFile;
    this.assigned = new Set(JSON.parse(process.env.EASYMDE_PLAYWRIGHT_ASSIGNED_FILES ?? '[]'));
    this.errorCount = 0;
    this.errorLocations = new Map();
  }

  printsToStdio() {
    return true;
  }

  onBegin(config, suite) {
    this.config = config;
    this.tests = suite.allTests();
  }

  onError(error) {
    this.errorCount += 1;
    const { file, line } = error.location ?? {};
    if (!this.config || typeof file !== 'string' || !isAbsolute(file) || !Number.isSafeInteger(line) || line < 1) return;
    const spec = `tests/e2e/${relative(this.config.rootDir, file).replaceAll('\\', '/')}`;
    if (this.assigned.has(spec)) this.errorLocations.set(`${spec}:${line}`, { spec, line });
  }

  onEnd() {
    const cases = this.tests.map((test) => ({
      file: relative(this.config.rootDir, test.location.file).replaceAll('\\', '/'),
      line: test.location.line,
      outcome: test.outcome() === 'skipped' ? 'skipped' : test.ok() ? 'passed' : 'failed'
    }));
    mkdirSync(dirname(this.outputFile), { recursive: true });
    const errors = {
      category: 'playwright-run-error',
      count: this.errorCount,
      locations: [...this.errorLocations.values()]
    };
    writeFileSync(this.outputFile, JSON.stringify({ cases, errors }), 'utf8');
  }
}
