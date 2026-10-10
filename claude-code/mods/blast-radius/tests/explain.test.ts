// Haiku's plain-language note: drawn in the pane while the call is held, and
// never in the way of the decision (Cancel still refuses, a failed call only
// leaves the note out).
import { test, expect } from 'claude-code/testing';

const ran = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false };
const usage = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

// The world beneath the mod: an rm of build/ with two files, a placed pane.
function world(on: any, model: (e: any) => unknown) {
  const seen = { prompt: '', system: '', model: '', ranBash: false };
  on('session.cwd', () => ({ value: '/tmp/project' }));
  on('clock.now', () => ({ value: 0 }));
  on('process.run', (_$: unknown, e: any) => {
    if (e.argv[0] === 'bash') {
      return { value: { ...ran, stdout: '2 8192 1\n./build/a.o\n./build/b.o\n' } };
    }
    // sleep while held: really wait, so the hold loop yields to the test
    return new Promise((resolve) => setTimeout(() => resolve({ value: ran }), 5));
  });
  on('ui.open', () => ({ value: { isPlaced: true } }));
  on('ui.close', () => ({ value: undefined }));
  on('ui.invalidate', () => ({ value: undefined }));
  on('ui.toast', () => ({ value: undefined }));
  on('model.complete', (_$: unknown, e: any) => {
    seen.prompt = e.prompt;
    seen.system = e.system;
    seen.model = e.model;
    return { value: model(e) };
  });
  on('tool.call', () => {
    seen.ranBash = true;
    return { result: { stdout: '', stderr: '', interrupted: false } };
  });
  return seen;
}

const pane = { title: 'Blast Radius', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: {}, view: {} } as any;

async function drawn($: any): Promise<string> {
  const tree = await $.ui.render({ surface: 'terminal', component: 'Pane', requestId: 'blast-radius', props: pane });
  return JSON.stringify(tree);
}

async function until($: any, check: (text: string) => boolean): Promise<string> {
  for (let i = 0; i < 200; i += 1) {
    const text = await drawn($).catch(() => '');
    if (check(text)) {
      return text;
    }
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`never drawn: ${await drawn($).catch((e) => String(e))}`);
}

test('the pane shows Haiku’s explanation, and Cancel still refuses', { timeoutMs: 10000 }, async ($, on) => {
  const seen = world(on, () => ({ isAnswered: true, text: 'Borra la carpeta build con 2 ficheros. No se puede deshacer.', usage }));
  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' } as any);

  const text = await until($, (t) => t.includes('No se puede deshacer'));
  expect(text).toContain('En pocas palabras');
  expect(seen.model).toBe('haiku');
  expect(seen.prompt).toContain('rm -rf build');
  expect(seen.prompt).toContain('build/a.o');

  await $.ui.press({ plugin: 'blast-radius', key: 'cancel' } as any);
  const result: any = await call;
  expect(String(result.deny ?? result.text)).toContain('the user pressed Cancel');
  expect(seen.ranBash).toBe(false);
});

test('a failed explanation leaves the buttons working', { timeoutMs: 10000 }, async ($, on) => {
  const seen = world(on, () => ({ isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage }));
  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' } as any);

  const text = await until($, (t) => t.includes('No se pudo obtener'));
  expect(text).toContain('api-error');

  await $.ui.press({ plugin: 'blast-radius', key: 'proceed' } as any);
  await call;
  expect(seen.ranBash).toBe(true);
});
