declare module 'gltf-validator' {
  export function validateBytes(
    bytes: Uint8Array,
    options?: { maxIssues?: number; writeTimestamp?: boolean },
  ): Promise<{
    issues: {
      numErrors: number;
      numWarnings: number;
      messages: { code: string; message: string; severity: number }[];
    };
  }>;
}
