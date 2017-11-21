'use strict';

const invariant = require('invariant');

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
  execute() { throw new Error('not implemented'); }
  render() { throw new Error('not implemented'); }
  parseExecute(state) {}
  static renderMany(commands) {
    return commands.map(cmd => cmd.render()).join(' ');
  }
}
class NoopCommand extends Command {
  render() { return '[noop]'; }
  execute() {}
}

class ExecCommand extends Command {
  constructor(command, options={}) {
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
class VscodeCommand extends Command {
  constructor(command, args) {
    super();
    this.command = command;
    this.args = args;
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
    machine.vscode(this.command, this.args);
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
    this.priority = priority;
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
  execute(machine) {
    for (let i = 0; i < this.count; i++) {
      this.command.execute(machine);
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
  execute(machine) {
    let split = this.key.split('-');

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
    this.commands = commands;
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
    commands.forEach(el => {
      if (el instanceof MultiCommand) {
        rv.push(...el.commands);
      } else if (!(el instanceof NoopCommand)) {
        rv.push(el);
      }
    });
    return rv;
  }

  static fromArray(arr) {
    arr = MultiCommand.flatten(arr);
    if (arr.length === 0) {
      return new NoopCommand();
    } else if (arr.length === 1) {
      return arr[0];
    } else {
      return new MultiCommand(arr);
    }
  }

  execute(machine) {
    this.commands.forEach(command => command.execute(machine));
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
};
