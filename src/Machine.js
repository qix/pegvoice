'use strict';

const bluebird = require('bluebird');
const chalk = require('chalk');
const child_process = require('child_process');
const extensions = require('./extensions');
const fs = require('fs');
const i3 = require('i3').createClient();
const invariant = require('invariant');
const {exec} = require('child_process')
const {promisify} = require('util');
const os = require('os');
const path = require('path');
const request = require('request-promise');
const robot = require('robotjs');

const execAsync = promisify(exec);
const readdirAsync = promisify(fs.readdir);


async function vscodeRequest(uri, payload=null) {
  const socketPath = path.join(os.homedir(), '.pegvoice/vscode-socket');
  return await request({
    url: `http://unix:${socketPath}:${uri}`,
    json: payload || true,
    method: payload ? 'POST' : 'GET',
  });
}

async function getCurrentTitle() {
  const {stdout} = await execAsync('xdotool getwindowfocus getwindowname');
  return stdout.trim();
}

async function isScreensaverActive() {
  const {stdout} = await execAsync('gnome-screensaver-command -q');
  const response = stdout.trim();
  const knownResponses = {
    'The screensaver is inactive': false,
    'The screensaver is active': true,
  };
  invariant(
    knownResponses.hasOwnProperty(response),
    'Expected known response from gnome-screensaver'
  );
  return knownResponses[response];
}

class Machine {
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

  executeCommand(command) {
    return bluebird.resolve(command.execute(this)).finally(() => {
      this.previousCommand = command;
    });
  }

  exec(command) {
    child_process.spawn('/bin/bash', ['--login', '-c', command], {
      detached: true,
    });
  }
  vscode(command, args={}) {
    return vscodeRequest('/command', {
      command,
      args,
    });
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

  async fetchCurrentPath() {
    const title = await getCurrentTitle();
    const pathRegExp = /^[^ ]+@[^ ]+:([^ ]+) <term>$/;
    const match = pathRegExp.exec(title);
    if (match) {
      return match[1];
    } else {
      return null;
    }
  }

  async fetchCurrentMode() {
    if (this.titleWatch) {
      await this.handleTitle(await getCurrentTitle());
    }
    if (await isScreensaverActive()) {
      throw new Error('Screensaver is active');
    }
    return this.mode;
  }

  async handleTitle(title) {
    if (title !== this.lastTitle) {
      console.log(chalk.white.dim(`Title: ${title}`));
    }

    const match = / <vim:(.*)>$/.exec(title);
    const vim = !!match;
    const vimMode = match ? match[1] : null;

    const vimInsert = ['i', 's', 'R'].includes(vimMode);
    const vimVisual = ['v', 'V', '^V'].includes(vimMode);

    const vimTree = vim && title.startsWith('NERD_tree_');
    const vimNormal = title.endsWith(' <vim>') && !vimTree;


    let vscodeModes = [];
    /*
    let vscode = title.endsWith(' - Visual Studio Code');
    if (vscode) {
      const state = await vscodeRequest('/state');
      vscodeModes = state.modes;
    }
    */
    let vscode = title.endsWith('~~pegvoice-vscode');
    if (vscode) {
      const match = /.*~~context~~(.*)~~pegvoice-vscode$/.exec(title);
      vscodeModes = match[1].split('~').filter(mode => {
        return extensions.vscode.modes.includes(mode);
      });
    }


    this.trackModeChange(() => {
      this.mode.forEach(mode => {
        if (mode.startsWith('vscode-') || mode.startsWith('vim-')) {
          this.mode.delete(mode);
        }
      });

      vscodeModes.forEach(mode => this.mode.add(`vscode-${mode}`));
      this.toggleMode('vim', vim);
      this.toggleMode('vscode', vscode);
      this.toggleMode('terminal', title.endsWith(' <term>'));
      this.toggleMode('vim-insert', vimInsert);
      this.toggleMode('vim-tree', vimTree);
      this.toggleMode('vim-visual', vimVisual);
      this.toggleMode('vim-rebase', vim && title.startsWith('git-rebase-todo '));
      this.toggleMode('chrome', title.endsWith(' - Google Chrome'));
      this.toggleMode('slack', title.endsWith('Slack - Google Chrome'));
    });
    this.lastTitle = title;
  }

  trackModeChange(cb) {
    const prev = Array.from(this.mode).sort().join(', ');
    cb();
    const after = Array.from(this.mode).sort().join(', ');

    /* @TODO: Track recursive changes and output somewhere
    if (prev !== after) {
      console.log(chalk.white.dim(`Mode: ${after || '<none>'}`));
    }
    */
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

module.exports = Machine;