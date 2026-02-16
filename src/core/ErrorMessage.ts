/**
 * Represents occurrence of an error detected during tokenizing, assembly or simulation.
 */

export class ErrorMessage {
    private _isWarning: boolean;
    private filename: string;
    private line: number;
    private position: number;
    private message: string;

    constructor(filename: string, line: number, position: number, message: string, opts?: { isWarning?: boolean }) {
        this._isWarning = opts?.isWarning ?? false;
        this.filename = filename ?? '';
        this.line = line;
        this.position = position;
        this.message = message;
    }

    /** Factory for warning messages — avoids the fragile boolean-first constructor. */
    static warning(filename: string, line: number, position: number, message: string): ErrorMessage {
        return new ErrorMessage(filename, line, position, message, { isWarning: true });
    }

    getFilename(): string {
        return this.filename;
    }

    getLine(): number {
        return this.line;
    }

    getPosition(): number {
        return this.position;
    }

    getMessage(): string {
        return this.message;
    }

    isWarning(): boolean {
        return this._isWarning;
    }

    toString(): string {
        let sb = this._isWarning ? 'Warning' : 'Error';
        if (this.filename && this.filename.length > 0) {
            sb += ' in ' + this.filename;
        }
        if (this.line > 0) {
            sb += ' line ' + this.line;
        }
        if (this.position > 0) {
            sb += ' column ' + this.position;
        }
        sb += ': ' + this.message;
        return sb;
    }
}
