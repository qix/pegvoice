#!/usr/bin/env node
'use strict';

const doc = `
Usage:
  check-results [--rewrite] [options]

Options:
  --watch                    Watch for future updates
  --grammar=<filename>       Grammer file [default: ~/.pegvoice/grammar.pgv]
  --samples=<filename>       Samples file [default: ~/.pegvoice/samples.log]
`;

const {docopt} = require('docopt');
const chalk = require('chalk');

const options = docopt(doc);
const Parser = require('./parse/Parser');
const SampleLog = require('./samples/SampleLog');

const fs = require('fs');

const {rightArrow} = require('./symbols');

const parser = new Parser(options['--grammar'], {
  watchPersistent: options['--watch'],
});
const sampleLog = new SampleLog(options['--samples']);

function checkDiff() {
  const newResults = [];

  for (const {
    modes,
    modeString,
    transcript,
    line: oldLine,
    result: oldResult,
  } of sampleLog.readAll()) {


    let newResult;
    try {
      const command = parser.parse(transcript, modes);
      newResult = command.render();
    } catch (err) {
      if (err instanceof Parser.ParseError) {
        newResult = 'null';
      } else {
        console.error('Failure during: %s', transcript);
        throw err;
      }
    }

    const newLine = {
      modeString,
      transcript,
      result: newResult,
    };
    newResults.push(newLine);

    if (sampleLog.buildLine(newLine) !== oldLine) {
      const prefix = (
        (modeString ? `${chalk.grey(modeString + ':')} ` : '') +
        transcript +
        chalk.grey(rightArrow)
      );
      console.log(`${prefix}${chalk.red(oldResult)}`);
      console.log(`${prefix}${chalk.green(newResult)}`);
    }
  }
  return newResults;
}

async function main() {
  const newResults = checkDiff();

  if (options['--rewrite']) {
    sampleLog.rewrite(newResults);
  } else {
    parser.on('update', () => {
      console.log('')
      console.log('=== GRAMMAR UPDATED ===')
      console.log('')
      checkDiff();
    });
    await new Promise(() => {
      /* run forever */
    });
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err.stack);
    process.exit(1);
  }
);
