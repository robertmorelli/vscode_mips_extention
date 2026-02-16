/**
 * Single source of truth for MIPS register definitions.
 * All register names, numbers, aliases, and descriptions are defined here once.
 * Parser, TokenType, MipsLanguageService, and completions all derive from this.
 */

export interface RegisterDef {
    /** Primary name (e.g. 'zero', 'at', 'v0') — without '$' prefix */
    name: string;
    /** Register number 0-31 */
    number: number;
    /** Human-readable description for hover */
    description: string;
    /** Calling convention category */
    category: 'constant' | 'assembler' | 'return' | 'argument' | 'temporary' | 'saved' | 'kernel' | 'pointer';
}

const REGISTER_DEFS: readonly RegisterDef[] = [
    { name: 'zero', number: 0,  description: 'Constant 0\n\nAlways contains the value 0.', category: 'constant' },
    { name: 'at',   number: 1,  description: 'Assembler temporary\n\nReserved for assembler use.', category: 'assembler' },
    { name: 'v0',   number: 2,  description: 'Function return value\n\nAlso used for syscall numbers.', category: 'return' },
    { name: 'v1',   number: 3,  description: 'Function return value\n\nSecond return value register.', category: 'return' },
    { name: 'a0',   number: 4,  description: 'Function argument 0', category: 'argument' },
    { name: 'a1',   number: 5,  description: 'Function argument 1', category: 'argument' },
    { name: 'a2',   number: 6,  description: 'Function argument 2', category: 'argument' },
    { name: 'a3',   number: 7,  description: 'Function argument 3', category: 'argument' },
    { name: 't0',   number: 8,  description: 'Temporary\n\nCaller-saved, not preserved across calls.', category: 'temporary' },
    { name: 't1',   number: 9,  description: 'Temporary\n\nCaller-saved, not preserved across calls.', category: 'temporary' },
    { name: 't2',   number: 10, description: 'Temporary\n\nCaller-saved, not preserved across calls.', category: 'temporary' },
    { name: 't3',   number: 11, description: 'Temporary\n\nCaller-saved, not preserved across calls.', category: 'temporary' },
    { name: 't4',   number: 12, description: 'Temporary\n\nCaller-saved, not preserved across calls.', category: 'temporary' },
    { name: 't5',   number: 13, description: 'Temporary\n\nCaller-saved, not preserved across calls.', category: 'temporary' },
    { name: 't6',   number: 14, description: 'Temporary\n\nCaller-saved, not preserved across calls.', category: 'temporary' },
    { name: 't7',   number: 15, description: 'Temporary\n\nCaller-saved, not preserved across calls.', category: 'temporary' },
    { name: 's0',   number: 16, description: 'Saved\n\nCallee-saved, preserved across calls.', category: 'saved' },
    { name: 's1',   number: 17, description: 'Saved\n\nCallee-saved, preserved across calls.', category: 'saved' },
    { name: 's2',   number: 18, description: 'Saved\n\nCallee-saved, preserved across calls.', category: 'saved' },
    { name: 's3',   number: 19, description: 'Saved\n\nCallee-saved, preserved across calls.', category: 'saved' },
    { name: 's4',   number: 20, description: 'Saved\n\nCallee-saved, preserved across calls.', category: 'saved' },
    { name: 's5',   number: 21, description: 'Saved\n\nCallee-saved, preserved across calls.', category: 'saved' },
    { name: 's6',   number: 22, description: 'Saved\n\nCallee-saved, preserved across calls.', category: 'saved' },
    { name: 's7',   number: 23, description: 'Saved\n\nCallee-saved, preserved across calls.', category: 'saved' },
    { name: 't8',   number: 24, description: 'Temporary\n\nCaller-saved, not preserved across calls.', category: 'temporary' },
    { name: 't9',   number: 25, description: 'Temporary\n\nCaller-saved, not preserved across calls.', category: 'temporary' },
    { name: 'k0',   number: 26, description: 'Kernel reserved\n\nReserved for OS kernel use.', category: 'kernel' },
    { name: 'k1',   number: 27, description: 'Kernel reserved\n\nReserved for OS kernel use.', category: 'kernel' },
    { name: 'gp',   number: 28, description: 'Global pointer\n\nPoints to middle of 64K global data.', category: 'pointer' },
    { name: 'sp',   number: 29, description: 'Stack pointer\n\nPoints to top of stack.', category: 'pointer' },
    { name: 'fp',   number: 30, description: 'Frame pointer\n\nPoints to current stack frame.', category: 'pointer' },
    { name: 'ra',   number: 31, description: 'Return address\n\nSet by `jal` instruction.', category: 'pointer' },
] as const;

// ── Derived data structures (computed once at module load) ──

/** Map from '$name' -> register number (e.g. '$zero' -> 0, '$t0' -> 8) */
const REGISTER_MAP: Readonly<Record<string, number>> = (() => {
    const map: Record<string, number> = {};
    for (const def of REGISTER_DEFS) {
        map[`$${def.name}`] = def.number;
    }
    return map;
})();

/** Set of all valid named register names (without '$' prefix, lowercase) for classification */
const NAMED_REGISTER_SET: ReadonlySet<string> = new Set(REGISTER_DEFS.map(d => d.name));

/** Map from '$name' -> hover markdown string */
const REGISTER_HOVER_MAP: Readonly<Record<string, string>> = (() => {
    const map: Record<string, string> = {};
    for (const def of REGISTER_DEFS) {
        map[`$${def.name}`] = `**$${def.name}** ($${def.number}) \u2014 ${def.description}`;
    }
    return map;
})();

/** Completion items for all named registers */
const REGISTER_COMPLETIONS: readonly string[] = REGISTER_DEFS.map(d => `$${d.name}`);

// ── Public API ──

export const RegisterRegistry = {
    /** All register definitions */
    getAll(): readonly RegisterDef[] {
        return REGISTER_DEFS;
    },

    /** Get register number by name (e.g. '$zero' -> 0). Returns undefined if unknown. */
    getNumber(name: string): number | undefined {
        return REGISTER_MAP[name.toLowerCase()];
    },

    /** Check if a name (without '$') is a valid named register */
    isNamedRegister(name: string): boolean {
        return NAMED_REGISTER_SET.has(name.toLowerCase());
    },

    /** Get hover markdown for a register (e.g. '$zero') */
    getHoverInfo(reg: string): string | null {
        return REGISTER_HOVER_MAP[reg.toLowerCase()] ?? null;
    },

    /** Get all register names for completions (e.g. ['$zero', '$at', ...]) */
    getCompletionNames(): readonly string[] {
        return REGISTER_COMPLETIONS;
    },

    /** The full name->number map for the parser */
    getRegisterMap(): Readonly<Record<string, number>> {
        return REGISTER_MAP;
    },
} as const;
