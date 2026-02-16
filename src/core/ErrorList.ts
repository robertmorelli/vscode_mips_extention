/**
 * Maintains list of generated error messages.
 */

import { ErrorMessage } from './ErrorMessage';

export class ErrorList {
    private messages: ErrorMessage[];
    private _errorCount: number;
    private _warningCount: number;
    private errorLimit: number;

    static readonly DEFAULT_ERROR_LIMIT = 200;

    constructor(errorLimit: number = ErrorList.DEFAULT_ERROR_LIMIT) {
        this.messages = [];
        this.errorLimit = errorLimit;
        this._errorCount = 0;
        this._warningCount = 0;
    }

    getErrorMessages(): ErrorMessage[] {
        return this.messages;
    }

    errorsOccurred(): boolean {
        return this._errorCount !== 0;
    }

    warningsOccurred(): boolean {
        return this._warningCount !== 0;
    }

    add(mess: ErrorMessage): void {
        if (this._errorCount > this.errorLimit) {
            return;
        }
        if (this._errorCount === this.errorLimit) {
            this.messages.push(new ErrorMessage('', mess.getLine(), mess.getPosition(),
                'Error Limit of ' + this.errorLimit + ' exceeded.'));
            this._errorCount++;
            return;
        }
        this.messages.push(mess);
        if (mess.isWarning()) {
            this._warningCount++;
        } else {
            this._errorCount++;
        }
    }

    errorCount(): number {
        return this._errorCount;
    }

    warningCount(): number {
        return this._warningCount;
    }

    errorLimitExceeded(): boolean {
        return this._errorCount > this.errorLimit;
    }

    getErrorLimit(): number {
        return this.errorLimit;
    }

    setErrorLimit(limit: number): void {
        this.errorLimit = limit;
    }

    generateErrorReport(): string {
        return this.generateReport(false);
    }

    generateWarningReport(): string {
        return this.generateReport(true);
    }

    generateErrorAndWarningReport(): string {
        return this.generateWarningReport() + this.generateErrorReport();
    }

    clear(): void {
        this.messages = [];
        this._errorCount = 0;
        this._warningCount = 0;
    }

    private generateReport(isWarning: boolean): string {
        let report = '';
        for (const m of this.messages) {
            if ((isWarning && m.isWarning()) || (!isWarning && !m.isWarning())) {
                report += m.toString() + '\n';
            }
        }
        return report;
    }
}
