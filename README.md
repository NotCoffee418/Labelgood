# Labelgood

A desktop application built with Tauri + Svelte + TypeScript.

⚠️ **Pre-Alpha Software** - Labelgood is currently in pre-alpha development. It theoretically works... mostly. Expect bugs and breaking changes.

## Installation

### Quick Install (Linux/macOS)

```bash
curl -fsSL https://raw.githubusercontent.com/NotCoffee418/Labelgood/main/install.sh | bash
```

### Quick Install (Windows)

Open PowerShell as Administrator and run:

```powershell
irm https://raw.githubusercontent.com/NotCoffee418/Labelgood/main/install.ps1 | iex
```

### Manual Installation

Download the latest release for your platform from the [releases page](https://github.com/NotCoffee418/Labelgood/releases/latest):

- **Linux**: `labelgood-VERSION-linux-ARCH.tar.gz` (amd64, arm64, or armv7)
- **Windows**: `labelgood-VERSION-windows-amd64.zip`

Extract the archive and run the binary.

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) (v20 or later)
- [Rust](https://www.rust-lang.org/) (latest stable)
- System dependencies for Tauri (see [Tauri Prerequisites](https://tauri.app/start/prerequisites/))

### Getting Started

1. Install dependencies:
```bash
npm install
```

2. Run the development server:
```bash
npm run tauri dev
```

3. Build for production:
```bash
npm run build
npm run tauri build
```

## VSCode Debug Support

This project is configured for debugging with VSCode. Simply press **F5** to start debugging:

- **Tauri Development Debug** - Runs the app in development mode with the debugger attached
- **Tauri Production Debug** - Builds and runs the production version with the debugger attached

## Project Structure

- `src/` - Svelte frontend code
- `src-tauri/` - Rust backend code
- `static/` - Static assets
- `.vscode/` - VSCode configuration for debugging and recommended extensions

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Svelte](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer).

## Release Workflow

This project includes a GitHub Actions workflow that automatically builds and releases the application when you push a version tag:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The workflow will:
1. Run tests
2. Build binaries for:
   - Linux (amd64, arm64, armv7)
   - Windows (amd64)
3. Create a GitHub release with the built binaries

