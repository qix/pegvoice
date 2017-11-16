'use strict';

const chalk = require('chalk');

class ConsoleRenderer {
  render({
    modeString,
    execCommand,
    skipCommands,
    noop,
    record,
  }) {
    const {grey, green, yellow} = chalk;
    console.log(chalk.white.dim(`[${modeString}]`));
    for (let {N, transcript, rendered, priority} of skipCommands) {
      console.log(
        grey(`${N} Skip: `) +
        transcript +
        grey(` => ${rendered} ${priority}`)
      );
    }

    if (execCommand) {
      const {N, rendered, transcript, priority} = execCommand;
      const word = noop ? 'NoOp' : 'Exec';
      console.log(
        `${N} ${word}: ` +
        `${yellow(transcript)} => ${green(rendered)} ${grey(priority)}`
      );
    }
  }
}

module.exports = ConsoleRenderer;
