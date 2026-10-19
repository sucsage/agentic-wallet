/**
 * macOS details the window library leaves out, through the Objective-C runtime (bun:ffi).
 * Screen recording and screenshots: off sets the window's sharing type to none, so screenshots,
 * recordings and screen sharing show it blank.
 *
 * AppKit must be changed on the main thread, and this code runs on Bun's own thread (a direct call
 * crashes the app), so the change is handed over: the window runs
 * setValuesForKeysWithDictionary:@{ @"sharingType": @(n) } on the main thread. Best effort: an error
 * leaves the default.
 */
import { FFIType, dlopen, ptr } from "bun:ffi";

const LIBOBJC = "/usr/lib/libobjc.A.dylib";
const cstr = (s: string) => ptr(Buffer.from(`${s}\0`));

let rt: ReturnType<typeof load> | null = null;
function load() {
  // Objects are passed as 64-bit integers: tagged pointers (e.g. a small NSNumber) do not fit a JS
  // number. objc_msgSend gets one binding per argument shape.
  const U = FFIType.u64;
  const base = dlopen(LIBOBJC, {
    objc_getClass: { args: [FFIType.ptr], returns: U },
    sel_registerName: { args: [FFIType.ptr], returns: U },
  });
  const sendU64 = dlopen(LIBOBJC, { objc_msgSend: { args: [U, U, U], returns: U } });
  const sendPtr = dlopen(LIBOBJC, { objc_msgSend: { args: [U, U, FFIType.ptr], returns: U } });
  const sendObjObj = dlopen(LIBOBJC, { objc_msgSend: { args: [U, U, U, U], returns: U } });
  const sendMain = dlopen(LIBOBJC, { objc_msgSend: { args: [U, U, U, U, FFIType.bool], returns: FFIType.void } });
  const big = (x: unknown) => BigInt(x as number | bigint);
  const cls = (n: string) => big(base.symbols.objc_getClass(cstr(n)));
  const sel = (n: string) => big(base.symbols.sel_registerName(cstr(n)));
  return {
    cls,
    sel,
    num: (n: bigint) => big(sendU64.symbols.objc_msgSend(cls("NSNumber"), sel("numberWithUnsignedInteger:"), n)),
    str: (t: string) => big(sendPtr.symbols.objc_msgSend(cls("NSString"), sel("stringWithUTF8String:"), cstr(t))),
    dict: (v: bigint, k: bigint) => big(sendObjObj.symbols.objc_msgSend(cls("NSDictionary"), sel("dictionaryWithObject:forKey:"), v, k)),
    onMain: (target: bigint, selector: bigint, arg: bigint) => sendMain.symbols.objc_msgSend(target, sel("performSelectorOnMainThread:withObject:waitUntilDone:"), selector, arg, false),
  };
}

export function setCaptureAllowed(nsWindow: unknown, allowed: boolean) {
  if (!nsWindow) return;
  try {
    rt ??= load();
    const r = rt;
    // NSWindowSharingNone = 0, NSWindowSharingReadOnly = 1 (the default).
    const dict = r.dict(r.num(allowed ? 1n : 0n), r.str("sharingType"));
    if (!dict) throw new Error("could not make the settings");
    r.onMain(BigInt(nsWindow as number), r.sel("setValuesForKeysWithDictionary:"), dict);
  } catch (e) {
    console.warn(`[macos] screen capture: ${(e as Error).message}`);
  }
}
