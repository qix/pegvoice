import CommandResult from "./CommandResult";

export abstract class Renderer {
  abstract parseError(message: string);
  abstract grammarError(err: Error);
}

export interface RenderOpt {
  modeString: string
  execCommand: CommandResult
  skipCommands: CommandResult[],
  noopReason: string
  record: boolean
  running: boolean
}