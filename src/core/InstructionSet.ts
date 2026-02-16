/**
 * MIPS instruction set definitions.
 * Single source of truth: all instruction data is defined once in populateInstructions().
 * The static INSTRUCTION_NAMES set, disassembly reverse maps, and metadata queries
 * are all derived from these definitions.
 */

export enum InstructionType {
    R = 'R',
    I = 'I',
    J = 'J',
    PSEUDO = 'PSEUDO'
}

export interface InstructionFlags {
    isMemory?: boolean;
    isBranch?: boolean;
    /** FP format field (bits 25-21): 0x10 = single, 0x11 = double, 0x04 = word. Undefined for non-FP. */
    fmt?: number;
    /** Regimm rt encoding (bits 20-16): 0 = bltz, 1 = bgez, 16 = bltzal, 17 = bgezal. Undefined for non-regimm. */
    rtEncoding?: number;
    /** Category for syntax highlighting: arithmetic, logical, comparison, branch, jump, memory, system, float */
    category?: string;
}

export class Instruction {
    private mnemonic: string;
    private type: InstructionType;
    private opcode: number;
    private funct: number;
    private format: string;
    private description: string;
    private expansion: string | null;
    private flags: InstructionFlags;

    constructor(
        mnemonic: string,
        type: InstructionType,
        opcode: number,
        funct: number,
        format: string,
        description: string,
        expansion: string | null = null,
        flags: InstructionFlags = {}
    ) {
        this.mnemonic = mnemonic;
        this.type = type;
        this.opcode = opcode;
        this.funct = funct;
        this.format = format;
        this.description = description;
        this.expansion = expansion;
        this.flags = flags;
    }

    getMnemonic(): string { return this.mnemonic; }
    getType(): InstructionType { return this.type; }
    getOpcode(): number { return this.opcode; }
    getFunct(): number { return this.funct; }
    getFormat(): string { return this.format; }
    getDescription(): string { return this.description; }
    getExpansion(): string | null { return this.expansion; }
    isPseudo(): boolean { return this.type === InstructionType.PSEUDO; }
    isMemory(): boolean { return this.flags.isMemory === true; }
    isBranch(): boolean { return this.flags.isBranch === true; }
    getFmt(): number | undefined { return this.flags.fmt; }
    getRtEncoding(): number | undefined { return this.flags.rtEncoding; }
    getCategory(): string | undefined { return this.flags.category; }

    /**
     * Get the worst-case number of instructions this pseudo expands to.
     * Derived from the expansion string (count newlines + 1).
     * Returns 1 for non-pseudo instructions.
     */
    getExpansionSize(): number {
        if (!this.expansion) return 1;
        let count = 1;
        for (let i = 0; i < this.expansion.length; i++) {
            if (this.expansion.charAt(i) === '\n') count++;
        }
        return count;
    }
}

export class InstructionSet {
    // All data is static — populated once at first construction, shared across instances
    private static _instructions: Map<string, Instruction> | null = null;
    private static _nameSet: Set<string> | null = null;
    private static _rTypeByFunct: Map<number, string> | null = null;
    private static _iTypeByOpcode: Map<number, string> | null = null;
    private static _fpByFmtFunct: Map<string, string> | null = null;
    private static _regimmByRt: Map<number, string> | null = null;

    constructor() {
        if (!InstructionSet._instructions) {
            InstructionSet._instructions = new Map();
            this.populateInstructions();
            this.buildReverseMaps();
            InstructionSet._nameSet = new Set(InstructionSet._instructions.keys());
        }
    }

    private get instructions(): Map<string, Instruction> {
        return InstructionSet._instructions!;
    }

    /** Check if a string is a known instruction mnemonic. */
    static isInstruction(name: string): boolean {
        if (!InstructionSet._nameSet) new InstructionSet();
        return InstructionSet._nameSet!.has(name.toLowerCase());
    }

    getInstruction(mnemonic: string): Instruction | undefined {
        return this.instructions.get(mnemonic.toLowerCase());
    }

    matchOperator(mnemonic: string): Instruction[] | null {
        const inst = this.instructions.get(mnemonic.toLowerCase());
        return inst ? [inst] : null;
    }

    getAllMnemonics(): string[] {
        return Array.from(this.instructions.keys());
    }

    /** Reverse lookup: get R-type mnemonic by funct code */
    getRTypeName(funct: number): string | undefined {
        return InstructionSet._rTypeByFunct?.get(funct);
    }

    /** Reverse lookup: get I-type mnemonic by opcode */
    getITypeName(opcode: number): string | undefined {
        return InstructionSet._iTypeByOpcode?.get(opcode);
    }

    /** Reverse lookup: get FP mnemonic by fmt and funct fields */
    getFpName(fmt: number, funct: number): string | undefined {
        return InstructionSet._fpByFmtFunct?.get(`${fmt}:${funct}`);
    }

    /** Reverse lookup: get regimm mnemonic by rt encoding */
    getRegimmName(rt: number): string | undefined {
        return InstructionSet._regimmByRt?.get(rt);
    }

    /** Check if a mnemonic is a memory instruction (load/store) */
    isMemoryInstruction(mnemonic: string): boolean {
        return this.instructions.get(mnemonic.toLowerCase())?.isMemory() === true;
    }

    /** Check if a mnemonic is a branch instruction */
    isBranchInstruction(mnemonic: string): boolean {
        return this.instructions.get(mnemonic.toLowerCase())?.isBranch() === true;
    }

    private buildReverseMaps(): void {
        const rTypeByFunct = new Map<number, string>();
        const iTypeByOpcode = new Map<number, string>();
        const fpByFmtFunct = new Map<string, string>();
        const regimmByRt = new Map<number, string>();

        for (const [, inst] of this.instructions) {
            if (inst.getType() === InstructionType.R) {
                if (inst.getOpcode() === 0) {
                    if (!rTypeByFunct.has(inst.getFunct())) {
                        rTypeByFunct.set(inst.getFunct(), inst.getMnemonic());
                    }
                } else if (inst.getFmt() !== undefined) {
                    const key = `${inst.getFmt()}:${inst.getFunct()}`;
                    if (!fpByFmtFunct.has(key)) {
                        fpByFmtFunct.set(key, inst.getMnemonic());
                    }
                }
            } else if (inst.getType() === InstructionType.I) {
                if (inst.getRtEncoding() !== undefined) {
                    regimmByRt.set(inst.getRtEncoding()!, inst.getMnemonic());
                } else if (!iTypeByOpcode.has(inst.getOpcode())) {
                    iTypeByOpcode.set(inst.getOpcode(), inst.getMnemonic());
                }
            }
        }

        InstructionSet._rTypeByFunct = rTypeByFunct;
        InstructionSet._iTypeByOpcode = iTypeByOpcode;
        InstructionSet._fpByFmtFunct = fpByFmtFunct;
        InstructionSet._regimmByRt = regimmByRt;
    }

    private populateInstructions(): void {
        // R-type arithmetic
        this.addRType('add', 0, 0x20, 'rd, rs, rt', 'Addition with overflow', { category: 'arithmetic' });
        this.addRType('addu', 0, 0x21, 'rd, rs, rt', 'Addition without overflow', { category: 'arithmetic' });
        this.addRType('sub', 0, 0x22, 'rd, rs, rt', 'Subtraction with overflow', { category: 'arithmetic' });
        this.addRType('subu', 0, 0x23, 'rd, rs, rt', 'Subtraction without overflow', { category: 'arithmetic' });
        this.addRType('and', 0, 0x24, 'rd, rs, rt', 'Bitwise AND', { category: 'logical' });
        this.addRType('or', 0, 0x25, 'rd, rs, rt', 'Bitwise OR', { category: 'logical' });
        this.addRType('xor', 0, 0x26, 'rd, rs, rt', 'Bitwise XOR', { category: 'logical' });
        this.addRType('nor', 0, 0x27, 'rd, rs, rt', 'Bitwise NOR', { category: 'logical' });
        this.addRType('slt', 0, 0x2A, 'rd, rs, rt', 'Set on less than (signed)', { category: 'comparison' });
        this.addRType('sltu', 0, 0x2B, 'rd, rs, rt', 'Set on less than (unsigned)', { category: 'comparison' });

        // R-type shifts
        this.addRType('sll', 0, 0x00, 'rd, rt, shamt', 'Shift left logical', { category: 'logical' });
        this.addRType('srl', 0, 0x02, 'rd, rt, shamt', 'Shift right logical', { category: 'logical' });
        this.addRType('sra', 0, 0x03, 'rd, rt, shamt', 'Shift right arithmetic', { category: 'logical' });
        this.addRType('sllv', 0, 0x04, 'rd, rt, rs', 'Shift left logical variable', { category: 'logical' });
        this.addRType('srlv', 0, 0x06, 'rd, rt, rs', 'Shift right logical variable', { category: 'logical' });
        this.addRType('srav', 0, 0x07, 'rd, rt, rs', 'Shift right arithmetic variable', { category: 'logical' });

        // R-type jumps
        this.addRType('jr', 0, 0x08, 'rs', 'Jump register', { category: 'jump' });
        this.addRType('jalr', 0, 0x09, 'rd, rs', 'Jump and link register', { category: 'jump' });

        // R-type multiply/divide
        this.addRType('mult', 0, 0x18, 'rs, rt', 'Multiply (signed)', { category: 'arithmetic' });
        this.addRType('multu', 0, 0x19, 'rs, rt', 'Multiply (unsigned)', { category: 'arithmetic' });
        this.addRType('div', 0, 0x1A, 'rs, rt', 'Divide (signed)', { category: 'arithmetic' });
        this.addRType('divu', 0, 0x1B, 'rs, rt', 'Divide (unsigned)', { category: 'arithmetic' });
        this.addRType('mfhi', 0, 0x10, 'rd', 'Move from HI', { category: 'memory' });
        this.addRType('mflo', 0, 0x12, 'rd', 'Move from LO', { category: 'memory' });
        this.addRType('mthi', 0, 0x11, 'rs', 'Move to HI', { category: 'memory' });
        this.addRType('mtlo', 0, 0x13, 'rs', 'Move to LO', { category: 'memory' });

        // R-type special
        this.addRType('syscall', 0, 0x0C, '', 'System call', { category: 'system' });
        this.addRType('break', 0, 0x0D, '', 'Breakpoint', { category: 'system' });

        // I-type arithmetic
        this.addIType('addi', 0x08, 'rt, rs, imm', 'Add immediate with overflow', { category: 'arithmetic' });
        this.addIType('addiu', 0x09, 'rt, rs, imm', 'Add immediate without overflow', { category: 'arithmetic' });
        this.addIType('andi', 0x0C, 'rt, rs, imm', 'Bitwise AND immediate', { category: 'logical' });
        this.addIType('ori', 0x0D, 'rt, rs, imm', 'Bitwise OR immediate', { category: 'logical' });
        this.addIType('xori', 0x0E, 'rt, rs, imm', 'Bitwise XOR immediate', { category: 'logical' });
        this.addIType('slti', 0x0A, 'rt, rs, imm', 'Set on less than immediate (signed)', { category: 'comparison' });
        this.addIType('sltiu', 0x0B, 'rt, rs, imm', 'Set on less than immediate (unsigned)', { category: 'comparison' });
        this.addIType('lui', 0x0F, 'rt, imm', 'Load upper immediate', { category: 'memory' });

        // I-type memory (with isMemory flag)
        this.addIType('lw', 0x23, 'rt, offset(rs)', 'Load word', { isMemory: true, category: 'memory' });
        this.addIType('lh', 0x21, 'rt, offset(rs)', 'Load halfword (signed)', { isMemory: true, category: 'memory' });
        this.addIType('lhu', 0x25, 'rt, offset(rs)', 'Load halfword (unsigned)', { isMemory: true, category: 'memory' });
        this.addIType('lb', 0x20, 'rt, offset(rs)', 'Load byte (signed)', { isMemory: true, category: 'memory' });
        this.addIType('lbu', 0x24, 'rt, offset(rs)', 'Load byte (unsigned)', { isMemory: true, category: 'memory' });
        this.addIType('sw', 0x2B, 'rt, offset(rs)', 'Store word', { isMemory: true, category: 'memory' });
        this.addIType('sh', 0x29, 'rt, offset(rs)', 'Store halfword', { isMemory: true, category: 'memory' });
        this.addIType('sb', 0x28, 'rt, offset(rs)', 'Store byte', { isMemory: true, category: 'memory' });

        // I-type unaligned memory
        this.addIType('lwl', 0x22, 'rt, offset(rs)', 'Load word left', { isMemory: true, category: 'memory' });
        this.addIType('lwr', 0x26, 'rt, offset(rs)', 'Load word right', { isMemory: true, category: 'memory' });
        this.addIType('swl', 0x2A, 'rt, offset(rs)', 'Store word left', { isMemory: true, category: 'memory' });
        this.addIType('swr', 0x2E, 'rt, offset(rs)', 'Store word right', { isMemory: true, category: 'memory' });

        // I-type atomic
        this.addIType('ll', 0x30, 'rt, offset(rs)', 'Load linked (atomic read-modify-write)', { isMemory: true, category: 'memory' });
        this.addIType('sc', 0x38, 'rt, offset(rs)', 'Store conditional (atomic read-modify-write)', { isMemory: true, category: 'memory' });

        // I-type branches (with isBranch flag)
        this.addIType('beq', 0x04, 'rs, rt, label', 'Branch if equal', { isBranch: true, category: 'branch' });
        this.addIType('bne', 0x05, 'rs, rt, label', 'Branch if not equal', { isBranch: true, category: 'branch' });
        this.addIType('bgez', 0x01, 'rs, label', 'Branch if >= 0', { isBranch: true, rtEncoding: 1, category: 'branch' });
        this.addIType('bgtz', 0x07, 'rs, label', 'Branch if > 0', { isBranch: true, category: 'branch' });
        this.addIType('blez', 0x06, 'rs, label', 'Branch if <= 0', { isBranch: true, category: 'branch' });
        this.addIType('bltz', 0x01, 'rs, label', 'Branch if < 0', { isBranch: true, rtEncoding: 0, category: 'branch' });
        this.addIType('bgezal', 0x01, 'rs, label', 'Branch if >= 0 and link', { isBranch: true, rtEncoding: 17, category: 'branch' });
        this.addIType('bltzal', 0x01, 'rs, label', 'Branch if < 0 and link', { isBranch: true, rtEncoding: 16, category: 'branch' });

        // J-type
        this.addJType('j', 0x02, 'label', 'Jump', { category: 'jump' });
        this.addJType('jal', 0x03, 'label', 'Jump and link', { category: 'jump' });

        // FP coprocessor load/store
        this.addIType('lwc1', 0x31, '$f, offset(rs)', 'Load word to coprocessor 1', { isMemory: true, category: 'float' });
        this.addIType('swc1', 0x39, '$f, offset(rs)', 'Store word from coprocessor 1', { isMemory: true, category: 'float' });
        this.addIType('ldc1', 0x35, '$f, offset(rs)', 'Load doubleword to coprocessor 1', { isMemory: true, category: 'float' });
        this.addIType('sdc1', 0x3D, '$f, offset(rs)', 'Store doubleword from coprocessor 1', { isMemory: true, category: 'float' });

        // FP coprocessor move (fmt=0x00 for mfc1, fmt=0x04 for mtc1)
        this.addRType('mfc1', 0x11, 0x00, '$rt, $f', 'Move from coprocessor 1', { fmt: 0x00, category: 'float' });
        this.addRType('mtc1', 0x11, 0x00, '$rt, $f', 'Move to coprocessor 1', { fmt: 0x04, category: 'float' });

        // FP arithmetic (single precision, fmt=0x10)
        this.addRType('add.s', 0x11, 0x00, '$fd, $fs, $ft', 'FP addition (single)', { fmt: 0x10, category: 'float' });
        this.addRType('sub.s', 0x11, 0x01, '$fd, $fs, $ft', 'FP subtraction (single)', { fmt: 0x10, category: 'float' });
        this.addRType('mul.s', 0x11, 0x02, '$fd, $fs, $ft', 'FP multiplication (single)', { fmt: 0x10, category: 'float' });
        this.addRType('div.s', 0x11, 0x03, '$fd, $fs, $ft', 'FP division (single)', { fmt: 0x10, category: 'float' });
        this.addRType('mov.s', 0x11, 0x06, '$fd, $fs', 'FP move (single)', { fmt: 0x10, category: 'float' });
        this.addRType('neg.s', 0x11, 0x07, '$fd, $fs', 'FP negate (single)', { fmt: 0x10, category: 'float' });
        this.addRType('abs.s', 0x11, 0x05, '$fd, $fs', 'FP absolute value (single)', { fmt: 0x10, category: 'float' });

        // FP arithmetic (double precision, fmt=0x11)
        this.addRType('add.d', 0x11, 0x00, '$fd, $fs, $ft', 'FP addition (double)', { fmt: 0x11, category: 'float' });
        this.addRType('sub.d', 0x11, 0x01, '$fd, $fs, $ft', 'FP subtraction (double)', { fmt: 0x11, category: 'float' });
        this.addRType('mul.d', 0x11, 0x02, '$fd, $fs, $ft', 'FP multiplication (double)', { fmt: 0x11, category: 'float' });
        this.addRType('div.d', 0x11, 0x03, '$fd, $fs, $ft', 'FP division (double)', { fmt: 0x11, category: 'float' });
        this.addRType('mov.d', 0x11, 0x06, '$fd, $fs', 'FP move (double)', { fmt: 0x11, category: 'float' });
        this.addRType('neg.d', 0x11, 0x07, '$fd, $fs', 'FP negate (double)', { fmt: 0x11, category: 'float' });
        this.addRType('abs.d', 0x11, 0x05, '$fd, $fs', 'FP absolute value (double)', { fmt: 0x11, category: 'float' });

        // FP conversion (fmt indicates source format)
        this.addRType('cvt.s.d', 0x11, 0x20, '$fd, $fs', 'Convert double to single', { fmt: 0x11, category: 'float' });
        this.addRType('cvt.d.s', 0x11, 0x21, '$fd, $fs', 'Convert single to double', { fmt: 0x10, category: 'float' });
        this.addRType('cvt.s.w', 0x11, 0x20, '$fd, $fs', 'Convert word to single', { fmt: 0x14, category: 'float' });
        this.addRType('cvt.d.w', 0x11, 0x21, '$fd, $fs', 'Convert word to double', { fmt: 0x14, category: 'float' });
        this.addRType('cvt.w.s', 0x11, 0x24, '$fd, $fs', 'Convert single to word', { fmt: 0x10, category: 'float' });
        this.addRType('cvt.w.d', 0x11, 0x24, '$fd, $fs', 'Convert double to word', { fmt: 0x11, category: 'float' });

        // FP comparison (single, fmt=0x10)
        this.addRType('c.eq.s', 0x11, 0x32, '$fs, $ft', 'FP compare equal (single)', { fmt: 0x10, category: 'float' });
        this.addRType('c.lt.s', 0x11, 0x3C, '$fs, $ft', 'FP compare less than (single)', { fmt: 0x10, category: 'float' });
        this.addRType('c.le.s', 0x11, 0x3E, '$fs, $ft', 'FP compare less or equal (single)', { fmt: 0x10, category: 'float' });
        // FP comparison (double, fmt=0x11)
        this.addRType('c.eq.d', 0x11, 0x32, '$fs, $ft', 'FP compare equal (double)', { fmt: 0x11, category: 'float' });
        this.addRType('c.lt.d', 0x11, 0x3C, '$fs, $ft', 'FP compare less than (double)', { fmt: 0x11, category: 'float' });
        this.addRType('c.le.d', 0x11, 0x3E, '$fs, $ft', 'FP compare less or equal (double)', { fmt: 0x11, category: 'float' });

        // FP branch
        this.addIType('bc1t', 0x11, 'label', 'Branch if FP condition true', { isBranch: true, category: 'float' });
        this.addIType('bc1f', 0x11, 'label', 'Branch if FP condition false', { isBranch: true, category: 'float' });

        // ── Pseudo-instructions ─────────────────────────────────

        // Load/move
        this.addPseudo('la', 'rd, label', 'Load address',
            'lui $at, %hi(label)\nori rd, $at, %lo(label)', { category: 'memory' });
        this.addPseudo('li', 'rd, imm', 'Load immediate (small: addiu, large: lui+ori)',
            'lui $at, %hi(imm)\nori rd, $at, %lo(imm)', { category: 'memory' });
        this.addPseudo('move', 'rd, rs', 'Move register',
            'addu rd, $zero, rs', { category: 'memory' });
        this.addPseudo('nop', '', 'No operation',
            'sll $zero, $zero, 0', { category: 'system' });

        // Branches
        this.addPseudo('b', 'label', 'Unconditional branch',
            'bgez $zero, label', { category: 'branch' });
        this.addPseudo('bal', 'label', 'Branch and link',
            'bgezal $zero, label', { category: 'branch' });
        this.addPseudo('beqz', 'rs, label', 'Branch if equal to zero',
            'beq rs, $zero, label', { category: 'branch' });
        this.addPseudo('bnez', 'rs, label', 'Branch if not equal to zero',
            'bne rs, $zero, label', { category: 'branch' });
        this.addPseudo('blt', 'rs, rt, label', 'Branch if less than (signed)',
            'slt $at, rs, rt\nbne $at, $zero, label', { category: 'branch' });
        this.addPseudo('bgt', 'rs, rt, label', 'Branch if greater than (signed)',
            'slt $at, rt, rs\nbne $at, $zero, label', { category: 'branch' });
        this.addPseudo('ble', 'rs, rt, label', 'Branch if less or equal (signed)',
            'slt $at, rt, rs\nbeq $at, $zero, label', { category: 'branch' });
        this.addPseudo('bge', 'rs, rt, label', 'Branch if greater or equal (signed)',
            'slt $at, rs, rt\nbeq $at, $zero, label', { category: 'branch' });
        this.addPseudo('bltu', 'rs, rt, label', 'Branch if less than (unsigned)',
            'sltu $at, rs, rt\nbne $at, $zero, label', { category: 'branch' });
        this.addPseudo('bgtu', 'rs, rt, label', 'Branch if greater than (unsigned)',
            'sltu $at, rt, rs\nbne $at, $zero, label', { category: 'branch' });
        this.addPseudo('bleu', 'rs, rt, label', 'Branch if less or equal (unsigned)',
            'sltu $at, rt, rs\nbeq $at, $zero, label', { category: 'branch' });
        this.addPseudo('bgeu', 'rs, rt, label', 'Branch if greater or equal (unsigned)',
            'sltu $at, rs, rt\nbeq $at, $zero, label', { category: 'branch' });

        // Bitwise / negate / abs
        this.addPseudo('not', 'rd, rs', 'Bitwise NOT (bit inversion)',
            'nor rd, rs, $zero', { category: 'logical' });
        this.addPseudo('neg', 'rd, rs', 'Negate (signed)',
            'sub rd, $zero, rs', { category: 'arithmetic' });
        this.addPseudo('negu', 'rd, rs', 'Negate (unsigned)',
            'subu rd, $zero, rs', { category: 'arithmetic' });
        this.addPseudo('abs', 'rd, rs', 'Absolute value',
            'sra $at, rs, 31\nxor rd, $at, rs\nsubu rd, rd, $at', { category: 'arithmetic' });

        // Subtraction immediate
        this.addPseudo('subi', 'rd, rs, imm', 'Subtraction immediate',
            'lui $at, %hi(imm)\nori $at, $at, %lo(imm)\nsub rd, rs, $at', { category: 'arithmetic' });
        this.addPseudo('subiu', 'rd, rs, imm', 'Subtraction immediate unsigned',
            'lui $at, %hi(imm)\nori $at, $at, %lo(imm)\nsubu rd, rs, $at', { category: 'arithmetic' });

        // Multiply
        this.addPseudo('mul', 'rd, rs, rt', 'Multiply (result to register)',
            'mult rs, rt\nmflo rd', { category: 'arithmetic' });
        this.addPseudo('mulu', 'rd, rs, rt', 'Multiply unsigned (result to register)',
            'multu rs, rt\nmflo rd', { category: 'arithmetic' });
        this.addPseudo('mulo', 'rd, rs, rt', 'Multiply with overflow check',
            'mult rs, rt\nmfhi $at\nmflo rd\nsra rd, rd, 31\nbeq $at, rd, +8\nbreak\nmflo rd', { category: 'arithmetic' });
        this.addPseudo('mulou', 'rd, rs, rt', 'Multiply unsigned with overflow check',
            'multu rs, rt\nmfhi $at\nbeq $at, $zero, +8\nbreak\nmflo rd', { category: 'arithmetic' });

        // Remainder
        this.addPseudo('rem', 'rd, rs, rt', 'Remainder (signed)',
            'bne rt, $zero, +8\nbreak\ndiv rs, rt\nmfhi rd', { category: 'arithmetic' });
        this.addPseudo('remu', 'rd, rs, rt', 'Remainder (unsigned)',
            'bne rt, $zero, +8\nbreak\ndivu rs, rt\nmfhi rd', { category: 'arithmetic' });

        // Set comparisons
        this.addPseudo('seq', 'rd, rs, rt', 'Set if equal',
            'subu rd, rs, rt\nori $at, $zero, 1\nsltu rd, rd, $at', { category: 'comparison' });
        this.addPseudo('sne', 'rd, rs, rt', 'Set if not equal',
            'subu rd, rs, rt\nsltu rd, $zero, rd', { category: 'comparison' });
        this.addPseudo('sge', 'rd, rs, rt', 'Set if greater or equal (signed)',
            'slt rd, rs, rt\nori $at, $zero, 1\nsubu rd, $at, rd', { category: 'comparison' });
        this.addPseudo('sgeu', 'rd, rs, rt', 'Set if greater or equal (unsigned)',
            'sltu rd, rs, rt\nori $at, $zero, 1\nsubu rd, $at, rd', { category: 'comparison' });
        this.addPseudo('sgt', 'rd, rs, rt', 'Set if greater than (signed)',
            'slt rd, rt, rs', { category: 'comparison' });
        this.addPseudo('sgtu', 'rd, rs, rt', 'Set if greater than (unsigned)',
            'sltu rd, rt, rs', { category: 'comparison' });
        this.addPseudo('sle', 'rd, rs, rt', 'Set if less or equal (signed)',
            'slt rd, rt, rs\nori $at, $zero, 1\nsubu rd, $at, rd', { category: 'comparison' });
        this.addPseudo('sleu', 'rd, rs, rt', 'Set if less or equal (unsigned)',
            'sltu rd, rt, rs\nori $at, $zero, 1\nsubu rd, $at, rd', { category: 'comparison' });

        // Rotate
        this.addPseudo('rol', 'rd, rs, rt', 'Rotate left',
            'subu $at, $zero, rt\nsrlv $at, rs, $at\nsllv rd, rs, rt\nor rd, rd, $at', { category: 'logical' });
        this.addPseudo('ror', 'rd, rs, rt', 'Rotate right',
            'subu $at, $zero, rt\nsllv $at, rs, $at\nsrlv rd, rs, rt\nor rd, rd, $at', { category: 'logical' });

        // FP coprocessor pseudo-instructions
        this.addPseudo('l.s', '$f, label', 'Load floating point single precision',
            'lwc1 $f, label', { category: 'float' });
        this.addPseudo('l.d', '$f, label', 'Load floating point double precision',
            'ldc1 $f, label', { category: 'float' });
        this.addPseudo('s.s', '$f, label', 'Store floating point single precision',
            'swc1 $f, label', { category: 'float' });
        this.addPseudo('s.d', '$f, label', 'Store floating point double precision',
            'sdc1 $f, label', { category: 'float' });
        this.addPseudo('mfc1.d', 'rt, $f', 'Move from coprocessor 1 double (2 registers)',
            'mfc1 rt, $f\nmfc1 rt+1, $f+1', { category: 'float' });
        this.addPseudo('mtc1.d', 'rt, $f', 'Move to coprocessor 1 double (2 registers)',
            'mtc1 rt, $f\nmtc1 rt+1, $f+1', { category: 'float' });

        // Doubleword load/store
        this.addPseudo('ld', 'rd, offset(rs)', 'Load doubleword (64-bit, two registers)',
            'lw rd, offset(rs)\nlw rd+1, offset+4(rs)', { category: 'memory' });
        this.addPseudo('sd', 'rd, offset(rs)', 'Store doubleword (64-bit, two registers)',
            'sw rd, offset(rs)\nsw rd+1, offset+4(rs)', { category: 'memory' });

        // Unaligned memory access
        this.addPseudo('ulw', 'rd, offset(rs)', 'Unaligned load word',
            'lwl rd, offset+3(rs)\nlwr rd, offset(rs)', { category: 'memory' });
        this.addPseudo('ulh', 'rd, offset(rs)', 'Unaligned load halfword (signed)',
            'lb rd, offset+1(rs)\nlbu $at, offset(rs)\nsll rd, rd, 8\nor rd, rd, $at', { category: 'memory' });
        this.addPseudo('ulhu', 'rd, offset(rs)', 'Unaligned load halfword (unsigned)',
            'lbu rd, offset+1(rs)\nlbu $at, offset(rs)\nsll rd, rd, 8\nor rd, rd, $at', { category: 'memory' });
        this.addPseudo('usw', 'rd, offset(rs)', 'Unaligned store word',
            'swl rd, offset+3(rs)\nswr rd, offset(rs)', { category: 'memory' });
        this.addPseudo('ush', 'rd, offset(rs)', 'Unaligned store halfword',
            'sb rd, offset(rs)\nsrl $at, rd, 8\nsb $at, offset+1(rs)', { category: 'memory' });
    }

    private addRType(name: string, opcode: number, funct: number, format: string, description: string, flags: InstructionFlags = {}): void {
        this.instructions.set(name, new Instruction(name, InstructionType.R, opcode, funct, format, description, null, flags));
    }

    private addIType(name: string, opcode: number, format: string, description: string, flags: InstructionFlags = {}): void {
        this.instructions.set(name, new Instruction(name, InstructionType.I, opcode, 0, format, description, null, flags));
    }

    private addJType(name: string, opcode: number, format: string, description: string, flags: InstructionFlags = {}): void {
        this.instructions.set(name, new Instruction(name, InstructionType.J, opcode, 0, format, description, null, flags));
    }

    private addPseudo(name: string, format: string, description: string, expansion: string, flags: InstructionFlags = {}): void {
        this.instructions.set(name, new Instruction(name, InstructionType.PSEUDO, 0, 0, format, description, expansion, flags));
    }
}
