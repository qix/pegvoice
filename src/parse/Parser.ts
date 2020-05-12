"use strict";
/*eslint no-console: "allow"*/

import * as EventEmitter from "events";
import { Machine } from "../Machine";
import { ParseError } from "./ParseError";
import { PegGenerator } from "./PegGenerator";

import * as chokidar from "chokidar";
import * as commands from "../commands/index";
import * as debounce from "lodash.debounce";
import * as expandHomeDir from "expand-home-dir";
import * as fs from "fs";
import * as peg from "pegjs";
import * as util from "util";
import path = require("path");
import { wordSeperator } from "../symbols";
import { FSM } from "./FSM";

const langPath = require.resolve("../language/lang.pegjs");

function invariant(test, message, ...args) {
  if (!test) {
    throw new Error(util.format(message, ...args));
  }
}

function tryParse(source, callback) {
  try {
    return callback(source);
  } catch (err) {
    if (err.name === "SyntaxError") {
      const replaceError = new ParseError(
        {
          location: err.location,
        },
        err.message
      );
      replaceError.stack = err.stack;
      err = replaceError;
    }

    if (err.location) {
      err.location.source = source;
    }

    throw err;
  }
}

interface ParserOptions {
  useOldParserIfBroken?: boolean;
  onError?: (err) => void;
  onChange?: () => void;
  onStep?: (step: string) => void;
  compiledPath?: string;
  trace?: boolean;
}
export class Parser extends EventEmitter {
  ParseError = ParseError;

  machine: Machine;
  grammarPath: string;
  compiledPath?: string;
  options: any;
  parser: any;
  fsm: FSM | null = null;
  extensions: { [name: string]: any };
  watcher: any;
  parserError: any = null;

  constructor(machine: Machine, path, options: ParserOptions = {}) {
    super();
    this.machine = machine;
    this.grammarPath = expandHomeDir(path);
    this.compiledPath = options.compiledPath
      ? expandHomeDir(options.compiledPath)
      : null;
    this.extensions = {};
    this.options = options;

    if (options.onError) {
      this.on("error", options.onError);
    }
    if (options.onChange) {
      this.on("change", options.onChange);
    }
    if (options.onStep) {
      this.on("step", options.onStep);
    }

    this.on("warning", (warning) => {
      if (this.listenerCount("warning") === 1) {
        console.error("Warning: " + warning);
      }
    });

    this.watcher = this.watch();
    this.build();
  }

  watch() {
    const watcher = chokidar.watch(this.grammarPath, {
      persistent: this.options.watchPersistent || false,
    });
    watcher.on(
      "change",
      debounce(() => {
        this.build();
        this.emit("update");
      }, 100)
    );
    return watcher;
  }

  private buildParser() {
    const read = (path) => {
      return fs.readFileSync(path).toString("utf-8");
    };

    this.emit("step", "Compiling language");
    const language = tryParse(read(langPath), (s) => peg.generate(s));

    const sourceFiles: Set<string> = new Set();
    const languageParser = (path: string): any => {
      sourceFiles.add(path);
      return tryParse(read(path), (source) => {
        return language.parse(source);
      });
    };

    const generator = new PegGenerator(languageParser, {
      onWarning: this.emit.bind(this, "warning"),
    });
    const { source, fsm } = generator.pegFile(this.grammarPath);
    this.watcher.add(Array.from(sourceFiles));

    if (this.compiledPath) {
      try {
        fs.mkdirSync(this.compiledPath);
      } catch (err) {
        if (err.code !== "EEXIST") {
          throw err;
        }
      }
      fs.writeFileSync(path.join(this.compiledPath, "grammar.pegjs"), source);
      fs.writeFileSync(
        path.join(this.compiledPath, "grammar.dot"),
        fsm.renderDot()
      );
    }

    this.emit("step", "Creating parser");
    const parser = tryParse(source, (s) =>
      peg.generate(s, {
        trace: this.options.trace || false,
        allowedStartRules: ["__grammar__"],
      })
    );

    return { parser, fsm };
  }

  build() {
    try {
      this.parserError = null;
      const { parser, fsm } = this.buildParser();

      this.parser = parser;
      this.fsm = fsm;

      // This runs an initial parse, which ensures the parser works and loads extensions/etc.
      this.parse("");
      this.emit("change");
    } catch (err) {
      this.parserError = err;
      if (!this.options.useOldParserIfBroken) {
        this.parser = null;
      }
      this.emit("error", err);
    }
  }

  parse(transcript, mode = null) {
    mode = mode || new Set();
    if (!this.parser) {
      if (this.parserError) {
        throw this.parserError;
      } else {
        throw new Error("No parser");
      }
    }
    try {
      return this.parser.parse(transcript, {
        command: (command, args = {}) => {
          return this.machine.deserializeCommand({ command, args });
        },
        loadExtension: (name) => {
          return this.machine.loadExtension(name);
        },
        commands,
        extensions: this.extensions,
        mode,
      });
    } catch (err) {
      if (err instanceof this.parser.SyntaxError) {
        throw new ParseError(
          {
            location: err.location || null,
          },
          err.message
        );
      }
      throw err;
    }
  }
}
