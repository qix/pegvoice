"use strict";

import { ParseError } from "../parse/ParseError";
import { MultiCommand } from "../commands";
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

  render({ modeString, execCommand, skipCommands, noop, record, running }) {
    const { grey, green, yellow } = chalk;
    console.log(chalk.white.dim(`[${modeString}]`));
    for (let { N, transcript, rendered, priority } of skipCommands) {
      console.log(
        grey(`${N} Skip: `) + transcript + grey(` => ${rendered} ${priority}`)
      );
    }

    if (!running && execCommand && execCommand.command) {
      const [commands] = MultiCommand.flatten([execCommand.command]);
      for (let command of commands) {
        console.log("%j", command.serialize());
      }
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
