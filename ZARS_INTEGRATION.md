# Integrating Zars WASM Runtime

This guide explains how to integrate the [zars](https://github.com/robertmorelli/zars) WebAssembly runtime into the VSCode extension to replace the Java-based MARS simulator.

## Benefits of Zars

- **No Java dependency**: Runs directly in the VSCode extension process via WebAssembly
- **Cross-platform**: Works identically on Windows, macOS, and Linux
- **Faster startup**: No JVM initialization overhead
- **Portable**: Can be bundled directly with the extension
- **Browser-ready**: Same runtime can power web-based MIPS IDEs

## Building Zars WASM Module

```bash
# From the repository root
cd third_party/zars

# Build the WASM runtime
zig build wasm-runtime

# Output will be at: zig-out/bin/lib/zars_runtime.wasm
```

## WASM API Overview

The zars runtime exposes the following functions:

### Initialization
- `zars_reset()`: Reset the runtime to initial state
- `zars_program_ptr()`: Get pointer to program input buffer
- `zars_program_capacity_bytes()`: Get maximum program size

### Loading & Execution
- `zars_load_program(len: u32)`: Load program from input buffer
- `zars_set_delayed_branching(enabled: u32)`: Configure delayed branching
- `zars_set_smc_enabled(enabled: u32)`: Enable self-modifying code

### I/O
- `zars_input_ptr()`: Get pointer to stdin buffer
- `zars_input_capacity_bytes()`: Get stdin buffer size
- `zars_set_input_len_bytes(len: u32)`: Set stdin length
- `zars_output_ptr()`: Get pointer to stdout buffer
- `zars_output_len_bytes()`: Get stdout length

### State Inspection
- `zars_regs_ptr()`: Get pointer to register array (32 x u32)
- `zars_fp_regs_ptr()`: Get pointer to floating-point registers
- `zars_data_ptr()`: Get pointer to .data segment
- `zars_data_len_bytes()`: Get .data segment length
- `zars_heap_ptr()`: Get pointer to heap segment
- `zars_heap_len_bytes()`: Get heap length
- `zars_last_status_code()`: Get last operation status

### Memory Layout
- `zars_data_base_addr()`: Get base address of .data segment
- `zars_heap_base_addr()`: Get base address of heap

## Integration Steps

### 1. Copy WASM Module

Copy the built WASM module into the extension:

```bash
mkdir -p vscode-mips/wasm
cp third_party/zars/zig-out/bin/lib/zars_runtime.wasm vscode-mips/wasm/
```

### 2. Load WASM in Extension

Add to `src/extension.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';

let wasmInstance: WebAssembly.Instance | undefined;
let wasmMemory: WebAssembly.Memory;

async function loadZarsRuntime(extensionPath: string): Promise<void> {
    const wasmPath = path.join(extensionPath, 'wasm', 'zars_runtime.wasm');
    const wasmBytes = fs.readFileSync(wasmPath);
    
    const wasmModule = await WebAssembly.compile(wasmBytes);
    
    // Create shared memory for WASM
    wasmMemory = new WebAssembly.Memory({ 
        initial: 256,  // 16MB initial
        maximum: 512   // 32MB max
    });
    
    wasmInstance = await WebAssembly.instantiate(wasmModule, {
        env: { memory: wasmMemory }
    });
}

// Call in activate():
await loadZarsRuntime(context.extensionPath);
```

### 3. Replace runProgram Command

Replace the Java-based simulator with WASM:

```typescript
async function runProgramWasm() {
    const editor = window.activeTextEditor;
    if (!editor || !wasmInstance) {
        window.showErrorMessage('Runtime not initialized');
        return;
    }

    const doc = editor.document;
    await doc.save();
    
    const sourceCode = doc.getText();
    const encoder = new TextEncoder();
    const sourceBytes = encoder.encode(sourceCode);
    
    // Get exports
    const exports = wasmInstance.exports as any;
    
    // 1. Reset runtime
    exports.zars_reset();
    
    // 2. Write program to WASM memory
    const programPtr = exports.zars_program_ptr();
    const programCapacity = exports.zars_program_capacity_bytes();
    
    if (sourceBytes.length > programCapacity) {
        window.showErrorMessage('Program too large');
        return;
    }
    
    const memory = new Uint8Array(wasmMemory.buffer);
    memory.set(sourceBytes, programPtr);
    
    // 3. Load program
    const loadStatus = exports.zars_load_program(sourceBytes.length);
    if (loadStatus !== 0) {
        window.showErrorMessage('Failed to load program');
        return;
    }
    
    // 4. Read output
    const outputPtr = exports.zars_output_ptr();
    const outputLen = exports.zars_output_len_bytes();
    const outputBytes = memory.slice(outputPtr, outputPtr + outputLen);
    const decoder = new TextDecoder();
    const output = decoder.decode(outputBytes);
    
    // 5. Display output in terminal or output channel
    outputChannel.appendLine(output);
    outputChannel.show();
}
```

### 4. Update package.json

Add WASM to the extension bundle:

```json
{
  "contributes": {
    "configuration": {
      "properties": {
        "mips.useWasmRuntime": {
          "type": "boolean",
          "default": true,
          "description": "Use Zars WebAssembly runtime instead of MARS JAR"
        }
      }
    }
  }
}
```

### 5. Bundle WASM with Extension

Update `.vscodeignore`:

```
# Include WASM runtime
!wasm/**
```

## Testing

1. Build the WASM module: `cd third_party/zars && zig build wasm-runtime`
2. Copy to extension: `cp third_party/zars/zig-out/bin/lib/zars_runtime.wasm vscode-mips/wasm/`
3. Compile extension: `cd vscode-mips && npm run compile`
4. Test in Extension Development Host (F5 in VSCode)

## Migration Strategy

To maintain compatibility during migration:

1. Add configuration option `mips.useWasmRuntime` (default: `false`)
2. Implement WASM runtime alongside existing MARS runtime
3. Switch based on configuration setting
4. After testing period, set default to `true`
5. Eventually remove MARS JAR dependency entirely

## Future Enhancements

Once zars is integrated:
- **Real-time execution**: Step through code with live register/memory updates
- **Web version**: Same extension can power a browser-based MIPS IDE
- **Faster feedback**: Assembly errors in milliseconds instead of JVM startup time
- **Debugging protocol**: Implement DAP (Debug Adapter Protocol) for breakpoints
- **Memory visualization**: Live memory viewer using `zars_data_ptr()` and `zars_heap_ptr()`

## Resources

- Zars repository: https://github.com/robertmorelli/zars
- WebAssembly MDN docs: https://developer.mozilla.org/en-US/docs/WebAssembly
- VSCode Extension API: https://code.visualstudio.com/api
