'use strict';

function renderKeys(keys) {
  const escaped = [
    '"', "'",
  ];

  let string = '';
  let rv = '';
  const closeString = () => {
    if (string) {
      rv += (rv ? ' ' : '') + `"${string}"`;
      string = '';
    }
  };
  const addLarge = (key) => {
    closeString();
    rv += (rv ? ' ' : '') + `<${key}>`;
  };

  for (let key of keys) {
    if (key.length > 1 || escaped.includes(key)) {
      addLarge(key);
    } else {
      string += key;
    }
  }
  closeString();
  return rv;
}

function flattenCommands(commands) {
  let rv = [];
  for (let command of commands) {
    if (command.handler === 'multi') {
      rv.push(...flattenCommands(command.commands));
    } else {
      rv.push(command);
    }
  }
  return rv;
}

function renderMulti(commands) {
  const cmdList = flattenCommands(commands);
  const keys = [];

  while (cmdList.length && cmdList[0].handler === 'key') {
    keys.push(cmdList.shift().key);
  }

  let first;
  if (keys.length) {
    first = renderKeys(keys);
  } else {
    first = renderCommand(cmdList.shift());
  }

  if (!cmdList.length) {
    return first;
  } else {
    return `${first} ${renderMulti(cmdList)}`;
  }
}
function renderCommand(command) {
  if (command.handler === 'key') {
    return renderKeys([command.key]);
  } else if (command.handler === 'repeat') {
    return `[repeat ${command.count} ${renderCommand(command.command)}]`;
  } else if (command.handler === 'multi') {
    return renderMulti(command.commands);
  }
  return JSON.stringify(command);
}

module.exports = renderCommand;
