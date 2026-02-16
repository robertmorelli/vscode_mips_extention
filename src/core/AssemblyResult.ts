/**
 * Result of an assembly operation.
 * Contains the assembled machine code, symbol table, and any errors/warnings.
 */

import { ProgramStatement } from './ProgramStatement';
import { ErrorList } from './ErrorList';

export class AssemblyResult {
    private statements: ProgramStatement[];
    private symbolTable: Map<string, number>;
    private errors: ErrorList;
    private successful: boolean;
    private dataSegment: Uint8Array | null;
    private dataSegmentBase: number;

    constructor(
        statements: ProgramStatement[],
        symbolTable: Map<string, number>,
        errors: ErrorList,
        dataSegment: Uint8Array | null = null,
        dataSegmentBase: number = 0x10010000
    ) {
        this.statements = statements;
        this.symbolTable = symbolTable;
        this.errors = errors;
        this.successful = !errors.errorsOccurred();
        this.dataSegment = dataSegment;
        this.dataSegmentBase = dataSegmentBase;
    }

    static failure(errors: ErrorList): AssemblyResult {
        return new AssemblyResult([], new Map(), errors, null, 0);
    }

    isSuccessful(): boolean {
        return this.successful;
    }

    getStatements(): ProgramStatement[] {
        return this.statements;
    }

    getSymbolTable(): Map<string, number> {
        return this.symbolTable;
    }

    getErrors(): ErrorList {
        return this.errors;
    }

    getDataSegment(): Uint8Array | null {
        return this.dataSegment;
    }

    getDataSegmentBase(): number {
        return this.dataSegmentBase;
    }

    /**
     * Returns a stripped binary: all instructions packed contiguously at i*4 offsets.
     * Does NOT reflect address gaps (e.g. from `.text 0x00400100` mid-file).
     * Use getStatements() for address-aware iteration.
     */
    getMachineCode(): Uint8Array {
        if (!this.successful || this.statements.length === 0) {
            return new Uint8Array(0);
        }

        const size = this.statements.length * 4;
        const code = new Uint8Array(size);

        for (let i = 0; i < this.statements.length; i++) {
            const instruction = this.statements[i].getMachineCode();
            const offset = i * 4;
            // Big-endian encoding
            code[offset] = (instruction >> 24) & 0xFF;
            code[offset + 1] = (instruction >> 16) & 0xFF;
            code[offset + 2] = (instruction >> 8) & 0xFF;
            code[offset + 3] = instruction & 0xFF;
        }

        return code;
    }

    getHexDump(): string {
        let result = '';
        for (const stmt of this.statements) {
            result += stmt.getMachineCode().toString(16).padStart(8, '0') + '\n';
        }
        return result;
    }
}
