# MIPS Simulator UI Plan

## CRITICAL: Interaction Model

**MIPS programs are INTERACTIVE, not batch.**

A typical MIPS program:
```
1. Print "Enter a number: "
2. Wait for user input (syscall 5)
3. Print "Enter another: "
4. Wait for user input (syscall 5)
5. Print result
6. Exit
```

**The simulator must:**
1. Run until output OR input needed
2. Display output as it happens
3. When input is needed, PAUSE and wait for user
4. User types input, presses enter
5. Continue execution
6. Repeat until program exits

**This is NOT:**
- Provide all input upfront ❌
- Run to completion ❌
- Show final output ❌

**This IS:**
- Real-time back-and-forth interaction ✓
- Like running in a terminal ✓
- Output streams as program runs ✓

**Zars requirement:** `zars_step()` must return `needs_input` status when a read syscall is encountered and input buffer is empty. Then we prompt, provide input, continue stepping.

### Current Zars Status Codes:
```
ok = 0
invalid_program_length = 1
program_not_loaded = 2
parse_error = 3
halted = 4
runtime_error = 5
```

### NEEDED: Add `needs_input = 6`

When stepping hits a read syscall (5, 6, 7, 8, 12) and input buffer is empty:
- Return `needs_input` instead of `runtime_error`
- Host provides input via `zars_set_input_len_bytes()`
- Host calls `zars_step()` again to continue

### Execution Loop (Extension Side):
```typescript
while (true) {
    const status = zars_step();

    // Update output display with any new output
    updateOutput();

    if (status === HALTED) break;
    if (status === NEEDS_INPUT) {
        // Pause, wait for user to type in input box and press enter
        const input = await waitForUserInput();
        provideInput(input);
        continue;
    }
    if (status === ERROR) {
        showError();
        break;
    }
}
```

---

## Current Status

**Working:**
- Zars WASM integration (batch execution)
- Basic webview panel (`mips.openSimulator` command)
- Register display (32 GP registers)
- Program output display
- Stdin input field
- VSCode theme integration

**Zars Exports Available:**
```
zars_reset()                 - Reset runtime
zars_load_program(len)       - Load source
zars_run()                   - Execute to completion
zars_start()                 - Initialize for stepping
zars_step()                  - Execute one instruction
zars_regs_ptr()              - 32 GP registers (i32)
zars_fp_regs_ptr()           - 32 FP registers
zars_hi() / zars_lo()        - HI/LO registers
zars_pc()                    - Program counter
zars_halted()                - Execution state
zars_fp_condition_flags()    - FP flags
zars_instruction_count()     - Total instructions
zars_data_ptr/len()          - Data segment
zars_heap_ptr/len()          - Heap segment
zars_output_ptr/len()        - stdout buffer
zars_input_ptr/len()         - stdin buffer
zars_data_base_addr()        - 0x10010000
zars_heap_base_addr()        - 0x10040000
```

## Target UI Layout

```
┌─────────────────────────────────────────────────────────┐
│  MIPS Simulator                            [Run] [Stop] │
├──────────────────────┬──────────────────────────────────┤
│  Registers           │  Output                          │
│  ──────────────────  │  ────────────────────────────    │
│  $zero: 0x00000000   │  Hello, World!                   │
│  $at:   0x00000001   │  Result: 42                      │
│  $v0:   0x0000002A   │                                  │
│  $v1:   0x00000000   │                                  │
│  $a0:   0x10010000   │                                  │
│  ...                 │                                  │
│                      ├──────────────────────────────────┤
│  $sp:   0x7FFFEFFC   │  Input                           │
│  $ra:   0x00400024   │  ┌────────────────────────────┐  │
│                      │  │ > _                        │  │
│  HI:   0x00000000    │  └────────────────────────────┘  │
│  LO:   0x00000000    │                                  │
├──────────────────────┴──────────────────────────────────┤
│  Memory (Data Segment)                    0x10010000    │
│  ─────────────────────────────────────────────────────  │
│  10010000: 48 65 6C 6C 6F 00 00 00  Hello...            │
│  10010008: 00 00 00 2A 00 00 00 00  ...*....            │
└─────────────────────────────────────────────────────────┘
```

## Implementation Phases

### Phase 1: Enhanced Basic View (Current)
- [x] Webview panel with registers/output/input
- [x] Load source from active editor
- [x] Run button (batch execution)
- [ ] Add HI/LO register display
- [ ] Add PC display
- [ ] Highlight changed registers

### Phase 2: Memory Inspector
- [ ] Display data segment (hex + ASCII)
- [ ] Display heap segment
- [ ] Address navigation input
- [ ] Highlight recently written memory

### Phase 3: Step Execution
- [ ] Step button (single instruction)
- [ ] Run/Pause/Stop controls
- [ ] PC indicator showing current instruction
- [ ] Auto-scroll to current instruction
- [ ] Speed control slider

### Phase 4: Interactive Input
- [ ] Detect when program needs input (`needs_input` status)
- [ ] Prompt for input mid-execution
- [ ] Input history

### Phase 5: DAP Integration
- [ ] Breakpoints (click in gutter)
- [ ] Debug Console for I/O
- [ ] Variables view (registers)
- [ ] Call stack (if trackable)
- [ ] Source mapping (PC → line number)

## Zars Wishlist (Remaining)

### For Phase 5 (DAP):
```zig
// Breakpoints
pub export fn zars_set_breakpoint(pc: u32) void
pub export fn zars_clear_breakpoint(pc: u32) void
pub export fn zars_clear_all_breakpoints() void

// Source mapping
pub export fn zars_pc_to_source_line(pc: u32) u32
pub export fn zars_source_line_to_pc(line: u32) u32

// Error details
pub export fn zars_error_line() u32
pub export fn zars_error_message_ptr() u32
pub export fn zars_error_message_len() u32

// Text segment (for disassembly)
pub export fn zars_text_ptr() u32
pub export fn zars_text_len_bytes() u32
pub export fn zars_text_base_addr() u32  // 0x00400000
```

### Extended status codes:
```zig
pub const StatusCode = enum(u32) {
    ok = 0,
    parse_error = 1,
    program_not_loaded = 2,
    runtime_error = 3,
    halted = 4,           // program exited normally
    needs_input = 5,      // syscall waiting for input
    breakpoint_hit = 6,   // hit a breakpoint
};
```

## Tech Stack

- **Webview**: VSCode WebviewPanel API
- **Styling**: CSS with VSCode theme variables
- **Communication**: `postMessage` / `onDidReceiveMessage`
- **Runtime**: Zars WASM (already integrated)

## File Structure

```
vscode-mips/src/
├── extension.ts        # Main extension, command registration
├── zarsRuntime.ts      # WASM wrapper
└── simulatorView.ts    # Webview panel provider
```

## Commands

| Command | Keybinding | Description |
|---------|------------|-------------|
| `mips.openSimulator` | Ctrl+Shift+M | Open simulator panel |
| `mips.run` | F5 | Run in terminal (existing) |
| `mips.assemble` | Ctrl+Shift+B | Assemble to .hex |

## VSCode Theme Variables Used

```css
--vscode-editor-background
--vscode-editor-foreground
--vscode-panel-border
--vscode-input-background
--vscode-input-foreground
--vscode-button-background
--vscode-button-foreground
--vscode-errorForeground
--vscode-terminal-ansiGreen
--vscode-symbolIcon-variableForeground
--vscode-debugTokenExpression-number
```

## Testing

1. Open a `.s` file in VSCode
2. Run command: `MIPS: Open Simulator`
3. Click "Load from Editor"
4. Click "Run"
5. Verify output and registers display correctly
