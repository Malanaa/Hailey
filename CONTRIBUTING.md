# Contributing to Hailey

Start with an issue describing the program you want to write and the behavior you expect. Small runnable examples help us decide whether a feature belongs in the language, the runtime, or an application.

## Local setup

Install Node.js 22 or later, clone the repository, and run `npm test`. There are no external dependencies to install. Use `node bin/hailey.js` while editing the source.

## Change checklist

- Add a focused behavioral test when changing parser, checker, runtime, or provider behavior
- Run `npm test` and `npm run docs:check`
- Update the language reference and examples when syntax changes
- Keep fixtures deterministic and free of credentials or private data
- Describe before and after behavior in the pull request
- Avoid em dashes and semicolons in documentation prose

## Layout

| Path | Responsibility |
| --- | --- |
| `src/parser.js` | Tokens, source positions, grammar, and AST |
| `src/checker.js` | Declaration checks, schemas, and value validation |
| `src/provider.js` | HTTP request construction and response handling |
| `src/runtime.js` | Sequential execution, capabilities, traces, and replay |
| `src/cli.js` | Commands, arguments, and filesystem entry points |
| `test/` | Language, CLI, provider, and HTTP integration tests |
| `examples/` | Runnable programs |
| `docs/` | Static documentation pages and shared assets |

## Release process

1. Update the version in `package.json`, the CLI, build script, docs, and changelog
2. Run checks and install the packed artifact into an isolated prefix
3. Commit the release and push the version tag
4. The release workflow runs the checks, builds a package, and attaches it with a checksum to the GitHub release
5. Verify the download and installation commands from a clean directory

Releases currently use GitHub assets. Publishing to the npm registry would be a separate distribution decision.
