/**
 * Plain data interfaces returned by MipsLanguageService.
 * No `vscode` or `node` imports — safe for any consumer.
 */

export interface HoverResult {
    /** Markdown content to display */
    contents: string;
    /** Range of the hovered word (0-based line/col) */
    range: {
        startLine: number;
        startCol: number;
        endLine: number;
        endCol: number;
    };
}

export type CompletionKind = 'function' | 'keyword' | 'variable';

export interface CompletionItemResult {
    label: string;
    kind: CompletionKind;
    detail: string;
}

export type DiagnosticSeverity = 'error' | 'warning';

export interface DiagnosticResult {
    line: number;
    col: number;
    message: string;
    severity: DiagnosticSeverity;
}

export interface LocationResult {
    uri: string;
    line: number;
    col: number;
    endCol: number;
}
