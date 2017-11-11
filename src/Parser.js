'use strict';
/*eslint no-console: "allow"*/

const commands = require('./commands');
const fs = require('fs');
const peg = require("pegjs");
const util = require('util');
const {wordSeperator} = require('./symbols');

const langPath = require.resolve('./lang.pegjs');
const grammerPath = require.resolve('./grammer.pegvoice');

function buildParser(options={}) {
  const read = path => fs.readFileSync(path).toString('utf-8');

  console.log('Compiling language');
  const language = tryParse(read(langPath), s => peg.generate(s));
  const source = tryParse(read(grammerPath), s => {
    console.log('Compiling grammer');
    const parsed = language.parse(s);
    console.log('Generating grammer source');
    const generator = new PegGenerator();
    return generator.pegSource(parsed);
  });

  fs.writeFileSync(grammerPath + '.out', source);
  console.log('Creating parser');
  return tryParse(source, s => peg.generate(s, {
    ...options,
    allowedStartRules: ['__grammer__'],
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
    } else if (expr.type === 'pegmatch' || expr.type === 'pegtest') {
      return `_${expr.identifier}`;
    } else {
      throw new ParseError(expr, `Unknown ast: ${expr.type}`);
    }
  }).join('_');
}

function spellRule(word, alt=[]) {
  const byLength = (a, b) => b.length - a.length;
  const options = [word, ...alt].map(words => {
    return JSON.stringify(words) + 'i';
  }).sort(byLength);
  return (
    `${word} "${word}" = ` +
    `(${options.join(' / ')}) _dragon? &_ { return "${word}" };\n`
  )
};
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
      for (const rule of ast.rules) {
        rv += this.pegRule(rule, prefix);
      }
      return rv;
    } else {
      throw new ParseError(ast, `Unknown ast: ${ast.type}`);
    }
  }

  pegRule(ast, prefix) {
    const {match} = ast;
    const ruleName = `${prefix}${matchToId(match)}`;

    let desc = null;
    if (match.every(expr => expr.type === 'word')) {
      desc = match.map(expr => expr.word).join(' ');
    }

    desc = desc ? ` "${desc}"` : '';

    const matches = [...match];

    let predicates = '';
    while (matches.length && matches[0].type === 'pegtest') {
      predicates += `&_${matches.shift().identifier} `;
    }

    const pegMatch = matches.map((expr, idx) => {
      let pegCode = '';
      let prefix = '';
      if (expr.type === 'word') {
        this.words.add(expr.word);
        pegCode = expr.word;
      } else if (expr.type === 'pegtest') {
        throw new Error('tests must be at the start');
      } else if (expr.type === 'pegmatch') {
        prefix = `${expr.name}:`;
        pegCode = `_${expr.identifier}`;
      } else {
        throw new ParseError(ast, `Unknown ast: ${ast.type}`);
      }

      if (idx === 0) {
        invariant(!expr.optional, 'Not allowed optional first word');
        return `${prefix}${pegCode}`;
      } else {
        if (expr.optional) {
          return ` ${prefix}(_ ${pegCode} &_)?`;
        } else {
          return ` _ ${prefix}${pegCode}`;
        }
      }
    }).join('');

    if (ast.expr.type === 'code') {
      return (
        `${ruleName}${desc} = ${predicates}${pegMatch} "."? {\n${ast.expr.code}\n}\n`
      );
    } else if (ast.expr.type === 'rules') {
      const {
        ruleNames,
        source,
      } = this.pegRules(ast.expr.rules, `${ruleName}_`);

      const initial = predicates + pegMatch + (pegMatch ? ' _ ' : '');
      return (
        `${source}` +
        `${ruleName} = ${initial} action:(${ruleNames.join(' / ')}) {\n` +
        `  return action;\n}\n`
      );
    } else {
      throw new ParseError(ast, `Unknown ast: ${ast.type}`);
    }
  }

  pegRules(rules, prefix) {
    const ruleNames = [];
    let source = '';
    for (const ruleAst of rules) {
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
        source += spellRule(word, ruleAst.alt);;
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
          rv += spellRule(word, []);
        }
      }
      rv += (`
      _ = "${wordSeperator}" / __eof__;

      __command__ "<command>" = result:(${ruleNames.join(' / ')}) {
        result.parseExecute(options);
        return result;
      };

      __grammer__ = head:__command__ tail:(_ __command__)* {
        if (!tail.length) {
          return head;
        }
        return new options.commands.MultiCommand([
          head, ...tail.map(match => match[1])
        ]);
      }
      __eof__ = !.;
      `);
    } else {
      throw new ParseError(ast, `Unknown ast: ${ast.type}`);
    }
    return rv;
  }
}

class Parser {
  constructor(options={}) {
    this.parser = buildParser(options.parserOptions || {});
    this.options = options;
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
