#!/usr/bin/env node
'use strict';

const doc = `
Usage:
  check-results [--write] [--sorted] --result-log=<filename> [options]

Options:
  --debug-log=<filename>     Add a debug log
`;

const {docopt} = require('docopt');
const chalk = require('chalk');

const options = docopt(doc);
const Parser = require('./Parser');

const fs = require('fs');

const {
  rightArrow,
  modeSeperator,
  wordSeperator,
} = require('./symbols');

const parser = new Parser();
const resultFilename = options['--result-log'];

const results = fs.readFileSync(resultFilename).toString('utf-8');
const newResults = [];


for (const oldLine of results.split('\n')) {
  if (!oldLine) {
    continue;
  }

  const [modeTranscript, oldResult] = oldLine.split(rightArrow);
  const [modeString, transcript] = modeTranscript.split(modeSeperator);

  const modes = new Set(Array.from(modeString.split(' ')));

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

  const newLine = (
    `${modeString}${modeSeperator}${transcript}${rightArrow}${newResult}`
  );

  newResults.push(newLine);

  if (newLine !== oldLine) {
    const prefix = (
      (modeString ? `${chalk.grey(modeString + ':')} ` : '') +
      transcript +
      chalk.grey(rightArrow)
    );
    console.log(`${prefix}${chalk.red(oldResult)}`);
    console.log(`${prefix}${chalk.green(newResult)}`);
  }
}

if (options['--write']) {
  let output = newResults;
  if (options['--sorted']) {
    output = Array.from(new Set(output)).sort();
  }
  fs.writeFileSync(resultFilename, output.join('\n') + '\n');
}
