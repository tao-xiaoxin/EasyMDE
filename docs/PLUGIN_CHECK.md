# Plugin Check Notes

`scripts/run-plugin-check.sh` installs the built release ZIP into a clean WordPress site, activates it, installs the official Plugin Check plugin, and fails when Plugin Check reports any `ERROR` rows.

The current release keeps the following warnings visible and accepted:

- `unexpected_markdown_file` for `THIRD-PARTY-NOTICES.md`: the release ZIP intentionally includes the generated runtime dependency notice file so bundled Composer packages and copied frontend assets have auditable license/source metadata inside the installable package.
- `unexpected_markdown_file` for `UPGRADING.md`: the release ZIP intentionally includes upgrade guidance because EasyMDE stores Markdown source in post meta and authors need backup, lazy migration, revision, custom CSS snapshot, font, and rollback guidance near the plugin package.
- `load_plugin_textdomainFound` for `load_plugin_textdomain()`: EasyMDE ships GitHub release ZIPs with bundled language files and is not relying only on WordPress.org language packs, so the explicit textdomain load remains part of the self-contained release behavior.

These warnings should be revisited whenever EasyMDE changes its release target, WordPress.org packaging strategy, or bundled documentation policy.
