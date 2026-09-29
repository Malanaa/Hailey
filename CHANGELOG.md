# Changelog

## 0.1.0

First public release of Hailey, a small interpreted language for inspectable AI workflows.

### Included

- A lexer, parser, checker, JSON Schema generator, and sequential interpreter
- Typed tasks with String, Number, Int, Bool, enum, array, nullable, and named object types
- Explicit named context, prompt interpolation, immutable bindings, branching, and assertions
- A deterministic mock provider and configurable Chat Completions compatible HTTP adapter
- Input and result validation, bounded retries, call limits, and per-request timeouts
- Opt-in JSON traces with token usage, configured cost estimates, failure details, and exact request matching during replay
- Directory-gated file reads, recorded file replay, and String inputs from the CLI
- An installable command line package and JavaScript embedding API
- Offline examples, workflow tests, static documentation, cross-platform CI, and GitHub release packaging

### Compatibility and limits

Requires Node.js 22 or later. The language and trace format are early and may change before 1.0. No autonomous agent loop, arbitrary tool plugins, streaming, training, retrieval engine, or hard dollar spending cap is included. Live provider behavior depends on the chosen service and model. Schema validity is not factual correctness.
