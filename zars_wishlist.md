# Zars Wishlist for Interactive Execution

## Priority 1: Interactive I/O Support

### New Status Code
```zig
pub const StatusCode = enum(u32) {
    ok = 0,
    invalid_program_length = 1,
    program_not_loaded = 2,
    parse_error = 3,
    halted = 4,
    runtime_error = 5,
    needs_input = 6,  // NEW: read syscall hit, input buffer empty
};
```

### New Export: Run Until Input Needed
```zig
/// Run until: halted, error, or input needed.
/// Much faster than stepping - runs at full speed until pause point.
pub export fn zars_run_until_input() u32 {
    // Execute instructions until:
    // - Program halts (syscall 10/17) -> return .halted
    // - Error occurs -> return .runtime_error
    // - Read syscall (5,6,7,8,12) hit AND input buffer empty -> return .needs_input
    // - Read syscall hit AND input available -> consume input, continue
}
```

### Behavior Change in Read Syscalls
Current: If input buffer empty → `runtime_error`
New: If input buffer empty → `needs_input` (don't advance PC, let host provide input and retry)

## Priority 2: Input Buffer Management

### New Export: Append to Input Buffer
```zig
/// Append new input to existing buffer (for interactive mode).
/// Returns new total length, or error if overflow.
pub export fn zars_append_input(len: u32) u32 {
    // Host writes to input_ptr + current_input_len
    // This adds to existing input rather than replacing
}

/// Get current input cursor position (how much has been consumed)
pub export fn zars_input_consumed_bytes() u32
```

## Priority 3: Output Streaming

### New Export: Get New Output Since Last Check
```zig
/// Get output written since last call to this function.
/// Useful for streaming output to UI in real-time.
pub export fn zars_output_since_last() u32  // Returns length of new output

/// Get pointer to start of new output (output_ptr + last_checked_len)
pub export fn zars_new_output_ptr() u32
```

## Usage Flow

```
Extension                          Zars
─────────────────────────────────────────────────────
load_program()                 →
start()                        →

run_until_input()              →   [executes many instructions]
                               ←   prints "Enter number: "
                               ←   returns needs_input

[show output to user]
[user types "42" + enter]

append_input("42\n")           →
run_until_input()              →   [continues execution]
                               ←   prints "Result: 84"
                               ←   returns halted

[show final output]
```

## Summary

| Export | Purpose |
|--------|---------|
| `zars_run_until_input()` | Run at full speed until pause needed |
| `needs_input` status | Signal that program is waiting for input |
| `zars_append_input(len)` | Add more input without replacing |
| `zars_input_consumed_bytes()` | Track input consumption |
| `zars_output_since_last()` | Stream output incrementally |
| `zars_new_output_ptr()` | Pointer to new output bytes |

This enables true interactive execution with real-time output streaming.
