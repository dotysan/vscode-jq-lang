import * as childProcess from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';

const diagnosticCollection = vscode.languages.createDiagnosticCollection('jq');
const timers = new Map<string, NodeJS.Timeout>();
const running = new Map<string, childProcess.ChildProcess>();
let warnedMissingExecutable = false;
let tempSequence = 0;

interface ValidationConfig {
  enabled: boolean;
  onChange: boolean;
  delay: number;
  timeout: number;
  executablePath: string;
}

interface TemporaryProgram {
  filename: string;
  cleanup: () => Promise<void>;
  cwd: string;
}

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    diagnosticCollection,
    vscode.commands.registerCommand('jq.validateDocument', async () => {
      const editor = vscode.window.activeTextEditor;
      if (editor?.document.languageId !== 'jq') {
        return;
      }
      await validateDocument(editor.document, true);
    }),
    vscode.workspace.onDidOpenTextDocument((document) => {
      if (document.languageId === 'jq') {
        scheduleValidation(document, 0);
      }
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      const config = getConfig(event.document);
      if (event.document.languageId === 'jq' && config.enabled && config.onChange) {
        scheduleValidation(event.document, config.delay);
      }
    }),
    vscode.workspace.onDidSaveTextDocument((document) => {
      if (document.languageId === 'jq' && getConfig(document).enabled) {
        scheduleValidation(document, 0);
      }
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      cancelDocument(document.uri);
      diagnosticCollection.delete(document.uri);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('jq')) {
        return;
      }
      for (const document of vscode.workspace.textDocuments) {
        if (document.languageId === 'jq') {
          scheduleValidation(document, 0);
        }
      }
    })
  );

  for (const document of vscode.workspace.textDocuments) {
    if (document.languageId === 'jq') {
      scheduleValidation(document, 0);
    }
  }
}

export function deactivate(): void {
  for (const timer of timers.values()) {
    clearTimeout(timer);
  }
  for (const process of running.values()) {
    process.kill();
  }
  diagnosticCollection.dispose();
}

function getConfig(document: vscode.TextDocument): ValidationConfig {
  const config = vscode.workspace.getConfiguration('jq', document.uri);
  return {
    enabled: config.get<boolean>('validation.enabled', true),
    onChange: config.get<boolean>('validation.onChange', true),
    delay: config.get<number>('validation.delay', 300),
    timeout: config.get<number>('validation.timeout', 1500),
    executablePath: config.get<string>('executablePath', 'jq')
  };
}

function scheduleValidation(document: vscode.TextDocument, delay: number): void {
  const key = document.uri.toString();
  const previous = timers.get(key);
  if (previous !== undefined) {
    clearTimeout(previous);
  }

  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      void validateDocument(document, false);
    }, delay)
  );
}

function cancelDocument(uri: vscode.Uri): void {
  const key = uri.toString();
  const timer = timers.get(key);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(key);
  }
  const process = running.get(key);
  if (process !== undefined) {
    process.kill();
    running.delete(key);
  }
}

async function validateDocument(document: vscode.TextDocument, showSuccess: boolean): Promise<void> {
  const config = getConfig(document);
  if (!config.enabled && !showSuccess) {
    diagnosticCollection.delete(document.uri);
    return;
  }

  const key = document.uri.toString();
  const previous = running.get(key);
  if (previous !== undefined) {
    previous.kill();
  }

  let temporary: TemporaryProgram | undefined;
  try {
    temporary = await createTemporaryProgram(document);
    const result = await runJq(
      key,
      config.executablePath,
      temporary.filename,
      temporary.cwd,
      config.timeout
    );

    if (document.version !== result.documentVersion) {
      return;
    }

    const diagnostics = parseCompileDiagnostics(document, result.stderr);
    diagnosticCollection.set(document.uri, diagnostics);

    if (showSuccess) {
      if (diagnostics.length === 0) {
        void vscode.window.showInformationMessage('jq: no compile errors found.');
      } else {
        void vscode.window.showWarningMessage(
          `jq: found ${diagnostics.length} compile error${diagnostics.length === 1 ? '' : 's'}.`
        );
      }
    }
  } catch (error: unknown) {
    if (isMissingExecutableError(error)) {
      diagnosticCollection.delete(document.uri);
      if (!warnedMissingExecutable) {
        warnedMissingExecutable = true;
        void vscode.window.showWarningMessage(
          `jq validation is unavailable because '${config.executablePath}' could not be started. Set jq.executablePath or install jq.`
        );
      }
      return;
    }

    if (showSuccess) {
      const message = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`jq validation failed: ${message}`);
    }
  } finally {
    running.delete(key);
    await temporary?.cleanup();
  }
}

async function createTemporaryProgram(document: vscode.TextDocument): Promise<TemporaryProgram> {
  const source = document.getText();
  const sequence = ++tempSequence;

  if (document.uri.scheme === 'file') {
    const directory = path.dirname(document.uri.fsPath);
    const basename = path.basename(document.uri.fsPath);
    const filename = path.join(
      directory,
      `.${basename}.jq-vscode-${process.pid}-${sequence}.tmp`
    );
    await fs.writeFile(filename, source, { encoding: 'utf8', mode: 0o600 });
    return {
      filename,
      cwd: directory,
      cleanup: async () => {
        await fs.rm(filename, { force: true });
      }
    };
  }

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'vscode-jq-'));
  const filename = path.join(directory, 'document.jq');
  await fs.writeFile(filename, source, { encoding: 'utf8', mode: 0o600 });
  return {
    filename,
    cwd: directory,
    cleanup: async () => {
      await fs.rm(directory, { recursive: true, force: true });
    }
  };
}

function runJq(
  documentKey: string,
  executablePath: string,
  filename: string,
  cwd: string,
  timeoutMs: number
): Promise<{ stderr: string; documentVersion: number }> {
  const document = vscode.workspace.textDocuments.find(
    (candidate) => candidate.uri.toString() === documentKey
  );
  const documentVersion = document?.version ?? -1;

  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(
      executablePath,
      ['--null-input', '--exit-status', '--from-file', filename],
      {
        cwd,
        env: process.env,
        stdio: ['ignore', 'ignore', 'pipe'],
        windowsHide: true
      }
    );
    running.set(documentKey, child);

    let stderr = '';
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;
    const maximumStderr = 256 * 1024;

    const finish = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
      callback();
    };

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      if (stderr.length < maximumStderr) {
        stderr += chunk.slice(0, maximumStderr - stderr.length);
      }
    });

    child.on('error', (error) => finish(() => reject(error)));
    child.on('close', () => finish(() => resolve({ stderr, documentVersion })));

    timeout = setTimeout(() => {
      child.kill();
      finish(() => resolve({ stderr: '', documentVersion }));
    }, timeoutMs);
  });
}

function parseCompileDiagnostics(
  document: vscode.TextDocument,
  stderr: string
): vscode.Diagnostic[] {
  if (!/compile error|syntax error|is not defined/.test(stderr)) {
    return [];
  }

  const diagnostics: vscode.Diagnostic[] = [];
  const lines = stderr.split(/\r?\n/);
  const locationPattern = /^jq: error:\s*(.*?)\s+at <top-level>, line (\d+)(?:, column (\d+))?:\s*$/;

  for (const line of lines) {
    const match = locationPattern.exec(line);
    if (match === null) {
      continue;
    }

    const message = match[1].trim();
    const lineNumber = clamp(Number.parseInt(match[2], 10) - 1, 0, Math.max(0, document.lineCount - 1));
    const sourceLine = document.lineAt(lineNumber);
    const parsedColumn = match[3] === undefined ? 1 : Number.parseInt(match[3], 10);
    const column = clamp(parsedColumn - 1, 0, sourceLine.text.length);
    const endColumn = Math.min(sourceLine.text.length, column + 1);
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(lineNumber, column, lineNumber, endColumn),
      message,
      vscode.DiagnosticSeverity.Error
    );
    diagnostic.source = 'jq';
    diagnostics.push(diagnostic);
  }

  if (diagnostics.length === 0 && /compile error/.test(stderr)) {
    const firstError = lines.find((line) => line.startsWith('jq: error:'));
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(0, 0, 0, Math.min(1, document.lineAt(0).text.length)),
      firstError?.replace(/^jq: error:\s*/, '') ?? 'jq compile error',
      vscode.DiagnosticSeverity.Error
    );
    diagnostic.source = 'jq';
    diagnostics.push(diagnostic);
  }

  return diagnostics;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function isMissingExecutableError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
