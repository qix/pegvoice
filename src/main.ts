#!/usr/bin/env ts-node

"use strict";
/*eslint no-console: "allow"*/
const doc = `
Usage:
  pegvoice --kaldi [options]
  pegvoice --server [options]
  pegvoice --stdin [options]
  pegvoice --command=<command> [options]

Options:
  --trace                    Enable peg tracing
  --single-line              Use single line renderer
  --noop                     Disable actual command execution
  --mode=<mode>              Start with mode enabled
  --debug-log=<filename>     Add a debug log
  --result-log=<filename>    Log results to a file
  --grammar=<filename>       Grammer file [default: ~/.pegvoice/grammar.pgv]
  --samples=<filename>       Samples file [default: ~/.pegvoice/samples.log]
`;

import { Machine } from "./Machine";
import { ParseError } from "./parse/ParseError";
import { Parser } from "./parse/Parser";
import { ConsoleRenderer } from "./render/ConsoleRenderer";
import { SampleLog } from "./samples/SampleLog";
import { SingleLineRenderer } from "./render/SingleLineRenderer";

import * as binarySplit from "binary-split";
import * as bunyan from "bunyan";
import { docopt } from "docopt";
import * as expandHomeDir from "expand-home-dir";
import * as fs from "fs";
import * as util from "util";

import * as http from "http";
import { rightArrow, modeSeperator, wordSeperator } from "./symbols";

const options = docopt(doc);

const bunyanStreams = [];
if (options["--debug-log"]) {
  bunyanStreams.push({
    level: "debug",
    path: expandHomeDir(options["--debug-log"])
  });
}

const sampleLog = options["--samples"] && new SampleLog(options["--samples"]);
const grammarPath = expandHomeDir(options["--grammar"]);

const log = bunyan.createLogger({
  name: "pegvoice",
  streams: bunyanStreams
});
const machine = new Machine(log, {
  disableTitleWatch: !!options["--mode"]
});

let renderer;
if (options["--single-line"]) {
  renderer = new SingleLineRenderer();
} else {
  renderer = new ConsoleRenderer();
}

const parser = new Parser(grammarPath, {
  onError(err) {
    log.error(err);
    renderer.parseError(err);
  },
  onChange() {
    renderer.grammarChanged();
  },
  onStep(step) {
    renderer.parseStep(step);
  },
  parserOptions: {
    trace: options["--trace"]
  }
});

function splitWords(string) {
  if (string.includes(wordSeperator)) {
    return string.trim();
  }
  return string
    .trim()
    .split(" ")
    .join(wordSeperator);
}

async function main() {
  await new Promise((resolve, reject) => {
    const handleError = err => {
      try {
        log.error(err);
        renderer.error(err);
      } catch (err) {
        reject(err);
      }
    };

    (options["--mode"] || "").split(" ").forEach(mode => {
      if (mode) {
        machine.toggleMode(mode, true);
      }
    });

    if (options["--kaldi"]) {
      throw new Error("Kaldi parser is currently broken");
    }

    if (options["--command"]) {
      executeTranscripts([splitWords(options["--command"])]);
    }

    if (options["--stdin"]) {
      process.stdin.pipe(binarySplit()).on("data", line => {
        executeTranscripts([splitWords(line.toString("utf-8"))]);
      });
    }

    if (options["--server"]) {
      const server = http.createServer((req, res) => {
        let buffer = [];
        req.on("data", data => buffer.push(data));
        req.on("end", () => {
          const message = JSON.parse(Buffer.concat(buffer).toString("utf-8"));

          const transcripts = message.interpretations
            .map(option => {
              return option.join(wordSeperator);
            })
            .filter(x => x);

          // Dragon joins some phrases, seperate them out here
          const dragonReplace = {
            downright: ["down", "right"],
            lineup: ["line", "up"]
          };
          for (let transcript of transcripts) {
            for (let [match, replace] of Object.entries(dragonReplace)) {
              const transformed = transcript.replace(
                match,
                replace.join(wordSeperator)
              );
              if (transformed !== transcript) {
                transcripts.push(transformed);
              }
            }
          }

          if (transcripts.length) {
            log.debug("Found %d options from dragon", transcripts.length);
            executeTranscripts(transcripts).catch(handleError);
          }

          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("Okay");
        });
      });
      server.listen(9099);
      server.on("error", handleError);
    }
  });
}

async function executeTranscripts(transcripts) {
  let first = true;
  let mode;
  try {
    mode = await machine.fetchCurrentMode();
  } catch (err) {
    renderer.commandError(err);
    return;
  }
  const modeString = Array.from(mode)
    .sort()
    .join(" ");

  let firstError = null;

  const commands = transcripts
    .map((transcript, idx) => {
      const N = idx + 1;
      try {
        const command = parser.parse(transcript, mode);
        const rendered = command ? command.render() : "null";
        const priority = command ? JSON.stringify(command.priority) : null;
        return { N, command, rendered, priority, transcript };
      } catch (err) {
        if (err instanceof ParseError) {
          firstError = firstError || err.toString();
          return {
            N,
            command: null,
            rendered: "null",
            priority: null,
            transcript
          };
        } else {
          throw err;
        }
      }
    })
    .sort((a, b) => {
      if (a.command && b.command) {
        return a.command.compareTo(b.command);
      } else {
        return a.command ? -1 : +1;
      }
    });

  let noop = options["--noop"];

  let execCommand = null;
  if (commands.length && commands[0].command) {
    execCommand = commands.shift();

    if (machine.sleep && execCommand.rendered !== "[wake up]") {
      noop = true;
    }
  }

  const renderParams = {
    execCommand,
    skipCommands: commands,
    modeString,
    noop,
    record: machine.record
  };

  if (!noop && execCommand) {
    renderer.render(
      Object.assign({}, renderParams, {
        running: true
      })
    );
    await machine.executeCommand(execCommand.command).catch(err => {
      renderer.commandError(err, execCommand);
    });
  }

  if (sampleLog && machine.record && (execCommand || transcripts.length)) {
    sampleLog.append({
      modeString,
      transcript: execCommand ? execCommand.transcript : transcripts[0],
      result: execCommand ? execCommand.rendered : "null"
    });
  }

  renderer.render(renderParams);
}

main().then(
  () => process.exit(0),
  err => {
    console.error(err.stack);
    process.exit(1);
  }
);
