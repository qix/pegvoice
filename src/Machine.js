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

class Commander {
  constructor(log) {
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
  }

  i3(command) { i3.command(command); }
  keyTap(key, modifiers) { robot.keyTap(key, modifiers); }

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
    this.toggleMode('vim-tree', vim && title.startsWith('NERD_tree_'));
    this.toggleMode('chrome', title.endsWith(' - Google Chrome'));
    this.toggleMode('slack', title.endsWith('Slack - Google Chrome'));
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
