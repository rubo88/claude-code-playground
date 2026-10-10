// Haiku's plain-language note on a replay step: asked for only when the
// replay opens or moves, drawn under the diff, and left out when it fails.
import { test, expect } from 'claude-code/testing';

const usage = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const pane = { title: 'Replay Theater', isFocused: true, bodyColumns: 58, placement: 'dock', scroll: {}, view: {} } as any;

// The world beneath the mod, and a count of the model calls it makes.
function world(on: any, answer: (e: any) => unknown) {
  const seen = { calls: 0, prompts: [] as string[] };
  on('session.cwd', () => ({ value: '/tmp/project' }));
  on('clock.sleep', () => ({ value: undefined }));
  on('ui.open', () => ({ value: { isPlaced: true } }));
  on('ui.close', () => ({ value: undefined }));
  on('ui.invalidate', () => ({ value: undefined }));
  on('model.complete', (_$: unknown, e: any) => {
    seen.calls += 1;
    seen.prompts.push(e.prompt);
    return { value: answer(e) };
  });
  on('tool.call', () => ({ result: { filePath: '/tmp/project/a.py' } }));
  on('turn.start', (_$: unknown, e: any) => ({ turnId: e.turnId }));
  on('turn.complete', () => ({ text: '' }));
  on('command.run', () => ({}));
  return seen;
}

// One turn with three edits, then /replay.
async function playTurn($: any) {
  await $.turn.start({ text: 'arregla el saludo', turnId: 't1' });
  await $.tool.call({ tool: 'Edit', file_path: '/tmp/project/a.py', old_string: 'print("hola")', new_string: 'print("hola, mundo")' });
  await $.tool.call({ tool: 'Edit', file_path: '/tmp/project/b.py', old_string: 'x = 1', new_string: 'x = 2' });
  await $.tool.call({ tool: 'Edit', file_path: '/tmp/project/c.py', old_string: 'y = 1', new_string: 'y = 3' });
  await $.turn.complete({ reason: 'end_turn', turnId: 't1', answer: '' });
  await $.command.run({ command: 'replay', args: '' });
}

async function drawn($: any): Promise<string> {
  return JSON.stringify(await $.ui.render({ surface: 'terminal', component: 'Pane', requestId: 'replay-theater', props: pane }));
}

async function until($: any, check: (text: string) => boolean): Promise<string> {
  for (let i = 0; i < 200; i += 1) {
    const text = await drawn($).catch(() => '');
    if (check(text)) return text;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`never drawn: ${await drawn($).catch((e) => String(e))}`);
}

test('no model call until the replay opens; then the step and the next one', { timeoutMs: 10000 }, async ($, on) => {
  const seen = world(on, (e) => ({ isAnswered: true, text: e.prompt.includes('a.py') ? 'Cambia el saludo para que diga "hola, mundo".' : 'Cambia un valor.', usage }));
  await $.turn.start({ text: 'x', turnId: 't0' } as any);
  await $.tool.call({ tool: 'Edit', file_path: '/tmp/project/z.py', old_string: 'a', new_string: 'b' } as any);
  await $.turn.complete({ reason: 'end_turn', turnId: 't0', answer: '' } as any);
  expect(seen.calls).toBe(0);

  await playTurn($);
  const text = await until($, (t) => t.includes('hola, mundo\\".'));
  expect(text).toContain('En pocas palabras');
  expect(seen.calls).toBe(2); // step 1 and step 2, not step 3
  expect(seen.prompts[0]).toContain('+ print("hola, mundo")');

  await $.ui.press({ plugin: 'replay-theater', key: 'next' } as any);
  expect(seen.calls).toBe(3); // step 3 prefetched; step 2 kept
});

test('a failed call leaves a dim notice and the replay works', { timeoutMs: 10000 }, async ($, on) => {
  world(on, () => ({ isAnswered: false, reason: 'aborted', usage }));
  await playTurn($);
  const text = await until($, (t) => t.includes('No se pudo obtener'));
  expect(text).toContain('aborted');
  expect(text).toContain('step 1 of 3');
  await $.ui.press({ plugin: 'replay-theater', key: 'next' } as any);
  expect(await drawn($)).toContain('step 2 of 3');
});
