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

const commands: { [name: string]: typeof Command } = {};

function installCommand(command: any) {
  const { commandName } = <typeof Command>command;
  invariant(
    !commands.hasOwnProperty(commandName),
    `Command ${commandName} has already been installed.`
  );
  commands[commandName] = command;
}

abstract class Command {
  static commandName: string = null;

  priority: Array<number>;

  constructor() {
    this.priority = [];
  }
  abstract async execute(machine);
  abstract render(): string;

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

  serialize() {
    const { commandName } = <typeof Command>this.constructor;
    return {
      command: commandName,
      args: this.serializeArgs()
    };
  }
  abstract serializeArgs(): any;

  static renderMany(commands) {
    return commands.map(cmd => cmd.render()).join(" ");
  }
}
abstract class SimpleCommand extends Command {
  render() {
    const { commandName } = <typeof Command>this.constructor;
    return `[${commandName}]`;
  }
  serializeArgs() {
    return {};
  }
}
abstract class BasicCommand<T> extends Command {
  value: T;
  args: any;

  constructor(command: T, args: any = {}) {
    super();
    this.value = command;
    this.args = args || {};
    invariant(!this.args.hasOwnProperty("value"), "Value argument is reserved");
  }
  render() {
    const { commandName } = <typeof Command>this.constructor;
    return `[${commandName} ${JSON.stringify(this.value)}${optionalJson(
      this.args
    )}]`;
  }

  serializeArgs() {
    return Object.assign(
      {
        value: this.value
      },
      this.args
    );
  }
}
abstract class BooleanCommand extends BasicCommand<boolean> {}
abstract class NumberCommand extends BasicCommand<number> {}
abstract class StringCommand extends BasicCommand<string> {}

abstract class CommandExtender extends Command {
  command: Command;
  constructor(command) {
    super();
    this.command = command;
  }
  renderPartial(): string {
    return "";
  }
  render() {
    const { commandName } = <typeof Command>this.constructor;
    const partial = this.renderPartial();
    const partialStr = partial + (partial ? " " : "");
    return `[${commandName} ${partialStr}${this.command.render()}]`;
  }
  parseExecute(state) {
    this.command.parseExecute(state);
  }
  serializeArgs(): any {
    return {
      command: this.command.serialize()
    };
  }
}

@installCommand
export class NoopCommand extends SimpleCommand {
  static commandName = "noop";
  async execute() {}
}

@installCommand
export class ExecCommand extends StringCommand {
  static commandName = "exec";
  async execute(machine) {
    machine.exec(this.value);
  }
}

@installCommand
export class I3Command extends StringCommand {
  static commandName = "i3";
  async execute(machine) {
    machine.i3(this.value);
  }
}

@installCommand
export class PreviousCommand extends SimpleCommand {
  static commandName = "command.previous";
  previousCommand: Command | null;

  constructor() {
    super();
    // Save the previous command in case this is run again in a future command (prevent loop)
    this.previousCommand = null;
  }
  async execute(machine) {
    this.previousCommand = this.previousCommand || machine.previousCommand;
    return this.previousCommand.execute(machine);
  }
}

@installCommand
export class RecordMacroCommand extends SimpleCommand {
  static commandName = "macro.record";
  async execute(machine) {
    machine.recordMacro();
  }
}

@installCommand
export class SaveMacroCommand extends StringCommand {
  static commandName = "macro.save";
  async execute(machine) {
    machine.saveMacro(this.value);
  }
}

@installCommand
export class PlayMacroCommand extends StringCommand {
  static commandName = "macro.play";
  async execute(machine) {
    return machine.playMacro(this.value);
  }
}

@installCommand
export class WaitCommand extends NumberCommand {
  static commandName = "wait";
  async execute() {
    return bluebird.delay(this.value);
  }
}

@installCommand
export class VscodeCommand extends StringCommand {
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
    return machine.vscode(this.value, this.args);
  }
}

@installCommand
export class CancelCommand extends SimpleCommand {
  static commandName = "cancel";
  async execute(machine) {
    return machine.cancel();
  }
}

@installCommand
export class PriorityCommand extends Command {
  static commandName = "priority";
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
  serialize() {
    return this.command.serialize();
  }
  serializeArgs() {
    throw new Error("Not implemented");
  }
}

@installCommand
export class RepeatCommand extends CommandExtender {
  static commandName = "repeat";
  count: number;

  constructor(count, command) {
    super(command);
    this.count = count;
  }
  renderPartial() {
    return `${this.count}`;
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
  serializeArgs() {
    return Object.assign(
      {
        count: this.count
      },
      super.serializeArgs()
    );
  }
}

@installCommand
export class BackgroundCommand extends CommandExtender {
  static commandName = "background";

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
}

@installCommand
export class KeyHoldCommand extends Command {
  static commandName = "key.hold";
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
  serializeArgs(): any {
    return {
      key: this.key,
      state: this.state
    };
  }
}

@installCommand
export class KeyCommand extends StringCommand {
  static commandName = "key";

  parseExecute(state) {
    if (this.value === "escape") {
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
    const [key, modifiers] = KeyCommand.splitModifiers(this.value);

    if (key === "escape") {
      machine.toggleMode("vim-insert", false);
      machine.toggleMode("vim-visual", false);
    }

    machine.keyTap(key, modifiers);
  }

  render() {
    return KeyCommand.renderMany([this]);
  }

  static renderMany(commands: Array<KeyCommand>) {
    const keys = commands.map(cmd => KeyCommand.tryToAscii(cmd.value));

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

@installCommand
export class ModeCommand extends Command {
  static commandName = "mode";
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
  serializeArgs(): any {
    return {
      enable: this.enable,
      disable: this.disable
    };
  }
}

@installCommand
export class ClickCommand extends SimpleCommand {
  static commandName = "click";
  async execute(machine) {
    machine.click();
  }
}

@installCommand
export class RelativePathCommand extends StringCommand {
  static commandName = "type.relativePath";

  async execute(machine) {
    const current = await machine.fetchCurrentPath();
    let type = this.value;
    if (current) {
      type = path.relative(current, type);
    }

    for (const letter of type) {
      const [key, modifiers] = KeyCommand.splitModifiers(letter);
      machine.keyTap(key, modifiers);
    }
  }
}

@installCommand
export class SleepCommand extends BooleanCommand {
  static commandName = "sleep";
  async execute(machine) {
    machine.setSleep(this.value);
  }
}

@installCommand
export class RecordCommand extends BooleanCommand {
  static commandName = "record";
  async execute(machine) {
    machine.setRecord(this.value);
  }
}

@installCommand
export class MultiCommand extends Command {
  static commandName = "multi";
  commands: Array<Command>;

  constructor(commands: Array<Command>) {
    super();
    [this.commands, this.priority] = MultiCommand.flatten(commands);
  }

  render() {
    return MultiCommand.renderMany(this.commands);
  }

  splitByClass() {
    return MultiCommand.splitByClass(this.commands);
  }

  static splitByClass(
    commands: Array<Command>
  ): [Array<Command>, Array<Command>] {
    const rest = [...commands];
    let first = [];
    while (rest.length) {
      if (rest[0] instanceof MultiCommand) {
        const cmd = <MultiCommand>rest.shift();
        rest.unshift(...cmd.commands);
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

  static renderMany(commands: Array<Command>): string {
    const [first, rest] = MultiCommand.splitByClass(commands);

    if (!first.length) {
      return "[noop]";
    }

    const cls = <typeof Command>first[0].constructor;
    let rendered = cls.renderMany(first);
    if (rest.length) {
      rendered += " " + MultiCommand.renderMany(rest);
    }
    return rendered;
  }

  static flattenCommand(command): Array<Command> {
    if (command instanceof MultiCommand) {
      const [commands, priorities] = MultiCommand.flatten(command.commands);
      return commands;
    } else if (command instanceof PriorityCommand) {
      return MultiCommand.flattenCommand(command.command);
    } else if (command instanceof NoopCommand) {
      return [];
    } else {
      return [command];
    }
  }
  static flatten(commands): [Array<Command>, Array<number>] {
    const rv = [];
    const priority = [];
    commands.forEach(el => {
      priority.push(...(el.priority || []));
      rv.push(...MultiCommand.flattenCommand(el));
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
  serializeArgs(): any {
    return {
      commands: this.commands.map(cmd => cmd.serialize())
    };
  }
}
