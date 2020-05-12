import { Machine } from "../Machine";
import { Renderer } from "../render/Renderer";

export class ExecutionContext {
  constructor(private renderer: Renderer, readonly machine: Machine) {}

  error(err: Error) {
    this.renderer.commandError(err);
  }
}
