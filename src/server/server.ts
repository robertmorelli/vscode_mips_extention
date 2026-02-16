/**
 * Standalone MIPS LSP server.
 * Runs over stdin/stdout — usable from Helix, Neovim, or any LSP client.
 */

import {
    createConnection,
    ProposedFeatures,
    TextDocuments,
    TextDocumentSyncKind,
    InitializeResult,
    CompletionItemKind,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { MipsLanguageService } from '../languageService';
import { ServerSourceResolver } from './serverSourceResolver';
import type { CompletionKind } from '../languageService';

// ── Bootstrap ──────────────────────────────────────────

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments<TextDocument>(TextDocument);
const service = new MipsLanguageService();
const sourceResolver = new ServerSourceResolver(documents);

// ── Lifecycle ──────────────────────────────────────────

connection.onInitialize((): InitializeResult => {
    return {
        capabilities: {
            textDocumentSync: TextDocumentSyncKind.Full,
            hoverProvider: true,
            completionProvider: { triggerCharacters: ['.', '$'] },
            definitionProvider: true,
        },
    };
});

connection.onInitialized(() => {
    connection.console.log('MIPS LSP server initialized');
});

// ── Diagnostics ────────────────────────────────────────

documents.onDidChangeContent(change => {
    const doc = change.document;
    const diags = service.getDiagnostics(doc.uri, doc.getText(), sourceResolver);

    connection.sendDiagnostics({
        uri: doc.uri,
        diagnostics: diags.map(d => ({
            range: {
                start: { line: d.line, character: d.col },
                end: { line: d.line, character: d.col + 1 },
            },
            severity: d.severity === 'error' ? 1 : 2,
            source: 'mips',
            message: d.message,
        })),
    });
});

// ── Hover ──────────────────────────────────────────────

connection.onHover(params => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) { return null; }

    const lines = doc.getText().split('\n');
    const result = service.getHover(lines, params.position.line, params.position.character);
    if (!result) { return null; }

    return {
        contents: { kind: 'markdown' as const, value: result.contents },
        range: {
            start: { line: result.range.startLine, character: result.range.startCol },
            end: { line: result.range.endLine, character: result.range.endCol },
        },
    };
});

// ── Completions ────────────────────────────────────────

const COMPLETION_KIND_MAP: Record<CompletionKind, CompletionItemKind> = {
    'function': CompletionItemKind.Function,
    'keyword': CompletionItemKind.Keyword,
    'variable': CompletionItemKind.Variable,
};

connection.onCompletion(() => {
    return service.getCompletions().map(item => ({
        label: item.label,
        kind: COMPLETION_KIND_MAP[item.kind],
        detail: item.detail,
    }));
});

// ── Go-to-Definition ───────────────────────────────────

connection.onDefinition(params => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc) { return null; }

    const lines = doc.getText().split('\n');
    const result = service.getDefinition(doc.uri, lines, params.position.line, params.position.character);
    if (!result) { return null; }

    return {
        uri: result.uri,
        range: {
            start: { line: result.line, character: result.col },
            end: { line: result.line, character: result.endCol },
        },
    };
});

// ── Shutdown ───────────────────────────────────────────

connection.onShutdown(() => {
    // nothing to clean up
});

// ── Start ──────────────────────────────────────────────

documents.listen(connection);
connection.listen();
