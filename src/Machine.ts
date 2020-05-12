"use strict";

import chalk from "chalk";
import * as fs from "fs";
import * as i3Library from "i3";
import * as invariant from "invariant";
import { exec } from "child_process";
import { promisify } from "util";
import * as robot from "robotjs";
import {
  Command,
  definedCommands as baseDefinedCommands,
} from "./commands/base";
import { SerializedCommand } from "./commands/serialized";
import { findExtension } from "./extensions";
import { EventEmitter } from "events";
import { ExecutionContext } from "./commands/ExecutionContext";
import { Renderer } from "./render/Renderer";

const i3 = i3Library.createClient();
const execAsync = promisify(exec);
const readdirAsync = promisify(fs.readdir);

async function getCurrentTitle() {
  const { stdout } = await execAsync("xdotool getwindowfocus getwindowname");
  return stdout.trim();
}

async function isScreensaverActive() {
  const { stdout } = await execAsync("gnome-screensaver-command -q");
  const knownResponses = {
    "The screensaver is inactive": false,
    "The screensaver is active": true,
  };

  for (const [response, rv] of Object.entries(knownResponses)) {
    if (stdout.includes(response)) {
      return rv;
    }
  }
  throw new Error("Expected known response from gnome-screensaver");
}

type TitleHandler = (title: string) => Promise<void>;

export class Machine extends EventEmitter {
  mode: Set<string>;
  lastTitle: string | null;
  record: boolean;
  sleep: boolean;
  titleWatch: boolean;
  keysDown: Set<string>;
  previousCommand: Command | null;
  currentMacro: Array<Command> | null;
  recordedMacros: { [name: string]: Array<Command> };

  extensions: { [name: string]: any };
  commands: { [name: string]: typeof Command };
  titleHandlers: Array<TitleHandler> = [];

  constructor(
    readonly renderer: Renderer,
    options: {
      disableTitleWatch?: boolean;
      startAwake?: boolean;
    } = {}
  ) {
    super();

    this.commands = {};
    this.extensions = {};

    this.mode = new Set();
    this.lastTitle = null;
    this.record = false;
    this.sleep = !options.startAwake;
    this.titleWatch = !options.disableTitleWatch;
    this.keysDown = new Set();

    this.currentMacro = null;

    baseDefinedCommands.forEach((cmd) => this.installCommand(cmd));
  }

  addTitleHandler(cb: TitleHandler) {
    this.titleHandlers.push(cb);
  }
  loadExtension(name: string): any {
    if (!this.extensions.hasOwnProperty(name)) {
      this.extensions[name] = findExtension(name).activate(this);
    }
    return this.extensions[name];
  }
  installCommand(commandAny: any) {
    const command: typeof Command = commandAny;

    const { commandName } = command;
    invariant(
      !this.commands.hasOwnProperty(commandName),
      `Command ${commandName} has already been installed.`
    );
    this.commands[commandName] = command;
  }

  serializeCommand(command: Command): SerializedCommand {
    const constr = <typeof Command>command.constructor;
    return {
      command: constr.commandName,
      args: command.serialize(),
    };
  }

  deserializeCommand(serialized: SerializedCommand): Command {
    invariant(
      this.commands.hasOwnProperty(serialized.command),
      "Command not found: %s",
      serialized.command
    );
    const classConstructor = this.commands[serialized.command];
    const obj: Command = Object.create(classConstructor.prototype);
    obj.deserializor(this, serialized.args);
    return obj;
  }

  executeCommand(ctx: ExecutionContext, command: Command) {
    return command.execute(ctx).finally(() => {
      this.previousCommand = command;
      this.emit("commandFinished", command);
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
    robot.setKeyboardDelay(0);
    robot.keyTap(key, modifiers);
  }
  keyUp(key) {
    robot.setKeyboardDelay(0);
    robot.keyToggle(key, "up");
    this.keysDown.delete(key);
  }
  keyDown(key) {
    robot.setKeyboardDelay(0);
    robot.keyToggle(key, "down");
    this.keysDown.add(key);
  }

  reset() {
    for (let key of Array.from(this.keysDown)) {
      this.keyUp(key);
    }
    this.mode.forEach((mode) => {
      this.mode.delete(mode);
    });
    this.renderer.reset();
  }
  click() {
    robot.setMouseDelay(0);
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

  async fetchCurrentMode(ctx: ExecutionContext) {
    if (this.titleWatch) {
      await this.handleTitle(await getCurrentTitle());
    }

    try {
      this.toggleMode("screensaver", await isScreensaverActive());
    } catch (err) {
      ctx.error(err);
    }

    return this.mode;
  }

  async handleTitle(title) {
    if (title !== this.lastTitle) {
      this.renderer.message(`Title: ${title}`);
    }

    const match = / <vim:(.*)>$/.exec(title);
    const vim = !!match;
    const vimMode = match ? match[1] : null;

    const vimInsert = ["i", "s", "R"].includes(vimMode);
    const vimVisual = ["v", "V", "^V"].includes(vimMode);

    const vimTree = vim && title.startsWith("NERD_tree_");
    const vimNormal = title.endsWith(" <vim>") && !vimTree;

    for (let handler of this.titleHandlers) {
      await handler(title);
    }

    this.toggleMode("vim", vim);
    this.toggleMode("terminal", title.endsWith(" <term>"));
    this.toggleMode("vim-insert", vimInsert);
    this.toggleMode("vim-tree", vimTree);
    this.toggleMode("vim-visual", vimVisual);
    this.toggleMode("vim-rebase", vim && title.startsWith("git-rebase-todo "));
    this.toggleMode("chrome", title.endsWith(" - Google Chrome"));
    this.toggleMode(
      "slack",
      title.endsWith("Slack - Google Chrome") || title.startsWith("Slack | ")
    );
    this.lastTitle = title;
  }

  trackModeChange(cb: () => void) {
    const prev = Array.from(this.mode).sort().join(", ");
    cb();
    const after = Array.from(this.mode).sort().join(", ");

    /* @TODO: Track recursive changes and output somewhere
    if (prev !== after) {
      console.log(chalk.white.dim(`Mode: ${after || '<none>'}`));
    }
    */
  }

  toggleMode(mode, setting) {
    if (setting) {
      this.mode.add(mode);
    } else {
      this.mode.delete(mode);
    }
  }
}
