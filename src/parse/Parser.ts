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
import { wordSeperator } from "../symbols";

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
          location: err.location
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

export class Parser extends EventEmitter {
  ParseError = ParseError;

  machine: Machine;
  path: string;
  options: any;
  parser: any;
  extensions: { [name: string]: any };
  watcher: any;

  constructor(machine: Machine, path, options: any = {}) {
    super();
    this.machine = machine;
    this.path = expandHomeDir(path);
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

    this.watcher = this.watch();
    this.build();
  }

  watch() {
    const watcher = chokidar.watch(this.path, {
      persistent: this.options.watchPersistent || false
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

  buildParser(grammarPath, options = {}) {
    const read = path => fs.readFileSync(path).toString("utf-8");

    this.emit("step", "Compiling language");
    const language = tryParse(read(langPath), s => peg.generate(s));

    const sourceFiles: Set<string> = new Set();
    const languageParser = (path: string): any => {
      sourceFiles.add(path);
      return tryParse(read(path), source => {
        return language.parse(source);
      });
    };

    const generator = new PegGenerator(languageParser);
    const source = generator.pegFile(grammarPath);
    this.watcher.add(Array.from(sourceFiles));

    // fs.writeFileSync(grammarPath + ".out", source);

    this.emit("step", "Creating parser");
    return tryParse(source, s =>
      peg.generate(s, {
        ...options,
        allowedStartRules: ["__grammar__"]
      })
    );
  }

  build() {
    try {
      this.parser = this.buildParser(
        this.path,
        this.options.parserOptions || {}
      );

      // This runs an initial parse, which ensures the parser works and loads extensions/etc.
      this.parse("");
      this.emit("change");
    } catch (err) {
      this.emit("error", err);
    }
  }

  parse(transcript, mode = null) {
    mode = mode || new Set();
    if (!this.parser) {
      throw new Error("No parser");
    }
    try {
      return this.parser.parse(transcript, {
        command: (command, args = {}) => {
          return this.machine.deserializeCommand({ command, args });
        },
        loadExtension: name => {
          return this.machine.loadExtension(name);
        },
        commands,
        extensions: this.extensions,
        mode
      });
    } catch (err) {
      if (err instanceof this.parser.SyntaxError) {
        throw new ParseError(
          {
            location: err.location || null
          },
          err.message
        );
      }
      throw err;
    }
  }
}
