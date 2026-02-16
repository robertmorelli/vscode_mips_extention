/**
 * Enumeration of MIPS assembly token types.
 */

import { InstructionSet } from './InstructionSet';
import { RegisterRegistry } from './RegisterRegistry';

export enum TokenType {
    COMMENT = 'COMMENT',
    DIRECTIVE = 'DIRECTIVE',
    OPERATOR = 'OPERATOR',          // Instruction mnemonic
    REGISTER_NAME = 'REGISTER_NAME',
    REGISTER_NUMBER = 'REGISTER_NUMBER',
    FP_REGISTER_NAME = 'FP_REGISTER_NAME',
    IDENTIFIER = 'IDENTIFIER',        // Label or symbol
    INTEGER = 'INTEGER',              // Any integer literal
    REAL_NUMBER = 'REAL_NUMBER',
    QUOTED_STRING = 'QUOTED_STRING',
    LEFT_PAREN = 'LEFT_PAREN',
    RIGHT_PAREN = 'RIGHT_PAREN',
    COLON = 'COLON',
    PLUS = 'PLUS',
    MINUS = 'MINUS',
    COMMA = 'COMMA',
    ERROR = 'ERROR'
}

export function isInteger(type: TokenType): boolean {
    return type === TokenType.INTEGER;
}

export function isFloating(type: TokenType): boolean {
    return type === TokenType.REAL_NUMBER;
}

export function classify(value: string): TokenType {
    if (!value || value.length === 0) {
        return TokenType.ERROR;
    }

    const first = value.charAt(0);

    // Comment
    if (first === '#') {
        return TokenType.COMMENT;
    }

    // Directive
    if (first === '.' && value.length > 1) {
        return TokenType.DIRECTIVE;
    }

    // Register
    if (first === '$') {
        return classifyRegister(value);
    }

    // String literal
    if (first === '"') {
        return TokenType.QUOTED_STRING;
    }

    // Single character tokens
    if (value.length === 1) {
        switch (first) {
            case '(': return TokenType.LEFT_PAREN;
            case ')': return TokenType.RIGHT_PAREN;
            case ':': return TokenType.COLON;
            case '+': return TokenType.PLUS;
            case '-': return TokenType.MINUS;
            case ',': return TokenType.COMMA;
        }
    }

    // Number (starts with digit, or negative number)
    if (isDigit(first) || (first === '-' && value.length > 1)) {
        return classifyNumber(value);
    }

    // Hex number
    if (value.startsWith('0x') || value.startsWith('0X')) {
        return classifyNumber(value);
    }

    // Could be an instruction or identifier
    if (isValidIdentifier(value)) {
        if (InstructionSet.isInstruction(value)) {
            return TokenType.OPERATOR;
        }
        return TokenType.IDENTIFIER;
    }

    return TokenType.ERROR;
}

function classifyRegister(value: string): TokenType {
    if (value.length < 2) return TokenType.ERROR;

    const name = value.substring(1).toLowerCase();

    // Named registers (derived from RegisterRegistry — single source of truth)
    if (RegisterRegistry.isNamedRegister(name)) {
        return TokenType.REGISTER_NAME;
    }

    // Numbered registers $0-$31
    if (/^\d+$/.test(name)) {
        const num = parseInt(name);
        if (num >= 0 && num <= 31) {
            return TokenType.REGISTER_NUMBER;
        }
    }

    // FP registers
    if (/^f\d+$/.test(name)) {
        const num = parseInt(name.substring(1));
        if (num >= 0 && num <= 31) {
            return TokenType.FP_REGISTER_NAME;
        }
    }

    return TokenType.ERROR;
}

function classifyNumber(value: string): TokenType {
    try {
        let num: number;
        if (value.startsWith('0x') || value.startsWith('0X')) {
            num = parseInt(value.substring(2), 16);
        } else if (value.includes('.') || value.toLowerCase().includes('e')) {
            parseFloat(value);
            return TokenType.REAL_NUMBER;
        } else {
            num = parseInt(value);
        }

        if (isNaN(num)) return TokenType.ERROR;

        return TokenType.INTEGER;
    } catch {
        return TokenType.ERROR;
    }
}

function isValidIdentifier(value: string): boolean {
    if (value.length === 0) return false;
    const first = value.charAt(0);
    if (!isLetter(first) && first !== '_') return false;
    for (let i = 1; i < value.length; i++) {
        const c = value.charAt(i);
        if (!isLetterOrDigit(c) && c !== '_') return false;
    }
    return true;
}

function isDigit(c: string): boolean {
    return c >= '0' && c <= '9';
}

function isLetter(c: string): boolean {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}

function isLetterOrDigit(c: string): boolean {
    return isLetter(c) || isDigit(c);
}
