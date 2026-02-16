#!/usr/bin/env node
/**
 * Generate mips.tmLanguage.json from InstructionSet.ts
 * This ensures the TextMate grammar stays in sync with our source of truth.
 * 
 * Usage: node scripts/generateGrammar.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Parse InstructionSet.ts to extract instruction definitions
function parseInstructionSet() {
    const filePath = join(rootDir, 'src/core/InstructionSet.ts');
    const content = readFileSync(filePath, 'utf-8');

    const instructions = {
        arithmetic: new Set(),
        logical: new Set(),
        comparison: new Set(),
        branch: new Set(),
        jump: new Set(),
        memory: new Set(),
        system: new Set(),
        float: new Set()
    };

    // Match patterns like: this.addRType('add', ..., { category: 'arithmetic' });
    // or: this.addPseudo('subiu', ..., { category: 'arithmetic' });
    const patterns = [
        /this\.add(?:RType|IType|JType|Pseudo)\('([a-z0-9_.]+)'.*?category:\s*'(\w+)'/gs,
    ];

    for (const pattern of patterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
            const [, mnemonic, category] = match;
            if (instructions[category]) {
                instructions[category].add(mnemonic);
            }
        }
    }

    // Convert Sets to sorted arrays
    for (const category in instructions) {
        instructions[category] = Array.from(instructions[category]).sort();
    }

    return instructions;
}

// Generate the TextMate grammar JSON
function generateGrammar(instructions) {
    const grammar = {
        "$schema": "https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json",
        "name": "MIPS Assembly",
        "scopeName": "source.mips",
        "patterns": [
            { "include": "#comments" },
            { "include": "#strings" },
            { "include": "#labels" },
            { "include": "#directives" },
            { "include": "#registers" },
            { "include": "#instructions" },
            { "include": "#numbers" }
        ],
        "repository": {
            "comments": {
                "patterns": [
                    {
                        "name": "comment.line.number-sign.mips",
                        "match": "#.*$"
                    }
                ]
            },
            "strings": {
                "patterns": [
                    {
                        "name": "string.quoted.double.mips",
                        "begin": "\"",
                        "end": "\"",
                        "patterns": [
                            {
                                "name": "constant.character.escape.mips",
                                "match": "\\\\."
                            }
                        ]
                    },
                    {
                        "name": "string.quoted.single.mips",
                        "match": "'(\\\\.|[^'\\\\])'"
                    }
                ]
            },
            "labels": {
                "patterns": [
                    {
                        "name": "entity.name.function.label.mips",
                        "match": "^\\s*([a-zA-Z_][a-zA-Z0-9_]*)\\s*:"
                    }
                ]
            },
            "directives": {
                "patterns": [
                    {
                        "name": "keyword.control.directive.mips",
                        "match": "\\.(text|data|ktext|kdata|globl|extern|align|space|ascii|asciiz|byte|half|word|float|double|include|eqv|macro|end_macro|set)\\b"
                    }
                ]
            },
            "registers": {
                "patterns": [
                    {
                        "name": "variable.language.register.mips",
                        "match": "\\$(zero|at|v[0-1]|a[0-3]|t[0-9]|s[0-7]|k[0-1]|gp|sp|fp|ra|[0-9]|[12][0-9]|3[01])\\b"
                    },
                    {
                        "name": "variable.language.register.fp.mips",
                        "match": "\\$f([0-9]|[12][0-9]|3[01])\\b"
                    }
                ]
            },
            "instructions": {
                "patterns": []
            },
            "numbers": {
                "patterns": [
                    {
                        "name": "constant.numeric.hex.mips",
                        "match": "\\b0[xX][0-9a-fA-F]+\\b"
                    },
                    {
                        "name": "constant.numeric.binary.mips",
                        "match": "\\b0[bB][01]+\\b"
                    },
                    {
                        "name": "constant.numeric.decimal.mips",
                        "match": "\\b-?[0-9]+\\b"
                    },
                    {
                        "name": "constant.numeric.float.mips",
                        "match": "\\b-?[0-9]+\\.[0-9]+([eE][+-]?[0-9]+)?\\b"
                    }
                ]
            }
        }
    };

    // Add instruction patterns for each category
    const categoryConfigs = [
        { key: 'arithmetic', name: 'keyword.mnemonic.arithmetic.mips' },
        { key: 'logical', name: 'keyword.mnemonic.logical.mips' },
        { key: 'comparison', name: 'keyword.mnemonic.comparison.mips' },
        { key: 'branch', name: 'keyword.mnemonic.branch.mips' },
        { key: 'jump', name: 'keyword.mnemonic.jump.mips' },
        { key: 'memory', name: 'keyword.mnemonic.memory.mips' },
        { key: 'system', name: 'keyword.mnemonic.system.mips' },
        { key: 'float', name: 'keyword.mnemonic.float.mips' }
    ];

    for (const { key, name } of categoryConfigs) {
        const mnemonics = instructions[key];
        if (mnemonics.length > 0) {
            // Escape special regex characters in mnemonics (especially '.')
            const escapedMnemonics = mnemonics.map(m => m.replace(/\./g, '\\.'));
            const pattern = `\\b(${escapedMnemonics.join('|')})\\b`;

            grammar.repository.instructions.patterns.push({
                name,
                match: pattern
            });
        }
    }

    return grammar;
}

// Main execution
try {
    console.log('📖 Parsing InstructionSet.ts...');
    const instructions = parseInstructionSet();

    // Log instruction counts
    console.log('\nInstruction counts by category:');
    for (const [category, mnemonics] of Object.entries(instructions)) {
        console.log(`  ${category.padEnd(12)} ${mnemonics.length}`);
    }
    console.log(`  ${'TOTAL'.padEnd(12)} ${Object.values(instructions).flat().length}`);

    console.log('\n🔨 Generating grammar...');
    const grammar = generateGrammar(instructions);

    const outputPath = join(rootDir, 'syntaxes/mips.tmLanguage.json');
    writeFileSync(outputPath, JSON.stringify(grammar, null, 2) + '\n', 'utf-8');

    console.log(`✅ Generated ${outputPath}`);
    console.log('   Grammar is now in sync with InstructionSet.ts!');
} catch (error) {
    console.error('❌ Error generating grammar:', error.message);
    process.exit(1);
}
