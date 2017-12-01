"use strict";

import * as expandHomeDir from "expand-home-dir";
import * as fs from "fs";
import * as invariant from "invariant";

import { modeSeperator, wordSeperator, rightArrow } from "../symbols";

export class SampleLog {
  path: string;
  file: any;

  constructor(path) {
    this.path = expandHomeDir(path);
    this.file = null;
  }

  readAll() {
    const results = fs.readFileSync(this.path).toString("utf-8");
    return results
      .split("\n")
      .filter(v => v.trim())
      .map(line => {
        const [modeTranscript, result] = line.split(rightArrow);
        const [modeString, transcript] = modeTranscript.split(modeSeperator);
        return {
          modeString,
          result,
          transcript,
          line,
          modes: new Set(Array.from(modeString.split(" ")))
        };
      });
  }

  buildLine({ modeString, transcript, result }) {
    invariant(typeof modeString === "string", "Expected string");
    invariant(typeof transcript === "string", "Expected string");
    invariant(
      result === null || typeof result === "string",
      "Expected string/null"
    );

    return (
      modeString + modeSeperator + transcript + rightArrow + (result || "null")
    );
  }

  append(line) {
    if (!this.file) {
      this.file = fs.createWriteStream(this.path, {
        flags: "a"
      });
    }

    this.file.write(this.buildLine(line) + "\n");
  }

  rewrite(results) {
    const strings = results.map(result => this.buildLine(result));
    const lines = Array.from(new Set(strings)).sort();
    fs.writeFileSync(this.path, lines.join("\n") + "\n");
  }
}
