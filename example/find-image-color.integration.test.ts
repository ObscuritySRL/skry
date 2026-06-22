/**
 * find-image-color — the find_image / find_color MCP tools wire the capture/match.ts grounding primitives
 * (findImage / locateColor — the AHK ImageSearch+PixelSearch / nut.js findOnScreen+pixelWithColor core) to MCP,
 * plus a from-scratch decodePNG so a base64-PNG needle arrives over the wire. Proves the pipeline the handlers run:
 * encodePNG -> base64 -> decodePNG (the new code) -> the matcher locates the needle at the correct coords.
 *
 * Determinism: everything is matched against ONE captured frame. The old version cropped a needle, then
 * locateOnScreen re-captured the live screen, then re-captured AGAIN at the hit to compare pixels — three captures
 * of a live, changing desktop, so a busy region (terminal output, a clock) made the re-capture mismatch (a flake,
 * not a real failure). Now: capture once, crop the needle out of THAT frame, and findImage() it back WITHIN the
 * same frame — a byte-exact self-match at the exact crop origin that no screen activity can perturb.
 *
 * No window to close (reads the live desktop). bun test is broken repo-wide for FFI; runnable harness:
 * Run: bun run example/find-image-color.integration.test.ts
 */
import { captureScreen, cropBitmap, decodePNG, encodePNG, findImage, locateColor } from 'umbriel';

let failures = 0;
function assert(condition: boolean, message: string): void {
  if (condition) console.log(`  ok: ${message}`);
  else {
    console.error(`  FAIL: ${message}`);
    failures += 1;
  }
}

// ONE capture; the needle is cropped out of THIS frame and matched back against it — no second capture to race.
const screen = captureScreen();
const rx = Math.min(200, Math.max(0, screen.width - 160));
const ry = Math.min(200, Math.max(0, screen.height - 120));
const needle = cropBitmap(screen, rx, ry, 140, 100);
if (needle === null) {
  console.log('skip: screen too small to crop a 140x100 needle');
  process.exit(0);
}

// 1) The base64-PNG round-trip the find_image handler runs: encodePNG -> base64 -> decodePNG must be byte-EXACT.
const base64 = Buffer.from(encodePNG(needle.rgb, needle.width, needle.height)).toString('base64');
const decoded = decodePNG(new Uint8Array(Buffer.from(base64, 'base64')));
assert(decoded.width === needle.width && decoded.height === needle.height, `decodePNG round-trips the needle dims (${decoded.width}x${decoded.height})`);
assert(Buffer.from(decoded.rgb).equals(Buffer.from(needle.rgb)), 'decodePNG round-trips the needle pixels byte-exact (encode->base64->decode)');

// 2) findImage locates the decoded needle WITHIN THE SAME frame at its exact crop origin — a deterministic self-match
//    (the needle is literally a sub-rect of the haystack, so the global-minimum difference is 0 at {rx,ry}).
// step:1 = full-pixel compare (no subsampling), so the global-minimum difference is a TRUE byte-exact occurrence —
// the default subsample can score 1.0 on a near-match grid that is not byte-identical.
const match = findImage(screen, { ...decoded, originX: 0, originY: 0 }, { step: 1 });
assert(match !== null && match.score > 0.99, `findImage self-match is near-perfect (score ${match?.score.toFixed(3) ?? 'null'})`);
// The returned location really contains the needle — re-crop from the SAME frame (no second capture) and compare
// byte-exact. (Coords need not equal {rx,ry}: a uniform/wallpaper patch matches identically at several spots, so the
// matcher may pick another exact occurrence — what must hold is that wherever it points, the needle truly is.)
if (match !== null) {
  const at = cropBitmap(screen, match.x, match.y, needle.width, needle.height);
  assert(at !== null && Buffer.from(at.rgb).equals(Buffer.from(needle.rgb)), `the match location {x:${match.x},y:${match.y}} byte-exactly contains the needle (in the same frame)`);
}

// 3) find_color: read a pixel's RGB from the frame and locate that color on screen (the live find_color path). A
//    small tolerance absorbs any live-frame jitter; the color provably exists, so locateColor must return a hit.
const center = (Math.floor(needle.height / 2) * needle.width + Math.floor(needle.width / 2)) * 3;
const r = needle.rgb[center]!;
const g = needle.rgb[center + 1]!;
const b = needle.rgb[center + 2]!;
const hit = locateColor({ r, g, b }, 4);
assert(hit !== null, `locateColor finds rgb(${r},${g},${b}) on screen (it was sampled from the captured frame)`);

console.log(failures === 0 ? '\nPASS — find_image (decodePNG + findImage self-match) and find_color (locateColor) ground a screen surface by template/color.' : `\nFAILED — ${failures} assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
