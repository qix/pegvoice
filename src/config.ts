import * as expandHomeDir from "expand-home-dir";
import * as path from "path";

export class ConfigClass {
  private static _instance: ConfigClass = null;

  static getInstance(): ConfigClass {
    if (!ConfigClass._instance) {
      ConfigClass._instance = new ConfigClass();
    }
    return ConfigClass._instance;
  }

  _macroPath: string;
  set macroPath(path: string) {
    this._macroPath = expandHomeDir(path);
  }

  getMacroPath(name) {
    return path.join(this._macroPath, name);
  }
}

export const Config = ConfigClass.getInstance();
