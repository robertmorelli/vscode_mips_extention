/**
 * Lexical analysis for MIPS assembly.
 * Splits source code into tokens (labels, instructions, registers, numbers, etc.)
 */

import { SourceResolver } from './SourceResolver';
import { TokenList } from './TokenList';
import { Token } from './Token';
import { TokenType, classify } from './TokenType';
import { ErrorList } from './ErrorList';
import { ErrorMessage } from './ErrorMessage';

export class Tokenizer {
    private sourceResolver: SourceResolver;
    /** Tracks the current include chain to detect circular includes */
    private includeChain: Set<string> = new Set();

    constructor(sourceResolver: SourceResolver) {
        this.sourceResolver = sourceResolver;
    }

    /**
     * Tokenize the entire source string. Returns one TokenList per non-empty source line.
     */
    tokenize(filename: string, source: string, errors: ErrorList): TokenList[] {
        // Add this file to the include chain (for root file on first call)
        const isRoot = this.includeChain.size === 0;
        this.includeChain.add(filename);

        const result: TokenList[] = [];
        const lines = source.split('\n');

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineNumber = i + 1;

            // Handle .include directives
            if (this.isIncludeDirective(line)) {
                const includedTokens = this.handleInclude(filename, line, lineNumber, errors);
                if (includedTokens) {
                    result.push(...includedTokens);
                }
                continue;
            }

            try {
                const tokens = this.tokenizeLine(filename, line, lineNumber, errors);
                if (tokens.length > 0) {
                    const tokenList = new TokenList(tokens, lineNumber, filename);
                    tokenList.setProcessedLine(line);
                    result.push(tokenList);
                }
            } catch (e: any) {
                errors.add(new ErrorMessage(filename, lineNumber, 0, e.message));
            }
        }

        if (isRoot) {
            this.includeChain.clear();
        }
        return result;
    }

    private isIncludeDirective(line: string): boolean {
        return /^\s*\.include\s+"/i.test(line);
    }

    private handleInclude(filename: string, line: string, lineNumber: number, errors: ErrorList): TokenList[] | null {
        const match = line.match(/^\s*\.include\s+"([^"]+)"/i);
        if (!match) {
            errors.add(new ErrorMessage(filename, lineNumber, 0, 'Malformed .include directive'));
            return null;
        }

        const includePath = match[1];
        try {
            const resolvedPath = this.sourceResolver.resolvePath(filename, includePath);

            // Detect circular includes
            if (this.includeChain.has(resolvedPath)) {
                errors.add(new ErrorMessage(filename, lineNumber, 0,
                    `Circular .include detected: "${includePath}" is already in the include chain`));
                return null;
            }

            this.includeChain.add(resolvedPath);
            const content = this.sourceResolver.resolveContent(resolvedPath);
            const result = this.tokenize(resolvedPath, content, errors);
            this.includeChain.delete(resolvedPath);
            return result;
        } catch (e: any) {
            errors.add(new ErrorMessage(filename, lineNumber, 0,
                `Could not resolve .include "${includePath}": ${e.message}`));
            return null;
        }
    }

    /**
     * Tokenize a single line of MIPS assembly.
     */
    private tokenizeLine(filename: string, line: string, lineNumber: number, errors: ErrorList): Token[] {
        const tokens: Token[] = [];
        let pos = 0;
        const len = line.length;

        while (pos < len) {
            // Skip whitespace
            if (this.isWhitespace(line.charAt(pos))) {
                pos++;
                continue;
            }

            const c = line.charAt(pos);

            // Comment — rest of line is ignored
            if (c === '#') {
                break;
            }

            // String literal
            if (c === '"') {
                const startPos = pos;
                pos++; // skip opening quote
                let str = '"';
                let escaped = false;
                let closed = false;
                while (pos < len) {
                    const ch = line.charAt(pos);
                    str += ch;
                    if (escaped) {
                        escaped = false;
                    } else if (ch === '\\') {
                        escaped = true;
                    } else if (ch === '"') {
                        pos++;
                        closed = true;
                        break;
                    }
                    pos++;
                }
                if (!closed) {
                    errors.add(new ErrorMessage(filename, lineNumber, startPos + 1,
                        'Unclosed string literal'));
                }
                tokens.push(new Token(TokenType.QUOTED_STRING, str, filename, lineNumber, startPos + 1));
                continue;
            }

            // Character literal
            if (c === "'") {
                const startPos = pos;
                pos++; // skip opening quote
                let charVal = "'";
                if (pos < len) {
                    if (line.charAt(pos) === '\\' && pos + 1 < len) {
                        charVal += line.charAt(pos) + line.charAt(pos + 1);
                        pos += 2;
                    } else {
                        charVal += line.charAt(pos);
                        pos++;
                    }
                }
                if (pos < len && line.charAt(pos) === "'") {
                    charVal += "'";
                    pos++;
                }
                tokens.push(new Token(TokenType.INTEGER, charVal, filename, lineNumber, startPos + 1));
                continue;
            }

            // Single-character tokens
            if (c === '(') {
                tokens.push(new Token(TokenType.LEFT_PAREN, '(', filename, lineNumber, pos + 1));
                pos++;
                continue;
            }
            if (c === ')') {
                tokens.push(new Token(TokenType.RIGHT_PAREN, ')', filename, lineNumber, pos + 1));
                pos++;
                continue;
            }
            if (c === ':') {
                tokens.push(new Token(TokenType.COLON, ':', filename, lineNumber, pos + 1));
                pos++;
                continue;
            }
            if (c === ',') {
                tokens.push(new Token(TokenType.COMMA, ',', filename, lineNumber, pos + 1));
                pos++;
                continue;
            }

            // Plus / minus (could be sign for number or standalone operator)
            if (c === '+') {
                tokens.push(new Token(TokenType.PLUS, '+', filename, lineNumber, pos + 1));
                pos++;
                continue;
            }
            if (c === '-') {
                // Check if this is a negative number (preceded by comma, paren, or start-of-operands)
                const nextChar = pos + 1 < len ? line.charAt(pos + 1) : '';
                if (this.isDigit(nextChar) && this.isNegativeSign(tokens)) {
                    // Negative number — consume with the number
                    const startPos = pos;
                    const numStr = this.consumeNumber(line, pos);
                    pos += numStr.length;
                    const type = classify(numStr);
                    tokens.push(new Token(type, numStr, filename, lineNumber, startPos + 1));
                    continue;
                }
                tokens.push(new Token(TokenType.MINUS, '-', filename, lineNumber, pos + 1));
                pos++;
                continue;
            }

            // Register ($...)
            if (c === '$') {
                const startPos = pos;
                pos++; // skip $
                let regName = '$';
                while (pos < len && this.isRegisterChar(line.charAt(pos))) {
                    regName += line.charAt(pos);
                    pos++;
                }
                const type = classify(regName);
                tokens.push(new Token(type, regName, filename, lineNumber, startPos + 1));
                continue;
            }

            // Directive (.word, .text, etc.) or fp instruction (add.s, etc.)
            if (c === '.') {
                const startPos = pos;
                pos++;
                let word = '.';
                while (pos < len && this.isIdentChar(line.charAt(pos))) {
                    word += line.charAt(pos);
                    pos++;
                }
                const type = classify(word);
                tokens.push(new Token(type, word, filename, lineNumber, startPos + 1));
                continue;
            }

            // Number (starts with digit)
            if (this.isDigit(c)) {
                const startPos = pos;
                const numStr = this.consumeNumber(line, pos);
                pos += numStr.length;
                const type = classify(numStr);
                tokens.push(new Token(type, numStr, filename, lineNumber, startPos + 1));
                continue;
            }

            // Identifier or instruction
            if (this.isIdentStart(c)) {
                const startPos = pos;
                let word = '';
                while (pos < len && this.isIdentChar(line.charAt(pos))) {
                    word += line.charAt(pos);
                    pos++;
                }
                // Check for FP instructions like add.s, sub.d
                if (pos < len && line.charAt(pos) === '.') {
                    const savedPos = pos;
                    pos++;
                    let suffix = '.';
                    while (pos < len && this.isIdentChar(line.charAt(pos))) {
                        suffix += line.charAt(pos);
                        pos++;
                    }
                    const fullWord = word + suffix;
                    const fullType = classify(fullWord);
                    if (fullType === TokenType.OPERATOR) {
                        tokens.push(new Token(fullType, fullWord, filename, lineNumber, startPos + 1));
                        continue;
                    }
                    // Not an FP instruction, backtrack
                    pos = savedPos;
                }
                const type = classify(word);
                tokens.push(new Token(type, word, filename, lineNumber, startPos + 1));
                continue;
            }

            // Unknown character — skip with error
            errors.add(new ErrorMessage(filename, lineNumber, pos + 1,
                `Unexpected character: '${c}'`));
            pos++;
        }

        return tokens;
    }

    /**
     * Consume a number starting at pos. Handles decimal, hex (0x), binary (0b), octal (0), and float.
     */
    private consumeNumber(line: string, pos: number): string {
        let result = '';
        const len = line.length;

        // Optional leading minus
        if (pos < len && line.charAt(pos) === '-') {
            result += '-';
            pos++;
        }

        // Check for hex (0x) or binary (0b)
        if (pos < len && line.charAt(pos) === '0' && pos + 1 < len) {
            const next = line.charAt(pos + 1).toLowerCase();
            if (next === 'x') {
                result += '0x';
                pos += 2;
                while (pos < len && this.isHexDigit(line.charAt(pos))) {
                    result += line.charAt(pos);
                    pos++;
                }
                return result;
            }
            if (next === 'b') {
                result += '0b';
                pos += 2;
                while (pos < len && (line.charAt(pos) === '0' || line.charAt(pos) === '1')) {
                    result += line.charAt(pos);
                    pos++;
                }
                return result;
            }
        }

        // Decimal or octal integer, or floating point
        while (pos < len && this.isDigit(line.charAt(pos))) {
            result += line.charAt(pos);
            pos++;
        }

        // Floating point
        if (pos < len && line.charAt(pos) === '.') {
            result += '.';
            pos++;
            while (pos < len && this.isDigit(line.charAt(pos))) {
                result += line.charAt(pos);
                pos++;
            }
        }

        // Exponent
        if (pos < len && (line.charAt(pos) === 'e' || line.charAt(pos) === 'E')) {
            result += line.charAt(pos);
            pos++;
            if (pos < len && (line.charAt(pos) === '+' || line.charAt(pos) === '-')) {
                result += line.charAt(pos);
                pos++;
            }
            while (pos < len && this.isDigit(line.charAt(pos))) {
                result += line.charAt(pos);
                pos++;
            }
        }

        return result;
    }

    /**
     * Whether a minus sign at this point should be treated as part of a negative number
     * (vs. a standalone operator). True if the preceding token is a comma, open paren,
     * or this is the first operand position.
     */
    private isNegativeSign(tokens: Token[]): boolean {
        if (tokens.length === 0) return true;
        const lastType = tokens[tokens.length - 1].getType();
        return lastType === TokenType.COMMA ||
               lastType === TokenType.LEFT_PAREN ||
               lastType === TokenType.PLUS ||
               lastType === TokenType.MINUS ||
               lastType === TokenType.COLON ||
               lastType === TokenType.OPERATOR;
    }

    private isWhitespace(c: string): boolean {
        return c === ' ' || c === '\t' || c === '\r';
    }

    private isDigit(c: string): boolean {
        return c >= '0' && c <= '9';
    }

    private isHexDigit(c: string): boolean {
        return this.isDigit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
    }

    private isIdentStart(c: string): boolean {
        return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_';
    }

    private isIdentChar(c: string): boolean {
        return this.isIdentStart(c) || this.isDigit(c);
    }

    private isRegisterChar(c: string): boolean {
        return this.isIdentChar(c);
    }
}
