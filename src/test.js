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

function sourceArrow(location, source) {
  const {start, end} = location;
  const lines = source.split('\n');

  let output = '';
  for (let line = start.line; line <= end.line; line++) {
    const source = lines[line - 1];
    const left = (line > start.line) ? 0 : start.column - 1;
    const right = (line < end.line) ? source.length : end.column - 1;
    output += `${source}\n`;
    output += `${' '.repeat(left)}${'^'.repeat(right - left)}\n`;
  }

  return output;
}

function tryParse(source, callback) {
  /*
  source = source.replace(
    /^#alt ([a-z ]+)((?:[/] *[a-z ]+)*)$/gm,
    (match, word, alts) => {
      word = word.trim();
      alts = alts.split('/').map(alt => alt.trim()).filter(x => x);
      const pegOptions = [word, ...alts].map(x => `"${x}"`).join(' / ');
      return `${word} "${word}" = (${pegOptions}) { return "${word}"; }`;
    }
  );
  */

  try {
    return callback(source);
  } catch (err) {
    if (err.name === 'SyntaxError' && err.location) {
      console.error(err.message);
      console.error(sourceArrow(err.location, source));
      process.exit(1);
    } else {
      throw err;
    }
  }
}

function generatePegSource(ast) {
  let rv = '';
  if (ast.type === 'voiceGrammer') {
    if (ast.initializer) {
      rv += `{\n${ast.initializer.code}\n}\n`;
    }
    const ruleNames = [];
    for (let ruleAst of ast.rules) {
      const {words, code} = ruleAst;
      const ruleName = `c_${words.join('_')}`;
      const desc = words.join(' ');

      rv += `${ruleName} "${desc}" = "${words}" { ${code} }\n`;
      ruleNames.push(ruleName);
    }
    rv += `start = ${ruleNames.join(' / ')};\n`;
  } else {
    throw new Error('Unknown ast');
  }
  return rv;
}

const read = path => fs.readFileSync(path).toString('utf-8');
const language = tryParse(read('lang.pegjs'), s => peg.generate(s));
const parsed = tryParse(read('grammer.pegvoice'), s => language.parse(s));
const source = generatePegSource(parsed);
const parser = tryParse(source, s => peg.generate(s, {
  allowedStartRules: ['start'],
}));

console.log(source);
console.log(parse('slap'));
process.exit(1);


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
