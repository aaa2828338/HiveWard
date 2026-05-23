# Hiveward CLI

The Hiveward CLI provides the npm product installation path for local Hiveward usage.

```bash
npm install -g @hiveward/cli
hiveward setup
hiveward start
```

Available commands:

- `hiveward setup`: prepare a local Hiveward checkout and install npm dependencies.
- `hiveward start`: start the local Hiveward web/API development server from the prepared checkout.
- `hiveward doctor`: inspect Node.js, npm, install directory, dependencies, and local ports.
- `hiveward update`: check the npm registry for a newer CLI version.

The CLI does not require a Hiveward-owned server for local installation. By default it uses the public GitHub repository as the source checkout and npm as the package registry.
