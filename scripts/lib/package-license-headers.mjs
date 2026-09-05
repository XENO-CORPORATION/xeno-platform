import ts from 'typescript';

// Use lexical comment tokens, not a regex over code strings containing examples.
export function copyrightLicenseHeaders(source) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source);
  const result = [];
  let lineComments = '';
  const retain = text => {
    if (/copyright/i.test(text) && /licen[cs]e/i.test(text)) {
      if (text.length > 16384) throw new Error('Oversized source license header');
      result.push(text);
    }
  };
  const flush = () => { if (lineComments) retain(lineComments); lineComments = ''; };
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    const text = scanner.getTokenText();
    if (kind === ts.SyntaxKind.SingleLineCommentTrivia) lineComments += text;
    else if (lineComments && [ts.SyntaxKind.WhitespaceTrivia, ts.SyntaxKind.NewLineTrivia].includes(kind)) lineComments += text;
    else {
      flush();
      if (kind === ts.SyntaxKind.MultiLineCommentTrivia) retain(text);
    }
  }
  flush();
  return result;
}
