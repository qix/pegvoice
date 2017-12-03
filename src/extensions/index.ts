import * as macro from "./macro";
import * as vscode from "./vscode";
import * as invariant from "invariant";

const extensions = { vscode, macro };

export function findExtension(name: string) {
  invariant(extensions.hasOwnProperty(name), "Could not find extension");
  return extensions[name];
}
