"use strict";

import { ParseError } from "./ParseError";
import { wordSeperator } from "../symbols";

import * as invariant from "invariant";
import * as path from "path";

export class PegGenerator {
  words: Set<string>;
  defined: Set<string>;
  nextPriority: number;
  nextCodeId: number;
  codeId: object;
  parser: (path: string) => any;

  constructor(parser: ((path: string) => any)) {
    this.words = new Set();
    this.defined = new Set();
    this.nextPriority = 1;
    this.nextCodeId = 1;
    this.codeId = {};
    this.parser = parser;
  }

  matchToId(match) {
    return match
      .map(expr => {
        if (expr.type === "word") {
          return expr.word;
        } else if (
          expr.type === "pegmatch" ||
          expr.type === "pegtest" ||
          expr.type === "specialmatch"
        ) {
          return `_${expr.identifier}`;
        } else if (expr.type === "pegtestcode") {
          if (!this.codeId.hasOwnProperty(expr.code)) {
            this.codeId[expr.code] = this.nextCodeId++;
          }
          return `__code_${this.codeId[expr.code]}`;
        } else {
          throw new ParseError(expr, `Unknown ast: ${expr.type}`);
        }
      })
      .join("_");
  }

  spellRule(word, alt = []) {
    const byLength = (a, b) => b.length - a.length;

    const options = [
      JSON.stringify(word) + "i _dragon? &_",
      ...alt.map(words => {
        return words
          .map(w => {
            if (/^[a-z][a-z_]+$/.test(w)) {
              this.words.add(w);
              return w;
            }
            return JSON.stringify(w) + "i _dragon? &_";
          })
          .join(" _ ");
      })
    ];

    return (
      `${word} "${word}" = ` +
      `(${options.join(" / ")}) { return "${word}" };\n`
    );
  }

  pegExpr(ast, prefix) {
    if (ast.type === "code") {
      return ast.code;
    } else if (ast.type === "rules") {
      let rv = "";
      for (const rule of ast.rules) {
        rv += this.pegRule(rule, prefix);
      }
      return rv;
    } else {
      throw new ParseError(ast, `Unknown ast: ${ast.type}`);
    }
  }

  pegRule(ast, ruleName, wrapPriority = true) {
    const { match } = ast;

    let desc = null;
    if (match.every(expr => expr.type === "word")) {
      desc = match.map(expr => expr.word).join(" ");
    }

    desc = desc ? ` "${desc}"` : "";

    const matches = [...match];

    let predicates = "";
    while (matches.length) {
      if (matches[0].type === "pegtest") {
        const { identifier, pegSymbol } = matches.shift();
        predicates += `${pegSymbol}_${identifier} `;
      } else if (matches[0].type === "pegtestcode") {
        const { code, pegSymbol } = matches.shift();
        predicates += `${pegSymbol}${code} `;
      } else {
        break;
      }
    }

    let first = true;

    let repeatSpecial = null;
    const pegMatch = matches
      .map((expr, idx) => {
        let pegCode = "";
        let prefix = "";
        if (expr.type === "word") {
          this.words.add(expr.word);
          pegCode = expr.word;
        } else if (expr.type === "pegtest" || expr.type === "pegtestcode") {
          throw new Error("tests must be at the start");
        } else if (expr.type === "pegmatch") {
          prefix = `${expr.name}:`;
          pegCode = `_${expr.identifier}`;
        } else if (expr.type === "specialmatch") {
          invariant(
            expr.identifier === "repeat" && repeatSpecial === null,
            "Only repeat special match is handled"
          );
          prefix = "repeat_count:";
          pegCode = "_number";
          repeatSpecial = expr;
        } else {
          throw new ParseError(expr, `Unknown ast: ${expr.type}`);
        }

        const spaceMatch = first ? '""' : "_";
        if (expr.optional) {
          return ` ${prefix}(${spaceMatch} ${pegCode} ${first ? "" : "&"}_)?`;
        } else {
          first = false;
          return ` ${spaceMatch} ${prefix}${pegCode}`;
        }
      })
      .join("");

    invariant(!first || !pegMatch, "Not allowed optional all keywords");

    if (ast.expr.type === "code") {
      let code = ast.expr.code;
      let expr = `(function(){
        ${code}
      })()`;

      if (repeatSpecial) {
        if (repeatSpecial.optional) {
          expr = `repeat(optional(repeat_count, 1), ${expr})`;
        }
      }
      if (wrapPriority) {
        expr = `new MultiCommand([${expr}], ${this.nextPriority++})`;
      }

      return `${ruleName}${desc} = ${predicates}${pegMatch} "."? {\n
        return ${expr};
      }\n`;
    } else if (ast.expr.type === "rules") {
      const { ruleNames, source } = this.generateSource(
        ast.expr.rules,
        `${ruleName}_`,
        null,
        wrapPriority
      );

      const initial = predicates + pegMatch + (pegMatch ? " _ " : "");
      return (
        `${source}` +
        `${ruleName} = ${initial} action:(${ruleNames.join(" / ")}) {\n` +
        `  return action;\n}\n`
      );
    } else {
      throw new ParseError(ast, `Unknown ast: ${ast.type}`);
    }
  }

  generateSource(
    rules: Array<any>,
    prefix: string,
    sourcePath: string | null,
    wrapPriority: boolean = true
  ): { ruleNames: Array<string>; source: string } {
    const ruleNames = [];
    let source = "";
    for (const ruleAst of rules) {
      if (ruleAst.type === "rule") {
        const { match } = ruleAst;
        const ruleName = `${prefix}${this.matchToId(match)}`;
        source += this.pegRule(ruleAst, ruleName, wrapPriority);
        ruleNames.push(ruleName);
      } else if (ruleAst.type === "pegrule") {
        this.defined.add(ruleAst.name);
        source += `${ruleAst.code}\n`;
      } else if (ruleAst.type === "spell") {
        const { word } = ruleAst;
        source += this.spellRule(word, ruleAst.alt);
        this.defined.add(word);
      } else if (ruleAst.type === "define") {
        source += this.pegRule(ruleAst, `_${ruleAst.identifier}`, false);
        this.defined.add(ruleAst.identifier);
      } else if (ruleAst.type === "import") {
        invariant(sourcePath, "Import statements only allowed at top level");
        const filePath = path.join(
          path.dirname(sourcePath),
          `${ruleAst.module}.pegvoice`
        );
        const parsed = this.parser(filePath);
        invariant(
          !parsed.initializer,
          "Initializer not valid on included files"
        );
        const generated = this.generateSource(
          parsed.rules,
          prefix,
          sourcePath,
          wrapPriority
        );
        ruleNames.push(...generated.ruleNames);
        source += generated.source;
      } else {
        throw new ParseError(ruleAst, `Unknown ast: ${ruleAst.type}`);
      }
    }
    return { ruleNames, source };
  }

  pegFile(path) {
    const ast = this.parser(path);
    let rv = "";
    if (ast.type === "voiceGrammer") {
      if (ast.initializer) {
        rv += `{\n${ast.initializer.code}\n}\n`;
      }

      const { ruleNames, source } = this.generateSource(ast.rules, "c_", path);
      rv += `${source}\n`;

      for (let word of this.words) {
        if (!this.defined.has(word)) {
          rv += this.spellRule(word, []);
        }
      }

      rv += `
      _ = "${wordSeperator}" / __eof__;

      __command__ "<command>" = result:(${ruleNames.join(" / ")}) {
        result.parseExecute(options);
        return result;
      };

      __grammar__ = head:__command__? tail:(_ __command__)* __eof__ {
        if (!head) {
          head = options.command('noop');
        }
        return options.commands.MultiCommand.fromArray([
          head, ...tail.map(match => match[1])
        ]);
      }
      __eof__ = !.;
      `;
    } else {
      throw new ParseError(ast, `Unknown ast: ${ast.type}`);
    }
    return rv;
  }
}
