"use strict";

import * as invariant from "invariant";
import * as os from "os";
import * as path from "path";
import * as request from "request-promise";

import { Machine } from "../Machine";
import {
  StringCommand,
  MultiCommand,
  KeyCommand,
  NoopCommand
} from "../commands/base";

async function vscodeRequest(uri, payload = null) {
  const socketPath = path.join(os.homedir(), ".pegvoice/vscode-socket");
  return await request({
    url: `http://unix:${socketPath}:${uri}`,
    json: payload || true,
    method: payload ? "POST" : "GET"
  });
}

class VscodeCommand extends StringCommand {
  static commandName = "vscode";

  static fromKeyCommands(commands) {
    let rv = [];
    let typing = null;
    const keyMap = {
      enter: "\n",
      tab: "\t"
    };
    const commandMap = {
      left: "cursorLeft",
      right: "cursorRight",
      up: "cursorUp",
      down: "cursorDown",
      backspace: "deleteLeft",
      delete: "deleteRight"
    };
    commands.forEach((command: KeyCommand) => {
      let key = keyMap[command.value] || command.value;
      if (/^[ -~]$/.exec(key) || key === "\n") {
        if (!typing) {
          typing = new VscodeCommand("default:type", {
            text: ""
          });
          rv.push(typing);
        }
        typing.args.text += key;
      } else {
        typing = null;
        if (commandMap.hasOwnProperty(key)) {
          rv.push(new VscodeCommand(commandMap[key]));
        } else {
          rv.push(command);
        }
      }
    });

    return MultiCommand.fromArray(rv);
  }

  static fromTypeCommands(commands) {
    const [first, rest] = MultiCommand.splitByClass(commands);
    if (first.length && first[0] instanceof KeyCommand) {
      return MultiCommand.fromArray([
        VscodeCommand.fromKeyCommands(first),
        VscodeCommand.fromTypeCommands(rest)
      ]);
    }
    return MultiCommand.fromArray([
      ...first,
      rest.length ? VscodeCommand.fromTypeCommands(rest) : new NoopCommand()
    ]);
  }

  static fromTypeCommand(command) {
    return VscodeCommand.fromTypeCommands([command]);
  }

  async execute(machine) {
    return vscodeRequest("/command", {
      command: this.value,
      args: this.args
    });
  }
}

export function activate(machine: Machine) {
  const watchModes = [
    "inDebugMode",
    "editorTextFocus",
    "editorReadonly",
    "editorHasSelection",
    "findWidgetVisible",
    "suggestWidgetMultipleSuggestions",
    "terminalFocus",
    "editorHasRenameProvider",
    "filesExplorerFocus",
    "inSnippetMode",
    "replaceActive"
  ];

  function modeTest(modes, string) {
    if (string.includes(" && ")) {
      return string.split(" && ").every(str => modeTest(modes, str));
    } else if (string.startsWith("!")) {
      return !modeTest(modes, string.substring(1));
    }

    invariant(watchModes.includes(string), "Unknown vscode mode: %s", string);
    return modes.has(`vscode-${string}`);
  }

  machine.addTitleHandler(async title => {
    machine.mode.forEach(mode => {
      if (mode.startsWith("vscode-")) {
        machine.mode.delete(mode);
      }
    });

    let vscodeModes = [];
    /*
        let vscode = title.endsWith(' - Visual Studio Code');
        if (vscode) {
          const state = await vscodeRequest('/state');
          vscodeModes = state.modes;
        }
        */
    let vscode = title.endsWith("~~pegvoice-vscode");
    machine.toggleMode("vscode", vscode);

    if (vscode) {
      const match = /.*~~context~~(.*)~~pegvoice-vscode$/.exec(title);
      match[1]
        .split("~")
        .filter(mode => {
          return watchModes.includes(mode);
        })
        .forEach(mode => {
          machine.mode.add(`vscode-${mode}`);
        });
    }
  });
  machine.installCommand(VscodeCommand);

  return {
    VscodeCommand,
    modeTest,
    modes: watchModes
  };
}
