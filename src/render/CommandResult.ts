import { Command } from "../commands";

export default interface CommandResult {
  N: number;
  command: Command | null;
  rendered: string;
  transcript: string;

  /* String serialized of command priority list */
  priority: string | null;
}
