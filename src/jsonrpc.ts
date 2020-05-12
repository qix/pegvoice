import * as child_process from "child_process";
import { Readable, Writable } from "stream";
import EventEmitter = require("events");

export class JsonRpc extends EventEmitter {
  private buffer: string = "";
  constructor(private stdout: Readable, private stdin: Writable) {
    super();

    stdout.setEncoding("utf-8");
    this.stdout.on("data", (data) => {
      if (typeof data !== "string") {
        throw new Error("Expected string data");
      }

      let nl = data.indexOf("\n");
      while (nl >= 0) {
        const line = this.buffer + data.substring(0, nl);

        try {
          const message = JSON.parse(line);
          this.emit("message", message);
        } catch (err) {
          console.error("Error: Could not parse input: " + err.toString());
        }

        data = data.substring(nl + 1);
        nl = data.indexOf("\n");
      }
      this.buffer += data;
    });
  }

  static spawn(
    command: string,
    args: string[] = [],
    options: {
      spawnOptions?: child_process.SpawnOptions;
      childStderr?: "ignore" | "inherit";
    } = {}
  ) {
    const proc = child_process.spawn(command, args, {
      ...(options.spawnOptions || {}),
      stdio: ["pipe", "pipe", options.childStderr ?? "inherit"],
    });
    return new JsonRpc(proc.stdout, proc.stdin);
  }

  on(
    event: "message",
    callback: (message: { method: string; params: any }) => void
  );
  on(event: string, callback: (...args: any[]) => void) {
    super.on(event, callback);
  }

  send(method: string, params: { [key: string]: any }) {
    this.stdin.write(
      JSON.stringify({
        method,
        params,
      }) + "\n"
    );
  }
}
