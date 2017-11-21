'use strict';

const ParseError = require('./ParseError');

const invariant = require('invariant');
const {wordSeperator} = require('../symbols');

class PegGenerator {
  constructor() {
    this.words = new Set();
    this.defined = new Set();
    this.nextPriority = 1;
    this.nextCodeId = 1;
    this.codeId = {};
  }

  matchToId(match) {
    return match.map(expr => {
      if (expr.type === 'word') {
        return expr.word;
      } else if (expr.type === 'pegmatch' || expr.type === 'pegtest') {
        return `_${expr.identifier}`;
      } else if (expr.type === 'pegtestcode') {
        if (!this.codeId.hasOwnProperty(expr.code)) {
          this.codeId[expr.code] = this.nextCodeId++;
        }
        return `__code_${this.codeId[expr.code]}`;
      } else {
        throw new ParseError(expr, `Unknown ast: ${expr.type}`);
      }
    }).join('_');
  }

  spellRule(word, alt=[]) {
    const byLength = (a, b) => b.length - a.length;


    const options = [
      JSON.stringify(word) + 'i _dragon? &_',
      ...alt.map(words => {
        return words.map(w => {
          if (/^[a-z]+$/.test(w)) {
            this.words.add(w);
            return w;
          }
          return JSON.stringify(w) + 'i _dragon? &_';
        }).join(' _ ');
      })
    ];

    return (
      `${word} "${word}" = ` +
      `(${options.join(' / ')}) { return "${word}" };\n`
    )
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

  pegRule(ast, ruleName, wrapPriority=true) {
    const {match} = ast;

    let desc = null;
    if (match.every(expr => expr.type === 'word')) {
      desc = match.map(expr => expr.word).join(' ');
    }

    desc = desc ? ` "${desc}"` : '';

    const matches = [...match];

    let predicates = '';
    while (matches.length) {
      if (matches[0].type === 'pegtest') {
        const {identifier, pegSymbol} = matches.shift();
        predicates += `${pegSymbol}_${identifier} `;
      } else if (matches[0].type === 'pegtestcode') {
        const {code, pegSymbol} = matches.shift();
        predicates += `${pegSymbol}${code} `;
      } else {
        break;
      }
    }

    const pegMatch = matches.map((expr, idx) => {
      let pegCode = '';
      let prefix = '';
      if (expr.type === 'word') {
        this.words.add(expr.word);
        pegCode = expr.word;
      } else if (expr.type === 'pegtest' || expr.type === 'pegtestcode') {
        throw new Error('tests must be at the start');
      } else if (expr.type === 'pegmatch') {
        prefix = `${expr.name}:`;
        pegCode = `_${expr.identifier}`;
      } else {
        throw new ParseError(expr, `Unknown ast: ${expr.type}`);
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
      let code = ast.expr.code;
      if (wrapPriority) {
        code = (`
          return new PriorityCommand(${this.nextPriority++}, (function(){
            ${code}
          })());
        `);
      }

      return (
        `${ruleName}${desc} = ${predicates}${pegMatch} "."? {\n${code}\n}\n`
      );
    } else if (ast.expr.type === 'rules') {
      const {
        ruleNames,
        source,
      } = this.pegRules(ast.expr.rules, `${ruleName}_`, wrapPriority);

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

  pegRules(rules, prefix, wrapPriority=true) {
    const ruleNames = [];
    let source = '';
    for (const ruleAst of rules) {
      if (ruleAst.type === 'rule') {
        const {match} = ruleAst;
        const ruleName = `${prefix}${this.matchToId(match)}`;
        source += this.pegRule(ruleAst, ruleName, wrapPriority);
        ruleNames.push(ruleName);
      } else if (ruleAst.type === 'pegrule') {
        this.defined.add(ruleAst.name);
        source += `${ruleAst.code}\n`;
      } else if (ruleAst.type === 'spell') {
        const {word} = ruleAst;
        source += this.spellRule(word, ruleAst.alt);;
        this.defined.add(word);
      } else if (ruleAst.type === 'define') {
        source += this.pegRule(ruleAst, `_${ruleAst.identifier}`, false);
        this.defined.add(ruleAst.identifier);
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
          rv += this.spellRule(word, []);
        }
      }

      rv += (`
      _ = "${wordSeperator}" / __eof__;

      __command__ "<command>" = result:(${ruleNames.join(' / ')}) {
        result.parseExecute(options);
        return result;
      };

      __grammar__ = head:__command__ tail:(_ __command__)* {
        if (!tail.length) {
          return head;
        }
        return new options.commands.PriorityCommand(
          head.priority || null,
          new options.commands.MultiCommand([
            head, ...tail.map(match => match[1])
          ])
        );;
      }
      __eof__ = !.;
      `);
    } else {
      throw new ParseError(ast, `Unknown ast: ${ast.type}`);
    }
    return rv;
  }
}

module.exports = PegGenerator;
