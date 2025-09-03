import * as vscode from "vscode";
import { spawn } from "child_process";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import * as fsp from "fs/promises";

function toPosix(p: string): string {
  return p.split(path.sep).join("/");
}

function substitute(template: string, tokens: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => tokens[k] ?? "");
}

async function ensureUniquePath(filePath: string): Promise<string> {
  // If file exists, append -1, -2, ...
  if (!fs.existsSync(filePath)) return filePath;
  const { dir, name, ext } = path.parse(filePath);
  let i = 1;
  while (true) {
    const candidate = path.join(dir, `${name}-${i}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
    i += 1;
  }
}

async function runRdump(
  args: string[],
  cwd: string,
  commandPath: string,
  output: vscode.OutputChannel
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(commandPath, args, { cwd, shell: false });

    child.stdout.on("data", (d) => output.append(d.toString()));
    child.stderr.on("data", (d) => output.append(d.toString()));

    child.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(
          new Error(
            `Could not find "${commandPath}". Make sure rdump is installed or update the 'rdump.commandPath' setting.`
          )
        );
      } else {
        reject(err);
      }
    });

    child.on("close", (code) => resolve(code ?? -1));
  });
}

export function activate(context: vscode.ExtensionContext) {
  const output = vscode.window.createOutputChannel("RDump");

  const disposable = vscode.commands.registerCommand(
    "rdump.dumpFolder",
    async (resourceUri?: vscode.Uri, selectedUris?: vscode.Uri[]) => {
      try {
        let targetUri = resourceUri;

        // If invoked from the palette (no URI), prompt for a folder
        if (!targetUri) {
          const pick = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: "Select folder to dump",
          });
          if (!pick || pick.length === 0) return;
          targetUri = pick[0];
        }

        // Validate it's a folder
        const stat = await fsp.stat(targetUri.fsPath);
        if (!stat.isDirectory()) {
          vscode.window.showErrorMessage("Please select a folder.");
          return;
        }

        // Workspace context
        const wsFolder = vscode.workspace.getWorkspaceFolder(targetUri);
        const workspaceRoot =
          wsFolder?.uri.fsPath ?? path.dirname(targetUri.fsPath);
        const workspaceName = wsFolder?.name ?? path.basename(workspaceRoot);

        const folderPath = targetUri.fsPath;
        const folderBasename = path.basename(folderPath);
        const folderRelativePath = wsFolder
          ? path.relative(wsFolder.uri.fsPath, folderPath)
          : ""; // prefer empty when outside workspace

        // --- Relative/absolute path handling for the rdump query ---
        const posixAbs = toPosix(folderPath);
        const posixRel = toPosix(folderRelativePath || "");

        function quoteIfNeeded(p: string): string {
          // Quote if spaces, quotes, or backslashes are present; escape " and \.
          return /[\s"\\]/.test(p) ? `"${p.replace(/(["\\])/g, "\\$1")}"` : p;
        }

        const folderPathQuoted = quoteIfNeeded(posixAbs);
        const folderRelativePathQuoted = quoteIfNeeded(posixRel);

        // Prefer relative within the workspace; otherwise fall back to absolute
        const selectedPathForQuery =
          posixRel.length > 0 ? folderRelativePathQuoted : folderPathQuoted;

        const config = vscode.workspace.getConfiguration();
        const commandPath = config.get<string>("rdump.commandPath", "rdump");
        const searchQueryTpl = config.get<string>(
          "rdump.searchQuery",
          "in:{selectedPathForQuery}/** & (ext:ts | ext:tsx)"
        );
        const outputPattern = config.get<string>(
          "rdump.outputNamePattern",
          "dump-{folderBasename}.txt"
        );
        const outputLocation = config.get<string>(
          "rdump.outputLocation",
          "selectedFolder"
        );
        const format = config.get<string>("rdump.format", "markdown");
        const openAfterCreate = config.get<boolean>(
          "rdump.openAfterCreate",
          true
        );

        const timestamp = new Date()
          .toISOString()
          .replace(/[-:T]/g, "")
          .slice(0, 13) // YYYYMMDDHH
          .replace(/(\d{8})(\d{2})\d{2}Z?$/, "$1-$2" + "00"); // YYYYMMDD-HH00

        const tokens = {
          folderPath: posixAbs,
          folderPathQuoted,
          folderRelativePath: posixRel,
          folderRelativePathQuoted,
          selectedPathForQuery,
          folderBasename,
          workspaceName,
          timestamp,
        };

        const query = substitute(searchQueryTpl, tokens);
        const fileName = substitute(outputPattern, tokens);

        let outDir: string;
        switch (outputLocation) {
          case "workspaceRoot":
            outDir = workspaceRoot;
            break;
          case "temp":
            outDir = os.tmpdir();
            break;
          case "selectedFolder":
          default:
            outDir = folderPath;
            break;
        }

        await fsp.mkdir(outDir, { recursive: true });
        const desiredOutPath = path.join(outDir, fileName);
        const outPath = await ensureUniquePath(desiredOutPath);

        output.clear();
        output.show(true);

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `RDump: dumping "${folderBasename}"...`,
            cancellable: false,
          },
          async () => {
            const args = [
              "search",
              query,
              "--output",
              outPath,
              "--format",
              format,
            ];

            output.appendLine(
              `> ${commandPath} ${args
                .map((a) => (/\s/.test(a) ? JSON.stringify(a) : a))
                .join(" ")}`
            );
            output.appendLine(`cwd: ${workspaceRoot}`);
            output.appendLine("");

            const code = await runRdump(
              args,
              workspaceRoot,
              commandPath,
              output
            );

            if (code === 0) {
              vscode.window.showInformationMessage(
                `RDump created: ${path.basename(outPath)}`
              );
              if (openAfterCreate) {
                const doc = await vscode.workspace.openTextDocument(
                  vscode.Uri.file(outPath)
                );
                await vscode.window.showTextDocument(doc, { preview: false });
              }
            } else {
              vscode.window.showErrorMessage(
                `RDump failed with exit code ${code}. See "RDump" output for details.`
              );
            }
          }
        );
      } catch (err: any) {
        vscode.window.showErrorMessage(err?.message ?? String(err));
      }
    }
  );

  context.subscriptions.push(disposable, { dispose: () => output.dispose() });
}

export function deactivate() {
  // no-op
}
