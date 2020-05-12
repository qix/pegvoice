let nextId = 1;

export class Node {
  readonly edges: Array<{
    word: string;
    node: Node;
  }> = [];

  constructor(readonly fsm: FSM, readonly id: number, readonly name: string) {}

  edge(word: string, node?: Node) {
    // Short-circuit empty links to ourself
    if (word === "" && node === this) {
      return this;
    }

    node = node ?? this.fsm.node();
    this.edges.push({
      word,
      node,
    });
    return node;
  }

  private recurseAddNode(
    remote: Node,
    nodeMap: WeakMap<Node, Node>,
    recursed: Set<Node>
  ) {
    remote.edges.forEach((edge) => {
      if (!nodeMap.has(edge.node)) {
        nodeMap.set(edge.node, this.fsm.node());
      }
      const local = nodeMap.get(edge.node);
      this.edge(edge.word, local);

      if (!recursed.has(edge.node)) {
        recursed.add(edge.node);
        local.recurseAddNode(edge.node, nodeMap, recursed);
      }
    });
  }

  addFSM(fsm: FSM, final: Node) {
    const nodeMap = new WeakMap<Node, Node>();
    nodeMap.set(fsm.root, this);
    nodeMap.set(fsm.final, final);
    const recursed = new Set<Node>([fsm.root]);
    this.recurseAddNode(fsm.root, nodeMap, recursed);
  }
}
export class FSM {
  private nodes: Node[] = [];
  readonly root = this.node("#root");
  readonly final = this.node("#end");

  readonly subFSM = new WeakMap<
    FSM,
    {
      start: Node;
      final: Node;
    }
  >();

  node(name?: string) {
    const node = new Node(this, this.nodes.length, name || `#${nextId++}`);
    this.nodes.push(node);
    return node;
  }

  lines(line: (str: string) => void) {
    const visited = new Set();
    const recurse = (prefix: string, node: Node, prev = []) => {
      prefix += `<${node.name}>`;
      if (visited.has(node)) {
        line(prefix + " @repeat");
        return;
      } else {
        visited.add(node);
      }

      const seen = [...prev, node];

      if (node.edges.length) {
        node.edges.forEach((edge) => {
          const seenIndex = seen.indexOf(edge.node);
          if (seenIndex >= 0) {
            line(`${prefix} =(${edge.word})> {recurse-${seenIndex}}`);
          } else {
            recurse(`${prefix} =(${edge.word})> `, edge.node, seen);
          }
          prefix = " ".repeat(prefix.length);
        });
      } else {
        line(prefix);
      }
    };
    recurse("", this.root);
  }

  text() {
    const rv = [];
    this.lines((line) => rv.push(line));
    return rv.join("\n") + "\n";
  }
  print() {
    this.lines((line) => console.log(line));
  }

  dump() {
    const edges = [];
    this.nodes.forEach((node, from) => {
      node.edges.forEach((edge) => {
        edges.push({
          from,
          to: this.nodes.indexOf(edge.node),
          word: edge.word,
        });
      });
    });

    return {
      edges,
      nodes: this.nodes.map((node) => ({
        name: node.name,
      })),
    };
  }

  renderDot() {
    const rv: string[] = [];

    this.nodes.forEach((node, index) => {
      rv.push(`n${index} [label=${JSON.stringify(node.name)}]`);
    });
    this.nodes.forEach((node, from) => {
      node.edges.forEach((edge) => {
        const to = this.nodes.indexOf(edge.node);
        rv.push(`n${from} -> n${to} [label=${JSON.stringify(edge.word)}]`);
      });
    });

    return "digraph g {\n" + rv.join("\n") + "\n}\n";
  }
}
