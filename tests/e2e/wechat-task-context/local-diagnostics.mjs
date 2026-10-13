import { validateWordPressPrerequisites } from '../wechat-wordpress-fixture.mjs';

export const wpPath = process.env.EASYMDE_E2E_WP_PATH;
export const wpCli = process.env.EASYMDE_E2E_WP_CLI;
export const localDiagnosticsSetting = process.env.EASYMDE_E2E_WECHAT_LOCAL_DIAGNOSTICS?.trim() ?? '';
if (!['', '0', '1'].includes(localDiagnosticsSetting)) {
  throw new Error('wechat-task-context-local-diagnostics-flag-invalid');
}
export const localDiagnosticsEnabled = localDiagnosticsSetting === '1';

export function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`wechat-task-context-env-${name.toLowerCase().replaceAll('_', '-')}-missing`);
  }
  return value;
}
export function validateLocalDiagnosticPrerequisites(
  baseURL,
  {
    wpPathValue = wpPath,
    wpCliValue = wpCli,
    spawnSyncRef
  } = {}
) {
  return validateWordPressPrerequisites(baseURL, {
    prefix: 'wechat-task-context',
    wpPath: wpPathValue,
    wpCli: wpCliValue,
    ...(spawnSyncRef ? { spawnSyncRef } : {})
  });
}
