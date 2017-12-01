"use strict";

import * as bluebird from "bluebird";
import * as invariant from "invariant";
import * as path from "path";

function lowerKey(key) {
  const map = "+=!1@2#3$4%5^6&7*8(9)0_-?/|\\{[}]><~`:;\"'";
  const index = map.indexOf(key);
  if (index >= 0 && index % 2 === 0) {
    return map.charAt(index + 1);
  } else {
    return key.toLowerCase();
  }
}

function optionalJson(body) {
  const json = JSON.stringify(body);
  return json === "{}" || json === "[]" ? "" : ` ${json}`;
}

export class Command {
  priority: Array<number>;

  constructor() {
    this.priority = [];
  }
  async execute(machine) {
    throw new Error("not implemented");
  }
  render() {
    throw new Error("not implemented");
  }
  parseExecute(state) {}
  compareTo(right) {
    const length = Math.min(this.priority.length, right.priority.length);
    for (let i = 0; i < length; i++) {
      if (this.priority[i] !== right.priority[i]) {
        return this.priority[i] - right.priority[i];
      }
    }
    return this.priority.length - right.priority.length;
  }

  static renderMany(commands) {
    return commands.map(cmd => cmd.render()).join(" ");
  }
}
export class NoopCommand extends Command {
  render() {
    return "[noop]";
  }
  async execute() {}
}

function register(arg) {
  console.log(arg);
}

export class ExecCommand extends Command {
  name = "exec";
  command: Command;
  options: any;

  constructor(command, options = {}) {
    super();
    this.command = command;
    this.options = options;
  }
  render() {
    return `[exec ${JSON.stringify(this.command)}${optionalJson(
      this.options
    )}]`;
  }
  async execute(machine) {
    machine.exec(this.command);
  }
}

export class I3Command extends Command {
  name = "i3";
  command: string;

  constructor(command) {
    super();
    this.command = command;
  }
  render() {
    return `[i3 ${JSON.stringify(this.command)}]`;
  }
  async execute(machine) {
    machine.i3(this.command);
  }
}

export class PreviousCommand extends Command {
  name: "command.previous";
  previousCommand: Command | null;

  constructor() {
    super();
    // Save the previous command in case this is run again in a future command (prevent loop)
    this.previousCommand = null;
  }
  render() {
    return `[previous command]`;
  }
  async execute(machine) {
    this.previousCommand = this.previousCommand || machine.previousCommand;
    return this.previousCommand.execute(machine);
  }
}
export class RecordMacroCommand extends Command {
  name = "macro.record";

  render() {
    return "[record macro]";
  }
  async execute(machine) {
    machine.recordMacro();
  }
}
export class SaveMacroCommand extends Command {
  name = "macro.save";
  word: string;

  constructor(word) {
    super();
    this.word = word;
  }
  render() {
    return `[save macro ${this.word}]`;
  }
  async execute(machine) {
    machine.saveMacro(this.word);
  }
}
export class PlayMacroCommand extends Command {
  name = "macro.play";
  word: string;

  constructor(word) {
    super();
    this.word = word;
  }
  render() {
    return `[play macro ${this.word}]`;
  }
  async execute(machine) {
    return machine.playMacro(this.word);
  }
}

export class WaitCommand extends Command {
  name = "wait";
  delay: number;

  constructor(delay) {
    super();
    this.delay = delay;
  }
  render() {
    return `[wait ${this.delay}]`;
  }
  async execute() {
    return bluebird.delay(this.delay);
  }
}
export class VscodeCommand extends Command {
  name: "vscode";
  command: string;
  args: any;

  constructor(command, args = {}) {
    super();
    this.command = command;
    this.args = args || {};
  }

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
    commands.forEach(command => {
      let key = keyMap[command.key] || command.key;
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

  render() {
    return `[vscode ${JSON.stringify(this.command)}${optionalJson(this.args)}]`;
  }
  async execute(machine) {
    return machine.vscode(this.command, this.args);
  }
}

export class CancelCommand extends Command {
  name = "cancel";

  render() {
    return "[cancel]";
  }
  async execute(machine) {
    return machine.cancel();
  }
}
export class PriorityCommand extends Command {
  name = "priority";
  priority: Array<number>;
  command: Command;

  constructor(priority, command) {
    super();
    this.priority = [priority];
    this.command = command;
  }
  render() {
    return this.command.render();
  }
  async execute(machine) {
    return this.command.execute(machine);
  }
  parseExecute(state) {
    this.command.parseExecute(state);
  }
}
export class RepeatCommand extends Command {
  name = "repeat";
  count: number;
  command: Command;

  constructor(count, command) {
    super();
    this.count = count;
    this.command = command;
  }
  render() {
    return `[repeat ${this.count} ${this.command.render()}]`;
  }
  async execute(machine) {
    for (let i = 0; i < this.count; i++) {
      await this.command.execute(machine);
    }
  }
  parseExecute(state) {
    for (let i = 0; i < this.count; i++) {
      this.command.parseExecute(state);
    }
  }
}
export class BackgroundCommand extends Command {
  name = "background";
  command: Command;

  constructor(command) {
    super();
    this.command = command;
  }
  render() {
    return `[background ${this.command.render()}]`;
  }
  async execute(machine) {
    await new Promise(resolve => {
      let timeout = setTimeout(() => resolve(), 100);
      this.command.execute(machine).then(
        () => {
          clearTimeout(timeout);
          resolve();
        },
        err => {
          console.error("Error during background command:");
          console.error(err.stack);
          clearTimeout(timeout);
          resolve();
        }
      );
    });
  }
  parseExecute(state) {
    this.command.parseExecute(state);
  }
}
export class KeyHoldCommand extends Command {
  name: "key.hold";
  key: string;
  state: boolean;

  constructor(key, state) {
    super();
    this.key = key;
    this.state = state;
  }
  async execute(machine) {
    if (this.state) {
      machine.keyDown(this.key);
    } else {
      machine.keyUp(this.key);
    }
  }
  render() {
    const action = this.state ? "hold" : "release";
    return `[key ${action} ${this.key}]`;
  }
}

export class KeyCommand extends Command {
  name: "key";
  key: string;

  constructor(key) {
    super();
    this.key = key;
  }
  parseExecute(state) {
    if (this.key === "escape") {
      state.mode.delete("vim-insert");
      state.mode.delete("vim-visual");
    }
  }

  static tryToAscii(name) {
    return (
      {
        semicolon: ";",
        underscore: "_",
        space: " "
      }[name] || name
    );
  }

  static splitModifiers(combined) {
    let split = combined.split("-");
    let key = split.pop();

    if (key.length === 0) {
      key = "-";
      split.pop();
    }

    key = KeyCommand.tryToAscii(key);

    const modifiers = split.map(
      modifier =>
        ({
          ctrl: "control"
        }[modifier] || modifier)
    );

    const lower = lowerKey(key);
    if (lower !== key) {
      key = lower;
      modifiers.push("shift");
    }

    return [key, modifiers];
  }

  async execute(machine) {
    const [key, modifiers] = KeyCommand.splitModifiers(this.key);

    if (key === "escape") {
      machine.toggleMode("vim-insert", false);
      machine.toggleMode("vim-visual", false);
    }

    machine.keyTap(key, modifiers);
  }

  render() {
    return KeyCommand.renderMany([this]);
  }

  static renderMany(commands) {
    const keys = commands.map(cmd => KeyCommand.tryToAscii(cmd.key));

    const escaped = ['"', "'"];

    let string = "";
    let rv = "";
    const closeString = () => {
      if (string) {
        rv += (rv ? " " : "") + `"${string}"`;
        string = "";
      }
    };
    const addLarge = key => {
      closeString();
      rv += (rv ? " " : "") + `<${key}>`;
    };

    for (let key of keys) {
      if (key.length > 1 || escaped.includes(key)) {
        addLarge(key);
      } else {
        string += key;
      }
    }
    closeString();
    return rv;
  }
}

export class ModeCommand extends Command {
  name: "mode";
  enable: Array<string>;
  disable: Array<string>;

  constructor(enable, disable) {
    super();
    this.enable = enable;
    this.disable = disable;
  }
  async execute(machine) {
    machine.trackModeChange(() => {
      (this.enable || []).forEach(mode => machine.mode.add(mode));
      (this.disable || []).forEach(mode => machine.mode.delete(mode));
    });
  }
  render() {
    const changes = [
      ...this.enable.map(mode => `+${mode}`),
      ...this.disable.map(mode => `-${mode}`)
    ];
    return `[mode ${changes.join(" ")}]`;
  }
  parseExecute(state) {
    state.mode = new Set([...state.mode]);
    (this.enable || []).forEach(mode => state.mode.add(mode));
    (this.disable || []).forEach(mode => state.mode.delete(mode));
  }
}

export class ClickCommand extends Command {
  name = "click";

  async execute(machine) {
    machine.click();
  }
  render() {
    return "[click]";
  }
}

export class RelativePathCommand extends Command {
  name = "type.relativePath";
  path: string;

  constructor(path) {
    super();
    this.path = path;
  }

  async execute(machine) {
    const current = await machine.fetchCurrentPath();
    let type = this.path;
    if (current) {
      type = path.relative(current, type);
    }

    for (const letter of type) {
      const [key, modifiers] = KeyCommand.splitModifiers(letter);
      machine.keyTap(key, modifiers);
    }
  }
  render() {
    return `[relpath ${this.path}]`;
  }
}

export class SleepCommand extends Command {
  name: "sleep";
  flag: boolean;

  constructor(flag) {
    super();
    this.flag = flag;
  }

  async execute(machine) {
    machine.setSleep(this.flag);
  }
  render() {
    return `[${this.flag ? "sleep" : "wake up"}]`;
  }
}
export class RecordCommand extends Command {
  name = "record";
  flag: boolean;

  constructor(flag) {
    super();
    this.flag = flag;
  }

  async execute(machine) {
    machine.setRecord(this.flag);
  }
  render() {
    return `[record ${this.flag}]`;
  }
}

export class MultiCommand extends Command {
  name = "multi";
  commands: Array<Command>;

  constructor(commands) {
    super();
    [this.commands, this.priority] = MultiCommand.flatten(commands);
  }

  render() {
    return MultiCommand.renderMany(this.commands);
  }

  splitByClass() {
    return MultiCommand.splitByClass(this.commands);
  }

  static splitByClass(commands) {
    const rest = [...commands];
    let first = [];
    while (rest.length) {
      if (rest[0] instanceof MultiCommand) {
        rest.unshift(...rest.shift().commands);
      } else if (rest[0] instanceof NoopCommand) {
        rest.shift();
      } else if (first.length === 0) {
        first.push(rest.shift());
      } else if (first[0].constructor === rest[0].constructor) {
        first.push(rest.shift());
      } else {
        break;
      }
    }
    return [first, rest];
  }

  static renderMany(commands) {
    const [first, rest] = MultiCommand.splitByClass(commands);

    if (!first.length) {
      return "[noop]";
    }

    let rendered = (first[0].constructor.renderMany || Command.renderMany)(
      first
    );
    if (rest.length) {
      rendered += " " + MultiCommand.renderMany(rest);
    }
    return rendered;
  }

  static flatten(commands) {
    const rv = [];
    const priority = [];
    commands.forEach(el => {
      priority.push(...(el.priority || []));
      if (el instanceof MultiCommand) {
        rv.push(...el.commands);
      } else if (el instanceof PriorityCommand) {
        rv.push(el.command);
      } else if (!(el instanceof NoopCommand)) {
        rv.push(el);
      }
    });
    return [rv, priority];
  }

  static fromArray(arr) {
    return new MultiCommand(arr);
  }

  async execute(machine) {
    for (let command of this.commands) {
      await command.execute(machine);
    }
  }
  parseExecute(state) {
    this.commands.forEach(command => command.parseExecute(state));
  }
}
