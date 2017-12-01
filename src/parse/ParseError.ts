"use strict";

const util = require("util");

export class ParseError extends Error {
  location: any;

  constructor(ast, ...message) {
    super(util.format(...message));
    this.location = ast.location || null;
    this.name = "ParseError";
  }

  sourceArrow() {
    const { start = null, end = null, source = null } = this.location || {};

    if (!start || !end || !source) {
      return "";
    }

    const lines = source.split("\n");

    let output = "\n";
    for (let line = start.line; line <= end.line; line++) {
      const lineSource = lines[line - 1];
      const left = line > start.line ? 0 : start.column - 1;
      const right = line < end.line ? lineSource.length : end.column - 1;
      output += `${lineSource}\n`;
      output += `${" ".repeat(left)}${"^".repeat(Math.max(right - left, 1))}\n`;
    }
    return output;
  }

  render() {
    let rv = this.message + this.sourceArrow();
    if (this.name !== "SyntaxError") {
      rv += "\n" + this.stack;
    }
    return rv;
  }
}
