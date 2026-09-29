<p align="center"><img src="docs/assets/mark.svg" width="72" height="72" alt="Hailey logo"></p>
<h1 align="center">Hailey</h1>
<p align="center"><strong>AI programs you can understand.</strong><br>Explicit context. Typed results. Bounded calls. Inspectable replay.</p>
<p align="center"><a href="https://malanaa.github.io/Hailey/">Documentation</a> · <a href="https://github.com/Malanaa/Hailey/releases">Downloads</a> · <a href="examples/triage.hailey">Try an example</a> · <a href="https://github.com/Malanaa/Hailey/actions/workflows/ci.yml">Build status</a></p>

Hailey is a small interpreted language for AI workflows. Put your data contracts, model configuration, prompts, context, and workflow in a `.hailey` file. Run it from the command line or embed the runtime in JavaScript.

**v0.1.0 is an initial release.** It is useful for structured extraction, classification, and sequential workflows. The language and trace format may change before 1.0. It does not include autonomous agents, training, vector search, streaming, or a general purpose standard library.

## Install

Requires **Node.js 22 or later** and npm on macOS, Linux, or Windows.

Install the versioned release package:

```sh
npm install -g https://github.com/Malanaa/Hailey/releases/download/v0.1.0/hailey-lang-0.1.0.tgz
hailey version
hailey init hello-hailey
hailey run hello-hailey/main.hailey
hailey test hello-hailey/main.hailey
```

The starter uses a **fixed mock response**. It makes no network requests and needs no API key. The fixture tests the workflow, not a model's accuracy.

Other installation options:

```sh
# Install from a versioned Git tag, requires Git
npm install -g git+https://github.com/Malanaa/Hailey.git#v0.1.0

# Run once without a global installation
npx --yes --package=https://github.com/Malanaa/Hailey/releases/download/v0.1.0/hailey-lang-0.1.0.tgz hailey --help

# Run directly from source
git clone https://github.com/Malanaa/Hailey.git
cd Hailey
node bin/hailey.js run examples/triage.hailey
```

Download the tarball and `SHA256SUMS.txt` from [Releases](https://github.com/Malanaa/Hailey/releases/tag/v0.1.0) for manual installation. Run `npm install -g ./hailey-lang-0.1.0.tgz` from the download directory. This release is distributed through GitHub. A package on the npm registry is not required.

## A complete program

```hailey
type Ticket {
  category: "billing" | "bug" | "question"
  needs_review: Bool
}

model local {
  provider: "mock"
}

context policy {
  text: "Duplicate charges go to the accounts team."
}

task classify(message: String) -> Ticket {
  model: local
  context: [policy]
  system: "Classify the message using the policy."
  prompt: "{{message}}"
  mock: { category: "billing", needs_review: false }
}

flow main {
  let ticket = classify("I was charged twice.")
  print ticket
  if ticket.needs_review {
    print "Ask a person to review this ticket"
  }
}

test duplicate_charge {
  let ticket = classify("I was charged twice.")
  assert ticket.category == "billing"
}
```

Save this as `main.hailey`, then run `hailey check main.hailey` and `hailey run main.hailey`.

## Use a live model

Copy [examples/live.hailey](examples/live.hailey). It uses the Chat Completions wire format through a configurable `compatible` adapter. Set the model name to one your provider supports. The adapter supports `json_schema` and `json_object` response formats.

```sh
export OPENAI_API_KEY="your-api-key"
hailey run examples/live.hailey --input "message=I was charged twice" --max-calls 2 --trace live.trace.json
```

In PowerShell, set the environment variable with `$env:OPENAI_API_KEY = "your-api-key"` instead. Hailey reads the named variable from the process environment. It does not load `.env` automatically. Never put an actual API key in a `.hailey` source file.

A live call can incur provider charges. The adapter has been tested with simulated provider responses and a local HTTP integration server. Account access and live model behavior must be verified with your provider.

## Record, inspect, replay

```sh
hailey run hello-hailey/main.hailey --trace first.trace.json
hailey inspect first.trace.json
hailey run hello-hailey/main.hailey --replay first.trace.json
```

Recording is opt-in. A trace contains rendered messages, context names, model results, token usage when provided, cost estimates when configured, errors, and local file contents read by the program. Treat traces like the underlying data. Hailey creates new trace files with restrictive permissions where supported and refuses to overwrite an existing file.

Replay checks the source hash, entry point, ordered request fingerprints, result types, and outputs. It does not call a model or reread recorded local files. A trace is editable JSON, not signed evidence or a security boundary.

## What v0.1 does

| Feature | Behavior |
| --- | --- |
| Typed tasks | Validate inputs and outputs against primitive, enum, array, nullable, and named object types |
| Static checks | Check declarations, configuration, references, prompt paths, arity, and literal arguments |
| Context | Attach named text blocks explicitly to a task |
| Control flow | Immutable local bindings, branching, comparisons, short circuit booleans, printing, assertions |
| Live inference | Configurable Chat Completions compatible HTTP endpoint |
| Offline fixtures | Deterministic mock results for demos and workflow tests |
| Bounds | Maximum model attempts per run, per-request timeout, requested output token limit |
| Cost visibility | Report provider token usage and estimates from your configured per-million token prices |
| Local tools | `input(name)` and capability-gated `read_text(path)` |
| Replay | Reexecute workflow logic against matching recorded model and file results |
| Embedding | Import `compile`, `run`, and `Runtime` from JavaScript |

Type validation checks structure, not truth. A `needs_review` field is a model prediction, not calibrated confidence. Token limits depend on the provider honoring the request. Prices are user supplied estimates, not invoices or a hard dollar spending cap. Missing usage or prices remain unknown rather than appearing free.

## CLI

| Command | Purpose |
| --- | --- |
| `hailey init [directory]` | Write a runnable offline `main.hailey` without overwriting files |
| `hailey check file.hailey` | Check a program without calling models or reading tool files |
| `hailey run file.hailey` | Run `flow main` |
| `hailey run file.hailey --flow name` | Choose a different flow |
| `hailey test file.hailey` | Run test blocks, live model declarations require `--live` |
| `hailey inspect file.trace.json` | Print a recorded trace |
| `hailey --help` | Show all options |

`run` supports `--input name=value`, `--max-calls N`, `--trace path`, `--replay path`, and repeatable `--allow-read directory`. The default limit is 20 model attempts, including retries. Test runs use that limit separately for each test.

File paths in `read_text` are relative to the source file. Allowed directories are relative to the shell's working directory. Hailey resolves symlinks and checks path containment. This is a capability check for trusted programs, not an operating system sandbox for hostile code or concurrent filesystem attackers.

## Embed in JavaScript

Install the same release package as a local dependency, then:

```js
import { readFile } from 'node:fs/promises'
import { run } from 'hailey-lang'

const source = await readFile('main.hailey', 'utf8')
const trace = await run(source, {
  maxCalls: 3,
  inputs: { message: 'I was charged twice' },
  onPrint: text => console.log(text)
})
console.log(trace.outputs)
```

For file tools, also pass `baseDir` and `allowRead`. To inspect a failed run, construct a `Runtime` with `compile(source)` and read `runtime.trace` after catching the error.

## Develop

There are no third-party runtime or test dependencies and no compilation step.

```sh
npm test
npm run docs:check
npm run demo
npm run build
```

The build creates an npm-compatible archive and SHA-256 checksum in `dist/`. CI tests Node.js 22 and 24 on Linux, macOS, and Windows. The documentation is static HTML in `docs/`, styled with Tailwind CDN and local CSS. Open it through any static server, for example `python3 -m http.server 8080 --directory docs`.

See [CONTRIBUTING.md](CONTRIBUTING.md), [the language reference](https://malanaa.github.io/Hailey/language.html), [architecture](https://malanaa.github.io/Hailey/architecture.html), and [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE)
