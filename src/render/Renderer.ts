import CommandResult from "./CommandResult";

export abstract class Renderer {
  abstract commandError(
    err: Error,
    opt?: {
      command?: CommandResult;
    }
  );
  abstract parseError(err: Error);
  abstract grammarError(err: Error);
  abstract message(format: string, ...args: any[]);
  abstract render(options: RenderOpt);
  abstract parseStep(message: string);
  abstract grammarChanged();
  abstract error(err: Error);

  reset() {}
}

export interface RenderOpt {
  modeString: string;
  execCommand: CommandResult;
  skipCommands: CommandResult[];
  noopReason: string;
  record: boolean;
  running: boolean;
  runTimeMs?: number;
}
