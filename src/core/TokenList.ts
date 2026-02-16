/**
 * A list of tokens representing a single line of MIPS source code.
 */

import { Token } from './Token';

export class TokenList {
    private tokens: Token[];
    private processedLine: string;
    private lineNumber: number;
    private filename: string;

    constructor(tokens?: Token[], lineNumber?: number, filename?: string) {
        this.tokens = tokens || [];
        this.lineNumber = lineNumber || 0;
        this.filename = filename || '';
        this.processedLine = '';
    }

    get(index: number): Token {
        return this.tokens[index];
    }

    size(): number {
        return this.tokens.length;
    }

    isEmpty(): boolean {
        return this.tokens.length === 0;
    }

    getProcessedLine(): string {
        return this.processedLine;
    }

    setProcessedLine(line: string): void {
        this.processedLine = line;
    }

    getLineNumber(): number {
        return this.lineNumber;
    }

    getFilename(): string {
        return this.filename;
    }

    toString(): string {
        const parts = this.tokens.map(t => t.getValue());
        return `TokenList[${parts.join(', ')}]`;
    }
}
