"use strict";

import { ParseError } from "./ParseError";
import { wordSeperator } from "../symbols";

import * as fs from "fs";
import * as invariant from "invariant";
import * as path from "path";
import util = require("util");

import { FSM, Node } from "./FSM";

interface AstBase {
  type: string;
  location: {
    start: { offset: number; line: number; column: number };
    end: { offset: number; line: number; column: number };
  };
}
interface AstAction extends AstBase {
  type: "action";
  expression: Ast;
  code: string;
}
interface AstNamed extends AstBase {
  type: "named";
  expression: Ast;
  name: string;
}
interface AstSequence extends AstBase {
  type: "sequence";
  elements: SequenceAst[];
}
interface AstChoice extends AstBase {
  type: "choice";
  alternatives: SequenceAst[];
}
interface AstRuleRef extends AstBase {
  type: "rule_ref";
  name: string;
}

interface AstGroup extends AstBase {
  type: "group";
  expression: SequenceAst;
}
interface AstLabeled extends AstBase {
  type: "labeled";
  label: string;
  expression: SequenceAst;
}
interface AstLiteral extends AstBase {
  type: "literal";
  value: string;
  ignoreCase: boolean;
  expression: SequenceAst;
}
interface AstOptional extends AstBase {
  type: "optional";
  expression: SequenceAst;
}
interface AstSimpleAnd extends AstBase {
  // Try to match the expression. If the match succeeds, just return undefined
  // and do not consume any input, otherwise consider the match failed.
  type: "simple_and";
  expression: SequenceAst;
}
interface AstSemanticAnd extends AstBase {
  type: "semantic_and";
  code: string;
}
interface AstZeroOrMore extends AstBase {
  type: "zero_or_more";
  expression: SequenceAst;
}
interface AstSimpleNot extends AstBase {
  type: "simple_not";
  expression: SequenceAst;
}

type SequenceAst =
  | AstLabeled
  | AstSimpleNot
  | AstSemanticAnd
  | AstZeroOrMore
  | AstLiteral
  | AstSimpleAnd
  | AstRuleRef
  | AstOptional
  | AstChoice
  | AstGroup
  | AstSequence;
type Ast = SequenceAst | AstAction | AstNamed;

export class PegGenerator {
  words = new Set<string>();
  ruleFSM: { [name: string]: FSM } = {};
  nextPriority: number = 1;
  nextCodeId: number = 1;
  codeId: { [code: string]: number } = {};
  coreFSM: FSM;

  private warn: (warning: string) => void;

  constructor(
    private parser: (path: string) => any,
    prop: {
      onWarning?: (warning: string) => void;
    } = {}
  ) {
    this.warn =
      prop.onWarning ||
      ((warning) => {
        console.error("Warning: " + warning);
      });
  }

  addRuleFSM(name: string, start: Node, final?: Node) {
    if (!this.ruleFSM.hasOwnProperty(name)) {
      if (name.startsWith("_")) {
        throw new Error("Could not find rule: " + name);
      }
      // @todo: Make sure this is never overwritten
      this.words.add(name);

      this.warn(
        util.format(
          "Unknown rule %s, assumming plain word",
          JSON.stringify(name)
        )
      );
      final = final || start.fsm.node();
      start.edge(name, final);
      return final;
    }
    const fsm = this.ruleFSM[name];

    if (start.fsm.subFSM.has(fsm)) {
      const prev = start.fsm.subFSM.get(fsm);
      if (prev.start !== start) {
        start.edge("", prev.start);
      }
      return prev.final;
    } else {
      final = final || start.fsm.node();

      const ruleStart = start.edge("");
      ruleStart.addFSM(fsm, final);

      start.fsm.subFSM.set(fsm, {
        start: ruleStart,
        final,
      });
    }

    return final;
  }

  pegNoop(start: Node, final?: Node): Node {
    if (final) {
      start.edge("", final);
      return final;
    } else {
      return start;
    }
  }

  pegSequence(ast: SequenceAst, start: Node, final?: Node): Node {
    if (ast.type === "semantic_and") {
      return this.pegNoop(start, final);
    } else if (ast.type === "simple_not") {
      this.warn("Not is not handled");
      return this.pegNoop(start, final);
    } else if (ast.type === "labeled" || ast.type === "group") {
      return this.pegSequence(ast.expression, start, final);
    } else if (ast.type === "rule_ref") {
      if (ast.name === "_" || ast.name === "_dragon") {
        // ignore space nodes
        return this.pegNoop(start, final);
      }
      return this.addRuleFSM(ast.name, start, final);
    } else if (ast.type === "optional") {
      final = this.pegSequence(ast.expression, start, final);
      start.edge("", final);
      return final;
    } else if (ast.type === "choice") {
      final = final || start.fsm.node();
      ast.alternatives.forEach((alt) => {
        this.pegSequence(alt, start, final);
      });
      return final;
    } else if (ast.type === "sequence") {
      for (const element of ast.elements) {
        start = this.pegSequence(element, start);
      }
      return this.pegNoop(start, final);
    } else if (ast.type === "simple_and") {
      invariant(
        ast.expression.type === "rule_ref" && ast.expression.name === "_",
        "simple_and only supported with space"
      );
      return this.pegNoop(start, final);
    } else if (ast.type === "literal") {
      final = final || start.fsm.node();
      start.edge(ast.value, final);
      return final;
    } else if (ast.type === "zero_or_more") {
      if (final) {
        start.edge("", final);
      }
      final = start;
      return this.pegSequence(ast.expression, start, final);
    } else {
      throw new Error("Unknown sequence ast: " + (ast as SequenceAst).type);
    }
  }

  pegExpression(start: Node, final: Node, ast: Ast) {
    if (
      ast.type === "action" ||
      ast.type === "named" ||
      ast.type === "labeled"
    ) {
      this.pegExpression(start, final, ast.expression);
    } else if (ast.type === "choice") {
      ast.alternatives.forEach((alt) => {
        this.pegExpression(start, final, alt);
      });
    } else {
      this.pegSequence(ast, start, final);
    }
  }

  matchToId(match) {
    return match
      .map((expr) => {
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

  spellRule(start: Node, final: Node, word, alt = []) {
    start.edge(word, final);

    const options = [
      JSON.stringify(word) + "i _dragon? &_",
      ...alt.map((words) => {
        let node = start;
        words.forEach((word) => {
          node = node.edge(word);
        });
        node.edge("", final);

        return words
          .map((w) => {
            if (/^[a-z][a-z_]+$/.test(w)) {
              this.words.add(w);
              return w;
            }
            return JSON.stringify(w) + "i _dragon? &_";
          })
          .join(" _ ");
      }),
    ];

    return (
      `${word} "${word}" = ` +
      `(${options.join(" / ")}) { return "${word}" };\n`
    );
  }

  pegRule(start: Node, final: Node, ast, ruleName, wrapPriority = true) {
    const { match } = ast;

    let desc = null;
    if (match.every((expr) => expr.type === "word")) {
      desc = match.map((expr) => expr.word).join(" ");
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
    let next: Node = start;

    const pegMatch = matches
      .map((expr, idx) => {
        let pegCode = "";
        let prefix = "";
        const thisNode = next;
        if (expr.type === "word") {
          next = next.edge(expr.word);
          this.words.add(expr.word);
          pegCode = expr.word;
        } else if (expr.type === "pegmatch") {
          prefix = `${expr.name}:`;
          const ruleId = `_${expr.identifier}`;
          pegCode = ruleId;

          next = this.addRuleFSM(ruleId, next);
        } else if (expr.type === "specialmatch") {
          invariant(
            expr.identifier === "repeat" && repeatSpecial === null,
            "Only repeat special match is handled"
          );
          prefix = "repeat_count:";
          pegCode = "_number";
          repeatSpecial = expr;
          next = this.addRuleFSM("_number", next);
        } else if (expr.type === "pegtest" || expr.type === "pegtestcode") {
          throw new Error("tests must be at the start");
        } else {
          throw new ParseError(expr, `Unknown ast: ${expr.type}`);
        }

        const spaceMatch = first ? '""' : "_";
        if (expr.optional) {
          thisNode.edge("", next);
          return ` ${prefix}(${spaceMatch} ${pegCode} ${first ? "" : "&"}_)?`;
        } else {
          first = false;
          return ` ${spaceMatch} ${prefix}${pegCode}`;
        }
      })
      .join("");

    invariant(!first || !pegMatch, "Not allowed optional all keywords");

    if (ast.expr.type === "code") {
      next.edge("", final);

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
        expr = `new MultiCommand([${expr}], { priority: ${this
          .nextPriority++} })`;
      }

      return `${ruleName}${desc} = ${predicates}${pegMatch} "."? {\n
        return ${expr};
      }\n`;
    } else if (ast.expr.type === "rules") {
      const { ruleNames, source } = this.generateSource(
        next,
        final,

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
    start: Node,
    final: Node,

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
        source += this.pegRule(start, final, ruleAst, ruleName, wrapPriority);
        ruleNames.push(ruleName);
      } else if (ruleAst.type === "pegrule") {
        invariant(ruleAst.rule.type === "rule", "Expected rule");
        const fsm = new FSM();
        this.pegExpression(fsm.root, fsm.final, ruleAst.rule.expression);
        this.ruleFSM[ruleAst.name] = fsm;
        source += `${ruleAst.code}\n`;
      } else if (ruleAst.type === "spell") {
        const { word } = ruleAst;
        const fsm = new FSM();
        source += this.spellRule(fsm.root, fsm.final, word, ruleAst.alt);
        this.ruleFSM[word] = fsm;
      } else if (ruleAst.type === "define") {
        const exprFSM = new FSM();
        source += this.pegRule(
          exprFSM.root,
          exprFSM.final,
          ruleAst,
          `_${ruleAst.identifier}`,
          false
        );
        this.ruleFSM["_" + ruleAst.identifier] = exprFSM;
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
          start,
          final,
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
    const fsm = new FSM();
    this.coreFSM = fsm;

    let rv = "";
    if (ast.type === "voiceGrammer") {
      if (ast.initializer) {
        rv += `{\n${ast.initializer.code}\n}\n`;
      }

      const { ruleNames, source } = this.generateSource(
        fsm.root,
        fsm.final,
        ast.rules,
        "c_",
        path
      );
      rv += `${source}\n`;

      for (let word of this.words) {
        if (!this.ruleFSM[word]) {
          const fsm = new FSM();
          rv += this.spellRule(fsm.root, fsm.final, word, []);
        }
      }

      rv += `
      _dragon = "\\\\" (!_ [ -~])+ &_;

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
    return {
      source: rv,
      fsm,
    };
  }
}
