/**
 * Zars WASM Runtime Wrapper
 * 
 * A TypeScript wrapper for the Zars WebAssembly MIPS runtime.
 * This module handles loading the WASM module and provides a clean API
 * for assembling and executing MIPS programs.
 */

export const enum StatusCode {
    Ok = 0,
    InvalidProgramLength = 1,
    ProgramNotLoaded = 2,
    ParseError = 3,
    Halted = 4,
    RuntimeError = 5,
    NeedsInput = 6,
}

export interface ZarsExports {
    // Initialization
    zars_reset(): void;
    zars_program_ptr(): number;
    zars_program_capacity_bytes(): number;

    // Loading & Execution
    zars_load_program(len: number): number;
    zars_run(): number;
    zars_start(): number;
    zars_step(): number;
    zars_run_until_input(): number;
    zars_set_delayed_branching(enabled: number): void;
    zars_set_smc_enabled(enabled: number): void;

    // I/O
    zars_input_ptr(): number;
    zars_input_capacity_bytes(): number;
    zars_set_input_len_bytes(len: number): number;
    zars_append_input(additional_len: number): number;
    zars_input_consumed_bytes(): number;
    zars_output_ptr(): number;
    zars_output_len_bytes(): number;
    zars_output_capacity_bytes(): number;
    zars_output_since_last(): number;
    zars_new_output_offset(): number;

    // State inspection
    zars_regs_ptr(): number;
    zars_fp_regs_ptr(): number;
    zars_hi(): number;
    zars_lo(): number;
    zars_pc(): number;
    zars_halted(): number;
    zars_fp_condition_flags(): number;
    zars_instruction_count(): number;
    zars_data_ptr(): number;
    zars_data_len_bytes(): number;
    zars_heap_ptr(): number;
    zars_heap_len_bytes(): number;
    zars_data_base_addr(): number;
    zars_heap_base_addr(): number;
    zars_last_status_code(): number;

    // Memory
    memory: WebAssembly.Memory;
}

export interface ZarsConfig {
    delayedBranching?: boolean;
    selfModifyingCode?: boolean;
}

export interface ZarsExecutionResult {
    success: boolean;
    statusCode: number;
    output: string;
    registers?: Uint32Array;
    error?: string;
}

export interface ZarsInteractiveState {
    statusCode: StatusCode;
    newOutput: string;
    totalOutput: string;
}

export class ZarsRuntime {
    private instance: WebAssembly.Instance | null = null;
    private memory: WebAssembly.Memory | null = null;
    private exports: ZarsExports | null = null;
    /** Tracks total input bytes written so we know where to append. */
    private inputLenBytes: number = 0;

    /**
     * Load and initialize the Zars WASM runtime from bytes
     */
    async loadFromBytes(wasmBytes: Uint8Array): Promise<void> {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const wasmModule = await WebAssembly.compile(wasmBytes as any);

        // Zars exports its own memory - don't provide external memory
        this.instance = await WebAssembly.instantiate(wasmModule, {});

        this.exports = this.instance.exports as unknown as ZarsExports;
        // Use zars's exported memory
        this.memory = this.exports.memory;
    }

    /**
     * Check if the runtime is loaded and ready
     */
    isReady(): boolean {
        return this.instance !== null && this.exports !== null && this.memory !== null;
    }

    /**
     * Execute a MIPS program with optional input and configuration
     */
    execute(
        sourceCode: string,
        stdin: string = '',
        config: ZarsConfig = {}
    ): ZarsExecutionResult {
        if (!this.isReady() || !this.exports || !this.memory) {
            return {
                success: false,
                statusCode: -1,
                output: '',
                error: 'Runtime not initialized'
            };
        }

        const exports = this.exports;
        const memory = new Uint8Array(this.memory.buffer);
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();

        try {
            // 1. Reset runtime
            exports.zars_reset();

            // 2. Configure runtime
            if (config.delayedBranching !== undefined) {
                exports.zars_set_delayed_branching(config.delayedBranching ? 1 : 0);
            }
            if (config.selfModifyingCode !== undefined) {
                exports.zars_set_smc_enabled(config.selfModifyingCode ? 1 : 0);
            }

            // 3. Write program to WASM memory
            const sourceBytes = encoder.encode(sourceCode);
            const programPtr = exports.zars_program_ptr();
            const programCapacity = exports.zars_program_capacity_bytes();

            if (sourceBytes.length > programCapacity) {
                return {
                    success: false,
                    statusCode: -1,
                    output: '',
                    error: `Program too large: ${sourceBytes.length} bytes (max: ${programCapacity})`
                };
            }

            memory.set(sourceBytes, programPtr);

            // 4. Load program
            const loadStatus = exports.zars_load_program(sourceBytes.length);
            if (loadStatus !== 0) {
                return {
                    success: false,
                    statusCode: loadStatus,
                    output: '',
                    error: `Failed to load program (status: ${loadStatus})`
                };
            }

            // 5. Set stdin if provided
            if (stdin.length > 0) {
                const stdinBytes = encoder.encode(stdin);
                const inputPtr = exports.zars_input_ptr();
                const inputCapacity = exports.zars_input_capacity_bytes();

                if (stdinBytes.length > inputCapacity) {
                    return {
                        success: false,
                        statusCode: -1,
                        output: '',
                        error: `stdin too large: ${stdinBytes.length} bytes (max: ${inputCapacity})`
                    };
                }

                memory.set(stdinBytes, inputPtr);
                const setInputStatus = exports.zars_set_input_len_bytes(stdinBytes.length);
                if (setInputStatus !== 0) {
                    return {
                        success: false,
                        statusCode: setInputStatus,
                        output: '',
                        error: `Failed to set stdin (status: ${setInputStatus})`
                    };
                }
            }

            // 6. Run the program
            const runStatus = exports.zars_run();
            if (runStatus !== 0) {
                // Read any error output that might have been written
                const outputPtr = exports.zars_output_ptr();
                const outputLen = exports.zars_output_len_bytes();
                const outputBytes = memory.slice(outputPtr, outputPtr + outputLen);
                const errorOutput = decoder.decode(outputBytes);

                return {
                    success: false,
                    statusCode: runStatus,
                    output: errorOutput,
                    error: `Program execution failed (status: ${runStatus})`
                };
            }

            // 8. Read output
            const outputPtr = exports.zars_output_ptr();
            const outputLen = exports.zars_output_len_bytes();
            const outputBytes = memory.slice(outputPtr, outputPtr + outputLen);
            const output = decoder.decode(outputBytes);

            // 9. Read registers
            const regsPtr = exports.zars_regs_ptr();
            const registers = new Uint32Array(this.memory.buffer, regsPtr, 32);

            // 10. Get final status
            const statusCode = exports.zars_last_status_code();

            return {
                success: statusCode === 0,
                statusCode,
                output,
                registers: new Uint32Array(registers) // Copy to avoid memory aliasing
            };

        } catch (error) {
            return {
                success: false,
                statusCode: -1,
                output: '',
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    /**
     * Get a snapshot of the current register state
     */
    getRegisters(): Uint32Array | null {
        if (!this.isReady() || !this.exports || !this.memory) {
            return null;
        }

        const regsPtr = this.exports.zars_regs_ptr();
        const registers = new Uint32Array(this.memory.buffer, regsPtr, 32);
        return new Uint32Array(registers);
    }

    /**
     * Get a snapshot of the data segment
     */
    getDataSegment(): Uint8Array | null {
        if (!this.isReady() || !this.exports || !this.memory) {
            return null;
        }

        const dataPtr = this.exports.zars_data_ptr();
        const dataLen = this.exports.zars_data_len_bytes();
        const data = new Uint8Array(this.memory.buffer, dataPtr, dataLen);
        return new Uint8Array(data);
    }

    /**
     * Get a snapshot of the heap
     */
    getHeap(): Uint8Array | null {
        if (!this.isReady() || !this.exports || !this.memory) {
            return null;
        }

        const heapPtr = this.exports.zars_heap_ptr();
        const heapLen = this.exports.zars_heap_len_bytes();
        const heap = new Uint8Array(this.memory.buffer, heapPtr, heapLen);
        return new Uint8Array(heap);
    }

    /**
     * Reset the runtime state
     */
    reset(): void {
        if (this.exports) {
            this.exports.zars_reset();
        }
    }

    /**
     * Get HI register value
     */
    getHi(): number {
        return this.exports?.zars_hi() ?? 0;
    }

    /**
     * Get LO register value
     */
    getLo(): number {
        return this.exports?.zars_lo() ?? 0;
    }

    /**
     * Get PC (program counter)
     */
    getPc(): number {
        return this.exports?.zars_pc() ?? 0;
    }

    /**
     * Check if program has halted
     */
    isHalted(): boolean {
        return (this.exports?.zars_halted() ?? 0) !== 0;
    }

    /**
     * Get the instruction count
     */
    getInstructionCount(): number {
        return this.exports?.zars_instruction_count() ?? 0;
    }

    /**
     * Load a program and prepare for interactive (step/run_until_input) execution.
     * Returns the status code from load + start.
     */
    loadProgram(sourceCode: string, config: ZarsConfig = {}): StatusCode {
        if (!this.isReady() || !this.exports || !this.memory) {
            return StatusCode.ProgramNotLoaded;
        }

        const exports = this.exports;
        const mem = new Uint8Array(this.memory.buffer);
        const encoder = new TextEncoder();

        exports.zars_reset();
        this.inputLenBytes = 0;

        if (config.delayedBranching !== undefined) {
            exports.zars_set_delayed_branching(config.delayedBranching ? 1 : 0);
        }
        if (config.selfModifyingCode !== undefined) {
            exports.zars_set_smc_enabled(config.selfModifyingCode ? 1 : 0);
        }

        const sourceBytes = encoder.encode(sourceCode);
        const programPtr = exports.zars_program_ptr();
        const programCapacity = exports.zars_program_capacity_bytes();

        if (sourceBytes.length > programCapacity) {
            return StatusCode.InvalidProgramLength;
        }

        mem.set(sourceBytes, programPtr);

        const loadStatus = exports.zars_load_program(sourceBytes.length) as StatusCode;
        if (loadStatus !== StatusCode.Ok) {
            return loadStatus;
        }

        return exports.zars_start() as StatusCode;
    }

    /**
     * Run until the program halts, errors, or needs input.
     * Returns the new output since last call and the status.
     */
    runUntilInput(): ZarsInteractiveState {
        if (!this.isReady() || !this.exports || !this.memory) {
            return { statusCode: StatusCode.ProgramNotLoaded, newOutput: '', totalOutput: '' };
        }

        const status = this.exports.zars_run_until_input() as StatusCode;
        return this._readState(status);
    }

    /**
     * Execute a single instruction.
     * Returns the new output since last call and the status.
     */
    stepOne(): ZarsInteractiveState {
        if (!this.isReady() || !this.exports || !this.memory) {
            return { statusCode: StatusCode.ProgramNotLoaded, newOutput: '', totalOutput: '' };
        }

        const status = this.exports.zars_step() as StatusCode;
        return this._readState(status);
    }

    /**
     * Append input bytes for interactive I/O (e.g. user typed "42\n").
     * Writes new bytes at input_ptr + current total input length, then tells zars.
     */
    appendInput(text: string): StatusCode {
        if (!this.isReady() || !this.exports || !this.memory) {
            return StatusCode.ProgramNotLoaded;
        }

        const encoder = new TextEncoder();
        const bytes = encoder.encode(text);
        const mem = new Uint8Array(this.memory.buffer);
        const inputPtr = this.exports.zars_input_ptr();
        const inputCapacity = this.exports.zars_input_capacity_bytes();

        if (this.inputLenBytes + bytes.length > inputCapacity) {
            return StatusCode.RuntimeError;
        }

        mem.set(bytes, inputPtr + this.inputLenBytes);
        const status = this.exports.zars_append_input(bytes.length) as StatusCode;
        if (status === StatusCode.Ok) {
            this.inputLenBytes += bytes.length;
        }
        return status;
    }

    /**
     * Get how many input bytes have been consumed so far.
     */
    getInputConsumedBytes(): number {
        return this.exports?.zars_input_consumed_bytes() ?? 0;
    }

    /**
     * Read new output since last check, plus total output.
     */
    private _readState(status: StatusCode): ZarsInteractiveState {
        const decoder = new TextDecoder();
        const mem = new Uint8Array(this.memory!.buffer);
        const outputPtr = this.exports!.zars_output_ptr();

        // Read incremental output — get offset BEFORE consuming advances the watermark
        const newOutputOffset = this.exports!.zars_new_output_offset();
        const newOutputLen = this.exports!.zars_output_since_last();
        let newOutput = '';
        if (newOutputLen > 0) {
            const start = outputPtr + newOutputOffset;
            newOutput = decoder.decode(mem.slice(start, start + newOutputLen));
        }

        // Read total output
        const totalLen = this.exports!.zars_output_len_bytes();
        const totalOutput = decoder.decode(mem.slice(outputPtr, outputPtr + totalLen));

        return { statusCode: status, newOutput, totalOutput };
    }

}

// Example usage:
//
// const runtime = new ZarsRuntime();
// await runtime.loadFromFile('path/to/zars_runtime.wasm');
//
// const result = runtime.execute(`
//     .text
//     main:
//         li $v0, 4
//         la $a0, msg
//         syscall
//         li $v0, 10
//         syscall
//     .data
//     msg: .asciiz "Hello, MIPS!"
// `);
//
// if (result.success) {
//     console.log('Output:', result.output);
//     console.log('Registers:', result.registers);
// } else {
//     console.error('Error:', result.error);
// }
