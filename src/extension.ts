import * as path from 'path';
import * as fs from 'fs';
import { workspace, ExtensionContext, window, commands, Uri, OutputChannel, Terminal } from 'vscode';
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
} from 'vscode-languageclient/node';

let client: LanguageClient | undefined;
let outputChannel: OutputChannel;
let mipsTerminal: Terminal | undefined;
let serverPath: string = '';
let javaPath: string = 'java';
let extensionPath: string = '';

export function activate(context: ExtensionContext) {
    console.log('MIPS Extension: activate() called');

    // Store extension path for finding bundled resources
    extensionPath = context.extensionPath;

    // Create output channel
    outputChannel = window.createOutputChannel('MIPS');
    context.subscriptions.push(outputChannel);
    outputChannel.appendLine('MIPS Extension activating...');

    // Get configuration
    const config = workspace.getConfiguration('mips');
    javaPath = config.get<string>('javaPath', 'java');
    serverPath = config.get<string>('serverPath', '');

    // Use bundled server in extension directory only (no external paths)
    if (!serverPath) {
        const bundledServer = path.join(extensionPath, 'server');
        if (fs.existsSync(path.join(bundledServer, 'classes'))) {
            serverPath = bundledServer;
        }
    }

    // Register commands FIRST (before potentially failing on LSP)
    console.log('MIPS Extension: registering commands...');
    const assembleCommand = commands.registerCommand('mips.assemble', runAssemble);
    const runCommand = commands.registerCommand('mips.run', runProgram);

    context.subscriptions.push(assembleCommand);
    context.subscriptions.push(runCommand);
    setupTerminalCleanup(context);
    console.log('MIPS Extension: commands registered');

    // Now try to start LSP (if we have a server path)
    if (!serverPath) {
        window.showWarningMessage(
            'MIPS: Server path not found. Set mips.serverPath in settings for LSP features.'
        );
        outputChannel.appendLine('Server path not configured. Commands will work but LSP features disabled.');
        outputChannel.appendLine('Set mips.serverPath to enable hover, go-to-definition, etc.');
        return;
    }

    outputChannel.appendLine(`MIPS Extension activated. Server path: ${serverPath}`);

    // Start LSP
    try {
        const classPath = buildClassPath(serverPath);

        const serverOptions: ServerOptions = {
            command: javaPath,
            args: ['-cp', classPath, 'com.mips.lsp.Main'],
            options: { cwd: serverPath }
        };

        const clientOptions: LanguageClientOptions = {
            documentSelector: [{ scheme: 'file', language: 'mips' }],
            synchronize: {
                fileEvents: workspace.createFileSystemWatcher('**/*.{s,asm,mips}')
            },
            outputChannel: outputChannel
        };

        client = new LanguageClient(
            'mipsLanguageServer',
            'MIPS Language Server',
            serverOptions,
            clientOptions
        );

        client.start().catch((err: Error) => {
            outputChannel.appendLine(`LSP Error: ${err.message}`);
            window.showWarningMessage(`MIPS LSP failed to start: ${err.message}`);
        });
    } catch (err: any) {
        outputChannel.appendLine(`Failed to initialize LSP: ${err.message}`);
    }
}

async function runAssemble() {
    const editor = window.activeTextEditor;
    if (!editor) {
        window.showErrorMessage('No active editor');
        return;
    }

    const doc = editor.document;
    await doc.save();

    const filePath = doc.uri.fsPath;
    const outputPath = filePath.replace(/\.[^.]+$/, '.hex');

    if (!serverPath) {
        window.showErrorMessage('MIPS: Server path not configured. Set mips.serverPath in settings.');
        return;
    }

    const { exec } = require('child_process');
    const classPath = buildClassPath(serverPath);
    const cmd = `"${javaPath}" -cp "${classPath}" com.mips.runtime.Main -o "${outputPath}" "${filePath}"`;

    outputChannel.appendLine(`Assembling: ${filePath}`);
    outputChannel.show(true);

    exec(cmd, { cwd: serverPath }, (error: any, _stdout: string, stderr: string) => {
        if (error) {
            outputChannel.appendLine(`Error: ${stderr || error.message}`);
            window.showErrorMessage(`Assembly failed. See MIPS output.`);
        } else {
            if (stderr) {
                outputChannel.appendLine(`Warnings:\n${stderr}`);
            }
            outputChannel.appendLine(`Success: ${outputPath}`);
            window.showInformationMessage(`Assembled: ${path.basename(outputPath)}`);
            workspace.openTextDocument(Uri.file(outputPath)).then((openedDoc) => {
                window.showTextDocument(openedDoc, { preview: true, viewColumn: 2 });
            });
        }
    });
}

async function runProgram() {
    const editor = window.activeTextEditor;
    if (!editor) {
        window.showErrorMessage('No active editor');
        return;
    }

    const doc = editor.document;
    await doc.save();

    const filePath = doc.uri.fsPath;
    const fileName = path.basename(filePath);
    const fileDir = path.dirname(filePath);

    // Get configuration
    const config = workspace.getConfiguration('mips');
    const selfModifyingCode = config.get<boolean>('selfModifyingCode', false);
    const cleanOutput = config.get<boolean>('cleanOutput', true);

    // Find MARS JAR
    const marsPath = findMarsJar(filePath);
    if (!marsPath) {
        window.showErrorMessage('MARS simulator JAR not found. Ensure the extension is properly installed.');
        return;
    }

    // Dispose of previous terminal if it exists and create a new one
    if (mipsTerminal) {
        mipsTerminal.dispose();
    }

    mipsTerminal = window.createTerminal({
        name: `MIPS: ${fileName}`,
        cwd: fileDir
    });

    const smcFlag = selfModifyingCode ? 'smc' : '';
    const runCmd = `"${javaPath}" -jar "${marsPath}" nc ${smcFlag} "${filePath}"`.replace(/\s+/g, ' ');

    mipsTerminal.show(true);

    if (cleanOutput) {
        // Clear screen before running - hides the command
        const isWindows = process.platform === 'win32';
        const clearCmd = isWindows ? 'cls' : 'clear';
        mipsTerminal.sendText(`${clearCmd} && ${runCmd}`);
    } else {
        // Run without clearing - command stays visible
        mipsTerminal.sendText(runCmd);
    }

    outputChannel.appendLine(`Running: ${filePath}`);
}

/**
 * Find the MARS JAR file.
 * Only searches within the extension bundle (no external paths).
 */
function findMarsJar(_currentFile: string): string | null {
    // Only check bundled with extension (no external paths)
    const marsLocations: string[] = [];

    if (extensionPath) {
        marsLocations.push(
            path.join(extensionPath, 'Mars.jar'),
            path.join(extensionPath, 'bin', 'Mars.jar')
        );
    }

    for (const loc of marsLocations) {
        if (fs.existsSync(loc)) {
            return loc;
        }
    }

    outputChannel.appendLine('MARS not found. Searched:');
    for (const loc of marsLocations) {
        outputChannel.appendLine(`  - ${loc}`);
    }
    return null;
}

// Clean up terminal on window close
function setupTerminalCleanup(context: ExtensionContext) {
    context.subscriptions.push(
        window.onDidCloseTerminal((closedTerminal) => {
            if (closedTerminal === mipsTerminal) {
                mipsTerminal = undefined;
            }
        })
    );
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        return undefined;
    }
    return client.stop();
}

function buildClassPath(basePath: string): string {
    const sep = process.platform === 'win32' ? ';' : ':';

    // Check if this is bundled layout (server/classes) or dev layout (out/classes)
    const bundledClasses = path.join(basePath, 'classes');
    const devClasses = path.join(basePath, 'out', 'classes');

    let classesDir: string;
    let libsDir: string;

    if (fs.existsSync(bundledClasses)) {
        // Bundled layout: server/classes, server/libs
        classesDir = bundledClasses;
        libsDir = path.join(basePath, 'libs', '*');
    } else {
        // Development layout: out/classes, libs
        classesDir = devClasses;
        libsDir = path.join(basePath, 'libs', '*');
    }

    return `${classesDir}${sep}${libsDir}`;
}
