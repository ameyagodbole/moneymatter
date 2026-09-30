import { OfxParseError, type OfxHeader } from './types';

const HEADER_LIMIT_BYTES = 8 * 1024;
const SGML_REQUIRED_FIELDS = ['OFXHEADER', 'DATA', 'VERSION', 'ENCODING', 'CHARSET', 'COMPRESSION'] as const;
const XML_REQUIRED_FIELDS = ['OFXHEADER', 'VERSION', 'SECURITY', 'OLDFILEUID', 'NEWFILEUID'] as const;

/**
 * Where an OFX 1.x body starts: its first tag. Header lines never contain `<`, so this holds
 * wherever the financial institution puts its blank lines. The spec puts one between header
 * and body; Chase puts it before the header instead.
 */
function findSgmlBodyStart({ text }: { text: string }): number | null {
  const bodyStart = text.indexOf('<');
  return bodyStart < 0 ? null : bodyStart;
}

export function parseOfxHeader({ bytes }: { bytes: Buffer }): { bodyOffset: number; header: OfxHeader } {
  if (bytes.length === 0) {
    throw new OfxParseError({ code: 'empty-file', message: 'The OFX file is empty.' });
  }

  // The UTF-8 BOM must be dropped at the byte level: a Latin-1 decode turns it
  // into "\u00EF\u00BB\u00BF", which would then corrupt the first header key.
  const bomLength = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
  // Latin-1 maps every byte to the same code point. That makes it safe for this
  // bootstrap pass: we can find the ASCII header without decoding the body with
  // a charset that the header has not told us yet.
  const prefix = bytes.subarray(bomLength, Math.min(bytes.length, HEADER_LIMIT_BYTES)).toString('latin1');
  const sgmlBodyStart = findSgmlBodyStart({ text: prefix });
  const processingInstructionStart = prefix.search(/<\?OFX\s/i);
  const processingInstructionEnd =
    processingInstructionStart >= 0 ? prefix.indexOf('?>', processingInstructionStart) : -1;
  const values = new Map<string, string>();
  let bodyOffset = bomLength;
  // Detect the XML processing instruction before looking for an SGML body. Both
  // start with `<`, so checking OFX2 first keeps its declarations out of the
  // OFX1 header branch.
  const isXmlHeader = processingInstructionStart >= 0;
  if (isXmlHeader) {
    if (processingInstructionEnd < 0) {
      throw new OfxParseError({ code: 'invalid-header', message: 'The OFX XML declaration is incomplete.' });
    }
    const instruction = prefix.slice(processingInstructionStart + 5, processingInstructionEnd);
    const attributePattern = /([A-Z]+)\s*=\s*(["'])(.*?)\2/gi;
    for (const match of instruction.matchAll(attributePattern)) {
      values.set(match[1]!.toUpperCase(), match[3]!.trim());
    }
  } else if (sgmlBodyStart !== null) {
    for (const line of prefix.slice(0, sgmlBodyStart).split(/\r?\n/)) {
      const colon = line.indexOf(':');
      if (colon < 1) continue;
      values.set(line.slice(0, colon).trim().toUpperCase(), line.slice(colon + 1).trim());
    }
    bodyOffset = bomLength + sgmlBodyStart;
  } else {
    throw new OfxParseError({ code: 'invalid-header', message: 'The OFX header is missing or too large.' });
  }

  for (const field of isXmlHeader ? XML_REQUIRED_FIELDS : SGML_REQUIRED_FIELDS) {
    if (!values.get(field)) {
      throw new OfxParseError({ code: 'invalid-header', message: `The OFX header field ${field} is missing.` });
    }
  }

  const headerVersion = values.get('OFXHEADER')!;
  const version = values.get('VERSION')!;
  if (!/^\d{3}$/.test(headerVersion) || !/^\d{3}$/.test(version)) {
    throw new OfxParseError({ code: 'unsupported-version', message: 'The OFX version is invalid.' });
  }
  if (!isXmlHeader) {
    const data = values.get('DATA')!.toUpperCase();
    const compression = values.get('COMPRESSION')!.toUpperCase();
    if (data !== 'OFXSGML') {
      throw new OfxParseError({ code: 'unsupported-data', message: `OFX data type ${data} is not supported.` });
    }
    if (compression !== 'NONE') {
      throw new OfxParseError({ code: 'compressed-file', message: 'Compressed OFX files are not supported.' });
    }
  }

  const xmlEncoding = /^\s*<\?xml[^>]*\bencoding\s*=\s*(["'])(.*?)\1/i.exec(prefix)?.[2] ?? 'UTF-8';

  return {
    bodyOffset,
    header: {
      charset: isXmlHeader ? xmlEncoding : values.get('CHARSET')!,
      compression: 'NONE',
      data: isXmlHeader ? 'OFXXML' : 'OFXSGML',
      encoding: isXmlHeader ? xmlEncoding : values.get('ENCODING')!,
      headerVersion,
      version,
    },
  };
}
