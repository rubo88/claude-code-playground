// The on/off switch: /blast-radius off lets risky commands through with a
// toast and a status line, /blast-radius turns it back on, and the choice is
// kept in the store.
import { test, expect, mock } from 'claude-code/testing';

const ran = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false };
const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

function world(on: any) {
  const seen = { opened: 0, ranBash: 0, toasts: [] as string[], status: [] as (string | undefined)[] };
  mock.store(on);
  on('session.cwd', () => ({ value: '/tmp/project' }));
  on('clock.now', () => ({ value: 0 }));
  on('process.run', (_$: unknown, e: any) => {
    if (e.argv[0] === 'bash') return { value: { ...ran, stdout: '1 4096 1\n./build/a.o\n' } };
    return new Promise((resolve) => setTimeout(() => resolve({ value: ran }), 5));
  });
  on('ui.open', () => { seen.opened += 1; return { value: { isPlaced: true } }; });
  on('ui.close', () => ({ value: undefined }));
  on('ui.invalidate', () => ({ value: undefined }));
  on('ui.toast', (_$: unknown, e: any) => { seen.toasts.push(String(e.text ?? e.message ?? JSON.stringify(e))); return { value: undefined }; });
  on('ui.status', (_$: unknown, e: any) => { seen.status.push(e?.text); return { value: undefined }; });
  on('model.complete', () => ({ value: { isAnswered: true, text: 'Borra build.', usage } }));
  on('tool.call', () => { seen.ranBash += 1; return { result: { stdout: '', stderr: '', interrupted: false } }; });
  return seen;
}

const run = ($: any, args: string) => $.command.run({ command: 'blast-radius', args });

test('off lets a risky command run, with a toast; status says so', { timeoutMs: 10000 }, async ($, on) => {
  const seen = world(on);
  const r: any = await run($, 'off');
  expect(String(r.text)).toContain('apagado');
  expect(String((await run($, 'status') as any).text)).toContain('apagado');

  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' } as any);
  expect(seen.ranBash).toBe(1);
  expect(seen.opened).toBe(0);
  expect(seen.toasts.join(' ')).toContain('apagado');
});

test('a bare /blast-radius toggles back on, and the command is held again', { timeoutMs: 10000 }, async ($, on) => {
  const seen = world(on);
  await run($, 'off');
  const r: any = await run($, '');
  expect(String(r.text)).toContain('encendido');

  const call = $.tool.call({ tool: 'Bash', command: 'rm -rf build' } as any);
  for (let i = 0; i < 200 && seen.opened === 0; i += 1) await new Promise((res) => setTimeout(res, 10));
  expect(seen.opened).toBe(1);
  await $.ui.render({ surface: 'terminal', component: 'Pane', requestId: 'blast-radius', props: { title: 'Blast Radius', isFocused: true, bodyColumns: 100, placement: 'dock', scroll: {}, view: {} } } as any);
  await $.ui.press({ plugin: 'blast-radius', key: 'cancel' } as any);
  await call;
  expect(seen.ranBash).toBe(0);
});

test('a non-risky command is never touched by the switch', { timeoutMs: 10000 }, async ($, on) => {
  const seen = world(on);
  await $.tool.call({ tool: 'Bash', command: 'ls -la' } as any);
  expect(seen.ranBash).toBe(1);
  expect(seen.toasts.length).toBe(0);
});
