import { validateBytes } from 'gltf-validator';
import { preflightGlb, preflightStl } from './verify';

self.onmessage = async ({ data }: MessageEvent<{ bytes: ArrayBuffer; format: 'glb' | 'stl' }>) => {
  try {
    const { bytes, format } = data;
    const stats = format === 'glb' ? preflightGlb(bytes) : preflightStl(bytes);
    const warnings: string[] = [];
    if (format === 'glb') {
      const report = await validateBytes(new Uint8Array(bytes), {
        maxIssues: 40,
        writeTimestamp: false,
      });
      if (report.issues.numErrors)
        throw new Error(
          report.issues.messages.find((i) => i.severity === 0)?.message ??
            'The embedded glTF geometry did not pass validation.',
        );
      warnings.push(
        ...report.issues.messages
          .filter((i) => i.severity === 1)
          .slice(0, 6)
          .map((i) => i.message),
      );
    }
    self.postMessage({ ok: true, bytes, stats, warnings }, { transfer: [bytes] });
  } catch (error) {
    self.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : 'The model could not be validated.',
    });
  }
};
