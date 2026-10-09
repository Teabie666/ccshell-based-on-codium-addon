/**
 * Context keys and `when` clauses, a subset of VS Code's:
 *   key            truthy
 *   !key           falsy
 *   key == value   equality (value: 'quoted', bare word, number, true/false)
 *   key != value
 *   a && b, a || b, ( ... )
 */

import { Emitter, type Event } from '../platform/event';

export class ContextKeyService {
  private readonly values = new Map<string, unknown>();
  private readonly changeEmitter = new Emitter<string>();
  readonly onDidChange: Event<string> = this.changeEmitter.event;

  set(key: string, value: unknown): void {
    if (this.values.get(key) === value) {
      return;
    }
    if (value === undefined) {
      this.values.delete(key);
    } else {
      this.values.set(key, value);
    }
    this.changeEmitter.fire(key);
  }

  get(key: string): unknown {
    return this.values.get(key);
  }

  evaluate(expression: string | undefined): boolean {
    return evaluateWhen(expression, (key) => this.values.get(key));
  }
}

type Token = { kind: 'op'; value: string } | { kind: 'word'; value: string };

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  // Sticky: every token must start exactly where the previous one ended (after spaces).
  const pattern = /\s*(?:(&&|\|\||==|!=|!|\(|\))|('[^']*'|"[^"]*"|[^\s!=&|()'"]+))/y;
  let index = 0;
  while (expression.slice(index).trim() !== '') {
    pattern.lastIndex = index;
    const match = pattern.exec(expression);
    if (!match) {
      throw new Error(`cannot parse when clause at ${index}: ${expression}`);
    }
    tokens.push(match[1] !== undefined ? { kind: 'op', value: match[1] } : { kind: 'word', value: match[2]! });
    index = pattern.lastIndex;
  }
  return tokens;
}

function literal(word: string): unknown {
  if (/^'.*'$|^".*"$/.test(word)) {
    return word.slice(1, -1);
  }
  if (word === 'true') return true;
  if (word === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(word)) return Number(word);
  return word;
}

/** Evaluates a when clause; an empty or missing clause is true. */
export function evaluateWhen(expression: string | undefined, lookup: (key: string) => unknown): boolean {
  if (!expression || expression.trim() === '') {
    return true;
  }
  const tokens = tokenize(expression);
  let position = 0;
  const peek = (): Token | undefined => tokens[position];
  const take = (): Token | undefined => tokens[position++];

  const parseOr = (): boolean => {
    let value = parseAnd();
    while (peek()?.value === '||' && peek()?.kind === 'op') {
      take();
      const right = parseAnd();
      value = value || right;
    }
    return value;
  };
  const parseAnd = (): boolean => {
    let value = parseUnary();
    while (peek()?.value === '&&' && peek()?.kind === 'op') {
      take();
      const right = parseUnary();
      value = value && right;
    }
    return value;
  };
  const parseUnary = (): boolean => {
    const token = peek();
    if (token?.kind === 'op' && token.value === '!') {
      take();
      return !parseUnary();
    }
    if (token?.kind === 'op' && token.value === '(') {
      take();
      const value = parseOr();
      if (take()?.value !== ')') {
        throw new Error(`missing ) in when clause: ${expression}`);
      }
      return value;
    }
    return parseComparison();
  };
  const parseComparison = (): boolean => {
    const key = take();
    if (key?.kind !== 'word') {
      throw new Error(`expected a context key in when clause: ${expression}`);
    }
    const operator = peek();
    if (operator?.kind === 'op' && (operator.value === '==' || operator.value === '!=')) {
      take();
      const right = take();
      if (right?.kind !== 'word') {
        throw new Error(`expected a value after ${operator.value} in when clause: ${expression}`);
      }
      const equal = lookup(key.value) === literal(right.value);
      return operator.value === '==' ? equal : !equal;
    }
    return Boolean(lookup(key.value));
  };

  const result = parseOr();
  if (position < tokens.length) {
    throw new Error(`unexpected token in when clause: ${expression}`);
  }
  return result;
}
