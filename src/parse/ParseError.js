'use strict';

const util = require('util');

class ParseError extends Error {
  constructor(ast, ...message) {
    super(util.format(...message));
    this.location = ast.location || null;
    this.name = 'ParseError';
  }
}

module.exports = ParseError;
