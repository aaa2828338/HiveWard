# npm CLI Installation

Hiveward's npm product installation path is the `@hiveward/cli` package. It exposes the `hiveward` command.

```bash
npm install -g @hiveward/cli
hiveward setup
hiveward start
```

For one-off use:

```bash
npx @hiveward/cli setup
npx @hiveward/cli start
```

## Commands

- `hiveward setup`: prepares a local Hiveward checkout, installs npm dependencies, and runs the environment check.
- `hiveward start`: starts Hiveward from the prepared checkout on `http://localhost:10101` by default. Use `--port <port>` or `HIVEWARD_PORT` to override it.
- `hiveward doctor`: checks Node.js, npm, the install directory, dependencies, the environment template, and the configured Hiveward port.
- `hiveward update`: checks the npm registry for a newer CLI version.

## Update Rule

`hiveward update` does not require a Hiveward-owned server. It checks npm package metadata:

1. Read the installed CLI package version.
2. Request the configured npm registry and dist-tag, defaulting to `https://registry.npmjs.org` and `latest`.
3. Compare the registry version with the installed version using semantic version ordering.
4. Recommend an update only when the registry version is newer.

Use a custom registry or channel when needed:

```bash
hiveward update --registry https://registry.npmjs.org --tag latest
```

Apply the recommended global npm update directly:

```bash
hiveward update --apply
```

Environment overrides:

- `HIVEWARD_UPDATE_REGISTRY`: npm registry URL for update checks.
- `HIVEWARD_UPDATE_TAG`: npm dist-tag, such as `latest`, `beta`, or `next`.
- `HIVEWARD_INSTALL_DIR`: local Hiveward checkout path.
- `HIVEWARD_REPOSITORY_URL`: Git repository used by `hiveward setup`.
- `HIVEWARD_INSTALL_REF`: Git branch or tag used by `hiveward setup`.
- `HIVEWARD_PORT`: local web/API port, default `10101`.

## Server Requirements

The npm local install path does not require a Hiveward-operated server. It uses:

- npm registry for the CLI package and update metadata.
- GitHub for the Hiveward source checkout.
- The user's local machine to run the web/API server.

A Hiveward-owned server is only needed for future cloud features such as accounts, team sync, hosted runs, subscriptions, or managed storage.
