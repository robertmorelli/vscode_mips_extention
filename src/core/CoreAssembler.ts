/**
 * Main interface for the MIPS assembler core.
 * Thread-safe assembler for CLI and LSP usage.
 */

import { CoreConfig } from './CoreConfig';
import { SourceResolver } from './SourceResolver';
import { InstructionSet } from './InstructionSet';
import { AssemblyResult } from './AssemblyResult';
import { Tokenizer } from './Tokenizer';
import { Parser } from './Parser';
import { ErrorList } from './ErrorList';
import { ErrorMessage } from './ErrorMessage';

export class CoreAssembler {
    private config: CoreConfig;
    private sourceResolver: SourceResolver;
    private instructionSet: InstructionSet;

    constructor(config: CoreConfig, sourceResolver: SourceResolver) {
        this.config = config;
        this.sourceResolver = sourceResolver;
        this.instructionSet = new InstructionSet();
    }

    assemble(filename: string): AssemblyResult {
        const errors = new ErrorList(this.config.getMaximumErrorMessages());

        try {
            const source = this.sourceResolver.resolveContent(filename);
            return this.assembleSource(filename, source, errors);
        } catch (e: any) {
            errors.add(new ErrorMessage(filename, 0, 0, `Cannot read source file: ${e.message}`));
            return AssemblyResult.failure(errors);
        }
    }

    assembleSource(filename: string, source: string, errors?: ErrorList): AssemblyResult {
        const errorList = errors || new ErrorList(this.config.getMaximumErrorMessages());

        // Tokenize
        const tokenizer = new Tokenizer(this.sourceResolver);
        const tokenizedLines = tokenizer.tokenize(filename, source, errorList);

        if (errorList.errorsOccurred()) {
            return AssemblyResult.failure(errorList);
        }

        // Parse and assemble
        const parser = new Parser(this.instructionSet);
        return parser.parse(tokenizedLines, errorList);
    }

    getInstructionSet(): InstructionSet {
        return this.instructionSet;
    }

    getConfig(): CoreConfig {
        return this.config;
    }
}
