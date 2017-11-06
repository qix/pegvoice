#!/usr/bin/env node

'use strict';
/*eslint no-console: "allow"*/
const doc = `
Usage:
  pegvoice [--debug-log=<filename>]
`;

const binarySplit = require('binary-split');
const bunyan = require('bunyan');
const {docopt} = require('docopt');
const fs = require('fs');
const i3 = require('i3').createClient();
const peg = require("pegjs");
const robot = require('robotjs');

const source = fs.readFileSync('grammer.pegjs').toString('utf-8');
const parser = peg.generate(source);

['workspace',
  'output', 'mode', 'window', 'barconfig_update', 'binding'].forEach(event => {

    i3.on(event, details => {
      log.debug({
        details: details,
      }, 'i3 %s', event);
    });
  });

const options = docopt(doc);

const bunyanStreams = [];
if (options['--debug-log']) {
  bunyanStreams.push({
    level: 'debug',
    path: options['--debug-log'],
  });
}

const log = bunyan.createLogger({
  name: 'pegvoice',
  streams: bunyanStreams,
});

const handlers = {
  i3(props) {
    const {command} = props;
    i3.command(command);
  },
  key(props) {
    robot.keyTap(props.key);
  },
  type(props) {
    robot.typeString(props.string);
  },
  noop() {}
};

function parse(transcript) {
  try {
    return parser.parse(transcript);
  } catch (err) {
    console.error(`Parse error: ${err}`);
    return { handler: 'noop' };
  }
}
process.stdin.pipe(binarySplit()).on('data', line => {
  const update = JSON.parse(line);

  if (update.status !== 0) {
    console.log(update);
    process.exit(1);
  }

  if (update.adaptation_state) {
    log.debug('Skipping adaption state message');

  }

  if (update.result) {
    const {hypotheses, final} = update.result;

    console.log('Hypothesis:');
    hypotheses.forEach(hypothesis => {
      const {transcript} = hypothesis;
      const likelihood = Math.round(hypothesis.likelihood);
      const confidence = Math.round(100 * hypothesis.confidence);
      console.log(
        `*  ${JSON.stringify(transcript)} ` +
        `(${likelihood}% at ${confidence}%)`
      );
    });

    if (final) {
      const {transcript} = hypotheses[0];
      console.log();
      console.log(`Transcript: ${transcript}`);

      const command = parse(transcript);
      console.log('Command: %j', command);
      const {handler} = command;
      handlers[handler](command);
    }
  }
});
