"use strict";

import { Parser } from "./parse/Parser";

const parser = new Parser(null, "test");

function key(name) {
  return { handler: "key", key: name };
}
function multi(...commands) {
  return { handler: "multi", commands };
}

test("adds 1 + 2 to equal 3", () => {
  expect(parser.parse("type · h\\spelling-letter\\H")).toEqual(
    key("underscore")
  );
  //expect(parser.parse('type _\\underscore\\underscore')).toEqual(key('underscore'));
  //expect(parser.parse('type five')).toEqual(key('5'));
  //expect(parser.parse('type P\\uppercase-letter\\capital P')).toEqual(key('P'));
});
