"use strict";

import { terminal as term } from "terminal-kit";

export class SingleLineRenderer {
  errorMessage: string | null;
  errorFixed: boolean;

  constructor() {
    this.errorMessage = null;
    this.errorFixed = false;
  }

  clear() {
    term.clear().hideCursor();
    let remaining = term.width;
    if (this.errorMessage) {
      const render = this.errorMessage.substring(0, remaining);
      term.red.bold(render);
      remaining -= render.length;
    }
    return remaining;
  }

  error(err) {
    if (!this.errorFixed) {
      this.errorMessage = `Error: ${err.message}`;
      this.errorFixed = true;
    }
    this.clear();
  }

  commandError(err) {
    if (!this.errorFixed) {
      this.errorMessage = `Command: ${err.message}`;
    }
    this.clear();
  }

  parseError(err) {
    if (!this.errorFixed) {
      this.errorMessage = `Parse: ${err.message}`;
    }
    this.clear();
  }

  parseStep(message) {
    term.clear().hideCursor();
    term.yellow.bold(message);
  }

  grammarChanged() {
    if (!this.errorFixed) {
      this.errorMessage = null;
    }

    term.clear().hideCursor();
    term.green.bold("Waiting for commands...");
  }

  render({ modeString, execCommand, skipCommands, noop, record }) {
    const arrow = " => ";
    const word = noop ? "NoOp" : "Exec";

    let remaining = this.clear();

    /*
    for (let {N, rendered, transcript, priority} of skipCommands) {
      term
        .gray(`${N} ${word}: `)
        .white(transcript)
        .gray(` => ${rendered}${priority}\n`)
    }
    */

    const recordSymbol = record ? " ■ " : " 🚫 ";
    const modeStringPrefix = `[${modeString}] `;

    if (record) {
      term.red.bold(recordSymbol);
    } else {
      term.white.bold(recordSymbol);
    }

    term.gray(modeStringPrefix);

    remaining -= modeStringPrefix.length + recordSymbol.length * 2;

    if (execCommand) {
      let { N, rendered, transcript, priority } = execCommand;
      const prefix = `${N} ${word}: `;
      const postfix = ` ${priority}`;

      remaining -= prefix.length + postfix.length + arrow.length;

      if (transcript.length > remaining / 2) {
        transcript =
          transcript.substring(0, Math.floor(remaining / 2 - 3)) + "...";
      }
      remaining -= transcript.length;

      if (rendered.length > remaining) {
        rendered = rendered.substring(0, remaining - 3) + "...";
      }
      remaining -= rendered.length;

      term
        .white(prefix)
        .yellow.bold(transcript)
        .white(arrow)
        .green.bold(rendered)
        .gray(postfix);
    }

    let first = !execCommand;
    for (let { N, transcript, rendered, priority } of skipCommands) {
      const prefix = `${first ? "" : " ┊ "}${N} `;
      const postfix = `${priority ? ` ${priority}` : ""}`;
      const message = `${prefix}${transcript}${arrow}${rendered}${postfix}`;
      if (message.length > remaining) {
        break;
      }
      term
        .gray(prefix)
        .white(transcript)
        .gray(arrow)
        .white(rendered + postfix);
      remaining -= message.length;
      first = false;
    }

    if (remaining) {
      term.white(" ".repeat(remaining));
    }

    if (record) {
      term.red.bold(recordSymbol);
    } else {
      term.white.bold(recordSymbol);
    }
  }
}
