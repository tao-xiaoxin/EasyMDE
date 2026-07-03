# Plugin Check Notes

`scripts/run-plugin-check.sh` validates the built release ZIP, not a loose development checkout. It installs the ZIP into a clean WordPress site, activates EasyMDE, installs the official Plugin Check plugin, runs the Plugin Check CLI, and lets `scripts/plugin-check-results.mjs` classify the strict JSON output.

The runner fails the release validation when Plugin Check reports `ERROR` rows. The default Plugin Check version is pinned by the script and can be overridden with `EASYMDE_PLUGIN_CHECK_VERSION` for deliberate compatibility checks.

For the full release flow, see [Testing and Release](TESTING_AND_RELEASE.md).

## Accepted Warnings

The current release keeps the following warnings visible and accepted:

- `unexpected_markdown_file` for `THIRD-PARTY-NOTICES.md`: the release ZIP intentionally includes generated runtime dependency notices so bundled Composer packages and copied frontend assets have auditable license/source metadata inside the installable package.
- `unexpected_markdown_file` for `UPGRADING.md`: the release ZIP intentionally includes upgrade guidance because EasyMDE stores Markdown source and appearance state in post meta, and authors need backup, lazy migration, revision, custom CSS snapshot, font, and rollback guidance near the plugin package.
- `load_plugin_textdomainFound` for `load_plugin_textdomain()`: EasyMDE ships GitHub release ZIPs with bundled language files and does not rely only on WordPress.org language packs, so the explicit textdomain load remains part of the self-contained release behavior.

Revisit these warnings whenever EasyMDE changes its release target, WordPress.org packaging strategy, bundled documentation policy, language-file strategy, or dependency notice strategy.
