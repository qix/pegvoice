'use strict';

const chalk = require('chalk');
const i3 = require('i3').createClient();
const {exec} = require('child_process')
const {promisify} = require('util');

const execAsync = promisify(exec);

const robot = require('robotjs');

function lowerKey(key) {
  const map = '+=!1@2#3$4%5^6&7*8(9)0_-?/|\\{[}]><~`';
  const index = map.indexOf(key);
  if (index >= 0 && index % 2 === 0) {
    return map.charAt(index + 1);
  } else {
    return key.toLowerCase();
  }
}

async function getCurrentTitle() {
  const {stdout} = await execAsync('xdotool getwindowfocus getwindowname');
  return stdout.trim();
}

class Commander {
  constructor(log) {
    [
      'workspace',
      'output',
      'mode',
      'window',
      'barconfig_update',
      'binding',
    ].forEach(event => {
      i3.on(event, details => {
        log.debug({
          details: details,
        }, 'i3 %s', event);
      });
    });

    i3.on('window', (({change, container}) => {
      if (change === 'focus') {
        const {title} = container.window_properties;
        this.handleTitle(title);
      }
    }));

    this.mode = new Set();
    this.lastTitle = null;

    this.handlers = {
      i3(props) {
        const {command} = props;
        i3.command(command);
      },
      mode: (props) => {
        this.trackModeChange(() => {
          (props.enable || []).forEach(mode => this.mode.add(mode));
          (props.disable || []).forEach(mode => this.mode.delete(mode));
        });
      },
      multi: (props) => {
        for (let command of props.commands) {
          this.execute(command);
        }
      },
      repeat: (props) => {
        for (let i = 0; i < props.count; i++) {
          this.execute(props.command);
        }
      },
      key: (props) => {
        let split = props.key.split('-');

        let key = split.pop();
        if (key.length === 0) {
          key = '-';
          split.pop();
        }

        key = {
          semicolon: ';',
          underscore: '_',
        }[key] || key;

        const modifiers = split.map(modifier => ({
          ctrl: 'control',
        }[modifier] || modifier));

        const lower = lowerKey(key);
        if (lower !== key) {
          key = lower;
          modifiers.push('shift');
        }

        if (key === 'escape') {
          this.toggleMode('vim-insert', false);
        }

        robot.keyTap(key, modifiers);
      },
      type(props) {
        robot.typeString(props.string);
      },
      noop() {}
    };
  }

  async fetchCurrentMode() {
    this.handleTitle(await getCurrentTitle());
    return this.mode;
  }

  handleTitle(title) {
    if (title === this.lastTitle) {
      return;
    }

    console.log(chalk.white.dim(`Title: ${title}`));
    const vimInsert = title.endsWith(' <vim:i>');
    const vimNormal = title.endsWith(' <vim>');
    const vim = vimInsert || vimNormal;
    this.toggleMode('vim', vim);
    this.toggleMode('vim-insert', vimInsert);
    this.toggleMode('chrome', title.endsWith(' - Google Chrome'));
    this.lastTitle = title;
  }

  trackModeChange(cb) {
    const prev = Array.from(this.mode).sort().join(', ');
    cb();
    const after = Array.from(this.mode).sort().join(', ');

    if (prev !== after) {
      console.log(chalk.white.dim(`Mode: ${after || '<none>'}`));
    }
  }

  toggleMode(mode, setting) {
    this.trackModeChange(() => {
      if (setting) {
        this.mode.add(mode);
      } else {
        this.mode.delete(mode);
      }
    });
  }

  execute(command) {
    const {handler} = command;
    this.handlers[handler](command);
  }
}

module.exports = Commander;
