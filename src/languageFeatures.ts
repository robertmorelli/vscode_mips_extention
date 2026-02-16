/**
 * VSCode adapter — thin bridge from MipsLanguageService to vscode provider APIs.
 */

import * as vscode from 'vscode';
import { MipsLanguageService, CompletionKind } from './languageService';
import { VscodeSourceResolver } from './sourceResolver';

const MIPS_SELECTOR: vscode.DocumentSelector = { language: 'mips' };

const COMPLETION_KIND_MAP: Record<CompletionKind, vscode.CompletionItemKind> = {
    'function': vscode.CompletionItemKind.Function,
    'keyword': vscode.CompletionItemKind.Keyword,
    'variable': vscode.CompletionItemKind.Variable,
};

export function registerLanguageFeatures(context: vscode.ExtensionContext): void {
    const service = new MipsLanguageService();
    const sourceResolver = new VscodeSourceResolver();
    const diagnostics = vscode.languages.createDiagnosticCollection('mips');
    context.subscriptions.push(diagnostics);

    // ── Diagnostics ────────────────────────────────────

    const validate = (doc: vscode.TextDocument) => {
        if (doc.languageId !== 'mips') { return; }
        const diags = service.getDiagnostics(doc.uri.toString(), doc.getText(), sourceResolver);
        diagnostics.set(doc.uri, diags.map(d => {
            const range = new vscode.Range(d.line, d.col, d.line, d.col + 1);
            const severity = d.severity === 'error'
                ? vscode.DiagnosticSeverity.Error
                : vscode.DiagnosticSeverity.Warning;
            const diag = new vscode.Diagnostic(range, d.message, severity);
            diag.source = 'mips';
            return diag;
        }));
    };

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(validate),
        vscode.workspace.onDidChangeTextDocument(e => validate(e.document)),
        vscode.workspace.onDidCloseTextDocument(doc => diagnostics.delete(doc.uri)),
    );

    for (const doc of vscode.workspace.textDocuments) { validate(doc); }

    // ── Hover ──────────────────────────────────────────

    context.subscriptions.push(
        vscode.languages.registerHoverProvider(MIPS_SELECTOR, {
            provideHover(doc, pos) {
                const lines = doc.getText().split('\n');
                const result = service.getHover(lines, pos.line, pos.character);
                if (!result) { return null; }
                const range = new vscode.Range(
                    result.range.startLine, result.range.startCol,
                    result.range.endLine, result.range.endCol,
                );
                return new vscode.Hover(new vscode.MarkdownString(result.contents), range);
            },
        }),
    );

    // ── Completions ────────────────────────────────────

    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(MIPS_SELECTOR, {
            provideCompletionItems() {
                return service.getCompletions().map(c => {
                    const item = new vscode.CompletionItem(c.label, COMPLETION_KIND_MAP[c.kind]);
                    item.detail = c.detail;
                    return item;
                });
            },
        }, '.', '$'),
    );

    // ── Go-to-Definition ───────────────────────────────

    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(MIPS_SELECTOR, {
            provideDefinition(doc, pos) {
                const lines = doc.getText().split('\n');
                const result = service.getDefinition(doc.uri.toString(), lines, pos.line, pos.character);
                if (!result) { return null; }
                return new vscode.Location(
                    vscode.Uri.parse(result.uri),
                    new vscode.Range(result.line, result.col, result.line, result.endCol),
                );
            },
        }),
    );
}
