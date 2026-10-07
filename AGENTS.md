# Development guidance

## Prerelease compatibility

This project is far from release. Breaking changes are welcome when they improve
the implementation or support the requested features. Do not spend effort on
backward compatibility, migrations, or support for old save formats, APIs, or
compiled map data unless the user explicitly requests it. Update the current
implementation, tests, and documentation together; rebuilding generated assets
or starting fresh games is acceptable.

This permission concerns compatibility. Preserve user-authored files and local
work, and do not delete existing saves or source assets merely because their
formats have changed.
