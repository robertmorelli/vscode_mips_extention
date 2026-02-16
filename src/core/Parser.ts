/**
 * Syntactic analysis for MIPS assembly.
 * Two-pass parser: first pass collects labels/symbol table,
 * second pass validates instructions and generates machine code.
 */

import { DirectiveRegistry } from './DirectiveRegistry';
import { InstructionSet, Instruction, InstructionType } from './InstructionSet';
import { RegisterRegistry } from './RegisterRegistry';
import { TokenList } from './TokenList';
import { TokenType, isInteger } from './TokenType';
import { AssemblyResult } from './AssemblyResult';
import { ErrorList } from './ErrorList';
import { ErrorMessage } from './ErrorMessage';
import { ProgramStatement } from './ProgramStatement';

// Memory layout constants (MARS default)
const TEXT_BASE = 0x00400000;
const DATA_BASE = 0x10010000;
const MAX_DATA_SIZE = 0x100000; // 1MB data segment

// ── Opcode constants (I-type / J-type) ──
const OP = {
    REGIMM: 0x01,  // bgez/bltz/bgezal/bltzal share this
    J:      0x02,
    JAL:    0x03,
    BEQ:    0x04,
    BNE:    0x05,
    BLEZ:   0x06,
    BGTZ:   0x07,
    ADDI:   0x08,
    ADDIU:  0x09,
    SLTI:   0x0A,
    SLTIU:  0x0B,
    ANDI:   0x0C,
    ORI:    0x0D,
    XORI:   0x0E,
    LUI:    0x0F,
    COP1:   0x11,
    LB:     0x20,
    LH:     0x21,
    LWL:    0x22,
    LW:     0x23,
    LBU:    0x24,
    LHU:    0x25,
    LWR:    0x26,
    SB:     0x28,
    SH:     0x29,
    SWL:    0x2A,
    SW:     0x2B,
    SWR:    0x2E,
    LL:     0x30,
    LWC1:   0x31,
    LDC1:   0x35,
    SC:     0x38,
    SWC1:   0x39,
    SDC1:   0x3D,
} as const;

// ── Funct constants (R-type, opcode=0) ──
const FN = {
    SLL:    0x00,
    SRL:    0x02,
    SRA:    0x03,
    SLLV:   0x04,
    SRLV:   0x06,
    SRAV:   0x07,
    JR:     0x08,
    JALR:   0x09,
    SYSCALL:0x0C,
    BREAK:  0x0D,
    MFHI:   0x10,
    MTHI:   0x11,
    MFLO:   0x12,
    MTLO:   0x13,
    MULT:   0x18,
    MULTU:  0x19,
    DIV:    0x1A,
    DIVU:   0x1B,
    ADD:    0x20,
    ADDU:   0x21,
    SUB:    0x22,
    SUBU:   0x23,
    AND:    0x24,
    OR:     0x25,
    XOR:    0x26,
    NOR:    0x27,
    SLT:    0x2A,
    SLTU:   0x2B,
} as const;

// Register name -> number mapping (derived from RegisterRegistry)
const REGISTER_MAP = RegisterRegistry.getRegisterMap();

/** Mutable segment state shared across pass helpers */
interface SegmentState {
    textAddress: number;
    dataAddress: number;
    dataOffset: number;
    inTextSegment: boolean;
}

export class Parser {
    private instructionSet: InstructionSet;

    constructor(instructionSet: InstructionSet) {
        this.instructionSet = instructionSet;
    }

    parse(tokenizedLines: TokenList[], errors: ErrorList): AssemblyResult {
        const symbolTable = new Map<string, number>();
        const statements: ProgramStatement[] = [];
        const dataSegment = new Uint8Array(MAX_DATA_SIZE);
        const state: SegmentState = {
            textAddress: TEXT_BASE,
            dataAddress: DATA_BASE,
            dataOffset: 0,
            inTextSegment: true,
        };

        // ===== PASS 1: Collect labels and compute addresses =====
        for (const tokenList of tokenizedLines) {
            const idx = this.skipLabels(tokenList, 0, (labelName, token) => {
                const currentAddr = state.inTextSegment ? state.textAddress : state.dataAddress;
                if (symbolTable.has(labelName)) {
                    errors.add(new ErrorMessage(
                        token.getFilename(), token.getLine(), token.getStartPos(),
                        `Duplicate label: "${labelName}"`
                    ));
                } else {
                    symbolTable.set(labelName, currentAddr);
                }
            });

            if (idx >= tokenList.size()) continue;
            const firstToken = tokenList.get(idx);

            if (firstToken.getType() === TokenType.DIRECTIVE) {
                const dir = firstToken.getValue().toLowerCase();
                if (this.handleSegmentDirective(dir, tokenList, idx, state)) continue;

                if (!state.inTextSegment) {
                    const dataSize = this.computeDataDirectiveSize(dir, tokenList, idx, state.dataAddress);
                    state.dataAddress += dataSize;
                    state.dataOffset += dataSize;
                    continue;
                }
            }

            if (state.inTextSegment && firstToken.getType() === TokenType.OPERATOR) {
                const mnemonic = firstToken.getValue().toLowerCase();
                const inst = this.instructionSet.getInstruction(mnemonic);
                if (inst) {
                    const operands = this.extractOperands(tokenList, idx + 1);
                    const usePseudo = inst.isPseudo() || this.hasPseudoOverload(mnemonic, operands);
                    state.textAddress += usePseudo ? this.estimatePseudoSize(mnemonic) * 4 : 4;
                } else {
                    state.textAddress += 4;
                }
            }
        }

        // ===== PASS 2: Generate machine code =====
        state.textAddress = TEXT_BASE;
        state.dataAddress = DATA_BASE;
        state.dataOffset = 0;
        state.inTextSegment = true;

        for (const tokenList of tokenizedLines) {
            const idx = this.skipLabels(tokenList, 0);
            if (idx >= tokenList.size()) continue;

            const sourceLine = tokenList.getProcessedLine();
            const lineNum = tokenList.getLineNumber();
            const fname = tokenList.getFilename();
            const firstToken = tokenList.get(idx);

            if (firstToken.getType() === TokenType.DIRECTIVE) {
                const dir = firstToken.getValue().toLowerCase();
                if (this.handleSegmentDirective(dir, tokenList, idx, state)) continue;

                if (!state.inTextSegment) {
                    const written = this.processDataDirective(dir, tokenList, idx, dataSegment, state.dataOffset, state.dataAddress, symbolTable, errors);
                    state.dataAddress += written;
                    state.dataOffset += written;
                    continue;
                }
            }

            if (state.inTextSegment && firstToken.getType() === TokenType.OPERATOR) {
                const mnemonic = firstToken.getValue().toLowerCase();
                const operands = this.extractOperands(tokenList, idx + 1);
                const inst = this.instructionSet.getInstruction(mnemonic);

                if (!inst) {
                    errors.add(new ErrorMessage(fname, lineNum, firstToken.getStartPos(),
                        `Unknown instruction: "${mnemonic}"`));
                    state.textAddress += 4;
                    continue;
                }

                const usePseudo = inst.isPseudo() || this.hasPseudoOverload(mnemonic, operands);

                if (usePseudo) {
                    const expanded = this.expandPseudo(mnemonic, operands, state.textAddress, symbolTable, fname, lineNum, errors);
                    for (const code of expanded) {
                        statements.push(new ProgramStatement(
                            sourceLine, fname, lineNum, state.textAddress, code,
                            this.disassemble(code)
                        ));
                        state.textAddress += 4;
                    }
                } else {
                    const code = this.encodeInstruction(inst, operands, state.textAddress, symbolTable, fname, lineNum, errors);
                    statements.push(new ProgramStatement(
                        sourceLine, fname, lineNum, state.textAddress, code,
                        `${mnemonic} ${operands.join(', ')}`
                    ));
                    state.textAddress += 4;
                }
            }
        }

        const usedData = state.dataOffset > 0 ? dataSegment.slice(0, state.dataOffset) : null;
        return new AssemblyResult(statements, symbolTable, errors, usedData, DATA_BASE);
    }

    // ===== Shared pass helpers =====

    /**
     * Skip label definitions (identifier + colon pairs) at the start of a line.
     * Optionally invokes a callback for each label found (pass 1 uses this to populate the symbol table).
     * Returns the token index after all labels.
     */
    private skipLabels(
        tokenList: TokenList,
        startIdx: number,
        onLabel?: (name: string, token: { getFilename(): string; getLine(): number; getStartPos(): number }) => void,
    ): number {
        let idx = startIdx;
        const size = tokenList.size();
        if (size === 0) return idx;

        while (idx < size - 1 &&
               tokenList.get(idx).getType() === TokenType.IDENTIFIER &&
               tokenList.get(idx + 1).getType() === TokenType.COLON) {
            if (onLabel) {
                onLabel(tokenList.get(idx).getValue(), tokenList.get(idx));
            }
            idx += 2;
        }
        return idx;
    }

    /**
     * Handle segment-switching directives (.text, .data, .globl, .align).
     * Mutates `state` in place. Returns true if the directive was handled.
     */
    private handleSegmentDirective(dir: string, tokenList: TokenList, idx: number, state: SegmentState): boolean {
        const size = tokenList.size();

        if (dir === '.text') {
            state.inTextSegment = true;
            if (idx + 1 < size && isInteger(tokenList.get(idx + 1).getType())) {
                state.textAddress = this.parseIntValue(tokenList.get(idx + 1).getValue());
            }
            return true;
        }
        if (dir === '.data') {
            state.inTextSegment = false;
            if (idx + 1 < size && isInteger(tokenList.get(idx + 1).getType())) {
                state.dataAddress = this.parseIntValue(tokenList.get(idx + 1).getValue());
                state.dataOffset = state.dataAddress - DATA_BASE;
            }
            return true;
        }
        if (dir === '.globl' || dir === '.global') {
            return true;
        }
        if (dir === '.align') {
            if (idx + 1 < size && !state.inTextSegment) {
                const align = this.parseIntValue(tokenList.get(idx + 1).getValue());
                const boundary = 1 << align;
                const misalign = state.dataAddress % boundary;
                if (misalign !== 0) {
                    const padding = boundary - misalign;
                    state.dataAddress += padding;
                    state.dataOffset += padding;
                }
            }
            return true;
        }
        return false;
    }

    // ===== Operand extraction =====

    private extractOperands(tokenList: TokenList, startIdx: number): string[] {
        const operands: string[] = [];
        let current = '';
        let parenDepth = 0;

        for (let i = startIdx; i < tokenList.size(); i++) {
            const token = tokenList.get(i);
            const type = token.getType();

            if (type === TokenType.COMMA && parenDepth === 0) {
                if (current.length > 0) {
                    operands.push(current.trim());
                    current = '';
                }
                continue;
            }

            if (type === TokenType.LEFT_PAREN) {
                parenDepth++;
                current += '(';
                continue;
            }
            if (type === TokenType.RIGHT_PAREN) {
                parenDepth--;
                current += ')';
                continue;
            }

            current += token.getValue();
        }

        if (current.trim().length > 0) {
            operands.push(current.trim());
        }

        return operands;
    }

    // ===== Instruction encoding =====

    /** Count expected operands from a format string (e.g. 'rd, rs, rt' → 3, '' → 0) */
    private expectedOperandCount(format: string): number {
        if (format.length === 0) return 0;
        // Memory format 'rt, offset(rs)' has 2 user-facing operands
        if (format.includes('(')) return format.split(',').length;
        return format.split(',').length;
    }

    private encodeInstruction(inst: Instruction, operands: string[], pc: number,
                              symbols: Map<string, number>, filename: string, line: number,
                              errors: ErrorList): number {
        // Validate operand count (jalr allows 1 or 2, so allow fewer for 'rd, rs')
        const expected = this.expectedOperandCount(inst.getFormat());
        if (expected > 0 && operands.length > expected) {
            errors.add(ErrorMessage.warning(filename, line, 0,
                `"${inst.getMnemonic()}" expects ${expected} operand(s), got ${operands.length}; extra operands ignored`));
        } else if (operands.length < expected && inst.getFormat() !== 'rd, rs') {
            // rd, rs (jalr) allows 1 operand (defaults rd=$ra)
            errors.add(new ErrorMessage(filename, line, 0,
                `"${inst.getMnemonic()}" expects ${expected} operand(s), got ${operands.length}`));
        }

        try {
            switch (inst.getType()) {
                case InstructionType.R:
                    return this.encodeRType(inst, operands, symbols, filename, line, errors);
                case InstructionType.I:
                    return this.encodeIType(inst, operands, pc, symbols, filename, line, errors);
                case InstructionType.J:
                    return this.encodeJType(inst, operands, symbols, filename, line, errors);
                default:
                    return 0;
            }
        } catch (e: any) {
            errors.add(new ErrorMessage(filename, line, 0, e.message));
            return 0;
        }
    }

    private encodeRType(inst: Instruction, operands: string[], symbols: Map<string, number>,
                        filename: string, line: number, errors: ErrorList): number {
        const funct = inst.getFunct();
        const format = inst.getFormat();

        // No-operand specials
        if (format === '') {
            return this.encodeR(0, 0, 0, 0, funct);
        }

        // FP instructions (opcode 0x11): opcode(6) | fmt(5) | ft(5) | fs(5) | fd(5) | funct(6)
        if (inst.getOpcode() !== 0) {
            const fmt = inst.getFmt() ?? 0;
            return this.encodeFP(inst, operands, fmt, funct, filename, line, errors);
        }

        let rd = 0, rs = 0, rt = 0, shamt = 0;

        switch (format) {
            case 'rs':
                // jr
                rs = this.parseRegister(operands[0] || '', filename, line, errors);
                break;
            case 'rd, rs':
                // jalr (supports 1 or 2 operands: jalr $rs or jalr $rd, $rs)
                if (operands.length >= 2) {
                    rd = this.parseRegister(operands[0] || '', filename, line, errors);
                    rs = this.parseRegister(operands[1] || '', filename, line, errors);
                } else {
                    rd = 31; // $ra
                    rs = this.parseRegister(operands[0] || '', filename, line, errors);
                }
                break;
            case 'rd':
                // mfhi, mflo
                rd = this.parseRegister(operands[0] || '', filename, line, errors);
                break;
            case 'rs, rt':
                // mult, multu, div, divu
                rs = this.parseRegister(operands[0] || '', filename, line, errors);
                rt = this.parseRegister(operands[1] || '', filename, line, errors);
                break;
            case 'rd, rt, shamt':
                // sll, srl, sra
                rd = this.parseRegister(operands[0] || '', filename, line, errors);
                rt = this.parseRegister(operands[1] || '', filename, line, errors);
                shamt = this.parseImmediate(operands[2] || '0', symbols, filename, line, errors) & 0x1F;
                break;
            case 'rd, rt, rs':
                // sllv, srlv, srav
                rd = this.parseRegister(operands[0] || '', filename, line, errors);
                rt = this.parseRegister(operands[1] || '', filename, line, errors);
                rs = this.parseRegister(operands[2] || '', filename, line, errors);
                break;
            default:
                // Standard: rd, rs, rt (add, sub, and, or, xor, nor, slt, sltu)
                rd = this.parseRegister(operands[0] || '', filename, line, errors);
                rs = this.parseRegister(operands[1] || '', filename, line, errors);
                rt = this.parseRegister(operands[2] || '', filename, line, errors);
                break;
        }

        return this.encodeR(rs, rt, rd, shamt, funct);
    }

    /** Encode FP instruction: opcode(6) | fmt(5) | ft(5) | fs(5) | fd(5) | funct(6) */
    private encodeFP(inst: Instruction, operands: string[], fmt: number, funct: number,
                     filename: string, line: number, errors: ErrorList): number {
        const opcode = inst.getOpcode();
        const format = inst.getFormat();
        let fd = 0, fs = 0, ft = 0;

        switch (format) {
            case '$fd, $fs, $ft':
                // 3-operand FP: add.s, sub.s, mul.s, div.s
                fd = this.parseFPRegister(operands[0] || '', filename, line, errors);
                fs = this.parseFPRegister(operands[1] || '', filename, line, errors);
                ft = this.parseFPRegister(operands[2] || '', filename, line, errors);
                break;
            case '$fd, $fs':
                // 2-operand FP: mov.s, neg.s, abs.s, cvt.*
                fd = this.parseFPRegister(operands[0] || '', filename, line, errors);
                fs = this.parseFPRegister(operands[1] || '', filename, line, errors);
                break;
            case '$fs, $ft':
                // FP compare: c.eq.s, c.lt.s, c.le.s
                fs = this.parseFPRegister(operands[0] || '', filename, line, errors);
                ft = this.parseFPRegister(operands[1] || '', filename, line, errors);
                break;
            case '$rt, $f':
                // mfc1, mtc1: GPR rt and FP fs
                ft = this.parseRegister(operands[0] || '', filename, line, errors); // GPR goes in ft position
                fs = this.parseFPRegister(operands[1] || '', filename, line, errors);
                break;
            default:
                errors.add(new ErrorMessage(filename, line, 0,
                    `Unknown FP format: "${format}" for ${inst.getMnemonic()}`));
                break;
        }

        return ((opcode & 0x3F) << 26) | ((fmt & 0x1F) << 21) | ((ft & 0x1F) << 16) |
               ((fs & 0x1F) << 11) | ((fd & 0x1F) << 6) | (funct & 0x3F);
    }

    /** Parse a floating-point register ($f0-$f31) and return its number */
    private parseFPRegister(operand: string, filename: string, line: number, errors: ErrorList): number {
        const reg = operand.trim();
        const match = reg.match(/^\$f(\d+)$/i);
        if (match) {
            const num = parseInt(match[1]);
            if (num >= 0 && num <= 31) return num;
        }
        errors.add(new ErrorMessage(filename, line, 0, `Expected FP register, got: "${reg}"`));
        return 0;
    }

    private encodeIType(inst: Instruction, operands: string[], pc: number,
                        symbols: Map<string, number>, filename: string, line: number,
                        errors: ErrorList): number {
        const mnemonic = inst.getMnemonic();
        const opcode = inst.getOpcode();
        let rs = 0, rt = 0, imm = 0;

        if (mnemonic === 'lui') {
            rt = this.parseRegister(operands[0] || '', filename, line, errors);
            imm = this.parseImmediate(operands[1] || '0', symbols, filename, line, errors);
        } else if (inst.isMemory()) {
            // lw $rt, offset($rs)
            rt = this.parseRegister(operands[0] || '', filename, line, errors);
            const memOp = this.parseMemoryOperand(operands[1] || '0($zero)', symbols, filename, line, errors);
            rs = memOp.base;
            imm = memOp.offset;
        } else if (inst.isBranch()) {
            if (inst.getRtEncoding() !== undefined) {
                // Regimm: rs, label — rt comes from instruction metadata
                rs = this.parseRegister(operands[0] || '', filename, line, errors);
                const target = this.resolveLabel(operands[1] || '', symbols, filename, line, errors);
                imm = ((target - (pc + 4)) >> 2);
                rt = inst.getRtEncoding()!;
            } else if (mnemonic === 'bgtz' || mnemonic === 'blez') {
                // Single-register branches with unique opcodes
                rs = this.parseRegister(operands[0] || '', filename, line, errors);
                const target = this.resolveLabel(operands[1] || '', symbols, filename, line, errors);
                imm = ((target - (pc + 4)) >> 2);
            } else {
                // beq, bne: rs, rt, label
                rs = this.parseRegister(operands[0] || '', filename, line, errors);
                rt = this.parseRegister(operands[1] || '', filename, line, errors);
                const target = this.resolveLabel(operands[2] || '', symbols, filename, line, errors);
                imm = ((target - (pc + 4)) >> 2);
            }
        } else {
            // Arithmetic immediate: rt, rs, imm
            rt = this.parseRegister(operands[0] || '', filename, line, errors);
            rs = this.parseRegister(operands[1] || '', filename, line, errors);
            imm = this.parseImmediate(operands[2] || '0', symbols, filename, line, errors);
        }

        return ((opcode & 0x3F) << 26) | ((rs & 0x1F) << 21) | ((rt & 0x1F) << 16) | (imm & 0xFFFF);
    }

    private encodeJType(inst: Instruction, operands: string[], symbols: Map<string, number>,
                        filename: string, line: number, errors: ErrorList): number {
        const opcode = inst.getOpcode();
        const target = this.resolveLabel(operands[0] || '', symbols, filename, line, errors);
        const addr = (target >>> 2) & 0x03FFFFFF;
        return ((opcode & 0x3F) << 26) | addr;
    }

    // ===== Encoding helpers =====

    /** Encode: opcode(6) | rs(5) | rt(5) | rd(5) | shamt(5) | funct(6) */
    private encodeR(rs: number, rt: number, rd: number, shamt: number, funct: number): number {
        return ((rs & 0x1F) << 21) | ((rt & 0x1F) << 16) | ((rd & 0x1F) << 11) | ((shamt & 0x1F) << 6) | (funct & 0x3F);
    }

    /** Encode: opcode(6) | rs(5) | rt(5) | imm(16) */
    private encodeI(opcode: number, rs: number, rt: number, imm: number): number {
        return ((opcode & 0x3F) << 26) | ((rs & 0x1F) << 21) | ((rt & 0x1F) << 16) | (imm & 0xFFFF);
    }

    /** Load a 32-bit value into $at (register 1). Returns 1 or 2 instructions. */
    private loadImmediate32(value: number, destReg: number): number[] {
        const upper = (value >>> 16) & 0xFFFF;
        const lower = value & 0xFFFF;
        const lui = this.encodeI(OP.LUI, 0, destReg, upper);
        if (lower === 0) return [lui];
        const ori = this.encodeI(OP.ORI, destReg, destReg, lower);
        return [lui, ori];
    }

    /** Branch offset relative to pc, accounting for N instructions already emitted in this expansion. */
    private branchOffset(target: number, pc: number, instrsBefore: number): number {
        return ((target - (pc + (instrsBefore + 1) * 4)) >> 2) & 0xFFFF;
    }

    // ===== Pseudo-instruction expansion =====

    private expandPseudo(mnemonic: string, operands: string[], pc: number,
                         symbols: Map<string, number>, filename: string, line: number,
                         errors: ErrorList): number[] {

        const AT = 1; // $at register

        switch (mnemonic) {
            case 'nop':
                return [0x00000000]; // sll $zero, $zero, 0

            case 'move': {
                const rd = this.parseRegister(operands[0] || '', filename, line, errors);
                const rs = this.parseRegister(operands[1] || '', filename, line, errors);
                return [this.encodeR(rs, 0, rd, 0, FN.ADDU)];
            }

            case 'li': {
                const rt = this.parseRegister(operands[0] || '', filename, line, errors);
                const value = this.parseImmediate(operands[1] || '0', symbols, filename, line, errors);
                if (value >= -32768 && value <= 65535) {
                    return [this.encodeI(OP.ADDIU, 0, rt, value)];
                }
                return this.loadImmediate32(value, rt);
            }

            case 'la': {
                const rt = this.parseRegister(operands[0] || '', filename, line, errors);
                const addr = this.resolveLabel(operands[1] || '', symbols, filename, line, errors);
                const upper = (addr >>> 16) & 0xFFFF;
                const lower = addr & 0xFFFF;
                const lui = this.encodeI(OP.LUI, 0, rt, upper);
                if (lower === 0) return [lui];
                return [lui, this.encodeI(OP.ORI, rt, rt, lower)];
            }

            case 'b': {
                const target = this.resolveLabel(operands[0] || '', symbols, filename, line, errors);
                const offset = this.branchOffset(target, pc, 0);
                return [this.encodeI(OP.REGIMM, 0, 1, offset)]; // bgez $zero
            }

            case 'bal': {
                const target = this.resolveLabel(operands[0] || '', symbols, filename, line, errors);
                const offset = this.branchOffset(target, pc, 0);
                return [this.encodeI(OP.REGIMM, 0, 17, offset)]; // bgezal $zero
            }

            case 'beqz': {
                const rs = this.parseRegister(operands[0] || '', filename, line, errors);
                const target = this.resolveLabel(operands[1] || '', symbols, filename, line, errors);
                const offset = this.branchOffset(target, pc, 0);
                return [this.encodeI(OP.BEQ, rs, 0, offset)];
            }

            case 'bnez': {
                const rs = this.parseRegister(operands[0] || '', filename, line, errors);
                const target = this.resolveLabel(operands[1] || '', symbols, filename, line, errors);
                const offset = this.branchOffset(target, pc, 0);
                return [this.encodeI(OP.BNE, rs, 0, offset)];
            }

            case 'blt': case 'bgt': case 'ble': case 'bge':
            case 'bltu': case 'bgtu': case 'bleu': case 'bgeu': {
                const rs = this.parseRegister(operands[0] || '', filename, line, errors);
                const rt = this.parseRegister(operands[1] || '', filename, line, errors);
                const target = this.resolveLabel(operands[2] || '', symbols, filename, line, errors);
                const offset = this.branchOffset(target, pc, 1);
                const unsigned = mnemonic.endsWith('u');
                const sltFunct = unsigned ? FN.SLTU : FN.SLT;

                switch (mnemonic) {
                    case 'blt': case 'bltu':
                        return [this.encodeR(rs, rt, AT, 0, sltFunct), this.encodeI(OP.BNE, AT, 0, offset)];
                    case 'bgt': case 'bgtu':
                        return [this.encodeR(rt, rs, AT, 0, sltFunct), this.encodeI(OP.BNE, AT, 0, offset)];
                    case 'ble': case 'bleu':
                        return [this.encodeR(rt, rs, AT, 0, sltFunct), this.encodeI(OP.BEQ, AT, 0, offset)];
                    case 'bge': case 'bgeu':
                        return [this.encodeR(rs, rt, AT, 0, sltFunct), this.encodeI(OP.BEQ, AT, 0, offset)];
                    default: return [0]; // unreachable
                }
            }

            case 'not': {
                const rd = this.parseRegister(operands[0] || '', filename, line, errors);
                const rs = this.parseRegister(operands[1] || '', filename, line, errors);
                return [this.encodeR(rs, 0, rd, 0, FN.NOR)];
            }

            case 'neg': {
                const rd = this.parseRegister(operands[0] || '', filename, line, errors);
                const rs = this.parseRegister(operands[1] || '', filename, line, errors);
                return [this.encodeR(0, rs, rd, 0, FN.SUB)];
            }

            case 'negu': {
                const rd = this.parseRegister(operands[0] || '', filename, line, errors);
                const rs = this.parseRegister(operands[1] || '', filename, line, errors);
                return [this.encodeR(0, rs, rd, 0, FN.SUBU)];
            }

            case 'abs': {
                const rd = this.parseRegister(operands[0] || '', filename, line, errors);
                const rs = this.parseRegister(operands[1] || '', filename, line, errors);
                return [
                    this.encodeR(0, rs, AT, 31, FN.SRA),
                    this.encodeR(AT, rs, rd, 0, FN.XOR),
                    this.encodeR(rd, AT, rd, 0, FN.SUBU),
                ];
            }

            case 'subi': {
                const rd = this.parseRegister(operands[0] || '', filename, line, errors);
                const rs = this.parseRegister(operands[1] || '', filename, line, errors);
                const imm = this.parseImmediate(operands[2] || '0', symbols, filename, line, errors);
                if (imm >= -32768 && imm <= 32767) {
                    return [
                        this.encodeI(OP.ADDI, 0, AT, imm),
                        this.encodeR(rs, AT, rd, 0, FN.SUB),
                    ];
                }
                return [
                    ...this.loadImmediate32(imm, AT),
                    this.encodeR(rs, AT, rd, 0, FN.SUB),
                ];
            }

            case 'subiu': {
                const rd = this.parseRegister(operands[0] || '', filename, line, errors);
                const rs = this.parseRegister(operands[1] || '', filename, line, errors);
                const imm = this.parseImmediate(operands[2] || '0', symbols, filename, line, errors);
                return [
                    ...this.loadImmediate32(imm, AT),
                    this.encodeR(rs, AT, rd, 0, FN.SUBU),
                ];
            }

            case 'mul': {
                const rd = this.parseRegister(operands[0] || '', filename, line, errors);
                const rs = this.parseRegister(operands[1] || '', filename, line, errors);
                const rt = this.parseRegister(operands[2] || '', filename, line, errors);
                return [
                    this.encodeR(rs, rt, 0, 0, FN.MULT),
                    this.encodeR(0, 0, rd, 0, FN.MFLO),
                ];
            }

            case 'mulu': {
                const rd = this.parseRegister(operands[0] || '', filename, line, errors);
                const rs = this.parseRegister(operands[1] || '', filename, line, errors);
                const rt = this.parseRegister(operands[2] || '', filename, line, errors);
                return [
                    this.encodeR(rs, rt, 0, 0, FN.MULTU),
                    this.encodeR(0, 0, rd, 0, FN.MFLO),
                ];
            }

            case 'mulo': {
                const rd = this.parseRegister(operands[0] || '', filename, line, errors);
                const rs = this.parseRegister(operands[1] || '', filename, line, errors);
                const rt = this.parseRegister(operands[2] || '', filename, line, errors);
                return [
                    this.encodeR(rs, rt, 0, 0, FN.MULT),
                    this.encodeR(0, 0, AT, 0, FN.MFHI),
                    this.encodeR(0, 0, rd, 0, FN.MFLO),
                    this.encodeR(0, rd, rd, 31, FN.SRA),
                    this.encodeI(OP.BEQ, AT, rd, 1),
                    this.encodeR(0, 0, 0, 0, FN.BREAK),
                    this.encodeR(0, 0, rd, 0, FN.MFLO),
                ];
            }

            case 'mulou': {
                const rd = this.parseRegister(operands[0] || '', filename, line, errors);
                const rs = this.parseRegister(operands[1] || '', filename, line, errors);
                const rt = this.parseRegister(operands[2] || '', filename, line, errors);
                return [
                    this.encodeR(rs, rt, 0, 0, FN.MULTU),
                    this.encodeR(0, 0, AT, 0, FN.MFHI),
                    this.encodeI(OP.BEQ, AT, 0, 1),
                    this.encodeR(0, 0, 0, 0, FN.BREAK),
                    this.encodeR(0, 0, rd, 0, FN.MFLO),
                ];
            }

            case 'div': {
                const rd = this.parseRegister(operands[0] || '', filename, line, errors);
                const rs = this.parseRegister(operands[1] || '', filename, line, errors);
                const rt = this.parseRegister(operands[2] || '', filename, line, errors);
                return [
                    this.encodeI(OP.BNE, rt, 0, 1),
                    this.encodeR(0, 0, 0, 0, FN.BREAK),
                    this.encodeR(rs, rt, 0, 0, FN.DIV),
                    this.encodeR(0, 0, rd, 0, FN.MFLO),
                ];
            }

            case 'divu': {
                const rd = this.parseRegister(operands[0] || '', filename, line, errors);
                const rs = this.parseRegister(operands[1] || '', filename, line, errors);
                const rt = this.parseRegister(operands[2] || '', filename, line, errors);
                return [
                    this.encodeI(OP.BNE, rt, 0, 1),
                    this.encodeR(0, 0, 0, 0, FN.BREAK),
                    this.encodeR(rs, rt, 0, 0, FN.DIVU),
                    this.encodeR(0, 0, rd, 0, FN.MFLO),
                ];
            }

            case 'rem': {
                const rd = this.parseRegister(operands[0] || '', filename, line, errors);
                const rs = this.parseRegister(operands[1] || '', filename, line, errors);
                const rt = this.parseRegister(operands[2] || '', filename, line, errors);
                return [
                    this.encodeI(OP.BNE, rt, 0, 1),
                    this.encodeR(0, 0, 0, 0, FN.BREAK),
                    this.encodeR(rs, rt, 0, 0, FN.DIV),
                    this.encodeR(0, 0, rd, 0, FN.MFHI),
                ];
            }

            case 'remu': {
                const rd = this.parseRegister(operands[0] || '', filename, line, errors);
                const rs = this.parseRegister(operands[1] || '', filename, line, errors);
                const rt = this.parseRegister(operands[2] || '', filename, line, errors);
                return [
                    this.encodeI(OP.BNE, rt, 0, 1),
                    this.encodeR(0, 0, 0, 0, FN.BREAK),
                    this.encodeR(rs, rt, 0, 0, FN.DIVU),
                    this.encodeR(0, 0, rd, 0, FN.MFHI),
                ];
            }

            case 'seq': {
                const rd = this.parseRegister(operands[0] || '', filename, line, errors);
                const rs = this.parseRegister(operands[1] || '', filename, line, errors);
                const rt = this.parseRegister(operands[2] || '', filename, line, errors);
                return [
                    this.encodeR(rs, rt, rd, 0, FN.SUBU),
                    this.encodeI(OP.ORI, 0, AT, 1),
                    this.encodeR(rd, AT, rd, 0, FN.SLTU),
                ];
            }

            case 'sne': {
                const rd = this.parseRegister(operands[0] || '', filename, line, errors);
                const rs = this.parseRegister(operands[1] || '', filename, line, errors);
                const rt = this.parseRegister(operands[2] || '', filename, line, errors);
                return [
                    this.encodeR(rs, rt, rd, 0, FN.SUBU),
                    this.encodeR(0, rd, rd, 0, FN.SLTU),
                ];
            }

            case 'sge': case 'sgeu': {
                const rd = this.parseRegister(operands[0] || '', filename, line, errors);
                const rs = this.parseRegister(operands[1] || '', filename, line, errors);
                const rt = this.parseRegister(operands[2] || '', filename, line, errors);
                const funct = mnemonic === 'sgeu' ? FN.SLTU : FN.SLT;
                return [
                    this.encodeR(rs, rt, rd, 0, funct),
                    this.encodeI(OP.ORI, 0, AT, 1),
                    this.encodeR(AT, rd, rd, 0, FN.SUBU),
                ];
            }

            case 'sgt': case 'sgtu': {
                const rd = this.parseRegister(operands[0] || '', filename, line, errors);
                const rs = this.parseRegister(operands[1] || '', filename, line, errors);
                const rt = this.parseRegister(operands[2] || '', filename, line, errors);
                const funct = mnemonic === 'sgtu' ? FN.SLTU : FN.SLT;
                return [this.encodeR(rt, rs, rd, 0, funct)];
            }

            case 'sle': case 'sleu': {
                const rd = this.parseRegister(operands[0] || '', filename, line, errors);
                const rs = this.parseRegister(operands[1] || '', filename, line, errors);
                const rt = this.parseRegister(operands[2] || '', filename, line, errors);
                const funct = mnemonic === 'sleu' ? FN.SLTU : FN.SLT;
                return [
                    this.encodeR(rt, rs, rd, 0, funct),
                    this.encodeI(OP.ORI, 0, AT, 1),
                    this.encodeR(AT, rd, rd, 0, FN.SUBU),
                ];
            }

            case 'rol': {
                const rd = this.parseRegister(operands[0] || '', filename, line, errors);
                const rs = this.parseRegister(operands[1] || '', filename, line, errors);
                const rt = this.parseRegister(operands[2] || '', filename, line, errors);
                return [
                    this.encodeR(0, rt, AT, 0, FN.SUBU),
                    this.encodeR(AT, rs, AT, 0, FN.SRLV),
                    this.encodeR(rt, rs, rd, 0, FN.SLLV),
                    this.encodeR(rd, AT, rd, 0, FN.OR),
                ];
            }

            case 'ror': {
                const rd = this.parseRegister(operands[0] || '', filename, line, errors);
                const rs = this.parseRegister(operands[1] || '', filename, line, errors);
                const rt = this.parseRegister(operands[2] || '', filename, line, errors);
                return [
                    this.encodeR(0, rt, AT, 0, FN.SUBU),
                    this.encodeR(AT, rs, AT, 0, FN.SLLV),
                    this.encodeR(rt, rs, rd, 0, FN.SRLV),
                    this.encodeR(rd, AT, rd, 0, FN.OR),
                ];
            }

            // FP pseudo-instructions
            case 'l.s': case 'l.d': case 's.s': case 's.d':
            case 'mfc1.d': case 'mtc1.d': {
                errors.add(ErrorMessage.warning(filename, line, 0,
                    `FP pseudo-instruction "${mnemonic}" recognized but not yet assembled`));
                return [0x00000000];
            }

            // Memory pseudo-instructions
            case 'ld': case 'sd':
            case 'ulw': case 'ulh': case 'ulhu': case 'usw': case 'ush': {
                errors.add(ErrorMessage.warning(filename, line, 0,
                    `Memory pseudo-instruction "${mnemonic}" recognized but not yet assembled`));
                return [0x00000000];
            }

            default:
                errors.add(new ErrorMessage(filename, line, 0,
                    `Unknown pseudo-instruction: "${mnemonic}"`));
                return [0];
        }
    }

    /**
     * Estimate pseudo-instruction size (worst-case number of instructions).
     * Derived from the expansion string in InstructionSet — no parallel data structure.
     */
    private estimatePseudoSize(mnemonic: string): number {
        const inst = this.instructionSet.getInstruction(mnemonic);
        return inst ? inst.getExpansionSize() : 1;
    }

    /**
     * Instructions whose mnemonic exists as both a base R/I/J instruction
     * and as a case in expandPseudo with a different operand count.
     * e.g. div has a 2-operand base form (rs, rt → HI/LO) and a 3-operand
     * pseudo form (rd, rs, rt → divide with zero-check, result to rd).
     */
    private static readonly PSEUDO_OVERLOADS = new Set(['div', 'divu']);

    private hasPseudoOverload(mnemonic: string, operands: string[]): boolean {
        if (!Parser.PSEUDO_OVERLOADS.has(mnemonic)) return false;
        const base = this.instructionSet.getInstruction(mnemonic);
        if (!base || base.isPseudo()) return false;
        return operands.length > this.expectedOperandCount(base.getFormat());
    }

    // ===== Data directives =====

    /** Compute padding needed to align `offset` to `alignment` bytes. */
    private alignPadding(offset: number, alignment: number): number {
        if (alignment <= 1) return 0;
        const misalign = offset % alignment;
        return misalign === 0 ? 0 : alignment - misalign;
    }

    private computeDataDirectiveSize(dir: string, tokenList: TokenList, idx: number, dataAddress: number): number {
        // Fixed-size directives: use DirectiveRegistry unit size
        const unitSize = DirectiveRegistry.getUnitSize(dir);
        if (unitSize !== null) {
            const padding = this.alignPadding(dataAddress, unitSize);
            return padding + this.countValues(tokenList, idx + 1) * unitSize;
        }

        // Variable-size directives need custom logic
        switch (dir) {
            case '.space': {
                if (idx + 1 < tokenList.size()) {
                    return this.parseIntValue(tokenList.get(idx + 1).getValue());
                }
                return 0;
            }
            case '.ascii':
            case '.asciiz': {
                let size = 0;
                for (let i = idx + 1; i < tokenList.size(); i++) {
                    if (tokenList.get(i).getType() === TokenType.QUOTED_STRING) {
                        size += this.unescapeString(tokenList.get(i).getValue()).length;
                        if (dir === '.asciiz') size += 1;
                    }
                }
                return size;
            }
            default: return 0;
        }
    }

    /**
     * Process fixed-size data values (.word, .half, .byte, .float, .double).
     * Iterates tokens, skips commas, parses each value, writes to data buffer.
     */
    private processFixedSizeValues(
        tokenList: TokenList, idx: number, data: Uint8Array, offset: number,
        unitSize: number,
        parseFn: (tokenValue: string) => number,
        writeFn: (data: Uint8Array, pos: number, val: number) => void,
    ): number {
        let written = 0;
        for (let i = idx + 1; i < tokenList.size(); i++) {
            const token = tokenList.get(i);
            if (token.getType() === TokenType.COMMA) continue;
            const val = parseFn(token.getValue());
            if (offset + written + unitSize - 1 < data.length) {
                writeFn(data, offset + written, val);
            }
            written += unitSize;
        }
        return written;
    }

    private processDataDirective(dir: string, tokenList: TokenList, idx: number,
                                  data: Uint8Array, offset: number, dataAddress: number,
                                  symbols: Map<string, number>,
                                  errors: ErrorList): number {
        const fname = tokenList.getFilename();
        const line = tokenList.getLineNumber();

        const intParse = (v: string) => this.parseImmediateOrLabel(v, symbols, fname, line, errors);
        const floatParse = (v: string) => { const f = parseFloat(v); return isNaN(f) ? 0 : f; };

        // Auto-align for fixed-size directives
        const unitSize = DirectiveRegistry.getUnitSize(dir);
        const padding = (unitSize !== null) ? this.alignPadding(dataAddress, unitSize) : 0;
        const alignedOffset = offset + padding;

        switch (dir) {
            case '.word':
                return padding + this.processFixedSizeValues(tokenList, idx, data, alignedOffset, 4, intParse,
                    (d, p, v) => new DataView(d.buffer, p, 4).setInt32(0, v, true));
            case '.half':
                return padding + this.processFixedSizeValues(tokenList, idx, data, alignedOffset, 2, intParse,
                    (d, p, v) => new DataView(d.buffer, p, 2).setInt16(0, v & 0xFFFF, true));
            case '.byte':
                return padding + this.processFixedSizeValues(tokenList, idx, data, alignedOffset, 1, intParse,
                    (d, p, v) => { d[p] = v & 0xFF; });
            case '.float':
                return padding + this.processFixedSizeValues(tokenList, idx, data, alignedOffset, 4, floatParse,
                    (d, p, v) => new DataView(d.buffer, p, 4).setFloat32(0, v, true));
            case '.double':
                return padding + this.processFixedSizeValues(tokenList, idx, data, alignedOffset, 8, floatParse,
                    (d, p, v) => new DataView(d.buffer, p, 8).setFloat64(0, v, true));
            case '.space': {
                if (idx + 1 < tokenList.size()) {
                    return this.parseIntValue(tokenList.get(idx + 1).getValue());
                }
                return 0;
            }
            case '.ascii':
            case '.asciiz': {
                let written = 0;
                for (let i = idx + 1; i < tokenList.size(); i++) {
                    const token = tokenList.get(i);
                    if (token.getType() === TokenType.QUOTED_STRING) {
                        const str = this.unescapeString(token.getValue());
                        for (let j = 0; j < str.length; j++) {
                            if (offset + written < data.length) {
                                data[offset + written] = str.charCodeAt(j) & 0xFF;
                            }
                            written++;
                        }
                        if (dir === '.asciiz') {
                            if (offset + written < data.length) {
                                data[offset + written] = 0;
                            }
                            written++;
                        }
                    }
                }
                return written;
            }
            default: return 0;
        }
    }

    private countValues(tokenList: TokenList, startIdx: number): number {
        let count = 0;
        for (let i = startIdx; i < tokenList.size(); i++) {
            if (tokenList.get(i).getType() !== TokenType.COMMA) {
                count++;
            }
        }
        return Math.max(count, 0);
    }

    // ===== Helpers =====

    private parseRegister(operand: string, filename: string, line: number, errors: ErrorList): number {
        const reg = operand.trim();
        if (!reg.startsWith('$')) {
            errors.add(new ErrorMessage(filename, line, 0, `Expected register, got: "${reg}"`));
            return 0;
        }

        // Named register (uses RegisterRegistry via REGISTER_MAP)
        const lower = reg.toLowerCase();
        if (REGISTER_MAP[lower] !== undefined) {
            return REGISTER_MAP[lower];
        }

        // Numbered register $0-$31
        const numStr = reg.substring(1);
        const num = parseInt(numStr);
        if (!isNaN(num) && num >= 0 && num <= 31) {
            return num;
        }

        errors.add(new ErrorMessage(filename, line, 0, `Invalid register: "${reg}"`));
        return 0;
    }

    /**
     * Unified value resolver. Tries: number literal, symbol table, %hi/%lo relocations.
     * @param allowRelocations  Enable %hi()/%lo() (for immediates)
     * @param errorContext       What to call the operand in error messages
     */
    private resolveValue(
        operand: string, symbols: Map<string, number>,
        filename: string, line: number, errors: ErrorList,
        opts: { allowRelocations?: boolean; errorContext?: string } = {},
    ): number {
        const trimmed = operand.trim();
        const num = this.tryParseNumber(trimmed);
        if (num !== null) return num;

        if (symbols.has(trimmed)) {
            return symbols.get(trimmed)!;
        }

        if (opts.allowRelocations) {
            const hiMatch = trimmed.match(/^%hi\((\w+)\)$/i);
            if (hiMatch) {
                const addr = symbols.get(hiMatch[1]);
                if (addr !== undefined) return (addr >>> 16) & 0xFFFF;
            }
            const loMatch = trimmed.match(/^%lo\((\w+)\)$/i);
            if (loMatch) {
                const addr = symbols.get(loMatch[1]);
                if (addr !== undefined) return addr & 0xFFFF;
            }
        }

        const ctx = opts.errorContext || 'value';
        errors.add(new ErrorMessage(filename, line, 0, `Undefined ${ctx}: "${trimmed}"`));
        return 0;
    }

    /** Resolve an immediate value (supports %hi/%lo relocations) */
    private parseImmediate(operand: string, symbols: Map<string, number>,
                           filename: string, line: number, errors: ErrorList): number {
        return this.resolveValue(operand, symbols, filename, line, errors,
            { allowRelocations: true, errorContext: 'immediate' });
    }

    /** Resolve a data value or symbol reference */
    private parseImmediateOrLabel(operand: string, symbols: Map<string, number>,
                                   filename: string, line: number, errors: ErrorList): number {
        return this.resolveValue(operand, symbols, filename, line, errors,
            { errorContext: 'symbol' });
    }

    /** Resolve a branch/jump target label */
    private resolveLabel(operand: string, symbols: Map<string, number>,
                         filename: string, line: number, errors: ErrorList): number {
        return this.resolveValue(operand, symbols, filename, line, errors,
            { errorContext: 'label' });
    }

    private parseMemoryOperand(operand: string, symbols: Map<string, number>,
                                filename: string, line: number,
                                errors: ErrorList): { offset: number; base: number } {
        const match = operand.match(/^([^(]*)\((\$\w+)\)$/);
        if (match) {
            const offsetStr = match[1].trim();
            const regStr = match[2];
            const offset = offsetStr.length > 0 ? this.parseImmediate(offsetStr, symbols, filename, line, errors) : 0;
            const base = this.parseRegister(regStr, filename, line, errors);
            return { offset, base };
        }

        const offset = this.parseImmediate(operand, symbols, filename, line, errors);
        return { offset, base: 0 };
    }

    private tryParseNumber(value: string): number | null {
        if (value.length === 0) return null;

        if (value.startsWith('0x') || value.startsWith('0X')) {
            const n = parseInt(value.substring(2), 16);
            return isNaN(n) ? null : n;
        }
        if (value.startsWith('0b') || value.startsWith('0B')) {
            const n = parseInt(value.substring(2), 2);
            return isNaN(n) ? null : n;
        }
        if (value.startsWith("'") && value.endsWith("'") && value.length >= 3) {
            return value.charCodeAt(1);
        }

        if (/^-?\d+$/.test(value)) {
            return parseInt(value, 10);
        }

        return null;
    }

    private parseIntValue(value: string): number {
        return this.tryParseNumber(value) || 0;
    }

    private unescapeString(quoted: string): string {
        let s = quoted;
        if (s.startsWith('"') && s.endsWith('"')) {
            s = s.substring(1, s.length - 1);
        }

        let result = '';
        let i = 0;
        while (i < s.length) {
            if (s.charAt(i) === '\\' && i + 1 < s.length) {
                i++;
                switch (s.charAt(i)) {
                    case 'n': result += '\n'; break;
                    case 't': result += '\t'; break;
                    case 'r': result += '\r'; break;
                    case '0': result += '\0'; break;
                    case '\\': result += '\\'; break;
                    case '"': result += '"'; break;
                    default: result += s.charAt(i); break;
                }
            } else {
                result += s.charAt(i);
            }
            i++;
        }
        return result;
    }

    /**
     * Disassemble machine code using InstructionSet reverse lookup maps.
     * No more hardcoded duplicate maps.
     */
    private disassemble(machineCode: number): string {
        const opcode = (machineCode >>> 26) & 0x3F;
        const rs = (machineCode >>> 21) & 0x1F;
        const rt = (machineCode >>> 16) & 0x1F;
        const rd = (machineCode >>> 11) & 0x1F;
        const shamt = (machineCode >>> 6) & 0x1F;
        const funct = machineCode & 0x3F;
        const imm = machineCode & 0xFFFF;
        const addr = machineCode & 0x03FFFFFF;

        if (machineCode === 0) return 'nop';

        if (opcode === 0) {
            // R-type: use InstructionSet reverse map
            const name = this.instructionSet.getRTypeName(funct) || `r-${funct}`;
            if (funct === FN.SYSCALL) return 'syscall';
            if (funct === FN.BREAK) return 'break';
            // Shifts: rd, rt, shamt
            if (funct === FN.SLL || funct === FN.SRL || funct === FN.SRA) {
                return `${name} $${rd}, $${rt}, ${shamt}`;
            }
            // Jump register
            if (funct === FN.JR) return `jr $${rs}`;
            // Jump and link register
            if (funct === FN.JALR) return `jalr $${rd}, $${rs}`;
            // Move from HI/LO
            if (funct === FN.MFHI || funct === FN.MFLO) return `${name} $${rd}`;
            // Move to HI/LO
            if (funct === FN.MTHI || funct === FN.MTLO) return `${name} $${rs}`;
            // Mult/div: rs, rt (no destination register)
            if (funct === FN.MULT || funct === FN.MULTU || funct === FN.DIV || funct === FN.DIVU) {
                return `${name} $${rs}, $${rt}`;
            }
            // Variable shifts: rd, rt, rs
            if (funct === FN.SLLV || funct === FN.SRLV || funct === FN.SRAV) {
                return `${name} $${rd}, $${rt}, $${rs}`;
            }
            return `${name} $${rd}, $${rs}, $${rt}`;
        }

        // FP (opcode 0x11): use fmt field for disambiguation
        if (opcode === OP.COP1) {
            const fmt = rs; // bits 25-21 = fmt field (overlaps rs position)
            // FP branch (fmt=0x08) — check before arithmetic lookup
            if (fmt === 0x08) {
                const brName = (rt & 1) ? 'bc1t' : 'bc1f';
                return `${brName} ${this.signExtend16(imm)}`;
            }
            const fpName = this.instructionSet.getFpName(fmt, funct);
            if (fpName) {
                const fpInst = this.instructionSet.getInstruction(fpName);
                const fpFmt = fpInst?.getFormat() || '';
                // fd=bits[10-6], fs=bits[15-11], ft=bits[20-16]
                switch (fpFmt) {
                    case '$fd, $fs, $ft': return `${fpName} $f${rd}, $f${shamt}, $f${rt}`;
                    case '$fd, $fs':      return `${fpName} $f${rd}, $f${shamt}`;
                    case '$fs, $ft':      return `${fpName} $f${shamt}, $f${rt}`;
                    case '$rt, $f':       return `${fpName} $${rt}, $f${shamt}`;
                    default:              return `${fpName} $f${rd}, $f${shamt}, $f${rt}`;
                }
            }
            return `cop1 fmt=${fmt} funct=0x${funct.toString(16)}`;
        }

        if (opcode === OP.J) return `j 0x${(addr << 2).toString(16)}`;
        if (opcode === OP.JAL) return `jal 0x${(addr << 2).toString(16)}`;

        // Regimm (opcode 0x01): disambiguate by rt field
        if (opcode === OP.REGIMM) {
            const regimmName = this.instructionSet.getRegimmName(rt) || `regimm-${rt}`;
            return `${regimmName} $${rs}, ${this.signExtend16(imm)}`;
        }

        // I-type: use InstructionSet reverse map
        const name = this.instructionSet.getITypeName(opcode) || `op-${opcode}`;
        const inst = this.instructionSet.getInstruction(name);

        // lui: only rt, imm
        if (opcode === OP.LUI) {
            return `lui $${rt}, 0x${(imm & 0xFFFF).toString(16)}`;
        }

        // Memory: rt, offset(rs)
        if (inst?.isMemory()) {
            return `${name} $${rt}, ${this.signExtend16(imm)}($${rs})`;
        }

        // Branch (beq, bne): rs, rt, offset
        if (inst?.isBranch()) {
            return `${name} $${rs}, $${rt}, ${this.signExtend16(imm)}`;
        }

        // Arithmetic immediate: rt, rs, signed-imm
        return `${name} $${rt}, $${rs}, ${this.signExtend16(imm)}`;
    }

    /** Sign-extend a 16-bit value to a signed integer */
    private signExtend16(val: number): number {
        const v = val & 0xFFFF;
        return v >= 0x8000 ? v - 0x10000 : v;
    }
}
