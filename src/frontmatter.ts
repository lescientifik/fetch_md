export interface FrontmatterFields {
  title?: string;
  url: string;
}

function escapeYamlString(value: string): string {
  return '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ').trim() + '"';
}

export function buildFrontmatter(fields: FrontmatterFields): string {
  const lines: string[] = ['---'];
  if (fields.title && fields.title.trim().length > 0) {
    lines.push(`title: ${escapeYamlString(fields.title)}`);
  }
  lines.push(`url: ${escapeYamlString(fields.url)}`);
  lines.push('---', '');
  return lines.join('\n') + '\n';
}
