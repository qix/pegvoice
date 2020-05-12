import { Renderer, RenderOpt } from "./Renderer";
import { terminal as term } from "terminal-kit";

enum FixedMessagePriority {
  none = 0,
  message,
  warning,
  commandError,
  grammarError,
  error,
}
export class SingleLineRenderer extends Renderer {
  msg: string | null = null;
  msgPri: FixedMessagePriority = FixedMessagePriority.none;
  msgColor: "red" | "white" = "white";

  clear() {
    term.clear().hideCursor();
    let remaining: number = term.width;
    if (this.msg) {
      const render = this.msg.substring(0, remaining);
      term[this.msgColor].bold(render);
      remaining -= render.length;
    }
    return remaining;
  }

  message(message: string, ...args) {
    this.clear();
    term.white(message);
  }

  private setMessage(
    color: "red" | "white",
    message: string,
    priority: FixedMessagePriority
  ) {
    if (priority < this.msgPri) {
      return;
    }

    this.msg = message.split("\n")[0];
    this.msgColor = color;
    this.msgPri = priority;

    const maxLength = Math.max(40, term.width / 2);
    if (this.msg.length > maxLength) {
      this.msg = this.msg.substring(0, maxLength - 3) + "...";
    }
    this.clear();
  }

  error(err: Error) {
    this.setMessage("red", `Error: ${err.message}`, FixedMessagePriority.error);
  }

  commandError(err: Error) {
    this.setMessage(
      "red",
      `Command: ${err.message}`,
      FixedMessagePriority.commandError
    );
  }

  grammarError(err: Error) {
    this.setMessage(
      "red",
      `Grammar: ${err.message}`,
      FixedMessagePriority.grammarError
    );
  }
  parseError(err: Error) {
    // Ignore parse errors in single line mode
  }

  parseStep(message) {
    this.clear();
    term.yellow.bold(message);
  }

  reset() {
    this.msg = null;
  }

  grammarChanged() {
    if (this.msgPri === FixedMessagePriority.grammarError) {
      this.msg = null;
    }
    this.clear();
    term.green.bold("Waiting for commands...");
  }

  render(opt: RenderOpt) {
    const { modeString, execCommand, skipCommands, noopReason, record } = opt;
    const arrow = " => ";
    const word = noopReason ? "NoOp" : "Exec";

    let remaining = this.clear();

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
      const prefixLength =
        `${N} ${word}: `.length + (noopReason ? noopReason.length + 1 : 0);
      const postfix = ` ${priority}`;

      remaining -= prefixLength + postfix.length + arrow.length;

      if (transcript.length > remaining / 2) {
        transcript =
          transcript.substring(0, Math.floor(remaining / 2 - 3)) + "...";
      }
      remaining -= transcript.length;

      if (rendered.length > remaining) {
        rendered = rendered.substring(0, remaining - 3) + "...";
      }
      remaining -= rendered.length;

      term.white(`${N} `);

      if (noopReason) {
        term.bgRed(word);
        term.red(" " + noopReason);
      } else {
        term.white(word);
      }

      term
        .white(": ")
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

    if (remaining > 0) {
      term.white(" ".repeat(remaining));
    }

    if (record) {
      term.red.bold(recordSymbol);
    } else {
      term.white.bold(recordSymbol);
    }
  }
}
