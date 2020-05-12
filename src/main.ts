#!/usr/bin/env ts-node
/*eslint no-console: "allow"*/

const doc = `
Usage:
  pegvoice --kaldi [options]
  pegvoice --server [options]
  pegvoice --stdin [options]
  pegvoice --json-rpc=<path> [options]
  pegvoice --command=<command> [options]

Options:
  --trace                    Enable peg tracing
  --single-line              Use single line renderer
  --use-old-if-broken        Use old parser a syntax error is introduced
  --start-awake              Start awake by default
  --noop                     Disable actual command execution
  --mode=<mode>              Start with mode enabled
  --json-rpc=<path>          Path to JSON-rpc voice server
  --debug-log=<filename>     Add a debug log
  --result-log=<filename>    Log results to a file
  --output=<path>            Compiled output [default: ~/.pegvoice/output]
  --macros=<path>            Macro storage [default: ~/.pegvoice/macros]
  --grammar=<filename>       Grammer file [default: ~/.pegvoice/grammar/main.pegvoice]
  --samples=<filename>       Samples file [default: ~/.pegvoice/samples.log]
`;

import { Machine } from "./Machine";
import { Config } from "./config";
import { Parser } from "./parse/Parser";
import { ConsoleRenderer } from "./render/ConsoleRenderer";
import CommandResult from "./render/CommandResult";
import { SampleLog } from "./samples/SampleLog";
import { SingleLineRenderer } from "./render/SingleLineRenderer";

import * as binarySplit from "binary-split";
import * as bunyan from "bunyan";
import { docopt } from "docopt";
import * as expandHomeDir from "expand-home-dir";

import * as http from "http";
import { wordSeperator } from "./symbols";
import { JsonRpc } from "./jsonrpc";
import { RenderOpt, Renderer } from "./render/Renderer";
import { ExecutionContext } from "./commands/ExecutionContext";

const options = docopt(doc);

const bunyanStreams = [];
if (options["--debug-log"]) {
  bunyanStreams.push({
    level: "debug",
    path: expandHomeDir(options["--debug-log"]),
  });
}

Config.macroPath = options["--macros"];
const sampleLog = options["--samples"] && new SampleLog(options["--samples"]);
const grammarPath = expandHomeDir(options["--grammar"]);

const log = bunyan.createLogger({
  name: "pegvoice",
  streams: bunyanStreams,
});

let renderer: Renderer;
let childStderr: "ignore" | "inherit" = "inherit";

if (options["--single-line"]) {
  childStderr = "ignore";
  renderer = new SingleLineRenderer();
} else {
  renderer = new ConsoleRenderer();
}

const machine = new Machine(renderer, {
  disableTitleWatch: !!options["--mode"],
  startAwake: !!options["--start-awake"],
});

const parser = new Parser(machine, grammarPath, {
  compiledPath: expandHomeDir(options["--output"]),
  onError(err) {
    renderer.grammarError(err);
  },
  onChange() {
    renderer.grammarChanged();
  },
  onStep(step) {
    renderer.parseStep(step);
  },
  useOldParserIfBroken: options["--use-old-if-broken"],
  trace: options["--trace"] ?? false,
});

parser.on("warning", (warning: string) => {
  renderer.message("Warning: " + warning);
});

function splitWords(string) {
  if (string.includes(wordSeperator)) {
    return string.trim();
  }
  return string.trim().split(" ").join(wordSeperator);
}

async function main() {
  await new Promise((resolve, reject) => {
    const handleError = (err) => {
      try {
        log.error(err);
        renderer.error(err);
      } catch (err) {
        reject(err);
      }
    };

    (options["--mode"] || "").split(" ").forEach((mode) => {
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
      process.stdin.pipe(binarySplit()).on("data", (line) => {
        executeTranscripts([splitWords(line.toString("utf-8"))]);
      });
    }

    if (options["--json-rpc"]) {
      const rpc = JsonRpc.spawn(expandHomeDir(options["--json-rpc"]), [], {
        childStderr,
      });

      if (parser.fsm) {
        rpc.send("fsm", parser.fsm.dump());
      }
      parser.on("change", () => {
        rpc.send("fsm", parser.fsm.dump());
      });

      const threshold = 1.75;
      rpc.on("message", ({ method, params }) => {
        if (method === "message") {
          let noopReason: string | null = null;
          if (params.likelihood < threshold) {
            noopReason = "below-threshold:" + params.likelihood.toFixed(2);
          }
          executeTranscripts([splitWords(params.output)], {
            noopReason,
          });
        } else if (method === "partial") {
          executeTranscripts([splitWords(params.output)], {
            partial: true,
          });
        } else if (method === "status") {
          renderer.message("Status: " + params.message);
        } else {
          renderer.message("Not handled", method, params);
        }
      });
    }

    if (options["--server"]) {
      const server = http.createServer((req, res) => {
        let buffer = [];
        req.on("data", (data) => buffer.push(data));
        req.on("end", () => {
          const message = JSON.parse(Buffer.concat(buffer).toString("utf-8"));

          // Sometimes here we get an empty interpretation meaning possibly saw
          // nothing. We could ignore those but then often noise gets interpreted
          // as of/is/etc.
          const transcripts = message.interpretations.map((option) => {
            return option.join(wordSeperator);
          });

          // Dragon joins some phrases, seperate them out here
          const dragonReplace = {
            downright: ["down", "right"],
            lineup: ["line", "up"],
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

interface DecodeResult {
  commands: CommandResult[];
  mode: Set<string>;
  modeString: string;
}

async function decodeTranscripts(
  ctx: ExecutionContext,
  transcripts: string[]
): Promise<DecodeResult> {
  let mode: Set<string> = await machine.fetchCurrentMode(ctx);

  let firstError = null;

  const modeString = Array.from(mode).sort().join(" ");

  const commands: Array<CommandResult> = transcripts
    .map((transcript, idx) => {
      const N = idx + 1;
      try {
        const command = parser.parse(transcript, mode);
        const rendered = command ? command.render() : "null";
        const priority = command ? JSON.stringify(command.priority) : null;
        return { N, command, rendered, priority, transcript };
      } catch (err) {
        firstError = firstError || err.toString();
        return {
          N,
          command: null,
          rendered: "null",
          priority: null,
          transcript,
        };
      }
    })
    .sort((a, b) => {
      if (a.command && b.command) {
        return a.command.compareTo(b.command);
      } else {
        return a.command ? -1 : +1;
      }
    });

  if (firstError) {
    renderer.parseError(firstError);
  }
  return { commands, mode, modeString };
}

async function executeTranscripts(
  transcripts: string[],
  props: {
    partial?: boolean;
    noopReason?: string;
  } = {}
) {
  const ctx = new ExecutionContext(renderer, machine);

  let decoded: DecodeResult;

  try {
    decoded = await decodeTranscripts(ctx, transcripts);
  } catch (err) {
    ctx.error(err);
    return;
  }

  const { commands, mode, modeString } = decoded;

  let noopReason: string | null = props.noopReason ?? null;

  if (noopReason === null && options["--noop"]) {
    noopReason = "cmd";
  }

  let execCommand = null;
  if (commands.length && commands[0].command) {
    execCommand = commands.shift();

    if (props.partial) {
      noopReason = "partial";
    } else if (machine.sleep && !execCommand.command.enabledDuringSleep) {
      noopReason = "sleep";
    } else if (
      mode.has("screensaver") &&
      !execCommand.command.enabledDuringScreensaver
    ) {
      noopReason = "screensaver";
    }
  }

  const renderParams: RenderOpt = {
    execCommand,
    skipCommands: commands,
    modeString,
    noopReason,
    record: machine.record,
    running: false,
  };

  if (!noopReason && execCommand) {
    renderParams.running = true;
    renderer.render({ ...renderParams });
    const startExec = process.hrtime.bigint();
    await machine.executeCommand(ctx, execCommand.command).catch((err) => {
      renderer.commandError(err, execCommand);
    });
    const execTimeNanos = Number(process.hrtime.bigint() - startExec);
    renderParams.running = false;
    renderParams.runTimeMs = execTimeNanos / 1_000_000;
  }

  if (sampleLog && machine.record && (execCommand || transcripts.length)) {
    sampleLog.append({
      modeString,
      transcript: execCommand ? execCommand.transcript : transcripts[0],
      result: execCommand ? execCommand.rendered : "null",
    });
  }

  renderer.render(renderParams);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err.stack);
    process.exit(1);
  }
);
