'use strict';

const i3 = require('i3').createClient();
const robot = require('robotjs');

function lowerKey(key) {
  const map = '+=!1@2#3$4%5^6&7*8(9)0_-?/|\ZzV{[}]><~`';
  const index = map.indexOf(key);
  if (index >= 0 && index % 2 === 0) {
    return map.charAt(index + 1);
  } else {
    return key.toLowerCase();
  }
}

function executeCommand(command) {
  const handlers = {
    i3(props) {
      const {command} = props;
      i3.command(command);
    },
    multi(props) {
      for (let command of props.commands) {
        executeCommand(command);
      }
    },
    repeat(props) {
      for (let i = 0; i < props.count; i++) {
        executeCommand(props.command);
      }
    },
    key(props) {
      let split = props.key.split('-');
      let key = split.pop();
      key = {
        underscore: '_',
      }[key] || key;

      const modifiers = split.map(modifier => ({
        ctrl: 'control',
      }[modifier] || modifier));

      const lower = lowerKey(key);
      if (lower !== key) {
        key = lower;
        modifiers.push('shift');
      }

      robot.keyTap(key, modifiers);
    },
    type(props) {
      robot.typeString(props.string);
    },
    noop() {}
  };

  const {handler} = command;
  handlers[handler](command);
}

class Commander {
  constructor(log) {
    [
      'workspace',
      'output',
      'mode',
      'window',
      'barconfig_update',
      'binding',
    ].forEach(event => {
      i3.on(event, details => {
        log.debug({
          details: details,
        }, 'i3 %s', event);
      });
    });
  }

  execute(command) {
    return executeCommand(command);
  }
}

module.exports = Commander;
