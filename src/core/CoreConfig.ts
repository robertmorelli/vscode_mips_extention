/**
 * Configuration object for the MIPS assembler core.
 */

export class CoreConfig {
    private extendedAssemblerEnabled: boolean = true;
    private warningsAreErrors: boolean = false;
    private maximumErrorMessages: number = 200;

    isExtendedAssemblerEnabled(): boolean {
        return this.extendedAssemblerEnabled;
    }

    setExtendedAssemblerEnabled(enabled: boolean): CoreConfig {
        this.extendedAssemblerEnabled = enabled;
        return this;
    }

    isWarningsAreErrors(): boolean {
        return this.warningsAreErrors;
    }

    setWarningsAreErrors(warningsAreErrors: boolean): CoreConfig {
        this.warningsAreErrors = warningsAreErrors;
        return this;
    }

    getMaximumErrorMessages(): number {
        return this.maximumErrorMessages;
    }

    setMaximumErrorMessages(max: number): CoreConfig {
        this.maximumErrorMessages = max;
        return this;
    }
}
