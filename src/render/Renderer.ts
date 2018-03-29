export abstract class Renderer {
  abstract parseError(message: string);
  abstract grammarError(err: Error);
}
