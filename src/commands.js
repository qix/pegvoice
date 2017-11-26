'use strict';

const bluebird = require('bluebird');
const invariant = require('invariant');
const path = require('path');

function lowerKey(key) {
  const map = '+=!1@2#3$4%5^6&7*8(9)0_-?/|\\{[}]><~`:;"\'';
  const index = map.indexOf(key);
  if (index >= 0 && index % 2 === 0) {
    return map.charAt(index + 1);
  } else {
    return key.toLowerCase();
  }
}

function optionalJson(body) {
  const json = JSON.stringify(body);
  return (json === '{}' || json === '[]') ? '' : ` ${json}`;
}

class Command {
  constructor() {
    this.priority = [];
  }
  execute() { throw new Error('not implemented'); }
  render() {
    throw new Error('not implemented');
  }
  parseExecute(state) { }
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
    return commands.map(cmd => cmd.render()).join(' ');
  }
}
class NoopCommand extends Command {
  render() { return '[noop]'; }
  execute() { }
}

class ExecCommand extends Command {
  constructor(command, options = {}) {
    super();
    this.command = command;
    this.options = options;
  }
  render() {
    return `[exec ${JSON.stringify(this.command)}${optionalJson(this.options)}]`;
  }
  execute(machine) {
    machine.exec(this.command);
  }
}

class I3Command extends Command {
  constructor(command) {
    super();
    this.command = command;
  }
  render() {
    return `[i3 ${JSON.stringify(this.command)}]`;
  }
  execute(machine) {
    machine.i3(this.command);
  }
}

class PreviousCommand extends Command {
  constructor() {
    super();
    // Save the previous command in case this is run again in a future command (prevent loop)
    this.previousCommand = null;
  }
  render() {
    return `[previous command]`;
  }
  execute(machine) {
    this.previousCommand = this.previousCommand || machine.previousCommand;
    return this.previousCommand.execute(machine);
  }
}
class RecordMacroCommand extends Command {
  render() {
    return '[record macro]';
  }
  execute(machine) {
    this.previousCommand = this.previousCommand || machine.previousCommand;
    return this.previousCommand.execute(machine);
  }
}
class SaveMacroCommand extends Command {
  constructor(word) {
    super();
    this.word = word;
  }
  render() {
    return `[save macro ${this.word}]`;
  }
  execute(machine) {
    machine.saveMacro(this.word);
  }
}
class PlayMacroCommand extends Command {
  constructor(word) {
    super();
    this.word = word;
  }
  render() {
    return `[play macro ${word}]`;
  }
  execute(machine) {
    machine.playMacro(this.word);
  }
}

class WaitCommand extends Command {
  constructor(delay) {
    super();
    this.delay = delay;
  }
  render() {
    return `[wait ${this.delay}]`;
  }
  execute() {
    return bluebird.delay(this.delay);
  }
}
class VscodeCommand extends Command {
  constructor(command, args) {
    super();
    this.command = command;
    this.args = args || {};
  }

  static fromKeyCommands(commands) {
    let rv = [];
    let typing = null;
    const keyMap = {
      enter: '\n',
      tab: '\t',
    };
    const commandMap = {
      left: 'cursorLeft',
      right: 'cursorRight',
      up: 'cursorUp',
      down: 'cursorDown',
      backspace: 'deleteLeft',
      delete: 'deleteRight',
    };
    commands.forEach(command => {
      let key = keyMap[command.key] || command.key;
      if (/^[ -~]$/.exec(key) || key === '\n') {
        if (!typing) {
          typing = new VscodeCommand('default:type', {
            text: '',
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
        VscodeCommand.fromTypeCommands(rest),
      ]);
    }
    return MultiCommand.fromArray([
      ...first,
      rest.length ? VscodeCommand.fromTypeCommands(rest) : new NoopCommand(),
    ]);
  }

  static fromTypeCommand(command) {
    return VscodeCommand.fromTypeCommands([command]);
  }

  render() {
    return `[vscode ${JSON.stringify(this.command)}${optionalJson(this.args)}]`;
  }
  execute(machine) {
    return machine.vscode(this.command, this.args);
  }
}

class CancelCommand extends Command {
  render() {
    return '[cancel]';
  }
  execute(machine) {
    return machine.cancel();
  }
}
class PriorityCommand extends Command {
  constructor(priority, command) {
    super();
    this.priority = [priority];
    this.command = command;
  }
  render() {
    return this.command.render();
  }
  execute(machine) {
    return this.command.execute(machine);
  }
  parseExecute(state) {
    this.command.parseExecute(state);
  }
}
class RepeatCommand extends Command {
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
class KeyHoldCommand extends Command {
  constructor(key, state) {
    super();
    this.key = key;
    this.state = state;
  }
  execute(machine) {
    if (this.state) {
      machine.keyDown(this.key);
    } else {
      machine.keyUp(this.key);
    }
  }
  render() {
    const action = this.state ? 'hold' : 'release';
    return `[key ${action} ${this.key}]`;
  }
}

class KeyCommand extends Command {
  constructor(key) {
    super();
    this.key = key;
  }
  parseExecute(state) {
    if (this.key === 'escape') {
      state.mode.delete('vim-insert');
      state.mode.delete('vim-visual');
    }
  }

  static tryToAscii(name) {
    return {
      semicolon: ';',
      underscore: '_',
      space: ' ',
    }[name] || name;
  }

  static splitModifiers(combined) {
    let split = combined.split('-');
    let key = split.pop();

    if (key.length === 0) {
      key = '-';
      split.pop();
    }

    key = KeyCommand.tryToAscii(key);

    const modifiers = split.map(modifier => ({
      ctrl: 'control',
    }[modifier] || modifier));

    const lower = lowerKey(key);
    if (lower !== key) {
      key = lower;
      modifiers.push('shift');
    }

    return [key, modifiers];
  }

  execute(machine) {
    const [key, modifiers] = KeyCommand.splitModifiers(this.key);

    if (key === 'escape') {
      machine.toggleMode('vim-insert', false);
      machine.toggleMode('vim-visual', false);
    }

    machine.keyTap(key, modifiers);
  }

  render() {
    return KeyCommand.renderMany([this]);
  }

  static renderMany(commands) {
    const keys = commands.map(cmd => KeyCommand.tryToAscii(cmd.key));

    const escaped = [
      '"', "'",
    ];

    let string = '';
    let rv = '';
    const closeString = () => {
      if (string) {
        rv += (rv ? ' ' : '') + `"${string}"`;
        string = '';
      }
    };
    const addLarge = (key) => {
      closeString();
      rv += (rv ? ' ' : '') + `<${key}>`;
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

class ModeCommand extends Command {
  constructor(enable, disable) {
    super();
    this.enable = enable;
    this.disable = disable;
  }
  execute(machine) {
    machine.trackModeChange(() => {
      (this.enable || []).forEach(mode => machine.mode.add(mode));
      (this.disable || []).forEach(mode => machine.mode.delete(mode));
    });
  }
  render() {
    const changes = [
      ...this.enable.map(mode => `+${mode}`),
      ...this.disable.map(mode => `-${mode}`),
    ];
    return `[mode ${changes.join(' ')}]`;

  }
  parseExecute(state) {
    state.mode = new Set([...state.mode]);
    (this.enable || []).forEach(mode => state.mode.add(mode));
    (this.disable || []).forEach(mode => state.mode.delete(mode));
  }
}

class ClickCommand extends Command {
  execute(machine) {
    machine.click();
  }
  render() {
    return '[click]';
  }
}

class RelativePathCommand extends Command {
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

class SleepCommand extends Command {
  constructor(flag) {
    super();
    this.flag = flag;
  }

  execute(machine) {
    machine.setSleep(this.flag);
  }
  render() {
    return `[${this.flag ? 'sleep' : 'wake up'}]`;
  }
}
class RecordCommand extends Command {
  constructor(flag) {
    super();
    this.flag = flag;
  }

  execute(machine) {
    machine.setRecord(this.flag);
  }
  render() {
    return `[record ${this.flag}]`;
  }
}

class MultiCommand extends Command {
  constructor(commands) {
    super();
    ([this.commands, this.priority] = MultiCommand.flatten(commands));
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
      return '[noop]';
    }

    let rendered = (first[0].constructor.renderMany || Command.renderMany)(first);
    if (rest.length) {
      rendered += ' ' + MultiCommand.renderMany(rest);
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

module.exports = {
  ClickCommand,
  ExecCommand,
  I3Command,
  KeyCommand,
  ModeCommand,
  MultiCommand,
  NoopCommand,
  PriorityCommand,
  RecordCommand,
  RepeatCommand,
  SleepCommand,
  KeyHoldCommand,
  CancelCommand,
  VscodeCommand,
  RelativePathCommand,
  WaitCommand,
  PreviousCommand,
};
