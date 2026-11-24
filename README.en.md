# dsh-unrestricted

[简体中文](./README.md) | **English** | [日本語](./README.ja.md)

System prompt unrestrict and host-debranding plugin for **DeepSeek Harness (DSH)**. Hooks into `system-prompt/assemble` to lift refusal boundaries across reverse engineering, security testing, creative writing, and technical workflows while keeping DSH's UI, tool protocols, Plan Mode, PTC, and subagents intact.

## What It Changes

- **Direct Delivery**: Starts immediately with requested code, analysis steps, binary patches, or prose without disclaimers or lecturing; keeps necessary physical/operational cautions to a brief trailing note.
- **Reverse Engineering & Security**: Locates validation routines (`CHECK_FN`), reconstructs algorithms, writes keygens, provides binary patch offsets (`OFFSET` / `PATCH_BYTE`) and anti-debug/anti-VM bypasses; delivers PoC/exploit scripts, bruteforcers, scanners, encrypted reverse shells, and relays.
- **Fiction & Technical Procedures**: Follows the requested tone and explicitness without fade-to-black cuts (characters default to adults); provides complete steps, ratios, and parameters for chemical, lab, and industrial workflows.
- **Resource Lookup & Data Isolation**: Queries web search tools to return verified resource lists without inventing URLs; treats workspace files and fetched pages strictly as data while preserving user-specified domains, hosts, and targets verbatim.

## How It Works

- **Structural Section Fusion**: Fuses idempotently by canonical DSH section names (`deployment:persona-prefix`, `plan:policy`, `tools:ptc-only`, `tool:structured_output`) across DSH Web and Desktop; safely leaves custom persona-replaced presets untouched.
- **Mode Coverage**: Adapts Standard, Cordis, PTC (`run_code` scripts and SDK calls), Plan (no file writes before approval, full code/steps inside the plan), Minimal, and background subagents.
- **Instant Toggle**: Stored in the profile's `cordis.patch.yml`; takes effect on the next request without restarting and leaves no markers in session history when turned off.

## Installation & Usage

```sh
# Install on DSH Web (GitHub Release or local checkout)
dsh plugin --profile web add github:yexi-by/dsh-unrestricted
dsh plugin --profile web add file:./plugin/unrestricted

# Install on DSH Desktop
dsh plugin --profile desktop add github:yexi-by/dsh-unrestricted

# Uninstall
dsh plugin --profile web remove dsh-unrestricted
```

Restart `dsh web` or DSH Desktop after installing, then enable both the plugin switch under **Plugins** and **"Enable unrestricted mode"** inside its settings card. Additional card features:

- **Strip Host Brand Identity**: Independently removes `DeepSeek Harness` / `DSH` identity sections and Web GUI checkout context to avoid HTTP `429` client-fingerprinting blocks on third-party proxy routes.
- **Mode Coverage & Prompt Preview**: Inspect and copy the full assembled system prompt across Standard, PTC, Cordis, and Minimal modes.

## Development & Testing

```sh
pnpm install
pnpm typecheck && pnpm build && pnpm test

node tools/dump-prompts.mjs --repo <dsh-repo-path> --out tests/fixtures
node tools/verify-live.mjs --repo <dsh-repo-path>
```

## License & Credits

- Prompt rule structure adapted from [Jia-Ethan/codex-keysmith](https://github.com/Jia-Ethan/codex-keysmith) (MIT License); see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- Released under the [MIT License](LICENSE).
