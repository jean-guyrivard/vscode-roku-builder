import * as vscode from 'vscode';
import { rokuBuilderTaskProvider } from './rokuBuilderTaskProvider';

let rokuBuilderTask: vscode.Disposable | undefined;

export function activate(_context: vscode.ExtensionContext): void {
	rokuBuilderTask = vscode.tasks.registerTaskProvider(rokuBuilderTaskProvider.buildScriptType, new rokuBuilderTaskProvider());
}

// This method is called when your extension is deactivated
export function deactivate(): void {
  if (rokuBuilderTask) {
		rokuBuilderTask.dispose();
	}
}
