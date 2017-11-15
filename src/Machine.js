'use strict';

const chalk = require('chalk');
const i3 = require('i3').createClient();
const {exec} = require('child_process')
const {promisify} = require('util');
const robot = require('robotjs');

const execAsync = promisify(exec);


async function getCurrentTitle() {
  const {stdout} = await execAsync('xdotool getwindowfocus getwindowname');
  return stdout.trim();
}

function setToggle(set, value, test) {
  if (test) {
    set.add(value);
  } else {
    set.delete(value);
  }
}

class Commander {
  constructor(log, options={}) {
    /*
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
    */

    this.mode = new Set();
    this.lastTitle = null;
    this.record = false;
    this.sleep = false;
    this.titleWatch = !options.disableTitleWatch;
    this.keysDown = new Set();
  }

  setRecord(flag) { this.record = flag; }
  setSleep(flag) { this.sleep = flag; }
  i3(command) { i3.command(command); }
  keyTap(key, modifiers) { robot.keyTap(key, modifiers); }
  keyUp(key) {
    robot.keyToggle(key, 'up');
    this.keysDown.delete(key);
  }
  keyDown(key) {
    robot.keyToggle(key, 'down');
    this.keysDown.add(key);
  }
  cancel() {
    for (let key of Array.from(this.keysDown)) {
      this.keyUp(key);
    }
  }
  click() { robot.mouseClick(); }

  async fetchCurrentMode() {
    if (this.titleWatch) {
      this.handleTitle(await getCurrentTitle());
    }
    return this.mode;
  }

  handleTitle(title) {
    if (title === this.lastTitle) {
      return;
    }

    console.log(chalk.white.dim(`Title: ${title}`));

    const match = / <vim:(.*)>$/.exec(title);
    const vim = !!match;
    const vimMode = match ? match[1] : null;

    const vimInsert = ['i', 's', 'R'].includes(vimMode);
    const vimVisual = ['v', 'V', '^V'].includes(vimMode);

    const vimTree = vim && title.startsWith('NERD_tree_');
    const vimNormal = title.endsWith(' <vim>') && !vimTree;

    this.trackModeChange(() => {
      setToggle(this.mode, 'vim', vim);
      setToggle(this.mode, 'terminal', title.endsWith(' <term>'));
      setToggle(this.mode, 'vim-insert', vimInsert);
      setToggle(this.mode, 'vim-tree', vimTree);
      setToggle(this.mode, 'vim-visual', vimVisual);
      setToggle(this.mode, 'vim-rebase', vim && title.startsWith('git-rebase-todo '));
      if (!vim) {
        this.mode.delete('vim-visual');
      }
      setToggle(this.mode, 'chrome', title.endsWith(' - Google Chrome'));
      setToggle(this.mode, 'slack', title.endsWith('Slack - Google Chrome'));
    });
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
