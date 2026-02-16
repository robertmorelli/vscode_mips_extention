import * as vscode from 'vscode';
import { SourceResolver } from './core/SourceResolver';

/**
 * SourceResolver for the VS Code extension.
 * Checks open editor buffers first (for unsaved changes), then falls back to workspace.fs.
 * Browser-compatible — no Node.js APIs used.
 */
export class VscodeSourceResolver implements SourceResolver {
    resolveContent(pathRelativeOrAbsolute: string): string {
        // Normalize to a URI for comparison with open documents
        const uri = this.toUri(pathRelativeOrAbsolute);

        // Check open text documents first (includes unsaved buffers)
        for (const doc of vscode.workspace.textDocuments) {
            if (doc.uri.toString() === uri.toString()) {
                return doc.getText();
            }
        }

        // workspace.fs.readFile is async but this interface is sync.
        // For files not open in the editor, we can't read them synchronously
        // in a browser context. Throw so the caller knows.
        throw new Error(`Source file not open in editor: ${pathRelativeOrAbsolute}`);
    }

    resolvePath(basePath: string, includePath: string): string {
        const baseUri = this.toUri(basePath);
        const baseDirUri = vscode.Uri.joinPath(baseUri, '..');
        const resolvedUri = vscode.Uri.joinPath(baseDirUri, includePath);
        return resolvedUri.toString();
    }

    private toUri(pathOrUri: string): vscode.Uri {
        if (pathOrUri.includes('://')) {
            return vscode.Uri.parse(pathOrUri);
        }
        return vscode.Uri.file(pathOrUri);
    }
}
