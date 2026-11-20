import { buildPdf } from './e-ticket-pdf';

describe('buildPdf', () => {
  it('writes a PDF whose cross-reference offsets point at each object', () => {
    const pdf = buildPdf([{ text: 'E-TICKET', bold: true }, { text: 'Hi' }]);
    const text = pdf.toString('latin1');

    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    const xrefAt = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(xrefAt, xrefAt + 4)).toBe('xref');
    const offsets = [...text.matchAll(/^(\d{10}) 00000 n $/gm)].map((m) =>
      Number(m[1]),
    );
    offsets.forEach((offset, index) => {
      expect(text.slice(offset).startsWith(`${index + 1} 0 obj`)).toBe(true);
    });
  });

  it('escapes PDF syntax and replaces characters the font cannot show', () => {
    const text = buildPdf([{ text: 'A (b) \\ منى' }]).toString('latin1');
    expect(text).toContain('(A \\(b\\) \\\\ ???) Tj');
  });

  it('starts a new page when the text runs past the bottom', () => {
    const lines = Array.from({ length: 120 }, (_, i) => ({ text: `${i}` }));
    const text = buildPdf(lines).toString('latin1');
    expect(text).toMatch(/\/Count [2-9]/);
  });
});
