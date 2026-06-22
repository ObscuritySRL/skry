/**
 * wait-for-alert — umbriel.waitForAlert / the wait_for_alert tool: resolve on the next transient accessibility
 * ANNOUNCEMENT (a modal dialog, an alert, or a live-region update) via SetWinEventHook (EVENT_SYSTEM_ALERT /
 * DIALOGSTART / OBJECT_LIVEREGIONCHANGED) on the SAFE OUTOFCONTEXT posted-message pump — NOT the forbidden
 * foreign-thread UIA callback. The announced text is resolved through Oleacc.AccessibleObjectFromEvent ->
 * IAccessible::get_accName. A bounded single-shot wait identical in lifetime to wait_for_window.
 *
 * Proof (live): install the wait (its hooks go in synchronously), then raise a Win32 MessageBox in a CHILD process
 * (a different pid, so WINEVENT_SKIPOWNPROCESS still sees it). waitForAlert resolves {type:'dialog', text:<caption>,
 * processId:<child pid>}. Then a wait nothing satisfies rejects within its timeout — proving the bounded lifetime
 * (hooks unhooked + JSCallback closed on the reject path, no leaked hook). The child is killed in finally.
 *
 * NOTE on scope: modal-dialog/alert text resolves reliably (proven here); live-region (aria-live) text is
 * provider-dependent — the hook fires and text resolves where the provider exposes an accessible name, else
 * requireText filters it. No window of ours leaks (the MessageBox lives in the killed child).
 *
 * APIs demonstrated:
 * - umbriel.waitForAlert (3 WinEvent hooks + AccessibleObjectFromEvent/get_accName text resolution + bounded timeout)
 *
 * bun test is broken repo-wide for FFI; runnable harness (raises + kills its own MessageBox child):
 * Run: bun run example/wait-for-alert.integration.test.ts
 */
import { umbriel, waitForAlert } from 'umbriel';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

umbriel.initialize();
try {
  // 1) DIALOG path. waitForAlert installs its hooks synchronously in the Promise executor, so calling it BEFORE
  //    spawning the MessageBox child closes the race (an announcement is momentary).
  const wait = waitForAlert({ type: 'dialog' }, { timeout: 8000 });
  const child = Bun.spawn(['bun', '-e', `import u from '@bun-win32/user32'; u.MessageBoxW(0n, Buffer.from('umbriel wait_for_alert body\\0','utf16le').ptr, Buffer.from('UmbrielAlertProbe\\0','utf16le').ptr, 0);`], { stdout: 'ignore', stderr: 'ignore' });
  try {
    const alert = await wait;
    console.log(`  captured: ${JSON.stringify({ type: alert.type, text: alert.text, processId: alert.processId })}`);
    assert(alert.type === 'dialog', `captured a DIALOG announcement (type=${alert.type})`);
    assert(/UmbrielAlertProbe/.test(alert.text), `resolved the dialog's announced text via MSAA get_accName (${JSON.stringify(alert.text)})`);
    assert(alert.processId === child.pid, `attributed the announcement to the spawning process (pid ${alert.processId} === child ${child.pid})`);
  } catch (error) {
    assert(false, `waitForAlert(dialog) should have resolved: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    child.kill();
  }

  // 2) TIMEOUT path — a wait nothing satisfies must reject within its budget (the bounded lifetime; the reject path
  //    unhooks all three hooks + closes the JSCallback, so no hook leaks).
  let rejected = false;
  await waitForAlert({ text: 'this-announcement-never-appears' }, { timeout: 300 }).catch(() => {
    rejected = true;
  });
  assert(rejected, 'an unmatched waitForAlert rejects within its timeout (bounded — hooks unhooked + callback closed)');
} finally {
  umbriel.uninitialize();
}

// Regression gate: the pvarChild VARIANT can carry a VT_DISPATCH child the caller OWNS, so announcedText MUST
// VariantClear it — otherwise a VT_DISPATCH-returning announcement leaks one COM ref per event (the VT_I4 dialog
// path above never exposes the leak, so this source pin is what guards it).
const eventsSrc = await Bun.file(`${import.meta.dir}/../desktop/events.ts`).text();
const announced = eventsSrc.slice(eventsSrc.indexOf('function announcedText'), eventsSrc.indexOf('function accNameOfEvent'));
assert(/Oleaut32\.VariantClear\(pvarChild\.ptr!\)/.test(announced), "announcedText VariantClear's the pvarChild VARIANT (releases a VT_DISPATCH child — no COM ref leak)");

console.log(failures === 0 ? '\nPASS — waitForAlert resolves a transient a11y announcement (modal dialog) and bounds its own lifetime.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
