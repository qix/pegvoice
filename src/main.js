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
  --noop                     Disable actual command execution
  --debug-log=<filename>     Add a debug log
  --result-log=<filename>    Log results to a file
`;

const Machine = require('./Machine');
const Parser = require('./Parser');

const binarySplit = require('binary-split');
const bunyan = require('bunyan');
const chalk = require('chalk');
const {docopt} = require('docopt');
const fs = require('fs');

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
    path: options['--debug-log'],
  });
}

let resultLog = null;
if (options['--result-log']) {
  resultLog = fs.createWriteStream(options['--result-log'], {
    flags : 'a',
  });
}

const log = bunyan.createLogger({
  name: 'pegvoice',
  streams: bunyanStreams,
});
const machine = new Machine(log);
const parser = new Parser({
  parserOptions: {
    trace: options['--trace'],
  },
});

function splitWords(string) {
  return string.trim().split(' ').join(wordSeperator);
}
if (options['--kaldi']) {
  process.stdin.pipe(binarySplit()).on('data', line => {
    const transcript = kaldiParser(line);
    if (transcript !== null) {
      console.log();
      console.log(`Transcript: ${transcript}`);
      executeTranscript(transcript);
    }
  });
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
        console.log('Found %d options from dragon', transcripts.length);
        executeTranscripts(transcripts);
      }

      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Okay');
    });
  });
  server.listen(9099);
}

const noop = options['--noop'];

async function executeTranscripts(transcripts) {
  let executed = false;
  let first = true;
  const mode = await machine.fetchCurrentMode();
  const modeString = Array.from(mode).sort().join(' ') + modeSeperator;

  console.log(chalk.white.dim(`[${modeString}]`));
  for (let transcript of transcripts) {
    try {
      const command = parser.parse(transcript, mode);
      if (executed) {
        console.log(
          `${chalk.grey('Skip: ')}${transcript}${chalk.grey(' => ')}${chalk.grey(command.render())}`
        );
      } else {
        const word = noop ? 'NoOp' : 'Exec';
        console.log(
          `${word}: ${chalk.yellow(transcript)} => ${chalk.green(command.render())}`
        );
        executed = true;
        if (!noop) {
          command.execute(machine);
        }

        if (resultLog) {
          const commandJson = command.render();
          resultLog.write(
            `${modeString}${transcript}${rightArrow}${commandJson}\n`
          );
        }
      }
    } catch (err) {
      console.log(
        `${chalk.grey('Fail: ')}${transcript}${chalk.grey(' => null')}`
      );

      if (err instanceof Parser.ParseError) {
        if (first) {
          console.error(err.toString());
        }
      } else {
        throw err;
      }
    }
    first = false;
  }

  if (!executed && transcripts.length) {
    if (resultLog) {
      resultLog.write(`${modeString}${transcripts[0]}${rightArrow}null\n`);
    }
    console.log('No transcripts matched!');
  }
}

function kaldiParser(line) {
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
      return transcript;
    }
  }
  return null;
}
