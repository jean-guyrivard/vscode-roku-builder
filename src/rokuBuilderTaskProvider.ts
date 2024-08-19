import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as builder from "roku-builder"

const outputChannel = vscode.window.createOutputChannel("Roku Builder Log");

interface Dictionary<Type> {
  [key: string]: Type;
}

export class rokuBuilderTaskProvider implements vscode.TaskProvider {
  static buildScriptType = 'rokubuilder';

  constructor() {
  }

  public async provideTasks(): Promise<vscode.Task[]> {
    let tasks: vscode.Task[] | undefined;

    outputChannel.appendLine("Provide Tasks");

    tasks = []

		return tasks;
	}

  public resolveTask(_task: vscode.Task): vscode.Task | undefined {
    outputChannel.appendLine("Resolve Task")
    if (_task) {
		  return this.getTask(_task)
    } else {
      return undefined;
    }
	}

  private getTask(_task: vscode.Task | undefined) : vscode.Task | undefined {
    if (!_task?.scope) {
      return undefined;
    }
    const scope: vscode.WorkspaceFolder = <vscode.WorkspaceFolder>_task?.scope

    return new vscode.Task(_task.definition, scope, "Roku Builder", rokuBuilderTaskProvider.buildScriptType, new vscode.CustomExecution(async (resolveDefinition: vscode.TaskDefinition): Promise<vscode.Pseudoterminal> => {
      outputChannel.appendLine(JSON.stringify(resolveDefinition));
      const definition : rokuBuilderTaskDefinition = resolveDefinition;

      // When the task is executed, this callback will run. Here, we setup for running the task.
      return new CustomBuildTaskTerminal(scope, definition.brand, definition.targetDir);
    }));
  }
}

interface rokuBuilderTaskDefinition extends vscode.TaskDefinition {
	brand?: string;
  targetDir?: string;
}

class CustomBuildTaskTerminal implements vscode.Pseudoterminal {
  private writeEmitter = new vscode.EventEmitter<string>();
	onDidWrite: vscode.Event<string> = this.writeEmitter.event;
	private closeEmitter = new vscode.EventEmitter<number>();
	onDidClose?: vscode.Event<number> = this.closeEmitter.event;
  private configData: Dictionary<any> = {};
  private targetDir: string;

  constructor(private taskScope: vscode.WorkspaceFolder, private requestedBrand: string | undefined, targetDir: string | undefined) {
    if (!targetDir) {
      this.targetDir = path.join(taskScope.uri.fsPath, "dist")
    } else {
      this.targetDir = targetDir;
    }
  }

  open(initialDimensions: vscode.TerminalDimensions): void {
    if (!this.taskScope) {
      return;
    }
    const source = this.taskScope.uri.fsPath

    this.writeEmitter.fire('Starting build...\r\n');
    builder.doBuild({source: source, target: this.targetDir, brand: this.requestedBrand})
    .catch((reason) => {
      this.writeEmitter.fire(`Error ${reason}\r\n`);
    })
    .then(() => {
      this.writeEmitter.fire('Completed\r\n')
    })
    .finally(() => {
      this.closeEmitter.fire(0);
    })
  }
  close(): void {}
}