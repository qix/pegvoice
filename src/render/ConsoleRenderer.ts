"use strict";

import { ParseError } from "../parse/ParseError";
import { Renderer, RenderOpt } from "./Renderer";
import { MultiCommand } from "../commands";
import chalk from "chalk";

export class ConsoleRenderer extends Renderer {
  constructor() {
    super();
  }

  error(err) {
    throw err;
  }

  commandError(err, props: { rendered?: string } = {}) {
    if (props.rendered) {
      console.error(`Error during: ${props.rendered}`);
    }
    console.error(err.stack);
  }

  parseStep(message) {
    console.log(message);
  }

  parseError(err) {
    if (err instanceof ParseError) {
      console.error(err.render());
    } else {
      if (err.stack) {
        console.error(err.stack);
      } else {
        console.error(err.toString())
      }
    }
  }

  grammarError(err) {
    this.parseError(err);
  }

  grammarChanged() {
    console.log("New grammer loaded");
  }

  message(...args) {
    console.log(...args);
  }

  render(options: RenderOpt) {
    const { modeString, execCommand, skipCommands, noopReason, running } = options;
    const { grey, green, yellow } = chalk;
    console.log(chalk.white.dim(`[${modeString}]`));
    for (let { N, transcript, rendered, priority } of skipCommands) {
      console.log(
        grey(`${N} Skip: `) + transcript + grey(` => ${rendered} ${priority}`)
      );
    }

    if (execCommand) {
      const { N, rendered, transcript, priority } = execCommand;
      const word = noopReason ? `NoOp[${noopReason}]` : "Exec";

      let line = `${running ? green("RUN") : grey("FIN")} ${N} ${word}: `;
      line += `${yellow(transcript)} => ${green(rendered)} ${grey(priority.toString())}`;
      if (options.runTimeMs) {
        line += ' ' + grey(`${options.runTimeMs.toFixed(3)}ms`)
      }

      console.log(line);
    }
  }
}
