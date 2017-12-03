#!/usr/bin/env ts-node
"use strict";

const doc = `
Usage:
  check-results [--rewrite] [options]

Options:
  --watch                    Watch for future updates
  --grammar=<filename>       Grammer file [default: ~/.pegvoice/grammar/main.pegvoice]
  --samples=<filename>       Samples file [default: ~/.pegvoice/samples.log]
`;

import { docopt } from "docopt";
import chalk from "chalk";

const options = docopt(doc);
import { Parser } from "./parse/Parser";
import { ParseError } from "./parse/ParseError";
import { SampleLog } from "./samples/SampleLog";

import * as bunyan from "bunyan";
import * as fs from "fs";

import { rightArrow } from "./symbols";
import { Machine } from "./Machine";

const log = bunyan.createLogger({
  name: "check-results",
  streams: []
});
const machine = new Machine(log);
const parser = new Parser(machine, options["--grammar"], {
  watchPersistent: options["--watch"]
});
const sampleLog = new SampleLog(options["--samples"]);

function checkDiff() {
  const newResults = [];

  for (const {
    modes,
    modeString,
    transcript,
    line: oldLine,
    result: oldResult
  } of sampleLog.readAll()) {
    let newResult;
    try {
      const command = parser.parse(transcript, modes);
      newResult = command.render();
    } catch (err) {
      if (err instanceof ParseError) {
        newResult = "null";
      } else {
        console.error("Failure during: %s", transcript);
        throw err;
      }
    }

    const newLine = {
      modeString,
      transcript,
      result: newResult
    };
    newResults.push(newLine);

    if (sampleLog.buildLine(newLine) !== oldLine) {
      const prefix =
        (modeString ? `${chalk.grey(modeString + ":")} ` : "") +
        transcript +
        chalk.grey(rightArrow);
      console.log(`${prefix}${chalk.red(oldResult)}`);
      console.log(`${prefix}${chalk.green(newResult)}`);
    }
  }
  return newResults;
}

async function main() {
  if (options["--rewrite"]) {
    const newResults = checkDiff();
    sampleLog.rewrite(newResults);
  } else if (options["--watch"]) {
    const renderChanges = () => {
      try {
        checkDiff();
        console.log("=== DONE ===");
      } catch (err) {
        console.error(err.stack);
      }
    };
    parser.on("update", () => {
      console.log("");
      console.log("=== GRAMMAR UPDATED ===");
      console.log("");
      renderChanges();
    });
    renderChanges();
    await new Promise(() => {
      /* run forever */
    });
  } else {
    checkDiff();
  }
}

main().then(
  () => process.exit(0),
  err => {
    console.error(err.stack);
    process.exit(1);
  }
);
