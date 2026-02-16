/**
 * Single source of truth for MIPS assembler directives.
 * Parser, MipsLanguageService completions, and hover all derive from this.
 */

export interface DirectiveDef {
    /** Directive name including dot (e.g. '.word') */
    name: string;
    /** Human-readable description for hover */
    description: string;
    /** Size per value in bytes, or null for variable-size directives */
    unitSize: number | null;
}

const DIRECTIVE_DEFS: readonly DirectiveDef[] = [
    { name: '.text',   description: '**.text** [address]\n\nBegin text (code) segment. Optional address sets the starting location.', unitSize: null },
    { name: '.data',   description: '**.data** [address]\n\nBegin data segment. Optional address sets the starting location.', unitSize: null },
    { name: '.globl',  description: '**.globl** symbol\n\nDeclare symbol as global (visible to other files).', unitSize: null },
    { name: '.word',   description: '**.word** value [, value]...\n\nStore 32-bit word(s) in memory.', unitSize: 4 },
    { name: '.half',   description: '**.half** value [, value]...\n\nStore 16-bit halfword(s) in memory.', unitSize: 2 },
    { name: '.byte',   description: '**.byte** value [, value]...\n\nStore 8-bit byte(s) in memory.', unitSize: 1 },
    { name: '.ascii',  description: '**.ascii** "string"\n\nStore string in memory (no null terminator).', unitSize: null },
    { name: '.asciiz', description: '**.asciiz** "string"\n\nStore null-terminated string in memory.', unitSize: null },
    { name: '.space',  description: '**.space** n\n\nReserve n bytes of uninitialized space.', unitSize: null },
    { name: '.align',  description: '**.align** n\n\nAlign next data on 2^n byte boundary.', unitSize: null },
    { name: '.float',  description: '**.float** value [, value]...\n\nStore 32-bit IEEE 754 float(s) in memory.', unitSize: 4 },
    { name: '.double', description: '**.double** value [, value]...\n\nStore 64-bit IEEE 754 double(s) in memory.', unitSize: 8 },
] as const;

// ── Derived data structures ──

const DIRECTIVE_BY_NAME: ReadonlyMap<string, DirectiveDef> = new Map(
    DIRECTIVE_DEFS.map(d => [d.name, d])
);

const DIRECTIVE_HOVER_MAP: Readonly<Record<string, string>> = (() => {
    const map: Record<string, string> = {};
    for (const d of DIRECTIVE_DEFS) {
        map[d.name] = d.description;
    }
    return map;
})();

// ── Public API ──

export const DirectiveRegistry = {
    getAll(): readonly DirectiveDef[] {
        return DIRECTIVE_DEFS;
    },

    get(name: string): DirectiveDef | undefined {
        return DIRECTIVE_BY_NAME.get(name.toLowerCase());
    },

    getHoverInfo(name: string): string | null {
        return DIRECTIVE_HOVER_MAP[name.toLowerCase()] ?? null;
    },

    getCompletionNames(): readonly string[] {
        return DIRECTIVE_DEFS.map(d => d.name);
    },

    /** Get unit size for data directives (e.g. '.word' -> 4). Returns null for non-data directives. */
    getUnitSize(name: string): number | null {
        return DIRECTIVE_BY_NAME.get(name.toLowerCase())?.unitSize ?? null;
    },
} as const;
