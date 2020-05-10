import { FSM } from '../src/parse/FSM';

const fsm = new FSM();

const hello = fsm.root.edge('hello');
hello.edge('', fsm.final);
hello.edge('world', fsm.final);

fsm.print();