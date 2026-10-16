/** Restricted arithmetic/boolean interpreter for vendor G-code placeholders. No eval. */
export type TemplateValue = number | string | boolean | TemplateValue[];
export type TemplateContext = Record<string, TemplateValue>;
export function expression(
  source: string,
  context: TemplateContext,
): TemplateValue {
  const tokens: string[] = [];
  const pattern =
    /\s*("(?:[^"\\]|\\.)*"|'[^']*'|\d+(?:\.\d*)?|\.\d+|[A-Za-z_]\w*|==|!=|<=|>=|&&|\|\||[+*/%<>!()[\],?:-])/gy;
  let cursor = 0;
  while (cursor < source.trimEnd().length) {
    pattern.lastIndex = cursor;
    const match = pattern.exec(source);
    if (!match) throw new Error(`Unsupported template expression: ${source}`);
    tokens.push(match[1]);
    cursor = pattern.lastIndex;
  }
  let index = 0;
  const take = (expected?: string) => {
    const value = tokens[index++];
    if (expected && value !== expected)
      throw new Error(`Expected ${expected} in ${source}`);
    return value;
  };
  const number = (value: TemplateValue) => {
    if (typeof value !== "number" || !Number.isFinite(value))
      throw new Error(`Expected a finite number in ${source}`);
    return value;
  };
  const primary = (): TemplateValue => {
    const token = take();
    if (token === "(") {
      const value = ternary();
      take(")");
      return value;
    }
    if (token === "!" || token === "not") return !primary();
    if (token === "-") return -number(primary());
    if (token === "+") return number(primary());
    if (/^\d|^\.\d/.test(token ?? "")) return Number(token);
    if (token?.startsWith('"')) return JSON.parse(token);
    if (token?.startsWith("'")) return token.slice(1, -1);
    if (token === "true" || token === "false") return token === "true";
    if (
      (token === "min" ||
        token === "max" ||
        token === "floor" ||
        token === "ceil" ||
        token === "round" ||
        token === "abs") &&
      tokens[index] === "("
    ) {
      take("(");
      const values = [number(ternary())];
      while (tokens[index] === ",") {
        take(",");
        values.push(number(ternary()));
      }
      take(")");
      const functions: Record<string, (...n: number[]) => number> = {
        min: Math.min,
        max: Math.max,
        floor: Math.floor,
        ceil: Math.ceil,
        round: Math.round,
        abs: Math.abs,
      };
      return functions[token](...values);
    }
    if (!Object.hasOwn(context, token ?? ""))
      throw new Error(`Unknown printer template variable: ${token}`);
    let value = context[token];
    while (tokens[index] === "[") {
      take("[");
      const offset = number(ternary());
      take("]");
      if (
        !Array.isArray(value) ||
        !Number.isInteger(offset) ||
        offset < 0 ||
        offset >= value.length
      )
        throw new Error(`Invalid template array index: ${token}[${offset}]`);
      value = value[offset];
    }
    return value;
  };
  const levels = [
    ["or", "||"],
    ["and", "&&"],
    ["==", "!="],
    ["<", "<=", ">", ">="],
    ["+", "-"],
    ["*", "/", "%"],
  ];
  const binary = (level: number): TemplateValue => {
    if (level === levels.length) return primary();
    let left = binary(level + 1);
    while (levels[level].includes(tokens[index])) {
      const op = take(),
        right = binary(level + 1);
      switch (op) {
        case "or":
        case "||":
          left = Boolean(left) || Boolean(right);
          break;
        case "and":
        case "&&":
          left = Boolean(left) && Boolean(right);
          break;
        case "==":
          left = left === right;
          break;
        case "!=":
          left = left !== right;
          break;
        case "<":
          left = number(left) < number(right);
          break;
        case "<=":
          left = number(left) <= number(right);
          break;
        case ">":
          left = number(left) > number(right);
          break;
        case ">=":
          left = number(left) >= number(right);
          break;
        case "+":
          left = number(left) + number(right);
          break;
        case "-":
          left = number(left) - number(right);
          break;
        case "*":
          left = number(left) * number(right);
          break;
        case "/":
          left = number(left) / number(right);
          break;
        case "%":
          left = number(left) % number(right);
          break;
      }
    }
    return left;
  };
  const ternary = (): TemplateValue => {
    const condition = binary(0);
    if (tokens[index] !== "?") return condition;
    take("?");
    const yes = ternary();
    take(":");
    const no = ternary();
    return condition ? yes : no;
  };
  const result = ternary();
  if (index !== tokens.length)
    throw new Error(`Unexpected token in printer template: ${tokens[index]}`);
  if (typeof result === "number" && !Number.isFinite(result))
    throw new Error("Non-finite printer template result.");
  return result;
}
export function renderGcodeTemplate(
  template: string,
  context: TemplateContext,
): string {
  const stack: { parent: boolean; hit: boolean; active: boolean }[] = [];
  let active = true,
    output = "";
  // Some vendor JSON files encode literal backslash-newlines a second time.
  template = template.replace(/\\n/g, "\n").replace(/\\"/g, '"');
  for (const token of template.split(/(\{[^{}]*\})/g)) {
    if (token.startsWith("{")) {
      const value = token.slice(1, -1).trim();
      if (value.startsWith("if ")) {
        const matched: boolean =
          active && Boolean(expression(value.slice(3), context));
        stack.push({ parent: active, hit: matched, active: matched });
        active = matched;
      } else if (value.startsWith("elsif ") || value === "else") {
        const frame = stack.at(-1);
        if (!frame) throw new Error("Unmatched printer template branch.");
        frame.active =
          frame.parent &&
          !frame.hit &&
          (value === "else" || Boolean(expression(value.slice(6), context)));
        frame.hit ||= frame.active;
        active = frame.active;
      } else if (value === "endif") {
        const frame = stack.pop();
        if (!frame) throw new Error("Unmatched printer template endif.");
        active = frame.parent;
      } else if (active) {
        const result = expression(value, context);
        if (Array.isArray(result))
          throw new Error(`Missing array index in template: ${value}`);
        output +=
          typeof result === "number"
            ? String(Number(result.toFixed(5)))
            : String(result);
      }
    } else if (active) {
      output += token
        .replace(
          /\[([A-Za-z_]\w*)\[([^\[\]]+)\]\]/g,
          (_, name: string, offset: string) =>
            String(expression(`${name}[${offset}]`, context)),
        )
        .replace(/\[([A-Za-z_]\w*)\]/g, (_, name: string) => {
          if (!Object.hasOwn(context, name))
            throw new Error(`Unknown printer template variable: ${name}`);
          const result = context[name];
          return String(
            Array.isArray(result)
              ? result[Number(context.initial_extruder ?? 0)]
              : result,
          );
        });
    }
  }
  if (stack.length) throw new Error("Unclosed condition in printer template.");
  return output;
}
