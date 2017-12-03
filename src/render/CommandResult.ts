import { Command } from "../commands";

export default interface CommandResult {
  N: number;
  command: Command | null;
  rendered: string;
  priority: number | null;
  transcript: string;
};
