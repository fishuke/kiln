/**
 * A small, side-effect-free expression language for skip_if, decision policies and gate rules.
 * Grammar: or / and / not, comparisons (== != > >= < <=), `in` / `not in` against list literals,
 * dotted identifiers, numbers, quoted strings, true / false, and parentheses.
 */

export type Expr =
  | { kind: "lit"; value: unknown }
  | { kind: "ref"; path: string[] }
  | { kind: "list"; items: Expr[] }
  | { kind: "not"; expr: Expr }
  | { kind: "bin"; op: BinOp; left: Expr; right: Expr };

type BinOp = "or" | "and" | "==" | "!=" | ">" | ">=" | "<" | "<=" | "in" | "not in";

type Token = { type: "num" | "str" | "id" | "op" | "punct"; value: string; pos: number };

export class ExprError extends Error {
  constructor(
    message: string,
    readonly pos: number,
  ) {
    super(message);
  }
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^[0-9]*\.?[0-9]+/.exec(src.slice(i))!;
      tokens.push({ type: "num", value: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    if (c === "'" || c === '"') {
      const end = src.indexOf(c, i + 1);
      if (end < 0) throw new ExprError("unterminated string", i);
      tokens.push({ type: "str", value: src.slice(i + 1, end), pos: i });
      i = end + 1;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_.-]*/.exec(src.slice(i))!;
      tokens.push({ type: "id", value: m[0], pos: i });
      i += m[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if ([">=", "<=", "==", "!="].includes(two)) {
      tokens.push({ type: "op", value: two, pos: i });
      i += 2;
      continue;
    }
    if (c === ">" || c === "<") {
      tokens.push({ type: "op", value: c, pos: i });
      i++;
      continue;
    }
    if ("()[],".includes(c)) {
      tokens.push({ type: "punct", value: c, pos: i });
      i++;
      continue;
    }
    throw new ExprError(`unexpected character '${c}'`, i);
  }
  return tokens;
}

export function parseExpr(src: string): Expr {
  const tokens = tokenize(src);
  let p = 0;
  const peek = () => tokens[p];
  const isWord = (w: string) => peek()?.type === "id" && peek()!.value === w;
  const expect = (value: string) => {
    const t = tokens[p];
    if (!t || t.value !== value) throw new ExprError(`expected '${value}'`, t?.pos ?? src.length);
    p++;
  };

  function or(): Expr {
    let left = and();
    while (isWord("or")) {
      p++;
      left = { kind: "bin", op: "or", left, right: and() };
    }
    return left;
  }
  function and(): Expr {
    let left = not();
    while (isWord("and")) {
      p++;
      left = { kind: "bin", op: "and", left, right: not() };
    }
    return left;
  }
  function not(): Expr {
    if (isWord("not")) {
      p++;
      return { kind: "not", expr: not() };
    }
    return comparison();
  }
  function comparison(): Expr {
    const left = primary();
    const t = peek();
    if (t?.type === "op") {
      p++;
      return { kind: "bin", op: t.value as BinOp, left, right: primary() };
    }
    if (isWord("in")) {
      p++;
      return { kind: "bin", op: "in", left, right: primary() };
    }
    if (isWord("not") && tokens[p + 1]?.value === "in") {
      p += 2;
      return { kind: "bin", op: "not in", left, right: primary() };
    }
    return left;
  }
  function primary(): Expr {
    const t = tokens[p];
    if (!t) throw new ExprError("unexpected end of expression", src.length);
    if (t.value === "(" && t.type === "punct") {
      p++;
      const e = or();
      expect(")");
      return e;
    }
    if (t.value === "[" && t.type === "punct") {
      p++;
      const items: Expr[] = [];
      while (peek() && peek()!.value !== "]") {
        items.push(primary());
        if (peek()?.value === ",") p++;
      }
      expect("]");
      return { kind: "list", items };
    }
    p++;
    if (t.type === "num") return { kind: "lit", value: Number(t.value) };
    if (t.type === "str") return { kind: "lit", value: t.value };
    if (t.type === "id") {
      if (t.value === "true") return { kind: "lit", value: true };
      if (t.value === "false") return { kind: "lit", value: false };
      if (["and", "or", "not", "in"].includes(t.value)) throw new ExprError(`unexpected '${t.value}'`, t.pos);
      return { kind: "ref", path: t.value.split(".") };
    }
    throw new ExprError(`unexpected '${t.value}'`, t.pos);
  }

  const expr = or();
  if (p < tokens.length) throw new ExprError(`unexpected '${tokens[p]!.value}'`, tokens[p]!.pos);
  return expr;
}

export function refsOf(expr: Expr): string[] {
  switch (expr.kind) {
    case "ref":
      return [expr.path.join(".")];
    case "list":
      return expr.items.flatMap(refsOf);
    case "not":
      return refsOf(expr.expr);
    case "bin":
      return [...refsOf(expr.left), ...refsOf(expr.right)];
    default:
      return [];
  }
}

function lookup(ctx: unknown, path: string[]): unknown {
  let cur: unknown = ctx;
  for (const key of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

export function evaluate(expr: Expr, ctx: Record<string, unknown>): unknown {
  switch (expr.kind) {
    case "lit":
      return expr.value;
    case "ref":
      return lookup(ctx, expr.path);
    case "list":
      return expr.items.map((i) => evaluate(i, ctx));
    case "not":
      return !evaluate(expr.expr, ctx);
    case "bin": {
      if (expr.op === "or") return Boolean(evaluate(expr.left, ctx)) || Boolean(evaluate(expr.right, ctx));
      if (expr.op === "and") return Boolean(evaluate(expr.left, ctx)) && Boolean(evaluate(expr.right, ctx));
      const l = evaluate(expr.left, ctx);
      const r = evaluate(expr.right, ctx);
      switch (expr.op) {
        case "==":
          return l === r;
        case "!=":
          return l !== r;
        case ">":
          return typeof l === "number" && typeof r === "number" && l > r;
        case ">=":
          return typeof l === "number" && typeof r === "number" && l >= r;
        case "<":
          return typeof l === "number" && typeof r === "number" && l < r;
        case "<=":
          return typeof l === "number" && typeof r === "number" && l <= r;
        case "in":
          return Array.isArray(r) && r.includes(l);
        case "not in":
          return Array.isArray(r) && !r.includes(l);
      }
    }
  }
}

export function evalBool(src: string, ctx: Record<string, unknown>): boolean {
  return Boolean(evaluate(parseExpr(src), ctx));
}
