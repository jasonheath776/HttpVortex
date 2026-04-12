# Change Log

All notable changes to the "Neon Playbook" extension will be documented in this file.

## [0.1.0] - 2026-04-10

### Added
- Initial release of Neon Playbook for VS Code
- HTTP runbook file support (.http, .rest)
- Syntax highlighting for HTTP requests
- Variable declaration and interpolation
- Response value capture using `@var = res.data.path` syntax
- Debug expressions with `> debug()` syntax
- Sequential request execution
- Run all requests command
- Run current request command
- Run all from here command (via CodeLens)
- CodeLens markers above request blocks
- Results panel with collapsible result cards
- Request/response header display
- JSON response body formatting
- Copy to clipboard functionality
- Postman collection export
- Postman collection import
- Markdown report generation with detailed results
- Auth profile management (Bearer, Basic, API Key, OAuth2)
- Environment file support (.env)
- Request history with replay capability
- Configuration options for timeout, redirects, and SSL validation
- Keyboard shortcuts (Ctrl+Shift+R, Ctrl+Alt+R)
- Editor toolbar buttons
- Line continuation support with backslash
- Comment support with #

### Coming Soon
- Parallel request execution option
- Advanced environment switching
- Request chaining workflows
