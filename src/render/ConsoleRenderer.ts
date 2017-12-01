"use strict";

import { ParseError } from "../parse/ParseError";
import chalk from "chalk";

export class ConsoleRenderer {
  error(err) {
    throw err;
  }

  commandError(err, { rendered }) {
    console.error(`Error during: ${rendered}`);
    console.error(err.stack);
  }

  parseStep(message) {
    console.log(message);
  }

  parseError(err) {
    if (err instanceof ParseError) {
      console.error(err.render());
    } else {
      console.error(err.stack);
    }
  }

  grammarChanged() {
    console.log("New grammer loaded");
  }

  render({ modeString, execCommand, skipCommands, noop, record }) {
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
        `${N} ${word}: ` +
          `${yellow(transcript)} => ${green(rendered)} ${grey(priority)}`
      );
    }
  }
}
