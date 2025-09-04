# RDump: Dump Folder

This extension adds a context menu action in VS Code to run [`rdump`](https://github.com/your/rdump) on a folder.

Right-click any folder in the Explorer and choose **RDump: Dump This Folder**.
The extension runs:

```
rdump search in:{folder}/** & (ext:ts | ext:tsx)
```

and writes the results to a file in that folder (by default named `dump-{folder}.txt`).
If the file already exists, a `-1`, `-2`, … suffix is added.

---

## Settings

- **`rdump.commandPath`** – Path to the `rdump` executable (default: `rdump`).
- **`rdump.searchQuery`** – Query template (default searches for `.ts` and `.tsx`).
- **`rdump.outputNamePattern`** – File name pattern for the output.
- **`rdump.outputLocation`** – Where to save (`selectedFolder`, `workspaceRoot`, or `temp`).
- **`rdump.format`** – Output format (`markdown`, `json`, or `text`).
- **`rdump.openAfterCreate`** – Open the generated file (default: true).

---

## Example

Right-click on a folder named `utils` → choose **RDump: Dump This Folder** → creates:

```
utils/dump-utils.txt
```

---

## Requirements

You need `rdump` installed and available in your PATH (or set `rdump.commandPath`).

---

### License

[MIT](https://github.com/amichevole89/rdump-folder-dump/blob/master/LICENSE)
