"use strict";

import * as bluebird from "bluebird";
import chalk from "chalk";
import * as extensions from "./extensions";
import * as fs from "fs";
import * as i3Library from "i3";
import * as invariant from "invariant";
import { exec } from "child_process";
import { promisify } from "util";
import * as os from "os";
import * as path from "path";
import * as request from "request-promise";
import * as robot from "robotjs";

const i3 = i3Library.createClient();
const execAsync = promisify(exec);
const readdirAsync = promisify(fs.readdir);

async function vscodeRequest(uri, payload = null) {
  const socketPath = path.join(os.homedir(), ".pegvoice/vscode-socket");
  return await request({
    url: `http://unix:${socketPath}:${uri}`,
    json: payload || true,
    method: payload ? "POST" : "GET"
  });
}

async function getCurrentTitle() {
  const { stdout } = await execAsync("xdotool getwindowfocus getwindowname");
  return stdout.trim();
}

async function isScreensaverActive() {
  const { stdout } = await execAsync("gnome-screensaver-command -q");
  const response = stdout.trim();
  const knownResponses = {
    "The screensaver is inactive": false,
    "The screensaver is active": true
  };
  invariant(
    knownResponses.hasOwnProperty(response),
    "Expected known response from gnome-screensaver"
  );
  return knownResponses[response];
}

type Command = any;

export class Machine {
  mode: Set<string>;
  lastTitle: string | null;
  record: boolean;
  sleep: boolean;
  titleWatch: boolean;
  keysDown: Set<string>;
  previousCommand: Command | null;
  currentMacro: Array<Command> | null;
  recordedMacros: { [name: string]: Array<Command> };

  constructor(log, options: any = {}) {
    this.mode = new Set();
    this.lastTitle = null;
    this.record = false;
    this.sleep = false;
    this.titleWatch = !options.disableTitleWatch;
    this.keysDown = new Set();

    this.currentMacro = null;
    this.recordedMacros = {};
  }

  executeCommand(command) {
    const recording = this.currentMacro ? true : false;
    return bluebird.resolve(command.execute(this)).finally(() => {
      this.previousCommand = command;
      if (this.currentMacro && recording) {
        this.currentMacro.push(command);
      }
    });
  }

  recordMacro() {
    this.currentMacro = [];
  }
  saveMacro(name) {
    this.recordedMacros[name] = this.currentMacro;
    this.currentMacro = null;
    return this.recordedMacros[name];
  }
  async playMacro(name) {
    for (let command of this.recordedMacros[name]) {
      await command.execute(this);
    }
  }

  vscode(command, args = {}) {
    return vscodeRequest("/command", {
      command,
      args
    });
  }

  setRecord(flag) {
    this.record = flag;
  }
  setSleep(flag) {
    this.sleep = flag;
  }
  i3(command) {
    i3.command(command);
  }
  keyTap(key, modifiers) {
    robot.keyTap(key, modifiers);
  }
  keyUp(key) {
    robot.keyToggle(key, "up");
    this.keysDown.delete(key);
  }
  keyDown(key) {
    robot.keyToggle(key, "down");
    this.keysDown.add(key);
  }
  cancel() {
    for (let key of Array.from(this.keysDown)) {
      this.keyUp(key);
    }
    this.mode.forEach(mode => {
      this.mode.delete(mode);
    });
  }
  click() {
    robot.mouseClick();
  }

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
      throw new Error("Screensaver is active");
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

    const vimInsert = ["i", "s", "R"].includes(vimMode);
    const vimVisual = ["v", "V", "^V"].includes(vimMode);

    const vimTree = vim && title.startsWith("NERD_tree_");
    const vimNormal = title.endsWith(" <vim>") && !vimTree;

    let vscodeModes = [];
    /*
    let vscode = title.endsWith(' - Visual Studio Code');
    if (vscode) {
      const state = await vscodeRequest('/state');
      vscodeModes = state.modes;
    }
    */
    let vscode = title.endsWith("~~pegvoice-vscode");
    if (vscode) {
      const match = /.*~~context~~(.*)~~pegvoice-vscode$/.exec(title);
      vscodeModes = match[1].split("~").filter(mode => {
        return extensions.vscode.modes.includes(mode);
      });
    }

    this.trackModeChange(() => {
      this.mode.forEach(mode => {
        if (mode.startsWith("vscode-") || mode.startsWith("vim-")) {
          this.mode.delete(mode);
        }
      });

      vscodeModes.forEach(mode => this.mode.add(`vscode-${mode}`));
      this.toggleMode("vim", vim);
      this.toggleMode("vscode", vscode);
      this.toggleMode("terminal", title.endsWith(" <term>"));
      this.toggleMode("vim-insert", vimInsert);
      this.toggleMode("vim-tree", vimTree);
      this.toggleMode("vim-visual", vimVisual);
      this.toggleMode(
        "vim-rebase",
        vim && title.startsWith("git-rebase-todo ")
      );
      this.toggleMode("chrome", title.endsWith(" - Google Chrome"));
      this.toggleMode("slack", title.endsWith("Slack - Google Chrome"));
    });
    this.lastTitle = title;
  }

  trackModeChange(cb) {
    const prev = Array.from(this.mode)
      .sort()
      .join(", ");
    cb();
    const after = Array.from(this.mode)
      .sort()
      .join(", ");

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
}
