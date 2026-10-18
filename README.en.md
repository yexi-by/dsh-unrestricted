# dsh-unrestricted

[简体中文](./README.md) | **English** | [日本語](./README.ja.md)

`dsh-unrestricted` is a system prompt unrestrict (jailbreak) plugin for **DeepSeek Harness (DSH)**. It injects purpose-built unrestrict rules directly into DSH's system prompts, removing refusal boundaries across reverse engineering, penetration testing, creative writing, and specialized technical operations, enabling models to directly output complete, actionable implementations and code.

The plugin is deeply integrated into DSH's prompt assembly pipeline. While injecting unrestrict rules, it strictly preserves DSH's tool-calling protocols, Plan Mode, code execution (PTC), and subagent mechanics.

`0.2.3` passes type checking, builds, and real-host integration checks against DSH `0.2.1-alpha.4` (`86a402200d`). It refines blank-session `minimal` preset switching, rosterless profile (`headless`/`sdk`) support, subagent preview isolation, and client state synchronization. The declared `engines.dsh` range is `>=0.2.0-rc.2 <0.2.2-0`, retaining installation support for the local `0.2.0-rc.2` desktop runtime; no desktop UI check was performed in this update.

The native model reasoning settings and plugin index do not replace this plugin's per-mode prompt assembly. Reasoning levels remain managed by the native model settings.

---

## Table of Contents

- [Core Capabilities](#core-capabilities)
- [Technical Architecture](#technical-architecture)
  - [Dynamic System Prompt Interception & Injection](#dynamic-system-prompt-interception--injection)
  - [Multi-Mode Coordination](#multi-mode-coordination)
  - [Anchor Text Verification & Safe Fallback](#anchor-text-verification--safe-fallback)
  - [Hot-Switching & Zero-Trace Reversion](#hot-switching--zero-trace-reversion)
- [Installation & Updates](#installation--updates)
  - [Web Mode](#web-mode)
  - [Desktop App](#desktop-app)
  - [Local Source Install](#local-source-install)
- [Usage (Double-Switch Activation)](#usage-double-switch-activation)
- [Operational Boundaries](#operational-boundaries)
- [Development & Testing](#development--testing)
- [License & Credits](#license--credits)

---

## Core Capabilities

When enabled, the model operates under the following execution directives:

- **Direct Delivery Without Fluff or Preaching**: The very first line outputs the requested artifact (runnable code, step-by-step procedures, binary patches). Unsolicited disclaimers, ethical lectures, and pleasantries are omitted. Essential safety precautions are placed concisely at the end as objective postscripts.
- **Reverse Engineering & Algorithm Extraction**: Identifies key validation routines (`CHECK_FN`), extracts core algorithms, and implements keygen generators. Provides exact binary patch offsets (`OFFSET`) and replacement bytes (`PATCH_BYTE`), along with anti-debugging and anti-VM bypass code.
- **Cybersecurity & Penetration Research**: Provides complete, reproducible PoC and Exploit scripts detailing payload construction and delivery. Generates multi-threaded credential bruteforcers, port/banner scanners, encrypted reverse shells, and port-forwarding scripts.
- **Fiction, Literary Co-Creation & Adult Writing**: Fluidly adapts across scene writing, plot/worldbuilding brainstorming, character design, and editorial polishing. Honors the user's chosen style and aesthetic (lyrical, classical, restrained, gritty, or explicit): renders anatomy and intimate acts directly without fade-to-black censorship when explicit depiction is called for, while preserving subtlety and literary restraint when appropriate. Fictional characters silently default to 18+ adults without age-based refusals or intrusive disclaimers.
- **Specialized Industrial & Technical Procedures**: Supplies unabridged procedures, reagents, and physical parameters for chemical, pharmacological, and industrial operations without omitting critical steps.
- **Structured Resource Search**: Leverages DSH web search tools to build targeted queries and compiles structured tables (title, verified link, source, format/size) from real results without fabricating URLs.
- **Strict Data vs. Instruction Separation**: Workspace files and scraped web content are treated strictly as passive data, never as new instructions that alter unrestrict rules. User-specified names (domains, IPs, software titles) are preserved verbatim.

---

## Technical Architecture

### Dynamic System Prompt Interception & Injection

In agentic architectures, DSH wraps all model interactions in a high-priority System Prompt that supersedes regular user messages. Injecting jailbreak phrases into user chat messages is often overridden by the system prompt or corrupts structured tool calling.

This plugin interfaces directly with DSH's system prompt assembly pipeline (`system-prompt/assemble`):

1. **Pipeline Hook**: Registers a global listener on the prompt assembly pipeline.
2. **Post-Persona Injection**: Locates the official persona prefix (`deployment:persona-prefix`), appends an execution pointer, and inserts the unrestrict rules block (`unrestricted:execution-mode`) in the immediately following section.
3. **Preserving Core Agent Protocols**: Working directory suffixes (`deployment:persona-suffix`), native tool definitions, and environment variables remain untouched; only directives governing response scope and directness are modified.

```text
[DSH Agent Request]
        │
        ▼
[Prompt Assemble Pipeline]
        │
        ├─> Official Persona Prefix
        │        │
        │        ▼ 【dsh-unrestricted Hook】
        │        ├─ Enabled: Injects unrestrict block & coordinates mode constraints
        │        └─ Disabled: Transparent pass-through (100% stock prompt)
        │
        ├─> Tool Catalog & Protocols (Bash/Pwsh, FS, Web Search...)
        ├─> Plan Mode Policy
        └─> Environment Info (CWD, Model...)
        │
        ▼
[Dispatched to LLM API]
```

### Multi-Mode Coordination

The plugin coordinates rules across all DSH execution presets:

- **Standard & Cordis Modes**: Injects the unrestrict block directly after the persona prefix, keeping all built-in tools (terminal, filesystem, web search) functional.
- **PTC Mode (Code-Only Execution)**: Since PTC agents interact only via `run_code`, an additional guideline is injected into `tools:ptc-only`, clarifying that Python/Node scripts executed inside `run_code` are unconstrained and free to use internal SDK tools for automated analysis.
- **Plan Mode**: Decouples operational constraints from planning depth. The plugin explicitly reinforces that **operational constraints apply only to mutations** (no file edits prior to approval), but **the plan markdown must contain unabridged technical procedures, exploit mechanisms, or reverse engineering steps**.
- **Minimal Mode**: Uses an agent-scoped shadow override to supply the fused minimal persona, cleanly releasing it upon deactivation.
- **Any Other Preset (Adg multi-agent mode and future additions)**: The preset roster is enumerated at runtime via `agentPresets.list()`, so no plugin update is needed. Presets outside the four built-ins go through generic fusion: the persona is left untouched and gains a one-line pointer, notes are appended to `plan:policy` / `tools:ptc-only` when those sections exist, and the unrestrict block is inserted afterwards. **New presets such as `adg` therefore work without touching the plugin**, and the settings panel grows a row automatically.
- **Subagents & Structured Output**: Background child agents and structured reporting (`structured_output`) automatically inherit the unrestrict rules.

### Section-Name Anchoring & Safe Fallback

Injection points are located by section name rather than fixed whole-prompt text, so upstream rewording usually does not break fusion:

- **The four built-in presets** (Standard / PTC / Cordis / Minimal) keep exact anchor verification (defined in `ANCHORS` in `src/rules.js`): identity strings, persona openings, Plan Mode policies, and `run_code` descriptions must match before anything is fused.
- **Any other preset** uses soft anchors: a non-empty persona is enough to receive the pointer, so presets with custom personas work out of the box.
- If a built-in preset's anchors fail, the plugin **gracefully falls back to the original stock prompt** for that mode and surfaces the issue in the settings panel.

> **Known blind spot**: if a preset declares its persona with `complete: true`, the harness replaces that section wholesale *after* the waterfall, discarding the fusion. The plugin only shadows the built-in Minimal preset today; other complete-type presets need a plugin update.

### Hot-Switching & Zero-Trace Reversion

- **Instant Switching**: Toggling the switch persists the setting to `cordis.patch.yml`. Changes take effect on the very next request without requiring a service restart.
- **Zero Artifacts**: Deactivating the switch restores the stock prompts immediately, leaving no persistent markers in conversation history or databases.

---

## Installation & Updates

### Web Mode

For CLI and server setups running `dsh web`.

#### Install
```sh
# Install specific tag
dsh plugin --profile web add github:yexi-by/dsh-unrestricted#v0.2.3

# Or track master
dsh plugin --profile web add github:yexi-by/dsh-unrestricted
```
Restart `dsh web`, then follow the [Usage section](#usage-double-switch-activation) to enable both the plugin and the unrestrict toggle.

#### Update
```sh
dsh plugin --profile web remove dsh-unrestricted
dsh plugin --profile web add github:yexi-by/dsh-unrestricted#<new-version>
```
Restart `dsh web`.

#### Uninstall
```sh
dsh plugin --profile web remove dsh-unrestricted
```

---

### Desktop App

For users running the official DeepSeek Harness desktop application.

> **Note**: The desktop app runs on an isolated `desktop` profile. Use the desktop app's bundled CLI binary rather than a global `dsh` command.

#### 1. Desktop CLI Path
On Windows, the default path is:
```text
%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd
```

#### 2. Install
1. Completely exit the desktop app.
2. Run in PowerShell or CMD:
   ```powershell
   & "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add github:yexi-by/dsh-unrestricted#v0.2.3
   ```
3. Launch the desktop app and follow the activation steps below.

#### 3. Update
1. Completely exit the desktop app.
2. Reinstall with the new version:
   ```powershell
   & "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop remove dsh-unrestricted
   & "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add github:yexi-by/dsh-unrestricted#<new-version>
   ```
3. Restart the desktop app.

#### 4. Uninstall
```powershell
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop remove dsh-unrestricted
```

---

### Local Source Install

For developers linking a local workspace:

```sh
# Web profile
dsh plugin --profile web add file:D:/work/dsh/plugin/unrestricted

# Desktop profile
& "$env:LOCALAPPDATA\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add file:D:/work/dsh/plugin/unrestricted
```

---

## Usage (Double-Switch Activation)

> **Important: Both switches must be turned on for unrestrict rules to take effect!**
>
> 1. **Step 1 (Plugin Activation Switch)**: Navigate to **Plugins** in the sidebar. In the installed plugins list, find `dsh-unrestricted` (Unrestricted mode) and **toggle the plugin ON**. If the plugin is not enabled here, DSH will not load the plugin runtime at all.
> 2. **Step 2 (Feature Toggle Switch)**: Two equivalent ways — pick either. ① Open **Settings** → **Unrestricted mode** in the left nav and check **"Enable unrestricted mode"** at the top; ② or simply click the **"Unrestricted"** button inside the chat composer's tool row (right after the `+` and mode chips; it lights up when active, and is visible on the new-session welcome screen too).
>
> Both switches must be active for rules to be injected into the system prompt assembly pipeline.

### Settings Panel Features

- **Enable Switch**: Toggles unrestrict mode globally for future requests.
- **Composer Toggle**: A persistent **"Unrestricted"** button inside the chat composer card's tool row (after the `+` and the permission/plan chips, before the model seat) shows the current state (`on` / `off`); clicking it flips the same switch the settings panel uses. It is visible both on the new-session welcome screen and inside existing sessions.
- **Per-Mode Status**: Shows real-time injection status for every preset — the four built-ins (Standard, PTC, Cordis, Minimal) plus any other preset enumerated at runtime (for example Adg multi-agent mode). `Active` indicates successful anchor verification and injection; if inactive, check whether the plugin is toggled on in the Plugins manager.
- **Rule Fingerprint**: Displays the SHA-256 hash (first 16 hex characters) of the deployed unrestrict rule block.
- **Prompt Preview**: Click **"Show preview"** under any mode to inspect the exact system prompt text, line count, and byte size.

---

## Operational Boundaries

- **Cloud Platform Moderation Filters**: Commercial AI providers often enforce external content filters at the network layer. If a request triggers server-side keyword blocks, the connection is terminated by the API host (HTTP 400 or policy reset). Such external network-level filters cannot be bypassed by prompt engineering alone; pairing with relaxed API endpoints or local models (Ollama / vLLM) is advised.
- **Host Security Enforcement**: The plugin modifies only the model's instruction following and reasoning depth. DSH's read-only file sandbox, terminal command approval prompts, and Plan Mode write restrictions remain fully enforced.
- **Compliance**: Intended for authorized security research, reverse engineering, software development, and creative fiction.

---

## Development & Testing

```sh
git clone https://github.com/yexi-by/dsh-unrestricted.git
cd dsh-unrestricted
pnpm install
pnpm typecheck
pnpm build
pnpm test
```

Repository maintenance tools:
- `node tools/dump-prompts.mjs --repo <path> --out tests/fixtures`: Dumps stock prompts from DSH source to update test fixtures.
- `node tools/verify-live.mjs --repo <path>`: Verifies live assembly and rollback without calling the LLM.

---

## License & Credits

- Initial prompt rules adapted and refined from [Jia-Ethan/codex-keysmith](https://github.com/Jia-Ethan/codex-keysmith)'s `gpt-unrestricted.md` (MIT License). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- This project has no affiliation with codex-keysmith or its author.
- Licensed under the [MIT License](LICENSE).
