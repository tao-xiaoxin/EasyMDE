import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const repoRoot = new URL('../..', import.meta.url).pathname;

function source(path) {
  return readFileSync(join(repoRoot, path), 'utf8');
}

test('editor spellcheck attribute is driven by sanitized editor settings', () => {
  const editorScreen = source('src/Admin/EditorScreen.php');
  const editorShell = source('templates/admin/editor-shell.php');
  const options = source('src/Support/Options.php');

  assert.doesNotMatch(editorShell, /spellcheck="false"/);
  assert.match(editorScreen, /'spellcheck_enabled'\s*=>\s*\$this->options->is_editor_spellcheck_enabled\(\)/);
  assert.match(editorShell, /\$easymde_spellcheck\s*=\s*! empty\( \$context\['spellcheck_enabled'\] \) \? 'true' : 'false';/);
  assert.match(options, /function\s+is_editor_spellcheck_enabled\(\)/);
});
