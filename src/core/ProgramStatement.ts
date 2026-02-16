/**
 * Represents a single assembled MIPS instruction.
 */

export class ProgramStatement {
    private source: string;
    private filename: string;
    private sourceLine: number;
    private address: number;
    private machineCode: number;
    private basicAssembly: string;

    constructor(source: string, filename: string, sourceLine: number,
                address: number, machineCode: number, basicAssembly: string) {
        this.source = source;
        this.filename = filename;
        this.sourceLine = sourceLine;
        this.address = address;
        this.machineCode = machineCode;
        this.basicAssembly = basicAssembly;
    }

    getSource(): string {
        return this.source;
    }

    getFilename(): string {
        return this.filename;
    }

    getSourceLine(): number {
        return this.sourceLine;
    }

    getAddress(): number {
        return this.address;
    }

    getMachineCode(): number {
        return this.machineCode;
    }

    getBasicAssembly(): string {
        return this.basicAssembly;
    }

    toString(): string {
        const addr = (this.address >>> 0).toString(16).padStart(8, '0');
        const code = (this.machineCode >>> 0).toString(16).padStart(8, '0');
        return `0x${addr}: 0x${code}  ${this.basicAssembly}`;
    }
}
