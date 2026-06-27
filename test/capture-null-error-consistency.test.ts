import { expect, test } from 'bun:test';

// A non-minimized window whose WGC live capture returns null is ONE failure class. capture_window / copy_image /
// wait_visual_idle report it via captureUnavailable(tool), which disambiguates 'Windows.Graphics.Capture is unavailable
// on this session' (a session-wide dead end — abandon capture) from 'returned no frame / protected-DRM content' (a
// window-specific block), each steering the next step. ocr and click_text instead threw a terse 'could not capture the
// window (protected / no surface)' that conflated the two and mis-steered recovery. Pin all five capture-null-while-
// visible sites onto captureUnavailable so the divergence cannot return. Static-source pin — the repo idiom.
const mcp = await Bun.file(`${import.meta.dir}/../mcp.ts`).text();

test('every capture-null-while-visible site routes through captureUnavailable (no terse conflated string)', () => {
  expect(mcp).not.toContain('could not capture the window'); // the terse conflated phrasing ocr/click_text used is gone
  for (const tool of ['ocr', 'click_text', 'capture_window', 'copy_image', 'wait_visual_idle']) {
    expect(mcp).toContain(`captureUnavailable('${tool}')`);
  }
});
