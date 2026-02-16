/**
 * Node.js SourceResolver for the standalone LSP server.
 * Checks open TextDocuments first (unsaved buffers), falls back to disk.
 */

import * as fs from 'fs';
import * as path from 'path';
import { TextDocuments } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { SourceResolver } from '../core/SourceResolver';

export class ServerSourceResolver implements SourceResolver {
    constructor(private documents: TextDocuments<TextDocument>) {}

    resolveContent(pathRelativeOrAbsolute: string): string {
        // Check open documents first (unsaved buffers take priority)
        const uri = this.toFileUri(pathRelativeOrAbsolute);
        const doc = this.documents.get(uri);
        if (doc) {
            return doc.getText();
        }

        // Fall back to reading from disk
        const filePath = this.toFilePath(pathRelativeOrAbsolute);
        return fs.readFileSync(filePath, 'utf-8');
    }

    resolvePath(basePath: string, includePath: string): string {
        const baseFile = this.toFilePath(basePath);
        const baseDir = path.dirname(baseFile);
        return path.resolve(baseDir, includePath);
    }

    private toFileUri(pathOrUri: string): string {
        if (pathOrUri.startsWith('file://')) {
            return pathOrUri;
        }
        // Convert a file path to a file:// URI
        const abs = path.resolve(pathOrUri);
        return 'file://' + abs;
    }

    private toFilePath(pathOrUri: string): string {
        if (pathOrUri.startsWith('file://')) {
            // Strip the file:// prefix
            const url = new URL(pathOrUri);
            return url.pathname;
        }
        return pathOrUri;
    }
}
