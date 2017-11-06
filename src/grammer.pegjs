{
  function i3(command) {
    return {
      handler: 'i3',
      command,
    };
  }
}

start = 
  i3 /
  screen /
  window /
  keyCommand /
  typeCommand /
  theCommand

theCommand = "the" _ command:start {
  return command;
i}

i3 = "i three" _ "screen" _ screen:i3screen { 
  return i3(`workspace ${screen}`);
}

keyCommand = key _ key:keyName {
  return { handler: 'key', key };
};

typeCommand = "type" _ letters:(.*) {
  return {
    handler: 'type',
    string: letters.join(''),
  };
};

key "key" = "key" / "he"

keyName "<key>" = name:(
  "enter" /
  "escape" /
  "escaped" /
  "inter" /
  "into" /
  "back space" /
  "backspace" /
  "that space" /
  "up" /
  "down" /
  "left" /
  "right" /
  "i" /
  digit

) {
  return {
    escaped: 'escape',
    inter: 'enter',
    into: 'enter',
    'back space': 'backspace',
    'that space': 'backspace',
  }[name] || name;
}


window = "window" _ direction:direction {
  return i3(`focus ${direction}`);
}

screen = "screen" _ screen:i3screen {
  return i3(`workspace ${screen}`);
}
 

i3screen = number;

direction = ("up" / "down" / "left" / "right" )

number = digit

digit = word:(
  "one" / "two" / "three" / "four" / "five" /
  "six" / "seven" / "eight" / "nine"
) {
  return {
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
  }[word];
}

_ "whitespace" = [ \t\n\r]

