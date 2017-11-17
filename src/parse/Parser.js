'use strict';
/*eslint no-console: "allow"*/

const EventEmitter = require('events');
const ParseError = require('./ParseError');
const PegGenerator = require('./PegGenerator');

const chokidar = require('chokidar');
const commands = require('../commands');
const debounce = require('lodash.debounce');
const expandHomeDir = require('expand-home-dir');
const fs = require('fs');
const peg = require("pegjs");
const util = require('util');
const {wordSeperator} = require('../symbols');

const langPath = require.resolve('../language/lang.pegjs');

function invariant(test, ...msg) {
  if (!test) {
    throw new Error(util.format(...msg));
  }
}

function tryParse(source, callback) {
  try {
    return callback(source);
  } catch (err) {
    if (err.name === 'SyntaxError') {
      const replaceError = new ParseError({
        location: err.location,
      }, err.message);
      replaceError.stack = err.stack;
      err = replaceError;
    }

    if (err.location) {
      err.location.source = source;
    }

    throw err;
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

    if (options.onError) {
      this.on('error', options.onError);
    }
    if (options.onChange) {
      this.on('change', options.onChange);
    }
    if (options.onStep) {
      this.on('step', options.onStep);
    }

    this.watch();
    this.build();
  }

  watch() {
    const watcher = chokidar.watch(this.path, {
      persistent: this.options.watchPersistent || false,
    });
    watcher.on('change', debounce(() => {
      this.build();
      this.emit('update');
    }, 100));
  }

  buildParser(grammarPath ,options={}) {
    const read = path => fs.readFileSync(path).toString('utf-8');

    this.emit('step', 'Compiling language');
    const language = tryParse(read(langPath), s => peg.generate(s));
    const source = tryParse(read(grammarPath), s => {
      this.emit('step', 'Compiling grammar');
      const parsed = language.parse(s);
      this.emit('step', 'Generating grammar source');
      const generator = new PegGenerator();
      return generator.pegSource(parsed);
    });

    fs.writeFileSync(grammarPath + '.out', source);
    this.emit('step', 'Creating parser');
    return tryParse(source, s => peg.generate(s, {
      ...options,
      allowedStartRules: ['__grammar__'],
    }));
  }

  build() {
    try {
      this.parser = this.buildParser(this.path, this.options.parserOptions || {});
      this.emit('change');
    } catch (err) {
      this.emit('error', err);
    }
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
