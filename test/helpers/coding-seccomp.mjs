import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

// Load the actual compiled production filter. Instrument export visibility and
// relative import resolution only; do not substitute its bytecode or rules.
export async function compiledRecipeFilter(architecture) {
  const moduleUrl = new URL("../../dist/coding-resource/recipe-sandbox.js", import.meta.url);
  const source = (await readFile(moduleUrl, "utf8")).replace(/from\s+(["'])(\.{1,2}\/[^"']+)\1/g, (_, quote, path) => `from ${quote}${new URL(path, moduleUrl).href}${quote}`);
  const actual = await import(`data:text/javascript;base64,${Buffer.from(source + "\nexport {linuxRecipeFilter};\n").toString("base64")}`);
  const descriptor = Object.getOwnPropertyDescriptor(process, "arch");
  try {Object.defineProperty(process, "arch", {...descriptor, value: architecture}); return actual.linuxRecipeFilter();}
  finally {Object.defineProperty(process, "arch", descriptor);}
}

// Independent classic BPF instruction evaluator over a seccomp_data record.
// Opcode semantics are generic; the policy assertions live in the test.
export function evaluateClassicBpf(filter, {arch, nr, argument0 = 0}) {
  assert.equal(filter.length % 8, 0);
  const data = Buffer.alloc(64); data.writeUInt32LE(nr >>> 0, 0); data.writeUInt32LE(arch >>> 0, 4); data.writeBigUInt64LE(BigInt(argument0), 16);
  let accumulator = 0;
  for (let pc = 0, steps = 0; pc < filter.length / 8 && steps < filter.length; steps++) {
    const offset = pc * 8; const opcode = filter.readUInt16LE(offset); const yes = filter[offset + 2]; const no = filter[offset + 3]; const constant = filter.readUInt32LE(offset + 4);
    switch (opcode) {
      case 0x20: accumulator = data.readUInt32LE(constant); pc++; break;
      case 0x54: accumulator = (accumulator & constant) >>> 0; pc++; break;
      case 0x15: pc += 1 + (accumulator === constant ? yes : no); break;
      case 0x45: pc += 1 + ((accumulator & constant) !== 0 ? yes : no); break;
      case 0x06: return constant;
      default: assert.fail(`Unsupported classic BPF opcode ${opcode}`);
    }
  }
  assert.fail("Classic BPF did not reach a return action");
}
