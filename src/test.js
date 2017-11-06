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
const util = require('util');

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

function generatePegExpr(ast, prefix) {
  if (ast.type === 'code') {
    return ast.code;
  } else if (ast.type === 'rules') {
    let rv = '';
    for (let rule of ast.rules) {
      rv += generatePegRule(rule, prefix);
    }
    return rv;
  } else {
    throw new ParseError(ast, `Unknown ast: ${ast.type}`);
  }
}

function generatePegRule(ast, prefix) {
  const {match, code} = ast;
  const ruleName = `${prefix}${matchToId(match)}`;

  let desc = null;
  if (match.every(expr => expr.type === 'word')) {
    desc = match.map(expr => expr.word).join(' ');
  }

  const pegMatch = match.map(expr => {
    if (expr.type === 'word') {
      return `"${expr.word}"`;
    } else if (expr.type === 'pegmatch') {
      return `${expr.name}:${expr.identifier}`;
    } else {
      throw new ParseError(ast, `Unknown ast: ${ast.type}`);
    }

  }).join(' ');

  if (ast.expr.type === 'code') {
    return (
      `${ruleName} "${desc}" = ${pegMatch} {\n${ast.expr.code}\n}\n`
    );
  } else if (ast.expr.type === 'rules') {
    const {
      ruleNames,
      source
    } = generatePegRules(ast.expr.rules, `${ruleName}_`);
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
function generatePegRules(rules, prefix) {
  const ruleNames = [];
  let source = '';
  for (let ruleAst of rules) {
    if (ruleAst.type === 'rule') {
      const {match} = ruleAst;
      const ruleName = `${prefix}${matchToId(match)}`;
      source += generatePegRule(ruleAst, prefix);
      ruleNames.push(ruleName);
    } else if (ruleAst.type === 'pegrule') {
      source += `${ruleAst.code}\n`;
    } else if (ruleAst.type === 'spell') {
      const {word} = ruleAst;
      source += `${word} "${word}" = "${word}";\n`;
    } else {
      throw new ParseError(ruleAst, `Unknown ast: ${ruleAst.type}`);
    }
  }
  return {ruleNames, source};
}

function generatePegSource(ast) {
  let rv = '';
  if (ast.type === 'voiceGrammer') {
    if (ast.initializer) {
      rv += `{\n${ast.initializer.code}\n}\n`;
    }
    const {ruleNames, source} = generatePegRules(ast.rules, 'c_');
    rv += `${source}\nstart = ${ruleNames.join(' / ')};\n`;
  } else {
    throw new ParseError(ast, `Unknown ast: ${ast.type}`);
  }
  return rv;
}

const read = path => fs.readFileSync(path).toString('utf-8');
console.log('Compiling language');
const language = tryParse(read('lang.pegjs'), s => peg.generate(s));
const source = tryParse(read('grammer.pegvoice'), s => {
  console.log('Compiling grammer');
  const parsed = language.parse(s);
  console.log('Generating grammer source');
  return generatePegSource(parsed);
});
console.log(source);
console.log('Creating parser');
const parser = tryParse(source, s => peg.generate(s, {
  allowedStartRules: ['start'],
}));

console.log(source);
console.log('Parsing command');
console.log(parse('window left'));
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
