/**
 * Represents a single token from the MIPS source code.
 */

import { TokenType } from './TokenType';

export class Token {
    private type: TokenType;
    private value: string;
    private filename: string;
    private line: number;
    private startPos: number;

    constructor(type: TokenType, value: string, filename: string, line: number, startPos: number) {
        this.type = type;
        this.value = value;
        this.filename = filename;
        this.line = line;
        this.startPos = startPos;
    }

    getType(): TokenType {
        return this.type;
    }

    setType(type: TokenType): void {
        this.type = type;
    }

    getValue(): string {
        return this.value;
    }

    getFilename(): string {
        return this.filename;
    }

    getLine(): number {
        return this.line;
    }

    getStartPos(): number {
        return this.startPos;
    }

    toString(): string {
        return `Token[${this.type}, '${this.value}', line ${this.line}, pos ${this.startPos}]`;
    }
}
