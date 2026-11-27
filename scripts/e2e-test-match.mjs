// Playwright's default matches spec/test case-insensitively, then applies a
// case-sensitive JS/TS extension allowlist. Share the combined rule with CI.
export const E2E_TEST_MATCH = /\.(?:[sS][pP][eE][cC]|[tT][eE][sS][tT])\.[cm]?[jt]sx?$/;
