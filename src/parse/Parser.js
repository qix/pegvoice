'use strict';
/*eslint no-console: "allow"*/

const EventEmitter = require('events');
const ParseError = require('./ParseError');
const PegGenerator = require('./PegGenerator');

const chokidar = require('chokidar');
const commands = require('../commands');
const expandHomeDir = require('expand-home-dir');
const fs = require('fs');
const peg = require("pegjs");
const util = require('util');
const {wordSeperator} = require('../symbols');

const langPath = require.resolve('../language/lang.pegjs');

function buildParser(grammarPath ,options={}) {
  const read = path => fs.readFileSync(path).toString('utf-8');

  console.log('Compiling language');
  const language = tryParse(read(langPath), s => peg.generate(s));
  const source = tryParse(read(grammarPath), s => {
    console.log('Compiling grammar');
    const parsed = language.parse(s);
    console.log('Generating grammar source');
    const generator = new PegGenerator();
    return generator.pegSource(parsed);
  });

  fs.writeFileSync(grammarPath + '.out', source);
  console.log('Creating parser');
  return tryParse(source, s => peg.generate(s, {
    ...options,
    allowedStartRules: ['__grammar__'],
  }));
}

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
    } else if (expr.type === 'pegmatch' || expr.type === 'pegtest') {
      return `_${expr.identifier}`;
    } else {
      throw new ParseError(expr, `Unknown ast: ${expr.type}`);
    }
  }).join('_');
}

class Parser extends EventEmitter {
  constructor(path, options={}) {
    super();
    this.path = expandHomeDir(path);
    this.options = options;
    this.watch();
    this.build();
  }

  watch() {
    const watcher = chokidar.watch(this.path, {
      persistent: this.options.watchPersistent || false,
    });
    watcher.on('change', () => {
      this.build();
      this.emit('update');
    });
  }

  build() {
    this.parser = buildParser(this.path, this.options.parserOptions || {});
  }

  tryParse(transcript, mode=null) {
    try {
      return this.parse(transcript, mode);
    } catch (err) {
      if (err instanceof ParseError) {
        console.error(`Parse error: ${err}`);
        return null;
      }
      throw err;
    }
  }

  parse(transcript, mode=null) {
    mode = mode || new Set();
    try {
      return this.parser.parse(transcript, {
        commands,
        mode,
      });
    } catch (err) {
      if (err instanceof this.parser.SyntaxError) {
        throw new ParseError({
          location: err.location || null,
        }, err.message);
      }
      throw err;
    }
  }
}

Parser.ParseError = ParseError;

module.exports = Parser;
