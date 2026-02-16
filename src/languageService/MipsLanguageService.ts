/**
 * Pure language intelligence service for MIPS assembly.
 * No `vscode` or `node` imports — consumed by both VSCode extension and standalone LSP server.
 */

import { InstructionSet } from '../core/InstructionSet';
import { RegisterRegistry } from '../core/RegisterRegistry';
import { DirectiveRegistry } from '../core/DirectiveRegistry';
import { CoreAssembler } from '../core/CoreAssembler';
import { CoreConfig } from '../core/CoreConfig';
import { SourceResolver } from '../core/SourceResolver';
import {
    HoverResult,
    CompletionItemResult,
    DiagnosticResult,
    LocationResult,
} from './types';

export class MipsLanguageService {
    private instructionSet: InstructionSet;

    constructor() {
        this.instructionSet = new InstructionSet();
    }

    // ── Hover ──────────────────────────────────────────────

    getHover(lines: string[], line: number, col: number): HoverResult | null {
        const wordInfo = this.getWordAt(lines, line, col);
        if (!wordInfo) { return null; }

        const { word, startCol, endCol } = wordInfo;
        const range = { startLine: line, startCol, endLine: line, endCol };

        // Instruction hover
        const inst = this.instructionSet.getInstruction(word);
        if (inst) {
            let text = `**${inst.getMnemonic().toUpperCase()}** — ${inst.getDescription()}\n\nFormat: \`${inst.getFormat()}\``;
            if (inst.isPseudo() && inst.getExpansion()) {
                text += `\n\n**Expands to** *(canonical form; actual encoding may optimize for small values)*:\n\`\`\`mips\n${inst.getExpansion()}\n\`\`\``;
            }
            return { contents: text, range };
        }

        // Register hover
        if (word.startsWith('$')) {
            const info = this.getRegisterInfo(word);
            if (info) { return { contents: info, range }; }
        }

        // Directive hover
        if (word.startsWith('.')) {
            const info = this.getDirectiveInfo(word);
            if (info) { return { contents: info, range }; }
        }

        // Label hover
        const labelInfo = this.findLabelInfo(lines, word);
        if (labelInfo) { return { contents: labelInfo, range }; }

        return null;
    }

    // ── Completions ────────────────────────────────────────

    getCompletions(): CompletionItemResult[] {
        const items: CompletionItemResult[] = [];

        // Instructions
        for (const mnemonic of this.instructionSet.getAllMnemonics()) {
            const inst = this.instructionSet.getInstruction(mnemonic);
            if (inst) {
                items.push({ label: mnemonic, kind: 'function', detail: inst.getDescription() });
            }
        }

        // Directives (from DirectiveRegistry — single source of truth)
        for (const name of DirectiveRegistry.getCompletionNames()) {
            items.push({ label: name, kind: 'keyword', detail: 'Directive' });
        }

        // Registers (from RegisterRegistry — single source of truth)
        for (const reg of RegisterRegistry.getCompletionNames()) {
            items.push({ label: reg, kind: 'variable', detail: 'Register' });
        }

        return items;
    }

    // ── Diagnostics ────────────────────────────────────────

    getDiagnostics(uri: string, content: string, sourceResolver: SourceResolver): DiagnosticResult[] {
        const config = new CoreConfig()
            .setExtendedAssemblerEnabled(true)
            .setWarningsAreErrors(false);

        const assembler = new CoreAssembler(config, sourceResolver);
        const result = assembler.assembleSource(uri, content);

        return result.getErrors().getErrorMessages().map(error => ({
            line: Math.max(0, error.getLine() - 1),
            col: Math.max(0, error.getPosition() - 1),
            message: error.getMessage(),
            severity: error.isWarning() ? 'warning' as const : 'error' as const,
        }));
    }

    // ── Go-to-Definition ───────────────────────────────────

    getDefinition(uri: string, lines: string[], line: number, col: number): LocationResult | null {
        const wordInfo = this.getWordAt(lines, line, col, /[a-zA-Z_][a-zA-Z0-9_]*/);
        if (!wordInfo) { return null; }

        const def = this.findLabelDefinition(lines, wordInfo.word);
        if (!def) { return null; }

        return { uri, line: def.line, col: def.col, endCol: def.col + wordInfo.word.length };
    }

    // ── Private helpers ────────────────────────────────────

    /**
     * Find the line index where a label is defined.
     * Returns { line, col } or null if not found.
     */
    private findLabelDefinition(lines: string[], label: string): { line: number; col: number } | null {
        for (let i = 0; i < lines.length; i++) {
            const lineText = lines[i];
            const trimmed = lineText.trim();
            // Match label at start of line, or after whitespace
            if (trimmed.startsWith(label + ':') ||
                trimmed.includes(' ' + label + ':') ||
                trimmed.includes('\t' + label + ':')) {
                const colIdx = lineText.indexOf(label);
                if (colIdx >= 0) {
                    return { line: i, col: colIdx };
                }
            }
        }
        return null;
    }

    private getWordAt(
        lines: string[],
        line: number,
        col: number,
        pattern: RegExp = /[a-zA-Z0-9_.$]+/,
    ): { word: string; startCol: number; endCol: number } | null {
        if (line < 0 || line >= lines.length) { return null; }
        const text = lines[line];
        if (col < 0 || col > text.length) { return null; }

        // Find the word boundaries around `col`
        const globalPattern = new RegExp(pattern.source, 'g');
        let match: RegExpExecArray | null;
        while ((match = globalPattern.exec(text)) !== null) {
            const start = match.index;
            const end = start + match[0].length;
            if (col >= start && col <= end) {
                return { word: match[0], startCol: start, endCol: end };
            }
        }
        return null;
    }

    private getRegisterInfo(reg: string): string | null {
        // Derived from RegisterRegistry — single source of truth
        return RegisterRegistry.getHoverInfo(reg);
    }

    private getDirectiveInfo(dir: string): string | null {
        // Derived from DirectiveRegistry — single source of truth
        return DirectiveRegistry.getHoverInfo(dir);
    }

    private findLabelInfo(lines: string[], word: string): string | null {
        const def = this.findLabelDefinition(lines, word);
        if (!def) { return null; }

        const trimmed = lines[def.line].trim();
        const afterLabel = trimmed.substring(trimmed.indexOf(word + ':') + word.length + 1).trim();
        const dataInfo = this.extractDataInfo(afterLabel, lines, def.line);
        if (dataInfo) {
            return `**${word}** — Label (line ${def.line + 1})\n\n${dataInfo}`;
        }
        return `**${word}** — Label defined at line ${def.line + 1}`;
    }

    private extractDataInfo(afterLabel: string, lines: string[], labelLine: number): string | null {
        let content = afterLabel;
        if (content.length === 0 && labelLine + 1 < lines.length) {
            content = lines[labelLine + 1].trim();
        }

        const lower = content.toLowerCase();

        if (lower.startsWith('.asciiz') || lower.startsWith('.ascii')) {
            const firstQuote = content.indexOf('"');
            if (firstQuote >= 0) {
                const lastQuote = content.lastIndexOf('"');
                if (lastQuote > firstQuote) {
                    const strVal = content.substring(firstQuote + 1, lastQuote);
                    const isNullTerminated = lower.startsWith('.asciiz');
                    return '```\n"' + strVal + '"' + (isNullTerminated ? ' (null-terminated)' : '') + '\n```';
                }
            }
        }

        if (lower.startsWith('.word')) {
            const values = content.replace(/\.word\s*/i, '').trim();
            return `**.word** (32-bit): \`${values}\``;
        }
        if (lower.startsWith('.byte')) {
            const values = content.replace(/\.byte\s*/i, '').trim();
            return `**.byte** (8-bit): \`${values}\``;
        }
        if (lower.startsWith('.half')) {
            const values = content.replace(/\.half\s*/i, '').trim();
            return `**.half** (16-bit): \`${values}\``;
        }
        if (lower.startsWith('.space')) {
            const sizeStr = content.replace(/\.space\s*/i, '').trim();
            return `**.space** — ${sizeStr} bytes reserved`;
        }

        return null;
    }
}
