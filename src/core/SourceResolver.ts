/**
 * Interface for resolving source file content.
 * Allows the assembler to work with both disk files and in-memory content (for LSP).
 */

export interface SourceResolver {
    /**
     * Resolve the content of a source file.
     * @param pathRelativeOrAbsolute Path or URI to the source file
     * @returns The content of the source file
     * @throws Error if the file cannot be read
     */
    resolveContent(pathRelativeOrAbsolute: string): string;

    /**
     * Resolve a path relative to a base path (for .include directives).
     * @param basePath The path of the file containing the .include
     * @param includePath The path specified in the .include directive
     * @returns The resolved absolute path
     */
    resolvePath(basePath: string, includePath: string): string;
}
