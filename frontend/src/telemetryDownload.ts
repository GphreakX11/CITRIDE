export function telemetryExport(stream: {
  id: string;
  records: Record<string, unknown>[];
}) {
  return {
    filename: `${stream.id.replace(/[^a-zA-Z0-9_-]/g, "_")}-complete.json`,
    contents: JSON.stringify(stream.records, null, 2),
  };
}
