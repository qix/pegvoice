#!/usr/bin/env node

'use strict';
/*eslint no-console: "allow"*/
const doc = `
Usage:
  pegvoice --kaldi [options]
  pegvoice --server [options]
  pegvoice --stdin [options]
  pegvoice --command=<command> [options]

Options:
  --trace                    Enable peg tracing
  --single-line              Use single line renderer
  --noop                     Disable actual command execution
  --mode=<mode>              Start with mode enabled
  --debug-log=<filename>     Add a debug log
  --result-log=<filename>    Log results to a file
  --grammar=<filename>       Grammer file [default: ~/.pegvoice/grammar.pgv]
  --samples=<filename>       Samples file [default: ~/.pegvoice/samples.log]
`;

const Machine = require('./Machine');
const Parser = require('./parse/Parser');
const ConsoleRenderer = require('./render/ConsoleRenderer');
const SampleLog = require('./samples/SampleLog');
const SingleLineRenderer = require('./render/SingleLineRenderer');

const binarySplit = require('binary-split');
const bunyan = require('bunyan');
const {docopt} = require('docopt');
const expandHomeDir = require('expand-home-dir');
const fs = require('fs');
const util = require('util');

const http = require('http');
const {
  rightArrow,
  modeSeperator,
  wordSeperator,
} = require('./symbols');

const options = docopt(doc);

const bunyanStreams = [];
if (options['--debug-log']) {
  bunyanStreams.push({
    level: 'debug',
    path: expandHomeDir(options['--debug-log']),
  });
}

const sampleLog = options['--samples'] && new SampleLog(options['--samples']);
const grammarPath = expandHomeDir(options['--grammar']);

const log = bunyan.createLogger({
  name: 'pegvoice',
  streams: bunyanStreams,
});
const machine = new Machine(log, {
  disableTitleWatch: !!options['--mode'],
});

let renderer;
if (options['--single-line']) {
  renderer = new SingleLineRenderer();
} else {
  renderer = new ConsoleRenderer();
}

const parser = new Parser(grammarPath, {
  onError(err) { renderer.parseError(err); },
  onChange() { renderer.grammarChanged(); },
  onStep(step) { renderer.parseStep(step); },
  parserOptions: {
    trace: options['--trace'],
  },
});

const noop = options['--noop'];

function splitWords(string) {
  if (string.includes(wordSeperator)) {
    return string.trim();
  }
  return string.trim().split(' ').join(wordSeperator);
}

async function main() {
  (options['--mode'] || '').split(' ').forEach(mode => {
    if (mode) {
      machine.toggleMode(mode, true);
    }
  });

  if (options['--kaldi']) {
    throw new Error('Kaldi parser is currently broken');
  }

  if (options['--command']) {
    executeTranscripts([splitWords(options['--command'])]);
  }

  if (options['--stdin']) {
    process.stdin.pipe(binarySplit()).on('data', line => {
      executeTranscripts([
        splitWords(line.toString('utf-8')),
      ]);
    });
  }

  if (options['--server']) {
    const server = http.createServer((req, res) => {
      let buffer = [];
      req.on('data', data => buffer.push(data));
      req.on('end', () => {
        const message = JSON.parse(Buffer.concat(buffer));
        const transcripts = message.interpretations.map(option => {
          return option.join(wordSeperator);
        }).filter(x => x);

        if (transcripts.length) {
          log.debug('Found %d options from dragon', transcripts.length);
          executeTranscripts(transcripts);
        }

        res.writeHead(200, { 'Content-Type': 'text/plain' });
        res.end('Okay');
      });
    });
    server.listen(9099);
  }

  await new Promise(() => {
    /* run forever... potentially close inside here later */
  });
}

async function executeTranscripts(transcripts) {
  let first = true;
  const mode = await machine.fetchCurrentMode();
  const modeString = Array.from(mode).sort().join(' ');


  let firstError = null;

  const commands = transcripts.map(transcript => {
    try {
      return parser.parse(transcript, mode);
    } catch (err) {
      if (err instanceof Parser.ParseError) {
        firstError = firstError || err.toString();
      } else {
        throw err;
      }
    }
  });

  const priorities = commands.map(cmd => {
    return (cmd && cmd.priority) || null;
  });

  const lowestPriority = Math.min(...priorities.filter(v => v)) || 0;
  const executeIndex = priorities.indexOf(lowestPriority);

  const skipCommands = [];
  let execCommand = null;

  transcripts.forEach((transcript, idx) => {
    if (idx === executeIndex) {
      return;
    }

    const N = idx + 1;
    const command = commands[idx];
    const rendered = command ? command.render() : 'null';
    const priority = priorities[idx];

    skipCommands.push({N, rendered, transcript, priority});
  });

  let rendered = null;
  if (executeIndex >= 0) {
    const transcript = transcripts[executeIndex];
    const command = commands[executeIndex];
    const priority = priorities[executeIndex];

    rendered = command.render();
    execCommand = {
      N: executeIndex + 1,
      rendered, transcript, priority
    };
    if (!noop) {
      command.execute(machine);
    }
  }

  if (sampleLog && machine.record && (execCommand || transcripts.length)) {
    sampleLog.append({
      modeString,
      transcript: execCommand ? execCommand.transcript : transcripts[0],
      result: execCommand ? execCommand.rendered : 'null',
    });
  }

  renderer.render({
    execCommand, skipCommands, modeString, noop,
    record: machine.record,
  });
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err.stack);
    process.exit(1);
  }
);
