"use strict";

import { ParseError } from "../parse/ParseError";
import { Renderer } from "./Renderer";
import { MultiCommand } from "../commands";
import chalk from "chalk";

export class ConsoleRenderer extends Renderer {
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
      console.error(err);
    }
  }

  grammarError(err) {
    this.parseError(err);
  }

  grammarChanged() {
    console.log("New grammer loaded");
  }

  render({ modeString, execCommand, skipCommands, noop, record, running }) {
    const { grey, green, yellow } = chalk;
    console.log(chalk.white.dim(`[${modeString}]`));
    for (let { N, transcript, rendered, priority } of skipCommands) {
      console.log(
        grey(`${N} Skip: `) + transcript + grey(` => ${rendered} ${priority}`)
      );
    }

    if (execCommand) {
      const { N, rendered, transcript, priority } = execCommand;
      const word = noop ? "NoOp" : "Exec";
      console.log(
        `${running ? green("RUN") : grey("FIN")} ` +
          `${N} ${word}: ` +
          `${yellow(transcript)} => ${green(rendered)} ${grey(priority)}`
      );
    }
  }
}
