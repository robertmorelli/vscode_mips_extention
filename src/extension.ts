import { ExtensionContext, Uri, window, workspace, commands, OutputChannel } from 'vscode';
import { ZarsRuntime } from './zarsRuntime';
import { openSimulator } from './simulatorView';
import { registerLanguageFeatures } from './languageFeatures';

let outputChannel: OutputChannel;
let zarsRuntime: ZarsRuntime | undefined;

export async function activate(context: ExtensionContext) {
    console.log('MIPS Extension: activate() called');

    outputChannel = window.createOutputChannel('MIPS');
    context.subscriptions.push(outputChannel);
    outputChannel.appendLine('MIPS Extension activating...');

    // Initialize Zars WASM runtime
    const wasmUri = Uri.joinPath(context.extensionUri, 'wasm', 'zars_runtime.wasm');
    try {
        const wasmBytes = await workspace.fs.readFile(wasmUri);
        zarsRuntime = new ZarsRuntime();
        await zarsRuntime.loadFromBytes(wasmBytes);
        outputChannel.appendLine('Zars WASM runtime loaded successfully');
    } catch (err: any) {
        outputChannel.appendLine(`Failed to load Zars runtime: ${err.message}`);
        zarsRuntime = undefined;
    }

    // Register commands
    console.log('MIPS Extension: registering commands...');
    const assembleCommand = commands.registerCommand('mips.assemble', runAssemble);
    const runCommand = commands.registerCommand('mips.run', runProgram);

    context.subscriptions.push(assembleCommand);
    context.subscriptions.push(runCommand);
    console.log('MIPS Extension: commands registered');

    // Register language features (diagnostics, hover, completion, go-to-definition)
    registerLanguageFeatures(context);
    outputChannel.appendLine('Language features registered.');
}

async function runAssemble() {
    const editor = window.activeTextEditor;
    if (!editor) {
        window.showErrorMessage('No active editor');
        return;
    }

    const doc = editor.document;
    await doc.save();

    if (!zarsRuntime?.isReady()) {
        window.showErrorMessage('Zars runtime not available. Cannot assemble.');
        return;
    }

    const fileUri = doc.uri;
    outputChannel.appendLine(`Assembling: ${fileUri.toString()}`);
    outputChannel.show(true);

    const sourceCode = await resolveIncludes(doc.getText(), fileUri);

    const result = zarsRuntime.execute(sourceCode);
    if (result.success) {
        outputChannel.appendLine(`Assembly successful`);
        window.showInformationMessage('Assembly successful');
    } else {
        outputChannel.appendLine(`Assembly failed: ${result.error || 'Unknown error'}`);
        window.showErrorMessage(`Assembly failed: ${result.error || 'Unknown error'}`);
    }
}

async function runProgram() {
    const editor = window.activeTextEditor;
    if (!editor) {
        window.showErrorMessage('No active editor');
        return;
    }

    if (!zarsRuntime?.isReady()) {
        window.showErrorMessage('Zars runtime not available');
        return;
    }

    await editor.document.save();
    openSimulator(zarsRuntime, outputChannel);
}

/**
 * Resolve .include directives in source code.
 * Uses vscode.workspace.fs for browser compatibility.
 */
async function resolveIncludes(source: string, fileUri: Uri): Promise<string> {
    let result = source;
    let match;
    const baseDirUri = Uri.joinPath(fileUri, '..');

    let maxIterations = 10;
    while (maxIterations-- > 0) {
        const matches: { fullMatch: string; filePath: string }[] = [];
        const regex = /^\s*\.include\s+"([^"]+)"\s*$/gm;
        while ((match = regex.exec(result)) !== null) {
            matches.push({ fullMatch: match[0], filePath: match[1] });
        }

        if (matches.length === 0) break;

        for (const { fullMatch, filePath } of matches) {
            const includeUri = Uri.joinPath(baseDirUri, filePath);

            try {
                const bytes = await workspace.fs.readFile(includeUri);
                const includedContent = new TextDecoder().decode(bytes);
                result = result.replace(fullMatch, `# BEGIN INCLUDE: ${filePath}\n${includedContent}\n# END INCLUDE: ${filePath}`);
            } catch (err: any) {
                outputChannel.appendLine(`Warning: Could not resolve .include "${filePath}": ${err.message}`);
            }
        }
    }

    return result;
}

export function deactivate(): void {
    // Nothing to dispose — all subscriptions are managed via context.subscriptions
}
