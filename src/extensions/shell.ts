import { Machine } from "../Machine";

import { quote } from "shell-quote";

export function activate(machine: Machine) {
  return { quote: str => quote([str]) };
}
