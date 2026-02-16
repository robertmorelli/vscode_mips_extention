import * as vscode from 'vscode';
import { ZarsRuntime, StatusCode } from './zarsRuntime';

let panel: vscode.WebviewPanel | undefined;

export async function openSimulator(runtime: ZarsRuntime, outputChannel: vscode.OutputChannel) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No active editor');
        return;
    }

    const doc = editor.document;
    await doc.save();

    const fileUri = doc.uri;
    const fileName = fileUri.path.split('/').pop() || 'unknown.s';
    const baseDirUri = vscode.Uri.joinPath(fileUri, '..');
    const sourceCode = await resolveIncludes(doc.getText(), baseDirUri);

    if (!runtime.isReady()) {
        vscode.window.showErrorMessage('Zars runtime not ready');
        return;
    }

    // Create or reveal panel
    if (panel) {
        panel.reveal(vscode.ViewColumn.Beside);
    } else {
        panel = vscode.window.createWebviewPanel(
            'mipsSimulator',
            'MIPS Simulator',
            vscode.ViewColumn.Active,
            { enableScripts: true, retainContextWhenHidden: true }
        );

        panel.onDidDispose(() => {
            panel = undefined;
        });
    }

    // Set HTML first, then wire up messages, then run
    panel.webview.html = getHtml(fileName);

    function postState(state: { statusCode: StatusCode; totalOutput: string }) {
        const regs = runtime.getRegisters();
        const done = state.statusCode === StatusCode.Halted;
        const needsInput = state.statusCode === StatusCode.NeedsInput;
        const isError = state.statusCode !== StatusCode.Ok
            && state.statusCode !== StatusCode.Halted
            && state.statusCode !== StatusCode.NeedsInput;

        const errorMessages: Record<number, string> = {
            [StatusCode.InvalidProgramLength]: 'Invalid program length',
            [StatusCode.ProgramNotLoaded]: 'Program not loaded',
            [StatusCode.ParseError]: 'Parse error - check your assembly syntax',
            [StatusCode.RuntimeError]: 'Runtime error',
        };

        panel?.webview.postMessage({
            command: 'result',
            output: state.totalOutput,
            registers: Array.from(regs || new Uint32Array(32)),
            hi: runtime.getHi(),
            lo: runtime.getLo(),
            pc: runtime.getPc(),
            success: !isError,
            done,
            needsInput,
            error: isError ? (errorMessages[state.statusCode] || 'Unknown error') : undefined,
        });
    }

    function loadAndRun(source: string) {
        const config = vscode.workspace.getConfiguration('mips');
        const selfModifyingCode = config.get<boolean>('selfModifyingCode', false);

        const loadStatus = runtime.loadProgram(source, {
            selfModifyingCode,
            delayedBranching: false,
        });

        if (loadStatus !== StatusCode.Ok) {
            postState({ statusCode: loadStatus, totalOutput: '' });
            return;
        }

        const state = runtime.runUntilInput();
        postState(state);
    }

    // Handle messages from webview
    panel.webview.onDidReceiveMessage(async (msg) => {
        if (msg.command === 'ready') {
            // Webview JS is loaded and listening — now run
            loadAndRun(sourceCode);
        } else if (msg.command === 'provide_input') {
            const status = runtime.appendInput(msg.text);
            if (status !== StatusCode.Ok) {
                panel?.webview.postMessage({ command: 'error', message: 'Failed to provide input' });
                return;
            }
            const state = runtime.runUntilInput();
            postState(state);
        }
    });
}

async function resolveIncludes(source: string, baseDirUri: vscode.Uri): Promise<string> {
    let result = source;
    let match;
    let maxIterations = 10;

    while (maxIterations-- > 0) {
        const matches: { fullMatch: string; filePath: string }[] = [];
        const regex = /^\s*\.include\s+"([^"]+)"\s*$/gm;
        while ((match = regex.exec(result)) !== null) {
            matches.push({ fullMatch: match[0], filePath: match[1] });
        }

        if (matches.length === 0) break;

        for (const { fullMatch, filePath } of matches) {
            const includeUri = vscode.Uri.joinPath(baseDirUri, filePath);

            try {
                const bytes = await vscode.workspace.fs.readFile(includeUri);
                const includedContent = new TextDecoder().decode(bytes);
                result = result.replace(fullMatch, `# BEGIN INCLUDE: ${filePath}\n${includedContent}\n# END INCLUDE: ${filePath}`);
            } catch (err: any) {
                // Leave in place
            }
        }
    }

    return result;
}

function getHtml(fileName: string): string {
    return `<!DOCTYPE html>
<html>
<head>
<style>
:root {
    --bg: var(--vscode-editor-background);
    --fg: var(--vscode-editor-foreground);
    --border: var(--vscode-panel-border);
    --input-bg: var(--vscode-input-background);
    --btn-bg: var(--vscode-button-background);
    --btn-fg: var(--vscode-button-foreground);
    --success: var(--vscode-terminal-ansiGreen);
    --error: var(--vscode-errorForeground);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
    font-family: var(--vscode-font-family);
    background: var(--bg);
    color: var(--fg);
    padding: 16px;
    height: 100vh;
    display: flex;
    flex-direction: column;
}
.header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 16px;
}
h1 { font-size: 16px; font-weight: 500; }
.file { font-size: 12px; opacity: 0.7; margin-left: 12px; }
.btn {
    background: var(--btn-bg);
    color: var(--btn-fg);
    border: none;
    padding: 6px 16px;
    cursor: pointer;
    font-size: 13px;
}
.btn:hover { opacity: 0.9; }
.error-banner {
    display: none;
    background: var(--error);
    color: #fff;
    padding: 8px 12px;
    font-size: 13px;
    margin-bottom: 12px;
}
.main {
    display: grid;
    grid-template-columns: 220px 1fr;
    gap: 16px;
    flex: 1;
    min-height: 0;
    overflow: hidden;
}
.registers {
    overflow-y: auto;
    background: var(--input-bg);
    padding: 8px;
    border: 1px solid var(--border);
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: var(--vscode-editor-font-size, 13px);
}
.reg-title {
    font-size: 10px;
    text-transform: uppercase;
    opacity: 0.5;
    margin: 8px 0 4px;
}
.reg-title:first-child { margin-top: 0; }
.reg {
    display: flex;
    justify-content: space-between;
    padding: 1px 4px;
}
.reg-name { color: var(--vscode-symbolIcon-variableForeground, #9cdcfe); }
.reg-val { color: var(--vscode-debugTokenExpression-number, #b5cea8); }
.right {
    display: flex;
    flex-direction: column;
    gap: 12px;
    min-height: 0;
}
.output-box {
    flex: 1;
    background: var(--input-bg);
    border: 1px solid var(--border);
    padding: 12px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: var(--vscode-editor-font-size, 13px);
    overflow-y: auto;
    white-space: pre-wrap;
}
.input-area {
    display: none;
    flex-direction: column;
    gap: 4px;
}
.input-area label { font-size: 12px; }
.input-area textarea {
    background: var(--input-bg);
    color: var(--fg);
    border: 1px solid var(--border);
    padding: 8px;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: var(--vscode-editor-font-size, 13px);
    resize: none;
}
</style>
</head>
<body>
<div class="header">
    <div style="display:flex;align-items:center">
        <h1>MIPS Simulator</h1>
        <span class="file">${fileName}</span>
    </div>
</div>
<div id="errorBanner" class="error-banner"></div>
<div class="main">
    <div class="registers" id="regs"></div>
    <div class="right">
        <div class="output-box" id="output"></div>
        <div class="input-area" id="inputArea">
            <label>Program is waiting for input:</label>
            <div style="display:flex;gap:8px">
                <textarea id="stdin" rows="1" placeholder="Type input and press Enter" style="flex:1"></textarea>
                <button class="btn" id="sendInput">Send</button>
            </div>
        </div>
    </div>
</div>
<script>
const vscode = acquireVsCodeApi();
const REGS = ['$zero','$at','$v0','$v1','$a0','$a1','$a2','$a3','$t0','$t1','$t2','$t3','$t4','$t5','$t6','$t7','$s0','$s1','$s2','$s3','$s4','$s5','$s6','$s7','$t8','$t9','$k0','$k1','$gp','$sp','$fp','$ra'];

function hex(v) { return '0x' + ((v>>>0).toString(16)).padStart(8,'0').toUpperCase(); }

function showRegs(regs, hi, lo, pc) {
    let h = '<div class="reg-title">Special</div>';
    h += '<div class="reg"><span class="reg-name">PC</span><span class="reg-val">'+hex(pc)+'</span></div>';
    h += '<div class="reg"><span class="reg-name">HI</span><span class="reg-val">'+hex(hi)+'</span></div>';
    h += '<div class="reg"><span class="reg-name">LO</span><span class="reg-val">'+hex(lo)+'</span></div>';
    h += '<div class="reg-title">General</div>';
    for(let i=0;i<32;i++) h += '<div class="reg"><span class="reg-name">'+REGS[i]+'</span><span class="reg-val">'+hex(regs[i])+'</span></div>';
    document.getElementById('regs').innerHTML = h;
}

function showError(msg) {
    const el = document.getElementById('errorBanner');
    el.style.display = 'block';
    el.textContent = msg;
}

function hideError() {
    document.getElementById('errorBanner').style.display = 'none';
}

function toggleInput(show) {
    document.getElementById('inputArea').style.display = show ? 'flex' : 'none';
    if (show) document.getElementById('stdin').focus();
}

document.getElementById('sendInput').onclick = () => {
    const el = document.getElementById('stdin');
    const text = el.value + '\\n';
    el.value = '';
    toggleInput(false);
    vscode.postMessage({ command: 'provide_input', text: text });
};

document.getElementById('stdin').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        document.getElementById('sendInput').click();
    }
});

window.addEventListener('message', e => {
    const m = e.data;
    if (m.command === 'result') {
        hideError();
        document.getElementById('output').textContent = m.output || '(no output)';
        showRegs(m.registers, m.hi, m.lo, m.pc);
        if (m.needsInput) {
            toggleInput(true);
        } else {
            toggleInput(false);
        }
        if (!m.success) {
            showError(m.error || 'Error');
        }
    }
    if (m.command === 'error') {
        showError(m.message);
    }
});

showRegs(new Array(32).fill(0), 0, 0, 0);

// Tell the extension we're ready to receive data
vscode.postMessage({ command: 'ready' });
</script>
</body>
</html>`;
}
