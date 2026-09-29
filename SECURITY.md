# Security and data boundaries

Hailey v0.1 is a runtime for trusted programs. It is not an operating system sandbox.

## Credentials

A model's `api_key` setting names an environment variable. Credential values are used only in the HTTP Authorization header and are not added to trace metadata. Programs and inputs can still contain secrets, and Hailey cannot identify or remove all sensitive content from prompts.

## Traces

Recording is opt-in. Trace files can contain full prompts, model responses, local file contents, and personal or business data. Keep them out of public repositories. New trace files request mode 0600 where the operating system supports it. Existing files are never overwritten.

Replay records are unsigned JSON. Use recordings from sources you trust. Source hashes and request hashes detect mismatches, not malicious editing.

## Network and files

Model endpoints require HTTPS except for explicit loopback HTTP endpoints. Redirects are rejected to prevent credentials from being forwarded to a different endpoint. Choosing an endpoint authorizes transmission of that task's messages to it.

`read_text` checks canonical paths against explicitly allowed directories and limits ordinary reads to 1 MiB. It is not hardened against an attacker changing filesystem entries during a read. Run untrusted programs in an external sandbox with separate credentials and operating system controls.

Context text is sent as user messages. It remains untrusted model input. Context labels and schemas do not eliminate prompt injection or guarantee factual correctness.

## Reporting

Use the repository's private vulnerability reporting feature if available. Otherwise open an issue requesting a private contact without including credentials, exploit details that expose users, or personal data.
