'use strict';

const term = require( 'terminal-kit' ).terminal;

class SingleLineRenderer {
  constructor() {
    this.parseErrorMessage = null;
  }

  parseError(err) {
    this.parseErrorMessage = `Parse error: ${err.message}`;
    term.clear().hideCursor();
    term.red.bold(this.parseErrorMessage.substring(0, term.width));
  }

  parseStep(message) {
    term.clear().hideCursor();
    term.yellow.bold(message);
  }

  grammarChanged() {
    this.parseErrorMessage = null;
    term.clear().hideCursor();
    term.green.bold('Waiting for commands...');
  }

  render({
    modeString,
    execCommand,
    skipCommands,
    noop,
    record,
  }) {
    const arrow = ' => ';
    const word = noop ? 'NoOp' : 'Exec';

    term.clear().hideCursor();

      /*
    for (let {N, rendered, transcript, priority} of skipCommands) {
      term
        .gray(`${N} ${word}: `)
        .white(transcript)
        .gray(` => ${rendered}${priority}\n`)
    }
    */

    const recordSymbol = record ? ' ■ ' : ' 🚫 ';
    const modeStringPrefix = `[${modeString}] `;

    if (record) {
      term.red.bold(recordSymbol);
    } else {
      term.white.bold(recordSymbol);
    }

    term.gray(modeStringPrefix)

    let remaining = term.width - modeStringPrefix.length - recordSymbol.length * 2;

    if (this.parseErrorMessage) {
      const errorMessage = this.parseErrorMessage.substring(0, remaining);
      term.red.bold(errorMessage);
      remaining -= errorMessage.length;
    }

    if (execCommand) {
      const {N, rendered, transcript, priority} = execCommand;
      const prefix = `${N} ${word}: `;
      const postfix = ` ${priority}`;
      term
        .white(prefix)
        .yellow.bold(transcript)
        .white(arrow)
        .green.bold(rendered)
        .gray(postfix);

      remaining -= [prefix, transcript, arrow, rendered, postfix].join('').length;
    }

    let first = !execCommand;
    for (let {N, transcript, rendered, priority} of skipCommands) {
      const prefix = `${first ? '' : ' ┊ '}${N} `;
      const postfix = `${priority ? ` ${priority}` : ''}`;
      const message = `${prefix}${transcript}${arrow}${rendered}${postfix}`;
      if (message.length > remaining) {
        break;
      }
      term.gray(prefix).white(transcript).gray(arrow).white(rendered + postfix);
      remaining -= message.length;
      first = false;
    }

    term.white(' '.repeat(remaining));
    if (record) {
      term.red.bold(recordSymbol);
    } else {
      term.white.bold(recordSymbol);
    }

  }
}

module.exports = SingleLineRenderer;