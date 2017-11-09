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
  --debug-log=<filename>     Add a debug log
  --result-log=<filename>    Log results to a file
`;

const Commander = require('./Commander');
const Parser = require('./Parser');

const binarySplit = require('binary-split');
const bunyan = require('bunyan');
const {docopt} = require('docopt');
const fs = require('fs');
const renderCommand = require('./renderCommand');

const http = require('http');
const {
  rightArrow,
  wordSeperator,
} = require('./symbols');

const options = docopt(doc);

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
  executeTranscripts([options['--command'].trim()]);
}

if (options['--stdin']) {
  process.stdin.pipe(binarySplit()).on('data', line => {
    executeTranscripts([
      line.toString('utf-8').trim().split(' ').join(wordSeperator),
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
const commander = new Commander(log);
const parser = new Parser();

function executeTranscripts(transcripts) {
  let executed = false;
  let first = true;
  for (let transcript of transcripts) {
    try {
      const command = parser.parse(transcript);
      if (executed) {
        console.log('Skipping: %s => %j', transcript, command);
      } else {
        console.log('Execute: %s => %j', transcript, command);
        executed = true;
        commander.execute(command);

        if (resultLog) {
          const commandJson = renderCommand(command);
          resultLog.write(`${transcript}${rightArrow}${commandJson}\n`);
        }
      }
    } catch (err) {
      console.log('Failed: %s => null', transcript);

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
      resultLog.write(`${transcripts[0]}${rightArrow}null\n`);
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
