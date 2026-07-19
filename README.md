# jq Language Support

A clean VS Code extension for jq program files.

## What it provides

- TextMate syntax highlighting for `.jq` files and jq shebang scripts.
- jq 1.6+ constructs including destructuring alternatives (`?//`), optional paths, update assignments, modules, interpolation, `reduce`, and `foreach`.
- Tcl-style continued comments added in jq 1.8.
- Compile diagnostics from the locally installed `jq`, so validation follows the exact jq version selected by `jq.executablePath`.

## Development

```sh
npm install
npm run compile
npm test
```

Press `F5` in VS Code to launch an Extension Development Host with `test/fixtures/tail.jq`.

To build a VSIX:

```sh
npm run package
```

## Validation model

VS Code writes the current editor buffer to a short-lived hidden file beside the source file, invokes:

```sh
jq --null-input --exit-status --from-file TEMPORARY_FILE
```

and reports compile errors only. Runtime failures are intentionally ignored. The process is killed after the configured timeout, stdout is discarded, stderr is capped, and the temporary file is removed.

This uses jq itself as the authoritative parser. It avoids permanently embedding a second parser that may lag behind jq releases. It is still process-based validation, so it is deliberately bounded and configurable.

## Settings

- `jq.executablePath`
- `jq.validation.enabled`
- `jq.validation.onChange`
- `jq.validation.delay`
- `jq.validation.timeout`

## License

MIT
