# MIPS Assembly Extension for VS Code

Language support for MIPS assembly with LSP-based diagnostics, hover information, and go-to-definition.

## Features

- **Syntax Highlighting** - Full MIPS assembly syntax highlighting
- **Run Programs** - Execute MIPS programs with F5 (uses bundled MARS simulator)
- **Assemble** - Assemble to hex output with Ctrl+Shift+B / Cmd+Shift+B
- **LSP Features** - Hover for instruction info, go-to-definition for labels, real-time diagnostics

## Requirements

- **Java 17 or later** - Required to run the MIPS simulator and LSP server
  - [Download Java](https://adoptium.net/)
  - Verify installation: `java -version`

## Usage

1. Open a `.s`, `.asm`, or `.mips` file
2. Press **F5** to run the program
3. Press **Ctrl+Shift+B** (Cmd+Shift+B on Mac) to assemble

## Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `mips.javaPath` | Path to Java executable | `java` |
| `mips.serverPath` | Path to LSP server (for development) | Auto-detected |
| `mips.selfModifyingCode` | Enable self-modifying code support | `false` |

## Credits

This extension uses [MARS](http://courses.missouristate.edu/KenVollmar/mars/) (MIPS Assembler and Runtime Simulator) by Pete Sanderson and Kenneth Vollmar, released under the MIT License.

## License

MIT License
