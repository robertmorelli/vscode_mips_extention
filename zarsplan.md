# Zars MIPS Simulator - Custom View Plan

## Overview

Replace the terminal-based output with a custom VSCode Webview panel that provides a proper MIPS simulator experience. This view will display registers, memory, program output, and handle user input in a unified interface.

## UI Layout

```
┌─────────────────────────────────────────────────────────┐
│  MIPS Simulator                            [Run] [Stop] │
├──────────────────────┬──────────────────────────────────┤
│  Registers           │  Output                          │
│  ──────────────────  │  ────────────────────────────    │
│  $zero: 0x00000000   │  Hello, World!                   │
│  $at:   0x00000001   │  Result: 42                      │
│  $v0:   0x0000002A   │                                  │
│  $v1:   0x00000000   │                                  │
│  $a0:   0x10010000   │                                  │
│  ...                 │                                  │
│                      ├──────────────────────────────────┤
│  $sp:   0x7FFFEFFC   │  Input                           │
│  $ra:   0x00400024   │  ┌────────────────────────────┐  │
│                      │  │ > _                        │  │
│  HI:   0x00000000    │  └────────────────────────────┘  │
│  LO:   0x00000000    │                                  │
├──────────────────────┴──────────────────────────────────┤
│  Memory (Data Segment)                    0x10010000    │
│  ─────────────────────────────────────────────────────  │
│  10010000: 48 65 6C 6C 6F 00 00 00  Hello...            │
│  10010008: 00 00 00 2A 00 00 00 00  ...*....            │
└─────────────────────────────────────────────────────────┘
```

## Features

### Core Features

- **Register Display**: All 32 general-purpose registers + HI/LO + PC
  - Highlight registers that changed since last execution
  - Show values in hex (with option for decimal)
  - Group by convention ($a0-$a3, $t0-$t9, $s0-$s7, etc.)

- **Program Output**: Display stdout from syscalls
  - Monospace font, scrollable
  - Clear output button
  - Copy to clipboard

- **Input Field**: Handle stdin for read syscalls
  - Input queues up for the next read syscall
  - Visual indicator when program is waiting for input
  - Support for entering multiple inputs (one per line)

- **Memory Inspector**: View data segment and heap
  - Hex dump with ASCII representation
  - Navigate to specific addresses
  - Highlight recently written memory

- **Controls**:
  - Run (execute entire program)
  - Stop (halt execution - requires step-based zars)
  - Clear (reset output and input)

### Future Features (with zars stepping support)

- **Step Execution**: Execute one instruction at a time
- **Breakpoints**: Pause at specific addresses
- **PC Indicator**: Show current instruction
- **Execution Speed**: Adjustable delay between steps
- **Call Stack**: Show function call history

## Technical Implementation

### Extension Side (`src/simulatorView.ts`)

```typescript
import * as vscode from 'vscode';
import { ZarsRuntime, ZarsExecutionResult } from './zarsRuntime';

export class SimulatorViewProvider {
    private panel: vscode.WebviewPanel | undefined;
    private runtime: ZarsRuntime;

    constructor(runtime: ZarsRuntime) {
        this.runtime = runtime;
    }

    public show(context: vscode.ExtensionContext) {
        this.panel = vscode.window.createWebviewPanel(
            'mipsSimulator',
            'MIPS Simulator',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        this.panel.webview.html = this.getHtml();
        this.setupMessageHandler();
    }

    private setupMessageHandler() {
        this.panel?.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'run':
                    await this.runProgram(message.source, message.stdin);
                    break;
                case 'stop':
                    // Future: stop execution
                    break;
            }
        });
    }

    private async runProgram(source: string, stdin: string) {
        const result = this.runtime.execute(source, stdin, {});

        // Send results to webview
        this.panel?.webview.postMessage({
            command: 'executionResult',
            output: result.output,
            registers: Array.from(result.registers || []),
            success: result.success,
            error: result.error
        });

        // Send memory state
        const dataSegment = this.runtime.getDataSegment();
        const heap = this.runtime.getHeap();
        this.panel?.webview.postMessage({
            command: 'memoryUpdate',
            data: Array.from(dataSegment || []),
            heap: Array.from(heap || []),
            dataBase: 0x10010000,
            heapBase: 0x10040000
        });
    }

    private getHtml(): string {
        // Return the webview HTML (see below)
    }
}
```

### Webview HTML/CSS/JS (`media/simulator.html`)

```html
<!DOCTYPE html>
<html>
<head>
    <style>
        :root {
            --bg-primary: var(--vscode-editor-background);
            --bg-secondary: var(--vscode-sideBar-background);
            --text-primary: var(--vscode-editor-foreground);
            --text-muted: var(--vscode-descriptionForeground);
            --border: var(--vscode-panel-border);
            --highlight: var(--vscode-editorWarning-foreground);
            --success: var(--vscode-terminal-ansiGreen);
            --error: var(--vscode-errorForeground);
        }

        body {
            font-family: var(--vscode-font-family);
            background: var(--bg-primary);
            color: var(--text-primary);
            margin: 0;
            padding: 16px;
        }

        .container {
            display: grid;
            grid-template-columns: 250px 1fr;
            grid-template-rows: auto 1fr 200px;
            gap: 16px;
            height: calc(100vh - 32px);
        }

        .header {
            grid-column: 1 / -1;
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding-bottom: 8px;
            border-bottom: 1px solid var(--border);
        }

        .registers {
            grid-row: 2 / 4;
            overflow-y: auto;
            font-family: var(--vscode-editor-font-family);
            font-size: 13px;
        }

        .register-row {
            display: flex;
            justify-content: space-between;
            padding: 2px 8px;
        }

        .register-row.changed {
            background: var(--highlight);
            color: var(--bg-primary);
        }

        .output {
            background: var(--bg-secondary);
            padding: 12px;
            overflow-y: auto;
            font-family: var(--vscode-editor-font-family);
            white-space: pre-wrap;
        }

        .input-section {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .input-field {
            background: var(--bg-secondary);
            border: 1px solid var(--border);
            color: var(--text-primary);
            padding: 8px;
            font-family: var(--vscode-editor-font-family);
        }

        .memory {
            grid-column: 1 / -1;
            background: var(--bg-secondary);
            padding: 12px;
            overflow-y: auto;
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
        }

        .memory-row {
            display: flex;
            gap: 16px;
        }

        .btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 14px;
            cursor: pointer;
        }

        .btn:hover {
            background: var(--vscode-button-hoverBackground);
        }

        .status {
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
        }

        .status.running { background: var(--highlight); }
        .status.success { background: var(--success); }
        .status.error { background: var(--error); }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h2>MIPS Simulator</h2>
            <div>
                <span id="status" class="status">Ready</span>
                <button class="btn" id="runBtn">Run</button>
                <button class="btn" id="clearBtn">Clear</button>
            </div>
        </div>

        <div class="registers" id="registers">
            <!-- Populated by JS -->
        </div>

        <div class="output" id="output"></div>

        <div class="input-section">
            <label>Input (one value per line):</label>
            <textarea class="input-field" id="stdin" rows="3"
                placeholder="Enter input values..."></textarea>
        </div>

        <div class="memory" id="memory">
            <!-- Populated by JS -->
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        const REGISTER_NAMES = [
            '$zero', '$at', '$v0', '$v1', '$a0', '$a1', '$a2', '$a3',
            '$t0', '$t1', '$t2', '$t3', '$t4', '$t5', '$t6', '$t7',
            '$s0', '$s1', '$s2', '$s3', '$s4', '$s5', '$s6', '$s7',
            '$t8', '$t9', '$k0', '$k1', '$gp', '$sp', '$fp', '$ra'
        ];

        let previousRegisters = new Array(32).fill(0);

        document.getElementById('runBtn').addEventListener('click', () => {
            vscode.postMessage({
                command: 'run',
                stdin: document.getElementById('stdin').value
            });
            setStatus('running', 'Running...');
        });

        document.getElementById('clearBtn').addEventListener('click', () => {
            document.getElementById('output').textContent = '';
            document.getElementById('stdin').value = '';
            setStatus('ready', 'Ready');
        });

        window.addEventListener('message', (event) => {
            const msg = event.data;

            if (msg.command === 'executionResult') {
                document.getElementById('output').textContent = msg.output;
                updateRegisters(msg.registers);
                setStatus(
                    msg.success ? 'success' : 'error',
                    msg.success ? 'Completed' : msg.error
                );
            }

            if (msg.command === 'memoryUpdate') {
                updateMemory(msg.data, msg.dataBase);
            }
        });

        function updateRegisters(registers) {
            const container = document.getElementById('registers');
            container.innerHTML = '';

            registers.forEach((value, i) => {
                const row = document.createElement('div');
                row.className = 'register-row';
                if (value !== previousRegisters[i]) {
                    row.classList.add('changed');
                }
                row.innerHTML = `
                    <span>${REGISTER_NAMES[i]}</span>
                    <span>0x${value.toString(16).padStart(8, '0').toUpperCase()}</span>
                `;
                container.appendChild(row);
            });

            previousRegisters = [...registers];
        }

        function updateMemory(data, baseAddr) {
            const container = document.getElementById('memory');
            container.innerHTML = '<strong>Data Segment</strong><br>';

            for (let i = 0; i < Math.min(data.length, 128); i += 8) {
                const addr = (baseAddr + i).toString(16).padStart(8, '0');
                const hex = data.slice(i, i + 8)
                    .map(b => b.toString(16).padStart(2, '0'))
                    .join(' ');
                const ascii = data.slice(i, i + 8)
                    .map(b => (b >= 32 && b < 127) ? String.fromCharCode(b) : '.')
                    .join('');

                const row = document.createElement('div');
                row.className = 'memory-row';
                row.innerHTML = `<span>${addr}:</span><span>${hex}</span><span>${ascii}</span>`;
                container.appendChild(row);
            }
        }

        function setStatus(type, text) {
            const el = document.getElementById('status');
            el.className = 'status ' + type;
            el.textContent = text;
        }

        // Initialize empty registers
        updateRegisters(new Array(32).fill(0));
    </script>
</body>
</html>
```

### Message Protocol

**Extension → Webview:**

```typescript
// Execution completed
{
    command: 'executionResult',
    output: string,
    registers: number[],
    success: boolean,
    error?: string
}

// Memory state update
{
    command: 'memoryUpdate',
    data: number[],
    heap: number[],
    dataBase: number,
    heapBase: number
}
```

**Webview → Extension:**

```typescript
// Run program
{
    command: 'run',
    stdin: string
}

// Stop execution (future)
{
    command: 'stop'
}
```

## File Structure

```
vscode-mips/
├── src/
│   ├── extension.ts          # Main extension, registers commands
│   ├── zarsRuntime.ts         # WASM wrapper (existing)
│   └── simulatorView.ts       # NEW: Webview panel provider
├── media/
│   └── simulator.html         # NEW: Webview content (or inline in TS)
└── package.json               # Add new command: mips.openSimulator
```

## Commands to Add

```json
{
    "commands": [
        {
            "command": "mips.openSimulator",
            "title": "MIPS: Open Simulator",
            "icon": "$(debug-console)"
        }
    ],
    "keybindings": [
        {
            "command": "mips.openSimulator",
            "key": "ctrl+shift+m",
            "mac": "cmd+shift+m",
            "when": "editorLangId == mips"
        }
    ]
}
```

## Implementation Phases

### Phase 1: Basic View
- [ ] Create WebviewPanel with layout
- [ ] Display registers after execution
- [ ] Display program output
- [ ] Basic input field
- [ ] Run button that executes current file

### Phase 2: Memory Inspector
- [ ] Display data segment
- [ ] Display heap
- [ ] Hex + ASCII view
- [ ] Address navigation

### Phase 3: Enhanced UX
- [ ] Highlight changed registers
- [ ] Copy output to clipboard
- [ ] Persist input history
- [ ] Dark/light theme support (VSCode native)

### Phase 4: Stepping (requires zars changes)
- [ ] Add `zars_step()` API to zars
- [ ] Step button in UI
- [ ] PC indicator
- [ ] Breakpoints

## Web Compatibility

This approach is fully web-compatible:
- Webviews work in vscode.dev
- WASM runs in browser
- No Node.js-specific APIs in the webview
- All communication via `postMessage`

## Resources

- [VSCode Webview API](https://code.visualstudio.com/api/extension-guides/webview)
- [Webview UI Toolkit](https://github.com/microsoft/vscode-webview-ui-toolkit) (optional, for native-looking components)
