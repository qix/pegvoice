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

function renderCommand(command) {
  if (command.handler === 'key') {
    return renderKeys([command.key]);
  } else if (command.handler === 'multi') {
    const cmdList = flattenCommands(command.commands);
    console.log('SAW', cmdList);
    const allSame = cmdList.every(cmd => {
      return cmd.handler === cmdList[0].handler;
    });
    if (allSame && cmdList[0].handler === 'key') {
      return renderKeys(cmdList.map(cmd => cmd.key));
    }

  }
  return JSON.stringify(command);
}

module.exports = renderCommand;
