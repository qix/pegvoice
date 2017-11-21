'use strict';

const bluebird = require('bluebird');
const chalk = require('chalk');
const child_process = require('child_process');
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


async function vscodeSockets() {
  const socketRoot = path.join(os.homedir(), '.pegvoice/vscode');
  const files = await readdirAsync(socketRoot);
  return files.map(filename => path.join(socketRoot, filename));
}

async function vscodeRequest(socketPath, uri, payload=null) {
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

function setToggle(set, value, test) {
  if (test) {
    set.add(value);
  } else {
    set.delete(value);
  }
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
    this.activeVscode = null;
  }

  exec(command) {
    child_process.spawn('/bin/bash', ['-c', command], {
      detached: true,
    });
  }
  vscode(command, args={}) {
    return vscodeRequest(this.activeVscode, '/command', {
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

    let vscode = title.endsWith(' - Visual Studio Code');

    let vscodeModes = [];
    if (vscode) {
      const sockets = await vscodeSockets();

      let focusedWindowSocket = null;
      await Promise.all(sockets.map(async socket => {
        const state = await vscodeRequest(socket, '/state');
        if (state.focused) {
          if (focusedWindowSocket) {
            throw new Error('Warning found multiple focused vscodes');
          }
          focusedWindowSocket = socket;
          vscodeModes = state.modes;
        }
      }));

      if (focusedWindowSocket) {
        this.activeVscode = focusedWindowSocket;
      } else {
        throw new Error('vscode active, but socket not found');
      }
    }

    this.trackModeChange(() => {
      this.mode.forEach(mode => {
        if (mode.startsWith('vscode-') || mode.startsWith('vim-')) {
          this.mode.delete(mode);
        }
      });

      setToggle(this.mode, 'vim', vim);
      setToggle(this.mode, 'vscode', vscode);
      setToggle(this.mode, 'terminal', title.endsWith(' <term>'));
      setToggle(this.mode, 'vim-insert', vimInsert);
      setToggle(this.mode, 'vim-tree', vimTree);
      setToggle(this.mode, 'vim-visual', vimVisual);
      setToggle(this.mode, 'vim-rebase', vim && title.startsWith('git-rebase-todo '));
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

module.exports = Machine;
