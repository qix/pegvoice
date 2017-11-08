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
  --debug-log=<filename> Add a debug log
`;

const binarySplit = require('binary-split');
const bunyan = require('bunyan');
const {docopt} = require('docopt');
const fs = require('fs');
const http = require('http');
const i3 = require('i3').createClient();
const peg = require("pegjs");
const robot = require('robotjs');
const util = require('util');

function invariant(test, ...msg) {
  if (!test) {
    throw new Error(util.format(...msg));
  }
}

function sourceArrow(location, source) {
  const {start, end} = location;
  const lines = source.split('\n');

  let output = '';
  for (let line = start.line; line <= end.line; line++) {
    const lineSource = lines[line - 1];
    const left = (line > start.line) ? 0 : start.column - 1;
    const right = (line < end.line) ? lineSource.length : end.column - 1;
    output += `${lineSource}\n`;
    output += `${' '.repeat(left)}${'^'.repeat(Math.max(right - left, 1))}\n`;
  }

  return output;
}

class ParseError extends Error {
  constructor(ast, ...message) {
    super(util.format(...message));
    this.location = ast.location || null;
    this.name = 'ParseError';
  }
}

function tryParse(source, callback) {
  try {
    return callback(source);
  } catch (err) {
    if (
      (err.name === 'SyntaxError' || err.name === 'ParseError') &&
      err.location
    ) {
      console.error(err.message);
      console.error(sourceArrow(err.location, source));
      if (err.name !== 'SyntaxError') {
        console.error(err.stack);
      }
      process.exit(1);
    } else {
      throw err;
    }
  }
}

function matchToId(match) {
  return match.map(expr => {
    if (expr.type === 'word') {
      return expr.word;
    } else if (expr.type === 'pegmatch') {
      return `_${expr.identifier}`;
    } else {
      throw new ParseError(expr, `Unknown ast: ${expr.type}`);
    }
  }).join('_');
}

class PegGenerator {
  constructor() {
    this.words = new Set();
    this.defined = new Set();
  }

  pegExpr(ast, prefix) {
    if (ast.type === 'code') {
      return ast.code;
    } else if (ast.type === 'rules') {
      let rv = '';
      for (let rule of ast.rules) {
        rv += this.pegRule(rule, prefix);
      }
      return rv;
    } else {
      throw new ParseError(ast, `Unknown ast: ${ast.type}`);
    }
  }

  pegRule(ast, prefix) {
    const {match, code} = ast;
    const ruleName = `${prefix}${matchToId(match)}`;

    let desc = null;
    if (match.every(expr => expr.type === 'word')) {
      desc = match.map(expr => expr.word).join(' ');
    }

    desc = desc ? ` "${desc}"` : '';

    const pegMatch = match.map((expr, idx) => {
      let pegCode = '';
      if (expr.type === 'word') {
        this.words.add(expr.word);
        pegCode = expr.word;
      } else if (expr.type === 'pegmatch') {
        pegCode = `${expr.name}:${expr.identifier}`;
      } else {
        throw new ParseError(ast, `Unknown ast: ${ast.type}`);
      }

      if (idx === 0) {
        invariant(!expr.optional, 'Not allowed');
        return pegCode;
      } else {
        if (expr.optional) {
          return ` (" " ${pegCode})?`;
        } else {
          return ` " " ${pegCode}`;
        }
      }
    }).join('');

    if (ast.expr.type === 'code') {
      return (
        `${ruleName}${desc} = ${pegMatch} "."? {\n${ast.expr.code}\n}\n`
      );
    } else if (ast.expr.type === 'rules') {
      const {
        ruleNames,
        source
      } = this.pegRules(ast.expr.rules, `${ruleName}_`);
      return (
        `${source}` +
        `${ruleName} = ${pegMatch} " " action:(${ruleNames.join(' / ')}) {\n` +
        `  return action;\n}\n`
      );
      return '/**/';

    } else {
      throw new ParseError(ast, `Unknown ast: ${ast.type}`);
    }
  }

  pegRules(rules, prefix) {
    const ruleNames = [];
    let source = '';
    for (let ruleAst of rules) {
      if (ruleAst.type === 'rule') {
        const {match} = ruleAst;
        const ruleName = `${prefix}${matchToId(match)}`;
        source += this.pegRule(ruleAst, prefix);
        ruleNames.push(ruleName);
      } else if (ruleAst.type === 'pegrule') {
        this.defined.add(ruleAst.name);
        source += `${ruleAst.code}\n`;
      } else if (ruleAst.type === 'spell') {
        const {word} = ruleAst;
        const options = [
          [word], ...ruleAst.alt
        ].map(words => `"${words.join(' ')}"i`).sort((a, b) => {
          return b.length - a.length;
        });
        source += (
          `${word} "${word}" = ` +
          `(${options.join(' / ')}) { return "${word}" };\n`
        );
        this.defined.add(word);
      } else {
        throw new ParseError(ruleAst, `Unknown ast: ${ruleAst.type}`);
      }
    }
    return {ruleNames, source};
  }

  pegSource(ast) {
    let rv = '';
    if (ast.type === 'voiceGrammer') {
      if (ast.initializer) {
        rv += `{\n${ast.initializer.code}\n}\n`;
      }
      const {ruleNames, source} = this.pegRules(ast.rules, 'c_');
      rv += `${source}\n`;
      for (let word of this.words) {
        if (!this.defined.has(word)) {
          rv += `${word} = "${word}"i;\n`;
        }
      }
      rv += (`
      __command__ = ${ruleNames.join(' / ')};
      __grammer__ = head:__command__ tail:(_ __command__)* {
        if (!tail.length) {
          return head;
        }
        return {
          handler: 'multi',
          commands: [head, ...tail.map(match => match[1])],
        };
      }
      `);
    } else {
      throw new ParseError(ast, `Unknown ast: ${ast.type}`);
    }
    return rv;
  }
}


const parser = buildParser();


['workspace',
  'output', 'mode', 'window', 'barconfig_update', 'binding'].forEach(event => {

    i3.on(event, details => {
      log.debug({
        details: details,
      }, 'i3 %s', event);
    });
  });

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
  executeTranscript(options['--command'].trim());
}

if (options['--stdin']) {
  process.stdin.pipe(binarySplit()).on('data', line => {
    executeTranscript(line.toString('utf-8').trim());
  });
}

if (options['--server']) {
  const server = http.createServer((req, res) => {
    let buffer = [];
    req.on('data', data => buffer.push(data));
    req.on('end', () => {
      const message = JSON.parse(Buffer.concat(buffer));
      const transcripts = message.interpretations.map(option => {
        return option.join(' ');
      }).filter(x => x);

      if (transcripts.length) {
        console.log('Found %d options from dragon', transcripts.length);
        executeTranscripts(transcripts);
      } else {
        console.log('Found no options from dragon');
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

const log = bunyan.createLogger({
  name: 'pegvoice',
  streams: bunyanStreams,
});

function executeTranscripts(transcripts) {
  let executed = false;
  for (let transcript of transcripts) {
    console.log('Testing: %s', transcript);
    const command = parse(transcript);
    if (command) {
      if (executed) {
        console.log('Skipping: %s => %j', transcript, command);
      } else {
        console.log('Execute: %s => %j', transcript, command);
        executed = true;
        executeCommand(command);
      }
    }
  }

  console.log('No transcripts matched!');
}

function executeCommand(command) {
  const handlers = {
    i3(props) {
      const {command} = props;
      i3.command(command);
    },
    multi(props) {
      for (let command of props.commands) {
        executeCommand(command);
      }
    },
    repeat(props) {
      for (let i = 0; i < props.count; i++) {
        executeCommand(props.command);
      }
    },
    key(props) {
      let split = props.key.split('-');
      const key = split.pop();
      const modifiers = split.map(modifier => ({
        ctrl: 'control',
      }[modifier] || modifier));
      robot.keyTap(key, modifiers);
    },
    type(props) {
      robot.typeString(props.string);
    },
    noop() {}
  };

  const {handler} = command;
  handlers[handler](command);
}

function buildParser() {
  const read = path => fs.readFileSync(path).toString('utf-8');
  console.log('Compiling language');
  const language = tryParse(read('lang.pegjs'), s => peg.generate(s));
  const source = tryParse(read('grammer.pegvoice'), s => {
    console.log('Compiling grammer');
    const parsed = language.parse(s);
    console.log('Generating grammer source');
    const generator = new PegGenerator();
    return generator.pegSource(parsed);
  });
  console.log('Creating parser');
  console.log(source);
  return tryParse(source, s => peg.generate(s, {
    allowedStartRules: ['__grammer__'],
  }));
}

function parse(transcript) {
  try {
    return parser.parse(transcript);
  } catch (err) {
    console.error(`Parse error: ${err}`);
    return null;
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
