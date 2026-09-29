Hailey is a small language for AI programs whose context, actions, cost, and failures you can understand.

This first release includes typed AI tasks, named context, sequential workflows, an offline mock provider, a Chat Completions compatible adapter, bounded calls and retries, input and output validation, cost estimates, JSON traces, replay, and a JavaScript embedding API.

## Install

Requires Node.js 22 or later.

```sh
npm install -g https://github.com/Malanaa/Hailey/releases/download/v0.1.0/hailey-lang-0.1.0.tgz
hailey init hello-hailey
hailey run hello-hailey/main.hailey
hailey test hello-hailey/main.hailey
```

The starter is offline and requires no API key. Download `SHA256SUMS.txt` to verify the package. GitHub also provides source archives below.

## Documentation

- [Documentation site](https://malanaa.github.io/Hailey/)
- [Getting started](https://malanaa.github.io/Hailey/getting-started.html)
- [Language reference](https://malanaa.github.io/Hailey/language.html)
- [Source and README](https://github.com/Malanaa/Hailey)

## Release scope

This is an initial 0.1 release with evolving syntax and APIs. Tests cover the language, CLI, retries, failure traces, capability checks, replay, simulated provider responses, and a local HTTP integration server. No paid provider call was used to validate this release. Test your selected live model before relying on it.

Schema validation does not establish factual correctness. Cost figures use user-configured prices and provider-reported token counts. They are estimates, and missing usage stays unknown. Autonomous agents, streaming, training, and a hard dollar spending cap are not included.
