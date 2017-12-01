"use strict";

import * as invariant from "invariant";

export const vscode = {
  modes: [
    "inDebugMode",
    "editorTextFocus",
    "editorReadonly",
    "editorHasSelection",
    "findWidgetVisible",
    "suggestWidgetMultipleSuggestions",
    "terminalFocus",
    "editorHasRenameProvider",
    "filesExplorerFocus",
    "inSnippetMode"
  ],
  modeTest(modes, string) {
    if (string.includes(" && ")) {
      return string.split(" && ").every(str => vscode.modeTest(modes, str));
    } else if (string.startsWith("!")) {
      return !vscode.modeTest(modes, string.substring(1));
    }

    invariant(vscode.modes.includes(string), "Unknown vscode mode: %s", string);
    return modes.has(`vscode-${string}`);
  }
};
