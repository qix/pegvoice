'use strict';

const invariant = require('invariant');

const extensions = {

  vscode: {
    modes: [
      'inDebugMode',
      'editorTextFocus',
      'editorReadonly',
      'editorHasSelection',
      'findWidgetVisible',
      'suggestWidgetMultipleSuggestions',
      'terminalFocus',
    ],
    modeTest(modes, string) {

      if (string.includes(' && ')) {
        return string.split(' && ').every(
          str => extensions.vscode.modeTest(modes, str)
        );
      } else if (string.startsWith('!')) {
        return !extensions.vscode.modeTest(modes, string.substring(1));
      }

      invariant(extensions.vscode.modes.includes(string), 'Unknown vscode mode: %s', string);
      return modes.has(`vscode-${string}`);
    },
  },
};

module.exports = extensions;
