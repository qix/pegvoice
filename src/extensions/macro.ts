import { promisify } from "util";
import * as fs from "fs";
import Config from "../config";
"s";
import {
  ExecCommand,
  MultiCommand,
  SimpleCommand,
  StringCommand,
  Command
} from "../commands/base";
import { Machine } from "../Machine";

const writeFileAsync = promisify(fs.writeFile);
const readFileAsync = promisify(fs.readFile);

const definedCommands: Array<typeof Command> = [];
function saveCommand(cls: any) {
  definedCommands.push(cls);
}

let currentMacro = null;
const recordedMacros: { [name: string]: Array<Command> } = {};

async function loadMacro(machine: Machine, name: string) {
  const path = Config.getMacroPath(name);
  const commands = (await readFileAsync(path))
    .toString("utf-8")
    .split("\n")
    .filter(line => {
      return line.trim();
    })
    .map(line => machine.deserializeCommand(JSON.parse(line)));

  recordedMacros[name] = commands;
}

@saveCommand
export class RecordMacroCommand extends SimpleCommand {
  static commandName = "macro.record";
  async execute(machine) {
    currentMacro = [];
  }
}

@saveCommand
export class SaveMacroCommand extends StringCommand {
  static commandName = "macro.save";
  async execute(machine) {
    if (!currentMacro) {
      throw new Error("Not currently recording macro");
    }
    const macro = currentMacro;
    currentMacro = null;
    const [cmds] = MultiCommand.flatten(macro);

    const content =
      cmds
        .filter(cmd => {
          // Filter out any commands defined in this file
          return !definedCommands.some(
            definedCommand => cmd instanceof definedCommand
          );
        })
        .map(cmd => {
          return JSON.stringify(machine.serializeCommand(cmd));
        })
        .join("\n") + "\n";

    await writeFileAsync(Config.getMacroPath(this.value), content);

    recordedMacros[this.value] = macro;
  }
}

@saveCommand
export class EditMacroCommand extends StringCommand {
  static commandName = "macro.edit";
  constructor(name: string) {
    super(name);
  }
  async execute(machine) {
    const path = Config.getMacroPath(this.value);
    const sub = new ExecCommand(`code --wait ${path}`, {
      wait: true
    });
    await sub.execute(machine);
    await loadMacro(machine, this.value);
  }
}

@saveCommand
export class PlayMacroCommand extends StringCommand {
  static commandName = "macro.play";
  async execute(machine) {
    if (!recordedMacros.hasOwnProperty(this.value)) {
      await loadMacro(machine, this.value);
    }
    for (let command of recordedMacros[this.value]) {
      await command.execute(machine);
    }
  }
}

export function activate(machine: Machine) {
  machine.on("commandFinished", command => {
    if (currentMacro) {
      currentMacro.push(command);
    }
  });
  definedCommands.forEach(cmd => {
    machine.installCommand(cmd);
  });
}
